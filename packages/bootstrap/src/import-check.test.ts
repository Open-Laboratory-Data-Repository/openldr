import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CopySetTooLargeError, createImportCheckCorrectionStore, createImportCheckHeldStore, createImportCopyStore, createJobInterruptionStore, createPluginDataStore,
  type CopyRow, type ImportCheckHeldStore, type ImportCopyStore, type PluginDataStore,
} from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { STALE_MS, type ImportActor, type ImportAuditEvent } from './import-run';
import { copyIdOf, copySetHashes, copySpecSchema, createImportCopyService, type CopyRun, type ImportCopyService } from './import-copy';
import { checkIdOf, createImportCheckService, deleteCheckRecord, isLiveCheck, liveCheckStatus, type CheckRun, type ImportCheckService } from './import-check';
import { checkForPage } from './plugin-broker';

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
type Group = { key: string; held?: boolean; findings?: unknown; check?: unknown; resources?: unknown[]; error?: string; label?: string; laboratory?: unknown; fields?: unknown };
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
const setSpec = (name: string, details: string[]) => ({
  name, keyQuery: { sql: `SELECT TOP ({{limit}}) [K] FROM [${name}] WHERE [K] > {{after}} ORDER BY [K]` },
  detailQueries: details.map((d) => ({ name: d, sql: `SELECT [K] AS [__key], * FROM [${d}] WHERE [K] IN ({{keys}})` })),
});
const pass = (key: string): Group => ({ key, resources: [{ resourceType: 'ServiceRequest', id: key }], label: 'passed' });

function manifest(entrypoints: Record<string, string>, id = PLUGIN, corrections?: string[]) {
  return {
    schemaVersion: 1, type: 'plugin', id, version: '1.2.0',
    capabilities: [{ kind: 'host:import' }, { kind: 'emit-fhir', resourceTypes: ['ServiceRequest', 'Patient'] }],
    payload: {
      kind: 'plugin', entrypoints: Object.values(entrypoints),
      importSource: { connectorTypes: ['microsoft-sql'], sourceSystem: 'openldr-v1', entrypoints, ...(corrections ? { corrections: { fields: corrections } } : {}) },
    },
  };
}
const CHECKER = { copy: 'import_copy', decode: 'import_decode', twinKeys: 'import_twin_keys' };

let internalDb: Awaited<ReturnType<typeof makeMigratedDb>>;

