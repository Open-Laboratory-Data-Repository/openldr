import { type Kysely, sql } from 'kysely';
import {
  parseFacilityCsv, parseFacilityRelease,
  type FacilityReleaseResult, type FacilityReleaseMeta, type QuarantinedRow, type RowError,
} from '@openldr/terminology';
import {
  type FacilityRecord,
  type InternalSchema,
  type ReferenceCapture,
  type TerminologyAdminStore,
  type FacilityJobStore,
  insertBatchPg,
  facilityRecordToRow,
  FACILITY_REGISTER_STATE_DROPPED,
} from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import { classifyFacilityRows, type ClassifiedRow, type ExistingFacility } from './facility-classify';
import { projectRegistryRows, retireRegistryConcepts } from './facility-reconcile';
import {
  CONTROLLED_FIELDS, applyControlledFields, resolveControlledFields,
  type ControlledField, type ControlledResolution,
} from './facility-controlled-fields';

// Task 2 of the facility-import slice: `parseFacilityCsv` (packages/terminology) exists, is tested,
// and has ZERO callers — this is the one shared function that actually writes a parsed register into
// `facility_registry`, so Task 3 (CLI) and Task 4 (HTTP route) can both wrap it instead of duplicating
// write logic (the repo's CLI-parity rule).

/**
 * Does this instance already hold at least one facility filed under `nationalSystem`?
 *
 * ⛔ THE ANSWER `importFacilities` CANNOT GIVE, and the reason `FacilityImportResult`'s field of the
 * same name is documented as the CALLER's to fill in. `nationalSystem` is free text feeding a
 * deterministic id, so `HFR` and `hfr` are two registers that will never merge; reporting `false`
 * is how an operator finds out they have just minted a second permanent identity for a register
 * they already had. `importFacilities` has no basis for the question — it never asks the registry
 * anything outside the ids its own file names — so it reports the neutral `true` and every entry
 * path overwrites that before the value is shown or stored.
 *
 * ⛔ AND IT MUST BE ASKED BEFORE THE WRITE. An apply CREATES rows under this `nationalSystem`, so the
 * same query afterwards answers `true` for the very register it just invented — the warning would
 * be true exactly until it mattered. Both callers ask first and attach the answer to the result they
 * return/persist.
 *
 * Shared by the inline route (apps/server/src/facilities-routes.ts) and the background import worker
 * (facility-import-worker.ts) rather than spelled twice: the two entry paths reporting different
 * answers for the same register is the drift this whole slice is built to make unexpressible.
 */
export async function resolveKnownNationalSystem(
  db: Kysely<InternalSchema>, nationalSystem: string,
): Promise<boolean> {
  const known = await db.selectFrom('facility_registry').select('id')
    .where('national_system', '=', nationalSystem).limit(1).executeTakeFirst();
  return !!known;
}

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
   *  facility-reconcile.ts. Never a reason to fail an import — see the enqueue call below. Also
   *  where a missing/failing `audit` (below) is reported, for the same reason. */
  logger?: { error(obj: unknown, msg?: string): void };
  /** Task 7 (facility audit-history slice): where each CHANGED facility gets its own
   *  `facility.import.row` audit event — distinct from the register-scoped `facility.import`
   *  summary event, which this function does NOT write; every existing caller (the inline route,
   *  the CLI, the import worker) already writes that one itself after `importFacilities` returns,
   *  and keeps doing so unchanged.
   *
   *  Optional, mirroring `admin`/`facilityJobs` above and matching the SAME optional shape
   *  `facility-import-worker.ts`'s own `audit` dependency already uses
   *  (`Pick<AuditStore, 'record'>`) — not every caller of this shared function has an audit store
   *  wired (this module's own test suite, for one). When it is omitted, a call that actually had
   *  changed rows to report logs the omission (via `logger` above, or `console.error`) rather than
   *  refusing the import: an unaudited write is a gap worth seeing, never a reason to block an
   *  operator's confirmed import. */
  audit?: Pick<AuditStore, 'record'>;
}

