# Report Designer — No False Affordances (T2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Report Designer stop advertising four things it does not do — `Duplicate`, a usable image source, a faithful bound-table canvas, and `Check`.

**Architecture:** One new pure validator in `packages/report-designer`, enforced at the server's save boundary (never in the zod schema, which also runs on read). Everything else is contained in four `apps/studio/src/report-designer/*` files, following patterns that already exist elsewhere in this repo.

**Tech Stack:** TypeScript, React, zod, Fastify, vitest, react-i18next, pnpm workspaces + turbo.

**Spec:** `docs/superpowers/specs/2026-08-11-report-designer-t2-no-false-affordances-design.md`

## Global Constraints

- **The image rule must NOT become a zod refinement on `DesignElementSchema`.** `fromRow` parses every stored design through `ReportDesignSchema` (`packages/report-designer/src/store.ts:20`), so a refinement would make an existing design holding an `https://` image permanently unreadable — `get`, `list` and the boot seed's own `get` would throw, with no way to open the design to fix it. Validate at the route boundary only.
- **A `src` containing an interpolation token (`{{…}}`) is VALID and must pass.** All nine built-in designs ship `src: '{{lab.logo}}'` (`packages/reporting/src/seed/simple-design.ts:97`, `packages/reporting/src/seed/report-seeds.ts:2179`). A "must be a data URI" rule rejects every built-in design on save.
- **Validation is enforced on `POST /api/report-designs` and `PUT /api/report-designs/:id` only — never on `POST /api/report-designs/preview`.** An author must be able to preview a design that already contains a bad image in order to see the problem.
- **Accepted image types are PNG, JPEG and WebP. SVG is excluded deliberately** — it is a script-bearing document and this value is rendered into an `<img>` on the canvas. Reason recorded at `packages/config/src/lab-identity.ts:38-42`.
- **Image cap: 256 KB decoded per image**, matching `LAB_LOGO_MAX_BYTES`.
- **Every new i18n key must be added to all three of `apps/studio/src/i18n/{en,fr,pt}.ts` in the same commit.** `apps/studio/src/i18n/parity.test.ts` asserts `fr` and `pt` key paths equal `en` exactly; adding to `en` alone fails the suite.
- **Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer** to any commit.
- **Stage named paths only. Never `git add -A`** — the repository directory is shared with concurrent sessions, and the facilities workstream is editing the same three i18n files.
- **Gate command:** `pnpm turbo run typecheck test --force`. **Never pipe turbo through `tail`.**
- Working directory for every command: `D:/Projects/Repositories/openldr_ce/.worktrees/report-designer-t2`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/report-designer/src/image-src.ts` | Create — the element-image source rule, pure and dependency-free | 1 |
| `packages/report-designer/src/image-src.test.ts` | Create — its unit tests | 1 |
| `packages/report-designer/src/pure.ts` | Modify — re-export the validator | 1 |
| `apps/server/src/report-designs-routes.ts` | Modify — enforce on POST/PUT, not preview | 2 |
| `apps/server/src/report-designs-routes.test.ts` | Modify — route-level cases | 2 |
| `apps/studio/src/report-designer/PropertiesTab.tsx` | Modify — file picker + client-side checks | 3 |
| `apps/studio/src/report-designer/PropertiesTab.test.tsx` | Modify — picker tests | 3 |
| `apps/studio/src/report-designer/ReportDesignerPage.tsx` | Modify — implement `duplicateTemplate`, stop passing `noop` | 4 |
| `apps/studio/src/report-designer/CanvasHeader.tsx` | Modify — disable `Check` with a reason | 4 |
| `apps/studio/src/report-designer/ReportDesignerPage.test.tsx` | Modify — duplicate behaviour | 4 |
| `apps/studio/src/report-designer/CanvasHeader.test.tsx` | Modify — Check disabled, Duplicate enabled | 4 |
| `apps/studio/src/report-designer/PageCanvas.tsx` | Modify — bound + transposed table states | 5 |
| `apps/studio/src/report-designer/PageCanvas.test.tsx` | Modify — the three table states | 5 |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | Modify — new keys (Tasks 3, 4, 5 each add their own, to all three files) | 3, 4, 5 |

---

### Task 1: The element-image source rule

**Files:**
- Create: `packages/report-designer/src/image-src.ts`
- Create: `packages/report-designer/src/image-src.test.ts`
- Modify: `packages/report-designer/src/pure.ts`

**Interfaces:**
- Consumes: `ReportDesign` from `./schema`.
- Produces:
  - `ELEMENT_IMAGE_MAX_BYTES: number` (262144)
  - `ELEMENT_IMAGE_MAX_CHARS: number`
  - `ELEMENT_IMAGE_MIME: readonly ['image/png','image/jpeg','image/webp']`
  - `type ImageSrcReason = 'not-a-data-uri' | 'unsupported-image-type' | 'too-large'`
  - `interface InvalidImageSource { elementId: string; reason: ImageSrcReason }`
  - `validateImageSrc(src: string): ImageSrcReason | null`
  - `findInvalidImageSources(design: ReportDesign): InvalidImageSource[]`

  Task 2 imports `findInvalidImageSources` from `@openldr/report-designer/pure`. Task 3 imports `ELEMENT_IMAGE_MAX_BYTES`, `ELEMENT_IMAGE_MIME` and `validateImageSrc` from `./types` (which re-exports `/pure`).

- [ ] **Step 1: Write the failing test**

Create `packages/report-designer/src/image-src.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  validateImageSrc,
  findInvalidImageSources,
  ELEMENT_IMAGE_MAX_CHARS,
} from './image-src';
import type { ReportDesign } from './schema';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('validateImageSrc', () => {
  it('accepts an empty source — an unfilled image element is not an error', () => {
    expect(validateImageSrc('')).toBeNull();
  });

  it('accepts an interpolation token, deferring it to render', () => {
    // ⛔ All nine built-in designs ship `{{lab.logo}}`. A data-URI-only rule rejects every one.
    expect(validateImageSrc('{{lab.logo}}')).toBeNull();
    expect(validateImageSrc('{{param.crest}}')).toBeNull();
  });

  it('accepts png, jpeg and webp data URIs', () => {
    expect(validateImageSrc(PNG)).toBeNull();
    expect(validateImageSrc('data:image/jpeg;base64,/9j/4AAQ')).toBeNull();
    expect(validateImageSrc('data:image/webp;base64,UklGRg==')).toBeNull();
  });

  it('rejects an http(s) URL — pdfkit reads it as a file path and silently draws a placeholder', () => {
    expect(validateImageSrc('https://example.org/logo.png')).toBe('not-a-data-uri');
    expect(validateImageSrc('http://example.org/logo.png')).toBe('not-a-data-uri');
    expect(validateImageSrc('/var/logo.png')).toBe('not-a-data-uri');
  });

  it('rejects svg — it is script-bearing and the canvas renders it into an <img>', () => {
    expect(validateImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe('unsupported-image-type');
  });

  it('rejects an oversize image', () => {
    const huge = `data:image/png;base64,${'A'.repeat(ELEMENT_IMAGE_MAX_CHARS)}`;
    expect(validateImageSrc(huge)).toBe('too-large');
  });
});

describe('findInvalidImageSources', () => {
  const design = (elements: unknown[]): ReportDesign => ({
    id: 'd', name: 'D', paper: 'A4', orientation: 'portrait',
    pages: [{ id: 'p1', elements: elements as never }], parameters: [],
  });

  it('reports each offending image element by id', () => {
    const d = design([
      { id: 'ok', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 1, h: 1 }, src: PNG },
      { id: 'bad', kind: 'image', name: 'Crest', rect: { x: 0, y: 0, w: 1, h: 1 }, src: 'https://x/y.png' },
    ]);
    expect(findInvalidImageSources(d)).toEqual([{ elementId: 'bad', reason: 'not-a-data-uri' }]);
  });

  it('ignores non-image elements that happen to carry a src-like value', () => {
    const d = design([
      { id: 't', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, text: 'https://example.org' },
    ]);
    expect(findInvalidImageSources(d)).toEqual([]);
  });

  it('returns empty for the seeded shape — an image bound to {{lab.logo}}', () => {
    const d = design([
      { id: 'logo', kind: 'image', name: 'Lab logo', rect: { x: 0, y: 0, w: 1, h: 1 }, src: '{{lab.logo}}' },
    ]);
    expect(findInvalidImageSources(d)).toEqual([]);
  });

  it('scans every page, not just the first', () => {
    const d: ReportDesign = {
      id: 'd', name: 'D', paper: 'A4', orientation: 'portrait', parameters: [],
      pages: [
        { id: 'p1', elements: [] },
        { id: 'p2', elements: [{ id: 'bad', kind: 'image', name: 'X', rect: { x: 0, y: 0, w: 1, h: 1 }, src: 'ftp://x' }] as never },
      ],
    };
    expect(findInvalidImageSources(d)).toEqual([{ elementId: 'bad', reason: 'not-a-data-uri' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd packages/report-designer && npx vitest run src/image-src.test.ts
```
Expected: FAIL — `Failed to resolve import "./image-src"`.

- [ ] **Step 3: Write the implementation**

Create `packages/report-designer/src/image-src.ts`:

```ts
import type { ReportDesign } from './schema';

/**
 * The element-image source rule.
 *
 * ⚠ Deliberately NOT a zod refinement on `DesignElementSchema`. `fromRow` (`./store.ts`) parses
 * every stored design through `ReportDesignSchema`, so a refinement would also run on READ and make
 * an existing design holding an `https://` image permanently unopenable — including inside the boot
 * seed's own `get`. This is a WRITE-time rule, enforced at the API boundary, exactly as
 * `validateLabIdentityValue` (`packages/config/src/lab-identity.ts`) is for the letterhead logo.
 *
 * The rule itself mirrors that function; the constants are restated here rather than imported
 * because `@openldr/report-designer` does not depend on `@openldr/config`, and adding a package
 * dependency to share two numbers is the worse trade. If one side changes, change both.
 */

/** Decoded-image ceiling, per image. Matches `LAB_LOGO_MAX_BYTES`: the value is embedded in the
 *  design's `pages` jsonb, which is read on every render and shipped over reference sync, so an
 *  unbounded image becomes a multi-megabyte row on a hot path. */
export const ELEMENT_IMAGE_MAX_BYTES = 256 * 1024;

/** base64 carries 3 bytes per 4 characters, so the encoded form is ~4/3 the decoded size. The
 *  prefix (`data:image/jpeg;base64,`) is short enough to absorb into the rounding. */
export const ELEMENT_IMAGE_MAX_CHARS = Math.ceil((ELEMENT_IMAGE_MAX_BYTES * 4) / 3) + 64;

/**
 * ⛔ SVG is deliberately absent, for the same reason it is absent from the lab logo's allowlist: an
 * SVG is a script-bearing document, and this value is rendered into an `<img>` on the designer
 * canvas.
 */
export const ELEMENT_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type ImageSrcReason = 'not-a-data-uri' | 'unsupported-image-type' | 'too-large';

export interface InvalidImageSource {
  elementId: string;
  reason: ImageSrcReason;
}

const DATA_URI = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** `{{lab.logo}}`, `{{param.crest}}` — resolved by the renderer, not a literal source. */
const TOKEN = /\{\{[^}]+\}\}/;

/**
 * Validate one image element's `src`. Returns `null` when acceptable.
 *
 * ⚠ An `https://` source is REJECTED here rather than accepted and left to fail at render.
 * Measured (`./render/draw.ts`): pdfkit treats a URL image source as a FILE PATH and throws, so a
 * URL image renders correctly on the studio canvas — `<img>` is perfectly happy — and silently
 * becomes a dashed placeholder in the PDF. Nobody sees it until a report is printed. Failing at
 * write is the only point where the author can still do something about it.
 */
export function validateImageSrc(src: string): ImageSrcReason | null {
  if (src === '') return null;
  // Tokens are the seeded shape (`{{lab.logo}}`) and resolve at render; nothing to check here.
  if (TOKEN.test(src)) return null;
  // Length first: cheaper than running the pattern over a multi-megabyte string.
  if (src.length > ELEMENT_IMAGE_MAX_CHARS) return 'too-large';

  const m = DATA_URI.exec(src);
  if (!m) return 'not-a-data-uri';
  if (!(ELEMENT_IMAGE_MIME as readonly string[]).includes(m[1])) return 'unsupported-image-type';
  return null;
}

/** Every offending `image` element in the design, across all pages. Empty when the design is fine. */
export function findInvalidImageSources(design: ReportDesign): InvalidImageSource[] {
  const bad: InvalidImageSource[] = [];
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.kind !== 'image') continue;
      const reason = validateImageSrc(el.src ?? '');
      if (reason) bad.push({ elementId: el.id, reason });
    }
  }
  return bad;
}
```

- [ ] **Step 4: Re-export from the pure entry point**

In `packages/report-designer/src/pure.ts`, add the line so it reads:

```ts
export * from './schema';
export * from './encode';
export * from './image-src';
```

`./pure` is the browser-safe entry (`packages/report-designer/package.json` maps `"./pure": "./src/pure.ts"`), which is what both `apps/server` and the studio's `types.ts` import. The new module has no Node dependencies, so it belongs here.

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd packages/report-designer && npx vitest run src/image-src.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the package suite and typecheck**

Run:
```bash
cd packages/report-designer && npx vitest run
```
Expected: all files pass.

```bash
cd packages/report-designer && npx tsc --noEmit
```
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/report-designer/src/image-src.ts packages/report-designer/src/image-src.test.ts packages/report-designer/src/pure.ts
git commit -m "feat(report-designer): add the element-image source rule

A write-time rule, not a zod refinement: fromRow parses stored designs
through the same schema, so a refinement would make an existing design
holding an https image unopenable. Interpolation tokens pass through —
all nine built-ins ship src '{{lab.logo}}'."
```

---

### Task 2: Enforce the rule on save

**Files:**
- Modify: `apps/server/src/report-designs-routes.ts:25-43`
- Modify: `apps/server/src/report-designs-routes.test.ts`

**Interfaces:**
- Consumes: `findInvalidImageSources` from `@openldr/report-designer/pure` (Task 1).
- Produces: `POST`/`PUT` return 400 with body `{ error: string, invalidImages: InvalidImageSource[] }` when any image source is invalid. Nothing later depends on this shape.

- [ ] **Step 1: Write the failing tests**

Open `apps/server/src/report-designs-routes.test.ts` and read its existing setup — it builds an app with `registerReportDesignRoutes` and posts a `minimal` design. Add these tests, following that file's existing style for building payloads and asserting status codes:

```ts
  const withImage = (src: string) => ({
    ...minimal,
    pages: [{ id: 'p1', elements: [{ id: 'logo', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 10, h: 10 }, src }] }],
  });

  it('rejects an https image source on create', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withImage('https://example.org/l.png') });
    expect(res.statusCode).toBe(400);
    expect(res.json().invalidImages).toEqual([{ elementId: 'logo', reason: 'not-a-data-uri' }]);
  });

  it('rejects an https image source on update', async () => {
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const res = await app.inject({ method: 'PUT', url: '/api/report-designs/rd1', payload: withImage('https://example.org/l.png') });
    expect(res.statusCode).toBe(400);
    expect(res.json().invalidImages).toEqual([{ elementId: 'logo', reason: 'not-a-data-uri' }]);
  });

  it('accepts a seeded {{lab.logo}} token — every built-in design ships one', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withImage('{{lab.logo}}') });
    expect(res.statusCode).toBe(201);
  });

  it('accepts a png data URI', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/report-designs', payload: withImage('data:image/png;base64,iVBORw0KGgo=') });
    expect(res.statusCode).toBe(201);
  });

  it('still SERVES a stored design whose image source is invalid', async () => {
    // Guards the constraint that the rule never migrates into the zod schema: a row written before
    // this rule existed must remain readable, or it could never be opened and corrected.
    await ctx.reportDesigns.create(withImage('https://example.org/l.png') as never);
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pages[0].elements[0].src).toBe('https://example.org/l.png');
  });
```

If the test file's fixture names differ (`ctx`, `minimal`, `app`), adapt to whatever that file already uses — do not restructure it.

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd apps/server && npx vitest run src/report-designs-routes.test.ts
```
Expected: FAIL — the two rejection tests get `201`/`200` instead of `400`. The acceptance tests and the GET test should already pass.

- [ ] **Step 3: Write the implementation**

In `apps/server/src/report-designs-routes.ts`, extend the import on line 3:

```ts
import { ReportDesignSchema, findInvalidImageSources } from '@openldr/report-designer/pure';
```

Call the validator directly in each handler — no local wrapper. Add a comment above the `POST` route explaining the placement, since the *absence* of this check on `/preview` is deliberate and would otherwise look like an oversight:

```ts
  // Write-time image gate on POST/PUT only.
  //
  // ⛔ Deliberately NOT on `/preview`: an author must be able to preview a design that already
  // contains a bad image in order to SEE the problem. Preview is diagnostic; save is the gate.
  // ⛔ Deliberately not a zod refinement either — `fromRow` parses stored designs through the same
  // schema, so a refinement would run on READ and make such a design permanently unopenable.
```

In the `POST` handler, immediately after the `safeParse` guard:

```ts
    const invalidImages = findInvalidImageSources(p.data);
    if (invalidImages.length > 0) { reply.code(400); return { error: 'invalid image source', invalidImages }; }
```

And in the `PUT` handler, in the same position (after `safeParse`, before the `before` lookup):

```ts
    const invalidImages = findInvalidImageSources(p.data);
    if (invalidImages.length > 0) { reply.code(400); return { error: 'invalid image source', invalidImages }; }
```

Two call sites of a two-line guard is the right amount of repetition here; extracting a helper that wraps a single function call would add indirection without removing anything.

Leave the `/preview` handler untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd apps/server && npx vitest run src/report-designs-routes.test.ts
```
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the package's lint**

`apps/server` is the only package with real lint, and it enforces a `reply.send` invariant.

Run:
```bash
cd apps/server && npx eslint src/report-designs-routes.ts
```
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/report-designs-routes.ts apps/server/src/report-designs-routes.test.ts
git commit -m "feat(server): reject unrenderable image sources when saving a design

An https source renders fine on the studio canvas and silently becomes a
dashed placeholder in the PDF, so it is refused at write. Preview is left
ungated on purpose — you must be able to preview a bad design to see it."
```

---

### Task 3: Image upload affordance in the Properties panel

**Files:**
- Modify: `apps/studio/src/report-designer/PropertiesTab.tsx:177-184`
- Modify: `apps/studio/src/report-designer/PropertiesTab.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `apps/studio/src/i18n/fr.ts`, `apps/studio/src/i18n/pt.ts`

**Interfaces:**
- Consumes: `ELEMENT_IMAGE_MAX_BYTES`, `ELEMENT_IMAGE_MIME`, `validateImageSrc` — re-exported through `./types` (which does `export * from '@openldr/report-designer/pure'`), so import them from `'./types'` like the file's existing `encodeCode128` import.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Add the i18n keys to all three files**

In `apps/studio/src/i18n/en.ts`, inside the `reportDesigner: { … }` block, after the `duplicate:` line:

```ts
    chooseImage: 'Choose image…',
    removeImage: 'Remove image',
    imageType: 'Unsupported image type — use PNG, JPEG or WebP',
    imageTooBig: 'Image too large (max {{max}} KB)',
    imageReadError: 'Could not read that file',
    imageToken: 'Resolved at render',
```

In `apps/studio/src/i18n/fr.ts`, same position in its `reportDesigner` block:

```ts
    chooseImage: 'Choisir une image…',
    removeImage: 'Supprimer l’image',
    imageType: 'Type d’image non pris en charge — utilisez PNG, JPEG ou WebP',
    imageTooBig: 'Image trop volumineuse (max {{max}} Ko)',
    imageReadError: 'Impossible de lire ce fichier',
    imageToken: 'Résolu au rendu',
```

In `apps/studio/src/i18n/pt.ts`:

```ts
    chooseImage: 'Escolher imagem…',
    removeImage: 'Remover imagem',
    imageType: 'Tipo de imagem não suportado — use PNG, JPEG ou WebP',
    imageTooBig: 'Imagem demasiado grande (máx. {{max}} KB)',
    imageReadError: 'Não foi possível ler esse ficheiro',
    imageToken: 'Resolvido na renderização',
```

- [ ] **Step 2: Verify i18n parity before going further**

Run:
```bash
cd apps/studio && npx vitest run src/i18n/parity.test.ts
```
Expected: PASS, 3 tests. If it fails, a key is missing from `fr` or `pt` — fix before continuing.

- [ ] **Step 3: Write the failing tests**

Add to `apps/studio/src/report-designer/PropertiesTab.test.tsx`. It already has `setup(overrides)` and `tplWithEl(el)` helpers — use them; do not restructure the file.

```ts
describe('PropertiesTab image source', () => {
  const imageEl = (src: string): DesignElement =>
    ({ id: 'i1', kind: 'image', name: 'Logo', rect: { x: 0, y: 0, w: 10, h: 10 }, src });

  it('offers a file picker for an image element instead of a bare URL field', () => {
    setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    expect(screen.getByTestId('image-file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose image…' })).toBeInTheDocument();
  });

  it('shows a token source as text and does not replace it with an upload widget', () => {
    // The nine built-in designs bind their logo to `{{lab.logo}}`; the panel must stay able to
    // show and edit that, not hide it behind a file picker.
    setup({ template: tplWithEl(imageEl('{{lab.logo}}')), selectedIds: ['i1'] });
    expect(screen.getByDisplayValue('{{lab.logo}}')).toBeInTheDocument();
    expect(screen.getByText('Resolved at render')).toBeInTheDocument();
    expect(screen.queryByTestId('image-file')).not.toBeInTheDocument();
  });

  it('rejects an oversize file without patching the element', () => {
    const props = setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-file'), { target: { files: [big] } });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(props.onPatchElement).not.toHaveBeenCalled();
  });

  it('rejects an svg file without patching the element', () => {
    const props = setup({ template: tplWithEl(imageEl('')), selectedIds: ['i1'] });
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByTestId('image-file'), { target: { files: [svg] } });
    expect(screen.getByText(/Unsupported image type/i)).toBeInTheDocument();
    expect(props.onPatchElement).not.toHaveBeenCalled();
  });
});
```

Note `setup` already supplies an `onPatchElement` spy and returns the props object, so no extra spy plumbing is needed.

- [ ] **Step 4: Run the tests to verify they fail**

Run:
```bash
cd apps/studio && npx vitest run src/report-designer/PropertiesTab.test.tsx
```
Expected: FAIL — `Unable to find an element by: [data-testid="image-file"]`.

- [ ] **Step 5: Write the implementation**

In `apps/studio/src/report-designer/PropertiesTab.tsx`, add `useRef` to the React import on line 1 and extend the `./types` import on line 11 to include the three new names:

```ts
import { useState, useEffect, useRef } from 'react';
```
```ts
import { encodeCode128, encodeQr, maxCode128Chars, minWidthPxFor, moduleWidthMm, MIN_MODULE_MM, QR_QUIET_ZONE, ELEMENT_IMAGE_MAX_BYTES, ELEMENT_IMAGE_MIME, validateImageSrc } from './types';
```

Replace the whole `if (el.kind === 'image')` block (lines 177-184) with:

```ts
  if (el.kind === 'image') {
    return <ImageSource el={el} onPatch={onPatch} />;
  }
```

Then add this component near the file's other small components:

```tsx
/** Image source. Mirrors Settings ▸ Laboratory's logo flow (`pages/settings/Laboratory.tsx`):
 *  choose a file, read it as a data URI, store that. A URL is not offered, because pdfkit reads a
 *  URL source as a file path and the image would silently vanish from the PDF while looking fine
 *  here. A token source (`{{lab.logo}}`) stays editable as text — the built-in designs use one. */
function ImageSource({ el, onPatch }: { el: DesignElement; onPatch: (patch: Partial<DesignElement>) => void }): JSX.Element {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const src = el.src ?? '';
  const isToken = /\{\{[^}]+\}\}/.test(src);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!(ELEMENT_IMAGE_MIME as readonly string[]).includes(file.type)) { setError(t('reportDesigner.imageType')); return; }
    if (file.size > ELEMENT_IMAGE_MAX_BYTES) {
      setError(t('reportDesigner.imageTooBig', { max: Math.round(ELEMENT_IMAGE_MAX_BYTES / 1024) })); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      // Checked twice on purpose, not by oversight: the checks above run on the File BEFORE reading
      // it, so a 40 MB pick is refused without being loaded into memory; this one runs on the
      // encoded result, catching a file whose declared type disagrees with its bytes. The server
      // remains authoritative — both of these only save the author a failed round trip.
      const reason = validateImageSrc(value);
      if (reason) { setError(t(reason === 'too-large' ? 'reportDesigner.imageTooBig' : 'reportDesigner.imageType', { max: Math.round(ELEMENT_IMAGE_MAX_BYTES / 1024) })); return; }
      setError(null);
      onPatch({ src: value });
    };
    reader.onerror = () => setError(t('reportDesigner.imageReadError'));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.source')}</div>
      {isToken ? (
        <>
          <Input aria-label={t('reportDesigner.source')} value={src}
            onChange={(e) => onPatch({ src: e.target.value })} className="h-8 text-xs" />
          <div className="text-[10px] text-muted-foreground">{t('reportDesigner.imageToken')}</div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          {src
            ? <img src={src} alt={el.name} className="h-10 w-10 border border-border object-contain" />
            : <div className="flex h-10 w-10 items-center justify-center border border-dashed border-border text-[10px] text-muted-foreground">—</div>}
          <input ref={fileRef} type="file" data-testid="image-file" aria-label={t('reportDesigner.chooseImage')}
            className="hidden" accept={ELEMENT_IMAGE_MIME.join(',')} onChange={(e) => onFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            {t('reportDesigner.chooseImage')}
          </Button>
          {src && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); onPatch({ src: '' }); }}>
              {t('reportDesigner.removeImage')}
            </Button>
          )}
        </div>
      )}
      {error && <div className="text-[10px] text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
cd apps/studio && npx vitest run src/report-designer/PropertiesTab.test.tsx
```
Expected: PASS, all tests in the file.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/report-designer/PropertiesTab.tsx apps/studio/src/report-designer/PropertiesTab.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): give image elements a file picker instead of a URL field

The field advertised https:// and nothing validated it, while pdfkit reads
a URL as a file path — so the image looked right on canvas and silently
vanished from the PDF. Mirrors the Settings logo flow. A {{lab.logo}} token
stays editable as text, since the built-in designs use one."
```

---

### Task 4: Menu honesty — implement Duplicate, disable Check

**Files:**
- Modify: `apps/studio/src/report-designer/ReportDesignerPage.tsx:31, 272-286, 433`
- Modify: `apps/studio/src/report-designer/CanvasHeader.tsx:38-39, 133`
- Modify: `apps/studio/src/report-designer/ReportDesignerPage.test.tsx`
- Modify: `apps/studio/src/report-designer/CanvasHeader.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks consume.

**Why Duplicate matters more than it looks:** the boot seed overwrites a built-in design whenever it drifts from the shipped copy, and the comment governing that (`packages/reporting/src/seed/report-seeds.ts:2534`) names Duplicate as the sanctioned way to customise one without losing the edits. It is currently `noop`, so the documented remedy does nothing.

- [ ] **Step 1: Add the i18n keys to all three files**

`en.ts`, in the `reportDesigner` block after `duplicate:`:

```ts
    copyOf: 'Copy of {{name}}',
    checkUnavailable: 'Preflight not available yet',
```

`fr.ts`:

```ts
    copyOf: 'Copie de {{name}}',
    checkUnavailable: 'Contrôle préalable non disponible',
```

`pt.ts`:

```ts
    copyOf: 'Cópia de {{name}}',
    checkUnavailable: 'Verificação prévia ainda não disponível',
```

- [ ] **Step 2: Verify i18n parity**

Run:
```bash
cd apps/studio && npx vitest run src/i18n/parity.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 3: Write the failing tests**

Add to `apps/studio/src/report-designer/CanvasHeader.test.tsx`. It already has `setup(overrides)` and `openKebab()` — use them.

⚠ Its `setup` currently passes `onCheck: vi.fn()`. Because Step 5 removes `onCheck` from the props interface, **delete `onCheck: vi.fn(),` from that props object in the same edit** or the file will not typecheck.

```ts
  it('shows Check as disabled — it has no preflight behind it yet', async () => {
    setup();
    await openKebab();
    expect(screen.getByRole('menuitem', { name: /check/i })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows Duplicate as enabled and calls its handler', async () => {
    const props = setup();
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }));
    expect(props.onDuplicate).toHaveBeenCalled();
  });
