import type { DesignElement, ElementKind, Orientation, Paper, Rect, ReportTemplate } from './types';

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
 *  ⛔ `cellgrid` is deliberately NOT here, and its absence is not an oversight. Inserting one from
 *  the palette would create an element with no `cellColumns`, which draws nothing at all: the kind
 *  is authored by a seeded design that knows its own query's column names. It still needs a name
 *  and an icon below, because an existing design containing one has to be editable. */
export const ELEMENT_KINDS: ElementKind[] = ['text', 'table', 'keyvalue', 'image', 'barcode', 'qrcode', 'line', 'rect', 'datetime'];

let seq = 0;
export function newElementId(): string { seq += 1; return `el-${Date.now()}-${seq}`; }

const DEFAULT_NAME: Record<ElementKind, string> = {
  text: 'Text', table: 'Table', image: 'Image', line: 'Line', rect: 'Rectangle', datetime: 'Date/time',
  keyvalue: 'Key/value panel', barcode: 'Barcode', qrcode: 'QR code', cellgrid: 'Cell grid',
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
  return { id, kind, name, rect: { x: 48, y: 48, w: 200, h: 80 } };
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