async function world(opts: { entrypoints?: Record<string, string>; corrections?: string[]; decodeOffThread?: boolean } = {}) {
  const raw = createPluginDataStore(internalDb);
  const plainCheckPuts: string[] = [];
  const runSaves: CheckRun[] = [];
  /** Run writes that fail as a full disk does, while it answers true for the written run. */
  let runWriteFault: ((doc: CheckRun) => boolean) | null = null;
  const pluginData: PluginDataStore = {
    ...raw,
    async put(pluginId, collection, key, doc) {
      if (collection === '__import-checks') plainCheckPuts.push(key);
      return raw.put(pluginId, collection, key, doc);
    },
    async putIfRev(pluginId, collection, key, doc, expectedRev) {
      if (collection === '__import-checks' && runWriteFault?.(doc as CheckRun)) {
        throw Object.assign(new Error('could not extend file: No space left on device'), { code: '53100' });
      }
      const wrote = await raw.putIfRev(pluginId, collection, key, doc, expectedRev);
      if (wrote && collection === '__import-checks') runSaves.push(structuredClone(doc) as CheckRun);
      return wrote;
    },
  };
  const realCopyStore = createImportCopyStore(internalDb);
  const readSetCalls: Array<{ set: string; maxBytes: number }> = [];
  let readSetFault: ((set: string, maxBytes: number) => unknown) | null = null;
  const readCalls: Array<{ copyId: string; set: string; keys: number }> = [];
  const copyStore: ImportCopyStore = {
    ...realCopyStore,
    async read(copyId, setName, keys) {
      readCalls.push({ copyId, set: setName, keys: keys.length });
      return realCopyStore.read(copyId, setName, keys);
    },
    async readSet(copyId, setName, maxBytes) {
      readSetCalls.push({ set: setName, maxBytes });
      if (readSetFault) throw readSetFault(setName, maxBytes);
      return realCopyStore.readSet(copyId, setName, maxBytes);
    },
  };
  const realHeld = createImportCheckHeldStore(internalDb);
  let heldPutFaults = 0;
  let heldRemoveFaults = 0;
  let heldGetFaults = 0;
  /** When set, the next held read captures its row, then waits for this before answering. */
  let heldGetGate: Promise<void> | null = null;
  let onHeldRemove: ((copyId: string, keys: string[]) => Promise<void>) | null = null;
  const heldPuts: unknown[] = [];
  const held: ImportCheckHeldStore = {
    ...realHeld,
    async put(item) {
      heldPuts.push(structuredClone(item));
      if (heldPutFaults > 0) {
        heldPutFaults -= 1;
        // What Postgres says on a full disk. Its detail field quotes the row.
        throw Object.assign(new Error('could not extend file: No space left on device'), { code: '53100', detail: `Failing row contains (${SECRET})` });
      }
      return realHeld.put(item);
    },
    async get(copyId, key) {
      const gate = heldGetGate;
      if (gate) { heldGetGate = null; const row = await realHeld.get(copyId, key); await gate; return row; }
      if (heldGetFaults > 0) {
        heldGetFaults -= 1;
        throw Object.assign(new Error('could not read block'), { code: '53100' });
      }
      return realHeld.get(copyId, key);
    },
    async remove(copyId, keys) {
      await onHeldRemove?.(copyId, keys);
      if (heldRemoveFaults > 0) {
        heldRemoveFaults -= 1;
        throw Object.assign(new Error('could not extend file: No space left on device'), { code: '53100' });
      }
      return realHeld.remove(copyId, keys);
    },
  };
  const audited: ImportAuditEvent[] = [];
  /** Actions whose audit write fails, as the store does when it cannot write. */
  const refuseAudit = new Set<string>();
  /** Audit writes that wait until the test lets them go. */
  const auditGates = new Map<string, Promise<void>>();
  const audit = async (e: ImportAuditEvent) => {
    const gate = auditGates.get(e.action);
    if (gate) await gate;
    if (refuseAudit.has(e.action)) throw new Error('audit store unavailable');
    audited.push(structuredClone(e));
  };
  const plugins: Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }> = [
    { id: PLUGIN, version: '1.2.0', enabled: true, manifest: manifest(opts.entrypoints ?? CHECKER, PLUGIN, opts.corrections) },
    { id: OTHER, version: '1.0.0', enabled: true, manifest: manifest({ copy: 'import_copy' }, OTHER) },
  ];
  const decodeCalls: DecodeInput[] = [];
  const twinCalls: Array<{ options: Record<string, string>; keys: string[] }> = [];
  let decodeFn: (input: DecodeInput) => unknown = (input) => ({ groups: input.keys.map(pass) });
  let twinFn: (keys: string[]) => unknown = (keys) => ({ keys: keys.map((k) => `T-${k}`) });
  const copyCalls: Array<Record<string, string>> = [];
  const choicesCalls: unknown[] = [];
  let choicesFn: (input: unknown) => unknown = () => ({ choices: {} });
  /** The plugin's copy answer. The source names requests (two details) and one dictionary; a copy
   *  made with the option role=reference names the set twins. */
  let copyFn: (options: Record<string, string>) => unknown = (options) => (options.role === 'reference'
    ? { sets: [setSpec('twins', ['requests', 'results'])] }
    : { sets: [setSpec('requests', ['requests', 'results']), setSpec('facilities', [])] });
  const invoke = vi.fn(async (entrypoint: string, input: unknown, _opts?: { offThread?: boolean }) => {
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
    if (entrypoint === 'import_choices') {
      choicesCalls.push(structuredClone(input));
      return choicesFn(input);
    }
    if (entrypoint === 'import_copy') {
      const i = input as { options: Record<string, string> };
      copyCalls.push(structuredClone(i.options));
      return copyFn(i.options);
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
  /** The connectors an admin allowed the plugin to read. Every copy here is made from one of them. */
  const allowedConnectors = new Set(['c1', 'c2', 'c9']);
  const allowedCalls: string[] = [];
  const allowed = async (pluginId: string) => { allowedCalls.push(pluginId); return [...allowedConnectors]; };

  const copies: ImportCopyService = createImportCopyService({
    plugins: pluginsDep, connectors, secretsKey: 'k', pluginData, audit, store: realCopyStore,
    allowed: async () => [], driverId: 'server-1', now: () => new Date(clock.now),
    checks: {
      liveCheckStatus: (pluginId, copyId) => liveCheckStatus(raw, pluginId, copyId),
      deleteHeld: (copyId, limit) => realHeld.deleteSome(copyId, limit),
      deleteCheck: (pluginId, copyId) => deleteCheckRecord(raw, pluginId, copyId),
    },
  });
  const interruptions = createJobInterruptionStore(internalDb);
  const corrections = createImportCheckCorrectionStore(internalDb);
  const service = (driverId = 'server-1'): ImportCheckService => createImportCheckService({
    plugins: pluginsDep, pluginData, audit, persist, copyStore, held, copies, driverId, allowed, corrections,
    interruptions: { store: interruptions, now: () => new Date(clock.now), processStartedAt: new Date(clock.now) },
    now: () => new Date(clock.now),
    sleep: async (ms) => { sleeps.push(ms); },
    ...(opts.decodeOffThread !== undefined ? { decodeOffThread: opts.decodeOffThread } : {}),
  });
  const svc = service();
  worlds.push({ plainCheckPuts });

  /** Write a copy as a finished one leaves it: its record and its rows. */
  async function seedCopy(copyId: string, connectorId: string, status: CopyRun['status'], sets: Record<string, CopyRow[]>, pluginId = PLUGIN) {
    const at = new Date(clock.now).toISOString();
    const setOrder = Object.keys(sets);
    const options: Record<string, string> = copyId === REF ? { role: 'reference' } : {};
    const setSqlFor = (o: Record<string, string>) => {
      const spec = copySpecSchema.safeParse(copyFn(o));
      return spec.success ? copySetHashes(spec.data.sets) : {};
    };
    const run: CopyRun = {
      id: copyId, kind: 'copy', rev: 1, pluginId, pluginVersion: '1.2.0', connectorId, status,
      options, pageSize: 500,
      sets: Object.fromEntries(setOrder.map((n) => [n, { cursor: null, keys: 0, rows: sets[n].length, bytes: 0, skipped: 0, done: true }])),
      // The statements the copy was made from: the plugin's copy answer for its options, as now.
      setOrder, setSql: setSqlFor(options), waiting: null, driver: null, startedAt: at, updatedAt: at, finishedAt: at, lastError: null, startedBy: 'admin',
    };
    await raw.put(pluginId, '__import-copies', copyId, run);
    for (const [name, rows] of Object.entries(sets)) {
      await realCopyStore.replaceKeys(copyId, name, [...new Set(rows.map((r) => r.key))], rows);
    }
  }
  const setCopyStatus = async (copyId: string, status: CopyRun['status'], over: Partial<CopyRun> = {}) => {
    const run = (await raw.get(PLUGIN, '__import-copies', copyId)) as CopyRun;
    await raw.put(PLUGIN, '__import-copies', copyId, { ...run, status, rev: run.rev + 1, ...over });
  };

  return {
    interruptions, corrections, refuseAudit,
    gateAudit: (action: string) => { let release!: () => void; auditGates.set(action, new Promise<void>((r) => { release = r; })); return () => { auditGates.delete(action); release(); }; },
    svc, service, copies, raw, audited, runSaves, decodeCalls, twinCalls, invoke, persisted, clock, sleeps, plugins,
    readSetCalls, readCalls, heldPuts, copyCalls, allowedCalls, choicesCalls,
    setChoices: (fn: (input: unknown) => unknown) => { choicesFn = fn; },
    revoke: (connectorId: string) => { allowedConnectors.delete(connectorId); },
    setCopy: (fn: (options: Record<string, string>) => unknown) => { copyFn = fn; }, realHeld, seedCopy, setCopyStatus,
    setDecode: (fn: (input: DecodeInput) => unknown) => { decodeFn = fn; },
    setTwinKeys: (fn: (keys: string[]) => unknown) => { twinFn = fn; },
    failPersist: (fn: ((resources: unknown[]) => unknown) | null) => { persistFault = fn; },
    failReadSet: (fn: ((set: string, maxBytes: number) => unknown) | null) => { readSetFault = fn; },
    failHeldPuts: (n: number) => { heldPutFaults = n; },
    failHeldRemoves: (n: number) => { heldRemoveFaults = n; },
    failHeldGets: (n: number) => { heldGetFaults = n; },
    gateNextHeldGet: () => { let release!: () => void; heldGetGate = new Promise<void>((r) => { release = r; }); return release; },
    failRunWrites: (fn: ((doc: CheckRun) => boolean) | null) => { runWriteFault = fn; },
    watchHeldRemoves: (fn: ((copyId: string, keys: string[]) => Promise<void>) | null) => { onHeldRemove = fn; },
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
/** A held request as `heldItems` gives it: `heldItem` without the corrections it adds. */
async function plainHeld(w: World, key: string) {
  const item = await w.svc.heldItem(PLUGIN, SRC, key);
  if (!item) return item;
  const { corrections: _c, correctable: _f, ...rest } = item;
  return rest;
}

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
      metadata: { copyId: SRC, referenceCopyId: null, pageSize: 500, carriedOn: false },
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
    // In batches: the same rows as held, in the same order, each with its findings and check.
    const batch = await w.svc.heldItems(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(batch.total).toBe(2);
    expect(batch.items).toEqual([await plainHeld(w, 'REQ0002'), await plainHeld(w, 'REQ0003')]);
    expect(batch.items.map((i) => i.key)).toEqual(list.rows.map((r) => r.key));
    expect(await w.svc.heldItems(PLUGIN, SRC, { offset: 1, limit: 1 })).toEqual({ items: [batch.items[1]], total: 2 });
    expect(await w.svc.heldItems(PLUGIN, SRC, { label: 'held_by_check', offset: 0, limit: 10 })).toEqual({ items: [batch.items[0]], total: 1 });
    expect(await w.svc.heldItems(PLUGIN, SRC, { reason: 'error', offset: 0, limit: 10 })).toEqual({ items: [], total: 0 });
    // Another plugin cannot read this copy's held rows.
    await expect(w.svc.held(OTHER, SRC, { offset: 0, limit: 10 })).rejects.toThrow(`copy ${SRC} not found`);
    await expect(w.svc.heldItem(OTHER, SRC, 'REQ0002')).rejects.toThrow(`copy ${SRC} not found`);
    await expect(w.svc.heldItems(OTHER, SRC, { offset: 0, limit: 10 })).rejects.toThrow(`copy ${SRC} not found`);

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

  it('a run cut three times with no progress stops for a person, and a start carries it on (re-review R10)', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    const started = await w.svc.start({ ...START, pageSize: 2 });
    const orphan: CheckRun = {
      ...started, status: 'running', driver: 'server-old', cursor: 'REQ0002',
      counts: { read: 2, saved: 2, held: 0, failed: 0, resources: 2, labels: { passed: 2 } },
      updatedAt: new Date(w.clock.now - STALE_MS - 1000).toISOString(),
    };
    await w.raw.put(PLUGIN, '__import-checks', CHECK, orphan);
    for (let i = 1; i <= 3; i += 1) {
      const cut = await w.interruptions.record('cdr-run', CHECK, { at: new Date(Date.UTC(2026, 0, 1, 0, i)), cause: 'server-restart', phase: '2' });
      await w.interruptions.resolve(cut.id, { resumedBy: 'self', resumedAt: new Date(Date.UTC(2026, 0, 1, 0, i, 30)) });
    }
    await drive(w.svc);
    expect(w.decodeCalls).toEqual([]);
    expect((await w.stored())!).toMatchObject({ status: 'stopped', driver: null, cursor: 'REQ0002', lastError: expect.stringContaining('Continue') });
    const again = await w.svc.start({ ...START, pageSize: 2 });
    expect(again).toMatchObject({ status: 'queued', cursor: 'REQ0002', carriedOn: true });
    expect(((await w.interruptions.listFor('cdr-run', [CHECK])).get(CHECK) ?? []).filter((r) => r.resumedBy === null)).toEqual([]);
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

describe('check: fix round 1', () => {
  const twinRows = (k: string): CopyRow[] => [
    { detail: 'requests', key: k, seq: 0, row: { RequestID: k } },
    { detail: 'results', key: k, seq: 0, row: { RequestID: k, Value: 1 } },
  ];

  it('I1: a live check guards its source and its reference copy against a remove', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.seedCopy(REF, 'c2', 'completed', { twins: twinRows('T-REQ0001') });
    await w.svc.start({ ...START, referenceCopyId: REF });
    expect(await liveCheckStatus(w.raw, PLUGIN, SRC)).toBe('queued');
    expect(await liveCheckStatus(w.raw, PLUGIN, REF)).toBe('queued');
    expect(await liveCheckStatus(w.raw, PLUGIN, 'another')).toBeNull();
    await expect(w.copies.remove(PLUGIN, REF, ADMIN)).rejects.toThrow(`copy ${REF} has a check that is queued; stop it before deleting the copy`);
    await expect(w.copies.remove(PLUGIN, SRC, ADMIN)).rejects.toThrow(`copy ${SRC} has a check that is queued; stop it before deleting the copy`);
    await drive(w.svc);
    expect(await liveCheckStatus(w.raw, PLUGIN, REF)).toBeNull();
    expect((await w.copies.remove(PLUGIN, REF, ADMIN)).status).toBe('deleting');
  });

  it('I1: a reference copy that is no longer completed fails the run at the next page', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    await w.seedCopy(REF, 'c2', 'completed', { twins: twinRows('T-REQ0001') });
    let flipped = false;
    w.setDecode(async (input) => {
      if (!flipped) { flipped = true; await w.setCopyStatus(REF, 'queued'); }
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, referenceCopyId: REF, pageSize: 2 });
    await drive(w.svc);
    expect(w.decodeCalls).toHaveLength(1);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({
      status: 'failed', cursor: 'REQ0002', counts: { read: 2, saved: 2 },
      lastError: `copy ${REF} changed while the check was reading it; start the check again once the copy has completed`,
    });
  });

  it('I1: a source copy read again to the end under a running check fails the run, and never completes it', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    let flipped = false;
    w.setDecode(async (input) => {
      // Still completed, but a later pass: its finish time moved.
      if (!flipped) { flipped = true; await w.setCopyStatus(SRC, 'completed', { finishedAt: new Date(w.clock.now + 1000).toISOString() }); }
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({
      status: 'failed', lastError: `copy ${SRC} changed while the check was reading it; start the check again once the copy has completed`,
    });
    expect(w.decodeCalls).toHaveLength(1);
  });

  it('I2: a fault of CE database that never clears fails the run after 5 tries again, with the code and no value', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true })) }));
    w.failHeldPuts(Number.POSITIVE_INFINITY);
    await w.svc.start(START);
    await drive(w.svc);
    expect(w.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting?.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(w.sleeps.reduce((n, ms) => n + ms, 0)).toBe(5_000 + 10_000 + 20_000 + 40_000 + 80_000);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({
      status: 'failed', waiting: null, counts: { read: 0, held: 0 },
      lastError: "OpenLDR's own database refused a write (53100) on 6 tries of one page in a row, so the check stopped",
    });
    expect(w.decodeCalls).toHaveLength(6);
    expect(JSON.stringify([run, w.audited])).not.toContain('Maria');
  });

  it('I2: a fault part-way through a page counts each request once', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    w.setDecode((input) => ({ groups: input.keys.map((key) => (key === 'REQ0003' ? { key, held: true } : pass(key))) }));
    // The held write of REQ0003 fails once, after REQ0001 and REQ0002 were saved.
    w.failHeldPuts(1);
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    expect(w.persisted.map((p) => (p.resources[0] as { id: string }).id)).toEqual(['REQ0001', 'REQ0002', 'REQ0001', 'REQ0002', 'REQ0004']);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({
      status: 'completed', counts: { read: 4, saved: 3, held: 1, failed: 0, resources: 3, labels: { passed: 3 } },
    });
  });

  it('I2: a NUL character in findings or check is replaced before the held store sees it', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(1));
    w.setDecode(() => ({
      groups: [{ key: 'REQ0001', held: true, findings: [{ note: 'a\u0000b', ['k\u0000ey']: 'x' }], check: { list: ['\u0000', 3, null] } }],
    }));
    await w.svc.start(START);
    await drive(w.svc);
    const cleaned = { findings: [{ note: 'a�b', ['k�ey']: 'x' }], check: { list: ['�', 3, null] } };
    expect(w.heldPuts).toEqual([expect.objectContaining(cleaned)]);
    expect(JSON.stringify(w.heldPuts)).not.toContain('\\u0000');
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toMatchObject(cleaned);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { held: 1 } });
  });

  it('I3: a twin-keys answer past 20 keys a request is a failed call, and twin rows are read 500 keys at a time', async () => {
    const w = await world();
    const keys = keysOf(60);
    await sourceCopy(w, keys);
    await w.seedCopy(REF, 'c2', 'completed', { twins: twinRows('T-REQ0001-0') });
    let calls = 0;
    w.setTwinKeys((page) => {
      calls += 1;
      const many = page.flatMap((k) => Array.from({ length: 20 }, (_, i) => `T-${k}-${i}`));
      // The first answer has one key too many. The second repeats every key once more.
      return { keys: calls === 1 ? [...many, 'T-EXTRA'] : calls === 2 ? [...many, ...many.slice(0, 5)] : many };
    });
    await w.svc.start({ ...START, referenceCopyId: REF, pageSize: 60 });
    await drive(w.svc);
    // The first page was refused whole and halved. No twin row was read for it.
    expect(w.decodeCalls.map((c) => c.keys.length)).toEqual([30, 30]);
    expect(w.readCalls.filter((c) => c.set === 'twins').map((c) => c.keys)).toEqual([500, 100, 500, 100]);
    expect(w.decodeCalls[0].twins.requests).toEqual([{ RequestID: 'T-REQ0001-0' }]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { read: 60, saved: 60 } });
  });

  it('I3: a twin-keys call that throws or gives what is not a list of keys halves the page', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [] });
    let calls = 0;
    w.setTwinKeys((page) => {
      calls += 1;
      if (calls === 1) throw new Error(`no twin for ${SECRET}`);
      if (calls === 2) return { keys: [1, 2] };
      return { keys: page };
    });
    await w.svc.start({ ...START, referenceCopyId: REF, pageSize: 2 });
    await drive(w.svc);
    // Page of 2 fails, then REQ0001 alone fails at one key, then REQ0002 passes.
    expect(w.decodeCalls.map((c) => c.keys)).toEqual([['REQ0002']]);
    const list = await w.svc.held(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(list.rows.map((r) => [r.key, r.error])).toEqual([['REQ0001', 'DECODE_FAILED']]);
  });

  it('I4: two groups for one key fail it as DUPLICATE_GROUP, and nothing of it is saved', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    w.setDecode(() => ({
      groups: [pass('REQ0001'), { key: 'REQ0001', held: true, findings: [1] }, pass('REQ0002')],
    }));
    await w.svc.start(START);
    await drive(w.svc);
    expect(w.persisted.map((p) => (p.resources[0] as { id: string }).id)).toEqual(['REQ0002']);
    const list = await w.svc.held(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(list.rows.map((r) => [r.key, r.reason, r.error])).toEqual([['REQ0001', 'error', 'DUPLICATE_GROUP']]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ counts: { read: 2, saved: 1, failed: 1, held: 0 } });
  });

  it('I5: start refuses a source copy with no set requests and a reference copy with no set twins', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.seedCopy(REF, 'c2', 'completed', { twins: twinRows('T-REQ0001') });
    // The two copies swapped.
    await expect(w.svc.start({ ...START, copyId: REF, referenceCopyId: SRC })).rejects.toThrow(
      `copy ${REF} has no set requests, so it cannot be the source of a check; pick the source copy`,
    );
    // A second source copy, from another connector, picked as the reference.
    const other = copyIdOf(PLUGIN, 'c3');
    await w.seedCopy(other, 'c3', 'completed', { requests: requestRows(keysOf(1)) });
    await expect(w.svc.start({ ...START, referenceCopyId: other })).rejects.toThrow(
      `copy ${other} has no set twins, so it cannot be the reference of a check; pick the reference copy, or no reference`,
    );
    expect(w.audited).toEqual([]);
    expect((await w.svc.start({ ...START, referenceCopyId: REF })).status).toBe('queued');
  });
});

