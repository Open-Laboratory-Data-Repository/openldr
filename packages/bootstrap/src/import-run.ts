import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { makeRedactor, redact } from '@openldr/core';
import { validateSelectSql } from '@openldr/dashboards';
import type { PluginDataStore, Provenance } from '@openldr/db';
import { allowedResourceTypes, canImportOnePass, importSourceSchema, readGrant, type Capability, type ImportSource } from '@openldr/marketplace';
import { createConnectorDb, type ConnectorDb } from './connector-db';
import { growPage, isStorageDown, retryWaitMs } from './import-retry';
import { createSourceReader, type SourceReader } from './import-source-reader';
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN, fillDetailQuery, fillKeyQuery, toPluginRow } from './import-sql';
import { takeBack, type SelfResumeDeps } from './job-interruptions';
import { resolveByPerson } from './job-continue';

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
/** A run that has not been written for this long, and that this process is not driving, has no
 *  driver. It is shown as interrupted and may be resumed. The driver writes it every 30 seconds. */
export const STALE_MS = 2 * 60_000;
/** How often a driver writes its run, even in the middle of a page or a wait. */
const HEARTBEAT_MS = 30_000;
const SYSTEM: ImportActor = { type: 'system', id: null, name: 'system' };
const ADOPT_FAILED = 'an import whose server stopped could not be resumed; it is tried again every 5 seconds';

/** `waiting`: the source cannot be reached, and the run will try again by itself. */
export type ImportStatus = 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'interrupted';

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
  /** Set while the run waits for its source: since when, which try is next, and the last error
   *  as the page reader made it safe to show. Null otherwise. Absent on a run from before this
   *  field, which reads as null. */
  waiting: { since: string; attempt: number; error: string } | null;
  /** The kind of process that started or last resumed the run. Absent on a run from before this
   *  field, which reads as `cli`. */
  origin: 'server' | 'cli';
}

/** Who asked. A studio user through the broker, the `openldr` CLI, or OpenLDR itself. */
export interface ImportActor { type: 'user' | 'cli' | 'system'; id: string | null; name: string }

export interface ImportAuditEvent {
  action: 'import.allow' | 'import.revoke' | 'import.start' | 'import.stop' | 'import.resume' | 'import.finish'
    | 'import.copy.start' | 'import.copy.stop' | 'import.copy.takeover' | 'import.copy.finish' | 'import.copy.delete'
    | 'import.check.start' | 'import.check.stop' | 'import.check.takeover' | 'import.check.finish'
    | 'import.check.correct' | 'import.check.recheck' | 'import.plugin.remove';
  pluginId: string;
  connectorId?: string;
  runId?: string;
  actor: ImportActor;
  metadata?: Record<string, unknown>;
}

