/** The init context the host mints and transfers to the plugin iframe. */
export interface PluginInitContext {
  pluginId: string;
  capabilities: string[];
  theme: 'light' | 'dark';
  locale: string;
  sessionId: string;
  /** Where the host draws this page. Absent means its own page. */
  site?: PluginSiteName;
  /** The host's theme as `--openldr-*` CSS variables. An older host sends none. */
  themeTokens?: Record<string, string>;
}

/** The places a plugin's one ui.html can be drawn in. */
export type PluginSiteName = 'page' | 'widget' | 'panel';

/** Operations the plugin may request (mirror of the host broker's BrokerOp). */
export type PluginBrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'reports.eventSources' }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string }
  | { kind: 'connectors.metadata'; id: string }
  | { kind: 'connectors.push'; connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }
  | { kind: 'connectors.validate'; connectorId: string; mapping: unknown }
  | { kind: 'fhir.facilities' }
  | { kind: 'schedule.register'; schedule: unknown }
  | { kind: 'schedule.list' }
  | { kind: 'schedule.remove'; id: string }
  | { kind: 'import.allowed' }
  | { kind: 'import.diagnose'; connectorId: string }
  | { kind: 'import.checks'; connectorId: string; options: Record<string, string> }
  | { kind: 'import.start'; connectorId: string; options: Record<string, string>; pageSize?: number; limit?: number; dryRun?: boolean }
  | { kind: 'import.status'; runId: string }
  | { kind: 'import.list' }
  | { kind: 'import.failures'; runId: string }
  | { kind: 'import.stop'; runId: string }
  | { kind: 'import.resume'; runId: string }
  | { kind: 'import.copy.start'; connectorId: string; options: Record<string, string>; pageSize?: number; reread?: boolean }
  | { kind: 'import.copy.list' }
  | { kind: 'import.copy.status'; copyId: string }
  | { kind: 'import.copy.stop'; copyId: string }
  | { kind: 'import.copy.delete'; copyId: string; confirm: true }
  | { kind: 'import.check.start'; copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number }
  | { kind: 'import.check.list' }
  | { kind: 'import.check.status'; runId: string }
  | { kind: 'import.check.stop'; runId: string }
  | { kind: 'import.check.held'; copyId: string; reason?: 'held' | 'error'; label?: string; offset: number; limit: number }
  | { kind: 'import.check.heldItem'; copyId: string; key: string }
  | { kind: 'import.check.heldItems'; copyId: string; reason?: 'held' | 'error'; label?: string; offset: number; limit: number };

/** The types of file a page may ask the host to save. */
export type PluginDownloadMime = 'text/csv' | 'application/json' | 'text/plain';

/** Operations the studio answers itself. They go over the same port as broker operations, and
 *  the studio never forwards them to the server. */
export type PluginHostOp = { kind: 'host.download'; filename: string; mime: PluginDownloadMime; text: string };

/** Everything a page may send over its port. */
export type PluginOp = PluginBrokerOp | PluginHostOp;

export type PluginCopyStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'deleting';

/** One set of a copy, as the host shows it to a page. */
export interface PluginCopySetProgress {
  /** Keys stored. A skipped key is counted in `skipped` instead. */
  keys: number;
  rows: number;
  /** The UTF-8 length of each stored row's JSON, added up. */
  bytes: number;
  /** Keys the host could not store and listed as skipped. */
  skipped: number;
  done: boolean;
  /** Set when a start with `reread` asked for this set to be emptied and read again. */
  empty?: boolean;
}

/** A copy as the host shows it to a page (mirror of the broker's PageCopyRun). The host never
 *  sends a set's position in the source, nor which server process drives the copy. */
export interface PluginCopyRun {
  id: string;
  kind: 'copy';
  rev: number;
  pluginId: string;
  pluginVersion: string;
  connectorId: string;
  status: PluginCopyStatus;
  options: Record<string, string>;
  pageSize: number;
  /** Set name to progress. */
  sets: Record<string, PluginCopySetProgress>;
  /** The sets in the order the plugin named them. */
  setOrder: string[];
  setSql: Record<string, string>;
  waiting: { since: string; attempt: number; error: string } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  startedBy: string;
}

export type PluginCheckStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed';

/** A check run as the host shows it to a page (mirror of the broker's PageCheckRun). The host
 *  never sends the run's position in the copy, nor which server process drives it. */
export interface PluginCheckRun {
  id: string;
  copyId: string;
  referenceCopyId: string | null;
  status: PluginCheckStatus;
  options: Record<string, string>;
  pageSize: number;
  counts: { read: number; saved: number; held: number; failed: number; resources: number; labels: Record<string, number> };
  waiting: { since: string; attempt: number; error: string } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}

/** One request the check kept back, without the plugin's own detail. */
export interface PluginHeldRow {
  copyId: string;
  key: string;
  runId: string;
  reason: 'held' | 'error';
  label: string | null;
  error: string | null;
  heldAt: string;
}

/** A held request with the plugin's own JSON. Only the plugin's page knows what is inside. */
export interface PluginHeldItem extends PluginHeldRow {
  findings: unknown;
  check: unknown;
}

