import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { makeRedactor, redact } from '@openldr/core';
import { validateSelectSql } from '@openldr/dashboards';
import type { PluginDataStore, Provenance } from '@openldr/db';
import { allowedResourceTypes, importSourceSchema, readGrant, type Capability, type ImportSource } from '@openldr/marketplace';
import { createConnectorDb, type ConnectorDb } from './connector-db';
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN, assertSafeKey, fillDetailQuery, fillKeyQuery, toPluginRow } from './import-sql';

// Runs an import for a plugin that declares `payload.importSource` (see the marketplace manifest).
//
// The plugin's signed wasm knows the source system: it supplies the SELECT statements and maps
// source rows to FHIR resources. This service knows how to run an import: it pages through a host
// database connector by keyset, hands each page's rows to the plugin, saves what comes back
// through CE's normal save path, and keeps the progress so a run can stop and resume.
//
// Trust rules, all enforced here so the broker, the CLI and any later caller get them alike:
//  - the plugin must hold the host:import capability (a legacy row with no grant does not);
//  - an admin must have allowed this plugin to read this connector (`allow`);
//  - every statement is checked to be a single SELECT before it runs;
//  - the plugin may only save the resource types its emit-fhir capability lists;
//  - a per-request failure is stored as a short code, never as text from the plugin or the
//    validator, because that text can quote patient data.

/** plugin_data collections owned by the host. The broker refuses plugin storage ops on any
 *  collection starting with `__`, so a plugin page cannot forge a run or an allow entry. */
export const HOST_COLLECTION_PREFIX = '__';
const RUNS = '__import-runs';
const FAILURES = '__import-failures';
const ALLOWED = '__import-allowed';

const DEFAULT_PAGE_SIZE = 500;
const MAX_STORED_FAILURES = 1000;
/** A run that has not written progress for this long, and that this process is not driving, is
 *  shown as interrupted and may be resumed. One page is a few 30-second calls at worst. */
const STALE_MS = 5 * 60_000;

export type ImportStatus = 'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'interrupted';

export interface ImportRun {
  id: string;
  pluginId: string;
  pluginVersion: string;
  connectorId: string;
  status: ImportStatus;
  dryRun: boolean;
  options: Record<string, string>;
  pageSize: number;
  limit: number | null;
  /** The last source key done. The next page starts after it. */
  cursor: string | null;
  counts: { keys: number; imported: number; failed: number; resources: number };
  failuresStored: number;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  startedBy: string;
}

/** Who asked. A studio user through the broker, or the `openldr` CLI. */
export interface ImportActor { type: 'user' | 'cli'; id: string | null; name: string }

export interface ImportAuditEvent {
  action: 'import.allow' | 'import.revoke' | 'import.start' | 'import.stop' | 'import.resume' | 'import.finish';
  pluginId: string;
  connectorId?: string;
  runId?: string;
  actor: ImportActor;
  metadata?: Record<string, unknown>;
}

export interface ImportServiceDeps {
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    loadSink(id: string, version?: string): Promise<{ invoke(entrypoint: string, input: unknown): Promise<unknown> } | undefined>;
  };
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  pluginData: PluginDataStore;
  /** CE's shared save path for FHIR resources. Throws when a resource is invalid. */
  persist(resources: unknown[], provenance: Provenance): Promise<unknown>;
  audit?(event: ImportAuditEvent): Promise<void>;
  /** Injectable for tests; defaults to the real connector connection. */
  createDb?: (type: string, config: Record<string, string>) => ConnectorDb;
  now?: () => Date;
  newId?: () => string;
}

export interface ImportStartInput {
  pluginId: string;
  connectorId: string;
  options: Record<string, string>;
  pageSize?: number;
  limit?: number | null;
  dryRun?: boolean;
  actor: ImportActor;
}

