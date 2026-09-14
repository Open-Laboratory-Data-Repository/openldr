import { lookupFhirPath } from '@openldr/fhir/paths';
import { resolveFhirPath } from './fhir-path';
import type { FormField } from './schema/form-schema';

/** Every `.<digits>` segment, the same pattern `lint-fhir-path.ts` strips to find an element. */
const NUMERIC_SEGMENT = /\.\d+(?=\.|$)/g;

/**
 * Does this group hold many instances, or exactly one?
 *
 * The exporter and the builder row both need the same answer, so it is derived here once.
 * Before this, `toQuestionnaire` wrote `repeats: true` for every group, so a one-instance element
 * such as `Location.address` could not be a group without exporting a falsehood.
 *
 * Two signals count, and nothing else does:
 *
 * - the author capped the group with `maxItems: 1`
 * - the group is bound to an element whose own maximum is 1
 *
 * The second reads the path table's `ownArray`, never the field's own `cardinality`. The default
 * cardinality is `{min: 0, max: '1'}` and picking `group` in the type dropdown never changes it, so
 * trusting it would convert every group ever authored. An unbound group, or one bound to a path
 * the table does not cover, keeps repeating.
 *
 * Returns false for a field that is not a group. A scalar field's repetition is `repeatable`.
 *
 * Ported from corlix `packages/fhir-forms/src/groupRepeats.ts`, which can trust `cardinality`
 * because corlix's path picker copies it from the element. CE's picker does not.
 */
export function groupRepeats(field: FormField, fhirResourceType: string | null | undefined): boolean {
  if (field.fieldType !== 'group') return false;
  if (field.maxItems === 1) return false;
  const resolved = resolveFhirPath(field.fhirPath, fhirResourceType);
  if (resolved) {
    const info = lookupFhirPath(resolved.replace(NUMERIC_SEGMENT, ''));
    if (info && !info.ownArray) return false;
  }
  return true;
}
