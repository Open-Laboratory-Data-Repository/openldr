// apps/studio/src/query/tree/ExplorerTree.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { ExplorerTree, dropMove, groupDropId, groupQueries, queryDragId } from './ExplorerTree';
import { queryApi } from '../api';
import { useQueryStore } from '../store';
import type { CustomQuery } from '../custom-query-types';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  databases: vi.fn(async () => null),
  schemas: vi.fn(async () => ['public']),
  tables: vi.fn(async () => ['products']),
  datasets: vi.fn(async () => [{ id: 'd1', name: 'AMR', rowCount: 2 }]),
  warehouseDatasets: vi.fn(async () => [
    { name: 'zm_request_times', ownerPack: 'reports-zm', group: 'reports-zm', rowCount: 4239703, builtAt: '2026-11-19T11:00:00.000Z', buildMs: 28000, lastError: null, stale: false, connectorId: 'c1' },
    { name: 'zm_broken', ownerPack: 'reports-zm', group: 'reports-zm', rowCount: null, builtAt: null, buildMs: null, lastError: 'relation "nope" does not exist', stale: true, connectorId: 'c1' },
  ]),
  rebuildDataset: vi.fn(async (name: string) => ({ name, ok: true, rows: 7, ms: 12 })),
  removeDataset: vi.fn(async () => ({ ok: true })),
  explorerGroups: vi.fn(async (kind: string) => (kind === 'dataset'
    ? { groups: ['Empty', 'reports-zm'], items: { zm_request_times: 'reports-zm', zm_broken: 'reports-zm' } as Record<string, string | null> }
    : { groups: [], items: {} as Record<string, string | null> })),
  createExplorerGroup: vi.fn(async () => ({ ok: true })),
  renameExplorerGroup: vi.fn(async () => ({ moved: 2 })),
  moveExplorerItem: vi.fn(async () => ({ ok: true })),
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

