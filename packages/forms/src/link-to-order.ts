import type { FhirResource, Reference, ServiceRequest, Specimen } from 'fhir/r4'

/**
 * Point what one form submit extracted at the orders it belongs to (2026-10-11 spec, part 1).
 *
 * An order is one ServiceRequest per test. The warehouse fills lab_results.request_id from
 * Observation.basedOn (packages/db/src/relational/observation.ts), so an Observation with no basedOn
 * is a result no report can join to its order. Each order keeps an id it already has (the form route
 * sets fixed ones), and one with none is minted here, before the bundle is built: the ingest bundle
 * step keeps an id a resource arrives with and resolves `Type/id` references to it (packages/
 * workflows/src/engine/node-handlers/unwrap-bundle.ts).
 *
 * Every Observation with no basedOn gets all the orders, and every Specimen gets an id and a
 * `request` naming all the orders. Each order names the Specimens in `specimen`. With no order,
 * nothing is changed.
 */
export function linkToOrder(resources: FhirResource[], newId: () => string): FhirResource[] {
  const originals = resources.filter((r) => r.resourceType === 'ServiceRequest') as ServiceRequest[]
  if (originals.length === 0) return resources
  const orders = new Map<FhirResource, ServiceRequest>()
  for (const original of originals) orders.set(original, { ...original, id: original.id ?? newId() })
  const orderRefs: Reference[] = [...orders.values()].map((o) => ({ reference: `ServiceRequest/${o.id}` }))

  const specimenRefs: Reference[] = []
  const linked = resources.map((r): FhirResource => {
    const order = orders.get(r)
    if (order) return order
    if (r.resourceType === 'Specimen') {
      const specimen: Specimen = { ...r, id: r.id ?? newId(), request: [...(r.request ?? []), ...orderRefs.map((ref) => ({ ...ref }))] }
      specimenRefs.push({ reference: `Specimen/${specimen.id}` })
      return specimen
    }
    if (r.resourceType === 'Observation' && !r.basedOn?.length) return { ...r, basedOn: orderRefs.map((ref) => ({ ...ref })) }
    return r
  })
  if (specimenRefs.length > 0) {
    for (const order of orders.values()) order.specimen = [...(order.specimen ?? []), ...specimenRefs.map((ref) => ({ ...ref }))]
  }
  return linked
}
