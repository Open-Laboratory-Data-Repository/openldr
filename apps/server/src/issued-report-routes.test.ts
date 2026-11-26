import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerIssuedReportRoutes } from './issued-report-routes';
import { recordAudit } from './audit-helper';

vi.mock('./audit-helper', () => ({ recordAudit: vi.fn(async () => undefined) }));

const caps = ['reports.view', 'reports.view_issued', 'patients.view', 'patients.view_identifiers'];
const url = '/api/reports/issued/lab/edition-1';

describe('issued edition lookup', () => {
  it.each([
    { limited: true, capabilities: caps },
    { limited: false, capabilities: ['reports.view'] },
    { limited: false, capabilities: caps.filter((cap) => cap !== 'patients.view_identifiers') },
  ])(
    'withholds even a copied URL for $capabilities, scope limited $limited',
    async ({ limited, capabilities }) => {
      const app = Fastify();
      app.addHook('onRequest', async (req: { user?: unknown }) => {
        req.user = { capabilities, dataScope: { limited } };
      });
      const selectFrom = vi.fn();
      registerIssuedReportRoutes(app, { internalDb: { selectFrom } } as never);
      for (const method of ['GET', 'HEAD'] as const) {
        const res = await app.inject({ method, url });
        expect(res.statusCode).toBe(404);
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      expect(selectFrom).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it('withholds the entire edition if its observation no longer exists in history', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: { user?: unknown }) => {
      req.user = { capabilities: caps, dataScope: { limited: false } };
    });
    const query = {
      where() {
        return this;
      },
      selectAll() {
        return this;
      },
      select() {
        return this;
      },
      async executeTakeFirst() {
        return {
          report_id: 'r',
          versions: [
            { resourceType: 'DiagnosticReport', id: 'r', version: 1 },
            { resourceType: 'Observation', id: 'o', version: 1 },
          ],
        };
      },
      async execute() {
        return [
          {
            resource_type: 'DiagnosticReport',
            id: 'r',
            resource: {
              status: 'final',
              code: { text: 'Test' },
              subject: { reference: 'Patient/p' },
              issued: '2026-11-26',
              result: [{ reference: 'Observation/o' }],
            },
          },
        ];
      },
    };
    const selectFrom = vi.fn(() => query);
    registerIssuedReportRoutes(app, { internalDb: { selectFrom } } as never);
    const res = await app.inject({ url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Edition unavailable' });
    expect(selectFrom.mock.calls.flat()).not.toContain('fhir.fhir_current');
    await app.close();
  });

  // Found 2026-11-26: the plugin asks "can CE show this edition?" with HEAD before it draws a link.
  // Fastify runs the GET handler for HEAD, so every check wrote a "reports.issued.read" row though
  // nobody read the report. Only a GET that returns the report is a read.
  it('records a read for GET and none for the HEAD availability check', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req: { user?: unknown }) => {
      req.user = { capabilities: caps, dataScope: { limited: false } };
    });
    const bodies = [
      {
        resource_type: 'DiagnosticReport', id: 'r',
        resource: {
          status: 'final', code: { text: 'Haemoglobin' }, subject: { reference: 'Patient/p' },
          issued: '2026-11-26', result: [{ reference: 'Observation/o' }],
        },
      },
      {
        resource_type: 'Observation', id: 'o',
        resource: {
          status: 'final', code: { text: 'Hb' }, subject: { reference: 'Patient/p' },
          valueQuantity: { value: 12.4, unit: 'g/dL' },
        },
      },
    ];
    const query = {
      where() { return this; },
      selectAll() { return this; },
      select() { return this; },
      async executeTakeFirst() {
        return {
          report_id: 'r',
          versions: [
            { resourceType: 'DiagnosticReport', id: 'r', version: 1 },
            { resourceType: 'Observation', id: 'o', version: 1 },
          ],
          version: 1,
        };
      },
      async execute() { return bodies; },
    };
    registerIssuedReportRoutes(app, { internalDb: { selectFrom: vi.fn(() => query) } } as never);
    vi.mocked(recordAudit).mockClear();
    const head = await app.inject({ method: 'HEAD', url });
    expect(head.statusCode).toBe(200);
    expect(recordAudit).not.toHaveBeenCalled();
    const get = await app.inject({ method: 'GET', url });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ readings: [{ value: '12.4 g/dL' }] });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAudit).mock.calls[0][2]).toMatchObject({ action: 'reports.issued.read' });
    await app.close();
  });
});
