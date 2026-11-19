import { createDbContext, createAppContext, seedDatabase, recordAuditEvent, readWarehouseReading, withRate, listDatasetsWithState, type WarehouseStatus, type DatasetListItem, type DatasetBuildResult } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { reprojectAll } from '@openldr/db';
import { redactError } from './redact-error';
import { cliActor } from './cli-actor';

interface JsonOpt {
  json: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

export async function runDbMigrate(opts: JsonOpt): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const res = await ctx.migrateAll();
    const internalNames = (res.internal.results ?? []).map((r) => r.migrationName);
    const externalNames = (res.external.results ?? []).map((r) => r.migrationName);
    // Surface the underlying message rather than a bare 'migration error'. Kysely's own text
    // (e.g. "corrupted migrations: previously executed migration 055_x is missing") names both
    // the problem and its fix; swallowing it left `db migrate` — the command the docs point at
    // when a schema is behind — impossible to diagnose. Redacted: a driver error can echo the DSN.
    const internalError = res.internal.error ? redactError(res.internal.error) : undefined;
    const externalError = res.external.error ? redactError(res.external.error) : undefined;
    if (internalError || externalError) {
      const detail = [
        internalError ? `  internal: ${internalError}` : null,
        externalError ? `  external: ${externalError}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      emit(
        opts.json,
        { ok: false, error: 'migration_failed', internalError, externalError, internalNames, externalNames },
        `migration error\n${detail}`,
      );
      return 1;
    }
    emit(
      opts.json,
      { ok: true, internal: internalNames, external: externalNames },
      `migrated internal: [${internalNames.join(', ')}]  external: [${externalNames.join(', ')}]`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runDbReset(opts: JsonOpt & { force: boolean }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    await ctx.reset({ force: opts.force });
    try {
      const appCtx = await createAppContext(loadConfig());
      try {
        await recordAuditEvent(appCtx, cliActor(), { action: 'db.reset', entityType: 'database', entityId: 'internal+external', metadata: {} });
      } finally {
        await appCtx.close();
      }
    } catch {
      // audit is best-effort
    }
    emit(opts.json, { ok: true }, 'database reset complete');
    return 0;
  } finally {
    await ctx.close();
  }
}

/** Human-readable refusal naming what is outstanding and the (non-destructive) remedy.
 *  `command` is the refusing command's name, so `db seed` and `db reproject` share one message
 *  rather than drifting into two that word the same refusal differently. */
function pendingMigrationsMessage(command: string, pending: { internal: string[]; external: string[] }): string {
  const count = pending.internal.length + pending.external.length;
  const lines = [`${command} refused: the database schema is behind the code (${count} pending migration(s)).`];
  if (pending.internal.length) lines.push(`  internal: ${pending.internal.join(', ')}`);
  if (pending.external.length) lines.push(`  external: ${pending.external.join(', ')}`);
  lines.push('', `Run \`openldr db migrate\` first, then re-run \`openldr ${command}\`.`);
  return lines.join('\n');
}

/** Rebuild the whole warehouse read model from the canonical FHIR store, including the
 *  `ingest_events` arrival ledger.
 *
 *  ⛔ DESTRUCTIVE-SHAPED, which is why it refuses without --force: it rewrites every projected row
 *  in the warehouse from the canonical store. `created_at` on a row that has to be re-inserted is
 *  reset to the rebuild time — it is a first-written stamp, not an arrival time, which is precisely
 *  why the arrival ledger exists and is rebuilt here rather than derived from it. */
export async function runDbReproject(opts: JsonOpt & { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(
      'db reproject refused: this rebuilds the entire warehouse read model from canonical FHIR.\n'
      + 'Re-run with --force if that is what you intend.\n',
    );
    return 1;
  }
  const ctx = await createDbContext(loadConfig());
  try {
    // Refuse BEFORE rebuilding anything, for the same reason `db seed` does: on a stale schema
    // `reprojectAll` completes the ENTIRE clinical rewrite and only then throws
    // `relation "ingest_events" does not exist`, having advanced no cursor and recorded no audit
    // event. Post-upgrade backfill is this command's stated purpose, so a schema one migration
    // behind is its likely FIRST invocation. Naming the cause up front costs one query.
    const pending = await ctx.pendingMigrations();
    if (pending.internal.length || pending.external.length) {
      emit(opts.json, { ok: false, error: 'pending_migrations', pending }, pendingMigrationsMessage('db reproject', pending));
      return 1;
    }

    const { projected, arrivals } = await reprojectAll({ internalDb: ctx.internalDb, relationalWriter: ctx.relationalWriter });
    try {
      const appCtx = await createAppContext(loadConfig());
      try {
        await recordAuditEvent(appCtx, cliActor(), { action: 'db.reproject', entityType: 'database', entityId: 'external', metadata: { projected, arrivals } });
      } finally {
        await appCtx.close();
      }
    } catch {
      // audit is best-effort, exactly as db.reset treats it
    }
    // TWO numbers, named separately and never added together: `projected` counts canonical
    // RESOURCES, `arrivals` counts arrival-ledger ROWS (one per version). Reporting one as the
    // other is the mistake `terminology.ts:152-166` records — a rebuild count was read as a
    // dimension count. The ledger is this command's headline new capability, so a run that wrote
    // zero ledger rows must be visible without querying the warehouse.
    emit(
      opts.json,
      { projected, arrivals },
      `rebuilt the read model from ${projected} canonical resource${projected === 1 ? '' : 's'}; `
      + `recorded ${arrivals} arrival${arrivals === 1 ? '' : 's'} in the ingest ledger`,
    );
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runDbSeed(opts: JsonOpt): Promise<number> {
  const cfg = loadConfig();
  const ctx = await createDbContext(cfg);
  try {
    // Refuse BEFORE building the app context: creating it boots the SEC-06 workflow-secret
    // shim, which on a stale schema logs a `relation ... does not exist` stack trace and
    // then continues. Checking first means the operator sees the cause, not the symptom.
    const pending = await ctx.pendingMigrations();
    if (pending.internal.length || pending.external.length) {
      emit(opts.json, { ok: false, error: 'pending_migrations', pending }, pendingMigrationsMessage('db seed', pending));
      return 1;
    }

    const appCtx = await createAppContext(cfg);
    try {
      const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology } = await seedDatabase(ctx, appCtx);
      emit(
        opts.json,
        { ok: true, results: resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology },
        `seeded ${resources.length} resources, ${formsSeeded} forms, ${workflowsSeeded} workflow(s), ${connectorsSeeded} connector(s), ${dashboardsSeeded} dashboard(s), ${settingsSeeded} setting(s), ${terminology.valueSetsImported} value set(s), ${terminology.ucumConceptsImported} UCUM concept(s)`,
      );
      return 0;
    } finally {
      await appCtx.close();
    }
  } finally {
    await ctx.close();
  }
}

/** Seconds as "2 h 5 min", "12 min" or "40 s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(Math.round(seconds), 1)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The lines `db warehouse-status` prints. Exported for its test. */
export function warehouseStatusLines(s: WarehouseStatus): string[] {
  if (s.behind === 0) {
    return ['The warehouse is up to date.', ...(s.waitingRetry > 0 ? [`waitingRetry = ${s.waitingRetry}`] : [])];
  }
  const left = s.fallingBehind
    ? 'falling behind: records are being saved faster than the warehouse takes them'
    : s.secondsLeft !== null ? `about ${formatDuration(s.secondsLeft)}` : 'unknown';
  return [
    `behind = ${s.behind} changes (the warehouse is at ${s.cursor} of ${s.head})`,
    `oldestWaiting = ${s.oldestWaitingAt ?? '-'}`,
    `rate = ${s.appliedPerSecond !== null ? `${s.appliedPerSecond} changes a second` : 'not measured'}`,
    `timeLeft = ${left}`,
    `waitingRetry = ${s.waitingRetry}`,
  ];
}

/** `openldr db warehouse-status`: how far the warehouse is behind the records saved. It reads twice,
 *  `seconds` apart, to say how fast the gap is closing. `--seconds 0` reads once. Read-only. */
export async function runDbWarehouseStatus(opts: JsonOpt & { seconds: number }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const first = await readWarehouseReading(ctx.internalDb);
    let status = withRate(null, first);
    if (opts.seconds > 0 && first.behind > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.seconds * 1000));
      status = withRate(first, await readWarehouseReading(ctx.internalDb));
    }
    emit(opts.json, status, warehouseStatusLines(status).join('\n'));
    return 0;
  } finally {
    await ctx.close();
  }
}

