# Facility registry — data model, aliases and import

**Date:** 2026-08-04
**Status:** MODEL SPEC ONLY. Not implemented, and deliberately stopping here for review.
**Supersedes** the storage decision in `2026-08-04-facility-registry-design.md` §2 (that spec's
measurements and traps stand; its "registry IS a set of FHIR Organization resources" does not).

---

## 1. What changed, and why

The earlier spec anchored the registry on FHIR `Organization`. Two things overturned that:

1. **The reason given was false.** "Only Organization can carry an address" is wrong —
   `Location.address` exists in CE's own FHIR schema, and the shipped Facility form already maps
   `address.country` / `district` / `state` onto a **Location**.
2. **A facility is not shaped like a concept or a document.** It has a hierarchy
   (region → council → ward), an operating status, coordinates and a phone, and lab data needs to
   *join* to it. In `terminology_concepts` those live in `properties` jsonb — reachable only as
   `properties->>'region'`, unindexed, with no foreign key. Terminology would buy import/versioning/
   sync machinery at the cost of every query actually run against it.

**Decision (user): a dedicated table pair.** And that dissolves rather than answers the open
Location-vs-Organization question — see §6.

## 2. The model

```
facility_registry                          -- what we KNOW (curated)
  id              text  PK                 -- CE-generated, stable, machine-only; never typed
  local_code      text  NULL UNIQUE       -- OURS. Required at DATA ENTRY, absent on imports (§2.1)
  national_system text  NULL               -- which register national_code belongs to (§4)
  national_code   text  NULL               -- THEIRS, e.g. HFR '122023-5'. The ONLY code on imports
  name            text  NOT NULL           -- canonical, UNTRUNCATED
  level           text  NULL               -- 'Level IA2 (Dispensary Laboratory)'
  ownership       text  NULL               -- 'Private, For Profit'
  status          text  NULL               -- 'Operating' | 'Closed' | …
  -- Administrative chain, full, all real columns (§2.2)
  country         text  NULL
  zone            text  NULL
  region          text  NULL
  district        text  NULL
  council         text  NULL
  ward            text  NULL
  village         text  NULL
  address_text    text  NULL
  phone           text  NULL
  latitude        numeric NULL
  longitude       numeric NULL
  extras          jsonb NOT NULL DEFAULT '{}'  -- form-added fields beyond the core (§7)
  managed_origin  text  NULL               -- NULL = lab-local | 'central' = central-managed (§8)
  source          text  NOT NULL           -- 'import' | 'manual'
  created_at / updated_at
  UNIQUE (national_system, national_code) WHERE national_code IS NOT NULL
  CHECK  (local_code IS NOT NULL OR national_code IS NOT NULL)   -- identifiable SOMEHOW (§2.1)
```

⚠ The column is `managed_origin`, not `origin`: migration 048 and `reference-apply.ts` already
establish that name and semantics (NULL = lab-local, `'central'` = managed), and the applier's
deletes are guarded by it. Reusing the convention means the sync task inherits that guard instead of
reimplementing it.

```
facility_aliases                           -- what an incoming FEED calls it (observed)
  source_system   text  NOT NULL           -- per feed: 'urn:openldr:cdr:performer', 'lis-a', …
  source_code     text  NOT NULL           -- the feed's code, or the observed display string
  registry_id     text  NOT NULL  FK → facility_registry.id
  created_at / created_by
  PRIMARY KEY (source_system, source_code)
```

**The PK is the whole design.** `(source_system, source_code)` means *one alias resolves to exactly
one facility*, while many aliases point at one registry row. That is the multi-LIS answer: a second
LIS adds aliases, it never forks the registry. It also makes reconciliation idempotent — attaching
an already-attached string is a no-op, not a duplicate.

**`id` is CE-generated, never the national code.** A facility exists in the registry before anyone
knows its MFL code (that is the normal case today), and national codes get reassigned. Keying on
them would make an unidentified facility unrepresentable and a re-key a cascade.

### 2.1 THREE identifiers, and why each exists

⚠ Do not collapse these. They answer different questions and have different lifetimes.

