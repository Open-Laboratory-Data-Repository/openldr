# Patient Index design

Date: 2026-10-12
Status: draft for operator review

## Why

Zambia runs a Master Patient Index shared by two systems. The other system is a HIMS and owns the
patient record. Lab staff still need one place in CE to find a patient and see where they were
tested, the same way Facilities and Test Catalog give one place for facilities and tests.

Mozambique and Zambia send patient identifiers. Tanzania does not. CE avoids showing identifiers by
default, so the page must work with none, and must hide them from anyone not allowed to see them.

The user action that is broken today: a lab user cannot look up a patient by an MPI number, NRC or
folder number in CE at all. No patient page or patient route exists.

## Scope

In:

- A read-only Patient Index page at `/patients` with a list, a detail sheet and an Identifier
  systems tab.
- Every `Patient.identifier` kept in the warehouse, not only the first one.
- Labels for identifier systems, set by an operator.
- Server-side masking with three new capabilities.
- CLI parity, docs in en, fr and pt, mobile view, changelog.

Out, each a possible later slice:

- Duplicate detection and merge. Merge already exists as `openldr sync merge-patient`.
- Results shown inside the detail sheet.
- Export.
- Creating or editing patients. The HIMS owns them, so the forms `patients` page target
  (`packages/forms/src/page-targets.ts:44`) stays `available: false`.

## What exists today

- `patients` table: id, patient_guid, surname, firstname, date_of_birth, sex, national_id, phone,
  email, managing_organization, active, replaced_by_id (`packages/db/src/schema/external.ts:11-24`).
- The projection keeps only `identifier[0].value` as `patient_guid` and drops its system
  (`packages/db/src/relational/patient.ts:14`). `national_id` is always null (`patient.ts:20`).
- A resource can own rows in another table. The writer replaces the whole set on each new version
  (`packages/db/src/relational/index.ts:55-80`). `lab_request_attributes` uses this today.
- `openldr db reproject --force` rewrites every projected warehouse row
  (`packages/cli/src/program.ts:202-205`).
- Patient columns are hidden from analytics by default (`packages/dashboards/src/models/registry.ts:17-18`)
  and badged as PII (`registry.ts:41-42`).
- Terminology concepts carry a free `properties` object and edits keep keys they do not manage
  (`packages/db/src/terminology-admin-store.ts:183,293`).
- `recordAuditEvent` writes audit rows (`packages/bootstrap/src/record-audit.ts:17`).
- Capabilities are rows in `packages/rbac/src/catalog.ts`. Presets are in `presets.ts`. Boot grants
  a new key to Administrator always, and to unlocked presets once
  (`packages/db/src/role-store.ts:322-372`).
- The next external migration number is `025`. The last is `024_lab_result_status.ts`.

## 1. Data

### Warehouse table `patient_identifiers`

External migration `025_patient_identifiers`.

| Column | Type | From |
|---|---|---|
| `patient_id` | text, not null | `Patient.id` |
| `system` | text, null | `identifier.system` |
| `value` | text, not null | `identifier.value` |
| `type_code` | text, null | `identifier.type.coding[0].code` |
| `type_text` | text, null | `identifier.type.text`, else `coding[0].display` |
| `use` | text, null | `identifier.use` |
| provenance columns | | same as other warehouse tables |

Indexes: `(system, value)` for search, and `patient_id` for the owned-rows replace.

An identifier with no `value` is skipped. An identifier with no `system` is kept with a null
system, and the page groups those under "No system".

The migration must run on every target dialect the warehouse supports, like 024 does. It is pinned
in the external migrations test.

### Projection

Add `Patient` to `projectOwnedRows` and `ownedTablesFor` in `packages/db/src/relational/index.ts`,
scoped on `patient_id`. A new projector function writes one row per identifier. A Patient version
that drops an identifier removes its row, because the writer replaces the set.

`patient_guid` and `national_id` do not change. Reports that read `patient_guid` keep working.

Existing installs fill the new table with `openldr db reproject --force`. The upgrade note says so.

### Analytics exposure

