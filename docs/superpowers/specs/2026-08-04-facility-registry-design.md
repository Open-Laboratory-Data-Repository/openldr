# Facility registry — canonical sending facilities

**Date:** 2026-08-04
**Status:** Scoped, NOT started. Sibling of `2026-08-04-lab-identity-letterhead-design.md`, which
does **not** depend on it.
**Related open bug:** DHIS2 **BUG 11** (facility dimension lost end to end).

---

## 1. The problem, measured

CE has no canonical record of the facilities that send it work. Measured on a live dev database
(1303 diagnostic reports, 589 patients):

| Fact | Value |
|---|---|
| Rows in `facilities` | **2** — `seed-org` "Seed Central Lab", `seed-loc` "Seed Bench" (demo seed) |
| Real facilities ever ingested | **0** |
| `facilities.facility_code` populated | **0 of 2** |
| `patients.managing_organization` populated | **1 of 589** |
| `diagnostic_reports.performer` populated | **1303 of 1303** |
| Distinct `performer` values | **23** |
| `max(length(performer))` | **30**, with **15 rows sitting at exactly 30** |

So the facility dimension **does** exist — but only as `diagnostic_reports.performer`, and only as a
**free-text display name, truncated to 30 characters**: `Dodoma`, `Mwananyamala`, `Mnazi Mmoja`,
`Kibondo`, `HYDOH`, `Muhimbili`, `Aga Khan`, `Sekou-Toure`, `NHLQATC`, `Mount Meru`,
`International School of Tangan`…

Consequences today: `q-amr-facility-summary` and the `q-facilities` filter are effectively empty
(they read `managing_organization`), and there is no way to say what "Dodoma" actually is.

## 2. Decisions taken (user)

1. **Organization is the facility.** One `Organization` per institution, carrying the local code as
   an identifier and the address. `Location`, if used at all, is a bench/room *inside* it.
   ⚠ **REVISIT — one of the two reasons given for this was FALSE.** "Only Organization can
   plausibly carry an address" is wrong: `Location.address` exists in CE's own FHIR schema
   (`packages/fhir` Location, `address: Address.optional()`), and the shipped Facility form already
   maps `address.country` / `address.district` / `address.state` onto a **Location**. The surviving
   reason (the data arrives as an institution, not a room) is real but weaker, and **every existing
   consumer anchors on Location** — the Facility form (§2a), the DHIS2 Org Units tab
   (`listByType('Location')`), and `bootstrap/index.ts:1323`. Choosing Organization means migrating
   all of them; see §4 trap 4. Settle this before slice 1.
2. **CE-only, keyed on what we actually have.**
   ⚠ **CORRECTION — a national list DOES exist.** Tanzania's HFR publishes **14,209 facilities**
   with exactly the fields this registry wants: facility code (`122023-5`), name, type
   (`Level IA2 (Dispensary Laboratory)`), region, council, ownership, operating status, address
   (Zone–Region–District–Council–Ward–Village) and phone. **What is missing is a BULK EXPORT** —
   records are viewable and printable one at a time, not downloadable as a set. So the national code
   is not unavailable, it is *unbatchable*: it has to be attached per facility, by hand or by a
   per-record fetch. That makes the reconciliation screen (§3) more important, not less — it becomes
   the place an operator pastes an MFL code the first time a facility is seen.
3. **The registry IS a set of FHIR `Organization` resources**, edited in Studio, versioned through
   `change_log` and projected to `facilities` — reusing existing machinery and syncing for free.
4. **The upstream toolchain is out of scope**; its requirement is documented here (§6).

Explicitly **not** a goal: DHIS2 org-unit alignment. DHIS2 is not a core CE feature, and
facility-level AMR is not identifiable from this source. Closing BUG 11 would be a *consequence* of
a coded facility arriving upstream, not a driver of this work.

## 2a. ⚠ A Facility form ALREADY EXISTS — and it has a defect

`packages/forms/src/samples/forms.ts` seeds a published **Facility** form
(`id: 'sample-facility'`, "drives the facilities management page") with exactly the shape this spec
was about to design:

| Field | fhirPath |
|---|---|
| Name (required) | `name` |
| **Local ID** | `identifier.value` |
| **MFL ID** | `identifier.value` |
| Level | `physicalType` |
| Country / District / Region | `address.country` / `address.district` / `address.state` |
| Phone | `telecom.value` |

Two things follow.

1. **`fhirResourceType: 'Location'`** — the existing model already chose Location, contradicting §2
   decision 1.
2. **⛔ `Local ID` and `MFL ID` write to the SAME `fhirPath`** (`identifier.value`) with **no
   `identifier.system` to tell them apart.** The one form meant to carry the local↔national code
   pair therefore cannot distinguish them: on write they collide, and on read there is no way to
   know which identifier is which. This is the single most load-bearing defect for the whole
   registry — the local→national mapping is *exactly* these two values — and it must be fixed
   before the form is used to capture anything real.

