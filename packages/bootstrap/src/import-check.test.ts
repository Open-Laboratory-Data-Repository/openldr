import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CopySetTooLargeError, createImportCheckHeldStore, createImportCopyStore, createPluginDataStore,
  type CopyRow, type ImportCheckHeldStore, type ImportCopyStore, type PluginDataStore,
} from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { STALE_MS, type ImportActor, type ImportAuditEvent } from './import-run';
import { copyIdOf, createImportCopyService, type CopyRun, type ImportCopyService } from './import-copy';
import { checkIdOf, createImportCheckService, type CheckRun, type ImportCheckService } from './import-check';

// Layer under test: the check service over the real plugin_data store, the real copy row store and
// the real held store on pg-mem, with the real copy service for reading and removing a copy. The
// plugin (wasm), CE's save path and the clock are fakes. Copies are written straight to the store,
// as a finished copy would leave them. Two services on one database stand for two processes.
// Not covered here: real wasm and its timeout, real Postgres (jsonb, key order, a full disk), a
// real FHIR save.

const ADMIN: ImportActor = { type: 'user', id: 'u-admin', name: 'admin' };
const PLUGIN = 'v1-import';
const OTHER = 'other-plugin';
const SRC = copyIdOf(PLUGIN, 'c1');
const REF = copyIdOf(PLUGIN, 'c2');
const CHECK = checkIdOf(SRC);
const SECRET = 'Maria Santos';
const CAP = 64 * 1024 * 1024;

type Row = Record<string, unknown>;
type Group = { key: string; held?: boolean; findings?: unknown; check?: unknown; resources?: unknown[]; error?: string; label?: string };
interface DecodeInput {
  options: Record<string, string>; now: string; dictionaries: Record<string, Row[]>; keys: string[];
  rows: Record<string, Row[]>; twins: Record<string, Row[]>;
}

