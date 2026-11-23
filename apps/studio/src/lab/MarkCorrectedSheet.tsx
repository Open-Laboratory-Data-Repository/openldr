import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { markReceptionOrderCorrected, type MarkReceptionOrderCorrectedInput, type ReceptionOrder } from '@/api';
import { PRIORITY_VALUE_SET, useValueSet } from './useValueSet';

/** Radix Select cannot hold an empty value, so "no priority" is this sentinel in the picker only. */
const NO_PRIORITY = '__none__';

/** Takes back an order the lab returned to its site (lab slice 3, ruling 1). It applies the site's
 *  corrections to the priority, clinician and note, takes every test off hold and completes the return
 *  Task. No field needs to change: the site may have fixed something these fields do not hold. */
export function MarkCorrectedSheet({ order, onClose, onCorrected, onCloseAutoFocus }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onCorrected: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = order !== null;
  const priorities = useValueSet(PRIORITY_VALUE_SET, open);
  const [priority, setPriority] = useState(NO_PRIORITY);
  const [clinician, setClinician] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) return;
    setPriority(order.priority ?? NO_PRIORITY);
    setClinician(order.clinician ?? '');
    setNote(order.note ?? '');
    setReason('');
  }, [order]);

  const save = async (): Promise<void> => {
    if (!order) return;
    if (!reason.trim()) { toast.error(t('reception.corrected.needsReason')); return; }
    const changes: MarkReceptionOrderCorrectedInput['changes'] = {};
    const nextPriority = priority === NO_PRIORITY ? null : priority;
    if (nextPriority !== order.priority) changes.priority = nextPriority;
    const nextClinician = clinician.trim() || null;
    if (nextClinician !== order.clinician) changes.clinician = nextClinician;
    const nextNote = note.trim() || null;
    if (nextNote !== order.note) changes.note = nextNote;
    setBusy(true);
    try {
      const after = await markReceptionOrderCorrected({
        requisition: order.requisition, facilityCode: order.facility?.code ?? null, changes, reason: reason.trim(),
      });
      toast.success(t('reception.corrected.done', { number: after.requisition }));
      onCorrected(after);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The order's own priority stays offered even when the value set does not hold it.
  const offered = priorities.codes.some((p) => p.code === order?.priority) || !order?.priority
    ? priorities.codes
    : [...priorities.codes, { system: '', code: order.priority, display: order.priority }];

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('reception.corrected.title')}</SheetTitle>
          <SheetDescription>{t('reception.corrected.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{order?.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="corrected-sheet-menu" aria-label={t('reception.corrected.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="corrected-save" disabled={busy} onSelect={() => void save()}>{t('reception.corrected.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="corrected-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="corrected-priority" className="whitespace-nowrap">{t('reception.corrected.priority')}</Label>
            <div className="flex flex-col gap-1">
              <Select value={priority} onValueChange={setPriority} disabled={priorities.loading}>
                <SelectTrigger id="corrected-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRIORITY}>{t('reception.corrected.noPriority')}</SelectItem>
                  {offered.map((p) => <SelectItem key={p.code} value={p.code}>{p.display ?? p.code}</SelectItem>)}
                </SelectContent>
              </Select>
              {priorities.unusable && <span className="text-xs text-muted-foreground">{priorities.error ?? t('reception.noOptions')}</span>}
            </div>
            <Label htmlFor="corrected-clinician" className="whitespace-nowrap">{t('reception.corrected.clinician')}</Label>
            <Input id="corrected-clinician" value={clinician} onChange={(e) => setClinician(e.target.value)} />
            <Label htmlFor="corrected-note" className="self-start whitespace-nowrap pt-2">{t('reception.corrected.note')}</Label>
            <Textarea id="corrected-note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Label htmlFor="corrected-reason" className="self-start whitespace-nowrap pt-2">{t('reception.corrected.reason')}</Label>
            <Textarea id="corrected-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