```

Add to `apps/studio/src/report-designer/ReportDesignerPage.test.tsx`. It already has `renderPage(id)` (defaulting to `rt-amr-summary`, one of `MOCK_TEMPLATES`) and `openKebab()`.

```ts
  it('Duplicate creates an independent unsaved copy and leaves the original alone', async () => {
    // The seed's managed-overwrite comment names Duplicate as the way to customise a built-in
    // without losing the edits on the next boot, so the copy MUST get an id the seed never iterates.
    await renderPage('rt-amr-summary');
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }));

    await waitFor(() => expect(screen.getByLabelText('Report name')).toHaveValue('Copy of AMR summary'));
    // Transient: the copy is not persisted until Save, exactly like New template.
    expect(createReportDesign).not.toHaveBeenCalled();
    expect(updateReportDesign).not.toHaveBeenCalled();
  });
```

`createReportDesign` and `updateReportDesign` are already imported and mocked at the top of that file, and the suite clears mocks before each test.

- [ ] **Step 4: Run the tests to verify they fail**

Run:
```bash
cd apps/studio && npx vitest run src/report-designer/CanvasHeader.test.tsx src/report-designer/ReportDesignerPage.test.tsx
```
Expected: FAIL — Check has no `aria-disabled`, and Duplicate does nothing so no "Copy of" appears.

- [ ] **Step 5: Disable Check in the header**

In `apps/studio/src/report-designer/CanvasHeader.tsx`, replace the `Check` menu item (line 133) with:

```tsx
            <DropdownMenuItem disabled className="flex-col items-start gap-0">
              <span className="flex items-center"><ShieldCheck className="mr-2 h-4 w-4" /> {t('reportDesigner.check')}</span>
              <span className="pl-6 text-[10px] text-muted-foreground">{t('reportDesigner.checkUnavailable')}</span>
            </DropdownMenuItem>
