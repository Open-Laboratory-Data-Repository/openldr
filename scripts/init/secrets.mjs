import { randomBytes } from 'node:crypto';

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
export function ensureStackSecrets(envText, gen = randomSecret) {
  let text = envText;
  for (const [key, weak] of Object.entries(WEAK_DEFAULTS)) {
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
  let labAdminPassword = getEnv(text, 'INITIAL_LAB_ADMIN_PASSWORD');
  if (!labAdminPassword) {
    labAdminPassword = gen();
    text = setEnv(text, 'INITIAL_LAB_ADMIN_PASSWORD', labAdminPassword);
  }
  return { envText: text, kcClientSecret: getEnv(text, 'KEYCLOAK_ADMIN_CLIENT_SECRET'), labAdminPassword };
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
