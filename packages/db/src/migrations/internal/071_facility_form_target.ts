import type { Kysely } from 'kysely';

// Facility registry slice 2: repoint an EXISTING install's seeded Facility form at the new
// Facilities page, delivering the NEW eight-field schema that page actually needs.
//
// Seeded forms are create-if-absent, deduped by NAME (`upsertPublishedForms` in
// packages/bootstrap/src/seed.ts) and their `schema` is NEVER re-snapshotted once created —
// editing the sample in packages/forms/src/samples/forms.ts reaches fresh installs only. An
// install that already carries an OLD Facility form needs BOTH `target_pages` repointed AND the
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
// ⛔⛔ REVIEW ROUND 2: matching against a SINGLE `OLD_FIELDS` snapshot (the second cut) silently
// no-op'd on essentially every real install. THREE distinct eras of the seeded Facility form have
// shipped — each verified with `git show <sha>:packages/forms/src/samples/forms.ts`, not assumed:
//
//   Era 1  efde1594..0ef91c21~1  (2026-06-19 -> 06-21)          target_pages ['facilities'], PRE_DISCRIMINATOR_FIELDS
//   Era 2  0ef91c21..7b4d4d58~1  (2026-06-21 -> 08-04 09:17)    target_pages ['forms'],       PRE_DISCRIMINATOR_FIELDS
//   Era 3  7b4d4d58..4b7b181f~1  (2026-08-04 09:17 -> today)    target_pages ['forms'],       OLD_FIELDS
//
// Era 2 — six weeks — is essentially every real install. `OLD_FIELDS` (added by 7b4d4d58, "stop
// Local ID and MFL ID colliding on one fhirPath") only existed for a few hours before 4b7b181f moved
// the sample again, so matching ONLY Era 3's shape skipped Era 1 and Era 2 rows entirely: the
// Facilities page would show "no published facilities form" forever, silently, on every install that
// wasn't seeded in that few-hour window.
//
// Era 1 additionally already carries `target_pages: ['facilities']` — a guard that only accepted
// `target_pages === ['forms']` skipped it outright even though its FIELDS still need rewriting: the
// page now exists and renders the OLD fields, `hasCoreField` passes (its `fld-fac-name` carries
// `apiProperty: 'name'`), and every submission still reaches the code check and 400s ("a facility
// must have a local code or a national code"). So the guard must accept target_pages of EITHER
// `['forms']` (Eras 2/3: needs target_pages AND fields rewritten) OR `['facilities']` (Era 1: needs
// only fields rewritten, target_pages is already right) — see KNOWN_HISTORICAL_SHAPES below, which
// pairs each era's target_pages with ITS field shape rather than checking either independently. A
// FRESH install (post 4b7b181f) also has target_pages `['facilities']`, but its fields are
// NEW_FIELDS, not PRE_DISCRIMINATOR_FIELDS or OLD_FIELDS — so it never matches any of the three
// known combinations below and is correctly left alone.
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
// A row only ever matches when its (target_pages, schema.fields) PAIR deep-equals — property for
// property, not merely "every field id starts with fld-fac-" — one of the three known historical
// combinations in KNOWN_HISTORICAL_SHAPES below. Anything else (a relabelled field, a bound
// `valueSetUrl`, a flipped `required`, a disabled field, the fields deleted down to `[]`, or simply a
// shape from an era this migration doesn't know about) fails every comparison, which is deliberate:
// any of those means an operator has already put their own work into this form (or it's some
// future/unknown shape), and silently overwriting it (or silently republishing an unfinished draft —
// `[]` least of all counts as "untouched") would be worse than the page's "no published facilities
// form" empty state. `fields.length > 0` is checked explicitly first so an emptied `fields: []` —
// vacuously "every field matches" under a naive `.every()` — is never mistaken for untouched.
const PRE_DISCRIMINATOR_FIELDS: readonly unknown[] = [
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, apiProperty: 'name',
  },
  {
    // Era 1/2: no `fhirDiscriminator` yet (added by 7b4d4d58 — see OLD_FIELDS below) — Local ID and
    // MFL ID both wrote/read `identifier.value` with nothing to tell them apart.
    id: 'fld-fac-local-id', fhirPath: 'identifier.value', displayLabel: 'Local ID', description: null,
    fieldType: 'identifier', required: false, enabled: true, order: 1,
    cardinality: { min: 0, max: '1' }, apiProperty: 'localId',
  },
  {
    // Era 1/2: no `fhirDiscriminator` AND no `apiProperty` at all — this field didn't write
    // anywhere a facility record could read it back from.
    id: 'fld-fac-mfl-id', fhirPath: 'identifier.value', displayLabel: 'MFL ID', description: null,
    fieldType: 'identifier', required: false, enabled: true, order: 2,
    cardinality: { min: 0, max: '1' },
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'select', required: false, enabled: true, order: 3,
    cardinality: { min: 0, max: '1' },
    // Inert historical snapshot of what this field's option list looked like at the time, needed
    // ONLY for the equality check above and for down()'s exact restore — NOT new hardcoded clinical
    // vocabulary. The repo's "never hardcode a vocabulary" rule is about what CE writes going
    // forward (see NEW_FIELDS's 'level' field, which is free text); this is a frozen transcription
    // of what already shipped, same as the rest of this array.
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

// Era 3 shape: identical to PRE_DISCRIMINATOR_FIELDS except Local ID and MFL ID each carry a
// `fhirDiscriminator` (and MFL ID now carries an `apiProperty`), added by 7b4d4d58 ("stop Local ID
// and MFL ID colliding on one fhirPath"). Only ever co-occurred with `target_pages: ['forms']` — the
// target_pages flip to `['facilities']` and the move to NEW_FIELDS happened together in 4b7b181f, so
// (['facilities'], OLD_FIELDS) is not a combination that has ever existed on a real install and is
// deliberately absent from KNOWN_HISTORICAL_SHAPES below.
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
    // Inert historical snapshot (same option list as PRE_DISCRIMINATOR_FIELDS above) needed ONLY
    // for the equality check and down()'s exact restore — NOT new hardcoded clinical vocabulary.
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
// frozen snapshot of one release, not a live mirror. Pinned against the live sample from the OTHER
// side instead: NEW_FIELDS_SNAPSHOT is re-exported from packages/db/src/index.ts and
// packages/forms/src/samples/forms.test.ts asserts it still matches sampleForms' Facility fields, so
// a future sample edit that isn't also reflected here fails that test rather than silently
// desynchronising fresh-install forms from what this migration thinks "new" looks like.
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

interface HistoricalShape {
  readonly targetPages: readonly string[];
  readonly fields: readonly unknown[];
}

// The three (target_pages, schema.fields) combinations a real, un-edited install can carry — see
// the era table in the file-level comment above. Checked as PAIRS, not independently: Era 1's
// target_pages (['facilities']) also happens to be what a FRESH post-4b7b181f install has, and Era
// 3's fields (OLD_FIELDS) never co-occurred with target_pages ['facilities'] on any real install —
// pairing them is what keeps a fresh install (['facilities'] + NEW_FIELDS) from ever matching.
const KNOWN_HISTORICAL_SHAPES: readonly HistoricalShape[] = [
  { targetPages: ['facilities'], fields: PRE_DISCRIMINATOR_FIELDS }, // Era 1: efde1594..0ef91c21~1
  { targetPages: ['forms'], fields: PRE_DISCRIMINATOR_FIELDS },      // Era 2: 0ef91c21..7b4d4d58~1
  { targetPages: ['forms'], fields: OLD_FIELDS },                    // Era 3: 7b4d4d58..4b7b181f~1
];

/** Exported for the test file so it can build fixtures without duplicating (and risking drift
 *  from) the frozen literals above. New tests added for review round 2 deliberately do NOT use
 *  these — they hand-transcribe from git history directly, which is the only thing that can catch
 *  one of these constants itself being wrong. */
export const OLD_FIELDS_SNAPSHOT = OLD_FIELDS;
export const PRE_DISCRIMINATOR_FIELDS_SNAPSHOT = PRE_DISCRIMINATOR_FIELDS;
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
 *
 * Carries the FULL prior (target_pages, fields, status) rather than just status, because up() can
 * now rewrite rows from any of THREE different prior shapes (see KNOWN_HISTORICAL_SHAPES) — down()
 * restoring unconditionally to Era 3's OLD_FIELDS/['forms'] would be wrong for an Era 1 or Era 2
 * row. Storing exactly what up() saw makes down() a precise per-row inverse regardless of which
 * era the row came from.
 */
const MARKER_KEY = '__migration071';

interface Migration071Marker {
  /** The row's `status` immediately before up() rewrote it, so down() restores it exactly. */
  prevStatus: string;
  /** The row's `target_pages` immediately before up() rewrote it. */
  prevTargetPages: readonly string[];
  /** The row's `schema.fields` immediately before up() rewrote it. */
  prevFields: readonly unknown[];
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
  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(targets) || !Array.isArray(fields) || fields.length === 0) return;

  const match = KNOWN_HISTORICAL_SHAPES.find(
    (shape) =>
      stableStringify(targets) === stableStringify(shape.targetPages) &&
      stableStringify(fields) === stableStringify(shape.fields),
  );
  if (!match) return; // already moved, already new, or an operator's own edit — never guess

  const marker: Migration071Marker = { prevStatus: row.status, prevTargetPages: targets, prevFields: fields };
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
  // Unlike up(), this does NOT gate on `rows.length !== 1` — that guard exists in up() purely so it
  // never has to guess which of several same-named rows is "the" seeded one before writing to one.
  // down() has nothing to guess: it only ever acts on a row carrying MARKER_KEY, and up() stamps
  // that marker onto exactly the one row it rewrote (only reachable when rows.length===1 held at
  // that time) — an ambiguous multi-row state can never have gotten a marker stamped onto it in the
  // first place, so iterating every 'Facility' row here and filtering on the marker is equivalent to
  // up()'s guard, not looser than it.
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
    const prevSchema = { ...rest, fields: marker.prevFields, targetPages: marker.prevTargetPages };
    await db
      .updateTable('form_definitions')
      .set({
        target_pages: JSON.stringify(marker.prevTargetPages),
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
