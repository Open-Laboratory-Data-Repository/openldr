import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './schema';
import { resolveAuthCapabilities, resolveIdentityAdminAdapter } from './auth';
const base = { INTERNAL_DATABASE_URL: 'postgres://u:p@localhost/db', TARGET_DATABASE_URL: 'postgres://u:p@localhost/ext', S3_ENDPOINT: 'http://localhost:9010', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_BUCKET: 'b', OIDC_ISSUER_URL: 'https://id.example' };
describe('authentication selection', () => {
  it('preserves Keycloak defaults', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.AUTH_ADAPTER).toBe('keycloak');
    expect(resolveIdentityAdminAdapter(cfg)).toBe('keycloak');
    expect(resolveAuthCapabilities(cfg)).toEqual({ identityAdmin: false, syncClientAdmin: false });
  });
  it.each(['none', undefined])('generic auth ignores stale credentials with admin %s', (admin) => {
    const cfg = ConfigSchema.parse({ ...base, AUTH_ADAPTER: 'oidc', IDENTITY_ADMIN_ADAPTER: admin, KEYCLOAK_ADMIN_CLIENT_ID: 'old', KEYCLOAK_ADMIN_CLIENT_SECRET: 'old' });
    expect(resolveIdentityAdminAdapter(cfg)).toBe('none');
    expect(resolveAuthCapabilities(cfg)).toEqual({ identityAdmin: false, syncClientAdmin: false });
  });
  it('requires both credentials and enabled administration', () => {
    const cfg = ConfigSchema.parse({ ...base, KEYCLOAK_ADMIN_CLIENT_ID: 'admin', KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret' });
    expect(resolveAuthCapabilities(cfg)).toEqual({ identityAdmin: true, syncClientAdmin: true });
    expect(resolveAuthCapabilities({ ...cfg, IDENTITY_ADMIN_ADAPTER: 'none' }).identityAdmin).toBe(false);
    expect(resolveAuthCapabilities({ ...cfg, KEYCLOAK_ADMIN_CLIENT_SECRET: undefined }).identityAdmin).toBe(false);
  });
  it.each([{ AUTH_ADAPTER: 'other' }, { IDENTITY_ADMIN_ADAPTER: 'other' }, { AUTH_ADAPTER: 'oidc', IDENTITY_ADMIN_ADAPTER: 'keycloak' }])('rejects invalid selection %j', (selection) => {
    expect(ConfigSchema.safeParse({ ...base, ...selection }).success).toBe(false);
  });
});

it('defaults browser scopes and accepts a resource audience', () => {
  expect(ConfigSchema.parse(base).OIDC_SCOPES).toBe('openid profile email');
  expect(ConfigSchema.parse({ ...base, OIDC_RESOURCE: 'https://api.example', OIDC_SCOPES: 'openid api.read' }).OIDC_RESOURCE).toBe('https://api.example');
});
it.each(['profile email', '', 'openid\napi', 'openid ' + 'a'.repeat(1024)])('rejects invalid OIDC scopes %s', (scope) => {
  expect(ConfigSchema.safeParse({ ...base, OIDC_SCOPES: scope }).success).toBe(false);
});
