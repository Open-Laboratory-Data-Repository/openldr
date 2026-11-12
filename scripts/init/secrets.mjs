import { randomBytes } from 'node:crypto';
import { computeEnv } from './config-compute.mjs';
import { mergeEnv } from './env-merge.mjs';

/** URL-safe random secret (base64 stripped to alnum), default 32 chars. Alnum-only so it is safe to
 *  embed unencoded in a postgres:// URL password segment. */
export function randomSecret(len = 32) {
  let out = '';
  while (out.length < len) out += randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  return out.slice(0, len);
}

function getEnv(text, key) {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  return m ? m[1] : undefined;
}

function setEnv(text, key, val) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${val}`);
  return `${text.replace(/\n*$/, '')}\n${key}=${val}\n`;
}

const hex = (bytes) => randomBytes(bytes).toString('hex');

// Garage refuses any other format: key ID is GK + 24 hex, secrets are 64 hex.
const GENERATORS = {
  S3_ACCESS_KEY_ID: () => `GK${hex(12)}`,
  S3_SECRET_ACCESS_KEY: () => hex(32),
  GARAGE_RPC_SECRET: () => hex(32),
  GARAGE_ADMIN_TOKEN: () => hex(32),
};

// The committed dev/example values a real deployment must NOT keep. A key holding one of these (or
// empty) is upgraded to a generated secret on first init; a key already holding a non-default value is
// left untouched, so re-running init never rotates a live secret.
const WEAK_DEFAULTS = {
  POSTGRES_PASSWORD: ['', 'openldr'],
  S3_ACCESS_KEY_ID: ['', 'minioadmin', 'GK6f70656e6c64722d64657621'],
  S3_SECRET_ACCESS_KEY: ['', 'minioadmin', '6465762d6f6e6c792d6761726167652d7365637265742d6b65792d3030303031'],
  GARAGE_RPC_SECRET: ['', '6465762d6f6e6c792d6761726167652d7270632d7365637265742d3030303031'],
  GARAGE_ADMIN_TOKEN: ['', '6465762d6f6e6c792d6761726167652d61646d696e2d746f6b656e2d30303031'],
  KEYCLOAK_ADMIN_PASSWORD: ['', 'admin'],
  KEYCLOAK_ADMIN_CLIENT_SECRET: ['', 'openldr-admin-dev-secret'],
};

// Written only for a Keycloak install. Local sign-in has no Keycloak to give a password to.
const KEYCLOAK_SECRETS = ['KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_ADMIN_CLIENT_SECRET'];

const PRE_GARAGE_MESSAGE =
  'This install predates 0.1.11: its storage settings are still MinIO. ' +
  'Follow "Moving from MinIO to Garage" in the upgrading guide before you run init again. ' +
  'Nothing was changed.';

/** Throw when an existing .env.prod still describes MinIO. Garage rejects the old key format, and
 *  init would otherwise carry on and start a stack that cannot reach its files. A weak default key
 *  is fine: it is replaced with a Garage-format key below. */
function assertNotPreGarage(text) {
  const key = getEnv(text, 'S3_ACCESS_KEY_ID');
  const endpoint = getEnv(text, 'S3_ENDPOINT');
  const oldKey =
    key !== undefined && !WEAK_DEFAULTS.S3_ACCESS_KEY_ID.includes(key) && !/^GK[0-9a-f]{24}$/.test(key);
  const oldEndpoint = endpoint !== undefined && /^https?:\/\/minio:9000\/?$/i.test(endpoint.trim());
  if (oldKey || oldEndpoint) {
    const err = new Error(PRE_GARAGE_MESSAGE);
    err.code = 'PRE_GARAGE_INSTALL';
    throw err;
  }
}

/**
 * Replace the committed weak default credentials in a .env.prod text with generated secrets, keeping
 * the two postgres:// URLs in sync with the (possibly regenerated) POSTGRES_PASSWORD, and mint a
 * one-time initial human lab-admin password (persisted as INITIAL_LAB_ADMIN_PASSWORD so re-runs stay
 * consistent and it can be surfaced once). Idempotent: a key already holding a non-default value is
 * left alone, so this only hardens a fresh install and never rotates a live secret out from under a
 * running stack. `gen` is injectable for deterministic tests.
 *
 * Returns the updated env text plus the two values the realm import must be patched with:
 * `kcClientSecret` (openldr-admin service account) and `labAdminPassword` (the seeded labadmin user).
 */
export function ensureStackSecrets(envText, gen = randomSecret, { auth = signInModeOf(envText) } = {}) {
  assertNotPreGarage(envText);
  let text = envText;
  for (const [key, weak] of Object.entries(WEAK_DEFAULTS)) {
    if (auth === 'local' && KEYCLOAK_SECRETS.includes(key)) continue;
    const cur = getEnv(text, key);
    if (cur === undefined || weak.includes(cur)) text = setEnv(text, key, (GENERATORS[key] ?? gen)());
  }
  // Keep the DB URLs' embedded password aligned with POSTGRES_PASSWORD (the source of truth), so a
  // regenerated password does not silently break the app's connection string.
  const pg = getEnv(text, 'POSTGRES_PASSWORD');
  if (pg) {
    for (const key of ['INTERNAL_DATABASE_URL', 'TARGET_DATABASE_URL']) {
      const url = getEnv(text, key);
      if (url) text = setEnv(text, key, url.replace(/^(postgres(?:ql)?:\/\/[^:/@]+:)[^@]*(@)/, `$1${pg}$2`));
    }
  }
  // Local sign-in has no Keycloak realm to import, so no labadmin user and no client secret.
  // The first administrator comes from `openldr auth setup-code` instead.
  if (auth === 'local') return { envText: text, kcClientSecret: undefined, labAdminPassword: undefined };
  let labAdminPassword = getEnv(text, 'INITIAL_LAB_ADMIN_PASSWORD');
  if (!labAdminPassword) {
    labAdminPassword = gen();
    text = setEnv(text, 'INITIAL_LAB_ADMIN_PASSWORD', labAdminPassword);
  }
  return { envText: text, kcClientSecret: getEnv(text, 'KEYCLOAK_ADMIN_CLIENT_SECRET'), labAdminPassword };
}

/** The sign-in mode an .env.prod runs under. No AUTH_ADAPTER line means keycloak, the server's
 *  default, which is what every install made before local sign-in runs. */
export function signInModeOf(envText) {
  return getEnv(envText, 'AUTH_ADAPTER')?.trim() || 'keycloak';
}

// Keycloak values the wizard used to inherit from .env.prod.example. The example now leaves them
// commented, so a Keycloak install writes them, only where the key is missing.
const KEYCLOAK_DEFAULTS = {
  OIDC_INTERNAL_ISSUER_URL: 'http://keycloak:8080/auth/realms/openldr',
  KEYCLOAK_ADMIN: 'admin',
  KEYCLOAK_ADMIN_CLIENT_ID: 'openldr-admin',
};

/** Add `profile` to COMPOSE_PROFILES, keeping any profiles already listed. */
function addComposeProfile(text, profile) {
  const cur = getEnv(text, 'COMPOSE_PROFILES')?.trim();
  if (!cur) return setEnv(text, 'COMPOSE_PROFILES', profile);
  if (cur.split(',').map((p) => p.trim()).includes(profile)) return text;
  return setEnv(text, 'COMPOSE_PROFILES', `${cur},${profile}`);
}

/** Generate SECRETS_ENCRYPTION_KEY once. Never rotate an existing key: that would make stored
 *  secrets unreadable. Local sign-in also seals its token signing key with it. */
export function ensureEncryptionKey(envText, gen = () => randomBytes(32).toString('base64')) {
  if (/^SECRETS_ENCRYPTION_KEY=.+/m.test(envText)) return envText;
  const key = gen();
  return /^#?\s*SECRETS_ENCRYPTION_KEY=/m.test(envText)
    ? envText.replace(/^#?\s*SECRETS_ENCRYPTION_KEY=.*/m, `SECRETS_ENCRYPTION_KEY=${key}`)
    : `${envText}\nSECRETS_ENCRYPTION_KEY=${key}\n`;
}

/**
 * Build the .env.prod text `pnpm run init` writes, from the existing text (or the example) and the
 * operator's answers, including `answers.auth`. Under keycloak (or oidc) the keycloak compose
 * profile is turned on, because docker-compose.prod.yml starts Keycloak only under that profile.
 * Idempotent: a second pass with the same answers returns the same text.
 */
export function prepareProdEnv(envText, answers, gen = randomSecret) {
  const { auth } = answers;
  const secrets = ensureStackSecrets(ensureEncryptionKey(envText), gen, { auth });
  let text = secrets.envText;
  if (auth !== 'local') {
    for (const [key, val] of Object.entries(KEYCLOAK_DEFAULTS)) {
      if (getEnv(text, key) === undefined) text = setEnv(text, key, val);
    }
    text = addComposeProfile(text, 'keycloak');
  }
  return { ...secrets, envText: mergeEnv(text, computeEnv(answers)) };
}

/** Patch a rendered realm-import JSON string with per-install secrets: the openldr-admin service
 *  account secret and the seeded labadmin user's initial password. Both committed template values are
 *  well-known dev defaults; substituting them here means a wizard install never imports the realm with
 *  a guessable admin credential. */
export function patchRealmSecrets(realmJson, { kcClientSecret, labAdminPassword }) {
  let out = realmJson;
  if (kcClientSecret) out = out.split('openldr-admin-dev-secret').join(kcClientSecret);
  // Only the credential value — NOT the "username": "labadmin" line — matches this literal.
  if (labAdminPassword) out = out.split('"value": "labadmin"').join(`"value": "${labAdminPassword}"`);
  return out;
}
