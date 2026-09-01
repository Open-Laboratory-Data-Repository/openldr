import type { DesignElement, DesignPage, ElementKind, Orientation, Paper, Rect, ReportTemplate } from './types';
import { groupMembers } from './types';

/** Paper sizes in CSS px at 96dpi, portrait. */
export const PAPER_PX: Record<Paper, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
};

export function paperSize(paper: Paper, orientation: Orientation): { w: number; h: number } {
  const b = PAPER_PX[paper];
  return orientation === 'landscape' ? { w: b.h, h: b.w } : b;
}

/** Insertable element kinds, in menu order.
 *
 *  `cellgrid` was excluded while its config was JSON-only (an element with no `cellColumns` draws
 *  nothing). The Properties tab now authors that config, so a fresh insert is editable into a real
 *  grid and the exclusion no longer protects anyone. */
export const ELEMENT_KINDS: ElementKind[] = ['text', 'table', 'keyvalue', 'image', 'barcode', 'qrcode', 'line', 'rect', 'datetime', 'cellgrid', 'chart', 'letterhead'];

let seq = 0;
export function newElementId(): string { seq += 1; return `el-${Date.now()}-${seq}`; }

const DEFAULT_NAME: Record<ElementKind, string> = {
  text: 'Text', table: 'Table', image: 'Image', line: 'Line', rect: 'Rectangle', datetime: 'Date/time',
  keyvalue: 'Key/value panel', barcode: 'Barcode', qrcode: 'QR code', cellgrid: 'Cell grid', chart: 'Chart', letterhead: 'Letterhead',
};

export function newElement(kind: ElementKind): DesignElement {
  const id = newElementId();
  const name = DEFAULT_NAME[kind];
  if (kind === 'text') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 }, text: 'Text' };
  if (kind === 'datetime') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 }, text: '{{date}}' };
  if (kind === 'line') return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 2 } };
  if (kind === 'table') return {
    id, kind, name, rect: { x: 48, y: 48, w: 480, h: 160 },
    columns: ['Column A', 'Column B'], rows: [['—', '—'], ['—', '—']],
  };
  // Sample PAIRS, matching how a new table gets sample rows: a freshly dropped panel has to show
  // its own shape before it is bound to anything.
  if (kind === 'keyvalue') return {
    id, kind, name, rect: { x: 48, y: 48, w: 320, h: 72 }, layout: 'inline', panelColumns: 1,
    rows: [['Label', '—'], ['Label', '—']],
  };
  // A barcode is WIDE and short, a QR is SQUARE — dropping either at the generic 200x80 gives a
  // squashed symbol the author has to fix before it can even be read.
  if (kind === 'barcode') return { id, kind, name, rect: { x: 48, y: 48, w: 220, h: 56 }, text: '123456789', caption: true };
  if (kind === 'qrcode') return { id, kind, name, rect: { x: 48, y: 48, w: 80, h: 80 }, text: '123456789' };
  // Five declared cells and a binary palette: enough for the canvas preview to show a real shape
  // before the author binds a query and renames the columns to the query's own keys.
  if (kind === 'cellgrid') return {
    id, kind, name, rect: { x: 48, y: 48, w: 480, h: 160 },
    cellColumns: ['c1', 'c2', 'c3', 'c4', 'c5'],
    palette: { ramp: 'blue', steps: 1 },
  };
  if (kind === 'chart') return { id, kind, name, rect: { x: 48, y: 48, w: 480, h: 200 }, chartType: 'bar' };
  if (kind === 'letterhead') return { id, kind, name, rect: { x: 48, y: 28, w: 698, h: 66 } };
  return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 } };
}

/** Elements a Place-below Select may offer `forId`. Excludes the element itself and any element
 *  whose own `flowAfter` chain reaches `forId`: the renderer THROWS on a flow cycle (schema.ts's
 *  `flowAfter` contract), so the UI must never offer one. A dangling reference simply ends the
 *  walk, and a visited set guards stored data that already contains a cycle. */
