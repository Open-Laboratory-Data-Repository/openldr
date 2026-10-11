import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TermPicker } from '@/terminology/TermPicker';
import { linkResultField, unlinkResultField, type ResultField, type TestCatalogOptions } from '@/api';

// One result field and its LOINC link (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md,
// 4.5). Header and section copied from MapCodeSheet.tsx, the LOINC input from TestSheet.tsx.

export function ResultFieldSheet({ field, ownedHere, loinc, onClose, onSaved }: {
  field: ResultField | null;
  /** false when the dictionary came from central. The sheet then only shows the field. */
  ownedHere: boolean;
  /** The LOINC code system when LOINC is loaded here, else null and the code is typed. */
  loinc: TestCatalogOptions['loinc'];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(field?.loinc ?? ''); }, [field]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const wanted = draft.trim();
  return (
    <Sheet open={field !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.resultFieldSheet.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.resultFieldSheet.description')}</SheetDescription>
        </SheetHeader>
        {field && (
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <div className="text-sm font-medium text-foreground">{t('testCatalog.resultFieldSheet.section')}</div>
              {ownedHere && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="result-field-sheet-menu" aria-label={t('testCatalog.resultFieldSheet.actions')}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid="result-field-save"
                      disabled={busy || wanted === '' || wanted === field.loinc}
                      onSelect={() => void run(() => linkResultField(field.code, wanted), t('testCatalog.resultFieldSheet.saved', { code: field.code, loinc: wanted }))}
                    >
                      {t('common.save')}
                    </DropdownMenuItem>
                    {field.loinc && (
                      <DropdownMenuItem
                        data-testid="result-field-clear"
                        disabled={busy}
                        onSelect={() => void run(() => unlinkResultField(field.code), t('testCatalog.resultFieldSheet.cleared', { code: field.code }))}
                      >
                        {t('testCatalog.resultFieldSheet.clear')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.code')}</div>
              <div className="break-all font-mono text-xs">{field.code}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.name')}</div>
              <div>{field.display ?? ''}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.role')}</div>
              <div>{field.role ? t(`testCatalog.resultFields.role.${field.role}`) : ''}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.units')}</div>
              <div>{field.units ?? ''}</div>
              <div className="text-muted-foreground">{t('testCatalog.resultFieldSheet.loinc')}</div>
              {!ownedHere ? (
                <div>{field.loinc ?? ''}</div>
              ) : loinc ? (
                <TermPicker
                  systemId={loinc.systemId}
                  value={wanted ? { system: loinc.system, code: wanted, display: null } : null}
                  onChange={(v) => setDraft(v?.code ?? '')}
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <Input data-testid="result-field-loinc" value={draft} placeholder="12345-6" disabled={busy} onChange={(e) => setDraft(e.target.value)} />
                  <span className="text-xs text-muted-foreground">{t('testCatalog.resultFieldSheet.loincTyped')}</span>
                </div>
              )}
            </div>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default ResultFieldSheet;
