import { describe, it, expect } from 'vitest';
import { ELEMENT_KINDS, flowTargets, newElement, addElement, paperSize, findElement, allElements, updateElementRects, removeElements, updateElement, updateElements } from './model';
import { MOCK_TEMPLATES } from './mockTemplates';
import type { DesignElement, ReportTemplate } from './types';

describe('report-designer model', () => {
  it('newElement produces a text element with default content', () => {
    const el = newElement('text');
    expect(el.kind).toBe('text');
    expect(el.text).toBe('Text');
    expect(el.rect).toEqual({ x: 48, y: 48, w: 200, h: 80 });
  });

  it('newElement produces a table with columns and sample rows', () => {
    const el = newElement('table');
    expect(el.kind).toBe('table');
    expect(el.columns?.length).toBe(2);
    expect((el.rows ?? []).length).toBeGreaterThan(0);
  });

  it('addElement appends to the given page immutably', () => {
    const tpl: ReportTemplate = { id: 't', name: 'x', paper: 'A4', orientation: 'portrait', status: 'draft', pages: [{ id: 'p1', elements: [] }], parameters: [] };
    const next = addElement(tpl, 0, newElement('text'));
    expect(next.pages[0].elements).toHaveLength(1);
    expect(tpl.pages[0].elements).toHaveLength(0);
  });

  it('paperSize swaps width/height for landscape', () => {
    const p = paperSize('A4', 'portrait');
    const l = paperSize('A4', 'landscape');
    expect(l.w).toBe(p.h);
    expect(l.h).toBe(p.w);
  });

  it('findElement locates an element by id across pages', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    expect(findElement(tpl, id)?.id).toBe(id);
    expect(findElement(tpl, 'nope')).toBeNull();
  });

  it('MOCK_TEMPLATES seeds at least three templates', () => {
    expect(MOCK_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(MOCK_TEMPLATES[0].pages.length).toBeGreaterThan(0);
  });

  it('allElements flattens across pages', () => {
    expect(allElements(MOCK_TEMPLATES[0]).length).toBe(
      MOCK_TEMPLATES[0].pages.reduce((n, p) => n + p.elements.length, 0),
    );
  });

  it('updateElementRects replaces only the given rects, immutably', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = updateElementRects(tpl, new Map([[id, { x: 1, y: 2, w: 3, h: 4 }]]));
    expect(next.pages[0].elements[0].rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(tpl.pages[0].elements[0].rect).not.toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('removeElements drops the given ids', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = removeElements(tpl, new Set([id]));
    expect(allElements(next).some((e) => e.id === id)).toBe(false);
  });

  it('updateElement merges a shallow patch immutably', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const next = updateElement(tpl, id, { text: 'Hi' });
    expect(next.pages[0].elements[0].text).toBe('Hi');
    expect(tpl.pages[0].elements[0].text).not.toBe('Hi');
  });

  it('updateElement shallow-merges the style object', () => {
    const tpl = MOCK_TEMPLATES[0];
    const id = tpl.pages[0].elements[0].id;
    const a = updateElement(tpl, id, { style: { bold: true } });
    const b = updateElement(a, id, { style: { fontSize: 18 } });
    const el = b.pages[0].elements.find((e) => e.id === id)!;
    expect(el.style).toEqual({ bold: true, fontSize: 18 });
  });

  it('updateElements fans a patch across ids, shallow-merging style', () => {
    const tpl = MOCK_TEMPLATES[0];
    const ids = [tpl.pages[0].elements[0].id, tpl.pages[0].elements[1].id];
    const next = updateElements(tpl, ids, { style: { bold: true } });
    expect(next.pages[0].elements[0].style).toEqual({ bold: true });
    expect(next.pages[0].elements[1].style).toEqual({ bold: true });
    expect(tpl.pages[0].elements[0].style).toBeUndefined();
  });

  it('includes cellgrid in the insert palette', () => {
    expect(ELEMENT_KINDS).toContain('cellgrid');
  });

  it('creates a cellgrid with declared cells and a binary palette', () => {
    const el = newElement('cellgrid');
    expect(el.kind).toBe('cellgrid');
    expect(el.cellColumns).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(el.palette).toEqual({ ramp: 'blue', steps: 1 });
    expect(el.rect).toEqual({ x: 48, y: 48, w: 480, h: 160 });
  });

  describe('flowTargets', () => {
    const el = (id: string, flowAfter?: string): DesignElement =>
      ({ id, kind: 'text', name: id, rect: { x: 0, y: 0, w: 10, h: 10 }, ...(flowAfter ? { flowAfter } : {}) });

    it('offers every other element when no chains exist', () => {
      const els = [el('a'), el('b'), el('c')];
      expect(flowTargets(els, 'a').map((e) => e.id)).toEqual(['b', 'c']);
    });

    it('never offers the element itself', () => {
      expect(flowTargets([el('a')], 'a')).toEqual([]);
    });

    it('excludes an element whose chain already reaches me', () => {
      // b follows a and c follows b; offering either to a would close a cycle.
      const els = [el('a'), el('b', 'a'), el('c', 'b')];
      expect(flowTargets(els, 'a').map((e) => e.id)).toEqual([]);
      expect(flowTargets(els, 'c').map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('tolerates a dangling flowAfter without looping', () => {
      const els = [el('a'), el('b', 'ghost')];
      expect(flowTargets(els, 'a').map((e) => e.id)).toEqual(['b']);
    });

    it('tolerates pre-existing cycle data without looping', () => {
      // b and c already point at each other (bad stored data); asking for a's targets must end.
      const els = [el('a'), el('b', 'c'), el('c', 'b')];
      expect(flowTargets(els, 'a').map((e) => e.id)).toEqual(['b', 'c']);
    });
  });
});
