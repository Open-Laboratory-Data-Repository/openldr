import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redact } from '@openldr/core';
import {
  CopySetTooLargeError, type CopyRow, type HeldItem, type HeldReason, type HeldRow, type ImportCheckHeldStore,
  type ImportCopyStore, type Provenance,
} from '@openldr/db';
import { allowedResourceTypes, canCheck } from '@openldr/marketplace';
import type { CopyRun, ImportCopyService } from './import-copy';
import {
  STALE_MS, StoppedWhileWaiting, auditOrRefuse, auditQuietly, checkResources, loadImportSinkWaiting, optionsSchema,
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
// CE reads `key`, `held`, `resources`, `error` and `label` of a group, and nothing inside
// `findings` or `check`. Those two are kept as the plugin gave them, only in the held-back store.
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
/** A wait is slept in slices this long, so a stop or a release is felt within a second. */
const WAIT_SLICE_MS = 1000;
const SYSTEM: ImportActor = { type: 'system', id: null, name: 'system' };

export type CheckStatus = 'queued' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed';

export interface CheckCounts { read: number; saved: number; held: number; failed: number; resources: number; labels: Record<string, number> }

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
  waiting: { since: string; attempt: number; error: string } | null;
  /** The id of the process driving it, or null when nobody does. */
  driver: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  startedBy: string;
}

export interface ImportCheckStartInput {
  pluginId: string;
  copyId: string;
  referenceCopyId: string | null;
  options: Record<string, string>;
  pageSize?: number;
  actor: ImportActor;
}

export interface ImportCheckService {
  /** Plugins that can be checked. `needsReference`: the plugin names a twin-keys entrypoint. */
  checkers(): Promise<Array<{ id: string; version: string; needsReference: boolean }>>;
  start(input: ImportCheckStartInput): Promise<CheckRun>;
  get(pluginId: string, runId: string): Promise<CheckRun | null>;
  list(pluginId: string): Promise<CheckRun[]>;
  stop(pluginId: string, runId: string, actor: ImportActor): Promise<CheckRun>;
  held(pluginId: string, copyId: string, opts: { reason?: HeldReason; label?: string; offset: number; limit: number }): Promise<{ rows: HeldRow[]; total: number }>;
  heldItem(pluginId: string, copyId: string, key: string): Promise<HeldItem | null>;
  /** Server only. Take every run that needs a driver and start driving it. Does not wait. */
  tick(): Promise<void>;
  /** Resolves when this process is driving nothing. */
  idle(): Promise<void>;
  /** Tell every drive here to let go at its next check, leaving the stored status for the next
   *  server. After this, `tick` takes nothing. */
  release(): Promise<void>;
}

export interface ImportCheckServiceDeps extends Pick<ImportServiceDeps, 'plugins' | 'pluginData' | 'audit' | 'persist' | 'now'> {
  /** The copy rows, read only. */
  copyStore: ImportCopyStore;
  held: ImportCheckHeldStore;
  /** To read a copy's record. A copy belongs to the plugin whose id it is read under. */
  copies: Pick<ImportCopyService, 'get'>;
  /** This process. Written on each run it drives. */
  driverId: string;
  /** Injectable for tests; the wait while CE's own database does not answer. */
  sleep?: (ms: number) => Promise<void>;
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
});
const decodeOutputSchema = z.object({ groups: z.array(groupSchema) });
const twinKeysOutputSchema = z.object({ keys: z.array(z.string()) });
type Group = z.infer<typeof groupSchema>;

/** A failure of CE's own database. Only the SQLSTATE code is kept: the rest can quote a row. */
class OwnDbFault extends Error {}
/** A failure whose fixed text is kept as it is, with no value in it. */
class CheckFault extends Error {}
/** The plugin's decode or twin-keys call threw, timed out, or gave what is not its schema. */
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

