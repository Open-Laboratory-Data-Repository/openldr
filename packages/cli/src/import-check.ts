import { randomBytes } from 'node:crypto';
import { open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  HELD_ITEMS_LIMIT_MAX, HELD_LABEL_MAX, HELD_LIST_LIMIT_MAX, LABORATORY_CODE, checkIdOf, createAppContext, recordCheckRead,
  type CheckRun, type ImportActor,
} from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor, cliNamedActor } from './cli-actor';
import { parseImportOptions } from './import';
import { outputTargetRefusal } from './output-target';

// `openldr import check ...`: check a finished copy with a plugin that decodes each request. Every
// command calls the check service the plugin page uses (packages/bootstrap/src/import-check.ts), so
// the checks and the audit trail are the same.
//
// `start` records the request and returns. The server drives the check. Nothing here waits for it.
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

/** The run as --json prints it: no cursor, no driver. */
export function checkRunForJson(run: CheckRun): Omit<CheckRun, 'cursor' | 'driver'> {
  const { cursor: _cursor, driver: _driver, ...rest } = run;
  return rest;
}

/** One line: the id, the status, then the counts. */
export function formatCheckRun(run: CheckRun): string {
  const c = run.counts;
  return `${run.id}  ${run.status}  read=${c.read} saved=${c.saved} held=${c.held} failed=${c.failed}`;
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
      actor: actor(),
    });
    emit(opts.json, checkRunForJson(run), formatCheckRun(run));
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
      emit(opts.json, runs.map(checkRunForJson), runs.map((r) => formatCheckDetail(r, opts.laboratories)).join('\n') || '(no checks)');
      return 0;
    }
    const run = await ctx.importChecks.get(pluginId, runId);
    if (!run) {
      emit(opts.json, { error: 'check not found' }, `check ${runId} not found`);
      return 1;
    }
    emit(opts.json, checkRunForJson(run), formatCheckDetail(run, opts.laboratories));
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

/** Statuses of a check that still adds and removes held rows. */
const LIVE_CHECK = new Set(['queued', 'running', 'waiting', 'stopping']);

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
    // A check that is running adds and removes rows, so pages would repeat or skip one.
    const check = await ctx.importChecks.get(pluginId, checkIdOf(copyId));
    if (check && LIVE_CHECK.has(check.status)) {
      process.stderr.write('The check of this copy is running. Wait for it, or stop it, then export again.\n');
      return 1;
    }
    const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.part`);
    let file: FileHandle | null = await open(temp, 'wx', 0o600);
    let kept = false;
    try {
      let offset = 0;
      let total = 0;
      let audited = false;
      for (;;) {
        const page = await ctx.importChecks.heldItems(pluginId, copyId, { ...filters, offset, limit: HELD_ITEMS_LIMIT_MAX });
        // Once per export, after rows were read: the file now holds patient values.
        if (!audited) { await recordCheckRead(ctx, cliNamedActor(), { pluginId, copyId, kind: 'heldItems' }); audited = true; }
        total = page.total;
        if (page.items.length === 0) break;
        await file.appendFile(page.items.map((i) => `${JSON.stringify(i)}\n`).join(''));
        written += page.items.length;
        offset += page.items.length;
        if (offset >= total) break;
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