Add `patient_identifiers` to `HARDCODED_DENY_UNION` (hide `patient_id`, `value` and the internal
provenance columns) and to `PII_COLUMNS` (`value`). The table is hidden unless an operator un-hides
it in Data Exposure.

### Identifier system labels

Labels live in a terminology code system, `urn:openldr:cs:patient-identifier-system`. Bootstrap
creates it on first write, the way `addRegisterFacilityType` creates a register's own system
(`packages/bootstrap/src/facility-register-vocabulary.ts:53`). Nothing is seeded in a migration.

One concept per identifier system:

- `code` is the system URI as received.
- `display` is the operator's label, for example "NRC" or "ART number".
- `properties.listColumn` (boolean, default false) shows that identifier as a column in the list.
- `properties.searchable` (boolean, default true) lets search match that system.

Label used on screen, in order: the concept display, else the most common `type_text` seen for that
system, else the system URI.

Terminology and warehouse are in different databases, so the server reads labels separately and
joins them in code.

## 2. Access and masking

### Capabilities

| Key | Label | Grants |
|---|---|---|
| `patients.view` | View patient index | Open the page. See masked rows. Search by exact identifier. |
| `patients.view_identifiers` | View patient identifiers | See names, identifiers, date of birth, phone and email in full. Search by name. |
| `patients.manage` | Manage patient index | Edit identifier system labels and flags. |

Presets: Lab Manager gets all three. Data Analyst and System Auditor get `patients.view`. Lab
Technician gets none. Administrator gets every key, as for every capability.

Studio uses `patients.view` on the route and the nav item.

### Masking

One bootstrap module builds every patient response, for the routes and the CLI alike. Masking
happens there, so an identifier never leaves the server for a caller without
`patients.view_identifiers`.

Without `patients.view_identifiers`:

| Field | Returned as |
|---|---|
| surname, firstname | first letter then `***`, for example `J*** M***` |
| identifier values, patient_guid | `•••` plus the last 4 characters; values of 4 or fewer characters become `•••` |
| date of birth | birth year only |
| age | returned, in whole years |
| phone, email | omitted |
| sex, managing facility, active, request dates and counts | returned |

### Patient references

A patient's resource id can carry an identifier. The HL7 v2 converter builds `Patient/hl7-{patient_id}`
from PID-3 (`wasm/hl7v2/src/mapping.rs:55`). So no masked response carries the id. Every row carries
`ref`, the id sealed with AES-256-GCM under a random key made when the process starts. Detail routes
take `ref`. Unmasked rows carry `id` as well. A `ref` stops working after a restart. The CLI takes the
raw id.

### Search

- With `patients.view_identifiers`: substring match on surname, firstname and patient_guid, and
  exact match on any searchable identifier value.
- Without it: exact match on a searchable identifier value or patient_guid only. Partial name search
  would let a masked user recover a name one letter at a time.

### Audit

- Every unmasked detail view writes an audit event with the patient id.
- Every unmasked search writes an audit event with the result count.
- The search text is never recorded. It is often an identifier.
- CLI calls with `--identifiers` audit as `actorName: 'cli'`.

## 3. Studio UI

Copy `apps/studio/src/pages/TestCatalog.tsx`, not `Facilities.tsx`, as Test Catalog's own header
says (`TestCatalog.tsx:28-31`). Follow `AGENTS.md` §5.

Nav: "Patients", under Test Catalog in `apps/studio/src/shell/AppShell.tsx`, gated on
`patients.view`.

### Patients tab

- `DataTableToolbar` with search (debounced 250 ms) and an Active or Merged filter.
- Columns: name, sex, age, identifiers, managing facility, last request date, request count. The
  identifiers column stacks each `listColumn` identifier as `Label: value`. Table headers are i18n
  keys, so an operator's label cannot be a header without changing the shared table.
- Per-row ⋯ menu with View. Clicking a row also opens the detail sheet.
- No header ⋯ menu, because the tab has no actions. The page does not create, import or export.
- `TablePagination`. `StripedEmpty` when empty, `LoadingState` while loading, in a `colSpan` cell.
- Without `patients.view_identifiers`, the list still shows masked rows, and the search placeholder
  says "Exact identifier" so a masked user knows partial names will not match.