export interface FacilityImportOptions {
  /** Which national register these codes belong to. Configuration, never hardcoded — see
   *  facility-csv.ts's `FacilityCsvOptions.nationalSystem`. */
  nationalSystem: string;
  /** Which shape `input` is: a national register CSV (`parseFacilityCsv`, packages/terminology) or a
   *  JSONL release (`parseFacilityRelease`, facility-release.ts). Default `'csv'`. Both parsers return
   *  the same `records`/`invalid`/`quarantined`/`skipped` shape, so everything downstream of parsing
   *  — classification, the write, the samples — is unaffected by which one ran. JSONL additionally
   *  yields `meta`/`deletions`/`countMismatch`: only `deletions` (national codes the publisher
   *  explicitly declared removed) is ACTED on, via `result.deleted` and the retirement policy below;
   *  `meta`/`countMismatch` are reported straight through onto the result as provenance. */
  format?: 'csv' | 'jsonl';
  /** The file is a COMPLETE release of this register. NECESSARY, but not sufficient, for a row's
   *  absence to mean anything: absence is also only evaluated when the file actually produced
   *  records (see the absence query below). `absent` is `null` — NOT EVALUATED — otherwise. */
  completeRelease?: boolean;
  /** What to do with rows the publisher explicitly declared removed (a JSONL `{"type":"deletion"}`
   *  record — see `format` above; always `[]` for CSV, which has no way to express a removal). Default
   *  `'retire'`: a publisher saying "this facility is gone" is a fact, not a guess. */
  onDeleted?: 'retire' | 'report';
  /** What to do with rows merely ABSENT from a complete release — i.e. rows this registry holds that
   *  the file simply does not mention. Default `'report'` — absence is an INFERENCE (a partial export,
   *  a filter the publisher applied, a bug in their pipeline could all produce it just as easily as a
   *  real removal), and the audit requires that deletion is never inferred silently. */
  onAbsent?: 'retire' | 'report';
  /** Import despite unrecognised columns, carrying them into each record's `extras`. */
  allowUnknownColumns?: boolean;
  /** Apply despite structurally malformed rows (see `FacilityImportResult.quarantined`) — the
   *  explicit "I have seen the line numbers, import the rest" override, mirroring
   *  `allowUnknownColumns` above so a problem file has exactly one idiom for proceeding anyway.
   *  There is no equivalent override for duplicate headers: see `duplicateColumns` below. */
  allowMalformedRows?: boolean;
  /** Import a row whose coordinate failed validation anyway, with BOTH `latitude` and `longitude`
   *  written as `null` — the third member of the `allowUnknownColumns`/`allowMalformedRows` family,
   *  and the escape hatch the design spec's validation section calls for. Without it a row carrying
   *  `latitude: "N/A"` is dropped from `records` entirely, which loses the facility AND (on a
   *  `completeRelease` import with `onAbsent: 'retire'`) makes a live facility look absent.
   *
   *  ⛔ Both halves go to `null`, never just the offending one: a lone latitude is not a location
   *  (see `coordinatePair` in facility-csv.ts), so keeping half a pair would write a coordinate the
   *  file never expressed. The row's errors are still reported in `FacilityImportResult.invalid`
   *  either way — the override changes whether the row is DROPPED, never whether it is REPORTED. */
  allowInvalidCoordinates?: boolean;
  /** A publisher-supplied release version, echoed back on `FacilityImportResult.releaseVersion`.
   *  Omitted ⇒ defaulted from a JSONL release's own `meta.version` when it declares one (pure
   *  provenance: nothing in this function branches on it). */
  releaseVersion?: string | null;
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
  /** What to do with a row `classifyFacilityRows` classified `conflict` — touched by someone else
   *  between the preview an operator read and this apply (see `previewedAt` above). Default
   *  `'skip'`: the design spec's stated default ("the default is skip conflicts, with an explicit
   *  overwrite option") is what an operator gets by omission, never `'overwrite'` by accident.
   *  `'overwrite'` still WRITES the row (folded into `written.updated`, never `written.created` — a
   *  `conflict` row only ever arises when an existing row was found, so it can never be a `create`)
   *  and still projects its merged form (`mergedRecords`, below), while `conflict` on the result
   *  keeps counting it regardless of which way this is set — the operator must still be told how
   *  many rows they overwrote, not have the count vanish the moment they choose to act on it. */
  onConflict?: 'skip' | 'overwrite';
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
  /** Keys/columns the contract does not define.
   *
   *  ⚠ FORMAT-DEPENDENT, and an earlier version of this comment asserted only the CSV half. For
   *  `format: 'csv'`, non-empty AND `allowUnknownColumns` unset ⇒ `parsed`/`skipped` are both 0:
   *  an unrecognised header can shift every subsequent column, so `parseFacilityCsv` blocks the
   *  whole file. For `format: 'jsonl'` this is INFORMATIONAL ONLY — `parseFacilityRelease` never
   *  blocks on it and `allowUnknownColumns` is a no-op there, because each line is a self-describing
   *  object whose unrecognised keys are captured into `extras` and cannot corrupt another field
   *  (see `parseFacilityRelease`'s docblock). */
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
  /** Errors the parser found for an unparseable, out-of-range or half-supplied coordinate (see
   *  facility-csv.ts's `RowError`). One entry PER FIELD, not per row: `facility-csv.ts` pushes a
   *  separate `RowError` for latitude and for longitude, so a row with both coordinates rejected
   *  contributes TWO entries here — `invalid.length` is an error count, not a row count. Distinct
   *  from `skipped` (a missing REQUIRED value) and from `quarantined` (a field count disagreeing
   *  with the header's): a row here was otherwise well-formed. Without
   *  `FacilityImportOptions.allowInvalidCoordinates` the row is excluded from `records` by the
   *  parser, so it is counted in NO bucket below and this array is the only place it is visible at
   *  all; WITH the override the row is imported (both coordinates `null`) and therefore also lands
   *  in `create`/`changed`/`unchanged` — reporting here is unconditional either way. */
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
  /** Registry rows for this `nationalSystem` that the file does not mention — never a row explicitly
   *  declared removed (see `deleted` below); those two buckets are disjoint, so `absent` never
   *  double-reports what `deleted` already accounts for.
   *
   *  ⛔ `null` means NOT EVALUATED, never "none", and there are TWO ways to get it. Without
   *  `opts.completeRelease`: for a partial district register, a row's absence means nothing at all,
   *  so counting it as `0` would assert a measurement (every registry row for this system was
   *  checked against the file) that a partial file cannot support. And when the file produced NO
   *  records: an empty parse is evidence the file did not parse, never evidence that every facility
   *  is gone — see the absence query for the register-wide retirement that reading it the other way
   *  caused. */
  absent: number | null;
  /** Rows the PUBLISHER explicitly declared removed (a JSONL `deletion` record — see
   *  `FacilityImportOptions.format`) AND that matched a row this registry actually holds for this
   *  `nationalSystem`. A declared deletion for a facility we never had is not a retirement, so it is
   *  not counted here — see `parseFacilityRelease`'s `deletions` for the raw, unmatched list. Always 0
   *  for CSV, which has no way to express a removal — a row is either in the file or it is not (which
   *  is `absent`, an inference). */
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
   *  All 0 on a preview — now because nothing was WRITTEN, not because nothing was computed.
   *
   *  `retired` is how many registry rows this apply actually flipped `register_state` to `'dropped'`
   *  on (and removed from the mapping picker via `retireRegistryConcepts`) — the MUTATION, as
   *  distinct from the `deleted`/`absent` populations above, which are what the file DESCRIBES. The
   *  two differ whenever policy says so: `onAbsent: 'report'` (the default) reports a non-zero
   *  `absent` and retires none of it. */
  written: { created: number; updated: number; retired: number };
  /** Whatever `FacilityImportOptions.runId` carried in, echoed back so a caller that resolved a run
   *  can attach this result to it without threading the id through itself. Null when none was
   *  supplied — this function never invents or looks one up. */
  runId: string | null;
  /** False when this `nationalSystem` matches no existing registry row — i.e. this import creates a
   *  NEW register identity, which is worth telling an operator who mistyped one.
   *
   *  ⛔ NEVER ANSWERED HERE. `importFacilities` has no basis for it and reports the neutral `true`,
   *  which no consumer may pass on. It is answered by whoever holds the registry read at the right
   *  moment — BEFORE the write, or an apply that just created the register would answer `true` about
   *  the very identity the operator may have invented by mistyping one. Two owners do that today,
   *  both via `resolveKnownNationalSystem`: the inline route (which echoes its preview's answer onto
   *  the applied result) and the import WORKER, on both its validate and its apply phase — the
   *  background path's summary is durable and is what the studio's run door renders its
   *  new-register notice from, so leaving the neutral value there published a measurement nobody
   *  took. */
  knownNationalSystem: boolean;

