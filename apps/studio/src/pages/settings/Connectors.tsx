import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal, Plug } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { SettingsHeader } from './SettingsHeader';
import {
  listConnectors, listSinkPlugins, createConnector, updateConnector, deleteConnector, testConnector,
  type Connector, type SinkPluginRef,
} from '@/api';

type FieldKind = 'text' | 'number' | 'password' | 'boolean';
interface TypeField { key: string; labelKey: string; kind: FieldKind }
const HOST_TYPES: Array<{ value: string; label: string }> = [
  { value: 'postgres', label: 'Postgres' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'microsoft-sql', label: 'Microsoft SQL' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'redis', label: 'Redis' },
  { value: 'smtp', label: 'SMTP Email' },
  { value: 'imap', label: 'IMAP Email' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Microsoft Outlook' },
  { value: 'sftp', label: 'SFTP' },
];
// Render a divider after these values to group the menu: relational SQL | NoSQL/cache | email | file.
const SEPARATOR_AFTER = new Set(['microsoft-sql', 'redis', 'outlook']);
const SQL_FIELDS: TypeField[] = [
  { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
  { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
  { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
  { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
  { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
  { key: 'ssl', labelKey: 'settings.connectors.fieldSsl', kind: 'boolean' },
];
const CONNECTOR_TYPE_FIELDS: Record<string, TypeField[]> = {
  postgres: SQL_FIELDS,
  mysql: SQL_FIELDS,
  'microsoft-sql': [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'encrypt', labelKey: 'settings.connectors.fieldEncrypt', kind: 'boolean' },
    { key: 'trustServerCertificate', labelKey: 'settings.connectors.fieldTrustServerCert', kind: 'boolean' },
  ],
  mongodb: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'database', labelKey: 'settings.connectors.fieldDatabase', kind: 'text' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'authSource', labelKey: 'settings.connectors.fieldAuthSource', kind: 'text' },
  ],
  redis: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'db', labelKey: 'settings.connectors.fieldDb', kind: 'number' },
  ],
  smtp: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'secure', labelKey: 'settings.connectors.fieldSecure', kind: 'boolean' },
  ],
  imap: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
    { key: 'tls', labelKey: 'settings.connectors.fieldSecure', kind: 'boolean' },
  ],
  gmail: [
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'clientId', labelKey: 'settings.connectors.fieldClientId', kind: 'text' },
    { key: 'clientSecret', labelKey: 'settings.connectors.fieldClientSecret', kind: 'password' },
    { key: 'refreshToken', labelKey: 'settings.connectors.fieldRefreshToken', kind: 'password' },
  ],
  outlook: [
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'clientId', labelKey: 'settings.connectors.fieldClientId', kind: 'text' },
    { key: 'clientSecret', labelKey: 'settings.connectors.fieldClientSecret', kind: 'password' },
    { key: 'refreshToken', labelKey: 'settings.connectors.fieldRefreshToken', kind: 'password' },
    { key: 'tenant', labelKey: 'settings.connectors.fieldTenant', kind: 'text' },
  ],
  sftp: [
    { key: 'host', labelKey: 'settings.connectors.fieldHost', kind: 'text' },
    { key: 'port', labelKey: 'settings.connectors.fieldPort', kind: 'number' },
    { key: 'user', labelKey: 'settings.connectors.fieldUser', kind: 'text' },
    { key: 'password', labelKey: 'settings.connectors.fieldPassword', kind: 'password' },
  ],
};

interface DraftState {
  id: string | null; // null = create
  category: 'plugin' | 'database';
  name: string;
  pluginId: string;
  type: string; // host type when category==='database'
  baseUrl: string;
  username: string;
  password: string; // blank on edit = keep existing
  dbConfig: Record<string, string>; // host fields
  enabled: boolean;
}

// Module level — stable, outside the component.
const SEARCH_FIELDS = [
  (c: Connector) => c.name,
  (c: Connector) => c.type ?? c.pluginId ?? '',
  (c: Connector) => c.allowedHost ?? '',
];

const emptyDraft = (): DraftState => ({
  id: null,
  category: 'plugin',
  name: '',
  pluginId: '',
  type: 'postgres',
  baseUrl: '',
  username: '',
  password: '',
  dbConfig: {},
  enabled: true,
});

