import { fhirPathOptionsFor, type FhirPathInfo } from '@openldr/fhir/paths';
import { discriminatorIdentity, resolveFhirPath, type FormField, type StarterPackEntry } from '@openldr/forms/pure';

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

/**
 * Pack entries the form does not have yet, in pack order. Ported from corlix `lib/libraryEntries.ts:73`.
 *
 * An entry with a path matches by path and discriminator, so two slots of one list stay two entries.
 * A path the form writes bare, as the Users form does (`name.given`), is resolved against the form's
 * resource type first. An entry with no path, such as the Facility pack's System, matches by API
 * property; corlix matches by path only and would offer those again forever. A disabled field counts.
 */
export function packEntriesNotOnForm(
  entries: readonly StarterPackEntry[],
  fields: readonly FormField[],
  resourceType: string | null | undefined,
): StarterPackEntry[] {
  const bound = new Set<string>();
  for (const f of fields) {
    const path = resolveFhirPath(f.fhirPath, resourceType);
    if (path) bound.add(`path:${path}|${discriminatorIdentity(f.fhirDiscriminator)}`);
    if (f.apiProperty) bound.add(`api:${f.apiProperty}`);
  }
  return [...entries]
    .sort((a, b) => a.ord - b.ord)
    .filter((e) => {
      const key = e.fhirPath
        ? `path:${e.fhirPath}|${discriminatorIdentity(e.discriminator)}`
        : e.apiProperty ? `api:${e.apiProperty}` : null;
      return key === null || !bound.has(key);
    });
}
