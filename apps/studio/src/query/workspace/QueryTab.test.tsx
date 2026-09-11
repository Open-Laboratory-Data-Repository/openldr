// apps/studio/src/query/workspace/QueryTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryTab } from './QueryTab';
import { queryApi } from '../api';
import type { QueryTab as QueryTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  run: vi.fn(async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }], rowCount: 1, ms: 3 })),
  paramOptions: vi.fn(async () => []),
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
