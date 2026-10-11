// Order-level rejection on a Lab order (docs/superpowers/specs/2026-10-11-bench-order-link-and-rejection-design.md).

/**
 * CE's own path for the field that holds an order rejection. It names the field's job, not a FHIR
 * element, like `ServiceRequest.identifier.value` does for the requisition number. Every reader finds
 * the field by this path, never by its id, so an operator's copy of the form keeps working.
 */
export const ORDER_REJECTION_PATH = 'ServiceRequest.rejection'

/**
 * The ServiceRequest extension the warehouse reads into `lab_requests.rejection_code` and
 * `rejection_reason` (packages/db/src/relational/request-facts.ts). cdr writes the same shape for
 * DISA rejections.
 */
export const ORDER_REJECTION_EXTENSION = 'urn:openldr:ext:rejection'

/** The id of the enabled field bound to ORDER_REJECTION_PATH, or null when the form has none. */
export function orderRejectionFieldId(schema: {
  fields: ReadonlyArray<{ id: string; fhirPath?: string | null; enabled?: boolean }>
}): string | null {
  return schema.fields.find((f) => f.enabled !== false && f.fhirPath === ORDER_REJECTION_PATH)?.id ?? null
}
