import { canonicalJson } from '@openldr/core';
import type { FacilityRecord } from '@openldr/db';

export type FacilityChangeKind = 'create' | 'changed' | 'unchanged' | 'conflict';

export interface ExistingFacility {
  id: string;
  extras: Record<string, unknown> | null;
  /** The row's CURRENT provenance — carried for the audit `before` only (see `importFacilities`'
   *  `facility.import.row` write in facility-import.ts), never for comparison. A parsed row's
   *  `source` is unconditionally `'import'` (facility-csv.ts / facility-release.ts), so an audit
   *  `before` that omitted this read `source` as "added" on every single changed row, forever —
   *  including the common case where the facility was ALREADY `'import'` and nothing provenance-wise
   *  actually changed. Deliberately a sibling of `fields`, not folded into it: `fields`/`COMPARED`
   *  below decide `changed`-vs-`unchanged`, and `source` must never be able to tip that decision (see
   *  `COMPARED`'s docblock) — only `before`/`after` reporting, once a row is ALREADY `changed` for an
   *  unrelated reason, should ever see it move. */
  source: FacilityRecord['source'];
  /** Every comparable column, already in FacilityRecord's camelCase shape. */
  fields: Omit<FacilityRecord, 'id' | 'source' | 'extras'>;
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
 * ⛔ `facilityCode`/`facilitySystem` are deliberately absent, but for a DIFFERENT reason than the
 * `localCode` rule they replace. `localCode` was excluded because the importer never produced one
 * and had to preserve the operator's; there is no such column now. The pair is excluded because it
 * is the row's IDENTITY — `resolveIdsByPair` matched this record to this row BY that pair, so it
 * cannot differ, and comparing it would be asserting the join it just performed.
 * `managedOrigin` is absent because the sync applier owns it, not this path.
 *
 * ⛔ `source` is ALSO deliberately absent, even though `ExistingFacility` now carries it (as a
 * sibling of `fields`, not inside it — see that field's docblock). Every parsed row is unconditionally
 * `source: 'import'`, so comparing it here would classify a manually-created facility `changed` on
 * the FIRST import that ever touches it even when every other column already matches — a false
 * positive on the same shape, triggered by provenance instead of a code.
 */
const COMPARED: (keyof FacilityRecord)[] = [
  'name', 'level', 'ownership', 'status', 'country',
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
    // raw parsed record. The importer is not authoritative for extras keys it did not produce, so a
    // comparison that ignored the merge would report a change the write does not actually make.
    //
    // The `localCode` carry-forward that used to sit here is gone with the column: there is no
    // operator-assigned code left for a re-import to preserve.
    const merged: FacilityRecord = {
      ...r,
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
