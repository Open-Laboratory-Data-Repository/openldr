import { describe, it, expect } from 'vitest'
import type { FormField } from './schema/form-schema'
import { toAnswer, fromAnswer } from './answer-value'
import { makeField } from './__fixtures__/forms'

// Helpers — round-trip: fromAnswer(toAnswer(field, v)) should recover v
function rt(field: ReturnType<typeof makeField>, value: unknown): unknown {
  const ans = toAnswer(field, value)
  if (ans === null) return null
  return fromAnswer(ans)
}

describe('toAnswer', () => {
  it('returns null for empty/null/undefined values', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0 })
    expect(toAnswer(field, undefined)).toBeNull()
    expect(toAnswer(field, null)).toBeNull()
    expect(toAnswer(field, '')).toBeNull()
  })

  it('encodes text as valueString', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0 })
    expect(toAnswer(field, 'hello')).toEqual({ valueString: 'hello' })
  })

  it('encodes phone as valueString', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'phone', order: 0 })
    expect(toAnswer(field, '+1234567890')).toEqual({ valueString: '+1234567890' })
  })

  it('encodes email as valueString', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'email', order: 0 })
    expect(toAnswer(field, 'a@b.com')).toEqual({ valueString: 'a@b.com' })
  })

  it('encodes identifier as valueString', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'identifier', order: 0 })
    expect(toAnswer(field, 'ID-001')).toEqual({ valueString: 'ID-001' })
  })

  it('encodes number as valueDecimal', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'number', order: 0 })
    expect(toAnswer(field, 42)).toEqual({ valueDecimal: 42 })
    expect(toAnswer(field, 3.14)).toEqual({ valueDecimal: 3.14 })
  })

  it('encodes boolean as valueBoolean', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'boolean', order: 0 })
    expect(toAnswer(field, true)).toEqual({ valueBoolean: true })
    expect(toAnswer(field, false)).toEqual({ valueBoolean: false })
  })

  it('encodes date as valueDate', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'date', order: 0 })
    expect(toAnswer(field, '2024-06-15')).toEqual({ valueDate: '2024-06-15' })
  })

  it('encodes datetime as valueDateTime', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'datetime', order: 0 })
    expect(toAnswer(field, '2024-06-15T10:30:00Z')).toEqual({ valueDateTime: '2024-06-15T10:30:00Z' })
  })

  it('encodes select as valueCoding', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'select', order: 0 })
    expect(toAnswer(field, 'M')).toEqual({ valueCoding: { code: 'M' } })
  })

  it('encodes multiselect as valueCoding', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'multiselect', order: 0 })
    expect(toAnswer(field, 'fever')).toEqual({ valueCoding: { code: 'fever' } })
  })

  it('encodes reference as valueReference', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'reference', order: 0 })
    expect(toAnswer(field, 'Patient/123')).toEqual({ valueReference: { reference: 'Patient/123' } })
  })
})

describe('fromAnswer', () => {
  it('reads valueString', () => {
    expect(fromAnswer({ valueString: 'hello' })).toBe('hello')
  })

  it('reads valueDecimal', () => {
    expect(fromAnswer({ valueDecimal: 3.14 })).toBe(3.14)
  })

  it('reads valueInteger', () => {
    expect(fromAnswer({ valueInteger: 7 })).toBe(7)
  })

  it('reads valueBoolean', () => {
    expect(fromAnswer({ valueBoolean: false })).toBe(false)
  })

  it('reads valueDate', () => {
    expect(fromAnswer({ valueDate: '2024-01-01' })).toBe('2024-01-01')
  })

  it('reads valueDateTime', () => {
    expect(fromAnswer({ valueDateTime: '2024-01-01T00:00:00Z' })).toBe('2024-01-01T00:00:00Z')
  })

  it('reads valueCoding as code string', () => {
    expect(fromAnswer({ valueCoding: { code: 'M' } })).toBe('M')
  })

  it('reads valueReference as reference string', () => {
    expect(fromAnswer({ valueReference: { reference: 'Patient/123' } })).toBe('Patient/123')
  })

  it('returns undefined for unrecognised shape', () => {
    expect(fromAnswer({})).toBeUndefined()
  })
})

