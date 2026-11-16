import { open, unlink } from 'node:fs/promises';
import { LABORATORY_CODE, createAppContext, type CheckRun, type ImportActor } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';
import { parseImportOptions } from './import';

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

/** A filter of the held list, with the bounds the plugin broker gives it (plugin-broker.ts, the
 *  `import.check.held` op). One page of the export reads at most the broker's 200 for heldItems. */
interface HeldFilters { reason?: 'held' | 'error'; label?: string; laboratory?: string }
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 100;
const EXPORT_PAGE = 200;

function heldFilters(opts: ImportCheckHeldOpts): HeldFilters {
  const f: HeldFilters = {};
  if (opts.reason !== undefined) {
    if (opts.reason !== 'held' && opts.reason !== 'error') throw new Error('--reason must be held or error');
    f.reason = opts.reason;
  }
  if (opts.label !== undefined) {
    if (opts.label.length < 1 || opts.label.length > 64) throw new Error('--label must be 1 to 64 characters');
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
  if (limit !== undefined && (limit < 1 || limit > LIST_LIMIT_MAX)) throw new Error(`--limit must be 1 to ${LIST_LIMIT_MAX}`);
  if (opts.export !== undefined) {
    if (offset !== undefined || limit !== undefined) throw new Error('--export writes every row the filters match. Do not give --offset or --limit with it');
    return exportHeld(pluginId, copyId, filters, opts.export, opts);
  }

  const ctx = await createAppContext(loadConfig());
  try {
    const { rows, total } = await ctx.importChecks.held(pluginId, copyId, { ...filters, offset: offset ?? 0, limit: limit ?? LIST_LIMIT_DEFAULT });
    // The rows never carry findings. `error` is a bare code.
    const human = [
      ...rows.map((r) => [r.key, r.laboratory ?? '(none)', r.label ?? r.reason, r.error ?? '-', r.heldAt].join('  ')),
      `total ${total}`,
    ].join('\n');
    emit(opts.json, { rows, total }, human);
    return 0;
  } finally { await ctx.close(); }
}

/** Writes every matching row, with its findings and check, to `path` as one JSON object per line.
 *  The file holds patient values, so it is made 0600 and nothing from it is printed. */
async function exportHeld(pluginId: string, copyId: string, filters: HeldFilters, path: string, opts: ImportCheckHeldOpts): Promise<number> {
  let file;
  try {
    file = await open(path, opts.force ? 'w' : 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      process.stderr.write(`${path} already exists. Run again with --force to write over it.\n`);
      return 1;
    }
    throw err;
  }
  let written = 0;
  let ok = false;
  try {
    // A file that already existed keeps its old mode when opened. Make it private before any row is written.
    await file.chmod(0o600);
    const ctx = await createAppContext(loadConfig());
    try {
      let offset = 0;
      for (;;) {
        const { items, total } = await ctx.importChecks.heldItems(pluginId, copyId, { ...filters, offset, limit: EXPORT_PAGE });
        if (items.length === 0) break;
        await file.write(items.map((i) => `${JSON.stringify(i)}\n`).join(''));
        written += items.length;
        offset += items.length;
        if (offset >= total) break;
      }
    } finally { await ctx.close(); }
    ok = true;
  } finally {
    await file.close();
    if (!ok) await unlink(path).catch(() => undefined);
  }
  emit(opts.json, { exported: written, path }, `${written} requests written to ${path}`);
  return 0;
}
