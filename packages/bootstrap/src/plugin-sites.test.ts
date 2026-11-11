import { describe, expect, it } from 'vitest';
import type { AppSettingRecord, AppSettingStore } from '@openldr/db';
import { SITES_OFF_KEY, getSitesOff, setSiteOn, visibleSites } from './plugin-sites';

function fakeStore(initial: Record<string, string> = {}): AppSettingStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key: string): Promise<AppSettingRecord | null> {
      const value = data.get(key);
      return value == null ? null : { key, value, updatedAt: new Date(0), updatedBy: null };
    },
    async getAll() {
      return [...data.entries()].map(([key, value]) => ({ key, value, updatedAt: new Date(0), updatedBy: null }));
    },
    async set(key: string, value: string) { data.set(key, value); },
  };
}

describe('plugin sites off list', () => {
  it('an empty store has every site on', async () => {
    expect([...await getSitesOff(fakeStore())]).toEqual([]);
  });

  it('off then on round-trips', async () => {
    const store = fakeStore();
    expect([...await setSiteOn(store, 'demo', 'widget', false, 'admin')]).toEqual(['demo:widget']);
    expect([...await getSitesOff(store)]).toEqual(['demo:widget']);
    expect([...await setSiteOn(store, 'demo', 'widget', true, 'admin')]).toEqual([]);
    expect([...await getSitesOff(store)]).toEqual([]);
  });

  it('turning a site off twice stores it once', async () => {
    const store = fakeStore();
    await setSiteOn(store, 'demo', 'panel', false, null);
    await setSiteOn(store, 'demo', 'panel', false, null);
    expect(JSON.parse(store.data.get(SITES_OFF_KEY)!)).toEqual(['demo:panel']);
  });

  it('a junk stored value means every site is on', async () => {
    for (const junk of ['not json', '{"a":1}', '42', '[1,"ok:widget",null]']) {
      const off = await getSitesOff(fakeStore({ [SITES_OFF_KEY]: junk }));
      expect([...off].filter((e) => e !== 'ok:widget')).toEqual([]);
    }
  });

  it('visibleSites drops a site that is off and keeps the rest', () => {
    const declared = { widget: { title: 'Today', height: 'medium' as const }, panel: { title: 'Notes' } };
    expect(visibleSites(declared, new Set(['demo:widget']), 'demo')).toEqual({ panel: { title: 'Notes' } });
    expect(visibleSites(declared, new Set(['other:widget']), 'demo')).toEqual(declared);
    expect(visibleSites(undefined, new Set(), 'demo')).toEqual({});
  });
});
