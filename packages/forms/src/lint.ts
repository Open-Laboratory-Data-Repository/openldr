import type { FormSchema } from './schema/form-schema';
import { lintFhirPaths } from './lint-fhir-path';
import { lintFacilityAdminOrder } from './lint-facility-admin';
import { validateTemplateTargets } from './page-targets';
import { isReferenceFieldType, resolveReferenceSource } from './reference-source';

export type FormLintSeverity = 'error' | 'warning';

export interface FormLintIssue {
  severity: FormLintSeverity;
  code:
    | 'duplicate-id'
    | 'choice-missing-options'
    | 'visibility-missing-field'
    | 'dangling-group-id'
    | 'target-contract-violation'
    | 'reference-missing-source'
    | 'reference-ambiguous-source'
    | 'ambiguous-fhir-path'
    | 'unknown-fhir-path'
    | 'fhir-path-cardinality'
    | 'fhir-path-type-mismatch'
    | 'facility-admin-order';
  message: string;
  fieldId?: string;
  sectionId?: string;
}

export function lintFormSchema(form: FormSchema): FormLintIssue[] {
  const issues: FormLintIssue[] = [];
  const seenFieldIds = new Set<string>();
  const groupFieldIds = new Set<string>();

  // Build the set of all field ids and group-type field ids
  for (const field of form.fields) {
    if (field.fieldType === 'group') groupFieldIds.add(field.id);
  }

  /**
   * Two ENABLED fields bound to the same `fhirPath` with nothing to tell them apart.
   *
   * A FHIR resource holds many `identifier`s, many `telecom`s, many `address`es — the path alone
   * does not identify WHICH one, so two fields sharing it collide on write and are
   * indistinguishable on read. `fhirDiscriminator` (e.g. `{ system: … }`) is what separates them.
   *
   * ⛔ This shipped in the seeded Facility form: `Local ID` and `MFL ID` both bound
   * `identifier.value`, so the one form whose entire purpose is carrying the local↔national code
   * PAIR could not distinguish the two codes. It went unnoticed because nothing extracts by
   * `fhirPath` yet — the defect was latent, waiting for the extractor. Hence a lint rule rather
   * than a one-off fix.
   */
  const byPath = new Map<string, typeof form.fields>();
  for (const field of form.fields) {
    if (!field.enabled || !field.fhirPath) continue;
    const list = byPath.get(field.fhirPath) ?? [];
    list.push(field);
    byPath.set(field.fhirPath, list);
  }
  for (const [path, fields] of byPath) {
    if (fields.length < 2) continue;
    // A discriminator only disambiguates if the fields' discriminators actually DIFFER; two fields
    // carrying the same `{system: X}` are just as ambiguous as two carrying none.
    const keys = fields.map((f) => JSON.stringify(f.fhirDiscriminator ?? null));
    if (new Set(keys).size === fields.length) continue;
    for (const field of fields) {
      issues.push({
        severity: 'error',
        code: 'ambiguous-fhir-path',
        message: `Field "${field.id}" shares fhirPath "${path}" with ${fields.length - 1} other field(s) and no distinct fhirDiscriminator`,
        fieldId: field.id,
      });
    }
  }

  // Check fields
  for (const field of form.fields) {
    // Duplicate id
    if (seenFieldIds.has(field.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-id',
        message: `Duplicate field id "${field.id}"`,
        fieldId: field.id,
      });
    } else {
      seenFieldIds.add(field.id);
    }

    // select/multiselect missing options
    if (field.fieldType === 'select' || field.fieldType === 'multiselect') {
      const hasOptions = Array.isArray(field.valueSetOptions) && field.valueSetOptions.length > 0;
      const hasUrl = typeof field.valueSetUrl === 'string' && field.valueSetUrl.length > 0;
      if (!hasOptions && !hasUrl) {
        issues.push({
          severity: 'error',
          code: 'choice-missing-options',
          message: `Field "${field.id}" is a ${field.fieldType} but has neither valueSetOptions nor valueSetUrl`,
          fieldId: field.id,
        });
      }
    }

    // reference-family source declaration. `reference` is an error (it has no usable
    // fallback); facility/organism/antibiogram warn, because they degrade to a text
    // input rather than becoming unusable.
    if (isReferenceFieldType(field.fieldType)) {
      const resolved = resolveReferenceSource(field);
      if (!resolved.ok) {
        issues.push({
          severity: field.fieldType === 'reference' ? 'error' : 'warning',
          code: 'reference-missing-source',
          message: `Field "${field.id}" is a ${field.fieldType} but declares neither valueSetUrl nor referenceTarget`,
          fieldId: field.id,
        });
      } else if (field.valueSetUrl && field.referenceTarget) {
        issues.push({
          severity: 'warning',
          code: 'reference-ambiguous-source',
          message: `Field "${field.id}" sets both valueSetUrl and referenceTarget; valueSetUrl wins`,
          fieldId: field.id,
        });
      }
    }

    // dangling groupId
    if (field.groupId !== undefined) {
      if (!groupFieldIds.has(field.groupId)) {
        issues.push({
          severity: 'error',
          code: 'dangling-group-id',
          message: `Field "${field.id}" references group "${field.groupId}" which does not exist or is not a group-type field`,
          fieldId: field.id,
        });
      }
    }

    // dangling visibility condition fieldIds
    if (field.visibility) {
      for (const condition of field.visibility.conditions) {
        if (!seenFieldIds.has(condition.fieldId) && condition.fieldId !== field.id) {
          // Check against ALL field ids (pre-collected), not just previously seen
          issues.push({
            severity: 'error',
            code: 'visibility-missing-field',
            message: `Field "${field.id}" visibility condition references missing field "${condition.fieldId}"`,
            fieldId: field.id,
          });
          break; // report once per field
        }
      }
    }
  }

  // Re-check visibility with complete field id set (handles forward references)
  const allFieldIds = new Set(form.fields.map((f) => f.id));
  // Remove wrongly added visibility issues and redo them with the full set
  const visibilityIssuesBefore = issues.filter((i) => i.code === 'visibility-missing-field');
  // Clear the visibility issues we added during the loop (they used partial seenFieldIds)
  const issuesWithoutVisibility = issues.filter((i) => i.code !== 'visibility-missing-field');
  issues.length = 0;
  for (const issue of issuesWithoutVisibility) issues.push(issue);

  // Now re-add correct visibility issues using the full set
  for (const field of form.fields) {
    if (field.visibility) {
      const danglingConditions = field.visibility.conditions.filter((c) => !allFieldIds.has(c.fieldId));
      if (danglingConditions.length > 0) {
        issues.push({
          severity: 'error',
          code: 'visibility-missing-field',
          message: `Field "${field.id}" visibility condition references missing field "${danglingConditions[0]!.fieldId}"`,
          fieldId: field.id,
        });
      }
    }
  }

  // Section visibility
  for (const section of form.sections) {
    if (section.visibility) {
      const danglingConditions = section.visibility.conditions.filter((c) => !allFieldIds.has(c.fieldId));
      if (danglingConditions.length > 0) {
        issues.push({
          severity: 'error',
          code: 'visibility-missing-field',
          message: `Section "${section.id}" visibility condition references missing field "${danglingConditions[0]!.fieldId}"`,
          sectionId: section.id,
        });
      }
    }
  }

  // Target contract violations
  const violations = validateTemplateTargets(form.targetPages, form.fields);
  for (const v of violations) {
    issues.push({
      severity: 'error',
      code: 'target-contract-violation',
      message: `Page "${v.pageLabel}" requires fields for: ${v.missing.join(', ')}`,
    });
  }

  issues.push(...lintFhirPaths(form));
  issues.push(...lintFacilityAdminOrder(form));

  return issues;
}
