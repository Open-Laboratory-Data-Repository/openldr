import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { queryApi } from '../api';
import type { CustomQuery } from '../custom-query-types';

// Copies forms-builder/FieldEditorSheet.tsx: the sheet, and the ⋯ menu on the first section row so it
// sits clear of the sheet's own close button.

function saveJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportQueriesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const { t } = useTranslation();
  const [queries, setQueries] = useState<CustomQuery[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Read t through a ref so a language change cannot re-run the load effect and clear the ticked queries.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQueries(null);
    setChecked(new Set());
    void queryApi.list()
      .then((rows) => { if (!cancelled) setQueries(rows); })
      .catch((e: Error) => { if (!cancelled) { setQueries([]); toast.error(tRef.current('query.transfer.loadFailed', { error: e.message })); } });
    return () => { cancelled = true; };
  }, [open]);

  const all = queries != null && queries.length > 0 && checked.size === queries.length;
  const toggle = (id: string, on: boolean) => setChecked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const download = async () => {
    setBusy(true);
    try {
      const file = await queryApi.exportQueries([...checked]);
      saveJson(`openldr-queries-${new Date().toISOString().slice(0, 10)}.json`, file);
    } catch (e) {
      toast.error(t('query.transfer.exportFailed', { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('query.transfer.export')}</SheetTitle>
          <SheetDescription>{t('query.transfer.exportDescription')}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-6 py-3">
          <div className="text-sm font-medium text-foreground">{t('query.transfer.selected', { count: checked.size })}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                data-testid="export-sheet-menu" aria-label={t('query.transfer.menu')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="export-download" disabled={busy || checked.size === 0}
                onSelect={() => { void download(); }}>
                {t('query.transfer.download')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {queries === null ? (
          <LoadingState className="min-h-[16rem]" />
        ) : queries.length === 0 ? (
          <StripedEmpty className="min-h-[16rem]">{t('query.transfer.noQueries')}</StripedEmpty>
        ) : (
          <div className="flex flex-col border-t border-border">
            <label className="flex items-center gap-3 border-b border-border px-6 py-2 text-sm">
              <Checkbox checked={all} aria-label={t('query.transfer.selectAll')}
                onCheckedChange={(v) => setChecked(v === true ? new Set(queries.map((q) => q.id)) : new Set())} />
              <span className="font-medium">{t('query.transfer.selectAll')}</span>
            </label>
            {queries.map((q) => (
              <label key={q.id} className="flex items-center gap-3 border-b border-border px-6 py-2 text-sm">
                <Checkbox checked={checked.has(q.id)} aria-label={q.name}
                  onCheckedChange={(v) => toggle(q.id, v === true)} />
                <span className="min-w-0 break-words">{q.name}</span>
              </label>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
