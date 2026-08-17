# Clinical Microbiology Report — accept the lab number

**Date:** 2026-08-17
**Status:** design, awaiting approval
**Scope:** the `request` parameter of `r-clinical-micro` and the two queries behind it. Nothing else.

---

## The problem

An operator ran the report with `TZDISATDS0010015` and got
`report pdf r-clinical-micro failed: no data for this report request · RP0005`.

The parameter is labelled "Request ID". It is not the request id the LIS sends. Both queries
filter on `lab_requests.id`, which carries a per-order suffix:

```
id                     request_id        panel_code
TZDISATDS0010015-obr1  TZDISATDS0010015  COL
TZDISATDS0010015-obr2  TZDISATDS0010015  LFT
...-obr8               TZDISATDS0010015  AMY
```

`q-clinical-micro-header` filters `where q.id = {{param.request}}`
(`packages/reporting/src/seed/report-seeds.ts:1923`). The lab number matches no `id`, so the header
returned zero rows, and the render gate refused (see "The gate" below).

**This is not only a labelling mistake.** DISA splits one microbiology result across two or three
orders under one lab number, so *no* single order id is the right answer:

```
TZDISATDS0013538-obr1  MSTRS  MICROBIOLOGY : STOOL       organism, no AST
TZDISATDS0013538-obr2  MSENS  Microbiology Sensitivity   organism + 8 AST rows
```

Pick `-obr1` and you get an organism with no susceptibilities. Pick `-obr2` and the header prints
panel "Microbiology Sensitivity" instead of the culture that grew the isolate. The per-order
parameter cannot produce a correct clinical microbiology report.

The lab number is also what the clinician holds and what the LIS sends. So the parameter should
accept it.

---

## Measured facts this design rests on

All measured against the live dev warehouse (`TARGET_DATABASE_URL`, Postgres in Docker), 2026-08-17.

| Fact | Measurement | Why it matters |
|---|---|---|
| One specimen per lab number | 240/240 orders share their lab number's single `-spec` id | The header can fold across orders without fanning out |
| Organism agrees across orders | 0 of 117 micro lab numbers carry two distinct organism values | The `organism` subquery can widen safely |
| `authored_at` is identical across a lab number's orders | 2995/2995 | **There is no clinical column that orders orders.** Rules out "show the first/culture panel" |
| Order suffixes reach double digits | max 15 orders; 21 lab numbers have ≥10; `-obr10` exists | Ordering by `id` as text is wrong — `obr10` sorts before `obr2` |
| Joined panel descriptions are long | 97 chars max, 48 avg, vs 28 for a single panel | Cannot put the joined list in the header (see "The header is full") |
| Exactly one order supplies the AST rows | 5/5 micro lab numbers, once anchored to an isolate | The panel field can name the table's source, deterministically |
| Micro lab numbers with no susceptibilities | 112 of 117 | Culture-only is the common case, not the exception; it must render |
| S/I/R alone is not a susceptibility | unanchored, the filter picks up `HIV Rapid EQA Test` panels | The isolate anchor is load-bearing, not decoration |

The `substituteParams` regex is global and inlines an escaped string literal
(`packages/dashboards/src/custom-query-run.ts:37`), so `{{param.request}}` may appear more than once
in one query.

---

## The gate — corrected

The PDF refusal is **not** driven by `primaryQueryId`. It is
`DESIGNS_REQUIRING_DATA = { 'rt-clinical-micro': 'hdr' }`, checked in `renderDataDriven`
(`packages/bootstrap/src/index.ts:259-263`): if the named design element resolves to zero rows,
throw `RP0005` instead of producing a PDF. The 2026-08-12 C1 spec chose `hdr` over `tbl` on purpose —
a culture with no sensitivities legitimately has zero AST rows, and gating on `tbl` would refuse
valid reports.

Two consequences:

1. `summaryMetrics: [{ id: 'agents', type: 'count' }]` stays on `q-clinical-micro-ast` and needs no
   change. `count` is `rows.length` of the primary query
   (`apps/studio/src/reports/lib/report-summary.ts:18`).
2. **Widening the parameter without further change would make the report worse.**
   `TZDISATDS0010015` exists in `lab_requests`, so the header would return a row and the report would
   render — a PDF titled "MICROBIOLOGY — CULTURE & SENSITIVITY" for a liver-function panel, with an
   empty organism and an empty table. A report-shaped PDF of nothing is exactly what C1 exists to
   prevent. So the header must require an isolate.

