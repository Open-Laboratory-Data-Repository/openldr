import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { listIdentifierSystems, type IdentifierSystemRow } from '@/api';
import { IdentifierSystemSheet } from './IdentifierSystemSheet';

// Identifier systems seen in the warehouse (patient index spec, section 3), the way the Observed tabs
// on Facilities and Test Catalog list codes CE sees but does not own. The null system has no URI to
// label, so it has no Edit.

export function IdentifierSystemsTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<IdentifierSystemRow[]>([]);
  const [total, setTotal] = useState(0);
  const [ownedHere, setOwnedHere] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<IdentifierSystemRow | null>(null);
  // A response from an older load must not overwrite a newer one (page changes, save reloads).
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const out = await listIdentifierSystems({ limit: pageSize, offset: page * pageSize });
      if (seq !== loadSeq.current) return;
      setRows(out.rows);
      setTotal(out.total);
      setOwnedHere(out.ownedHere);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const editable = canManage && ownedHere;
  const key = (r: IdentifierSystemRow) => r.system ?? 'none';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!ownedHere && <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t('patients.systems.fromCentral')}</div>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">{t('patients.systems.empty')}</StripedEmpty>
        )}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('patients.systems.col.label')}</TableHead>
                <TableHead>{t('patients.systems.col.system')}</TableHead>
                <TableHead>{t('patients.systems.col.patients')}</TableHead>
                <TableHead>{t('patients.systems.col.listed')}</TableHead>
                <TableHead>{t('patients.systems.col.searched')}</TableHead>
                {editable && <TableHead className="w-12"><span className="sr-only">{t('patients.rowActions')}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((r) => (
                <TableRow key={key(r)} data-testid={`identifier-system-row-${key(r)}`}>
                  <TableCell>{r.system === null ? t('patients.noSystem') : r.label ?? ''}</TableCell>
                  <TableCell className="break-all font-mono text-xs">{r.system ?? ''}</TableCell>
                  <TableCell>{r.patientCount}</TableCell>
                  <TableCell>{r.listColumn ? t('patients.systems.yes') : t('patients.systems.no')}</TableCell>
                  <TableCell>{r.searchable ? t('patients.systems.yes') : t('patients.systems.no')}</TableCell>
                  {editable && (
                    <TableCell>
                      {r.system !== null && (
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                                data-testid={`identifier-system-actions-${key(r)}`}
                                aria-label={t('patients.systems.actionsFor', { system: r.system })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem data-testid={`identifier-system-edit-${key(r)}`} onSelect={() => setEditing(r)}>
                                {t('patients.systems.edit')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(0); }} />
      <IdentifierSystemSheet system={editing} onClose={() => setEditing(null)} onSaved={() => { void load(); }} />
    </div>
  );
}
