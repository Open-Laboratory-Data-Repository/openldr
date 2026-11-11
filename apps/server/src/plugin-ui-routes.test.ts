import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerPluginUiRoutes } from './plugin-ui-routes';

const DECLARATIVE_SCHEMA = { type: 'object', properties: { url: { type: 'string' } } };

function fakeCtx(over: Partial<any> = {}) {
  return {
    cfg: { PLUGIN_UI_ENABLED: true },
    appSettings: { get: async () => null, getAll: async () => [], set: async () => {} },
    plugins: {
      list: async () => [
        { id: 'ui-demo', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'x', nav: { label: 'Demo', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' } } } },
        { id: 'cfg-plugin', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { nav: { label: 'Cfg', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', declarative: DECLARATIVE_SCHEMA } } } },
        { id: 'whonet', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin' } } },
        { id: 'dhis2-sink', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'y', nav: { label: 'DHIS2', icon: 'share-2', section: 'apps' }, uiSdkVersion: '1', requiredRoles: ['lab_admin'] } } } },
      ],
      loadUi: async (id: string) => (id === 'ui-demo' || id === 'dhis2-sink' ? new TextEncoder().encode('<div>panel</div>') : undefined),
    },
    pluginBroker: { handle: async (_id: string, _p: unknown, op: any) => ({ ok: true, data: { echoedOp: op.kind } }) },
    ...over,
  } as any;
}

function build(ctx: any, roles: string[] = ['lab_admin']): FastifyInstance {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u1', username: 'admin', displayName: null, roles }; });
  registerPluginUiRoutes(app, ctx);
  return app;
}

describe('plugin-ui routes', () => {
  let app: FastifyInstance;
  beforeEach(() => { app = build(fakeCtx()); });

  it('GET /api/plugins/ui lists only ui-contributing plugins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/ui' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // lab_admin sees all ui plugins including the lab_admin-gated dhis2-sink.
    expect(body.map((p: any) => p.id)).toEqual(['ui-demo', 'cfg-plugin', 'dhis2-sink']);
    expect(body[0].nav).toEqual({ label: 'Demo', icon: 'puzzle', section: 'apps' });
    expect(body[0].hasWebview).toBe(true);
    expect(body[0].hasDeclarative).toBe(false);
    expect(body[0].declarative).toBeNull();
  });

  it('GET /api/plugins/ui includes declarative-only plugin with tier flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/ui' });
    const body = res.json();
    const cfg = body.find((p: any) => p.id === 'cfg-plugin');
    expect(cfg).toBeDefined();
    expect(cfg.hasWebview).toBe(false);
    expect(cfg.hasDeclarative).toBe(true);
    expect(cfg.declarative).toEqual(DECLARATIVE_SCHEMA);
  });

  it('GET asset 404s for a declarative-only plugin (no ui.html stored)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/cfg-plugin/ui/asset' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/plugins/ui returns [] when the master switch is off', async () => {
    const off = build(fakeCtx({ cfg: { PLUGIN_UI_ENABLED: false } }));
    const res = await off.inject({ method: 'GET', url: '/api/plugins/ui' });
    expect(res.json()).toEqual([]);
  });

  it('GET /api/plugins/:id/ui/asset serves the stored html', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/ui-demo/ui/asset' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.body).toBe('<div>panel</div>');
  });

  it('GET asset 404s for a plugin without ui', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/whonet/ui/asset' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/plugins/:id/broker forwards to the broker', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/ui-demo/broker', payload: { op: { kind: 'reports.list' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, data: { echoedOp: 'reports.list' } });
  });

  it('POST broker 400s when op is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/plugins/ui-demo/broker', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // ── SEC-03: required-roles filtering on discovery + asset ──
  it('GET /api/plugins/ui EXCLUDES a requiredRoles plugin for a non-admin caller', async () => {
    const lowPriv = build(fakeCtx(), ['lab_technician']);
    const res = await lowPriv.inject({ method: 'GET', url: '/api/plugins/ui' });
    const ids = res.json().map((p: any) => p.id);
    expect(ids).not.toContain('dhis2-sink');
    expect(ids).toContain('ui-demo');
  });

  it('GET /api/plugins/ui INCLUDES a requiredRoles plugin for an admin caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/ui' });
    expect(res.json().map((p: any) => p.id)).toContain('dhis2-sink');
  });

  it('GET asset 404s for a non-admin on a requiredRoles plugin', async () => {
    const lowPriv = build(fakeCtx(), ['lab_technician']);
    const res = await lowPriv.inject({ method: 'GET', url: '/api/plugins/dhis2-sink/ui/asset' });
    expect(res.statusCode).toBe(404);
  });

  it('GET asset serves the html for an admin on a requiredRoles plugin', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins/dhis2-sink/ui/asset' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<div>panel</div>');
  });
});

describe('plugin-ui routes: sites', () => {
  const sited = (over: Record<string, unknown> = {}) => ({
    id: 'sited', version: '1.0.0', enabled: true, active: true,
    manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'z', nav: { label: 'Sited', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', sites: { widget: { title: 'Today' }, panel: { title: 'Notes' } } } } },
    ...over,
  });
  const ctxWith = (rows: unknown[], off: string[] = []) => fakeCtx({
    plugins: { list: async () => rows, loadUi: async () => undefined },
    appSettings: { get: async (k: string) => (k === 'plugins.sitesOff' ? { key: k, value: JSON.stringify(off), updatedAt: new Date(0), updatedBy: null } : null), getAll: async () => [], set: async () => {} },
  });
  const list = async (ctx: any, roles?: string[]) => (await build(ctx, roles).inject({ method: 'GET', url: '/api/plugins/ui' })).json();

  it('lists both declared sites, with the widget height filled in', async () => {
    const [p] = await list(ctxWith([sited()]));
    expect(p.sites).toEqual({ widget: { title: 'Today', height: 'medium' }, panel: { title: 'Notes' } });
  });
  it('a site an admin switched off is not listed; the page still is', async () => {
    const [p] = await list(ctxWith([sited()], ['sited:widget']));
    expect(p.id).toBe('sited');
    expect(p.sites).toEqual({ panel: { title: 'Notes' } });
  });
  it('a plugin with no sites gets an empty object', async () => {
    const body = await list(fakeCtx({ appSettings: { get: async () => null, getAll: async () => [], set: async () => {} } }));
    expect(body[0].sites).toEqual({});
  });
  it('a user without the required role gets no entry, so no card and no panel', async () => {
    const gated = sited({ manifest: { payload: { kind: 'plugin', ui: { ...(sited().manifest.payload.ui), requiredRoles: ['lab_admin'] } } } });
    expect(await list(ctxWith([gated]), ['lab_technician'])).toEqual([]);
  });
  it('a disabled plugin gets no entry', async () => {
    expect(await list(ctxWith([sited({ enabled: false })]))).toEqual([]);
  });
  it('two installed versions give one entry, the active one', async () => {
    const body = await list(ctxWith([sited({ version: '2.0.0' }), sited({ version: '1.0.0', active: false })]));
    expect(body.map((p: any) => `${p.id}@${p.version}`)).toEqual(['sited@2.0.0']);
  });
});
