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
        apply: false,
      });
      setPreviewResult(result);
    } catch (err) {
      setPreviewResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const toggleAllowUnknownColumns = (checked: boolean) => {
    setAllowUnknownColumns(checked);
    void runPreview(checked);
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
        apply: true,
      });
      setApplyResult(result);
      onImported();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The server's own over-cap message is written for someone reading server logs or a CLI
      // terminal ("...use `openldr facilities import --apply` (the CLI) instead — it is not bound
      // by an HTTP request deadline") — dumped verbatim into this sheet it reads as a stray
      // fragment. A Settings-page operator may have no shell into the container at all, so this
      // names the actual constraint (too large for the browser) before pointing at the CLI.
      setError(message.toLowerCase().includes('inline apply limit') ? t('facilities.import.tooLargeError') : message);
    } finally {
      setApplying(false);
    }
  };

  // `!csv` matters as its own gate, distinct from `!file`: reading the file's text back out is
  // asynchronous (File.text()), so there is a real window after picking a file where `file` is
  // already set but `csv` has not resolved yet. Without this, a click in that window would fall
  // through runPreview's own early return and silently do nothing — worse than a disabled button.
  const previewDisabled = !file || !csv || !nationalSystem.trim() || previewing || applying || !!applyResult;
  // parsed === 0 covers BOTH the "nothing recognised" trap (unknownColumns populated, blocked
  // outright) and the "wrong file entirely" trap (parsed 0, unknownColumns empty) — neither has
  // anything to apply. Over the row cap is refused for the same reason a doomed request is: never
  // worth sending.
  const canApply = !!previewResult && previewResult.parsed > 0 && previewResult.parsed <= APPLY_ROW_CAP && !applyResult;
  const overCap = !!previewResult && previewResult.parsed > APPLY_ROW_CAP;

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
            <input
              id="facility-import-file"
              type="file"
              accept=".csv,text/csv"
              disabled={applying}
              onChange={handleFileChange}
              className="text-sm text-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium disabled:cursor-not-allowed disabled:opacity-50"
            />

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
              {previewResult.parsed === 0 && previewResult.unknownColumns.length === 0 && (
                <p className="text-muted-foreground">{t('facilities.import.noRowsFound')}</p>
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

              {previewResult.parsed > 0 && (
                <>
                  <p>{t('facilities.import.previewSummary', { parsed: previewResult.parsed, skipped: previewResult.skipped })}</p>
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
          description={previewResult ? t('facilities.import.applyConfirmBody', { count: previewResult.parsed }) : undefined}
          confirmLabel={t('facilities.import.applyAction')}
          onConfirm={() => { void handleApplyConfirm(); }}
        />
      </SheetContent>
    </Sheet>
  );
}

export default ImportFacilitiesSheet;