| Column / table | Who assigns it | Question it answers |
|---|---|---|
| `facility_registry.id` | CE, generated | "which row" — machine-stable, never shown, never typed |
| `facility_registry.local_code` | **the operator, at data entry** | "what do WE call it" |
| `facility_registry.national_code` | the national register | "what does the COUNTRY call it" |
| `facility_aliases.source_code` | each incoming feed | "what did the DATA call it" — many per facility |

**Which code is required depends on how the row was created:**

| Row origin | `local_code` | `national_code` |
|---|---|---|
| Data entry at a lab | **required** | optional |
| Imported / synced national registry | absent | **required** |

⇒ `CHECK (local_code IS NOT NULL OR national_code IS NOT NULL)`. A facility must be identifiable
*somehow*; neither code alone can be NOT NULL. **A nationally-imported row has no local code** — the
national register has no concept of one — and a hand-entered facility may never acquire a national
one. All 23 facilities observed today have no national code, so requiring it would block
reconciliation on a per-facility lookup against a portal with no bulk export.

⛔ **`facility_registry.local_code` (AUTHORED) is not `facility_aliases.source_code` (OBSERVED).**
One is what this install decided to call the facility; the others are what arriving data happened to
call it, many per facility. The alias column is deliberately NOT named `local_code` for exactly this
reason.

⛔ **Neither is `facilities.facility_code`**, the *projection* of an ingested resource's first FHIR
identifier (§6). Three similarly-named columns, three different meanings; they will look joinable in
a query and are not.

⚠ **`local_code` is unique per INSTALL.** Two labs may each mint `LAB01` for different facilities —
harmless while `origin='local'` rows never leave the lab (§8), but a collision the open "promote a
local facility to central" question (§8.1) must resolve.

### 2.2 The administrative chain is columns, not jsonb

`country · zone · region · district · council · ward · village` are all real columns. Rationale
(user): the data source supplies the whole chain, and anything a report might group by should be
indexable — an `extras` key cannot be.

⚠ The names are Tanzania-shaped. Another country's `council` may be a *municipality* or have no
equivalent tier at all. They stay free text rather than FKs to an administrative-unit table, so a
deployment maps its own vocabulary onto the nearest column and leaves the rest NULL. A real
administrative-unit hierarchy is out of scope (§8).

## 3. Import contract

One CSV shape, country-agnostic. **Required:** `national_code`, `name`. **Optional:** `level`,
`region`, `council`, `ward`, `ownership`, `status`, `address`, `phone`, `latitude`, `longitude`.

```
national_code,name,level,region,council,ward,ownership,status
122023-5,BAHEBE HEALTH LABORATORY,Level IA2 (Dispensary Laboratory),Geita,Chato DC,Nyamirembe,Private For Profit,Operating
120264-7,MATONDO,Dispensary,Shinyanga,Shinyanga MC,,Private For Profit,Operating
```

Whoever obtains the data — a batch export, an FOI request, another country's MoH — maps their
columns onto this once. Nothing here is Tanzania-specific.

### 3.1 ⛔ Unknown columns must FAIL, not be dropped

**This rule exists because the current terminology CSV importer gets it wrong.**
`parseTermsCsv`'s docblock says "extra columns go to properties"; the code builds `properties` from
exactly three known columns (`shortName`, `class`, `unit`) and **silently discards every other
column**. An import of a facility CSV through that path would report success and lose region,
council, ownership and level.

So this importer **reports unknown columns and refuses the file** unless `--allow-unknown-columns`
is passed. A silent success that lost half the data is the worst outcome available.

*(That terminology bug is real and independent of facilities — it can lose data on any terms CSV
import today. Flagged separately; not fixed in this spec.)*

### 3.2 Upsert and re-import

- Keyed on `(national_system, national_code)`. Re-importing a newer release **updates in place**, so
  aliases attached to a row survive a rename.
- **Rows absent from a new import are NEVER deleted.** A facility missing from one export is far
  more likely to be an incomplete export than a demolished building, and deleting it would orphan
  every alias and every historical report that referenced it. The importer *reports* the count of
  registry rows not present in the file and leaves them alone; closure is expressed through
  `status`, which the file supplies.
