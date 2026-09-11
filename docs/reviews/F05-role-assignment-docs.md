# F05: role assignment instructions

Implemented in `codex/role-assignment-docs`, based on `c79874ce`.
Worktree: `.worktrees/role-assignment-docs`. The operator authorized local commit and merge.

## Evidence and scope

The refutation check was whether Studio's user editor already offered multiple role checkboxes. It does not.

- `apps/studio/src/docs/0.1.0/en/roles.md:51` previously instructed users to tick multiple roles.
- `apps/studio/src/users/UserDialog.tsx:387` renders a single-choice Role selector.
- `apps/studio/src/users/UserDialog.tsx:258` saves the selected role as a single-element list.
- `apps/studio/src/users/UserDialog.tsx:259` handles assignment failure before success feedback and closing the editor.
- `apps/server/src/users-routes.ts:194` requires users.manage for editing. The assignment route in `apps/server/src/roles-routes.ts:136` uses the roles.manage guard declared at line 29.

The English Users and Roles guides now describe the single-role selection, replacement behavior, save feedback, and reopening the account to verify its selection. They no longer describe multiple role checkboxes in Studio. French and Portuguese guides cover the same assignment procedure. The public Getting started page includes the procedure in all three languages.

Only Markdown changed. No permission behavior, API, CLI, user records, or layout changed. The documentation describes Studio's editor without making a new claim about how every API consumer stores roles. Existing screenshots were reused. No screenshot annotations were added.

## Verification

Commands ran from this worktree.

| Command | Output |
| --- | --- |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 31 tests passed, 2 files passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 14 tests passed, 1 file passed, exit 0 |
| `git diff --check` | exit 0 |

The baseline documentation checks passed all 31 tests. No new tests were added for prose changes.

The public guide rendered all three language sections. Its User role assignment link scrolled to the heading while retaining the documentation route. At 375x812, the settled heading was about 80 pixels from the top and document scroll width was 365 pixels. The English and French instructions wrapped within the viewport.

HONEST NON-PROOF: documentation tests do not prove authorization enforcement. No live user roles were changed. No physical-phone test was run. Studio translations were checked against source labels and the documentation loader, but not separately opened in the browser. No full application suite or typecheck was run for this Markdown-only change.

## Handoff

The preview server was stopped and its browser tab closed. The viewport override was reset. Test logs are retained in the main checkout's ignored `.worktrees/review-evidence/role-assignment-*.log` files.

The operator authorized committing and merging this slice locally. Do not add AI contribution trailers. After merging, run `pnpm make:changelog` and commit any generated changes. A docs-only commit is excluded from public changelog entries.
