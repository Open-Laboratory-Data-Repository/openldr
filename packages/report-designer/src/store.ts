import type { Kysely } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema, ReferenceCapture } from '@openldr/db';
import { type ReportDesign, ReportDesignSchema } from './schema';

function toRow(d: ReportDesign) {
  return {
    id: d.id,
    name: d.name,
    paper: d.paper,
    orientation: d.orientation,
    pages: JSON.stringify(d.pages),
    parameters: JSON.stringify(d.parameters),
    margins: d.margins ? JSON.stringify(d.margins) : null,
  };
}

function fromRow(r: Record<string, unknown>): ReportDesign {
  const parse = (v: unknown, fallback: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? fallback));
  return ReportDesignSchema.parse({
    id: r.id,
    name: r.name,
    paper: r.paper ?? 'A4',
    orientation: r.orientation ?? 'portrait',
    pages: parse(r.pages, []),
    parameters: parse(r.parameters, []),
    margins: r.margins == null ? undefined : parse(r.margins, undefined),
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface ReportDesignStore {
  list(): Promise<ReportDesign[]>;
  get(id: string): Promise<ReportDesign | undefined>;
  create(d: ReportDesign): Promise<ReportDesign>;
  update(id: string, d: ReportDesign): Promise<ReportDesign>;
  remove(id: string): Promise<void>;
}

// Hash over the sync-relevant fields (NOT id / timestamps) so the reference-change content hash is
// stable against jsonb key reordering (canonicalHash sorts keys) and matches what a lab consumes.
function hashOf(d: ReportDesign): string {
  return canonicalHash({
    name: d.name, paper: d.paper, orientation: d.orientation,
    pages: d.pages, parameters: d.parameters, margins: d.margins,
  });
}

/** `capture` makes designs part of the central→lab reference-sync set. A report definition points at
 *  a design (`reports.design_id`); syncing the definition without the design left labs with 8
 *  published reports they could not render. Mirrors createReportStore's capture contract exactly:
 *  same transaction as the write, hash the PERSISTED row (never the input). */
export function createReportDesignStore(db: Kysely<InternalSchema>, capture?: ReferenceCapture): ReportDesignStore {
  const t = () => db.selectFrom('report_designs');
  const store: ReportDesignStore = {
    async list() {
      const rows = await t().selectAll().orderBy('name').execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await t().selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async create(d) {
      return db.transaction().execute(async (trx) => {
        // Idempotent insert: mirrors the report-template store — a duplicate id no-ops instead of
        // raising a PK violation, and the existing row is returned.
        const inserted = await trx
          .insertInto('report_designs')
          .values(toRow(d) as never)
          .onConflict((oc) => oc.column('id').doNothing())
          .returningAll()
          .executeTakeFirst();
        // On a losing ON CONFLICT DO NOTHING the EXISTING row wins, so hash what actually persists.
        const persisted = inserted
          ? fromRow(inserted as Record<string, unknown>)
          : fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', d.id).executeTakeFirst()) as Record<string, unknown>);
        if (capture) await capture.record(trx, 'report_design', d.id, 'upsert', hashOf(persisted));
        return persisted;
      });
    },
    async update(id, d) {
      return db.transaction().execute(async (trx) => {
        await trx.updateTable('report_designs').set({ ...toRow({ ...d, id }) } as never).where('id', '=', id).execute();
        const persisted = fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst()) as Record<string, unknown>);
        if (capture) await capture.record(trx, 'report_design', id, 'upsert', hashOf(persisted));
        return persisted;
      });
    },
    async remove(id) {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('report_designs').where('id', '=', id).execute();
        if (capture) await capture.record(trx, 'report_design', id, 'delete', null);
      });
    },
  };
  return store;
}
