import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { createRoleStore, type InternalSchema, type RoleStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { createPluginRuntime, createPluginStore, sha256Hex, type PluginRuntime, type PluginStore } from '@openldr/plugins';
import { CAPABILITY_GROUPS, CAPABILITY_KEYS } from '@openldr/rbac';
import { parseArtifactManifest } from '@openldr/marketplace';
import { createCapabilityCatalog, createPluginPermissionSync, type CapabilityCatalog } from './capability-catalog';

// Plan 2026-11-23-plugin-host-2b, task 2: a plugin's permissions join the capability catalog while
// the plugin is installed and enabled. Real role store, plugin store and runtime, on pg-mem.

const wasm = new Uint8Array([1, 2, 3]);
const wasmSha = sha256Hex(wasm);

const RECEIVE = { key: 'lab.orders.receive', label: 'Receive orders', description: 'Receive lab orders.', labels: { fr: { label: 'Recevoir', description: 'Recevoir.' } } };
const REVIEW = { key: 'lab.orders.review', label: 'Review orders', description: 'Review lab orders.' };

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

  it('refuses an install whose permission key another installed plugin declares, and keeps the old version active', async () => {
    await runtime.install(wasm, artifact('lab', '0.1.0', [RECEIVE]));
    await runtime.install(wasm, artifact('micro', '0.1.0', [REVIEW]));
    await expect(runtime.install(wasm, artifact('micro', '0.2.0', [REVIEW, RECEIVE]))).rejects.toThrow(
      'micro@0.2.0 was not installed, and micro@0.1.0 stays active: the permission lab.orders.receive is already declared by the installed plugin lab',
    );
    const micro = (await pluginStore.list()).filter((r) => r.id === 'micro');
    expect(micro.map((r) => [r.version, r.active])).toEqual([['0.1.0', true]]);
    // The plugin's own next version may keep its keys.
    await runtime.install(wasm, artifact('lab', '0.2.0', [RECEIVE, { ...RECEIVE, key: 'lab.orders.cancel' }]));
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
