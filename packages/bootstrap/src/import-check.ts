import { MAX_SELF_RESUMES, takeBack } from './job-interruptions';
import { resolveByPerson } from './job-continue';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redact } from '@openldr/core';
import {
  CopySetTooLargeError, type Correction, type CopyRow, type HeldItem, type HeldItemsPage, type HeldReason, type HeldRow,
  type ImportCheckCorrectionStore, type ImportCheckHeldStore, type ImportCopyStore, type PluginDataStore, type Provenance,
} from '@openldr/db';
import { allowedResourceTypes, canCheck } from '@openldr/marketplace';
import { changedSets, copySetHashes, copySpecSchema, type CopyRun, type ImportCopyService } from './import-copy';
import {
  STALE_MS, StoppedWhileWaiting, auditOrRefuse, auditQuietly, checkResources, loadImportSink, loadImportSinkWaiting, optionsSchema,
  pluginCode, resolveImportPlugin, saveCode, type ImportActor, type ImportServiceDeps, type ResolvedPlugin,
} from './import-run';
import { growPage, retryWaitMs, shrinkPage } from './import-retry';
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN } from './import-sql';

// Checks a finished copy request by request (spec part 4, 5.1 and 5.4).
//
// It never reads the source database. It reads the copy on CE's own disk page by page, hands each
// page to the plugin's decode entrypoint, saves the FHIR resources of every request that passes
// through CE's normal save path, and keeps every held or failed request in the held-back store.
//
// It is driven as a copy is (import-copy.ts): a server process drives it (`tick`), writes the run
// every 30 seconds, and a run with no write for 2 minutes may be taken by the next `tick` in any
// process. Every write of the run is a compare-and-swap on its `rev`.
//
// CE reads `key`, `held`, `resources`, `error`, `label` and `laboratory` of a group, and nothing
// inside `findings` or `check`. Those two are kept as the plugin gave them, only in the held-back store,
// and so are `fields`, the values as read a person may correct (design 2026-11-18-held-corrections).
// No row value reaches a log, an audit row or an error text: a plugin's error is kept as a bare
// code, a save error as its code, and an error from CE's own database as its SQLSTATE.

const CHECKS = '__import-checks';
/** The set that is paged. Every other set of the source copy is a dictionary. */
const REQUESTS = 'requests';
/** The set a reference copy offers. */
const TWINS = 'twins';
const DEFAULT_PAGE_SIZE = 500;
const HEARTBEAT_MS = 30_000;
/** The most row JSON the dictionaries of one copy may hold, over every set. */
const DICTIONARY_CAP = 64 * 1024 * 1024;
const LABEL = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_LABELS = 12;
const OTHER_LABEL = 'other';
/** A laboratory code as a group may name it. Anything else is no laboratory. */
export const LABORATORY_CODE = /^[A-Za-z0-9._-]{1,32}$/;
/** The most distinct laboratory codes a run counts. Past that, a request counts under null. */
const MAX_LABORATORIES = 500;
/** A wait is slept in slices this long, so a stop or a release is felt within a second. */
const WAIT_SLICE_MS = 1000;
const SYSTEM: ImportActor = { type: 'system', id: null, name: 'system' };
/** Tries again of one page after a fault of CE's own database, before the run ends. */
const MAX_DB_RETRIES = 5;
/** The most twin keys the plugin may name for each key of a page. */
const MAX_TWINS_PER_KEY = 20;
/** Twin keys per read of the reference copy. */
const TWIN_READ_CHUNK = 500;

export type CheckStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed';

export interface CheckCounts { read: number; saved: number; held: number; failed: number; resources: number; labels: Record<string, number> }

/** The counts of one laboratory. `code` is null for the requests that named none, and for those
 *  past the 500th code. Counted with the run's counts, so the entries always add up to the run. */
/** How far a check got, as a cut's phase: a cut after more requests were read starts the count again. */
const cutPhase = (run: { counts: { read: number } }): string => String(run.counts.read);

export interface CheckLaboratory { code: string | null; counts: Pick<CheckCounts, 'read' | 'saved' | 'held' | 'failed' | 'labels'> }

export interface CheckRun {
  id: string;
  kind: 'check';
  /** 1 when the record is made. Every write adds 1, by compare-and-swap, as for a copy. */
  rev: number;
  pluginId: string;
  pluginVersion: string;
  copyId: string;
  referenceCopyId: string | null;
  status: CheckStatus;
  options: Record<string, string>;
  pageSize: number;
  /** The last key of the set `requests` done. The next page starts after it. */
  cursor: string | null;
  counts: CheckCounts;
  /** One entry for each laboratory code met, in the order first met. Empty at a start. Absent on a
   *  record written before laboratories were counted: such a run is driven on without them. */
  laboratories?: CheckLaboratory[];
  waiting: { since: string; attempt: number; error: string } | null;
  /** The id of the process driving it, or null when nobody does. */
  driver: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  startedBy: string;
  /** The `finishedAt` of the source copy and of the reference copy when the run began at the first
   *  key. A start carries on only while both copies still have these: a copy read again since then
   *  holds other rows. Absent on a record written before a check could carry on. */
  copyFinishedAt?: { source: string | null; reference: string | null };
  /** True when the last start carried on from where the run stopped or failed. False when it began
   *  at the first key. Absent on a record written before a check could carry on. */
  carriedOn?: boolean;
  /** Set while the run checks again only these held keys after a person corrected them (design
   *  2026-11-18-held-corrections). The run goes back to `returnTo` and `finishedAt` after. */
  recheck?: {
    keys: string[]; returnTo: CheckStatus; finishedAt: string | null;
    /** The keys already decided and counted, saved with the counts. A saved one's held row is
     *  removed only after that save, so a cut between the two only finishes the removal (re-review H3). */
    done?: Array<{ key: string; outcome: 'saved' | 'other' }>;
    /** Each key's counted decision as it stood when the recheck was queued: what the recheck takes
     *  away from the counts. Kept here, not read from the held row, which the recheck rewrites
     *  before its counts are saved (re-review H3). Codes only, no source value. */
    before?: Array<{ key: string; label: string | null; laboratory: string | null; pass: string | null }>;
  };
  /** Names one pass from the first key, carried on through a stop. A held row records the pass that
   *  counted it, so a recheck moves only this pass's counts (review H4). Absent on older records. */
  pass?: string;
}

export interface ImportCheckStartInput {
  pluginId: string;
  copyId: string;
  referenceCopyId: string | null;
  options: Record<string, string>;
  pageSize?: number;
  /** Begin at the first key with fresh counts, even when a stopped or failed run could carry on. */
  fromStart?: boolean;
  actor: ImportActor;
}

/** A page of the held list. Each filter given narrows it. */
export interface HeldFilter { reason?: HeldReason; label?: string; laboratory?: string; offset: number; limit: number }
/** A page of `heldItems`: by offset as `held`, or by key with `after` (a key, or null for the
 *  start). With `after`, `offset` is ignored and the answer adds `next`. */
export type HeldItemsFilter = Omit<HeldFilter, 'offset'> & ({ offset: number; after?: undefined } | { after: string | null; offset?: number });

