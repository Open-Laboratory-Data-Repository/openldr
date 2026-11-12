# Users guide review

Preview only. No app code or published documentation changed.

4 hypotheses: 3 confirmed, 1 refuted, 0 convention conflicts, 0 deferred.

| ID | Finding | Verdict | Proof | Cost |
| --- | --- | --- | --- | --- |
| U1 | Account creation and profile changes require an identity administration client. | CONFIRMED | `apps/server/src/users-routes.ts:194` returns 503 when administration is unavailable. Real account created in own Keycloak. | Documentation only |
| U2 | Users can choose several roles in the account sheet. | REFUTED | `apps/studio/src/users/UserDialog.tsx:195` takes one current role. The sheet uses one Select. Live changed Lab Technician to System Auditor. | None |
| U3 | Initial passwords require a change at next sign-in. | CONFIRMED | `packages/adapter-auth/src/index.ts:152` defaults temporary to true. Own provider returned Account is not fully set up. | Documentation only |
| U4 | Disable, password reset and force sign-out change provider behaviour. | CONFIRMED | `users-evidence/workflow-result.json` records disabled token rejection, reset token success and refresh rejection after sign-out. | Documentation only |

## Checks

- `capture-users.cjs create` exercised account creation and role assignment. The role-manager guard first rejected the test setup, which had no real role assignment for the development actor. I assigned that actor Administrator in the isolated database and retried the incomplete test identity.
- The successful account creation closed the sheet and stored Lab Technician. The first token assertion expected direct sign-in, but initial passwords are temporary. `capture-users.cjs created` then recorded the created account, assigned role and correct required-change response without creating another account.
- `capture-users.cjs edit` exited 0. It changed the name and assigned System Auditor, then checked the real API values.
- `capture-users.cjs security` exited 0. It disabled and enabled the account, reset its password and ended provider sessions. Disabled sign-in returned Account disabled. Enabled sign-in returned Account is not fully set up because the initial password remained temporary. After resetting to a permanent test password, sign-in returned 200. After Force sign-out, refreshing that session returned 400.
- `capture-users.cjs phone` exited 0. It captured the directory and User sheet at 375 x 812.
- Native desktop captures are 5120 x 3200. Native phone captures are 1500 x 3248. Browser DPR is 4.
- New prose passed an unslop review. It uses exact capability names and puts optional practice after the tasks.

## Isolation and limits

Postgres container and volume are `openldr-docs-admin-pg`, port 15441. API is 3008. Studio is 5188. Own Keycloak is `openldr-docs-admin-keycloak`, port 18288, realm docs. The service administration client and fictional account exist only there. No shared realm, real account or user credentials were changed. No email was sent.

HONEST NON-PROOF: SMTP email delivery was not configured. The guide names Send reset email as an optional action and states it was not tested. A controlled provider mailbox would prove delivery.

HONEST NON-PROOF: the initial temporary-password response proves a required action, not the full browser password-change sequence. A real provider sign-in followed by password change would prove that sequence.

HONEST NON-PROOF: the phone check covers browser layout. Real phone browser chrome and bottom-edge reachability need a real phone.

The existing Reset password editor is a Dialog in `apps/studio/src/users/ResetPasswordDialog.tsx:76`. This guide records that existing UI. I did not introduce a Dialog or change the app to match the newer Sheet convention.

I skipped translations, publication, commits and pushes. Root handles section review and version control. No app defect was changed.

`capture-users.cjs permissions` exited 0 after adding the expected API audience mapper to the owned web client. A real System Auditor token received 200 for `/api/me` and `/api/audit`, and 403 for `/api/users` and `/api/roles`. The real account's capabilities included audit.view and excluded users.view. This covers one restricted-role API variant; screenshots still use the development administrator.

`write-guide-article.py users` printed `Users 30 numbered steps`. `build-guide.py users Users` printed `38 equal screenshot frames, 30 steps, 38 original captures`. `check-guide-preview.cjs users` exited 0 with no missing screenshots, no broken anchors, no phone overflow and HTTP 200. I inspected the generated desktop preview.
