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
  /** Rows the parser accepted (present regardless of `apply`, even on a dry run). Counts every
   *  accepted row, INCLUDING rows later collapsed by `duplicates` — this is what the parser saw,
   *  not what got written. */
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
  /** How many accepted rows shared a `national_code` (and therefore a generated `id`) with another
   *  row later in the same file — last row wins, matching what a per-row `store.upsert` loop would
   *  have done. Only present (and only ever >0) when the file actually had a collision; omitted
   *  entirely otherwise, so a clean file's result is unchanged. Present on a dry run too, so an
   *  operator can be warned about a repeated code before ever applying. Why this matters: on real
   *  Postgres, two rows carrying the same conflict key inside one multi-row
   *  `INSERT ... ON CONFLICT (id) DO UPDATE` throw `ON CONFLICT DO UPDATE command cannot affect row
   *  a second time` and abort the WHOLE import — a routine hazard in national register exports
   *  (concatenated releases, re-appended files), so duplicates are collapsed before ever reaching
   *  the batch writer instead of being left to explode there. */
  duplicates?: number;
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

/** Collapse rows that share an `id` (i.e. the same `nationalSystem`+`nationalCode`, since
 *  `facility-csv.ts` derives `id` deterministically from that pair) down to one, keeping the LAST
 *  occurrence — the same outcome a per-row `store.upsert` loop would have produced, since each
 *  later call would simply overwrite the row the earlier call wrote. This has to happen before
 *  anything reaches `insertBatchPg`: two rows carrying the same `id` land in the SAME multi-row
 *  `INSERT ... ON CONFLICT (id) DO UPDATE`, and real Postgres rejects a duplicate conflict target
 *  within one statement outright (`ON CONFLICT DO UPDATE command cannot affect row a second time`)
 *  — the whole statement (and, since this all runs in one transaction, the whole import) aborts.
 *  pg-mem, this suite's test oracle, does NOT enforce that constraint, so a regression here is
 *  invisible to every test that only asserts the import as a whole succeeds; the dedicated dedupe
 *  test below asserts the deduped shape directly instead. */
