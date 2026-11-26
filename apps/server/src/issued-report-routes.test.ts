import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerIssuedReportRoutes } from './issued-report-routes';

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
});
