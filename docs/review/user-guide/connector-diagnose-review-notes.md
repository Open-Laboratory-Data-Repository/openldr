# Diagnose connections review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| D1 | The guide keeps a pasted instance in Host after blur. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/connector-diagnose.md:58` says Host keeps it. `apps/studio/src/pages/settings/Connectors.tsx:592` now splits on blur. | Show separate Host and Instance name fields. |
| D2 | Diagnosis can establish table permissions. | REFUTED | `apps/studio/src/pages/settings/ConnectorDiagnoseSheet.tsx:94` displays connection steps. Live results end at server version, not source table queries. | State the connection-only limit. |
| D3 | A failed Browser check still attempts login. | REFUTED | The live CLI printed `FAIL browser`, then `SKIP tcp`, `SKIP login`, `SKIP version`. | Explain skipped checks. |
| D4 | Several SQL Server actions lack individual screenshots. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/connector-diagnose.md:35` groups category, type and fields under one form picture. | Capture each action. |

The preview has 16 numbered steps and 16 native screenshot frames.
Desktop originals are 5120 by 3200. Phone originals are 1500 by 3248.
It begins with an existing connector. The absent-instance example is optional.
Original published docs and screenshots remain unchanged.

## Live checks

Only isolated API 3009, Studio 5189 and Postgres 15442 were used.
The browser diagnosed the warehouse connector and read `All checks passed.`
It chose Run again and confirmed the same result.
It created a fictional Microsoft SQL connector with `127.0.0.1\DOCS_MISSING`.
Leaving Host split the value into server and instance fields.
The Browser check made a real UDP request and timed out after 3000 ms.
Port, Login and Server version showed skipped.
The browser reopened Edit and captured the fields needed for correction.
It did not pretend to repair an instance that does not exist.
The phone capture read an actual successful Postgres diagnosis.

`pnpm openldr connectors diagnose <warehouse-id>` exited 0.
It printed `PASS tcp`, `PASS login`, the PostgreSQL version and `All checks passed.`
`pnpm openldr connectors diagnose <absent-instance-id>` exited 1.
It printed `FAIL browser` and `no reply from SQL Server Browser within 3000 ms`.
The later three checks printed `SKIP`.
Both transcripts are preserved under `connector-diagnose-evidence/cli-*.txt`.

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-connector-diagnose.cjs`
printed `DIAGNOSE CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py connector-diagnose` printed `16 numbered steps`.
`python3 docs/review/user-guide/build-guide.py connector-diagnose 'Diagnose connections'`
printed `16 equal screenshot frames, 16 steps, 16 original captures`.
`node docs/review/user-guide/check-guide-preview.cjs connector-diagnose` returned zero missing screenshots,
no broken anchors, native width 5120, blurred context, phone overflow false and HTTP 200.

## Limits

HONEST NON-PROOF: a successful SQL Server named instance was not available in this isolated stack.
Windows authentication, old TLS, fixed-port SQL Server recovery and certificate repair were not exercised.
The form supports those settings, but field screenshots do not establish successful authentication.
No physical phone browser chrome was tested. A real phone must confirm bottom-edge access.
No app code, shared navigation, translations or published documentation changed.
This worker made no commits or pushes.
