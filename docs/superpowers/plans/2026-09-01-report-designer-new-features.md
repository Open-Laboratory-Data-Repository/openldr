# Report Designer New Features (Spec 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four in-scope features, in the spec's order: totals, draft watermark, conditional rules, shared letterhead. The six deferred ideas stay deferred.

**Spec:** `docs/superpowers/specs/2026-09-01-report-designer-new-features-design.md`.

## Global Constraints

As spec 3's, plus one architectural rule per feature:
- Totals ride through `rowsFor`: the synthetic totals row is APPENDED to the projected rows, so chunk counting, slicing and drawing all see it from the one source and the last page can never overflow by one row.
- The watermark is NOT opt-in for drafts — that is its point — so the golden re-records once, with a companion test proving a `published` design is byte-unchanged.
- Rules COMPILE INTO the existing status tokens at projection; the drawing paths do not change. `statusKey` beats a rule when both exist.
- The letterhead band's geometry lives in ONE exported constant; the seeds DELETE their copied blocks. Visual sameness by eye is the bar, not byte identity.

## Tasks

### F1: totals row and sum tokens
Schema `totals?: { label; columns[] }` on table; the transposed-refusal write gate lands beside `findUnsortedHeaderRows` in `header-row.ts` and is wired where that one already is. `rowsFor` appends the totals row (numeric sums, blank for unparseable columns); `drawGrid` styles the ABSOLUTE last row bold with a rule when `el.totals` is set. `{{sum(elementName.key)}}` resolves in the text path against same-page bound tables; unresolvable renders the em dash character per the unset-param convention. Excel appends the same row. Data tab: a Totals label Input (blank = off) plus per-included-column Sum checkboxes. TDD throughout; goldens stay green (opt-in).

### F2: draft watermark
`render/index.ts` draws one diagonal DRAFT stroke-text per physical page when `design.status === 'draft'`, painted last. Tests: draft has it, published byte-unchanged; golden re-recorded with the reason in the comment. Render and look.

### F3: conditional rules
`rule?: { op: gte|lte|eq|neq; value: string; status: CellStatus }` on BoundColumn and TrailingColumn. Applied where status tokens are read from `statusKey` (numeric compare when both sides parse, else string equality); `statusKey` wins. Data tab: a compact rule line under each included column (op Select, value Input, status Select over CELL_STATUSES). Tests at projection level plus one render look with a rule firing.

### F4: shared letterhead
New kind `letterhead` (compiler chase: icon, name, canvas switch, i18n en/fr/pt). Renderer expands the standard band from exported `LETTERHEAD` constants (logo box, name, address, contact, closing rule — the geometry currently copied in `simple-design.ts:119-123` and both literals). Canvas preview mirrors the same constants. Seeds: `simpleTableDesign` and both literal designs replace their four-to-six copied elements with one letterhead element; the seed tests that pinned copied ids move to the constant. Eye-diff the before/after renders of one factory design, the clinical report and the transmission grid.

### F5: gate, smoke, docs, merge
Full gate; live smoke (author totals + a rule through the UI, preview; confirm the watermark on a draft and its absence after publish); docs bullets; merge `--no-ff`, changelog, push, confirm SHA; update the arc memory.
