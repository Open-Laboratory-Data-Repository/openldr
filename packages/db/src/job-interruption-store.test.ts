import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createJobInterruptionStore } from './job-interruption-store';

const AT1 = new Date('2026-11-18T05:00:00.000Z');
const AT2 = new Date('2026-11-18T05:10:00.000Z');

describe('createJobInterruptionStore', () => {
  it('records one cut once: the same job and time a second time inserts nothing', async () => {
    const store = createJobInterruptionStore(await makeMigratedDb());
    const first = await store.record('terminology-ingest', 'j1', { at: AT1, cause: 'server-restart', phase: 'concepts' });
    const again = await store.record('terminology-ingest', 'j1', { at: AT1, cause: 'server-restart', phase: 'concepts' });
    expect(first.inserted).toBe(true);
    expect(again).toEqual({ id: first.id, inserted: false });
    expect((await store.listFor('terminology-ingest', ['j1'])).get('j1')).toHaveLength(1);
  });

  it('lists records oldest first, by job, and only for the asked kind', async () => {
    const store = createJobInterruptionStore(await makeMigratedDb());
    await store.record('facility-job', 'a', { at: AT2, cause: 'server-restart', phase: null });
    await store.record('facility-job', 'a', { at: AT1, cause: 'lease-expired', phase: null });
    await store.record('facility-job', 'b', { at: AT1, cause: 'server-restart', phase: null });
    await store.record('ingest-batch', 'a', { at: AT1, cause: 'server-restart', phase: null });
    const map = await store.listFor('facility-job', ['a', 'b', 'c']);
    expect(map.get('a')!.map((r) => r.at)).toEqual([AT1.toISOString(), AT2.toISOString()]);
    expect(map.get('a')![0]).toMatchObject({ cause: 'lease-expired', phase: null, resumedAt: null, resumedBy: null, continuedAs: null });
    expect(map.get('b')).toHaveLength(1);
    expect(map.get('c')).toBeUndefined();
    expect((await store.listFor('facility-job', [])).size).toBe(0);
  });

  it('counts the cuts in a row as those in the same phase', async () => {
    const store = createJobInterruptionStore(await makeMigratedDb());
    await store.record('facility-import', 'r', { at: AT1, cause: 'server-restart', phase: 'validating' });
    await store.record('facility-import', 'r', { at: AT2, cause: 'server-restart', phase: 'applying' });
    expect(await store.inARow('facility-import', 'r', 'applying')).toBe(1);
    expect(await store.inARow('facility-import', 'r', 'validating')).toBe(1);
    expect(await store.inARow('facility-import', 'r', null)).toBe(0);
  });

  it('resolves a record with who brought the job back, when, and the new run', async () => {
    const store = createJobInterruptionStore(await makeMigratedDb());
    const { id } = await store.record('workflow-receipt', 'w', { at: AT1, cause: 'server-restart', phase: null });
    await store.resolve(id, { resumedBy: 'person', resumedAt: AT2, continuedAs: 'run-2' });
    expect((await store.listFor('workflow-receipt', ['w'])).get('w')![0]).toMatchObject({
      resumedBy: 'person', resumedAt: AT2.toISOString(), continuedAs: 'run-2',
    });
  });
});
