// Order-level rejection on a Lab order (docs/superpowers/specs/2026-10-11-bench-order-link-and-rejection-design.md).
import { discriminatorEquals } from './discriminator'
import type { FieldDiscriminator } from './schema/form-schema'

/**
 * The element the field that holds an order rejection binds: `ServiceRequest.extension`, a real R4
 * element. The FHIR path lint rule refuses a path that is not one, so the field cannot bind a made-up
 * path. The discriminator (`{ url: ORDER_REJECTION_EXTENSION }`) names WHICH extension, so another
 * field bound to some other `ServiceRequest.extension` is not taken for it. Every reader finds the
 * field by path plus discriminator, never by its id, so an operator's copy of the form keeps working.
 */
export const ORDER_REJECTION_PATH = 'ServiceRequest.extension'

/**
 * The ServiceRequest extension the warehouse reads into `lab_requests.rejection_code` and
 * `rejection_reason` (packages/db/src/relational/request-facts.ts). cdr writes the same shape for
 * DISA rejections. It is also the `url` the rejection field's discriminator names.
 */
export const ORDER_REJECTION_EXTENSION = 'urn:openldr:ext:rejection'

/** True when a path and discriminator together name the order-rejection extension. */
export function isOrderRejectionBinding(path: string | null | undefined, discriminator: unknown): boolean {
  if (path !== ORDER_REJECTION_PATH) return false
  if (!discriminator || typeof discriminator !== 'object') return false
  return discriminatorEquals(discriminator as FieldDiscriminator, 'url') === ORDER_REJECTION_EXTENSION
}

/** True when the field binds ServiceRequest.extension with the order-rejection discriminator. */
export function isOrderRejectionField(field: { fhirPath?: string | null; fhirDiscriminator?: unknown }): boolean {
  return isOrderRejectionBinding(field.fhirPath, field.fhirDiscriminator)
}

/** The id of the enabled order-rejection field, or null when the form has none. */
export function orderRejectionFieldId(schema: {
  fields: ReadonlyArray<{ id: string; fhirPath?: string | null; fhirDiscriminator?: unknown; enabled?: boolean }>
}): string | null {
  return schema.fields.find((f) => f.enabled !== false && isOrderRejectionField(f))?.id ?? null
}
