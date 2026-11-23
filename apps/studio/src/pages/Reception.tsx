import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { correctReceptionOrder, findReceptionOrders, type ReceptionOrder } from '@/api';
import { OrderPanel, orderKey } from '@/lab/OrderPanel';
import { RegisterOrderSheet } from '@/lab/RegisterOrderSheet';
import { PatientSheet, type PickedPatient } from '@/lab/PatientSheet';
import { ReceiveSampleSheet } from '@/lab/ReceiveSampleSheet';
import { CorrectOrderSheet } from '@/lab/CorrectOrderSheet';
import { CancelOrderSheet } from '@/lab/CancelOrderSheet';
import { ReturnOrderSheet } from '@/lab/ReturnOrderSheet';
import { MarkCorrectedSheet } from '@/lab/MarkCorrectedSheet';
import { RejectSampleSheet } from '@/lab/RejectSampleSheet';
import { RejectTestSheet, type RejectTestTarget } from '@/lab/RejectTestSheet';
import { LinkRedrawSheet } from '@/lab/LinkRedrawSheet';
import { useAuth } from '@/auth/AuthProvider';
import { PRIORITY_VALUE_SET, useValueSet } from '@/lab/useValueSet';

/**
 * The lab desk (lab module slices 1b and 2). One box takes a scanned or typed requisition number;
 * a barcode scanner types into it and presses Enter (ruling 15). Found orders show as panels, each
 * with its own ⋯ menu. A number with no order offers "Register this order" in the page menu.
 */
