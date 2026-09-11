# P13 directory paging

Implemented on `codex/directory-pagination` from `main` at `2c7bc502`. No commits, merges, pushes, provider writes, or secret environment reads.

## Confirmed gap

The falsifier was an existing nonzero provider offset. The original `packages/adapter-auth/src/index.ts:171` always sent `first=0`, with `max=100`. `packages/ports/src/auth.ts:38` exposed no offset. `apps/server/src/users-routes.ts:119` called the directory without options. The new adapter test failed with expected `100`, received `0`, before implementation.

## Behavior

- `GET /api/users?offset=100&limit=25` returns `rows`, `offset`, `limit`, `total: null`, and `hasMore`.
- Optional `search` and `enabled=true|false` apply at the provider before paging. Page size is 1 to 100. The provider request asks for one extra row to detect continuation.
- No-query `GET /api/users` preserves its existing array contract. Its old limited provider result and local fallback remain for compatibility. Studio uses the explicit paged request.
- `listUserDirectory` in bootstrap is shared by the route and `openldr user directory-list`. Existing `user list` and `users list` retain local-account semantics.
- Unconfigured provider administration falls back to bounded local SQL queries. Local search covers username, display name, and email. SQL orders by username then unique ID before offset and limit.
- Studio preserves column visibility. Search and status replace unsupported arbitrary filters and sorting. Changing search, status, or page size resets the page. Stale responses cannot overwrite newer queries. Saving or toggling an account reloads the current page.
- In-app docs cover English, French, and Portuguese. Public CLI docs contain the same three languages.

Provider search and ordering follow Keycloak. The provider does not expose arbitrary sorting here. Concurrent directory changes can shift offset pages. The provider REST contract documents `first`, `max`, `search`, and `enabled` at https://www.keycloak.org/docs-api/latest/rest-api/index.html.

## Verification

Commands ran from this worktree.

| Command | Result | Layer |
| --- | --- | --- |
| `pnpm --filter @openldr/adapter-auth test -- src/index.test.ts` | 40 passed | Mock HTTP provider query and adapter behavior |
| `pnpm --filter @openldr/bootstrap test -- src/user-directory.test.ts` | 9 passed | Bounded pages, beyond 100, query forwarding, lookahead, bounds, fallback |
| `pnpm --filter @openldr/users test -- src/directory-pagination.test.ts` | 1 passed | Local SQL filtering before paging in pg-mem |
| `pnpm --filter @openldr/server test -- src/users-routes.test.ts` | 27 passed | Route wire contract and existing user routes |
| `pnpm --filter @openldr/cli test -- src/user.test.ts` | 7 passed | CLI option forwarding, output, context closing, existing account audit tests |
| `pnpm --filter @openldr/studio test -- src/pages/Users.test.tsx src/api.users.test.ts src/i18n/parity.test.ts` | 15 passed | Component paging past 100, search reset, status, stale responses, API encoding, locale parity |
| `pnpm --filter @openldr/bootstrap typecheck` | exit 0 | TypeScript |
| `pnpm --filter @openldr/studio typecheck` | exit 0 | TypeScript |
| `pnpm --filter @openldr/server typecheck` | exit 0 | TypeScript |
| `pnpm --filter @openldr/cli typecheck` | exit 0 | TypeScript |
| `git diff --check` | exit 0 | Whitespace |

A local Vite preview rendered the real Users component with 125 mocked accounts. Its isolated configuration read no repository environment files. Playwright CLI resized Chromium to 375 by 812. Document clientWidth and scrollWidth were both 375. The Next button bounds were x=323, y=772, width=40, height=32, bottom=804. Four Next clicks reached the fifth page. An unmatched search produced zero tables, a disabled Next button, and unchanged document width. The first-page screenshot was visually inspected. Table content scrolls horizontally within its pane. Screenshots remain in the worktree's untracked `output/` directory.

HONEST NON-PROOF: Mock HTTP tests do not verify a live Keycloak deployment. pg-mem does not verify real PostgreSQL ordering under concurrent writes. The SQL explicitly includes a unique ID tiebreaker. Browser geometry cannot prove behavior under a real phone's retractable browser chrome. A real phone must confirm the bottom-anchored footer.

## Integration notes

`TablePagination` is identical to the P07 version, including `total: number | null`, `rowCount`, and `hasMore`. Its three unknown-total translation keys also match P07. Keep that shared version when combining patches.

P08 also changes user routes and the users store. P13 adds query handling near GET listing and options to local `list`. It does not change status routes, authentication guards, or migrations.

No changelog generation ran. Repository rules require it after integration on main. No gallery capture, live provider test, or full repository suite ran. Root owns combined verification and integration.
