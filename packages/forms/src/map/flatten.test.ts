import { describe, expect, it } from 'vitest';
import { flattenRow } from './flatten';

describe('flattenRow', () => {
  it('joins object keys with a dot, at any depth', () => {
    expect(flattenRow({ patient: { number: 'P-1', name: { family: 'Chirwa' } }, ward: 'OPD 2' })).toEqual({
      ok: true,
      row: { 'patient.number': 'P-1', 'patient.name.family': 'Chirwa', ward: 'OPD 2' },
    });
  });

  it('turns a list of objects into one list column per key, lined up by position', () => {
    const res = flattenRow({ results: [{ code: 'HB', value: '14.9' }, { code: 'WBC', value: '6.2', unit: { code: '10*9/L' } }] });
    expect(res).toEqual({
      ok: true,
      row: { 'results.code': ['HB', 'WBC'], 'results.value': ['14.9', '6.2'], 'results.unit.code': [null, '10*9/L'] },
    });
  });

  it('keeps a list of plain values, plain values and nulls as they are', () => {
    const row = { symptoms: ['Dysuria', 'Frequency'], n: 0, ok: false, none: null };
    expect(flattenRow(row)).toEqual({ ok: true, row });
  });

  it('leaves a list inside a list entry as one column of lists, which the mapping notes', () => {
    const res = flattenRow({ isolates: [{ organism: 'E. coli', susceptibility: [{ antibiotic: 'AMP', result: 'R' }] }] });
    expect(res).toEqual({
      ok: true,
      row: { 'isolates.organism': ['E. coli'], 'isolates.susceptibility': [[{ antibiotic: 'AMP', result: 'R' }]] },
    });
  });

  it('keeps a list that mixes objects and plain values as it is', () => {
    const row = { mixed: [{ a: 1 }, 'x'] };
    expect(flattenRow(row)).toEqual({ ok: true, row });
  });

  it('gives the same row again when run on a flattened row', () => {
    const once = flattenRow({ patient: { number: 'P-1' }, results: [{ code: 'HB' }] });
    if (!once.ok) throw new Error(once.reason);
    expect(flattenRow(once.row)).toEqual(once);
  });

  it('fails two columns that flatten to one name, naming the column and no value', () => {
    const res = flattenRow({ 'patient.number': 'P-1', patient: { number: 'P-2' } });
    expect(res).toEqual({ ok: false, field: 'patient.number', reason: 'patient.number: two columns have this name once flattened' });
  });

  it('drops an empty object, which holds nothing', () => {
    expect(flattenRow({ a: 'x', extra: {} })).toEqual({ ok: true, row: { a: 'x' } });
  });
});