So the registry is further along than §1 suggests: the capture surface exists. What is missing is a
distinguishable identifier system, a resolver so the form's facilities can be *referenced* from a
lab order (§4a), and reconciliation for the legacy strings.

## 3. Shape

**Registry records** — `Organization` resources with: canonical (untruncated) `name`, `address`,
optional `identifier` entries for a local code and a national code, and **aliases**.

**Aliases are the load-bearing idea.** The join key we have is a truncated display string, so each
Organization carries the observed strings that mean it. `Mnazi Mmoja` and a 30-char truncation of
the same name both attach to one record, and future ingests match automatically.

**Reconciliation screen** — lists the distinct `performer` values with their row counts, each either
attached to a registry Organization or unattached. The operator attaches or creates. This is the
same shape as terminology's local→standard mapping UI, applied to facilities, and it is the whole
point of the feature: 23 decisions, made once.

## 4. ⚠ Traps this must handle

1. **`Organization.address` is DROPPED by the projection.** `projectFacility`
   (`packages/db/src/relational/facility.ts`) writes `id`, `facility_code`, `facility_name`,
   `facility_type`, `source_resource` and nothing else — there is no address column on `facilities`.
   An address needs both a column and a projection change.
2. **A resource written WITHOUT a `change_log` row never reaches the projection.** Same defect class
   that bit ValueSet seeding — save through the admin store, not by writing the table directly.
3. **`facility_code` comes from `firstIdentifier(r)`.** Registry Organizations must carry an
   identifier or they project with a NULL code, exactly like the two seed rows.
4. **Both `Organization` and `Location` project into `facilities`**, discriminated only by
   `source_resource` (`packages/db/src/relational/index.ts:38-39`). Anything reading `facilities` as
   "the facility list" gets both kinds unless it filters.
5. **Reconciliation must be re-runnable.** New `performer` values appear with every ingest; the
   screen has to show what is newly unattached rather than assuming a one-time pass.

## 4a. Manual capture — the registry's second, better data source

Manual data entry is not merely another consumer. **A hand-entered order picks a facility from the
registry and records a real `Organization/<id>` reference** — no truncation, no ambiguity, no
alias-matching. It is the one path that produces clean facility data, which inverts part of §1: the
registry is not only for reconciling 23 legacy strings, it is a **prerequisite for a manually
captured order to carry a facility at all**.

**The extension point already exists; the resolver does not.** A form field declares
`referenceTarget` and the model is generic — `{ kind: 'entity'; target: string }`
(`packages/forms/src/reference-source.ts:6`) — but the server registers exactly one entity
resolver: `ENTITY_TARGETS = ['Patient']` (`packages/db/src/reference-search.ts:19`). Tests are not
entities; they resolve through the *coding* path (ValueSet/CodeSystem).

⚠ A form declaring `referenceTarget: 'Organization'` therefore **publishes successfully** — by
design, so a form can bind to a not-yet-installed source — and fails only at search time with
`no resolver registered for entity target 'Organization' (known: Patient)`. A facility picker that
"looks wired but returns nothing" is the predictable first bug here.

The work is the Patient pattern repeated: a `createOrganizationResolver` over the registry, plus one
entry in `ENTITY_TARGETS`, plus the Lab-order form gaining a facility field. Note the Patient
resolver's documented caveat applies equally — it deliberately does **not** consult `columnPolicy`,
because that policy governs analytics exposure and would deny every column the picker needs.

## 5. Consumers to rewire (after the registry exists)

- `q-facilities` (the report facility filter) — currently `select distinct managing_organization`,
  which is 1 row. Should read the registry.
- `q-amr-facility-summary` — same root cause.
- Anything that wants an address (the letterhead does **not**: §1.3 of the sibling spec).

## 6. The upstream ask (documented, not built)

CE cannot invent a code that was never sent. For the registry to key on a stable code rather than a
truncated name, `cdr-toolchain` should:

- emit an `Organization` per facility with the CDR's `testing_facility_code` /
  `requesting_facility_code` as `Organization.identifier` (with a stable identifier `system`), and
- carry the **untruncated** facility name in `Organization.name`, and
- reference it from the request/report rather than passing only a display string.

Per BUG 11 the source already carries those codes on `V2LabRequest`; the transform currently maps
only `testing_facility_code.display_name` into a display string.

When that lands, the registry re-keys from alias-matching onto code-matching, and the aliases become
a historical fallback for data ingested before the change.

## 7. Suggested slice order

1. **Registry CRUD** — Organization resources editable in Studio, projected to `facilities`
   (address column + projection change, §4 trap 1).
2. **Facility picker for manual capture** (§4a) — `createOrganizationResolver` + `ENTITY_TARGETS`.
   Independently useful the moment the registry has one row, and it is the path that produces
   *clean* facility data.
3. **Reconciliation screen** (§3) — attach the 23 observed strings to registry records via aliases.
   Last, because it is the only part that depends on legacy ingested data.

## 8. Out of scope

DHIS2 org-unit mapping, a national facility list importer, facility hierarchies (district → region),
and any change to `cdr-toolchain`.
