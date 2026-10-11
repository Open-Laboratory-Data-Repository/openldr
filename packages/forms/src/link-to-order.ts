import type { FhirResource, Reference, ServiceRequest, Specimen } from 'fhir/r4'

/**
 * Point what one form submit extracted at the order it belongs to (2026-10-11 spec, part 1).
 *
 * The warehouse fills lab_results.request_id from Observation.basedOn (packages/db/src/relational/
 * observation.ts), so an Observation with no basedOn is a result no report can join to its order.
 * The order gets its id here, before the bundle is built: the ingest bundle step keeps an id a
 * resource arrives with and resolves `Type/id` references to it (packages/workflows/src/engine/
 * node-handlers/unwrap-bundle.ts). With no order, or more than one, nothing is changed.
 */
export function linkToOrder(resources: FhirResource[], newId: () => string): FhirResource[] {
  const orders = resources.filter((r) => r.resourceType === 'ServiceRequest') as ServiceRequest[]
  if (orders.length !== 1) return resources
  const original = orders[0]!
  const order: ServiceRequest = { ...original, id: original.id ?? newId() }
  const orderRef: Reference = { reference: `ServiceRequest/${order.id}` }

  const specimenRefs: Reference[] = []
  const linked = resources.map((r): FhirResource => {
    if (r === original) return order
    if (r.resourceType === 'Specimen') {
      const specimen: Specimen = { ...r, id: r.id ?? newId() }
      specimenRefs.push({ reference: `Specimen/${specimen.id}` })
      return specimen
    }
    if (r.resourceType === 'Observation' && !r.basedOn?.length) return { ...r, basedOn: [orderRef] }
    return r
  })
  if (specimenRefs.length > 0) order.specimen = [...(order.specimen ?? []), ...specimenRefs]
  return linked
}
