import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  clearTestMapping, getMappingTargets, setTestMapping,
  type MappingTarget, type ObservedTestCode, type TestMappingChange,
} from '@/api';

// Header and section layout copied from TestSheet.tsx. Save and Clear live in the section's menu.

export function MapCodeSheet({ target, onClose, onSaved }: {
  target: ObservedTestCode | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<MappingTarget[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setPicked(target.catalog?.code ?? null);
    getMappingTargets().then(setTargets).catch((e: unknown) => { toast.error(e instanceof Error ? e.message : String(e)); });
  }, [target]);

  const run = async (action: () => Promise<TestMappingChange>, done: string) => {
    setBusy(true);
    try {
      const change = await action();
      toast.success(done);
      if (!change.rebuild.ok) toast.error(t('testCatalog.observed.stale', { error: change.rebuild.error }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const options = targets.map((x) => ({
    value: x.code,
    label: `${x.name ?? x.code} (${x.code}${x.loinc ? `, ${x.loinc}` : ''})${x.retired ? `, ${t('testCatalog.mapSheet.retired')}` : ''}`,
  }));
  const pickedName = targets.find((x) => x.code === picked)?.name ?? picked ?? '';

  return (
    <Sheet open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('testCatalog.mapSheet.title')}</SheetTitle>
          <SheetDescription>{t('testCatalog.mapSheet.description')}</SheetDescription>
        </SheetHeader>
        {target && (
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <div className="text-sm font-medium text-foreground">{t('testCatalog.mapSheet.section')}</div>
              {!target.centralManaged && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="map-sheet-menu" aria-label={t('testCatalog.mapSheet.actions')}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid="map-sheet-save"
                      disabled={busy || !picked}
                      onSelect={() => { if (picked) void run(() => setTestMapping(target.system, target.code, picked), t('testCatalog.mapSheet.saved', { code: target.code, catalog: pickedName })); }}
                    >
                      {t('common.save')}
                    </DropdownMenuItem>
                    {target.status !== 'unmapped' && (
                      <DropdownMenuItem
                        data-testid="map-sheet-clear"
                        disabled={busy}
                        onSelect={() => void run(() => clearTestMapping(target.system, target.code), t('testCatalog.mapSheet.cleared', { code: target.code }))}
                      >
                        {t('testCatalog.mapSheet.clear')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem data-testid="map-sheet-cancel" onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="text-muted-foreground">{t('testCatalog.mapSheet.system')}</div>
              <div className="break-all font-mono text-xs">{target.system}</div>
              <div className="text-muted-foreground">{t('testCatalog.mapSheet.code')}</div>
              <div className="font-mono text-xs">{target.code}</div>
              <div className="text-muted-foreground">{t('testCatalog.mapSheet.catalogTest')}</div>
              {target.centralManaged ? (
                <div className="text-xs text-muted-foreground">{t('testCatalog.mapSheet.centralNote')}</div>
              ) : (
                <Combobox
                  options={options}
                  value={picked}
                  onChange={setPicked}
                  placeholder={t('testCatalog.mapSheet.pick')}
                  searchPlaceholder={t('testCatalog.mapSheet.search')}
                  disabled={busy}
                />
              )}
            </div>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
