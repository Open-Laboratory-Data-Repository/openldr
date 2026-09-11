# SP2-06 query naming documentation

The guides now describe generated query names and the absence of a naming control. They no longer suggest creating and deleting queries to change a name.

## Scope

Updated the English in-app query guide. Added concise French and Portuguese query guides with the existing screenshots. Added a public `query-naming` page in all three languages and registered its title and navigation entry.

No query behavior, API, CLI, or other guide changed. The operator authorized local commit and merge. Changelog generation belongs after an authorized merge to main.

## Source evidence

The finding would be false if the workbench exposed a name input or rename action. The source check found neither.

| Source | Evidence |
| --- | --- |
| `apps/studio/src/query/store.ts:60` | New query tabs default to `Query #N`. |
| `apps/studio/src/query/workspace/TabBar.tsx:39` | The tab control selects the tab and displays its title. |
| `apps/studio/src/query/workspace/TabBar.tsx:49` | The new-query control opens a tab without a supplied title. |
| `apps/studio/src/query/workspace/QueryTab.tsx:46` | Save sends `name: tab.title`. |
| `apps/studio/src/query/workspace/QueryTab.tsx:48` | Saving an existing query updates its ID. |
| `apps/studio/src/query/tree/ExplorerTree.tsx:92` | Opening a saved query restores its saved name. |
| `apps/studio/src/query/tree/ExplorerTree.tsx:93` | The row action deletes the query. There is no rename control. |

Read the store, tab bar, query tab, and explorer. Searched `openQueryTab` and `patchQuery.*title` across the query directory to check other title changes.

## Verification

Commands ran in `D:/Projects/Repositories/openldr_ce/.worktrees/query-naming-docs`.

| Command | Output |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Exit 0. Completed using pnpm 11.22.0. |
| `pnpm --filter @openldr/studio test src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers=1 --minWorkers=1` | Exit 0. 2 files passed, 31 tests passed. |
| `pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx --maxWorkers=1 --minWorkers=1` | Exit 0. 1 file passed, 14 tests passed. |
| `git diff --check` | Exit 0. Only Windows line-ending conversion warnings. |

Logs are outside this worktree in `D:/Projects/Repositories/openldr_ce/.worktrees/review-evidence/`:

- `query-naming-install.log`
- `query-naming-studio-tests.log`
- `query-naming-web-tests.log`

The initial test attempts ran before dependency installation finished. Both failed because Vitest was unavailable. Their logs remain in `query-naming-studio-tests-before-install.log` and `query-naming-web-tests-before-install.log`. The commands above passed after installation completed.

The web run emitted jsdom's unimplemented `window.scrollTo` warning. It did not fail a test.

## Limits

HONEST NON-PROOF: Existing tests check the documentation registry, English corpus integrity, and public documentation shell. They do not specifically assert the new public route or translated query content. Browser inspection of the new route and each in-app locale would prove those pages render as intended.

No browser or mobile check ran in this task. The parent task owns browser verification. No database save or report execution was exercised. The naming description follows source inspection, not an end-to-end save test.

The existing English guide contains other claims outside this naming correction. They were not audited or changed. Existing screenshots were reused, not recaptured.

## Combined browser verification

The parent task opened this public guide in the temporary combined checkout. All three language sections rendered. At 375x812, document scroll width was 365 pixels. All five batch guides appeared in public navigation. No physical-phone or live business-operation test was performed.

The combined checkout passed 46 Studio tests, including 15 temporary authored-locale and link checks, and 15 public-doc tests. Studio typecheck exited 0. Preserve all five public guide entries and both new Studio guide entries during the later merge.
