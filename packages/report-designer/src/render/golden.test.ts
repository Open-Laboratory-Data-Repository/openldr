import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { renderReportDesignPdf, type ResolvedTable } from './index';
import type { ReportDesign } from '../schema';
import { elementChunkCount } from './draw';
import { cellFill } from './cellgrid';

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

/** A binary submission grid: two week groups, the first short, which is the shape a month starting
 *  mid-week produces. Kept separate from `goldenDesign()` so the untouched-design digest above
 *  stays sensitive to the shared path and nothing else. */
function cellGridDesign(): ReportDesign {
  return {
    id: 'cg', name: 'CellGrid', status: 'published', paper: 'A4', orientation: 'portrait',
    parameters: [],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'head', kind: 'text', name: 'head', rect: { x: 48, y: 40, w: 600, h: 14 },
          text: 'Any HVL/EID data submission by testing laboratory',
          style: { fontSize: 10, bold: true }, showWithTable: 'grid' },
        { id: 'grid', kind: 'cellgrid', name: 'grid', rect: { x: 48, y: 60, w: 698, h: 200 },
          dataSource: { kind: 'custom-query', queryId: 'q' },
          sortBy: 'ord',
          labelColumn: 'lab',
          cellColumns: ['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07', 'd08'],
          groupBoundary: 'token-change',
          palette: { ramp: 'blue', steps: 1 },
          trailingColumns: [
            { key: 'days', label: 'Days', width: 34.5 },
            { key: 'silent', label: 'Silent', width: 52 },
          ] },
      ],
    }],
    pageNumbers: true,
  };
}

function cellGridResolved(): Map<string, ResolvedTable> {
  const spread = (vals: (string | number)[]) =>
    Object.fromEntries(vals.map((v, i) => [`d${String(i + 1).padStart(2, '0')}`, v]));
  // ⛔ Keyed by the ELEMENT id, never the query id. `resolveDesignTables` does
  // `resolved.set(el.id, ...)` (resolve.ts:39) and every reader does `resolved.get(el.id)`
  // (index.ts:78, draw.ts:392, :401, :749). Keying by `'q'` resolves to undefined, the grid
  // renders as if it had zero rows, and the pagination assertion below fails for a reason that
  // has nothing to do with pagination. `goldenResolved()` above already keys by element id.
  return new Map([['grid', {
    columns: [{ key: 'lab', label: '' },
      ...Array.from({ length: 8 }, (_, i) => ({ key: `d${String(i + 1).padStart(2, '0')}`, label: '' })),
      { key: 'days', label: 'Days' }, { key: 'silent', label: 'Silent' }],
    rows: [
      // Wed Thu Fri | Mon Tue Wed Thu Fri  -> one break, at cell index 3
      { ord: 0, lab: '', days: 'Days', silent: 'Silent', ...spread(['03','04','05','09','10','11','12','13']) },
      { ord: 1, lab: '', days: '', silent: '', ...spread(['1','1','1','2','2','2','2','2']) },
      { ord: 2, lab: 'Bahi',   days: '02/08', silent: 'current',    ...spread([0, 0, 1, 0, 0, 0, 0, 1]) },
      { ord: 3, lab: 'Chunya', days: '01/08', silent: '05d silent', ...spread([1, 0, 0, 0, 0, 0, 0, 0]) },
    ],
  }]]);
}

// Proves DETERMINISM, not correctness. Two renders of one design agree; nothing here says the
// drawing is right. Task 10 and the unit tests in `cellgrid.test.ts` carry that.
//
// ⚠ Hash `normalisePdf(buf)`, never the raw buffer. pdfkit derives `/ID` by MD5-ing
// `info.CreationDate.getTime()` at millisecond precision, and `CreationDate` defaults to real
// wall-clock time at construction. `opts.now` does not reach it. Two back-to-back renders of an
// identical design therefore differ, and only in `/ID`. That is why the digest test above
// normalises too.
it('draws a cellgrid identically across runs', async () => {
  const at = new Date('2026-01-15T09:00:00Z');
  const a = await renderReportDesignPdf(cellGridDesign(), cellGridResolved(), { now: at });
  const b = await renderReportDesignPdf(cellGridDesign(), cellGridResolved(), { now: at });
  expect(createHash('sha256').update(normalisePdf(a)).digest('hex'))
    .toBe(createHash('sha256').update(normalisePdf(b)).digest('hex'));
  expect(a.length).toBeGreaterThan(1000);
});

