import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { TruncatedText } from '@/components/ui/truncated-text';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { useAuth } from '@/auth/AuthProvider';
import { listRoles, deleteRole, type RoleRecord } from '@/api';
import { RoleSheet } from '@/roles/RoleSheet';
import { SettingsHeader } from './settings/SettingsHeader';

/**
 * Settings → Roles: lists capability-based roles and hosts the create/edit sheet.
 * Rendered inside SettingsShell's <Outlet/> (mirrors General.tsx and the other settings
 * sub-pages), so no AppShell of its own here.
 */
export function Roles() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const canManage = hasCapability('roles.manage');

  const [rows, setRows] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoleRecord | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listRoles()); }
    catch (e) { toast.error(t('roles.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const upsert = (r: RoleRecord) => setRows((prev) => {
    const i = prev.findIndex((x) => x.id === r.id);
    if (i === -1) return [...prev, r];
    const next = [...prev]; next[i] = r; return next;
  });

  const onSaved = (r: RoleRecord) => { upsert(r); toast.success(t('roles.savedToast', { name: r.name })); };

  const doDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const r = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteRole(r.id);
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      toast.success(t('roles.deletedToast', { name: r.name }));
    } catch (e) {
      toast.error(t('roles.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [pendingDelete, t]);

  const columns: ColumnDef<RoleRecord>[] = useMemo(() => [
    {
      id: 'name', labelKey: 'roles.colName', type: 'text', defaultVisible: true, cellClassName: 'font-medium',
      accessor: (r) => (
        <div className="flex items-center gap-2">
          <TruncatedText text={r.name} className="max-w-[16rem]" />
          {r.isSystem && <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">{t('roles.systemBadge')}</Badge>}
          {r.locked && <Badge variant="secondary" className="shrink-0 text-[10px]">{t('roles.lockedBadge')}</Badge>}
        </div>
      ),
    },
    {
      id: 'description', labelKey: 'roles.colDescription', type: 'text', defaultVisible: true, cellClassName: 'max-w-[24rem] text-muted-foreground',
      accessor: (r) => (r.description ? <TruncatedText text={r.description} className="max-w-[24rem]" /> : <span>-</span>),
    },
    {
      id: 'memberCount', labelKey: 'roles.colMembers', type: 'number', defaultVisible: true, headClassName: 'w-28', cellClassName: 'text-muted-foreground',
      accessor: (r) => t('roles.memberCount', { count: r.memberCount }),
    },
  ], [t]);

  // memberCount's accessor renders a translated string; the filter/sort must compare the raw
  // number, which is what this getter supplies instead of the rendered node.
  const valueGetters = useMemo(() => ({
    name: (r: RoleRecord) => r.name,
    description: (r: RoleRecord) => r.description ?? '',
    memberCount: (r: RoleRecord) => r.memberCount,
  }), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  const effectiveFilters = useMemo(() => {
    if (!search.trim()) return table.filters;
    return [...table.filters, { id: '__search__', column: 'name', operator: 'like' as const, value: search.trim(), combine: 'and' as const }];
  }, [table.filters, search]);

  const view = useMemo(
    () => applyTableState(rows, { filters: effectiveFilters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
    [rows, effectiveFilters, table.sorts, table.page, table.pageSize, columns, valueGetters],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="roles-page">
      <SettingsHeader description={t('roles.subtitle')} />

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
          searchPlaceholder={t('roles.searchPlaceholder')}
          actions={canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="roles-menu-trigger" aria-label={t('roles.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="create-role" onSelect={() => setCreateOpen(true)}>
                  {t('roles.createRole')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined}
        />
        <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
      </div>

      {/* ⛔ `min-h-0` + `overflow-hidden`, and NO `p-4`. The padding is what forced the <Bleed> that
          used to wrap the table, and the missing `min-h-0` is why nothing could shrink. Matches the
          shape RegistriesTab and Connectors already use. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* ⛔ Rendered ONLY when populated, for two reasons. `LoadingState` below is a SIBLING, so a
            wrapper that always fills splits the pane 50/50 with the loader on every load. And an
            empty table's HEADER still forces its own intrinsic width, which scrolls sideways on a
            phone. */}
        {/* ⛔ `wrapperClassName` puts the fill on the Table's OWN scroll wrapper. Without it that
            wrapper keeps its default `relative w-full overflow-auto` and hugs its content, so the
            horizontal scrollbar landed directly under the last row with dead background beneath it.
            `flex-1` on an ancestor moves the ancestor, not the scroller, and the scrollbar belongs
            to the scroller. */}
        {!loading && view.rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
                {view.rows.map((r) => (
                  <TableRow
                    key={r.id}
                    data-testid={`role-row-${r.id}`}
                    className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    onClick={() => setEditing(r)}
                  >
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManage ? (
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`role-actions-${r.id}`} aria-label={t('roles.actionsFor', { name: r.name })}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem data-testid={`role-edit-${r.id}`} onClick={() => setEditing(r)}>{t('roles.edit')}</DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`role-delete-${r.id}`}
                                disabled={r.isSystem || r.locked}
                                className="text-destructive focus:text-destructive"
                                onClick={() => { if (!r.isSystem && !r.locked) setPendingDelete(r); }}
                              >
                                {t('roles.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
        {loading && <LoadingState className="flex-1" label={t('roles.loading')} />}
        {!loading && view.rows.length === 0 && (
          rows.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6" />}
              className="flex-1"
              title={t('roles.emptyTitle')}
              body={t('roles.emptyBody')}
              action={canManage ? <Button onClick={() => setCreateOpen(true)}>{t('roles.createRole')}</Button> : undefined}
            />
          ) : (
            <StripedEmpty className="flex-1">{t('roles.noMatch')}</StripedEmpty>
          )
        )}
      </div>

      <TablePagination page={table.page} pageSize={table.pageSize} total={view.total} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />

      <RoleSheet open={createOpen} onOpenChange={setCreateOpen} role={null} onSaved={onSaved} />
      <RoleSheet open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} role={editing} onSaved={onSaved} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={t('roles.deleteTitle', { name: pendingDelete?.name ?? '' })}
        description={t('roles.deleteDescription')}
        confirmLabel={t('roles.delete')}
        destructive
        onConfirm={() => { void doDelete(); }}
      />
    </div>
  );
}

export default Roles;
