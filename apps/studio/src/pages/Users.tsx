import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingState } from '@/components/ui/spinner';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ColumnPickerPopover, useTableState, type ColumnDef,
} from '@/components/data-table';
import { useAuth } from '@/auth/AuthProvider';
import { listUserDirectory, setUserStatus, sendUserResetEmail, forceUserLogout, type UserSummary } from '@/api';
import { UserDialog } from '@/users/UserDialog';
import { ResetPasswordDialog } from '@/users/ResetPasswordDialog';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function Users() {
  const { t } = useTranslation();
  const { user: me, authCapabilities } = useAuth();
  const identityAdmin = authCapabilities?.identityAdmin ?? true;
  const [rows, setRows] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [pendingToggle, setPendingToggle] = useState<UserSummary | null>(null);
  const [resetting, setResetting] = useState<UserSummary | null>(null);
  const [pendingLogout, setPendingLogout] = useState<UserSummary | null>(null);
  const [search, setSearch] = useState('');

  const [status, setStatus] = useState('true');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [hasMore, setHasMore] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setRows([]);
    setHasMore(false);
    try {
      const result = await listUserDirectory({ offset: page * pageSize, limit: pageSize, search, enabled: status === 'all' ? undefined : status === 'true' });
      if (id !== request.current) return;
      setRows(result.rows);
      setHasMore(result.hasMore);
    } catch (e) {
      if (id === request.current) setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) });
    } finally { if (id === request.current) setLoading(false); }
  }, [t, page, pageSize, search, status]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id); }, [toast]);

  const onSaved = (u: UserSummary) => { void load(); setToast({ kind: 'ok', text: t('users.savedToast', { username: u.username }) }); };

  const doToggle = async () => {
    if (!pendingToggle) return;
    const u = pendingToggle;
    setPendingToggle(null);
    try {
      const updated = await setUserStatus(u.id, !u.enabled);
      void load();
      setToast({ kind: 'ok', text: t(updated.enabled ? 'users.enabledToast' : 'users.disabledToast', { username: u.username }) });
    } catch (e) {
      setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) });
    }
  };

  const doSendResetEmail = useCallback(async (u: UserSummary) => {
    try { await sendUserResetEmail(u.id); setToast({ kind: 'ok', text: t('users.sendResetEmailToast', { username: u.username }) }); }
    catch (e) { setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [t]);
  const doForceLogout = useCallback(async () => {
    if (!pendingLogout) return;
    const u = pendingLogout; setPendingLogout(null);
    try { await forceUserLogout(u.id); setToast({ kind: 'ok', text: t('users.forceSignOutToast', { username: u.username }) }); }
    catch (e) { setToast({ kind: 'err', text: t('users.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [pendingLogout, t]);

  const columns = useMemo<ColumnDef<UserSummary>[]>(() => [
    { id: 'username', labelKey: 'users.username', accessor: (u) => <span className="font-medium">{u.username}</span>, type: 'text', defaultVisible: true, sortable: false, filterable: false },
    { id: 'fullName', labelKey: 'users.fullName', accessor: (u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
        return name ? name : <span className="text-muted-foreground">-</span>;
      }, type: 'text', defaultVisible: true, sortable: false, filterable: false },
    { id: 'email', labelKey: 'users.email', accessor: (u) => u.email || <span className="text-muted-foreground">-</span>, type: 'text', defaultVisible: true, sortable: false, filterable: false },
    { id: 'status', labelKey: 'users.status', accessor: (u) => u.enabled
        ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">{t('users.statusActive')}</Badge>
        : <Badge variant="outline" className="text-muted-foreground">{t('users.statusDisabled')}</Badge>,
      type: 'enum', enumOptions: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Disabled' }], defaultVisible: true, sortable: false, filterable: false, headClassName: 'w-24' },
    { id: 'createdAt', labelKey: 'users.created', accessor: (u) => <span className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>, type: 'text', defaultVisible: false, sortable: false, filterable: false, headClassName: 'w-40' },
    { id: '__actions', labelKey: 'common.actions', accessor: (u) => {
        const isSelf = !!me && me.id === u.id;
        // The actions wrapper stops the ⋯ trigger click from bubbling to the row's click-to-edit
        // handler. It is an event-propagation guard, not an interactive control, so it has no role.
        return (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${u.username}`}><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(u)}>{t(identityAdmin ? 'users.edit' : 'users.editRole')}</DropdownMenuItem>
                <DropdownMenuItem disabled={isSelf} onClick={() => { if (!isSelf) setPendingToggle(u); }} className={u.enabled ? 'text-destructive focus:text-destructive' : ''}>
                  {u.enabled ? t('users.disable') : t('users.enable')}{isSelf ? ` (${t('users.selfSuffix')})` : ''}
                </DropdownMenuItem>
                {identityAdmin && <><DropdownMenuItem onClick={() => { setResetting(u); }}>
                  {t('users.resetPassword')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { void doSendResetEmail(u); }}>
                  {t('users.sendResetEmail')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isSelf} onClick={() => { if (!isSelf) setPendingLogout(u); }} className="text-destructive focus:text-destructive">
                  {t('users.forceSignOut')}{isSelf ? ` (${t('users.selfSuffix')})` : ''}
                </DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      }, type: 'text', defaultVisible: true, sortable: false, filterable: false, headClassName: 'w-16' },
  ], [me?.id, t, doSendResetEmail, identityAdmin]);

  const table = useTableState({ columns });

  // ResetPasswordDialog needs a minimal user shape; adapt from UserSummary
  const resetUser = resetting ? {
    id: resetting.id,
    username: resetting.username,
    subject: resetting.id,
    displayName: [resetting.firstName, resetting.lastName].filter(Boolean).join(' ') || null,
    email: resetting.email,
    roles: resetting.roles,
    status: resetting.enabled ? 'active' as const : 'disabled' as const,
    lastLoginAt: null,
    createdAt: resetting.createdAt,
  } : null;

  return (
    <AppShell title="Users" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
            <Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t('users.directorySearch')} aria-label={t('users.directorySearch')} className="h-8 min-w-0 sm:w-64" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 sm:order-last sm:ml-auto" aria-label="User actions"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {identityAdmin && <DropdownMenuItem onClick={() => setCreateOpen(true)}>{t('users.newUser')}</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => { void load(); }}>{t('users.refresh')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="col-span-2 flex min-w-0 items-center gap-2 sm:contents">
              <Select value={status} onValueChange={(value) => { setStatus(value); setPage(0); }}>
                <SelectTrigger aria-label={t('users.status')} className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('users.directoryAll')}</SelectItem>
                  <SelectItem value="true">{t('users.statusActive')}</SelectItem>
                  <SelectItem value="false">{t('users.statusDisabled')}</SelectItem>
                </SelectContent>
              </Select>
              <ColumnPickerPopover columns={columns} visibleIds={table.visibleIds} onChange={table.setVisibleIds} onResetDefaults={table.resetColumns} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('users.directoryOrder')}</p>
          {!identityAdmin && <p className="text-xs text-muted-foreground">{t('users.identityAdminUnavailable')}</p>}
          {toast ? <div className={toast.kind === 'ok' ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700' : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div> : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Fill only when rows exist: the loading/empty siblings below are themselves `flex-1`,
              so an always-filling wrapper would split the pane 50/50 with them. */}
          {!loading && rows.length > 0 && <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>{table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{c.id === '__actions' ? '' : t(c.labelKey)}</TableHead>)}</TableRow>
            </TableHeader>
            {!loading && rows.length > 0 && (
              <TableBody className="[&_tr:last-child]:border-b">
                {rows.map((u) => (
                  <TableRow key={u.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => setEditing(u)}>
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(u)}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            )}
          </Table>}
          {loading && <LoadingState className="flex-1" label={t('common.loading')} />}
          {!loading && rows.length === 0 && <StripedEmpty className="min-h-[16rem] flex-1">{t('users.noMatch')}</StripedEmpty>}
        </div>

        <TablePagination page={page} pageSize={pageSize} total={null} rowCount={rows.length} hasMore={!loading && hasMore} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(0); }} />

        <UserDialog open={createOpen} onOpenChange={setCreateOpen} user={null} onSaved={onSaved} />
        <UserDialog identityAdmin={identityAdmin} open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }} user={editing} onSaved={onSaved} />
        <ConfirmDialog
          open={pendingToggle !== null}
          onOpenChange={(o) => { if (!o) setPendingToggle(null); }}
          title={pendingToggle?.enabled ? t('users.disableTitle', { username: pendingToggle?.username ?? '' }) : t('users.enableTitle', { username: pendingToggle?.username ?? '' })}
          description={pendingToggle?.enabled ? t('users.disableDescription') : t('users.enableDescription')}
          confirmLabel={pendingToggle?.enabled ? t('users.disable') : t('users.enable')}
          destructive={pendingToggle?.enabled ?? false}
          onConfirm={() => { void doToggle(); }}
        />
        <ResetPasswordDialog open={resetting !== null} onOpenChange={(o) => { if (!o) setResetting(null); }} user={resetUser} onDone={(u) => setToast({ kind: 'ok', text: t('users.resetPasswordSavedToast', { username: u.username }) })} />
        <ConfirmDialog
          open={pendingLogout !== null}
          onOpenChange={(o) => { if (!o) setPendingLogout(null); }}
          title={t('users.forceSignOutTitle', { username: pendingLogout?.username ?? '' })}
          description={t('users.forceSignOutDescription')}
          confirmLabel={t('users.forceSignOut')}
          destructive
          onConfirm={() => { void doForceLogout(); }}
        />
      </div>
    </AppShell>
  );
}
