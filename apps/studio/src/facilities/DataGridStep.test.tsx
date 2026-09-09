import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    readFacilityImportRows: vi.fn(),
    readFacilityImportEdits: vi.fn(),
    putFacilityImportEdit: vi.fn(),
    deleteFacilityImportEdit: vi.fn(),
  };
});

import * as api from '@/api';
import { DataGridStep } from './DataGridStep';

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['MFL Code', 'Name'],
    rows: [['100001', 'Chunga Clinic'], ['100002', 'Ngwerere Health Post']],
    lines: [2, 3],
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
      lines: [102, 103],
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
      lines: [2],
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
      headers: [], rows: [], lines: [], offset: 0, limit: 100, total: 0, skipped: 3, skippedLines: [1, 2, 3],
    });
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText(/1, 2, 3/)).toBeInTheDocument();
    expect(screen.queryByText('This file has no rows.')).not.toBeInTheDocument();
  });

  it('says nothing about skipped lines for a clean file', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['MFL Code', 'Name'],
      rows: [['100001', 'Chunga Clinic']],
      lines: [2],
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

  it('writes a cell edit keyed on the row file line, not on its position', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['code', 'name'], rows: [['1', 'Alpha']], lines: [7],
      offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'name', line: 7, fromValue: null, toValue: 'Beta',
    });
    render(<DataGridStep runId="fir_1" editable />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getByText('Alpha'));
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Beta{Enter}');
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
      header: 'name', line: 7, toValue: 'Beta',
    }));
  });

  it('shows a stored edit in place of the file value', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['code', 'name'], rows: [['1', 'Alpha']], lines: [7],
      offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([
      { header: 'name', line: 7, fromValue: null, toValue: 'Beta' },
    ]);
    render(<DataGridStep runId="fir_1" editable />);
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('applies a value-scoped edit to every matching cell in its own column', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name', 'level'], rows: [['Others', 'Others'], ['Alpha', 'Others']], lines: [2, 3],
      offset: 0, limit: 100, total: 2,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([
      { header: 'level', line: null, fromValue: 'Others', toValue: 'Health Post' },
    ]);
    render(<DataGridStep runId="fir_1" editable />);
    expect(await screen.findAllByText('Health Post')).toHaveLength(2);
    // The same string in the `name` column is untouched: an edit names one header.
    expect(screen.getByText('Others')).toBeInTheDocument();
  });

  // Controller ruling: retyping the file's own value under a column sweep is NOT an undo of that
  // sweep. It is one row opting out while the sweep still applies everywhere else, and the only way
  // to record that is a line edit whose value happens to match the file. `commit` must write that
  // line edit, not call `deleteFacilityImportEdit`, and the cell must still show as edited.
  it('writes a line edit, not an undo, when a row retypes the file value under a sweep', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['level'], rows: [['Others']], lines: [2], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([
      { header: 'level', line: null, fromValue: 'Others', toValue: 'Health Post' },
    ]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'level', line: 2, fromValue: 'Others', toValue: 'Others',
    });
    render(<DataGridStep runId="fir_1" editable />);
    await userEvent.click(await screen.findByText('Health Post'));
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Others{Enter}');
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
      header: 'level', line: 2, toValue: 'Others',
    }));
    expect(api.deleteFacilityImportEdit).not.toHaveBeenCalled();
    // The file value shows, and the cell still carries the edited marker (the undo control).
    expect(await screen.findByText('Others')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo this change/i })).toBeInTheDocument();
  });

  it('undoes an edit and puts the file value back', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([
      { header: 'name', line: 7, fromValue: null, toValue: 'Beta' },
    ]);
    mocked(api.deleteFacilityImportEdit).mockResolvedValue({ removed: true });
    render(<DataGridStep runId="fir_1" editable />);
    await screen.findByText('Beta');
    await userEvent.click(screen.getByRole('button', { name: /undo this change/i }));
    await waitFor(() => expect(api.deleteFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
      header: 'name', line: 7,
    }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
  });

  it('does not offer editing when the run is not editable', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    render(<DataGridStep runId="fir_1" />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getByText('Alpha'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(api.readFacilityImportEdits).not.toHaveBeenCalled();
  });

  // A keyboard-only or screen-reader operator has no mouse to click a cell open with. The cell
  // itself has to be a tab stop, and Enter or Space has to open it, without a click anywhere.
  it('opens a cell with the keyboard, no click', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    render(<DataGridStep runId="fir_1" editable />);
    const cell = (await screen.findByText('Alpha')).closest('td') as HTMLElement;
    cell.focus();
    expect(cell).toHaveFocus();
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
  });

  it('opens a cell with Space as well as Enter', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    render(<DataGridStep runId="fir_1" editable />);
    const cell = (await screen.findByText('Alpha')).closest('td') as HTMLElement;
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ' });
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
  });

  // A read-only grid must not become a tab stop on every cell. Only an editable one is.
  it('does not put a read-only cell in the tab order', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    render(<DataGridStep runId="fir_1" />);
    const cell = (await screen.findByText('Alpha')).closest('td') as HTMLElement;
    expect(cell).not.toHaveAttribute('tabindex');
  });

  it('escape leaves the cell as it was', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    render(<DataGridStep runId="fir_1" editable />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getByText('Alpha'));
    await userEvent.type(screen.getByRole('textbox'), 'Beta{Escape}');
    expect(api.putFacilityImportEdit).not.toHaveBeenCalled();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
  });

  // Controller ruling: commit must not run twice for one keystroke. Enter calls commit, which
  // unmounts the Input, which fires blur in a real browser, which would call commit again with the
  // same draft.
  //
  // ⛔ WHY THIS TEST LOOKS THE WAY IT DOES. A plain "press Enter, then call box.blur()" does not
  // prove anything: React removes the Input from the document synchronously, inside the same
  // `fireEvent.keyDown` call, before that call even returns (checked directly with
  // `document.body.contains(box)`, which is already `false` the instant `fireEvent.keyDown`
  // returns). jsdom also does not run a real browser's "fire blur when the focused element is
  // removed" step. So by the time test code can call `blur()` on that Input, it is a detached node
  // with no path back to React's root listener, and the real `onBlur` handler never runs, no matter
  // how it is called afterwards.
  //
  // So the two commit attempts are made to land in the same synchronous window a different way:
  // a plain DOM listener is attached directly on the Input for 'keydown'. The DOM always runs a
  // listener on the event's own target before the event bubbles up to an ancestor, and React's
  // onKeyDown is one such ancestor listener (delegated to the root). So firing `blur` from inside
  // that target-level listener fires it, for real, on the Input while it is still mounted, and
  // React's own `onBlur` handler runs, THEN the event keeps bubbling up and React's `onKeyDown`
  // (Enter) fires. Two real commit attempts, same synchronous stretch, same draft: exactly what the
  // guard exists to stop, whichever of the two fires first.
  it('commits once when two commit triggers land in the same synchronous window', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [7], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'name', line: 7, fromValue: null, toValue: 'Beta',
    });
    render(<DataGridStep runId="fir_1" editable />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByText('Alpha'));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Beta' } });
    box.addEventListener('keydown', () => { fireEvent.blur(box); }, { once: true });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledTimes(1));
  });

  it('asks before changing a controlled-field cell, then sweeps the value', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['Type'], rows: [['Others']], lines: [2], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'Type', line: null, fromValue: 'Others', toValue: 'Health Post',
    });
    render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
    await screen.findByText('Others');
    await userEvent.click(screen.getByText('Others'));
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Health Post{Enter}');
    // Nothing is written until the operator has answered.
    expect(api.putFacilityImportEdit).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: /every row/i }));
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
      header: 'Type', fromValue: 'Others', toValue: 'Health Post',
    }));
  });

  it('writes only the row when the operator says just this row', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['Type'], rows: [['Others']], lines: [2], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'Type', line: 2, fromValue: null, toValue: 'Health Post',
    });
    render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
    await screen.findByText('Others');
    await userEvent.click(screen.getByText('Others'));
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Health Post{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /just this row/i }));
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
      header: 'Type', line: 2, toValue: 'Health Post',
    }));
  });

  it('does not ask on an ordinary column', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['name'], rows: [['Alpha']], lines: [2], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'name', line: 2, fromValue: null, toValue: 'Beta',
    });
    render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getByText('Alpha'));
    const box = screen.getByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Beta{Enter}');
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /every row/i })).not.toBeInTheDocument();
  });

  it('does not ask on a controlled column whose cell is blank', async () => {
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: ['Type'], rows: [['']], lines: [2], offset: 0, limit: 100, total: 1,
    });
    mocked(api.readFacilityImportEdits).mockResolvedValue([]);
    mocked(api.putFacilityImportEdit).mockResolvedValue({
      header: 'Type', line: 2, fromValue: null, toValue: 'Health Post',
    });
    render(<DataGridStep runId="fir_1" editable controlledHeaders={{ Type: 'level' }} />);
    await screen.findAllByRole('row');
    await userEvent.click(screen.getAllByRole('cell')[0]);
    await userEvent.type(screen.getByRole('textbox'), 'Health Post{Enter}');
    await waitFor(() => expect(api.putFacilityImportEdit).toHaveBeenCalledWith('fir_1', {
      header: 'Type', line: 2, toValue: 'Health Post',
    }));
  });
});
