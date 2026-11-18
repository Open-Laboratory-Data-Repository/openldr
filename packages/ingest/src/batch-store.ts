import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';

export interface IngestBatch {
  batch_id: string;
  source: string | null;
  blob_key: string;
  content_type: string | null;
  converter: string;
  status: string;
  resource_count: number;
  attempts: number;
  last_error: string | null;
  config: Record<string, string> | null;
  created_at: Date;
  /** Last status change: for a batch left `processing`, when its worker was last heard from. */
  updated_at: Date;
}

export interface BatchStore {
  create(b: { batchId: string; source: string; blobKey: string; contentType?: string; converter: string; config?: Record<string, string> }): Promise<void>;
  markProcessing(batchId: string): Promise<void>;
  markDone(batchId: string, resourceCount: number): Promise<void>;
  markFailed(batchId: string, error: string): Promise<void>;
  reset(batchId: string): Promise<void>;
  get(batchId: string): Promise<IngestBatch | undefined>;
  list(): Promise<IngestBatch[]>;
  provenanceGaps(): Promise<{ resource_type: string; id: string }[]>;
  /** Batches left `processing` longer than `olderThanMs` whose `ingest.received` event is no longer
   *  pending or being processed: the queue gave up on them, so no delivery will carry them on. */
  listStuck(olderThanMs: number): Promise<IngestBatch[]>;
  markInterrupted(batchId: string, error: string): Promise<void>;
}

const COLUMNS = ['batch_id', 'source', 'blob_key', 'content_type', 'converter', 'status', 'resource_count', 'attempts', 'last_error', 'config', 'created_at', 'updated_at'] as const;

export function createBatchStore(db: Kysely<InternalSchema>): BatchStore {
  return {
    async create(b) {
      await db
        .insertInto('ingest_batches')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ batch_id: b.batchId, source: b.source, blob_key: b.blobKey, content_type: b.contentType ?? null, converter: b.converter, status: 'received', config: (b.config ? JSON.stringify(b.config) : null) as any })
        .execute();
    },
    async markProcessing(batchId) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'processing', attempts: sql`attempts + 1`, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markDone(batchId, resourceCount) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'done', resource_count: resourceCount, last_error: null, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markFailed(batchId, error) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'failed', last_error: error, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async markInterrupted(batchId, error) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'interrupted', last_error: error, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .where('status', '=', 'processing')
        .execute();
    },
    async listStuck(olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const old = await db.selectFrom('ingest_batches').select(COLUMNS)
        .where('status', '=', 'processing').where('updated_at', '<', cutoff).execute();
      if (old.length === 0) return [];
      // Two reads, joined here: pg-mem cannot run the correlated subquery this would otherwise be.
      const live = await db.selectFrom('outbox_events').select('payload')
        .where('type', '=', 'ingest.received').where('status', 'in', ['pending', 'processing']).execute();
      const held = new Set(live.map((e) => {
        const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
        return (p as { batchId?: string } | null)?.batchId;
      }));
      return (old as IngestBatch[]).filter((b) => !held.has(b.batch_id));
    },
    async reset(batchId) {
      await db
        .updateTable('ingest_batches')
        .set({ status: 'received', last_error: null, updated_at: sql`now()` })
        .where('batch_id', '=', batchId)
        .execute();
    },
    async get(batchId) {
      return db.selectFrom('ingest_batches').select(COLUMNS).where('batch_id', '=', batchId).executeTakeFirst();
    },
    async list() {
      return db.selectFrom('ingest_batches').select(COLUMNS).orderBy('created_at', 'desc').limit(100).execute();
    },
    async provenanceGaps() {
      return db
        .selectFrom('fhir.fhir_resources')
        .select(['resource_type', 'id'])
        .where((eb) => eb.or([eb('source_system', 'is', null), eb('plugin_id', 'is', null), eb('batch_id', 'is', null)]))
        .limit(500)
        .execute();
    },
  };
}
