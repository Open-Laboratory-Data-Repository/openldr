import { createDbContext, createAppContext, recordAuditEvent, readAuthIssuerBinding, rebindAuthIssuer } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

interface RebindOpts {
  json: boolean;
  force: boolean;
}

function emit(json: boolean, payload: unknown, human: string): void {
  process.stdout.write(json ? JSON.stringify(payload, null, 2) + '\n' : human + '\n');
}

/** Moves the stored issuer to OIDC_ISSUER_URL. For a provider that changed address, not a new provider.
 *  Uses the database context only: the app context refuses to start while the issuers differ. */
export async function runAuthRebindIssuer(opts: RebindOpts): Promise<number> {
  const cfg = loadConfig();
  const to = cfg.OIDC_ISSUER_URL;
  const ctx = await createDbContext(cfg);
  try {
    const pending = await ctx.pendingMigrations();
    if (pending.internal.length || pending.external.length) {
      emit(opts.json, { ok: false, error: 'pending_migrations', pending },
        'auth rebind-issuer refused: the database schema is behind the code.\nRun `openldr db migrate` first.');
      return 1;
    }

    const from = await readAuthIssuerBinding(ctx.internalDb);
    if (from === null || from === to) {
      emit(opts.json, { ok: true, changed: false, from, to },
        from === null ? `no issuer bound yet; the next start binds ${to}` : `already bound to ${to}; nothing to change`);
      return 0;
    }

    if (!opts.force) {
      process.stderr.write(
        `auth rebind-issuer refused: this database is bound to ${from}, but OIDC_ISSUER_URL is ${to}.\n`
        + 'Only rebind when the same identity provider moved address and user IDs are unchanged.\n'
        + 'A different provider needs an explicit identity mapping instead.\n'
        + 'Re-run with --force if that is what you intend.\n',
      );
      return 1;
    }

    await rebindAuthIssuer(ctx.internalDb, to);
    try {
      const appCtx = await createAppContext(cfg);
      try {
        await recordAuditEvent(appCtx, cliActor(), { action: 'auth.issuer.rebind', entityType: 'auth_issuer_binding', entityId: '1', metadata: { from, to } });
      } finally {
        await appCtx.close();
      }
    } catch {
      // audit is best-effort, exactly as db.reset treats it
    }
    emit(opts.json, { ok: true, changed: true, from, to }, `issuer binding moved from ${from} to ${to}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
