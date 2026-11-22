import { describe, expect, it } from 'vitest'
import type { FhirResource } from 'fhir/r4'
import { linkToOrder } from './link-to-order'

const counter = () => { let n = 0; return () => `id-${++n}` }
const obs = (code: string, extra: object = {}): FhirResource =>
  ({ resourceType: 'Observation', status: 'final', code: { coding: [{ code }] }, ...extra }) as FhirResource
const order = (extra: object = {}): FhirResource =>
  ({ resourceType: 'ServiceRequest', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' }, ...extra }) as FhirResource

describe('linkToOrder', () => {
  it('gives the order an id and points every Observation at it', () => {
    const out = linkToOrder([order(), obs('HGB'), obs('FBC', { status: 'cancelled' })], counter()) as any[]
    expect(out[0].id).toBe('id-1')
    expect(out[1].basedOn).toEqual([{ reference: 'ServiceRequest/id-1' }])
    expect(out[2].basedOn).toEqual([{ reference: 'ServiceRequest/id-1' }])
  })

  it('keeps an id the order already has', () => {
    const out = linkToOrder([order({ id: 'sr-9' }), obs('HGB')], counter()) as any[]
    expect(out[0].id).toBe('sr-9')
    expect(out[1].basedOn).toEqual([{ reference: 'ServiceRequest/sr-9' }])
  })

  it('leaves an Observation that already names its basis alone', () => {
    const own = { basedOn: [{ reference: 'ServiceRequest/other' }] }
    const out = linkToOrder([order(), obs('HGB', own)], counter()) as any[]
    expect(out[1].basedOn).toEqual(own.basedOn)
  })

  it('gives each Specimen an id and links it from the order', () => {
    const specimen = { resourceType: 'Specimen', status: 'unsatisfactory' } as FhirResource
    const out = linkToOrder([order(), specimen], counter()) as any[]
    expect(out[1].id).toBe('id-2')
    expect(out[0].specimen).toEqual([{ reference: 'Specimen/id-2' }])
    expect(out[1].request).toEqual([{ reference: 'ServiceRequest/id-1' }])
  })

  it('changes nothing when there is no order', () => {
    const none = [obs('HGB')]
    expect(linkToOrder(none, counter())).toEqual(none)
  })

  it('links every Observation and the Specimen to all the orders, keeping each fixed id', () => {
    const specimen = { resourceType: 'Specimen', status: 'unsatisfactory' } as FhirResource
    const out = linkToOrder([order({ id: 'sr-a' }), order({ id: 'sr-b' }), obs('HGB'), specimen], counter()) as any[]
    const both = [{ reference: 'ServiceRequest/sr-a' }, { reference: 'ServiceRequest/sr-b' }]
    expect(out.map((r) => r.id)).toEqual(['sr-a', 'sr-b', undefined, 'id-1'])
    expect(out[2].basedOn).toEqual(both)
    expect(out[3].request).toEqual(both)
    expect(out[0].specimen).toEqual([{ reference: 'Specimen/id-1' }])
    expect(out[1].specimen).toEqual([{ reference: 'Specimen/id-1' }])
  })

  it('mints an id for each order that has none', () => {
    const out = linkToOrder([order(), order(), obs('HGB')], counter()) as any[]
    expect(out[0].id).toBe('id-1')
    expect(out[1].id).toBe('id-2')
    expect(out[2].basedOn).toEqual([{ reference: 'ServiceRequest/id-1' }, { reference: 'ServiceRequest/id-2' }])
  })

  it('does not change the resources it was given', () => {
    const input = [order(), obs('HGB')]
    const before = JSON.stringify(input)
    linkToOrder(input, counter())
    expect(JSON.stringify(input)).toBe(before)
  })
})
