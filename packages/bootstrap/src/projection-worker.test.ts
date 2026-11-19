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

  it('one_tick_keeps_running_cycles_until_one_projects_nothing (item 16)', async () => {
    const answers = [3, 2, 0, 5];
    const runCycle = vi.fn(async () => answers.shift() ?? 0);
    const worker = createProjectionWorker({ runCycle, intervalMs: 60_000, logger: { info() {}, error() {} } });
    try {
      await worker.tickOnce();
      // 3, then 2, then 0 ends the tick. The 5 waits for the next tick.
      expect(runCycle).toHaveBeenCalledTimes(3);
      await worker.tickOnce();
      expect(runCycle).toHaveBeenCalledTimes(5);
    } finally {
      await worker.stop();
    }
  });

  it('a_stop_ends_the_catch_up_after_the_cycle_in_flight (item 16)', async () => {
    let calls = 0;
    let worker!: ReturnType<typeof createProjectionWorker>;
    const runCycle = vi.fn(async () => { calls += 1; if (calls === 2) void worker.stop(); return 1; });
    worker = createProjectionWorker({ runCycle, intervalMs: 60_000, logger: { info() {}, error() {} } });
    await worker.tickOnce();
    await worker.stop();
    expect(runCycle).toHaveBeenCalledTimes(2);
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
