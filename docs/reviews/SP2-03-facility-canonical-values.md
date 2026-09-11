# SP2-03 facility canonical values

Approved scope: preserve picked codes for level, status, and country. Keep administrative text and extra coding objects unchanged.

Refutation checked: a later route conversion could already restore codes. It does not. `packages/db/src/facility-answers.ts:145` chooses display text. `apps/server/src/facilities-routes.ts:723` validates that flattened value against terminology.

Plan:
1. Add failing unit and HTTP regressions for picked codes and edit roundtrips.
2. Use one shared controlled field list for splitting and validation.
3. Run relevant tests and type checks. Record limits here.

Baseline: `pnpm --filter @openldr/db test src/facility-answers.test.ts` reported 19 passed.

Design: `CONTROLLED_FACILITY_FIELDS` declares column names in the browser-safe DB module. Bootstrap uses that same tuple for its existing validator. The answer splitter preserves `code` for those columns. It still prefers display text for other core columns. Extra answers retain their coding objects.

No vocabulary was added. Route tests select concepts from migrated terminology expansions. The validator still rejects an unknown code, even when its display contains a valid code.

Regression evidence before implementation:
- `pnpm --filter @openldr/db test src/facility-answers.test.ts`: 3 failed, 18 passed. Each controlled column returned display text instead of the expected code.
- `pnpm --filter @openldr/server test src/facilities-routes.test.ts -t 'preserves picked'`: 3 failed, 320 skipped. POST returned 400 for picked level, status, and country displays.

Verification after implementation:
- `pnpm --filter @openldr/db test src/facility-answers.test.ts`: 27 passed.
- `pnpm --filter @openldr/studio test src/forms-runtime/seeded-references.test.ts src/facilities/FacilityDialog.test.tsx`: 35 passed across two files.

The route regression creates each controlled field from a terminology coding. It resubmits the stored string, then the coding object. It also submits an invalid code and checks the stored value survives the rejection.

Existing `apps/studio/src/forms-runtime/seeded-references.test.ts:17` proves exact code resolution. `apps/studio/src/facilities/FacilityDialog.tsx:65` seeds stored values without conversion. Only stale resolver comments changed; its behavior did not.

Limits and skipped work:
- HONEST NON-PROOF: route tests use Fastify injection and pg-mem. They do not prove a live PostgreSQL deployment or browser-to-server flow. Those require a disposable deployed test environment.
- HONEST NON-PROOF: no mobile browser or real phone test ran. No layout or bottom-anchored UI changed.
- Existing rows are not migrated. Existing unchanged-value validation exemptions remain intact.
- No CLI command was added. The defect occurs in form-answer splitting; the CLI already uses the shared controlled-field resolver.
- No operator-facing copy or translation keys changed. The separate F04 documentation slice owns facility help corrections.
- Changelog generation waits until merge to main, as AGENTS.md requires.
- No commits, merges, pushes, or live data mutations occurred.

Remaining verification results:
- `pnpm --filter @openldr/server test src/facilities-routes.test.ts`: 323 passed. Includes all three new create/edit regressions. Expected simulated projection failures and Node's WASI warning appeared in output.
- `pnpm --filter @openldr/bootstrap test src/facility-controlled-fields.test.ts src/facility-controlled-fields.seed.test.ts`: 34 passed across two files.
- `git diff --check`: exit 0; only Git's CRLF conversion notices appeared.
- `pnpm --filter @openldr/db --filter @openldr/bootstrap --filter @openldr/server typecheck`: all three reported `Done`; exit 0. This checks types, not HTTP response shapes.
