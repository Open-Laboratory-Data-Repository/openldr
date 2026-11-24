import { describe, it, expect } from 'vitest'
import { toQuestionnaire } from './to-questionnaire'
import { fromQuestionnaire } from './from-questionnaire'
import { toQuestionnaireResponse } from './response'
import { ObservationExtractor, ServiceRequestExtractor } from './extract/extract'
import { TestResultsExtractor } from './extract/test-results'
import { toTransactionBundle } from './to-transaction-bundle'
import { makeField, makeSchema, definitionOf } from './__fixtures__/forms'
import { isOrderRejectionField, orderRejectionFieldId } from './order-rejection-path'
import { linkToOrder } from './link-to-order'
import { labOrderId } from './extract/order-ids'
import { projectObservation, projectServiceRequest } from '@openldr/db'
import { Observation as FhirObservation } from '@openldr/fhir'

const ctx = { subject: { reference: 'Patient/p1' }, authored: '2026-06-04T00:00:00Z' }

describe('observationExtract round-trip', () => {
  it('preserves the observationExtract flag through to/from Questionnaire', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      fields: [makeField({ id: 'hgb', displayLabel: 'Hgb', fieldType: 'number', order: 0, observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7' }] })],
    })
    expect(definitionOf(fromQuestionnaire(toQuestionnaire(model)))).toEqual(definitionOf(model))
  })
})

describe('ObservationExtractor', () => {
  it('emits a coded Observation carrying the answer (golden)', () => {
    const model = makeSchema({
      id: 'scr', name: 'Screening',
      fields: [makeField({ id: 'hgb', displayLabel: 'Hemoglobin', fieldType: 'number', order: 0, unit: 'g/dL', observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] })],
    })
    const q = toQuestionnaire(model)
    const qr = toQuestionnaireResponse(model, { hgb: 12.5 })
    expect(ObservationExtractor.extract(qr, q, ctx)).toEqual([
      {
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2026-06-04T00:00:00Z',
        valueQuantity: { value: 12.5, unit: 'g/dL', code: 'g/dL', system: 'http://unitsofmeasure.org' },
      },
    ])
  })

  it('does not extract fields not flagged for observation', () => {
    const model = makeSchema({ id: 'f', name: 'F', fields: [makeField({ id: 'note', displayLabel: 'Note', fieldType: 'text', order: 0 })] })
    const q = toQuestionnaire(model)
    expect(ObservationExtractor.extract(toQuestionnaireResponse(model, { note: 'hi' }), q, ctx)).toEqual([])
  })

  it('emits one Observation per repeating-group instance', () => {
    const model = makeSchema({
      id: 'f', name: 'F',
      fields: [
        makeField({ id: 'g', displayLabel: 'Readings', fieldType: 'group', order: 0 }),
        makeField({ id: 'bp', displayLabel: 'BP', fieldType: 'number', order: 1, groupId: 'g', observationExtract: true, code: [{ system: 'http://loinc.org', code: '8480-6' }] }),
      ],
    })
    const q = toQuestionnaire(model)
    const qr = toQuestionnaireResponse(model, { g: [{ bp: 120 }, { bp: 130 }] })
    const obs = ObservationExtractor.extract(qr, q, ctx)
    expect(obs).toHaveLength(2)
    expect(obs.map((o) => (o as { valueQuantity?: { value?: number } }).valueQuantity?.value)).toEqual([120, 130])
  })
})

