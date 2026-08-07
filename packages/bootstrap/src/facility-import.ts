import { type Kysely, sql } from 'kysely';
import { parseFacilityCsv, type QuarantinedRow } from '@openldr/terminology';
import {
  type FacilityRecord,
  type InternalSchema,
  type ReferenceCapture,
  type TerminologyAdminStore,
  insertBatchPg,
  facilityRecordToRow,
} from '@openldr/db';
import { projectRegistryRows } from './facility-reconcile';

// Task 2 of the facility-import slice: `parseFacilityCsv` (packages/terminology) exists, is tested,
// and has ZERO callers — this is the one shared function that actually writes a parsed register into
// `facility_registry`, so Task 3 (CLI) and Task 4 (HTTP route) can both wrap it instead of duplicating
// write logic (the repo's CLI-parity rule).

export interface FacilityImportDeps {
  db: Kysely<InternalSchema>;
  /** Reference-sync capture binding (see @openldr/db's ReferenceCapture). Omit to import without
   *  emitting reference_change_log rows at all — e.g. a throwaway/local import that must never sync. */
  capture?: ReferenceCapture;
  /** Fix 1 (mapping-ux report): when supplied, every row this import writes is also projected into
   *  `FACILITY_REGISTRY_SYSTEM` (`projectRegistryRows`, `facility-reconcile.ts`) so an imported
   *  register is a usable mapping target immediately — no separate operator publish step. Omit to
   *  import without projecting (e.g. a throwaway/local import, mirroring `capture` above). */
  admin?: TerminologyAdminStore;
}

