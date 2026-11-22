import { describe, it, expect } from 'vitest'
import { entryFieldsOf, entryValuesOf } from './entry-fields'
import { sampleForms } from './samples/forms'
import { toQuestionnaire } from './to-questionnaire'
import { fromQuestionnaire } from './from-questionnaire'
import { EXT_OPENLDR_ENTRIES_LIST } from './extensions'
import { makeField, makeSchema } from './__fixtures__/forms'
import type { FormSchema } from './schema/form-schema'

const orderForm = sampleForms.find((f) => f.id === 'sample-order')!

const picked = { system: 'urn:openldr:cs:facility-registry', code: 'FAC-1', display: 'Kibaha Health Centre' }

/** A requisition form with the given extra fields after its requisition number. */
function requisition(extra: Parameters<typeof makeField>[0][]): FormSchema {
  return makeSchema({
    id: 'req',
    name: 'Req',
    fhirResourceType: 'ServiceRequest',
    fields: [
      makeField({ id: 'num', displayLabel: 'Requisition', fieldType: 'text', order: 0, fhirPath: 'ServiceRequest.identifier.value' }),
      ...extra.map((f) => makeField(f)),
    ],
  })
}

describe('entryFieldsOf', () => {
  it('finds the seeded Lab order requisition number and its register facility field', () => {
    expect(entryFieldsOf(orderForm)).toEqual({
      keyFieldId: 'fld-ord-ref-number',
      facilityFieldId: 'fld-ord-ref-facility',
      facilityFromRegister: true,
    })
  })

  it('takes a field bound to the whole identifier list too, as the extractor does', () => {
    const form = makeSchema({
      id: 'f', name: 'F', fhirResourceType: 'ServiceRequest',
      fields: [makeField({ id: 'n', displayLabel: 'N', fieldType: 'text', order: 0, fhirPath: 'ServiceRequest.identifier' })],
    })
    expect(entryFieldsOf(form).keyFieldId).toBe('n')
  })

  it('gives nulls for a form with no order binding', () => {
    const form = makeSchema({
      id: 'f', name: 'F', fhirResourceType: 'ServiceRequest',
      fields: [makeField({ id: 'a', displayLabel: 'A', fieldType: 'text', order: 0, fhirPath: 'ServiceRequest.note.0.text' })],
    })
    expect(entryFieldsOf(form)).toEqual({ keyFieldId: null, facilityFieldId: null, facilityFromRegister: false })
  })

  it('gives nulls for a form the order extractor does not run on', () => {
    const form = makeSchema({
      id: 'f', name: 'F', fhirResourceType: 'Patient',
      fields: [makeField({ id: 'n', displayLabel: 'N', fieldType: 'text', order: 0, fhirPath: 'ServiceRequest.identifier.value' })],
    })
    expect(entryFieldsOf(form)).toEqual({ keyFieldId: null, facilityFieldId: null, facilityFromRegister: false })
  })

  it('does not take the clinician requester as the facility', () => {
    const form = requisition([
      { id: 'doc', displayLabel: 'Clinician', fieldType: 'text', order: 1, fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Practitioner' } },
    ])
    expect(entryFieldsOf(form).facilityFieldId).toBeNull()
  })

  it('marks a free-text facility field as not from the register', () => {
    const form = requisition([
      { id: 'fac', displayLabel: 'Facility', fieldType: 'facility', order: 1, fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Organization' } },
    ])
    expect(entryFieldsOf(form)).toEqual({ keyFieldId: 'num', facilityFieldId: 'fac', facilityFromRegister: false })
  })
})

describe('entryValuesOf', () => {
  it('reads the requisition number and the picked facility coding', () => {
    const v = entryValuesOf(orderForm, { 'fld-ord-ref-number': ' CS-0001 ', 'fld-ord-ref-facility': picked })
    expect(v.entryKey).toBe('CS-0001')
    expect(v.facility).toEqual(picked)
  })

  it('gives a null facility for a typed name and a null key for an empty number', () => {
    const v = entryValuesOf(orderForm, { 'fld-ord-ref-number': '  ', 'fld-ord-ref-facility': 'Some clinic' })
    expect(v.entryKey).toBeNull()
    expect(v.facility).toBeNull()
  })

  it('builds the summary from flagged fields only, in form order', () => {
    const form = requisition([
      { id: 'c', displayLabel: 'Third', fieldType: 'text', order: 3, entriesList: true },
      { id: 'a', displayLabel: 'First', fieldType: 'text', order: 1 },
      { id: 'b', displayLabel: 'Second', fieldType: 'select', order: 2, entriesList: true },
    ])
    const v = entryValuesOf(form, { num: 'R1', a: 'not flagged', b: { system: 's', code: 'hiv', display: 'HIV VL' }, c: 'Amina J.' })
    expect(v.summary).toEqual([
      { label: 'Second', value: 'HIV VL' },
      { label: 'Third', value: 'Amina J.' },
    ])
  })

  it('with none flagged, uses the first three answered fields and leaves out the requisition number', () => {
    const form = requisition([
      { id: 'a', displayLabel: 'A', fieldType: 'text', order: 1 },
      { id: 'g', displayLabel: 'G', fieldType: 'group', order: 2 },
      { id: 'gc', displayLabel: 'In group', fieldType: 'text', order: 3, groupId: 'g' },
      { id: 'm', displayLabel: 'Many', fieldType: 'multiselect', order: 4 },
      { id: 'b', displayLabel: 'B', fieldType: 'date', order: 5 },
      { id: 'blank', displayLabel: 'Blank', fieldType: 'text', order: 6 },
      { id: 'c', displayLabel: 'C', fieldType: 'boolean', order: 7 },
      { id: 'd', displayLabel: 'D', fieldType: 'select', order: 8 },
      { id: 'e', displayLabel: 'E', fieldType: 'number', order: 9 },
    ])
    const v = entryValuesOf(form, {
      num: 'R1', a: 'x'.repeat(100), g: [{ gc: 'y' }], m: ['p', 'q'], b: '2026-11-22', blank: '', c: false,
      d: { system: 's', code: 'only-code' }, e: 4,
    })
    expect(v.summary).toEqual([
      { label: 'A', value: 'x'.repeat(80) },
      { label: 'B', value: '2026-11-22' },
      { label: 'C', value: 'false' },
    ])
  })

  it('shows a coding by its code when it has no display', () => {
    const form = requisition([{ id: 'd', displayLabel: 'D', fieldType: 'select', order: 1 }])
    expect(entryValuesOf(form, { d: { system: 's', code: 'only-code' } }).summary).toEqual([{ label: 'D', value: 'only-code' }])
  })
})

describe('the entries list flag', () => {
  it('survives a Questionnaire round trip on its own extension', () => {
    const form = requisition([{ id: 'a', displayLabel: 'A', fieldType: 'text', order: 1, entriesList: true }])
    const q = toQuestionnaire(form)
    const item = q.item?.find((i) => i.linkId === 'a')
    expect(item?.extension?.some((e) => e.url === EXT_OPENLDR_ENTRIES_LIST && e.valueBoolean === true)).toBe(true)
    const back = fromQuestionnaire(q)
    expect(back.fields.find((f) => f.id === 'a')?.entriesList).toBe(true)
    expect(back.fields.find((f) => f.id === 'num')?.entriesList).toBeUndefined()
  })
})
