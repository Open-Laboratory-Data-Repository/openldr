import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createReportStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { registerReportDefRoutes } from './report-defs-routes';
import './auth-plugin';

function fakeCtx() {
  const data: any[] = [];
  const auditEvents: any[] = [];
  return {
    reportDefs: {
      list: async () => data,
      get: async (id: string) => data.find((d) => d.id === id),
      create: async (d: any) => { data.push(d); return d; },
      update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
      remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
  } as any;
}

const minimal = {
  id: 'r1', name: 'AMR', description: '', category: 'amr', designId: 'd1', primaryQueryId: 'q1',
};

function appWith(ctx: any, roles: string[] = ['lab_admin'], capabilities: string[] = ['reports.edit_templates', 'reports.view']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles, capabilities }; });
  registerReportDefRoutes(app, ctx);
  return app;
}

describe('report-defs routes', () => {
  it('POST creates then GET lists (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/report-defs', payload: minimal });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/report-defs' });
    expect(list.json().length).toBe(1);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-def.create')).toBe(true);
  });

  it('gets a report def by id (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-defs', payload: minimal });
    const res = await app.inject({ method: 'GET', url: '/api/report-defs/r1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('AMR');
  });

  it('POST rejects an invalid body with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-defs', payload: { id: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a create from a non-manager role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], []);
    const res = await app.inject({ method: 'POST', url: '/api/report-defs', payload: minimal });
    expect(res.statusCode).toBe(403);
  });

  it('404s GET of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/report-defs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('403s a GET list from an actor without reports.view', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], []);
    const res = await app.inject({ method: 'GET', url: '/api/report-defs' });
    expect(res.statusCode).toBe(403);
  });

  it('403s a GET-by-id from an actor without reports.view', async () => {
    const ctx = fakeCtx();
    const adminApp = appWith(ctx);
    await adminApp.inject({ method: 'POST', url: '/api/report-defs', payload: minimal });
    const app = appWith(ctx, ['lab_technician'], []);
    const res = await app.inject({ method: 'GET', url: '/api/report-defs/r1' });
    expect(res.statusCode).toBe(403);
  });

  it('404s a PUT of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'PUT', url: '/api/report-defs/nope', payload: minimal });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE 404s an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'DELETE', url: '/api/report-defs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('updates and deletes (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-defs', payload: minimal });
    const upd = await app.inject({ method: 'PUT', url: '/api/report-defs/r1', payload: { ...minimal, name: 'Renamed' } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().name).toBe('Renamed');
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-def.update')).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: '/api/report-defs/r1' });
    expect(del.statusCode).toBe(204);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-def.delete')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/report-defs' })).json().length).toBe(0);
  });

  it.each([
    { summaryMetrics: null, chart: null, paramOptions: null },
    {
      summaryMetrics: [{ id: 'total', label: 'Total', type: 'count' }],
      chart: { type: 'bar', x: 'name', y: 'total' },
      paramOptions: { facility: 'q-facilities' },
    },
  ])('round-trips published and draft status with persisted metadata: %j', async (metadata) => {
    const db = await makeMigratedDb();
    const ctx = fakeCtx();
    ctx.reportDefs = createReportStore(db);
    const app = appWith(ctx);
    const original = { ...minimal, ...metadata, status: 'published' };
    try {
      await ctx.reportDefs.create(original);
      const stored = await db.selectFrom('reports').selectAll().where('id', '=', 'r1').executeTakeFirstOrThrow();
      if (metadata.chart === null) {
        expect(stored).toMatchObject({ summary_metrics: null, chart: null, param_options: null });
      }

      for (const status of ['draft', 'published']) {
        const get = await app.inject({ method: 'GET', url: '/api/report-defs/r1' });
        expect(get.statusCode).toBe(200);
        const update = await app.inject({
          method: 'PUT', url: '/api/report-defs/r1', payload: { ...get.json<Record<string, unknown>>(), status },
        });
        expect(update.statusCode).toBe(200);
        expect(update.json()).toEqual({ ...original, status });
        expect(await ctx.reportDefs.get('r1')).toEqual({ ...original, status });
      }
      expect(ctx.__auditEvents.map((event: any) => event.action)).toEqual([
        'report-def.update', 'report-def.update',
      ]);
    } finally {
      await app.close();
      await db.destroy();
    }
  });
});
