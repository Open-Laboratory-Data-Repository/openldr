import { type Kysely, sql } from 'kysely';
import { parseFacilityCsv, type QuarantinedRow, type RowError } from '@openldr/terminology';
import {
  type FacilityRecord,
  type InternalSchema,
  type ReferenceCapture,
  type TerminologyAdminStore,
  type FacilityJobStore,
  insertBatchPg,
  facilityRecordToRow,
} from '@openldr/db';
import { classifyFacilityRows, type ClassifiedRow, type ExistingFacility } from './facility-classify';
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
  /** Task 5 (facility-durable-updates): when supplied, an applied import enqueues ONE
   *  `facility-map-rebuild` job — the report-facing `facility_map` dimension is stale the moment
   *  this write commits, same as a single create/update/delete through the Facilities page. Optional,
   *  mirroring `admin`/`capture` above, so the CLI and any existing caller that omits it keeps
   *  working unchanged. */
  facilityJobs?: FacilityJobStore;
  /** Where a lost `facilityJobs.enqueue` is reported. Optional and structurally minimal so a caller
   *  can hand in the `AppContext`'s pino logger without this module taking a dependency on it; when
   *  omitted the same message goes to `console.error`, matching `projectRegistryRows`' precedent in
   *  facility-reconcile.ts. Never a reason to fail an import — see the enqueue call below. */
  logger?: { error(obj: unknown, msg?: string): void };
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
  /** The `facility_import_runs` row this call belongs to, echoed back on `result.runId`.
   *
   *  ⛔ This function does NOT load the run, and deliberately takes no dependency on
   *  `FacilityImportRunStore`: the CALLER resolves the run and hands in both this id and the
   *  `previewedAt` watermark below. Keeping the run store out of `deps` is what lets the CLI, the
   *  tests and the HTTP route call this with exactly the deps they already had. */
  runId?: string | null;
  /** The `previewed_at` of the run named by `runId` — the conflict watermark. An existing row whose
   *  `updated_at` is NEWER than this was touched between the preview the operator read and this
   *  call, so it is classified `conflict` rather than compared field-by-field.
   *
   *  ⛔ Omitted/null means conflicts were NOT EVALUATED, and `result.conflict` is `null` to say so —
   *  never `0`, which would assert a measurement that was never taken (see `FacilityImportResult`). */
  previewedAt?: Date | null;
}

/** One row of a per-bucket sample, identifying the facility without shipping the whole record. */
export interface FacilitySample {
  id: string;
  nationalCode: string | null;
  name: string;
}

export interface FacilityChangeSample extends FacilitySample {
  /** Only the fields that actually differ, `before` from the registry and `after` from the merge
   *  this import would write (see `classifyFacilityRows`). */
  diff: { field: string; before: unknown; after: unknown }[];
}

