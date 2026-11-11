import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';

// Layer under test: the CLI functions over the real shared store on pg-mem. The app context and
// the audit recorder are faked.
const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@openldr/config')>(),
  loadConfig: vi.fn(() => ({ config: true })),
}));
vi.mock('@openldr/bootstrap', async () => ({
  ...await import('../../bootstrap/src/user-preferences'),
  createAppContext: mocks.createAppContext,
  recordAuditEvent: mocks.recordAuditEvent,
}));

import { parsePreferenceArg, runUserPreferencesSet, runUserPreferencesShow } from './user';
import { getUserPreferences } from '../../bootstrap/src/user-preferences';

describe('user preferences CLI', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  let out: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await makeMigratedDb();
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out.push(String(chunk)); return true; });
    mocks.createAppContext.mockResolvedValue({
      internalDb: db,
      users: { get: async (id: string) => (id === 'u1' ? { id: 'u1', username: 'amina' } : null) },
      close: async () => {},
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.destroy(); });

  it('turns command-line values into a patch', () => {
    expect(parsePreferenceArg('theme', 'dark')).toEqual({ theme: 'dark' });
    expect(parsePreferenceArg('sidebarCollapsed', 'true')).toEqual({ sidebarCollapsed: true });
    expect(parsePreferenceArg('startPage', '/reports')).toEqual({ startPage: '/reports' });
    expect(parsePreferenceArg('startPage', 'none')).toEqual({ startPage: null });
    expect(parsePreferenceArg('language', 'pt')).toEqual({ language: 'pt' });
    expect(parsePreferenceArg('language', 'none')).toEqual({ language: null });
    // `full` is the full sidebar; `none` clears the pick, as for every key, so the role default applies.
    expect(parsePreferenceArg('layout', 'full')).toEqual({ layout: 'full' });
    expect(parsePreferenceArg('layout', 'none')).toEqual({ layout: null });
  });

  it('refuses an unknown key or a bad value', () => {
    expect(() => parsePreferenceArg('accent', 'red')).toThrow(/unknown preference/);
    expect(() => parsePreferenceArg('theme', 'purple')).toThrow(/invalid value/);
    expect(() => parsePreferenceArg('sidebarCollapsed', 'yes')).toThrow(/invalid value/);
    expect(() => parsePreferenceArg('startPage', 'https://evil.test')).toThrow(/invalid value/);
    expect(() => parsePreferenceArg('language', 'de')).toThrow(/invalid value/);
  });

  it('sets a preference, audits it as the cli, and shows it', async () => {
    expect(await runUserPreferencesSet('u1', 'theme', 'dark', { json: false })).toBe(0);
    expect(await getUserPreferences(db, 'u1')).toEqual({ theme: 'dark' });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      { action: 'user.preferences.update', entityType: 'user', entityId: 'u1', metadata: { keys: ['theme'] } },
    );
    out.length = 0;
    expect(await runUserPreferencesShow('u1', { json: true })).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual({ theme: 'dark' });
  });

  it('fails for a user that does not exist and saves nothing', async () => {
    expect(await runUserPreferencesSet('ghost', 'theme', 'dark', { json: false })).toBe(1);
    expect(await getUserPreferences(db, 'ghost')).toEqual({});
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(await runUserPreferencesShow('ghost', { json: false })).toBe(1);
  });
});
