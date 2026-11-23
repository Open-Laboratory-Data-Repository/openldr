import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ClipboardList, FileInput, MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadFailed, useLoadErrorToast } from '@/components/ui/load-failed';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, applyTableState, useTableState, type ColumnDef,
} from '@/components/data-table';
import { createForm, deleteForm, duplicateForm, exportFormBundle, formQuestionnaireUrl, listForms, publishForm, setFormStatus, type FormDefinition, type FormStatus, type FormSummary } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { formCreateFromImport } from './form-import';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** Confirmation-toast key for the status a row was just moved to. */
const STATUS_TOAST_KEY: Record<FormStatus, string> = {
  draft: 'forms.toastDrafted',
  published: 'forms.toastPublished',
  archived: 'forms.toastArchived',
};

function StatusBadge({ status }: { status: FormStatus }) {
  const { t } = useTranslation();
  if (status === 'published') return <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">{t('forms.statusPublished')}</Badge>;
  if (status === 'archived') return <Badge variant="outline" className="text-muted-foreground">{t('forms.statusArchived')}</Badge>;
  return <Badge variant="secondary">{t('forms.statusDraft')}</Badge>;
}

function toSummary(form: FormDefinition): FormSummary {
  const fields = (form.schema as { fields?: unknown[] } | null)?.fields ?? [];
  const fieldCount = Array.isArray(fields) ? fields.length : 0;
  return {
    id: form.id,
    name: form.name,
    versionLabel: form.versionLabel,
    status: form.status,
    active: form.active,
    fhirResourceType: form.fhirResourceType,
    targetPages: form.targetPages,
    fieldCount,
    updatedAt: form.updatedAt,
  };
}

// A form is submittable standalone from the Forms page only when it isn't allocated to
// another page (no target pages, or it explicitly targets the generic 'forms' page).
// Forms allocated to a specific page (users/patients/orders/facilities) are submitted from
// THAT page, so opening one here goes to the builder to edit the template, not a run view.
function isStandalone(targetPages: string[] | null | undefined): boolean {
  return !targetPages || targetPages.length === 0 || targetPages.includes('forms');
}

function rowHref(form: FormSummary): string {
  return isStandalone(form.targetPages) ? `/forms/${form.id}` : `/forms/${form.id}/builder`;
}

function upsertForm(rows: FormSummary[], form: FormSummary): FormSummary[] {
  const index = rows.findIndex((row) => row.id === form.id);
  if (index === -1) return [...rows, form].sort((a, b) => a.name.localeCompare(b.name));
  const copy = [...rows];
  copy[index] = form;
  return copy;
}

// Module level — stable, outside the component.
const SEARCH_FIELDS = [(f: FormSummary) => f.name, (f: FormSummary) => f.fhirResourceType ?? ''];

