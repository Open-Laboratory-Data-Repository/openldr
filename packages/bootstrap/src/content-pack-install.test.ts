import { describe, it, expect, vi } from 'vitest';
import { generatePublisherKeypair, packBundle, readBundle, summarizeContentPack, parseContentPack } from '@openldr/marketplace';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentPackInstaller } from './content-pack-install';

const PACK = {
  formatVersion: 1,
  steps: [
    { kind: 'code-system', resource: { resourceType: 'CodeSystem', url: 'urn:test:cs', name: 'Colours' } },
    { kind: 'value-set', resource: { resourceType: 'ValueSet', url: 'urn:test:vs', name: 'Colour set' } },
    { kind: 'facility-register', url: 'urn:test:reg', name: 'Test register', code: 'TEST', csv: 'code,name\nA1,Alpha\nB2,Beta\n' },
    { kind: 'link-matching', registerUrl: 'urn:test:reg' },
    { kind: 'custom-queries', file: { format: 'openldr.custom-queries', version: 1, exportedAt: '2026-01-01T00:00:00Z', queries: [{ name: 'q one', sql: 'select 1', params: [] }] } },
  ],
};

interface Opts { pack?: unknown; steps?: unknown; ceVersion?: string }

async function buildPack(o: Opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pack-bundle-'));
  const kp = generatePublisherKeypair();
  const pack = o.pack ?? PACK;
  const steps = o.steps ?? summarizeContentPack(parseContentPack(PACK));
  const manifest = {
    schemaVersion: 1, type: 'content-pack', id: 'test-pack', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: o.ceVersion ?? '*' }, capabilities: [],
    payload: { kind: 'content-pack', packSha256: '0'.repeat(64), steps },
  };
  const outDir = join(dir, 'test-pack-1.0.0');
  await packBundle({ manifest, payload: new TextEncoder().encode(JSON.stringify(pack)), outDir, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
  return { bundle: await readBundle(outDir), kp, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function fakeInstallStore() {
  const rows = new Map<string, any>();
  const store = {
    upsert: vi.fn(async (r: any) => { rows.set(r.artifactId, { ...rows.get(r.artifactId), ...r }); }),
    get: vi.fn(async (id: string) => rows.get(id) ?? null),
    list: vi.fn(async () => [...rows.values()]),
    remove: vi.fn(async (id: string) => { rows.delete(id); }),
  };
  return { store, rows };
}

function fakeTrust() {
  const pins = new Map<string, { keyFingerprint: string }>();
  return {
    pins,
    store: {
      get: vi.fn(async (id: string) => pins.get(id)),
      pin: vi.fn(async (i: { publisherId: string; keyFingerprint: string }) => { pins.set(i.publisherId, { keyFingerprint: i.keyFingerprint }); }),
    },
  };
}

/** An empty install unless `items` says what the pack already made. Writes return fixed ids. */
function fakeProfile(items: Array<{ packId: string; kind: string; key: string; itemId: string }> = []) {
  const role = (id: string, slug: string) => ({ id, slug, name: slug, description: null, isSystem: false, locked: false, capabilities: [], memberCount: 0 });
  return {
    packItems: { list: vi.fn(async (packId: string) => items.filter((i) => i.packId === packId)), owners: vi.fn(async () => new Map()), put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
    roles: {
      get: vi.fn(async (id: string) => { const i = items.find((x) => x.kind === 'role' && x.itemId === id); return i ? role(id, i.key) : null; }),
      getBySlug: vi.fn(async () => null),
      create: vi.fn(async (input: { slug: string }) => role('r-new', input.slug)),
      update: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    },
    roleMembers: vi.fn(async () => []),
    layouts: {
      list: vi.fn(async () => ({ layouts: items.filter((i) => i.kind === 'layout').map((i) => ({ id: i.itemId, name: i.key, startPage: null, pages: ['/forms'], roles: [] })), roleOrder: [] })),
      save: vi.fn(async (id: string | null, input: { name: string }) => ({ id: id ?? 'l-new', name: input.name, startPage: null, pages: ['/forms'], roles: [] })),
      remove: vi.fn(async (id: string) => ({ id, name: id, startPage: null, pages: ['/forms'], roles: [] })),
    },
    forms: { install: vi.fn(async () => 'f-new'), check: vi.fn(), setAccess: vi.fn(async () => undefined) },
    installedVersion: vi.fn(async () => null),
    capabilityKeys: ['forms.view', 'roles.manage'],
  };
}

function setup(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const installs = fakeInstallStore();
  const trust = fakeTrust();
  const audit = { record: vi.fn(async (_e: any) => undefined) };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const deps = {
    installStore: installs.store, trustStore: trust.store, audit, logger, ceVersion: '0.1.9',
    loadResource: vi.fn(async (j: any) => { calls.push('loadResource'); return { resourceUrl: j.url }; }),
    checkResource: vi.fn(() => { calls.push('checkResource'); }),
    checkQueries: vi.fn(() => { calls.push('checkQueries'); }),
    importQueries: vi.fn(async () => {
      calls.push('importQueries');
      return { changes: [{ id: 'cq1', outcome: 'replaced' as const, before: { id: 'cq1', name: 'q one', sql: 'select 2' }, after: { id: 'cq1', name: 'q one', sql: 'select 1' } }] };
    }),
    register: vi.fn(async (i: any) => { calls.push(`register:${i.apply}`); return { ok: true as const }; }),
    linkMatching: vi.fn(async () => { calls.push('linkMatching'); return { ok: true as const, counts: { linked: 2 } }; }),
    previewLinkMatching: vi.fn(async () => { calls.push('previewLinkMatching'); return { ok: true as const, wouldLink: 2 }; }),
    planTestMappings: vi.fn(async (m: any[]) => { calls.push('planTestMappings'); return { mapped: m.slice(0, 1).map((x) => ({ ...x, catalogCode: 'VL' })), kept: [], skipped: m.slice(1).map((x) => ({ system: x.system, code: x.code, reason: 'no catalog test is linked to LOINC 9999-9' })) }; }),
    applyTestMappings: vi.fn(async (m: any[]) => { calls.push('applyTestMappings'); return { mapped: m.slice(0, 1).map((x) => ({ ...x, catalogCode: 'VL' })), kept: [], skipped: m.slice(1).map((x) => ({ system: x.system, code: x.code, reason: 'no catalog test is linked to LOINC 9999-9' })) }; }),
    checkDatasets: vi.fn(async () => { calls.push('checkDatasets'); }),
    installDatasets: vi.fn(async () => { calls.push('installDatasets'); }),
    profile: fakeProfile(),
    ...over,
  };
  const installer = createContentPackInstaller(deps as never);
  return { installer, deps, calls, installs, trust, audit, logger };
}

const events = (audit: { record: { mock: { calls: unknown[][] } } }) => audit.record.mock.calls.map((c) => c[0] as any);

const actor = { id: 'admin', name: 'admin' };
const WRITES = ['loadResource', 'register:true', 'linkMatching', 'importQueries', 'applyTestMappings', 'installDatasets'];

describe('createContentPackInstaller', () => {
  it('check returns the summary and calls no write dep', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup();
    const out = await s.installer.check(bundle);
    expect(out.steps.map((x) => x.kind)).toEqual(['code-system', 'value-set', 'facility-register', 'link-matching', 'custom-queries']);
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    expect(s.trust.store.pin).not.toHaveBeenCalled();
    await cleanup();
  });

  it('install runs the steps in file order and records the install', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup();
    const res = await s.installer.install(bundle, { actor });
    expect(res).toMatchObject({ id: 'test-pack', version: '1.0.0', status: 'installed' });
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual(['loadResource', 'loadResource', 'register:true', 'linkMatching', 'importQueries']);
    expect(s.deps.loadResource).toHaveBeenCalledWith(expect.anything(), 'test-pack@1.0.0');
    const row = s.installs.rows.get('test-pack');
    expect(row).toMatchObject({ kind: 'content-pack', status: 'installed', targetFormId: null, payloadSha256: bundle.payloadSha256 });
    expect(events(s.audit).map((e) => e.action)).toEqual([
      'term.import', 'term.import', 'facility.link-matching', 'customQuery.update', 'marketplace.install',
    ]);
    expect(events(s.audit).at(-1)).toMatchObject({ action: 'marketplace.install', metadata: { type: 'content-pack', steps: 5 } });
    expect(s.trust.store.pin).toHaveBeenCalledOnce();
    await cleanup();
  });

  it('installs a pack that needs >=0.1.9 on CE 0.1.9', async () => {
    const { bundle, cleanup } = await buildPack({ ceVersion: '>=0.1.9' });
    const s = setup();
    const res = await s.installer.install(bundle, { actor });
    expect(res).toMatchObject({ id: 'test-pack', status: 'installed' });
    await cleanup();
  });

  it('refuses a pack that needs >=99.0.0 before any write', async () => {
    const { bundle, cleanup } = await buildPack({ ceVersion: '>=99.0.0' });
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('test-pack@1.0.0 needs CE >=99.0.0; this is CE 0.1.9');
    await expect(s.installer.check(bundle)).rejects.toThrow('needs CE >=99.0.0');
    expect(s.calls).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    expect(s.trust.store.pin).not.toHaveBeenCalled();
    await cleanup();
  });

  it('a bad query fails before any write and records nothing', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup({ checkQueries: vi.fn(() => { throw new Error('bad sql'); }) });
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('bad sql');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    expect(s.trust.store.pin).not.toHaveBeenCalled();
    await cleanup();
  });

  it('passes a register step\'s extraColumns to the check and the write', async () => {
    const steps = PACK.steps.map((s) => (s.kind === 'facility-register' ? { ...s, extraColumns: ['province_code', 'district_code'] } : s));
    const pack = { ...PACK, steps };
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();
    await s.installer.install(bundle, { actor });
    const calls = (s.deps.register as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.map((c: any) => [c.apply, c.extraColumns])).toEqual([
      [false, ['province_code', 'district_code']],
      [true, ['province_code', 'district_code']],
    ]);
    await cleanup();
  });

  it('a register preview that refuses fails before any write', async () => {
    const { bundle, cleanup } = await buildPack();
    const register = vi.fn(async (i: any) => (i.apply ? { ok: true as const } : { ok: false as const, error: 'unrecognised column(s): x' }));
    const s = setup({ register });
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('unrecognised column(s): x');
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0].apply).toBe(false);
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    await cleanup();
  });

  it('refuses when pack.json does not match the signed hash', async () => {
    const { bundle, cleanup } = await buildPack();
    bundle.wasm = new TextEncoder().encode(JSON.stringify({ ...PACK, steps: PACK.steps.slice(0, 2) }));
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('pack.json does not match the signed hash');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });

  it('refuses when the step list does not match pack.json', async () => {
    const { bundle, cleanup } = await buildPack({ steps: [{ kind: 'code-system', label: 'Other', count: 1 }] });
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('step list does not match pack.json');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });

  it('refuses an unknown step kind before any write', async () => {
    const pack = { formatVersion: 1, steps: [{ kind: 'run-script', code: 'x' }] };
    const { bundle, cleanup } = await buildPack({ pack, steps: [{ kind: 'run-script', label: 'x', count: 1 }] });
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('this pack needs a newer CE');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });

  it('refuses a manifest that declares capabilities', async () => {
    const { bundle, cleanup } = await buildPack();
    (bundle.manifest as any).capabilities = [{ type: 'emit-fhir' }];
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('a content pack declares no capabilities');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });

  it('refuses a bundle that is not a content pack', async () => {
    const { bundle, cleanup } = await buildPack();
    (bundle.manifest as any).type = 'form-template';
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('not a content-pack');
    await cleanup();
  });

  it('records a failed step, keeps earlier steps, and a second install succeeds', async () => {
    const { bundle, cleanup } = await buildPack();
    const linkMatching = vi.fn();
    const s = setup({ linkMatching });
    linkMatching.mockImplementation(async () => { s.calls.push('linkMatching'); return { ok: false as const, error: 'boom' }; });
    const res = await s.installer.install(bundle, { actor });
    expect(res).toMatchObject({ status: 'failed', failedStep: 4, error: 'boom' });
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual(['loadResource', 'loadResource', 'register:true', 'linkMatching']);
    expect(s.installs.rows.get('test-pack')).toMatchObject({ status: 'failed', failedStep: 4, error: 'boom' });
    const installEvents = events(s.audit).filter((e) => e.action === 'marketplace.install');
    expect(installEvents).toHaveLength(1);
    expect(installEvents[0].metadata).toMatchObject({ type: 'content-pack', status: 'failed', steps: 5, failedStep: 4, error: 'boom' });
    expect(events(s.audit).some((e) => e.action === 'facility.link-matching')).toBe(false);

    linkMatching.mockImplementation(async () => { s.calls.push('linkMatching'); return { ok: true as const }; });
    const again = await s.installer.install(bundle, { actor });
    expect(again.status).toBe('installed');
    expect(s.installs.rows.get('test-pack')).toMatchObject({ status: 'installed', failedStep: null, error: null });
    await cleanup();
  });

  it('a thrown step error is recorded as a failed step', async () => {
    const { bundle, cleanup } = await buildPack();
    let n = 0;
    const loadResource = vi.fn(async (j: any) => { if (++n === 2) throw new Error('db down'); return { resourceUrl: j.url }; });
    const s = setup({ loadResource });
    const res = await s.installer.install(bundle, { actor });
    expect(res).toMatchObject({ status: 'failed', failedStep: 2, error: 'db down' });
    await cleanup();
  });

  it('refuses a pinned publisher that signs with a different key, and pins on first use', async () => {
    const first = await buildPack();
    const s = setup();
    await s.installer.install(first.bundle, { actor });
    expect(s.trust.pins.get('acme')).toBeDefined();
    const other = await buildPack();
    await expect(s.installer.install(other.bundle, { actor })).rejects.toThrow('publisher key does not match the pinned key');
    await first.cleanup(); await other.cleanup();
  });

  it('list returns only content-pack rows', async () => {
    const s = setup();
    await s.installs.store.upsert({ artifactId: 'f1', kind: 'form-template', version: '1', payloadSha256: 'x' });
    await s.installs.store.upsert({ artifactId: 'p1', kind: 'content-pack', version: '1', payloadSha256: 'y' });
    expect((await s.installer.list()).map((r) => r.artifactId)).toEqual(['p1']);
  });

  it('detach removes the row and audits', async () => {
    const s = setup();
    await s.installs.store.upsert({ artifactId: 'p1', kind: 'content-pack', version: '1', payloadSha256: 'y' });
    await s.installer.detach('p1', { actor });
    expect(s.installs.rows.has('p1')).toBe(false);
    expect(events(s.audit)[0]).toMatchObject({ action: 'marketplace.detach' });
  });

  it('refuses an unsigned pack before any write', async () => {
    const { bundle, cleanup } = await buildPack();
    delete (bundle.manifest as any).publisher;
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('a content pack must be signed by a publisher');
    await expect(s.installer.check(bundle)).rejects.toThrow('a content pack must be signed by a publisher');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    await cleanup();
  });

  it('audits each step with the pack actor, and a query update carries the SQL it overwrote', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup();
    await s.installer.install(bundle, { actor });
    const ev = events(s.audit);
    expect(ev.every((e) => e.actorId === 'admin' && e.actorName === 'admin')).toBe(true);
    expect(ev[0]).toMatchObject({ action: 'term.import', entityType: 'term', entityId: 'urn:test:cs', metadata: { source: 'content-pack', pack: 'test-pack@1.0.0', step: 1 } });
    expect(ev[1]).toMatchObject({ action: 'term.import', entityId: 'urn:test:vs', metadata: { step: 2 } });
    expect(ev[2]).toMatchObject({ action: 'facility.link-matching', entityId: 'facility-register:urn:test:reg', metadata: { registerUrl: 'urn:test:reg', counts: { linked: 2 }, step: 4 } });
    expect(ev[3]).toMatchObject({ action: 'customQuery.update', entityId: 'cq1', before: { sql: 'select 2' }, after: { sql: 'select 1' }, metadata: { step: 5 } });
    await cleanup();
  });

  it('a created query is audited with no before state', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup({ importQueries: vi.fn(async () => ({ changes: [{ id: 'cq9', outcome: 'created', before: null, after: { id: 'cq9' } }] })) });
    await s.installer.install(bundle, { actor });
    expect(events(s.audit).find((e) => e.entityId === 'cq9')).toMatchObject({ action: 'customQuery.create', before: null, after: { id: 'cq9' } });
    await cleanup();
  });

  it('a failing audit store does not fail a step that already wrote', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup();
    s.audit.record.mockImplementation(async () => { throw new Error('audit down'); });
    const res = await s.installer.install(bundle, { actor });
    expect(res.status).toBe('installed');
    expect(s.installs.rows.get('test-pack')).toMatchObject({ status: 'installed' });
    expect(s.logger.error).toHaveBeenCalled();
    await cleanup();
  });

  it('masks a secret in a step error before it reaches the row and the audit', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup({ loadResource: vi.fn(async () => { throw new Error('connect postgres://ops:hunter2@db:5432/x failed'); }) });
    const res = await s.installer.install(bundle, { actor });
    expect(res.error).toBe('connect postgres://ops:***@db:5432/x failed');
    expect(s.installs.rows.get('test-pack').error).not.toContain('hunter2');
    expect(JSON.stringify(events(s.audit))).not.toContain('hunter2');
    await cleanup();
  });

  it('check previews link-matching and returns what it would link', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup();
    const out = await s.installer.check(bundle);
    expect(out.linkPreview).toEqual([{ registerUrl: 'urn:test:reg', wouldLink: 2 }]);
    expect(s.calls).toContain('previewLinkMatching');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });

  it('a register this pack creates has no count yet', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup({ previewLinkMatching: vi.fn(async () => ({ ok: false, reason: 'unknown-register', error: 'unknown register' })) });
    const out = await s.installer.check(bundle);
    expect(out.linkPreview).toEqual([{ registerUrl: 'urn:test:reg', wouldLink: null }]);
    await cleanup();
  });

  it('a test-mappings step plans in check, writes in install, and audits the counts', async () => {
    const pack = { formatVersion: 1, steps: [{ kind: 'test-mappings', mappings: [
      { system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8' },
      { system: 'urn:openldr:disa', code: 'WW', loinc: '9999-9' },
    ] }] };
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();

    const checked = await s.installer.check(bundle);
    expect(checked.testMapPreview).toEqual([{
      level: 'test',
      mapped: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8', catalogCode: 'VL' }],
      kept: [],
      skipped: [{ system: 'urn:openldr:disa', code: 'WW', reason: 'no catalog test is linked to LOINC 9999-9' }],
    }]);
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);

    const res = await s.installer.install(bundle, { actor });
    expect(res.status).toBe('installed');
    expect(events(s.audit).find((e) => e.action === 'test_mapping.pack')).toMatchObject({
      entityType: 'test_mapping',
      metadata: {
        level: 'test',
        mapped: [{ system: 'urn:openldr:disa', code: 'HIVVL', catalogCode: 'VL' }], kept: [], skipped: [{ code: 'WW' }],
        mappedCount: 1, keptCount: 0, skippedCount: 1,
      },
    });
    await cleanup();
  });

  it('a result-mappings step plans and writes at the result level', async () => {
    const pack = { formatVersion: 1, steps: [{ kind: 'result-mappings', mappings: [
      { system: 'urn:openldr:disa', code: 'HIVVL', loinc: '20447-9' },
    ] }] };
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();

    const checked = await s.installer.check(bundle);
    expect(checked.testMapPreview.map((p) => p.level)).toEqual(['result']);
    expect(s.deps.planTestMappings).toHaveBeenLastCalledWith(pack.steps[0].mappings, 'result');

    await s.installer.install(bundle, { actor });
    expect(s.deps.applyTestMappings).toHaveBeenLastCalledWith(pack.steps[0].mappings, 'result');
    expect(events(s.audit).find((e) => e.action === 'test_mapping.pack')).toMatchObject({ metadata: { level: 'result' } });
    await cleanup();
  });

  it('a deactivated register fails pass 1 before any write', async () => {
    const { bundle, cleanup } = await buildPack();
    const s = setup({ previewLinkMatching: vi.fn(async () => ({ ok: false, reason: 'deactivated-register', error: 'register is deactivated' })) });
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('register is deactivated');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    await cleanup();
  });

  it('a link step whose register is neither installed nor in the pack fails pass 1', async () => {
    const pack = { formatVersion: 1, steps: [{ kind: 'link-matching', registerUrl: 'urn:test:other' }] };
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup({ previewLinkMatching: vi.fn(async () => ({ ok: false, reason: 'unknown-register', error: 'unknown register' })) });
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('unknown register');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });
});

