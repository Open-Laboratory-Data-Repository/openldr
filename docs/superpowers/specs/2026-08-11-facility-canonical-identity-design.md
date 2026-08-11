# Canonical facility identity, vocabulary and provenance

**Sub-project B1+B4 of the facilities audit's Phase 1.** Closes FAC-P1-04, FAC-P1-09 and FAC-P1-08.

## Purpose

Stop a national facility register's identity from depending on what somebody typed, stop "the
register dropped this row" from overwriting "this facility closed", and let an operator see where a
facility came from and what has happened to it.

## Scope

| Finding | In scope |
|---|---|
| **FAC-P1-04** | Registry source identity is an unsafe free-text field |
| **FAC-P1-09** | Facility status and level are stored/displayed as unstable labels |
| **FAC-P1-08** | Source, ownership, and managed status are hidden |

Out of scope, and deliberately: **B2** (optimistic concurrency, impact-gated delete), **B3**
(retire/duplicates/merge), **D** (governance/config). B3 depends on this slice — a merge that runs
without canonical identity merges the wrong things.

## Measured before designing

Everything below was verified against the merged code on 2026-08-11, not inferred from the audit.

### The defect is worse than "a free-text field"

`ImportFacilitiesSheet.tsx:560` is a bare `useState('')`. The placeholder reads `e.g. HFR, MFL` — a
hint, not a constraint. Nothing validates it, and that string is hashed straight into every
facility's permanent id (`facility-csv.ts:84`):

```
fac- + sha256("<typed value>|<national code>").slice(0,16)
```

Measured, for national code `100`:

| typed | facility id | controlled-field slug |
|---|---|---|
| `HFR` | `fac-d112c779ad583160` | `hfr` |
| `hfr` | `fac-49bce368724fb81a` | `hfr` |
| `HFR ` | `fac-d112c779ad583160` | `hfr` |
| `urn:tz:hfr` | `fac-0eea98ab9108599d` | `urn_tz_hfr` |

⛔ **Note the asymmetry, which is the part the audit does not name.** `observedFieldSystem`
(`facility-controlled-fields.ts:44`) **lowercases** its slug, so `HFR` and `hfr` share their
controlled-field coding system and `term_mappings` while producing **different facility ids**. The
data disagrees with itself: one register, two facility identities, one mapping namespace.

Trailing whitespace is already trimmed, so `HFR ` is safe. Case is not.

### Registry sources are ALREADY coding systems — implicitly

`facility-reconcile.ts` derives and upserts `coding_systems` rows by URL (`upsertByUrl`,
`urn:openldr:cs:facility-registry`), and `observedFieldSystem(field, nationalSystem)` derives more of
them from the same typed string. So the entity FAC-P1-04 asks us to create **already exists** — it is
just conjured from a text box instead of chosen.

`coding_systems` (migration 012) already carries almost exactly what P1-04 asks a source to have:
`system_code`, `system_name`, `url`, `system_version`, `description`, `active`, `publisher_id`
(→ `publishers`, i.e. the authority). Missing: jurisdiction and contact.

### P1-09 is HALF done, and the remaining half is the second door

`importFacilities` **already substitutes canonical codes**: `applyControlledFields(r, controlled)`
(`facility-import.ts:611`) rewrites `level`/`status`/`country` to the canonical value and preserves
the raw source string under `extras.__source`.

⛔ **But manual create/edit is completely unconstrained.** `FacilityDialog.tsx` applies no valueset,
and the write route has no canonical validation. So an imported facility gets `active` and a
hand-created one can get `Operating`, `Open`, or anything typed. **The two doors disagree** — the same
defect class A2b spent a slice preventing between the inline and job import paths.

### The two facts that collapse into one column

The real 13 000-row TZ MFL release (`../corlix/fixtures/mfl-TZ-2026-Q3-large.jsonl`) carries
`active: true` on every row **plus 25 `deletion` records**:

```json
{ "type": "row", "mflId": "TZ-000001", "name": "Kinondoni Mkwajuni Health Center", "active": true }
{ "type": "deletion", "mflId": "TZ-013000" }
```

Retirement writes `status: 'inactive'` (`facility-import.ts:846`), and the comment above it is
**correct about why**: HL7's `location-status` CodeSystem defines only `active|suspended|inactive`,
and inventing a `retired` code in a vocabulary HL7 owns would be non-conformant. The problem is what
that forces — two different facts become the same value:

| What happened | Stored |
|---|---|
| The register **dropped the row** (merged, mis-registered, transferred). The building is open. | `status='inactive'` |
| The register **still lists it and says it is closed**. | `status='inactive'` |

Consequences: you cannot distinguish "dropped by the register" from "closed"; a facility dropped in
Q2 and re-added in Q3 looks like it reopened; and any report filtering `status='active'` silently
drops a lab that is **open and receiving specimens** but no longer carried by the register.

### `audit_events` already captures the timeline

