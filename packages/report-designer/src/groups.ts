import type { DesignPage } from './schema';

/**
 * Element groups: a NAME over several elements, never a container.
 *
 * ⛔ Flat on purpose. `page.elements` order IS z-order, and `flowAfter`, `showWithTable`, the
 * pagination arithmetic and the Layers list all index that array. Nesting members inside a group
 * object would restructure it and break all four at once, so a group is a label carried on each
 * member (`el.groupId`) plus a row in `page.groups`.
 *
 * `resolveGroups` is the ONE place a group's `locked`/`hidden` becomes an element's own. Every
 * consumer (the renderer, the studio canvas, the page-strip counts) calls it and then works with
 * plain element flags, so none of them needs to know groups exist and none of them can disagree
 * about what a hidden group means. That is the same "one projection, one capacity rule" discipline
 * the canvas and the PDF already share for rows.
 */
export function resolveGroups(page: DesignPage): DesignPage {
  const groups = page.groups ?? [];
  // Identity return for the overwhelmingly common case, so a design with no groups is not cloned
  // on every render and stays referentially stable for React.
  if (groups.length === 0) return page;
  const flags = new Map(groups.map((g) => [g.id, g]));
  let changed = false;
  const elements = page.elements.map((el) => {
    const g = el.groupId ? flags.get(el.groupId) : undefined;
    // A dangling groupId (its group was deleted) simply carries no flags, the same fail-open
    // contract `flowAfter` and `showWithTable` already document for a missing reference.
    if (!g || (!g.hidden && !g.locked)) return el;
    const hidden = el.hidden || g.hidden;
    const locked = el.locked || g.locked;
    if (Boolean(hidden) === Boolean(el.hidden) && Boolean(locked) === Boolean(el.locked)) return el;
    changed = true;
    // OR, never assignment: a member locked on its own stays locked when its group is not.
    return { ...el, ...(hidden ? { hidden: true } : {}), ...(locked ? { locked: true } : {}) };
  });
  return changed ? { ...page, elements } : page;
}

/** Element ids belonging to `groupId`, in page (z) order. */
export function groupMembers(page: DesignPage, groupId: string): string[] {
  return page.elements.filter((el) => el.groupId === groupId).map((el) => el.id);
}
