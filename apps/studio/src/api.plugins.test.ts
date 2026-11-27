import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listPluginUis, pluginBrokerCall, pluginUiAssetUrl } from './api';

describe('plugin-ui api', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('listPluginUis GETs /api/plugins/ui', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [{ id: 'ui-demo', nav: { label: 'Demo' } }] });
    const r = await listPluginUis();
    expect((fetch as any).mock.calls[0][0]).toContain('/api/plugins/ui');
    expect(r[0].id).toBe('ui-demo');
  });

  it('pluginBrokerCall POSTs { op } to the plugin broker and returns the result', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: [{ id: 'r1' }] }) });
    const r = await pluginBrokerCall('ui-demo', { kind: 'reports.list' });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain('/api/plugins/ui-demo/broker');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ op: { kind: 'reports.list' } });
    expect(r).toEqual({ ok: true, data: [{ id: 'r1' }] });
  });

  it('pluginUiAssetUrl builds the asset path', () => {
    expect(pluginUiAssetUrl('ui-demo')).toBe('/api/plugins/ui-demo/ui/asset');
    // With the version the list named, so the server serves that version's page or none.
    expect(pluginUiAssetUrl('ui-demo', '1.2.0')).toBe('/api/plugins/ui-demo/ui/asset?version=1.2.0');
    expect(pluginUiAssetUrl('ui demo', '1.0.0+a b')).toBe('/api/plugins/ui%20demo/ui/asset?version=1.0.0%2Ba%20b');
    expect(pluginUiAssetUrl('ui-demo', '')).toBe('/api/plugins/ui-demo/ui/asset');
  });
});
