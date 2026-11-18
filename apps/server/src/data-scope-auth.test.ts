// Layer under test: the real buildApp and its sign-in hook over pg-mem, with the real role, user,
// key and data limit stores (roles part 3). Not real Postgres, not Keycloak.
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITED_SCOPE_DROPS } from '@openldr/rbac';
import { bearer, keyFixture, TOKENS } from './access-key.test-support';

type Fixture = Awaited<ReturnType<typeof keyFixture>>;
let open: Fixture[] = [];
afterEach(async () => { for (const f of open) await f.close(); open = []; });
async function setup(devBypass = false) { const f = await keyFixture({ devBypass }); open.push(f); return f; }
const me = (f: Fixture, value: string) => f.app.inject({ method: 'GET', url: '/api/me', headers: bearer(value) });
const limit = { limited: true as const, facilities: [], districts: [], regions: ['Dodoma'] };

describe('the data limit on the signed-in request', () => {
  it('carries Everything for a user with no limit, on a token and on a key', async () => {
    const f = await setup();
    const { key } = await f.makeKey();
    expect((await me(f, TOKENS.admin)).json().dataScope).toEqual({ limited: false });
    expect((await me(f, key)).json().dataScope).toEqual({ limited: false });
  });

  it('carries the limit, and the capabilities without the dropped list, on a token and on a key', async () => {
    const f = await setup();
    await f.roles.update(f.managers.id, { capabilities: ['users.manage', 'users.view', 'reports.view', 'dashboards.view'] });
    const { key } = await f.makeKey();
    await f.dataScopes.set('bot-sub', limit);
    await f.dataScopes.set('admin-sub', limit);
    for (const value of [key, TOKENS.admin]) {
      const user = (await me(f, value)).json();
      expect(user.dataScope).toEqual(limit);
      expect([...user.capabilities].sort()).toEqual(['dashboards.view', 'users.manage', 'users.view']);
      expect(user.capabilities.some((c: string) => LIMITED_SCOPE_DROPS.includes(c))).toBe(false);
    }
  });

  it('never limits the dev bypass', async () => {
    const f = await setup(true);
    const res = await f.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.json().dataScope).toEqual({ limited: false });
  });
});