/** Rows of a page as the copy stored them, by detail name. */
function byDetail(rows: CopyRow[]): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const r of rows) (out[r.detail] ??= []).push(r.row);
  return out;
}
const emptyTwins = (): Record<string, Array<Record<string, unknown>>> => ({ requests: [], results: [] });
const freshCounts = (): CheckCounts => ({ read: 0, saved: 0, held: 0, failed: 0, resources: 0, labels: {} });
const isLive = (s: CheckStatus): boolean => s === 'queued' || s === 'running' || s === 'waiting' || s === 'stopping';
/** Statuses a driver holds. A run in one of them with no write for 2 minutes has no driver. */
const isDriven = (s: CheckStatus): boolean => s === 'running' || s === 'waiting' || s === 'stopping';
const validLabel = (label: string | undefined): string | null => (label !== undefined && LABEL.test(label) ? label : null);

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
    return {
      ...stored, counts: { ...stored.counts, labels: { ...stored.counts.labels } },
      waiting: stored.waiting ?? null, driver: stored.driver ?? null,
    };
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

  /** Writing, heartbeat and halting. A copy of the copy service's own, with no delete. */
  function driving(run: CheckRun, entry: Drive) {
    // The cursor and counts as they stood at the last page end. Only these are ever saved, so a
    // crash in the middle of a page leaves a record from which that page is read again in full.
    const snapshot = () => ({ cursor: run.cursor, counts: structuredClone(run.counts) });
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
        const doc: CheckRun = { ...run, cursor: pageEnd.cursor, counts: structuredClone(pageEnd.counts) };
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
    const rewind = (): void => { run.cursor = pageEnd.cursor; run.counts = structuredClone(pageEnd.counts); };
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

      /** Every set of the source copy but `requests`, read whole, by set name. */
      const readDictionaries = async (source: CopyRun): Promise<Record<string, Array<Record<string, unknown>>>> => {
        const out: Record<string, Array<Record<string, unknown>>> = {};
        let used = 0;
        for (const name of source.setOrder ?? Object.keys(source.sets)) {
          if (name === REQUESTS) continue;
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

      const callPlugin = async (entrypoint: string, input: unknown): Promise<unknown> => {
        try {
          return await sink.invoke(entrypoint, input);
        } catch {
          throw new PluginCallFault();
        }
      };

      /** The reference rows for a page, by detail, or empty twins when there is no reference. */
      const readTwins = async (keys: string[]): Promise<Record<string, Array<Record<string, unknown>>>> => {
        if (!useTwins) return emptyTwins();
        const parsed = twinKeysOutputSchema.safeParse(await callPlugin(plugin.twinKeys!, { options: run.options, keys }));
        if (!parsed.success) throw new PluginCallFault();
        const rows = await ownDb('read', () => deps.copyStore.read(run.referenceCopyId!, TWINS, parsed.data.keys));
        return { ...emptyTwins(), ...byDetail(rows) };
      };

      const countLabel = (label: string | undefined): void => {
        if (label === undefined) return;
        const labels = run.counts.labels;
        const named = Object.keys(labels).filter((l) => l !== OTHER_LABEL).length;
        const name = validLabel(label) !== null && (label in labels || named < MAX_LABELS) ? label : OTHER_LABEL;
        labels[name] = (labels[name] ?? 0) + 1;
      };
      const keepFailed = async (key: string, error: string, label: string | null): Promise<void> => {
        await ownDb('write', () => deps.held.put({ copyId: run.copyId, key, runId: run.id, reason: 'error', label, error, findings: null, check: null }));
        run.counts.failed += 1;
      };

      let dictionaries: Record<string, Array<Record<string, unknown>>> | null = null;
      // A page the plugin could not decode is halved, and doubles again after 5 good pages in a
      // row, never above the run's own page size.
      let size = run.pageSize;
      let goodInRow = 0;

      /** One page. 'done' when the set `requests` has no key left. */
      const onePage = async (): Promise<'done' | 'next' | 'lost'> => {
        const keys = await ownDb('read', () => deps.copyStore.listKeys(run.copyId, REQUESTS, run.cursor, size));
        if (keys.length === 0) return 'done';
        const rows = byDetail(await ownDb('read', () => deps.copyStore.read(run.copyId, REQUESTS, keys)));

        let groups: Map<string, Group> | null = null;
        try {
          const twins = await readTwins(keys);
          const raw = await callPlugin(plugin.decode, { options: run.options, now: now().toISOString(), dictionaries, keys, rows, twins });
          const parsed = decodeOutputSchema.safeParse(raw);
          if (!parsed.success) throw new PluginCallFault();
          groups = new Map();
          for (const g of parsed.data.groups) if (!groups.has(g.key)) groups.set(g.key, g);
        } catch (err) {
          if (!(err instanceof PluginCallFault)) throw err;
        }
        // Another process may hold the run now. Then nothing of this page is written.
        if ((await d.haltWanted()) === 'lost') return 'lost';

        if (groups === null) {
          // Nothing of the page is saved. Halve it and read the same cursor again.
          if (keys.length > 1) {
            size = shrinkPage(keys.length);
            goodInRow = 0;
            return 'next';
          }
          await keepFailed(keys[0], 'DECODE_FAILED', null);
          run.counts.read += 1;
          run.cursor = keys[0];
          size = 1;
          goodInRow = 0;
          return 'next';
        }
        goodInRow += 1;
        const grown = growPage(size, run.pageSize, goodInRow);
        if (grown !== size) { size = grown; goodInRow = 0; }

        const saved: string[] = [];
        for (const key of keys) {
          const group = groups.get(key);
          if (!group) { await keepFailed(key, 'NO_GROUP', null); continue; }
          countLabel(group.label);
          const label = validLabel(group.label);
          if (group.error !== undefined) { await keepFailed(key, pluginCode(group.error), label); continue; }
          if (group.held === true) {
            await ownDb('write', () => deps.held.put({
              copyId: run.copyId, key, runId: run.id, reason: 'held', label, error: null,
              // The store needs a value. A group that gave none is kept as null.
              findings: group.findings ?? null, check: group.check ?? null,
            }));
            run.counts.held += 1;
            continue;
          }
          const resources = group.resources ?? [];
          const refused = checkResources(resources, allowedTypes);
          if (refused) { await keepFailed(key, refused, label); continue; }
          try {
            await deps.persist(resources, provenance);
          } catch (err) {
            await keepFailed(key, saveCode(err), label);
            continue;
          }
          saved.push(key);
          run.counts.saved += 1;
          run.counts.resources += resources.length;
        }
        // A request that passes now leaves the held-back store.
        if (saved.length > 0) await ownDb('write', () => deps.held.remove(run.copyId, saved));
        run.counts.read += keys.length;
        run.cursor = keys[keys.length - 1];
        return 'next';
      };

      /** Tries in a row that CE's own database refused. */
      let dbAttempt = 0;
      for (;;) {
        if (entry.halt) return haltOutcome(entry.halt);
        let step: 'done' | 'next' | 'lost';
        try {
          if (dictionaries === null) {
            const source = await completedCopy(run.pluginId, run.copyId);
            if (useTwins) await completedCopy(run.pluginId, run.referenceCopyId!);
            dictionaries = await readDictionaries(source);
          }
          step = await onePage();
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
          // CE's own database did not answer. Put the page back, wait, and read it again.
          d.rewind();
          dbAttempt += 1;
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

  async function finishDrive(run: CheckRun, d: ReturnType<typeof driving>, outcome: CheckOutcome): Promise<void> {
    d.rewind();
    if (outcome === 'lost') return;
    if (outcome === 'release') {
      await d.saveInTurn().catch(() => false);
      return;
    }
    run.status = outcome;
    run.waiting = null;
    run.driver = null;
    run.finishedAt = now().toISOString();
    if (!(await d.saveInTurn().catch(() => true))) return;
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
        const previous = stored.driver ?? null;
        const run: CheckRun = {
          ...stored, driver: deps.driverId, waiting: null,
          status: stored.status === 'queued' || stored.status === 'waiting' ? 'running' : stored.status,
        };
        if (!(await writeIfRev(run, stored.rev))) continue;
        if (released) return;
        if (!unclaimed && previous !== null && previous !== deps.driverId) {
          await auditQuietly(deps.audit, {
            action: 'import.check.takeover', pluginId: run.pluginId, runId: run.id, actor: SYSTEM, metadata: { status: stored.status },
          });
        }
        launch(run);
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
      await completedCopy(plugin.id, input.copyId);
      const referenceCopyId = input.referenceCopyId ?? null;
      if (referenceCopyId !== null) {
        if (referenceCopyId === input.copyId) throw new Error('the reference copy must be another copy than the source copy');
        await completedCopy(plugin.id, referenceCopyId);
      }
      const id = checkIdOf(input.copyId);

      return changeRun(plugin.id, id, async (existing) => {
        if (existing && isLive(existing.status)) {
          throw new Error(`check ${id} is ${existing.status}; stop it before starting it again`);
        }
        // New, or ended: begin at the first key with counts at zero.
        const at = now().toISOString();
        return {
          id, kind: 'check', rev: existing?.rev ?? 0, pluginId: plugin.id, pluginVersion: plugin.version,
          copyId: input.copyId, referenceCopyId, status: 'queued', options, pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
          cursor: null, counts: freshCounts(), waiting: null, driver: null,
          startedAt: at, updatedAt: at, finishedAt: null, lastError: null, startedBy: input.actor.name,
        };
      }, (next) => auditOrRefuse(deps.audit, {
        action: 'import.check.start', pluginId: plugin.id, runId: id, actor: input.actor,
        metadata: { copyId: next.copyId, referenceCopyId: next.referenceCopyId, pageSize: next.pageSize },
      }));
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
      return ownDb('read', () => deps.held.get(copyId, key));
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
