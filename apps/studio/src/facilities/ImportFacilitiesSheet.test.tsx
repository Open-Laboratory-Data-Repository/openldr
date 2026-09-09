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
    // Plan B: the run door checks a stored file again instead of sending it twice.
    revalidateFacilityImportRun: vi.fn(),
    // Task 6: Data's own grid reads the stored file's rows directly; it never touches this
    // sheet's own state (see DataGridStep.tsx's own doc comment on why).
    readFacilityImportRows: vi.fn(),
    // The per-row check's own read, behind `MappingRowStatus`'s click.
    readFacilityImportColumnValues: vi.fn(),
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

/** Fix for the reachability regression (Critical finding, code review): the strip shows four
 *  steps (Source, Data, Mapping, Review) and the sheet's OWN numbering now agrees with it: 1
 *  Source, 2 Data, 3 Mapping, 4 Review. Before this fix the sheet still rendered Mapping's panel
 *  at its own `step === 2` and Review's summary at `step === 3`, one slot behind the strip's real
 *  labels, so clicking strip position 3 ("Mapping") actually showed Review's content and an
 *  operator could reach it without ever seeing the column map. The helpers below click by the
 *  strip's real label at its real position, which is what an operator does. */

/** Reading the File's text back out (`file.text()`) is genuinely asynchronous in jsdom, so the
 *  Preview action stays disabled until it resolves — this opens the menu and waits for THAT,
 *  rather than a fixed delay, before clicking it. Leaves the menu closed afterward (same as
 *  clickMenuItem) via Radix's own item-select auto-close. */
