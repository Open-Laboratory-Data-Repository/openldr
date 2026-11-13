import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authFetch, getMe, getMyCapabilities, type ClientConfig, type CurrentUser } from '@/api';
import { resolveAuthCapabilities } from './capabilities';
import type { AuthCapabilities } from '@/api';
import { getOidc, type OidcClient } from './oidc';
// Aliased: `setAuthEnforced` is also this component's React state setter. The token-module copy is
// what api.ts's authFetch reads, so both have to be kept in sync from the one /api/config response.
import { setAccessToken, setAuthEnforced as setAuthEnforcedForFetch, setUnauthorizedHandler } from './token';
import { keepSessionFresh, localLogout, localRefresh, type LocalSession } from './local';
import { LoginPage } from './LoginPage';
import { SetupPage } from './SetupPage';
import { ChangePasswordPage } from './ChangePasswordPage';
import { FirstRunPage } from '../first-run/FirstRunPage';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';

/** Module-level guard: prevents StrictMode double-invocation from issuing two signinRedirects. */
let redirecting = false;

/**
 * Set in this tab when SetupPage makes the first administrator, and removed when the first-run
 * flow ends or the session does. Session storage, so a reload in the middle shows the flow again
 * and no other tab or person ever sees it.
 */
export const FIRST_RUN_KEY = 'openldr.firstRun';

function readFirstRun(): boolean {
  try { return sessionStorage.getItem(FIRST_RUN_KEY) === '1'; } catch { return false; }
}

function writeFirstRun(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(FIRST_RUN_KEY, '1');
    else sessionStorage.removeItem(FIRST_RUN_KEY);
  } catch {
    // Storage is blocked. The flow then shows until it ends or the page reloads.
  }
}

/** Test-only: reset module-level state between tests. */
export function __resetAuthProviderState(): void { redirecting = false; }

interface AuthState {
  authCapabilities?: AuthCapabilities;
  user: CurrentUser | null;
  loading: boolean;
  /** Capability-based authorization check. */
  hasCapability: (cap: string) => boolean;
  signOut: () => void;
  /** Whether the server enforces auth. False when AUTH_DEV_BYPASS is on (dev only). Defaults true (fail-safe). */
  authEnforced: boolean;
  /** Which sign-in runs. 'local' only while local sign-in is enforced, never under the dev bypass. */
  authMode: AuthMode;
}

export type AuthMode = 'keycloak' | 'oidc' | 'local';

