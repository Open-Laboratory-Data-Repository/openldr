import type { FormField } from './schema/form-schema'
import type { QuestionnaireResponseItemAnswer } from 'fhir/r4'
import { isCodingAnswer, isEntityAnswer } from './reference-source'

/** Filled-in form values, keyed by field id (the app's `values` shape). */
export type AnswerState = Record<string, unknown>

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === ''

/** Encode a single scalar value as a QuestionnaireResponse answer, by field type. */
export function toAnswer(field: FormField, value: unknown): QuestionnaireResponseItemAnswer | null {
  if (isEmpty(value)) return null

  // Object-shaped answers are produced only by a resolved reference picker. They are
  // dispatched on shape, not field type, so every legacy bare-string mapping below is
  // preserved exactly — including valueString for organism/antibiogram.
  if (isCodingAnswer(value)) {
    return {
      valueCoding: {
        system: value.system,
        code: value.code,
        ...(value.display ? { display: value.display } : {}),
      },
    }
  }
  if (isEntityAnswer(value)) {
    return {
      valueReference: {
        reference: value.reference,
        ...(value.display ? { display: value.display } : {}),
      },
    }
  }

  switch (field.fieldType) {
    case 'number':
      return { valueDecimal: Number(value) }
    case 'boolean':
      return { valueBoolean: Boolean(value) }
    case 'date':
      return { valueDate: String(value) }
    case 'datetime':
      return { valueDateTime: String(value) }
    case 'select':
    case 'multiselect':
      return { valueCoding: { code: String(value) } }
    case 'reference':
    case 'facility':
      return { valueReference: { reference: String(value) } }
    default:
      // text, phone, email, identifier, address, attachment, organism, antibiogram, group
      return { valueString: String(value) }
  }
}

/** Decode a QuestionnaireResponse answer back to a raw value (by which value[x] is present). */
export function fromAnswer(answer: QuestionnaireResponseItemAnswer): unknown {
  if (answer.valueDecimal !== undefined) return answer.valueDecimal
  if (answer.valueInteger !== undefined) return answer.valueInteger
  if (answer.valueBoolean !== undefined) return answer.valueBoolean
  if (answer.valueDate !== undefined) return answer.valueDate
  if (answer.valueDateTime !== undefined) return answer.valueDateTime
  if (answer.valueCoding !== undefined) {
    // A system is the discriminator: select/multiselect write a bare code and must keep
    // decoding to a string, or every existing select round-trip breaks.
    return answer.valueCoding.system
      ? { system: answer.valueCoding.system, code: answer.valueCoding.code ?? '', display: answer.valueCoding.display ?? null }
      : answer.valueCoding.code ?? ''
  }
  if (answer.valueReference !== undefined) {
    // Display is the discriminator here, mirroring the system check above: a legacy bare
    // reference has none and must keep decoding to a string, or the existing round-trip
    // test at answer-value.test.ts:166 breaks.
    return answer.valueReference.display
      ? { reference: answer.valueReference.reference ?? '', display: answer.valueReference.display }
      : answer.valueReference.reference ?? ''
  }
  if (answer.valueString !== undefined) return answer.valueString
  return undefined
}
