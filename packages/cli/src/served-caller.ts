import { formUserOf, type createAppContext } from '@openldr/bootstrap';
import type { DataScope } from '@openldr/db';
import { servedHandoff } from './served';

type AppCtx = Awaited<ReturnType<typeof createAppContext>>;

/**
 * The signed-in caller of a served command, as the per-item checks need them: their user id, role
 * ids, capabilities and data limit (roles part 3). The server sends the role ids and capabilities it worked out for the request,
 * so the command checks the same caller the route would (roles part 2). An older server sends none,
 * and then they are looked up as sign-in looks them up. Null for a local run, which is the machine's
 * operator, and for a served caller who cannot be found.
 */
export async function servedCaller(ctx: AppCtx): Promise<{ id: string; roleIds: string[]; capabilities: string[]; dataScope: DataScope } | 'local' | null> {
  const handoff = servedHandoff();
  if (!handoff) return 'local';
  const { id, roleIds, capabilities, dataScope } = handoff.caller;
  // An older server sends no data limit: it is read as sign-in reads it, by the user's subject.
  const scopeOf = async (): Promise<DataScope> => dataScope ?? ctx.dataScopes.get((await ctx.users.get(id))?.subject ?? id);
  if (roleIds && capabilities) return { id, roleIds, capabilities, dataScope: await scopeOf() };
  const found = await formUserOf(ctx, id);
  return found ? { id, ...found, dataScope: await scopeOf() } : null;
}