export interface ImportService {
  /** Installed, enabled plugins that can import, with the connector types each reads. */
  importers(): Promise<Array<{ id: string; version: string; connectorTypes: string[] }>>;
  /** Let a plugin read one connector. Without this, start and checks refuse. */
  allow(pluginId: string, connectorId: string, actor: ImportActor): Promise<void>;
  revoke(pluginId: string, connectorId: string, actor: ImportActor): Promise<void>;
  allowed(pluginId: string): Promise<string[]>;
  checks(input: { pluginId: string; connectorId: string; options: Record<string, string> }): Promise<Array<{ id: string; value: unknown; error?: string }>>;
  start(input: ImportStartInput): Promise<ImportRun>;
  get(pluginId: string, runId: string): Promise<ImportRun | null>;
  list(pluginId: string): Promise<ImportRun[]>;
  failures(pluginId: string, runId: string): Promise<Array<{ key: string; error: string }>>;
  stop(pluginId: string, runId: string, actor: ImportActor): Promise<ImportRun>;
  resume(pluginId: string, runId: string, actor: ImportActor): Promise<ImportRun>;
  /** Resolves when this process finishes driving the run. For the CLI and tests. */
  wait(runId: string): Promise<ImportRun>;
}

const NAME = /^[A-Za-z0-9_]{1,40}$/;
const querySpecSchema = z.object({
  keyQuery: z.object({ sql: z.string().min(1).max(20_000) }),
  detailQueries: z.array(z.object({ name: z.string().regex(NAME), sql: z.string().min(1).max(20_000) })).max(12),
});
const checksSchema = z.object({
  checks: z.array(z.object({ id: z.string().regex(NAME), sql: z.string().min(1).max(20_000) })).max(30),
});
const mapOutputSchema = z.object({
  groups: z.array(z.object({ key: z.string(), resources: z.array(z.unknown()).default([]), error: z.string().optional() })),
});
const optionsSchema = z.record(z.string().regex(NAME), z.string().max(500)).refine((o) => Object.keys(o).length <= 20);

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** A plugin's error is kept only if it is a bare code. Anything else could quote a row. */
function pluginCode(error: string): string {
  return CODE.test(error) ? error : 'MAPPING_FAILED';
}
function saveCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE.test(code) ? code : 'SAVE_FAILED';
}

function checkResources(resources: unknown[], allowedTypes: Set<string>): string | null {
  if (resources.length === 0) return 'NO_RESOURCES';
  for (const r of resources) {
    const type = (r as { resourceType?: unknown } | null)?.resourceType;
    if (typeof type !== 'string' || type.length === 0) return 'INVALID_RESOURCE';
    if (!allowedTypes.has(type)) return 'RESOURCE_TYPE_NOT_ALLOWED';
  }
  return null;
}

interface ResolvedPlugin { id: string; version: string; source: ImportSource; capabilities: Capability[] }

