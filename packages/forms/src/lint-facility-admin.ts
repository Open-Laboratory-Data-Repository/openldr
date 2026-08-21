import { FACILITY_ADMIN_LEVELS } from '@openldr/db/facility-answers';
import { resolveFhirPath } from './fhir-path';
import type { FormLintIssue } from './lint';
import type { FormSchema } from './schema/form-schema';

/**
 * FHIR Address administrative elements, widest first.
 *
 * `country > state > district > city` is the R4 nesting: `state` is "sub-unit of a country",
 * `district` is "district name (aka county)", and `city` is "city, town, suburb, village or other
 * community". This is structural FHIR vocabulary, not clinical vocabulary.
 */
const ADDRESS_ORDER: readonly string[] = [
  'address.country',
  'address.state',
  'address.district',
  'address.city',
];

/** Strip the resource prefix a canonical path carries, so `Location.address.state` ranks. */
function addressRank(resolvedPath: string): number {
  const tail = resolvedPath.slice(resolvedPath.indexOf('.') + 1);
  return ADDRESS_ORDER.indexOf(tail);
}

/**
 * The four cascading facility admin levels must bind Address elements in the same containment
 * order the levels themselves declare.
 *
 * `FACILITY_ADMIN_LEVELS` is `zone < region < district < council`, widest first, and its key order
 * is load-bearing (see the comment on `FACILITY_ADMIN_LEVEL_SET` in
 * `packages/db/src/facility-answers.ts`). Reading it from there rather than restating it keeps one
 * source for the order.
 *
 * Keys on `apiProperty`, never on `displayLabel`. An operator who renames Zone must not be able to
 * defeat the check.
 *
 * A level with a `null` path is SKIPPED, not reported. After the Phase 2 correction, Zone and
 * Council both carry `null` because no standard Address element fits them. A rule that required
 * every level to be bound would fail the very form it was written to protect. A level missing from
 * the form entirely is skipped for the same reason: Region is optional since migration 085.
 */
export function lintFacilityAdminOrder(form: FormSchema): FormLintIssue[] {
  const ranked: { level: string; fieldId: string; rank: number }[] = [];

  for (const level of FACILITY_ADMIN_LEVELS) {
    const field = form.fields.find((f) => f.enabled && f.apiProperty === level);
    if (!field || !field.fhirPath) continue;
    const resolved = resolveFhirPath(field.fhirPath, form.fhirResourceType);
    if (!resolved) continue;
    const rank = addressRank(resolved);
    if (rank === -1) continue; // bound to something outside Address; not this rule's business
    ranked.push({ level, fieldId: field.id, rank });
  }

  const issues: FormLintIssue[] = [];
  for (let i = 1; i < ranked.length; i++) {
    const previous = ranked[i - 1]!;
    const current = ranked[i]!;
    if (current.rank > previous.rank) continue;
    issues.push({
      severity: 'error',
      code: 'facility-admin-order',
      message: `Administrative levels are bound out of order: "${previous.level}" is wider than "${current.level}" but binds ${ADDRESS_ORDER[previous.rank]}, which FHIR nests inside ${ADDRESS_ORDER[current.rank]}`,
      fieldId: current.fieldId,
    });
  }

  return issues;
}
