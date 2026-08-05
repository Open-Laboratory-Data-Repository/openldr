import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    importFacilitiesCsv: vi.fn(),
  };
});

import * as api from '@/api';
import { ImportFacilitiesSheet } from './ImportFacilitiesSheet';

/** Open the sheet's own ⋯ actions menu (pointerdown; jsdom sometimes needs a follow-up Enter
 *  keydown for Radix to mount the content — same pattern as FacilityDialog.test.tsx). */
function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Import actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

/** Open the menu fresh and click the item matching `itemName`. Only safe to call while the menu
 *  is currently CLOSED — Radix's own item onSelect closes the menu again afterwards, which is
 *  what leaves it closed for the next call. */
function clickMenuItem(itemName: string | RegExp) {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

const csvFile = (contents = 'local_code,name\nLAB01,Dodoma RRH\n') =>
  new File([contents], 'register.csv', { type: 'text/csv' });

function pickFileAndSystem(contents?: string) {
  fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile(contents)] } });
  fireEvent.change(screen.getByLabelText('National system'), { target: { value: 'HFR' } });
}

/** Reading the File's text back out (`file.text()`) is genuinely asynchronous in jsdom, so the
 *  Preview action stays disabled until it resolves — this opens the menu and waits for THAT,
 *  rather than a fixed delay, before clicking it. Leaves the menu closed afterward (same as
 *  clickMenuItem) via Radix's own item-select auto-close. */
async function previewNow() {
  openMenu();
  await waitFor(() => expect(screen.getByRole('menuitem', { name: /^preview$/i })).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(screen.getByRole('menuitem', { name: /^preview$/i }));
}

const cleanPreview = { parsed: 3, skipped: 0, unknownColumns: [], created: 0, updated: 0, duplicates: 0 };

describe('ImportFacilitiesSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never applies straight from the file picker — Preview is a dry run, Apply is not offered until one succeeds', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    const onImported = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={onImported} />);

    // Apply is not even offered before a preview has run.
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    pickFileAndSystem();
    await previewNow();

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1));
    expect(api.importFacilitiesCsv).toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: 'HFR', apply: false }),
    );
    // Never sent an apply:true request just from picking a file + previewing.
    expect(api.importFacilitiesCsv).not.toHaveBeenCalledWith(expect.objectContaining({ apply: true }));
    expect(onImported).not.toHaveBeenCalled();
  });

  it('shows the dry-run summary before any Apply confirmation, then applies and reloads on confirm', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cleanPreview)
      .mockResolvedValueOnce({ parsed: 3, skipped: 0, unknownColumns: [], created: 2, updated: 1, duplicates: 0 });
    const onImported = vi.fn();
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={onImported} />);

    pickFileAndSystem();
    await previewNow();
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();

    clickMenuItem(/^apply$/i);
    // The confirm dialog is an explicit second step, not an immediate apply.
    expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ nationalSystem: 'HFR', apply: true }),
    );
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    // The sheet is not force-closed by a successful apply — the operator sees the result and
    // closes it themselves.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a parseable-but-wrong file (parsed: 0, no unknown columns) reads as "nothing found", not success', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 0, skipped: 0, unknownColumns: [], created: 0, updated: 0, duplicates: 0,
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem('the quick brown fox');
    await previewNow();

    expect(await screen.findByText(/no facility rows were found/i)).toBeInTheDocument();
    // Nothing to confirm — the trap case must not offer Apply.
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('shows unknown columns with an explicit opt-in, naming the columns, and re-previews once checked', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ parsed: 0, skipped: 0, unknownColumns: ['weird_col', 'other_col'], created: 0, updated: 0, duplicates: 0 })
      .mockResolvedValueOnce({ parsed: 3, skipped: 0, unknownColumns: ['weird_col', 'other_col'], created: 0, updated: 0, duplicates: 0 });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/weird_col, other_col/)).toBeInTheDocument();
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowUnknownColumns: false }),
    );

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowUnknownColumns: true }),
    );
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();
  });

  it('surfaces duplicates as a plainly-visible warning, not a buried number', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 5, skipped: 0, unknownColumns: [], created: 0, updated: 0, duplicates: 2,
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/2 duplicate national code/i)).toBeInTheDocument();
  });

  it('a malformed-CSV 400 surfaces the server message and keeps the sheet open', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('import facilities failed: Invalid Record Length: columns length is 3, got 2 on line 4'),
    );
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/invalid record length/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('renders the over-cap 400 helpfully — plain language, no shell/CLI-only phrasing left bare, and the sheet stays open', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cleanPreview)
      .mockRejectedValueOnce(
        new Error(
          'import facilities failed: this register has 14000 row(s), which exceeds the 2000-row inline apply '
          + 'limit; use `openldr facilities import --apply` (the CLI) instead — it is not bound by an HTTP request deadline',
        ),
      );
    const onImported = vi.fn();
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={onImported} />);

    pickFileAndSystem();
    await previewNow();
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    // The friendlier message says plainly this is a browser/size limitation and names the CLI —
    // it must NOT just dump the raw server string (which opens mid-sentence and reads oddly out
    // of the terminal context: "this register has 14000 row(s), which exceeds...").
    const friendly = await screen.findByText(/too large to apply/i);
    expect(friendly).toBeInTheDocument();
    expect(screen.queryByText(/this register has 14000 row\(s\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/openldr facilities import --apply/)).toBeInTheDocument();

    expect(onImported).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('proactively warns when a clean dry run itself already exceeds the 2000-row apply cap, without offering Apply', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 14000, skipped: 0, unknownColumns: [], created: 0, updated: 0, duplicates: 0,
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/too large to apply/i)).toBeInTheDocument();
    expect(screen.getByText(/openldr facilities import --apply/)).toBeInTheDocument();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('Preview stays disabled until both a file and a national system are present, and never defaults the system', () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByLabelText('National system')).toHaveValue('');

    openMenu();
    expect(screen.getByRole('menuitem', { name: /^preview$/i })).toHaveAttribute('aria-disabled', 'true');
  });
});
