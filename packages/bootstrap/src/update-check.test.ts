import { describe, it, expect, vi } from 'vitest';
import { createUpdateCheck, decideUpdate, UPDATE_KEYS } from './update-check';
import type { AppSettingStore } from '@openldr/db';

function fakeStore(initial: Record<string, string> = {}): AppSettingStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (k: string) => (k in data ? { key: k, value: data[k]!, updatedAt: new Date(), updatedBy: null } : null)),
    getAll: vi.fn(async () => []),
    set: vi.fn(async (k: string, v: string) => { data[k] = v; }),
  } as unknown as AppSettingStore & { data: Record<string, string> };
}

const cached = (over: Partial<{ version: string|null; releasedAt: string|null; notesUrl: string|null; firstSeenAt: string|null }> = {}) => ({
  version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z', ...over,
});

describe('decideUpdate', () => {
  it('reports an update when the published version is newer', () => {
    const s = decideUpdate({ enabled: true, running: '0.1.1', cached: cached(), lastCheckedAt: null, lastError: null });
    expect(s.updateAvailable).toBe(true);
    expect(s.latestVersion).toBe('0.2.0');
  });

  it('reports none when the running version equals the published one', () => {
    expect(decideUpdate({ enabled: true, running: '0.2.0', cached: cached(), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  it('reports none when the running version is ahead — a dev build must not be told to downgrade', () => {
    expect(decideUpdate({ enabled: true, running: '0.3.0', cached: cached(), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  // Never announce an update you could not verify.
  it('reports none when the cached version is unparseable', () => {
    expect(decideUpdate({ enabled: true, running: '0.1.1', cached: cached({ version: 'latest' }), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  it('reports none when the running version is unparseable', () => {
    expect(decideUpdate({ enabled: true, running: 'dev', cached: cached(), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  it('reports none when nothing is cached yet', () => {
    expect(decideUpdate({ enabled: true, running: '0.1.1', cached: cached({ version: null }), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  // The switch suppresses the ANSWER, not just the polling — an operator who turned it off
  // must not still see a banner from a stale cache.
  it('reports none when the check is disabled, even with a newer version cached', () => {
    const s = decideUpdate({ enabled: false, running: '0.1.1', cached: cached(), lastCheckedAt: null, lastError: null });
    expect(s.updateAvailable).toBe(false);
    expect(s.enabled).toBe(false);
  });

  it('passes through lastCheckedAt and lastError so the UI can say "never checked"', () => {
    const s = decideUpdate({ enabled: true, running: '0.1.1', cached: cached(), lastCheckedAt: '2026-08-21T00:00:00.000Z', lastError: 'getaddrinfo ENOTFOUND' });
    expect(s.lastCheckedAt).toBe('2026-08-21T00:00:00.000Z');
    expect(s.lastError).toBe('getaddrinfo ENOTFOUND');
  });
});

describe('createUpdateCheck', () => {
  it('defaults to enabled when the key is absent', async () => {
    const s = await createUpdateCheck(fakeStore()).read('0.1.1');
    expect(s.enabled).toBe(true);
  });

  it('treats only the exact string "false" as off', async () => {
    expect((await createUpdateCheck(fakeStore({ [UPDATE_KEYS.enabled]: 'false' })).read('0.1.1')).enabled).toBe(false);
    expect((await createUpdateCheck(fakeStore({ [UPDATE_KEYS.enabled]: 'true' })).read('0.1.1')).enabled).toBe(true);
    expect((await createUpdateCheck(fakeStore({ [UPDATE_KEYS.enabled]: 'nonsense' })).read('0.1.1')).enabled).toBe(true);
  });

  it('setEnabled writes the flag', async () => {
    const store = fakeStore();
    await createUpdateCheck(store).setEnabled(false, 'admin');
    expect(store.data[UPDATE_KEYS.enabled]).toBe('false');
  });

  // firstSeenAt is what keeps the bell dismissible. It must not move on a repeat sighting.
  it('record sets firstSeenAt on a new version and does NOT move it on a repeat', async () => {
    const store = fakeStore();
    const uc = createUpdateCheck(store);
    const m = { version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'https://example.org/x' };
    await uc.record(m, '2026-08-20T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.firstSeenAt]).toBe('2026-08-20T10:00:00.000Z');
    await uc.record(m, '2026-08-25T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.firstSeenAt]).toBe('2026-08-20T10:00:00.000Z');
  });

  it('record moves firstSeenAt when the version changes', async () => {
    const store = fakeStore();
    const uc = createUpdateCheck(store);
    await uc.record({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'u' }, '2026-08-20T10:00:00.000Z');
    await uc.record({ version: '0.3.0', releasedAt: '2026-09-01', notesUrl: 'u2' }, '2026-09-01T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.firstSeenAt]).toBe('2026-09-01T10:00:00.000Z');
  });

  it('record clears a previous error', async () => {
    const store = fakeStore({ [UPDATE_KEYS.lastError]: 'boom' });
    await createUpdateCheck(store).record({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'u' }, '2026-08-20T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.lastError]).toBe('');
  });

  // A failed fetch must never discard a good answer — an air-gapped lab keeps what it knew.
  it('recordFailure keeps the cached version and records the error', async () => {
    const store = fakeStore();
    const uc = createUpdateCheck(store);
    await uc.record({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'u' }, '2026-08-20T10:00:00.000Z');
    await uc.recordFailure('getaddrinfo ENOTFOUND', '2026-08-26T10:00:00.000Z');
    const s = await uc.read('0.1.1');
    expect(s.latestVersion).toBe('0.2.0');
    expect(s.updateAvailable).toBe(true);
    expect(s.lastError).toBe('getaddrinfo ENOTFOUND');
    expect(s.lastCheckedAt).toBe('2026-08-26T10:00:00.000Z');
  });
});
