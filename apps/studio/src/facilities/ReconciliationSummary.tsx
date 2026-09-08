import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreHorizontal } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ColumnMapError, FacilityImportResult } from '@/api';
import { CONTRACT_FIELDS } from './ColumnMapStep';
import { CONTROLLED_FIELDS } from './controlledFields';

/** One `ColumnMapError` (packages/terminology/src/facility-csv.ts, mirrored as `@/api`'s
 *  `ColumnMapError`), rendered for an operator to act on — whole-branch review, MUST FIX 3.
 *  `columnMapErrors` was mirrored in `api.ts` and rendered NOWHERE: an operator who mapped two
 *  headers to one field saw a blocked preview with no explanation of why. This mirrors
 *  `describeColumnMapError` (`packages/cli/src/facilities.ts`) reason for reason — the same four the
 *  CLI already prints — through i18n instead of a raw string, so the wording is translated rather
 *  than hardcoded English. One branch per `ColumnMapErrorReason`; a reason added there and not here
 *  is a `tsc` exhaustiveness error via the `default` branch, not a silently generic message. */
function describeColumnMapError(t: TFunction, e: ColumnMapError): string {
  switch (e.reason) {
    case 'duplicate_target':
      return t('facilities.import.columnMapErrorDuplicateTarget', { subject: e.subject, other: e.other, target: e.target });
    case 'constant_collision':
      return t('facilities.import.columnMapErrorConstantCollision', { target: e.target, other: e.other });
    case 'unknown_target':
      return t('facilities.import.columnMapErrorUnknownTarget', {
        subject: e.subject, target: e.target, count: CONTRACT_FIELDS.length,
      });
    case 'missing_required':
      return t('facilities.import.columnMapErrorMissingRequired', { target: e.target });
    default: {
      const _exhaustive: never = e.reason;
      return `${_exhaustive}: ${e.subject} -> ${e.target}`;
    }
  }
}

/** A diff cell's `before`/`after` value, formatted for display. `null`/`undefined` (the field was
 *  never set) reads as an em-dash rather than the literal string "null"/"undefined". */
const fmtDiffValue = (v: unknown): string => (v === null || v === undefined ? '—' : String(v));

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Which keys of an object-valued field actually differ.
 *
 *  ⛔ `extras` IS AN OBJECT, and `String(anObject)` is "[object Object]". Every changed row of a
 *  mapped import carried the line `extras: [object Object] -> [object Object]`, which is the one
 *  place the operator is told what an import would do to rows it is about to rewrite. On the real
 *  Zambia export that was 3515 rows all saying nothing. Naming the keys that moved is the whole
 *  point of the line.
 *
 *  A missing key and a key set to `undefined` are the same absence here, which is what
 *  `JSON.stringify` already gives us, so the comparison does not need to tell them apart. */
const changedObjectKeys = (before: unknown, after: unknown): string[] => {
  const a = isPlainObject(before) ? before : {};
  const b = isPlainObject(after) ? after : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
};

export /** The `columnMapErrors` block, extracted so it renders identically in the two places it now has
 *  to. Before the round-2 fix it lived only inside `ReconciliationSummary`, on Review (step 3) — but
 *  a column-map refusal now keeps the operator on Mapping (step 2), where that summary never
 *  mounts (see the auto-advance effect's `columnMapRefused` guard below). One component, same i18n
 *  keys, so the two render sites can never say something different about the same refusal. */
function ColumnMapErrorsNotice({ result }: { result: FacilityImportResult }) {
  const { t } = useTranslation();
  if (result.columnMapErrors.length === 0) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <p className="font-medium">{t('facilities.import.columnMapErrorsTitle')}</p>
      <ul className="mt-1 space-y-0.5">
        {result.columnMapErrors.map((e, i) => (
          <li key={`${e.reason}-${e.subject}-${i}`}>{describeColumnMapError(t, e)}</li>
        ))}
      </ul>
    </div>
  );
}

// A2a (FAC-P1-03) superseded the original F3 fix. `parsed - duplicates` only ever accounted for
// rows the FILE itself repeated — every other accepted row still read as something an import would
// write, even a row byte-identical to what the registry already holds (`unchanged`) or one that
// will be skipped because it was edited since the preview (`conflict`). `create + changed` is the
// server's own reconciliation of what an apply would actually write (`classifyFacilityRows`,
// computed on every preview — see facility-import.ts's docblock), not a client-side approximation
// of it. `duplicates` itself keeps reading off `parsed` unchanged elsewhere (the over-cap check
// mirrors the server's own cap, which is checked against `parsed`, not this).
export const willWrite = (r: FacilityImportResult): number => r.create + r.changed;

