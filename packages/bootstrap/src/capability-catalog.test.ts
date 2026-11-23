import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { createRoleStore, type InternalSchema, type RoleStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { createPluginRuntime, createPluginStore, sha256Hex, type PluginRuntime, type PluginStore } from '@openldr/plugins';
import { CAPABILITY_GROUPS, CAPABILITY_KEYS } from '@openldr/rbac';
import { generatePublisherKeypair, parseArtifactManifest, signManifest, type PublisherKeypair } from '@openldr/marketplace';
import { createCapabilityCatalog, createPluginPermissionSync, warnPluginOwnedCeGroups, type CapabilityCatalog } from './capability-catalog';

// Plan 2026-11-23-plugin-host-2b, task 2: a plugin's permissions join the capability catalog while
// the plugin is installed and enabled. Real role store, plugin store and runtime, on pg-mem.

const wasm = new Uint8Array([1, 2, 3]);
const wasmSha = sha256Hex(wasm);

const RECEIVE = { key: 'lab.orders.receive', label: 'Receive orders', description: 'Receive lab orders.', labels: { fr: { label: 'Recevoir', description: 'Recevoir.' } } };
const REVIEW = { key: 'lab.orders.review', label: 'Review orders', description: 'Review lab orders.' };
const MICRO = { key: 'micro.read', label: 'Read', description: 'Read micro results.' };

function artifact(id: string, version: string, permissions: unknown[], nav?: string) {
  return {
    schemaVersion: 1 as const, type: 'plugin' as const, id, version,
    compatibility: { ceVersion: '*' },
    capabilities: [],
    payload: {
      kind: 'plugin' as const, wasmSha256: wasmSha, entrypoint: 'convert', entrypoints: ['convert'], wasi: false,
      limits: { memoryMb: 256, timeoutMs: 30000 }, permissions,
      ...(nav ? { ui: { nav: { label: nav } } } : {}),
    },
  };
}

function memoryBlob() {
  const m = new Map<string, Uint8Array>();
  return {
    put: async (k: string, b: Uint8Array) => { m.set(k, b); },
    get: async (k: string) => { const v = m.get(k); if (!v) throw new Error('missing blob'); return v; },
    exists: async () => true, presign: async () => '', healthCheck: async () => ({ status: 'up' as const, latencyMs: 0 }),
  } as never;
}

const logger = () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() });

