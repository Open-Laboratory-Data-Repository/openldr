import { describe, it, expect } from 'vitest';
import { buildReportingForTest } from './index';

const design = { id: 'd1', name: 'AMR', paper: 'A4', orientation: 'portrait',
  parameters: [{ key: 'facility', label: 'Facility', type: 'select', value: '' }],
  pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 },
    dataSource: { kind: 'custom-query', queryId: 'q1' } }] }] } as any;
const def = { id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1',
  primaryQueryId: 'q1', summaryMetrics: null, chart: { type: 'bar', x: 'a', y: 'b' },
  paramOptions: { facility: 'q-fac' }, status: 'published' } as any;
// Task 1 fixtures: a two-column options query (code + name) and a one-column options query, to
// prove the value/label split and the single-column fallback respectively.
const defWithFacility = { id: 'r-with-facility', name: 'AMR', description: '', category: 'amr', designId: 'd1',
  primaryQueryId: 'q1', summaryMetrics: null, chart: { type: 'bar', x: 'a', y: 'b' },
  paramOptions: { facility: 'q-fac-2col' }, status: 'published' } as any;
const defWithSingleColumnOptions = { id: 'r-with-single-column-options', name: 'AMR', description: '', category: 'amr', designId: 'd1',
  primaryQueryId: 'q1', summaryMetrics: null, chart: { type: 'bar', x: 'a', y: 'b' },
  paramOptions: { facility: 'q-single' }, status: 'published' } as any;

let lastRunStoredQueryValues: Record<string, unknown> | undefined;
// Captures the third argument `renderReportDesignPdf` was actually called with, so the bootstrap
// wiring line (`packages/bootstrap/src/index.ts:242`, `{ identity, values }`) has a test pinning it
// — an opaque mock that ignores its arguments would keep passing if that line reverted to dropping
// `values` (or `identity`) entirely.
let lastRenderOptions: { identity?: unknown; values?: Record<string, unknown> } | undefined;
const deps = {
  reportDefs: {
    list: async () => [def],
    get: async (id: string) => {
      if (id === 'r1') return def;
      if (id === 'r-with-facility') return defWithFacility;
      if (id === 'r-with-single-column-options') return defWithSingleColumnOptions;
      return undefined;
    },
  },
  reportDesigns: { get: async (id: string) => id === 'd1' ? design : undefined },
  runStoredQuery: async (queryId: string, values: Record<string, unknown>) => {
    lastRunStoredQueryValues = values;
    if (queryId === 'q-fac') return { columns: [{ key: 'v', label: 'v' }], rows: [{ v: 'Ndola' }, { v: 'Lusaka' }] };
    // Column 0 = code (the filter value), column 1 = display name (the label) — the "Aga Khan"
    // shape: five DISA facility codes share the display name, so the code must survive as the value.
    if (queryId === 'q-fac-2col') {
      return {
        columns: [{ key: 'code', label: 'code' }, { key: 'name', label: 'name' }],
        rows: [
          { code: 'BAGAE', name: 'National Public Health Laboratory' },
          { code: 'BAMAA', name: 'Aga Khan' },
        ],
      };
    }
    if (queryId === 'q-single') return { columns: [{ key: 'v', label: 'v' }], rows: [{ v: 'Only' }] };
    return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }, { a: 2 }] };
  },
  resolveDesignTables: async () => new Map([['t', { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }]]),
  renderReportDesignPdf: async (_design: unknown, _resolved: unknown, opts: { identity?: unknown; values?: Record<string, unknown> }) => {
    lastRenderOptions = opts;
    return Buffer.from('%PDF-1.4 fake');
  },
};

describe('reporting data-driven branch', () => {
  const reporting = buildReportingForTest(deps as any);

  it('listAll includes the published report record', async () => {
    expect((await reporting.listAll()).some((s) => s.id === 'r1' && s.source === 'design')).toBe(true);
  });
  it('findSummary resolves a report record', async () => {
    expect((await reporting.findSummary('r1'))?.name).toBe('AMR');
  });
  it('run executes the primary query and attaches the chart', async () => {
    const r = await reporting.run('r1', { facility: 'Ndola' });
    expect(r.rows).toHaveLength(2);
    expect(r.chart).toEqual({ type: 'bar', x: 'a', y: 'b' });
  });
  it('run applies the design default for an omitted optional param instead of throwing', async () => {
    const r = await reporting.run('r1', {});
    expect(r.rows).toHaveLength(2);
    expect(lastRunStoredQueryValues).toEqual({ facility: '' });
  });
  it('renderPdf resolves tables and returns a PDF buffer', async () => {
    expect((await reporting.renderPdf('r1', { facility: 'Ndola' })).toString()).toContain('%PDF');
  });
  it('renderPdf forwards the resolved run parameters through to renderReportDesignPdf as `values`', async () => {
    // Pins packages/bootstrap/src/index.ts:242 — `deps.renderReportDesignPdf(design, resolved,
    // { identity, values })`. `values` is the design defaults merged with the caller's params, so
    // an override must survive the merge, not just equal what was passed in.
    await reporting.renderPdf('r1', { facility: 'Ndola' });
    expect(lastRenderOptions?.values).toEqual({ facility: 'Ndola' });
  });
  it('options resolves select dropdowns from paramOptions queries', async () => {
    expect(await reporting.options('r1')).toEqual({
      facility: [{ value: 'Ndola', label: 'Ndola' }, { value: 'Lusaka', label: 'Lusaka' }],
    });
  });
  it('maps column 0 to the value and column 1 to the label', async () => {
    // The facility filter must carry the CODE while showing the NAME: five DISA codes share the
    // display "Aga Khan", so a name-valued select would silently merge five laboratories.
    const opts = await reporting.options('r-with-facility');
    expect(opts.facility).toEqual([
      { value: 'BAGAE', label: 'National Public Health Laboratory' },
      { value: 'BAMAA', label: 'Aga Khan' },
    ]);
  });
  it('falls back to label = value when the options query returns ONE column', async () => {
    // Keeps the widening additive — a single-column options query is still valid.
    const opts = await reporting.options('r-with-single-column-options');
    expect(opts.facility).toEqual([{ value: 'Only', label: 'Only' }]);
  });
});