describe('check: fix round 1, the details the plugin declares (I6)', () => {
  it('a page where one detail has no rows still decodes, with that detail as an empty list', async () => {
    const w = await world();
    // The source names a third detail, taken, and no request of the page has a row of it.
    w.setCopy(() => ({ sets: [setSpec('requests', ['requests', 'results', 'taken']), setSpec('facilities', [])] }));
    await sourceCopy(w, keysOf(2));
    w.setDecode((input) => {
      // As the real plugin does: every detail of the set must be a list.
      if (!['requests', 'results', 'taken'].every((n) => Array.isArray(input.rows[n]))) throw new Error('rows must hold the three details');
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start(START);
    await drive(w.svc);
    expect(w.decodeCalls).toHaveLength(1);
    expect(w.decodeCalls[0].rows.taken).toEqual([]);
    // Asked once at the start and once by the drive.
    expect(w.copyCalls).toEqual([{}, {}]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { saved: 2 }, lastError: null });
  });

  it('a reference page with no result rows hands results as an empty list', async () => {
    const w = await world();
    // The reference copy names a third detail too.
    w.setCopy((options) => (options.role === 'reference'
      ? { sets: [setSpec('twins', ['requests', 'results', 'specimens'])] }
      : { sets: [setSpec('requests', ['requests', 'results']), setSpec('facilities', [])] }));
    await sourceCopy(w, keysOf(1));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [{ detail: 'requests', key: 'T-REQ0001', seq: 0, row: { RequestID: 'T-REQ0001' } }] });
    await w.svc.start({ ...START, referenceCopyId: REF });
    await drive(w.svc);
    expect(w.decodeCalls[0].twins).toEqual({ requests: [{ RequestID: 'T-REQ0001' }], results: [], specimens: [] });
    // Each copy was asked about with its own options.
    expect(w.copyCalls).toEqual([{}, { role: 'reference' }, {}, { role: 'reference' }]);
  });

  it('an empty dictionary set is handed as an empty list, and a set with no detail queries is one detail', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(1));
    w.setCopy(() => ({ sets: [setSpec('requests', []), setSpec('facilities', []), setSpec('wards', [])] }));
    await w.seedCopy(SRC, 'c1', 'completed', {
      requests: [{ detail: 'requests', key: 'REQ0001', seq: 0, row: reqRow('REQ0001') }], facilities: FACILITIES,
    });
    await w.svc.start(START);
    await drive(w.svc);
    expect(w.decodeCalls[0].dictionaries).toEqual({ facilities: FACILITIES.map((r) => r.row), wards: [] });
    expect(Object.keys(w.decodeCalls[0].rows)).toEqual(['requests']);
  });

  it('a copy entrypoint that fails, or no longer names the set, fails the run with a fixed sentence', async () => {
    const w = await world();
    const good = () => ({ sets: [setSpec('requests', ['requests', 'results']), setSpec('facilities', [])] });
    w.setCopy(good);
    await sourceCopy(w, keysOf(1));
    // Each answer goes wrong between the start and the drive.
    const runWith = async (bad: () => unknown) => {
      w.setCopy(good);
      await w.svc.start(START);
      w.setCopy(bad);
      await drive(w.svc);
      return (await w.svc.get(PLUGIN, CHECK))!;
    };
    expect(await runWith(() => { throw new Error(`panic on ${SECRET}`); })).toMatchObject({
      status: 'failed', lastError: `the plugin's copy entrypoint failed, so the check cannot tell what copy ${SRC} holds`,
    });
    // A set no longer named is a change of statements.
    expect(await runWith(() => ({ sets: [setSpec('facilities', [])] }))).toMatchObject({
      status: 'failed', lastError: `the plugin's copy statements changed since copy ${SRC} was made; read the copy again, then start the check`,
    });
    expect((await runWith(() => ({ sets: 'nope' }))).lastError).toBe(`the plugin's copy entrypoint gave an answer that is not valid for copy ${SRC}`);
    // At the start, the same sentence, at once.
    w.setCopy(() => { throw new Error(`panic on ${SECRET}`); });
    await expect(w.svc.start(START)).rejects.toThrow(`the plugin's copy entrypoint failed, so the check cannot tell what copy ${SRC} holds`);
    expect(w.decodeCalls).toEqual([]);
    expect(JSON.stringify(w.runSaves)).not.toContain('Maria');
  });

  it('a failed decode call says why on the run, in a fixed sentence, until a good page clears it', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    let calls = 0;
    w.setDecode((input) => {
      calls += 1;
      if (calls === 1) throw new Error(`plugin timed out after 30000ms near ${SECRET}`);
      if (calls === 2) throw new Error(`panic: ${SECRET}`);
      if (calls === 3) return { groups: 'nope' };
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    const errors = w.runSaves.map((r) => r.lastError).filter((e, i, all) => e !== all[i - 1]);
    expect(errors).toEqual([
      null,
      "the plugin's decode call timed out",
      'the plugin refused the decode call',
      "the plugin's decode answer was not valid",
      null,
    ]);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', lastError: null });
    expect(JSON.stringify(w.runSaves)).not.toContain('Maria');
  });
});

describe('check: fix round 2, a copy made from other statements (N1)', () => {
  const CHANGED = `the plugin's copy statements changed since copy ${SRC} was made; read the copy again, then start the check`;
  const v1 = () => ({ sets: [setSpec('requests', ['requests', 'results']), setSpec('facilities', [])] });

  it('a plugin whose copy answer gained a detail fails the run and saves nothing', async () => {
    const w = await world();
    w.setCopy(v1);
    await sourceCopy(w, keysOf(2));
    await w.svc.start(START);
    // Upgraded between the start and the drive: it now names a detail the copy never read.
    w.setCopy(() => ({ sets: [setSpec('requests', ['requests', 'results', 'specimens']), setSpec('facilities', [])] }));
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'failed', lastError: CHANGED, counts: { read: 0, saved: 0 } });
    expect(w.decodeCalls).toEqual([]);
    expect(w.persisted).toEqual([]);
    // A start is told at once.
    await expect(w.svc.start(START)).rejects.toThrow(CHANGED);
  });

  it('a plugin whose SQL text changed fails the run, for the source and for the reference', async () => {
    const w = await world();
    const reference = (sql: string) => ({ sets: [{ ...setSpec('twins', ['requests', 'results']), keyQuery: { sql } }] });
    const KEY_SQL = 'SELECT TOP ({{limit}}) [K] FROM [twins] WHERE [K] > {{after}} ORDER BY [K]';
    w.setCopy((o) => (o.role === 'reference' ? reference(KEY_SQL) : v1()));
    await sourceCopy(w, keysOf(1));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [] });
    await w.svc.start({ ...START, referenceCopyId: REF });
    // Same set and detail names; one statement's text differs.
    w.setCopy((o) => (o.role === 'reference' ? reference(`${KEY_SQL} `) : v1()));
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({
      status: 'failed', lastError: `the plugin's copy statements changed since copy ${REF} was made; read the copy again, then start the check`,
    });
    expect(w.decodeCalls).toEqual([]);
    await expect(w.svc.start({ ...START, referenceCopyId: REF })).rejects.toThrow(`copy ${REF} was made`);
    // The source alone still starts and runs: its statements did not change.
    expect((await w.svc.start(START)).status).toBe('queued');
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', counts: { saved: 1 } });
  });

  it('an unchanged answer runs', async () => {
    const w = await world();
    w.setCopy(v1);
    await sourceCopy(w, keysOf(2));
    await w.svc.start(START);
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', lastError: null, counts: { read: 2, saved: 2 } });
  });
});

