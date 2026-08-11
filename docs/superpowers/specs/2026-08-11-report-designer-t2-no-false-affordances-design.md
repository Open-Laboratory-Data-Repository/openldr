# Report Designer — no false affordances

Date: 2026-08-11
Status: designed, not implemented.
Source: `docs/audit/2026-08-07-report-visual-design-audit.md` (external audit) — addendum findings
**RD-P0-02** (canvas is not a faithful preview of a bound table), **RD-P0-05** (the Image property
invites a source the PDF cannot render) and **RD-P0-06** (`Check` and `Duplicate` are visible
no-ops), i.e. Designer Phase 0 items 2-4.
Position: **slice T2** of five. Predecessor: T1
(`docs/superpowers/specs/2026-08-11-report-designer-t1-round-trip-integrity-design.md`), on
`slice/report-designer-trust`. **T2 is independent of T1** — it adds no migration and touches no
shared file, so it can merge in either order.

## Purpose

The Report Designer advertises four things it does not do. Each is small on its own; together they
mean an author cannot trust what the editor tells them.

The most serious is `Duplicate`, and its seriousness only became visible through T1. The boot seed
overwrites built-in designs with the product's shipped copy whenever they drift, and the comment
governing that behaviour states the sanctioned way out
(`packages/reporting/src/seed/report-seeds.ts:2534`):

> ⚠ An operator who edits a built-in IN PLACE loses those edits here. That is the accepted trade:
> customise via Duplicate (⋯ menu), which mints a new id this loop never iterates.

`Duplicate` is wired to `noop` (`apps/studio/src/report-designer/ReportDesignerPage.tsx:31`, `:433`).
The documented remedy for losing your work does not exist. An operator who follows the instruction
written in the code gets no feedback at all — the menu item closes and nothing happens.

The other three:

- **The canvas cannot show a bound table.** It renders only the static `el.columns`/`el.rows`
  (`apps/studio/src/report-designer/PageCanvas.tsx:292-304`), while the PDF uses `boundColumns` and
  resolved rows. A bound table therefore looks empty in the editor and is populated in the PDF.
- **The Image property invites a source the PDF cannot render.** The field placeholder is
  `https://…` (`apps/studio/src/report-designer/PropertiesTab.tsx:181`) with no validation. The
  renderer already records the measured consequence
  (`packages/report-designer/src/render/draw.ts:648-651`): pdfkit treats a URL source as a *file
  path* and throws, so an `https://` image renders correctly on the canvas — `<img>` is perfectly
  happy — and silently becomes a dashed placeholder in the PDF. Nobody sees it until a report is
  printed.
- **`Check` is a silent no-op** with a name that implies a report-quality safety net.

## Scope

In scope: `Duplicate`; element-image source validation and an upload affordance; bound-table headers
on the canvas; making `Check` honest.

Explicitly **out of scope**:

- Real preflight. `Check` becomes visibly unavailable, not functional — preflight is **T4**.
- Draft/published revisions and the autosave→reference-sync hazard — **T3**.
- Delete guards and optimistic concurrency — **T5**.
- A server-managed asset store. The audit asks for one eventually; T2 embeds images as `data:` URIs,
  which is what the renderer and the existing lab-logo flow already do.
- Sample-data preview on the canvas, physical page ghosts, and canvas/PDF layout parity. These are
  the audit's Phase 1 and need a shared resolved-layout plan.
- Barcode/QR value validation. Same defect family, different element, no measured failure yet.

## Measured before designing

Measured 2026-08-11 in a worktree at `main` (`b4c2194e`).

| Fact | Value | How |
|---|---|---|
| `Check` / `Duplicate` handlers | both `noop` | read `ReportDesignerPage.tsx:31,433` |
| Canvas table data source | `el.columns` / `el.rows` only | read `PageCanvas.tsx:292-304` |
| PDF table data source | `boundColumns` + resolved rows | read `render/draw.ts:691-708` |
| Image field validation | none; placeholder `https://…` | read `PropertiesTab.tsx:177-182` |
| pdfkit behaviour on a URL source | treated as a file path, throws, falls back to dashed placeholder | comment records it as MEASURED, `draw.ts:648-651` |
| Seeded element image sources | **`{{lab.logo}}` — a token, not a data URI**, in all 9 built-ins | `simple-design.ts:97`, `report-seeds.ts:2179` |
| Transposed seeded tables | 1 (the cumulative antibiogram, `report-seeds.ts:2150`) | grep |
| `boundColumns` on a transposed table | **deliberately empty** — headers come from the data | read `schema.ts:68-79` |
| Existing write-time image validator to mirror | `validateLabIdentityValue` | read `packages/config/src/lab-identity.ts:73-83` |
| Existing upload flow to mirror | `FileReader` → `readAsDataURL` | read `apps/studio/src/pages/settings/Laboratory.tsx:58-61,119` |
| Route validation today | `ReportDesignSchema.safeParse` → 400, on POST/PUT/preview | read `report-designs-routes.ts:26,36,57` |
| `fromRow` parses through the same schema | yes (`ReportDesignSchema.parse`) | read `store.ts:20` |

