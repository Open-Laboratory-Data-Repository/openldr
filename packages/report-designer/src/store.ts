import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { canonicalHash } from '@openldr/core';
import type { InternalSchema, ReferenceCapture } from '@openldr/db';
import { type ReportDesign, ReportDesignSchema } from './schema';
import { designContentChanged, computeNextDesignVersion } from './lifecycle';

function toRow(d: ReportDesign) {
  return {
    id: d.id,
    name: d.name,
    paper: d.paper,
    orientation: d.orientation,
    pages: JSON.stringify(d.pages),
    parameters: JSON.stringify(d.parameters),
    margins: d.margins ? JSON.stringify(d.margins) : null,
    // `?? null` not `?? false` — see migration 083. An unset flag must persist as NULL so it reads
    // back `undefined` and leaves the content hash unchanged.
    page_numbers: d.pageNumbers ?? null,
    status: d.status ?? 'draft',
  };
}

/** The `report_design_versions` snapshot column mapping, shared by `publish()` and
 *  `upsertPublished()` so there is exactly one place that knows the null-handling: `margins` is
 *  stringified only when set (`null` otherwise), and `pageNumbers` uses `?? null` — not `?? false`
 *  — for the same reason `toRow` does (see migration 082). */
function toVersionRow(design: ReportDesign, version: number, publishedBy: string | null) {
  return {
    id: `rdv-${randomUUID()}`,
    design_id: design.id,
    version,
    name: design.name,
    paper: design.paper,
    orientation: design.orientation,
    pages: JSON.stringify(design.pages),
    parameters: JSON.stringify(design.parameters),
    margins: design.margins ? JSON.stringify(design.margins) : null,
    page_numbers: design.pageNumbers ?? null,
    published_by: publishedBy,
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
    pageNumbers: r.page_numbers == null ? undefined : Boolean(r.page_numbers),
    status: r.status === 'published' ? 'published' : 'draft',
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  });
}

export interface ReportDesignVersion {
  version: number;
  name: string;
  publishedAt: string;
  publishedBy: string | null;
}

export interface ReportDesignStore {
  list(): Promise<ReportDesign[]>;
  get(id: string): Promise<ReportDesign | undefined>;
  create(d: ReportDesign): Promise<ReportDesign>;
  update(id: string, d: ReportDesign): Promise<ReportDesign>;
  publish(id: string, publishedBy?: string | null): Promise<ReportDesign>;
  /** Product-owned / system write path — see the doc comment on the implementation below for why it
   *  exists and why it is NOT the same as `update()` followed by `publish()`. */
  upsertPublished(d: ReportDesign, publishedBy?: string | null): Promise<ReportDesign>;
  listVersions(id: string): Promise<ReportDesignVersion[]>;
  remove(id: string): Promise<void>;
}

