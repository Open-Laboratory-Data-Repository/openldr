# P09 authentication portability

Worktree `.worktrees/p09-auth-portability`, branch `codex/p09-auth-portability`, base `1384454d`.
The operator approved the confirmed scope and delegated the remaining design choice.
No commit, merge or push is authorized yet.

## Verdict and decision

Three findings: two confirmed, one refuted.

| ID | Finding | Verdict | Evidence at the base | Cost |
| --- | --- | --- | --- | --- |
| P09-A | Browser login constructs Keycloak endpoints. | CONFIRMED | `apps/studio/src/auth/oidc.ts:50` always supplies Keycloak metadata. | Medium |
| P09-B | Provider selection and account administration require Keycloak. | CONFIRMED | `packages/config/src/schema.ts:35`; `packages/adapter-auth/src/index.ts:93`. | Large |
| P09-C | Provider replacement requires replacing verification and permissions. | REFUTED | Existing JWT verification and database capability resolution are reusable. | None |

Support generic OpenID Connect installations with JWT access tokens and optional Keycloak administration.
Do not migrate existing accounts between issuers automatically. Such a migration requires a verified identity mapping.
Keep Keycloak defaults and its static browser metadata for proxies that block discovery.

## Behavior

`AUTH_ADAPTER=oidc` uses discovery. `IDENTITY_ADMIN_ADAPTER` explicitly selects Keycloak or none.
Omission preserves Keycloak administration for Keycloak auth and selects none for generic auth.
Generic authentication with Keycloak administration is rejected.
Unsupported administration throws before network calls. The client configuration contains public capability flags.
Local roles and access blocking remain available through Studio and CLI.
Provider account creation, identity edits, password actions and provider session revocation require administration.
Distributed sync provisioning remains Keycloak-specific.

The reusable token verifier checks signatures, issuer, configured audience and expiry.
Generic mode does not construct Keycloak endpoints from internal issuer settings.
An explicit internal signing-key URL remains supported.
Generic first login does not import Keycloak realm roles into local permissions.

Migration `098_auth_issuer_binding` creates a local singleton binding table.
Authenticated application startup binds the current issuer atomically before starting workers.
Later issuer changes fail closed. Competing first starts cannot bind different issuers.
Database migration commands remain available without starting the application context.
The first upgraded deployment must retain its current issuer because historical users have no issuer field.
Development auth bypass does not adopt a binding. It cannot be used in production.
`openldr auth rebind-issuer --force` moves the binding to the configured issuer. It is for a provider that moved address.
Without `--force` it prints both issuers and changes nothing. It uses the database context, because the app context refuses to start.

Local-only directory rows keep their local ID and expose the provider subject separately.
Status routes use the local ID in this mode; role assignment uses the subject.
Shared status logic blocks the subject before updating local status and only unblocks after successful enable.
Failures retain the block and produce a failed audit event. Provider methods are not called.

Ruling: the disposable provider required an API scope and resource URL for JWT access tokens.
Add `OIDC_SCOPES` and `OIDC_RESOURCE` rather than claim the fixed browser request works everywhere.
The default scopes remain `openid profile email`; configured scopes must retain `openid`.
The actual installed browser library required `extraTokenParams.resource` on code exchange.
Its authorization resource setting alone did not populate that token request.

## Verification

All commands ran in this worktree. No deployed data, services or credentials were used.

| Command | Result and layer |
| --- | --- |
| `pnpm --filter @openldr/bootstrap test src/auth-issuer-binding.test.ts src/account-status.test.ts src/user-directory.test.ts src/index.test.ts --maxWorkers=1 --minWorkers=1` | 39 passed before the final two failure-injection cases. Store behavior and bootstrap structure. |
| `pnpm --filter @openldr/bootstrap test src/account-status.test.ts --maxWorkers=1 --minWorkers=1` | Final 14 passed, including failed local enable writes and block removal. |
| `pnpm --filter @openldr/server test src/account-status-auth.test.ts src/users-routes.test.ts --maxWorkers=1 --minWorkers=1` | 33 passed. Route responses and same-token denial after disable. |
| `pnpm --filter @openldr/server test src/auth-plugin.test.ts src/account-status-auth.test.ts --maxWorkers=1 --minWorkers=1` | 24 passed, including generic first-login realm-role suppression. |
| `pnpm --filter @openldr/cli test src/user.test.ts --maxWorkers=1 --minWorkers=1` | 10 passed. Shared status behavior and CLI audit identity. |
| `pnpm --filter @openldr/db test src/migrations/migrations.test.ts --maxWorkers=1 --minWorkers=1` | Two passed. Migration registration. |
| `pnpm --filter @openldr/bootstrap test src/auth-issuer-binding.live.test.ts --maxWorkers=1 --minWorkers=1` with task-local `P09_TEST_DATABASE_URL` | One passed on disposable PostgreSQL 16. Concurrent conflicting issuer binding and persisted winner. |
| `pnpm --filter @openldr/db --filter @openldr/bootstrap --filter @openldr/server --filter @openldr/cli typecheck` | All four passed before the last scope/resource refinement. Final checks recorded below. |

The initial local-status regression failed because provider methods were still called.
The initial issuer test failed because the binding implementation did not exist.
Config and browser resource tests also failed before their corresponding changes.

The non-Keycloak rehearsal uses the real Studio OIDC client and server verifier over loopback HTTP.
Details and limitations are in `P09-auth-rehearsal.md`.

## Claude continuation, 2026-09-11

Codex stopped at its usage limit. Claude reviewed the diff and found one gap.
The installer derives `OIDC_ISSUER_URL` from the lab's address at `scripts/init/config-compute.mjs:10`.
A new IP address, hostname or HTTPS origin therefore changes the issuer while Keycloak user IDs stay the same.
The binding then stopped startup, and most CLI commands, with no recovery except manual SQL.
The operator chose a CLI escape. Claude added `readAuthIssuerBinding`, `rebindAuthIssuer`, the `auth rebind-issuer` command, en/fr/pt docs and a CLI reference row.
The startup error now names the command.

`facility-import-wiring.test.ts` started the app against an unreachable database without dev bypass.
The binding query failed there. It now sets `AUTH_DEV_BYPASS: true`, as Codex did in `index.test.ts`.

| Command | Result and layer |
| --- | --- |
| `pnpm --filter @openldr/bootstrap exec vitest run src/auth-issuer-binding.test.ts` | 5 passed. Four new cases failed first. pg-mem store behavior. |
| `pnpm --filter @openldr/cli exec vitest run src/auth.test.ts` | 6 passed. Failed first on the missing module. Mocked database and audit. |

## Limits and continuation

HONEST NON-PROOF: this is not a certification of another vendor's production deployment.
It does not support opaque API access tokens, automatic issuer migration or generic sync provisioning.
First adoption cannot infer whether an operator already changed the issuer incorrectly.
Keep the original issuer during the upgrade and follow the planned-upgrade procedure.
Run migration 098 before starting authenticated application services or application-context CLI commands.

No live deployment was changed. Changelog generation belongs after an authorized merge.
The worktree must remain available until the operator requests merge.
