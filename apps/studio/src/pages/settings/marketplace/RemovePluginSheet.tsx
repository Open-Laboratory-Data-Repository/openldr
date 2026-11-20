import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { getRemovalPlan, removePlugin, type RemovalPlan, type RemoveKeep } from '@/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { LoadingState } from '@/components/ui/spinner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// Remove a plugin without leaving its work running (design 2026-11-20-plugin-update-and-remove).
// The sheet lists what runs, offers what to keep with what each costs, and says saved records stay.
// A sheet, not a dialog: it is a multi-choice step (AGENTS.md section 5).

/** Bytes as GB or MB, binary units, the way the copy page shows sizes. */
export function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

const KEEPS: RemoveKeep[] = ['all', 'settings', 'nothing'];

export function RemovePluginSheet({ pluginId, open, onOpenChange, onRemoved }: {
  pluginId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [keep, setKeep] = useState<RemoveKeep>('all');
  const [busy, setBusy] = useState(false);
  const [stillStopping, setStillStopping] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPlan(null); setKeep('all'); setStillStopping(null); setError(null);
    let live = true;
    void getRemovalPlan(pluginId).then((p) => { if (live) setPlan(p); }, (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [open, pluginId]);

  const doRemove = async () => {
    setBusy(true); setStillStopping(null); setError(null);
    try {
      await removePlugin(pluginId, keep);
      onRemoved();
    } catch (e) {
      const ids = (e as { stillStopping?: string[] }).stillStopping;
      if (ids) setStillStopping(ids);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const size = formatSize(plan?.copiedBytes ?? 0);
  const P = 'settings.marketplace.removeSheet';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 overflow-y-auto p-0" data-testid="remove-plugin-sheet">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-2">
            <SheetTitle>{t(`${P}.title`, { id: pluginId })}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t(`${P}.actions`)} data-testid="remove-plugin-menu" disabled={busy}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive" disabled={!plan || busy} data-testid="remove-plugin-confirm" onSelect={() => { void doRemove(); }}>
                  {t(`${P}.remove`)}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenChange(false)}>{t(`${P}.cancel`)}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>{t(`${P}.intro`)}</SheetDescription>
        </SheetHeader>

        {!plan && !error ? (
          <div className="min-h-[16rem]"><LoadingState /></div>
        ) : (
          <div className="flex flex-col gap-5 px-6 py-4 text-sm">
            {plan ? (
              <section data-testid="remove-running" className="flex flex-col gap-1">
                <h3 className="m-0 text-sm font-medium">{t(`${P}.running`)}</h3>
                {plan.running.length === 0 ? (
                  <p className="m-0 text-muted-foreground">{t(`${P}.nothingRunning`)}</p>
                ) : (
                  <>
                    <ul className="m-0 list-none space-y-0.5 p-0">
                      {plan.running.map((r) => (
                        <li key={r.id}>{t(r.kind === 'copy' ? `${P}.runningCopy` : `${P}.runningCheck`, { id: r.id, status: r.status })}</li>
                      ))}
                    </ul>
                    <p className="m-0 text-muted-foreground">{t(`${P}.stops`)}</p>
                  </>
                )}
              </section>
            ) : null}

            {plan ? (
              <section className="flex flex-col gap-2">
                <h3 className="m-0 text-sm font-medium">{t(`${P}.keep`)}</h3>
                <RadioGroup value={keep} onValueChange={(v) => setKeep(v as RemoveKeep)} className="gap-3">
                  {KEEPS.map((k) => (
                    <div key={k} className="flex items-start gap-3" data-testid={`remove-choice-${k}`}>
                      <RadioGroupItem value={k} id={`remove-keep-${k}`} className="mt-0.5" aria-label={t(`${P}.${k}Label`)} />
                      <Label htmlFor={`remove-keep-${k}`} className="flex flex-col gap-0.5 font-normal">
                        <span className="font-medium">{t(`${P}.${k}Label`)}</span>
                        <span className="text-muted-foreground">{t(`${P}.${k}Good`, { size })}</span>
                        <span className="text-muted-foreground">{t(`${P}.${k}Cost`, { size })}</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </section>
            ) : null}

            <p className="m-0 text-muted-foreground" data-testid="remove-saved-kept">{t(`${P}.savedKept`)}</p>

            {stillStopping ? (
              <p className="m-0 text-destructive" role="alert" data-testid="remove-still-stopping">
                {t(`${P}.stillStopping`, { ids: stillStopping.join(', ') })}
              </p>
            ) : null}
            {error ? <p className="m-0 text-destructive" role="alert">{error}</p> : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