export interface ImportServiceDeps {
  /** Records each cut a run, copy or check carried on through (design 2026-11-18-interrupted-jobs). */
  interruptions?: SelfResumeDeps;
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    /** `offThread` asks for the call to run on a worker thread, where the process allows it. */
    loadSink(id: string, version?: string): Promise<{ invoke(entrypoint: string, input: unknown, opts?: { offThread?: boolean }): Promise<unknown> } | undefined>;
  };
  connectors: {
    get(id: string): Promise<{ type: string | null; enabled: boolean } | null>;
    getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>>;
  };
  secretsKey: string | undefined;
  pluginData: PluginDataStore;
  /** CE's shared save path for FHIR resources. Throws when a resource is invalid. */
  persist(resources: unknown[], provenance: Provenance): Promise<unknown>;
  /** Writes one audit row, and throws when it cannot. Required: `allow`, `start` and `resume`
   *  refuse to act when their row cannot be written, so no plugin reads a connector or saves
   *  records without the audit log showing it. */
  audit(event: ImportAuditEvent): Promise<void>;
  /** Injectable for tests; defaults to the real connector connection. The page reader passes a
   *  query timeout for its `SELECT 1` probe. */
  createDb?: (type: string, config: Record<string, string>, opts?: { queryTimeoutMs?: number }) => ConnectorDb;
  now?: () => Date;
  newId?: () => string;
  /** Injectable for tests; the page reader's wait between tries. */
  sleep?: (ms: number) => Promise<void>;
  /** The kind of process this service runs in, recorded on each run it starts. Default `cli`. */
  origin?: 'server' | 'cli';
  /** For `adopt`'s line when it cannot resume a run. */
  logger?: { warn(fields: Record<string, unknown>, msg: string): void };
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
  /** Installed, enabled plugins that can run a one-pass import, with the connector types each reads. */
  importers(): Promise<Array<{ id: string; version: string; connectorTypes: string[] }>>;
  /** Installed, enabled plugins that may be allowed a connector: every importer, and every plugin
   *  that can only be copied from. */
  readers(): Promise<Array<{ id: string; version: string; connectorTypes: string[] }>>;
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
  /** Server only: in a service whose origin is not `server` it does nothing. Resume every run a
   *  server started that has had no write for 2 minutes and that this process is not driving, as
   *  the system. A run that was stopping is stopped instead, so a restart never sets running what a
   *  person asked to stop. Returns the runs it acted on. Once `signal` is aborted it acts on no
   *  more runs. A run it cannot resume is logged once, by id, until it is resumed. */
  adopt(opts?: { signal?: AbortSignal }): Promise<ImportRun[]>;
  /** Resolves when this process finishes driving the run. For the CLI and tests. */
  wait(runId: string): Promise<ImportRun>;
}

/** A name a plugin gives a query, a check, an option or a copy set. */
export const NAME = /^[A-Za-z0-9_]{1,40}$/;
export const querySpecSchema = z.object({
  keyQuery: z.object({ sql: z.string().min(1).max(20_000) }),
  detailQueries: z.array(z.object({ name: z.string().regex(NAME), sql: z.string().min(1).max(20_000) })).max(12),
});
const checksSchema = z.object({
  checks: z.array(z.object({ id: z.string().regex(NAME), sql: z.string().min(1).max(20_000) })).max(30),
});
const mapOutputSchema = z.object({
  groups: z.array(z.object({ key: z.string(), resources: z.array(z.unknown()).default([]), error: z.string().optional() })),
});
export const optionsSchema = z.record(z.string().regex(NAME), z.string().max(500)).refine((o) => Object.keys(o).length <= 20);

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** A plugin's error is kept only if it is a bare code. Anything else could quote a row. Shared
 *  with the check run (import-check.ts). */
export function pluginCode(error: string): string {
  return CODE.test(error) ? error : 'MAPPING_FAILED';
}
/** A save error's own code when it is a bare code, else SAVE_FAILED. Its text is never kept. */
export function saveCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODE.test(code) ? code : 'SAVE_FAILED';
}

/** Why the resources may not be saved, as a code, or null when they may. */
export function checkResources(resources: unknown[], allowedTypes: Set<string>): string | null {
  if (resources.length === 0) return 'NO_RESOURCES';
  for (const r of resources) {
    const type = (r as { resourceType?: unknown } | null)?.resourceType;
    if (typeof type !== 'string' || type.length === 0) return 'INVALID_RESOURCE';
    if (!allowedTypes.has(type)) return 'RESOURCE_TYPE_NOT_ALLOWED';
  }
  return null;
}

export interface ResolvedPlugin { id: string; version: string; source: ImportSource; capabilities: Capability[] }
/** A plugin that can run a one-pass import, so `queries` and `map` are both present. */
export interface ImportingPlugin extends ResolvedPlugin {
  source: ImportSource & { entrypoints: { queries: string; map: string } };
}
/** What a caller needs from a plugin. `read`: it may be allowed a connector. `import`: it can
 *  also run a one-pass import. A plugin with only a copy entrypoint passes `read` alone. */
