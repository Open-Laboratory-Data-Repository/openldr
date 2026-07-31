import type { FormSchema } from './schema/form-schema';
import type { AnswerState } from './answer-value';
import { isCodingAnswer, isEntityAnswer, isReferenceFieldType, resolveReferenceSource } from './reference-source';

export interface AnswerError {
  fieldId: string;
  label: string;
  reason: string;
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Validate filled answers against a form's field contract. Pure; never throws.
 * Checks required presence, select/multiselect option membership (unless
 * allowCustomValue), numeric min/max, and text maxLength. Disabled and group
 * container fields are skipped. Returns a flat list of errors ([] = valid).
 */
export function validateAnswers(model: FormSchema, answers: AnswerState): AnswerError[] {
  const errors: AnswerError[] = [];
  for (const f of model.fields) {
    if (f.enabled === false) continue;
    if (f.fieldType === 'group') continue;

    const value = answers[f.id];
    const push = (reason: string) => errors.push({ fieldId: f.id, label: f.displayLabel, reason });

    if (isEmpty(value)) {
      if (f.required) push('required');
      continue;
    }

    // Only a field that DECLARES a source has a list to select from. A sourceless
    // facility/organism/antibiogram renders a plain text input (FormRuntime) and lint only
    // warns about it, so a bare string is its correct answer — rejecting one made the seeded
    // Lab order form unsubmittable and made the ingest Form Validate node discard perfectly
    // good organism names. A sourceless `reference` field is already a publish-blocking lint
    // error, so nothing is weakened by gating on the same condition.
    if (isReferenceFieldType(f.fieldType) && resolveReferenceSource(f).ok) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (!isCodingAnswer(v) && !isEntityAnswer(v)) {
          push('must be selected from the list');
          break;
        }
      }
    } else if (f.fieldType === 'select' || f.fieldType === 'multiselect') {
      const options = f.valueSetOptions ?? [];
      if (!f.allowCustomValue && options.length > 0) {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          if (!options.some((o) => o.code === String(v))) push(`'${String(v)}' is not an allowed option`);
        }
      }
    } else if (f.fieldType === 'number') {
      const n = Number(value);
      if (Number.isNaN(n)) {
        push(`'${String(value)}' is not a number`);
      } else {
        if (f.constraints?.min !== undefined && n < f.constraints.min) push(`must be >= ${f.constraints.min}`);
        if (f.constraints?.max !== undefined && n > f.constraints.max) push(`must be <= ${f.constraints.max}`);
      }
    } else if (f.constraints?.maxLength !== undefined && String(value).length > f.constraints.maxLength) {
      push(`exceeds max length ${f.constraints.maxLength}`);
    }
  }
  return errors;
}
