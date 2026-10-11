import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import {
  downloadTestMappingsCsv, listObservedTestCodes, rebuildTestMap,
  type ObservedStatus, type ObservedTestCode, type ObservedTestCodesResult,
} from '@/api';
import { MapCodeSheet } from './MapCodeSheet';
import { ImportMappingsSheet } from './ImportMappingsSheet';

// The Observed tab of the Test catalog page (docs/superpowers/specs/2026-10-11-test-mapping-design.md,
// 4.4). Layout copied from facilities/ObservedTab.tsx and pages/TestCatalog.tsx.

const STATUSES: Array<ObservedStatus | 'all'> = ['all', 'unmapped', 'mapped', 'ambiguous'];

export function ObservedCodesTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ObservedStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<ObservedTestCodesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ObservedTestCode | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => { setQ(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Only the latest request may write state. A slower earlier response must not overwrite a newer one.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listObservedTestCodes({ status, q: q || undefined, limit: pageSize, offset: page * pageSize });
      if (mine === latest.current) setData(result);
    } catch (e) {
      if (mine === latest.current) {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [status, q, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const rebuild = async () => {
    try {
      const out = await rebuildTestMap();
      if (out.ok) toast.success(t('testCatalog.observed.rebuilt', { count: out.result.written }));
      else toast.error(out.error);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const rows = data?.rows ?? [];
  const statusLabel = (s: ObservedStatus): string => t(`testCatalog.observed.status.${s}`);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="observed-codes-tab">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('testCatalog.observed.searchPlaceholder')}
          className="h-8 sm:max-w-xs"
          data-testid="observed-search"
        />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('testCatalog.observed.statusFilter')}>
          {STATUSES.map((s) => (
            <Button
              key={s}
              variant={status === s ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              data-testid={`observed-status-${s}`}
              aria-pressed={status === s}
              onClick={() => { setStatus(s); setPage(0); }}
            >
              {t(`testCatalog.observed.status.${s}`)}
            </Button>
          ))}
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="observed-menu-trigger" aria-label={t('testCatalog.observed.menuLabel')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="observed-export"
                  onSelect={() => { downloadTestMappingsCsv().catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); }); }}
                >
                  {t('testCatalog.observed.exportAction')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="observed-import" onSelect={() => setImporting(true)}>
                  {t('testCatalog.observed.importAction')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="observed-rebuild" onSelect={() => void rebuild()}>
                  {t('testCatalog.observed.rebuildAction')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {data?.warehouse.stale && (
        <div className="border-b border-border px-4 py-2 text-xs text-destructive" data-testid="observed-stale">
          {t('testCatalog.observed.stale', { error: data.warehouse.error ?? '' })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">
            {q !== '' || status !== 'all' ? t('testCatalog.observed.noMatch') : t('testCatalog.observed.empty')}
          </StripedEmpty>
        )}
        {/* Rendered only when populated: an empty table's header forces intrinsic width and scrolls a
            phone sideways (AGENTS.md section 6). */}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('testCatalog.observed.col.code')}</TableHead>
                <TableHead>{t('testCatalog.observed.col.description')}</TableHead>
                <TableHead className="text-right">{t('testCatalog.observed.col.requests')}</TableHead>
                <TableHead>{t('testCatalog.observed.col.catalog')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.observed.col.system')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('testCatalog.observed.col.lastSeen')}</TableHead>
                {canManage && <TableHead className="w-12"><span className="sr-only">{t('testCatalog.observed.rowActions')}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((r) => (
                <TableRow key={`${r.system}|${r.code}`} data-testid={`observed-row-${r.code}`}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.description ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                  <TableCell>
                    {r.status === 'mapped' && r.catalog ? (
                      <div className="flex flex-col">
                        <span>{r.catalog.name ?? r.catalog.code}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.catalog.code} · {r.catalog.loinc ?? t('testCatalog.observed.noLoinc')}
                        </span>
                      </div>
                    ) : (
                      <Badge variant="outline" className={r.status === 'ambiguous' ? 'border-destructive text-destructive' : undefined}>
                        {statusLabel(r.status)}
                      </Badge>
                    )}
                    {r.centralManaged && <Badge variant="secondary" className="ml-2">{t('testCatalog.observed.central')}</Badge>}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{r.system}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.lastSeen ? r.lastSeen.slice(0, 10) : ''}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                              data-testid={`observed-actions-${r.code}`}
                              aria-label={t('testCatalog.observed.actionsFor', { code: r.code })}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem data-testid={`observed-map-${r.code}`} onSelect={() => setMapping(r)}>
                              {t('testCatalog.observed.mapAction')}
                            </DropdownMenuItem>
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
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('testCatalog.observed.count', { count: data?.total ?? 0 })}</span>}
      />

      <MapCodeSheet target={mapping} onClose={() => setMapping(null)} onSaved={() => { void load(); }} />
      <ImportMappingsSheet open={importing} onClose={() => setImporting(false)} onImported={() => { void load(); }} />
    </div>
  );
}

export default ObservedCodesTab;
