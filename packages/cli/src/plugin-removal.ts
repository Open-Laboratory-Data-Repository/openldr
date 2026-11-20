import { createAppContext, PluginStillStopping, REMOVE_KEEPS, type ImportActor, type RemoveKeep } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

// `plugin remove <id>` and `market remove <id>` without a version: the whole plugin. It never leaves
// the plugin's reads or checks running (design 2026-11-20-plugin-update-and-remove). The same
// removal as the studio's Remove sheet, from @openldr/bootstrap. Destructive, so it refuses without
// --force when anything is running or anything would be deleted.

function actor(): ImportActor {
  const a = cliActor();
  if (a.actorType === 'user') return { type: 'user', id: a.actorId ?? null, name: a.actorName };
  return { type: 'cli', id: null, name: a.actorName };
}

export async function runWholePluginRemove(id: string, opts: { keep?: string; force: boolean; json: boolean }): Promise<number> {
  const keep = (opts.keep ?? 'all') as RemoveKeep;
  if (!REMOVE_KEEPS.includes(keep)) {
    process.stderr.write(`--keep must be one of ${REMOVE_KEEPS.join(', ')}.\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const plan = await ctx.pluginRemoval.plan(id);
    if (!opts.force && (plan.running.length > 0 || keep !== 'all')) {
      const lines: string[] = [];
      if (plan.running.length > 0) {
        lines.push(`${id} is running: ${plan.running.map((r) => `${r.kind} ${r.id} (${r.status})`).join(', ')}. Removing stops these first.`);
      }
      if (keep !== 'all') lines.push(`--keep ${keep} deletes ${plan.copies} cop${plan.copies === 1 ? 'y' : 'ies'} of read data. Saved records are never deleted.`);
      lines.push('Run again with --force to do that.');
      process.stderr.write(`${lines.join('\n')}\n`);
      return 1;
    }
    const r = await ctx.pluginRemoval.remove(id, { keep, actor: actor() });
    if (opts.json) process.stdout.write(`${JSON.stringify({ removed: id, keep, stopped: r.stopped, deletedCopies: r.deletedCopies })}\n`);
    else {
      const stopped = r.stopped.length > 0 ? `, stopped ${r.stopped.join(', ')}` : '';
      const deleted = r.deletedCopies > 0 ? `, deleting ${r.deletedCopies} cop${r.deletedCopies === 1 ? 'y' : 'ies'} of read data` : '';
      process.stdout.write(`removed ${id} (kept: ${keep}${stopped}${deleted})\n`);
    }
    return 0;
  } catch (err) {
    if (err instanceof PluginStillStopping) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  } finally {
    await ctx.close();
  }
}
