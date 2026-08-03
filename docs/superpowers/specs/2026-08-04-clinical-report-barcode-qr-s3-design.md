# S3 — `barcode` + `qrcode` element kinds

**Date:** 2026-08-04
**Status:** Agreed, not implemented.
**Parent:** `2026-08-03-clinical-report-template-design.md` (§1 bands 2 and 8; §2 slice S3).
**Follows:** S4 (`2026-08-03-clinical-report-keyvalue-s4-design.md`) — reuses its binding precedent.

---

## 1. Falsification — checked before designing

| Claim | Verdict |
|---|---|
| pdfkit has no barcode or QR support | **TRUE** — grepped its build output; no hits. Whatever we draw, we draw ourselves. |
| No encoder dependency exists in the repo | **TRUE** — nothing in any workspace `package.json`, nothing installed. This is a genuine new-dependency decision, not a "reuse what's there". |
| A new element kind means duplicating a renderer, as S1 did | **FALSE, avoidably.** `report-designer/src/pure.ts` is schema-only and studio consumes it through `report-designer/types.ts`. An encoder placed there is shared by the pdfkit renderer AND `PageCanvas` with no duplication. This is the S1 `report-pdf` problem NOT repeating. |
| The candidate encoders emit images | **FALSE — probed, not read off a README.** `qrcode-generator` yields a module matrix (`isDark(r,c)`, 21×21 for `TZ00123/26` at ECC M); jsbarcode's Code128 encoder yields a **bar bitstring** directly. Both are pure geometry, so both can be drawn as crisp vector rects instead of an embedded raster. |
| A deep import into jsbarcode is fragile | **PARTLY.** `jsbarcode@3.12.3` ships **no `exports` map**, so the subpath import is legal and Node will not start refusing it. The residual risk is the path moving in a future version — mitigated by an exact version pin plus a golden-vector test (below) that fails loudly rather than silently drawing a wrong barcode. |

## 2. Dependencies

| Package | Version | Why |
|---|---|---|
| `qrcode-generator` | `^2.0.4` (555KB, zero deps) | Public API, isomorphic, returns the module matrix. |
| `jsbarcode` | **`3.12.3` exact** | Encoder only, via `jsbarcode/bin/barcodes/CODE128/CODE128_AUTO.js`. Pinned exactly **because** the import path is private. |

Rejected: `bwip-js` (12.8MB; node path emits a PNG and the browser path needs canvas — a raster barcode in the PDF plus two code paths that cannot share an encoder) and a hand-written Code128 (smallest, but a mis-encoded lab number that still scans as *something* is a bad failure mode to own).

**AUTO mode, not CODE128B.** Auto switches into Code C for digit runs: a 10-digit lab number is **90 bits vs 145**, i.e. ~38% narrower for the same data at the same module width — which is the difference between a barcode that fits the header band and one that does not.

## 3. The elements

`ElementKind` gains `barcode` and `qrcode` (five sites — see the S4 spec §1; both kind literals in `schema.ts`, plus `ELEMENT_KINDS`, `DEFAULT_NAME`, `KIND_ICON`).

### 3.1 Value source

Identical to S4's precedent, so there is one binding story across the whole vocabulary:

- **Bound** — `dataSource` + **`boundColumns[0]`**, valued from **row 0**. Further bound columns are ignored; the Data tab says so.
- **Unbound** — the element's `text`, run through the same `interpolate` the `text`/`datetime` elements use, so `{{param.x}}` and `{{date}}` work.

⚠ **Binding is not a nicety for the built-in.** The mockup's barcode carries the **lab number**, which reaches the report as `lab_number` from `q-clinical-micro-header`. The design's `request` parameter is the ServiceRequest **UUID** — a barcode of it would scan cleanly to the wrong identifier, which is worse than no barcode at all.

### 3.2 Schema additions

| Field | Type | Default | Applies to |
|---|---|---|---|
| `caption` | boolean | `true` | `barcode` — human-readable text under the bars, standard on specimen labels |

QR error correction stays fixed at **M** (the usual print default). No `symbology` field: v1 is Code128 + QR, and adding one later is additive.

### 3.3 Encoding module

New `src/encode.ts`, re-exported from `pure.ts`:

```
encodeCode128(value: string): boolean[] | null      // true = bar
encodeQr(value: string): boolean[][] | null         // [row][col], true = dark
```