```

The item stays visible because preflight is on the roadmap; an action that vanishes and later returns is its own small confusion. `disabled` on a Radix `DropdownMenuItem` renders `aria-disabled="true"` and stops `onSelect` firing.

Then remove `onCheck` from the props interface (line 38) since nothing calls it any more.

- [ ] **Step 6: Implement Duplicate**

In `apps/studio/src/report-designer/ReportDesignerPage.tsx`, add this next to `newTemplate` (after line 286):

```ts
  /** Duplicate the open design. Mirrors `newTemplate`: the copy is TRANSIENT until Save, so
   *  duplicating never silently creates server state and the existing "Unsaved" chip carries the
   *  pending state. Two adjacent menu items with opposite persistence semantics would be its own
   *  false affordance.
   *
   *  Inner element ids are copied verbatim — nothing outside a design references them
   *  (`resolveDesignTables` keys resolved tables by `el.id` within one design), so regenerating
   *  them would add risk and buy nothing. A duplicate of a built-in therefore carries element ids
   *  beginning with the original's id; that is cosmetic. */
  const duplicateTemplate = () => {
    if (!template) return;
    flushOpen(); // persist any pending edits on the source before switching away
    const id = `rt-${Date.now()}`;
    const copy: ReportTemplate = {
      ...structuredClone(template),
      id,
      name: t('reportDesigner.copyOf', { name: template.name }),
    };
    setTransientIds((s) => new Set(s).add(id));
    loadedIdRef.current = id;
    setTemplates((ts) => [copy, ...ts]);
    setSelectedId(id);
    setSelectedIds([]);
    setEditingId(null);
  };
