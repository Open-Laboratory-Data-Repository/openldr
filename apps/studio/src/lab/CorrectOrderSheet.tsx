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
import { correctReceptionOrder, type CorrectReceptionOrderInput, type ReceptionOrder } from '@/api';
import { PRIORITY_VALUE_SET, useValueSet } from './useValueSet';

/** Radix Select cannot hold an empty value, so "no priority" is this sentinel in the picker only. */
const NO_PRIORITY = '__none__';

/** Fixes a typo on an order: priority, clinician and note, with a reason. The number, facility and
 *  tests are part of the order's ids and cannot be changed here (lab module ruling 12). */
export function CorrectOrderSheet({ order, onClose, onCorrected }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onCorrected: (order: ReceptionOrder) => void;
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
    const changes: CorrectReceptionOrderInput['changes'] = {};
    const nextPriority = priority === NO_PRIORITY ? null : priority;
    if (nextPriority !== order.priority) changes.priority = nextPriority;
    const nextClinician = clinician.trim() || null;
    if (nextClinician !== order.clinician) changes.clinician = nextClinician;
    const nextNote = note.trim() || null;
    if (nextNote !== order.note) changes.note = nextNote;
    if (Object.keys(changes).length === 0) { toast.error(t('reception.correct.nothing')); return; }
    if (!reason.trim()) { toast.error(t('reception.correct.needsReason')); return; }
    setBusy(true);
    try {
      const after = await correctReceptionOrder({
        requisition: order.requisition, facilityCode: order.facility?.code ?? null, changes, reason: reason.trim(),
      });
      toast.success(t('reception.correct.done', { number: after.requisition }));
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
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('reception.correct.title')}</SheetTitle>
          <SheetDescription>{t('reception.correct.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{order?.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="correct-sheet-menu" aria-label={t('reception.correct.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="correct-save" disabled={busy} onSelect={() => void save()}>{t('reception.correct.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="correct-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="correct-priority" className="whitespace-nowrap">{t('reception.correct.priority')}</Label>
            <Select value={priority} onValueChange={setPriority} disabled={priorities.loading}>
              <SelectTrigger id="correct-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRIORITY}>{priorities.error ?? t('reception.correct.noPriority')}</SelectItem>
                {offered.map((p) => <SelectItem key={p.code} value={p.code}>{p.display ?? p.code}</SelectItem>)}
              </SelectContent>
            </Select>
            <Label htmlFor="correct-clinician" className="whitespace-nowrap">{t('reception.correct.clinician')}</Label>
            <Input id="correct-clinician" value={clinician} onChange={(e) => setClinician(e.target.value)} />
            <Label htmlFor="correct-note" className="self-start whitespace-nowrap pt-2">{t('reception.correct.note')}</Label>
            <Textarea id="correct-note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Label htmlFor="correct-reason" className="self-start whitespace-nowrap pt-2">{t('reception.correct.reason')}</Label>
            <Textarea id="correct-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