describe('toTransactionBundle', () => {
  it('packages the response + extracted resources as a transaction', () => {
    const model = makeSchema({
      id: 'scr', name: 'Screening',
      fields: [makeField({ id: 'hgb', displayLabel: 'Hgb', fieldType: 'number', order: 0, observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7' }] })],
    })
    const q = toQuestionnaire(model)
    const qr = toQuestionnaireResponse(model, { hgb: 12 })
    const bundle = toTransactionBundle(qr, ObservationExtractor.extract(qr, q, ctx))
    expect(bundle.resourceType).toBe('Bundle')
    expect(bundle.type).toBe('transaction')
    expect(bundle.entry?.[0].resource?.resourceType).toBe('QuestionnaireResponse')
    expect(bundle.entry?.[1].resource?.resourceType).toBe('Observation')
    expect(bundle.entry?.[1].request).toEqual({ method: 'POST', url: 'Observation' })
  })
})

// The Lab order's requisition number moved from ServiceRequest.identifier to
// ServiceRequest.identifier.value with a discriminator (migration 103). The extractor matched the
// old path exactly, so without reading the new one a submitted order would silently lose it. It
// reads both: a form an operator edited keeps the old path, because the migration leaves it alone.
describe('ServiceRequestExtractor requisition number', () => {
  const orderWith = (field: Partial<Parameters<typeof makeField>[0]>) =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [makeField({ id: 'ref', displayLabel: 'Reference Number', fieldType: 'text', order: 0, ...field })],
    })
  const extract = (model: ReturnType<typeof orderWith>) =>
    ServiceRequestExtractor.extract(toQuestionnaireResponse(model, { ref: 'REF-42' }), toQuestionnaire(model), ctx)[0]

  it('reads the number from the identifier slot the shipped form now binds', () => {
    const model = orderWith({
      fhirPath: 'ServiceRequest.identifier.value',
      fhirDiscriminator: { system: 'urn:openldr:order:requisition' },
      fhirValueField: 'value',
    })
    expect(extract(model)).toMatchObject({ identifier: [{ value: 'REF-42' }] })
  })

  it('still reads it from the old whole-list path', () => {
    expect(extract(orderWith({ fhirPath: 'ServiceRequest.identifier' }))).toMatchObject({ identifier: [{ value: 'REF-42' }] })
  })

  // The operator asked on 2026-09-15 for the identifier to carry the system the slot names. Every
  // CE reader of an order identifier uses its value only, so this adds information and moves
  // nothing: the warehouse still projects identifier[0].value into lab_requests.request_id.
  it("writes the system the slot's discriminator names", () => {
    const model = orderWith({
      fhirPath: 'ServiceRequest.identifier.value',
      fhirDiscriminator: { system: 'urn:openldr:order:requisition' },
      fhirValueField: 'value',
    })
    expect((extract(model) as any).identifier).toEqual([{ system: 'urn:openldr:order:requisition', value: 'REF-42' }])
  })

  it('writes the value alone when the field names no system', () => {
    expect((extract(orderWith({ fhirPath: 'ServiceRequest.identifier' })) as any).identifier).toEqual([{ value: 'REF-42' }])
  })

  it('writes the value alone when the discriminator does not name one system', () => {
    const model = orderWith({
      fhirPath: 'ServiceRequest.identifier.value',
      fhirDiscriminator: { join: 'any', conds: [{ el: 'system', op: 'equals', val: 'urn:a' }, { el: 'system', op: 'equals', val: 'urn:b' }] },
      fhirValueField: 'value',
    })
    expect((extract(model) as any).identifier).toEqual([{ value: 'REF-42' }])
  })
})

describe('ServiceRequestExtractor tests codings (test catalog S4)', () => {
  const CATALOG = 'urn:openldr:codesystem:test-catalog'
  const TEST_CODE = 'urn:openldr:codesystem:test-catalog:test-code'
  const order = (fieldType: 'reference' | 'text') =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [makeField({
        id: 'tests', displayLabel: 'Tests', fieldType, order: 0, fhirPath: 'ServiceRequest.code',
        ...(fieldType === 'reference' ? { referenceMultiple: true, cardinality: { min: 1, max: '*' } } : {}),
      })],
    })
  const codings = (model: ReturnType<typeof order>, answers: Record<string, unknown>, extra: object = {}) =>
    (ServiceRequestExtractor.extract(toQuestionnaireResponse(model, answers as never), toQuestionnaire(model), { ...ctx, ...extra })[0] as any).code?.coding

  it('writes a catalog test under its own system, not as LOINC, with its name', () => {
    expect(codings(order('reference'), { tests: [{ system: CATALOG, code: 'HIVVL', display: 'Viral load' }] }))
      .toEqual([{ system: CATALOG, code: 'HIVVL', display: 'Viral load' }])
  })

  const twoTests = { tests: [{ system: CATALOG, code: 'HIVVL', display: 'Viral load' }, { system: CATALOG, code: 'CD4', display: 'CD4 count' }] }
  const requests = (model: ReturnType<typeof order>, answers: Record<string, unknown>, extra: object = {}) =>
    ServiceRequestExtractor.extract(toQuestionnaireResponse(model, answers as never), toQuestionnaire(model), { ...ctx, ...extra }) as any[]

  it('names each order after its own test, so the warehouse keeps a test name', () => {
    // The warehouse keeps the first coding, which is the LOINC link and carries no name, so
    // panel_desc came out empty for every order taken in the studio. code.text is read first.
    const codingsBefore = new Map([[`${CATALOG}|HIVVL`, [{ system: 'http://loinc.org', code: '25836-8' }]]])
    expect(requests(order('reference'), twoTests, { codingsBefore }).map((r) => r.code.text)).toEqual(['Viral load', 'CD4 count'])
  })

  it('writes the codings the context names in front of its own test only, in order', () => {
    const codingsBefore = new Map([[`${CATALOG}|HIVVL`, [{ system: 'http://loinc.org', code: '25836-8' }, { system: TEST_CODE, code: 'VL' }]]])
    expect(requests(order('reference'), twoTests, { codingsBefore }).map((r) => r.code.coding)).toEqual([
      [{ system: 'http://loinc.org', code: '25836-8' }, { system: TEST_CODE, code: 'VL' }, { system: CATALOG, code: 'HIVVL', display: 'Viral load' }],
      [{ system: CATALOG, code: 'CD4', display: 'CD4 count' }],
    ])
  })

  // Test identity spec, call 7: what leaves CE carries the Test code. The catalog's answer is the id.
  const savedTest = { tests: [{ system: CATALOG, code: 'tst-0a1b2c3d4e5f6a7b', display: 'Viral load' }] }

  it('leads with LOINC, then the Test code, then the id, for a test with a LOINC link', () => {
    const codingsBefore = new Map([[`${CATALOG}|tst-0a1b2c3d4e5f6a7b`, [{ system: 'http://loinc.org', code: '25836-8' }, { system: TEST_CODE, code: 'VL' }]]])
    const [r] = requests(order('reference'), savedTest, { codingsBefore })
    expect(r.code.coding).toEqual([
      { system: 'http://loinc.org', code: '25836-8' },
      { system: TEST_CODE, code: 'VL' },
      { system: CATALOG, code: 'tst-0a1b2c3d4e5f6a7b', display: 'Viral load' },
    ])
    expect(projectServiceRequest({ ...r, id: 'sr-1' }, {})).toMatchObject({ panel_system: 'http://loinc.org', panel_code: '25836-8' })
  })

  it('leads with the Test code for a test with no LOINC link, so panel_code is never an id', () => {
    const codingsBefore = new Map([[`${CATALOG}|tst-0a1b2c3d4e5f6a7b`, [{ system: TEST_CODE, code: 'VL' }]]])
    const [r] = requests(order('reference'), savedTest, { codingsBefore })
    expect(r.code.coding).toEqual([{ system: TEST_CODE, code: 'VL' }, { system: CATALOG, code: 'tst-0a1b2c3d4e5f6a7b', display: 'Viral load' }])
    expect(projectServiceRequest({ ...r, id: 'sr-1' }, {})).toMatchObject({ panel_system: TEST_CODE, panel_code: 'VL', panel_desc: 'Viral load' })
  })

  it('keeps hashing the id into the order id, so a saved order keeps its ServiceRequest id', () => {
    const codingsBefore = new Map([[`${CATALOG}|HIVVL`, [{ system: TEST_CODE, code: 'NEWCODE' }]]])
    const orderIdFor = (t: { system: string; code: string }) => labOrderId('FAC-1', 'CS-1', t)
    const [r] = requests(order('reference'), { tests: [twoTests.tests[0]] }, { codingsBefore, orderIdFor })
    // The id from before the Test code existed: the catalog system and the id, nothing else.
    expect(r.id).toBe(labOrderId('FAC-1', 'CS-1', { system: CATALOG, code: 'HIVVL' }))
  })

  it('writes one ServiceRequest per test, each carrying the same requisition number', () => {
    const model = makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code', referenceMultiple: true, cardinality: { min: 1, max: '*' } }),
        makeField({ id: 'num', displayLabel: 'Requisition', fieldType: 'text', order: 1, fhirPath: 'ServiceRequest.identifier.value', fhirDiscriminator: { system: 'urn:openldr:order:requisition' }, fhirValueField: 'value' }),
        makeField({ id: 'prio', displayLabel: 'Priority', fieldType: 'text', order: 2, fhirPath: 'ServiceRequest.priority' }),
      ],
    })
    const out = requests(model, { ...twoTests, num: 'CS-1', prio: 'urgent' })
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.code.coding.map((c: any) => c.code))).toEqual([['HIVVL'], ['CD4']])
    for (const r of out) {
      expect(r.requisition).toEqual({ system: 'urn:openldr:order:requisition', value: 'CS-1' })
      expect(r.identifier).toEqual([{ system: 'urn:openldr:order:requisition', value: 'CS-1' }])
      expect(r).toMatchObject({ status: 'active', intent: 'order', priority: 'urgent', subject: ctx.subject })
    }
  })

  it('writes one request for a test picked twice, so no two requests share an id', () => {
    const answers = { tests: [...twoTests.tests, { system: CATALOG, code: 'HIVVL', display: 'Viral load' }] }
    const out = requests(order('reference'), answers)
    expect(out.map((r) => r.code.coding.at(-1).code)).toEqual(['HIVVL', 'CD4'])
    const ids = out.map((r) => labOrderId('A1', 'CS-1', r.code.coding.at(-1)))
    expect(new Set(ids).size).toBe(2)
  })

  it('writes one ServiceRequest with no code when no test is chosen', () => {
    const out = requests(order('reference'), {})
    expect(out).toHaveLength(1)
    expect(out[0].code).toBeUndefined()
  })

  it('keeps a LOINC answer as LOINC, and an answer that names no system as LOINC', () => {
    expect(codings(order('reference'), { tests: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] }))
      .toEqual([{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }])
    expect(codings(order('text'), { tests: '718-7' })).toEqual([{ system: 'http://loinc.org', code: '718-7' }])
  })
})

