# Report Designer Canvas Comfort (Slice C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock and hide per element, duplicate, copy/paste, and layer reordering — the day-to-day feel the operator asked for.

**Architecture:** Two small schema fields (`locked`, `hidden`) with the repo's standard opt-in-and-inert contract. The renderer treats a hidden element as absent (draws nothing, adds no pages, contributes no flow height). The canvas refuses gestures on locked elements. The Layers tab gains the toggles and reordering. Clipboard is in-app module state, not the OS clipboard.

**Tech Stack:** as slices A and B. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-report-designer-authoring-catchup-design.md` (Slice C).

## Global Constraints

Same as slices A and B (shadcn, i18n en/fr/pt, discrete vs coalesced, gate at `--concurrency=4`, no trailers). Plus: every schema addition ships with a golden proof that an old design renders byte-identical.

## Known scope cuts, stated up front

- Paste lands on the SAME page the elements were copied from. Cross-page paste needs the active-page tracking that is already a known deferred gap (Insert always targets page 0); it stays deferred.
- Locked elements stay click-selectable (that is how you reach the unlock control); they refuse move, resize, and delete.
- Hidden elements leave the canvas entirely and are reachable only through Layers.

---

### Task 1: schema fields and renderer absence

**Files:**
- Modify: `packages/report-designer/src/schema.ts` (two optional booleans on DesignElementSchema)
- Modify: `packages/report-designer/src/render/draw.ts` (`drawsOnChunk` returns false for hidden; `elementChunkCount` returns 1; `drawnHeight` returns 0)
- Test: `packages/report-designer/src/render/index.test.ts` (or a focused new file beside it)

Steps: failing tests first — a hidden overflowing table adds no pages; a `flowAfter` follower of a hidden target takes its place; a `locked` element renders exactly as unlocked (locked is authoring-only). Then implement, run the package suite INCLUDING golden, commit.

### Task 2: canvas honors locked and hidden

**Files:**
- Modify: `apps/studio/src/report-designer/PageCanvas.tsx`, `useCanvasInteraction.ts`
- Test: `PageCanvas.test.tsx`

Failing tests: a hidden element renders no ElementBox; pointer-down on a locked element selects but a drag commits no rects; Delete with a locked element selected removes only the unlocked ones; marquee still selects locked (selection is allowed, mutation is not). Implement, commit.

### Task 3: Layers tab toggles and reordering

**Files:**
- Modify: `apps/studio/src/report-designer/LayersTab.tsx`, `model.ts` (`moveElementInPage(tpl, id, dir)`)
- Test: `LayersTab.test.tsx`, `model.test.ts`

Per row: eye toggle writes `hidden`, lock toggle writes `locked` (both discrete), and reorder via HTML5 drag (`draggable`, dragstart/dragover/drop) plus ArrowUp/Down buttons for keyboard and touch, the DataTab move idiom. Failing tests for each patch and for `moveElementInPage` bounds. i18n keys (`showElement`, `hideElement`, `lockElement`, `unlockElement`, `moveUp`/`moveDown` exist). Implement, commit.

### Task 4: duplicate, copy and paste

**Files:**
- Modify: `apps/studio/src/report-designer/ReportDesignerPage.tsx` (keyboard handler + kebab wiring), `CanvasHeader.tsx` (Duplicate element item when a selection exists), `model.ts` (`duplicateElements(tpl, ids)` returning new ids, +12px offset, page-clamped)
- Test: `model.test.ts`, `ReportDesignerPage.test.tsx`

Ctrl/Cmd+D duplicates the selection (one discrete undo step, new elements selected). Ctrl/Cmd+C stores deep copies in module state; Ctrl/Cmd+V pastes with fresh ids and offset onto the source page. The existing canvas keyboard handler's menu/`defaultPrevented` guards apply. Locked elements can be copied but a paste never lands locked (`locked` stripped on paste — a stuck clone helps nobody). Implement, commit.

### Task 5: gate, smoke, docs, merge

Full gate; live smoke with the operator's auth arrangement (hide the letterhead, lock the title, duplicate a table, reorder layers, export and confirm the hidden element is absent from the PDF); docs bullet in the guide; mobile check; merge `--no-ff`, changelog, push after confirming with the operator.
