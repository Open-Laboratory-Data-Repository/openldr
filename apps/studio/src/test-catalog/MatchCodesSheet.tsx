import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/ui/spinner';
import { applyMatchCodes, getObservedSystems, previewMatchCodes, type MatchPlan } from '@/api';

// Map matching codes (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md, 4.5). Header,
// section and menu copied from ImportMappingsSheet.tsx. Apply lives in the section's menu.

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function MatchCodesSheet({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [systems, setSystems] = useState<string[]>([]);
  const [system, setSystem] = useState<string | null>(null);
  const [plan, setPlan] = useState<MatchPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSystem(null);
    setPlan(null);
    // A preview cut off by the close never clears busy itself, so reset it here.
    setBusy(false);
    getObservedSystems('result')
      .then((list) => {
        setSystems(list);
        // Most labs have one system. Pick it, so the preview shows at once.
        if (list.length === 1) setSystem(list[0]);
      })
      .catch((e: unknown) => { toast.error(errorText(e)); });
  }, [open]);

  useEffect(() => {
    if (!system) return;
    let live = true;
    setBusy(true);
    setPlan(null);
    previewMatchCodes(system)
      .then((p) => { if (live) setPlan(p); })
      .catch((e: unknown) => { if (live) toast.error(errorText(e)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [system]);

  const apply = async () => {
    if (!system) return;
    setBusy(true);
    try {
      const out = await applyMatchCodes(system);
      toast.success(t('testCatalog.matchSheet.done', { count: out.matches.length }));
      if (!out.rebuild.ok) toast.error(t('testCatalog.observed.stale', { error: out.rebuild.error }));
      onApplied();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.matchSheet.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.matchSheet.description')}</SheetDescription>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="text-sm font-medium text-foreground">{t('testCatalog.matchSheet.section')}</div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="match-sheet-menu" aria-label={t('testCatalog.matchSheet.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="match-sheet-apply"
                  disabled={busy || !plan || plan.matches.length === 0}
                  onSelect={() => void apply()}
                >
                  {t('testCatalog.matchSheet.apply')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <div className="text-muted-foreground">{t('testCatalog.matchSheet.system')}</div>
            <Select value={system ?? undefined} onValueChange={setSystem} disabled={busy}>
              <SelectTrigger data-testid="match-sheet-system" className="min-w-0">
                <SelectValue placeholder={t('testCatalog.matchSheet.pickSystem')} />
              </SelectTrigger>
              <SelectContent>
                {systems.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {system && busy && !plan && <LoadingState className="min-h-[8rem]" label={t('common.loading')} />}
          {plan && (
            <div className="space-y-1 border-t border-border px-6 py-4 text-sm" data-testid="match-sheet-list">
              {plan.matches.length === 0
                ? <div className="text-muted-foreground">{t('testCatalog.matchSheet.none')}</div>
                : plan.matches.map((m) => (
                  <div key={m.code} className="break-all">
                    {t('testCatalog.matchSheet.line', { code: m.code, display: m.display ?? '', count: m.results })}
                  </div>
                ))}
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}

export default MatchCodesSheet;
