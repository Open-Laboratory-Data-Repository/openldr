import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class PluginSitesError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return {
    PluginSitesError,
    readPluginSites: vi.fn(),
    updatePluginSite: vi.fn(),
    recordAuditEvent: vi.fn(),
    ctx: { close: vi.fn(), plugins: { list: vi.fn() }, appSettings: {} },
  };
});

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => mocks.ctx),
  readPluginSites: mocks.readPluginSites,
  updatePluginSite: mocks.updatePluginSite,
  recordAuditEvent: mocks.recordAuditEvent,
  PluginSitesError: mocks.PluginSitesError,
}));

import { runMarketSites } from './market-sites';

describe('openldr market sites', () => {
  let out: { mock: { calls: unknown[][] }; mockRestore(): void };
  let err: { mock: { calls: unknown[][] }; mockRestore(): void };
  beforeEach(() => {
    vi.clearAllMocks();
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => { out.mockRestore(); err.mockRestore(); });

  it('with no site, shows the declared sites and on/off as JSON', async () => {
    mocks.readPluginSites.mockResolvedValue({ declared: { widget: { title: 'Today', height: 'medium' } }, off: ['widget'] });
    expect(await runMarketSites('demo', undefined, undefined, { json: true })).toBe(0);
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toEqual({ id: 'demo', sites: [{ site: 'widget', title: 'Today', on: false }] });
    expect(mocks.ctx.close).toHaveBeenCalled();
  });

  it('shows a plain line per site without --json', async () => {
    mocks.readPluginSites.mockResolvedValue({ declared: { panel: { title: 'Notes' } }, off: [] });
    expect(await runMarketSites('demo', undefined, undefined, { json: false })).toBe(0);
    expect(String(out.mock.calls[0]![0])).toBe('panel\ton\tNotes\n');
  });

  it('switches a site off and audits it as the cli', async () => {
    mocks.updatePluginSite.mockResolvedValue({ declared: { widget: { title: 'Today', height: 'medium' } }, off: ['widget'] });
    expect(await runMarketSites('demo', 'widget', 'off', { json: true })).toBe(0);
    expect(mocks.updatePluginSite).toHaveBeenCalledWith(expect.anything(), 'demo', 'widget', false, expect.any(String));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(mocks.ctx, expect.objectContaining({ actorType: 'cli' }), {
      action: 'plugin.sites.update', entityType: 'plugin', entityId: 'demo', metadata: { site: 'widget', on: false },
    });
  });

  it.each([['widget', 'maybe'], ['widget', undefined], ['toast', 'on']])('rejects site %s state %s without touching anything', async (site, state) => {
    expect(await runMarketSites('demo', site, state, { json: false })).toBe(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/usage: openldr market sites <id> \[widget\|panel\] \[on\|off\]/);
    expect(mocks.updatePluginSite).not.toHaveBeenCalled();
  });

  it('a site the plugin does not declare exits 1 with the reason', async () => {
    mocks.updatePluginSite.mockRejectedValue(new mocks.PluginSitesError('not-declared', 'plugin demo declares no panel'));
    expect(await runMarketSites('demo', 'panel', 'on', { json: false })).toBe(1);
    expect(String(err.mock.calls[0]![0])).toBe('market sites failed: plugin demo declares no panel\n');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