export type PluginNeed = 'read' | 'import';

/** Opens a host database connector. The page reader passes a query timeout for its probe. */
export type CreateConnectorDb = (type: string, config: Record<string, string>, opts?: { queryTimeoutMs?: number }) => ConnectorDb;
export const defaultCreateDb: CreateConnectorDb = (type, config, opts) => createConnectorDb(type, config, opts);

// The helpers below are shared by the one-pass import and the copy (import-copy.ts), so both
// apply the same trust rules with the same words.

/** For events that record something already done (stop, revoke, finish). A failure here
 *  cannot undo it, so it is swallowed; the sink logs it. */
export async function auditQuietly(sink: ImportServiceDeps['audit'], event: ImportAuditEvent): Promise<void> {
  try { await sink(event); } catch { /* see above */ }
}

/** For events that open the door to reading or writing (allow, start, resume). Called BEFORE
 *  the change is made. If the row cannot be written, the action is refused. The sink's own
 *  error text is not passed on: it can name hosts. */
export async function auditOrRefuse(sink: ImportServiceDeps['audit'], event: ImportAuditEvent): Promise<void> {
  try {
    await sink(event);
  } catch {
    throw new Error('the audit log could not be written, so nothing was changed');
  }
}

/** The enabled plugin with this id, checked for an import source, the host:import grant and `need`. */
export function resolveImportPlugin(plugins: ImportServiceDeps['plugins'], pluginId: string, need: 'import'): Promise<ImportingPlugin>;
export function resolveImportPlugin(plugins: ImportServiceDeps['plugins'], pluginId: string, need: PluginNeed): Promise<ResolvedPlugin>;
export async function resolveImportPlugin(plugins: ImportServiceDeps['plugins'], pluginId: string, need: PluginNeed): Promise<ResolvedPlugin> {
  const row = (await plugins.list()).find((r) => r.id === pluginId && r.enabled);
  if (!row) throw new Error(`plugin ${pluginId} is not installed or disabled`);
  const raw = (row.manifest as { payload?: { importSource?: unknown } }).payload?.importSource;
  if (raw === undefined || raw === null) throw new Error(`plugin ${pluginId} cannot import: it declares no import source`);
  const source = importSourceSchema.parse(raw);
  // Fail closed: a row with no capability list predates capabilities and was never asked for this one.
  const grant = readGrant(row.manifest);
  if (grant.legacy || !grant.capabilities.some((c) => c.kind === 'host:import')) {
    throw new Error(`plugin ${pluginId} was not granted the host:import capability`);
  }
  if (need === 'import' && !canImportOnePass(source)) {
    throw new Error(`plugin ${pluginId} can be copied from but cannot import`);
  }
  return { id: row.id, version: row.version, source, capabilities: grant.capabilities };
}

/** The connector, checked to be enabled, of a type the plugin reads, and allowed for the plugin. */
export async function resolveImportConnector(
  connectors: ImportServiceDeps['connectors'],
  isAllowed: (pluginId: string, connectorId: string) => Promise<boolean>,
  plugin: ResolvedPlugin,
  connectorId: string,
): Promise<{ type: string }> {
  const c = await connectors.get(connectorId);
  if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
  if (!c.type || !(plugin.source.connectorTypes as string[]).includes(c.type)) {
    throw new Error(`plugin ${plugin.id} imports from ${plugin.source.connectorTypes.join(', ')} connectors only`);
  }
  if (!(await isAllowed(plugin.id, connectorId))) {
    throw new Error(`connector ${connectorId} is not allowed for plugin ${plugin.id}`);
  }
  return { type: c.type };
}

export async function loadImportSink(plugins: ImportServiceDeps['plugins'], plugin: ResolvedPlugin) {
  const sink = await plugins.loadSink(plugin.id, plugin.version);
  if (!sink) throw new Error(`plugin ${plugin.id} exposes no invokable wasm`);
  return sink;
}

