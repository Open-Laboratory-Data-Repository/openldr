import { recordSelfResume } from './job-interruptions';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redact } from '@openldr/core';
import { validateSelectSql } from '@openldr/dashboards';
import type { CopyRow, ImportCopyStore } from '@openldr/db';
import { canCopy } from '@openldr/marketplace';
import {
  NAME, STALE_MS, StoppedWhileWaiting, auditOrRefuse, auditQuietly, defaultCreateDb, loadImportSink, loadImportSinkWaiting,
  openSourceAccess, optionsSchema, querySpecSchema, resolveImportConnector, resolveImportPlugin,
  type ImportActor, type ImportServiceDeps, type ResolvedPlugin,
} from './import-run';
import { growPage } from './import-retry';
import { createSourceReader, matchPageKey, type SourceReader } from './import-source-reader';
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN, fillDetailQuery, fillKeyQuery } from './import-sql';

// Copies the rows of a source database to CE's own disk (spec 9.2 and 9.3).
//
// The plugin names what to copy: a list of sets, each paged by its own key query, with detail
// queries for the rows of each key. This service reads each set page by page through the page
// reader, and writes every page to `import_copy_rows` by replacing the rows of its keys, so a
// page read twice is stored once. The position of each set is saved only after its rows are.
//
// A copy runs for days, so a server process drives it (`tick`), not the caller of `start`.
// Whoever drives it writes the run every 30 seconds. A run with no write for 2 minutes has no
// driver, and the next `tick` in any process may take it.
//
// Nothing a source sent, and no source key, may reach an audit row or an error text. Source error
// text reaches here only as the page reader made it safe. A plugin's error and an error from CE's
// own database are stored as fixed sentences.

const COPIES = '__import-copies';
const SKIPPED = '__import-copy-skipped';
const DEFAULT_PAGE_SIZE = 500;
const DELETE_BATCH = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_SETS = 50;
const SYSTEM: ImportActor = { type: 'system', id: null, name: 'system' };
const PLUGIN_FAILED = "the plugin's copy entrypoint failed";

export type CopyStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'deleting';

export interface CopySetProgress {
  /** The last key done. The next page starts after it. */
  cursor: string | null;
  /** Keys stored. A skipped key is counted in `skipped` instead. */
  keys: number;
  rows: number;
  /** The UTF-8 length of each stored row's JSON, added up. */
  bytes: number;
  /** Keys listed in the skipped collection, not stored. */
  skipped: number;
  done: boolean;
  /** Set by a start with `reread`: the driver empties this set before it reads it again. */
  empty?: boolean;
}

export interface CopyRun {
  id: string;
  kind: 'copy';
  /** 1 when the record is made. Every write adds 1, and is refused when the stored rev is not the
   *  one its writer last read or wrote, so two writers at the same moment cannot undo each other. */
  rev: number;
  pluginId: string;
  pluginVersion: string;
  connectorId: string;
  status: CopyStatus;
  options: Record<string, string>;
  pageSize: number;
  /** Set name to progress. Read in the order of `setOrder`. */
  sets: Record<string, CopySetProgress>;
  /** The sets in the order the plugin named them. The run is stored as jsonb, and Postgres does not
   *  keep the key order of a jsonb object, so `sets` cannot carry the order on its own. */
  setOrder: string[];
  /** Set name to the SHA-256 of its key and detail SQL. */
  setSql: Record<string, string>;
  waiting: { since: string; attempt: number; error: string } | null;
  /** The id of the process driving it, or null when nobody does. */
  driver: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  startedBy: string;
}

/** One copy per plugin and connector: the first 32 hex characters of SHA-256 of `<pluginId>|<connectorId>`. */
export function copyIdOf(pluginId: string, connectorId: string): string {
  return createHash('sha256').update(`${pluginId}|${connectorId}`).digest('hex').slice(0, 32);
}

/** Thrown by start when a set's SQL differs from the stored one and `reread` was not given. */
export class CopySetChangedError extends Error {
  readonly sets: string[];
  constructor(sets: string[]) {
    super(`the SQL of ${sets.length === 1 ? 'set' : 'sets'} ${sets.join(', ')} changed; `
      + 'start again with reread to empty any rows they hold and read them from the start');
    this.name = 'CopySetChangedError';
    this.sets = sets;
  }
}

export interface ImportCopyServiceDeps
  extends Pick<ImportServiceDeps, 'plugins' | 'connectors' | 'secretsKey' | 'pluginData' | 'audit' | 'createDb' | 'now' | 'interruptions'> {
  store: ImportCopyStore;
  /** The connectors an admin allowed the plugin to read (`ImportService.allowed`). */
  allowed(pluginId: string): Promise<string[]>;
  /** This process. Written on each run it drives. */
  driverId: string;
  /** Injectable for tests; the page reader's wait between tries. */
  sleep?: (ms: number) => Promise<void>;
  /** The check runs over a copy (import-check.ts). Given as two functions, so this service does
   *  not import that one. Without it, a start or a remove does not look for a check. */
  checks?: {
    /** The status of a live check that reads this copy, as its source or as its reference, or
     *  null when no live check reads it. */
    liveCheckStatus(pluginId: string, copyId: string): Promise<string | null>;
    /** Delete up to `limit` held rows of the copy. 0 means none left. */
    deleteHeld(copyId: string, limit: number): Promise<number>;
    /** Delete the check record whose source is the copy. Called once its held rows are gone. */
    deleteCheck(pluginId: string, copyId: string): Promise<void>;
  };
}

/** Check statuses that hold the copy: a start or a remove is refused while the check is in one of them. */
const LIVE_CHECK = new Set(['queued', 'running', 'waiting', 'stopping']);

