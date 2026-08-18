import { sql, type Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { FhirStore } from '../fhir-store';
import type { RelationalWriter } from '../relational-writer';
import { planProjection, type ProjectionTask, type Gap } from './plan';
import { readCursor, advanceCursor } from './cursor';
import type { SafeFetchResult } from './fetch';
import { provenanceFromRow, type Provenance } from '../provenance';
import { LEDGER_RESOURCE_TYPES, isLedgerResourceType, readArrivals, toArrivalEvent } from './ledger';

export type FetchSafeRows = (db: Kysely<InternalSchema>, cursor: number, limit: number) => Promise<SafeFetchResult>;

export interface Logger { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; debug(o: unknown, m?: string): void; }

export interface ProjectionDeps {
  internalDb: Kysely<InternalSchema>;
  fhirStore: FhirStore;
  relationalWriter: RelationalWriter;
  logger: Logger;
  fetch: FetchSafeRows;
  batchSize?: number;
  /** Optional per-resource side effect, fired after a successful `relationalWriter.write()` (never
   *  on the tombstone/delete path). Callers hang ancillary capture off the projection loop this way —
   *  e.g. facility-reconciliation's `captureObservedFacility` — without `applyProjection` or
   *  `projectResource` knowing anything about what the hook does. A throwing hook is caught and
   *  logged locally (see `applyProjection` below) so it can never abort a cycle or be mistaken for a
   *  failed write: the clinical projection this task represents already landed by the time it runs.
   *
   *  `provenance` is the SAME value just handed to `relationalWriter.write()` — `getWithProvenance`
   *  reads it off the canonical row alongside `resource` itself, so a hook that needs to know which
   *  ingest feed produced this resource (e.g. facility-reconciliation routing a captured concept to
   *  its feed's own coding system) does not have to re-derive or guess it. */
  onProjected?: (resourceType: string, resource: Record<string, unknown>, provenance: Provenance) => Promise<void>;
}

export interface ProjectionRunner {
  runCycle(): Promise<number>;
}

async function applyProjection(task: ProjectionTask, deps: ProjectionDeps): Promise<void> {
  // getWithProvenance, not get: the projected row must carry the canonical row's
  // source_system/plugin_id/plugin_version/batch_id, or the read model cannot say
  // which producer or which run wrote it.
  const found = await deps.fhirStore.getWithProvenance(task.resourceType, task.id);
  if (found) {
    await deps.relationalWriter.write(found.resource, found.provenance);
    if (deps.onProjected) {
      try {
        await deps.onProjected(task.resourceType, found.resource as Record<string, unknown>, found.provenance);
      } catch (err) {
        // Deliberately a SEPARATE try/catch from the write above (and from the caller's own
        // per-task catch): the clinical projection already succeeded, so this must never be
        // reported or treated as an apply failure — only the ancillary hook failed.
        deps.logger.error({ err, task }, 'onProjected hook failed; ignoring (clinical projection already applied)');
      }
    }
  } else {
    await deps.relationalWriter.deleteById(task.resourceType, task.id);
  }

  // Record every arrival of this resource, not only the newest.
  //
  // ⛔ WHY ALL VERSIONS. A cycle receives ONE task per changed resource, however many versions
  // arrived since the last cycle. Recording only the newest would silently lose the intermediate
  // arrival — and a later `reprojectAll`, which reads every history row, would then DISAGREE with
  // the live path. Upsert is idempotent on the composite PK, so re-writing versions already
  // recorded costs nothing.
  //
  // ⛔ WHY THIS IS OUTSIDE `if (found)`, on BOTH branches. The canonical row being absent does not
  // mean nothing ever arrived. Two producers put a real arrival in history with no `fhir_resources`
  // row to find:
  //   (a) a resource upserted and then deleted between two cycles; and
  //   (b) the sync path with no delete race at all — `fhir-store.ts:424` appends the `op='upsert'`
  //       history row UNCONDITIONALLY and writes `fhir_resources` only when `isNewest` (`:444-446`), so
  //       a late older upsert arriving after a newer delete is a real arrival that leaves the
  //       canonical read model empty. A lab re-draining a backlog after a central-side delete hits
  //       this without any race.
  // In both cases `getWithProvenance` returns null, so a ledger write confined to the `found` branch
  // records nothing while `reprojectAll` records it — the live path and a rebuild then disagree.
  // `readArrivals` filters `op = 'upsert'`, so a genuinely deleted resource yields exactly its real
  // arrivals and never a tombstone.
  //
  // The two paths still are not identical by construction — they read the same table through
  // different queries and a failed ledger write here is logged and skipped. They agree on the cases
  // above; a rebuild remains the repair.
  //
  // Guarded like the existing onProjected hook: a ledger failure must never abort a cycle or be
  // mistaken for a failed clinical write, which has already landed by this point.
  if (isLedgerResourceType(task.resourceType)) {
    try {
      await deps.relationalWriter.writeIngestEvents(
        await readArrivals(deps.internalDb, task.resourceType, task.id),
      );
    } catch (err) {
      deps.logger.error({ err, task }, 'arrival ledger write failed; skipping (reprojectAll can heal)');
    }
  }
}

/** A stateful projection runner. `pendingGaps` (seq→x0) is carried across ticks in-memory so the
 *  safe-frontier can confirm rolled-back gaps once the xmin boundary advances. Each cycle: fetch safe
 *  rows + snapshot bounds, plan, apply each (current-state, idempotent), advance the cursor. A failing
 *  apply is logged and skipped (reprojectAll can heal). Returns the number of resources projected. */
export function createProjectionRunner(deps: ProjectionDeps): ProjectionRunner {
  let pendingGaps: Gap[] = [];
  return {
    async runCycle(): Promise<number> {
      const cursor = await readCursor(deps.internalDb, 'projection');
      const { rows, boundary, xmax } = await deps.fetch(deps.internalDb, cursor, deps.batchSize ?? 500);
      const plan = planProjection({ rows, boundary, xmax, cursor, pendingGaps });
      pendingGaps = plan.pendingGaps;
      for (const task of plan.tasks) {
        try {
          await applyProjection(task, deps);
        } catch (err) {
          deps.logger.error({ err, task }, 'projection apply failed; skipping (reprojectAll can heal)');
        }
      }
      if (plan.newCursor > cursor) await advanceCursor(deps.internalDb, 'projection', plan.newCursor);
      return plan.tasks.length;
    },
  };
}

/** What one rebuild wrote. Two DIFFERENT units, deliberately kept apart:
 *  `projected` counts canonical RESOURCES rewritten into the read model, `arrivals` counts ledger
 *  ROWS (one per version of a clinical resource). Reporting one number as the other is exactly the
 *  confusion `packages/cli/src/terminology.ts:152-166` documents. */
export interface ReprojectResult {
  projected: number;
  arrivals: number;
}

/** Rebuild the read-model from the canonical store, then set the cursor to the current max seq. */
export async function reprojectAll(deps: Pick<ProjectionDeps, 'internalDb' | 'relationalWriter'>): Promise<ReprojectResult> {
  const maxRow = await deps.internalDb
    .selectFrom('fhir.change_log')
    .select((eb) => eb.fn.max('seq').as('m'))
    .executeTakeFirst();
  const maxSeq = maxRow?.m != null ? Number(maxRow.m) : 0;

  let projected = 0;
  const page = 1000;
  let offset = 0;
  for (;;) {
    const rows = await deps.internalDb
      .selectFrom('fhir.fhir_resources')
      .select(['resource', 'source_system', 'plugin_id', 'plugin_version', 'batch_id'])
      .orderBy('resource_type')
      .orderBy('id')
      .limit(page)
      .offset(offset)
      .execute();
    if (rows.length === 0) break;
    await deps.relationalWriter.writeMany(rows.map((r) => ({ resource: r.resource, provenance: provenanceFromRow(r) })));
    projected += rows.length;
    offset += rows.length;
    if (rows.length < page) break;
  }

  // ⛔ A SECOND scan, over a DIFFERENT table, and it cannot be folded into the loop above.
  // The loop above pages `fhir.fhir_resources`, which holds only the CURRENT version of each
  // resource. An arrival ledger is a record of every version, so rebuilding it from that table is
  // structurally impossible — it would record one arrival per resource and lose the history.
  //
  // ⛔ KEYSET PAGING, NOT OFFSET. Do not "simplify" this back to `.offset(n)`.
  // This scan reads a table that is being APPENDED TO while it runs — `db reproject` exists to
  // backfill after an upgrade, and ingest keeps going during it. OFFSET counts rows from the start
  // of the result set on EVERY page, so any row inserted BELOW the cursor between two pages shifts
  // the window and one already-unread row is stepped over and never read. The row is then missing
  // from the ledger for good: the live path never recorded it either if it predates the ledger, and
  // nothing reports the hole.
  //
  // An earlier comment here argued the paging was safe because (resource_type, id, version) is this
  // table's PRIMARY KEY. That reasoning was WRONG. Uniqueness removes ties within one snapshot; it
  // says nothing about concurrent inserts sorting below the cursor. Carrying the last key and asking
  // for rows strictly after it is immune to that — a row inserted below the cursor is simply not
  // returned again, and no unread row is skipped. It is also O(n) rather than OFFSET's O(n²).
  let arrivals = 0;
  // `version` is normalized to a JS number here for the same reason `toArrivalEvent` does it: the
  // column is bigint and its decoded type varies by driver (number on pg, string/bigint elsewhere).
  // A bigint value cannot be sent as a query parameter by every driver, and a version counter is far
  // below 2^53, so a number is both safe and uniform. Postgres infers the untyped parameter as
  // bigint from the row comparison's left-hand column.
  let after: { resource_type: string; id: string; version: number } | null = null;
  for (;;) {
    let query = deps.internalDb
      .selectFrom('fhir.resource_history')
      .select(['resource_type', 'id', 'version', 'recorded_at'])
      .where('resource_type', 'in', [...LEDGER_RESOURCE_TYPES])
      // op = 'upsert' only: a delete() tombstone (fhir-store.ts, op: 'delete', resource: null) is
      // data going AWAY, not an arrival. ingest_events has no op column, so an unfiltered scan would
      // record a deletion as a permanent, indistinguishable false arrival — resource_history is
      // append-only and a later rebuild never self-heals it.
      .where('op', '=', 'upsert')
      // Same order as the keyset predicate below, and the same order as the primary key — the
      // comparison is lexicographic, so the two MUST agree or the paging walks past rows.
      .orderBy('resource_type').orderBy('id').orderBy('version')
      .limit(page);
    if (after) {
      const { resource_type: t, id: i, version: v } = after;
      query = query.where(
        sql<boolean>`(${sql.ref('resource_type')}, ${sql.ref('id')}, ${sql.ref('version')}) > (${t}, ${i}, ${v})`,
      );
    }
    const rows = await query.execute();
    if (rows.length === 0) break;
    await deps.relationalWriter.writeIngestEvents(rows.map(toArrivalEvent));
    arrivals += rows.length;
    const last = rows[rows.length - 1];
    after = { resource_type: last.resource_type, id: last.id, version: Number(last.version) };
    if (rows.length < page) break;
  }

  await advanceCursor(deps.internalDb, 'projection', maxSeq);
  return { projected, arrivals };
}