  // ── The release header, and what it declares (FAC-P1-03) ──────────────────────────────────────
  //
  // `parseFacilityRelease` computed all three of these and nothing read them, so migration 080's
  // `declared_row_count`/`declared_deletion_count`/`release_published_at` columns were provisioned
  // and never written. Threaded here so a caller — the CLI's output, the route's run row — can
  // report them. `importFacilities` itself branches on NONE of them.

  /** A JSONL release's `meta` line, verbatim. Always `null` for CSV, which has no release header. */
  meta: FacilityReleaseMeta | null;
  /** Where `meta`'s declared counts disagree with what was actually parsed — e.g. "the release
   *  declares 13 000 rows, we parsed 12 998". Reported, NEVER fatal (see
   *  `FacilityReleaseResult.countMismatch`). Always `[]` for CSV. */
  countMismatch: FacilityReleaseResult['countMismatch'];
  /** `FacilityImportOptions.releaseVersion` when the caller supplied one, otherwise the release's
   *  own `meta.version`, otherwise null. Provenance only. */
  releaseVersion: string | null;

  // ── Controlled fields (FAC-P1-05) ─────────────────────────────────────────────────────────────

  /** Per controlled field (`level`/`status`/`country`), the DISTINCT raw source values that resolved
   *  to no canonical code — no `term_mappings` mapping, or only a deactivated one, and not already a
   *  member of the field's value set.
   *
   *  ⛔ A WARNING, never a block. The raw value is still written to the column exactly as it was
   *  before this layer existed (see `applyControlledFields`) — this whole path is a strict superset
   *  of the previous behaviour plus these counts. */
  unmapped: Record<ControlledField, string[]>;
  /** Controlled fields whose canonical value set is not seeded on this install, so no value of
   *  theirs could be classified mapped/unmapped at all. Also ALL THREE fields when the caller
   *  omitted `deps.admin`, since there is then no terminology store to resolve against — reported
   *  rather than thrown, matching how every other optional dep on `FacilityImportDeps` degrades. */
  notValidated: ControlledField[];
}

