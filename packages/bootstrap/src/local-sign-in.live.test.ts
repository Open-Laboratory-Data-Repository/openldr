// Local sign-in on real PostgreSQL. pg-mem runs one statement at a time, so it cannot show two
// connections racing. Each test makes a throwaway schema and two single-connection pools on it.
// Skipped unless P08_TEST_DATABASE_URL points at a scratch database.
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { describe, it, expect } from 'vitest';
import { createInternalDb, createLocalAuthStore, createRoleStore, internalMigrations, type InternalDb } from '@openldr/db';
import { createUserStore } from '@openldr/users';
import { createLocalAuth, LOCAL_ISSUER, SigningKeyUnreadableError } from '@openldr/adapter-auth';
import type { Config } from '@openldr/config';
import { bindAuthIssuer, readAuthIssuerBinding } from './auth-issuer-binding';
import { createAppContext } from './index';

const url = process.env.P08_TEST_DATABASE_URL;
const MIGRATIONS = ['006_users', '062_rbac', '067_capability_introductions', '095_account_access_blocks', '098_auth_issuer_binding', '116_local_sign_in'] as const;
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

async function fixture() {
  const schema = `lsi_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`create schema "${schema}"`);
  const make = () => createInternalDb(url!, { pool: new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 }) });
  const one = make(); const two = make();
  for (const name of MIGRATIONS) await internalMigrations[name]!.up(one.db);
  return {
    schema, admin, one, two,
    close: async () => {
      await one.close(); await two.close();
      await admin.query(`drop schema "${schema}" cascade`); await admin.end();
    },
  };
}

function localAuthDeps(internal: InternalDb, secretKey: Buffer) {
  return {
    store: createLocalAuthStore(internal.db),
    users: createUserStore(internal.db, { withSubjectLock: internal.withAccountStatusLock }),
    roles: createRoleStore(internal.db),
    secretKey,
    ping: async () => { await sql`select 1`.execute(internal.db); },
  };
}

/** Local sign-in on the fixture's schema. Every other service points at nothing reachable. */
function localConfig(schema: string, secretKey: Buffer): Config {
  const internal = new URL(url!);
  internal.searchParams.set('options', `-c search_path=${schema}`);
  return {
    NODE_ENV: 'test', PORT: 3000, LOG_LEVEL: 'silent',
    AUTH_ADAPTER: 'local', AUTH_DEV_BYPASS: false, SECRETS_ENCRYPTION_KEY: secretKey.toString('base64'),
    BLOB_ADAPTER: 'minio', EVENTING_ADAPTER: 'pg', TARGET_STORE_ADAPTER: 'pg',
    INTERNAL_DATABASE_URL: internal.toString(), TARGET_DATABASE_URL: 'postgres://u:p@127.0.0.1:5499/none',
    S3_ENDPOINT: 'http://127.0.0.1:9499', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'x', S3_SECRET_ACCESS_KEY: 'xxxxxxxx',
    S3_BUCKET: 'none', S3_FORCE_PATH_STYLE: true,
  } as Config;
}

/** Waits until some backend is blocked on a lock while updating local_credentials. */
async function waitForBlockedCredentialWrite(admin: pg.Pool): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const r = await admin.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%update \"local_credentials\"%'",
    );
    if (r.rows[0]!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the second writer never waited on the row lock');
}

describe.skipIf(!url)('local sign-in on PostgreSQL', () => {
  it('counts two wrong tries that arrive together', async () => {
    const f = await fixture();
    try {
      const a = createLocalAuthStore(f.one.db);
      const b = createLocalAuthStore(f.two.db);
      const { id } = await a.createUser({ username: 'ada' });
      await a.setPassword(id, 'stored-hash', false);
      for (let round = 0; round < 25; round++) {
        await a.clearFailures(id);
        const now = new Date();
        await Promise.all([a.recordFailure(id, now, MAX_FAILURES, LOCK_MS), b.recordFailure(id, now, MAX_FAILURES, LOCK_MS)]);
        expect((await a.getCredential(id))!.failedCount).toBe(2);
      }
    } finally { await f.close(); }
  }, 60000);

  it('creates one admin from two setup requests on two connections', async () => {
    const f = await fixture();
    try {
      await createRoleStore(f.one.db).seedSystemRoles();
      const secretKey = randomBytes(32);
      const a = await createLocalAuth(localAuthDeps(f.one, secretKey));
      const b = await createLocalAuth(localAuthDeps(f.two, secretKey));
      const input = { password: 'first admin pw', ip: null, userAgent: null };
      for (let round = 0; round < 10; round++) {
        await sql`delete from user_roles`.execute(f.one.db);
        await sql`delete from users`.execute(f.one.db);
        expect(await a.signIn.setupRequired()).toBe(true);
        const setupCode = await a.signIn.createSetupCode();
        const results = await Promise.all([
          a.signIn.setup({ ...input, setupCode, username: 'ada' }),
          b.signIn.setup({ ...input, setupCode, username: 'bob' }),
        ]);
        const winners = results.filter((r) => r.ok);
        expect(winners).toHaveLength(1);
        const loser = results.find((r) => !r.ok)!;
        expect(['bad_code', 'already_set_up']).toContain(!loser.ok && loser.reason);
        const credentials = await sql<{ n: number }>`select count(*)::int as n from local_credentials`.execute(f.one.db);
        expect(credentials.rows[0]!.n).toBe(1);
        const users = await sql<{ n: number }>`select count(*)::int as n from users`.execute(f.one.db);
        expect(users.rows[0]!.n).toBe(1);
        expect(await b.signIn.setupRequired()).toBe(false);
      }
    } finally { await f.close(); }
  }, 60000);

  it('refuses to bind the local issuer on a database bound to a Keycloak issuer', async () => {
    const f = await fixture();
    try {
      await bindAuthIssuer(f.one.db, 'http://kc/realms/openldr');
      await expect(bindAuthIssuer(f.two.db, LOCAL_ISSUER)).rejects.toThrow(/set up with another sign-in provider \(http:\/\/kc\/realms\/openldr\)\. Local sign-in cannot take it over/);
      expect(await readAuthIssuerBinding(f.one.db)).toBe('http://kc/realms/openldr');
    } finally { await f.close(); }
  }, 60000);

  // setPassword is an admin reset and always writes. replacePassword is a user's own change and
  // only writes over the hash it expects. If replacePassword wins, it ran first and the reset
  // then overwrote it. If it loses, the reset ran first and it found a hash it did not expect.
  // Either way the reset is what remains, and the user's hash never does.
  it('never lets replacePassword overwrite a newer hash it did not expect', async () => {
    const f = await fixture();
    try {
      const a = createLocalAuthStore(f.one.db);
      const b = createLocalAuthStore(f.two.db);
      const { id } = await a.createUser({ username: 'ada' });
      let replaced = 0;
      let refused = 0;
      for (let round = 0; round < 100; round++) {
        const old = `old-${round}`; const reset = `reset-${round}`; const own = `own-${round}`;
        await a.setPassword(id, old, false);
        const resetting = () => a.setPassword(id, reset, true);
        const changing = () => b.replacePassword(id, old, own, false);
        // Alternate which request is sent first, so both orders get a chance to happen.
        const wrote = round % 2 === 0
          ? (await Promise.all([resetting(), changing()]))[1]
          : (await Promise.all([changing(), resetting()]))[0];
        if (wrote) replaced++; else refused++;
        const credential = (await a.getCredential(id))!;
        expect(credential.passwordHash).toBe(reset);
        expect(credential.mustChange).toBe(true);
      }
      expect(replaced + refused).toBe(100);
    } finally { await f.close(); }
  }, 60000);

  it('refuses a replacePassword whose expected hash went stale while it waited for the row', async () => {
    const f = await fixture();
    try {
      const a = createLocalAuthStore(f.one.db);
      const b = createLocalAuthStore(f.two.db);
      const { id } = await a.createUser({ username: 'ada' });
      await a.setPassword(id, 'old', false);
      let changing: Promise<boolean> | undefined;
      // The reset holds the row lock until its transaction commits. The change is sent while the
      // stored hash is still 'old', waits on the lock, then sees the reset's hash.
      await f.one.db.transaction().execute(async (trx) => {
        await createLocalAuthStore(trx).setPassword(id, 'reset', true);
        changing = b.replacePassword(id, 'old', 'own', false);
        await waitForBlockedCredentialWrite(f.admin);
      });
      expect(await changing).toBe(false);
      const credential = (await a.getCredential(id))!;
      expect(credential.passwordHash).toBe('reset');
      expect(credential.mustChange).toBe(true);
    } finally { await f.close(); }
  }, 60000);

  // Both cases fail at the first database step, so createAppContext stops before any other service.
  it('createAppContext under local refuses a database bound to a Keycloak issuer and writes no signing key', async () => {
    const f = await fixture();
    try {
      await bindAuthIssuer(f.one.db, 'http://kc/realms/openldr');
      await expect(createAppContext(localConfig(f.schema, randomBytes(32)))).rejects.toThrow(/set up with another sign-in provider \(http:\/\/kc\/realms\/openldr\)\. Local sign-in cannot take it over/);
      const keys = await sql<{ n: number }>`select count(*)::int as n from auth_signing_keys`.execute(f.one.db);
      expect(keys.rows[0]!.n).toBe(0);
    } finally { await f.close(); }
  }, 60000);

  it('createAppContext under local surfaces SigningKeyUnreadableError with its own message', async () => {
    const f = await fixture();
    try {
      // A key sealed with one secrets key, then a boot with another.
      await createLocalAuth(localAuthDeps(f.one, randomBytes(32)));
      const error = await createAppContext(localConfig(f.schema, randomBytes(32))).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(SigningKeyUnreadableError);
      expect((error as Error).message).toBe(new SigningKeyUnreadableError().message);
      expect(await readAuthIssuerBinding(f.one.db)).toBe(LOCAL_ISSUER);
    } finally { await f.close(); }
  }, 60000);
});
