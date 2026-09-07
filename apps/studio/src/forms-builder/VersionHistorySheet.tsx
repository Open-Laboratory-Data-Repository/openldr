import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
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
      toast.success(`Restored version ${version}`);
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
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Version history</SheetTitle>
            <SheetDescription>
              Every published version of this form, newest first. Restoring one replaces the draft
              you are editing.
            </SheetDescription>
          </SheetHeader>

          {loading ? (
            <LoadingState />
          ) : error ? (
            // A failed fetch is not the same claim as "never published". Show the error, not
            // StripedEmpty, so a transient failure does not read as a permanent fact about the form.
            <p className="text-sm text-destructive">{error}</p>
          ) : total === 0 ? (
            // Stripes imply emptiness, so they never show while loading. An empty table's header
            // forces intrinsic width and scrolls sideways on a phone, so render no table at all.
            <StripedEmpty className="min-h-[16rem]">
              This form has never been published. Publishing takes a snapshot you can come back to.
            </StripedEmpty>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                <Table wrapperClassName="min-h-0 flex-1">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Published</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{v.version}</TableCell>
                        <TableCell className="text-muted-foreground">{v.versionLabel || '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(v.publishedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Actions for version ${v.version}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setPendingRestore(v)}>
                                Restore
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
        title={pendingRestore ? `Restore version ${pendingRestore.version}?` : 'Restore version?'}
        description="This replaces the form you are editing. A published form goes back to draft. You can undo it in the builder."
        confirmLabel="Restore"
        destructive
        onConfirm={() => { void confirmRestore(); }}
      />
    </>
  );
}