export function flowTargets(elements: DesignElement[], forId: string): DesignElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const reachesMe = (start: DesignElement): boolean => {
    const seen = new Set<string>();
    let cur: DesignElement | undefined = start;
    while (cur?.flowAfter) {
      if (cur.flowAfter === forId) return true;
      if (seen.has(cur.flowAfter)) return false;
      seen.add(cur.flowAfter);
      cur = byId.get(cur.flowAfter);
    }
    return false;
  };
  return elements.filter((e) => e.id !== forId && !reachesMe(e));
}

export function addElement(tpl: ReportTemplate, pageIndex: number, el: DesignElement): ReportTemplate {
  const pages = tpl.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p));
  return { ...tpl, pages };
}

export function findElement(tpl: ReportTemplate, id: string | null): DesignElement | null {
  if (!id) return null;
  for (const p of tpl.pages) {
    const e = p.elements.find((x) => x.id === id);
    if (e) return e;
  }
  return null;
}

export function allElements(tpl: ReportTemplate): DesignElement[] {
  return tpl.pages.flatMap((p) => p.elements);
}

export function updateElementRects(tpl: ReportTemplate, rects: Map<string, Rect>): ReportTemplate {
  if (rects.size === 0) return tpl;
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => (rects.has(e.id) ? { ...e, rect: rects.get(e.id)! } : e)),
    })),
  };
}

export function removeElements(tpl: ReportTemplate, ids: Set<string>): ReportTemplate {
  if (ids.size === 0) return tpl;
  return { ...tpl, pages: tpl.pages.map((p) => ({ ...p, elements: p.elements.filter((e) => !ids.has(e.id)) })) };
}

export function updateElement(tpl: ReportTemplate, id: string, patch: Partial<DesignElement>): ReportTemplate {
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => {
        if (e.id !== id) return e;
        const merged: DesignElement = { ...e, ...patch };
        if (patch.style) merged.style = { ...e.style, ...patch.style };
        return merged;
      }),
    })),
  };
}

/** Move an element to `targetIndex` within its own page (clamped). Array order IS z-order. */
export function moveElementTo(tpl: ReportTemplate, id: string, targetIndex: number): ReportTemplate {
  const pageIdx = tpl.pages.findIndex((p) => p.elements.some((e) => e.id === id));
  if (pageIdx < 0) return tpl;
  const els = tpl.pages[pageIdx].elements.slice();
  const from = els.findIndex((e) => e.id === id);
  const to = Math.max(0, Math.min(els.length - 1, targetIndex));
  if (from === to) return tpl;
  const [moved] = els.splice(from, 1);
  els.splice(to, 0, moved);
  return { ...tpl, pages: tpl.pages.map((p, i) => (i === pageIdx ? { ...p, elements: els } : p)) };
}

/** Clone the named elements onto their own pages: fresh ids, a 12px offset clamped to the page,
 *  and `locked` stripped — a clone you cannot move is not a useful starting point. Returns the new
 *  ids so the caller can select them. Unknown ids clone nothing and return the template as-is. */
export function duplicateElements(
  tpl: ReportTemplate, ids: string[],
): { template: ReportTemplate; newIds: string[] } {
  const size = paperSize(tpl.paper, tpl.orientation);
  const newIds: string[] = [];
  let changed = false;
  const pages = tpl.pages.map((p) => {
    const clones = p.elements.filter((e) => ids.includes(e.id)).map((e) => {
      const id = newElementId();
      newIds.push(id);
      const { locked: _drop, ...rest } = e;
      const x = Math.max(0, Math.min(e.rect.x + 12, size.w - e.rect.w));
      const y = Math.max(0, Math.min(e.rect.y + 12, size.h - e.rect.h));
      return { ...rest, id, rect: { ...e.rect, x, y } };
    });
    if (clones.length === 0) return p;
    changed = true;
    return { ...p, elements: [...p.elements, ...clones] };
  });
  return changed ? { template: { ...tpl, pages }, newIds } : { template: tpl, newIds };
}

/** Group two or more elements on one page under a new named group. Fewer than two is not a group,
 *  and z-order is untouched: a group is a LABEL over members, never a container (see groups.ts). */
