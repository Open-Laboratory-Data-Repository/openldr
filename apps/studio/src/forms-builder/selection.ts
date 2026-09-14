/**
 * Which rows of the field list are selected, and the anchor: the row Shift-click ranges from and
 * `j` and `k` move. Pure. Ported from corlix `pages/FormBuilderPage.tsx:163-164,927-944,1726-1752`.
 */
export interface FieldSelection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

export const NO_SELECTION: FieldSelection = { ids: new Set<string>(), anchor: null };

export function selectOnly(id: string): FieldSelection {
  return { ids: new Set([id]), anchor: id };
}

export interface ClickModifiers {
  /** Shift was held. */
  range: boolean;
  /** Ctrl or Cmd was held. */
  toggle: boolean;
}

/**
 * The selection after a click on row `id`. `order` is every drawn row, top to bottom.
 *
 * Shift-click selects the rows between the anchor and the clicked row, and keeps the anchor. With no
 * anchor it falls through, as corlix does. When either row is not drawn, nothing changes. Ctrl or
 * Cmd-click adds or removes the row and anchors it. A plain click selects the row alone.
 */
export function clickSelection(
  current: FieldSelection,
  id: string,
  order: readonly string[],
  mods: ClickModifiers,
): FieldSelection {
  if (mods.range && current.anchor) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) return current;
    const [lo, hi] = from < to ? [from, to] : [to, from];
    return { ids: new Set(order.slice(lo, hi + 1)), anchor: current.anchor };
  }
  if (mods.toggle) {
    const ids = new Set(current.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: id };
  }
  return selectOnly(id);
}

/** Ctrl or Cmd-A: every drawn row. The anchor stays where it was, as in corlix. */
export function selectAllRows(current: FieldSelection, order: readonly string[]): FieldSelection {
  return { ids: new Set(order), anchor: current.anchor };
}

/** `j` and `k`: the anchor moves one row, wrapping at the ends, and becomes the only selected row. */
export function moveAnchor(current: FieldSelection, order: readonly string[], delta: 1 | -1): FieldSelection {
  if (order.length === 0) return current;
  const at = current.anchor ? order.indexOf(current.anchor) : -1;
  const next = at === -1 ? (delta === 1 ? 0 : order.length - 1) : (at + delta + order.length) % order.length;
  return selectOnly(order[next]);
}

/** The selection without some rows, after a delete. The anchor clears only when it went too. */
export function withoutRows(current: FieldSelection, gone: ReadonlySet<string>): FieldSelection {
  return {
    ids: new Set([...current.ids].filter((id) => !gone.has(id))),
    anchor: current.anchor && gone.has(current.anchor) ? null : current.anchor,
  };
}
