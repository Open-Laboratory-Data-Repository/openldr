import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { checkWorkflowReceiptContinue, continueWorkflowReceipt, fetchWorkflowReceipt, fetchWorkflowReceipts, type WorkflowReceipt } from '@/api';
import { InterruptionBadge } from '@/components/ui/interruption-badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';

export function ReceiptHistory({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<WorkflowReceipt[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    const request = requestId
      ? fetchWorkflowReceipt(workflowId, requestId).then((value) => { if (active) setDetail(value); })
      : fetchWorkflowReceipts(workflowId, { limit: pageSize + 1, offset: page * pageSize })
        .then((value) => { if (active) setRows(value); });
    void request.catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workflowId, page, pageSize, requestId, reload]);

  const visible = rows.slice(0, pageSize);
  // Continue on an interrupted run: a new run with the stored input. Never automatic, because the cut
  // run may already have sent an email or called another system (design 2026-11-18-interrupted-jobs).
  // A run of a workflow that changed since the cut is asked about first (review R5).
  const [confirmChanged, setConfirmChanged] = useState<WorkflowReceipt | null>(null);
  const askThenContinue = async (receipt: WorkflowReceipt) => {
    try {
      const { definitionChanged } = await checkWorkflowReceiptContinue(workflowId, receipt.id);
      if (definitionChanged) setConfirmChanged(receipt);
      else await continueRun(receipt);
    } catch (err) {
      toast.error(t('workflowReceipts.continueFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };
  const continueRun = async (receipt: WorkflowReceipt) => {
    try {
      const { runId, definitionChanged } = await continueWorkflowReceipt(workflowId, receipt.id);
      toast.success(t(definitionChanged ? 'workflowReceipts.continuedChanged' : 'workflowReceipts.continued', { runId }));
      setReload((v) => v + 1);
    } catch (err) {
      toast.error(t('workflowReceipts.continueFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : t('workflowReceipts.notRecorded');
  const status = (value: WorkflowReceipt['status']) => (
    <Badge variant="outline" className={value === 'interrupted' || value === 'failed' ? 'border-destructive/40 text-destructive' : ''}>
      {t(`workflowReceipts.statuses.${value}`)}
    </Badge>
  );

  return <div className="flex min-h-0 flex-1 flex-col">
    <ConfirmDialog open={confirmChanged !== null} onOpenChange={(o) => { if (!o) setConfirmChanged(null); }}
      title={t('workflowReceipts.confirmChangedTitle')} description={t('workflowReceipts.confirmChangedBody')}
      confirmLabel={t('workflowReceipts.continue')}
      onConfirm={() => { const r = confirmChanged; setConfirmChanged(null); if (r) void continueRun(r); }} />
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
      <p className="text-xs text-muted-foreground">{t(requestId ? 'workflowReceipts.detail' : 'workflowReceipts.acceptedHint')}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="shrink-0" aria-label={t('workflowReceipts.actions')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={loading} onSelect={() => setReload((v) => v + 1)}>{t('workflowReceipts.refresh')}</DropdownMenuItem>
          {requestId && <DropdownMenuItem onSelect={() => { setRequestId(null); setDetail(null); }}>{t('workflowReceipts.back')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {loading ? <LoadingState className="min-h-[16rem] flex-1 [&>svg]:hidden" />
      : error ? <p role="alert" className="min-h-[16rem] flex-1 p-4 text-sm text-destructive">{t('workflowReceipts.loadError')}</p>
      : requestId && detail ? <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {detail.status === 'interrupted' && <p className="mb-4 text-sm text-destructive">{t('workflowReceipts.interruptedHint')}</p>}
        {detail.status === 'failed' && <p className="mb-4 text-sm text-muted-foreground">{t('workflowReceipts.failedHint')}</p>}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 text-xs [&>dd]:min-w-0 [&>dd]:break-words [&>dt]:text-muted-foreground">
          <dt>{t('workflowReceipts.requestId')}</dt><dd className="font-mono">{detail.id}</dd>
          <dt>{t('workflowReceipts.status')}</dt><dd>{status(detail.status)}</dd>
          <dt>{t('workflowReceipts.created')}</dt><dd>{date(detail.createdAt)}</dd>
          <dt>{t('workflowReceipts.started')}</dt><dd>{date(detail.startedAt)}</dd>
          <dt>{t('workflowReceipts.finished')}</dt><dd>{date(detail.finishedAt)}</dd>
          <dt>{t('workflowReceipts.runId')}</dt><dd className="font-mono">{detail.runId ?? t('workflowReceipts.notRecorded')}</dd>
          {detail.reason && <><dt>{t('workflowReceipts.reason')}</dt><dd>{detail.reason}</dd></>}
          {detail.outcome?.error && <><dt>{t('workflowReceipts.error')}</dt><dd>{detail.outcome.error}</dd></>}
        </dl>
      </div>
      : visible.length === 0 ? <StripedEmpty className="min-h-[16rem] flex-1">{t('workflowReceipts.empty')}</StripedEmpty>
      : <Table wrapperClassName="min-h-0 flex-1" className="min-h-[16rem] table-fixed">
        <TableHeader><TableRow>
          <TableHead>{t('workflowReceipts.requestId')}</TableHead><TableHead>{t('workflowReceipts.status')}</TableHead>
          <TableHead>{t('workflowReceipts.created')}</TableHead><TableHead className="w-12"><span className="sr-only">{t('common.actions')}</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{visible.map((receipt) => <TableRow key={receipt.id}>
          <TableCell className="break-all font-mono text-xs">{receipt.id}</TableCell>
          <TableCell><div className="flex flex-wrap items-center gap-1">{status(receipt.status)}<InterruptionBadge interruptions={receipt.interruptions} /></div></TableCell><TableCell className="break-words text-xs">{date(receipt.createdAt)}</TableCell>
          <TableCell className="p-0"><DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('workflowReceipts.rowActions', { id: receipt.id })}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setDetail(null); setRequestId(receipt.id); }}>{t('workflowReceipts.view')}</DropdownMenuItem>
              {receipt.status === 'interrupted' && <DropdownMenuItem onSelect={() => { void askThenContinue(receipt); }}>{t('workflowReceipts.continue')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu></TableCell>
        </TableRow>)}</TableBody>
      </Table>}
    {!requestId && <TablePagination page={page} pageSize={pageSize} total={null} rowCount={loading || error ? 0 : visible.length}
      hasMore={!loading && !error && rows.length > pageSize} onPageChange={setPage}
      onPageSizeChange={(value) => { setPageSize(value); setPage(0); }} />}
  </div>;
}
