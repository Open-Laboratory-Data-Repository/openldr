import { describe, it, expect } from 'vitest';
import { splitFacilityAnswers, CORE_FACILITY_KEYS } from './facility-answers';

const f = (id: string, apiProperty?: string | null) => ({ id, apiProperty });

describe('splitFacilityAnswers', () => {
  it('routes a known apiProperty to its column', () => {
    const { record, extras } = splitFacilityAnswers(
      [f('a', 'localCode'), f('b', 'name'), f('c', 'region')],
      { a: 'LAB01', b: 'Dodoma Regional Referral', c: 'Dodoma Region' },
    );
    expect(record).toEqual({ localCode: 'LAB01', name: 'Dodoma Regional Referral', region: 'Dodoma Region' });
    expect(extras).toEqual({});
  });

  it('routes an UNKNOWN apiProperty to extras', () => {
    const { record, extras } = splitFacilityAnswers([f('a', 'catchmentPop')], { a: '42000' });
    expect(record).toEqual({});
    expect(extras).toEqual({ catchmentPop: '42000' });
  });

  it('⛔ routes a field with NO apiProperty to extras, keyed by field id — never drops it', () => {
    // The seeded form shipped several fields with no apiProperty at all. Dropping them would lose
    // an operator's typed answer with no error anywhere.
    const { record, extras } = splitFacilityAnswers([f('fld-note')], { 'fld-note': 'closed for renovation' });
    expect(record).toEqual({});
    expect(extras).toEqual({ 'fld-note': 'closed for renovation' });
  });

  it('omits blank and whitespace-only answers from both sides', () => {
    const { record, extras } = splitFacilityAnswers(
      [f('a', 'localCode'), f('b', 'region'), f('c', 'somethingElse')],
      { a: 'LAB01', b: '   ', c: '' },
    );
    expect(record).toEqual({ localCode: 'LAB01' });
    expect(extras).toEqual({});
  });

  it('ignores an answer with no matching field — a stale client cannot inject columns', () => {
    const { record, extras } = splitFacilityAnswers([f('a', 'localCode')], { a: 'LAB01', ghost: 'x' });
    expect(record).toEqual({ localCode: 'LAB01' });
    expect(extras).toEqual({});
  });

  it('coerces latitude and longitude to numbers, and a non-numeric one to null', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'latitude'), f('b', 'longitude'), f('c', 'localCode')],
      { a: '-2.6', b: 'not-a-number', c: 'LAB01' },
    );
    expect(record.latitude).toBe(-2.6);
    expect(record.longitude).toBeNull();
  });

  it('trims text answers', () => {
    const { record } = splitFacilityAnswers([f('a', 'name')], { a: '  Muhimbili  ' });
    expect(record.name).toBe('Muhimbili');
  });

  it('exposes every writable column as a core key', () => {
    for (const k of ['localCode', 'nationalCode', 'nationalSystem', 'name', 'level', 'ownership',
      'status', 'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
      'addressText', 'phone', 'latitude', 'longitude']) {
      expect(CORE_FACILITY_KEYS.has(k), `${k} missing from CORE_FACILITY_KEYS`).toBe(true);
    }
    // `id`, `extras`, `managedOrigin` and `source` are set by the ROUTE, never by an answer.
    for (const k of ['id', 'extras', 'managedOrigin', 'source']) {
      expect(CORE_FACILITY_KEYS.has(k), `${k} must NOT be settable from a form answer`).toBe(false);
    }
  });
});
