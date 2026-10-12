import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPatients: vi.fn() };
});

const auth = vi.hoisted(() => ({ caps: new Set<string>() }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: (c: string) => auth.caps.has(c) }) }));

import * as api from '@/api';
import { PatientsTab } from './PatientsTab';

const ROW: api.PatientRow = {
  ref: 'r1', id: 'hl7-1', name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: 'MPI-0001' }],
  managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' },
  active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2,
};

beforeEach(() => {
  vi.mocked(api.listPatients).mockReset();
  auth.caps = new Set(['patients.view_identifiers']);
});

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

  it('shows the masked placeholder from the start when the user lacks the identifiers capability', async () => {
    auth.caps = new Set();
    let resolve!: (v: api.PatientList) => void;
    vi.mocked(api.listPatients).mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<PatientsTab onOpen={() => {}} />);
    expect(screen.getByPlaceholderText('Exact identifier')).toBeTruthy();
    expect(screen.getByText('Names and identifiers are masked. Search matches an exact identifier only.')).toBeTruthy();
    resolve({ rows: [], total: 0, masked: true });
    await screen.findByText('No patients yet. Patients arrive with lab data from the source system.');
  });

  it('keeps the rows of the latest search when responses arrive out of order', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(api.listPatients).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<PatientsTab onOpen={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search name or identifier'), { target: { value: 'two' } });
    await waitFor(() => expect(vi.mocked(api.listPatients)).toHaveBeenCalledTimes(2));
    second.resolve({ rows: [{ ...ROW, ref: 'r2', name: 'Second Person' }], total: 1, masked: false });
    await screen.findByTestId('patient-row-r2');
    first.resolve({ rows: [{ ...ROW, ref: 'r1', name: 'First Person' }], total: 1, masked: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('patient-row-r2')).toBeTruthy();
    expect(screen.queryByTestId('patient-row-r1')).toBeNull();
  });
});

function deferred() {
  let resolve!: (v: api.PatientList) => void;
  const promise = new Promise<api.PatientList>((r) => { resolve = r; });
  return { promise, resolve };
}