export type FacilityImportBlockedReason = 'duplicate-columns' | 'quarantined-rows' | null;

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
  /** Rows the parser REJECTED for an unparseable, out-of-range or half-supplied coordinate (see
   *  facility-csv.ts's `RowError`). Distinct from `skipped` (a missing REQUIRED value) and from
   *  `quarantined` (a field count disagreeing with the header's): a row here was otherwise
   *  well-formed. Excluded from `records` by the parser, so it is counted in NO bucket below —
   *  this array is the only place it is visible at all. */
  invalid: RowError[];
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
  /** Whether this file may be applied AT ALL — the ONE authoritative answer, computed once in
   *  `importFacilities` and reported rather than re-derived.
   *
   *  ⛔ Every consumer that gates on "is this import blocked?" must read THIS, not rebuild the
   *  predicate. The route, the CLI and the Studio import sheet each used to re-derive a strictly
   *  NARROWER version (the quarantine clause only) and agreed with the importer purely by accident:
   *  `parseFacilityCsv` returns `records: []` whenever headers are duplicated, so a separate
   *  "nothing parsed" guard happened to catch the case their own predicate missed. That is a
   *  coincidence of the parser's shape, not a contract — and one of the three re-derivations guards
   *  a WRITE transaction. */
  blocked: boolean;
  /** Why `blocked` is true, or null when it is false. A machine token, not a message: each consumer
   *  already renders its own explanation for these two cases (line-numbered quarantine detail, the
   *  duplicate column names), and this exists so a consumer can tell them apart without inspecting
   *  `duplicateColumns`/`quarantined` and re-deriving the precedence.
   *
   *  `'duplicate-columns'` wins when both hold: it has NO override, so reporting the overridable
   *  reason would offer an operator a switch that cannot unblock the file. */
  blockedReason: FacilityImportBlockedReason;

  // ── What this file would DO to the registry ───────────────────────────────────────────────────
  //
  // Computed on EVERY call, preview and apply alike, by comparing each parsed row against the row
  // already in `facility_registry` (see `classifyFacilityRows`). Before FAC-P1-03 a preview
  // returned before this comparison ever happened and reported `created: 0, updated: 0` — numbers
  // that meant "not computed" while reading as "nothing to do".

  /** Rows with no existing registry row for their id. */
  create: number;
  /** Existing rows at least one compared field of which differs from what this import would write. */
  changed: number;
  /** Existing rows this import would write nothing new to. Measured: re-importing a byte-identical
   *  13 000-row national release reported `updated: 13000` before this bucket existed. */
  unchanged: number;
  /** Existing rows touched since the preview watermark (`FacilityImportOptions.previewedAt`).
   *
   *  ⛔ `null` means NOT EVALUATED, never "none": null on any call with no `previewedAt` linking it
   *  to a preview, because there is then no watermark to compare `updated_at` against. */
  conflict: number | null;
  /** Registry rows for this `nationalSystem` that the file does not mention.
   *
   *  ⛔ `null` means NOT EVALUATED, never "none". Always null today — computing it requires the
   *  caller to declare the file a COMPLETE release, which is Task 9 of this slice and not
   *  implemented here. For a partial district register, absence means nothing at all. */
  absent: number | null;
  /** Rows the PUBLISHER explicitly declared removed. Always 0 for CSV, which has no way to express
   *  a removal — a row is either in the file or it is not (which is `absent`, an inference). */
  deleted: number;

  /** Bounded per-bucket samples (at most `SAMPLE_LIMIT` each) so an operator can see WHICH rows a
   *  count refers to without the result carrying 13 000 row diffs. */
  samples: {
    create: FacilitySample[];
    changed: FacilityChangeSample[];
    conflict: FacilitySample[];
    absent: FacilitySample[];
    deleted: FacilitySample[];
  };

  /** What was actually WRITTEN, as opposed to what was classified above.
   *
   *  ⛔ NESTED, deliberately. A flat `created`/`updated` beside `create`/`changed` differs from it
   *  only by TENSE, and `result.create` vs `result.created` is a typo that type-checks and silently
   *  reads the wrong number. Nesting makes the two vocabularies impossible to confuse at a call
   *  site. Every consumer (route, studio, CLI) reads `written.created`, never `created`.
   *
   *  Both 0 on a preview — now because nothing was WRITTEN, not because nothing was computed. */
  written: { created: number; updated: number };
  /** Whatever `FacilityImportOptions.runId` carried in, echoed back so a caller that resolved a run
   *  can attach this result to it without threading the id through itself. Null when none was
   *  supplied — this function never invents or looks one up. */
  runId: string | null;
  /** False when this `nationalSystem` matches no existing registry row — i.e. this import creates a
   *  NEW register identity, which is worth telling an operator who mistyped one.
   *
   *  ⛔ Owned by the ROUTE (Task 10), which is what actually asks that question; `importFacilities`
   *  has no basis for it and reports the neutral `true`. */
  knownNationalSystem: boolean;
}

