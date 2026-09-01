import { describe, it, expect } from 'vitest';
import { sparkValues, sparkPoints } from './spark';

describe('sparkValues', () => {
  it('parses a delimited numeric string, tolerating spaces and mixed separators', () => {
    expect(sparkValues('4,6,9,7')).toEqual([4, 6, 9, 7]);
    expect(sparkValues(' 4 , 6 ,9 ')).toEqual([4, 6, 9]);
    expect(sparkValues('4;6;9')).toEqual([4, 6, 9]);
  });

  it('refuses anything that is not two or more numbers, so the cell can print its text instead', () => {
    expect(sparkValues('')).toBeNull();
    expect(sparkValues('n/a')).toBeNull();
    expect(sparkValues('7')).toBeNull();          // one point is not a trend
    expect(sparkValues('4,n/a,9')).toBeNull();    // partial garbage is not silently dropped
    expect(sparkValues(undefined as unknown as string)).toBeNull();
  });
});

describe('sparkPoints', () => {
  const box = { x: 10, y: 20, w: 40, h: 12 }; // POINTS

  it('steps across the width and keeps every point inside the box', () => {
    const pts = sparkPoints(box, [4, 6, 9, 7]);
    expect(pts).toHaveLength(4);
    expect(pts[0].x).toBeCloseTo(box.x, 5);
    expect(pts[3].x).toBeCloseTo(box.x + box.w, 5);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(box.y);
      expect(p.y).toBeLessThanOrEqual(box.y + box.h);
    }
  });

  it('puts the biggest value highest and the smallest lowest', () => {
    const pts = sparkPoints(box, [4, 9]);
    expect(pts[1].y).toBeLessThan(pts[0].y);
  });

  it('a flat series sits on one line rather than dividing by zero', () => {
    const pts = sparkPoints(box, [5, 5, 5]);
    expect(pts.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(new Set(pts.map((p) => Math.round(p.y * 100))).size).toBe(1);
  });
});

describe('sparks in a rendered table', () => {
  const design = (spark: boolean) => ({
    id: 'd', name: 'D', paper: 'A4' as const, orientation: 'portrait' as const, status: 'published' as const,
    parameters: [],
    pages: [{ id: 'p1', elements: [{
      id: 't', kind: 'table' as const, name: 't', rect: { x: 40, y: 40, w: 400, h: 200 },
      dataSource: { kind: 'custom-query' as const, queryId: 'q' },
      boundColumns: [{ key: 'lab', label: 'Lab' }, { key: 'trend', label: 'Trend', ...(spark ? { spark: true } : {}) }],
    }] }],
  });
  const resolved = new Map([['t', {
    columns: [{ key: 'lab', label: 'Lab' }, { key: 'trend', label: 'Trend' }],
    rows: [{ lab: 'Tanga', trend: '4,6,9,7' }, { lab: 'Mafia', trend: 'n/a' }],
  }]]);
  const NOW = new Date('2026-09-01T10:00:00Z');

  it('a spark column draws a line and drops the text, while unparseable values keep theirs', async () => {
    const { renderReportDesignPdf } = await import('./index');
    const withSpark = await renderReportDesignPdf(design(true), resolved as never, { now: NOW });
    const asText = await renderReportDesignPdf(design(false), resolved as never, { now: NOW });
    expect(withSpark.equals(asText)).toBe(false);
    // '4,6,9,7' is drawn, not written; 'n/a' cannot be a trend so it still prints.
    const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex');
    const content = withSpark.toString('latin1');
    expect(content.includes(hex('4,6,9,7'))).toBe(false);
  });

  it('is inert when unset: the same design without the flag is byte-identical to before', async () => {
    const { renderReportDesignPdf } = await import('./index');
    const a = await renderReportDesignPdf(design(false), resolved as never, { now: NOW });
    const b = await renderReportDesignPdf(design(false), resolved as never, { now: NOW });
    const norm = (buf: Buffer) => buf.toString('latin1')
      .replace(/\(D:\d+Z?\)/g, '(D:X)').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');
    expect(norm(a)).toBe(norm(b));
  });
});
