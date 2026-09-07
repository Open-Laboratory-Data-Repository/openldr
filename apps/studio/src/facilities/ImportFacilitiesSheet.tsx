import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  cancelFacilityImportRun,
  confirmFacilityImportRun,
  getFacilityImportRun,
  importFacilitiesCsv,
  listFacilityImportSources,
  suggestColumnMap,
  uploadFacilityImport,
  type ColumnMapError,
  type ColumnSuggestion,
  type ControlledField,
  type FacilityColumnMap,
  type FacilityImportConfirmOptions,
  type FacilityImportResult,
  type FacilityImportRunStatus,
  type FacilityImportRunView,
  type FacilityRegisterSource,
} from '@/api';
import { ColumnMapStep, CONTRACT_FIELDS } from './ColumnMapStep';
import { CONTROLLED_FIELDS } from './controlledFields';
import { ImportPolicyPanel } from './ImportPolicyPanel';
import { ValueMapPanel } from './ValueMapPanel';
import { summarySignature, worklistSignature, type ImportInputs } from './importInputsSignature';
import {
  ColumnMapErrorsNotice, ReconciliationSummary, willWrite, type ReuploadOverrides,
} from './ReconciliationSummary';
import { ImportSteps } from './ImportSteps';
import { RegisterSourceDialog } from './RegisterSourceDialog';
import { canGoBack, clampStep, furthestStep, type ImportStep } from './stepModel';


/** Task 8: the reset value for a freshly picked file — no header has been mapped, constant-filled or
 *  carried to extras yet. A single module-level constant, not re-literalled at every call site, so
 *  `handleFileChange`'s reset and `columnMap`'s own initial state can never drift apart. */
const EMPTY_COLUMN_MAP: FacilityColumnMap = { columns: {}, constants: {}, extras: [] };





// ── A2b Task 8: the background import run ─────────────────────────────────────────────────────────

/** The states a background run passes through while something is still going to happen to it.
 *
 *  ⛔ These same five are the keys under `facilities.import.runStatus` in every locale, because the
 *  status label is looked up with a DYNAMIC key (`runStatus.${status}`). A state rendered through
 *  that lookup without a matching key shows the raw key path to the operator, so the list and the
 *  copy have to move together. The three terminal states (`applied`/`failed`/`cancelled`) are
 *  deliberately absent: each has its own block below that says more than a label could, and
 *  `previewed` is the INLINE path's own state, which a run reached through this sheet's Upload can
 *  never enter (only `startPreview` writes it). */
const RUN_ACTIVE_STATUSES: FacilityImportRunStatus[] =
  ['queued', 'validating', 'awaiting_confirmation', 'confirmed', 'applying'];

/** Mirrors the server's `TERMINAL_RUN_STATES` (packages/db/src/facility-import-run-states.ts):
 *  nothing more will happen to a run here, and the cancel route 409s on one. */
const RUN_TERMINAL_STATUSES: FacilityImportRunStatus[] = ['applied', 'failed', 'cancelled'];

/** The states worth asking about again. `awaiting_confirmation` is deliberately NOT one: it is the
 *  state a run PARKS in for the operator, and nothing but their own Confirm (or a newer upload
 *  superseding it, which they will discover when the confirm 409s) moves it — polling it would be an
 *  unbounded request loop for a sheet nobody is touching. Every state a WORKER will move on its own
 *  is here, `confirmed` included: a confirm is not a promise the apply runs, so the run it hands over
 *  has to stay watched until it is terminal. */
const RUN_POLLED_STATUSES: FacilityImportRunStatus[] = ['queued', 'validating', 'confirmed', 'applying'];

/** Matches the import worker's own default poll interval (`createFacilityImportWorker`'s
 *  `intervalMs ?? 3000`), so the sheet asks at roughly the rate the run can actually change. */
const RUN_POLL_MS = 3000;

/** Task 8: is this `FacilityColumnMap` worth sending at all? `ColumnMapStep` seeds real entries into
 *  it the moment its headers are known (see that file's own fix-pass docblock), so in ordinary use
 *  this is only ever empty in the brief window before that seed lands (or for a JSONL release, which
 *  never renders the panel at all — see `columnMap`'s reset in `handleFileChange`).
 *
 *  ⛔ AN EMPTY MAP IS NOT THE SAME AS NO MAP. `validateColumnMap` (packages/terminology/src/
 *  facility-csv.ts) treats a PRESENT `columnMap` as authoritative: a header that already spells
 *  `national_code`/`name` verbatim still passes through and satisfies the required-field check on
 *  its own — but ONLY when nothing else claims it AND the map itself doesn't get in the way; sending
 *  `{ columns: {}, extras: [] }` with no operator decision behind it yet would misreport this file's
 *  own real headers as unmapped the instant the server route honours this field (see this file's own
 *  note on that gap). Same principle `confirmOptionsFor` already applies to every other override: a
 *  key sent for a control nobody has actually used is a decision nobody made. */
function hasColumnMapContent(map: FacilityColumnMap): boolean {
  return Object.keys(map.columns).length > 0
    || Object.keys(map.constants ?? {}).length > 0
    || (map.extras ?? []).length > 0;
}

/** The confirm request's body: EXACTLY the choices whose control the operator was actually shown,
 *  and no others.
 *
 *  ⛔ EVERY FIELD OF `FacilityImportConfirmOptions` IS OPTIONAL AND MUST STAY OPTIONAL ON THE WIRE.
 *  The server records only the keys a request actually carried (see `ConfirmSchema` and that route's
 *  own note) and merges them into durable `facility_import_runs.options` AND into the
 *  `facility.import.confirmed` audit metadata. Sending the whole set unconditionally writes the
 *  sheet's own defaults into both records as though an operator had chosen them — inert today,
 *  because those defaults equal `importFacilities`' own, but it is the same defect class as
 *  reporting `0` for a count nobody measured, which is what this whole workstream exists to remove.
 *
 *  ⛔ EACH TERM BELOW MIRRORS ITS OWN CONTROL'S RENDER GATE IN `ReconciliationSummary` — AND THE
 *  GATES ARE NOT ALL THE SAME SHAPE, WHICH IS THE WHOLE POINT. `allowMalformedRows` renders in its
 *  own amber block BEFORE and OUTSIDE the `result.parsed > 0` wrapper, gated on `quarantined` being
 *  non-empty alone, so it is sent on that list alone and `parsed` is none of its business. Only
 *  `onDeleted`/`onAbsent`/`onConflict` live INSIDE that wrapper, so those three carry `parsed > 0`
 *  as well as their own gate (`deleted > 0` and `absent !== null && absent > 0` respectively). The
 *  two sides have to move together — a key sent for a control that never rendered is a decision
 *  nobody made, and a control that rendered whose value is not sent is a decision quietly dropped.
 *
 *  ⛔ AND THE TWO PARSE-CHANGING OVERRIDES ARE NOT HERE AT ALL, because on THIS door they have no
 *  control to mirror. `allowUnknownColumns`/`allowInvalidCoordinates` are fed straight to the parser,
 *  so the confirm route refuses either one whenever the stored summary shows the file actually
 *  contains the thing it waves through — which is EXACTLY the condition under which the amber box
 *  renders. Sending them from here could therefore only ever produce a 409: ticked, it differs from
 *  what the run stored; un-ticked after a re-upload that set it, it differs the other way ("narrowing
 *  the parse is a change too"). They belong to the UPLOAD, which is the request that runs before the
 *  classification, and the run door offers them as a re-upload instead — see `handleUpload`'s
 *  `overrides` and `ReuploadOverrides`. Their value reaches the apply through the run's own stored
 *  `options`, which the worker's `applyOptions` spreads in; nothing is dropped by leaving them out.
 *
 *  ⚠ `parsed === 0` IS A LIVE, ROUTINE STATE WITH A RENDERED OVERRIDE, NOT A DEAD END — a blanket
 *  `if (result.parsed === 0) return {}` here was a shipped regression, pinned now by the two "…at
 *  parsed 0" tests. A file whose every row was quarantined reaches `parsed: 0` with its
 *  `allowMalformedRows` box on screen, and for CSV one unrecognised header column blocks the whole
 *  parse (`parsed`/`skipped` both 0 — see `FacilityImportResult.unknownColumns`, facility-import.ts)
 *  yet sets NO `blockedReason` (only `duplicate-columns` and `quarantined-rows` do), so
 *  `canConfirmRun` is true, Confirm IS offered, and the amber box IS on screen with its re-upload
 *  affordance. Dropping `allowMalformedRows` here made the apply re-run WITHOUT the override, parse
 *  nothing, write nothing — and still report `applied`.
 *
 *  `onConflict` carries no count gate of its own because its control has none: a conflict can only
 *  be discovered by the apply this confirm authorises, so the choice is always made in advance (see
 *  `showConflictChoice`, which is constantly true on THIS door — the summary under review here is
 *  always a run's, so `fromRun` is true). The wrapper it sits in is therefore its only gate.
 *
 *  Task 8: `columnMap` joins `allowMalformedRows` outside the `parsed > 0` wrapper and with no
 *  render-gate of its own, for the same reason that field has none — there is no amber box a column
 *  map's presence toggles on this door; it is sent whenever the sheet actually has one worth sending
 *  (`hasColumnMapContent`), never merely because a run exists. A background run that VALIDATED with a
 *  map and then applied without it would re-parse the file against raw headers and refuse it — the
 *  same class of bug this file's own comment on `allowMalformedRows` documents for that flag. */
function confirmOptionsFor(
  result: FacilityImportResult,
  chosen: Required<Omit<FacilityImportConfirmOptions, 'allowUnknownColumns' | 'allowInvalidCoordinates'>>,
): FacilityImportConfirmOptions {
  return {
    ...(result.quarantined.length > 0 ? { allowMalformedRows: chosen.allowMalformedRows } : {}),
    ...(hasColumnMapContent(chosen.columnMap) ? { columnMap: chosen.columnMap } : {}),
    ...(result.parsed > 0
      ? {
        ...(result.deleted > 0 ? { onDeleted: chosen.onDeleted } : {}),
        ...(result.absent !== null && result.absent > 0 ? { onAbsent: chosen.onAbsent } : {}),
        onConflict: chosen.onConflict,
      }
      : {}),
  };
}

interface ImportFacilitiesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once an APPLY succeeds (never for a dry run) so the caller can reload its list — see
   *  Facilities.tsx, which passes its own `reload`. Called for BOTH doors: the inline apply, and a
   *  background run this sheet watched reach `applied`. */
  onImported: () => void;
}

// The server bounds a real INLINE APPLY to this many rows (MAX_INLINE_APPLY_ROWS in
// apps/server/src/facilities-routes.ts) and points anything larger at the CLI instead — see that
// file's own doc comment for why (an inline applied import runs as one atomic transaction inside the
// request, and beyond a few thousand rows that can run past a reasonable HTTP request deadline).
// That constant is not exported for the browser bundle to import (the route file pulls in the full
// server DB engine), so this is a deliberately mirrored literal, not a shared import — it is a
// SETTLED contract value (task-5-brief.md), used here only to give the operator a proactive,
// friendly notice before ever attempting a doomed Apply request. The actual enforcement stays
// server-side: handleApply's catch block below also recognises the server's own over-cap 400 by
// message content, so a drift between this literal and the real cap degrades to a slightly-late (but
// still friendly) error, never to a bypass or a raw dump of the CLI-flavoured server string.
//
// ⛔ IT GATES THE INLINE PATH AND ONLY THE INLINE PATH. The A2b background path (Upload → confirm)
// has NO row cap at all — lifting it for national registers is the entire point of that path — so
// `overCap` is passed to the summary below as a literal `false` when the summary being rendered came
// from an uploaded run. Pinned by "a 14 000-row register is confirmable on the background path".
const APPLY_ROW_CAP = 2000;