/** Shown while a drive waits for the plugin's code. Fixed: the loader's own text can name hosts. */
export const PLUGIN_CODE_NOT_LOADED = "the plugin's code could not be loaded yet";
/** A wait is slept in slices this long, so a stop or a release is felt within a second. */
const WAIT_SLICE_MS = 1000;

/** Thrown by `loadImportSinkWaiting` when a stop or a release came while it waited. */
export class StoppedWhileWaiting extends Error {
  constructor() { super('stopped while waiting for the plugin code'); }
}

/**
 * For a drive. `loadSink` reads the plugin's code from blob storage on its first use in a process.
 * After a power cut that storage may come up after the server, and the S3 client then throws. Only
 * such a throw (`isStorageDown`) is waited out, as a lost link is: `onWaiting` with the try number,
 * then `retryWaitMs`, slept in slices with `stopWanted` asked before each. Any other throw, such as
 * a hash mismatch, is thrown as it is. A load that finds no invokable code throws as
 * `loadImportSink` does.
 */
export async function loadImportSinkWaiting(
  plugins: ImportServiceDeps['plugins'],
  plugin: ResolvedPlugin,
  waits: {
    onWaiting(state: { attempt: number; error: string } | null): Promise<void>;
    stopWanted(): Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
  },
) {
  const sleep = waits.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    let sink: Awaited<ReturnType<ImportServiceDeps['plugins']['loadSink']>>;
    try {
      sink = await plugins.loadSink(plugin.id, plugin.version);
    } catch (err) {
      // Any other fault ends the run with its own text, as before this wait existed.
      if (!isStorageDown(err)) throw err;
      await waits.onWaiting({ attempt, error: PLUGIN_CODE_NOT_LOADED });
      for (let left = retryWaitMs(attempt); left > 0; left -= WAIT_SLICE_MS) {
        if (await waits.stopWanted()) throw new StoppedWhileWaiting();
        await sleep(Math.min(WAIT_SLICE_MS, left));
      }
      continue;
    }
    if (attempt > 1) await waits.onWaiting(null);
    if (!sink) throw new Error(`plugin ${plugin.id} exposes no invokable wasm`);
    return sink;
  }
}

/** How to open the connector, and how to make its driver's text safe to show. */
export async function openSourceAccess(
  deps: Pick<ImportServiceDeps, 'connectors' | 'secretsKey'>,
  makeDb: CreateConnectorDb,
  connectorId: string,
  type: string,
): Promise<{ open: (opts?: { queryTimeoutMs?: number }) => ConnectorDb; clean: (text: string) => string }> {
  const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
  const mask = makeRedactor([config.password].filter((v): v is string => Boolean(v)));
  return { open: (opts) => makeDb(type, config, opts), clean: (text) => redact(mask(text)).slice(0, 300) };
}

