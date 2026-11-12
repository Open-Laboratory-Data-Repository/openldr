# Marketplace review

Four hypotheses checked: two confirmed, two refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| M1 | The original guide requires GitHub for every registry. | REFUTED | `apps/studio/src/docs/0.1.8/en/marketplace.md:99` describes server folders. | Keep both source types. |
| M2 | Approval actions share one recording. | CONFIRMED | `apps/studio/src/docs/0.1.8/en/marketplace.md:65` groups approval instructions under one recording. | Capture details, approval and result separately. |
| M3 | A local registry reads the HTTP index directory layout. | REFUTED | `packages/marketplace/src/registry-source.ts:204` reads immediate child bundle directories. HTTP reads index.json at line 275. | Show a valid local folder. |
| M4 | Detail actions immediately update their Enable/Disable label. | CONFIRMED | `apps/studio/src/pages/settings/marketplace/MarketplaceTabs.tsx:111` stores the selected entry. `PackageDetail.tsx:191` reads its enabled field. Live toggling required reopening after reload. | Document reload and list the defect. No app fix. |

The preview has 26 numbered steps and 27 screenshot frames.
Every step has native evidence. Desktop sources are 5120 by 3200.
Phone sources are 1500 by 3248. Focus bounds and the shared lightbox are retained.
The published guide and original pictures remain unchanged.

## Live workflows

All writes used isolated API 3009, Studio 5189 and Postgres 15442.
Only bucket `openldr-docs-system-review` received object writes.
S3 CreateBucket created that bucket with the existing key's create permission.
No shared bucket policy or grants changed.
The first attempted approval reported unavailable storage before that bucket existed.
A real retry installed the signed local training sink after bucket creation.
No response interception, mock registry response or invented success was used.

The practice bundle uses the existing test-sink binary and a generated publisher key.
The private signing key existed only in memory. Public verification files are in the bundle.
The registry builder lives under marketplace-evidence and does not edit production source.
The default GitHub registry was read successfully. It was not changed or published to.

The browser added the local registry, searched and opened test-sink,
read signature, README, permissions and compatibility, and approved installation.
The installed proof records test-sink active and enabled.
It disabled the plugin, reloaded and reopened its details, then enabled it.
It confirmed Remove and saved proof that test-sink was no longer installed.
It opened registry Edit and cancelled without changing the settings.
Native phone captures show stacked cards and the version section above the description.
The separate ui-reference sample remains installed for the next guide.

`pnpm openldr market verify <practice-bundle>` exited 0 and printed `valid=true`.
`pnpm openldr market install <practice-bundle> --dry-run` exited 0 and printed
`dry run: would install test-sink@0.1.0`.
Both transcripts are in marketplace-evidence.

`GUIDE_API_URL=http://localhost:3009 GUIDE_STUDIO_URL=http://localhost:5189 node docs/review/user-guide/capture-marketplace.cjs`
printed `MARKETPLACE CAPTURE PASS`.
`python3 docs/review/user-guide/write-guide-article.py marketplace` printed `26 numbered steps`.
`python3 docs/review/user-guide/build-guide.py marketplace Marketplace` checks focus bounds.
`node docs/review/user-guide/check-guide-preview.cjs marketplace` checks native resolution,
step evidence, anchors, lightbox blur and phone overflow. See preview-checks.json.

## Listed app defect and limits

The selected detail entry can retain its old enabled state after toggling.
Reload and reopen from Installed before changing it again.
No application fix was made.

HONEST NON-PROOF: a signed plugin installation does not prove its external destination works.
This preview did not install a content pack, template, alternate version or rollback.
It did not publish a package, remove a registry or change the default source.
Physical phone browser chrome was not tested. A real phone must confirm bottom-edge access.
CLI forced install and removal were not repeated because the UI exercised that lifecycle.
No translations, production documentation, shared navigation, commits or pushes changed here.
