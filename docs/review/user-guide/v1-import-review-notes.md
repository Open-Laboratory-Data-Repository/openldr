# OpenLDR v1 import review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| V1 | The original guide has no pictures. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/v1-import.md:7` explicitly says so. | Capture the real plugin on an isolated SQL Server fixture. |
| V2 | The plugin opens its own database connection. | REFUTED | `wasm/openldr-v1-import/ui/src/api.ts:33` calls host import operations. `packages/cli/src/import.ts:54` grants access through the shared service. | Explain the read-only connector permission. |
| V3 | Guide omits the plugin's Finished label. | CONFIRMED | The original guide uses Complete under Activity. `wasm/openldr-v1-import/ui/src/i18n.ts:83` renders Finished in the plugin. | Use the current plugin label. |
| V4 | Repeating an import necessarily duplicates the source request. | REFUTED | A real CLI repeat saved the same request. The isolated warehouse still contained one lab request afterward. | Describe replacement and test the repeat. |

The preview has 18 numbered steps and 18 native screenshot frames.
Desktop sources are 5120 by 3200. Phone sources are 1500 by 3248.
Original published documentation is unchanged.

## Real isolated source and import

The worker built the existing Rust importer with `pnpm build:v1-import`.
The initial build failed because cargo was outside PATH.
`PATH=/home/fredrick/.cargo/bin:$PATH pnpm build:v1-import` succeeded and staged the plugin.
The worker installed it into its isolated app with the existing CLI.
The install printed `installed openldr-v1-import@0.1.0`.
No application or plugin source changed.

Source SQL Server uses only container and volume `openldr-docs-system-mssql`, port 15445.
The fictional database guide_v1 contains Requests, LabResults, Patients and ASTResults.
It has one request, one patient, one text result and no AST results.
The optional SQL file contains no credentials.
A separately generated read-only source login was stored privately outside the repo.
That login was disabled after the checks. No active source credential appears in evidence.
The destination is isolated API 3009, Studio 5189, Postgres 15442 and the worker's own S3 bucket.

The browser allowed plugin access, selected the source and passed its real connection diagnosis.
It entered UTC source time, checked 4 of 4 tables, completed a dry run,
and started an actual import. The final UI read:

```text
Finished
Requests read 1
Requests saved 1
Requests failed 0
Records 5
```

It opened Activity and captured the actual import page at phone width.
The importer uses a sandboxed iframe. Focus targets address controls inside that real frame.
`import-ui-proof.json` preserves the completed UI text without credentials.

`pnpm openldr import status openldr-v1-import` exited 0 and listed the completed run.
`pnpm openldr import start --plugin openldr-v1-import --connector <id> --option tz=Z --dry-run --limit 100`
exited 0, with keys=1, imported=1, failed=0 and resources=5.
The same command without --dry-run repeated the actual import and exited 0 with the same counts.
Afterward, `SELECT count(*) AS requests FROM lab_requests` returned 1 on the isolated target.
The transcripts are in v1-import-evidence/cli-*.txt.

## Verification and limits

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-v1-import.cjs`
printed `V1 IMPORT CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py v1-import` printed `18 numbered steps`.
`python3 docs/review/user-guide/build-guide.py v1-import 'Import from OpenLDR v1'`
printed `18 equal screenshot frames, 18 steps, 18 original captures`.
`node docs/review/user-guide/check-guide-preview.cjs v1-import` returned zero missing screenshots,
no broken anchors, native width 5120, blur, phone overflow false and HTTP 200.

HONEST NON-PROOF: this fixture does not establish compatibility with every historical v1 schema.
It does not exercise AST mapping, a failed source request, a large import or concurrent source changes.
Stop and Resume are checked in source at `RunPanel.tsx:79` and `RunPanel.tsx:82`.
The one-request import finished too quickly to capture those controls during an active run.
No real physical phone browser chrome was tested. A phone must confirm bottom-edge access.
No translations, production publication, shared navigation, commits or pushes were made here.
