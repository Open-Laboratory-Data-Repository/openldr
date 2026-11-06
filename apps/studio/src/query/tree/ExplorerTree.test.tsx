// apps/studio/src/query/tree/ExplorerTree.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { ExplorerTree, dropMove, groupDropId, groupQueries, queryDragId } from './ExplorerTree';
import { queryApi } from '../api';
import { useQueryStore } from '../store';
import type { CustomQuery } from '../custom-query-types';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  schemas: vi.fn(async () => ['public']),
  tables: vi.fn(async () => ['products']),
  datasets: vi.fn(async () => [{ id: 'd1', name: 'AMR', rowCount: 2 }]),
  list: vi.fn(async () => [
    { id: 'cq1', name: 'Q1', connectorId: 'c1', sql: '', params: [], groupId: null },
    { id: 'cq2', name: 'TB LAM', connectorId: 'c1', sql: '', params: [], groupId: 'g1' },
  ]),
  groups: vi.fn(async () => [{ id: 'g1', name: 'TB' }, { id: 'g2', name: 'Viral load' }]),
  remove: vi.fn(async () => ({ ok: true })),
  update: vi.fn(async () => ({ ok: true })),
  moveQuery: vi.fn(async () => ({ ok: true })),
  createGroup: vi.fn(async () => ({ id: 'g3' })),
  renameGroup: vi.fn(async () => ({ ok: true })),
  removeGroup: vi.fn(async () => ({ ok: true })),
} }));

// Radix menus open on pointerDown in jsdom, with Enter as the fallback.
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

async function openQueries() {
  render(<ExplorerTree />);
  fireEvent.click(await screen.findByText('Custom Queries'));
  await screen.findByText('Q1');
}

const q = (id: string, groupId: string | null): CustomQuery => ({ id, name: id, connectorId: 'c', sql: '', params: [], groupId });

describe('groupQueries and dropMove', () => {
  it('puts queries under their group, and a query with a missing group under no group', () => {
    const out = groupQueries([q('a', 'g1'), q('b', null), q('c', 'gone')], [{ id: 'g1', name: 'TB' }, { id: 'g2', name: 'VL' }]);
    expect(out.groups.map((g) => [g.group.id, g.queries.map((x) => x.id)])).toEqual([['g1', ['a']], ['g2', []]]);
    expect(out.ungrouped.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('moves a query only when it lands on a different group', () => {
    const qs = [q('a', 'g1'), q('b', null)];
    expect(dropMove(queryDragId('b'), groupDropId('g1'), qs)).toEqual({ queryId: 'b', groupId: 'g1' });
    expect(dropMove(queryDragId('a'), groupDropId(null), qs)).toEqual({ queryId: 'a', groupId: null });
    expect(dropMove(queryDragId('a'), groupDropId('g1'), qs)).toBeNull();
    expect(dropMove(queryDragId('b'), groupDropId(null), qs)).toBeNull();
    expect(dropMove(queryDragId('a'), null, qs)).toBeNull();
    expect(dropMove(queryDragId('a'), 'something-else', qs)).toBeNull();
  });
});

describe('ExplorerTree', () => {
  beforeEach(() => { vi.clearAllMocks(); useQueryStore.getState().reset(); });

  it('Refresh reloads the custom queries and every open connector branch', async () => {
    await openQueries();
    fireEvent.click(screen.getByText('Connectors'));
    fireEvent.click(await screen.findByText('PG'));
    await screen.findByText('public');
    vi.mocked(queryApi.list).mockResolvedValueOnce([
      { id: 'cq1', name: 'Q1', connectorId: 'c1', sql: '', params: [], groupId: null },
      { id: 'cq3', name: 'Added elsewhere', connectorId: 'c1', sql: '', params: [], groupId: null },
    ]);
    vi.mocked(queryApi.schemas).mockResolvedValueOnce(['public', 'audit']);

    act(() => useQueryStore.getState().refreshExplorer());

    expect(await screen.findByText('Added elsewhere')).toBeInTheDocument();
    expect(await screen.findByText('audit')).toBeInTheDocument();
    expect(queryApi.connectors).toHaveBeenCalledTimes(2);
  });

  it('renders the three system branches and lazy-loads a connector', async () => {
    render(<ExplorerTree />);
    await screen.findByText('Connectors');
    expect(screen.getByText('Datasets')).toBeInTheDocument();
    expect(screen.getByText('Custom Queries')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connectors'));
    await screen.findByText('PG');
    fireEvent.click(screen.getByText('PG'));
    await waitFor(() => expect(queryApi.schemas).toHaveBeenCalledWith('c1'));
  });

  it('shows groups with a count, closed, and ungrouped queries below them', async () => {
    await openQueries();
    expect(screen.getByText('TB')).toBeInTheDocument();
    expect(screen.getByText('Viral load')).toBeInTheDocument();
    // TB LAM sits inside the closed TB group, so it is hidden until the group opens.
    expect(screen.queryByText('TB LAM')).toBeNull();
    fireEvent.click(screen.getByText('TB'));
    expect(screen.getByText('TB LAM')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Viral load'));
    expect(screen.getByText('Drag queries here')).toBeInTheDocument();
  });

  it('deletes a custom query from its menu after confirming', async () => {
    await openQueries();
    openMenu(screen.getByRole('button', { name: 'Actions for “Q1”' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete query' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(queryApi.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete query' }));
    await waitFor(() => expect(queryApi.remove).toHaveBeenCalledWith('cq1'));
  });

  it('creates a group from the Custom Queries menu', async () => {
    await openQueries();
    openMenu(screen.getByRole('button', { name: 'Custom query actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New group' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Covid' } });
    openMenu(screen.getByRole('button', { name: 'Name actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(queryApi.createGroup).toHaveBeenCalledWith('Covid'));
  });

  it('renames a query from the sidebar and retitles its open tab', async () => {
    useQueryStore.getState().openQueryTab({ customQueryId: 'cq1', title: 'Q1', connectorId: 'c1', sql: '' });
    await openQueries();
    openMenu(screen.getByRole('button', { name: 'Actions for “Q1”' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Name');
    expect(input).toHaveValue('Q1');
    fireEvent.change(input, { target: { value: 'VL info' } });
    openMenu(screen.getByRole('button', { name: 'Name actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(queryApi.update).toHaveBeenCalledWith('cq1', { name: 'VL info' }));
    await waitFor(() => expect(useQueryStore.getState().tabs[0].title).toBe('VL info'));
  });

  it('deletes a group after confirming, which keeps its queries', async () => {
    await openQueries();
    openMenu(screen.getByRole('button', { name: 'Actions for group “TB”' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete group' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Its queries are not deleted. They move out of the group.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(queryApi.removeGroup).toHaveBeenCalledWith('g1'));
    expect(queryApi.remove).not.toHaveBeenCalled();
  });
});
