import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import {
  fetchSyncConfig, saveSyncConfig, fetchSyncStatus, triggerSyncNow, fetchSyncActivity,
  type SyncConfigView, type SyncConfigInput, type SyncMode, type SyncStatus, type SyncDirectionStatus, type SyncActivityRow,
} from '@/api';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/** synced → default (primary), failed → destructive, quarantined/diverged → secondary. */
function eventBadgeVariant(event: SyncActivityRow['event']): BadgeProps['variant'] {
  return event === 'synced' ? 'default' : 'secondary';
}

function EventBadge({ event }: { event: SyncActivityRow['event'] }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={eventBadgeVariant(event)}
      className={event === 'failed' ? 'border-transparent bg-destructive text-destructive-foreground' : undefined}
    >
      {t(`settings.general.sync.event.${event}`)}
    </Badge>
  );
}

function ActivitySheet({ row, onOpenChange }: { row: SyncActivityRow | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={row !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('settings.sync.detailTitle')}</SheetTitle>
          <SheetDescription className="break-all font-mono text-xs">{row?.id}</SheetDescription>
        </SheetHeader>
        {row && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">{t('settings.sync.cols.direction')}</dt>
              <dd className="font-mono">{row.direction}</dd>
              <dt className="text-muted-foreground">{t('settings.sync.cols.event')}</dt>
              <dd><EventBadge event={row.event} /></dd>
              <dt className="text-muted-foreground">{t('settings.sync.cols.records')}</dt>
              <dd className="font-mono">{row.records.toLocaleString()}</dd>
              <dt className="text-muted-foreground">{t('settings.sync.cols.time')}</dt>
              <dd className="font-mono">{formatTimestamp(row.occurredAt)}</dd>
              {row.error && (
                <>
                  <dt className="text-muted-foreground">{t('settings.general.sync.lastError')}</dt>
                  <dd className="whitespace-pre-wrap break-words text-destructive">{row.error}</dd>
                </>
              )}
            </dl>
            {row.metadata && (
              <div className="mt-4">
                <div className="mb-1 font-medium">{t('settings.sync.metadata')}</div>
                <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                  {JSON.stringify(row.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Module level — stable, outside the component. Mirrors the fields the old search box matched.
const SEARCH_FIELDS = [
  (a: SyncActivityRow) => a.direction,
  (a: SyncActivityRow) => a.event,
  (a: SyncActivityRow) => a.error ?? '',
];

type SyncTab = 'settings' | 'activity';

export function DistributedSync() {
  const { t } = useTranslation();
  // Controlled so the ⋯ menu on the tab row can scope its items to the active tab.
  const [tab, setTab] = useState<SyncTab>('settings');
  const [sync, setSync] = useState<SyncConfigView | null>(null);
  // Write-only secret field: blank ⇒ leave the stored secret unchanged (omit from the PUT payload).
  const [secretInput, setSecretInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncActivity, setSyncActivity] = useState<SyncActivityRow[]>([]);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SyncActivityRow | null>(null);

  // Sync status + activity are best-effort telemetry: a transient failure shouldn't surface a toast.
  const refreshStatus = useCallback(async () => {
    try {
      setSyncStatus(await fetchSyncStatus());
      setSyncActivity(await fetchSyncActivity());
    } catch {
      // swallow — telemetry only
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSync(await fetchSyncConfig());
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);
  useEffect(() => { void load(); }, [load]);

  // Poll live status while mounted (config loaded). Cleared on unmount.
  useEffect(() => {
    if (!sync) return;
    const id = setInterval(() => { void refreshStatus(); }, 10_000);
    return () => clearInterval(id);
  }, [sync, refreshStatus]);

  const saveSync = useCallback(async () => {
    if (!sync) return;
    setSyncSaving(true);
    try {
      const input: SyncConfigInput = {
        enabled: sync.enabled,
        mode: sync.mode,
        centralUrl: sync.centralUrl,
        siteId: sync.siteId,
        oidcIssuer: sync.oidcIssuer,
        clientId: sync.clientId,
        intervalMinutes: sync.intervalMinutes,
        // Only send the secret when the operator typed a new one; blank ⇒ preserve the stored value.
        ...(secretInput ? { clientSecret: secretInput } : {}),
        // Round-trip the enrollment-pinned central public key so an unrelated settings save never
        // wipes it. (The server also preserves it when the field is absent, as defense in depth.)
        ...(sync.centralPublicKey ? { centralPublicKey: sync.centralPublicKey } : {}),
      };
      setSync(await saveSyncConfig(input));
      setSecretInput('');
      toast.success(t('settings.general.sync.saved'));
      await refreshStatus();
    } catch (e) {
      toast.error(t('settings.general.sync.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncSaving(false);
    }
  }, [sync, secretInput, t, refreshStatus]);

  const doSyncNow = useCallback(async () => {
    setSyncNowBusy(true);
    try {
      const res = await triggerSyncNow();
      if (res.triggered) toast.success(t('settings.general.sync.triggered'));
      else toast.info(t('settings.general.sync.disabledToast'));
      await refreshStatus();
    } catch (e) {
      toast.error(t('settings.general.sync.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncNowBusy(false);
    }
  }, [t, refreshStatus]);

  // One-line summary of a sync direction: "not started", or "running/idle · seq N · <time>".
  const directionLine = (dir: SyncDirectionStatus | null): string => {
    if (!dir) return t('settings.general.sync.notStarted');
    const state = dir.running ? t('settings.general.sync.running') : t('settings.general.sync.idle');
    const parts = [state, `seq ${dir.lastSeq}`];
    if (dir.lastSyncedAt) parts.push(new Date(dir.lastSyncedAt).toLocaleString());
    if (dir.lastError) parts.push(`⚠ ${dir.lastError}`);
    return parts.join(' · ');
  };

  const columns: ColumnDef<SyncActivityRow>[] = useMemo(() => [
    {
      id: 'direction', labelKey: 'settings.sync.cols.direction', type: 'enum', defaultVisible: true,
      headClassName: 'w-24 text-xs uppercase', cellClassName: 'font-mono text-xs text-muted-foreground',
      accessor: (a) => a.direction,
      // The three values SyncActivityRow declares (api.ts:547) — not an invented vocabulary.
      enumOptions: [
        { value: 'push', label: 'push' },
        { value: 'pull', label: 'pull' },
        { value: 'amend', label: 'amend' },
      ],
    },
    {
      id: 'event', labelKey: 'settings.sync.cols.event', type: 'enum', defaultVisible: true,
      headClassName: 'w-32 text-xs uppercase',
      accessor: (a) => <EventBadge event={a.event} />,
      // The four values SyncActivityRow declares (api.ts:548).
      enumOptions: (['synced', 'failed', 'quarantined', 'diverged'] as const).map((e) => ({
        value: e, labelKey: `settings.general.sync.event.${e}`,
      })),
    },
    {
      id: 'records', labelKey: 'settings.sync.cols.records', type: 'number', defaultVisible: true,
      headClassName: 'w-24 text-right text-xs uppercase', cellClassName: 'text-right font-mono text-xs text-muted-foreground',
      accessor: (a) => a.records.toLocaleString(),
    },
    {
      id: 'detail', labelKey: 'settings.sync.cols.detail', type: 'text', defaultVisible: true,
      headClassName: 'text-xs uppercase', cellClassName: 'max-w-0 truncate text-xs text-muted-foreground',
      accessor: (a) => a.error ?? '—',
    },
    {
      id: 'time', labelKey: 'settings.sync.cols.time', type: 'date', defaultVisible: true,
      headClassName: 'w-44 text-xs uppercase',
      accessor: (a) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatTimestamp(a.occurredAt)}</span>,
    },
  ], []);

  // The accessors render badges and locale-formatted numbers/dates; filtering and sorting must
  // compare the raw values, which is what these getters supply.
  const valueGetters = useMemo(() => ({
    direction: (a: SyncActivityRow) => a.direction,
    event: (a: SyncActivityRow) => a.event,
    records: (a: SyncActivityRow) => a.records,
    detail: (a: SyncActivityRow) => a.error ?? '',
    time: (a: SyncActivityRow) => a.occurredAt,
  }), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  // Free-text search is applied BEFORE applyTableState, never as a filter rule.
  // applyTableState folds rules flat, left-to-right (applyTableState.ts:80-92), so appending a
  // multi-field OR search would discard an active popover filter for rows matching only the
  // trailing OR term. Pre-filtering keeps the semantics `search AND (popover rules)`.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return syncActivity;
    return syncActivity.filter((a) => SEARCH_FIELDS.some((f) => f(a).toLowerCase().includes(q)));
  }, [syncActivity, query]);

  const view = useMemo(
    () => applyTableState(searched, { filters: table.filters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
    [searched, table.filters, table.sorts, table.page, table.pageSize, columns, valueGetters],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="distributed-sync-page">
      {loading ? (
        <LoadingState className="flex-1" label={t('common.loading')} />
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
      ) : sync ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as SyncTab)} className="flex min-h-0 flex-1 flex-col">
          {/* The rule lives on this ROW, not on TabsList, so it runs edge-to-edge beneath both
              the tabs and the ⋯ menu (TabsList's own `border-b` would stop at the last tab).
              The ⋯ holds every action on the page, and its items switch with the active tab. */}
          <div className="mt-4 flex items-center justify-between gap-2 border-b border-border px-4">
            <TabsList className="border-b-0">
              <TabsTrigger value="settings">{t('settings.sync.tabs.settings')}</TabsTrigger>
              <TabsTrigger value="activity">{t('settings.sync.tabs.activity')}</TabsTrigger>
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('common.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {tab === 'settings' ? (
                  <DropdownMenuItem disabled={syncSaving} onClick={() => void saveSync()}>
                    {t('settings.general.sync.save')}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem disabled={syncNowBusy} onClick={() => void doSyncNow()}>
                      {t('settings.general.sync.syncNow')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void refreshStatus()}>
                      {t('settings.sync.refresh')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── Settings tab: the sync config form ───────────────────────────── */}
          <TabsContent value="settings" className="min-h-0 overflow-y-auto p-4">
            <div className="flex flex-col gap-4" data-testid="sync-settings-form">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t('settings.general.sync.enabled.label')}</div>
                  <div className="text-xs text-muted-foreground">{t('settings.general.sync.enabled.description')}</div>
                </div>
                <Switch
                  checked={sync.enabled}
                  onCheckedChange={(v) => setSync({ ...sync, enabled: v })}
                  aria-label={t('settings.general.sync.enabled.label')}
                />
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.mode.label')}</div>
                <Select value={sync.mode} onValueChange={(v) => setSync({ ...sync, mode: v as SyncMode })}>
                  <SelectTrigger className="w-full md:w-96 md:shrink-0" aria-label={t('settings.general.sync.mode.label')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['push', 'pull', 'bidirectional'] as const).map((m) => (
                      <SelectItem key={m} value={m}>{t(`settings.general.sync.mode.${m}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.centralUrl.label')}</div>
                <Input
                  className="w-full md:w-96 md:shrink-0"
                  value={sync.centralUrl}
                  placeholder="https://central.example.org"
                  onChange={(e) => setSync({ ...sync, centralUrl: e.target.value })}
                  aria-label={t('settings.general.sync.centralUrl.label')}
                />
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.siteId.label')}</div>
                <Input
                  className="w-full md:w-96 md:shrink-0"
                  value={sync.siteId}
                  placeholder="lab-site-01"
                  onChange={(e) => setSync({ ...sync, siteId: e.target.value })}
                  aria-label={t('settings.general.sync.siteId.label')}
                />
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.oidcIssuer.label')}</div>
                <Input
                  className="w-full md:w-96 md:shrink-0"
                  value={sync.oidcIssuer}
                  placeholder="https://central.example.org/auth/realms/openldr"
                  onChange={(e) => setSync({ ...sync, oidcIssuer: e.target.value })}
                  aria-label={t('settings.general.sync.oidcIssuer.label')}
                />
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.clientId.label')}</div>
                <Input
                  className="w-full md:w-96 md:shrink-0"
                  value={sync.clientId}
                  placeholder="sync-lab-site-01"
                  onChange={(e) => setSync({ ...sync, clientId: e.target.value })}
                  aria-label={t('settings.general.sync.clientId.label')}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.clientSecret.label')}</div>
                <Input
                  type="password"
                  className="w-full md:w-96 md:shrink-0"
                  value={secretInput}
                  placeholder={sync.clientSecretSet ? t('settings.general.sync.clientSecretSet') : ''}
                  onChange={(e) => setSecretInput(e.target.value)}
                  aria-label={t('settings.general.sync.clientSecret.label')}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.intervalMinutes.label')}</div>
                <Input
                  type="number"
                  min={1}
                  className="w-full md:w-96 md:shrink-0"
                  value={sync.intervalMinutes}
                  onChange={(e) => setSync({ ...sync, intervalMinutes: Number(e.target.value) })}
                  aria-label={t('settings.general.sync.intervalMinutes.label')}
                />
              </div>
            </div>
          </TabsContent>

          {/* ── Activity tab: live status + the recent-activity table ────────── */}
          {/* `data-[state=inactive]:hidden` is required, not decorative: Radix hides an inactive
              panel with the `hidden` attribute, but preflight enforces that via a zero-specificity
              `:where()` rule, so the `flex` class below out-ranks it. Without this the inactive
              panel stays laid out and steals ~385px from the Settings form above. */}
          <TabsContent value="activity" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
            {/* Compact status strip — keeps the vertical budget for the activity table below. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-4 py-2 text-xs">
              <span><span className="text-muted-foreground">{t('settings.general.sync.mode.push')}:</span> <span className="font-mono">{directionLine(syncStatus?.push ?? null)}</span></span>
              <span><span className="text-muted-foreground">{t('settings.general.sync.mode.pull')}:</span> <span className="font-mono">{directionLine(syncStatus?.pull ?? null)}</span></span>
              <span><span className="text-muted-foreground">{t('settings.general.sync.pending')}:</span> <span className="font-mono">{syncStatus?.pendingPush ?? 0}</span></span>
              <span>
                <span className="text-muted-foreground">{t('settings.general.sync.lastChecked')}:</span>{' '}
                <span className="font-mono">
                  {syncStatus?.push?.lastAttemptAt || syncStatus?.pull?.lastAttemptAt
                    ? new Date((syncStatus?.push?.lastAttemptAt ?? syncStatus?.pull?.lastAttemptAt) as string).toLocaleString()
                    : t('settings.general.sync.never')}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">{t('settings.general.sync.lastSuccess')}:</span>{' '}
                <span className="font-mono">
                  {syncStatus?.push?.lastSuccessAt || syncStatus?.pull?.lastSuccessAt
                    ? new Date((syncStatus?.push?.lastSuccessAt ?? syncStatus?.pull?.lastSuccessAt) as string).toLocaleString()
                    : t('settings.general.sync.never')}
                </span>
              </span>
            </div>

            {/* Recent activity toolbar. Sync now / Refresh live on the tab row's ⋯ menu, which
                serves both tabs, so the toolbar's actions slot carries the ordering note instead. */}
            <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
              <DataTableToolbar
                columns={columns}
                filters={table.filters}
                onFiltersChange={table.setFilters}
                sorts={table.sorts}
                onSortsChange={table.setSorts}
                visibleIds={table.visibleIds}
                onVisibleIdsChange={table.setVisibleIds}
                onResetColumns={table.resetColumns}
                onResetAll={() => { table.resetAll(); setQuery(''); }}
                searchValue={query}
                onSearchChange={(v) => { setQuery(v); table.setPage(0); }}
                searchPlaceholder={t('settings.sync.searchPlaceholder')}
                actions={<span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{t('settings.sync.newestFirst')}</span>}
              />
              <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
            </div>

            {/* Recent activity table */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Rendered only when populated: an empty table's five header cells force intrinsic
                  width and scroll the pane sideways on a phone (AGENTS.md §6). */}
              {view.rows.length > 0 && (
              <Table wrapperClassName="min-h-0 flex-1">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                  </TableRow>
                </TableHeader>
                  <TableBody className="[&_tr:last-child]:border-b">
                    {view.rows.map((a) => (
                      <TableRow
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        aria-label={t('settings.sync.openDetail')}
                        className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)] focus-visible:bg-[rgba(70,130,180,0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => setSelected(a)}
                        onKeyDown={(e) => {
                          // Keyboard parity with the click handler: Enter/Space open the detail sheet.
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(a);
                          }
                        }}
                        title={t('settings.sync.openDetail')}
                      >
                        {table.visibleColumns.map((c) => (
                          <TableCell key={c.id} className={c.cellClassName} title={c.id === 'detail' ? a.error ?? undefined : undefined}>
                            {c.accessor(a)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
              </Table>
              )}
              {view.rows.length === 0 && (
                syncActivity.length === 0 ? (
                  <EmptyState icon={<RefreshCw className="h-6 w-6" />} title={t('settings.sync.empty')} />
                ) : (
                  <StripedEmpty className="flex-1">{t('settings.sync.noMatch')}</StripedEmpty>
                )
              )}
            </div>

            <TablePagination
              page={table.page}
              pageSize={table.pageSize}
              total={view.total}
              onPageChange={table.setPage}
              onPageSizeChange={table.setPageSize}
              leftSlot={<span className="text-muted-foreground">{t('settings.sync.count', { count: view.total })}</span>}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      <ActivitySheet row={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
