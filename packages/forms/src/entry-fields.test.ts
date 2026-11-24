import { describe, it, expect } from 'vitest'
import { entryAnswersOfResponse, entryFacilitiesOf, entryFieldsOf, entryKeyOf, entryValuesOf } from './entry-fields'
import { ServiceRequestExtractor } from './extract/extract'
import { toQuestionnaireResponse } from './response'
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

describe('entryFacilitiesOf', () => {
  const registry = 'urn:openldr:cs:facility-registry'
  const facilityField = (id: string, order: number, register = true) => ({
    id, displayLabel: id, fieldType: 'facility' as const, order,
    fhirPath: 'ServiceRequest.requester', fhirDiscriminator: { type: 'Organization' as const },
    ...(register ? { referenceTarget: registry } : {}),
  })
  const siteA = { system: registry, code: 'A1', display: 'Site A' }
  const siteB = { system: registry, code: 'B1', display: 'Site B' }

  /** The facility the order extractor really puts on the order. */
  function orderFacilityOf(form: FormSchema, answers: Record<string, unknown>) {
    const [order] = ServiceRequestExtractor.extract(toQuestionnaireResponse(form, answers as never), toQuestionnaire(form), {})
    const role = (order as { contained?: { organization?: { identifier?: { value?: string }; display?: string } }[] }).contained?.[0]
    return role?.organization ?? null
  }

  it('lists every facility field on the form, with whether it picks from the register', () => {
    const form = requisition([facilityField('f1', 1), facilityField('f2', 2, false)])
    expect(entryFacilitiesOf(form, {}).fields).toEqual([
      { id: 'f1', fromRegister: true },
      { id: 'f2', fromRegister: false },
    ])
  })

  it('reads every answered facility field, and takes the last one as the order does', () => {
    const form = requisition([facilityField('f1', 1), facilityField('f2', 2)])
    const answers = { num: 'R1', f1: siteA, f2: siteB }
    const v = entryFacilitiesOf(form, answers)
    expect(v.answered.map((a) => a.fieldId)).toEqual(['f1', 'f2'])
    expect(v.answered.map((a) => a.facility?.code)).toEqual(['A1', 'B1'])
    expect(v.order).toMatchObject({ facility: { code: 'B1' }, name: 'Site B' })
    expect(orderFacilityOf(form, answers)).toMatchObject({ identifier: { value: v.order!.facility!.code } })
  })

  it('with only the first answered, the order facility is the first, as the extractor gives', () => {
    const form = requisition([facilityField('f1', 1), facilityField('f2', 2)])
    const v = entryFacilitiesOf(form, { num: 'R1', f1: siteA })
    expect(v.answered).toHaveLength(1)
    expect(v.order?.facility?.code).toBe('A1')
    expect(orderFacilityOf(form, { num: 'R1', f1: siteA })).toMatchObject({ identifier: { value: 'A1' } })
  })

  it('a typed name is answered with no picked facility, and keeps its name', () => {
    const form = requisition([facilityField('f1', 1, false)])
    const v = entryFacilitiesOf(form, { num: 'R1', f1: ' Some clinic ' })
    expect(v.answered).toEqual([{ fieldId: 'f1', facility: null, name: 'Some clinic' }])
    expect(v.order).toEqual({ fieldId: 'f1', facility: null, name: 'Some clinic' })
  })

  it('gives nothing for a form the order extractor does not run on', () => {
    const form = makeSchema({ id: 'f', name: 'F', fhirResourceType: 'Patient', fields: [makeField(facilityField('f1', 0))] })
    expect(entryFacilitiesOf(form, { f1: siteA })).toEqual({ fields: [], answered: [], order: null })
  })
})

describe('entryKeyOf', () => {
  /** The requisition number the order extractor really puts on the order. */
  function orderNumberOf(form: FormSchema, answers: Record<string, unknown>) {
    const [order] = ServiceRequestExtractor.extract(toQuestionnaireResponse(form, answers as never), toQuestionnaire(form), {})
    return (order as { identifier?: { value?: string }[] }).identifier?.[0]?.value ?? null
  }
  const twoNumbers = () => requisition([
    { id: 'num2', displayLabel: 'Second number', fieldType: 'text', order: 1, fhirPath: 'ServiceRequest.identifier' },
  ])

  it('takes the number the order carries: the last answered identifier field', () => {
    const form = twoNumbers()
    const answers = { num: 'CS-0001', num2: 'CS-0002' }
    expect(entryKeyOf(form, answers)).toBe('CS-0002')
    expect(orderNumberOf(form, answers)).toBe('CS-0002')
  })

  it('takes the first when only it is answered, and trims it', () => {
    const form = twoNumbers()
    expect(entryKeyOf(form, { num: ' CS-0001 ' })).toBe('CS-0001')
    expect(orderNumberOf(form, { num: 'CS-0001' })).toBe('CS-0001')
  })

  it('gives null with no number, and for a form the order extractor does not run on', () => {
    expect(entryKeyOf(twoNumbers(), {})).toBeNull()
    const form = makeSchema({
      id: 'f', name: 'F', fhirResourceType: 'Patient',
      fields: [makeField({ id: 'n', displayLabel: 'N', fieldType: 'text', order: 0, fhirPath: 'ServiceRequest.identifier.value' })],
    })
    expect(entryKeyOf(form, { n: 'R1' })).toBeNull()
  })
})

