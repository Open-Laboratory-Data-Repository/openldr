import { describe, expect, it, vi } from 'vitest';
import type { CustomQuery, CustomQueryParam } from '@openldr/db';
import { CustomQueryParamSchema, runStoredQuery } from '@openldr/dashboards';
import { ReportDesignSchema, resolveDesignTables } from '@openldr/report-designer';
import { buildReportingForTest } from './index';
import { createReportScheduler } from './report-scheduler';
import { runReportStoredQuery } from './report-query';

const flat = { from: '2026-01-01', to: '2027-01-01' };
const sql = 'select {{param.from}} as start_date, {{param.to}} as end_date';
const range = (id: string, required = true): CustomQueryParam => ({ id, label: id, type: 'daterange', required });
const textDates: CustomQueryParam[] = ['from', 'to'].map((id) => ({ id, label: id, type: 'text', required: true }));

function fixture(params = [range('period')]) {
  const queries: Record<string, CustomQuery> = {
    primary: { id: 'primary', name: 'Primary', connectorId: 'c', sql, params },
    secondary: { id: 'secondary', name: 'Secondary', connectorId: 'c', sql, params: [range('window')] },
    legacy: { id: 'legacy', name: 'Legacy', connectorId: 'c', sql, params: textDates },
  };
  const get = vi.fn(async (id: string) => queries[id] ?? null);
  const runConnectorSql = vi.fn(async (_input: { connectorId: string; sql: string; rowCap?: number }) => ({
    columns: [{ key: 'start_date', label: 'start_date' }], rows: [{ start_date: '2026-01-01' }],
  }));
  const deps = { customQueries: { get }, runConnectorSql };
  const query = (id: string, values: Record<string, unknown>) => runReportStoredQuery(deps, id, values);
  const design = ReportDesignSchema.parse({
    id: 'd', name: 'Dates', parameters: [{ key: 'period', label: 'Period', type: 'daterange', required: true }],
    pages: [{ id: 'p', elements: ['primary', 'secondary', 'legacy'].map((id) => ({
      id, kind: 'table', name: id, rect: { x: 0, y: 0, w: 100, h: 20 },
      dataSource: { kind: 'custom-query', queryId: id },
    })) }],
  });
  const def = { id: 'r', name: 'Dates', description: '', category: 'operations', designId: 'd',
    primaryQueryId: 'primary', status: 'published', summaryMetrics: null, chart: null, paramOptions: null } as const;
  const render = vi.fn(async (..._args: Parameters<typeof import('@openldr/report-designer').renderReportDesignPdf>) => Buffer.from('%PDF'));
  const reporting = buildReportingForTest({
    reportDefs: { get: async () => def, list: async () => [def] },
    reportDesigns: { get: async () => design }, runStoredQuery: query,
    resolveDesignTables, renderReportDesignPdf: render,
  });
  return { query, reporting, render, get, runConnectorSql, deps };
}