/** How the two PARSE-CHANGING overrides are presented on the door being rendered — `null` on the
 *  INLINE door, where they are live checkboxes that re-run the preview against the new parse.
 *
 *  ⛔ ON THE RUN DOOR THEY CANNOT BE CHECKBOXES. The validate has already run; nothing short of a
 *  fresh upload re-runs it, and the confirm route refuses a parse-changing override whenever the
 *  stored summary shows the file contains the thing it waves through — which is the same condition
 *  that makes the amber box render. A tick there could therefore only ever 409. The box offers a
 *  RE-UPLOAD instead (an ⋯ menu item, per ui-actions-in-dots-menu), which re-streams the same file
 *  with the override on the upload request, so the validation the operator reviews is the one that
 *  gets applied. */
export interface ReuploadOverrides {
  /** The RUN's format, not the picker's. ⛔ `allowUnknownColumns` is a documented NO-OP for JSONL —
   *  `parseFacilityRelease` never reads it (packages/terminology/src/facility-release.ts) because a
   *  self-describing line cannot shift another field the way an unrecognised CSV header can — so a
   *  JSONL release is told its extra fields were kept, and offered no re-upload that would change
   *  nothing. The confirm route skips its own refusal on the same asymmetry. */
  sourceFormat: 'csv' | 'jsonl';
  /** Read off the RUN's stored `options`, never off this sheet's state: it is what the validate
   *  actually ran with, and it survives a remount that would zero the state. */
  allowUnknownColumns: boolean;
  allowInvalidCoordinates: boolean;
}

