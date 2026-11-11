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

  it('saves a layout pick: a layout id, or none for the full sidebar', async () => {
    const db = await makeMigratedDb();
    expect(await saveUserPreferences(db, 'u1', { layout: 'none' })).toEqual({ layout: 'none' });
    expect(await saveUserPreferences(db, 'u1', { layout: '3f2b8c1e-0000-4000-8000-000000000001' })).toEqual({ layout: '3f2b8c1e-0000-4000-8000-000000000001' });
    expect(await saveUserPreferences(db, 'u1', { layout: null })).toEqual({});
    for (const layout of ['', 'has space', 'x'.repeat(101), '../x']) expect(userPreferencesPatchSchema.safeParse({ layout }).success).toBe(false);
    expect(parseStoredPreferences({ layout: 'none', theme: 'dark' })).toEqual({ layout: 'none', theme: 'dark' });
    expect(parseStoredPreferences({ layout: 42 })).toEqual({});
  });

  it('saves a language, and accepts only the ones studio has', async () => {
    const db = await makeMigratedDb();
    expect(await saveUserPreferences(db, 'u1', { language: 'fr' })).toEqual({ language: 'fr' });
    expect(await saveUserPreferences(db, 'u1', { language: null })).toEqual({});
    for (const language of ['en', 'fr', 'pt']) expect(userPreferencesPatchSchema.safeParse({ language }).success).toBe(true);
    for (const language of ['de', 'FR', 'fr-FR', '']) expect(userPreferencesPatchSchema.safeParse({ language }).success).toBe(false);
    expect(parseStoredPreferences({ language: 'pt', theme: 'dark' })).toEqual({ language: 'pt', theme: 'dark' });
    expect(parseStoredPreferences({ language: 'de' })).toEqual({});
  });

  it('refuses a key it does not know', () => {
    expect(userPreferencesPatchSchema.safeParse({ accent: 'red' }).success).toBe(false);
  });
});
