import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import * as api from '@/api';
import { PluginWidgets } from './PluginWidgets';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPluginUis: vi.fn() };
});
vi.mock('./PluginFrame', () => ({
  pluginFrameContext: (pluginId: string, site: string) => ({ pluginId, site }),
  PluginFrame: ({ pluginId, context }: { pluginId: string; context: { site?: string } }) => (
    <div data-testid={`widget-frame-${pluginId}`} data-site={context.site} />
  ),
}));

const entry = (id: string, sites: api.PluginUiEntry['sites']): api.PluginUiEntry => ({
  id, version: '1.0.0', nav: { label: id, icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1',
  hasWebview: true, hasDeclarative: false, declarative: null, sites,
});

describe('PluginWidgets', () => {
  it('draws one card per plugin widget, with site widget and the declared height', async () => {
    vi.mocked(api.listPluginUis).mockResolvedValue([
      entry('today', { widget: { title: 'Today', height: 'small' } }),
      entry('notes', { panel: { title: 'Notes' } }),
      entry('tat', { widget: { title: 'Turnaround', height: 'large' } }),
    ]);
    render(<PluginWidgets />);
    await waitFor(() => expect(screen.getByTestId('widget-frame-today')).toBeInTheDocument());
    expect(screen.getByTestId('widget-frame-today')).toHaveAttribute('data-site', 'widget');
    expect(screen.queryByTestId('widget-frame-notes')).toBeNull();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-widget-today').style.height).toBe('160px');
    expect(screen.getByTestId('plugin-widget-tat').style.height).toBe('360px');
  });

  it('renders nothing when no plugin has a widget, or the list fails', async () => {
    vi.mocked(api.listPluginUis).mockResolvedValue([entry('notes', { panel: { title: 'Notes' } }), entry('old', undefined)]);
    const a = render(<PluginWidgets />);
    await waitFor(() => expect(api.listPluginUis).toHaveBeenCalled());
    expect(a.container.innerHTML).toBe('');
    a.unmount();
    vi.mocked(api.listPluginUis).mockRejectedValue(new Error('500'));
    const b = render(<PluginWidgets />);
    await new Promise((r) => setTimeout(r, 0));
    expect(b.container.innerHTML).toBe('');
  });
});
