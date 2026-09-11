# P07: SQL Server table pagination

## Approved scope and proof

The operator approved SQL Server continuation paging for table browsing and query results.
The parent added QueryTab because it consumes the same paged query response.

The gap would be refuted if the server supplied a total, or the footer already used continuation.
Neither was true. `apps/server/src/query-routes.ts:118` skips the count for SQL Server.
Before this change, both query consumers substituted the current page's rowCount for the total.
That disabled Next on the first full page.

Plan: add failing route and UI regressions, request one extra row, expose hasMore, wire the shared
footer into both query consumers, and document ordering limits in all three languages.

## Contract and implementation

`POST /api/query/run` returns optional `hasMore` for SQL Server requests with an explicit limit.
It requests limit plus one rows, returns at most limit rows, and excludes the probe row from rowCount.
It does not return an invented total. At the public limit of 1,000, the internal request is 1,001.
PostgreSQL and MySQL/MariaDB keep their existing count query and total.

`TablePagination` now accepts `total: number | null`. Existing numeric totals retain their behavior.
For null, callers supply the current `rowCount` and optional `hasMore`. The footer shows a translated
range with "total unknown". Next follows hasMore; absent continuation disables it. Previous follows
the page index. The footer wraps when the longer caption cannot fit beside other content.

`TableTab.tsx:94` guards the entire footer with isTable. DatasetTab never receives this pagination
component. Dataset rows and rowCount still pass unchanged to ResultsGrid.

No ORDER BY or OFFSET expression was added. The existing SQL Server runner uses SET ROWCOUNT,
reads through the requested offset, then slices the rows in memory.

## Verification

Before implementation:

- Route regressions: 6 failed, 27 passed. The expected continuation flag was absent.
- UI regressions: 3 failed, 4 passed. Unknown-total ranges and continuation were absent.

| Command | Observed output | Layer |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 | Locked dependencies |
| `pnpm --filter @openldr/server test src/query-routes.test.ts` | 33 passed | HTTP route contract with fake query runner |
| `pnpm --filter @openldr/bootstrap test src/connector-sql-service.test.ts` | 11 passed | Existing connector runner with fake database driver |
| `pnpm --filter @openldr/studio test src/components/ui/table-pagination.test.tsx src/components/ui/ui-primitives.test.tsx src/query/workspace/TableTab.test.tsx src/query/workspace/QueryTab.test.tsx src/i18n/parity.test.ts src/docs/registry.test.ts` | 38 passed | Footer and consumer behavior, translation keys, docs discovery |
| `pnpm --filter @openldr/studio typecheck` | exit 0 | Studio TypeScript |
| `pnpm --filter @openldr/server typecheck` | exit 0 | Server TypeScript |
| `git diff --check` | exit 0 | Patch whitespace |
| `pnpm --filter @openldr/web test src/docs/DocsPage.test.tsx` | 15 passed | Public documentation shell |

After the mobile caption adjustment, `pnpm --filter @openldr/studio test src/components/ui/table-pagination.test.tsx src/components/ui/ui-primitives.test.tsx` passed all 16 tests.

Coverage includes empty results, short pages, a full final page, a second page, the 1,000-row cap,
Previous, page-size reset, unknown continuation, and unchanged numeric totals.
The existing CodeMirror jsdom measurement warnings appeared. Server tests reported the existing
experimental WASI warning.

## Limits and excluded work

HONEST NON-PROOF: no disposable SQL Server was available. The tests do not prove live SQL Server
execution, scan order, or database performance. A live test needs a disposable database with more
than two pages, a unique ordering key, and unchanged rows during the run.

Arbitrary SQL may lack a unique order. The default table browse does not add ORDER BY. Operators
must add an order ending with a unique key for repeatable pages. Ties and concurrent data changes
can still repeat or omit rows. Pagination is not a database snapshot. Later SQL Server pages can
cost more because the runner reads through the offset. These limits are in Studio and public docs,
in English, French, and Portuguese.

Pre-existing pending-request and stale-response behavior in QueryTab was not expanded in this slice.
The parent checked the synthetic preview at 375x812. TableTab reached ranges 1–50, 51–100,
and 101–120; Next was disabled on the final page. QueryTab reached 1–50 and 51–100.
With the explorer open, the caption initially clipped because it prohibited wrapping. The corrected
caption fits within 111px: scrollWidth and clientWidth both measured 111, with right edge 363
inside the 375px viewport. Bottom controls occupied y772 through y804. The preview used synthetic
rows, had no API proxy, and refused writes. It was stopped and removed after inspection.
Since the footer is bottom-anchored, only a real phone can confirm behavior under retractable
browser chrome.

No new administrative operation was introduced, so no new CLI command is needed. No commits,
merges, pushes, or live writes were performed. The changelog is deferred until an authorized merge
to main, following AGENTS.md.