describe('check: by laboratory', () => {
  type Lab = NonNullable<CheckRun['laboratories']>[number];
  const COUNTED = ['read', 'saved', 'held', 'failed'] as const;
  /** Every laboratory's counts add up to the run's own, count by count and label by label. */
  function expectSums(run: Pick<CheckRun, 'counts' | 'laboratories'>): void {
    const labs = run.laboratories ?? [];
    for (const k of COUNTED) expect(labs.reduce((n, l) => n + l.counts[k], 0), k).toBe(run.counts[k]);
    // Summed in a map: a label such as `constructor` must not read a plain object's own function.
    const labels = new Map<string, number>();
    for (const l of labs) for (const [name, n] of Object.entries(l.counts.labels)) labels.set(name, (labels.get(name) ?? 0) + n);
    expect(Object.fromEntries(labels)).toEqual(run.counts.labels);
    // One entry for each code.
    expect(new Set(labs.map((l) => l.code)).size).toBe(labs.length);
  }
  const lab = (code: string | null, read: number, saved: number, held: number, failed: number, labels: Record<string, number> = {}): Lab =>
    ({ code, counts: { read, saved, held, failed, labels } });
  const at = (code: unknown) => ({ code });

  it('a mixed page counts each laboratory as the run counts, and the sums hold', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(9));
    w.setDecode((input) => {
      const [k1, k2, k3, k4, k5, k6, k7, k8, k9] = input.keys;
      return {
        groups: [
          { ...pass(k1), laboratory: at('LAB-A') },
          { key: k2, held: true, findings: [1], label: 'held_x', laboratory: at('LAB-A') },
          { key: k3, error: 'BAD_DATE', label: 'bad_date', laboratory: at('LAB.B_2') },
          pass(k4),
          // A code with a space is no laboratory, and the request is still saved.
          { ...pass(k5), laboratory: at('has space') },
          // No group for k6.
          { ...pass(k7), resources: [{ resourceType: 'Observation' }], laboratory: at('LAB.B_2') },
          // A code that is not a string is no laboratory, never a bad answer.
          { ...pass(k8), laboratory: at(5) },
          { key: k9, held: true, label: 'Not A Label', laboratory: at('LAB.B_2') },
        ].filter((g) => g.key !== k6),
      };
    });
    await w.svc.start(START);
    await drive(w.svc);

    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({
      status: 'completed',
      counts: { read: 9, saved: 4, held: 2, failed: 3, labels: { passed: 5, held_x: 1, bad_date: 1, other: 1 } },
    });
    // In the order each code was first met.
    expect(run.laboratories).toEqual([
      lab('LAB-A', 2, 1, 1, 0, { passed: 1, held_x: 1 }),
      lab('LAB.B_2', 3, 0, 1, 2, { bad_date: 1, passed: 1, other: 1 }),
      lab(null, 4, 3, 0, 1, { passed: 3 }),
    ]);
    expectSums(run);
    // Every record written along the way holds the sums too.
    for (const saved of w.runSaves) expectSums(saved);

    // A held request keeps its laboratory, and the held list filters by it.
    const all = await w.svc.held(PLUGIN, SRC, { offset: 0, limit: 10 });
    expect(all.rows.map((r) => [r.key, r.laboratory])).toEqual([
      ['REQ0002', 'LAB-A'], ['REQ0003', 'LAB.B_2'], ['REQ0006', null], ['REQ0007', 'LAB.B_2'], ['REQ0009', 'LAB.B_2'],
    ]);
    const b = await w.svc.held(PLUGIN, SRC, { laboratory: 'LAB.B_2', offset: 0, limit: 2 });
    expect([b.rows.map((r) => r.key), b.total]).toEqual([['REQ0003', 'REQ0007'], 3]);
    const bHeld = await w.svc.held(PLUGIN, SRC, { laboratory: 'LAB.B_2', reason: 'held', offset: 0, limit: 10 });
    expect([bHeld.rows.map((r) => r.key), bHeld.total]).toEqual([['REQ0009'], 1]);
    const bPassed = await w.svc.held(PLUGIN, SRC, { laboratory: 'LAB.B_2', label: 'passed', offset: 0, limit: 10 });
    expect([bPassed.rows.map((r) => r.key), bPassed.total]).toEqual([['REQ0007'], 1]);
    const aItems = await w.svc.heldItems(PLUGIN, SRC, { laboratory: 'LAB-A', offset: 0, limit: 10 });
    expect(aItems).toEqual({ items: [await plainHeld(w, 'REQ0002')], total: 1 });
    expect(aItems.items[0]).toMatchObject({ laboratory: 'LAB-A', findings: [1] });
    expect((await w.svc.heldItems(PLUGIN, SRC, { laboratory: 'LAB-A', reason: 'error', offset: 0, limit: 10 })).total).toBe(0);
    // A laboratory code never reaches an audit row.
    expect(JSON.stringify(w.audited)).not.toContain('LAB');
  });

  it('a page tried again after a fault counts once for each laboratory', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    w.setDecode((input) => ({
      groups: input.keys.map((key) => (key === 'REQ0003'
        ? { key, held: true, laboratory: at('B') }
        : { ...pass(key), laboratory: at('A') })),
    }));
    // The held write of REQ0003 fails once, after REQ0001 and REQ0002 were saved.
    w.failHeldPuts(1);
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    expect(w.persisted).toHaveLength(5);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({ status: 'completed', counts: { read: 4, saved: 3, held: 1, failed: 0, labels: { passed: 3 } } });
    expect(run.laboratories).toEqual([lab('A', 3, 3, 0, 0, { passed: 3 }), lab('B', 1, 0, 1, 0)]);
    for (const saved of w.runSaves) expectSums(saved);
  });

  it('the 501st code is counted with the requests that named none', async () => {
    const w = await world();
    const keys = keysOf(502);
    await sourceCopy(w, keys);
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ ...pass(key), laboratory: at(`L${Number(key.slice(3))}`) })) }));
    // Two pages, so the cap holds across a page end.
    await w.svc.start({ ...START, pageSize: 300 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run.counts).toMatchObject({ read: 502, saved: 502 });
    const labs = run.laboratories!;
    expect(labs).toHaveLength(501);
    expect(labs.slice(0, 500).map((l) => l.code)).toEqual(Array.from({ length: 500 }, (_, i) => `L${i + 1}`));
    expect(labs[0]).toEqual(lab('L1', 1, 1, 0, 0, { passed: 1 }));
    expect(labs[500]).toEqual(lab(null, 2, 2, 0, 0, { passed: 2 }));
    expectSums(run);
  });

  it('a start, and a start again, begin with no laboratory; a run that names none has one entry with a null code', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ ...pass(key), laboratory: at('A') })) }));
    const first = await w.svc.start({ ...START, pageSize: 2 });
    expect(first.laboratories).toEqual([]);
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!.laboratories).toEqual([lab('A', 4, 4, 0, 0, { passed: 4 })]);

    w.setDecode((input) => ({ groups: input.keys.map(pass) }));
    const again = await w.svc.start(START);
    expect(again.laboratories).toEqual([]);
    expect((await w.stored())!.laboratories).toEqual([]);
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!.laboratories).toEqual([lab(null, 4, 4, 0, 0, { passed: 4 })]);
  });

  it('a bad code is treated as no laboratory, never as an error', async () => {
    const w = await world();
    const bad: unknown[] = [
      at('X'.repeat(33)), at('has space'), at(''), at(5), at(null), 'LAB', null, ['LAB'], {}, at('caf\u00e9'), at('a/b'),
    ];
    await sourceCopy(w, keysOf(bad.length + 1));
    w.setDecode((input) => ({
      groups: input.keys.map((key, i) => ({ key, held: true, ...(i < bad.length ? { laboratory: bad[i] } : { laboratory: at('X'.repeat(32)) }) })),
    }));
    await w.svc.start(START);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run).toMatchObject({ status: 'completed', lastError: null, counts: { read: bad.length + 1, held: bad.length + 1, failed: 0 } });
    // 32 characters is still a code.
    expect(run.laboratories).toEqual([lab(null, bad.length, 0, bad.length, 0), lab('X'.repeat(32), 1, 0, 1, 0)]);
    const rows = (await w.heldAll()).rows;
    expect(rows.slice(0, bad.length).every((r) => r.laboratory === null)).toBe(true);
    expect(rows.at(-1)!.laboratory).toBe('X'.repeat(32));
  });

  it('labels per laboratory follow the run cap, so the sums hold past 12 labels', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(16));
    w.setDecode((input) => ({
      groups: input.keys.map((key) => {
        const n = Number(key.slice(3));
        return { ...pass(key), label: `l${String(n).padStart(2, '0')}`, laboratory: at(n % 2 === 0 ? 'EVEN' : 'ODD') };
      }),
    }));
    await w.svc.start({ ...START, pageSize: 5 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(Object.keys(run.counts.labels)).toHaveLength(13);
    expect(run.counts.labels.other).toBe(4);
    expectSums(run);
    const even = run.laboratories!.find((l) => l.code === 'EVEN')!;
    // l14 and l16 are past the run's 12, so they are other here too.
    expect(even.counts.labels).toMatchObject({ l02: 1, l12: 1, other: 2 });
    expect(even.counts.labels.l14).toBeUndefined();
  });

  it('a held request that passes later leaves the store, and its laboratory filter is empty', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(3));
    w.setDecode((input) => ({
      groups: input.keys.map((key) => (key === 'REQ0002'
        ? { key, held: true, findings: [1], laboratory: at('A') } : { ...pass(key), laboratory: at('A') })),
    }));
    await w.svc.start(START);
    await drive(w.svc);
    expect((await w.svc.held(PLUGIN, SRC, { laboratory: 'A', offset: 0, limit: 10 })).total).toBe(1);

    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ ...pass(key), laboratory: at('A') })) }));
    await w.svc.start(START);
    await drive(w.svc);
    expect(await w.heldAll()).toEqual({ rows: [], total: 0 });
    expect(await w.svc.held(PLUGIN, SRC, { laboratory: 'A', offset: 0, limit: 10 })).toEqual({ rows: [], total: 0 });
    expect((await w.svc.get(PLUGIN, CHECK))!.laboratories).toEqual([lab('A', 3, 3, 0, 0, { passed: 3 })]);
  });

  it('a page gets no laboratories when no request named one, and every entry once one did', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    // No codes at all: the record keeps its null entry, the page gets none.
    await w.svc.start(START);
    await drive(w.svc);
    const none = (await w.svc.get(PLUGIN, CHECK))!;
    expect(none.laboratories).toEqual([lab(null, 4, 4, 0, 0, { passed: 4 })]);
    expect(checkForPage(none).laboratories).toEqual([]);
    expect(checkForPage(none).counts).toMatchObject({ read: 4, saved: 4 });

    // One real code and requests that named none: both entries, the null one included.
    w.setDecode((input) => ({ groups: input.keys.map((key) => (key === 'REQ0001' ? { ...pass(key), laboratory: at('A') } : pass(key))) }));
    await w.svc.start(START);
    await drive(w.svc);
    const mixed = checkForPage((await w.svc.get(PLUGIN, CHECK))!);
    expect(mixed.laboratories).toEqual([lab('A', 1, 1, 0, 0, { passed: 1 }), lab(null, 3, 3, 0, 0, { passed: 3 })]);

    // A start again that names no code: none again.
    w.setDecode((input) => ({ groups: input.keys.map(pass) }));
    const again = await w.svc.start(START);
    expect(checkForPage(again).laboratories).toEqual([]);
    await drive(w.svc);
    expect(checkForPage((await w.svc.get(PLUGIN, CHECK))!).laboratories).toEqual([]);
  });

  it('a label or a code named like a property every object has still counts as itself', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    const codes = ['constructor', 'constructor', '__proto__', 'toString', 'A', 'A'];
    const labels = ['constructor', 'constructor', 'tostring', 'constructor', 'hasownproperty', 'passed'];
    w.setDecode((input) => ({
      groups: input.keys.map((key) => {
        const i = Number(key.slice(3)) - 1;
        return { ...pass(key), label: labels[i], laboratory: at(codes[i]) };
      }),
    }));
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run.counts.labels).toEqual({ constructor: 3, tostring: 1, hasownproperty: 1, passed: 1 });
    expect(run.laboratories).toEqual([
      lab('constructor', 2, 2, 0, 0, { constructor: 2 }),
      lab('__proto__', 1, 1, 0, 0, { tostring: 1 }),
      lab('toString', 1, 1, 0, 0, { constructor: 1 }),
      lab('A', 2, 2, 0, 0, { hasownproperty: 1, passed: 1 }),
    ]);
    expectSums(run);
    // Stored and shown as plain JSON objects of the same shape.
    const stored = (await w.stored())!;
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    expect(stored.counts.labels).toEqual(run.counts.labels);
    expect(Object.getPrototypeOf(run.counts.labels)).toBe(Object.prototype);
    for (const l of run.laboratories!) expect(Object.getPrototypeOf(l.counts.labels)).toBe(Object.prototype);
    expect(checkForPage(run).laboratories).toEqual(run.laboratories);
  });

  it('a run stored before laboratories were counted is driven on without them', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    const started = await w.svc.start({ ...START, pageSize: 2 });
    const { laboratories: _none, ...older } = started;
    const orphan = {
      ...older, status: 'running', driver: 'server-old', cursor: 'REQ0002',
      counts: { read: 2, saved: 2, held: 0, failed: 0, resources: 2, labels: { passed: 2 } },
      updatedAt: new Date(w.clock.now - STALE_MS - 1000).toISOString(),
    };
    await w.raw.put(PLUGIN, '__import-checks', CHECK, orphan);
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ ...pass(key), laboratory: at('A') })) }));
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    // Counting only the pages after the takeover would not add up to the run, so it counts none.
    expect(run).toMatchObject({ status: 'completed', counts: { read: 4, saved: 4 } });
    expect('laboratories' in run).toBe(false);
    expect('laboratories' in (await w.stored())!).toBe(false);
  });
});

