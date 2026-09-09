import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MoreHorizontal, Upload } from 'lucide-react';
import { Divider } from '@/components/ui/bleed';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  cancelFacilityImportRun,
  confirmFacilityImportRun,
  getFacilityImportRun,
  listFacilityImportSources,
  suggestColumnMap,
  uploadFacilityImport,
  revalidateFacilityImportRun,
  writeFacilityValueMappings,
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
import { pendingValueMappings, resolvedValueKey, useMappingCheckState } from './mappingCheckState';
import { DataGridStep } from './DataGridStep';
import { ImportPolicyPanel } from './ImportPolicyPanel';
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
 *  never enter (only `startPreview` writes it). `stored` is also absent: Source's own store-only
 *  upload sets it, and nothing is "going to happen" to a stored run until Mapping asks for a real
 *  check, so there is no worker activity to report a status line for. */
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
  /** Called once an APPLY succeeds (never for a check) so the caller can reload its list — see
   *  Facilities.tsx, which passes its own `reload`. Fired when a run this sheet is watching reaches
   *  `applied`. */
  onImported: () => void;
}

/** The two shapes this importer reads, named ONCE so the drop check below and the `accept` on the
 *  input itself cannot drift apart. `parseFacilityCsv` and `parseFacilityRelease` are what actually
 *  read them (packages/terminology). */
const ACCEPTED_FILE_EXTENSIONS = ['.csv', '.jsonl'] as const;

/** How much of the chosen file is read into this tab.
 *
 *  The ONLY thing the sheet needs the file's text for is its header row: `suggestColumnMap` posts
 *  it, and that route splits on the first newline and throws the rest away
 *  (apps/server/src/facilities-routes.ts). Reading the WHOLE file was the inline door's
 *  requirement, because that door carried the register in a JSON body. It is gone, and the upload
 *  sends the `File` itself, so a 64 MiB national register no longer enters this tab at all.
 *
 *  ⛔ A header row longer than this truncates, and a truncated line reaches the same 400 the
 *  route already returns for a header row it cannot read. MEASURED on the real Zambia MFL export
 *  (`packages/cli/src/__fixtures__/zm-mfl-head.csv`): 21 columns, 260 bytes. This is 252 times
 *  that, so it is a ceiling with a very wide margin rather than a fit. */
const HEAD_BYTES = 64 * 1024;

/** A file size an operator can read. Mirrors `humanSize` in `pages/Terminology.tsx`: this sheet does
 *  not import from that page, and a shared one is a bigger change than this finding asked for. */
function humanFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${units[i]}`;
}



export function ImportFacilitiesSheet({ open, onOpenChange, onImported }: ImportFacilitiesSheetProps) {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  /** The extension of a file the operator dropped that this importer cannot read, or null. Held so
   *  the refusal can NAME what they dropped rather than saying nothing and looking broken. */
  const [wrongType, setWrongType] = useState<string | null>(null);
  /** ⛔ REQUESTED, not effective. `clampStep` below is what actually renders, so a step the operator
   *  has not earned can never be shown even if this holds a stale value: picking a different file
   *  drops `hasReview` and the view falls back on its own, with no extra reset to remember. */
  const [requestedStep, setRequestedStep] = useState<ImportStep>(1);
  const [csvHead, setCsvHead] = useState<string | null>(null);
  /** ⛔ WHY A COUNTER AND NOT JUST `csvHead`. Choosing the SAME file twice (browse it, then drag it
   *  in, which is what an operator did on the real Zambia export) reads a byte-identical head. React
   *  bails out of a state update whose value is `Object.is`-equal to the current one, so `csvHead`
   *  never "changes", the effect below never re-runs, and the header list `selectFile` just cleared
   *  is never refilled. The Mapping step then has no column map to offer and says the map was
   *  already sent with the upload, which is untrue and cost that operator a whole refused import.
   *  This counter advances on every completed read, so a fresh read always re-derives the headers
   *  whether or not its text differs. */
  const [csvHeadReads, setCsvHeadReads] = useState(0);
  /** Did BOTH ways of reading a header row come up with nothing?
   *
   *  ⛔ NOT `columnMapHeaders.length === 0`, and that distinction is load-bearing. An empty list is
   *  also what you have before the read runs at all, and what a `suggest-map` response would mean
   *  if it ever returned one — it does not, it answers an unreadable head with a 400. Inferring the
   *  refusal from an empty list therefore fires on states that are not refusals. This is set only on
   *  the path that genuinely means it: the request failed AND the client's own fallback split of the
   *  first line produced no fields either. */
  const [headerRowMissing, setHeaderRowMissing] = useState(false);
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
  // than imported with both coordinates null. Unlike `allowMalformedRows`, this one CHANGES THE
  // PARSE — it decides which rows land in `records`, not merely whether the apply may proceed — so
  // it rides the upload and a change to it needs a fresh check, never a re-read of the same summary.
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
  /** ⛔ THE MAPPING STEP'S CHECK RESULTS LIVE HERE, NOT IN `ColumnMapStep`. That panel renders only
   *  while `step === 3`, so state it owned itself was destroyed by an ordinary click on Data and
   *  rebuilt empty on the way back: a row the operator had just checked came back unchecked, and
   *  pick-list choices they had made but not yet saved were lost outright. None of it describes the
   *  panel. It describes the file this run is importing, which is the sheet's own subject.
   *  `selectFile` below is the one place it is thrown away. */
  const checkState = useMappingCheckState();
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

  const [error, setError] = useState<string | null>(null);

  // A2b: the background run this sheet is watching, and the request states around it.
  const [runId, setRunId] = useState<string | null>(null);
  /** Which run the POLL effect below actually watches. Distinct from `runId`: Source's own
   *  store-only call (`validate: false`) sets `runId` (that is the whole of `hasStoredFile`'s
   *  signal) but mints a `stored` run nothing is "going to happen" to yet. See `RUN_ACTIVE_
   *  STATUSES`'s own doc comment. Polling it anyway would be wasted requests forever (a `stored`
   *  run never leaves that status on its own), so this stays `null` until a REAL validate (Mapping's
   *  own upload) sets it, and reverts to `null` on a fresh store so a superseded run's poll cannot
   *  answer for a run that no longer exists on screen. */
  const [pollRunId, setPollRunId] = useState<string | null>(null);

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
    if (!pollRunId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const next = await getFacilityImportRun(pollRunId);
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
  }, [pollRunId, refreshNonce]);

  // `onImported()`, fired when a run this sheet is watching reaches `applied`. Guarded by run id
  // (not a boolean) so it fires once per applied run and never twice for one.
  useEffect(() => {
    if (run?.status === 'applied' && notifiedRunRef.current !== run.id) {
      notifiedRunRef.current = run.id;
      onImported();
    }
  }, [run, onImported]);

  // Any change to the inputs a check was computed against invalidates that check — otherwise the
  // operator could edit the national system (or pick a different file) afterwards and still see a
  // stale summary describing the OLD input. What it clears now is only the error: the summary
  // itself is retired by `summarySignature` moving, which is what makes Review current or absent.
  const invalidatePreview = () => {
    setError(null);
  };

  /**
   * Choosing a file, whichever way the operator did it.
   *
   * ⛔ ONE FUNCTION FOR BOTH DOORS. Browsing and dropping must reset EXACTLY the same state, and the
   * list below is long enough that a second copy would silently miss one. A drop that skipped, say,
   * `setColumnMap(EMPTY_COLUMN_MAP)` would carry the previous file's mapping decisions onto a file
   * whose headers were never checked against them, which is the defect the reset exists to prevent.
   */
  const selectFile = (f: File | null) => {
    setWrongType(null);
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
    // (3) And every answer the mapping step had already collected about the OLD file: which rows
    // were checked, which values were written, which picks are pending. This used to happen by
    // accident, because `ColumnMapStep` owned that state and unmounting threw it away — which is
    // also why it happened on an ordinary trip to Data, where it was flatly wrong. Now the sheet
    // owns it and discards it exactly here, at the one event that really does invalidate it.
    checkState.reset();
    // A2b: a new file starts a new import in every sense. The picker is disabled while a run is
    // live (see `inputsDisabled`), so this only ever discards a run that has already finished.
    setRunId(null);
    setPollRunId(null);
    setRun(null);
    setCancelOutcome(null);
    setUploadProgress(null);
    invalidatePreview();
    // ⚠ THE HEAD, NOT THE FILE. Only the header row is ever read out of it — see `HEAD_BYTES`.
    // The upload path touches neither: the `File` itself is the request body (see
    // `uploadFacilityImport`), which is what keeps a national register out of this tab's memory.
    if (!f) { setCsvHead(null); return; }
    void f.slice(0, HEAD_BYTES).text().then((text) => {
      // Both setters in one handler so React batches them: the effect below sees the new text and
      // the new read count together, and never fires once for each.
      setCsvHead(text);
      setCsvHeadReads((n) => n + 1);
    }).catch((err: unknown) => {
      setCsvHead(null);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => selectFile(e.target.files?.[0] ?? null);

  /**
   * A dropped file.
   *
   * ⛔ THE EXTENSION IS CHECKED HERE, and it is not checked anywhere else on this path. `accept` on
   * the input governs the BROWSE dialog only; the browser applies none of it to a drop, so without
   * this an operator could drop a .zip and watch it upload before the server refused it. Refused by
   * NAMING what they dropped, because a drop that silently does nothing reads as a broken control.
   */
  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (inputsDisabled) return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const dot = f.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : f.name.slice(dot).toLowerCase();
    if (!(ACCEPTED_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      // Deliberately does NOT clear an already-chosen file: a mis-drop must not destroy the good
      // file the operator picked a moment ago.
      setWrongType(ext === '' ? f.name : ext);
      return;
    }
    selectFile(f);
  };

  // Task 8: the header row + this app's own ranked suggestions for the current CSV file — one
  // network round-trip, headers and suggestions together (never headers-first-suggestions-later:
  // `ColumnMapStep`'s own seed effect is gated on a header SIGNATURE alone, so headers arriving
  // before their matching suggestions would let it seed nothing and then never retry once the real
  // suggestions landed a moment later). Re-runs whenever the file's text OR the declared format
  // changes, and on every completed head READ even when the text is unchanged (see `csvHeadReads`
  // above: re-choosing the same file must re-derive the headers `selectFile` just cleared).
  // `format` because switching to `jsonl` must clear any CSV-only header list, `csv`
  // because a new file means new headers.
  useEffect(() => {
    if (!csvHead || format !== 'csv') {
      setColumnMapHeaders([]);
      setColumnMapSuggestions([]);
      setHeaderRowMissing(false);
      return;
    }
    setHeaderRowMissing(false);
    let cancelled = false;
    suggestColumnMap(csvHead)
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
        const firstLine = csvHead.split(/\r?\n/, 1)[0] ?? '';
        const headers = firstLine.split(',').map((h) => h.trim()).filter((h) => h !== '');
        setColumnMapHeaders(headers);
        setColumnMapSuggestions([]);
        setHeaderRowMissing(headers.length === 0);
      });
    return () => { cancelled = true; };
  }, [csvHead, format, csvHeadReads]);

  const handleNationalSystemChange = (value: string) => {
    setNationalSystem(value);
    invalidatePreview();
  };

  // The UPLOAD route's byte ceiling, whose 413 body names a raw byte count ("the register file
  // exceeds the 67108864-byte upload limit") — a number nobody reads as a size. The server writes it
  // for a CLI or log reader; dumped verbatim into this sheet it reads as a stray fragment, and a
  // Settings-page operator may have no shell into the container at all.
  //
  // ⛔ The inline route's TWO caps used to be recognised here as well, a row count ('inline apply
  // limit') and a byte size ('mb limit for this endpoint'). Nothing in the studio can reach either
  // any more: both belong to `POST /api/facilities/import`, and this sheet no longer calls it.
  const friendlyImportErrorMessage = (raw: string): string => {
    const lower = raw.toLowerCase();
    if (lower.includes('byte upload limit')) return t('facilities.import.tooLargeUploadError');
    return raw;
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

  // ── A2b: the background path's three actions ────────────────────────────────────────────────────

  /** @param overrides The two PARSE-CHANGING flags, when this call is the run door's "re-upload with
   *  this option" rather than a first upload. Passed explicitly because the ⋯ item that sets one has
   *  to send its just-chosen value ahead of the React state update it also triggers.
   *  ⛔ `allowMalformedRows` is NOT one of them — it never reaches the parser, so it stays the
   *  confirm's and needs no second trip through the file. */
  /**
   * Check the file this run ALREADY UPLOADED again, under new options. Falls back to a fresh upload
   * when there is nothing stored to re-check.
   *
   * ⛔ THE FALLBACK IS NOT DEAD CODE, though half its old reason is gone. It used to cover a run
   * from the inline preview door, which stored no file at all; every run now stores one, so
   * `blobKey` is never null. The other half is still live: a run that has moved on to a state
   * `revalidateImportRun` refuses (`confirmed`, `applying`, a terminal state, …) cannot be
   * re-checked either, and `canRevalidate` tests both. For that one, sending the file again is the
   * only thing that can work.
   *
   * ⛔ `run === null` COUNTS AS REVALIDATABLE, and that is deliberate, not a gap. Source's
   * store-only call never sets `pollRunId` (see that state's own comment: nothing is "going to
   * happen" to a `stored` run until a real validate asks for one), so `run` is never fetched and
   * stays `null` all the way to Mapping's first click. `packages/bootstrap/src/facility-revalidate.ts`
   * widened its guard the same way this reads it: `stored` is revalidatable, and a `stored` run is
   * exactly what `runId !== null && run === null` describes here, since `stepGate.hasStoredFile`
   * already means Mapping is unreachable without one. Every OTHER non-revalidatable status
   * (`confirmed`, a terminal state, `queued`/`validating` again) is only reachable AFTER a real
   * validate has run, which is what populates `run` in the first place. So `run === null` never
   * means one of those. `run?.blobKey` dropped from the check for the same reason the comment above
   * `handleUpload` gives: every run stores a file now, so it was never the fact doing the gating.
   */
  /** Write every value pick the mapping step is holding but has not saved. Shares
   *  `pendingValueMappings` with `ColumnMapStep`'s own per-row commit, so the two doors can never
   *  disagree about what counts as pending. Returns false only when the write itself failed. */
  const commitPendingValueMappings = async (): Promise<boolean> => {
    const entries = pendingValueMappings(checkState, (header) => columnMap.columns[header] ?? '');
    if (entries.length === 0) return true;
    try {
      const result = await writeFacilityValueMappings(nationalSystem.trim(), entries);
      checkState.setResolvedValues((prev) => {
        const next = new Set(prev);
        for (const entry of entries) next.add(resolvedValueKey(entry.field, entry.rawValue));
        return next;
      });
      toast.success(t('facilities.import.valueMap.savedCount', { count: result.written }));
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleRevalidate = async (
    overrides?: { allowUnknownColumns?: boolean; allowInvalidCoordinates?: boolean },
  ): Promise<void> => {
    const canRevalidate = !!runId && (run === null || run.status === 'awaiting_confirmation');
    if (!canRevalidate) { await handleUpload(overrides); return; }

    // ⛔ WRITE THE OPERATOR'S PICKS FIRST. A row's own status icon already does this before it
    // re-reads that column; this is the same rule for the button that checks every column at once.
    // Without it the reported bug came back through the other door: pick four values, press
    // Validate all rather than the icon, and the check reports the same four unrecognised because
    // nothing was ever written. A failed write stops here rather than producing a summary that
    // describes decisions the register does not carry.
    if (!await commitPendingValueMappings()) return;

    const allowUnknown = overrides?.allowUnknownColumns ?? allowUnknownColumns;
    const allowInvalid = overrides?.allowInvalidCoordinates ?? allowInvalidCoordinates;
    // Kept in state as well as sent, for the same reason `handleUpload` keeps them: the summary the
    // operator reviews next must be the one these options produced.
    setAllowUnknownColumns(allowUnknown);
    setAllowInvalidCoordinates(allowInvalid);
    setUploading(true);
    setError(null);
    try {
      await revalidateFacilityImportRun(runId as string, {
        columnMap: hasColumnMapContent(columnMap) ? columnMap : undefined,
        allowUnknownColumns: allowUnknown,
        allowInvalidCoordinates: allowInvalid,
      });
      // The run is back in the validate queue. Dropping the stale summary here is what stops the
      // previous verdict sitting on screen with its Confirm.
      //
      // ⛔ THE NONCE IS NOT OPTIONAL. The poller keys on `[pollRunId, refreshNonce]` and stops once a
      // run reaches a status it does not poll. `awaiting_confirmation` is exactly that. A re-check
      // reuses the SAME `runId`, so without bumping the nonce nothing ever asks again and the sheet
      // sits on "Checking the import run" forever. The upload path never hit this because a new
      // upload changes `runId` and restarts the effect on its own.
      //
      // ⛔ `setPollRunId` IS NEW HERE, and it is what makes the `stored` case actually work rather
      // than just satisfying the guard. A `stored` run never set `pollRunId` in the first place (its
      // own upload deliberately left it `null`), so without this call the poll effect's own
      // `if (!pollRunId) return` would skip it forever and the sheet would sit on "Checking the
      // import run" with nothing ever asking. Harmless for the `awaiting_confirmation` case: it is
      // already the same id, so React does not even re-render for it, and the nonce bump above is
      // what does the work there.
      setPollRunId(runId as string);
      setRun(null);
      setSummaryAt(signatureWith(overrides));
      setRefreshNonce((n) => n + 1);
    } catch (err) {
      setError(friendlyImportErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (
    overrides?: {
      allowUnknownColumns?: boolean;
      allowInvalidCoordinates?: boolean;
      /** Fix for the reachability regression: `false` is Source's own store-only call, sent as
       *  `validate=false` so the upload mints a `stored` run instead of a `queued` one. Every
       *  other caller omits this and keeps upload-and-validate. */
      validate?: boolean;
    },
  ): Promise<void> => {
    if (!file || !nationalSystem.trim()) return;
    const allowUnknown = overrides?.allowUnknownColumns ?? allowUnknownColumns;
    const allowInvalid = overrides?.allowInvalidCoordinates ?? allowInvalidCoordinates;
    // Kept in state as well as sent, so a later re-check reads the same answer the run was actually
    // created with.
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
          // MEASURED instead of reported `null`.
          completeRelease,
          // ⛔ THE ONLY WAY A REGISTER THAT NEEDS ONE OF THESE CAN EVER BE IMPORTED FROM THE BROWSER.
          // Both are fed to the parser, so they have to be decided BEFORE the validate that computes
          // the summary the operator confirms — the confirm route refuses either one arriving late,
          // and the studio's upload not sending them is what left a CSV register with one
          // unrecognised column with no completable path at all (tick ⇒ guaranteed 409; don't tick ⇒
          // an apply that parses nothing, writes nothing and still reports `applied`).
          allowUnknownColumns: allowUnknown,
          allowInvalidCoordinates: allowInvalid,
          // Task 8b: the same guard `confirmOptionsFor` already applies — an empty map is not the
          // same as no map (see `hasColumnMapContent`'s own doc comment), so this is
          // sent only when the operator actually mapped something. Stored on the run's `options`
          // before its own validate runs, which is what makes this door's validate agree with what
          // the operator sees, instead of reading the file's raw headers.
          columnMap: hasColumnMapContent(columnMap) ? columnMap : undefined,
          validate: overrides?.validate,
        },
        setUploadProgress,
      );
      setCancelOutcome(null);
      // ⛔ The OLD run's view, not just its id. A re-upload supersedes the run whose summary is on
      // screen (`awaiting_confirmation` is a supersedable state), so leaving `run` set would keep
      // rendering that summary — and its Confirm — over a run the register no longer belongs to,
      // until the first poll of the new one answered. Inert on a first upload, where it is already
      // null.
      setRun(null);
      setRunId(id);
      // ⛔ NOT OPTIONAL, even when the id is unchanged (only a real risk under a test double, since
      // a real server never hands out the same id twice). The poll effect keys on
      // `[pollRunId, refreshNonce]`, so an id equal to the run already being watched would leave
      // React seeing no change and never re-poll, and `run` would stay stuck at the `null` just
      // set above.
      setRefreshNonce((n) => n + 1);
      if (overrides?.validate === false) {
        // Source's own store-only call. Nothing has been checked, so there is no review to earn
        // yet: `summaryAt` stays as it was, and `hasStoredFile` (now `runId !== null`) is the only
        // gate this call moves. `pollRunId` stays null: a `stored` run has nothing worth polling
        // for (see that field's own comment). Land on Data, the step this call belongs to.
        setPollRunId(null);
        setRequestedStep(2);
      } else {
        // A real validate. This is what actually starts the poll. See `pollRunId`'s own comment.
        setPollRunId(id);
        // Task 2: the streamed door earns its Review here, at the upload, for the same reason
        // `runId` is in `stepGate` at all: the first poll has not answered yet and the operator
        // must not be left on Mapping watching nothing.
        //
        // ⛔ `signatureWith(overrides)`, not the ref: this call sets the two override states just
        // above and then awaits, so on a fast response React may not have re-rendered and the ref
        // would still hold the pre-override value.
        setSummaryAt(signatureWith(overrides));
      }
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
  /** ⛔ A STORED RUN, WHICH `runActive` CANNOT SEE. Source's Continue mints a run holding the
   *  register's `active_key`, and a `stored` run is deliberately never polled (see `pollRunId`), so
   *  `run` stays null and every predicate built on `run.status` reads false. `runId !== null &&
   *  run === null` is exactly that state, the same reading `handleRevalidate` already relies on.
   *
   *  It matters for ONE affordance: Cancel. An operator who clicks Continue and then changes their
   *  mind had nothing on screen to take, and closing the sheet does not release the register. The
   *  cancel route accepts a `stored` run (it is in `SUPERSEDABLE_RUN_STATES` and not terminal), so
   *  the item can actually do something.
   *
   *  ⛔ NOT AN EXPIRY, A CLEANUP JOB, OR A BLOB REAPER. Those are a later slice. This is the missing
   *  way out of a step the operator is standing on. */
  const storedRunCancellable = runId !== null && run === null && cancelOutcome === null;
  /** The summary a background run has PARKED for the operator to decide about. Only ever set at
   *  `awaiting_confirmation`: an earlier run has nothing computed yet, and a later one has already
   *  been decided. */
  const awaitingSummary: FacilityImportResult | null =
    run && run.status === 'awaiting_confirmation' ? run.summary : null;
  /** The reconciliation currently under review: the summary a run's own validate stored. Picking a
   *  file clears any run, so this is either current or absent. */
  /** Task 8: `ValueMapPanel`'s `onSaved`. A just-written mapping only takes effect on a fresh parse,
   *  and the summary on screen came from a worker's validate over the uploaded blob rather than from
   *  a request this tab can simply repeat. */
  // ⛔ NO RE-CHECK HERE ANY MORE, and on the run door that also means no silent re-upload. Saving
  // used to re-parse and carry the operator to Review, so the page both asked the question and
  // reported the answer. Saving is now a local edit: it bumps the stamp, which retires the summary,
  // and asking for a fresh check stays the operator's decision. The worklist survives deliberately
  // (`worklistSignature` does not read this stamp), so the remaining rows do not vanish mid-edit.
  const handleValueMappingsSaved = (): void => {
    setValueMappingsSavedAt((n) => n + 1);
  };
  /** The parse-override state, read off the RUN rather than this sheet's own — see
   *  `ReuploadOverrides`. What the validate actually ran with is the only honest answer here, and
   *  this sheet's own checkbox can be ahead of it. `null` until the first poll answers. */
  const reupload: ReuploadOverrides | null = run
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
  const columnMapRefused = awaitingSummary?.blockedReason === 'column-map';
  /** The background door's completable path for a refused map, and the mirror of the two re-uploads
   *  above: those re-stream the file with a parse-changing FLAG, this one re-streams it with the map
   *  the operator has just corrected in the panel. `handleUpload` reads the live `columnMap` and
   *  supersedes this run, so the validate reviewed is the one the corrected map produced. */
  const canReuploadForColumnMap = !!awaitingSummary && !!reupload && columnMapRefused;
  /** What actually got written, whichever door did it. */
  const appliedSummary: FacilityImportResult | null =
    run && run.status === 'applied' ? run.summary : null;

  // Task 3: the three-step shell. Placed here, after `appliedSummary`, because `stepGate` reads it —
  // any earlier and the derivation below would use a value that does not exist yet.
  //
  // ⛔ `hasReview` ALSO CHECKS `runId`, not just `awaitingSummary`/`appliedSummary`. An upload sets
  // `runId` the instant it resolves, but `awaitingSummary` (which reads `awaitingSummary`, which reads
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

  /** The signature for a request that carries OVERRIDES, computed from the values actually sent.
   *
   *  ⛔ NOT the ref, for a request that changes state first. `handleUpload`/`handleRevalidate` call
   *  `setAllowUnknownColumns`/`setAllowInvalidCoordinates` and then await; a mocked or fast response
   *  can resolve before React has re-rendered, so the ref still holds the PRE-override value and the
   *  stamp never matches. Same failure the ref itself was introduced to fix, one layer along. */
  const signatureWith = (o?: { allowUnknownColumns?: boolean; allowInvalidCoordinates?: boolean }): string =>
    summarySignature({
      ...inputs,
      allowUnknownColumns: o?.allowUnknownColumns ?? inputs.allowUnknownColumns,
      allowInvalidCoordinates: o?.allowInvalidCoordinates ?? inputs.allowInvalidCoordinates,
    });

  /** The last check's result, kept for the controls on Mapping that only make sense once something
   *  has been found. Guarded by `worklistSignature`, the NARROWER of the two: choosing a policy or
   *  saving a mapping must not make the findings disappear from under the operator while they act
   *  on them. Changing the file, the register, the format or the column map does retire them,
   *  because those change what the file contains. */
  const liveFindings = worklistAt === worklistSignature(inputs) ? lastFindings : null;

  const stepGate = {
    hasFile: !!file,
    hasRegister: nationalSystem.trim() !== '',
    // Fix for the reachability regression the widened model shipped with: Source now stores the
    // file itself, before Mapping ever opens (see `handleUpload`'s `validate` option and Source's
    // own button below), and `runId` is set the instant that upload resolves. That is the real
    // signal that the file is sitting in blob storage, not merely picked in the browser.
    hasStoredFile: runId !== null,
    // ⛔ `summaryAt === currentSummarySignature` is what makes this "a summary that MATCHES THE
    // INPUTS", not merely "a summary exists". Change the file, the register, the map, a fixed
    // value, an override or a policy and this goes false, `furthestStep` returns 3 and `clampStep`
    // pulls the operator back to Mapping. That is the safety half of this slice: Review is either
    // current or absent, and never a number that is no longer true.
    //
    // ⛔ `runId !== null` STAYS in the OR. An upload sets it the instant it resolves while
    // `awaitingSummary` waits for the first poll; without it the operator who just uploaded sits on
    // Mapping watching nothing (see the comment above). It is inside the signature guard for the
    // same reason as the other two.
    hasReview: summaryAt !== null && summaryAt === currentSummarySignature
      && (awaitingSummary !== null || appliedSummary !== null || runId !== null),
    runActive: runInFlight,
  };
  // ⛔ KEYED ON THE SUMMARY, NOT ON THE REQUEST THAT ASKED FOR IT. An earlier draft stamped these
  // where the inline preview's response landed, which a run's summary never passes through: it
  // arrives when a poll answers, so the wizard reached Mapping with an empty policy panel and no
  // worklist.
  useEffect(() => {
    if (!awaitingSummary) return;
    setLastFindings(awaitingSummary);
    setWorklistAt(worklistSignature(inputs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingSummary]);

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
  // turns 4 the instant Mapping's own Upload sets `runId` AND `summaryAt` together. See `handleUpload`'s
  // own comment on that pair. That is BEFORE the first poll has said anything about `blockedReason`.
  // Mapping's click already parked the operator there, so this effect's ordinary branch carries them
  // to Review immediately, exactly as it does for every other run. Only once the first poll answers
  // does `columnMapRefused` turn true, by which point `requestedStep` already reads 4 (Review's own
  // number, see the fix below). A guard that only ever refused to ADVANCE would never see this, and
  // the operator would stay stranded on Review with no way to fix the very thing that put them
  // there. This branch un-does that specific move, and only that one: any OTHER step the operator
  // had already reached (never past Mapping) is untouched.
  //
  // ⛔ ROUND-3 FIX: retreats from ANY step, not only from Review. It was written for a door that no
  // longer exists — an inline Preview reachable from Source, whose response made `columnMapRefused`
  // true in the same render, with the sheet never having been past step 1 and a guard firing only
  // for `prev === 3` doing nothing at all. The generality is kept because the rule it encodes is
  // not about that door: a column-map refusal means the Mapping panel is the only place that can
  // help, regardless of
  // which step the operator was on when they triggered it.
  //
  // Fix for the reachability regression (Critical finding, code review): the sheet's OWN step
  // numbers move here too, to agree with `furthestStep`'s model (1 Source, 2 Data, 3 Mapping,
  // 4 Review). Before this fix the sheet still rendered Mapping at its own `step === 2` and Review
  // at its own `step === 3`, one slot behind the strip's real labels, so an operator who clicked
  // strip position 3 ("Mapping") landed on this sheet's Review content instead. Upload was never
  // shown. The retreat below now targets 3 (Mapping's real number), and the advance targets 4
  // (Review's real number).
  useEffect(() => {
    if (columnMapRefused) {
      setRequestedStep((prev) => (prev !== 3 ? 3 : prev));
      return;
    }
    if (furthest < 4) return;
    setRequestedStep((prev) => (prev < 4 ? 4 : prev));
  }, [furthest, columnMapRefused]);

  /** Task 5: a fresh install has NO register: migration 082's back-fill seeds only from
   *  `national_system` values a pre-existing `facility_registry` already carries. Import is then
   *  unreachable until one is created, and the only affordance was a dropdown item nothing pointed
   *  at. This makes the requirement the step's own content, and the remedy its own button. */
  const needsRegister = !sourcesLoading && !sourcesError && sources.length === 0;

  // F5 fix: a genuinely empty file used to leave the step's action disabled forever with nothing on
  // screen explaining why.
  //
  // ⛔ `file.size`, NOT THE READ. The old test was `csv === ''`, which could only become true once
  // `File.text()` had resolved — so between choosing a 0-byte file and that read landing there was a
  // window in which `uploadDisabled` let a doomed click through. `size` is known the instant the
  // file is chosen.
  const emptyFile = !!file && file.size === 0;
  /** ⛔ A CSV WHOSE FIRST LINE NAMES NOTHING. The route answers such a head with a 400 and the
   *  client's own fallback split filters it to nothing, so both paths land here. `parseFacilityCsv`
   *  refuses the file anyway, so this is refused on SOURCE rather than after a 626 KB upload and an
   *  empty Mapping step. Gated on `headersResolved` so it cannot flash before the read has run.
   *  Only an empty FIRST LINE reaches this: a data-only CSV still has one, whose values become the
   *  headers, and a 0-byte file is `emptyFile` above. */
  const noHeaderRow = format === 'csv' && !!file && !emptyFile && headerRowMissing;
  // `!csvHead` matters as its own gate, distinct from `!file`: reading the file's text back out is
  // asynchronous (File.text()), so there is a real window after picking a file where `file` is
  // already set but `csv` has not resolved yet. Without this, a click in that window would fall
  // through runPreview's own early return and silently do nothing — worse than a disabled button.
  // A2b: Upload deliberately does NOT wait on `csv` — the File is the request body, so there is
  // nothing to read first. `emptyFile` is still a gate: the upload route refuses a 0-byte body with a
  // 400, and a request that cannot succeed is never worth sending.
  const uploadDisabled = !file || !nationalSystem.trim() || uploading || emptyFile || noHeaderRow;
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
  // computed WITHOUT the override. It is the worker's `validateOptions` that guarantees it: the
  // validate runs with the UPLOAD's stored options — the register identity and, when the operator
  // declared one, `completeRelease`. Neither is an OVERRIDE, and `allowMalformedRows` is not even
  // in the upload's payload, because it is the CONFIRM step's and reaches the run only after this
  // decision has been made.
  // `blockedReason` therefore always reports the UN-OVERRIDDEN reason, so ticking the box releases
  // the block and un-ticking re-imposes it — pinned by "re-imposes the quarantine block when the
  // operator un-ticks the override". Nothing here re-derives the server's predicate from
  // `quarantined`/`duplicateColumns`; it reads the server's reason and suppresses exactly the one
  // that has an override. `'duplicate-columns'` has none, so it is taken verbatim and no checkbox
  // can clear it.
  const blockedFor = (r: FacilityImportResult | null): boolean => !!r && r.blocked
    && !(r.blockedReason === 'quarantined-rows' && allowMalformedRows);
  /** Is there anything an apply could write? Not the same question as "is it blocked".
   *
   *  ⛔ FINDING NOTHING IS NOT A REFUSAL. `blocked` reports one, so a file the parser recognised
   *  nothing in comes back unblocked, and without this the wizard offered Confirm on the very
   *  screen that had just said "no facility rows were found". Confirming writes nothing and says so
   *  honestly, so nothing is corrupted; the defect is offering an action for a file there is nothing
   *  to do with. The inline door made this promise through `canApply`'s own `parsed > 0`; the
   *  streamed door never did, and removing that door turned a masked gap into the only behaviour.
   *
   *  ⛔ `quarantined` IS THE EXCEPTION AND IT IS NOT OPTIONAL. A file whose every row is malformed
   *  parses 0 rows too, and `allowMalformedRows` is precisely the override that makes those rows
   *  writable — the apply re-reads them, so there IS something to write. Un-ticked, `blockedFor`
   *  withholds Confirm on its own; ticked, this must not withhold it. `parsed > 0` alone regressed
   *  that case, which the suite caught.
   *
   *  Not listed, deliberately: `invalid`. Its override rides the UPLOAD, not the confirm, so a run
   *  validated without it cannot gain rows at apply time. The remedy there is the re-check offered
   *  by `canReuploadForInvalidCoordinates`, and withholding Confirm is the correct answer. */
  const hasSomethingToWrite = (r: FacilityImportResult | null): boolean =>
    !!r && (r.parsed > 0 || r.quarantined.length > 0);
  const canConfirmRun = !!awaitingSummary && hasSomethingToWrite(awaitingSummary)
    && !blockedFor(awaitingSummary);
  const willWriteCount = awaitingSummary ? willWrite(awaitingSummary) : 0;
  /** Whole-branch review, FINDING 2: is `ColumnMapStep` actually on screen? Read by the panel's own
   *  render gate below AND by the empty-state note beside it, so the two can never drift apart —
   *  the note is exactly "step 3, and this is false" (renumbered along with Mapping's own step, per
   *  the reachability fix above). Before this fix only the panel had a gate: a JSONL release, an
   *  applied run, a run or a summary that is not a column-map refusal, and the brief window while
   *  `File.text()` resolves all left step 3 completely blank, with nothing on screen to say why. */
  //
  //  ⛔ NO LONGER GATED ON THE MAP HAVING BEEN REFUSED. It used to hide the moment a run existed
  //  unless `columnMapRefused`, so an operator who stepped back to Mapping found a step that
  //  explained itself and offered nothing: they could see the map had already been sent and could
  //  do nothing about it. Going back is only worth offering if something can change there, so the
  //  panel stays and step 3's action becomes a re-upload. The RUN's map is still immutable, which
  //  is what the confirm route's guarantees rest on: editing here mints a NEW run that supersedes
  //  this one, exactly as the refusal path already did.
  const columnMapPanelShown = step === 3 && format === 'csv' && columnMapHeaders.length > 0
    && !appliedSummary && !runInFlight;
  // While a run holds the register, the inputs it was uploaded with must not drift out from under
  // it — the run is for THAT file under THAT national system, and nothing here can retract it.
  const inputsDisabled = uploading || runActive;
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
      {/* ⛔ FULL WIDTH ON A PHONE. `SheetContent`'s own base caps at `max-w-[90vw]`, so a strip of
          the page behind shows down one side. On a desktop that strip is the tap target that
          dismisses the sheet. On a 412px phone it is a tenth of the screen taken from a wizard
          that needs every pixel, and the X in the header closes it anyway. */}
      <SheetContent className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-xl">
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
              {/* ⛔ SOURCE ONLY. It used to render on every step, so an operator standing on Data,
                  looking at 3788 rows of a file they had already uploaded, was offered "Register a
                  source". Reported as confusing, and it is: registering one there cannot help,
                  because the register this run belongs to was fixed the moment the file was stored.
                  Reachable exactly where it is the answer, which is Source. */}
              {step === 1 && (
                <>
                  <DropdownMenuItem disabled={inputsDisabled} onClick={() => setRegisterSourceOpen(true)}>
                    {t('facilities.import.registerSourceAction')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
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
                  error over a file the operator just picked. `SUPERSEDABLE_RUN_STATES` has FIVE
                  members: `queued`, `stored`, `awaiting_confirmation`, `confirmed` and `previewed`.
                  A run this sheet's Upload minted can only ever be one of the first four; `previewed`
                  is written by `startPreview` alone, i.e. the INLINE preview route's own state (same
                  reason `RUN_ACTIVE_STATUSES` above omits it). The fifth is named here anyway,
                  because an enumeration that silently drops a member of the constant it cites is how
                  a later reader learns the wrong set. That is not hypothetical: `stored` was added
                  to the constant by this task and this comment still said FOUR. */}
              {/* ⛔ NO UPLOAD ITEM HERE. It was gated on `!runId && step === 4`, which is dead: step
                  4 is Review, Review requires `stepGate.hasReview`, and `hasReview` requires
                  `runId !== null` (see its own note). `!runId` and `step === 4` can never both hold,
                  so the item could not render. What it was for is covered by the three re-upload
                  items below, each offered where it can actually change something. */}
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
                  onClick={() => void handleRevalidate({ allowUnknownColumns: true })}
                >
                  {uploading ? uploadLabel : t('facilities.import.reuploadUnknownColumnsAction')}
                </DropdownMenuItem>
              )}
              {canReuploadForInvalidCoordinates && (
                <DropdownMenuItem
                  disabled={uploadDisabled || confirming || cancelling}
                  onClick={() => void handleRevalidate({ allowInvalidCoordinates: true })}
                >
                  {uploading ? uploadLabel : t('facilities.import.reuploadInvalidCoordinatesAction')}
                </DropdownMenuItem>
              )}
              {canReuploadForColumnMap && (
                <DropdownMenuItem
                  disabled={uploadDisabled || confirming || cancelling}
                  onClick={() => void handleRevalidate()}
                >
                  {uploading ? uploadLabel : t('facilities.import.reuploadColumnMapAction')}
                </DropdownMenuItem>
              )}
              {/* Offered only while the run is still live: the cancel route 409s on a terminal run,
                  and an affordance that can only fail is worse than none. `storedRunCancellable` is
                  the OTHER live case, and the one `runActive` structurally cannot see: see its own
                  docblock. */}
              {(runActive || storedRunCancellable) && (
                <DropdownMenuItem disabled={cancelling || confirming} onClick={() => void handleCancelRun()}>
                  {cancelling ? t('facilities.import.cancellingAction') : t('facilities.import.cancelRunAction')}
                </DropdownMenuItem>
              )}
              {/* ⛔ ALWAYS "Close", NEVER "Cancel". This item shuts the sheet and does nothing else:
                  a stored or running import survives it untouched. It used to read "Cancel" until
                  a run reached a terminal state, which put a bare "Cancel" directly under "Cancel
                  this import" — two items a word apart, one of which kills the run on the server
                  and one of which does not. The operator could not tell them apart, and the words
                  were the only thing that could have told them. */}
              <DropdownMenuItem disabled={uploading} onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        {/* ⛔ `flex flex-col`, ON TOP OF the scrolling column it already was, not INSTEAD of it.
            Source, Mapping and Review stay ordinary stacked content that scrolls with the body
            (`overflow-y-auto` still does that job for them). Data is the one child that has to
            FILL the remaining height rather than take its own content height, and `flex-1` on a
            child only ever means something when its PARENT is a flex container: a plain block
            parent left the grid sized to its own content, splitting the pane in half above an
            empty band (AGENTS.md §6's `wrapperClassName="min-h-0 flex-1"` trap, one level up). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {error ? (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {/* Task 6: Data (step 2), the file Source just stored, read back a page at a time.
              `DataGridStep` fetches its own rows; this sheet never holds them. Guarded on `runId`
              even though `stepGate.hasStoredFile` already requires it to reach step 2 at all,
              because the type is `string | null` and the component's own prop is not. */}
          {step === 2 && runId && (
            <div className="flex min-h-0 flex-1 flex-col">
              <DataGridStep runId={runId} />
            </div>
          )}

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
          /* ⛔ STACKED ON A PHONE, label-left/input-right from `sm` up. MEASURED at 375x812: the
             `auto` label track was sized by "This file is a complete release" to 185px, leaving the
             control column 147px in a 337px pane, so the two tracks plus the gap came to 349px and
             the full-width File row spanning them overflowed the pane. AGENTS.md §5 sets the desktop
             layout; §6 item 4 (it has to work on a phone) is why stacking wins at this width. Same
             treatment, same reason, as `ImportPolicyPanel`. */
          <div className="grid grid-cols-1 gap-y-1 px-6 py-4 sm:grid-cols-[minmax(0,auto)_1fr] sm:items-center sm:gap-x-4 sm:gap-y-3">
            {/* ⛔ THE ONE ROW THAT BREAKS THE GRID, deliberately. AGENTS.md §5 puts the label left
                and the input right, and every other control on this step does. A drop target wants
                to be big: half a row is a small thing to hit, most of all on a phone. So this spans
                both columns with the label above, which is also how the sibling drop zone in
                `pages/Terminology.tsx` renders. Operator decision, 2026-09-07.
                ⛔ The native `<input type=file>` it replaces was an §5 violation in its own right
                ("never a native `<input>`") and, styled only through the `file:` pseudo-element, had
                no border or background of its own: on the dark theme it read as bare text. */}
            <div className="space-y-1.5 sm:col-span-2">
              {/* ⛔ sr-only, NOT deleted. The operator asked for the visible "File" label to go:
                  a dashed target that says "Drag a .csv or .jsonl here" does not need naming twice.
                  But the real `<input>` below is `sr-only` and takes its accessible name from this
                  Label, so deleting the element outright would leave a screen reader announcing an
                  unnamed file input. Hidden, not removed. */}
              <Label htmlFor="facility-import-file" className="sr-only">{t('facilities.import.fileLabel')}</Label>
              <div
                role="button"
                tabIndex={inputsDisabled ? -1 : 0}
                aria-disabled={inputsDisabled || undefined}
                onClick={() => { if (!inputsDisabled) fileInputRef.current?.click(); }}
                onKeyDown={(e) => {
                  if (inputsDisabled) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
                }}
                // `onDragOver` must preventDefault or the browser navigates to the dropped file.
                onDragOver={(e) => { if (!inputsDisabled) { e.preventDefault(); setDragOver(true); } }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6',
                  'text-center text-xs transition-colors',
                  inputsDisabled
                    ? 'cursor-not-allowed border-border opacity-50'
                    : 'cursor-pointer hover:border-muted-foreground/60',
                  // The visible cue the operator asked for. `transition-colors` above is what makes
                  // it read as a state change rather than a repaint.
                  dragOver && !inputsDisabled && 'border-primary bg-primary/5',
                )}
              >
                <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
                {file ? (
                  <span className="text-foreground">
                    {t('facilities.import.fileChosen', { name: file.name, size: humanFileSize(file.size) })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t(dragOver ? 'facilities.import.fileDropActive' : 'facilities.import.fileDropHint')}
                  </span>
                )}
                {/* The real input stays: it is what opens the picker, what carries `accept` for the
                    browse path, and what a screen reader announces. `sr-only`, never `hidden`, so it
                    keeps its accessible name from the Label above. */}
                <input
                  ref={fileInputRef}
                  id="facility-import-file"
                  type="file"
                  accept=".csv,text/csv,.jsonl,application/x-ndjson"
                  disabled={inputsDisabled}
                  onChange={handleFileChange}
                  className="sr-only"
                  tabIndex={-1}
                />
              </div>
              {wrongType && (
                <p className="text-xs text-destructive">
                  {t('facilities.import.fileWrongType', { ext: wrongType })}
                </p>
              )}
              {emptyFile && (
                <p className="text-xs text-destructive">{t('facilities.import.emptyFileHint')}</p>
              )}
              {noHeaderRow && (
                <p className="text-xs text-destructive">{t('facilities.import.noHeaderRowHint')}</p>
              )}
            </div>

            {/* Separates the drop target from the fields that describe it. `-mx-6` because this
                container pads `px-6` and `Divider` defaults to the `-mx-4` of a standard page. */}
            <Divider className="-mx-6 my-2 sm:col-span-2" />

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
                {/* ⛔ `w-full`. A `<button>` sizes to its CONTENT, so this Select was narrower
                    than every other control on the step. "File format" only looks right
                    because it is a DIRECT grid child and gets stretched by `justify-items`;
                    this one sits inside a wrapper `<div>` (it carries a hint underneath) and
                    so has to say it. `SelectTrigger` sets no width of its own. */}
                <SelectTrigger id="facility-import-national-system" className="w-full">
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
                ⛔ IT REACHES THE VALIDATE. Sent as the `completeRelease` query parameter, which
                the route stores in the run's `options` and the worker's validate spreads into
                `importFacilities`. The gap this comment used to record (a validate always reporting
                `absent: null`, so the summary told the operator to declare a complete release they
                had just declared) is closed — see the upload route's own `completeRelease`
                block. */}
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
              error box explaining that it had. Task 3: gated to Review (step 4, renumbered by the
              reachability fix above) with the rest of the run status blocks below. `hasReview`
              (and so `step === 4`) turns true the instant Mapping's own Upload sets `runId` and
              `summaryAt` together, so this shows exactly when it used to. */}
          {step === 4 && runId && !run && !error && (
            <p className="mx-6 mt-4 text-sm text-muted-foreground">{t('facilities.import.runLoading')}</p>
          )}
          {step === 4 && run && RUN_ACTIVE_STATUSES.includes(run.status) && (
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
          {step === 4 && cancelOutcome && run && !RUN_TERMINAL_STATUSES.includes(run.status) && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {cancelOutcome === 'requested'
                ? t('facilities.import.cancelRequestedNotice')
                : t('facilities.import.cancelledNotice')}
            </div>
          )}
          {step === 4 && run?.status === 'cancelled' && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {t('facilities.import.cancelledNotice')}
            </div>
          )}
          {/* A confirm is a 202, not a promise the apply runs: `confirmed` is supersedable, so a
              newer upload of the same register can take the run over and it ends here instead. The
              operator sees that only because the sheet kept polling — which is why this block
              exists at all rather than the run simply vanishing from the screen. */}
          {step === 4 && run?.status === 'failed' && (
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
              on screen (`!awaitingSummary`): the design's own flow maps columns exactly once, before
              the file ever leaves this tab, and the operator cannot edit it again afterwards — see
              `columnMap`'s own reset-on-file-swap comment for why it must not persist past that. */}
          {columnMapPanelShown && (
            <div className="mx-6 mt-4">
              <ColumnMapStep
                headers={columnMapHeaders}
                suggestions={columnMapSuggestions}
                value={columnMap}
                runId={runId}
                // ⛔ STILL A DIRECT, SYNCHRONOUS ROUND-TRIP — see `columnMap`'s own state comment
                // above. The only addition is counting OPERATOR edits, which is what the summary's
                // lifetime keys on; the write to `columnMap` itself is unconditional as before.
                onChange={(next, origin) => {
                  setColumnMap(next);
                  if (origin === 'edit') setColumnMapEdits((n) => n + 1);
                }}
                onValidityChange={setColumnMapValid}
                // Task 6: what `ValueMapPanel` used to read directly, handed down instead so its
                // per-value pick-lists render under the row that maps each field rather than in
                // their own separate block below. `liveFindings` is already the last check's result
                // guarded by `worklistSignature`. See `ImportPolicyPanel`'s own `findings` prop,
                // fed the exact same value for the exact same reason.
                checkState={checkState}
                unmappedByField={liveFindings?.unmapped}
                nationalSystem={nationalSystem.trim()}
                // Task 6 (Slice B): the friendly name for `AddFacilityTypeDialog`'s own
                // description. This sheet is the one place that knows it, from the SAME
                // `sources` rows the national-system `Select` above renders. Undefined when the
                // chosen value matches no known source; `ColumnMapStep` falls back to the URI.
                registerName={sources.find((s) => s.url === nationalSystem.trim())?.name}
                onValueMappingsSaved={handleValueMappingsSaved}
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
                  Review (step 4, renumbered by the reachability fix above). A column-map
                  refusal no longer reaches Review at all (see the auto-advance effect's
                  `columnMapRefused` guard), so without this the operator
                  would see the panel with no reason given for why it is still here. Same
                  component, same i18n keys as the Review-side copy; nothing here is reworded. */}
              {columnMapRefused && awaitingSummary && (
                <div className="mt-3">
                  <ColumnMapErrorsNotice result={awaitingSummary} />
                </div>
              )}
            </div>
          )}

          {/* Whole-branch review, FINDING 2: step 3 (Mapping, renumbered by the reachability fix
              above) with nothing on it. `columnMapPanelShown` covers five distinct states with one
              gate: a JSONL release, an applied run, a run or a summary that is not a column-map
              refusal, and the brief window while `File.text()` is still resolving. Every one
              of them left this step a blank pane, most visibly for a first, ordinary JSONL upload:
              stepping forward to Mapping showed nothing at all. Two messages, not five: JSONL has
              no column map to set at all; every other case's map already went out with the upload
              and cannot be changed from here now. */}
          {/* ⛔ IT MAY ONLY SAY "already sent" WHEN A RUN EXISTS. This was one string standing in
              for five states, so a hidden column map always claimed the map had gone out with an
              upload. An operator read that on a file they had not uploaded, took it to mean mapping
              was closed to them, uploaded with no map, and had all 21 columns refused as
              unrecognised. `runId` is the only thing that makes that sentence true. */}
          {step === 3 && !columnMapPanelShown && (
            <p className="mx-6 mt-4 text-sm text-muted-foreground">
              {format === 'jsonl'
                ? t('facilities.import.columnMapNotApplicableJsonl')
                : runId
                  ? t('facilities.import.columnMapAlreadySent')
                  : t('facilities.import.columnMapUnavailable')}
            </p>
          )}

          {/* Task 2/3: the decisions live here now, not on Review. `findings` is the last check's
              result guarded by `worklistSignature`, which is what makes the three contextual
              overrides (and the absent/deleted policies) appear only once a check has actually
              reported the thing they answer. Before any check it renders the conflict policy alone,
              which is the one choice that can never be discovered from a summary. */}
          {step === 3 && !runFinished && (
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
                disabled={uploading || confirming || cancelling}
                showConflictChoice
                findings={liveFindings}
              />
            </div>
          )}

          {/* Task 6: the value-mapping worklist no longer renders here as its own block. Its
              pick-lists moved INTO `ColumnMapStep` above, one worklist per row, under the mapping
              it belongs to. See that component's own `unmappedByField` prop, fed `liveFindings`
              (the last check's findings guarded by `worklistSignature`) a few lines up. Review
              still reports the same values, read-only, from `ReconciliationSummary`. */}

          {step === 4 && awaitingSummary && !appliedSummary && (
            <ReconciliationSummary
              result={awaitingSummary}
              // A FACT about this result, not a control: what the upload recorded and the validate
              // actually ran with. `allowUnknownColumns` is the fallback for the window before the
              // first poll answers, and the invalidation is what makes it safe — change the checkbox
              // and `summarySignature` moves, so no summary is on screen to describe.
              unknownColumnsOverridden={reupload ? reupload.allowUnknownColumns : allowUnknownColumns}
              // Constant. The run IS the link between the summary and the apply that could discover
              // a conflict, and a summary on screen means a run exists.
              showConflictChoice
              reupload={reupload}
              onGoToMapping={() => setRequestedStep(3)}
            />
          )}

          {step === 4 && appliedSummary && (
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
          {/* Fix for the reachability regression: this button used to just move to the next step
              (`setRequestedStep(2)`). It now stores the file, which is what makes `hasStoredFile`
              (and so `furthestStep`) a real signal instead of the hardcoded `true` the widened
              model shipped with. `uploadDisabled` already covers every reason this could fail
              (no file, no register, an empty file, a missing header row, or an upload already in
              flight), so it replaces the old bare `hasFile`/`hasRegister` check. */}
          {step === 1 && (needsRegister ? (
            <Button size="sm" disabled={inputsDisabled} onClick={() => setRegisterSourceOpen(true)}>
              {t('facilities.import.registerSourceAction')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={uploadDisabled}
              onClick={() => void handleUpload({ validate: false })}
            >
              {uploading ? uploadLabel : t('facilities.import.continueAction')}
            </Button>
          ))}
          {/* Data's own way forward. Source, Mapping and Review each carried a footer button and
              Data carried none, so the bar rendered empty under the grid and the strip was the
              only way on. Nothing about Data earned that exception: it is a read-only view of a
              file that is already stored.
              ⛔ IT ONLY MOVES A STEP. Source's Continue already stored the file, and a second
              `uploadFacilityImport` either supersedes the run this sheet is watching or 409s (see
              the dropdown's own Upload gate). This shares Source's label because it is the same
              promise to the operator, and deliberately not its handler. */}
          {step === 2 && (
            <Button size="sm" onClick={() => setRequestedStep(3)}>
              {t('facilities.import.continueAction')}
            </Button>
          )}
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
          {/* Task 6: two shapes now, not three. There is no "no run yet" case any more: Mapping is
              only ever reachable once Source has already stored the file, so `runId` is always set
              here and the old `!runId` branch (the plain "Upload and validate" label) was dead.
              A refused map: the re-upload the refusal names, unchanged. Everything else: "Validate
              all", the operator's ordinary check of the file already sitting on the server, first
              time or the fifth.
              ⛔ `handleRevalidate`, NOT `handleUpload`, and that is Task 6's own fix for the double
              upload this button used to cause on every click. It checks the run ALREADY on the
              server again rather than sending the file a second time, from either status
              `revalidateImportRun` (packages/bootstrap/src/facility-revalidate.ts) accepts:
              `stored`, Mapping's run on its FIRST click (Source's own store-only upload never
              validates it), and `awaiting_confirmation`, an operator stepping back to Mapping to
              fix something after a first validate already ran. `handleRevalidate` falls back to
              `handleUpload` only for a status neither of those (a run that moved on while this
              sheet was open), where sending the file again is the only thing left that can work. */}
          {step === 3 && (
            <Button
              size="sm"
              disabled={uploadDisabled || confirming || cancelling}
              onClick={() => void handleRevalidate()}
            >
              {uploading ? uploadLabel : t(
                columnMapRefused ? 'facilities.import.reuploadColumnMapAction'
                  : 'facilities.import.validateAllAction',
              )}
            </Button>
          )}
          {step === 4 && canConfirmRun && (
            <Button size="sm" disabled={confirming || cancelling} onClick={() => void handleConfirmRun()}>
              {confirming ? t('facilities.import.confirming') : t('facilities.import.confirmAction')}
            </Button>
          )}
        </div>

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
