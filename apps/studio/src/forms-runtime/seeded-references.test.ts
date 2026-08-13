import { describe, it, expect } from 'vitest';
import { pickSeededMatch, fieldsNeedingResolution, type ResolvableRow } from './seeded-references';

const row = (display: string, code: string | null): ResolvableRow => ({
  value: code === null ? { reference: display } : { system: 'urn:s', code, display },
  display,
  code,
});

describe('pickSeededMatch', () => {
  it('matches a stored display exactly — the common case, since the column holds displays', () => {
    const rows = [row('Health Center', 'health-center'), row('Dispensary', 'dispensary')];
    expect(pickSeededMatch('Health Center', rows)).toEqual({ system: 'urn:s', code: 'health-center', display: 'Health Center' });
  });

  it('falls back to an exact CODE match — a column that stores the code still resolves', () => {
    const rows = [row('Health Center', 'health-center')];
    expect(pickSeededMatch('health-center', rows)).toEqual({ system: 'urn:s', code: 'health-center', display: 'Health Center' });
  });

  it('falls back to a case-insensitive display match', () => {
    // Casing bites in this repo: value-set status is compared case-sensitively elsewhere and
    // silently yields empty expansions. A stored 'ACTIVE' must still find 'Active'.
    const rows = [row('Active', 'active')];
    expect(pickSeededMatch('ACTIVE', rows)).toEqual({ system: 'urn:s', code: 'active', display: 'Active' });
  });

  it('prefers an exact display over a case-insensitive one', () => {
    const rows = [row('active', 'lower'), row('Active', 'proper')];
    expect((pickSeededMatch('Active', rows) as { code: string }).code).toBe('proper');
  });

  it('leaves an AMBIGUOUS case-insensitive match unresolved rather than guessing', () => {
    const rows = [row('Active', 'a1'), row('ACTIVE', 'a2')];
    expect(pickSeededMatch('active', rows)).toBeUndefined();
  });

  it('returns undefined when nothing matches — the vocabulary genuinely lacks the value', () => {
    // 'Health Centre' (British) is what the Zambia register writes; the value set has
    // 'Health Center'. This MUST stay unresolved so the field honestly asks for a pick.
    expect(pickSeededMatch('Health Centre', [row('Health Center', 'health-center')])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(pickSeededMatch('Active', [])).toBeUndefined();
  });

  it('matches an entity row on display, whose value carries a reference rather than a code', () => {
    expect(pickSeededMatch('Jane Doe', [row('Jane Doe', null)])).toEqual({ reference: 'Jane Doe' });
  });
});

const schema = (fields: unknown[]): never => ({ id: 's', name: 'S', sections: [], fields }) as never;
const field = (over: Record<string, unknown>) => ({
  id: 'f', fhirPath: null, description: null, displayLabel: 'F', required: false,
  enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
});

describe('fieldsNeedingResolution', () => {
  it('names a reference field holding a bare string', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs' })]);
    expect(fieldsNeedingResolution(s, { level: 'Health Center' })).toEqual([{ fieldId: 'level', raw: 'Health Center' }]);
  });

  it('skips a field already holding a coding — resolution must be idempotent', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs' })]);
    expect(fieldsNeedingResolution(s, { level: { system: 'urn:s', code: 'health-center' } })).toEqual([]);
  });

  it('skips a reference field with NO source — FormRuntime renders a text input there', () => {
    // Same gate `validate` uses (runtime.ts:47): a sourceless reference field is a plain text box,
    // so a string in it is correct and must not be "resolved" against a list that does not exist.
    const s = schema([field({ id: 'level', fieldType: 'reference' })]);
    expect(fieldsNeedingResolution(s, { level: 'anything' })).toEqual([]);
  });

  it('skips a non-reference field', () => {
    const s = schema([field({ id: 'name', fieldType: 'text' })]);
    expect(fieldsNeedingResolution(s, { name: 'Chunga Clinic' })).toEqual([]);
  });

  it('skips an empty or absent answer', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs' })]);
    expect(fieldsNeedingResolution(s, { level: '' })).toEqual([]);
    expect(fieldsNeedingResolution(s, {})).toEqual([]);
  });

  it('skips a disabled field', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs', enabled: false })]);
    expect(fieldsNeedingResolution(s, { level: 'Health Center' })).toEqual([]);
  });
});
