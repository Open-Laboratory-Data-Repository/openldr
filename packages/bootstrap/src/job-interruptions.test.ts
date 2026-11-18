import { describe, it, expect, vi } from 'vitest';
import { createJobInterruptionStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { takeBack, continueJob, sweepStale, startHeartbeat, recordSelfResume, MAX_SELF_RESUMES, STALE_JOB_MS } from './job-interruptions';

const NOW = new Date('2026-11-18T06:00:00.000Z');
const at = (min: number) => new Date(Date.UTC(2026, 10, 18, 5, min));

async function setup() {
  const store = createJobInterruptionStore(await makeMigratedDb());
  return { store, deps: { store, now: () => NOW } };
}
const cut = (over: Partial<Parameters<typeof takeBack>[1]> = {}) => ({
  kind: 'terminology-ingest' as const, jobId: 'j1', phase: 'concepts', at: at(0), cause: 'server-restart' as const,
  selfResume: true, resume: vi.fn(async () => {}), wait: vi.fn(async () => {}), ...over,
});

describe('takeBack', () => {
  it('a first cut carries on by itself and is recorded as such', async () => {
    const { store, deps } = await setup();
    const input = cut();
    expect(await takeBack(deps, input)).toBe('resumed');
    expect(input.resume).toHaveBeenCalledTimes(1);
    expect(input.wait).not.toHaveBeenCalled();
    expect((await store.listFor('terminology-ingest', ['j1'])).get('j1')![0]).toMatchObject({ resumedBy: 'self', resumedAt: NOW.toISOString() });
  });

  it(`stops carrying on after ${MAX_SELF_RESUMES} cuts in the same phase, and waits for Continue`, async () => {
    const { store, deps } = await setup();
    for (let i = 0; i < MAX_SELF_RESUMES; i += 1) expect(await takeBack(deps, cut({ at: at(i) }))).toBe('resumed');
    const fourth = cut({ at: at(9) });
    expect(await takeBack(deps, fourth)).toBe('waiting');
    expect(fourth.resume).not.toHaveBeenCalled();
    expect(fourth.wait).toHaveBeenCalledTimes(1);
    expect((await store.listFor('terminology-ingest', ['j1'])).get('j1')!.at(-1)).toMatchObject({ resumedBy: null, resumedAt: null });
  });

  it('a job that must not run again by itself always waits, and its record stays open', async () => {
    const { store, deps } = await setup();
    const input = cut({ kind: 'workflow-receipt', selfResume: false });
    expect(await takeBack(deps, input)).toBe('waiting');
    expect(input.resume).not.toHaveBeenCalled();
    expect((await store.listFor('workflow-receipt', ['j1'])).get('j1')![0].resumedBy).toBeNull();
  });

  it('the same cut met twice is recorded once and nothing runs the second time', async () => {
    const { store, deps } = await setup();
    await takeBack(deps, cut());
    const again = cut();
    expect(await takeBack(deps, again)).toBe('already-recorded');
    expect(again.resume).not.toHaveBeenCalled();
    expect(again.wait).not.toHaveBeenCalled();
    expect((await store.listFor('terminology-ingest', ['j1'])).get('j1')).toHaveLength(1);
  });
});

describe('takeBack after a take-back that did not finish (review R1)', () => {
  it('tries the resume again when the cut is recorded but was never resolved', async () => {
    const { store, deps } = await setup();
    const failing = cut({ resume: vi.fn(async () => { throw new Error('connection lost'); }) });
    await expect(takeBack(deps, failing)).rejects.toThrow('connection lost');
    const again = cut();
    expect(await takeBack(deps, again)).toBe('resumed');
    expect(again.resume).toHaveBeenCalledTimes(1);
    expect((await store.listFor('terminology-ingest', ['j1'])).get('j1')).toEqual([
      expect.objectContaining({ resumedBy: 'self' }),
    ]);
  });

  it('does not resume again a cut that was already resolved', async () => {
    const { deps } = await setup();
    await takeBack(deps, cut());
    const again = cut();
    expect(await takeBack(deps, again)).toBe('already-recorded');
    expect(again.resume).not.toHaveBeenCalled();
  });
});

describe('continueJob', () => {
  it('records a person brought the job back, and the new run when there is one', async () => {
    const { store, deps } = await setup();
    await takeBack(deps, cut({ kind: 'workflow-receipt', selfResume: false }));
    const [rec] = (await store.listFor('workflow-receipt', ['j1'])).get('j1')!;
    const start = vi.fn(async () => 'run-2');
    await continueJob(deps, { kind: 'workflow-receipt', jobId: 'j1', interruptionId: rec!.id, start });
    expect(start).toHaveBeenCalledTimes(1);
    expect((await store.listFor('workflow-receipt', ['j1'])).get('j1')![0]).toMatchObject({ resumedBy: 'person', resumedAt: NOW.toISOString(), continuedAs: 'run-2' });
  });
});

describe('sweepStale', () => {
  it('takes back every job silent for longer than STALE_JOB_MS, naming a restart when it went silent before this process', async () => {
    const { store, deps } = await setup();
    const processStartedAt = new Date(NOW.getTime() - 10 * 60_000);
    const listStale = vi.fn(async (olderThan: Date) => {
      expect(olderThan.getTime()).toBe(NOW.getTime() - STALE_JOB_MS);
      return [
        { id: 'old', phase: null, at: new Date(processStartedAt.getTime() - 1000) },
        { id: 'new', phase: null, at: new Date(NOW.getTime() - STALE_JOB_MS - 1) },
      ];
    });
    const resume = vi.fn(async (_id: string) => {});
    const n = await sweepStale(deps, { kind: 'facility-job', processStartedAt, selfResume: true, listStale, resume, wait: vi.fn(async () => {}) });
    expect(n).toBe(2);
    expect(resume.mock.calls.map((c) => c[0])).toEqual(['old', 'new']);
    const map = await store.listFor('facility-job', ['old', 'new']);
    expect(map.get('old')![0].cause).toBe('server-restart');
    expect(map.get('new')![0].cause).toBe('lease-expired');
  });
});

describe('startHeartbeat', () => {
  it('beats on the interval until stopped', async () => {
    vi.useFakeTimers();
    const beat = vi.fn(async () => {});
    const stop = startHeartbeat(beat, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(beat).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

describe('recordSelfResume', () => {
  it('records a cut a job carried on through by itself, once, and never throws', async () => {
    const { store, deps } = await setup();
    const processStartedAt = new Date(NOW.getTime() - 60_000);
    await recordSelfResume({ ...deps, processStartedAt }, 'cdr-run', 'run1', at(0));
    await recordSelfResume({ ...deps, processStartedAt }, 'cdr-run', 'run1', at(0));
    expect((await store.listFor('cdr-run', ['run1'])).get('run1')).toEqual([
      expect.objectContaining({ cause: 'server-restart', resumedBy: 'self', resumedAt: NOW.toISOString() }),
    ]);
    const broken = { store: { ...store, record: async () => { throw new Error('db down'); } }, now: () => NOW, processStartedAt };
    await expect(recordSelfResume(broken, 'cdr-run', 'run2', at(1))).resolves.toBeUndefined();
    await expect(recordSelfResume(undefined, 'cdr-run', 'run3', at(1))).resolves.toBeUndefined();
  });
});