function dedupeById(records: FacilityRecord[]): { records: FacilityRecord[]; duplicates: number } {
  const byId = new Map<string, FacilityRecord>();
  for (const r of records) byId.set(r.id, r); // re-`set`ting an existing key overwrites its value, not its position — last row wins.
  return { records: [...byId.values()], duplicates: records.length - byId.size };
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
 *   - **Created rows** (id not already in `facility_registry`) are assumed to never hit
 *     `recordReferenceChange`'s dedup-skip: that skip only fires when the latest logged op is
 *     `'upsert'` with a matching content_hash, and under normal write paths an id currently absent
 *     from `facility_registry` has no logged `'upsert'` as its latest state (the only way to be
 *     absent is to have never been written, or to have been logged `'delete'` most recently —
 *     either way the next op is written unconditionally). So created rows skip the SELECT entirely
 *     and go straight into one batched multi-row `INSERT INTO reference_change_log` (chunked at
 *     `CHUNK` rows) — for the dominant first-import case this collapses the capture leg from up to
 *     14 000 round trips to a small, constant number of statements.
 *     ⚠ This is NOT airtight against a raw/manual delete: `DELETE FROM facility_registry` run
 *     outside `store.remove()` (which itself calls `capture.record(..., 'delete', null)`) leaves
 *     `reference_change_log`'s latest entry for that id as `'upsert'`. A subsequent re-import of the
 *     same id is then misclassified as `created` (the row IS absent from `facility_registry`) and
 *     takes this fast path — producing a second, identical `'upsert'` log row that `recordReferenceChange`
 *     would otherwise have deduped away. Reachable only via a raw/manual delete that bypasses the
 *     store, so harmless in practice, but real: do not read the paragraph above as a proof with no
 *     counter-example.
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
 *
 * ## What a re-import is, and is not, authoritative for
 *
 * This importer is authoritative for the national fields it parses out of the CSV — but
 * `parseFacilityCsv` never produces a `localCode` (there is no such column in the contract) and
 * only ever produces `extras` keys for columns the contract doesn't define. `local_code` is a
 * UNIQUE column an operator assigns by hand, and `extras` routinely accumulates operator-curated
 * keys an import didn't write. On a row that already exists, this function preserves the existing
 * `local_code` when the incoming row has none, and shallow-merges `extras` (incoming keys win,
 * untouched existing keys survive) — the mirror image of commit 3e0daa92's fix for the PUT/edit
 * direction in `apps/server/facilities-routes.ts`, which protects extras through a hand-edit the
 * same way this protects local_code and extras through a re-import.
 *
 * The existing-row lookup that this merge (and the created/updated split above) depends on runs
 * INSIDE the same transaction as the write, not before it — a lookup on `deps.db` ahead of
 * `deps.db.transaction()` would leave a window for a concurrent insert to land between the two,
 * misclassifying a row that in fact already exists by commit time as `created`.
 */
export async function importFacilities(
  deps: FacilityImportDeps,
  csv: string,
  opts: FacilityImportOptions,
): Promise<FacilityImportResult> {
  const { records: parsedRecords, unknownColumns, skipped } = parseFacilityCsv(csv, {
    nationalSystem: opts.nationalSystem,
    allowUnknownColumns: opts.allowUnknownColumns,
  });
  // Collapse same-id rows (a repeated national_code within one file) BEFORE anything downstream
  // ever sees them — see dedupeById's docblock for why this can't wait until insertBatchPg.
  const { records, duplicates } = dedupeById(parsedRecords);

  if (!opts.apply || records.length === 0) {
    const result: FacilityImportResult = { parsed: parsedRecords.length, skipped, unknownColumns, created: 0, updated: 0 };
    if (duplicates > 0) result.duplicates = duplicates;
    return result;
  }

  const ids = records.map((r) => r.id);

  let created = 0;
  let updated = 0;

  await deps.db.transaction().execute(async (trx) => {
    // Existing-row lookup runs on `trx`, inside this transaction, not on `deps.db` before it opens
    // (see the docblock above) — and it fetches local_code/extras, not just id, because both need
    // to be preserved across a re-import rather than overwritten with the importer's blanks.
    const existingById = new Map<string, { local_code: string | null; extras: unknown }>();
    for (const idChunk of chunk(ids, CHUNK)) {
      const rows = await trx
        .selectFrom('facility_registry')
        .select(['id', 'local_code', 'extras'])
        .where('id', 'in', idChunk)
        .execute();
      for (const r of rows) existingById.set(r.id, { local_code: r.local_code, extras: r.extras });
    }

    for (const id of ids) if (existingById.has(id)) updated += 1; else created += 1;

    // Merge forward what the importer is NOT authoritative for (see the docblock above) before
    // deriving either the row to write or the content_hash to log — both need to reflect what
    // actually lands in facility_registry, not the raw parsed record, or the hash logged here would
    // drift from `hashOf(stored)` in facility-registry-store.ts's `upsert()` for exactly the rows
    // this merge touches.
    const merged: FacilityRecord[] = records.map((r) => {
      const existing = existingById.get(r.id);
      if (!existing) return r;
      return {
        ...r,
        localCode: r.localCode ?? existing.local_code ?? null,
        extras: { ...((existing.extras as Record<string, unknown>) ?? {}), ...(r.extras ?? {}) },
      };
    });

    // sql`now()` on updated_at mirrors upsert()'s explicit bump on conflict — insertBatchPg's chunked
    // ON CONFLICT DO UPDATE otherwise leaves updated_at untouched on an update (it only ever writes
    // the columns present in the row).
    const rows = merged.map((r) => ({ ...facilityRecordToRow(r), updated_at: sql`now()` }));
    await insertBatchPg(trx as unknown as Kysely<any>, 'facility_registry', rows as unknown as Record<string, unknown>[]);

    if (deps.capture) {
      const createdRows: { entity_type: 'facility_registry'; entity_id: string; op: 'upsert'; content_hash: string }[] = [];
      for (const rec of merged) {
        if (existingById.has(rec.id)) continue; // updated rows go through capture.record below
        createdRows.push({ entity_type: 'facility_registry', entity_id: rec.id, op: 'upsert', content_hash: contentHashOf(rec) });
      }
      for (const rowChunk of chunk(createdRows, CHUNK)) {
        await (trx as Transaction<InternalSchema>).insertInto('reference_change_log').values(rowChunk).execute();
      }

      for (const rec of merged) {
        if (!existingById.has(rec.id)) continue; // created rows were already batched above
        await deps.capture.record(trx, 'facility_registry', rec.id, 'upsert', contentHashOf(rec));
      }
    }
  });

  const result: FacilityImportResult = { parsed: parsedRecords.length, skipped, unknownColumns, created, updated };
  if (duplicates > 0) result.duplicates = duplicates;
  return result;
}
