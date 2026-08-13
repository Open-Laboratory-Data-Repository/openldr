import {
  isCodingAnswer,
  isEntityAnswer,
  isMultiValued,
  isReferenceFieldType,
  resolveReferenceSource,
  visibleFieldIds as libVisibleFieldIds,
} from '@openldr/forms/pure';
import type { FormField, FormSchema, RuntimeAnswers } from './types';

// ── Visibility ────────────────────────────────────────────────────────────────

/** Delegate to the library helper (takes the whole schema). */
export function visibleIds(schema: FormSchema, answers: RuntimeAnswers): Set<string> {
  return libVisibleFieldIds(schema, answers as Record<string, unknown>);
}

// ── Validation ────────────────────────────────────────────────────────────────

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Client-side validation. Returns per-field error messages for visible fields
 * that fail required / cardinality / numeric constraints.
 */
/**
 * @param exemptReferenceIds Reference fields whose answer this submission did NOT touch — it is
 *   still exactly the value that was seeded from storage. Their "must be a coding" check is skipped.
 *
 *   ⛔ WHY. A stored reference value is a plain string (the column is `text`, and
 *   `splitFacilityAnswers` flattens a coding to its display), and some of those strings are not in
 *   the value set at all — the facility importer writes an unmapped value through DELIBERATELY, and
 *   mapping is optional by design. Without this exemption, renaming an imported facility demanded
 *   the operator first re-pick a level they never entered: 3788 of 3788 Zambia rows were uneditable
 *   for that reason. Measured 2026-08-13.
 *
 *   This mirrors the rule the facilities route already follows — check only what this submission
 *   changed. A value the operator DID pick is an object and never needs the exemption; a value they
 *   changed is no longer equal to its seed and so is not exempt.
 */
export function validate(
  schema: FormSchema,
  answers: RuntimeAnswers,
  exemptReferenceIds: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const visible = visibleIds(schema, answers);
  const errors: Record<string, string> = {};

  for (const field of schema.fields) {
    if (!visible.has(field.id)) continue;

    const raw = answers[field.id];
    const values = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((v) => !isEmpty(v));

    if (field.required && values.length === 0) {
      errors[field.id] = `field ${field.id} is required`;
      continue;
    }

    // A reference answer must be an object the picker produced — but only where a picker was
    // actually rendered. FormRuntime falls back to a text input for a reference-family field
    // that declares no source, so demanding an object there pointed the user at a list that
    // does not exist. Gate on the same condition FormRuntime uses to choose the control.
    if (isReferenceFieldType(field.fieldType) && resolveReferenceSource(field).ok && values.length > 0
      && !exemptReferenceIds.has(field.id)) {
      if (values.some((v) => !isCodingAnswer(v) && !isEntityAnswer(v))) {
        errors[field.id] = 'select a value from the list';
        continue;
      }
    }

    // Numeric constraints (number fieldType)
    if (field.fieldType === 'number' && values.length > 0) {
      const n = Number(values[0]);
      if (!Number.isFinite(n)) {
        errors[field.id] = `field ${field.id} must be a number`;
        continue;
      }
      if (field.constraints?.min !== undefined && n < field.constraints.min)
        errors[field.id] = `field ${field.id} must be ≥ ${field.constraints.min}`;
      if (field.constraints?.max !== undefined && n > field.constraints.max)
        errors[field.id] = `field ${field.id} must be ≤ ${field.constraints.max}`;
    }

    // Cardinality (min/max items)
    const cardMin = field.cardinality?.min;
    const cardMax = field.cardinality?.max;
    if (cardMin !== undefined && values.length < cardMin)
      errors[field.id] = `field ${field.id} requires at least ${cardMin} value(s)`;
    if (cardMax !== undefined && cardMax !== '*' && values.length > Number(cardMax))
      errors[field.id] = `field ${field.id} allows at most ${cardMax} value(s)`;

    // select: value must be in valueSetOptions
    if ((field.fieldType === 'select' || field.fieldType === 'multiselect') && field.valueSetOptions && values.length > 0) {
      const codes = new Set(field.valueSetOptions.map((o) => o.code));
      for (const v of values) {
        if (!codes.has(String(v))) {
          errors[field.id] = `field ${field.id} value '${String(v)}' not in options`;
          break;
        }
      }
    }
  }

  return errors;
}

// ── Clean answers ─────────────────────────────────────────────────────────────

/**
 * Drop hidden fields and empty values. Preserves arrays for repeatable fields.
 */
export function cleanAnswers(schema: FormSchema, answers: RuntimeAnswers): RuntimeAnswers {
  const visible = visibleIds(schema, answers);
  const out: RuntimeAnswers = {};

  for (const field of schema.fields) {
    if (!visible.has(field.id)) continue;
    const raw = answers[field.id];
    const values = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((v) => !isEmpty(v));
    if (values.length === 0) continue;
    // Same predicate as the picker and the serializer. Collapsing a multi-valued field to
    // values[0] here silently dropped every test after the first on a Lab order.
    out[field.id] = isMultiValued(field) ? values : values[0];
  }

  return out;
}

// ── Label helpers ─────────────────────────────────────────────────────────────

/** Resolve a field's display label, optionally checking translations. */
export function fieldLabel(field: FormField, lang?: string): string {
  if (lang && field.translations?.[lang]?.label) return field.translations[lang].label!;
  return field.displayLabel;
}

// ── Child field lookup ────────────────────────────────────────────────────────

/** Return the ordered child fields for a group field. */
export function groupChildren(schema: FormSchema, groupId: string): FormField[] {
  return schema.fields.filter((f) => f.groupId === groupId).sort((a, b) => a.order - b.order);
}