export interface ImportCheckService {
  /** Plugins that can be checked. `needsReference`: the plugin names a twin-keys entrypoint. */
  checkers(): Promise<Array<{ id: string; version: string; needsReference: boolean }>>;
  start(input: ImportCheckStartInput): Promise<CheckRun>;
  get(pluginId: string, runId: string): Promise<CheckRun | null>;
  list(pluginId: string): Promise<CheckRun[]>;
  stop(pluginId: string, runId: string, actor: ImportActor): Promise<CheckRun>;
  held(pluginId: string, copyId: string, opts: HeldFilter): Promise<{ rows: HeldRow[]; total: number }>;
  /** A held request, with its corrections and the fields the plugin lets a person correct. */
  heldItem(pluginId: string, copyId: string, key: string): Promise<HeldItemView | null>;
  /** Stores corrections to a held request. Refuses a field the plugin does not declare, an empty
   *  reason, and a request that is not held by rules or check. */
  correct(input: ImportCheckCorrectInput): Promise<{ corrections: Correction[] }>;
  /** Checks one corrected held request again, in the run that held it. Refused while a check of
   *  the copy is live. Answers the run as queued; the driver does the rest. */
  recheck(input: { pluginId: string; copyId: string; key: string; actor: ImportActor }): Promise<CheckRun>;
  /** The same rows as `held`, in the same order, each with its findings and check. With `after`,
   *  read by key: the rows past that key, and `next`, the last key of the page or null when no row
   *  is left. A page read by key does not move when a check adds or removes rows before it. */
  heldItems(pluginId: string, copyId: string, opts: HeldItemsFilter): Promise<{ items: HeldItem[]; total: number; next?: string | null }>;
  /** Server only. Take every run that needs a driver and start driving it. Does not wait. */
  tick(): Promise<void>;
  /** Resolves when this process is driving nothing. */
  idle(): Promise<void>;
  /** Tell every drive here to let go at its next check, leaving the stored status for the next
   *  server. After this, `tick` takes nothing. */
  release(): Promise<void>;
}

export interface ImportCheckServiceDeps extends Pick<ImportServiceDeps, 'plugins' | 'pluginData' | 'audit' | 'persist' | 'now' | 'interruptions'> {
  /** The copy rows, read only. */
  copyStore: ImportCopyStore;
  held: ImportCheckHeldStore;
  /** Corrections people made to held requests. Without it no correction is read or written. */
  corrections?: ImportCheckCorrectionStore;
  /** To read a copy's record. A copy belongs to the plugin whose id it is read under. */
  copies: Pick<ImportCopyService, 'get'>;
  /** The connectors an admin allowed the plugin to read (`ImportService.allowed`), as the copy
   *  service has it. A check reads only copies of connectors the plugin may still read. */
  allowed(pluginId: string): Promise<string[]>;
  /** This process. Written on each run it drives. */
  driverId: string;
  /** Injectable for tests; the wait while CE's own database does not answer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ImportCheckCorrectInput {
  pluginId: string;
  copyId: string;
  key: string;
  /** Field to value. Null clears the field. */
  values: Record<string, string | null>;
  reason: string;
  actor: ImportActor;
}

/** A held request as the page reads it. */
export interface HeldItemView extends HeldItem {
  corrections: Correction[];
  /** The fields the plugin lets a person correct. Empty when it declares none. */
  correctable: string[];
}

/** The longest corrected value and reason a person may give. */
const CORRECTION_VALUE_MAX = 200;
const CORRECTION_REASON_MAX = 500;

interface Decided { outcome: 'saved' | 'held' | 'failed'; laboratory: string | null; label: string | undefined }
interface Tally { resources: number; decided: Decided[] }
const freshTally = (): Tally => ({ resources: 0, decided: [] });
/** Each request counts once in the run and once in its laboratory, under the same label name,
 *  so the laboratories always add up to the run. */
function addTallyTo(run: CheckRun, t: Tally): void {
  const c = run.counts;
  c.resources += t.resources;
  const labs = run.laboratories;
  const byCode = new Map((labs ?? []).map((l) => [l.code, l]));
  const entryFor = (code: string | null): CheckLaboratory => {
    const named = byCode.size - (byCode.has(null) ? 1 : 0);
    const at = code !== null && !byCode.has(code) && named >= MAX_LABORATORIES ? null : code;
    let entry = byCode.get(at);
    if (!entry) {
      entry = { code: at, counts: { read: 0, saved: 0, held: 0, failed: 0, labels: {} } };
      byCode.set(at, entry);
      labs!.push(entry);
    }
    return entry;
  };
  // Labels are counted in maps, never by name on a plain object: a label such as
  // `constructor` would read the object's own function. They go back as plain objects.
  const runLabels = new Map(Object.entries(c.labels));
  const labLabels = new Map<CheckLaboratory, Map<string, number>>();
  const labelsOf = (entry: CheckLaboratory): Map<string, number> => {
    let m = labLabels.get(entry);
    if (!m) { m = new Map(Object.entries(entry.counts.labels)); labLabels.set(entry, m); }
    return m;
  };
  const bump = (m: Map<string, number>, name: string): void => { m.set(name, (m.get(name) ?? 0) + 1); };
  for (const d of t.decided) {
    c.read += 1;
    c[d.outcome] += 1;
    let name: string | null = null;
    if (d.label !== undefined) {
      const named = runLabels.size - (runLabels.has(OTHER_LABEL) ? 1 : 0);
      name = validLabel(d.label) !== null && (runLabels.has(d.label) || named < MAX_LABELS) ? d.label : OTHER_LABEL;
      bump(runLabels, name);
    }
    if (!labs) continue;
    const entry = entryFor(d.laboratory);
    entry.counts.read += 1;
    entry.counts[d.outcome] += 1;
    if (name !== null) bump(labelsOf(entry), name);
  }
  // Object.fromEntries makes an own property of every name, even one a plain object has.
  c.labels = Object.fromEntries(runLabels);
  for (const [entry, m] of labLabels) entry.counts.labels = Object.fromEntries(m);
}
/** Takes back what `addTally` added for these decisions: a recheck decides a key again. */
function subtractTallyFrom(run: CheckRun, old: Decided[]): void {
  const c = run.counts;
  const drop = (labels: Record<string, number>, name: string | undefined): Record<string, number> => {
    if (name === undefined) return labels;
    const m = new Map(Object.entries(labels));
    const at = m.has(name) ? name : OTHER_LABEL;
    const n = (m.get(at) ?? 0) - 1;
    if (n > 0) m.set(at, n); else m.delete(at);
    return Object.fromEntries(m);
  };
  for (const d of old) {
    c.read -= 1;
    c[d.outcome] -= 1;
    c.labels = drop(c.labels, d.label);
    const entry = run.laboratories?.find((l) => l.code === d.laboratory) ?? run.laboratories?.find((l) => l.code === null);
    if (!entry) continue;
    entry.counts.read -= 1;
    entry.counts[d.outcome] -= 1;
    entry.counts.labels = drop(entry.counts.labels, d.label);
  }
}

/** One check per source copy: the first 32 hex characters of SHA-256 of `check|<copyId>`. */
export function checkIdOf(copyId: string): string {
  return createHash('sha256').update(`check|${copyId}`).digest('hex').slice(0, 32);
}

const groupSchema = z.object({
  key: z.string(),
  held: z.boolean().optional(),
  findings: z.unknown().optional(),
  check: z.unknown().optional(),
  resources: z.array(z.unknown()).optional(),
  error: z.string().optional(),
  label: z.string().optional(),
  // Read with care in `validLaboratory`: a bad one is no laboratory, never a bad answer.
  laboratory: z.unknown().optional(),
  // The values as read of the correctable fields. Read with care in `validFields`.
  fields: z.unknown().optional(),
});
const decodeOutputSchema = z.object({ groups: z.array(groupSchema) });
const twinKeysOutputSchema = z.object({ keys: z.array(z.string()) });
type Group = z.infer<typeof groupSchema>;

/** A failure of CE's own database. Only the SQLSTATE code is kept: the rest can quote a row. */
class OwnDbFault extends Error {}
/** A failure whose fixed text is kept as it is, with no value in it. */
class CheckFault extends Error {}
/** The plugin's decode or twin-keys call threw, timed out, or gave what is not its schema. Its
 *  message is a fixed sentence for the class of the failure, never the plugin's text. */
class PluginCallFault extends Error {}

