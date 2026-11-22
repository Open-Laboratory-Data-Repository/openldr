import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ORDER_ORIGIN_SYSTEM, labOrderId, labSpecimenId, orderKey } from './order-ids'

const CATALOG = 'urn:openldr:codesystem:test-catalog'
const fbc = { system: CATALOG, code: 'FBC' }

describe('order ids', () => {
  it('names the order origin system', () => {
    expect(ORDER_ORIGIN_SYSTEM).toBe('urn:openldr:cs:order-origin')
  })

  it('keys an order on the facility and the requisition number, empty for no facility', () => {
    expect(orderKey('A1', 'CS-1')).toBe('A1|CS-1')
    expect(orderKey(null, 'CS-1')).toBe('|CS-1')
  })

  it('builds the order id from the first 40 hex of the sha256 of the key and the test', () => {
    const hex = createHash('sha256').update(`A1|CS-1|${CATALOG}|FBC`).digest('hex')
    expect(labOrderId('A1', 'CS-1', fbc)).toBe(`sr-${hex.slice(0, 40)}`)
    expect(labOrderId('A1', 'CS-1', fbc)).toHaveLength(43)
  })

  it('gives the same id for the same order and test, every time', () => {
    expect(labOrderId('A1', 'CS-1', fbc)).toBe(labOrderId('A1', 'CS-1', { ...fbc }))
  })

  it('gives a different id when only the facility differs', () => {
    expect(labOrderId('A1', 'CS-1', fbc)).not.toBe(labOrderId('B1', 'CS-1', fbc))
    expect(labOrderId('A1', 'CS-1', fbc)).not.toBe(labOrderId(null, 'CS-1', fbc))
  })

  it('gives a different id for each test, number and system', () => {
    const ids = new Set([
      labOrderId('A1', 'CS-1', fbc),
      labOrderId('A1', 'CS-1', { system: CATALOG, code: 'GLU' }),
      labOrderId('A1', 'CS-2', fbc),
      labOrderId('A1', 'CS-1', { system: 'http://loinc.org', code: 'FBC' }),
    ])
    expect(ids.size).toBe(4)
  })

  it('builds the specimen id the same way under its own prefix', () => {
    const blood = { system: 'urn:openldr:cs:local', code: 'BLD' }
    const hex = createHash('sha256').update('A1|CS-1|urn:openldr:cs:local|BLD').digest('hex')
    expect(labSpecimenId('A1', 'CS-1', blood)).toBe(`sp-${hex.slice(0, 40)}`)
  })
})
