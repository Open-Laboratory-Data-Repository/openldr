import type { Kysely } from 'kysely';

// Facility registry slice 2: repoint an EXISTING install's seeded Facility form at the new
// Facilities page, delivering the NEW eight-field schema that page actually needs.
//
// Seeded forms are create-if-absent, deduped by NAME (`upsertPublishedForms` in
// packages/bootstrap/src/seed.ts) and their `schema` is NEVER re-snapshotted once created —
// editing the sample in packages/forms/src/samples/forms.ts reaches fresh installs only. An
// install that already carries the OLD Facility form needs BOTH `target_pages` repointed AND the
// `schema` rewritten:
//
// ⛔ Repointing `target_pages` alone (the first cut of this migration) delivered a form that could
// never save a facility. The OLD form's fields are `name`/`localId`/`mflId` and five fields with NO
// `apiProperty` at all — none of them write `localCode` or `nationalCode`
// (`packages/db/src/facility-answers.ts`'s CORE_FACILITY_KEYS), so every submission through the
// repointed page 400'd ("a facility must have a local code or a national code") forever. Rewriting
// `schema.fields` to the NEW eight fields (all carrying an `apiProperty` that IS a core key) is what
// makes the page usable, not just visible.
//
// ⚠ `schema.targetPages` must be written to match the `target_pages` column, not just the column
// alone. `FormBuilderPage.tsx` loads `schema` and, on save, writes `targetPages: schema.targetPages`
// back to the column — so if the two disagreed, an operator opening the form and saving ANY edit
// would silently revert the repoint (the target picker would even show "Forms" the whole time).
//
// ⚠ Matches by NAME ('Facility'), not by a hardcoded form_definitions.id. Ids only became
// deterministic (`form-sample-facility`) in commit ede345a7 (2026-07-30); that change shipped no
// migration to rename pre-existing rows, so an install seeded BEFORE it still carries a random
// `form-<uuid>`. Matching by name is also what the seeder itself treats as the row's identity —
// `upsertPublishedForms` dedupes on `existingByName` — so this recognises exactly the row the
// seeder itself considers "the" Facility form, regardless of which id-generation era created it.
// If more than one row is named 'Facility' (never true for a seeded install, but not enforced by a
// DB constraint), the match is ambiguous and nothing is touched — no guessing which one is "the"
// seeded form.
//
// It only touches a row that still looks EXACTLY like the OLD shipped seed: `target_pages` is
// still `['forms']` AND `schema.fields` deep-equals `OLD_FIELDS` below, property for property —
// not merely "every field id starts with fld-fac-". A relabelled field, a bound `valueSetUrl`, a
// flipped `required`, a disabled field, or the fields deleted down to `[]` all fail that equality,
// which is deliberate: any of those means an operator has already put their own work into this
// form, and silently overwriting it (or silently republishing an unfinished draft — `[]` least of
// all counts as "untouched") would be worse than the page's "no published facilities form" empty
// state. `fields.length > 0` is checked explicitly first so an emptied `fields: []` — vacuously
// "every field matches" under a naive `.every()` — is never mistaken for untouched.
const OLD_FIELDS: readonly unknown[] = [
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, apiProperty: 'name',
  },
  {
    // Mirrors @openldr/forms's LOCAL_FACILITY_SYSTEM (packages/forms/src/samples/forms.ts).
    // packages/db cannot import that constant — @openldr/forms depends on @openldr/db, not the
    // other way around — and this is a frozen historical snapshot regardless.
    id: 'fld-fac-local-id', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:local' },
    displayLabel: 'Local ID', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 1,
    cardinality: { min: 0, max: '1' }, apiProperty: 'localId',
  },
  {
    id: 'fld-fac-mfl-id', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:national' },
    displayLabel: 'MFL ID', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 2,
    cardinality: { min: 0, max: '1' }, apiProperty: 'mflId',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'select', required: false, enabled: true, order: 3,
    cardinality: { min: 0, max: '1' },
    valueSetOptions: [
      { code: 'national', display: 'National' },
      { code: 'regional', display: 'Regional' },
      { code: 'district', display: 'District' },
      { code: 'facility', display: 'Facility' },
    ],
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'text', required: false, enabled: true, order: 4,
    cardinality: { min: 0, max: '1' },
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.district', displayLabel: 'District', description: null,
    fieldType: 'text', required: false, enabled: true, order: 5,
    cardinality: { min: 0, max: '1' },
  },
  {
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'text', required: false, enabled: true, order: 6,
    cardinality: { min: 0, max: '1' },
  },
  {
    id: 'fld-fac-phone', fhirPath: 'telecom.value', displayLabel: 'Phone', description: null,
    fieldType: 'phone', required: false, enabled: true, order: 7,
    cardinality: { min: 0, max: '1' },
  },
];

