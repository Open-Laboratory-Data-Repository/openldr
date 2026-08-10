import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type FacilityImportRunStatus = 'previewed' | 'applied' | 'failed';

export interface FacilityImportRun {
  id: string; nationalSystem: string; sourceFormat: 'csv' | 'jsonl';
  fileHash: string; byteSize: number;
  releaseVersion: string | null; releasePublishedAt: string | null;
  declaredRowCount: number | null; declaredDeletionCount: number | null;
  status: FacilityImportRunStatus;
  previewedAt: string | null;
  summary: unknown; options: unknown; error: string | null;
  requestedBy: string | null; createdAt: string; finishedAt: string | null;
}

export interface FacilityImportRunStore {
  startPreview(input: {
    nationalSystem: string; sourceFormat: 'csv' | 'jsonl'; fileHash: string; byteSize: number;
    releaseVersion?: string | null; releasePublishedAt?: string | null;
    declaredRowCount?: number | null; declaredDeletionCount?: number | null;
    options: unknown; requestedBy?: string | null;
  }): Promise<FacilityImportRun>;
  /** Stamps `previewed_at` and stores the summary. The timestamp is the DB's `now()`, never the
   *  application clock — apply compares it against `facility_registry.updated_at`, also DB-set. */
  completePreview(id: string, summary: unknown): Promise<FacilityImportRun>;
  finishApply(id: string, status: 'applied' | 'failed', opts: { summary?: unknown; error?: string | null }): Promise<void>;
  get(id: string): Promise<FacilityImportRun | null>;
  list(nationalSystem?: string, limit?: number): Promise<FacilityImportRun[]>;
}

// ⛔ `timestamptz` columns come back as `Date` from node-postgres even where a sibling schema type
// declares `string` (FacilityRegistryTable does exactly that). `new Date(x)` accepts both, so this
// is the only safe normalisation — the same idiom `facility-job-store.ts` uses on every read.
const iso = (d: unknown): string | null => (d == null ? null : new Date(d as string | Date).toISOString());

function toRun(r: Record<string, unknown>): FacilityImportRun {
  return {
    id: r.id as string,
    nationalSystem: r.national_system as string,
    sourceFormat: r.source_format as 'csv' | 'jsonl',
    fileHash: r.file_hash as string,
    byteSize: Number(r.byte_size),
    releaseVersion: (r.release_version as string | null) ?? null,
    releasePublishedAt: iso(r.release_published_at),
    declaredRowCount: r.declared_row_count == null ? null : Number(r.declared_row_count),
    declaredDeletionCount: r.declared_deletion_count == null ? null : Number(r.declared_deletion_count),
    status: r.status as FacilityImportRunStatus,
    previewedAt: iso(r.previewed_at),
    summary: r.summary ?? null,
    options: r.options ?? {},
    error: (r.error as string | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
    finishedAt: iso(r.finished_at),
  };
}

export function createFacilityImportRunStore(db: Kysely<InternalSchema>): FacilityImportRunStore {
  const byId = async (id: string) =>
    db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  return {
    async startPreview(input) {
      // Explicit pre-check so a concurrent second import fails with a readable message; the unique
      // index on `active_key` (migration 080) is the race-safe backstop. Same two-layer shape as
      // `terminology-ingest-job-store.ts`'s `hasActive` + index.
      const active = await db.selectFrom('facility_import_runs').select('id')
        .where('active_key', '=', input.nationalSystem).executeTakeFirst();
      if (active) throw new Error(`an import is already in progress for "${input.nationalSystem}"`);

      const id = `fir_${randomUUID()}`;
      await db.insertInto('facility_import_runs').values({
        id,
        national_system: input.nationalSystem,
        source_format: input.sourceFormat,
        file_hash: input.fileHash,
        byte_size: input.byteSize,
        release_version: input.releaseVersion ?? null,
        release_published_at: (input.releasePublishedAt ? new Date(input.releasePublishedAt) : null) as never,
        declared_row_count: input.declaredRowCount ?? null,
        declared_deletion_count: input.declaredDeletionCount ?? null,
        status: 'previewed',
        options: JSON.stringify(input.options) as never,
        requested_by: input.requestedBy ?? null,
        active_key: input.nationalSystem,
      } as never).execute();
      return toRun(await byId(id) as never);
    },

    async completePreview(id, summary) {
      // ⛔ `now()` — the DATABASE clock, deliberately, not the application's. This timestamp is
      // compared against `facility_registry.updated_at`, which is also written by `now()`. Mixing an
      // application clock in would make the comparison depend on host clock skew, and skew in one
      // direction silently hides real conflicts.
      await db.updateTable('facility_import_runs')
        .set({ previewed_at: sql`now()` as never, summary: JSON.stringify(summary) as never })
        .where('id', '=', id).execute();
      return toRun(await byId(id) as never);
    },

    async finishApply(id, status, opts) {
      await db.updateTable('facility_import_runs')
        .set({
          status,
          error: opts.error ?? null,
          finished_at: sql`now()` as never,
          ...(opts.summary === undefined ? {} : { summary: JSON.stringify(opts.summary) as never }),
          // Clearing the key is what stops a terminal row holding its national system for good.
          active_key: null,
        } as never)
        .where('id', '=', id).execute();
    },

    async get(id) {
      const r = await db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toRun(r as never) : null;
    },

    async list(nationalSystem, limit = 50) {
      let q = db.selectFrom('facility_import_runs').selectAll();
      if (nationalSystem) q = q.where('national_system', '=', nationalSystem);
      // ⛔ `id` tiebreaker is REQUIRED, not cosmetic: `created_at` defaults to now(), which is
      // TRANSACTION time in Postgres, so rows created in one transaction tie and the winner would
      // otherwise be engine-dependent. pg-mem's scan order is stable and will never show this.
      return (await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute())
        .map((r) => toRun(r as never));
    },
  };
}
