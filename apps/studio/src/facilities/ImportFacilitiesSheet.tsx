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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { importFacilitiesCsv, type FacilityImportResult } from '@/api';

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

  const runPreview = async (allowOverride?: boolean): Promise<void> => {
    if (!csv || !nationalSystem.trim()) return;
    setPreviewing(true);
    setError(null);
    setApplyResult(null);
    try {
      const result = await importFacilitiesCsv({
        csv,
        nationalSystem: nationalSystem.trim(),
        allowUnknownColumns: allowOverride ?? allowUnknownColumns,
        allowMalformedRows,
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
    void runPreview(checked);
  };

  // Deliberately does NOT re-run the preview — see `allowMalformedRows`'s doc comment above: the
  // set of quarantined rows is a property of the file, not of this flag, so there is nothing new
  // for a second preview request to discover. Toggling it only changes whether Apply is allowed
  // to proceed.
  const toggleAllowMalformedRows = (checked: boolean) => {
    setAllowMalformedRows(checked);
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
        apply: true,
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
  // The ONE thing re-applied here rather than read: the malformed-rows OVERRIDE. `blocked` answers
  // for the options the PREVIEW ran with, and the checkbox deliberately does not re-preview (see
  // `toggleAllowMalformedRows` — the quarantine list is a property of the file, so a second request
  // would discover nothing), so the live checkbox can be ahead of the previewed answer. Only the
  // overridable reason is re-evaluated; `'duplicate-columns'` has no override and is taken verbatim.
  const blockedByImport = !!previewResult && previewResult.blocked
    && (previewResult.blockedReason !== 'quarantined-rows' || !allowMalformedRows);
  const canApply = !!previewResult && previewResult.parsed > 0 && previewResult.parsed <= APPLY_ROW_CAP
    && !blockedByImport && !applyResult;
  const overCap = !!previewResult && previewResult.parsed > APPLY_ROW_CAP;
  // F3 fix: `parsed` counts every accepted row INCLUDING rows `duplicates` later collapses down to
  // one (see facility-import.ts's docblock on FacilityImportResult.parsed) — the headline number
  // shown to the operator must describe what Apply will actually WRITE, not what the parser merely
  // accepted before dedup. `duplicates` itself keeps reading off `parsed` unchanged elsewhere (the
  // over-cap check mirrors the server's own cap, which is checked against `parsed`, not this).
  const willWriteCount = previewResult ? previewResult.parsed - previewResult.duplicates : 0;
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
  const noOutcomeStated = !!previewResult
    && previewResult.parsed === 0
    && (previewResult.unknownColumns.length === 0 || allowUnknownColumns)
    && previewResult.quarantined.length === 0;

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
                accept=".csv,text/csv"
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
          </div>

          {previewResult && !applyResult && (
            <div className="mx-6 mt-4 space-y-3 text-sm">
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

              {previewResult.parsed > 0 && (
                <>
                  <p>{t('facilities.import.previewSummary', { parsed: willWriteCount, skipped: previewResult.skipped })}</p>
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
            <div className="mx-6 mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              <p className="font-medium">{t('facilities.import.doneTitle')}</p>
              <p>{t('facilities.import.doneSummary', { created: applyResult.created, updated: applyResult.updated, skipped: applyResult.skipped })}</p>
              {applyResult.duplicates > 0 && (
                <p>{t('facilities.import.duplicatesWarning', { count: applyResult.duplicates })}</p>
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