// Bounds every chunked query below (existing-id lookup, reference_change_log batch insert) well
// under any driver's parameter/IN-list ceiling. `insertBatchPg` does its own, tighter, column-count-
// aware chunking for the facility_registry write itself (see batch-upsert.ts) — this constant is for
// the narrower, single/few-column queries this module issues directly.
const CHUNK = 5000;

/** How many rows each `samples` bucket carries. Bounded because a national release can classify
 *  13 000 rows into one bucket and this result is returned over HTTP and stored in an audit
 *  event's `metadata` — the complete classified set belongs in a downloadable artefact, not here. */
const SAMPLE_LIMIT = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Load every registry row this import might touch, in the shape `classifyFacilityRows` needs.
 *
 * ⛔ Takes an executor rather than reaching for `deps.db` itself, because WHICH executor it runs on
 * is load-bearing and differs between the two paths: on the APPLY path it must run inside the same
 * transaction as the write (see the docblock below for the race that keeps it there), while on the
 * PREVIEW path there is no transaction to be inside — a preview writes nothing.
 *
 * `selectAll()` rather than a column list, because a column MISSED here fails silently rather than
 * loudly: every field on `FacilityRecord` bar `id`/`name`/`source` is optional, so an omitted column
 * reaches `classifyFacilityRows` as `undefined`, and its `same()` treats `undefined` and `null`
 * alike as "no value" — the row would classify `unchanged` against a write that changes it. It also
 * buys nothing: of `facility_registry`'s 24 columns this uses 22, all but `source` and `created_at`.
 */
async function loadExisting(
  exec: Kysely<InternalSchema>, ids: string[],
): Promise<Map<string, ExistingFacility>> {
  const out = new Map<string, ExistingFacility>();
  for (const idChunk of chunk(ids, CHUNK)) {
    const rows = await exec.selectFrom('facility_registry').selectAll().where('id', 'in', idChunk).execute();
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        localCode: r.local_code,
        extras: (r.extras as Record<string, unknown> | null) ?? null,
        fields: {
          nationalSystem: r.national_system, nationalCode: r.national_code, name: r.name,
          level: r.level, ownership: r.ownership, status: r.status, country: r.country,
          zone: r.zone, region: r.region, district: r.district, council: r.council,
          ward: r.ward, village: r.village, addressText: r.address_text, phone: r.phone,
          latitude: r.latitude, longitude: r.longitude, managedOrigin: r.managed_origin,
        },
        updatedAt: r.updated_at,
      });
    }
  }
  return out;
}

const sampleOf = (r: FacilityRecord): FacilitySample =>
  ({ id: r.id, nationalCode: r.nationalCode ?? null, name: r.name });

/** Fold the classified rows into the counts and bounded samples the result reports. Shared by both
 *  return paths below, so the preview's numbers and the apply's are produced by the same code —
 *  which is the whole point of FAC-P1-03: they cannot drift, because there is nothing to drift. */
