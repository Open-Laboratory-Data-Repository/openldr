import { describe, it, expect } from 'vitest';
import { renderUpdateCheck } from './update';
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

  it('emits the raw state as JSON when asked', () => {
    const { text } = renderUpdateCheck(state(), { json: true });
    expect(JSON.parse(text)).toMatchObject({ running: '0.1.1', latestVersion: '0.2.0' });
  });
});
