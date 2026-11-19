import { randomBytes } from 'node:crypto';
import { open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  HELD_ITEMS_LIMIT_MAX, HELD_LABEL_MAX, HELD_LIST_LIMIT_MAX, LABORATORY_CODE, checkIdOf, createAppContext, isLiveCheck, recordCheckRead,
  type CheckRun, type ImportActor,
} from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor, cliNamedActor } from './cli-actor';
import { parseImportOptions } from './import';
import { outputTargetRefusal } from './output-target';
import { withCdrCuts } from './interruptions';

// `openldr import check ...`: check a finished copy with a plugin that decodes each request. Every
// command calls the check service the plugin page uses (packages/bootstrap/src/import-check.ts), so
// the checks and the audit trail are the same.
//
// `start` records the request and returns. The server drives the check. Nothing here waits for it.
// A stopped or failed check carries on from its last page unless --from-start is given.
//
// A run's `cursor` is a source key and its `driver` names a server process. Neither is printed, on
// the one-line form or in --json. The `findings` and `check` of a held request hold patient values.
// They go to the --export file and nowhere else: never to the terminal, never into an error text.

interface JsonOpt { json: boolean }

/** In served mode, the signed-in account, as cliActor() gives. As packages/cli/src/import-copy.ts. */
function actor(): ImportActor {
  const a = cliActor();
  if (a.actorType === 'user') return { type: 'user', id: a.actorId ?? null, name: a.actorName };
  return { type: 'cli', id: null, name: a.actorName };
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${human}\n`);
}

function wholeNumber(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${flag} must be a whole number`);
  return Number(raw);
}

/** The run as --json prints it: no cursor, no driver, no recheck keys. */
export function checkRunForJson(run: CheckRun): Omit<CheckRun, 'cursor' | 'driver' | 'recheck' | 'correcting'> {
  // A recheck names source keys, so it is left out like the cursor (review H5).
  const { cursor: _cursor, driver: _driver, recheck: _recheck, correcting: _correcting, ...rest } = run;
  return rest;
}

/** One line: the id, the status, the copy it checks (which `held` needs), then the counts. */
export function formatCheckRun(run: CheckRun): string {
  const c = run.counts;
  return `${run.id}  ${run.status}  copy=${run.copyId}  read=${c.read} saved=${c.saved} held=${c.held} failed=${c.failed}`;
}

/** Where a start begins, told from the run it got: a run that carried on has requests already read. */
function startedFrom(run: CheckRun): string {
  return run.counts.read > 0 ? `Carries on from ${run.counts.read} requests read.` : 'Starts from the first request.';
}

/** The run's line, a line for each laboratory when asked, and the last error on its own line. The
 *  error is the text the run holds, already safe to show, kept on one line. */
function formatCheckDetail(run: CheckRun, laboratories: boolean): string {
  const lines = [formatCheckRun(run)];
  if (laboratories) {
    for (const lab of run.laboratories ?? []) {
      const c = lab.counts;
      lines.push(`  ${lab.code ?? '(none)'}  read=${c.read} saved=${c.saved} held=${c.held} failed=${c.failed}`);
    }
  }
  if (run.lastError) lines.push(`error: ${run.lastError.replace(/\s+/g, ' ').trim()}`);
  return lines.join('\n');
}

export interface ImportCheckStartOpts extends JsonOpt {
  plugin: string;
  copy: string;
  reference?: string;
  option?: string[];
  pageSize?: string;
  fromStart?: boolean;
}

