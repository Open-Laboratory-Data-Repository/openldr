import { describe, it, expect } from 'vitest';
import { COLUMN_PROBE_PARAMS, discoverReportColumns } from './index';

// REGRESSION: column discovery used to probe with `{}`. Every built-in report declares a REQUIRED
// date-range parameter, so the probe threw `required parameter: from` before it could return the
// column list — the DHIS2 mapping screen's "Org-unit column" / "Period column" pickers showed
// "No matches" and no mapping could be authored against any built-in report.
describe('report column discovery', () => {
  it('probes with real params, never an empty object', async () => {
    let seen: Record<string, unknown> | undefined;
    await discoverReportColumns(async (_id, params) => {
      seen = params;
      return { columns: [{ key: 'a', label: 'A' }], rows: [] };
    }, 'r-test-volume');
    expect(seen).toBeDefined();
    expect(Object.keys(seen!).length).toBeGreaterThan(0);
    expect(seen).toMatchObject({ from: expect.any(String), to: expect.any(String) });
  });

  it('succeeds against a report that REQUIRES a date range (the original failure)', async () => {
    const runRequiringFrom = async (_id: string, params: Record<string, unknown>) => {
      if (!params.from) throw new Error('required parameter: from');
      return { columns: [{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }], rows: [] };
    };
    const cols = await discoverReportColumns(runRequiringFrom, 'r-test-volume');
    expect(cols).toEqual([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
  });

  it('supplies both parameter spellings and a window wide enough for historical archives', () => {
    // Lab archives are routinely years old (the DISA corpus here is 2013-2016), so a probe window
    // anchored on "now" would still return no rows for a legitimately historical report.
    expect(COLUMN_PROBE_PARAMS).toMatchObject({
      from: expect.any(String), to: expect.any(String),
      dateFrom: expect.any(String), dateTo: expect.any(String),
    });
    expect(new Date(COLUMN_PROBE_PARAMS.from).getFullYear()).toBeLessThan(1950);
    expect(new Date(COLUMN_PROBE_PARAMS.to).getFullYear()).toBeGreaterThan(2100);
  });

  it('passes a COPY, so a callee mutating params cannot poison later probes', async () => {
    await discoverReportColumns(async (_id, params) => {
      (params as Record<string, unknown>).from = 'MUTATED';
      return { columns: [] };
    }, 'r1');
    expect(COLUMN_PROBE_PARAMS.from).toBe('1900-01-01');
  });
});
