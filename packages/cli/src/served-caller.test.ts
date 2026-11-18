import { afterEach, describe, expect, it } from 'vitest';
import { resetServedHandoffForTests, setServedHandoff } from './served';
import { servedCaller } from './served-caller';

// Roles part 3: a served command checks the caller's data limit as the server worked it out, and
// looks it up as sign-in does when an older server sends none.
const limit = { limited: true as const, facilities: ['f1'], districts: [], regions: [] };
const ctx = {
  users: { async get(id: string) { return id === 'u1' ? { id: 'u1', subject: 'sub-1' } : undefined; } },
  roles: { async resolveCapabilities() { return ['dashboards.view']; }, async rolesForUser() { return [{ id: 'r1' }]; } },
  dataScopes: { async get(s: string) { return s === 'sub-1' ? limit : { limited: false as const }; } },
} as never;
const caller = { id: 'u1', username: 'ada', displayName: null, keyName: null };
afterEach(() => resetServedHandoffForTests());

describe('servedCaller data limit', () => {
  it('takes the limit the server sent', async () => {
    setServedHandoff({ path: 'x', argv: [], caller: { ...caller, roleIds: [], capabilities: [], dataScope: limit }, runDir: '/tmp/x', keptDirs: [] });
    expect(await servedCaller(ctx)).toMatchObject({ id: 'u1', dataScope: limit });
  });

  it('looks the limit up by the user\'s subject when the server sent none', async () => {
    setServedHandoff({ path: 'x', argv: [], caller, runDir: '/tmp/x', keptDirs: [] });
    expect(await servedCaller(ctx)).toEqual({ id: 'u1', roleIds: ['r1'], capabilities: ['dashboards.view'], dataScope: limit });
  });
});
