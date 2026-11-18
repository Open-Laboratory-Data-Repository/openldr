// Binding a dashboard's filter values into a stored widget query. Moved here from the studio
// (DashboardWidget.tsx and editor/conditionTree.model.ts) so the server binds exactly as the browser
// does: a viewer now runs a saved widget by id, and the server builds the query (design
// 2026-11-18-roles-scope, part 2, "Also lock the data"). Pure: no React, no database.
import type { WidgetQuery } from './types';

type TreeRule = { kind: 'rule'; dimension: string; op: string; value: unknown };
type TreeGroup = { kind: 'group'; combinator: 'and' | 'or'; children: TreeNode[] };
type TreeNode = TreeRule | TreeGroup;

function hasRules(node: TreeNode): boolean {
  return node.kind === 'rule' ? true : node.children.some(hasRules);
}

function pruneBound(node: TreeNode, bound: Set<string>): TreeNode | null {
  if (node.kind === 'rule') return bound.has(node.dimension) ? null : node;
  const children = node.children.map((c) => pruneBound(c, bound)).filter((c): c is TreeNode => c != null);
  return { ...node, children };
}

/**
 * Runtime binding: replace bound-dimension rules with the resolved dashboard-filter value(s),
 * ANDed with the rest of the tree. ANDing at a fresh root keeps the injected value correct even
 * when the user's own root group is an OR. Mirrors the flat bindQuery logic.
 */
export function bindFilterTree<G extends TreeGroup>(tree: G, bindings: Record<string, string>, filterValues: Record<string, unknown>): G {
  const bound = new Set(Object.keys(bindings));
  const pruned = pruneBound(tree, bound) as TreeGroup;
  const injected: TreeRule[] = [];
  for (const [dimKey, filterId] of Object.entries(bindings)) {
    const v = filterValues[filterId];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && 'from' in v && 'to' in v) {
      const range = v as { from: string; to: string };
      if (range.from) injected.push({ kind: 'rule', dimension: dimKey, op: 'gte', value: range.from });
      if (range.to) injected.push({ kind: 'rule', dimension: dimKey, op: 'lte', value: range.to });
    } else {
      injected.push({ kind: 'rule', dimension: dimKey, op: 'eq', value: v });
    }
  }
  if (injected.length === 0) return pruned as G;
  const base = hasRules(pruned) ? [pruned] : [];
  return { kind: 'group', combinator: 'and', children: [...base, ...injected] } as G;
}

/** A stored widget query with the dashboard's filter values bound in. */
export function bindQuery<Q extends { mode: string }>(query: Q, filterValues: Record<string, unknown>): Q {
  // The studio passes its own looser WidgetQuery type; the shape is the same, so bind on the schema
  // type and hand back the caller's type.
  return bindWidgetQuery(query as unknown as WidgetQuery, filterValues) as unknown as Q;
}

function bindWidgetQuery(q: WidgetQuery, filterValues: Record<string, unknown>): WidgetQuery {
  if (q.mode === 'builder') {
    if (!q.variableBindings) return q;
    if (q.filterTree) {
      const filterTree = bindFilterTree(q.filterTree as unknown as TreeGroup, q.variableBindings, filterValues);
      return { ...q, filterTree } as WidgetQuery;
    }
    // A bound row's own literal filter (e.g. {dimension:'authored_on', op:'eq', value:''}) stays
    // in q.filters until the row is deleted — drop it here so the derived binding filter(s)
    // REPLACE it instead of being ANDed alongside it (which zeroes out results / type-errors).
    const bound = new Set(Object.keys(q.variableBindings));
    const filters = q.filters.filter((f) => !bound.has(f.dimension));
    for (const [dimKey, filterId] of Object.entries(q.variableBindings)) {
      const v = filterValues[filterId];
      if (v == null || v === '') continue;
      if (typeof v === 'object' && 'from' in v && 'to' in v) {
        const range = v as { from: string; to: string };
        if (range.from) filters.push({ dimension: dimKey, op: 'gte', value: range.from });
        if (range.to) filters.push({ dimension: dimKey, op: 'lte', value: range.to });
      } else {
        filters.push({ dimension: dimKey, op: 'eq', value: v as string | number });
      }
    }
    return { ...q, filters };
  }
  // SQL mode: send the STORED template `sql` verbatim plus the resolved dashboard-filter values.
  // The run applies the {{var}} / [[ ... ]] substitution, so the `sql` stays byte-identical to the
  // persisted widget.
  const values: Record<string, string | number | null | { from: string; to: string }> = {};
  for (const [varName, filterId] of Object.entries(q.variableBindings ?? {})) {
    const v = filterValues[filterId];
    values[varName] = (v ?? null) as string | number | null | { from: string; to: string };
  }
  return { ...q, values };
}
