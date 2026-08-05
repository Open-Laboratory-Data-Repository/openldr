# Facility CSV import — Design

**Goal:** make the facility registry **populatable**. Slice 1 built and tested `parseFacilityCsv`
and left it unreachable; nothing in the repo calls it. An operator can create facilities one at a
time and cannot load a national register at all.

**Context:** OpenLDR runs as a **national instance in an MoH data centre**, not per-lab (the only
per-lab deployment is the poor-connectivity case that distributed sync serves). The registry
canonicalises the health facilities that appear in incoming data — today that is
`diagnostic_reports.performer`, projected from `DiagnosticReport.performer[0].display`, i.e. the
**testing lab**, arriving as a 30-char truncated free-text name with 23 distinct values. A facility's
*role* (performer on one report, requester on another) is contextual; the registry is one list.

---

## 1. Measured state (verified, not assumed)

| Fact | Evidence |
|---|---|
| `parseFacilityCsv` has **zero callers** — no CLI command, no route, no UI | repo-wide grep |
| It returns `{ records, unknownColumns, skipped }` from `(csv, { nationalSystem, allowUnknownColumns? })` | `packages/terminology/src/facility-csv.ts:25,67` |
| ⭐ It derives `id = sha256(nationalSystem\|nationalCode).slice(0,16)` — a **pure function of those two fields** | `facility-csv.ts:96`, `idFor` |
| `store.upsert` conflicts on `id` with `doUpdateSet` | `facility-registry-store.ts:277` |
| `facility_registry` has a **partial unique index** on `(national_system, national_code) WHERE national_code IS NOT NULL` | `070_facility_registry.ts:53-57` |
| The Facility form does **not** capture `nationalCode` | `packages/forms/src/samples/forms.ts` |
| PUT replaces the `extras` bag **wholesale** | `apps/server/src/facilities-routes.ts` |

### 1.1 ⛔ `upsertByNationalCode` is NOT needed — the deferred note overstated the gap

Slice 1 deferred it saying "upsert conflicts on `id` only while re-import is keyed on
`(national_system, national_code)`". But `id` **is** `hash(nationalSystem, nationalCode)`, so for
every importer-created row those two keys are *the same key*. Re-importing a newer release of the
same register already updates in place, and any attached aliases already survive.

⇒ Building `upsertByNationalCode` now would be speculative. **Out of scope.**

The genuine residual gap is different and belongs to reconciliation, not import: a **hand-created**
row carries a random uuid and `national_code = NULL` (the form cannot set one), so the partial index
does not apply. When the national register is later imported, that facility exists **twice** — once
hand-created, once imported. That is not an error and not silently wrong data; it is exactly what
`facility_aliases` and a reconciliation screen exist to resolve. §6.

---

## 2. What ships

### 2.1 A shared import function

One function in `@openldr/bootstrap` that both entry points call, per the repo's CLI-parity rule
(new operator features must exist as `openldr` CLI commands too, sharing logic).

Contract: parse → report → optionally apply. It returns counts (`parsed`, `skipped`,
`unknownColumns`, `created`, `updated`) so both surfaces can show the same summary.

### 2.2 CLI

`openldr facilities import <path> --national-system <sys> [--dry-run] [--allow-unknown-columns] [--json]`,
following `terminology import <kind> <path>`'s shape.

### 2.3 Facilities-page upload

An **Import facilities** item in the page's ⋯ menu, opening a sheet: choose file, state the national
system, see the dry-run summary, then confirm. Gated on `facilities.manage`.

### 2.4 The `extras` fix (server-side)

Editing a facility currently destroys importer-written `extras`: the parser puts unrecognised columns
into `extras` under raw header names, `seedAnswers` only iterates the form's fields, and PUT replaces
the bag wholesale. Unreachable **today only because nothing imports** — this slice makes it live, so
it must land here.

Fix: on PUT, preserve the `extras` keys the submitted form's field list does **not** map, and let the
form's own fields own the keys they do map. That keeps clearing an extra working *and* protects
importer keys.

---

## 3. Decisions carried from the model spec (already settled — do not relitigate)

- **Dry-run by default.** An import that silently rewrites 14 000 rows is not acceptable; the
  operator sees counts first.
- **Rows absent from a new import are NEVER deleted.** An incomplete export must not orphan aliases.
- **Unknown columns block the import unless explicitly allowed**, then ride into `extras`. The
  parser already implements this; both surfaces must surface `unknownColumns` rather than swallow it.
- **`nationalSystem` is configuration, never hardcoded** — HFR/MFL differ per country.
- `managed_origin` stays **NULL** on an imported row. Slice 1 fixed an inverted version of this: the
  parser once stamped `'central'`, which made a lab's own imported rows deletable by a central
  down-sync. The receiving applier stamps origin, not the importer.

---

## 4. Traps this slice inherits

- ⛔ The parser is **BOM-tolerant and lowercases headers** because an Excel/gov export emits a UTF-8
  BOM that otherwise rejects the whole file naming a column that looks correct. Do not "simplify"
  the read path.
- ⛔ A ragged row must not throw — the parser uses `relax_column_count` so one unescaped comma cannot
  kill a 14k-row import; it counts toward `skipped`.
- ⚠ A **14k-row** import is the stated workload. Insert in batches; a per-row loop is the pattern that
  has repeatedly tipped this repo's suites over their timeouts.
- ⚠ `latitude`/`longitude` are `double precision`; node-postgres returns `numeric` as a **string**,
  which is why slice 1 changed the column type. Do not reintroduce a numeric column.
- ⚠ Importing writes `reference_change_log` via the store's capture binding — that is wanted (the
  registry syncs central→lab), but it means a 14k import writes 14k capture rows. Confirm that is
  acceptable or batch it.

## 5. Out of scope

`upsertByNationalCode` (§1.1); reconciling the 23 truncated `performer` strings; the entity resolver
so an order can reference a facility (Slice B — it needs its own brainstorm, since which role an
order references is unsettled); ward/village.

## 6. The duplicate a later slice must resolve

Hand-created row (uuid id, `national_code` NULL) + imported row (hashed id, code set) = the same
real facility twice. Detecting and merging those is the reconciliation screen's job, alongside the
23 `performer` strings. This slice must not guess at a merge.

Related: [[facility-registry-workstream]], [[cli-operator-parity]],
[[terminology-distribution-upload-workstream]], [[dont-hardcode-use-terminology]].
