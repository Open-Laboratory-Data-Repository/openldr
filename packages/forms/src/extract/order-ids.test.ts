import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  LAB_TASK_SYSTEM, ORDER_ORIGIN_SYSTEM, labOrderId, labRejectionObservationId, labSpecimenId, labTaskId, orderKey,
} from './order-ids'

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

describe('task and rejection ids', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 40)

  it('names the lab task code system', () => {
    expect(LAB_TASK_SYSTEM).toBe('urn:openldr:cs:lab-task')
  })

  it('builds the task id from the first 40 hex of the sha256 of the kind and the key', () => {
    expect(labTaskId('correct-request', 'A1|CS-1')).toBe(`tk-${sha('correct-request|A1|CS-1')}`)
    expect(labTaskId('recollect-sample', 'sp-1')).toBe(`tk-${sha('recollect-sample|sp-1')}`)
    expect(labTaskId('correct-request', 'A1|CS-1')).toHaveLength(43)
  })

  it('gives the same task id every time, and a different one by kind and by key', () => {
    expect(labTaskId('correct-request', 'A1|CS-1')).toBe(labTaskId('correct-request', 'A1|CS-1'))
    const ids = new Set([
      labTaskId('correct-request', 'A1|CS-1'),
      labTaskId('recollect-sample', 'A1|CS-1'),
      labTaskId('correct-request', 'A1|CS-2'),
    ])
    expect(ids.size).toBe(3)
  })

  it('builds the rejection observation id from the request id', () => {
    expect(labRejectionObservationId('sr-1')).toBe(`ob-rej-${sha('sr-1')}`)
    expect(labRejectionObservationId('sr-1')).toBe(labRejectionObservationId('sr-1'))
    expect(labRejectionObservationId('sr-1')).not.toBe(labRejectionObservationId('sr-2'))
    expect(labRejectionObservationId('sr-1')).toHaveLength(47)
  })
})
