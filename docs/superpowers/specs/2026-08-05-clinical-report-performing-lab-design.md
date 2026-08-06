# Clinical report — the performing laboratory — Design

**Goal:** the Clinical Microbiology Report must state **which laboratory performed the test**, and
**where that laboratory is**. Today it states neither, and on a national instance nothing else on the
page supplies them.

> **Revised 2026-08-06.** The 2026-08-05 draft of this document described resolving `performer`
> through `facility_aliases (source_system, local_code)` → `facility_registry.name`. **That design
> cannot work and has been removed** — see §7, which records why, so the dead end is not re-derived.
> Everything below is measured against the live warehouse on 2026-08-06 unless marked otherwise.

---

## 1. Why this is a defect, not a nicety

**OpenLDR runs as a national instance in an MoH data centre**, not per-lab (the only per-lab
deployment is the poor-connectivity case that distributed sync serves). So the letterhead
(`{{lab.*}}`, Settings ▸ Laboratory) is the **issuing organisation** — the ministry. The
**performing laboratory** is a per-report fact that arrives in the data.

`q-clinical-micro-header` (`packages/reporting/src/seed/report-seeds.ts`) selects patient
surname/firstname, sex, dob, specimen type, received date, lab number, panel and organism.
**It selects no facility at all.** A clinician receiving `rt-clinical-micro` cannot tell which
laboratory produced the result.

**The location is part of the defect, not a bonus.** Measured on the source: five distinct DISA
facility codes — `BAMAA`, `BBFAF`, `CDABE`, `EAFAE`, `NDFAM` — all carry the display **"Aga Khan"**,
in Dar es Salaam (×2), Dodoma, Iringa and Morogoro. A report that prints only `Aga Khan` names five
different laboratories identically. The district is what disambiguates them.

## 2. Measured state (live `openldr_target`, 2026-08-06)

### 2.1 The data

| Fact | Measured |
|---|---|
| `diagnostic_reports` rows / distinct `performer` codes / feeds | 7520 / 88 / 1 (`webhook-ingest`) |
| Reports whose `(source_system, performer)` finds a `facility_map` row | **7520 of 7520** — the join misses nothing |
| `facility_map` rows / rows with a resolved `name` | 88 / **1** (`BAGAE`) |
| Reports covered by that one resolved row | **942** |
| `facilities` rows / distinct codes / rows with `region` | 90 / 88 / **56** |
| Distinct `performer` codes that have a `facilities` row | **88 of 88** |
| `facilities.facility_name` differing from `diagnostic_reports.performer_display` | **0** |
| `facilities.region`/`district` that are empty strings rather than NULL | **0** (34 NULL, 56 populated) |
| `diagnostic_reports.source_system` NULL or empty | **0 of 7520** |
| `facilities.region` values that are real administrative areas | **55 of 56** — see §2.4 |

### 2.2 The join route

`diagnostic_reports` has **no** `request_id` or `based_on` column (verified against
`information_schema`), so the specimen is the only route from `lab_requests` to a report — the route
`q-amr-facility-summary` already uses and `q-clinical-micro-header` already computes
(`max(l.specimen_id)`).

Three invariants make the per-specimen `min()` fold **lossless, not lucky**:

| Invariant | Measured |
|---|---|
| Specimens whose reports disagree on `performer` | **0 of 3713** |
| `performer` codes carrying more than one `performer_display` | **0 of 88** |
| Specimens whose reports mix `source_system` | **0 of 3713** |

⇒ `min(performer)`, `min(performer_display)` and `min(source_system)` taken independently cannot mix
one facility's code with another's name. This is the same tradeoff `q-amr-facility-summary` already
documents: if a future sender ever disagrees, `min` still picks deterministically and still cannot
fan out.

### 2.3 ⛔ The 30-character truncation is UPSTREAM — and it applies to `performer_display` too

- `diagnostic_reports.performer_display` is `text` with `character_maximum_length: null` — CE imposes
  no cap.
