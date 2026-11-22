import { createHash } from 'node:crypto'

/**
 * Fixed ids for an order's records (lab module slices 1b and 2, ruling 1).
 *
 * An order is one ServiceRequest per test. Each id comes from the requesting facility, the
 * requisition number and the test, so saving the same order again writes the same records instead
 * of copies. The facility is part of the key because two sites may use the same requisition number
 * (`136_form_entries.ts`). This file uses node:crypto, so it is exported from the package root only,
 * never from `pure.ts`, and the studio never bundles it.
 */

/** The tag system that says where an order was registered. */
export const ORDER_ORIGIN_SYSTEM = 'urn:openldr:cs:order-origin'

/** The key one order is known by: the facility code (empty when none) and the requisition number. */
export function orderKey(facility: string | null, requisition: string): string {
  return `${facility ?? ''}|${requisition}`
}

const HASH_LENGTH = 40

function hashed(prefix: string, facility: string | null, requisition: string, coding: { system: string; code: string }): string {
  const digest = createHash('sha256').update(`${orderKey(facility, requisition)}|${coding.system}|${coding.code}`).digest('hex')
  return `${prefix}${digest.slice(0, HASH_LENGTH)}`
}

/** The id of the ServiceRequest for one test on an order. */
export function labOrderId(facility: string | null, requisition: string, test: { system: string; code: string }): string {
  return hashed('sr-', facility, requisition, test)
}

/** The id of the Specimen for one sample type on an order. */
export function labSpecimenId(facility: string | null, requisition: string, type: { system: string; code: string }): string {
  return hashed('sp-', facility, requisition, type)
}
