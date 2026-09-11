# SP2-10 and F08: connector setup instructions

Implemented in `codex/connector-setup-docs`, based on `7cdd346c`.
Worktree: `.worktrees/connector-setup-docs`. The operator authorized local commit and merge.

## Evidence and scope

The refutation check was whether creation already offered an Enabled control or the guide already explained Category. Neither was true.

- `apps/studio/src/docs/0.1.0/en/connectors.md:130` previously told users to pick Type without Category. Line 133 promised an initial Enabled choice.
- `apps/studio/src/pages/settings/Connectors.tsx:137` defaults Category to Plugin. Line 467 renders service selection only for Host.
- `apps/studio/src/pages/settings/Connectors.tsx:551` shows Enabled only when editing an existing connector.
- `apps/server/src/connectors-routes.ts:96` creates host connectors without an enabled override. `packages/db/src/migrations/internal/033_connectors.ts:15` defaults enabled to true.

The English guide now names Add connector, Category, Host, Plugin, and Database type. The SMTP walkthrough uses the same entry path. The instructions explain the initial enabled state, disabling after creation, and testing after saving.

French and Portuguese Studio guides cover this setup procedure. The public Getting started guide includes equivalent instructions in all three languages, linked under Going further.

Only Markdown changed. No connector behavior, API, CLI, permissions, or layout changed. SP2-11 configuration readback remains separate. Existing screenshot assets were reused; no annotations or new captures were added.

## Verification

Commands ran from the worktree.

| Command | Output |
| --- | --- |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 31 tests passed, 2 files passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 14 tests passed, 1 file passed, exit 0 |
| `git diff --check` | exit 0 |

The baseline Studio documentation checks also passed all 31 tests. Existing documentation tests were used; no new tests were added for prose changes.

In the browser, the public guide rendered all three language sections. Its Connector setup link scrolled within the documentation page without replacing the route. At 375x812, document scroll width was 365 pixels and the English instructions wrapped within the viewport.

HONEST NON-PROOF: documentation checks do not prove connector connectivity. No connector was created or modified. No physical-phone test was run. The Studio translations were checked against the UI labels and documentation loader, but were not separately opened in a browser. No full application suite or typecheck was run for this Markdown-only change.

## Handoff

The preview server was stopped and its browser tab closed. The viewport override was reset. Test logs are in the main checkout's ignored `.worktrees/review-evidence/connector-setup-*.log` files.

The operator authorized committing and merging this slice locally. Do not add AI contribution trailers. After merging, run `pnpm make:changelog` and commit any generated changes. A docs-only commit is excluded from the public changelog entries.