let caps: string[] | 'all' = 'all';
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ hasCapability: (c: string) => caps === 'all' || caps.includes(c) }),
}));

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
  beforeEach(() => { vi.clearAllMocks(); useQueryStore.getState().reset(); caps = 'all'; });

  // demo.4 item 13: without query.manage the saved list is read-only, so no change menu shows.
  it('shows no rename, move, delete or group menus without query.manage', async () => {
    caps = ['query.run'];
    await openQueries();
    fireEvent.click(screen.getByText('TB'));
    await screen.findByText('TB LAM');
    expect(screen.queryByRole('button', { name: 'Custom query actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for “Q1”' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /actions/i })).toEqual([]);
  });

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

  it('shows databases under a SQL Server connector with no database, and opens a table by its full name', async () => {
    vi.mocked(queryApi.connectors).mockResolvedValueOnce([{ id: 'c2', name: 'OpenLDR v1', type: 'microsoft-sql' }]);
    vi.mocked(queryApi.databases).mockResolvedValueOnce(['OpenLDRData', 'OpenLDRDict']);
    vi.mocked(queryApi.schemas).mockResolvedValueOnce(['dbo']);
    vi.mocked(queryApi.tables).mockResolvedValueOnce(['Requests']);
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Connectors'));
    fireEvent.click(await screen.findByText('OpenLDR v1'));
    fireEvent.click(await screen.findByText('OpenLDRDict'));
    expect(queryApi.schemas).not.toHaveBeenCalledWith('c2');
    fireEvent.click(await screen.findByText('dbo'));
    expect(queryApi.schemas).toHaveBeenCalledWith('c2', 'OpenLDRDict');
    fireEvent.click(await screen.findByText('Requests'));
    expect(queryApi.tables).toHaveBeenCalledWith('c2', 'dbo', 'OpenLDRDict');
    const tab = useQueryStore.getState().tabs[0];
    expect(tab).toMatchObject({ kind: 'table', database: 'OpenLDRDict', sql: 'select * from [OpenLDRDict].[dbo].[Requests]' });
  });

  it('falls back to schemas when the database listing fails', async () => {
    vi.mocked(queryApi.databases).mockRejectedValueOnce(new Error('permission denied'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Connectors'));
    fireEvent.click(await screen.findByText('PG'));
    expect(await screen.findByText('public')).toBeInTheDocument();
    err.mockRestore();
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

describe('pack datasets in the explorer', () => {
  beforeEach(() => { caps = 'all'; useQueryStore.getState().reset(); vi.mocked(queryApi.rebuildDataset).mockClear(); vi.mocked(queryApi.removeDataset).mockClear(); vi.mocked(queryApi.createExplorerGroup).mockClear(); vi.mocked(queryApi.renameExplorerGroup).mockClear(); vi.mocked(queryApi.moveExplorerItem).mockClear(); });

  async function openDatasets() {
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Datasets'));
    // A pack's datasets sit in a group named for the pack, closed until opened.
    fireEvent.click(await screen.findByText('reports-zm'));
    await screen.findByText('zm_request_times');
  }

  it('groups_pack_datasets_under_their_pack_closed_with_a_count', async () => {
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Datasets'));
    const group = (await screen.findByText('reports-zm')).closest('button')!;
    expect(within(group).getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('zm_request_times')).toBeNull();
  });

  it('lists_pack_datasets_after_the_workflow_ones', async () => {
    await openDatasets();
    expect(screen.getByText('AMR')).toBeInTheDocument();
    expect(screen.getByText('zm_broken')).toBeInTheDocument();
  });

  it('opens_a_pack_dataset_as_a_warehouse_table', async () => {
    await openDatasets();
    fireEvent.click(screen.getByText('zm_request_times'));
    expect(useQueryStore.getState().tabs).toEqual([expect.objectContaining({ kind: 'table', connectorId: 'c1', schema: 'dataset', table: 'zm_request_times', sql: 'select * from "dataset"."zm_request_times"' })]);
  });

  it('offers_details_rebuild_and_delete_and_only_details_without_query_manage', async () => {
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for zm_request_times'));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Details', 'Move to group', 'Rebuild', 'Delete dataset']);
  });

  it('offers_only_details_without_query_manage', async () => {
    caps = ['query.run'];
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for zm_request_times'));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Details']);
  });

  it('rebuild_calls_the_server_and_reloads_the_list', async () => {
    await openDatasets();
    vi.mocked(queryApi.warehouseDatasets).mockClear();
    openMenu(screen.getByLabelText('Actions for zm_request_times'));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Rebuild' })); });
    await waitFor(() => expect(queryApi.rebuildDataset).toHaveBeenCalledWith('zm_request_times'));
    await waitFor(() => expect(queryApi.warehouseDatasets).toHaveBeenCalled());
  });

  it('delete_asks_first_then_calls_the_server', async () => {
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for zm_request_times'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete dataset' }));
    expect(queryApi.removeDataset).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Delete dataset' })); });
    await waitFor(() => expect(queryApi.removeDataset).toHaveBeenCalledWith('zm_request_times'));
  });

  it('details_shows_the_owner_the_rows_and_the_last_error', async () => {
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for zm_broken'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('reports-zm')).toBeInTheDocument();
    expect(within(sheet).getByText('Not built yet')).toBeInTheDocument();
    expect(within(sheet).getByText('relation "nope" does not exist')).toBeInTheDocument();
  });

  it('a_dataset_in_no_group_is_listed_below_the_groups_and_an_empty_group_still_shows', async () => {
    vi.mocked(queryApi.warehouseDatasets).mockResolvedValueOnce([
      { name: 'zm_loose', ownerPack: 'reports-zm', group: null, rowCount: 3, builtAt: '2026-11-19T11:00:00.000Z', buildMs: 10, lastError: null, stale: false, connectorId: 'c1' },
    ]);
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Datasets'));
    expect(await screen.findByText('zm_loose')).toBeInTheDocument();
    expect(within(screen.getByText('Empty').closest('button')!).getByText('0')).toBeInTheDocument();
    // The workflow dataset shares the branch, in no group.
    expect(screen.getByText('AMR')).toBeInTheDocument();
  });

  it('moves_a_dataset_to_no_group_from_its_menu', async () => {
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for zm_request_times'));
    const sub = screen.getByRole('menuitem', { name: 'Move to group' });
    fireEvent.pointerMove(sub); fireEvent.keyDown(sub, { key: 'ArrowRight' });
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'No group' })); });
    await waitFor(() => expect(queryApi.moveExplorerItem).toHaveBeenCalledWith('dataset', 'zm_request_times', null));
  });

  it('a_new_group_from_the_menu_moves_the_dataset_into_it', async () => {
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for zm_request_times'));
    const sub = screen.getByRole('menuitem', { name: 'Move to group' });
    fireEvent.pointerMove(sub); fireEvent.keyDown(sub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New group' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Turnaround' } });
    openMenu(screen.getByRole('button', { name: 'Name actions' }));
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' })); });
    await waitFor(() => expect(queryApi.createExplorerGroup).toHaveBeenCalledWith('dataset', 'Turnaround'));
    await waitFor(() => expect(queryApi.moveExplorerItem).toHaveBeenCalledWith('dataset', 'zm_request_times', 'Turnaround'));
  });

  it('renames_a_group_and_deleting_one_keeps_its_datasets', async () => {
    await openDatasets();
    openMenu(screen.getByLabelText('Actions for group “reports-zm”'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Delete group' })); });
    await waitFor(() => expect(queryApi.renameExplorerGroup).toHaveBeenCalledWith('dataset', 'reports-zm', null));
  });

  it('new_group_on_the_datasets_branch_makes_an_empty_group', async () => {
    render(<ExplorerTree />);
    await screen.findByText('Datasets');
    openMenu(screen.getByLabelText('Actions for Datasets'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New group' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Viral load' } });
    openMenu(screen.getByRole('button', { name: 'Name actions' }));
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' })); });
    await waitFor(() => expect(queryApi.createExplorerGroup).toHaveBeenCalledWith('dataset', 'Viral load'));
    expect(queryApi.moveExplorerItem).not.toHaveBeenCalled();
  });

  it('a_workflow_dataset_can_be_moved_to_a_group', async () => {
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Datasets'));
    openMenu(await screen.findByLabelText('Actions for AMR'));
    const sub = screen.getByRole('menuitem', { name: 'Move to group' });
    fireEvent.pointerMove(sub); fireEvent.keyDown(sub, { key: 'ArrowRight' });
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Empty' })); });
    await waitFor(() => expect(queryApi.moveExplorerItem).toHaveBeenCalledWith('dataset', 'wf:AMR', 'Empty'));
  });
});

