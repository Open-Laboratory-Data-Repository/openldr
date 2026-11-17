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
  return { json: { item: structuredClone(item), reason } };
}

/** One place in input order: an item for the service, or an item this handler holds itself. */
type Slot = { service: number } | { held: WorkflowItem };

/**
 * The items to map, read from `sourcePath` when it is set. An object is one item. A list of FHIR
 * resources is one item, wrapped as a collection Bundle because an item's json cannot be a list.
 * Any other list gives one item per object. What is not a row is held here.
 */
function readItems(input: WorkflowItem[], sourcePath: string): { items: WorkflowItem[]; slots: Slot[] } {
  const items: WorkflowItem[] = [];
  const slots: Slot[] = [];
  const send = (json: Record<string, unknown>) => {
    slots.push({ service: items.length });
    items.push({ json });
  };
  for (const item of input) {
    if (!sourcePath) {
      send(item.json);
      continue;
    }
    const v = readPath(item.json, sourcePath);
    if (isObject(v)) {
      send(v);
    } else if (Array.isArray(v) && v.length > 0 && v.every(isResource)) {
      send({ resourceType: 'Bundle', type: 'collection', entry: v.map((resource) => ({ resource })) });
    } else if (Array.isArray(v) && v.length > 0) {
      for (const el of v) {
        if (isObject(el)) send(el);
        else slots.push({ held: heldItem(el, 'not a row') });
      }
    } else {
      slots.push({ held: heldItem(item.json, `nothing at ${sourcePath}`) });
    }
  }
  return { items, slots };
}

const MAX_HELD_REASONS = 20;
const MAX_REASONS_IN_ERROR = 5;

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

  // The service's held items and this handler's, in input order.
  const heldByIndex = new Map(result.heldIndexes.map((index, i) => [index, result.held[i]]));
  const held: WorkflowItem[] = [];
  for (const slot of read.slots) {
    if ('held' in slot) held.push(slot.held);
    else {
      const h = heldByIndex.get(slot.service);
      if (h) held.push(h);
    }
  }
  const reasons = held.map((h) => String(h.json.reason));

  // Recorded before any throw, so a failed run still shows the counts and reasons.
  ctx.nodeMeta[node.id] = { ...result.meta, held: held.length, heldReasons: reasons.slice(0, MAX_HELD_REASONS) };

  // Held items must go somewhere a person can see them. With no held edge they would vanish.
  const heldWired = ctx.edges.some((e) => e.source === node.id && e.sourceHandle === 'held');
  if (held.length > 0 && !heldWired) {
    throw new Error(
      `Map to FHIR node: ${held.length} item(s) held and the held port is not connected. First reasons: ${reasons.slice(0, MAX_REASONS_IN_ERROR).join('; ')}`,
    );
  }

  ctx.portItems[node.id] = { out: result.out, held };
  return result.out;
};
