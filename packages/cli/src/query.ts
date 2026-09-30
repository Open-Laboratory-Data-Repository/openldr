import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import {
  createAppContext, exportCustomQueries, importCustomQueries, recordAuditEvent,
  type ImportResult,
} from '@openldr/bootstrap';
import { createCustomQueryStore, referenceCapture } from '@openldr/db';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

export interface QueryExportOpts {
  /** Query names to export. Omitted means every custom query. */
  name?: string[];
  out: string;
  json: boolean;
}

export interface QueryImportOpts {
  /** Connector name for queries that get created. Defaults to the default connector. */
  connector?: string;
  /** Replace queries whose name already exists. Without it they are skipped. */
  force: boolean;
  json: boolean;
}

// Same store the server builds (apps/server/src/app.ts). referenceCapture is what makes a query
// written on a central install reach the labs. ctx.customQueries has no capture, so never use it.
function buildDeps(ctx: Awaited<ReturnType<typeof createAppContext>>) {
  return {
    customQueries: createCustomQueryStore(ctx.internalDb, referenceCapture),
    connectors: { list: () => ctx.connectors.list() },
  };
}

/**
 * `openldr query export [--name <name...>] --out <file> [--json]`
 *
 * Writes custom queries to a JSON file. The same `exportCustomQueries` the studio calls.
 */
export async function runQueryExport(opts: QueryExportOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const select = opts.name && opts.name.length > 0 ? { names: opts.name } : undefined;
    const file = await exportCustomQueries(buildDeps(ctx), select);
    writeFileSync(opts.out, JSON.stringify(file, null, 2) + '\n', 'utf8');
    if (opts.json) {
      process.stdout.write(JSON.stringify({ out: opts.out, count: file.queries.length }) + '\n');
    } else {
      process.stdout.write(`exported ${file.queries.length} ${file.queries.length === 1 ? 'query' : 'queries'} to ${opts.out}\n`);
    }
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`query export failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function namesIn(file: unknown): string[] {
  const queries = (file as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) return [];
  return queries
    .map((q) => (q as { name?: unknown } | null)?.name)
    .filter((n): n is string => typeof n === 'string');
}

function formatImportHuman(result: ImportResult): string {
  const count = (o: string) => result.results.filter((r) => r.outcome === o).length;
  const lines = result.results.map((r) => `${r.outcome.padEnd(8)}  ${r.name}`);
  lines.push(`${count('created')} created, ${count('replaced')} replaced, ${count('skipped')} skipped.`);
  return lines.join('\n');
}

/**
 * `openldr query import <file> [--connector <name>] [--force] [--json]`
 *
 * Reads a custom query file and writes it. Names that already exist are skipped unless --force,
 * which replaces them. The same `importCustomQueries` the studio calls.
 */
export async function runQueryImport(file: string, opts: QueryImportOpts): Promise<number> {
  const fail = (msg: string): number => {
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`query import failed: ${msg}\n`);
    return 1;
  };

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    return fail(`cannot read ${file}: ${redactError(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(`${file} is not valid JSON`);
  }

  const ctx = await createAppContext(loadConfig());
  try {
    const deps = buildDeps(ctx);
    // Read the existing rows first, so a replace can record what it overwrote.
    const beforeByName = new Map<string, unknown>();
    for (const name of namesIn(parsed)) {
      const hit = await deps.customQueries.getByName(name);
      if (hit) beforeByName.set(name, hit);
    }

    const result = await importCustomQueries(deps, parsed, { connectorName: opts.connector, replace: opts.force });

    for (const r of result.results) {
      if (r.outcome === 'skipped') continue;
      const after = await deps.customQueries.get(r.id);
      await recordAuditEvent(ctx, cliActor(), {
        action: r.outcome === 'created' ? 'customQuery.create' : 'customQuery.update',
        entityType: 'customQuery',
        entityId: r.id,
        before: r.outcome === 'created' ? null : (beforeByName.get(r.name) ?? null),
        after,
      });
    }

    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write(formatImportHuman(result) + '\n');
    return 0;
  } catch (err) {
    return fail(redactError(err));
  } finally {
    await ctx.close();
  }
}
