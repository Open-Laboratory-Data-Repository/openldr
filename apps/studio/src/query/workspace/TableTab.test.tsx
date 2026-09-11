// apps/studio/src/query/workspace/TableTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TableTab } from './TableTab';
import { queryApi } from '../api';
import type { TableTab as TableTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  run: vi.fn(),
  datasetRows: vi.fn(),
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
} }));

const tab: TableTabModel = { id: 't1', kind: 'table', connectorId: 'c1', type: 'postgres', schema: 'public', table: 'products', title: 'products', sql: 'select * from "public"."products"', showSql: false };

describe('TableTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reflects a failed browse in the run-status icon', async () => {
    vi.mocked(queryApi.run).mockRejectedValue(new Error('connector not found or disabled'));
    render(<TableTab tab={tab} />);
    // Errors surface via the run-status icon (a red AlertCircle), not inline text — the message
    // itself lives in its tooltip.
    await waitFor(() => {
      const svg = document.querySelector('[role="status"] svg');
      expect(svg?.getAttribute('class') ?? '').toContain('text-destructive');
    });
  });
});

it('pages SQL Server results without inventing a total', async () => {
  vi.mocked(queryApi.run).mockResolvedValueOnce({ columns: [], rows: [], rowCount: 50, ms: 1, hasMore: true })
    .mockResolvedValueOnce({ columns: [], rows: [], rowCount: 1, ms: 1, hasMore: false })
    .mockResolvedValueOnce({ columns: [], rows: [], rowCount: 50, ms: 1, hasMore: true });
  render(<TableTab tab={{ ...tab, type: 'microsoft-sql' }} />);
  expect(await screen.findByText('1–50 (total unknown)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByText('51–51 (total unknown)')).toBeInTheDocument();
  expect(queryApi.run).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 50 }));
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(await screen.findByText('1–50 (total unknown)')).toBeInTheDocument();
  expect(queryApi.run).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
});

it('resets continuation paging when the page size changes', async () => {
  const rows = Array.from({ length: 51 }, (_, id) => ({ id }));
  vi.mocked(queryApi.run).mockImplementation(async ({ limit = 50, offset = 0 }) => ({
    columns: [{ key: 'id', label: 'id' }], rows: rows.slice(offset, offset + limit),
    rowCount: rows.slice(offset, offset + limit).length, ms: 1, hasMore: rows.length > offset + limit,
  }));
  render(<TableTab tab={{ ...tab, type: 'microsoft-sql' }} />);
  await screen.findByText('1–50 (total unknown)');
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByText('51–51 (total unknown)');
  fireEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }));
  fireEvent.click(await screen.findByRole('option', { name: '100' }));
  expect(await screen.findByText('1–51 (total unknown)')).toBeInTheDocument();
  expect(queryApi.run).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, offset: 0 }));
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
});