```

Then change the menu wiring on line 433 from:

```tsx
                onCheck={noop} onDuplicate={noop} onDelete={() => setConfirmDeleteOpen(true)} />
```

to:

```tsx
                onDuplicate={duplicateTemplate} onDelete={() => setConfirmDeleteOpen(true)} />
```

Finally delete the now-unused `noop` declaration on line 31.

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```bash
cd apps/studio && npx vitest run src/report-designer/CanvasHeader.test.tsx src/report-designer/ReportDesignerPage.test.tsx
```
Expected: PASS, all tests in both files.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/CanvasHeader.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx apps/studio/src/report-designer/CanvasHeader.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): implement Duplicate, mark Check unavailable

Duplicate was a noop, and the boot seed's managed-overwrite comment names
it as the sanctioned way to customise a built-in without losing the edits —
so the documented remedy did nothing. Check keeps its place but is disabled
with a reason until preflight exists."
```

---

### Task 5: Bound-table headers on the canvas

**Files:**
- Modify: `apps/studio/src/report-designer/PageCanvas.tsx:292-308`
- Modify: `apps/studio/src/report-designer/PageCanvas.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Add the i18n keys to all three files**

`en.ts`, in the `reportDesigner` block:

```ts
    headersFromData: 'Headers from data',
    rowsAtRender: 'Rows at render',
