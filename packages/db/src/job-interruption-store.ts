import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { InternalSchema, JobInterruptionsTable } from './schema/internal';

/** Every kind of long job that records its interruptions (design 2026-11-18-interrupted-jobs). */
export type JobKind = 'cdr-run' | 'facility-import' | 'facility-job' | 'terminology-ingest' | 'ingest-batch' | 'workflow-receipt';
/** Why a job was taken back: the server restarted, its lease ran out, or its event ran out of attempts. */
export type InterruptionCause = 'server-restart' | 'lease-expired' | 'attempts-exhausted';

/** One cut. `resumedBy` is null while the job waits for Continue, or for a run of its own. */
export interface JobInterruption {
  id: string;
  at: string;
  cause: InterruptionCause;
  phase: string | null;
  resumedAt: string | null;
  resumedBy: 'self' | 'person' | null;
  continuedAs: string | null;
}

export interface JobInterruptionStore {
  /** Records one cut. The same job and `at` a second time inserts nothing and returns the first id. */
  record(kind: JobKind, jobId: string, cut: { at: Date; cause: InterruptionCause; phase: string | null }): Promise<{ id: string; inserted: boolean }>;
  /** Says who brought the job back and when, and the new run when a person's Continue started one. */
  resolve(id: string, how: { resumedBy: 'self' | 'person'; resumedAt: Date; continuedAs?: string }): Promise<void>;
  /** Each job's records, oldest first. A job with none is absent from the map. */
  listFor(kind: JobKind, jobIds: string[]): Promise<Map<string, JobInterruption[]>>;
  /** How many cuts this job has had in `phase`. A later phase starts the count again. */
  inARow(kind: JobKind, jobId: string, phase: string | null): Promise<number>;
}

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());

function toInterruption(r: Selectable<JobInterruptionsTable>): JobInterruption {
  return {
    id: r.id, at: iso(r.at)!, cause: r.cause as InterruptionCause, phase: r.phase,
    resumedAt: iso(r.resumed_at), resumedBy: r.resumed_by as JobInterruption['resumedBy'], continuedAs: r.continued_as,
  };
}

export function createJobInterruptionStore(db: Kysely<InternalSchema>): JobInterruptionStore {
  return {
    async record(kind, jobId, cut) {
      const find = () => db.selectFrom('job_interruptions').select('id')
        .where('job_kind', '=', kind).where('job_id', '=', jobId).where('at', '=', cut.at).executeTakeFirst();
      // Look first: pg-mem answers `on conflict do nothing returning` with a row even when it
      // inserts nothing. On Postgres the unique constraint still stops a second row if two workers
      // race between the look and the insert; the second then reads the first's id.
      const before = await find();
      if (before) return { id: before.id, inserted: false };
      const id = randomUUID();
      await db.insertInto('job_interruptions')
        .values({ id, job_kind: kind, job_id: jobId, phase: cut.phase, at: cut.at, cause: cut.cause, resumed_at: null, resumed_by: null, continued_as: null })
        .onConflict((oc) => oc.columns(['job_kind', 'job_id', 'at']).doNothing())
        .execute();
      const after = await find();
      return { id: after!.id, inserted: after!.id === id };
    },
    async resolve(id, how) {
      await db.updateTable('job_interruptions')
        .set({ resumed_by: how.resumedBy, resumed_at: how.resumedAt, continued_as: how.continuedAs ?? null })
        .where('id', '=', id).execute();
    },
    async listFor(kind, jobIds) {
      const out = new Map<string, JobInterruption[]>();
      if (jobIds.length === 0) return out;
      const rows = await db.selectFrom('job_interruptions').selectAll()
        .where('job_kind', '=', kind).where('job_id', 'in', jobIds)
        .orderBy('at', 'asc').orderBy('id', 'asc').execute();
      for (const r of rows) out.set(r.job_id, [...(out.get(r.job_id) ?? []), toInterruption(r)]);
      return out;
    },
    async inARow(kind, jobId, phase) {
      let q = db.selectFrom('job_interruptions').select((eb) => eb.fn.countAll<string>().as('n'))
        .where('job_kind', '=', kind).where('job_id', '=', jobId);
      q = phase === null ? q.where('phase', 'is', null) : q.where('phase', '=', phase);
      const row = await q.executeTakeFirstOrThrow();
      return Number(row.n);
    },
  };
}
