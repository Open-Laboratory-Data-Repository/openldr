# Connectors review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| C1 | Existing instructions share recordings across several steps. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/connectors.md:51` precedes seven instructions with one recording. | Capture each field, menu and result. |
| C2 | The phone requires sideways scrolling to reach row actions. | REFUTED | `apps/studio/src/pages/settings/Connectors.tsx:324` hides Host below the small breakpoint. Native 375px capture shows row actions. | Explain the current phone layout. |
| C3 | Passwords must be retyped for every settings change. | REFUTED | `apps/studio/src/pages/settings/Connectors.tsx:235` omits blank password fields. Live Edit and Save retained a working password. | Explain blank means keep. |
| C4 | The original guide centres its own sample infrastructure. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/connectors.md:40` requires a specific Compose database. | Begin with the operator's existing service account. |

The preview contains 25 numbered steps. Each has a native screenshot.
Desktop originals are 5120 by 3200. Phone originals are 1500 by 3248.
The approved focus, blurred context and common lightbox remain unchanged.
Original published documentation and images remain unchanged.

## Exercised workflows

Only the isolated API 3009 and Studio 5189 received writes.
Postgres uses container and volume `openldr-docs-system-pg`, port 15442.
Its databases are `guide_internal` and `guide_target`.
The local source account can read one fictional table.
The screenshot password is masked and belongs only to this disposable account.

The capture created a Postgres connector through Studio, saved it, and ran Test.
The result was `Connection OK`.
Edit displayed ordinary fields and an empty password with its stored-secret placeholder.
Saving with the password blank kept it.
The browser searched, disabled and re-enabled the connector.
It opened Remove, checked the confirmation and chose Cancel.
The connector remains available for the diagnosis and import guides.
Phone captures show the row controls and edit sheet at 375 by 812.

`pnpm openldr connectors list --json` exited 0 and listed the example and warehouse connector.
`pnpm openldr connectors inspect <id>` exited 0 and returned ordinary settings with `secretsSet`.
`pnpm openldr connectors test <id>` exited 0 and printed `Connection OK`.
`pnpm openldr connectors remove <id>` exited 1 and refused without `--force`.
Transcripts are in `connectors-evidence/cli-*.txt`.

## Checks and limits

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-connectors.cjs`
reported `CONNECTORS CAPTURE PASS` with the example connector id.
The script resumes after a saved create operation rather than creating a duplicate.
The manifest and state use durable atomic writes.

`python3 docs/review/user-guide/write-guide-article.py connectors` reports `25 numbered steps`.
`python3 docs/review/user-guide/build-guide.py connectors Connectors` checks focus bounds.
`node docs/review/user-guide/check-guide-preview.cjs connectors` checks step evidence,
native resolution, lightbox blur, anchors and phone preview overflow.
Its result is stored in `connectors-evidence/preview-checks.json`.

HONEST NON-PROOF: this preview does not establish production database rights.
It does not exercise every connector type, cloud login, email delivery or file transfer.
Password rotation is described through the same edit operation but was not replayed after a source-side password change.
Removal confirmation was cancelled. No dependent workflow was deliberately broken.
CLI add, update and forced removal were checked in source, not executed here.
Physical phone browser chrome was not tested. A real phone must confirm bottom-edge access.
No app changes, translations, production publication, commits or pushes were made by this worker.

Root integration added actual account-menu and Settings navigation evidence and split connection type from connection details. Final preview check reports 25 steps and 26 frames.

## Final introduction check

The original introduction named Postgres for every fresh installation.
`packages/bootstrap/src/seed.ts:533` selects SQL Server and `:564` selects MySQL instead.
The corrected introduction describes the configured warehouse connector and identifies Postgres as the pictured example.