```

`fr.ts`:

```ts
    headersFromData: 'En-têtes issus des données',
    rowsAtRender: 'Lignes au rendu',
```

`pt.ts`:

```ts
    headersFromData: 'Cabeçalhos dos dados',
    rowsAtRender: 'Linhas na renderização',
```

- [ ] **Step 2: Verify i18n parity**

Run:
```bash
cd apps/studio && npx vitest run src/i18n/parity.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 3: Write the failing tests**

`PageCanvas.test.tsx` has no single-element helper — its tests call `render(<PageCanvas … />)` directly with `MOCK_TEMPLATES[0]`. Add a small local helper plus the three tests:

```ts
function tplWithTable(el: DesignElement): ReportTemplate {
  return { id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [], pages: [{ id: 'p1', elements: [el] }] };
}
function renderTable(el: DesignElement) {
  render(<PageCanvas template={tplWithTable(el)} zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
}

describe('PageCanvas bound tables', () => {
  it('renders a bound table using its boundColumns labels, not the static columns', () => {
    renderTable({
      id: 't1', kind: 'table', name: 'Results', rect: { x: 0, y: 0, w: 200, h: 60 },
      columns: ['stale'],
      dataSource: { kind: 'custom-query', queryId: 'q1' },
      boundColumns: [{ key: 'organism', label: 'Organism' }, { key: 'n', label: 'Tested' }],
    });
    expect(screen.getByText('Organism')).toBeInTheDocument();
    expect(screen.getByText('Tested')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('renders a transposed table with its label and a data-derived header marker', () => {
    // A transposed table leaves boundColumns EMPTY by design — its headers are the organisms that
    // cleared the isolate threshold. The audit's "show boundColumns" minimum is a no-op here, and
    // this is the cumulative antibiogram, the table it most criticises.
    renderTable({
      id: 't2', kind: 'table', name: 'Antibiogram', rect: { x: 0, y: 0, w: 200, h: 60 },
      dataSource: { kind: 'custom-query', queryId: 'q2' },
      transpose: true, transposeLabel: 'Antimicrobial',
    });
    expect(screen.getByText('Antimicrobial')).toBeInTheDocument();
    expect(screen.getByText('Headers from data')).toBeInTheDocument();
  });

  it('leaves an unbound table showing its static sample columns and rows', () => {
    renderTable({
      id: 't3', kind: 'table', name: 'Static', rect: { x: 0, y: 0, w: 200, h: 60 },
      columns: ['A', 'B'], rows: [['1', '2']],
    });
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
```

