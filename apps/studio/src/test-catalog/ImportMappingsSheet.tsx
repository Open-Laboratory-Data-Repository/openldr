import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { applyTestMappingImport, previewTestMappingImport, type ImportReportLike } from '@/api';

/** The import sheet for test mappings. Result mappings and result field links pass their own functions
 *  and description; every caller shares the preview, refusals and apply. */
export function ImportMappingsSheet({ open, onClose, onImported, preview = previewTestMappingImport, apply: applyFile = applyTestMappingImport, description, title, doneMessage }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  preview?: (file: File) => Promise<ImportReportLike>;
  apply?: (file: File) => Promise<ImportReportLike>;
  description?: string;
  title?: string;
  doneMessage?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReportLike | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setFile(null); setReport(null); onClose(); };

  const pick = async (f: File | null) => {
    setFile(f);
    setReport(null);
    if (!f) return;
    setBusy(true);
    try {
      setReport(await preview(f));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const done = await applyFile(file);
      toast.success(doneMessage ?? t('testCatalog.importMappings.done'));
      if (done.rebuild && !done.rebuild.ok) toast.error(t('testCatalog.observed.stale', { error: done.rebuild.error }));
      onImported();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const c = report?.counts;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{title ?? t('testCatalog.importMappings.title')}</SheetTitle>
          <SheetDescription>{description ?? t('testCatalog.importMappings.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.importMappings.file')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="import-mappings-menu" aria-label={t('testCatalog.importMappings.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="import-mappings-apply"
                  disabled={busy || !report || (report.counts.new + report.counts.changed === 0)}
                  onSelect={() => void runApply()}
                >
                  {t('testCatalog.importMappings.apply')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={close}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <div className="text-muted-foreground">{t('testCatalog.importMappings.file')}</div>
            <Input
              type="file"
              accept=".csv,text/csv"
              data-testid="import-mappings-file"
              disabled={busy}
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            />
          </div>
          {c && report && (
            <div className="space-y-1 border-t border-border px-6 py-4 text-sm">
              <div>{t('testCatalog.importMappings.summary', { new: c.new, changed: c.changed, unchanged: c.unchanged, refused: c.refused })}</div>
              {report.refused.map((r) => (
                <div key={r.line} className="text-xs text-destructive">
                  {t('testCatalog.importMappings.refusedLine', { line: r.line, code: r.code, reason: r.reason })}
                </div>
              ))}
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