export interface FacilityImportOptions {
  /** Which national register these codes belong to. Configuration, never hardcoded — see
   *  facility-csv.ts's `FacilityCsvOptions.nationalSystem`. */
  nationalSystem: string;
  /** Import despite unrecognised columns, carrying them into each record's `extras`. */
  allowUnknownColumns?: boolean;
  /** Apply despite structurally malformed rows (see `FacilityImportResult.quarantined`) — the
   *  explicit "I have seen the line numbers, import the rest" override, mirroring
   *  `allowUnknownColumns` above so a problem file has exactly one idiom for proceeding anyway.
   *  There is no equivalent override for duplicate headers: see `duplicateColumns` below. */
  allowMalformedRows?: boolean;
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
  /** Headers appearing more than once (see facility-csv.ts's `duplicateColumns`). Non-empty ⇒
   *  `apply` is always blocked — there is no override, unlike `quarantined` below: which of two
   *  identically-named columns wins is arbitrary, so applying either is a guess about master data. */
  duplicateColumns: string[];
  /** Rows whose field count did not match the header's — never mapped to columns (see
   *  facility-csv.ts's `QuarantinedRow`). Non-empty ⇒ `apply` is blocked unless the caller sets
   *  `allowMalformedRows`. Present on a dry run too, same as every sibling counter here, so an
   *  operator can see the damage before ever applying. */
  quarantined: QuarantinedRow[];
  /** Rows written that did not previously exist. Always 0 on a dry run. */
  created: number;
  /** Rows written that already existed (same nationalSystem+nationalCode ⇒ same hashed id, so this
   *  is an in-place update — the row's `id` is untouched).
   *  Always 0 on a dry run. */
  updated: number;
  /** How many accepted rows shared a `national_code` (and therefore a generated `id`) with another
   *  row later in the same file — last row wins, matching what a per-row `store.upsert` loop would
   *  have done. Always present, 0 on a clean file, like every sibling counter here. Present on a
   *  dry run too, so an operator can be warned about a repeated code before ever applying. Why this
   *  matters: on real Postgres, two rows carrying the same conflict key inside one multi-row
   *  `INSERT ... ON CONFLICT (id) DO UPDATE` throw `ON CONFLICT DO UPDATE command cannot affect row
   *  a second time` and abort the WHOLE import — a routine hazard in national register exports
   *  (concatenated releases, re-appended files), so duplicates are collapsed before ever reaching
   *  the batch writer instead of being left to explode there. */
  duplicates: number;
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

/**
 * Parse a national facility CSV and, if `apply` is set, write it into `facility_registry`.
 *
 * ## Structural damage blocks apply (facilities-phase-0 Task 4)
 *
 * A row whose field count disagrees with the header's is QUARANTINED by `parseFacilityCsv`, not
 * mapped into a record at all (see facility-csv.ts). `apply` refuses to run while any such row
 * exists, unless the caller sets `allowMalformedRows` — the same explicit-override shape as
 * `allowUnknownColumns`, so a problem file has exactly one idiom for proceeding anyway. Duplicate
 * headers get NO override, ever: which of two identically-named columns wins is arbitrary, so
 * applying either is a guess about master data rather than a documented trade. A dry run always
 * reports both `quarantined` and `duplicateColumns` regardless of the override, since a dry run
 * writes nothing to begin with.
 *
 * ## Batching decision (14 000-row workload)
 *
 * `facility-registry-store.ts`'s `upsert()` is a one-row-per-`db.transaction()` call — exactly right
 * for an interactive form save, and exactly the thing to avoid at register scale: 14 000 rows through
 * 14 000 separate transactions. This function instead opens ONE transaction for the whole apply and
 * writes `facility_registry` with `insertBatchPg` (packages/db/batch-upsert.ts), which chunks by
 * Postgres's parameter budget: it sizes the chunk off the row's 23 keys (including the `updated_at`
 * bump below) ⇒ floor(60000/23) = 2 608 rows/statement, so a 14 000-row register lands in 6 multi-row
 * `INSERT ... ON CONFLICT (id) DO UPDATE` statements, not 14 000 single-row ones. That chunk size is
 * conservative, not exact: `updated_at`'s value is the raw fragment `sql\`now()\``, which binds ZERO
 * parameters, so a full 2 608-row chunk actually carries 22 real binds/row = 57 376 params, not
 * 60 000 — comfortably under Postgres's 65 535-param hard limit, with more headroom than the
 * 23-column arithmetic alone would suggest.
 *
 * ## `reference_change_log` — SUSPENDED (facilities-phase-0 Task 1)
 *
 * This import used to also write `reference_change_log` rows for every applied row — batched for
 * created rows, per-row through `deps.capture.record()` for updated rows (the design that batching
 * split is history now; see git blame if you need the "why batch at all" reasoning). It doesn't
 * anymore: `facility_registry` was registered as a synced reference-entity type before its serve and
 * apply cases existed, which made every upsert this importer logged reach a lab as a bogus DELETE
 * (`sync-serve.ts`'s `fetchReferenceBody` had no case for it, so a null body downgraded the record).
 * See `SUSPENDED_REFERENCE_ENTITY_TYPES` in `reference-change-log.ts`. `deps.capture` stays on
 * `FacilityImportDeps` — unused for now — so re-enabling is restoring this section, not reshaping
 * the deps the CLI and HTTP route already pass in.
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
 * `deps.db.transaction()` would make the window below strictly wider (the lookup and the write
 * would no longer even be part of the same transaction). Moving it inside does NOT close the
 * window, though: this database runs at the default `read committed` isolation (nothing in
 * packages/db overrides it), so a concurrent commit landing between this SELECT and the later
 * `INSERT ... ON CONFLICT DO UPDATE` is still possible and still visible to both:
 *   - **Lost update**: an operator's hand-edit (e.g. adding an `extras` key) commits after this
 *     SELECT reads the pre-edit row but before the upsert below writes its JS-computed merge —
 *     the operator's edit is silently overwritten by this import's stale in-memory merge.
 *   - **Misclassification**: a concurrent INSERT of the same id commits after this SELECT finds
 *     it absent — the row is counted `created` and takes the batched change_log fast path (see
 *     below) even though the upsert itself takes the DO UPDATE branch.
 * Actually closing either window would need `.forUpdate()` on the lookup, `REPEATABLE READ` (or
 * stricter) for the whole transaction, or a SQL-side merge (e.g.
 * `extras = facility_registry.extras || excluded.extras`) instead of a JS-side one — the last of
 * which would change `insertBatchPg` itself. None of those are done here: the exposure is a
 * hand-edit racing a register import, narrow enough that this function only reports it honestly
 * rather than closing it.
 */
export async function importFacilities(
  deps: FacilityImportDeps,
  csv: string,
  opts: FacilityImportOptions,
): Promise<FacilityImportResult> {
  const { records: parsedRecords, unknownColumns, duplicateColumns, quarantined, skipped } =
    parseFacilityCsv(csv, {
      nationalSystem: opts.nationalSystem,
      allowUnknownColumns: opts.allowUnknownColumns,
    });
  // Collapse same-id rows (a repeated national_code within one file) BEFORE anything downstream
  // ever sees them — see dedupeById's docblock for why this can't wait until insertBatchPg.
  const { records, duplicates } = dedupeById(parsedRecords);

  // Structural damage BLOCKS apply. `allowMalformedRows` is the explicit "I have seen the line
  // numbers, import the rest" override — the same shape as `allowUnknownColumns` above, so a file
  // with something wrong with it has exactly one idiom for proceeding anyway. Duplicate headers have
  // NO override: which of two identically-named columns wins is arbitrary, so applying either is a
  // guess about master data rather than a documented trade.
  const blocked =
    duplicateColumns.length > 0 || (quarantined.length > 0 && !opts.allowMalformedRows);

  if (!opts.apply || blocked || records.length === 0) {
    return {
      parsed: parsedRecords.length, skipped, unknownColumns, duplicateColumns, quarantined,
      created: 0, updated: 0, duplicates,
    };
  }

  const ids = records.map((r) => r.id);

  let created = 0;
  let updated = 0;
  // Populated inside the transaction below, read afterwards to drive the registry projection —
  // see the projectRegistryRows call after the transaction commits for why that has to happen
  // outside it.
  let mergedRecords: FacilityRecord[] = [];

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
    // deriving the row to write — it needs to reflect what actually lands in facility_registry, not
    // the raw parsed record, for exactly the rows this merge touches. (This step used to also feed a
    // content_hash logged into reference_change_log via `contentHashOf`/`hashOf`; both were removed
    // as dead code once facilities-phase-0 Task 1 suspended that capture — see the "SUSPENDED"
    // docblock section above.)
    const merged: FacilityRecord[] = records.map((r) => {
      const existing = existingById.get(r.id);
      if (!existing) return r;
      return {
        ...r,
        localCode: r.localCode ?? existing.local_code ?? null,
        extras: { ...((existing.extras as Record<string, unknown>) ?? {}), ...(r.extras ?? {}) },
      };
    });

    mergedRecords = merged;

    // sql`now()` on updated_at mirrors upsert()'s explicit bump on conflict — insertBatchPg's chunked
    // ON CONFLICT DO UPDATE otherwise leaves updated_at untouched on an update (it only ever writes
    // the columns present in the row).
    const rows = merged.map((r) => ({ ...facilityRecordToRow(r), updated_at: sql`now()` }));
    await insertBatchPg(trx as unknown as Kysely<any>, 'facility_registry', rows as unknown as Record<string, unknown>[]);

    // Capture SUSPENDED (Task 1 of the facilities-phase-0 slice) — see SUSPENDED_REFERENCE_ENTITY_TYPES
    // in reference-change-log.ts. This batch import path used to write reference_change_log rows
    // directly (bypassing capture.record for the fast "created" leg — see the docblock above) AND call
    // deps.capture.record per updated row; both are gone now that facility_registry is not in
    // ReferenceEntityType. `deps.capture` stays on FacilityImportDeps so re-enabling is restoring this
    // block, not re-wiring the deps shape.
  });

  // Fix 1 (mapping-ux report): project every written row into FACILITY_REGISTRY_SYSTEM, outside the
  // transaction above and after it has committed — a projection failure must not roll back (or even
  // slow down) the facility_registry write itself, and `projectRegistryRows` already swallows its
  // own failures (see that function's doc comment) so this call cannot throw.
  if (deps.admin) await projectRegistryRows({ internalDb: deps.db, admin: deps.admin }, mergedRecords);

  return {
    parsed: parsedRecords.length, skipped, unknownColumns, duplicateColumns, quarantined,
    created, updated, duplicates,
  };
}