function summarise(classified: ClassifiedRow[]) {
  const counts = { create: 0, changed: 0, unchanged: 0, conflict: 0 };
  const samples: { create: FacilitySample[]; changed: FacilityChangeSample[]; conflict: FacilitySample[] } =
    { create: [], changed: [], conflict: [] };
  for (const row of classified) {
    counts[row.kind] += 1;
    if (row.kind === 'unchanged') continue; // no sample bucket: there is nothing to show.
    if (row.kind === 'changed') {
      if (samples.changed.length < SAMPLE_LIMIT) samples.changed.push({ ...sampleOf(row.merged), diff: row.diff });
    } else if (samples[row.kind].length < SAMPLE_LIMIT) {
      samples[row.kind].push(sampleOf(row.merged));
    }
  }
  return { counts, samples };
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
 * On the APPLY path, the existing-row lookup that this merge (and the classification below) depends
 * on runs INSIDE the same transaction as the write, not before it — a lookup on `deps.db` ahead of
 * `deps.db.transaction()` would make the window below strictly wider (the lookup and the write
 * would no longer even be part of the same transaction). Moving it inside does NOT close the
 * window, though: this database runs at the default `read committed` isolation (nothing in
 * packages/db overrides it), so a concurrent commit landing between this SELECT and the later
 * `INSERT ... ON CONFLICT DO UPDATE` is still possible and still visible to both:
 *   - **Lost update**: an operator's hand-edit (e.g. adding an `extras` key) commits after this
 *     SELECT reads the pre-edit row but before the upsert below writes its JS-computed merge —
 *     the operator's edit is silently overwritten by this import's stale in-memory merge.
 *   - **Misclassification**: a concurrent INSERT of the same id commits after this SELECT finds
 *     it absent — the row is classified `create` even though the upsert itself takes the DO UPDATE
 *     branch.
 * Actually closing either window would need `.forUpdate()` on the lookup, `REPEATABLE READ` (or
 * stricter) for the whole transaction, or a SQL-side merge (e.g.
 * `extras = facility_registry.extras || excluded.extras`) instead of a JS-side one — the last of
 * which would change `insertBatchPg` itself. None of those are done here: the exposure is a
 * hand-edit racing a register import, narrow enough that this function only reports it honestly
 * rather than closing it. `FacilityImportOptions.previewedAt` narrows a DIFFERENT window — an
 * operator's edit landing between the preview they read and the apply they then confirmed — and
 * does nothing about this one.
 *
 * ## Preview and apply are the same computation (FAC-P1-03)
 *
 * A dry run used to return before ever touching the registry, reporting `created: 0, updated: 0`.
 * Both paths now run `classifyFacilityRows` against the real rows and report the same
 * `create`/`changed`/`unchanged`/`conflict` buckets; they differ only in whether the write below
 * runs, which is what `written` (and only `written`) reports. Classification happens exactly ONCE
 * per call — on the apply path that one call is the one inside the transaction, so `written`
 * describes the same rows the statement actually wrote.
 */
export async function importFacilities(
  deps: FacilityImportDeps,
  csv: string,
  opts: FacilityImportOptions,
): Promise<FacilityImportResult> {
  const { records: parsedRecords, unknownColumns, duplicateColumns, quarantined, skipped, invalid } =
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
  //
  // Both are REPORTED on the result (`blocked`/`blockedReason`), not merely acted on here: three
  // separate consumers gate on this same question, and each one that re-derives it is a chance to
  // derive it differently. See `FacilityImportResult.blocked`.
  const blockedReason: FacilityImportResult['blockedReason'] =
    duplicateColumns.length > 0
      ? 'duplicate-columns'
      : (quarantined.length > 0 && !opts.allowMalformedRows ? 'quarantined-rows' : null);
  const blocked = blockedReason !== null;

  const ids = records.map((r) => r.id);
  // ⛔ Only `previewedAt` decides whether conflicts were EVALUATED, and it is threaded through to
  // both `classifyFacilityRows` and the reported `conflict` from this one place — so a run that
  // reports a number is exactly a run that computed one.
  const previewedAt = opts.previewedAt ?? null;
  const conflictsEvaluated = previewedAt !== null;

  /** Shape a classification into the reported result. `written` is the caller's to supply: it is the
   *  ONE thing the two paths genuinely disagree about. */
  const resultOf = (
    classified: ClassifiedRow[], written: { created: number; updated: number },
  ): FacilityImportResult => {
    const { counts, samples } = summarise(classified);
    return {
      parsed: parsedRecords.length, skipped, unknownColumns, duplicateColumns, quarantined, invalid,
      duplicates, blocked, blockedReason,
      create: counts.create, changed: counts.changed, unchanged: counts.unchanged,
      conflict: conflictsEvaluated ? counts.conflict : null,
      // Task 9 of this slice owns `absent` (it needs `completeRelease` to mean anything) and the
      // `deleted` bucket a JSONL release can declare. Until then: not evaluated, and 0 removals,
      // which for CSV is not a placeholder but the truth — CSV cannot express a removal.
      absent: null,
      deleted: 0,
      samples: { ...samples, absent: [], deleted: [] },
      written,
      runId: opts.runId ?? null,
      // Owned by the route (Task 10) — see the field's doc comment. Nothing here can answer it.
      knownNationalSystem: true,
    };
  };

  if (!opts.apply || blocked || records.length === 0) {
    // ⛔ The lookup runs on the PREVIEW path too, and that is the entire fix for FAC-P1-03: this
    // branch used to return `created: 0, updated: 0` without ever asking the registry anything.
    // It also runs for a BLOCKED file (which, when the reason is `'quarantined-rows'`, still has
    // rows): the operator's next move is to tick the override and apply, so the counts they are
    // reading now must describe the registry rather than assume an empty one.
    const existing = records.length === 0 ? new Map<string, ExistingFacility>() : await loadExisting(deps.db, ids);
    return resultOf(classifyFacilityRows(records, existing, { previewedAt }), { created: 0, updated: 0 });
  }

  let classified: ClassifiedRow[] = [];
  const written = { created: 0, updated: 0 };
  // Populated inside the transaction below, read afterwards to drive the registry projection —
  // see the projectRegistryRows call after the transaction commits for why that has to happen
  // outside it.
  let mergedRecords: FacilityRecord[] = [];

  await deps.db.transaction().execute(async (trx) => {
    // Existing-row lookup runs on `trx`, inside this transaction, not on `deps.db` before it opens
    // (see the docblock above) — and it fetches whole rows, not just id, because `classifyFacilityRows`
    // both COMPARES the parser's columns against them and MERGES local_code/extras forward off them,
    // rather than overwriting those with the importer's blanks.
    const existingById = await loadExisting(trx, ids);

    // The merge for what the importer is NOT authoritative for (see the docblock above) lives inside
    // `classifyFacilityRows` now, and each row's `.merged` is exactly what the statement below
    // writes — so the row the comparison called `changed` and the row written cannot differ. (This
    // step used to also feed a content_hash logged into reference_change_log via
    // `contentHashOf`/`hashOf`; both were removed as dead code once facilities-phase-0 Task 1
    // suspended that capture — see the "SUSPENDED" docblock section above.)
    classified = classifyFacilityRows(records, existingById, { previewedAt });

    // ⛔ `unchanged` rows are NOT written — which is what lets `written.updated` be believed. The old
    // code wrote every parsed row and counted every pre-existing one as `updated`, so a byte-identical
    // re-import of a 13 000-row release reported `updated: 13000` (measured) and bumped 13 000
    // `updated_at` values for no content change. `conflict` rows are not written either: a conflict
    // means the row moved under the operator between the preview they approved and this apply, and
    // the spec's default is to skip it (an explicit overwrite option is a later task of this slice,
    // never a default anyone gets by accident).
    const toWrite = classified.filter((c) => c.kind === 'create' || c.kind === 'changed');
    written.created = toWrite.filter((c) => c.kind === 'create').length;
    written.updated = toWrite.length - written.created;

    // Projected below: every row whose merged form the registry now actually holds — the rows just
    // written, plus `unchanged` rows (identical by definition). `conflict` rows are excluded because
    // their merge was NOT written, so projecting it would publish a display name the registry does
    // not have.
    mergedRecords = classified.filter((c) => c.kind !== 'conflict').map((c) => c.merged);

    // sql`now()` on updated_at mirrors upsert()'s explicit bump on conflict — insertBatchPg's chunked
    // ON CONFLICT DO UPDATE otherwise leaves updated_at untouched on an update (it only ever writes
    // the columns present in the row).
    if (toWrite.length > 0) {
      const rows = toWrite.map((c) => ({ ...facilityRecordToRow(c.merged), updated_at: sql`now()` }));
      await insertBatchPg(trx as unknown as Kysely<any>, 'facility_registry', rows as unknown as Record<string, unknown>[]);
    }

    // Capture SUSPENDED (Task 1 of the facilities-phase-0 slice) — see SUSPENDED_REFERENCE_ENTITY_TYPES
    // in reference-change-log.ts. This batch import path used to write reference_change_log rows
    // directly (bypassing capture.record for the fast "created" leg — see the docblock above) AND call
    // deps.capture.record per updated row; both are gone now that facility_registry is not in
    // ReferenceEntityType. `deps.capture` stays on FacilityImportDeps so re-enabling is restoring this
    // block, not re-wiring the deps shape.
  });

  // Fix 1 (mapping-ux report): project the imported rows into FACILITY_REGISTRY_SYSTEM, outside the
  // transaction above and after it has committed — a projection failure must not roll back (or even
  // slow down) the facility_registry write itself, and `projectRegistryRows` already swallows its
  // own failures (see that function's doc comment) so this call cannot throw.
  //
  // ⚠ `mergedRecords` is deliberately WIDER than what was written: it includes `unchanged` rows,
  // whose merged form the registry already holds identically. Projecting them is idempotent and
  // keeps a re-import able to repair a projection that failed the first time. Only `conflict` rows
  // are excluded — see where `mergedRecords` is built.
  //
  // ⚠ Its `boolean` ("did this projection land") is DELIBERATELY ignored here, and that is a known
  // gap, not an oversight: unlike the create/update routes there is no per-facility retry channel on
  // this path — a failure covers the whole imported batch at once, `ImportResult` has no field to
  // report it on, and the `registry-projection` job kind carries exactly one `registryId`. So an
  // import whose projection fails still reports plain success, exactly as before this return value
  // existed; the operator's repair remains pressing Publish (`publishRegistryConcepts`), and the only
  // record of the failure is `projectRegistryRows`' own `console.error`.
  if (deps.admin) await projectRegistryRows({ internalDb: deps.db, admin: deps.admin }, mergedRecords);

  // Task 5: the write above just committed, so the report-facing `facility_map` dimension is now
  // stale — enqueue a rebuild rather than running one inline here (see facilities-routes.ts's
  // matching comment: a rebuild talks to the EXTERNAL warehouse, and this import must not fail
  // because that warehouse hiccuped). Called once per import here, not per row, so a 14 000-row
  // register enqueues one job on its own merits — but it is still the store's coalescing
  // (facility-job-store.ts's `activeKeyFor`) that keeps this call from piling up a second queued
  // job on top of one an operator's own create/update/delete already left queued.
  //
  // Wrapped, exactly like the six enqueue sites in facilities-routes.ts/terminology-admin-routes.ts
  // and for the same reason: the import transaction has ALREADY COMMITTED by this line. An
  // uncontained throw here would turn a written import into a 500 at the HTTP route (which rethrows
  // whatever this raises) and, because the route's `facility.import` audit is written after the
  // call, skip the audit record of a write that really happened. Logged rather than swallowed
  // silently — a lost enqueue leaves the dimension stale with nothing else recording it.
  if (deps.facilityJobs) {
    try {
      await deps.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
    } catch (err) {
      const msg = 'failed to enqueue a facility-map-rebuild job after an applied facility import';
      if (deps.logger) deps.logger.error({ err }, msg);
      // eslint-disable-next-line no-console -- no logger supplied; this is the only record left.
      else console.error(`[facility-import] ${msg}`, err);
    }
  }

  // `blocked` is necessarily false here — the return above is the only path a blocked file takes —
  // but `resultOf` spells it out rather than hardcoding it so the two returns cannot drift.
  return resultOf(classified, written);
}