// Bounds `loadExisting`'s chunked `WHERE id IN (...)` lookup — the only chunked query this module
// issues directly — well under the driver's parameter/IN-list ceiling. `loadExisting` runs
// `selectAll()`, not an id-only projection, so each chunk carries the FULL row width (22 of
// `facility_registry`'s 24 columns), which is exactly why this bound matters more than an id-only
// lookup would need. (An earlier version of this comment also cited a `reference_change_log` batch
// insert this module used to chunk; that capture is SUSPENDED — see the "SUSPENDED" section of
// `importFacilities`' docblock — so this constant bounds `loadExisting` alone today.) `insertBatchPg`
// does its own, tighter, column-count-aware chunking for the facility_registry write itself (see
// batch-upsert.ts).
const CHUNK = 5000;

/** How many rows each `samples` bucket carries. Bounded because a national release can classify
 *  13 000 rows into one bucket and this result is returned over HTTP and stored in an audit
 *  event's `metadata` — the complete classified set belongs in a downloadable artefact, not here. */
const SAMPLE_LIMIT = 50;

/** `{ level: [], status: [], country: [] }` — the shape `FacilityImportResult.unmapped` always
 *  carries, so a consumer can index any controlled field without a presence check even on the path
 *  where no resolution ran at all (`deps.admin` omitted). */
