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

/**
 * The lab's task codes (lab module slice 3, ruling 3). HL7's task-code has no "recollect", so the
 * codes are local. Migration 140 seeds this system with both. They are workflow constants, like the
 * desk origin, not clinical vocabulary.
 */
export const LAB_TASK_SYSTEM = 'urn:openldr:cs:lab-task'

export type LabTaskKind = 'correct-request' | 'recollect-sample'

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, HASH_LENGTH)
}

/** The id of a lab Task. The key is the order key for a return, and the focus id for a redraw, so
 *  asking again for the same thing writes a new version of the same Task. */
export function labTaskId(kind: LabTaskKind, key: string): string {
  return `tk-${digest(`${kind}|${key}`)}`
}

/** The id of the Observation that records why one test's request was rejected. */
export function labRejectionObservationId(serviceRequestId: string): string {
  return `ob-rej-${digest(serviceRequestId)}`
}