Migration 005 gives `occurred_at`, `actor_type`, `actor_id`, `actor_name`, `action`, `entity_type`,
`entity_id`, `before` (jsonb), `after` (jsonb), `metadata`. `facility.create` and `facility.update`
already record real before/after (`facilities-routes.ts:1096`, `:1205`). **The history timeline is a
read model over data already being written** — no new table, no new capture.

⚠ The gap: import audits are **register-scoped** (`entityId` = the national system), so an import
that changed 13 000 facilities writes one row and none of those facilities' timelines show it.

### Facilities are NOT centrally synced, and nothing plans to be

`managed_origin` is plumbed through `facility-registry-store.ts` (read, write, filter), but **nothing
writes `'central'` to a facility**. `reference-apply.ts` — the down-sync applier — handles
`coding_systems` and terminology tables and **does not handle `facility_registry` at all**;
`facility-classify.ts:32` says "the sync applier owns it, not this path", and no such applier exists.
The distributed-sync architecture spec has **zero** mentions of facilities.

⇒ P1-08's "Synced" and "Local override" badges, and its precedence rules, model a state that cannot
currently occur. They are deliberately not built here.

⭐ **A dividend of the reuse decision:** because sources become `coding_systems` rows, and
`reference-apply` already carries `coding_systems`, **registry source definitions become centrally
distributable for free** — central can publish the canonical Tanzania HFR definition and labs receive
it, with no facility sync in existence.

### There is no production data to migrate

`idFor`'s hashed form was introduced 2026-08-10 (`44824663`); the facilities import UI first shipped
2026-08-05 (`42ed37fb`). The only tags are `checkpoint/2026-07-10-installer-validated` — a month
*before* the import UI — and a backup tag. **No release contains this feature.** The one facility in
the local database is `source='manual'` with a NULL `national_system` and a UUID id, not the hashed
form.

## Design

### 1. Registry sources become explicit (FAC-P1-04)

Add to `coding_systems`: **`jurisdiction`** (ISO 3166 alpha-2/alpha-3, nullable) and **`contact`**
(nullable text). Everything else P1-04 requires already exists.

Add **`kind`** to `coding_systems`, and mark facility-register sources with it explicitly.

⛔ **`kind` is a real column and NOT a URL-prefix convention.** Sniffing `urn:openldr:cs:facility-*`
to decide what a row means is precisely the implicit rule this slice exists to delete — it would
replace one string-derived identity with another.

**The import sheet stops asking.** The free-text box becomes a `Select` over active sources of
`kind='facility-register'`. Creating a source is a separate privileged action with validation, not a
side effect of typing. Per [ui-actions-in-dots-menu] the create action lives in the `⋯` menu; the
Select is an input and keeps the label-left / input-right layout.

**Facility ids key on the source's canonical `url`**, never its display name or its local row id:

```
idFor(source.url, nationalCode)
```

The `url` is globally canonical, so two installs importing the same register mint the **same** ids —
a precondition for B3's merge and for any future sync. A local row id would be install-local and
would break that; the display name is what is broken today.

`observedFieldSystem` likewise derives from the source's `url`, not from a typed string, which closes
the case/identity asymmetry measured above.

### 2. Vocabulary and the status split (FAC-P1-09)

**`status` keeps HL7 `location-status` and means operational status only** — `active | suspended |
inactive`. Nothing about registry membership.

**New `register_state`**, OpenLDR's own vocabulary seeded as a valueset, carrying membership:

| value | meaning |
|---|---|
| `in_register` | the current release of its source carries this facility |
| `dropped` | its source carried it and no longer does (a `deletion` record, or absent from a complete release) |
| `not_registered` | it never came from a register (manual creation) |

⛔ **Retirement writes `register_state='dropped'` and STOPS writing `status`.** That single change is
what stops a bookkeeping event from destroying a clinical fact. `retireRegistryConcepts` keeps its
current behaviour — removing the facility from the mapping picker while leaving history resolvable.

**Manual create/edit is validated server-side** against the same valuesets the importer uses. UI
constraint alone is not sufficient — the route is the door that matters, and the CLI and integrators
reach it too.

**Display is rendered from terminology**, not by showing the stored code. The stored value stays the
canonical code; the label is looked up.

### 3. Provenance and history (FAC-P1-08)

**Badges** for `Manual` and `Imported`, both real today via `source`. `managed_origin` is documented
as a reserved axis and no precedence rules are built for it — see *Measured*.