export async function runImportCheckStart(opts: ImportCheckStartOpts): Promise<number> {
  // Parse before connecting, so a typo fails without opening the database.
  const options = parseImportOptions(opts.option);
  const pageSize = wholeNumber('--page-size', opts.pageSize);
  const ctx = await createAppContext(loadConfig());
  try {
    const run = await ctx.importChecks.start({
      pluginId: opts.plugin, copyId: opts.copy, referenceCopyId: opts.reference ?? null, options,
      ...(pageSize !== undefined ? { pageSize } : {}),
      ...(opts.fromStart === true ? { fromStart: true } : {}),
      actor: actor(),
    });
    emit(opts.json, checkRunForJson(run), `${formatCheckRun(run)}\n${startedFrom(run)}`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportCheckStatus(
  pluginId: string, runId: string | undefined, opts: JsonOpt & { laboratories: boolean },
): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (runId === undefined) {
      const runs = await ctx.importChecks.list(pluginId);
      const shown = await withCdrCuts(ctx.jobInterruptions, runs, checkRunForJson, (r) => formatCheckDetail(r, opts.laboratories));
      emit(opts.json, shown.json, shown.text || '(no checks)');
      return 0;
    }
    const run = await ctx.importChecks.get(pluginId, runId);
    if (!run) {
      emit(opts.json, { error: 'check not found' }, `check ${runId} not found`);
      return 1;
    }
    const shown = await withCdrCuts(ctx.jobInterruptions, [run], checkRunForJson, (r) => formatCheckDetail(r, opts.laboratories));
    emit(opts.json, shown.json[0], shown.text);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportCheckStop(pluginId: string, runId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const run = await ctx.importChecks.stop(pluginId, runId, actor());
    emit(opts.json, checkRunForJson(run), formatCheckRun(run));
    return 0;
  } finally { await ctx.close(); }
}

export interface ImportCheckCorrectOpts extends JsonOpt {
  /** Repeated `field=value`. An empty value clears the field. */
  set: string[];
  reason?: string;
}

/** `import check correct`: corrections to one held request, then `recheck` checks it again
 *  (design 2026-11-18-held-corrections). Neither the key nor a value is printed. */
export async function runImportCheckCorrect(pluginId: string, copyId: string, key: string, opts: ImportCheckCorrectOpts): Promise<number> {
  const values: Record<string, string | null> = {};
  for (const pair of opts.set) {
    const at = pair.indexOf('=');
    const field = at > 0 ? pair.slice(0, at).trim() : '';
    if (field === '') throw new Error(`--set needs field=value, got ${JSON.stringify(pair.slice(0, 40))}`);
    const value = pair.slice(at + 1);
    values[field] = value === '' ? null : value;
  }
  if (Object.keys(values).length === 0) throw new Error('give at least one --set field=value');
  const reason = (opts.reason ?? '').trim();
  if (reason === '') throw new Error('--reason is required: say why the field is corrected');
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.importChecks.correct({ pluginId, copyId, key, values, reason, actor: actor() });
    const fields = Object.keys(values).sort();
    emit(opts.json, { fields, corrections: out.corrections.length },
      `corrected ${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.join(', ')}`);
    return 0;
  } finally { await ctx.close(); }
}

export interface ImportCheckChoicesOpts extends JsonOpt {
  /** One field only. */
  field?: string;
}

/** `import check choices`: the values a person may pick for each correctable field that has a
 *  fixed list, read from the copy's dictionaries by the plugin (demo.4 item 11). Use a code from it
 *  in `import check correct --set field=code`. */
export async function runImportCheckChoices(pluginId: string, copyId: string, opts: ImportCheckChoicesOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const all = await ctx.importChecks.choices(pluginId, copyId);
    // The list comes from the copy's dictionaries, so the read is audited as the held reads are.
    await recordCheckRead(ctx, cliNamedActor(), { pluginId, copyId, kind: 'choices' });
    const shown = opts.field === undefined ? all : (all[opts.field] ? { [opts.field]: all[opts.field]! } : {});
    if (opts.json) {
      process.stdout.write(JSON.stringify(shown) + '\n');
      return 0;
    }
    const lines = Object.entries(shown).flatMap(([field, list]) => list.map((c) => `${field}  ${c.code}  ${c.description}`));
    if (lines.length === 0) {
      process.stdout.write(opts.field === undefined ? 'no field of this plugin has a list of values\n' : `no list of values for ${opts.field}\n`);
      return 0;
    }
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } finally { await ctx.close(); }
}

/** `import check recheck`: checks one corrected held request again, in the run that held it. */
export async function runImportCheckRecheck(pluginId: string, copyId: string, key: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const run = await ctx.importChecks.recheck({ pluginId, copyId, key, actor: actor() });
    emit(opts.json, checkRunForJson(run), `${formatCheckRun(run)}\nThe server checks the request again. Run import check held to see whether it is still held.`);
    return 0;
  } finally { await ctx.close(); }
}

export interface ImportCheckHeldOpts extends JsonOpt {
  label?: string;
  reason?: string;
  laboratory?: string;
  offset?: string;
  limit?: string;
  export?: string;
  force?: boolean;
}

/** A filter of the held list, with the bounds the plugin broker gives it (the `import.check.held`
 *  op). The numbers come from the broker's own constants. One page of the export is the most the
 *  broker allows for `heldItems`. */
interface HeldFilters { reason?: 'held' | 'error'; label?: string; laboratory?: string }
const LIST_LIMIT_DEFAULT = 50;

function heldFilters(opts: ImportCheckHeldOpts): HeldFilters {
  const f: HeldFilters = {};
  if (opts.reason !== undefined) {
    if (opts.reason !== 'held' && opts.reason !== 'error') throw new Error('--reason must be held or error');
    f.reason = opts.reason;
  }
  if (opts.label !== undefined) {
    if (opts.label.length < 1 || opts.label.length > HELD_LABEL_MAX) throw new Error(`--label must be 1 to ${HELD_LABEL_MAX} characters`);
    f.label = opts.label;
  }
  if (opts.laboratory !== undefined) {
    if (!LABORATORY_CODE.test(opts.laboratory)) throw new Error('--laboratory must be 1 to 32 letters, digits, dots, dashes or underscores');
    f.laboratory = opts.laboratory;
  }
  return f;
}

