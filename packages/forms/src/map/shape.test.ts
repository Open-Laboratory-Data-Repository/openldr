import { describe, it, expect } from 'vitest';
import { shapeOf } from './shape';

describe('shapeOf', () => {
  it('gives the same hash for the same keys in another order', () => {
    const a = shapeOf({ pat_no: 'T-1', result: 4, tested: true });
    const b = shapeOf({ tested: false, result: 9, pat_no: 'T-2' });
    expect(a.hash).toBe(b.hash);
    expect(a.fields).toEqual(b.fields);
  });

  it('gives another hash for one more key', () => {
    const a = shapeOf({ pat_no: 'T-1', result: 4 });
    const b = shapeOf({ pat_no: 'T-1', result: 4, ward: 'W-1' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('gives another hash when a field changes type', () => {
    expect(shapeOf({ result: 4 }).hash).not.toBe(shapeOf({ result: '4' }).hash);
  });

  it('gives the same hash when a value changes', () => {
    expect(shapeOf({ pat_no: 'T-1' }).hash).toBe(shapeOf({ pat_no: 'T-999' }).hash);
  });

  it('lists fields sorted by name with the top-level JSON type', () => {
    const s = shapeOf({ z: null, a: 'x', n: 1.5, b: false, l: [1, 2], o: { k: 'v' }, gone: undefined });
    expect(s.fields).toEqual([
      { name: 'a', type: 'string' },
      { name: 'b', type: 'boolean' },
      { name: 'l', type: 'list' },
      { name: 'n', type: 'number' },
      { name: 'o', type: 'object' },
      { name: 'z', type: 'null' },
    ]);
  });

  it('puts no value in the output', () => {
    const s = shapeOf({ pat_no: 'QZX-SECRET-77', nested: { inner: 'QZX-INNER-88' } });
    const text = JSON.stringify(s);
    expect(text).not.toContain('QZX-SECRET-77');
    expect(text).not.toContain('QZX-INNER-88');
    expect(text).not.toContain('inner');
  });

  it('gives a hex hash', () => {
    expect(shapeOf({ a: 1 }).hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
