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
 * Every line is independent NDJSON. A line that is not valid JSON, or whose `type` is not one of
 * `meta`/`row`/`deletion`, is QUARANTINED with its line number — never thrown — reusing the same
 * `QuarantinedRow` shape `parseFacilityCsv` uses for a CSV row whose field count didn't match the
 * header's (see that type's docblock for why `malformed_json` lives on the same union rather than a
 * parallel one).
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
      // First meta line wins — the corpus carries exactly one, at line 1. A later duplicate is
      // ignored rather than silently overwriting the declared counts an operator already saw.
      if (meta === null) {
        meta = {
          country: text(str(o.country)),
          version: text(str(o.version)),
          publishedAt: text(str(o.publishedAt)),
          rowCount: typeof o.rowCount === 'number' ? o.rowCount : null,
          deletionCount: typeof o.deletionCount === 'number' ? o.deletionCount : null,
        };
      }
      continue;
    }

    if (o.type === 'deletion') {
      const mflId = text(str(o.mflId));
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

      const { latitude, longitude, errors } = coordinatePair(numeric(o.latitude), numeric(o.longitude), lineNumber);
      if (errors.length > 0) { invalid.push(...errors); continue; }

      const extras: Record<string, unknown> = {};
      const email = text(str(o.email));
      if (email !== null) extras.email = email;
      for (const key of Object.keys(o)) {
        if (KNOWN_ROW_KEYS.has(key)) continue;
        extras[key] = o[key];
      }

      records.push({
        id: idFor(opts.nationalSystem, nationalCode),
        nationalSystem: opts.nationalSystem,
        nationalCode,
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

    // `type` missing, or not one of the three recognised values.
    quarantined.push({ line: lineNumber, raw: line, reason: 'malformed_json' });
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
    // No header in JSONL, so there is no concept of a duplicate column. Kept only for structural
    // parity with `FacilityCsvResult`.
    duplicateColumns: [],
    quarantined,
    skipped,
    invalid,
    meta,
    deletions,
    countMismatch,
  };
}
