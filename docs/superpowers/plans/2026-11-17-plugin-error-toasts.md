# cdr-source page errors as toasts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every error on the cdr-source page shows as a CE-style sonner toast, and a tab that failed to load says so.

**Architecture:** One `Toaster` mounted in `App`. A small module `ui/src/notify.ts` holds the two ways to raise an error toast. Each panel swaps its inline error `Note` for a call to that module.

**Tech Stack:** React, TypeScript, sonner, Vitest with Testing Library, in `cdr-source/ui`.

**Spec:** `docs/superpowers/specs/2026-11-17-plugin-error-toasts-design.md`

Work in `cdr-source/.claude/worktrees/error-toasts`, branch `error-toasts`, cut from `main` at 2e66cd1.

## Global Constraints

- One new string key only: `page.loadFailed` = en "This tab could not load.", fr "Cet onglet n’a pas pu se charger.", pt "Este separador não pôde ser carregado." If the fr or pt bundle already names a tab with another word, use that word and say so in the report.
- The source system's name never appears in the page, guide or strings.
- shadcn only. Copy CE's `sonner.tsx`; do not invent a toast.
- Kept inline: `held-error` (HeldPanel, a held request's decode error) and `copy-last-error-<id>` (CopyPanel row). Do not toast them.
- No Co-Authored-By lines. Do not merge or push.

## Review Focus

- A poll that sets the same lasting error again must not raise a second toast.
- A one-off failure that happens twice in a row must toast twice.
- A lasting toast must close when its error clears (for example a load that succeeds on retry).
- An empty tab must never show "No source has finished yet" while its load failed.
- The toast must follow the page's light and dark theme.

---

### Task 1: Toaster, notify module and the new string

**Files:**
- Modify: `ui/package.json` (add `sonner`, the same major version as openldr_ce `apps/studio/package.json`)
- Create: `ui/src/components/ui/sonner.tsx` (copied from openldr_ce `apps/studio/src/components/ui/sonner.tsx`; read the theme from the attribute the plugin page's `<html>` carries, which the host sets; find it in `@openldr/plugin-ui-sdk` bootstrap or `ui/src/styles.css`)
- Create: `ui/src/notify.ts`
- Modify: `ui/src/App.tsx` (mount `<Toaster />` once)
- Modify: `ui/src/i18n.ts` (`page.loadFailed` in en, fr, pt)
- Modify: `ui/src/testing/ui.ts` or the shared render helper, so panel tests mount `<Toaster />` beside the panel
- Test: `ui/src/notify.test.tsx`, `ui/src/i18n.test.ts`

**Interfaces:**
- Produces: `toastError(message: string): void` for one-off errors (sonner default duration).
- Produces: `useErrorToast(id: string, message: string | null): void` for lasting errors. When `message` becomes a new non-null value, it raises `toast.error(message, { id, duration: Infinity })`. When it becomes null, it calls `toast.dismiss(id)`. The same message set again raises nothing.

- [ ] **Step 1: Write the failing tests** in `notify.test.tsx`, rendering a test component with `<Toaster />`:
  - `toastError('A')` twice shows the toast text `'A'` (a second call after the first closes shows it again).
  - `useErrorToast('x', 'B')`, then a re-render with `'B'`, shows exactly one toast `'B'`.
  - Changing to `'C'` shows `'C'`. Changing to `null` removes it.
  - `i18n.test.ts`: `page.loadFailed` has the three values above.
- [ ] **Step 2: Run them, see them fail.** `cd ui && npx vitest run src/notify.test.tsx src/i18n.test.ts`
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Full UI suite, typecheck, build.** Expected: 0 failures (main is green at 2e66cd1), typecheck `exit=0`, build `exit=0`. Never read an exit code through a pipe.
- [ ] **Step 5: Commit** `feat(ui): a toast for errors, as CE shows them`

### Task 2: Every page error becomes a toast

**Files:**
- Modify: `ui/src/CheckPanel.tsx`, `ui/src/CopyPanel.tsx`, `ui/src/HeldPanel.tsx`, `ui/src/steps.tsx`
- Test: the matching `*.test.tsx` files

**Interfaces:**
- Consumes: `toastError`, `useErrorToast`, `page.loadFailed` from Task 1.

The sites, by test id on `main` at 2e66cd1:

| Test id | File:line | Kind | Toast id (lasting only) |
|---|---|---|---|
| `check-load-error` | CheckPanel.tsx:385 | lasting | `check-load` |
| `check-start-error` | CheckPanel.tsx:437, 567 | one-off | |
| `check-last-error` | CheckPanel.tsx:481 | lasting | `check-last` |
| `check-action-error` | CheckPanel.tsx:483 | one-off | |
| `check-export-error` | CheckPanel.tsx:486 | one-off | |
| `copy-load-error` | CopyPanel.tsx:303 | lasting | `copy-load` |
| `copy-start-rule` | CopyPanel.tsx:304, 458 | lasting | `copy-rule` |
| `copy-action-error` | CopyPanel.tsx:305 | one-off | |
| `copy-start-error` | CopyPanel.tsx:459 | one-off | |
| `held-load-error` | HeldPanel.tsx:315 | lasting | `held-load` |
| `held-export-error` | HeldPanel.tsx:360 | one-off | |
| `held-list-error` | HeldPanel.tsx:363 | lasting | `held-list` |
| `held-detail-error` | HeldPanel.tsx:446 | lasting | `held-detail` |
| `diag-error` | steps.tsx:93 | one-off | |

Each message keeps its current wording (the same `t(...)` call). One-off errors call `toastError` where the failure is caught. If a one-off error was kept in state only to render the line, remove that state. Lasting errors pass their existing state to `useErrorToast`. Remove each inline `Note`.

Empty states: when the tab's load failed, the striped empty state shows `t('page.loadFailed')` instead of `check.none` (CheckPanel.tsx:388), `copy.empty` (CopyPanel.tsx:312) or `held.none` (HeldPanel.tsx:317).

Do not change `held-error` (HeldPanel.tsx:504) or `copy-last-error-<id>` (CopyPanel.tsx:361).

- [ ] **Step 1: Change the tests first.** Every assertion on a removed test id instead finds the same text in a toast. Add: a failed check load shows `'This tab could not load.'` in the empty state and not `check.none`'s text; a poll that repeats a load error raises one toast; two failed starts in a row raise two toasts.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full UI suite, typecheck, build.** Expected: 0 failures, `exit=0` both.
- [ ] **Step 5: Commit** `fix(ui): the page shows its errors as toasts, and a tab that failed to load says so`

---

### Task 3: empty tabs show only the stripes, edge to edge

Operator request, 2026-11-17, after seeing the Feedback tab: the striped empty state must take the whole space, edge to edge, and a tab's intro text shows only when the tab is not empty. Applies to every tab. Base: `error-toasts` at 9618b15.

Rules (`AGENTS.md` §5 in openldr_ce): rules and fills read edge to edge; use `Bleed` from `ui/src/components/ui/bleed.tsx` as a direct child of the padded container; stripes imply emptiness.

**Files:**
- Modify: `ui/src/CopyPanel.tsx` (`copy-intro`, the connector help or all-taken line, `copy-empty`), `ui/src/steps.tsx` (`NoConnector`, `source.none`), `ui/src/HeldPanel.tsx` (`held.help` line, `held-none`), `ui/src/CheckPanel.tsx` (`check-none`, `check-load-failed`, `check-not-started`)
- Test: the matching `*.test.tsx`

- [ ] **Step 1: Tests first.** For each tab's whole-tab empty state (`copy-empty`, the no-connector state, `held-none`, `check-none`): the tab's intro and help lines are absent, and the stripes element carries the bleed classes that cancel the container's padding. For the same tabs with content, the intro and help lines show as before. For Processing with sources but no run (`check-not-started`, `check-load-failed`): the form stays, and the stripes below it bleed to the left, right and bottom edges.
- [ ] **Step 2: Run them, see them fail.**
- [ ] **Step 3: Implement.** A whole-tab empty state fills the panel from just under the tab bar to the left, right and bottom edges: cancel the panel's padding (Sources and Feedback panels have `px-4 pt-4` from `App.tsx`; the Processing block has `p-4`) with negative margins on the stripes' wrapper, as `Bleed` does. Hide the intro and help lines while the tab is empty. Where the hidden intro was a focus fallback (`intro` ref in `CopyPanel.tsx`), fall back to the page actions button or the panel, so focus never lands on nothing. Do not change the filtered-empty state inside Feedback's table (`held.emptyFiltered`) or `held-gone`.
- [ ] **Step 4: Full UI suite, typecheck, build.** 0 failures; `exit=0` both.
- [ ] **Step 5: Commit** `fix(ui): an empty tab shows only its stripes, edge to edge`