export interface ReconciliationSummaryProps {
  result: FacilityImportResult;
  /** Was the unrecognised-columns override in force for THIS result? A FACT about the result, not a
   *  control: the summary only reads it to choose wording. It is what the upload recorded and the
   *  validate ran with.
   *
   *  ⛔ Before the first poll answers the sheet has only its own live checkbox to pass, and that is
   *  safe only because of the invalidation: change the checkbox and `summarySignature` moves, the
   *  summary is discarded, and there is no window in which this boolean can describe a different
   *  parse from the one on screen. */
  unknownColumnsOverridden: boolean;
  /** Whether an apply this operator can still influence exists to set a conflict policy FOR — see
   *  the call sites for what answers it on each path. */
  showConflictChoice: boolean;
  /** The run's own parse-override state. */
  reupload: ReuploadOverrides | null;
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
export function ReconciliationSummary(props: ReconciliationSummaryProps) {
  const { t } = useTranslation();
  const { result } = props;

  const willWriteCount = willWrite(result);
  const unknownColumnsOverridden = props.unknownColumnsOverridden;
  // F2 fix: `parsed === 0` must read as an unsuccessful outcome whether or not unknown columns were
  // ever involved — EXCEPT while the file is still just sitting blocked on an unopted-in unknown-
  // columns notice (unknownColumns present, the override not in force): that case already has its
  // own explanation (the amber box below) and doesn't need a second, more confusing "no rows found"
  // message layered on top. Once the override IS in force (`unknownColumnsOverridden` — the run's
  // own stored option, which is what its validate ran with) and the file still parses
  // to nothing, that's the "wrong file entirely" trap surviving one step deeper — it must say so,
  // same as the plain no-unknown-columns case does.
  // Task 5: same reasoning as the unknownColumns exception above — a file that quarantined every
  // row already has its own explanation (the quarantine block below) and must not also show the
  // generic "no rows found" message.
  // CT-3: same reasoning again for `invalid` — a file whose every row failed coordinate validation
  // (without the override) already has its own explanation (the invalid-coordinates block below).
  const noOutcomeStated = result.parsed === 0
    && (result.unknownColumns.length === 0 || unknownColumnsOverridden)
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

      {/* Whole-branch review, MUST FIX 3: `columnMapErrors` — same reasoning as `duplicateColumns`
          (which this sheet still does not render; that gap is separate and out of scope here): a
          non-empty list means nothing imported, and there is no override — the operator must fix
          the map, which is exactly why `ColumnMapStep` stays mounted below for this specific
          `blockedReason` (see its own render gate). Rendered ahead of `noOutcomeStated` and the
          other amber boxes: this is the reason nothing else on this file could be evaluated. */}
      <ColumnMapErrorsNotice result={result} />

      {noOutcomeStated && (
        <p className="text-muted-foreground">
          {result.skipped > 0
            ? t('facilities.import.noRowsFoundSkipped', { skipped: result.skipped })
            : t('facilities.import.noRowsFound')}
        </p>
      )}

      {/* ⛔ THE CONTROL UNDER THIS NOTICE DIFFERS BY DOOR, and it has to. Inline, ticking the box
          re-runs the preview, so the summary always describes the parse the box selects. On the run
          door the validate has already happened — see `ReuploadOverrides` for why a tick there could
          only 409 — so this offers the re-upload the confirm route's own refusal points at, and says
          nothing at all for a JSONL release, where the flag provably cannot change the parse. */}
      {/* ⛔ SPLIT BY WHETHER THE FILE WAS ACTUALLY REFUSED, not by whether the list is populated.
          `unknownColumns` is a true statement about the file either way, but what it MEANS depends
          on whether a column map decided those columns. With a map they were carried into each
          row's extras and nothing is wrong, so the amber box below would be a warning about work
          the operator already did: it told the Zambia team "Nothing is imported unless you opt in"
          about nine columns they had deliberately skipped. Reads the server's own `blockedReason`
          rather than re-deriving the condition, so this and the parser cannot drift. */}
      {result.unknownColumns.length > 0 && result.blockedReason !== 'unknown-columns' && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t('facilities.import.keptAsExtraTitle')}</p>
          <p>{t('facilities.import.keptAsExtraBody', { columns: result.unknownColumns.join(', ') })}</p>
        </div>
      )}

      {result.unknownColumns.length > 0 && result.blockedReason === 'unknown-columns' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <p className="font-medium">{t('facilities.import.unknownColumnsTitle')}</p>
          {/* No JSONL arm any more, and it is not an oversight: this box now renders ONLY for
              `blockedReason === 'unknown-columns'`, and `parseFacilityRelease` never sets it. A
              JSONL release with an unrecognised key takes the "kept as extra data" note above, which
              says the same thing in the same words as every other non-blocking case. */}
          <p>{t('facilities.import.unknownColumnsBody', { columns: result.unknownColumns.join(', ') })}</p>
          {/* ⛔ GUIDANCE, NOT A CONTROL, and it is still true on the run door. The override itself
              lives on Mapping now, but this validate has already happened: nothing short of a fresh
              upload re-runs it, so ticking the box there takes effect on the RE-UPLOAD offered in
              the actions menu. Plan B's re-validate route is what will make this note unnecessary.
              A JSONL release is exempt: `allowUnknownColumns` is a documented no-op for it. */}
          {props.reupload !== null && props.reupload.sourceFormat !== 'jsonl' && (
            <p className="mt-2">
              {t(props.reupload.allowUnknownColumns
                ? 'facilities.import.overrideAppliedToRun'
                : 'facilities.import.overrideNeedsReupload')}
            </p>
          )}
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
          {/* Same read-only guidance as the unrecognised-columns box, with NO format branch:
              `allowInvalidCoordinates` is honoured by both parsers, so it is live for JSONL too. */}
          {props.reupload !== null && (
            <p className="mt-2">
              {t(props.reupload.allowInvalidCoordinates
                ? 'facilities.import.overrideAppliedToRun'
                : 'facilities.import.overrideNeedsReupload')}
            </p>
          )}
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
            {result.invalid.map((row, i) => (
              <li key={`${row.line}-${row.field}-${i}`}>
                {t('facilities.import.invalidLine', { line: row.line, field: row.field, raw: row.raw })}
              </li>
            ))}
          </ul>
          {/* Same two-door split as the unrecognised-columns box above — but with NO format branch:
              `allowInvalidCoordinates` is honoured by BOTH parsers (facility-csv.ts and
              facility-release.ts's `row` branch alike), so it is live for a JSONL release too. */}
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
                      {row.diff.map((d) => {
                        // An object-valued field names what moved inside it; everything else keeps
                        // the before/after it always had.
                        if (isPlainObject(d.before) || isPlainObject(d.after)) {
                          const keys = changedObjectKeys(d.before, d.after);
                          return (
                            <li key={d.field}>
                              {t('facilities.import.changedFieldKeys', {
                                field: d.field,
                                // Empty means the server flagged a field whose contents are equal.
                                // Say something true rather than an empty list.
                                keys: keys.length > 0
                                  ? keys.join(', ')
                                  : t('facilities.import.changedFieldKeysUnnamed'),
                              })}
                            </li>
                          );
                        }
                        return (
                          <li key={d.field}>
                            {t('facilities.import.changedFieldDiff', {
                              field: d.field, before: fmtDiffValue(d.before), after: fmtDiffValue(d.after),
                            })}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CT-3 / Task 8: the controlled-field layer (FAC-P1-05) — a raw source value for
              level/status/country that resolved to no canonical `term_mappings` code. A WARNING,
              never a block: the raw value is still written exactly as before this layer existed
              (see facility-import.ts's `unmapped` doc comment).
              ⛔ REPORTED HERE, DECIDED ON MAPPING. This used to render `ValueMapPanel` with its
              pick-lists, which made Review the page that both asked the question and reported the
              answer. The panel now lives on Mapping, fed by the last check's findings; this states
              what was found and offers nothing to click. */}
          {CONTROLLED_FIELDS.some((f) => result.unmapped[f].length > 0) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              <p className="font-medium">{t('facilities.import.unmappedTitle')}</p>
              {CONTROLLED_FIELDS.filter((f) => result.unmapped[f].length > 0).map((f) => (
                <p key={f}>
                  {t('facilities.import.unmappedField', {
                    field: t(`facilities.filters.${f}Label`),
                    count: result.unmapped[f].length,
                    values: result.unmapped[f].slice(0, 5).join(', '),
                  })}
                </p>
              ))}
              <p className="mt-1">{t('facilities.import.unmappedFixOnMapping')}</p>
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

          {result.duplicates > 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              {t('facilities.import.duplicatesWarning', { count: result.duplicates })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