**Facility detail** shows registry authority (the source's publisher), source system name + canonical
URI, release/version, and last import.

**History timeline** is a read model over `audit_events`, filtered to `entity_type='facility'` and
the facility's id, rendering actor, action, time and a before→after field diff.

**The import writes per-facility audit rows only for rows that actually changed.** A2a's
reconciliation already computes `create`/`changed`/`unchanged` exactly, so a byte-identical 13 000-row
re-import writes **zero** audit rows while a real quarterly delta writes only what moved. The
register-scoped `facility.import` event stays as the summary.

### 4. Migration and the id re-key

Backfill resolves each distinct existing `national_system` to a `coding_systems` row by URL, creating
one where absent. Rows with a NULL `national_system` (manual creations) are untouched and become
`register_state='not_registered'`.

⛔ **Refuse loudly** if two distinct existing values would resolve to one source — fail the migration
with both values named rather than silently merging two registers' facilities. A2b spent a slice
proving silent merges are how registers get corrupted.

#### Where a facility id is written down

Re-keying is not one column. Measured, a facility id is stored in nine places, and only three of them
follow automatically:

| Location | Database | Follows the re-key? |
|---|---|---|
| `facility_registry.id` | internal | the row itself |
| `facility_registry_identifiers.registry_id` | internal | ✅ FK cascade |
| `facility_concept_projection.registry_id` | internal | ✅ FK cascade |
| **`facility_concept_projection.concept_code`** | internal | ❌ **can BE the id** — collision fallback, `facility-reconcile.ts:1118` |
| `term_mappings` targeting that concept code | internal | ❌ matches on the code string |
| **`facility_map.registry_id`** | **external warehouse** | ❌ different database, no FK possible |
| DHIS2 facility→org-unit map (migration 008) | internal | ❌ |
| `form_definitions.facility_id`, `form_versions.facility_id` (020) | internal | ❌ |
| `facility_jobs.registry_id` (079) | internal | ❌ |

#### The policy: internal is rewritten, the warehouse is REBUILT

**The migration rewrites every internal reference and does not touch the warehouse.** It then marks
the facility-map dimension stale so the existing `facility-map-rebuild` job regenerates it.

⛔ **The migration must never reach into the external warehouse database.** It may be Postgres, SQL
Server or MySQL, and it may be unreachable when migrations run — a migration that edits it either
fails the boot or silently half-succeeds, leaving the reporting dimension pointing at ids that no
longer exist.

**Why a rebuild is sufficient, verified:** `publishFacilityMap({ apply: true })` is a **full
regeneration, not an incremental update** — it runs `deleteFrom('facility_map')` and re-inserts every
resolved row inside one transaction (`facility-reconcile.ts`). So the stale dimension is replaced
wholesale, carrying the new ids, with no per-row migration and no cross-database write.

**The ordering is the point.** The warehouse is the analytical end; it is downstream of internal
state by construction. If internal identity is wrong, a warehouse rewritten to match it is wrong too
— and if the warehouse is unavailable, reporting is already unavailable, so deferring its rebuild
costs nothing that is not already lost. Internal correctness first, dimension regenerated after.

### 5. UI

Registry list gains a source column/badge; filters gain source and `register_state`. The existing
`⋯` `DropdownMenu` convention holds for every action; new i18n keys land in **en, fr and pt** in the
same commit (`parity.test.ts` enforces it).

## Testing

- **pg-mem** for store and route behaviour, with the documented hazards respected: `now()` collides on
  ~50% of consecutive calls, so any strictly-greater timestamp assertion forces the gap; scan order is
  stable, so every ordered query still needs a unique tiebreaker.
- **Real Postgres** for the id re-key at 13 000 rows against the real MFL corpus, and to confirm a
  byte-identical re-import still reports `unchanged: 13000` **and now writes zero audit rows**.
- **Mutation-prove** the three claims that carry the slice: ids derived from the source URL rather
  than the display name; retirement no longer touching `status`; audit rows written only for changed
  rows. A mutation must be shown to execute the mutated line — eleven inert or near-inert mutations
  were caught across A2b.

## Known limits, stated rather than implied away

- `register_state` is OpenLDR's own vocabulary, not a standard one. That is deliberate: HL7 owns
  `location-status` and has no membership concept.
- Re-keying facility ids changes every imported row's id. Safe **only** because no release contains
  the import feature; this migration would need a different design after one does.
- **The warehouse dimension is briefly stale** — between the migration and the rebuild job's next
  run, `facility_map` holds the old ids. Reports joining it resolve nothing for affected facilities
  in that window. Accepted deliberately: the alternative is a cross-database write inside a
  migration, and the window closes on the next rebuild.
- **The 5-lab aggregation payoff is not yet reachable.** Keying on the register's canonical URI means
  independent installs derive identical ids for the same facility, so a central aggregating several
  labs would see one facility rather than one per lab. Measured: **no facility or Location data
  travels in the sync bundle today** (the push carries FHIR resources such as Patient), so this is a
  property the design preserves for later, not a problem it solves now. It costs nothing extra to
  have now and cannot be retrofitted cheaply once ids are in use.
- Sources are `coding_systems` rows, which means terminology admin can edit them. Guardrails belong to
  D (governance), not here.
- `managed_origin` remains unused. If facility down-sync is ever built, the precedence rules P1-08
  asks for must be designed then, with a real conflict to reason about.
