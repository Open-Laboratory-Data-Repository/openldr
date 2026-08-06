// In-memory access-token holder. SP1b's login flow will call setAccessToken().
// Until then it stays null and the server's AUTH_DEV_BYPASS provides the actor.
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// A callback the auth layer registers to re-trigger login when an authenticated request comes
// back 401 (expired SSO session / failed silent-renew). Kept here (not in oidc.ts) so the api.ts
// fetch wrapper can notify it without importing the OIDC client.
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

// Whether the SERVER enforces authentication — `authEnforced` from GET /api/config, which is
// `!AUTH_DEV_BYPASS`. Mirrored here (AuthProvider also holds it in React state) so the api.ts
// fetch wrapper can consult it without importing React or the OIDC client, exactly like
// notifyUnauthorized above.
//
// Defaults to FALSE, meaning "not known yet — behave exactly as before this flag existed". The
// only thing it gates is whether a token-less request is answered locally instead of being sent,
// so an unknown state must fall back to sending it; defaulting to `true` would suppress real calls
// from any caller that never boots AuthProvider. Nothing races it in the app either — AuthProvider
// sets it from /api/config and holds `children` behind a loading screen until that resolves, so it
// is already correct before the first protected request is issued.
let authEnforced = false;

export function isAuthEnforced(): boolean {
  return authEnforced;
}

export function setAuthEnforced(enforced: boolean): void {
  authEnforced = enforced;
}
