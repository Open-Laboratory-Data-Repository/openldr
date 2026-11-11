import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginDataStore } from '@openldr/db';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import { createImportService, type ImportActor, type ImportAuditEvent, type ImportService } from './import-run';

const ADMIN: ImportActor = { type: 'user', id: 'u-admin', name: 'admin' };

// Layer under test: the import service over the real plugin_data store on pg-mem. The plugin
// (wasm), the source database and CE's save function are fakes. Not covered here: real SQL
// Server, real wasm, real Postgres.

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

/** A fake v1 database: answers the filled-in key and detail statements from a list of keys. */
function fakeSource(keys: string[]) {
  const sorted = [...keys].sort();
  const statements: string[] = [];
  let closed = 0;
  let failOn: RegExp | null = null;
  const db = {
    async query(sql: string) {
      statements.push(sql);
      if (failOn?.test(sql)) throw new Error("Invalid object name 'dbo.Requests'.");
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
  return { db, statements, closed: () => closed, failWhen: (re: RegExp | null) => { failOn = re; } };
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
}

let internalDb: Awaited<ReturnType<typeof makeMigratedDb>>;

async function harness(keys: string[]): Promise<Harness> {
  const source = fakeSource(keys);
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
  const svc = createImportService({
    plugins: {
      list: async () => [{ id: 'v1-import', version: '1.2.0', enabled: true, manifest: currentManifest as Record<string, unknown> }],
      loadSink: async () => ({ invoke }),
    },
    connectors: {
      get: async (id) => (id === 'c1' ? { type: 'microsoft-sql', enabled: true } : id === 'pg' ? { type: 'postgres', enabled: true } : id === 'off' ? { type: 'microsoft-sql', enabled: false } : null),
      getDecryptedConfig: async () => ({ host: 'v1', password: 'secret-pw' }),
    },
    secretsKey: 'k',
    pluginData: createPluginDataStore(internalDb),
    persist,
    audit: async (e) => { if (e.action === auditFails) throw new Error('audit store down'); audited.push(e); },
    createDb: () => source.db,
    now: () => new Date(clock.now),
  });
  await svc.allow('v1-import', 'c1', ADMIN);
  return {
    svc, source, persist, invoke, audited, mapInputs, clock,
    failAuditOn: (action) => { auditFails = action; },
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

  it('refuses SQL from the plugin that is not a SELECT, before running anything', async () => {
    const h = await harness(keysOf(2));
    h.setQueries({ keyQuery: { sql: 'DELETE FROM [dbo].[Requests] WHERE [RequestID] > {{after}} -- {{limit}}' }, detailQueries: [] });
    const run = await h.svc.wait((await h.svc.start(START)).id);
    expect(run.status).toBe('failed');
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

