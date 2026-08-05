import { type Kysely, type Transaction, sql } from 'kysely';
import { canonicalHash } from '@openldr/core';
import { parseFacilityCsv } from '@openldr/terminology';
import {
  type FacilityRecord,
  type InternalSchema,
  type ReferenceCapture,
  insertBatchPg,
  facilityRecordToRow,
  facilityRowToRecord,
} from '@openldr/db';

// Task 2 of the facility-import slice: `parseFacilityCsv` (packages/terminology) exists, is tested,
// and has ZERO callers — this is the one shared function that actually writes a parsed register into
// `facility_registry`, so Task 3 (CLI) and Task 4 (HTTP route) can both wrap it instead of duplicating
// write logic (the repo's CLI-parity rule).

export interface FacilityImportDeps {
  db: Kysely<InternalSchema>;
  /** Reference-sync capture binding (see @openldr/db's ReferenceCapture). Omit to import without
   *  emitting reference_change_log rows at all — e.g. a throwaway/local import that must never sync. */
  capture?: ReferenceCapture;
}

export interface FacilityImportOptions {
  /** Which national register these codes belong to. Configuration, never hardcoded — see
   *  facility-csv.ts's `FacilityCsvOptions.nationalSystem`. */
  nationalSystem: string;
  /** Import despite unrecognised columns, carrying them into each record's `extras`. */
  allowUnknownColumns?: boolean;
  /** The caller opts IN to writing. Omitted/false ⇒ dry run: parse and report, write NOTHING. A
   *  14 000-row register is exactly the kind of file nobody should be able to silently rewrite by
   *  forgetting a flag. */
  apply?: boolean;
}

export interface FacilityImportResult {
  /** Rows the parser accepted (present regardless of `apply`, even on a dry run). */
  parsed: number;
  /** Rows dropped for missing a required field. */
  skipped: number;
  /** Columns the contract does not define. Non-empty AND `allowUnknownColumns` was not set ⇒
   *  `parsed`/`skipped` are both 0 — the parser blocks the whole file rather than importing it
   *  missing data (see facility-csv.ts's docblock). */
  unknownColumns: string[];
  /** Rows written that did not previously exist. Always 0 on a dry run. */
  created: number;
  /** Rows written that already existed (same nationalSystem+nationalCode ⇒ same hashed id, so this
   *  is an in-place update — the row's `id` and any attached `facility_aliases` are untouched).
   *  Always 0 on a dry run. */
  updated: number;
}

// Bounds every chunked query below (existing-id lookup, reference_change_log batch insert) well
// under any driver's parameter/IN-list ceiling. `insertBatchPg` does its own, tighter, column-count-
// aware chunking for the facility_registry write itself (see batch-upsert.ts) — this constant is for
// the narrower, single/few-column queries this module issues directly.
const CHUNK = 5000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Same hash `facility-registry-store.ts`'s interactive `upsert()` would log: `canonicalHash` of the
 *  record round-tripped through the row shape (`toRow` then `toRecord`), so a bulk-imported row and a
 *  later hand-edit of the same row compare against a matching content_hash in reference_change_log —
 *  not two independent hashing schemes drifting apart entity by entity. */
function contentHashOf(rec: FacilityRecord): string {
  return canonicalHash(facilityRowToRecord(facilityRecordToRow(rec) as never));
}

