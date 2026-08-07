import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '@/i18n';

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

const cleanPreview = {
  parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
};

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
      .mockResolvedValueOnce({
        parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 2, updated: 1, duplicates: 0, blocked: false, blockedReason: null,
      });
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
      parsed: 0, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
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
      .mockResolvedValueOnce({
        parsed: 0, skipped: 0, unknownColumns: ['weird_col', 'other_col'], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
      })
      .mockResolvedValueOnce({
        parsed: 3, skipped: 0, unknownColumns: ['weird_col', 'other_col'], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
      });
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

  // Task 5: surface Task 4's `quarantined` (facility-import.ts) — a structurally malformed row's
  // line number and raw content, and the `allowMalformedRows` override, reusing the same
  // control/copy pattern as the unknown-columns opt-in above (see the brief).
  it('lists quarantined line numbers, states the count, and blocks Apply until the operator opts in', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      // What the server actually answers for a preview run WITHOUT the override — the sheet
      // previews before the checkbox is ever ticked.
      created: 0, updated: 0, duplicates: 0, blocked: true, blockedReason: 'quarantined-rows',
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/line 3/i)).toBeInTheDocument();
    expect(screen.getByText(/2,Bad,Extra/)).toBeInTheDocument();
    expect(screen.getByText(/1 row could not be read/i)).toBeInTheDocument();

    // Apply is not offered while a quarantined row is blocking and not yet allowed — same
    // "not offered" idiom this sheet already uses for the unknown-columns-blocked and over-cap
    // cases above, not a disabled control with no explanation.
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // Opting in unblocks Apply locally — `allowMalformedRows` does not change what the parser
    // finds (see facility-import.ts's docblock: it only gates whether APPLY proceeds), so this
    // must NOT re-trigger a preview request, unlike the unknown-columns checkbox above.
    fireEvent.click(screen.getByRole('checkbox'));
    expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1);

    openMenu();
    expect(screen.getByRole('menuitem', { name: /^apply$/i })).toBeInTheDocument();
  });

  // ⛔ THE CASE THIS SHEET COULD NOT REFUSE ON ITS OWN. Its old gate was "quarantined rows and no
  // override"; a duplicate-header file has neither, so Apply stayed off the menu only because
  // `parseFacilityCsv` happens to return `records: []` — i.e. `parsed > 0` did the work. That is a
  // property of today's parser, not a contract, and the server refuses this file regardless. With
  // `parsed: 2` (a file the parser DID read rows out of) the old gate offers Apply for a write the
  // server will reject; reading the server's own `blocked` refuses it. Ticking the malformed-rows
  // checkbox must NOT release it either — duplicate headers have no override.
  it('refuses Apply for a duplicate-header file even when rows parsed, and the override does not release it', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 2, skipped: 0, unknownColumns: [], duplicateColumns: ['name'],
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      created: 0, updated: 0, duplicates: 0, blocked: true, blockedReason: 'duplicate-columns',
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1));

    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // The quarantine block is rendered (the file has both problems), so the checkbox is reachable —
    // and ticking it changes nothing, because the reason is the unoverridable one.
    fireEvent.click(screen.getByRole('checkbox'));
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('sends allowMalformedRows: true on Apply once the operator has opted in past quarantined rows', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        // Preview, no override yet: the server says blocked.
        created: 0, updated: 0, duplicates: 0, blocked: true, blockedReason: 'quarantined-rows',
      })
      .mockResolvedValueOnce({
        parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        // Apply, override sent: same file, not blocked.
        created: 1, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
      });
    const onImported = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={onImported} />);

    pickFileAndSystem();
    await previewNow();
    fireEvent.click(await screen.findByRole('checkbox'));

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowMalformedRows: true, apply: true }),
    );
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  // ⛔ THE OVERRIDE HAS TO WORK IN BOTH DIRECTIONS. `blocked` is baked at PREVIEW time, so if the
  // preview request carries the checkbox's value the server answers `blocked: false` and the local
  // re-application has nothing left to re-impose: un-ticking cannot block again. Measured before the
  // fix — preview, tick, re-Preview (the ⋯ item re-previews), un-tick — and Apply stayed on the menu;
  // the Apply request then sent `allowMalformedRows: false`, the server refused it, and the operator
  // got an "applied" result that wrote nothing and audited nothing. `toggleAllowUnknownColumns`
  // reaches the same state with no manual re-preview at all, because it re-previews by itself.
  //
  // The mock is an IMPLEMENTATION, not a fixed value, precisely so it answers the way the server
  // does — `blocked` computed from the request's own `allowMalformedRows` (facility-import.ts). A
  // constant payload would pass no matter what the sheet sends, which is what made this reachable.
  it('re-imposes the quarantine block when the operator un-ticks the override after a re-preview', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockImplementation(
      async (req: { allowMalformedRows: boolean }) => ({
        parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        created: 0, updated: 0, duplicates: 0,
        blocked: !req.allowMalformedRows,
        blockedReason: req.allowMalformedRows ? null : 'quarantined-rows',
      }),
    );
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    fireEvent.click(await screen.findByRole('checkbox'));
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^apply$/i })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // A second Preview while the box is ticked — the state the re-applied override has to survive.
    clickMenuItem(/^preview$/i);
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    // THE LOAD-BEARING REQUEST: the preview asks for the UN-OVERRIDDEN answer even though the
    // operator has opted in, so `blockedReason` stays 'quarantined-rows' for the checkbox to toggle
    // against. Sending `true` here is exactly what makes the un-tick below unrepresentable.
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowMalformedRows: false, apply: false }),
    );
    // The opt-in survives the re-preview (nothing resets the checkbox), so Apply is still offered.
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^apply$/i })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // …and taking it back takes Apply away again.
    fireEvent.click(screen.getByRole('checkbox'));
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('surfaces duplicates as a plainly-visible warning, not a buried number', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 5, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 2, blocked: false, blockedReason: null,
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
      parsed: 14000, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
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

  it('F2: after opting into unknown columns, a wrong file still states an outcome and surfaces the skipped count', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        parsed: 0, skipped: 0, unknownColumns: ['patient_id', 'dob', 'sex'], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
      })
      .mockResolvedValueOnce({
        parsed: 0, skipped: 3000, unknownColumns: ['patient_id', 'dob', 'sex'], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0, blocked: false, blockedReason: null,
      });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/patient_id, dob, sex/)).toBeInTheDocument();
    // Before opting in, unknown-columns-blocked is its own distinct explanation — the "wrong file"
    // message must not also render here (would be a second, confusing message for the same click).
    expect(screen.queryByText(/no facility rows were found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowUnknownColumns: true }),
    );

    // Once opted in, a file that still parses to zero rows must say so plainly, AND the 3000
    // skipped rows (previously invisible — `skipped` only ever rendered inside the `parsed > 0`
    // branch) must be visible.
    expect(await screen.findByText(/3000 row\(s\).*skipped/i)).toBeInTheDocument();
    expect(screen.queryByText(/row\(s\) will be imported/i)).not.toBeInTheDocument();
  });

  it('F3: the headline row count and the apply-confirm body reflect what will actually be written, not the raw parsed count', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: 5, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 2, blocked: false, blockedReason: null,
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    // 5 parsed rows minus 2 collapsed duplicates = 3 rows will actually land in the registry.
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/5 row\(s\) will be imported/i)).not.toBeInTheDocument();

    clickMenuItem(/^apply$/i);
    expect(await screen.findByText(/this writes 3 facility row\(s\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/this writes 5 facility row\(s\)/i)).not.toBeInTheDocument();
  });

  it('F4: the 8MB size-cap 400 gets the same plain-language treatment as the row cap, including on a plain preview', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('csv exceeds the 8MB limit for this endpoint; use `openldr facilities import` (the CLI) for a larger register'),
    );
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();

    const friendly = await screen.findByText(/larger than this endpoint accepts/i);
    expect(friendly).toBeInTheDocument();
    expect(screen.queryByText(/csv exceeds the 8mb limit/i)).not.toBeInTheDocument();
  });

  it('F5: a 0-byte CSV explains why Preview stays disabled, instead of dead-ending with no explanation', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File([''], 'empty.csv', { type: 'text/csv' })] } });
    fireEvent.change(screen.getByLabelText('National system'), { target: { value: 'HFR' } });

    expect(await screen.findByText(/this file is empty/i)).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^preview$/i })).toHaveAttribute('aria-disabled', 'true');
  });

  it('F6: the apply-confirm Cancel button is translated, not left as the English literal default', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    pickFileAndSystem();
    await previewNow();
    clickMenuItem(/^apply$/i);
    await screen.findByRole('button', { name: /^apply$/i });

    await i18n.changeLanguage('fr');
    try {
      expect(await screen.findByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
