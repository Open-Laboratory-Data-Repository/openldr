import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function QueryNameSheet({ initialName, onClose, onSave }: {
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message === 'name already exists' ? t('query.nameExists') : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{t('query.saveNameTitle')}</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('query.nameActions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={busy || !name.trim()} onSelect={() => void save()}>{t('common.save')}</DropdownMenuItem>
                <DropdownMenuItem disabled={busy} onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <SheetDescription>{t('query.nameDescription')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
            <Label htmlFor="query-name">{t('query.name')}</Label>
            <Input id="query-name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)}
              aria-invalid={!!error} aria-describedby={error ? 'query-name-error' : undefined} />
          </div>
          {error && <p id="query-name-error" role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
