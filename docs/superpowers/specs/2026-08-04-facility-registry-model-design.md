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
  id              text  PK                 -- CE-generated, stable, never the national code
  national_system text  NULL               -- which register the code belongs to (§4)
  national_code   text  NULL               -- e.g. HFR '122023-5'
  name            text  NOT NULL           -- canonical, UNTRUNCATED
  level           text  NULL               -- 'Level IA2 (Dispensary Laboratory)'
  ownership       text  NULL               -- 'Private, For Profit'
  status          text  NULL               -- 'Operating' | 'Closed' | …
  region          text  NULL
  council         text  NULL
  ward            text  NULL
  address_text    text  NULL
  phone           text  NULL
  latitude        numeric NULL
  longitude       numeric NULL
  source          text  NOT NULL           -- 'import' | 'manual'
  created_at / updated_at
  UNIQUE (national_system, national_code) WHERE national_code IS NOT NULL

facility_aliases                           -- what the DATA calls it (observed)
  source_system   text  NOT NULL           -- per feed: 'urn:openldr:cdr:performer', 'lis-a', …
  local_code      text  NOT NULL           -- the local code, or the observed display string
  registry_id     text  NOT NULL  FK → facility_registry.id
  created_at / created_by
  PRIMARY KEY (source_system, local_code)
```

**The PK is the whole design.** `(source_system, local_code)` means *one alias resolves to exactly
one facility*, while many aliases point at one registry row. That is the multi-LIS answer: a second
LIS adds aliases, it never forks the registry. It also makes reconciliation idempotent — attaching
an already-attached string is a no-op, not a duplicate.

**`id` is CE-generated, never the national code.** A facility exists in the registry before anyone
knows its MFL code (that is the normal case today), and national codes get reassigned. Keying on
them would make an unidentified facility unrepresentable and a re-key a cascade.

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
  **the string exactly as it arrived, truncation and all.** It is a match key, not a name.
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

## 7. Open questions for review

1. **Does the registry sync to central?** A dedicated table rides neither terminology sync nor the
   FHIR `change_log`, so lab and central would maintain separate registries unless something is
   built. Given a central aggregates many labs, it plausibly wants to *own* the registry and push it
   down — which is the opposite direction from most sync here.
2. **Does anything consume it yet?** `q-facilities` and `q-amr-facility-summary` currently read
   `patients.managing_organization` (1/589). Rewiring them to the registry is a follow-on, and
   worth confirming it is wanted before the join is designed.
3. **Manual capture path.** The Facility form (`sample-facility`) currently targets `forms`, and the
   `facilities` page target is `available: false`. Does the form write to `facility_registry`, or
   does the registry get its own admin page?
4. **Does the lab order need a facility field at all**, or is facility derived from the ordering
   context? This decides whether the entity resolver (`ENTITY_TARGETS`) work is needed.

## 8. Out of scope

DHIS2 org-unit mapping, a real hierarchy tree (region/council/ward stay flat text), geospatial
queries, scraping any portal, the FHIR anchor decision (§6), and any change to `cdr-toolchain`.
