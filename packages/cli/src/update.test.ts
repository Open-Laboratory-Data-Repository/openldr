import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ createAppContext: vi.fn(), loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('@openldr/config', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: mocks.createAppContext }));

import { renderUpdateCheck, runUpdateCheck, runningVersion, UPDATE_ERROR_EXIT } from './update';
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

  // The regression this guards: recordFailure (bootstrap/update-check.ts) leaves latestVersion
  // untouched, so a cache from last week's good check plus today's failed poll produces
  // update_available with a real error underneath it. Both must show.
  it('shows the failure line alongside the upgrade commands when an update is available and the last check failed', () => {
    const { text, code } = renderUpdateCheck(
      state({ lastError: 'update check timed out after 10000ms' }),
      { json: false },
    );
    expect(text).toMatch(/docker compose pull/);
    expect(text).toMatch(/docker compose up -d/);
    expect(text).toMatch(/last check failed: update check timed out after 10000ms/);
    expect(code).toBe(1);
  });

  it('emits the raw state as JSON when asked', () => {
    const { text } = renderUpdateCheck(state(), { json: true });
    expect(JSON.parse(text)).toMatchObject({ running: '0.1.1', latestVersion: '0.2.0' });
  });

  it('says it cannot confirm when the cache matches but the check failed', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: '0.2.0', updateAvailable: false, lastError: 'HTTP 404' }),
      { json: false },
    );
    expect(text).toMatch(/last check failed: HTTP 404/);
    expect(text).toMatch(/cannot confirm this is the latest/);
    expect(code).toBe(0);
  });

  it('says not checked yet rather than stopping at "published: unknown"', () => {
    const { text, code } = renderUpdateCheck(
      state({ updateAvailable: false, latestVersion: null, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/published: unknown/);
    expect(text).toMatch(/not checked yet/);
    expect(code).toBe(0);
  });

  // ⛔ There was no check failure here. Printing "last check failed: unrecognised running
  // version" would send the operator to look at the network.
  it('prints no failure line when the running version is the thing that is wrong', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: 'dev', updateAvailable: false, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/cannot confirm this is the latest/);
    expect(text).not.toMatch(/last check failed/);
    expect(code).toBe(0);
  });

  it('includes the verdict in JSON without dropping any existing field', () => {
    const parsed = JSON.parse(renderUpdateCheck(state(), { json: true }).text);
    expect(parsed).toMatchObject({ running: '0.1.1', latestVersion: '0.2.0', updateAvailable: true });
    expect(parsed.verdict).toMatchObject({ kind: 'update_available', latest: '0.2.0' });
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

describe('runningVersion', () => {
  afterEach(() => { delete process.env.APP_VERSION; });

  it('prefers APP_VERSION over any package.json it can find', () => {
    process.env.APP_VERSION = '9.9.9-test';
    expect(runningVersion()).toBe('9.9.9-test');
  });

  // Inside the image the walk lands on @openldr/cli's own package.json, which is NOT the release.
  // Without the env override this reported 0.1.2 on an install the server called 0.1.0.
  it('falls back to a walked-up package.json when APP_VERSION is unset', () => {
    delete process.env.APP_VERSION;
    expect(runningVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('ignores an empty APP_VERSION rather than reporting an empty version', () => {
    process.env.APP_VERSION = '';
    expect(runningVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('renderUpdateCheck — running ahead of the cached release', () => {
  // Measured on a real 0.1.4 install: it polled 18 seconds before v0.1.4 was published, cached
  // 0.1.3, and then printed "published: 0.1.3 / this install is up to date", which reads backwards.
  it('says the install is newer than the last release it saw, and still exits 0', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: '0.1.4', latestVersion: '0.1.3', updateAvailable: false, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/newer than the last release it saw/);
    expect(text).not.toMatch(/this install is up to date/);
    expect(code).toBe(0);
  });

  it('keeps the plain wording when the cache matches the running version', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: '0.1.4', latestVersion: '0.1.4', updateAvailable: false, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/this install is up to date/);
    expect(text).not.toMatch(/newer than the last release/);
    expect(code).toBe(0);
  });
});
