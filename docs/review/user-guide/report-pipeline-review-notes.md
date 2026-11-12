# Scheduled workflow reports review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| RP1 | The guide requires sample records before the reporting task. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/report-pipeline.md:20` lists the sample as a prerequisite. | Begin with a working query and workbook; keep practice optional. |
| RP2 | Template and delivery instructions lack screenshots for individual settings. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/report-pipeline.md:106` compresses the upload and five settings under one image. | Capture each setting and actual generated output. |
| RP3 | Upload can precede the first workflow save. | REFUTED | `apps/studio/src/workflows/components/node-forms/excel-template-form.tsx:32` refuses it. | Save first, then upload. |
| RP4 | Load Dataset requires warehouse dataset publication. | REFUTED | `packages/bootstrap/src/index.ts:1237` reads the internal dataset repository directly. The workbook run loaded request_summary without publication. | Explain publication as optional for other SQL consumers. |

The preview has 47 numbered steps and 52 native captures and placements.
Every numbered step has actual UI evidence.
All task groups have eight steps or fewer.
Desktop PNGs are 5120 by 3200. Phone PNGs are 1500 by 3248.
The approved frame, focus, blur and enlargement remain unchanged.
New writing was checked with unslop.

## Live work

Only isolated API 3007, Studio 5187 and PostgreSQL 15440 were used.
A new bucket named `openldr-docs-data-review` was created with the configured local S3 key.
No existing bucket, Garage grant or shared object was changed.
No normal app database was reset or seeded.

The first workflow was built through the canvas from Manual Trigger, SQL Query and Materialize Dataset.
The browser connected the nodes, entered the SELECT, named request_summary, saved, armed and fired it.
It completed and stored one row, `requests: 0`.
The browser inspected Datasets and downloaded its CSV.
The second workflow was built from Manual Trigger, Load Dataset and Excel Template.
The browser uploaded a real one-column workbook into the isolated bucket, set its mapping and ran it.
It completed and downloaded generated-request-summary.xlsx through Output.
A separate XLSX read confirmed Requests in A1, numeric zero in A2 and filter range A1:A2.
See materialize-proof.json, workbook-proof.json and workbook-content-check.json.

The browser added a Schedule trigger, configured cron and timezone, connected and saved it.
The review workflow was then disabled through the isolated API.
Clock-driven firing was not exercised.
A synthetic SMTP connector points only to unused loopback port 19925.
The browser configured an unsaved email node with reviewer@example.invalid.
It did not save or execute that email node. No message was sent.
The saved workbook workflow contains no email action.
See schedule-proof.json, email-limit.json and final-state.json.

The capture script moves individual canvas nodes before connecting them.
It clears selection between moves to avoid moving a selected group together.
Capture retries did not create additional saved workflows or send any email.
Only successfully saved workflow state was used for the runtime proofs.
No active credentials or bearer tokens are in the evidence JSON or workbook files.

## Checks and limits

`python3 docs/review/user-guide/write-guide-article.py report-pipeline` printed
`Scheduled reports with workflows 47 numbered steps`.
`python3 docs/review/user-guide/build-guide.py report-pipeline 'Scheduled reports with workflows'`
printed `52 equal screenshot frames, 47 steps, 52 original captures`.

`node docs/review/user-guide/check-guide-preview.cjs report-pipeline` returned 47 steps,
52 frames, zero missing screenshots, no broken anchors, 5120px enlarged source and HTTP 200.
The mobile preview had height 812 and no page overflow.
These checks prove preview layout and screenshot coverage.
The live workflow responses and workbook read prove the isolated dataset-to-file path.
They do not prove any external delivery integration.

HONEST NON-PROOF: no SMTP delivery, recipient inbox, automatic schedule firing,
external database, Pivot, Merge or dataset warehouse publication was exercised.
Physical phone browser chrome was not tested. Only a real phone confirms bottom-edge reachability.
No production code, published guide, translations or landing changelog was changed.
Original published images remain untouched.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py report-pipeline`, then
`python3 docs/review/user-guide/build-guide.py report-pipeline 'Scheduled reports with workflows'`.
Capture phases are materialize, workbook, schedule, email and phone. Run them sequentially.
Inspect existing state before replaying materialize or workbook, which create definitions.
The schedule phase disables its saved review workflow after capturing configuration.
The email phase never saves or executes the delivery node.
The root task registers preview navigation separately.
