import { describe, it, expect } from 'vitest';
import { buildMapping, columnSet, draftsFor, exampleFor, exampleText, ruleOf, rowsFromItems, sampleFromItems, savedMappingFor, testFieldsOf, withMapping, MAX_SAMPLE_ROWS } from './rows';
import { shapeOf } from '@openldr/forms/pure';
import { TEST_TARGET, ROWS_A, ROWS_B, asItems } from './test-fixtures';

describe('rowsFromItems', () => {
  it('takes each item json as a row with no source path', () => {
    expect(rowsFromItems(asItems(ROWS_A), '')).toEqual(ROWS_A);
  });

  it('reads the source path, and a list of plain objects gives one row each', () => {
    expect(rowsFromItems([{ json: { body: ROWS_A } }], 'body')).toEqual(ROWS_A);
    expect(rowsFromItems([{ json: { body: ROWS_B[0] } }], '.body')).toEqual(ROWS_B);
  });

  it('leaves out FHIR and scalars', () => {
    const fhir = { resourceType: 'Patient', id: 'x' };
    // A lab row holding a list of objects is flattened like any other, whatever the objects hold.
    expect(rowsFromItems([{ json: fhir }, { json: { body: [fhir] } }, { json: { body: 'QZX-1' } }], '')).toEqual([{ 'body.resourceType': ['Patient'], 'body.id': ['x'] }, { body: 'QZX-1' }]);
    expect(rowsFromItems([{ json: fhir }, { json: { body: [fhir] } }, { json: { body: 'QZX-1' } }], 'body')).toEqual([]);
  });

  it('keeps at most the Test route limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ json: { c: i } }));
    expect(rowsFromItems(many, '')).toHaveLength(MAX_SAMPLE_ROWS);
  });
});

describe('sampleFromItems and columnSet', () => {
  it('takes the columns of every row, before the cut to the Test limit', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ json: i === 24 ? { a: `QZX-${i}`, late: 'QZX-L' } : { a: `QZX-${i}` } }));
    const sample = sampleFromItems(items, '');
    expect(sample.rows).toHaveLength(MAX_SAMPLE_ROWS);
    expect(sample.fieldNames).toEqual(['a', 'late']);
  });

  it('gives rows {a,b} and {a,c} one set of columns a, b, c', () => {
    const sample = sampleFromItems(asItems([{ a: 1, b: 2 }, { a: 1, c: 3 }]), '');
    const set = columnSet(sample)!;
    expect(set.fieldNames).toEqual(['a', 'b', 'c']);
    expect(set.rows).toEqual(sample.rows);
    // The hash is shapeOf of an object with each column set to the empty string.
    expect(set.hash).toBe(shapeOf({ a: '', b: '', c: '' }).hash);
  });

  it('gives no column set for no rows', () => {
    expect(columnSet(sampleFromItems([], ''))).toBeNull();
  });
});

describe('savedMappingFor', () => {
  const mk = (fieldNames: string[], shapeHash = 'h') => ({ shapeHash, fieldNames, targetId: 't', rows: [] });
  it('takes the mapping with the same field set, else one that holds every field', () => {
    const wide = mk(['a', 'b', 'c']);
    const same = mk(['b', 'a']);
    expect(savedMappingFor({ fieldNames: ['a', 'b'] }, [wide, same])).toBe(same);
    expect(savedMappingFor({ fieldNames: ['a', 'b'] }, [wide])).toBe(wide);
    expect(savedMappingFor({ fieldNames: ['a', 'x'] }, [wide, same])).toBeNull();
  });

  it('falls back to the widest narrower mapping whose columns are all in the group', () => {
    const one = mk(['a']);
    const two = mk(['a', 'b']);
    expect(savedMappingFor({ fieldNames: ['a', 'b', 'c'] }, [one, two])).toBe(two);
  });
});

describe('exampleFor', () => {
  it('takes the first row of the group that has a value for the column', () => {
    expect(exampleFor('b', [{ a: 1 }, { a: 1, b: '' }, { a: 1, b: 'QZX-9' }])).toBe('QZX-9');
    expect(exampleFor('q', [{ a: 1 }])).toBeUndefined();
  });
});

