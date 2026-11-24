import { describe, expect, it } from 'vitest';
import { validateResource } from '../validate';
import { Observation } from './observation';

const base = { resourceType: 'Observation', status: 'final', code: { text: 'Ampicillin disk diffusion' } };

describe('an Observation holds one result value', () => {
  it('refuses valueString and valueQuantity together, naming both and no value', () => {
    const res = Observation.safeParse({ ...base, valueString: 'Resistant', valueQuantity: { value: 6, unit: 'mm' } });
    expect(res.success).toBe(false);
    if (res.success) return;
    const msg = res.error.issues.map((i) => i.message).join(' ');
    expect(msg).toContain('valueQuantity');
    expect(msg).toContain('valueString');
    expect(msg).not.toContain('Resistant');
  });

  it('refuses two values of kinds the schema does not list, such as valueBoolean and valueInteger', () => {
    expect(Observation.safeParse({ ...base, valueBoolean: true, valueInteger: 1 }).success).toBe(false);
  });

  it('refuses a component with two values', () => {
    const res = Observation.safeParse({ ...base, component: [{ code: { text: 'zone' }, valueString: 'R', valueQuantity: { value: 6 } }] });
    expect(res.success).toBe(false);
  });

  it('accepts one value, no value, and a value beside a dataAbsentReason-free component', () => {
    expect(Observation.safeParse({ ...base, valueQuantity: { value: 100000, comparator: '>', unit: 'CFU/mL' } }).success).toBe(true);
    expect(Observation.safeParse(base).success).toBe(true);
    expect(Observation.safeParse({ ...base, valueString: 'x', component: [{ code: { text: 'a' }, valueString: 'y' }] }).success).toBe(true);
  });

  it('is refused by the shared validation persist uses', () => {
    expect(validateResource({ ...base, valueString: 'Resistant', valueQuantity: { value: 6 } }).ok).toBe(false);
  });
});

// Plan B, Task 3: the bench writes a yes/no result as valueBoolean and a date result as valueDateTime.
describe('an Observation holds a yes/no or a date result', () => {
  it('accepts valueBoolean and a valueDateTime that is a date or a date and time', () => {
    expect(Observation.safeParse({ ...base, valueBoolean: false }).success).toBe(true);
    expect(Observation.safeParse({ ...base, valueDateTime: '2026-11-20' }).success).toBe(true);
    expect(Observation.safeParse({ ...base, valueDateTime: '2026-11-20T08:30:00Z' }).success).toBe(true);
  });

  it('refuses a valueBoolean that is not true or false, and a valueDateTime that is not a date', () => {
    expect(Observation.safeParse({ ...base, valueBoolean: 'yes' }).success).toBe(false);
    expect(Observation.safeParse({ ...base, valueDateTime: '20/11/2026' }).success).toBe(false);
  });

  it('refuses valueBoolean beside valueDateTime', () => {
    expect(Observation.safeParse({ ...base, valueBoolean: true, valueDateTime: '2026-11-20' }).success).toBe(false);
  });
});
