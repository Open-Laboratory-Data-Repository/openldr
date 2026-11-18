import { CopySetChangedError, createAppContext, type CopyRun, type ImportActor } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';
import { parseImportOptions } from './import';
import { withCdrCuts } from './interruptions';

// `openldr import copy ...`: copy the rows of a source database to CE's own disk with a plugin that
// names the rows to copy. Every command calls the copy service the plugin page uses
// (packages/bootstrap/src/import-copy.ts), so the checks and the audit trail are the same.
//
// `start` records the request and returns. The server drives the copy. Nothing here waits for it.
//
// A set's `cursor` is a source key. It is never printed, on the one-line form or in --json.

interface JsonOpt { json: boolean }

/** In served mode, the signed-in account, as cliActor() gives. As packages/cli/src/import.ts. */
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

/** The run as --json prints it: each set without its cursor. */
export function copyRunForJson(run: CopyRun): Omit<CopyRun, 'sets'> & { sets: Record<string, Omit<CopyRun['sets'][string], 'cursor'>> } {
  const sets: Record<string, Omit<CopyRun['sets'][string], 'cursor'>> = {};
  for (const [name, progress] of Object.entries(run.sets)) {
    const { cursor: _cursor, ...rest } = progress;
    sets[name] = rest;
  }
  return { ...run, sets };
}

/** One line per copy: the id, the status, the counts of each set, then the error when waiting or
 *  failed. The error is the text the run holds, already safe to show, kept on one line. A
 *  completed copy with a skipped key left reads `completed with skipped keys`, never a bare
 *  `completed` (spec 9.3). */
export function formatCopyRun(run: CopyRun): string {
  const skipped = Object.values(run.sets).some((p) => p.skipped > 0);
  const parts = [run.id, run.status === 'completed' && skipped ? 'completed with skipped keys' : run.status];
  for (const [name, p] of Object.entries(run.sets)) {
    parts.push(`${name} keys=${p.keys} rows=${p.rows} bytes=${p.bytes} skipped=${p.skipped}`);
  }
  const error = run.status === 'waiting' ? run.waiting?.error : run.status === 'failed' ? run.lastError : null;
  if (error) parts.push(`error: ${error.replace(/\s+/g, ' ').trim()}`);
  return parts.join('  ');
}

/** The service's refusal when a set's SQL changed and reread was not given. */
function changedSetsOf(err: unknown): string[] | null {
  return err instanceof CopySetChangedError ? [...err.sets] : null;
}

export interface ImportCopyStartOpts extends JsonOpt {
  plugin: string;
  connector: string;
  option?: string[];
  pageSize?: string;
  reread: boolean;
}

export async function runImportCopyStart(opts: ImportCopyStartOpts): Promise<number> {
  // Parse before connecting, so a typo fails without opening the database.
  const options = parseImportOptions(opts.option);
  const pageSize = wholeNumber('--page-size', opts.pageSize);
  const ctx = await createAppContext(loadConfig());
  try {
    let run: CopyRun;
    try {
      run = await ctx.importCopies.start({
        pluginId: opts.plugin, connectorId: opts.connector, options,
        ...(pageSize !== undefined ? { pageSize } : {}),
        reread: opts.reread, actor: actor(),
      });
    } catch (err) {
      const sets = changedSetsOf(err);
      if (!sets) throw err;
      emit(opts.json, { changedSets: sets },
        `these sets would be read again from the start: ${sets.join(', ')}. Run again with --reread to do that.`);
      return 1;
    }
    emit(opts.json, copyRunForJson(run), formatCopyRun(run));
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportCopyStatus(pluginId: string, copyId: string | undefined, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (copyId === undefined) {
      const runs = await ctx.importCopies.list(pluginId);
      const shown = await withCdrCuts(ctx.jobInterruptions, runs, copyRunForJson, formatCopyRun);
      emit(opts.json, shown.json, shown.text || '(no copies)');
      return 0;
    }
    const run = await ctx.importCopies.get(pluginId, copyId);
    if (!run) {
      emit(opts.json, { error: 'copy not found' }, `copy ${copyId} not found`);
      return 1;
    }
    const shown = await withCdrCuts(ctx.jobInterruptions, [run], copyRunForJson, formatCopyRun);
    emit(opts.json, shown.json[0], shown.text);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportCopyStop(pluginId: string, copyId: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const run = await ctx.importCopies.stop(pluginId, copyId, actor());
    process.stdout.write(`${formatCopyRun(run)}\n`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportCopyDelete(pluginId: string, copyId: string, opts: { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(`import copy delete removes every row copied for ${copyId}. Run again with --force to do that.\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const run = await ctx.importCopies.remove(pluginId, copyId, actor());
    process.stdout.write(`${formatCopyRun(run)}\n`);
    return 0;
  } finally { await ctx.close(); }
}
