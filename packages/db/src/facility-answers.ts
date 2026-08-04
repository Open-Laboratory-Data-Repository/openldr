// Browser-safe subpath (@openldr/db/facility-answers) of the db package. This module must stay
// free of Node.js (node:crypto), database, or server dependencies — apps/studio imports
// CORE_FACILITY_KEYS directly from here (not from `@openldr/db`'s root, which pulls in `pg`/kysely
// and the rest of the server DB engine) so seeding a facility-edit form doesn't drag that into the
// web bundle. The only reference to `FacilityRecord` below is `import type`, which TypeScript
// erases entirely at compile time — any future edit that turns it (or adds any other import) into
// a runtime import will silently break the studio Vite bundle. Mirrors the same invariant on
// packages/forms/src/pure.ts.
import type { FacilityRecord } from './facility-registry-store';

/**
 * Columns a form answer may write.
 *
 * ⚠ `id`, `extras`, `managedOrigin` and `source` are deliberately ABSENT: they are the route's to
 * set. A form that could set `id` would let a client overwrite an imported row; one that could set
 * `managedOrigin` would let a lab-authored facility masquerade as central-managed and be deleted by
 * the next down-sync.
 */
export const CORE_FACILITY_KEYS: ReadonlySet<string> = new Set([
  'localCode', 'nationalCode', 'nationalSystem', 'name', 'level', 'ownership', 'status',
  'country', 'zone', 'region', 'district', 'council', 'ward', 'village',
  'addressText', 'phone', 'latitude', 'longitude',
]);

const NUMERIC_KEYS: ReadonlySet<string> = new Set(['latitude', 'longitude']);

/**
 * Narrow local guard for a picked coding answer — `{ system, code, display }` — WITHOUT importing
 * `@openldr/forms`'s `CodingAnswer`: `@openldr/forms` already depends on `@openldr/db`, so importing
 * back would invert the package graph. `display` is read separately below since it may be absent.
 */
function isCodingLikeAnswer(v: unknown): v is { system: string; code: string; display?: string | null } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && typeof (v as { system?: unknown }).system === 'string'
    && typeof (v as { code?: unknown }).code === 'string';
}

/** The shape the caller passes — `schema.fields`, narrowed. Deliberately NOT `FormSchema`:
 *  `@openldr/db` must not depend on `@openldr/forms`, which already depends on it. */
export interface AnswerField {
  id: string;
  apiProperty?: string | null;
}

export interface FacilityAnswerSplit {
  record: Partial<FacilityRecord>;
  extras: Record<string, unknown>;
}

/**
 * Split submitted form answers into registry columns and an `extras` bag.
 *
 * A field whose `apiProperty` names a column writes that column; EVERYTHING ELSE goes to `extras`,
 * including a field with no `apiProperty` at all (keyed by its field id). Nothing is silently
 * dropped — the seeded Facility form shipped several fields with no `apiProperty`, and losing an
 * operator's typed answer with no error is the failure this guards.
 *
 * Runs SERVER-side: a client cannot be trusted to decide which answers become indexed columns.
 */
export function splitFacilityAnswers(
  fields: AnswerField[],
  answers: Record<string, unknown>,
): FacilityAnswerSplit {
  const record: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};

  for (const field of fields) {
    if (!Object.hasOwn(answers, field.id)) continue;
    const raw = answers[field.id];
    const key = field.apiProperty ?? '';

    if (CORE_FACILITY_KEYS.has(key)) {
      if (NUMERIC_KEYS.has(key)) {
        const n = Number(String(raw ?? '').trim());
        record[key] = String(raw ?? '').trim() === '' ? null : (Number.isFinite(n) ? n : null);
        continue;
      }
      // A ValueSet-bound `reference` field submits `{ system, code, display }`, not a string — flatten
      // it to `display`, falling back to `code` when `display` is missing, null, OR blank/whitespace-
      // only (an empty display with a real code must not be dropped — `raw.display ?? raw.code` alone
      // does not catch `''`, since nullish coalescing does not treat an empty string as nullish), so
      // the column stays human-readable (existing reports group by the rendered level/status text)
      // and hand-typed rows stay homogeneous with picked ones. Only on this core-column branch:
      // `extras` is jsonb, where flattening would lose the code for nothing.
      const flattened = isCodingLikeAnswer(raw)
        ? (typeof raw.display === 'string' && raw.display.trim() !== '' ? raw.display : raw.code)
        : raw;
      const text = typeof flattened === 'string' ? flattened.trim() : flattened;
      if (text === '' || text === null || text === undefined) continue; // blank omitted, not stored as ''
      record[key] = text;
      continue;
    }

    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (text === '' || text === null || text === undefined) continue;
    extras[key || field.id] = text;
  }

  return { record: record as Partial<FacilityRecord>, extras };
}
