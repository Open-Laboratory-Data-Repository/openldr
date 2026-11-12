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
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';

/** Module-level guard: prevents StrictMode double-invocation from issuing two signinRedirects. */
let redirecting = false;

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
}

const AuthContext = createContext<AuthState>({
  authCapabilities: { identityAdmin: false, syncClientAdmin: false },
  user: null,
  loading: true,
  hasCapability: () => false,
  signOut: () => {},
  authEnforced: true,
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
  const oidcRef = useRef<OidcClient | null>(null);
  // Local sign-in (AUTH_ADAPTER=local). `localScreen` is the pre-app screen to show, or null.
  const [localScreen, setLocalScreen] = useState<'login' | 'change' | null>(null);
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

  const showLocalSignIn = () => {
    stopLocalTimer();
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
          setUnauthorizedHandler(onLocalUnauthorized);
          // Navigation re-runs this effect. A running session needs nothing more.
          if (localStopRef.current) return;
          // Task 10 shows the setup page here. Until then, the sign-in page.
          if (cfg.auth.setupRequired) {
            if (active) { setLocalScreen('login'); setLoading(false); }
            return;
          }
          const session = await localRefresh();
          if (!active) return;
          if (!session) { setLocalScreen('login'); setLoading(false); return; }
          await openLocalSession(session);
          return;
        }

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
      stopLocalTimer();
      void localLogout().finally(showLocalSignIn);
      return;
    }
    void oidcRef.current?.signoutRedirect().then((result) => {
      if (result === 'local') { setUser(null); setCapabilities([]); setLocalSignout(true); }
    }).catch(() => setConfigError(true));
  };

  if (localScreen) {
    // Task 10 shows the forced password change page for 'change'. Until then, the sign-in page.
    return <LoginPage onSignedIn={(session) => { void openLocalSession(session); }} />;
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

  return <AuthContext.Provider value={{ authCapabilities, user, loading, hasCapability, signOut, authEnforced }}>{children}</AuthContext.Provider>;
}
