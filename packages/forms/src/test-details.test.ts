import { describe, expect, it } from 'vitest'
import { parseTestDetails, testDetailItems, type ResultBandRef, type TypedResult } from './test-details'

const CATALOG = 'urn:openldr:codesystem:test-catalog'
const answer = {
  [`${CATALOG}|FBC`]: {
    specimen: { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' },
    rejection: null,
    results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
        band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null } },
    ],
  },
}

describe('test details answer', () => {
  it('reads a typed value with its unit and the band the server chose', () => {
    expect(parseTestDetails(answer)[`${CATALOG}|FBC`].results[0]).toEqual({
      param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
      band: { low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null },
    })
  })

  it('keeps the name of the range the bench picked', () => {
    const named = { [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 11.2, unit: 'g/dL',
        band: { name: 'Highland women', low: 12, high: 16, unit: 'g/dL', sex: 'female', ageLow: 15, ageHigh: null } },
    ] } }
    expect(parseTestDetails(named)[`${CATALOG}|FBC`].results[0].band?.name).toBe('Highland women')
  })

  it('keeps the age unit of the range the bench picked', () => {
    const days = { [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 18, unit: 'g/dL',
        band: { name: null, low: 14, high: 22, unit: 'g/dL', sex: null, ageLow: 0, ageHigh: 28, ageUnit: 'd' } },
    ] } }
    expect(parseTestDetails(days)[`${CATALOG}|FBC`].results[0].band?.ageUnit).toBe('d')
  })

  it('keeps the plan B range fields of the range the bench picked', () => {
    // Typed, so the type declares each field (plan B, Task 1). Task 3 makes the bench send them.
    const band: ResultBandRef = {
      name: null, low: 11, high: 14, unit: 'g/dL', sex: 'female', ageLow: null, ageHigh: null,
      pregnancy: 'pregnant', country: 'TZA', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'WHO', scope: 'national',
    }
    const types: Array<TypedResult['resultType']> = ['numeric', 'coded', 'text', 'boolean', 'date', 'multicoded']
    expect(types).toHaveLength(6)
    const sent = { [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'HGB' }, resultType: 'numeric', value: 12, unit: 'g/dL', band },
    ] } }
    expect(parseTestDetails(sent)[`${CATALOG}|FBC`].results[0].band).toEqual(band)
  })

  // Plan B, Task 3: yes/no, date and several-answer fields.
  const POS = { system: 'urn:openldr:cs:local', code: 'POS', display: 'Positive' }
  const ESBL = { system: 'urn:openldr:cs:local', code: 'ESBL' }
  const CARB = { system: 'urn:openldr:cs:local', code: 'CARB', display: 'Carbapenemase' }
  const newTypes = {
    [`${CATALOG}|CUL`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'GROWTH' }, resultType: 'boolean', value: false },
      { param: { system: 'urn:openldr:default_result', code: 'COLLECTED' }, resultType: 'date', value: '2026-11-20' },
      { param: { system: 'urn:openldr:default_result', code: 'MARKERS' }, resultType: 'multicoded', value: [POS, ESBL, CARB] },
    ] },
  }

  it('keeps a yes/no, a date and a several-answer value as they were sent', () => {
    expect(parseTestDetails(newTypes)[`${CATALOG}|CUL`].results.map((r) => [r.resultType, r.value])).toEqual([
      ['boolean', false],
      ['date', '2026-11-20'],
      ['multicoded', [POS, ESBL, CARB]],
    ])
  })

  it('reads a value of the wrong kind for its type as no value', () => {
    const empty = { [`${CATALOG}|CUL`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'MARKERS' }, resultType: 'multicoded', value: [] },
      { param: { system: 'urn:openldr:default_result', code: 'GROWTH' }, resultType: 'boolean', value: 'yes' },
      { param: { system: 'urn:openldr:default_result', code: 'COLLECTED' }, resultType: 'date', value: '20/11/2026' },
    ] } }
    expect(parseTestDetails(empty)[`${CATALOG}|CUL`].results.map((r) => r.value)).toEqual([null, null, null])
  })

  it('reads an older answer as before: a type it does not know is text', () => {
    const old = { [`${CATALOG}|FBC`]: { specimen: null, rejection: null, results: [
      { param: { system: 'urn:openldr:default_result', code: 'NOTE' }, resultType: 'memo', value: 'clotted' },
    ] } }
    expect(parseTestDetails(old)[`${CATALOG}|FBC`].results[0]).toEqual({
      param: { system: 'urn:openldr:default_result', code: 'NOTE' }, resultType: 'text', value: 'clotted',
    })
  })

  it('writes yes/no as valueBoolean, a date as valueDate, and one answer per chosen code', () => {
    expect(testDetailItems(parseTestDetails(newTypes))[0].item).toEqual([
      { linkId: `${CATALOG}|CUL#urn:openldr:default_result|GROWTH`, answer: [{ valueBoolean: false }] },
      { linkId: `${CATALOG}|CUL#urn:openldr:default_result|COLLECTED`, answer: [{ valueDate: '2026-11-20' }] },
      { linkId: `${CATALOG}|CUL#urn:openldr:default_result|MARKERS`, answer: [{ valueCoding: POS }, { valueCoding: ESBL }, { valueCoding: CARB }] },
    ])
  })

  it('reads a rejection and drops nothing else', () => {
    const rejected = { [`${CATALOG}|FBC`]: { ...answer[`${CATALOG}|FBC`], rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' } } }
    const parsed = parseTestDetails(rejected)[`${CATALOG}|FBC`]
    expect(parsed.rejection).toEqual({ system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' })
    expect(parsed.results).toHaveLength(1)
  })

  it('reads an empty answer from anything unusable', () => {
    expect(parseTestDetails(undefined)).toEqual({})
    expect(parseTestDetails('FBC')).toEqual({})
  })

  it('writes one nested item per test and one per result', () => {
    expect(testDetailItems(parseTestDetails(answer))).toEqual([
      {
        linkId: `${CATALOG}|FBC`,
        item: [
          { linkId: `${CATALOG}|FBC#specimen`, answer: [{ valueCoding: { system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' } }] },
          { linkId: `${CATALOG}|FBC#urn:openldr:default_result|HGB`, answer: [{ valueQuantity: { value: 11.2, unit: 'g/dL' } }] },
        ],
      },
    ])
  })

  it('writes a coded result as a coding and a text result as a string', () => {
    const mixed = parseTestDetails({
      [`${CATALOG}|MAL`]: { specimen: null, rejection: null, results: [
        { param: { system: 'urn:openldr:default_result', code: 'MRDT' }, resultType: 'coded', value: { system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' } },
        { param: { system: 'urn:openldr:default_result', code: 'NOTE' }, resultType: 'text', value: 'sample clotted' },
      ] },
    })
    expect(testDetailItems(mixed)[0].item).toEqual([
      { linkId: `${CATALOG}|MAL#urn:openldr:default_result|MRDT`, answer: [{ valueCoding: { system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' } }] },
      { linkId: `${CATALOG}|MAL#urn:openldr:default_result|NOTE`, answer: [{ valueString: 'sample clotted' }] },
    ])
  })

  it('writes a rejected test as a coding item and no results', () => {
    const rejected = parseTestDetails({
      [`${CATALOG}|FBC`]: { specimen: null, rejection: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' }, results: [] },
    })
    expect(testDetailItems(rejected)[0].item).toEqual([
      { linkId: `${CATALOG}|FBC#rejection`, answer: [{ valueCoding: { system: 'urn:openldr:cs:reject-test', code: 'HAEM', display: 'Haemolysed' } }] },
    ])
  })
})
