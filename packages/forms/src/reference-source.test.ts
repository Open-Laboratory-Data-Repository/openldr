import { describe, expect, it } from 'vitest';
import type { FormField } from './schema/form-schema';
import { isCodingAnswer, isEntityAnswer, resolveReferenceSource } from './reference-source';

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null,
  fieldType: 'reference', required: false, enabled: true, order: 0,
  cardinality: { min: 0, max: '1' }, ...over,
});

describe('resolveReferenceSource', () => {
  it('classifies valueSetUrl as a valueset source', () => {
    expect(resolveReferenceSource(field({ valueSetUrl: 'http://x/vs/orderables' })))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'http://x/vs/orderables' } });
  });

  it('classifies a canonical URL referenceTarget as a codesystem source', () => {
    expect(resolveReferenceSource(field({ referenceTarget: 'http://loinc.org' })))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'codesystem', system: 'http://loinc.org' } });
  });

  it('classifies a cs-url-* referenceTarget as a codesystem source', () => {
    expect(resolveReferenceSource(field({ referenceTarget: 'cs-url-LOINC' })))
      .toEqual({ ok: true, source: { kind: 'coding', mode: 'codesystem', system: 'cs-url-LOINC' } });
  });

  it('classifies a bare name referenceTarget as an entity source', () => {
    expect(resolveReferenceSource(field({ referenceTarget: 'Patient' })))
      .toEqual({ ok: true, source: { kind: 'entity', target: 'Patient' } });
  });

  it('prefers valueSetUrl when both are set', () => {
    const r = resolveReferenceSource(field({ valueSetUrl: 'http://x/vs', referenceTarget: 'Patient' }));
    expect(r).toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'http://x/vs' } });
  });

  it('reports no-source when neither is set', () => {
    expect(resolveReferenceSource(field({}))).toEqual({ ok: false, reason: 'no-source' });
  });

  it('treats blank strings as absent', () => {
    expect(resolveReferenceSource(field({ valueSetUrl: '  ', referenceTarget: '' })))
      .toEqual({ ok: false, reason: 'no-source' });
  });
});

describe('answer guards', () => {
  it('recognises a coding answer', () => {
    expect(isCodingAnswer({ system: 's', code: 'c', display: null })).toBe(true);
    expect(isCodingAnswer({ reference: 'Patient/1', display: null })).toBe(false);
    expect(isCodingAnswer('plain')).toBe(false);
  });

  it('recognises an entity answer', () => {
    expect(isEntityAnswer({ reference: 'Patient/1', display: 'X' })).toBe(true);
    expect(isEntityAnswer({ system: 's', code: 'c', display: null })).toBe(false);
    expect(isEntityAnswer(null)).toBe(false);
  });
});