export function createImportService(deps: ImportServiceDeps): ImportService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => randomUUID());
  const makeDb = deps.createDb ?? ((type: string, config: Record<string, string>) => createConnectorDb(type, config));
  /** Runs this process is driving right now. */
  const local = new Map<string, { promise: Promise<ImportRun>; stop: boolean }>();
  /** How the last few runs driven here ended, so `wait` still answers just after one finishes. */
  const ended = new Map<string, ImportRun>();

  const audit = async (event: ImportAuditEvent): Promise<void> => {
    try { await deps.audit?.(event); } catch { /* an audit failure must not stop an import */ }
  };

  async function resolvePlugin(pluginId: string): Promise<ResolvedPlugin> {
    const row = (await deps.plugins.list()).find((r) => r.id === pluginId && r.enabled);
    if (!row) throw new Error(`plugin ${pluginId} is not installed or disabled`);
    const raw = (row.manifest as { payload?: { importSource?: unknown } }).payload?.importSource;
    if (raw === undefined || raw === null) throw new Error(`plugin ${pluginId} cannot import: it declares no import source`);
    const source = importSourceSchema.parse(raw);
    // Fail closed: a row with no capability list predates capabilities and was never asked for this one.
    const grant = readGrant(row.manifest);
    if (grant.legacy || !grant.capabilities.some((c) => c.kind === 'host:import')) {
      throw new Error(`plugin ${pluginId} was not granted the host:import capability`);
    }
    return { id: row.id, version: row.version, source, capabilities: grant.capabilities };
  }

  async function resolveConnector(plugin: ResolvedPlugin, connectorId: string): Promise<{ type: string }> {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (!c.type || !(plugin.source.connectorTypes as string[]).includes(c.type)) {
      throw new Error(`plugin ${plugin.id} imports from ${plugin.source.connectorTypes.join(', ')} connectors only`);
    }
    if ((await deps.pluginData.get(plugin.id, ALLOWED, connectorId)) === null) {
      throw new Error(`connector ${connectorId} is not allowed for plugin ${plugin.id}`);
    }
    return { type: c.type };
  }

  async function loadSink(plugin: ResolvedPlugin) {
    const sink = await deps.plugins.loadSink(plugin.id, plugin.version);
    if (!sink) throw new Error(`plugin ${plugin.id} exposes no invokable wasm`);
    return sink;
  }

  async function openDb(connectorId: string, type: string): Promise<{ db: ConnectorDb; clean: (text: string) => string }> {
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const mask = makeRedactor([config.password].filter((v): v is string => Boolean(v)));
    return { db: makeDb(type, config), clean: (text) => redact(mask(text)).slice(0, 300) };
  }

  /** What a caller sees: a run nobody is driving any more reads as interrupted. */
  function view(run: ImportRun): ImportRun {
    const active = run.status === 'running' || run.status === 'stopping';
    if (active && !local.has(run.id) && now().getTime() - Date.parse(run.updatedAt) > STALE_MS) {
      return { ...run, status: 'interrupted' };
    }
    return run;
  }

  async function read(pluginId: string, runId: string): Promise<ImportRun | null> {
    return (await deps.pluginData.get(pluginId, RUNS, runId)) as ImportRun | null;
  }
  async function save(run: ImportRun): Promise<void> {
    run.updatedAt = now().toISOString();
    await deps.pluginData.put(run.pluginId, RUNS, run.id, run);
  }

  async function recordFailure(run: ImportRun, key: string, error: string): Promise<void> {
    if (run.failuresStored < MAX_STORED_FAILURES) {
      const seq = String(run.failuresStored).padStart(6, '0');
      await deps.pluginData.put(run.pluginId, FAILURES, `${run.id}:${seq}`, { runId: run.id, key, error });
      run.failuresStored += 1;
    }
    run.counts.failed += 1;
  }

  /** A stop asked for here, or by another process through the stored status. */
  async function stopWanted(run: ImportRun): Promise<boolean> {
    if (local.get(run.id)?.stop) return true;
    return (await read(run.pluginId, run.id))?.status === 'stopping';
  }

  async function drive(run: ImportRun, actor: ImportActor): Promise<ImportRun> {
    let db: ConnectorDb | undefined;
    let clean = (text: string) => redact(text).slice(0, 300);
    let outcome: ImportStatus = 'failed';
    try {
      const plugin = await resolvePlugin(run.pluginId);
      const { type } = await resolveConnector(plugin, run.connectorId);
      const sink = await loadSink(plugin);
      const spec = querySpecSchema.parse(await sink.invoke(plugin.source.entrypoints.queries, { options: run.options }));
      // Check the plugin's statements before opening a connection or running any of them.
      validateSelectSql(fillKeyQuery(spec.keyQuery.sql, null, 1));
      for (const d of spec.detailQueries) validateSelectSql(fillDetailQuery(d.sql, ['A']));

      const opened = await openDb(run.connectorId, type);
      db = opened.db;
      clean = opened.clean;
      const allowedTypes = new Set(allowedResourceTypes(plugin.capabilities));
      const provenance: Provenance = {
        batchId: run.id, pluginId: plugin.id, pluginVersion: plugin.version,
        sourceSystem: plugin.source.sourceSystem ?? plugin.id,
      };

      for (;;) {
        if (await stopWanted(run)) { outcome = 'stopped'; break; }
        const size = run.limit === null ? run.pageSize : Math.min(run.pageSize, run.limit - run.counts.keys);
        if (size <= 0) { outcome = 'completed'; break; }

        const keySql = fillKeyQuery(spec.keyQuery.sql, run.cursor, size);
        validateSelectSql(keySql);
        const keys = (await db.query(keySql)).rows.map((r) => String(Object.values(r)[0] ?? ''));
        if (keys.length === 0) { outcome = 'completed'; break; }
        for (const key of keys) assertSafeKey(key);
        if (keys[keys.length - 1] === run.cursor) throw new Error('the key query made no progress past the last key');

        const rows: Record<string, Array<Record<string, unknown>>> = {};
        for (const d of spec.detailQueries) {
          const sql = fillDetailQuery(d.sql, keys);
          validateSelectSql(sql);
          rows[d.name] = (await db.query(sql)).rows.map(toPluginRow);
        }

        const mapped = mapOutputSchema.parse(await sink.invoke(plugin.source.entrypoints.map, { keys, rows, options: run.options }));
        const groups = new Map<string, (typeof mapped.groups)[number]>();
        for (const g of mapped.groups) if (!groups.has(g.key)) groups.set(g.key, g);

        // One save per source key, so a bad record fails its own request and nothing else.
        for (const key of keys) {
          const group = groups.get(key);
          const failure = !group ? 'NO_GROUP'
            : group.error !== undefined ? pluginCode(group.error)
            : checkResources(group.resources, allowedTypes);
          if (failure || !group) { await recordFailure(run, key, failure ?? 'NO_GROUP'); continue; }
          if (!run.dryRun) {
            try {
              await deps.persist(group.resources, provenance);
            } catch (err) {
              await recordFailure(run, key, saveCode(err));
              continue;
            }
          }
          run.counts.imported += 1;
          run.counts.resources += group.resources.length;
        }

        run.counts.keys += keys.length;
        run.cursor = keys[keys.length - 1];
        // Keep a stop that arrived during this page; the next loop turn acts on it.
        if (await stopWanted(run)) run.status = 'stopping';
        await save(run);
      }
    } catch (err) {
      outcome = 'failed';
      // The driver's text is kept (redacted, capped) because an admin needs it to fix the source,
      // for example a missing table. Per-request failures above never keep such text.
      run.lastError = clean(err instanceof Error ? err.message : String(err));
    } finally {
      await db?.close().catch(() => {});
    }
    run.status = outcome;
    run.finishedAt = now().toISOString();
    await save(run);
    await audit({
      action: 'import.finish', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor,
      metadata: { status: outcome, dryRun: run.dryRun, ...run.counts },
    });
    return run;
  }

  /** Start driving a run in the background and remember it until it ends. */
  function launch(run: ImportRun, actor: ImportActor): void {
    const entry = { stop: false, promise: Promise.resolve(run) };
    entry.promise = new Promise<ImportRun>((resolve) => {
      setImmediate(() => {
        void drive(run, actor).catch(() => run).then((result) => {
          local.delete(run.id);
          ended.set(run.id, result);
          if (ended.size > 50) ended.delete(ended.keys().next().value as string);
          resolve(result);
        });
      });
    });
    ended.delete(run.id);
    local.set(run.id, entry);
  }

  async function allRuns(pluginId: string): Promise<ImportRun[]> {
    return (await deps.pluginData.list(pluginId, RUNS)).map((e) => e.doc as ImportRun);
  }

  async function assertNoActiveRun(pluginId: string, connectorId: string, exceptId?: string): Promise<void> {
    for (const run of await allRuns(pluginId)) {
      if (run.id === exceptId || run.connectorId !== connectorId) continue;
      const status = view(run).status;
      if (status === 'running' || status === 'stopping') {
        throw new Error(`an import from connector ${connectorId} is already running for plugin ${pluginId}`);
      }
    }
  }

  return {
    async importers() {
      const out: Array<{ id: string; version: string; connectorTypes: string[] }> = [];
      for (const row of await deps.plugins.list()) {
        if (!row.enabled) continue;
        try {
          const plugin = await resolvePlugin(row.id);
          out.push({ id: plugin.id, version: plugin.version, connectorTypes: [...plugin.source.connectorTypes] });
        } catch {
          // Not an importer: no import source, or no host:import capability.
        }
      }
      return out;
    },

    async allow(pluginId, connectorId, actor) {
      await resolvePlugin(pluginId);
      if (!(await deps.connectors.get(connectorId))) throw new Error(`connector ${connectorId} not found`);
      await deps.pluginData.put(pluginId, ALLOWED, connectorId, { connectorId, allowedBy: actor.name, allowedAt: now().toISOString() });
      await audit({ action: 'import.allow', pluginId, connectorId, actor });
    },

    async revoke(pluginId, connectorId, actor) {
      await deps.pluginData.delete(pluginId, ALLOWED, connectorId);
      await audit({ action: 'import.revoke', pluginId, connectorId, actor });
    },

    async allowed(pluginId) {
      return (await deps.pluginData.list(pluginId, ALLOWED)).map((e) => e.key);
    },

    async checks({ pluginId, connectorId, options }) {
      const plugin = await resolvePlugin(pluginId);
      const { type } = await resolveConnector(plugin, connectorId);
      if (!plugin.source.entrypoints.checks) return [];
      const parsedOptions = optionsSchema.parse(options);
      const sink = await loadSink(plugin);
      const spec = checksSchema.parse(await sink.invoke(plugin.source.entrypoints.checks, { options: parsedOptions }));
      const results: Array<{ id: string; value: unknown; error?: string }> = [];
      let db: ConnectorDb | undefined;
      try {
        for (const check of spec.checks) {
          try {
            validateSelectSql(check.sql);
          } catch {
            results.push({ id: check.id, value: null, error: 'NOT_A_SELECT' });
            continue;
          }
          try {
            db ??= (await openDb(connectorId, type)).db;
            const row = (await db.query(check.sql)).rows[0];
            results.push({ id: check.id, value: row ? Object.values(toPluginRow(row))[0] ?? null : null });
          } catch {
            results.push({ id: check.id, value: null, error: 'CHECK_FAILED' });
          }
        }
      } finally {
        await db?.close().catch(() => {});
      }
      return results;
    },

    async start(input) {
      const plugin = await resolvePlugin(input.pluginId);
      const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
      if (!Number.isInteger(pageSize) || pageSize < PAGE_SIZE_MIN || pageSize > PAGE_SIZE_MAX) {
        throw new Error(`page size must be a whole number from ${PAGE_SIZE_MIN} to ${PAGE_SIZE_MAX}`);
      }
      const limit = input.limit ?? null;
      if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error('limit must be a whole number above 0');
      const options = optionsSchema.safeParse(input.options);
      if (!options.success) throw new Error('invalid option: names are letters, digits and _, values up to 500 characters');
      await resolveConnector(plugin, input.connectorId);
      await assertNoActiveRun(input.pluginId, input.connectorId);

      const at = now().toISOString();
      const run: ImportRun = {
        id: newId(), pluginId: plugin.id, pluginVersion: plugin.version, connectorId: input.connectorId,
        status: 'running', dryRun: Boolean(input.dryRun), options: options.data, pageSize, limit,
        cursor: null, counts: { keys: 0, imported: 0, failed: 0, resources: 0 }, failuresStored: 0,
        startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: input.actor.name,
      };
      await save(run);
      await audit({
        action: 'import.start', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor: input.actor,
        metadata: { dryRun: run.dryRun, pageSize, limit },
      });
      launch(run, input.actor);
      return { ...run };
    },

    async get(pluginId, runId) {
      const run = await read(pluginId, runId);
      return run ? view(run) : null;
    },

    async list(pluginId) {
      return (await allRuns(pluginId)).map(view).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async failures(pluginId, runId) {
      const entries = await deps.pluginData.list(pluginId, FAILURES, { where: { field: 'runId', eq: runId }, limit: MAX_STORED_FAILURES });
      return entries.map((e) => {
        const doc = e.doc as { key: string; error: string };
        return { key: doc.key, error: doc.error };
      });
    },

    async stop(pluginId, runId, actor) {
      const run = await read(pluginId, runId);
      if (!run) throw new Error(`import run ${runId} not found`);
      if (view(run).status !== 'running') throw new Error(`import run ${runId} is not running`);
      const entry = local.get(runId);
      if (entry) entry.stop = true;
      // Written too, so a run driven by another process (the server, or a CLI) sees it. The
      // driving process holds the true counts and writes them over this copy on its next save.
      run.status = 'stopping';
      await save(run);
      await audit({ action: 'import.stop', pluginId, connectorId: run.connectorId, runId, actor });
      return view(run);
    },

    async resume(pluginId, runId, actor) {
      const stored = await read(pluginId, runId);
      if (!stored) throw new Error(`import run ${runId} not found`);
      const status = view(stored).status;
      if (status !== 'stopped' && status !== 'failed' && status !== 'interrupted') {
        throw new Error(`import run ${runId} is ${status}; only a stopped, failed or interrupted run can resume`);
      }
      const plugin = await resolvePlugin(pluginId);
      await resolveConnector(plugin, stored.connectorId);
      await assertNoActiveRun(pluginId, stored.connectorId, runId);
      const run: ImportRun = { ...stored, status: 'running', finishedAt: null, lastError: null, pluginVersion: plugin.version };
      await save(run);
      await audit({ action: 'import.resume', pluginId, connectorId: run.connectorId, runId, actor, metadata: { cursor: run.cursor } });
      launch(run, actor);
      return { ...run };
    },

    async wait(runId) {
      const entry = local.get(runId);
      if (entry) return view(await entry.promise);
      const done = ended.get(runId);
      if (done) return view(done);
      throw new Error(`import run ${runId} is not being driven by this process`);
    },
  };
}
