import { createAppContext, type ImportActor, type ImportRun } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

// `openldr import ...`: run an import from a host database connector with a plugin that declares
// an import source. Every command calls the same import service the studio uses
// (packages/bootstrap/src/import-run.ts), so the checks and the audit trail are identical.

interface JsonOpt { json: boolean }

function actor(): ImportActor {
  return { type: 'cli', id: null, name: cliActor().actorName };
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${human}\n`);
}

/** `--option name=value`, repeatable. Only the first `=` splits, so a value may contain one. */
export function parseImportOptions(pairs: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const at = pair.indexOf('=');
    if (at < 1) throw new Error(`--option takes name=value, got "${pair}"`);
    out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

function wholeNumber(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${flag} must be a whole number`);
  return Number(raw);
}

/** One line per run. Holds counts and the last key only, never a row value. */
export function formatImportRun(run: ImportRun): string {
  const c = run.counts;
  return [
    run.id,
    `${run.status}${run.dryRun ? ' (dry run)' : ''}`,
    `keys=${c.keys} imported=${c.imported} failed=${c.failed} resources=${c.resources}`,
    `cursor=${run.cursor ?? '-'}${run.lastError ? `  error: ${run.lastError}` : ''}`,
  ].join('  ');
}

/** 0 only for a completed run with no failed request. */
function exitCodeFor(run: ImportRun): number {
  return run.status === 'completed' && run.counts.failed === 0 ? 0 : 1;
}

export async function runImportAllow(pluginId: string, connectorId: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await ctx.imports.allow(pluginId, connectorId, actor());
    process.stdout.write(`allowed ${pluginId} to read connector ${connectorId}\n`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportRevoke(pluginId: string, connectorId: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await ctx.imports.revoke(pluginId, connectorId, actor());
    process.stdout.write(`${pluginId} may no longer read connector ${connectorId}\n`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportAllowed(pluginId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const ids = await ctx.imports.allowed(pluginId);
    emit(opts.json, ids, ids.join('\n') || '(no connectors allowed)');
    return 0;
  } finally { await ctx.close(); }
}

type Imports = Awaited<ReturnType<typeof createAppContext>>['imports'];

/** Wait for a run this process is driving. Prints progress to stderr, and turns Ctrl+C into a
 *  clean stop at the next page so the run can be resumed. */
async function follow(imports: Imports, started: ImportRun): Promise<ImportRun> {
  let lastKeys = -1;
  const timer = setInterval(() => {
    void imports.get(started.pluginId, started.id).then((r) => {
      if (r && r.counts.keys !== lastKeys) {
        lastKeys = r.counts.keys;
        process.stderr.write(`${formatImportRun(r)}\n`);
      }
    }).catch(() => {});
  }, 2000);
  const onInterrupt = (): void => {
    process.stderr.write('stopping at the next page; resume with `openldr import resume`\n');
    void imports.stop(started.pluginId, started.id, actor()).catch(() => {});
  };
  process.once('SIGINT', onInterrupt);
  try {
    return await imports.wait(started.id);
  } finally {
    clearInterval(timer);
    process.removeListener('SIGINT', onInterrupt);
  }
}

export interface ImportStartOpts extends JsonOpt {
  plugin: string;
  connector: string;
  option?: string[];
  limit?: string;
  pageSize?: string;
  dryRun: boolean;
}

export async function runImportStart(opts: ImportStartOpts): Promise<number> {
  // Parse before connecting, so a typo fails without opening the database.
  const options = parseImportOptions(opts.option);
  const limit = wholeNumber('--limit', opts.limit);
  const pageSize = wholeNumber('--page-size', opts.pageSize);
  const ctx = await createAppContext(loadConfig());
  try {
    const started = await ctx.imports.start({
      pluginId: opts.plugin, connectorId: opts.connector, options,
      ...(limit !== undefined ? { limit } : {}),
      ...(pageSize !== undefined ? { pageSize } : {}),
      dryRun: opts.dryRun, actor: actor(),
    });
    const done = await follow(ctx.imports, started);
    emit(opts.json, done, formatImportRun(done));
    return exitCodeFor(done);
  } finally { await ctx.close(); }
}

export async function runImportResume(pluginId: string, runId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const started = await ctx.imports.resume(pluginId, runId, actor());
    const done = await follow(ctx.imports, started);
    emit(opts.json, done, formatImportRun(done));
    return exitCodeFor(done);
  } finally { await ctx.close(); }
}

export async function runImportStatus(pluginId: string, runId: string | undefined, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (runId === undefined) {
      const runs = await ctx.imports.list(pluginId);
      emit(opts.json, runs, runs.map(formatImportRun).join('\n') || '(no import runs)');
      return 0;
    }
    const run = await ctx.imports.get(pluginId, runId);
    if (!run) {
      emit(opts.json, { error: 'import run not found' }, `import run ${runId} not found`);
      return 1;
    }
    emit(opts.json, run, formatImportRun(run));
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportStop(pluginId: string, runId: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const run = await ctx.imports.stop(pluginId, runId, actor());
    process.stdout.write(`${formatImportRun(run)}\n`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runImportFailures(pluginId: string, runId: string, opts: JsonOpt): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const failures = await ctx.imports.failures(pluginId, runId);
    emit(opts.json, failures, failures.map((f) => `${f.key}\t${f.error}`).join('\n') || '(no failures)');
    return 0;
  } finally { await ctx.close(); }
}