describe('round-trips', () => {
  it('text: fromAnswer(toAnswer(field, v)) === v', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'text', order: 0 })
    expect(rt(field, 'Jane')).toBe('Jane')
  })

  it('phone: round-trips as string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'phone', order: 0 })
    expect(rt(field, '+1234567890')).toBe('+1234567890')
  })

  it('email: round-trips as string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'email', order: 0 })
    expect(rt(field, 'a@b.com')).toBe('a@b.com')
  })

  it('identifier: round-trips as string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'identifier', order: 0 })
    expect(rt(field, 'ID-001')).toBe('ID-001')
  })

  it('number: round-trips as decimal', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'number', order: 0 })
    expect(rt(field, 30)).toBe(30)
    expect(rt(field, 3.14)).toBe(3.14)
  })

  it('boolean: round-trips true/false', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'boolean', order: 0 })
    expect(rt(field, true)).toBe(true)
    expect(rt(field, false)).toBe(false)
  })

  it('date: round-trips as string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'date', order: 0 })
    expect(rt(field, '1994-01-02')).toBe('1994-01-02')
  })

  it('datetime: round-trips as string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'datetime', order: 0 })
    expect(rt(field, '2024-06-15T10:30:00Z')).toBe('2024-06-15T10:30:00Z')
  })

  it('select: round-trips code as string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'select', order: 0 })
    expect(rt(field, 'M')).toBe('M')
  })

  it('reference: round-trips as reference string', () => {
    const field = makeField({ id: 'x', displayLabel: 'X', fieldType: 'reference', order: 0 })
    expect(rt(field, 'Patient/123')).toBe('Patient/123')
  })
})

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null,
  fieldType: 'reference', required: false, enabled: true, order: 0,
  cardinality: { min: 0, max: '1' }, ...over,
});

describe('toAnswer — reference answers', () => {
  it('serializes a coding answer with its system and display', () => {
    expect(toAnswer(field({}), { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }))
      .toEqual({ valueCoding: { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' } });
  });

  it('omits display when null', () => {
    expect(toAnswer(field({}), { system: 'http://loinc.org', code: '718-7', display: null }))
      .toEqual({ valueCoding: { system: 'http://loinc.org', code: '718-7' } });
  });

  it('serializes an entity answer with its display', () => {
    expect(toAnswer(field({}), { reference: 'Patient/p1', display: 'Doe Jane' }))
      .toEqual({ valueReference: { reference: 'Patient/p1', display: 'Doe Jane' } });
  });

  it('keeps the legacy bare-string mapping for reference and facility', () => {
    expect(toAnswer(field({}), 'Patient/p1')).toEqual({ valueReference: { reference: 'Patient/p1' } });
    expect(toAnswer(field({ fieldType: 'facility' }), 'Organization/o1'))
      .toEqual({ valueReference: { reference: 'Organization/o1' } });
  });

  it('keeps the legacy bare-string mapping for organism and antibiogram', () => {
    expect(toAnswer(field({ fieldType: 'organism' }), 'E. coli')).toEqual({ valueString: 'E. coli' });
    expect(toAnswer(field({ fieldType: 'antibiogram' }), 'AMP-R')).toEqual({ valueString: 'AMP-R' });
  });

  it('leaves select and multiselect untouched', () => {
    expect(toAnswer(field({ fieldType: 'select' }), 'routine')).toEqual({ valueCoding: { code: 'routine' } });
    expect(toAnswer(field({ fieldType: 'multiselect' }), 'a')).toEqual({ valueCoding: { code: 'a' } });
  });
});

describe('fromAnswer', () => {
  it('reconstructs a coding answer when a system is present', () => {
    expect(fromAnswer({ valueCoding: { system: 'http://loinc.org', code: '718-7', display: 'Hb' } }))
      .toEqual({ system: 'http://loinc.org', code: '718-7', display: 'Hb' });
  });

  it('returns a bare code when no system is present, so select still round-trips', () => {
    expect(fromAnswer({ valueCoding: { code: 'routine' } })).toBe('routine');
  });

  it('reconstructs an entity answer when a display is present', () => {
    expect(fromAnswer({ valueReference: { reference: 'Patient/p1', display: 'Doe Jane' } }))
      .toEqual({ reference: 'Patient/p1', display: 'Doe Jane' });
  });

  it('returns a bare reference when no display is present, so legacy answers still round-trip', () => {
    expect(fromAnswer({ valueReference: { reference: 'Patient/123' } })).toBe('Patient/123');
  });

  // Documents a known precondition rather than an aspiration: `system` is how fromAnswer
  // tells a coded reference answer from a select answer, so a system-bearing select answer
  // from an externally-authored QR hydrates as an object. See from-response.ts.
  it('decodes a system-bearing coding as an object even if it came from a select', () => {
    expect(fromAnswer({ valueCoding: { system: 'http://hl7.org/fhir/administrative-gender', code: 'female' } }))
      .toEqual({ system: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: null });
  });
});
