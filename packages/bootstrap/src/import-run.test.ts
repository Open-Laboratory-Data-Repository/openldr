import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginDataStore, type PluginDataStore } from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { STALE_MS, createImportService, type ImportActor, type ImportAuditEvent, type ImportRun, type ImportService } from './import-run';

const ADMIN: ImportActor = { type: 'user', id: 'u-admin', name: 'admin' };

// Layer under test: the import service and the real page reader over the real plugin_data store
// on pg-mem. The plugin (wasm), the source database, its errors, the reader's waits and CE's save
// function are fakes. Not covered here: real SQL Server and the errors tedious really throws, real
// wasm, real Postgres.

const KEY_SQL = 'SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > {{after}} ORDER BY [RequestID]';
const REQ_SQL = 'SELECT [RequestID], [RegisteredDateTime] FROM [dbo].[Requests] WHERE [RequestID] IN ({{keys}})';
const RES_SQL = 'SELECT [RequestID], [SIValue] FROM [dbo].[LabResults] WHERE [RequestID] IN ({{keys}})';

function manifest(over: { capabilities?: unknown[]; importSource?: unknown } = {}) {
  return {
    schemaVersion: 1, type: 'plugin', id: 'v1-import', version: '1.2.0',
    capabilities: over.capabilities ?? [{ kind: 'host:import' }, { kind: 'emit-fhir', resourceTypes: ['Patient', 'ServiceRequest'] }],
    payload: {
      kind: 'plugin', entrypoints: ['import_queries', 'import_checks', 'import_map'],
      importSource: 'importSource' in over ? over.importSource : {
        connectorTypes: ['microsoft-sql'], sourceSystem: 'openldr-v1',
        entrypoints: { queries: 'import_queries', checks: 'import_checks', map: 'import_map' },
      },
    },
  };
}

/** What the S3 client throws when blob storage is not up: Node's socket error, passed on as it is. */
const storageRefused = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:3900 secret-pw'), { code: 'ECONNREFUSED' });
/** What the plugin runtime throws when the stored code is not the code that was installed. */
const hashMismatch = () => new Error('plugin v1-import@1.2.0 sha256 mismatch (expected aa11, got bb22)');
/** What the file-system adapter throws for a code file that is not there. */
const missingFile = () => Object.assign(new Error("ENOENT: no such file or directory, open '/data/objects/plugins/v1-import/1.2.0/plugin.wasm'"), { code: 'ENOENT' });

/** What tedious throws for a missing table: the SQL Server itself refused the query. */
const missingTable = () => Object.assign(new Error("Invalid object name 'dbo.Requests'."), { code: 'EREQUEST', number: 208 });
/** What tedious throws when the link drops in the middle of a query. */
const cutLink = () => Object.assign(new Error('Connection lost - read ECONNRESET at secret-pw'), { code: 'ESOCKET' });
/** What tedious throws when a query runs out of time. */
const timedOut = () => Object.assign(new Error('Timeout: Request failed to complete in 30000ms'), { code: 'ETIMEOUT' });

/** A fake v1 database: answers the filled-in key and detail statements from a list of keys. */
function fakeSource(keys: string[]) {
  const sorted = [...keys].sort();
  const statements: string[] = [];
  let closed = 0;
  let failOn: RegExp | null = null;
  /** Throw `err` for the next `left` statements that match `re`. */
  const rules: Array<{ re: RegExp; err: () => unknown; left: number }> = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      if (failOn?.test(sql)) throw missingTable();
      const rule = rules.find((r) => r.left > 0 && r.re.test(sql));
      if (rule) { rule.left -= 1; throw rule.err(); }
      if (sql === 'SELECT 1') return { rows: [{ ok: 1 }] };
      const top = /TOP \((\d+)\)/.exec(sql);
      if (top) {
        const after = /> '((?:[^']|'')*)'/.exec(sql)![1].replace(/''/g, "'");
        return { rows: sorted.filter((k) => k > after).slice(0, Number(top[1])).map((k) => ({ RequestID: k })) };
      }
      if (/select count/i.test(sql)) return { rows: [{ n: sorted.length }] };
      const inList = [...sql.slice(sql.indexOf('IN (')).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
      const date = new Date(Date.UTC(2024, 2, 5, 14, 30, 0, 0));
      return { rows: inList.map((k) => (sql.includes('LabResults') ? { RequestID: k, SIValue: 4.2 } : { RequestID: k, RegisteredDateTime: date })) };
    },
    async close() { closed += 1; },
  };
  return {
    db, statements, closed: () => closed, failWhen: (re: RegExp | null) => { failOn = re; },
    failNext: (re: RegExp, err: () => unknown, times = 1) => { rules.push({ re, err, left: times }); },
  };
}

interface Harness {
  svc: ImportService;
  source: ReturnType<typeof fakeSource>;
  persist: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
  audited: ImportAuditEvent[];
  mapInputs: Array<{ keys: string[]; rows: Record<string, Array<Record<string, unknown>>>; options: Record<string, string> }>;
  setManifest(m: unknown): void;
  setQueries(q: unknown): void;
  setMapper(fn: (input: { keys: string[] }) => unknown): void;
  clock: { now: number };
  /** Make the audit sink throw for this action, as when the audit store is down. */
  failAuditOn(action: ImportAuditEvent['action'] | null): void;
  /** Every run record as it was saved, in order. */
  runSaves: ImportRun[];
  /** Every warn line the service logged. */
  warnings: Array<{ fields: Record<string, unknown>; msg: string }>;
  /** Every wait the reader asked for, in ms. */
  sleeps: number[];
  /** Hold every wait until `releaseSleeps`. Waits end at once otherwise. */
  holdSleeps(): void;
  releaseSleeps(): void;
  /** The next `times` loads of the plugin's code throw `fault`. By default the S3 client's refused
   *  connection, as when the place the code is stored is not up yet. */
  failSinkLoads(times: number, fault?: () => unknown): void;
  /** Loading the plugin's code finds no invokable wasm. */
  setNoSink(on: boolean): void;
}

let internalDb: Awaited<ReturnType<typeof makeMigratedDb>>;

