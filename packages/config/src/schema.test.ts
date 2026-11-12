import { describe, it, expect } from 'vitest';
import { ConfigSchema, DEV_SECRETS_ENCRYPTION_KEY } from './schema';

const base = {
  INTERNAL_DATABASE_URL: 'postgres://u:p@localhost/db', TARGET_DATABASE_URL: 'postgres://u:p@localhost/ext',
  S3_ENDPOINT: 'http://localhost:9010', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_BUCKET: 'b',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/master',
};
describe('workflow code sandbox config', () => {
  it('defaults the workflow code sandbox limits', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.WORKFLOW_CODE_TIMEOUT_MS).toBe(5000);
    expect(cfg.WORKFLOW_CODE_MEMORY_MB).toBe(128);
    // SEC-01: Code nodes are fail-safe OFF unless explicitly enabled.
    expect(cfg.WORKFLOW_CODE_ENABLED).toBe(false);
  });
  it('defaults WORKFLOW_HTTP_ALLOWLIST to empty', () => {
    expect(ConfigSchema.parse(base).WORKFLOW_HTTP_ALLOWLIST).toBe('');
  });
  it('defaults WORKFLOW_LOOP_MAX_ITEMS to 100000', () => {
    expect(ConfigSchema.parse(base).WORKFLOW_LOOP_MAX_ITEMS).toBe(100000);
  });
  it('coerces WORKFLOW_LOOP_MAX_ITEMS string override', () => {
    expect(ConfigSchema.parse({ ...base, WORKFLOW_LOOP_MAX_ITEMS: '250' }).WORKFLOW_LOOP_MAX_ITEMS).toBe(250);
  });
  it('defaults listener knobs', () => {
    const c = ConfigSchema.parse(base);
    expect(c.WORKFLOW_EMAIL_POLL_MIN_SECONDS).toBe(30);
    expect(c.WORKFLOW_EMAIL_MAX_PER_POLL).toBe(50);
  });
  it('coerces listener knob overrides', () => {
    const c = ConfigSchema.parse({ ...base, WORKFLOW_EMAIL_POLL_MIN_SECONDS: '15', WORKFLOW_EMAIL_MAX_PER_POLL: '10' });
    expect(c.WORKFLOW_EMAIL_POLL_MIN_SECONDS).toBe(15);
    expect(c.WORKFLOW_EMAIL_MAX_PER_POLL).toBe(10);
  });
  it('defaults host file access knobs', () => {
    const c = ConfigSchema.parse(base);
    expect(c.WORKFLOW_FILE_ACCESS_ENABLED).toBe(false);
    expect(c.WORKFLOW_FILE_ACCESS_ROOT).toBe('');
  });
  it('accepts host file access overrides', () => {
    const c = ConfigSchema.parse({ ...base, WORKFLOW_FILE_ACCESS_ENABLED: 'true', WORKFLOW_FILE_ACCESS_ROOT: '/data/wf' });
    expect(c.WORKFLOW_FILE_ACCESS_ENABLED).toBe(true);
    expect(c.WORKFLOW_FILE_ACCESS_ROOT).toBe('/data/wf');
  });
});

describe('startup migration config', () => {
  it('defaults MIGRATE_ON_START to false', () => {
    expect(ConfigSchema.parse(base).MIGRATE_ON_START).toBe(false);
  });
  it('parses MIGRATE_ON_START=true', () => {
    expect(ConfigSchema.parse({ ...base, MIGRATE_ON_START: 'true' }).MIGRATE_ON_START).toBe(true);
  });
  it('defaults SEED_ON_START to false', () => {
    expect(ConfigSchema.parse(base).SEED_ON_START).toBe(false);
  });
  it('parses SEED_ON_START=true', () => {
    expect(ConfigSchema.parse({ ...base, SEED_ON_START: 'true' }).SEED_ON_START).toBe(true);
  });
});

