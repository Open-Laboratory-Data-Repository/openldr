import type { FormField } from './schema/form-schema';

/**
 * Structure of the `groupId` chain, in one place.
 *
 * `groupId` is a single parent reference on a flat array, so it already expresses a tree of any
 * depth. It does not guarantee the shape is a tree: an imported Questionnaire can carry anything.
 * So every traversal here is cycle-safe. A hang in the builder is worse than a wrong answer.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/groupTree.ts`.
 */

/** Direct children of one group, in form order. */
export function childrenOf(fields: FormField[], groupId: string): FormField[] {
  return fields.filter((f) => f.groupId === groupId).slice().sort((a, b) => a.order - b.order);
}

/** Every id beneath a group, at any depth. Stops on a cycle. */
export function descendantIds(fields: FormField[], groupId: string): Set<string> {
  const seen = new Set<string>();
  const walk = (id: string): void => {
    for (const child of childrenOf(fields, id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      walk(child.id);
    }
  };
  walk(groupId);
  return seen;
}

/** How many ancestors a field has. 0 is top level. Stops on a cycle. */
export function groupDepth(fields: FormField[], fieldId: string): number {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const seen = new Set<string>([fieldId]);
  let depth = 0;
  let current = byId.get(fieldId)?.groupId;
  while (current && byId.has(current)) {
    if (seen.has(current)) break;
    seen.add(current);
    depth += 1;
    current = byId.get(current)?.groupId;
  }
  return depth;
}

/**
 * Groups this field may be parented to: every group except itself and its own descendants.
 * Excluding descendants is what stops the Group picker building a loop.
 */
export function eligibleParents(fields: FormField[], fieldId: string): FormField[] {
  const banned = descendantIds(fields, fieldId);
  banned.add(fieldId);
  return fields.filter((f) => f.fieldType === 'group' && !banned.has(f.id));
}
