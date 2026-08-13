import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity as ActivityIcon, MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { cn } from '@/lib/cn';
import { fetchActivity, fetchLifecycle, type Lifecycle, type RecentPayload } from '@/api';

/** Fixed stage order of the payload lifecycle. */
const STAGES = ['received', 'validated', 'persisted', 'pushed'] as const;
type StageName = (typeof STAGES)[number];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/** complete → default (primary), stuck → secondary, failed → destructive. */
function statusBadgeVariant(status: string): BadgeProps['variant'] {
  return status === 'complete' ? 'default' : 'secondary';
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`activity.status.${status}`, status);
  const destructive = status === 'failed';
  return (
    <Badge
      variant={statusBadgeVariant(status)}
      className={destructive ? 'border-transparent bg-destructive text-destructive-foreground' : undefined}
    >
      {label}
    </Badge>
  );
}

/**
 * Presentational stage indicator: the four lifecycle stages in order, with the
 * `current` stage (and everything before it) highlighted.
 */
function StageBar({ current }: { current: string }) {
  const { t } = useTranslation();
  const currentIndex = STAGES.indexOf(current as StageName);
  return (
    <div className="flex items-center gap-1" aria-label={t('activity.stages')}>
      {STAGES.map((stage, i) => {
        const reached = currentIndex >= 0 && i <= currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <span
            key={stage}
            title={t(`activity.stage.${stage}`)}
            className={cn(
              'h-1.5 w-6 rounded-full transition-colors',
              reached ? 'bg-primary' : 'bg-muted',
              isCurrent && 'ring-2 ring-primary/30',
            )}
          />
        );
      })}
    </div>
  );
}

function LifecycleSheet({
  correlationId,
  lifecycle,
  onOpenChange,
}: {
  correlationId: string | null;
  lifecycle: Lifecycle | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={correlationId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('activity.detailTitle')}</SheetTitle>
          <SheetDescription className="break-all font-mono text-xs">{correlationId}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!lifecycle ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : lifecycle.stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('activity.noStages')}</p>
          ) : (
            <ol className="space-y-4">
              {lifecycle.stages.map((s, i) => (
                <li key={`${s.stage}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                        s.status === 'failed' ? 'bg-destructive' : 'bg-primary',
                      )}
                    />
                    {i < lifecycle.stages.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t(`activity.stage.${s.stage}`, s.stage)}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{formatTimestamp(s.at)}</span>
                    </div>
                    {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                    {s.runId && (
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {t('activity.run')}: {s.runId}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Module level — stable, outside the component.
const SEARCH_FIELDS = [
  (p: RecentPayload) => p.correlationId,
  (p: RecentPayload) => p.source ?? '',
  (p: RecentPayload) => p.status,
  (p: RecentPayload) => p.currentStage,
];

export function Activity() {
  const { t } = useTranslation();
  const [payloads, setPayloads] = useState<RecentPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayloads(await fetchActivity(200));
    } catch (e) {
      setPayloads([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const columns: ColumnDef<RecentPayload>[] = useMemo(() => [
    {
      id: 'payload', labelKey: 'activity.colPayload', type: 'text', defaultVisible: true, headClassName: 'text-xs uppercase',
      accessor: (p) => <span className="font-mono text-xs text-muted-foreground" title={p.correlationId}>{p.correlationId}</span>,
    },
    {
      id: 'source', labelKey: 'activity.colSource', type: 'text', defaultVisible: true, headClassName: 'w-44 text-xs uppercase',
      accessor: (p) => <span className="text-sm">{p.source ?? t('activity.noSource')}</span>,
    },
    {
      id: 'started', labelKey: 'activity.colStarted', type: 'date', defaultVisible: true, headClassName: 'w-48 text-xs uppercase',
      accessor: (p) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatTimestamp(p.startedAt)}</span>,
    },
    {
      id: 'stage', labelKey: 'activity.colStage', type: 'text', defaultVisible: true, headClassName: 'w-44 text-xs uppercase',
      accessor: (p) => (
        <div className="flex items-center gap-2">
          <StageBar current={p.currentStage} />
          <span className="text-[11px] text-muted-foreground">{t(`activity.stage.${p.currentStage}`, p.currentStage)}</span>
        </div>
      ),
    },
    {
      id: 'status', labelKey: 'activity.colStatus', type: 'enum', defaultVisible: true, headClassName: 'w-28 text-xs uppercase',
      accessor: (p) => <StatusBadge status={p.status} />,
      enumOptions: [
        { value: 'complete', labelKey: 'activity.status.complete' },
        { value: 'stuck', labelKey: 'activity.status.stuck' },
        { value: 'failed', labelKey: 'activity.status.failed' },
      ],
    },
  ], [t]);

  const valueGetters = useMemo(() => ({
    payload: (p: RecentPayload) => p.correlationId,
    source: (p: RecentPayload) => p.source ?? '',
    started: (p: RecentPayload) => p.startedAt,
    stage: (p: RecentPayload) => p.currentStage,
    status: (p: RecentPayload) => p.status,
  }), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  // Free-text search is applied BEFORE applyTableState, never as a filter rule.
  // applyTableState folds rules flat, left-to-right (applyTableState.ts:80-92), so appending a
  // search rule would discard an active popover filter. Pre-filtering keeps the semantics
  // `search AND (popover rules)`.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payloads;
    return payloads.filter((p) => SEARCH_FIELDS.some((f) => (f(p) ?? '').toLowerCase().includes(q)));
  }, [payloads, search]);

  const view = useMemo(
    () => applyTableState(searched, { filters: table.filters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
    [searched, table.filters, table.sorts, table.page, table.pageSize, columns, valueGetters],
  );

  const openPayload = useCallback(async (correlationId: string) => {
    setSelectedId(correlationId);
    setLifecycle(null);
    try {
      setLifecycle(await fetchLifecycle(correlationId));
    } catch {
      setLifecycle(null);
    }
  }, []);

  return (
    <AppShell title={t('nav.activity')} fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
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
            onSearchChange={(v) => { setSearch(v); table.setPage(0); }}
            searchPlaceholder={t('activity.searchPlaceholder')}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Activity actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { void load(); }}>{t('activity.refresh')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Table wrapperClassName={view.rows.length > 0 ? 'min-h-0 flex-1' : undefined}>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
              </TableRow>
            </TableHeader>
            {!loading && !error && view.rows.length > 0 && (
            <TableBody className="[&_tr:last-child]:border-b">
                {view.rows.map((p) => (
                  <TableRow
                    key={p.correlationId}
                    className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    onClick={() => { void openPayload(p.correlationId); }}
                    title={t('activity.openDetail')}
                  >
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(p)}</TableCell>)}
                  </TableRow>
                ))}
            </TableBody>
            )}
          </Table>
          {loading && <LoadingState className="flex-1" label={t('common.loading')} />}
          {!loading && error && <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && view.rows.length === 0 && (
            payloads.length === 0 ? (
              <EmptyState icon={<ActivityIcon className="h-6 w-6" />} title={t('activity.empty')} />
            ) : (
              <StripedEmpty className="flex-1">{t('activity.noMatch')}</StripedEmpty>
            )
          )}
        </div>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={view.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          leftSlot={<span className="text-muted-foreground">{t('activity.count', { count: view.total })}</span>}
        />

        <LifecycleSheet
          correlationId={selectedId}
          lifecycle={lifecycle}
          onOpenChange={(open) => { if (!open) { setSelectedId(null); setLifecycle(null); } }}
        />
      </div>
    </AppShell>
  );
}