describe('content pack installer: datasets (pack datasets design)', () => {
  const tables = [{ name: 'zm_request_times', sql: 'select 1 as a', indexes: [['a']] }, { name: 'zm_other', sql: 'select 2 as b' }];
  const pack = { formatVersion: 1, steps: [{ kind: 'datasets', tables }, PACK.steps[4]] };
  const build = () => buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });

  it('check_checks_the_datasets_under_the_packs_id_and_builds_nothing', async () => {
    const { bundle, cleanup } = await build();
    const s = setup();
    const out = await s.installer.check(bundle);
    expect(out.steps[0]).toEqual({ kind: 'datasets', label: 'zm_request_times, zm_other', count: 2 });
    expect(s.deps.checkDatasets).toHaveBeenCalledWith('test-pack', tables);
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    await cleanup();
  });

  it('a_dataset_that_fails_its_check_stops_the_install_before_any_write', async () => {
    const { bundle, cleanup } = await build();
    const s = setup({ checkDatasets: vi.fn(async () => { throw new Error('dataset zm_other: only one SELECT statement is allowed'); }) });
    await expect(s.installer.install(bundle, { actor })).rejects.toThrow('dataset zm_other');
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual([]);
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    await cleanup();
  });

  it('install_builds_the_datasets_before_the_queries_and_audits_them', async () => {
    const { bundle, cleanup } = await build();
    const s = setup();
    const out = await s.installer.install(bundle, { actor });
    expect(out.status).toBe('installed');
    expect(s.deps.installDatasets).toHaveBeenCalledWith('test-pack', tables);
    expect(s.calls.filter((c) => WRITES.includes(c))).toEqual(['installDatasets', 'importQueries']);
    const e = events(s.audit).find((x) => x.action === 'dataset.install');
    expect(e).toMatchObject({
      actorName: 'admin', entityType: 'dataset', entityId: 'test-pack',
      metadata: { source: 'content-pack', pack: 'test-pack@1.0.0', step: 1, names: ['zm_request_times', 'zm_other'] },
    });
    await cleanup();
  });

  it('a_dataset_that_fails_to_build_fails_the_install_at_that_step', async () => {
    const { bundle, cleanup } = await build();
    const s = setup({ installDatasets: vi.fn(async () => { throw new Error('dataset zm_other: relation "nope" does not exist'); }) });
    const out = await s.installer.install(bundle, { actor });
    expect(out).toMatchObject({ status: 'failed', failedStep: 1, error: 'dataset zm_other: relation "nope" does not exist' });
    expect(s.calls).not.toContain('importQueries');
    expect(events(s.audit).some((x) => x.action === 'dataset.install')).toBe(false);
    await cleanup();
  });
});

