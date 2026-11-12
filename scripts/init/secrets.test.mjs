import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureStackSecrets, patchRealmSecrets, randomSecret, prepareProdEnv, signInModeOf } from './secrets.mjs';
import { ConfigSchema } from '../../packages/config/src/schema.ts';

// Deterministic generator: a counter so each call is distinct and assertions are exact.
function seqGen() {
  let n = 0;
  return () => `GEN${++n}`;
}

const EXAMPLE = [
  'INTERNAL_DATABASE_URL=postgres://openldr:openldr@postgres:5432/openldr',
  'TARGET_DATABASE_URL=postgres://openldr:openldr@postgres:5432/openldr_target',
  'POSTGRES_PASSWORD=openldr',
  'S3_ACCESS_KEY_ID=minioadmin',
  'S3_SECRET_ACCESS_KEY=minioadmin',
  'KEYCLOAK_ADMIN=admin',
  'KEYCLOAK_ADMIN_PASSWORD=admin',
  'KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret',
  '',
].join('\n');

describe('ensureStackSecrets', () => {
  it('replaces every committed weak default with a generated secret', () => {
    const { envText } = ensureStackSecrets(EXAMPLE, seqGen());
    expect(envText).not.toMatch(/POSTGRES_PASSWORD=openldr$/m);
    expect(envText).not.toMatch(/S3_ACCESS_KEY_ID=minioadmin$/m);
    expect(envText).not.toMatch(/S3_SECRET_ACCESS_KEY=minioadmin$/m);
    expect(envText).not.toMatch(/KEYCLOAK_ADMIN_PASSWORD=admin$/m);
    expect(envText).not.toMatch(/KEYCLOAK_ADMIN_CLIENT_SECRET=openldr-admin-dev-secret$/m);
    // KEYCLOAK_ADMIN is a username, not a secret — left untouched.
    expect(envText).toMatch(/^KEYCLOAK_ADMIN=admin$/m);
  });

  it('rewrites both postgres URLs to the regenerated password', () => {
    const { envText } = ensureStackSecrets(EXAMPLE, seqGen());
    const pg = /^POSTGRES_PASSWORD=(.+)$/m.exec(envText)[1];
    expect(envText).toContain(`INTERNAL_DATABASE_URL=postgres://openldr:${pg}@postgres:5432/openldr`);
    expect(envText).toContain(`TARGET_DATABASE_URL=postgres://openldr:${pg}@postgres:5432/openldr_target`);
    // No lingering plaintext default password in the URLs.
    expect(envText).not.toContain('openldr:openldr@');
  });

  it('mints and persists an initial lab-admin password, returned for realm patching', () => {
    const { envText, labAdminPassword } = ensureStackSecrets(EXAMPLE, seqGen());
    expect(labAdminPassword).toBeTruthy();
    expect(envText).toContain(`INITIAL_LAB_ADMIN_PASSWORD=${labAdminPassword}`);
  });

  it('is idempotent — a second pass keeps already-generated secrets (never rotates a live secret)', () => {
    const first = ensureStackSecrets(EXAMPLE, seqGen());
    // A fresh generator on the second pass would produce different values IF anything were regenerated.
    const second = ensureStackSecrets(first.envText, () => 'SHOULD_NOT_APPEAR');
    expect(second.envText).toBe(first.envText);
    expect(second.envText).not.toContain('SHOULD_NOT_APPEAR');
    expect(second.labAdminPassword).toBe(first.labAdminPassword);
  });

  it('returns the kc client secret it wrote', () => {
    const { envText, kcClientSecret } = ensureStackSecrets(EXAMPLE, seqGen());
    expect(kcClientSecret).toBeTruthy();
    expect(envText).toContain(`KEYCLOAK_ADMIN_CLIENT_SECRET=${kcClientSecret}`);
  });

  it('refuses an install that predates Garage, with a pointer to the upgrading guide', () => {
    const oldKey = ['S3_ACCESS_KEY_ID=AKIAOLDMINIOKEY', 'S3_SECRET_ACCESS_KEY=oldminiosecret'].join('\n');
    expect(() => ensureStackSecrets(oldKey, seqGen())).toThrow(/predates 0\.1\.10/);
    expect(() => ensureStackSecrets(oldKey, seqGen())).toThrow(/Moving from MinIO to Garage/);
    const oldEndpoint = ['S3_ENDPOINT=http://minio:9000', 'S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621'].join('\n');
    expect(() => ensureStackSecrets(oldEndpoint, seqGen())).toThrow(/Moving from MinIO to Garage/);
  });

  it('accepts a Garage-format key and a storage endpoint', () => {
    const ok = ['S3_ENDPOINT=http://storage:3900', 'S3_ACCESS_KEY_ID=GK0123456789abcdef01234567'].join('\n');
    expect(() => ensureStackSecrets(ok, seqGen())).not.toThrow();
  });

  it('replaces the dev storage values with keys in the format Garage requires', () => {
    const env = [
      'S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621',
      'S3_SECRET_ACCESS_KEY=6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031',
      'GARAGE_RPC_SECRET=6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031',
      'GARAGE_ADMIN_TOKEN=6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031',
    ].join('\n');
    const { envText } = ensureStackSecrets(env);
    expect(envText).toMatch(/^S3_ACCESS_KEY_ID=GK[0-9a-f]{24}$/m);
    expect(envText).not.toMatch(/^S3_ACCESS_KEY_ID=GK6f70656e6c64722d64657621$/m);
    expect(envText).toMatch(/^S3_SECRET_ACCESS_KEY=[0-9a-f]{64}$/m);
    expect(envText).toMatch(/^GARAGE_RPC_SECRET=[0-9a-f]{64}$/m);
    expect(envText).toMatch(/^GARAGE_ADMIN_TOKEN=[0-9a-f]{64}$/m);
    expect(envText).not.toMatch(/6465762d6f6e6c79/);
  });
});

