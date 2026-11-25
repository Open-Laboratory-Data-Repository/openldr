import { describe, it, expect, vi } from 'vitest';
import { createRoleStatus } from './plugin-data-requests';

// R1 and R2 (deferred minors 2026-11-25): what CE keeps of the plugin data role check.
describe('the kept plugin data role answer', () => {
  it('a check that fails is not kept: the next request checks again (R1)', async () => {
    const read = vi.fn().mockResolvedValueOnce('unknown').mockResolvedValueOnce('switch');
    const grantAll = vi.fn(async () => {});
    const roles = createRoleStatus(read, grantAll);
    expect(await roles.get()).toBe('not-needed');
    expect(await roles.get()).toBe('switch');
    expect(await roles.get()).toBe('switch');
    expect(read).toHaveBeenCalledTimes(2);
    expect(grantAll).toHaveBeenCalledTimes(1);
  });

  it('a check that answers is kept for the process', async () => {
    const read = vi.fn(async () => 'not-needed' as const);
    const roles = createRoleStatus(read, async () => {});
    await roles.get();
    await roles.get();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a grant that fails keeps missing for a minute, then tries again (M6 and its review)', async () => {
    let clock = 1_000_000;
    const grantAll = vi.fn().mockRejectedValueOnce(new Error('lock timeout')).mockResolvedValueOnce(undefined);
    const roles = createRoleStatus(async () => 'switch' as const, grantAll, () => clock);
    expect(await roles.get()).toBe('missing');
    clock += 30_000;
    expect(await roles.get()).toBe('missing');
    expect(grantAll).toHaveBeenCalledTimes(1);
    clock += 31_000;
    expect(await roles.get()).toBe('switch');
    expect(await roles.get()).toBe('switch');
    expect(grantAll).toHaveBeenCalledTimes(2);
  });

  it('forget drops the kept answer, so the next request checks again (R2)', async () => {
    const read = vi.fn().mockResolvedValueOnce('switch').mockResolvedValueOnce('missing');
    const roles = createRoleStatus(read, async () => {});
    expect(await roles.get()).toBe('switch');
    roles.forget();
    expect(await roles.get()).toBe('missing');
  });
});