- The values are nonetheless cut mid-token: `"Ocean Road Cancer Institute (O"` (unclosed
  parenthesis), `"International School of Tangan"` (Tanganyika).

⇒ A fixed-width 30-char field in the **source system (DISA)** clipped these before ingest. The full
name is *unrecoverable from the data*.

**This is what makes registry resolution the point of the feature rather than a refinement.** The
live instance demonstrates it concretely: `BAGAE`'s wire display is `NHLQATC` — an acronym, not a
name — and `facility_map.name` resolves it to **National Public Health Laboratory** across 942
reports. The fallback is an improvement over printing a bare code, but it is still a clipped string;
only mapping fixes it.

### 2.4 ⚠ One `facilities` row carries a postal address where a region should be

`BAGAE` has `facilities.region = '2448 Luthuli Street/Sokoine'` and
`district = 'P.O.Box 9083'` — a street and a PO box, not administrative areas. The wire's
`Address.state`/`Address.district` are free text and that sender populated them with address lines.

Every other populated row is clean: the 55 remaining regions are Tanzanian regions (Dar es Salaam
×26, Pwani ×5, Mbeya ×4, Mwanza ×4, …) and the districts are districts (Ilala ×15, Kinondoni ×6,
Temeke ×5, …).

**The preference order in §3.3 already contains this**, and not by luck: `BAGAE` is the one facility
that *is* mapped, so `facility_map` supplies `Ubungo, Dar es Salaam` and the address lines never
reach the page. That is the general case working as intended — curated registry data overrides
whatever the wire carried.

⛔ **No cleanup heuristic is applied, deliberately.** Filtering values that "look like" street
addresses is the same class of guessing as fuzzy-matching a facility name, and would be confidently
wrong on a real administrative area with a number in it. If an *unmapped* facility ever carries
address lines, the report prints them — the wire's own claim about that facility, visibly wrong to a
Tanzanian reader, and fixed by mapping the facility, which is the action the operator should take
anyway.

## 3. What ships

### 3.1 The query — `q-clinical-micro-header` gains two bound columns

Three CTEs and one join, in all three dialect variants:

```sql
with facility_of as (
  select specimen_id,
         min(performer)         as performer,
         min(performer_display) as performer_display,
         min(source_system)     as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
),
facility_loc as (
  select source_system, facility_code,
         min(region)   as region,
         min(district) as district
  from facilities
  where facility_code is not null and facility_code <> ''
  group by source_system, facility_code
),
facility as (
  select fo.specimen_id,
         coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab,
         coalesce(fm.district, fa.district)                    as district,
         coalesce(fm.region,   fa.region)                      as region
  from facility_of fo
  left join facility_map fm
    on fm.source_system = coalesce(fo.source_system, '')
   and fm.source_code   = fo.performer
  left join facility_loc fa
    on fa.source_system = fo.source_system
   and fa.facility_code = fo.performer
)
select
  ... the eight existing columns ...,
  f.performing_lab,
  case when f.district is not null and f.region is not null
       then f.district || ', ' || f.region
       else coalesce(f.district, f.region) end as lab_location
from lab_requests q
left join patients p on p.id = q.patient_id
left join specimens s on s.id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
left join facility f on f.specimen_id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
where q.id = {{param.request}}
```

**The `facility` CTE exists so the two `coalesce`s are written once.** Without it, each would be
repeated inside the `case` expression, three times over, in three dialect strings — six places for
the fallback order to drift apart.

**The specimen subselect is repeated rather than reusing `s.id`.** `s` is LEFT joined, so a
`specimen_id` present in `lab_results` but absent from `specimens` would leave `s.id` NULL and
silently drop the facility. Repeating the correlated subselect makes the facility join independent of
whether the specimen row itself exists. It is the idiom this query already uses.

**Dialect variation is confined to two operators**, matching how this file already handles
`q-amr-facility-summary`'s end-of-day concat:

