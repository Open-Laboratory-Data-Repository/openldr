import type { Config } from './schema';

export type AuthSelectionConfig = Partial<Pick<Config,
  'AUTH_ADAPTER' | 'IDENTITY_ADMIN_ADAPTER' | 'KEYCLOAK_ADMIN_CLIENT_ID' | 'KEYCLOAK_ADMIN_CLIENT_SECRET'>>;

export function resolveIdentityAdminAdapter(cfg: AuthSelectionConfig): 'keycloak' | 'none' {
  const mode = cfg.AUTH_ADAPTER ?? 'keycloak';
  const admin = cfg.IDENTITY_ADMIN_ADAPTER ?? (mode === 'keycloak' ? 'keycloak' : 'none');
  if ((mode !== 'keycloak' && mode !== 'oidc') || (admin !== 'keycloak' && admin !== 'none') || (mode === 'oidc' && admin === 'keycloak')) {
    throw new Error('Invalid authentication and identity administration selection');
  }
  return admin;
}

export function resolveAuthCapabilities(cfg: AuthSelectionConfig) {
  const available = resolveIdentityAdminAdapter(cfg) === 'keycloak'
    && Boolean(cfg.KEYCLOAK_ADMIN_CLIENT_ID && cfg.KEYCLOAK_ADMIN_CLIENT_SECRET);
  return { identityAdmin: available, syncClientAdmin: available };
}
