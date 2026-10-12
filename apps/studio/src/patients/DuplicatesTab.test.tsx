import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPatientDuplicates: vi.fn(), downloadPatientDuplicatesCsv: vi.fn() };
});

import * as api from '@/api';
import { DuplicatesTab } from './DuplicatesTab';

const ROW = (ref: string, name: string): api.PatientRow => ({
  ref, id: null, name, sex: 'M', birthDate: '1990', ageYears: 36, identifiers: [], managingFacility: null,
  active: true, replacedByRef: null, lastRequestAt: null, requestCount: 0,
});
const GROUP: api.DuplicateGroup = {
  rule: 'identifier', evidence: { system: 'urn:zm:nrc', label: 'NRC', text: '•••10/1' },
  members: [ROW('r1', 'J*** M***'), ROW('r2', 'J*** M***')], memberCount: 2, pairs: 1, dismissedPairs: 0,
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.mocked(api.listPatientDuplicates).mockReset(); });

describe('DuplicatesTab', () => {
  it('shows the spinner, then a group with rule, evidence and member count', async () => {
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [GROUP], total: 1, masked: true });
    render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const row = await screen.findByTestId('duplicate-row-0');
    expect(row.textContent).toContain('Same NRC');
    expect(row.textContent).toContain('•••10/1');
    expect(row.textContent).toContain('2');
    expect(vi.mocked(api.listPatientDuplicates)).toHaveBeenCalledWith({ status: 'open', limit: 25, offset: 0 });
  });

  it('shows the real member count when the group holds more than it lists', async () => {
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [{ ...GROUP, memberCount: 60 }], total: 1, masked: false });
    render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    expect((await screen.findByTestId('duplicate-row-0')).textContent).toContain('60');
  });

  it('shows stripes and no table when there are none', async () => {
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [], total: 0, masked: false });
    render(<DuplicatesTab canManage canExport onOpen={() => {}} />);
    expect(await screen.findByText('No likely duplicates.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers Export only with patients.view_identifiers', async () => {
    vi.mocked(api.downloadPatientDuplicatesCsv).mockResolvedValue(undefined);
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [GROUP], total: 1, masked: false });
    const { unmount } = render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    await screen.findByTestId('duplicate-row-0');
    expect(screen.queryByTestId('duplicates-menu-trigger')).toBeNull();
    unmount();
    render(<DuplicatesTab canManage canExport onOpen={() => {}} />);
    await screen.findByTestId('duplicate-row-0');
    openMenu('duplicates-menu-trigger');
    fireEvent.click(await screen.findByTestId('duplicates-export'));
    await waitFor(() => expect(vi.mocked(api.downloadPatientDuplicatesCsv)).toHaveBeenCalled());
  });

  it('steps back to the last page with rows when the current page comes back empty', async () => {
    const list = vi.mocked(api.listPatientDuplicates);
    list.mockImplementation(async (q) => (q.offset === 0
      ? { rows: [GROUP], total: 30, masked: false }
      : { rows: [], total: 3, masked: false }));
    render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    await screen.findByTestId('duplicate-row-0');
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(list).toHaveBeenCalledWith({ status: 'open', limit: 25, offset: 25 }));
    await waitFor(() => expect(list.mock.calls.filter(([q]) => q.offset === 0)).toHaveLength(2));
    expect(await screen.findByTestId('duplicate-row-0')).toBeTruthy();
  });

  it('ignores a late response from an earlier load', async () => {
    let resolveFirst: (v: api.DuplicateList) => void = () => {};
    vi.mocked(api.listPatientDuplicates)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ rows: [{ ...GROUP, evidence: { ...GROUP.evidence, text: 'second' } }], total: 1, masked: false });
    render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    fireEvent.click(screen.getByTestId('duplicates-status-trigger'));
    fireEvent.click(await screen.findByText('All'));
    expect((await screen.findByTestId('duplicate-row-0')).textContent).toContain('second');
    resolveFirst({ rows: [{ ...GROUP, evidence: { ...GROUP.evidence, text: 'first' } }], total: 1, masked: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('duplicate-row-0').textContent).toContain('second');
  });
});
