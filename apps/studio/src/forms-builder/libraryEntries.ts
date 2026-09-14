import { fhirPathOptionsFor, type FhirPathInfo } from '@openldr/fhir/paths';
import { resolveFhirPath, type FormField } from '@openldr/forms/pure';

/** Segments below the resource the Library offers. Corlix expands one level of a complex type. */
export const LIBRARY_MAX_DEPTH = 2;

/** FHIR plumbing corlix never offers (`main/fhir-resources.ts:34-37`), at any level. */
const INFRASTRUCTURE = new Set(['id', 'meta', 'implicitRules', 'language', 'text', 'contained', 'extension', 'modifierExtension']);

/**
 * The elements of the form's resource type that no field binds yet. A disabled field still binds
 * its path, because disabling keeps the field on the form. Ported from corlix `lib/libraryEntries.ts`.
 */
export function libraryElements(resourceType: string | null | undefined, fields: readonly FormField[]): FhirPathInfo[] {
  if (!resourceType) return [];
  const bound = new Set<string>();
  for (const f of fields) {
    const resolved = resolveFhirPath(f.fhirPath, resourceType);
    if (resolved) bound.add(resolved);
  }
  return fhirPathOptionsFor(resourceType).filter((e) => {
    const segments = e.path.split('.').slice(1);
    return segments.length <= LIBRARY_MAX_DEPTH && !segments.some((s) => INFRASTRUCTURE.has(s)) && !bound.has(e.path);
  });
}
