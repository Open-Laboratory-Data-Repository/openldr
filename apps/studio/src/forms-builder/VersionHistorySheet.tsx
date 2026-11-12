import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingState } from '@/components/ui/spinner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { listFormVersions, restoreFormVersion, type FormDefinition, type FormVersionSummary } from '../api';

export interface VersionHistorySheetProps {
  formId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The builder replaces its schema state with the restored form. */
  onRestored: (form: FormDefinition) => void;
}

// Deliberately no onCompare. Task 4 lets the Compare dialog pick any version on either side,
// so a second route into it from here would be a duplicate path to the same screen.

export function VersionHistorySheet({
  formId, open, onOpenChange, onRestored,
}: VersionHistorySheetProps): JSX.Element {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [pendingRestore, setPendingRestore] = useState<FormVersionSummary | null>(null);

  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listFormVersions(formId)
      .then((loaded) => { if (!cancelled) setVersions(loaded); })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, formId]);

  const total = versions.length;
  const shown = versions.slice(page * pageSize, page * pageSize + pageSize);

  const confirmRestore = async () => {
    if (!formId || !pendingRestore) return;
    const version = pendingRestore.version;
    try {
      const restored = await restoreFormVersion(formId, version);
      onRestored(restored);
      toast.success(t('formBuilder.versions.restored', { n: version }));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingRestore(null);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* p-0 and gap-0, then each section pads itself. AGENTS.md section 5: rules read
            edge-to-edge while text stays inset. The table's header underline, row dividers and
            TablePagination's top border are those rules, and SheetContent's default p-6 stopped
            every one of them short of the pane. Cell padding (px-4) keeps the text inset.
            Same shape as workflows/components/panels/run-history-drawer.tsx. */}
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle>{t('formBuilder.versions.title')}</SheetTitle>
            <SheetDescription>
              {t('formBuilder.versions.description')}
            </SheetDescription>
          </SheetHeader>

          {loading ? (
            <LoadingState className="min-h-[16rem]" />
          ) : error ? (
            // A failed fetch is not the same claim as "never published". Show the error, not
            // StripedEmpty, so a transient failure does not read as a permanent fact about the form.
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : total === 0 ? (
            // Stripes imply emptiness, so they never show while loading. An empty table's header
            // forces intrinsic width and scrolls sideways on a phone, so render no table at all.
            <StripedEmpty className="min-h-[16rem]">
              {t('formBuilder.versions.empty')}
            </StripedEmpty>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                <Table wrapperClassName="min-h-0 flex-1">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('formBuilder.versions.version')}</TableHead>
                      <TableHead>{t('formBuilder.versions.label')}</TableHead>
                      <TableHead>{t('formBuilder.versions.published')}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{v.version}</TableCell>
                        <TableCell className="text-muted-foreground">{v.versionLabel || '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(v.publishedAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={t('formBuilder.versions.rowActions', { n: v.version })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setPendingRestore(v)}>
                                {t('formBuilder.versions.restore')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
              />
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={pendingRestore !== null}
        onOpenChange={(o) => { if (!o) setPendingRestore(null); }}
        title={pendingRestore ? t('formBuilder.versions.confirmTitle', { n: pendingRestore.version }) : t('formBuilder.versions.confirmTitleBare')}
        description={t('formBuilder.versions.confirmBody')}
        confirmLabel={t('formBuilder.versions.restore')}
        destructive
        onConfirm={() => { void confirmRestore(); }}
      />
    </>
  );
}
