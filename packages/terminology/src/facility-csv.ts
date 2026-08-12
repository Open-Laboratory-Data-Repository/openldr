import { createHash } from 'node:crypto';
import { parse as parseCsvSync } from 'csv-parse/sync';
import type { FacilityRecord } from '@openldr/db';

/** The documented import contract. Country-agnostic: whoever obtains a national list maps their
 *  columns onto these once. */
const REQUIRED = ['national_code', 'name'] as const;
const OPTIONAL = [
  'level', 'ownership', 'status',
  'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
  'address', 'phone', 'latitude', 'longitude',
] as const;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);

/** The contract's field names, in contract order. Exported so nothing else has to re-declare them —
 *  a second copy would drift the moment a field is added, and the copy would silently stop being
 *  offered by the suggestion engine that reads it. */
export const FACILITY_CONTRACT_FIELDS: readonly string[] = [...REQUIRED, ...OPTIONAL];

/** How a file's own headers map onto the contract above.
 *
 *  ⛔ `columns` keys are headers AS THEY APPEAR IN THE FILE — the operator matches what they see.
 *  The parser lowercases them for lookup, because `headers` is already lowercased (see
 *  `parseFacilityCsv`). `extras` keys, by contrast, stay lowercased on the record: that is existing
 *  behaviour for every register already imported, and re-keying it would silently break them. */
export interface FacilityColumnMap {
  /** file header -> contract field */
  columns: Record<string, string>;
  /** contract field -> literal value written on every row (e.g. `country: 'ZMB'`) */
  constants?: Record<string, string>;
  /** file headers deliberately carried into `extras` rather than mapped */
  extras?: string[];
}

export type ColumnMapErrorReason =
  | 'duplicate_target' | 'constant_collision' | 'unknown_target' | 'missing_required';

export interface ColumnMapError {
  reason: ColumnMapErrorReason;
  /** The header (or, for a constant/required error, the field) the problem is about, spelled as the
   *  operator wrote it — so they can find it in their own map. */
  subject: string;
  /** The contract field involved. */
  target: string;
  /** The other header/field, when the problem is a collision between two things. */
  other?: string;
}

export const FACILITY_CSV_TEMPLATE =
  'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude\n';

export interface FacilityCsvOptions {
  /** Which national register these codes belong to, as that register's CANONICAL URI (e.g.
   *  `urn:tz:hfr`) — the `url` of a `coding_systems` row marked as a facility register, never a
   *  label an operator typed. Configuration, never hardcoded. It is hashed into every row's
   *  permanent id; see `idFor` for what two spellings of one register cost. */
  nationalSystem: string;
  /** Import despite unrecognised columns, carrying them into `extras`. */
  allowUnknownColumns?: boolean;
  /** Import a row whose coordinate failed validation anyway, with BOTH `latitude` and `longitude`
   *  set to `null`. The escape hatch in the same idiom as `allowUnknownColumns`, without which a
   *  row carrying `latitude: "N/A"` is dropped entirely and the facility is simply lost.
   *
   *  ⛔ BOTH halves go to null, never just the offending one: `coordinatePair` exists because half a
   *  coordinate is not a location, so keeping the good half would write a position the file never
   *  expressed. The row's `RowError`s are pushed into `invalid` either way — this flag decides
   *  whether the row is DROPPED, never whether it is REPORTED. */
  allowInvalidCoordinates?: boolean;
  /** Map this file's headers onto the contract. Omitted ⇒ headers must already BE the contract,
   *  exactly as before this option existed. */
  columnMap?: FacilityColumnMap;
}

export interface QuarantinedRow {
  line: number;
  /** The row exactly as it appeared, so an operator can find and fix it in their source file. */
  raw: string;
  /** `too_few_fields`/`too_many_fields` are CSV-specific (a row's column count didn't match the
   *  header's). The other three are the JSONL-release equivalents — `facility-release.ts` reuses this
   *  same type rather than defining a parallel one, since all five describe "a line that could not be
   *  mapped to a record, set aside with its line number" — just for different source formats and
   *  failure modes.
   *  - `malformed_json`: a SYNTAX failure — the line is not parseable JSON, or parses to something
   *    other than an object.
   *  - `unknown_record_type`: a SCHEMA failure — the line is a well-formed JSON object, but its `type`
   *    is missing or not one of `meta`/`row`/`deletion`. Kept distinct from `malformed_json` so an
   *    operator chasing it doesn't go looking for a syntax error that isn't there.
   *  - `duplicate_meta`: the line's `type` IS `meta` — recognised, not malformed — but a `meta` line
   *    already won (the corpus carries exactly one). Distinct from `unknown_record_type` because the
   *    type here is not unrecognised at all; the problem is only that it is a second one. */
  reason: 'too_few_fields' | 'too_many_fields' | 'malformed_json' | 'unknown_record_type' | 'duplicate_meta';
}

