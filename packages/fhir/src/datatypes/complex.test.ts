import { describe, it, expect } from 'vitest';
import { Identifier, Coding, CodeableConcept, Reference, HumanName, Quantity } from './complex';

describe('fhir complex datatypes', () => {
  it('Coding accepts a typical coding and preserves extensions', () => {
    const r = Coding.safeParse({ system: 'http://loinc.org', code: '2339-0', display: 'Glucose', extension: [{ url: 'x' }] });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).extension).toBeDefined();
  });
  it('CodeableConcept nests codings', () => {
    expect(CodeableConcept.safeParse({ coding: [{ code: 'x' }], text: 'glucose' }).success).toBe(true);
  });
  it('Identifier validates use enum', () => {
    expect(Identifier.safeParse({ system: 'urn:x', value: '123', use: 'official' }).success).toBe(true);
    expect(Identifier.safeParse({ use: 'bogus' }).success).toBe(false);
  });
  it('Reference and HumanName parse', () => {
    expect(Reference.safeParse({ reference: 'Patient/1' }).success).toBe(true);
    expect(HumanName.safeParse({ family: 'Doe', given: ['Jane'] }).success).toBe(true);
  });
  // A logical reference (R4 `Reference.identifier`): no resource to point at, so the target is
  // named by an Identifier instead of `reference`. This is how the CDR toolchain now sends a
  // facility performer: `{ identifier: { system, value }, display }`.
  it('Reference models identifier as a real Identifier, not merely passthrough', () => {
    const ok = Reference.safeParse({
      identifier: { system: 'urn:openldr:default_fac', value: 'BAMAA' },
      display: 'Aga Khan',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect((ok.data as { identifier?: unknown }).identifier).toEqual({ system: 'urn:openldr:default_fac', value: 'BAMAA' });
    }
    // Proves `identifier` is actually VALIDATED against the Identifier schema, not just carried
    // through by `.passthrough()` — an invalid nested `use` must fail parsing.
    const bad = Reference.safeParse({ identifier: { use: 'bogus', value: 'BAMAA' } });
    expect(bad.success).toBe(false);
  });
  it('Quantity rejects a non-numeric value', () => {
    expect(Quantity.safeParse({ value: 'high' }).success).toBe(false);
  });
});
