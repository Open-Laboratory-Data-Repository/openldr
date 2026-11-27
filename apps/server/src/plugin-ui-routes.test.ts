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

function build(ctx: any, roles: string[] = ['lab_admin'], capabilities: string[] = [], dataScope?: unknown): FastifyInstance {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u1', username: 'admin', displayName: null, roles, capabilities, dataScope }; });
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

  it('GET /api/plugins/ui passes a custom icon through and adds nothing when there is none', async () => {
    const iconPaths = ['M3 15 5.5 5.5h13L21 15v4.5H3Z', 'M3.5 15h17'];
    const ctx = fakeCtx({
      plugins: {
        list: async () => [
          { id: 'analyzer', version: '0.2.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'x', nav: { label: 'Analyzer interface', icon: 'plug', section: 'apps', iconPaths }, uiSdkVersion: '1' } } } },
          { id: 'db', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'y', nav: { label: 'DB', icon: 'database', section: 'apps' }, uiSdkVersion: '1' } } } },
        ],
      },
    });
    const body = (await build(ctx).inject({ method: 'GET', url: '/api/plugins/ui' })).json();
    expect(body[0].nav).toEqual({ label: 'Analyzer interface', icon: 'plug', section: 'apps', iconPaths });
    expect(body[1].nav).toEqual({ label: 'DB', icon: 'database', section: 'apps' });
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

  it('a holder of a listed capability sees and loads a page whose role they lack, and passes their capabilities to the broker (held corrections)', async () => {
    const withCaps = fakeCtx();
    const rows = await withCaps.plugins.list();
    withCaps.plugins.list = async () => rows.map((r: any) => r.id === 'dhis2-sink'
      ? { ...r, manifest: { payload: { ...r.manifest.payload, ui: { ...r.manifest.payload.ui, requiredCapabilities: ['imports.correct_held'] } } } }
      : r);
    let seen: any = null;
    withCaps.pluginBroker = { handle: async (_id: string, p: unknown) => { seen = p; return { ok: true, data: null }; } };
    const corrector = build(withCaps, ['data_corrector'], ['imports.correct_held']);
    expect((await corrector.inject({ method: 'GET', url: '/api/plugins/ui' })).json().map((p: any) => p.id)).toContain('dhis2-sink');
    expect((await corrector.inject({ method: 'GET', url: '/api/plugins/dhis2-sink/ui/asset' })).statusCode).toBe(200);
    await corrector.inject({ method: 'POST', url: '/api/plugins/dhis2-sink/broker', payload: { op: { kind: 'import.check.access' } } });
    expect(seen).toMatchObject({ roles: ['data_corrector'], capabilities: ['imports.correct_held'] });
    const neither = build(withCaps, ['lab_technician'], ['reports.view']);
    expect((await neither.inject({ method: 'GET', url: '/api/plugins/ui' })).json().map((p: any) => p.id)).not.toContain('dhis2-sink');
    expect((await neither.inject({ method: 'GET', url: '/api/plugins/dhis2-sink/ui/asset' })).statusCode).toBe(404);
  });

  it('passes the caller\'s data limit to the broker, and no facilities when there is none (fails closed)', async () => {
    const ctx = fakeCtx();
    let seen: any = null;
    ctx.pluginBroker = { handle: async (_id: string, p: unknown) => { seen = p; return { ok: true, data: null }; } };
    const limit = { limited: true, facilities: ['f1'], districts: [], regions: [] };
    await build(ctx, ['lab_admin'], [], limit).inject({ method: 'POST', url: '/api/plugins/dhis2-sink/broker', payload: { op: { kind: 'reports.list' } } });
    expect(seen.dataScope).toEqual(limit);
    await build(ctx).inject({ method: 'POST', url: '/api/plugins/dhis2-sink/broker', payload: { op: { kind: 'reports.list' } } });
    expect(seen.dataScope).toEqual({ limited: true, facilities: [], districts: [], regions: [] });
  });

  it('lists who may open each page, and an entry with no limits gets empty lists', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/ui' })).json();
    expect(body.find((p: any) => p.id === 'dhis2-sink')).toMatchObject({ requiredRoles: ['lab_admin'], requiredCapabilities: [] });
    expect(body.find((p: any) => p.id === 'ui-demo')).toMatchObject({ requiredRoles: [], requiredCapabilities: [] });
  });

  it('a user without any of the required capabilities gets no entry and a 404 for the page (review focus 5)', async () => {
    const ctx = fakeCtx();
    ctx.plugins.list = async () => [
      { id: 'lab', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'z', nav: { label: 'Lab', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', requiredCapabilities: ['lab.receive', 'lab.worklist.view'] } } } },
    ];
    ctx.plugins.loadUi = async () => new TextEncoder().encode('<div>lab</div>');
    const outsider = build(ctx, ['lab_technician'], ['reports.view']);
    expect((await outsider.inject({ method: 'GET', url: '/api/plugins/ui' })).json()).toEqual([]);
    expect((await outsider.inject({ method: 'GET', url: '/api/plugins/lab/ui/asset' })).statusCode).toBe(404);
    const receiver = build(ctx, ['lab_technician'], ['lab.receive']);
    const listed = (await receiver.inject({ method: 'GET', url: '/api/plugins/ui' })).json();
    expect(listed).toMatchObject([{ id: 'lab', requiredCapabilities: ['lab.receive', 'lab.worklist.view'] }]);
    expect((await receiver.inject({ method: 'GET', url: '/api/plugins/lab/ui/asset' })).statusCode).toBe(200);
  });

  it('the page asset follows the active version, not an older one listed first', async () => {
    const ui = { entry: 'ui.html', sha256: 'z', nav: { label: 'Lab', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' };
    const ctx = fakeCtx();
    ctx.plugins.list = async () => [
      { id: 'lab', version: '0.1.0', enabled: true, active: false, manifest: { payload: { kind: 'plugin', ui } } },
      { id: 'lab', version: '0.2.0', enabled: true, active: true, manifest: { payload: { kind: 'plugin', ui: { ...ui, requiredCapabilities: ['lab.receive'] } } } },
    ];
    ctx.plugins.loadUi = async () => new TextEncoder().encode('<div>lab</div>');
    expect((await build(ctx, ['lab_technician'], []).inject({ method: 'GET', url: '/api/plugins/lab/ui/asset' })).statusCode).toBe(404);
    expect((await build(ctx, ['lab_technician'], ['lab.receive']).inject({ method: 'GET', url: '/api/plugins/lab/ui/asset' })).statusCode).toBe(200);
  });

  it('GET asset 404s for a disabled plugin', async () => {
    const ctx = fakeCtx();
    ctx.plugins.list = async () => [
      { id: 'ui-demo', version: '1.0.0', enabled: false, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'x', nav: { label: 'Demo', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' } } } },
    ];
    expect((await build(ctx).inject({ method: 'GET', url: '/api/plugins/ui-demo/ui/asset' })).statusCode).toBe(404);
    // The same row enabled is served, so the 404 above is the enabled check.
    const on = fakeCtx();
    expect((await build(on).inject({ method: 'GET', url: '/api/plugins/ui-demo/ui/asset' })).statusCode).toBe(200);
  });

  it("lists each plugin's own permission keys, and none for a plugin that declares none", async () => {
    const ctx = fakeCtx();
    ctx.plugins.list = async () => [
      { id: 'lab', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', permissions: [{ key: 'lab.receive' }, { key: 'lab.worklist.view' }], ui: { entry: 'ui.html', sha256: 'z', nav: { label: 'Lab', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' } } } },
      { id: 'ui-demo', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: 'x', nav: { label: 'Demo', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' } } } },
    ];
    const body = (await build(ctx).inject({ method: 'GET', url: '/api/plugins/ui' })).json();
    expect(body.find((p: any) => p.id === 'lab').permissionKeys).toEqual(['lab.receive', 'lab.worklist.view']);
    expect(body.find((p: any) => p.id === 'ui-demo').permissionKeys).toEqual([]);
  });

  it('GET asset 404s for an id that is not installed', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/plugins/ghost/ui/asset' })).statusCode).toBe(404);
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

  describe('the page asset is bound to one version', () => {
    const ui = { entry: 'ui.html', sha256: 'x', nav: { label: 'Analyzer', icon: 'plug', section: 'apps' }, uiSdkVersion: '1' };
    const row = (version: string, active: boolean) => ({ id: 'analyzer', version, enabled: true, active, manifest: { capabilities: [], payload: { kind: 'plugin', ui } } });

    function ctxWith(rows: () => unknown[]) {
      const loaded: Array<[string, string | undefined]> = [];
      const ctx = fakeCtx({ plugins: {
        list: async () => rows(),
        loadUi: async (id: string, version?: string) => { loaded.push([id, version]); return new TextEncoder().encode(`<p>${version}</p>`); },
      } });
      return { ctx, loaded };
    }

    it('serves the page of the version the studio asked for, loaded by that version', async () => {
      const { ctx, loaded } = ctxWith(() => [row('1.0.0', false), row('2.0.0', true)]);
      const res = await build(ctx).inject({ method: 'GET', url: '/api/plugins/analyzer/ui/asset?version=2.0.0' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('<p>2.0.0</p>');
      expect(loaded).toEqual([['analyzer', '2.0.0']]);
    });

    it('refuses when another version became active after the studio read the list', async () => {
      // The studio's list said 1.0.0. Since then 2.0.0 was made active.
      const { ctx, loaded } = ctxWith(() => [row('1.0.0', false), row('2.0.0', true)]);
      const res = await build(ctx).inject({ method: 'GET', url: '/api/plugins/analyzer/ui/asset?version=1.0.0' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'plugin version changed' });
      expect(loaded).toEqual([]);
    });

    it('loads the bytes of the row it checked, even if the active version changes in between', async () => {
      // The first read of the list says 1.0.0 is active. Any later read says 2.0.0.
      let reads = 0;
      const { ctx, loaded } = ctxWith(() => (reads++ === 0 ? [row('1.0.0', true), row('2.0.0', false)] : [row('1.0.0', false), row('2.0.0', true)]));
      const res = await build(ctx).inject({ method: 'GET', url: '/api/plugins/analyzer/ui/asset?version=1.0.0' });
      expect(res.statusCode).toBe(200);
      // Never "whatever is active now": the version is named.
      expect(loaded).toEqual([['analyzer', '1.0.0']]);
      expect(res.body).toBe('<p>1.0.0</p>');
    });

    it('with no version asked for, still loads by the version of the row it checked', async () => {
      const { ctx, loaded } = ctxWith(() => [row('1.0.0', false), row('2.0.0', true)]);
      const res = await build(ctx).inject({ method: 'GET', url: '/api/plugins/analyzer/ui/asset' });
      expect(res.statusCode).toBe(200);
      expect(loaded).toEqual([['analyzer', '2.0.0']]);
    });

    it('refuses a version that is not a plain version string', async () => {
      const { ctx, loaded } = ctxWith(() => [row('2.0.0', true)]);
      for (const bad of ['', '../x', 'a'.repeat(200)]) {
        const res = await build(ctx).inject({ method: 'GET', url: `/api/plugins/analyzer/ui/asset?version=${encodeURIComponent(bad)}` });
        expect(res.statusCode, bad).toBe(409);
      }
      expect(loaded).toEqual([]);
    });
  });

  describe('devices.serial', () => {
    const ui = { entry: 'ui.html', sha256: 'x', nav: { label: 'Analyzer', icon: 'plug', section: 'apps' }, uiSdkVersion: '1' };
    const row = (over: Record<string, unknown>) => ({ id: 'analyzer', version: '1.0.0', enabled: true, manifest: { payload: { kind: 'plugin', ui } }, ...over });
    const list = async (rows: unknown[]) => (await build(fakeCtx({ plugins: { list: async () => rows } })).inject({ method: 'GET', url: '/api/plugins/ui' })).json();

    it('says serial is true for a plugin granted host:serial', async () => {
      const body = await list([row({ manifest: { capabilities: [{ kind: 'host:db' }, { kind: 'host:serial' }], payload: { kind: 'plugin', ui } } })]);
      expect(body[0].devices).toEqual({ serial: true });
    });

    it('says serial is false for a plugin without it', async () => {
      const body = await list([row({ manifest: { capabilities: [{ kind: 'host:db' }], payload: { kind: 'plugin', ui } } })]);
      expect(body[0].devices).toEqual({ serial: false });
    });

    it('reads the active version, not an older one that had the grant', async () => {
      const body = await list([
        row({ version: '1.0.0', active: false, manifest: { capabilities: [{ kind: 'host:serial' }], payload: { kind: 'plugin', ui } } }),
        row({ version: '2.0.0', active: true, manifest: { capabilities: [], payload: { kind: 'plugin', ui } } }),
      ]);
      expect(body).toHaveLength(1);
      expect(body[0].version).toBe('2.0.0');
      expect(body[0].devices).toEqual({ serial: false });
    });

    it('says serial is false for a legacy plugin with no capabilities list', async () => {
      const body = await list([row({})]);
      expect(body[0].devices).toEqual({ serial: false });
    });

    it('says serial is false, and still lists the plugin, when its capabilities cannot be read', async () => {
      const body = await list([row({ manifest: { capabilities: 'host:serial', payload: { kind: 'plugin', ui } } })]);
      expect(body).toHaveLength(1);
      expect(body[0].devices).toEqual({ serial: false });
    });
  });
});
