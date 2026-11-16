import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImportCopyStore, createPluginDataStore, type ImportCopyStore, type PluginDataStore } from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { STALE_MS, createImportService, type ImportActor, type ImportAuditEvent, type ImportService } from './import-run';
import { CopySetChangedError, copyIdOf, createImportCopyService, type CopyRun, type ImportCopyService } from './import-copy';

// Layer under test: the copy service and the real page reader, over the real plugin_data store and
// the real copy row store on pg-mem. The plugin (wasm), the source database, its errors and the
// reader's waits are fakes. Two services on one database stand for two processes.
// Not covered here: real SQL Server and the errors tedious really throws, real wasm, real Postgres
// (jsonb key order, a NUL refused by jsonb, a transaction that rolls back, a full disk).

const ADMIN: ImportActor = { type: 'user', id: 'u-admin', name: 'admin' };
const PLUGIN = 'v1-import';
const COPY = copyIdOf(PLUGIN, 'c1');

const reqKeys = (from?: string) =>
  `SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > {{after}}${from ? ` AND [RegisteredDateTime] >= '${from}'` : ''} ORDER BY [RequestID]`;
const REQ_ROWS = 'SELECT [RequestID] AS [__key], * FROM [dbo].[Requests] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID]';
const RES_ROWS = 'SELECT [RequestID] AS [__key], * FROM [dbo].[LabResults] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID]';
const FAC_KEYS = 'SELECT TOP ({{limit}}) [FacilityCode], [Name] FROM [dbo].[Facilities] WHERE [FacilityCode] > {{after}} ORDER BY [FacilityCode]';

const requestsSet = (from?: string, resSql = RES_ROWS) => ({
  name: 'requests', keyQuery: { sql: reqKeys(from) },
  detailQueries: [{ name: 'requests', sql: REQ_ROWS }, { name: 'results', sql: resSql }],
});
const facilitiesSet = { name: 'facilities', keyQuery: { sql: FAC_KEYS }, detailQueries: [] };

function manifest(over: { id?: string; version?: string; capabilities?: unknown[]; entrypoints?: Record<string, string> } = {}) {
  return {
    schemaVersion: 1, type: 'plugin', id: over.id ?? PLUGIN, version: over.version ?? '1.2.0',
    capabilities: over.capabilities ?? [{ kind: 'host:import' }],
    payload: {
      kind: 'plugin', entrypoints: ['import_copy', 'import_queries', 'import_map'],
      importSource: { connectorTypes: ['microsoft-sql'], sourceSystem: 'openldr-v1', entrypoints: over.entrypoints ?? { copy: 'import_copy' } },
    },
  };
}

const missingTable = () => Object.assign(new Error("Invalid object name 'dbo.LabResults'."), { code: 'EREQUEST', number: 208 });
const cutLink = () => Object.assign(new Error('Connection lost - read ECONNRESET at secret-pw'), { code: 'ESOCKET' });
const timedOut = () => Object.assign(new Error('Timeout: Request failed to complete in 30000ms'), { code: 'ETIMEOUT' });
/** What the S3 client throws when blob storage is not up: Node's socket error, passed on as it is. */
const storageRefused = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:3900 secret-pw'), { code: 'ECONNREFUSED' });
/** What the plugin runtime throws when the stored code is not the code that was installed. */
const hashMismatch = () => new Error('plugin v1-import@1.2.0 sha256 mismatch (expected aa11, got bb22)');
/** What the file-system adapter throws for a code file that is not there. */
const missingFile = () => Object.assign(new Error("ENOENT: no such file or directory, open '/data/objects/plugins/v1-import/1.2.0/plugin.wasm'"), { code: 'ENOENT' });

const DATE = new Date(Date.UTC(2024, 2, 5, 14, 30, 0, 0));
const DATE_TEXT = '2024-03-05T14:30:00.000';
type Row = Record<string, unknown>;

/** A fake v1 database with a Requests, a LabResults and a Facilities table. */
function fakeSource(requests: string[], facilities: string[] = []) {
  const statements: string[] = [];
  const rules: Array<{ re: RegExp; left: number; act: () => Promise<void> | void }> = [];
  let failOn: RegExp | null = null;
  let custom: ((table: string, keys: string[]) => Row[] | undefined) | null = null;
  const tables: Record<string, string[]> = { Requests: [...requests].sort(), Facilities: [...facilities].sort() };
  const db = {
    async query(sql: string) {
      statements.push(sql);
      if (failOn?.test(sql)) throw missingTable();
      const rule = rules.find((r) => r.left > 0 && r.re.test(sql));
      if (rule) { rule.left -= 1; await rule.act(); }
      if (sql === 'SELECT 1') return { rows: [{ ok: 1 }] };
      const table = /FROM \[dbo\]\.\[(\w+)\]/.exec(sql)![1];
      const top = /TOP \((\d+)\)/.exec(sql);
      if (top) {
        const after = /> '((?:[^']|'')*)'/.exec(sql)![1].replace(/''/g, "'");
        const keys = tables[table].filter((k) => k > after).slice(0, Number(top[1]));
        return { rows: keys.map((k) => (table === 'Facilities' ? { FacilityCode: k, Name: `Clinic ${k}` } : { RequestID: k })) };
      }
      const inList = [...sql.slice(sql.indexOf('IN (')).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
      const own = custom?.(table, inList);
      if (own) return { rows: own };
      if (table === 'LabResults') {
        return { rows: inList.flatMap((k) => [{ __key: k, RequestID: k, SIValue: 4.2 }, { __key: k, RequestID: k, SIValue: 5.1 }]) };
      }
      return { rows: inList.map((k) => ({ __key: k, RequestID: k, RegisteredDateTime: DATE })) };
    },
    async queryReadOnly(): Promise<never> { throw new Error('the import reader calls query, never queryReadOnly'); },
    async close() {},
  };
  return {
    db, statements,
    failWhen: (re: RegExp | null) => { failOn = re; },
    /** Throw `err` for the next `times` statements that match `re`. */
    failNext: (re: RegExp, err: () => unknown, times = 1) => { rules.push({ re, left: times, act: () => { throw err(); } }); },
    /** Hold the next statement that matches `re` until the returned function is called. */
    holdNext: (re: RegExp): (() => void) => {
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      rules.push({ re, left: 1, act: () => held });
      return () => release();
    },
    /** Run `fn` when the next statement that matches `re` arrives, then answer it as usual. */
    onNext: (re: RegExp, fn: () => void) => { rules.push({ re, left: 1, act: fn }); },
    /** Answer detail queries from `fn` when it returns rows. */
    rowsFrom: (fn: (table: string, keys: string[]) => Row[] | undefined) => { custom = fn; },
    clearRules: () => { rules.length = 0; },
  };
}

let internalDb: Awaited<ReturnType<typeof makeMigratedDb>>;

