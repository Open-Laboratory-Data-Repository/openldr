# Planned upgrades review

Four hypotheses checked: one confirmed, two refuted, one deferred.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| U1 | The existing procedure skips stopping writers. | REFUTED | `apps/studio/src/docs/0.1.8/en/upgrading.md:15` explicitly pauses writers and stops every old replica. | Preserve that sequence. |
| U2 | The existing procedure treats a successful dump as recoverability. | REFUTED | `apps/studio/src/docs/0.1.8/en/upgrading.md:51` requires an isolated restore and saved-secret checks. | Preserve the restore gate. |
| U3 | The procedure has no visual evidence per action. | CONFIRMED | `apps/studio/src/docs/registry.ts:792` declares an empty screenshot list. The authored guide has no pictures. | Add clearly labelled illustrations and a separate real rehearsal. |
| U4 | Operators need another vendor-image replacement walkthrough now. | DEFER-YAGNI | No newly missing infrastructure image was reproduced. The historical storage case remains documented. | Add a replacement procedure when an actual unavailable image affects the deployment. |

The preview has 12 numbered steps and 12 native screenshot frames.
Every numbered step has evidence. Sources are 5120 by 3200.
The General page is real. Compose command scenes are clearly labelled Illustration.
They copy the approved neutral three-control terminal style and faded dotted margins.
The original upgrade document remains unchanged.

## Real backup rehearsal

Only this worker's isolated API on port 3009 was stopped.
The worker waited for that process to exit. It did not stop shared databases, storage or identity.
Its own sync settings were disabled and its sample source login was disabled.
No other service writes the worker's own S3 bucket.

`python3 docs/review/user-guide/upgrading-evidence/rehearsal.py` printed `RESTORE REHEARSAL PASS`.
It ran pg_dump -Fc into files inside openldr-docs-system-pg, copied them to private /tmp files,
and restored into guide_restore_internal and guide_restore_target with pg_restore --exit-on-error.
Canonical records matched 27 in source and restore. Warehouse requests matched 1.
The proof records both dump and restore exit codes as 0.
Raw database backups remain outside the repo because they include encrypted credentials.

`node docs/review/user-guide/upgrading-evidence/blob-rehearsal.mjs` printed `BLOB RESTORE PASS 8 objects.`
It read only openldr-docs-system-review and copied into the new openldr-docs-system-restore bucket.
It compared every complete object using SHA-256 after restore.
No shared bucket object, policy or grant changed.

The recovery-check.ts script opened the original and restored application databases.
It decrypted the same fictional saved connector under the preserved encryption key and compared values in memory.
It printed `SECRET RECOVERY PASS. No secret printed.`
The proof states restoredConnectorSecretMatches=true and secretPrinted=false.
No credential values appear in its output.

`pnpm openldr db migrate` against the restored databases exited 0 and printed
`migrated internal: [] external: []`.
This checks a current-schema migration invocation. It does not prove a release-to-release schema transition.
The API was then restarted on its original databases for the remaining screenshots.

## Preview checks

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-upgrading.cjs`
printed `UPGRADING CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py upgrading` printed `12 numbered steps`.
`python3 docs/review/user-guide/build-guide.py upgrading 'Planned upgrades'`
printed `12 equal screenshot frames, 12 steps, 12 original captures`.
`node docs/review/user-guide/check-guide-preview.cjs upgrading` checks native resolution,
step evidence, focus bounds, anchors, common lightbox and phone preview overflow.
Its exact result is in upgrading-evidence/preview-checks.json.

## Limits

HONEST NON-PROOF: no production release was upgraded and no deployment Compose stop/start command was executed.
The rehearsal did not restore a Keycloak database, roles into a different cluster, external SQL stores or historical MinIO.
It did not test long-running request drain, interrupted webhook side effects or a production-sized backup.
The S3 checksum rehearsal covers eight sample plugin objects, not clinical uploads or workflow receipt binaries.
The terminal pictures are instructions, not output from an upgraded production server.
A real phone must confirm browser-chrome access. The preview phone check covers layout only.
No application fix, production publication, translation, shared navigation, commit or push was made here.