async function harness(keys: string[], opts: { origin?: 'server' | 'cli' } = {}): Promise<Harness> {
  const source = fakeSource(keys);
  const runSaves: ImportRun[] = [];
  const warnings: Harness['warnings'] = [];
  const sleeps: number[] = [];
  let held = false;
  let waiters: Array<() => void> = [];
  const store = createPluginDataStore(internalDb);
  const pluginData: PluginDataStore = {
    ...store,
    async put(pluginId, collection, key, doc) {
      if (collection === '__import-runs') runSaves.push(structuredClone(doc) as ImportRun);
      return store.put(pluginId, collection, key, doc);
    },
  };
  const audited: ImportAuditEvent[] = [];
  const mapInputs: Harness['mapInputs'] = [];
  let auditFails: ImportAuditEvent['action'] | null = null;
  let currentManifest: unknown = manifest();
  let queries: unknown = { keyQuery: { sql: KEY_SQL }, detailQueries: [{ name: 'requests', sql: REQ_SQL }, { name: 'results', sql: RES_SQL }] };
  let mapper = (input: { keys: string[] }): unknown => ({
    groups: input.keys.map((key) => ({ key, resources: [{ resourceType: 'Patient', id: `p-${key}` }, { resourceType: 'ServiceRequest', id: `sr-${key}` }] })),
  });
  const invoke = vi.fn(async (entrypoint: string, input: any) => {
    if (entrypoint === 'import_queries') return queries;
    if (entrypoint === 'import_checks') return { checks: [{ id: 'requests', sql: 'SELECT COUNT(*) AS n FROM [dbo].[Requests]' }, { id: 'bad', sql: 'DELETE FROM [dbo].[Requests]' }] };
    mapInputs.push(input);
    return mapper(input);
  });
  const persist = vi.fn(async (resources: unknown[]) => resources.map(() => ({ saved: true })));
  const clock = { now: Date.UTC(2026, 10, 11, 12, 0, 0) };
  let sinkLoadFaults = 0;
  let sinkFault: () => unknown = storageRefused;
  let noSink = false;
  const svc = createImportService({
    plugins: {
      list: async () => [{ id: 'v1-import', version: '1.2.0', enabled: true, manifest: currentManifest as Record<string, unknown> }],
      loadSink: async () => {
        if (sinkLoadFaults > 0) {
          sinkLoadFaults -= 1;
          throw sinkFault();
        }
        return noSink ? undefined : { invoke };
      },
    },
    connectors: {
      get: async (id) => (id === 'c1' ? { type: 'microsoft-sql', enabled: true } : id === 'pg' ? { type: 'postgres', enabled: true } : id === 'off' ? { type: 'microsoft-sql', enabled: false } : null),
      getDecryptedConfig: async () => ({ host: 'v1', password: 'secret-pw' }),
    },
    secretsKey: 'k',
    logger: { warn: (fields: Record<string, unknown>, msg: string) => { warnings.push({ fields, msg }); } },
    pluginData,
    persist,
    audit: async (e) => { if (e.action === auditFails) throw new Error('audit store down'); audited.push(e); },
    createDb: () => source.db,
    now: () => new Date(clock.now),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (held) await new Promise<void>((resolve) => { waiters.push(resolve); });
    },
    ...(opts.origin ? { origin: opts.origin } : {}),
  });
  await svc.allow('v1-import', 'c1', ADMIN);
  return {
    svc, source, persist, invoke, audited, mapInputs, clock, runSaves, sleeps, warnings,
    holdSleeps: () => { held = true; },
    releaseSleeps: () => { held = false; const w = waiters; waiters = []; for (const resolve of w) resolve(); },
    failAuditOn: (action) => { auditFails = action; },
    failSinkLoads: (times, fault = storageRefused) => { sinkLoadFaults = times; sinkFault = fault; },
    setNoSink: (on) => { noSink = on; },
    setManifest: (m) => { currentManifest = m; },
    setQueries: (q) => { queries = q; },
    setMapper: (fn) => { mapper = fn; },
  };
}

const START = { pluginId: 'v1-import', connectorId: 'c1', options: { tz: '+02:00' }, actor: ADMIN };
const keysOf = (n: number) => Array.from({ length: n }, (_, i) => `REQ${String(i + 1).padStart(4, '0')}`);

beforeEach(async () => { internalDb = await makeMigratedDb(); });
afterEach(async () => { await internalDb.destroy(); });

