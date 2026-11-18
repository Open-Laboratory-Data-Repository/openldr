import { describe, it, expect, vi } from 'vitest';
import { createTerminologyIngestWorker } from './terminology-ingest-worker';

function job(over: Partial<any> = {}) {
  return { id: 'j1', systemType: 'loinc', codingSystemId: 'cs1', blobKey: 'terminology-dist/loinc/j1.zip', version: '2.82', status: 'running', phase: null, processed: 0, total: null, error: null, createdBy: 'admin1', createdAt: '', startedAt: '', finishedAt: null, ...over };
}

function deps(over: Partial<any> = {}) {
  const state: any = { finished: [], audited: [], deleted: [], progress: [] };
  const j = job();
  return {
    state,
    d: {
      jobs: {
        claimNext: vi.fn().mockResolvedValueOnce(j).mockResolvedValue(null),
        updateProgress: vi.fn(async (_id, p) => { state.progress.push(p); }),
        finish: vi.fn(async (id, s, e) => { state.finished.push({ id, s, e }); }),
        latestForSystem: vi.fn(async () => ({ id: 'j0', blobKey: 'terminology-dist/loinc/j0.zip', status: 'ready' })),
        latestReadyForSystem: vi.fn(async () => ({ id: 'j0', blobKey: 'terminology-dist/loinc/j0.zip', status: 'ready' })),
        get: vi.fn(), enqueue: vi.fn(), hasActive: vi.fn(),
        beat: vi.fn(async () => {}), listStaleRunning: vi.fn(async () => []), requeue: vi.fn(async () => true), markInterrupted: vi.fn(async () => {}),
      },
      blob: { getStream: vi.fn(), delete: vi.fn(async (k: string) => { state.deleted.push(k); }) },
      runIngest: vi.fn(async (_j, onP) => { onP({ phase: 'concepts', processed: 5, total: 5 }); return { conceptsLoaded: 5 }; }),
      audit: { record: vi.fn(async (e: any) => { state.audited.push(e); return { ...e, id: 'a', occurredAt: '' }; }) },
      workDirBase: '/tmp',
      logger: { info() {}, error() {} },
      ...over,
    },
  };
}

describe('terminology ingest worker', () => {
  it('claims a job, ingests, finishes ready, audits completed, deletes the prior blob', async () => {
    const { state, d } = deps();
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(d.runIngest).toHaveBeenCalledTimes(1);
    expect(state.finished).toEqual([{ id: 'j1', s: 'ready', e: null }]);
    expect(state.audited[0]).toMatchObject({ action: 'terminology.import.completed', actorType: 'system' });
    expect(state.deleted).toEqual(['terminology-dist/loinc/j0.zip']); // prior retained blob removed
    await w.stop();
  });

  it('on ingest failure: finishes failed, audits failed, keeps the blob', async () => {
    const { state, d } = deps({ runIngest: vi.fn(async () => { throw new Error('boom'); }) });
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(state.finished[0]).toMatchObject({ id: 'j1', s: 'failed' });
    expect(state.finished[0].e).toMatch(/boom/);
    expect(state.audited[0]).toMatchObject({ action: 'terminology.import.failed' });
    expect(state.deleted).toEqual([]); // blob retained for retry
    await w.stop();
  });

  it('does nothing when no job is queued', async () => {
    const { d } = deps({ jobs: { claimNext: vi.fn(async () => null), updateProgress: vi.fn(), finish: vi.fn(), latestForSystem: vi.fn(), latestReadyForSystem: vi.fn(), get: vi.fn(), enqueue: vi.fn(), hasActive: vi.fn(), beat: vi.fn(async () => {}), listStaleRunning: vi.fn(async () => []), requeue: vi.fn(), markInterrupted: vi.fn() } });
    const w = createTerminologyIngestWorker(d as never);
    await w.tickOnce();
    expect(d.runIngest).not.toHaveBeenCalled();
    await w.stop();
  });

  it('requeues a job whose heartbeat stopped and records the cut, before claiming', async () => {
    const { d } = deps();
    const at = new Date(Date.now() - 10 * 60_000);
    d.jobs.listStaleRunning = vi.fn(async () => [{ id: 'tij_dead', phase: 'concepts', at }]);
    const record = vi.fn(async () => ({ id: 'i1', inserted: true }));
    const resolve = vi.fn(async () => {});
    const store = { record, resolve, inARow: vi.fn(async () => 1), listFor: vi.fn() };
    const w = createTerminologyIngestWorker({ ...d, interruptions: { store, now: () => new Date() }, processStartedAt: new Date(Date.now() - 60_000) } as never);
    await w.tickOnce();
    expect(d.jobs.requeue).toHaveBeenCalledWith('tij_dead');
    expect(record).toHaveBeenCalledWith('terminology-ingest', 'tij_dead', { at, cause: 'server-restart', phase: 'concepts' });
    expect(resolve).toHaveBeenCalledWith('i1', expect.objectContaining({ resumedBy: 'self' }));
    await w.stop();
  });

  it('after too many cuts in one phase, leaves the job interrupted instead of requeueing it', async () => {
    const { d } = deps();
    d.jobs.listStaleRunning = vi.fn(async () => [{ id: 'tij_dead', phase: 'concepts', at: new Date(0) }]);
    const store = { record: vi.fn(async () => ({ id: 'i4', inserted: true })), resolve: vi.fn(), inARow: vi.fn(async () => 4), listFor: vi.fn() };
    const w = createTerminologyIngestWorker({ ...d, interruptions: { store, now: () => new Date() } } as never);
    await w.tickOnce();
    expect(d.jobs.requeue).not.toHaveBeenCalled();
    expect(d.jobs.markInterrupted).toHaveBeenCalledWith('tij_dead', expect.stringMatching(/Continue/));
    await w.stop();
  });
});
