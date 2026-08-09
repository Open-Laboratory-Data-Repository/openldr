import { canonicalJson } from '@openldr/core';
import type { FacilityRecord } from '@openldr/db';

export type FacilityChangeKind = 'create' | 'changed' | 'unchanged' | 'conflict';

export interface ExistingFacility {
  id: string;
  localCode: string | null;
  extras: Record<string, unknown> | null;
  /** Every comparable column, already in FacilityRecord's camelCase shape. */
  fields: Omit<FacilityRecord, 'id' | 'source' | 'extras' | 'localCode'>;
  /** `timestamptz` from the driver — a Date, despite FacilityRegistryTable declaring `string`. */
  updatedAt: Date | string;
}

export interface ClassifiedRow {
  kind: FacilityChangeKind;
  /** What will actually be WRITTEN — after local_code preservation and the extras merge. */
  merged: FacilityRecord;
  /** Populated for 'changed' only. */
  diff: { field: string; before: unknown; after: unknown }[];
}

/**
 * Columns the IMPORTER is authoritative for, and therefore the only ones a difference in may be
 * called a change.
 *
 * ⛔ `localCode` is deliberately absent: `parseFacilityCsv` never produces one (there is no such
 * column in the contract), it is a UNIQUE value an operator assigns by hand, and `importFacilities`
 * preserves the existing one. Including it here would mark every hand-coded facility as "changed"
 * on every import, forever — the same class of false positive FAC-P1-03 is about, one layer down.
 * `managedOrigin` is absent for the same reason: the sync applier owns it, not this path.
 */
const COMPARED: (keyof FacilityRecord)[] = [
  'nationalSystem', 'nationalCode', 'name', 'level', 'ownership', 'status', 'country',
  'zone', 'region', 'district', 'council', 'ward', 'village', 'addressText', 'phone',
  'latitude', 'longitude',
];

/** `null` and `undefined` both mean "no value" here — `FacilityRecord`'s fields are optional while
 *  the database columns are nullable, so the same absence arrives spelled two ways. */
const same = (a: unknown, b: unknown): boolean =>
  (a ?? null) === (b ?? null);

export function classifyFacilityRows(
  records: FacilityRecord[],
  existingById: Map<string, ExistingFacility>,
  opts: { previewedAt: Date | null },
): ClassifiedRow[] {
  // ⛔ Normalised through `new Date(...)`, never compared as strings. `facility_registry.updated_at`
  // is `timestamptz`, which node-postgres returns as a Date, even though FacilityRegistryTable
  // declares `string`. A string comparison would work by accident on ISO input and silently fail on
  // a Date. `facility-job-store.ts` already applies this idiom on every read.
  const watermark = opts.previewedAt === null ? null : new Date(opts.previewedAt).getTime();

  return records.map((r) => {
    const existing = existingById.get(r.id);
    if (!existing) return { kind: 'create' as const, merged: r, diff: [] };

    // Merge exactly what `importFacilities` will write, and compare against THAT — not against the
    // raw parsed record. The importer is not authoritative for local_code or for extras keys it did
    // not produce, so a comparison that ignored the merge would report a change the write does not
    // actually make.
    const merged: FacilityRecord = {
      ...r,
      localCode: r.localCode ?? existing.localCode ?? null,
      extras: { ...(existing.extras ?? {}), ...(r.extras ?? {}) },
    };

    if (watermark !== null && new Date(existing.updatedAt).getTime() > watermark) {
      return { kind: 'conflict' as const, merged, diff: [] };
    }

    const diff: { field: string; before: unknown; after: unknown }[] = [];
    for (const field of COMPARED) {
      const before = (existing.fields as Record<string, unknown>)[field];
      const after = (merged as unknown as Record<string, unknown>)[field];
      if (!same(before, after)) diff.push({ field, before: before ?? null, after: after ?? null });
    }

    // `canonicalJson` sorts object keys recursively. Required, not defensive: Postgres re-sorts jsonb
    // keys on read, so a plain JSON.stringify reports a spurious diff on every row that has extras.
    const beforeExtras = existing.extras ?? {};
    const afterExtras = merged.extras ?? {};
    if (canonicalJson(beforeExtras) !== canonicalJson(afterExtras)) {
      diff.push({ field: 'extras', before: beforeExtras, after: afterExtras });
    }

    return { kind: diff.length === 0 ? ('unchanged' as const) : ('changed' as const), merged, diff };
  });
}
