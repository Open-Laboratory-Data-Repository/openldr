import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityImportRunStore } from './facility-import-run-store';
import type { InternalSchema } from './schema/internal';

const base = { nationalSystem: 'urn:tz:hfr', sourceFormat: 'csv' as const, fileHash: 'h1', byteSize: 42, options: {} };

describe('createFacilityImportRunStore', () => {
  it('startPreview leaves previewedAt null; completePreview sets it and the summary', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startPreview(base);
    expect(run.previewedAt).toBeNull();
    expect(run.status).toBe('previewed');

    const done = await store.completePreview(run.id, { create: 3 });
    expect(done.previewedAt).not.toBeNull();
    expect(done.summary).toEqual({ create: 3 });
  });

  it('refuses a second active run for the same national system', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    await store.startPreview(base);
    await expect(store.startPreview(base)).rejects.toThrow(/already/i);
  });

  it('a finished run frees the national system for the next import', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const first = await store.startPreview(base);
    await store.finishApply(first.id, 'applied', { summary: { create: 1 } });
    const second = await store.startPreview(base);
    expect(second.id).not.toBe(first.id);
  });

  it('list orders newest first with a unique tiebreaker', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const a = await store.startPreview(base);
    await store.finishApply(a.id, 'applied', {});
    const b = await store.startPreview({ ...base, fileHash: 'h2' });
    await store.finishApply(b.id, 'applied', {});
    const rows = await store.list('urn:tz:hfr');
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});
