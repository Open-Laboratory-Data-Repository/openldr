import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listConnectorImportPlugins: vi.fn(), setConnectorImportPlugin: vi.fn() };
});
import * as api from '@/api';
import { ConnectorPluginAccessSheet } from './ConnectorPluginAccessSheet';

const ms = {
  id: 'ms', name: 'V1', pluginId: null, type: 'microsoft-sql',
  kind: 'database', allowedHost: null, enabled: true,
  createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectorPluginAccessSheet', () => {
  it('lists the import plugins for the connector with their current state', async () => {
    (api.listConnectorImportPlugins as any).mockResolvedValue([
      { id: 'openldr-v1-import', version: '0.1.0', allowed: true },
      { id: 'other-import', version: '2.0.0', allowed: false },
    ]);
    render(<ConnectorPluginAccessSheet connector={ms as any} onOpenChange={() => {}} />);
    const on = await screen.findByTestId('plugin-access-openldr-v1-import');
    expect(api.listConnectorImportPlugins).toHaveBeenCalledWith('ms');
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('plugin-access-other-import').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('0.1.0')).toBeTruthy();
  });

  it('saves a change and shows what the server answered', async () => {
    (api.listConnectorImportPlugins as any).mockResolvedValue([{ id: 'openldr-v1-import', version: '0.1.0', allowed: false }]);
    (api.setConnectorImportPlugin as any).mockResolvedValue([{ id: 'openldr-v1-import', version: '0.1.0', allowed: true }]);
    render(<ConnectorPluginAccessSheet connector={ms as any} onOpenChange={() => {}} />);
    const sw = await screen.findByTestId('plugin-access-openldr-v1-import');
    await act(async () => { fireEvent.click(sw); });
    expect(api.setConnectorImportPlugin).toHaveBeenCalledWith('ms', 'openldr-v1-import', true);
    expect(screen.getByTestId('plugin-access-openldr-v1-import').getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the old state and says so when the save fails', async () => {
    (api.listConnectorImportPlugins as any).mockResolvedValue([{ id: 'openldr-v1-import', version: '0.1.0', allowed: false }]);
    (api.setConnectorImportPlugin as any).mockRejectedValue(new Error('set plugin access failed: 400'));
    render(<ConnectorPluginAccessSheet connector={ms as any} onOpenChange={() => {}} />);
    const sw = await screen.findByTestId('plugin-access-openldr-v1-import');
    await act(async () => { fireEvent.click(sw); });
    expect(screen.getByTestId('plugin-access-openldr-v1-import').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('plugin-access-error').textContent).toContain('400');
  });

  it('shows the empty state when no installed plugin imports from this connector type', async () => {
    (api.listConnectorImportPlugins as any).mockResolvedValue([]);
    render(<ConnectorPluginAccessSheet connector={ms as any} onOpenChange={() => {}} />);
    expect((await screen.findByTestId('plugin-access-empty')).textContent).toMatch(/no installed plugin/i);
  });

  it('shows the request error when the list cannot load', async () => {
    (api.listConnectorImportPlugins as any).mockRejectedValue(new Error('list import plugins failed: 500'));
    render(<ConnectorPluginAccessSheet connector={ms as any} onOpenChange={() => {}} />);
    expect((await screen.findByTestId('plugin-access-error')).textContent).toContain('500');
  });

  it('asks for nothing when no connector is chosen', () => {
    render(<ConnectorPluginAccessSheet connector={null} onOpenChange={() => {}} />);
    expect(api.listConnectorImportPlugins).not.toHaveBeenCalled();
  });
});
