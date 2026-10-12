import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, dismissPatientDuplicates: vi.fn(), restorePatientDuplicates: vi.fn() };
});

import * as api from '@/api';
import { DuplicateGroupSheet } from './DuplicateGroupSheet';

const ROW = (ref: string): api.PatientRow => ({
  ref, id: ref, name: `Name ${ref}`, sex: 'F', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:nrc', label: 'NRC', value: '998877/10/1' }], managingFacility: null,
  active: true, replacedByRef: null, lastRequestAt: null, requestCount: 0,
});
const GROUP: api.DuplicateGroup = {
  rule: 'identifier', evidence: { system: 'urn:zm:nrc', label: 'NRC', text: '998877/10/1' },
  members: [ROW('r1'), ROW('r2')], memberCount: 2, pairs: 1, dismissedPairs: 0,
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  vi.mocked(api.dismissPatientDuplicates).mockReset();
  vi.mocked(api.restorePatientDuplicates).mockReset();
});

describe('DuplicateGroupSheet', () => {
  it('lists the evidence and every member', () => {
    render(<DuplicateGroupSheet group={GROUP} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('Same NRC')).toBeTruthy();
    expect(screen.getByText('Name r1')).toBeTruthy();
    expect(screen.getByText('Name r2')).toBeTruthy();
  });

  it('marks the group as not duplicates with the reason', async () => {
    vi.mocked(api.dismissPatientDuplicates).mockResolvedValue({ changed: 1 });
    const onChanged = vi.fn();
    render(<DuplicateGroupSheet group={GROUP} canManage onClose={() => {}} onChanged={onChanged} onOpen={() => {}} />);
    fireEvent.change(screen.getByTestId('duplicate-reason'), { target: { value: 'twins' } });
    openMenu('duplicate-sheet-menu');
    fireEvent.click(await screen.findByTestId('duplicate-mark-not'));
    await waitFor(() => expect(vi.mocked(api.dismissPatientDuplicates)).toHaveBeenCalledWith(['r1', 'r2'], 'twins'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the group again when it has dismissed pairs', async () => {
    vi.mocked(api.restorePatientDuplicates).mockResolvedValue({ changed: 1 });
    render(<DuplicateGroupSheet group={{ ...GROUP, dismissedPairs: 1 }} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    openMenu('duplicate-sheet-menu');
    expect(screen.queryByTestId('duplicate-mark-not')).toBeNull();
    fireEvent.click(await screen.findByTestId('duplicate-show-again'));
    await waitFor(() => expect(vi.mocked(api.restorePatientDuplicates)).toHaveBeenCalledWith(['r1', 'r2']));
  });

  it('has no sheet menu or reason without patients.manage', () => {
    render(<DuplicateGroupSheet group={GROUP} canManage={false} onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    expect(screen.queryByTestId('duplicate-sheet-menu')).toBeNull();
    expect(screen.queryByTestId('duplicate-reason')).toBeNull();
  });

  it('opens a member patient from its menu', async () => {
    const onOpen = vi.fn();
    render(<DuplicateGroupSheet group={GROUP} canManage onClose={() => {}} onChanged={() => {}} onOpen={onOpen} />);
    openMenu('duplicate-member-menu-r2');
    fireEvent.click(await screen.findByTestId('duplicate-open-r2'));
    expect(onOpen).toHaveBeenCalledWith('r2');
  });

  it('tells a truncated details group to fix it in the source system, without the search hint', () => {
    render(<DuplicateGroupSheet group={{ ...GROUP, rule: 'details', memberCount: 60 }} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('This group is too large to mark here. Fix it in the source system.')).toBeTruthy();
    expect(screen.queryByText(/turn off Search matches it/)).toBeNull();
  });

  it('cannot mark a group larger than the rows it holds', async () => {
    render(<DuplicateGroupSheet group={{ ...GROUP, memberCount: 60 }} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('Showing 2 of 60 patients.')).toBeTruthy();
    expect(screen.getByText(/too large to mark here/)).toBeTruthy();
    expect(screen.queryByTestId('duplicate-reason')).toBeNull();
    expect(screen.queryByTestId('duplicate-sheet-menu')).toBeNull();
    expect(screen.queryByTestId('duplicate-mark-not')).toBeNull();
  });

  it('still offers Show again on a large group that has dismissed pairs', async () => {
    render(<DuplicateGroupSheet group={{ ...GROUP, memberCount: 60, dismissedPairs: 1 }} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    openMenu('duplicate-sheet-menu');
    expect(await screen.findByTestId('duplicate-show-again')).toBeTruthy();
    expect(screen.queryByTestId('duplicate-mark-not')).toBeNull();
  });
});
