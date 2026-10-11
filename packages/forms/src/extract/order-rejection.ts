import type { Coding, Questionnaire, QuestionnaireItem, QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4'
import { EXT_CORLIX_FHIR_PATH } from '../extensions'
import { ORDER_REJECTION_PATH } from '../order-rejection-path'

function findLinkId(items: QuestionnaireItem[] | undefined): string | null {
  for (const item of items ?? []) {
    if (item.extension?.some((e) => e.url === EXT_CORLIX_FHIR_PATH && e.valueString === ORDER_REJECTION_PATH)) return item.linkId
    const inner = findLinkId(item.item)
    if (inner) return inner
  }
  return null
}

function findAnswer(items: QuestionnaireResponseItem[] | undefined, linkId: string): Coding | null {
  for (const item of items ?? []) {
    if (item.linkId === linkId) return item.answer?.[0]?.valueCoding ?? null
    const inner = findAnswer(item.item, linkId)
    if (inner) return inner
  }
  return null
}

/** The reason the whole order was rejected, read from the field bound to ORDER_REJECTION_PATH. */
export function orderRejectionOf(response: QuestionnaireResponse, questionnaire: Questionnaire): Coding | null {
  const linkId = findLinkId(questionnaire.item)
  if (!linkId) return null
  const coding = findAnswer(response.item, linkId)
  return coding?.code ? coding : null
}