export type PluginRpcResult = { ok: true; data: unknown } | { ok: false; error: string };

/** The `window.openldr` surface available to plugin code inside the iframe. */
export interface OpenLdrPluginApi {
  readonly pluginId: string;
  readonly capabilities: readonly string[];
  readonly theme: 'light' | 'dark';
  /** The host's theme as `--openldr-*` CSS variables, also set on the page's root. Empty when
   *  the host sends none. Read them in CSS with a fallback: `var(--openldr-bg, #fff)`. */
  readonly themeTokens: Readonly<Record<string, string>>;
  readonly locale: string;
  /** Where the host drew this page: 'page', 'widget' (dashboard card) or 'panel' (side panel). */
  readonly site: PluginSiteName;
  readonly ready: Promise<void>;
  storage: {
    get(collection: string, key: string): Promise<unknown>;
    put(collection: string, key: string, doc: unknown): Promise<void>;
    delete(collection: string, key: string): Promise<void>;
    list(collection: string, opts?: { where?: { field: string; eq: unknown }; limit?: number }): Promise<Array<{ collection: string; key: string; doc: unknown }>>;
  };
  invoke(entrypoint: string, input: unknown): Promise<unknown>;
  reports: {
    list(): Promise<unknown>;
    columns(id: string): Promise<unknown>;
    run(id: string, params?: Record<string, unknown>): Promise<unknown>;
    eventSources(): Promise<unknown>;
  };
  connectors: {
    list(): Promise<unknown>;
    test(id: string): Promise<unknown>;
    metadata(id: string): Promise<unknown>;
    push(input: { connectorId: string; mapping: unknown; orgUnitMap?: Record<string, string>; period: string; dryRun: boolean }): Promise<unknown>;
    validate(input: { connectorId: string; mapping: unknown }): Promise<unknown>;
  };
  fhir: { facilities(): Promise<unknown> };
  schedule: {
    register(schedule: unknown): Promise<unknown>;
    list(): Promise<unknown>;
    remove(id: string): Promise<unknown>;
  };
  /** Imports from a database connector an admin allowed for this plugin (needs host:import).
   *  The page passes a connector and options only; the plugin's wasm supplies the SQL. */
  imports: {
    allowed(): Promise<unknown>;
    diagnose(connectorId: string): Promise<unknown>;
    checks(input: { connectorId: string; options: Record<string, string> }): Promise<unknown>;
    start(input: { connectorId: string; options: Record<string, string>; pageSize?: number; limit?: number; dryRun?: boolean }): Promise<unknown>;
    status(runId: string): Promise<unknown>;
    list(): Promise<unknown>;
    failures(runId: string): Promise<unknown>;
    stop(runId: string): Promise<unknown>;
    resume(runId: string): Promise<unknown>;
    /** A copy of the source's rows to CE's own disk. One per plugin and connector. */
    copy: {
      /** Records the request and returns. `changedSets` instead of `run` means a set's SQL
       *  changed: ask the person, then call again with `reread: true` to read those sets again. */
      start(input: { connectorId: string; options: Record<string, string>; pageSize?: number; reread?: boolean }): Promise<{ run?: PluginCopyRun; changedSets?: string[] }>;
      list(): Promise<PluginCopyRun[]>;
      status(copyId: string): Promise<PluginCopyRun | null>;
      stop(copyId: string): Promise<PluginCopyRun>;
      /** Deletes the copy and every row it holds. */
      remove(copyId: string): Promise<PluginCopyRun>;
    };
    /** A check of a finished copy: the plugin decodes each request, CE saves what passes and keeps
     *  the rest. One per copy. The held calls return real values; show them to the person, never log them. */
    check: {
      /** Records the request and returns. Fails with a sentence when the copy is not finished, a run is live, or a copy is not this plugin's. */
      start(input: { copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number }): Promise<PluginCheckRun>;
      list(): Promise<PluginCheckRun[]>;
      status(runId: string): Promise<PluginCheckRun | null>;
      stop(runId: string): Promise<PluginCheckRun>;
      held(input: { copyId: string; reason?: 'held' | 'error'; label?: string; offset: number; limit: number }): Promise<{ rows: PluginHeldRow[]; total: number }>;
      heldItem(input: { copyId: string; key: string }): Promise<PluginHeldItem | null>;
      /** The same rows as `held`, in the same order, each with its findings and check. `limit` is 1 to 200. */
      heldItems(input: { copyId: string; reason?: 'held' | 'error'; label?: string; offset: number; limit: number }): Promise<{ items: PluginHeldItem[]; total: number }>;
    };
  };
  /** Files the studio saves for the page. The page's frame cannot download. */
  files: {
    /** The studio saves `text` as a file named `filename` in its own document. Refused when the
     *  name is not a plain name ending in .csv, .json or .txt to fit the type, when the text is
     *  over 64 MB in UTF-8, or when the page saved another file less than a second ago. The text
     *  never goes to the server. */
    download(input: { filename: string; mime: PluginDownloadMime; text: string }): Promise<void>;
  };
}

declare global {
  interface Window { openldr?: OpenLdrPluginApi }
}