- **Dry-run by default** (`--dry-run` reporting insert / update / unchanged / unknown-column counts),
  because the first run of an importer against 14,209 rows should be inspectable.

## 4. The national system is configuration, not a constant

`national_system` is stored per row and defaulted from an install setting. Tanzania's HFR, Kenya's
MFL and so on are different registers; hardcoding one would make the second country a rewrite. This
is the real home for the `urn:openldr:facility:national` placeholder now sitting in the seeded
Facility form.

## 5. Reconciliation — attaching what the data already said

Measured today: the only facility signal is `diagnostic_reports.performer`, **1303/1303 populated**,
**23 distinct values**, **truncated to exactly 30 characters** (15 rows sit at the limit).

- Each observed string becomes an alias with `source_system` naming the feed and `local_code` set to
  **the string exactly as it arrived, truncation and all** (as `source_code`). It is a match key, not a name.
- ⛔ **Never fuzzy-match or "un-truncate."** `International School of Tangan` must be attached by a
  human once, not guessed. `Dodoma` is a region name and `HYDOH`/`CDCIL`/`NHLQATC` are acronyms —
  precisely the cases where a similarity score is confidently wrong.
- The screen lists unattached observed values **with their row counts**, so the operator does the
  high-volume ones first, and stays re-runnable: new values appear with every ingest.

## 6. Relationship to the existing `facilities` table — they are different things

`facilities` is the **projection of ingested `Organization` and `Location` resources**: what the data
said, uncurated, discriminated only by `source_resource`. `facility_registry` is **what we know**,
curated. They are not duplicates and **must not be "consolidated"** — one is an observation, the
other a decision.

This is what dissolves the Location-vs-Organization question: the registry is **anchor-agnostic**.
Ingested resources keep projecting to `facilities` exactly as they do now, whichever type they are,
and the alias table bridges observation to registry regardless. Whoever eventually fixes ingest or
DHIS2 BUG 11 still has to pick an anchor for *those* paths — but it no longer blocks this work.

## 7. The Facilities page = the Users pattern (decided)

The Users page is already exactly this, and it is worth copying rather than reinventing:

- `UserDialog.tsx` renders **`<FormRuntime>` driven by a `FormSchema`** — the page's fields come
  from a *form*, not from hardcoded JSX.
- `CORE_KEYS = {firstName, lastName, email}` are written to **real identity columns**.
- **Every other `apiProperty` goes to `user_profiles.extras`**, a `jsonb NOT NULL DEFAULT '{}'`
  (migration 021). So an admin can add a field to the form and it persists **with no migration**.
- `PAGE_TARGETS` declares the contract: `users` requires `firstName`/`lastName`/`email`.

Facilities gets the same shape, and **the contract is already declared**:
`{ id: 'facilities', match: 'apiProperty', requiredKeys: ['name'], available: false }`. The page does
not exist yet, which is the only reason for `available: false` — flip it when the page ships.

| | Users | Facilities |
|---|---|---|
| Form | `usersForm` | `facilityForm` (`sample-facility`, already seeded) |
| Required contract | firstName, lastName, email | **local_code + name** |
| Core columns | Keycloak identity | `facility_registry` columns (§2) |
| Everything else | `user_profiles.extras` | `facility_registry.extras` |

That answers "required fields, but expandable later": the **required set is the page-target
contract**, the **core columns are what the registry can query and join on**, and **anything the
form adds beyond them lands in `extras` without a migration**. Promoting a popular extra to a real
column later is a migration you choose, not one you are forced into.

⚠ One asymmetry to respect: a column can be indexed and joined; an `extras` key cannot. So the core
set should cover anything reports filter or group by — `region`, `council`, `status`, `level` — and
`extras` should hold the descriptive rest.

### 7.1 Where "required" is enforced — three layers, on purpose

One answer does not fit the three ways a facility gets created.

