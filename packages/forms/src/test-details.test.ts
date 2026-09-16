import { describe, expect, it } from 'vitest'
import { parseTestDetails, testDetailItems } from './test-details'

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
