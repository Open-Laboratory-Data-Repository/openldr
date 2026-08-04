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

export interface FacilityCsvResult {
  records: FacilityRecord[];
  /** Columns the contract does not define. Non-empty ⇒ nothing imported unless explicitly allowed. */
  unknownColumns: string[];
  /** Rows dropped for missing a required field. */
  skipped: number;
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

const num = (v: string | undefined): number | null => {
  const t = (v ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

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
 */
export function parseFacilityCsv(csv: string, opts: FacilityCsvOptions): FacilityCsvResult {
  const rows = parseCsvSync(csv, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : csvHeader(csv);
  const unknownColumns = headers.filter((h) => h !== '' && !KNOWN.has(h));

  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
    return { records: [], unknownColumns, skipped: 0 };
  }

  let skipped = 0;
  const records: FacilityRecord[] = [];
  for (const r of rows) {
    const nationalCode = text(r.national_code);
    const name = text(r.name);
    if (!nationalCode || !name) { skipped += 1; continue; }

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
      latitude: num(r.latitude),
      longitude: num(r.longitude),
      extras: Object.keys(extras).length > 0 ? extras : undefined,
      // No managedOrigin stamp — see the docblock above. The sync applier stamps 'central' on arrival.
      source: 'import',
    });
  }
  return { records, unknownColumns, skipped };
}

/** Header of a file with no data rows — `csv-parse` yields nothing to read keys from. Normalised
 *  identically to the `columns` callback above: BOM stripped, lowercased, trimmed. */
function csvHeader(csv: string): string[] {
  let first = csv.split(/\r?\n/, 1)[0] ?? '';
  if (first.charCodeAt(0) === 0xfeff) first = first.slice(1);
  return first.split(',').map((h) => h.trim().toLowerCase());
}