`DesignElement` needs adding to the file's existing `import type { ReportTemplate } from './types'` line.

**Do not expect the file's existing tests to change.** Every `MOCK_TEMPLATES` table is unbound (static `columns`/`rows`, no `dataSource`), so the existing `renders every element and the table columns` test — which asserts `Organism` — keeps passing through the unbound branch. If that test breaks, the branch condition is wrong.

- [ ] **Step 4: Run the tests to verify they fail**

Run:
```bash
cd apps/studio && npx vitest run src/report-designer/PageCanvas.test.tsx
```
Expected: FAIL — the first two tests cannot find `Organism` / `Antimicrobial`; the third already passes.

- [ ] **Step 5: Write the implementation**

In `apps/studio/src/report-designer/PageCanvas.tsx`, replace the `case 'table':` block (lines 292-308) with:

```tsx
    case 'table':
      return <TablePreview el={el} />;
```

Then add this component beside the file's other preview components:

```tsx
/** Canvas preview of a table, in three states.
 *
 *  ⚠ A BOUND table's real content lives in `boundColumns` and the resolved query rows; the static
 *  `columns`/`rows` are sample scaffolding from before it was bound. Rendering those made a bound
 *  table look empty (or stale) in the editor while the PDF was fully populated.
 *
 *  ⛔ A TRANSPOSED table leaves `boundColumns` empty ON PURPOSE — its headers are data (the
 *  organisms that cleared the isolate threshold), so they cannot be known without running the
 *  query. The audit's minimum bar ("show its boundColumns headers") is a no-op for exactly the
 *  table it most criticises, the cumulative antibiogram. We show the one header we do know and
 *  mark the rest as data-derived rather than inventing plausible names. */
function TablePreview({ el }: { el: DesignElement }): JSX.Element {
  const { t } = useTranslation();
  const bound = Boolean(el.dataSource);
  const headerCell = 'border border-neutral-300 bg-neutral-100 px-1 py-0.5 text-left font-medium';

  if (bound && el.transpose) {
    return (
      <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
        <thead>
          <tr>
            <th className={headerCell}>{el.transposeLabel ?? ''}</th>
            <th className={cn(headerCell, 'italic text-neutral-400')}>{t('reportDesigner.headersFromData')}</th>
          </tr>
        </thead>
      </table>
    );
  }

  if (bound) {
    return (
      <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
        <thead>
          <tr>{(el.boundColumns ?? []).map((c) => (
            <th key={c.key} className={headerCell}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={Math.max(1, (el.boundColumns ?? []).length)} className="px-1 py-0.5 italic text-neutral-400">
              {t('reportDesigner.rowsAtRender')}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <table className="h-full w-full border-collapse text-[8px] text-neutral-700">
      <thead>
        <tr>{(el.columns ?? []).map((c) => (
          <th key={c} className={headerCell}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {(el.rows ?? []).map((r, ri) => (
          <tr key={ri}>{r.map((cell, ci) => (
            <td key={ci} className="border border-neutral-200 px-1 py-0.5">{cell}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
```