export function ImportFacilitiesSheet({ open, onOpenChange, onImported }: ImportFacilitiesSheetProps) {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  /** ⛔ REQUESTED, not effective. `clampStep` below is what actually renders, so a step the operator
   *  has not earned can never be shown even if this holds a stale value: picking a different file
   *  drops `hasReview` and the view falls back on its own, with no extra reset to remember. */
  const [requestedStep, setRequestedStep] = useState<ImportStep>(1);
  const [csv, setCsv] = useState<string | null>(null);
  // B1 Task 9: holds the CHOSEN SOURCE'S URI, and only ever that — see `handleNationalSystemChange`
  // and the `Select` below. Before this task it was a free-text box hashed straight into every
  // facility's permanent id (`idFor`, facility-csv.ts); the import routes now refuse anything that
  // is not a registered source's own url (`@openldr/db`'s `resolveFacilityRegisterForImport`), so typing
  // one in was never completable from here to begin with.
  const [nationalSystem, setNationalSystem] = useState('');
  // The registers this operator may pick — `GET /api/facilities/import/sources`, fetched once per
  // mount. This sheet is unmounted and remounted by its caller on every open (Facilities.tsx's
  // `{importing && <ImportFacilitiesSheet ... />}`), so a mount-only effect already re-fetches on
  // every open without needing `open` itself as a dependency.
  const [sources, setSources] = useState<FacilityRegisterSource[]>([]);
  // Starts `true`, not `false` — the Select must read as loading from the very first paint, not
  // flash an "no registers configured" empty state for the instant before the fetch even begins.
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState(false);
  // Review fix (B1 Task 9): the ⋯ menu's "Register a source" item opens this — the create
  // affordance the original task shipped a tested route for but never actually wired to anything,
  // leaving a fresh install (empty `facility_registry`, so migration 082's back-fill has nothing to
  // seed from) with a permanently empty picklist and facility import unreachable from the UI.
  const [registerSourceOpen, setRegisterSourceOpen] = useState(false);
  const [allowUnknownColumns, setAllowUnknownColumns] = useState(false);
  // Task 5: the explicit "I have seen the line numbers, import the rest" override for structurally
  // malformed (quarantined) rows — same shape as `allowUnknownColumns` above, but unlike that flag,
  // toggling it does NOT need a new preview: `quarantined` is a property of the file itself (see
  // facility-csv.ts), not of this flag, so nothing about the preview's own content can change.
  const [allowMalformedRows, setAllowMalformedRows] = useState(false);
  // CT-3: the third member of the override family — see `FacilityImportRequest.allowInvalidCoordinates`
  // (api.ts) for why a row failing coordinate validation is otherwise dropped from the parse rather
  // than imported with both coordinates null. Unlike `allowMalformedRows`, toggling this DOES
  // re-preview on the inline path (see `toggleAllowInvalidCoordinates` below) — it changes which rows
  // land in `records`, not merely whether Apply may proceed.
  const [allowInvalidCoordinates, setAllowInvalidCoordinates] = useState(false);
  // CT-3: which shape the file is, and whether it declares itself a complete release — both feed
  // `FacilityImportRequest.format`/`completeRelease` (api.ts) on every preview AND apply. Without
  // these, `absent`/`deleted` (and their retirement Selects below) could never be anything but
  // `null`/`0` from this sheet — see the CT-3 finding this task fixes.
  const [format, setFormat] = useState<'csv' | 'jsonl'>('csv');
  const [completeRelease, setCompleteRelease] = useState(false);
  // Optional provenance only — never read by `importFacilities` itself (see api.ts's doc comment).
  const [releaseVersion, setReleaseVersion] = useState('');
  // Task 8: the operator's column map for THIS file. Reset to `EMPTY_COLUMN_MAP` on every new file
  // pick (`handleFileChange`) — load-bearing, not cosmetic: `ColumnMapStep`'s own `claimedTargets`
  // reads `Object.values(value.columns)` unfiltered by the CURRENT file's headers, so an entry keyed
  // on a PREVIOUS file's header would still satisfy a required field here, and the blocking summary
  // would wave through a map the server's own `validateColumnMap` would then refuse.
  //
  // ⛔ `onChange={setColumnMap}` BELOW MUST STAY A DIRECT, SYNCHRONOUS ROUND-TRIP. `ColumnMapStep` is
  // a controlled component whose OWN pre-selection depends on the value it just emitted landing back
  // in `value` before the next render — see that file's fix-pass docblock ("an explicitly declined
  // suggestion must stick"). Debouncing, batching, or dropping this call makes the panel look broken
  // for reasons that are not in the panel.
  const [columnMap, setColumnMap] = useState<FacilityColumnMap>(EMPTY_COLUMN_MAP);
  // The current file's header row and this app's own ranked suggestions for it — CSV only (see the
  // effect below); a JSONL release never renders `ColumnMapStep` at all (a map for one is meaningless
  // — Task 3's own doc comment on `FacilityImportOptions.columnMap`).
  const [columnMapHeaders, setColumnMapHeaders] = useState<string[]>([]);
  const [columnMapSuggestions, setColumnMapSuggestions] = useState<ColumnSuggestion[]>([]);
  // Whole-branch review, MUST FIX 3: `ColumnMapStep`'s own `onValidityChange` — wired here to a
  // NON-BLOCKING notice only (see its render site below), never to disabling Preview/Upload.
  // ⛔ Gating either action on this was tried and reverted: the "resets the column map on a file
  // swap" test below picks a file whose headers satisfy NO required field and still expects Preview
  // to fire — this sheet leaves "is the map complete" to the SERVER's own authoritative refusal
  // (now actually rendered, via `columnMapErrors` above), never to a client-side guess that could
  // diverge from it. Starts `true` so a file with no `ColumnMapStep` rendered yet (or none at all,
  // e.g. JSONL) never shows a stale notice.
  const [columnMapValid, setColumnMapValid] = useState(true);
  // A2a: what to do with rows this file's reconciliation classified as `deleted` (the publisher
  // explicitly declared them removed) or `absent` (this registry holds them, the file is simply
  // silent about them). Defaults mirror the server's own (`FacilityImportOptions.onDeleted`/
  // `onAbsent`, facility-import.ts): a declared deletion is a fact ⇒ retire by default; an absence
  // is this importer's own inference ⇒ report only by default. Reset alongside the other overrides
  // on a new file pick, same as `allowUnknownColumns`/`allowMalformedRows` above.
  const [onDeleted, setOnDeleted] = useState<'retire' | 'report'>('retire');
  const [onAbsent, setOnAbsent] = useState<'retire' | 'report'>('report');
  // A2a: what to do with a row the preview classified `conflict` (touched by someone else between
  // the preview and this apply). Default mirrors the server's own (`FacilityImportOptions.onConflict`,
  // facility-import.ts): skip by default, an explicit choice for overwrite — the design spec's stated
  // default, never something an operator gets by accident. Reset alongside the other overrides on a
  // new file pick, same as `onDeleted`/`onAbsent` above.
  const [onConflict, setOnConflict] = useState<'skip' | 'overwrite'>('skip');

  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<FacilityImportResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<FacilityImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A2b: the background run this sheet is watching, and the request states around it.
  const [runId, setRunId] = useState<string | null>(null);

  /** Task 2 (Review reviews, Mapping decides): the signature the summary on screen was computed
   *  under. `null` means there is no summary at all. Compared against the live inputs by `stepGate`
   *  below, which is what makes Review "current or absent" rather than "present but possibly
   *  stale". */
  const [summaryAt, setSummaryAt] = useState<string | null>(null);
  /** Bumped by `handleValueMappingsSaved`. Feeds `summarySignature` only: the worklist deliberately
   *  does not read it, so saving one mapping never empties the list being worked through. */
  const [valueMappingsSavedAt, setValueMappingsSavedAt] = useState(0);
  /** The last check's result and the inputs it was computed under. Separate from `summaryAt`
   *  because the two have different lifetimes: see `importInputsSignature.ts`. */
  const [lastFindings, setLastFindings] = useState<FacilityImportResult | null>(null);
  const [worklistAt, setWorklistAt] = useState<string | null>(null);
  /** How many times the OPERATOR has changed the column map. The signatures key on this rather than
   *  on `columnMap` itself.
   *
   *  ⛔ NOT THE MAP'S CONTENT, and that is the whole point. `ColumnMapStep` writes its suggestion
   *  seed into `columnMap` when the asynchronous `suggestColumnMap` call resolves, which can land
   *  AFTER a check has run. Keying on content made that seed look like an edit and silently threw
   *  away the Review the operator had just earned. A programmatic reset of the map always
   *  accompanies a new file, register or format, and all three are in the signature already. */
  const [columnMapEdits, setColumnMapEdits] = useState(0);
  const [run, setRun] = useState<FacilityImportRunView | null>(null);
  const [uploading, setUploading] = useState(false);
  /** How much of the file has gone, as a fraction — or `null` for "in flight, but the browser will
   *  not say how far". ⛔ `null` is NOT `0`: `ProgressEvent.lengthComputable` can be false for the
   *  whole transfer, and rendering that as `0%` would show a frozen number for a minute of a 64 MiB
   *  upload. The indeterminate case gets its own copy (`facilities.import.uploading`). */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  /** What the cancel route actually answered. ⛔ `'requested'` is NOT `'cancelled'` — see the two
   *  notices below, and `cancelFacilityImportRun`'s doc comment for why the distinction is the whole
   *  point of that route having two success codes. */
  const [cancelOutcome, setCancelOutcome] = useState<'cancelled' | 'requested' | null>(null);
  /** Bumped to make the poll effect run one more tick immediately — after a confirm (the run has
   *  just moved into a state a worker WILL take) and after a cancel (the run may already be
   *  terminal). Without it a run parked at `awaiting_confirmation`, which is deliberately not
   *  polled, would never be re-read at all. */
  const [refreshNonce, setRefreshNonce] = useState(0);
  /** Which run this sheet has already told its caller about. A ref, not state, because the point is
   *  to survive a re-render — and it survives StrictMode's double-invoked effects too, which is what
   *  keeps `onImported` from firing twice for one applied run. */
  const notifiedRunRef = useRef<string | null>(null);

  // B1 Task 9: populate the register picklist. `cancelled` mirrors the poll effect's own idiom below
  // — under `<StrictMode>`'s double-invoked effects the first pass's in-flight request resolves into
  // a no-op and the second pass's is the live one, rather than either racing to overwrite the other's
  // state with stale data.
  useEffect(() => {
    let cancelled = false;
    setSourcesLoading(true);
    setSourcesError(false);
    listFacilityImportSources()
      .then((rows) => { if (!cancelled) setSources(rows); })
      .catch(() => { if (!cancelled) { setSources([]); setSourcesError(true); } })
      .finally(() => { if (!cancelled) setSourcesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /** Review fix (B1 Task 9): re-run after `RegisterSourceDialog` mints a new source, so the Select
   *  offers it without the operator having to close and reopen the whole sheet (which is the only
   *  thing that would otherwise re-trigger the mount effect above). Deliberately NOT folded into
   *  that effect, and deliberately without a `cancelled` guard of its own: the guard above exists
   *  for StrictMode's double-invoked EFFECTS, a race between two automatic re-runs of the same
   *  effect body — it has nothing to do with a fetch kicked off from a click handler, which fires
   *  exactly once per real click and is never re-entered by React. */
  const refreshSources = async (): Promise<FacilityRegisterSource[]> => {
    setSourcesLoading(true);
    setSourcesError(false);
    try {
      const rows = await listFacilityImportSources();
      setSources(rows);
      return rows;
    } catch {
      setSources([]);
      setSourcesError(true);
      return [];
    } finally {
      setSourcesLoading(false);
    }
  };

  /** The dialog's `onCreated` — refreshes the picklist AND selects what was just registered.
   *  ⛔ Both matter: a refresh alone leaves the new source in `sources` but still unselected (the
   *  operator would have to open the Select and pick it themselves, easy to miss); a selection alone
   *  without the refresh would set `nationalSystem` to a url with no matching `SelectItem`, which
   *  renders as the placeholder — the picked value would look unchosen even though it is the exact
   *  string an import would send. */
  const handleSourceCreated = (source: FacilityRegisterSource): void => {
    void refreshSources().then(() => handleNationalSystemChange(source.url));
  };

  // ⛔ POLLING, AND IT MUST SURVIVE `<StrictMode>`. The scheduling state is effect-LOCAL (`stopped`,
  // `timer`), never a component-level "mounted" ref: StrictMode mounts, cleans up and re-mounts while
  // PRESERVING refs, so a ref set false in a cleanup stays false for every later poll and the sheet
  // sits on "checking the import run" for good — a defect this app has actually shipped once. With
  // the flag scoped to the effect run that created it, the first pass's in-flight request resolves
  // into a no-op and the second pass's own chain is the live one. Pinned by "polling survives
  // StrictMode's double-invoked effects".
  //
  // A self-scheduling `setTimeout` chain rather than `setInterval`: the next request is only ever
  // booked once the previous one has answered, so a slow server cannot stack requests.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const next = await getFacilityImportRun(runId);
        if (stopped) return;
        setRun(next);
        if (RUN_POLLED_STATUSES.includes(next.status)) {
          timer = setTimeout(() => { void tick(); }, RUN_POLL_MS);
        }
      } catch (err) {
        if (stopped) return;
        // Stop asking rather than retrying forever: a run id that cannot be read is not going to
        // start being readable, and a silent poll loop behind a blank panel is worse than a message.
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void tick();
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  }, [runId, refreshNonce]);

  // The background path's equivalent of the inline apply's own `onImported()` call. Guarded by run
  // id (not a boolean) so it fires once per applied run and never twice for one.
  useEffect(() => {
    if (run?.status === 'applied' && notifiedRunRef.current !== run.id) {
      notifiedRunRef.current = run.id;
      onImported();
    }
  }, [run, onImported]);

  // Any change to the inputs a preview was computed against invalidates that preview — otherwise
  // the operator could edit the national system (or pick a different file) after previewing and
  // still see a stale summary/Apply affordance describing the OLD input.
  const invalidatePreview = () => {
    setPreviewResult(null);
    setApplyResult(null);
    setError(null);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setAllowUnknownColumns(false);
    setAllowMalformedRows(false);
    setAllowInvalidCoordinates(false);
    setFormat('csv');
    setCompleteRelease(false);
    setReleaseVersion('');
    setOnDeleted('retire');
    setOnAbsent('report');
    setOnConflict('skip');
    // Task 8: the two handed-off items, both closed HERE. (1) A different file means different
    // headers, so any prior mapping decision is reset — `ColumnMapStep`'s own `claimedTargets` reads
    // `Object.values(value.columns)` unfiltered by the CURRENT file's headers, so a header-keyed entry
    // surviving a file swap would still satisfy a required field for a file it was never chosen
    // against. (2) `columnMapHeaders`/`columnMapSuggestions` reset alongside it — the effect below
    // will repopulate them for the NEW file once its `csv` resolves, but until then a stale header
    // list must not linger and render `ColumnMapStep` against the wrong file's columns.
    setColumnMap(EMPTY_COLUMN_MAP);
    setColumnMapHeaders([]);
    setColumnMapSuggestions([]);
    setColumnMapValid(true);
    // A2b: a new file starts a new import in every sense. The picker is disabled while a run is
    // live (see `inputsDisabled`), so this only ever discards a run that has already finished.
    setRunId(null);
    setRun(null);
    setCancelOutcome(null);
    setUploadProgress(null);
    invalidatePreview();
    // ⚠ Read for the INLINE path only — `importFacilitiesCsv` carries the register in a JSON body,
    // so that door genuinely needs the text. The A2b Upload path never touches `csv`: the File is
    // the request body (see `uploadFacilityImport`), which is what keeps a national register out of
    // this tab's memory.
    if (!f) { setCsv(null); return; }
    void f.text().then(setCsv).catch((err: unknown) => {
      setCsv(null);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  // Task 8: the header row + this app's own ranked suggestions for the current CSV file — one
  // network round-trip, headers and suggestions together (never headers-first-suggestions-later:
  // `ColumnMapStep`'s own seed effect is gated on a header SIGNATURE alone, so headers arriving
  // before their matching suggestions would let it seed nothing and then never retry once the real
  // suggestions landed a moment later). Re-runs whenever the file's text OR the declared format
  // changes — `format` because switching to `jsonl` must clear any CSV-only header list, `csv`
  // because a new file means new headers.
  useEffect(() => {
    if (!csv || format !== 'csv') {
      setColumnMapHeaders([]);
      setColumnMapSuggestions([]);
      return;
    }
    let cancelled = false;
    suggestColumnMap(csv)
      .then((res) => {
        if (cancelled) return;
        setColumnMapHeaders(res.headers);
        setColumnMapSuggestions(res.columns);
      })
      .catch(() => {
        if (cancelled) return;
        // The suggestion call failed (network, or an unrecognised header row) — the panel must still
        // be usable, just without ranked help. Mirrors the server's own `suggest-map` route's
        // deliberately naive header split (facilities-routes.ts): only the first line, split on `,`
        // and trimmed. A quoted header containing a comma would split wrongly, which is acceptable
        // here for the same reason it is there — this is advisory, and the operator sees and confirms
        // every header before anything is imported; the authoritative parse stays the server's own.
        const firstLine = csv.split(/\r?\n/, 1)[0] ?? '';
        const headers = firstLine.split(',').map((h) => h.trim()).filter((h) => h !== '');
        setColumnMapHeaders(headers);
        setColumnMapSuggestions([]);
      });
    return () => { cancelled = true; };
  }, [csv, format]);

  const handleNationalSystemChange = (value: string) => {
    setNationalSystem(value);
    invalidatePreview();
  };

  // F4 fix: the server's byte-size cap (MAX_IMPORT_CSV_BYTES, apps/server/src/facilities-routes.ts)
  // returns a message written the same way the row-count cap's is — for a CLI/log reader, not this
  // sheet — and unlike the row cap it can fire on a plain PREVIEW (it's checked before the dry-run
  // parse even runs), not just on Apply. Only 'inline apply limit' was ever special-cased before;
  // this recognises the size cap's message the same way and gives it the same plain-language
  // treatment, in both the preview and apply catch blocks.
  // A2b: and the UPLOAD route's own byte ceiling, whose 413 body names a raw byte count
  // ("the register file exceeds the 67108864-byte upload limit") — a number nobody reads as a size.
  const friendlyImportErrorMessage = (raw: string): string => {
    const lower = raw.toLowerCase();
    if (lower.includes('inline apply limit')) return t('facilities.import.tooLargeError');
    if (lower.includes('mb limit for this endpoint')) return t('facilities.import.tooLargeFileError');
    if (lower.includes('byte upload limit')) return t('facilities.import.tooLargeUploadError');
    return raw;
  };

  // CT-3: `overrides` replaces the old single `allowOverride?: boolean` — TWO checkboxes now need to
  // send their just-clicked value ahead of the state update that triggered this call (React state
  // setters are async), `allowUnknownColumns` and `allowInvalidCoordinates` alike (see
  // `toggleAllowUnknownColumns`/`toggleAllowInvalidCoordinates` below). `allowMalformedRows` is
  // deliberately NOT one of these fields — see the pinned-`false` comment below.
  const runPreview = async (
    overrides?: { allowUnknownColumns?: boolean; allowInvalidCoordinates?: boolean },
  ): Promise<void> => {
    if (!csv || !nationalSystem.trim()) return;
    setPreviewing(true);
    setError(null);
    setApplyResult(null);
    try {
      const result = await importFacilitiesCsv({
        csv,
        nationalSystem: nationalSystem.trim(),
        allowUnknownColumns: overrides?.allowUnknownColumns ?? allowUnknownColumns,
        // CT-3: unlike `allowMalformedRows` below, this DOES need to reach the preview request — it
        // changes which rows land in `records` (and therefore `create`/`changed`/`unchanged`), not
        // merely whether Apply may proceed, so a preview computed without it would misreport what
        // Apply would actually do. See `toggleAllowInvalidCoordinates`.
        allowInvalidCoordinates: overrides?.allowInvalidCoordinates ?? allowInvalidCoordinates,
        // ⛔ ALWAYS `false`, deliberately, and never the live checkbox: this request is what makes
        // `blocked`/`blockedReason` a STABLE BASELINE the checkbox can be toggled against in both
        // directions. Sending the override would make the server answer for the override too, and
        // then un-ticking the box could not re-impose the block — the previewed answer would already
        // say `blocked: false` (measured: preview → tick → re-Preview → un-tick left Apply on the
        // menu, and the Apply request then sent `allowMalformedRows: false` for a write the server
        // refuses, so the operator saw an "applied" result that wrote and audited nothing).
        // Costless: a dry run writes nothing, so the flag changes NOTHING else in the response — see
        // `importFacilities`' docblock ("A dry run always reports both `quarantined` and
        // `duplicateColumns` regardless of the override") and its early return, which reports the
        // same `parsed`/`skipped`/`duplicates` either way. Apply still sends the operator's real
        // answer (see handleApplyConfirm), which is the only request the flag actually gates.
        allowMalformedRows: false,
        // CT-3: the whole point of this fix. Without these, every preview reported `conflict: null`,
        // `absent: null`, `deleted: 0` no matter what the file actually was — making the
        // `onConflict`/`onAbsent`/`onDeleted` Selects below structurally unreachable (see the finding
        // this task closes).
        format,
        completeRelease,
        releaseVersion: releaseVersion.trim() || undefined,
        // Task 8: the same discipline `format`/`completeRelease` above already follow — a preview
        // and an apply that parse the file differently is a bug this sheet has learned before (see
        // `handleApplyConfirm`'s matching `columnMap`, and `hasColumnMapContent`'s own doc comment
        // for why an unpopulated map is sent as no map at all rather than an empty one).
        columnMap: hasColumnMapContent(columnMap) ? columnMap : undefined,
        apply: false,
      });
      setPreviewResult(result);
      setSummaryAt(summarySignatureRef.current);
      // ⛔ An explicit Preview goes to its result, every time, not only the first. The auto-advance
      // effect keys on `furthest` CHANGING, so it carries the operator to Review on the first
      // preview and does nothing on a second: someone who stepped back to Mapping to fix the map
      // and previewed again stayed on Mapping, with the new summary sitting on a step they had to
      // go and find. Requesting it here makes the navigation a consequence of the action.
      //
      // ⛔ EXCEPT for a column-map refusal, which belongs on Mapping. That retreat lives in the
      // same `[furthest]` effect, so it does NOT re-run for a second preview and cannot undo this;
      // the condition has to be here. Read off `result` rather than the derived `columnMapRefused`,
      // which is a render away and still describes the PREVIOUS result at this point.
      if (result.blockedReason !== 'column-map') setRequestedStep(3);
    } catch (err) {
      setPreviewResult(null);
      const message = err instanceof Error ? err.message : String(err);
      setError(friendlyImportErrorMessage(message));
    } finally {
      setPreviewing(false);
    }
  };

  // ⛔ NO `runPreview` IN ANY OF THESE THREE ANY MORE. Two of them used to re-check on every click,
  // which was right when these lived on Review and the summary was the page you were looking at.
  // They live on Mapping now, where a change is an EDIT: it moves `summarySignature`, `hasReview`
  // goes false, the summary is discarded, and the operator re-checks when they choose to. Checking
  // on a checkbox would spend a full validate of a national register per click, and on the streamed
  // door it would spend a full re-upload.
  //
  // ⛔ `runPreview`'s `overrides` parameter STAYS. It is what let a toggle send its own new value
  // ahead of the state update, and nothing else uses it today, but removing it is a separate change
  // from moving these controls and would bury a behaviour change inside a refactor.
  const toggleAllowUnknownColumns = (checked: boolean) => setAllowUnknownColumns(checked);
  const toggleAllowMalformedRows = (checked: boolean) => setAllowMalformedRows(checked);
  const toggleAllowInvalidCoordinates = (checked: boolean) => setAllowInvalidCoordinates(checked);

  // CT-3: any change to the file's declared SHAPE invalidates the preview the same way
  // `handleNationalSystemChange` already does — a preview computed for `format: 'csv'` describes a
  // different parse entirely once the operator switches to `'jsonl'`.
  const handleFormatChange = (value: 'csv' | 'jsonl') => {
    setFormat(value);
    invalidatePreview();
  };
  const handleCompleteReleaseChange = (checked: boolean) => {
    setCompleteRelease(checked);
    invalidatePreview();
  };
  const handleReleaseVersionChange = (value: string) => {
    setReleaseVersion(value);
    invalidatePreview();
  };

  const handleApplyConfirm = async (): Promise<void> => {
    if (!csv || !previewResult) return;
    setConfirmOpen(false);
    setApplying(true);
    setError(null);
    try {
      const result = await importFacilitiesCsv({
        csv,
        nationalSystem: nationalSystem.trim(),
        allowUnknownColumns,
        allowMalformedRows,
        allowInvalidCoordinates,
        // CT-3: the apply must describe the SAME file shape/release declaration the preview it is
        // linked to (via `runId` below) already classified against — sending the CSV default here
        // while the linked preview parsed a JSONL release would have the apply parse the file
        // differently from what the operator reviewed.
        format,
        completeRelease,
        releaseVersion: releaseVersion.trim() || undefined,
        // Task 8: the SAME map the linked preview sent — `ColumnMapStep` disappears from the sheet
        // the moment `previewResult` exists (see its render gate below), so by the time Apply runs
        // `columnMap` state can only be whatever the preview it is linked to already used. Sent with
        // the identical `hasColumnMapContent` gate as the preview above, for the identical reason.
        columnMap: hasColumnMapContent(columnMap) ? columnMap : undefined,
        apply: true,
        // A2a: without this, the apply is not linked to the preview the operator just read, and
        // `conflict` reports `null` (not evaluated) even though a preview DID run — see api.ts's
        // `FacilityImportRequest.runId` doc comment and the server route's matching comment on why
        // it never invents a link the caller didn't ask for.
        runId: previewResult.runId ?? undefined,
        onDeleted,
        onAbsent,
        onConflict,
      });
      setApplyResult(result);
      onImported();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The server's own over-cap messages (row-count AND byte-size) are written for someone
      // reading server logs or a CLI terminal — dumped verbatim into this sheet they read as a
      // stray fragment. A Settings-page operator may have no shell into the container at all, so
      // this names the actual constraint (too large for the browser) before pointing at the CLI.
      // See friendlyImportErrorMessage above.
      setError(friendlyImportErrorMessage(message));
    } finally {
      setApplying(false);
    }
  };

  // ── A2b: the background path's three actions ────────────────────────────────────────────────────

  /** @param overrides The two PARSE-CHANGING flags, when this call is the run door's "re-upload with
   *  this option" rather than a first upload. Passed explicitly for the reason `runPreview`'s own
   *  `overrides` are: the ⋯ item that sets one has to send its just-chosen value ahead of the React
   *  state update it also triggers. ⛔ `allowMalformedRows` is NOT one of them — it never reaches the
   *  parser, so it stays the confirm's and needs no second trip through the file. */
  const handleUpload = async (
    overrides?: { allowUnknownColumns?: boolean; allowInvalidCoordinates?: boolean },
  ): Promise<void> => {
    if (!file || !nationalSystem.trim()) return;
    const allowUnknown = overrides?.allowUnknownColumns ?? allowUnknownColumns;
    const allowInvalid = overrides?.allowInvalidCoordinates ?? allowInvalidCoordinates;
    // Kept in state as well as sent, so the inline door and a later re-upload both read the same
    // answer the run was actually created with.
    setAllowUnknownColumns(allowUnknown);
    setAllowInvalidCoordinates(allowInvalid);
    setUploading(true);
    // `null`, not `0` — nothing has been measured yet. The first progress event decides which of the
    // two labels the sheet shows.
    setUploadProgress(null);
    setError(null);
    try {
      // ⛔ The `File` itself, never `csv`. See `uploadFacilityImport`.
      const { runId: id } = await uploadFacilityImport(
        {
          file,
          nationalSystem: nationalSystem.trim(),
          format,
          releaseVersion: releaseVersion.trim() || null,
          // Reaches the run's stored `options`, which the worker's validate spreads into
          // `importFacilities` — so a complete release uploaded here has its `absent` count actually
          // MEASURED instead of reported `null`. The checkbox is the same one the inline path uses;
          // both doors now honour it.
          completeRelease,
          // ⛔ THE ONLY WAY A REGISTER THAT NEEDS ONE OF THESE CAN EVER BE IMPORTED FROM THE BROWSER.
          // Both are fed to the parser, so they have to be decided BEFORE the validate that computes
          // the summary the operator confirms — the confirm route refuses either one arriving late,
          // and the studio's upload not sending them is what left a CSV register with one
          // unrecognised column with no completable path at all (tick ⇒ guaranteed 409; don't tick ⇒
          // an apply that parses nothing, writes nothing and still reports `applied`).
          allowUnknownColumns: allowUnknown,
          allowInvalidCoordinates: allowInvalid,
          // Task 8b: the same guard the inline door and `confirmOptionsFor` already apply — an empty
          // map is not the same as no map (see `hasColumnMapContent`'s own doc comment), so this is
          // sent only when the operator actually mapped something. Stored on the run's `options`
          // before its own validate runs, which is what makes this door's validate agree with what
          // the operator sees, instead of reading the file's raw headers.
          columnMap: hasColumnMapContent(columnMap) ? columnMap : undefined,
        },
        setUploadProgress,
      );
      // An inline preview on screen described the same file through the other door; the run's own
      // validate is about to describe it again, and two summaries at once would be one too many.
      setPreviewResult(null);
      setApplyResult(null);
      setCancelOutcome(null);
      // ⛔ The OLD run's view, not just its id. A re-upload supersedes the run whose summary is on
      // screen (`awaiting_confirmation` is a supersedable state), so leaving `run` set would keep
      // rendering that summary — and its Confirm — over a run the register no longer belongs to,
      // until the first poll of the new one answered. Inert on a first upload, where it is already
      // null.
      setRun(null);
      setRunId(id);
      // Task 2: the streamed door earns its Review here, at the upload, for the same reason `runId`
      // is in `stepGate` at all — the first poll has not answered yet and the operator must not be
      // left on Mapping watching nothing.
      setSummaryAt(summarySignatureRef.current);
    } catch (err) {
      setError(friendlyImportErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmRun = async (): Promise<void> => {
    if (!runId || !awaitingSummary) return;
    setConfirming(true);
    setError(null);
    try {
      // ⛔ The two parse-changing overrides are deliberately not offered here — see
      // `confirmOptionsFor`'s docblock. The run already carries whatever the UPLOAD declared,
      // `columnMap` included now that `uploadFacilityImport` sends its own (Task 8b) — the server's
      // `ConfirmSchema` still has no `columnMap` key and drops this one, so sending it here is inert,
      // not load-bearing; see `FacilityImportConfirmOptions.columnMap`'s own doc comment.
      await confirmFacilityImportRun(runId, confirmOptionsFor(awaitingSummary, {
        onDeleted, onAbsent, onConflict, allowMalformedRows, columnMap,
      }));
      // 202: the register has NOT been written yet. Go and watch what the worker actually does with
      // it — including the case where a newer upload supersedes the run before any worker claims it,
      // which ends `failed` and would otherwise be invisible.
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  };

  const handleCancelRun = async (): Promise<void> => {
    if (!runId) return;
    setCancelling(true);
    setError(null);
    try {
      const { outcome } = await cancelFacilityImportRun(runId);
      setCancelOutcome(outcome);
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  // ── derived ─────────────────────────────────────────────────────────────────────────────────────

  const runActive = !!run && RUN_ACTIVE_STATUSES.includes(run.status);
  /** ⛔ ACTUALLY MOVING, as opposed to merely "a run exists". `runActive` includes
   *  `awaiting_confirmation`, which is right for ITS job of freezing the inputs while a run holds
   *  the register, and wrong for every question about what the operator may do next:
   *  `awaiting_confirmation` is the PARKED state, where the worker has finished and the operator is
   *  being asked to decide. Feeding the wider predicate to `canGoBack` made the step strip
   *  unclickable at Review, so someone who reached the summary could not go back to Mapping to
   *  change anything, which is most of what a review step is for. Reported by an operator as
   *  "what's the point of review if I cant make changes". */
  const runInFlight = runActive && run?.status !== 'awaiting_confirmation';
  const runFinished = !!run && RUN_TERMINAL_STATUSES.includes(run.status);
  /** The summary a background run has PARKED for the operator to decide about. Only ever set at
   *  `awaiting_confirmation`: an earlier run has nothing computed yet, and a later one has already
   *  been decided. */
  const awaitingSummary: FacilityImportResult | null =
    run && run.status === 'awaiting_confirmation' ? run.summary : null;
  /** The reconciliation currently under review, whichever door produced it. Never both at once — an
   *  upload clears any inline preview (see `handleUpload`) and picking a file clears any run. */
  const reviewResult: FacilityImportResult | null = previewResult ?? awaitingSummary;
  const fromRun = awaitingSummary !== null;
  /** Task 8: `ValueMapPanel`'s `onSaved` — a just-written mapping only takes effect on a fresh parse,
   *  so this re-runs whichever preview produced the summary on screen. On the inline door that is a
   *  plain re-preview. There is no equivalent light-weight re-validate for a background run — its
   *  summary came from a worker's validate over the uploaded blob, not from a request this tab can
   *  simply repeat — so this re-streams the SAME file, which mints a fresh run and supersedes the one
   *  under review, the same mechanism the re-upload actions above already use for a parse-changing
   *  override. */
  // ⛔ NO RE-CHECK HERE ANY MORE, and on the run door that also means no silent re-upload. Saving
  // used to re-parse and carry the operator to Review, so the page both asked the question and
  // reported the answer. Saving is now a local edit: it bumps the stamp, which retires the summary,
  // and asking for a fresh check stays the operator's decision. The worklist survives deliberately
  // (`worklistSignature` does not read this stamp), so the remaining rows do not vanish mid-edit.
  const handleValueMappingsSaved = (): void => {
    setValueMappingsSavedAt((n) => n + 1);
  };
  /** The run door's parse-override state, read off the RUN rather than this sheet's own — see
   *  `ReuploadOverrides`. `null` while an inline preview is what is under review, which is what makes
   *  the checkboxes stay checkboxes on that door. */
  const reupload: ReuploadOverrides | null = fromRun && run
    ? {
      sourceFormat: run.sourceFormat,
      allowUnknownColumns: run.options?.allowUnknownColumns === true,
      allowInvalidCoordinates: run.options?.allowInvalidCoordinates === true,
    }
    : null;
  /** Is a "re-upload with this option" worth offering for each flag? Only when the run's summary
   *  shows the file actually contains the thing the flag waves through, the run did NOT already run
   *  with it (a second identical upload would change nothing), and the flag can change this format's
   *  parse at all — which `allowUnknownColumns` cannot for JSONL. */
  // ⛔ Gated on the VERDICT, not just on the list. `unknownColumns` is populated whenever the file
  // has columns outside the contract, but with a column map those were kept as extra data and the
  // file imported: offering to re-upload "keeping unrecognised columns" there would name a remedy
  // for a problem that does not exist, and would re-stream a national export to change nothing.
  const canReuploadForUnknownColumns = !!awaitingSummary && !!reupload
    && reupload.sourceFormat !== 'jsonl'
    && awaitingSummary.blockedReason === 'unknown-columns'
    && awaitingSummary.unknownColumns.length > 0 && !reupload.allowUnknownColumns;
  const canReuploadForInvalidCoordinates = !!awaitingSummary && !!reupload
    && awaitingSummary.invalid.length > 0 && !reupload.allowInvalidCoordinates;
  /** Is the reconciliation on screen refused for the COLUMN MAP specifically? Two things read it:
   *  the mapping panel's own render gate (which must stay mounted for exactly this refusal, on both
   *  doors) and the re-upload action below.
   *
   *  ⛔ Zambia field report: the panel's gate used to open with a bare `!run`, so the exception that
   *  keeps it mounted through a 'column-map' refusal only ever fired on the INLINE door. Any upload
   *  sets `run`, so a background operator got the refusal with the panel already gone and no way to
   *  fix the map in place — and a large national export is exactly the file that takes that door. */
  const columnMapRefused = reviewResult?.blockedReason === 'column-map';
  /** The background door's completable path for a refused map, and the mirror of the two re-uploads
   *  above: those re-stream the file with a parse-changing FLAG, this one re-streams it with the map
   *  the operator has just corrected in the panel. `handleUpload` reads the live `columnMap` and
   *  supersedes this run, so the validate reviewed is the one the corrected map produced. */
  const canReuploadForColumnMap = !!awaitingSummary && !!reupload && columnMapRefused;
  /** What actually got written, whichever door did it. */
  const appliedSummary: FacilityImportResult | null =
    applyResult ?? (run && run.status === 'applied' ? run.summary : null);

  // Task 3: the three-step shell. Placed here, after `appliedSummary`, because `stepGate` reads it —
  // any earlier and the derivation below would use a value that does not exist yet.
  //
  // ⛔ `hasReview` ALSO CHECKS `runId`, not just `reviewResult`/`appliedSummary`. An upload sets
  // `runId` the instant it resolves, but `reviewResult` (which reads `awaitingSummary`, which reads
  // `run`) stays null until the FIRST POLL answers. Without `runId` here, the operator who just
  // uploaded a file would sit on Mapping — nothing rendered there once `run` mounts and hides
  // `ColumnMapStep` — watching nothing happen until that poll came back.
  // Task 2: the inputs the summary on screen was computed from. Every field is existing sheet
  // state; nothing here is new except `valueMappingsSavedAt`.
  const inputs: ImportInputs = {
    fileName: file?.name ?? null,
    fileSize: file?.size ?? null,
    nationalSystem: nationalSystem.trim(),
    format,
    completeRelease,
    releaseVersion,
    columnMapEdits,
    allowUnknownColumns,
    allowInvalidCoordinates,
    valueMappingsSavedAt,
  };
  const currentSummarySignature = summarySignature(inputs);

  /** ⛔ STAMP FROM THE REF, NEVER FROM THE CLOSURE. `currentSummarySignature` inside an async
   *  handler is the value from the render that CREATED the handler. The re-upload path sets
   *  `allowUnknownColumns` and then uploads, so stamping the closure's copy recorded the
   *  pre-override signature while the next render computed the post-override one: they never
   *  matched, `hasReview` stayed false and the run's own progress block never rendered. Measured on
   *  "the run door re-uploads the same file with allowUnknownColumns". Assigned on every render, so
   *  by the time any awaited handler resumes it holds the signature the request actually went with. */
  const summarySignatureRef = useRef(currentSummarySignature);
  summarySignatureRef.current = currentSummarySignature;

  /** The last check's result, kept for the controls on Mapping that only make sense once something
   *  has been found. Guarded by `worklistSignature`, the NARROWER of the two: choosing a policy or
   *  saving a mapping must not make the findings disappear from under the operator while they act
   *  on them. Changing the file, the register, the format or the column map does retire them,
   *  because those change what the file contains. */
  const liveFindings = worklistAt === worklistSignature(inputs) ? lastFindings : null;

  const stepGate = {
    hasFile: !!file,
    hasRegister: nationalSystem.trim() !== '',
    // ⛔ `summaryAt === currentSummarySignature` is what makes this "a summary that MATCHES THE
    // INPUTS", not merely "a summary exists". Change the file, the register, the map, a fixed
    // value, an override or a policy and this goes false, `furthestStep` returns 2 and `clampStep`
    // pulls the operator back to Mapping. That is the safety half of this slice: Review is either
    // current or absent, and never a number that is no longer true.
    //
    // ⛔ `runId !== null` STAYS in the OR. An upload sets it the instant it resolves while
    // `reviewResult` waits for the first poll; without it the operator who just uploaded sits on
    // Mapping watching nothing (see the comment above). It is inside the signature guard for the
    // same reason as the other two.
    hasReview: summaryAt !== null && summaryAt === currentSummarySignature
      && (reviewResult !== null || appliedSummary !== null || runId !== null),
    runActive: runInFlight,
  };
  // ⛔ BOTH DOORS, from ONE place. An earlier draft stamped these inside `runPreview`, which is the
  // inline door only: a background run's summary arrives through `awaitingSummary` when a poll
  // answers, so the streamed door reached Mapping with an empty policy panel and no worklist. Keyed
  // on `reviewResult`, which is what both doors actually produce.
  useEffect(() => {
    if (!reviewResult) return;
    setLastFindings(reviewResult);
    setWorklistAt(worklistSignature(inputs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewResult]);

  const furthest = furthestStep(stepGate);
  const step = clampStep(requestedStep, stepGate);
  // Round-2 fix: no longer a Back BUTTON's visibility — that button is gone (see the action row
  // below). What `canGoBack` decides now is whether the step strip lets the operator click an
  // earlier step at all, so the name says that instead of naming a button that no longer exists.
  const allowBack = canGoBack(step, stepGate);

  // Auto-advance carries the operator to Review and NOWHERE else: after Upload and validate there
  // is no button for them to press, so the sheet has to move itself. It must NOT skip step 1, which
  // would make Continue unpressable and hide the source inputs the moment a register was picked.
  // Never rewinds: `clampStep` already handles falling back when a file is swapped.
  //
  // ⛔ ROUND-2 FIX: NOR does it leave a COLUMN-MAP refusal parked on Review. `columnMapErrors` is
  // only fixable from the Mapping panel, which does not exist on Review — landing there anyway is
  // what forced a click back to Mapping just to reach the fix, undoing the whole point of keeping
  // `ColumnMapStep` mounted through the refusal (see `columnMapRefused`'s own docblock).
  //
  // This has to be a RETREAT, not just a guard on the forward move: `hasReview` (and so `furthest`)
  // turns 3 the instant the background door's `runId` is set — see that field's own comment — which
  // is BEFORE the first poll has said anything about `blockedReason`. The upload's own Continue
  // already parked the operator on Mapping by then, so this effect's ordinary branch carries them to
  // Review immediately, exactly as it does for every other run. Only once the first poll answers does
  // `columnMapRefused` turn true, by which point `requestedStep` already reads 3 — a guard that only
  // ever refused to ADVANCE would never see this, and the operator would stay stranded on Review with
  // no way to fix the very thing that put them there. This branch un-does that specific move, and
  // only that one: any OTHER step the operator had already reached (never past Mapping) is untouched.
  //
  // ⛔ ROUND-3 FIX: retreats from ANY step, not only from Review. The dropdown's Preview item has no
  // `step` gate at all (only `previewDisabled` and `!applyResult && !run` — see that item's own
  // comment), so it is reachable from Source with the sheet never having been past step 1. On the
  // inline door `setPreviewResult(result)` makes `columnMapRefused` true in the SAME render as the
  // response lands, with no poll delay to wait out — unlike the background door's two-hop
  // transition described above. A guard that only fired for `prev === 3` did nothing for that path:
  // `requestedStep` was still 1, so the sheet stayed on Source with neither `ColumnMapErrorsNotice`
  // site mounted (both live behind `step === 2` or `step === 3`) and the operator saw no refusal at
  // all. A column-map refusal means the Mapping panel is the only place that can help, regardless of
  // which step the operator was on when they triggered it.
  useEffect(() => {
    if (columnMapRefused) {
      setRequestedStep((prev) => (prev !== 2 ? 2 : prev));
      return;
    }
    if (furthest < 3) return;
    setRequestedStep((prev) => (prev < 3 ? 3 : prev));
  }, [furthest, columnMapRefused]);

  /** Task 5: a fresh install has NO register: migration 082's back-fill seeds only from
   *  `national_system` values a pre-existing `facility_registry` already carries. Import is then
   *  unreachable until one is created, and the only affordance was a dropdown item nothing pointed
   *  at. This makes the requirement the step's own content, and the remedy its own button. */
  const needsRegister = !sourcesLoading && !sourcesError && sources.length === 0;

  // F5 fix: `!csv` covers "still reading" AND "0-byte file" identically (both leave `csv` falsy),
  // so a genuinely empty file left Preview disabled forever with nothing on screen explaining why.
  // `csv === ''` (as opposed to `null`) only ever happens once `File.text()` has actually resolved
  // — a still-reading file has `csv === null` — so this fires exactly for "read finished, and it's
  // empty", never during the async read window below.
  const emptyFile = !!file && csv === '';
  // `!csv` matters as its own gate, distinct from `!file`: reading the file's text back out is
  // asynchronous (File.text()), so there is a real window after picking a file where `file` is
  // already set but `csv` has not resolved yet. Without this, a click in that window would fall
  // through runPreview's own early return and silently do nothing — worse than a disabled button.
  const previewDisabled = !file || !csv || !nationalSystem.trim() || previewing || applying || !!applyResult;
  // A2b: Upload deliberately does NOT wait on `csv` — the File is the request body, so there is
  // nothing to read first. `emptyFile` is still a gate: the upload route refuses a 0-byte body with a
  // 400, and a request that cannot succeed is never worth sending.
  const uploadDisabled = !file || !nationalSystem.trim() || uploading || previewing || applying || emptyFile;
  // parsed === 0 covers BOTH the "nothing recognised" trap (unknownColumns populated, blocked
  // outright) and the "wrong file entirely" trap (parsed 0, unknownColumns empty) — neither has
  // anything to apply. Over the row cap is refused for the same reason a doomed request is: never
  // worth sending.
  // Task 5: a quarantined row blocks Apply the same way unresolved unknown columns block Preview
  // from ever reporting anything to apply — except quarantined rows don't zero out `parsed` (the
  // rest of the file still parses, see facility-csv.ts), so this needs its own term rather than
  // riding along on `previewResult.parsed > 0` above. `allowMalformedRows` is the release valve.
  //
  // ⛔ `blocked`/`blockedReason` come from `importFacilities` itself (see
  // `FacilityImportResult.blocked`) instead of this sheet rebuilding the predicate. The version it
  // used to spell out covered only quarantined rows, and agreed with the server purely because
  // `parseFacilityCsv` zeroes `records` on duplicate headers — so `parsed > 0` above happened to
  // catch what it missed. A duplicate-header file that still parsed rows would have offered Apply
  // for a write the server refuses.
  //
  // The ONE thing re-applied here rather than read: the malformed-rows OVERRIDE. The checkbox
  // deliberately does not re-preview (see `toggleAllowMalformedRows` — the quarantine list is a
  // property of the file, so a second request would discover nothing), so the live checkbox is
  // always ahead of the previewed answer and something has to apply it.
  //
  // ⛔ THIS IS A TOGGLE, NOT A RELEASE VALVE, and that only works because the answer being read was
  // computed WITHOUT the override. On the inline path that is `runPreview` pinning
  // `allowMalformedRows: false` on every preview request (see its comment); on the background path
  // it is the worker's `validateOptions`, which runs the validate with the UPLOAD's stored options —
  // the register identity and, when the operator declared one, `completeRelease`. Neither is an
  // OVERRIDE: none of the three `allow*` flags can be among them, because those are the CONFIRM
  // step's and reach the run only after this decision has been made.
  // `blockedReason` therefore always reports the UN-OVERRIDDEN reason, so ticking the box releases
  // the block and un-ticking re-imposes it — pinned by "re-imposes the quarantine block when the
  // operator un-ticks the override". Nothing here re-derives the server's predicate from
  // `quarantined`/`duplicateColumns`; it reads the server's reason and suppresses exactly the one
  // that has an override. `'duplicate-columns'` has none, so it is taken verbatim and no checkbox
  // can clear it.
  const blockedFor = (r: FacilityImportResult | null): boolean => !!r && r.blocked
    && !(r.blockedReason === 'quarantined-rows' && allowMalformedRows);
  const blockedByImport = blockedFor(previewResult);
  const canApply = !!previewResult && previewResult.parsed > 0 && previewResult.parsed <= APPLY_ROW_CAP
    && !blockedByImport && !applyResult;
  const overCap = !!previewResult && previewResult.parsed > APPLY_ROW_CAP;
  // ⛔ NO ROW CAP. `APPLY_ROW_CAP` is the inline route's; the background path's whole purpose is a
  // register too large for it, so the only thing standing between a validated run and a confirm is
  // the importer's own `blocked` verdict.
  const canConfirmRun = !!awaitingSummary && !blockedFor(awaitingSummary);
  const willWriteCount = reviewResult ? willWrite(reviewResult) : 0;
  // Whole-branch review, MUST FIX 3: `ColumnMapStep`'s `rowCount` — a plain count of non-empty data
  // lines in the picked file, informational only ("This map applies to N facilities in this file").
  // ⛔ NOT the authoritative row count: a quoted multi-line field would over-count here, the same
  // acceptable impurity `suggestColumnMap`'s own naive header split already carries (see this
  // sheet's `.catch` on that call) — the real count is `previewResult.parsed`, computed by the
  // server, which this panel never has before that request runs.
  const columnMapRowCount = csv
    ? csv.split(/\r?\n/).filter((line, i) => i > 0 && line.trim() !== '').length
    : undefined;
  /** Whole-branch review, FINDING 2: is `ColumnMapStep` actually on screen? Read by the panel's own
   *  render gate below AND by the empty-state note beside it, so the two can never drift apart —
   *  the note is exactly "step 2, and this is false". Before this fix only the panel had a gate: a
   *  JSONL release, an applied run, a run or a summary that is not a column-map refusal, and the
   *  brief window while `File.text()` resolves all left step 2 completely blank, with nothing on
   *  screen to say why. */
  //
  //  ⛔ NO LONGER GATED ON THE MAP HAVING BEEN REFUSED. It used to hide the moment a run existed
  //  unless `columnMapRefused`, so an operator who stepped back to Mapping found a step that
  //  explained itself and offered nothing: they could see the map had already been sent and could
  //  do nothing about it. Going back is only worth offering if something can change there, so the
  //  panel stays and step 2's action becomes a re-upload. The RUN's map is still immutable, which
  //  is what the confirm route's guarantees rest on: editing here mints a NEW run that supersedes
  //  this one, exactly as the refusal path already did.
  const columnMapPanelShown = step === 2 && format === 'csv' && columnMapHeaders.length > 0
    && !appliedSummary && !runInFlight;
  // While a run holds the register, the inputs it was uploaded with must not drift out from under
  // it — the run is for THAT file under THAT national system, and nothing here can retract it.
  const inputsDisabled = applying || uploading || runActive;
  /** What an upload in flight is doing, in the two shapes the browser allows it to be known. Read in
   *  TWO places, and the sheet BODY is the one that matters: Radix unmounts the menu the moment its
   *  item is selected, so an operator who clicks Upload sees the menu-item copy only if they go and
   *  reopen the menu — which is no use at all during a 64 MiB transfer, the case the XHR-instead-of-
   *  fetch client exists for. */
  const uploadLabel = uploadProgress === null
    ? t('facilities.import.uploading')
    : t('facilities.import.uploadProgress', { percent: Math.round(uploadProgress * 100) });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('facilities.import.title')}</SheetTitle>
          <SheetDescription>{t('facilities.import.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 px-6 py-3">
          <ImportSteps current={step} furthest={furthest} allowBack={allowBack} onSelect={setRequestedStep} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('facilities.import.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Review fix (B1 Task 9): the create affordance the task's own gate was missing — a
                  fresh install has no registers at all (migration 082's back-fill only seeds from
                  `national_system` values a pre-existing `facility_registry` already carries), so
                  without this item the Select below stays on its empty state forever and facility
                  import is unreachable from the UI. Disabled with the rest of the sheet's inputs
                  while a run holds the register — see `inputsDisabled` — for the same reason the
                  Select itself is: registering a source an operator cannot yet select is no help. */}
              <DropdownMenuItem disabled={inputsDisabled} onClick={() => setRegisterSourceOpen(true)}>
                {t('facilities.import.registerSourceAction')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* A2b: the background door. Offered only while no run is in play, and gated on
                  `runId` rather than `run` deliberately: `runId` is set the instant the upload
                  resolves, whereas `run` stays null until the FIRST POLL answers — a window in which
                  the item would still be on the menu and a second upload still clickable. (`run` can
                  never be set without `runId`: only the poll writes it, and only picking a new file
                  clears either, so this is strictly the wider guard, not a different one.)
                  What a second upload would actually do depends on the run's state, and neither
                  outcome is one this sheet can show: the upload route's register gate SUPERSEDES a
                  run in any of `SUPERSEDABLE_RUN_STATES` (packages/db) — leaving the sheet watching
                  a run it no longer owns — and answers 409 for one a worker is holding
                  (`RUNNING_RUN_STATES` = `validating`/`applying`), which would surface as a bare
                  error over a file the operator just picked. `SUPERSEDABLE_RUN_STATES` has FOUR
                  members: `queued`, `awaiting_confirmation`, `confirmed` and `previewed`. A run this
                  sheet's Upload minted can only ever be one of the first three — `previewed` is
                  written by `startPreview` alone, i.e. the INLINE preview route's own state (same
                  reason `RUN_ACTIVE_STATUSES` above omits it) — but the fourth is named here anyway,
                  because an enumeration that silently drops a member of the constant it cites is how
                  a later reader learns the wrong set. */}
              {/* ⛔ NOT on Mapping, where it is already the visible button, and NOT on Source, where
                  taking it would skip the mapping step the whole flow exists to make legible. The
                  approved design says one visible action per step and EVERYTHING ELSE in this menu:
                  an item that repeats the button is neither, and an operator reported the menu as
                  contradicting the button it sat beside. It survives here only for Review, where a
                  re-upload is a genuine alternative to confirming. */}
              {!applyResult && !runId && step === 3 && (
                <DropdownMenuItem disabled={uploadDisabled} onClick={() => void handleUpload()}>
                  {uploading ? uploadLabel : t('facilities.import.uploadAction')}
                </DropdownMenuItem>
              )}
              {/* Preview is the inline door and slice 2 removes it outright. Until then it belongs
                  to Mapping, where a map exists to preview: offering it on Source invited an
                  operator to skip mapping entirely and then be refused for it. */}
              {!applyResult && !run && step === 2 && (
                <DropdownMenuItem disabled={previewDisabled} onClick={() => void runPreview()}>
                  {previewing ? t('facilities.import.previewing') : t('facilities.import.previewAction')}
                </DropdownMenuItem>
              )}
              {!applyResult && !run && canApply && (
                <DropdownMenuItem disabled={applying} onClick={() => setConfirmOpen(true)}>
                  {applying ? t('facilities.import.applying') : t('facilities.import.applyAction')}
                </DropdownMenuItem>
              )}
              {/* ⛔ Deliberately NOT rendered: Confirm is Review's visible button, and this menu is
                  for everything else. It was here before the step shell existed and stayed by
                  oversight, so the same action appeared twice on the same screen. The re-uploads
                  below are the genuine alternatives and they remain. */}
              {/* ⛔ THE RUN DOOR'S COMPLETABLE PATH FOR A PARSE-CHANGING OVERRIDE, and an ACTION, so
                  it lives here rather than as a control in the amber box (ui-actions-in-dots-menu).
                  It re-streams the SAME file with the override on the upload request, which
                  supersedes this run and mints one whose validate — and therefore whose summary —
                  ran with it. That is precisely what the confirm route's 409 tells the operator to
                  do, and before this it named a control the studio did not have. Each is offered
                  only where it could change something: see `canReuploadFor*`. */}
              {canReuploadForUnknownColumns && (
                <DropdownMenuItem
                  disabled={uploadDisabled || confirming || cancelling}
                  onClick={() => void handleUpload({ allowUnknownColumns: true })}
                >
                  {uploading ? uploadLabel : t('facilities.import.reuploadUnknownColumnsAction')}
                </DropdownMenuItem>
              )}
              {canReuploadForInvalidCoordinates && (
                <DropdownMenuItem
                  disabled={uploadDisabled || confirming || cancelling}
                  onClick={() => void handleUpload({ allowInvalidCoordinates: true })}
                >
                  {uploading ? uploadLabel : t('facilities.import.reuploadInvalidCoordinatesAction')}
                </DropdownMenuItem>
              )}
              {canReuploadForColumnMap && (
                <DropdownMenuItem
                  disabled={uploadDisabled || confirming || cancelling}
                  onClick={() => void handleUpload()}
                >
                  {uploading ? uploadLabel : t('facilities.import.reuploadColumnMapAction')}
                </DropdownMenuItem>
              )}
              {/* Offered only while the run is still live: the cancel route 409s on a terminal run,
                  and an affordance that can only fail is worse than none. */}
              {runActive && (
                <DropdownMenuItem disabled={cancelling || confirming} onClick={() => void handleCancelRun()}>
                  {cancelling ? t('facilities.import.cancellingAction') : t('facilities.import.cancelRunAction')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={previewing || applying || uploading} onClick={() => onOpenChange(false)}>
                {applyResult || runFinished ? t('common.close') : t('common.cancel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {/* Task 3: the source inputs — File, National system, File format, complete release and
              Release version — belong to Source (step 1) alone. Leaving them on screen at every step
              is what made five stages read as one scrolling surface; gone once the operator has
              picked a file and a register, back the moment they navigate to Source again. */}
          {step === 1 && needsRegister && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              <p className="font-medium">{t('facilities.import.noRegisterTitle')}</p>
              <p className="text-xs">{t('facilities.import.noRegisterBody')}</p>
            </div>
          )}

          {step === 1 && (
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-6 py-4 border-b border-border">
            <Label htmlFor="facility-import-file" className="whitespace-nowrap">{t('facilities.import.fileLabel')}</Label>
            <div>
              <input
                id="facility-import-file"
                type="file"
                accept=".csv,text/csv,.jsonl,application/x-ndjson"
                disabled={inputsDisabled}
                onChange={handleFileChange}
                className="text-sm text-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium disabled:cursor-not-allowed disabled:opacity-50"
              />
              {emptyFile && (
                <p className="mt-1 text-xs text-destructive">{t('facilities.import.emptyFileHint')}</p>
              )}
            </div>

            {/* B1 Task 9: a `Select` over registered sources, never a free-text box — the whole point
                being that `nationalSystem` can no longer be TYPED. `handleNationalSystemChange`
                receives the chosen `SelectItem`'s `value`, which is set to the source's `url` below,
                never its `name` — sending the display name instead would re-open the exact
                two-identities-one-namespace fork this slice exists to close (see `idFor`/
                `observedFieldSystem`'s doc comments, facility-csv.ts / facility-controlled-
                fields.ts). Disabled while loading, on error, or with nothing to offer — a `Select`
                an operator could open onto zero rows is worse than one that stays closed. */}
            <Label htmlFor="facility-import-national-system" className="whitespace-nowrap">{t('facilities.import.nationalSystemLabel')}</Label>
            <div>
              <Select
                // A plain `''`, never `undefined` — Radix warns on a `value` prop that flips between
                // controlled (a string) and uncontrolled (`undefined`) across renders, which is
                // exactly what `nationalSystem || undefined` would do the moment a source is picked.
                // An empty string never matches any `SelectItem` below (none is ever given `value=""`
                // — Radix disallows that on the ITEM, not the root), so the placeholder still shows
                // until a real source is chosen.
                value={nationalSystem}
                onValueChange={handleNationalSystemChange}
                disabled={inputsDisabled || sourcesLoading || sourcesError || sources.length === 0}
              >
                <SelectTrigger id="facility-import-national-system">
                  <SelectValue placeholder={
                    sourcesLoading
                      ? t('facilities.import.nationalSystemLoading')
                      : t('facilities.import.nationalSystemPlaceholder')
                  } />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.url}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {sourcesError
                  ? t('facilities.import.nationalSystemLoadError')
                  : !sourcesLoading && sources.length === 0
                    ? t('facilities.import.nationalSystemEmpty')
                    : t('facilities.import.nationalSystemHint')}
              </p>
            </div>

            {/* CT-3: which shape the file is — feeds `FacilityImportRequest.format` on every preview
                AND apply (see runPreview/handleApplyConfirm), and the `format` query parameter of an
                A2b upload. Without this control the sheet could never import a JSONL release at all,
                and `absent`/`deleted` (declaration-only fields a plain CSV can never carry) stayed
                permanently unreachable. */}
            <Label htmlFor="facility-import-format" className="whitespace-nowrap">{t('facilities.import.formatLabel')}</Label>
            <Select value={format} onValueChange={(v) => handleFormatChange(v as 'csv' | 'jsonl')} disabled={inputsDisabled}>
              <SelectTrigger id="facility-import-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">{t('facilities.import.formatCsv')}</SelectItem>
                <SelectItem value="jsonl">{t('facilities.import.formatJsonl')}</SelectItem>
              </SelectContent>
            </Select>

            {/* CT-3: feeds `FacilityImportRequest.completeRelease` — NECESSARY, but not sufficient,
                for a row's absence to mean anything (see that field's own doc comment, api.ts).
                ⛔ NOT wrapped in a second `<label>` around the Checkbox+hint (unlike the amber-box
                override checkboxes below) — that would give the checkbox TWO associated labels (this
                `Label` via `htmlFor`, plus the wrapper), and a double association is exactly the kind
                of accessible-name ambiguity `use-shadcn-components`/label-left-input-right exists to
                avoid. Mirrors the plain `Input` rows above: `Label` owns the name, the hint is a
                sibling `<p>`, not a second label.
                ⛔ IT REACHES BOTH DOORS. The inline path sends it in the request body; the Upload
                path sends it as the `completeRelease` query parameter, which the route stores in the
                run's `options` and the worker's validate spreads into `importFacilities`. The gap
                this comment used to record (a background validate always reporting `absent: null`,
                so the summary told the operator to declare a complete release they had just
                declared) is closed — see the upload route's own `completeRelease` block. */}
            <Label htmlFor="facility-import-complete-release" className="whitespace-nowrap">
              {t('facilities.import.completeReleaseLabel')}
            </Label>
            <div>
              <Checkbox
                id="facility-import-complete-release"
                checked={completeRelease}
                disabled={inputsDisabled}
                onCheckedChange={(c) => handleCompleteReleaseChange(c === true)}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('facilities.import.completeReleaseHint')}</p>
            </div>

            <Label htmlFor="facility-import-release-version" className="whitespace-nowrap">
              {t('facilities.import.releaseVersionLabel')}
            </Label>
            <Input
              id="facility-import-release-version"
              value={releaseVersion}
              onChange={(e) => handleReleaseVersionChange(e.target.value)}
              placeholder={t('facilities.import.releaseVersionPlaceholder')}
              disabled={inputsDisabled}
            />
          </div>
          )}

          {/* A2b: the run's own state. PHASE-FIRST and deliberately so — `total`/`processed` are
              published only for an apply of at least 5 000 rows (the worker's measured
              `PER_ROW_PROGRESS_MIN_ROWS`), so for most runs there is no denominator at all and a
              progress readout built around one would look broken far more often than it looked
              informative. `phase` is what is always there. */}
          {/* ⛔ IN THE SHEET BODY, not only on the ⋯ menu item. The menu is unmounted by Radix the
              moment Upload is selected, so a percentage rendered there alone is invisible for the
              whole of the transfer — which is precisely the thing `uploadFacilityImport` gives up
              `fetch` for. This is where the operator actually watches a 64 MiB file go. */}
          {uploading && (
            <p className="mx-6 mt-4 text-sm text-muted-foreground">{uploadLabel}</p>
          )}
          {/* ⚠ `!error` matters: the poll's catch STOPS the chain and leaves `run` null, so without
              it this line went on claiming an activity that had already given up — underneath the
              error box explaining that it had. Task 3: gated to Review (step 3) with the rest of the
              run status blocks below — `hasReview` (and so `step === 3`) is already true the instant
              `runId` is set, so this shows exactly when it used to. */}
          {step === 3 && runId && !run && !error && (
            <p className="mx-6 mt-4 text-sm text-muted-foreground">{t('facilities.import.runLoading')}</p>
          )}
          {step === 3 && run && RUN_ACTIVE_STATUSES.includes(run.status) && (
            <div className="mx-6 mt-4 rounded-md border border-border px-3 py-2 text-xs space-y-1">
              <p className="font-medium">{t(`facilities.import.runStatus.${run.status}`)}</p>
              {run.phase && <p className="text-muted-foreground">{t('facilities.import.runPhase', { phase: run.phase })}</p>}
              {run.total !== null && run.total > 0 && (
                <p className="text-muted-foreground">
                  {t('facilities.import.runProgress', { processed: run.processed, total: run.total })}
                </p>
              )}
            </div>
          )}

          {/* ⛔ THE CANCEL ROUTE'S TWO ANSWERS ARE NOT THE SAME ANSWER. 202 `requested` means a
              worker holds the run: the flag is read at phase boundaries only and cannot interrupt the
              transaction already running, so the import may still finish `applied`. Telling the
              operator it was "cancelled" would be a claim about a national register that the server
              never made. Only the 200 `cancelled` answer — a run in a state no worker claims, which
              the route terminated itself — may say so. */}
          {step === 3 && cancelOutcome && run && !RUN_TERMINAL_STATUSES.includes(run.status) && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {cancelOutcome === 'requested'
                ? t('facilities.import.cancelRequestedNotice')
                : t('facilities.import.cancelledNotice')}
            </div>
          )}
          {step === 3 && run?.status === 'cancelled' && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {t('facilities.import.cancelledNotice')}
            </div>
          )}
          {/* A confirm is a 202, not a promise the apply runs: `confirmed` is supersedable, so a
              newer upload of the same register can take the run over and it ends here instead. The
              operator sees that only because the sheet kept polling — which is why this block
              exists at all rather than the run simply vanishing from the screen. */}
          {step === 3 && run?.status === 'failed' && (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">{t('facilities.import.runFailedTitle')}</p>
              {run.error && <p className="text-xs">{run.error}</p>}
            </div>
          )}

          {/* Task 8: the column-mapping panel — after a file is chosen, before the preview. CSV
              only: a JSONL release is already in the contract's own shape, so a map for one is
              meaningless (Task 3's own doc comment on `FacilityImportOptions.columnMap`) — `format
              === 'csv'` alone gates that, since `columnMapHeaders` is always `[]` for `'jsonl'` (see
              the header-fetch effect above). Gone once a run exists at all (`!run`) or a summary is
              on screen (`!reviewResult`): the design's own flow maps columns exactly once, before
              the file ever leaves this tab, and the operator cannot edit it again afterwards — see
              `columnMap`'s own reset-on-file-swap comment for why it must not persist past that. */}
          {columnMapPanelShown && (
            <div className="mx-6 mt-4">
              <ColumnMapStep
                headers={columnMapHeaders}
                suggestions={columnMapSuggestions}
                value={columnMap}
                // ⛔ STILL A DIRECT, SYNCHRONOUS ROUND-TRIP — see `columnMap`'s own state comment
                // above. The only addition is counting OPERATOR edits, which is what the summary's
                // lifetime keys on; the write to `columnMap` itself is unconditional as before.
                onChange={(next, origin) => {
                  setColumnMap(next);
                  if (origin === 'edit') setColumnMapEdits((n) => n + 1);
                }}
                rowCount={columnMapRowCount}
                onValidityChange={setColumnMapValid}
              />
              {/* Non-blocking — see `columnMapValid`'s own state comment for why this never
                  disables Preview/Upload. Purely a heads-up: the server's own refusal (rendered
                  below, once one exists) is what actually explains any problem. */}
              {!columnMapValid && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('facilities.import.columnMapIncompleteHint')}
                </p>
              )}
              {/* Round-2 fix: the refusal that keeps this panel mounted needs its OWN explanation
                  HERE too. `ReconciliationSummary`'s copy of this same block only ever renders on
                  Review (step 3) — which a column-map refusal no longer reaches (see the
                  auto-advance effect's `columnMapRefused` guard) — so without this the operator
                  would see the panel with no reason given for why it is still here. Same
                  component, same i18n keys as the Review-side copy; nothing here is reworded. */}
              {columnMapRefused && reviewResult && (
                <div className="mt-3">
                  <ColumnMapErrorsNotice result={reviewResult} />
                </div>
              )}
            </div>
          )}

          {/* Whole-branch review, FINDING 2: step 2 with nothing on it. `columnMapPanelShown`
              covers five distinct states with one gate — a JSONL release, an applied run, a run or a
              summary that is not a column-map refusal, and the brief window while `File.text()` is
              still resolving — and every one of them left this step a blank pane, most visibly for a
              first, ordinary JSONL upload: Continue from Source landed on a step labelled Mapping
              with nothing on it at all. Two messages, not five: JSONL has no column map to set at
              all; every other case's map already went out with the upload and cannot be changed
              from here now. */}
          {step === 2 && !columnMapPanelShown && (
            <p className="mx-6 mt-4 text-sm text-muted-foreground">
              {format === 'jsonl'
                ? t('facilities.import.columnMapNotApplicableJsonl')
                : t('facilities.import.columnMapAlreadySent')}
            </p>
          )}

          {/* Task 2/3: the decisions live here now, not on Review. `findings` is the last check's
              result guarded by `worklistSignature`, which is what makes the three contextual
              overrides (and the absent/deleted policies) appear only once a check has actually
              reported the thing they answer. Before any check it renders the conflict policy alone,
              which is the one choice that can never be discovered from a summary. */}
          {step === 2 && !applyResult && !runFinished && (
            <div className="mx-6 mt-4">
              <ImportPolicyPanel
                onConflict={onConflict}
                onConflictChange={setOnConflict}
                onAbsent={onAbsent}
                onAbsentChange={setOnAbsent}
                onDeleted={onDeleted}
                onDeletedChange={setOnDeleted}
                allowUnknownColumns={allowUnknownColumns}
                onAllowUnknownColumnsChange={toggleAllowUnknownColumns}
                allowInvalidCoordinates={allowInvalidCoordinates}
                onAllowInvalidCoordinatesChange={toggleAllowInvalidCoordinates}
                allowMalformedRows={allowMalformedRows}
                onAllowMalformedRowsChange={toggleAllowMalformedRows}
                disabled={previewing || uploading || confirming || cancelling}
                showConflictChoice={fromRun || !!previewResult?.runId}
                findings={liveFindings}
              />
            </div>
          )}

          {/* Task 4: the value-mapping worklist, where the deciding happens. Fed by the last
              check's findings, so it is absent on the first pass (nothing has read the file yet)
              and present once a check has found work. Review reports the same values read-only. */}
          {step === 2 && !applyResult && liveFindings
            && CONTROLLED_FIELDS.some((f) => liveFindings.unmapped[f].length > 0) && (
            <div className="mx-6 mt-4">
              <ValueMapPanel
                nationalSystem={nationalSystem.trim()}
                unmapped={liveFindings.unmapped}
                onSaved={handleValueMappingsSaved}
              />
            </div>
          )}

          {step === 3 && reviewResult && !appliedSummary && (
            <ReconciliationSummary
              result={reviewResult}
              // A FACT about this result, not a control. On the run door it is what the upload
              // recorded; on the inline door the live state, which the invalidation guarantees is
              // the state this result was computed under.
              unknownColumnsOverridden={reupload ? reupload.allowUnknownColumns : allowUnknownColumns}
              // Inline: only a preview that minted a run can be linked to an apply that could ever
              // discover a conflict. Background: the run IS the link, always.
              showConflictChoice={fromRun || !!previewResult?.runId}
              overCap={!fromRun && overCap}
              reupload={reupload}
            />
          )}

          {step === 3 && appliedSummary && (
            <div className="mx-6 mt-4 space-y-2 text-sm">
              {/* ⛔ A file that produced NO ROWS is not a completed import, and saying so in green
                  is how the Zambia team read "Import complete. Created 0, updated 0, skipped 0."
                  over a national export that had written nothing at all. Gated on `parsed === 0`,
                  NOT on "wrote nothing": re-importing a byte-identical register legitimately writes
                  nothing because every row is `unchanged`, and that IS a completed import. */}
              {appliedSummary.parsed === 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700">
                  <p className="font-medium">{t('facilities.import.nothingImportedTitle')}</p>
                  <p>{t('facilities.import.nothingImportedBody')}</p>
                  {appliedSummary.unknownColumns.length > 0 && (
                    <p className="mt-1">{t('facilities.import.nothingImportedUnknownColumns')}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-700">
                  <p className="font-medium">{t('facilities.import.doneTitle')}</p>
                  <p>{t('facilities.import.doneSummary', { created: appliedSummary.written.created, updated: appliedSummary.written.updated, skipped: appliedSummary.skipped })}</p>
                  {appliedSummary.duplicates > 0 && (
                    <p>{t('facilities.import.duplicatesWarning', { count: appliedSummary.duplicates })}</p>
                  )}
                </div>
              )}

              {/* CT-3: THE FIX FOR THE DEFECT THIS TASK CLOSES. Before this, a row edited between
                  preview and apply was classified `conflict`, skipped by default (or overwritten),
                  and the apply result rendered only `written.created`/`written.updated`/`skipped` —
                  the conflict never appeared anywhere on screen: no count, no sample, no sign it had
                  even happened. `onConflict` (still held in state after Apply) decides which of the
                  two honest outcomes actually occurred. */}
              {appliedSummary.conflict !== null && appliedSummary.conflict > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <p>
                    {t(
                      onConflict === 'overwrite'
                        ? 'facilities.import.applyConflictOverwritten'
                        : 'facilities.import.applyConflictSkipped',
                      { count: appliedSummary.conflict },
                    )}
                  </p>
                  {appliedSummary.samples.conflict.length > 0 && (
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                      {appliedSummary.samples.conflict.map((row) => (
                        <li key={row.id}>{row.nationalCode ? `${row.name} (${row.nationalCode})` : row.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ⛔ THE ONE EXCEPTION to AGENTS.md section 5, and it is deliberately narrow: exactly one
            visible button, the one that advances this step. Every other action, including Preview,
            all three re-uploads, Cancel and Close, stays in the dropdown at the top of the sheet.
            No labelled Back button lives here: the step strip's own steps are the back affordance,
            clickable whenever `allowBack` is true (see `ImportSteps.tsx`).

            ⛔ PINNED, and that is an operator decision taken with its costs stated. It sits AFTER
            the scrolling body so it stays put while a 3 700-row mapping list scrolls past, which is
            the whole reason it moved out of the band under the step strip. Two things follow.

            First, this is a footer in all but name, which bends section 5 further than the primary
            action exception alone. It carries ONE action and never a Cancel/Save pair, which is the
            shape that rule actually forbids.

            ⚠ Second, HEADLESS CHROMIUM CANNOT VERIFY THE BOTTOM EDGE. `SheetContent` is
            `fixed inset-y-0`, so this row sits at the bottom of the FIXED viewport, and a browser
            with a retractable URL bar measures that differently from a headless one, which has no
            chrome to retract. Every automated bottom-edge check passes either way. `env(safe-area-
            inset-bottom)` below covers the iOS home indicator; it does NOT cover a retracting URL
            bar. Only a real phone can confirm this. See AGENTS.md's mobile-testing note. */}
        <div
          className="flex items-center justify-end gap-2 border-t border-border px-6 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {step === 1 && (needsRegister ? (
            <Button size="sm" disabled={inputsDisabled} onClick={() => setRegisterSourceOpen(true)}>
              {t('facilities.import.registerSourceAction')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!stepGate.hasFile || !stepGate.hasRegister}
              onClick={() => setRequestedStep(2)}
            >
              {t('facilities.import.continueAction')}
            </Button>
          ))}
          {/* Whole-branch review, FINDING 1: this button used to check only `uploadDisabled` — the
              dropdown's own Upload item ALSO checks `!applyResult && !runId` (see that item's own
              comment for why: a second upload either supersedes the run this sheet is watching or
              409s). Once a run reaches a terminal state `runActive` goes false, the step strip
              reopens, and an operator who clicks back to Mapping saw this button enabled and could
              fire a second upload the dropdown itself would never offer. Mirrors that same gate.
              (b) That gate alone would leave Mapping with no action in the one case an operator most
              needs one: a column-map refusal parks them here with `runId` already set. So the
              refusal gets its own branch first, reusing the exact action (and label) the dropdown's
              `canReuploadForColumnMap` item already offers — no new copy, no new handler. */}
          {/* Three shapes of the same action, because what it MEANS depends on what came before.
              No run yet: this is the upload. A refused map: the re-upload the refusal names. A run
              that simply exists: still a re-upload, because the operator stepped back here to
              change something and needs a way to send it. All three call `handleUpload`, which
              reads the live map and supersedes any run this sheet is watching. */}
          {step === 2 && !applyResult && (
            <Button
              size="sm"
              disabled={uploadDisabled || confirming || cancelling}
              onClick={() => void handleUpload()}
            >
              {uploading ? uploadLabel : t(
                !runId ? 'facilities.import.uploadAction'
                  : columnMapRefused ? 'facilities.import.reuploadColumnMapAction'
                    : 'facilities.import.reuploadWithMapAction',
              )}
            </Button>
          )}
          {step === 3 && canConfirmRun && (
            <Button size="sm" disabled={confirming || cancelling} onClick={() => void handleConfirmRun()}>
              {confirming ? t('facilities.import.confirming') : t('facilities.import.confirmAction')}
            </Button>
          )}
        </div>

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('facilities.import.applyConfirmTitle')}
          description={reviewResult ? t('facilities.import.applyConfirmBody', { count: willWriteCount }) : undefined}
          confirmLabel={t('facilities.import.applyAction')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { void handleApplyConfirm(); }}
        />

        <RegisterSourceDialog
          open={registerSourceOpen}
          onOpenChange={setRegisterSourceOpen}
          onCreated={handleSourceCreated}
        />
      </SheetContent>
    </Sheet>
  );
}

export default ImportFacilitiesSheet;
