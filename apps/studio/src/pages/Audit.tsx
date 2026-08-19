import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Copy, MoreHorizontal } from 'lucide-react';
import { AUDIT_COLUMNS } from '@openldr/table-query';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  ActiveFilterChips, DataTableToolbar, useTableState, type ColumnDef,
} from '@/components/data-table';
import { getAuditEvent, queryAudit, type AuditEvent } from '@/api';
import { JsonView } from '@/workflows/components/panels/json-view';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function ActionBadge({ action }: { action: string }) {
  const category = action.split('.')[0];
  const destructive = category === 'tamper' || category === 'delete' || action.endsWith('.delete');
  return (
    <Badge variant={destructive ? 'default' : 'secondary'} className={destructive ? 'border-transparent bg-destructive text-destructive-foreground' : undefined}>
      {action}
    </Badge>
  );
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={() => copyText(value)} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string | undefined | null; mono?: boolean }) {
  const text = value && value.trim() ? value : 'None';
  return (
    <div className="grid grid-cols-[8rem_1fr_auto] items-start gap-3 border-b border-border px-4 py-2 last:border-b-0">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className={mono ? 'break-all font-mono text-xs' : 'break-words text-sm'}>{text}</div>
      {value && value.trim() ? <CopyButton value={value} label={label} /> : <div className="h-7 w-7" />}
    </div>
  );
}

function JsonSection({ title, value }: { title: string; value?: unknown }) {
  const hasValue = value != null;
  return (
    <section className="border-t border-border">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      </div>
      <div className="mx-4 mb-4">
        {hasValue ? (
          // Read-only, theme-aware CodeMirror JSON viewer (its own copy button lives
          // top-right). max-h-72 + internal scroller keeps long payloads inside the sheet.
          <JsonView data={value} emptyLabel="None recorded." />
        ) : (
          <p className="text-xs text-muted-foreground">None recorded.</p>
        )}
      </div>
    </section>
  );
}

function AuditEventSheet({ event, onOpenChange }: { event: AuditEvent | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{event ? event.action : 'Audit event'}</SheetTitle>
          <SheetDescription>
            {event ? `${formatTimestamp(event.occurredAt)} by ${event.actorName}` : 'Audit event details'}
          </SheetDescription>
        </SheetHeader>
        {event ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-border">
              <DetailRow label="Event ID" value={event.id} mono />
              <DetailRow label="Timestamp" value={event.occurredAt} mono />
              <DetailRow label="Actor" value={`${event.actorName}${event.actorId ? ` (${event.actorId})` : ''}`} />
              <DetailRow label="Actor type" value={event.actorType} mono />
              <DetailRow label="Action" value={event.action} mono />
              <DetailRow label="Entity type" value={event.entityType} mono />
              <DetailRow label="Entity ID" value={event.entityId} mono />
            </div>
            <JsonSection title="Before" value={event.before} />
            <JsonSection title="After" value={event.after} />
            <JsonSection title="Metadata" value={event.metadata} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function Audit() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  // actorName leads the column list (not occurredAt) so the Filter popover's "add filter"
  // default — first filterable column, first operator (FilterPopover.tsx:141-149) — lands on a
  // plain text input. A date column there defaults to `eq`, which renders a DatePicker button
  // with no "Enter value" labeled input, breaking addFilterViaPopover in every test that follows
  // this page as a model. See date-picker.tsx: it exposes no text input at all.
  const columns: ColumnDef<AuditEvent>[] = useMemo(() => ([
    {
      id: 'actorName', labelKey: 'audit.colActor', type: 'text', defaultVisible: true, headClassName: 'w-40 text-xs uppercase',
      accessor: (e) => <span className="text-sm">{e.actorName}</span>,
      operators: AUDIT_COLUMNS.actorName!.operators,
    },
    {
      id: 'occurredAt', labelKey: 'audit.colOccurred', type: 'date', defaultVisible: true, headClassName: 'w-48 text-xs uppercase',
      accessor: (e) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatTimestamp(e.occurredAt)}</span>,
      operators: AUDIT_COLUMNS.occurredAt!.operators,
    },
    {
      id: 'action', labelKey: 'audit.colAction', type: 'text', defaultVisible: true, headClassName: 'w-48 text-xs uppercase',
      accessor: (e) => <ActionBadge action={e.action} />,
      operators: AUDIT_COLUMNS.action!.operators,
    },
    {
      id: 'entityType', labelKey: 'audit.colEntityType', type: 'text', defaultVisible: true, headClassName: 'w-36 text-xs uppercase',
      accessor: (e) => <span className="font-mono text-xs">{e.entityType}</span>,
      operators: AUDIT_COLUMNS.entityType!.operators,
    },
    {
      id: 'entityId', labelKey: 'audit.colEntityId', type: 'text', defaultVisible: true,
      accessor: (e) => <span className="font-mono text-xs text-muted-foreground">{e.entityId}</span>,
      operators: AUDIT_COLUMNS.entityId!.operators,
    },
  ]), []);

  const table = useTableState({ columns, defaultPageSize: 25 });

  // Server-paginated: filters, sorts, page and pageSize all travel to the server. The response
  // is rendered exactly as returned — this page never calls applyTableState.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await queryAudit({
        filters: table.filters,
        sorts: table.sorts,
        limit: table.pageSize,
        offset: table.page * table.pageSize,
      });
      setEvents(result.events);
      setTotal(result.total);
    } catch (err) {
      setEvents([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [table.filters, table.sorts, table.page, table.pageSize]);

  useEffect(() => { void load(); }, [load]);

  const openEvent = async (event: AuditEvent) => {
    setSelected(event);
    try {
      setSelected(await getAuditEvent(event.id));
    } catch {
      setSelected(event);
    }
  };

  return (
    <AppShell title={t('nav.audit')} fullBleed>
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
            onResetAll={table.resetAll}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('audit.actions')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { void load(); }}>{t('audit.refresh')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!loading && !error && events.length > 0 && (
            <Table wrapperClassName="min-h-0 flex-1" className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b">
                {events.map((event) => (
                  <TableRow key={event.id} className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]" onClick={() => { void openEvent(event); }} title="Open audit event details">
                    {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(event)}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {loading && <LoadingState className="flex-1" label={t('common.loading')} />}
          {!loading && error && <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>}
          {!loading && !error && events.length === 0 && (
            table.filters.length === 0 ? (
              <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="No audit events" />
            ) : (
              <StripedEmpty className="flex-1">{t('audit.noMatch')}</StripedEmpty>
            )
          )}
        </div>

        <TablePagination
          page={table.page}
          pageSize={table.pageSize}
          total={total}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          leftSlot={<span className="text-muted-foreground">{total} events</span>}
        />

        <AuditEventSheet event={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
      </div>
    </AppShell>
  );
}