| Layer | Required | Why |
|---|---|---|
| **DB** | `name`, plus at least one code | A reconciliation stub and a partially-known import row must both be STORABLE. NOT NULL on the rest would make them unrepresentable. |
| **`PAGE_TARGETS.requiredKeys`** | `local_code`, `name` | The bare structural contract — what the page cannot function without. |
| **The Facility FORM** (`required: true` per field) | `country`, `zone`, `region`, `district`, `status`, `level` | What a HUMAN must supply when creating a facility by hand. |
| **Import** | `national_code` + `name`; **warns** on the rest | Rejecting 14,000 rows over a blank ward is worse than importing them and reporting the gaps. |

**⭐ Putting the country-specific required set in the FORM is what makes this portable.** A form's
`required` flags are per-field and **every install can edit them** — that is already true of the
Users form. So the shipped Facility form requires `country/zone/region/district` (Tanzania's chain),
and a deployment in a country with no zone tier simply un-requires that field. No fork, no config
flag, no code change.

⚠ This matters more than it looks: **`zone` is LESS universal than `council`.** Most countries have
a region → district → local-government chain; a tier *above* region is rarer. Hardcoding a required
`zone` anywhere but the form would make the second country a code change.

## 8. Sync: central owns it, labs receive it (decided)

**Direction is central → lab**, which is the opposite of most sync here and is already the
established pattern for reference data.

**The bus exists and is generic.** `reference_change_log` (`packages/db/src/reference-change-log.ts`)
carries a closed `ReferenceEntityType` union — `form`, `dashboard`, `report`, `report_design`,
`custom_query`, `setting`, `publisher`, `coding_system`, `term_mapping`, `terminology_system`,
`concept_map`. Config stores call `recordReferenceChange` **inside their own write transaction**, so
capture is atomic with the write. `packages/sync/src/terminology-sync.ts` is explicitly the lab-side
puller for *central-managed* systems. Adding `facility_registry` to that union is the mechanism —
no new transport.

⚠ **`facility_aliases` must NOT sync, in either direction.** An alias maps *one lab's* LIS codes to
a registry entry; it is meaningless at central and actively wrong at another lab, whose identical
local code may mean a different facility. Registry down, aliases local — the split falls straight out
of §2's PK.

### 8.1 ⛔ The overwrite trap

A central-managed row that a lab edits gets clobbered on the next pull — the same trade already
accepted for managed seed designs. But a lab legitimately needs to create facilities the national
list does not have. Hence **`origin`**:

- `origin='central'` — replaceable by down-sync. A lab's edits to these WILL be lost.
- `origin='local'` — created at the lab; **down-sync must never touch these**, and they must survive
  a full registry replace.

Without that column the first sync after a lab adds a facility silently deletes it, which is exactly
the class of failure that is invisible until someone goes looking for a facility that was there
yesterday.

**Open:** whether a lab may *promote* a local facility to central (submit it upward for inclusion),
or whether that is an out-of-band request. Not designed.

## 9. Open questions for review

1. ~~Does the registry sync?~~ **ANSWERED — central → lab, over the existing
   `reference_change_log` bus. See §8.**
2. ~~Manual capture path?~~ **ANSWERED — the Users pattern: FormRuntime + core columns + `extras`.
   See §7.**
3. **Does anything consume it yet?** `q-facilities` and `q-amr-facility-summary` currently read
   `patients.managing_organization` (1/589). Rewiring them to the registry is a follow-on, and
   worth confirming it is wanted before the join is designed.
4. **Does the lab order need a facility field at all**, or is facility derived from the ordering
   context? This decides whether the entity resolver (`ENTITY_TARGETS`) work is needed.
5. **What is the required set beyond `name`?** The page-target contract says `name` only. Candidates
   for *core columns* (indexable, joinable) are `region`, `council`, `status`, `level`; everything
   else could start in `extras`.
6. **May a lab promote a `origin='local'` facility to central?** (§8.1)

## 8. Out of scope

DHIS2 org-unit mapping, a real hierarchy tree (region/council/ward stay flat text), geospatial
queries, scraping any portal, the FHIR anchor decision (§6), and any change to `cdr-toolchain`.
