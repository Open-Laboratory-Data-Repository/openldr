import type { NodeHandler } from './types';
import type { WorkflowItem } from '../items';
import { readPath } from '../template';

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isResource(v: unknown): boolean {
  return isObject(v) && typeof v.resourceType === 'string';
}

function heldItem(item: unknown, reason: string): WorkflowItem {
  return { json: { item, reason } };
}

/**
 * The items to map, read from `sourcePath` when it is set. An object is one item. A list of FHIR
 * resources is one item, wrapped as a collection Bundle because an item's json cannot be a list.
 * Any other list gives one item per object. What is not a row is held here.
 */
function readItems(input: WorkflowItem[], sourcePath: string): { items: WorkflowItem[]; held: WorkflowItem[] } {
  if (!sourcePath) return { items: input.map((i) => ({ json: i.json })), held: [] };
  const items: WorkflowItem[] = [];
  const held: WorkflowItem[] = [];
  for (const item of input) {
    const v = readPath(item.json, sourcePath);
    if (isObject(v)) {
      items.push({ json: v });
    } else if (Array.isArray(v) && v.length > 0 && v.every(isResource)) {
      items.push({ json: { resourceType: 'Bundle', type: 'collection', entry: v.map((resource) => ({ resource })) } });
    } else if (Array.isArray(v)) {
      for (const el of v) {
        if (isObject(el)) items.push({ json: el });
        else held.push(heldItem(el, 'not a row'));
      }
    } else {
      held.push(heldItem(item.json, `nothing at ${sourcePath}`));
    }
  }
  return { items, held };
}

export const mapToFhirHandler: NodeHandler = async (node, ctx, input) => {
  if (!ctx.services) throw new Error('Map to FHIR node requires server services');
  if (!ctx.services.mapToFhir) throw new Error('Map to FHIR node: mapToFhir service not injected');
  const config = (node.data.config as Record<string, unknown>) ?? {};
  const targetId = String(config.targetId ?? '').trim();
  const formIds = Array.isArray(config.formIds) ? config.formIds.map(String) : [];
  const mappings = Array.isArray(config.mappings) ? (config.mappings as unknown[]) : [];
  if (!targetId && mappings.length > 0) throw new Error('Map to FHIR node: targetId is required when the node has mappings');
  const sourcePath = String(config.sourcePath ?? '').trim();

  const read = readItems(input, sourcePath);
  const result = await ctx.services.mapToFhir({ items: read.items, config: { targetId, formIds, mappings } });
  const held = [...read.held, ...result.held];
  ctx.portItems[node.id] = { out: result.out, held };
  ctx.nodeMeta[node.id] = { ...result.meta, held: result.meta.held + read.held.length };
  return result.out;
};
