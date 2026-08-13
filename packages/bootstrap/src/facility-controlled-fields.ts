import type { FacilityRecord, TerminologyAdminStore } from '@openldr/db';

// FAC-P1-05 (A2a): the CSV importer writes whatever string a national register contains straight
// into `level`/`status`/`country` — columns the facility FORM already treats as coded against three
// value sets that migrations 072/073 already seeded. This module is the missing layer between a
// source's raw strings and those existing canonical vocabularies. It resolves and rewrites; it does
// NOT wire into `importFacilities` (a later task) and it seeds nothing.

export const CONTROLLED_FIELDS = ['level', 'status', 'country'] as const;
export type ControlledField = (typeof CONTROLLED_FIELDS)[number];

/** The canonical value sets, already seeded — migration 072 for level/status, 073 for country.
 *  ⛔ A2 seeds NOTHING. If one of these is missing from an install, that field is reported as
 *  `notValidated` rather than failing the import. */
export const CONTROLLED_VALUE_SETS: Record<ControlledField, string> = {
  level: 'urn:openldr:valueset:facility-type',
  status: 'urn:openldr:valueset:location-status',
  country: 'urn:openldr:valueset:country',
};

/** `urn:openldr:` namespace shared with `FACILITY_REGISTRY_SYSTEM`/`DEFAULT_OBSERVED_FACILITY_SYSTEM`
 *  in `packages/db/src/facility-observed.ts`. `cs:facility-<field>:` rather than reusing that file's
 *  `fac_` feed prefix, because the thing being namespaced here is a CONTROLLED FIELD, not an ingest
 *  feed — a source can send both an unmapped `level` string and an unmapped `status` string, and
 *  those must resolve through two different coding systems even though they came from the same feed. */
const CONTROLLED_SYSTEM_PREFIX = 'urn:openldr:cs:facility-';

/** A tiny, dependency-free stable hash — the exact algorithm `facility-observed.ts`'s (private,
 *  unexported) `djb2Hex` uses, duplicated rather than imported so this module doesn't need
 *  `facility-observed.ts` to open up an internal for one four-line function. */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length.toString(16)}`;
}

/** Per-source observed system for a controlled field, e.g.
 *  `urn:openldr:cs:facility-level:urn_tz_hfr`. Mirrors `observedSystemForFeed`'s slugify-with-
 *  hash-fallback pattern (`packages/db/src/facility-observed.ts`) so a punctuation-only source name
 *  cannot collide with another's: non-alphanumeric runs collapse to one `_`, edges trim, and a
 *  source name that slugifies to nothing at all (e.g. `///`) falls back to a deterministic hash of
 *  the untrimmed string instead of colliding with every other punctuation-only source under the bare
 *  field prefix.
 *
 *  ⛔ `nationalSystem` IS A REGISTER'S CANONICAL URI (e.g. `urn:tz:hfr`) — the `url` of a
 *  `coding_systems` row marked as a facility register — and NEVER a label somebody typed. The
 *  slugification below LOWERCASES, while `idFor` (`packages/terminology/src/facility-csv.ts`) hashes
 *  its argument verbatim. MEASURED before this was gated: `HFR` and `hfr` produced two DIFFERENT
 *  facility ids while sharing this ONE namespace — one register, two identities, one mapping
 *  namespace, so a mapping saved under one spelling silently resolved values imported under the
 *  other. The import routes now refuse a `nationalSystem` that names no registered source
 *  (`apps/server/src/facilities-routes.ts`), so there is one spelling of a register to feed —
 *  ⚠ through the HTTP doors only: the CLI's `--national-system` is still free text until this
 *  slice's Task 11.
 *
 *  ⛔ The slugification STAYS. It is not the defect and removing it would produce an invalid system
 *  url: a URI carries `:` and `/`, and this value is a coding-system url in its own right, looked up
 *  by `term_mappings.from_system`. What changed is its INPUT, not its behaviour — do not "fix" the
 *  asymmetry by making `idFor` lowercase too, which would silently re-key every id already written. */
export function observedFieldSystem(field: ControlledField, nationalSystem: string): string {
  const trimmed = (nationalSystem ?? '').trim();
  const slug = trimmed
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const suffix = slug.length > 0 ? slug : djb2Hex(trimmed);
  return `${CONTROLLED_SYSTEM_PREFIX}${field}:${suffix}`;
}

export interface ControlledResolution {
  /** field -> raw source value -> canonical code. Absent entry = unmapped. */
  mapped: Record<ControlledField, Map<string, string>>;
  /** field -> distinct raw values with no mapping AND not already canonical. */
  unmapped: Record<ControlledField, string[]>;
  /** Fields with no seeded value set on this install — reported, never fatal. */
  notValidated: ControlledField[];
}

function emptyByField<T>(make: () => T): Record<ControlledField, T> {
  const out = {} as Record<ControlledField, T>;
  for (const field of CONTROLLED_FIELDS) out[field] = make();
  return out;
}

