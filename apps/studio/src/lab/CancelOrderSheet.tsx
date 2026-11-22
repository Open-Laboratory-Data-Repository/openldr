import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cancelReceptionOrder, type ReceptionOrder } from '@/api';

/** Cancels an order registered at the desk, with a reason, so its number can be registered again
 *  (lab module rulings 21 and 22). The server refuses a form order. */
export function CancelOrderSheet({ order, onClose, onCancelled, onCloseAutoFocus }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onCancelled: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = order !== null;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (order) setReason(''); }, [order]);

  const save = async (): Promise<void> => {
    if (!order) return;
    if (!reason.trim()) { toast.error(t('reception.cancel.needsReason')); return; }
    setBusy(true);
    try {
      const after = await cancelReceptionOrder({
        requisition: order.requisition, facilityCode: order.facility?.code ?? null, reason: reason.trim(),
      });
      toast.success(t('reception.cancel.done', { number: after.requisition }));
      onCancelled(after);
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
          <SheetTitle>{t('reception.cancel.title')}</SheetTitle>
          <SheetDescription>{t('reception.cancel.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{order?.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="cancel-sheet-menu" aria-label={t('reception.cancel.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="cancel-save" disabled={busy} onSelect={() => void save()}>{t('reception.cancel.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="cancel-close" onSelect={onClose}>{t('common.close')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="cancel-reason" className="whitespace-nowrap pt-2">{t('reception.cancel.reason')}</Label>
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
