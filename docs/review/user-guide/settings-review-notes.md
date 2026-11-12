# Settings guide review

Preview only. No app code or published documentation changed.

4 hypotheses: 3 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| G1 | Numeric limits require a separate Save action. | REFUTED | `apps/studio/src/pages/settings/General.tsx:343` commits numbers on blur. Live row cap 5000 persisted after reopening. | None |
| G2 | Feature flags and update checking save immediately. | CONFIRMED | The capture changed each through real switches and polled their API values. `settings-evidence/workflow-result.json` records restored choices. | Documentation only |
| G3 | Validation changes require typing the target level. | CONFIRMED | `apps/studio/src/pages/settings/General.tsx:454` uses the target as confirmPhrase. Live High to Medium change required medium and persisted. | Documentation only |
| G4 | Destructive maintenance affects the internal database and leaves the provider account. | CONFIRMED | Real isolated reset and clear actions completed. Audit count changed 43 to 1. Factory reset restored lab name to OpenLDR and preserved the owned provider identity. | Documentation only |

## Ownership verification

Before confirming destructive actions, I read the actual listening server process environment. `settings-evidence/ownership-proof.json` records the result without credentials. Internal and target databases were 127.0.0.1:15441/guide_internal and guide_target. The bucket was openldr-docs-admin-review. Both issuer URLs were 127.0.0.1:18288/realms/docs. These are this agent's owned test resources. No default shared bucket or realm was used.

## Checks

- The basic capture pictured real account-menu, Settings and General navigation. It toggled Auto update check and Dashboard raw SQL, checked their real API states, then restored them. It saved a row cap of 5000 by leaving the field and checked persistence after reopening.
- Validation defaults to High in this installation. Selecting the same value correctly did not open confirmation. `capture-settings.cjs validation` then exited 0 after changing to Medium, reading the warning, typing medium and applying it.
- `capture-settings.cjs reset-dashboards` exited 0. The actual API action removed and reseeded the existing sample dashboard. The returned list contained the built-in sample afterward.
- `capture-settings.cjs clear-audit` exited 0. The real audit total changed from 43 to 1. The remaining event recorded the clear operation.
- `capture-settings.cjs factory-reset` exited 0. The real internal lab name changed from Documentation laboratory to OpenLDR and its time zone became absent. The same owned Keycloak user ID remained in the directory.
- Each destructive phase writes an attempted marker before confirming. The script refuses repeated attempts without an explicit outcome review.
- `capture-settings.cjs phone` exited 0. It captured About, limits and Danger Zone at 375 x 812.
- Native desktop evidence is 5120 x 3200. Native phone evidence is 1500 x 3248. Browser DPR is 4.
- New prose passed an unslop review. Actual permissions, immediate saves, blur saves and typed confirmation phrases are stated separately.

## Limits

HONEST NON-PROOF: the dashboard reset ran when only the built-in sample existed. This proves action completion and sample restoration, not deletion of a custom dashboard. The removal loop is `packages/bootstrap/src/index.ts:2075`.

HONEST NON-PROOF: the clear action removed real audit rows, but the test installation had no populated workflow run history. Source `packages/bootstrap/src/danger.ts:39` truncates both tables. A test with a prior workflow run would prove that variant.

HONEST NON-PROOF: the factory reset preserved the owned provider identity. This run did not establish preservation of a populated target warehouse. Source `packages/bootstrap/src/danger.ts:31` accepts only the internal database. A nonempty target fixture would prove retention of those values.

HONEST NON-PROOF: the validation setting persisted. This run did not ingest data at each level. A controlled ingestion fixture would prove acceptance differences.

HONEST NON-PROOF: the phone check covers layout. Real phone browser chrome and bottom-edge reachability require a phone.

The existing validation confirmation is a type-to-confirm Dialog. Destructive actions use AlertDialog confirmations. These fit the confirmation exceptions in AGENTS.md. No new app UI was introduced.

I skipped translations, publication, commits and pushes. Root handles section review and version control. No app defect was changed.

`write-guide-article.py settings` printed `Settings 33 numbered steps`. `build-guide.py settings Settings` printed `39 equal screenshot frames, 33 steps, 39 original captures`. `check-guide-preview.cjs settings` exited 0 with no missing evidence, no broken anchors, no phone overflow and HTTP 200. I inspected the generated desktop preview.
