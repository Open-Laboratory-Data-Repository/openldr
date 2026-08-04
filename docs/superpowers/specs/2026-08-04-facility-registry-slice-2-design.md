# Facility registry Slice 2 — hand entry

**Date:** 2026-08-04
**Status:** Agreed, not implemented.
**Builds on:** `2026-08-04-facility-registry-model-design.md` (the model) and slice 1, which shipped
the tables, `createFacilityRegistryStore` and `parseFacilityCsv` — **none of which anything calls yet.**

**Goal:** an operator can create, list and edit a facility. That is the smallest thing that makes
slice 1 real, and everything else in the workstream depends on it.

---

## 1. Falsification — checked before designing

### 1.1 Nothing wires slice 1 up

Grepped: **no caller of `createFacilityRegistryStore`, no caller of `parseFacilityCsv`.** The store
is not on `AppContext`; there are no routes and no page.

⚠ Worse than absent — **misleading**. The Facility form is fillable *today*: it is published to
`targetPages: ['forms']`, so an operator can complete it on the Forms page and it saves a **form
response**, not a facility. Slice 1 built the destination; nothing routes to it.

### 1.2 Three gates, in series, all currently closed

Any one alone yields an empty Facilities page:

| Gate | State | Consequence |
|---|---|---|
| `PAGE_TARGETS` facilities | `available: false` | the form builder will not offer facilities as a target |
| Facility form `targetPages` | `['forms']` | not pointed at the page |
| Facility form `status` | `'draft'` | `listPublishedForms('facilities')` returns nothing |

The third gate is self-healing: `upsertPublishedForms` publishes seeded drafts. The first two are not.

### 1.3 The Users pattern, precisely

`UserDialog.tsx` calls `listPublishedForms('users')`, takes the **first published** form, fetches it
with `getForm(id)`, **zod-validates the server's schema before trusting it**, and renders
`FormRuntime`. On save it splits answers: `CORE_KEYS` (`firstName`/`lastName`/`email`) → real
identity fields, **everything else → `extras[apiProperty] = { value, fhirPath }`**. The record stores
`formSchemaId` + `formVersion`.

⚠ `def.id` (the form-DEFINITION id) is what the reference-search route wants — `schema.id` is the
schema's own slug and 404s. `UserDialog` documents this; the Facilities page must not repeat the
mistake.

### 1.4 ⛔ The form's fields would defeat the column design

The seeded Facility form gives `apiProperty` to **`name` and `localId` only**. Level, Country,
District, Region and Phone have **none at all** — and under the Users pattern a field without an
`apiProperty` falls into `extras`.

So as it stands, `region`, `district`, `status` and `level` would all land in `extras`: unindexed and
unjoinable — **exactly what making them columns was for.** This is not a later cleanup; it decides
the slice.

### 1.5 ⛔ A corrected form cannot reach an existing install

`upsertPublishedForms` is **create-if-absent, deduped by NAME**. When a form of that name exists it
only publishes a draft — it **never re-snapshots the schema**. So editing `sampleForms` reaches
**fresh installs only**.

And the Facility form is **not** in `ESSENTIAL_FORM_NAMES` (only `Users` and `Lab order` are), so an
install without `SEED_ON_START` has no Facility form at all.

This is the same class of problem S5 solved for report designs, and the precedent is direct: **the
Users page needs a published `users` form, which is exactly why that form is essential.**

### 1.6 Capabilities need no migration

Migration 067's `FROZEN_CAPABILITY_KEYS` list is **frozen and must never be edited**. Its contract:
a key **absent** from `capability_introductions` has never existed on this install, so
`seedSystemRoles()`'s reconciliation grants it to the preset roles `presets.ts` names. A new
capability therefore reaches existing installs by being added to the **catalog and presets only**.

## 2. Decisions (user)

1. **`apiProperty` names the column**; an unrecognised one falls to `extras`. The Users `CORE_KEYS`
   split with ~15 core keys instead of 3.
2. **The split happens SERVER-SIDE** from the submitted answers, so the core-key list has one home.
   (Users splits client-side; with 3 keys that is fine, with 15 it is a drift risk.)
3. **The form carries only the required set** — `localCode`, `name`, `country`, `zone`, `region`,
   `district`, `status`, `level`.
4. **The form becomes essential, plus a one-time migration** repointing an existing untouched copy.

## 3. Wiring the store

`createFacilityRegistryStore(internal.db, referenceCapture)` → `AppContext.facilityRegistry`.

It takes the capture binding so registry writes land in `reference_change_log` ready for the
eventual down-sync. ⚠ `packages/bootstrap/src/index.test.ts` pins the set of stores constructed with
`referenceCapture`; that assertion moves with this.

