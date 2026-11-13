// Layer under test: the key routes inside the real buildApp, with the real sign-in hook, over
// pg-mem with the real key, role, user and audit stores. These tests pin the wire shape. Not real
// Postgres: the duplicate-hash path below uses a store that throws, not a real constraint error.
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