describe('check: final fix wave, a stopped or failed check carries on (design 11.1)', () => {
  /** Held, failed and saved requests over three laboratories and three labels, the same every time. */
  const mixed = (input: DecodeInput) => ({
    groups: input.keys.map((key): Group => {
      const n = Number(key.slice(3));
      const laboratory = { code: `LAB${n % 3}` };
      if (n % 5 === 0) return { key, held: true, findings: { n }, label: 'held_x', laboratory };
      if (n % 7 === 0) return { key, error: 'BAD_DATE', label: 'bad_date', laboratory };
      return { ...pass(key), laboratory, label: n % 2 ? 'odd' : 'even' };
    }),
  });
  /** Decodes with `mixed`, and asks for a stop while page `at` is decoded. */
  const stopOnPage = (w: World, at: number) => {
    let pages = 0;
    w.setDecode(async (input) => {
      pages += 1;
      if (pages === at) await w.svc.stop(PLUGIN, CHECK, ADMIN);
      return mixed(input);
    });
  };
  const startMeta = (w: World) => w.audited.filter((e) => e.action === 'import.check.start').map((e) => e.metadata?.carriedOn);
  /** The counts and the laboratories of a run that never stopped, read from the first key. */
  async function wholeRun(w: World) {
    w.setDecode(mixed);
    const fresh = await w.svc.start({ ...START, pageSize: 4, fromStart: true });
    expect(fresh).toMatchObject({ cursor: null, counts: { read: 0 }, laboratories: [] });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, CHECK))!;
    expect(run.status).toBe('completed');
    return { counts: run.counts, laboratories: run.laboratories };
  }

  it('a stopped check carries on from its next page with its counts and held rows, and ends as a run that never stopped', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(20));
    stopOnPage(w, 2);
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    const stopped = (await w.stored())!;
    expect(stopped).toMatchObject({ status: 'stopped', cursor: 'REQ0008', counts: { read: 8, saved: 6, held: 1, failed: 1 } });
    const heldAtStop = await w.heldAll();
    expect(heldAtStop.rows.map((r) => r.key)).toEqual(['REQ0005', 'REQ0007']);

    w.setDecode(mixed);
    w.decodeCalls.length = 0;
    const again = await w.svc.start(START);
    // The run it gets back has requests already read: that is how a caller tells a carry-on.
    expect(again).toMatchObject({
      status: 'queued', cursor: 'REQ0008', pageSize: 4, finishedAt: null, lastError: null,
      counts: stopped.counts, laboratories: stopped.laboratories,
    });
    expect(await w.heldAll()).toEqual(heldAtStop);
    await drive(w.svc);
    expect(w.decodeCalls[0]!.keys).toEqual(keysOf(20).slice(8, 12));
    expect(w.decodeCalls.flatMap((c) => c.keys)).toEqual(keysOf(20).slice(8));
    const carried = (await w.svc.get(PLUGIN, CHECK))!;
    expect(carried.status).toBe('completed');
    // heldAt moves when a row is written again, so the rows are compared without it.
    const heldShape = async () => (await w.heldAll()).rows.map(({ heldAt: _at, ...r }) => r);
    const carriedHeld = await heldShape();

    const whole = await wholeRun(w);
    expect({ counts: carried.counts, laboratories: carried.laboratories }).toEqual(whole);
    expect(whole.counts).toMatchObject({ read: 20, held: 4, failed: 2 });
    expect(carriedHeld).toEqual(await heldShape());
    expect(carriedHeld).toHaveLength(6);
    // The audit row of each start says which it was.
    expect(startMeta(w)).toEqual([false, true, false]);
  });

  it('a failed check carries on from its last page once the fault is gone, and ends as a run that never failed', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(20));
    w.setDecode(mixed);
    // REQ0005, on the second page, is held. Its write fails on every try, so the run fails there.
    w.failHeldPuts(6);
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    const failed = (await w.stored())!;
    expect(failed).toMatchObject({ status: 'failed', cursor: 'REQ0004', counts: { read: 4 } });
    expect(failed.lastError).toMatch(/on 6 tries of one page in a row/);

    const again = await w.svc.start(START);
    expect(again).toMatchObject({ status: 'queued', cursor: 'REQ0004', counts: failed.counts, lastError: null });
    await drive(w.svc);
    const carried = (await w.svc.get(PLUGIN, CHECK))!;
    expect(carried).toMatchObject({ status: 'completed', lastError: null });
    expect({ counts: carried.counts, laboratories: carried.laboratories }).toEqual(await wholeRun(w));
    expect(startMeta(w)).toEqual([false, true, false]);
  });

  it('a run taken over from a dead server carries on, and ends as a run that never stopped', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(20));
    stopOnPage(w, 2);
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    // The same record as a server that died while running would leave it.
    const stopped = (await w.stored())!;
    await w.raw.put(PLUGIN, '__import-checks', CHECK, {
      ...stopped, status: 'running', driver: 'server-old', finishedAt: null,
      updatedAt: new Date(w.clock.now - STALE_MS - 1000).toISOString(),
    });
    w.setDecode(mixed);
    w.decodeCalls.length = 0;
    await drive(w.service('server-b'));
    expect(w.decodeCalls[0]!.keys).toEqual(keysOf(20).slice(8, 12));
    expect(actions(w)).toContain('import.check.takeover');
    const carried = (await w.svc.get(PLUGIN, CHECK))!;
    expect(carried.status).toBe('completed');
    expect({ counts: carried.counts, laboratories: carried.laboratories }).toEqual(await wholeRun(w));
  });

  /** A run stopped after two pages of two, with four requests read. */
  async function stoppedAtFour(w: World, start: { referenceCopyId?: string | null } = {}) {
    let pages = 0;
    w.setDecode(async (input) => {
      pages += 1;
      if (pages === 2) await w.svc.stop(PLUGIN, CHECK, ADMIN);
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, ...start, pageSize: 2 });
    await drive(w.svc);
    w.setDecode((input) => ({ groups: input.keys.map(pass) }));
    expect(await w.stored()).toMatchObject({ status: 'stopped', cursor: 'REQ0004', counts: { read: 4, saved: 4 } });
  }
  const begunAtFirstKey = { status: 'queued', cursor: null, counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} }, laboratories: [] };

  it('a check begins at the first key when it completed, or when the caller asks', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    await stoppedAtFour(w);
    expect(await w.svc.start({ ...START, fromStart: true })).toMatchObject(begunAtFirstKey);
    await drive(w.svc);
    expect((await w.stored())!).toMatchObject({ status: 'completed', counts: { read: 6 } });
    // A completed run begins again at the first key, with or without fromStart.
    expect(await w.svc.start(START)).toMatchObject(begunAtFirstKey);
    expect(startMeta(w)).toEqual([false, false, false]);
  });

  it('a check begins at the first key when its options or its reference differ from the run', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [] });
    await stoppedAtFour(w);
    expect(await w.svc.start({ ...START, options: { site: 'B' } })).toMatchObject({ ...begunAtFirstKey, options: { site: 'B' } });

    await w.svc.stop(PLUGIN, CHECK, ADMIN);
    await stoppedAtFour(w);
    expect(await w.svc.start({ ...START, referenceCopyId: REF })).toMatchObject({ ...begunAtFirstKey, referenceCopyId: REF });

    await w.svc.stop(PLUGIN, CHECK, ADMIN);
    await stoppedAtFour(w, { referenceCopyId: REF });
    expect(await w.svc.start(START)).toMatchObject({ ...begunAtFirstKey, referenceCopyId: null });

    // Same options, same reference: it carries on.
    await w.svc.stop(PLUGIN, CHECK, ADMIN);
    await stoppedAtFour(w, { referenceCopyId: REF });
    expect(await w.svc.start({ ...START, referenceCopyId: REF })).toMatchObject({ status: 'queued', cursor: 'REQ0004', counts: { read: 4 } });
  });

  it('a check begins at the first key when its source or its reference was read again since it began', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [] });
    const later = (s: number) => new Date(w.clock.now + s * 1000).toISOString();

    await stoppedAtFour(w);
    await w.setCopyStatus(SRC, 'completed', { finishedAt: later(1) });
    expect(await w.svc.start(START)).toMatchObject(begunAtFirstKey);

    await w.svc.stop(PLUGIN, CHECK, ADMIN);
    await stoppedAtFour(w, { referenceCopyId: REF });
    await w.setCopyStatus(REF, 'completed', { finishedAt: later(2) });
    expect(await w.svc.start({ ...START, referenceCopyId: REF })).toMatchObject({ ...begunAtFirstKey, referenceCopyId: REF });

    // A record from before a check could carry on does not say which copy it read, so it begins again.
    await w.svc.stop(PLUGIN, CHECK, ADMIN);
    await stoppedAtFour(w);
    const { copyFinishedAt: _gone, ...older } = (await w.stored())! as CheckRun & { copyFinishedAt?: unknown };
    await w.raw.put(PLUGIN, '__import-checks', CHECK, older);
    expect(await w.svc.start(START)).toMatchObject(begunAtFirstKey);
  });

  it('a carry-on keeps the page size unless one is given', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    await stoppedAtFour(w);
    expect(await w.svc.start(START)).toMatchObject({ cursor: 'REQ0004', pageSize: 2 });
    await w.svc.stop(PLUGIN, CHECK, ADMIN);
    expect(await w.svc.start({ ...START, pageSize: 3 })).toMatchObject({ cursor: 'REQ0004', pageSize: 3 });
  });
});