export interface ImportCopyStartInput {
  pluginId: string;
  connectorId: string;
  options: Record<string, string>;
  pageSize?: number;
  /** Empty every set whose SQL changed, and read it again from the start. */
  reread?: boolean;
  actor: ImportActor;
}

export interface ImportCopyService {
  /** Plugins that can be copied from, with the connector types each reads. */
  copiers(): Promise<Array<{ id: string; version: string; connectorTypes: string[] }>>;
  start(input: ImportCopyStartInput): Promise<CopyRun>;
  get(pluginId: string, copyId: string): Promise<CopyRun | null>;
  list(pluginId: string): Promise<CopyRun[]>;
  stop(pluginId: string, copyId: string, actor: ImportActor): Promise<CopyRun>;
  remove(pluginId: string, copyId: string, actor: ImportActor): Promise<CopyRun>;
  /** Server only. Take every run that needs a driver and start driving it. Does not wait for the
   *  drives to end; `idle` does. */
  tick(): Promise<void>;
  /** Resolves when this process is driving nothing. For tests and for shutdown. */
  idle(): Promise<void>;
  /** Tell every drive in this process to stop at its next check, leaving the stored status as it
   *  is, so the next server takes the run by the 2-minute rule. Resolves when those drives have
   *  saved. After this, `tick` takes nothing. */
  release(): Promise<void>;
}

/** What a plugin's copy entrypoint answers. The check run (import-check.ts) reads the detail names
 *  of a set from it. */
export const copySpecSchema = z.object({
  sets: z.array(querySpecSchema.extend({
    name: z.string().regex(NAME),
    detailQueries: querySpecSchema.shape.detailQueries.default([]),
  })).min(1).max(MAX_SETS),
}).superRefine((spec, ctx) => {
  const names = spec.sets.map((s) => s.name);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'set names repeat' });
  for (const s of spec.sets) {
    const details = s.detailQueries.map((d) => d.name);
    if (new Set(details).size !== details.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'detail names repeat' });
  }
});
type CopySet = z.infer<typeof copySpecSchema>['sets'][number];
type Sink = Awaited<ReturnType<typeof loadImportSink>>;
interface CopySpec { sets: CopySet[]; hashes: Record<string, string> }

/** A fault of the plugin. Its own text is never kept: a plugin's text is not trusted. */
class PluginFault extends Error {
  constructor() { super(PLUGIN_FAILED); }
}

/** A failure of CE's own database. A Postgres error's message, detail and where fields can quote
 *  row values, so only the five-character SQLSTATE code is kept. */
class OwnDbFault extends Error {}

function sqlState(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
}

async function ownDb<T>(kind: 'read' | 'write', work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof OwnDbFault) throw err;
    throw new OwnDbFault(kind === 'write'
      ? `OpenLDR's own database refused a write (${sqlState(err)})`
      : `OpenLDR's own database failed a read (${sqlState(err)})`);
  }
}

function setHash(set: CopySet): string {
  const text = JSON.stringify({ key: set.keyQuery.sql, details: set.detailQueries.map((d) => [d.name, d.sql]) });
  return createHash('sha256').update(text).digest('hex');
}

/** Set name to the SHA-256 of its key and detail SQL, as a copy stores it in `setSql`. The check
 *  run (import-check.ts) uses it to see that a copy was made from the statements the plugin names
 *  now. */
export function copySetHashes(sets: CopySet[]): Record<string, string> {
  return Object.fromEntries(sets.map((s) => [s.name, setHash(s)]));
}

/** Sets whose SQL is not the stored SQL: changed, newly named, or no longer named. */
export function changedSets(stored: Record<string, string>, next: Record<string, string>): string[] {
  const names = new Set([...Object.keys(next), ...Object.keys(stored)]);
  return [...names].filter((n) => stored[n] !== next[n]);
}

/** Postgres jsonb refuses a string that holds a NUL character, and one that is not well formed
 *  UTF-16: a lone surrogate, as in a name cut in the middle of a pair (R21, R21b). Node has
 *  `isWellFormed`; the ES2022 types this repo builds with do not name it. */
function unstorableText(s: string): boolean {
  return s.includes('\u0000') || !(s as string & { isWellFormed(): boolean }).isWellFormed();
}
function cannotStore(value: unknown): boolean {
  if (typeof value === 'string') return unstorableText(value);
  if (Array.isArray(value)) return value.some(cannotStore);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => unstorableText(k) || cannotStore(v));
  }
  return false;
}

const freshProgress = (): CopySetProgress => ({ cursor: null, keys: 0, rows: 0, bytes: 0, skipped: 0, done: false });
const isTerminal = (s: CopyStatus): boolean => s === 'stopped' || s === 'completed' || s === 'failed';
/** Statuses a driver holds. A run in one of them with no write for 2 minutes has no driver. */
const isDriven = (s: CopyStatus): boolean => s === 'running' || s === 'waiting' || s === 'stopping' || s === 'deleting';

interface SkippedEntry { copyId: string; setName: string; key: string; code: 'SOURCE_TIMEOUT' | 'ROW_NOT_STORABLE'; after: string | null }

/** Why a drive ended early. `stop`: a person asked. `release`: this process is shutting down.
 *  `lost`: another process holds the run now, so this one writes nothing more. */
type Halt = 'stop' | 'release' | 'lost';
interface Drive { promise: Promise<void>; halt: Halt | null }
type CopyOutcome = 'completed' | 'stopped' | 'failed' | 'release' | 'lost';

