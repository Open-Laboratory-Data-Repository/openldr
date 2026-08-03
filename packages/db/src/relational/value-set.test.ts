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
});

describe('projectResource for ValueSet', () => {
  it('returns the concepts scoped by value_set_id', () => {
    const r = projectResource(vs, {});
    expect(r?.table).toBe('terminology_codes');
    expect(r?.rows).toHaveLength(2);
    expect(r?.scope).toEqual({ column: 'value_set_id', value: 'vs-seed-biological-sex' });
  });
});
