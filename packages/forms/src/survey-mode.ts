/**
 * A form whose resource type is `Questionnaire` IS a questionnaire, not a mapping onto one. It has
 * no resource to point a field at, so the editor hides the mapping controls. Named once here so
 * the editor and, from S3, the Library ask the same question.
 *
 * Ported from corlix `apps/desktop/src/renderer/lib/surveyMode.ts`.
 */
export function isSurveyForm(fhirResourceType: string | null | undefined): boolean {
  return fhirResourceType === 'Questionnaire';
}
