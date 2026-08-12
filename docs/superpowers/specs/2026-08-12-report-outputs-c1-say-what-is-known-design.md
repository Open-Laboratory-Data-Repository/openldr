# Root C1 — the clinical report says what is known, and refuses when it knows nothing

Source: `docs/audit/2026-08-07-report-visual-design-audit.md`.
Addresses **P0-03** and the buildable part of **P0-04**. Root C of the five-root decomposition in
[[report-outputs-audit-roots]]. Roots B (`a222d5a7`) and D (`e90f188f`) are merged.

## Why this is C1 and not "Root C"

Root C was scoped as "document status and control block". Measured against the live warehouse, most
of what P0-04 asks for **has no data**, so it cannot be built — only ingested.

| P0-04 asks for | Data in the warehouse today |
|---|---|
| Issued / released timestamp | **0 of 7,520** `diagnostic_reports` have `issued` |
| Authoriser name, role, timestamp | **not ingested at all** |
| Requesting clinician or facility | **no requester column exists** on `lab_requests` |
| Stable patient identifier | `patients.national_id` empty on **all 3,714** |
| Report ID / accession | `specimens.accession` empty on **all 3,713** — but `lab_requests.request_id` is the lab number and is present |
| Version / amendment indicator | no data |
| Method, breakpoint version, specimen quality, comments | `diagnostic_reports.conclusion` empty on **all 7,520** |
| Status from real workflow state | partial — `lab_requests.status` is populated (6,991 `completed` / 529 `revoked`); `diagnostic_reports.status` is `unknown` 6,967 / `cancelled` 529 / `partial` 24 and is not a review state |
| Collection / receipt / analysis / release times | partial — `specimens.received_time` 3,713/3,713 and `lab_requests.authored_at` 7,520/7,520; the other two absent |
| Page count | already printed as `Page 1 / 1` |
| Confidentiality statement | static text |

Seven of eleven have nothing behind them. Unstubbing `authorised_at` and `result_status` is upstream
work in the CDR toolchain — it needs either a DISA copy carrying the Datamine base tables or blob
decoding, plus a full re-ingest. That is **C2**, a separate project, and nothing here waits on it.

**C1 is what can be told truthfully today.**

## What was checked first

RULE 0 pass. Two of the audit's premises did not survive.

| Premise | Finding |
|---|---|
| An empty clinical report renders blank panels by accident | **False — it is deliberate and documented.** `packages/report-designer/src/render/draw.ts:340-342`: "Zero rows yields the labels with EMPTY values rather than nothing at all — the panel's shape is part of the report, and a blank Surname line is information where a vanished panel is an invisible defect." The auditor could not know this. Both sides agree a *vanishing* panel is wrong; the disagreement is blank-versus-explicit. |
| The `Authorised by ______` line is a false claim of authorisation | **Operator ruling: it is a wet-ink signing affordance and stays.** These reports are signed on paper. The line is correct; P0-03 read a paper workflow as a software claim. |

One premise was confirmed and sharpened. The clinical header query is
`from lab_requests q left join …`, so a request that **exists but has no results still returns one
row**, with nulls. **Zero rows means no such request.** And `keyValuePairs` renders zero rows as
labels with empty values — which is exactly the page the auditor photographed. So "zero rows" is a
precise trigger for the screenshot, and hits nothing else.

## Decisions taken

Three were the operator's, and two overrode a concern I raised. Both are recorded as rulings, not as
open questions.

- **Absent control-block fields print an em dash**, not "Not recorded". I noted that the codebase's
  existing em dash means "not filtered" for a parameter (`draw.ts:168-170`) and that conflating the
  two loses information. Ruled: em dash. Mitigated by one clarifying line in the block — see §2.
- **The signature line stays** as a wet-ink affordance.
- **An empty clinical report is refused, not rendered.** I noted this turns a rendering question into
  a publication gate, which is slice T4's territory. Ruled: refuse. The audit's own wording supports
  it — "do not create a report-shaped PDF that could be mistaken for a valid result".

## Design

### 1. Refuse a report that has no data

A constant in `@openldr/reporting`, beside `SEED_DESIGNS`:

```ts
/** Designs that must not render as a report when their subject does not exist, mapped to the bound
 *  element whose row IS that subject. Zero rows there means the subject is absent — for the clinical
 *  report, no such request — and a report-shaped PDF of nothing can be mistaken for a valid result. */
export const DESIGNS_REQUIRING_DATA: Readonly<Record<string, string>> = {
  'rt-clinical-micro': 'hdr',
};
```

⛔ **A constant, deliberately, and NOT a field on `ReportDesign`.** `toRow` persists every top-level
design field as its own column (`packages/report-designer/src/store.ts:8-21`), so a schema field
would need migration `085` — and then, by the lesson slices T1 and T3 both learned the hard way,
five more sites: `toRow`/`fromRow`, `hashOf`, **`reference-apply.ts`'s `reportDesignRow`** (the lab-side
applier that silently dropped `pageNumbers` and then `status`), three hand-built pg-mem
`report_designs` fixtures, and the exact-array manifest in `migrations.test.ts`. Six sites and a
migration-numbering hazard, for one flag on one design that nobody needs to author.

