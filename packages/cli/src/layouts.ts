import { createAppContext, deleteLayout, listLayouts, recordAuditEvent, saveLayout, LayoutError } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr layouts`: the same layout presets as Settings, Layouts in studio, through the same
// shared code. A layout is named on the command line by its name, not its id.

const list = (v: string | undefined): string[] => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function fail(cmd: string, err: unknown): number {
  process.stderr.write(`layouts ${cmd} failed: ${err instanceof LayoutError ? err.message : redactError(err)}\n`);
  return 1;
}

export async function runLayoutsList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const all = await listLayouts(ctx.internalDb);
    if (opts.json) process.stdout.write(JSON.stringify(all, null, 2) + '\n');
    else process.stdout.write(all.layouts.length
      ? all.layouts.map((l) => `${l.name}\tstart ${l.startPage ?? '-'}\t${l.pages.length} pages\troles ${l.roles.join(',') || '-'}`).join('\n') + '\n'
      : '(no layouts)\n');
    return 0;
  } catch (err) {
    return fail('list', err);
  } finally { await ctx.close(); }
}

/** Create a layout, or replace the one with this name. On a replace, a start page or roles not
 *  given keep their current value; `--start-page none` clears the start page. */
export async function runLayoutsSet(name: string, opts: { pages: string; startPage?: string; roles?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const existing = (await listLayouts(ctx.internalDb)).layouts.find((l) => l.name === name.trim());
    const startPage = opts.startPage === undefined ? (existing?.startPage ?? null) : opts.startPage === 'none' ? null : opts.startPage;
    const roles = opts.roles === undefined ? (existing?.roles ?? []) : list(opts.roles);
    const actor = cliActor();
    const saved = await saveLayout(ctx.internalDb, existing?.id ?? null, { name: name.trim(), pages: list(opts.pages), startPage, roles }, actor.actorName);
    await recordAuditEvent(ctx, actor, { action: existing ? 'layout.update' : 'layout.create', entityType: 'layout', entityId: saved.id, metadata: { name: saved.name } });
    process.stdout.write(opts.json ? JSON.stringify(saved, null, 2) + '\n' : `${existing ? 'updated' : 'created'} layout ${saved.name}\n`);
    return 0;
  } catch (err) {
    return fail('set', err);
  } finally { await ctx.close(); }
}

export async function runLayoutsDelete(name: string, opts: { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write('layouts delete removes the layout for everyone and clears it as a role default. Run again with --force.\n');
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const existing = (await listLayouts(ctx.internalDb)).layouts.find((l) => l.name === name.trim());
    if (!existing) { process.stderr.write(`no layout named ${name}\n`); return 1; }
    await deleteLayout(ctx.internalDb, existing.id);
    await recordAuditEvent(ctx, cliActor(), { action: 'layout.delete', entityType: 'layout', entityId: existing.id, metadata: { name: existing.name } });
    process.stdout.write(`deleted layout ${existing.name}\n`);
    return 0;
  } catch (err) {
    return fail('delete', err);
  } finally { await ctx.close(); }
}
