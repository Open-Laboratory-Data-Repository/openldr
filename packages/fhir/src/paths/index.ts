import { R4_PATHS, R4_PATH_RESOURCE_TYPES, type R4PathTuple } from './r4-paths.generated';

export type { R4PathTuple };

/** One bindable path, decoded from the generated tuple table. */
export interface FhirPathInfo {
  /** Resource-prefixed dotted path, for example `Location.address.district`. */
  path: string;
  /** The leading segment, for example `Location`. */
  resourceType: string;
  /** `string`, `number`, `boolean`, `code`, or a FHIR datatype name such as `CodeableConcept`. */
  leafType: string;
  /**
   * True when ANY segment along the path is an array. `Location.identifier.value` is true
   * because `Location.identifier` is `Identifier[]`, even though `value` itself is a scalar.
   */
  isArray: boolean;
  /** The element's short label, straight from the R4 definition. */
  label: string;
}

/** Resource types the table covers, sorted. */
export const FHIR_PATH_RESOURCE_TYPES: readonly string[] = R4_PATH_RESOURCE_TYPES;

const RESOURCE_TYPE_SET = new Set(R4_PATH_RESOURCE_TYPES);

function decode(tuple: R4PathTuple): FhirPathInfo {
  const [path, leafType, isArray, label] = tuple;
  return { path, resourceType: path.slice(0, path.indexOf('.')), leafType, isArray: isArray === 1, label };
}

// Built once on first use rather than at module load, so importing this module for
// `isKnownFhirResourceType` alone does not pay for indexing 1596 rows.
let index: Map<string, FhirPathInfo> | null = null;

function getIndex(): Map<string, FhirPathInfo> {
  if (!index) {
    index = new Map();
    for (const tuple of R4_PATHS) {
      const info = decode(tuple);
      index.set(info.path, info);
    }
  }
  return index;
}

/** The path's definition, or null when the table does not contain it. */
export function lookupFhirPath(path: string): FhirPathInfo | null {
  if (!path) return null;
  return getIndex().get(path) ?? null;
}

/** Every path on one resource type, in table order. Empty when the type is not covered. */
export function fhirPathsFor(resourceType: string): FhirPathInfo[] {
  if (!RESOURCE_TYPE_SET.has(resourceType)) return [];
  const prefix = `${resourceType}.`;
  const out: FhirPathInfo[] = [];
  for (const info of getIndex().values()) {
    if (info.path.startsWith(prefix)) out.push(info);
  }
  return out;
}

/**
 * Segments that are FHIR plumbing rather than something a form field binds to.
 *
 * Only meaningful in a NON-LEADING position. `Patient.identifier` is a real element; nobody binds
 * to `Patient.identifier.id`.
 */
const STRUCTURAL_SEGMENTS: ReadonlySet<string> = new Set(['id', 'extension', 'modifierExtension']);

function isStructuralNoise(path: string): boolean {
  return path.split('.').some((segment, index) => index > 0 && STRUCTURAL_SEGMENTS.has(segment));
}

/**
 * The paths to OFFER a person in a picker, as opposed to the paths that are VALID.
 *
 * Separate from `fhirPathsFor` on purpose. That one feeds the lint rules, which must keep treating
 * `Location.identifier.id` as a real element: `unknown-fhir-path` is a publish-blocking error, so
 * trimming its view would reject a path that genuinely exists. This one feeds the builder's
 * picker, where the same row is noise. Measured 2026-08-24: 497 of 1596 rows are trimmed here.
 */
export function fhirPathOptionsFor(resourceType: string): FhirPathInfo[] {
  return fhirPathsFor(resourceType).filter((info) => !isStructuralNoise(info.path));
}

/** Whether the table covers this resource type at all. */
export function isKnownFhirResourceType(resourceType: string): boolean {
  return RESOURCE_TYPE_SET.has(resourceType);
}
