import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { localSetup, type LocalSession } from './local';

type SetupFailure = Exclude<Awaited<ReturnType<typeof localSetup>>, LocalSession>;

const FAILURE_KEYS: Record<SetupFailure, string> = {
  bad_code: 'auth.badCode',
  already_set_up: 'auth.alreadySetUp',
  bad_username: 'auth.badUsername',
  username_taken: 'auth.usernameTaken',
  too_short: 'auth.tooShort',
  too_long: 'auth.tooLong',
  same_as_username: 'auth.sameAsUsername',
  too_many: 'auth.tooMany',
};

/**
 * Creates the first administrator under AUTH_ADAPTER=local. AuthProvider renders it in place
 * while the install needs setup, with the same layout as LoginPage. The setup code comes from
 * `openldr auth setup-code` on the server.
 */
export function SetupPage({ onSignedIn, onSignInInstead }: {
  onSignedIn: (session: LocalSession) => void;
  /** An administrator already exists, so the person should use the sign-in page. */
  onSignInInstead: () => void;
}) {
  const { t } = useTranslation();
  const [setupCode, setSetupCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [alreadySetUp, setAlreadySetUp] = useState(false);

  const clearPasswords = () => { setPassword(''); setRepeat(''); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const code = setupCode.trim();
    const name = username.trim();
    if (!code || !name || !password || !repeat) return;
    if (password !== repeat) {
      setMessage(t('auth.passwordsDiffer'));
      clearPasswords();
      return;
    }
    setBusy(true);
    setMessage(null);
    let result: Awaited<ReturnType<typeof localSetup>>;
    try {
      result = await localSetup({ setupCode: code, username: name, password });
    } catch {
      setMessage(t('auth.unreachable'));
      clearPasswords();
      setBusy(false);
      return;
    }
    // The passwords are no longer needed, whatever the answer.
    clearPasswords();
    if (typeof result === 'string') {
      setMessage(t(FAILURE_KEYS[result]));
      if (result === 'already_set_up') setAlreadySetUp(true);
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
          <h1 className="text-lg font-semibold">{t('auth.setupTitle')}</h1>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <Label htmlFor="local-setup-code" className="whitespace-nowrap">{t('auth.setupCode')}</Label>
            <Input
              id="local-setup-code"
              className="min-w-0"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="local-setup-code-hint"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
            />
            <p id="local-setup-code-hint" className="col-start-2 text-xs text-muted-foreground">{t('auth.setupCodeHint')}</p>
            <Label htmlFor="local-setup-username" className="whitespace-nowrap">{t('users.username')}</Label>
            <Input
              id="local-setup-username"
              className="min-w-0"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Label htmlFor="local-setup-password" className="whitespace-nowrap">{t('auth.password')}</Label>
            <Input
              id="local-setup-password"
              className="min-w-0"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Label htmlFor="local-setup-repeat" className="whitespace-nowrap">{t('auth.repeatPassword')}</Label>
            <Input
              id="local-setup-repeat"
              className="min-w-0"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
          {message && <p role="alert" className="text-destructive">{message}</p>}
          {alreadySetUp && (
            <Button type="button" variant="outline" onClick={onSignInInstead}>{t('common.signIn')}</Button>
          )}
          <Button type="submit" disabled={busy}>{t('auth.setupTitle')}</Button>
        </div>
      </form>
    </StripedEmpty>
  );
}