export function createImportService(deps: ImportServiceDeps): ImportService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => randomUUID());
  const origin = deps.origin ?? 'cli';
  const makeDb = deps.createDb ?? defaultCreateDb;
  /** Runs this process is driving right now. */
  const local = new Map<string, { promise: Promise<ImportRun>; stop: boolean }>();
  /** How the last few runs driven here ended, so `wait` still answers just after one finishes. */
  const ended = new Map<string, ImportRun>();

  const audit = (event: ImportAuditEvent): Promise<void> => auditQuietly(deps.audit, event);
  const auditOrRefuseHere = (event: ImportAuditEvent): Promise<void> => auditOrRefuse(deps.audit, event);

  function resolvePlugin(pluginId: string, need: 'import'): Promise<ImportingPlugin>;
  function resolvePlugin(pluginId: string, need: PluginNeed): Promise<ResolvedPlugin>;
  function resolvePlugin(pluginId: string, need: PluginNeed): Promise<ResolvedPlugin> {
    return resolveImportPlugin(deps.plugins, pluginId, need);
  }

  /** Every enabled plugin that passes `need`, with the connector types each reads. */
  async function listPlugins(need: PluginNeed): Promise<Array<{ id: string; version: string; connectorTypes: string[] }>> {
    const out: Array<{ id: string; version: string; connectorTypes: string[] }> = [];
    for (const row of await deps.plugins.list()) {
      if (!row.enabled) continue;
      try {
        const plugin = await resolvePlugin(row.id, need);
        out.push({ id: plugin.id, version: plugin.version, connectorTypes: [...plugin.source.connectorTypes] });
      } catch {
        // Fails the check: no import source, no host:import capability, or (for import) copy only.
      }
    }
    return out;
  }

  const isAllowed = async (pluginId: string, connectorId: string): Promise<boolean> =>
    (await deps.pluginData.get(pluginId, ALLOWED, connectorId)) !== null;
  const resolveConnector = (plugin: ResolvedPlugin, connectorId: string): Promise<{ type: string }> =>
    resolveImportConnector(deps.connectors, isAllowed, plugin, connectorId);
  const loadSink = (plugin: ResolvedPlugin) => loadImportSink(deps.plugins, plugin);
  const sourceAccess = (connectorId: string, type: string) => openSourceAccess(deps, makeDb, connectorId, type);

  async function openDb(connectorId: string, type: string): Promise<ConnectorDb> {
    return (await sourceAccess(connectorId, type)).open();
  }

  const isActive = (status: ImportStatus): boolean => status === 'running' || status === 'waiting' || status === 'stopping';

  /** What a caller sees: a run nobody is driving any more reads as interrupted. A run from before
   *  `waiting` and `origin` existed gets their defaults. */
  function view(stored: ImportRun): ImportRun {
    const run: ImportRun = { ...stored, waiting: stored.waiting ?? null, origin: stored.origin ?? 'cli' };
    if (isActive(run.status) && !local.has(run.id) && now().getTime() - Date.parse(run.updatedAt) > STALE_MS) {
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
    let reader: SourceReader | undefined;
    let clean = (text: string) => redact(text).slice(0, 300);
    let outcome: ImportStatus = 'failed';

    // The counts, the stored failures and the cursor as they stood at the last page end. Only these
    // are ever saved. A save in the middle of a page (a heartbeat, a change of wait state) keeps
    // them, so the stored record says the page is not done. A resume then does it again in full,
    // nothing is counted twice, and its failures land on the same sequence numbers.
    const progressOf = (r: ImportRun) => ({ counts: { ...r.counts }, failuresStored: r.failuresStored, cursor: r.cursor });
    let pageEnd = progressOf(run);
    const markPageEnd = (): void => { pageEnd = progressOf(run); };

    // Saves go one after another, so a heartbeat that started first never lands last.
    let saving: Promise<void> = Promise.resolve();
    const saveInTurn = (): Promise<void> => {
      const next = saving.then(async () => {
        run.updatedAt = now().toISOString();
        await deps.pluginData.put(run.pluginId, RUNS, run.id, { ...run, ...pageEnd, counts: { ...pageEnd.counts } });
      });
      saving = next.catch(() => {});
      return next;
    };
    /** Save, and keep a stop that another process asked for through the stored status. */
    const saveKeepingStop = async (): Promise<void> => {
      if (await stopWanted(run)) run.status = 'stopping';
      await saveInTurn();
    };
    // Written every 30 seconds while this drives, even in the middle of a page or a wait, so
    // another process can tell a live run from one whose driver has gone. A failed write here is
    // not acted on: the next page's save meets the same fault and ends the run.
    let beating: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      beating ??= saveKeepingStop().catch(() => {}).finally(() => { beating = null; });
    }, HEARTBEAT_MS);

    try {
      /** When the current wait began. A first try starts a new wait. */
      let waitingSince: string | null = null;
      /** A wait for the plugin's code or for the source. */
      const onWaiting = async (state: { attempt: number; error: string } | null): Promise<void> => {
        if (state) {
          if (state.attempt === 1 || waitingSince === null) waitingSince = now().toISOString();
          run.status = 'waiting';
          // The error is the reader's text, already made safe, or a fixed sentence. It is stored as given.
          run.waiting = { since: waitingSince, attempt: state.attempt, error: state.error };
        } else {
          run.status = 'running';
          run.waiting = null;
        }
        await saveKeepingStop();
      };

      const plugin = await resolvePlugin(run.pluginId, 'import');
      const { type } = await resolveConnector(plugin, run.connectorId);
      const sink = await loadImportSinkWaiting(deps.plugins, plugin, {
        onWaiting, stopWanted: () => stopWanted(run), ...(deps.sleep ? { sleep: deps.sleep } : {}),
      });
      const spec = querySpecSchema.parse(await sink.invoke(plugin.source.entrypoints.queries, { options: run.options }));
      // Check the plugin's statements before opening a connection or running any of them.
      validateSelectSql(fillKeyQuery(spec.keyQuery.sql, null, 1), 'mssql');
      for (const d of spec.detailQueries) validateSelectSql(fillDetailQuery(d.sql, ['A']), 'mssql');

      const access = await sourceAccess(run.connectorId, type);
      clean = access.clean;
      reader = createSourceReader({
        open: async (opts) => access.open(opts),
        onWaiting,
        stopWanted: () => stopWanted(run),
        clean,
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      });
      const allowedTypes = new Set(allowedResourceTypes(plugin.capabilities));
      const provenance: Provenance = {
        batchId: run.id, pluginId: plugin.id, pluginVersion: plugin.version,
        sourceSystem: plugin.source.sourceSystem ?? plugin.id,
      };

      // The page size to ask for. A page the reader had to halve stays halved, and doubles again
      // after 5 good pages in a row, never above the run's own page size.
      let size = run.pageSize;
      let goodInRow = 0;
      for (;;) {
        if (await stopWanted(run)) { outcome = 'stopped'; break; }
        const ask = run.limit === null ? size : Math.min(size, run.limit - run.counts.keys);
        if (ask <= 0) { outcome = 'completed'; break; }

        // A run with a position has read this source before, so a refused login or database may
        // be a source that is starting up (R45).
        const page = await reader.readPage({
          keySql: spec.keyQuery.sql, details: spec.detailQueries, after: run.cursor, size: ask, readBefore: run.cursor !== null,
        });
        if (page.kind === 'stopped') { outcome = 'stopped'; break; }
        if (page.kind === 'end') { outcome = 'completed'; break; }
        if (page.kind === 'skipped') {
          // One key timed out 3 times even read alone. It is listed, and the run moves past it.
          await recordFailure(run, page.key, 'SOURCE_TIMEOUT');
          run.counts.keys += 1;
          run.cursor = page.key;
          markPageEnd();
          await saveKeepingStop();
          // The key was found at a page of 1. Start there and grow back after 5 good pages, rather
          // than pay the whole halving again if the source is still slow.
          size = 1;
          goodInRow = 0;
          continue;
        }
        if (page.size < ask) {
          size = page.size;
          goodInRow = 0;
        } else {
          goodInRow += 1;
          const grown = growPage(size, run.pageSize, goodInRow);
          if (grown !== size) { size = grown; goodInRow = 0; }
        }
        const { keys, rows } = page;

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
        markPageEnd();
        // Keep a stop that arrived during this page; the next loop turn acts on it.
        await saveKeepingStop();
      }
    } catch (err) {
      if (err instanceof StoppedWhileWaiting) {
        outcome = 'stopped';
      } else {
        outcome = 'failed';
        // Kept (redacted, capped) because an admin needs it to fix the source, for example a missing
        // table. A source error reaches here only as the reader's own text, already made safe.
        // Per-request failures above never keep such text.
        run.lastError = clean(err instanceof Error ? err.message : String(err));
      }
    } finally {
      clearInterval(heartbeat);
      await beating;
      await reader?.close();
    }
    // Every way out of the loop but a throw is at a page end. After a throw in the middle of a
    // page, the run reports what it stores: the progress at the last page end.
    Object.assign(run, { ...pageEnd, counts: { ...pageEnd.counts } });
    run.status = outcome;
    run.waiting = null;
    run.finishedAt = now().toISOString();
    await saveInTurn();
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
      if (isActive(view(run).status)) {
        throw new Error(`an import from connector ${connectorId} is already running for plugin ${pluginId}`);
      }
    }
  }

  /** Runs `adopt` could not resume and has logged, so each is logged once until it is resumed. */
  const unadoptable = new Set<string>();

  /** A server-started run whose driver has gone: a stored status a driver holds, no write for
   *  2 minutes, and not driven here. A run with no `origin` predates it and reads as `cli`. */
  const needsAdopting = (stored: ImportRun): boolean =>
    (stored.origin ?? 'cli') === 'server' && isActive(stored.status) && view(stored).status === 'interrupted';

  /** A run that was stopping when its driver went: finish the stop, as the driver would have. */
  async function finishStop(stored: ImportRun): Promise<ImportRun> {
    const run: ImportRun = { ...stored, status: 'stopped', waiting: null, finishedAt: now().toISOString(), origin: stored.origin ?? 'cli' };
    await save(run);
    await audit({
      action: 'import.finish', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor: SYSTEM,
      metadata: { status: 'stopped', dryRun: run.dryRun, ...run.counts },
    });
    return view(run);
  }

  const service: ImportService = {
    importers: () => listPlugins('import'),

    readers: () => listPlugins('read'),

    async allow(pluginId, connectorId, actor) {
      const plugin = await resolvePlugin(pluginId, 'read');
      const c = await deps.connectors.get(connectorId);
      if (!c) throw new Error(`connector ${connectorId} not found`);
      // Refuse a connector the plugin cannot read now, not at its first run. A disabled connector of
      // the right type may still be allowed, ready for when it is enabled.
      if (!c.type || !(plugin.source.connectorTypes as string[]).includes(c.type)) {
        throw new Error(`plugin ${plugin.id} imports from ${plugin.source.connectorTypes.join(', ')} connectors only`);
      }
      await auditOrRefuseHere({ action: 'import.allow', pluginId, connectorId, actor });
      await deps.pluginData.put(pluginId, ALLOWED, connectorId, { connectorId, allowedBy: actor.name, allowedAt: now().toISOString() });
    },

    async revoke(pluginId, connectorId, actor) {
      await deps.pluginData.delete(pluginId, ALLOWED, connectorId);
      await audit({ action: 'import.revoke', pluginId, connectorId, actor });
    },

    async allowed(pluginId) {
      return (await deps.pluginData.list(pluginId, ALLOWED)).map((e) => e.key);
    },

    async checks({ pluginId, connectorId, options }) {
      const plugin = await resolvePlugin(pluginId, 'import');
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
            validateSelectSql(check.sql, 'mssql');
          } catch {
            results.push({ id: check.id, value: null, error: 'NOT_A_SELECT' });
            continue;
          }
          try {
            db ??= await openDb(connectorId, type);
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
      const plugin = await resolvePlugin(input.pluginId, 'import');
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
        waiting: null, origin,
      };
      await auditOrRefuseHere({
        action: 'import.start', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor: input.actor,
        metadata: { dryRun: run.dryRun, pageSize, limit },
      });
      await save(run);
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
      // An entry at or above the stored count was written in a page that never ended, as in a
      // crash. The redo of that page writes its own entries from the same number.
      const stored = (await read(pluginId, runId))?.failuresStored;
      const kept = stored === undefined ? entries : entries.filter((e) => Number(e.key.slice(e.key.lastIndexOf(':') + 1)) < stored);
      return kept.map((e) => {
        const doc = e.doc as { key: string; error: string };
        return { key: doc.key, error: doc.error };
      });
    },

    async stop(pluginId, runId, actor) {
      const run = await read(pluginId, runId);
      if (!run) throw new Error(`import run ${runId} not found`);
      const status = view(run).status;
      if (status !== 'running' && status !== 'waiting') throw new Error(`import run ${runId} is not running`);
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
      const plugin = await resolvePlugin(pluginId, 'import');
      await resolveConnector(plugin, stored.connectorId);
      await assertNoActiveRun(pluginId, stored.connectorId, runId);
      // The process that resumes the run is the one that drives it now.
      const run: ImportRun = {
        ...stored, status: 'running', finishedAt: null, lastError: null, pluginVersion: plugin.version, waiting: null, origin,
      };
      // A cursor is a source key. A person's resume has always recorded it. The server's own resume
      // (adopt) is new, and no source key goes to the audit log without a person (R43).
      await auditOrRefuseHere({
        action: 'import.resume', pluginId, connectorId: run.connectorId, runId, actor,
        ...(actor.type === 'system' ? {} : { metadata: { cursor: run.cursor } }),
      });
      await save(run);
      // A person's Resume closes the cut the run waited on, so its record stops reading as waiting.
      // adopt resumes as the system and its cut is resolved as self by takeBack (third review R10).
      if (actor.type !== 'system' && deps.interruptions) {
        await resolveByPerson(deps.interruptions.store, 'cdr-run', runId, now()).catch(() => {});
      }
      // A resume by hand and adopt can both pass the checks above before either launches. The
      // second one does not start a second drive in this process.
      if (local.has(runId)) return { ...run };
      launch(run, actor);
      return { ...run };
    },

    async adopt(opts = {}) {
      // A run adopted here would be recorded as this process's. From a CLI process that would be
      // `cli`, and no server would adopt it again.
      if (origin !== 'server') return [];
      const out: ImportRun[] = [];
      for (const row of await deps.plugins.list()) {
        for (const stored of await allRuns(row.id)) {
          // Asked before each run, so a server that is shutting down resumes nothing more.
          if (opts.signal?.aborted) return out;
          if (!needsAdopting(stored)) continue;
          const takeOver = async (): Promise<void> => {
            out.push(stored.status === 'stopping' ? await finishStop(stored) : await service.resume(stored.pluginId, stored.id, SYSTEM));
            unadoptable.delete(stored.id);
          };
          try {
            if (deps.interruptions) {
              // The cut is recorded open and resolved only once the resume went through, so a refused
              // resume never reads as carried on (review R7). Three cuts at the same saved cursor
              // leave the run interrupted for a person's Resume (review R10).
              const at = new Date(stored.updatedAt);
              await takeBack(deps.interruptions, {
                kind: 'cdr-run', jobId: stored.id, phase: stored.cursor ?? null, at,
                cause: at.getTime() < deps.interruptions.processStartedAt.getTime() ? 'server-restart' : 'lease-expired',
                selfResume: true, resume: takeOver, wait: async () => {},
              });
            } else {
              await takeOver();
            }
          } catch {
            // A plugin that is now disabled, a connector no longer allowed, or the audit log down.
            // The run stays as it is and reads as interrupted, so a person can see it and resume
            // it by hand. The next turn tries again. One line per run, with no error text: the
            // error can quote a host or a source's words.
            if (!unadoptable.has(stored.id)) {
              unadoptable.add(stored.id);
              deps.logger?.warn({ runId: stored.id }, ADOPT_FAILED);
            }
          }
        }
      }
      return out;
    },

    async wait(runId) {
      const entry = local.get(runId);
      if (entry) return view(await entry.promise);
      const done = ended.get(runId);
      if (done) return view(done);
      throw new Error(`import run ${runId} is not being driven by this process`);
    },
  };
  return service;
}