function sqlState(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
}

async function ownDb<T>(kind: 'read' | 'write', work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof OwnDbFault || err instanceof CheckFault) throw err;
    throw new OwnDbFault(kind === 'write'
      ? `OpenLDR's own database refused a write (${sqlState(err)})`
      : `OpenLDR's own database failed a read (${sqlState(err)})`);
  }
}

/** Rows of a page as the copy stored them, by detail name. Every declared detail is present, as
 *  an empty list when the page has no row of it. */
function byDetail(rows: CopyRow[], declared: string[]): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(declared.map((n) => [n, []]));
  for (const r of rows) (out[r.detail] ??= []).push(r.row);
  return out;
}

/** A NUL, or half of a surrogate pair standing alone. Postgres jsonb refuses both. */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** The plugin's JSON with every NUL and lone surrogate, in a string or a key, replaced by U+FFFD. */
function storable(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(UNSTORABLE, '\uFFFD');
  if (Array.isArray(value)) return value.map(storable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(UNSTORABLE, '\uFFFD'), storable(v)]));
  }
  return value;
}

type Sink = { invoke(entrypoint: string, input: unknown): Promise<unknown> };

/**
 * The sets the plugin names for a copy, with each set's detail names. Asked of the plugin's copy
 * entrypoint with that copy's own options. A set with no detail queries has one detail, named
 * after the set, as the copy files it. The answer must be the statements the copy was made from:
 * a plugin upgraded since then could name a detail the copy never read, and the check would hand
 * it as an empty list, so a request could be saved without its data.
 */
async function declaredSets(sink: Sink, plugin: Checker, copy: CopyRun): Promise<Map<string, string[]>> {
  let raw: unknown;
  try {
    raw = await sink.invoke(plugin.source.entrypoints.copy!, { options: copy.options });
  } catch {
    throw new CheckFault(`the plugin's copy entrypoint failed, so the check cannot tell what copy ${copy.id} holds`);
  }
  const parsed = copySpecSchema.safeParse(raw);
  if (!parsed.success) throw new CheckFault(`the plugin's copy entrypoint gave an answer that is not valid for copy ${copy.id}`);
  if (changedSets(copy.setSql ?? {}, copySetHashes(parsed.data.sets)).length > 0) {
    throw new CheckFault(`the plugin's copy statements changed since copy ${copy.id} was made; read the copy again, then start the check`);
  }
  return new Map(parsed.data.sets.map((s) => [s.name, s.detailQueries.length > 0 ? s.detailQueries.map((q) => q.name) : [s.name]]));
}

/** The status of a live check that reads this copy, as its source or its reference, or null. For
 *  the copy service, which refuses a start or a remove of such a copy. */
export async function liveCheckStatus(pluginData: PluginDataStore, pluginId: string, copyId: string): Promise<CheckStatus | null> {
  for (const e of await pluginData.list(pluginId, CHECKS)) {
    const run = e.doc as CheckRun;
    if (isLive(run.status) && (run.copyId === copyId || run.referenceCopyId === copyId)) return run.status;
  }
  return null;
}
/** Delete the check record whose source is this copy. For the copy service, when it removes the
 *  copy, after the held rows. */
export async function deleteCheckRecord(pluginData: PluginDataStore, pluginId: string, copyId: string): Promise<void> {
  await pluginData.delete(pluginId, CHECKS, checkIdOf(copyId));
}
const emptyTwins = (): Record<string, Array<Record<string, unknown>>> => ({ requests: [], results: [] });
const freshCounts = (): CheckCounts => ({ read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} });
/** A check in one of these statuses still adds and removes held rows. */
export const isLiveCheck = (s: CheckStatus): boolean => s === 'queued' || s === 'running' || s === 'waiting' || s === 'stopping';
const isLive = isLiveCheck;
/** The same names with the same values, in any order. */
function sameOptions(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}
/** Fixed. The copy id is CE's own, never a source value. */
const notAllowed = (copyId: string): string =>
  `the plugin is no longer allowed to read the connector of copy ${copyId}`;
/** Statuses a driver holds. A run in one of them with no write for 2 minutes has no driver. */
const isDriven = (s: CheckStatus): boolean => s === 'running' || s === 'waiting' || s === 'stopping';
const validLabel = (label: string | undefined): string | null => (label !== undefined && LABEL.test(label) ? label : null);
/** The code of a group's `laboratory: { code }`, or null for anything else. */
/** The values as read a held group sent: an object of short texts or nulls, else none. */
function validFields(raw: unknown, declared: string[]): Record<string, string | null> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || declared.length === 0) return null;
  const out: Record<string, string | null> = {};
  // Only the fields this request sent: a source kind may not have them all (review H2).
  for (const name of declared) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const v = (raw as Record<string, unknown>)[name];
    if (v === null) out[name] = null;
    else if (typeof v === 'string') out[name] = storable(v.slice(0, CORRECTION_VALUE_MAX)) as string;
  }
  return out;
}

/** The fields a plugin lets a person correct. */
function correctableOf(plugin: { source: { corrections?: { fields: string[] } } }): string[] {
  return plugin.source.corrections?.fields ?? [];
}

function validLaboratory(raw: unknown): string | null {
  const code = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { code?: unknown }).code : undefined;
  return typeof code === 'string' && LABORATORY_CODE.test(code) ? code : null;
}

/** The run with these laboratories, or with no `laboratories` field when there are none to keep. */
function withLaboratories(run: CheckRun, laboratories: CheckLaboratory[] | undefined): CheckRun {
  const { laboratories: _old, ...rest } = run;
  return laboratories ? { ...rest, laboratories } : rest;
}

type Halt = 'stop' | 'release' | 'lost';
interface Drive { promise: Promise<void>; halt: Halt | null }
type CheckOutcome = 'completed' | 'stopped' | 'failed' | 'release' | 'lost';
type Checker = ResolvedPlugin & { decode: string; twinKeys: string | null };

