import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';
import {
  getUserPreferences, parseStoredPreferences, saveUserPreferences, userPreferencesPatchSchema,
} from './user-preferences';

describe('user preferences', () => {
  it('is empty for a user who never saved any', async () => {
    const db = await makeMigratedDb();
    try {
      expect(await getUserPreferences(db, 'u1')).toEqual({});
    } finally { await db.destroy(); }
  });

  it('merges patches, and null clears one key', async () => {
    const db = await makeMigratedDb();
    try {
      expect(await saveUserPreferences(db, 'u1', { theme: 'dark' })).toEqual({ theme: 'dark' });
      expect(await saveUserPreferences(db, 'u1', { sidebarCollapsed: true, startPage: '/reports' }))
        .toEqual({ theme: 'dark', sidebarCollapsed: true, startPage: '/reports' });
      expect(await saveUserPreferences(db, 'u1', { startPage: null })).toEqual({ theme: 'dark', sidebarCollapsed: true });
      expect(await getUserPreferences(db, 'u1')).toEqual({ theme: 'dark', sidebarCollapsed: true });
    } finally { await db.destroy(); }
  });

  it('keeps each user in their own row', async () => {
    const db = await makeMigratedDb();
    try {
      await saveUserPreferences(db, 'u1', { theme: 'dark' });
      await saveUserPreferences(db, 'u2', { theme: 'light' });
      expect(await getUserPreferences(db, 'u1')).toEqual({ theme: 'dark' });
      expect(await getUserPreferences(db, 'u2')).toEqual({ theme: 'light' });
    } finally { await db.destroy(); }
  });

  it('drops junk in a stored row instead of failing', () => {
    expect(parseStoredPreferences({ theme: 'purple', sidebarCollapsed: 'yes', startPage: '//evil.test', extra: 1 })).toEqual({});
    expect(parseStoredPreferences({ theme: 'light', startPage: '/query', extra: 1 })).toEqual({ theme: 'light', startPage: '/query' });
    expect(parseStoredPreferences(null)).toEqual({});
    expect(parseStoredPreferences('{"theme":"dark"}')).toEqual({ theme: 'dark' });
  });

  it.each(['//evil.test', 'https://evil.test', 'reports', '/a b', `/${'x'.repeat(200)}`])('refuses the start page %s', (startPage) => {
    expect(userPreferencesPatchSchema.safeParse({ startPage }).success).toBe(false);
  });

  it.each(['/', '/reports', '/settings/connectors', '/x/dhis2-sink'])('accepts the start page %s', (startPage) => {
    expect(userPreferencesPatchSchema.safeParse({ startPage }).success).toBe(true);
  });

  it('refuses a key it does not know', () => {
    expect(userPreferencesPatchSchema.safeParse({ accent: 'red' }).success).toBe(false);
  });
});
