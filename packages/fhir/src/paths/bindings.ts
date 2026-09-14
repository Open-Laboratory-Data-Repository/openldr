/**
 * FHIR's own ValueSet bindings, by element path. Ported from corlix
 * `apps/desktop/src/main/fhir-bindings.ts`. `scripts/gen-fhir-bindings.ts` runs the extractor and
 * commits the result as `r4-bindings.generated.ts`; nothing reads a FHIR Bundle at run time.
 */

export type FhirBindingStrength = 'required' | 'extensible' | 'preferred' | 'example';

export interface FhirBinding {
  valueSet: string;
  strength: FhirBindingStrength;
}

const STRENGTHS = new Set<string>(['required', 'extensible', 'preferred', 'example']);

interface SdElement {
  path?: string;
  binding?: { valueSet?: string; strength?: string };
}

interface StructureDefinition {
  resourceType?: string;
  kind?: string;
  snapshot?: { element?: SdElement[] };
  differential?: { element?: SdElement[] };
}

/**
 * Each resource element's binding, keyed by path, from a FHIR `profiles-resources` Bundle. `keep`,
 * when given, drops every path it lacks. A `|version` suffix on the ValueSet URL is dropped, and an
 * element whose binding names no valid strength is skipped.
 */
export function extractBindings(bundle: unknown, keep?: ReadonlySet<string>): Record<string, FhirBinding> {
  const out: Record<string, FhirBinding> = {};
  const entries = (bundle as { entry?: Array<{ resource?: StructureDefinition }> } | null)?.entry ?? [];
  for (const { resource: sd } of entries) {
    if (!sd || sd.resourceType !== 'StructureDefinition' || sd.kind !== 'resource') continue;
    for (const el of sd.snapshot?.element ?? sd.differential?.element ?? []) {
      const path = el.path;
      if (!path || !path.includes('.')) continue;
      if (keep && !keep.has(path)) continue;
      const valueSet = el.binding?.valueSet;
      const strength = el.binding?.strength;
      if (!valueSet || !strength || !STRENGTHS.has(strength)) continue;
      out[path] = { valueSet: valueSet.split('|')[0], strength: strength as FhirBindingStrength };
    }
  }
  return out;
}

/**
 * The same map from corlix's committed table (`{ [path]: { vs, strength, targets } }`), which its
 * extractor produced from the same HL7 file. The generator's offline route.
 */
export function bindingsFromTable(table: unknown, keep?: ReadonlySet<string>): Record<string, FhirBinding> {
  const out: Record<string, FhirBinding> = {};
  for (const [path, entry] of Object.entries((table ?? {}) as Record<string, { vs?: string; strength?: string }>)) {
    if (keep && !keep.has(path)) continue;
    if (!entry.vs || !entry.strength || !STRENGTHS.has(entry.strength)) continue;
    out[path] = { valueSet: entry.vs.split('|')[0], strength: entry.strength as FhirBindingStrength };
  }
  return out;
}

/** The committed file's source. Paths are sorted so a rerun diffs cleanly. */
export function renderBindingsTable(table: Record<string, FhirBinding>): string {
  const lines = Object.keys(table)
    .sort()
    .map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(table[path])},`);
  return [
    '// GENERATED FILE. Do not edit by hand. Run `pnpm gen:fhir-bindings`.',
    "// FHIR R4's own ValueSet bindings for the paths in r4-paths.generated.ts, from hl7.org's",
    '// profiles-resources.json.',
    '',
    "import type { FhirBinding } from './bindings';",
    '',
    'export const R4_BINDINGS: Readonly<Record<string, FhirBinding>> = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}