---

## The header is full

`hdr` binds ten label/value pairs in a 192pt box with **4pt of spare**
(`packages/reporting/src/seed/report-seeds.ts:2249-2262`). An eleventh row overflows and is
**clipped silently, with no error.** This design adds no field to the header. It may change what an
existing field contains.

---

## Design

### 1. Both queries accept either identifier

Both queries resolve the parameter against both columns, but they have different driving tables, so
the change is not the same edit twice.

`q-clinical-micro-ast` drives off `lab_results` and currently filters `r.request_id = {{param.request}}`.
It gains a join:

```sql
from lab_results r
join lab_requests q on q.id = r.request_id
where (q.request_id = {{param.request}} or q.id = {{param.request}})
```

`q-clinical-micro-header` already drives off `lab_requests q` and filters `where q.id = {{param.request}}`.
Its predicate widens in place to `where (q.request_id = {{param.request}} or q.id = {{param.request}})`,
and its two correlated subqueries (`organism`, and the `max(l.specimen_id)` lookups feeding the
`specimens` and `facility` joins) widen from `l.request_id = q.id` to every order under the resolved
lab number.

A per-order id keeps working, so any saved schedule or deep link that passes one is unaffected.
Written for all three dialects — Postgres, MSSQL, MySQL — as the existing queries are. MSSQL has no
ordinal `GROUP BY`, so the AST query's select expressions stay repeated in full, as they are today.

### 2. The header requires an isolate, and stays one row

The header gains a guard: the lab number must carry an `ORGS` or `634-6` observation on some order.
With no isolate it returns zero rows, and the existing `hdr` gate refuses with `RP0005`.

The fold is safe on the measured data: one specimen per lab number, one organism value per lab
number. Patient, specimen, received time, performing lab, and organism all fold without fanning out.
The `facility_of` / `facility_loc` / `facility` CTEs and their join guards are **unchanged** — this
design does not touch performing-lab resolution.

⚠ **Behaviour change on the per-order path.** Running the report on a collection order (`-obr1` COL)
renders today as a blank-organism, empty-table PDF. It will refuse instead. That is the C1 intent
applied to a case C1 missed, not a regression — but it is a change and is named here.

### 3. The susceptibility table gates on terminology, plus the isolate anchor

Today the filter is `coalesce(coded_value, abnormal_flag) is not null` — not restricted to
susceptibility interpretations. Widening the parameter to a lab number would pull in every coded row
under it: `MCSF` orders carry 5–6 microscopy results (pus cells, epithelial cells, gram stain), and
unanchored S/I/R picks up HIV EQA panels.

Two structural filters, no drug or panel code list — `AGENTS.md` §8:

