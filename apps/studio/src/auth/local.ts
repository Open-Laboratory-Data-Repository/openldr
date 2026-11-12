// Browser calls for AUTH_ADAPTER=local, against the routes in apps/server/src/local-auth-routes.ts.
//
// Every call uses plain fetch with same-origin credentials, not authFetch. authFetch turns a 401
// into a re-login, and a 401 here is an expected answer (wrong password, session ended).
//
// The access token lives in memory only, through setAccessToken. Nothing here writes to
// localStorage, sessionStorage or a cookie. The server sets the session cookie itself.
import { getAccessToken, setAccessToken } from './token';

export interface LocalSession { accessToken: string; expiresIn: number; mustChangePassword: boolean }
export type PasswordFailure = 'too_short' | 'too_long' | 'same_as_username';

/** Refresh this long before the access token expires. */
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
/** Never schedule a refresh sooner than this, so a short token cannot cause a tight loop. */
const MIN_REFRESH_DELAY_MS = 10_000;
/** Wait this long before the one retry after a network failure. */
const RETRY_DELAY_MS = 5_000;

function post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

function unexpected(path: string, status: number): Error {
  return new Error(`${path} answered ${status}`);
}

/** Signs in. Throws when the server cannot be reached or answers with a server error. */
export async function localLogin(username: string, password: string): Promise<LocalSession | 'invalid' | 'too_many'> {
  const res = await post('/api/auth/login', { username, password });
  if (res.ok) return await res.json() as LocalSession;
  if (res.status === 429) return 'too_many';
  // 400 comes back only for a value the server will not read, such as an empty field.
  if (res.status === 401 || res.status === 400) return 'invalid';
  throw unexpected('/api/auth/login', res.status);
}

/**
 * Trades the session cookie for a new access token. Null means the session has ended.
 * Throws when the network or the server fails, so a caller can tell a blip from an ended session.
 */
export async function localRefresh(): Promise<LocalSession | null> {
  const res = await post('/api/auth/refresh');
  if (res.ok) return await res.json() as LocalSession;
  if (res.status >= 500) throw unexpected('/api/auth/refresh', res.status);
  return null;
}

/**
 * Ends the session on the server. True when the server answered 2xx. False on any other status
 * or a failed request: the server session and its cookie may then still be alive.
 * Never throws, because signing out in the browser must still happen.
 */
export async function localLogout(): Promise<boolean> {
  try {
    return (await post('/api/auth/logout')).ok;
  } catch {
    return false;
  }
}

const CHANGE_PASSWORD_FAILURES = new Set<string>(['wrong_current', 'too_short', 'too_long', 'same_as_username', 'same_as_current']);

type ChangePasswordFailure = 'wrong_current' | 'same_as_current' | PasswordFailure;

/**
 * Changes the signed-in account's password. Throws on any answer it cannot map.
 * 'session_ended' covers every 401: the route's own `session_ended`, and the auth plugin's answer
 * when the token no longer verifies, which under local sign-in means the session is gone.
 * 'same_as_current' means a forced change tried to keep the temporary password.
 */
export async function localChangePassword(current: string, next: string): Promise<'ok' | 'session_ended' | ChangePasswordFailure> {
  const token = getAccessToken();
  const res = await post(
    '/api/auth/change-password',
    { currentPassword: current, newPassword: next },
    token ? { Authorization: `Bearer ${token}` } : {},
  );
  if (res.ok) return 'ok';
  if (res.status === 401) return 'session_ended';
  if (res.status === 400) {
    const code = await errorCode(res);
    if (code && CHANGE_PASSWORD_FAILURES.has(code)) return code as ChangePasswordFailure;
  }
  throw unexpected('/api/auth/change-password', res.status);
}

type SetupFailure = 'already_set_up' | 'bad_code' | 'bad_username' | 'username_taken' | 'too_many' | PasswordFailure;
const SETUP_FAILURES = new Set<string>(['already_set_up', 'bad_code', 'bad_username', 'username_taken', 'too_short', 'too_long', 'same_as_username']);

/** Creates the first admin and signs them in. Throws on any answer it cannot map. */
export async function localSetup(
  input: { setupCode: string; username: string; displayName?: string; password: string },
): Promise<LocalSession | SetupFailure> {
  const res = await post('/api/auth/setup', input);
  if (res.ok) return await res.json() as LocalSession;
  if (res.status === 429) return 'too_many';
  const code = await errorCode(res);
  if (code && SETUP_FAILURES.has(code)) return code as SetupFailure;
  throw unexpected('/api/auth/setup', res.status);
}

/** Stores the token with setAccessToken, then refreshes 60 seconds before it expires. Returns a stop function. */
export function keepSessionFresh(session: LocalSession, onEnded: () => void): () => void {
  let stopped = false;
  let retried = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const delayFor = (s: LocalSession) => Math.max(s.expiresIn * 1000 - REFRESH_BEFORE_EXPIRY_MS, MIN_REFRESH_DELAY_MS);
  const schedule = (ms: number) => { timer = setTimeout(() => { void refresh(); }, ms); };
  const end = () => {
    stopped = true;
    setAccessToken(null);
    onEnded();
  };

  async function refresh(): Promise<void> {
    timer = undefined;
    let next: LocalSession | null;
    try {
      next = await localRefresh();
    } catch {
      if (stopped) return;
      // The network or server failed. Retry once before treating the session as ended.
      if (!retried) {
        retried = true;
        schedule(RETRY_DELAY_MS);
        return;
      }
      end();
      return;
    }
    if (stopped) return;
    // The server said the session is over. That is final, so no retry.
    if (!next) { end(); return; }
    retried = false;
    setAccessToken(next.accessToken);
    schedule(delayFor(next));
  }

  setAccessToken(session.accessToken);
  schedule(delayFor(session));
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}
