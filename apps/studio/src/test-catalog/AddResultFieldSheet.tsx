import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TermPicker } from '@/terminology/TermPicker';
import {
  createResultField, listValueSets, termExists,
  type CatalogTestResultParam, type CreatedResultField, type TestCatalogOptions, type ValueSetSummary,
} from '@/api';

// Add field, from the test sheet's Result parameters menu (test catalog hints, task 5). A field is a
// name, a code and a unit in the result dictionary. Its type and value set belong to the test, so they
// come back as the parameter to tick. ResultFieldSheet only links an existing field to LOINC, so this
// is its own sheet. Layout copied from ResultFieldSheet.tsx; the unit picker from TestSheet.tsx.

type FieldType = CatalogTestResultParam['resultType'];

export function AddResultFieldSheet({ open, ucum, onClose, onAdded }: {
  open: boolean;
  /** The UCUM code system a unit is picked from, or null when this install has none. */
  ucum: TestCatalogOptions['ucum'];
  onClose: () => void;
  onAdded: (field: CreatedResultField, param: CatalogTestResultParam) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [display, setDisplay] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<FieldType>('numeric');
  const [unit, setUnit] = useState<string | null>(null);
  const [notUcum, setNotUcum] = useState(false);
  const [valueSetUrl, setValueSetUrl] = useState<string | null>(null);
  const [valueSets, setValueSets] = useState<ValueSetSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplay(''); setCode(''); setType('numeric'); setUnit(null); setNotUcum(false); setValueSetUrl(null);
    listValueSets()
      .then(setValueSets)
      .catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, [open]);

  const checkUcum = async (typed: string): Promise<void> => {
    if (!ucum) return;
    try { setNotUcum(!(await termExists(ucum.system, typed))); } catch { /* unknown, so no note */ }
  };

  const ready = display.trim() !== '' && (type !== 'coded' || valueSetUrl !== null);

  async function save() {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const field = await createResultField({
        code: code.trim() || null, display: display.trim(), units: type === 'numeric' ? unit : null,
      });
      onAdded(field, {
        system: field.system, code: field.code, resultType: type,
        valueSetUrl: type === 'coded' ? valueSetUrl : null, bands: [],
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.addField.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.addField.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.addField.section')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="add-field-menu" aria-label={t('testCatalog.addField.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="add-field-save" disabled={busy || !ready} onSelect={() => void save()}>
                  {t('common.save')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="add-field-name" className="whitespace-nowrap">{t('testCatalog.addField.name')}</Label>
            <Input id="add-field-name" value={display} onChange={(e) => setDisplay(e.target.value)} />

            <Label htmlFor="add-field-code" className="whitespace-nowrap">{t('testCatalog.addField.code')}</Label>
            <div className="flex min-w-0 flex-col gap-1">
              <Input id="add-field-code" value={code} onChange={(e) => setCode(e.target.value)} />
              <span className="text-xs text-muted-foreground">{t('testCatalog.addField.codeHint')}</span>
            </div>

            <Label htmlFor="add-field-type" className="whitespace-nowrap">{t('testCatalog.addField.type')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
              <SelectTrigger id="add-field-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="numeric">{t('testCatalog.sheet.typeNumeric')}</SelectItem>
                <SelectItem value="coded">{t('testCatalog.sheet.typeCoded')}</SelectItem>
                <SelectItem value="text">{t('testCatalog.sheet.typeText')}</SelectItem>
              </SelectContent>
            </Select>

            {type === 'numeric' ? (
              <>
                <Label htmlFor="add-field-unit" className="whitespace-nowrap">{t('testCatalog.addField.unit')}</Label>
                {ucum ? (
                  <div className="flex min-w-0 flex-col gap-1">
                    <TermPicker
                      id="add-field-unit"
                      ariaLabel={t('testCatalog.addField.unit')}
                      systemId={ucum.systemId}
                      // UCUM has one-letter units: g, L, m.
                      minQueryLength={1}
                      value={unit ? { system: ucum.system, code: unit, display: null } : null}
                      onChange={(v) => { setNotUcum(false); setUnit(v?.code ?? null); }}
                      typed={{
                        label: (typed) => t('testCatalog.sheet.unitUseTyped', { unit: typed }),
                        onUse: (typed) => { setUnit(typed); void checkUcum(typed); },
                      }}
                    />
                    {unit && notUcum ? <span className="text-xs text-muted-foreground">{t('testCatalog.sheet.notUcumUnit')}</span> : null}
                  </div>
                ) : (
                  <Input id="add-field-unit" value={unit ?? ''} onChange={(e) => setUnit(e.target.value || null)} />
                )}
              </>
            ) : null}

            {type === 'coded' ? (
              <>
                <Label htmlFor="add-field-value-set" className="whitespace-nowrap">{t('testCatalog.addField.valueSet')}</Label>
                {valueSets.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t('testCatalog.addField.noValueSets')}</span>
                ) : (
                  <Select value={valueSetUrl ?? undefined} onValueChange={setValueSetUrl}>
                    <SelectTrigger id="add-field-value-set" className="min-w-0"><SelectValue placeholder={t('testCatalog.addField.valueSetPick')} /></SelectTrigger>
                    <SelectContent>
                      {valueSets.map((v) => (
                        <SelectItem key={v.id} value={v.url}>{v.title ?? v.name ?? v.url}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            ) : null}
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
