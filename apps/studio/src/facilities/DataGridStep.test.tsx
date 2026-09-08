import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, readFacilityImportRows: vi.fn() };
});

import * as api from '@/api';
import { DataGridStep } from './DataGridStep';

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['MFL Code', 'Name'],
    rows: [['100001', 'Chunga Clinic'], ['100002', 'Ngwerere Health Post']],
    offset: 0, limit: 100, total: 3788,
  });
});

describe('DataGridStep', () => {
  it('renders the file as a table with its own header row', async () => {
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText('Chunga Clinic')).toBeInTheDocument();
    expect(screen.getByText('MFL Code')).toBeInTheDocument();
  });

  // AGENTS.md 5: every table gets TablePagination, no exceptions.
  it('shows the total from the server, not the row count', async () => {
    render(<DataGridStep runId="fir_1" />);
    await screen.findByText('Chunga Clinic');
    await waitFor(() => expect(api.readFacilityImportRows).toHaveBeenCalledWith('fir_1', { offset: 0, limit: 100 }));
    expect(screen.getByText(/1.*100.*3,?788/)).toBeInTheDocument();
  });

  it('fetches the next window when pagination advances', async () => {
    render(<DataGridStep runId="fir_1" />);
    await screen.findByText('Chunga Clinic');
    expect(mocked(api.readFacilityImportRows).mock.calls).toHaveLength(1);

    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['MFL Code', 'Name'],
      rows: [['100101', 'Nampundwe Health Post'], ['100102', 'Mbewe Clinic']],
      offset: 100, limit: 100, total: 3788,
    });

    const nextButton = screen.getByRole('button', { name: 'Next page' });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(mocked(api.readFacilityImportRows).mock.calls).toHaveLength(2);
    });
    expect(mocked(api.readFacilityImportRows).mock.calls[1]?.[1]).toEqual({ offset: 100, limit: 100 });

    expect(screen.getByText('Nampundwe Health Post')).toBeInTheDocument();
    expect(screen.queryByText('Chunga Clinic')).not.toBeInTheDocument();
  });

  it('says so when the file could not be read, instead of an empty table', async () => {
    mocked(api.readFacilityImportRows).mockRejectedValue(new Error('no stored file'));
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });
});