// `openldr db datasets ...`: the datasets a content pack defines, kept as tables in the warehouse's
// `dataset` schema. The same service the Query page uses, so the two cannot disagree.

/** One line for `db datasets list`. */
function datasetLine(d: DatasetListItem): string {
  const parts = [d.name, d.ownerPack, d.group ? `group ${d.group}` : 'no group'];
  if (d.builtAt === null) parts.push('not built');
  else parts.push(`${d.rowCount ?? 0} rows`, `built ${d.builtAt} in ${formatDuration((d.buildMs ?? 0) / 1000)}`);
  if (d.stale) parts.push('stale');
  if (d.lastError) parts.push(`error: ${d.lastError}`);
  return parts.join('  ');
}

/** One line for `db datasets rebuild`. */
function buildLine(r: DatasetBuildResult): string {
  return r.ok
    ? `${r.name}  rebuilt  ${r.rows ?? 0} rows in ${formatDuration((r.ms ?? 0) / 1000)}`
    : `${r.name}  failed  ${r.error ?? ''}`;
}

/** Best effort, as for `db reproject`: a failed audit write never fails a change already made. */
async function auditDataset(action: 'dataset.rebuild' | 'dataset.delete', entityId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    const appCtx = await createAppContext(loadConfig());
    try {
      await recordAuditEvent(appCtx, cliActor(), { action, entityType: 'dataset', entityId, metadata });
    } finally {
      await appCtx.close();
    }
  } catch {
    // audit is best-effort
  }
}