describe('check: final fix wave, a revoked connector stops a check (design 11.3)', () => {
  const NOT_ALLOWED = (copyId: string) => `the plugin is no longer allowed to read the connector of copy ${copyId}`;

  it('start refuses a source or a reference whose connector the plugin may no longer read, and audits nothing', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [] });
    w.revoke('c2');
    await expect(w.svc.start({ ...START, referenceCopyId: REF })).rejects.toThrow(NOT_ALLOWED(REF));
    w.revoke('c1');
    await expect(w.svc.start(START)).rejects.toThrow(NOT_ALLOWED(SRC));
    expect(w.audited).toEqual([]);
    expect(await w.stored()).toBeNull();
  });

  it('a revoke after the start fails the run with a fixed sentence before it reads or saves anything', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(4));
    await w.svc.start(START);
    w.revoke('c1');
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'failed', lastError: NOT_ALLOWED(SRC), counts: { read: 0 } });
    expect(w.decodeCalls).toEqual([]);
    expect(w.persisted).toEqual([]);
    expect(w.audited.at(-1)).toMatchObject({ action: 'import.check.finish', metadata: { status: 'failed' } });
  });

  it('a revoke while the check runs saves nothing more after the page in hand', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    let pages = 0;
    w.setDecode((input) => {
      pages += 1;
      if (pages === 1) w.revoke('c1');
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'failed', lastError: NOT_ALLOWED(SRC), cursor: 'REQ0002', counts: { read: 2, saved: 2 } });
    expect(w.decodeCalls).toHaveLength(1);
    expect(w.persisted).toHaveLength(2);
  });

  it('a revoke of the reference connector while the check runs fails it too', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(6));
    await w.seedCopy(REF, 'c2', 'completed', { twins: [] });
    let pages = 0;
    w.setDecode((input) => {
      pages += 1;
      if (pages === 1) w.revoke('c2');
      return { groups: input.keys.map(pass) };
    });
    await w.svc.start({ ...START, referenceCopyId: REF, pageSize: 2 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'failed', lastError: NOT_ALLOWED(REF), counts: { read: 2 } });
    expect(w.persisted).toHaveLength(2);
  });
});

describe('check: final fix wave, held requests read by key, and the copy remove (design 11.2, 11.4)', () => {
  it('heldItems reads by after with next, and by offset as before', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(5));
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true, findings: { key } })) }));
    await w.svc.start(START);
    await drive(w.svc);
    const p1 = await w.svc.heldItems(PLUGIN, SRC, { after: null, limit: 2 });
    expect([p1.items.map((i) => i.key), p1.total, p1.next]).toEqual([['REQ0001', 'REQ0002'], 5, 'REQ0002']);
    const p3 = await w.svc.heldItems(PLUGIN, SRC, { after: 'REQ0004', limit: 2 });
    expect([p3.items.map((i) => i.key), p3.next]).toEqual([['REQ0005'], null]);
    expect(await w.svc.heldItems(PLUGIN, SRC, { offset: 1, limit: 1 })).toEqual({ items: [await plainHeld(w, 'REQ0002')], total: 5 });
    await expect(w.svc.heldItems(PLUGIN, 'nope', { after: null, limit: 2 })).rejects.toThrow('copy nope not found');
  });

  it('isLiveCheck names the statuses that still add and remove held rows', () => {
    const live = (['queued', 'running', 'waiting', 'stopping', 'stopped', 'completed', 'failed'] as const).filter(isLiveCheck);
    expect(live).toEqual(['queued', 'running', 'waiting', 'stopping']);
  });

  it('removing a copy removes its check record, after its held rows', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(3));
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true })) }));
    await w.svc.start(START);
    await drive(w.svc);
    expect(await w.stored()).not.toBeNull();
    await w.copies.remove(PLUGIN, SRC, ADMIN);
    await w.copies.tick();
    await w.copies.idle();
    expect(await w.stored()).toBeNull();
    expect((await w.heldAll()).total).toBe(0);
    // A copy made again on the same connector shows no old run.
    await sourceCopy(w, keysOf(3));
    expect(await w.svc.list(PLUGIN)).toEqual([]);
  });
});