describe('TestResultsExtractor (bench result entry)', () => {
  const CATALOG = 'urn:openldr:codesystem:test-catalog'
  const PARAM = 'urn:openldr:default_result'
  const order = () =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code', referenceMultiple: true, cardinality: { min: 1, max: '*' } }),
        makeField({ id: 'details', displayLabel: 'Results', fieldType: 'testDetails', order: 1, referenceDependsOn: 'tests' }),
      ],
    })
  const extract = (details: unknown, extra: object = {}) => {
    const model = order()
    const answers = { tests: [{ system: CATALOG, code: 'FBC' }], details } as never
    return TestResultsExtractor.extract(toQuestionnaireResponse(model, answers), toQuestionnaire(model), { ...ctx, ...extra })
  }

  it('writes one final Observation per typed result, with the band as its reference range', () => {
    expect(extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
          band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
      ] },
    }, { testBands: new Map([[`${CATALOG}|FBC#${PARAM}|HGB`, { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }]]) })).toEqual([
      {
        resourceType: 'Observation',
        status: 'final',
        code: { coding: [{ system: PARAM, code: 'HGB' }] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2026-06-04T00:00:00Z',
        valueQuantity: { value: 11.2, unit: 'g/dL' },
        referenceRange: [{ low: { value: 12, unit: 'g/dL' }, high: { value: 15, unit: 'g/dL' }, age: { low: { value: 18, unit: 'a', system: 'http://unitsofmeasure.org', code: 'a' } } }],
      },
    ])
  })

  it('writes the range name as the reference range text', () => {
    const named = { name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null }
    const out = extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL', band: named },
      ] },
    }, { testBands: new Map([[`${CATALOG}|FBC#${PARAM}|HGB`, named]]) }) as any[]
    expect(out[0].referenceRange).toEqual([{
      low: { value: 12, unit: 'g/dL' }, high: { value: 16, unit: 'g/dL' },
      // A range saved with no age unit is in years, which UCUM writes "a".
      age: { low: { value: 15, unit: 'a', system: 'http://unitsofmeasure.org', code: 'a' } },
      text: 'Highland women',
    }])
  })

  it('writes the age window in the range own UCUM unit, and no age when the range has none', () => {
    const UCUM = 'http://unitsofmeasure.org'
    const run = (band: object) => (extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 15, unit: 'g/dL', band },
      ] },
    }, { testBands: new Map([[`${CATALOG}|FBC#${PARAM}|HGB`, band as never]]) }) as any[])[0].referenceRange[0]
    const base = { name: null, low: 14, high: 22, unit: 'g/dL', sex: null }
    expect(run({ ...base, ageLow: 0, ageHigh: 28, ageUnit: 'd' }).age).toEqual({
      low: { value: 0, unit: 'd', system: UCUM, code: 'd' }, high: { value: 28, unit: 'd', system: UCUM, code: 'd' },
    })
    expect(run({ ...base, ageLow: null, ageHigh: 12, ageUnit: 'mo' }).age).toEqual({ high: { value: 12, unit: 'mo', system: UCUM, code: 'mo' } })
    expect(run({ ...base, ageLow: 1, ageHigh: 5, ageUnit: 'y' }).age).toEqual({
      low: { value: 1, unit: 'a', system: UCUM, code: 'a' }, high: { value: 5, unit: 'a', system: UCUM, code: 'a' },
    })
    expect('age' in run({ ...base, ageLow: null, ageHigh: null, ageUnit: 'd' })).toBe(false)
  })

  it('writes a coded result and a text result under the right value', () => {
    const out = extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'MRDT' }, resultType: 'coded', value: { system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' } },
        { param: { system: PARAM, code: 'NOTE' }, resultType: 'text', value: 'sample clotted' },
      ] },
    }) as any[]
    expect(out[0].valueCodeableConcept).toEqual({ coding: [{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }] })
    expect(out[1].valueString).toBe('sample clotted')
  })

  it('writes a cancelled Observation carrying the reason for a rejected test, and no values', () => {
    expect(extract({
      [`${CATALOG}|FBC`]: {
        specimen: null,
        rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' },
        results: [{ param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2 }],
      },
    })).toEqual([
      {
        resourceType: 'Observation',
        status: 'cancelled',
        code: { coding: [{ system: CATALOG, code: 'FBC' }] },
        subject: { reference: 'Patient/p1' },
        effectiveDateTime: '2026-06-04T00:00:00Z',
        dataAbsentReason: { coding: [{ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }] },
      },
    ])
  })

  it('codes a rejected test like its order: LOINC, then the Test code, then the id', () => {
    const TEST_CODE = 'urn:openldr:codesystem:test-catalog:test-code'
    const rejected = { [`${CATALOG}|FBC`]: { specimen: null, rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM' }, results: [] } }
    const withLoinc = new Map([[`${CATALOG}|FBC`, [{ system: 'http://loinc.org', code: '58410-2' }, { system: TEST_CODE, code: 'CBC' }]]])
    const [a] = extract(rejected, { codingsBefore: withLoinc }) as any[]
    expect(a.code.coding).toEqual([{ system: 'http://loinc.org', code: '58410-2' }, { system: TEST_CODE, code: 'CBC' }, { system: CATALOG, code: 'FBC' }])
    const noLoinc = new Map([[`${CATALOG}|FBC`, [{ system: TEST_CODE, code: 'CBC' }]]])
    const [b] = extract(rejected, { codingsBefore: noLoinc }) as any[]
    expect(b.code.coding).toEqual([{ system: TEST_CODE, code: 'CBC' }, { system: CATALOG, code: 'FBC' }])
    // lab_results.observation_code keeps the first coding, so it is the Test code, never the id.
    expect(projectObservation({ ...b, id: 'o1' }, {})).toMatchObject({ observation_system: TEST_CODE, observation_code: 'CBC' })
  })

  it('keeps hashing the id into a rejected test order link, whatever the Test code', () => {
    const rejected = { [`${CATALOG}|FBC`]: { specimen: null, rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM' }, results: [] } }
    const codingsBefore = new Map([[`${CATALOG}|FBC`, [{ system: 'urn:openldr:codesystem:test-catalog:test-code', code: 'CBC' }]]])
    const orderIdFor = (t: { system: string; code: string }) => labOrderId(null, 'CS-1', t)
    const [o] = extract(rejected, { codingsBefore, orderIdFor }) as any[]
    expect(o.basedOn).toEqual([{ reference: `ServiceRequest/${labOrderId(null, 'CS-1', { system: CATALOG, code: 'FBC' })}` }])
  })

  it('writes nothing for a test with no typed value', () => {
    expect(extract({ [`${CATALOG}|FBC`]: { specimen: { system: 'urn:openldr:cs:local', code: 'BLD' }, rejection: null, results: [] } })).toEqual([])
  })

  it('writes nothing when the form has no testDetails field', () => {
    const model = makeSchema({ id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest', fields: [makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code' })] })
    expect(TestResultsExtractor.extract(toQuestionnaireResponse(model, { tests: [] } as never), toQuestionnaire(model), ctx)).toEqual([])
  })

  // Plan B, Task 3 (call 6): each new type goes from the bench answer, through the stored response,
  // to an Observation the FHIR schema accepts and to a warehouse row.
  describe('yes/no, date and several-answer fields', () => {
    const POS = { system: 'urn:openldr:cs:local', code: 'POS', display: 'Positive' }
    const ESBL = { system: 'urn:openldr:cs:local', code: 'ESBL' }
    const CARB = { system: 'urn:openldr:cs:local', code: 'CARB', display: 'Carbapenemase' }
    const run = (results: unknown[]) => (extract({ [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results } }) as any[])
    const rows = (obs: any[]) => obs.map((o, i) => projectObservation({ ...o, id: `o${i}` }, {}))

    it('writes yes/no as valueBoolean and lands it as ST with true or false', () => {
      const obs = run([
        { param: { system: PARAM, code: 'GROWTH' }, resultType: 'boolean', value: true },
        { param: { system: PARAM, code: 'HAEMOLYSIS' }, resultType: 'boolean', value: false },
      ])
      expect(obs.map((o) => o.valueBoolean)).toEqual([true, false])
      expect(obs.every((o) => FhirObservation.safeParse(o).success)).toBe(true)
      expect(rows(obs).map((r) => [r.observation_code, r.result_type, r.text_value])).toEqual([['GROWTH', 'ST', 'true'], ['HAEMOLYSIS', 'ST', 'false']])
    })

    it('writes a date as valueDateTime and lands it as DT with the ISO date', () => {
      const obs = run([{ param: { system: PARAM, code: 'COLLECTED' }, resultType: 'date', value: '2026-11-20' }])
      expect(obs[0].valueDateTime).toBe('2026-11-20')
      expect(FhirObservation.safeParse(obs[0]).success).toBe(true)
      expect(rows(obs)[0]).toMatchObject({ result_type: 'DT', text_value: '2026-11-20', numeric_value: null, coded_value: null })
    })

    // Review focus 4.
    it('writes three chosen answers as three Observations and three CE rows, each with the field code', () => {
      const obs = run([{ param: { system: PARAM, code: 'MARKERS' }, resultType: 'multicoded', value: [POS, ESBL, CARB] }])
      expect(obs).toHaveLength(3)
      expect(obs.map((o) => o.code)).toEqual([0, 1, 2].map(() => ({ coding: [{ system: PARAM, code: 'MARKERS' }] })))
      expect(obs.map((o) => o.valueCodeableConcept.coding[0].code)).toEqual(['POS', 'ESBL', 'CARB'])
      expect(obs.every((o) => FhirObservation.safeParse(o).success)).toBe(true)
      expect(rows(obs).map((r) => [r.observation_code, r.result_type, r.coded_value])).toEqual([
        ['MARKERS', 'CE', 'POS'], ['MARKERS', 'CE', 'ESBL'], ['MARKERS', 'CE', 'CARB'],
      ])
    })

    it('writes one chosen answer of a several-answer field as one coded Observation', () => {
      const obs = run([{ param: { system: PARAM, code: 'MARKERS' }, resultType: 'multicoded', value: [POS] }])
      expect(obs.map((o) => o.valueCodeableConcept)).toEqual([{ coding: [POS] }])
    })
  })

  // The round trip, settled 2026-09-16: values survive a stored response, bands do not.
  it('writes the value with no range when the context carries no band, as a replayed response does', () => {
    const out = extract({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
        { param: { system: PARAM, code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL' },
      ] },
    }) as any[]
    expect(out[0].valueQuantity).toEqual({ value: 11.2, unit: 'g/dL' })
    expect(out[0].referenceRange).toBeUndefined()
  })
})

