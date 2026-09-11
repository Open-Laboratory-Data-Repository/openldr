import { describe, expect, it, vi } from 'vitest';
import { listUserDirectory } from './user-directory';

const directoryRows = Array.from({ length: 125 }, (_, i) => ({ id: String(i), username: `user${i}`, email: null, firstName: null, lastName: null, enabled: true, roles: [], createdAt: null }));
function context() {
  return { auth: { directory: { list: vi.fn(async (o: { first: number; max: number }) => directoryRows.slice(o.first, o.first + o.max)) } }, userProfiles: { list: vi.fn(async (_ids: string[]) => new Map()) }, users: { list: vi.fn() } };
}
describe('directory pages', () => {
  it('reaches users beyond 100 with bounded lookahead', async () => {
    const ctx = context();
    const result = await listUserDirectory(ctx as never, { offset: 100, limit: 25 });
    expect(result.rows).toHaveLength(25);
    expect(result.rows[0].id).toBe('100');
    expect(result.hasMore).toBe(false);
    expect(ctx.auth.directory.list).toHaveBeenCalledWith({ first: 100, max: 26, search: undefined, enabled: undefined });
  });
  it('passes search and disabled filtering to the provider before paging', async () => {
    const ctx = context();
    await listUserDirectory(ctx as never, { offset: 25, limit: 25, search: 'Ada', enabled: false });
    expect(ctx.auth.directory.list).toHaveBeenCalledWith({ first: 25, max: 26, search: 'Ada', enabled: false });
  });
  it('detects another page and only loads profiles for visible rows', async () => {
    const ctx = context();
    const page = await listUserDirectory(ctx as never, { limit: 25 });
    expect(page.hasMore).toBe(true);
    expect(page.total).toBeNull();
    expect(ctx.userProfiles.list.mock.calls[0][0]).toHaveLength(25);
  });
  it.each([{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 1.5 }])('rejects invalid bounds %j', async (options) => {
    const ctx = context();
    await expect(listUserDirectory(ctx as never, options)).rejects.toThrow();
    expect(ctx.auth.directory.list).not.toHaveBeenCalled();
  });
});

it('uses bounded local fallback only when admin access is unconfigured', async () => {
  const ctx = context();
  const error = new Error('unconfigured'); error.name = 'IdentityAdminNotConfiguredError';
  ctx.auth.directory.list.mockRejectedValue(error);
  ctx.users.list.mockResolvedValue([{ id: 'local', username: 'local', email: null, roles: [], status: 'disabled', createdAt: null }]);
  const result = await listUserDirectory(ctx as never, { offset: 100, limit: 10, search: 'local', enabled: false });
  expect(ctx.users.list).toHaveBeenCalledWith({ offset: 100, limit: 11, search: 'local', enabled: false });
  expect(result.rows[0]).toMatchObject({ id: 'local', enabled: false, extras: {} });
  expect(ctx.userProfiles.list).not.toHaveBeenCalled();
});
it('does not hide provider failures behind a local fallback', async () => {
  const ctx = context();
  ctx.auth.directory.list.mockRejectedValue(new Error('provider failed'));
  await expect(listUserDirectory(ctx as never)).rejects.toThrow('provider failed');
  expect(ctx.users.list).not.toHaveBeenCalled();
});