- the interpretation must be a code in the existing `vs-ast-interpretation` value set;
- the lab number must carry an isolate (inherited from §2's guard).

A susceptibility test exists *because* a culture grew something, so the isolate requirement excludes
EQA and ARV panels by structure. This is the same anchor `q-amr-antibiogram`,
`q-amr-first-isolate-summary` and `q-amr-glass-ris` already use.

### 4. `Panel` names the order the table's rows came from

Chosen because it is the only option that is both deterministic and meaningful: exactly one order per
lab number supplies the AST rows (5/5 measured), so the header always names where the printed
susceptibilities came from. The document is self-consistent by construction.

Fallback for a culture-only lab number, which has no AST source order: the panel of an
organism-bearing order, tie-broken on `q.id`.

⚠ The tiebreaker is **stable but arbitrary.** Ten lab numbers have two organism-bearing orders, and
`q.id` ordering puts `-obr10` before `-obr2`. The pick is deterministic for a given dataset; it is
not "the culture panel". Naming the culture panel is impossible — there is no column that orders
orders (`authored_at` is identical across 2995/2995 lab numbers, and `created_at` tracks ingest, so a
reprojection would silently change a printed clinical field).

Not joining the panel list: 97 chars against a panel with 4pt of spare, clipped silently.
Not joining panel codes: fits at 23 chars, but prints codes where a clinician reads names — the
opposite of what the pathogen-name work concluded.

### 5. Help text on the parameter

Label stays **Request ID** — it matches what the LIS sends and what operators type. Help text states
it accepts the lab number, and that a specific order id also works.

---

## Explicitly not in this slice

- **No searchable picker.** `options(id)` returns the whole option list in one call with no search or
  paging (`packages/bootstrap/src/index.ts:678`). Facility works because facilities are bounded (89);
  lab numbers are not. A prior session reached the same conclusion for its own reason —
  `report-seeds.ts:2441`: "no param options: `request` is typed by the clinician, not picked from a
  lookup query." An async-search param type does not exist for report params and is not built here.
- **No bulk print.** `renderPdf(id, rawParams)` is one parameter set to one PDF
  (`packages/bootstrap/src/index.ts:674`). A date range prints in bulk because it is one parameter
  producing one document of many rows; a clinical report is one document per patient, so bulk means N
  documents and a new multi-document render path. Its own design.
- **No change to the refusal message.** A lab number with no microbiology still surfaces as
  `no data for this report request · RP0005`. Naming the panels it did find would need a second lookup
  on the refusal path, and `appError('RP0005', …)` carries only `{ reportId, element }` today
  (`packages/bootstrap/src/index.ts:263`) — the render path does not know what panels exist, because
  the header returned nothing. Dropped from this slice by the operator. **The symptom that would
  justify it later:** an operator types a lab number, gets the bare error, and cannot tell whether the
  request is absent, is chemistry, or is a genuine bug — which is exactly how this slice started.
- **No change to performing-lab resolution**, the `facility_*` CTEs, or the design's layout.
- **The barcode binding stays bound.** `report-seeds.ts:2238-2244` binds `lab_number` rather than
  `{{param.request}}` because the parameter used to be a per-order id. After this change the
  parameter is usually the lab number, so the comment's reasoning no longer applies — but the binding
  is still correct and reads from the data rather than the input. Left alone.

## On the list, not fixed

- `TZDISATDS0013723` has `specimens.type_text = 'Plasma'` against panels `MICROBIOLOGY : RECTAL SWAB`
  and `MICROBIOLOGY : STOOL`. The specimen type is wrong in the source data. Not this slice.
- `min(performer_system)` folds independently of `min(performer)` in `facility_of`, so on a specimen
  whose reports disagree it can pair one row's code with another's namespace. Pre-existing and
  already documented at `report-seeds.ts:1854`.

---

## Verification

**What proves it:** `packages/reporting/src/seed/clinical-micro-header-live.test.ts` already
provisions a throwaway database from `TARGET_DATABASE_URL` and mirrors `substituteParams` exactly
(quoted literal, not a bound placeholder). Extend it with the multi-order shape:

- a lab number whose organism is on one order and whose AST rows are on another → header returns one
  row, table returns the susceptibilities, `panel` names the AST source order;
- a culture-only lab number → header returns one row, table returns zero rows, PDF renders;
- a chemistry lab number → header returns zero rows → `RP0005`, no PDF produced;
- a per-order id → unchanged behaviour;
- a lab number with two organism-bearing orders → one header row, not two.

Plus `report-seeds.test.ts` for the SQL-shape and header-capacity pins it already holds.

**What does not prove it — `AGENTS.md` §7:** pg-mem cannot stand in here. It has no correlated
subquery support, and the fold correctness depends on real grouping over the multi-order shape. The
live test against real Postgres is the only thing that demonstrates §2 and §4. `typecheck` green
proves nothing about either.

**HONEST NON-PROOF for the PDF itself.** These tests exercise the SQL and the refusal path. They do
not prove the rendered page is right — that the panel value fits the keyvalue slot, or that a
culture-only report reads as complete rather than broken. Only rendering the PDF for
`TZDISATDS0013538` and `TZDISATDS0012061` and looking at it shows that.

## Definition of done — `AGENTS.md` §6

1. **UI** — parameter help text in `ReportParametersBar`, following `AGENTS.md` §5.
2. **CLI parity** — the report runs from `openldr`; shared logic stays in `@openldr/bootstrap`.
3. **Docs** — in-app and web, in **en, fr and pt**. A missing key renders as literal braces.
4. **Mobile** — the parameters sheet at 375×812.
5. **Landing changelog** — `pnpm make:changelog` after merging to `main`.
