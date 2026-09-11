# Authentication providers

OpenLDR supports Keycloak and generic OpenID Connect, or OIDC, for sign-in. Keycloak remains the default. Generic mode requires discovery and signed JWT access tokens. Opaque access tokens are unsupported. This guide does not certify a second provider's deployment configuration.

## Choose authentication and administration

| Configuration | Sign-in | Provider administration | Sync client provisioning |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration omitted or `keycloak` | Keycloak metadata | Available with admin credentials | Keycloak only |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Keycloak metadata | Unavailable | Unavailable |
| `AUTH_ADAPTER=oidc`, administration omitted or `none` | OIDC discovery | Unavailable | Unavailable |

`IDENTITY_ADMIN_ADAPTER` defaults to `keycloak` for Keycloak authentication and `none` for generic OIDC. Generic authentication with Keycloak administration is rejected.

Without provider administration, manage accounts, passwords and provider sessions at the provider. OpenLDR cannot create, edit or delete provider users, reset passwords or revoke provider sessions. Local role assignment and local disable/enable remain available in Studio and the CLI. Local disable blocks OpenLDR access; it does not disable the provider account. Distributed sync client provisioning still requires Keycloak administration. Generic machine-to-machine sync is outside this guide's supported setup.

## Configure a generic provider

Use a fresh deployment with no identities bound to another issuer. Register a public browser client using authorization code with PKCE. PKCE binds the code exchange to the browser that started sign-in. Do not give Studio a client secret.

Register `https://YOUR_HOST/studio/auth/callback` as the redirect URI and `https://YOUR_HOST/studio` as the logout return URI. Allow the Studio origin for browser discovery and token requests. The provider must publish OIDC discovery metadata and signing keys. Its access tokens must be JWTs with the configured issuer and audience.

```dotenv
AUTH_ADAPTER=oidc
IDENTITY_ADMIN_ADAPTER=none
OIDC_ISSUER_URL=https://YOUR_PROVIDER/ISSUER_PATH
OIDC_AUDIENCE=openldr-api
OIDC_WEB_CLIENT_ID=openldr-web
```

`OIDC_SCOPES` defaults to `openid profile email`. Add the API scopes required by your provider and keep `openid`. Set `OIDC_RESOURCE` when the provider requires a resource URL to issue the API access token. Resource and scope values come from the provider configuration; OpenLDR does not infer them from `OIDC_AUDIENCE`.

Replace the issuer, audience and client ID with provider values. Configure the provider to include that audience in access tokens. OpenLDR checks signatures, issuer, audience and expiry. An ID token is not an API access token.

`OIDC_INTERNAL_JWKS_URL` can explicitly supply an internal signing-key endpoint. It does not change the expected issuer. `OIDC_INTERNAL_ISSUER_URL` is Keycloak-specific; generic mode does not derive endpoints from it. Remove stale Keycloak settings from a generic deployment. Keycloak mode retains static metadata for proxies that block discovery.

Restart application processes after changing configuration. If discovery has no logout endpoint, signing out clears the local session only. The provider session can remain active.

## Grant the first administrator access

Sign in once to create the local account. First login does not grant administrator access. On the server, find that account's provider subject using `openldr user list`. Check the subject against the intended provider account, then run:

```sh
openldr user assign-role SUBJECT lab_admin
```

Replace `SUBJECT` with the exact provider subject, not the local user ID. Sign in again and verify the assigned access. Later role changes use the same CLI command or Studio's user actions.

## Preserve the issuer

OpenLDR binds the application database to its issuer before authenticated services start. Later issuer changes stop startup. Changing the URL can change the identity namespace even when usernames match. The binding stays local and does not replicate through settings sync.

On the first upgrade with this protection, keep the existing `OIDC_ISSUER_URL`. Historical user rows cannot prove their original issuer. The first binding records the configured value; it cannot detect an earlier configuration mistake. Keep the same issuer when restoring an existing application database.

If the same provider only moved address, for example a new hostname or a switch to HTTPS, user IDs do not change. Set the new `OIDC_ISSUER_URL`, then run:

```bash
openldr auth rebind-issuer --force
```

Without `--force` the command shows both issuers and changes nothing. With it, the command records an `auth.issuer.rebind` audit event. Do not use it to switch to a different provider. There is no automatic account migration. Moving identities between providers, remapping subjects and restoring provider identities need a separate operator-reviewed procedure. Database migration commands remain available without starting authenticated services.

See [Environment variables](/docs/environment), [Users and roles](/docs/users) and [Distributed sync](/docs/sync).
