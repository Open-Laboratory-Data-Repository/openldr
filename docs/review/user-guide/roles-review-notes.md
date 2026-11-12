# Roles guide review

Preview only. No app code or published documentation changed.

3 hypotheses: 2 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| R1 | A custom role can be created, edited and deleted through the app. | CONFIRMED | `capture-roles.cjs` printed 24 CAPTURE lines and exited 0. `roles-evidence/workflow-result.json` records created, edited and deleted results. | Documentation only |
| R2 | Administrator can be changed like a custom role. | REFUTED | `apps/studio/src/roles/RoleSheet.tsx:42` makes locked roles read-only. Live locked notice captured. | None |
| R3 | Slug becomes immutable after creating the role. | CONFIRMED | `apps/studio/src/roles/RoleSheet.tsx:92` updates name, description and capabilities only. Live edit field was disabled. | Documentation only |

## Checks

- `GUIDE_API_URL=http://localhost:3008 GUIDE_STUDIO_URL=http://localhost:5188 node docs/review/user-guide/capture-roles.cjs` exited 0. It exercised real create, edit and delete tasks.
- `python3 docs/review/user-guide/write-guide-article.py roles` printed `Roles 21 numbered steps`.
- `python3 docs/review/user-guide/build-guide.py roles Roles` printed `24 equal screenshot frames, 21 steps, 24 original captures`.
- `node docs/review/user-guide/check-guide-preview.cjs roles` exited 0. It reported 21 steps, 24 frames, no missing screenshots, no broken anchors, HTTP 200 and no mobile overflow.
- Desktop evidence is 5120 x 3200. Phone evidence is 1500 x 3248. These are native DPR 4 captures.
- I inspected the generated desktop preview. It retains the approved focus, blur and equal frame layout.
- New prose passed an unslop review. Instructions use actual labels and place optional practice last.

## Isolation and limits

Postgres container and volume are `openldr-docs-admin-pg`, bound to 127.0.0.1:15441. Databases are guide_internal and guide_target. API is 3008. Studio is 5188. Identity administration was disabled. The issuer pointed at an unused test address. No shared identity accounts were touched.

HONEST NON-PROOF: the development actor has all capabilities. This run does not prove restricted-user access or real sign-in. Source capability guards are `apps/server/src/roles-routes.ts:30` and `apps/server/src/roles-routes.ts:31`. A real signed-in restricted account would prove that variant.

HONEST NON-PROOF: no users held the temporary role. This run proves persistence of role capabilities, not their effect on a member's next request. A signed-in test user assigned the role would prove that.

HONEST NON-PROOF: the 375 x 812 browser check covers layout only. Real phone browser chrome and bottom-edge reachability require a phone.

I skipped translation, publication, commits and pushes. Root handles section review and version control. No app defects were found during the covered tasks.

## Navigation follow-up

`capture-roles.cjs navigation` exited 0 and added Open user menu, Settings, and Roles captures. It did not recreate, edit or delete the practice role. The first numbered step now includes all three clicks.

Role assignment requires Manage roles through `apps/server/src/roles-routes.ts:29`. Opening Users requires View users through `apps/studio/src/App.tsx:56`. Creating and editing identity details also require Manage users through `apps/server/src/users-routes.ts:168` and `apps/server/src/users-routes.ts:203`. The introduction now states those separate requirements.
