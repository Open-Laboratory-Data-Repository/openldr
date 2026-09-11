import type { AuthCapabilities, ClientConfig } from '@/api';

export function resolveAuthCapabilities(cfg: Pick<ClientConfig, 'oidc' | 'authCapabilities'>): AuthCapabilities {
  if (cfg.authCapabilities) return cfg.authCapabilities;
  const legacyKeycloak = cfg.oidc !== null && cfg.oidc.mode !== 'oidc';
  return { identityAdmin: legacyKeycloak, syncClientAdmin: legacyKeycloak };
}
