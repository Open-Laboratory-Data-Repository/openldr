import type { Config } from './schema';

export type AuthSelectionConfig = Partial<Pick<Config,
  'AUTH_ADAPTER' | 'IDENTITY_ADMIN_ADAPTER' | 'KEYCLOAK_ADMIN_CLIENT_ID' | 'KEYCLOAK_ADMIN_CLIENT_SECRET'>>;

const MODES: readonly string[] = ['keycloak', 'oidc', 'local'];
const ADMINS: readonly string[] = ['keycloak', 'none', 'local'];

export function resolveIdentityAdminAdapter(cfg: AuthSelectionConfig): 'keycloak' | 'none' | 'local' {
  const mode = cfg.AUTH_ADAPTER ?? 'keycloak';
  const admin = cfg.IDENTITY_ADMIN_ADAPTER ?? (mode === 'keycloak' ? 'keycloak' : mode === 'local' ? 'local' : 'none');
  // Keycloak administration needs Keycloak sign-in, and local administration needs local sign-in.
  if (!MODES.includes(mode) || !ADMINS.includes(admin) || (admin !== 'none' && admin !== mode)) {
    throw new Error('Invalid authentication and identity administration selection');
  }
  return admin;
}

export function resolveAuthCapabilities(cfg: AuthSelectionConfig) {
  const admin = resolveIdentityAdminAdapter(cfg);
  const keycloakAdmin = admin === 'keycloak'
    && Boolean(cfg.KEYCLOAK_ADMIN_CLIENT_ID && cfg.KEYCLOAK_ADMIN_CLIENT_SECRET);
  return {
    identityAdmin: keycloakAdmin || admin === 'local',
    syncClientAdmin: keycloakAdmin,
    passwordResetEmail: keycloakAdmin,
  };
}

/** The issuer URL, for code that only runs under keycloak or oidc. The schema already refuses to
 *  start those modes without one, so this throws only if local sign-in reaches such code. */
export function requireOidcIssuer(cfg: { OIDC_ISSUER_URL?: string }): string {
  if (cfg.OIDC_ISSUER_URL === undefined) throw new Error('OIDC_ISSUER_URL is required for this sign-in mode');
  return cfg.OIDC_ISSUER_URL;
}