/**
 * Resolve every record's controlled fields against their canonical value sets, reading mappings
 * from `term_mappings` (via `termMappings.listOutgoing`) rather than its `concept_map_elements`
 * mirror.
 *
 * ⛔ Mapping resolution reads `term_mappings` via `listOutgoing`, not `concept_map_elements`:
 * term_mappings is AUTHORITATIVE and is the only one carrying `is_active`, so a deactivated mapping
 * must not resolve. `concept_map_elements` is its mirror.
 *
 * A raw value is classified exactly one of three ways, per field:
 *   - already canonical (present in the value set's expansion) → neither `mapped` nor `unmapped`,
 *     it needs no mapping at all.
 *   - an ACTIVE mapping resolves it → `mapped`.
 *   - anything else (no mapping, or only a deactivated one) → `unmapped`. This NEVER blocks and
 *     NEVER blanks: the raw value is written exactly as it is today (see `applyControlledFields`),
 *     so this whole layer is a strict superset of the previous behaviour plus a warning count.
 *
 * A field whose value set is not seeded on this install is reported in `notValidated` instead — for
 * every record, regardless of what raw values are present — and none of its values are classified
 * mapped/unmapped at all.
 */
export async function resolveControlledFields(
  admin: TerminologyAdminStore,
  nationalSystem: string,
  records: FacilityRecord[],
): Promise<ControlledResolution> {
  const mapped = emptyByField<Map<string, string>>(() => new Map());
  const unmapped = emptyByField<string[]>(() => []);
  const notValidated: ControlledField[] = [];

  for (const field of CONTROLLED_FIELDS) {
    // Distinct raw values only — a 14 000-row register repeats the same handful of level/status/
    // country strings, and there is no reason to look each one up (or list it) more than once.
    const rawValues = new Set<string>();
    for (const rec of records) {
      const v = rec[field];
      if (typeof v === 'string' && v.length > 0) rawValues.add(v);
    }
    if (rawValues.size === 0) continue;

    const vs = await admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[field]);
    if (!vs) {
      notValidated.push(field);
      continue;
    }
    const { codes } = await admin.valueSets.expand(vs.id);
    // ⛔ Codes AND displays. A picked answer reaches this column as its DISPLAY —
    // `splitFacilityAnswers` flattens `{system, code, display}` to `display` so the column stays
    // human-readable for reports that group on it (packages/db/src/facility-answers.ts:134-141).
    // Comparing against codes alone therefore refused the value set's OWN vocabulary: a facility
    // created by picking "Health Center" from the picker was rejected as non-canonical, and the one
    // hand-made facility on a live install carried `Level IA2 (Dispensary Laboratory)` and was
    // refused the same way. A `null` display contributes nothing — it is absence, not a matchable
    // empty string.
    const canonical = new Set<string>();
    for (const c of codes) {
      canonical.add(c.code);
      if (c.display !== null && c.display !== '') canonical.add(c.display);
    }

    const fromSystem = observedFieldSystem(field, nationalSystem);
    for (const raw of rawValues) {
      if (canonical.has(raw)) continue; // already canonical: neither mapped nor unmapped.
      const outgoing = await admin.termMappings.listOutgoing(fromSystem, raw);
      // ⛔ The `m.isActive` check is load-bearing: a DEACTIVATED mapping must not resolve. The
      // first ACTIVE mapping wins, matching `saveExclusive`'s invariant of at most one active
      // mapping per `(fromSystem, fromCode)` within a scope.
      const active = outgoing.find((m) => m.isActive);
      if (active) mapped[field].set(raw, active.toCode);
      else unmapped[field].push(raw);
    }
  }

  return { mapped, unmapped, notValidated };
}

/**
 * Rewrite a record's controlled fields to canonical codes, preserving each raw source value under
 * `extras.__source`.
 *
 * ⛔ Raw source values go in `facility_registry.extras`, NEVER in a concept's `properties`:
 * `terms.update` rewrites `properties` wholesale and would silently destroy them — the same reason
 * migration 077 chose a table over a properties key. See [terms-update-destroys-properties].
 *
 * ⛔ Unmapped NEVER blocks and NEVER blanks. A raw value with no mapping (or a value already
 * canonical) is left in the field EXACTLY as it is today — this function only ever rewrites a field
 * whose raw value resolved through `res.mapped`.
 */
export function applyControlledFields(rec: FacilityRecord, res: ControlledResolution): FacilityRecord {
  let out = rec;
  let source: Record<string, string> | undefined;

  for (const field of CONTROLLED_FIELDS) {
    const raw = out[field];
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const code = res.mapped[field].get(raw);
    if (code === undefined || code === raw) continue;
    if (out === rec) out = { ...rec }; // copy-on-write: never mutate the caller's record.
    out[field] = code;
    if (!source) source = { ...(rec.extras?.__source as Record<string, string> | undefined) };
    source[field] = raw;
  }

  if (source) {
    out = out === rec ? { ...rec } : out;
    out.extras = { ...out.extras, __source: source };
  }

  return out;
}
