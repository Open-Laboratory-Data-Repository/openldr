import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ createAppContext: vi.fn(), loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('@openldr/config', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: mocks.createAppContext }));

import { renderUpdateCheck, runUpdateCheck, UPDATE_ERROR_EXIT } from './update';
import type { UpdateState } from '@openldr/bootstrap';

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
  notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
  lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true, ...over,
});

describe('renderUpdateCheck', () => {
  it('names both versions and the two commands when an update exists', () => {
    const { text, code } = renderUpdateCheck(state(), { json: false });
    expect(text).toMatch(/0\.1\.1/);
    expect(text).toMatch(/0\.2\.0/);
    expect(text).toMatch(/docker compose pull/);
    expect(text).toMatch(/docker compose up -d/);
    expect(code).toBe(1);
  });

  it('exits 0 and shows no commands when current', () => {
    const { text, code } = renderUpdateCheck(state({ running: '0.2.0', updateAvailable: false }), { json: false });
    expect(code).toBe(0);
    expect(text).not.toMatch(/docker compose pull/);
  });

  it('says so when the check is disabled, and exits 0', () => {
    const { text, code } = renderUpdateCheck(state({ enabled: false, updateAvailable: false }), { json: false });
    expect(text).toMatch(/disabled/i);
    expect(code).toBe(0);
  });

  it('reports a failed check rather than implying the install is current', () => {
    const { text } = renderUpdateCheck(state({ updateAvailable: false, latestVersion: null, lastError: 'ENOTFOUND' }), { json: false });
    expect(text).toMatch(/ENOTFOUND/);
  });

  // A lab behind a filtering proxy keeps its stale cache. If that cache happens to name the
  // running version, the old code printed the failure AND "this install is up to date."
  it('does not also claim the install is up to date when the check failed', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: '0.2.0', updateAvailable: false, lastError: 'update check timed out after 10000ms' }),
      { json: false },
    );
    expect(text).toMatch(/last check failed/);
    expect(text).not.toMatch(/up to date/);
    expect(code).toBe(0);
  });

  it('still says up to date when the last check succeeded', () => {
    const { text } = renderUpdateCheck(state({ running: '0.2.0', updateAvailable: false }), { json: false });
    expect(text).toMatch(/up to date/);
  });

  it('emits the raw state as JSON when asked', () => {
    const { text } = renderUpdateCheck(state(), { json: true });
    expect(JSON.parse(text)).toMatchObject({ running: '0.1.1', latestVersion: '0.2.0' });
  });
});

describe('runUpdateCheck exit codes', () => {
  let out: ReturnType<typeof vi.fn>;
  let err: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
  });
  afterEach(() => { out.mockRestore(); err.mockRestore(); });

  // ⛔ The whole point of 2: exit 1 already means "an update is available", and settings.md tells
  // operators to act on it. A database that is down must not fire an upgrade script.
  it('exits 2 — not 1 — when the check itself cannot run', async () => {
    mocks.createAppContext.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    await expect(runUpdateCheck({ json: false })).resolves.toBe(UPDATE_ERROR_EXIT);
    expect(UPDATE_ERROR_EXIT).toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/update check failed:/));
  });

  it('exits 2 when reading the cached state throws, and still closes the context', async () => {
    const close = vi.fn();
    mocks.createAppContext.mockResolvedValueOnce({
      close, updateCheck: { read: vi.fn().mockRejectedValue(new Error('app_settings unavailable')) },
    });
    await expect(runUpdateCheck({ json: true })).resolves.toBe(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(JSON.parse((out.mock.calls.at(-1) as unknown as string[])[0])).toMatchObject({ error: expect.stringMatching(/app_settings unavailable/) });
  });

  it('exits 1 and closes the context when an update is available', async () => {
    const close = vi.fn();
    mocks.createAppContext.mockResolvedValueOnce({
      close, updateCheck: { read: vi.fn().mockResolvedValue(state()) },
    });
    await expect(runUpdateCheck({ json: false })).resolves.toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
