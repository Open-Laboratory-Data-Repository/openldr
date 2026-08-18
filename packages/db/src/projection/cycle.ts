import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { FhirStore } from '../fhir-store';
import type { RelationalWriter } from '../relational-writer';
import { planProjection, type ProjectionTask, type Gap } from './plan';
import { readCursor, advanceCursor } from './cursor';
import type { SafeFetchResult } from './fetch';
import { provenanceFromRow, type Provenance } from '../provenance';
import { LEDGER_RESOURCE_TYPES } from './ledger';

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

/** Rebuild the read-model from the canonical store, then set the cursor to the current max seq. */
export async function reprojectAll(deps: Pick<ProjectionDeps, 'internalDb' | 'relationalWriter'>): Promise<number> {
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
  let arrivals = 0;
  let histOffset = 0;
  for (;;) {
    const rows = await deps.internalDb
      .selectFrom('fhir.resource_history')
      .select(['resource_type', 'id', 'version', 'recorded_at'])
      .where('resource_type', 'in', [...LEDGER_RESOURCE_TYPES])
      // (resource_type, id, version) is this table's PRIMARY KEY, so the ordering is unique and the
      // OFFSET paging is deterministic. AGENTS.md §7: an ORDER BY + OFFSET without a unique
      // tiebreaker can skip or repeat rows, and pg-mem's stable scan order would never reveal it.
      .orderBy('resource_type').orderBy('id').orderBy('version')
      .limit(page).offset(histOffset)
      .execute();
    if (rows.length === 0) break;
    await deps.relationalWriter.writeIngestEvents(rows.map((r) => ({
      resource_type: r.resource_type as string,
      resource_id: r.id as string,
      version: Number(r.version),
      recorded_at: r.recorded_at as Date,
    })));
    arrivals += rows.length;
    histOffset += rows.length;
    if (rows.length < page) break;
  }

  await advanceCursor(deps.internalDb, 'projection', maxSeq);
  return projected;
}
