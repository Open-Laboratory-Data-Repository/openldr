import { describe, it, expect } from 'vitest';
import { resolveAuthCapabilities } from './capabilities';
describe('provider administration availability', () => {
  it('preserves old Keycloak config', () => {
    expect(resolveAuthCapabilities({ oidc: { issuerUrl: 'https://kc', clientId: 'c', audience: null } })).toEqual({ identityAdmin: true, syncClientAdmin: true });
  });
  it('does not infer administration for generic discovery', () => {
    expect(resolveAuthCapabilities({ oidc: { mode: 'oidc', issuerUrl: 'https://idp', clientId: 'c', audience: null } })).toEqual({ identityAdmin: false, syncClientAdmin: false });
  });
  it('honors explicit unavailable flags', () => {
    expect(resolveAuthCapabilities({ oidc: null, authCapabilities: { identityAdmin: false, syncClientAdmin: false } }).identityAdmin).toBe(false);
  });
});
