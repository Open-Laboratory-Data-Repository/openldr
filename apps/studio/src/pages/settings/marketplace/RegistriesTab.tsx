import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, Boxes } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import {
  listRegistries, createRegistry, updateRegistry, deleteRegistry,
  type MarketplaceRegistry,
} from '@/api';

interface DraftState {
  id: string | null; // null = create
  name: string;
  kind: 'local' | 'http';
  location: string;
  enabled: boolean;
}

const emptyDraft = (): DraftState => ({ id: null, name: '', kind: 'http', location: '', enabled: true });

// Module level — stable, outside the component.
const SEARCH_FIELDS = [
  (r: MarketplaceRegistry) => r.name,
  (r: MarketplaceRegistry) => r.location,
];

/**
 * @param onReady Hands this tab's create-dialog opener up to MarketplaceTabs, which owns the page's
 *   single ⋯ on the tab strip. Optional so the component still stands alone in its own tests.
 */
export function RegistriesTab({ onChanged, onReady }: {
  onChanged: () => void;
  onReady?: (api: { openCreate: () => void }) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MarketplaceRegistry[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<MarketplaceRegistry | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const err = useCallback((e: unknown) =>
    toast.error(t('settings.marketplace.registryErrorToast', { error: e instanceof Error ? e.message : String(e) })), [t]);

  const load = useCallback(async () => {
    try { setRows(await listRegistries()); }
    catch (e) { err(e); }
  }, [err]);
  useEffect(() => { void load(); }, [load]);

  // useCallback with no deps: `setDraft` is stable, so the handle handed up below never changes
  // identity and the effect that publishes it runs once.
  const openCreate = useCallback(() => setDraft(emptyDraft()), []);
  useEffect(() => { onReady?.({ openCreate }); }, [onReady, openCreate]);
  const openEdit = (r: MarketplaceRegistry) =>
    setDraft({ id: r.id, name: r.name, kind: r.kind, location: r.location, enabled: r.enabled });

  const onSave = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (draft.id === null) {
        await createRegistry({ name: draft.name, kind: draft.kind, location: draft.location });
      } else {
        await updateRegistry(draft.id, { name: draft.name, kind: draft.kind, location: draft.location, enabled: draft.enabled });
      }
      setDraft(null);
      await load();
      onChanged();
    } catch (e) { err(e); }
    finally { setBusy(false); }
  }, [draft, busy, load, onChanged, err]);

  const onToggle = useCallback(async (r: MarketplaceRegistry, enabled: boolean) => {
    try { await updateRegistry(r.id, { enabled }); await load(); onChanged(); }
    catch (e) { err(e); }
  }, [load, onChanged, err]);

  const onRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const r = pendingRemove;
    setPendingRemove(null);
    try { await deleteRegistry(r.id); await load(); onChanged(); }
    catch (e) { err(e); }
  }, [pendingRemove, load, onChanged, err]);

  const columns: ColumnDef<MarketplaceRegistry>[] = useMemo(() => [
    { id: 'name', labelKey: 'settings.marketplace.registryName', accessor: (r) => r.name, type: 'text', defaultVisible: true, cellClassName: 'font-medium' },
    {
      id: 'kind', labelKey: 'settings.marketplace.registryKind', type: 'enum', defaultVisible: true,
      accessor: (r) => (r.kind === 'http' ? t('settings.marketplace.kindHttp') : t('settings.marketplace.kindLocal')),
      enumOptions: [
        { value: 'http', labelKey: 'settings.marketplace.kindHttp' },
        { value: 'local', labelKey: 'settings.marketplace.kindLocal' },
      ],
      cellClassName: 'text-muted-foreground',
    },
    { id: 'location', labelKey: 'settings.marketplace.registryLocation', accessor: (r) => r.location, type: 'text', defaultVisible: true, cellClassName: 'text-muted-foreground' },
    {
      id: 'enabled', labelKey: 'settings.marketplace.registryEnabled', type: 'enum', defaultVisible: true,
      accessor: (r) => (
        <span data-testid={`toggle-${r.id}`}>
          <Switch checked={r.enabled} onCheckedChange={(v) => void onToggle(r, v)} aria-label={t('settings.marketplace.registryEnabled')} />
        </span>
      ),
      enumOptions: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }],
    },
  ], [t, onToggle]);

  // `kind` and `enabled` render translated text and a Switch, so the filter needs the raw
  // values behind them — otherwise filtering `enabled` would compare against a React element.
  const valueGetters = useMemo(() => ({
    name: (r: MarketplaceRegistry) => r.name,
    kind: (r: MarketplaceRegistry) => r.kind,
    location: (r: MarketplaceRegistry) => r.location,
    enabled: (r: MarketplaceRegistry) => String(r.enabled),
  }), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  // Free-text search pre-filters the rows; it is never appended to the filter rule list.
  // applyTableState folds rules flat, left to right, so a multi-field search added as OR rules
  // would discard an active popover filter for rows matching only the trailing term.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => SEARCH_FIELDS.some((f) => (f(r) ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const view = useMemo(
    () => applyTableState(searched, { filters: table.filters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
    [searched, table.filters, table.sorts, table.page, table.pageSize, columns, valueGetters],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="registries-tab">
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
          onResetAll={() => { table.resetAll(); setSearch(''); }}
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); table.setPage(0); }}
          searchPlaceholder={t('settings.marketplace.registrySearchPlaceholder')}
          /* ⛔ No `actions` slot. "Add registry" moved to the page's single ⋯ on the tab strip, so
             this toolbar keeps only Filter / Sort / Columns. Two ⋯ menus a few pixels apart, one
             per-page and one per-table, is what the move was for. */
        />
        <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* The table renders ONLY when populated. An empty table's header still forces its
            intrinsic width, so keeping it around for an empty list scrolls sideways on a phone. */}
        {view.rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {view.rows.map((r) => (
                <TableRow key={r.id} data-testid={`registry-row-${r.id}`}>
                  {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t('settings.marketplace.registryActionsFor', { name: r.name })}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`edit-${r.id}`} onClick={() => openEdit(r)}>
                            {t('settings.marketplace.registryEditBtn')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            data-testid={`remove-${r.id}`}
                            className="text-destructive focus:text-destructive"
                            onClick={() => setPendingRemove(r)}
                          >
                            {t('settings.marketplace.registryRemoveBtn')}
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
        {view.rows.length === 0 && (
          rows.length === 0 ? (
            <EmptyState
              icon={<Boxes className="h-6 w-6" />}
              title={t('settings.marketplace.noRegistries')}
              body={t('settings.marketplace.noRegistries')}
            />
          ) : (
            <StripedEmpty className="flex-1">{t('settings.marketplace.noMatchRegistries')}</StripedEmpty>
          )
        )}
      </div>

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={view.total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
      />

      <Dialog open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{draft?.id === null ? t('settings.marketplace.addRegistry') : t('settings.marketplace.editRegistry')}</DialogTitle>
          {draft ? (
            <div className="text-sm">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3">
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.marketplace.registryName')}</span>
                  <Input data-testid="registry-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.marketplace.registryKind')}</span>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as 'local' | 'http' })}>
                    <SelectTrigger data-testid="registry-kind"><SelectValue placeholder={t('settings.marketplace.pickKind')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">{t('settings.marketplace.kindLocal')}</SelectItem>
                      <SelectItem value="http">{t('settings.marketplace.kindHttp')}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-1">
                  <span className="text-muted-foreground">{t('settings.marketplace.registryLocation')}</span>
                  <Input data-testid="registry-location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
                </label>
                {draft.id !== null ? (
                  <label className="flex items-center gap-2">
                    <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label={t('settings.marketplace.registryEnabled')} />
                    <span className="text-muted-foreground">{t('settings.marketplace.registryEnabled')}</span>
                  </label>
                ) : null}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>{t('settings.marketplace.registryCancel')}</Button>
                <Button data-testid="registry-save" disabled={busy || !draft.name || !draft.location} onClick={() => void onSave()}>
                  {t('settings.marketplace.registrySave')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.marketplace.removeRegistryTitle', { name: pendingRemove?.name ?? '' })}
        description={t('settings.marketplace.removeRegistryDescription')}
        confirmLabel={t('settings.marketplace.registryRemoveBtn')}
        destructive
        onConfirm={() => { void onRemove(); }}
      />
    </div>
  );
}