// Frozen snapshot of the NEW field set this release ships (packages/forms/src/samples/forms.ts,
// as of this release). Copied, not imported — packages/db must not depend on @openldr/forms (forms
// already depends on db; importing back would invert that), and importing the CURRENT sample would
// silently change this migration's meaning every time the sample is later edited. A migration is a
// frozen snapshot of one release, not a live mirror.
const NEW_FIELDS: readonly unknown[] = [
  {
    id: 'fld-fac-local-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:local' },
    displayLabel: 'Facility code', description: null, fieldType: 'identifier',
    required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
    apiProperty: 'localCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 1,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'text', required: true, enabled: true, order: 2,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
  },
  {
    id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
    fieldType: 'text', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'text', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
    fieldType: 'text', required: true, enabled: true, order: 5,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    // status/level stay FREE TEXT — see packages/forms/src/samples/forms.ts. Never bake an option
    // list in here; that would inline a clinical/administrative vocabulary into source.
    id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
    fieldType: 'text', required: true, enabled: true, order: 6,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'text', required: true, enabled: true, order: 7,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
  },
];

const NEW_TARGET_PAGES: readonly string[] = ['facilities'];

/** Exported for the test file so it can build fixtures without duplicating (and risking drift
 *  from) the frozen literals above. */
export const OLD_FIELDS_SNAPSHOT = OLD_FIELDS;
export const NEW_FIELDS_SNAPSHOT = NEW_FIELDS;

/**
 * Key this migration stamps into the persisted `schema` jsonb when (and only when) it rewrites a
 * row, so `down()` can tell "this row was rewritten BY up()" apart from "this row reached the
 * identical target_pages/status/fields some other way" — which is otherwise impossible: a FRESH
 * install seeded after this release lands on exactly the same target_pages (['facilities']),
 * status ('published') and fields (NEW_FIELDS) as a legacy install up() just repointed, so content
 * alone cannot distinguish them. `FormSchema` (zod) parses with unknown keys stripped by default
 * (`normalizeFormSchema` in @openldr/forms → `FormSchema.parse`), so the FIRST time this form is
 * loaded and saved through the builder, the marker silently disappears — which is exactly the
 * right behaviour: from that point on the row carries an operator's own save, not just this
 * migration's rewrite, and down() must leave it alone.
 */
const MARKER_KEY = '__migration071';

interface Migration071Marker {
  /** The row's `status` immediately before up() rewrote it, so down() restores it exactly. */
  prevStatus: string;
}

export async function up(db: Kysely<any>): Promise<void> {
  const rows = await db
    .selectFrom('form_definitions')
    .select(['id', 'name', 'status', 'target_pages', 'schema'])
    .where('name', '=', 'Facility')
    .execute();
  if (rows.length !== 1) return; // none seeded here, or ambiguous — never seen in practice, but don't guess
  const row = rows[0]!;

  const targets = typeof row.target_pages === 'string' ? JSON.parse(row.target_pages) : row.target_pages;
  if (!Array.isArray(targets) || targets.length !== 1 || targets[0] !== 'forms') return; // already moved or customised

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  const untouched = Array.isArray(fields) && fields.length > 0 && stableStringify(fields) === stableStringify(OLD_FIELDS);
  if (!untouched) return;

  const marker: Migration071Marker = { prevStatus: row.status };
  const nextSchema = {
    ...(schema ?? {}),
    fields: NEW_FIELDS,
    targetPages: NEW_TARGET_PAGES,
    [MARKER_KEY]: marker,
  };

  await db
    .updateTable('form_definitions')
    .set({
      target_pages: JSON.stringify(NEW_TARGET_PAGES),
      status: 'published',
      schema: JSON.stringify(nextSchema),
    } as never)
    .where('id', '=', row.id)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  const rows = await db
    .selectFrom('form_definitions')
    .select(['id', 'schema'])
    .where('name', '=', 'Facility')
    .execute();

  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration071Marker | undefined;
    // No marker: either up() never touched this row (a legacy row left alone, an operator's own
    // form, or a fresh install that was already ['facilities'] from the seed — indistinguishable
    // from a migrated row by content alone), or an operator has since loaded and saved the form
    // through the builder, which strips unknown schema keys and so already dropped the marker.
    // Either way, this is not this migration's to touch.
    if (!marker) continue;

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: OLD_FIELDS, targetPages: ['forms'] };
    await db
      .updateTable('form_definitions')
      .set({
        target_pages: JSON.stringify(['forms']),
        status: marker.prevStatus,
        schema: JSON.stringify(prevSchema),
      } as never)
      .where('id', '=', row.id)
      .execute();
  }
}

/** Order-preserving, object-key-order-insensitive deep equality via stable stringification —
 *  mirrors @openldr/forms's lifecycle.ts `stableStringify`/`sortValue` (not imported, same reason
 *  as OLD_FIELDS/NEW_FIELDS above: packages/db must not depend on @openldr/forms). */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
