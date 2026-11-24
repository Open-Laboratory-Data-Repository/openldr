import { Fragment, useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { CatalogDateLimit, CatalogFieldSettings, CatalogTestResultParam } from '@/api';
import { settingsOf, withSettings, type TypeSetting } from './field-settings';

// Field settings (plan B call 9), from a ticked field's ⋯ on the Test sheet. Corlix opens an inline
// panel (TestEditorPage.tsx:242-330); AGENTS.md section 5 wants a sheet. The limits are entry limits,
// not ranges. Apply puts them on the test's draft; the Test sheet's Save stores them. Layout copied
// from AddResultFieldSheet.tsx.

const NUMBERS: Array<{ key: Exclude<TypeSetting, 'dateLimit'>; label: string; whole: boolean }> = [
  { key: 'min', label: 'testCatalog.fieldSettings.min', whole: false },
  { key: 'max', label: 'testCatalog.fieldSettings.max', whole: false },
  { key: 'decimals', label: 'testCatalog.fieldSettings.decimals', whole: true },
  { key: 'minLength', label: 'testCatalog.fieldSettings.minLength', whole: true },
  { key: 'maxLength', label: 'testCatalog.fieldSettings.maxLength', whole: true },
];
const DATE_LIMITS: Array<{ code: CatalogDateLimit; label: string }> = [
  { code: 'any', label: 'testCatalog.fieldSettings.dateAny' },
  { code: 'past', label: 'testCatalog.fieldSettings.datePast' },
  { code: 'future', label: 'testCatalog.fieldSettings.dateFuture' },
];

export function FieldSettingsSheet({ param, name, returnFocusTo, onClose, onApply }: {
  /** The field being set, or null when the sheet is closed. */
  param: CatalogTestResultParam | null;
  /** The field's name, for the description line. */
  name: string;
  /** Where focus goes when this sheet closes. The menu item that opened it is gone. */
  returnFocusTo?: RefObject<HTMLElement>;
  onClose: () => void;
  onApply: (next: CatalogTestResultParam) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [values, setValues] = useState<CatalogFieldSettings>({});

  useEffect(() => {
    if (param) setValues({ ...param });
  }, [param]);

  const own = param ? settingsOf(param.resultType) : [];
  const set = (patch: CatalogFieldSettings) => setValues((v) => ({ ...v, ...patch }));
  const notWhole = NUMBERS.some(({ key, whole }) => {
    const v = values[key];
    return whole && own.includes(key) && v != null && !(Number.isInteger(v) && v >= 0);
  });
  const pair = (low: TypeSetting, high: TypeSetting) => {
    const a = values[low as 'min'];
    const b = values[high as 'max'];
    return own.includes(low) && a != null && b != null && a > b;
  };
  const minAboveMax = pair('min', 'max');
  const minLengthAboveMax = pair('minLength', 'maxLength');
  const ready = !notWhole && !minAboveMax && !minLengthAboveMax;

  return (
    <Sheet open={param !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
        onCloseAutoFocus={(e) => { if (returnFocusTo?.current) { e.preventDefault(); returnFocusTo.current.focus(); } }}
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.fieldSettings.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.fieldSettings.description', { name })}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.fieldSettings.section')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="field-settings-menu" aria-label={t('testCatalog.fieldSettings.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="field-settings-apply"
                  disabled={!ready}
                  onSelect={() => { if (param) { onApply(withSettings(param, values)); onClose(); } }}
                >
                  {t('testCatalog.fieldSettings.apply')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            {NUMBERS.filter(({ key }) => own.includes(key)).map(({ key, label }) => (
              <Fragment key={key}>
                <Label htmlFor={`field-setting-${key}`} className="whitespace-nowrap">{t(label)}</Label>
                <DecimalInput
                  id={`field-setting-${key}`} inputMode="decimal" className="w-28"
                  value={values[key] ?? null}
                  onValueChange={(v) => set({ [key]: v })}
                />
              </Fragment>
            ))}
            {own.includes('dateLimit') ? (
              <>
                <Label htmlFor="field-setting-dateLimit" className="whitespace-nowrap">{t('testCatalog.fieldSettings.dateLimit')}</Label>
                <Select value={values.dateLimit ?? 'any'} onValueChange={(v) => set({ dateLimit: v as CatalogDateLimit })}>
                  <SelectTrigger id="field-setting-dateLimit" className="sm:w-56" aria-label={t('testCatalog.fieldSettings.dateLimit')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DATE_LIMITS.map((d) => <SelectItem key={d.code} value={d.code}>{t(d.label)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            ) : null}
            {minAboveMax ? <span className="col-span-2 text-xs text-destructive">{t('testCatalog.fieldSettings.minAboveMax')}</span> : null}
            {minLengthAboveMax ? <span className="col-span-2 text-xs text-destructive">{t('testCatalog.fieldSettings.minLengthAboveMax')}</span> : null}
            {notWhole ? <span className="col-span-2 text-xs text-destructive">{t('testCatalog.fieldSettings.wholeNumber')}</span> : null}
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
