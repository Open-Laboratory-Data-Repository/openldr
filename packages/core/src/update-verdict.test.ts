import { describe, it, expect } from 'vitest';
import { updateVerdict, BAD_RUNNING_VERSION } from './update-verdict';

/** Every field the function reads. Tests override only what they are about. */
const input = (over: Partial<Parameters<typeof updateVerdict>[0]> = {}) => ({
  enabled: true,
  running: '0.1.3',
  latestVersion: '0.1.3',
  releasedAt: '2026-08-19',
  notesUrl: 'https://example.org/v0.1.3',
  lastError: null,
  ...over,
});

describe('updateVerdict', () => {
  it('reports up_to_date when the published version matches', () => {
    expect(updateVerdict(input())).toEqual({ kind: 'up_to_date', latest: '0.1.3' });
  });

  it('reports update_available and carries the notes through', () => {
    expect(updateVerdict(input({ running: '0.1.2' }))).toEqual({
      kind: 'update_available',
      latest: '0.1.3',
      releasedAt: '2026-08-19',
      notesUrl: 'https://example.org/v0.1.3',
    });
  });

  it('reports never_checked when nothing has been cached and nothing failed', () => {
    expect(updateVerdict(input({ latestVersion: null }))).toEqual({ kind: 'never_checked' });
  });

  // Precedence 1. The switch suppresses the ANSWER, not just the polling. An operator who turned
  // it off must not be shown a verdict computed from a cache written before they did.
  it('reports check_off even when the cache holds something newer', () => {
    expect(updateVerdict(input({ enabled: false, running: '0.1.2' }))).toEqual({ kind: 'check_off' });
  });

  // Precedence 3 over 4. Today's fetch failing does not make yesterday's answer wrong.
  it('still reports update_available when the last check failed', () => {
    const v = updateVerdict(input({ running: '0.1.2', lastError: 'HTTP 404' }));
    expect(v.kind).toBe('update_available');
  });

  // Precedence 4. A stale cache naming the running version must not read as confirmed.
  it('reports cannot_confirm when the cache matches but the last check failed', () => {
    expect(updateVerdict(input({ lastError: 'HTTP 404' }))).toEqual({
      kind: 'cannot_confirm', error: 'HTTP 404', cause: 'check_failed',
    });
  });

  it('reports cannot_confirm rather than never_checked when there is an error and no cache', () => {
    expect(updateVerdict(input({ latestVersion: null, lastError: 'ENOTFOUND' }))).toEqual({
      kind: 'cannot_confirm', error: 'ENOTFOUND', cause: 'check_failed',
    });
  });

  // ⛔ The trap this whole step exists for. isNewerVersion returns false when EITHER side is
  // unparseable, so without precedence 2 this falls through to up_to_date and the card claims to
  // be current on a version it cannot read.
  it('reports cannot_confirm when the running version is not a version', () => {
    expect(updateVerdict(input({ running: 'dev' }))).toEqual({
      kind: 'cannot_confirm', error: BAD_RUNNING_VERSION, cause: 'bad_running_version',
    });
  });

  it('flags a bad running version with a null lastError, not a copied one', () => {
    const v = updateVerdict(input({ running: 'dev', lastError: null }));
    expect(v).toMatchObject({ cause: 'bad_running_version' });
    expect(v.kind === 'cannot_confirm' && v.error).toBe(BAD_RUNNING_VERSION);
  });
});

describe('updateVerdict: cache older than the running version', () => {
  const input = (over = {}) => ({
    enabled: true, running: '0.1.4', latestVersion: '0.1.3',
    releasedAt: '2026-08-19', notesUrl: 'https://example.org/x', lastError: null, ...over,
  });

  // ⛔ toEqual with no second key is the point of this test. An operator read "published: 0.1.5"
  // under "running: 0.1.6" as an instruction to roll back. The number carries no action either
  // way, so this kind carries NO version and no surface can print one. Reintroducing a field here
  // means deleting this assertion, which is the intended speed bump.
  it('carries no version at all when the cache is behind', () => {
    expect(updateVerdict(input())).toEqual({ kind: 'no_update_found' });
  });

  it('still reports up_to_date, with the number, when the cache matches', () => {
    expect(updateVerdict(input({ latestVersion: '0.1.4' }))).toEqual({
      kind: 'up_to_date', latest: '0.1.4',
    });
  });

  // The split must not change WHICH verdict fires for a genuine update.
  it('still reports update_available when the cache is genuinely newer', () => {
    expect(updateVerdict(input({ running: '0.1.2' })).kind).toBe('update_available');
  });

  // Precedence: the no_update_found check sits ABOVE the up_to_date fallthrough, but BELOW the
  // error check, so a stale cache under a live error is still cannot_confirm, not no_update_found.
  it('reports cannot_confirm, not no_update_found, when the last check failed', () => {
    expect(updateVerdict(input({ lastError: 'HTTP 404' })).kind).toBe('cannot_confirm');
  });
});
