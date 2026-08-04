# Facility Level + Status ValueSets — Design

**Goal:** an operator picks the facility **Level** and **Status** from a list instead of typing them,
so the registry stops accumulating typo variants of the same value.

**Origin:** slice 2 deliberately left `level` and `status` as free text, with the note that "the field
type supports `valueSetUrl`, so binding a ValueSet later is a form edit rather than a code change".
This is that follow-up. The user supplied Tanzania HFR's facility-type list (63 values, scraped from
the portal's select2 widget) and asked that `status` bind FHIR's `location-status`.

---

## 1. What is already true (measured, not assumed)

| Fact | Evidence |
|---|---|
| `FormField.valueSetUrl` exists and `resolveReferenceSource` turns it into `{kind:'coding', mode:'valueset', url}` | `packages/forms/src/schema/form-schema.ts:64`, `reference-source.ts` |
| `valueSetUrl` **wins over** `referenceTarget`; lint warns if both are set | `reference-source.ts`, [[specimen-picker-and-status-casing]] |
| A `reference` field renders `ReferencePicker` — a type-ahead search, which suits 63 options far better than a dropdown | `apps/studio/src/forms-runtime/FormRuntime.tsx` |
| `select` + `valueSetOptions` stores a **plain string** (`opt.code`); a `reference` field stores a **`{system, code, display}` object** | `FormRuntime.tsx:314-326` |
| Concept `status` is compared **case-sensitively against `'ACTIVE'`** — lowercase yields a *silently empty* expansion | [[specimen-picker-and-status-casing]], `filterConcepts` |
| `filterConcepts` **ignores the FHIR filter `op`**, so an `is-a` composed ValueSet matches nothing | same |
| The house pattern for a CE ValueSet is 6 coordinated table writes, seeded in a migration | `packages/db/src/migrations/internal/014_value_sets.ts` |
| 10 such ValueSets already exist: `urn:openldr:valueset:<slug>` with `resource_id` `vs-seed-<slug>` | dev DB `terminology_systems` |
| ⛔ **`location-status` has ZERO concepts.** `coding_systems` carries an `active: false` reference stub (`http://hl7.org/fhir/location-status`) and nothing else | dev DB probe |
| `upsertPublishedForms` never rewrites an existing form's schema — editing the sample reaches **fresh installs only** | `packages/bootstrap/src/seed.ts`, and it bit the dev DB today |

⛔ **The consequence of the `location-status` finding:** binding the Status field to
`http://hl7.org/fhir/ValueSet/location-status` today would produce a picker that finds nothing, and
it would fail **silently** — the exact failure mode the specimen picker hit. The vocabulary must be
seeded before the binding is worth anything.

---

## 2. What ships

### 2.1 Two seeded ValueSets (migration `072`)

Following `014_value_sets.ts`'s six writes exactly: `coding_systems` → `terminology_concepts` →
`value_sets` → `valueset_expansions` → `fhir_resources` → `terminology_systems`.

**Status** — `urn:openldr:valueset:location-status`, over FHIR's own system
`http://hl7.org/fhir/location-status` with FHIR's own three codes:

| code | display |
|---|---|
| `active` | Active |
| `suspended` | Suspended |
| `inactive` | Inactive |

The codes and system URL are FHIR's, satisfying "use the fhir location-status". We seed the concepts
because FHIR's R4 catalog entry in this database has none. The existing `coding_systems` row is left
alone apart from flipping `active` to true.

**Level** — `urn:openldr:valueset:facility-type` over a new CE system `urn:openldr:cs:facility-type`,
63 concepts. Codes are **our own** readable slugs (`level-ia2-dispensary-laboratory`), displays are
the HFR strings verbatim. Verified: 63/63 slugs unique, 63/63 displays unique.

⚠ **Not `urn:openldr:cs:local`.** 014's seeds all share that one flat code space and its dedup is
keyed on **code alone**, so a code reused across two seeds is silently skipped. 63 new codes in a
shared namespace is asking for exactly that. A dedicated system also lets a country replace the whole
vocabulary by importing over one URL.

