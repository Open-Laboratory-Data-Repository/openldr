import type { FormField, FormSchema } from './schema/form-schema'
import { ServiceRequestExtractor, requesterFacilityAnswers, requisitionNumberAnswers } from './extract/extract'
import { isRequesterFacilityBinding, isRequisitionNumberBinding, pickedFacilityOf, type PickedFacility } from './extract/order-fields'
import { extractorsForForm } from './routing'
import { resolveReferenceSource } from './reference-source'
import type { QuestionnaireResponse, QuestionnaireResponseItem, QuestionnaireResponseItemAnswer } from 'fhir/r4'
import { fromAnswer } from './answer-value'
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

/** One answer as a display string, or null when it is empty or not a single answer. */
function displayValue(value: unknown): string | null {
  let text: string | null = null
  if (typeof value === 'string') text = value.trim()
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { display, code } = value as { display?: unknown; code?: unknown }
    if (typeof display === 'string' && display.trim()) text = display.trim()
    else if (typeof code === 'string' && code.trim()) text = code.trim()
  }
  return text || null
}

/** One answer as a short display string for the list summary. A yes/no stays true or false, so the
 *  studio can say it in the reader's language. */
function summaryValue(value: unknown): string | boolean | null {
  if (typeof value === 'boolean') return value
  return displayValue(value)?.slice(0, SUMMARY_VALUE_MAX) ?? null
}

/** One answer in an entry's list summary. `value` is true or false for a yes/no answer. An entry
 *  saved before yes/no answers stayed booleans holds the text "true" or "false" instead. */
export interface EntrySummaryItem { label: string; value: string | boolean }

/** One answer on a saved form copy as display text: a quantity as its value and unit, anything else
 *  as the summary writes a single value, not cut short. */
function answerText(answer: QuestionnaireResponseItemAnswer): string | boolean | null {
  // A yes/no stays true or false here, so the studio can say it in the reader's language.
  if (typeof answer.valueBoolean === 'boolean') return answer.valueBoolean
  if (answer.valueQuantity?.value !== undefined) {
    return [answer.valueQuantity.value, answer.valueQuantity.unit].filter((v) => v !== undefined && v !== '').join(' ')
  }
  return displayValue(fromAnswer(answer))
}

/** The display text of every answer at or below this item, in order. */
function partsOf(item: QuestionnaireResponseItem): Array<string | boolean> {
  return [
    ...(item.answer ?? []).map(answerText).filter((v): v is string | boolean => v !== null),
    ...(item.item ?? []).flatMap(partsOf),
  ]
}

/** One row of the entry sheet. `fieldId` is the item's linkId; for a field inside a group it is the
 *  child's id. */
export interface EntryAnswer {
  fieldId: string; label: string; value: string
  /** Each part of `value`, present only when one is a yes/no answer. A yes/no part is true or false,
   *  so the reader shows it in its own language; `value` writes it as "true" or "false". */
  parts?: Array<string | boolean>
}

/**
 * Every answered item of a saved form copy, in the order the copy holds them, which is the form's
 * order when it was saved. A label is the copy's own item `text` when it carries one, else the
 * current form's label, else the linkId. Several values are joined with ", ". A group gives one row
 * per answered child, labelled "<group> / <child>". A test details answer, or any other item with
 * parts below it, gives the display of each part (a coding's code when it has no display).
 */
export function entryAnswersOfResponse(schema: FormSchema, response: QuestionnaireResponse): EntryAnswer[] {
  const fields = new Map(schema.fields.map((f) => [f.id, f]))
  const sections = new Set(schema.sections.map((s) => s.id))
  const labelOf = (item: QuestionnaireResponseItem): string => item.text?.trim() || fields.get(item.linkId)?.displayLabel || item.linkId
  const rows: EntryAnswer[] = []
  const push = (fieldId: string, label: string, parts: Array<string | boolean>) => {
    if (parts.length === 0) return
    const value = parts.map(String).join(', ')
    rows.push(parts.some((p) => typeof p === 'boolean') ? { fieldId, label, value, parts } : { fieldId, label, value })
  }

  const walk = (items: QuestionnaireResponseItem[] | undefined, prefix: string | null): void => {
    for (const item of items ?? []) {
      const field = fields.get(item.linkId)
      const label = prefix ? `${prefix} / ${labelOf(item)}` : labelOf(item)
      if (!field && sections.has(item.linkId) && !item.answer?.length) walk(item.item, prefix)
      else if (field?.fieldType === 'group') walk(item.item, label)
      else push(item.linkId, label, partsOf(item))
    }
  }
  walk(response.item, null)
  return rows
}

/** The requisition number, the picked facility coding and the list summary from one set of answers. */
export function entryValuesOf(schema: FormSchema, answers: Record<string, unknown>): {
  entryKey: string | null
  facility: PickedFacility | null
  summary: EntrySummaryItem[]
} {
  const { keyFieldId, facilityFieldId } = entryFieldsOf(schema)

  const rawKey = keyFieldId ? answers[keyFieldId] : undefined
  const key = typeof rawKey === 'string' || typeof rawKey === 'number' ? String(rawKey).trim() : ''
  const facility = facilityFieldId ? pickedFacilityOf(answers[facilityFieldId]) : null

  // A group's answers, and a field inside a group, are not single top-level answers.
  const single = schema.fields.filter((f) => f.fieldType !== 'group' && !f.groupId).sort(byOrder)
  const flagged = single.filter((f) => f.entriesList === true)
  const candidates = flagged.length > 0 ? flagged : single.filter((f) => f.id !== keyFieldId)

  const summary: EntrySummaryItem[] = []
  for (const field of candidates) {
    if (summary.length >= SUMMARY_MAX) break
    const value = summaryValue(answers[field.id])
    if (value !== null) summary.push({ label: field.displayLabel, value })
  }

  return { entryKey: key || null, facility, summary }
}
