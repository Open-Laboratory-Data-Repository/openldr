import { describe, it, expect, vi } from 'vitest';
import { createJobInterruptionStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { takeBack, continueJob, MAX_SELF_RESUMES } from './job-interruptions';

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
