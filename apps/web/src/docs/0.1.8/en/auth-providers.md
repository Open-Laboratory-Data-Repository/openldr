# Authentication providers

OpenLDR can sign people in three ways: with its own accounts, through Keycloak, or through a generic OpenID Connect, or OIDC, provider. `AUTH_ADAPTER` picks one. When it is not set, it is `keycloak`. Generic mode requires discovery and signed JWT access tokens. Opaque access tokens are unsupported. This guide does not certify a second provider's deployment configuration.

## Choose a sign-in mode

| Mode | Where accounts and passwords live | Pick it when |
| --- | --- | --- |
| `AUTH_ADAPTER=local` | In OpenLDR's own database. No other service runs. | A lab runs its own install and needs nothing beyond usernames and passwords. It is the simplest choice and uses the least memory. |
| `AUTH_ADAPTER=keycloak` | In Keycloak, a separate service that runs beside OpenLDR. | The install is a sync central, or it already uses Keycloak. Enrolling sync sites needs Keycloak administration. |
| `AUTH_ADAPTER=oidc` | In a provider you already run, such as a national login. | People must use an existing login. OpenLDR cannot create those accounts or reset their passwords. |

Choose before the first start. The database records the sign-in mode it first starts with, and refuses to start under a different one. There is no way to move an existing install's accounts from Keycloak or OIDC to local sign-in.

## Choose authentication and administration

| Configuration | Sign-in | Provider administration | Sync client provisioning |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=local`, administration omitted or `local` | OpenLDR's own accounts | Available in Studio and the CLI | Unavailable |
| `AUTH_ADAPTER=keycloak`, administration omitted or `keycloak` | Keycloak metadata | Available with admin credentials | Keycloak only |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Keycloak metadata | Unavailable | Unavailable |
| `AUTH_ADAPTER=oidc`, administration omitted or `none` | OIDC discovery | Unavailable | Unavailable |

`IDENTITY_ADMIN_ADAPTER` defaults to `keycloak` for Keycloak authentication, `local` for local sign-in, and `none` for generic OIDC. Generic authentication with Keycloak administration is rejected. Local sign-in accepts only `local` or no value.

## Set up local sign-in

Use a fresh database. Set these in `.env`:

```dotenv
AUTH_ADAPTER=local
SECRETS_ENCRYPTION_KEY=YOUR_KEY
```

`SECRETS_ENCRYPTION_KEY` is required. The server seals its token signing key with it, and refuses to start under local sign-in without it. `OIDC_ISSUER_URL` and the Keycloak settings are not used. Leave `IDENTITY_ADMIN_ADAPTER` unset. See [Environment variables](/docs/environment) for the key.

### Create the first administrator with a setup code

A new install has no accounts. Until the first administrator exists, Studio shows a **Create the administrator** page to whoever opens it. The page asks for a setup code. Only someone with access to the server can get one, so a stranger on the lab network cannot claim the install first.

1. Start OpenLDR.
2. On the server, run `openldr auth setup-code`. It prints a code that is valid for 30 minutes. Use the installed or development form of the command from [Command-line interface](/docs/cli).
3. Open Studio. The **Create the administrator** page opens.
4. Type the code in **Setup code**, then a username, then the password twice.
5. Select **Create the administrator**.

Studio signs you in with the locked **Administrator** role. The setup page does not come back, and `openldr auth setup-code` now refuses with `an administrator already exists`.

Running the command again replaces the earlier code. A wrong or expired code shows **That setup code is wrong or has expired.** A taken username shows **That username is already in use.** Until setup is done, `openldr doctor` warns on its Sign-in line.

### Rules for passwords and sessions

These values are fixed. They are not settings.

- A password is 10 to 128 characters and cannot be the username. There is no rule about character types, and passwords do not expire.
- Five wrong passwords in a row lock the account for five minutes. A lock always ends by itself. A correct sign-in or an administrator's reset clears the count.
- Each address gets 30 sign-in attempts a minute. An IPv6 address counts by its /64. The count is kept in memory on each server.
- A session ends after 12 hours with no use, or 7 days after sign-in, whichever comes first.
- The session cookie has no expiry date, so closing the browser signs the user out of that browser, unless the browser is set to restore its last session. The 12-hour and 7-day limits still apply.
- Changing your own password ends your other sessions and keeps the current one.
- An administrator's reset sets a temporary password and ends that user's sessions. The user must choose a new password at the next sign-in, and it cannot be the temporary one.
- Password reset by email is not available. Studio hides **Send reset email**.

A wrong password, a locked account and a disabled account all get the same message, so the sign-in page does not reveal whether an account exists.

### Passwords on plain HTTP

Over plain HTTP, a password crosses the network unencrypted. Anyone who can watch the traffic between a browser and the server can read it. Serve Studio over HTTPS, or reach it only through Tailscale, which encrypts the traffic between devices. The session cookie is marked `Secure` only when a request arrives over HTTPS, so plain HTTP still works. It is not private.

### What local sign-in does not do

- No second factor.
- No password reset by email.
- No self-registration. An administrator adds each person.
- No move of an existing Keycloak or OIDC install to local sign-in.
- No sync enrollment. An install on local sign-in cannot be a sync central.

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

This section is for Keycloak and generic OIDC. Under local sign-in, the setup code creates the first administrator.

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

## Troubleshooting local sign-in

- **The last administrator forgot their password.** On the server, run `openldr user reset-password <username> --force`. It prints a temporary password once and ends that user's sessions. Sign in with it, then choose a new password. The username must match exactly, including capital letters. `openldr users list` shows every username. Without `--force`, the command changes nothing.
- **`openldr auth setup-code` says `an administrator already exists`.** Setup is done. Sign in, or recover a lost password as above.
- **`openldr auth setup-code` says `local sign-in is not enabled`.** `AUTH_ADAPTER` is not `local` in the server's environment.
- **The server refuses to start after you set `AUTH_ADAPTER=local`, and names two different issuers.** The database was first started with Keycloak or OIDC. Moving an install between sign-in modes is not supported. Start local sign-in on a fresh database. `openldr auth rebind-issuer` does not help here, because it is only for a provider that moved address.
- **The server refuses to start and says `SECRETS_ENCRYPTION_KEY is required when AUTH_ADAPTER=local`.** Set the key and start again.
- **A role given with `openldr user assign-role` has no effect.** The command takes the user ID, not the username. Given a username, it reports success and grants nothing. `openldr user create` prints the ID, and `openldr users list` shows it first on each line.

See [Environment variables](/docs/environment) and [Command-line interface](/docs/cli).
