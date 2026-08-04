import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

describe('splitFacilityAnswers — coding answers on core keys (ValueSet-bound level/status)', () => {
  it('flattens a coding answer to its display on a core key', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'level')],
      { a: { system: 'https://terminology.example/facility-level', code: 'IA2', display: 'Level IA2 (Dispensary Laboratory)' } },
    );
    expect(record.level).toBe('Level IA2 (Dispensary Laboratory)');
  });

  it('falls back to code when display is null', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'level')],
      { a: { system: 'https://terminology.example/facility-level', code: 'IA2', display: null } },
    );
    expect(record.level).toBe('IA2');
  });

  it('falls back to code when display is absent entirely', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'status')],
      { a: { system: 'https://terminology.example/facility-status', code: 'active' } },
    );
    expect(record.status).toBe('active');
  });

  it('still passes a bare string through unchanged on the same key — the pre-existing free-text path', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'level')],
      { a: 'Level IA2 (Dispensary Laboratory)' },
    );
    expect(record.level).toBe('Level IA2 (Dispensary Laboratory)');
  });

  it('leaves a coding answer on a non-core key unflattened in extras (jsonb — flattening loses the code for no benefit)', () => {
    const coding = { system: 'https://terminology.example/catchment', code: 'C1', display: 'Catchment One' };
    const { record, extras } = splitFacilityAnswers([f('a', 'catchmentPop')], { a: coding });
    expect(record).toEqual({});
    expect(extras).toEqual({ catchmentPop: coding });
  });

  it('omits a coding answer whose flattened display is blank/whitespace-only, same as the string path', () => {
    const { record } = splitFacilityAnswers(
      [f('a', 'level')],
      { a: { system: 'https://terminology.example/facility-level', code: '', display: '   ' } },
    );
    expect(record).toEqual({});
  });
});

describe('facility-answers.ts stays browser-safe (Minor 5)', () => {
  // This module is published as its own subpath (@openldr/db/facility-answers, see package.json)
  // specifically so apps/studio can import CORE_FACILITY_KEYS without pulling in `pg`/kysely and the
  // rest of the server DB engine. A runtime (non type-only) import added here later — even an
  // innocuous-looking one — would silently break the studio Vite bundle rather than fail loudly, so
  // this asserts the invariant directly against the source text rather than trusting a comment.
  it('has no runtime (non type-only) imports', () => {
    const path = fileURLToPath(new URL('./facility-answers.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const importLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));

    expect(importLines.length, 'expected at least the known `import type` line').toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line.startsWith('import type '), `runtime import found: ${line}`).toBe(true);
    }
  });
});
