import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { NAV } from '@/shell/AppShell';
import { loadLayouts } from '@/shell/layouts';
import { deleteLayout, listLayouts, listRoles, saveLayout, type LayoutInput, type LayoutPreset, type RoleRecord } from '@/api';
import { SettingsHeader } from './SettingsHeader';
import { LayoutSheet } from './LayoutSheet';

/** Settings, Layouts: the admin's named sidebars, each with an optional first page and the roles
 *  that use it by default. Users pick their own from the user menu. */
export function Layouts() {
  const { t } = useTranslation();
  const [layouts, setLayouts] = useState<LayoutPreset[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [roles, setRoles] = useState<RoleRecord[] | null>(null);
  const [editing, setEditing] = useState<{ layout: LayoutPreset | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LayoutPreset | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    try {
      setLayouts((await listLayouts()).layouts);
      setLoadError(false);
    } catch {
      setLayouts([]);
      setLoadError(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Roles name the role defaults. A user without roles.view cannot read them: the editor then
  // hides the role checkboxes and a layout keeps the defaults it has.
  useEffect(() => { void listRoles().then(setRoles, () => setRoles(null)); }, []);

  const roleName = useCallback((slug: string) => roles?.find((r) => r.slug === slug)?.name ?? slug, [roles]);
  const pageName = useCallback((to: string | null) => {
    const n = NAV.find((x) => x.to === to);
    return n ? t(n.labelKey) : '-';
  }, [t]);

  // After any change the user menu and the sidebar must see it too, not only this table.
  const refresh = useCallback(async () => { await loadLayouts(); await load(); }, [load]);

  const onSave = useCallback(async (input: LayoutInput): Promise<string | null> => {
    try {
      const saved = await saveLayout(editing?.layout?.id ?? null, input);
      toast.success(t('layouts.saved', { name: saved.name }));
      setEditing(null);
      await refresh();
      return null;
    } catch (e) {
      return t('layouts.error', { error: e instanceof Error ? e.message : String(e) });
    }
  }, [editing, refresh, t]);

  const onDelete = useCallback(async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteLayout(target.id);
      toast.success(t('layouts.deleted', { name: target.name }));
      await refresh();
    } catch (e) {
      toast.error(t('layouts.error', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [pendingDelete, refresh, t]);

  const rows = useMemo(() => (layouts ?? []).slice(page * pageSize, page * pageSize + pageSize), [layouts, page, pageSize]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="layouts-page">
      <SettingsHeader
        description={t('layouts.subtitle')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="layouts-menu" aria-label={t('layouts.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="layouts-new" onSelect={() => setEditing({ layout: null })}>{t('layouts.new')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void load(); }}>{t('layouts.refresh')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-sm">
        {layouts === null ? (
          <LoadingState className="min-h-[16rem] flex-1" label={t('layouts.loading')} />
        ) : loadError ? (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-muted-foreground">{t('layouts.loadError')}</div>
        ) : layouts.length === 0 ? (
          // No table while empty: its header alone would scroll sideways on a phone.
          <div className="flex min-h-[16rem] flex-1" data-testid="layouts-empty"><StripedEmpty className="flex-1">{t('layouts.empty')}</StripedEmpty></div>
        ) : (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('layouts.colName')}</TableHead>
                <TableHead className="w-20">{t('layouts.colPages')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('layouts.colStartPage')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('layouts.colRoles')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{l.pages.length}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{pageName(l.startPage)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{l.roles.map(roleName).join(', ') || '-'}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t('layouts.actionsFor', { name: l.name })}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid="layout-edit" onSelect={() => setEditing({ layout: l })}>{t('layouts.edit')}</DropdownMenuItem>
                          <DropdownMenuItem data-testid="layout-delete" className="text-destructive focus:text-destructive" onSelect={() => setPendingDelete(l)}>{t('layouts.delete')}</DropdownMenuItem>
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
        page={page}
        pageSize={pageSize}
        total={layouts?.length ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('layouts.count', { count: layouts?.length ?? 0 })}</span>}
      />

      <LayoutSheet
        open={editing !== null}
        layout={editing?.layout ?? null}
        roles={roles}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSave={onSave}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={t('layouts.deleteTitle', { name: pendingDelete?.name ?? '' })}
        description={t('layouts.deleteBody')}
        confirmLabel={t('layouts.deleteConfirm')}
        destructive
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}
