import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordRuleError, createUser, listUserDirectory, listUsers, resetUserPassword, setUserStatus, updateUser } from './api';

describe('users api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'u1' }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });

  it('calls the users endpoints', async () => {
    await listUsers();
    await createUser({ username: 'ada', firstName: 'Ada', lastName: 'Lovelace', roles: ['lab_admin'] });
    await updateUser('u1', { firstName: 'Ada', lastName: 'Lovelace', roles: ['system_auditor'] });
    await setUserStatus('u1', false);

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/users');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/users', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/users/u1', expect.objectContaining({ method: 'PUT' }));
    expect(fetch).toHaveBeenNthCalledWith(4, '/api/users/u1/status', expect.objectContaining({ method: 'POST' }));
  });
});

describe('a password that breaks a local sign-in rule', () => {
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));

  it('create and reset throw PasswordRuleError naming the rule on a 400', async () => {
    for (const rule of ['too_short', 'too_long', 'same_as_username'] as const) {
      answer(400, { error: rule });
      await expect(createUser({ username: 'bo', password: 'short' })).rejects.toMatchObject({ rule });
      await expect(createUser({ username: 'bo', password: 'short' })).rejects.toBeInstanceOf(PasswordRuleError);
      answer(400, { error: rule });
      await expect(resetUserPassword('u1', 'short', true)).rejects.toMatchObject({ rule });
      await expect(resetUserPassword('u1', 'short', true)).rejects.toBeInstanceOf(PasswordRuleError);
    }
  });

  it('keeps the plain error for any other failure', async () => {
    answer(400, { error: 'invalid body' });
    await expect(createUser({ username: 'bo' })).rejects.toThrow('create user failed: invalid body');
    await expect(createUser({ username: 'bo' })).rejects.not.toBeInstanceOf(PasswordRuleError);
    answer(502, { error: 'keycloak said no' });
    await expect(resetUserPassword('u1', 'pw', true)).rejects.toThrow('reset password failed: 502');
  });
});

it('encodes directory paging, search and disabled status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [], total: null, hasMore: false }))));
  await listUserDirectory({ offset: 100, limit: 25, search: 'Ada & Bob', enabled: false });
  expect(fetch).toHaveBeenCalledWith('/api/users?offset=100&limit=25&search=Ada+%26+Bob&enabled=false');
});
