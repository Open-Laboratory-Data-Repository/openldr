import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRANT_CHECK_MS, watchGrant } from './serial-grant-watch';

type Listing = Array<{ id: string; version: string; devices?: { serial: boolean } }>;

function harness(o: { open?: boolean } = {}) {
  const state = { open: o.open ?? true, listing: [{ id: 'analyzer', version: '1.0.0', devices: { serial: true } }] as Listing, fail: false };
  let fetches = 0;
  let lost = 0;
  /** A fetch the test holds open, when set. */
  let hold: Promise<void> | null = null;
  const stop = watchGrant({
    pluginId: 'analyzer', version: '1.0.0',
    hasOpenPorts: () => state.open,
    fetchListing: async () => {
      fetches++;
      if (hold) await hold;
      if (state.fail) throw new Error('offline');
      return state.listing as never;
    },
    onLost: () => void lost++,
  });
  const minute = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(GRANT_CHECK_MS); };
  return { state, stop, minute, fetches: () => fetches, lost: () => lost, holdFetch: () => { let release = () => {}; hold = new Promise<void>((r) => { release = r; }); return () => { hold = null; release(); }; } };
}

describe('watchGrant', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('checks once a minute', () => {
    expect(GRANT_CHECK_MS).toBe(60_000);
  });

  it('asks nothing while no port is open', async () => {
    const h = harness({ open: false });
    await h.minute();
    await h.minute();
    expect(h.fetches()).toBe(0);
    h.stop();
  });

  it('asks once a minute while a port is open', async () => {
    const h = harness();
    expect(h.fetches()).toBe(0);
    await h.minute();
    expect(h.fetches()).toBe(1);
    await h.minute();
    await h.minute();
    expect(h.fetches()).toBe(3);
    expect(h.lost()).toBe(0);
    h.stop();
    await h.minute();
    expect(h.fetches()).toBe(3);
  });

  it('calls onLost when serial turned false, when the plugin is gone, and when the version changed', async () => {
    for (const listing of [
      [{ id: 'analyzer', version: '1.0.0', devices: { serial: false } }],
      [{ id: 'other', version: '1.0.0', devices: { serial: true } }],
      [{ id: 'analyzer', version: '1.1.0', devices: { serial: true } }],
      // An older server that sends no devices: no grant.
      [{ id: 'analyzer', version: '1.0.0' }],
      [],
    ] as Listing[]) {
      const h = harness();
      h.state.listing = listing;
      await h.minute();
      expect(h.lost(), JSON.stringify(listing)).toBe(1);
      h.stop();
    }
  });

  it('changes nothing when the fetch fails, and asks again a minute later', async () => {
    const h = harness();
    h.state.fail = true;
    await h.minute();
    expect(h.fetches()).toBe(1);
    expect(h.lost()).toBe(0);
    h.state.fail = false;
    h.state.listing = [];
    await h.minute();
    expect(h.fetches()).toBe(2);
    expect(h.lost()).toBe(1);
    h.stop();
  });

  it('ignores an answer that arrives after it was stopped', async () => {
    const h = harness();
    h.state.listing = [];
    const release = h.holdFetch();
    await h.minute();
    expect(h.fetches()).toBe(1);
    h.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lost()).toBe(0);
  });

  it('does not stack a second question on one that has not been answered', async () => {
    const h = harness();
    const release = h.holdFetch();
    await h.minute();
    await h.minute();
    expect(h.fetches()).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await h.minute();
    expect(h.fetches()).toBe(2);
    h.stop();
  });
});
