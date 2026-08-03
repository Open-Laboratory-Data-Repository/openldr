import { describe, expect, it } from 'vitest';
import { projectValueSet } from './value-set';
import { projectResource } from './index';

const vs = {
  resourceType: 'ValueSet', id: 'vs-seed-biological-sex', url: 'urn:openldr:valueset:biological-sex',
  expansion: { contains: [
    { system: 'urn:openldr:cs:local', code: 'M', display: 'Male' },
    { system: 'urn:openldr:cs:local', code: 'F', display: 'Female' },
  ] },
};

describe('projectValueSet', () => {
  it('projects one row per concept with a deterministic composite id', () => {
    const rows = projectValueSet(vs, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'vs-seed-biological-sex|urn:openldr:cs:local|M',
      value_set_id: 'vs-seed-biological-sex',
      value_set_url: 'urn:openldr:valueset:biological-sex',
      system: 'urn:openldr:cs:local', code: 'M', display: 'Male',
    });
  });

  it('is deterministic — reprojecting the same resource yields identical ids', () => {
    expect(projectValueSet(vs, {}).map((r) => r.id)).toEqual(projectValueSet(vs, {}).map((r) => r.id));
  });

  it('projects zero rows for a value set with no expansion', () => {
    expect(projectValueSet({ resourceType: 'ValueSet', id: 'empty' }, {})).toEqual([]);
  });

  // F1: admin-authored value sets are pre-deduped by expandCompose's own dedup() before they ever
  // reach here, but ValueSet is also a registered ingestable FHIR type — an INGESTED resource can
  // carry a raw `expansion.contains` with duplicate (system, code) entries. Two identical entries
  // must collapse to one row: two rows sharing an `id` in one insertBatchPg statement makes real
  // Postgres raise "ON CONFLICT DO UPDATE command cannot affect row a second time" (pg-mem hides
  // this — it silently collapses duplicate ids, so no test on the in-memory fake catches it).
  it('dedupes duplicate (system, code) entries down to one row (F1)', () => {
    const dup = {
      resourceType: 'ValueSet', id: 'vs-dup', url: 'urn:test:dup',
      expansion: { contains: [
        { system: 'urn:sys', code: 'X', display: 'first' },
        { system: 'urn:sys', code: 'X', display: 'second — a duplicate ingest row' },
      ] },
    };
    const rows = projectValueSet(dup, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'vs-dup|urn:sys|X', code: 'X', display: 'first' });
  });

  // F2: `id` is a synthetic `<value_set_id>|<system>|<code>` string, not a FHIR id, and the column
  // is `varchar(255)` on MySQL (011_terminology_codes.ts). A long system URI plus a long code can
  // breach that bound; MySQL in non-strict mode silently TRUNCATES rather than erroring, which would
  // collapse two distinct concepts onto the same row. The fallback must stay both bounded AND
  // deterministic (reprojectAll recomputes the id on every rebuild).
  describe('long composite ids (F2)', () => {
    const longSystem = `urn:openldr:cs:${'x'.repeat(200)}`;
    const longCode = 'y'.repeat(100);

    it('keeps the id within the 255-char MySQL bound', () => {
      const rows = projectValueSet(
        { resourceType: 'ValueSet', id: 'vs-long', url: 'urn:test:long', expansion: { contains: [{ system: longSystem, code: longCode }] } },
        {},
      );
      expect(rows).toHaveLength(1);
      expect((rows[0]!.id as string).length).toBeLessThanOrEqual(255);
    });

    it('is deterministic — the same long input yields the same id twice', () => {
      const resource = { resourceType: 'ValueSet', id: 'vs-long', url: 'urn:test:long', expansion: { contains: [{ system: longSystem, code: longCode }] } };
      const first = projectValueSet(resource, {}).map((r) => r.id);
      const second = projectValueSet(resource, {}).map((r) => r.id);
      expect(first).toEqual(second);
    });

    it('gives two different long concepts two different ids', () => {
      const mk = (code: string) => ({
        resourceType: 'ValueSet', id: 'vs-long', url: 'urn:test:long',
        expansion: { contains: [{ system: longSystem, code }] },
      });
      const idA = projectValueSet(mk(`${longCode}-a`), {})[0]!.id;
      const idB = projectValueSet(mk(`${longCode}-b`), {})[0]!.id;
      expect(idA).not.toBe(idB);
      expect((idA as string).length).toBeLessThanOrEqual(255);
      expect((idB as string).length).toBeLessThanOrEqual(255);
    });
  });
});

describe('projectResource for ValueSet', () => {
  it('returns the concepts scoped by value_set_id', () => {
    const r = projectResource(vs, {});
    expect(r?.table).toBe('terminology_codes');
    expect(r?.rows).toHaveLength(2);
    expect(r?.scope).toEqual({ column: 'value_set_id', value: 'vs-seed-biological-sex' });
  });
});