| dialect | the `lab_location` concatenation |
|---|---|
| postgres | `f.district \|\| ', ' \|\| f.region` |
| mssql | `f.district + ', ' + f.region` |
| mysql | `concat(f.district, ', ', f.region)` |

⛔ **`CONCAT_WS` is deliberately NOT used** even though it expresses this in one expression in all
three dialects. It was introduced in **SQL Server 2017**, and `docker-compose.yml` documents
`MSSQL_VERSION=2017` as the supported floor — so it would sit exactly on the boundary with no
headroom. It also *skips NULL but keeps `''`*, which would emit a leading `", region"` the day a
sender puts an empty string on the wire. The explicit `case` has neither property.

### 3.2 The resolution — the raw string is a MATCH KEY, not a name

Resolution goes through **`facility_map`**, the external warehouse dimension built for exactly this
(external migrations `012`/`013`/`014`), joined on `(source_system, source_code)` =
`(diagnostic_reports.source_system, diagnostic_reports.performer)`.

`performer` is the facility **code** (`BAMAA`); `performer_display` is the human **name**
(`Aga Khan`). ⛔ **Never match on the display.** FHIR states `Reference.display` is a human label that
must never be used for matching, and this system has already been bitten by it: keying on the display
collapsed five laboratories into one and would have attributed Dodoma's results to Dar es Salaam.

⛔ **Never fuzzy-match.** `Dodoma` is a region; `HYDOH` / `CDCIL` / `NHLQATC` are acronyms. A
similarity score is confidently wrong exactly where it matters.

### 3.3 The fallback — three levels for the name, two for the location

```
performing_lab = coalesce(facility_map.name, performer_display, performer)

district       = coalesce(facility_map.district, facilities.district)
region         = coalesce(facility_map.region,   facilities.region)
lab_location   = "district, region"  when both are present
                 district            when only the district is
                 region              when only the region is
                 ""                  when neither is
```

**Name.** An unmapped performer prints its wire display (`Aga Khan`) and, only if even that is
missing, its bare code (`BAMAA`). A clinical report must never go out with a blank laboratory because
nobody has reconciled that facility yet.

**Location.** `facility_map` is preferred over `facilities` so a **mapped** facility always shows
curated registry data — the operator's corrections win over whatever the wire happened to carry, even
when the curated copy is staler. `facilities` fills only what the registry has not got.

⛔ **Why the location reads `facilities` directly rather than being carried into `facility_map`.**
Carrying it would keep the report joined to one dimension, and `resolveObservedFacilities` already
computes `sourceRegion`/`sourceDistrict` for the Observed tab, so the data is there. It was rejected
because **`facility_map` is rebuilt only by a manual publish while ingest runs continuously and
unattended**. A facility first seen after the last publish has **no `facility_map` row at all**, so a
carried location would be missing exactly when a new site starts sending. `facilities` is written at
ingest and is therefore always current. This is the same triage error the reconciliation slice
already made once — deferring an ingest-time gap because "a scan covers it", when the scan is manual
and the window is open *by default*.

⚠ **`facilities` has no uniqueness constraint on `(source_system, facility_code)`, and the query
folds it structurally rather than relying on today's data staying collision-free.**
`resolveObservedFacilities` guards its own `Map` with first-wins for precisely this reason, but that
guard lives in application code and says nothing about the table the SQL query reads. `facilities.id`
is the raw FHIR resource id (`packages/db/src/relational/facility.ts:25`), and **both** `Organization`
and `Location` resources project into that table (`packages/db/src/relational/index.ts:37-38`), so two
resources describing one facility are two rows sharing a `(source_system, facility_code)` pair — the
composite predicate does not prevent that, it only scopes which rows can collide. Measured: zero
duplicate pairs exist today, but the table is not empty on the `Location` side either — 89
`Organization` rows and 1 `Location` row are live right now, so the second-resource case this join
must survive is not hypothetical. A duplicate would fan this **one-row** header query out to two rows,
which the keyvalue panel, the barcode and the QR would all render from the first, silently. The query
therefore adds a `facility_loc` CTE — `select ... min(region), min(district) from facilities group by
source_system, facility_code` — and joins that instead of the raw table, the same fold `facility_of`
already applies to `diagnostic_reports` one CTE up. This makes the one-row guarantee structural instead
of a property of the current feed. The two `min()`s are still taken independently, so a genuine
two-resource collision could in principle contribute district from one row and region from the other —
deterministic and bounded (both rows describe the same facility), but a tradeoff, not a proof, exactly
like the `facility_of` fold above it.

