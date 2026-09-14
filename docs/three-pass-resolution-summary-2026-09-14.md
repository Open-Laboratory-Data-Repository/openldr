# Three-pass review resolution summary

45 reviewed findings: 5 confirmed, 39 refuted, and 1 deferred. All five confirmed findings have merged resolutions. The deferred upgrade capability remains outside the agreed scope.

This summary records status after `7378c9ba` on main. It does not repeat the review or assign new scores.

## Original evidence

- [First pass: UI navigation and docs](first-pass-ui-docs-review-2026-09-14.md), mean 8.10/10.
- [Second pass: UI actions with data](second-pass-ui-docs-review-2026-09-14.md), mean 8.15/10.
- [Third pass: production code](third-pass-production-code-review-2026-09-14.md), mean 7.81/10.

The reports remain unchanged historical records of `a1533cd8`. Their statements about authentication bypass, documentation version 0.1.0, and unresolved findings describe that review session. They are not statements about the current checkout. Browser evidence and screenshots referenced by the reports are local ignored artifacts, not part of this documentation commit.

## Confirmed findings resolved

| ID | Finding | Merged resolution | Commit and verification record |
|---|---|---|---|
| F10 | General settings misdescribe supported databases and query limits. | English, French, and Portuguese copy now covers the configured engines and both query modes. Raw SQL row limiting is distinguished from builder overflow errors. | `b48288cd`, [access and copy proof](access-copy-proof-2026-09-14.md) |
| SP2-06 | Saved queries lack reliable naming. | The query workspace offers naming and rename controls with collision handling. | `d0cbfcd9`, [UI follow-up proof](ui-review-followups-proof-2026-09-14.md) |
| SP2-11 | Connector Host column suggests it displays the saved address. | Renamed to Allowed plugin host with explanatory guidance. Saved host addresses remain available through Edit. No new address-list field was added. | `d841622b`, [sheet and column proof](ui-sheets-proof-2026-09-14.md) |
| SP2-N01 | Facility creation exceeds the current page size. | Successful saves reload the bounded page instead of appending an off-page row. | `d0cbfcd9`, [UI follow-up proof](ui-review-followups-proof-2026-09-14.md) |
| SP2-N02 | Registry and schedule editors violate sheet and action-menu conventions. | Both editors use side sheets, header Save menus, and labels beside inputs. | `d841622b`, [sheet and column proof](ui-sheets-proof-2026-09-14.md) |

## Other approved follow-ups

`d0cbfcd9` also added current 0.1.8 documentation and adjusted Playwright artifact ignore rules. `b48288cd` added a dedicated access-denied page and protected the dashboard root with its existing capability. These changes do not alter the original reports' finding counts.

## Verification

The last implementation merge ran `pnpm test` before and after integration. Both runs reported 35 successful tasks, including 33 cached tasks for unchanged packages. Studio reran 2,130 tests across 232 files. Web reran 103 tests across 15 files. The post-merge command exited 0. Details and earlier checks are in the linked proof records.

This documentation-only commit adds the reports and this summary. It changes no application code. The application suite was not rerun for this archival step.

## What remains

- P15, uninterrupted upgrades, remains deliberately deferred. The supplied process supports safe planned downtime, not rolling upgrades. See the [approved upgrade scope](reviews/P15-planned-upgrades.md).
- Real-phone verification remains outstanding. Desktop Chromium viewport checks cannot prove retractable browser chrome behavior.
- The schedule-list drawer still has its existing standalone action controls. The approved conversion covered the editors, not that list. Further consistency work needs its own scope.
- SQL Server deep-page cost may warrant measurement against representative data. The review did not establish unacceptable latency or authorize a redesign.
- Stale worktree directories remain on disk after cleanup attempts were blocked. Git registers only main. Evidence logs were preserved separately.

HONEST NON-PROOF: Resolved findings do not establish production capacity, complete translated UI coverage, live persistence for every editor path, or complete restricted-account security coverage. The original reports and later proof records state which layers each check exercised.
