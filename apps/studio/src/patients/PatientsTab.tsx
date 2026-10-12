import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ActiveFilterChips, DataTableToolbar, useTableState, type ColumnDef, type FilterRule } from '@/components/data-table';
import { listPatients, type PatientRow } from '@/api';

// The Patients tab (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 3). Copies
// TestCatalog.tsx's tests tab. Read-only, so it has no header menu. The server masks; this tab only
// changes its placeholder and shows a note when the list came back masked.

const SEARCH_DEBOUNCE_MS = 250;

function statusFrom(filters: FilterRule[]): 'active' | 'merged' | 'all' {
  const f = filters.find((r) => r.column === 'status' && r.operator === 'eq' && typeof r.value === 'string');
  return f?.value === 'merged' ? 'merged' : f?.value === 'all' ? 'all' : 'active';
}

export function PatientsTab({ onOpen }: { onOpen: (ref: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [masked, setMasked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  const columns = useMemo<ColumnDef<PatientRow>[]>(() => [
    {
      id: 'name', labelKey: 'patients.col.name', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => (
        <span className="flex items-center gap-2">
          {r.name ?? ''}
          {(!r.active || r.replacedByRef) && <Badge variant="outline">{t('patients.status.merged')}</Badge>}
        </span>
      ),
    },
    { id: 'sex', labelKey: 'patients.col.sex', type: 'text', defaultVisible: true, filterable: false, sortable: false, accessor: (r) => r.sex ?? '' },
    { id: 'age', labelKey: 'patients.col.age', type: 'text', defaultVisible: true, filterable: false, sortable: false, accessor: (r) => (r.ageYears === null ? '' : String(r.ageYears)) },
    {
      id: 'identifiers', labelKey: 'patients.col.identifiers', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => (
        <div className="flex flex-col">
          {r.identifiers.map((i) => (
            <span key={`${i.system ?? ''}|${i.value}`} className="whitespace-nowrap text-xs">
              <span className="text-muted-foreground">{i.label ?? i.system ?? t('patients.noSystem')}: </span>
              <span className="font-mono">{i.value}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      id: 'facility', labelKey: 'patients.col.facility', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => r.managingFacility?.name ?? r.managingFacility?.reference ?? '',
    },
    { id: 'lastRequest', labelKey: 'patients.col.lastRequest', type: 'text', defaultVisible: true, filterable: false, sortable: false, cellClassName: 'whitespace-nowrap', accessor: (r) => r.lastRequestAt ?? '' },
    { id: 'requests', labelKey: 'patients.col.requests', type: 'text', defaultVisible: true, filterable: false, sortable: false, accessor: (r) => String(r.requestCount) },
    {
      id: 'status', labelKey: 'patients.col.status', type: 'enum', defaultVisible: false, sortable: false, operators: ['eq'],
      enumOptions: [{ value: 'active', labelKey: 'patients.status.active' }, { value: 'merged', labelKey: 'patients.status.merged' }],
      accessor: (r) => (r.active && !r.replacedByRef ? t('patients.status.active') : t('patients.status.merged')),
    },
  ], [t]);

  const table = useTableState({ columns, defaultPageSize: 25 });
  const { setPage } = table;

  useEffect(() => {
    const next = search.trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => { setQ(next); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q, setPage]);

  const status = useMemo(() => statusFrom(table.filters), [table.filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await listPatients({ search: q || undefined, status, limit: table.pageSize, offset: table.page * table.pageSize });
      setRows(out.rows);
      setTotal(out.total);
      setMasked(out.masked);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, table.page, table.pageSize]);

  useEffect(() => { void load(); }, [load]);

  const hasFilters = q !== '' || table.filters.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="patients-page">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:gap-2 sm:py-2">
        <DataTableToolbar
          columns={columns}
          filters={table.filters}
          onFiltersChange={table.setFilters}
          sorts={table.sorts}
          onSortsChange={table.setSorts}
          visibleIds={table.visibleIds}
          onVisibleIdsChange={table.setVisibleIds}
          onResetColumns={table.resetColumns}
          onResetAll={() => { table.resetAll(); setSearch(''); }}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={masked ? t('patients.searchPlaceholderMasked') : t('patients.searchPlaceholder')}
        />
        <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
        {masked && <div className="text-xs text-muted-foreground">{t('patients.maskedNote')}</div>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">{hasFilters ? t('patients.noMatch') : t('patients.empty')}</StripedEmpty>
        )}
        {/* Rendered only when populated: an empty table's header scrolls a phone sideways (AGENTS.md section 6). */}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="w-12"><span className="sr-only">{t('patients.rowActions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((r) => (
                <TableRow key={r.ref} data-testid={`patient-row-${r.ref}`} className="cursor-pointer" onClick={() => onOpen(r.ref)}>
                  {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`patient-actions-${r.ref}`} aria-label={t('patients.actionsFor')}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`patient-view-${r.ref}`} onSelect={() => onOpen(r.ref)}>{t('patients.view')}</DropdownMenuItem>
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
        page={table.page}
        pageSize={table.pageSize}
        total={total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        leftSlot={<span className="text-muted-foreground">{t('patients.count', { count: total })}</span>}
      />
    </div>
  );
}
