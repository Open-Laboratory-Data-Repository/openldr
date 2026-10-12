import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listIdentifierSystems: vi.fn() };
});

import * as api from '@/api';
import { IdentifierSystemsTab } from './IdentifierSystemsTab';

const MPI: api.IdentifierSystemRow = { system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: true };
const NONE: api.IdentifierSystemRow = { system: null, label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true };

beforeEach(() => { vi.mocked(api.listIdentifierSystems).mockReset(); });

describe('IdentifierSystemsTab', () => {
  it('lists systems with label, count and flags, and offers Edit to a manager only for a real system', async () => {
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [NONE, MPI], total: 2, ownedHere: true });
    render(<IdentifierSystemsTab canManage />);
    const row = await screen.findByTestId('identifier-system-row-urn:zm:mpi');
    expect(row.textContent).toContain('MPI');
    expect(row.textContent).toContain('3');
    expect(screen.getByTestId('identifier-system-actions-urn:zm:mpi')).toBeTruthy();
    expect(screen.getByTestId('identifier-system-row-none').textContent).toContain('No system');
    expect(screen.queryByTestId('identifier-system-actions-none')).toBeNull();
  });

  it('shows the system URI as the label when the system has no label', async () => {
    const BARE: api.IdentifierSystemRow = { system: 'urn:zm:nrc', label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true };
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [BARE], total: 1, ownedHere: true });
    render(<IdentifierSystemsTab canManage />);
    const row = await screen.findByTestId('identifier-system-row-urn:zm:nrc');
    // The System column also holds the URI, so check the Label cell itself.
    expect(row.querySelectorAll('td')[0].textContent).toBe('urn:zm:nrc');
  });

  it('hides Edit without patients.manage and when central owns the labels', async () => {
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [MPI], total: 1, ownedHere: true });
    const { unmount } = render(<IdentifierSystemsTab canManage={false} />);
    await screen.findByTestId('identifier-system-row-urn:zm:mpi');
    expect(screen.queryByTestId('identifier-system-actions-urn:zm:mpi')).toBeNull();
    unmount();
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [MPI], total: 1, ownedHere: false });
    render(<IdentifierSystemsTab canManage />);
    await screen.findByTestId('identifier-system-row-urn:zm:mpi');
    expect(screen.getByText('These labels come from central. Only central can change them.')).toBeTruthy();
    expect(screen.queryByTestId('identifier-system-actions-urn:zm:mpi')).toBeNull();
  });

  it('shows stripes when no identifier has arrived', async () => {
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [], total: 0, ownedHere: true });
    render(<IdentifierSystemsTab canManage />);
    expect(await screen.findByText('No identifiers have arrived yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
