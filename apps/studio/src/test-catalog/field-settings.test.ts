import { describe, it, expect } from 'vitest';
import type { CatalogResultBand, CatalogTestResultParam } from '@/api';
import { changeType, fieldsInOrder, moveParam, setRequired, withBandField, withSettings } from './field-settings';

const P = (code: string, extra: Partial<CatalogTestResultParam> = {}): CatalogTestResultParam => ({
  system: 's', code, resultType: 'numeric', valueSetUrl: null, bands: [], ...extra,
});
const BAND: CatalogResultBand = { name: null, low: 1, high: 2, unit: null, sex: null, ageLow: null, ageHigh: null };

describe('field settings', () => {
  it('drops the settings of the old type when the type changes, and keeps required', () => {
    const next = changeType(P('HGB', { min: 0, max: 9, decimals: 1, required: false, bands: [BAND] }), 'text');
    expect(next).toEqual({ system: 's', code: 'HGB', resultType: 'text', valueSetUrl: null, bands: [], required: false });
    expect(next).not.toHaveProperty('min');
    expect(next).not.toHaveProperty('decimals');
  });

  it('writes only the settings of its own type, and leaves blank ones and any date out', () => {
    expect(withSettings(P('HGB'), { min: 0, max: null, decimals: 2, minLength: 4 })).toEqual({ ...P('HGB'), min: 0, decimals: 2 });
    const date = withSettings(P('D', { resultType: 'date', dateLimit: 'past' }), { dateLimit: 'any' });
    expect(date).not.toHaveProperty('dateLimit');
    expect(withSettings(P('T', { resultType: 'text' }), { minLength: 1, maxLength: 20 })).toEqual({ ...P('T', { resultType: 'text' }), minLength: 1, maxLength: 20 });
  });

  it('stores required only when false', () => {
    const off = setRequired(P('HGB'), false);
    expect(off.required).toBe(false);
    expect(setRequired(off, true)).not.toHaveProperty('required');
  });

  it('moves a param up and down, and not past an end', () => {
    const list = [P('A'), P('B'), P('C')];
    expect(moveParam(list, 'C', -1).map((p) => p.code)).toEqual(['A', 'C', 'B']);
    expect(moveParam(list, 'A', 1).map((p) => p.code)).toEqual(['B', 'A', 'C']);
    expect(moveParam(list, 'A', -1)).toBe(list);
    expect(moveParam(list, 'C', 1)).toBe(list);
  });

  it('draws the ticked fields in the test order, then the unticked ones', () => {
    const options = [{ code: 'A' }, { code: 'B' }, { code: 'C' }];
    expect(fieldsInOrder(options, [P('C'), P('A')]).map((o) => o.code)).toEqual(['C', 'A', 'B']);
  });

  it('writes a range field only when set', () => {
    const set = withBandField(BAND, 'country', 'KEN');
    expect(set.country).toBe('KEN');
    expect(withBandField(set, 'country', null)).not.toHaveProperty('country');
    expect(withBandField(BAND, 'validFrom', '')).not.toHaveProperty('validFrom');
  });
});
