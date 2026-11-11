import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { PluginUiEntry } from '@/api';
import { getPluginPanel, openPluginPanel, closePluginPanel } from '@/plugins/pluginPanel';
import { notifyPluginsChanged } from '@/plugins/pluginEvents';

const list = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPluginUis: vi.fn(async () => list.entries) };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u', username: 'admin', displayName: null, roles: ['lab_admin'] },
    loading: false, hasCapability: () => true, signOut: vi.fn(), authEnforced: true,
  }),
}));

import { AppShell } from './AppShell';

const entry = (id: string, sites: PluginUiEntry['sites']): PluginUiEntry => ({
  id, version: '1', nav: { label: id, icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1',
  hasWebview: true, hasDeclarative: false, declarative: null, sites,
});
const shell = () => render(<MemoryRouter><AppShell title="Dashboard"><div>content</div></AppShell></MemoryRouter>);

describe('AppShell side panel menu', () => {
  beforeEach(() => closePluginPanel());

  it('shows no panel button when no plugin offers a panel', async () => {
    list.entries = [entry('today', { widget: { title: 'Today', height: 'small' } }), entry('old', undefined)];
    shell();
    await waitFor(() => expect(screen.getByRole('link', { name: /today/ })).toBeInTheDocument());
    expect(screen.queryByTestId('plugin-panel-menu')).toBeNull();
  });

  it('lists one item per panel plugin, and picking one opens it', async () => {
    list.entries = [entry('notes', { panel: { title: 'Lab notes' } }), entry('chat', { panel: { title: 'Bench chat' } })];
    shell();
    const trigger = await screen.findByTestId('plugin-panel-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await screen.findByText('Lab notes')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Bench chat'));
    expect(getPluginPanel()).toEqual({ id: 'chat', title: 'Bench chat' });
  });

  it('closes an open panel whose plugin no longer offers one when the page loads', async () => {
    openPluginPanel('notes', 'Lab notes');
    list.entries = [entry('other', { panel: { title: 'Other' } })];
    shell();
    await waitFor(() => expect(getPluginPanel()).toBeNull());
  });
});

describe('AppShell with a side panel open', () => {
  beforeEach(() => closePluginPanel());

  it('makes room for the panel on desktop, so it never covers the page or its menus', async () => {
    list.entries = [entry('notes', { panel: { title: 'Lab notes' } })];
    const { container, rerender } = shell();
    const main = container.querySelector('main')!;
    expect(main.className).not.toContain('md:pr-96');
    act(() => openPluginPanel('notes', 'Lab notes'));
    rerender(<MemoryRouter><AppShell title="Dashboard"><div>content</div></AppShell></MemoryRouter>);
    expect(container.querySelector('main')!.className).toContain('md:pr-96');
  });

  it('opening the phone menu closes the panel, which would otherwise cover the drawer', async () => {
    list.entries = [entry('notes', { panel: { title: 'Lab notes' } })];
    shell();
    act(() => openPluginPanel('notes', 'Lab notes'));
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(getPluginPanel()).toBeNull();
  });
});

describe('AppShell after plugins change in Settings', () => {
  beforeEach(() => closePluginPanel());

  // Settings keeps one AppShell across its pages, so it does not remount after a change there.
  it('re-reads the plugin list on a change signal: the sidebar entry goes and the panel closes', async () => {
    list.entries = [entry('notes', { panel: { title: 'Lab notes' } })];
    shell();
    await screen.findByRole('link', { name: /notes/ });
    act(() => openPluginPanel('notes', 'Lab notes'));
    list.entries = [];
    act(() => notifyPluginsChanged());
    await waitFor(() => expect(getPluginPanel()).toBeNull());
    expect(screen.queryByRole('link', { name: /notes/ })).toBeNull();
  });
});
