import { describe, it, expect } from 'vitest';
import { buildReportingForTest } from './index';
import { SEED_REPORT_DEFS } from '@openldr/reporting';

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
// A report whose select param has NO configured options query — the display-label substitution
// (item 2) must be a no-op here, so `values` still forwards exactly what the caller/defaults
// produced.
const defNoOptions = { id: 'r-no-options', name: 'AMR', description: '', category: 'amr', designId: 'd1',
  primaryQueryId: 'q1', summaryMetrics: null, chart: { type: 'bar', x: 'a', y: 'b' },
  paramOptions: null, status: 'published' } as any;

let lastRunStoredQueryValues: Record<string, unknown> | undefined;
// Captures the third argument `renderReportDesignPdf` was actually called with, so the bootstrap
// wiring line (`packages/bootstrap/src/index.ts:242`, `{ identity, values }`) has a test pinning it
// — an opaque mock that ignores its arguments would keep passing if that line reverted to dropping
// `values` (or `identity`) entirely.
let lastRenderOptions: { identity?: unknown; values?: Record<string, unknown>; lang?: string } | undefined;
// Captures the `values` argument resolveDesignTables was actually called with — the trap in item
// 2 is that the scope panel's display substitution ("Name (CODE)") must NEVER leak into the value
// the design's bound queries filter on, or the report silently renders empty.
let lastResolveDesignTablesValues: Record<string, unknown> | undefined;
const deps = {
  reportDefs: {
    list: async () => [def],
    get: async (id: string) => {
      if (id === 'r1') return def;
      if (id === 'r-with-facility') return defWithFacility;
      if (id === 'r-with-single-column-options') return defWithSingleColumnOptions;
      if (id === 'r-no-options') return defNoOptions;
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
  resolveDesignTables: async (_design: unknown, values: Record<string, unknown>) => {
    lastResolveDesignTablesValues = values;
    return new Map([['t', { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }]]);
  },
  renderReportDesignPdf: async (_design: unknown, _resolved: unknown, opts: { identity?: unknown; values?: Record<string, unknown>; lang?: string }) => {
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
    // Pins packages/bootstrap/src/index.ts's `deps.renderReportDesignPdf(design, resolved,
    // { identity, values })`. `values` is the design defaults merged with the caller's params, so
    // an override must survive the merge, not just equal what was passed in. Uses a report whose
    // select param has NO configured options query, so the item-2 display substitution below is a
    // no-op and this keeps testing exactly the merge behavior it always tested.
    await reporting.renderPdf('r-no-options', { facility: 'Ndola' });
    expect(lastRenderOptions?.values).toEqual({ facility: 'Ndola' });
  });
  it('renderPdf shows "Name (CODE)" in the scope panel but keeps resolveDesignTables on the RAW code', async () => {
    // ⛔ THE TRAP: resolveDesignTables must see the RAW code — the design's bound queries filter
    // on it (e.g. `dr.performer = {{param.facility}}`). If the resolved display label ever
    // reached that call instead, the filter would match nothing and the report would silently
    // render empty. The scope panel's `values` gets a SEPARATE display copy, built only after
    // resolveDesignTables has already run on the raw values.
    await reporting.renderPdf('r-with-facility', { facility: 'BAGAE' });
    expect(lastResolveDesignTablesValues).toEqual({ facility: 'BAGAE' });
    expect(lastRenderOptions?.values).toEqual({ facility: 'National Public Health Laboratory (BAGAE)' });
  });
  it('renderPdf forwards `lang` as the print language and keeps it OUT of the query values', async () => {
    // `lang` is reserved, not a report parameter: it must reach the renderer and must never reach
    // a stored query, where it would be an unrecognised filter value.
    await reporting.renderPdf('r-no-options', { facility: 'Ndola', lang: 'fr' });
    expect(lastRenderOptions?.lang).toBe('fr');
    expect(lastRenderOptions?.values).toEqual({ facility: 'Ndola' });
    expect(lastResolveDesignTablesValues).toEqual({ facility: 'Ndola' });
  });
  it('renderPdf without `lang` asks for no language, so the authored text prints', async () => {
    await reporting.renderPdf('r-no-options', { facility: 'Ndola' });
    expect(lastRenderOptions?.lang).toBeUndefined();
  });
  it('a design that DECLARES a `lang` parameter keeps it as a parameter, and asks for no language', async () => {
    // The collision: eating a declared `lang` would strip the query's filter and render the report
    // over everything. The parameter wins; such a design just cannot be translated per run.
    const langDesign = { ...design, id: 'd-lang',
      parameters: [{ key: 'lang', label: 'Language', type: 'text', value: '' }] };
    const langDef = { ...defNoOptions, id: 'r-lang', designId: 'd-lang' };
    const langDeps = {
      ...deps,
      reportDefs: { list: async () => [langDef], get: async (id: string) => (id === 'r-lang' ? langDef : undefined) },
      reportDesigns: { get: async (id: string) => (id === 'd-lang' ? langDesign : undefined) },
    };
    const r = buildReportingForTest(langDeps as any);
    await r.renderPdf('r-lang', { lang: 'sw-code' });
    expect(lastRenderOptions?.lang).toBeUndefined();
    expect(lastRenderOptions?.values).toEqual({ lang: 'sw-code' });
    expect(lastResolveDesignTablesValues).toEqual({ lang: 'sw-code' });
  });
  it('falls back to printing the raw code when it has no matching option (a facility that has since disappeared)', async () => {
    await reporting.renderPdf('r-with-facility', { facility: 'GONE-CODE' });
    expect(lastRenderOptions?.values).toEqual({ facility: 'GONE-CODE' });
  });
  it('does not query options for an untouched (empty) select parameter', async () => {
    let optionsQueried = false;
    const spyDeps = {
      ...deps,
      runStoredQuery: async (queryId: string, values: Record<string, unknown>) => {
        if (queryId === 'q-fac-2col') optionsQueried = true;
        return deps.runStoredQuery(queryId, values);
      },
    };
    const spyReporting = buildReportingForTest(spyDeps as any);
    await spyReporting.renderPdf('r-with-facility', { facility: '' });
    expect(optionsQueried).toBe(false);
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

/**
 * ⛔ The transmission grid must not publish a row count as a headline statistic.
 *
 * `runDataDriven` does `def.chart ?? { type: 'stat', value: String(rows.length), label: 'rows' }`
 * (packages/bootstrap/src/index.ts:236). `??` falls through on `null`, and the grid's result
 * carries a SYNTHETIC first row holding the column dates — so a null `chart` published one more
 * than the number of laboratories, on every run, on GET /api/reports/r-transmission-grid and its
 * `.csv`. The seed record's `summaryMetrics: null` covers the metrics strip only; `chart` was a
 * second surface with the same off-by-one.
 *
 * Bound to the REAL seeded record, not a fixture copy: a future edit that sets `chart: null` again
 * must fail here.
 */
describe('r-transmission-grid declares its chart, so the row-count fallback never runs', () => {
  const def = SEED_REPORT_DEFS.find((d) => d.id === 'r-transmission-grid')!;
  const design = { id: def.designId, name: 'G', paper: 'A4', orientation: 'landscape', parameters: [], pages: [] } as any;
  // Two laboratories plus the synthetic '(dates)' row — the exact shape that produced the miscount.
  const rows = [
    { ord: 0, lab: '(dates)', d01: '2\nMar' },
    { ord: 1, lab: 'Lab A', d01: 'Y' },
    { ord: 1, lab: 'Lab B', d01: '' },
  ];
  const gridReporting = buildReportingForTest({
    reportDefs: { list: async () => [def], get: async () => def },
    reportDesigns: { get: async () => design },
    runStoredQuery: async () => ({ columns: [{ key: 'lab', label: 'lab' }], rows }),
    resolveDesignTables: async () => new Map(),
    renderReportDesignPdf: async () => Buffer.from('%PDF'),
  } as any);

  it('publishes the declared chart, not a count of the returned rows', async () => {
    const r = await gridReporting.run('r-transmission-grid', { month: '2026-03', panels: 'X', tz: 'UTC' });
    expect(r.chart).toEqual(def.chart);
    expect(r.chart).not.toBeNull();
  });

  it('does not publish "3 rows" for a two-laboratory month', async () => {
    // THE assertion. 3 rows are returned; 2 laboratories exist. Neither number may be published
    // as a statistic by the fallback, and the label must not be the fallback's 'rows'.
    const r = await gridReporting.run('r-transmission-grid', { month: '2026-03', panels: 'X', tz: 'UTC' });
    expect(r.chart).not.toEqual({ type: 'stat', value: '3', label: 'rows' });
    expect((r.chart as { label?: string }).label).not.toBe('rows');
    // rowCount is deliberately untouched: it says "rows" and means it. The chart is the surface
    // that read as a laboratory count.
    expect(r.meta.rowCount).toBe(3);
  });
});