// Hash over the sync-relevant fields (NOT id / timestamps) so the reference-change content hash is
// stable against jsonb key reordering (canonicalHash sorts keys) and matches what a lab consumes.
function hashOf(d: ReportDesign): string {
  return canonicalHash({
    name: d.name, paper: d.paper, orientation: d.orientation,
    pages: d.pages, parameters: d.parameters, margins: d.margins,
    // This field was previously absent here: a page-numbers toggle produced an unchanged hash, so
    // the de-dupe in recordReferenceChange suppressed it and the change never reached a lab.
    pageNumbers: d.pageNumbers,
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
        //
        // Always 'draft', discarding any caller-supplied status — the same guard `update()` applies,
        // for the same reason. A design becomes published only through `publish()` (a human's
        // deliberate act) or `upsertPublished()` (the boot seed's system write). Without this the
        // studio's Duplicate action, which clones a published design wholesale, pushed an unreviewed
        // copy to every lab on its first Save.
        const inserted = await trx
          .insertInto('report_designs')
          .values(toRow({ ...d, status: 'draft' }) as never)
          .onConflict((oc) => oc.column('id').doNothing())
          .returningAll()
          .executeTakeFirst();
        // On a losing ON CONFLICT DO NOTHING the EXISTING row wins, so hash what actually persists.
        const persisted = inserted
          ? fromRow(inserted as Record<string, unknown>)
          : fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', d.id).executeTakeFirst()) as Record<string, unknown>);
        // Drafts are not synced. Labs mirror the published design; the eventual publish() captures
        // the final state. Mirrors packages/forms/src/store.ts.
        if (capture && persisted.status === 'published') {
          await capture.record(trx, 'report_design', d.id, 'upsert', hashOf(persisted));
        }
        return persisted;
      });
    },
    async update(id, d) {
      return db.transaction().execute(async (trx) => {
        const beforeRow = await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst();
        const before = beforeRow ? fromRow(beforeRow as Record<string, unknown>) : undefined;
        // A published design drops to draft when its CONTENT changes. Gating on content matters:
        // autosave fires on any dirty state, and a no-op save must not un-publish.
        const nextStatus = before && before.status === 'published' && !designContentChanged(before, { ...d, id })
          ? 'published'
          : 'draft';
        await trx.updateTable('report_designs')
          .set({ ...toRow({ ...d, id, status: nextStatus }) } as never)
          .where('id', '=', id).execute();
        const persisted = fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst()) as Record<string, unknown>);
        if (capture && persisted.status === 'published') {
          await capture.record(trx, 'report_design', id, 'upsert', hashOf(persisted));
        }
        return persisted;
      });
    },
    /** Snapshot the current design as the next immutable revision and mark it published.
     *  Capture happens HERE and, for a draft, nowhere else — this is the deliberate act that
     *  reaches labs. */
    async publish(id, publishedBy = null) {
      return db.transaction().execute(async (trx) => {
        const row = await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst();
        if (!row) throw new Error(`report design not found: ${id}`);
        const design = fromRow(row as Record<string, unknown>);

        const existing = await trx.selectFrom('report_design_versions').select(['version']).where('design_id', '=', id).execute();
        const version = computeNextDesignVersion(existing.map((v) => Number(v.version)));

        await trx.insertInto('report_design_versions').values(toVersionRow(design, version, publishedBy) as never).execute();

        await trx.updateTable('report_designs').set({ status: 'published' } as never).where('id', '=', id).execute();

        const persisted = fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst()) as Record<string, unknown>);
        if (capture) await capture.record(trx, 'report_design', id, 'upsert', hashOf(persisted));
        return persisted;
      });
    },
    /** Product-owned / system write path for the boot seed (`packages/reporting/src/seed/
     *  report-seeds.ts`'s `seedDataDrivenReports`), NOT for any client-facing route.
     *
     *  `update()` deliberately overwrites any caller-supplied `status` with one it computes from
     *  the before-row plus a content comparison — that is correct and load-bearing for a client: it
     *  stops a save from smuggling `status: 'published'` past the content gate. But the seed is not
     *  a client. It ships corrected built-in designs, and a corrected design only reaches labs once
     *  it is BOTH written and published — capture (the thing that puts a design on the central→lab
     *  reference-sync set) only fires on a published row. `update()` would compute `'draft'` for a
     *  content change on an already-published design, exactly defeating the seed's own fix.
     *
     *  Calling `update()` then `publish()` is not an acceptable substitute: between the two calls
     *  the design sits as a draft, and a crash in that window (or a concurrent read) leaves a
     *  built-in stranded as a draft forever, with no drift left for a later boot to detect and
     *  repair (the content already matches — `designContentFingerprint` sees no difference next
     *  run). So this does the insert-or-update, the publish, and the version snapshot in ONE
     *  transaction: the same guarantee `publish()` gives a human editor, extended to a system
     *  write that must set content and status together. */
    async upsertPublished(d, publishedBy = null) {
      return db.transaction().execute(async (trx) => {
        const row = toRow({ ...d, status: 'published' });
        await trx.insertInto('report_designs')
          .values(row as never)
          .onConflict((oc) => oc.column('id').doUpdateSet(row as never))
          .execute();

        const design = fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', d.id).executeTakeFirst()) as Record<string, unknown>);

        const existing = await trx.selectFrom('report_design_versions').select(['version']).where('design_id', '=', d.id).execute();
        const version = computeNextDesignVersion(existing.map((v) => Number(v.version)));
        await trx.insertInto('report_design_versions').values(toVersionRow(design, version, publishedBy) as never).execute();

        if (capture) await capture.record(trx, 'report_design', d.id, 'upsert', hashOf(design));
        return design;
      });
    },
    async listVersions(id) {
      const rows = await db.selectFrom('report_design_versions').selectAll()
        .where('design_id', '=', id).orderBy('version', 'desc').execute();
      return rows.map((r) => ({
        version: Number(r.version),
        name: String(r.name),
        publishedAt: String(r.published_at),
        publishedBy: r.published_by == null ? null : String(r.published_by),
      }));
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