describe('groups for connectors in the explorer', () => {
  beforeEach(() => { caps = 'all'; useQueryStore.getState().reset(); vi.mocked(queryApi.createExplorerGroup).mockClear(); vi.mocked(queryApi.moveExplorerItem).mockClear(); });

  it('lists_a_connector_under_its_group_and_opens_it_there', async () => {
    vi.mocked(queryApi.explorerGroups).mockImplementation(async (kind: string): Promise<{ groups: string[]; items: Record<string, string | null> }> => (kind === 'connector' ? { groups: ['Country systems'], items: { c1: 'Country systems' } } : { groups: [], items: {} }));
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Connectors'));
    const group = (await screen.findByText('Country systems')).closest('button')!;
    expect(within(group).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('PG')).toBeNull();
    fireEvent.click(group);
    fireEvent.click(await screen.findByText('PG'));
    expect(await screen.findByText('public')).toBeInTheDocument();
  });

  it('new_group_on_the_connectors_branch_and_move_a_connector_out_of_its_group', async () => {
    vi.mocked(queryApi.explorerGroups).mockImplementation(async (kind: string): Promise<{ groups: string[]; items: Record<string, string | null> }> => (kind === 'connector' ? { groups: ['Country systems'], items: { c1: 'Country systems' } } : { groups: [], items: {} }));
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Connectors'));
    openMenu(screen.getByLabelText('Actions for Connectors'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New group' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Labs' } });
    openMenu(screen.getByRole('button', { name: 'Name actions' }));
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' })); });
    await waitFor(() => expect(queryApi.createExplorerGroup).toHaveBeenCalledWith('connector', 'Labs'));
    fireEvent.click(await screen.findByText('Country systems'));
    openMenu(await screen.findByLabelText('Actions for PG'));
    const sub = screen.getByRole('menuitem', { name: 'Move to group' });
    fireEvent.pointerMove(sub); fireEvent.keyDown(sub, { key: 'ArrowRight' });
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: 'No group' })); });
    await waitFor(() => expect(queryApi.moveExplorerItem).toHaveBeenCalledWith('connector', 'c1', null));
  });

  it('shows_no_group_menus_without_query_manage', async () => {
    vi.mocked(queryApi.explorerGroups).mockImplementation(async (kind: string): Promise<{ groups: string[]; items: Record<string, string | null> }> => (kind === 'connector' ? { groups: ['Country systems'], items: { c1: 'Country systems' } } : { groups: [], items: {} }));
    caps = ['query.run'];
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Connectors'));
    await screen.findByText('Country systems');
    expect(screen.queryByLabelText('Actions for Connectors')).toBeNull();
    expect(screen.queryByLabelText('Actions for group “Country systems”')).toBeNull();
  });
});

