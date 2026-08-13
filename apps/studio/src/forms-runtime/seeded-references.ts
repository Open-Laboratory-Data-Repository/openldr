import { isReferenceFieldType, resolveReferenceSource } from '@openldr/forms/pure';
import type { FormSchema, RuntimeAnswers } from './types';

/**
 * One candidate from a reference search, flattened to what matching needs.
 *
 * `code` is `null` for an entity-kind row — those have no code to match on, only a display and a
 * reference. Mirrors `ReferencePicker`'s own `toRows`, deliberately re-derived rather than imported:
 * that function also carries picker-only concerns (`key`, `secondary`) that matching has no use for.
 */
export interface ResolvableRow {
  /** The answer value to store when this row wins. */
  value: unknown;
  /** What the operator sees. Matched first, because the column stores displays. */
  display: string;
  /** The coded form. Matched second. `null` for an entity row. */
  code: string | null;
}

/**
 * The concept a stored string names, or `undefined` when it names none.
 *
 * ⛔ Ambiguity NEVER resolves. Two rows differing only in case are not a reason to pick one — a wrong
 * coding is worse than an unresolved field, because the operator can see and fix the second.
 *
 * Order: exact display, then exact code, then case-insensitive display. Display leads because
 * `splitFacilityAnswers` flattens a picked answer to its display
 * (packages/db/src/facility-answers.ts:134-141) — that is what is actually in the column. Code is
 * second so a column holding a code (an operator who typed one, or an older row) still resolves. The
 * case-insensitive pass is last because casing genuinely bites here: value-set status is compared
 * case-sensitively elsewhere in this repo and silently produces empty expansions.
 */
export function pickSeededMatch(raw: string, rows: ResolvableRow[]): unknown | undefined {
  const only = (matches: ResolvableRow[]): unknown | undefined =>
    (matches.length === 1 ? matches[0].value : undefined);

  const exactDisplay = only(rows.filter((r) => r.display === raw));
  if (exactDisplay !== undefined) return exactDisplay;

  const exactCode = only(rows.filter((r) => r.code !== null && r.code === raw));
  if (exactCode !== undefined) return exactCode;

  const lowered = raw.toLowerCase();
  return only(rows.filter((r) => r.display.toLowerCase() === lowered));
}

/**
 * Fields whose seeded answer is a bare string where a coding is required.
 *
 * The gate is deliberately IDENTICAL to `validate`'s (runtime.ts:47): reference-family field type
 * AND a resolvable source. A reference field with no source renders as a plain text input, so a
 * string in it is the correct answer and must not be looked up against a list that does not exist.
 */
export function fieldsNeedingResolution(
  schema: FormSchema, answers: RuntimeAnswers,
): { fieldId: string; raw: string }[] {
  const out: { fieldId: string; raw: string }[] = [];
  for (const field of schema.fields) {
    if (field.enabled === false) continue;
    if (!isReferenceFieldType(field.fieldType) || !resolveReferenceSource(field).ok) continue;
    // A BARE STRING is the whole condition. An answer that is already a coding or an entity is an
    // object, so this one check covers "needs resolving" and "is already resolved" together — which
    // is also what makes re-running this idempotent.
    const raw = answers[field.id];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    out.push({ fieldId: field.id, raw });
  }
  return out;
}