describe('entryAnswersOfResponse', () => {
  const read = (form: FormSchema, answers: Record<string, unknown>) =>
    entryAnswersOfResponse(form, toQuestionnaireResponse(form, answers as never))

  it('gives every answered single field in form order, uncut, written as the summary writes a value', () => {
    const form = requisition([
      { id: 'e', displayLabel: 'E', fieldType: 'number', order: 9 },
      { id: 'a', displayLabel: 'A', fieldType: 'text', order: 1 },
      { id: 'b', displayLabel: 'B', fieldType: 'date', order: 5 },
      { id: 'blank', displayLabel: 'Blank', fieldType: 'text', order: 6 },
      { id: 'c', displayLabel: 'C', fieldType: 'boolean', order: 7 },
      { id: 'd', displayLabel: 'D', fieldType: 'facility', order: 8, referenceTarget: 'urn:openldr:cs:facility-registry' },
    ])
    expect(read(form, {
      num: ' R1 ', a: 'x'.repeat(100), b: '2026-11-22', blank: '', c: false, d: picked, e: 4,
    })).toEqual([
      { fieldId: 'num', label: 'Requisition', value: 'R1' },
      { fieldId: 'a', label: 'A', value: 'x'.repeat(100) },
      { fieldId: 'b', label: 'B', value: '2026-11-22' },
      { fieldId: 'c', label: 'C', value: 'false', parts: [false] },
      { fieldId: 'd', label: 'D', value: 'Kibaha Health Centre' },
      { fieldId: 'e', label: 'E', value: '4' },
    ])
  })

  it('joins the values of a multiselect answer with a comma', () => {
    const form = requisition([{ id: 'm', displayLabel: 'Tests', fieldType: 'multiselect', order: 1 }])
    expect(read(form, { m: ['hiv-vl', 'cd4'] })).toEqual([{ fieldId: 'm', label: 'Tests', value: 'hiv-vl, cd4' }])
  })

  it('gives each answered child of a group its own row, labelled with the group', () => {
    const form = requisition([
      { id: 'g', displayLabel: 'Contact', fieldType: 'group', order: 1 },
      { id: 'gn', displayLabel: 'Name', fieldType: 'text', order: 2, groupId: 'g' },
      { id: 'gp', displayLabel: 'Phone', fieldType: 'text', order: 3, groupId: 'g' },
      { id: 'after', displayLabel: 'After', fieldType: 'text', order: 4 },
    ])
    expect(read(form, { g: [{ gn: 'Juma', gp: '0700' }], after: 'z' })).toEqual([
      { fieldId: 'gn', label: 'Contact / Name', value: 'Juma' },
      { fieldId: 'gp', label: 'Contact / Phone', value: '0700' },
      { fieldId: 'after', label: 'After', value: 'z' },
    ])
  })

  it('shows each part of a test details answer, by display or else by code', () => {
    const form = requisition([{ id: 't', displayLabel: 'Results', fieldType: 'testDetails', order: 1 }])
    const response = {
      resourceType: 'QuestionnaireResponse', status: 'completed',
      item: [{ linkId: 't', item: [{ linkId: 'urn:t|VL', item: [
        { linkId: 'urn:t|VL#specimen', answer: [{ valueCoding: { system: 's', code: 'plasma', display: 'Plasma' } }] },
        { linkId: 'urn:t|VL#p|q', answer: [{ valueQuantity: { value: 40, unit: 'copies/mL' } }] },
        { linkId: 'urn:t|VL#p|r', answer: [{ valueCoding: { system: 's', code: 'DET' } }] },
      ] }] }],
    } as never
    expect(entryAnswersOfResponse(form, response)).toEqual([{ fieldId: 't', label: 'Results', value: 'Plasma, 40 copies/mL, DET' }])
  })

  // Task 3 fix: a yes/no answer keeps true or false in its parts, so the studio can say it in the
  // reader's language. The stored value is still true or false.
  it('gives a yes/no answer as true or false in its parts, and other answers with no parts', () => {
    const CATALOG = 'urn:openldr:codesystem:test-catalog'
    const response = { resourceType: 'QuestionnaireResponse', status: 'completed', item: [
      { linkId: 't', item: [{ linkId: `${CATALOG}|CUL`, item: [
        { linkId: `${CATALOG}|CUL#urn:openldr:default_result|GROWTH`, answer: [{ valueBoolean: false }] },
        { linkId: `${CATALOG}|CUL#urn:openldr:default_result|NOTE`, answer: [{ valueString: 'clotted' }] },
      ] }] },
      { linkId: 'num', answer: [{ valueString: 'R1' }] },
    ] }
    const form = requisition([{ id: 't', displayLabel: 'Results', fieldType: 'testDetails', order: 1 }])
    expect(entryAnswersOfResponse(form, response as never)).toEqual([
      { fieldId: 't', label: 'Results', value: 'false, clotted', parts: [false, 'clotted'] },
      { fieldId: 'num', label: expect.any(String), value: 'R1' },
    ])
  })

  it('keeps the label the saved copy carries after the form is edited, and falls back to the form', () => {
    const form = requisition([{ id: 'a', displayLabel: 'Renamed', fieldType: 'text', order: 1 }])
    const response = {
      resourceType: 'QuestionnaireResponse', status: 'completed',
      item: [
        { linkId: 'num', answer: [{ valueString: 'R1' }] },
        { linkId: 'a', text: 'Patient name', answer: [{ valueString: 'Amina' }] },
        { linkId: 'gone', text: 'Old field', answer: [{ valueString: 'kept' }] },
      ],
    } as never
    expect(entryAnswersOfResponse(form, response)).toEqual([
      { fieldId: 'num', label: 'Requisition', value: 'R1' },
      { fieldId: 'a', label: 'Patient name', value: 'Amina' },
      { fieldId: 'gone', label: 'Old field', value: 'kept' },
    ])
  })
})