export function groupElements(
  tpl: ReportTemplate, ids: string[], name: string,
): { template: ReportTemplate; groupId: string | null } {
  if (ids.length < 2) return { template: tpl, groupId: null };
  const pageIdx = tpl.pages.findIndex((p) => p.elements.some((e) => ids.includes(e.id)));
  if (pageIdx < 0) return { template: tpl, groupId: null };
  const groupId = `g-${newElementId()}`;
  const pages = tpl.pages.map((p, i) => {
    if (i !== pageIdx) return p;
    return {
      ...p,
      groups: [...(p.groups ?? []), { id: groupId, name }],
      elements: p.elements.map((e) => (ids.includes(e.id) ? { ...e, groupId } : e)),
    };
  });
  return { template: { ...tpl, pages }, groupId };
}

/** Drop a group and clear its members back to ungrouped. The elements themselves are untouched. */
export function ungroupElements(tpl: ReportTemplate, groupId: string): ReportTemplate {
  return {
    ...tpl,
    pages: tpl.pages.map((p) => {
      if (!(p.groups ?? []).some((g) => g.id === groupId)) return p;
      return {
        ...p,
        groups: (p.groups ?? []).filter((g) => g.id !== groupId),
        elements: p.elements.map((e) => {
          if (e.groupId !== groupId) return e;
          const { groupId: _drop, ...rest } = e;
          return rest;
        }),
      };
    }),
  };
}

/** Patch one group's flags. An `undefined` value DELETES the key, the setStatusKey idiom. */
export function patchGroup(
  tpl: ReportTemplate, groupId: string, patch: { name?: string; locked?: boolean; hidden?: boolean },
): ReportTemplate {
  return {
    ...tpl,
    pages: tpl.pages.map((p) => {
      if (!(p.groups ?? []).some((g) => g.id === groupId)) return p;
      return {
        ...p,
        groups: (p.groups ?? []).map((g) => {
          if (g.id !== groupId) return g;
          const next: Record<string, unknown> = { ...g };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete next[k]; else next[k] = v;
          }
          return next as typeof g;
        }),
      };
    }),
  };
}

/** The ids a click on `id` should select: the whole group, or just the element when `alt`.
 *  Alt-click is the standard escape hatch for reaching one member of a group. */
export function selectionWithGroups(page: DesignPage, id: string, alt = false): string[] {
  if (alt) return [id];
  const el = page.elements.find((e) => e.id === id);
  if (!el?.groupId) return [id];
  return groupMembers(page, el.groupId);
}

export function updateElements(tpl: ReportTemplate, ids: string[], patch: Partial<DesignElement>): ReportTemplate {
  if (ids.length === 0) return tpl;
  const set = new Set(ids);
  return {
    ...tpl,
    pages: tpl.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => {
        if (!set.has(e.id)) return e;
        const merged: DesignElement = { ...e, ...patch };
        if (patch.style) merged.style = { ...e.style, ...patch.style };
        return merged;
      }),
    })),
  };
}

/** Set (or clear) one printed translation on the design.
 *
 *  ⛔ The map is PRUNED on the way out: an empty string deletes the entry, an emptied language
 *  deletes the language, and an emptied map deletes `i18n` itself. Without that, switching to
 *  French, typing, and deleting again would leave `{ fr: { e1: '' } }` behind, and the renderer
 *  would print a blank heading instead of falling back to the authored text. Deleting rather than
 *  storing an empty string is what makes the fallback contract in `i18n.ts` hold. */
export function setI18nText(tpl: ReportTemplate, lang: string, key: string, text: string): ReportTemplate {
  const all = { ...(tpl.i18n ?? {}) };
  const dict = { ...(all[lang] ?? {}) };
  if (text === '') delete dict[key]; else dict[key] = text;
  if (Object.keys(dict).length === 0) delete all[lang]; else all[lang] = dict;
  if (Object.keys(all).length === 0) {
    const { i18n: _drop, ...rest } = tpl;
    return rest as ReportTemplate;
  }
  return { ...tpl, i18n: all };
}
