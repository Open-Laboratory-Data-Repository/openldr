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
   an identifier and the address. `Location`, if used at all, is a bench/room *inside* it. Chosen
   because the data arrives as an institution, not a room, and because only Organization can
   plausibly carry an address.
2. **CE-only, keyed on what we actually have.** No national facility list is available, so the
   registry reconciles against the observed display names. The national code is an **optional**
   field that stays empty until such a list exists.
3. **The registry IS a set of FHIR `Organization` resources**, edited in Studio, versioned through
   `change_log` and projected to `facilities` — reusing existing machinery and syncing for free.
4. **The upstream toolchain is out of scope**; its requirement is documented here (§6).

Explicitly **not** a goal: DHIS2 org-unit alignment. DHIS2 is not a core CE feature, and
facility-level AMR is not identifiable from this source. Closing BUG 11 would be a *consequence* of
a coded facility arriving upstream, not a driver of this work.

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

## 7. Out of scope

DHIS2 org-unit mapping, a national facility list importer, facility hierarchies (district → region),
and any change to `cdr-toolchain`.