⚠ **`coalesce(fo.source_system, '')` on the `facility_map` side is not defensive noise.**
`resolveObservedFacilities` normalises a NULL `source_system` to `''` when building `facility_map`,
and `relational-writer.ts` documents having written NULL `source_system` into every row for months. A
plain equality join drops those rows silently, because `NULL = NULL` is false. Today's data has zero
NULLs, but a warehouse restored from an older ingest would not. The `facilities` side is deliberately
*not* coalesced: its own `source_system` came from the same writer, so both sides are NULL together
and the join misses either way — coalescing one side only would create a false match against a `''`
row that means something else.

### 3.4 Placement on the page — the existing panel, no layout shift

The two facts append to `rt-clinical-micro`'s `hdr` keyvalue panel (`kind: 'keyvalue'`, `x:40 y:152
w:700 h:84`, `layout: 'inline'`, `panelColumns: 2`), taking it from eight pairs to ten:

| | |
|---|---|
| Surname | Specimen |
| First name | Received |
| Sex | Lab number |
| DOB | Panel |
| **Performing lab** | **Lab location** |

⛔ **They belong here, not in the letterhead.** Two different facts:

- letterhead = the **issuing** organisation (MoH), from `app_settings`, same on every report
- performing lab = **who tested this specimen**, from the row, different per report

Putting it in the letterhead would re-introduce the exact confusion the architecture correction
resolved.

**Geometry, computed from `pairRects` (`packages/report-designer/src/render/draw.ts`) — no element
below the panel moves.** With `KV_PAD_Y` 4 and `KV_INLINE_H` 14 and no title, pairs start at
`y = 152 + 4 = 156`; row 5 (pairs 9 and 10) occupies **212 → 226**, inside the box bottom of **236**
with 10px to spare. `org` (y=244), the section band, the susceptibility table and the footer are
untouched.

⛔ **This panel is now FULL.** `pairRects` returns boxes past the bottom of the box and the drawer
`doc.clip()`s them — a **sixth row disappears silently**, with no error and no overflow. Field eleven
must grow `h` (and push `org` and everything below it down), not simply be appended.

**Cell width.** `cellW = (700 − 12 − 12) / 2 = 338px = 253.5pt`; inline splits it
`KV_LABEL_FRAC 0.4` → label 101.4pt, value **152.1pt**. `National Public Health Laboratory` measures
~132pt at 8pt Helvetica and fits; longer registry names ellipsize cleanly because keyvalue cells pass
`height` (the `pdf-table-cell-overlap` fix — `ellipsis` is inert in pdfkit without it).

**Labels.** `Performing lab` and `Lab location`, matching the terse register of the panel's existing
labels (`Lab number`, `First name`, `DOB`). The formal `Performing laboratory` also fits (~73pt of
101.4pt) if the operator prefers it.

**A blank location renders as an empty value, not a vanished pair** — the grid keeps its shape for
the 32 of 88 facilities with no location on either side.

## 4. What the operator will actually see

Stated plainly so a reviewer can check the rendered PDF against it rather than against a hope:

| Case | Reports | Renders |
|---|---|---|
| Mapped to the registry (`BAGAE`) | 942 | `National Public Health Laboratory` / `Ubungo, Dar es Salaam` |
| Unmapped, `facilities` knows the location | 55 codes | truncated wire name / `district, region` |
| Unmapped, no location either | 32 codes | truncated wire name / *(blank)* |

(1 + 55 + 32 = 88. `BAGAE` is itself one of the located rows, which is why the unmapped-with-location
count is 55 and not 56 — and it is the one row whose `facilities` location is unusable, §2.4.)

⚠ **`facility_map` refreshes only on a publish** — Facilities ▸ Observed ▸ ⋯ ▸ "Rebuild reports
dimension", or `openldr facilities publish --apply`. A newly-registered or renamed facility shows its
**old** name on reports until then. The `facilities` half of the location needs no publish.

⚠ **An unmapped facility still gets a `facility_map` row**, with `name` NULL — not a missing row. A
missing row means the facility was first seen *after* the last publish.

## 5. Testing

- The header query returns a performing lab for a specimen whose `diagnostic_reports` row has one.
- A **mapped** performer resolves to `facility_map.name`, not the truncated wire string.
- An **unmapped** performer falls back to `performer_display`; with no display, to the raw code.
  Never null, never blank.
- Location prefers `facility_map` over `facilities` when both are present — the `BAGAE` case (§2.4),
  where taking `facilities` would print a PO box on a clinical report.
- Location composes `district, region`; district-only and region-only each render alone with no
  stray comma; neither renders blank.
- A specimen with **no** `diagnostic_reports` row yields null and the report still renders.
- A report whose `source_system` is NULL still joins its `facility_map` row (the `coalesce` guard).
- `pairRects` places pair 10 inside the `hdr` box — a regression test that pins the panel's capacity,
  so field eleven fails loudly instead of disappearing.
- ⚠ Parity: `report-seeds.test.ts` and the per-report parity tests pin these queries. **All three
  dialect variants must stay in step.**
- ⛔ **Render a PDF and look at it.** The operator asked for this explicitly: *"Show me a rendered PDF
  early — I want to see it, not just tests."* A passing test proves the code is merged, not that the
  running instance does this.

## 6. Out of scope

- **The reconciliation screen.** It shipped; this slice *consumes* `facility_map`.
- **Backfilling the registry.** 1 of 88 facilities is registered. The feature is correct at 1 and at
  88; populating the registry is the operator's data work, not this slice's.
- **The Historical Charts band** from `Lab-Report-Formats.svg` — needs chart data-binding in the
  report designer, which is deferred, and deserves its own spec.
- **The Confirmation Summary band** from that SVG — largely band 7, which already ships;
  re-authoring the seeded design is separate work.
- **`level` / `status` / `national_code`** from `facility_map`. Available, but a clinician does not
  need the facility's tier on a culture report, and the panel has no room (§3.4).

## 7. ⛔ The design this document replaced, and why it could not work

The 2026-08-05 draft resolved `performer` through
`facility_aliases (source_system, local_code)` → `facility_registry.name`. Recorded here so the dead
end is not re-derived:

1. **`facility_aliases` no longer exists** — dropped in internal migration `074`. It held 0 rows and
   its `ON DELETE CASCADE` silently destroyed mappings.
2. **The column was `source_code`, never `local_code`** — wrong even while the table existed.
3. ⛔ **It was never joinable.** `facility_registry` and `term_mappings` are in the **internal**
   database (`openldr`); `diagnostic_reports` is in the **external** warehouse (`openldr_target`,
   and may be MSSQL or MySQL). **No cross-database join exists.**
   `packages/db/src/migrations/external/011_terminology_codes.ts` documents this exact constraint in
   its file header, and `012_facility_map.ts` states it again as that dimension's whole reason to
   exist.

The general lesson: **a report cannot resolve anything that lives in the internal database.**
Whatever it needs must be *projected into the warehouse* first. That is what `facility_map` is.

Related: [[facility-reconciliation-slice]], [[facility-registry-workstream]],
[[clinical-report-template-workstream]], [[lab-identity-letterhead]], [[report-pdf-table-layout]],
[[pdf-table-cell-overlap]], [[dont-hardcode-use-terminology]].
