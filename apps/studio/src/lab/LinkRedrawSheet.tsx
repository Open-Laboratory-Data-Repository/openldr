import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { linkReceptionRedraw, type ReceptionOrder } from '@/api';

/** Marks this order as the redraw of a rejected order from the same facility (lab slice 3, ruling 4).
 *  A redraw has its own new number, so the desk types the old one here. */
export function LinkRedrawSheet({ order, onClose, onLinked, onCloseAutoFocus }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onLinked: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = order !== null;
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (order) setNumber(''); }, [order]);

  const save = async (): Promise<void> => {
    if (!order) return;
    const old = number.trim();
    if (!old) { toast.error(t('reception.redraw.needsNumber')); return; }
    setBusy(true);
    try {
      const after = await linkReceptionRedraw({
        requisition: order.requisition, facilityCode: order.facility?.code ?? null, replacesRequisition: old,
      });
      toast.success(t('reception.redraw.done', { number: after.requisition, old }));
      onLinked(after);
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
          <SheetTitle>{t('reception.redraw.title')}</SheetTitle>
          <SheetDescription>{t('reception.redraw.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{order?.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="redraw-sheet-menu" aria-label={t('reception.redraw.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="redraw-save" disabled={busy} onSelect={() => void save()}>{t('reception.redraw.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="redraw-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="redraw-number" className="whitespace-nowrap">{t('reception.redraw.number')}</Label>
            <Input id="redraw-number" className="font-mono" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
