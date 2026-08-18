import { createDbContext, createAppContext, seedDatabase, recordAuditEvent } from '@openldr/bootstrap';
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
