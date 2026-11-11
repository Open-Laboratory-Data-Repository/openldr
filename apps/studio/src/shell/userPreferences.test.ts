import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getMyPreferences: vi.fn(), saveMyPreferences: vi.fn() };
});
import * as api from '@/api';
import {
  getUserPreferencesState, loadUserPreferences, markStartPageUsed, noteEntryPath,
  resetUserPreferencesForTest, setUserPreference, startPageUsed,
} from './userPreferences';

beforeEach(() => {
  vi.clearAllMocks();
  resetUserPreferencesForTest();
  (api.saveMyPreferences as any).mockResolvedValue({});
});

describe('user preferences store', () => {
  it('starts unloaded and empty', () => {
    expect(getUserPreferencesState()).toEqual({ loaded: false, prefs: {} });
  });

  it('loads the saved preferences', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ theme: 'dark', startPage: '/reports' });
    await loadUserPreferences();
    expect(getUserPreferencesState()).toEqual({ loaded: true, prefs: { theme: 'dark', startPage: '/reports' } });
  });

  it('counts as loaded when the request fails, and then saves nothing', async () => {
    (api.getMyPreferences as any).mockRejectedValue(new Error('offline'));
    await loadUserPreferences();
    expect(getUserPreferencesState()).toEqual({ loaded: true, prefs: {} });
    expect(await setUserPreference({ theme: 'dark' })).toBe(false);
    expect(api.saveMyPreferences).not.toHaveBeenCalled();
    expect(getUserPreferencesState().prefs).toEqual({});
  });

  it('does not save before the first load', async () => {
    expect(await setUserPreference({ theme: 'dark' })).toBe(false);
    expect(api.saveMyPreferences).not.toHaveBeenCalled();
  });

  it('updates at once and saves the patch after a load', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ theme: 'dark' });
    await loadUserPreferences();
    const saving = setUserPreference({ sidebarCollapsed: true });
    expect(getUserPreferencesState().prefs).toEqual({ theme: 'dark', sidebarCollapsed: true });
    expect(await saving).toBe(true);
    expect(api.saveMyPreferences).toHaveBeenCalledWith({ sidebarCollapsed: true });
  });

  it('clears a key with null', async () => {
    (api.getMyPreferences as any).mockResolvedValue({ startPage: '/reports' });
    await loadUserPreferences();
    await setUserPreference({ startPage: null });
    expect(getUserPreferencesState().prefs).toEqual({});
    expect(api.saveMyPreferences).toHaveBeenCalledWith({ startPage: null });
  });

  it('reports a failed save', async () => {
    (api.getMyPreferences as any).mockResolvedValue({});
    await loadUserPreferences();
    (api.saveMyPreferences as any).mockRejectedValue(new Error('500'));
    expect(await setUserPreference({ theme: 'light' })).toBe(false);
  });

  it('uses up the first-page choice on a deep link, but not on / or the sign-in callback', () => {
    noteEntryPath('/');
    expect(startPageUsed()).toBe(false);
    noteEntryPath('/auth/callback');
    expect(startPageUsed()).toBe(false);
    noteEntryPath('/query');
    expect(startPageUsed()).toBe(true);
    resetUserPreferencesForTest();
    markStartPageUsed();
    expect(startPageUsed()).toBe(true);
  });
});