`cn` and `useTranslation` are already imported at the top of this file.

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
cd apps/studio && npx vitest run src/report-designer/PageCanvas.test.tsx
```
Expected: PASS, all tests in the file.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/report-designer/PageCanvas.tsx apps/studio/src/report-designer/PageCanvas.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): show a bound table's real headers on the canvas

The canvas drew only the static sample columns, so a bound table looked
empty in the editor and was populated in the PDF. A transposed table keeps
its own state: its headers are data-derived, so we show the label we know
and mark the rest rather than inventing names."
```

---

### Task 6: Full gate

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: evidence the slice is clean across packages.

- [ ] **Step 1: Run the full gate**

Run from the worktree root:
```bash
pnpm turbo run typecheck test --force --continue
```
`--continue` surfaces every failing package in one pass instead of stopping at the first; a full run takes about 10 minutes. **Do not pipe this through `tail`** — it hides which package failed.

- [ ] **Step 2: Triage any failure before blaming this slice**

Grep the output for `Test timed out`. Gate failures in this repo are frequently parallel-execution timeouts rather than regressions. Re-run any failing package alone:

```bash
cd packages/<name> && npx vitest run
```
If it passes in isolation, it was a flake — say so and name the package. If it fails in isolation, it is a real regression from this slice; report it with the failing test name and output.