The cost of the constant is honest and small: a lab cannot set this on its own design. No user
action requires that today (AGENTS.md §4), and moving it into the schema later is a contained change.

`hdr` is the bound `keyvalue` panel named "Patient & specimen". Note the clinical design's element
ids are **bare** (`hdr`, `org`, `tbl`), not design-prefixed the way `simpleTableDesign` builds them
(`${spec.id}-meta`); this design is a hand-authored literal.

`hdr` is the right element because it binds `q-clinical-micro-header`, whose row *is* the request.
`org` binds the same query, and `tbl` binds `q-clinical-micro-ast` — a real request with no isolate
legitimately has zero AST rows, so gating on `tbl` would refuse valid reports.

No other design appears in the map, and every one of them renders unchanged.

**Enforced at the report render path only.** `renderDataDriven`
(`packages/bootstrap/src/index.ts:238`) already calls `resolveDesignTables` at `:249`; immediately
after that, look the design's id up in `DESIGNS_REQUIRING_DATA`; if it is listed and the named
element resolved to zero rows, throw `appError('RP0005')` rather than producing a PDF. `reporting.renderPdf` (`:655`) delegates here, so the API's `:id.pdf` route and the
CLI's `report run --format pdf` are both covered by the one change.

A new catalog entry in `packages/core/src/error-catalog.ts`, following the existing `RP` block
(`error-catalog.ts:38-41`):

```ts
{ code: 'RP0005', domain: 'reports', httpStatus: 404, message: 'no data for this report request' },
```

`404`, not 400 or 500: the parameters were well-formed, the system worked, and the subject does not
exist. The central error handler already turns an `AppError` into a coded response with a
correlation id, so the API and the CLI both get a real message instead of a 500 or a silent PDF.

⛔ **The design-preview route is deliberately NOT gated.** `POST /api/report-designs/preview`
(`apps/server/src/report-designs-routes.ts:100`) must keep rendering an empty design — that is how an
author lays one out. The refusal belongs to the *report* path, which the API's `:id.pdf` route and
the CLI's `report run --format pdf` both share.

### 2. A control block of what is actually known

A new bound `keyvalue` element on `rt-clinical-micro`, carrying only fields with data plus the two
absent ones the operator chose to show as em dashes:

| Row | Source |
|---|---|
| Request ID | `lab_number` — already projected |
| Status | `q.status` — **added to the query**, all three dialects |
| Received | `received` — already projected |
| Issued | em dash — no data (C2) |
| Amendment | em dash — no data (C2) |

Page count is already in the footer and is not duplicated. The authoriser is **not** in this block —
the signature line owns that, and two authorisation surfaces on one page is the ambiguity Root B
removed at the menu level.

**One clarifying line beneath the block**, because an em dash here means something different from an
em dash beside a parameter:

> `—` means the value is not recorded in this system.

That is the mitigation for the ruling in §Decisions. It is one authored string, editable in the
Report Designer, and it costs a single line.

### 3. The signature line is unchanged

No edit. Recorded here so a future reader does not re-open it: it is a wet-ink affordance and the
audit's P0-03 read a paper workflow as a software claim.

## Testing

| What | Layer it proves | Layer it does NOT prove |
|---|---|---|
| a design absent from the map → renders as today, for all seeded designs | no collateral change | — |
| a listed design whose named element resolves ≥1 row → renders | the gate does not fire on good data | — |
| a listed design with zero rows → throws `RP0005`, and **no PDF buffer is produced** | the refusal | not the HTTP status |
| The route returns the catalog's status for `RP0005`, not 500 | the wire shape — route tests are the only thing that pins it | — |
| CLI `report run --format pdf` on an unknown request exits non-zero with the coded message | the operator surface | — |
| **`POST /api/report-designs/preview` still renders a design whose tables are empty** | the boundary — a designer can still author | — |
| The clinical query projects `status` in all three dialects | SQL shape (postgres only under pg-mem) | **mssql and mysql are string-compared, never executed** |
| The control block's rows and the em dash line render on a real PDF | the page | — |

**The rendered-PDF check is required, not optional.** Root B shipped a metric string every test
passed and the page silently ellipsized. Render the clinical report and read the control block.

Render through the preview path (`resolveDesignTables` → `renderReportDesignPdf`) with an injected
`opts.now`, **not** `ctx.reporting.renderPdf` — that reads the design from the database, which holds
whatever was last seeded, and this branch must not seed a shared dev database.

## Out of scope

- **C2** — the real document-control block. Blocked on ingest: `authorised_at`, `result_status` and
  an authoriser identity. Nothing here pretends to deliver it.
- **`received` still renders as raw ISO.** It is bound query data, the class Root D scoped out. A
  reader will see `2026-05-01` in the control block beside a formatted `Printed` date. Named here so
  it is a stated gap, not a discovery.
- Roots A and E, and P0-06.
- The audit's asks that have no data: requester, stable patient identifier, amendment relationship,
  method, breakpoint version, specimen-quality and interpretive comments.

## HONEST NON-PROOF

The refusal is proven at the render path and the route, not against a live warehouse. Nothing here
demonstrates that a real operator rendering a real unknown request sees the coded message rather than
a stack trace — only a live run does that.