describe('report dates at the stored query boundary', () => {
  it('runs a required workbench range using flat report dates without mutating the values', async () => {
    const f = fixture();
    const values = { ...flat, facility: 'F1' };
    expect((await f.reporting.run('r', values)).rows).toHaveLength(1);
    expect(f.runConnectorSql).toHaveBeenCalledWith({
      connectorId: 'c', sql: "select '2026-01-01' as start_date, '2027-01-01' as end_date", rowCap: 1001,
    });
    expect(values).toEqual({ ...flat, facility: 'F1' });
    expect(f.get).toHaveBeenCalledOnce();
  });

  it('binds each PDF query using its own range id and retains legacy text dates', async () => {
    const f = fixture();
    await f.reporting.renderPdf('r', flat);
    expect(f.runConnectorSql).toHaveBeenCalledTimes(3);
    const resolved = f.render.mock.calls[0]?.[1] as Map<string, unknown> | undefined;
    for (const id of ['primary', 'secondary', 'legacy']) expect(resolved?.get(id)).toHaveProperty('rows');
    expect(f.render.mock.calls[0]?.[2]).toMatchObject({ values: flat });
  });

  it('keeps an explicit nested range instead of replacing it with flat dates', async () => {
    const f = fixture();
    const period = { from: '2025-01-01', to: '2025-12-31' };
    await f.query('primary', { ...flat, period });
    expect(f.runConnectorSql.mock.calls[0]?.[0].sql)
      .toBe("select '2025-01-01' as start_date, '2025-12-31' as end_date");
  });

  describe.each(['from', 'to'])('a Date range parameter named %s', (id) => {
    it('accepts the declared id and binds flat report dates', async () => {
      expect(CustomQueryParamSchema.parse(range(id)).id).toBe(id);
      const f = fixture([range(id)]);
      await f.reporting.run('r', flat);
      expect(f.runConnectorSql.mock.calls[0]?.[0].sql)
        .toBe("select '2026-01-01' as start_date, '2027-01-01' as end_date");
    });

    it('keeps explicit nested dates ahead of flat dates', async () => {
      const f = fixture([range(id)]);
      await f.query('primary', { ...flat, [id]: { from: '2025-01-01', to: '2025-12-31' } });
      expect(f.runConnectorSql.mock.calls[0]?.[0].sql)
        .toBe("select '2025-01-01' as start_date, '2025-12-31' as end_date");
    });

    it('retains the chosen side of an optional flat range', async () => {
      const f = fixture([range(id, false)]);
      await f.query('primary', { [id]: flat[id as keyof typeof flat] });
      expect(f.runConnectorSql.mock.calls[0]?.[0].sql).toBe(id === 'from'
        ? "select '2026-01-01' as start_date, '' as end_date"
        : "select '' as start_date, '2027-01-01' as end_date");
    });

    it.each([
      [{ from: 'bad', to: '2026-12-31' }, 'invalid date: bad'],
      [{ from: '2026-01-01' }, `required parameter: ${id}`],
      [{}, `required parameter: ${id}`],
    ])('keeps malformed nested range validation for %j', async (nested, message) => {
      const f = fixture([range(id)]);
      await expect(f.query('primary', { ...flat, [id]: nested })).rejects.toThrow(message);
      expect(f.runConnectorSql).not.toHaveBeenCalled();
    });

    it.each(['bad', 20260101])('rejects invalid flat date %j', async (value) => {
      const f = fixture([range(id)]);
      await expect(f.query('primary', { ...flat, [id]: value })).rejects.toThrow(`invalid date: ${value}`);
      expect(f.runConnectorSql).not.toHaveBeenCalled();
    });
  });

  it.each([
    [{ from: '2026-01-01' }, 'required parameter: period'],
    [{ from: '', to: '2026-12-31' }, 'required parameter: period'],
    [{ from: '01/01/2026', to: '2026-12-31' }, 'invalid date: 01/01/2026'],
    [{ from: 20260101, to: '2026-12-31' }, 'invalid date: 20260101'],
    [{ ...flat, period: { from: 'bad', to: '2026-12-31' } }, 'invalid date: bad'],
    [{ ...flat, period: null }, 'required parameter: period'],
    [{ ...flat, period: '2026-01-01' }, 'required parameter: period'],
  ])('retains validation for %j', async (values, message) => {
    const f = fixture();
    await expect(f.reporting.run('r', values)).rejects.toThrow(message);
    expect(f.runConnectorSql).not.toHaveBeenCalled();
  });

  it('allows an optional one-sided range and an omitted optional range', async () => {
    const f = fixture([range('period', false)]);
    await f.query('primary', { from: flat.from });
    expect(f.runConnectorSql.mock.calls[0]?.[0].sql)
      .toBe("select '2026-01-01' as start_date, '' as end_date");
    await f.query('primary', {});
    expect(f.runConnectorSql.mock.calls[1]?.[0].sql).toBe("select '' as start_date, '' as end_date");
  });

  it('leaves the Query workbench nested contract unchanged', async () => {
    const f = fixture();
    await expect(runStoredQuery(f.deps, 'primary', flat)).rejects.toThrow('required parameter: period');
    await runStoredQuery(f.deps, 'primary', { period: flat });
    expect(f.runConnectorSql).toHaveBeenCalledOnce();
  });

  it.each(['csv', 'xlsx', 'pdf'])('runs scheduled %s exports through the same date binding', async (outputFormat) => {
    const f = fixture();
    const put = vi.fn();
    const recordRun = vi.fn();
    const scheduler = createReportScheduler({
      reporting: f.reporting,
      blob: { put },
      schedules: {
        get: async () => ({ id: 's', reportId: 'r', params: {}, frequency: 'daily', outputFormat, enabled: true }),
        recordRun, markRun: vi.fn(),
      } as any,
      logger: { error: vi.fn() },
    });
    await scheduler.runDue('s');
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', outputFormat, rowCount: 1 }));
    expect(put).toHaveBeenCalledOnce();
    expect(f.runConnectorSql).toHaveBeenCalledTimes(outputFormat === 'pdf' ? 4 : 1);
  });
});
