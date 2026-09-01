import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerReportDesignRoutes } from './report-designs-routes';
import './auth-plugin';

function fakeCtx() {
  const data: any[] = [];
  const versions: Array<{ designId: string; version: number; name: string; publishedAt: string; publishedBy: string | null }> = [];
  const auditEvents: any[] = [];
  return {
    reportDesigns: {
      list: async () => data,
      get: async (id: string) => data.find((d) => d.id === id),
      create: async (d: any) => { data.push(d); return d; },
      update: async (id: string, d: any) => { const i = data.findIndex((x) => x.id === id); data[i] = d; return d; },
      remove: async (id: string) => { const i = data.findIndex((x) => x.id === id); if (i >= 0) data.splice(i, 1); },
      // Models the real contract (packages/report-designer/src/store.ts): version numbers ascend
      // per design, and publishing flips status — a fake returning constants would let a broken
      // route pass.
      publish: async (id: string, publishedBy: string | null = null) => {
        const d = data.find((x) => x.id === id);
        if (!d) throw new Error(`report design not found: ${id}`);
        const existing = versions.filter((v) => v.designId === id).map((v) => v.version);
        const version = existing.length ? Math.max(...existing) + 1 : 1;
        versions.push({ designId: id, version, name: d.name, publishedAt: new Date().toISOString(), publishedBy });
        d.status = 'published';
        return d;
      },
      listVersions: async (id: string) =>
        versions.filter((v) => v.designId === id)
          .sort((a, b) => b.version - a.version)
          .map((v) => ({ version: v.version, name: v.name, publishedAt: v.publishedAt, publishedBy: v.publishedBy })),
      upsertPublished: async (d: any, publishedBy: string | null = null) => {
        const i = data.findIndex((x) => x.id === d.id);
        const published = { ...d, status: 'published' };
        if (i >= 0) data[i] = published; else data.push(published);
        const existing = versions.filter((v) => v.designId === d.id).map((v) => v.version);
        const version = existing.length ? Math.max(...existing) + 1 : 1;
        versions.push({ designId: d.id, version, name: d.name, publishedAt: new Date().toISOString(), publishedBy });
        return published;
      },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    // The preview route resolves the letterhead per render; an empty identity is the
    // never-configured install, which is what these table-focused tests mean to exercise.
    labIdentity: { all: async () => ({}), tokens: async () => ({}), set: async () => [] },
    facilityRegistry: {} as never,
    logger: { error() {}, warn() {}, info() {} },
    __auditEvents: auditEvents,
  } as any;
}

const minimal = {
  id: 'rd1', name: 'Design', paper: 'A4', orientation: 'portrait',
  pages: [{ id: 'p1', elements: [] }], parameters: [],
};

const fakeCq = {
  get: async (id: string) =>
    id === 'cq_1' ? { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select 1 as n', params: [] } : undefined,
};
const fakeRun = async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }] });
function fakeDeps(runConnectorSql: any = fakeRun): any {
  return { customQueries: fakeCq, runConnectorSql };
}

function appWith(ctx: any, roles: string[] = ['lab_admin'], deps: any = fakeDeps(), capabilities: string[] = ['reports.edit_templates', 'reports.run', 'reports.view']) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u', username: 'u', displayName: null, roles, capabilities }; });
  registerReportDesignRoutes(app, ctx, deps);
  return app;
}