describe('held corrections (design 2026-11-18-held-corrections)', () => {
  const FIELDS = ['dob_age', 'sex'];
  /** The plugin holds a request unless its decode input corrects dob_age, and sends the values as read. */
  const holdUnlessCorrected = (input: DecodeInput & { corrections?: Record<string, Array<{ field: string; value: string | null }>> }) => ({
    groups: input.keys.map((key): Group => {
      const fixed = (input.corrections?.[key] ?? []).some((c) => c.field === 'dob_age');
      return fixed
        ? pass(key)
        : { key, held: true, findings: [{ class: 'dob_after_specimen_date' }], check: null, label: 'held_rules', fields: { dob_age: '2024-03-11', sex: 'F' } };
    }),
  });
  async function heldRun(w: World, keys = keysOf(2)) {
    await sourceCopy(w, keys);
    w.setDecode(holdUnlessCorrected);
    await w.svc.start({ ...START, pageSize: 10 });
    await drive(w.svc);
  }
  const correctInput = (over: Record<string, unknown> = {}) => ({
    pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', values: { dob_age: '2023-03-11' }, reason: 'Year typed wrong', actor: ADMIN, ...over,
  });

  it('keeps the values as read with a held request, and offers the declared fields', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    const item = await w.svc.heldItem(PLUGIN, SRC, 'REQ0001');
    expect(item).toMatchObject({ reason: 'held', fields: { dob_age: '2024-03-11', sex: 'F' }, corrections: [], correctable: FIELDS });
  });

  it('stores a correction with the value it replaces, and audits it without the key', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    const out = await w.svc.correct(correctInput());
    expect(out.corrections).toEqual([expect.objectContaining({ field: 'dob_age', value: '2023-03-11', original: '2024-03-11', reason: 'Year typed wrong', correctedBy: 'admin' })]);
    const audit = w.audited.find((e) => e.action === 'import.check.correct')!;
    expect(audit).toMatchObject({ pluginId: PLUGIN, actor: ADMIN, metadata: { copyId: SRC, fields: ['dob_age'] } });
    expect(JSON.stringify(audit)).not.toContain('REQ0001');
    expect(JSON.stringify(audit)).not.toContain('2023-03-11');
  });

  it('refuses an undeclared field, an empty reason, a request that is not held, and a plugin that declares none', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await expect(w.svc.correct(correctInput({ values: { therapy: 'ART' } }))).rejects.toThrow(/therapy cannot be corrected/);
    await expect(w.svc.correct(correctInput({ reason: '  ' }))).rejects.toThrow(/reason/);
    await expect(w.svc.correct(correctInput({ key: 'REQ9999' }))).rejects.toThrow(/not held/);
    const plain = await world();
    await heldRun(plain);
    await expect(plain.svc.correct(correctInput())).rejects.toThrow(/declares no fields/);
  });

  it('checks a corrected request again: it is saved, leaves the held list, and the counts move from held to saved', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    const before = (await w.stored())!;
    expect(before).toMatchObject({ status: 'completed', counts: { read: 2, held: 2, saved: 0 } });
    await w.svc.correct(correctInput());
    const queued = await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    expect(queued.status).toBe('queued');
    const callsBefore = w.decodeCalls.length;
    await drive(w.svc);
    const calls = w.decodeCalls.slice(callsBefore) as Array<DecodeInput & { corrections?: unknown }>;
    expect(calls.map((c) => c.keys)).toEqual([['REQ0001']]);
    expect(calls[0]!.corrections).toEqual({ REQ0001: [expect.objectContaining({ field: 'dob_age', value: '2023-03-11', original: '2024-03-11', reason: 'Year typed wrong', by: 'admin' })] });
    const after = (await w.stored())!;
    expect(after).toMatchObject({ status: 'completed', cursor: before.cursor, finishedAt: before.finishedAt, counts: { read: 2, held: 1, saved: 1 } });
    expect(after.recheck).toBeUndefined();
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toBeNull();
    expect(w.persisted.at(-1)!.resources).toEqual([{ resourceType: 'ServiceRequest', id: 'REQ0001' }]);
    expect(actions(w)).toContain('import.check.recheck');
  });

  it('a recheck that still fails leaves the request held with its new findings, and the counts as they were', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput({ values: { sex: 'M' } }));
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    await drive(w.svc);
    expect((await w.stored())!).toMatchObject({ status: 'completed', counts: { read: 2, held: 2, saved: 0 } });
    expect((await w.svc.heldItem(PLUGIN, SRC, 'REQ0001'))).toMatchObject({ reason: 'held', corrections: [expect.objectContaining({ field: 'sex', value: 'M' })] });
  });

  it('refuses a recheck while a check of the copy is live, and of a key that is not held', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ9999', actor: ADMIN })).rejects.toThrow(/not held/);
    await w.svc.start({ ...START, pageSize: 10, fromStart: true });
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN })).rejects.toThrow(/is queued/);
  });

  it('a refused audit stores no correction (review H6)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    w.refuseAudit.add('import.check.correct');
    await expect(w.svc.correct(correctInput())).rejects.toThrow();
    expect((await w.corrections.listFor(SRC, ['REQ0001'])).size).toBe(0);
  });

  it('keeps only the fields the request sent, and refuses a field this request does not have (review H2)', async () => {
    const w = await world({ corrections: [...FIELDS, 'analysed'] });
    await heldRun(w);
    const item = await w.svc.heldItem(PLUGIN, SRC, 'REQ0001');
    expect(Object.keys(item!.fields ?? {}).sort()).toEqual(['dob_age', 'sex']);
    await expect(w.svc.correct(correctInput({ values: { analysed: '2024-01-01' } }))).rejects.toThrow(/analysed cannot be corrected for this request/);
  });

  it('a recheck replayed by a second driver after a cut counts nothing twice (review H3)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    await drive(w.svc);
    const done = (await w.stored())!;
    expect(done.counts).toMatchObject({ read: 2, saved: 1, held: 1 });
    // A second driver meets the run as a cut left it: still rechecking, counts already moved.
    await w.raw.put(PLUGIN, '__import-checks', CHECK, { ...done, rev: done.rev + 1, status: 'queued', recheck: { keys: ['REQ0001'], returnTo: 'completed', finishedAt: done.finishedAt } });
    await drive(w.service('server-2'));
    expect((await w.stored())!.counts).toMatchObject({ read: 2, saved: 1, held: 1 });
  });

  it('rechecking a request held by an earlier pass leaves the counts of this pass alone (review H4)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w, keysOf(2));
    // A new pass from the first key, stopped before it reached anything: its counts start at 0.
    const run = (await w.stored())!;
    await w.raw.put(PLUGIN, '__import-checks', CHECK, { ...run, rev: run.rev + 1, status: 'stopped', cursor: null, pass: 'a-later-pass',
      counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} }, laboratories: [] });
    await w.svc.correct(correctInput({ key: 'REQ0002' }));
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0002', actor: ADMIN });
    await drive(w.svc);
    const after = (await w.stored())!;
    expect(after.counts).toMatchObject({ read: 0, saved: 0, held: 0 });
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0002')).toBeNull();
  });

  it('a cut after the counts were saved but before the held row went only finishes the removal (re-review H3)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    const run = (await w.stored())!;
    // The state a cut leaves: the page's counts saved, its key marked done as saved, the held row still there.
    await w.raw.put(PLUGIN, '__import-checks', CHECK, {
      ...run, rev: run.rev + 1, status: 'queued',
      counts: { ...run.counts, held: run.counts.held - 1, saved: run.counts.saved + 1, labels: {} },
      recheck: { keys: ['REQ0001'], returnTo: 'completed', finishedAt: run.finishedAt, done: [{ key: 'REQ0001', outcome: 'saved' }] },
    });
    const calls = w.decodeCalls.length;
    await drive(w.svc);
    expect(w.decodeCalls.length).toBe(calls);
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toBeNull();
    expect((await w.stored())!.counts).toMatchObject({ read: 2, saved: 1, held: 1 });
  });

  it('a recheck that keeps an earlier pass\'s request held keeps its pass, so a later recheck still leaves the counts alone (re-review H4)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w, keysOf(2));
    const run = (await w.stored())!;
    const oldPass = (await w.realHeld.get(SRC, 'REQ0002'))!.pass;
    await w.raw.put(PLUGIN, '__import-checks', CHECK, { ...run, rev: run.rev + 1, status: 'stopped', cursor: null, pass: 'a-later-pass',
      counts: { read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} }, laboratories: [] });
    // First recheck: a correction that does not fix it. Still held, still the old pass.
    await w.svc.correct(correctInput({ key: 'REQ0002', values: { sex: 'M' } }));
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0002', actor: ADMIN });
    await drive(w.svc);
    expect((await w.realHeld.get(SRC, 'REQ0002'))!.pass).toBe(oldPass);
    // Second recheck: fixed this time. Saved, and this pass's counts untouched.
    await w.svc.correct(correctInput({ key: 'REQ0002' }));
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0002', actor: ADMIN });
    await drive(w.svc);
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0002')).toBeNull();
    expect((await w.stored())!.counts).toMatchObject({ read: 0, saved: 0, held: 0 });
  });

  it('when removing the held row fails after the counts were saved, the retry removes it and counts once (re-review H3)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    w.failHeldRemoves(1);
    await drive(w.svc);
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toBeNull();
    expect((await w.stored())!).toMatchObject({ status: 'completed', counts: { read: 2, saved: 1, held: 1 } });
  });

  it('a cut after a still-held recheck rewrote its row takes away the decision it replaced, not the new one (re-review H3, labels)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    expect((await w.stored())!.counts.labels).toEqual({ held_rules: 2 });
    await w.svc.correct(correctInput({ values: { sex: 'M' } }));
    const queued = await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    // The plugin still holds it, now for the check rather than the rules.
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true, findings: [], check: { status: 'failed' }, label: 'held_check', fields: { dob_age: '2024-03-11', sex: 'F' } })) }));
    // A cut after the held row was rewritten but before the counts were saved.
    const pre = (await w.stored())!;
    await w.realHeld.put({ ...(await w.realHeld.get(SRC, 'REQ0001'))!, label: 'held_check' });
    await w.raw.put(PLUGIN, '__import-checks', CHECK, { ...pre, rev: pre.rev + 1 });
    expect(queued.status).toBe('queued');
    await drive(w.svc);
    expect((await w.stored())!.counts).toMatchObject({ read: 2, held: 2, labels: { held_rules: 1, held_check: 1 } });
  });

  it('removes a held row only once the stored run already shows its key as done, even when run writes fail (re-review H3, writes)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    let left = 2;
    w.failRunWrites((doc) => (doc.recheck?.done?.length ?? 0) > 0 && left-- > 0);
    const stateAtRemoval: Array<CheckRun | null> = [];
    w.watchHeldRemoves(async (_copy, keys) => { if (keys.includes('REQ0001')) stateAtRemoval.push(await w.stored()); });
    await drive(w.svc);
    // Whatever the faults left, another driver finishes it once the first has gone quiet.
    w.clock.now += STALE_MS + 1000;
    await drive(w.service('server-2'));
    expect(stateAtRemoval.length).toBeGreaterThan(0);
    for (const stored of stateAtRemoval) {
      expect(stored?.recheck?.done).toEqual([{ key: 'REQ0001', outcome: 'saved' }]);
      expect(stored?.counts).toMatchObject({ saved: 1, held: 1 });
    }
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toBeNull();
    expect((await w.stored())!).toMatchObject({ status: 'completed', counts: { read: 2, saved: 1, held: 1 } });
  });

  it('a recheck that gives up on unsaved counts leaves the counts and the held list agreeing, and a later recheck works (re-review H3, give up)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    w.failRunWrites((doc) => (doc.recheck?.done?.length ?? 0) > 0);
    await drive(w.svc);
    const after = (await w.stored())!;
    expect(after.recheck).toBeUndefined();
    expect(after.counts).toMatchObject({ read: 2, saved: 0, held: 2 });
    expect((await w.heldAll()).total).toBe(2);
    // The writes work again: checking it again saves it, once.
    w.failRunWrites(null);
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    await drive(w.svc);
    expect(await w.svc.heldItem(PLUGIN, SRC, 'REQ0001')).toBeNull();
    expect((await w.stored())!.counts).toMatchObject({ read: 2, saved: 1, held: 1 });
  });

  it('a still-held recheck that gives up keeps counts matching its rewritten row, and a later recheck counts once (re-review H3, held give up)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput({ values: { sex: 'M' } }));
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true, findings: [], check: { status: 'failed' }, label: 'held_check', fields: { dob_age: '2024-03-11', sex: 'F' } })) }));
    w.failRunWrites((doc) => (doc.recheck?.done?.length ?? 0) > 0);
    await drive(w.svc);
    const labelsOfRows = (await w.heldAll()).rows.map((r) => r.label).sort();
    const counts = (await w.stored())!.counts;
    const expected: Record<string, number> = {};
    for (const l of labelsOfRows) expected[l!] = (expected[l!] ?? 0) + 1;
    expect(counts.labels).toEqual(expected);
    expect(counts).toMatchObject({ read: 2, held: 2 });
    w.failRunWrites(null);
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    await drive(w.svc);
    expect((await w.stored())!.counts).toMatchObject({ read: 2, held: 2, labels: { held_rules: 1, held_check: 1 } });
  });

  it('settling a recheck that gave up counts an error row as failed (re-review H3, A)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    w.failPersist(() => Object.assign(new Error('disk full'), { code: '53100' }));
    w.failRunWrites((doc) => (doc.recheck?.done?.length ?? 0) > 0);
    await drive(w.svc);
    const rows = (await w.heldAll()).rows;
    const counts = (await w.stored())!.counts;
    expect(counts.failed).toBe(rows.filter((r) => r.reason === 'error').length);
    expect(counts.held).toBe(rows.filter((r) => r.reason === 'held').length);
  });

  it('a settle that cannot read the held rows leaves the recheck to be taken over, and the counts end right (re-review H3, B)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput({ values: { sex: 'M' } }));
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    w.setDecode((input) => ({ groups: input.keys.map((key) => ({ key, held: true, findings: [], check: { status: 'failed' }, label: 'held_check', fields: { dob_age: '2024-03-11', sex: 'F' } })) }));
    let failing = true;
    let armed = false;
    // Every write carrying the done mark fails; the first one also makes the next held read fail.
    w.failRunWrites((doc) => {
      const reject = failing && (doc.recheck?.done?.length ?? 0) > 0;
      if (reject && !armed) { armed = true; w.failHeldGets(1); }
      return reject;
    });
    await w.svc.tick();
    await w.svc.idle();
    // Whatever the first driver managed, writes and reads recover and another driver takes over.
    failing = false;
    w.clock.now += STALE_MS + 1000;
    await drive(w.service('server-2'));
    const rows = (await w.heldAll()).rows.map((r) => r.label).sort();
    expect(rows).toEqual(['held_check', 'held_rules']);
    expect((await w.stored())!.counts).toMatchObject({ read: 2, held: 2, labels: { held_rules: 1, held_check: 1 } });
  });

  it('refuses a correction to a request a recheck already saved but has not yet taken off the held list (review H17)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    w.failHeldRemoves(100);
    await drive(w.svc);
    expect((await w.stored())!.recheck?.done).toEqual([{ key: 'REQ0001', outcome: 'saved' }]);
    expect(await w.realHeld.get(SRC, 'REQ0001')).not.toBeNull();
    w.failHeldRemoves(0);
    await expect(w.svc.correct(correctInput({ values: { dob_age: '2022-03-11' } }))).rejects.toThrow(/already saved/);
    expect((await w.corrections.listFor(SRC, ['REQ0001'])).get('REQ0001')!.map((c) => c.value)).toEqual(['2023-03-11']);
  });

  it('refuses a correction while a recheck of the source is running, so no edit goes unapplied (review H17, live)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    let second: string | null = null;
    w.setDecode(async (input) => {
      // While the recheck decodes, another person tries a newer value, and the decode waits for it.
      second ??= await w.svc.correct(correctInput({ values: { dob_age: '2022-03-11' } })).then(() => 'accepted', (e: Error) => e.message);
      return holdUnlessCorrected(input);
    });
    await drive(w.svc);
    expect(second).toMatch(/is running|is queued/);
    expect((await w.corrections.listFor(SRC, ['REQ0001'])).get('REQ0001')!.map((c) => c.value)).toEqual(['2023-03-11']);
  });

  it('a recheck whose corrections changed while it decoded decides nothing for that request (review H17, window)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    const before = (await w.stored())!.counts;
    w.setDecode(async (input) => {
      // A correction written in the window between another person's check and their write.
      await w.corrections.put({ copyId: SRC, key: 'REQ0001', field: 'dob_age', value: '2022-03-11', original: '2024-03-11', reason: 'later', correctedBy: 'baraka', correctedAt: new Date(w.clock.now + 1000) });
      return holdUnlessCorrected(input);
    });
    const persisted = w.persisted.length;
    await drive(w.svc);
    expect(w.persisted.length).toBe(persisted);
    expect(await w.realHeld.get(SRC, 'REQ0001')).not.toBeNull();
    expect((await w.stored())!.counts).toMatchObject({ read: before.read, saved: before.saved, held: before.held });
  });

  it('a correction and a recheck take turns: a recheck cannot start while a correction is being saved (review H17, order)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    // A second correction passes its checks, then waits inside its audit write before storing.
    const release = w.gateAudit('import.check.correct');
    const pending = w.svc.correct(correctInput({ values: { dob_age: '2022-03-11' } }));
    await new Promise((r) => setTimeout(r, 20));
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN })).rejects.toThrow(/correction is being saved/);
    await expect(w.svc.start({ ...START, pageSize: 10 })).rejects.toThrow(/correction is being saved/);
    release();
    await pending;
    // Now the recheck runs, with the newer value.
    w.setDecode(holdUnlessCorrected);
    const calls = w.decodeCalls.length;
    await w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    await drive(w.svc);
    const sent = (w.decodeCalls.slice(calls)[0] as DecodeInput & { corrections?: Record<string, Array<{ field: string; value: string }>> }).corrections;
    expect(sent?.REQ0001?.find((c) => c.field === 'dob_age')?.value).toBe('2022-03-11');
  });

  it('the turn-taking holds across two service instances that share the stores, as the CLI and the server do (review H17, order)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    const cli = w.service('cli-process');
    const release = w.gateAudit('import.check.correct');
    const pending = cli.correct(correctInput({ values: { dob_age: '2022-03-11' } }));
    await new Promise((r) => setTimeout(r, 20));
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN })).rejects.toThrow(/correction is being saved/);
    release();
    await pending;
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN })).resolves.toMatchObject({ status: 'queued' });
  });

  it('a correction whose claim lapsed while it was paused writes nothing when it resumes (review H17, expired owner)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    const release = w.gateAudit('import.check.correct');
    const late = w.svc.correct(correctInput({ values: { dob_age: '2022-03-11' } })).then(() => 'accepted', (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 20));
    w.clock.now += 61_000;
    const other = w.service('server-2');
    await other.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    release();
    expect(await late).toMatch(/not saved/);
    expect((await w.corrections.listFor(SRC, ['REQ0001'])).get('REQ0001')!.map((c) => c.value)).toEqual(['2023-03-11']);
  });

  it('a correction that read the row before another instance saved it is refused at its write (review H17, stale row)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    const release = w.gateNextHeldGet();
    const late = w.svc.correct(correctInput({ values: { dob_age: '2022-03-11' } })).then(() => 'accepted', (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 20));
    const other = w.service('server-2');
    await other.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN });
    await drive(other);
    expect(await w.realHeld.get(SRC, 'REQ0001')).toBeNull();
    release();
    expect(await late).toMatch(/not held|not saved/);
    expect((await w.corrections.listFor(SRC, ['REQ0001'])).get('REQ0001')!.map((c) => c.value)).toEqual(['2023-03-11']);
  });

  it('a correction claim left by a crash lapses after a minute (review H17, order)', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    const run = (await w.stored())!;
    await w.raw.put(PLUGIN, '__import-checks', CHECK, { ...run, rev: run.rev + 1, correcting: { token: 'gone', until: new Date(w.clock.now + 60_000).toISOString() } });
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN })).rejects.toThrow(/correction is being saved/);
    w.clock.now += 61_000;
    await expect(w.svc.recheck({ pluginId: PLUGIN, copyId: SRC, key: 'REQ0001', actor: ADMIN })).resolves.toMatchObject({ status: 'queued' });
  });

  it('a full run sends the stored corrections of its page, and none when the plugin declares no fields', async () => {
    const w = await world({ corrections: FIELDS });
    await heldRun(w);
    await w.svc.correct(correctInput());
    await w.svc.start({ ...START, pageSize: 10, fromStart: true });
    const callsBefore = w.decodeCalls.length;
    await drive(w.svc);
    const call = w.decodeCalls[callsBefore] as DecodeInput & { corrections?: Record<string, unknown> };
    expect(Object.keys(call.corrections ?? {})).toEqual(['REQ0001']);
    expect((await w.stored())!.counts).toMatchObject({ saved: 1, held: 1 });
    const plain = await world();
    await sourceCopy(plain, keysOf(1));
    await plain.svc.start({ ...START, pageSize: 10 });
    await drive(plain.svc);
    expect('corrections' in (plain.decodeCalls[0] as object)).toBe(false);
  });
});