## Design

### 1. `Duplicate`

Mirrors the existing `newTemplate` flow (`ReportDesignerPage.tsx:272-286`) rather than inventing a
second one:

- Mint `rt-${Date.now()}`, matching how new designs are identified today.
- Deep-copy `pages`, `parameters`, `paper`, `orientation`, `margins`, `pageNumbers`.
- Name it via an i18n string, `Copy of <name>`.
- Mark it **transient**, so it lives in local state until `Save` persists it — identical to
  `New template`. Duplicating therefore never silently creates server state, and the existing
  "Unsaved" status chip already communicates what is pending.
- Select it and leave the source design untouched.

Inner element ids are copied verbatim. Nothing outside a design references them — `resolveDesignTables`
keys resolved tables by `el.id` within one design — so regenerating them would add risk and buy
nothing. A duplicate of a built-in will contain element ids that begin with the *original* design's
id; that is cosmetic and is called out here so it is not mistaken for a defect later.

Duplicating a transient design is allowed and yields another transient design.

### 2. Element-image source validation

**A new validator in `packages/report-designer`, not a zod refinement.** This distinction is
load-bearing. `fromRow` parses every stored design through `ReportDesignSchema`
(`store.ts:20`), so a refinement rejecting non-`data:` sources would make every *existing* design
holding an `https://` image **unreadable** — `get`, `list` and the boot seed's own `get` would all
throw, and the design could never be opened to fix it. The rule therefore sits outside the schema,
exactly as `validateLabIdentityValue` does.

The rule, per element of kind `image`:

- `''` or absent → valid (an empty image element is a placeholder the author has not filled yet).
- Contains `{{` … `}}` → valid, deferred to render. **This is what keeps the nine `{{lab.logo}}`
  built-ins savable.** A naive "must be a data URI" rule would reject every seeded design.
- Otherwise must match `data:<mime>;base64,<payload>` with `<mime>` in PNG / JPEG, and at
  most **256 KB decoded per image** — the same ceiling `LAB_LOGO_MAX_BYTES` sets for the letterhead
  mark, for the same reason: the value is embedded in the design's `pages` jsonb, which is read on
  every render, so an unbounded image becomes a multi-megabyte row on a hot path — for writes that go
  through this rule (the API). The reference-sync applier (`packages/db/src/reference-apply.ts`)
  writes `pages` directly and is not gated by it; that is a deliberate trusted-source boundary, not
  something this cap protects. Per image, not per design; a design with several images is the
  author's choice and the cap keeps any single one sane.

SVG stays excluded, for the reason already recorded in `lab-identity.ts:38-42`: it is a
script-bearing document and this value is rendered into an `<img>` on the canvas.

**WebP is excluded too**, unlike `lab-identity.ts`'s letterhead-logo allowlist (which still lists it
— a pre-existing, separately-tracked defect). Measured (`node_modules/.pnpm/pdfkit@0.15.2/
node_modules/pdfkit/js/pdfkit.js:3957-3962`): pdfkit sniffs magic bytes and draws `JPEG` for
`0xFF 0xD8` and `PNGImage` for `0x89 'PNG'`, throwing `Unknown image format.` for anything else —
WebP included. Accepting it would reproduce, for a third format, the exact silent-blank-in-PDF
failure this rule exists to prevent, and the file picker's `accept` attribute would need to keep
offering it. Do not re-add it without a corresponding change to pdfkit's image support.

The constants are defined in `packages/report-designer` rather than imported from
`@openldr/config`. `@openldr/report-designer` does not depend on `@openldr/config` today, and adding
a package dependency to share two numbers is the worse trade. The new file cross-references
`lab-identity.ts` as the origin of the rule so the two cannot drift silently.

**Enforcement points:** `POST /api/report-designs` and `PUT /api/report-designs/:id`, immediately
after the existing `safeParse`, returning 400 with the offending element id and reason.

