# Query review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| Q1 | Query requires the documentation sample. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/query.md:23` makes it a prerequisite. | Use an actual warehouse count that also returns zero. |
| Q2 | Parameter ordering and removal use visible arrows and a bin. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/query.md:109` describes those controls. `apps/studio/src/query/params/ParametersEditor.tsx:78` instead puts them in row dots. | Describe the current row menu. |
| Q3 | Renaming saves unsaved SQL and parameter changes. | REFUTED | `apps/studio/src/query/workspace/QueryTab.tsx:78` updates only name. | Keep rename separate from Save. |
| Q4 | Deleting a group deletes its queries. | REFUTED | `query-evidence/cleanup-proof.json` retains Request count by period with groupId null after the group disappears. | Explain folder removal separately from query deletion. |

The preview has 53 numbered steps, 69 screenshot placements and 66 original captures.
Every numbered step has real UI evidence. Each task has eight steps or fewer.
Desktop PNGs are 5120 by 3200. Phone PNGs are 1500 by 3248.
The approved fixed frame, focus, blur and enlargement remain.
New writing was checked with unslop.
The original published guide and images were not changed.

## Live work

Only API 3007, Studio 5187 and PostgreSQL 15440 were used.
The normal app database was not reset or seeded.
The browser expanded the actual warehouse connector and public schema, opened lab_requests,
inspected its generated SQL and opened the saved request_summary dataset.
The query results grid draws on a canvas. Screenshots focus the actual header and cell pixels.
The live JSON response confirms the count independently of those pixels.

The browser created a new query, selected the warehouse connector and ran a COUNT.
It then entered date-bound SQL, added a required daterange parameter named period,
entered dates, ran with those values and saved the definition.
The live query result had one row, `requests: 0`.
See create-proof.json. Date ranges bind from and to through
`packages/dashboards/src/custom-query-run.ts:18`.
The example deliberately uses an excluded end date and says so beside both inputs.

The browser renamed the saved query, created a group, moved the query into it,
exported that query and re-imported the file with replacement off.
The same-name import skipped it and retained one definition.
It then deleted the group and confirmed that its query remained outside it.
A disposable query was prepared through the isolated API and deleted through the browser confirmation.
The main reviewed query remains available for later guides.
See manage-proof.json, transfer-proof.json and cleanup-proof.json.

The CLI export used the same isolated database and exported one named query.
`pnpm openldr query export --out /tmp/openldr-guide-query-export.json --name 'Request count by period'`
printed `exported 1 query`.
`pnpm openldr query import /tmp/openldr-guide-query-export.json` printed
`0 created, 0 replaced, 1 skipped.`
See cli-export.txt and cli-import.txt.
Identity administration was disabled for both commands.
No email, active token or live credential is present in these artifacts.

The phone capture expanded the Explorer, opened the saved query, collapsed it and entered dates.
The final phone submission was not repeated; desktop execution used the same configured query.
One capture reload briefly returned an empty page. A fresh browser reload did not reproduce it.
No app change was made for that observation.

## Checks and limits

`python3 docs/review/user-guide/write-guide-article.py query` printed `Query 53 numbered steps`.
`python3 docs/review/user-guide/build-guide.py query Query` printed
`69 equal screenshot frames, 53 steps, 66 original captures`.

`node docs/review/user-guide/check-guide-preview.cjs query` returned 53 steps, 69 frames,
zero missing screenshots, no broken anchors, a 5120px enlarged source and HTTP 200.
Its mobile preview had height 812 and no horizontal page overflow.
This proves the preview layout, image resolution and step coverage.

`pnpm --filter @openldr/server test src/query-routes.test.ts` passed 50 tests.
Those route tests use injected stores and check permission gates, validation and response shapes.
They do not prove external database drivers or real database pagination.
The browser and CLI exercised the isolated PostgreSQL installation separately.

HONEST NON-PROOF: SQL Server, MySQL, large result pages, stable tie ordering,
select-option queries, invalid-file rollback and replacement imports were not exercised live.
They were checked in source and remain subject to their documented limits.
Physical phone browser chrome was not tested. Only a real phone confirms bottom-edge reachability.
No production code, translations, published docs or landing changelog was changed.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py query`, then
`python3 docs/review/user-guide/build-guide.py query Query`.
Capture phases are browse, create, proof, manage, group-proof, transfer, phone and cleanup.
Run them sequentially. Create and manage mutate saved definitions; inspect existing state before replaying them.
Proof and group-proof capture persisted results after earlier phases.
The root task registers navigation separately.

## Final introduction check

The original introduction named Postgres for every fresh installation.
`packages/bootstrap/src/seed.ts:533` selects SQL Server and `:564` selects MySQL instead.
The corrected introduction describes the configured warehouse connector and identifies Postgres as the pictured example.
