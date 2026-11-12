import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { localChangePassword, localRefresh, type LocalSession } from './local';

type ChangeFailure = Exclude<Awaited<ReturnType<typeof localChangePassword>>, 'ok' | 'session_ended'>;

/** The i18n key for each refusal from POST /api/auth/change-password. The sheet uses it too. */
export const CHANGE_FAILURE_KEYS: Record<ChangeFailure, string> = {
  wrong_current: 'auth.wrongCurrent',
  too_short: 'auth.tooShort',
  too_long: 'auth.tooLong',
  same_as_username: 'auth.sameAsUsername',
  same_as_current: 'auth.sameAsCurrent',
};

/**
 * The forced password change under AUTH_ADAPTER=local. AuthProvider renders it in place when the
 * session must change its password, with the same layout as LoginPage. It renders outside the
 * auth context, so sign-out and the session callbacks come in as props.
 */
export function ChangePasswordPage({ onChanged, onSessionEnded, onSignOut }: {
  /** The password changed and a fresh session, without the must-change mark, is ready. */
  onChanged: (session: LocalSession) => void;
  /** The session is over. AuthProvider clears the token and shows the sign-in page. */
  onSessionEnded: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const clearPasswords = () => { setCurrent(''); setNext(''); setRepeat(''); };

  async function submit(e: FormEvent) {
    e.preventDefault();
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
    // The passwords are no longer needed, whatever the answer.
    clearPasswords();
    if (result === 'session_ended') { onSessionEnded(); return; }
    if (result !== 'ok') {
      setMessage(t(CHANGE_FAILURE_KEYS[result]));
      setBusy(false);
      return;
    }
    // The token in memory still carries the must-change mark. A refresh gives one without it.
    // If the refresh fails, the password has changed anyway, so signing in again is the way back:
    // sending this form again would fail on the old current password.
    let session: LocalSession | null;
    try {
      session = await localRefresh();
    } catch {
      session = null;
    }
    if (!session) { onSessionEnded(); return; }
    // Stay busy: AuthProvider replaces this page once the user has loaded.
    onChanged(session);
  }

  return (
    <StripedEmpty className="h-dvh">
      <form onSubmit={(e) => { void submit(e); }} noValidate>
        <div className="flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground shadow-sm sm:p-6">
          <h1 className="text-lg font-semibold">{t('auth.mustChangeTitle')}</h1>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <Label htmlFor="local-change-current" className="whitespace-nowrap">{t('auth.currentPassword')}</Label>
            <Input
              id="local-change-current"
              className="min-w-0"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <Label htmlFor="local-change-new" className="whitespace-nowrap">{t('auth.newPassword')}</Label>
            <Input
              id="local-change-new"
              className="min-w-0"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <Label htmlFor="local-change-repeat" className="whitespace-nowrap">{t('auth.repeatPassword')}</Label>
            <Input
              id="local-change-repeat"
              className="min-w-0"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
          {message && <p role="alert" className="text-destructive">{message}</p>}
          <Button type="submit" disabled={busy}>{t('auth.changePassword')}</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onSignOut}>
            {t('common.signOut')}
          </Button>
        </div>
      </form>
    </StripedEmpty>
  );
}