describe('import run', () => {
  it('pages through every key by keyset and completes', async () => {
    const h = await harness(keysOf(5));
    const started = await h.svc.start({ ...START, pageSize: 2 });
    expect(started.status).toBe('running');
    const done = await h.svc.wait(started.id);
    expect(done).toMatchObject({ status: 'completed', cursor: 'REQ0005', counts: { keys: 5, imported: 5, failed: 0, resources: 10 } });
    expect(done.finishedAt).not.toBeNull();
    // Three pages of keys (2, 2, 1) then an empty page.
    const keyStatements = h.source.statements.filter((s) => s.includes('TOP ('));
    expect(keyStatements.map((s) => /> '([^']*)'/.exec(s)![1])).toEqual(['', 'REQ0002', 'REQ0004', 'REQ0005']);
    expect(h.mapInputs.map((m) => m.keys)).toEqual([['REQ0001', 'REQ0002'], ['REQ0003', 'REQ0004'], ['REQ0005']]);
    expect(h.source.closed()).toBe(1);
  });

  it('gives the plugin the detail rows by name, with dates as wall-clock text, and its options', async () => {
    const h = await harness(keysOf(1));
    await h.svc.wait((await h.svc.start(START)).id);
    expect(h.mapInputs[0]).toEqual({
      keys: ['REQ0001'],
      rows: { requests: [{ RequestID: 'REQ0001', RegisteredDateTime: '2024-03-05T14:30:00.000' }], results: [{ RequestID: 'REQ0001', SIValue: 4.2 }] },
      options: { tz: '+02:00' },
    });
  });

  it('saves one request at a time, stamped with the run, the plugin and the source system', async () => {
    const h = await harness(keysOf(2));
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(h.persist).toHaveBeenCalledTimes(2);
    expect(h.persist).toHaveBeenNthCalledWith(1,
      [{ resourceType: 'Patient', id: 'p-REQ0001' }, { resourceType: 'ServiceRequest', id: 'sr-REQ0001' }],
      { batchId: run.id, pluginId: 'v1-import', pluginVersion: '1.2.0', sourceSystem: 'openldr-v1' },
    );
  });

  it('counts and lists a request the plugin could not map, and still saves the rest', async () => {
    const h = await harness(keysOf(3));
    h.setMapper(({ keys }) => ({
      groups: keys.map((key) => (key === 'REQ0002'
        ? { key, resources: [], error: 'NO_REQUEST_ROWS' }
        : { key, resources: [{ resourceType: 'Patient', id: `p-${key}` }] })),
    }));
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run).toMatchObject({ status: 'completed', counts: { keys: 3, imported: 2, failed: 1, resources: 2 } });
    expect(await h.svc.failures('v1-import', run.id)).toEqual([{ key: 'REQ0002', error: 'NO_REQUEST_ROWS' }]);
  });

  it('never stores what a plugin or a save error says, only a code', async () => {
    const h = await harness(keysOf(3));
    h.setMapper(({ keys }) => ({
      groups: keys.map((key) => (key === 'REQ0001'
        ? { key, resources: [], error: 'patient Maria Santos has no DOB' }
        : { key, resources: [{ resourceType: 'Patient', id: `p-${key}` }] })),
    }));
    h.persist.mockImplementation(async (resources: Array<{ id: string }>) => {
      if (resources[0].id === 'p-REQ0003') throw Object.assign(new Error('invalid: name Maria Santos'), { code: 'VA0002' });
      return [];
    });
    const run = await h.svc.wait((await h.svc.start(START)).id);
    const failures = await h.svc.failures('v1-import', run.id);
    expect(failures).toEqual([{ key: 'REQ0001', error: 'MAPPING_FAILED' }, { key: 'REQ0003', error: 'VA0002' }]);
    expect(JSON.stringify([run, failures])).not.toContain('Maria');
  });

  it('fails a request with no group, a wrong group, or a resource type the plugin may not write', async () => {
    const h = await harness(keysOf(3));
    h.setMapper(() => ({ groups: [
      { key: 'REQ0001', resources: [{ resourceType: 'Observation', id: 'o1' }] },
      { key: 'NOT-ON-THIS-PAGE', resources: [{ resourceType: 'Patient', id: 'x' }] },
      { key: 'REQ0003', resources: [{ id: 'no-type' }] },
    ] }));
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.counts).toMatchObject({ imported: 0, failed: 3 });
    expect(await h.svc.failures('v1-import', run.id)).toEqual([
      { key: 'REQ0001', error: 'RESOURCE_TYPE_NOT_ALLOWED' },
      { key: 'REQ0002', error: 'NO_GROUP' },
      { key: 'REQ0003', error: 'INVALID_RESOURCE' },
    ]);
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('a dry run reads and maps but saves nothing', async () => {
    const h = await harness(keysOf(3));
    const run = await h.svc.wait((await h.svc.start({ ...START, dryRun: true })).id);
    expect(run).toMatchObject({ status: 'completed', dryRun: true, counts: { keys: 3, imported: 3, resources: 6 } });
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('stops at the limit', async () => {
    const h = await harness(keysOf(10));
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 4, limit: 6 })).id);
    expect(run).toMatchObject({ status: 'completed', cursor: 'REQ0006', counts: { keys: 6 } });
  });

  it('stops at the next page, and resume carries on with no request done twice', async () => {
    const h = await harness(keysOf(6));
    let runId = '';
    let stopAfterFirstPage = true;
    h.setMapper(({ keys }) => {
      if (stopAfterFirstPage) { stopAfterFirstPage = false; void h.svc.stop('v1-import', runId, ADMIN); }
      return { groups: keys.map((key) => ({ key, resources: [{ resourceType: 'Patient', id: `p-${key}` }] })) };
    });
    runId = (await h.svc.start({ ...START, pageSize: 2 })).id;
    const stopped = await h.svc.wait(runId);
    expect(stopped).toMatchObject({ status: 'stopped', cursor: 'REQ0002', counts: { keys: 2, imported: 2 } });

    const resumed = await h.svc.resume('v1-import', runId, ADMIN);
    expect(resumed.status).toBe('running');
    const done = await h.svc.wait(runId);
    expect(done).toMatchObject({ status: 'completed', cursor: 'REQ0006', counts: { keys: 6, imported: 6 } });
    const saved = h.persist.mock.calls.map((c) => (c[0] as Array<{ id: string }>)[0].id);
    expect(saved).toEqual(['p-REQ0001', 'p-REQ0002', 'p-REQ0003', 'p-REQ0004', 'p-REQ0005', 'p-REQ0006']);
    expect(h.audited.map((e) => e.action)).toEqual(['import.allow', 'import.start', 'import.stop', 'import.finish', 'import.resume', 'import.finish']);
  });

  it('fails the run, and keeps its place, when the source query fails', async () => {
    const h = await harness(keysOf(4));
    h.source.failWhen(/> 'REQ0002'/);
    const started = await h.svc.start({ ...START, pageSize: 2 });
    const failed = await h.svc.wait(started.id);
    expect(failed).toMatchObject({ status: 'failed', cursor: 'REQ0002', counts: { keys: 2 } });
    expect(failed.lastError).toContain('Invalid object name');
    h.source.failWhen(null);
    await h.svc.resume('v1-import', started.id, ADMIN);
    expect(await h.svc.wait(started.id)).toMatchObject({ status: 'completed', counts: { keys: 4, imported: 4 } });
  });

  // R45. A run with a cursor has read the source before. A resumed drive's reader has had no good
  // query yet, so only the flag the run passes makes it wait.
  it('a resumed run with a position waits on a source that is starting up; a new run fails at once', async () => {
    const startingUp = () => Object.assign(new Error("Login failed for user 'reader'."), { code: 'EREQUEST', number: 18456 });
    const h = await harness(keysOf(4));
    h.source.failWhen(/> 'REQ0002'/);
    const started = await h.svc.start({ ...START, pageSize: 2 });
    expect(await h.svc.wait(started.id)).toMatchObject({ status: 'failed', cursor: 'REQ0002' });
    h.source.failWhen(null);
    h.source.failNext(/> 'REQ0002'/, startingUp, 2);
    await h.svc.resume('v1-import', started.id, ADMIN);
    expect(await h.svc.wait(started.id)).toMatchObject({ status: 'completed', counts: { keys: 4, imported: 4 } });
    const waits = h.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting!.error);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((e) => e.startsWith('the source may still be starting up: '))).toBe(true);

    const fresh = await harness(keysOf(4));
    fresh.source.failNext(/> ''/, startingUp);
    const failed = await fresh.svc.wait((await fresh.svc.start({ ...START, pageSize: 2 })).id);
    expect(failed).toMatchObject({ status: 'failed', cursor: null });
    expect(failed.lastError).toContain('Login failed');
    expect(fresh.runSaves.some((r) => r.status === 'waiting')).toBe(false);
  });

  it('refuses a plugin template with a token in a comment, before running anything', async () => {
    const h = await harness(keysOf(2));
    h.setQueries({ keyQuery: { sql: 'DELETE FROM [dbo].[Requests] WHERE [RequestID] > {{after}} -- {{limit}}' }, detailQueries: [] });
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
    expect(run.lastError).toContain('import SQL has a token inside quotes, a comment or a quoted name: remove the quotes around {{limit}}');
    expect(h.source.statements).toEqual([]);
  });

  it('refuses SQL from the plugin that is not a SELECT, before running anything', async () => {
    const h = await harness(keysOf(2));
    h.setQueries({ keyQuery: { sql: 'DELETE TOP ({{limit}}) FROM [dbo].[Requests] WHERE [RequestID] > {{after}}' }, detailQueries: [] });
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
    expect(run.lastError).toContain('only SELECT/WITH queries are allowed');
    expect(h.source.statements).toEqual([]);
  });

  it('fails the run on a source key it cannot quote safely', async () => {
    const h = await harness(['REQ0001', 'REQé']);
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
    expect(run.lastError).toMatch(/source key/);
    expect(h.persist).not.toHaveBeenCalled();
  });

  it('allows one run at a time for a plugin and connector', async () => {
    const h = await harness(keysOf(2));
    let release: () => void = () => {};
    h.persist.mockImplementationOnce(() => new Promise((r) => { release = () => r([]); }));
    const first = await h.svc.start(START);
    await expect(h.svc.start(START)).rejects.toThrow(/already running/);
    await vi.waitFor(() => expect(h.persist).toHaveBeenCalled());
    release();
    await h.svc.wait(first.id);
    await expect(h.svc.start(START)).resolves.toMatchObject({ status: 'running' });
  });

  it('shows a run nobody is driving as interrupted, and lets it resume', async () => {
    const h = await harness(keysOf(4));
    const store = createPluginDataStore(internalDb);
    const stale = {
      id: 'dead', pluginId: 'v1-import', pluginVersion: '1.2.0', connectorId: 'c1', status: 'running', dryRun: false,
      options: { tz: '+02:00' }, pageSize: 2, limit: null, cursor: 'REQ0002',
      counts: { keys: 2, imported: 2, failed: 0, resources: 4 }, failuresStored: 0,
      startedAt: new Date(h.clock.now).toISOString(), updatedAt: new Date(h.clock.now).toISOString(),
      finishedAt: null, lastError: null, startedBy: 'admin',
    };
    await store.put('v1-import', '__import-runs', 'dead', stale);
    expect((await h.svc.get('v1-import', 'dead'))?.status).toBe('running');
    h.clock.now += 6 * 60_000;
    expect((await h.svc.get('v1-import', 'dead'))?.status).toBe('interrupted');
    await h.svc.resume('v1-import', 'dead', ADMIN);
    expect(await h.svc.wait('dead')).toMatchObject({ status: 'completed', cursor: 'REQ0004', counts: { keys: 4, imported: 4 } });
  });

  it('lists runs newest first', async () => {
    const h = await harness(keysOf(1));
    const a = await h.svc.wait((await h.svc.start(START)).id);
    h.clock.now += 60_000;
    const b = await h.svc.wait((await h.svc.start(START)).id);
    expect((await h.svc.list('v1-import')).map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe('import run: a source that goes away', () => {
  /** The key query of the second page, at a page size of 2. Detail queries have no `>`. */
  const SECOND_PAGE = /> 'REQ0002'/;
  const savedIds = (h: Harness) => h.persist.mock.calls.map((c) => (c[0] as Array<{ id: string }>)[0].id);

  it('a cut link in the middle of a run shows waiting, then the run completes with no resume', async () => {
    const h = await harness(keysOf(4));
    h.source.failNext(SECOND_PAGE, cutLink);
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 2 })).id);
    expect(run).toMatchObject({ status: 'completed', cursor: 'REQ0004', waiting: null, counts: { keys: 4, imported: 4, failed: 0 } });
    const waiting = h.runSaves.findIndex((r) => r.status === 'waiting');
    expect(waiting).toBeGreaterThan(-1);
    expect(h.runSaves[waiting].waiting).toEqual({
      since: new Date(h.clock.now).toISOString(), attempt: 1, error: expect.stringContaining('Connection lost'),
    });
    // The driver's text is cleaned before it is stored: the connector password never shows.
    expect(JSON.stringify(h.runSaves)).not.toContain('secret-pw');
    // When the source answers again the run is running, with no waiting state.
    expect(h.runSaves.slice(waiting + 1).some((r) => r.status === 'running' && r.waiting === null)).toBe(true);
    // One wait of 5 seconds, slept in slices.
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(5000);
    // No person pressed Resume, and no request was saved twice.
    expect(h.audited.map((e) => e.action)).toEqual(['import.allow', 'import.start', 'import.finish']);
    expect(savedIds(h)).toEqual(['p-REQ0001', 'p-REQ0002', 'p-REQ0003', 'p-REQ0004']);
  });

  it('a run that is waiting can be stopped', async () => {
    const h = await harness(keysOf(4));
    h.holdSleeps();
    h.source.failNext(SECOND_PAGE, cutLink);
    const started = await h.svc.start({ ...START, pageSize: 2 });
    await vi.waitFor(async () => expect((await h.svc.get('v1-import', started.id))?.status).toBe('waiting'));
    // A waiting run is active: a second run on the same connector is refused.
    await expect(h.svc.start(START)).rejects.toThrow(/already running/);
    expect((await h.svc.stop('v1-import', started.id, ADMIN)).status).toBe('stopping');
    h.releaseSleeps();
    const stopped = await h.svc.wait(started.id);
    expect(stopped).toMatchObject({ status: 'stopped', cursor: 'REQ0002', waiting: null, counts: { keys: 2 } });
    // The stop was felt in the wait: the second page was not read again.
    expect(h.source.statements.filter((s) => SECOND_PAGE.test(s))).toHaveLength(1);
    expect(h.audited.map((e) => e.action)).toContain('import.stop');
  });

  it('a missing table still ends the run as failed', async () => {
    const h = await harness(keysOf(4));
    h.source.failWhen(SECOND_PAGE);
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 2 })).id);
    expect(run).toMatchObject({ status: 'failed', cursor: 'REQ0002', waiting: null, counts: { keys: 2 } });
    expect(run.lastError).toContain('Invalid object name');
    // Retrying cannot fix it, so the run never waited.
    expect(h.runSaves.some((r) => r.status === 'waiting')).toBe(false);
    expect(h.sleeps).toEqual([]);
  });

  it('a key that cannot be read is recorded with SOURCE_TIMEOUT and the run goes on', async () => {
    const h = await harness(keysOf(4));
    // Every detail read that holds REQ0002 runs out of time. The source still answers SELECT 1.
    h.source.failNext(/IN \(.*'REQ0002'/, timedOut, 100);
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 4 })).id);
    expect(run).toMatchObject({ status: 'completed', cursor: 'REQ0004', counts: { keys: 4, imported: 3, failed: 1 } });
    expect(await h.svc.failures('v1-import', run.id)).toEqual([{ key: 'REQ0002', error: 'SOURCE_TIMEOUT' }]);
    expect(savedIds(h)).toEqual(['p-REQ0001', 'p-REQ0003', 'p-REQ0004']);
    // A slow key is not a lost link: the run never waited.
    expect(h.sleeps).toEqual([]);
  });

  it('keeps a halved page small, and doubles it again after 5 good pages', async () => {
    const h = await harness(keysOf(20));
    h.source.failNext(/IN \(.*'REQ0001'/, timedOut);
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 4 })).id);
    expect(run).toMatchObject({ status: 'completed', counts: { keys: 20, imported: 20, failed: 0 } });
    const tops = h.source.statements.flatMap((s) => { const m = /TOP \((\d+)\)/.exec(s); return m ? [Number(m[1])] : []; });
    // 4 timed out and was halved to 2. Five more good pages of 2, then 4 again.
    expect(tops).toEqual([4, 2, 2, 2, 2, 2, 2, 4, 4, 4]);
  });

  it('a waiting run writes its record at least every 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const h = await harness(keysOf(4));
      h.holdSleeps();
      h.source.failNext(SECOND_PAGE, cutLink);
      const started = await h.svc.start({ ...START, pageSize: 2 });
      await vi.waitFor(async () => expect((await h.svc.get('v1-import', started.id))?.status).toBe('waiting'));
      const before = h.runSaves.length;
      const last = h.runSaves[before - 1].updatedAt;
      h.clock.now += 30_000;
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(h.runSaves.length).toBe(before + 1));
      expect(h.runSaves[before]).toMatchObject({ status: 'waiting', updatedAt: new Date(h.clock.now).toISOString() });
      expect(Date.parse(h.runSaves[before].updatedAt) - Date.parse(last)).toBe(30_000);
      h.releaseSleeps();
      expect((await h.svc.wait(started.id)).status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a heartbeat in the middle of a page saves the run as it stood at the last page end, so a resume counts nothing twice', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const mapper = ({ keys }: { keys: string[] }) => ({
        groups: keys.map((key) => (key === 'REQ0005'
          ? { key, resources: [], error: 'NO_REQUEST_ROWS' }
          : { key, resources: [{ resourceType: 'Patient', id: `p-${key}` }] })),
      });
      // The run the crashed one must end up equal to: the same keys, read with no interruption.
      const whole = await harness(keysOf(8));
      whole.setMapper(mapper);
      const clean = await whole.svc.wait((await whole.svc.start({ ...START, pageSize: 4 })).id);
      const cleanFailures = await whole.svc.failures('v1-import', clean.id);
      expect(clean.counts).toEqual({ keys: 8, imported: 7, failed: 1, resources: 7 });

      // First process: the second page records the failure for REQ0005, then hangs saving REQ0007.
      const first = await harness(keysOf(8));
      first.setMapper(mapper);
      first.persist.mockImplementation(async (resources: Array<{ id: string }>) => {
        if (resources[0].id === 'p-REQ0007') await new Promise(() => {});
        return [];
      });
      const started = await first.svc.start({ ...START, pageSize: 4 });
      await vi.waitFor(() => expect(first.persist.mock.calls.some((c) => (c[0] as Array<{ id: string }>)[0].id === 'p-REQ0007')).toBe(true));
      const before = first.runSaves.length;
      first.clock.now += 30_000;
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(first.runSaves.length).toBe(before + 1));
      // The beat has a fresh updatedAt, and the counts, failures and cursor of the first page end.
      expect(first.runSaves[before]).toMatchObject({
        status: 'running', cursor: 'REQ0004', failuresStored: 0,
        counts: { keys: 4, imported: 4, failed: 0, resources: 4 },
        updatedAt: new Date(first.clock.now).toISOString(),
      });

      // The first process dies there. A second one finds the run with no driver and resumes it.
      const second = await harness(keysOf(8));
      second.setMapper(mapper);
      second.clock.now = first.clock.now + STALE_MS + 1;
      expect((await second.svc.get('v1-import', started.id))?.status).toBe('interrupted');
      await second.svc.resume('v1-import', started.id, ADMIN);
      const resumed = await second.svc.wait(started.id);
      expect(resumed).toMatchObject({ status: 'completed', cursor: 'REQ0008', counts: clean.counts, failuresStored: clean.failuresStored });
      expect(await second.svc.failures('v1-import', started.id)).toEqual(cleanFailures);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a link cut on a detail query in the middle of a page reads the whole page again, once', async () => {
    const h = await harness(keysOf(4));
    // The results query of the second page: the key query and the requests query have answered.
    h.source.failNext(/LabResults.*'REQ0003'/, cutLink);
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 2 })).id);
    expect(run).toMatchObject({ status: 'completed', cursor: 'REQ0004', counts: { keys: 4, imported: 4, failed: 0 } });
    expect(savedIds(h)).toEqual(['p-REQ0001', 'p-REQ0002', 'p-REQ0003', 'p-REQ0004']);
    expect(h.mapInputs.map((m) => m.keys)).toEqual([['REQ0001', 'REQ0002'], ['REQ0003', 'REQ0004']]);
    // The cut connection was closed, and so was the one that replaced it. The SELECT 1 probe that
    // follows a loss (R40) opens and closes a third.
    expect(h.source.closed()).toBe(3);
  });

  it('records where the run was started', async () => {
    const h = await harness(keysOf(1), { origin: 'server' });
    const started = await h.svc.start(START);
    expect(started.origin).toBe('server');
    expect((await h.svc.wait(started.id)).origin).toBe('server');
    expect(h.runSaves.map((r) => r.origin)).toEqual(h.runSaves.map(() => 'server'));
  });

  it('records cli when no origin is given, and reads a run from before this change as cli and not waiting', async () => {
    const h = await harness(keysOf(1));
    expect((await h.svc.wait((await h.svc.start(START)).id)).origin).toBe('cli');
    const old = {
      id: 'old', pluginId: 'v1-import', pluginVersion: '1.2.0', connectorId: 'c1', status: 'stopped', dryRun: false,
      options: {}, pageSize: 2, limit: null, cursor: null, counts: { keys: 0, imported: 0, failed: 0, resources: 0 },
      failuresStored: 0, startedAt: new Date(h.clock.now).toISOString(), updatedAt: new Date(h.clock.now).toISOString(),
      finishedAt: null, lastError: null, startedBy: 'admin',
    };
    await createPluginDataStore(internalDb).put('v1-import', '__import-runs', 'old', old);
    expect(await h.svc.get('v1-import', 'old')).toMatchObject({ origin: 'cli', waiting: null });
  });

  it('reads a waiting run nobody is driving as interrupted after 2 minutes with no write', async () => {
    expect(STALE_MS).toBe(2 * 60_000);
    const h = await harness(keysOf(1));
    const at = new Date(h.clock.now).toISOString();
    await createPluginDataStore(internalDb).put('v1-import', '__import-runs', 'gone', {
      id: 'gone', pluginId: 'v1-import', pluginVersion: '1.2.0', connectorId: 'c1', status: 'waiting', dryRun: false,
      options: {}, pageSize: 2, limit: null, cursor: null, counts: { keys: 0, imported: 0, failed: 0, resources: 0 },
      failuresStored: 0, startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: 'admin',
      waiting: { since: at, attempt: 3, error: 'Connection lost' }, origin: 'cli',
    });
    h.clock.now += STALE_MS;
    expect((await h.svc.get('v1-import', 'gone'))?.status).toBe('waiting');
    h.clock.now += 1;
    expect((await h.svc.get('v1-import', 'gone'))?.status).toBe('interrupted');
  });
});

