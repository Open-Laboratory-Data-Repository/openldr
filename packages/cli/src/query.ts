import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import {
  createAppContext, createDbContext, explorerGroupName, exportCustomQueries, importCustomQueries, recordAuditEvent,
  type ImportResult,
} from '@openldr/bootstrap';
import { createCustomQueryGroupStore, createCustomQueryStore, referenceCapture } from '@openldr/db';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';
import { servedCaller } from './served-caller';

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
    customQueryGroups: createCustomQueryGroupStore(ctx.internalDb),
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
    // --force overwrites saved queries, so it needs query.manage, as the import route does (demo.4
    // item 13). A local run is the machine's operator and is not checked.
    const caller = await servedCaller(ctx);
    const manages = caller === 'local' || caller?.capabilities.includes('query.manage') === true;
    if (opts.force && !manages) return fail('--force replaces saved queries and needs query.manage');
    const deps = buildDeps(ctx);
    // Read the existing rows first, so a replace can record what it overwrote.
    const beforeByName = new Map<string, unknown>();
    for (const name of namesIn(parsed)) {
      const hit = await deps.customQueries.getByName(name);
      if (hit) beforeByName.set(name, hit);
    }

    const result = await importCustomQueries(deps, parsed, { connectorName: opts.connector, replace: opts.force, arrange: manages });

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

// `openldr query groups ...`: the groups of the Query page's Connectors and Datasets lists. The same
// store the Query page's routes use. Custom Queries has its own groups, moved by `query import`.

type GroupKind = 'connector' | 'dataset';
interface GroupOpts { kind: string; json: boolean }

function say(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${human}\n`);
}
function refuse(json: boolean, message: string): number {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  else process.stderr.write(`${message}\n`);
  return 1;
}
function kindOf(raw: string): GroupKind | null {
  return raw === 'connector' || raw === 'dataset' ? raw : null;
}
const BAD_KIND = '--kind must be connector or dataset';

/** Best effort: a failed audit write never fails a change already made. */
async function auditGroup(action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    const appCtx = await createAppContext(loadConfig());
    try {
      await recordAuditEvent(appCtx, cliActor(), { action, entityType: 'explorerGroup', entityId, metadata });
    } finally {
      await appCtx.close();
    }
  } catch {
    // audit is best-effort
  }
}

export async function runQueryGroupsList(opts: GroupOpts): Promise<number> {
  const kind = kindOf(opts.kind);
  if (!kind) return refuse(opts.json, BAD_KIND);
  const ctx = await createDbContext(loadConfig());
  try {
    const [groups, items] = await Promise.all([ctx.explorerGroups.listGroups(kind), ctx.explorerGroups.itemGroups(kind)]);
    const lines = groups.map((g) => {
      const held = Object.entries(items).filter(([, group]) => group === g).map(([id]) => id).sort();
      return `${g}  ${held.length === 0 ? '(empty)' : held.join(', ')}`;
    });
    say(opts.json, { groups, items }, lines.length === 0 ? 'No groups.' : lines.join('\n'));
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runQueryGroupsCreate(name: string, opts: GroupOpts): Promise<number> {
  const kind = kindOf(opts.kind);
  if (!kind) return refuse(opts.json, BAD_KIND);
  const ctx = await createDbContext(loadConfig());
  try {
    let clean: string;
    try {
      clean = explorerGroupName(name);
      await ctx.explorerGroups.createGroup(kind, clean);
    } catch (err) {
      return refuse(opts.json, err instanceof Error && err.message === 'name already exists' ? `a ${kind} group named ${name.trim()} already exists` : redactError(err));
    }
    await auditGroup('explorerGroup.create', `${kind}:${clean}`, { kind, name: clean });
    say(opts.json, { ok: true, kind, name: clean }, `Made the ${kind} group ${clean}.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runQueryGroupsRename(name: string, newName: string, opts: GroupOpts): Promise<number> {
  const kind = kindOf(opts.kind);
  if (!kind) return refuse(opts.json, BAD_KIND);
  const ctx = await createDbContext(loadConfig());
  try {
    let clean: string;
    try { clean = explorerGroupName(newName); } catch (err) { return refuse(opts.json, redactError(err)); }
    const groups = await ctx.explorerGroups.listGroups(kind);
    if (!groups.includes(name)) return refuse(opts.json, `no ${kind} group named ${name}`);
    if (clean !== name && groups.includes(clean)) return refuse(opts.json, `a ${kind} group named ${clean} already exists`);
    const moved = await ctx.explorerGroups.renameGroup(kind, name, clean);
    await auditGroup('explorerGroup.rename', `${kind}:${name}`, { kind, from: name, to: clean, moved });
    say(opts.json, { ok: true, kind, from: name, to: clean, moved }, `Renamed the ${kind} group ${name} to ${clean}.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runQueryGroupsDelete(name: string, opts: GroupOpts & { force: boolean }): Promise<number> {
  const kind = kindOf(opts.kind);
  if (!kind) return refuse(opts.json, BAD_KIND);
  if (!opts.force) {
    process.stderr.write(`query groups delete refused: this removes the ${kind} group ${name}. What it holds is kept, in no group.\nRe-run with --force if that is what you intend.\n`);
    return 1;
  }
  const ctx = await createDbContext(loadConfig());
  try {
    if (!(await ctx.explorerGroups.listGroups(kind)).includes(name)) return refuse(opts.json, `no ${kind} group named ${name}`);
    const moved = await ctx.explorerGroups.renameGroup(kind, name, null);
    await auditGroup('explorerGroup.delete', `${kind}:${name}`, { kind, name, moved });
    say(opts.json, { ok: true, kind, name, moved }, `Removed the ${kind} group ${name}. ${moved} item(s) are now in no group.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runQueryGroupsMove(item: string, opts: GroupOpts & { group?: string }): Promise<number> {
  const kind = kindOf(opts.kind);
  if (!kind) return refuse(opts.json, BAD_KIND);
  const ctx = await createDbContext(loadConfig());
  try {
    let group: string | null = null;
    if (opts.group && opts.group.trim()) {
      try { group = explorerGroupName(opts.group); } catch (err) { return refuse(opts.json, redactError(err)); }
    }
    await ctx.explorerGroups.setItemGroup(kind, item, group);
    await auditGroup('explorerGroup.move', `${kind}:${item}`, { kind, item, group });
    say(opts.json, { ok: true, kind, item, group }, group ? `Moved ${item} to the ${kind} group ${group}.` : `Moved ${item} out of its group.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

