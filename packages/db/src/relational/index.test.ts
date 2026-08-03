import { describe, it, expect } from 'vitest';
import { projectResource } from './index';

describe('projectResource result shape', () => {
  it('returns a single-row array and no scope for a fact resource', () => {
    const r = projectResource({ resourceType: 'Patient', id: 'p1' }, {});
    expect(r?.table).toBe('patients');
    expect(r?.rows).toHaveLength(1);
    expect(r?.rows[0]).toMatchObject({ id: 'p1' });
    expect(r?.scope).toBeUndefined();
  });

  it('still returns null for an unmapped resource type', () => {
    expect(projectResource({ resourceType: 'Practitioner', id: 'x' }, {})).toBeNull();
  });
});
