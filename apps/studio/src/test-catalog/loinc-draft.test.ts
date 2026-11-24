import { describe, it, expect } from 'vitest';
import type { CatalogTestResultParam, LoincFieldPlan } from '@/api';
import { addFromLoinc, dropLoincAdded } from './loinc-draft';

const RESULT = 'urn:openldr:default_result';
const param = (code: string, over: Partial<CatalogTestResultParam> = {}): CatalogTestResultParam => (
  { system: RESULT, code, resultType: 'numeric', valueSetUrl: null, bands: [], ...over });
const plan = (code: string, over: Partial<LoincFieldPlan> = {}): LoincFieldPlan => (
  { loinc: code, code, display: code, resultType: 'numeric', unit: null, valueSetUrl: null, exists: false, ...over });

describe('addFromLoinc', () => {
  it('in add mode skips a code already present and keeps that param untouched', () => {
    const kept = param('2093-3', {
      resultType: 'coded', valueSetUrl: 'urn:mine',
      bands: [{ name: null, low: 0, high: 5, unit: 'mmol/L', sex: null, ageLow: null, ageHigh: null }],
    });
    const out = addFromLoinc([param('HGB'), kept], [plan('2093-3'), plan('2571-8', { resultType: 'text' })], 'add', () => RESULT);
    expect(out.params).toEqual([param('HGB'), kept, param('2571-8', { resultType: 'text' })]);
    expect(out.added).toEqual(['2571-8']);
  });

  it("builds the param from the plan's code, type and value set", () => {
    const out = addFromLoinc([], [plan('5778-6', { code: 'COL', resultType: 'coded', valueSetUrl: 'urn:loinc-answers:5778-6' })], 'add', () => RESULT);
    expect(out.params).toEqual([param('COL', { resultType: 'coded', valueSetUrl: 'urn:loinc-answers:5778-6' })]);
    expect(out.added).toEqual(['COL']);
  });

  it('in replace mode leaves only the plans, in order', () => {
    const out = addFromLoinc([param('HGB'), param('2093-3', { resultType: 'text' })], [plan('2093-3'), plan('2571-8')], 'replace', () => RESULT);
    expect(out.params).toEqual([param('2093-3'), param('2571-8')]);
    expect(out.added).toEqual(['2093-3', '2571-8']);
  });

  it('adds a code once when two plans name it', () => {
    const out = addFromLoinc([], [plan('2093-3'), plan('2093-3')], 'add', () => RESULT);
    expect(out.added).toEqual(['2093-3']);
  });
});

describe('dropLoincAdded', () => {
  it('removes only the params the record lists, and keeps one ticked by hand after the pick', () => {
    const params = [param('2093-3'), param('HGB')];
    const out = dropLoincAdded(params, { loinc: '2093-3', params: ['2093-3'], newFields: [plan('2093-3')] });
    expect(out).toEqual([param('HGB')]);
  });

  it('changes nothing without a record', () => {
    const params = [param('HGB')];
    expect(dropLoincAdded(params, null)).toBe(params);
  });
});
