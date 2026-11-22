import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { receiveReceptionSample, receptionSampleChoices, type ReceptionCoding, type ReceptionOrder } from '@/api';
import { SAMPLE_CONDITION_VALUE_SET, useValueSet } from './useValueSet';

/** Radix Select cannot hold an empty value, so "no condition recorded" is this sentinel in the picker only. */
const NO_CONDITION = '__none__';
const keyOf = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;

/** The request statuses no sample is received for: the server refuses them. */
const NOT_LIVE: ReadonlySet<string> = new Set(['entered-in-error', 'revoked']);

/** One live request of the order and the tests it holds. An order saved by the form before slice 1b
 *  is one request holding every test, so a request may name several. */
function requestsOf(order: ReceptionOrder): Array<{ id: string; names: string }> {
  const by = new Map<string, string[]>();
  for (const test of order.tests.filter((x) => !NOT_LIVE.has(x.status))) by.set(test.serviceRequestId, [...(by.get(test.serviceRequestId) ?? []), test.display ?? test.code]);
  return [...by.entries()].map(([id, names]) => ({ id, names: names.join(', ') }));
}

/** Receives a sample for an order: its type from the order's tests, its condition from the lab's
 *  sample-condition set, and which tests it serves (all of them unless the desk says otherwise). */
export function ReceiveSampleSheet({ order, onClose, onReceived, onCloseAutoFocus }: {
  order: ReceptionOrder | null;
  onClose: () => void;
  onReceived: (order: ReceptionOrder) => void;
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const open = order !== null;
  const conditions = useValueSet(SAMPLE_CONDITION_VALUE_SET, open);
  const [types, setTypes] = useState<ReceptionCoding[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [type, setType] = useState('');
  const [condition, setCondition] = useState(NO_CONDITION);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const requests = order ? requestsOf(order) : [];

  useEffect(() => {
    if (!order) return undefined;
    let live = true;
    setTypes([]); setType(''); setCondition(NO_CONDITION);
    setChosen(new Set(requestsOf(order).map((r) => r.id)));
    setTypesLoading(true);
    receptionSampleChoices(order.requisition, order.facility?.code ?? null)
      .then((rows) => { if (live) { setTypes(rows); if (rows.length === 1) setType(keyOf(rows[0]!)); } })
      .catch((e: unknown) => { if (live) { setTypes([]); toast.error(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setTypesLoading(false); });
    return () => { live = false; };
  }, [order]);

  const receive = async (): Promise<void> => {
    if (!order) return;
    const picked = types.find((x) => keyOf(x) === type);
    if (!picked) { toast.error(t('reception.receive.chooseType')); return; }
    if (chosen.size === 0) { toast.error(t('reception.receive.chooseTests')); return; }
    const cond = conditions.codes.find((c) => keyOf(c) === condition);
    const all = requests.every((r) => chosen.has(r.id));
    setBusy(true);
    try {
      const after = await receiveReceptionSample({
        requisition: order.requisition,
        facilityCode: order.facility?.code ?? null,
        type: { system: picked.system, code: picked.code, ...(picked.display ? { display: picked.display } : {}) },
        ...(cond ? { condition: { system: cond.system, code: cond.code, ...(cond.display ? { display: cond.display } : {}) } } : {}),
        ...(all ? {} : { serviceRequestIds: requests.filter((r) => chosen.has(r.id)).map((r) => r.id) }),
      });
      toast.success(t('reception.receive.done', { number: after.requisition }));
      onReceived(after);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, on: boolean): void => setChosen((s) => {
    const next = new Set(s);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('reception.receive.title')}</SheetTitle>
          <SheetDescription>{order?.requisition}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">{t('reception.receive.sample')}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="receive-sheet-menu" aria-label={t('reception.receive.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="receive-save" disabled={busy || typesLoading} onSelect={() => void receive()}>{t('reception.receive.save')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="receive-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          {typesLoading ? (
            <LoadingState className="min-h-[8rem]" label={t('common.loading')} />
          ) : types.length === 0 ? (
            <StripedEmpty className="min-h-[8rem]">{t('reception.receive.noTypes')}</StripedEmpty>
          ) : (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <Label htmlFor="receive-type" className="whitespace-nowrap">{t('reception.receive.type')}</Label>
              <Select value={type || undefined} onValueChange={setType}>
                <SelectTrigger id="receive-type"><SelectValue placeholder={t('reception.receive.choose')} /></SelectTrigger>
                <SelectContent>
                  {types.map((x) => <SelectItem key={keyOf(x)} value={keyOf(x)}>{x.display ?? x.code}</SelectItem>)}
                </SelectContent>
              </Select>

              <Label htmlFor="receive-condition" className="whitespace-nowrap">{t('reception.receive.condition')}</Label>
              {conditions.unusable ? (
                <span id="receive-condition" className="text-muted-foreground">{conditions.error ?? t('reception.noOptions')}</span>
              ) : (
                <Select value={condition} onValueChange={setCondition} disabled={conditions.loading}>
                  <SelectTrigger id="receive-condition"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CONDITION}>{t('reception.receive.noCondition')}</SelectItem>
                    {conditions.codes.map((c) => <SelectItem key={keyOf(c)} value={keyOf(c)}>{c.display ?? c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              <Label className="self-start whitespace-nowrap">{t('reception.receive.tests')}</Label>
              <div className="flex flex-col gap-2">
                {requests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <Checkbox id={`receive-${r.id}`} checked={chosen.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
                    <Label htmlFor={`receive-${r.id}`} className="font-normal">{r.names}</Label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
