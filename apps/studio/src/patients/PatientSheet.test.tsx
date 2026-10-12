import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getPatient: vi.fn(), listPatientRequests: vi.fn() };
});

import * as api from '@/api';
import { PatientSheet } from './PatientSheet';

const DETAIL: api.PatientDetail = {
  ref: 'r1', id: 'hl7-1', name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: 'MPI-0001' }, { system: null, label: null, value: 'F-9' }],
  managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' }, active: false, replacedByRef: 'r2',
  lastRequestAt: '2026-03-04', requestCount: 1, patientGuid: 'G-1', phone: '0977', email: null, masked: false,
};

beforeEach(() => {
  vi.mocked(api.getPatient).mockReset();
  vi.mocked(api.listPatientRequests).mockReset();
});

describe('PatientSheet', () => {
  it('shows identity, labelled identifiers and the requests table', async () => {
    vi.mocked(api.getPatient).mockResolvedValue(DETAIL);
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [{ authoredAt: '2026-03-04', panel: 'VL', requester: 'Chilenje', status: 'completed', resultCount: 2 }], total: 1 });
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('John Mwanza')).toBeTruthy();
    expect(screen.getByText('MPI')).toBeTruthy();
    expect(screen.getByText('No system')).toBeTruthy();
    expect(screen.getByText('0977')).toBeTruthy();
    expect((await screen.findByTestId('patient-request-0')).textContent).toContain('VL');
    expect(vi.mocked(api.listPatientRequests)).toHaveBeenCalledWith('r1', { limit: 10, offset: 0 });
  });

  it('opens the replacement patient from its ⋯ menu', async () => {
    vi.mocked(api.getPatient).mockResolvedValue(DETAIL);
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [], total: 0 });
    const onOpen = vi.fn();
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={onOpen} />);
    await screen.findByText('John Mwanza');
    const trigger = screen.getByTestId('patient-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('patient-open-replacement'));
    expect(onOpen).toHaveBeenCalledWith('r2');
  });

  it('shows the birth year label and no phone row when masked', async () => {
    vi.mocked(api.getPatient).mockResolvedValue({ ...DETAIL, id: null, name: 'J*** M***', birthDate: '1990', phone: null, patientGuid: '•••-1', masked: true });
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [], total: 0 });
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('Birth year')).toBeTruthy();
    expect(screen.queryByText('Phone')).toBeNull();
    expect(await screen.findByText('No requests for this patient.')).toBeTruthy();
  });

  it('asks for a reload when the ref is no longer valid', async () => {
    vi.mocked(api.getPatient).mockRejectedValue(new Error('open patient failed: 404'));
    vi.mocked(api.listPatientRequests).mockRejectedValue(new Error('404'));
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('This list is out of date. Reload the page to open the patient.')).toBeTruthy();
  });

  it('ignores a late response for a previous patient', async () => {
    let resolveOld: (d: api.PatientDetail) => void = () => {};
    const old = new Promise<api.PatientDetail>((res) => { resolveOld = res; });
    vi.mocked(api.getPatient).mockImplementation((ref: string) =>
      ref === 'r1' ? old : Promise.resolve({ ...DETAIL, ref: 'r2', name: 'Jane Banda', replacedByRef: null }));
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [], total: 0 });
    const { rerender } = render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    rerender(<PatientSheet patientRef="r2" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('Jane Banda')).toBeTruthy();
    resolveOld(DETAIL);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('John Mwanza')).toBeNull();
    expect(screen.getByText('Jane Banda')).toBeTruthy();
  });
});
