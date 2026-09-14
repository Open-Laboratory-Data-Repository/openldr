// apps/studio/src/query/workspace/QueryTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ExplorerTree } from '../tree/ExplorerTree';
import { QueryTab } from './QueryTab';
import { queryApi } from '../api';
import { useQueryStore, type QueryTab as QueryTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  run: vi.fn(async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }], rowCount: 1, ms: 3 })),
  paramOptions: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: 'saved-new' })),
  update: vi.fn(async () => ({ ok: true })),
  list: vi.fn(async () => []),
} }));

const tab: QueryTabModel = { id: 't1', kind: 'query', title: 'Query #1', connectorId: 'c1', sql: 'select 1 as n', params: [], dirty: false };

describe('QueryTab', () => {
  beforeEach(() => vi.clearAllMocks());
  it('runs a query with no params and shows results', async () => {
    render(<QueryTab tab={tab} />);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(queryApi.run).toHaveBeenCalled());
    // The results grid is a canvas (glide-data-grid) that no-ops under jsdom, so assert on the
    // pagination summary the run produced (rowCount/ms) rather than a DOM cell.
    expect(await screen.findByText('1 rows · 3ms')).toBeInTheDocument();
  });
});

describe('saving named queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryStore.setState({ tabs: [{ ...tab }], activeId: tab.id });
  });

  function Workspace() {
    const current = useQueryStore((state) => state.tabs[0]) as QueryTabModel;
    return <QueryTab tab={current} />;
  }

  async function action(name: string, trigger = 'Query actions') {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: trigger }));
    await user.click(screen.getByRole('menuitem', { name }));
  }

  it('asks for a name before first save and updates the saved query on subsequent saves', async () => {
    render(<Workspace />);
    await action('Save');
    const sheet = await screen.findByRole('dialog', { name: 'Save query' });
    expect(queryApi.create).not.toHaveBeenCalled();
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: '  Lab totals  ' } });
    await action('Save', 'Name actions');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(queryApi.create).toHaveBeenCalledWith({ name: 'Lab totals', connectorId: 'c1', sql: 'select 1 as n', params: [] });
    expect(useQueryStore.getState().tabs[0]).toMatchObject({ title: 'Lab totals', customQueryId: 'saved-new', dirty: false });
    await action('Save');
    await waitFor(() => expect(queryApi.update).toHaveBeenCalledWith('saved-new', expect.objectContaining({ name: 'Lab totals' })));
    expect(queryApi.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft after a duplicate refusal so another name can be saved', async () => {
    vi.mocked(queryApi.create).mockRejectedValueOnce(new Error('name already exists'));
    render(<Workspace />);
    await action('Save');
    await action('Save', 'Name actions');
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose another name');
    expect(screen.getByLabelText('Name')).toHaveValue('Query #1');
    expect(useQueryStore.getState().tabs[0]).not.toHaveProperty('customQueryId');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Another query' } });
    await action('Save', 'Name actions');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useQueryStore.getState().tabs[0]).toMatchObject({ title: 'Another query', customQueryId: 'saved-new' });
  });

  it('renames an existing query without replacing its id', async () => {
    useQueryStore.setState({ tabs: [{ ...tab, customQueryId: 'bound-to-report' }] });
    render(<Workspace />);
    await action('Rename');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Renamed totals' } });
    await action('Save', 'Name actions');
    await waitFor(() => expect(queryApi.update).toHaveBeenCalledWith('bound-to-report', expect.objectContaining({ name: 'Renamed totals' })));
    expect(queryApi.create).not.toHaveBeenCalled();
    expect(useQueryStore.getState().tabs[0]).toMatchObject({ title: 'Renamed totals', customQueryId: 'bound-to-report' });
  });

  it('refreshes an open Explorer after a saved query is renamed', async () => {
    const saved = { id: 'bound-to-report', name: 'Old name', connectorId: 'c1', sql: 'select 1 as n', params: [] };
    vi.mocked(queryApi.list).mockResolvedValueOnce([saved]).mockResolvedValue([{ ...saved, name: 'Current name' }]);
    useQueryStore.setState({ tabs: [{ ...tab, title: saved.name, customQueryId: saved.id }] });
    render(<><ExplorerTree /><Workspace /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Custom Queries' }));
    await screen.findByRole('button', { name: 'Old name' });
    await action('Rename');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Current name' } });
    await action('Save', 'Name actions');
    expect(await screen.findByRole('button', { name: 'Current name' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Old name' })).not.toBeInTheDocument();
  });

  it('renames without publishing unsaved SQL, connector or parameter edits', async () => {
    useQueryStore.setState({ tabs: [{ ...tab, customQueryId: 'bound-to-report', dirty: true, sql: 'select 99 as n', connectorId: 'unpublished-connector' }] });
    render(<Workspace />);
    await action('Rename');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Name only' } });
    await action('Save', 'Name actions');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(queryApi.update).toHaveBeenCalledWith('bound-to-report', { name: 'Name only' });
    expect(useQueryStore.getState().tabs[0]).toMatchObject({ title: 'Name only', dirty: true, sql: 'select 99 as n', connectorId: 'unpublished-connector' });
  });

  it('does not save an empty name or a cancelled draft', async () => {
    render(<Workspace />);
    await action('Save');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '   ' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name actions' }));
    expect(screen.getByRole('menuitem', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('menuitem', { name: 'Cancel' }));
    expect(queryApi.create).not.toHaveBeenCalled();
    expect(useQueryStore.getState().tabs[0].title).toBe('Query #1');
  });
});

it('uses continuation for a query with no known total', async () => {
  vi.mocked(queryApi.run).mockResolvedValueOnce({ columns: [], rows: [], rowCount: 50, ms: 1, hasMore: true })
    .mockResolvedValueOnce({ columns: [], rows: [], rowCount: 0, ms: 1, hasMore: false });
  render(<QueryTab tab={tab} />);
  fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
  expect(await screen.findByText('1–50 (total unknown)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('0–0 (total unknown)')).toBeInTheDocument();
  expect(queryApi.run).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 50 }));
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
});
