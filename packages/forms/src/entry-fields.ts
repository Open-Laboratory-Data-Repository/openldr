import type { FormField, FormSchema } from './schema/form-schema'
import { ServiceRequestExtractor } from './extract/extract'
import { isRequesterFacilityBinding, isRequisitionNumberBinding, pickedFacilityOf, type PickedFacility } from './extract/order-fields'
import { extractorsForForm } from './routing'
import { resolveReferenceSource } from './reference-source'

/** The fields of a form that make an entry in its entries list. */
export interface EntryFields {
  /** The field bound to ServiceRequest.identifier or .identifier.value, if any. */
  keyFieldId: string | null
  /** The facility field that fills the order's requester, if any. */
  facilityFieldId: string | null
  /** True when that field picks from the facility register; false when it is free text. */
  facilityFromRegister: boolean
}

/** The most answers the list summary shows. */
const SUMMARY_MAX = 3
/** The longest a summary value may be. */
const SUMMARY_VALUE_MAX = 80

const byOrder = (a: FormField, b: FormField): number => a.order - b.order

/**
 * Which fields are the requisition number and the facility. Only a form the order extractor runs on
 * has them, and they are found by the same rules the extractor uses. With two fields on one binding,
 * the first in form order counts.
 */
export function entryFieldsOf(schema: FormSchema): EntryFields {
  if (!extractorsForForm(schema).includes(ServiceRequestExtractor)) {
    return { keyFieldId: null, facilityFieldId: null, facilityFromRegister: false }
  }
  const fields = schema.fields.slice().sort(byOrder)
  const key = fields.find((f) => isRequisitionNumberBinding(f.fhirPath))
  const facility = fields.find((f) => isRequesterFacilityBinding(f.fhirPath, f.fhirDiscriminator))
  const source = facility ? resolveReferenceSource(facility) : null
  return {
    keyFieldId: key?.id ?? null,
    facilityFieldId: facility?.id ?? null,
    // A field with a coding source offers picked codings; one with no source is a text box.
    facilityFromRegister: source?.ok === true && source.source.kind === 'coding',
  }
}

/** One answer as a short display string, or null when it is empty or not a single answer. */
function summaryValue(value: unknown): string | null {
  let text: string | null = null
  if (typeof value === 'string') text = value.trim()
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { display, code } = value as { display?: unknown; code?: unknown }
    if (typeof display === 'string' && display.trim()) text = display.trim()
    else if (typeof code === 'string' && code.trim()) text = code.trim()
  }
  return text ? text.slice(0, SUMMARY_VALUE_MAX) : null
}

/** The requisition number, the picked facility coding and the list summary from one set of answers. */
export function entryValuesOf(schema: FormSchema, answers: Record<string, unknown>): {
  entryKey: string | null
  facility: PickedFacility | null
  summary: { label: string; value: string }[]
} {
  const { keyFieldId, facilityFieldId } = entryFieldsOf(schema)

  const rawKey = keyFieldId ? answers[keyFieldId] : undefined
  const key = typeof rawKey === 'string' || typeof rawKey === 'number' ? String(rawKey).trim() : ''
  const facility = facilityFieldId ? pickedFacilityOf(answers[facilityFieldId]) : null

  // A group's answers, and a field inside a group, are not single top-level answers.
  const single = schema.fields.filter((f) => f.fieldType !== 'group' && !f.groupId).sort(byOrder)
  const flagged = single.filter((f) => f.entriesList === true)
  const candidates = flagged.length > 0 ? flagged : single.filter((f) => f.id !== keyFieldId)

  const summary: { label: string; value: string }[] = []
  for (const field of candidates) {
    if (summary.length >= SUMMARY_MAX) break
    const value = summaryValue(answers[field.id])
    if (value !== null) summary.push({ label: field.displayLabel, value })
  }

  return { entryKey: key || null, facility, summary }
}
