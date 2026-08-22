import { isKnownFhirResourceType } from '@openldr/fhir/paths';

/**
 * Turn a form field's `fhirPath` into its canonical, resource-prefixed form.
 *
 * Two grammars are in the wild. The Practitioner sample still writes bare paths
 * (`name.given`); the Facility, Patient and Requisition samples write prefixed ones
 * (`Location.address.district`, `Patient.birthDate`). Facility moved to prefixed paths so it
 * matches migration 089's snapshot; see packages/db/src/migrations/internal/089_facility_form_canonical_paths.ts.
 * Prefixed is canonical, because a form can bind fields on more than one resource: the
 * Requisition form declares `fhirResourceType: 'ServiceRequest'` and carries `Specimen.type`
 * fields (packages/forms/src/samples/forms.ts:429). A bare path cannot say which resource a
 * field lands on.
 *
 * Returns null rather than guessing when a bare path has no resource type to hang off. The
 * caller reports that; this function never invents a prefix.
 */
export function resolveFhirPath(
  fhirPath: string | null | undefined,
  fhirResourceType: string | null | undefined,
): string | null {
  if (!fhirPath) return null;

  const trimmedPath = fhirPath.trim();
  if (!trimmedPath) return null;

  const head = trimmedPath.slice(0, trimmedPath.indexOf('.') === -1 ? trimmedPath.length : trimmedPath.indexOf('.'));
  if (isKnownFhirResourceType(head)) return trimmedPath;

  if (!fhirResourceType) return null;
  if (!isKnownFhirResourceType(fhirResourceType)) return null;
  return `${fhirResourceType}.${trimmedPath}`;
}
