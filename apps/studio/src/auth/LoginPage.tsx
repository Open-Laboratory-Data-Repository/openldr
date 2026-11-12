import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { localLogin, type LocalSession } from './local';

/**
 * The sign-in page for AUTH_ADAPTER=local. AuthProvider renders it in place at whatever URL the
 * person opened, so it has no route. It is a full page because no app shell exists yet.
 * The visible submit button is deliberate: the dots-menu rule covers actions inside the app.
 */
export function LoginPage({ onSignedIn, signOutFailed = false, onRetrySignOut }: {
  onSignedIn: (session: LocalSession) => void;
  /** The last sign-out did not reach the server, so its session may still be open. */
  signOutFailed?: boolean;
  onRetrySignOut?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retrySignOut() {
    if (!onRetrySignOut || retrying) return;
    setRetrying(true);
    try {
      await onRetrySignOut();
    } finally {
      setRetrying(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    // An empty field would only spend one of the per-minute attempts on a certain failure.
    if (!username || !password) return;
    setBusy(true);
    setMessage(null);
    let result: Awaited<ReturnType<typeof localLogin>>;
    try {
      result = await localLogin(username, password);
    } catch {
      // Thrown on a network failure or a 5xx. Trying again is the fix, so no reload hint.
      setMessage(t('auth.unreachable'));
      setBusy(false);
      return;
    }
    if (typeof result === 'string') {
      setMessage(result === 'too_many' ? t('auth.tooMany') : t('auth.invalid'));
      setPassword('');
      setBusy(false);
      return;
    }
    // Stay busy: AuthProvider replaces this page once the user has loaded.
    onSignedIn(result);
  }

  return (
    <StripedEmpty className="h-dvh">
      <form onSubmit={(e) => { void submit(e); }} noValidate>
        <div className="flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground shadow-sm sm:p-6">
          <h1 className="text-lg font-semibold">{t('auth.signInTitle')}</h1>
          {signOutFailed && (
            <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3">
              <p className="text-destructive">{t('auth.signOutFailed')}</p>
              <Button type="button" variant="outline" disabled={retrying} onClick={() => { void retrySignOut(); }}>
                {t('auth.signOutRetry')}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <Label htmlFor="local-sign-in-username" className="whitespace-nowrap">{t('auth.username')}</Label>
            <Input
              id="local-sign-in-username"
              className="min-w-0"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Label htmlFor="local-sign-in-password" className="whitespace-nowrap">{t('auth.password')}</Label>
            <Input
              id="local-sign-in-password"
              className="min-w-0"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {message && <p role="alert" className="text-destructive">{message}</p>}
          <Button type="submit" disabled={busy}>{t('common.signIn')}</Button>
        </div>
      </form>
    </StripedEmpty>
  );
}
