# Report Designer review

Five hypotheses checked: three confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| RD1 | The design example requires sample records. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/report-designer.md:21` requires the sample. | Use the reader's saved query; keep the zero-count reference optional. |
| RD2 | The guide says designer menus are English only. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/report-designer.md:17` says this. `apps/studio/src/report-designer/CanvasHeader.tsx:136` uses translated menu labels. | Remove the stale language claim. |
| RD5 | A workbench daterange query fails in Reports. | CONFIRMED | A real library GET returned 400 with required parameter: period. `apps/studio/src/reports/ReportParametersBar.tsx:43` passes flat from/to; `packages/dashboards/src/custom-query-run.ts:28` reads a nested value. See date-range-mismatch.json. | Use the existing reporting pattern of two Text query parameters, from and to. No app fix. |
| RD3 | Publish revision adds the Reports library entry. | REFUTED | `apps/studio/src/report-designer/ReportDesignerPage.tsx:480` publishes the design. The separate New report sheet creates the entry at `apps/studio/src/reports/NewReportSheet.tsx:101`. | Keep both deliberate actions. |
| RD4 | Autosave creates a newly named template automatically. | REFUTED | `apps/studio/src/report-designer/ReportDesignerPage.tsx:192` skips transient designs. | Require the explicit first Save. |

The preview has 43 numbered steps and 50 native captures and placements.
Every task has eight steps or fewer. Every numbered step has real UI evidence.
Desktop PNGs are 5120 by 3200. Phone PNGs are 1500 by 3248.
The approved fixed frame, focused crop, surrounding blur and lightbox remain.
New writing was checked with unslop.
The original published guide and images are unchanged.

## Live work

Only isolated API 3007, Studio 5187 and PostgreSQL 15440 were used.
No normal app database was reset or seeded.
The browser inspected the built-in Test Volume Over Time table binding.
It created a separate Request summary design, inserted a table and bound Request count for reporting.
It added a period Date range template parameter.
The reporting query declares two required Text parameters named from and to,
configured default dates, loaded columns, included requests and changed its printed label to Requests.
Load pages and Show data displayed the real zero request count on the canvas.
The browser then saved the new design explicitly.
See design-proof.json.

The first review example used the Query workbench's nested daterange definition.
Its designer preview worked, but a real Reports request returned 400, required parameter: period.
No app code was changed. Only the disposable review design and report were removed for replay.
A separate reporting query now uses the built-in pattern of two Text parameters, from and to.
Its SQL includes the full end day, matching the report calendar and scheduler.
That query was prepared through the isolated API and is an optional download.
The complete design, preview, publication and library-creation steps were replayed through the browser.
A library request with flat from/to now returned 200 with one row, requests: 0.
See date-range-mismatch.json and library-run-proof.json.

The browser rendered and downloaded the draft PDF preview, published a revision and read Versions.
It separately created Request summary report under Operational with the intended design and primary query.
See published-proof.json for the persisted design, revision and report definition.
The browser exported the published design as PDF and Excel.
An XLSX read confirmed sheet Table with Requests as its header and numeric zero as its data.
See workbook-check.json and the exported files.
The browser hid and showed the table, then locked and unlocked it.
It leaves the table visible and unlocked.
The phone capture opened the existing design through the Explorer and inspected More actions.

The existing app's Preview uses a document dialog for the full printable page.
No new dialog or production UI was introduced by this documentation review.
No active credentials or tokens are in the evidence JSON, PDFs or workbook.

## Checks and limits

`python3 docs/review/user-guide/write-guide-article.py report-designer` printed
`Report Designer 43 numbered steps`.
`python3 docs/review/user-guide/build-guide.py report-designer 'Report Designer'` printed
`50 equal screenshot frames, 43 steps, 50 original captures`.

`node docs/review/user-guide/check-guide-preview.cjs report-designer` returned 43 steps,
50 frames, zero missing screenshots, no broken anchors, 5120px enlarged source and HTTP 200.
The mobile preview had height 812 and no page overflow.
Those checks prove preview coverage and layout. The browser and saved output exercise the isolated reporting path.

`pnpm --filter @openldr/server test src/report-designs-routes.test.ts` passed 32 tests.
Those route tests use injected stores and check save, publication, revision and permission behavior.
They do not prove browser layout or a physical printer.

HONEST NON-PROOF: multi-page overflow, charts, cell grids, images, letterheads,
translation editing, grouped elements and version restoration were not exercised.
Versions was read, without changing the working copy through Restore.
Physical phone browser chrome was not tested. Only a real phone confirms bottom-edge reachability.
This preview did not change production code, translations, public docs or the landing changelog.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py report-designer`, then
`python3 docs/review/user-guide/build-guide.py report-designer 'Report Designer'`.
Capture phases are build, bind-tab, publish, exports and phone. Run them sequentially.
Build creates a new saved design; publish creates a revision and a library report.
Inspect existing isolated state before replaying those mutation phases.
The root task registers navigation separately.
