import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { useDashboardStore } from './store';

beforeEach(() => useDashboardStore.setState({ current: null, editing: false, dirty: false }));
afterEach(() => vi.restoreAllMocks());

// Radix DropdownMenu opens on pointerDown in jsdom, with a keyboard fallback (matches the
// repo's Connectors/Marketplace test pattern).
function openDashboardMenu() {
  const trigger = screen.getByRole('button', { name: 'Dashboard menu' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('DashboardPage', () => {
  it('loads dashboards and renders the first one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: null, name: 'Overview', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true }]), { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { getByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => expect(getByText('Overview')).toBeTruthy());
  });

  it('does NOT client-seed when the list is empty (server seeds the sample now)', async () => {
    let postAttempted = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, init: any) => {
      if (String(url) === '/api/dashboards' && init?.method === 'POST') { postAttempted = true; return Promise.resolve(new Response('{}', { status: 200 })); }
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const { findByText } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    // Falls through to the graceful empty state (now a friendlier create/import prompt rather
    // than the raw error string), and never POSTs a dashboard.
    expect(await findByText('No dashboards yet.')).toBeTruthy();
    expect(postAttempted).toBe(false);
  });

  it('renders create/import actions in the empty state instead of a dead end', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /New dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import/i })).toBeInTheDocument();
  });

  it('does NOT offer "Delete" outside of edit mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: null, name: 'Overview', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true }]), { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Overview')).toBeTruthy());
    openDashboardMenu();
    await screen.findByText('Edit');
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('offers a destructive "Delete" menu item in edit mode that opens a confirm dialog', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url) === '/api/dashboards') return Promise.resolve(new Response(JSON.stringify([{ id: 'd1', ownerId: null, name: 'Overview', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true }]), { status: 200 }));
      if (String(url).endsWith('/models')) return Promise.resolve(new Response('[]', { status: 200 }));
      if (String(url) === '/api/config') return Promise.resolve(new Response(JSON.stringify({ dashboardSqlEnabled: false }), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Overview')).toBeTruthy());
    useDashboardStore.setState({ editing: true });
    openDashboardMenu();
    const deleteItem = await screen.findByText('Delete');
    expect(deleteItem).toBeInTheDocument();
    fireEvent.click(deleteItem);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this dashboard?')).toBeInTheDocument();
  });
});

const overview = { id: 'd1', ownerId: null, name: 'New dashboard', layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: true };

function serveDashboards(create: (init: RequestInit) => Promise<Response>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, init: any) => {
    if (String(url) === '/api/dashboards' && init?.method === 'POST') return create(init);
    if (String(url) === '/api/dashboards') return Promise.resolve(Response.json([overview]));
    if (String(url).endsWith('/models')) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({ dashboardSqlEnabled: false }));
  });
}

describe('creating another dashboard', () => {
  it.each([false, true])('creates and selects a uniquely named blank dashboard while editing=%s', async (editing) => {
    serveDashboards(async (init) => Response.json(JSON.parse(String(init.body))));
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('New dashboard');
    act(() => useDashboardStore.setState({ editing }));
    openDashboardMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New dashboard' }));
    await waitFor(() => expect(useDashboardStore.getState().current?.name).toBe('New dashboard (2)'));
    expect(useDashboardStore.getState().current?.widgets).toEqual([]);
    expect(useDashboardStore.getState().editing).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('New dashboard (2)');
  });

  it('keeps unsaved edits and disables creation until they are saved', async () => {
    serveDashboards(async () => { throw new Error('Creation must not run'); });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('New dashboard');
    act(() => useDashboardStore.setState({ editing: true, dirty: true }));
    openDashboardMenu();
    const item = await screen.findByRole('menuitem', { name: /New dashboard/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(useDashboardStore.getState().current?.id).toBe('d1');
    expect(useDashboardStore.getState().dirty).toBe(true);
  });

  it('keeps the current dashboard on failure and allows retry', async () => {
    let fail = true;
    serveDashboards(async (init) => fail ? Response.json({ error: 'Offline' }, { status: 503 }) : Response.json(JSON.parse(String(init.body))));
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('New dashboard');
    openDashboardMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New dashboard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not create dashboard/);
    expect(useDashboardStore.getState().current?.id).toBe('d1');
    fail = false;
    openDashboardMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New dashboard' }));
    await waitFor(() => expect(useDashboardStore.getState().current?.name).toBe('New dashboard (2)'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables repeated creation while the request is pending', async () => {
    let finish!: (response: Response) => void;
    let body = '';
    let requests = 0;
    serveDashboards((init) => { requests++; body = String(init.body); return new Promise((resolve) => { finish = resolve; }); });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('New dashboard');
    openDashboardMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New dashboard' }));
    openDashboardMenu();
    const item = await screen.findByRole('menuitem', { name: /Creating dashboard/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(requests).toBe(1);
    finish(Response.json(JSON.parse(body)));
    await waitFor(() => expect(useDashboardStore.getState().current?.name).toBe('New dashboard (2)'));
  });
});

it('retains edits made while dashboard creation is pending', async () => {
  let finish!: (response: Response) => void;
  let body = '';
  serveDashboards((init) => { body = String(init.body); return new Promise((resolve) => { finish = resolve; }); });
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  await screen.findByText('New dashboard');
  act(() => useDashboardStore.setState({ editing: true }));
  openDashboardMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New dashboard' }));
  act(() => useDashboardStore.getState().rename('Edited while waiting'));
  finish(Response.json(JSON.parse(body)));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('New dashboard (2)'));
  expect(useDashboardStore.getState().current?.name).toBe('Edited while waiting');
  expect(useDashboardStore.getState().dirty).toBe(true);
});

it('blocks widget and filter editors while dashboard creation is pending', async () => {
  let finish!: (response: Response) => void;
  let body = '';
  serveDashboards((init) => { body = String(init.body); return new Promise((resolve) => { finish = resolve; }); });
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  await screen.findByText('New dashboard');
  act(() => useDashboardStore.setState({ editing: true }));
  openDashboardMenu();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New dashboard' }));
  openDashboardMenu();
  expect(await screen.findByRole('menuitem', { name: 'Add widget' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('menuitem', { name: 'Edit filters' })).toHaveAttribute('aria-disabled', 'true');
  finish(Response.json(JSON.parse(body)));
  await waitFor(() => expect(useDashboardStore.getState().current?.name).toBe('New dashboard (2)'));
});
