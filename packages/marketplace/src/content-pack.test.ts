import { describe, it, expect } from 'vitest';
import { parseContentPack, summarizeContentPack, ContentPackError } from './content-pack';

const full = {
  formatVersion: 1,
  steps: [
    { kind: 'code-system', resource: { resourceType: 'CodeSystem', url: 'urn:x:cs', name: 'Colours' } },
    { kind: 'value-set', resource: { resourceType: 'ValueSet', url: 'urn:x:vs' } },
    { kind: 'facility-register', url: 'urn:x:reg', name: 'Sites', code: 'sites', csv: 'id,name\n1,A\n\n2,B\r\n3,C\n' },
    { kind: 'link-matching', registerUrl: 'urn:x:reg' },
    { kind: 'custom-queries', file: { queries: [{ name: 'Q one' }, { name: 'Q two' }] } },
  ],
};

describe('content pack', () => {
  it('parses a pack with one step of each kind', () => {
    expect(parseContentPack(full).steps).toHaveLength(5);
  });
  it('rejects an unknown formatVersion', () => {
    expect(() => parseContentPack({ ...full, formatVersion: 2 })).toThrow('this pack needs a newer CE');
    expect(() => parseContentPack({ ...full, formatVersion: 2 })).toThrow(ContentPackError);
  });
  it('rejects an unknown step kind', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'dashboard' }] })).toThrow('this pack needs a newer CE');
  });
  it('rejects a malformed known step', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'link-matching' }] })).toThrow(/invalid pack/);
  });
  it('keeps a register step\'s extraColumns', () => {
    const reg = { kind: 'facility-register', url: 'urn:x:reg', name: 'Sites', code: 'sites', csv: 'national_code,name\n1,A\n', extraColumns: ['province_code', 'district_code'] };
    expect(parseContentPack({ formatVersion: 1, steps: [reg] }).steps[0]).toMatchObject({ extraColumns: ['province_code', 'district_code'] });
  });
  it('rejects an empty name in extraColumns', () => {
    const reg = { kind: 'facility-register', url: 'urn:x:reg', name: 'Sites', code: 'sites', csv: 'national_code,name\n1,A\n', extraColumns: [''] };
    expect(() => parseContentPack({ formatVersion: 1, steps: [reg] })).toThrow(/invalid pack/);
  });
  it('summarizes each step kind', () => {
    expect(summarizeContentPack(parseContentPack(full))).toEqual([
      { kind: 'code-system', label: 'Colours', count: 1 },
      { kind: 'value-set', label: 'urn:x:vs', count: 1 },
      { kind: 'facility-register', label: 'Sites', count: 3 },
      { kind: 'link-matching', label: 'urn:x:reg', count: 1 },
      { kind: 'custom-queries', label: 'Q one, Q two', count: 2 },
    ]);
  });
});

describe('test-mappings step', () => {
  const step = { kind: 'test-mappings', mappings: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '25836-8' }, { system: 'urn:openldr:disa', code: 'POCVR', loinc: '25836-8' }] };

  it('parses and summarises as "Test mappings" with the count', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [step] });
    expect(summarizeContentPack(pack)).toEqual([{ kind: 'test-mappings', label: 'Test mappings', count: 2 }]);
  });

  it('refuses a malformed LOINC code and an empty list', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [{ system: 'x', code: 'y', loinc: 'abc' }] }] })).toThrow(/invalid pack/);
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [] }] })).toThrow(/invalid pack/);
  });
});

describe('result-mappings step', () => {
  const step = { kind: 'result-mappings', mappings: [{ system: 'urn:openldr:disa', code: 'HIVVL', loinc: '20447-9' }] };

  it('parses and summarises as "Result mappings" with the count', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [step] });
    expect(summarizeContentPack(pack)).toEqual([{ kind: 'result-mappings', label: 'Result mappings', count: 1 }]);
  });

  it('refuses a malformed LOINC code and an empty list', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [{ system: 'x', code: 'y', loinc: 'abc' }] }] })).toThrow(/invalid pack/);
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ ...step, mappings: [] }] })).toThrow(/invalid pack/);
  });
});

describe('content pack: datasets (pack datasets design)', () => {
  it('parses_a_datasets_step', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'zm_request_times', sql: 'select 1 as a', indexes: [['a']] }] }] });
    expect(pack.steps[0]).toEqual({ kind: 'datasets', tables: [{ name: 'zm_request_times', sql: 'select 1 as a', indexes: [['a']] }] });
  });
  it('refuses_a_dataset_name_that_is_not_a_plain_lower_case_name', () => {
    for (const name of ['Ab_c', 'ab', 'a-b-c', '1abc', 'public.x', 'a'.repeat(49), 'abc__new', 'a__b']) {
      expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name, sql: 'select 1' }] }] })).toThrow(/invalid pack/);
    }
  });
  it('refuses_two_datasets_with_one_name_in_a_step', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'abc', sql: 'select 1' }, { name: 'abc', sql: 'select 2' }] }] })).toThrow(/invalid pack/);
  });
  it('refuses_a_datasets_step_with_no_table_and_an_empty_index', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [] }] })).toThrow(/invalid pack/);
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'abc', sql: 'select 1', indexes: [[]] }] }] })).toThrow(/invalid pack/);
  });
  it('refuses_a_second_datasets_step', () => {
    const step = (name: string) => ({ kind: 'datasets', tables: [{ name, sql: 'select 1' }] });
    expect(() => parseContentPack({ formatVersion: 1, steps: [step('abc'), step('abd')] })).toThrow(/invalid pack: .*one datasets step/);
  });
  it('summarizes_a_datasets_step_by_its_names', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [{ kind: 'datasets', tables: [{ name: 'abc', sql: 'select 1' }, { name: 'abd', sql: 'select 2' }] }] });
    expect(summarizeContentPack(pack)).toEqual([{ kind: 'datasets', label: 'abc, abd', count: 2 }]);
  });
});


describe('content pack: profile steps (profile packs design)', () => {
  it('parses the four profile steps', () => {
    const pack = parseContentPack({ formatVersion: 1, steps: [
      { kind: 'needs', bundles: [{ id: 'sample-tracking', version: '>=0.1.0' }] },
      { kind: 'role', slug: 'sample-clerk', name: 'Sample Clerk', capabilities: ['forms.view', 'forms.submit', 'patients.view'] },
      { kind: 'layout', key: 'collection-site', name: 'Collection site', startPage: '/forms', pages: ['/forms', '/patients', '/docs'], roles: ['sample-clerk'] },
      { kind: 'form', key: 'lab-request', questionnaire: { resourceType: 'Questionnaire', title: 'Lab request' }, open: ['sample-clerk'], submit: ['sample-clerk'] },
    ] });
    expect(summarizeContentPack(pack)).toEqual([
      { kind: 'needs', label: 'sample-tracking', count: 1 },
      { kind: 'role', label: 'Sample Clerk', count: 3 },
      { kind: 'layout', label: 'Collection site', count: 3 },
      { kind: 'form', label: 'Lab request', count: 1 },
    ]);
  });
  it('refuses a role with no capabilities', () => {
    expect(() => parseContentPack({ formatVersion: 1, steps: [{ kind: 'role', slug: 'x-role', name: 'X', capabilities: [] }] })).toThrow(/invalid pack/);
  });
  it('refuses two steps with the same kind and key', () => {
    const layout = { kind: 'layout', key: 'a-b', name: 'A', startPage: null, pages: ['/forms'], roles: [] };
    expect(() => parseContentPack({ formatVersion: 1, steps: [layout, { ...layout, name: 'B' }] })).toThrow(/listed twice/);
  });
});