export async function runDbDatasetsList(opts: JsonOpt): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const all = await listDatasetsWithState(ctx.warehouseDatasets, ctx.internalDb);
    emit(opts.json, all, all.length === 0 ? 'No datasets. A content pack installs them.' : all.map(datasetLine).join('\n'));
    return 0;
  } finally {
    await ctx.close();
  }
}

/** Rebuilds one dataset, or all of them in the order their packs list them. Exit code 1 when any
 *  build failed, so a script can tell. A failed build keeps the last good table. */
export async function runDbDatasetsRebuild(name: string | undefined, opts: JsonOpt): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    let results: DatasetBuildResult[];
    try {
      results = await ctx.warehouseDatasets.rebuild(name);
    } catch (err) {
      const message = redactError(err);
      if (opts.json) emit(true, { ok: false, error: message }, '');
      else process.stderr.write(`${message}\n`);
      return 1;
    }
    await auditDataset('dataset.rebuild', name ?? 'all', { results });
    emit(opts.json, results, results.length === 0 ? 'No datasets to rebuild.' : results.map(buildLine).join('\n'));
    return results.every((r) => r.ok) ? 0 : 1;
  } finally {
    await ctx.close();
  }
}

export async function runDbDatasetsDelete(name: string, opts: JsonOpt & { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(
      `db datasets delete refused: this removes the table dataset.${name} from the warehouse, and reports that read it stop working.\n`
      + 'Re-run with --force if that is what you intend.\n',
    );
    return 1;
  }
  const ctx = await createDbContext(loadConfig());
  try {
    try {
      await ctx.warehouseDatasets.remove(name);
    } catch (err) {
      const message = redactError(err);
      if (opts.json) emit(true, { ok: false, error: message }, '');
      else process.stderr.write(`${message}\n`);
      return 1;
    }
    await auditDataset('dataset.delete', name, {});
    emit(opts.json, { ok: true, name }, `Deleted the dataset ${name}.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

/** `openldr db datasets move <name> [--group <group>]`: puts a dataset in a Query page group, or in
 *  none when no group is given. A group is only a name: naming a new one makes it. */
export async function runDbDatasetsMove(name: string, opts: JsonOpt & { group?: string }): Promise<number> {
  const ctx = await createDbContext(loadConfig());
  try {
    const group = opts.group && opts.group.trim() ? opts.group.trim() : null;
    try {
      await ctx.warehouseDatasets.setGroup(name, group);
    } catch (err) {
      const message = redactError(err);
      if (opts.json) emit(true, { ok: false, error: message }, '');
      else process.stderr.write(`${message}\n`);
      return 1;
    }
    emit(opts.json, { ok: true, name, group }, group ? `Moved ${name} to the group ${group}.` : `Moved ${name} out of its group.`);
    return 0;
  } finally {
    await ctx.close();
  }
}

