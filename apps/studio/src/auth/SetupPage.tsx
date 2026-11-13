import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { desktopApp, type OpenldrDesktop } from '@/desktop';
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
 * How long to wait for the desktop app's setup code. The app does not end a command that hangs,
 * so the limit sits here.
 */
const APP_CODE_LIMIT_MS = 30_000;

/** The desktop app's setup code, or undefined when it fails, is empty or takes longer than the limit. */
function codeFromApp(app: OpenldrDesktop): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (code: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => settle(undefined), APP_CODE_LIMIT_MS);
    app.setupCode().then(
      (code) => settle(typeof code === 'string' && code.trim() ? code.trim() : undefined),
      () => settle(undefined),
    );
  });
}

/** Where the setup code field's value comes from: the person types it, the app is asked, or the app gave it. */
type CodeSource = 'typed' | 'asking' | 'app';

/**
 * Creates the first administrator under AUTH_ADAPTER=local. AuthProvider renders it in place
 * while the install needs setup, with the same layout as LoginPage. The setup code comes from
 * `openldr auth setup-code` on the server. Inside the OpenLDR desktop app, the app fills it in.
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
  const [codeSource, setCodeSource] = useState<CodeSource>(() => (desktopApp() ? 'asking' : 'typed'));

  // Inside the desktop app, ask it for the setup code once. Without the app, nothing happens.
  useEffect(() => {
    const app = desktopApp();
    if (!app) return;
    let cancelled = false;
    setCodeSource('asking');
    void codeFromApp(app).then((code) => {
      if (cancelled) return;
      if (code === undefined) {
        setCodeSource('typed');
        return;
      }
      setSetupCode(code);
      setCodeSource('app');
    });
    return () => { cancelled = true; };
  }, []);

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
      // The passwords are no longer needed, whatever the answer.
      clearPasswords();
      const app = desktopApp();
      if (result === 'bad_code' && codeSource === 'app' && app) {
        // The app's code expired while the page sat open. Ask for a fresh one and send once more,
        // with the username and password from when the person pressed the button.
        const fresh = await codeFromApp(app);
        if (fresh === undefined) {
          setSetupCode('');
          setCodeSource('typed');
        } else {
          setSetupCode(fresh);
          result = await localSetup({ setupCode: fresh, username: name, password });
        }
      }
    } catch {
      setMessage(t('auth.unreachable'));
      clearPasswords();
      setBusy(false);
      return;
    }
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
              type={codeSource === 'app' ? 'password' : undefined}
              readOnly={codeSource === 'app'}
              disabled={codeSource === 'asking'}
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
            />
            <p id="local-setup-code-hint" className="col-start-2 text-xs text-muted-foreground">
              {t(codeSource === 'app' ? 'auth.setupCodeFromApp' : 'auth.setupCodeHint')}
            </p>
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
