import { createAppContext, readPluginSites, updatePluginSite, recordAuditEvent, PluginSitesError } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

const USAGE = 'usage: openldr market sites <id> [widget|panel] [on|off]';
type Site = 'widget' | 'panel';

/** `openldr market sites <id>` shows a plugin's dashboard card and side panel and whether each is
 *  on. `openldr market sites <id> <widget|panel> <on|off>` switches one, lab-wide. Same shared code
 *  as PUT /api/marketplace/:id/sites. */
export async function runMarketSites(
  id: string, site: string | undefined, state: string | undefined, opts: { json: boolean },
): Promise<number> {
  const setting = site !== undefined || state !== undefined;
  if (setting && ((site !== 'widget' && site !== 'panel') || (state !== 'on' && state !== 'off'))) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const deps = { plugins: ctx.plugins, appSettings: ctx.appSettings };
    let state0;
    if (setting) {
      const on = state === 'on';
      const actor = cliActor();
      state0 = await updatePluginSite(deps, id, site as Site, on, actor.actorName);
      await recordAuditEvent(ctx, actor, { action: 'plugin.sites.update', entityType: 'plugin', entityId: id, metadata: { site, on } });
    } else {
      state0 = await readPluginSites(deps, id);
    }
    const rows = (['widget', 'panel'] as const)
      .filter((s) => state0.declared[s])
      .map((s) => ({ site: s, title: state0.declared[s]!.title, on: !state0.off.includes(s) }));
    if (opts.json) process.stdout.write(JSON.stringify({ id, sites: rows }, null, 2) + '\n');
    else process.stdout.write(rows.length ? rows.map((r) => `${r.site}\t${r.on ? 'on' : 'off'}\t${r.title}`).join('\n') + '\n' : `${id} declares no dashboard card or side panel\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof PluginSitesError ? err.message : redactError(err);
    process.stderr.write(`market sites failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