async function previewNow() {
  // ⛔ REACH MAPPING FIRST, from either side. Preview is the inline door and it now lives on
  // Mapping: offering it on Source invited an operator to skip mapping and then be refused for it.
  // Coming from Source that means clicking Continue; coming BACK from Review, after a first preview
  // has already carried the sheet forward, it means clicking the step strip. A re-preview is an
  // ordinary thing for an operator to do, so the helper has to handle both.
  const continueButton = screen.queryByRole('button', { name: 'Continue' });
  if (continueButton) fireEvent.click(continueButton);
  const mappingStep = screen.queryByRole('button', { name: /2\s*Data/ });
  if (mappingStep && mappingStep.getAttribute('aria-current') !== 'step' && !mappingStep.hasAttribute('disabled')) {
    fireEvent.click(mappingStep);
  }
  openMenu();
  await waitFor(() => expect(screen.getByRole('menuitem', { name: /^preview$/i })).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(screen.getByRole('menuitem', { name: /^preview$/i }));
}

/** Click the step strip back to Mapping. Every decision lives there now, so a test that changes one
 *  after a check has to come back for it — which is the flow itself, not test ceremony. */
async function backToMapping() {
  // ⛔ WAITS FOR REVIEW FIRST. `uploadNow` fires the last click and returns; it does not await
  // the response. Stepping back before the result lands clicks a Mapping button while the sheet is
  // ALREADY on Mapping, which does nothing, and the auto-advance effect then carries the operator
  // to Review the moment the result arrives. Measured: the click looked fine and the step went
  // forward anyway.
  await waitFor(() => expect(screen.getByRole('button', { name: /4\s*Review/ }))
    .toHaveAttribute('aria-current', 'step'));
  fireEvent.click(screen.getByRole('button', { name: /3\s*Mapping/ }));
}

/** Step forward to Review WITHOUT re-checking. Only legal when the summary was never retired, i.e.
 *  nothing in `summarySignature` moved. `allowMalformedRows` is the case that matters: it does not
 *  change what the parser finds, only whether Apply may proceed, so it is deliberately absent from
 *  that signature and ticking it leaves the summary standing. */
function forwardToReview() {
  fireEvent.click(screen.getByRole('button', { name: /4\s*Review/ }));
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

/** Drives the sheet from Source to Mapping, the first half of what an operator now needs to reach
 *  the column map at all, since the reachability fix moved storage ahead of Mapping.
 *
 *  Source's own visible button (`Continue`) now stores the file (`validate=false`) and lands on
 *  Data; only THEN is Mapping's own strip position reachable. `uploadFacilityImport` is called
 *  ONCE by this alone. Every caller that reaches this already past Source (nothing left to click,
 *  or Mapping already current) is a no-op. A failed store leaves Mapping unreachable and this
 *  returns having done nothing further: the caller's own assertions on the surfaced error are the
 *  point of that case. */
async function advanceToMapping() {
  const continueButton = screen.queryByRole('button', { name: 'Continue' });
  if (continueButton) {
    fireEvent.click(continueButton);
    // Query FRESH on every poll, never the button captured above: once the store succeeds the
    // sheet moves off Source and this button unmounts, and a stale reference to a removed node
    // keeps reporting whatever `disabled` it had the instant before removal.
    await waitFor(() => {
      const stillOnSource = screen.queryByRole('button', { name: 'Continue' });
      expect(stillOnSource === null || !stillOnSource.hasAttribute('disabled')).toBe(true);
    });
  }
  const mappingStep = screen.queryByRole('button', { name: /3\s*Mapping/ });
  if (mappingStep && mappingStep.getAttribute('aria-current') !== 'step' && !mappingStep.hasAttribute('disabled')) {
    fireEvent.click(mappingStep);
  }
}

/** Drives the two clicks an operator now needs for a first upload+validate: `advanceToMapping`
 *  above, then Mapping's own visible button ("Validate all").
 *
 *  ⛔ ONE `uploadFacilityImport` CALL, NOT TWO. Source's Continue stores the file
 *  (`validate=false`, minting a `stored` run) and Mapping's button then checks that SAME run
 *  through `revalidateFacilityImportRun`, never sending the file again. This used to be two
 *  `uploadFacilityImport` calls: `packages/bootstrap/src/facility-revalidate.ts`'s guard only
 *  accepted `awaiting_confirmation`, so the run this helper drives (`stored`) fell back to a
 *  second, full re-upload. That guard now accepts `stored` too, so `handleRevalidate`'s fallback
 *  is never reached here. Every caller that mocks `uploadFacilityImport` to resolve must expect
 *  exactly ONE call, and a caller asserting on the VALIDATE request's own arguments (columnMap,
 *  allowUnknownColumns, …) now reads `revalidateFacilityImportRun`'s call instead. */
async function uploadNow() {
  await advanceToMapping();
  // A failed store leaves Mapping unreachable and nothing left to drive here.
  const mappingStep = screen.queryByRole('button', { name: /3\s*Mapping/ });
  if (!mappingStep || mappingStep.hasAttribute('disabled')) return;
  // Mapping's own button can no longer read "Upload and validate": Mapping is only ever reachable
  // once `runId` is already set (Source's store is what earns `hasStoredFile`), so its label is
  // always "Validate all", or the column-map-refusal variant.
  const button = await screen.findByRole(
    'button',
    { name: /validate all|check again with the corrected map/i },
  );
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** Round-2 fix: the confirm-path equivalent of `uploadNow` above — drives the VISIBLE "Confirm
 *  import" button on Review (step 4, renumbered by the reachability fix above), which
 *  `canConfirmRun` renders once a run's own validated summary is on screen. Every caller has
 *  already awaited something that only exists once that summary rendered, so the button is
 *  present synchronously here. */
function confirmNow() {
  fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
}

/** Drive the STREAMED door until `summary` is rendered on Review.
 *
 *  The inline preview used to be the cheap way to put a `FacilityImportResult` on screen. With that
 *  door gone this is the only way, and it is also what an operator actually does: upload, the worker
 *  validates, the poll brings the summary back.
 *
 *  ⛔ NOT for a test that asserts what the UPLOAD was called with. This presses the button for you
 *  and supplies its own mocks, so those would be the thing under test rather than the subject. Such
 *  tests arrange by hand, exactly as the A2b tests further down already do.
 *
 *  @param run Override the run row. `status: 'applied'` is how a test reaches `appliedSummary`.
 *  @param csv The fixture file's text, when the test cares about its headers.
 */
async function reviewWithSummary(
  summary: FacilityImportResult,
  run: Partial<FacilityImportRunView> = {},
  csv?: string,
): Promise<void> {
  mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
  mocked(api.getFacilityImportRun).mockResolvedValue(runView({
    status: 'awaiting_confirmation', phase: 'validated', summary, ...run,
  }));
  await pickFileAndSystem(csv);
  await uploadNow();
  // ⛔ Waits for the STEP, not for a text match. Every caller then asserts its own copy, and a
  // helper that waited on one caller's string would silently pass for a summary that never rendered.
  await waitFor(() => expect(screen.getByRole('button', { name: /4\s*Review/ }))
    .toHaveAttribute('aria-current', 'step'));
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
    mocked(api.revalidateFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'queued' });
    // Fix for the reachability regression: Source's own Continue button now stores the file
    // (`validate=false`), which is a real network call it never made before. Every test that
    // clicks Continue needs this to resolve, even the many that only care about navigating to
    // Data or Mapping and never touch the run itself. Defaulted here so those tests do not each
    // have to arrange it by hand. Tests that care about the upload's own request or response
    // override this per-call, exactly as `suggestColumnMap` above is overridden.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-default' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'stored' }));
    // Task 6: Data's own grid fetches its own page the moment `runId` is set, which is true for
    // every test that clicks Continue, whether or not the test itself is about Data. Defaulted
    // here for the same reason `uploadFacilityImport` is above: an unmocked call has no
    // `mockResolvedValue` and returns `undefined`, and `undefined.then` throws inside the effect.
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: [], rows: [], offset: 0, limit: 100, total: 0,
    });
  });

  // ── B1 Task 9: the national-system picklist ─────────────────────────────────────────────────────

  it('B1 Task 9: renders a Select populated from the API, keeps Mapping unreachable until a source is chosen, and sends the URI — never the display name', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
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

    // A file alone is not enough: Mapping's action is unreachable with no register chosen.
    // Asserting the absence of Mapping's own action covers both shapes of blocked Source: Continue
    // present but disabled, and Continue replaced by "Register a source" when the install has no
    // register at all.
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile()] } });
    expect(screen.queryByRole('button', { name: 'Upload and validate' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: HFR_SOURCE.name }));

    await uploadNow();
    // ONE call: Source's own store. Mapping's validate goes through `revalidateFacilityImportRun`
    // instead (see `uploadNow`'s own comment).
    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    // ⛔ THE WHOLE POINT: the source's URI reaches the request, never its display name.
    // ⛔ The second argument is the progress callback. `uploadFacilityImport` takes two, and a
    // one-argument `toHaveBeenCalledWith` would fail on the arity rather than on the subject.
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: HFR_SOURCE.url }), expect.any(Function),
    );
    expect(api.uploadFacilityImport).not.toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: HFR_SOURCE.name }), expect.any(Function),
    );
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

    // ⛔ THE WHOLE POINT: importing is now reachable — a file plus the just-registered source is
    // enough to import against it, which is exactly what "unreachable on a fresh install" denied
    // before.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile()] } });
    await uploadNow();
    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({ nationalSystem: NEW_SOURCE.url }), expect.any(Function),
    ));
  });

  it('a parseable-but-wrong file (parsed: 0, no unknown columns) reads as "nothing found", not success', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({ parsed: 0 }), {}, 'the quick brown fox');

    expect(await screen.findByText(/no facility rows were found/i)).toBeInTheDocument();
    // Nothing to confirm — the trap case must not offer Apply.
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
  });

  // The opt-in's own round trip is the run door's, and it has its own test: "the run door
  // re-uploads the same file with allowUnknownColumns, so the validate reviewed is the one applied".
  // This test is the amber box's copy and the un-overridden request, nothing more.
  it('shows unknown columns with an explicit opt-in, naming the columns', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    // `blockedReason` set: this fixture stands for a file with NO column map, which is the case
    // that still refuses, and `importFacilities` really does set the reason for it. The amber box
    // keys off that verdict rather than off the list alone.
    await reviewWithSummary(baseResult({
      parsed: 0, unknownColumns: ['weird_col', 'other_col'],
      blocked: true, blockedReason: 'unknown-columns',
    }));

    expect(await screen.findByText(/weird_col, other_col/)).toBeInTheDocument();
    expect(api.uploadFacilityImport).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowUnknownColumns: false }),
      expect.any(Function),
    );

    // ⛔ THE OVERRIDE LIVES ON MAPPING. Review reports the finding and offers no control, so the
    // operator comes back to decide. Ticking does not re-check by itself either: it retires the
    // summary, and the next check is theirs to ask for.
    await backToMapping();
    expect(screen.getByRole('checkbox', { name: /import anyway/i })).toBeInTheDocument();
    // ONE call: Source's own store. Mapping's validate went through `revalidateFacilityImportRun`
    // instead (see `uploadNow`'s own comment). Navigating back does not call it again.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
  });

  // Task 5: surface Task 4's `quarantined` (facility-import.ts) — a structurally malformed row's
  // line number and raw content, and the `allowMalformedRows` override, reusing the same
  // control/copy pattern as the unknown-columns opt-in above (see the brief).
  it('lists quarantined line numbers, states the count, and withholds Confirm until the operator opts in', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 1, create: 1,
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      // What the worker's validate actually stores WITHOUT the override — the file is checked
      // before the checkbox is ever ticked.
      blocked: true, blockedReason: 'quarantined-rows',
    }));

    expect(await screen.findByText(/line 3/i)).toBeInTheDocument();
    expect(screen.getByText(/2,Bad,Extra/)).toBeInTheDocument();
    expect(screen.getByText(/1 row could not be read/i)).toBeInTheDocument();

    // Confirm is not offered while a quarantined row is blocking and not yet allowed — the same
    // "not offered" idiom this sheet already uses for the unknown-columns-blocked case, not a
    // disabled control with no explanation.
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();

    // Opting in unblocks Confirm locally — `allowMalformedRows` does not change what the parser
    // finds (see facility-import.ts's docblock: it only gates whether APPLY proceeds), so this
    // must NOT re-check, unlike the unknown-columns checkbox.
    // The override lives on Mapping now. It stays out of `summarySignature` deliberately, so
    // ticking it does NOT retire the Review the operator already has: they step straight back.
    await backToMapping();
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    // ONE call: Source's own store. Mapping's validate went through `revalidateFacilityImportRun`
    // instead (see `uploadNow`'s own comment). Ticking the checkbox does not re-check by itself,
    // so this stays at one.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
    forwardToReview();

    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();
  });

  // ⛔ THE CASE THIS SHEET COULD NOT REFUSE ON ITS OWN. Its old gate was "quarantined rows and no
  // override"; a duplicate-header file has neither, so Apply stayed off the menu only because
  // `parseFacilityCsv` happens to return `records: []` — i.e. `parsed > 0` did the work. That is a
  // property of today's parser, not a contract, and the server refuses this file regardless. With
  // `parsed: 2` (a file the parser DID read rows out of) the old gate offers Apply for a write the
  // server will reject; reading the server's own `blocked` refuses it. Ticking the malformed-rows
  // checkbox must NOT release it either — duplicate headers have no override.
  it('refuses Confirm for a duplicate-header file even when rows parsed, and the override does not release it', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 2, create: 2, duplicateColumns: ['name'],
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      blocked: true, blockedReason: 'duplicate-columns',
    }));

    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();

    // The quarantine block is rendered (the file has both problems), so the checkbox is reachable —
    // and ticking it changes nothing, because the reason is the unoverridable one.
    await backToMapping();
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    forwardToReview();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
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
  it('re-imposes the quarantine block when the operator un-ticks the override', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 1, create: 1,
      quarantined: [{ line: 3, raw: '2,Bad,Extra', reason: 'too_many_fields' }],
      blocked: true, blockedReason: 'quarantined-rows',
    }));

    // ⛔ THE PROPERTY THIS TEST EXISTS FOR, and the whole reason it is a TOGGLE rather than a
    // release valve: the summary being toggled against was computed WITHOUT the override, so
    // `blockedReason` still reads 'quarantined-rows' and un-ticking can re-impose it. On the inline
    // door that took a request pinning `allowMalformedRows: false` on every preview. Here it is
    // structural and stronger: the flag is not in the upload's payload at all, so the worker's
    // validate could not have run with it.
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.not.objectContaining({ allowMalformedRows: expect.anything() }),
      expect.any(Function),
    );

    await backToMapping();
    fireEvent.click(await screen.findByRole('checkbox', { name: /import anyway/i }));
    forwardToReview();
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();

    // …and taking it back takes Confirm away again. Ticking never re-checked, so the summary
    // standing here is still the un-overridden one both directions read.
    await backToMapping();
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    forwardToReview();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    // ONE call: Source's own store. Mapping's validate went through `revalidateFacilityImportRun`
    // instead (see `uploadNow`'s own comment). Neither tick re-checks by itself, so this stays at
    // one through both direction changes.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
  });

  it('surfaces duplicates as a plainly-visible warning, not a buried number', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 5, create: 3, duplicates: 2,
    }));

    expect(await screen.findByText(/2 duplicate national code/i)).toBeInTheDocument();
  });

  it('a rejected upload surfaces the server message and keeps the sheet open', async () => {
    mocked(api.uploadFacilityImport).mockRejectedValue(
      new Error('import facilities failed: Invalid Record Length: columns length is 3, got 2 on line 4'),
    );
    const onOpenChange = vi.fn();
    render(<ImportFacilitiesSheet open onOpenChange={onOpenChange} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/invalid record length/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('Mapping stays unreachable until both a file and a national system are present, and the system never defaults', () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByLabelText('National system')).toHaveValue('');

    // ⛔ "Cannot reach Mapping", not "the action is disabled". Asserting the absence of
    // Mapping's own action covers both shapes of blocked Source: Continue present but disabled,
    // and Continue replaced by "Register a source" when the install has no register at all.
    expect(screen.queryByRole('button', { name: 'Upload and validate' })).not.toBeInTheDocument();
  });

  // F2 was one test walking from the blocked state to the opted-in one through a re-preview. The
  // two states are what it actually asserted, and each is a summary in its own right, so they are
  // two tests now. Neither assertion moved.
  it('F2: before opting in, unknown-columns-blocked is its own explanation and not also "nothing found"', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 0, unknownColumns: ['patient_id', 'dob', 'sex'],
      blocked: true, blockedReason: 'unknown-columns',
    }));

    expect(await screen.findByText(/patient_id, dob, sex/)).toBeInTheDocument();
    // The "wrong file" message must not also render here — it would be a second, confusing
    // message for the same finding.
    expect(screen.queryByText(/no facility rows were found/i)).not.toBeInTheDocument();
  });

  it('F2: once opted in, a wrong file still states an outcome and surfaces the skipped count', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    // The summary a validate produces once the override rode the upload: the columns were kept, so
    // nothing is blocked, and the file STILL parses to zero rows.
    //
    // ⛔ `options` IS THE OVERRIDE ON THIS DOOR, and it is load-bearing rather than decoration.
    // `unknownColumnsOverridden` reads the RUN's stored options, not this sheet's checkbox
    // (ImportFacilitiesSheet.tsx's `reupload ? reupload.allowUnknownColumns : ...`), because on a
    // run the question is what the validate actually ran with. Without it the summary takes the
    // "unrecognised columns" branch instead and never states the outcome at all.
    await reviewWithSummary(baseResult({
      parsed: 0, skipped: 3000, unknownColumns: ['patient_id', 'dob', 'sex'],
    }), { options: { allowUnknownColumns: true } });

    // A file that parses to zero rows must say so plainly, AND the 3000 skipped rows (previously
    // invisible — `skipped` only ever rendered inside the `parsed > 0` branch) must be visible.
    expect(await screen.findByText(/3000 row\(s\).*skipped/i)).toBeInTheDocument();
    expect(screen.queryByText(/row\(s\) will be imported/i)).not.toBeInTheDocument();
  });

  // A2a (FAC-P1-03): the headline count and the apply-confirm body now come from the server's own
  // reconciliation (`create` + `changed`, the rows `classifyFacilityRows` says an apply would
  // actually write), not the old client-side `parsed - duplicates` approximation — a byte-identical
  // re-import collapses to `unchanged`, which `parsed - duplicates` had no way to know about.
  it('F3: the headline row count reflects what the server classified as create+changed, not the raw parsed count', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 5, duplicates: 2, create: 2, changed: 1, unchanged: 2,
    }));

    // 2 create + 1 changed = 3 rows will actually land in the registry — NOT 5 parsed, and NOT
    // 5 - 2 duplicates (which would also read 3 here by coincidence; the point is the number now
    // comes from server classification, proven by the `unchanged` regression test below).
    expect(await screen.findByText(/3 row\(s\) will be imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/5 row\(s\) will be imported/i)).not.toBeInTheDocument();
  });

  // The case `parsed - duplicates` could never have gotten right: a file with no in-file duplicates
  // at all (so the old formula would have reported the full `parsed` count) where most rows are
  // byte-identical re-imports of what the registry already holds.
  it('F3 regression: a byte-identical re-import (parsed rows are mostly `unchanged`) reports the small real write, not the full parsed count', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 100, duplicates: 0, create: 0, changed: 1, unchanged: 99,
    }));

    expect(await screen.findByText(/1 row\(s\) will be imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/100 row\(s\) will be imported/i)).not.toBeInTheDocument();
  });

  it('F5: a 0-byte CSV explains why the import cannot start, instead of dead-ending with no explanation', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File([''], 'empty.csv', { type: 'text/csv' })] } });
    fireEvent.change(screen.getByLabelText('National system'), { target: { value: 'HFR' } });

    expect(await screen.findByText(/this file is empty/i)).toBeInTheDocument();
    // ⛔ "Cannot reach Mapping", not "the action is disabled". Asserting the absence of
    // Mapping's own action covers both shapes of blocked Source: Continue present but disabled,
    // and Continue replaced by "Register a source" when the install has no register at all.
    expect(screen.queryByRole('button', { name: 'Upload and validate' })).not.toBeInTheDocument();
  });

  // ── A2a (FAC-P1-03/05): the reconciliation summary ────────────────────────────────────────────

  it('renders the create/changed/unchanged breakdown the server classified, alongside the headline count', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({ parsed: 7, create: 2, changed: 1, unchanged: 4 }));

    expect(await screen.findByText(/2 facility row\(s\) will be created/i)).toBeInTheDocument();
    expect(screen.getByText(/1 existing facility row\(s\) will be changed/i)).toBeInTheDocument();
    expect(screen.getByText(/4 facility row\(s\) already match the registry/i)).toBeInTheDocument();
  });

  // ⛔ THE WHOLE POINT OF THIS SLICE: `conflict: null` must never read as "0 conflicts" — that is
  // precisely the "0 means not computed" defect the audit findings this task closes exist to remove.
  it('renders conflict: null as "not evaluated", never as 0', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3, conflict: null,
    }));

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
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 2, conflict: 1, absent: 5,
    }));

    expect(await screen.findByText(/1 row\(s\) were changed since this preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/not evaluated/i)).not.toBeInTheDocument();
  });

  // Same defect, same fix, for `absent`.
  it('renders absent: null as "not evaluated", never as 0', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3, absent: null,
    }));

    expect(await screen.findByText(/absent from this file:.*not evaluated/i)).toBeInTheDocument();
    // Same reasoning as the conflict test above: the actual `summaryAbsent` copy (en.ts) never starts
    // with "absent from this file", so `/absent from this file:\s*0\b/i` could never match regardless
    // of whether `absent: null` were wrongly rendered as `0` — this asserts against the real 0-count
    // sentence instead.
    expect(screen.queryByText(/0 registry row\(s\) for this national system are absent from this file/i)).not.toBeInTheDocument();
  });

  it('a changed-row sample shows the before→after diff, not just a bare count', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 1, changed: 1,
      samples: {
        create: [], conflict: [], absent: [], deleted: [],
        changed: [{
          id: 'f1', nationalCode: 'C1', name: 'Dodoma RRH',
          diff: [{ field: 'name', before: 'Dodoma Regional', after: 'Dodoma RRH' }],
        }],
      },
    }));

    // The facility name heads the sample entry; the diff line beneath it shows the actual
    // before→after change — both "Dodoma RRH" occurrences (the heading AND the diff's `after`) are
    // expected, so this asserts on the combined diff line rather than a name fragment that would
    // otherwise match twice.
    expect(await screen.findByText(/name: Dodoma Regional → Dodoma RRH/)).toBeInTheDocument();
  });

  it('retirement choices for deleted/absent rows stay off the sheet entirely when there is nothing to retire', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3, deleted: 0, absent: 0,
    }));

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
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 2, conflict: null, runId: 'run-1',
    }));

    await backToMapping();
    const select = await screen.findByRole('combobox', { name: /rows changed since this preview/i });
    expect(select).toBeInTheDocument();
    expect(await screen.findByText(/skip them/i)).toBeInTheDocument();
  });

  it('offers a retirement choice for declared-removed rows once `deleted` is non-zero, defaulting to Retire', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3, deleted: 2,
    }));

    await backToMapping();
    expect(await screen.findByRole('combobox', { name: /rows this file says were removed/i })).toBeInTheDocument();
    // `absent` is null here (not evaluated) — its own choice must not appear even though `deleted`'s does.
    expect(screen.queryByRole('combobox', { name: /rows missing from this file/i })).not.toBeInTheDocument();
  });

  it('offers a retirement choice for merely-absent rows once `absent` is a non-zero number, defaulting to Report only', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3, absent: 4, deleted: 0,
    }));

    await backToMapping();
    expect(await screen.findByRole('combobox', { name: /rows missing from this file/i })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /rows this file says were removed/i })).not.toBeInTheDocument();
  });

  it('Confirm sends the default onConflict: skip when the operator never touches the control', async () => {
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    // `conflict: 1` so the control is SHOWN at all: `confirmOptionsFor` sends only the choices whose
    // control the operator was actually offered, so a fixture with no conflict would omit the key
    // and this test would pass for the wrong reason.
    await reviewWithSummary(baseResult({ parsed: 3, create: 2, conflict: 1 }));

    confirmNow();

    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith('run-b1',
      expect.objectContaining({ onConflict: 'skip' }));
  });

  it('warns, informationally, that an unrecognised national system will create a new register identity', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3, knownNationalSystem: false,
    }));

    expect(await screen.findByText(/new register identity/i)).toBeInTheDocument();
    // Informational only — Confirm must still be offered.
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();
  });

  it('the applied-result summary reads written.created/written.updated, not a flat created/updated', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(
      baseResult({ parsed: 3, written: { created: 2, updated: 1, retired: 0 }, skipped: 0 }),
      { status: 'applied' },
    );

    expect(await screen.findByText(/created 2, updated 1, skipped 0/i)).toBeInTheDocument();
  });

  // ── CT-3 (whole-branch review): the whole preview surface actually reaches the wire ────────────

  it('CT-3: format, completeRelease and releaseVersion ride the upload, so the validate parses what the operator declared', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    // Continue now stores the file. Source, where format/complete-release/release-version live,
    // is where the sheet stays until the operator presses it. Set these before ever leaving Source.
    fireEvent.click(screen.getByRole('combobox', { name: /file format/i }));
    fireEvent.click(await screen.findByRole('option', { name: /jsonl release/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /this file is a complete release/i }));
    fireEvent.change(screen.getByLabelText('Release version'), { target: { value: 'r7' } });

    await uploadNow();

    // ONE call: Source's own store, which already carries these three (set on Source before
    // Continue). Mapping's validate goes through `revalidateFacilityImportRun` instead (see
    // `uploadNow`'s own comment).
    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    expect(api.uploadFacilityImport).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: 'jsonl', completeRelease: true, releaseVersion: 'r7' }),
      expect.any(Function),
    );

    // ⛔ AND NOT AGAIN AT CONFIRM. These three describe how the file PARSES, so they belong to the
    // request that runs before the classification the operator approves. The run stored them at
    // upload time; the confirm route refuses a parse-changing value arriving late. On the inline
    // door the same discipline took the opposite shape — send them twice, identically — because
    // there was no run to store them on. Asserting they repeat here would invert the design.
    expect(api.confirmFacilityImportRun).not.toHaveBeenCalled();
  });

  // The override's own round trip belongs to the run door and has its own test: "the
  // invalid-coordinate override is a re-upload too, and disappears once the run already ran with
  // it". This test is the reporting, nothing more.
  it('CT-3: renders invalid-coordinate rows with line numbers', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 1, create: 1,
      invalid: [{ line: 2, field: 'latitude', reason: 'out_of_range', raw: '95.0' }],
    }));

    expect(await screen.findByText(/rows with an invalid coordinate/i)).toBeInTheDocument();
    expect(screen.getByText(/1 row has a coordinate/i)).toBeInTheDocument();
    expect(screen.getByText(/line 2 — latitude: 95\.0/)).toBeInTheDocument();
  });

  // Task 8: this used to assert a static warning sentence. `ValueMapPanel` used to render that same
  // spot as an interactive picker. Task 6 moved the pick-lists again, into `ColumnMapStep` itself:
  // one worklist per row, under the mapping it belongs to, so this test now needs a header that
  // actually claims `level` for the worklist to attach to; the beforeEach's own `suggestColumnMap`
  // default (`headers: []`) deliberately keeps `ColumnMapStep` off screen for every OTHER test, and
  // this one now overrides it. The `notValidated` half of this test is untouched: that stays the
  // sheet's own plain informational line, not part of the worklist.
  it('CT-3/Task 8: renders one pick-list row per unmapped controlled-field value, and which fields could not be validated at all', async () => {
    mocked(api.suggestColumnMap).mockResolvedValue({
      headers: ['Type'],
      columns: [{ header: 'Type', candidates: [{ target: 'level', display: null, score: 1, confidence: 'exact' }] }],
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3,
      unmapped: { level: ['Zonal Hospital', 'District Clinic'], status: [], country: [] },
      notValidated: ['status'],
    }));

    // Review REPORTS the finding and offers nothing to click.
    expect(await screen.findByText(/values with no canonical mapping/i)).toBeInTheDocument();
    expect(screen.getByText(/map them on the mapping step/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Zonal Hospital')).toBeNull();
    expect(screen.getByText(/not checked against a canonical value set.*Status/i)).toBeInTheDocument();

    // The pick-lists are on Mapping, where the deciding happens.
    await backToMapping();
    // ⛔ VALUE mapping, not column mapping. `valueMap.notMapped` is a different key from
    // `columnMap.notMapped` and did NOT change: a value with no canonical mapping is genuinely
    // unmapped and imports as-is, whereas an unmapped COLUMN is kept as extra data.
    expect(await screen.findByLabelText('Zonal Hospital')).toHaveTextContent('Not mapped');
    expect(screen.getByLabelText('District Clinic')).toHaveTextContent('Not mapped');
  });

  // The operator's report: "only after I press validate all, it moves to review, then I click back
  // to mapping". Moving to Review is deliberate, it is where the check's progress is watched. What
  // was missing is a way back to the work. Review told them where to go and gave them nothing to
  // press, so they had to find the step strip themselves.
  //
  // Sending them back automatically was considered and rejected, by the operator, on the grounds
  // that an unmapped value is a WARNING and never blocks: importing with values left unmapped is a
  // supported outcome, so a sheet that bounced them to Mapping on every check would turn that
  // warning into a soft block they could never clear.
  // Task 6: moved with the test above. Needs a header claiming `level` for the worklist `Zonal
  // Hospital` now renders under to exist at all (see that test's own comment).
  it('offers a way back to Mapping from the values Review reports, rather than only naming the step', async () => {
    mocked(api.suggestColumnMap).mockResolvedValue({
      headers: ['Type'],
      columns: [{ header: 'Type', candidates: [{ target: 'level', display: null, score: 1, confidence: 'exact' }] }],
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, create: 3,
      unmapped: { level: ['Zonal Hospital', 'District Clinic'], status: [], country: [] },
    }));

    fireEvent.click(await screen.findByRole('button', { name: /map these values/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /3\s*Mapping/ }))
      .toHaveAttribute('aria-current', 'step'));
    // And the worklist is there waiting, which is the point of going.
    expect(await screen.findByLabelText('Zonal Hospital')).toBeInTheDocument();
  });

  it('CT-3: renders a JSONL release\'s declared/parsed count mismatch', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 2998, create: 2998,
      countMismatch: [{ field: 'rowCount', declared: 3000, parsed: 2998 }],
    }));

    expect(await screen.findByText(/declared counts do not match/i)).toBeInTheDocument();
    expect(screen.getByText(/this release declares 3000 row\(s\); 2998 were actually parsed/i)).toBeInTheDocument();
  });

  // ── CT-3: the apply result finally shows what happened to conflicting rows ──────────────────────
  // Before this fix, a row edited between preview and apply was classified `conflict`, skipped (or
  // overwritten) by the write, and then vanished from the screen entirely: the applied-result block
  // rendered only `written.created`/`written.updated`/`skipped`. This is the FAC-P1-03 defect class
  // this whole branch exists to close, surviving in the UI.

  it('CT-3: the apply result shows the conflict count and sample when rows were skipped (the default policy)', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({
      parsed: 3, written: { created: 0, updated: 1, retired: 0 }, conflict: 2,
      samples: { create: [], changed: [], absent: [], deleted: [], conflict: [{ id: 'f1', nationalCode: 'C1', name: 'Dodoma RRH' }] },
    }), { status: 'applied' });

    expect(await screen.findByText(/2 row\(s\) changed since the preview were left as-is/i)).toBeInTheDocument();
    expect(screen.getByText(/Dodoma RRH \(C1\)/)).toBeInTheDocument();
  });

  it('CT-3: the apply result honestly says "overwritten", not "skipped", once the operator chose overwrite', async () => {
    // ⛔ ARRANGED BY HAND. This is the one applied-result test whose wording depends on a CHOICE the
    // operator makes before confirming, so it needs both run states in order: the validate the
    // choice is made against, then the apply it produced. `reviewWithSummary` mocks one state.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({
        status: 'awaiting_confirmation', phase: 'validated',
        summary: baseResult({ parsed: 3, create: 2, conflict: 1 }),
      }))
      .mockResolvedValue(runView({
        status: 'applied',
        summary: baseResult({
          parsed: 3, written: { created: 0, updated: 1, retired: 0 }, conflict: 1,
          samples: { create: [], changed: [], absent: [], deleted: [], conflict: [{ id: 'f1', nationalCode: 'C1', name: 'Dodoma RRH' }] },
        }),
      }));
    mocked(api.confirmFacilityImportRun).mockResolvedValue({ runId: 'run-b1', status: 'confirmed' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await waitFor(() => expect(screen.getByRole('button', { name: /4\s*Review/ }))
      .toHaveAttribute('aria-current', 'step'));

    await backToMapping();
    fireEvent.click(await screen.findByRole('combobox', { name: /rows changed since this preview/i }));
    fireEvent.click(await screen.findByRole('option', { name: /overwrite them/i }));
    // The conflict policy is in neither signature, so the summary survived the change and one step
    // forward is all this needs.
    forwardToReview();

    confirmNow();

    expect(await screen.findByText(/1 row\(s\) changed since the preview were overwritten by this import/i)).toBeInTheDocument();
    expect(screen.queryByText(/were left as-is/i)).not.toBeInTheDocument();
  });

  it('CT-3: the apply result stays silent about conflicts when there were none', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(
      baseResult({ parsed: 3, written: { created: 3, updated: 0, retired: 0 } }),
      { status: 'applied' },
    );

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

    // ONE call: Source's own store, which already carries the file, format and release version
    // (all set on Source before Continue). Mapping's validate goes through
    // `revalidateFacilityImportRun` instead (see `uploadNow`'s own comment).
    await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1));
    // ⛔ `expect.any(File)` is the assertion that matters: the browser hands the File over as the
    // request body. A `csv: '<string>'` here would be the `f.text()` path this task removes.
    expect(api.uploadFacilityImport).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.any(File), nationalSystem: 'HFR', format: 'jsonl', releaseVersion: 'r7',
      }),
      expect.any(Function),
    );
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

    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();
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
    await backToMapping();
    fireEvent.click(await screen.findByRole('combobox', { name: /rows this file says were removed/i }));
    fireEvent.click(await screen.findByRole('option', { name: /report only/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /rows missing from this file/i }));
    fireEvent.click(await screen.findByRole('option', { name: /retire them/i }));
    fireEvent.click(screen.getByRole('combobox', { name: /rows changed since this preview/i }));
    fireEvent.click(await screen.findByRole('option', { name: /overwrite them/i }));
    forwardToReview();

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
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await backToMapping();
    fireEvent.click(screen.getByRole('checkbox', { name: /import anyway/i }));
    // `allowMalformedRows` is in NEITHER signature, so the summary survives the tick and Confirm,
    // which lives on Review, is one step away rather than a re-upload away.
    forwardToReview();
    confirmNow();

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
    // something. (`Register a source` here, `Close` after the run finished — the close item's own
    // label switches to Close once `runFinished`.)
    //
    // ⛔ `Upload and validate` used to be this control and no longer can be: it is Mapping's visible
    // button now, and appears in this menu only on Review. `Register a source` is in this menu at
    // every step, which is exactly what a positive control needs to be.
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Register a source' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();
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

    // ONE call: Source's own store, which reads the same Source-scoped state and so carries the
    // declaration. Mapping's validate goes through `revalidateFacilityImportRun` instead (see
    // `uploadNow`'s own comment).
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

    // ONE call: Source's own store. Mapping's validate goes through `revalidateFacilityImportRun`
    // instead (see `uploadNow`'s own comment).
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
    // This refusal is not a column-map one, so the sheet's own retreat effect never fires — the run
    // reaching Review on its own, proven only indirectly by the assertions below until now.
    expect(screen.getByRole('button', { name: /4\s*Review/ })).toHaveAttribute('aria-current', 'step');
    // ⛔ …and the tick that could only 409 is gone, replaced by the path that actually works.
    expect(screen.queryByRole('checkbox', { name: /keeping unrecognised columns/i })).not.toBeInTheDocument();
    expect(screen.getByText(/the check has to run again with it/i)).toBeInTheDocument();
    openMenu();
    // ⛔ The completable path IS offered...
    expect(screen.getByRole('menuitem', { name: 'Check again keeping unrecognised columns' })).toBeInTheDocument();
    // ...and the one that could only ever write nothing is NOT. `canConfirmRun` reads the same
    // `blocked` verdict the confirm route enforces, so the studio and the server now agree about
    // this file instead of the studio offering what the server would refuse.
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
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
    // ONE upload mints the run: Source's own store. Mapping's own validate (`uploadNow`'s last
    // click) and the later "check again" both check that SAME run through
    // `revalidateFacilityImportRun`, never a second upload.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({
        id: 'run-b1', status: 'awaiting_confirmation',
        // `blockedReason` added: this fixture stands for a file with NO column map, the case that
        // still refuses, and `importFacilities` really does set the reason for it. The re-upload is
        // now offered on that verdict rather than on a populated list, because with a map present
        // the columns were kept and re-uploading would change nothing.
        summary: baseResult({
          parsed: 0, unknownColumns: ['ward_code'],
          blocked: true, blockedReason: 'unknown-columns',
        }),
      }))
      // ⛔ The re-check's own poll is asked for and NEVER ANSWERS. That is what makes the assertions
      // at the end of this test discriminating: the only thing that can clear the superseded run's
      // summary in that window is the sheet dropping it itself (`setRun(null)` in `handleRevalidate`).
      // With a mock that answers promptly, a poll would replace `run` either way and the assertion
      // would pass whether or not the sheet dropped anything — measured, it did.
      .mockReturnValue(new Promise<never>(() => { /* never settles */ }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/ward_code/);

    // The upload (Source's store) carried no override. Mapping's own first validate is what
    // carried `allowUnknownColumns: false`, through `revalidateFacilityImportRun`, not this call.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
    expect(api.revalidateFacilityImportRun).toHaveBeenNthCalledWith(
      1, 'run-b1', expect.objectContaining({ allowUnknownColumns: false }),
    );

    clickMenuItem('Check again keeping unrecognised columns');

    // ⛔ THE FILE IS NOT SENT AGAIN. Plan B's route re-checks the blob the run already stored, so
    // the override reaches the validate that produces the next summary without a second upload of a
    // register that can run to tens of thousands of rows.
    await waitFor(() => expect(api.revalidateFacilityImportRun).toHaveBeenCalledTimes(2));
    expect(api.revalidateFacilityImportRun).toHaveBeenNthCalledWith(
      2, 'run-b1', expect.objectContaining({ allowUnknownColumns: true }),
    );
    // Still the ONE upload `uploadNow` made (Source's store). Both validates above went through
    // `revalidateFacilityImportRun`, never a second upload.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
    // ⛔ And the superseded run's summary — with its Confirm — leaves the screen rather than inviting
    // a decision about a run the register no longer belongs to.
    expect(await screen.findByText(/checking the import run/i)).toBeInTheDocument();
    expect(screen.queryByText(/ward_code/)).not.toBeInTheDocument();
    openMenu();
    // Positive control on the same open menu, so the absence beside it means something.
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
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

    // ⛔ Was asserting a JSONL-specific message that no longer exists. A JSONL release never sets
    // `blockedReason: 'unknown-columns'`, so it now takes the same "kept as extra data" note every
    // other non-blocking case takes. The test's own name already promised exactly that.
    expect(await screen.findByText(/Kept as extra data/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is imported unless you opt in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/the check has to run again with it/i)).not.toBeInTheDocument();
    // Confirm is Review's visible BUTTON now, so it is asserted before the menu opens: Radix marks
    // the rest of the page aria-hidden while a modal menu is up, which would hide it.
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();
    openMenu();
    // The positive control, so the absences below are not those of a menu that never opened. Cancel
    // is always in this menu, which makes it the right control now that Confirm has left it.
    expect(screen.getByRole('menuitem', { name: 'Cancel this import' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Check again keeping unrecognised columns' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /keeping unrecognised columns/i })).not.toBeInTheDocument();
  });

  // The invalid-coordinate half: no format branch (both parsers honour it), and once the run HAS run
  // with it there is nothing left to re-upload for — the box says so instead of offering a second
  // identical upload.
  it('A2b: the invalid-coordinate override is a re-upload too, and disappears once the run already ran with it', async () => {
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    const summary = baseResult({
      parsed: 2, create: 2,
      invalid: [{ line: 3, field: 'latitude', reason: 'out_of_range', raw: '999' }],
    });
    // ⛔ ONE RUN, not two. A re-check reuses the run and its stored file, so the second poll answers
    // for the SAME id with the override now recorded in its options. Modelling it as a second run
    // would be modelling the re-upload this route replaced.
    mocked(api.getFacilityImportRun)
      .mockResolvedValueOnce(runView({ id: 'run-b1', status: 'awaiting_confirmation', summary }))
      .mockResolvedValue(runView({
        id: 'run-b1', status: 'awaiting_confirmation', summary,
        options: { nationalSystem: 'HFR', allowInvalidCoordinates: true },
      }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    expect(await screen.findByText(/the check has to run again with it/i)).toBeInTheDocument();

    clickMenuItem('Check again keeping rows with an invalid coordinate');

    // Re-checked, not re-uploaded: the stored file is reused. Two calls total: `uploadNow`'s own
    // first validate, then this one.
    await waitFor(() => expect(api.revalidateFacilityImportRun).toHaveBeenCalledTimes(2));
    expect(api.revalidateFacilityImportRun).toHaveBeenNthCalledWith(
      2, 'run-b1', expect.objectContaining({ allowInvalidCoordinates: true }),
    );
    // Still the ONE upload `uploadNow` made (Source's store). Both validates above went through
    // `revalidateFacilityImportRun`, never a second upload.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);

    // The second run's stored options say the validate ran with it, so the notice changes and the
    // menu item retires — a second identical check would change nothing.
    expect(await screen.findByText(/already ran with that option on/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Check again keeping rows with an invalid coordinate' })).not.toBeInTheDocument();
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

    await backToMapping();
    fireEvent.click(await screen.findByRole('checkbox', { name: /skipping the rows that could not be read/i }));
    forwardToReview();

    confirmNow();

    await waitFor(() => expect(api.confirmFacilityImportRun).toHaveBeenCalledTimes(1));
    expect(api.confirmFacilityImportRun).toHaveBeenCalledWith('run-b1', { allowMalformedRows: true });
  });

  // ⛔ IN THE SHEET BODY. Radix unmounts the ⋯ menu when its item is selected, so a percentage shown
  // only on the menu item is invisible for the entire transfer — which is the one thing the XHR
  // client gives up `fetch` for.
  // ⛔ SOURCE'S OWN STORE, not Mapping's validate. `revalidateFacilityImportRun` (`api.ts`) sends a
  // small JSON body and takes no progress callback at all. There is no byte transfer left to
  // measure once Mapping's validate stopped re-sending the file. Source's Continue is the one call
  // that still streams the whole register, so it is the one this test can still watch progress on.
  it('A2b: the upload percentage is rendered where the operator can see it, not only on the menu item', async () => {
    let report: ((f: number | null) => void) | undefined;
    mocked(api.uploadFacilityImport).mockImplementation((_p: unknown, onProgress: unknown) => {
      report = onProgress as (f: number | null) => void;
      return new Promise<never>(() => { /* never settles: the upload stays in flight */ });
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

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
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,Name\n1835,Namatindi RHC\n');
    // The column map lives on Mapping (step 3). Continue stores the file and lands on Data first,
    // so reaching it now costs the extra strip click `advanceToMapping` makes.
    await advanceToMapping();
    // If the sheet fed `onChange` into anything OTHER than `columnMap` state directly — a debounce,
    // a batched update, a dropped call — the seed `ColumnMapStep` computes on mount would never land
    // back in `value`, and both rows would still read "Not mapped" here (this is exactly the bug
    // ColumnMapStep's own fix pass closed — see that file's docblock).
    expect(await screen.findByLabelText('MFL Code')).toHaveTextContent('national_code');
    expect(screen.getByLabelText('Name')).toHaveTextContent('name');

    await uploadNow();
    // ⛔ The map reaches `revalidateFacilityImportRun`, NOT `uploadFacilityImport`: this run is
    // `stored` (Source's own store-only call never carried a map, since none existed yet), so
    // Mapping's own first validate is the FIRST validate this run gets, through the run door.
    await waitFor(() => expect(api.revalidateFacilityImportRun).toHaveBeenCalledWith(
      'run-b1',
      expect.objectContaining({
        columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' }, constants: {}, extras: [] },
      }),
    ));
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
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,Name\n1835,Namatindi RHC\n');
    await advanceToMapping();
    expect(await screen.findByLabelText('MFL Code')).toHaveTextContent('national_code');

    // The File input lives on Source, not Mapping — go back to reach it, pick a DIFFERENT file
    // (headers the first file's mapping decisions know nothing about), then store and reach Mapping
    // again to see the panel react to it. Picking a new file drops the first file's stored run
    // (`selectFile`'s own `setRunId(null)`), so this is a second store, not a re-upload.
    fireEvent.click(screen.getByRole('button', { name: /1\s*Source/ }));
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [csvFile('Code,Facility Name\nX,Y\n')] },
    });
    await advanceToMapping();

    expect(await screen.findByLabelText('Code')).toHaveTextContent('Keep as extra data');
    expect(screen.queryByLabelText('MFL Code')).not.toBeInTheDocument();

    await uploadNow();
    // ⛔ THE FIX, PROVEN: without the reset, `columnMap.columns` would still carry
    // `{'MFL Code':'national_code', Name:'name'}` from the FIRST file — entries keyed on headers this
    // file does not even have — and the run would have been validated against a map the server's
    // own `validateColumnMap` would then refuse (`missing_required` for `national_code`/`name`, since
    // no header of THIS file actually claims them). Nothing was ever chosen for the second file, so
    // no columnMap is sent at all. Asserted on `revalidateFacilityImportRun`, the second file's own
    // first validate, not on either store call (which never carries a map at all).
    await waitFor(() => expect(api.revalidateFacilityImportRun).toHaveBeenCalledWith(
      'run-b1', expect.objectContaining({ columnMap: undefined }),
    ));
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
    // ⛔ ARRANGED BY HAND, NOT THROUGH `reviewWithSummary`. That helper waits for Review to become
    // the current step, and this test's whole subject is a refusal that deliberately does NOT get
    // there. Using it here would hang for the full timeout and then report the wrong thing.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation', phase: 'validated',
      summary: baseResult({
        blocked: true, blockedReason: 'column-map',
        columnMapErrors: [
          { reason: 'duplicate_target', subject: 'MFL Code 2', target: 'national_code', other: 'MFL Code' },
        ],
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('MFL Code,MFL Code 2\n1,2\n');
    await advanceToMapping();
    await screen.findByLabelText('MFL Code');
    await uploadNow();

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
    expect(screen.getByRole('button', { name: /3\s*Mapping/ })).toHaveAttribute('aria-current', 'step');
  });

  it('does not render the columnMapErrors block, or keep the panel mounted, once the file parses cleanly', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['MFL Code', 'Name'],
      columns: [
        { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await reviewWithSummary(baseResult({ parsed: 3, create: 3 }), {}, 'MFL Code,Name\n1835,Namatindi RHC\n');

    await screen.findByText(/facility row\(s\) will be created/i);
    expect(screen.queryByText(/both map to/)).not.toBeInTheDocument();
    // Whole-branch review, FINDING 5: this does NOT credit the panel's own render gate for the
    // absence below. A clean summary puts the sheet on Review (step 4), so
    // `queryByLabelText('MFL Code')` is absent because `step !== 3`, not because
    // `columnMapPanelShown`'s own clause excluded it while still on Mapping. The "keeps
    // ColumnMapStep mounted through a refusal" test above is the one that actually exercises that
    // clause, by staying on step 3 the whole time.
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

  it('shows a non-blocking notice while the column map is incomplete, without disabling Upload', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['Code', 'Facility Name'],
      columns: [{ header: 'Code', candidates: [] }, { header: 'Facility Name', candidates: [] }],
    });
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'validating' }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem('Code,Facility Name\nA,B\nC,D\n');
    // The row-count hint and the notice both live in ColumnMapStep, on Mapping (step 3).
    await advanceToMapping();

    // onValidityChange wired: neither header satisfies a required field, so the notice shows.
    expect(await screen.findByText(/still preview or upload/i)).toBeInTheDocument();

    // ...and it does not block anything — `uploadNow` itself waits for Upload to become enabled,
    // so this line is the proof: it would time out were Upload gated on validity.
    await uploadNow();
    expect(api.uploadFacilityImport).toHaveBeenCalled();
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
    await advanceToMapping();
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
      expect(screen.getByRole('button', { name: /3\s*Mapping/ })).toHaveAttribute('aria-current', 'step');
    });
    expect(screen.getByLabelText('Province')).toBeInTheDocument();
    expect(screen.getByLabelText('Zone')).toBeInTheDocument();

    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Check again with the corrected map' })).toBeInTheDocument();
  });

  it('⛔ re-uploads the corrected map, so the validate reviewed is the one the operator fixed', async () => {
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['Province', 'Zone'],
      columns: [
        { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Zone', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    // ONE run, minted by Source's store. Mapping's own first validate (from `uploadNow`) and the
    // later "check again with the corrected map" both check that SAME run.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
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
      // Same discipline as the unknown-columns re-upload test above: the second validate's own poll
      // never answers, so nothing but the sheet's own `setRun(null)` can clear the superseded summary.
      .mockReturnValue(new Promise<never>(() => { /* never settles */ }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();
    await screen.findByText(/both map to "zone"/);
    // Round-2 fix: the sheet retreats to Mapping once the refusal is known — see the "keeps
    // ColumnMapStep mounted" test above for why this needs its own wait. The panel is on screen
    // once this settles, no back-click needed to reach it.
    await waitFor(() => expect(screen.getByRole('button', { name: /3\s*Mapping/ })).toHaveAttribute('aria-current', 'step'));

    // Fix it in place: send Zone to extras, which is what actually releases its passthrough claim.
    fireEvent.click(screen.getByLabelText('Zone'));
    fireEvent.click(await screen.findByRole('option', { name: 'Keep as extra data' }));

    clickMenuItem('Check again with the corrected map');

    // ⛔ The CORRECTED MAP reaches the validate, and the file does not move: this is the case plan
    // B exists for, since a column-map refusal on a national register used to cost a full re-upload
    // to fix one header. Two calls total: `uploadNow`'s own first validate, then this one.
    await waitFor(() => expect(api.revalidateFacilityImportRun).toHaveBeenCalledTimes(2));
    expect(mocked(api.revalidateFacilityImportRun).mock.calls[1][1]).toEqual(
      expect.objectContaining({ columnMap: expect.objectContaining({ extras: ['Zone'] }) }),
    );
    // ONE call: Source's own store. Both validates above went through `revalidateFacilityImportRun`,
    // never a second upload.
    expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
  });

  // ⛔ CRITICAL, code review: the reachability regression the widened step model shipped with.
  // `hasStoredFile` used to be hardcoded `true`, so `furthestStep` reached 3 the moment a file and
  // a register were picked, before any upload, while the sheet's own content still rendered
  // Mapping at `step === 2` and Review at `step === 3`. Clicking strip position 3, labelled
  // "Mapping", actually showed REVIEW'S content: an operator could reach "Confirm import" with an
  // "Upload and validate" action and no column map ever shown. This test pins the fix directly: it
  // fails against the old code (Mapping reachable pre-upload, and its strip position rendering
  // Review) and passes only once the sheet's own step numbers agree with the strip's labels.
  it('picking a file and a register alone does not open Mapping, and Mapping never renders as Review', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();

    // Before ANY upload, Data, Mapping and Review must all stay behind Source. This is exactly
    // what the hardcoded `hasStoredFile: true` broke: it earned Mapping's strip position on a
    // file and a register alone.
    expect(screen.getByRole('button', { name: /2\s*Data/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /3\s*Mapping/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /4\s*Review/ })).toBeDisabled();

    // Storing the file (Continue) opens Data and earns Mapping, but not Review, which needs a
    // real validate the operator has not asked for yet.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
      .toHaveAttribute('aria-current', 'step'));
    expect(screen.getByRole('button', { name: /3\s*Mapping/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /4\s*Review/ })).toBeDisabled();

    // The regression, pinned directly: strip position 3 must render MAPPING'S content, its own
    // validate action, never Review's verdict screen with no column map in sight.
    fireEvent.click(screen.getByRole('button', { name: /3\s*Mapping/ }));
    expect(await screen.findByRole('button', { name: 'Validate all' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    expect(screen.queryByText(/review the summary below/i)).not.toBeInTheDocument();
  });

  // ⛔ AN ABANDONED SOURCE STEP MUST HAVE A WAY OUT. Continue now mints a run holding the register's
  // `active_key`, and a `stored` run is never polled, so `run` stays null and `runActive` false.
  // Gated on `runActive` alone, the ⋯ menu offered the operator who changed their mind nothing at
  // all, and the register stayed locked with no affordance on screen. Closing the sheet does not
  // release it.
  it('offers Cancel for a stored run, which is never polled', async () => {
    mocked(api.cancelFacilityImportRun).mockResolvedValue({ runId: 'run-default', outcome: 'cancelled' });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
      .toHaveAttribute('aria-current', 'step'));

    clickMenuItem('Cancel this import');
    await waitFor(() => expect(api.cancelFacilityImportRun).toHaveBeenCalledWith('run-default'));
  });

  it('does not offer Cancel before anything is stored', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Cancel this import' })).not.toBeInTheDocument();
  });

  describe('the step shell', () => {
    it('starts on Source and does not show the mapping panel yet', async () => {
      mocked(api.suggestColumnMap).mockResolvedValue({ headers: [], columns: [] });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      expect(await screen.findByRole('button', { name: /1\s*Source/ }))
        .toHaveAttribute('aria-current', 'step');
      expect(screen.getByRole('button', { name: /2\s*Data/ })).toBeDisabled();
    });

    // Fix for the reachability regression: Continue used to open Mapping directly. It now stores
    // the file first and lands on Data, so the column map is one more click away, on Mapping.
    it('Continue stores the file and opens Data; Mapping shows the column map once reached', async () => {
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

      await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
        .toHaveAttribute('aria-current', 'step'));
      expect(screen.queryByLabelText('MFL Code')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /3\s*Mapping/ }));
      expect(await screen.findByLabelText('MFL Code')).toBeInTheDocument();
    });

    // The register picker and the file input belong to step 1 and must not be on screen past it:
    // leaving them there is what made five stages read as one scrolling surface.
    it('hides the source inputs once past Source', async () => {
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
        .toHaveAttribute('aria-current', 'step'));

      expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'National system' })).not.toBeInTheDocument();
    });

    it('goes back to Source and shows those inputs again', async () => {
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
        .toHaveAttribute('aria-current', 'step'));
      fireEvent.click(screen.getByRole('button', { name: /1\s*Source/ }));

      expect(await screen.findByLabelText('File')).toBeInTheDocument();
    });

    // Task 6: Data used to render nothing at all. `DataGridStep` (Task 5) reads the stored file's
    // own rows, so the operator can see what they uploaded before they map a single column.
    it('Continue lands on Data, and Data shows the stored file on screen', async () => {
      mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-a' });
      mocked(api.readFacilityImportRows).mockResolvedValue({
        headers: ['MFL Code', 'Name'], rows: [['100001', 'Chunga Clinic']], offset: 0, limit: 100, total: 1,
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
        .toHaveAttribute('aria-current', 'step'));
      expect(await screen.findByText('Chunga Clinic')).toBeInTheDocument();
      expect(api.readFacilityImportRows).toHaveBeenCalledWith('run-a', { offset: 0, limit: 100 });
    });

  });

  // Whole-branch review, FINDING 2: `ColumnMapStep` is the only thing gated to Mapping (step 3,
  // renumbered by the reachability fix above), so every state that hides it (a JSONL release, or
  // a map that has already been sent and cannot be changed here any more) left Mapping a blank
  // pane with no explanation at all.
  describe('when Mapping has nothing to show', () => {
    it('says a JSONL release has no column map to set', async () => {
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      fireEvent.click(screen.getByRole('combobox', { name: /file format/i }));
      fireEvent.click(await screen.findByRole('option', { name: /jsonl release/i }));
      await advanceToMapping();

      expect(await screen.findByText(/no column map to set/i)).toBeInTheDocument();
      expect(screen.queryByLabelText('MFL Code')).not.toBeInTheDocument();
    });

    it('says a CSV file\'s map was already sent, once a clean preview has moved past Mapping', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code', 'Name'],
        columns: [
          { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
          { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
        ],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await reviewWithSummary(baseResult({ parsed: 3, create: 3 }), {}, 'MFL Code,Name\n1835,Namatindi RHC\n');
      await screen.findByText(/facility row\(s\) will be created/i);

      // The clean summary auto-advances to Review, so go back to Mapping.
      fireEvent.click(screen.getByRole('button', { name: /3\s*Mapping/ }));

      // ⛔ THIS TEST USED TO ASSERT THE OPPOSITE: that Mapping had no panel to show and said so,
      // "already been sent with the upload". True at the time, and useless to the operator who
      // reported it: going back landed on a step that explained itself and offered nothing to do.
      // Going back is only worth offering if something can change there, so the panel stays.
      expect(screen.getByLabelText('MFL Code')).toBeInTheDocument();
      expect(screen.queryByText(/already been sent with the upload/i)).not.toBeInTheDocument();
      // ...and the step has an action again: "Validate all", the same label Mapping always shows
      // once a run exists. There is no first-upload label left to fall back to (Mapping is only
      // ever reached after Source has already stored the file).
      const validateAgain = screen.getByRole('button', { name: 'Validate all' });
      expect(validateAgain).toBeInTheDocument();

      // Task 6: the run is already `awaiting_confirmation` (see `reviewWithSummary`'s mock), so
      // clicking here goes through `revalidateFacilityImportRun` again, a second check against the
      // blob already on the server, rather than a SECOND `uploadFacilityImport` of the same file.
      // `reviewWithSummary`'s own `uploadNow` already made the FIRST `revalidateFacilityImportRun`
      // call (Mapping's first validate, per Task 6's own fix), so this is the second.
      fireEvent.click(validateAgain);
      await waitFor(() => expect(api.revalidateFacilityImportRun).toHaveBeenCalledTimes(2));
      expect(api.uploadFacilityImport).toHaveBeenCalledTimes(1);
    });
  });

  describe('the primary action', () => {
    // Fix for the reachability regression: Continue's own click now lands on Data, which has no
    // primary action of its own yet (a later task adds one alongside the grid). Mapping is where
    // the re-upload action actually shows, one strip click further on.
    it('offers Continue on Source, nothing yet on Data, and a re-upload action on Mapping', async () => {
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

      await waitFor(() => expect(screen.getByRole('button', { name: /2\s*Data/ }))
        .toHaveAttribute('aria-current', 'step'));
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Upload and validate' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Validate all' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /3\s*Mapping/ }));
      // Mapping's own button can no longer read "Upload and validate": Mapping is only ever
      // reachable once `runId` is already set (Source's store is what earns `hasStoredFile`), so
      // this reads "Validate all" from the moment it first renders.
      expect(await screen.findByRole('button', { name: 'Validate all' })).toBeInTheDocument();
    });

    // The whole point of the exception to AGENTS.md section 5: the action that advances is visible,
    // and it is the ONLY visible one. Everything else stays in the dropdown.
    // ⛔ THE ONLY TEST IN THE SUITE THAT ASSERTS THE INLINE DOOR IS GONE. Everything else here
    // describes what the wizard does; this one pins what it no longer offers. Mapping used to carry
    // a second way to check the same file, and Review a second way to write it, neither of them a
    // visible button. One action per step means the menu does not quietly hold a rival.
    it('shows exactly one primary action, and the menu offers no second way to check or apply', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code'],
        columns: [{ header: 'MFL Code', candidates: [] }],
      });
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      await advanceToMapping();
      await screen.findByRole('button', { name: 'Validate all' });

      expect(screen.queryByRole('button', { name: /^Preview$/ })).not.toBeInTheDocument();
      openMenu();
      expect(screen.queryByRole('menuitem', { name: /^Preview$/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^Apply$/ })).not.toBeInTheDocument();
    });

    it('Continue stays disabled until a file and a register are both chosen', async () => {
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
    });

    // Whole-branch review, FINDING 1(a): this button used to check only `uploadDisabled`, unlike
    // the dropdown's own Upload item (`!applyResult && !runId`). Once a run reaches a terminal
    // state `runActive` goes false and the step strip lets the operator click back to Mapping — this
    // proves the button the dropdown would never offer is not there for them to click either.
    it('does not offer Upload and validate again on Mapping once the run has finished', async () => {
      mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
      mocked(api.getFacilityImportRun).mockResolvedValue(runView({
        status: 'applied', summary: baseResult({ parsed: 3, written: { created: 3, updated: 0, retired: 0 } }),
      }));
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem();
      await uploadNow();
      await screen.findByText(/import complete/i);

      // The run finished, so Back is offered again (`canGoBack`) and the step strip reopens.
      fireEvent.click(screen.getByRole('button', { name: /3\s*Mapping/ }));

      expect(screen.queryByRole('button', { name: 'Upload and validate' })).not.toBeInTheDocument();
    });

    // Whole-branch review, FINDING 1(b): the gate above would otherwise leave Mapping with no
    // action at all in the one case an operator most needs one — a column-map refusal parks them
    // here with `runId` already set. The primary action becomes the same re-upload the dropdown
    // already offers as `reuploadColumnMapAction`, reusing its label and handler.
    it('offers the corrected-map re-upload as Mapping\'s primary action on a column-map refusal', async () => {
      mocked(api.suggestColumnMap).mockResolvedValueOnce({
        headers: ['MFL Code', 'MFL Code 2'],
        columns: [
          { header: 'MFL Code', candidates: [] },
          { header: 'MFL Code 2', candidates: [] },
        ],
      });
      mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
      mocked(api.getFacilityImportRun).mockResolvedValue(runView({
        status: 'awaiting_confirmation',
        summary: baseResult({
          blocked: true, blockedReason: 'column-map',
          columnMapErrors: [
            { reason: 'duplicate_target', subject: 'MFL Code 2', target: 'national_code', other: 'MFL Code' },
          ],
        }),
      }));
      render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

      await pickFileAndSystem('MFL Code,MFL Code 2\n1,2\n');
      await uploadNow();

      await waitFor(() => {
        expect(screen.getByText(/"MFL Code 2" and "MFL Code" both map to "national_code"/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /3\s*Mapping/ })).toHaveAttribute('aria-current', 'step');
      });
      expect(screen.getByRole('button', { name: 'Check again with the corrected map' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Upload and validate' })).not.toBeInTheDocument();
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

  // ── A column map is the decision about every column, so what `unknownColumns` MEANS depends on
  // whether one was present. Both sides are pinned here, because the split is the whole slice. ────

  it('⛔ reports kept columns as a note, not a warning, when a map decided them', async () => {
    // The Zambia file listed nine columns the operator had deliberately skipped, in an amber box
    // saying "Nothing is imported unless you opt in below". With a map that sentence is false: the
    // columns were kept and the rows imported.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 1, create: 1, unknownColumns: ['beds'], blocked: false, blockedReason: null,
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/Kept as extra data/i)).toBeInTheDocument();
    expect(screen.getByText(/beds/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is imported unless you opt in/i)).not.toBeInTheDocument();
    openMenu();
    // Nothing to re-upload FOR: the file was not refused.
    expect(screen.queryByRole('menuitem', { name: 'Check again keeping unrecognised columns' })).not.toBeInTheDocument();
  });

  it('still warns, and still offers the override, when NO map decided them', async () => {
    // The other half, and the reason the split reads the verdict rather than the list. With no map
    // the file really is refused, and the amber box plus its re-upload are the only way through.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 0, unknownColumns: ['beds'], blocked: true, blockedReason: 'unknown-columns',
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/Nothing is imported unless you opt in/i)).toBeInTheDocument();
    expect(screen.queryByText(/Kept as extra data/i)).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Check again keeping unrecognised columns' })).toBeInTheDocument();
  });
});

