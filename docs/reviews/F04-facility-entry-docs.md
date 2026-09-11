# F04 facility entry documentation

## Scope and plan

Approved documentation correction only. Worktree `codex/facility-entry-docs` starts at `2c7bc502`.
Check the current form, route and store first. Replace obsolete manual-entry instructions in
Studio English, French and Portuguese. Add the same instructions to the existing public guide.
Preserve detailed import guidance. Run documentation registry, validation and public page checks.
No implementation changes, commits, merges, pushes or live writes.

## Evidence

The gap would be false if the form still exposed National code and Local code.
It does not. `packages/db/src/migrations/internal/087_facility_form_one_code.ts:99` names System;
line 111 names Facility code. Both fields are required. The server requires Facility code at
`apps/server/src/facilities-routes.ts:1337`.

- `apps/studio/src/facilities/FacilityDialog.tsx:170` supplies active source names and stored URIs.
- `apps/studio/src/facilities/FacilityDialog.tsx:206` loads the published facility form.
- `apps/studio/src/forms-runtime/ReferencePicker.tsx:19` carries the selected coding answer.
- `apps/studio/src/facilities/FacilityDialog.tsx:283` saves, updates the parent and closes the sheet.
  Line 290 retains a server error in the sheet.
- `apps/server/src/facilities-routes.ts:1378` validates the source before deriving identity.
  Line 1380 derives the id; line 1393 refuses an existing record.
- `apps/server/src/facilities-routes.ts:1525` explains why corrected codes remain editable.
  Line 1545 validates a changed source; line 1580 preserves the internal id on update.
- `packages/db/src/facility-registry-store.ts:281` stores System and Facility code directly.
  Line 553 updates on internal id conflict.
- `packages/bootstrap/src/facility-import.ts:484` resolves existing records by system and code.
- `apps/web/src/docs/content.ts:6` loads version/slug markdown without locale folders.
  Public translations therefore use authored sections within the existing page, following
  `apps/web/src/docs/0.1.0/report-schedules.md`.

Stored terminology codes depend on separately approved SP2-03. Its own worktree has
`packages/db/src/facility-answers.ts:143` selecting `raw.code` for controlled columns.
This worktree includes none of that implementation.

## Changes

All three Studio guides begin with Registry, import and Observed task orientation, followed
by manual entry. Instructions cover source registration, actual default field labels,
configurable forms, selecting terminology results, save errors and corrected identity.
The public guide adds the same manual-entry material in English, French and Portuguese.
Existing import instructions remain intact.

## Verification

- `pnpm --filter @openldr/studio exec vitest run src/docs/registry.test.ts src/docs/validation.test.ts`
  returned exit 0, 2 files passed, 31 tests passed.
- `pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx`
  returned exit 0, 1 file passed, 15 tests passed. jsdom reported its existing
  `window.scrollTo` implementation warning. No `publicDocsPage` test exists under that exact name.
- A Python comparison against `git show HEAD:<path>` found each Studio import block unchanged.
  Output was `en: existing detailed import guidance preserved`, followed by the same for fr and pt.
  The public comparison returned `web: existing import guide preserved`.
- `git diff --check` returned exit 0. Git reported only LF-to-CRLF conversion warnings.

These tests cover documentation registration, links and the public React page. They do not
exercise manual facility saves. HONEST NON-PROOF: no browser or mobile session was run.
A real create/edit session with SP2-03 applied would prove selected-code persistence.
No new screenshots, runtime changes or CLI changes were needed for this documentation slice.
Changelog generation is deferred until after an authorized merge to main, per AGENTS.md.
The `.worktrees` directory is ignored. No `.worktreesignore` file exists in this checkout.

## F04 wording correction

The new-entry action is Create, while editing uses Save, as `FacilityDialog.tsx:317` specifies.
Step 6 now distinguishes these labels in all three Studio locales and the public guide.
The translated create labels are Créer and Criar, from each locale's `common.create` key.
This correction changes instructions only. It does not alter the existing import guidance.
