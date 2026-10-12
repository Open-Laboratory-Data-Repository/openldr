import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { saveIdentifierSystem, type IdentifierSystemRow } from '@/api';

// One identifier system's label and flags (patient index spec, section 3). Copies ResultFieldSheet.tsx:
// Save and Cancel in the section's ⋯ menu, label left and input right.

export function IdentifierSystemSheet({ system, onClose, onSaved }: {
  system: IdentifierSystemRow | null; onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [listColumn, setListColumn] = useState(false);
  const [searchable, setSearchable] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Only an operator's own label is editable text. A source label shows as the placeholder.
    setLabel(system?.labelSource === 'operator' ? system.label ?? '' : '');
    setListColumn(system?.listColumn ?? false);
    setSearchable(system?.searchable ?? true);
  }, [system]);

  const save = async () => {
    if (!system?.system) return;
    setBusy(true);
    try {
      await saveIdentifierSystem({ system: system.system, label: label.trim() || null, listColumn, searchable });
      toast.success(t('patients.systems.saved', { system: system.system }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={system !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('patients.systems.sheetTitle')}</SheetTitle>
          <SheetDescription>{t('patients.systems.sheetDescription')}</SheetDescription>
        </SheetHeader>
        {system && (
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <div className="break-all font-mono text-xs text-foreground">{system.system}</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="identifier-system-sheet-menu" aria-label={t('patients.systems.actions')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem data-testid="identifier-system-save" disabled={busy} onSelect={() => void save()}>{t('common.save')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="text-muted-foreground">{t('patients.systems.label')}</div>
              <div className="flex flex-col gap-1">
                <Input
                  data-testid="identifier-system-label" value={label} disabled={busy}
                  placeholder={system.labelSource === 'source' ? system.label ?? '' : ''}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">{t('patients.systems.labelHint')}</span>
              </div>
              <div className="text-muted-foreground">{t('patients.systems.listColumn')}</div>
              <div><Switch data-testid="identifier-system-list-column" checked={listColumn} onCheckedChange={setListColumn} disabled={busy} /></div>
              <div className="text-muted-foreground">{t('patients.systems.searchable')}</div>
              <div><Switch data-testid="identifier-system-searchable" checked={searchable} onCheckedChange={setSearchable} disabled={busy} /></div>
            </div>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default IdentifierSystemSheet;