describe('the file drop zone', () => {
  // This describe sits outside the main suite, so it carries its own setup rather than borrowing
  // one that does not reach it.
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.listFacilityImportSources).mockResolvedValue([HFR_SOURCE]);
    mocked(api.suggestColumnMap).mockResolvedValue({ headers: [], columns: [] });
    mocked(api.suggestValueMappings).mockResolvedValue({ values: [], notValidated: false });
    mocked(api.writeFacilityValueMappings).mockResolvedValue({ written: 0, superseded: [] });
    // Fix for the reachability regression: Continue now stores the file, a real network call.
    // See the main suite's own `beforeEach` for why this is defaulted rather than arranged by
    // hand in every test that clicks it.
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-default' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({ status: 'stored' }));
    mocked(api.readFacilityImportRows).mockResolvedValue({
      headers: [], rows: [], offset: 0, limit: 100, total: 0,
    });
  });

  const dropZone = () => screen.getByRole('button', { name: /drag a \.csv/i });
  const drop = (el: HTMLElement, file: File) => fireEvent.drop(el, { dataTransfer: { files: [file] } });

  // ⛔ THE READ IS THE SUBJECT, not the suggestion it feeds. The sheet used to pull the whole file
  // into a JavaScript string so the inline door could put it in a JSON body. That door is gone, and
  // the only thing left that wants the file's TEXT is its header row, which `suggest-map` reads one
  // line of. A 64 MiB national register must not enter this tab at all.
  it('reads only the head of the file, never the whole register', async () => {
    mocked(api.suggestColumnMap).mockResolvedValue({ headers: ['MFL Code'], columns: [] });
    // A file whose text() would resolve to something far larger than its header row.
    const big = new File([`MFL Code\n${'x\n'.repeat(50_000)}`], 'big.csv', { type: 'text/csv' });
    const sliceSpy = vi.spyOn(big, 'slice');
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('File'), { target: { files: [big] } });

    await waitFor(() => expect(sliceSpy).toHaveBeenCalledWith(0, 64 * 1024));
  });

  // ⛔ THE SAME FILE, CHOSEN TWICE, USED TO EMPTY THE MAPPING STEP FOR GOOD. Reported by an
  // operator who clicked the drop target, picked the register export in the file dialog, then
  // dragged the same file onto the component as well. Mapping came up with no column map at all and
  // said the map "has already been sent with the upload", which was untrue: nothing had been
  // uploaded. They then uploaded with no map, and the importer refused all 21 columns as
  // unrecognised.
  //
  // `selectFile` clears `columnMapHeaders`, then reads the head. On the SECOND selection the head
  // text is byte-identical, so `setCsvHead` receives a string equal to the state it already holds,
  // React bails out of the update, `csvHead` never changes, and the effect keyed on it never
  // re-runs. The cleared header list is never refilled. MEASURED live against the real 3788-row
  // Zambia MFL export: one `suggest-map` request after the browse, and none at all after the drop.
  it('⛔ still offers the column map when the same file is chosen twice (browse, then drop)', async () => {
    mocked(api.suggestColumnMap).mockResolvedValue({
      headers: ['MFL Code', 'Name'],
      columns: [
        { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
        { header: 'Name', candidates: [{ target: 'name', display: null, score: 1, confidence: 'exact' }] },
      ],
    });
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    const contents = ['MFL Code,Name', '100001,Chunga Clinic', ''].join('\n');
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile(contents)] } });
    // ⛔ WAIT FOR THE FIRST READ TO LAND BEFORE DROPPING, or this test cannot see the bug. The
    // operator's first selection had long since resolved when they dragged the file in. Dropping
    // while `File.text()` is still pending leaves `csvHead` at `null`, so the second read changes it
    // and the effect fires anyway - which is why an earlier version of this test passed against the
    // broken code.
    await waitFor(() => expect(api.suggestColumnMap).toHaveBeenCalledTimes(1));
    // The same bytes again, the way the operator did it: a drag onto the component.
    drop(screen.getByRole('button', { name: /register\.csv/i }), csvFile(contents));
    // The header list was just cleared. Re-deriving it is the whole fix: identical head text must
    // not be mistaken for "nothing changed".
    await waitFor(() => expect(api.suggestColumnMap).toHaveBeenCalledTimes(2));

    const trigger = await screen.findByRole('combobox', { name: 'National system' });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: HFR_SOURCE.name }));
    await advanceToMapping();

    // The column map is on screen, and the sheet does not claim a map was already sent.
    expect(await screen.findByLabelText('MFL Code')).toBeInTheDocument();
    expect(screen.queryByText(/already been sent/i)).not.toBeInTheDocument();
  });

  // ⛔ NOTHING TO MAP MEANS DO NOT GO TO MAPPING. Raised by the operator while the same-file-twice
  // bug above was being fixed: both faults end on an empty Mapping step, and this one genuinely has
  // no columns. The parser refuses such a file anyway, so letting Continue through only spends a
  // 626 KB upload to learn that. Only a file whose FIRST LINE is empty lands here: a data-only CSV
  // still has a first line, whose values become the headers, and a 0-byte file has its own hint.
  it('⛔ refuses a csv whose header row cannot be read, on Source, instead of an empty Mapping step', async () => {
    // What the route does with such a head, mirrored by the client's own fallback split.
    mocked(api.suggestColumnMap).mockRejectedValue(new Error('no header row found in the supplied file'));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    const headerless = ['', '100001,Chunga Clinic', ''].join('\n');
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile(headerless)] } });

    expect(await screen.findByText(/no header row/i)).toBeInTheDocument();
    const trigger = await screen.findByRole('combobox', { name: 'National system' });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('option', { name: HFR_SOURCE.name }));
    // Even with a register chosen, this file cannot go forward.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled());
  });

  // ⛔ THE MESSAGE MUST NOT CLAIM AN UPLOAD THAT NEVER HAPPENED. One string used to cover five
  // states, so a hidden column map always read as "already sent with the upload" — which an
  // operator saw on a file they had not uploaded, and reasonably took to mean mapping was closed to
  // them. It may only say that when a run actually exists.
  it('⛔ only says the map went with the upload when a run actually exists', async () => {
    mocked(api.suggestColumnMap).mockRejectedValue(new Error('no header row found in the supplied file'));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [csvFile(['', '100001,Chunga Clinic', ''].join('\n'))] },
    });
    await screen.findByText(/no header row/i);

    expect(screen.queryByText(/already been sent/i)).not.toBeInTheDocument();
  });

  it('accepts a dropped csv and treats it exactly like a browsed one', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    drop(dropZone(), csvFile());
    expect(await screen.findByText(/register\.csv/)).toBeInTheDocument();
  });

  // ⛔ `accept` on the input governs the BROWSE dialog only; a browser applies none of it to a drop.
  // Without this check an operator could drop a .zip and watch it upload before the server refused.
  it('refuses a file it cannot read, and NAMES what was dropped', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    drop(dropZone(), new File(['x'], 'register.zip', { type: 'application/zip' }));
    expect(await screen.findByText(/that is a \.zip file/i)).toBeInTheDocument();
  });

  // A mis-drop must not destroy the good file chosen a moment earlier.
  it('keeps an already-chosen file when a later drop is the wrong type', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [csvFile()] } });
    await screen.findByText(/register\.csv/);

    drop(screen.getByRole('button', { name: /register\.csv/i }), new File(['x'], 'bad.zip'));

    expect(await screen.findByText(/that is a \.zip file/i)).toBeInTheDocument();
    expect(screen.getByText(/register\.csv/)).toBeInTheDocument();
  });

  // ⛔ It is a `role="button"` with a hidden input behind it, so the keyboard path is the only way a
  // non-mouse operator reaches the picker at all.
  it('opens the picker from the keyboard', async () => {
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    const input = screen.getByLabelText('File') as HTMLInputElement;
    const clicked = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.keyDown(dropZone(), { key: 'Enter' });
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
  });

  // ── The check survives the step strip ───────────────────────────────────────────────────────

  /** Reported from the real Zambia export: check a row, see it go red, click Data, click back to
   *  Mapping, and every icon is back to its opening state. `ColumnMapStep` is gated on
   *  `step === 3`, so leaving Mapping unmounted the whole panel and took its check results, its
   *  saved-value set and the operator's unsaved pick-list choices with it.
   *
   *  These drive the real panel end to end rather than asserting on props: the bug was entirely
   *  about WHERE the state lives, and a prop-level test would have passed before the fix. */
  async function mappingWithACheckedRow(): Promise<void> {
    mocked(api.suggestColumnMap).mockResolvedValue({
      headers: ['Type'],
      columns: [{ header: 'Type', candidates: [{ target: 'level', display: null, score: 1, confidence: 'exact' }] }],
    });
    mocked(api.readFacilityImportColumnValues).mockResolvedValue({
      values: ['1st Level Hospital', 'Others'], distinct: 2, truncated: false,
    });
    // Neither value resolves, so the row's own check finds two unrecognised values and goes red.
    mocked(api.suggestValueMappings).mockResolvedValue({
      values: [
        { value: '1st Level Hospital', candidates: [] },
        { value: 'Others', candidates: [] },
      ],
      notValidated: false,
      options: [{ code: 'hospital', display: 'Hospital' }],
    });

    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);
    await pickFileAndSystem('Type\n1st Level Hospital\n');
    await advanceToMapping();

    // `/^Type:/` picks the status button on purpose: the row's own ⋯ trigger is named "Actions for
    // Type" and a bare /Type/ would match both.
    fireEvent.click(await screen.findByRole('button', { name: /^Type:/ }));
    await screen.findByRole('button', { name: /Type:.*not recognised/i });
    await waitFor(() => expect(screen.getByRole('button', { name: /Type:.*not recognised/i })).toBeInTheDocument());
  }

  function goToStep(label: RegExp): void {
    fireEvent.click(screen.getByRole('button', { name: label }));
  }

  it('keeps a checked row red after a trip to Data and back, instead of resetting it', async () => {
    await mappingWithACheckedRow();

    goToStep(/2\s*Data/);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Type:/ })).not.toBeInTheDocument());
    goToStep(/3\s*Mapping/);

    expect(await screen.findByRole('button', { name: /Type:.*not recognised/i })).toBeInTheDocument();
  }, 20000);

  // The same unmount threw away pick-list choices the operator had made but not yet saved, which
  // is the more expensive half of the bug: an icon can be re-earned with one click, and twelve
  // re-typed value decisions cannot.
  it('keeps an unsaved value-mapping choice after a trip to Data and back', async () => {
    await mappingWithACheckedRow();

    const picker = await screen.findByRole('combobox', { name: /1st Level Hospital/i });
    fireEvent.keyDown(picker, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: /Hospital/ }));
    await waitFor(() => expect(picker).toHaveTextContent(/Hospital/));

    goToStep(/2\s*Data/);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Type:/ })).not.toBeInTheDocument());
    goToStep(/3\s*Mapping/);

    expect(await screen.findByRole('combobox', { name: /1st Level Hospital/i })).toHaveTextContent(/Hospital/);
  }, 20000);
});
