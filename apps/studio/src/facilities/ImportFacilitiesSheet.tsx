import { useState, type ChangeEvent } from 'react';
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
import { importFacilitiesCsv, type FacilityImportResult, type ControlledField } from '@/api';

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

interface ImportFacilitiesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once an APPLY succeeds (never for a dry run) so the caller can reload its list — see
   *  Facilities.tsx, which passes its own `reload`. */
  onImported: () => void;
}

// The server bounds a real APPLY to this many rows (MAX_INLINE_APPLY_ROWS in
// apps/server/src/facilities-routes.ts) and points anything larger at the CLI instead — see that
// file's own doc comment for why (an applied import runs as one atomic transaction, and beyond a
// few thousand rows that can run past a reasonable HTTP request deadline). That constant is not
// exported for the browser bundle to import (the route file pulls in the full server DB engine),
// so this is a deliberately mirrored literal, not a shared import — it is a SETTLED contract value
// (task-5-brief.md), used here only to give the operator a proactive, friendly notice before ever
// attempting a doomed Apply request. The actual enforcement stays server-side: handleApply's catch
// block below also recognises the server's own over-cap 400 by message content, so a drift between
// this literal and the real cap degrades to a slightly-late (but still friendly) error, never to a
// bypass or a raw dump of the CLI-flavoured server string.
const APPLY_ROW_CAP = 2000;

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
  // re-preview (see `toggleAllowInvalidCoordinates` below) — it changes which rows land in `records`,
  // not merely whether Apply may proceed.
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
    invalidatePreview();
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
  const friendlyImportErrorMessage = (raw: string): string => {
    const lower = raw.toLowerCase();
    if (lower.includes('inline apply limit')) return t('facilities.import.tooLargeError');
    if (lower.includes('mb limit for this endpoint')) return t('facilities.import.tooLargeFileError');
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

  // `!csv` matters as its own gate, distinct from `!file`: reading the file's text back out is
  // asynchronous (File.text()), so there is a real window after picking a file where `file` is
  // already set but `csv` has not resolved yet. Without this, a click in that window would fall
  // through runPreview's own early return and silently do nothing — worse than a disabled button.
  const previewDisabled = !file || !csv || !nationalSystem.trim() || previewing || applying || !!applyResult;
  // F5 fix: `!csv` covers "still reading" AND "0-byte file" identically (both leave `csv` falsy),
  // so a genuinely empty file left Preview disabled forever with nothing on screen explaining why.
  // `csv === ''` (as opposed to `null`) only ever happens once `File.text()` has actually resolved
  // — a still-reading file has `csv === null` — so this fires exactly for "read finished, and it's
  // empty", never during the async read window above.
  const emptyFile = !!file && csv === '';
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
  // ⛔ THIS IS A TOGGLE, NOT A RELEASE VALVE, and that only works because `runPreview` pins
  // `allowMalformedRows: false` on every preview request (see its comment). `blockedReason` therefore
  // always reports the UN-OVERRIDDEN reason, so ticking the box releases the block and un-ticking
  // re-imposes it — pinned by "re-imposes the quarantine block when the operator un-ticks the
  // override". Nothing here re-derives the server's predicate from `quarantined`/`duplicateColumns`;
  // it reads the server's reason and suppresses exactly the one that has an override.
  // `'duplicate-columns'` has none, so it is taken verbatim and no checkbox can clear it.
  const blockedByImport = !!previewResult && previewResult.blocked
    && !(previewResult.blockedReason === 'quarantined-rows' && allowMalformedRows);
  const canApply = !!previewResult && previewResult.parsed > 0 && previewResult.parsed <= APPLY_ROW_CAP
    && !blockedByImport && !applyResult;
  const overCap = !!previewResult && previewResult.parsed > APPLY_ROW_CAP;
  // A2a (FAC-P1-03) superseded the original F3 fix. `parsed - duplicates` only ever accounted for
  // rows the FILE itself repeated — every other accepted row still read as something Apply would
  // write, even a row byte-identical to what the registry already holds (`unchanged`) or one that
  // will be skipped because it was edited since the preview (`conflict`). `create + changed` is the
  // server's own reconciliation of what an apply would actually write (`classifyFacilityRows`,
  // computed on every preview — see facility-import.ts's docblock), not a client-side approximation
  // of it. `duplicates` itself keeps reading off `parsed` unchanged elsewhere (the over-cap check
  // mirrors the server's own cap, which is checked against `parsed`, not this).
  const willWriteCount = previewResult ? previewResult.create + previewResult.changed : 0;
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
  const noOutcomeStated = !!previewResult
    && previewResult.parsed === 0
    && (previewResult.unknownColumns.length === 0 || allowUnknownColumns)
    && previewResult.quarantined.length === 0
    && previewResult.invalid.length === 0;

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
              {!applyResult && (
                <DropdownMenuItem disabled={previewDisabled} onClick={() => void runPreview()}>
                  {previewing ? t('facilities.import.previewing') : t('facilities.import.previewAction')}
                </DropdownMenuItem>
              )}
              {!applyResult && canApply && (
                <DropdownMenuItem disabled={applying} onClick={() => setConfirmOpen(true)}>
                  {applying ? t('facilities.import.applying') : t('facilities.import.applyAction')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={previewing || applying} onClick={() => onOpenChange(false)}>
                {applyResult ? t('common.close') : t('common.cancel')}
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
                disabled={applying}
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
                disabled={applying}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('facilities.import.nationalSystemHint')}</p>
            </div>

            {/* CT-3: which shape the file is — feeds `FacilityImportRequest.format` on every preview
                AND apply (see runPreview/handleApplyConfirm). Without this control the sheet could
                never import a JSONL release at all, and `absent`/`deleted` (declaration-only fields
                a plain CSV can never carry) stayed permanently unreachable. */}
            <Label htmlFor="facility-import-format" className="whitespace-nowrap">{t('facilities.import.formatLabel')}</Label>
            <Select value={format} onValueChange={(v) => handleFormatChange(v as 'csv' | 'jsonl')} disabled={applying}>
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
                sibling `<p>`, not a second label. */}
            <Label htmlFor="facility-import-complete-release" className="whitespace-nowrap">
              {t('facilities.import.completeReleaseLabel')}
            </Label>
            <div>
              <Checkbox
                id="facility-import-complete-release"
                checked={completeRelease}
                disabled={applying}
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
              disabled={applying}
            />
          </div>

          {previewResult && !applyResult && (
            <div className="mx-6 mt-4 space-y-3 text-sm">
              {/* A2a: informational only — never blocks Apply. A `nationalSystem` no existing row
                  uses yet is routinely just the FIRST import of a real register, not a mistake; the
                  server (facilities-routes.ts) cannot tell the two apart, so this only names the
                  possibility rather than refusing anything. */}
              {!previewResult.knownNationalSystem && (
                <div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700">
                  {t('facilities.import.newRegisterNotice')}
                </div>
              )}

              {/* CT-3: a JSONL release's own declared counts (`meta.rowCount`/`deletionCount`)
                  disagreeing with what actually parsed — "the release declares 13 000 rows, we
                  parsed 12 998" (see facility-import.ts's `FacilityImportResult.countMismatch`).
                  Reported, never blocking — always `[]` for CSV, which has no release header. */}
              {previewResult.countMismatch.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <p className="font-medium">{t('facilities.import.countMismatchTitle')}</p>
                  {previewResult.countMismatch.map((m) => (
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
                  {previewResult.skipped > 0
                    ? t('facilities.import.noRowsFoundSkipped', { skipped: previewResult.skipped })
                    : t('facilities.import.noRowsFound')}
                </p>
              )}

              {previewResult.unknownColumns.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <p className="font-medium">{t('facilities.import.unknownColumnsTitle')}</p>
                  <p>{t('facilities.import.unknownColumnsBody', { columns: previewResult.unknownColumns.join(', ') })}</p>
                  <label className="mt-2 flex items-center gap-2">
                    <Checkbox
                      checked={allowUnknownColumns}
                      disabled={previewing}
                      onCheckedChange={(c) => toggleAllowUnknownColumns(c === true)}
                    />
                    <span>{t('facilities.import.allowUnknownColumns')}</span>
                  </label>
                </div>
              )}

              {previewResult.quarantined.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <p className="font-medium">{t('facilities.import.quarantinedTitle')}</p>
                  <p>{t('facilities.import.quarantinedCount', { count: previewResult.quarantined.length })}</p>
                  <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                    {previewResult.quarantined.map((row) => (
                      <li key={row.line}>{t('facilities.import.quarantinedLine', { line: row.line, raw: row.raw })}</li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-center gap-2">
                    <Checkbox
                      checked={allowMalformedRows}
                      disabled={previewing}
                      onCheckedChange={(c) => toggleAllowMalformedRows(c === true)}
                    />
                    <span>{t('facilities.import.allowMalformedRows')}</span>
                  </label>
                </div>
              )}

              {/* CT-3: `invalid` (facility-import.ts's per-FIELD coordinate errors) — a row here was
                  otherwise well-formed but had its latitude/longitude rejected, and is DROPPED from
                  `records` entirely (never counted in `create`/`changed`/`unchanged`, unlike
                  `quarantined` above) unless `allowInvalidCoordinates` is set. Same idiom as
                  `allowUnknownColumns`/`allowMalformedRows`, but toggling it DOES re-preview — see
                  `toggleAllowInvalidCoordinates`. */}
              {previewResult.invalid.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <p className="font-medium">{t('facilities.import.invalidTitle')}</p>
                  <p>{t('facilities.import.invalidCount', { count: previewResult.invalid.length })}</p>
                  <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                    {previewResult.invalid.map((row, i) => (
                      <li key={`${row.line}-${row.field}-${i}`}>
                        {t('facilities.import.invalidLine', { line: row.line, field: row.field, raw: row.raw })}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-center gap-2">
                    <Checkbox
                      checked={allowInvalidCoordinates}
                      disabled={previewing}
                      onCheckedChange={(c) => toggleAllowInvalidCoordinates(c === true)}
                    />
                    <span>{t('facilities.import.allowInvalidCoordinates')}</span>
                  </label>
                </div>
              )}

              {previewResult.parsed > 0 && (
                <>
                  <p>{t('facilities.import.previewSummary', { parsed: willWriteCount, skipped: previewResult.skipped })}</p>

                  {/* A2a (FAC-P1-03/05): the reconciliation summary — what this file would actually
                      DO to the registry, computed by the server on every preview, never just on
                      apply (see FacilityImportResult's own docblock in api.ts). `conflict`/`absent`
                      render "not evaluated" on `null` and NEVER as `0` — a `0` here would claim a
                      measurement the server never took (no `runId` linking this call to a prior
                      preview / no declared complete release). */}
                  <div className="rounded-md border border-border px-3 py-2 text-xs space-y-1">
                    <p>{t('facilities.import.summaryCreate', { count: previewResult.create })}</p>
                    <p>{t('facilities.import.summaryChanged', { count: previewResult.changed })}</p>
                    <p>{t('facilities.import.summaryUnchanged', { count: previewResult.unchanged })}</p>
                    <p>
                      {previewResult.conflict === null
                        ? t('facilities.import.conflictNotEvaluated')
                        : t('facilities.import.summaryConflict', { count: previewResult.conflict })}
                    </p>
                    <p>
                      {previewResult.absent === null
                        ? t('facilities.import.absentNotEvaluated')
                        : t('facilities.import.summaryAbsent', { count: previewResult.absent })}
                    </p>
                    {previewResult.deleted > 0 && (
                      <p>{t('facilities.import.summaryDeleted', { count: previewResult.deleted })}</p>
                    )}
                  </div>

                  {previewResult.samples.changed.length > 0 && (
                    <div className="rounded-md border border-border px-3 py-2 text-xs">
                      <p className="font-medium">{t('facilities.import.changedSampleTitle')}</p>
                      <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                        {previewResult.samples.changed.map((row) => (
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
                  {CONTROLLED_FIELDS.some((f) => previewResult.unmapped[f].length > 0) && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                      <p className="font-medium">{t('facilities.import.unmappedTitle')}</p>
                      {CONTROLLED_FIELDS.filter((f) => previewResult.unmapped[f].length > 0).map((field) => (
                        <p key={field}>
                          {t('facilities.import.unmappedMessage', {
                            count: previewResult.unmapped[field].length,
                            field: t(`facilities.filters.${field}Label`),
                            values: previewResult.unmapped[field].join(', '),
                          })}
                        </p>
                      ))}
                    </div>
                  )}
                  {/* Informational, not a warning box: these fields simply have no seeded value set
                      to check against on this install, so mapped/unmapped could not be determined. */}
                  {previewResult.notValidated.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('facilities.import.notValidatedMessage', {
                        fields: previewResult.notValidated.map((f) => t(`facilities.filters.${f}Label`)).join(', '),
                      })}
                    </p>
                  )}

                  {/* A2a: the retirement choices are INPUTS (label-left/input-right, exempt from the
                      ⋯-menu rule — see ui-actions-in-dots-menu), not actions. Shown only when there
                      is something meaningful to decide: a `deleted`/`absent` of `0` (or `absent`
                      still `null`, not evaluated) has nothing to retire, so a control here would
                      offer a choice with no effect. */}
                  {previewResult.deleted > 0 && (
                    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
                      <Label htmlFor="facility-import-on-deleted" className="whitespace-nowrap">
                        {t('facilities.import.onDeletedLabel')}
                      </Label>
                      <Select value={onDeleted} onValueChange={(v) => setOnDeleted(v as 'retire' | 'report')}>
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
                  {previewResult.absent !== null && previewResult.absent > 0 && (
                    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
                      <Label htmlFor="facility-import-on-absent" className="whitespace-nowrap">
                        {t('facilities.import.onAbsentLabel')}
                      </Label>
                      <Select value={onAbsent} onValueChange={(v) => setOnAbsent(v as 'retire' | 'report')}>
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
                  {/* CT-3: gated on `runId`, NOT on `conflict > 0` like onDeleted/onAbsent above —
                      and deliberately so. A fresh standalone preview's OWN `conflict` is ALWAYS
                      `null`: `conflictsEvaluated` needs a `previewedAt` watermark from a PRIOR
                      preview, which this request (being the one that just minted the run) can never
                      supply for itself (facility-import.ts's `previewedAt`/`conflictsEvaluated`). A
                      conflict can only ever be discovered by the APPLY this `runId` will later link
                      to — so the operator must set their skip/overwrite preference NOW, before that
                      apply runs, not after a count that will never arrive on this screen. */}
                  {!!previewResult.runId && (
                    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2">
                      <Label htmlFor="facility-import-on-conflict" className="whitespace-nowrap">
                        {t('facilities.import.onConflictLabel')}
                      </Label>
                      <Select value={onConflict} onValueChange={(v) => setOnConflict(v as 'skip' | 'overwrite')}>
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

                  {previewResult.duplicates > 0 && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                      {t('facilities.import.duplicatesWarning', { count: previewResult.duplicates })}
                    </p>
                  )}
                  {overCap && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                      <p className="font-medium">{t('facilities.import.tooLargeTitle')}</p>
                      <p>{t('facilities.import.tooLargeBody', { count: previewResult.parsed })}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {applyResult && (
            <div className="mx-6 mt-4 space-y-2 text-sm">
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-700">
                <p className="font-medium">{t('facilities.import.doneTitle')}</p>
                <p>{t('facilities.import.doneSummary', { created: applyResult.written.created, updated: applyResult.written.updated, skipped: applyResult.skipped })}</p>
                {applyResult.duplicates > 0 && (
                  <p>{t('facilities.import.duplicatesWarning', { count: applyResult.duplicates })}</p>
                )}
              </div>

              {/* CT-3: THE FIX FOR THE DEFECT THIS TASK CLOSES. Before this, a row edited between
                  preview and apply was classified `conflict`, skipped by default (or overwritten),
                  and the apply result rendered only `written.created`/`written.updated`/`skipped` —
                  the conflict never appeared anywhere on screen: no count, no sample, no sign it had
                  even happened. `onConflict` (still held in state after Apply) decides which of the
                  two honest outcomes actually occurred. */}
              {applyResult.conflict !== null && applyResult.conflict > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  <p>
                    {t(
                      onConflict === 'overwrite'
                        ? 'facilities.import.applyConflictOverwritten'
                        : 'facilities.import.applyConflictSkipped',
                      { count: applyResult.conflict },
                    )}
                  </p>
                  {applyResult.samples.conflict.length > 0 && (
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                      {applyResult.samples.conflict.map((row) => (
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
          description={previewResult ? t('facilities.import.applyConfirmBody', { count: willWriteCount }) : undefined}
          confirmLabel={t('facilities.import.applyAction')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { void handleApplyConfirm(); }}
        />
      </SheetContent>
    </Sheet>
  );
}

export default ImportFacilitiesSheet;
