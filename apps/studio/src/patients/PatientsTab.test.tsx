import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPatients: vi.fn() };
});

import * as api from '@/api';
import { PatientsTab } from './PatientsTab';

const ROW: api.PatientRow = {
  ref: 'r1', id: 'hl7-1', name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: 'MPI-0001' }],
  managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' },
  active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2,
};

beforeEach(() => { vi.mocked(api.listPatients).mockReset(); });

describe('PatientsTab', () => {
  it('shows the spinner, then a row with its listed identifier and facility', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [ROW], total: 1, masked: false });
    render(<PatientsTab onOpen={() => {}} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const row = await screen.findByTestId('patient-row-r1');
    expect(row.textContent).toContain('John Mwanza');
    expect(row.textContent).toContain('MPI: MPI-0001');
    expect(row.textContent).toContain('Chilenje Clinic');
    expect(vi.mocked(api.listPatients)).toHaveBeenCalledWith({ search: undefined, status: 'active', limit: 25, offset: 0 });
  });

  it('says it is masked and asks for an exact identifier', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [{ ...ROW, id: null, name: 'J*** M***' }], total: 1, masked: true });
    render(<PatientsTab onOpen={() => {}} />);
    await screen.findByTestId('patient-row-r1');
    expect(screen.getByText('Names and identifiers are masked. Search matches an exact identifier only.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Exact identifier')).toBeTruthy();
  });

  it('shows stripes and no table when empty', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [], total: 0, masked: false });
    render(<PatientsTab onOpen={() => {}} />);
    expect(await screen.findByText('No patients yet. Patients arrive with lab data from the source system.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a patient when its row is clicked', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [ROW], total: 1, masked: false });
    const onOpen = vi.fn();
    render(<PatientsTab onOpen={onOpen} />);
    fireEvent.click(await screen.findByTestId('patient-row-r1'));
    expect(onOpen).toHaveBeenCalledWith('r1');
  });

  it('searches after a pause, from page one', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [ROW], total: 1, masked: false });
    render(<PatientsTab onOpen={() => {}} />);
    await screen.findByTestId('patient-row-r1');
    fireEvent.change(screen.getByPlaceholderText('Search name or identifier'), { target: { value: 'MPI-0001' } });
    await waitFor(() => expect(vi.mocked(api.listPatients)).toHaveBeenLastCalledWith({ search: 'MPI-0001', status: 'active', limit: 25, offset: 0 }));
  });
});