export async function runImportCheckHeld(pluginId: string, copyId: string, opts: ImportCheckHeldOpts): Promise<number> {
  // Check every argument before connecting or touching a file.
  const filters = heldFilters(opts);
  const offset = wholeNumber('--offset', opts.offset);
  const limit = wholeNumber('--limit', opts.limit);
  if (limit !== undefined && (limit < 1 || limit > HELD_LIST_LIMIT_MAX)) throw new Error(`--limit must be 1 to ${HELD_LIST_LIMIT_MAX}`);
  if (opts.export !== undefined) {
    if (offset !== undefined || limit !== undefined) throw new Error('--export writes every row the filters match. Do not give --offset or --limit with it');
    return exportHeld(pluginId, copyId, filters, opts.export, opts);
  }

  const ctx = await createAppContext(loadConfig());
  try {
    const { rows, total } = await ctx.importChecks.held(pluginId, copyId, { ...filters, offset: offset ?? 0, limit: limit ?? LIST_LIMIT_DEFAULT });
    // The rows hold patient values, so the read leaves an audit row, as it does through the broker.
    await recordCheckRead(ctx, cliNamedActor(), { pluginId, copyId, kind: 'held' });
    // Named fields only, so a field added to a row later cannot reach the terminal. `error` is a bare code.
    const shown = rows.map((r) => ({ key: r.key, laboratory: r.laboratory, label: r.label, reason: r.reason, error: r.error, heldAt: r.heldAt }));
    const human = [
      ...shown.map((r) => [r.key, r.laboratory ?? '(none)', r.label ?? r.reason, r.error ?? '-', r.heldAt].join('  ')),
      `total ${total}`,
    ].join('\n');
    emit(opts.json, { rows: shown, total }, human);
    return 0;
  } finally { await ctx.close(); }
}

/** Writes every matching row, with its findings and check, to `path` as one JSON object per line.
 *  The file holds patient values, so it is made 0600 and nothing from it is printed.
 *
 *  The rows go to a new file beside the target, made exclusively with mode 0600. It is renamed over
 *  the target only when every row is in it. A failure removes that file and nothing else. */
async function exportHeld(pluginId: string, copyId: string, filters: HeldFilters, path: string, opts: ImportCheckHeldOpts): Promise<number> {
  const refusal = await outputTargetRefusal(path, opts.force === true, '--force');
  if (refusal !== null) {
    process.stderr.write(`${refusal}\n`);
    return 1;
  }
  let written = 0;
  const ctx = await createAppContext(loadConfig());
  try {
    // A check that is running adds and removes rows. Pages read by key do not move, but the file
    // would hold rows the check is still changing.
    const check = await ctx.importChecks.get(pluginId, checkIdOf(copyId));
    if (check && isLiveCheck(check.status)) {
      process.stderr.write('The check of this copy is running. Wait for it, or stop it, then export again.\n');
      return 1;
    }
    const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.part`);
    let file: FileHandle | null = await open(temp, 'wx', 0o600);
    let kept = false;
    try {
      // Read by key: each page starts after the last key of the one before, so a row added or
      // removed before it does not shift the page.
      let after: string | null = null;
      let total = 0;
      let audited = false;
      for (;;) {
        const page: { items: unknown[]; total: number; next?: string | null } =
          await ctx.importChecks.heldItems(pluginId, copyId, { ...filters, after, limit: HELD_ITEMS_LIMIT_MAX });
        // Once per export, after rows were read: the file now holds patient values.
        if (!audited) { await recordCheckRead(ctx, cliNamedActor(), { pluginId, copyId, kind: 'heldItems' }); audited = true; }
        total = page.total;
        if (page.items.length > 0) {
          await file.appendFile(page.items.map((i) => `${JSON.stringify(i)}\n`).join(''));
          written += page.items.length;
        }
        if (page.items.length === 0 || page.next === null || page.next === undefined) break;
        after = page.next;
      }
      // Rows moved while the export ran: the file would repeat or miss a request.
      if (written !== total) {
        process.stderr.write(`The export is not whole: ${written} requests were read and the total is ${total}. The file was not written. Run it again.\n`);
        return 1;
      }
      await file.close();
      file = null;
      await rename(temp, path);
      kept = true;
    } finally {
      await file?.close().catch(() => undefined);
      if (!kept) await unlink(temp).catch(() => undefined);
    }
  } finally { await ctx.close(); }
  emit(opts.json, { exported: written, path }, `${written} requests written to ${path}`);
  return 0;
}
