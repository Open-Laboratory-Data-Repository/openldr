import { describe, it, expect } from 'vitest';
// Through the PURE barrel on purpose: this file is the proof the pagination math is reachable
// without the pdfkit entry point. If pure.ts ever pulls the render barrel, this import chain
// (and every studio test that goes through `./types`) drags pdfkit into jsdom and fails loudly.
import { pageChunkCount, totalPhysicalPages, elementChunkCount, drawsOnChunk, resolveFlowY, maxRowsFor, ROW_H, toPt } from '../pure';
import type { ResolvedTable, DesignElement, DesignPage } from '../pure';

const boundTable = (id: string, h: number): DesignElement => ({
  id, kind: 'table', name: id, rect: { x: 0, y: 0, w: 400, h },
  dataSource: { kind: 'custom-query', queryId: 'q' },
  boundColumns: [{ key: 'a', label: 'A' }],
});

const rows = (n: number): Record<string, unknown>[] => Array.from({ length: n }, (_, i) => ({ a: String(i) }));

describe('pagination through the pure barrel', () => {
  it('counts chunks for an overflowing table and sums physical pages', () => {
    const el = boundTable('t', 120);
    const resolved = new Map<string, ResolvedTable>([['t', { columns: [{ key: 'a', label: 'A' }], rows: rows(40) }]]);
    const page: DesignPage = { id: 'p', elements: [el] };
    const chunks = pageChunkCount(page, resolved);
    expect(chunks).toBeGreaterThan(1);
    expect(totalPhysicalPages([page], resolved)).toBe(chunks);
    // The count comes from the same arithmetic the renderer draws with, in POINTS.
    const perChunk = maxRowsFor(toPt(el.rect).h, ROW_H);
    expect(chunks).toBe(Math.ceil(40 / perChunk));
    expect(elementChunkCount(el, resolved.get('t'), { page, resolved })).toBe(chunks);
  });

  it('a fitting table is one chunk and text draws on every chunk', () => {
    const el = boundTable('t', 400);
    const resolved = new Map<string, ResolvedTable>([['t', { columns: [{ key: 'a', label: 'A' }], rows: rows(3) }]]);
    const page: DesignPage = { id: 'p', elements: [el] };
    expect(pageChunkCount(page, resolved)).toBe(1);
    const text: DesignElement = { id: 'x', kind: 'text', name: 'x', rect: { x: 0, y: 500, w: 100, h: 20 } };
    expect(drawsOnChunk(text, { id: 'p', elements: [el, text] }, resolved, 0)).toBe(true);
  });

  it('resolveFlowY places a follower under what its target actually drew', () => {
    const el = boundTable('t', 400);
    const follower: DesignElement = { id: 'f', kind: 'text', name: 'f', rect: { x: 0, y: 900, w: 100, h: 20 }, flowAfter: 't' };
    const page: DesignPage = { id: 'p', elements: [el, follower] };
    const resolved = new Map<string, ResolvedTable>([['t', { columns: [{ key: 'a', label: 'A' }], rows: rows(3) }]]);
    const y = resolveFlowY(follower, page, resolved, 0);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(toPt(follower.rect).y); // moved up from its declared fallback
  });
});