describe('auth config', () => {
  // AUTH_DEV_BYPASS disables API authentication, so it is fail-safe OFF unless explicitly
  // enabled — NODE_ENV must never be able to turn it on by omission.
  it('defaults AUTH_DEV_BYPASS off in development', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'development' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(false);
  });
  it('defaults AUTH_DEV_BYPASS off when NODE_ENV is unset', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.AUTH_DEV_BYPASS).toBe(false);
  });
  it('defaults AUTH_DEV_BYPASS off in production', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'production' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(false);
  });
  it('honours an explicit AUTH_DEV_BYPASS=true in development', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'development', AUTH_DEV_BYPASS: 'true' });
    expect(cfg.AUTH_DEV_BYPASS).toBe(true);
  });
  it('rejects AUTH_DEV_BYPASS=true under production', () => {
    expect(() => ConfigSchema.parse({ ...base, NODE_ENV: 'production', AUTH_DEV_BYPASS: 'true' })).toThrow(/AUTH_DEV_BYPASS/);
  });
  it('exposes dev actor defaults', () => {
    const cfg = ConfigSchema.parse({ ...base, NODE_ENV: 'development' });
    expect(cfg.AUTH_DEV_USERNAME).toBe('dev-admin');
    expect(cfg.AUTH_DEV_ROLES).toBe('lab_admin');
  });
  it('accepts optional Keycloak admin client credentials', () => {
    const cfg = ConfigSchema.parse({ ...base, KEYCLOAK_ADMIN_CLIENT_ID: 'svc', KEYCLOAK_ADMIN_CLIENT_SECRET: 'sek' });
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_ID).toBe('svc');
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_SECRET).toBe('sek');
  });
  it('leaves admin creds undefined when omitted', () => {
    const cfg = ConfigSchema.parse({ ...base });
    expect(cfg.KEYCLOAK_ADMIN_CLIENT_ID).toBeUndefined();
  });
  it('accepts OIDC_INTERNAL_ISSUER_URL and defaults it to undefined', () => {
    const withVal = ConfigSchema.parse({ ...base, OIDC_INTERNAL_ISSUER_URL: 'http://keycloak:8080/auth/realms/openldr' });
    expect(withVal.OIDC_INTERNAL_ISSUER_URL).toBe('http://keycloak:8080/auth/realms/openldr');
    const without = ConfigSchema.parse({ ...base });
    expect(without.OIDC_INTERNAL_ISSUER_URL).toBeUndefined();
  });
  it('accepts TLS_CERT_PATH and defaults it to undefined', () => {
    const withVal = ConfigSchema.parse({ ...base, TLS_CERT_PATH: '/etc/openldr/tls-cert.pem' });
    expect(withVal.TLS_CERT_PATH).toBe('/etc/openldr/tls-cert.pem');
    expect(ConfigSchema.parse({ ...base }).TLS_CERT_PATH).toBeUndefined();
  });
});

describe('local sign-in config', () => {
  // 32 bytes, base64. Only presence is checked at boot.
  const VALID_KEY = Buffer.alloc(32, 7).toString('base64');
  const parse = (env: Record<string, unknown>) => ConfigSchema.parse(env);

  it('accepts local sign-in with no OIDC issuer', () => {
    const { OIDC_ISSUER_URL: _drop, ...rest } = base;
    const cfg = parse({ ...rest, AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: VALID_KEY });
    expect(cfg.AUTH_ADAPTER).toBe('local');
  });
  it('refuses local sign-in with no secrets key', () => {
    expect(() => parse({ ...base, AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: undefined })).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });
  it('still requires an issuer for keycloak and oidc', () => {
    const { OIDC_ISSUER_URL: _drop, ...rest } = base;
    expect(() => parse({ ...rest, AUTH_ADAPTER: 'keycloak' })).toThrow(/OIDC_ISSUER_URL/);
    expect(() => parse({ ...rest, AUTH_ADAPTER: 'oidc' })).toThrow(/OIDC_ISSUER_URL/);
  });
  it('refuses mixed admin adapters', () => {
    expect(() => parse({ ...base, AUTH_ADAPTER: 'local', IDENTITY_ADMIN_ADAPTER: 'keycloak', SECRETS_ENCRYPTION_KEY: VALID_KEY })).toThrow();
    expect(() => parse({ ...base, AUTH_ADAPTER: 'keycloak', IDENTITY_ADMIN_ADAPTER: 'local' })).toThrow();
  });
  it('refuses IDENTITY_ADMIN_ADAPTER=none under local sign-in', () => {
    expect(() => parse({ ...base, AUTH_ADAPTER: 'local', IDENTITY_ADMIN_ADAPTER: 'none', SECRETS_ENCRYPTION_KEY: VALID_KEY }))
      .toThrow('local sign-in manages its own users; leave IDENTITY_ADMIN_ADAPTER unset');
    expect(parse({ ...base, AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: VALID_KEY }).IDENTITY_ADMIN_ADAPTER).toBeUndefined();
    expect(parse({ ...base, AUTH_ADAPTER: 'local', IDENTITY_ADMIN_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: VALID_KEY }).IDENTITY_ADMIN_ADAPTER).toBe('local');
    expect(parse({ ...base, AUTH_ADAPTER: 'oidc', IDENTITY_ADMIN_ADAPTER: 'none' }).IDENTITY_ADMIN_ADAPTER).toBe('none');
  });
  it('keeps keycloak as the default', () => {
    expect(parse(base).AUTH_ADAPTER).toBe('keycloak');
  });
});

describe('the public development secrets key', () => {
  const MESSAGE = 'SECRETS_ENCRYPTION_KEY is the public development key from .env.example. Generate a new one for a real install.';

  it('is refused in production, whatever the sign-in mode', () => {
    for (const AUTH_ADAPTER of ['local', 'keycloak', 'oidc']) {
      expect(() => ConfigSchema.parse({ ...base, NODE_ENV: 'production', AUTH_ADAPTER, SECRETS_ENCRYPTION_KEY: DEV_SECRETS_ENCRYPTION_KEY }))
        .toThrow(MESSAGE);
    }
  });
  it('is accepted in development and test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(ConfigSchema.parse({ ...base, NODE_ENV, AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: DEV_SECRETS_ENCRYPTION_KEY }).SECRETS_ENCRYPTION_KEY)
        .toBe(DEV_SECRETS_ENCRYPTION_KEY);
    }
  });
  it('leaves another key alone in production', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    expect(ConfigSchema.parse({ ...base, NODE_ENV: 'production', AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: key }).SECRETS_ENCRYPTION_KEY).toBe(key);
  });
});
