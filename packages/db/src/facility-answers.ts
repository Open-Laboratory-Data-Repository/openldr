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

/**
 * The four per-country administrative-area columns on `facility_registry`. Deliberately a closed
 * union, NOT `string` — `country` is a column too but is excluded on purpose (Task 4 binds it to
 * a ValueSet instead of deriving it from observed data). This type IS the whitelist:
 * `facility-registry-store.ts`'s `distinctAdminValues` can only ever be called with one of these
 * four literal column names, so a caller cannot smuggle an arbitrary column (`password`, `id`,
 * ...) into that query even by mistake — the check does not depend on a route remembering to
 * validate first.
 *
 * Lives in THIS browser-safe module (not `facility-registry-store.ts`, which imports `kysely` as a
 * runtime value) specifically so `apps/studio` can import it directly from
 * `@openldr/db/facility-answers` — the same zero-dependency subpath it already imports
 * `CORE_FACILITY_KEYS` through — instead of hand-duplicating the four literal names as its own
 * `FacilityAdminLevel` (see `apps/studio/src/api.ts`). One list, two consumers.
 */
export type FacilityAdminLevel = 'zone' | 'region' | 'district' | 'council';

/**
 * Single source of truth for the whitelist, so a caller can validate a request param against the
 * exact same list the type enforces, rather than re-typing the four names elsewhere.
 *
 * A plain `: readonly FacilityAdminLevel[]` annotation (what this used to be) only checks that
 * every array ELEMENT is a valid level — it does nothing to stop an element being dropped, so
 * deleting `'council'` from the array literal leaves `tsc` green while silently de-scoping it from
 * both the route's `?level=` whitelist (`apps/server/src/facilities-routes.ts`) and the store's own
 * scope loop (`distinctAdminValues`) — a legitimate `?level=council` request would 400, and
 * `council` would stop being applied as a scope filter, with no error anywhere.
 *
 * `FACILITY_ADMIN_LEVEL_SET`'s `Record<FacilityAdminLevel, true>` annotation is what actually
 * enforces completeness: a mapped type over a union requires EVERY member as a key and rejects any
 * key that isn't one, in both directions — remove `council: true` below and `tsc` reports it
 * missing; remove `'council'` from the `FacilityAdminLevel` union above and this object literal's
 * (now-extra) `council: true` key fails to compile. `FACILITY_ADMIN_LEVELS` is derived FROM this
 * object (not hand-typed alongside it) so there is exactly one place the four names are spelled.
 */
/**
 * ⛔ KEY ORDER IS LOAD-BEARING — it is the parent→child admin hierarchy, not a style choice.
 *
 * `FACILITY_ADMIN_LEVELS` is `Object.keys` of this literal, and the studio's suggestion hook
 * (`useFacilityAdminSuggestions`) scopes each level by the levels at a LOWER INDEX — Region is
 * suggested within the chosen Zone, District within Zone+Region, and so on. Alphabetising these
 * keys (`council, district, region, zone`) looks purely cosmetic and keeps `tsc` green, but it
 * INVERTS the cascade: a child would constrain its parent, and editing a fully-populated facility
 * would offer exactly one option per field — the value already in it. That was a real review
 * finding. The hook's tests assert exact scopes and would catch it; do not rely on that alone.
 */
const FACILITY_ADMIN_LEVEL_SET: Record<FacilityAdminLevel, true> = {
  zone: true,
  region: true,
  district: true,
  council: true,
};
export const FACILITY_ADMIN_LEVELS: readonly FacilityAdminLevel[] = Object.keys(
  FACILITY_ADMIN_LEVEL_SET,
) as FacilityAdminLevel[];

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