// demo.4 item 11: a person correcting a held specimen picks it from the source's own list. The list
// comes from the copy's dictionaries, as the plugin reads them; CE knows nothing of the source.
describe('choices for a correctable field', () => {
  const WITH_CHOICES = { ...CHECKER, choices: 'import_choices' };

  it('asks the plugin with the copy dictionaries and keeps only correctable fields', async () => {
    const w = await world({ entrypoints: WITH_CHOICES, corrections: ['specimen', 'sex'] });
    await sourceCopy(w, keysOf(1));
    w.setChoices(() => ({ choices: { specimen: [{ code: 'FNA', description: 'Fine needle aspirate' }], ward: [{ code: 'W1', description: 'Ward one' }] } }));
    expect(await w.svc.choices(PLUGIN, SRC)).toEqual({ specimen: [{ code: 'FNA', description: 'Fine needle aspirate' }] });
    expect(w.choicesCalls).toHaveLength(1);
    const input = w.choicesCalls[0] as { fields: string[]; dictionaries: Record<string, Row[]>; options: Record<string, string> };
    expect(input.fields).toEqual(['specimen', 'sex']);
    expect(Object.keys(input.dictionaries)).toEqual(['facilities']);
    expect(input.dictionaries.facilities).toHaveLength(2);
  });

  it('is empty for a plugin that names no choices entrypoint, and never calls it', async () => {
    const w = await world({ corrections: ['specimen'] });
    await sourceCopy(w, keysOf(1));
    expect(await w.svc.choices(PLUGIN, SRC)).toEqual({});
    expect(w.choicesCalls).toHaveLength(0);
  });

  it('refuses an answer that is not valid, with a fixed sentence', async () => {
    const w = await world({ entrypoints: WITH_CHOICES, corrections: ['specimen'] });
    await sourceCopy(w, keysOf(1));
    w.setChoices(() => ({ choices: { specimen: [{ code: '', description: SECRET }] } }));
    await expect(w.svc.choices(PLUGIN, SRC)).rejects.toThrow("the plugin's choices answer was not valid");
    w.setChoices(() => { throw new Error(SECRET); });
    await expect(w.svc.choices(PLUGIN, SRC)).rejects.toThrow('the plugin refused the choices call');
  });

  it('refuses a copy the plugin may no longer read', async () => {
    const w = await world({ entrypoints: WITH_CHOICES, corrections: ['specimen'] });
    await sourceCopy(w, keysOf(1));
    w.revoke('c1');
    await expect(w.svc.choices(PLUGIN, SRC)).rejects.toThrow(/no longer allowed/);
  });
});

// demo.4 item 10: the Held back list filters by finding code and counts each code. The plugin
// names the codes with each held request; a bad code is left out, never a bad answer.
describe('held finding codes', () => {
  it('stores the codes a held group names, filters by one, and counts them', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(3));
    w.setDecode((input) => ({
      groups: [
        { key: input.keys[0], held: true, label: 'held_rules', codes: ['specimen_missing', 'specimen_missing', 'Bad Code', SECRET, 7] },
        { key: input.keys[1], held: true, label: 'held_rules', codes: ['specimen_missing', 'record_has_no_observations'] },
        { key: input.keys[2], held: true, label: 'held_rules', codes: 'not a list' },
      ],
    }));
    await w.svc.start(START);
    await drive(w.svc);
    const keysWith = async (finding: string) => (await w.svc.held(PLUGIN, SRC, { finding, offset: 0, limit: 10 })).rows.map((r) => r.key);
    expect(await keysWith('specimen_missing')).toEqual(['REQ0001', 'REQ0002']);
    expect(await keysWith('record_has_no_observations')).toEqual(['REQ0002']);
    expect((await w.svc.heldItems(PLUGIN, SRC, { finding: 'specimen_missing', after: null, limit: 10 })).items.map((i) => i.key)).toEqual(['REQ0001', 'REQ0002']);
    expect(await w.svc.heldCodes(PLUGIN, SRC, {})).toEqual([{ code: 'specimen_missing', count: 2 }, { code: 'record_has_no_observations', count: 1 }]);
    await expect(w.svc.heldCodes(PLUGIN, 'no-such-copy', {})).rejects.toThrow(/not found/);
  });
});

describe('check: decode off the main thread (item 16)', () => {
  type Call = [string, unknown, { offThread?: boolean } | undefined];

  it('with_decodeOffThread_every_decode_call_asks_for_a_worker_and_no_other_call_does', async () => {
    const w = await world({ decodeOffThread: true });
    await sourceCopy(w, keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const calls = w.invoke.mock.calls as unknown as Call[];
    const decode = calls.filter(([ep]) => ep === 'import_decode');
    expect(decode.length).toBeGreaterThan(0);
    for (const [, , opts] of decode) expect(opts).toEqual({ offThread: true });
    for (const [ep, , opts] of calls) if (ep !== 'import_decode') expect(opts?.offThread).toBeUndefined();
  });

  it('without_it_no_call_asks_for_a_worker', async () => {
    const w = await world();
    await sourceCopy(w, keysOf(2));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    for (const [, , opts] of w.invoke.mock.calls as unknown as Call[]) expect(opts?.offThread).toBeUndefined();
  });
});