const AuthContext = createContext<AuthState>({
  authCapabilities: { identityAdmin: false, syncClientAdmin: false },
  user: null,
  loading: true,
  hasCapability: () => false,
  signOut: () => {},
  authEnforced: true,
  authMode: 'keycloak',
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities>({ identityAdmin: false, syncClientAdmin: false });
  const [localSignout, setLocalSignout] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [authEnforced, setAuthEnforced] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>('keycloak');
  const oidcRef = useRef<OidcClient | null>(null);
  // Local sign-in (AUTH_ADAPTER=local). `localScreen` is the pre-app screen to show, or null.
  const [localScreen, setLocalScreen] = useState<'login' | 'change' | 'setup' | null>(null);
  /** The last sign-out did not reach the server. The sign-in page warns and offers a retry. */
  const [signOutFailed, setSignOutFailed] = useState(false);
  /** This person just made the first administrator in this tab, and has not finished the first run. */
  const [firstRun, setFirstRun] = useState(readFirstRun);
  const localModeRef = useRef(false);
  /** Stops the running refresh timer. Null when no local session is running. */
  const localStopRef = useRef<(() => void) | null>(null);
  const localRetryingRef = useRef(false);
  const location = useLocation();
  const { t } = useTranslation();

  const stopLocalTimer = () => {
    localStopRef.current?.();
    localStopRef.current = null;
  };

  const endFirstRun = () => {
    writeFirstRun(false);
    setFirstRun(false);
  };

  const showLocalSignIn = () => {
    stopLocalTimer();
    // The next person to sign in in this tab may not be the one who made the administrator.
    endFirstRun();
    setAccessToken(null);
    setUser(null);
    setCapabilities([]);
    setLocalScreen('login');
    setLoading(false);
  };

  const keepLocalSession = (session: LocalSession) => {
    stopLocalTimer();
    localStopRef.current = keepSessionFresh(session, showLocalSignIn);
  };

  const openLocalSession = async (session: LocalSession) => {
    setSignOutFailed(false);
    keepLocalSession(session);
    if (session.mustChangePassword) {
      setLocalScreen('change');
      setLoading(false);
      return;
    }
    const [u, caps] = await Promise.all([
      getMe().catch(() => null),
      getMyCapabilities().catch(() => []),
    ]);
    setUser(u);
    setCapabilities(caps);
    setLocalScreen(null);
    setLoading(false);
  };

  /** A request came back 401. Try one refresh; if the session has ended, show the sign-in page. */
  const onLocalUnauthorized = () => {
    const running = localStopRef.current;
    if (!running || localRetryingRef.current) return;
    localRetryingRef.current = true;
    localRefresh().then((session) => {
      // Signed out, ended or replaced while the refresh ran: its answer no longer applies.
      if (localStopRef.current !== running) return;
      if (session) keepLocalSession(session);
      else showLocalSignIn();
    }, () => {
      // The network failed. Keep the session; the refresh timer retries on its own.
    }).finally(() => { localRetryingRef.current = false; });
  };

  // On unmount, stop the refresh timer. A timer left running would keep the session alive.
  useEffect(() => () => {
    stopLocalTimer();
    if (localModeRef.current) setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Fail-closed: fetch config strictly — a non-OK response is an error, not a bypass.
        const r = await authFetch('/api/config');
        if (!r.ok) throw new Error('config');
        const cfg = await r.json() as ClientConfig;
        // Module state, not component state — set it regardless of `active` so a remount can't
        // leave authFetch on the fail-safe default while the server is actually in dev bypass.
        setAuthEnforcedForFetch(cfg.authEnforced);
        if (active) { setAuthEnforced(cfg.authEnforced); setAuthCapabilities(resolveAuthCapabilities(cfg)); }

        // Local sign-in has no oidc block, so this must run before the bypass check below, which
        // reads a missing oidc block as the dev bypass. An older server sends no auth block: not local.
        if (cfg.authEnforced && cfg.auth?.mode === 'local') {
          localModeRef.current = true;
          if (active) setAuthMode('local');
          setUnauthorizedHandler(onLocalUnauthorized);
          // Navigation re-runs this effect. A running session needs nothing more.
          if (localStopRef.current) return;
          if (cfg.auth.setupRequired) {
            if (active) { setLocalScreen('setup'); setLoading(false); }
            return;
          }
          const session = await localRefresh();
          if (!active) return;
          if (!session) { endFirstRun(); setLocalScreen('login'); setLoading(false); return; }
          await openLocalSession(session);
          return;
        }

        // An older server sends no auth block: tell generic OIDC from Keycloak by the oidc block.
        // Under the dev bypass a server can still name local sign-in; that is not a local session.
        const named = cfg.auth?.mode;
        if (active) setAuthMode(named && named !== 'local' ? named : cfg.oidc?.mode === 'oidc' ? 'oidc' : 'keycloak');

        if (!cfg.authEnforced || !cfg.oidc) {
          // Dev-bypass: server injects the dev actor; no interactive login. The server's dev actor
          // is granted all capabilities, so fetch /api/me/capabilities here too.
          const [u, caps] = await Promise.all([
            getMe().catch(() => null),
            getMyCapabilities().catch(() => []),
          ]);
          if (active) { setUser(u); setCapabilities(caps); setLoading(false); }
          return;
        }
        // Enforced. The callback route handles its own exchange — don't double-redirect.
        if (location.pathname === '/auth/callback') { if (active) setLoading(false); return; }
        const oidc = getOidc(cfg.oidc);
        oidcRef.current = oidc;
        const stored = await oidc.getStoredUser();
        if (!stored) {
          try {
            if (redirecting) return;
            redirecting = true;
            await oidc.signinRedirect();
          } catch {
            redirecting = false;
            if (active) { setConfigError(true); setLoading(false); }
          }
          return; // leaves loading=true through the redirect (or error path above resets it)
        }
        const [u, caps] = await Promise.all([
          getMe().catch(() => null),
          getMyCapabilities().catch(() => []),
        ]);
        if (active) { setUser(u); setCapabilities(caps); setLoading(false); }
      } catch {
        if (active) { setConfigError(true); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [location.pathname]);

  const hasCapability = (cap: string) => capabilities.includes(cap);
  const signOut = () => {
    if (localModeRef.current) {
      // Stop the timer first, so no refresh can run during sign-out and sign the person back in.
      // Whatever the server answers, this tab stops acting as the user. When the server did not
      // end the session, its cookie is still alive, so the sign-in page says so.
      stopLocalTimer();
      void localLogout().then((ended) => {
        setSignOutFailed(!ended);
        showLocalSignIn();
      });
      return;
    }
    void oidcRef.current?.signoutRedirect().then((result) => {
      if (result === 'local') { setUser(null); setCapabilities([]); setLocalSignout(true); }
    }).catch(() => setConfigError(true));
  };

  // The sign-out warning belongs to the sign-in page only, so the other two screens never get it.
  if (localScreen === 'setup') {
    return (
      <SetupPage
        onSignedIn={(session) => {
          writeFirstRun(true);
          setFirstRun(true);
          void openLocalSession(session);
        }}
        onSignInInstead={() => setLocalScreen('login')}
      />
    );
  }

  if (localScreen === 'change') {
    return (
      <ChangePasswordPage
        onChanged={(session) => { void openLocalSession(session); }}
        onSessionEnded={showLocalSignIn}
        onSignOut={signOut}
      />
    );
  }

  if (localScreen) {
    return (
      <LoginPage
        onSignedIn={(session) => { void openLocalSession(session); }}
        signOutFailed={signOutFailed}
        onRetrySignOut={async () => { if (await localLogout()) setSignOutFailed(false); }}
      />
    );
  }

  if (localSignout) {
    return <StripedEmpty className="h-dvh"><div className="flex max-w-sm flex-col gap-4 p-6 text-center">
      <p>{t('common.localSignout')}</p>
      <Button onClick={() => { void oidcRef.current?.signinRedirect(); }}>{t('common.signIn')}</Button>
    </div></StripedEmpty>;
  }

  if (configError) {
    return (
      <StripedEmpty className="h-screen">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{t('common.configUnreachable')}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </StripedEmpty>
    );
  }

  // Hold children until auth resolves so no API call fires before the access token is
  // restored into the in-memory holder (otherwise the first requests race to a 401).
  // The /auth/callback effect sets loading=false itself, so CallbackPage still renders.
  if (loading) {
    return (
      <StripedEmpty className="h-screen">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">{t('common.signingIn')}</p>
        </div>
      </StripedEmpty>
    );
  }

  const auth: AuthState = { authCapabilities, user, loading, hasCapability, signOut, authEnforced, authMode };

  // Straight after the first administrator is made, the first-run steps come before the app.
  if (firstRun && authMode === 'local' && user) {
    return <AuthContext.Provider value={auth}><FirstRunPage onDone={endFirstRun} /></AuthContext.Provider>;
  }

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
