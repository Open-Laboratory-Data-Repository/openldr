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
        if (!resolved.ok || resolved.source.kind !== 'coding') continue;
        const input = resolved.source.mode === 'valueset'
          ? { valueSetUrl: resolved.source.url, code: v.code, system: v.system }
          : { system: v.system, code: v.code };
        try {
          const r = await deps.validateCode(input);
          if (!r.result) push(r.message);
        } catch (e) {
          push(`could not be checked: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Non-object values are `validateAnswers`' job (Task 4), not this one.
    }
  }

  return errors;
}
