import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listObservedTestCodes: vi.fn(), getMappingTargets: vi.fn(async () => []), rebuildTestMap: vi.fn(), downloadTestMappingsCsv: vi.fn() };
});

import * as api from '@/api';
import { ObservedCodesTab } from './ObservedCodesTab';

const DISA = 'urn:openldr:disa';
const ROW: api.ObservedTestCode = {
  system: DISA, code: 'HIVVL', description: 'HIV VL', requests: 2, lastSeen: '2026-05-03T08:00:00.000Z',
  status: 'mapped', catalog: { code: 'VL', name: 'HIV viral load', loinc: '25836-8' }, centralManaged: false,
};

beforeEach(() => { vi.mocked(api.listObservedTestCodes).mockReset(); });

describe('ObservedCodesTab', () => {
  it('shows the spinner, then a row with its catalog test and LOINC', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByTestId('observed-row-HIVVL')).toBeTruthy();
    expect(screen.getByText('HIV viral load')).toBeTruthy();
    expect(screen.getByText(/25836-8/)).toBeTruthy();
    expect(vi.mocked(api.listObservedTestCodes)).toHaveBeenCalledWith({ status: 'all', q: undefined, limit: 25, offset: 0 });
  });

  it('shows the striped empty state when there are no codes, and no table', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [], total: 0, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage />);
    expect(await screen.findByText('No lab test codes yet. They appear here once results arrive.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('warns when the warehouse copy is out of date', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: true, error: 'boom' } });
    render(<ObservedCodesTab canManage />);
    expect(await screen.findByTestId('observed-stale')).toBeTruthy();
  });

  it('marks an unmapped row and a central row', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({
      rows: [{ ...ROW, code: 'CD4', status: 'unmapped', catalog: null }, { ...ROW, centralManaged: true }], total: 2, warehouse: { stale: false, error: null },
    });
    render(<ObservedCodesTab canManage />);
    await screen.findByTestId('observed-row-CD4');
    // The status filter button also reads "Unmapped", so look inside the row.
    expect(screen.getByTestId('observed-row-CD4').textContent).toContain('Unmapped');
    expect(screen.getByText('From central')).toBeTruthy();
  });

  it('hides row actions from a viewer', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage={false} />);
    await screen.findByTestId('observed-row-HIVVL');
    expect(screen.queryByTestId('observed-actions-HIVVL')).toBeNull();
  });

  it('asks again with the status filter', async () => {
    vi.mocked(api.listObservedTestCodes).mockResolvedValue({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    render(<ObservedCodesTab canManage />);
    await screen.findByTestId('observed-row-HIVVL');
    fireEvent.click(screen.getByTestId('observed-status-unmapped'));
    await waitFor(() => expect(vi.mocked(api.listObservedTestCodes)).toHaveBeenLastCalledWith({ status: 'unmapped', q: undefined, limit: 25, offset: 0 }));
  });
  it('ignores a slower earlier response that arrives after a newer one', async () => {
    type Result = Awaited<ReturnType<typeof api.listObservedTestCodes>>;
    let resolveFirst!: (v: Result) => void;
    const first = new Promise<Result>((r) => { resolveFirst = r; });
    const newer: Result = { rows: [{ ...ROW, code: 'CD4' }], total: 1, warehouse: { stale: false, error: null } };
    vi.mocked(api.listObservedTestCodes).mockReturnValueOnce(first).mockResolvedValueOnce(newer);
    render(<ObservedCodesTab canManage />);
    fireEvent.click(screen.getByTestId('observed-status-unmapped'));
    expect(await screen.findByTestId('observed-row-CD4')).toBeTruthy();
    resolveFirst({ rows: [ROW], total: 1, warehouse: { stale: false, error: null } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('observed-row-HIVVL')).toBeNull();
    expect(screen.getByTestId('observed-row-CD4')).toBeTruthy();
  });
});
