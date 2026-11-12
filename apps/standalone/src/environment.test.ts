import { randomBytes } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, DEV_SECRETS_ENCRYPTION_KEY, loadConfig } from '@openldr/config';
import { buildEnvironment, type EnvironmentInput } from './environment.js';
import { postgresUrls } from './postgres.js';
import { pathsFor, type StandaloneState } from './state.js';

// Nothing here touches the disk. The data folder only has to be an absolute path.
const ROOT = join('/', 'srv', 'openldr-environment-test');
const STUDIO_DIST = join('/', 'opt', 'openldr', 'studio', 'dist');

const state: StandaloneState = {
  version: 1,
  secretsKey: randomBytes(32).toString('base64'),
  pgPort: 54329,
  pgSuperPassword: 'super-password-for-the-test',
  pgAppPassword: 'app-password-for-the-test',
};
const urls = postgresUrls({ port: state.pgPort, superPassword: state.pgSuperPassword, appPassword: state.pgAppPassword });

function makeInput(over: Partial<EnvironmentInput> = {}): EnvironmentInput {
  return {
    paths: pathsFor(ROOT),
    state,
    internalUrl: urls.internalUrl,
    targetUrl: urls.targetUrl,
    port: 3000,
    host: '127.0.0.1',
    studioDist: STUDIO_DIST,
    appVersion: '0.1.11',
    ...over,
  };
}
const input = makeInput();

/** The exact keys a standalone server runs with. A key added or dropped by accident fails. */
const EXPECTED_KEYS = [
  'NODE_ENV', 'TZ', 'PORT', 'LISTEN_HOST', 'ROOT_REDIRECT_TO_STUDIO', 'LOG_LEVEL', 'LOG_FILE',
  'AUTH_ADAPTER', 'AUTH_DEV_BYPASS', 'BLOB_ADAPTER', 'BLOB_DIR', 'EVENTING_ADAPTER',
  'TARGET_STORE_ADAPTER', 'INTERNAL_DATABASE_URL', 'TARGET_DATABASE_URL', 'MIGRATE_ON_START',
  'SEED_ON_START', 'SECRETS_ENCRYPTION_KEY', 'PLUGIN_CRASH_LOG_DIR', 'TERMINOLOGY_WORK_DIR',
  'WEB_DIST_DIR', 'APP_VERSION', 'OPENLDR_SKIP_ENV_FILE',
];

