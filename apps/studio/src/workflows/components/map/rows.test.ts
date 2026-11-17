import { describe, it, expect } from 'vitest';
import { buildMapping, draftsFor, exampleText, groupByShape, ruleOf, rowsFromItems, withMapping, MAX_SAMPLE_ROWS } from './rows';
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
    expect(rowsFromItems([{ json: fhir }, { json: { body: [fhir] } }, { json: { body: 'QZX-1' } }], '')).toEqual([{ body: [fhir] }, { body: 'QZX-1' }]);
    expect(rowsFromItems([{ json: fhir }, { json: { body: [fhir] } }, { json: { body: 'QZX-1' } }], 'body')).toEqual([]);
  });

  it('keeps at most the Test route limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ json: { c: i } }));
    expect(rowsFromItems(many, '')).toHaveLength(MAX_SAMPLE_ROWS);
  });
});

describe('groupByShape', () => {
  it('groups rows by shape, field names sorted', () => {
    const g = groupByShape([...ROWS_A, ...ROWS_B]);
    expect(g.map((x) => [x.fieldNames, x.rows.length])).toEqual([
      [['pat_no', 'sex', 'test_a', 'test_b'], 2],
      [['ident', 'result'], 1],
    ]);
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
    drafts.push({ ...drafts[1], targetPath: 'Patient.birthDate', label: 'Patient.birthDate', added: true, source: { kind: 'fixed', value: '2000-01-01' } });
    const built = buildMapping(drafts, shape, TEST_TARGET.id, { requireAll: true });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const again = draftsFor(TEST_TARGET, built.mapping);
    expect(again.map((d) => [d.targetPath, d.source, d.rule.kind, d.added])).toEqual([
      ['Patient.identifier.value', { kind: 'field', fields: ['a'] }, 'none', false],
      ['Patient.gender', { kind: 'none' }, 'none', false],
      ['Observation.code', { kind: 'field', fields: ['a', 'b'] }, 'split', false],
      ['Observation.valueString', { kind: 'none' }, 'none', false],
      ['Patient.birthDate', { kind: 'fixed', value: '2000-01-01' }, 'none', true],
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
  it('replaces the mapping with the same shape hash and keeps the rest', () => {
    const a = { shapeHash: 'a', fieldNames: [], targetId: 't', rows: [] };
    const b = { shapeHash: 'b', fieldNames: [], targetId: 't', rows: [] };
    const b2 = { ...b, fieldNames: ['x'] };
    expect(withMapping([a, b], b2)).toEqual([a, b2]);
  });
});