export function createImportCopyService(deps: ImportCopyServiceDeps): ImportCopyService {
  const now = deps.now ?? (() => new Date());
  const makeDb = deps.createDb ?? defaultCreateDb;
  /** Runs this process is driving right now. */
  const local = new Map<string, Drive>();
  let released = false;
  /** The tick in flight, so a second call while it runs gets the same one. */
  let ticking: Promise<void> | null = null;

  const isAllowed = async (pluginId: string, connectorId: string): Promise<boolean> =>
    (await deps.allowed(pluginId)).includes(connectorId);

  // Every call to the copy row store and to plugin_data goes through ownDb, so a Postgres error's
  // text never reaches a caller. The plugin, connector and allow-list lookups do not. Their text
  // can reach `lastError` through `clean`, and none of them reads a copied row.
  const readRun = async (pluginId: string, copyId: string): Promise<CopyRun | null> =>
    (await ownDb('read', () => deps.pluginData.get(pluginId, COPIES, copyId))) as CopyRun | null;
  const listRuns = async (pluginId: string): Promise<CopyRun[]> =>
    (await ownDb('read', () => deps.pluginData.list(pluginId, COPIES))).map((e) => e.doc as CopyRun);
  /** The only way a copy record is written (R28): only when the stored rev is `expected`, or when
   *  there is no record and `expected` is null. Sets `rev` and `updatedAt` on success. */
  async function writeIfRev(run: CopyRun, expected: number | null): Promise<boolean> {
    const doc: CopyRun = { ...run, rev: (expected ?? 0) + 1, updatedAt: now().toISOString() };
    const wrote = await ownDb('write', () => deps.pluginData.putIfRev(run.pluginId, COPIES, run.id, doc, expected));
    if (wrote) { run.rev = doc.rev; run.updatedAt = doc.updatedAt; }
    return wrote;
  }
  /** `start`, `stop` and `remove`: read, decide, write by compare-and-swap. A refused write reads
   *  and decides again, up to 3 times. `decide` returns the record to write, or throws, or returns
   *  `{ answer }` to give back with nothing written. `before` runs once, before the first write. */
  async function changeRun(
    pluginId: string,
    copyId: string,
    decide: (stored: CopyRun | null) => Promise<CopyRun | { answer: CopyRun }>,
    before?: (next: CopyRun, stored: CopyRun | null) => Promise<void>,
  ): Promise<CopyRun> {
    let beforeDone = false;
    for (let tries = 0; tries < 3; tries++) {
      const stored = await readRun(pluginId, copyId);
      const next = await decide(stored);
      if ('answer' in next) return view(next.answer);
      if (before && !beforeDone) { await before(next, stored); beforeDone = true; }
      if (await writeIfRev(next, stored ? stored.rev : null)) return view(next);
    }
    throw new Error('the copy changed at the same moment; try again');
  }
  const listSkipped = async (pluginId: string, copyId: string): Promise<SkippedEntry[]> =>
    (await ownDb('read', () => deps.pluginData.list(pluginId, SKIPPED, { where: { field: 'copyId', eq: copyId } })))
      .map((e) => e.doc as SkippedEntry);
  const skippedKey = (e: Pick<SkippedEntry, 'copyId' | 'setName' | 'key'>) => `${e.copyId}:${e.setName}:${e.key}`;
  const putSkipped = (pluginId: string, e: SkippedEntry): Promise<void> =>
    ownDb('write', () => deps.pluginData.put(pluginId, SKIPPED, skippedKey(e), e));
  const dropSkipped = (pluginId: string, e: SkippedEntry): Promise<void> =>
    ownDb('write', () => deps.pluginData.delete(pluginId, SKIPPED, skippedKey(e)));

  /** What a caller sees: `sets` in the plugin's order, and the defaults of absent fields. */
  function view(stored: CopyRun): CopyRun {
    const order = stored.setOrder ?? Object.keys(stored.sets);
    const sets: Record<string, CopySetProgress> = {};
    for (const name of order) if (stored.sets[name]) sets[name] = { ...stored.sets[name] };
    for (const name of Object.keys(stored.sets)) if (!(name in sets)) sets[name] = { ...stored.sets[name] };
    return { ...stored, sets, setOrder: [...order], waiting: stored.waiting ?? null, driver: stored.driver ?? null };
  }

  async function resolveCopier(pluginId: string): Promise<ResolvedPlugin & { copyEntrypoint: string }> {
    const plugin = await resolveImportPlugin(deps.plugins, pluginId, 'read');
    const entry = plugin.source.entrypoints.copy;
    if (!canCopy(plugin.source) || entry === undefined) {
      throw new Error(`plugin ${pluginId} cannot be copied from: it names no copy entrypoint`);
    }
    return { ...plugin, copyEntrypoint: entry };
  }

  /** Ask the plugin what to copy, check every statement, and hash each set's SQL. A drive passes a
   *  `load` that waits for the plugin's code. A start loads it at once, so the person sees a fault. */
  async function readSpec(
    plugin: ResolvedPlugin & { copyEntrypoint: string },
    options: Record<string, string>,
    load: (p: ResolvedPlugin) => Promise<Sink> = (p) => loadImportSink(deps.plugins, p),
  ): Promise<CopySpec> {
    const sink = await load(plugin);
    let raw: unknown;
    try {
      raw = await sink.invoke(plugin.copyEntrypoint, { options });
    } catch {
      throw new PluginFault();
    }
    const parsed = copySpecSchema.safeParse(raw);
    if (!parsed.success) throw new PluginFault();
    // Check the plugin's statements before opening a connection or running any of them.
    for (const set of parsed.data.sets) {
      validateSelectSql(fillKeyQuery(set.keyQuery.sql, null, 1), 'mssql');
      for (const d of set.detailQueries) validateSelectSql(fillDetailQuery(d.sql, ['A']), 'mssql');
    }
    return { sets: parsed.data.sets, hashes: copySetHashes(parsed.data.sets) };
  }

  /**
   * File a page's rows under their keys. A detail row's key is its first column; `seq` counts from
   * 0 within each detail and key, in arrival order. A set with no detail queries files the key
   * query's own rows under the set's name. A key with a NUL character or a lone surrogate in any of its rows cannot be
   * stored, and is handed back in `unstorable` with no rows.
   */
  function filePage(set: CopySet, page: { keys: string[]; keyRows: Array<Record<string, unknown>>; rows: Record<string, Array<Record<string, unknown>>> }) {
    const keys = [...new Set(page.keys)];
    const byKey = new Map<string, CopyRow[]>(keys.map((k) => [k, []]));
    const add = (detail: string, key: string | null, row: Record<string, unknown>, seqs: Map<string, number>) => {
      // The reader checks this with checkRowKeys; this keeps replaceKeys from ever seeing a stray row.
      if (key === null || !byKey.has(key)) throw new Error(`a row of ${detail} has a first column that is not a key of the page`);
      const list = byKey.get(key)!;
      const seq = seqs.get(key) ?? 0;
      seqs.set(key, seq + 1);
      list.push({ detail, key, seq, row });
    };
    if (set.detailQueries.length === 0) {
      // The next page starts after this page's last key, so the rows of a repeated key past the
      // page end would never be read (R46). A key that repeats only across a page end is not seen.
      if (keys.length !== page.keys.length) {
        throw new Error(`set ${set.name} has no detail queries, and its key query gave one key on more than one row of a page; each row of such a set needs its own key`);
      }
      const seqs = new Map<string, number>();
      page.keyRows.forEach((row, i) => add(set.name, page.keys[i], row, seqs));
    } else {
      for (const d of set.detailQueries) {
        const seqs = new Map<string, number>();
        // Filed under the page key the source matched, never under the row's own spelling, so
        // replaceKeys sees only keys of the page (R30). The row keeps its own value untouched.
        for (const row of page.rows[d.name] ?? []) add(d.name, matchPageKey(page.keys, String(Object.values(row)[0] ?? '')), row, seqs);
      }
    }
    const rows: CopyRow[] = [];
    const unstorable: string[] = [];
    let bytes = 0;
    for (const key of keys) {
      const list = byKey.get(key)!;
      if (list.some((r) => cannotStore(r.row))) { unstorable.push(key); continue; }
      for (const r of list) bytes += Buffer.byteLength(JSON.stringify(r.row), 'utf8');
      rows.push(...list);
    }
    return { keys, rows, bytes, unstorable, stored: keys.length - unstorable.length };
  }

  /** Writing, heartbeat and halting, shared by a copy drive and a delete drive. */
  function driving(run: CopyRun, entry: Drive) {
    // The sets as they stood at the last page end. Only these are ever saved. A save in the middle
    // of a page (a heartbeat, a change of wait state) keeps them, so a crash leaves a record from
    // which the page is read again in full and nothing is counted twice.
    const snapshot = () => ({ sets: structuredClone(run.sets), setOrder: [...run.setOrder] });
    let pageEnd = snapshot();
    const markPageEnd = (): void => { pageEnd = snapshot(); };

    /** Why to stop, or null. Asks the stored record for a stop from another process, and for
     *  another driver. A halt once found is kept. */
    async function haltWanted(): Promise<Halt | null> {
      if (entry.halt) return entry.halt;
      const stored = await readRun(run.pluginId, run.id);
      if (!stored || stored.driver !== deps.driverId) entry.halt = 'lost';
      else if (stored.status === 'stopping') entry.halt = 'stop';
      return entry.halt;
    }

    /**
     * Write the run as it stood at the last page end, by compare-and-swap on the rev this drive last
     * wrote (R28). When the write is refused, read the record. Another driver, or no record, or a
     * delete: this drive is lost and writes nothing more. A stop: obey it. Otherwise put this drive's
     * progress onto the record just read and try again. False, and nothing written, once lost.
     */
    const casSave = async (): Promise<boolean> => {
      for (let tries = 0; tries < 5; tries++) {
        if (entry.halt === 'lost') return false;
        const doc: CopyRun = { ...run, sets: structuredClone(pageEnd.sets), setOrder: [...pageEnd.setOrder] };
        if (await writeIfRev(doc, run.rev)) {
          run.rev = doc.rev;
          run.updatedAt = doc.updatedAt;
          return true;
        }
        const stored = await readRun(run.pluginId, run.id);
        const deletedUnderUs = stored?.status === 'deleting' && run.status !== 'deleting';
        if (!stored || stored.driver !== deps.driverId || deletedUnderUs) {
          entry.halt = 'lost';
          return false;
        }
        if (stored.status === 'stopping') {
          entry.halt ??= 'stop';
          if (run.status === 'running' || run.status === 'waiting') run.status = 'stopping';
        }
        run.rev = stored.rev;
      }
      // Five refusals in a row while this process is still the driver: something keeps writing the
      // record. Stop writing; the 2-minute rule hands the run on.
      entry.halt = 'lost';
      return false;
    };
    // Saves go one after another, so a heartbeat that started first never lands last.
    let saving: Promise<unknown> = Promise.resolve();
    const saveInTurn = (): Promise<boolean> => {
      const next = saving.then(casSave);
      saving = next.catch(() => {});
      return next;
    };
    /** Save, keeping a stop asked for here. False, and nothing written, once the run is lost. */
    const saveKeepingStop = async (): Promise<boolean> => {
      if (entry.halt === 'stop' && (run.status === 'running' || run.status === 'waiting')) run.status = 'stopping';
      return saveInTurn();
    };
    // Written every 30 seconds while this drives, even in the middle of a page or a wait, so
    // another process can tell a live run from one whose driver has gone. A failed write here is
    // not acted on: the next page's save meets the same fault and ends the run.
    let beating: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      beating ??= saveKeepingStop().then(() => {}, () => {}).finally(() => { beating = null; });
    }, HEARTBEAT_MS);
    const stopBeating = async (): Promise<void> => {
      clearInterval(heartbeat);
      await beating;
    };
    /** Put the run back to its last page end, as it is stored. */
    const rewind = (): void => { Object.assign(run, structuredClone(pageEnd)); };
    return { markPageEnd, haltWanted, saveInTurn, saveKeepingStop, stopBeating, rewind, settled: () => saving };
  }

  const haltOutcome = (halt: Halt | null): CopyOutcome => (halt === 'release' ? 'release' : halt === 'lost' ? 'lost' : 'stopped');

  async function driveCopy(run: CopyRun, entry: Drive): Promise<void> {
    const d = driving(run, entry);
    let reader: SourceReader | undefined;
    let clean = (text: string) => redact(text).slice(0, 300);
    let outcome: CopyOutcome = 'failed';

    /** Empty a set in batches, with its skipped keys. A halt between batches is returned. */
    const emptySet = async (name: string): Promise<CopyOutcome | null> => {
      // The first batch has no save before it, so ask the stored record first.
      if (await d.haltWanted()) return haltOutcome(entry.halt);
      for (;;) {
        if (entry.halt) return haltOutcome(entry.halt);
        const gone = await ownDb('write', () => deps.store.deleteSome(run.id, DELETE_BATCH, name));
        if (gone === 0) break;
        if (!(await d.saveKeepingStop())) return 'lost';
      }
      for (const e of await listSkipped(run.pluginId, run.id)) if (e.setName === name) await dropSkipped(run.pluginId, e);
      return null;
    };

    const body = async (): Promise<CopyOutcome> => {
      // Taken over while a stop was pending: finish the stop.
      if (run.status === 'stopping') return 'stopped';

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
        await d.saveKeepingStop();
      };
      const stopWanted = async (): Promise<boolean> => (await d.haltWanted()) !== null;
      const sleep = deps.sleep ? { sleep: deps.sleep } : {};

      const plugin = await resolveCopier(run.pluginId);
      const { type } = await resolveImportConnector(deps.connectors, isAllowed, plugin, run.connectorId);
      const spec = await readSpec(plugin, run.options, (p) => loadImportSinkWaiting(deps.plugins, p, { onWaiting, stopWanted, ...sleep }));
      // The SQL a start recorded is the SQL the rows came from. A plugin upgraded since then must
      // not add rows of other SQL to them. A start asks the person, so the run stops here.
      const changed = changedSets(run.setSql, spec.hashes);
      if (changed.length > 0) {
        throw new Error(`set ${changed.join(', ')} changed since the copy was started; start it again with reread`);
      }

      const access = await openSourceAccess(deps, makeDb, run.connectorId, type);
      clean = access.clean;
      reader = createSourceReader({
        open: async (opts) => access.open(opts),
        onWaiting,
        stopWanted,
        clean,
        ...sleep,
      });
      /** A set with a position or done: this copy has read the source before, so a refused login
       *  or database may be a source that is starting up (R45). */
      const readBefore = (): boolean => Object.values(run.sets).some((p) => p.cursor !== null || p.done);

      // Sets the plugin no longer names: empty them, then drop them.
      for (const name of [...run.setOrder]) {
        if (name in spec.hashes) continue;
        const halt = await emptySet(name);
        if (halt) return halt;
        delete run.sets[name];
        run.setOrder = run.setOrder.filter((n) => n !== name);
        d.markPageEnd();
        if (!(await d.saveKeepingStop())) return 'lost';
      }

      for (const set of spec.sets) {
        let progress = run.sets[set.name];
        if (!progress || progress.empty) {
          if (progress?.empty) {
            const halt = await emptySet(set.name);
            if (halt) return halt;
          }
          progress = run.sets[set.name] = freshProgress();
          if (!run.setOrder.includes(set.name)) run.setOrder.push(set.name);
          d.markPageEnd();
          if (!(await d.saveKeepingStop())) return 'lost';
        }
        if (progress.done) continue;

        // A page the reader had to halve stays halved, and doubles again after 5 good pages in a
        // row, never above the run's own page size.
        let size = run.pageSize;
        let goodInRow = 0;
        for (;;) {
          if (entry.halt) return haltOutcome(entry.halt);
          const page = await reader.readPage({
            keySql: set.keyQuery.sql, details: set.detailQueries, after: progress.cursor, size, checkRowKeys: true, readBefore: readBefore(),
          });
          if (page.kind === 'stopped') return haltOutcome(entry.halt);
          if (page.kind === 'end') {
            progress.done = true;
            d.markPageEnd();
            if (!(await d.saveKeepingStop())) return 'lost';
            break;
          }
          // Another process may hold the run now. Then this page is not written.
          if ((await d.haltWanted()) === 'lost') return 'lost';
          if (page.kind === 'skipped') {
            // One key timed out 3 times even read alone. It is listed, and the copy moves past it.
            await putSkipped(run.pluginId, { copyId: run.id, setName: set.name, key: page.key, code: 'SOURCE_TIMEOUT', after: progress.cursor });
            progress.skipped += 1;
            progress.cursor = page.key;
            d.markPageEnd();
            if (!(await d.saveKeepingStop())) return 'lost';
            // The key was found at a page of 1. Start there and grow back after 5 good pages.
            size = 1;
            goodInRow = 0;
            continue;
          }
          if (page.size < size) {
            size = page.size;
            goodInRow = 0;
          } else {
            goodInRow += 1;
            const grown = growPage(size, run.pageSize, goodInRow);
            if (grown !== size) { size = grown; goodInRow = 0; }
          }

          const filed = filePage(set, page);
          // Every key of the page is replaced, so a key that cannot be stored keeps no old rows.
          await ownDb('write', () => deps.store.replaceKeys(run.id, set.name, filed.keys, filed.rows));
          for (const key of filed.unstorable) {
            const i = page.keys.indexOf(key);
            await putSkipped(run.pluginId, {
              copyId: run.id, setName: set.name, key, code: 'ROW_NOT_STORABLE', after: i > 0 ? page.keys[i - 1] : progress.cursor,
            });
          }
          progress.keys += filed.stored;
          progress.rows += filed.rows.length;
          progress.bytes += filed.bytes;
          progress.skipped += filed.unstorable.length;
          progress.cursor = page.keys[page.keys.length - 1];
          d.markPageEnd();
          if (!(await d.saveKeepingStop())) return 'lost';
        }
      }

      // Every set is done. Read each skipped key once more, at a page of one.
      const sets = new Map(spec.sets.map((s) => [s.name, s]));
      for (const e of await listSkipped(run.pluginId, run.id)) {
        if (entry.halt) return haltOutcome(entry.halt);
        const set = sets.get(e.setName);
        const progress = run.sets[e.setName];
        if (!set || !progress) { await dropSkipped(run.pluginId, e); continue; }
        // Listed, but already stored and counted: a crash between listing it and saving the
        // position past it, then a pass that read it. Drop the listing and count nothing.
        if ((await ownDb('read', () => deps.store.read(run.id, e.setName, [e.key]))).length > 0) {
          await dropSkipped(run.pluginId, e);
          continue;
        }
        const page = await reader.readPage({
          keySql: set.keyQuery.sql, details: set.detailQueries, after: e.after, size: 1, checkRowKeys: true, readBefore: readBefore(),
        });
        if (page.kind === 'stopped') return haltOutcome(entry.halt);
        if ((await d.haltWanted()) === 'lost') return 'lost';
        // Still too slow, or the source no longer has the key right after `after`: it stays listed.
        if (page.kind !== 'page' || page.keys[0] !== e.key) continue;
        const filed = filePage(set, page);
        if (filed.unstorable.length > 0) {
          // Read this time, but not storable. It stays listed, under the code that now applies.
          if (e.code !== 'ROW_NOT_STORABLE') await putSkipped(run.pluginId, { ...e, code: 'ROW_NOT_STORABLE' });
          continue;
        }
        await ownDb('write', () => deps.store.replaceKeys(run.id, set.name, filed.keys, filed.rows));
        progress.keys += filed.stored;
        progress.rows += filed.rows.length;
        progress.bytes += filed.bytes;
        d.markPageEnd();
        if (!(await d.saveKeepingStop())) return 'lost';
        // Dropped after the counts are saved. A crash between the two leaves the listing, and the
        // check above drops it next time without counting the key again.
        await dropSkipped(run.pluginId, e);
      }
      // The skipped counts are the entries left.
      const left = await listSkipped(run.pluginId, run.id);
      for (const name of Object.keys(run.sets)) run.sets[name].skipped = left.filter((e) => e.setName === name).length;
      d.markPageEnd();
      return 'completed';
    };

    try {
      outcome = await body();
    } catch (err) {
      if (err instanceof StoppedWhileWaiting) {
        // A stop or a release came while it waited for the plugin's code.
        outcome = haltOutcome(entry.halt);
      } else {
        outcome = 'failed';
        // A plugin fault and a fault of CE's own database carry fixed sentences. Anything else is
        // the reader's text, already made safe, or OpenLDR's own; it is cleaned and capped as the
        // one-pass import does.
        run.lastError = err instanceof PluginFault || err instanceof OwnDbFault
          ? err.message
          : clean(err instanceof Error ? err.message : String(err));
      }
    } finally {
      await d.stopBeating();
      await reader?.close();
    }
    await finishDrive(run, d, outcome);
  }

  async function finishDrive(run: CopyRun, d: ReturnType<typeof driving>, outcome: CopyOutcome): Promise<void> {
    // After a throw in the middle of a page, the run reports what it stores: the last page end.
    d.rewind();
    if (outcome === 'lost') return;
    if (outcome === 'release') {
      // The stored status stays, with this process as its driver, so the next server takes it
      // by the 2-minute rule.
      await d.saveInTurn().catch(() => false);
      return;
    }
    run.status = outcome;
    run.waiting = null;
    run.driver = null;
    run.finishedAt = now().toISOString();
    // A run another process took meanwhile is refused by the compare-and-swap and not written
    // over. Then this drive did not finish it, so it audits nothing. A write that fails outright
    // still audits: the drive did end.
    if (!(await d.saveInTurn().catch(() => true))) return;
    const totals = { keys: 0, rows: 0, bytes: 0, skipped: 0 };
    for (const p of Object.values(run.sets)) {
      totals.keys += p.keys; totals.rows += p.rows; totals.bytes += p.bytes; totals.skipped += p.skipped;
    }
    await auditQuietly(deps.audit, {
      action: 'import.copy.finish', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor: SYSTEM,
      metadata: { status: outcome, sets: run.setOrder.length, ...totals },
    });
  }

  async function driveDelete(run: CopyRun, entry: Drive): Promise<void> {
    const d = driving(run, entry);
    let outcome: 'done' | 'release' | 'lost' | 'failed' = 'failed';
    try {
      // The first batch has no save before it, so ask the stored record first.
      await d.haltWanted();
      for (;;) {
        if (entry.halt) { outcome = entry.halt === 'lost' ? 'lost' : 'release'; break; }
        const gone = await ownDb('write', () => deps.store.deleteSome(run.id, DELETE_BATCH));
        if (gone === 0) { outcome = 'done'; break; }
        if (!(await d.saveKeepingStop())) { outcome = 'lost'; break; }
      }
      // The held rows of a check on this copy go with it, in batches too.
      const checks = deps.checks;
      while (outcome === 'done' && checks) {
        if (entry.halt) { outcome = entry.halt === 'lost' ? 'lost' : 'release'; break; }
        const gone = await ownDb('write', () => checks.deleteHeld(run.id, DELETE_BATCH));
        if (gone === 0) break;
        if (!(await d.saveKeepingStop())) { outcome = 'lost'; break; }
      }
      // Then the check record, so a copy made again on the same connector shows no old run.
      if (outcome === 'done' && checks) await ownDb('write', () => checks.deleteCheck(run.pluginId, run.id));
      if (outcome === 'done') {
        for (const e of await listSkipped(run.pluginId, run.id)) await dropSkipped(run.pluginId, e);
        // One more compare-and-swap before the record goes, so a drive that lost the run never
        // deletes a record another process now holds. After it, no other caller changes a
        // `deleting` record with a live driver: start, stop and remove refuse it, and a claim waits
        // 2 minutes.
        if (!(await d.saveInTurn())) outcome = 'lost';
      }
    } catch (err) {
      outcome = 'failed';
      run.lastError = err instanceof OwnDbFault ? err.message : redact(err instanceof Error ? err.message : String(err)).slice(0, 300);
    } finally {
      await d.stopBeating();
    }
    if (outcome === 'lost') return;
    await d.settled();
    if (outcome === 'done') {
      const gone = await ownDb('write', () => deps.pluginData.delete(run.pluginId, COPIES, run.id)).then(() => true, () => false);
      // One row when the record is gone, so the log tells a finished delete from one still running.
      // A record that could not be deleted is taken again later, and that drive writes the row.
      if (gone) {
        const rows = Object.values(run.sets).reduce((n, p) => n + p.rows, 0);
        await auditQuietly(deps.audit, {
          action: 'import.copy.finish', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor: SYSTEM,
          metadata: { status: 'deleted', rows },
        });
      }
      return;
    }
    // Released, or failed. The run stays `deleting` with this driver, so a later tick (here or in
    // another process) takes it again once it is 2 minutes old and finishes the delete.
    await d.saveInTurn().catch(() => false);
  }

  /** One tick: claim every run that needs a driver and launch it. Only one runs at a time (`tick`). */
  async function takeWork(): Promise<void> {
    for (const row of await deps.plugins.list()) {
      for (const stored of await listRuns(row.id)) {
        // Checked before each claim: after a release this process takes nothing more.
        if (released) return;
        if (local.has(stored.id)) continue;
        // Waiting for a first driver: a queued copy, or a delete nobody has begun.
        const unclaimed = stored.status === 'queued' || (stored.status === 'deleting' && (stored.driver ?? null) === null);
        // Its driver has gone: no write for 2 minutes, and not driven here.
        const orphaned = isDriven(stored.status) && now().getTime() - Date.parse(stored.updatedAt) > STALE_MS;
        if (!unclaimed && !orphaned) continue;
        const previous = stored.driver ?? null;
        const run: CopyRun = {
          ...stored, driver: deps.driverId, waiting: null,
          status: stored.status === 'queued' || stored.status === 'waiting' ? 'running' : stored.status,
        };
        // A claim is a compare-and-swap too. The one that loses does not drive.
        if (!(await writeIfRev(run, stored.rev))) continue;
        if (!unclaimed) await recordSelfResume(deps.interruptions, 'cdr-run', run.id, new Date(stored.updatedAt));
        // A release that came while the claim was written: the claim stands, nobody here drives it,
        // and the next server takes it by the 2-minute rule.
        if (released) return;
        if (!unclaimed && previous !== null && previous !== deps.driverId) {
          await auditQuietly(deps.audit, {
            action: 'import.copy.takeover', pluginId: run.pluginId, connectorId: run.connectorId, runId: run.id, actor: SYSTEM,
            metadata: { status: stored.status },
          });
        }
        launch(run);
      }
    }
  }

  /** Start driving a run in the background and remember it until it ends. */
  function launch(run: CopyRun): void {
    // After a release nothing new starts here (R29b). A takeover writes its audit row between its
    // claim and this call, and a release can land in that gap. The claim stands, and the next
    // server takes the run by the 2-minute rule.
    if (released || local.has(run.id)) return;
    const entry: Drive = { halt: null, promise: Promise.resolve() };
    local.set(run.id, entry);
    const work = run.status === 'deleting' ? driveDelete(run, entry) : driveCopy(run, entry);
    entry.promise = work.catch(() => {}).finally(() => { local.delete(run.id); });
  }

  return {
    async copiers() {
      const out: Array<{ id: string; version: string; connectorTypes: string[] }> = [];
      for (const row of await deps.plugins.list()) {
        if (!row.enabled) continue;
        try {
          const plugin = await resolveCopier(row.id);
          out.push({ id: plugin.id, version: plugin.version, connectorTypes: [...plugin.source.connectorTypes] });
        } catch {
          // No import source, no host:import capability, or no copy entrypoint.
        }
      }
      return out;
    },

    async start(input) {
      const plugin = await resolveCopier(input.pluginId);
      await resolveImportConnector(deps.connectors, isAllowed, plugin, input.connectorId);
      const pageSize = input.pageSize;
      if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < PAGE_SIZE_MIN || pageSize > PAGE_SIZE_MAX)) {
        throw new Error(`page size must be a whole number from ${PAGE_SIZE_MIN} to ${PAGE_SIZE_MAX}`);
      }
      const parsedOptions = optionsSchema.safeParse(input.options);
      if (!parsedOptions.success) throw new Error('invalid option: names are letters, digits and _, values up to 500 characters');
      const options = parsedOptions.data;
      const spec = await readSpec(plugin, options);
      const names = spec.sets.map((s) => s.name);
      const id = copyIdOf(plugin.id, input.connectorId);
      /** How many sets this start empties, for the audit row. */
      let rereading = 0;

      return changeRun(plugin.id, id, async (existing) => {
        // A start empties or extends the rows a live check reads, so it waits for the check. Asked
        // first, so a copy that is new to this record, or read again, is refused all the same.
        const check = deps.checks ? await ownDb('read', () => deps.checks!.liveCheckStatus(plugin.id, id)) : null;
        if (check !== null && LIVE_CHECK.has(check)) {
          throw new Error(`copy ${id} has a check that is ${check}; stop it before starting the copy again`);
        }
        if (!existing) {
          rereading = 0;
          const at = now().toISOString();
          return {
            id, kind: 'copy', rev: 0, pluginId: plugin.id, pluginVersion: plugin.version, connectorId: input.connectorId,
            status: 'queued', options, pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
            sets: Object.fromEntries(names.map((n) => [n, freshProgress()])), setOrder: names, setSql: spec.hashes,
            waiting: null, driver: null, startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: input.actor.name,
          };
        }

        if (existing.status === 'deleting') throw new Error(`copy ${id} is being deleted`);
        if (existing.status === 'stopping') throw new Error(`copy ${id} is stopping; start it again once it has stopped`);
        const changed = changedSets(existing.setSql, spec.hashes);
        const active = existing.status === 'running' || existing.status === 'waiting';
        if (changed.length > 0) {
          if (!input.reread) throw new CopySetChangedError(changed);
          // Emptying a set under a live drive would mix its rows with the new SQL's.
          if (active) throw new Error(`copy ${id} is ${existing.status}; stop it before reading a set again`);
        } else if (!isTerminal(existing.status)) {
          // Queued, running or waiting, with the same SQL: it is already under way.
          return { answer: existing };
        }

        const sets: Record<string, CopySetProgress> = {};
        const setOrder = [...names];
        for (const name of names) {
          const old = existing.sets[name];
          sets[name] = !old ? freshProgress() : changed.includes(name) ? { ...old, empty: true } : old;
        }
        // A set no longer named is emptied by the driver and then dropped.
        for (const name of existing.setOrder ?? Object.keys(existing.sets)) {
          if (name in spec.hashes || !existing.sets[name]) continue;
          sets[name] = { ...existing.sets[name], empty: true };
          setOrder.push(name);
        }
        rereading = changed.length;
        return {
          ...existing, pluginVersion: plugin.version, options, pageSize: pageSize ?? existing.pageSize,
          sets, setOrder, setSql: spec.hashes,
          status: 'queued', waiting: null, driver: null, finishedAt: null, lastError: null,
        };
      }, (next) => auditOrRefuse(deps.audit, {
        action: 'import.copy.start', pluginId: plugin.id, connectorId: input.connectorId, runId: id, actor: input.actor,
        metadata: { pageSize: next.pageSize, sets: names.length, reread: rereading },
      }));
    },

    async get(pluginId, copyId) {
      const run = await readRun(pluginId, copyId);
      return run ? view(run) : null;
    },

    async list(pluginId) {
      return (await listRuns(pluginId)).map(view).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async stop(pluginId, copyId, actor) {
      const run = await changeRun(pluginId, copyId, async (stored) => {
        if (!stored) throw new Error(`copy ${copyId} not found`);
        // Nobody drives a queued copy yet, so it stops here.
        if (stored.status === 'queued') return { ...stored, status: 'stopped', driver: null, finishedAt: now().toISOString() };
        // Written, so a drive in any process sees it: its next save is refused, it reads this
        // record, and it obeys. The driver holds the true counts and puts them onto this record.
        if (stored.status === 'running' || stored.status === 'waiting') return { ...stored, status: 'stopping' };
        throw new Error(`copy ${copyId} is not running`);
      });
      if (run.status === 'stopping') {
        const entry = local.get(copyId);
        if (entry) entry.halt ??= 'stop';
      }
      await auditQuietly(deps.audit, { action: 'import.copy.stop', pluginId, connectorId: run.connectorId, runId: copyId, actor });
      return run;
    },

    async remove(pluginId, copyId, actor) {
      return changeRun(pluginId, copyId, async (stored) => {
        if (!stored) throw new Error(`copy ${copyId} not found`);
        if (!isTerminal(stored.status)) throw new Error(`copy ${copyId} is ${stored.status}; stop it before deleting it`);
        const check = deps.checks ? await ownDb('read', () => deps.checks!.liveCheckStatus(pluginId, copyId)) : null;
        if (check !== null && LIVE_CHECK.has(check)) {
          throw new Error(`copy ${copyId} has a check that is ${check}; stop it before deleting the copy`);
        }
        return { ...stored, status: 'deleting', driver: null, waiting: null };
      }, (next, stored) => auditOrRefuse(deps.audit, {
        action: 'import.copy.delete', pluginId, connectorId: next.connectorId, runId: copyId, actor, metadata: { status: stored?.status ?? null },
      }));
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
