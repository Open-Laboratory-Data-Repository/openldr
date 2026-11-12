import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from './AuthProvider';
import { localChangePassword } from './local';
import { CHANGE_FAILURE_KEYS } from './ChangePasswordPage';

/**
 * Change your own password under AUTH_ADAPTER=local, from the user menu. Copies
 * forms-builder/FieldEditorSheet.tsx: label left and input right, Save and Cancel in the
 * section's dots menu, no footer. The server ends the user's other sessions and keeps this one.
 */
export function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const clearPasswords = () => { setCurrent(''); setNext(''); setRepeat(''); };

  // No password outlives the sheet, however it closes.
  useEffect(() => {
    if (open) return;
    clearPasswords();
    setMessage(null);
  }, [open]);

  const close = () => onOpenChange(false);

  const save = async () => {
    if (busy) return;
    if (!current || !next || !repeat) return;
    if (next !== repeat) {
      setMessage(t('auth.passwordsDiffer'));
      clearPasswords();
      return;
    }
    setBusy(true);
    setMessage(null);
    let result: Awaited<ReturnType<typeof localChangePassword>>;
    try {
      result = await localChangePassword(current, next);
    } catch {
      setMessage(t('auth.unreachable'));
      clearPasswords();
      setBusy(false);
      return;
    }
    clearPasswords();
    setBusy(false);
    if (result === 'session_ended') {
      // The session is over on the server. Signing out clears the token and shows the sign-in page.
      close();
      signOut();
      return;
    }
    if (result !== 'ok') {
      setMessage(t(CHANGE_FAILURE_KEYS[result]));
      return;
    }
    toast.success(t('auth.passwordChanged'));
    close();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg" aria-describedby={undefined}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('auth.changePassword')}</SheetTitle>
        </SheetHeader>
        <section>
          <div className="flex items-center justify-end px-6 py-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('common.actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={busy} onSelect={() => { void save(); }}>{t('common.save')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={close}>{t('common.cancel')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
            <Label htmlFor="change-password-current" className="whitespace-nowrap">{t('auth.currentPassword')}</Label>
            <Input
              id="change-password-current"
              type="password"
              autoComplete="current-password"
              disabled={busy}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <Label htmlFor="change-password-new" className="whitespace-nowrap">{t('auth.newPassword')}</Label>
            <Input
              id="change-password-new"
              type="password"
              autoComplete="new-password"
              disabled={busy}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <Label htmlFor="change-password-repeat" className="whitespace-nowrap">{t('auth.repeatPassword')}</Label>
            <Input
              id="change-password-repeat"
              type="password"
              autoComplete="new-password"
              disabled={busy}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
          {message && <p role="alert" className="px-6 pb-4 text-sm text-destructive">{message}</p>}
        </section>
      </SheetContent>
    </Sheet>
  );
}
