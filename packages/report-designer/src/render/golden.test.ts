import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import type { ReportDesign } from '../schema';

/**
 * A byte-for-byte guard on what the renderer draws for a design that opts into NOTHING new.
 *
 * Why a hash and not a set of geometry assertions: `headerRow` changes the header band, the row
 * pitch, the column-width measurement and the chunk arithmetic all at once. Assertions can only
 * cover the paths their author thought of, and the whole claim being made here is "a design that
 * does not opt in is UNCHANGED" — which is a statement about every byte, not about the four
 * numbers a reviewer happened to name.
 *
 * ⚠ The expected digest is a RECORD OF A DECISION, not a fact about correct output. If you change
 * what the renderer draws ON PURPOSE, this test fails and you update the digest in the same commit
 * that explains why. If it fails and you did NOT mean to change the drawing of a design with no
 * `headerRow`, you have broken the opt-in and the digest is telling you so.
 *
 * The fixture is defined HERE rather than imported from `@openldr/reporting`'s seeds so an
 * unrelated edit to a seeded report cannot make this fail — it must stay sensitive to the RENDERER
 * and to nothing else.
 */
function goldenDesign(): ReportDesign {
  return {
    id: 'golden', name: 'Golden', status: 'published', paper: 'A4', orientation: 'landscape',
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true, value: { from: '2026-01-01', to: '2026-01-31' } },
      { key: 'site', label: 'Site', type: 'text', required: false, value: 'Central' },
    ],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'rule', kind: 'line', name: 'rule', rect: { x: 48, y: 90, w: 700, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
        { id: 'box', kind: 'rect', name: 'box', rect: { x: 48, y: 20, w: 200, h: 60 }, style: { fill: '#f1f5f9', strokeColor: '#94a3b8', strokeWidth: 1 } },
        { id: 'title', kind: 'text', name: 'title', rect: { x: 48, y: 100, w: 600, h: 28 }, text: 'Golden {{param.site}} {{param.from}}', style: { fontSize: 18, bold: true } },
        { id: 'when', kind: 'datetime', name: 'when', rect: { x: 660, y: 100, w: 200, h: 14 }, style: { fontSize: 8, align: 'right' } },
        { id: 'logo', kind: 'image', name: 'logo', rect: { x: 700, y: 20, w: 54, h: 54 }, src: '{{lab.logo}}' },
        { id: 'kv', kind: 'keyvalue', name: 'kv', rect: { x: 48, y: 130, w: 400, h: 48 }, layout: 'inline', panelColumns: 2,
          text: 'Scope', style: { strokeColor: '#cbd5e1' },
          rows: [['From', '{{param.from}}'], ['To', '{{param.to}}'], ['Site', '{{param.site}}'], ['Run', '{{date}}']] },
        { id: 'kvb', kind: 'keyvalue', name: 'kvb', rect: { x: 460, y: 130, w: 300, h: 48 }, layout: 'stacked', panelColumns: 2,
          dataSource: { kind: 'custom-query', queryId: 'q' },
          boundColumns: [{ key: 'antibiotic', label: 'Drug' }, { key: 'r', label: 'R', statusKey: 'st', emphasis: 'fill' }] },
        { id: 'tbl', kind: 'table', name: 'tbl', rect: { x: 48, y: 190, w: 700, h: 90 },
          dataSource: { kind: 'custom-query', queryId: 'q' },
          sortBy: 'ord',
          boundColumns: [
            { key: 'antibiotic', label: 'Antibiotic' },
            { key: 'tested', label: 'Tested' },
            { key: 'r', label: 'R', statusKey: 'st', emphasis: 'fill' },
            { key: 'note', label: 'Note', kind: 'range' },
          ] },
        { id: 'bar', kind: 'barcode', name: 'bar', rect: { x: 48, y: 300, w: 200, h: 40 }, text: 'ACC-000123' },
        { id: 'qr', kind: 'qrcode', name: 'qr', rect: { x: 300, y: 300, w: 60, h: 60 }, text: 'https://example.invalid/r/1' },
      ],
    }],
    pageNumbers: true,
  } as ReportDesign;
}

const goldenRows = Array.from({ length: 9 }, (_, i) => ({
  ord: 9 - i,
  antibiotic: `Antibiotic number ${i} with a deliberately long name`,
  tested: String(i * 7),
  r: String(i),
  st: ['normal', 'abnormal', 'critical', 'indeterminate', 'none'][i % 5],
  note: `${i}-${i + 4}`,
}));

function goldenResolved(): Map<string, ResolvedTable> {
  const table: ResolvedTable = {
    columns: [
      { key: 'ord', label: 'Ord' }, { key: 'antibiotic', label: 'Antibiotic' },
      { key: 'tested', label: 'Tested' }, { key: 'r', label: 'R' },
      { key: 'st', label: 'St' }, { key: 'note', label: 'Note' },
    ],
    rows: goldenRows,
  };
  return new Map<string, ResolvedTable>([['tbl', table], ['kvb', table]]);
}

/** pdfkit stamps the clock into `/CreationDate` and derives `/ID` from it. Both are replaced with a
 *  fixed-width placeholder so the digest describes the DRAWING and not the moment of the run.
 *  Verified stable across separate node processes before this test was committed. */
function normalisePdf(b: Buffer): string {
  return b.toString('latin1')
    .replace(/\(D:\d+Z?\)/g, '(D:X)')
    .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [X]');
}

/** Recorded at `428a7766`, BEFORE `headerRow`/`showWithTable` existed. */
const GOLDEN_DIGEST = '6fcfee5c1935f04af41791480ac8e589cad9ba3fa58b82938179b406faf2d8ff';

async function goldenDigest(): Promise<string> {
  const buf = await renderReportDesignPdf(goldenDesign(), goldenResolved(), {
    now: new Date('2026-01-02T03:04:05Z'),
    identity: { name: 'Reference Laboratory', address: 'PO Box 1', contact: 'lab@example.invalid' },
    values: { from: '2026-01-01', to: '2026-01-31', site: 'Central' },
  });
  return createHash('sha256').update(normalisePdf(buf)).digest('hex');
}

describe('golden — a design that opts into nothing renders byte-identically', () => {
  it('matches the digest recorded before `headerRow` existed', async () => {
    expect(await goldenDigest()).toBe(GOLDEN_DIGEST);
  });
});
