import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { returnReceptionOrder, type ReceptionOrder } from '@/api';
import { ORDER_RETURN_REASON_VALUE_SET, useValueSet } from './useValueSet';

/** Returns an order to its site with a reason from the lab's return-reason set and an optional note
 *  (lab slice 3). Every live test goes on hold. The server refuses a desk order and one already on hold. */
export function ReturnOrderSheet({ order, onClose, onReturned, onCloseAutoFocus }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onReturned: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = order !== null;
  const reasons = useValueSet(ORDER_RETURN_REASON_VALUE_SET, open);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (order) { setReason(''); setNote(''); } }, [order]);

  const save = async (): Promise<void> => {
    if (!order) return;
    if (!reason) { toast.error(t('reception.return.needsReason')); return; }
    setBusy(true);
    try {
      const after = await returnReceptionOrder({
        requisition: order.requisition,
        facilityCode: order.facility?.code ?? null,
        reasonCode: reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t('reception.return.done', { number: after.requisition }));
      onReturned(after);
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
          <SheetTitle>{t('reception.return.title')}</SheetTitle>
          <SheetDescription>{t('reception.return.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{order?.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="return-sheet-menu" aria-label={t('reception.return.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="return-save" disabled={busy} onSelect={() => void save()}>{t('reception.return.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="return-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="return-reason" className="whitespace-nowrap">{t('reception.return.reason')}</Label>
            {reasons.unusable ? (
              <span id="return-reason" className="text-muted-foreground">{reasons.error ?? t('reception.noOptions')}</span>
            ) : (
              <Select value={reason || undefined} onValueChange={setReason} disabled={reasons.loading}>
                <SelectTrigger id="return-reason"><SelectValue placeholder={t('reception.return.choose')} /></SelectTrigger>
                <SelectContent>
                  {reasons.codes.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Label htmlFor="return-note" className="self-start whitespace-nowrap pt-2">{t('reception.return.note')}</Label>
            <Textarea id="return-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
