import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  uploadFacilityImport,
  type ControlledField,
  type FacilityImportConfirmOptions,
  type FacilityImportResult,
  type FacilityImportRunStatus,
  type FacilityImportRunView,
} from '@/api';

// CT-3 (whole-branch review): `FacilityImportResult.unmapped`/`notValidated` are keyed by this
// fixed triple — mirrors `@openldr/bootstrap`'s `CONTROLLED_FIELDS`, not imported from it (this app
// has no dependency on that package, same "mirrored, not shared" reasoning as the rest of api.ts's
// FacilityImportResult). Each field already has a translated label under `facilities.filters.*Label`
// (the Facilities page's own filter row) — reused here rather than adding a second, driftable set of
// field-name translations.
const CONTROLLED_FIELDS: ControlledField[] = ['level', 'status', 'country'];

/** A diff cell's `before`/`after` value, formatted for display. `null`/`undefined` (the field was
 *  never set) reads as an em-dash rather than the literal string "null"/"undefined". */
const fmtDiffValue = (v: unknown): string => (v === null || v === undefined ? '—' : String(v));

// A2a (FAC-P1-03) superseded the original F3 fix. `parsed - duplicates` only ever accounted for
// rows the FILE itself repeated — every other accepted row still read as something an import would
// write, even a row byte-identical to what the registry already holds (`unchanged`) or one that
// will be skipped because it was edited since the preview (`conflict`). `create + changed` is the
// server's own reconciliation of what an apply would actually write (`classifyFacilityRows`,
// computed on every preview — see facility-import.ts's docblock), not a client-side approximation
// of it. `duplicates` itself keeps reading off `parsed` unchanged elsewhere (the over-cap check
// mirrors the server's own cap, which is checked against `parsed`, not this).
const willWrite = (r: FacilityImportResult): number => r.create + r.changed;

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
 *  ⛔ THE CONDITIONS BELOW MIRROR `ReconciliationSummary`'s OWN RENDER GATES, term for term:
 *  `result.parsed > 0` wraps the entire block that holds these controls, then `deleted > 0`,
 *  `absent !== null && absent > 0`, and `unknownColumns`/`quarantined`/`invalid` being non-empty for
 *  the three override checkboxes. The two have to move together — a key sent for a control that
 *  never rendered is a decision nobody made, and a control that rendered whose value is not sent is
 *  a decision quietly dropped.
 *
 *  `onConflict` carries no count gate because its own control has none: a conflict can only be
 *  discovered by the apply this confirm authorises, so the choice is always made in advance (see
 *  `showConflictChoice`). It is sent whenever the summary block itself rendered. */