Managing facility shows `facility_name` from the warehouse `facilities` table when its id matches
`managing_organization` without the `Organization/` prefix, else the raw reference. That table holds
projected Organizations, which is what the reference points at.

### Identifier systems tab

- One row per system seen in `patient_identifiers`: label, system URI, patient count, list column,
  searchable.
- Per-row ⋯ menu with Edit, shown only with `patients.manage`. Edit opens a sheet with label left,
  input right: label, list column switch, searchable switch.
- `TablePagination`, `StripedEmpty`, `LoadingState`.

### Detail sheet

- Identity block: name, sex, date of birth or birth year, age, managing facility, active or merged.
- Identifiers: label and value, one row each.
- Merged: "Replaced by" with the target patient, which opens that patient's sheet.
- Requests: a paginated table of this patient's `lab_requests`, newest first, with authored date,
  panel, requesting facility, status and result count. Order by `authored_at desc, id` so paging is
  stable (`AGENTS.md` §7).

### Mobile

Check at 375x812. The list must not scroll sideways when empty. The detail sheet must fit the phone
width.

## 4. Server routes

In a new `apps/server/src/patient-routes.ts`, registered in `app.ts`.

| Route | Capability |
|---|---|
| `GET /api/patients?search=&status=&offset=&limit=` | `patients.view` |
| `GET /api/patients/:ref` | `patients.view` |
| `GET /api/patients/:ref/requests?offset=&limit=` | `patients.view` |
| `GET /api/patients/identifier-systems` | `patients.view` |
| `PUT /api/patients/identifier-systems` (body has the system URI) | `patients.manage` |

The system URI goes in the body, not the path, because URIs carry slashes and colons.

Each route checks `patients.view_identifiers` and passes it to the bootstrap module. Route tests
pin the masked and unmasked response shapes.

## 5. CLI

`packages/cli/src/patients.ts`, registered in `program.ts`.

- `openldr patients list [--search <text>] [--status active|merged] [--identifiers] [--json]`
- `openldr patients show <id> [--identifiers] [--json]`
- `openldr patients identifier-systems list [--json]`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`

Masked by default. `--identifiers` unmasks and writes the audit events.

## 6. Docs and changelog

- In-app docs `apps/studio/src/docs/<current>/{en,fr,pt}/patients.md`, registered in
  `apps/studio/src/docs/registry.ts`.
- Web docs `apps/web/src/docs/<current>/patients.md`, plus `content.ts`, plus `cli.md`.
- Studio strings in `apps/studio/src/i18n/{en,fr,pt}.ts`.
- `docs/CLI-REFERENCE.md` and `docs/HTTP-API.md`.
- An upgrade note: run `openldr db reproject --force` to fill identifiers for existing patients.
- `pnpm make:changelog` after merging to `main`.

## 7. Testing

- Projector unit tests: several identifiers, a missing system, a missing value, type text fallback,
  and a new version that drops an identifier.
- Migration test for 025 on pg-mem.
- Bootstrap masking tests: every field in the masking table, both ways.
- Route tests: masked and unmasked shapes, masked partial-name search returns nothing, audit rows
  written for unmasked calls and not for masked ones, search text absent from audit.
- Studio tests for the page, the tab and the sheet.
- CLI tests for each command.
- The full gate with `--force --concurrency=2` on test and typecheck.

Layers these do not prove: pg-mem is not Postgres, so the `(system, value)` index and order ties need
the live check.

Live check after merging to `main`: ingest a Patient with three identifiers, reproject, label one
system, mark it a list column, search by it masked and unmasked, open the sheet, and check the audit
log.

## Open points

- Terminology sync. Checked: a lab that pulls a code system from central stamps it
  `managed_origin = 'central'` (`packages/sync/src/terminology-sync.ts:114`). The label edit refuses
  with 409 there, as result fields do (`packages/bootstrap/src/result-fields.ts:71-83`).
- Bottom-anchored UI in the sheet can only be confirmed on a real phone.
