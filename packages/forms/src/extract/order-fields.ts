import type { FieldDiscriminator } from '../schema/form-schema'
import { discriminatorEquals } from '../discriminator'

/**
 * Which order fields mean what. The ServiceRequest extractor and the entries list both read these,
 * so the rule lives in one place.
 */

/**
 * True for a field bound to the order's requisition number. The shipped Lab order binds it to
 * ServiceRequest.identifier.value since migration 103. A form an operator edited before then keeps
 * the whole-list path, so both count.
 */
export function isRequisitionNumberBinding(path: string | null | undefined): boolean {
  return path === 'ServiceRequest.identifier' || path === 'ServiceRequest.identifier.value'
}

/**
 * True for a field bound to the referring facility. The clinician and the facility both fill the
 * requester (migration 115), told apart by Reference.type. A requester field naming no type is the
 * clinician, as it was before 115.
 */
export function isRequesterFacilityBinding(path: string | null | undefined, discriminator: FieldDiscriminator | undefined): boolean {
  return path === 'ServiceRequest.requester' && discriminatorEquals(discriminator, 'type') === 'Organization'
}

/** A facility picked from the facility register, as the answer holds it. */
export interface PickedFacility { system?: string; code: string; display?: string }

/**
 * The facility a facility answer picked, or null when the answer is a typed name or empty. A picked
 * facility is a coding with a code; a name typed into a free-text field is a string.
 */
export function pickedFacilityOf(value: unknown): PickedFacility | null {
  if (!value || typeof value !== 'object') return null
  const { system, code, display } = value as { system?: unknown; code?: unknown; display?: unknown }
  if (typeof code !== 'string' || !code) return null
  return {
    ...(typeof system === 'string' && system ? { system } : {}),
    code,
    ...(typeof display === 'string' && display ? { display } : {}),
  }
}
