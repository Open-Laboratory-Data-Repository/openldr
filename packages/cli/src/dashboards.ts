import { createAppContext, DashboardShareError, recordAuditEvent, setDashboardShare } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';
import { servedCaller } from './served-caller';

/**
 * Show or set who may see a dashboard (design 2026-11-18-roles-scope, part 2). With no list option
 * it shows the list. `--roles` takes role slugs or ids, comma separated, and replaces the list;
 * `--clear` empties it, which means everyone with dashboards.view again. A served command runs for
 * a signed-in caller, so it obeys the same rules as the routes: a dashboard they may not see is
 * missing, and only its owner or an admin may change the list. A local run on the server is the
 * machine's operator and acts as an admin.
 */
export async function runDashboardsShare(
  id: string,
  opts: { json: boolean; clear: boolean; roles?: string },
): Promise<number> {
  if (opts.clear && opts.roles !== undefined) {
    process.stderr.write('--clear empties the list; do not give --roles with it\n');
    return 1;
  }
  const setting = opts.clear || opts.roles !== undefined;
  const ctx = await createAppContext(loadConfig());
  try {
    const d = await ctx.dashboards.store.get(id);
    const caller = await servedCaller(ctx);
    const asUser = caller === 'local' ? null : caller;
    const ref = d ? { id: d.id, ownerId: d.ownerId ?? null } : null;
    if (!d || !ref || (caller !== 'local' && (!asUser || !(await ctx.dashboardAccess.maySee(asUser, ref))))) {
      process.stderr.write(`no dashboard with id ${id}\n`);
      return 1;
    }
    let roles = await ctx.dashboardAccessStore.get(id);
    if (setting) {
      if (asUser && !ctx.dashboardAccess.mayShare(asUser, ref)) {
        process.stderr.write('only the owner or an admin may share this dashboard\n');
        return 1;
      }
      const names = opts.clear ? [] : (opts.roles ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      try {
        const { before, after } = await setDashboardShare({ access: ctx.dashboardAccessStore, dashboards: ctx.dashboards.store, roles: ctx.roles }, id, names);
        // Objects, not bare arrays, so the jsonb audit columns accept them (as the route does).
        await recordAuditEvent(ctx, cliActor(), { action: 'dashboard.share.set', entityType: 'dashboard', entityId: id, before: { roles: before }, after: { roles: after } });
        roles = after;
      } catch (err) {
        if (!(err instanceof DashboardShareError)) throw err;
        process.stderr.write(`${err.message}\n`);
        return 1;
      }
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify({ roles }, null, 2) + '\n');
      return 0;
    }
    const all = await ctx.roles.list();
    const shown = roles.length === 0
      ? 'everyone with the permission'
      : roles.map((rid) => { const r = all.find((x) => x.id === rid); return r ? `${r.name} (${r.slug})` : rid; }).join(', ');
    process.stdout.write(`${d.name}: ${shown}\n`);
    return 0;
  } finally {
    await ctx.close();
  }
}