export interface RowError {
  line: number;
  field: 'latitude' | 'longitude';
  reason: 'not_a_number' | 'out_of_range' | 'incomplete_pair';
  /** The offending value exactly as it appeared, so an operator can find it in their file. */
  raw: string;
}

export interface FacilityCsvResult {
  records: FacilityRecord[];
  /** Columns the contract does not define. Non-empty ⇒ nothing imported unless explicitly allowed. */
  unknownColumns: string[];
  /** Headers appearing more than once. Non-empty ⇒ nothing imported: which column wins is arbitrary,
   *  so mapping either one is a guess about master data. */
  duplicateColumns: string[];
  /** Problems with the column map itself, ALL of them, so one fix pass repairs the file. Non-empty
   *  ⇒ nothing imported: every one of these is a guess about master data that this parser refuses to
   *  make, the same reasoning as `duplicateColumns` above. */
  columnMapErrors: ColumnMapError[];
  /** Rows whose field count did not match the header's. NEVER mapped to columns — that is the whole
   *  point (see the docblock). Distinct from `skipped`, which counts well-formed rows missing a
   *  REQUIRED value. */
  quarantined: QuarantinedRow[];
  /** Rows dropped for missing a required field. */
  skipped: number;
  /** Rows dropped for an unparseable, out-of-range, or half-supplied coordinate. Distinct from
   *  `skipped` (a missing REQUIRED value) — a row here was otherwise well-formed. */
  invalid: RowError[];
}

/** Stable id from the register + code, so re-importing a newer release UPDATES in place and any
 *  aliases attached to the row survive a rename. Exported so `facility-release.ts` derives the SAME
 *  id for the SAME register+code — a JSONL release and a CSV of the same register must produce
 *  identical ids, so this hash must never be reimplemented a second time.
 *
 *  ⛔ `nationalSystem` IS A REGISTER'S CANONICAL URI (e.g. `urn:tz:hfr`) — the `url` of a
 *  `coding_systems` row marked as a facility register — and NEVER a label somebody typed. This hash
 *  is a facility's PERMANENT identity, so whatever string reaches it is permanent too: MEASURED for
 *  national code `100`, `HFR` gives `fac-d112c779ad583160` and `hfr` gives `fac-49bce368724fb81a`,
 *  two identities for one register, while `observedFieldSystem`
 *  (`packages/bootstrap/src/facility-controlled-fields.ts`) lowercases its slug and so hands BOTH the
 *  one controlled-field namespace. One register, two identities, one namespace.
 *
 *  ⛔ The fix is NOT in here. This function is deliberately unchanged — no normalisation, no extra
 *  parameter, no different hash — because normalising would silently re-key every id already written.
 *  What changed is the VALUE: the import routes (`apps/server/src/facilities-routes.ts`, both the
 *  inline and the upload door) resolve the submitted `nationalSystem` through
 *  `FacilityRegisterSourceStore.getByUrl` and refuse a 400 when it names no register. Do not add a
 *  normalisation rule here to "help".
 *
 *  ⚠ NOT YET EVERY CALLER: `openldr facilities import --national-system` (packages/cli/src/
 *  facilities.ts) calls `importFacilities` directly and carries NO such gate today, so free text
 *  still reaches this line through the CLI. Both HTTP doors are gated by this slice — INCLUDING
 *  `POST /api/facilities/import/upload` (`apps/server/src/facilities-routes.ts`), the uncapped path
 *  a national-scale register actually goes through, since `MAX_INLINE_APPLY_ROWS` never applied
 *  there. The CLI is the one remaining ungated path, at any size, until this slice's Task 11 closes
 *  that door. */
export function idFor(nationalSystem: string, nationalCode: string): string {
  return `fac-${createHash('sha256').update(`${nationalSystem}|${nationalCode}`).digest('hex').slice(0, 16)}`;
}

export const text = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** Coordinate bounds. Not configuration: these are the definition of the WGS84 coordinate space,
 *  not a policy an operator could reasonably want to change. */
const LAT_MAX = 90;
const LON_MAX = 180;

/**
 * Parse one coordinate.
 *
 * ⛔ This used to be `num()`, which returned `null` for ANY unparseable value with no error at all —
 * so `latitude: "N/A"` and `latitude: ""` were indistinguishable and a national register could lose
 * every coordinate it had while reporting a clean import (FAC-P1-05). Blank still means absent;
 * everything else must parse and be in range.
 */
