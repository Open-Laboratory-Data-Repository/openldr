import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { rejectReceptionTest, type ReceptionOrder } from '@/api';
import { TEST_REJECT_REASON_VALUE_SET, useValueSet } from './useValueSet';

/** One test of an order, picked from its row's menu. */
export interface RejectTestTarget {
  order: ReceptionOrder;
  test: ReceptionOrder['tests'][number];
}

/** Rejects one test of an order, leaving its other tests alone (lab slice 3, ruling 6). The reason
 *  comes from the lab's test-reject set. A redraw is asked by default (ruling 7). */
export function RejectTestSheet({ target, onClose, onRejected, onCloseAutoFocus }: {
  target: RejectTestTarget | null;
  onClose: () => void;
  onRejected: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = target !== null;
  const reasons = useValueSet(TEST_REJECT_REASON_VALUE_SET, open);
  const [reason, setReason] = useState('');
  const [redraw, setRedraw] = useState(true);
  const [busy, setBusy] = useState(false);
  const name = target ? (target.test.display ?? target.test.code) : '';

  useEffect(() => { if (target) { setReason(''); setRedraw(true); } }, [target]);

  const save = async (): Promise<void> => {
    if (!target) return;
    if (!reason) { toast.error(t('reception.rejectTest.chooseReason')); return; }
    setBusy(true);
    try {
      const after = await rejectReceptionTest({ serviceRequestId: target.test.serviceRequestId, reasonCode: reason, redraw });
      toast.success(t('reception.rejectTest.done', { test: name }));
      onRejected(after);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('reception.rejectTest.title')}</SheetTitle>
          <SheetDescription>{t('reception.rejectTest.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{target?.order.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="reject-test-sheet-menu" aria-label={t('reception.rejectTest.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="reject-test-save" disabled={busy} onSelect={() => void save()}>{t('reception.rejectTest.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="reject-test-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <span className="whitespace-nowrap font-medium">{t('reception.rejectTest.test')}</span>
            <span className="break-words">{name}</span>

            <Label htmlFor="reject-test-reason" className="whitespace-nowrap">{t('reception.rejectTest.reason')}</Label>
            {reasons.unusable ? (
              <span id="reject-test-reason" className="text-muted-foreground">{reasons.error ?? t('reception.noOptions')}</span>
            ) : (
              <Select value={reason || undefined} onValueChange={setReason} disabled={reasons.loading}>
                <SelectTrigger id="reject-test-reason"><SelectValue placeholder={t('reception.rejectTest.choose')} /></SelectTrigger>
                <SelectContent>
                  {reasons.codes.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <span className="whitespace-nowrap font-medium">{t('reception.rejectTest.redraw')}</span>
            <div className="flex items-center gap-3">
              <Switch checked={redraw} onCheckedChange={setRedraw} aria-label={t('reception.rejectTest.redraw')} data-testid="reject-test-redraw" />
              <span className="text-muted-foreground">{t(redraw ? 'reception.rejectTest.redrawOn' : 'reception.rejectTest.redrawOff')}</span>
            </div>
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