function emptyUnmapped(): Record<ControlledField, string[]> {
  const out = {} as Record<ControlledField, string[]>;
  for (const field of CONTROLLED_FIELDS) out[field] = [];
  return out;
}

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
 * Rows absent from the file are never DELETED — nothing in this function issues a DELETE against
 * `facility_registry`. They are not touched at all unless the caller both declares the file a
 * `completeRelease` and asks for `onAbsent: 'retire'`, in which case their `register_state` is
 * flipped to `'dropped'` (never deleted, so a facility's aliases and history survive; and never
 * `status` — see the retirement write below for why). ⛔ And not even then if the file produced no
 * records — see the absence query below.
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
  input: string,
  opts: FacilityImportOptions,
): Promise<FacilityImportResult> {
  // Task 9's wiring: `format` picks which parser reads `input`. `parseFacilityRelease` (facility-
  // release.ts) returns a `FacilityReleaseResult` that EXTENDS `parseFacilityCsv`'s `FacilityCsvResult`
  // — same `records`/`unknownColumns`/`duplicateColumns`/`quarantined`/`skipped`/`invalid` shape — so
  // everything below (dedupe, blocking, classification, the write) runs identically regardless of
  // which parser produced it. The one thing only a JSONL release carries is `deletions`, read below.
  const isRelease = opts.format === 'jsonl';
  const parseOpts = {
    nationalSystem: opts.nationalSystem,
    allowUnknownColumns: opts.allowUnknownColumns,
    allowInvalidCoordinates: opts.allowInvalidCoordinates,
  };
  const parsed = isRelease ? parseFacilityRelease(input, parseOpts) : parseFacilityCsv(input, parseOpts);
  const { records: parsedRecords, unknownColumns, duplicateColumns, quarantined, skipped, invalid } = parsed;
  // Publisher-declared removals. `[]` for CSV — `FacilityCsvResult` has no `deletions` field, a CSV
  // row is either present or it is not (which is `absent`, an inference, never a declaration).
  //
  // ⛔ Cast, not a `'deletions' in parsed` narrow: because `FacilityReleaseResult extends
  // FacilityCsvResult`, TypeScript's ternary-expression inference collapses `parsed`'s type to the
  // wider supertype `FacilityCsvResult` alone rather than a union — even with `parsed` explicitly
  // annotated as the union, `in`-narrowing on that annotated type still typed `.deletions` `unknown`,
  // not `string[]` (measured — see the type error this replaced). The cast is guarded by the SAME
  // `isRelease` condition that decided which parser actually ran immediately above, so it cannot
  // disagree with reality.
  const deletions: string[] = isRelease ? (parsed as FacilityReleaseResult).deletions : [];
  // Guarded by the same `isRelease` condition as `deletions` above, and for the same reason (see
  // that cast's comment). Neither is read by anything in this function — both are pure provenance,
  // threaded onto the result so the CLI's output and the route's run row can report what the
  // publisher declared versus what actually parsed.
  const meta: FacilityReleaseMeta | null = isRelease ? (parsed as FacilityReleaseResult).meta : null;
  const countMismatch: FacilityReleaseResult['countMismatch'] =
    isRelease ? (parsed as FacilityReleaseResult).countMismatch : [];
  const releaseVersion = opts.releaseVersion ?? meta?.version ?? null;
  // Collapse same-id rows (a repeated national_code within one file) BEFORE anything downstream
  // ever sees them — see dedupeById's docblock for why this can't wait until insertBatchPg.
  const { records: dedupedRecords, duplicates } = dedupeById(parsedRecords);

  // FAC-P1-05: rewrite each record's controlled fields (`level`/`status`/`country`) to the canonical
  // codes the facility FORM is already bound to, preserving every raw source value under the
  // reserved `extras.__source` key — see facility-controlled-fields.ts.
  //
  // ⛔ Runs on the PREVIEW path too, and BEFORE classification, for two reasons: the operator must
  // see the `unmapped` warning before deciding to apply, and the merged row a preview classifies has
  // to be the row an apply would actually write — classifying the raw string against a registry
  // holding the canonical code would report a spurious `changed`.
  //
  // ⚠ `deps.admin` is optional (see `FacilityImportDeps`), so a caller that omitted it gets no
  // resolution at all rather than a throw: every field is reported `notValidated` and every record
  // passes through untouched, exactly as it did before this layer existed.
  const controlled: ControlledResolution | null = deps.admin
    ? await resolveControlledFields(deps.admin, opts.nationalSystem, dedupedRecords)
    : null;
  const records = controlled === null
    ? dedupedRecords
    : dedupedRecords.map((r) => applyControlledFields(r, controlled));
  const unmapped = controlled?.unmapped ?? emptyUnmapped();
  const notValidated = controlled?.notValidated ?? [...CONTROLLED_FIELDS];

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

  // A row this query returns from `facility_registry`, shaped into a `FacilitySample`.
  const toSample = (r: { id: string; national_code: string | null; name: string }): FacilitySample =>
    ({ id: r.id, nationalCode: r.national_code, name: r.name });

  // ⛔ A declared deletion is a PUBLISHER FACT, matched against what this registry actually holds for
  // THIS `nationalSystem` — a deletion record naming a facility we never had is not a retirement (it
  // is not even a fact ABOUT this registry), so it is not counted here. Matched by `national_code`,
  // the same key `parseFacilityRelease`'s deletion records carry (`mflId`), not by the derived `id`:
  // a deletion line carries no `nationalSystem` of its own to feed `idFor` with, only the code.
  const deletedMatches = deletions.length === 0 ? [] : await deps.db
    .selectFrom('facility_registry')
    .select(['id', 'national_code', 'name'])
    .where('national_system', '=', opts.nationalSystem)
    .where('national_code', 'in', deletions)
    .execute();
  const deletedIds = deletedMatches.map((r) => r.id);

  // ⛔ Scoped to THIS national_system. A register import says nothing about facilities belonging to a
  // different register or hand-registered locally, and treating them as "absent" would offer the
  // operator a retire action over rows the file was never authoritative for.
  //
  // The exclusion list is `ids` (this file's ordinary rows) PLUS `deletedIds` (rows a `deletion`
  // record already accounted for) — without folding the latter in, a row the publisher explicitly
  // declared removed (and which therefore, by definition, never appears as an ordinary row) would
  // ALSO satisfy "not in `ids`" below and get double-reported as an INFERRED absence, contradicting
  // the fact the publisher already stated outright. `deleted` and `absent` must stay disjoint
  // populations — that distinction is the entire point of this task.
  //
  // ⛔ ALSO guarded on `records.length > 0`, and that guard is the whole of Critical 1. Absence is
  // an inference drawn from a file MENTIONING some rows and not others; a file that produced NO
  // records at all is not evidence that every facility is absent, it is evidence the file did not
  // parse. Three routine shapes reach `records: []` — an unrecognised column without
  // `allowUnknownColumns`, duplicate headers, and a truncated download that kept only its header
  // line — and without this guard every one of them made `excludedFromAbsence` empty, so the query
  // below matched the ENTIRE register for this `nationalSystem` and (with `onAbsent: 'retire'`)
  // retired all of it. Measured: two of two rows retired by a headers-only file (at the time this
  // was measured, retirement wrote `status: 'inactive'`; as of Task 5 it writes `register_state:
  // 'dropped'` — the guard below is unaffected by which column retirement lands on).
  // `null` here is the honest answer — NOT EVALUATED, per this field's contract — not `0`.
  //
  // ⚠ A publisher's DECLARED deletions are unaffected: `deletedIds` is computed from `deletions`
  // above, entirely independently of this query, so a deletions-only JSONL release still retires
  // exactly what it names.
  const excludedFromAbsence = [...ids, ...deletedIds];
  const absentRows = (!opts.completeRelease || records.length === 0) ? null : await deps.db
    .selectFrom('facility_registry')
    .select(['id', 'national_code', 'name'])
    .where('national_system', '=', opts.nationalSystem)
    // Never empty on this branch: `records.length > 0` ⇒ `ids.length > 0` ⇒ this is non-empty. (The
    // `['']` placeholder that used to guard an empty list here is gone with the guard that made it
    // reachable — keeping it would only preserve the shape of the bug.)
    .where('id', 'not in', excludedFromAbsence)
    .execute();

  // Defaults are asymmetric on purpose (see `FacilityImportOptions`' doc comments): a publisher's
  // explicit deletion is a fact ⇒ retire by default; an absence is this importer's own inference from
  // a file being silent about a row ⇒ report only, never act, unless the operator says so.
  const onDeleted = opts.onDeleted ?? 'retire';
  const onAbsent = opts.onAbsent ?? 'report';
  // Disjoint by construction (`deletedIds` is excluded from the `absentRows` query above), so this
  // never needs deduplicating — a `Set` would only be defending against a bug the query already rules
  // out.
  //
  // ⚠ No `opts.completeRelease` conjunct on the second line: `absentRows` is already `null` without
  // it (see the query above), so re-checking it was a dead conjunct asserting a condition the value
  // it guards already encodes — and, worse, a second place the "when may absence be acted on?" rule
  // would have to be kept in step.
  const retiredIds = [
    ...(onDeleted === 'retire' ? deletedIds : []),
    ...(onAbsent === 'retire' && absentRows ? absentRows.map((r) => r.id) : []),
  ];

  /** Shape a classification into the reported result. `written` is the caller's to supply: it is the
   *  ONE thing the two paths genuinely disagree about. */
  const resultOf = (
    classified: ClassifiedRow[], written: FacilityImportResult['written'],
  ): FacilityImportResult => {
    const { counts, samples } = summarise(classified);
    return {
      parsed: parsedRecords.length, skipped, unknownColumns, duplicateColumns, quarantined, invalid,
      duplicates, blocked, blockedReason,
      create: counts.create, changed: counts.changed, unchanged: counts.unchanged,
      conflict: conflictsEvaluated ? counts.conflict : null,
      absent: absentRows === null ? null : absentRows.length,
      deleted: deletedMatches.length,
      samples: {
        ...samples,
        absent: absentRows === null ? [] : absentRows.slice(0, SAMPLE_LIMIT).map(toSample),
        deleted: deletedMatches.slice(0, SAMPLE_LIMIT).map(toSample),
      },
      written,
      runId: opts.runId ?? null,
      // The neutral value — see the field's doc comment. Nothing here can answer it; the route and
      // the import worker each overwrite it from their own `resolveKnownNationalSystem` reading.
      knownNationalSystem: true,
      meta, countMismatch, releaseVersion,
      unmapped, notValidated,
    };
  };

  if (!opts.apply || blocked || (records.length === 0 && retiredIds.length === 0)) {
    // ⛔ The lookup runs on the PREVIEW path too, and that is the entire fix for FAC-P1-03: this
    // branch used to return `created: 0, updated: 0` without ever asking the registry anything.
    // It also runs for a BLOCKED file (which, when the reason is `'quarantined-rows'`, still has
    // rows): the operator's next move is to tick the override and apply, so the counts they are
    // reading now must describe the registry rather than assume an empty one.
    //
    // Task 9 widens this shortcut's condition to `records.length === 0 && retiredIds.length === 0`
    // (it used to be `records.length === 0` alone): a JSONL release that is ENTIRELY `deletion` lines
    // — a routine "here is what changed since the last full release" update, not a hypothetical — has
    // NO ordinary rows at all, but still has real writing to do. Without the `retiredIds` half of this
    // condition such a file would take this read-only shortcut on every `apply: true` call and never
    // retire anything.
    const existing = records.length === 0 ? new Map<string, ExistingFacility>() : await loadExisting(deps.db, ids);
    return resultOf(
      classifyFacilityRows(records, existing, { previewedAt }),
      // ⛔ `retired: 0` on a DRY RUN even when `retiredIds` is non-empty. A preview REPORTS the
      // retirable populations (`deleted`/`absent`) and performs none of it — `written` describes
      // mutations that happened, and on this branch none did.
      { created: 0, updated: 0, retired: 0 },
    );
  }

  let classified: ClassifiedRow[] = [];
  const written: FacilityImportResult['written'] = { created: 0, updated: 0, retired: 0 };
  // Populated inside the transaction below, read afterwards to drive the registry projection —
  // see the projectRegistryRows call after the transaction commits for why that has to happen
  // outside it.
  let mergedRecords: FacilityRecord[] = [];
  // Populated inside the transaction below, read afterwards (same reason as `mergedRecords`) to
  // build the `before` side of each `facility.import.row` audit event — see the audit block after
  // the transaction commits.
  let existingById: Map<string, ExistingFacility> = new Map();

  await deps.db.transaction().execute(async (trx) => {
    // Existing-row lookup runs on `trx`, inside this transaction, not on `deps.db` before it opens
    // (see the docblock above) — and it fetches whole rows, not just id, because `classifyFacilityRows`
    // both COMPARES the parser's columns against them and MERGES local_code/extras forward off them,
    // rather than overwriting those with the importer's blanks.
    existingById = await loadExisting(trx, ids);

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
    // `updated_at` values for no content change. `conflict` rows are written only when the caller
    // opted in: a conflict means the row moved under the operator between the preview they approved
    // and this apply, and `opts.onConflict` (default `'skip'`, see `FacilityImportOptions`' doc
    // comment) decides whether that row is written anyway.
    const overwriteConflicts = (opts.onConflict ?? 'skip') === 'overwrite';
    const toWrite = classified.filter((c) => c.kind === 'create' || c.kind === 'changed'
      || (overwriteConflicts && c.kind === 'conflict'));
    written.created = toWrite.filter((c) => c.kind === 'create').length;
    written.updated = toWrite.length - written.created;

    // ⚠ `managed_origin` asymmetry, undocumented until now. `managedOrigin` is deliberately excluded
    // from `COMPARED` (facility-classify.ts) so it never drives `create`/`changed`/`unchanged`, but
    // `facilityRecordToRow` (packages/db's `toRow`) DOES write it — `rec.managedOrigin ?? null` — and
    // a CSV-parsed `FacilityRecord` never carries one, so every row THIS statement writes lands with
    // `managed_origin: null`. Before FAC-P1-03 (this task) EVERY parsed row was written unconditionally
    // — `create` and every pre-existing row alike, per the old code's own docblock note — so a
    // byte-identical re-import of a row the sync applier had stamped `managed_origin='central'` cleared
    // that stamp to NULL on every single re-import. Now that `unchanged` rows are excluded from
    // `toWrite` (immediately above), that byte-identical re-import no longer touches the row at all, so
    // the stamp survives. A `changed` row is NOT protected the same way: it stays in `toWrite`, so
    // renaming a centrally-managed facility and re-importing it still clears `managed_origin` to NULL —
    // exactly as it did before this task; only the `unchanged` case's behaviour moved. This is
    // DELIBERATELY left as-is: the new behaviour is the safer one (a no-op re-import can no longer
    // strip the stamp `reference-apply.ts`'s delete guard relies on), so this comment records the
    // asymmetry rather than "fixing" it into a change.

    // Projected below: every row whose merged form the registry now actually holds — the rows just
    // written, plus `unchanged` rows (identical by definition). A `conflict` row is excluded UNLESS
    // `overwriteConflicts` (above) is set: on the default `'skip'` path its merge was NOT written, so
    // projecting it would publish a display name the registry does not have; on `'overwrite'` it WAS
    // written (it's in `toWrite` above), so the registry now genuinely holds that merged form.
    mergedRecords = classified.filter((c) => c.kind !== 'conflict' || overwriteConflicts).map((c) => c.merged);

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

    // Task 9: retirement, IN THE SAME TRANSACTION as the write above rather than after it commits
    // (contrast with `projectRegistryRows`/`facilityJobs.enqueue` below, both deliberately outside
    // it) — a facility whose `register_state` flipped to `'dropped'` but whose mapping concept
    // `retireRegistryConcepts` failed to retire (or the reverse) is a worse, silently half-done state
    // than the whole apply rolling back and being retried. `retiredIds` was computed above, before
    // this transaction opened, from
    // `deletedIds`/`absentRows` and the `onDeleted`/`onAbsent` policy — never from `records`, so this
    // runs even though every id here is, by construction, ABSENT from `toWrite`.
    if (retiredIds.length > 0) {
      // ⛔ `register_state`, NOT `status`. The seeded `status` vocabulary is HL7's own
      // `http://hl7.org/fhir/location-status` (migration 072), whose only codes are active/suspended/
      // inactive — HL7 has no concept of register membership, so carrying "the register stopped
      // listing this row" there would mean inventing a non-conformant `retired` code in a CodeSystem
      // HL7 owns. That reasoning is why this used to write `status: 'inactive'` here. But `status`
      // answering "is this facility open" and "does the register still list it" at once was exactly
      // the conflation this slice exists to remove: a facility the register dropped (merged,
      // mis-registered, moved registers) is not necessarily closed, and a report filtering
      // `status = 'active'` silently lost it either way. Task 5 (migration 081) gives register
      // membership its own column — `facility_registry.register_state`, OpenLDR's own vocabulary, not
      // HL7's — so this write moves there and `status` is left alone, going back to meaning
      // operational status only. The *retired* mapping-picker semantics are still carried by
      // `retireRegistryConcepts` below, which removes the facility from the mapping picker while
      // leaving history resolvable — nothing here, or anywhere in this function, ever issues a DELETE
      // against `facility_registry`.
      await trx.updateTable('facility_registry')
        .set({ register_state: FACILITY_REGISTER_STATE_DROPPED, updated_at: sql`now()` })
        .where('id', 'in', retiredIds)
        .execute();
      await retireRegistryConcepts({ internalDb: trx }, retiredIds);
      written.retired = retiredIds.length;
    }
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
  // ⛔ Rows this apply just RETIRED are excluded. A JSONL release may carry both a `row` and a
  // `deletion` for the same national code, which puts that id in `mergedRecords` AND in
  // `retiredIds`; since this projection runs AFTER the transaction committed, it would re-publish
  // the very concept `retireRegistryConcepts` retired inside it, undoing the retirement in the
  // mapping picker while `facility_registry.register_state` stayed `'dropped'`. Filtering here
  // (rather than where `mergedRecords` is built) keeps the WRITE set and the PROJECTION set independent:
  // a retired id may still legitimately have been written as a row above.
  //
  // ⚠ Its `boolean` ("did this projection land") is DELIBERATELY ignored here, and that is a known
  // gap, not an oversight: unlike the create/update routes there is no per-facility retry channel on
  // this path — a failure covers the whole imported batch at once, `ImportResult` has no field to
  // report it on, and the `registry-projection` job kind carries exactly one `registryId`. So an
  // import whose projection fails still reports plain success, exactly as before this return value
  // existed; the operator's repair remains pressing Publish (`publishRegistryConcepts`), and the only
  // record of the failure is `projectRegistryRows`' own `console.error`.
  if (deps.admin) {
    const retiredSet = new Set(retiredIds);
    const toProject = retiredSet.size === 0
      ? mergedRecords
      : mergedRecords.filter((r) => !retiredSet.has(r.id));
    await projectRegistryRows({ internalDb: deps.db, admin: deps.admin }, toProject);
  }

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

  // Task 7: one `facility.import.row` audit event per CHANGED facility — never per parsed row, and
  // never for `create`/`unchanged`/`conflict` either. Filters the SAME classification this call
  // already computed above (`classified`, which is exactly what `result.changed` counts via
  // `summarise`) rather than re-deriving "did this row change" from scratch — see this function's
  // docblock and `classifyFacilityRows` for why that comparison must only happen once.
  //
  // ⛔ THE WHOLE POINT: a byte-identical re-import classifies every row `unchanged`, so
  // `changedRows` is `[]` and NOTHING is written here — audit volume tracks real change, not file
  // size. A 13 000-row national release with one renamed facility writes exactly one row here, the
  // same count `result.changed` reports.
  //
  // Placed AFTER the transaction, mirroring `projectRegistryRows`/`facilityJobs.enqueue` above and
  // for the same reason: `deps.audit` (when supplied) is bound to `deps.db`, not to `trx`, so a
  // call made from inside the transaction callback would not actually be part of it anyway — there
  // is no atomicity to gain by moving it in, only pg-mem's documented "no rollback on a thrown
  // error" hazard to risk by putting more work inside that callback.
  const changedRows = classified.filter((c) => c.kind === 'changed');
  if (changedRows.length > 0) {
    if (!deps.audit) {
      // Never a reason to fail — see `FacilityImportDeps.audit`'s doc comment. Logged once per call,
      // not once per row: the gap is "this call's changed rows are unaudited", a single fact, not
      // `changedRows.length` repetitions of it.
      const msg = `applied a facility import with ${changedRows.length} changed row(s) but no audit `
        + 'store wired; the per-row write is unaudited';
      if (deps.logger) deps.logger.error({ nationalSystem: opts.nationalSystem }, msg);
      // eslint-disable-next-line no-console -- no logger supplied; this is the only record left.
      else console.error(`[facility-import] ${msg}`);
    } else {
      try {
        // Dispatched together rather than one row-at-a-time `await` in a loop — the batching this
        // task's binding constraint asks for. Bounded by `changedRows.length`, which is real change,
        // never by how many rows the file parsed.
        await Promise.all(changedRows.map((c) => {
          // `existing` is never undefined here: `classifyFacilityRows` only produces `kind: 'changed'`
          // when it found (and compared against) an existing row for this id — see facility-classify.ts.
          const existing = existingById.get(c.merged.id);
          const before = existing
            ? { id: existing.id, localCode: existing.localCode, extras: existing.extras, ...existing.fields }
            : null;
          return deps.audit!.record({
            actorType: 'system',
            actorId: null,
            actorName: 'facility-import',
            action: 'facility.import.row',
            entityType: 'facility',
            entityId: c.merged.id,
            before,
            after: c.merged,
            metadata: { nationalSystem: opts.nationalSystem, runId: opts.runId ?? null },
          });
        }));
      } catch (err) {
        const msg = 'failed to audit one or more changed facilities from this import';
        if (deps.logger) deps.logger.error({ err, nationalSystem: opts.nationalSystem }, msg);
        // eslint-disable-next-line no-console -- no logger supplied; this is the only record left.
        else console.error(`[facility-import] ${msg}`, err);
      }
    }
  }

  // `blocked` is necessarily false here — the return above is the only path a blocked file takes —
  // but `resultOf` spells it out rather than hardcoding it so the two returns cannot drift.
  return resultOf(classified, written);
}
