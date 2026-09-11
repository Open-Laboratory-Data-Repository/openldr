# P09 auth portability

The operator approved P09-A and P09-B, then delegated the remaining design choice.
Use generic OpenID Connect with optional Keycloak administration. Block unsafe issuer changes.
Do not migrate accounts between issuers automatically. No commit, merge or push is authorized.

## Evidence and boundaries

Browser metadata is always Keycloak-shaped in `apps/studio/src/auth/oidc.ts:50`.
Configuration only accepts Keycloak in `packages/config/src/schema.ts:35`.
Administration requires realm URLs in `packages/adapter-auth/src/index.ts:93`.
JWT verification and local capability resolution remain reusable.
`packages/users/src/store.ts:193` looks up identities by subject alone.
`packages/bootstrap/src/account-status.ts` requires provider administration even for local access changes.
These last two dependencies must be handled before generic login is usable safely.

## Configuration and adapter boundaries

Keep `AUTH_ADAPTER=keycloak` as the default. Add `oidc` for standards-based discovery.
Add explicit `IDENTITY_ADMIN_ADAPTER=keycloak|none`; omitted means Keycloak for Keycloak auth, none for generic auth.
Reject a Keycloak administration selection with generic auth, rather than mixing unrelated identity namespaces.
Generic auth must not infer Keycloak URLs from internal issuer configuration or use stale Keycloak credentials.
Retain explicit internal signing-key URL support and issuer/audience/signature/expiry validation.
Separate verification and administration implementations without replacing the public AuthPort contract unnecessarily.
Unsupported administration must reject before network calls with the established not-configured error.
Expose resolved administration availability and login mode in public client configuration, never credentials.

## Browser and operator behavior

Keycloak mode preserves static metadata for institutional proxies that block discovery.
Generic mode uses provider discovery through the existing OIDC client and keeps authorization code with PKCE.
Expose provider-required API scopes and resource URL through OIDC_SCOPES and OIDC_RESOURCE.
Scopes retain openid; existing deployments keep the current default scopes.
Handle providers without logout metadata by clearing the local session without claiming provider-wide logout.
Keep login, callback, renewal and unauthorized handling coherent across configuration changes.
Provider-only create/edit/password/session actions must be unavailable with an explanation when administration is absent.
Local account access blocking and local role assignment remain supported in Studio and CLI.
Use shared bootstrap logic for status changes and distinguish local IDs from provider subjects.
Do not silently call provider administration when operating in local-only mode.
Distributed-sync client enrollment remains Keycloak-specific and must report unavailable administration honestly.
Do not add another vendor's administration API or redesign distributed sync in this slice.

## Issuer safety

Persist a database binding to the configured issuer before authenticated application services start.
Atomic first binding must allow only one issuer across concurrent processes.
Later issuer changes fail closed before claims can reuse local subjects or roles.
The first upgraded deployment must retain its existing issuer; historical identities do not contain issuer evidence.
There is no automatic account remapping and no force switch command.
Database migration commands remain available to prepare the schema without starting authentication services.
The binding is local security configuration and must not replicate through distributed settings sync.

## Verification and documentation

Use unit and route tests for configuration defaults, adapter selection, discovery, signature rejection,
unsupported administration, config wire shape, local status changes, and issuer conflicts.
Use disposable PostgreSQL for concurrent issuer binding, plus a disposable non-Keycloak OIDC server
for browser authorization-code exchange and API JWT verification where the environment permits it.
Never use deployed credentials, services or clinical data. Record missing proof explicitly.
Publish Studio and public docs in en/fr/pt, including first administrator role assignment,
provider JWT access-token requirements, unsupported administration/sync features and issuer adoption limits.
Verify changed UI at 375 by 812. Generate the landing changelog only after an authorized merge.