/** A setting whose name says it holds a path. */
const PATH_NAME = /(_DIR|_FILE|_PATH|_ROOT)$/;
/** A value that reads as a file path: not a URL, and absolute, dotted or with a separator. */
function looksLikePath(value: string): boolean {
  if (value === '' || value.includes('://')) return false;
  return isAbsolute(value) || value.startsWith('.') || value.includes('/') || value.includes('\\');
}
/** A switch value. OPENLDR_SKIP_ENV_FILE ends in _FILE and holds one of these. */
const SWITCH = /^(true|false|1|0)$/;
/** A setting whose name says it holds a secret. A base64 key can contain or start with a slash. */
const SECRET_NAME = /(_KEY|_SECRET|_PASSWORD|_TOKEN)$/;
function isPathEntry(key: string, value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || SWITCH.test(value) || SECRET_NAME.test(key)) return false;
  return PATH_NAME.test(key) || looksLikePath(value);
}
function isInside(root: string, path: string): boolean {
  if (!isAbsolute(path)) return false;
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Schema settings named as paths that buildEnvironment leaves unset on purpose. Each is unset by
 * default and nothing writes to a fallback place when it is unset. A new path setting in the schema
 * fails the test below until it is set or added here with a reason.
 */
const PATH_SETTINGS_LEFT_UNSET: Record<string, string> = {
  TLS_CERT_PATH: 'a certificate the operator mounts; only read, and the route answers 404 without it',
  MARKETPLACE_REGISTRY_DIR: 'an operator-chosen registry folder; marketplace publish is off without it',
  WORKFLOW_FILE_ACCESS_ROOT: 'the file node sandbox; the node is off unless WORKFLOW_FILE_ACCESS_ENABLED is on',
  MARKETPLACE_LOCAL_REGISTRY_ROOT: 'a limit on local registries; empty keeps today\'s behaviour',
};

describe('buildEnvironment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('produces an environment the real config schema accepts', () => {
    const env = buildEnvironment(input);
    const cfg = loadConfig(env); // a plain object, so no .env file is read
    expect(cfg.AUTH_ADAPTER).toBe('local');
    expect(cfg.BLOB_ADAPTER).toBe('fs');
    expect(cfg.LISTEN_HOST).toBe('127.0.0.1');
    expect(cfg.SEED_ON_START).toBe(false);
    expect(cfg.MIGRATE_ON_START).toBe(true);
    expect(cfg.ROOT_REDIRECT_TO_STUDIO).toBe(true);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.INTERNAL_DATABASE_URL).toBe(urls.internalUrl);
    expect(cfg.TARGET_DATABASE_URL).toBe(urls.targetUrl);
    expect(cfg.TARGET_STORE_ADAPTER).toBe('pg');
    expect(cfg.EVENTING_ADAPTER).toBe('pg');
    expect(cfg.AUTH_DEV_BYPASS).toBe(false);
  });

  it('returns exactly the expected keys', () => {
    expect(Object.keys(buildEnvironment(input)).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('sets nothing for Keycloak, OIDC or S3', () => {
    expect(Object.keys(buildEnvironment(input)).filter((k) => /^(OIDC_|KEYCLOAK_|S3_|IDENTITY_ADMIN)/.test(k))).toEqual([]);
  });

  it('carries the key from the state file, not the public development key', () => {
    const env = buildEnvironment(input);
    expect(env.SECRETS_ENCRYPTION_KEY).toBe(input.state.secretsKey);
    expect(env.SECRETS_ENCRYPTION_KEY).not.toBe(DEV_SECRETS_ENCRYPTION_KEY);
  });

  it('tells loadConfig to read no .env file', () => {
    expect(buildEnvironment(input).OPENLDR_SKIP_ENV_FILE).toBe('true');
  });

  it('puts every path inside the data folder, apart from the studio build', () => {
    const env = buildEnvironment(input);
    const cfg = loadConfig(env) as Record<string, unknown>;
    const checked = new Set<string>();
    // The keys it sets, and every setting the schema fills in, defaults included.
    for (const [key, value] of [...Object.entries(env), ...Object.entries(cfg)]) {
      if (key === 'WEB_DIST_DIR' || !isPathEntry(key, value)) continue;
      checked.add(key);
      expect(isInside(ROOT, value), `${key} is outside the data folder`).toBe(true);
    }
    // The rule must have found the paths, or the loop above proved nothing.
    for (const key of ['LOG_FILE', 'BLOB_DIR', 'PLUGIN_CRASH_LOG_DIR', 'TERMINOLOGY_WORK_DIR']) {
      expect(checked.has(key), `${key} was not checked`).toBe(true);
    }
    expect(env.WEB_DIST_DIR).toBe(STUDIO_DIST);
  });

  it('gives terminology work files their own folder, not the data folder root', () => {
    const env = buildEnvironment(input);
    expect(env.TERMINOLOGY_WORK_DIR).toBe(input.paths.work);
    expect(env.TERMINOLOGY_WORK_DIR).not.toBe(ROOT);
  });

  it('sets or deliberately leaves every schema setting named as a path', () => {
    const env = buildEnvironment(input);
    const schemaKeys = Object.keys(ConfigSchema._def.schema._def.schema.shape);
    const pathKeys = schemaKeys.filter((k) => PATH_NAME.test(k));
    expect(pathKeys.length).toBeGreaterThan(0);
    for (const key of pathKeys) {
      const handled = key in env || key in PATH_SETTINGS_LEFT_UNSET;
      expect(handled, `${key} is neither set nor listed as left unset`).toBe(true);
    }
    for (const key of Object.keys(PATH_SETTINGS_LEFT_UNSET)) {
      expect(schemaKeys).toContain(key);
      expect(env).not.toHaveProperty(key);
    }
  });

  it('is accepted under NODE_ENV=production', () => {
    // The schema refuses the dev key and the bypass there. The second half shows those checks ran.
    const env = buildEnvironment(input);
    expect(env.NODE_ENV).toBe('production');
    expect(loadConfig(env).NODE_ENV).toBe('production');
    const withDevKey = buildEnvironment(makeInput({ state: { ...state, secretsKey: DEV_SECRETS_ENCRYPTION_KEY } }));
    expect(() => loadConfig(withDevKey)).toThrow(/SECRETS_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...env, AUTH_DEV_BYPASS: 'true' })).toThrow(/AUTH_DEV_BYPASS/);
  });

  it('reads nothing from process.env', () => {
    const before = buildEnvironment(input);
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('S3_ENDPOINT', 'http://127.0.0.1:3900');
    vi.stubEnv('OIDC_ISSUER_URL', 'http://127.0.0.1:8180/realms/openldr');
    vi.stubEnv('OPENLDR_ENVIRONMENT_TEST_EXTRA', 'x');
    expect(buildEnvironment(input)).toEqual(before);
  });

  it('carries the port, host, version and studio build as given', () => {
    const env = buildEnvironment(makeInput({ port: 3994, host: '0.0.0.0', appVersion: '9.9.9' }));
    expect(env.PORT).toBe('3994');
    expect(env.LISTEN_HOST).toBe('0.0.0.0');
    expect(env.APP_VERSION).toBe('9.9.9');
    expect(env.WEB_DIST_DIR).toBe(STUDIO_DIST);
  });

  describe('refuses unusable input, naming the field and not its value', () => {
    const cases: Array<[string, Partial<EnvironmentInput>, string]> = [
      ['an empty key', { state: { ...state, secretsKey: '' } }, 'state.secretsKey'],
      ['a key of the wrong length', { state: { ...state, secretsKey: 'c2hvcnQta2V5LXZhbHVl' } }, 'state.secretsKey'],
      ['port 0', { port: 0 }, 'port'],
      ['port 65536', { port: 65536 }, 'port'],
      ['a port that is not a whole number', { port: 3000.5 }, 'port'],
      ['an empty host', { host: '' }, 'host'],
      ['an empty internal URL', { internalUrl: '' }, 'internalUrl'],
      ['an empty target URL', { targetUrl: '' }, 'targetUrl'],
      ['an empty version', { appVersion: '' }, 'appVersion'],
      ['an empty studio build path', { studioDist: '' }, 'studioDist'],
      ['a relative studio build path', { studioDist: 'studio/dist' }, 'studioDist'],
      ['a relative data folder', { paths: pathsFor('openldr-data') }, 'paths.root'],
    ];
    it.each(cases)('%s', (_name, over, field) => {
      const err = (() => {
        try {
          buildEnvironment(makeInput(over));
        } catch (e) {
          return e as Error;
        }
        return null;
      })();
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain(field);
      // No input value may appear in the message. The empty string is in every message, so skip it.
      for (const value of [...Object.values(over), ...Object.values(over.state ?? {})]) {
        if (typeof value === 'string' && value !== '') expect(err!.message).not.toContain(value);
      }
    });

    it('never puts a database password in a message', () => {
      const err = (() => {
        try {
          buildEnvironment(makeInput({ port: -1 }));
        } catch (e) {
          return e as Error;
        }
        return null;
      })();
      expect(err).toBeInstanceOf(Error);
      for (const secret of [state.secretsKey, state.pgAppPassword, state.pgSuperPassword, urls.internalUrl]) {
        expect(err!.message).not.toContain(secret);
      }
    });
  });
});
