# F09 and SP2-01: Data exposure scope

Worktree `.worktrees/data-exposure-scope`, branch `codex/data-exposure-scope`, based on `2c7bc502`.

The operator approved a shared documentation and copy correction. Extending policy enforcement to arbitrary connectors is excluded.

## Plan and evidence

The refuting fact would be a column policy check on every advertised query path. Source inspection found separate execution paths without that check. The old description at `apps/studio/src/i18n/en.ts:635` claimed queries, dashboards, and reports never saw hidden columns.

| Path | Evidence and actual scope |
| --- | --- |
| Additional builder columns | `packages/dashboards/src/compile.ts:240` rejects additional join columns outside the exposure list. `packages/bootstrap/src/index.ts:769` supplies the policy to execution and `:793` supplies it to SQL conversion. |
| Built-in model dimensions | `packages/dashboards/src/models/registry.ts:241` returns built-in dimensions unchanged. The policy is not a blanket result filter. |
| Raw SQL widgets | `packages/bootstrap/src/index.ts:781` calls the SQL runner without the column policy. `packages/dashboards/src/sql-runner.ts:87` accepts SQL and execution limits, not a column policy. |
| Custom queries and reports | `packages/bootstrap/src/index.ts:687` builds report query dependencies using connector SQL. `packages/dashboards/src/custom-query-run.ts:65` delegates stored query execution to that runner. |
| Report Designer | `apps/server/src/report-designs-routes.ts:171` resolves table data with stored queries. |
| Workflow Database nodes | `packages/workflows/src/engine/node-handlers/connector-sql.ts:16` calls the connector runner. |
| Connectors | `packages/bootstrap/src/connector-sql-service.ts:54` executes paginated SQL without the policy. Its SELECT validation and row limits do not filter sensitive columns. |
| Save and discard | `apps/studio/src/pages/settings/DataExposure.tsx:84` saves; `:98` reloads on discard. `apps/server/src/dashboards-routes.ts:170` writes table settings and `:172` reloads the policy cache. |

The implementation corrects the description and PII confirmation in en/fr/pt. The guides name built-in dimensions, raw SQL, and connector-backed queries as exceptions. They cover local edits, confirmation, save, discard, reopening, and separate verification for each query path. They direct operators to restrict database accounts and approved views.

All three Studio locales contain authored guides. The public guide contains the full procedures in English, French, and Portuguese. Registry and public navigation expose the guide. The English Settings guide links to it. French and Portuguese Settings pages did not exist and retain their existing English fallback. No unrelated translation pages were added.

## Verification

Commands ran from this worktree with dependency junctions pointing to the main checkout.

| Command | Output |
| --- | --- |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts src/pages/Docs.test.tsx --maxWorkers 1 --minWorkers 1` | 49 tests passed before adding targeted locale discovery checks. |
| `pnpm --filter @openldr/studio test -- src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts --maxWorkers 1 --minWorkers 1` | 41 tests passed, including three authored-locale search checks. |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 16 tests passed, including the three-language guide and public link check. |
| `pnpm --filter @openldr/studio typecheck` | `tsc --noEmit`, exit 0. |
| `git diff --check` | Exit 0. |

Existing jsdom scrollTo and React act/router warnings appeared. These checks exercise documentation loading, search, rendering, and links. They do not prove database policy enforcement.

The parent agent opened the public preview on port 5178. All three language sections rendered. At 375x812, document scroll width was 365 pixels and article width was 317 pixels. A scrolled screenshot showed readable text without horizontal overflow. The viewport was restored. No settings or backend actions were performed.

HONEST NON-PROOF: no live policy or connector permission change was made. No real database query, real-phone test, or full suite was run. Studio setting copy was typechecked rather than exercised through a live settings session. A safe test database and separately restricted connector account would prove the operational procedures.

## Handoff

No CLI command, runtime enforcement, table policy, live data, or exported report changed. No commits, merges, or pushes were made. No screenshot assets were added. Changelog generation waits until an authorized merge to main.
