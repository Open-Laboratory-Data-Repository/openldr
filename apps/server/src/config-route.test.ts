import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerConfigRoute } from './app';

describe('GET /api/config', () => {
  it('reports dashboardSqlEnabled from the feature flag (pg target)', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => true },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(true);
    expect(res.json().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('is false when the flag is off even with a pg target', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => false },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(false);
  });

  it('is enabled for an mssql target when the flag is on (pg-only gate lifted)', async () => {
    const app = Fastify();
    registerConfigRoute(app, {
      cfg: { TARGET_STORE_ADAPTER: 'mssql', AUTH_DEV_BYPASS: true, OIDC_ISSUER_URL: '', OIDC_WEB_CLIENT_ID: '' },
      featureFlags: { get: async () => true },
    } as any);
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json().dashboardSqlEnabled).toBe(true);
  });
});

it.each([
  ['keycloak', undefined, 'secret', true],
  ['keycloak', 'none', 'secret', false],
  ['keycloak', undefined, undefined, false],
  ['oidc', undefined, 'secret', false],
])('publishes auth mode %s and administration %s without credentials', async (mode, admin, secret, available) => {
  const app = Fastify();
  registerConfigRoute(app, { cfg: { AUTH_ADAPTER: mode, IDENTITY_ADMIN_ADAPTER: admin, KEYCLOAK_ADMIN_CLIENT_ID: 'admin', KEYCLOAK_ADMIN_CLIENT_SECRET: secret, TARGET_STORE_ADAPTER: 'pg', AUTH_DEV_BYPASS: false, OIDC_ISSUER_URL: 'https://id.example', OIDC_WEB_CLIENT_ID: 'web' }, featureFlags: { get: async () => false } } as any);
  const response = await app.inject({ method: 'GET', url: '/api/config' });
  expect(response.json().oidc.mode).toBe(mode);
  expect(response.json().authCapabilities).toEqual({ identityAdmin: available, syncClientAdmin: available });
  expect(response.body).not.toContain('secret');
  expect(response.body).not.toContain('KEYCLOAK');
  await app.close();
});

it('publishes configured resource and scopes for browser JWT access token requests', async () => {
  const app = Fastify();
  registerConfigRoute(app, { cfg: { AUTH_ADAPTER: 'oidc', OIDC_SCOPES: 'openid api', OIDC_RESOURCE: 'https://api.example', AUTH_DEV_BYPASS: false, OIDC_ISSUER_URL: 'https://id.example', OIDC_WEB_CLIENT_ID: 'web' }, featureFlags: { get: async () => false } } as any);
  const response = await app.inject({ method: 'GET', url: '/api/config' });
  expect(response.json().oidc).toMatchObject({ resource: 'https://api.example', scopes: 'openid api' });
  await app.close();
});
