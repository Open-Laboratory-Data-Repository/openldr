import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import '@/i18n';
import { PluginPanelHost } from './PluginPanelHost';
import { openPluginPanel, closePluginPanel, getPluginPanel } from './pluginPanel';

let mockUser: { id: string } | null = { id: 'u1' };
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));

// Counts mounts, so a reload of the plugin frame on a page change would show as a second mount.
const mounts = vi.hoisted(() => ({ n: 0 }));
vi.mock('./PluginFrame', async () => {
  const { useEffect } = await import('react');
  return {
    pluginFrameContext: (pluginId: string, site: string) => ({ pluginId, site }),
    PluginFrame: ({ pluginId, context }: { pluginId: string; context: { site?: string } }) => {
      useEffect(() => { mounts.n += 1; }, []);
      return <div data-testid="panel-frame" data-site={context.site}>{pluginId}</div>;
    },
  };
});

function app() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <PluginPanelHost />
      <Routes>
        <Route path="/" element={<Link to="/reports">to reports</Link>} />
        <Route path="/reports" element={<div>reports page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PluginPanelHost', () => {
  beforeEach(() => { mockUser = { id: 'u1' }; mounts.n = 0; closePluginPanel(); });

  it('renders nothing while no panel is open', () => {
    render(app());
    expect(screen.queryByTestId('panel-frame')).toBeNull();
  });

  it('opening draws the plugin frame with site panel and the panel title', () => {
    render(app());
    act(() => openPluginPanel('notes', 'Lab notes'));
    expect(screen.getByTestId('panel-frame')).toHaveAttribute('data-site', 'panel');
    expect(screen.getByText('Lab notes')).toBeInTheDocument();
  });

  it('stays open, without reloading the frame, when the user changes page', () => {
    render(app());
    act(() => openPluginPanel('notes', 'Lab notes'));
    const frame = screen.getByTestId('panel-frame');
    fireEvent.click(screen.getByText('to reports'));
    expect(screen.getByText('reports page')).toBeInTheDocument();
    expect(screen.getByTestId('panel-frame')).toBe(frame);
    expect(mounts.n).toBe(1);
  });

  it('the close button closes it', () => {
    render(app());
    act(() => openPluginPanel('notes', 'Lab notes'));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(getPluginPanel()).toBeNull();
    expect(screen.queryByTestId('panel-frame')).toBeNull();
  });

  it('closes on sign-out', () => {
    const view = render(app());
    act(() => openPluginPanel('notes', 'Lab notes'));
    mockUser = null;
    view.rerender(app());
    expect(getPluginPanel()).toBeNull();
  });
});