async function world(requests: string[], facilities: string[] = []) {
  const source = fakeSource(requests, facilities);
  const raw = createPluginDataStore(internalDb);
  const runSaves: CopyRun[] = [];
  /** Writes of a copy record held between the caller's read and its write, until released. */
  const pauses: Array<{ match: (doc: CopyRun) => boolean; reached: () => void; gate: Promise<void> }> = [];
  /** Another writer that changes the record just before a matching write. */
  const rivals: Array<{ match: (doc: CopyRun) => boolean; left: number }> = [];
  const plainCopyPuts: string[] = [];
  const pluginData: PluginDataStore = {
    ...raw,
    async put(pluginId, collection, key, doc) {
      // R28: a copy record is written only by compare-and-swap.
      if (collection === '__import-copies') plainCopyPuts.push(key);
      return raw.put(pluginId, collection, key, doc);
    },
    async putIfRev(pluginId, collection, key, doc, expectedRev) {
      if (collection === '__import-copies') {
        const run = doc as CopyRun;
        const pause = pauses.find((p) => p.match(run));
        if (pause) {
          pauses.splice(pauses.indexOf(pause), 1);
          pause.reached();
          await pause.gate;
        }
        const rival = rivals.find((r) => r.left > 0 && r.match(run));
        if (rival) {
          rival.left -= 1;
          const stored = (await raw.get(pluginId, collection, key)) as CopyRun | null;
          if (stored) await raw.put(pluginId, collection, key, { ...stored, rev: stored.rev + 1 });
        }
      }
      const wrote = await raw.putIfRev(pluginId, collection, key, doc, expectedRev);
      if (wrote && collection === '__import-copies') runSaves.push(structuredClone(doc) as CopyRun);
      return wrote;
    },
  };
  const realStore = createImportCopyStore(internalDb);
  const calls = {
    replace: [] as Array<{ set: string; keys: string[]; rows: number }>,
    replaceTries: 0,
    deletes: [] as Array<{ limit: number; set: string | undefined; gone: number }>,
  };
  let replaceFault: (() => unknown) | null = null;
  let deleteCap: number | null = null;
  const store: ImportCopyStore = {
    ...realStore,
    async replaceKeys(copyId, setName, keys, rows) {
      calls.replaceTries += 1;
      if (replaceFault) throw replaceFault();
      await realStore.replaceKeys(copyId, setName, keys, rows);
      calls.replace.push({ set: setName, keys: [...keys], rows: rows.length });
    },
    async deleteSome(copyId, limit, setName) {
      const gone = await realStore.deleteSome(copyId, deleteCap === null ? limit : Math.min(limit, deleteCap), setName);
      calls.deletes.push({ limit, set: setName, gone });
      return gone;
    },
  };
  const audited: ImportAuditEvent[] = [];
  let auditFails: ImportAuditEvent['action'] | null = null;
  /** Audit writes held until released, by action. */
  const auditHolds: Array<{ action: ImportAuditEvent['action']; reached: () => void; gate: Promise<void> }> = [];
  const audit = async (e: ImportAuditEvent) => {
    const hold = auditHolds.find((h) => h.action === e.action);
    if (hold) {
      auditHolds.splice(auditHolds.indexOf(hold), 1);
      hold.reached();
      await hold.gate;
    }
    if (e.action === auditFails) throw new Error('audit store down');
    audited.push(structuredClone(e));
  };
  const plugins: Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }> = [
    { id: PLUGIN, version: '1.2.0', enabled: true, manifest: manifest() },
  ];
  let copyFn: (options: Record<string, string>) => unknown = (options) => ({ sets: [requestsSet(options.from)] });
  let copyFails = false;
  const invoke = vi.fn(async (entrypoint: string, input: { options: Record<string, string> }) => {
    if (entrypoint !== 'import_copy') throw new Error(`no entrypoint ${entrypoint}`);
    if (copyFails) throw new Error('panic: patient Maria Santos has no row');
    return copyFn(input.options);
  });
  const sleeps: number[] = [];
  let held = false;
  let waiters: Array<() => void> = [];
  const clock = { now: Date.UTC(2026, 10, 11, 12, 0, 0) };
  /** Loads of the plugin's code that throw, by default as when the place it is stored is not up yet. */
  let sinkLoadFaults = 0;
  let sinkFault: () => unknown = storageRefused;
  let noSink = false;
  const pluginsDep = {
    list: async () => plugins,
    loadSink: async () => {
      if (sinkLoadFaults > 0) {
        sinkLoadFaults -= 1;
        throw sinkFault();
      }
      return noSink ? undefined : { invoke };
    },
  };
  const connectors = {
    get: async (id: string) => (id === 'c1' ? { type: 'microsoft-sql', enabled: true } : id === 'pg' ? { type: 'postgres', enabled: true } : id === 'off' ? { type: 'microsoft-sql', enabled: false } : null),
    getDecryptedConfig: async () => ({ host: 'v1', password: 'secret-pw' }),
  };
  const imports: ImportService = createImportService({
    plugins: pluginsDep, connectors, secretsKey: 'k', pluginData, persist: async () => [], audit,
    createDb: () => source.db, now: () => new Date(clock.now),
  });
  const service = (driverId = 'server-1', checks?: NonNullable<Parameters<typeof createImportCopyService>[0]['checks']>): ImportCopyService => createImportCopyService({
    plugins: pluginsDep, connectors, secretsKey: 'k', pluginData, audit, store, checks,
    allowed: (pluginId) => imports.allowed(pluginId),
    driverId,
    createDb: () => source.db,
    now: () => new Date(clock.now),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (held) await new Promise<void>((resolve) => { waiters.push(resolve); });
    },
  });
  await imports.allow(PLUGIN, 'c1', ADMIN);
  worlds.push({ plainCopyPuts });
  const svc = service();
  return {
    svc, service, imports, source, store, calls, audited, runSaves, sleeps, clock, plugins, invoke, raw, plainCopyPuts,
    /** Hold the next write of a copy record that matches, after its caller read the record. */
    pauseWrite: (match: (doc: CopyRun) => boolean) => {
      let reached: () => void = () => {};
      let release: () => void = () => {};
      const at = new Promise<void>((resolve) => { reached = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      pauses.push({ match, reached, gate });
      return { reached: at, release };
    },
    /** Let another writer change the record just before the next `times` matching writes. */
    rivalWrites: (match: (doc: CopyRun) => boolean, times: number) => { rivals.push({ match, left: times }); },
    setCopy: (fn: (options: Record<string, string>) => unknown) => { copyFn = fn; },
    failCopy: (on: boolean) => { copyFails = on; },
    /** The next `times` loads of the plugin's code throw `fault`. */
    failSinkLoads: (times: number, fault: () => unknown = storageRefused) => { sinkLoadFaults = times; sinkFault = fault; },
    /** Loading the plugin's code finds no invokable wasm. */
    setNoSink: (on: boolean) => { noSink = on; },
    failAuditOn: (action: ImportAuditEvent['action'] | null) => { auditFails = action; },
    /** Hold the next audit write of this action until the returned release is called. */
    holdAudit: (action: ImportAuditEvent['action']) => {
      let reached: () => void = () => {};
      let release: () => void = () => {};
      const at = new Promise<void>((resolve) => { reached = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      auditHolds.push({ action, reached, gate });
      return { reached: at, release };
    },
    failReplace: (fault: (() => unknown) | null) => { replaceFault = fault; },
    capDeletes: (n: number | null) => { deleteCap = n; },
    holdSleeps: () => { held = true; },
    releaseSleeps: () => { held = false; const w = waiters; waiters = []; for (const resolve of w) resolve(); },
    /** Every stored row of the copy, ordered by set, detail, key and seq. */
    rows: async () => (await internalDb.selectFrom('import_copy_rows')
      .select(['set_name', 'detail_name', 'key', 'seq', 'row'])
      .where('copy_id', '=', COPY)
      .orderBy('set_name').orderBy('detail_name').orderBy('key').orderBy('seq')
      .execute()) as Array<{ set_name: string; detail_name: string; key: string; seq: number; row: Row }>,
    skipped: async () => (await raw.list(PLUGIN, '__import-copy-skipped')).map((e) => ({ key: e.key, doc: e.doc })),
    stored: async () => (await raw.get(PLUGIN, '__import-copies', COPY)) as CopyRun | null,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const START = { pluginId: PLUGIN, connectorId: 'c1', options: { tz: '+02:00' }, actor: ADMIN };
const keysOf = (n: number, prefix = 'REQ') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(4, '0')}`);
/** The `after` of every key query sent for a table, in order. */
const keyAfters = (w: World, table = 'Requests') => w.source.statements
  .filter((s) => s.includes('TOP (') && s.includes(`[dbo].[${table}]`))
  .map((s) => /> '((?:[^']|'')*)'/.exec(s)![1]);
const reqRow = (k: string) => ({ __key: k, RequestID: k, RegisteredDateTime: DATE_TEXT });
const resRows = (k: string) => [{ __key: k, RequestID: k, SIValue: 4.2 }, { __key: k, RequestID: k, SIValue: 5.1 }];
const bytesOf = (rows: Row[]) => rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r), 'utf8'), 0);
const requestBytes = (keys: string[]) => bytesOf(keys.flatMap((k) => [reqRow(k), ...resRows(k)]));
async function drive(svc: ImportCopyService) {
  await svc.tick();
  await svc.idle();
}
const actions = (w: World) => w.audited.map((e) => e.action);

/** Every world this test built, so afterEach can check no copy record was written with a plain put. */
let worlds: Array<{ plainCopyPuts: string[] }> = [];

beforeEach(async () => { internalDb = await makeMigratedDb(); worlds = []; });
afterEach(async () => {
  await internalDb.destroy();
  for (const w of worlds) expect(w.plainCopyPuts).toEqual([]);
});

describe('copy: reading a source to CE', () => {
  it('copies every key of a set, in pages, and reports rows and bytes', async () => {
    const w = await world(keysOf(5));
    const started = await w.svc.start({ ...START, pageSize: 2 });
    expect(started).toMatchObject({ id: COPY, kind: 'copy', pluginId: PLUGIN, pluginVersion: '1.2.0', connectorId: 'c1', status: 'queued', driver: null, pageSize: 2, startedBy: 'admin' });
    expect(started.sets).toEqual({ requests: { cursor: null, keys: 0, rows: 0, bytes: 0, skipped: 0, done: false } });
    expect(Object.keys(started.setSql)).toEqual(['requests']);
    expect(started.setSql.requests).toMatch(/^[0-9a-f]{64}$/);

    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run).toMatchObject({
      status: 'completed', driver: null, waiting: null, lastError: null,
      sets: { requests: { cursor: 'REQ0005', keys: 5, rows: 15, bytes: requestBytes(keysOf(5)), skipped: 0, done: true } },
    });
    expect(run.finishedAt).not.toBeNull();
    // Three pages of keys (2, 2, 1), then an empty page.
    expect(keyAfters(w)).toEqual(['', 'REQ0002', 'REQ0004', 'REQ0005']);
    expect(w.calls.replace.map((c) => c.keys)).toEqual([['REQ0001', 'REQ0002'], ['REQ0003', 'REQ0004'], ['REQ0005']]);
    expect((await w.rows()).filter((r) => r.key === 'REQ0001')).toEqual([
      { set_name: 'requests', detail_name: 'requests', key: 'REQ0001', seq: 0, row: reqRow('REQ0001') },
      { set_name: 'requests', detail_name: 'results', key: 'REQ0001', seq: 0, row: resRows('REQ0001')[0] },
      { set_name: 'requests', detail_name: 'results', key: 'REQ0001', seq: 1, row: resRows('REQ0001')[1] },
    ]);
    // The first claim of a queued run is not a takeover.
    expect(actions(w)).toEqual(['import.allow', 'import.copy.start', 'import.copy.finish']);
    expect(w.audited[2]).toMatchObject({ runId: COPY, connectorId: 'c1', metadata: { status: 'completed', keys: 5, rows: 15, skipped: 0 } });
    expect(await w.svc.list(PLUGIN)).toEqual([run]);
  });

  it('copies a set with no detail queries from the key query rows', async () => {
    const w = await world([], ['F01', 'F02', 'F03']);
    w.setCopy(() => ({ sets: [facilitiesSet] }));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const rows = await w.rows();
    expect(rows).toEqual(['F01', 'F02', 'F03'].map((k) => ({
      set_name: 'facilities', detail_name: 'facilities', key: k, seq: 0, row: { FacilityCode: k, Name: `Clinic ${k}` },
    })));
    expect((await w.svc.get(PLUGIN, COPY))!.sets.facilities).toEqual({
      cursor: 'F03', keys: 3, rows: 3, bytes: bytesOf(rows.map((r) => r.row)), skipped: 0, done: true,
    });
    // Only key queries were sent: there is nothing else to read.
    expect(w.source.statements.every((s) => s.includes('TOP ('))).toBe(true);
  });

  // R46. Such a set moves past the last key of a page. A key on two rows of one page would lose the
  // rows past the page end, so the plugin's key query is at fault. Known limit: a key that repeats
  // only across a page boundary is not seen.
  it('a set with no detail queries fails the copy when a key repeats in one page, naming the set only', async () => {
    const w = await world([], ['F-SECRET-01', 'F-SECRET-01', 'F-SECRET-02']);
    w.setCopy(() => ({ sets: [facilitiesSet] }));
    await w.svc.start({ ...START, pageSize: 3 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toBe('set facilities has no detail queries, and its key query gave one key on more than one row of a page; each row of such a set needs its own key');
    expect(JSON.stringify([run, w.audited])).not.toContain('F-SECRET');
    expect(w.calls.replace).toEqual([]);
  });

  it('copies two sets one after the other, each with its own position', async () => {
    const w = await world(keysOf(3), ['F01', 'F02']);
    w.setCopy((o) => ({ sets: [facilitiesSet, requestsSet(o.from)] }));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    // The plugin's order, which jsonb would not keep on its own.
    expect(run.setOrder).toEqual(['facilities', 'requests']);
    expect(Object.keys(run.sets)).toEqual(['facilities', 'requests']);
    expect(run.sets.facilities).toMatchObject({ cursor: 'F02', keys: 2, rows: 2, done: true });
    expect(run.sets.requests).toMatchObject({ cursor: 'REQ0003', keys: 3, rows: 9, done: true });
    const lastFacility = w.source.statements.map((s) => s.includes('[Facilities]')).lastIndexOf(true);
    const firstRequest = w.source.statements.findIndex((s) => s.includes('[Requests]'));
    expect(lastFacility).toBeLessThan(firstRequest);
    expect(keyAfters(w, 'Facilities')).toEqual(['', 'F02']);
    expect(keyAfters(w)).toEqual(['', 'REQ0002', 'REQ0003']);
  });

  it('files each detail row under the key in its first column, in the order it came', async () => {
    const w = await world(keysOf(2));
    w.source.rowsFrom((table) => (table === 'LabResults'
      ? [{ __key: 'REQ0002', SIValue: 1 }, { __key: 'REQ0001', SIValue: 2 }, { __key: 'REQ0002', SIValue: 3 }]
      : undefined));
    await w.svc.start(START);
    await drive(w.svc);
    const results = (await w.store.read(COPY, 'requests', ['REQ0001', 'REQ0002'])).filter((r) => r.detail === 'results');
    expect(results).toEqual([
      { detail: 'results', key: 'REQ0001', seq: 0, row: { __key: 'REQ0001', SIValue: 2 } },
      { detail: 'results', key: 'REQ0002', seq: 0, row: { __key: 'REQ0002', SIValue: 1 } },
      { detail: 'results', key: 'REQ0002', seq: 1, row: { __key: 'REQ0002', SIValue: 3 } },
    ]);
  });

  it('files rows the source matched another way under the page key, and a second read of the page leaves one copy of each', async () => {
    const w = await world(['ABC', 'DEF']);
    // SQL Server's usual collation: IN ('ABC') also returns abc and ABC with trailing spaces.
    w.source.rowsFrom((table, keys) => (table === 'Requests'
      ? keys.flatMap((k) => (k === 'ABC'
        ? [{ __key: 'abc', Note: 1 }, { __key: 'ABC ', Note: 2 }, { __key: 'ABC', Note: 3 }]
        : [{ __key: k, Note: 4 }]))
      : undefined));
    const a = w.service('server-a');
    await a.start({ ...START, pageSize: 2 });
    // A writes the page, then dies before it saves its position. B takes over and reads it again.
    const held = w.pauseWrite((d) => d.driver === 'server-a' && d.sets.requests.cursor === 'DEF');
    await a.tick();
    await held.reached;
    w.clock.now += STALE_MS + 1;
    const b = w.service('server-b');
    await drive(b);
    held.release();
    await a.idle();

    expect((await w.stored())!).toMatchObject({ status: 'completed', sets: { requests: { cursor: 'DEF', keys: 2, rows: 8, done: true } } });
    expect(w.calls.replace.map((c) => c.keys)).toEqual([['ABC', 'DEF'], ['ABC', 'DEF']]);
    const abc = (await w.rows()).filter((r) => r.detail_name === 'requests' && r.key === 'ABC');
    // Filed under the page key, in arrival order. Each row keeps its own spelling in __key.
    expect(abc).toEqual([
      { set_name: 'requests', detail_name: 'requests', key: 'ABC', seq: 0, row: { __key: 'abc', Note: 1 } },
      { set_name: 'requests', detail_name: 'requests', key: 'ABC', seq: 1, row: { __key: 'ABC ', Note: 2 } },
      { set_name: 'requests', detail_name: 'requests', key: 'ABC', seq: 2, row: { __key: 'ABC', Note: 3 } },
    ]);
    expect(await w.rows()).toHaveLength(8);
    expect(new Set((await w.rows()).map((r) => r.key))).toEqual(new Set(['ABC', 'DEF']));
  });

  it('a row that matches two page keys once case is ignored ends the run as failed', async () => {
    const w = await world(['ABC', 'abc']);
    w.source.rowsFrom((table) => (table === 'Requests' ? [{ __key: 'Abc', Note: 1 }] : undefined));
    await w.svc.start(START);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toMatch(/first column that is not a key of the page/);
    expect(run.lastError).not.toContain('Abc');
    expect(w.calls.replace).toEqual([]);
  });

  it('a detail row whose first column is not a key of the page ends the run as failed', async () => {
    const w = await world(keysOf(2));
    w.source.rowsFrom((table) => (table === 'LabResults' ? [{ __key: 'NOT-ON-PAGE', SIValue: 1 }] : undefined));
    await w.svc.start(START);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toMatch(/first column that is not a key of the page/);
    expect(run.lastError).not.toContain('NOT-ON-PAGE');
    expect(w.calls.replace).toEqual([]);
  });
});

describe('copy: a source that goes away', () => {
  const SECOND_PAGE = /\[Requests\].*> 'REQ0002'/;

  it('a cut link in the middle of a page keeps no half page and stores no row twice', async () => {
    const w = await world(keysOf(4));
    // The results query of the second page: its key query and requests query have answered.
    w.source.failNext(/LabResults.*'REQ0003'/, cutLink);
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run).toMatchObject({ status: 'completed', waiting: null, sets: { requests: { cursor: 'REQ0004', keys: 4, rows: 12, done: true } } });
    // The half-read page was read again in full and written once, whole.
    expect(w.source.statements.filter((s) => /\[Requests\] WHERE \[RequestID\] IN .*'REQ0003'/.test(s))).toHaveLength(2);
    expect(w.calls.replace).toEqual([
      { set: 'requests', keys: ['REQ0001', 'REQ0002'], rows: 6 },
      { set: 'requests', keys: ['REQ0003', 'REQ0004'], rows: 6 },
    ]);
    const rows = await w.rows();
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => `${r.detail_name}|${r.key}|${r.seq}`)).size).toBe(12);
    // It waited with the page-1 position, and carried on with no person.
    const waiting = w.runSaves.find((r) => r.status === 'waiting')!;
    expect(waiting.sets.requests).toMatchObject({ cursor: 'REQ0002', keys: 2, rows: 6 });
    expect(actions(w)).toEqual(['import.allow', 'import.copy.start', 'import.copy.finish']);
  });

  it('shows waiting with a cleaned error while the source is away', async () => {
    const w = await world(keysOf(4));
    w.holdSleeps();
    w.source.failNext(SECOND_PAGE, cutLink);
    await w.svc.start({ ...START, pageSize: 2 });
    await w.svc.tick();
    await vi.waitFor(async () => expect((await w.svc.get(PLUGIN, COPY))?.status).toBe('waiting'));
    const waiting = (await w.svc.get(PLUGIN, COPY))!;
    expect(waiting.waiting).toEqual({ since: new Date(w.clock.now).toISOString(), attempt: 1, error: expect.stringContaining('Connection lost') });
    expect(JSON.stringify(w.runSaves)).not.toContain('secret-pw');
    w.releaseSleeps();
    await w.svc.idle();
    expect((await w.svc.get(PLUGIN, COPY))).toMatchObject({ status: 'completed', waiting: null, sets: { requests: { keys: 4 } } });
    // A wait is slept in slices of at most a second, so a stop or a release is felt within one.
    expect(w.sleeps.every((ms) => ms <= 1000)).toBe(true);
  });

  // R45. A copy whose set has a position has read the source before. A fresh drive's reader has
  // had no good query yet, so only the flag the copy passes makes it wait.
  const startingUp = () => Object.assign(new Error('Cannot open database "LabData" requested by the login.'), { code: 'EREQUEST', number: 4060 });

  it('a continued copy waits on a source that is starting up', async () => {
    const w = await world(keysOf(4));
    w.source.failWhen(/LabResults.*'REQ0003'/);
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'failed', sets: { requests: { cursor: 'REQ0002' } } });
    w.source.failWhen(null);
    w.source.failNext(/\[Requests\].*> 'REQ0002'/, startingUp, 2);
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { keys: 4, done: true } } });
    const waits = w.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting!.error);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((e) => e.startsWith('the source may still be starting up: '))).toBe(true);
  });

  it('a new copy whose first query is refused as if starting up fails at once', async () => {
    const fresh = await world(keysOf(4));
    fresh.source.failNext(/\[Requests\].*> ''/, startingUp);
    await fresh.svc.start({ ...START, pageSize: 2 });
    await drive(fresh.svc);
    const failed = (await fresh.svc.get(PLUGIN, COPY))!;
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toContain('Cannot open database');
    expect(fresh.runSaves.some((r) => r.status === 'waiting')).toBe(false);
  });

  it('a missing table at the source ends the run as failed', async () => {
    const w = await world(keysOf(4));
    w.source.failWhen(/LabResults.*'REQ0003'/);
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run).toMatchObject({ status: 'failed', waiting: null, driver: null, sets: { requests: { cursor: 'REQ0002', keys: 2, done: false } } });
    expect(run.lastError).toContain('Invalid object name');
    expect(w.runSaves.some((r) => r.status === 'waiting')).toBe(false);
    expect(w.sleeps).toEqual([]);
    expect(w.audited.at(-1)).toMatchObject({ action: 'import.copy.finish', metadata: { status: 'failed' } });
  });

  it('a write error from CE ends the run as failed, with no retry', async () => {
    const w = await world(keysOf(4));
    // What Postgres says on a full disk. Its detail field quotes the row.
    w.failReplace(() => Object.assign(new Error('could not extend file "base/16384/2619": No space left on device'), {
      code: '53100', detail: 'Failing row contains (REQ0001, Maria Santos).', where: 'Maria Santos',
    }));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run).toMatchObject({ status: 'failed', lastError: "OpenLDR's own database refused a write (53100)", waiting: null });
    expect(w.calls.replaceTries).toBe(1);
    expect(w.runSaves.some((r) => r.status === 'waiting')).toBe(false);
    expect(w.sleeps).toEqual([]);
    expect(JSON.stringify([run, w.audited])).not.toContain('Maria');
    expect(JSON.stringify([run, w.audited])).not.toContain('No space');
  });

  it('a write error from CE with no SQLSTATE code is shown as unknown', async () => {
    const w = await world(keysOf(2));
    w.failReplace(() => new Error('Failing row contains (Maria Santos)'));
    await w.svc.start(START);
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!.lastError).toBe("OpenLDR's own database refused a write (unknown)");
  });

  it('a key with a NUL character is skipped with ROW_NOT_STORABLE, and the rest of the page is stored', async () => {
    const w = await world(keysOf(3));
    w.source.rowsFrom((table, keys) => (table === 'Requests'
      ? keys.map((k) => ({ __key: k, RequestID: k, Note: k === 'REQ0002' ? 'bad\u0000value' : 'ok' }))
      : undefined));
    await w.svc.start(START);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run).toMatchObject({ status: 'completed', sets: { requests: { cursor: 'REQ0003', keys: 2, rows: 6, skipped: 1, done: true } } });
    expect([...new Set((await w.rows()).map((r) => r.key))]).toEqual(['REQ0001', 'REQ0003']);
    expect(await w.skipped()).toEqual([{
      key: `${COPY}:requests:REQ0002`,
      doc: { copyId: COPY, setName: 'requests', key: 'REQ0002', code: 'ROW_NOT_STORABLE', after: 'REQ0001' },
    }]);
    expect(JSON.stringify([w.runSaves, w.audited])).not.toContain('bad');
  });

  it('a key with a lone surrogate in a string is skipped with ROW_NOT_STORABLE, and the rest of the page is stored', async () => {
    const w = await world(keysOf(3));
    w.source.rowsFrom((table, keys) => (table === 'Requests'
      ? keys.map((k) => ({ __key: k, RequestID: k, Note: k === 'REQ0002' ? 'cut\uD800name' : 'ok', Pair: '😀' }))
      : undefined));
    await w.svc.start(START);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    // A whole surrogate pair is well formed and stored. Only the lone half is refused.
    expect(run).toMatchObject({ status: 'completed', sets: { requests: { keys: 2, rows: 6, skipped: 1, done: true } } });
    expect([...new Set((await w.rows()).map((r) => r.key))]).toEqual(['REQ0001', 'REQ0003']);
    expect((await w.rows()).find((r) => r.detail_name === 'requests')!.row.Pair).toBe('😀');
    expect(await w.skipped()).toEqual([{
      key: `${COPY}:requests:REQ0002`,
      doc: { copyId: COPY, setName: 'requests', key: 'REQ0002', code: 'ROW_NOT_STORABLE', after: 'REQ0001' },
    }]);
    expect(JSON.stringify([w.runSaves, w.audited])).not.toContain('cut');
  });

  it('a skipped key read at the end of the pass that cannot be stored stays listed as ROW_NOT_STORABLE', async () => {
    const w = await world(keysOf(4));
    // The detail reads of REQ0002 time out in the pass: once at a page of 4, once at 2, 3 times at 1.
    w.source.failNext(/IN \(.*'REQ0002'/, timedOut, 5);
    w.source.rowsFrom((table, keys) => (table === 'Requests'
      ? keys.map((k) => ({ __key: k, RequestID: k, Note: k === 'REQ0002' ? 'bad\u0000value' : 'ok' }))
      : undefined));
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { keys: 3, skipped: 1 } } });
    expect(await w.skipped()).toEqual([{
      key: `${COPY}:requests:REQ0002`,
      doc: { copyId: COPY, setName: 'requests', key: 'REQ0002', code: 'ROW_NOT_STORABLE', after: 'REQ0001' },
    }]);
    expect(await w.store.read(COPY, 'requests', ['REQ0002'])).toEqual([]);
  });

  it('a skipped key is listed, read again at the end of the pass, and read again at the next start', async () => {
    const w = await world(keysOf(4));
    // Every detail read that holds REQ0002 runs out of time. The source still answers SELECT 1.
    w.source.failNext(/IN \(.*'REQ0002'/, timedOut, 1000);
    await w.svc.start({ ...START, pageSize: 4 });
    await drive(w.svc);
    const first = (await w.svc.get(PLUGIN, COPY))!;
    expect(first).toMatchObject({ status: 'completed', sets: { requests: { cursor: 'REQ0004', keys: 3, skipped: 1, done: true } } });
    expect(await w.skipped()).toEqual([{
      key: `${COPY}:requests:REQ0002`,
      doc: { copyId: COPY, setName: 'requests', key: 'REQ0002', code: 'SOURCE_TIMEOUT', after: 'REQ0001' },
    }]);
    // Read at a page of one in the pass, and once more at its end. Each read is 3 tries, and each
    // try sends the key query again: 3 in the pass, 3 at its end.
    const singleReads = () => w.source.statements.filter((s) => s.includes('TOP (1)') && s.includes("> 'REQ0001'")).length;
    expect(singleReads()).toBe(6);
    expect(w.sleeps).toEqual([]);

    // The source is quick again. A new start reads only the skipped key.
    w.source.clearRules();
    const before = w.source.statements.length;
    expect((await w.svc.start(START)).status).toBe('queued');
    await drive(w.svc);
    const second = (await w.svc.get(PLUGIN, COPY))!;
    expect(second).toMatchObject({
      status: 'completed',
      sets: { requests: { cursor: 'REQ0004', keys: 4, rows: 12, bytes: requestBytes(keysOf(4)), skipped: 0, done: true } },
    });
    expect(await w.skipped()).toEqual([]);
    const later = w.source.statements.slice(before);
    expect(later.filter((s) => s.includes('TOP ('))).toEqual([expect.stringContaining("TOP (1) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > 'REQ0001'")]);
    expect(later.filter((s) => s.includes('IN (')).every((s) => s.includes("IN ('REQ0002')"))).toBe(true);
    expect((await w.store.read(COPY, 'requests', ['REQ0002']))).toHaveLength(3);
  });

  it('a copy with a skipped key left is completed with skipped above 0', async () => {
    const w = await world(keysOf(3));
    w.source.failNext(/IN \(.*'REQ0003'/, timedOut, 1000);
    await w.svc.start(START);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('completed');
    expect(run.sets.requests.skipped).toBe(1);
    expect(run.sets.requests.keys).toBe(2);
    expect(await w.store.read(COPY, 'requests', ['REQ0003'])).toEqual([]);
    expect(w.audited.at(-1)).toMatchObject({ action: 'import.copy.finish', metadata: { status: 'completed', skipped: 1 } });
  });
});

describe('copy: starting, and what a start may change', () => {
  it('start asked twice gives one run', async () => {
    const w = await world(keysOf(6));
    const server = w.svc;
    const cli = w.service('cli-1');
    const [a, b] = await Promise.all([server.start({ ...START, pageSize: 2 }), cli.start({ ...START, pageSize: 2 })]);
    expect(a.id).toBe(COPY);
    expect(b.id).toBe(COPY);
    expect((await server.list(PLUGIN)).map((r) => r.id)).toEqual([COPY]);

    const release = w.source.holdNext(/\[Requests\].*> 'REQ0002'/);
    await server.tick();
    await vi.waitFor(() => expect(w.calls.replace).toHaveLength(1));
    // Asked again while the server drives it: the same run, untouched.
    const again = await cli.start({ ...START, pageSize: 2 });
    expect(again).toMatchObject({ id: COPY, status: 'running', driver: 'server-1' });
    // A second process that looks for work does not take a run with a live driver.
    await cli.tick();
    expect((await w.stored())!.driver).toBe('server-1');
    release();
    await server.idle();
    await cli.idle();
    expect((await server.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { keys: 6, rows: 18 } } });
    // One driver: every page was read and written once.
    expect(keyAfters(w)).toEqual(['', 'REQ0002', 'REQ0004', 'REQ0006']);
    expect(w.calls.replace.map((c) => c.keys[0])).toEqual(['REQ0001', 'REQ0003', 'REQ0005']);
    expect(actions(w).filter((a) => a === 'import.copy.takeover')).toEqual([]);
  });

  it('start with an option that changes a set is refused and names the set', async () => {
    const w = await world(keysOf(3));
    await w.svc.start({ ...START, options: { from: '2024-01-01' } });
    await drive(w.svc);
    const before = await w.stored();
    const rowsBefore = await w.rows();
    const audits = w.audited.length;
    const err = await w.svc.start({ ...START, options: { from: '2023-01-01' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopySetChangedError);
    expect((err as CopySetChangedError).sets).toEqual(['requests']);
    expect((err as Error).message).toContain('requests');
    // Nothing changed: the record, the rows, the audit log.
    expect(await w.stored()).toEqual(before);
    expect(await w.rows()).toEqual(rowsBefore);
    expect(w.audited).toHaveLength(audits);
  });

  it('start with reread empties the changed set and reads it again, and leaves the other set alone', async () => {
    const w = await world(keysOf(3), ['F01', 'F02']);
    w.setCopy((o) => ({ sets: [requestsSet(o.from), facilitiesSet] }));
    await w.svc.start({ ...START, options: { from: '2024-01-01' } });
    await drive(w.svc);
    const facilityRows = (await w.rows()).filter((r) => r.set_name === 'facilities');
    const facilityProgress = (await w.svc.get(PLUGIN, COPY))!.sets.facilities;

    const queued = await w.svc.start({ ...START, options: { from: '2023-01-01' }, reread: true });
    expect(queued.status).toBe('queued');
    expect(queued.sets.requests.empty).toBe(true);
    expect(queued.sets.facilities).toEqual(facilityProgress);
    expect(queued.options).toEqual({ from: '2023-01-01' });

    const before = w.source.statements.length;
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('completed');
    expect(run.sets.requests).toEqual({ cursor: 'REQ0003', keys: 3, rows: 9, bytes: requestBytes(keysOf(3)), skipped: 0, done: true });
    expect(run.sets.facilities).toEqual(facilityProgress);
    // The set was emptied in batches of 10,000, by its name only.
    expect(w.calls.deletes.length).toBeGreaterThan(0);
    expect(w.calls.deletes.every((d) => d.limit === 10_000 && d.set === 'requests')).toBe(true);
    expect(w.calls.deletes.at(-1)!.gone).toBe(0);
    // Read again from the start, with the new SQL. The other set was not read at all.
    const later = w.source.statements.slice(before);
    expect(later.filter((s) => s.includes('TOP ('))[0]).toContain("> '' AND [RegisteredDateTime] >= '2023-01-01'");
    expect(later.some((s) => s.includes('[Facilities]'))).toBe(false);
    expect((await w.rows()).filter((r) => r.set_name === 'facilities')).toEqual(facilityRows);
    expect((await w.rows()).filter((r) => r.set_name === 'requests')).toHaveLength(9);
  });

  it('start with reread drops a set the plugin no longer names, after emptying it', async () => {
    const w = await world(keysOf(2), ['F01']);
    w.setCopy((o) => ({ sets: [requestsSet(o.from), facilitiesSet] }));
    await w.svc.start(START);
    await drive(w.svc);
    w.setCopy((o) => ({ sets: [requestsSet(o.from)] }));
    await expect(w.svc.start(START)).rejects.toThrow(CopySetChangedError);
    const queued = await w.svc.start({ ...START, reread: true });
    expect(queued.sets.facilities.empty).toBe(true);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('completed');
    expect(run.setOrder).toEqual(['requests']);
    expect(Object.keys(run.sets)).toEqual(['requests']);
    expect((await w.rows()).some((r) => r.set_name === 'facilities')).toBe(false);
    expect((await w.rows()).filter((r) => r.set_name === 'requests')).toHaveLength(6);
  });

  it('start with reread is refused while the copy is running', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    const release = w.source.holdNext(/\[Requests\].*> 'REQ0002'/);
    await w.svc.tick();
    await vi.waitFor(() => expect(w.calls.replace).toHaveLength(1));
    await expect(w.svc.start({ ...START, options: { from: '2023-01-01' }, reread: true })).rejects.toThrow(/stop it before reading a set again/);
    release();
    await w.svc.idle();
    expect((await w.svc.get(PLUGIN, COPY))!.status).toBe('completed');
  });

  it('start with an option that changes no SQL changes nothing in the copy', async () => {
    const w = await world(keysOf(3));
    await w.svc.start(START);
    await drive(w.svc);
    const done = (await w.svc.get(PLUGIN, COPY))!;
    const rowsBefore = await w.rows();
    const before = w.source.statements.length;
    const queued = await w.svc.start({ ...START, options: { tz: '+03:00' } });
    expect(queued.status).toBe('queued');
    expect(queued.setSql).toEqual(done.setSql);
    expect(queued.sets).toEqual(done.sets);
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: done.sets });
    // A completed copy with no skipped key reads nothing and empties nothing.
    expect(w.source.statements.slice(before)).toEqual([]);
    expect(w.calls.deletes).toEqual([]);
    expect(await w.rows()).toEqual(rowsBefore);
  });

  it('a plugin upgrade that changes a set is treated the same way as a changed option', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    await drive(w.svc);
    const before = await w.stored();
    const RES_V2 = 'SELECT [RequestID] AS [__key], * FROM [dbo].[LabResults] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID], [OBXSetID]';
    w.plugins[0] = { id: PLUGIN, version: '1.3.0', enabled: true, manifest: manifest({ version: '1.3.0' }) };
    w.setCopy((o) => ({ sets: [requestsSet(o.from, RES_V2)] }));
    const err = await w.svc.start(START).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopySetChangedError);
    expect((err as CopySetChangedError).sets).toEqual(['requests']);
    expect(await w.stored()).toEqual(before);

    const queued = await w.svc.start({ ...START, reread: true });
    expect(queued).toMatchObject({ pluginVersion: '1.3.0', status: 'queued', sets: { requests: { empty: true } } });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { keys: 2, rows: 6, done: true } } });
    expect(w.source.statements.some((s) => s.includes('[OBXSetID]'))).toBe(true);
  });

  it('a plugin upgrade between start and drive ends the run as failed and names the set', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    w.setCopy((o) => ({ sets: [requestsSet(o.from, `${RES_ROWS}, [OBXSetID]`)] }));
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toMatch(/requests changed since the copy was started/);
    expect(w.source.statements).toEqual([]);
  });

  it('an error from the plugin is stored as a fixed sentence, never as its text', async () => {
    const w = await world(keysOf(2));
    w.failCopy(true);
    await expect(w.svc.start(START)).rejects.toThrow("the plugin's copy entrypoint failed");
    expect(await w.svc.list(PLUGIN)).toEqual([]);
    w.failCopy(false);
    await w.svc.start(START);
    w.failCopy(true);
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run).toMatchObject({ status: 'failed', lastError: "the plugin's copy entrypoint failed" });
    // An answer that is not a list of sets is the same fault.
    w.failCopy(false);
    w.setCopy(() => ({ sets: [{ name: 'bad name!', keyQuery: { sql: reqKeys() } }] }));
    await expect(w.svc.start(START)).rejects.toThrow("the plugin's copy entrypoint failed");
    expect(JSON.stringify([run, w.audited])).not.toContain('Maria');
  });

  it('refuses a plugin template with a token in a comment, before running anything', async () => {
    const w = await world(keysOf(2));
    w.setCopy(() => ({ sets: [{ name: 'requests', keyQuery: { sql: 'DELETE FROM [dbo].[Requests] WHERE [RequestID] > {{after}} -- {{limit}}' }, detailQueries: [] }] }));
    await expect(w.svc.start(START)).rejects.toThrow('import SQL has a token inside quotes, a comment or a quoted name: remove the quotes around {{limit}}');
    expect(await w.svc.list(PLUGIN)).toEqual([]);
    expect(w.source.statements).toEqual([]);
  });

  it('refuses SQL from the plugin that is not a SELECT, before running anything', async () => {
    const w = await world(keysOf(2));
    w.setCopy(() => ({ sets: [{ name: 'requests', keyQuery: { sql: 'DELETE TOP ({{limit}}) FROM [dbo].[Requests] WHERE [RequestID] > {{after}}' }, detailQueries: [] }] }));
    await expect(w.svc.start(START)).rejects.toThrow('only SELECT/WITH queries are allowed');
    expect(await w.svc.list(PLUGIN)).toEqual([]);
    expect(w.source.statements).toEqual([]);
  });

  it('copiers lists a copy-only plugin, and importers does not', async () => {
    const w = await world(keysOf(1));
    w.plugins.push(
      { id: 'one-pass', version: '2.0.0', enabled: true, manifest: manifest({ id: 'one-pass', entrypoints: { queries: 'import_queries', map: 'import_map' } }) },
      { id: 'both', version: '3.0.0', enabled: true, manifest: manifest({ id: 'both', entrypoints: { queries: 'import_queries', map: 'import_map', copy: 'import_copy' } }) },
      { id: 'off-copy', version: '1.0.0', enabled: false, manifest: manifest({ id: 'off-copy' }) },
      { id: 'no-grant', version: '1.0.0', enabled: true, manifest: manifest({ id: 'no-grant', capabilities: [] }) },
    );
    expect(await w.svc.copiers()).toEqual([
      { id: PLUGIN, version: '1.2.0', connectorTypes: ['microsoft-sql'] },
      { id: 'both', version: '3.0.0', connectorTypes: ['microsoft-sql'] },
    ]);
    expect((await w.imports.importers()).map((p) => p.id)).toEqual(['one-pass', 'both']);
  });

  it('start is refused for a plugin that cannot be copied from', async () => {
    const w = await world(keysOf(1));
    w.plugins[0] = { id: PLUGIN, version: '1.2.0', enabled: true, manifest: manifest({ entrypoints: { queries: 'import_queries', map: 'import_map' } }) };
    await expect(w.svc.start(START)).rejects.toThrow(/cannot be copied from/);
    w.plugins[0] = { id: PLUGIN, version: '1.2.0', enabled: true, manifest: manifest({ capabilities: [] }) };
    await expect(w.svc.start(START)).rejects.toThrow(/host:import/);
    expect(await w.svc.list(PLUGIN)).toEqual([]);
    expect(w.invoke).not.toHaveBeenCalled();
  });

  it('start is refused for a connector the plugin is not allowed to read', async () => {
    const w = await world(keysOf(1));
    await w.imports.revoke(PLUGIN, 'c1', ADMIN);
    await expect(w.svc.start(START)).rejects.toThrow(/not allowed/);
    await w.imports.allow(PLUGIN, 'off', ADMIN);
    await expect(w.svc.start({ ...START, connectorId: 'off' })).rejects.toThrow(/not found or disabled/);
    await expect(w.svc.start({ ...START, connectorId: 'pg' })).rejects.toThrow(/microsoft-sql/);
    await expect(w.svc.start({ ...START, connectorId: 'nope' })).rejects.toThrow(/not found or disabled/);
    expect(await w.svc.list(PLUGIN)).toEqual([]);
    expect(w.invoke).not.toHaveBeenCalled();
    expect(actions(w).filter((a) => a.startsWith('import.copy'))).toEqual([]);
  });

  it('refuses bad copy settings', async () => {
    const w = await world(keysOf(1));
    await expect(w.svc.start({ ...START, pageSize: 5000 })).rejects.toThrow(/page size/);
    await expect(w.svc.start({ ...START, pageSize: 0 })).rejects.toThrow(/page size/);
    await expect(w.svc.start({ ...START, options: { tz: 'x'.repeat(600) } })).rejects.toThrow(/option/);
    expect(await w.svc.list(PLUGIN)).toEqual([]);
  });

  it('start is refused when the audit row cannot be written', async () => {
    const w = await world(keysOf(2));
    w.failAuditOn('import.copy.start');
    await expect(w.svc.start(START)).rejects.toThrow(/audit log could not be written/);
    await expect(w.svc.start(START)).rejects.not.toThrow(/audit store down/);
    expect(await w.svc.list(PLUGIN)).toEqual([]);
    // A start that would carry a stopped copy on is refused the same way, and leaves it stopped.
    w.failAuditOn(null);
    await w.svc.start(START);
    await w.svc.stop(PLUGIN, COPY, ADMIN);
    w.failAuditOn('import.copy.start');
    await expect(w.svc.start(START)).rejects.toThrow(/audit log could not be written/);
    expect((await w.svc.get(PLUGIN, COPY))!.status).toBe('stopped');
  });
});

describe('copy: stop, release and delete', () => {
  it('stop ends the run as stopped at the next page, and start carries it on', async () => {
    const w = await world(keysOf(6));
    // Stop while the first page is being read.
    w.source.onNext(/LabResults/, () => { void w.svc.stop(PLUGIN, COPY, ADMIN); });
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const stopped = (await w.svc.get(PLUGIN, COPY))!;
    expect(stopped).toMatchObject({ status: 'stopped', driver: null, sets: { requests: { cursor: 'REQ0002', keys: 2, done: false } } });
    expect(stopped.finishedAt).not.toBeNull();
    expect(w.runSaves.some((r) => r.status === 'stopping')).toBe(true);

    expect((await w.svc.start(START)).status).toBe('queued');
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { cursor: 'REQ0006', keys: 6, rows: 18 } } });
    // No page was read twice.
    expect(keyAfters(w)).toEqual(['', 'REQ0002', 'REQ0004', 'REQ0006']);
    expect(actions(w)).toEqual(['import.allow', 'import.copy.start', 'import.copy.stop', 'import.copy.finish', 'import.copy.start', 'import.copy.finish']);
  });

  it('stop of a queued copy stops it at once, and a stopped copy cannot be stopped again', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    expect((await w.svc.stop(PLUGIN, COPY, ADMIN)).status).toBe('stopped');
    await drive(w.svc);
    expect(w.source.statements).toEqual([]);
    await expect(w.svc.stop(PLUGIN, COPY, ADMIN)).rejects.toThrow(/not running/);
    await expect(w.svc.stop(PLUGIN, 'missing', ADMIN)).rejects.toThrow(/not found/);
  });

  it('a waiting copy can be stopped, and the stop is felt in the wait', async () => {
    const w = await world(keysOf(4));
    w.holdSleeps();
    w.source.failNext(/\[Requests\].*> 'REQ0002'/, cutLink);
    await w.svc.start({ ...START, pageSize: 2 });
    await w.svc.tick();
    await vi.waitFor(async () => expect((await w.svc.get(PLUGIN, COPY))?.status).toBe('waiting'));
    expect((await w.svc.stop(PLUGIN, COPY, ADMIN)).status).toBe('stopping');
    // A start before the stop has landed is refused, not lost.
    await expect(w.svc.start(START)).rejects.toThrow(/stopping; start it again once it has stopped/);
    w.releaseSleeps();
    await w.svc.idle();
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'stopped', waiting: null, sets: { requests: { cursor: 'REQ0002' } } });
    expect(w.source.statements.filter((s) => /> 'REQ0002'/.test(s))).toHaveLength(1);
  });

  it('tick does not wait for the drives it starts; idle does', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    const release = w.source.holdNext(/\[Requests\].*> 'REQ0002'/);
    await w.svc.tick();
    await vi.waitFor(() => expect(w.calls.replace).toHaveLength(1));
    expect((await w.stored())!.status).toBe('running');
    let idle = false;
    const waiting = w.svc.idle().then(() => { idle = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(idle).toBe(false);
    release();
    await waiting;
    expect((await w.stored())!.status).toBe('completed');
  });

  it('release stops every drive at its next check and leaves the stored status, for the next server to take', async () => {
    const w = await world(keysOf(4));
    // The link stays down, so the drive waits and retries until something stops it.
    w.source.failNext(/\[Requests\].*> 'REQ0002'/, cutLink, 1_000_000);
    await w.svc.start({ ...START, pageSize: 2 });
    await w.svc.tick();
    await vi.waitFor(async () => expect((await w.stored())?.status).toBe('waiting'));
    await w.svc.release();
    const stored = (await w.stored())!;
    expect(stored).toMatchObject({ status: 'waiting', driver: 'server-1', finishedAt: null, sets: { requests: { cursor: 'REQ0002', keys: 2 } } });
    expect(actions(w)).not.toContain('import.copy.finish');
    // A released service takes no more work.
    const statements = w.source.statements.length;
    await w.svc.tick();
    await w.svc.idle();
    expect(w.source.statements.length).toBe(statements);

    // The next server takes it once the record is 2 minutes old, and finishes it.
    w.source.clearRules();
    const next = w.service('server-2');
    await drive(next);
    expect((await w.stored())!.driver).toBe('server-1');
    w.clock.now += STALE_MS + 1;
    await drive(next);
    expect((await next.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { keys: 4 } } });
  });

  it('remove is refused while the copy is running', async () => {
    const w = await world(keysOf(4));
    w.holdSleeps();
    await w.svc.start({ ...START, pageSize: 2 });
    await expect(w.svc.remove(PLUGIN, COPY, ADMIN)).rejects.toThrow(/queued; stop it before deleting it/);
    w.source.failNext(/\[Requests\].*> 'REQ0002'/, cutLink);
    const release = w.source.holdNext(/\[Requests\].*> ''/);
    await w.svc.tick();
    await vi.waitFor(async () => expect((await w.stored())?.status).toBe('running'));
    await expect(w.svc.remove(PLUGIN, COPY, ADMIN)).rejects.toThrow(/running; stop it before deleting it/);
    release();
    await vi.waitFor(async () => expect((await w.stored())?.status).toBe('waiting'));
    await expect(w.svc.remove(PLUGIN, COPY, ADMIN)).rejects.toThrow(/waiting; stop it before deleting it/);
    w.releaseSleeps();
    await w.svc.idle();
    expect((await w.svc.get(PLUGIN, COPY))!.status).toBe('completed');
    expect((await w.rows()).length).toBe(12);
    expect(actions(w)).not.toContain('import.copy.delete');
  });

  it('start is refused while a check on the copy is queued, running, waiting or stopping, and allowed otherwise', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    expect((await w.svc.get(PLUGIN, COPY))!.status).toBe('completed');
    let check: string | null = null;
    const guarded = w.service('cli-1', { liveCheckStatus: async () => check, deleteHeld: async () => 0, deleteCheck: async () => {} });
    for (const live of ['queued', 'running', 'waiting', 'stopping']) {
      check = live;
      await expect(guarded.start({ ...START, pageSize: 2 })).rejects.toThrow(`copy ${COPY} has a check that is ${live}; stop it before starting the copy again`);
    }
    // Refused starts changed nothing: the copy is still completed.
    expect((await w.svc.get(PLUGIN, COPY))!.status).toBe('completed');
    for (const ended of [null, 'stopped', 'completed', 'failed']) {
      check = ended;
      expect((await guarded.start({ ...START, pageSize: 2 })).id).toBe(COPY);
      await drive(guarded);
    }
  });

  it('start with reread is refused while a check reads the copy, and empties nothing', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const guarded = w.service('cli-1', { liveCheckStatus: async () => 'running', deleteHeld: async () => 0, deleteCheck: async () => {} });
    // The option changes the set's SQL, so this start would empty the set and read it again.
    const reread = { ...START, options: { tz: '+02:00', from: '2024-01-01' }, reread: true };
    await expect(guarded.start(reread)).rejects.toThrow(`copy ${COPY} has a check that is running; stop it before starting the copy again`);
    await expect(guarded.start({ ...reread, reread: false })).rejects.toThrow(/has a check that is running/);
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { keys: 4 } } });
    expect((await w.rows()).length).toBe(12);
  });

  it('a brand-new copy is refused while a live check names it, and no record is made', async () => {
    const w = await world(keysOf(2));
    const asked: Array<[string, string]> = [];
    const guarded = w.service('cli-1', {
      liveCheckStatus: async (pluginId, copyId) => { asked.push([pluginId, copyId]); return 'queued'; },
      deleteHeld: async () => 0,
      deleteCheck: async () => {},
    });
    await expect(guarded.start(START)).rejects.toThrow(`copy ${COPY} has a check that is queued; stop it before starting the copy again`);
    expect(asked).toEqual([[PLUGIN, COPY]]);
    expect(await w.stored()).toBeNull();
    expect(actions(w)).not.toContain('import.copy.start');
  });

  it('remove deletes the held rows of its check, then the check record, then the copy record', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    await drive(w.svc);
    const steps: string[] = [];
    let heldLeft = 2;
    const guarded = w.service('cli-1', {
      liveCheckStatus: async () => null,
      deleteHeld: async (copyId) => { steps.push(`held ${copyId}`); const gone = heldLeft; heldLeft = 0; return gone; },
      deleteCheck: async (pluginId, copyId) => { steps.push(`check ${pluginId} ${copyId}`); expect(await w.stored()).not.toBeNull(); },
    });
    await guarded.remove(PLUGIN, COPY, ADMIN);
    await drive(guarded);
    expect(steps).toEqual([`held ${COPY}`, `held ${COPY}`, `check ${PLUGIN} ${COPY}`]);
    expect(await w.stored()).toBeNull();
  });

  it('remove deletes every row in batches, then the run record', async () => {
    const w = await world(keysOf(10));
    w.source.failNext(/IN \(.*'REQ0010'/, timedOut, 1000);
    await w.svc.start({ ...START, pageSize: 5 });
    await drive(w.svc);
    expect((await w.rows()).length).toBe(27);
    expect(await w.skipped()).toHaveLength(1);

    w.capDeletes(10);
    const deleting = await w.svc.remove(PLUGIN, COPY, ADMIN);
    expect(deleting.status).toBe('deleting');
    expect(w.audited.at(-1)).toMatchObject({ action: 'import.copy.delete', runId: COPY, actor: ADMIN });
    // Not yet started: a start, a stop and a second remove are refused.
    await expect(w.svc.start(START)).rejects.toThrow(/being deleted/);
    await expect(w.svc.stop(PLUGIN, COPY, ADMIN)).rejects.toThrow(/not running/);
    await expect(w.svc.remove(PLUGIN, COPY, ADMIN)).rejects.toThrow(/deleting/);

    const savesBefore = w.runSaves.length;
    await drive(w.svc);
    expect(w.calls.deletes.map((d) => [d.limit, d.set, d.gone])).toEqual([
      [10_000, undefined, 10], [10_000, undefined, 10], [10_000, undefined, 7], [10_000, undefined, 0],
    ]);
    // Saved between batches, so another process can see the delete is alive.
    expect(w.runSaves.slice(savesBefore).filter((r) => r.status === 'deleting').length).toBeGreaterThanOrEqual(3);
    expect(await w.rows()).toEqual([]);
    expect(await w.skipped()).toEqual([]);
    expect(await w.svc.get(PLUGIN, COPY)).toBeNull();
    expect(await w.svc.list(PLUGIN)).toEqual([]);
  });

  it('a finished delete writes one audit row, by the system, with the copy id and the row count', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    await drive(w.svc);
    await w.svc.remove(PLUGIN, COPY, ADMIN);
    const before = w.audited.length;
    await drive(w.svc);
    expect(await w.svc.get(PLUGIN, COPY)).toBeNull();
    expect(w.audited.slice(before)).toEqual([{
      action: 'import.copy.finish', pluginId: PLUGIN, connectorId: 'c1', runId: COPY,
      actor: { type: 'system', id: null, name: 'system' }, metadata: { status: 'deleted', rows: 6 },
    }]);
    expect(JSON.stringify(w.audited.slice(before))).not.toContain('REQ000');
  });

  it('remove is refused when the audit row cannot be written, and leaves the copy as it was', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    await drive(w.svc);
    w.failAuditOn('import.copy.delete');
    await expect(w.svc.remove(PLUGIN, COPY, ADMIN)).rejects.toThrow(/audit log could not be written/);
    expect((await w.svc.get(PLUGIN, COPY))!.status).toBe('completed');
    expect((await w.rows()).length).toBe(6);
  });

  it('a delete cut short by a stopping server finishes when the next server takes it, and leaves no rows', async () => {
    const w = await world(keysOf(10));
    await w.svc.start({ ...START, pageSize: 5 });
    await drive(w.svc);
    w.capDeletes(10);
    await w.svc.remove(PLUGIN, COPY, ADMIN);
    // The first batch is held, and the server is told to stop while it runs.
    let releaseBatch: () => void = () => {};
    const store = w.store;
    const realDelete = store.deleteSome.bind(store);
    let first = true;
    store.deleteSome = async (id, limit, set) => {
      if (first) { first = false; await new Promise<void>((r) => { releaseBatch = r; }); }
      return realDelete(id, limit, set);
    };
    await w.svc.tick();
    await vi.waitFor(() => expect(first).toBe(false));
    const released = w.svc.release();
    releaseBatch();
    await released;
    expect((await w.stored())).toMatchObject({ status: 'deleting', driver: 'server-1' });
    expect((await w.rows()).length).toBe(20);

    const next = w.service('server-2');
    w.clock.now += STALE_MS + 1;
    await drive(next);
    expect(await w.rows()).toEqual([]);
    expect(await w.stored()).toBeNull();
    // The takeover, then the row the finished delete writes (ledger line 189).
    expect(w.audited.slice(-2)).toMatchObject([
      { action: 'import.copy.takeover', actor: { type: 'system', id: null, name: 'system' } },
      { action: 'import.copy.finish', actor: { type: 'system', id: null, name: 'system' }, metadata: { status: 'deleted', rows: 30 } },
    ]);
  });
});

describe('copy: who drives', () => {
  const at = (ms: number) => new Date(ms).toISOString();
  async function orphan(w: World, over: Partial<CopyRun>) {
    const started = await w.svc.start({ ...START, pageSize: 2 });
    const run: CopyRun = {
      ...started, status: 'running', driver: 'server-old',
      sets: { requests: { cursor: 'REQ0002', keys: 2, rows: 6, bytes: requestBytes(keysOf(2)), skipped: 0, done: false } },
      ...over,
    };
    await w.raw.put(PLUGIN, '__import-copies', COPY, run);
    return run;
  }

  it('does not take a run whose driver wrote less than 2 minutes ago', async () => {
    const w = await world(keysOf(4));
    const run = await orphan(w, { updatedAt: at(w.clock.now - 60_000) });
    await drive(w.svc);
    expect(await w.stored()).toEqual(run);
    expect(w.source.statements).toEqual([]);
    expect(actions(w)).not.toContain('import.copy.takeover');
    // Exactly 2 minutes is still a live driver.
    w.clock.now = Date.parse(run.updatedAt) + STALE_MS;
    await drive(w.svc);
    expect(w.source.statements).toEqual([]);
  });

  it('takes a run whose driver has been silent for 2 minutes, and audits the takeover', async () => {
    const w = await world(keysOf(4));
    await orphan(w, { updatedAt: at(w.clock.now - STALE_MS - 1) });
    await w.svc.tick();
    expect((await w.stored())!.driver).toBe('server-1');
    await w.svc.idle();
    expect(w.audited.find((e) => e.action === 'import.copy.takeover')).toEqual({
      action: 'import.copy.takeover', pluginId: PLUGIN, connectorId: 'c1', runId: COPY,
      actor: { type: 'system', id: null, name: 'system' }, metadata: { status: 'running' },
    });
    expect((await w.svc.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', driver: null, sets: { requests: { cursor: 'REQ0004', keys: 4, rows: 12 } } });
    expect(keyAfters(w)).toEqual(['REQ0002', 'REQ0004']);
  });

  it('a release during a takeover audit write launches no drive, and idle resolves', async () => {
    const w = await world(keysOf(4));
    await orphan(w, { updatedAt: at(w.clock.now - STALE_MS - 1) });
    // The claim is written; the takeover's audit row is held. The release lands in that gap.
    const held = w.holdAudit('import.copy.takeover');
    const ticking = w.svc.tick();
    await held.reached;
    expect((await w.stored())!.driver).toBe('server-1');
    await w.svc.release();
    held.release();
    await ticking;
    await w.svc.idle();
    // Nothing was launched: no plugin call, no source query, no write after the claim.
    expect(w.invoke).toHaveBeenCalledTimes(1);
    expect(w.source.statements).toEqual([]);
    expect((await w.stored())!).toMatchObject({ status: 'running', driver: 'server-1' });
    expect(w.runSaves.at(-1)!.driver).toBe('server-1');
  });

  it('a stale stopping run is taken and ends as stopped; a finished run is never taken', async () => {
    const w = await world(keysOf(4));
    await orphan(w, { status: 'stopping', updatedAt: at(w.clock.now - STALE_MS - 1) });
    await drive(w.svc);
    expect((await w.stored())!).toMatchObject({ status: 'stopped', driver: null });
    expect(w.source.statements).toEqual([]);
    w.clock.now += 10 * STALE_MS;
    await drive(w.svc);
    expect(actions(w).filter((a) => a === 'import.copy.takeover')).toHaveLength(1);
  });

  it('carries on from the saved position when a new process takes the run', async () => {
    const w = await world(keysOf(6));
    const a = w.service('server-a');
    await a.start({ ...START, pageSize: 2 });
    // Process A reads two pages, then its third key query never answers, as when it is killed.
    const unhang = w.source.holdNext(/\[Requests\].*> 'REQ0004'/);
    await a.tick();
    await vi.waitFor(() => expect(w.calls.replace).toHaveLength(2));
    await vi.waitFor(async () => expect((await w.stored())?.sets.requests.cursor).toBe('REQ0004'));

    const b = w.service('server-b');
    w.clock.now += STALE_MS + 1;
    await drive(b);
    expect((await b.get(PLUGIN, COPY))!).toMatchObject({ status: 'completed', sets: { requests: { cursor: 'REQ0006', keys: 6, rows: 18 } } });
    expect(w.audited.find((e) => e.action === 'import.copy.takeover')).toMatchObject({ actor: { type: 'system' }, runId: COPY });
    expect(w.calls.replace.map((c) => c.keys)).toEqual([['REQ0001', 'REQ0002'], ['REQ0003', 'REQ0004'], ['REQ0005', 'REQ0006']]);

    // A's query answers late. A has lost the run, so it writes nothing.
    const saves = w.runSaves.length;
    unhang();
    await a.idle();
    expect(w.calls.replace).toHaveLength(3);
    expect(w.runSaves.length).toBe(saves);
    expect((await w.stored())!).toMatchObject({ status: 'completed', driver: null });
  });

  it('a heartbeat in the middle of a page saves the run as it stood at the last page end', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      // The copy the interrupted one must end up equal to.
      const whole = await world(keysOf(6));
      await whole.svc.start({ ...START, pageSize: 2 });
      await drive(whole.svc);
      const clean = (await whole.svc.get(PLUGIN, COPY))!;
      const cleanRows = await whole.rows();
      await internalDb.destroy();
      internalDb = await makeMigratedDb();

      const w = await world(keysOf(6));
      const a = w.service('server-a');
      await a.start({ ...START, pageSize: 2 });
      // Page 2's results query hangs: its key and requests queries have answered.
      w.source.holdNext(/LabResults.*'REQ0003'/);
      await a.tick();
      await vi.waitFor(() => expect(w.source.statements.some((s) => /LabResults.*'REQ0003'/.test(s))).toBe(true));
      const before = w.runSaves.length;
      w.clock.now += 30_000;
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(w.runSaves.length).toBe(before + 1));
      expect(w.runSaves[before]).toMatchObject({
        status: 'running', driver: 'server-a', updatedAt: new Date(w.clock.now).toISOString(),
        sets: { requests: { cursor: 'REQ0002', keys: 2, rows: 6, bytes: requestBytes(keysOf(2)), done: false } },
      });

      // A dies there. B takes the run and finishes it from the stored record.
      const b = w.service('server-b');
      w.clock.now += STALE_MS + 1;
      await drive(b);
      const done = (await b.get(PLUGIN, COPY))!;
      expect(done.sets).toEqual(clean.sets);
      expect(await w.rows()).toEqual(cleanRows);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('copy: what may be shown', () => {
  it('no audit row and no error text holds a key or a row value', async () => {
    const keys = ['K-SECRET-01', 'K-SECRET-02', 'K-SECRET-03', 'K-SECRET-04', 'K-SECRET-05'];
    const w = await world(keys);
    w.source.rowsFrom((table, ks) => (table === 'Requests' ? ks.map((k) => ({ __key: k, RequestID: k, Name: 'Maria Santos' })) : undefined));
    // A cut link on page 1, a key that cannot be read, then SQL Server error 245 quoting a value.
    w.source.failNext(/\[Requests\].*> ''/, cutLink);
    w.source.failNext(/IN \(.*'K-SECRET-02'/, timedOut, 1000);
    w.source.failNext(/LabResults.*'K-SECRET-04'/, () => Object.assign(
      new Error("Conversion failed when converting the varchar value 'Maria Santos' to data type int."),
      { code: 'EREQUEST', number: 245 },
    ), 1000);
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    const run = (await w.svc.get(PLUGIN, COPY))!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toBe('the source refused the query (SQL Server error 245)');
    expect(w.runSaves.some((r) => r.waiting !== null)).toBe(true);
    expect(w.runSaves.some((r) => r.sets.requests?.skipped === 1)).toBe(true);

    const errors = [run.lastError, ...w.runSaves.map((r) => r.lastError), ...w.runSaves.map((r) => r.waiting?.error ?? null)];
    const changed = await w.svc.start({ ...START, options: { from: '2020-01-01' } }).catch((e: Error) => e.message);
    const shown = JSON.stringify([w.audited, errors, changed]);
    for (const k of keys) expect(shown).not.toContain(k);
    expect(shown).not.toContain('K-SECRET');
    expect(shown).not.toContain('Maria');
    expect(shown).not.toContain('secret-pw');
  });
});

// R28 and R29. Each race is built by holding a write after its caller has read the record, never by
// timing. pg-mem runs one statement at a time, so these show the service's handling of a refused
// write. That Postgres runs putIfRev as one statement is Postgres's guarantee, not shown here.
describe('copy: two callers at the same moment', () => {
  async function completedCopy(n = 4) {
    const w = await world(keysOf(n));
    await w.svc.start({ ...START, pageSize: 2 });
    await drive(w.svc);
    expect((await w.stored())!.status).toBe('completed');
    return w;
  }

  it('every write adds 1 to rev, starting at 1', async () => {
    const w = await world(keysOf(2));
    expect((await w.svc.start(START)).rev).toBe(1);
    await drive(w.svc);
    const revs = w.runSaves.map((r) => r.rev);
    expect(revs).toEqual(revs.map((_, i) => i + 1));
    expect((await w.stored())!.rev).toBe(revs.length);
  });

  it('a start and a remove racing on a completed copy: the remove wins, and the copy is deleted whole', async () => {
    const w = await completedCopy();
    // The start has read `completed` and is about to write `queued`.
    const held = w.pauseWrite((d) => d.status === 'queued');
    const starting = w.svc.start(START).then(() => 'started', (e: Error) => e.message);
    await held.reached;
    expect((await w.svc.remove(PLUGIN, COPY, ADMIN)).status).toBe('deleting');
    held.release();
    expect(await starting).toMatch(/being deleted/);
    expect((await w.stored())!.status).toBe('deleting');
    await drive(w.svc);
    expect(await w.stored()).toBeNull();
    expect(await w.rows()).toEqual([]);
  });

  it('a start and a remove racing on a completed copy: the start wins, and the copy keeps every row', async () => {
    const w = await completedCopy();
    const rows = await w.rows();
    // The remove has read `completed` and is about to write `deleting`.
    const held = w.pauseWrite((d) => d.status === 'deleting');
    const removing = w.svc.remove(PLUGIN, COPY, ADMIN).then(() => 'removed', (e: Error) => e.message);
    await held.reached;
    expect((await w.svc.start(START)).status).toBe('queued');
    held.release();
    expect(await removing).toMatch(/queued; stop it before deleting it/);
    await drive(w.svc);
    expect((await w.stored())!).toMatchObject({ status: 'completed', sets: { requests: { keys: 4, rows: 12 } } });
    expect(await w.rows()).toEqual(rows);
    expect(w.calls.deletes).toEqual([]);
  });

  it('a stop of a queued copy and a claim racing: the person is never told stopped while it runs', async () => {
    const w = await world(keysOf(4));
    await w.svc.start(START);
    const held = w.pauseWrite((d) => d.status === 'running');
    const ticking = w.svc.tick();
    await held.reached;
    expect((await w.svc.stop(PLUGIN, COPY, ADMIN)).status).toBe('stopped');
    held.release();
    await ticking;
    await w.svc.idle();
    expect((await w.stored())!.status).toBe('stopped');
    expect(w.source.statements).toEqual([]);
  });

  it('two claims on one queued run give one driver', async () => {
    const w = await world(keysOf(6));
    await w.svc.start({ ...START, pageSize: 2 });
    const a = w.service('server-a');
    const b = w.service('server-b');
    const held = w.pauseWrite((d) => d.driver === 'server-a');
    const aTick = a.tick();
    await held.reached;
    // B claims while A's claim waits, and B is in the middle of its first page when A's lands.
    const bHold = w.source.holdNext(/\[Requests\].*> ''/);
    await b.tick();
    held.release();
    await aTick;
    await a.idle();
    bHold();
    await b.idle();
    expect((await w.stored())!).toMatchObject({ status: 'completed', driver: null, sets: { requests: { keys: 6, rows: 18 } } });
    expect(keyAfters(w)).toEqual(['', 'REQ0002', 'REQ0004', 'REQ0006']);
    expect(w.calls.replace.map((c) => c.keys[0])).toEqual(['REQ0001', 'REQ0003', 'REQ0005']);
    expect(w.runSaves.some((r) => r.driver === 'server-a')).toBe(false);
  });

  it('a drive whose record was taken by another process writes no further row and no further progress', async () => {
    const w = await world(keysOf(6));
    const a = w.service('server-a');
    await a.start({ ...START, pageSize: 2 });
    // A has written page 1's rows and is about to save its position.
    const held = w.pauseWrite((d) => d.driver === 'server-a' && d.sets.requests.cursor === 'REQ0002');
    await a.tick();
    await held.reached;
    expect(w.calls.replace).toHaveLength(1);
    // A looks dead for 2 minutes. B takes the run, and is held on its first key query.
    w.clock.now += STALE_MS + 1;
    const b = w.service('server-b');
    const bHold = w.source.holdNext(/\[Requests\].*> ''/);
    await b.tick();
    expect((await w.stored())!.driver).toBe('server-b');
    const statements = w.source.statements.length;
    const aSaves = w.runSaves.filter((r) => r.driver === 'server-a').length;
    held.release();
    await a.idle();
    // A's save was refused. It read the record, saw B, and stopped: no row, no query, no write.
    expect(w.calls.replace).toHaveLength(1);
    expect(w.source.statements.length).toBe(statements);
    expect(w.runSaves.filter((r) => r.driver === 'server-a').length).toBe(aSaves);
    expect((await w.stored())!.driver).toBe('server-b');
    bHold();
    await b.idle();
    expect((await w.stored())!).toMatchObject({ status: 'completed', sets: { requests: { cursor: 'REQ0006', keys: 6, rows: 18 } } });
    expect((await w.rows())).toHaveLength(18);
  });

  it('a stop that lands while the drive saves is obeyed: the drive puts its progress on the stopped record', async () => {
    const w = await world(keysOf(6));
    await w.svc.start({ ...START, pageSize: 2 });
    const held = w.pauseWrite((d) => d.driver === 'server-1' && d.sets.requests.cursor === 'REQ0002');
    await w.svc.tick();
    await held.reached;
    // Another process asks for the stop. This one has no local drive for it to flag.
    expect((await w.service('cli-1').stop(PLUGIN, COPY, ADMIN)).status).toBe('stopping');
    held.release();
    await w.svc.idle();
    expect((await w.stored())!).toMatchObject({ status: 'stopped', sets: { requests: { cursor: 'REQ0002', keys: 2, rows: 6 } } });
    expect(keyAfters(w)).toEqual(['']);
  });

  it('start, stop and remove read again and decide again on a refused write, and give up after 3', async () => {
    const w = await completedCopy();
    // Another writer changes the record before each of start's writes, 3 times.
    w.rivalWrites((d) => d.status === 'queued', 3);
    await expect(w.svc.start(START)).rejects.toThrow('the copy changed at the same moment; try again');
    expect((await w.stored())!.status).toBe('completed');
    // Twice is still within 3 tries.
    w.rivalWrites((d) => d.status === 'deleting', 2);
    expect((await w.svc.remove(PLUGIN, COPY, ADMIN)).status).toBe('deleting');
    expect(actions(w).filter((a) => a === 'import.copy.delete')).toHaveLength(1);
  });

  it('a second tick while one runs returns the first one, and launches nothing twice', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    const held = w.pauseWrite((d) => d.status === 'running');
    const first = w.svc.tick();
    await held.reached;
    const second = w.svc.tick();
    expect(second).toBe(first);
    held.release();
    await first;
    await w.svc.idle();
    expect((await w.stored())!).toMatchObject({ status: 'completed', sets: { requests: { keys: 4 } } });
    expect(keyAfters(w)).toEqual(['', 'REQ0002', 'REQ0004']);
    // A tick after the first ended runs again.
    const third = w.svc.tick();
    expect(third).not.toBe(first);
    await third;
  });

  it('release does not wait on a tick, and a tick that was running when release came drives nothing', async () => {
    const w = await world(keysOf(4));
    await w.svc.start(START);
    const held = w.pauseWrite((d) => d.status === 'running');
    let ticked = false;
    const ticking = w.svc.tick().then(() => { ticked = true; });
    await held.reached;
    await w.svc.release();
    expect(ticked).toBe(false);
    held.release();
    await ticking;
    await w.svc.idle();
    expect(w.source.statements).toEqual([]);
    expect(w.invoke).toHaveBeenCalledTimes(1);
  });

  it('a crash after a skipped key is listed and before the position is saved counts the key once', async () => {
    const w = await world(keysOf(4));
    // REQ0002 is skipped in A's pass. A dies before it saves the position past it.
    w.source.failNext(/IN \(.*'REQ0002'/, timedOut, 1000);
    const a = w.service('server-a');
    await a.start({ ...START, pageSize: 4 });
    const held = w.pauseWrite((d) => d.driver === 'server-a' && d.sets.requests.skipped === 1);
    await a.tick();
    await held.reached;
    expect(await w.skipped()).toHaveLength(1);
    expect((await w.stored())!.sets.requests).toMatchObject({ cursor: 'REQ0001', skipped: 0 });

    // The source is quick again. B reads REQ0002 in its pass, then meets its listing at the end.
    w.source.clearRules();
    w.clock.now += STALE_MS + 1;
    const b = w.service('server-b');
    await drive(b);
    expect((await w.stored())!.sets.requests).toEqual({
      cursor: 'REQ0004', keys: 4, rows: 12, bytes: requestBytes(keysOf(4)), skipped: 0, done: true,
    });
    expect(await w.skipped()).toEqual([]);
    held.release();
    await a.idle();
  });

  it('a stop in the middle of emptying a set keeps the mark, and the next drive finishes emptying it', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, options: { from: '2024-01-01' } });
    await drive(w.svc);
    await w.svc.start({ ...START, options: { from: '2023-01-01' }, reread: true });
    w.capDeletes(5);
    // The save after the first batch: 5 of 12 rows gone. The claim is the write before it.
    let marked = 0;
    const held = w.pauseWrite((d) => d.status === 'running' && d.sets.requests.empty === true && ++marked === 2);
    await w.svc.tick();
    await held.reached;
    expect(await w.rows()).toHaveLength(7);
    expect((await w.service('cli-1').stop(PLUGIN, COPY, ADMIN)).status).toBe('stopping');
    held.release();
    await w.svc.idle();
    const stopped = (await w.stored())!;
    expect(stopped.status).toBe('stopped');
    expect(stopped.sets.requests.empty).toBe(true);

    expect((await w.svc.start({ ...START, options: { from: '2023-01-01' } })).status).toBe('queued');
    await drive(w.svc);
    expect((await w.stored())!).toMatchObject({ status: 'completed', sets: { requests: { keys: 4, rows: 12, done: true } } });
    expect((await w.stored())!.sets.requests.empty).toBeUndefined();
    expect(await w.rows()).toHaveLength(12);
  });

  it('get puts the sets back in the plugin order, whatever order the store gives them in', async () => {
    const w = await world(keysOf(1), ['F01']);
    w.setCopy((o) => ({ sets: [requestsSet(o.from), facilitiesSet] }));
    const started = await w.svc.start(START);
    // As Postgres jsonb would hand them back: keys sorted, not in the plugin's order.
    await w.raw.put(PLUGIN, '__import-copies', COPY, { ...started, sets: { facilities: started.sets.facilities, requests: started.sets.requests } });
    expect(Object.keys((await w.svc.get(PLUGIN, COPY))!.sets)).toEqual(['requests', 'facilities']);
    expect(Object.keys((await w.svc.list(PLUGIN))[0].sets)).toEqual(['requests', 'facilities']);
  });
});

// R33. After a power cut every service starts at once, and the place plugin code is stored may come
// up after the server. The plugin's code loader is made to throw as the S3 client does when blob
// storage is not up. Not covered: a real blob store, a real restart order of services.
describe('copy: the plugin code cannot be loaded yet', () => {
  const NOT_LOADED = "the plugin's code could not be loaded yet";

  it('waits for the plugin code, then completes with no person', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    w.failSinkLoads(2);
    await drive(w.svc);
    expect(await w.svc.get(PLUGIN, COPY)).toMatchObject({
      status: 'completed', waiting: null, lastError: null, sets: { requests: { keys: 4, done: true } },
    });
    const at = new Date(w.clock.now).toISOString();
    expect(w.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting)).toEqual([
      { since: at, attempt: 1, error: NOT_LOADED },
      { since: at, attempt: 2, error: NOT_LOADED },
    ]);
    // 5 seconds, then 10, in slices of a second.
    expect(w.sleeps).toEqual([...Array(5).fill(1000), ...Array(10).fill(1000)]);
    expect(JSON.stringify(w.runSaves)).not.toMatch(/secret-pw|ECONNREFUSED|10\.0\.0\.9/);
    expect(actions(w)).toEqual(['import.allow', 'import.copy.start', 'import.copy.finish']);
  });

  it('a release is felt while it waits, and leaves the status for the next server', async () => {
    const w = await world(keysOf(4));
    w.holdSleeps();
    await w.svc.start({ ...START, pageSize: 2 });
    w.failSinkLoads(1_000_000);
    await w.svc.tick();
    await vi.waitFor(async () => expect((await w.stored())?.status).toBe('waiting'));
    const releasing = w.svc.release();
    w.releaseSleeps();
    await releasing;
    expect(await w.stored()).toMatchObject({ status: 'waiting', driver: 'server-1', finishedAt: null, lastError: null });
    expect(actions(w)).not.toContain('import.copy.finish');
    expect(w.sleeps.every((ms) => ms <= 1000)).toBe(true);

    // The storage is up when the next server takes the copy.
    w.failSinkLoads(0);
    const next = w.service('server-2');
    w.clock.now += STALE_MS + 1;
    await drive(next);
    expect(await next.get(PLUGIN, COPY)).toMatchObject({ status: 'completed', sets: { requests: { keys: 4 } } });
  });

  it('a stop is felt while it waits, and ends the copy stopped', async () => {
    const w = await world(keysOf(4));
    w.holdSleeps();
    await w.svc.start({ ...START, pageSize: 2 });
    w.failSinkLoads(1_000_000);
    await w.svc.tick();
    await vi.waitFor(async () => expect((await w.stored())?.status).toBe('waiting'));
    expect((await w.svc.stop(PLUGIN, COPY, ADMIN)).status).toBe('stopping');
    w.releaseSleeps();
    await w.svc.idle();
    expect(await w.stored()).toMatchObject({ status: 'stopped', driver: null, waiting: null, lastError: null });
    expect(w.source.statements).toEqual([]);
  });

  it('the heartbeat keeps running while it waits', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const w = await world(keysOf(4));
      w.holdSleeps();
      await w.svc.start({ ...START, pageSize: 2 });
      w.failSinkLoads(1);
      await w.svc.tick();
      await vi.waitFor(async () => expect((await w.stored())?.status).toBe('waiting'));
      const before = w.runSaves.length;
      w.clock.now += 30_000;
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(w.runSaves.length).toBe(before + 1));
      expect(w.runSaves[before]).toMatchObject({
        status: 'waiting', waiting: { attempt: 1, error: NOT_LOADED }, updatedAt: new Date(w.clock.now).toISOString(),
      });
      w.releaseSleeps();
      await w.svc.idle();
      expect((await w.stored())?.status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a 503 from the storage waits too', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    w.failSinkLoads(1, () => Object.assign(new Error('ServiceUnavailable'), { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } }));
    await drive(w.svc);
    expect(await w.stored()).toMatchObject({ status: 'completed', lastError: null });
    expect(w.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting?.error)).toEqual([NOT_LOADED]);
  });

  it('a hash mismatch on the plugin code fails the copy at once, and shows why', async () => {
    // A tamper signal a person must see. It never reads as "not loaded yet".
    const w = await world(keysOf(2));
    await w.svc.start(START);
    w.failSinkLoads(1_000_000, hashMismatch);
    await drive(w.svc);
    const run = (await w.stored())!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toBe('plugin v1-import@1.2.0 sha256 mismatch (expected aa11, got bb22)');
    expect(w.sleeps).toEqual([]);
    expect(w.runSaves.some((r) => r.status === 'waiting')).toBe(false);
    expect(w.source.statements).toEqual([]);
  });

  it('a missing code file fails the copy at once', async () => {
    const w = await world(keysOf(2));
    await w.svc.start(START);
    w.failSinkLoads(1_000_000, missingFile);
    await drive(w.svc);
    const run = (await w.stored())!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toContain('ENOENT: no such file or directory');
    expect(w.sleeps).toEqual([]);
    expect(w.runSaves.some((r) => r.status === 'waiting')).toBe(false);
  });

  it('a plugin with no invokable code still ends the copy as failed, with no wait', async () => {
    const w = await world(keysOf(4));
    await w.svc.start({ ...START, pageSize: 2 });
    w.setNoSink(true);
    await drive(w.svc);
    const run = (await w.stored())!;
    expect(run.status).toBe('failed');
    expect(run.lastError).toContain('exposes no invokable wasm');
    expect(w.sleeps).toEqual([]);
    expect(w.runSaves.some((r) => r.status === 'waiting')).toBe(false);
  });
});
