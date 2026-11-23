import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { registerReceptionPatient, searchReceptionPatients, type ReceptionPatient } from '@/api';
import { SEX_VALUE_SET, displayOf, useValueSet } from './useValueSet';

export interface PickedPatient { id: string; display: string }

const EMPTY_REGISTER = { given: '', family: '', gender: '', birthDate: '', age: '', idSystem: '', idValue: '' };

/**
 * Finds a patient on a strong match, or registers a new one, and hands the patient back to the
 * caller. A patient registered here goes straight back, with no second search: the warehouse lags
 * the store, so a search right after a registration might not find it yet.
 *
 * The Reception role cannot read the identifier-system list (`patients.view_identifiers`), so the
 * identifier on a registration is typed: a system the desk knows and a value. Both or neither.
 */
export function PatientSheet({ open, onClose, onPicked, onCloseAutoFocus }: {
  open: boolean;
  onClose: () => void;
  onPicked: (patient: PickedPatient) => void;
  /** Where focus goes when the sheet closes. Radix's default is the control that opened it. */
  onCloseAutoFocus?: (event: Event) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const sexes = useValueSet(SEX_VALUE_SET, open);
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [found, setFound] = useState<ReceptionPatient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState('');
  const [reg, setReg] = useState(EMPTY_REGISTER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIdentifier(''); setName(''); setBirthDate(''); setFound(null); setChosen(''); setReg(EMPTY_REGISTER);
  }, [open]);

  const search = async (): Promise<void> => {
    const id = identifier.trim();
    const n = name.trim();
    if (!id && !(n && birthDate)) { toast.error(t('reception.patient.searchNeeds')); return; }
    setSearching(true);
    try {
      const rows = await searchReceptionPatients(id ? { identifier: id } : { name: n, birthDate });
      setFound(rows);
      setChosen(rows.length === 1 ? rows[0]!.id : '');
    } catch (e) {
      setFound(null);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const pickChosen = (): void => {
    const p = found?.find((r) => r.id === chosen);
    if (!p) { toast.error(t('reception.patient.chooseFirst')); return; }
    onPicked({ id: p.id, display: p.name });
  };

  const register = async (): Promise<void> => {
    const given = reg.given.trim();
    const family = reg.family.trim();
    if (!given || !family || !reg.gender) { toast.error(t('reception.patient.registerNeeds')); return; }
    if (!reg.birthDate && reg.age.trim() === '') { toast.error(t('reception.patient.dateOrAge')); return; }
    const age = Number(reg.age);
    if (!reg.birthDate && !(Number.isInteger(age) && age >= 0)) { toast.error(t('reception.patient.ageInvalid')); return; }
    const idSystem = reg.idSystem.trim();
    const idValue = reg.idValue.trim();
    if (Boolean(idSystem) !== Boolean(idValue)) { toast.error(t('reception.patient.identifierBoth')); return; }
    setBusy(true);
    try {
      const made = await registerReceptionPatient({
        given, family, gender: reg.gender,
        ...(reg.birthDate ? { birthDate: reg.birthDate } : { ageYears: age }),
        ...(idSystem ? { identifier: { system: idSystem, value: idValue } } : {}),
      });
      toast.success(t('reception.patient.registered', { name: made.display }));
      onPicked(made);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<typeof EMPTY_REGISTER>): void => setReg((r) => ({ ...r, ...patch }));

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('reception.patient.title')}</SheetTitle>
          <SheetDescription>{t('reception.patient.description')}</SheetDescription>
        </SheetHeader>

        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <h3 className="text-sm font-medium text-foreground">{t('reception.patient.find')}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="patient-sheet-menu" aria-label={t('reception.patient.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="patient-search" disabled={searching} onSelect={() => void search()}>{t('reception.patient.search')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="patient-use" disabled={!chosen} onSelect={pickChosen}>{t('reception.patient.use')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="patient-register" disabled={busy} onSelect={() => void register()}>{t('reception.patient.register')}</DropdownMenuItem>
                <DropdownMenuItem data-testid="patient-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="patient-identifier" className="whitespace-nowrap">{t('reception.patient.identifier')}</Label>
            <Input id="patient-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            <Label htmlFor="patient-name" className="whitespace-nowrap">{t('reception.patient.name')}</Label>
            <Input id="patient-name" value={name} onChange={(e) => setName(e.target.value)} />
            <Label htmlFor="patient-birth-date" className="whitespace-nowrap">{t('reception.patient.birthDate')}</Label>
            <Input id="patient-birth-date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="px-6 pb-4">
            {searching ? (
              <LoadingState className="min-h-[6rem]" label={t('common.loading')} />
            ) : found === null ? (
              <StripedEmpty className="min-h-[6rem]">{t('reception.patient.searchHint')}</StripedEmpty>
            ) : found.length === 0 ? (
              <StripedEmpty className="min-h-[6rem]">{t('reception.patient.noneFound')}</StripedEmpty>
            ) : (
              <RadioGroup value={chosen} onValueChange={setChosen} aria-label={t('reception.patient.found')} className="rounded-md border border-border p-3">
                {found.map((p) => (
                  <div key={p.id} className="flex items-start gap-3">
                    <RadioGroupItem value={p.id} id={`found-${p.id}`} className="mt-0.5" />
                    <Label htmlFor={`found-${p.id}`} className="flex flex-col gap-0.5 font-normal">
                      <span>{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[p.birthDate, displayOf(sexes.codes, p.gender), ...p.identifiers.map((i) => i.value)].filter(Boolean).join(' · ')}
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </div>
        </section>

        <section className="border-t border-border">
          <h3 className="px-6 py-3 text-sm font-medium text-foreground">{t('reception.patient.new')}</h3>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="patient-given" className="whitespace-nowrap">{t('reception.patient.given')}</Label>
            <Input id="patient-given" value={reg.given} onChange={(e) => set({ given: e.target.value })} />
            <Label htmlFor="patient-family" className="whitespace-nowrap">{t('reception.patient.family')}</Label>
            <Input id="patient-family" value={reg.family} onChange={(e) => set({ family: e.target.value })} />
            <Label htmlFor="patient-sex" className="whitespace-nowrap">{t('reception.patient.sex')}</Label>
            {sexes.unusable ? (
              <span id="patient-sex" className="text-muted-foreground" data-testid="patient-sex-unusable">{sexes.error ?? t('reception.noOptions')}</span>
            ) : (
              <Select value={reg.gender || undefined} onValueChange={(v) => set({ gender: v })} disabled={sexes.loading}>
                <SelectTrigger id="patient-sex"><SelectValue placeholder={t('reception.patient.choose')} /></SelectTrigger>
                <SelectContent>
                  {sexes.codes.map((s) => <SelectItem key={s.code} value={s.code}>{s.display ?? s.code}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Label htmlFor="patient-new-birth-date" className="whitespace-nowrap">{t('reception.patient.birthDate')}</Label>
            <Input id="patient-new-birth-date" type="date" value={reg.birthDate} onChange={(e) => set({ birthDate: e.target.value, ...(e.target.value ? { age: '' } : {}) })} />
            <Label htmlFor="patient-age" className="whitespace-nowrap">{t('reception.patient.age')}</Label>
            <div className="flex flex-col gap-1">
              <Input id="patient-age" type="number" min={0} inputMode="numeric" value={reg.age} disabled={Boolean(reg.birthDate)} onChange={(e) => set({ age: e.target.value })} />
              <span className="text-xs text-muted-foreground">{t('reception.patient.ageHint')}</span>
            </div>
            <Label htmlFor="patient-id-system" className="whitespace-nowrap">{t('reception.patient.idSystem')}</Label>
            <div className="flex flex-col gap-1">
              <Input id="patient-id-system" value={reg.idSystem} onChange={(e) => set({ idSystem: e.target.value })} />
              <span className="text-xs text-muted-foreground">{t('reception.patient.idSystemHint')}</span>
            </div>
            <Label htmlFor="patient-id-value" className="whitespace-nowrap">{t('reception.patient.idValue')}</Label>
            <Input id="patient-id-value" value={reg.idValue} onChange={(e) => set({ idValue: e.target.value })} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