describe('report-design routes', () => {
  it('creates then lists a design (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    const created = await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/report-designs' });
    expect(list.json().length).toBe(1);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.create')).toBe(true);
  });

  it('gets a design by id (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Design');
  });

  it('rejects an invalid payload with 400', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: { id: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a create from a non-manager role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], fakeDeps(), []);
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    expect(res.statusCode).toBe(403);
  });

  it('404s GET of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('403s a GET list from an actor without reports.view', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], fakeDeps(), []);
    const res = await app.inject({ method: 'GET', url: '/api/report-designs' });
    expect(res.statusCode).toBe(403);
  });

  it('403s a GET-by-id from an actor without reports.view', async () => {
    const ctx = fakeCtx();
    const adminApp = appWith(ctx);
    await adminApp.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const app = appWith(ctx, ['lab_technician'], fakeDeps(), []);
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1' });
    expect(res.statusCode).toBe(403);
  });

  it('404s a PUT of an unknown id', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'PUT', url: '/api/report-designs/nope', payload: minimal });
    expect(res.statusCode).toBe(404);
  });

  it('updates and deletes (admin)', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const upd = await app.inject({ method: 'PUT', url: '/api/report-designs/rd1', payload: { ...minimal, name: 'Renamed' } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().name).toBe('Renamed');
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.update')).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: '/api/report-designs/rd1' });
    expect(del.statusCode).toBe(204);
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.delete')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/report-designs' })).json().length).toBe(0);
  });

  it('renders a design body to a PDF (bound table resolved)', async () => {
    const app = appWith(fakeCtx(), ['data_analyst'], fakeDeps(), ['reports.run']);
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      parameters: [{ key: 'facility', label: 'F', type: 'text', value: 'HQ' }],
      pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('400s an invalid design body', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: { id: 'd' } });
    expect(res.statusCode).toBe(400);
  });

  it('403s a non-manager/non-analyst role', async () => {
    const app = appWith(fakeCtx(), ['lab_technician'], fakeDeps(), []);
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: { id: 'd', name: 'N' } });
    expect(res.statusCode).toBe(403);
  });

  it('renders a per-table error placeholder when a bound query fails (no 500)', async () => {
    const rejectingRun = async () => { throw new Error('boom'); };
    const app = appWith(fakeCtx(), ['lab_admin'], fakeDeps(rejectingRun));
    const design = { id: 'd', name: 'N', pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    // A valid PDF is still produced (the error becomes an in-PDF placeholder).
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('substitutes a design param into the query SQL that reaches the connector', async () => {
    const cqWithParam = {
      get: async (id: string) => id === 'cq_1'
        ? { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select * from t where f = {{param.facility}}', params: [{ id: 'facility', label: 'F', type: 'text', required: true }] }
        : undefined,
    };
    const calls: { connectorId: string; sql: string }[] = [];
    const spyRun = async (input: { connectorId: string; sql: string }) => {
      calls.push(input);
      return { columns: [{ key: 'f', label: 'f' }], rows: [{ f: 'HQ' }] };
    };
    const app = appWith(fakeCtx(), ['lab_admin'], { customQueries: cqWithParam, runConnectorSql: spyRun });
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      parameters: [{ key: 'facility', label: 'F', type: 'text', value: 'HQ' }],
      pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("'HQ'");
  });

  it('flattens a daterange design param into the flat from/to the seeded queries declare', async () => {
    // The seeded queries declare TWO plain required text params (`from`, `to`) and read
    // `values.from`/`values.to` — see the param-shape note in report-seeds.ts. A design declares
    // ONE `daterange` param whose value is `{from,to}`, so without flattening `substituteParams`
    // throws `required parameter: from` before the connector is ever reached.
    const cqWithRange = {
      get: async (id: string) => id === 'cq_1'
        ? { id: 'cq_1', name: 'Q', connectorId: 'c1',
            sql: 'select * from t where d between {{param.from}} and {{param.to}}',
            params: [
              { id: 'from', label: 'From', type: 'text', required: true },
              { id: 'to', label: 'To', type: 'text', required: true },
            ] }
        : undefined,
    };
    const calls: { connectorId: string; sql: string }[] = [];
    const spyRun = async (input: { connectorId: string; sql: string }) => {
      calls.push(input);
      return { columns: [{ key: 'd', label: 'd' }], rows: [{ d: '2026-01-01' }] };
    };
    const app = appWith(fakeCtx(), ['lab_admin'], { customQueries: cqWithRange, runConnectorSql: spyRun });
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true, value: { from: '2020-01-01', to: '2030-01-01' } }],
      pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    // The connector is reached at all only if substitution succeeded.
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain("'2020-01-01'");
    expect(calls[0].sql).toContain("'2030-01-01'");
  });

  it('an explicit param named from wins over a daterange flattening', async () => {
    const cqFrom = {
      get: async (id: string) => id === 'cq_1'
        ? { id: 'cq_1', name: 'Q', connectorId: 'c1', sql: 'select * from t where d = {{param.from}}',
            params: [{ id: 'from', label: 'From', type: 'text', required: true }] }
        : undefined,
    };
    const calls: { sql: string }[] = [];
    const spyRun = async (input: { connectorId: string; sql: string }) => {
      calls.push(input);
      return { columns: [{ key: 'd', label: 'd' }], rows: [] };
    };
    const app = appWith(fakeCtx(), ['lab_admin'], { customQueries: cqFrom, runConnectorSql: spyRun });
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      parameters: [
        { key: 'from', label: 'From', type: 'text', value: '1999-09-09' },
        { key: 'dateRange', label: 'Date range', type: 'daterange', value: { from: '2020-01-01', to: '2030-01-01' } },
      ],
      pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 200, h: 80 }, dataSource: { kind: 'custom-query', queryId: 'cq_1' } }] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(calls[0].sql).toContain("'1999-09-09'");
  });

  it('publishes a design and records an audit event', async () => {
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/rd1/publish' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('published');
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.publish')).toBe(true);
  });

  it('404s publishing a design that does not exist', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/nope/publish' });
    expect(res.statusCode).toBe(404);
  });

  it('lists versions, newest first', async () => {
    const app = appWith(fakeCtx());
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    await app.inject({ method: 'POST', url: '/api/report-designs/rd1/publish' });
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1/versions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].version).toBe(1);
  });

  it('renders a design with no bound tables (static elements) to a PDF', async () => {
    const app = appWith(fakeCtx());
    const design = { id: 'd', name: 'N', paper: 'A4', orientation: 'portrait',
      pages: [{ id: 'p', elements: [
        { id: 'txt', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 200, h: 40 }, text: 'Hello' },
        { id: 'tbl', kind: 'table', name: 'U', rect: { x: 0, y: 50, w: 200, h: 80 } },
      ] }] };
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/preview', payload: design });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  const withImage = (src: string) => ({
    ...minimal,
    pages: [{ id: 'p1', elements: [{ id: 'logo', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 10, h: 10 }, src }] }],
  });

  it('rejects an https image source on create, naming the offending element in the error string', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withImage('https://example.org/l.png') });
    expect(res.statusCode).toBe(400);
    expect(res.json().invalidImages).toEqual([{ elementId: 'logo', reason: 'not-a-data-uri' }]);
    // The studio's error extractor reads only `body.error` — a bare 'invalid image source' string
    // leaves the author guessing which of N images across M pages is at fault, so the element id and
    // reason must be IN the string itself, not just in the structured `invalidImages` array.
    expect(res.json().error).toBe('invalid image source: logo (not-a-data-uri)');
  });

  it('rejects an https image source on update, naming the offending element in the error string', async () => {
    const app = appWith(fakeCtx());
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const res = await app.inject({ method: 'PUT', url: '/api/report-designs/rd1', payload: withImage('https://example.org/l.png') });
    expect(res.statusCode).toBe(400);
    expect(res.json().invalidImages).toEqual([{ elementId: 'logo', reason: 'not-a-data-uri' }]);
    expect(res.json().error).toBe('invalid image source: logo (not-a-data-uri)');
  });

  const withGrid = (over: Record<string, unknown>) => ({
    ...minimal,
    pages: [{ id: 'p1', elements: [{
      id: 'hvleid', kind: 'table', name: 'Grid', rect: { x: 0, y: 0, w: 400, h: 200 },
      dataSource: { kind: 'custom-query', queryId: 'q' }, headerRow: true, ...over,
    }] }],
  });

  it('⛔ refuses headerRow without sortBy, on create and on update', async () => {
    // `headerRow` lifts row 0 of whatever the query returned. Only `sortBy` makes row 0 a KNOWN
    // row — `planPagination` wraps every query in a derived table and MySQL may discard the inner
    // ORDER BY. Without the pair the page prints a laboratory's name as its date header, looking
    // finished and being wrong. Refused at write, where the author can still fix it.
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withGrid({}) });
    expect(res.statusCode).toBe(400);
    expect(res.json().unsortedHeaderRows).toEqual([{ elementId: 'hvleid' }]);
    expect(res.json().error).toBe('a header row needs sortBy: hvleid');

    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const put = await app.inject({ method: 'PUT', url: '/api/report-designs/rd1', payload: withGrid({}) });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toBe('a header row needs sortBy: hvleid');
  });

  it('accepts the pair', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withGrid({ sortBy: 'ord' }) });
    expect(res.statusCode).toBe(201);
  });

  const withCellGrid = (over: Record<string, unknown>) => ({
    ...minimal,
    pages: [{ id: 'p1', elements: [{
      id: 'cg', kind: 'cellgrid', name: 'CG', rect: { x: 0, y: 0, w: 400, h: 200 },
      dataSource: { kind: 'custom-query', queryId: 'q' }, cellColumns: ['d01'], ...over,
    }] }],
  });

  it('⛔ refuses a bound cellgrid without sortBy, though it has no headerRow field to opt in with', async () => {
    // cellgrid always lifts row 0 as a header. Unlike table, there is nothing to opt into. The
    // gate has to catch this unconditionally rather than by checking a flag that does not exist
    // on this element kind.
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withCellGrid({}) });
    expect(res.statusCode).toBe(400);
    expect(res.json().unsortedHeaderRows).toEqual([{ elementId: 'cg' }]);
    expect(res.json().error).toBe('a header row needs sortBy: cg');
  });

  it('accepts a bound cellgrid with sortBy', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withCellGrid({ sortBy: 'ord' }) });
    expect(res.statusCode).toBe(201);
  });

  it('accepts a seeded {{lab.logo}} token — every built-in design ships one', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withImage('{{lab.logo}}') });
    expect(res.statusCode).toBe(201);
  });

  it('accepts a png data URI', async () => {
    const app = appWith(fakeCtx());
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withImage('data:image/png;base64,iVBORw0KGgo=') });
    expect(res.statusCode).toBe(201);
  });

  it('still SERVES a stored design whose image source is invalid', async () => {
    // Guards the constraint that the rule never migrates into the zod schema: a row written before
    // this rule existed must remain readable, or it could never be opened and corrected.
    const ctx = fakeCtx();
    const app = appWith(ctx);
    await ctx.reportDesigns.create(withImage('https://example.org/l.png') as never);
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pages[0].elements[0].src).toBe('https://example.org/l.png');
  });
});
