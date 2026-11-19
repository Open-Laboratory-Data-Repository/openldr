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
  | { kind: 'import.check.start'; copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number; fromStart?: boolean }
  | { kind: 'import.check.list' }
  | { kind: 'import.check.status'; runId: string }
  | { kind: 'import.check.stop'; runId: string }
  | { kind: 'import.check.held'; copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; finding?: string; offset: number; limit: number }
  | { kind: 'import.check.heldCodes'; copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string }
  | { kind: 'import.check.heldItem'; copyId: string; key: string }
  | { kind: 'import.check.choices'; copyId: string }
  | { kind: 'import.check.correct'; copyId: string; key: string; values: Record<string, string | null>; reason: string }
  | { kind: 'import.check.recheck'; copyId: string; key: string }
  | { kind: 'import.check.access' }
  | { kind: 'import.check.heldItems'; copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; finding?: string; offset?: number; after?: string | null; limit: number };

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
  /** `labels` counts each label the plugin gave, up to 12 names. Past 12, and for a label that is not
   *  a code, the request counts under `other`. `other` is a count only and cannot be used as a filter. */
  counts: { read: number; saved: number; held: number; failed: number; resources: number; labels: Record<string, number> };
  /** One entry for each laboratory code the plugin named, in the order first met. They add up to
   *  `counts`. Empty at a start; absent on a run stored before the host counted laboratories. */
  laboratories?: PluginCheckLaboratory[];
  waiting: { since: string; attempt: number; error: string } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
}

/** The counts of one laboratory on a check. `code` is null for the requests that named none, and
 *  for those past the 500th code. */
export interface PluginCheckLaboratory {
  code: string | null;
  counts: { read: number; saved: number; held: number; failed: number; labels: Record<string, number> };
}

/** One request the check kept back, without the plugin's own detail. */
export interface PluginHeldRow {
  copyId: string;
  key: string;
  runId: string;
  reason: 'held' | 'error';
  label: string | null;
  /** The laboratory code the plugin named for the request, or null. */
  laboratory: string | null;
  error: string | null;
  heldAt: string;
}

/** The filters of a page of held requests, read by offset or by key (`after`). */
export type PluginHeldItemsInput = { copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; finding?: string; limit: number }
  & ({ offset: number; after?: undefined } | { after: string | null; offset?: number });

/** A held request with the plugin's own JSON. Only the plugin's page knows what is inside. */
export interface PluginHeldItem extends PluginHeldRow {
  findings: unknown;
  check: unknown;
  /** The values as read of the fields a person may correct, as the plugin sent them, or null. */
  fields?: Record<string, string | null> | null;
}

/** One field a person corrected in a held request. */
export interface PluginHeldCorrection {
  field: string;
  value: string | null;
  /** The value as read, which this one replaces. */
  original: string | null;
  reason: string;
  correctedBy: string;
  correctedAt: string;
}

/** A held request as `heldItem` gives it: with its corrections and the fields the plugin lets a
 *  person correct (empty when it declares none). */
export interface PluginHeldItemView extends PluginHeldItem {
  corrections: PluginHeldCorrection[];
  correctable: string[];
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
      /** Records the request and returns. Fails with a sentence when the copy is not finished, a run is live, or a copy is not this plugin's.
       *  A stopped or failed run carries on from its last page, with its counts and held rows, unless `fromStart` is true, it reads
       *  other options or another reference, or a copy was read again since it began. The run it answers tells which: a run
       *  that carried on has requests already read. */
      start(input: { copyId: string; referenceCopyId: string | null; options: Record<string, string>; pageSize?: number; fromStart?: boolean }): Promise<PluginCheckRun>;
      list(): Promise<PluginCheckRun[]>;
      status(runId: string): Promise<PluginCheckRun | null>;
      stop(runId: string): Promise<PluginCheckRun>;
      /** `laboratory` is a code of 1 to 32 of A-Z a-z 0-9 . _ -; the host refuses any other. */
      held(input: { copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string; finding?: string; offset: number; limit: number }): Promise<{ rows: PluginHeldRow[]; total: number }>;
      /** Each finding code the plugin named for the held requests that match, with how many carry
       *  it, most first. `finding` on `held` and `heldItems` filters by one (a bare word). */
      heldCodes(input: { copyId: string; reason?: 'held' | 'error'; label?: string; laboratory?: string }): Promise<Array<{ code: string; count: number }>>;
      heldItem(input: { copyId: string; key: string }): Promise<PluginHeldItemView | null>;
      /** Stores corrections to a held request. `values` maps a field the plugin declares to its new
       *  value, null to clear it. Needs a reason. Fails with a sentence for any other field. */
      correct(input: { copyId: string; key: string; values: Record<string, string | null>; reason: string }): Promise<{ corrections: PluginHeldCorrection[] }>;
      /** Checks one corrected held request again, in the run that held it. Answers the run, queued.
       *  Read `heldItem` again once the run is no longer live: null means the request was saved. */
      recheck(input: { copyId: string; key: string }): Promise<PluginCheckRun>;
      /** The values a person may pick for each correctable field that has a fixed list, from the
       *  copy's dictionaries as the plugin reads them. A field with no list is not in the answer, and
       *  a plugin with no `choices` entrypoint answers an empty object. */
      choices(input: { copyId: string }): Promise<Record<string, Array<{ code: string; description: string }>>>;
      /** What this person may do: `full`, every tab; `correct`, correct held requests. */
      access(): Promise<{ full: boolean; correct: boolean }>;
      /** The same rows as `held`, in the same order, each with its findings and check. `limit` is 1 to 200.
       *  Give `after` to read by key, as an export should: null for the first page, then the `next` of the
       *  page before. `offset` is then ignored, and the answer adds `next`, the last key of the page or null
       *  when no row is left. A page read by key does not move while a check adds or removes rows. */
      heldItems(input: PluginHeldItemsInput): Promise<{ items: PluginHeldItem[]; total: number; next?: string | null }>;
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
