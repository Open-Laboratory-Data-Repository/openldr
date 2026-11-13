// Layer under test: the real buildApp and its sign-in hook, over pg-mem with the real key, role,
// user and audit stores. Not real Postgres, not a listener, not Keycloak. verifyToken is a fake
// that knows two tokens.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@openldr/core';
import { generateAccessKey, hashAccessKey } from '@openldr/bootstrap';
import { bearer, keyFixture, TOKENS } from './access-key.test-support';

type Fixture = Awaited<ReturnType<typeof keyFixture>>;
let open: Fixture[] = [];
async function setup(opts: Parameters<typeof keyFixture>[0] = {}): Promise<Fixture> {
  const f = await keyFixture(opts);
  open.push(f);
  return f;
}
afterEach(async () => {
  for (const f of open) await f.close();
  open = [];
});

const me = (f: Fixture, key: string) => f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(key) });
const INVALID = { error: 'invalid access key' };

describe('signing in with an access key', () => {
  it("signs a request in with a key and gives it the account's capabilities", async () => {
    const f = await setup();
    const { key, record } = await f.makeKey();
    const res = await me(f, key);
    expect(res.statusCode).toBe(200);
    const user = res.json();
    expect(user).toMatchObject({ id: 'bot-id', username: 'bot', accessKey: { id: record.id, name: 'backup job' } });
    expect([...user.capabilities].sort()).toEqual(['users.manage', 'users.view']);
    // Roles as a local or Keycloak token for the same account would carry them: the role slugs.
    expect(user.roles).toEqual([f.managers.slug]);
    expect(f.managers.slug).toBe('key-managers');
  });

  it('gives a key no roles on a generic OIDC install, as a token there has none', async () => {
    const f = await setup({ adapter: 'oidc' });
    const { key } = await f.makeKey();
    const user = (await me(f, key)).json();
    expect(user.roles).toEqual([]);
    expect([...user.capabilities].sort()).toEqual(['users.manage', 'users.view']);
  });

  it('refuses a revoked key, an expired key and a made-up key with 401', async () => {
    const f = await setup();
    const revoked = await f.makeKey('bot-id', 'old');
    const del = await f.app.inject({ method: 'DELETE', url: `/api/users/bot-id/keys/${revoked.record.id}`, headers: bearer(TOKENS.admin) });
    expect(del.statusCode).toBe(204);

    // The route refuses a past expiry, so the expired key is written through the store.
    const expired = generateAccessKey();
    await f.accessKeys.create({
      userId: 'bot-id', name: 'expired', keyHash: hashAccessKey(expired), prefix: expired.slice(0, 12),
      createdBy: null, expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    for (const key of [revoked.key, expired, generateAccessKey()]) {
      const res = await me(f, key);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(INVALID);
    }
  });

  it('refuses a key whose account was disabled after the key was made', async () => {
    const f = await setup();
    const { key } = await f.makeKey();
    expect((await me(f, key)).statusCode).toBe(200);
    await f.users.setStatus('bot-id', 'disabled');
    const res = await me(f, key);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account disabled' });
  });

  it("refuses a key whose account's subject is blocked", async () => {
    const f = await setup();
    const { key } = await f.makeKey();
    await f.users.blockSubject('bot-sub');
    const res = await me(f, key);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account disabled' });
    await f.users.unblockSubject('bot-sub');
    expect((await me(f, key)).statusCode).toBe(200);
  });

  // The access_keys table cascades on user delete, so a real delete also removes the key and the
  // key lookup itself fails. This test makes the user lookup miss while the key row stays, which
  // is the window between the key lookup and the user lookup.
  it("refuses a key whose user row is gone with 401", async () => {
    const f = await setup();
    const { key } = await f.makeKey();
    const get = f.users.get.bind(f.users);
    vi.spyOn(f.users, 'get').mockImplementation(async (id) => (id === 'bot-id' ? undefined : get(id)));
    const res = await me(f, key);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(INVALID);
  });

  it('limits a key at once when its account loses a role', async () => {
    const f = await setup();
    const { key } = await f.makeKey();
    const list = () => f.app.inject({ method: 'GET', url: '/api/users/bot-id/keys', headers: bearer(key) });
    expect((await list()).statusCode).toBe(200);
    await f.roles.unassignRole('bot-sub', f.managers.id);
    const res = await list();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'insufficient capability' });
  });

  it('never calls verifyToken for a value with the key prefix', async () => {
    const f = await setup();
    const { key } = await f.makeKey();
    f.verifyToken.mockClear();
    expect((await me(f, key)).statusCode).toBe(200);
    expect((await me(f, generateAccessKey())).statusCode).toBe(401);
    expect((await me(f, 'oldr_')).statusCode).toBe(401);
    expect(f.verifyToken).not.toHaveBeenCalled();
  });

  it('does not accept a key in the access_token query parameter', async () => {
    const f = await setup();
    const { key, record } = await f.makeKey();
    f.verifyToken.mockClear();
    // One route that reads a token from the URL today, and one that does not. Both refuse a key.
    for (const url of [`/api/terminology/ontology/sys1/build?access_token=${key}`, `/api/me?access_token=${key}`]) {
      const res = await f.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(INVALID);
    }
    // Even beside a good token in the header.
    const both = await f.app.inject({ method: 'GET', url: `/api/me?access_token=${key}`, headers: bearer(TOKENS.admin) });
    expect(both.statusCode).toBe(401);
    expect(f.verifyToken).not.toHaveBeenCalled();
    // Never resolved: the key was not marked as used.
    const [stored] = await f.accessKeys.listForUser('bot-id');
    expect(stored).toMatchObject({ id: record.id, lastUsedAt: null });
  });

  it('signs a key in as its own account with the dev bypass on, and refuses a bad key there', async () => {
    const f = await setup({ devBypass: true });
    const { key } = await f.makeKey();
    expect((await me(f, key)).json()).toMatchObject({ id: 'bot-id', username: 'bot' });
    const bad = await me(f, generateAccessKey());
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual(INVALID);
    // Only a request with no credential gets the dev actor.
    expect((await f.app.inject({ method: 'GET', url: '/api/me' })).json()).toMatchObject({ username: 'dev-admin' });
  });

  it('does not give a key request a session ID', async () => {
    const f = await setup();
    // Added before the first request, which readies the app.
    f.app.get('/api/test/session', async (req) => ({ sessionId: req.sessionId ?? null }));
    const { key } = await f.makeKey();
    const res = await f.app.inject({ method: 'GET', url: '/api/test/session', headers: bearer(key) });
    expect(res.json()).toEqual({ sessionId: null });
  });

  it("marks an audit row written by a key request with the key's name, and a token request's row with no origin", async () => {
    const f = await setup();
    const { key } = await f.makeKey('bot-id', 'backup job');
    const byKey = await f.app.inject({ method: 'POST', url: '/api/users/viewer-id/keys', headers: bearer(key), payload: { name: 'made by a key' } });
    expect(byKey.statusCode).toBe(201);
    const rows = await f.audit.list({ action: 'access_key.create' });
    const tokenRow = rows.find((r) => r.metadata?.name === 'backup job');
    const keyRow = rows.find((r) => r.metadata?.name === 'made by a key');
    expect(tokenRow?.actorName).toBe('admin');
    expect(tokenRow?.metadata && 'origin' in tokenRow.metadata).toBe(false);
    expect(keyRow?.actorName).toBe('bot');
    expect(keyRow?.metadata?.origin).toEqual({ via: 'access-key', keyName: 'backup job' });
  });

  it('writes neither the key nor its hash to the log or the audit rows', async () => {
    // The real logger with its real request serializer, writing to a file. Level trace, so the
    // request lines Fastify writes for every request are in it.
    const dir = mkdtempSync(join(tmpdir(), 'openldr-key-log-'));
    const file = join(dir, 'server.log');
    const before = process.env.LOG_FILE;
    process.env.LOG_FILE = file;
    let logger;
    try { logger = createLogger({ level: 'trace' }); } finally {
      if (before === undefined) delete process.env.LOG_FILE; else process.env.LOG_FILE = before;
    }
    try {
      const f = await setup({ logger });
      const { key, record } = await f.makeKey();
      const madeUp = generateAccessKey();
      expect((await me(f, key)).statusCode).toBe(200);
      expect((await me(f, madeUp)).statusCode).toBe(401);
      expect((await f.app.inject({ method: 'GET', url: `/api/terminology/ontology/sys1/build?access_token=${key}` })).statusCode).toBe(401);
      expect((await f.app.inject({ method: 'DELETE', url: `/api/users/bot-id/keys/${record.id}`, headers: bearer(TOKENS.admin) })).statusCode).toBe(204);
      expect((await me(f, key)).statusCode).toBe(401);
      await f.users.setStatus('bot-id', 'disabled');
      const second = await f.makeKey();
      expect((await me(f, second.key)).statusCode).toBe(403);

      const log = readFileSync(file, 'utf8');
      expect(log).toContain('incoming request');
      const rows = await f.allAuditRows();
      const audit = JSON.stringify(rows);
      expect(rows.some((r) => r.action === 'auth.failed')).toBe(true);
      for (const k of [key, madeUp, second.key]) {
        for (const text of [log, audit]) {
          expect(text).not.toContain(k);
          expect(text).not.toContain(hashAccessKey(k));
        }
        // The 12-character prefix is shown on the key list and audited with create and revoke.
        // It never reaches the log or a failed sign-in row.
        expect(log).not.toContain(k.slice(0, 12));
        expect(JSON.stringify(rows.filter((r) => r.action === 'auth.failed'))).not.toContain(k.slice(0, 12));
      }
      expect(audit).not.toContain(madeUp.slice(0, 12));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
