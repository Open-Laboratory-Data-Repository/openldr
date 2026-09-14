import { describe, expect, it, vi } from 'vitest';
import * as tedious from 'tedious';
import { createRequestTimeoutScope } from './request-timeout';

describe('createRequestTimeoutScope', () => {
  it('sets the active operation timeout on every Tedious request', async () => {
    const timeoutSpy = vi.spyOn(tedious.Request.prototype, 'setTimeout').mockImplementation(() => {});
    const scope = createRequestTimeoutScope(tedious.Request);

    await scope.run(275, async () => {
      await Promise.resolve();
      new scope.Request('select 1', () => {});
    });

    expect(timeoutSpy).toHaveBeenCalledWith(275);
    timeoutSpy.mockRestore();
  });

  it('keeps concurrent operation timeouts separate across awaits', async () => {
    const seen: number[] = [];
    const timeoutSpy = vi.spyOn(tedious.Request.prototype, 'setTimeout').mockImplementation((ms) => {
      if (ms !== undefined) seen.push(ms);
    });
    const scope = createRequestTimeoutScope(tedious.Request);

    await Promise.all([
      scope.run(125, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        new scope.Request('select 1', () => {});
      }),
      scope.run(950, async () => {
        await Promise.resolve();
        new scope.Request('select 2', () => {});
      }),
    ]);

    expect(seen.sort((a, b) => a - b)).toEqual([125, 950]);
    timeoutSpy.mockRestore();
  });

  it('does not add a timeout outside a bounded operation', () => {
    const timeoutSpy = vi.spyOn(tedious.Request.prototype, 'setTimeout').mockImplementation(() => {});
    const scope = createRequestTimeoutScope(tedious.Request);

    new scope.Request('select 1', () => {});

    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });
});