describe('import run: who may read what', () => {
  it('refuses a connector the admin has not allowed for this plugin', async () => {
    const h = await harness(keysOf(1));
    await h.svc.revoke('v1-import', 'c1', ADMIN);
    await expect(h.svc.start(START)).rejects.toThrow(/not allowed/);
    await expect(h.svc.checks(START)).rejects.toThrow(/not allowed/);
    expect(await h.svc.allowed('v1-import')).toEqual([]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('refuses a plugin without the host:import capability, including a legacy row with no grant', async () => {
    const h = await harness(keysOf(1));
    h.setManifest(manifest({ capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] }));
    await expect(h.svc.start(START)).rejects.toThrow(/host:import/);
    const legacy = manifest() as Record<string, unknown>;
    delete legacy.capabilities;
    h.setManifest(legacy);
    await expect(h.svc.start(START)).rejects.toThrow(/host:import/);
  });

  it('refuses a plugin that declares no import source', async () => {
    const h = await harness(keysOf(1));
    h.setManifest(manifest({ importSource: undefined }));
    await expect(h.svc.start(START)).rejects.toThrow(/cannot import/);
  });

  it('refuses a missing, disabled or wrong-type connector', async () => {
    const h = await harness(keysOf(1));
    // Allowing a connector the plugin cannot read is refused up front, not at the first run.
    await expect(h.svc.allow('v1-import', 'pg', ADMIN)).rejects.toThrow(/microsoft-sql/);
    expect(await h.svc.allowed('v1-import')).not.toContain('pg');
    await h.svc.allow('v1-import', 'off', ADMIN);
    await expect(h.svc.start({ ...START, connectorId: 'pg' })).rejects.toThrow(/microsoft-sql/);
    await expect(h.svc.start({ ...START, connectorId: 'off' })).rejects.toThrow(/not found or disabled/);
    await expect(h.svc.allow('v1-import', 'nope', ADMIN)).rejects.toThrow(/not found/);
  });

  it('refuses bad run settings', async () => {
    const h = await harness(keysOf(1));
    await expect(h.svc.start({ ...START, pageSize: 5000 })).rejects.toThrow(/page size/);
    await expect(h.svc.start({ ...START, limit: 0 })).rejects.toThrow(/limit/);
    await expect(h.svc.start({ ...START, options: { tz: 'x'.repeat(600) } })).rejects.toThrow(/option/);
  });

  it('runs the plugin checks, one value each, and refuses a check that is not a SELECT', async () => {
    const h = await harness(keysOf(7));
    expect(await h.svc.checks(START)).toEqual([{ id: 'requests', value: 7 }, { id: 'bad', value: null, error: 'NOT_A_SELECT' }]);
    expect(h.source.statements).toEqual(['SELECT COUNT(*) AS n FROM [dbo].[Requests]']);
    expect(h.source.closed()).toBe(1);
  });

  it('only resumes a run that has stopped', async () => {
    const h = await harness(keysOf(1));
    const run = await h.svc.wait((await h.svc.start(START)).id);
    await expect(h.svc.resume('v1-import', run.id, ADMIN)).rejects.toThrow(/completed/);
    await expect(h.svc.resume('v1-import', 'missing', ADMIN)).rejects.toThrow(/not found/);
    await expect(h.svc.stop('v1-import', run.id, ADMIN)).rejects.toThrow(/not running/);
  });

  it('lists the installed plugins that can import, and from which connector types', async () => {
    const h = await harness(keysOf(1));
    expect(await h.svc.importers()).toEqual([{ id: 'v1-import', version: '1.2.0', connectorTypes: ['microsoft-sql'] }]);
    // A plugin without the capability, or with no import source, is not an importer.
    h.setManifest(manifest({ capabilities: [] }));
    expect(await h.svc.importers()).toEqual([]);
    h.setManifest(manifest({ importSource: undefined }));
    expect(await h.svc.importers()).toEqual([]);
  });

  describe('a plugin that can be copied from but cannot import', () => {
    const copyOnly = () => manifest({ importSource: { connectorTypes: ['microsoft-sql'], entrypoints: { copy: 'import_copy' } } });
    const REFUSAL = /plugin v1-import can be copied from but cannot import/;

    it('can be allowed a connector, and is listed as a reader but not as an importer', async () => {
      const h = await harness(keysOf(1));
      h.setManifest(copyOnly());
      await h.svc.revoke('v1-import', 'c1', ADMIN);
      await h.svc.allow('v1-import', 'c1', ADMIN);
      expect(await h.svc.allowed('v1-import')).toEqual(['c1']);
      expect(await h.svc.readers()).toEqual([{ id: 'v1-import', version: '1.2.0', connectorTypes: ['microsoft-sql'] }]);
      expect(await h.svc.importers()).toEqual([]);
      // A wrong-type connector is still refused for a reader.
      await expect(h.svc.allow('v1-import', 'pg', ADMIN)).rejects.toThrow(/microsoft-sql/);
    });

    it('refuses start and checks, and calls no entrypoint', async () => {
      const h = await harness(keysOf(1));
      h.setManifest(copyOnly());
      await expect(h.svc.start(START)).rejects.toThrow(REFUSAL);
      await expect(h.svc.checks(START)).rejects.toThrow(REFUSAL);
      expect(await h.svc.list('v1-import')).toEqual([]);
      expect(h.invoke).not.toHaveBeenCalled();
    });

    it('refuses to resume a run, and a run being driven ends failed with the same message', async () => {
      const h = await harness(keysOf(3));
      const stopped = await h.svc.start({ ...START, pageSize: 1 });
      await h.svc.stop('v1-import', stopped.id, ADMIN);
      expect((await h.svc.wait(stopped.id)).status).toBe('stopped');
      h.setManifest(copyOnly());
      await expect(h.svc.resume('v1-import', stopped.id, ADMIN)).rejects.toThrow(REFUSAL);

      h.setManifest(manifest());
      const driven = await h.svc.start(START);
      // The drive starts on the next turn, so it reads the copy-only manifest.
      h.setManifest(copyOnly());
      const done = await h.svc.wait(driven.id);
      expect(done.status).toBe('failed');
      expect(done.lastError).toMatch(REFUSAL);
    });

    it('lists a one-pass importer as a reader, but not a plugin with no import source or a copy-only plugin without host:import', async () => {
      const h = await harness(keysOf(1));
      expect(await h.svc.readers()).toEqual([{ id: 'v1-import', version: '1.2.0', connectorTypes: ['microsoft-sql'] }]);
      h.setManifest(manifest({ importSource: undefined }));
      expect(await h.svc.readers()).toEqual([]);
      h.setManifest({ ...copyOnly(), capabilities: [] });
      expect(await h.svc.readers()).toEqual([]);
    });
  });

  // The operator's rule: a plugin may not write records unless the audit log shows it.
  describe('audit is required before anything is written', () => {
    it('refuses to start when the start cannot be audited, and saves nothing', async () => {
      const h = await harness(keysOf(3));
      h.failAuditOn('import.start');
      await expect(h.svc.start({ pluginId: 'v1-import', connectorId: 'c1', options: {}, actor: ADMIN }))
        .rejects.toThrow(/audit log could not be written/);
      expect(await h.svc.list('v1-import')).toEqual([]);
      expect(h.persist).not.toHaveBeenCalled();
      // The driver's own error text is not passed on.
      await expect(h.svc.start({ pluginId: 'v1-import', connectorId: 'c1', options: {}, actor: ADMIN })).rejects.not.toThrow(/audit store down/);
    });

    it('refuses to resume when the resume cannot be audited, and leaves the run as it was', async () => {
      const h = await harness(keysOf(4));
      const run = await h.svc.start({ pluginId: 'v1-import', connectorId: 'c1', options: {}, pageSize: 2, limit: 2, actor: ADMIN });
      await h.svc.wait(run.id);
      // A limit-reached run is complete; make a resumable one by stopping a fresh run at once.
      const second = await h.svc.start({ pluginId: 'v1-import', connectorId: 'c1', options: {}, pageSize: 1, actor: ADMIN });
      await h.svc.stop('v1-import', second.id, ADMIN);
      const stopped = await h.svc.wait(second.id);
      expect(stopped.status).toBe('stopped');
      const savedBefore = h.persist.mock.calls.length;
      h.failAuditOn('import.resume');
      await expect(h.svc.resume('v1-import', second.id, ADMIN)).rejects.toThrow(/audit log could not be written/);
      expect((await h.svc.get('v1-import', second.id))?.status).toBe('stopped');
      expect(h.persist.mock.calls.length).toBe(savedBefore);
    });

    it('refuses to allow a connector when that cannot be audited', async () => {
      const h = await harness(keysOf(1));
      await h.svc.revoke('v1-import', 'c1', ADMIN);
      h.failAuditOn('import.allow');
      await expect(h.svc.allow('v1-import', 'c1', ADMIN)).rejects.toThrow(/audit log could not be written/);
      expect(await h.svc.allowed('v1-import')).toEqual([]);
    });

    it('still finishes a run whose finish cannot be audited: the records are already saved', async () => {
      const h = await harness(keysOf(2));
      h.failAuditOn('import.finish');
      const run = await h.svc.start({ pluginId: 'v1-import', connectorId: 'c1', options: {}, actor: ADMIN });
      const done = await h.svc.wait(run.id);
      expect(done).toMatchObject({ status: 'completed', counts: { imported: 2 } });
    });
  });
});

// Layer: the same as above. A "restart" here is a second service over the same pg-mem database,
// with the first one's drive left hanging, as a killed process leaves its last save. Not covered:
// a real process kill, real Postgres, the server's own start (import-driver.test.ts has the wiring).
describe('import run: adopt', () => {
  const SYSTEM: ImportActor = { type: 'system', id: null, name: 'system' };
  const ADOPT_FAILED = 'an import whose server stopped could not be resumed; it is tried again every 5 seconds';

  /** A run record as a server left it, written straight to the store. */
  async function storeRun(h: Harness, over: Record<string, unknown>): Promise<void> {
    const at = new Date(h.clock.now).toISOString();
    const run: Record<string, unknown> = {
      id: 'dead', pluginId: 'v1-import', pluginVersion: '1.2.0', connectorId: 'c1', status: 'running', dryRun: false,
      options: { tz: '+02:00' }, pageSize: 2, limit: null, cursor: 'REQ0002',
      counts: { keys: 2, imported: 2, failed: 0, resources: 4 }, failuresStored: 0,
      startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: 'admin', waiting: null, origin: 'server',
      ...over,
    };
    for (const k of Object.keys(run)) if (run[k] === undefined) delete run[k];
    await createPluginDataStore(internalDb).put('v1-import', '__import-runs', run.id as string, run);
  }
  const rawRun = async (id: string) => (await createPluginDataStore(internalDb).get('v1-import', '__import-runs', id)) as ImportRun;

  it('adopt resumes a server run that has been silent for 2 minutes', async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, { status: 'waiting', waiting: { since: new Date(h.clock.now).toISOString(), attempt: 2, error: 'Connection lost' } });
    // Exactly 2 minutes is not yet silent.
    h.clock.now += STALE_MS;
    expect(await h.svc.adopt()).toEqual([]);
    h.clock.now += 1;
    const adopted = await h.svc.adopt();
    expect(adopted.map((r) => [r.id, r.status, r.origin])).toEqual([['dead', 'running', 'server']]);
    expect(await h.svc.wait('dead')).toMatchObject({ status: 'completed', cursor: 'REQ0004', counts: { keys: 4, imported: 4 } });
    // Nothing before the saved position is read or saved again.
    expect(h.mapInputs.map((m) => m.keys)).toEqual([['REQ0003', 'REQ0004']]);
  });

  it('adopt leaves a run that a CLI process started', async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, { origin: 'cli' });
    h.clock.now += 10 * 60_000;
    expect(await h.svc.adopt()).toEqual([]);
    expect(await rawRun('dead')).toMatchObject({ status: 'running', origin: 'cli', cursor: 'REQ0002' });
    expect(h.mapInputs).toEqual([]);
    expect(h.audited.filter((e) => e.action !== 'import.allow')).toEqual([]);
  });

  it('adopt leaves a run recorded before origin existed, which reads as cli', async () => {
    // An upgrade must not restart old imports that nobody resumed.
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, { origin: undefined, waiting: undefined });
    h.clock.now += 10 * 60_000;
    expect(await h.svc.adopt()).toEqual([]);
    const stored = await rawRun('dead');
    expect(stored.status).toBe('running');
    expect('origin' in stored).toBe(false);
    expect((await h.svc.get('v1-import', 'dead'))?.status).toBe('interrupted');
    expect(h.mapInputs).toEqual([]);
  });

  it('adopt does nothing in a CLI process, even for a server run with no driver', async () => {
    const h = await harness(keysOf(4));
    await storeRun(h, {});
    h.clock.now += 10 * 60_000;
    expect(await h.svc.adopt()).toEqual([]);
    expect(await rawRun('dead')).toMatchObject({ status: 'running', origin: 'server' });
    expect(h.mapInputs).toEqual([]);
  });

  it('adopt leaves a run that wrote 1 minute ago', async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, {});
    h.clock.now += 60_000;
    expect(await h.svc.adopt()).toEqual([]);
    expect(await rawRun('dead')).toMatchObject({ status: 'running', updatedAt: new Date(h.clock.now - 60_000).toISOString() });
    expect(h.mapInputs).toEqual([]);
  });

  it('adopt leaves a stopped, failed or completed run', async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, { id: 'a', status: 'stopped' });
    await storeRun(h, { id: 'b', status: 'failed' });
    await storeRun(h, { id: 'c', status: 'completed' });
    h.clock.now += 10 * 60_000;
    expect(await h.svc.adopt()).toEqual([]);
    expect(h.mapInputs).toEqual([]);
  });

  it('adopt leaves a run this process is driving, however long since its last write', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const h = await harness(keysOf(4), { origin: 'server' });
      h.persist.mockImplementation(async () => { await new Promise(() => {}); });
      const started = await h.svc.start(START);
      await vi.waitFor(() => expect(h.persist).toHaveBeenCalled());
      h.clock.now += 10 * 60_000;
      expect(await h.svc.adopt()).toEqual([]);
      expect(h.audited.filter((e) => e.action === 'import.resume')).toEqual([]);
      expect((await h.svc.get('v1-import', started.id))?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  it('adopt finishes the stop of a server run that was stopping when its server died', async () => {
    // The person asked it to stop. A restart must not set it running again.
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, { status: 'stopping' });
    h.clock.now += STALE_MS + 1;
    const adopted = await h.svc.adopt();
    expect(adopted.map((r) => [r.id, r.status])).toEqual([['dead', 'stopped']]);
    expect(await rawRun('dead')).toMatchObject({
      status: 'stopped', cursor: 'REQ0002', counts: { keys: 2, imported: 2 }, finishedAt: new Date(h.clock.now).toISOString(),
    });
    expect(h.mapInputs).toEqual([]);
    expect(h.persist).not.toHaveBeenCalled();
    const events = h.audited.filter((e) => e.action !== 'import.allow');
    expect(events).toEqual([{
      action: 'import.finish', pluginId: 'v1-import', connectorId: 'c1', runId: 'dead', actor: SYSTEM,
      metadata: { status: 'stopped', dryRun: false, keys: 2, imported: 2, failed: 0, resources: 4 },
    }]);
    // A second turn finds nothing more to do.
    h.clock.now += STALE_MS + 1;
    expect(await h.svc.adopt()).toEqual([]);
  });

  it('a run adopted after a restart finishes from its saved position, audited as system', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      // The server process: the first page of 4 is saved, then it is killed while saving REQ0007.
      const first = await harness(keysOf(8), { origin: 'server' });
      first.persist.mockImplementation(async (resources: Array<{ id: string }>) => {
        if (resources[0].id === 'p-REQ0007') await new Promise(() => {});
        return [];
      });
      const started = await first.svc.start({ ...START, pageSize: 4 });
      await vi.waitFor(() => expect(first.persist.mock.calls.some((c) => (c[0] as Array<{ id: string }>)[0].id === 'p-REQ0007')).toBe(true));
      expect(await rawRun(started.id)).toMatchObject({ status: 'running', cursor: 'REQ0004', origin: 'server' });

      // The server starts again 2 minutes later. A CLI process at the same moment does not adopt.
      const cli = await harness(keysOf(8));
      cli.clock.now = first.clock.now + STALE_MS + 1;
      expect(await cli.svc.adopt()).toEqual([]);
      expect(cli.mapInputs).toEqual([]);

      const second = await harness(keysOf(8), { origin: 'server' });
      second.clock.now = first.clock.now + STALE_MS + 1;
      expect((await second.svc.adopt()).map((r) => r.id)).toEqual([started.id]);
      const done = await second.svc.wait(started.id);
      expect(done).toMatchObject({
        status: 'completed', cursor: 'REQ0008', origin: 'server', counts: { keys: 8, imported: 8, failed: 0, resources: 16 },
      });
      // The second page is read again in full, and the first is not read again.
      expect(second.mapInputs.map((m) => m.keys)).toEqual([['REQ0005', 'REQ0006', 'REQ0007', 'REQ0008']]);
      expect(second.persist.mock.calls.map((c) => (c[0] as Array<{ id: string }>)[0].id)).toEqual(['p-REQ0005', 'p-REQ0006', 'p-REQ0007', 'p-REQ0008']);
      const events = second.audited.filter((e) => e.action !== 'import.allow');
      expect(events.map((e) => [e.action, e.actor])).toEqual([['import.resume', SYSTEM], ['import.finish', SYSTEM]]);
      // R43. The system's resume row holds no cursor: a cursor is a source key, and no person asked.
      expect(events[0]).not.toHaveProperty('metadata');
      expect(JSON.stringify(second.audited)).not.toContain('REQ0004');
    } finally {
      vi.useRealTimers();
    }
  });

  it("a person's resume still records the cursor in its audit row", async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, { status: 'stopped' });
    await h.svc.resume('v1-import', 'dead', ADMIN);
    await h.svc.wait('dead');
    const row = h.audited.find((e) => e.action === 'import.resume');
    expect(row).toMatchObject({ actor: ADMIN, metadata: { cursor: 'REQ0002' } });
  });

  it('a crash in the middle of a page, then a redo that fails fewer keys, lists no stale failure', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      // The first server fails REQ0005 and REQ0006 on the second page, then dies while saving REQ0007.
      const first = await harness(keysOf(8), { origin: 'server' });
      first.setMapper(({ keys }) => ({
        groups: keys.map((key) => (key === 'REQ0005' || key === 'REQ0006'
          ? { key, resources: [], error: 'NO_REQUEST_ROWS' }
          : { key, resources: [{ resourceType: 'Patient', id: `p-${key}` }] })),
      }));
      first.persist.mockImplementation(async (resources: Array<{ id: string }>) => {
        if (resources[0].id === 'p-REQ0007') await new Promise(() => {});
        return [];
      });
      const started = await first.svc.start({ ...START, pageSize: 4 });
      await vi.waitFor(() => expect(first.persist.mock.calls.some((c) => (c[0] as Array<{ id: string }>)[0].id === 'p-REQ0007')).toBe(true));
      expect(await rawRun(started.id)).toMatchObject({ cursor: 'REQ0004', failuresStored: 0 });

      // The redo fails REQ0005 only. REQ0006's entry from the dead page must not be listed.
      const second = await harness(keysOf(8), { origin: 'server' });
      second.setMapper(({ keys }) => ({
        groups: keys.map((key) => (key === 'REQ0005'
          ? { key, resources: [], error: 'NO_REQUEST_ROWS' }
          : { key, resources: [{ resourceType: 'Patient', id: `p-${key}` }] })),
      }));
      second.clock.now = first.clock.now + STALE_MS + 1;
      await second.svc.adopt();
      expect(await second.svc.wait(started.id)).toMatchObject({ status: 'completed', failuresStored: 1, counts: { failed: 1 } });
      expect(await second.svc.failures('v1-import', started.id)).toEqual([{ key: 'REQ0005', error: 'NO_REQUEST_ROWS' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a person's resume and adopt on the same run in one process start one drive", async () => {
    const h = await harness(keysOf(2), { origin: 'server' });
    await storeRun(h, { cursor: null, counts: { keys: 0, imported: 0, failed: 0, resources: 0 } });
    h.clock.now += STALE_MS + 1;
    await Promise.all([h.svc.resume('v1-import', 'dead', ADMIN), h.svc.adopt()]);
    expect(await h.svc.wait('dead')).toMatchObject({ status: 'completed', counts: { keys: 2, imported: 2 } });
    // One drive reads the page once and saves each request once.
    expect(h.mapInputs.map((m) => m.keys)).toEqual([['REQ0001', 'REQ0002']]);
    expect(h.persist).toHaveBeenCalledTimes(2);
  });

  it('adopt logs one line when it cannot resume a run, with the run id and no error text', async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, {});
    h.clock.now += STALE_MS + 1;
    h.failAuditOn('import.resume');
    expect(await h.svc.adopt()).toEqual([]);
    expect(h.warnings).toEqual([{ fields: { runId: 'dead' }, msg: ADOPT_FAILED }]);
    // The next turns try again, and say nothing more about the same run.
    expect(await h.svc.adopt()).toEqual([]);
    expect(h.warnings).toHaveLength(1);
    expect(JSON.stringify(h.warnings)).not.toContain('audit');
    h.failAuditOn(null);
    expect((await h.svc.adopt()).map((r) => r.id)).toEqual(['dead']);
    expect(await h.svc.wait('dead')).toMatchObject({ status: 'completed' });
  });

  it('adopt resumes nothing once its signal is aborted', async () => {
    const h = await harness(keysOf(4), { origin: 'server' });
    await storeRun(h, {});
    h.clock.now += STALE_MS + 1;
    const stop = new AbortController();
    stop.abort();
    expect(await h.svc.adopt({ signal: stop.signal })).toEqual([]);
    expect(await rawRun('dead')).toMatchObject({ status: 'running' });
    expect(h.audited.filter((e) => e.action !== 'import.allow')).toEqual([]);
    expect(h.warnings).toEqual([]);
  });
});