describe('capability catalog with installed plugins', () => {
  let db: Kysely<InternalSchema>;
  let pluginStore: PluginStore;
  let catalog: CapabilityCatalog;
  let roles: RoleStore;
  let runtime: PluginRuntime;
  let log: ReturnType<typeof logger>;

  beforeEach(async () => {
    db = await makeMigratedDb();
    log = logger();
    pluginStore = createPluginStore(db);
    catalog = createCapabilityCatalog({ plugins: pluginStore, logger: log });
    roles = createRoleStore(db, { catalogKeys: () => catalog.keys() });
    await roles.seedSystemRoles();
    const sync = createPluginPermissionSync({ catalog, roles });
    runtime = createPluginRuntime({
      blob: memoryBlob(), store: pluginStore, runner: { run: vi.fn() } as never, logger: log as never,
      trustStore: { get: async () => undefined, pin: async () => {} } as never,
      ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false }, onChange: sync.onChange,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('lists a plugin key and group while the plugin is installed and enabled, and drops them when disabled', async () => {
    expect(await catalog.isKnown(RECEIVE.key)).toBe(false);
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE], 'Lab'));

    expect(await catalog.isKnown(RECEIVE.key)).toBe(true);
    expect(await catalog.pluginKeys()).toEqual([RECEIVE.key]);
    const groups = await catalog.groups();
    expect(groups.slice(0, CAPABILITY_GROUPS.length)).toEqual(CAPABILITY_GROUPS);
    expect(groups.at(-1)).toMatchObject({ key: 'plugin:lab', label: 'Lab', plugin: 'lab', capabilities: [{ key: RECEIVE.key, label: 'Receive orders', labels: { fr: { label: 'Recevoir' } } }] });

    await runtime.setEnabled('lab', false);
    expect(await catalog.isKnown(RECEIVE.key)).toBe(false);
    expect((await catalog.groups()).some((g) => g.plugin === 'lab')).toBe(false);
  });

  it('labels the group with the plugin id when the plugin has no sidebar entry', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    expect((await catalog.groups()).at(-1)).toMatchObject({ key: 'plugin:lab', label: 'lab' });
  });

  it('accepts a plugin key on a role while installed, keeps it after removal with the role still editable, and knows it again after reinstall', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    const role = await roles.create({ name: 'Bench', capabilities: ['forms.view', RECEIVE.key] });
    expect([...role.capabilities].sort()).toEqual(['forms.view', RECEIVE.key]);

    let d = await roles.diagnoseCapabilities();
    expect(d.plugin).toEqual([RECEIVE.key]);
    expect(d.kept).toEqual([]);

    // While installed the key is known, so a save can revoke it.
    await roles.update(role.id, { capabilities: ['forms.view'] });
    expect((await roles.get(role.id))!.capabilities).toEqual(['forms.view']);
    await roles.update(role.id, { capabilities: ['forms.view', RECEIVE.key] });

    await runtime.remove('lab');
    expect(await catalog.isKnown(RECEIVE.key)).toBe(false);
    // A new grant of the key is refused now, but the stored grant stays and the role is editable.
    await expect(roles.create({ name: 'Other', capabilities: [RECEIVE.key] })).rejects.toThrow(/unknown capability: lab.orders.receive/);
    await roles.update(role.id, { capabilities: ['forms.view', 'reports.view'] });
    expect([...(await roles.get(role.id))!.capabilities].sort()).toEqual(['forms.view', RECEIVE.key, 'reports.view']);
    d = await roles.diagnoseCapabilities();
    expect(d.kept).toEqual([RECEIVE.key]);
    expect(d.plugin).toEqual([]);

    await runtime.install(wasm, artifact('lab', '0.1.1', [RECEIVE]));
    d = await roles.diagnoseCapabilities();
    expect(d.plugin).toEqual([RECEIVE.key]);
    expect(d.kept).toEqual([]);
  });

  it('refuses an install with a key in a group another plugin owns, and keeps the old version active', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    await runtime.install(wasm, artifact('micro', '0.1.0', [MICRO]));
    await expect(runtime.install(wasm, artifact('micro', '0.2.0', [MICRO, { ...REVIEW, key: 'lab.micro.read' }]))).rejects.toThrow(
      "micro@0.2.0 was not installed, and micro@0.1.0 stays active: the permission group 'lab' belongs to the plugin lab, so micro cannot declare permissions in it",
    );
    const micro = (await pluginStore.list()).filter((r) => r.id === 'micro');
    expect(micro.map((r) => [r.version, r.active])).toEqual([['0.1.0', true]]);
    // The owner's next version may add keys to its own group.
    await runtime.install(wasm, artifact('lab', '0.2.0', [RECEIVE, { ...RECEIVE, key: 'lab.orders.cancel' }]));
    const owners = await db.selectFrom('plugin_permission_groups').select(['group', 'plugin_id']).orderBy('group').execute();
    expect(owners).toEqual([{ group: 'lab', plugin_id: 'lab' }, { group: 'micro', plugin_id: 'micro' }]);
  });

  it('never releases a group, so after the owner is removed another plugin still cannot use it', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    await roles.create({ name: 'Bench', capabilities: [RECEIVE.key] });
    await runtime.remove('lab');
    await expect(runtime.install(wasm, artifact('thief', '0.1.0', [RECEIVE]))).rejects.toThrow(
      "the permission group 'lab' belongs to the plugin lab, so thief cannot declare permissions in it",
    );
    expect(await catalog.isKnown(RECEIVE.key)).toBe(false);
    // The owner may come back and finds its kept grants.
    await runtime.install(wasm, artifact('lab', '0.1.1', [RECEIVE]));
    expect((await roles.diagnoseCapabilities()).plugin).toEqual([RECEIVE.key]);
  });

  it('refuses a rollback or an enable to a version whose group another plugin owns', async () => {
    // A row from before migration 142: micro 0.1.0 declares a key in `shared`, which lab owns.
    await runtime.install(wasm, artifact('micro', '0.1.0', [{ ...MICRO, key: 'shared.read' }]));
    await runtime.install(wasm, artifact('micro', '0.2.0', [MICRO]));
    await db.updateTable('plugin_permission_groups').set({ plugin_id: 'lab' }).where('group', '=', 'shared').execute();

    await expect(runtime.rollback('micro', '0.1.0')).rejects.toThrow(
      "cannot roll back micro to 0.1.0: the permission group 'shared' belongs to the plugin lab, so micro cannot declare permissions in it",
    );
    expect((await pluginStore.list()).filter((r) => r.id === 'micro' && r.active).map((r) => r.version)).toEqual(['0.2.0']);

    // Make 0.1.0 active by hand, as an old install would have left it, then disable and enable.
    await db.updateTable('plugins').set({ active: false }).where('id', '=', 'micro').execute();
    await db.updateTable('plugins').set({ active: true }).where('id', '=', 'micro').where('version', '=', '0.1.0').execute();
    await runtime.setEnabled('micro', false);
    await expect(runtime.setEnabled('micro', true)).rejects.toThrow("cannot enable micro: the permission group 'shared' belongs to the plugin lab");
    expect((await pluginStore.list()).filter((r) => r.id === 'micro').every((r) => !r.enabled)).toBe(true);
  });

  it('lets only one of two installs at once claim a group', async () => {
    const results = await Promise.allSettled([
      pluginStore.install({ id: 'one', version: '0.1.0', sha256: 'x', manifest: artifact('one', '0.1.0', [{ ...MICRO, key: 'race.read' }]), approvedBy: null }),
      pluginStore.install({ id: 'two', version: '0.1.0', sha256: 'x', manifest: artifact('two', '0.1.0', [{ ...MICRO, key: 'race.write' }]), approvedBy: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(failed.reason)).toMatch(/the permission group 'race' belongs to the plugin (one|two)/);
    const owner = (await db.selectFrom('plugin_permission_groups').select('plugin_id').where('group', '=', 'race').execute()).map((r) => r.plugin_id);
    expect(owner).toHaveLength(1);
    expect((await pluginStore.list()).map((r) => r.id)).toEqual(owner);
  });

  it('warns at boot when a later CE release adds a capability in a group a plugin owns, naming the plugin and the roles', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    await roles.create({ name: 'Bench', capabilities: [RECEIVE.key] });
    const none = await warnPluginOwnedCeGroups({ db, logger: log });
    expect(none).toEqual([]);

    const later = await warnPluginOwnedCeGroups({ db, logger: log, ceKeys: [...CAPABILITY_KEYS, 'lab.view'] });
    expect(later).toEqual([{ group: 'lab', plugin: 'lab', roles: ['bench', 'lab_admin'] }]);
    expect(log.warn).toHaveBeenCalledWith({ group: 'lab', plugin: 'lab', roles: ['bench', 'lab_admin'] }, expect.stringContaining('CE wins'));
  });

  it('grants the Administrator every plugin key at install and enable, and keeps the grants after removal', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE, REVIEW]));
    let admin = (await roles.getBySlug('lab_admin'))!;
    expect(admin.capabilities).toEqual(expect.arrayContaining([RECEIVE.key, REVIEW.key]));
    // No other role gets anything.
    expect((await roles.getBySlug('lab_manager'))!.capabilities).not.toContain(RECEIVE.key);

    await runtime.setEnabled('lab', false);
    await db.deleteFrom('role_capabilities').where('role_id', '=', admin.id).where('capability', '=', REVIEW.key).execute();
    await runtime.setEnabled('lab', true);
    admin = (await roles.getBySlug('lab_admin'))!;
    expect(admin.capabilities).toContain(REVIEW.key);

    await runtime.remove('lab');
    admin = (await roles.getBySlug('lab_admin'))!;
    expect(admin.capabilities).toEqual(expect.arrayContaining([RECEIVE.key, REVIEW.key]));
    expect((await roles.diagnoseCapabilities()).kept).toEqual([RECEIVE.key, REVIEW.key].sort());
  });

  it('never records a plugin key in the capability ledger', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    await roles.seedSystemRoles();
    const ledger = (await db.selectFrom('capability_introductions').select('capability').execute()).map((r) => r.capability);
    expect(ledger).toEqual(expect.arrayContaining([...CAPABILITY_KEYS]));
    expect(ledger).not.toContain(RECEIVE.key);
  });

  it('treats a stored key that a later CE release adds as CE\'s, logs once, and does not throw', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE, REVIEW]));
    // A later CE release: its static catalog now holds lab.orders.review.
    const later = createCapabilityCatalog({ plugins: pluginStore, logger: log, ceKeys: [...CAPABILITY_KEYS, REVIEW.key] });
    expect(await later.pluginKeys()).toEqual([RECEIVE.key]);
    expect(await later.isKnown(REVIEW.key)).toBe(true);
    const group = (await later.groups()).find((g) => g.plugin === 'lab')!;
    expect(group.capabilities.map((c) => c.key)).toEqual([RECEIVE.key]);
    later.invalidate();
    await later.keys();
    const warns = log.warn.mock.calls.filter((c) => String(c[1]).includes('now a CE capability'));
    expect(warns).toHaveLength(1);
    expect(warns[0]![0]).toEqual({ plugin: 'lab', key: REVIEW.key });

    // The stored manifest still loads: the install parse would refuse the key, the stored read does not.
    const row = (await pluginStore.list())[0]!;
    const asLater = { ...row.manifest, payload: { ...(row.manifest.payload as object), permissions: [{ ...RECEIVE, key: 'forms.view' }] } };
    expect(() => parseArtifactManifest(asLater)).toThrow(/is a CE capability/);
    expect(() => parseArtifactManifest(asLater, { stored: true })).not.toThrow();
  });

  it('lists CE capabilities alone when it cannot read the plugins', async () => {
    const broken = createCapabilityCatalog({ plugins: { list: async () => { throw new Error('no table'); } }, logger: log });
    expect(await broken.keys()).toEqual([...CAPABILITY_KEYS]);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('a permission group stays with its plugin id and publisher', () => {
  let db: Kysely<InternalSchema>;
  let pluginStore: PluginStore;
  let roles: RoleStore;
  let catalog: CapabilityCatalog;
  let log: ReturnType<typeof logger>;
  const acme = generatePublisherKeypair();
  const other = generatePublisherKeypair();

  function makeRuntime(devAllowUnsigned = false): PluginRuntime {
    const sync = createPluginPermissionSync({ catalog, roles });
    return createPluginRuntime({
      blob: memoryBlob(), store: pluginStore, runner: { run: vi.fn() } as never, logger: log as never,
      trustStore: { get: async () => undefined, pin: async () => {} } as never,
      ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned }, onChange: sync.onChange,
    });
  }

  /** An artifact signed by `kp` under publisher `pubId`. */
  function signed(kp: PublisherKeypair, id: string, version: string, permissions: unknown[], pubId = 'acme') {
    const base = { ...artifact(id, version, permissions), publisher: { id: pubId, name: pubId, keyFingerprint: kp.fingerprint } };
    return { ...base, signature: signManifest(base as Record<string, unknown>, wasmSha, kp.privateKeyDer) };
  }

  const opts = (kp: PublisherKeypair) => ({ publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: [] } });
  const active = async (id: string) => (await pluginStore.list()).filter((r) => r.id === id && r.active).map((r) => r.version);
  const claim = async (group: string) =>
    db.selectFrom('plugin_permission_groups').select(['plugin_id', 'publisher']).where('group', '=', group).executeTakeFirst();

  beforeEach(async () => {
    db = await makeMigratedDb();
    log = logger();
    pluginStore = createPluginStore(db);
    catalog = createCapabilityCatalog({ plugins: pluginStore, logger: log });
    roles = createRoleStore(db, { catalogKeys: () => catalog.keys() });
    await roles.seedSystemRoles();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('records the verified key fingerprint on a signed claim and null on an unsigned one', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, signed(acme, 'lab', '0.1.0', [RECEIVE]), opts(acme));
    await rt.install(wasm, artifact('micro', '0.1.0', [MICRO]));
    expect(await claim('lab')).toEqual({ plugin_id: 'lab', publisher: acme.fingerprint });
    expect(await claim('micro')).toEqual({ plugin_id: 'micro', publisher: null });
    expect((await pluginStore.list()).map((r) => [r.id, r.publisher])).toEqual([['lab', acme.fingerprint], ['micro', null]]);
  });

  it('refuses the same id from another publisher and keeps the old version active', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, signed(acme, 'lab', '0.1.0', [RECEIVE]), opts(acme));
    await expect(rt.install(wasm, signed(other, 'lab', '0.2.0', [RECEIVE], 'other'), opts(other))).rejects.toThrow(
      "lab@0.2.0 was not installed, and lab@0.1.0 stays active: the permission group 'lab' belongs to the plugin lab from a different publisher, so this copy of lab cannot declare permissions in it",
    );
    expect(await active('lab')).toEqual(['0.1.0']);
    expect(await claim('lab')).toEqual({ plugin_id: 'lab', publisher: acme.fingerprint });
  });

  it('refuses the same id unsigned after a removed signed owner, so it does not inherit the kept grants', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, signed(acme, 'lab', '0.1.0', [RECEIVE]), opts(acme));
    await roles.create({ name: 'Bench', capabilities: [RECEIVE.key] });
    await rt.remove('lab');
    await expect(rt.install(wasm, artifact('lab', '0.1.1', [RECEIVE]))).rejects.toThrow(
      "lab@0.1.1 was not installed, and nothing was installed: the permission group 'lab' belongs to the plugin lab from a different publisher",
    );
    expect(await pluginStore.list()).toEqual([]);
    expect((await roles.diagnoseCapabilities()).kept).toEqual([RECEIVE.key]);
  });

  it('refuses the same id signed after an unsigned owner', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    await expect(rt.install(wasm, signed(acme, 'lab', '0.2.0', [RECEIVE]), opts(acme))).rejects.toThrow(
      "lab@0.2.0 was not installed, and lab@0.1.0 stays active: the permission group 'lab' belongs to the plugin lab from a different publisher",
    );
    expect(await active('lab')).toEqual(['0.1.0']);
  });

  it('records null when a manifest names the owner fingerprint but the signature was not verified', async () => {
    await makeRuntime().install(wasm, signed(acme, 'lab', '0.1.0', [RECEIVE]), opts(acme));
    // A copy that names acme's fingerprint, signed by another key, let through by devAllowUnsigned.
    const forged = { ...signed(other, 'lab', '0.2.0', [RECEIVE]), publisher: { id: 'acme', name: 'acme', keyFingerprint: acme.fingerprint } };
    await expect(makeRuntime(true).install(wasm, forged, opts(other))).rejects.toThrow(/belongs to the plugin lab from a different publisher/);
    expect(await active('lab')).toEqual(['0.1.0']);
  });

  it('lets the same id from the same publisher back in after removal, with its kept grants', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, signed(acme, 'lab', '0.1.0', [RECEIVE]), opts(acme));
    await roles.create({ name: 'Bench', capabilities: [RECEIVE.key] });
    await rt.remove('lab');
    await rt.install(wasm, signed(acme, 'lab', '0.1.1', [RECEIVE]), opts(acme));
    expect(await active('lab')).toEqual(['0.1.1']);
    expect((await roles.diagnoseCapabilities()).plugin).toEqual([RECEIVE.key]);
    // The same holds for an unsigned owner reinstalled unsigned.
    await rt.install(wasm, artifact('micro', '0.1.0', [MICRO]));
    await rt.remove('micro');
    await rt.install(wasm, artifact('micro', '0.1.1', [MICRO]));
    expect(await active('micro')).toEqual(['0.1.1']);
  });

  it('refuses a rollback or an enable to a version recorded with another publisher', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, signed(acme, 'lab', '0.1.0', [RECEIVE]), opts(acme));
    await rt.install(wasm, signed(acme, 'lab', '0.2.0', [RECEIVE]), opts(acme));
    // A stored version recorded unsigned, as a row from before migration 142 is.
    await db.updateTable('plugins').set({ publisher: null }).where('id', '=', 'lab').where('version', '=', '0.1.0').execute();

    await expect(rt.rollback('lab', '0.1.0')).rejects.toThrow(
      "cannot roll back lab to 0.1.0: the permission group 'lab' belongs to the plugin lab from a different publisher",
    );
    expect(await active('lab')).toEqual(['0.2.0']);

    await db.updateTable('plugins').set({ active: false }).where('id', '=', 'lab').execute();
    await db.updateTable('plugins').set({ active: true }).where('id', '=', 'lab').where('version', '=', '0.1.0').execute();
    await rt.setEnabled('lab', false);
    await expect(rt.setEnabled('lab', true)).rejects.toThrow("cannot enable lab: the permission group 'lab' belongs to the plugin lab from a different publisher");
    expect((await pluginStore.list()).every((r) => !r.enabled)).toBe(true);
  });

  it('matches a boot warning group exactly, so `_` in a group is not a wildcard', async () => {
    const rt = makeRuntime();
    await rt.install(wasm, artifact('ab', '0.1.0', [{ ...MICRO, key: 'a_b.read' }]));
    await rt.install(wasm, artifact('axb', '0.1.0', [{ ...MICRO, key: 'axb.read' }]));
    await roles.create({ name: 'Own', capabilities: ['a_b.read'] });
    await roles.create({ name: 'Other', capabilities: ['axb.read'] });
    const out = await warnPluginOwnedCeGroups({ db, logger: log, ceKeys: [...CAPABILITY_KEYS, 'a_b.view'] });
    expect(out).toEqual([{ group: 'a_b', plugin: 'ab', roles: ['lab_admin', 'own'] }]);
  });
});
