import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { listReportDesignVersions, getReportDesignVersion, type ReportDesignVersion } from '../api';
import type { ReportTemplate } from './types';

interface Props {
  open: boolean;
  designId: string;
  onClose(): void;
  /** Hands the snapshot back so the PAGE can apply it through its ordinary edit path. */
  onRestore(snapshot: ReportTemplate, version: number): void;
}

/**
 * Published versions of one design, newest first, each restorable.
 *
 * ⛔ Restore does NOT write to the server here. It hands the snapshot up so the designer applies it
 * as an ordinary edit: one undo step, autosave persists it, and the normal write gates
 * (`findUnsortedHeaderRows`, `findTransposedTotals`, `findInvalidImageSources`) all still run. A
 * direct server-side overwrite would be the only write path in the app that skips them.
 */
export function VersionsDrawer({ open, designId, onClose, onRestore }: Props): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ReportDesignVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listReportDesignVersions(designId)
      .then((v) => { if (!cancelled) setRows(v); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, designId]);

  const restore = async (version: number) => {
    setBusy(version);
    setError(undefined);
    try {
      const snapshot = await getReportDesignVersion(designId, version);
      onRestore(snapshot as ReportTemplate, version);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const shown = rows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-3 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('reportDesigner.versions')}</SheetTitle>
          <SheetDescription>{t('reportDesigner.versionsHint')}</SheetDescription>
        </SheetHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <LoadingState />
          ) : rows.length === 0 ? (
            <StripedEmpty className="min-h-[16rem]">{t('reportDesigner.noVersions')}</StripedEmpty>
          ) : (
            <>
              <Table wrapperClassName="min-h-0 flex-1">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reportDesigner.version')}</TableHead>
                    <TableHead>{t('reportDesigner.publishedAt')}</TableHead>
                    <TableHead>{t('reportDesigner.publishedBy')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((v) => (
                    <TableRow key={v.version}>
                      <TableCell className="tabular-nums">{v.version}</TableCell>
                      <TableCell>{new Date(v.publishedAt).toLocaleString()}</TableCell>
                      <TableCell>{v.publishedBy ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" size="sm" disabled={busy != null}
                          aria-label={`${t('reportDesigner.restoreVersion')} ${v.version}`}
                          onClick={() => { void restore(v.version); }}>
                          {t('reportDesigner.restore')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination page={page} pageSize={pageSize} total={rows.length}
                onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(0); }} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
