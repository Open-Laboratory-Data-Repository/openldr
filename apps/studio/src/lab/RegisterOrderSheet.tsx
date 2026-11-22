import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  registerReceptionOrder, searchReceptionFacilities, searchReceptionTests,
  type ReceptionCoding, type ReceptionOrder,
} from '@/api';
import { PatientSheet, type PickedPatient } from './PatientSheet';
import { PRIORITY_VALUE_SET, useValueSet } from './useValueSet';

const SEARCH_DEBOUNCE_MS = 250;
/** The facility search answers nothing under two characters (apps/server/src/lab-routes.ts). */
const MIN_FACILITY_QUERY = 2;

type Facility = { code: string; display: string | null };
const testKey = (c: { system: string; code: string }): string => `${c.system}|${c.code}`;

/** Registers an order the desk could not find: the number as scanned, the sending facility, the
 *  tests and the patient. Lists are drawn in the sheet, not in a popover, which cannot scroll
 *  inside a Sheet (AGENTS.md section 6). */
export function RegisterOrderSheet({ open, requisition, onClose, onRegistered }: {
  open: boolean;
  requisition: string;
  onClose: () => void;
  onRegistered: (order: ReceptionOrder) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const priorities = useValueSet(PRIORITY_VALUE_SET, open);
  const [number, setNumber] = useState(requisition);
  const [facilityQuery, setFacilityQuery] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facility, setFacility] = useState<Facility | null>(null);
  const [testQuery, setTestQuery] = useState('');
  const [testHits, setTestHits] = useState<ReceptionCoding[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [tests, setTests] = useState<ReceptionCoding[]>([]);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [patientOpen, setPatientOpen] = useState(false);
  const [priority, setPriority] = useState('');
  const [clinician, setClinician] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const facilitySeq = useRef(0);
  const testSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setNumber(requisition); setFacilityQuery(''); setFacilities([]); setFacility(null);
    setTestQuery(''); setTests([]); setPatient(null); setPriority(''); setClinician(''); setNote('');
  }, [open, requisition]);

  useEffect(() => {
    if (!open) return undefined;
    const q = facilityQuery.trim();
    if (q.length < MIN_FACILITY_QUERY) { setFacilities([]); return undefined; }
    const timer = setTimeout(() => {
      const seq = ++facilitySeq.current;
      searchReceptionFacilities(q)
        .then((rows) => { if (seq === facilitySeq.current) setFacilities(rows); })
        .catch((e: unknown) => { if (seq === facilitySeq.current) toast.error(e instanceof Error ? e.message : String(e)); });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [facilityQuery, open]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      const seq = ++testSeq.current;
      setTestsLoading(true);
      searchReceptionTests(testQuery.trim())
        .then((rows) => { if (seq === testSeq.current) setTestHits(rows); })
        .catch((e: unknown) => { if (seq === testSeq.current) toast.error(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (seq === testSeq.current) setTestsLoading(false); });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [testQuery, open]);

  const chosenKeys = new Set(tests.map(testKey));
  const toggleTest = (test: ReceptionCoding, on: boolean): void =>
    setTests((all) => (on ? [...all.filter((x) => testKey(x) !== testKey(test)), test] : all.filter((x) => testKey(x) !== testKey(test))));

  const register = async (): Promise<void> => {
    const req = number.trim();
    if (!req || !facility || tests.length === 0 || !patient) { toast.error(t('reception.register.needs')); return; }
    setBusy(true);
    try {
      const order = await registerReceptionOrder({
        requisition: req,
        facilityCode: facility.code,
        patientId: patient.id,
        tests: tests.map((x) => ({ system: x.system, code: x.code })),
        ...(priority ? { priority } : {}),
        ...(clinician.trim() ? { clinician: clinician.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t('reception.register.done', { number: order.requisition }));
      onRegistered(order);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border px-6 py-4">
            <SheetTitle>{t('reception.register.title')}</SheetTitle>
            <SheetDescription>{t('reception.register.description')}</SheetDescription>
          </SheetHeader>
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <h3 className="text-sm font-medium text-foreground">{t('reception.register.order')}</h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="register-sheet-menu" aria-label={t('reception.register.actions')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem data-testid="register-save" disabled={busy} onSelect={() => void register()}>{t('reception.register.save')}</DropdownMenuItem>
                  <DropdownMenuItem data-testid="register-patient" onSelect={() => setPatientOpen(true)}>{t('reception.register.findPatient')}</DropdownMenuItem>
                  <DropdownMenuItem data-testid="register-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <Label htmlFor="register-number" className="whitespace-nowrap">{t('reception.register.number')}</Label>
              <Input id="register-number" value={number} onChange={(e) => setNumber(e.target.value)} />

              <Label className="whitespace-nowrap">{t('reception.register.patient')}</Label>
              <div data-testid="register-patient-value" className={patient ? '' : 'text-muted-foreground'}>
                {patient ? patient.display : t('reception.register.noPatient')}
              </div>

              <Label htmlFor="register-facility" className="whitespace-nowrap">{t('reception.register.facility')}</Label>
              <div className="flex flex-col gap-2">
                <Input id="register-facility" value={facilityQuery} placeholder={t('reception.register.facilitySearch')} onChange={(e) => setFacilityQuery(e.target.value)} />
                {facility && <span data-testid="register-facility-value">{facility.display ?? facility.code}</span>}
              </div>
              {facilities.length > 0 && (
                <>
                  <span />
                  <RadioGroup
                    value={facility?.code ?? ''}
                    onValueChange={(code) => setFacility(facilities.find((f) => f.code === code) ?? null)}
                    aria-label={t('reception.register.facility')}
                    className="max-h-48 overflow-y-auto rounded-md border border-border p-3"
                  >
                    {facilities.map((f) => (
                      <div key={f.code} className="flex items-center gap-3">
                        <RadioGroupItem value={f.code} id={`facility-${f.code}`} />
                        <Label htmlFor={`facility-${f.code}`} className="font-normal">{f.display ?? f.code}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </>
              )}

              <Label htmlFor="register-tests" className="whitespace-nowrap">{t('reception.register.tests')}</Label>
              <Input id="register-tests" value={testQuery} placeholder={t('reception.register.testSearch')} onChange={(e) => setTestQuery(e.target.value)} />
              <span />
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
                {tests.map((x) => (
                  <TestChoice key={testKey(x)} test={x} checked onChange={(on) => toggleTest(x, on)} />
                ))}
                {testsLoading ? <Spinner /> : testHits.filter((x) => !chosenKeys.has(testKey(x))).map((x) => (
                  <TestChoice key={testKey(x)} test={x} checked={false} onChange={(on) => toggleTest(x, on)} />
                ))}
                {!testsLoading && tests.length === 0 && testHits.length === 0 && (
                  <span className="text-muted-foreground">{t('reception.register.noTests')}</span>
                )}
              </div>

              <Label htmlFor="register-priority" className="whitespace-nowrap">{t('reception.register.priority')}</Label>
              <Select value={priority || undefined} onValueChange={setPriority} disabled={priorities.loading}>
                <SelectTrigger id="register-priority"><SelectValue placeholder={priorities.error ?? t('reception.register.choose')} /></SelectTrigger>
                <SelectContent>
                  {priorities.codes.map((p) => <SelectItem key={p.code} value={p.code}>{p.display ?? p.code}</SelectItem>)}
                </SelectContent>
              </Select>

              <Label htmlFor="register-clinician" className="whitespace-nowrap">{t('reception.register.clinician')}</Label>
              <Input id="register-clinician" value={clinician} onChange={(e) => setClinician(e.target.value)} />

              <Label htmlFor="register-note" className="self-start whitespace-nowrap pt-2">{t('reception.register.note')}</Label>
              <Textarea id="register-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </section>
        </SheetContent>
      </Sheet>
      <PatientSheet
        open={patientOpen}
        onClose={() => setPatientOpen(false)}
        onPicked={(p) => { setPatient(p); setPatientOpen(false); }}
      />
    </>
  );
}

function TestChoice({ test, checked, onChange }: { test: ReceptionCoding; checked: boolean; onChange: (on: boolean) => void }): JSX.Element {
  const id = `test-${test.system}-${test.code}`.replace(/[^A-Za-z0-9_-]/g, '_');
  return (
    <div className="flex items-center gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">{test.display ?? test.code}</Label>
    </div>
  );
}