describe('order-level rejection (2026-10-11 spec, part 2)', () => {
  const CATALOG = 'urn:openldr:codesystem:test-catalog'
  const REASON = { system: 'urn:openldr:cs:reject-order', code: 'UNLABELLED', display: 'Unlabelled specimen' }
  const order = () =>
    makeSchema({
      id: 'o', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code', referenceMultiple: true, cardinality: { min: 1, max: '*' } }),
        makeField({ id: 'details', displayLabel: 'Results', fieldType: 'testDetails', order: 1, referenceDependsOn: 'tests' }),
        makeField({ id: 'rej', displayLabel: 'Order rejection', fieldType: 'reference', order: 2, fhirPath: 'ServiceRequest.extension', fhirDiscriminator: { url: 'urn:openldr:ext:rejection' }, valueSetUrl: 'urn:openldr:valueset:order-reject-reason' }),
      ],
    })
  const run = (answers: Record<string, unknown>) => {
    const model = order()
    const qr = toQuestionnaireResponse(model, answers as never)
    const q = toQuestionnaire(model)
    return { sr: ServiceRequestExtractor.extract(qr, q, ctx), results: TestResultsExtractor.extract(qr, q, ctx) }
  }
  const typed = (specimen: unknown) => ({
    [`${CATALOG}|FBC`]: { specimen, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL' },
    ] },
  })

  it('with orderIdFor, gives each test its id and points each result at its own test only', () => {
    const model = order()
    const answers = {
      tests: [{ system: CATALOG, code: 'FBC' }, { system: CATALOG, code: 'GLU' }],
      details: {
        ...typed(null),
        [`${CATALOG}|GLU`]: { specimen: null, rejection: null, results: [
          { param: { system: 'urn:openldr:default_result', code: 'GLU' }, resultType: 'numeric', value: 5.1, unit: 'mmol/L' },
        ] },
        // A detail for a test the order does not name has no order of its own.
        [`${CATALOG}|CD4`]: { specimen: null, rejection: { system: REASON.system, code: 'LEAKED' }, results: [] },
      },
    }
    const withIds = { ...ctx, orderIdFor: (t: { system: string; code: string }) => `sr-${t.code}` }
    const qr = toQuestionnaireResponse(model, answers as never)
    const q = toQuestionnaire(model)
    expect((ServiceRequestExtractor.extract(qr, q, withIds) as any[]).map((r) => r.id)).toEqual(['sr-FBC', 'sr-GLU'])
    const results = TestResultsExtractor.extract(qr, q, withIds) as any[]
    expect(results.map((o) => [o.code.coding[0].code, o.basedOn])).toEqual([
      ['HGB', [{ reference: 'ServiceRequest/sr-FBC' }]],
      ['GLU', [{ reference: 'ServiceRequest/sr-GLU' }]],
      ['CD4', undefined],
    ])
    // Without it, nothing names an order, and linkToOrder links them.
    expect((TestResultsExtractor.extract(qr, q, ctx) as any[]).every((o) => o.basedOn === undefined)).toBe(true)
    expect((ServiceRequestExtractor.extract(qr, q, ctx) as any[]).every((r) => r.id === undefined)).toBe(true)
  })

  it('finds the field by its path, not its id', () => {
    expect(orderRejectionFieldId(order())).toBe('rej')
    expect(orderRejectionFieldId(makeSchema({ id: 'x', name: 'X', fields: [] }))).toBeNull()
  })

  it('does not take a field on another ServiceRequest.extension for the rejection field', () => {
    const model = makeSchema({
      id: 'o3', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'tests', displayLabel: 'Tests', fieldType: 'reference', order: 0, fhirPath: 'ServiceRequest.code', referenceMultiple: true, cardinality: { min: 1, max: '*' } }),
        makeField({ id: 'other', displayLabel: 'Other', fieldType: 'reference', order: 1, fhirPath: 'ServiceRequest.extension', fhirDiscriminator: { url: 'urn:example:ext:other' }, valueSetUrl: 'urn:openldr:valueset:order-reject-reason' }),
        makeField({ id: 'bare', displayLabel: 'Bare', fieldType: 'reference', order: 2, fhirPath: 'ServiceRequest.extension' }),
      ],
    })
    expect(orderRejectionFieldId(model)).toBeNull()
    expect(isOrderRejectionField({ fhirPath: 'ServiceRequest.extension', fhirDiscriminator: { url: 'urn:example:ext:other' } })).toBe(false)
    expect(isOrderRejectionField({ fhirPath: 'ServiceRequest.extension' })).toBe(false)
    const qr = toQuestionnaireResponse(model, { tests: [{ system: CATALOG, code: 'FBC' }], other: REASON } as never)
    const [request, ...rest] = ServiceRequestExtractor.extract(qr, toQuestionnaire(model), ctx) as any[]
    expect(rest).toEqual([])
    expect(request.status).toBe('active')
    expect(request.extension).toBeUndefined()
  })

  it('revokes the order, carries the reason in the warehouse extension, and writes an unsatisfactory Specimen', () => {
    const { sr } = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(null), rej: REASON })
    expect(sr).toHaveLength(2)
    const [request, specimen] = sr as any[]
    expect(request.status).toBe('revoked')
    expect(request.extension).toEqual([{ url: 'urn:openldr:ext:rejection', extension: [
      { url: 'code', valueCode: 'UNLABELLED' },
      { url: 'reason', valueString: 'Unlabelled specimen' },
    ] }])
    expect(specimen).toEqual({
      resourceType: 'Specimen',
      status: 'unsatisfactory',
      subject: { reference: 'Patient/p1' },
      condition: [{ coding: [REASON] }],
    })
  })

  it('revokes every order of a rejected 2-test order, and writes one Specimen that serves both', () => {
    const { sr } = run({ tests: [{ system: CATALOG, code: 'FBC' }, { system: CATALOG, code: 'GLU' }], rej: REASON })
    const requests = (sr as any[]).filter((r) => r.resourceType === 'ServiceRequest')
    const specimens = (sr as any[]).filter((r) => r.resourceType === 'Specimen')
    expect(requests).toHaveLength(2)
    expect(specimens).toHaveLength(1)
    for (const r of requests) {
      expect(r.status).toBe('revoked')
      expect(r.extension).toEqual([{ url: 'urn:openldr:ext:rejection', extension: [
        { url: 'code', valueCode: 'UNLABELLED' }, { url: 'reason', valueString: 'Unlabelled specimen' },
      ] }])
    }
    // The extractor sets no ids, so the Specimen's `request` is filled once the ids are known.
    const linked = linkToOrder(sr, (() => { let n = 0; return () => `id-${++n}` })()) as any[]
    const ids = linked.filter((r) => r.resourceType === 'ServiceRequest').map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
    expect(linked.find((r) => r.resourceType === 'Specimen').request).toEqual(ids.map((id) => ({ reference: `ServiceRequest/${id}` })))
  })

  it('gives the Specimen a type only when every test chose the same one', () => {
    const blood = { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }
    const same = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(blood), rej: REASON }).sr as any[]
    expect(same[1].type).toEqual({ coding: [blood] })
    const mixed = run({
      tests: [{ system: CATALOG, code: 'FBC' }, { system: CATALOG, code: 'GLU' }],
      details: { ...typed(blood), [`${CATALOG}|GLU`]: { specimen: { system: 'urn:openldr:cs:local', code: 'UR' }, rejection: null, results: [] } },
      rej: REASON,
    }).sr as any[]
    expect(mixed.find((r) => r.resourceType === 'Specimen').type).toBeUndefined()
  })

  it('falls back to the code when the reason has no display', () => {
    const { sr } = run({ tests: [{ system: CATALOG, code: 'FBC' }], rej: { system: REASON.system, code: 'DUPLICATE' } })
    expect((sr[0] as any).extension[0].extension[1]).toEqual({ url: 'reason', valueString: 'DUPLICATE' })
  })

  it('writes no Observation at all on a rejected order', () => {
    const { results } = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(null), rej: REASON })
    expect(results).toEqual([])
  })

  it('leaves an order with no rejection active, with no Specimen', () => {
    const { sr, results } = run({ tests: [{ system: CATALOG, code: 'FBC' }], details: typed(null) })
    expect(sr).toHaveLength(1)
    expect((sr[0] as any).status).toBe('active')
    expect((sr[0] as any).extension).toBeUndefined()
    expect(results).toHaveLength(1)
  })

  it('falls back to the code when the display is empty', () => {
    const { sr } = run({ tests: [{ system: CATALOG, code: 'FBC' }], rej: { ...REASON, display: '' } })
    expect((sr[0] as any).extension[0].extension[1]).toEqual({ url: 'reason', valueString: 'UNLABELLED' })
  })

  it('writes no generic Observation on a rejected order either', () => {
    const model = makeSchema({
      id: 'o2', name: 'Order', fhirResourceType: 'ServiceRequest',
      fields: [
        makeField({ id: 'hgb', displayLabel: 'Hemoglobin', fieldType: 'number', order: 0, observationExtract: true, code: [{ system: 'http://loinc.org', code: '718-7' }] }),
        makeField({ id: 'rej', displayLabel: 'Order rejection', fieldType: 'reference', order: 1, fhirPath: 'ServiceRequest.extension', fhirDiscriminator: { url: 'urn:openldr:ext:rejection' }, valueSetUrl: 'urn:openldr:valueset:order-reject-reason' }),
      ],
    })
    const q = toQuestionnaire(model)
    const rejected = ObservationExtractor.extract(toQuestionnaireResponse(model, { hgb: 12.5, rej: REASON } as never), q, ctx)
    expect(rejected).toEqual([])
    const open = ObservationExtractor.extract(toQuestionnaireResponse(model, { hgb: 12.5 } as never), q, ctx)
    expect(open).toHaveLength(1)
  })
})
