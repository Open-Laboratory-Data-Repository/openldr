import type { FormSchema } from './schema/form-schema';
import type { AnswerState } from './answer-value';
import type { AnswerError } from './validate-answers';
import { isCodingAnswer, isEntityAnswer, isReferenceFieldType, resolveReferenceSource } from './reference-source';

/** I/O this validator needs. Injected so the module stays free of store and HTTP handles. */
export interface ReferenceValidationDeps {
  validateCode(input: { valueSetUrl: string; code: string; system?: string } | { system: string; code: string }): Promise<{ result: boolean; message: string }>;
  exists(resourceType: string, id: string): Promise<boolean>;
}

const REFERENCE_RE = /^([A-Za-z]+)\/(.+)$/;

/**
 * Check that resolved reference answers point at things that exist. Async and I/O-bound,
 * deliberately separate from the pure `validateAnswers` — see the spec, §5. Never throws:
 * an unreachable dependency becomes a field error, because silently accepting an
 * unverifiable reference is the failure mode this whole feature exists to remove.
 */
export async function validateReferences(
  model: FormSchema,
  answers: AnswerState,
  deps: ReferenceValidationDeps,
): Promise<AnswerError[]> {
  const errors: AnswerError[] = [];

  for (const f of model.fields) {
    if (f.enabled === false) continue;
    if (!isReferenceFieldType(f.fieldType)) continue;

    const raw = answers[f.id];
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const push = (reason: string): void => { errors.push({ fieldId: f.id, label: f.displayLabel, reason }); };

    const resolved = resolveReferenceSource(f);

    for (const v of values) {
      if (isEntityAnswer(v)) {
        if (!resolved.ok) { push('field declares no reference source'); continue; }
        if (resolved.source.kind !== 'entity') {
          push(`'${v.reference}' is a reference but this field expects a coded value`);
          continue;
        }
        const m = REFERENCE_RE.exec(v.reference);
        if (!m) { push(`'${v.reference}' is not a valid reference`); continue; }
        try {
          if (!(await deps.exists(m[1]!, m[2]!))) push(`${v.reference} does not exist`);
        } catch (e) {
          push(`could not be checked: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }

      if (isCodingAnswer(v)) {
        if (!resolved.ok) { push('field declares no reference source'); continue; }
        if (resolved.source.kind !== 'coding') {
          push(`'${v.code}' is a coded value but this field expects a reference`);
          continue;
        }
        if (resolved.source.mode === 'codesystem' && v.system !== resolved.source.system) {
          push(`'${v.system}' is not the system this field accepts (${resolved.source.system})`);
          continue;
        }
        // The mismatch guard above ensures the systems are equal; use the field's system
        // here so that the code stays correct if that guard is ever relaxed.
        // Do not "simplify" this to v.system.
        const input = resolved.source.mode === 'valueset'
          ? { valueSetUrl: resolved.source.url, code: v.code, system: v.system }
          : { system: resolved.source.system, code: v.code };
        try {
          const r = await deps.validateCode(input);
          if (!r.result) push(r.message);
        } catch (e) {
          push(`could not be checked: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }
      // Non-object values are `validateAnswers`' job (Task 4), not this one.
    }
  }

  return errors;
}
