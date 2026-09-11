import { expect, it, vi } from 'vitest';
import { runStoredQuery } from '@openldr/dashboards';
import { resolveDesignTables } from '@openldr/report-designer';
import { buildReportingForTest } from './index';
import { createReportScheduler } from './report-scheduler';

function fixture(count: number, primaryQueryId = 'large') {
  const design = { id: 'd', name: 'Rows', parameters: [], pages: [{ id: 'p', elements: [
    { id: 'small', dataSource: { queryId: 'small' } },
    { id: 'large', dataSource: { queryId: 'large' } },
  ] }] };
  const render = vi.fn(async () => Buffer.from('%PDF'));
  const query = (id: string, values: Record<string, unknown>) => runStoredQuery({
    customQueries: { get: async () => ({ connectorId: 'c', sql: 'select a from rows', params: [] }) as any },
    runConnectorSql: async ({ rowCap }) => ({ columns: [{ key: 'a', label: 'a' }],
      rows: Array.from({ length: Math.min(id === 'large' ? count : 1, rowCap!) }, (_, a) => ({ a })) }),
  }, id, values);
  const reporting = buildReportingForTest({
    reportDefs: { get: async () => ({ id: 'r', designId: 'd', primaryQueryId }) as any, list: async () => [] },
    reportDesigns: { get: async () => design as any }, runStoredQuery: query,
    resolveDesignTables, renderReportDesignPdf: render,
  });
  return { reporting, render, query, design };
}

it('refuses oversized report data instead of returning partial rows', async () => {
  const { reporting } = fixture(1001);
  await expect(reporting.run('r', {})).rejects.toThrow('1000');
});
it('refuses a PDF with an oversized secondary element before rendering', async () => {
  const { reporting, render } = fixture(1001, 'small');
  expect((await reporting.run('r', {})).rows).toHaveLength(1);
  await expect(reporting.renderPdf('r', {})).rejects.toThrow('1000');
  expect(render).not.toHaveBeenCalled();
});
it('keeps exactly 1000 rows available for data and PDF exports', async () => {
  const { reporting, render } = fixture(1000);
  expect((await reporting.run('r', {})).rows).toHaveLength(1000);
  await expect(reporting.renderPdf('r', {})).resolves.toBeInstanceOf(Buffer);
  expect(render).toHaveBeenCalledOnce();
});
it('keeps design preview errors visible per element', async () => {
  const { design, query } = fixture(1001);
  const resolved = await resolveDesignTables(design as any, {}, query);
  expect(resolved.get('large')).toEqual({ error: expect.stringContaining('1000') });
  expect(resolved.get('small')).toHaveProperty('rows');
});


it('stores no scheduled PDF when only a secondary query exceeds the bound', async () => {
  const { reporting, render } = fixture(1001, 'small');
  const put = vi.fn();
  const recordRun = vi.fn();
  const scheduler = createReportScheduler({
    reporting: { ...reporting, findSummary: async () => ({ id: 'r', name: 'Rows', parameters: [] }) } as any,
    blob: { put } as any,
    schedules: {
      get: async () => ({ id: 's', reportId: 'r', params: {}, frequency: 'daily', outputFormat: 'pdf', enabled: true }),
      recordRun, markRun: vi.fn(),
    } as any,
    logger: { error: vi.fn() } as any,
  });
  await scheduler.runDue('s');
  expect(put).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({
    status: 'failed', objectKey: null, errorMessage: expect.stringContaining('1000'),
  }));
});