// Layer: the same as above, with the plugin's code loader made to throw as the S3 client does when
// blob storage is not up yet. Not covered: a real blob store, a real restart order of services.
describe('import run: the plugin code cannot be loaded yet', () => {
  const NOT_LOADED = "the plugin's code could not be loaded yet";

  it('waits for the plugin code, then completes with no person', async () => {
    const h = await harness(keysOf(4));
    h.failSinkLoads(2);
    const run = await h.svc.wait((await h.svc.start({ ...START, pageSize: 2 })).id);
    expect(run).toMatchObject({ status: 'completed', lastError: null, waiting: null, counts: { keys: 4, imported: 4 } });
    const at = new Date(h.clock.now).toISOString();
    expect(h.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting)).toEqual([
      { since: at, attempt: 1, error: NOT_LOADED },
      { since: at, attempt: 2, error: NOT_LOADED },
    ]);
    // 5 seconds, then 10, in slices of a second.
    expect(h.sleeps).toEqual([...Array(5).fill(1000), ...Array(10).fill(1000)]);
    expect(JSON.stringify(h.runSaves)).not.toMatch(/secret-pw|ECONNREFUSED|10\.0\.0\.9/);
  });

  it('a stop is felt while it waits for the plugin code', async () => {
    const h = await harness(keysOf(4));
    h.holdSleeps();
    h.failSinkLoads(1_000_000);
    const started = await h.svc.start(START);
    await vi.waitFor(async () => expect((await h.svc.get('v1-import', started.id))?.status).toBe('waiting'));
    expect((await h.svc.stop('v1-import', started.id, ADMIN)).status).toBe('stopping');
    h.releaseSleeps();
    expect(await h.svc.wait(started.id)).toMatchObject({ status: 'stopped', waiting: null, lastError: null });
    expect(h.sleeps.every((ms) => ms <= 1000)).toBe(true);
    // The plugin was never asked for its queries: its code never loaded.
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('the heartbeat keeps running while it waits for the plugin code', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const h = await harness(keysOf(4));
      h.holdSleeps();
      h.failSinkLoads(1);
      const started = await h.svc.start(START);
      await vi.waitFor(async () => expect((await h.svc.get('v1-import', started.id))?.status).toBe('waiting'));
      const before = h.runSaves.length;
      h.clock.now += 30_000;
      vi.advanceTimersByTime(30_000);
      await vi.waitFor(() => expect(h.runSaves.length).toBe(before + 1));
      expect(h.runSaves[before]).toMatchObject({
        status: 'waiting', waiting: { attempt: 1, error: NOT_LOADED }, updatedAt: new Date(h.clock.now).toISOString(),
      });
      h.releaseSleeps();
      expect((await h.svc.wait(started.id)).status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a storage error wrapped in a cause waits too', async () => {
    const h = await harness(keysOf(2));
    h.failSinkLoads(1, () => new Error('GetObject failed', { cause: Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }) }));
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run).toMatchObject({ status: 'completed', lastError: null });
    expect(h.runSaves.filter((r) => r.status === 'waiting').map((r) => r.waiting?.error)).toEqual([NOT_LOADED]);
  });

  it('a hash mismatch on the plugin code fails the import at once, and shows why', async () => {
    // A tamper signal a person must see. It never reads as "not loaded yet".
    const h = await harness(keysOf(2));
    h.failSinkLoads(1_000_000, hashMismatch);
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
    expect(run.lastError).toBe('plugin v1-import@1.2.0 sha256 mismatch (expected aa11, got bb22)');
    expect(h.sleeps).toEqual([]);
    expect(h.runSaves.some((r) => r.status === 'waiting')).toBe(false);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('a missing code file fails the import at once', async () => {
    const h = await harness(keysOf(2));
    h.failSinkLoads(1_000_000, missingFile);
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
    expect(run.lastError).toContain('ENOENT: no such file or directory');
    expect(h.sleeps).toEqual([]);
    expect(h.runSaves.some((r) => r.status === 'waiting')).toBe(false);
  });

  it('a plugin with no invokable code still ends the import as failed, with no wait', async () => {
    const h = await harness(keysOf(4));
    h.setNoSink(true);
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
    expect(run.lastError).toContain('exposes no invokable wasm');
    expect(h.sleeps).toEqual([]);
    expect(h.runSaves.some((r) => r.status === 'waiting')).toBe(false);
  });
});