export function coordinate(
  raw: string | undefined, field: 'latitude' | 'longitude', line: number, errors: RowError[],
): number | null {
  const t = (raw ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) { errors.push({ line, field, reason: 'not_a_number', raw: t }); return null; }
  const max = field === 'latitude' ? LAT_MAX : LON_MAX;
  if (n < -max || n > max) { errors.push({ line, field, reason: 'out_of_range', raw: t }); return null; }
  return n;
}

/** Validate a lat/lon pair TOGETHER — a coordinate is a pair, and half of one is not a location (see
 *  `coordinate`'s docblock, FAC-P1-05). Exported so `facility-release.ts` reuses this exact pairing
 *  rule instead of reimplementing the "reported only when the other half parsed cleanly" logic. */
export function coordinatePair(
  latRaw: string | undefined, lonRaw: string | undefined, line: number,
): { latitude: number | null; longitude: number | null; errors: RowError[] } {
  const errors: RowError[] = [];
  const latitude = coordinate(latRaw, 'latitude', line, errors);
  const longitude = coordinate(lonRaw, 'longitude', line, errors);
  if (errors.length === 0) {
    if (latitude !== null && longitude === null) {
      errors.push({ line, field: 'longitude', reason: 'incomplete_pair', raw: (lonRaw ?? '').trim() });
    } else if (longitude !== null && latitude === null) {
      errors.push({ line, field: 'latitude', reason: 'incomplete_pair', raw: (latRaw ?? '').trim() });
    }
  }
  return { latitude, longitude, errors };
}

/** Validate a column map against the contract and return EVERY problem, never just the first. */
export function validateColumnMap(map: FacilityColumnMap): ColumnMapError[] {
  const errors: ColumnMapError[] = [];
  const claimedBy = new Map<string, string>(); // contract field -> the header that claimed it

  for (const [header, target] of Object.entries(map.columns)) {
    if (!KNOWN.has(target)) {
      errors.push({ reason: 'unknown_target', subject: header, target });
      continue;
    }
    const owner = claimedBy.get(target);
    if (owner !== undefined) {
      errors.push({ reason: 'duplicate_target', subject: header, target, other: owner });
      continue;
    }
    claimedBy.set(target, header);
  }

  for (const [field, _value] of Object.entries(map.constants ?? {})) {
    if (!KNOWN.has(field)) {
      errors.push({ reason: 'unknown_target', subject: field, target: field });
      continue;
    }
    const owner = claimedBy.get(field);
    if (owner !== undefined) {
      errors.push({ reason: 'constant_collision', subject: field, target: field, other: owner });
      continue;
    }
    claimedBy.set(field, field);
  }

  for (const required of REQUIRED) {
    if (!claimedBy.has(required)) {
      errors.push({ reason: 'missing_required', subject: required, target: required });
    }
  }

  return errors;
}

/**
 * Parse a national facility CSV.
 *
 * ⛔ Unknown columns FAIL the file rather than being dropped. `parseTermsCsv` in this same package
 * does the opposite — its docblock promises "extra columns go to properties" while the code keeps
 * exactly three and silently discards the rest — so an import reports success having lost half the
 * data. That is the worst available outcome, and this parser deliberately does not repeat it.
 *
 * Imported records carry NO `managedOrigin` stamp (it comes back `undefined`, stored as NULL).
 * Migration 048's convention reserves `managed_origin = 'central'` for rows the sync APPLIER writes
 * on arrival from central — it is what makes the down-sync delete guard
 * (`WHERE managed_origin = 'central'`) safe to run unattended. A lab importing a national CSV here
 * is an AUTHORING path, not a receiving one: if this parser stamped 'central' itself, a future
 * central down-sync would be free to delete a lab's own freshly-imported rows. The stamp belongs to
 * whichever code path actually receives a sync payload, not to this one.
 *
 * A row whose field count differs from the header's is QUARANTINED, never mapped. `relax_column_count`
 * stays on so the parser still cannot throw — one unescaped comma must not kill a 14 000-row national
 * import, which is why it was set in the first place — but the row is now reported with its line number
 * instead of silently having its values shifted one column left.
 */