**Deliberately NOT enforced on `POST /api/report-designs/preview`.** An author must be able to
preview a design that already contains a bad image in order to see the problem. Preview is
diagnostic; save is the gate.

### 3. Image upload affordance

The Properties panel's image section gains a file picker mirroring
`apps/studio/src/pages/settings/Laboratory.tsx:58-61,119`: choose a file, `readAsDataURL`, store the
result as `src`. Client-side checks mirror the server rule so the author is told before saving, but
the server remains the authority.

A `src` that is an interpolation token (`{{lab.logo}}`) is displayed as such and left editable as
text — the seeded designs must remain comprehensible and editable in the panel, not replaced by an
upload widget that cannot represent them.

### 4. Bound-table headers on the canvas

`PageCanvas`'s `table` case gains three states:

- **Unbound** — unchanged; renders `el.columns` / `el.rows`.
- **Bound, ordinary** — headers from `el.boundColumns` labels; body shows an explicit
  "rows resolve at render" state rather than fabricated sample rows.
- **Bound, transposed** — `boundColumns` is empty by design, so headers cannot be known without
  running the query. Renders `transposeLabel` as the first column header, then a clearly-marked
  indicator that the remaining headers are derived from query results.

The transposed case matters disproportionately: the one transposed built-in is the cumulative
antibiogram, which is the table the audit most criticises, and the audit's own minimum bar
("show its current `boundColumns` headers") is a **no-op** for it.

No query is executed during authoring. Fabricating plausible headers would replace one lie with a
better-looking one.

### 5. `Check`

Rendered as a disabled menu item with a short caption naming preflight as the reason it is
unavailable. It stays visible because it is on the roadmap (T4) and an item that vanishes and later
returns is its own small confusion. It stays in the ⋯ menu per the standing UI convention.

## Testing

The cases that would otherwise ship broken:

- A seeded design whose image `src` is `{{lab.logo}}` still saves through `PUT`. *(Guards against the
  naive validator rejecting all nine built-ins.)*
- An `https://` image `src` is rejected at `POST` and `PUT` with a 400 naming the element.
- A stored design containing an `https://` src still **loads** through `get`/`list` and still
  **previews**. *(Guards against the rule migrating into the zod schema.)*
- `data:` PNG/JPEG accepted; `data:image/svg+xml` and `data:image/webp` rejected; oversize rejected.
- Duplicate produces a new id, leaves the source unchanged, is transient until Save, and copies
  `pageNumbers`/`margins`, not just pages.
- Duplicating a built-in yields an id outside `SEED_DESIGNS`, so the boot seed's managed-overwrite
  loop never iterates it — the property the seed comment promises.
- Canvas: bound table renders `boundColumns` labels; transposed table renders `transposeLabel` plus
  the data-derived marker, not an empty box; unbound table unchanged.
- `Check` is present and disabled; `Duplicate` is present and enabled.

## Rejected alternatives

**A zod refinement on `DesignElementSchema.src`.** Enforces everywhere for free. Rejected: it would
also run on read and make existing designs with an `https://` image permanently unopenable.

**Rejecting any `src` that is not a data URI.** Simpler rule. Rejected: it rejects all nine built-in
designs, which ship `{{lab.logo}}`.

**Duplicate persisting immediately.** Arguably friendlier for the operator escaping a built-in
overwrite. Rejected for consistency: `New template` is transient, and two adjacent menu items with
opposite persistence semantics is its own false affordance. The "Unsaved" chip already carries the
state.

**Running the bound query for canvas sample data.** Would make the canvas genuinely faithful.
Rejected: it is the audit's Phase 1 data-snapshot work, needs caching and preview presets to avoid
executing clinical queries on every edit, and belongs with the shared layout plan.

**Removing `Check` instead of disabling it.** Also acceptable, and the audit permits either. Chose
disabled-with-a-reason so the roadmap is legible.

## Known limits

- An author can still bind an image to a token that resolves to nothing at render; the dashed
  placeholder for that case is P0-02 in the main audit, not here.
- The canvas still does not show real row counts, pagination, or column widths. That is Phase 1.
- Client-side image checks duplicate the server rule in spirit; the server is authoritative and the
  tests assert the server, not the browser.

## Coordination

T2 adds user-facing strings, so it edits `apps/studio/src/i18n/{en,fr,pt}.ts` — the same three files
the facilities workstream edits. Expect conflicts there; stage named paths only, never `git add -A`.

T2 adds **no migration**, so it is not subject to the `081`/`082` ordering constraint that governs
T1's merge.
