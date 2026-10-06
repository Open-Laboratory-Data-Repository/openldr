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

interface Opts { pack?: unknown; steps?: unknown }

async function buildPack(o: Opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pack-bundle-'));
  const kp = generatePublisherKeypair();
  const pack = o.pack ?? PACK;
  const steps = o.steps ?? summarizeContentPack(parseContentPack(PACK));
  const manifest = {
    schemaVersion: 1, type: 'content-pack', id: 'test-pack', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' }, capabilities: [],
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

function setup(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const installs = fakeInstallStore();
  const trust = fakeTrust();
  const audit = { record: vi.fn(async () => undefined) };
  const deps = {
    installStore: installs.store, trustStore: trust.store, audit,
    loadResource: vi.fn(async (j: any) => { calls.push('loadResource'); return { resourceUrl: j.url }; }),
    checkResource: vi.fn(() => { calls.push('checkResource'); }),
    checkQueries: vi.fn(() => { calls.push('checkQueries'); }),
    importQueries: vi.fn(async () => { calls.push('importQueries'); return {}; }),
    register: vi.fn(async (i: any) => { calls.push(`register:${i.apply}`); return { ok: true as const }; }),
    linkMatching: vi.fn(async () => { calls.push('linkMatching'); return { ok: true as const }; }),
    ...over,
  };
  const installer = createContentPackInstaller(deps as never);
  return { installer, deps, calls, installs, trust, audit };
}

const actor = { id: 'admin', name: 'admin' };
const WRITES = ['loadResource', 'register:true', 'linkMatching', 'importQueries'];

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
    const row = s.installs.rows.get('test-pack');
    expect(row).toMatchObject({ kind: 'content-pack', status: 'installed', targetFormId: null, payloadSha256: bundle.payloadSha256 });
    expect(s.audit.record).toHaveBeenCalledOnce();
    expect((s.audit.record.mock.calls[0] as any)[0]).toMatchObject({ action: 'marketplace.install', metadata: { type: 'content-pack', steps: 5 } });
    expect(s.trust.store.pin).toHaveBeenCalledOnce();
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
    expect(s.audit.record).toHaveBeenCalledOnce();
    expect((s.audit.record.mock.calls[0] as any)[0].metadata).toMatchObject({ type: 'content-pack', status: 'failed', steps: 5, failedStep: 4, error: 'boom' });

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
    expect((s.audit.record.mock.calls[0] as any)[0]).toMatchObject({ action: 'marketplace.detach' });
  });
});
