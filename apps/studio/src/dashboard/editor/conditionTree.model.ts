// Pure state-transition helpers for the recursive AND/OR filter tree (ConditionGroup / ConditionRule
// in @openldr/dashboards). Kept free of React/DOM so they're unit-testable without jsdom or Radix —
// see FilterTreeEditor.tsx, a thin shadcn shell over these functions. Types are defined locally
// (structurally identical to the schema) to match conditionModel.ts's own FilterCondition.

export type TreeRule = { kind: 'rule'; dimension: string; op: string; value: unknown };
export type TreeGroup = { kind: 'group'; combinator: 'and' | 'or'; children: TreeNode[] };
export type TreeNode = TreeRule | TreeGroup;
export type Path = number[];

export function emptyTree(): TreeGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

/** Adapt a legacy flat filter list into a root AND group of rules. */
export function filtersToTree(filters: { dimension: string; op: string; value: unknown }[]): TreeGroup {
  return { kind: 'group', combinator: 'and', children: filters.map((f) => ({ kind: 'rule', dimension: f.dimension, op: f.op, value: f.value })) };
}

/** True when the node (or any descendant) contains at least one rule. */
export function hasRules(node: TreeNode): boolean {
  return node.kind === 'rule' ? true : node.children.some(hasRules);
}

/** Recursively rebuild the group at `path`, applying `fn` to it; returns a new tree. */
function mapGroupAt(root: TreeGroup, path: Path, fn: (g: TreeGroup) => TreeGroup): TreeGroup {
  if (path.length === 0) return fn(root);
  const [i, ...rest] = path;
  const child = root.children[i];
  if (!child || child.kind !== 'group') return root;
  const children = root.children.slice();
  children[i] = mapGroupAt(child, rest, fn);
  return { ...root, children };
}

export function addRule(root: TreeGroup, path: Path, dims: { key: string }[]): TreeGroup {
  const rule: TreeRule = { kind: 'rule', dimension: dims[0]?.key ?? '', op: 'eq', value: '' };
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, rule] }));
}

export function addGroup(root: TreeGroup, path: Path): TreeGroup {
  const group: TreeGroup = { kind: 'group', combinator: 'or', children: [] };
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, group] }));
}

export function setCombinator(root: TreeGroup, path: Path, combinator: 'and' | 'or'): TreeGroup {
  return mapGroupAt(root, path, (g) => ({ ...g, combinator }));
}

/** Patch the rule at `path` (last index addresses a rule within its parent group). */
export function updateRule(root: TreeGroup, path: Path, patch: Partial<TreeRule>): TreeGroup {
  if (path.length === 0) return root;
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parent, (g) => {
    const child = g.children[idx];
    if (!child || child.kind !== 'rule') return g;
    const children = g.children.slice();
    children[idx] = { ...child, ...patch };
    return { ...g, children };
  });
}

/** Remove the node at `path`. Removing the root ([]) yields an empty tree. */
export function removeAt(root: TreeGroup, path: Path): TreeGroup {
  if (path.length === 0) return emptyTree();
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parent, (g) => ({ ...g, children: g.children.filter((_, j) => j !== idx) }));
}

/** Recursively drop every rule whose dimension is in `bound`; prune groups that become empty. */
function pruneBound(node: TreeNode, bound: Set<string>): TreeNode | null {
  if (node.kind === 'rule') return bound.has(node.dimension) ? null : node;
  const children = node.children.map((c) => pruneBound(c, bound)).filter((c): c is TreeNode => c != null);
  return { ...node, children };
}

/** Drop every rule whose dimension is in `keys` (empty groups are kept). Used to clear filter/
 *  filterTree references orphaned by removing an ad-hoc dimension. */
export function pruneDimensions(root: TreeGroup, keys: Set<string>): TreeGroup {
  return pruneBound(root, keys) as TreeGroup;
}

/** Runtime binding, shared with the server (roles part 2): see @openldr/dashboards bind.ts. */
export { bindFilterTree } from '@openldr/dashboards/pure';