export function Reception() {
  const { t } = useTranslation();
  const { hasCapability } = useAuth();
  const canReject = hasCapability('lab.reject');
  const box = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [orders, setOrders] = useState<ReceptionOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [receiving, setReceiving] = useState<ReceptionOrder | null>(null);
  const [correcting, setCorrecting] = useState<ReceptionOrder | null>(null);
  const [cancelling, setCancelling] = useState<ReceptionOrder | null>(null);
  const [linking, setLinking] = useState<ReceptionOrder | null>(null);
  const [returning, setReturning] = useState<ReceptionOrder | null>(null);
  const [markingCorrected, setMarkingCorrected] = useState<ReceptionOrder | null>(null);
  const [rejectingSample, setRejectingSample] = useState<ReceptionOrder | null>(null);
  const [rejectingTest, setRejectingTest] = useState<RejectTestTarget | null>(null);
  const [linkingRedraw, setLinkingRedraw] = useState<ReceptionOrder | null>(null);
  const seq = useRef(0);
  const priorities = useValueSet(PRIORITY_VALUE_SET);

  useEffect(() => { box.current?.focus(); }, []);

  /** Puts focus back in the scan box when a sheet or the page menu closes, so the next scan lands
   *  there. Radix would otherwise focus the ⋯ button that opened it. */
  const refocus = (event: Event): void => {
    event.preventDefault();
    box.current?.focus();
  };

  const search = async (): Promise<void> => {
    const number = value.trim();
    if (!number) return;
    const mine = ++seq.current;
    setSearched(number);
    setLoading(true);
    // Select the number, so the next scan replaces it instead of adding to it.
    box.current?.select();
    try {
      const rows = await findReceptionOrders(number);
      if (mine === seq.current) setOrders(rows);
    } catch (e) {
      // A failed search is not a "not found": it offers no Register, only the error.
      if (mine === seq.current) { setOrders([]); setSearched(null); }
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  /** Puts an order the server sent back in place of the one shown, or adds it. */
  const put = (order: ReceptionOrder): void => {
    setOrders((all) => {
      const at = all.findIndex((o) => orderKey(o) === orderKey(order));
      return at === -1 ? [...all, order] : all.map((o, i) => (i === at ? order : o));
    });
  };

  const link = async (order: ReceptionOrder, patient: PickedPatient): Promise<void> => {
    setLinking(null);
    try {
      put(await correctReceptionOrder({
        requisition: order.requisition,
        facilityCode: order.facility?.code ?? null,
        changes: { patientId: patient.id },
        reason: t('reception.link.reason'),
      }));
      toast.success(t('reception.link.done', { name: patient.display }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AppShell title={t('reception.title')} fullBleed>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="reception-page">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Input
            ref={box}
            data-testid="reception-scan"
            aria-label={t('reception.scanLabel')}
            placeholder={t('reception.scanPlaceholder')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
            className="font-mono"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="reception-menu" aria-label={t('reception.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={refocus}>
              <DropdownMenuItem data-testid="reception-search" disabled={!value.trim() || loading} onSelect={() => void search()}>
                {t('reception.search')}
              </DropdownMenuItem>
              {/* The same number may come from another facility, so Register stays offered once a
                  number was searched. A second register of the same order is refused (409). */}
              {searched !== null && !loading && (
                <DropdownMenuItem data-testid="reception-register" onSelect={() => setRegisterOpen(true)}>
                  {t('reception.register.open')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {loading ? (
            <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />
          ) : searched === null ? (
            <StripedEmpty className="min-h-[16rem] flex-1">{t('reception.empty')}</StripedEmpty>
          ) : orders.length === 0 ? (
            <StripedEmpty className="min-h-[16rem] flex-1">{t('reception.notFound', { number: searched })}</StripedEmpty>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              {orders.map((o) => (
                <OrderPanel
                  key={orderKey(o)}
                  order={o}
                  priorities={priorities.codes}
                  onReceive={() => setReceiving(o)}
                  onLinkPatient={() => setLinking(o)}
                  onCorrect={() => setCorrecting(o)}
                  onCancel={() => setCancelling(o)}
                  canReject={canReject}
                  onReturn={() => setReturning(o)}
                  onMarkCorrected={() => setMarkingCorrected(o)}
                  onRejectSample={() => setRejectingSample(o)}
                  onRejectTest={(test) => setRejectingTest({ order: o, test })}
                  onLinkRedraw={() => setLinkingRedraw(o)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <RegisterOrderSheet
        open={registerOpen}
        requisition={searched ?? ''}
        onClose={() => setRegisterOpen(false)}
        onRegistered={(o) => { setRegisterOpen(false); put(o); }}
        onCloseAutoFocus={refocus}
      />
      <ReceiveSampleSheet order={receiving} onClose={() => setReceiving(null)} onReceived={(o) => { setReceiving(null); put(o); }} onCloseAutoFocus={refocus} />
      <CorrectOrderSheet order={correcting} onClose={() => setCorrecting(null)} onCorrected={(o) => { setCorrecting(null); put(o); }} onCloseAutoFocus={refocus} />
      <CancelOrderSheet order={cancelling} onClose={() => setCancelling(null)} onCancelled={(o) => { setCancelling(null); put(o); }} onCloseAutoFocus={refocus} />
      <ReturnOrderSheet order={returning} onClose={() => setReturning(null)} onReturned={(o) => { setReturning(null); put(o); }} onCloseAutoFocus={refocus} />
      <MarkCorrectedSheet order={markingCorrected} onClose={() => setMarkingCorrected(null)} onCorrected={(o) => { setMarkingCorrected(null); put(o); }} onCloseAutoFocus={refocus} />
      <RejectSampleSheet order={rejectingSample} onClose={() => setRejectingSample(null)} onRejected={(o) => { setRejectingSample(null); put(o); }} onCloseAutoFocus={refocus} />
      <RejectTestSheet target={rejectingTest} onClose={() => setRejectingTest(null)} onRejected={(o) => { setRejectingTest(null); put(o); }} onCloseAutoFocus={refocus} />
      <LinkRedrawSheet order={linkingRedraw} onClose={() => setLinkingRedraw(null)} onLinked={(o) => { setLinkingRedraw(null); put(o); }} onCloseAutoFocus={refocus} />
      <PatientSheet
        open={linking !== null}
        onClose={() => setLinking(null)}
        onPicked={(p) => { if (linking) void link(linking, p); }}
        onCloseAutoFocus={refocus}
      />
    </AppShell>
  );
}
