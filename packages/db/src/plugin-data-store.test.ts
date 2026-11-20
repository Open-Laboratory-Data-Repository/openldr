import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createPluginDataStore } from './plugin-data-store';

describe('plugin-data store', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('put/get round-trips a doc, scoped by plugin id', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'mappings', 'k1', { a: 1 });
    expect(await s.get('p1', 'mappings', 'k1')).toEqual({ a: 1 });
    expect(await s.get('p2', 'mappings', 'k1')).toBeNull(); // namespacing
  });

  it('put upserts (second write to same key replaces)', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'k', { v: 1 });
    await s.put('p1', 'c', 'k', { v: 2 });
    expect(await s.get('p1', 'c', 'k')).toEqual({ v: 2 });
  });

  it('list returns a collection, with optional equality filter + limit', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x', n: 1 });
    await s.put('p1', 'c', 'b', { type: 'y', n: 2 });
    await s.put('p1', 'c', 'd', { type: 'x', n: 3 });
    const all = await s.list('p1', 'c');
    expect(all.length).toBe(3);
    const xs = await s.list('p1', 'c', { where: { field: 'type', eq: 'x' } });
    expect(xs.map((e) => e.key).sort()).toEqual(['a', 'd']);
    const limited = await s.list('p1', 'c', { limit: 1 });
    expect(limited.length).toBe(1);
  });

  it('delete removes one key; purge removes a whole namespace', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { n: 1 });
    await s.put('p1', 'c', 'b', { n: 2 });
    await s.delete('p1', 'c', 'a');
    expect(await s.get('p1', 'c', 'a')).toBeNull();
    await s.put('p2', 'c', 'a', { n: 9 });
    await s.purge('p1');
    expect(await s.list('p1', 'c')).toEqual([]);
    expect(await s.get('p2', 'c', 'a')).toEqual({ n: 9 }); // other namespace untouched
  });

  it('purgeExcept empties a namespace but the named collections, and no other plugin', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', '__import-copies', 'cp1', { n: 1 });
    await s.put('p1', '__import-allowed', 'conn', { n: 2 });
    await s.put('p1', 'own', 'k', { n: 3 });
    await s.put('p2', 'own', 'k', { n: 9 });
    await s.purgeExcept('p1', ['__import-copies']);
    expect(await s.get('p1', '__import-copies', 'cp1')).toEqual({ n: 1 });
    expect(await s.list('p1', '__import-allowed')).toEqual([]);
    expect(await s.list('p1', 'own')).toEqual([]);
    expect(await s.get('p2', 'own', 'k')).toEqual({ n: 9 });
  });

  it('pluginIds lists each plugin with a document in a collection, once', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', '__import-copies', 'a', { n: 1 });
    await s.put('p1', '__import-copies', 'b', { n: 2 });
    await s.put('p2', '__import-copies', 'a', { n: 3 });
    await s.put('p3', 'own', 'a', { n: 4 });
    expect((await s.pluginIds('__import-copies')).sort()).toEqual(['p1', 'p2']);
  });

  it('rejects an invalid filter field name', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x' });
    await expect(s.list('p1', 'c', { where: { field: 'type; DROP', eq: 'x' } })).rejects.toThrow();
  });

  it('rejects an empty filter field name', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x' });
    await expect(s.list('p1', 'c', { where: { field: '', eq: 'x' } })).rejects.toThrow();
  });

  // Layer: the SQL of putIfRev on pg-mem. Not shown here: that Postgres runs each form as one
  // statement under concurrent callers. That is Postgres's own guarantee for one statement.
  describe('putIfRev', () => {
    it('with null, writes only when no document exists', async () => {
      const s = createPluginDataStore(db);
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 1, v: 'a' }, null)).toBe(true);
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 1, v: 'b' }, null)).toBe(false);
      expect(await s.get('p1', 'c', 'k')).toEqual({ rev: 1, v: 'a' });
    });

    it('with a number, writes only when the stored rev equals it', async () => {
      const s = createPluginDataStore(db);
      await s.putIfRev('p1', 'c', 'k', { rev: 1, v: 'a' }, null);
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 2, v: 'b' }, 1)).toBe(true);
      expect(await s.get('p1', 'c', 'k')).toEqual({ rev: 2, v: 'b' });
      // A caller that read rev 1 lost the race: its write is refused and changes nothing.
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 2, v: 'c' }, 1)).toBe(false);
      expect(await s.get('p1', 'c', 'k')).toEqual({ rev: 2, v: 'b' });
    });

    it('with a number, writes nothing when no document exists', async () => {
      const s = createPluginDataStore(db);
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 1 }, 0)).toBe(false);
      expect(await s.get('p1', 'c', 'k')).toBeNull();
    });

    it('touches only its own plugin, collection and key', async () => {
      const s = createPluginDataStore(db);
      await s.put('p1', 'c', 'other', { rev: 1, v: 'x' });
      await s.put('p2', 'c', 'k', { rev: 1, v: 'x' });
      await s.put('p1', 'd', 'k', { rev: 1, v: 'x' });
      await s.putIfRev('p1', 'c', 'k', { rev: 1, v: 'a' }, null);
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 2, v: 'b' }, 1)).toBe(true);
      expect(await s.get('p1', 'c', 'other')).toEqual({ rev: 1, v: 'x' });
      expect(await s.get('p2', 'c', 'k')).toEqual({ rev: 1, v: 'x' });
      expect(await s.get('p1', 'd', 'k')).toEqual({ rev: 1, v: 'x' });
    });

    it('compares a stored rev of 10 and 1 as numbers, not as text prefixes', async () => {
      const s = createPluginDataStore(db);
      await s.put('p1', 'c', 'k', { rev: 10 });
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 2 }, 1)).toBe(false);
      expect(await s.putIfRev('p1', 'c', 'k', { rev: 11 }, 10)).toBe(true);
    });
  });

  it('rejects a non-ascii filter field name', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x' });
    await expect(s.list('p1', 'c', { where: { field: 'typé', eq: 'x' } })).rejects.toThrow();
  });
});