describe('exampleText', () => {
  it('cuts a long value to 40 characters', () => {
    expect(exampleText('x'.repeat(50))).toHaveLength(40);
    expect(exampleText(null)).toBe('');
  });
});

describe('ruleOf', () => {
  it('turns finished drafts into rules and unfinished ones into incomplete', () => {
    expect(ruleOf({ kind: 'date', format: 'dd/MM/yyyy' })).toEqual({ kind: 'date', format: 'dd/MM/yyyy' });
    expect(ruleOf({ kind: 'date', format: ' ' })).toBe('incomplete');
    expect(ruleOf({ kind: 'split', by: ' ', take: 'part', part: '2' })).toEqual({ kind: 'split', by: ' ', take: 1 });
    expect(ruleOf({ kind: 'split', by: ' ', take: 'part', part: '0' })).toBe('incomplete');
    expect(ruleOf({ kind: 'values', pairs: [{ from: '', to: 'x' }] })).toBe('incomplete');
    expect(ruleOf({ kind: 'values', pairs: [{ from: 'm', to: '' }] })).toBe('incomplete');
    expect(ruleOf({ kind: 'values', pairs: [{ from: 'm', to: 'male' }, { from: 'f', to: '' }] })).toEqual({ kind: 'values', map: { m: 'male' } });
    expect(ruleOf({ kind: 'codeList', conceptMapUrl: '', sourceSystem: '' })).toBe('incomplete');
    expect(ruleOf({ kind: 'codeList', conceptMapUrl: 'urn:a', sourceSystem: ' urn:s ' })).toEqual({ kind: 'codeList', conceptMapUrl: 'urn:a', sourceSystem: 'urn:s' });
    expect(ruleOf({ kind: 'none' })).toBeNull();
  });
});

describe('buildMapping and draftsFor', () => {
  const shape = { hash: 'h1', fieldNames: ['a', 'b'] };

  it('round-trips a saved mapping, keeping added rows', () => {
    const drafts = draftsFor(TEST_TARGET, null);
    drafts[0].source = { kind: 'field', fields: ['a'] };
    drafts[2].source = { kind: 'field', fields: ['a', 'b'] };
    drafts[2].rule = { kind: 'split', by: '-', take: 'last', part: '1' };
    drafts.push({ ...drafts[1], targetPath: 'Patient.active', label: 'Patient.active', added: true, source: { kind: 'fixed', value: 'true' } });
    const built = buildMapping(drafts, shape, TEST_TARGET.id, { requireAll: true });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const again = draftsFor(TEST_TARGET, built.mapping);
    expect(again.map((d) => [d.targetPath, d.source, d.rule.kind, d.added])).toEqual([
      ['Patient.identifier.value', { kind: 'field', fields: ['a'] }, 'none', false],
      ['Patient.gender', { kind: 'none' }, 'none', false],
      ['Observation.code', { kind: 'field', fields: ['a', 'b'] }, 'split', false],
      ['Observation.valueString', { kind: 'none' }, 'none', false],
      ['Observation.valueQuantity.value', { kind: 'none' }, 'none', false],
      ['Patient.birthDate', { kind: 'none' }, 'none', false],
      ['Patient.active', { kind: 'fixed', value: 'true' }, 'none', true],
    ]);
  });

  it('only refuses a missing required field when asked to', () => {
    const drafts = draftsFor(TEST_TARGET, null);
    expect(buildMapping(drafts, shape, 't', { requireAll: true })).toEqual({ ok: false, problem: 'required', label: 'Patient ID' });
    expect(buildMapping(drafts, shape, 't', { requireAll: false })).toMatchObject({ ok: true, mapping: { rows: [] } });
  });

  it('treats a blank fixed value as no source', () => {
    const drafts = draftsFor(TEST_TARGET, null);
    drafts[1].source = { kind: 'fixed', value: '  ' };
    const built = buildMapping(drafts, shape, 't', { requireAll: false });
    expect(built.ok && built.mapping.rows).toEqual([]);
  });
});

