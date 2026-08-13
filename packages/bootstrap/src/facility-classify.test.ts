import { describe, it, expect } from 'vitest';
import { classifyFacilityRows, type ExistingFacility } from './facility-classify';
import type { FacilityRecord } from '@openldr/db';

const rec = (over: Partial<FacilityRecord> = {}): FacilityRecord => ({
  id: 'fac-1', facilitySystem: 'S', facilityCode: '100', name: 'Alpha',
  level: null, ownership: null, status: null, country: null, zone: null, region: null,
  district: null, council: null, ward: null, village: null, addressText: null, phone: null,
  latitude: null, longitude: null, source: 'import', ...over,
});

const existing = (over: Partial<ExistingFacility> = {}): ExistingFacility => ({
  id: 'fac-1', extras: null, source: 'import',
  fields: {
    facilitySystem: 'S', facilityCode: '100', name: 'Alpha',
    level: null, ownership: null, status: null, country: null, zone: null, region: null,
    district: null, council: null, ward: null, village: null, addressText: null, phone: null,
    latitude: null, longitude: null, managedOrigin: null,
  },
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('classifyFacilityRows', () => {
  it('classifies an absent id as create', () => {
    const [row] = classifyFacilityRows([rec()], new Map(), { previewedAt: null });
    expect(row.kind).toBe('create');
  });

  it('classifies a byte-identical re-import as unchanged, NOT updated', () => {
    const map = new Map([['fac-1', existing()]]);
    const [row] = classifyFacilityRows([rec()], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
    expect(row.diff).toEqual([]);
  });

  // Review fix (Task 7 finding): `source` is carried on `ExistingFacility` now (for the audit
  // `before`, see facility-import.ts), but must never influence `changed`-vs-`unchanged` — a
  // manually-created facility (`source: 'manual'`) whose every COMPARED column already matches
  // what an import would write must stay `unchanged`, not flip to `changed` on provenance alone.
  // A mutation that added `'source'` to `COMPARED` would flip this to `changed` (`existing.fields`
  // carries no `source` key, so the comparison would read `before: undefined` against
  // `after: 'import'` and report a diff) — that is exactly the regression this test guards.
  it('does NOT report a change when a manually-created facility differs only in source', () => {
    const map = new Map([['fac-1', existing({ source: 'manual' })]]);
    const [row] = classifyFacilityRows([rec()], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
    expect(row.diff).toEqual([]);
  });

  it('classifies a renamed facility as changed and reports the field diff', () => {
    const map = new Map([['fac-1', existing()]]);
    const [row] = classifyFacilityRows([rec({ name: 'Alpha Hospital' })], map, { previewedAt: null });
    expect(row.kind).toBe('changed');
    expect(row.diff).toEqual([{ field: 'name', before: 'Alpha', after: 'Alpha Hospital' }]);
  });

  it('does NOT report a change when the only difference is operator-curated extras the import preserves', () => {
    const map = new Map([['fac-1', existing({ extras: { curatedNote: 'kept' } })]]);
    const [row] = classifyFacilityRows([rec()], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
    expect(row.merged.extras).toEqual({ curatedNote: 'kept' });
  });

  it('does NOT report a change when jsonb returns extras with reordered keys', () => {
    // The merge is `{ ...existing.extras, ...r.extras }` — a SHALLOW spread. A top-level key
    // present in both objects is only ever REPLACED, never deep-merged, so a flat top-level key
    // (e.g. `{ b: 2, a: 1 }` vs `{ a: 1, b: 2 }`) always inherits its order from `existing.extras`
    // regardless of the incoming order, and can never actually disagree — that shape does not
    // exercise this decision. The real hazard is one level down: when a SHARED key's value is
    // itself an object, that whole nested object is replaced wholesale by the incoming one, so its
    // internal key order comes from the freshly-parsed CSV row, not from what Postgres returned for
    // `existing.extras` — exactly the "jsonb re-sorts keys on read" case `canonicalJson` exists for.
    const map = new Map([['fac-1', existing({ extras: { meta: { b: 2, a: 1 } } })]]);
    const [row] = classifyFacilityRows([rec({ extras: { meta: { a: 1, b: 2 } } })], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
  });

  // ⛔ A TEST WAS DELETED HERE, deliberately: "preserves an existing local_code the importer never
  // carries, without calling it a change". It guarded a carry-forward that existed because the
  // importer produced no local code and had to keep the operator's. Migration 088 removed that
  // column, so there is nothing to carry and nothing to mistake for a change. The row's one code is
  // now the key `resolveIdsByPair` matched on, which is why `COMPARED` excludes it outright.

  it('classifies a row touched after the preview as conflict', () => {
    const map = new Map([['fac-1', existing({ updatedAt: new Date('2026-06-01T00:00:00Z') })]]);
    const [row] = classifyFacilityRows([rec({ name: 'Renamed' })], map, {
      previewedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(row.kind).toBe('conflict');
  });

  it('compares timestamps as instants, not strings — an ISO string from the driver still conflicts', () => {
    const map = new Map([['fac-1', existing({ updatedAt: '2026-06-01T00:00:00.000Z' })]]);
    const [row] = classifyFacilityRows([rec({ name: 'Renamed' })], map, {
      previewedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(row.kind).toBe('conflict');
  });

  it('never classifies conflict when previewedAt is null', () => {
    const map = new Map([['fac-1', existing({ updatedAt: new Date('2030-01-01T00:00:00Z') })]]);
    const [row] = classifyFacilityRows([rec({ name: 'Renamed' })], map, { previewedAt: null });
    expect(row.kind).toBe('changed');
  });
});
