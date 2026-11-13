// Layer under test: the key routes inside the real buildApp, with the real sign-in hook, over
// pg-mem with the real key, role, user and audit stores. These tests pin the wire shape. Not real
// Postgres: the duplicate-hash path below uses a store that throws, not a real constraint error.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubjectLinkConflictError } from '@openldr/bootstrap';
import { bearer, DIRECTORY, keyFixture, TOKENS } from './access-key.test-support';

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

const RECORD_FIELDS = ['createdAt', 'createdBy', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt', 'userId'];

describe('/api/users/:id/keys', () => {
  it('answers the key once on create and never on list', async () => {
    const f = await setup();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await f.app.inject({
      method: 'POST', url: '/api/users/bot-id/keys', headers: bearer(TOKENS.admin), payload: { name: 'backup job', expiresAt },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['key', 'record']);
    expect(body.key).toMatch(/^oldr_[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(body.record).sort()).toEqual(RECORD_FIELDS);
    expect(body.record).toMatchObject({ userId: 'bot-id', name: 'backup job', prefix: body.key.slice(0, 12), createdBy: 'admin-id', expiresAt, revokedAt: null });

    const list = await f.app.inject({ method: 'GET', url: '/api/users/bot-id/keys', headers: bearer(TOKENS.admin) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ keys: [body.record] });
    expect(list.body).not.toContain(body.key);
  });

  it('needs users.manage for all three routes', async () => {
    const f = await setup();
    const { record } = await f.makeKey();
    const calls = [
      { method: 'GET' as const, url: '/api/users/bot-id/keys' },
      { method: 'POST' as const, url: '/api/users/bot-id/keys', payload: { name: 'x' } },
      { method: 'DELETE' as const, url: `/api/users/bot-id/keys/${record.id}` },
    ];
    for (const call of calls) {
      const viewer = await f.app.inject({ ...call, headers: bearer(TOKENS.viewer) });
      expect(viewer.statusCode).toBe(403);
      expect(viewer.json()).toEqual({ error: 'insufficient capability' });
      expect((await f.app.inject(call)).statusCode).toBe(401);
    }
    // Nothing changed: still one key, not revoked.
    expect((await f.accessKeys.listForUser('bot-id')).map((k) => k.revokedAt)).toEqual([null]);
  });

  it("answers 404 when revoking another user's key", async () => {
    const f = await setup();
    const { record } = await f.makeKey('bot-id');
    const res = await f.app.inject({ method: 'DELETE', url: `/api/users/viewer-id/keys/${record.id}`, headers: bearer(TOKENS.admin) });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });
    expect((await f.accessKeys.listForUser('bot-id'))[0].revokedAt).toBeNull();
  });

  it('answers the same 404 for an unknown key and an already revoked key, and 204 once', async () => {
    const f = await setup();
    const { record } = await f.makeKey();
    const del = (id: string) => f.app.inject({ method: 'DELETE', url: `/api/users/bot-id/keys/${id}`, headers: bearer(TOKENS.admin) });
    const first = await del(record.id);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');
    for (const res of [await del(record.id), await del('00000000-0000-0000-0000-000000000000')]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    }
    expect((await f.audit.list({ action: 'access_key.revoke' })).length).toBe(1);
  });

  it('answers 404 on all three routes for a user id that does not exist', async () => {
    const f = await setup();
    const { record } = await f.makeKey();
    for (const call of [
      { method: 'GET' as const, url: '/api/users/nobody/keys' },
      { method: 'POST' as const, url: '/api/users/nobody/keys', payload: { name: 'x' } },
      { method: 'DELETE' as const, url: `/api/users/nobody/keys/${record.id}` },
    ]) {
      const res = await f.app.inject({ ...call, headers: bearer(TOKENS.admin) });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    }
  });

  it('answers 400 for a body that is not valid, with a message that holds no key', async () => {
    const f = await setup();
    const post = (payload: unknown) => f.app.inject({ method: 'POST', url: '/api/users/bot-id/keys', headers: bearer(TOKENS.admin), payload: payload as object });
    for (const payload of [{}, { name: 7 }, { name: 'x', expiresAt: 5 }]) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid body' });
    }
    const cases: Array<[object, string]> = [
      [{ name: '   ' }, 'name is empty'],
      [{ name: 'x'.repeat(81) }, 'name is over 80 characters'],
      [{ name: 'x', expiresAt: 'soon' }, 'expiry is not a date'],
      [{ name: 'x', expiresAt: new Date(Date.now() - 1000).toISOString() }, 'expiry must be in the future'],
    ];
    for (const [payload, error] of cases) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error });
    }
    expect(await f.accessKeys.listForUser('bot-id')).toEqual([]);
  });

  it('answers 400 for a name with a tab or a line break, and makes no key', async () => {
    const f = await setup();
    for (const name of ['backup\tjob', 'backup\njob']) {
      const res = await f.app.inject({ method: 'POST', url: '/api/users/bot-id/keys', headers: bearer(TOKENS.admin), payload: { name } });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'name holds a control character, such as a tab or a line break' });
    }
    expect(await f.accessKeys.listForUser('bot-id')).toEqual([]);
  });

  it('answers a fixed 500 and logs no database detail when the store refuses the key', async () => {
    const f = await setup();
    const error = vi.fn();
    f.ctx.logger.error = error as never;
    // Real Postgres puts the clashing hash in a duplicate-key error's detail.
    const dbError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', detail: 'Key (key_hash)=(abc123) already exists.' });
    vi.spyOn(f.accessKeys, 'create').mockRejectedValueOnce(dbError);
    const res = await f.app.inject({ method: 'POST', url: '/api/users/bot-id/keys', headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'could not create the access key' });
    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('duplicate key');
  });

  it('tells caches not to keep the create answer', async () => {
    const f = await setup();
    const res = await f.app.inject({ method: 'POST', url: '/api/users/bot-id/keys', headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// With identity admin (Keycloak with admin credentials here), Studio lists users from the
// directory and sends the provider's id, which the local row keeps as `subject`.
describe('/api/users/:id/keys with identity admin', () => {
  const keysUrl = (id: string) => `/api/users/${id}/keys`;

  it("lists, creates and revokes by the provider id that Studio sends", async () => {
    const f = await setup({ identityAdmin: true });
    const made = await f.app.inject({ method: 'POST', url: keysUrl('bot-sub'), headers: bearer(TOKENS.admin), payload: { name: 'backup job' } });
    expect(made.statusCode).toBe(201);
    const { record } = made.json();
    expect(record.userId).toBe('bot-id');
    const list = await f.app.inject({ method: 'GET', url: keysUrl('bot-sub'), headers: bearer(TOKENS.admin) });
    expect(list.json()).toEqual({ keys: [record] });
    const del = await f.app.inject({ method: 'DELETE', url: `${keysUrl('bot-sub')}/${record.id}`, headers: bearer(TOKENS.admin) });
    expect(del.statusCode).toBe(204);
    expect((await f.accessKeys.listForUser('bot-id'))[0].revokedAt).not.toBeNull();
    // The local id is not a provider id, so it is not found in this mode.
    expect((await f.app.inject({ method: 'GET', url: keysUrl('bot-id'), headers: bearer(TOKENS.admin) })).statusCode).toBe(404);
  });

  it('gives a directory account that never signed in an empty list, a 404 on revoke, and no local row', async () => {
    const f = await setup({ identityAdmin: true });
    const list = await f.app.inject({ method: 'GET', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ keys: [] });
    const del = await f.app.inject({ method: 'DELETE', url: `${keysUrl('ai-sub')}/some-key`, headers: bearer(TOKENS.admin) });
    expect(del.statusCode).toBe(404);
    expect(del.json()).toEqual({ error: 'not found' });
    expect(await f.users.getBySubject('ai-sub')).toBeUndefined();
  });

  it('makes the local row on create for a directory account with none, and the key signs in with its capabilities', async () => {
    const f = await setup({ identityAdmin: true });
    // The AI account's limited role, given in Studio before it ever signed in.
    await f.roles.assignRole('ai-sub', f.viewers.id);
    const made = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'assistant' } });
    expect(made.statusCode).toBe(201);
    const { key, record } = made.json();
    const local = await f.users.getBySubject('ai-sub');
    expect(local).toMatchObject({ id: record.userId, subject: 'ai-sub', username: DIRECTORY['ai-sub'].username, status: 'active', lastLoginAt: null });

    const me = await f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(key) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: record.userId, username: 'ai', capabilities: ['users.view'] });
    // A second create finds the row it made and does not make another.
    expect((await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'second' } })).json().record.userId).toBe(record.userId);
    expect((await f.users.list()).filter((u) => u.subject === 'ai-sub')).toHaveLength(1);
  });

  it('copies a disabled directory account as disabled, so its key is refused', async () => {
    const f = await setup({ identityAdmin: true });
    const made = await f.app.inject({ method: 'POST', url: keysUrl('off-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(made.statusCode).toBe(201);
    expect(await f.users.getBySubject('off-sub')).toMatchObject({ status: 'disabled' });
    const me = await f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(made.json().key) });
    expect(me.statusCode).toBe(403);
  });

  it('answers 404 on all three routes for an id the directory does not know', async () => {
    const f = await setup({ identityAdmin: true });
    for (const call of [
      { method: 'GET' as const, url: keysUrl('nobody') },
      { method: 'POST' as const, url: keysUrl('nobody'), payload: { name: 'x' } },
      { method: 'DELETE' as const, url: `${keysUrl('nobody')}/k1` },
    ]) {
      const res = await f.app.inject({ ...call, headers: bearer(TOKENS.admin) });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    }
    expect(await f.users.getBySubject('nobody')).toBeUndefined();
  });

  // `openldr user create` makes a row with no subject. setSubjectStatus links such a row by
  // username when it makes the key's row, and must not turn a disabled one back on.
  it('keeps a disabled local row with the same username disabled when it links it, so the key is refused', async () => {
    const f = await setup({ identityAdmin: true });
    await f.db.insertInto('users').values({ id: 'ai-local', subject: null, username: 'ai', status: 'disabled', roles: JSON.stringify([]) as never }).execute();
    const made = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(made.statusCode).toBe(201);
    expect(made.json().record.userId).toBe('ai-local');
    expect(await f.users.getBySubject('ai-sub')).toMatchObject({ id: 'ai-local', status: 'disabled' });
    const me = await f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(made.json().key) });
    expect(me.statusCode).toBe(403);
    await expect(f.audit.list({ action: 'user.status' })).resolves.toEqual([]);
  });

  it('links an active local row with the same username as active', async () => {
    const f = await setup({ identityAdmin: true });
    await f.db.insertInto('users').values({ id: 'ai-local', subject: null, username: 'ai', status: 'active', roles: JSON.stringify([]) as never }).execute();
    const made = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(made.json().record.userId).toBe('ai-local');
    expect(await f.users.getBySubject('ai-sub')).toMatchObject({ id: 'ai-local', status: 'active' });
    expect((await f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(made.json().key) })).statusCode).toBe(200);
  });

  // The dev actor, a row from an older install, or a row the CLI made can have no subject and
  // still hold keys. Such a row is found by its local id.
  it('lists and revokes the keys of a local row with no subject, on local sign-in', async () => {
    const f = await setup({ adapter: 'local', identityAdmin: true });
    await f.db.insertInto('users').values({ id: 'old-id', subject: null, username: 'old', roles: JSON.stringify([]) as never }).execute();
    const record = await f.accessKeys.create({ userId: 'old-id', name: 'old key', keyHash: 'h'.repeat(64), prefix: 'oldr_abcdefg', createdBy: null, expiresAt: null });
    const list = await f.app.inject({ method: 'GET', url: keysUrl('old-id'), headers: bearer(TOKENS.admin) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ keys: [record] });
    const del = await f.app.inject({ method: 'DELETE', url: `${keysUrl('old-id')}/${record.id}`, headers: bearer(TOKENS.admin) });
    expect(del.statusCode).toBe(204);
    expect(f.directoryGet).not.toHaveBeenCalled();
  });

  it('answers 502 with redacted text when the directory fails, and 503 when its admin client is not set up', async () => {
    const f = await setup({ identityAdmin: true });
    const calls = [
      { method: 'GET' as const, url: keysUrl('ai-sub') },
      { method: 'POST' as const, url: keysUrl('ai-sub'), payload: { name: 'x' } },
      { method: 'DELETE' as const, url: `${keysUrl('ai-sub')}/k1` },
    ];
    f.directoryGet.mockRejectedValue(new Error('provider down at https://admin:hunter2@kc.example'));
    for (const call of calls) {
      const res = await f.app.inject({ ...call, headers: bearer(TOKENS.admin) });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'provider down at https://admin:***@kc.example' });
    }
    f.directoryGet.mockRejectedValue(Object.assign(new Error('admin not configured'), { name: 'IdentityAdminNotConfiguredError' }));
    for (const call of calls) {
      const res = await f.app.inject({ ...call, headers: bearer(TOKENS.admin) });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'identity provider admin client is not configured' });
    }
    expect(await f.users.getBySubject('ai-sub')).toBeUndefined();
  });

  it('answers 409 with its own text when another change holds the account lock', async () => {
    const f = await setup({ identityAdmin: true });
    vi.spyOn(f.users, 'withSubjectLock').mockRejectedValueOnce(Object.assign(new Error('another account status change is in progress; retry the action'), { name: 'AccountStatusConflictError' }));
    const res = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'another change to this account is in progress; try again' });
  });

  // Runs `before` as the route's write begins: after every lookup the route makes, before the
  // statement that links the row. pg-mem runs one statement at a time, so this proves what the
  // statement does when the row changed in that gap. It does not run two connections at once.
  function onLinkWrite(f: Fixture, before: () => Promise<void>) {
    vi.spyOn(f.users, 'withSubjectLock').mockImplementation(async (_subject, work) => work({
      ...f.users,
      setSubjectStatus: async (...args: Parameters<typeof f.users.setSubjectStatus>) => { await before(); return f.users.setSubjectStatus(...args); },
    }));
  }

  it('does not undo a disable that lands between the lookups and the link write', async () => {
    const f = await setup({ identityAdmin: true });
    await f.db.insertInto('users').values({ id: 'ai-local', subject: null, username: 'ai', status: 'active', roles: JSON.stringify([]) as never }).execute();
    // As `openldr user disable ai-local` would, with no lock, because the row has no subject.
    onLinkWrite(f, () => f.users.setStatus('ai-local', 'disabled'));
    const made = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(made.statusCode).toBe(201);
    expect(await f.users.getBySubject('ai-sub')).toMatchObject({ id: 'ai-local', status: 'disabled' });
    // The directory said enabled and the route changed nothing, so it writes no status row.
    expect(await f.audit.list({ action: 'user.status' })).toHaveLength(0);
    vi.restoreAllMocks();
    expect((await f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(made.json().key) })).statusCode).toBe(403);
  });

  // The store throws this when a first sign-in links the row between its read by username and its
  // update. packages/users/src/status.test.ts reaches that throw in the real store. Here the store's
  // own class stands in for it, so a rename on either side fails this test.
  it('answers its own 409 when a sign-in links the row during the create', async () => {
    const f = await setup({ identityAdmin: true });
    vi.spyOn(f.users, 'withSubjectLock').mockImplementation(async (_subject, work) => work({
      ...f.users,
      setSubjectStatus: async () => { throw new SubjectLinkConflictError(); },
    }));
    const res = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'another change to this account is in progress; try again' });
  });

  it('refuses a bad name or a past expiry before it makes a local row', async () => {
    const f = await setup({ identityAdmin: true });
    for (const payload of [{ name: '  ' }, { name: 'x', expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
      const res = await f.app.inject({ method: 'POST', url: keysUrl('ai-sub'), headers: bearer(TOKENS.admin), payload });
      expect(res.statusCode).toBe(400);
    }
    expect(await f.users.getBySubject('ai-sub')).toBeUndefined();
  });

  it('audits linking an active local row as disabled because the directory account is disabled, and refuses its key', async () => {
    const f = await setup({ identityAdmin: true });
    await f.db.insertInto('users').values({ id: 'off-local', subject: null, username: 'off', status: 'active', roles: JSON.stringify([]) as never }).execute();
    const made = await f.app.inject({ method: 'POST', url: keysUrl('off-sub'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(made.statusCode).toBe(201);
    expect(await f.users.getBySubject('off-sub')).toMatchObject({ id: 'off-local', status: 'disabled' });
    const rows = await f.audit.list({ action: 'user.status' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorName: 'admin', entityType: 'user', entityId: 'off-sub',
      before: { id: 'off-local', subject: null, status: 'active' },
      after: { status: 'disabled', enabled: false },
      metadata: { enabled: false, backend: 'provider', localId: 'off-local', reason: 'key-link-found-directory-account-disabled' },
    });
    expect((await f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(made.json().key) })).statusCode).toBe(403);
  });

  // Local sign-in is identity admin too (packages/config/src/auth.ts). Its directory id is the
  // local id, and a local row's subject is its id (packages/db/src/local-auth-store.ts).
  it('finds a local sign-in account by its id, which is also its subject', async () => {
    const f = await setup({ adapter: 'local' });
    await f.db.insertInto('users').values({ id: 'loc-id', subject: 'loc-id', username: 'loc', roles: JSON.stringify([]) as never, rbac_initialized: true }).execute();
    const made = await f.app.inject({ method: 'POST', url: keysUrl('loc-id'), headers: bearer(TOKENS.admin), payload: { name: 'x' } });
    expect(made.statusCode).toBe(201);
    expect(made.json().record.userId).toBe('loc-id');
    expect((await f.app.inject({ method: 'GET', url: keysUrl('loc-id'), headers: bearer(TOKENS.admin) })).json().keys).toHaveLength(1);
  });
});
