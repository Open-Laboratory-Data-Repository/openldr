# Authentication providers review

Four hypotheses checked: one confirmed, three refuted.

| ID | Finding | Verdict | Proof | Cost |
|---|---|---|---|---|
| AP1 | Generic authentication automatically grants administrator access. | REFUTED | First real login opened Access denied and had no Users navigation. CLI role assignment then exposed Users. See first-login-proof.json and cli-assign-role.txt. | Separate authentication from local role assignment. |
| AP2 | Generic OIDC can use Keycloak client administration. | REFUTED | `packages/config/src/auth.ts:9` rejects generic mode with Keycloak administration. The live Users and Sites notices confirm unavailable provider administration. | Show the current limitation. |
| AP3 | An existing issuer can change without explicit handling. | REFUTED | `packages/bootstrap/src/auth-issuer-binding.ts:11` refuses a mismatched issuer. The unforced CLI rebind exited 1 for a changed local test issuer. | Preserve the same-provider-only rebind rule. |
| AP4 | The original authentication procedure lacks step pictures. | CONFIRMED | `apps/studio/src/docs/registry.ts:766` declares no screenshots. The authored authentication guide contains no images. | Capture real login and local access, with labelled configuration illustrations. |

The preview has 21 numbered steps. Every numbered step has native evidence.
The capture manifest preserves additional supporting screenshots, including the Sites administration notice.
Desktop originals are 5120 by 3200. Phone originals are 1500 by 3248.
Configuration and CLI scenes are explicitly labelled Illustration.
Their blank titlebar, three controls and faded dotted margins copy the approved terminal style.
The original published authentication guide remains unchanged.

## Actual enforced OIDC login

The worker used only its own Keycloak container openldr-docs-system-keycloak on port 19879.
Its private bootstrap and realm configuration remain in /tmp, outside the repository.
No shared identity provider, shared realm or another worker's identity service received writes.
The real provider realm was created through the actual Keycloak administration API.
It registered a public browser client with authorization code, PKCE and an API audience mapper.
No Studio client secret was used.

Fresh guide_auth_internal and guide_auth_target databases live in the worker's own Postgres on port 15442.
The worker temporarily ran its API 3009 against those databases with:

```text
AUTH_ADAPTER=oidc
IDENTITY_ADMIN_ADAPTER=none
AUTH_DEV_BYPASS=false
```

The browser used actual OIDC discovery, provider login, a code exchange and signed JWT access tokens.
No browser or API response was mocked. No bearer token, refresh token or browser storage state was saved.
The username was fictional. The native password capture remained masked.
The first login created the local account and opened Access denied for the requested page.
Docs and other permitted navigation remained available, while Users was absent.
The first-login proof preserves that state without a token or credential.

`pnpm openldr user list` exited 0 and listed the local provider subject.
`pnpm openldr user assign-role <provider-subject> lab_admin` exited 0.
Reload then exposed Users and the real Users page opened.
Users displayed the provider-administration notice and its local row menu offered Edit role and Disable.
The Sites page reported that enrollment requires Keycloak client administration.
The phone screenshot shows the authenticated documentation page at 375 by 812.

The browser opened its user menu, selected Sign out and returned to a provider login form.
This provider had a logout endpoint and ended its provider session.
The fictional provider account was then disabled and all its provider sessions revoked through the own administration API.
The final account-revoked proof reports providerAccountDisabled=true, providerSessionsRevoked=true, no password printed and no tokens stored.
No active captured source login remains.

## Issuer and preview checks

With a different local test issuer configured, `pnpm openldr auth rebind-issuer` exited 1.
It reported the bound and configured issuers and required --force for a reviewed same-provider move.
The command did not change the actual binding. Forced rebind was not executed.
The exact refusal is in auth-providers-evidence/cli-rebind-refused.txt.

`node docs/review/user-guide/capture-auth-providers.cjs` printed `AUTH PROVIDERS CAPTURE PASS`.
The capture script preserves first-login and initial role-assignment proofs across a resumed capture.
Its PNG and manifest writes are durable. Credentials are read only from a private /tmp file.
`python3 docs/review/user-guide/write-guide-article.py auth-providers` printed `21 numbered steps`.
`python3 docs/review/user-guide/build-guide.py auth-providers 'Authentication providers'` checks focus bounds.
`node docs/review/user-guide/check-guide-preview.cjs auth-providers` checks native resolution,
numbered-step evidence, anchors, common lightbox and phone preview overflow.
The exact result is in auth-providers-evidence/preview-checks.json.

## Limits

HONEST NON-PROOF: this proves generic OIDC against local Keycloak, not another vendor or a production deployment.
Production TLS, additional authentication factors, silent token renewal, expiry and outage recovery were not exercised.
Local account disable and role editing were inspected but not applied through the row menu.
Provider session revocation was exercised only on the fictional account after its sign-out.
The provider login page was captured at desktop width. Phone provider layout needs its own check.
The phone screenshot proves app documentation layout, not native browser chrome behavior.
No provider migration, forced issuer rebind, shared app change, translation or production publication occurred.
This worker made no commits or pushes.
