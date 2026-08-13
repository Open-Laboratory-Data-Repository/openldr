import type { FacilityRecord } from '@openldr/db';
import {
  type FacilityCsvOptions, type FacilityCsvResult, type QuarantinedRow, type RowError,
  coordinatePair, idFor, text,
} from './facility-csv';

export interface FacilityReleaseMeta {
  country: string | null;
  version: string | null;
  publishedAt: string | null;
  rowCount: number | null;
  deletionCount: number | null;
}

export interface FacilityReleaseResult extends FacilityCsvResult {
  meta: FacilityReleaseMeta | null;
  /** National codes the publisher explicitly declared removed. */
  deletions: string[];
  /** `meta.rowCount`/`deletionCount` disagreeing with what was parsed. Reported, never fatal —
   *  a mismatch is a fact about the file the operator must see, not a reason to refuse it. */
  countMismatch: { field: 'rowCount' | 'deletionCount'; declared: number; parsed: number }[];
}

/** The row schema's recognised keys, INCLUDING `email` — `email` is a documented field of the row
 *  record, it simply has no column in the `FacilityRecord` contract, so it is routed to `extras`
 *  rather than flagged in `unknownColumns`. Any OTHER key is genuinely unrecognised: still captured
 *  into `extras` (never silently dropped — the same philosophy `parseFacilityCsv`'s docblock states),
 *  but also surfaced via `unknownColumns` so an operator sees a future release growing new fields. */
const KNOWN_ROW_KEYS = new Set([
  'type', 'mflId', 'name', 'facilityLevel', 'district', 'region', 'countryCode',
  'latitude', 'longitude', 'phone', 'email', 'active',
]);

/** Narrow an arbitrary JSON value to a string, or `undefined` if it isn't one — the JSONL analogue
 *  of a CSV cell always being a string. Piped through `text()` for the same trim/empty-to-null
 *  behaviour `parseFacilityCsv` applies to every field. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Coerce a JSON value into the string form `coordinate()` expects. `null`/`undefined` become
 *  `undefined` (absent, same as a blank CSV cell) rather than the literal text "null" — the corpus
 *  uses `null` for genuinely-absent optional fields (`"phone":null`), and a coordinate should get
 *  the same treatment, not a spurious `not_a_number` error. */
