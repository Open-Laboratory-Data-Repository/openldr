import { describe, it, expect, beforeEach } from 'vitest';
import { buildReportingForTest } from './index';

/**
 * Run-time enforcement of a parameter's declared `format`.
 *
 * ⛔ Enforced HERE, in the shared reporting service, and not in the studio's filter bar. A
 * SCHEDULED run (packages/bootstrap/src/report-scheduler.ts:60,62) and a CLI run
 * (packages/cli/src/report.ts:40,46) both call `reporting.run`/`reporting.renderPdf` and never open
 * the studio. The transmission grid's own `tz` help text says a scheduled run supplies the zone
 * itself, so the headless path is exactly the one that can get it wrong unattended.
 */

const gridPages = [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T',
  rect: { x: 0, y: 0, w: 10, h: 10 }, dataSource: { kind: 'custom-query', queryId: 'q1' } }] }];

// A design that DECLARES formats — the seeded transmission grid's shape.
const declared = { id: 'd-declared', name: 'Grid', paper: 'A4', orientation: 'landscape',
  parameters: [
    { key: 'month', label: 'Month', type: 'text', required: true, value: '', format: 'year-month' },
    { key: 'tz', label: 'Time zone', type: 'text', required: true, value: '', format: 'iana-timezone' },
  ],
  pages: gridPages } as any;

// A design that declares NO format on anything — every design stored before this change. It must
// behave EXACTLY as it did: nothing rejected, the same values forwarded.
const undeclared = { id: 'd-undeclared', name: 'Legacy', paper: 'A4', orientation: 'portrait',
  parameters: [
    { key: 'month', label: 'Month', type: 'text', required: true, value: '' },
    { key: 'tz', label: 'Time zone', type: 'text', required: true, value: '' },
  ],
  pages: gridPages } as any;

const defFor = (designId: string) => ({ id: `r-${designId}`, name: 'Grid', description: '',
  category: 'operations', designId, primaryQueryId: 'q1', summaryMetrics: null,
  chart: { type: 'bar', x: 'a', y: 'b' }, paramOptions: null, status: 'published' }) as any;

let ranWith: Record<string, unknown>[] = [];
const deps = {
  reportDefs: {
    list: async () => [defFor('d-declared'), defFor('d-undeclared')],
    get: async (id: string) => (id === 'r-d-declared' ? defFor('d-declared')
      : id === 'r-d-undeclared' ? defFor('d-undeclared') : undefined),
  },
  reportDesigns: { get: async (id: string) => (id === 'd-declared' ? declared : id === 'd-undeclared' ? undeclared : undefined) },
  runStoredQuery: async (_q: string, values: Record<string, unknown>) => {
    ranWith.push(values);
    return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] };
  },
  resolveDesignTables: async () => new Map([['t', { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }]]),
  renderReportDesignPdf: async () => Buffer.from('%PDF'),
} as any;

const reporting = buildReportingForTest(deps);
const GOOD = { month: '2026-08', tz: 'Africa/Dar_es_Salaam' };

beforeEach(() => { ranWith = []; });

describe('a declared format is enforced on run', () => {
  it('refuses a bare +3 time zone before any SQL is built', async () => {
    // The whole point: `+3` is silent today. Postgres reads it POSIX-style as UTC−3, so an
    // arrival at 03:48Z lands at 00:48 — six hours out, wrong direction, on the wrong day when it
    // is near midnight.
    await expect(reporting.run('r-d-declared', { ...GOOD, tz: '+3' }))
      .rejects.toThrow(/^invalid parameter: tz \(/);
    expect(ranWith).toEqual([]);
  });

  it('refuses a month that is not YYYY-MM before the engine sees it', async () => {
    // Loud today (`invalid input syntax for type date: "1-01"`), but a 500 blaming the server for
    // what is a client mistake.
    await expect(reporting.run('r-d-declared', { ...GOOD, month: '1' }))
      .rejects.toThrow(/^invalid parameter: month \(/);
    expect(ranWith).toEqual([]);
  });

  it('accepts the values the operator should have typed', async () => {
    const res = await reporting.run('r-d-declared', GOOD);
    expect(res.rows).toEqual([{ a: 1 }]);
    expect(ranWith[0]).toMatchObject(GOOD);
  });

  it('accepts UTC', async () => {
    await expect(reporting.run('r-d-declared', { ...GOOD, tz: 'UTC' })).resolves.toBeTruthy();
  });

  it('refuses a typo in a real zone name', async () => {
    await expect(reporting.run('r-d-declared', { ...GOOD, tz: 'Africa/Dar-es-Salaam' }))
      .rejects.toThrow(/^invalid parameter: tz \(/);
  });

  it('lets an EMPTY value through, so the existing required check still owns that error', async () => {
    // An untouched required box must still report `required parameter: tz` — a precise message the
    // route already maps — rather than a vaguer format complaint. That throw comes from
    // `substituteParams` (packages/dashboards/src/custom-query-run.ts:33), which is DOWNSTREAM of
    // the `runStoredQuery` faked here, so what this layer can prove is only that the format check
    // does not intercept: the empty value reaches the query runner untouched.
    // The required throw itself is pinned in packages/bootstrap/src/seed-queries-select-gate.test.ts
    // and packages/reporting/src/seed/transmission-grid-live.test.ts.
    await expect(reporting.run('r-d-declared', { month: '2026-08', tz: '' })).resolves.toBeTruthy();
    expect(ranWith[0]).toMatchObject({ tz: '' });
  });
});

describe('a declared format is enforced on the PDF path too', () => {
  it('refuses +3 from renderPdf, which is what a schedule calls', async () => {
    await expect(reporting.renderPdf('r-d-declared', { ...GOOD, tz: '+3' }))
      .rejects.toThrow(/^invalid parameter: tz \(/);
  });

  it('renders when the zone is a real one', async () => {
    await expect(reporting.renderPdf('r-d-declared', GOOD)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('a design that declares no format is unchanged', () => {
  it('still accepts +3 and forwards it untouched', async () => {
    await expect(reporting.run('r-d-undeclared', { ...GOOD, tz: '+3' })).resolves.toBeTruthy();
    expect(ranWith[0]).toMatchObject({ month: '2026-08', tz: '+3' });
  });

  it('still accepts a month of 1', async () => {
    await expect(reporting.run('r-d-undeclared', { ...GOOD, month: '1' })).resolves.toBeTruthy();
  });

  it('publishes a parameter with exactly the keys it published before', async () => {
    const summary = await reporting.findSummary('r-d-undeclared');
    expect(summary!.parameters[0]).toEqual({ id: 'month', label: 'Month', type: 'text', required: true });
  });
});

describe('the summary carries the new fields to the client', () => {
  it('publishes format and placeholder when the design declares them', async () => {
    const withPlaceholder = { ...declared, id: 'd-declared',
      parameters: [{ key: 'tz', label: 'Time zone', type: 'text', required: true, value: '',
        format: 'iana-timezone', placeholder: 'Africa/Nairobi' }] };
    const local = buildReportingForTest({ ...deps,
      reportDesigns: { get: async () => withPlaceholder } } as any);
    const summary = await local.findSummary('r-d-declared');
    expect(summary!.parameters[0]).toMatchObject({ id: 'tz', format: 'iana-timezone', placeholder: 'Africa/Nairobi' });
  });
});
