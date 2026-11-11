import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext, SetupReport } from '@openldr/bootstrap';
import { registerSetupRoutes } from './setup-routes';

// Layer under test: the route's gate, its answer and its audit row, with the checks faked.
// The checks themselves are tested in packages/bootstrap/src/setup-checks.test.ts.

const report: SetupReport = { ok: false, checks: [
  { id: 'adapters', status: 'pass' },
  { id: 'labName', status: 'warn', hint: 'labNameDefault', fix: '/settings/laboratory' },
  { id: 'connectors', status: 'fail', hint: 'connectorFailed', fix: '/settings/connectors', detail: 'V1 SQL Server' },
] };

function build(capabilities: string[] | null, audited: unknown[] = [], run: () => Promise<SetupReport> = async () => report) {
  const ctx = { audit: { record: async (e: unknown) => { audited.push(e); } }, logger: { error() {}, warn() {} } } as unknown as AppContext;
  const app = Fastify();
  if (capabilities) app.addHook('onRequest', async (req) => { req.user = { id: 'u1', username: 'admin', displayName: null, roles: [], capabilities } as never; });
  registerSetupRoutes(app, ctx, { run });
  return app;
}

describe('POST /api/settings/setup-checks', () => {
  it('needs a signed-in user with settings.view', async () => {
    expect((await build(null).inject({ method: 'POST', url: '/api/settings/setup-checks' })).statusCode).toBe(401);
    expect((await build(['reports.view']).inject({ method: 'POST', url: '/api/settings/setup-checks' })).statusCode).toBe(403);
  });

  it('returns the report and audits the outcome, not the detail', async () => {
    const audited: unknown[] = [];
    const res = await build(['settings.view'], audited).inject({ method: 'POST', url: '/api/settings/setup-checks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(report);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(audited).toEqual([expect.objectContaining({
      actorType: 'user', actorId: 'u1', action: 'setup.check', entityType: 'system', entityId: 'setup',
      metadata: { ok: false, failed: ['connectors'], warned: ['labName'] },
    })]);
    expect(JSON.stringify(audited)).not.toContain('V1 SQL Server');
  });

  it('answers 500 with a plain message when the checks cannot run at all', async () => {
    const res = await build(['settings.view'], [], async () => { throw new Error('db at 10.0.0.5 is gone'); }).inject({ method: 'POST', url: '/api/settings/setup-checks' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'setup checks could not run' });
  });
});
