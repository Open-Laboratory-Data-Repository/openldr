import type { FormField, FormSchema } from './schema/form-schema'
import { ServiceRequestExtractor, requesterFacilityAnswers, requisitionNumberAnswers } from './extract/extract'
import { isRequesterFacilityBinding, isRequisitionNumberBinding, pickedFacilityOf, type PickedFacility } from './extract/order-fields'
import { extractorsForForm } from './routing'
import { resolveReferenceSource } from './reference-source'
import { toQuestionnaireResponse } from './response'
import { toQuestionnaire } from './to-questionnaire'

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

/** One referring-facility answer: the picked register coding, or the typed name. */
export interface FacilityAnswer {
  fieldId: string
  facility: PickedFacility | null
  name: string | null
}

const isFromRegister = (field: FormField): boolean => {
  const source = resolveReferenceSource(field)
  return source?.ok === true && source.source.kind === 'coding'
}

/**
 * Every referring-facility field of a form and every answer to one. A form may carry more than one
 * such field. The order extractor keeps the last answered one, so `order` is that one, and a site
 * check must look at all of `answered`, not only the field `entryFieldsOf` names.
 */
export function entryFacilitiesOf(schema: FormSchema, answers: Record<string, unknown>): {
  fields: { id: string; fromRegister: boolean }[]
  answered: FacilityAnswer[]
  order: FacilityAnswer | null
} {
  if (!extractorsForForm(schema).includes(ServiceRequestExtractor)) return { fields: [], answered: [], order: null }
  const fields = schema.fields.slice().sort(byOrder)
    .filter((f) => f.enabled !== false && isRequesterFacilityBinding(f.fhirPath, f.fhirDiscriminator))
    .map((f) => ({ id: f.id, fromRegister: isFromRegister(f) }))
  // Read the answers through the response and questionnaire the extractor reads, in its order.
  const read = requesterFacilityAnswers(toQuestionnaireResponse(schema, answers as never), toQuestionnaire(schema))
  const answered = read.map(({ linkId, value }): FacilityAnswer => {
    const facility = pickedFacilityOf(value)
    const display = facility?.display
      ?? (typeof value === 'string' ? value : (value as { display?: unknown } | null)?.display)
    return { fieldId: linkId, facility, name: typeof display === 'string' && display.trim() ? display.trim() : null }
  })
  return { fields, answered, order: answered.at(-1) ?? null }
}

/**
 * The requisition number the saved order will carry, trimmed, or null when there is none. With two
 * fields bound to the order identifier the extractor keeps the last answered one, so this does too.
 * `entryValuesOf(...).entryKey` reads the first such field and is left as it is for its callers.
 */
export function entryKeyOf(schema: FormSchema, answers: Record<string, unknown>): string | null {
  if (!extractorsForForm(schema).includes(ServiceRequestExtractor)) return null
  const read = requisitionNumberAnswers(toQuestionnaireResponse(schema, answers as never), toQuestionnaire(schema))
  return read.at(-1)?.trim() || null
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