describe('withMapping', () => {
  it('replaces the mapping with the same field set, whatever its hash, and keeps the rest', () => {
    const a = { shapeHash: 'a', fieldNames: ['x'], targetId: 't', rows: [] };
    const b = { shapeHash: 'b', fieldNames: ['y', 'z'], targetId: 't', rows: [] };
    const b2 = { shapeHash: 'other', fieldNames: ['z', 'y'], targetId: 't', rows: [] };
    expect(withMapping([a, b], b2)).toEqual([a, b2]);
  });

  it('removes a narrower mapping and keeps one that only overlaps', async () => {
    const { narrowerCount } = await import('./rows');
    const narrow = { shapeHash: 'n', fieldNames: ['x'], targetId: 't', rows: [] };
    const overlap = { shapeHash: 'o', fieldNames: ['x', 'q'], targetId: 't', rows: [] };
    const wide = { shapeHash: 'w', fieldNames: ['x', 'y'], targetId: 't', rows: [] };
    expect(withMapping([narrow, overlap], wide)).toEqual([overlap, wide]);
    expect(narrowerCount([narrow, overlap, wide], ['x', 'y'])).toBe(1);
  });
});

describe('testFieldsOf and per-column tests', () => {
  it('reads the test field of each repeating record from its identity', () => {
    expect(testFieldsOf(TEST_TARGET)).toEqual(['Observation.code']);
  });

  it('builds a list of tests on the test field from the result field\'s columns, in their order', () => {
    const drafts = draftsFor(TEST_TARGET, null).map((d) => {
      if (d.targetPath === 'Patient.identifier.value') return { ...d, source: { kind: 'field' as const, fields: ['pid'] } };
      if (d.targetPath === 'Observation.valueString') return { ...d, source: { kind: 'field' as const, fields: ['B', 'A'] }, columnTests: { A: ' typed ' } };
      return d;
    });
    const built = buildMapping(drafts, { hash: 'h', fieldNames: ['A', 'B', 'pid'] }, TEST_TARGET.id, { requireAll: true, testFields: ['Observation.code'] });
    if (!built.ok) throw new Error(built.problem);
    expect(built.mapping.rows.find((r) => r.targetPath === 'Observation.code')!.from).toEqual({ fixedList: ['B', 'typed'] });
  });
});

describe('buildMapping refuses what the node would refuse', () => {
  it('gives a problem naming the row, not a throw, when the mapping would not parse after a JSON round trip', () => {
    // A row the panel never makes: a blank target path. It stands for any shape the schema refuses.
    const drafts = draftsFor(TEST_TARGET, null).map((d) =>
      d.targetPath === 'Patient.identifier.value' ? { ...d, targetPath: '', label: 'Patient ID', source: { kind: 'fixed' as const, value: 'x' } } : d,
    );
    expect(buildMapping(drafts, { hash: 'h', fieldNames: ['a'] }, TEST_TARGET.id, { requireAll: false })).toEqual({ ok: false, problem: 'invalid', label: 'Patient ID' });
  });
});

describe('nested rows, as the node reads them', () => {
  it('flattens nested fields and a list of objects into the sample', () => {
    const items = asItems([{ patient: { number: 'P-1' }, results: [{ code: 'HB', value: '14.9' }, { code: 'WBC', value: '6.2' }] }]);
    const sample = sampleFromItems(items, '');
    expect(sample.fieldNames).toEqual(['patient.number', 'results.code', 'results.value']);
    expect(sample.rows[0]).toEqual({ 'patient.number': 'P-1', 'results.code': ['HB', 'WBC'], 'results.value': ['14.9', '6.2'] });
  });

  it('keeps a row whose names clash once flattened as it came', () => {
    const row = { 'patient.number': 'P-1', patient: { number: 'P-2' } };
    expect(rowsFromItems(asItems([row]), '')).toEqual([row]);
  });
});
