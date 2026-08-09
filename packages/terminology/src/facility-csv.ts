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

export const FACILITY_CSV_TEMPLATE =
  'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude\n';

export interface FacilityCsvOptions {
  /** Which national register these codes belong to. Configuration, never hardcoded. */
  nationalSystem: string;
  /** Import despite unrecognised columns, carrying them into `extras`. */
  allowUnknownColumns?: boolean;
}

export interface QuarantinedRow {
  line: number;
  /** The row exactly as it appeared, so an operator can find and fix it in their source file. */
  raw: string;
  reason: 'too_few_fields' | 'too_many_fields';
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
 *  aliases attached to the row survive a rename. */
function idFor(nationalSystem: string, nationalCode: string): string {
  return `fac-${createHash('sha256').update(`${nationalSystem}|${nationalCode}`).digest('hex').slice(0, 16)}`;
}

const text = (v: string | undefined): string | null => {
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
function coordinate(
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
    return { records: [], unknownColumns: [], duplicateColumns: [], quarantined: [], skipped: 0, invalid: [] };
  }

  const headers = rows[0].record.map((h) => h.trim().toLowerCase());
  const duplicateColumns = headers.filter((h, i) => h !== '' && headers.indexOf(h) !== i);
  const unknownColumns = headers.filter((h, i) => h !== '' && headers.indexOf(h) === i && !KNOWN.has(h));

  if (duplicateColumns.length > 0) {
    return { records: [], unknownColumns, duplicateColumns: [...new Set(duplicateColumns)], quarantined: [], skipped: 0, invalid: [] };
  }
  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
    return { records: [], unknownColumns, duplicateColumns: [], quarantined: [], skipped: 0, invalid: [] };
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
    headers.forEach((h, i) => { r[h] = record[i]; });

    const nationalCode = text(r.national_code);
    const name = text(r.name);
    if (!nationalCode || !name) { skipped += 1; continue; }

    const rowErrors: RowError[] = [];
    const latitude = coordinate(r.latitude, 'latitude', info.lines, rowErrors);
    const longitude = coordinate(r.longitude, 'longitude', info.lines, rowErrors);
    // A coordinate is a PAIR. Half of one is not a location, and writing it would put the facility
    // on the equator or the prime meridian — a plausible-looking wrong answer, which is worse than
    // no answer. Only reported when the other half parsed cleanly, so a row already rejected above
    // does not collect a second, confusing error.
    if (rowErrors.length === 0) {
      if (latitude !== null && longitude === null) {
        rowErrors.push({ line: info.lines, field: 'longitude', reason: 'incomplete_pair', raw: (r.longitude ?? '').trim() });
      } else if (longitude !== null && latitude === null) {
        rowErrors.push({ line: info.lines, field: 'latitude', reason: 'incomplete_pair', raw: (r.latitude ?? '').trim() });
      }
    }
    if (rowErrors.length > 0) { invalid.push(...rowErrors); continue; }

    const extras: Record<string, unknown> = {};
    for (const col of unknownColumns) {
      const v = text(r[col]);
      if (v !== null) extras[col] = v;
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

  return { records, unknownColumns, duplicateColumns: [], quarantined, skipped, invalid };
}
