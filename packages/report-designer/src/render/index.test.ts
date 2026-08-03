import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import type { ReportDesign, BoundColumn } from '../schema';

const NOW = new Date('2026-07-08T00:00:00Z');

function baseDesign(over: Partial<ReportDesign> = {}): ReportDesign {
  return { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p1', elements: [] }], ...over } as ReportDesign;
}

describe('renderReportDesignPdf', () => {
  it('returns a non-empty PDF buffer starting with %PDF', async () => {
    const buf = await renderReportDesignPdf(baseDesign(), new Map(), { now: NOW });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a bound table from resolved rows and a query-error placeholder without throwing', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'A', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q1' }, boundColumns: [{ key: 'org', label: 'Organism' }] },
      { id: 't2', kind: 'table', name: 'B', rect: { x: 10, y: 200, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q2' } },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([
      ['t1', { columns: [{ key: 'org', label: 'Organism' }], rows: [{ org: 'E. coli' }] }],
      ['t2', { error: 'boom' }],
    ]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('does not throw or corrupt the stream when an image src is invalid, and still draws following elements', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 'img', kind: 'image', name: 'I', rect: { x: 10, y: 10, w: 80, h: 60 }, src: 'data:image/png;base64,NOTVALID' },
      { id: 'txt', kind: 'text', name: 'T', rect: { x: 10, y: 90, w: 300, h: 20 }, text: 'after the bad image' },
      { id: 'box', kind: 'rect', name: 'R', rect: { x: 10, y: 120, w: 100, h: 40 }, style: { fill: '#eef' } },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(100);
  });

  it('emits one PDF page per design page', async () => {
    const two = baseDesign({ pages: [{ id: 'a', elements: [] }, { id: 'b', elements: [] }] });
    const buf = await renderReportDesignPdf(two, new Map(), { now: NOW });
    expect(buf.toString('latin1')).toContain('/Type /Pages');
    expect(buf.toString('latin1')).toMatch(/\/Count 2/);
  });

  it('paginates an overflowing table onto extra pages and repeats non-table elements', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 'title', kind: 'text', name: 'Title', rect: { x: 10, y: 10, w: 300, h: 20 }, text: 'Turnaround time' },
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 40, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: `row${i}` })) }]]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/Count 3/);
  });

  it('renders exactly one page when the table fits (no regression)', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 200 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] });
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 'x' }, { a: 'y' }] }]]);
    const buf = await renderReportDesignPdf(design, resolved, { now: NOW });
    expect(buf.toString('latin1')).toMatch(/\/Count 1/);
  });

  it('paginates an overflowing static (unbound) table through the render path', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, columns: ['A'], rows: Array.from({ length: 7 }, (_, i) => [`r${i}`]) },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map(), { now: NOW });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.toString('latin1')).toMatch(/\/Count 3/);
  });

  it('draws the page-number footer as chrome — same /Count with pageNumbers on as off, and does not throw', async () => {
    const pages = [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns: [{ key: 'a', label: 'A' }] },
    ] }] as ReportDesign['pages'];
    const resolved = new Map<string, ResolvedTable>([['t1', { columns: [{ key: 'a', label: 'A' }], rows: Array.from({ length: 7 }, (_, i) => ({ a: `row${i}` })) }]]);
    const off = await renderReportDesignPdf(baseDesign({ pages }), resolved, { now: NOW });
    const on = await renderReportDesignPdf(baseDesign({ pages, pageNumbers: true }), resolved, { now: NOW });
    expect(off.toString('latin1')).toMatch(/\/Count 3/);
    expect(on.toString('latin1')).toMatch(/\/Count 3/); // footer is chrome, not extra pages
    expect(on.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('an error table does not paginate (1 page) and does not throw', async () => {
    const design = baseDesign({ pages: [{ id: 'p1', elements: [
      { id: 't1', kind: 'table', name: 'T', rect: { x: 10, y: 10, w: 300, h: 100 }, dataSource: { kind: 'custom-query', queryId: 'q' } },
    ] }] });
    const buf = await renderReportDesignPdf(design, new Map([['t1', { error: 'boom' }]]), { now: NOW });
    expect(buf.toString('latin1')).toMatch(/\/Count 1/);
  });
});

/** Text baselines, in PDF user space, parsed out of the (deflated) content streams.
 *  pdfkit emits `1 0 0 1 <x> <y> Tm` before each run — verified against pdfkit 0.15.2. */
function textYs(pdf: Buffer): number[] {
  const ys: number[] = [];
  const raw = pdf.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streams.exec(raw))) {
    let body: string;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    const tm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
    let t: RegExpExecArray | null;
    while ((t = tm.exec(body))) ys.push(parseFloat(t[2]));
  }
  return ys;
}

const statusDesign = (boundColumns: BoundColumn[]): ReportDesign => ({
  id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', parameters: [],
  pages: [{ id: 'p', elements: [{
    id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 400, h: 200 },
    dataSource: { kind: 'custom-query', queryId: 'q' }, boundColumns,
  }] }],
} as ReportDesign);

const statusRows = (): Map<string, ResolvedTable> => new Map([['t', {
  columns: [{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }],
  rows: [
    { name: 'HIV 1/2 Ab', res: 'Negative', s: 'normal' },
    { name: 'HBsAg', res: 'Positive', s: 'abnormal' },
    { name: 'Treponema pallidum antibody screen', res: 'Indeterminate', s: 'indeterminate' },
  ],
}]]);

describe('cell status rendering', () => {
  it('does not move a single text baseline when a filled status column is added', async () => {
    const plain = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }]), statusRows());
    const filled = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    expect(textYs(filled)).toEqual(textYs(plain));
  });

  it('keeps every body row exactly ROW_H apart with a long value in a filled cell', async () => {
    const pdf = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    const rowYs = [...new Set(textYs(pdf))].sort((a, b) => b - a);
    const gaps = rowYs.slice(1).map((y, i) => Number((rowYs[i] - y).toFixed(3)));
    expect(gaps).toEqual([16, 16, 16]);
  });

  it('emits no status fill when the design declares no statusKey', async () => {
    const plain = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' }, { key: 'res', label: 'Result' }]), statusRows());
    const filled = await renderReportDesignPdf(
      statusDesign([{ key: 'name', label: 'Test' },
                    { key: 'res', label: 'Result', statusKey: 's', emphasis: 'fill' }]), statusRows());
    expect(filled.length).toBeGreaterThan(plain.length);
  });
});