/**
 * Parse a national facility CSV and, if `apply` is set, write it into `facility_registry`.
 *
 * ## Batching decision (14 000-row workload)
 *
 * `facility-registry-store.ts`'s `upsert()` is a one-row-per-`db.transaction()` call — exactly right
 * for an interactive form save, and exactly the thing to avoid at register scale: 14 000 rows through
 * 14 000 separate transactions. This function instead opens ONE transaction for the whole apply and
 * writes `facility_registry` with `insertBatchPg` (packages/db/batch-upsert.ts), which chunks by
 * Postgres's parameter budget (60 000 params / 23 columns per row here, including the `updated_at`
 * bump below ⇒ floor(60000/23) = 2 608 rows/statement, so a 14 000-row register lands in 6 multi-row
 * `INSERT ... ON CONFLICT (id) DO UPDATE` statements, not 14 000 single-row ones).
 *
 * ## `reference_change_log` — how many rows, and the batching that matters there too
 *
 * `facility_registry` is a synced reference-entity type (see reference-change-log.ts's
 * `ENTITY_TYPES`), so every applied row legitimately needs a change_log entry for a lab's import to
 * ever reach central. On the FIRST import of a fresh register (the dominant real case — an empty or
 * sparsely-populated registry), that is up to 14 000 new reference_change_log rows. That volume is
 * correct, not a bug to eliminate — it is the record of 14 000 distinct entities that now need to sync.
 *
 * What DOES need batching is how those rows get written. The store's `capture.record()` binding
 * (`recordReferenceChange`) does one SELECT (find the entity's latest logged state) plus a conditional
 * INSERT — calling it per row, 14 000 times, is 14 000-28 000 sequential round trips even inside a
 * single transaction. This function splits on the existing-id lookup it already needs (to report
 * `created`/`updated`):
 *   - **Created rows** (id not already in `facility_registry`) can PROVABLY never hit
 *     `recordReferenceChange`'s dedup-skip: that skip only fires when the latest logged op is
 *     `'upsert'` with a matching content_hash, and an id currently absent from `facility_registry`
 *     has no logged `'upsert'` as its latest state (the only way to be absent is to have never been
 *     written, or to have been logged `'delete'` most recently — either way the next op is written
 *     unconditionally). So created rows skip the SELECT entirely and go straight into one batched
 *     multi-row `INSERT INTO reference_change_log` (chunked at `CHUNK` rows) — for the dominant
 *     first-import case this collapses the capture leg from up to 14 000 round trips to a small,
 *     constant number of statements.
 *   - **Updated rows** (id already present) still go through `capture.record()` per row, one at a
 *     time, because whether their content actually changed can only be answered by the dedup check
 *     `recordReferenceChange` already owns — reimplementing that comparison here would either
 *     duplicate its logic (drift risk: two hash-compare implementations disagreeing over time) or
 *     require its own extra bulk-fetch-and-compare pass, which is a reasonable follow-up but is
 *     deliberately NOT built in this task. A re-import of an already-imported register (the idempotent
 *     case the tests assert) is therefore the slower path — bounded by how many rows genuinely already
 *     exist, not by the full register size — and still correctly produces ZERO new change_log rows
 *     when nothing changed.
 *
 * `deps.capture` is optional; passing nothing skips reference_change_log entirely (no rows written,
 * import still applies to `facility_registry`).
 *
 * `managed_origin` is never set here — it stays NULL on every imported row (see facility-csv.ts's
 * docblock: the sync APPLIER stamps `'central'` on arrival, not an authoring path like this one).
 * Rows absent from the CSV are never touched, let alone deleted — an incomplete export must not orphan
 * a facility's aliases.
 */
export async function importFacilities(
  deps: FacilityImportDeps,
  csv: string,
  opts: FacilityImportOptions,
): Promise<FacilityImportResult> {
  const { records, unknownColumns, skipped } = parseFacilityCsv(csv, {
    nationalSystem: opts.nationalSystem,
    allowUnknownColumns: opts.allowUnknownColumns,
  });

  if (!opts.apply || records.length === 0) {
    return { parsed: records.length, skipped, unknownColumns, created: 0, updated: 0 };
  }

  const ids = records.map((r) => r.id);
  const existingIds = new Set<string>();
  for (const idChunk of chunk(ids, CHUNK)) {
    const rows = await deps.db
      .selectFrom('facility_registry')
      .select('id')
      .where('id', 'in', idChunk)
      .execute();
    for (const r of rows) existingIds.add(r.id);
  }

  let created = 0;
  let updated = 0;
  for (const id of ids) if (existingIds.has(id)) updated += 1; else created += 1;

  // sql`now()` on updated_at mirrors upsert()'s explicit bump on conflict — insertBatchPg's chunked
  // ON CONFLICT DO UPDATE otherwise leaves updated_at untouched on an update (it only ever writes
  // the columns present in the row).
  const rows = records.map((r) => ({ ...facilityRecordToRow(r), updated_at: sql`now()` }));

  await deps.db.transaction().execute(async (trx) => {
    await insertBatchPg(trx as unknown as Kysely<any>, 'facility_registry', rows as unknown as Record<string, unknown>[]);

    if (deps.capture) {
      const createdRows: { entity_type: 'facility_registry'; entity_id: string; op: 'upsert'; content_hash: string }[] = [];
      for (const rec of records) {
        if (existingIds.has(rec.id)) continue; // updated rows go through capture.record below
        createdRows.push({ entity_type: 'facility_registry', entity_id: rec.id, op: 'upsert', content_hash: contentHashOf(rec) });
      }
      for (const rowChunk of chunk(createdRows, CHUNK)) {
        await (trx as Transaction<InternalSchema>).insertInto('reference_change_log').values(rowChunk).execute();
      }

      for (const rec of records) {
        if (!existingIds.has(rec.id)) continue; // created rows were already batched above
        await deps.capture.record(trx, 'facility_registry', rec.id, 'upsert', contentHashOf(rec));
      }
    }
  });

  return { parsed: records.length, skipped, unknownColumns, created, updated };
}