## 4. The split

A pure function beside `FacilityRecord` in `@openldr/db`, so the core-key list cannot drift:

```
CORE_FACILITY_KEYS = localCode, nationalCode, nationalSystem, name, level, ownership, status,
                     country, zone, region, district, council, ward, village,
                     addressText, phone, latitude, longitude

splitFacilityAnswers(schema, answers) -> { record: Partial<FacilityRecord>, extras }
```

For each field in the schema: resolve its `apiProperty`; if it is in `CORE_FACILITY_KEYS` the value
becomes `record[key]`, otherwise `extras[apiProperty ?? field.id]`. `latitude`/`longitude` coerce to
number or null; everything else is trimmed text with `''` → omitted.

**Why server-side:** a client cannot be trusted to decide which answers become indexed columns, and
duplicating fifteen key names across the page and the route is a silent-drift risk. The route takes
`{ answers, formSchemaId, formVersion }` and does the split itself.

## 5. Routes

`apps/server/src/facilities-routes.ts`:

| Route | Capability |
|---|---|
| `GET /api/facilities` (list, filterable by region/district/council/status) | `facilities.view` |
| `GET /api/facilities/:id` | `facilities.view` |
| `POST /api/facilities` | `facilities.manage` |
| `PUT /api/facilities/:id` | `facilities.manage` |
| `DELETE /api/facilities/:id` | `facilities.manage` |

Every mutation audited (`facility.create` / `.update` / `.delete`).

⚠ **`POST` must generate the `id`** (`randomUUID`), never accept one from the client — the parser
derives ids deterministically from `sha256(nationalSystem|nationalCode)`, and a client-supplied id
could collide with an import's row and silently overwrite it.

New capabilities `facilities.view` / `facilities.manage` go in `packages/rbac/src/catalog.ts` and the
appropriate entries of `presets.ts`. **Do not touch migration 067's frozen list** (§1.6).

## 6. The form, the page target, and delivery

**Form** (`packages/forms/src/samples/forms.ts`): exactly eight fields, each with an `apiProperty`
naming its column — `localCode`, `name`, `country`, `zone`, `region`, `district`, `status`, `level`.
`targetPages: ['facilities']`. Name stays `Facility`, and it joins `ESSENTIAL_FORM_NAMES`.

⚠ `status` and `level` stay **free text**, not selects with baked-in options. Hardcoding
"Operating/Closed" would inline a vocabulary into source; the field type already supports
`valueSetUrl`, so binding a ValueSet later is a form edit, not a code change.

**Page target:** `available: true`, `requiredKeys: ['localCode', 'name']` — the DB-required pair, not
today's `['name']` alone.

**Migration** repointing an existing install's copy: target the deterministic id
`form-sample-facility`, set `targetPages` to `['facilities']` and publish it — **but only when the
stored schema still matches the shipped seed**, so an operator who has already edited the form is
never clobbered. An edited form is left alone and the page shows its empty state.

## 7. The page

`apps/studio/src/pages/Facilities.tsx`, mirroring `Users.tsx`: a table of facilities plus a
`FacilityDialog` that loads the first published `facilities` form, zod-validates it, and renders
`FormRuntime`. Route, nav entry, i18n en/fr/pt.

**Empty state matters here** and must distinguish the two causes: *no published facilities form*
(link to the Forms builder) versus *a form exists but no facilities yet* (invite to add one). Merging
them into one "nothing here" message is how §1.2's gates stay invisible.

## 8. Testing

- `splitFacilityAnswers`: known `apiProperty` → column; unknown → `extras`; **a field with NO
  `apiProperty` → `extras`, never silently dropped**; coordinates coerced; blank omitted.
- Routes: capability gating on each; audit emitted; `POST` ignores a client-supplied `id`; validation
  rejects a body missing `answers`.
- Seed: the Facility form targets `facilities`, is in `ESSENTIAL_FORM_NAMES`, and **every field has an
  `apiProperty`** — the §1.4 regression guard.
- Migration: an untouched `form-sample-facility` is repointed and published; **an EDITED one is left
  untouched** (the clobber guard).
- Page: renders the form; shows the *no-form* empty state distinctly from the *no-facilities* one.
- i18n parity (en/fr/pt is enforced).

## 9. Out of scope

Reconciliation of the 23 observed `performer` strings, the entity resolver so a lab order can
reference a facility, the CLI import, `upsertByNationalCode`, and sync serve/apply.

⚠ **`nationalCode` is deliberately absent from the form**, so a hand-entered facility cannot be
linked to the national register from the UI yet. The CHECK still passes because hand-entered rows
carry `localCode`, and adding the field later is a form edit with **no migration** — the property
this design exists to buy.