const keysOf = (n: number, prefix = 'REQ') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(4, '0')}`);
const reqRow = (k: string): Row => ({ RequestID: k, Patient: SECRET });
const resRows = (k: string): Row[] => [{ RequestID: k, Value: 4.2 }, { RequestID: k, Value: 5.1 }];
const requestRows = (keys: string[]): CopyRow[] => keys.flatMap((k) => [
  { detail: 'requests', key: k, seq: 0, row: reqRow(k) },
  ...resRows(k).map((row, seq) => ({ detail: 'results', key: k, seq, row })),
]);
const FACILITIES: CopyRow[] = [
  { detail: 'facilities', key: 'F1', seq: 0, row: { FacilityCode: 'F1', Name: 'Clinic One' } },
  { detail: 'facilities', key: 'F2', seq: 0, row: { FacilityCode: 'F2', Name: 'Clinic Two' } },
];
const pass = (key: string): Group => ({ key, resources: [{ resourceType: 'ServiceRequest', id: key }], label: 'passed' });

function manifest(entrypoints: Record<string, string>, id = PLUGIN) {
  return {
    schemaVersion: 1, type: 'plugin', id, version: '1.2.0',
    capabilities: [{ kind: 'host:import' }, { kind: 'emit-fhir', resourceTypes: ['ServiceRequest', 'Patient'] }],
    payload: {
      kind: 'plugin', entrypoints: Object.values(entrypoints),
      importSource: { connectorTypes: ['microsoft-sql'], sourceSystem: 'openldr-v1', entrypoints },
    },
  };
}
const CHECKER = { copy: 'import_copy', decode: 'import_decode', twinKeys: 'import_twin_keys' };

let internalDb: Awaited<ReturnType<typeof makeMigratedDb>>;

async function world(opts: { entrypoints?: Record<string, string> } = {}) {
  const raw = createPluginDataStore(internalDb);
  const plainCheckPuts: string[] = [];
  const runSaves: CheckRun[] = [];
  const pluginData: PluginDataStore = {
    ...raw,
    async put(pluginId, collection, key, doc) {
      if (collection === '__import-checks') plainCheckPuts.push(key);
      return raw.put(pluginId, collection, key, doc);
    },
    async putIfRev(pluginId, collection, key, doc, expectedRev) {
      const wrote = await raw.putIfRev(pluginId, collection, key, doc, expectedRev);
      if (wrote && collection === '__import-checks') runSaves.push(structuredClone(doc) as CheckRun);
      return wrote;
    },
  };
  const realCopyStore = createImportCopyStore(internalDb);
  const readSetCalls: Array<{ set: string; maxBytes: number }> = [];
  let readSetFault: ((set: string, maxBytes: number) => unknown) | null = null;
  const copyStore: ImportCopyStore = {
    ...realCopyStore,
    async readSet(copyId, setName, maxBytes) {
      readSetCalls.push({ set: setName, maxBytes });
      if (readSetFault) throw readSetFault(setName, maxBytes);
      return realCopyStore.readSet(copyId, setName, maxBytes);
    },
  };
  const realHeld = createImportCheckHeldStore(internalDb);
  let heldPutFaults = 0;
  const held: ImportCheckHeldStore = {
    ...realHeld,
    async put(item) {
      if (heldPutFaults > 0) {
        heldPutFaults -= 1;
        // What Postgres says on a full disk. Its detail field quotes the row.
        throw Object.assign(new Error('could not extend file: No space left on device'), { code: '53100', detail: `Failing row contains (${SECRET})` });
      }
      return realHeld.put(item);
    },
  };
  const audited: ImportAuditEvent[] = [];
  const audit = async (e: ImportAuditEvent) => { audited.push(structuredClone(e)); };
  const plugins: Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }> = [
    { id: PLUGIN, version: '1.2.0', enabled: true, manifest: manifest(opts.entrypoints ?? CHECKER) },
    { id: OTHER, version: '1.0.0', enabled: true, manifest: manifest({ copy: 'import_copy' }, OTHER) },
  ];
  const decodeCalls: DecodeInput[] = [];
  const twinCalls: Array<{ options: Record<string, string>; keys: string[] }> = [];
  let decodeFn: (input: DecodeInput) => unknown = (input) => ({ groups: input.keys.map(pass) });
  let twinFn: (keys: string[]) => unknown = (keys) => ({ keys: keys.map((k) => `T-${k}`) });
  const invoke = vi.fn(async (entrypoint: string, input: unknown) => {
    if (entrypoint === 'import_decode') {
      const i = structuredClone(input) as DecodeInput;
      decodeCalls.push(i);
      return decodeFn(i);
    }
    if (entrypoint === 'import_twin_keys') {
      const i = input as { options: Record<string, string>; keys: string[] };
      twinCalls.push(structuredClone(i));
      return twinFn(i.keys);
    }
    throw new Error(`no entrypoint ${entrypoint}`);
  });
  const pluginsDep = { list: async () => plugins, loadSink: async () => ({ invoke }) };
  const persisted: Array<{ resources: unknown[]; batchId: string }> = [];
  let persistFault: ((resources: unknown[]) => unknown) | null = null;
  const persist = async (resources: unknown[], provenance: { batchId: string }) => {
    const fault = persistFault?.(resources);
    if (fault) throw fault;
    persisted.push({ resources, batchId: provenance.batchId });
    return [];
  };
  const clock = { now: Date.UTC(2026, 10, 16, 12, 0, 0) };
  const sleeps: number[] = [];
  const connectors = { get: async () => null, getDecryptedConfig: async () => ({}) };

  let checksRef: ImportCheckService | null = null;
  const copies: ImportCopyService = createImportCopyService({
    plugins: pluginsDep, connectors, secretsKey: 'k', pluginData, audit, store: realCopyStore,
    allowed: async () => [], driverId: 'server-1', now: () => new Date(clock.now),
    checks: {
      statusOf: async (pluginId, copyId) => (await checksRef!.get(pluginId, checkIdOf(copyId)))?.status ?? null,
      deleteHeld: (copyId, limit) => realHeld.deleteSome(copyId, limit),
    },
  });
  const service = (driverId = 'server-1'): ImportCheckService => createImportCheckService({
    plugins: pluginsDep, pluginData, audit, persist, copyStore, held, copies, driverId,
    now: () => new Date(clock.now),
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const svc = service();
  checksRef = svc;
  worlds.push({ plainCheckPuts });

  /** Write a copy as a finished one leaves it: its record and its rows. */
  async function seedCopy(copyId: string, connectorId: string, status: CopyRun['status'], sets: Record<string, CopyRow[]>, pluginId = PLUGIN) {
    const at = new Date(clock.now).toISOString();
    const setOrder = Object.keys(sets);
    const run: CopyRun = {
      id: copyId, kind: 'copy', rev: 1, pluginId, pluginVersion: '1.2.0', connectorId, status, options: {}, pageSize: 500,
      sets: Object.fromEntries(setOrder.map((n) => [n, { cursor: null, keys: 0, rows: sets[n].length, bytes: 0, skipped: 0, done: true }])),
      setOrder, setSql: {}, waiting: null, driver: null, startedAt: at, updatedAt: at, finishedAt: at, lastError: null, startedBy: 'admin',
    };
    await raw.put(pluginId, '__import-copies', copyId, run);
    for (const [name, rows] of Object.entries(sets)) {
      await realCopyStore.replaceKeys(copyId, name, [...new Set(rows.map((r) => r.key))], rows);
    }
  }
  const setCopyStatus = async (copyId: string, status: CopyRun['status']) => {
    const run = (await raw.get(PLUGIN, '__import-copies', copyId)) as CopyRun;
    await raw.put(PLUGIN, '__import-copies', copyId, { ...run, status, rev: run.rev + 1 });
  };

  return {
    svc, service, copies, raw, audited, runSaves, decodeCalls, twinCalls, invoke, persisted, clock, sleeps, plugins,
    readSetCalls, realHeld, seedCopy, setCopyStatus,
    setDecode: (fn: (input: DecodeInput) => unknown) => { decodeFn = fn; },
    setTwinKeys: (fn: (keys: string[]) => unknown) => { twinFn = fn; },
    failPersist: (fn: ((resources: unknown[]) => unknown) | null) => { persistFault = fn; },
    failReadSet: (fn: ((set: string, maxBytes: number) => unknown) | null) => { readSetFault = fn; },
    failHeldPuts: (n: number) => { heldPutFaults = n; },
    stored: async () => (await raw.get(PLUGIN, '__import-checks', CHECK)) as CheckRun | null,
    heldAll: async () => realHeld.list(SRC, { offset: 0, limit: 1000 }),
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** A source copy of `n` requests and one dictionary, completed. */
async function sourceCopy(w: World, keys: string[]) {
  await w.seedCopy(SRC, 'c1', 'completed', { requests: requestRows(keys), facilities: FACILITIES });
}
const START = { pluginId: PLUGIN, copyId: SRC, referenceCopyId: null, options: { site: 'A' }, actor: ADMIN };
async function drive(svc: ImportCheckService) {
  await svc.tick();
  await svc.idle();
}
const actions = (w: World) => w.audited.map((e) => e.action).filter((a) => a.startsWith('import.check.'));

let worlds: Array<{ plainCheckPuts: string[] }> = [];
beforeEach(async () => { internalDb = await makeMigratedDb(); worlds = []; });
afterEach(async () => {
  await internalDb.destroy();
  // A check record is written only by compare-and-swap.
  for (const w of worlds) expect(w.plainCheckPuts).toEqual([]);
});

describe('check: starting', () => {
  it('start_is_refused_until_the_copy_is_completed', async () => {
    const w = await world();
    await expect(w.svc.start(START)).rejects.toThrow(`copy ${SRC} not found`);
    await w.seedCopy(SRC, 'c1', 'running', { requests: requestRows(keysOf(2)) });
    await expect(w.svc.start(START)).rejects.toThrow(`copy ${SRC} is running; a check needs a completed copy`);
    await w.setCopyStatus(SRC, 'completed');

    // The reference: another completed copy of the same plugin.
    await expect(w.svc.start({ ...START, referenceCopyId: SRC })).rejects.toThrow(/reference copy must be another copy/);
    await expect(w.svc.start({ ...START, referenceCopyId: REF })).rejects.toThrow(`copy ${REF} not found`);
    await w.seedCopy(REF, 'c2', 'failed', { twins: [] });
    await expect(w.svc.start({ ...START, referenceCopyId: REF })).rejects.toThrow(`copy ${REF} is failed; a check needs a completed copy`);
    // A copy of another plugin is not reachable by this one.
    const foreign = copyIdOf(OTHER, 'c9');
    await w.seedCopy(foreign, 'c9', 'completed', { twins: [] }, OTHER);
    await expect(w.svc.start({ ...START, referenceCopyId: foreign })).rejects.toThrow(`copy ${foreign} not found`);
    // A plugin that cannot be checked.
    await w.seedCopy(foreign, 'c9', 'completed', { requests: [] }, OTHER);
    await expect(w.svc.start({ ...START, pluginId: OTHER, copyId: foreign })).rejects.toThrow(/cannot be checked/);
    // Bad settings.
    await expect(w.svc.start({ ...START, pageSize: 0 })).rejects.toThrow(/page size must be a whole number from 1 to 2000/);
    await expect(w.svc.start({ ...START, pageSize: 2001 })).rejects.toThrow(/page size/);
    await expect(w.svc.start({ ...START, options: { 'bad name': 'x' } })).rejects.toThrow(/invalid option/);
    expect(w.audited).toEqual([]);

    const run = await w.svc.start(START);
    expect(run).toMatchObject({
      id: CHECK, kind: 'check', rev: 1, pluginId: PLUGIN, pluginVersion: '1.2.0', copyId: SRC, referenceCopyId: null,
      status: 'queued', options: { site: 'A' }, pageSize: 500, cursor: null,
      counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} },
      waiting: null, driver: null, finishedAt: null, lastError: null, startedBy: 'admin',
    });
    expect(CHECK).toMatch(/^[0-9a-f]{32}$/);
    expect(w.audited.at(-1)).toEqual({
      action: 'import.check.start', pluginId: PLUGIN, runId: CHECK, actor: ADMIN,
      metadata: { copyId: SRC, referenceCopyId: null, pageSize: 500 },
    });
    expect(await w.svc.checkers()).toEqual([{ id: PLUGIN, version: '1.2.0', needsReference: true }]);
  });
});

describe('check: one page', () => {
  it('a_passing_request_is_saved_and_a_held_one_is_kept', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(3));
    const findings = [{ level: 'error', code: 'specimen_missing', value: SECRET }];
    const check = { fields: [{ name: 'panel', source: 'FBC', reference: 'FBCD' }] };
    w.setDecode((input) => ({
      groups: [
        pass(input.keys[0]),
        { key: input.keys[1], held: true, findings, check, label: 'held_by_check', resources: [{ resourceType: 'ServiceRequest' }] },
        // Held with no findings and no check: they are kept as null.
        { key: input.keys[2], held: true, label: 'held_by_rules' },
      ],
    }));
    await w.svc.start({ ...START, options: { site: 'A', tz: '+03:00' } });
    await drive(w.svc);

    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({
      status: 'completed', cursor: 'REQ0003', driver: null, waiting: null, lastError: null,
      counts: { read: 3, saved: 1, held: 2, failed: 0, resources: 1, labels: { passed: 1, held_by_check: 1, held_by_rules: 1 } },
    });
    expect(run.finishedAt).not.toBeNull();
    // Only the passing request is saved, through CE's save path, as part of this run's batch.
    expect(w.persisted).toEqual([{ resources: [{ resourceType: 'ServiceRequest', id: 'REQ0001' }], batchId: CHECK }]);

    // What the plugin was handed.
    expect(w.decodeCalls).toHaveLength(1);
    expect(w.decodeCalls[0]).toEqual({
      options: { site: 'A', tz: '+03:00' }, now: new Date(w.clock.now).toISOString(), keys: keysOf(3),
      dictionaries: { facilities: FACILITIES.map((r) => r.row) },
      rows: { requests: keysOf(3).map(reqRow), results: keysOf(3).flatMap(resRows) },
      twins: { requests: [], results: [] },
    });

    const list = await w.svc.held(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(list.total).toBe(2);
    expect(list.rows.map((r) => [r.key, r.reason, r.label, r.error, r.runId])).toEqual([
      ['REQ0002', 'held', 'held_by_check', null, CHECK],
      ['REQ0003', 'held', 'held_by_rules', null, CHECK],
    ]);
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0002')).toMatchObject({ key: 'REQ0002', findings, check });
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0003')).toMatchObject({ key: 'REQ0003', findings: null, check: null });
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toBeNull();
    expect((await w.svc.held(PLUGIN, SRC, { label: 'held_by_rules', offset: 0, limit: 10 })).rows.map((r) => r.key)).toEqual(['REQ0003']);
    // Another plugin cannot read this copy's held rows.
    await expect(w.svc.held(OTHER, SRC, { offset: 0, limit: 10 })).rejects.toThrow(`copy ${SRC} not found`);
    await expect(w.svc.heldItem(OTHER, SRC, 'REQ0002')).rejects.toThrow(`copy ${SRC} not found`);

    expect(actions(w)).toEqual(['import.check.start', 'import.check.finish']);
    expect(w.audited.at(-1)).toEqual({
      action: 'import.check.finish', pluginId: PLUGIN, runId: CHECK, actor: { type: 'system', id: null, name: 'system' },
      metadata: { status: 'completed', copyId: SRC, read: 3, saved: 1, held: 2, failed: 0, resources: 1 },
    });
  });

  it('a_plugin_error_is_kept_as_a_bare_code', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    w.setDecode((input) => ({
      groups: [
        { key: input.keys[0], error: 'BAD_DATE', label: 'passed' },
        { key: input.keys[1], error: `patient ${SECRET} has no date` },
        // No group for the third key.
        { key: input.keys[3], resources: [{ resourceType: 'Observation' }] },
        { key: input.keys[4], resources: [] },
        pass(input.keys[5]),
      ],
    }));
    // The sixth key's save fails, with a message that quotes the row.
    w.failPersist((resources) => ((resources[0] as { id?: string }).id === 'REQ0006'
      ? Object.assign(new Error(`duplicate key for ${SECRET}`), { code: '23505' }) : null));
    await w.svc.start(START);
    await drive(w.svc);

    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({ status: 'completed', counts: { read: 6, saved: 0, held: 0, failed: 6, resources: 0 } });
    const list = await w.svc.held(PLUGIN, SRC, { reason: 'error', offset: 0, limit: 10 });
    expect(list.rows.map((r) => [r.key, r.reason, r.error, r.label])).toEqual([
      ['REQ0001', 'error', 'BAD_DATE', 'passed'],
      ['REQ0002', 'error', 'MAPPING_FAILED', null],
      ['REQ0003', 'error', 'NO_GROUP', null],
      ['REQ0004', 'error', 'RESOURCE_TYPE_NOT_ALLOWED', null],
      ['REQ0005', 'error', 'NO_RESOURCES', null],
      ['REQ0006', 'error', 'SAVE_FAILED', 'passed'],
    ]);
    expect(JSON.stringify([run, w.audited, list])).not.toContain('Maria');
  });

  it('a_decode_call_that_throws_saves_nothing_and_halves_the_page', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(14));
    let calls = 0;
    w.setDecode((input) => {
      calls += 1;
      // The first call throws as the runtime does on a timeout; the groups it would have given are never seen.
      if (calls === 1) throw new Error(`plugin timed out after 30000ms near ${SECRET}`);
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    // Halved to 2 and read again from the same cursor. After 5 good pages it doubles back to 4.
    expect(w.decodeCalls.map((c) => c.keys)).toEqual([
      keysOf(4), keysOf(2), keysOf(4).slice(2), keysOf(6).slice(4), keysOf(8).slice(6), keysOf(10).slice(8), keysOf(14).slice(10),
    ]);
    // Nothing of the failed call was saved: each key is saved once.
    expect(w.persisted.map((p) => (p.resources[0] as { id: string }).id)).toEqual(keysOf(14));
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { read: 14, saved: 14, failed: 0 }, lastError: null });
    // A decode that returns what is not a list of groups is treated the same way.
    const v = await world();
    await internalDb.deleteFrom('import_copy_rows').execute();
    await sourceCopy(v, keysOf(2));
    let bad = true;
    v.setDecode((input) => {
      if (bad) { bad = false; return { groups: 'nope' }; }
      return { groups: input.keys.map(pass) };
    });
    await v.svc.start({ ...START, pageSize: 2 });
    await drive(v.svc);
    expect(v.decodeCalls.map((c) => c.keys.length)).toEqual([2, 1, 1]);
  });

  it('one_request_that_cannot_be_decoded_is_held_as_DECODE_FAILED', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    w.setDecode((input) => {
      if (input.keys.includes('REQ0002')) throw new Error(`panic on ${SECRET}`);
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    expect(w.decodeCalls.map((c) => c.keys)).toEqual([
      keysOf(4), keysOf(2), ['REQ0001'], ['REQ0002'], ['REQ0003'], ['REQ0004'],
    ]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({
      status: 'completed', cursor: 'REQ0004', counts: { read: 4, saved: 3, held: 0, failed: 1 },
    });
    const list = await w.svc.held(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(list.rows.map((r) => [r.key, r.reason, r.error])).toEqual([['REQ0002', 'error', 'DECODE_FAILED']]);
    expect(JSON.stringify([await w.stored(), w.audited, list])).not.toContain('Maria');
  });

  it('a_request_that_passes_later_leaves_the_held_store', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(3));
    w.setDecode((input) => ({ groups: input.keys.map((key) => (key === 'REQ0002' ? { key, held: true, findings: [1] } : pass(key))) }));
    await w.svc.start(START);
    await drive(w.svc);
    expect((await w.heldAll()).rows.map((r) => r.key)).toEqual(['REQ0002']);

    // The rules changed: the next run passes it, and its held row goes.
    w.setDecode((input) => ({ groups: input.keys.map(pass) }));
    await w.svc.start(START);
    await drive(w.svc);
    expect(await w.heldAll()).toEqual({ rows: [], total: 0 });
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { read: 3, saved: 3, held: 0 } });
  });
});

describe('check: start again, stop, and who drives', () => {
  it('start_again_begins_at_the_first_key', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    // A start on a live run is refused.
    await expect(w.svc.start(START)).rejects.toThrow(`check ${CHECK} is queued; stop it before starting it again`);
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { read: 4, saved: 4 } });

    const again = await w.svc.start({ ...START, pageSize: 3, options: { site: 'B' } });
    expect(again).toMatchObject({
      id: CHECK, status: 'queued', cursor: null, pageSize: 3, options: { site: 'B' }, finishedAt: null, driver: null,
      counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} },
    });
    await drive(w.svc);
    expect(w.decodeCalls.map((c) => c.keys)).toEqual([keysOf(2), keysOf(4).slice(2), keysOf(3), ['REQ0004']]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { read: 4, saved: 4 } });
    expect(await w.svc.list(PLUGIN)).toHaveLength(1);
    expect(actions(w)).toEqual(['import.check.start', 'import.check.finish', 'import.check.start', 'import.check.finish']);
  });

  it('two_ticks_drive_a_run_once', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    const a = w.service('server-a');
    const b = w.service('server-b');
    await a.start({ ...START, pageSize: 2 });
    await Promise.all([a.tick(), b.tick(), a.tick()]);
    await Promise.all([a.idle(), b.idle()]);
    expect(w.decodeCalls.map((c) => c.keys)).toEqual([keysOf(2), keysOf(4).slice(2)]);
    expect(w.persisted).toHaveLength(4);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { read: 4, saved: 4 } });
    expect(actions(w)).toEqual(['import.check.start', 'import.check.finish']);
  });

  it('a_run_left_by_a_dead_server_is_taken_after_two_minutes', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    const started = await w.svc.start({ ...START, pageSize: 2 });
    const orphan: CheckRun = {
      ...started, status: 'running', driver: 'server-old', cursor: 'REQ0002',
      counts: { read: 2, saved: 2, held: 0, failed: 0, resources: 2, labels: { passed: 2 } },
      updatedAt: new Date(w.clock.now - 60_000).toISOString(),
    };
    await w.raw.put(PLUGIN, '__import-checks', CHECK, orphan);
    await drive(w.svc);
    expect(await w.stored()).toEqual(orphan);
    expect(w.decodeCalls).toEqual([]);

    w.clock.now += STALE_MS;
    await drive(w.svc);
    expect(w.decodeCalls.map((c) => c.keys)).toEqual([keysOf(4).slice(2)]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({
      status: 'completed', driver: null, counts: { read: 4, saved: 4, resources: 4, labels: { passed: 4 } },
    });
    expect(w.audited.find((e) => e.action === 'import.check.takeover')).toEqual({
      action: 'import.check.takeover', pluginId: PLUGIN, runId: CHECK, actor: { type: 'system', id: null, name: 'system' },
      metadata: { status: 'running' },
    });
  });

  it('stop_ends_the_run_at_the_next_page', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    let stopped = false;
    // The stop lands while the first page is being decoded.
    w.setDecode(async (input) => {
      if (!stopped) { stopped = true; await w.svc.stop(PLUGIN, CHECK, ADMIN); }
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({ status: 'stopped', driver: null, cursor: 'REQ0002', counts: { read: 2, saved: 2 } });
    expect(run.finishedAt).not.toBeNull();
    expect(w.runSaves.some((r) => r.status === 'stopping')).toBe(true);
    expect(w.decodeCalls).toHaveLength(1);
    await expect(w.svc.stop(PLUGIN, CHECK, ADMIN)).rejects.toThrow(/not running/);
    await expect(w.svc.stop(PLUGIN, 'missing', ADMIN)).rejects.toThrow(/not found/);
    expect(actions(w)).toEqual(['import.check.start', 'import.check.stop', 'import.check.finish']);
    expect(w.audited.at(-1)?.metadata).toMatchObject({ status: 'stopped' });

    // A queued run stops at once.
    await w.svc.start(START);
    expect((await w.svc.stop(PLUGIN, CHECK, ADMIN)).status).toBe('stopped');
  });

  it('a database error on CE side waits and carries on, never failing on the first error', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true })) }));
    w.failHeldPuts(2);
    await w.svc.start(START);
    await drive(w.svc);
    const waits = w.runSaves.filter((r) => r.status === 'waiting');
    expect(waits.map((r) => [r.waiting?.attempt, r.waiting?.error])).toEqual([
      [1, "OpenLDR's own database refused a write (53100)"],
      [2, "OpenLDR's own database refused a write (53100)"],
    ]);
    // retryWaitMs: 5 s then 10 s, slept in slices of a second.
    expect(w.sleeps.reduce((n, ms) => n + ms, 0)).toBe(15_000);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', waiting: null, counts: { read: 2, held: 2 } });
    expect((await w.heldAll()).total).toBe(2);
    expect(JSON.stringify(w.runSaves)).not.toContain('Maria');
  });
});

describe('check: the reference copy and the dictionaries', () => {
  it('twins_are_read_from_the_reference_copy_by_the_keys_the_plugin_names', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    const twinRows = (k: string): CopyRow[] => [
      { detail: 'requests', key: k, seq: 0, row: { RequestID: k, Panel: 'FBC' } },
      { detail: 'results', key: k, seq: 0, row: { RequestID: k, Value: 12.1 } },
    ];
    await w.seedCopy(REF, 'c2', 'completed', { twins: [...twinRows('T-REQ0001'), ...twinRows('T-REQ0002'), ...twinRows('T-UNASKED')] });
    // The plugin names one key the reference has, and one it does not.
    w.setTwinKeys((keys) => ({ keys: [`T-${keys[0]}`, 'T-MISSING'] }));
    await w.svc.start({ ...START, referenceCopyId: REF });
    await drive(w.svc);
    expect(w.twinCalls).toEqual([{ options: { site: 'A' }, keys: keysOf(2) }]);
    expect(w.decodeCalls[0].twins).toEqual({
      requests: [{ RequestID: 'T-REQ0001', Panel: 'FBC' }],
      results: [{ RequestID: 'T-REQ0001', Value: 12.1 }],
    });
    // The reference copy's sets are not dictionaries of the source.
    expect(Object.keys(w.decodeCalls[0].dictionaries)).toEqual(['facilities']);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', referenceCopyId: REF, counts: { saved: 2 } });
  });

  it('with_no_reference_the_decode_gets_empty_twins', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.svc.start(START);
    await drive(w.svc);
    expect(w.twinCalls).toEqual([]);
    expect(w.decodeCalls[0].twins).toEqual({ requests: [], results: [] });
  });

  it('dictionaries_over_the_cap_fail_the_run_with_the_size_and_no_value', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.svc.start(START);
    w.failReadSet((set, maxBytes) => new CopySetTooLargeError(set, maxBytes + 4321, maxBytes));
    await drive(w.svc);
    expect(w.readSetCalls).toEqual([{ set: 'facilities', maxBytes: CAP }]);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({
      status: 'failed', counts: { read: 0 },
      lastError: `the dictionaries of copy ${SRC} hold more than ${CAP + 4321} bytes of rows; the limit is ${CAP} bytes`,
    });
    expect(w.decodeCalls).toEqual([]);
    expect(w.persisted).toEqual([]);
    expect(JSON.stringify([run, w.audited])).not.toContain('Clinic');
    expect(w.audited.at(-1)).toMatchObject({ action: 'import.check.finish', metadata: { status: 'failed' } });
  });

  it('labels_are_counted_and_capped', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(16));
    const labelOf = (key: string): string | undefined => {
      const n = Number(key.slice(3));
      if (n <= 14) return `l${String(n).padStart(2, '0')}`;
      return n === 15 ? 'Not A Label' : undefined;
    };
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ ...pass(key), label: labelOf(key) })) }));
    await w.svc.start({ ...START, pageSize: 5 });
    await drive(w.svc);
    const labels = (await w.svc.get(PLUGIN, CHECK))!.counts.labels;
    const expected: Record<string, number> = {};
    for (let n = 1; n <= 12; n++) expected[`l${String(n).padStart(2, '0')}`] = 1;
    // l13, l14 (past 12 distinct) and one label that is not a code are counted as other. No label counts nothing.
    expected.other = 3;
    expect(labels).toEqual(expected);
  });
});

describe('check: the copy under it', () => {
  it('removing_a_copy_empties_its_held_rows', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(3));
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true, findings: { why: SECRET } })) }));
    await w.svc.start(START);
    // Refused while the check on it is live.
    await expect(w.copies.remove(PLUGIN, SRC, ADMIN)).rejects.toThrow(`copy ${SRC} has a check that is queued; stop it before deleting the copy`);
    await drive(w.svc);
    expect((await w.heldAll()).total).toBe(3);

    await w.copies.remove(PLUGIN, SRC, ADMIN);
    await w.copies.tick();
    await w.copies.idle();
    expect(await w.copies.get(PLUGIN, SRC)).toBeNull();
    expect(await w.realHeld.list(SRC, { offset: 0, limit: 10 })).toEqual({ rows: [], total: 0 });
    expect(await internalDb.selectFrom('import_copy_rows').selectAll().where('copy_id', '=', SRC).execute()).toEqual([]);
  });

  it('a check whose copy was removed or started again before it was driven fails, and reads nothing', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.svc.start(START);
    await w.setCopyStatus(SRC, 'queued');
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'failed', lastError: `copy ${SRC} is queued; a check needs a completed copy` });
    expect(w.decodeCalls).toEqual([]);
  });
});

describe('check: what may be shown', () => {
  it('no_row_value_reaches_an_audit_row_or_an_error', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [{ detail: 'requests', key: 'T-REQ0001', seq: 0, row: { Name: SECRET } }] });
    w.setDecode((input) => {
      if (input.keys.length > 1) throw new Error(`bad row ${SECRET}`);
      if (input.keys[0] === 'REQ0001') return { groups: [{ key: 'REQ0001', error: `cannot read ${SECRET}` }] };
      if (input.keys[0] === 'REQ0002') return { groups: [{ key: 'REQ0002', held: true, findings: [{ value: SECRET }], check: { source: SECRET } }] };
      if (input.keys[0] === 'REQ0003') throw new Error(`panic: ${SECRET}`);
      return { groups: [pass('REQ0004')] };
    });
    w.failPersist(() => new Error(`invalid resource for ${SECRET}`));
    w.failHeldPuts(1);
    await w.svc.start({ ...START, referenceCopyId: REF, pageSize: 2 });
    await drive(w.svc);

    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({ status: 'completed', counts: { read: 4, held: 1, failed: 3 } });
    const list = await w.svc.held(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(list.rows.map((r) => r.error)).toEqual(['MAPPING_FAILED', null, 'DECODE_FAILED', 'SAVE_FAILED']);
    // Only the held store's own JSON columns hold values.
    const shown = JSON.stringify([run, w.runSaves, w.audited, list]);
    expect(shown).not.toContain('Maria');
    for (const e of w.audited) expect(JSON.stringify(e)).not.toMatch(/REQ000/);
    expect((await w.svc.heldItem(PLUGIN, SRC, 'REQ0002'))!.findings).toEqual([{ value: SECRET }]);
  });
});
