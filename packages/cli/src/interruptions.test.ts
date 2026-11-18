import { describe, it, expect, vi } from 'vitest';
import type { JobInterruption } from '@openldr/db';
import { describeInterruption, withCdrCuts } from './interruptions';

const cut = (over: Partial<JobInterruption> = {}): JobInterruption => ({
  id: 'i1', at: '2026-11-18T05:00:00.000Z', cause: 'server-restart', phase: null,
  resumedAt: '2026-11-18T05:02:00.000Z', resumedBy: 'self', continuedAs: null, ...over,
});

describe('describeInterruption', () => {
  it('says when, why, and how the job came back', () => {
    expect(describeInterruption(cut())).toBe('  interrupted 2026-11-18T05:00:00.000Z (the server restarted); carried on by itself 2026-11-18T05:02:00.000Z');
    expect(describeInterruption(cut({ resumedBy: 'person', continuedAs: 'run-2' }))).toMatch(/continued by a person .* as run-2$/);
    expect(describeInterruption(cut({ resumedBy: null, resumedAt: null, cause: 'lease-expired' }))).toBe('  interrupted 2026-11-18T05:00:00.000Z (it stopped answering); waiting for Continue');
  });
});

describe('withCdrCuts', () => {
  it('adds each run\'s cuts to the JSON and a line per cut under its text', async () => {
    const listFor = vi.fn(async () => new Map([['r1', [cut()]]]));
    const shown = await withCdrCuts({ listFor }, [{ id: 'r1' }, { id: 'r2' }], (r) => ({ id: r.id }), (r) => `run ${r.id}`);
    expect(listFor).toHaveBeenCalledWith('cdr-run', ['r1', 'r2']);
    expect(shown.json).toEqual([{ id: 'r1', interruptions: [cut()] }, { id: 'r2', interruptions: [] }]);
    expect(shown.text.split('\n')).toEqual(['run r1', describeInterruption(cut()), 'run r2']);
  });

  it('without a store, shows the runs with no cuts', async () => {
    const shown = await withCdrCuts(undefined, [{ id: 'r1' }], (r) => r, (r) => `run ${r.id}`);
    expect(shown).toEqual({ json: [{ id: 'r1', interruptions: [] }], text: 'run r1' });
  });
});
