import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityImportEditStore } from './facility-import-edit-store';
import type { InternalSchema } from './schema/internal';

const SYS = 'urn:zm:mfl';
const HASH = 'a'.repeat(64);

describe('createFacilityImportEditStore', () => {
  it('writes a line-scoped edit and reads it back for that file', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'Health Centre' });
    const rows = await store.list(SYS, HASH);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ header: 'Type', line: 12, fromValue: null, toValue: 'Health Centre' });
  });

  it('replaces an edit for the same cell rather than storing two', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'first' });
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'second' });
    const rows = await store.list(SYS, HASH);
    expect(rows).toHaveLength(1);
    expect(rows[0].toValue).toBe('second');
  });

  it('keeps a line-scoped and a value-scoped edit on one header apart', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'one row' });
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', fromValue: 'Others', toValue: 'everywhere' });
    const rows = await store.list(SYS, HASH);
    expect(rows).toHaveLength(2);
  });

  it('a different file hash does not see this file edits', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    expect(await store.list(SYS, 'b'.repeat(64))).toEqual([]);
  });

  it('a different register does not see this register edits', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    expect(await store.list('urn:tz:hfr', HASH)).toEqual([]);
  });

  it('removes one edit and reports whether anything went', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    expect(await store.remove(SYS, HASH, { header: 'Type', line: 12 })).toBe(true);
    expect(await store.remove(SYS, HASH, { header: 'Type', line: 12 })).toBe(false);
    expect(await store.list(SYS, HASH)).toEqual([]);
  });

  it('removes a value-scoped edit by its value, not its line', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', fromValue: 'Others', toValue: 'y' });
    expect(await store.remove(SYS, HASH, { header: 'Type', fromValue: 'Others' })).toBe(true);
    expect(await store.list(SYS, HASH)).toEqual([]);
  });

  it('clear drops every edit for one file and counts them', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 12, toValue: 'x' });
    await store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Name', line: 13, toValue: 'y' });
    expect(await store.clear(SYS, HASH)).toBe(2);
    expect(await store.list(SYS, HASH)).toEqual([]);
  });

  it('refuses an edit that names neither a line nor a value', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await expect(store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', toValue: 'x' }))
      .rejects.toThrow(/line or a value/i);
  });

  it('refuses an edit that names both a line and a value', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportEditStore(db);
    await expect(store.put({ nationalSystem: SYS, fileHash: HASH, header: 'Type', line: 2, fromValue: 'a', toValue: 'x' }))
      .rejects.toThrow(/line or a value/i);
  });
});
