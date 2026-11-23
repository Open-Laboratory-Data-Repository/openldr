# Studio: errors as toasts, and no pages a user cannot open

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user never sees a sidebar page they cannot open, and the studio reports load failures and action results as sonner toasts, not red boxes written into the page.

**Why:** the operator keeps meeting a red box such as "list forms failed: insufficient capability" (2026-11-23), after asking several times for toasts. There are two causes. Terminology and Forms have no capability in the sidebar list (`apps/studio/src/shell/AppShell.tsx:40,44`). And about 34 studio files show errors in a red box (`border-destructive/40 bg-destructive/10`) fed by an `error` state.

**Tech stack:** React, shadcn, sonner, vitest. Studio only; no server change.

**Spec:** none. The rule is the operator's own: memory note `status-in-toasts-not-in-forms` ("Keep in-page text only for a state the user must act on, such as a refusal beside the field it concerns") and AGENTS.md section 5.

## Rulings

1. **Sidebar and route gates.** Terminology needs `terminology.view`, and Forms needs `forms.view`. Both are set in `NAV` and on the route (`RequireCapability`), as every other gated page does. Docs stays open to all. A user who lacks both lands on the first page they can open (StartPageGate already does this).
2. **A failed page or list load** shows `toast.error(message)` once per failure. The list area then shows plain muted text from one shared key, `common.loadFailed` ("Could not load this list. Reload the page to try again."), in en, fr and pt. It does not use `StripedEmpty` with "No X yet": stripes mean empty, and a failed load is not empty.
3. **A failed or finished action** (save, create, delete, import, push, publish, run) shows `toast.success` or `toast.error`. A sheet or dialog stays open on error, so the user can fix and retry.
4. **Kept in the page:** a result the user must act on, shown beside the thing it concerns. Examples: the form builder's lint summary, an import's per-row problems, a reconciliation summary, a list of what still holds a pack, a per-item install status. These keep their place. They are not status messages.
5. `Users.tsx` keeps its own in-page "toast" state and box (`pages/Users.tsx:185`). It becomes sonner. `FormCapture.tsx`'s green "Response captured" banner becomes a toast.

## Global constraints

- Worktree `.claude/worktrees/lab-module`, branch `fix/errors-as-toasts`, base `4e13b7a` (main).
- Studio rules from AGENTS.md section 5. Strings in en, fr and pt. No em dashes. No `Co-Authored-By` trailer.
- Existing behaviour changes only as the rulings say. Tests that asserted a red box change to assert the toast (mock `sonner` as existing studio tests do). Name each one in the report.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.

## Review focus

1. A user with no `forms.view` (the reception user on 3220) signs in: no Forms or Terminology in the sidebar. Typing `/studio/forms` shows Access denied, not a red box.
2. A list whose load fails shows one toast and the "Could not load" text, not "No forms yet".
3. A save that fails in a sheet keeps the sheet open with the user's input, and shows a toast.
4. Nothing shows the same error twice (toast and box).
5. A kept in-page result (ruling 4) still shows.

---

### Task 1: Sidebar and routes hide pages users cannot open

**Files:** `apps/studio/src/shell/AppShell.tsx` (NAV 40, 44), `apps/studio/src/App.tsx` (`/terminology` 56 and its sub-routes, `/forms` 92 and the `/forms/...` routes), and their tests.

- [ ] **Step 1: Write failing tests.**
  - `visibleNav` for a user with only `patients.view` lists Patients and Docs, not Terminology or Forms.
  - A user with `forms.view` sees Forms.
  - Routing to `/forms` or `/terminology` without the capability renders the Access denied page.
- [ ] **Step 2: Run** `pnpm --filter @openldr/studio test -- AppShell App`. See them fail.
- [ ] **Step 3: Implement** ruling 1. Check every route under `/forms` and `/terminology` (builder, capture, entries) and gate each with the capability its page's API needs. Say in the report which you chose and why.
- [ ] **Step 4: Run** the studio tests and typecheck. Expect pass.
- [ ] **Step 5: Commit** `fix(studio): hide Terminology and Forms from users who cannot open them`

### Task 2: Errors as toasts in pages, forms, users, roles, workflows, query, dashboard and marketplace

**Files:**
- `pages/Forms.tsx`, `pages/FormCapture.tsx`, `pages/Users.tsx`
- `forms-entries/EntriesTab.tsx`, `forms-builder/FormBuilderPage.tsx` (`forms-builder/LintSummary.tsx` is kept, ruling 4)
- `users/UserDialog.tsx`, `users/ResetPasswordDialog.tsx`, `users/AccessKeysSheet.tsx`, `roles/RoleSheet.tsx`
- `workflows/WorkflowList.tsx`, `query/transfer/ImportQueriesSheet.tsx`, `dashboard/editor/WidgetEditorDialog.tsx`
- `pages/settings/marketplace/MarketplaceTabs.tsx`, `PackageDetail.tsx`, `RemovePackDialog.tsx`
- i18n `common.loadFailed`, and the tests of all of these.

- [ ] **Step 1: Classify** each red box in these files as a load failure, an action result, or kept (rulings 2 to 4). Write the table into the report before changing code.
- [ ] **Step 2: Write or change tests** for each converted box: the toast is called with the message, and the box is gone. Add tests for Review focus 1 to 4 where they apply (Forms list load failure, a sheet save failure).
- [ ] **Step 3: Run** the touched tests. See them fail.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** the studio tests and typecheck. Expect pass.
- [ ] **Step 6: Commit** `fix(studio): show load and action errors as toasts`

### Task 3: Errors as toasts in facilities and terminology

**Files:**
- `pages/Facilities.tsx`, `facilities/FacilityDialog.tsx`, `FacilityHistory.tsx`, `RegisterSourceDialog.tsx`, `ImportFacilitiesSheet.tsx`, `LinkMatchingSheet.tsx`, `ObservedTab.tsx`, `AddFacilityTypeDialog.tsx` (`ColumnMapStep.tsx` and `ReconciliationSummary.tsx` are likely kept, ruling 4)
- `pages/Terminology.tsx`, `terminology/TermDialog.tsx`, `TermsTable.tsx`, `TermMappingDialog.tsx`, `CodingSystemDialog.tsx`, `PublisherDialog.tsx`, `ValueSetBuilder.tsx`, `ontology/OntologyDistributionDialog.tsx`
- The tests of all of these.

Steps as in Task 2. Commit `fix(studio): show facilities and terminology errors as toasts`.

### Task 4: Proof

- [ ] **Step 1:** Run both gate commands. Grep `bg-destructive/10` and `bg-destructive/5` in `apps/studio/src` outside tests. Every remaining hit is a ruling 4 kept result, listed in the report.
- [ ] **Step 2:** Build the standalone and the studio. On a proof install:
  - As a user without `forms.view`: no Forms or Terminology in the sidebar, and `/studio/forms` shows Access denied.
  - As admin: make a list load fail (for example with a revoked token) and see one toast and the "Could not load" text.
- [ ] **Step 3:** Put the screenshots on the screenshot Artifact page (memory note `screenshots-on-an-artifact-page`).
- [ ] **Step 4:** Merge only when the operator says so. Then run `pnpm make:changelog`, push, and restart 3220 with both builds.

Order: 1, 2, 3, 4.