function numeric(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

/**
 * Parse a national Master Facility List RELEASE — the JSONL format a country's registry actually
 * publishes, distinct from `parseFacilityCsv`'s CSV contract. Unlike a CSV, this format carries three
 * things a CSV cannot express: a release header (`meta`), explicit deletion records (`deletions`),
 * and therefore a declared count to check the parse against (`countMismatch`). Task 9's retirement
 * policy is what actually consumes `deletions` — this parser only collects them.
 *
 * Every line is independent NDJSON, and no line is ever silently dropped. A line that is not valid
 * JSON, or that parses to something other than an object, is QUARANTINED as `malformed_json`; a
 * well-formed object whose `type` is missing or not one of `meta`/`row`/`deletion` is QUARANTINED as
 * `unknown_record_type`; a second (or later) `meta` line is QUARANTINED as `duplicate_meta` — the
 * first `meta` line still wins, this just makes the later one visible instead of discarding it — see
 * `QuarantinedRow`'s docblock in `facility-csv.ts` for why those three are kept distinct. All reuse
 * that same `QuarantinedRow` shape `parseFacilityCsv` uses for a CSV row whose field count didn't
 * match the header's, rather than a parallel type.
 *
 * `opts.allowUnknownColumns` is a NO-OP here. For `parseFacilityCsv` an unrecognised header can shift
 * every subsequent column silently, so the whole file is blocked unless the caller opts in. That risk
 * does not exist in JSONL: each line is a self-describing object, an unrecognised key on one line
 * cannot corrupt any other field, and it is already captured into `extras` and surfaced via
 * `unknownColumns` (see `KNOWN_ROW_KEYS`'s docblock) regardless of this flag. The asymmetry with CSV
 * — CSV blocks, JSONL never does — is deliberate, not an oversight.
 *
 * ⚠ That asymmetry only holds if every CONSUMER honours it, and one did not: `openldr facilities
 * import` refused on `unknownColumns.length > 0` for any format, so a JSONL release that grew a
 * field was rejected by the CLI — the only path a register above the HTTP route's inline-apply cap
 * can be applied through — while the route accepted the same file. That refusal is now format-aware
 * (packages/cli/src/facilities.ts).
 *
 * `opts.columnMap` is ALSO a NO-OP here, for the same reason `allowUnknownColumns` is: `columnMap`
 * exists to rename a CSV's own file headers onto the contract before the unknown-column check runs,
 * and a JSONL release has no header row to rename — every line is a self-describing object whose keys
 * are already fixed by `KNOWN_ROW_KEYS`. There is nothing for a column map to rename. A caller passing
 * one here is not wrong, just talking to the wrong parser; this function simply never reads the field.
 *
 * Records come out in the exact `FacilityRecord` shape `parseFacilityCsv` produces, including the
 * SAME deterministic `id` (`idFor`, imported from `facility-csv.ts` — never reimplemented), so a
 * release and a CSV of the same register produce identical ids for the same facility.
 */
export function parseFacilityRelease(jsonl: string, opts: FacilityCsvOptions): FacilityReleaseResult {
  const lines = jsonl.split(/\r?\n/);

  let meta: FacilityReleaseMeta | null = null;
  const deletions: string[] = [];
  const quarantined: QuarantinedRow[] = [];
  let skipped = 0;
  const invalid: RowError[] = [];
  const records: FacilityRecord[] = [];
  const unknownKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNumber = i + 1;
    if (line === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      quarantined.push({ line: lineNumber, raw: line, reason: 'malformed_json' });
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      quarantined.push({ line: lineNumber, raw: line, reason: 'malformed_json' });
      continue;
    }
    const o = parsed as Record<string, unknown>;

    if (o.type === 'meta') {
      // First meta line wins — the corpus carries exactly one, at line 1. A later duplicate does NOT
      // overwrite the declared counts an operator already saw, but it is still QUARANTINED with its
      // line number rather than dropped — this codebase's parsers exist precisely to avoid silent
      // drops (see `parseFacilityCsv`'s docblock on `parseTermsCsv`'s data loss).
      if (meta === null) {
        meta = {
          country: text(str(o.country)),
          version: text(str(o.version)),
          publishedAt: text(str(o.publishedAt)),
          rowCount: typeof o.rowCount === 'number' ? o.rowCount : null,
          deletionCount: typeof o.deletionCount === 'number' ? o.deletionCount : null,
        };
      } else {
        quarantined.push({ line: lineNumber, raw: line, reason: 'duplicate_meta' });
      }
      continue;
    }

    if (o.type === 'deletion') {
      const mflId = text(str(o.mflId));
      // Folds into the same `skipped` counter a `row` missing a required field uses.
      // `FacilityReleaseResult` has no field that distinguishes "a deletion with no mflId" from
      // "a row with no mflId/name" — both are simply a well-formed record this parser could not
      // act on. That is an accepted limitation, not an oversight: see the pinning test below.
      if (!mflId) { skipped += 1; continue; }
      deletions.push(mflId);
      continue;
    }

    if (o.type === 'row') {
      for (const key of Object.keys(o)) {
        if (!KNOWN_ROW_KEYS.has(key)) unknownKeys.add(key);
      }

      const nationalCode = text(str(o.mflId));
      const name = text(str(o.name));
      if (!nationalCode || !name) { skipped += 1; continue; }

      // Same override, same semantics, as `parseFacilityCsv` — see `allowInvalidCoordinates` in
      // `FacilityCsvOptions`. Applied in BOTH parsers so a national register's escape hatch does not
      // depend on which of the two shapes the publisher happens to ship.
      const coords = coordinatePair(numeric(o.latitude), numeric(o.longitude), lineNumber);
      const badCoords = coords.errors.length > 0;
      if (badCoords) { invalid.push(...coords.errors); if (!opts.allowInvalidCoordinates) continue; }
      const latitude = badCoords ? null : coords.latitude;
      const longitude = badCoords ? null : coords.longitude;

      const extras: Record<string, unknown> = {};
      const email = text(str(o.email));
      if (email !== null) extras.email = email;
      for (const key of Object.keys(o)) {
        if (KNOWN_ROW_KEYS.has(key)) continue;
        extras[key] = o[key];
      }

      records.push({
        id: idFor(opts.nationalSystem, nationalCode),
        // The register and the code it carries — see migration 086. `nationalSystem`/
        // `nationalCode` are still emitted beside them until the contract migration drops the
        // columns; the store keeps both shapes in step.
        facilitySystem: opts.nationalSystem,
        facilityCode: nationalCode,
        name,
        level: text(str(o.facilityLevel)),
        country: text(str(o.countryCode)),
        region: text(str(o.region)),
        district: text(str(o.district)),
        phone: text(str(o.phone)),
        latitude,
        longitude,
        // `active: boolean` → the exact `active`/`inactive` codes the seeded location-status value
        // set defines. A non-boolean or absent `active` maps to `null` — no assumption either way.
        status: typeof o.active === 'boolean' ? (o.active ? 'active' : 'inactive') : null,
        extras: Object.keys(extras).length > 0 ? extras : undefined,
        // No `managedOrigin` stamp — same reasoning as `parseFacilityCsv`: importing a national
        // release is an AUTHORING path, not a sync-receiving one.
        source: 'import',
      });
      continue;
    }

    // `type` missing, or not one of the three recognised values. The line itself parsed fine —
    // this is a schema problem, not a syntax one, so it gets its own reason rather than
    // `malformed_json`.
    quarantined.push({ line: lineNumber, raw: line, reason: 'unknown_record_type' });
  }

  // `parsed` is `records.length`/`deletions.length` — rows that made it all the way into the
  // result — not a raw count of `type:"row"` lines seen. A release that declares 20 rows but
  // yields 18 usable records (2 skipped for a missing name, say) SHOULD surface as a mismatch:
  // that gap is exactly the fact an operator needs to see.
  const countMismatch: FacilityReleaseResult['countMismatch'] = [];
  if (meta && meta.rowCount !== null && meta.rowCount !== records.length) {
    countMismatch.push({ field: 'rowCount', declared: meta.rowCount, parsed: records.length });
  }
  if (meta && meta.deletionCount !== null && meta.deletionCount !== deletions.length) {
    countMismatch.push({ field: 'deletionCount', declared: meta.deletionCount, parsed: deletions.length });
  }

  return {
    records,
    // Informational only for this format — see `KNOWN_ROW_KEYS`'s docblock. Unlike `parseFacilityCsv`,
    // an unrecognised key on one JSONL row cannot invalidate the whole file the way a shifted CSV
    // column can (every row is self-describing), so this never blocks the import.
    unknownColumns: [...unknownKeys].sort(),
    // No header in JSONL, so there is no concept of a duplicate column or a column map. Kept only
    // for structural parity with `FacilityCsvResult`.
    duplicateColumns: [],
    columnMapErrors: [],
    quarantined,
    skipped,
    invalid,
    meta,
    deletions,
    countMismatch,
  };
}