⚠ `data-select2-id="84…146"` in the scraped HTML are **select2 widget artifacts**, assigned
sequentially at render time. They are not HFR identifiers and must never be used as codes.

### 2.2 The form fields

`level` and `status` become `fieldType: 'reference'` with `valueSetUrl` set, `required` unchanged
(both stay required), `apiProperty` unchanged (`level`, `status`).

### 2.3 The answer flattening

`splitFacilityAnswers` gains one rule: **a coding answer written to a core column is flattened to its
`display`.** Without it the picked `{system, code, display}` object reaches `facility_registry.level`
(a `text` column) and Postgres raises `22P02`, surfacing as a raw 500 — the type-lie Minor the slice-2
final review flagged, which this change would be the first thing to actually trigger.

**Why `display` and not `code`:** one rule, no per-field special-casing; the columns stay
human-readable so existing reports that group by `level`/`status` keep working; and rows typed by
hand before this change remain homogeneous with rows picked after it. The trade-off is recorded in §5.

### 2.4 Migration `072` also repoints the already-migrated form

`071` rewrote the Facility form's fields on installs it matched, and migrations never re-run. So
`072` must swap the `level` and `status` fields on those rows, guarded — as `071` was — on an exact
match against `071`'s frozen `NEW_FIELDS` snapshot, so an operator-edited form is left alone.

---

## 3. The edit round-trip (checked, because it was the most likely thing to sink this)

`ReferencePicker` tolerates a value that is not an object: `labelOf` falls back to the value's string
form, and the trigger renders that label. So:

- Editing a facility whose `level` is a hand-typed string shows that string in the picker.
- Re-submitting without touching the field leaves the string unchanged in the column.
- Picking a new value yields a coding, which §2.3 flattens to its display.

No lossy re-hydration step is needed, and pre-existing free-text values are never destroyed.

---

## 4. Testing

- `splitFacilityAnswers`: a coding answer flattens to display; a bare string passes through; a coding
  answer for a **non-core** key still lands in `extras` unflattened.
- Migration `072`: seeds both ValueSets idempotently; concepts are written with **UPPERCASE** status;
  repoints a form matching `071`'s `NEW_FIELDS`; **leaves an operator-edited form alone**; re-running
  `up()` twice is a no-op.
- An expansion test proving each ValueSet actually returns its concepts — the guard against the
  silent-empty-expansion failure mode.
- The seeded sample form: `level`/`status` carry `valueSetUrl`, and every `apiProperty` is still in
  `CORE_FACILITY_KEYS`.
- ⚠ `packages/db/src/migrations/migrations.test.ts` pins the exact ordered migration list and lives
  one directory **above** `migrations/internal/` — `072` must be appended there.

---

## 5. Deliberately not in scope

- **No FHIR `Location` export.** Nothing writes Location resources from this form today (the
  extractor only consumes ServiceRequest/Observation paths). When one is added it must emit the
  ValueSet **code**, recovering it from the stored display — unique, so the lookup is sound. Storing
  display rather than code is the one place this design trades FHIR-literalness for column
  readability, and this is where that debt comes due.
- **No back-fill of existing rows.** Facilities already carrying typo'd free text keep it; the picker
  only constrains new entry. A reconciliation pass belongs with the 23-`performer` work.
- **`zone`, `region`, `district`, `council` stay free text.** They are country-specific hierarchies
  with no bounded vocabulary; binding them is a per-country terminology import, not a code change.
- **The Tanzania list is a starting point, not a CE-wide standard.** It ships as seeded terminology
  precisely so another country replaces it by importing over `urn:openldr:valueset:facility-type`
  rather than editing CE source.

Related: [[facility-registry-workstream]], [[specimen-picker-and-status-casing]],
[[dont-hardcode-use-terminology]], [[terminology-data]].