// ⛔ Asserts the chunk count directly. It does NOT scrape the rendered PDF for `Page 5 / 5`:
// pdfkit FlateDecodes every content stream and splits text runs at kerning pairs inside `[...] TJ`
// arrays, so a plain string never appears in the bytes. `index.test.ts` documents that and carries
// `decodedContent`/`textsOf` helpers for the cases that genuinely need it. This one does not, and
// a direct assertion says what it means.
it('paginates a cellgrid whose rows exceed its rect', async () => {
  const many = cellGridResolved();
  const q = many.get('grid') as { columns: unknown[]; rows: Record<string, unknown>[] };
  for (let i = 0; i < 40; i += 1) {
    q.rows.push({ ord: 100 + i, lab: `Extra ${i}`, days: '00/08', silent: '08d silent',
      ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`d${String(k + 1).padStart(2, '0')}`, 0])) });
  }
  const el = cellGridDesign().pages[0].elements.find((e) => e.id === 'grid')!;
  // 200px@96 = 150pt; (150 - 13) / 12.75 = 10 rows a chunk; 42 records => 5 chunks
  expect(elementChunkCount(el, many.get('grid'))).toBe(5);
  const buf = await renderReportDesignPdf(cellGridDesign(), many, { now: new Date('2026-01-15T09:00:00Z') });
  expect(buf.length).toBeGreaterThan(1000);
});

/**
 * The month calendar from the approved design, expressed as a `cellgrid` in a DIFFERENT
 * configuration: seven cell columns, one row per week, no label column, five palette steps instead
 * of one, and no grouping.
 *
 * ⛔ If this needs anything added to `drawCellGrid`, the contract in spec §2.4 is wrong and slices 2
 * to 4 must not be built on it. Passing WITHOUT a production change is the assertion.
 */
function calendarDesign(): ReportDesign {
  return {
    id: 'cal', name: 'Calendar', status: 'published', paper: 'A4', orientation: 'portrait',
    parameters: [],
    pages: [{
      id: 'p1',
      elements: [
        { id: 'cal', kind: 'cellgrid', name: 'cal', rect: { x: 48, y: 60, w: 200, h: 120 },
          dataSource: { kind: 'custom-query', queryId: 'q' },
          sortBy: 'ord',
          cellColumns: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
          palette: { ramp: 'blue', steps: 5 } },
      ],
    }],
    pageNumbers: false,
  };
}

function calendarResolved(): Map<string, ResolvedTable> {
  const week = (ord: number, vals: (string | number)[]) =>
    ({ ord, ...Object.fromEntries(vals.map((v, i) => [`c${i + 1}`, v])) });
  // Element id, not query id. Same reason as `cellGridResolved` above.
  return new Map([['cal', {
    columns: Array.from({ length: 7 }, (_, i) => ({ key: `c${i + 1}`, label: '' })),
    rows: [
      week(0, ['M', 'T', 'W', 'T', 'F', 'S', 'S']),
      week(1, [0, 0, 0, 0, 0, 0, 1]),   // July 2018 starts on a Sunday
      week(2, [4, 1, 0, 0, 1, 0, 0]),
      week(3, [0, 0, 0, 5, 0, 0, 0]),
      week(4, [0, 0, 0, 0, 1, 0, 0]),
      week(5, [1, 1, 1, 2, 0, 0, 0]),
      week(6, [3, 2, 0, 0, 0, 0, 0]),
    ],
  }]]);
}

it('draws a month calendar as the same element in a second configuration', async () => {
  const buf = await renderReportDesignPdf(calendarDesign(), calendarResolved(), {
    now: new Date('2026-01-15T09:00:00Z'),
  });
  expect(buf.length).toBeGreaterThan(500);
});

it('keeps a calendar on one page: six weeks fit its rect', () => {
  const el = calendarDesign().pages[0].elements[0];
  expect(elementChunkCount(el, calendarResolved().get(el.id))).toBe(1);
});

it('scales the ramp across the whole calendar rather than per chunk', () => {
  // The maximum is 5. At steps: 5 the busiest day lands on the darkest step, and a 1 must not.
  expect(cellFill(5, 5, { ramp: 'blue', steps: 5 })).toBe('#185FA5');
  expect(cellFill(1, 5, { ramp: 'blue', steps: 5 })).not.toBe('#185FA5');
});
