import type { NodeHandler } from './types';

/** Reserved top-level key on the run input carrying a provenance override.
 *  Only an in-process caller can set it: the webhook route builds the input
 *  envelope itself, so a client's payload lands at `body` and can never reach
 *  this level. */
function overrideSource(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const prov = (input as Record<string, unknown>).__provenance;
  if (typeof prov !== 'object' || prov === null) return undefined;
  const s = (prov as Record<string, unknown>).sourceSystem;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

export const persistStoreHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Persist Store node requires server services');
  if (!ctx.services.persistStore) throw new Error('Persist Store node: persistStore service not injected');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const configured = String(config.source ?? '').trim() || undefined;
  const source = overrideSource(ctx.input) ?? configured;
  const result = await ctx.services.persistStore({ items: input, source });
  ctx.nodeMeta[node.id] = result.meta;
  return result.items;
};
