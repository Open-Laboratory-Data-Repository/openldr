import { describe, it, expect } from 'vitest';
import { pageChunkCount, drawsOnChunk, resolveFlowY, toPt } from './pagination';
import type { ResolvedTable } from './pagination';
import { renderReportDesignPdf } from './index';
import type { DesignElement, DesignPage, ReportDesign } from '../schema';

const boundTable = (id: string, h: number, extra: Partial<DesignElement> = {}): DesignElement => ({
  id, kind: 'table', name: id, rect: { x: 0, y: 0, w: 400, h },
  dataSource: { kind: 'custom-query', queryId: 'q' },
  boundColumns: [{ key: 'a', label: 'A' }], ...extra,
});
const rows = (n: number): Record<string, unknown>[] => Array.from({ length: n }, (_, i) => ({ a: String(i) }));
const NOW = new Date('2026-09-01T10:00:00Z');

/** Same normalisation golden.test.ts uses: pdfkit stamps the clock into /CreationDate and derives
 *  /ID from it, so two renders of identical CONTENT still differ in those two spots. */
const normalize = (buf: Buffer): string => buf.toString('latin1')
  .replace(/\(D:\d+Z?\)/g, '(D:X)')
  .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');

const design = (elements: DesignElement[]): ReportDesign => ({
  id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', status: 'draft',
  parameters: [], pages: [{ id: 'p1', elements }],
});

describe('hidden elements are absent everywhere', () => {
  it('a hidden overflowing table adds no physical pages', () => {
    const el = boundTable('t', 120, { hidden: true });
    const resolved = new Map<string, ResolvedTable>([['t', { columns: [{ key: 'a', label: 'A' }], rows: rows(40) }]]);
    const page: DesignPage = { id: 'p', elements: [el] };
    expect(pageChunkCount(page, resolved)).toBe(1);
    expect(drawsOnChunk(el, page, resolved, 0)).toBe(false);
  });

  it('a flowAfter follower of a hidden target moves up into its place', () => {
    const target = boundTable('t', 400, { hidden: true });
    const follower: DesignElement = { id: 'f', kind: 'text', name: 'f', rect: { x: 0, y: 900, w: 100, h: 20 }, flowAfter: 't' };
    const page: DesignPage = { id: 'p', elements: [target, follower] };
    const resolved = new Map<string, ResolvedTable>([['t', { columns: [{ key: 'a', label: 'A' }], rows: rows(3) }]]);
    // The hidden target contributes its y but zero height: the follower sits where the target began.
    expect(resolveFlowY(follower, page, resolved, 0)).toBe(toPt(target.rect).y);
  });

  it('a design with a hidden element renders byte-identical to one without it', async () => {
    const keep: DesignElement = { id: 'k', kind: 'text', name: 'k', rect: { x: 0, y: 40, w: 200, h: 20 }, text: 'kept' };
    const ghost: DesignElement = { id: 'g', kind: 'text', name: 'g', rect: { x: 0, y: 80, w: 200, h: 20 }, text: 'ghost', hidden: true };
    const withHidden = await renderReportDesignPdf(design([keep, ghost]), new Map(), { now: NOW });
    const without = await renderReportDesignPdf(design([keep]), new Map(), { now: NOW });
    expect(normalize(withHidden)).toBe(normalize(without));
  });

  it('locked is authoring-only: a locked design renders byte-identical to an unlocked one', async () => {
    const el: DesignElement = { id: 'k', kind: 'text', name: 'k', rect: { x: 0, y: 40, w: 200, h: 20 }, text: 'kept' };
    const locked = await renderReportDesignPdf(design([{ ...el, locked: true }]), new Map(), { now: NOW });
    const plain = await renderReportDesignPdf(design([el]), new Map(), { now: NOW });
    expect(normalize(locked)).toBe(normalize(plain));
  });
});