export function createImportCheckService(deps: ImportCheckServiceDeps): ImportCheckService {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const local = new Map<string, Drive>();
  let released = false;
  let ticking: Promise<void> | null = null;

  const readRun = async (pluginId: string, runId: string): Promise<CheckRun | null> =>
    (await ownDb('read', () => deps.pluginData.get(pluginId, CHECKS, runId))) as CheckRun | null;
  const listRuns = async (pluginId: string): Promise<CheckRun[]> =>
    (await ownDb('read', () => deps.pluginData.list(pluginId, CHECKS))).map((e) => e.doc as CheckRun);
  /** The only way a check record is written: only when the stored rev is `expected`, or when there
   *  is no record and `expected` is null. Sets `rev` and `updatedAt` on success. */
  async function writeIfRev(run: CheckRun, expected: number | null): Promise<boolean> {
    const doc: CheckRun = { ...run, rev: (expected ?? 0) + 1, updatedAt: now().toISOString() };
    const wrote = await ownDb('write', () => deps.pluginData.putIfRev(run.pluginId, CHECKS, run.id, doc, expected));
    if (wrote) { run.rev = doc.rev; run.updatedAt = doc.updatedAt; }
    return wrote;
  }
  /** `start` and `stop`: read, decide, write by compare-and-swap, up to 3 times, as a copy does. */
  async function changeRun(
    pluginId: string,
    runId: string,
    decide: (stored: CheckRun | null) => Promise<CheckRun>,
    before?: (next: CheckRun) => Promise<void>,
  ): Promise<CheckRun> {
    let beforeDone = false;
    for (let tries = 0; tries < 3; tries++) {
      const stored = await readRun(pluginId, runId);
      const next = await decide(stored);
      if (before && !beforeDone) { await before(next); beforeDone = true; }
      if (await writeIfRev(next, stored ? stored.rev : null)) return view(next);
    }
    throw new Error('the check changed at the same moment; try again');
  }

  function view(stored: CheckRun): CheckRun {
    return withLaboratories({
      ...stored, counts: { ...stored.counts, labels: { ...stored.counts.labels } },
      waiting: stored.waiting ?? null, driver: stored.driver ?? null,
    }, stored.laboratories && structuredClone(stored.laboratories));
  }

  async function resolveChecker(pluginId: string): Promise<Checker> {
    const plugin = await resolveImportPlugin(deps.plugins, pluginId, 'read');
    const decode = plugin.source.entrypoints.decode;
    if (!canCheck(plugin.source) || decode === undefined) {
      throw new Error(`plugin ${pluginId} cannot be checked: it names no decode entrypoint`);
    }
    return { ...plugin, decode, twinKeys: plugin.source.entrypoints.twinKeys ?? null };
  }

  /** The copy's record, checked to be this plugin's and completed. */
  async function completedCopy(pluginId: string, copyId: string): Promise<CopyRun> {
    const copy = await ownDb('read', () => deps.copies.get(pluginId, copyId));
    if (!copy) throw new CheckFault(`copy ${copyId} not found`);
    if (copy.status !== 'completed') throw new CheckFault(`copy ${copyId} is ${copy.status}; a check needs a completed copy`);
    return copy;
  }

  /** Refuses a copy whose connector the plugin may no longer read. One read of the allow list. */
  async function assertAllowed(pluginId: string, copies: CopyRun[]): Promise<void> {
    const allowed = new Set(await ownDb('read', () => deps.allowed(pluginId)));
    for (const copy of copies) if (!allowed.has(copy.connectorId)) throw new CheckFault(notAllowed(copy.id));
  }

  /** Writing, heartbeat and halting. A copy of the copy service's own, with no delete. */
  function driving(run: CheckRun, entry: Drive) {
    // The cursor and counts as they stood at the last page end. Only these are ever saved, so a
    // crash in the middle of a page leaves a record from which that page is read again in full.
    const snapshot = () => ({ cursor: run.cursor, counts: structuredClone(run.counts), laboratories: structuredClone(run.laboratories) });
    let pageEnd = snapshot();
    const markPageEnd = (): void => { pageEnd = snapshot(); };

    async function haltWanted(): Promise<Halt | null> {
      if (entry.halt) return entry.halt;
      const stored = await readRun(run.pluginId, run.id);
      if (!stored || stored.driver !== deps.driverId) entry.halt = 'lost';
      else if (stored.status === 'stopping') entry.halt = 'stop';
      return entry.halt;
    }

    /** Write the run as it stood at the last page end, by compare-and-swap on the rev this drive
     *  last wrote. On a refusal: another driver or no record, and this drive is lost; a stop, and
     *  it is obeyed. False, and nothing written, once lost. */
    const casSave = async (): Promise<boolean> => {
      for (let tries = 0; tries < 5; tries++) {
        if (entry.halt === 'lost') return false;
        const doc: CheckRun = withLaboratories({ ...run, cursor: pageEnd.cursor, counts: structuredClone(pageEnd.counts) }, pageEnd.laboratories);
        if (await writeIfRev(doc, run.rev)) {
          run.rev = doc.rev;
          run.updatedAt = doc.updatedAt;
          return true;
        }
        const stored = await readRun(run.pluginId, run.id);
        if (!stored || stored.driver !== deps.driverId) {
          entry.halt = 'lost';
          return false;
        }
        if (stored.status === 'stopping') {
          entry.halt ??= 'stop';
          if (run.status === 'running' || run.status === 'waiting') run.status = 'stopping';
        }
        run.rev = stored.rev;
      }
      entry.halt = 'lost';
      return false;
    };
    let saving: Promise<unknown> = Promise.resolve();
    const saveInTurn = (): Promise<boolean> => {
      const next = saving.then(casSave);
      saving = next.catch(() => {});
      return next;
    };
    const saveKeepingStop = async (): Promise<boolean> => {
      if (entry.halt === 'stop' && (run.status === 'running' || run.status === 'waiting')) run.status = 'stopping';
      return saveInTurn();
    };
    let beating: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      beating ??= saveKeepingStop().then(() => {}, () => {}).finally(() => { beating = null; });
    }, HEARTBEAT_MS);
    const stopBeating = async (): Promise<void> => {
      clearInterval(heartbeat);
      await beating;
    };
    const rewind = (): void => {
      run.cursor = pageEnd.cursor;
      run.counts = structuredClone(pageEnd.counts);
      if (pageEnd.laboratories) run.laboratories = structuredClone(pageEnd.laboratories);
    };
    return { markPageEnd, haltWanted, saveInTurn, saveKeepingStop, stopBeating, rewind };
  }

  const haltOutcome = (halt: Halt | null): CheckOutcome => (halt === 'release' ? 'release' : halt === 'lost' ? 'lost' : 'stopped');

  async function driveCheck(run: CheckRun, entry: Drive): Promise<void> {
    const d = driving(run, entry);
    let outcome: CheckOutcome = 'failed';

    const body = async (): Promise<CheckOutcome> => {
      if (run.status === 'stopping') return 'stopped';

      let waitingSince: string | null = null;
      const onWaiting = async (state: { attempt: number; error: string } | null): Promise<void> => {
        if (state) {
          if (state.attempt === 1 || waitingSince === null) waitingSince = now().toISOString();
          run.status = 'waiting';
          run.waiting = { since: waitingSince, attempt: state.attempt, error: state.error };
        } else {
          run.status = 'running';
          run.waiting = null;
        }
        await d.saveKeepingStop();
      };
      const stopWanted = async (): Promise<boolean> => (await d.haltWanted()) !== null;

      const plugin = await resolveChecker(run.pluginId);
      const sink = await loadImportSinkWaiting(deps.plugins, plugin, { onWaiting, stopWanted, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
      const allowedTypes = new Set(allowedResourceTypes(plugin.capabilities));
      const provenance: Provenance = {
        batchId: run.id, pluginId: plugin.id, pluginVersion: plugin.version,
        sourceSystem: plugin.source.sourceSystem ?? plugin.id,
      };
      const useTwins = plugin.twinKeys !== null && run.referenceCopyId !== null;
      /** The fields the plugin lets a person correct. None: no correction is read or sent. */
      const correctable = correctableOf(plugin);
      /** A recheck reads its keys once, then is done. */
      let recheckRead = false;
      /** Times a recheck found its done mark not yet stored. */
      let unsavedTries = 0;

      /** A plugin call. A throw or a bad answer is a PluginCallFault with a fixed sentence. Only
       *  the runtime's own timeout is told apart from a refusal; the plugin's text is never kept. */
      const callPlugin = async <T>(what: string, entrypoint: string, input: unknown, schema: z.ZodType<T>): Promise<T> => {
        let raw: unknown;
        try {
          raw = await sink.invoke(entrypoint, input);
        } catch (err) {
          const timedOut = err instanceof Error && /timed out/i.test(err.message);
          throw new PluginCallFault(timedOut ? `the plugin's ${what} call timed out` : `the plugin refused the ${what} call`);
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new PluginCallFault(`the plugin's ${what} answer was not valid`);
        return parsed.data;
      };

      const declared = (copy: CopyRun): Promise<Map<string, string[]>> => declaredSets(sink, plugin, copy);
      const detailsOf = (sets: Map<string, string[]>, set: string, copyId: string): string[] => {
        const names = sets.get(set);
        if (!names) throw new CheckFault(`the plugin no longer names the set ${set} for copy ${copyId}`);
        return names;
      };

      /** Every set the plugin names for the source copy but `requests`, read whole, by set name.
       *  A set with no row is handed as an empty list. */
      const readDictionaries = async (names: string[]): Promise<Record<string, Array<Record<string, unknown>>>> => {
        const out: Record<string, Array<Record<string, unknown>>> = {};
        let used = 0;
        for (const name of names) {
          let rows: CopyRow[];
          try {
            rows = await deps.copyStore.readSet(run.copyId, name, DICTIONARY_CAP - used);
          } catch (err) {
            // Built from the count where the read stopped, never from a row, and never named the
            // set's size: the read stops early.
            if (err instanceof CopySetTooLargeError) {
              throw new CheckFault(`the dictionaries of copy ${run.copyId} hold more than ${used + err.bytes} bytes of rows; the limit is ${DICTIONARY_CAP} bytes`);
            }
            throw new OwnDbFault(`OpenLDR's own database failed a read (${sqlState(err)})`);
          }
          for (const r of rows) used += Buffer.byteLength(JSON.stringify(r.row), 'utf8');
          out[name] = rows.map((r) => r.row);
        }
        return out;
      };

      /** What one drive learns once: the copies as they stood, the detail names, the dictionaries. */
      interface Prepared {
        source: CopyRun;
        reference: CopyRun | null;
        requestDetails: string[];
        twinDetails: string[];
        dictionaries: Record<string, Array<Record<string, unknown>>>;
      }
      const prepare = async (): Promise<Prepared> => {
        const source = await completedCopy(run.pluginId, run.copyId);
        const reference = run.referenceCopyId !== null ? await completedCopy(run.pluginId, run.referenceCopyId) : null;
        const sourceSets = await declared(source);
        const requestDetails = detailsOf(sourceSets, REQUESTS, source.id);
        const referenceSets = reference ? await declared(reference) : null;
        const twinDetails = useTwins && referenceSets && reference ? detailsOf(referenceSets, TWINS, reference.id) : [];
        const dictionaries = await readDictionaries([...sourceSets.keys()].filter((n) => n !== REQUESTS));
        return { source, reference, requestDetails, twinDetails, dictionaries };
      };
      /** A copy that is not as it was when the drive began: a check must not go on reading it. */
      const assertUnchanged = async (was: CopyRun): Promise<void> => {
        const now = await ownDb('read', () => deps.copies.get(run.pluginId, was.id));
        if (!now || now.status !== 'completed' || now.finishedAt !== was.finishedAt) {
          throw new CheckFault(`copy ${was.id} changed while the check was reading it; start the check again once the copy has completed`);
        }
      };

      /** The reference rows for a page, by detail, or empty twins when there is no reference. */
      const readTwins = async (keys: string[], details: string[]): Promise<Record<string, Array<Record<string, unknown>>>> => {
        if (!useTwins) return emptyTwins();
        const answer = await callPlugin('twin-keys', plugin.twinKeys!, { options: run.options, keys }, twinKeysOutputSchema);
        const wanted = [...new Set(answer.keys)];
        if (wanted.length > MAX_TWINS_PER_KEY * keys.length) throw new PluginCallFault("the plugin's twin-keys answer was not valid");
        const rows: CopyRow[] = [];
        for (let i = 0; i < wanted.length; i += TWIN_READ_CHUNK) {
          const chunk = wanted.slice(i, i + TWIN_READ_CHUNK);
          rows.push(...await ownDb('read', () => deps.copyStore.read(run.referenceCopyId!, TWINS, chunk)));
        }
        return { ...emptyTwins(), ...byDetail(rows, details) };
      };

      /** What one page did: how each request ended, with its laboratory and the label it gave.
       *  Added to the run's counts only when the page is done, so a page tried again after a fault
       *  counts nothing twice. */
      const addTally = (t: Tally): void => addTallyTo(run, t);
      const subtractTally = (old: Decided[]): void => subtractTallyFrom(run, old);
      const keepFailed = async (key: string, error: string, label: string | null, laboratory: string | null): Promise<void> => {
        await ownDb('write', () => deps.held.put({
          copyId: run.copyId, key, runId: run.id, reason: 'error', label, laboratory, error, findings: null, check: null,
        }));
      };

      let prepared: Prepared | null = null;
      // A page the plugin could not decode is halved, and doubles again after 5 good pages in a
      // row, never above the run's own page size.
      let size = run.pageSize;
      let goodInRow = 0;

      /** One page. 'done' when the set `requests` has no key left. */
      const onePage = async (p: Prepared): Promise<'done' | 'next' | 'lost'> => {
        // Asked before every page, so a revoke ends the run before it saves anything more.
        await assertAllowed(run.pluginId, p.reference ? [p.source, p.reference] : [p.source]);
        await assertUnchanged(p.source);
        if (p.reference) await assertUnchanged(p.reference);
        const rechecking = run.recheck !== undefined;
        if (rechecking && recheckRead) return 'done';
        // A recheck decides and counts each key once. Its decisions are saved with the counts; only
        // then does a saved key leave the held list. A key already decided only finishes that removal
        // (review H3, re-review H3).
        const done = new Map((run.recheck?.done ?? []).map((d) => [d.key, d.outcome]));
        if (rechecking && done.size > 0) {
          // Only what the stored run already says is done: an in-memory mark whose save failed does not
          // count, so the page end is saved again first (re-review H3, writes).
          const stored = await ownDb('read', () => readRun(run.pluginId, run.id));
          const durable = new Map((stored?.recheck?.done ?? []).map((d) => [d.key, d.outcome]));
          if ([...done].some(([k, o]) => durable.get(k) !== o)) {
            unsavedTries += 1;
            if (unsavedTries > MAX_DB_RETRIES) throw new CheckFault('the recheck could not save its counts, so the check stopped');
            return 'next';
          }
          const savedKeys = [...done].filter(([, o]) => o === 'saved').map(([k]) => k);
          if (savedKeys.length > 0) await ownDb('write', () => deps.held.remove(run.copyId, savedKeys));
          recheckRead = true;
          return 'done';
        }
        const before = rechecking
          ? (await Promise.all(run.recheck!.keys.map((k) => ownDb('read', () => deps.held.get(run.copyId, k))))).filter((h): h is HeldItem => h !== null)
          : [];
        // The decision each key was counted with, as recorded when the recheck was queued; a record
        // from before that was kept falls back to the held row.
        const counted0 = new Map((run.recheck?.before ?? []).map((b) => [b.key, b]));
        const decided = before.map((h) => counted0.get(h.key) ?? { key: h.key, label: h.label, laboratory: h.laboratory, pass: h.pass });
        const passOf = new Map(decided.map((d) => [d.key, d.pass]));
        const keys = rechecking
          ? before.map((h) => h.key)
          : await ownDb('read', () => deps.copyStore.listKeys(run.copyId, REQUESTS, run.cursor, size));
        if (keys.length === 0) return 'done';
        // The corrections of the page's keys, sent only to a plugin that declares correctable fields.
        const stored = correctable.length > 0 && deps.corrections
          ? await ownDb('read', () => deps.corrections!.listFor(run.copyId, keys))
          : new Map<string, Correction[]>();
        const corrections = stored.size === 0 ? undefined : Object.fromEntries([...stored].map(([k, list]) => [k, list.map((c) => ({
          field: c.field, value: c.value, original: c.original, reason: c.reason, by: c.correctedBy, at: c.correctedAt,
        }))]));
        const rows = byDetail(await ownDb('read', () => deps.copyStore.read(run.copyId, REQUESTS, keys)), p.requestDetails);

        let groups: Map<string, Group> | null = null;
        /** Keys the plugin gave more than one group. */
        const twice = new Set<string>();
        let fault: PluginCallFault | null = null;
        try {
          const twins = await readTwins(keys, p.twinDetails);
          const answer = await callPlugin('decode', plugin.decode, {
            options: run.options, now: now().toISOString(), dictionaries: p.dictionaries, keys, rows, twins,
            ...(corrections ? { corrections } : {}),
          }, decodeOutputSchema);
          groups = new Map();
          for (const g of answer.groups) {
            if (groups.has(g.key)) twice.add(g.key);
            else groups.set(g.key, g);
          }
        } catch (err) {
          if (!(err instanceof PluginCallFault)) throw err;
          fault = err;
        }
        // Another process may hold the run now. Then nothing of this page is written.
        if ((await d.haltWanted()) === 'lost') return 'lost';

        const t = freshTally();
        if (groups === null) {
          // Shown on the run, so a person can see why. Cleared by the next good page.
          run.lastError = fault?.message ?? null;
          // Nothing of the page is saved. Halve it and read the same cursor again.
          if (keys.length > 1) {
            size = shrinkPage(keys.length);
            goodInRow = 0;
            return 'next';
          }
          // A recheck that the plugin could not decode leaves the request held as it was.
          if (rechecking) { recheckRead = true; return 'next'; }
          await keepFailed(keys[0], 'DECODE_FAILED', null, null);
          t.decided.push({ outcome: 'failed', laboratory: null, label: undefined });
          addTally(t);
          run.cursor = keys[0];
          size = 1;
          goodInRow = 0;
          return 'next';
        }
        run.lastError = null;
        goodInRow += 1;
        const grown = growPage(size, run.pageSize, goodInRow);
        if (grown !== size) { size = grown; goodInRow = 0; }

        const saved: string[] = [];
        for (const key of keys) {
          const group = groups.get(key);
          if (!group || twice.has(key)) {
            // No answer, or two answers for one request: neither is trusted, and nothing of it is saved.
            await keepFailed(key, group ? 'DUPLICATE_GROUP' : 'NO_GROUP', null, null);
            t.decided.push({ outcome: 'failed', laboratory: null, label: undefined });
            continue;
          }
          const label = validLabel(group.label);
          const laboratory = validLaboratory(group.laboratory);
          const decided = (outcome: Decided['outcome']): void => { t.decided.push({ outcome, laboratory, label: group.label }); };
          if (group.error !== undefined) { await keepFailed(key, pluginCode(group.error), label, laboratory); decided('failed'); continue; }
          if (group.held === true) {
            await ownDb('write', () => deps.held.put({
              copyId: run.copyId, key, runId: run.id, reason: 'held', label, laboratory, error: null,
              // The store needs a value. A group that gave none is kept as null. Postgres jsonb
              // refuses a NUL or a lone surrogate, so those are replaced.
              findings: storable(group.findings ?? null), check: storable(group.check ?? null),
              fields: validFields(group.fields, correctable),
              // A recheck keeps the pass that first held it, so its count stays where it was made (re-review H4).
              pass: rechecking ? passOf.get(key) ?? null : run.pass ?? null,
            }));
            decided('held');
            continue;
          }
          const resources = group.resources ?? [];
          const refused = checkResources(resources, allowedTypes);
          if (refused) { await keepFailed(key, refused, label, laboratory); decided('failed'); continue; }
          try {
            await deps.persist(resources, provenance);
          } catch (err) {
            await keepFailed(key, saveCode(err), label, laboratory);
            decided('failed');
            continue;
          }
          saved.push(key);
          decided('saved');
          t.resources += resources.length;
        }
        // A request that passes now leaves the held-back store. In a recheck that waits for the counts
        // to be saved first (re-review H3).
        if (saved.length > 0 && !rechecking) await ownDb('write', () => deps.held.remove(run.copyId, saved));
        if (rechecking) {
          // A key held in this pass was counted as held: take that away and count what it is now. A
          // key held by an earlier pass is not in this pass's counts, so they stay as they are (review H4).
          const counted = decided.every((d) => d.pass !== null && d.pass === run.pass);
          if (counted && run.pass !== undefined) {
            subtractTally(decided.map((d) => ({ outcome: 'held' as const, laboratory: d.laboratory, label: d.label ?? undefined })));
            addTally(t);
          }
          // Saved with the counts at the page end; the next call removes the saved keys' held rows.
          run.recheck = { ...run.recheck!, done: keys.map((k) => ({ key: k, outcome: saved.includes(k) ? 'saved' as const : 'other' as const })) };
          return 'next';
        }
        addTally(t);
        run.cursor = keys[keys.length - 1];
        return 'next';
      };

      /** Tries in a row that CE's own database refused, on one page. */
      let dbAttempt = 0;
      for (;;) {
        if (entry.halt) return haltOutcome(entry.halt);
        let step: 'done' | 'next' | 'lost';
        try {
          prepared ??= await prepare();
          step = await onePage(prepared);
          if (step === 'next') {
            if (dbAttempt > 0 && run.status === 'waiting') {
              run.status = 'running';
              run.waiting = null;
            }
            dbAttempt = 0;
            d.markPageEnd();
            if (!(await d.saveKeepingStop())) step = 'lost';
          }
        } catch (err) {
          if (!(err instanceof OwnDbFault)) throw err;
          // CE's own database did not answer. Put the page back, wait, and read it again. A fault
          // the same page meets on every try cannot pass, so after 5 tries again the run ends.
          d.rewind();
          dbAttempt += 1;
          if (dbAttempt > MAX_DB_RETRIES) {
            throw new CheckFault(`${err.message} on ${dbAttempt} tries of one page in a row, so the check stopped`);
          }
          await onWaiting({ attempt: dbAttempt, error: err.message }).catch(() => false);
          for (let left = retryWaitMs(dbAttempt); left > 0; left -= WAIT_SLICE_MS) {
            const halt = await d.haltWanted().catch(() => entry.halt);
            if (halt) return haltOutcome(halt);
            await sleep(Math.min(WAIT_SLICE_MS, left));
          }
          continue;
        }
        if (step === 'lost') return 'lost';
        if (step === 'done') return 'completed';
      }
    };

    try {
      outcome = await body();
    } catch (err) {
      if (err instanceof StoppedWhileWaiting) {
        outcome = haltOutcome(entry.halt);
      } else {
        outcome = 'failed';
        run.lastError = err instanceof CheckFault || err instanceof OwnDbFault
          ? err.message
          : redact(err instanceof Error ? err.message : String(err)).slice(0, 300);
      }
    } finally {
      await d.stopBeating();
    }
    await finishDrive(run, d, outcome);
  }

  /** Brings the counts of a run whose recheck did not finish in line with its held rows. For each key
   *  whose counts were not yet moved (no stored done mark) and that this pass counted, a held row
   *  rewritten since the recheck was queued replaces the decision recorded then (re-review H3). */
  async function settleRecheck(run: CheckRun): Promise<void> {
    const rc = run.recheck;
    if (!rc || run.pass === undefined) return;
    const done = new Set((rc.done ?? []).map((x) => x.key));
    for (const b of rc.before ?? []) {
      if (done.has(b.key) || b.pass === null || b.pass !== run.pass) continue;
      const row = await ownDb('read', () => deps.held.get(run.copyId, b.key));
      // A row the recheck kept failing to read is an error row: it counts as failed (re-review H3, A).
      const outcome = row?.reason === 'error' ? 'failed' as const : 'held' as const;
      if (!row || (outcome === 'held' && row.label === b.label && row.laboratory === b.laboratory)) continue;
      subtractTallyFrom(run, [{ outcome: 'held', laboratory: b.laboratory, label: b.label ?? undefined }]);
      addTallyTo(run, { resources: 0, decided: [{ outcome, laboratory: row.laboratory, label: row.label ?? undefined }] });
    }
  }

  async function finishDrive(run: CheckRun, d: ReturnType<typeof driving>, outcome: CheckOutcome): Promise<void> {
    d.rewind();
    if (outcome === 'lost') return;
    if (outcome === 'release') {
      await d.saveInTurn().catch(() => false);
      return;
    }
    const recheck = run.recheck;
    if (recheck && outcome !== 'completed') {
      // A recheck that did not complete keeps only what is stored: its counts and done marks, settled
      // against its held rows. If that cannot be read, the run is left as a cut leaves it, for the
      // next driver to take over from what is stored (re-review H3, B).
      try {
        const stored = await readRun(run.pluginId, run.id);
        if (!stored) return;
        run.counts = stored.counts;
        run.laboratories = stored.laboratories;
        run.recheck = stored.recheck;
        await settleRecheck(run);
        d.markPageEnd();
      } catch {
        return;
      }
    }
    // A removal the stored run marks done but that did not happen is done now; if it fails again the
    // recheck stays on the run, and the next recheck finishes it first.
    const pendingRemoval = (run.recheck?.done ?? []).filter((x) => x.outcome === 'saved').map((x) => x.key);
    let removed = true;
    if (recheck && pendingRemoval.length > 0) {
      removed = await deps.held.remove(run.copyId, pendingRemoval).then(() => true, () => false);
    }
    run.status = recheck ? recheck.returnTo : outcome;
    run.waiting = null;
    run.driver = null;
    run.finishedAt = recheck ? recheck.finishedAt : now().toISOString();
    if (removed) delete run.recheck;
    if (!(await d.saveInTurn().catch(() => true))) return;
    if (recheck) {
      await auditQuietly(deps.audit, {
        action: 'import.check.recheck', pluginId: run.pluginId, runId: run.id, actor: SYSTEM,
        metadata: { status: outcome, copyId: run.copyId, keys: recheck.keys.length },
      });
      return;
    }
    const { read, saved, held, failed, resources } = run.counts;
    await auditQuietly(deps.audit, {
      action: 'import.check.finish', pluginId: run.pluginId, runId: run.id, actor: SYSTEM,
      metadata: { status: outcome, copyId: run.copyId, read, saved, held, failed, resources },
    });
  }

  async function takeWork(): Promise<void> {
    for (const row of await deps.plugins.list()) {
      for (const stored of await listRuns(row.id)) {
        if (released) return;
        if (local.has(stored.id)) continue;
        const unclaimed = stored.status === 'queued';
        const orphaned = isDriven(stored.status) && now().getTime() - Date.parse(stored.updatedAt) > STALE_MS;
        if (!unclaimed && !orphaned) continue;
        const claim = async (): Promise<boolean> => {
          const previous = stored.driver ?? null;
          const run: CheckRun = {
            ...stored, driver: deps.driverId, waiting: null,
            status: stored.status === 'queued' || stored.status === 'waiting' ? 'running' : stored.status,
          };
          if (!(await writeIfRev(run, stored.rev))) return false;
          if (released) return true;
          if (!unclaimed && previous !== null && previous !== deps.driverId) {
            await auditQuietly(deps.audit, {
              action: 'import.check.takeover', pluginId: run.pluginId, runId: run.id, actor: SYSTEM, metadata: { status: stored.status },
            });
          }
          launch(run);
          return true;
        };
        if (unclaimed || !deps.interruptions) {
          await claim();
          if (released) return;
          continue;
        }
        // An orphan: the cut is recorded open and resolved only once this driver's claim went
        // through (review R7). Three cuts with no progress between them leave it for a person
        // (review R10): its progress is the phase, so a cut after progress starts the count again.
        const at = new Date(stored.updatedAt);
        await takeBack(deps.interruptions, {
          kind: 'cdr-run', jobId: stored.id, phase: cutPhase(stored), at,
          cause: at.getTime() < deps.interruptions.processStartedAt.getTime() ? 'server-restart' : 'lease-expired',
          selfResume: true,
          resume: async () => { if (!(await claim())) throw new Error('another driver claimed the run'); },
          // Stopped with a reason, so the plugin's page offers Continue, which carries on from the
          // saved place (re-review R10). The rev guard makes a second wait on the same cut a no-op.
          wait: async () => {
            await writeIfRev({
              ...stored, status: 'stopped', driver: null, waiting: null, finishedAt: now().toISOString(),
              lastError: `the check was cut ${MAX_SELF_RESUMES + 1} times with no progress; use Continue to carry it on`,
            }, stored.rev);
          },
        }).catch(() => {});
        if (released) return;
      }
    }
  }

  function launch(run: CheckRun): void {
    if (released || local.has(run.id)) return;
    const entry: Drive = { halt: null, promise: Promise.resolve() };
    local.set(run.id, entry);
    entry.promise = driveCheck(run, entry).catch(() => {}).finally(() => { local.delete(run.id); });
  }

  /** The copy, checked to be this plugin's, before its held rows are read. */
  async function ownCopy(pluginId: string, copyId: string): Promise<void> {
    if (!(await ownDb('read', () => deps.copies.get(pluginId, copyId)))) throw new Error(`copy ${copyId} not found`);
  }

  return {
    async checkers() {
      const out: Array<{ id: string; version: string; needsReference: boolean }> = [];
      for (const row of await deps.plugins.list()) {
        if (!row.enabled) continue;
        try {
          const plugin = await resolveChecker(row.id);
          out.push({ id: plugin.id, version: plugin.version, needsReference: plugin.twinKeys !== null });
        } catch {
          // No import source, no host:import capability, or no decode entrypoint.
        }
      }
      return out;
    },

    async start(input) {
      const plugin = await resolveChecker(input.pluginId);
      const pageSize = input.pageSize;
      if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < PAGE_SIZE_MIN || pageSize > PAGE_SIZE_MAX)) {
        throw new Error(`page size must be a whole number from ${PAGE_SIZE_MIN} to ${PAGE_SIZE_MAX}`);
      }
      const parsedOptions = optionsSchema.safeParse(input.options);
      if (!parsedOptions.success) throw new Error('invalid option: names are letters, digits and _, values up to 500 characters');
      const options = parsedOptions.data;
      const source = await completedCopy(plugin.id, input.copyId);
      // Each copy must play its role. A source copy picked as the reference would read as a site
      // with no reference, and every request would be saved unchecked.
      if (!(source.setOrder ?? Object.keys(source.sets)).includes(REQUESTS)) {
        throw new Error(`copy ${source.id} has no set ${REQUESTS}, so it cannot be the source of a check; pick the source copy`);
      }
      const referenceCopyId = input.referenceCopyId ?? null;
      let referenceRun: CopyRun | null = null;
      if (referenceCopyId !== null) {
        if (referenceCopyId === input.copyId) throw new Error('the reference copy must be another copy than the source copy');
        const reference = await completedCopy(plugin.id, referenceCopyId);
        if (!(reference.setOrder ?? Object.keys(reference.sets)).includes(TWINS)) {
          throw new Error(`copy ${reference.id} has no set ${TWINS}, so it cannot be the reference of a check; pick the reference copy, or no reference`);
        }
        referenceRun = reference;
      }
      await assertAllowed(plugin.id, referenceRun ? [source, referenceRun] : [source]);
      // Told now, not at the first tick: each copy must be made from the statements the plugin
      // names today.
      const sink = await loadImportSink(deps.plugins, plugin);
      await declaredSets(sink, plugin, source);
      if (referenceRun) await declaredSets(sink, plugin, referenceRun);
      const id = checkIdOf(input.copyId);
      const copyFinishedAt = { source: source.finishedAt, reference: referenceRun?.finishedAt ?? null };

      const started = await changeRun(plugin.id, id, async (existing) => {
        if (existing && isLive(existing.status)) {
          throw new Error(`check ${id} is ${existing.status}; stop it before starting it again`);
        }
        const at = now().toISOString();
        // A stopped or failed run carries on from its last page, with its counts and its held rows,
        // while it would read the same copies the same way. Anything else begins at the first key.
        const carriesOn = existing !== null
          && (existing.status === 'stopped' || existing.status === 'failed')
          && input.fromStart !== true
          && sameOptions(existing.options, options)
          && existing.referenceCopyId === referenceCopyId
          && existing.copyFinishedAt !== undefined
          && existing.copyFinishedAt.source === copyFinishedAt.source
          && existing.copyFinishedAt.reference === copyFinishedAt.reference;
        if (carriesOn) {
          return {
            ...existing, pluginVersion: plugin.version, status: 'queued', pageSize: pageSize ?? existing.pageSize,
            waiting: null, driver: null, startedAt: at, updatedAt: at, finishedAt: null, lastError: null,
            startedBy: input.actor.name, carriedOn: true, pass: existing.pass ?? randomUUID(),
          };
        }
        return {
          id, kind: 'check', rev: existing?.rev ?? 0, pluginId: plugin.id, pluginVersion: plugin.version,
          copyId: input.copyId, referenceCopyId, status: 'queued', options, pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
          cursor: null, counts: freshCounts(), laboratories: [], waiting: null, driver: null,
          startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: input.actor.name,
          copyFinishedAt, carriedOn: false, pass: randomUUID(),
        };
      }, (next) => auditOrRefuse(deps.audit, {
        action: 'import.check.start', pluginId: plugin.id, runId: id, actor: input.actor,
        metadata: { copyId: next.copyId, referenceCopyId: next.referenceCopyId, pageSize: next.pageSize, carriedOn: next.carriedOn === true },
      }));
      // A person's start closes the cut the run stopped on, if any (re-review R10).
      if (deps.interruptions && started.status === 'queued') {
        await resolveByPerson(deps.interruptions.store, 'cdr-run', started.id, now()).catch(() => {});
      }
      return started;
    },

    async get(pluginId, runId) {
      const run = await readRun(pluginId, runId);
      return run ? view(run) : null;
    },

    async list(pluginId) {
      return (await listRuns(pluginId)).map(view).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async stop(pluginId, runId, actor) {
      const run = await changeRun(pluginId, runId, async (stored) => {
        if (!stored) throw new Error(`check ${runId} not found`);
        if (stored.status === 'queued') return { ...stored, status: 'stopped', driver: null, finishedAt: now().toISOString() };
        if (stored.status === 'running' || stored.status === 'waiting') return { ...stored, status: 'stopping' };
        throw new Error(`check ${runId} is not running`);
      });
      if (run.status === 'stopping') {
        const entry = local.get(runId);
        if (entry) entry.halt ??= 'stop';
      }
      await auditQuietly(deps.audit, { action: 'import.check.stop', pluginId, runId, actor });
      return run;
    },

    async held(pluginId, copyId, opts) {
      await ownCopy(pluginId, copyId);
      return ownDb('read', () => deps.held.list(copyId, opts));
    },

    async heldItem(pluginId, copyId, key) {
      await ownCopy(pluginId, copyId);
      const item = await ownDb('read', () => deps.held.get(copyId, key));
      if (!item) return null;
      const correctable = correctableOf(await resolveChecker(pluginId));
      const corrections = deps.corrections ? (await ownDb('read', () => deps.corrections!.listFor(copyId, [key]))).get(key) ?? [] : [];
      return { ...item, corrections, correctable };
    },

    async correct(input) {
      const { pluginId, copyId, key, actor } = input;
      await ownCopy(pluginId, copyId);
      if (!deps.corrections) throw new Error('corrections are not available on this server');
      const correctable = correctableOf(await resolveChecker(pluginId));
      if (correctable.length === 0) throw new Error(`plugin ${pluginId} declares no fields a person may correct`);
      const reason = input.reason.trim();
      if (reason === '') throw new Error('a correction needs a reason');
      if (reason.length > CORRECTION_REASON_MAX) throw new Error(`a reason is at most ${CORRECTION_REASON_MAX} characters`);
      const fields = Object.keys(input.values);
      if (fields.length === 0) throw new Error('name at least one field to correct');
      for (const field of fields) {
        if (!correctable.includes(field)) throw new Error(`${field} cannot be corrected; the plugin allows ${correctable.join(', ')}`);
        const v = input.values[field];
        if (v !== null && v.length > CORRECTION_VALUE_MAX) throw new Error(`a corrected value is at most ${CORRECTION_VALUE_MAX} characters`);
      }
      const held = await ownDb('read', () => deps.held.get(copyId, key));
      if (!held || held.reason !== 'held') throw new Error('that request is not held back by the check, so it cannot be corrected');
      // A source kind may not have every declared field: only those this request sent (review H2).
      for (const field of fields) {
        if (!held.fields || !Object.prototype.hasOwnProperty.call(held.fields, field)) {
          throw new Error(`${field} cannot be corrected for this request`);
        }
      }
      // The audit row first: a correction is stored only once it is on the record (review H6). It
      // names the copy and the fields, never the key or a value: both come from the source.
      await auditOrRefuse(deps.audit, { action: 'import.check.correct', pluginId, actor, metadata: { copyId, fields: [...fields].sort() } });
      const at = now();
      for (const field of fields.sort()) {
        await ownDb('write', () => deps.corrections!.put({
          copyId, key, field, value: input.values[field] ?? null, original: held.fields?.[field] ?? null,
          reason, correctedBy: actor.name, correctedAt: at,
        }));
      }
      return { corrections: (await ownDb('read', () => deps.corrections!.listFor(copyId, [key]))).get(key) ?? [] };
    },

    async recheck(input) {
      const { pluginId, copyId, key, actor } = input;
      await ownCopy(pluginId, copyId);
      const held = await ownDb('read', () => deps.held.get(copyId, key));
      if (!held || held.reason !== 'held') throw new Error('that request is not held back by the check, so it cannot be checked again');
      const runId = checkIdOf(copyId);
      const run = await changeRun(pluginId, runId, async (stored) => {
        if (!stored) throw new Error(`check ${runId} not found; start the check again first`);
        if (isLive(stored.status)) throw new Error(`check ${runId} is ${stored.status}; wait for it to end, then check the request again`);
        // A recheck that did not finish is settled first: its counts brought in line with its held
        // rows, and a removal still to do done (re-review H3).
        const settled: CheckRun = { ...stored, counts: { ...stored.counts, labels: { ...stored.counts.labels } }, laboratories: stored.laboratories && structuredClone(stored.laboratories) };
        await settleRecheck(settled);
        const pending = (stored.recheck?.done ?? []).filter((x) => x.outcome === 'saved').map((x) => x.key);
        if (pending.length > 0) await ownDb('write', () => deps.held.remove(copyId, pending));
        return {
          ...settled, status: 'queued', driver: null, waiting: null,
          recheck: {
            keys: [key], returnTo: stored.status, finishedAt: stored.finishedAt,
            before: [{ key, label: held.label, laboratory: held.laboratory, pass: held.pass }],
          },
        };
      }, () => auditOrRefuse(deps.audit, { action: 'import.check.recheck', pluginId, runId, actor, metadata: { copyId } }));
      return run;
    },

    async heldItems(pluginId, copyId, opts) {
      await ownCopy(pluginId, copyId);
      const page: HeldItemsPage = await ownDb('read', () => deps.held.listItems(copyId, opts));
      // By offset the answer is as it always was. By key it adds `next`.
      return page.next === undefined ? { items: page.rows, total: page.total } : { items: page.rows, total: page.total, next: page.next };
    },

    tick() {
      ticking ??= takeWork().finally(() => { ticking = null; });
      return ticking;
    },

    async idle() {
      while (local.size > 0) await Promise.all([...local.values()].map((e) => e.promise));
    },

    async release() {
      released = true;
      for (const entry of local.values()) entry.halt ??= 'release';
      while (local.size > 0) await Promise.all([...local.values()].map((e) => e.promise));
    },
  };
}