export function parseFacilityCsv(csv: string, opts: FacilityCsvOptions): FacilityCsvResult {
  // ARRAY mode, not `columns`. The object mapping is done by hand below so a row's RAW field count is
  // observable — `columns` applies relax_column_count's pad/truncate before we ever see the row, which
  // is exactly how a shifted row used to arrive looking well-formed.
  const rows = parseCsvSync(csv, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    info: true,
    // `raw: true` gives the row's ORIGINAL text. Reconstructing it by joining the parsed fields
    // would be a different string — `trim` has already eaten the whitespace and the original
    // quoting is gone — and an operator has to find this row in their own file.
    raw: true,
  }) as { record: string[]; info: { lines: number }; raw: string }[];

  if (rows.length === 0) {
    return { records: [], unknownColumns: [], duplicateColumns: [], columnMapErrors: [], quarantined: [], skipped: 0, invalid: [] };
  }

  const rawHeaders = rows[0].record.map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const duplicateColumns = headers.filter((h, i) => h !== '' && headers.indexOf(h) !== i);

  const columnMapErrors = opts.columnMap ? validateColumnMap(opts.columnMap) : [];

  // Rename headers through the map. Lookup is on the LOWERCASED header, so a map written against
  // `MFL Code` still matches a file that spells it `mfl code`.
  const lowerToTarget = new Map<string, string>();
  const extrasOptIn = new Set<string>();
  if (opts.columnMap) {
    for (const [header, target] of Object.entries(opts.columnMap.columns)) {
      lowerToTarget.set(header.trim().toLowerCase(), target);
    }
    for (const header of opts.columnMap.extras ?? []) {
      extrasOptIn.add(header.trim().toLowerCase());
    }
  }
  const effective = opts.columnMap
    ? headers.map((h) => lowerToTarget.get(h) ?? h)
    : headers;

  // A header is unknown unless it mapped to a contract field, already IS one, or was explicitly
  // opted in to extras. The refusal itself is unchanged — see this function's docblock.
  const unknownColumns = effective.filter((h, i) =>
    h !== '' && effective.indexOf(h) === i && !KNOWN.has(h) && !extrasOptIn.has(headers[i]));

  if (duplicateColumns.length > 0) {
    return { records: [], unknownColumns, duplicateColumns: [...new Set(duplicateColumns)], columnMapErrors, quarantined: [], skipped: 0, invalid: [] };
  }
  if (columnMapErrors.length > 0) {
    return { records: [], unknownColumns, duplicateColumns: [], columnMapErrors, quarantined: [], skipped: 0, invalid: [] };
  }
  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
    return { records: [], unknownColumns, duplicateColumns: [], columnMapErrors, quarantined: [], skipped: 0, invalid: [] };
  }

  const quarantined: QuarantinedRow[] = [];
  let skipped = 0;
  const records: FacilityRecord[] = [];
  const invalid: RowError[] = [];

  for (const { record, info, raw } of rows.slice(1)) {
    if (record.length !== headers.length) {
      quarantined.push({
        line: info.lines,
        raw: raw.trim(),
        reason: record.length > headers.length ? 'too_many_fields' : 'too_few_fields',
      });
      continue;
    }

    const r: Record<string, string> = {};
    effective.forEach((h, i) => { r[h] = record[i]; });
    for (const [field, value] of Object.entries(opts.columnMap?.constants ?? {})) {
      r[field] = value;
    }

    const nationalCode = text(r.national_code);
    const name = text(r.name);
    if (!nationalCode || !name) { skipped += 1; continue; }

    const coords = coordinatePair(r.latitude, r.longitude, info.lines);
    const badCoords = coords.errors.length > 0;
    // Reported unconditionally; DROPPED only without the override (see `allowInvalidCoordinates`).
    if (badCoords) { invalid.push(...coords.errors); if (!opts.allowInvalidCoordinates) continue; }
    const latitude = badCoords ? null : coords.latitude;
    const longitude = badCoords ? null : coords.longitude;

    const extras: Record<string, unknown> = {};
    for (let i = 0; i < effective.length; i += 1) {
      const target = effective[i];
      if (KNOWN.has(target)) continue;
      const v = text(record[i]);
      if (v !== null) extras[headers[i]] = v;
    }

    records.push({
      id: idFor(opts.nationalSystem, nationalCode),
      nationalSystem: opts.nationalSystem,
      nationalCode,
      name,
      level: text(r.level),
      ownership: text(r.ownership),
      status: text(r.status),
      country: text(r.country),
      zone: text(r.zone),
      region: text(r.region),
      district: text(r.district),
      council: text(r.council),
      ward: text(r.ward),
      village: text(r.village),
      addressText: text(r.address),
      phone: text(r.phone),
      latitude,
      longitude,
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      // No managedOrigin stamp — see the docblock above. The sync applier stamps 'central' on arrival.
      source: 'import',
    });
  }

  return { records, unknownColumns, duplicateColumns: [], columnMapErrors, quarantined, skipped, invalid };
}
