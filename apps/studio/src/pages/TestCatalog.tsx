import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActiveFilterChips, DataTableToolbar, useTableState, type ColumnDef } from '@/components/data-table';
import { useAuth } from '@/auth/AuthProvider';
import {
  getTestCatalogOptions, downloadTestCatalogCsv, listTestCatalog, setCatalogTestActive, setCatalogTestEnabled,
  type CatalogTest, type TestCatalogOptions,
} from '@/api';
import { translateFilters } from '@/test-catalog/catalogFilters';
import { TestSheet, type TestSheetTarget } from '@/test-catalog/TestSheet';

// Test catalog S2 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.3). Server-paged with
// named filters, as Notifications.tsx is. The toolbar menu, row menu and empty state copy
// Connectors.tsx (AGENTS.md section 5). Facilities.tsx is not copied: it keeps its own pager and
// EmptyState.

const SEARCH_DEBOUNCE_MS = 250;
const NO_OPTIONS: TestCatalogOptions = { categories: [], specimenTypes: [], loinc: null };

function codingKey(c: { system: string; code: string }): string {
  return `${c.system}|${c.code}`;
}

export function TestCatalog() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const canManage = hasCapability('terminology.manage');

  const [options, setOptions] = useState<TestCatalogOptions>(NO_OPTIONS);
  const [rows, setRows] = useState<CatalogTest[]>([]);
  const [total, setTotal] = useState(0);
  const [ownedHere, setOwnedHere] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<TestSheetTarget | null>(null);

  useEffect(() => {
    getTestCatalogOptions()
      .then(setOptions)
      .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, []);

  const categoryLabel = useMemo(
    () => new Map(options.categories.map((c) => [c.code, c.display ?? c.code])),
    [options],
  );
  const specimenLabel = useMemo(
    () => new Map(options.specimenTypes.map((s) => [codingKey(s), s.display ?? s.code])),
    [options],
  );
  const specimenNames = useCallback(
    (list: { system: string; code: string }[]) => list.map((s) => specimenLabel.get(codingKey(s)) ?? s.code).join(', '),
    [specimenLabel],
  );

  // Every column is sortable: false, because the API orders by code and takes no sort. The four
  // filterable columns offer only `eq`, which translateFilters turns into named parameters.
  const columns = useMemo<ColumnDef<CatalogTest>[]>(() => [
    {
      id: 'code', labelKey: 'testCatalog.col.code', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      // A code never breaks across lines; the table's own frame scrolls sideways instead.
      cellClassName: 'whitespace-nowrap font-mono text-xs', accessor: (r) => r.code,
    },
    {
      id: 'name', labelKey: 'testCatalog.col.name', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-2">
            {r.display}
            {!r.active && <Badge variant="outline">{t('testCatalog.retired')}</Badge>}
          </span>
          {r.lab.localDisplay && (
            <span className="text-xs text-muted-foreground">{t('testCatalog.thisLab', { value: r.lab.localDisplay })}</span>
          )}
        </div>
      ),
    },
    {
      id: 'category', labelKey: 'testCatalog.col.category', type: 'enum', defaultVisible: true, sortable: false,
      operators: ['eq'],
      enumOptions: options.categories.map((c) => ({ value: c.code, label: c.display ?? c.code })),
      accessor: (r) => (r.category ? categoryLabel.get(r.category) ?? r.category : t('testCatalog.none')),
    },
    {
      id: 'specimens', labelKey: 'testCatalog.col.specimens', type: 'text', defaultVisible: true, filterable: false,
      sortable: false,
      accessor: (r) => (
        <div className="flex flex-col">
          <span>{r.specimenTypes.length ? specimenNames(r.specimenTypes) : t('testCatalog.none')}</span>
          {r.lab.specimenTypes && (
            <span className="text-xs text-muted-foreground">{t('testCatalog.thisLab', { value: specimenNames(r.lab.specimenTypes) })}</span>
          )}
        </div>
      ),
    },
    {
      id: 'loinc', labelKey: 'testCatalog.col.loinc', type: 'enum', defaultVisible: true, sortable: false, operators: ['eq'],
      cellClassName: 'whitespace-nowrap',
      enumOptions: [
        { value: 'linked', labelKey: 'testCatalog.loincLinked' },
        { value: 'none', labelKey: 'testCatalog.noLoinc' },
      ],
      accessor: (r) => (r.loinc
        ? <span className="font-mono text-xs">{r.loinc}</span>
        : <Badge variant="outline">{t('testCatalog.noLoinc')}</Badge>),
    },
    {
      id: 'enabled', labelKey: 'testCatalog.col.enabled', type: 'enum', defaultVisible: true, sortable: false,
      operators: ['eq'],
      enumOptions: [{ value: 'on', labelKey: 'testCatalog.on' }, { value: 'off', labelKey: 'testCatalog.off' }],
      accessor: (r) => (r.lab.enabled ? t('testCatalog.on') : t('testCatalog.off')),
    },
    {
      id: 'status', labelKey: 'testCatalog.col.status', type: 'enum', defaultVisible: false, sortable: false,
      operators: ['eq'],
      enumOptions: [{ value: 'active', labelKey: 'testCatalog.active' }, { value: 'retired', labelKey: 'testCatalog.retired' }],
      accessor: (r) => (r.active ? t('testCatalog.active') : t('testCatalog.retired')),
    },
  ], [t, options, categoryLabel, specimenNames]);

  const table = useTableState({ columns, defaultPageSize: 25 });
  const { setPage } = table;

  // The search waits for a pause in typing before it asks the server, and goes back to page one.
  // An unchanged search sets no timer, so it never resets a page the operator just moved to.
  useEffect(() => {
    const next = search.trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => { setQ(next); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q, setPage]);

  const filters = useMemo(() => translateFilters(table.filters), [table.filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listTestCatalog({
        q: q || undefined, ...filters, limit: table.pageSize, offset: table.page * table.pageSize,
      });
      setRows(result.rows);
      setTotal(result.total);
      setOwnedHere(result.ownedHere);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, filters, table.page, table.pageSize]);

  useEffect(() => { void load(); }, [load]);

  const runRowAction = useCallback(async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  const hasFilters = q !== '' || table.filters.length > 0;

  return (
    <AppShell title={t('testCatalog.title')} fullBleed>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="test-catalog-page">
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
            searchPlaceholder={t('testCatalog.searchPlaceholder')}
            actions={canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8"
                    data-testid="test-catalog-menu-trigger" aria-label={t('testCatalog.menuLabel')}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ownedHere && (
                    <DropdownMenuItem data-testid="add-test" onSelect={() => setSheet({ kind: 'create' })}>
                      {t('testCatalog.add')}
                    </DropdownMenuItem>
                  )}
                  {/* Any install can export, a lab that receives central's catalog included. */}
                  <DropdownMenuItem
                    data-testid="export-tests"
                    onSelect={() => {
                      downloadTestCatalogCsv().catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
                    }}
                  >
                    {t('testCatalog.exportAction')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : undefined}
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
          {!ownedHere && <div className="text-xs text-muted-foreground">{t('testCatalog.fromCentral')}</div>}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
          {!loading && error && (
            <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <StripedEmpty className="min-h-[16rem] flex-1">
              {hasFilters ? t('testCatalog.noMatch') : t('testCatalog.empty')}
            </StripedEmpty>
          )}
          {/* Rendered only when populated: an empty table's header cells force intrinsic width and
              scroll the pane sideways on a phone (AGENTS.md section 6). The table's own wrapper
              scrolls sideways when the columns do not fit. */}
          {!loading && !error && rows.length > 0 && (
            <Table wrapperClassName="min-h-0 flex-1">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                  {canManage && (
                    <TableHead className="w-12"><span className="sr-only">{t('testCatalog.rowActions')}</span></TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((r) => (
                  <TableRow key={r.code} data-testid={`test-row-${r.code}`}>
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                                data-testid={`test-actions-${r.code}`}
                                aria-label={t('testCatalog.actionsFor', { code: r.code })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem data-testid={`test-edit-${r.code}`} onSelect={() => setSheet({ kind: 'edit', test: r })}>
                                {t('testCatalog.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`test-switch-${r.code}`}
                                onSelect={() => void runRowAction(
                                  () => setCatalogTestEnabled(r.code, !r.lab.enabled),
                                  t(r.lab.enabled ? 'testCatalog.switchedOff' : 'testCatalog.switchedOn', { code: r.code }),
                                )}
                              >
                                {r.lab.enabled ? t('testCatalog.switchOff') : t('testCatalog.switchOn')}
                              </DropdownMenuItem>
                              {ownedHere && (
                                <DropdownMenuItem
                                  data-testid={`test-retire-${r.code}`}
                                  onSelect={() => void runRowAction(
                                    () => setCatalogTestActive(r.code, !r.active),
                                    t(r.active ? 'testCatalog.retiredToast' : 'testCatalog.restoredToast', { code: r.code }),
                                  )}
                                >
                                  {r.active ? t('testCatalog.retire') : t('testCatalog.restore')}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
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
          leftSlot={<span className="text-muted-foreground">{t('testCatalog.count', { count: total })}</span>}
        />

        <TestSheet
          target={sheet}
          options={options}
          ownedHere={ownedHere}
          onClose={() => setSheet(null)}
          onSaved={() => { void load(); }}
        />
      </div>
    </AppShell>
  );
}
