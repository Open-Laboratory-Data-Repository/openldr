import { describe, expect, it, vi } from 'vitest';
import { createProjectionWorker } from './projection-worker';
import { EventEmitter } from 'node:events';

describe('createProjectionWorker', () => {
  it('removes notifications and the timer when stopped', async () => {
    vi.useFakeTimers();
    const listenClient = Object.assign(new EventEmitter(), { query: vi.fn(async () => undefined) });
    const runCycle = vi.fn(async () => 0);
    const worker = createProjectionWorker({ runCycle, intervalMs: 20, listenClient: listenClient as never, logger: { info() {}, error() {} } });
    try {
      await vi.advanceTimersByTimeAsync(20);
      expect(runCycle).toHaveBeenCalledTimes(1);
      const stop = worker.stop();
      expect(worker.stop()).toBe(stop);
      await stop;
      listenClient.emit('notification');
      await vi.advanceTimersByTimeAsync(100);
      await worker.tickOnce();
      expect(runCycle).toHaveBeenCalledTimes(1);
      expect(listenClient.listenerCount('notification')).toBe(0);
      expect(listenClient.query.mock.calls).toHaveLength(2);
    } finally {
      await worker.stop();
      vi.useRealTimers();
    }
  });

  it('waits for a blocked cycle and rejects future dispatch after stop', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const runCycle = vi.fn(async () => { await blocked; return 0; });
    const worker = createProjectionWorker({ runCycle, intervalMs: 100_000, logger: { info() {}, error() {} } });
    const tick = worker.tickOnce();
    let stopped = false;
    const stop = worker.stop().then(() => { stopped = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stopped).toBe(false);
    } finally {
      release();
      await Promise.all([tick, stop, worker.stop()]);
    }
    await worker.tickOnce();
    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it('runs a cycle on tickOnce and stops cleanly', async () => {
    const runCycle = vi.fn().mockResolvedValue(0);
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {} } as never });
    await worker.tickOnce();
    expect(runCycle).toHaveBeenCalledTimes(1);
    await worker.stop();
  });

  it('a throwing cycle does not crash the worker', async () => {
    const runCycle = vi.fn().mockRejectedValue(new Error('boom'));
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {} } as never });
    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();
  });

  it('does not overlap cycles (a slow cycle blocks a concurrent tick)', async () => {
    let running = 0; let maxConcurrent = 0;
    const runCycle = vi.fn().mockImplementation(async () => {
      running++; maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20)); running--; return 0;
    });
    const worker = createProjectionWorker({ runCycle, intervalMs: 10_000, logger: { info() {}, error() {} } as never });
    await Promise.all([worker.tickOnce(), worker.tickOnce()]);
    expect(maxConcurrent).toBe(1);
    await worker.stop();
  });
});