**Both return `null` instead of throwing.** An element whose value is empty, or that the encoder rejects, must not take down the whole PDF — every other element on the page is still owed to the reader. `null` renders the dashed placeholder box the `image` element already uses, so an author sees immediately that nothing encoded.

Being pure and synchronous is what lets `draw.ts` and `PageCanvas` share one implementation.

### 3.4 Drawing

**Barcode.** Bars fill `rect.w`: module width = `rect.w / bars.length`. With `caption`, the bottom ~9pt of the box carries the value centred at 7pt and the bars take the rest; without it the bars take the full height.

**QR.** Square, centred in the box, module = `min(w, h) / (size + 8)` — the `+8` is a **4-module quiet zone on every side, which the QR spec requires**. Omitting it is the single most common way an otherwise-correct QR fails to scan, and it is invisible on screen where the page is already white.

### 3.5 Known limitation, recorded not solved

A barcode drawn narrower than roughly 0.19mm per module stops scanning reliably. The renderer draws at whatever width the author's box gives it and does **not** clamp or warn — a render-time warning has nowhere to go, and silently resizing an author's element is worse. Recorded here so it is a known trade rather than a discovery.

## 4. What `PageCanvas` shows

Both kinds render **for real** as inline SVG from the same encoder — no query needed for a static value, and the encoder is synchronous.

For a **bound** element the canvas has no value (it never runs queries), so it encodes the **bound column's label** as a stand-in and draws it **muted**. The author gets true width and module density, which is what placement actually depends on, without a stand-in that could be mistaken for the real code.

## 5. Surfaces

| Surface | Change |
|---|---|
| `report-designer/src/encode.ts` | New. The two encoders. |
| `report-designer/src/pure.ts` | Re-export `./encode`. |
| `report-designer/src/schema.ts` | `barcode`/`qrcode` in both kind literals; `caption` field. |
| `report-designer/src/render/draw.ts` | `drawBarcode`, `drawQrCode`, `drawElement` cases, plus a shared `elementValue(el, resolved, tokens)` helper (bound row-0 / interpolated text). |
| `apps/studio/.../model.ts`, `elementIcons.ts` | Kinds, default names, `newElement` defaults, icons. |
| `apps/studio/.../PageCanvas.tsx` | SVG preview for both. |
| `apps/studio/.../DataTab.tsx` | Guard widens; "only the first field is encoded" hint. |
| `apps/studio/.../PropertiesTab.tsx` | `caption` toggle for barcode. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | ~5 keys with real fr/pt (parity-enforced). |
| `packages/reporting/src/seed/report-seeds.ts` | Add both to `rt-clinical-micro` (§7). |

**Unchanged:** `report-pdf` (no element model), `exportDesignToExcel` (a barcode is not a sheet), pagination (`tableChunkCount` returns 1 for non-tables).

## 6. Testing

- **Golden vectors, measured from the shipped encoders** — these are the whole mitigation for the private import, so they must be re-derived from AUTO mode, not copied from a CODE128B probe:
  - `encodeCode128('1234567890')` → 90 bars, `110100111001011001110010001011000111000101101100001010011011110110100111100101100011101011`
  - `encodeCode128('TZ00123/26')` → 145 bars
  - `encodeQr('TZ00123/26')` → 21×21, row 0 `111111101100101111111`
- `null` for empty/unencodable input, in both encoders.
- **Quiet zone**: the drawn QR's module pitch matches `min(w,h)/(size+8)`, and the dark modules start 4 modules in — a regression that drops the quiet zone still *looks* right, so assert the geometry.
- Rendered bytes: bar rects present, caption text present only when `caption`, placeholder drawn for a null encode.
- `resolveDesignTables` resolves a bound `barcode` (the same kind-agnostic guard S4 fixed).
- Studio: canvas SVG for bound (muted, label-derived) vs unbound; PropertiesTab caption toggle; i18n parity.
- Seed: `rt-clinical-micro` carries both, bound to `lab_number`, non-overlapping.

## 7. Re-authoring `rt-clinical-micro`

- **Barcode** top-right of the header band, bound to `lab_number`, caption on — the accession identifier a technologist actually scans.
- **QR** bottom-left beside the signature line, bound to `lab_number` too. Deliberately the same payload: a URL would need a deployment base URL the design cannot know, and inventing one would ship a QR that resolves nowhere.

## 8. Out of scope

Code39 and other symbologies (additive later via a `symbology` field), QR ECC selection, PDF417/DataMatrix, and any scan-time validation.
