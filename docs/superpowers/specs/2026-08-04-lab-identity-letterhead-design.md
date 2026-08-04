# Lab identity + report letterhead

**Date:** 2026-08-04
**Status:** Agreed, not implemented.
**Parent:** `2026-08-03-clinical-report-template-design.md` (§1 band 1 — "Identity header: logo, lab
name/address, report title").
**Sibling:** `2026-08-04-facility-registry-design.md` — deliberately NOT a dependency. See §1.3.

---

## 1. Falsification — what was checked before designing

### 1.1 There is no lab identity anywhere

Swept settings, migrations, schema and existing designs. **No setting key, table or column holds the
laboratory's own name, address or logo.** The near-misses are all something else:

| Candidate | Reality |
|---|---|
| `sync.site_id` | An opaque identifier string, not a display name; no companion name/address. |
| `sync_sites.name` | The **central's** registry of *other* enrolled labs. A lab node has no row describing itself. |
| `facilities.facility_name` | Ingested **sending** facilities, projected from inbound FHIR. No address column. |
| `seed-org` "Seed Central Lab" | Demo seed data, not configuration. |

### 1.2 The existing query binding cannot reach settings — and must not

A stored query runs against `rec.connectorId` (`packages/dashboards/src/custom-query-run.ts:65`),
i.e. the analytics **warehouse**, not the internal database. Reaching `app_settings` would require a
connector pointed at the internal DB — which would expose `sync.client_secret` and
`sync.signing_private_key` to the SQL workbench and the query builder.

⇒ "Just seed a `q-lab-identity` query" is not merely awkward, it is a **trust-boundary violation**.
The read path must not go through the connector layer.

### 1.3 The facility work does not block this

Measured on a live dev database (1303 diagnostic reports):

- `facilities` holds **only the two demo seed rows**; no real facility has ever been ingested, and
  `facility_code` is NULL on both.
- The only populated facility dimension is `diagnostic_reports.performer` — **1303/1303**, but as
  free-text display names ("Dodoma", "Mwananyamala", "Mnazi Mmoja", "Aga Khan"…).
- **23 distinct values; max length exactly 30; 15 sit at exactly 30 characters** — the upstream
  column is fixed-width 30 and names are silently truncated ("International School of Tangan").
- `patients.managing_organization` is **1/589**, so `q-amr-facility-summary` and the `q-facilities`
  filter are effectively empty today.

None of that touches the letterhead: **the issuing lab's identity is configuration, not ingested
data.** Decision (user): identity lives in settings; the facility registry stays about *senders*.
The two never block each other.

### 1.4 ⚠ Measured: pdfkit rejects URL image sources

`doc.image('https://…')` throws `ENOENT` — pdfkit treats the string as a **file path**. Only `data:`
URIs (and real local paths) work. The schema's comment "image source (URL or data: URI)"
(`packages/report-designer/src/schema.ts:78`) is therefore **wrong for the PDF renderer**.

Today an operator who pastes an `https` logo URL sees it render on the canvas (`<img src>` is happy)
and gets the **dashed placeholder in the PDF**, with no error anywhere. This slice touches
`image.src` and so fixes it.

## 2. Storage

Four keys in `app_settings`, declared in a typed registry module beside `feature-flags.ts` and
`number-settings.ts` (`packages/config/src/lab-identity.ts`):

| Key | Type | Validation |
|---|---|---|
| `lab.name` | string | trimmed, ≤200 chars |
| `lab.address` | string | trimmed, ≤500 chars, newlines preserved (multi-line block) |
| `lab.contact` | string | trimmed, ≤200 chars (phone / email / both, free-form) |
| `lab.logo` | string | `data:image/(png\|jpeg\|webp);base64,…`, ≤256 KB decoded |

None are secrets, so no encryption and no masking — unlike the `sync.*` keys they sit next to.

**Why a cap, enforced at write:** an unbounded logo becomes a multi-megabyte settings row that is
read on **every report render**. Rejecting at upload is a clear error the operator can act on;
discovering it as slow PDFs is not. 256 KB is generous for a letterhead mark at print resolution.

**Why not a blob:** §1.4 — the renderer needs bytes, not a URL, so a blob would have to be fetched
and inlined at render time in both callers. The data URI is what pdfkit and `<img>` both already
accept, so it removes a failure mode rather than adding one.

## 3. Read path — token interpolation

`interpolate()` (`packages/report-designer/src/render/draw.ts`) already resolves `{{param.x}}` and
`{{date}}`. It gains `{{lab.name}}`, `{{lab.address}}`, `{{lab.contact}}`, `{{lab.logo}}`.

`report-designer` is a pure package with no database reach, so **the callers supply the values**:

- `apps/server/src/report-designs-routes.ts` (preview/export)
- `packages/bootstrap/src/index.ts` (`exportArtifact`)

Both already load context; both pass an identity map into `renderReportDesignPdf` via one new
option. **No schema change, no new element kind, no new DataSource variant** — identity works in
ordinary `text` elements, which is what a letterhead is.

Unset keys resolve to the empty string, exactly as an unknown `{{param.x}}` does today, so a design
referencing identity stays valid on an install that has not configured it.

### 3.1 The logo

`drawElement`'s `image` case currently uses `el.src` verbatim. It gains the same `interpolate` call
the text cases use, so `src: "{{lab.logo}}"` resolves to the stored data URI.

Alongside it, the §1.4 fix: correct the schema comment, and warn in the Properties panel when an
`image` src is a non-`data:` URL — same shape as the S3 barcode scan hint, and for the same reason
(the failure is otherwise invisible until someone looks at a PDF).

## 4. What the canvas resolves

`PageCanvas` will resolve **`{{lab.*}}` only**. `{{param.x}}` and `{{date}}` stay literal, as they
are today.

That inconsistency is deliberate and the line is principled: **identity is static install-level data
the canvas can simply know; a parameter's value is a run-time choice the canvas has no business
guessing.** A letterhead you cannot see while positioning it defeats the purpose of placing it, and
an `<img src="{{lab.logo}}">` would otherwise render as a broken-image icon.

`ReportDesignerPage` fetches the identity once on load and passes it down; `PageCanvas` stays a pure
component taking a token map.

## 5. Surfaces

| Surface | Change |
|---|---|
| `packages/config/src/lab-identity.ts` | New. Typed key registry + validators. |
| `apps/server/src/settings-routes.ts` | `GET`/`PUT /api/settings/lab`, capability-gated like the other settings routes. |
| `apps/studio/src/pages/settings/Laboratory.tsx` | New page + `SUB_NAV` entry. |
| `packages/report-designer/src/render/draw.ts` | `interpolate` gains `lab.*`; `image` src interpolated. |
| `packages/report-designer/src/render/index.ts` | Render option carrying the identity tokens. |
| `apps/server/.../report-designs-routes.ts`, `packages/bootstrap/src/index.ts` | Load identity, pass it in. |
| `apps/studio/.../PageCanvas.tsx`, `ReportDesignerPage.tsx` | Resolve `lab.*` for preview. |
| `apps/studio/.../PropertiesTab.tsx` | Non-`data:` image-src warning. |
| `packages/cli` | `openldr settings lab get\|set` — operator parity, per the standing convention. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | Real fr/pt (parity-enforced). |
| `packages/reporting/src/seed/report-seeds.ts` | Re-author `rt-clinical-micro` band 1. |

**A new Settings page, not another section in General:** General already carries About, feature
flags, number limits and the danger zone, and this adds four fields including an upload.

## 6. Re-authoring `rt-clinical-micro`

Band 1 becomes a real letterhead: an `image` at `{{lab.logo}}` top-left, `{{lab.name}}` beside it,
`{{lab.address}}` and `{{lab.contact}}` beneath in smaller muted text, with the existing
"LABORATORY REPORT" / "MICROBIOLOGY — CULTURE & SENSITIVITY" titles retained. The barcode stays
top-right. A rule closes the header (spec band 3, currently missing).

## 7. Testing

- `interpolate` resolves each `lab.*` token; unknown/unset → empty string; existing `{{param.x}}`
  and `{{date}}` behaviour unchanged.
- Image `src` interpolation: a token src resolves; a literal data URI is untouched.
- Validation: oversized logo rejected; non-image data URI rejected; `https://` logo rejected at
  write with a clear error (rather than failing silently at render — §1.4).
- Rendered bytes: identity text present when configured, absent (not `{{lab.name}}`) when not.
  ⚠ Assert the resolved VALUE, not merely that the line exists — an un-interpolated token renders as
  literal braces and reads as "present" to a naive assertion. This cost a real bug in S3.
- Canvas resolves `lab.*` and still leaves `{{date}}` literal.
- Settings route + CLI round-trip; i18n parity.
- Seed: `rt-clinical-micro` band 1 references the identity tokens and nothing overprints.

## 8. Out of scope

Multi-site identity (one identity per install; a central node does not learn its labs' letterheads
through sync), per-report identity overrides, accreditation/registration numbers as distinct fields
(free-form `lab.contact` covers them for now), and sourcing identity from a facility-registry entry
(recorded as a possible future in the sibling spec, deliberately not built).
