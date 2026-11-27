import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { addWorkflowHost } from '@/api';
import { changeWasMade, networkErrorLine } from './networkError';

/** Adds one host a workflow HTTP step may call. One field. Save is in the header's menu. */
export function WorkflowHostSheet({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  // Moves on every opening, so a save that ends late does not close a sheet opened since.
  const session = useRef(0);

  useEffect(() => {
    session.current++;
    if (open) {
      setHost('');
      setBusy(false);
    }
  }, [open]);

  async function save(): Promise<void> {
    const mine = session.current;
    const sameSheet = (): boolean => session.current === mine;
    if (busy) return;
    setBusy(true);
    try {
      await addWorkflowHost(host.trim());
      toast.success(t('settings.network.saved'));
      onChanged();
      if (sameSheet()) onOpenChange(false);
    } catch (err) {
      toast.error(networkErrorLine(err, t));
      if (changeWasMade(err)) {
        onChanged();
        if (sameSheet()) onOpenChange(false);
      }
    } finally {
      if (sameSheet()) setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{t('settings.network.sheetHostTitle')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="host-sheet-menu" aria-label={t('settings.network.colActions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="host-save" disabled={busy || host.trim() === ''} onSelect={() => void save()}>
                  {t('settings.network.save')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>{t('settings.network.sheetHostDescription')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <Label htmlFor="host-name" className="whitespace-nowrap">{t('settings.network.fieldHost')}</Label>
            <Input
              id="host-name"
              data-testid="host-name"
              disabled={busy}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={host}
              placeholder="hub.example.org"
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
