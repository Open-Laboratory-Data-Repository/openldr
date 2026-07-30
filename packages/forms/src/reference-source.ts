import type { FormField } from './schema/form-schema';

/** What a reference field searches. Declared by the field; existence checked server-side. */
export type ReferenceSource =
  | { kind: 'coding'; mode: 'valueset'; url: string }
  | { kind: 'coding'; mode: 'codesystem'; system: string }
  | { kind: 'entity'; target: string };

export type ReferenceSourceResult =
  | { ok: true; source: ReferenceSource }
  | { ok: false; reason: 'no-source' };

/** A resolved coding answer (ValueSet / CodeSystem picker). */
export interface CodingAnswer { system: string; code: string; display: string | null }
/** A resolved entity answer (Patient and friends). */
export interface EntityAnswer { reference: string; display: string | null }

const trimmed = (v: string | undefined): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
};

/** True for identifiers that name a coding system rather than an entity type. */
function isCodingSystemId(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^urn:/i.test(target) || target.startsWith('cs-url-');
}

/**
 * Classify what a field declares. Pure, synchronous, browser-safe — it does NOT
 * check that the declared source exists. The server does that at search time, so a
 * form binding to a not-yet-installed terminology system stays publishable.
 */
export function resolveReferenceSource(field: FormField): ReferenceSourceResult {
  const url = trimmed(field.valueSetUrl);
  if (url) return { ok: true, source: { kind: 'coding', mode: 'valueset', url } };

  const target = trimmed(field.referenceTarget);
  if (target) {
    return isCodingSystemId(target)
      ? { ok: true, source: { kind: 'coding', mode: 'codesystem', system: target } }
      : { ok: true, source: { kind: 'entity', target } };
  }
  return { ok: false, reason: 'no-source' };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isCodingAnswer(v: unknown): v is CodingAnswer {
  return isRecord(v) && typeof v.system === 'string' && typeof v.code === 'string';
}

export function isEntityAnswer(v: unknown): v is EntityAnswer {
  return isRecord(v) && typeof v.reference === 'string';
}

/** Field types that carry a reference-family answer. */
export const REFERENCE_FIELD_TYPES = ['reference', 'facility', 'organism', 'antibiogram'] as const;

export function isReferenceFieldType(t: string): boolean {
  return (REFERENCE_FIELD_TYPES as readonly string[]).includes(t);
}
