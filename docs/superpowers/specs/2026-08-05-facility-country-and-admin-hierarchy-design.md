# Facility Country ValueSet + derived admin hierarchy — Design

**Goal:** stop operators typing the **Country** and the four admin-chain levels
(**zone / region / district / council**) by hand, without hardcoding any country's geography into
CE source.

**Origin:** follow-up to the Level/Status ValueSets slice. The user asked for Country to use
ISO 3166 and asked how a per-country admin hierarchy should work, proposing it be derived from the
facility list rather than hardcoded. That proposal is adopted (§3).

---

## 1. Country

### 1.1 ⛔ ISO 3166 is present in CE and completely unusable — measured, not assumed

`value_sets` carries all three HL7 ValueSets from the bundled R4 catalog, `status: 'active'`:
`iso3166-1-2`, `iso3166-1-3`, `iso3166-1-N`. Binding to any of them today fails **four** ways at
once, every one of them silent:

| Check | Result |
|---|---|
| `valueset_expansions` rows for all three | **0** |
| `terminology_concepts` under `urn:iso:std:iso:3166` | **0** — the CodeSystem was never loaded |
| Their `compose` | `{"filter":[{"op":"regex","value":"[A-Z]{3}","property":"code"}]}` — and `filterConcepts` **ignores the filter `op`** |
| Present in `terminology_systems` (what the picker resolves by URL) | **no** |

So this repeats the `location-status` lesson: a registered, `active` ValueSet in the R4 catalog is
**not** evidence that anything can expand it. We seed our own enumerated set.

### 1.1b ⛔ CLDR is NOT a safe substitute — measured

Before settling on a source I tested deriving the list from Node's `Intl.DisplayNames` (CLDR).
**It is unusable for ISO 3166-1** and would have shipped a subtly wrong vocabulary:

- It resolves **280** two-letter codes; removing aggregates/exceptionally-reserved leaves **266**,
  and removing formerly-assigned codes still leaves **255** — never 249. Converging by removing
  exclusions until the count matched would be fitting to a target, not sourcing from an authority.
- Worse, **CLDR aliases withdrawn codes to modern names**: `AN`→"Curaçao", `ZR`→"Congo - Kinshasa",
  `SU`→"Russia", `YU`→"Serbia". A derived list therefore contains **duplicate country names under
  different codes**.

⇒ The country list must come from a real ISO 3166 dataset, not be improvised.

### 1.1c The source (user-supplied, verified)

`https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes` — `all/all.csv`, public domain,
carrying `name`, `alpha-2`, `alpha-3` and the numeric code.

Verified on fetch: **249 rows, 249 unique alpha-3, 249 unique alpha-2, 249 unique names, 0
malformed alpha-3 codes.** 249 is exactly ISO 3166-1's officially-assigned count.

The CSV is **committed as a repo fixture** (`packages/db/fixtures/iso3166/`) with its provenance,
so the seed is auditable and reproducible. The migration inlines the 249 pairs as frozen literals
(a migration must never read a moving file), and a test asserts the inlined literals still equal
the fixture — the same drift guard used for the facility-form field snapshot.

⚠ **Six display names carry diacritics** — `Åland Islands`, `Côte d'Ivoire`, `Curaçao`, `Réunion`,
`Saint Barthélemy`, `Türkiye`. The migration file must be UTF-8 and these must round-trip intact.
Mangling them is silent and only visible to an operator scrolling the picker.

⚠ Names are ISO's official English short names, so they are formal (`Tanzania, United Republic of`;
`Korea, Republic of`; `Bolivia, Plurinational State of`) rather than colloquial. Use them verbatim:
they are the authoritative name for the code, and unambiguous. Do not "tidy" them to CLDR's
friendlier forms — that would reintroduce a second, disagreeing source.

### 1.2 What ships

- **Concepts** seeded into FHIR's real system URL **`urn:iso:std:iso:3166`**, using **alpha-3**
  codes (`TZA`) with the ISO short name as display (`United Republic of Tanzania`).
  ⭐ Seeding into FHIR's own system URL rather than a `urn:openldr:cs:*` one is deliberate and
  forward-compatible: that system legitimately holds alpha-2, alpha-3 **and** numeric codes — which
  is precisely why FHIR ships three regex-filtered ValueSets over it — so a later import of the
  genuine CodeSystem aligns with our codes instead of colliding.
- **ValueSet** `urn:openldr:valueset:country`, enumerating the concepts (no `filter`).
  ⚠ We do **not** overwrite `http://hl7.org/fhir/ValueSet/iso3166-1-3`. That is an HL7-published
  definition; redefining its compose in a local migration would be wrong. We add ours alongside.
- **The field:** `fld-fac-country` → `fieldType: 'reference'`, `valueSetUrl:
  'urn:openldr:valueset:country'`. `fhirPath` stays `address.country`, `apiProperty` stays `country`.

### 1.3 Why alpha-3, not alpha-2

