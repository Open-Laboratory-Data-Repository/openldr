import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, MoreHorizontal, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { SettingsHeader } from './SettingsHeader';
import { fetchSites, enrollSite, rotateSite, revokeSite, downloadCentralCertificate, type SyncSiteRow, type EnrollResult } from '@/api';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// Module level — stable, outside the component.
const SEARCH_FIELDS = [
  (s: SyncSiteRow) => s.siteId,
  (s: SyncSiteRow) => s.name ?? '',
  (s: SyncSiteRow) => s.clientId,
];

/** The one-time secret payload — the shape shared by enroll (full) and rotate (clientId+secret). */
interface Reveal {
  clientId: string;
  clientSecret: string;
  oidcIssuer?: string;
  centralUrl?: string;
}

export function Sites() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SyncSiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [search, setSearch] = useState('');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [centralUrl, setCentralUrl] = useState('');
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [pendingRotate, setPendingRotate] = useState<SyncSiteRow | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<SyncSiteRow | null>(null);

  const showError = useCallback((e: unknown) => {
    const status = (e as { status?: number }).status;
    if (status === 409) toast.error(t('sites.errAlreadyEnrolled'));
    else if (status === 400) toast.error(t('sites.errInvalid'));
    else if (status === 503) toast.error(t('sites.errNotConfigured'));
    else if (status === 404) toast.error(t('sites.errNotFound'));
    else toast.error(t('sites.errorToast', { error: e instanceof Error ? e.message : String(e) }));
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try { setRows(await fetchSites()); }
    catch (e) { setErrored(true); showError(e); }
    finally { setLoading(false); }
  }, [showError]);
  useEffect(() => { void load(); }, [load]);

  const openEnroll = () => { setSiteId(''); setName(''); setCentralUrl(''); setEnrollOpen(true); };

  const doEnroll = useCallback(async () => {
    if (busy || !siteId.trim() || !centralUrl.trim()) return;
    setBusy(true);
    try {
      const r: EnrollResult = await enrollSite({ siteId: siteId.trim(), name: name.trim() || undefined, centralUrl: centralUrl.trim() });
      setEnrollOpen(false);
      setReveal({ clientId: r.clientId, clientSecret: r.clientSecret, oidcIssuer: r.oidcIssuer, centralUrl: r.centralUrl });
      toast.success(t('sites.enrolledToast', { siteId: r.siteId }));
      await load();
    } catch (e) { showError(e); }
    finally { setBusy(false); }
  }, [busy, siteId, name, centralUrl, t, load, showError]);

  const doRotate = useCallback(async () => {
    if (!pendingRotate) return;
    const site = pendingRotate;
    setPendingRotate(null);
    try {
      const r = await rotateSite(site.siteId);
      setReveal({ clientId: r.clientId, clientSecret: r.clientSecret });
      toast.success(t('sites.rotatedToast', { siteId: site.siteId }));
    } catch (e) { showError(e); }
  }, [pendingRotate, t, showError]);

  const doRevoke = useCallback(async () => {
    if (!pendingRevoke) return;
    const site = pendingRevoke;
    setPendingRevoke(null);
    try {
      await revokeSite(site.siteId);
      toast.success(t('sites.revokedToast', { siteId: site.siteId }));
      await load();
    } catch (e) { showError(e); }
  }, [pendingRevoke, t, load, showError]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast.success(t('sites.copiedToast')),
      () => toast.error(t('sites.copyFailedToast')),
    );
  }, [t]);

  const doDownloadCert = useCallback(async () => {
    try { await downloadCentralCertificate(); toast.success(t('sites.certDownloadedToast')); }
    catch { toast.error(t('sites.certDownloadFailed')); }
  }, [t]);

  const columns: ColumnDef<SyncSiteRow>[] = useMemo(() => [
    { id: 'siteId', labelKey: 'sites.siteId', type: 'text', defaultVisible: true, cellClassName: 'font-medium', accessor: (s) => s.siteId },
    {
      id: 'name', labelKey: 'sites.name', type: 'text', defaultVisible: true,
      accessor: (s) => s.name || <span className="text-muted-foreground">-</span>,
    },
    { id: 'clientId', labelKey: 'sites.clientId', type: 'text', defaultVisible: true, cellClassName: 'font-mono text-xs text-muted-foreground', accessor: (s) => s.clientId },
    {
      id: 'status', labelKey: 'sites.status', type: 'enum', defaultVisible: true, headClassName: 'w-24',
      accessor: (s) => (s.status === 'active'
        ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">{t('sites.statusActive')}</Badge>
        : <Badge variant="outline" className="text-muted-foreground">{t('sites.statusRevoked')}</Badge>),
      // The two values SyncSiteRow declares (api.ts:575) — not an invented vocabulary.
      enumOptions: [
        { value: 'active', label: t('sites.statusActive') },
        { value: 'revoked', label: t('sites.statusRevoked') },
      ],
    },
    {
      id: 'enrolledAt', labelKey: 'sites.enrolledAt', type: 'date', defaultVisible: true, headClassName: 'w-40',
      cellClassName: 'text-xs text-muted-foreground', accessor: (s) => formatDate(s.enrolledAt),
    },
  ], [t]);

  // The accessors render nodes and locale-formatted dates; filtering and sorting must compare the
  // raw values, which is what these getters supply.
  const valueGetters = useMemo(() => ({
    siteId: (s: SyncSiteRow) => s.siteId,
    name: (s: SyncSiteRow) => s.name ?? '',
    clientId: (s: SyncSiteRow) => s.clientId,
    status: (s: SyncSiteRow) => s.status,
    enrolledAt: (s: SyncSiteRow) => s.enrolledAt,
  }), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  // Free-text search is applied BEFORE applyTableState, never as a filter rule.
  // applyTableState folds rules flat, left-to-right (applyTableState.ts:80-92), so appending a
  // multi-field OR search would discard an active popover filter for rows matching only the
  // trailing OR term. Pre-filtering keeps the semantics `search AND (popover rules)`.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => SEARCH_FIELDS.some((f) => f(r).toLowerCase().includes(q)));
  }, [rows, search]);

  const view = useMemo(
    () => applyTableState(searched, { filters: table.filters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
    [searched, table.filters, table.sorts, table.page, table.pageSize, columns, valueGetters],
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <SettingsHeader description={t('sites.subtitle')} />

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
            onSearchChange={(v) => { setSearch(v); table.setPage(0); }}
            searchPlaceholder={t('sites.searchPlaceholder')}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('sites.actions')}><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={openEnroll}>{t('sites.enroll')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void doDownloadCert()}>{t('sites.downloadCert')}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { void load(); }}>{t('sites.refresh')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* The table renders ONLY when populated. Its six header cells have an intrinsic width
              of ~396px, so keeping the header around for an empty list forces the region to
              scroll sideways on any phone narrower than that — for a table with no data in it. */}
          {!loading && !errored && view.rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
                {view.rows.map((s) => (
                  <TableRow key={s.siteId}>
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(s)}</TableCell>)}
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t('sites.actionsFor', { siteId: s.siteId })}><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPendingRotate(s)}>{t('sites.rotate')}</DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={s.status === 'revoked'}
                              className="text-destructive focus:text-destructive"
                              onClick={() => { if (s.status !== 'revoked') setPendingRevoke(s); }}
                            >
                              {t('sites.revoke')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          )}
          {loading && <LoadingState className="flex-1" label={t('sites.loading')} />}
          {!loading && errored && <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{t('sites.errorState')}</div>}
          {!loading && !errored && view.rows.length === 0 && (
            rows.length === 0 ? (
              <EmptyState
                icon={<Building2 className="h-6 w-6" />}
                title={t('sites.emptyTitle')}
                body={t('sites.emptyBody')}
                action={<Button onClick={openEnroll}>{t('sites.enroll')}</Button>}
              />
            ) : (
              <StripedEmpty className="flex-1">{t('sites.noMatch')}</StripedEmpty>
            )
          )}
        </div>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={view.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          leftSlot={<span className="text-muted-foreground">{t('sites.count', { count: view.total })}</span>}
        />
      </div>

      {/* Enroll dialog */}
      <Dialog open={enrollOpen} onOpenChange={(o) => { if (!o) setEnrollOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('sites.enrollTitle')}</DialogTitle>
          <DialogDescription>{t('sites.enrollDescription')}</DialogDescription>
          <div className="mt-2 grid grid-cols-1 gap-y-3 text-sm">
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('sites.siteIdLabel')}</span>
              <Input value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder={t('sites.siteIdPlaceholder')} />
            </label>
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('sites.nameLabel')}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sites.namePlaceholder')} />
            </label>
            <label className="grid gap-1">
              <span className="text-muted-foreground">{t('sites.centralUrlLabel')}</span>
              <Input value={centralUrl} onChange={(e) => setCentralUrl(e.target.value)} placeholder={t('sites.centralUrlPlaceholder')} />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>{t('sites.cancel')}</Button>
            <Button disabled={busy || !siteId.trim() || !centralUrl.trim()} onClick={() => void doEnroll()}>{t('sites.enrollSubmit')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-time secret reveal (enroll + rotate) */}
      <Dialog open={reveal !== null} onOpenChange={(o) => { if (!o) setReveal(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{t('sites.secretTitle')}</DialogTitle>
          <DialogDescription className="text-destructive">{t('sites.secretWarning')}</DialogDescription>
          {reveal ? (
            <div className="mt-2 grid grid-cols-1 gap-y-3 text-sm">
              <SecretField label={t('sites.clientIdField')} value={reveal.clientId} onCopy={copy} copyLabel={t('sites.copy')} />
              <SecretField label={t('sites.clientSecretField')} value={reveal.clientSecret} onCopy={copy} copyLabel={t('sites.copy')} mono />
              {reveal.oidcIssuer !== undefined ? (
                <SecretField label={t('sites.oidcIssuerField')} value={reveal.oidcIssuer} onCopy={copy} copyLabel={t('sites.copy')} />
              ) : null}
              {reveal.centralUrl !== undefined ? (
                <SecretField label={t('sites.centralUrlField')} value={reveal.centralUrl} onCopy={copy} copyLabel={t('sites.copy')} />
              ) : null}
            </div>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => void doDownloadCert()}>{t('sites.downloadCert')}</Button>
            <Button onClick={() => setReveal(null)}>{t('sites.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRotate !== null}
        onOpenChange={(o) => { if (!o) setPendingRotate(null); }}
        title={t('sites.rotateTitle', { siteId: pendingRotate?.siteId ?? '' })}
        description={t('sites.rotateDescription')}
        confirmLabel={t('sites.rotate')}
        onConfirm={() => { void doRotate(); }}
      />
      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(o) => { if (!o) setPendingRevoke(null); }}
        title={t('sites.revokeTitle', { siteId: pendingRevoke?.siteId ?? '' })}
        description={t('sites.revokeDescription')}
        confirmLabel={t('sites.revoke')}
        destructive
        onConfirm={() => { void doRevoke(); }}
      />
    </>
  );
}

function SecretField({ label, value, onCopy, copyLabel, mono = false }: {
  label: string; value: string; onCopy: (v: string) => void; copyLabel: string; mono?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 text-xs ${mono ? 'font-mono' : ''}`}>{value}</code>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={copyLabel} onClick={() => onCopy(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