function confirmOptionsFor(
  result: FacilityImportResult, chosen: Required<FacilityImportConfirmOptions>,
): FacilityImportConfirmOptions {
  if (result.parsed === 0) return {};
  return {
    ...(result.deleted > 0 ? { onDeleted: chosen.onDeleted } : {}),
    ...(result.absent !== null && result.absent > 0 ? { onAbsent: chosen.onAbsent } : {}),
    onConflict: chosen.onConflict,
    ...(result.unknownColumns.length > 0 ? { allowUnknownColumns: chosen.allowUnknownColumns } : {}),
    ...(result.quarantined.length > 0 ? { allowMalformedRows: chosen.allowMalformedRows } : {}),
    ...(result.invalid.length > 0 ? { allowInvalidCoordinates: chosen.allowInvalidCoordinates } : {}),
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

interface ReconciliationSummaryProps {
  result: FacilityImportResult;
  allowUnknownColumns: boolean;
  allowMalformedRows: boolean;
  allowInvalidCoordinates: boolean;
  onAllowUnknownColumnsChange: (checked: boolean) => void;
  onAllowMalformedRowsChange: (checked: boolean) => void;
  onAllowInvalidCoordinatesChange: (checked: boolean) => void;
  /** A request is in flight for this result; the override checkboxes must not be re-clicked. */
  togglesDisabled: boolean;
  onDeleted: 'retire' | 'report';
  onDeletedChange: (value: 'retire' | 'report') => void;
  onAbsent: 'retire' | 'report';
  onAbsentChange: (value: 'retire' | 'report') => void;
  onConflict: 'skip' | 'overwrite';
  onConflictChange: (value: 'skip' | 'overwrite') => void;
  /** Whether an apply this operator can still influence exists to set a conflict policy FOR — see
   *  the call sites for what answers it on each path. */
  showConflictChoice: boolean;
  /** The INLINE route's 2 000-row cap notice. Always `false` for a background run — see
   *  `APPLY_ROW_CAP`. */
  overCap: boolean;
}

/** A2a's reconciliation summary — what a file would actually DO to the registry, as the server
 *  classified it (`classifyFacilityRows`, computed on every preview and on every background
 *  validate, never just on apply).
 *
 *  ⛔ EXTRACTED, NOT REWRITTEN. A2b Task 8 gave this sheet a second door (upload → worker validate →
 *  confirm) whose review screen is the SAME summary over the SAME `FacilityImportResult`; the only
 *  thing that changes is where the result came from and what the override checkboxes do next. The
 *  JSX below is A2a's, moved verbatim out of the sheet body and parameterised on those differences —
 *  a second copy would be free to drift on the one property this whole slice exists to protect:
 *  `conflict`/`absent` of `null` render as NOT EVALUATED and never as `0`. */
function ReconciliationSummary(props: ReconciliationSummaryProps) {
  const { t } = useTranslation();
  const { result } = props;

  const willWriteCount = willWrite(result);
  // F2 fix: `parsed === 0` must read as an unsuccessful outcome whether or not unknown columns were
  // ever involved — EXCEPT while the file is still just sitting blocked on an unopted-in unknown-
  // columns notice (unknownColumns present, box not yet ticked): that case already has its own
  // explanation (the amber box below) and doesn't need a second, more confusing "no rows found"
  // message layered on top. Once the operator HAS ticked the box (`allowUnknownColumns`) and the
  // file still parses to nothing, that's the "wrong file entirely" trap surviving one click deeper
  // — it must say so, same as the plain no-unknown-columns case does.
  // Task 5: same reasoning as the unknownColumns exception above — a file that quarantined every
  // row already has its own explanation (the quarantine block below) and must not also show the
  // generic "no rows found" message.
  // CT-3: same reasoning again for `invalid` — a file whose every row failed coordinate validation
  // (without the override) already has its own explanation (the invalid-coordinates block below).
  const noOutcomeStated = result.parsed === 0
    && (result.unknownColumns.length === 0 || props.allowUnknownColumns)
    && result.quarantined.length === 0
    && result.invalid.length === 0;

  return (
    <div className="mx-6 mt-4 space-y-3 text-sm">
      {/* A2a: informational only — never blocks Apply. A `nationalSystem` no existing row
          uses yet is routinely just the FIRST import of a real register, not a mistake; the
          server (facilities-routes.ts) cannot tell the two apart, so this only names the
          possibility rather than refusing anything. */}
      {!result.knownNationalSystem && (
        <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700">
          {t('facilities.import.newRegisterNotice')}
        </div>
      )}

      {/* CT-3: a JSONL release's own declared counts (`meta.rowCount`/`deletionCount`)
          disagreeing with what actually parsed — "the release declares 13 000 rows, we
          parsed 12 998" (see facility-import.ts's `FacilityImportResult.countMismatch`).
          Reported, never blocking — always `[]` for CSV, which has no release header. */}
      {result.countMismatch.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">{t('facilities.import.countMismatchTitle')}</p>
          {result.countMismatch.map((m) => (
            <p key={m.field}>
              {t(
                m.field === 'rowCount'
                  ? 'facilities.import.countMismatchRowCount'
                  : 'facilities.import.countMismatchDeletionCount',
                { declared: m.declared, parsed: m.parsed },
              )}
            </p>
          ))}
        </div>
      )}

      {noOutcomeStated && (
        <p className="text-muted-foreground">
          {result.skipped > 0
            ? t('facilities.import.noRowsFoundSkipped', { skipped: result.skipped })
            : t('facilities.import.noRowsFound')}
        </p>
      )}

      {result.unknownColumns.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">{t('facilities.import.unknownColumnsTitle')}</p>
          <p>{t('facilities.import.unknownColumnsBody', { columns: result.unknownColumns.join(', ') })}</p>
          <label className="mt-2 flex items-center gap-2">
            <Checkbox
              checked={props.allowUnknownColumns}
              disabled={props.togglesDisabled}
              onCheckedChange={(c) => props.onAllowUnknownColumnsChange(c === true)}
            />
            <span>{t('facilities.import.allowUnknownColumns')}</span>
          </label>
        </div>
      )}

      {result.quarantined.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">{t('facilities.import.quarantinedTitle')}</p>
          <p>{t('facilities.import.quarantinedCount', { count: result.quarantined.length })}</p>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
            {result.quarantined.map((row) => (
              <li key={row.line}>{t('facilities.import.quarantinedLine', { line: row.line, raw: row.raw })}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <Checkbox
              checked={props.allowMalformedRows}
              disabled={props.togglesDisabled}
              onCheckedChange={(c) => props.onAllowMalformedRowsChange(c === true)}
            />
            <span>{t('facilities.import.allowMalformedRows')}</span>
          </label>
        </div>
      )}

      {/* CT-3: `invalid` (facility-import.ts's per-FIELD coordinate errors) — a row here was
          otherwise well-formed but had its latitude/longitude rejected, and is DROPPED from
          `records` entirely (never counted in `create`/`changed`/`unchanged`, unlike
          `quarantined` above) unless `allowInvalidCoordinates` is set. Same idiom as
          `allowUnknownColumns`/`allowMalformedRows`, but on the INLINE path toggling it DOES
          re-preview — see `toggleAllowInvalidCoordinates`. */}
      {result.invalid.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">{t('facilities.import.invalidTitle')}</p>
          <p>{t('facilities.import.invalidCount', { count: result.invalid.length })}</p>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
            {result.invalid.map((row, i) => (
              <li key={`${row.line}-${row.field}-${i}`}>
                {t('facilities.import.invalidLine', { line: row.line, field: row.field, raw: row.raw })}
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <Checkbox
              checked={props.allowInvalidCoordinates}
              disabled={props.togglesDisabled}
              onCheckedChange={(c) => props.onAllowInvalidCoordinatesChange(c === true)}
            />
            <span>{t('facilities.import.allowInvalidCoordinates')}</span>
          </label>
        </div>
      )}

      {result.parsed > 0 && (
        <>
          <p>{t('facilities.import.previewSummary', { parsed: willWriteCount, skipped: result.skipped })}</p>

          {/* A2a (FAC-P1-03/05): the reconciliation summary — what this file would actually
              DO to the registry, computed by the server on every preview, never just on
              apply (see FacilityImportResult's own docblock in api.ts). `conflict`/`absent`
              render "not evaluated" on `null` and NEVER as `0` — a `0` here would claim a
              measurement the server never took (no `runId` linking this call to a prior
              preview / no declared complete release). */}
          <div className="rounded-md border border-border px-3 py-2 text-xs space-y-1">
            <p>{t('facilities.import.summaryCreate', { count: result.create })}</p>
            <p>{t('facilities.import.summaryChanged', { count: result.changed })}</p>
            <p>{t('facilities.import.summaryUnchanged', { count: result.unchanged })}</p>
            <p>
              {result.conflict === null
                ? t('facilities.import.conflictNotEvaluated')
                : t('facilities.import.summaryConflict', { count: result.conflict })}
            </p>
            <p>
              {result.absent === null
                ? t('facilities.import.absentNotEvaluated')
                : t('facilities.import.summaryAbsent', { count: result.absent })}
            </p>
            {result.deleted > 0 && (
              <p>{t('facilities.import.summaryDeleted', { count: result.deleted })}</p>
            )}
          </div>

          {result.samples.changed.length > 0 && (
            <div className="rounded-md border border-border px-3 py-2 text-xs">
              <p className="font-medium">{t('facilities.import.changedSampleTitle')}</p>
              <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                {result.samples.changed.map((row) => (
                  <li key={row.id}>
                    <span className="font-medium">{row.name}</span>
                    <ul className="ml-3">
                      {row.diff.map((d) => (
                        <li key={d.field}>
                          {t('facilities.import.changedFieldDiff', {
                            field: d.field, before: fmtDiffValue(d.before), after: fmtDiffValue(d.after),
                          })}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CT-3: the controlled-field layer (FAC-P1-05) — a raw source value for
              level/status/country that resolved to no canonical `term_mappings` code. A
              WARNING, never a block: the raw value is still written exactly as before this
              layer existed (see facility-import.ts's `unmapped` doc comment). */}
          {CONTROLLED_FIELDS.some((f) => result.unmapped[f].length > 0) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <p className="font-medium">{t('facilities.import.unmappedTitle')}</p>
              {CONTROLLED_FIELDS.filter((f) => result.unmapped[f].length > 0).map((field) => (
                <p key={field}>
                  {t('facilities.import.unmappedMessage', {
                    count: result.unmapped[field].length,
                    field: t(`facilities.filters.${field}Label`),
                    values: result.unmapped[field].join(', '),
                  })}
                </p>
              ))}
            </div>
          )}
          {/* Informational, not a warning box: these fields simply have no seeded value set
              to check against on this install, so mapped/unmapped could not be determined. */}
          {result.notValidated.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('facilities.import.notValidatedMessage', {
                fields: result.notValidated.map((f) => t(`facilities.filters.${f}Label`)).join(', '),
              })}
            </p>
          )}

          {/* A2a: the retirement choices are INPUTS (label-left/input-right, exempt from the
              ⋯-menu rule — see ui-actions-in-dots-menu), not actions. Shown only when there
              is something meaningful to decide: a `deleted`/`absent` of `0` (or `absent`
              still `null`, not evaluated) has nothing to retire, so a control here would
              offer a choice with no effect. */}
          {result.deleted > 0 && (
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
              <Label htmlFor="facility-import-on-deleted" className="whitespace-nowrap">
                {t('facilities.import.onDeletedLabel')}
              </Label>
              <Select value={props.onDeleted} onValueChange={(v) => props.onDeletedChange(v as 'retire' | 'report')}>
                <SelectTrigger id="facility-import-on-deleted" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retire">{t('facilities.import.onDeletedRetire')}</SelectItem>
                  <SelectItem value="report">{t('facilities.import.onDeletedReport')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {result.absent !== null && result.absent > 0 && (
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
              <Label htmlFor="facility-import-on-absent" className="whitespace-nowrap">
                {t('facilities.import.onAbsentLabel')}
              </Label>
              <Select value={props.onAbsent} onValueChange={(v) => props.onAbsentChange(v as 'retire' | 'report')}>
                <SelectTrigger id="facility-import-on-absent" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retire">{t('facilities.import.onAbsentRetire')}</SelectItem>
                  <SelectItem value="report">{t('facilities.import.onAbsentReport')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {/* CT-3: gated on `showConflictChoice`, NOT on `conflict` being a non-zero number —
              and deliberately so, on BOTH paths. A fresh preview's own `conflict` is ALWAYS
              `null`: `conflictsEvaluated` needs a `previewedAt` watermark from a PRIOR pass,
              which the call that just minted the run can never supply for itself
              (facility-import.ts's `previewedAt`/`conflictsEvaluated`) — and a background
              validate runs with `apply: false` and no watermark for exactly the same reason.
              A conflict can only ever be discovered by the APPLY this run will later authorise,
              so the operator must set their skip/overwrite preference NOW, before that apply
              runs, not after a count that will never arrive on this screen. */}
          {props.showConflictChoice && (
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
              <Label htmlFor="facility-import-on-conflict" className="whitespace-nowrap">
                {t('facilities.import.onConflictLabel')}
              </Label>
              <Select value={props.onConflict} onValueChange={(v) => props.onConflictChange(v as 'skip' | 'overwrite')}>
                <SelectTrigger id="facility-import-on-conflict" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">{t('facilities.import.onConflictSkip')}</SelectItem>
                  <SelectItem value="overwrite">{t('facilities.import.onConflictOverwrite')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {result.duplicates > 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {t('facilities.import.duplicatesWarning', { count: result.duplicates })}
            </p>
          )}
          {props.overCap && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <p className="font-medium">{t('facilities.import.tooLargeTitle')}</p>
              <p>{t('facilities.import.tooLargeBody', { count: result.parsed })}</p>
              {/* A2b: the row cap is the INLINE route's alone. The register that is too large to
                  apply through this request is exactly the one the background path exists for. */}
              <p>{t('facilities.import.tooLargeUseUpload')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ImportFacilitiesSheet({ open, onOpenChange, onImported }: ImportFacilitiesSheetProps) {
  const { t } = useTranslation();

  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [nationalSystem, setNationalSystem] = useState('');
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
        apply: false,
      });
      setPreviewResult(result);
    } catch (err) {
      setPreviewResult(null);
      const message = err instanceof Error ? err.message : String(err);
      setError(friendlyImportErrorMessage(message));
    } finally {
      setPreviewing(false);
    }
  };

  const toggleAllowUnknownColumns = (checked: boolean) => {
    setAllowUnknownColumns(checked);
    void runPreview({ allowUnknownColumns: checked });
  };

  // Deliberately does NOT re-run the preview — see `allowMalformedRows`'s doc comment above: the
  // set of quarantined rows is a property of the file, not of this flag, so there is nothing new
  // for a second preview request to discover. Toggling it only changes whether Apply is allowed
  // to proceed.
  const toggleAllowMalformedRows = (checked: boolean) => {
    setAllowMalformedRows(checked);
  };

  // CT-3: DOES re-run the preview, same reasoning as `toggleAllowUnknownColumns` above and unlike
  // `toggleAllowMalformedRows` — a row with an invalid coordinate is excluded from `records`
  // entirely without this override, so ticking it changes `create`/`changed`/`unchanged`, not just
  // whether Apply may proceed.
  const toggleAllowInvalidCoordinates = (checked: boolean) => {
    setAllowInvalidCoordinates(checked);
    void runPreview({ allowInvalidCoordinates: checked });
  };

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

  const handleUpload = async (): Promise<void> => {
    if (!file || !nationalSystem.trim()) return;
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
        },
        setUploadProgress,
      );
      // An inline preview on screen described the same file through the other door; the run's own
      // validate is about to describe it again, and two summaries at once would be one too many.
      setPreviewResult(null);
      setApplyResult(null);
      setCancelOutcome(null);
      setRunId(id);
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
      await confirmFacilityImportRun(runId, confirmOptionsFor(awaitingSummary, {
        onDeleted, onAbsent, onConflict,
        allowUnknownColumns, allowMalformedRows, allowInvalidCoordinates,
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
  /** What actually got written, whichever door did it. */
  const appliedSummary: FacilityImportResult | null =
    applyResult ?? (run && run.status === 'applied' ? run.summary : null);

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

        <div className="flex items-center justify-end px-6 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('facilities.import.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* A2b: the background door. Offered only while no run is in play, and gated on
                  `runId` rather than `run` deliberately: `runId` is set the instant the upload
                  resolves, whereas `run` stays null until the FIRST POLL answers — a window in which
                  the item would still be on the menu and a second upload still clickable. (`run` can
                  never be set without `runId`: only the poll writes it, and only picking a new file
                  clears either, so this is strictly the wider guard, not a different one.)
                  What a second upload would actually do depends on the run's state, and neither
                  outcome is one this sheet can show: the upload route's register gate SUPERSEDES a
                  run sitting in `queued`/`awaiting_confirmation`/`confirmed`
                  (`SUPERSEDABLE_RUN_STATES`, packages/db) — leaving the sheet watching a run it no
                  longer owns — and answers 409 for one a worker is holding (`validating`/`applying`,
                  `RUNNING_RUN_STATES`), which would surface as a bare error over a file the operator
                  just picked. */}
              {!applyResult && !runId && (
                <DropdownMenuItem disabled={uploadDisabled} onClick={() => void handleUpload()}>
                  {uploading ? uploadLabel : t('facilities.import.uploadAction')}
                </DropdownMenuItem>
              )}
              {!applyResult && !run && (
                <DropdownMenuItem disabled={previewDisabled} onClick={() => void runPreview()}>
                  {previewing ? t('facilities.import.previewing') : t('facilities.import.previewAction')}
                </DropdownMenuItem>
              )}
              {!applyResult && !run && canApply && (
                <DropdownMenuItem disabled={applying} onClick={() => setConfirmOpen(true)}>
                  {applying ? t('facilities.import.applying') : t('facilities.import.applyAction')}
                </DropdownMenuItem>
              )}
              {canConfirmRun && (
                <DropdownMenuItem disabled={confirming || cancelling} onClick={() => void handleConfirmRun()}>
                  {confirming ? t('facilities.import.confirming') : t('facilities.import.confirmAction')}
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

            <Label htmlFor="facility-import-national-system" className="whitespace-nowrap">{t('facilities.import.nationalSystemLabel')}</Label>
            <div>
              <Input
                id="facility-import-national-system"
                value={nationalSystem}
                onChange={(e) => handleNationalSystemChange(e.target.value)}
                placeholder={t('facilities.import.nationalSystemPlaceholder')}
                disabled={inputsDisabled}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('facilities.import.nationalSystemHint')}</p>
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
              error box explaining that it had. */}
          {runId && !run && !error && (
            <p className="mx-6 mt-4 text-sm text-muted-foreground">{t('facilities.import.runLoading')}</p>
          )}
          {run && RUN_ACTIVE_STATUSES.includes(run.status) && (
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
          {cancelOutcome && run && !RUN_TERMINAL_STATUSES.includes(run.status) && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {cancelOutcome === 'requested'
                ? t('facilities.import.cancelRequestedNotice')
                : t('facilities.import.cancelledNotice')}
            </div>
          )}
          {run?.status === 'cancelled' && (
            <div className="mx-6 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {t('facilities.import.cancelledNotice')}
            </div>
          )}
          {/* A confirm is a 202, not a promise the apply runs: `confirmed` is supersedable, so a
              newer upload of the same register can take the run over and it ends here instead. The
              operator sees that only because the sheet kept polling — which is why this block
              exists at all rather than the run simply vanishing from the screen. */}
          {run?.status === 'failed' && (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">{t('facilities.import.runFailedTitle')}</p>
              {run.error && <p className="text-xs">{run.error}</p>}
            </div>
          )}

          {reviewResult && !appliedSummary && (
            <ReconciliationSummary
              result={reviewResult}
              allowUnknownColumns={allowUnknownColumns}
              allowMalformedRows={allowMalformedRows}
              allowInvalidCoordinates={allowInvalidCoordinates}
              // ⛔ On the INLINE path these two re-run the preview, because they change which rows
              // land in `records`. On the background path they cannot: the validate already ran, and
              // nothing short of a fresh upload re-runs it — so they are recorded and sent with the
              // confirm, which is the request that actually gates the apply.
              onAllowUnknownColumnsChange={fromRun ? setAllowUnknownColumns : toggleAllowUnknownColumns}
              onAllowInvalidCoordinatesChange={fromRun ? setAllowInvalidCoordinates : toggleAllowInvalidCoordinates}
              onAllowMalformedRowsChange={toggleAllowMalformedRows}
              togglesDisabled={previewing || confirming || cancelling}
              onDeleted={onDeleted}
              onDeletedChange={setOnDeleted}
              onAbsent={onAbsent}
              onAbsentChange={setOnAbsent}
              onConflict={onConflict}
              onConflictChange={setOnConflict}
              // Inline: only a preview that minted a run can be linked to an apply that could ever
              // discover a conflict. Background: the run IS the link, always.
              showConflictChoice={fromRun || !!previewResult?.runId}
              overCap={!fromRun && overCap}
            />
          )}

          {appliedSummary && (
            <div className="mx-6 mt-4 space-y-2 text-sm">
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-700">
                <p className="font-medium">{t('facilities.import.doneTitle')}</p>
                <p>{t('facilities.import.doneSummary', { created: appliedSummary.written.created, updated: appliedSummary.written.updated, skipped: appliedSummary.skipped })}</p>
                {appliedSummary.duplicates > 0 && (
                  <p>{t('facilities.import.duplicatesWarning', { count: appliedSummary.duplicates })}</p>
                )}
              </div>

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

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('facilities.import.applyConfirmTitle')}
          description={reviewResult ? t('facilities.import.applyConfirmBody', { count: willWriteCount }) : undefined}
          confirmLabel={t('facilities.import.applyAction')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { void handleApplyConfirm(); }}
        />
      </SheetContent>
    </Sheet>
  );
}

export default ImportFacilitiesSheet;