⭐ The source carries **both**, verified unique, so this choice now costs nothing in accuracy — it
is decided purely on which standard fits the element.


`Location.address.country` is `Address.country` — a plain string element in R4 with **no binding**,
carrying only the comment that "ISO 3166 3 letter codes can be used in place of a human readable
country name." That is the only steer FHIR gives, and it says three. WHO/GHO health reporting also
keys on alpha-3. Since `splitFacilityAnswers` stores the **display**, the operator and every report
see the country name either way — the code choice only fixes the ValueSet's identity, so matching
FHIR's own guidance is the tie-breaker.

⚠ `Address.country` is **not** `Location.status`. They are unrelated elements; the Status field
(`fhirPath: 'status'`) binds operational state (`active`/`suspended`/`inactive`) and has no
geographic meaning.

---

## 2. Why the admin chain is NOT a ValueSet

`zone / region / district / council` are per-country and, for Tanzania, ~5 zones / 31 regions /
~184 districts. Four authored vocabularies per country, for values **the facility register already
contains**, maintained forever. The settled model design
(`2026-08-04-facility-registry-model-design.md`) also chose these as **real columns, free text, not
FKs** — "anything a report groups by must be indexable" — so a parent-FK `admin_areas` table would
contradict a decision already made.

---

## 3. The admin chain is DERIVED from the registry, and cascades

### 3.1 The mechanism

A distinct-values endpoint over `facility_registry`, scoped by the parent levels already chosen:

```
GET /api/facilities/admin-values?level=district&region=Dodoma&country=United%20Republic%20of%20Tanzania
→ { values: [{ value: 'Chamwino', count: 42 }, …] }
```

The form field renders a **combobox**: it suggests, ranked by frequency, but still accepts a value
that is not in the list. An unlisted district must never be blocked — a new facility in a newly
gazetted district has to be enterable on day one.

### 3.2 ⭐ Why this is better than it first appears: the CSV importer is the bootstrap

Slice 1 shipped `parseFacilityCsv`, which populates all four columns in bulk. Import a national
register and every level's suggestions fill themselves with real, country-specific values —
**no vocabulary to author, and it is per-country by construction.** Cascading falls out of the same
query (`distinct district WHERE region = <chosen>`), so the hierarchy *emerges from the data*
instead of being declared anywhere.

### 3.3 Honest weaknesses

1. **It learns typos.** A misspelling entered once becomes a permanent suggestion. Mitigations:
   rank by frequency and show counts, so `Dodoma (142)` visibly outranks `Dodomaa (1)`; and the
   reconciliation screen (out of scope) is the eventual cleanup path.
2. **It knows only combinations already used**, so it cannot reject a district that does not
   genuinely belong to the chosen region — only suggest ones that have co-occurred.
3. **Empty on a fresh install** with no facilities, degrading to free text. Correct: there is
   nothing truthful to suggest yet.
4. A parent chosen as free text that matches nothing yields an empty child list. The combobox must
   make "no suggestions" visibly different from "loading" and never block typing.

---

## 4. What has to be built (none of it exists)

- **No distinct-values endpoint exists** anywhere in the repo.
- **No field type does "suggest, but accept anything new."** `reference` requires a resolvable
  coding/entity answer and stores an object; `select` accepts only its enumerated options. This
  needs a new `FieldType` (e.g. `'suggest'`) whose answer is a **plain string**, so it lands
  directly in the existing `text` column with no flattening.
- **Migration `073`** to repoint the five fields on installs `072` already rewrote —
  `upsertPublishedForms` never rewrites an existing form's schema, and migrations never re-run.

---

## 5. Traps this slice inherits

- ⛔ Concept `status` must be written **UPPERCASE `'ACTIVE'`** or the expansion is silently empty.
- ⛔ Never compose a ValueSet with a FHIR `filter` — `filterConcepts` ignores the `op`. Enumerate.
- ⛔ Seeding a resource in a migration writes `fhir.change_log`, which shifts a **global** `seq` and
  the **global `pendingPush`** baseline. This broke tests in two untouched packages last slice.
  Write all three rows (`resource_history` → `fhir_resources` → `change_log`) and expect to update
  `sync-handle`'s `MIGRATION_SEEDED_CHANGE_LOG_ROWS` constant. See
  [[migration-seeded-changelog-blast-radius]].
- ⚠ `migrations.test.ts` pins the exact ordered migration list and lives one directory **above**
  `migrations/internal/`.
- ⚠ The new endpoint returns operator-entered strings — it must be capability-gated on
  `facilities.view` and must not become an unbounded scan; cap and index-check it.

## 6. Out of scope

Reconciling the 23 truncated `performer` strings; cleaning up typo'd values already stored; ward and
village (same mechanism, add later if wanted); any per-country geography import.

Related: [[facility-registry-workstream]], [[specimen-picker-and-status-casing]],
[[migration-seeded-changelog-blast-radius]], [[dont-hardcode-use-terminology]].