Known pre-existing and NOT caused by this slice: `@openldr/cli#build` fails on Windows (esbuild native module). You are running `typecheck` and `test`, not `build`, so you should not hit it.

- [ ] **Step 3: Confirm the working tree contains only intended changes**

Run:
```bash
git status --short
```
Expected: clean. A generated `apps/web/vite.config.ts.timestamp-*.mjs` may appear from the gate run — delete it, do not commit it.

```bash
git log --oneline main..HEAD
```
Expected: the spec commit plus five implementation commits.

---

## Definition of Done

- An `https://` image source is refused with a 400 at both `POST` and `PUT`, naming the element.
- A design whose image is `{{lab.logo}}` still saves — all nine built-ins remain writable.
- A stored design containing an `https://` image still loads through `GET` and still previews.
- `data:` PNG/JPEG/WebP accepted; SVG and oversize rejected.
- The Properties panel offers a file picker; a token source stays visible and editable as text.
- `Duplicate` produces a transient copy with a new id, named "Copy of …", leaving the source untouched.
- `Check` is visible, disabled, and states why.
- A bound table shows its `boundColumns` labels; a transposed table shows its label plus a data-derived marker; an unbound table is unchanged.
- `apps/studio/src/i18n/parity.test.ts` passes — every new key exists in en, fr and pt.
- `pnpm turbo run typecheck test --force` is clean.
