# UI review follow-up proof

Date: 2026-09-14

Branch: `codex/ui-review-followups`. Base: `a1533cd83445325b9f25003ea83bc201aa6e0333`.

## Approved changes

- Ignore `.playwright-cli/` and `output/playwright/`.
- Ask for a unique name when saving a new query. Keep the draft after duplicate rejection.
- Rename saved queries without changing their IDs or publishing unsaved SQL and parameters.
- Refresh the query Explorer after saving or renaming.
- Reload the current Facilities page after create or edit. Preserve filters, sorting and page limits.
- Publish a 0.1.8 docs snapshot. Retain 0.1.0 content and links.
- Update query and Facilities instructions in English, French and Portuguese.

The docs snapshot contains 62 Studio files and 25 web files. Existing screenshot assets are shared.
No authentication behavior changed. This pass tested the existing enforcement with bypass disabled.

## Automated checks

Commands ran from the isolated worktree.

```text
pnpm --filter @openldr/studio exec vitest run src/query/workspace/QueryTab.test.tsx src/query/tree/ExplorerTree.test.tsx src/query/store.test.ts src/pages/Facilities.test.tsx src/docs/registry.test.ts src/docs/validation.test.ts src/docs/search.test.ts src/i18n/parity.test.ts src/auth/AuthProvider.test.tsx src/auth/oidc.test.ts --maxWorkers 1 --minWorkers 1 --silent --testTimeout 30000
Test Files 10 passed
Tests 156 passed

pnpm --filter @openldr/web exec vitest run src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1 --silent
Test Files 1 passed
Tests 18 passed

pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts src/account-status-auth.test.ts src/auth-plugin.test.ts --maxWorkers 1 --minWorkers 1 --silent
Test Files 3 passed
Tests 57 passed

pnpm --filter @openldr/studio typecheck
Exit 0

pnpm --filter @openldr/web typecheck
Exit 0

pnpm --filter @openldr/studio exec vite build
Exit 0. Built in 13.68s.

git diff --check
Exit 0. Line-ending warnings only.

git check-ignore .playwright-cli/example.yml output/playwright/example.png
.playwright-cli/example.yml
output/playwright/example.png
```

These are targeted component, registry, route and authentication tests, not the whole repository suite.
The build reports third-party annotation warnings and large chunks. Neither blocked the build.

Regression tests failed before their corresponding changes. They covered the missing naming menu,
duplicate recovery, stale Explorer names, rename publishing dirty SQL, stale Facilities pages,
and the default docs version remaining 0.1.0.

An independent read-only review found rename publishing dirty SQL and one stale Facilities comment.
Both were corrected. Its recheck found no remaining blockers in those findings.

## Signed-in browser checks

Playwright drove headed Chromium against the worktree Studio on `http://localhost:5173/studio/`.
The existing API, Postgres and Keycloak remained running.

| Check | Observed result |
| --- | --- |
| Duplicate query name | POST returned 409. The sheet kept the name and displayed duplicate feedback. |
| Unique query name | POST returned 200. Both the tab and open Explorer showed the saved name. |
| Rename with dirty SQL | PUT sent only the name. The stored ID and SQL stayed unchanged. The editor kept its dirty SQL. |
| Reload saved query | Reopening after reload recovered the stored SQL, not the unpublished draft. |
| Create facility on a full page | A fresh list request followed creation. The table stayed at 50 rows. Total increased from 3777 to 3778. |
| Edit outside the active filter | A fresh filtered list returned zero rows. The edited row disappeared from the table. |
| Docs version | 0.1.8 appeared by default. Selecting 0.1.0 still loaded the guide. |

Synthetic query and facility records created for these checks were deleted afterward.
The Facilities total returned to 3777. Existing review registers, roles and records were left unchanged.

## Authentication checks and cleanup

The temporary account `review-auth-20260914` used the existing zero-capability review role.
Keycloak required a password change at first login. The account then signed in successfully.
`GET /api/me/capabilities` returned an empty capability list.

Requests replayed its actual bearer header in memory. No bearer token was written into this report.

| Request or action | Observed result |
| --- | --- |
| Anonymous GET /api/users | 401 |
| Restricted GET /api/users | 403 |
| Restricted GET /api/dashboards | 403 |
| Restricted GET /api/custom-queries | 403 |
| Restricted GET /api/query/connectors | 403 |
| Direct navigation to /studio/users | Redirected to the dashboard. Users navigation was absent. |
| Sign out | Returned to the identity-provider sign-in form. |
| Login after account deletion | Rejected with invalid username or password. |

Studio has Disable but no Delete action. Cleanup deleted the exact temporary identity through
Keycloak administration, then removed its matching local user, profile and role-assignment rows.
The provider username lookup returned zero users. SQL checks returned zero rows in all three local tables.
Audit history remains. The temporary account cannot be restored through Studio.

## Additional finding, not implemented

1 finding: 1 confirmed.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| AUTH-UI-1 | A no-access account lands on a raw dashboard permission error. | CONFIRMED | Browser showed `list dashboards failed: insufficient capability`. `apps/studio/src/auth/RequireCapability.tsx:25` redirects denied routes to `/`. | Small UI change plus role-navigation tests and translations. |

This is an access-denied presentation issue. The tested protected endpoints rejected access.
It is recorded separately because changing the landing behavior was not approved in this slice.

## Mobile evidence and limits

Inspected screenshots at 375 by 812 pixels:

- `output/playwright/query-name-mobile.png`
- `output/playwright/facilities-mobile.png`
- `output/playwright/docs-018-mobile.png`

The naming sheet kept its input, error and header menu visible. Facilities kept its pager visible
and its wide table horizontally scrollable. The docs version selector and guide remained readable.

HONEST NON-PROOF: Chromium viewport resizing does not prove behavior under a real phone's
retracting browser controls or software keyboard. A physical phone is still required for that check.
No new bottom-anchored UI was introduced.

HONEST NON-PROOF: This was not an exhaustive authentication penetration test. It did not test
every role, token-revocation scenario or protected endpoint. Web docs had component and type checks,
but no separate live web-site browser pass. Report execution after query rename was not repeated;
the browser proved ID preservation and the server route tests covered the query endpoints.

## Restored environment and handoff

The worktree Studio process was stopped after the browser checks. The original main-checkout
Studio was restarted on port 5173 with its previous network binding.

```text
Original Studio HTTP 200
API health HTTP 200
Anonymous users HTTP 401
```

The listener command points to `D:\Projects\Repositories\openldr_ce\apps\studio`, not the worktree.
Only the three existing OpenLDR containers remained running. Both temporary browser sessions were closed.

No commit, push or merge was performed. Changes remain in the isolated worktree.
The main checkout still uses its existing docs version and ignore rules until these changes are merged.
Landing changelog generation is deferred until after merge, as required by `AGENTS.md`.
