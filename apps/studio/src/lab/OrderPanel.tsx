import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import type { ReceptionCoding, ReceptionOrder } from '@/api';
import { displayOf } from './useValueSet';

/** A key for one order: the same number may come from two facilities. */
export function orderKey(order: Pick<ReceptionOrder, 'requisition' | 'facility'>): string {
  return `${order.facility?.code ?? ''}|${order.requisition}`;
}

/** A stored date and time in the reader's language and time zone, or as stored when it does not parse. */
function localDateTime(value: string, language: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(language);
}

/** One found order on the Reception page: who sent it, for whom, its tests and its samples. Every
 *  action sits in the panel's ⋯ menu (AGENTS.md section 5). */
export function OrderPanel({ order, priorities, onReceive, onLinkPatient, onCorrect, onCancel }: {
  order: ReceptionOrder;
  /** The priority value set, so the panel shows a priority by its name. */
  priorities: ReceptionCoding[];
  onReceive: () => void;
  onLinkPatient: () => void;
  onCorrect: () => void;
  /** Offered for an order registered at the desk only. A form order is voided from its form entry. */
  onCancel: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const key = orderKey(order);
  const tests = order.tests.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <section className="rounded-md border border-border" data-testid={`order-panel-${key}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{order.requisition}</span>
            <Badge variant="outline">{t(`reception.origin.${order.origin}`)}</Badge>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('reception.panel.facility')}</dt>
            <dd className="break-words">{order.facility ? (order.facility.display ?? order.facility.code) : t('reception.panel.noFacility')}</dd>
            <dt className="text-muted-foreground">{t('reception.panel.patient')}</dt>
            <dd className="break-words">{order.patient ? order.patient.display : t('reception.panel.noPatient')}</dd>
            {order.priority && (
              <>
                <dt className="text-muted-foreground">{t('reception.panel.priority')}</dt>
                <dd>{displayOf(priorities, order.priority)}</dd>
              </>
            )}
            {order.clinician && (
              <>
                <dt className="text-muted-foreground">{t('reception.panel.clinician')}</dt>
                <dd className="break-words">{order.clinician}</dd>
              </>
            )}
            {order.note && (
              <>
                <dt className="text-muted-foreground">{t('reception.panel.note')}</dt>
                <dd className="break-words">{order.note}</dd>
              </>
            )}
          </dl>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`order-actions-${key}`} aria-label={t('reception.panel.actions')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid={`order-receive-${key}`} onSelect={onReceive}>{t('reception.panel.receive')}</DropdownMenuItem>
            <DropdownMenuItem data-testid={`order-link-${key}`} onSelect={onLinkPatient}>{t('reception.panel.linkPatient')}</DropdownMenuItem>
            <DropdownMenuItem data-testid={`order-correct-${key}`} onSelect={onCorrect}>{t('reception.panel.correct')}</DropdownMenuItem>
            {order.origin === 'lab-desk' && (
              <DropdownMenuItem data-testid={`order-cancel-${key}`} onSelect={onCancel}>{t('reception.panel.cancel')}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="border-t border-border" />
      {/* An order always has at least one test, so this table is never drawn empty. */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('reception.panel.test')}</TableHead>
            <TableHead>{t('reception.panel.code')}</TableHead>
            <TableHead>{t('reception.panel.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b">
          {tests.map((test) => (
            <TableRow key={`${test.serviceRequestId}|${test.system}|${test.code}`}>
              <TableCell>{test.display ?? test.code}</TableCell>
              <TableCell className="font-mono text-xs">{test.code}</TableCell>
              <TableCell>{t(`reception.status.${test.status}`, { defaultValue: test.status })}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={order.tests.length}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
      />

      <div className="border-t border-border px-4 py-3 text-sm">
        <div className="mb-1 font-medium">{t('reception.panel.samples')}</div>
        {order.specimens.length === 0 ? (
          <div className="text-muted-foreground">{t('reception.panel.noSamples')}</div>
        ) : (
          <ul className="flex flex-col gap-1" data-testid={`order-samples-${key}`}>
            {order.specimens.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-3">
                <span>{s.type ? (s.type.display ?? s.type.code) : t('reception.panel.noType')}</span>
                {s.condition && <span className="text-muted-foreground">{s.condition}</span>}
                {s.receivedTime && <span className="text-muted-foreground">{localDateTime(s.receivedTime, i18n.language)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
