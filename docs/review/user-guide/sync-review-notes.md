# Distributed sync review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| S1 | The existing pictures prove a live successful link. | REFUTED | `apps/studio/src/docs/0.1.8/en/sync.md:9` explicitly says they show sync off. | Keep the limitation visible. |
| S2 | Current Save is a standalone button. | REFUTED | `apps/studio/src/pages/settings/DistributedSync.tsx:293` places Save in the tab-strip dropdown. | Capture the current menu. |
| S3 | Credential-entry actions lack individual screenshots. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/sync.md:111` gives one field table without step pictures. | Capture each relevant field and action. |
| S4 | Enrollment needs external identity administration. | CONFIRMED | `apps/studio/src/pages/settings/Sites.tsx:204` gates Enroll on syncClientAdmin. The live installation displayed its unavailable notice. | Explain the dependency and stop short of fictional enrollment. |

The preview has 22 numbered steps and 22 native screenshot frames.
Desktop originals are 5120 by 3200. Phone originals are 1500 by 3248.
Published documentation and its pictures remain unchanged.

## Actual isolated checks

Only API 3009, Studio 5189, own Postgres 15442 and own settings received writes.
The isolated server deliberately uses IDENTITY_ADMIN_ADAPTER=none.
Sites displayed `Site enrollment and credential changes require Keycloak client administration.`
The guide shows that state and does not claim an enrolled site.

The browser entered a fictional site and client with an unusable masked secret.
Its central and issuer were absent localhost service addresses on port 19879.
It saved enabled bidirectional sync, opened Activity and chose Sync now.
The actual worker produced failed events. The browser opened one and captured its full error.
No browser or API response was mocked. No patient data reached another service.
It then switched Enable sync off, saved, reloaded and captured the blank stored-secret field.
Both workers remain disabled after the check.
Phone captures show a settings field and the Activity tab.

CLI settings, status and Sync now while disabled were checked against the same isolated databases.
Their exact commands, results and exit codes are in sync-evidence/cli-*.txt.

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-sync.cjs`
printed `SYNC CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py sync` printed `22 numbered steps`.
`python3 docs/review/user-guide/build-guide.py sync 'Distributed sync'`
printed `22 equal screenshot frames, 22 steps, 22 original captures`.
`node docs/review/user-guide/check-guide-preview.cjs sync` returned zero missing screenshots,
no broken anchors, native width 5120, blur, phone overflow false and HTTP 200.

## Limits

HONEST NON-PROOF: this is not a two-instance enrollment and transfer proof.
No sync client was enrolled, rotated or revoked. No TLS certificate was downloaded or installed.
Successful push, pull, quarantine recovery, divergence resolution and offline bundles were not exercised.
Those require a separately configured central and authorized identity administration.
The guide explains the expected successful result without labelling the failed example successful.
A real phone must confirm bottom-edge access with retractable browser chrome.
No application fix, translation, production publication, shared navigation, commit or push changed here.
