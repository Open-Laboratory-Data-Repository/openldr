import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Switch } from '@/components/ui/switch';
import { receptionSampleChoices, rejectReceptionSample, type ReceptionCoding, type ReceptionOrder } from '@/api';
import { ORDER_REJECT_REASON_VALUE_SET, SAMPLE_CONDITION_VALUE_SET, useValueSet } from './useValueSet';

const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;

/** The type to start on: a received sample's type when exactly one of the offered types was received,
 *  else the only type offered, else none. */
function startType(order: ReceptionOrder, types: ReceptionCoding[]): string {
  const received = types.filter((x) => order.specimens.some((s) => s.type && keyOf(s.type) === keyOf(x)));
  if (received.length === 1) return keyOf(received[0]!);
  return types.length === 1 ? keyOf(types[0]!) : '';
}

/** Rejects an unfit sample (lab slice 3, ruling 5). The type is one the order's tests take, received or
 *  still expected. Every test the sample serves is rejected. A redraw is asked by default (ruling 7). */
export function RejectSampleSheet({ order, onClose, onRejected, onCloseAutoFocus }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onRejected: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = order !== null;
  const conditions = useValueSet(SAMPLE_CONDITION_VALUE_SET, open);
  const reasons = useValueSet(ORDER_REJECT_REASON_VALUE_SET, open);
  const [types, setTypes] = useState<ReceptionCoding[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [type, setType] = useState('');
  const [condition, setCondition] = useState('');
  const [reason, setReason] = useState('');
  const [redraw, setRedraw] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) return undefined;
    let live = true;
    setTypes([]); setType(''); setCondition(''); setReason(''); setRedraw(true);
    setTypesLoading(true);
    receptionSampleChoices(order.requisition, order.facility?.code ?? null)
      .then((rows) => { if (live) { setTypes(rows); setType(startType(order, rows)); } })
      .catch((e: unknown) => { if (live) { setTypes([]); toast.error(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setTypesLoading(false); });
    return () => { live = false; };
  }, [order]);

  const save = async (): Promise<void> => {
    if (!order) return;
    const picked = types.find((x) => keyOf(x) === type);
    if (!picked) { toast.error(t('reception.rejectSample.chooseType')); return; }
    const cond = conditions.codes.find((c) => keyOf(c) === condition);
    if (!cond) { toast.error(t('reception.rejectSample.chooseCondition')); return; }
    if (!reason) { toast.error(t('reception.rejectSample.chooseReason')); return; }
    setBusy(true);
    try {
      const after = await rejectReceptionSample({
        requisition: order.requisition,
        facilityCode: order.facility?.code ?? null,
        specimenTypeCode: picked.code,
        conditionCode: cond.code,
        reasonCode: reason,
        redraw,
      });
      toast.success(t('reception.rejectSample.done', { number: after.requisition }));
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
          <SheetTitle>{t('reception.rejectSample.title')}</SheetTitle>
          <SheetDescription>{t('reception.rejectSample.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="font-mono text-sm font-medium text-foreground">{order?.requisition}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="reject-sample-sheet-menu" aria-label={t('reception.rejectSample.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="reject-sample-save" disabled={busy || typesLoading} onSelect={() => void save()}>{t('reception.rejectSample.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="reject-sample-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          {typesLoading ? (
            <LoadingState className="min-h-[8rem]" label={t('common.loading')} />
          ) : types.length === 0 ? (
            <StripedEmpty className="min-h-[8rem]">{t('reception.rejectSample.noTypes')}</StripedEmpty>
          ) : (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <Label htmlFor="reject-sample-type" className="whitespace-nowrap">{t('reception.rejectSample.type')}</Label>
              <Select value={type || undefined} onValueChange={setType}>
                <SelectTrigger id="reject-sample-type"><SelectValue placeholder={t('reception.rejectSample.choose')} /></SelectTrigger>
                <SelectContent>
                  {types.map((x) => <SelectItem key={keyOf(x)} value={keyOf(x)}>{x.display ?? x.code}</SelectItem>)}
                </SelectContent>
              </Select>

              <Label htmlFor="reject-sample-condition" className="whitespace-nowrap">{t('reception.rejectSample.condition')}</Label>
              {conditions.unusable ? (
                <span id="reject-sample-condition" className="text-muted-foreground">{conditions.error ?? t('reception.noOptions')}</span>
              ) : (
                <Select value={condition || undefined} onValueChange={setCondition} disabled={conditions.loading}>
                  <SelectTrigger id="reject-sample-condition"><SelectValue placeholder={t('reception.rejectSample.choose')} /></SelectTrigger>
                  <SelectContent>
                    {conditions.codes.map((c) => <SelectItem key={keyOf(c)} value={keyOf(c)}>{c.display ?? c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              <Label htmlFor="reject-sample-reason" className="whitespace-nowrap">{t('reception.rejectSample.reason')}</Label>
              {reasons.unusable ? (
                <span id="reject-sample-reason" className="text-muted-foreground">{reasons.error ?? t('reception.noOptions')}</span>
              ) : (
                <Select value={reason || undefined} onValueChange={setReason} disabled={reasons.loading}>
                  <SelectTrigger id="reject-sample-reason"><SelectValue placeholder={t('reception.rejectSample.choose')} /></SelectTrigger>
                  <SelectContent>
                    {reasons.codes.map((c) => <SelectItem key={c.code} value={c.code}>{c.display ?? c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              <span className="whitespace-nowrap font-medium">{t('reception.rejectSample.redraw')}</span>
              <div className="flex items-center gap-3">
                <Switch checked={redraw} onCheckedChange={setRedraw} aria-label={t('reception.rejectSample.redraw')} data-testid="reject-sample-redraw" />
                <span className="text-muted-foreground">{t(redraw ? 'reception.rejectSample.redrawOn' : 'reception.rejectSample.redrawOff')}</span>
              </div>
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
