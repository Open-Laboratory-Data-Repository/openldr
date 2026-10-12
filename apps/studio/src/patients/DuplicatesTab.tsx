import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { downloadPatientDuplicatesCsv, listPatientDuplicates, type DuplicateGroup } from '@/api';
import { DuplicateGroupSheet, ruleLabel } from './DuplicateGroupSheet';

// Likely duplicate patients (patient duplicates spec, section 6). Copies IdentifierSystemsTab.tsx,
// including its guard against a late response overwriting a newer one.

type Status = 'open' | 'dismissed' | 'all';

export function DuplicatesTab({ canManage, canExport, onOpen }: {
  canManage: boolean; canExport: boolean; onOpen: (ref: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DuplicateGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('open');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<DuplicateGroup | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const out = await listPatientDuplicates({ status, limit: pageSize, offset: page * pageSize });
      if (seq !== loadSeq.current) return;
      setRows(out.rows);
      setTotal(out.total);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <Select value={status} onValueChange={(v) => { setStatus(v as Status); setPage(0); }}>
          <SelectTrigger className="h-8 w-44" aria-label={t('patients.duplicates.statusFilter')} data-testid="duplicates-status-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t('patients.duplicates.status.open')}</SelectItem>
            <SelectItem value="dismissed">{t('patients.duplicates.status.dismissed')}</SelectItem>
            <SelectItem value="all">{t('patients.duplicates.status.all')}</SelectItem>
          </SelectContent>
        </Select>
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="duplicates-menu-trigger" aria-label={t('patients.duplicates.menu')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="duplicates-export"
                onSelect={() => { downloadPatientDuplicatesCsv().catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))); }}>
                {t('patients.duplicates.export')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">{t('patients.duplicates.empty')}</StripedEmpty>
        )}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('patients.duplicates.col.rule')}</TableHead>
                <TableHead>{t('patients.duplicates.col.evidence')}</TableHead>
                <TableHead>{t('patients.duplicates.col.members')}</TableHead>
                <TableHead>{t('patients.duplicates.col.dismissed')}</TableHead>
                <TableHead className="w-12"><span className="sr-only">{t('patients.rowActions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((g, i) => (
                <TableRow key={`${page}-${i}`} data-testid={`duplicate-row-${i}`} className="cursor-pointer" onClick={() => setSelected(g)}>
                  <TableCell>{ruleLabel(t, g)}</TableCell>
                  <TableCell className="break-all font-mono text-xs">{g.evidence.text}</TableCell>
                  <TableCell>{g.memberCount}</TableCell>
                  <TableCell>{t('patients.duplicates.dismissedOf', { dismissed: g.dismissedPairs, pairs: g.pairs })}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`duplicate-actions-${i}`} aria-label={t('patients.duplicates.actionsFor')}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`duplicate-view-${i}`} onSelect={() => setSelected(g)}>{t('patients.duplicates.view')}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <TablePagination
        page={page} pageSize={pageSize} total={total} onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('patients.duplicates.count', { count: total })}</span>}
      />
      <DuplicateGroupSheet
        group={selected} canManage={canManage} onClose={() => setSelected(null)} onChanged={() => { void load(); }}
        onOpen={(ref) => { setSelected(null); onOpen(ref); }}
      />
    </div>
  );
}

export default DuplicatesTab;