export function Connectors() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Connector[]>([]);
  const [plugins, setPlugins] = useState<SinkPluginRef[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingRemove, setPendingRemove] = useState<Connector | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([listConnectors(), listSinkPlugins()]);
      setRows(cs); setPlugins(ps);
    } catch (e) {
      toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (c: Connector) =>
    setDraft({
      id: c.id,
      category: c.type ? 'database' : 'plugin',
      name: c.name,
      pluginId: c.pluginId ?? '',
      type: c.type ?? 'postgres',
      baseUrl: '',
      username: '',
      password: '',
      dbConfig: {},
      enabled: c.enabled,
    });

  const onSave = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (draft.category === 'database') {
        // DB path: require first field of the active type's schema on create; on edit blank = keep
        const typeFields = CONNECTOR_TYPE_FIELDS[draft.type] ?? SQL_FIELDS;
        const firstKey = (CONNECTOR_TYPE_FIELDS[draft.type] ?? [])[0]?.key;
        const requiredFilled = firstKey ? Boolean(String(draft.dbConfig[firstKey] ?? '').trim()) : true;
        const anyFilled = Object.values(draft.dbConfig).some(Boolean);
        if (draft.id === null ? !requiredFilled : (anyFilled && !requiredFilled)) {
          toast.error(t('settings.connectors.partialSecrets'));
          return;
        }
        const config: Record<string, string> = {};
        if (requiredFilled) {
          for (const field of typeFields) {
            const val = draft.dbConfig[field.key];
            if (val !== undefined && val !== '') config[field.key] = val;
          }
        }
        if (draft.id === null) {
          await createConnector({ name: draft.name, type: draft.type, config });
        } else {
          await updateConnector(draft.id, { name: draft.name, enabled: draft.enabled, ...(requiredFilled ? { config } : {}) });
        }
      } else {
        // Plugin path (existing behavior)
        const anyFilled = Boolean(draft.baseUrl || draft.username || draft.password);
        const allFilled = Boolean(draft.baseUrl && draft.username && draft.password);
        if (draft.id === null ? !allFilled : (anyFilled && !allFilled)) {
          toast.error(t('settings.connectors.partialSecrets'));
          return;
        }
        const config: Record<string, string> = allFilled
          ? { baseUrl: draft.baseUrl, username: draft.username, password: draft.password }
          : {};
        if (draft.id === null) {
          await createConnector({ name: draft.name, pluginId: draft.pluginId, config });
        } else {
          await updateConnector(draft.id, { name: draft.name, enabled: draft.enabled, ...(allFilled ? { config } : {}) });
        }
      }
      toast.success(t('settings.connectors.savedToast', { name: draft.name }));
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, t, load]);

  const onToggle = useCallback(async (c: Connector, enabled: boolean) => {
    try { await updateConnector(c.id, { enabled }); await load(); }
    catch (e) { toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t, load]);

  const onTest = useCallback(async (c: Connector) => {
    setTesting(c.id);
    setTestResult((r) => ({ ...r, [c.id]: t('settings.connectors.testing') }));
    try {
      const res = await testConnector(c.id);
      setTestResult((r) => ({
        ...r,
        [c.id]: res.ok
          ? res.metadata
            ? t('settings.connectors.testOk', { dataElements: res.metadata.dataElements, orgUnits: res.metadata.orgUnits })
            : t('settings.connectors.testOkSimple')
          : t('settings.connectors.testFailed', { error: (res as { ok: false; error: string }).error }),
      }));
    } catch (e) {
      setTestResult((r) => ({ ...r, [c.id]: t('settings.connectors.testFailed', { error: e instanceof Error ? e.message : String(e) }) }));
    } finally {
      setTesting(null);
    }
  }, [t]);

  const onRemove = useCallback(async () => {
    if (!pendingRemove) return;
    const c = pendingRemove;
    setPendingRemove(null);
    try { await deleteConnector(c.id); toast.success(t('settings.connectors.removedToast', { name: c.name })); await load(); }
    catch (e) { toast.error(t('settings.connectors.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingRemove, t, load]);

  const saveDisabled = !draft
    ? true
    : busy || !draft.name || (draft.category === 'plugin' ? !draft.pluginId : !draft.type);

  // The type column mixes host types and plugin ids, so its options are whatever the rows
  // actually carry — never a hardcoded list (AGENTS.md §8).
  const typeOptions = useMemo(
    () => Array.from(new Set(rows.map((c) => c.type ?? c.pluginId).filter((v): v is string => Boolean(v)))).sort(),
    [rows],
  );

  const columns: ColumnDef<Connector>[] = useMemo(() => [
    { id: 'name', labelKey: 'settings.connectors.colName', type: 'text', defaultVisible: true, cellClassName: 'font-medium', accessor: (c) => c.name },
    {
      id: 'type', labelKey: 'settings.connectors.colType', type: 'enum', defaultVisible: true, cellClassName: 'text-muted-foreground',
      accessor: (c) => c.type ?? c.pluginId,
      enumOptions: typeOptions.map((v) => ({ value: v, label: v })),
    },
    { id: 'host', labelKey: 'settings.connectors.colHost', type: 'text', defaultVisible: true, cellClassName: 'text-muted-foreground', accessor: (c) => c.allowedHost ?? '—' },
    {
      id: 'enabled', labelKey: 'settings.connectors.colEnabled', type: 'enum', defaultVisible: true,
      accessor: (c) => <Switch checked={c.enabled} onCheckedChange={(v) => void onToggle(c, v)} aria-label={t('settings.connectors.enabledLabel')} />,
      enumOptions: [
        { value: 'true', label: t('settings.connectors.colEnabled') },
        { value: 'false', label: t('settings.connectors.disabledLabel') },
      ],
    },
  ], [typeOptions, onToggle, t]);

  // The accessors render nodes (a Switch, an em dash placeholder); filtering and sorting must
  // compare the underlying values, which is what these getters supply.
  const valueGetters = useMemo(() => ({
    name: (c: Connector) => c.name,
    type: (c: Connector) => c.type ?? c.pluginId ?? '',
    host: (c: Connector) => c.allowedHost ?? '',
    enabled: (c: Connector) => String(c.enabled),
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
    <div className="flex min-h-0 flex-1 flex-col" data-testid="connectors-page">
      <SettingsHeader description={t('settings.connectors.description')} />

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
          searchPlaceholder={t('settings.connectors.searchPlaceholder')}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="connectors-menu-trigger" aria-label={t('settings.connectors.heading')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="add-connector" onSelect={openCreate}>
                  {t('settings.connectors.add')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Rendered only when populated: an empty table's five header cells force intrinsic
            width and scroll the pane sideways on a phone (AGENTS.md §6). */}
        {view.rows.length > 0 && (
        <Table wrapperClassName="min-h-0 flex-1">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
              <TableHead className="text-right">{t('settings.connectors.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {view.rows.map((c) => (
              <TableRow key={c.id} data-testid={`connector-row-${c.id}`}>
                {table.visibleColumns.map((col) => <TableCell key={col.id} className={col.cellClassName}>{col.accessor(c)}</TableCell>)}
                <TableCell>
                  <div className="flex items-center justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          data-testid={`actions-${c.id}`}
                          aria-label={t('settings.connectors.actionsLabel', { name: c.name })}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          data-testid={`test-${c.id}`}
                          disabled={testing === c.id}
                          onSelect={() => { void onTest(c); }}
                        >
                          {t('settings.connectors.test')}
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid={`edit-${c.id}`} onSelect={() => openEdit(c)}>
                          {t('settings.connectors.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem data-testid={`remove-${c.id}`} onSelect={() => setPendingRemove(c)}>
                          {t('settings.connectors.remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {testResult[c.id] ? (
                    <div className="mt-1 text-right text-xs text-muted-foreground" data-testid={`test-result-${c.id}`}>{testResult[c.id]}</div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
        {view.rows.length === 0 && (
          rows.length === 0 ? (
            <EmptyState
              icon={<Plug className="h-6 w-6" />}
              title={t('settings.connectors.emptyTitle')}
              action={<Button onClick={openCreate}>{t('settings.connectors.add')}</Button>}
            />
          ) : (
            <StripedEmpty className="flex-1">{t('settings.connectors.noMatch')}</StripedEmpty>
          )
        )}
      </div>

      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={view.total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        leftSlot={<span className="text-muted-foreground">{t('settings.connectors.count', { count: view.total })}</span>}
      />

      <Sheet open={draft !== null} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border px-6 py-4">
            <SheetTitle>{draft?.id === null ? t('settings.connectors.newTitle') : t('settings.connectors.editTitle')}</SheetTitle>
            <SheetDescription>{t('settings.connectors.sheetDescription')}</SheetDescription>
          </SheetHeader>
          {draft ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
                  {/* Name field — always shown */}
                  <Label htmlFor="connector-name" className="whitespace-nowrap">{t('settings.connectors.fieldName')}</Label>
                  <Input id="connector-name" data-testid="connector-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

                  {/* Category selector */}
                  <Label htmlFor="connector-category" className="whitespace-nowrap">{t('settings.connectors.category')}</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: v as 'plugin' | 'database' })}
                  >
                    <SelectTrigger id="connector-category" data-testid="connector-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plugin">{t('settings.connectors.categoryPlugin')}</SelectItem>
                      <SelectItem value="database">{t('settings.connectors.categoryHost')}</SelectItem>
                    </SelectContent>
                  </Select>

                  {draft.category === 'database' ? (
                    <>
                      {/* Host type selector */}
                      <Label htmlFor="connector-type" className="whitespace-nowrap">{t('settings.connectors.pickType')}</Label>
                      <Select
                        value={draft.type}
                        onValueChange={(v) => setDraft({ ...draft, type: v })}
                      >
                        <SelectTrigger id="connector-type" data-testid="connector-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HOST_TYPES.map((ht) => (
                            <Fragment key={ht.value}>
                              <SelectItem value={ht.value}>{ht.label}</SelectItem>
                              {SEPARATOR_AFTER.has(ht.value) && <SelectSeparator />}
                            </Fragment>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* DB fields — per-type */}
                      {(CONNECTOR_TYPE_FIELDS[draft.type] ?? SQL_FIELDS).map((field) => {
                        const val = draft.dbConfig[field.key] ?? '';
                        const isEdit = draft.id !== null;
                        const fieldId = `connector-db-${field.key}`;
                        if (field.kind === 'boolean') {
                          return (
                            <div key={field.key} className="col-span-2 flex items-center gap-2">
                              <Switch
                                data-testid={fieldId}
                                checked={val === 'true'}
                                onCheckedChange={(v) => setDraft({ ...draft, dbConfig: { ...draft.dbConfig, [field.key]: v ? 'true' : 'false' } })}
                                aria-label={t(field.labelKey)}
                              />
                              <Label className="text-muted-foreground">{t(field.labelKey)}</Label>
                            </div>
                          );
                        }
                        return (
                          <Fragment key={field.key}>
                            <Label htmlFor={fieldId} className="whitespace-nowrap">{t(field.labelKey)}</Label>
                            <Input
                              id={fieldId}
                              data-testid={fieldId}
                              type={field.kind === 'password' ? 'password' : field.kind === 'number' ? 'number' : 'text'}
                              // Stop the browser/password manager autofilling the logged-in user's
                              // credentials into a connector's User/Password fields (this is not a login form).
                              autoComplete={field.kind === 'password' ? 'new-password' : 'off'}
                              value={val}
                              onChange={(e) => setDraft({ ...draft, dbConfig: { ...draft.dbConfig, [field.key]: e.target.value } })}
                              placeholder={field.kind === 'password' && isEdit ? t('settings.connectors.secretSet') : undefined}
                            />
                          </Fragment>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {/* Plugin selector */}
                      <Label htmlFor="connector-plugin" className="whitespace-nowrap">{t('settings.connectors.fieldPlugin')}</Label>
                      <Select value={draft.pluginId} onValueChange={(v) => setDraft({ ...draft, pluginId: v })}>
                        <SelectTrigger id="connector-plugin" data-testid="connector-plugin"><SelectValue placeholder={t('settings.connectors.pickPlugin')} /></SelectTrigger>
                        <SelectContent>
                          {plugins.map((p) => <SelectItem key={p.id} value={p.id}>{p.id}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {plugins.length === 0 ? (
                        <div className="col-span-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                          {t('settings.connectors.noPlugins')}
                        </div>
                      ) : null}
                      <Label htmlFor="connector-baseurl" className="whitespace-nowrap">{t('settings.connectors.fieldBaseUrl')}</Label>
                      <Input id="connector-baseurl" data-testid="connector-baseurl" autoComplete="off" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                        placeholder={draft.id === null ? 'https://external-system.example.org/api' : t('settings.connectors.secretSet')} />
                      <Label htmlFor="connector-username" className="whitespace-nowrap">{t('settings.connectors.fieldUsername')}</Label>
                      <Input id="connector-username" data-testid="connector-username" autoComplete="username" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                        placeholder={draft.id === null ? '' : t('settings.connectors.secretSet')} />
                      <Label htmlFor="connector-password" className="whitespace-nowrap">{t('settings.connectors.fieldPassword')}</Label>
                      <Input id="connector-password" data-testid="connector-password" type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                        placeholder={draft.id === null ? '' : t('settings.connectors.secretSet')} />
                    </>
                  )}

                  {draft.id !== null ? (
                    <div className="col-span-2 flex items-center gap-2">
                      <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} aria-label={t('settings.connectors.enabledLabel')} />
                      <Label className="text-muted-foreground">{t('settings.connectors.enabledLabel')}</Label>
                    </div>
                  ) : null}
                </div>
              </div>
              <SheetFooter className="border-t border-border px-6 py-4">
                <SheetClose asChild>
                  <Button variant="outline">{t('settings.connectors.cancel')}</Button>
                </SheetClose>
                <Button data-testid="connector-save" disabled={saveDisabled} onClick={() => void onSave()}>
                  {t('settings.connectors.save')}
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => { if (!o) setPendingRemove(null); }}
        title={t('settings.connectors.removeTitle', { name: pendingRemove?.name ?? '' })}
        description={t('settings.connectors.removeDescription')}
        confirmLabel={t('settings.connectors.remove')}
        destructive
        onConfirm={() => { void onRemove(); }}
      />
    </div>
  );
}
