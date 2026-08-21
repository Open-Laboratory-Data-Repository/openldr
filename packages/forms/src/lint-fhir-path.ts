import { isKnownFhirResourceType, lookupFhirPath } from '@openldr/fhir/paths';
import { resolveFhirPath } from './fhir-path';
import type { FormLintIssue } from './lint';
import type { FormSchema } from './schema/form-schema';

/**
 * Field types that can only ever write a scalar into the resource.
 *
 * Deliberately excludes `reference`, `select`, `multiselect`, `organism`, `antibiogram`, and
 * `facility`. Those produce a coding or an entity reference, and the shipped Facility form binds
 * a `reference` field to a `string` leaf (`address.country`), a `code` leaf (`status`), AND a
 * `CodeableConcept` leaf (`physicalType`). Constraining them by leaf type would fire on working
 * code. Also excludes `identifier`, which writes a scalar but into a structured element.
 */
const SCALAR_ONLY_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text', 'number', 'date', 'datetime', 'boolean', 'phone', 'email',
]);

/** Leaf types a scalar field type can legitimately write. Everything else is structured. */
const PRIMITIVE_LEAF_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'code']);

/** A numeric segment anywhere in the path, which pins an array element explicitly. */
const HAS_NUMERIC_SEGMENT = /\.\d+(\.|$)/;

/** Every `.<digits>` segment, so an indexed path can look itself up by its unindexed element. */
const NUMERIC_SEGMENT = /\.\d+(?=\.|$)/g;

/**
 * The three generic FHIR path rules, in one pass.
 *
 * Every rule here is gated on `isKnownFhirResourceType`. The generated path table covers nine
 * resource types; the builder's Resource Type picker offers 145
 * (`apps/studio/src/forms-builder/BuilderHeader.tsx`). `unknown-fhir-path` is an ERROR and lint
 * errors gate publish, so firing on an uncovered resource type would make an operator's form
 * permanently unpublishable through no fault of theirs. Silence is the correct answer for a
 * type we cannot check.
 */
export function lintFhirPaths(form: FormSchema): FormLintIssue[] {
  const issues: FormLintIssue[] = [];
  const resourceType = form.fhirResourceType;
  if (!resourceType || !isKnownFhirResourceType(resourceType)) return issues;

  for (const field of form.fields) {
    if (!field.enabled || !field.fhirPath) continue;

    const resolved = resolveFhirPath(field.fhirPath, resourceType);
    if (!resolved) continue; // unreachable while resourceType is known, but never guess a prefix

    // The generated table holds no indexed variants: `identifier.0.value` binds a real element
    // (array position 0 of `identifier`) but only `identifier.value` is a row in the table. Strip
    // numeric segments to find the element definition; `resolved` (with the index intact) is
    // still what the cardinality check tests and what every message quotes.
    const lookupKey = resolved.replace(NUMERIC_SEGMENT, '');

    const info = lookupFhirPath(lookupKey);
    if (!info) {
      issues.push({
        severity: 'error',
        code: 'unknown-fhir-path',
        message: `Field "${field.id}" binds "${resolved}", which is not an element of ${resourceType} in FHIR R4`,
        fieldId: field.id,
      });
      continue; // no leaf information, so the two rules below cannot be evaluated
    }

    if (info.isArray && !HAS_NUMERIC_SEGMENT.test(resolved) && !field.fhirDiscriminator) {
      issues.push({
        severity: 'warning',
        code: 'fhir-path-cardinality',
        message: `Field "${field.id}" binds "${resolved}", which passes through a repeating element, but names no fhirDiscriminator or index to say which one`,
        fieldId: field.id,
      });
    }

    if (SCALAR_ONLY_FIELD_TYPES.has(field.fieldType) && !PRIMITIVE_LEAF_TYPES.has(info.leafType)) {
      issues.push({
        severity: 'warning',
        code: 'fhir-path-type-mismatch',
        message: `Field "${field.id}" is a ${field.fieldType} but "${resolved}" is a ${info.leafType}, which a plain value cannot fill`,
        fieldId: field.id,
      });
    }
  }

  return issues;
}