export function Forms() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canEdit = useAuth().hasCapability('forms.edit');
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load. Cleared only by a load that works, so a reload that fails the same way does not toast again.
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<FormSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listForms());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLoadErrorToast(error);
  const actionFailed = (err: unknown) => { toast.error(err instanceof Error ? err.message : String(err)); };

  const columns: ColumnDef<FormSummary>[] = useMemo(() => [
    {
      id: 'name', labelKey: 'forms.colName', type: 'text', defaultVisible: true,
      accessor: (f) => (
        <div className="flex items-center gap-2 font-medium">
          <FileInput className="h-4 w-4 text-muted-foreground" />
          {f.name}
        </div>
      ),
    },
    {
      id: 'fhirResourceType', labelKey: 'forms.colFhirType', type: 'text', defaultVisible: true,
      accessor: (f) => (f.fhirResourceType ? <Badge variant="outline">{f.fhirResourceType}</Badge> : <span className="text-muted-foreground">{t('forms.custom')}</span>),
    },
    { id: 'fieldCount', labelKey: 'forms.colFields', type: 'number', defaultVisible: true, cellClassName: 'text-muted-foreground', accessor: (f) => f.fieldCount },
    { id: 'versionLabel', labelKey: 'forms.colVersion', type: 'text', defaultVisible: true, cellClassName: 'text-muted-foreground', accessor: (f) => f.versionLabel || '-' },
    {
      id: 'status', labelKey: 'forms.colStatus', type: 'enum', defaultVisible: true,
      accessor: (f) => <StatusBadge status={f.status} />,
      enumOptions: [
        { value: 'draft', labelKey: 'forms.statusDraft' },
        { value: 'published', labelKey: 'forms.statusPublished' },
        { value: 'archived', labelKey: 'forms.statusArchived' },
      ],
    },
    {
      id: 'active', labelKey: 'forms.colActive', type: 'enum', defaultVisible: true,
      accessor: (f) => (f.active ? <Badge variant="secondary">{t('forms.active')}</Badge> : <span className="text-muted-foreground">{t('forms.inactive')}</span>),
      enumOptions: [{ value: 'true', labelKey: 'forms.active' }, { value: 'false', labelKey: 'forms.inactive' }],
    },
    { id: 'updatedAt', labelKey: 'forms.colUpdated', type: 'date', defaultVisible: true, cellClassName: 'text-xs text-muted-foreground', accessor: (f) => formatDate(f.updatedAt) },
  ], [t]);

  const valueGetters = useMemo(() => ({
    name: (f: FormSummary) => f.name,
    fhirResourceType: (f: FormSummary) => f.fhirResourceType ?? '',
    fieldCount: (f: FormSummary) => f.fieldCount,
    versionLabel: (f: FormSummary) => f.versionLabel ?? '',
    status: (f: FormSummary) => f.status,
    active: (f: FormSummary) => String(f.active),
    updatedAt: (f: FormSummary) => f.updatedAt ?? '',
  }), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  // Free-text search is applied BEFORE applyTableState, never as a filter rule.
  // applyTableState folds rules flat, left-to-right (applyTableState.ts:80-92), so appending a
  // multi-field OR search would discard an active popover filter for rows matching only the
  // trailing OR term. Pre-filtering keeps the semantics `search AND (popover rules)`.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => SEARCH_FIELDS.some((f) => (f(r) ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  const view = useMemo(
    () => applyTableState(searched, { filters: table.filters, sorts: table.sorts, page: table.page, pageSize: table.pageSize }, columns, valueGetters),
    [searched, table.filters, table.sorts, table.page, table.pageSize, columns, valueGetters],
  );

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const input = formCreateFromImport(parsed);
      if (!input) {
        toast.error(t('forms.importNeedsName'));
        return;
      }
      const created = await createForm(input);
      setRows((prev) => upsertForm(prev, toSummary(created)));
      table.setPage(0);
      toast.success(t('forms.toastImported', { name: created.name }));
    } catch (err) {
      actionFailed(err);
    }
  };

  const changeStatus = async (form: FormSummary, status: FormStatus) => {
    try {
      const updated = await setFormStatus(form.id, status);
      setRows((prev) => upsertForm(prev, toSummary(updated)));
      toast.success(t(STATUS_TOAST_KEY[status], { name: updated.name }));
    } catch (err) {
      actionFailed(err);
    }
  };

  const publish = async (form: FormSummary) => {
    try {
      const updated = await publishForm(form.id, { versionLabel: form.versionLabel ?? null });
      setRows((prev) => upsertForm(prev, toSummary(updated)));
      toast.success(t('forms.toastPublished', { name: updated.name }));
    } catch (err) {
      actionFailed(err);
    }
  };

  const duplicate = async (form: FormSummary) => {
    try {
      const copy = await duplicateForm(form.id);
      setRows((prev) => upsertForm(prev, toSummary(copy)));
      table.setPage(0);
      toast.success(t('forms.toastDuplicated', { name: form.name, copy: copy.name }));
    } catch (err) {
      actionFailed(err);
    }
  };

  const exportBundle = async (form: FormSummary) => {
    try {
      await exportFormBundle(form.id);
    } catch (err) {
      actionFailed(err);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteForm(deleting.id);
      setRows((prev) => prev.filter((row) => row.id !== deleting.id));
      toast.success(t('forms.toastDeleted', { name: deleting.name }));
      setDeleting(null);
    } catch (err) {
      actionFailed(err);
    }
  };

  return (
    <AppShell title={t('nav.forms')} fullBleed>
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
            searchPlaceholder={t('forms.searchPlaceholder')}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('forms.pageActions')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit ? <DropdownMenuItem onClick={() => navigate('/forms/new')}>{t('forms.new')}</DropdownMenuItem> : null}
                  {canEdit ? <DropdownMenuItem onClick={() => fileRef.current?.click()}>{t('forms.import')}</DropdownMenuItem> : null}
                  <DropdownMenuItem onClick={() => { void load(); }}>{t('forms.refresh')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t('forms.importAria')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void importJson(file);
            }}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Table wrapperClassName={view.rows.length > 0 ? 'min-h-0 flex-1' : undefined}>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            {!loading && view.rows.length > 0 && (
            <TableBody className="[&_tr:last-child]:border-b">
                {view.rows.map((form) => (
                  <TableRow key={form.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => navigate(rowHref(form))}>
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(form)}</TableCell>)}
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t('forms.rowActions', { name: form.name })}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/forms/${form.id}`)}>{t('forms.viewRun')}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => navigate(`/forms/${form.id}/builder`)}>{t('forms.editBuilder')}</DropdownMenuItem>
                          {canEdit ? <DropdownMenuItem onClick={() => { void duplicate(form); }}>{t('forms.duplicate')}</DropdownMenuItem> : null}
                          <DropdownMenuItem onClick={() => navigate(`/forms/${form.id}/builder`)}>{t('forms.compare')}</DropdownMenuItem>
                          {canEdit ? <DropdownMenuItem onClick={() => { void publish(form); }} disabled={form.status === 'published'}>{t('forms.publish')}</DropdownMenuItem> : null}
                          {canEdit ? <DropdownMenuItem onClick={() => { void changeStatus(form, 'archived'); }} disabled={form.status === 'archived'}>{t('forms.archive')}</DropdownMenuItem> : null}
                          <DropdownMenuItem asChild>
                            <a href={formQuestionnaireUrl(form.id)} download={`${form.name}.questionnaire.json`}>{t('forms.export')}</a>
                          </DropdownMenuItem>
                          {form.status === 'published' ? (
                            <DropdownMenuItem
                              data-testid={`export-bundle-${form.id}`}
                              onClick={() => { void exportBundle(form); }}
                            >
                              {t('forms.exportBundle')}
                            </DropdownMenuItem>
                          ) : null}
                          {canEdit ? <DropdownMenuItem onClick={() => setDeleting(form)}>{t('forms.delete')}</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
            )}
          </Table>
          {loading && <LoadingState className="flex-1" label="Loading…" />}
          {!loading && error && rows.length === 0 && <LoadFailed />}
          {!loading && !(error && rows.length === 0) && view.rows.length === 0 && (
            rows.length === 0 ? (
              <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={t('forms.emptyTitle')} />
            ) : (
              <StripedEmpty className="flex-1">{t('forms.noMatch')}</StripedEmpty>
            )
          )}
        </div>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={view.total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          leftSlot={<span className="text-muted-foreground">{view.total} forms</span>}
        />

        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(open) => { if (!open) setDeleting(null); }}
          title={t('forms.deleteTitle')}
          description={deleting ? t('forms.deleteBody', { name: deleting.name }) : undefined}
          confirmLabel={t('forms.delete')}
          destructive
          onConfirm={() => { void confirmDelete(); }}
        />
      </div>
    </AppShell>
  );
}