describe('content pack installer: a pack\'s queries sit in a group named for the pack', () => {
  it('gives_a_query_with_no_group_the_packs_id_and_keeps_a_group_the_pack_names', async () => {
    const queries = [{ name: 'plain', sql: 'select 1', params: [] }, { name: 'placed', sql: 'select 2', params: [], group: 'Viral load' }];
    const pack = { formatVersion: 1, steps: [{ kind: 'custom-queries', file: { format: 'openldr.custom-queries', version: 1, exportedAt: '2026-01-01T00:00:00Z', queries } }] };
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();
    await s.installer.install(bundle, { actor });
    const file = (s.deps.importQueries as any).mock.calls[0][0];
    expect(file.queries.map((q: any) => [q.name, q.group])).toEqual([['plain', 'test-pack'], ['placed', 'Viral load']]);
    // The check reads the pack's own file, unchanged.
    expect((s.deps.checkQueries as any).mock.calls[0][0].queries[0].group).toBeUndefined();
    await cleanup();
  });
});


describe('content pack installer: the check phase covers the profile steps', () => {
  const pack = { formatVersion: 1, steps: [{ kind: 'role', slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view'] }] };

  it('refuses_a_role_step_from_an_installer_without_roles_manage_before_any_write', async () => {
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();
    await expect(s.installer.install(bundle, { actor: { ...actor, capabilities: ['marketplace.manage', 'forms.view'] } }))
      .rejects.toThrow('installing this pack needs the roles.manage capability');
    expect(s.installs.store.upsert).not.toHaveBeenCalled();
    expect(s.trust.store.pin).not.toHaveBeenCalled();
    await cleanup();
  });

  it('check_and_an_install_with_no_capabilities_given_treat_the_installer_as_holding_all', async () => {
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();
    await expect(s.installer.check(bundle)).resolves.toMatchObject({ steps: [{ kind: 'role' }] });
    await expect(s.installer.install(bundle, { actor })).resolves.toMatchObject({ status: 'installed' });
    expect(s.deps.profile.roles.getBySlug).toHaveBeenCalledWith('sample-clerk');
    await cleanup();
  });
});

describe('content pack installer: the write phase of the profile steps', () => {
  const pack = {
    formatVersion: 1,
    steps: [
      { kind: 'role', slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view'] },
      { kind: 'form', key: 'lab-request', questionnaire: { resourceType: 'Questionnaire' }, open: ['sample-clerk'], submit: [] },
    ],
  };
  const owned = [
    { packId: 'test-pack', kind: 'role', key: 'old-clerk', itemId: 'r-old' },
    { packId: 'test-pack', kind: 'layout', key: 'old-layout', itemId: 'l-old' },
    { packId: 'test-pack', kind: 'form', key: 'old-form', itemId: 'f-old' },
  ];

  it('audits each profile step with the pack source', async () => {
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup();
    await expect(s.installer.install(bundle, { actor })).resolves.toMatchObject({ status: 'installed' });
    const rows = events(s.audit).filter((e) => e.action !== 'marketplace.install');
    expect(rows).toEqual([
      expect.objectContaining({ action: 'role.create', entityType: 'role', entityId: 'r-new', actorId: 'admin', metadata: { source: 'content-pack', pack: 'test-pack@1.0.0', step: 1 } }),
      expect.objectContaining({ action: 'form.install', entityType: 'form', entityId: 'f-new', metadata: { source: 'content-pack', pack: 'test-pack@1.0.0', step: 2 } }),
    ]);
    expect(s.deps.profile.forms.install).toHaveBeenCalledWith(null, { resourceType: 'Questionnaire' }, '1.0.0', 'admin');
    await cleanup();
  });

  it('after every step wrote, removes the role and layout the pack no longer carries and audits it', async () => {
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const s = setup({ profile: fakeProfile(owned) });
    await expect(s.installer.install(bundle, { actor })).resolves.toMatchObject({ status: 'installed' });
    expect(s.deps.profile.roles.remove).toHaveBeenCalledWith('r-old');
    expect(s.deps.profile.layouts.remove).toHaveBeenCalledWith('l-old');
    expect(s.deps.profile.packItems.remove).toHaveBeenCalledWith('test-pack', 'form', 'old-form');
    const rows = events(s.audit).filter((e) => e.action.endsWith('.delete'));
    expect(rows).toEqual([
      expect.objectContaining({ action: 'role.delete', entityType: 'role', entityId: 'old-clerk', metadata: { source: 'content-pack', pack: 'test-pack@1.0.0' } }),
      expect.objectContaining({ action: 'layout.delete', entityType: 'layout', entityId: 'old-layout', metadata: { source: 'content-pack', pack: 'test-pack@1.0.0' } }),
    ]);
    await cleanup();
  });

  it('a failed step removes nothing the pack owns', async () => {
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const profile = fakeProfile(owned);
    profile.forms.install.mockRejectedValueOnce(new Error('the form store is down'));
    const s = setup({ profile });
    await expect(s.installer.install(bundle, { actor })).resolves.toMatchObject({ status: 'failed', failedStep: 2, error: 'the form store is down' });
    expect(profile.roles.remove).not.toHaveBeenCalled();
    expect(profile.layouts.remove).not.toHaveBeenCalled();
    expect(profile.packItems.remove).not.toHaveBeenCalled();
    await cleanup();
  });

  it('a removal that throws marks the install failed', async () => {
    const { bundle, cleanup } = await buildPack({ pack, steps: summarizeContentPack(parseContentPack(pack)) });
    const profile = fakeProfile(owned);
    profile.roles.remove.mockRejectedValueOnce(new Error('cannot delete the last role granting roles.manage'));
    const s = setup({ profile });
    await expect(s.installer.install(bundle, { actor })).resolves.toMatchObject({ status: 'failed', error: 'cannot delete the last role granting roles.manage' });
    expect(s.installs.store.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', failedStep: null }));
    await cleanup();
  });
});
