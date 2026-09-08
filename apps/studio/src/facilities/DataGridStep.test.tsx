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

  // ⛔ THE OPERATOR MUST LEARN IT IS THEIR FILE. This copy used to read "Check the connection and
  // open this step again", which sends someone to look at their network over a bad line in their
  // own CSV. The server's message names the run and the line, so it is shown.
  it('shows what the server said went wrong, and does not blame the connection', async () => {
    mocked(api.readFacilityImportRows).mockRejectedValue(
      new Error('read import rows failed: import run fir_1: this file could not be read as CSV at line 12'),
    );
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText(/at line 12/i)).toBeInTheDocument();
    expect(screen.queryByText(/connection/i)).not.toBeInTheDocument();
  });

  // ⛔ SKIPPED LINES ARE REPORTED, NOT SWALLOWED. One unreadable JSONL line in a 3 788-line release
  // must not hide the other 3 787, and it must not silently vanish either: the operator has to know
  // the table is short and which lines are missing from it.
  it('names the lines the server could not read, above the table', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['MFL Code', 'Name'],
      rows: [['100001', 'Chunga Clinic']],
      offset: 0, limit: 100, total: 1, skipped: 2, skippedLines: [4, 9],
    });
    render(<DataGridStep runId="fir_1" />);
    await screen.findByText('Chunga Clinic');
    expect(screen.getByText(/4, 9/)).toBeInTheDocument();
  });

  // ⛔ A FULLY UNREADABLE FILE IS NOT AN EMPTY FILE. When every line was skipped, `rows` is empty
  // and `total` is 0, so the empty-state return used to fire first and hide the skipped notice
  // below it. The operator saw "This file has no rows" for a register that was full of rows, none
  // of which could be read. The skipped-line information must survive the empty check.
  it('names the skipped lines instead of saying the file is empty, when every row was skipped', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: [], rows: [], offset: 0, limit: 100, total: 0, skipped: 3, skippedLines: [1, 2, 3],
    });
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText(/1, 2, 3/)).toBeInTheDocument();
    expect(screen.queryByText('This file has no rows.')).not.toBeInTheDocument();
  });

  it('says nothing about skipped lines for a clean file', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['MFL Code', 'Name'],
      rows: [['100001', 'Chunga Clinic']],
      offset: 0, limit: 100, total: 1, skipped: 0, skippedLines: [],
    });
    render(<DataGridStep runId="fir_1" />);
    await screen.findByText('Chunga Clinic');
    expect(screen.queryByText(/could not be read and/i)).not.toBeInTheDocument();
  });

  // ⛔ THE NOTICE IS WHAT MAKES THE SPEC'S RECORDED EXCEPTION TO AGENTS.md §6 LEGITIMATE. The design
  // says stage 2 "says plainly that it needs a wider screen rather than rendering something
  // unusable". Without it, 21 columns render at 375px and scroll sideways.
  it('asks for a wider screen instead of rendering 21 columns on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText(/wider screen/i)).toBeInTheDocument();
    expect(screen.queryByText('Chunga Clinic')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