describe('patchRealmSecrets', () => {
  const realm = JSON.stringify({
    clients: [{ clientId: 'openldr-admin', secret: 'openldr-admin-dev-secret' }],
    users: [{ username: 'labadmin', credentials: [{ type: 'password', value: 'labadmin', temporary: true }] }],
  }, null, 0).replace('"value":"labadmin"', '"value": "labadmin"');

  it('substitutes the admin client secret and the labadmin credential, not the username', () => {
    const out = patchRealmSecrets(realm, { kcClientSecret: 'KC_SECRET', labAdminPassword: 'LAB_PW' });
    expect(out).not.toContain('openldr-admin-dev-secret');
    expect(out).toContain('KC_SECRET');
    expect(out).toContain('"value": "LAB_PW"');
    // The username labadmin is preserved (only the credential value changed).
    expect(out).toContain('"username":"labadmin"');
  });
});

describe('randomSecret', () => {
  it('produces a url-safe alnum string of the requested length', () => {
    const s = randomSecret(40);
    expect(s).toHaveLength(40);
    expect(s).toMatch(/^[A-Za-z0-9]+$/);
  });
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROD_EXAMPLE = readFileSync(join(REPO, '.env.prod.example'), 'utf8');
const ANSWERS = { host: 'lab.example.org', tlsMode: 'self-signed', httpPort: 80, httpsPort: 443 };
const KEYCLOAK_ONLY = /^(OIDC_|KC_|KEYCLOAK_|INITIAL_LAB_ADMIN_PASSWORD=|COMPOSE_PROFILES=|IDENTITY_ADMIN_ADAPTER=)/m;

const tempDirs = [];
afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** KEY=VALUE lines only, as Docker Compose's env_file hands them to the api container. */
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The server's own config check, the one that refuses to start. */
function serverAccepts(env) {
  const parsed = ConfigSchema.safeParse(env);
  return parsed.success ? { ok: true, cfg: parsed.data } : { ok: false, issues: parsed.error.issues };
}

describe('pnpm run init: sign-in mode', () => {
  it('a local install writes AUTH_ADAPTER=local and no Keycloak admin secret', () => {
    const r = prepareProdEnv(PROD_EXAMPLE, { ...ANSWERS, auth: 'local' }, seqGen());
    expect(r.envText).toMatch(/^AUTH_ADAPTER=local$/m);
    expect(r.envText).not.toMatch(KEYCLOAK_ONLY);
    expect(r.envText).toMatch(/^SECRETS_ENCRYPTION_KEY=.+$/m);
    expect(r.kcClientSecret).toBeUndefined();
    expect(r.labAdminPassword).toBeUndefined();
  });

  it('a local install passes the server config check', () => {
    const r = prepareProdEnv(PROD_EXAMPLE, { ...ANSWERS, auth: 'local' }, seqGen());
    const res = serverAccepts(parseEnv(r.envText));
    expect(res.issues).toBeUndefined();
    expect(res.cfg.AUTH_ADAPTER).toBe('local');
  });

  // Proves the check above can fail: the two mistakes a local .env is most likely to carry.
  it('the server config check refuses a local env with a blank issuer or no encryption key', () => {
    const env = parseEnv(prepareProdEnv(PROD_EXAMPLE, { ...ANSWERS, auth: 'local' }, seqGen()).envText);
    expect(serverAccepts({ ...env, OIDC_ISSUER_URL: '' }).ok).toBe(false);
    const { SECRETS_ENCRYPTION_KEY: _key, ...noKey } = env;
    expect(serverAccepts(noKey).ok).toBe(false);
  });

  it('a keycloak install writes the same values as before this change', () => {
    const r = prepareProdEnv(PROD_EXAMPLE, { ...ANSWERS, auth: 'keycloak' }, seqGen());
    const env = parseEnv(r.envText);
    // The values the wizard wrote before local sign-in existed.
    expect(env.OIDC_ISSUER_URL).toBe('https://lab.example.org/auth/realms/openldr');
    expect(env.OIDC_INTERNAL_JWKS_URL).toBe('http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs');
    expect(env.OIDC_INTERNAL_ISSUER_URL).toBe('http://keycloak:8080/auth/realms/openldr');
    expect(env.OIDC_WEB_CLIENT_ID).toBe('openldr-web');
    expect(env.KC_HOSTNAME).toBe('https://lab.example.org/auth');
    expect(env.KEYCLOAK_ADMIN).toBe('admin');
    expect(env.KEYCLOAK_ADMIN_CLIENT_ID).toBe('openldr-admin');
    expect(env.KEYCLOAK_ADMIN_PASSWORD).toMatch(/^GEN\d+$/);
    expect(env.KEYCLOAK_ADMIN_CLIENT_SECRET).toBe(r.kcClientSecret);
    expect(env.INITIAL_LAB_ADMIN_PASSWORD).toBe(r.labAdminPassword);
    expect(r.kcClientSecret).toMatch(/^GEN\d+$/);
    expect(r.labAdminPassword).toMatch(/^GEN\d+$/);
    // New: the mode is written down, and compose starts the keycloak service.
    expect(env.AUTH_ADAPTER).toBe('keycloak');
    expect(env.COMPOSE_PROFILES).toBe('keycloak');
    const res = serverAccepts(env);
    expect(res.issues).toBeUndefined();
    expect(res.cfg.AUTH_ADAPTER).toBe('keycloak');
  });

  it('reads an .env.prod with no AUTH_ADAPTER as Keycloak, the server default', () => {
    expect(signInModeOf(EXAMPLE)).toBe('keycloak');
    expect(signInModeOf('AUTH_ADAPTER=local\n')).toBe('local');
    expect(signInModeOf('AUTH_ADAPTER=oidc\n')).toBe('oidc');
  });

  it('a re-run on an .env.prod from before this change keeps Keycloak and adds its profile', () => {
    const first = prepareProdEnv(EXAMPLE, { ...ANSWERS, auth: signInModeOf(EXAMPLE) }, seqGen());
    expect(first.envText).toMatch(/^COMPOSE_PROFILES=keycloak$/m);
    // An operator's own profile list keeps its entries.
    const own = prepareProdEnv('COMPOSE_PROFILES=letsencrypt\n', { ...ANSWERS, auth: 'keycloak' }, seqGen());
    expect(own.envText).toMatch(/^COMPOSE_PROFILES=letsencrypt,keycloak$/m);
    // A second pass changes nothing.
    const second = prepareProdEnv(first.envText, { ...ANSWERS, auth: 'keycloak' }, () => 'SHOULD_NOT_APPEAR');
    expect(second.envText).toBe(first.envText);
  });
});

/**
 * Run install/install.sh with --no-start and fake `docker`, `curl` and `openssl`, so nothing is
 * downloaded and no container starts. Same approach as packages/release/src/shell.test.ts.
 */
function installEnv(args) {
  const bin = mkdtempSync(join(tmpdir(), 'openldr-fakebin-'));
  const dir = join(mkdtempSync(join(tmpdir(), 'openldr-install-')), 'openldr');
  tempDirs.push(bin, dirname(dir));
  writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(join(bin, 'curl'), [
    '#!/usr/bin/env bash',
    'out=""; prev=""',
    'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done',
    'if [ -n "$out" ]; then mkdir -p "$(dirname "$out")"; : > "$out"; fi',
    'exit 0',
    '',
  ].join('\n'));
  writeFileSync(join(bin, 'openssl'), '#!/usr/bin/env bash\nexit 1\n');
  for (const f of ['docker', 'curl', 'openssl']) chmodSync(join(bin, f), 0o755);
  execFileSync('bash', [join(REPO, 'install/install.sh'), '--dir', dir, '--http-port', '18080', '--https-port', '18443', '--no-start', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, DOCKER_HOST: 'tcp://127.0.0.1:1', OPENLDR_REPO_RAW: `file://${REPO}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { env: readFileSync(join(dir, '.env'), 'utf8'), dir };
}

describe('install.sh: the .env it writes', () => {
  it('defaults to local sign-in, and the server config check accepts it', () => {
    const { env, dir } = installEnv([]);
    expect(env).toMatch(/^AUTH_ADAPTER=local$/m);
    expect(env).not.toMatch(KEYCLOAK_ONLY);
    expect(existsSync(join(dir, 'config/keycloak/openldr-realm.json'))).toBe(false);
    const res = serverAccepts(parseEnv(env));
    expect(res.issues).toBeUndefined();
    expect(res.cfg.AUTH_ADAPTER).toBe('local');
  }, 60_000);

  it('with --auth keycloak, the server config check accepts it', () => {
    const { env } = installEnv(['--auth', 'keycloak']);
    expect(env).toMatch(/^AUTH_ADAPTER=keycloak$/m);
    expect(env).toMatch(/^COMPOSE_PROFILES=keycloak$/m);
    const res = serverAccepts(parseEnv(env));
    expect(res.issues).toBeUndefined();
    expect(res.cfg.AUTH_ADAPTER).toBe('keycloak');
  }, 60_000);
});
