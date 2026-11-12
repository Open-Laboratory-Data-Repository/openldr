# Workflows review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| W1 | Webhook practice requires the documentation sample. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/workflows.md:57` requires downloading it. | Start with an approved sender payload; move fiction to the end. |
| W2 | Canvas actions lack separate screenshot evidence. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/workflows.md:99` begins eight instructions sharing one recording. | Capture every control and the resulting live run. |
| W3 | Run immediately executes a manual workflow. | REFUTED | `apps/studio/src/workflows/components/canvas.tsx:108` fires only an armed waiting trigger. The live run waited for the play badge. | Keep the two explicit actions. |
| W4 | A warehouse count requires a configured database connector. | REFUTED | `apps/studio/src/workflows/components/node-forms/sql-form.tsx:15` documents direct reporting-schema access. The real SQL Query node returned `requests: 0`. | Use SQL Query for the introductory count. |

The preview has 38 numbered steps, 43 screenshot placements and 41 original captures.
Every numbered step has real UI evidence.
Desktop sources are 5120 by 3200. Phone sources are 1500 by 3248.
The approved fixed frame, sharp focus, blurred surroundings and enlargement remain.
New writing was checked with the unslop skill.

## Live work

Only isolated API 3007, Studio 5187 and PostgreSQL 15440 were used.
The isolated bucket is `openldr-docs-data-review`.
Identity administration is disabled and its issuer points at an unused loopback port.
No normal app database was reset or seeded.

The browser opened Ingest, configured its trigger, generated a secret and saved the system workflow.
A real HTTP POST returned 200 with a run identifier and correlation identifier.
The single fictional patient Bundle is an optional download.
History showed a completed six-node execution with the form branch skipped.
The browser opened Persist store output and the completed webhook receipt.
The response is in `workflows-evidence/webhook-result.json`.

The browser created Warehouse row count from an empty canvas.
It dragged Manual Trigger and SQL Query, connected them, entered a real SELECT and saved.
It armed Run, fired the trigger and read the output count of zero.
It exported the definition, duplicated it, deleted the disposable copy through confirmation,
and imported the exported definition as a second custom workflow.
An extra fictional copy created during a capture retry was removed through the isolated API.
No shipped workflow was deleted or reset.
The isolated Ingest token was rotated after captures. Screenshot tokens are inactive.
All evidence JSON, exported workflow JSON, capture script and prose were reviewed for credentials.
No bearer token, access token or active webhook value remains in those artifacts.
The current test token is retained only under /tmp. See credential-review.json.
Run and receipt responses are in `workflows-evidence/live-checks.json`.
The exported definition is available for optional practice.

The secret control says Replace secret for a stored reference and Regenerate for an unsaved value.
The preview explains both labels, as implemented in
`apps/studio/src/workflows/components/node-forms/webhook-form.tsx:110`.
A value remains visible in the local editor after saving until the definition reloads.
The guide therefore tells the reader to copy before saving and does not promise a reveal action.

## Checks and limits

`python3 docs/review/user-guide/write-guide-article.py workflows` printed `Workflows 38 numbered steps`.
`python3 docs/review/user-guide/build-guide.py workflows Workflows` printed
`43 equal screenshot frames, 38 steps, 41 original captures`.

`node docs/review/user-guide/check-guide-preview.cjs workflows` returned:
`steps: 38`, `frames: 43`, `missingScreenshots: 0`, `brokenAnchors: []`,
`nativeWidth: 5120`, mobile `height: 812`, `overflow: false`, and HTTP 200.
The check exercises preview image resolution, step coverage, anchors, lightbox and mobile page layout.
It does not prove all workflow node types or production authentication.

HONEST NON-PROOF: actual phone browser chrome was not tested.
The canvas is documented for a larger screen.
External email, database listeners, HTTP destinations, scheduled firing and multi-instance recovery were not exercised.
The idempotent retry, queued recovery and reset descriptions were checked against existing source and guide text.
They were not simulated as failures here.
No production app code, published guide, translations or landing changelog was changed.
Original published images remain untouched.

## Rebuild

Run `python3 docs/review/user-guide/write-guide-article.py workflows`,
then `python3 docs/review/user-guide/build-guide.py workflows Workflows`.
The root review task registers navigation separately.
Capture phases are ingest, history, build, manage and phone. Run them sequentially.
Ingest rotates the isolated token and posts the fictional Bundle.
Build and manage create custom definitions, so inspect existing review state before replaying them.
