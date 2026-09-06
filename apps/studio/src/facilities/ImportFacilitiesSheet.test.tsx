import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import i18n from '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    importFacilitiesCsv: vi.fn(),
    // A2b Task 8: the background upload path's four clients. Mocked alongside the inline path's
    // `importFacilitiesCsv` rather than in a second factory — `vi.mock` is per-module, and a second
    // call for '@/api' would replace this one.
    uploadFacilityImport: vi.fn(),
    getFacilityImportRun: vi.fn(),
    confirmFacilityImportRun: vi.fn(),
    cancelFacilityImportRun: vi.fn(),
    // B1 Task 9: backs the national-system `Select` — mocked here for the same reason as the four
    // above, not in a second factory.
    listFacilityImportSources: vi.fn(),
    // Review fix (B1 Task 9): the create affordance's own client call, reached through
    // `RegisterSourceDialog` (rendered by `ImportFacilitiesSheet` itself) — mocked here for the
    // same "one factory, not two" reason as `listFacilityImportSources` above.
    createFacilityImportSource: vi.fn(),
    // Task 8: `ColumnMapStep`'s own header+suggestion fetch, and `ValueMapPanel`'s two calls
    // (rendered by `ImportFacilitiesSheet` itself, same as `RegisterSourceDialog` above) — mocked
    // here for the same "one factory, not two" reason.
    suggestColumnMap: vi.fn(),
    suggestValueMappings: vi.fn(),
    writeFacilityValueMappings: vi.fn(),
  };
});

import * as api from '@/api';
import type { FacilityImportResult, FacilityImportRunView, FacilityRegisterSource } from '@/api';
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

/** B1 Task 9: the ONE registered source every test below (bar the ones that exercise the picklist
 *  itself) needs — `url` is deliberately EVERY EXISTING assertion's literal `'HFR'`, so replacing the
 *  free-text box with a `Select` costs those assertions nothing; `name` is deliberately DIFFERENT
 *  from `url`, so a request that (by mutation) carried the display name instead of the URI would be
 *  visibly wrong rather than accidentally matching. */
const HFR_SOURCE: FacilityRegisterSource = {
  id: 'cs-freg-hfr', url: 'HFR', name: 'National Health Facility Registry', code: 'HFR',
  version: null, jurisdiction: null, contact: null, publisherId: null, active: true,
};

/** Picks the file AND the (only, mocked) register source from the `Select` — the picklist
 *  `ImportFacilitiesSheet` now renders instead of a free-text box (B1 Task 9). Async because the
 *  Select stays DISABLED until `listFacilityImportSources` resolves (see `sourcesLoading` in the
 *  component) — this waits for that rather than a fixed delay, the same discipline `previewNow`
 *  below already applies to `File.text()`'s own async read. */
async function pickFileAndSystem(contents?: string) {
  fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile(contents)] } });
  const trigger = await screen.findByRole('combobox', { name: 'National system' });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: HFR_SOURCE.name }));
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

/** Every `FacilityImportResult` field, defaulted to "clean, nothing to reconcile" — every test
 *  below overrides only the fields it cares about, so a new server field never has to be hand-added
 *  to a dozen unrelated mocks. Mirrors the server's own "reported on every call" contract
 *  (facility-import.ts's docblock): a test that forgets a field would otherwise hit `undefined`
 *  where the component expects a real value, not a legitimate "field omitted" case.
 */
function baseResult(overrides: Partial<FacilityImportResult> = {}): FacilityImportResult {
  return {
    parsed: 0, skipped: 0, unknownColumns: [], duplicateColumns: [], columnMapErrors: [], quarantined: [], invalid: [],
    duplicates: 0, blocked: false, blockedReason: null,
    create: 0, changed: 0, unchanged: 0, conflict: null, absent: null, deleted: 0,
    samples: { create: [], changed: [], conflict: [], absent: [], deleted: [] },
    written: { created: 0, updated: 0, retired: 0 }, runId: null, knownNationalSystem: true,
    // CT-3 (whole-branch review): Wave A's new fields (facility-import.ts's `FacilityImportResult`)
    // — release provenance (always empty/null for a plain CSV, the only shape most tests here use)
    // and the controlled-field warnings (empty when nothing was unmapped/unvalidated).
    meta: null, countMismatch: [], releaseVersion: null,
    unmapped: { level: [], status: [], country: [] }, notValidated: [],
    ...overrides,
  };
}

const cleanPreview = baseResult({ parsed: 3, create: 3, runId: 'run-1' });

/** A2b Task 8: one `facility_import_runs` row exactly as `GET /api/facilities/import/runs/:id`
 *  answers it, defaulted to "just uploaded, nothing has happened yet" — every test below overrides
 *  only the fields it cares about, the same discipline `baseResult` above applies to the import
 *  result. */
function runView(overrides: Partial<FacilityImportRunView> = {}): FacilityImportRunView {
  return {
    id: 'run-b1', nationalSystem: 'HFR', sourceFormat: 'csv',
    blobKey: 'facility-import/hfr/abc.csv', fileHash: 'deadbeef', byteSize: 42,
    releaseVersion: null, releasePublishedAt: null,
    declaredRowCount: null, declaredDeletionCount: null,
    status: 'queued', phase: null, processed: 0, total: null,
    previewedAt: null, summary: null, options: null, error: null,
    cancelRequested: false, requestedBy: 'op-1',
    createdAt: '2026-08-10T09:00:00.000Z', startedAt: null, finishedAt: null,
    ...overrides,
  };
}

const mocked = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

/** Round-2 fix: drives the VISIBLE "Upload and validate" button — the one `handleUpload` actually
 *  ships for — rather than its dropdown twin, so this exercises the real wiring an operator uses.
 *  That button only renders on Mapping (step 2), so this presses Continue first when Source's own
 *  Continue button is still on screen (every caller reaches this straight after `pickFileAndSystem`,
 *  which never advances the step itself). Waits for Upload to become enabled first — the same
 *  discipline as `previewNow`, except Upload deliberately does NOT wait on `File.text()`: the File
 *  itself is the request body, so nothing has to be read before the action is live. */
