import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@/i18n';
import * as api from '@/api';
import { PluginSitesSheet } from './PluginSitesSheet';
import { onPluginsChanged } from '@/plugins/pluginEvents';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getPluginSites: vi.fn(), setPluginSite: vi.fn() };
});

const both: api.PluginSitesState = { declared: { widget: { title: 'Today', height: 'medium' }, panel: { title: 'Notes' } }, off: [] };

describe('PluginSitesSheet', () => {
  beforeEach(() => { vi.mocked(api.getPluginSites).mockReset(); vi.mocked(api.setPluginSite).mockReset(); });

  it('shows one switch per declared site, on unless switched off', async () => {
    vi.mocked(api.getPluginSites).mockResolvedValue({ declared: { widget: { title: 'Today', height: 'medium' } }, off: ['widget'] });
    render(<PluginSitesSheet plugin={{ id: 'demo', label: 'Demo' }} onOpenChange={() => {}} />);
    const sw = await screen.findByTestId('plugin-site-widget');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('plugin-site-panel')).toBeNull();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(api.getPluginSites).toHaveBeenCalledWith('demo');
  });

  it('flipping a switch saves it and shows the saved state', async () => {
    vi.mocked(api.getPluginSites).mockResolvedValue(both);
    vi.mocked(api.setPluginSite).mockResolvedValue({ ...both, off: ['panel'] });
    render(<PluginSitesSheet plugin={{ id: 'demo', label: 'Demo' }} onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByTestId('plugin-site-panel'));
    await waitFor(() => expect(screen.getByTestId('plugin-site-panel')).toHaveAttribute('aria-checked', 'false'));
    expect(api.setPluginSite).toHaveBeenCalledWith('demo', 'panel', false);
  });

  it('tells the shell the plugins changed after a saved switch, and not after a failed one', async () => {
    const heard = vi.fn();
    const off = onPluginsChanged(heard);
    vi.mocked(api.getPluginSites).mockResolvedValue(both);
    vi.mocked(api.setPluginSite).mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce({ ...both, off: ['panel'] });
    render(<PluginSitesSheet plugin={{ id: 'demo', label: 'Demo' }} onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByTestId('plugin-site-panel'));
    await screen.findByTestId('plugin-sites-error');
    expect(heard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('plugin-site-panel'));
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    off();
  });

  it('a failed save shows the error and leaves the switch as it was', async () => {
    vi.mocked(api.getPluginSites).mockResolvedValue(both);
    vi.mocked(api.setPluginSite).mockRejectedValue(new Error('save plugin site failed (403)'));
    render(<PluginSitesSheet plugin={{ id: 'demo', label: 'Demo' }} onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByTestId('plugin-site-widget'));
    expect(await screen.findByTestId('plugin-sites-error')).toHaveTextContent('403');
    expect(screen.getByTestId('plugin-site-widget')).toHaveAttribute('aria-checked', 'true');
  });

  it('closed when no plugin is given', () => {
    render(<PluginSitesSheet plugin={null} onOpenChange={() => {}} />);
    expect(screen.queryByTestId('plugin-site-widget')).toBeNull();
    expect(api.getPluginSites).not.toHaveBeenCalled();
  });
});