async function uploadNow() {
  const continueButton = screen.queryByRole('button', { name: 'Continue' });
  if (continueButton) fireEvent.click(continueButton);
  const button = await screen.findByRole('button', { name: 'Upload and validate' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** Round-2 fix: the confirm-path equivalent of `uploadNow` above — drives the VISIBLE "Confirm
 *  import" button on Review (step 3), which `canConfirmRun` renders once a run's own validated
 *  summary is on screen. Every caller has already awaited something that only exists once that
 *  summary rendered, so the button is present synchronously here. */
function confirmNow() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
}

describe('ImportFacilitiesSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The ordinary setup for every test below: one registered source, so `pickFileAndSystem` (and
    // any test that opens the Select directly) has something to pick. The picklist's own tests
    // override this per-call with `mockResolvedValueOnce`/`mockResolvedValue` for the loading/empty/
    // error states a single persistent mock here cannot represent.
    mocked(api.listFacilityImportSources).mockResolvedValue([HFR_SOURCE]);
    // Task 8: `ColumnMapStep`'s own fetch, defaulted to "nothing to map" so it stays OFF SCREEN for
    // every test below that does not care about it — an empty `headers` never satisfies this sheet's
    // own render gate (`columnMapHeaders.length > 0`). Real usage never sees an empty array here (the
    // server 400s a header-less file), but every existing test's fixture CSV headers
    // (`local_code,name`) have no home in the 16-field contract, and a real column map would
    // therefore legitimately require the operator to map `national_code` before Preview/Apply would
    // ever be reachable in production — which is exactly the behaviour this task deliberately does
    // NOT gate on (see `ImportFacilitiesSheet.tsx`'s own note on `Preview` staying ungated). Tests
    // that exercise the panel itself override this per-call.
    mocked(api.suggestColumnMap).mockResolvedValue({ headers: [], columns: [] });
    mocked(api.suggestValueMappings).mockResolvedValue({ values: [], notValidated: false });
    mocked(api.writeFacilityValueMappings).mockResolvedValue({ written: 0, superseded: [] });
  });

  // ── B1 Task 9: the national-system picklist ─────────────────────────────────────────────────────

  it('B1 Task 9: renders a Select populated from the API, keeps Preview disabled until a source is chosen, and sends the URI — never the display name', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await waitFor(() => expect(api.listFacilityImportSources).toHaveBeenCalled());
    const trigger = await screen.findByRole('combobox', { name: 'National system' });
    await waitFor(() => expect(trigger).toBeEnabled());

    // Populated from the API — the fixture's DISPLAY NAME renders as the option's own text.
    fireEvent.click(trigger);
    expect(await screen.findByRole('option', { name: HFR_SOURCE.name })).toBeInTheDocument();
    // No option for the raw URI's own text — confirms the option's visible label really is `name`.
    expect(screen.queryByRole('option', { name: HFR_SOURCE.url })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' }); // close without picking

    // A file alone is not enough: Preview stays disabled with no register chosen.
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile()] } });
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^preview$/i })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: HFR_SOURCE.name }));

    await previewNow();
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1));
    // ⛔ THE WHOLE POINT: the source's URI reaches the request, never its display name.
    expect(api.importFacilitiesCsv).toHaveBeenCalledWith(expect.objectContaining({ nationalSystem: HFR_SOURCE.url }));
    expect(api.importFacilitiesCsv).not.toHaveBeenCalledWith(expect.objectContaining({ nationalSystem: HFR_SOURCE.name }));
  });

  it('B1 Task 9: disables the Select and shows a loading state while sources are still being fetched', async () => {
    let resolveSources!: (rows: FacilityRegisterSource[]) => void;
    mocked(api.listFacilityImportSources).mockReturnValue(
      new Promise((resolve) => { resolveSources = resolve; }),
    );
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    const trigger = await screen.findByRole('combobox', { name: 'National system' });
    expect(trigger).toBeDisabled();
    expect(screen.getByText(/loading registers/i)).toBeInTheDocument();

    resolveSources([HFR_SOURCE]);

    await waitFor(() => expect(trigger).toBeEnabled());
    expect(screen.queryByText(/loading registers/i)).not.toBeInTheDocument();
  });

  it('B1 Task 9: shows an empty-state hint, and keeps the Select disabled, when no registers are configured', async () => {
    mocked(api.listFacilityImportSources).mockResolvedValue([]);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    expect(await screen.findByText(/no facility registers are configured/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'National system' })).toBeDisabled();
  });

  // ⛔ Review fix (B1 Task 9, CRITICAL): the route this covers existed and was tested, but nothing in
  // the studio ever called it — a fresh install (no `national_system` values for migration 082's
  // back-fill to seed from) had a permanently empty picklist and facility import was unreachable
  // from the UI. This is the affordance that closes that gap end to end: menu → dialog → refreshed
  // picklist → SELECTABLE (here, actually selected) — not just "created and forgotten".
  it('B1 Task 9 review fix: "Register a source" refreshes the empty picklist and the new source becomes selectable', async () => {
    const NEW_SOURCE: FacilityRegisterSource = {
      id: 'cs-freg-new', url: 'urn:tz:hfr', name: 'Tanzania HFR', code: 'TZ_HFR',
      version: null, jurisdiction: null, contact: null, publisherId: null, active: true,
    };
    // Starts with NOTHING configured — the fresh-install case the finding describes.
    mocked(api.listFacilityImportSources).mockResolvedValueOnce([]);
    mocked(api.createFacilityImportSource).mockResolvedValue(NEW_SOURCE);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    expect(await screen.findByText(/no facility registers are configured/i)).toBeInTheDocument();

    // Task 5: "Register a source" is now ALSO the step's own visible primary action while no
    // register exists (the one deliberate exception to ui-actions-in-dots-menu) — it stays in the
    // ⋯ menu too, so either door opens the same dialog. This still exercises the menu door.
    expect(screen.getByRole('button', { name: 'Register a source' })).toBeInTheDocument();
    clickMenuItem(/register a source/i);

    expect(await screen.findByText('Register a facility source')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Canonical URI'), { target: { value: NEW_SOURCE.url } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: NEW_SOURCE.name } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: NEW_SOURCE.code } });

    // From here on, listFacilityImportSources answers as if the register now exists — exactly what
    // the real GET route would do after the real POST committed it.
    mocked(api.listFacilityImportSources).mockResolvedValue([NEW_SOURCE]);
    // ⛔ The dialog's OWN Register/Cancel are ALSO a ⋯ menu (ui-actions-in-dots-menu), not footer
    // buttons — a second, nested ⋯ interaction, distinct from the sheet's own menu above.
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Register source actions' }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' },
    );
    if (!screen.queryByRole('menu')) {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Register source actions' }), { key: 'Enter' });
    }
    fireEvent.click(screen.getByRole('menuitem', { name: /^register$/i }));

    await waitFor(() => expect(api.createFacilityImportSource).toHaveBeenCalledWith(
      expect.objectContaining({ url: NEW_SOURCE.url, name: NEW_SOURCE.name, code: NEW_SOURCE.code }),
    ));
    // The dialog closes on success.
    await waitFor(() => expect(screen.queryByText('Register a facility source')).not.toBeInTheDocument());

    // The picklist refreshed (the empty-state hint is gone) AND the just-registered source is
    // SELECTED, not merely present as an option the operator still has to go find.
    await waitFor(() => expect(screen.queryByText(/no facility registers are configured/i)).not.toBeInTheDocument());
    const trigger = screen.getByRole('combobox', { name: 'National system' });
    await waitFor(() => expect(trigger).toHaveTextContent(NEW_SOURCE.name));

    // ⛔ THE WHOLE POINT: Preview is now reachable — a file plus the just-registered source is enough
    // to import against it, which is exactly what "unreachable on a fresh install" denied before.
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile()] } });
    await previewNow();
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: NEW_SOURCE.url }),
    ));
  });

  it('never applies straight from the file picker — Preview is a dry run, Apply is not offered until one succeeds', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    const onImported = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={onImported} />);

    // Apply is not even offered before a preview has run.
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await pickFileAndSystem();
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
      .mockResolvedValueOnce(baseResult({ parsed: 3, create: 2, changed: 1, written: { created: 2, updated: 1, retired: 0 }, runId: 'run-1' }));
    const onImported = vi.fn();
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={onImported} />);

    await pickFileAndSystem();
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
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({ parsed: 0 }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('the quick brown fox');
    await previewNow();

    expect(await screen.findByText(/no facility rows were found/i)).toBeInTheDocument();
    // Nothing to confirm — the trap case must not offer Apply.
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('shows unknown columns with an explicit opt-in, naming the columns, and re-previews once checked', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({ parsed: 0, unknownColumns: ['weird_col', 'other_col'] }))
      .mockResolvedValueOnce(baseResult({ parsed: 3, create: 3, unknownColumns: ['weird_col', 'other_col'] }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/weird_col, other_col/)).toBeInTheDocument();
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowUnknownColumns: false }),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));

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
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 1, create: 1,
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      // What the server actually answers for a preview run WITHOUT the override — the sheet
      // previews before the checkbox is ever ticked.
      blocked: true, blockedReason: 'quarantined-rows',
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
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
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
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
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 2, create: 2, duplicateColumns: ['name'],
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      blocked: true, blockedReason: 'duplicate-columns',
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1));

    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    // The quarantine block is rendered (the file has both problems), so the checkbox is reachable —
    // and ticking it changes nothing, because the reason is the unoverridable one.
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('sends allowMalformedRows: true on Apply once the operator has opted in past quarantined rows', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({
        parsed: 1, create: 1,
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        // Preview, no override yet: the server says blocked.
        blocked: true, blockedReason: 'quarantined-rows',
      }))
      .mockResolvedValueOnce(baseResult({
        parsed: 1, create: 1,
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        // Apply, override sent: same file, not blocked.
        written: { created: 1, updated: 0, retired: 0 }, blocked: false, blockedReason: null,
      }));
    const onImported = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={onImported} />);

    await pickFileAndSystem();
    await previewNow();
    fireEvent.click(await screen.findByRole('checkbox', { name: /import anyway/i }));

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
      async (req: { allowMalformedRows: boolean }) => baseResult({
        parsed: 1, create: 1,
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        blocked: !req.allowMalformedRows,
        blockedReason: req.allowMalformedRows ? null : 'quarantined-rows',
      }),
    );
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    fireEvent.click(await screen.findByRole('checkbox', { name: /import anyway/i }));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('surfaces duplicates as a plainly-visible warning, not a buried number', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 5, create: 3, duplicates: 2,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/2 duplicate national code/i)).toBeInTheDocument();
  });

  it('a malformed-CSV 400 surfaces the server message and keeps the sheet open', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('import facilities failed: Invalid Record Length: columns length is 3, got 2 on line 4'),
    );
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={vi.fn()} />);

    await pickFileAndSystem();
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

    await pickFileAndSystem();
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
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 14000, create: 14000,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
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
      .mockResolvedValueOnce(baseResult({ parsed: 0, unknownColumns: ['patient_id', 'dob', 'sex'] }))
      .mockResolvedValueOnce(baseResult({ parsed: 0, skipped: 3000, unknownColumns: ['patient_id', 'dob', 'sex'] }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/patient_id, dob, sex/)).toBeInTheDocument();
    // Before opting in, unknown-columns-blocked is its own distinct explanation — the "wrong file"
    // message must not also render here (would be a second, confusing message for the same click).
    expect(screen.queryByText(/no facility rows were found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));

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

  // A2a (FAC-P1-03): the headline count and the apply-confirm body now come from the server's own
  // reconciliation (`create` + `changed`, the rows `classifyFacilityRows` says an apply would
  // actually write), not the old client-side `parsed - duplicates` approximation — a byte-identical
  // re-import collapses to `unchanged`, which `parsed - duplicates` had no way to know about.
  it('F3: the headline row count and the apply-confirm body reflect what the server classified as create+changed, not the raw parsed count', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 5, duplicates: 2, create: 2, changed: 1, unchanged: 2,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    // 2 create + 1 changed = 3 rows will actually land in the registry — NOT 5 parsed, and NOT
    // 5 - 2 duplicates (which would also read 3 here by coincidence; the point is the number now
    // comes from server classification, proven by the `unchanged` regression test below).
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/5 row\(s\) will be imported/i)).not.toBeInTheDocument();

    clickMenuItem(/^apply$/i);
    expect(await screen.findByText(/this writes 3 facility row\(s\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/this writes 5 facility row\(s\)/i)).not.toBeInTheDocument();
  });

  // The case `parsed - duplicates` could never have gotten right: a file with no in-file duplicates
  // at all (so the old formula would have reported the full `parsed` count) where most rows are
  // byte-identical re-imports of what the registry already holds.
  it('F3 regression: a byte-identical re-import (parsed rows are mostly `unchanged`) reports the small real write, not the full parsed count', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 100, duplicates: 0, create: 0, changed: 1, unchanged: 99,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/1 row\(s\) will be imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/100 row\(s\) will be imported/i)).not.toBeInTheDocument();
  });

  it('F4: the 8MB size-cap 400 gets the same plain-language treatment as the row cap, including on a plain preview', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('csv exceeds the 8MB limit for this endpoint; use `openldr facilities import` (the CLI) for a larger register'),
    );
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
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

    await pickFileAndSystem();
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

  // ── A2a (FAC-P1-03/05): the reconciliation summary ────────────────────────────────────────────

  it('renders the create/changed/unchanged breakdown the server classified, alongside the headline count', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 7, create: 2, changed: 1, unchanged: 4,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/2 facility row\(s\) will be created/i)).toBeInTheDocument();
    expect(screen.getByText(/1 existing facility row\(s\) will be changed/i)).toBeInTheDocument();
    expect(screen.getByText(/4 facility row\(s\) already match the registry/i)).toBeInTheDocument();
  });

  // ⛔ THE WHOLE POINT OF THIS SLICE: `conflict: null` must never read as "0 conflicts" — that is
  // precisely the "0 means not computed" defect the audit findings this task closes exist to remove.
  it('renders conflict: null as "not evaluated", never as 0', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, conflict: null,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/conflicts:.*not evaluated/i)).toBeInTheDocument();
    // The ONLY other way this branch could render for `conflict: null` is the real "0 rows" copy
    // (`summaryConflict`, en.ts) if the `=== null` check were weakened to `?? 0` — asserting against
    // `/conflicts:\s*0\b/i` here would never fail on that mutation, since the rendered copy never
    // starts with the word "conflicts" (see `summaryConflict`'s actual template below). Mutation-
    // tested directly: with the ternary replaced by `t('summaryConflict', { count: conflict ?? 0 })`,
    // this assertion alone (with assertion 1 disabled) failed on "found <p>0 row(s) were changed
    // since this preview and will be skipped.</p>" — proof it participates, not dead weight.
    expect(screen.queryByText(/0 row\(s\) were changed since this preview/i)).not.toBeInTheDocument();
  });

  // MINOR (whole-branch review): this test previously overclaimed a runId↔apply link it never
  // actually threaded through an apply — it renders a PREVIEW result carrying `conflict: 1` and only
  // asserts the summary text, nothing about `runId` reaching a subsequent apply request (that is
  // covered separately by "Apply carries the operator's retirement choices AND the runId a prior
  // preview returned" below). Renamed to what it actually tests: the non-zero-count rendering path,
  // as the counterpart to "renders conflict: null…" above.
  it('renders a non-zero conflict count from a preview result, distinct from the null "not evaluated" case', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 2, conflict: 1, absent: 5,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/1 row\(s\) were changed since this preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/not evaluated/i)).not.toBeInTheDocument();
  });

  // Same defect, same fix, for `absent`.
  it('renders absent: null as "not evaluated", never as 0', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, absent: null,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/absent from this file:.*not evaluated/i)).toBeInTheDocument();
    // Same reasoning as the conflict test above: the actual `summaryAbsent` copy (en.ts) never starts
    // with "absent from this file", so `/absent from this file:\s*0\b/i` could never match regardless
    // of whether `absent: null` were wrongly rendered as `0` — this asserts against the real 0-count
    // sentence instead.
    expect(screen.queryByText(/0 registry row\(s\) for this national system are absent from this file/i)).not.toBeInTheDocument();
  });

  it('a changed-row sample shows the before→after diff, not just a bare count', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 1, changed: 1,
      samples: {
        create: [], conflict: [], absent: [], deleted: [],
        changed: [{
          id: 'f1', nationalCode: 'C1', name: 'Dodoma RRH',
          diff: [{ field: 'name', before: 'Dodoma Regional', after: 'Dodoma RRH' }],
        }],
      },
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    // The facility name heads the sample entry; the diff line beneath it shows the actual
    // before→after change — both "Dodoma RRH" occurrences (the heading AND the diff's `after`) are
    // expected, so this asserts on the combined diff line rather than a name fragment that would
    // otherwise match twice.
    expect(await screen.findByText(/name: Dodoma Regional → Dodoma RRH/)).toBeInTheDocument();
  });

  it('retirement choices for deleted/absent rows stay off the sheet entirely when there is nothing to retire', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, deleted: 0, absent: 0,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(screen.queryByRole('combobox', { name: /rows this file says were removed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /rows missing from this file/i })).not.toBeInTheDocument();
    // `runId` is `null` (the baseResult default, not overridden here) — this preview minted no run
    // for an apply to link back to, so there is nothing to overwrite either (see CT-3's gating below).
    expect(screen.queryByRole('combobox', { name: /rows changed since this preview/i })).not.toBeInTheDocument();
  });

  // CT-3 (whole-branch review): UNLIKE onDeleted/onAbsent above, the overwrite-conflicts choice is
  // NOT gated on `conflict` being a non-zero number — it can't be. A fresh standalone preview's own
  // `conflict` is ALWAYS `null` (there is no PRIOR preview's watermark for it to compare against —
  // see facility-import.ts's `conflictsEvaluated`), so gating on "conflict > 0" here could never
  // actually show the control: that is exactly the CT-3 defect (the control was structurally
  // unreachable). It is gated on `runId` instead — an apply carrying this runId is what could later
  // discover a conflict, and the operator must set skip/overwrite BEFORE that happens.
  it('offers an overwrite choice once a preview has minted a runId, defaulting to Skip', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 2, conflict: null, runId: 'run-1',
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    const select = await screen.findByRole('combobox', { name: /rows changed since this preview/i });
    expect(select).toBeInTheDocument();
    expect(await screen.findByText(/skip them/i)).toBeInTheDocument();
  });

  // The mirror image, and the direct proof the gating is on `runId`, not on `conflict`: a non-zero
  // `conflict` with NO `runId` still hides the choice — a shape a real preview could never actually
  // produce (conflict is null without a runId), but proves the predicate this sheet reads.
  it('the overwrite choice stays off the sheet without a runId, even with a non-zero conflict', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, conflict: 1, runId: null,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(screen.queryByRole('combobox', { name: /rows changed since this preview/i })).not.toBeInTheDocument();
  });

  it('offers a retirement choice for declared-removed rows once `deleted` is non-zero, defaulting to Retire', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, deleted: 2,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByRole('combobox', { name: /rows this file says were removed/i })).toBeInTheDocument();
    // `absent` is null here (not evaluated) — its own choice must not appear even though `deleted`'s does.
    expect(screen.queryByRole('combobox', { name: /rows missing from this file/i })).not.toBeInTheDocument();
  });

  it('offers a retirement choice for merely-absent rows once `absent` is a non-zero number, defaulting to Report only', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, absent: 4, deleted: 0,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByRole('combobox', { name: /rows missing from this file/i })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /rows this file says were removed/i })).not.toBeInTheDocument();
  });

  it('Apply carries the operator\'s retirement choices AND the runId a prior preview returned', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({
        parsed: 3, create: 1, changed: 1, unchanged: 1, deleted: 2, absent: 3, runId: 'run-42',
      }))
      .mockResolvedValueOnce(baseResult({
        parsed: 3, written: { created: 1, updated: 1, retired: 0 }, runId: 'run-42',
      }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    // Flip both retirement choices away from their defaults so the assertion below cannot pass by
    // coincidence (the default 'retire'/'report' values would also satisfy an assertion that
    // forgot to check the field was even threaded through).
    fireEvent.click(await screen.findByRole('combobox', { name: /rows this file says were removed/i }));
    fireEvent.click(await screen.findByRole('option', { name: /report only/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /rows missing from this file/i }));
    fireEvent.click(await screen.findByRole('option', { name: /retire them/i }));

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apply: true, runId: 'run-42', onDeleted: 'report', onAbsent: 'retire',
      }),
    );
  });

  it('Apply carries the operator\'s overwrite-conflicts choice, distinct from the default skip', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({
        parsed: 3, create: 2, conflict: 1, runId: 'run-43',
      }))
      .mockResolvedValueOnce(baseResult({
        parsed: 3, written: { created: 2, updated: 1, retired: 0 }, conflict: 1, runId: 'run-43',
      }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    // Flip away from the default 'skip' so the assertion below cannot pass by coincidence (sending
    // the default value would also satisfy an assertion that forgot to check the field was even
    // threaded through — the same discipline the retirement-choices test above already applies).
    fireEvent.click(await screen.findByRole('combobox', { name: /rows changed since this preview/i }));
    fireEvent.click(await screen.findByRole('option', { name: /overwrite them/i }));

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ apply: true, runId: 'run-43', onConflict: 'overwrite' }),
    );
  });

  it('Apply sends the default onConflict: skip when the operator never touches the control', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({ parsed: 3, create: 2, conflict: 1, runId: 'run-44' }))
      .mockResolvedValueOnce(baseResult({ parsed: 3, written: { created: 2, updated: 0, retired: 0 }, conflict: 1, runId: 'run-44' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ apply: true, onConflict: 'skip' }),
    );
  });

  it('warns, informationally, that an unrecognised national system will create a new register identity', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3, knownNationalSystem: false,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/new register identity/i)).toBeInTheDocument();
    // Informational only — Apply must still be offered.
    openMenu();
    expect(screen.getByRole('menuitem', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('the applied-result summary reads written.created/written.updated, not a flat created/updated', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cleanPreview)
      .mockResolvedValueOnce(baseResult({ parsed: 3, written: { created: 2, updated: 1, retired: 0 }, skipped: 0 }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();
    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText(/created 2, updated 1, skipped 0/i)).toBeInTheDocument();
  });

  // ── CT-3 (whole-branch review): the whole preview surface actually reaches the wire ────────────

  it('CT-3: sends format/completeRelease/releaseVersion on preview, and the SAME values again on apply', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({ parsed: 3, create: 3, runId: 'run-9' }))
      .mockResolvedValueOnce(baseResult({ parsed: 3, written: { created: 3, updated: 0, retired: 0 }, runId: 'run-9' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    // Continue advances to Mapping — Source, format/complete-release/release-version, is where the
    // sheet stays until the operator presses it. Set these before ever leaving Source.
    fireEvent.click(screen.getByRole('combobox', { name: /file format/i }));
    fireEvent.click(await screen.findByRole('option', { name: /jsonl release/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /this file is a complete release/i }));
    fireEvent.change(screen.getByLabelText('Release version'), { target: { value: 'r7' } });

    await previewNow();
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(1));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'jsonl', completeRelease: true, releaseVersion: 'r7', apply: false }),
    );

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    // THE FIX: before this task the apply request never sent `format`/`completeRelease` at all, so
    // an apply linked to a JSONL-release preview would have the server parse it as CSV instead.
    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({
        format: 'jsonl', completeRelease: true, releaseVersion: 'r7', apply: true, runId: 'run-9',
      }),
    );
  });

  it('CT-3: renders invalid-coordinate rows with line numbers, and the override re-previews (like allowUnknownColumns, unlike allowMalformedRows)', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({
        parsed: 1, create: 1,
        invalid: [{ line: 2, field: 'latitude', reason: 'out_of_range', raw: '95.0' }],
      }))
      .mockResolvedValueOnce(baseResult({ parsed: 2, create: 2 }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/rows with an invalid coordinate/i)).toBeInTheDocument();
    expect(screen.getByText(/1 row has a coordinate/i)).toBeInTheDocument();
    expect(screen.getByText(/line 2 — latitude: 95\.0/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));

    await waitFor(() => expect(api.importFacilitiesCsv).toHaveBeenCalledTimes(2));
    expect(api.importFacilitiesCsv).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowInvalidCoordinates: true }),
    );
    expect(await screen.findByText(/2 row\(s\) will be imported/i)).toBeInTheDocument();
  });

  // Task 8: this used to assert a static warning sentence — `ValueMapPanel` now renders that same
  // spot as an interactive picker (see ImportFacilitiesSheet.tsx's comment on why the heading copy
  // is unchanged). The `notValidated` half of this test is untouched: that stays the sheet's own
  // plain informational line, not part of the panel.
  it('CT-3/Task 8: renders one pick-list row per unmapped controlled-field value, and which fields could not be validated at all', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 3, create: 3,
      unmapped: { level: ['Zonal Hospital', 'District Clinic'], status: [], country: [] },
      notValidated: ['status'],
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/values with no canonical mapping/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Zonal Hospital')).toHaveTextContent('Not mapped');
    expect(screen.getByLabelText('District Clinic')).toHaveTextContent('Not mapped');
    expect(screen.getByText(/not checked against a canonical value set.*Status/i)).toBeInTheDocument();
  });

  it('CT-3: renders a JSONL release\'s declared/parsed count mismatch', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      parsed: 2998, create: 2998,
      countMismatch: [{ field: 'rowCount', declared: 3000, parsed: 2998 }],
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    expect(await screen.findByText(/declared counts do not match/i)).toBeInTheDocument();
    expect(screen.getByText(/this release declares 3000 row\(s\); 2998 were actually parsed/i)).toBeInTheDocument();
  });

  // ── CT-3: the apply result finally shows what happened to conflicting rows ──────────────────────
  // Before this fix, a row edited between preview and apply was classified `conflict`, skipped (or
  // overwritten) by the write, and then vanished from the screen entirely: the applied-result block
  // rendered only `written.created`/`written.updated`/`skipped`. This is the FAC-P1-03 defect class
  // this whole branch exists to close, surviving in the UI.

  it('CT-3: the apply result shows the conflict count and sample when rows were skipped (the default policy)', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({ parsed: 3, create: 3, runId: 'run-5' }))
      .mockResolvedValueOnce(baseResult({
        parsed: 3, written: { created: 0, updated: 1, retired: 0 }, conflict: 2, runId: 'run-5',
        samples: { create: [], changed: [], absent: [], deleted: [], conflict: [{ id: 'f1', nationalCode: 'C1', name: 'Dodoma RRH' }] },
      }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();
    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText(/2 row\(s\) changed since the preview were left as-is/i)).toBeInTheDocument();
    expect(screen.getByText(/Dodoma RRH \(C1\)/)).toBeInTheDocument();
  });

  it('CT-3: the apply result honestly says "overwritten", not "skipped", once the operator chose overwrite', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(baseResult({ parsed: 3, create: 2, conflict: null, runId: 'run-6' }))
      .mockResolvedValueOnce(baseResult({
        parsed: 3, written: { created: 0, updated: 1, retired: 0 }, conflict: 1, runId: 'run-6',
        samples: { create: [], changed: [], absent: [], deleted: [], conflict: [{ id: 'f1', nationalCode: 'C1', name: 'Dodoma RRH' }] },
      }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();

    fireEvent.click(await screen.findByRole('combobox', { name: /rows changed since this preview/i }));
    fireEvent.click(await screen.findByRole('option', { name: /overwrite them/i }));

    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText(/1 row\(s\) changed since the preview were overwritten by this import/i)).toBeInTheDocument();
    expect(screen.queryByText(/were left as-is/i)).not.toBeInTheDocument();
  });

  it('CT-3: the apply result stays silent about conflicts when there were none', async () => {
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cleanPreview)
      .mockResolvedValueOnce(baseResult({ parsed: 3, written: { created: 3, updated: 0, retired: 0 } }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await previewNow();
    clickMenuItem(/^apply$/i);
    fireEvent.click(await screen.findByRole('button', { name: /^apply$/i }));

    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/changed since the preview/i)).not.toBeInTheDocument();
  });

  // ── A2b Task 8: the background path — upload → poll → review → confirm ────────────────────────
  //
  // The inline Preview/Apply path above is UNCHANGED and still tested by everything before this
  // line: it is the small-register door (bounded by the server's 2 000-row inline cap) and A2a's
  // reconciliation rendering lives on it. What follows is the second door — the one that lifts that
  // cap by handing a streamed file to a worker.

  it('A2b: Upload streams the File itself (never its text) and moves the sheet onto the run it minted', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating', phase: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    // format/release-version live on Source — set them before Continue ever moves the sheet on.
    fireEvent.click(screen.getByRole('combobox', { name: /file format/i }));
    fireEvent.click(await screen.findByRole('option', { name: /jsonl release/i }));
    fireEvent.change(screen.getByLabelText('Release version'), { target: { value: 'r7' } });

    await uploadNow();

    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    // ⛔ `expect.any(File)` is the assertion that matters: the browser hands the File over as the
    // request body. A `csv: '<string>'` here would be the `f.text()` path this task removes.
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.any(File), nationalSystem: 'HFR', format: 'jsonl', releaseVersion: 'r7',
      }),
      expect.any(Function),
    );
    // The background door is not the inline one: nothing was POSTed to /api/facilities/import.
    expect(api.importFacilitiesCsv).not.toHaveBeenCalled();

    await waitFor(() => expect(api.getFacilityImportRun).toHaveBeenCalledWith('run-b1'));
    expect(await screen.findByText(/validating the uploaded file/i)).toBeInTheDocument();
    expect(screen.getByText('Phase: validating')).toBeInTheDocument();
  });

  it('A2b: a run that reaches awaiting_confirmation renders A2a\'s reconciliation summary and offers Confirm', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation', phase: 'validated',
      // What the validate phase actually stores: `importFacilities`' own result, run with
      // `apply: false` and NO `previewedAt` — so `conflict` is null (NOT EVALUATED), never 0.
      summary: baseResult({ parsed: 7, create: 2, changed: 1, unchanged: 4, conflict: null, absent: null }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/review the summary below/i)).toBeInTheDocument();
    // The SAME summary rendering the inline preview uses — not a second, drifting copy of it.
    expect(screen.getByText(/2 facility row\(s\) will be created/i)).toBeInTheDocument();
    expect(screen.getByText(/1 existing facility row\(s\) will be changed/i)).toBeInTheDocument();
    expect(screen.getByText(/4 facility row\(s\) already match the registry/i)).toBeInTheDocument();
    expect(screen.getByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();
    // ⛔ null is NOT EVALUATED, on this path exactly as on the inline one. The counter-assertion is
    // the real 0-count sentence (`summaryConflict`/`summaryAbsent`, en.ts), because those templates
    // never begin with the words the positive assertions match — see the inline tests above.
    expect(screen.getByText(/conflicts:.*not evaluated/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 row\(s\) were changed since this preview/i)).not.toBeInTheDocument();
    expect(screen.getByText(/absent from this file:.*not evaluated/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 registry row\(s\) for this national system are absent from this file/i)).not.toBeInTheDocument();

    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Confirm import' })).toBeInTheDocument();
  });

  it('A2b: Confirm carries the operator\'s retirement and conflict choices to the run', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({ parsed: 3, create: 1, changed: 1, unchanged: 1, deleted: 2, absent: 3 }),
    }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    // Flipped away from every default, so the assertion below cannot pass on values the sheet never
    // threaded through — the same discipline the inline retirement-choices test applies.
    fireEvent.click(await screen.findByRole('combobox', { name: /rows this file says were removed/i }));
    fireEvent.click(await screen.findByRole('option', { name: /report only/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /rows missing from this file/i }));
    fireEvent.click(await screen.findByRole('option', { name: /retire them/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /rows changed since this preview/i }));
    fireEvent.click(await screen.findByRole('option', { name: /overwrite them/i }));

    confirmNow();

    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith(
      'run-b1',
      expect.objectContaining({ onDeleted: 'report', onAbsent: 'retire', onConflict: 'overwrite' }),
    );
  });

  it('A2b: a blocked run withholds Confirm until the operator opts past the quarantined rows', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    // The validate runs with the UPLOAD's options (the register identity, plus `completeRelease`
    // when the operator declared one — see the worker's `validateOptions`). None of the three
    // `allow*` overrides can be among them: those are the CONFIRM step's. So the stored verdict is
    // always the UN-overridden baseline the checkbox toggles against, exactly like the inline path's
    // pinned `allowMalformedRows: false` preview.
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 1, create: 1,
        quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
        blocked: true, blockedReason: 'quarantined-rows',
      }),
    }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/line 3/i)).toBeInTheDocument();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Confirm import' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    clickMenuItem('Confirm import');

    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith(
      'run-b1', expect.objectContaining({ allowMalformedRows: true }),
    );
  });

  // ⛔ THE HONESTY RULE OF THE CANCEL ROUTE. A worker holding the run answers 202 `requested`: the
  // flag is observed only at phase boundaries and cannot interrupt the running transaction, so the
  // import may still finish `applied`. Saying "cancelled" here would tell an operator a national
  // register had not been written when it may well have been.
  it('A2b: a cancel a worker merely *requested* says cancelling, never cancelled', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'applying', phase: 'applying' }));
    mocked(api.cancelFacilityImportRun).mockResolvedValue({ runId: 'run-b1', outcome: 'requested' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    expect(await screen.findByText(/writing the register/i)).toBeInTheDocument();

    clickMenuItem('Cancel this import');

    await waitFor(() => expect(api.cancelFacilityImportRun).toHaveBeenCalledWith('run-b1'));
    expect(await screen.findByText(/cancellation requested/i)).toBeInTheDocument();
    expect(screen.queryByText(/cancelled before anything was written/i)).not.toBeInTheDocument();
  });

  it('A2b: a cancel the server actually carried out (200) does say cancelled', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({ status: 'awaiting_confirmation', summary: baseResult({ parsed: 3, create: 3 }) }))
      .mockResolvedValue(runView({ status: 'cancelled', error: 'cancelled by the operator' }));
    mocked(api.cancelFacilityImportRun).mockResolvedValue({ runId: 'run-b1', outcome: 'cancelled' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/3 facility row\(s\) will be created/i);

    clickMenuItem('Cancel this import');

    // ⚠ `waitFor` + `getByText`, deliberately not `findByText`. A 200 cancel on a parked run renders
    // this copy TWICE over, in two different elements: first from the outcome banner (the run this
    // sheet holds still says `awaiting_confirmation` for one render), then from the terminal block
    // once the refresh poll reports `cancelled`. `findByText` resolves with the first NODE and the
    // re-render detaches it, so `toBeInTheDocument()` then fails against a node that was correct when
    // it was found — measured, and it is a property of the assertion, not of the sheet.
    await waitFor(() => expect(screen.getByText(/cancelled before anything was written/i)).toBeInTheDocument());
    expect(screen.queryByText(/cancellation requested/i)).not.toBeInTheDocument();
  });

  it('A2b: Cancel is offered only while the run is still live', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'applied', summary: baseResult({ parsed: 3, written: { created: 3, updated: 0, retired: 0 } }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    // No run at all yet — nothing to cancel.
    // ⚠ The POSITIVE control on each of the two open menus below. Two `queryByRole` absences on a
    // menu that never actually opened would pass for the wrong reason and prove nothing; asserting
    // an item that IS there in the same open menu is what makes the absence beside it mean
    // something. (`Upload and validate` here, `Close` after the run finished — the close item's own
    // label switches to Close once `runFinished`.)
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Upload and validate' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancel this import' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/created 3, updated 0, skipped 0/i);

    // …and a finished run cannot be cancelled either (the route 409s), so it is not offered.
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancel this import' })).not.toBeInTheDocument();
  });

  // ⛔ A CONFIRM IS NOT A PROMISE THE APPLY RUNS. `confirmed` is supersedable (a queue head no worker
  // has reached yet), so a newer upload of the same register can take the run over: the operator got
  // a 202 and the run then ends `failed`. They only ever see that if the sheet keeps polling.
  it('A2b: a confirmed run that is superseded before a worker claims it surfaces the failure, not silence', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({ status: 'awaiting_confirmation', summary: baseResult({ parsed: 3, create: 3 }) }))
      .mockResolvedValue(runView({ status: 'failed', error: 'superseded by a newer upload' }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/3 facility row\(s\) will be created/i);

    confirmNow();

    expect(await screen.findByText(/this import did not finish/i)).toBeInTheDocument();
    expect(screen.getByText(/superseded by a newer upload/i)).toBeInTheDocument();
  });

  // ⚠ `total`/`processed` are published ONLY for an apply of ≥5 000 rows (the worker's measured
  // `PER_ROW_PROGRESS_MIN_ROWS`), so for most runs there is no denominator at all. The phase is what
  // is always there, and a progress readout that renders a broken-looking bar without a total would
  // be motion rather than information.
  it('A2b: progress is phase-first — no row counts when the worker published no total', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'applying', phase: 'applying', processed: 0, total: null,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText('Phase: applying')).toBeInTheDocument();
    expect(screen.queryByText(/row\(s\) processed/i)).not.toBeInTheDocument();
  });

  it('A2b: …and the row counts appear once the worker published a total', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'applying', phase: 'applying', processed: 5000, total: 13000,
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/5000 of 13000 row\(s\) processed/i)).toBeInTheDocument();
  });

  // ⛔ THE ENTIRE PRODUCT POINT OF A2b. `APPLY_ROW_CAP` mirrors the INLINE route's 2 000-row cap; the
  // background path has no row cap at all, so a national register must be confirmable here — the
  // inline path's over-cap notice must NOT appear, and Confirm must be offered.
  it('A2b: a 14 000-row register is confirmable on the background path — the inline row cap does not gate it', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({ parsed: 14000, create: 14000 }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/14000 facility row\(s\) will be created/i)).toBeInTheDocument();
    expect(screen.queryByText(/too large to apply/i)).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Confirm import' })).toBeInTheDocument();
  });

  it('A2b: an applied run renders the written summary and reloads the caller\'s list exactly once', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'applied',
      summary: baseResult({ parsed: 3, written: { created: 2, updated: 1, retired: 0 }, skipped: 0 }),
    }));
    const onImported = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={onImported} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/created 2, updated 1, skipped 0/i)).toBeInTheDocument();
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it('A2b: the upload 413 gets plain language, not the server\'s byte-count sentence', async () => {
    mocked(api.uploadFacilityImport).mockRejectedValue(
      new Error('the register file exceeds the 67108864-byte upload limit'),
    );
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/larger than the upload limit/i)).toBeInTheDocument();
    expect(screen.queryByText(/67108864-byte/)).not.toBeInTheDocument();
  });

  // The positive half of the StrictMode test's "never sticks on checking" assertion: this copy has
  // to be reachable at all, or asserting its ABSENCE below would prove nothing.
  it('A2b: the sheet says it is checking the run while the first poll is still in flight', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockReturnValue(new Promise<never>(() => { /* never settles */ }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/checking the import run/i)).toBeInTheDocument();
  });

  // ⚠ EVERY OTHER TEST IN THIS FILE MOUNTS BARE, so a `<StrictMode>`-only defect is invisible —
  // and polling is exactly the shape that breaks under it. StrictMode double-invokes effects while
  // PRESERVING refs, so the "mounted ref set false in the cleanup" idiom used elsewhere in this app
  // would leave the first cleanup permanently disarming every later poll: the sheet would sit on
  // "checking the import run" for good. This mounts under StrictMode and asserts it does not.
  it('A2b: polling survives StrictMode\'s double-invoked effects — the sheet never sticks on "checking"', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({ parsed: 5, create: 5 }),
    }));
    render(
      <StrictMode>
        <ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />
      </StrictMode>,
    );

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/5 facility row\(s\) will be created/i)).toBeInTheDocument();
    expect(screen.queryByText(/checking the import run/i)).not.toBeInTheDocument();
  });

  // ── A2b Task 8, review fixes ──────────────────────────────────────────────────────────────────

  // ⛔ THE COMPLETE-RELEASE DECLARATION MUST REACH THE BACKGROUND DOOR. Absence is classified during
  // the VALIDATE phase, off the run's stored `options`, so this parameter is the only thing that can
  // ever make a background run report an `absent` count instead of `null`. Without it the sheet told
  // an operator who had just ticked this box to "mark this file as a complete release" — and the
  // register too large for the inline route is exactly the national complete release this matters
  // for.
  it('A2b: a complete-release declaration reaches the upload — and is absent from the request when nobody made it', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating', phase: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    // The complete-release checkbox lives on Source — set it before Continue ever moves the sheet on.
    fireEvent.click(screen.getByRole('checkbox', { name: /this file is a complete release/i }));
    await uploadNow();

    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: 'HFR', completeRelease: true }),
      expect.any(Function),
    );
    // The counter-assertion, and the reason `completeRelease: true` above cannot pass by accident:
    // an untouched checkbox sends `false`, never `true` — the client then leaves the query parameter
    // off entirely (see `uploadFacilityImport`), so the run records no declaration at all.
    expect(api.uploadFacilityImport).not.toHaveBeenCalledWith(
      expect.objectContaining({ completeRelease: false }), expect.any(Function),
    );
  });

  it('A2b: …and an undeclared upload sends completeRelease false, so nothing is recorded for it', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating', phase: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ completeRelease: false }), expect.any(Function),
    );
  });

  // ⛔ THE CONFIRM CARRIES ONLY CHOICES SOMEBODY COULD HAVE MADE. Every field of the confirm body is
  // optional precisely so the server records nothing an operator did not send (see `ConfirmSchema`
  // and `FacilityImportConfirmOptions`); those keys land in durable `facility_import_runs.options`
  // AND in the `facility.import.confirmed` audit metadata. This run's summary has nothing deleted,
  // `absent` NOT EVALUATED and no unknown columns / quarantined rows / invalid coordinates, so none
  // of those five controls rendered — only the conflict policy did.
  it('A2b: Confirm sends only the choices whose control the operator was actually shown', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({ parsed: 3, create: 3, deleted: 0, absent: null }),
    }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/3 facility row\(s\) will be created/i);
    // The five controls really are off screen — otherwise the exact-body assertion below would be
    // asserting the absence of keys for controls that simply happened not to be looked for.
    expect(screen.queryByRole('combobox', { name: /rows this file says were removed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /rows missing from this file/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /import anyway/i })).not.toBeInTheDocument();

    confirmNow();

    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    // ⛔ EXACT object, not `objectContaining`: the whole point is which keys are ABSENT.
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith('run-b1', { onConflict: 'skip' });
  });

  // ⛔ THE SAME RULE FROM THE OTHER SIDE, AND THE HALF THAT ACTUALLY LOSES DATA: a control that DID
  // render must have its value SENT, and one that did NOT render must not be. `allowMalformedRows`
  // renders in its own amber block ABOVE the summary's `result.parsed > 0` wrapper, on its own list
  // alone — so `parsed === 0` is no evidence whatever that it was off screen, and a body built behind
  // a blanket `parsed === 0 ⇒ {}` dropped it. Both cases below are routine, not corners.
  //
  // This one is the CSV unknown-column shape: `facility-import.ts` blocks the whole parse on an
  // unrecognised header (`parsed`/`skipped` both 0) but does NOT set a `blockedReason` — only
  // `duplicate-columns` and `quarantined-rows` do — so `canConfirmRun` is true, Confirm is on the
  // menu, and the amber box is on screen.
  //
  // ⚠ THIS TEST USED TO TICK A CHECKBOX AND ASSERT `{ allowUnknownColumns: true }` WAS SENT. That
  // body was a guaranteed 409: the confirm route refuses a parse-changing override exactly when the
  // stored summary shows the file contains the thing it waves through, which is the SAME condition
  // that renders this box. The checkbox is gone from the run door; what replaces it is asserted here
  // and, for the working half, in the re-upload test below.
  it('A2b: a CSV register with an unrecognised column is completable at parsed 0 — through the RE-UPLOAD, never Confirm', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    // ⛔ `blocked: true, blockedReason: 'unknown-columns'` — this used to be `false`/`null`, which
    // is exactly the defect the Zambia team hit: nothing blocked, so Confirm was offered, and the
    // apply parsed nothing, wrote nothing and reported `applied` behind a green success box. The
    // register was always "completable at parsed 0"; it just was never Confirm that completed it.
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 0, unknownColumns: ['ward_code'], blocked: true, blockedReason: 'unknown-columns',
      }),
    }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    // The premise, asserted rather than assumed: the amber notice really IS rendered at `parsed: 0`.
    expect(await screen.findByText(/ward_code/)).toBeInTheDocument();
    // ⛔ …and the tick that could only 409 is gone, replaced by the path that actually works.
    expect(screen.queryByRole('checkbox', { name: /keeping unrecognised columns/i })).not.toBeInTheDocument();
    expect(screen.getByText(/has to be set before validation/i)).toBeInTheDocument();
    openMenu();
    // ⛔ The completable path IS offered...
    expect(screen.getByRole('menuitem', { name: 'Re-upload keeping unrecognised columns' })).toBeInTheDocument();
    // ...and the one that could only ever write nothing is NOT. `canConfirmRun` reads the same
    // `blocked` verdict the confirm route enforces, so the studio and the server now agree about
    // this file instead of the studio offering what the server would refuse.
    expect(screen.queryByRole('menuitem', { name: 'Confirm import' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(api.confirmFacilityImportRun).not.toHaveBeenCalled();
  });

  // ── The other half of the Zambia report: even reached through the API or the CLI, an apply that
  // parsed nothing must not be dressed as a success. ──────────────────────────────────────────────

  it('⛔ an applied run that wrote nothing does not claim the import completed', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'applied',
      summary: baseResult({
        parsed: 0, skipped: 0, unknownColumns: ['ward_code'],
        written: { created: 0, updated: 0, retired: 0 },
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    // "Import complete. Created 0, updated 0, skipped 0." was the screenshot the operator sent.
    expect(await screen.findByText(/nothing was imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/import complete/i)).not.toBeInTheDocument();
  });

  it('still reports a real write as a completed import', async () => {
    // The guard above must key on "wrote nothing", not on "a run finished" — or it would swallow
    // every successful import too.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'applied',
      summary: baseResult({ parsed: 3, written: { created: 3, updated: 0, retired: 0 } }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing was imported/i)).not.toBeInTheDocument();
  });

  // ⛔ THE COMPLETABLE PATH ITSELF. Before this, a CSV register with one unrecognised column could be
  // finished only from a shell — tick the box and the confirm 409s telling the operator to re-upload
  // with an option the studio's upload did not expose; leave it and the apply parses nothing, writes
  // nothing and still reports `applied`. This is the affordance that 409 names.
  it('A2b: the run door re-uploads the same file with allowUnknownColumns, so the validate reviewed is the one applied', async () => {
    mocked(api.uploadFacilityImport)
      .mockResolvedValueOnce({ runId: 'run-b1' })
      .mockResolvedValueOnce({ runId: 'run-b2' });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({
        id: 'run-b1', status: 'awaiting_confirmation',
        summary: baseResult({ parsed: 0, unknownColumns: ['ward_code'] }),
      }))
      // ⛔ The re-upload's own run is asked for and NEVER ANSWERS. That is what makes the assertions
      // at the end of this test discriminating: the only thing that can clear the superseded run's
      // summary in that window is the sheet dropping it itself (`setRun(null)` in `handleUpload`).
      // With a mock that answers promptly, a poll would replace `run` either way and the assertion
      // would pass whether or not the sheet dropped anything — measured, it did.
      .mockReturnValue(new Promise<never>(() => { /* never settles */ }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/ward_code/);

    // The FIRST upload carried no override — otherwise the second assertion below would be measuring
    // a value that was always there.
    expect(api.uploadFacilityImport).toHaveBeenNthCalledWith(
      1, expect.objectContaining({ allowUnknownColumns: false }), expect.any(Function),
    );

    clickMenuItem('Re-upload keeping unrecognised columns');

    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(2));
    // ⛔ The SAME file and register, with the override on the UPLOAD — the request that runs before
    // the classification, so the summary the operator reviews next is the one that gets applied.
    expect(api.uploadFacilityImport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ nationalSystem: 'HFR', format: 'csv', allowUnknownColumns: true }),
      expect.any(Function),
    );
    // ⛔ And the superseded run's summary — with its Confirm — leaves the screen rather than inviting
    // a decision about a run the register no longer belongs to.
    expect(await screen.findByText(/checking the import run/i)).toBeInTheDocument();
    expect(screen.queryByText(/ward_code/)).not.toBeInTheDocument();
    openMenu();
    // Positive control on the same open menu, so the absence beside it means something.
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Confirm import' })).not.toBeInTheDocument();
  });

  // ⛔ THE FORMAT-BLIND HALF OF THE SAME FINDING. `allowUnknownColumns` is a documented NO-OP for
  // JSONL (`parseFacilityRelease` never reads it), so a release that merely GREW a field must not be
  // offered a re-upload that would change nothing — and the confirm route's own gate skips its
  // refusal on the same asymmetry.
  it('A2b: a JSONL release with an unrecognised field is told it was kept, and offered no pointless re-upload', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      sourceFormat: 'jsonl',
      status: 'awaiting_confirmation',
      summary: baseResult({ parsed: 4, create: 4, unknownColumns: ['ward_code'] }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/do not block a JSONL release/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is imported unless you opt in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/has to be set before validation/i)).not.toBeInTheDocument();
    openMenu();
    // The positive control, so the two absences below are not those of a menu that never opened.
    expect(screen.getByRole('menuitem', { name: 'Confirm import' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Re-upload keeping unrecognised columns' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /keeping unrecognised columns/i })).not.toBeInTheDocument();
  });

  // The invalid-coordinate half: no format branch (both parsers honour it), and once the run HAS run
  // with it there is nothing left to re-upload for — the box says so instead of offering a second
  // identical upload.
  it('A2b: the invalid-coordinate override is a re-upload too, and disappears once the run already ran with it', async () => {
    mocked(api.uploadFacilityImport)
      .mockResolvedValueOnce({ runId: 'run-b1' })
      .mockResolvedValueOnce({ runId: 'run-b2' });
    const summary = baseResult({
      parsed: 2, create: 2,
      invalid: [{ line: 3, field: 'latitude', reason: 'out_of_range', raw: '999' }],
    });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({ id: 'run-b1', status: 'awaiting_confirmation', summary }))
      .mockResolvedValue(runView({
        id: 'run-b2', status: 'awaiting_confirmation', summary,
        options: { nationalSystem: 'HFR', allowInvalidCoordinates: true },
      }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    expect(await screen.findByText(/has to be set before validation/i)).toBeInTheDocument();

    clickMenuItem('Re-upload keeping rows with an invalid coordinate');

    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(2));
    expect(api.uploadFacilityImport).toHaveBeenNthCalledWith(
      2, expect.objectContaining({ allowInvalidCoordinates: true }), expect.any(Function),
    );

    // The second run's stored options say the validate ran with it, so the notice changes and the
    // menu item retires — a second identical upload would change nothing.
    expect(await screen.findByText(/already ran with that option on/i)).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Confirm import' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Re-upload keeping rows with an invalid coordinate' })).not.toBeInTheDocument();
  });

  // …and the second reachable shape: a file whose every row was quarantined parses 0 rows too, with
  // its own override on screen (that override is what clears `blockedReason: 'quarantined-rows'` and
  // puts Confirm on the menu at all — so it demonstrably rendered).
  it('A2b: Confirm carries the malformed-rows override when every row was quarantined (parsed 0)', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 0,
        quarantined: [{ line: 2, raw: '1,Bad,Extra,Column', reason: 'too_many_fields' }],
        blocked: true, blockedReason: 'quarantined-rows',
      }),
    }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    fireEvent.click(await screen.findByRole('checkbox', { name: /skipping the rows that could not be read/i }));

    confirmNow();

    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith('run-b1', { allowMalformedRows: true });
  });

  // ⛔ IN THE SHEET BODY. Radix unmounts the ⋯ menu when its item is selected, so a percentage shown
  // only on the menu item is invisible for the entire transfer — which is the one thing the XHR
  // client gives up `fetch` for.
  it('A2b: the upload percentage is rendered where the operator can see it, not only on the menu item', async () => {
    let report: ((f: number | null) => void) | undefined;
    mocked(api.uploadFacilityImport).mockImplementation((_p: unknown, onProgress: unknown) => {
      report = onProgress as (f: number | null) => void;
      return new Promise<never>(() => { /* never settles: the upload stays in flight */ });
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    // Task 4: the same "Uploading…" copy now also renders on the visible primary action button
    // (Mapping's own primary action while an upload is in flight) — `{ selector: 'p' }` keeps this
    // scoped to the sheet-body paragraph the comment above is actually about, so two honest matches
    // do not read as "not found" and time out.
    // Indeterminate until the first progress event — `null`, never a frozen "0%".
    expect(await screen.findByText('Uploading…', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/uploading… 0%/i, { selector: 'p' })).not.toBeInTheDocument();

    await waitFor(() => expect(report).toBeDefined());
    act(() => { report?.(0.42); });
    expect(await screen.findByText('Uploading… 42%', { selector: 'p' })).toBeInTheDocument();

    // …and a transfer the browser will not measure (`lengthComputable` false) falls back to the
    // indeterminate copy rather than sticking on whatever number came last.
    act(() => { report?.(null); });
    expect(await screen.findByText('Uploading…', { selector: 'p' })).toBeInTheDocument();
  });

  // A poll that gives up STOPS the chain: `run` stays null forever, so a "checking…" line gated on
  // `runId && !run` alone went on claiming an activity that had already stopped — directly under the
  // error box saying so.
  it('A2b: a poll that fails replaces "checking the import run" with the failure, rather than both', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockRejectedValue(new Error('import run not found: run-b1'));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/import run not found: run-b1/i)).toBeInTheDocument();
    expect(screen.queryByText(/checking the import run/i)).not.toBeInTheDocument();
  });

  // ⛔ The status label is a DYNAMIC lookup (`runStatus.${status}`), so a missing or misspelled key
  // renders the raw key path to the operator and nothing else catches it. These two states had no
  // test at all; the other three do (validating/awaiting_confirmation/applying, above).
  it('A2b: a queued run says so in words, not as a raw i18n key path', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'queued' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText('Queued — waiting for an import worker.')).toBeInTheDocument();
  });

  it('A2b: …and so does a confirmed one still waiting for a worker', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'confirmed' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText('Confirmed — waiting for an import worker to write it.')).toBeInTheDocument();
  });

  // ── Task 8: ColumnMapStep wiring — the two items the brief handed off explicitly ────────────────

  it('Task 8: ColumnMapStep is a real controlled round-trip — a seeded suggestion actually reaches the sent columnMap', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['MFL Code', 'Name'],
      columns: [
        { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,Name\n1835,Namatindi RHC\n');
    // The column map lives on Mapping (step 2) — Continue to reach it.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // If the sheet fed `onChange` into anything OTHER than `columnMap` state directly — a debounce,
    // a batched update, a dropped call — the seed `ColumnMapStep` computes on mount would never land
    // back in `value`, and both rows would still read "Not mapped" here (this is exactly the bug
    // ColumnMapStep's own fix pass closed — see that file's docblock).
    expect(await screen.findByLabelText('MFL Code')).toHaveTextContent('national_code');
    expect(screen.getByLabelText('Name')).toHaveTextContent('name');

    await previewNow();
    expect(api.importFacilitiesCsv).toHaveBeenCalledWith(expect.objectContaining({
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' }, constants: {}, extras: [] },
    }));
  });

  it('Task 8: resets the column map on a file swap, so a stale mapping keyed on the OLD headers cannot satisfy the new file', async () => {
    mocked(api.suggestColumnMap)
      .mockResolvedValueOnce({
        headers: ['MFL Code', 'Name'],
        columns: [
          { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
          { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
        ],
      })
      // The SECOND file's headers share nothing with the first, and the engine offers no guess for
      // either — nothing should auto-seed, and nothing from the first file should still be there.
      .mockResolvedValueOnce({
        headers: ['Code', 'Facility Name'],
        columns: [
          { header: 'Code', candidates: [] },
          { header: 'Facility Name', candidates: [] },
        ],
      });
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,Name\n1835,Namatindi RHC\n');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByLabelText('MFL Code')).toHaveTextContent('national_code');

    // The File input lives on Source, not Mapping — go back to reach it, pick a DIFFERENT file
    // (headers the first file's mapping decisions know nothing about), then Continue again to see
    // the mapping panel react to it.
    fireEvent.click(screen.getByRole('button', { name: /1\s*Source/ }));
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [csvFile('Code,Facility Name\nX,Y\n')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByLabelText('Code')).toHaveTextContent('Not mapped');
    expect(screen.queryByLabelText('MFL Code')).not.toBeInTheDocument();

    await previewNow();
    // ⛔ THE FIX, PROVEN: without the reset, `columnMap.columns` would still carry
    // `{'MFL Code':'national_code', Name:'name'}` from the FIRST file — entries keyed on headers this
    // file does not even have — and the blocking summary would have waved through a map the server's
    // own `validateColumnMap` would then refuse (`missing_required` for `national_code`/`name`, since
    // no header of THIS file actually claims them). Nothing was ever chosen for the second file, so
    // no columnMap is sent at all.
    expect(api.importFacilitiesCsv).toHaveBeenCalledWith(expect.objectContaining({ columnMap: undefined }));
  });

  // ── Whole-branch review, MUST FIX 3: `columnMapErrors` was mirrored in `api.ts` and rendered
  // NOWHERE — an operator who mapped two headers to one field got "no rows found" or a misleading
  // unknown-columns message, no column-map errors shown, and the mapping panel gone (it unmounted
  // the instant `reviewResult` existed). Recovery needed re-picking the file. ────────────────────────

  it('⛔ renders columnMapErrors and keeps ColumnMapStep mounted so the operator can fix it in place', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['MFL Code', 'MFL Code 2'],
      columns: [
        { header: 'MFL Code', candidates: [] },
        { header: 'MFL Code 2', candidates: [] },
      ],
    });
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(baseResult({
      blocked: true, blockedReason: 'column-map',
      columnMapErrors: [
        { reason: 'duplicate_target', subject: 'MFL Code 2', target: 'national_code', other: 'MFL Code' },
      ],
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,MFL Code 2\n1,2\n');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('MFL Code');
    await previewNow();

    // Round-2 fix: a column-map refusal must NOT carry the operator to Review — the panel that
    // fixes it lives on Mapping, and Review has no equivalent. The refusal is explained right here,
    // next to the panel, with no extra click: not a silent "no rows found", not a bare quarantine
    // message, and not a trip to a step that does not have the fix on it.
    expect(await screen.findByText(
      /"MFL Code 2" and "MFL Code" both map to "national_code"/,
    )).toBeInTheDocument();

    // ⛔ THE OTHER HALF OF THE FIX: before it, `ColumnMapStep` unmounted the instant `reviewResult`
    // existed (its own render gate read `!reviewResult`), so the very panel needed to fix the
    // refusal disappeared at the same moment the refusal appeared. It must stay mounted here,
    // ALONGSIDE the error text above, on the SAME screen — not reachable only by navigating back.
    expect(screen.getByLabelText('MFL Code')).toBeInTheDocument();
    expect(screen.getByLabelText('MFL Code 2')).toBeInTheDocument();
    // And the sheet really did stay put: Mapping is still current, not Review.
    expect(screen.getByRole('button', { name: /2\s*Mapping/ })).toHaveAttribute('aria-current', 'step');
  });

  it('does not render the columnMapErrors block, or keep the panel mounted, once the file parses cleanly', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['MFL Code', 'Name'],
      columns: [
        { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,Name\n1835,Namatindi RHC\n');
    await previewNow();

    await screen.findByText(/facility row\(s\) will be created/i);
    expect(screen.queryByText(/both map to/)).not.toBeInTheDocument();
    // The design's ordinary flow: the panel maps columns exactly once, then gets out of the way —
    // unaffected by the fix, which only keeps it mounted for the 'column-map' refusal specifically.
    expect(screen.queryByLabelText('MFL Code')).not.toBeInTheDocument();
  });

  // ── Whole-branch review, MUST FIX 3: `rowCount`/`onValidityChange` were exported by ColumnMapStep
  // and passed by NEITHER caller — dead props. `rowCount` is wired here to a plain line count of the
  // picked file (informational, not authoritative). `onValidityChange` is wired to a NON-BLOCKING
  // notice, deliberately: gating Preview/Upload on it would contradict this sheet's own established
  // design, proven by the "resets the column map on a file swap" test above, which picks a file whose
  // headers satisfy NO required field and still expects Preview to fire — this app leaves "is the map
  // complete" to the server's own authoritative refusal (now actually shown, per the fix above),
  // never to a client-side guess that could diverge from it. ─────────────────────────────────────────

  it('shows the row-count hint and a non-blocking notice while the column map is incomplete, without disabling Preview', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['Code', 'Facility Name'],
      columns: [{ header: 'Code', candidates: [] }, { header: 'Facility Name', candidates: [] }],
    });
    (api.importFacilitiesCsv as ReturnType<typeof vi.fn>).mockResolvedValue(cleanPreview);
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('Code,Facility Name\nA,B\nC,D\n');
    // The row-count hint and the notice both live in ColumnMapStep, on Mapping (step 2).
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // rowCount wired: 2 data rows in the picked file.
    expect(await screen.findByText(/applies to 2 facilities/i)).toBeInTheDocument();
    // onValidityChange wired: neither header satisfies a required field, so the notice shows.
    expect(screen.getByText(/still preview or upload/i)).toBeInTheDocument();

    // ...and it does not block anything — `previewNow` itself waits for Preview to become enabled,
    // so this line is the proof: it would time out were Preview gated on validity.
    await previewNow();
    expect(api.importFacilitiesCsv).toHaveBeenCalled();
  });

  it('the incomplete-map notice clears once the required fields are satisfied', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['MFL Code', 'Name'],
      columns: [
        { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,Name\n1835,Namatindi RHC\n');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('MFL Code');
    expect(screen.queryByText(/still preview or upload/i)).not.toBeInTheDocument();
  });

  // ── Zambia field report 3: the background door lost the mapping panel entirely. The inline door's
  // 'column-map' exception above was gated behind a bare `!run`, which any upload makes false — so
  // an operator whose UPLOADED map was refused saw the refusal with no panel and no way back. Large
  // files take this door, which is the door the Zambia team is on. ────────────────────────────────

  it('⛔ keeps ColumnMapStep mounted when an UPLOADED map is refused, and offers the re-upload', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['Province', 'Zone'],
      columns: [
        { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Zone', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        blocked: true, blockedReason: 'column-map',
        columnMapErrors: [
          { reason: 'duplicate_target', subject: 'zone', target: 'zone', other: 'Province' },
        ],
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    // Round-2 fix: an uploaded run counts as reviewed the instant it exists (`runId`), which used to
    // carry the sheet straight to Review — past the panel that fixes a column-map refusal, which
    // does not exist there. Landing on Review happens first (before the poll answers), then the
    // sheet retreats to Mapping the moment the refusal is known — one `waitFor` covers both the
    // poll answering AND that retreat settling, rather than checking each in its own turn.
    await waitFor(() => {
      expect(screen.getByText(/"zone" and "Province" both map to "zone"/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /2\s*Mapping/ })).toHaveAttribute('aria-current', 'step');
    });
    expect(screen.getByLabelText('Province')).toBeInTheDocument();
    expect(screen.getByLabelText('Zone')).toBeInTheDocument();

    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Re-upload with the corrected map' })).toBeInTheDocument();
  });

  it('⛔ re-uploads the corrected map, so the validate reviewed is the one the operator fixed', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['Province', 'Zone'],
      columns: [
        { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Zone', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    mocked(api.uploadFacilityImport)
      .mockResolvedValueOnce({ runId: 'run-b1' })
      .mockResolvedValueOnce({ runId: 'run-b2' });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({
        id: 'run-b1', status: 'awaiting_confirmation',
        summary: baseResult({
          blocked: true, blockedReason: 'column-map',
          columnMapErrors: [
            { reason: 'duplicate_target', subject: 'zone', target: 'zone', other: 'Province' },
          ],
        }),
      }))
      // Same discipline as the unknown-columns re-upload test above: the second run never answers,
      // so nothing but the sheet's own `setRun(null)` can clear the superseded summary.
      .mockReturnValue(new Promise<never>(() => { /* never settles */ }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/both map to "zone"/);
    // Round-2 fix: the sheet retreats to Mapping once the refusal is known — see the "keeps
    // ColumnMapStep mounted" test above for why this needs its own wait. The panel is on screen
    // once this settles, no back-click needed to reach it.
    await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Mapping/ })).toHaveAttribute('aria-current', 'step'));

    // Fix it in place: send Zone to extras, which is what actually releases its passthrough claim.
    fireEvent.click(screen.getByLabelText('Zone'));
    fireEvent.click(await screen.findByRole('option', { name: 'Not mapped' }));

    clickMenuItem('Re-upload with the corrected map');

    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(2));
    expect(mocked(api.uploadFacilityImport).mock.calls[1][0]).toEqual(
      expect.objectContaining({ columnMap: expect.objectContaining({ extras: ['Zone'] }) }),
    );
  });

  describe('the step shell', () => {
    it('starts on Source and does not show the mapping panel yet', async () => {
      mocked(api.suggestColumnMap).mockResolvedValue({ headers: [], columns: [] });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByRole('button', { name: /1\s*Source/ }))
        .toHaveAttribute('aria-current', 'step');
      expect(screen.getByRole('button', { name: /2\s*Mapping/ })).toBeDisabled();
    });

    it('opens Mapping once Continue is pressed, and shows the column map there', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      // Picking a file and a register earns Mapping, but Continue is the operator's own move —
      // still on Source until they press it.
      expect(screen.queryByLabelText('MFL Code')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByLabelText('MFL Code')).toBeInTheDocument();
    });

    // The register picker and the file input belong to step 1 and must not be on screen at step 2:
    // leaving them there is what made five stages read as one scrolling surface.
    it('hides the source inputs once past Source', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByLabelText('MFL Code');

      expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'National system' })).not.toBeInTheDocument();
    });

    it('goes back to Source and shows those inputs again', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByLabelText('MFL Code');
      fireEvent.click(screen.getByRole('button', { name: /1\s*Source/ }));

      expect(await screen.findByLabelText('File')).toBeInTheDocument();
    });
  });

  describe('the primary action', () => {
    it('offers Continue on Source and Upload and validate on Mapping', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();

      await pickFileAndSystem();
      // Picking a file and a register earns Mapping, but does not move the sheet there — Continue
      // is still the visible action, on Source, until it is pressed.
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByRole('button', { name: 'Upload and validate' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    // The whole point of the exception to AGENTS.md section 5: the action that advances is visible,
    // and it is the ONLY visible one. Everything else stays in the dropdown.
    it('shows exactly one primary action, with Preview still in the menu', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByRole('button', { name: 'Upload and validate' });

      expect(screen.queryByRole('button', { name: /^Preview$/ })).not.toBeInTheDocument();
      openMenu();
      expect(screen.getByRole('menuitem', { name: /^Preview$/ })).toBeInTheDocument();
    });

    it('Continue stays disabled until a file and a register are both chosen', async () => {
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
    });
  });

  describe('the register empty state', () => {
    it('says a register is required and offers Add a register as the step action', async () => {
      mocked(api.listFacilityImportSources).mockResolvedValue([]);
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByText(/Register this file’s source first/)).toBeInTheDocument();
      // ⛔ The action is VISIBLE, not an item in a menu nobody has a reason to open. This is the
      // whole fix for "user doesnt know they have to register a national system first".
      expect(screen.getByRole('button', { name: 'Register a source' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    it('goes back to the ordinary Continue action once a register exists', async () => {
      // A bare array, NOT `{ rows }`. That is this client's actual shape, and the file's own
      // HFR_SOURCE fixture is the same. Getting it wrong makes `sources.length === 0` stay true and
      // the test passes for the wrong reason.
      mocked(api.listFacilityImportSources).mockResolvedValue([HFR_SOURCE]);
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.queryByText(/Register this file’s source first/)).not.toBeInTheDocument();
    });
  });
});
