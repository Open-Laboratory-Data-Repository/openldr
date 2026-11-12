# Authentication providers

OpenLDR supports Keycloak and generic OpenID Connect, or OIDC, for sign-in. Generic OIDC uses provider discovery and signed JWT access tokens. Opaque access tokens are unsupported.

A third mode, `AUTH_ADAPTER=local`, keeps accounts and passwords in OpenLDR itself, with no Keycloak. This guide does not cover it. See [Sign-in and passwords](/docs/sign-in) for using it, and the OpenLDR website's Authentication providers page for setting it up.

Use a fresh deployment for a new identity provider. An existing application database belongs to its original issuer and provider subjects. Matching usernames do not make accounts from different providers interchangeable.

The configuration pictures are labelled illustrations. The login pictures use a real isolated Keycloak provider through generic OIDC mode, with authentication enforced. Your provider can use a different login page. This proves the local test flow, not every provider deployment.

You need server and provider administration access for initial configuration. Studio uses a public browser client and authorization code with PKCE. PKCE binds the code exchange to the browser that started sign-in. Do not give Studio a client secret.

## Configure a fresh generic OIDC deployment

Register the browser client at your provider first. Use its actual issuer, audience, scopes and client id. Keep the server configuration private.

### 1. Register the browser client

Use authorization code with PKCE. Register `https://YOUR_HOST/studio/auth/callback` as redirect URI and `https://YOUR_HOST/studio` as logout return URI. Permit the Studio origin for browser discovery and token requests.

![Illustration. Register a public browser client with PKCE at your provider.](auth-providers-guide-client-registration.png)

### 2. Choose generic mode

In the deployment .env, set `AUTH_ADAPTER=oidc` and `IDENTITY_ADMIN_ADAPTER=none`. Generic OIDC cannot use Keycloak administration.

![Illustration. Choose generic OIDC without provider administration.](auth-providers-guide-auth-mode.png)

### 3. Set issuer, audience and client id

Enter OIDC_ISSUER_URL, OIDC_AUDIENCE and OIDC_WEB_CLIENT_ID from the provider configuration. Access tokens must contain the expected issuer and audience. An ID token is not an API access token.

![Illustration. Use issuer, audience and browser client values supplied by your provider.](auth-providers-guide-issuer-settings.png)

### 4. Check requested scopes and resource

OIDC_SCOPES defaults to `openid profile email`. Keep openid and add required API scopes. Set OIDC_RESOURCE only when the provider requires a resource indicator. OpenLDR does not infer it from audience.

![Illustration. Keep openid and add only the provider scopes or resource required.](auth-providers-guide-scopes.png)

### 5. Recreate the affected application service

Apply the startup configuration using your normal deployment command. Confirm the provider publishes discovery metadata and signing keys. Keep AUTH_DEV_BYPASS off.

![Illustration. Recreate the application after editing startup configuration.](auth-providers-guide-restart.png)

**Expected result:** The browser is configured to start provider sign-in. A valid configuration file alone does not establish a successful login.

## Sign in through the provider

Open Studio using its configured public address. The example uses a fictional account on the isolated provider.

### 1. Open Studio

Studio redirects to the configured provider. Check that you reached the expected provider before entering credentials.

![Studio redirects to the configured identity provider.](auth-providers-guide-provider.png)

### 2. Enter your username

Use the account supplied by your organisation. The example uses `guide.operator`.

![Enter your provider username.](auth-providers-guide-username.png)

### 3. Enter the provider password

Use the provider's sign-in method. The screenshot password stays masked. Other providers can require additional authentication.

![Enter the provider password. It remains masked.](auth-providers-guide-password.png)

### 4. Choose Sign In

Select the provider's sign-in action. A successful code exchange returns to Studio.

![Sign in authenticates through the real provider.](auth-providers-guide-sign-in.png)

### 5. Check your initial access

A first login creates a local account. It does not grant administrator access. The example reaches Access denied for its requested page and still offers Docs and available navigation.

![A first login creates a local account but does not grant administrator access.](auth-providers-guide-first-access.png)

**Expected result:** The provider authenticated the account. Application permissions still come from local roles.

## Grant the first administrator local access

On the server, identify the account created by its first login. Use the exact provider subject, not a username or the local user id.

### 1. Find the account subject

From `openldr_ce`, run `pnpm openldr user list`. Match the subject to the intended provider account. Follow [Start here](/docs/start-here) for CLI setup.

![Illustration. Find the local account after its first sign-in.](auth-providers-guide-list-subject.png)

### 2. Assign the administrator role

Run `pnpm openldr user assign-role SUBJECT lab_admin` using that exact subject. This changes OpenLDR access. It does not make the user a provider administrator.

![Illustration. Grant the administrator role to the exact provider subject.](auth-providers-guide-grant-role.png)

### 3. Verify the granted access

Sign in again or reload the authenticated app, then check the permitted administration pages. In the test, Users appears after the local role assignment.

![After the local role assignment, Studio exposes the permitted administration pages.](auth-providers-guide-admin-access.png)

**Expected result:** The selected local account has the assigned application role. The test CLI assignment exited successfully and the actual Users page opened.

## Manage local access without provider administration

Generic OIDC keeps local roles and access controls. Account creation, profile editing, password reset and provider sessions remain with the identity provider.

### 1. Open Users

Select **Users**. Read the provider-administration notice above the table.

![Generic OIDC keeps local access controls while provider account administration is unavailable.](auth-providers-guide-users.png)

### 2. Check the intended account

Match the username and available identity information before changing local access.

![Verify the intended provider identity before changing local roles.](auth-providers-guide-user-row.png)

### 3. Use local row actions

Open the row dots. **Edit role** changes OpenLDR roles. Disable blocks this account in OpenLDR. It does not disable the provider account or end its provider sessions.

![The user row offers local role and access actions.](auth-providers-guide-local-actions.png)

**Expected result:** Provider user administration is unavailable in this mode. Manage accounts and passwords through the provider administrator.

## Sign out of Studio

Use the app user menu. Whether the provider session ends depends on the provider logout metadata.

### 1. Open your user menu

Select your user menu at the bottom left.

![Open your user menu to sign out.](auth-providers-guide-user-menu.png)

### 2. Choose Sign out

Select **Sign out**. Studio clears its session and uses provider logout when available.

![Sign out clears the app session and uses provider logout when available.](auth-providers-guide-sign-out.png)

### 3. Check the returned state

In this test, the provider ended its session and requires a fresh login. Without a discovery logout endpoint, only the local session is cleared and the provider session can remain active.

![This provider ended its session and requires a fresh login.](auth-providers-guide-signed-out.png)

## Check an issuer change before rebinding

A changed issuer stops authenticated service startup against an already-bound database. Preserve the issuer when restoring a deployment.

### 1. Read the refusal before forcing a change

For the same provider moved to a new address, set the intended issuer and run `pnpm openldr auth rebind-issuer` without --force first. It reports a mismatch and refuses to change it. A different provider needs an identity-mapping procedure.

![Illustration. Rebind only when the same provider moved and subjects stay unchanged.](auth-providers-guide-issuer-rebind.png)

**Expected result:** Only a reviewed address move with unchanged provider subjects can use a forced rebind. The illustrated test exercised the refusal, not a forced identity change.

## Read authentication guidance on a phone

The authenticated documentation page adapts to phone width.

### 1. Open the guide

Read Authentication providers in Docs. Provider login layout comes from the provider and needs its own phone check.

![The authenticated app documentation remains readable on a phone.](auth-providers-guide-phone-docs.png)

## Choose sign-in and administration modes

Administration defaults to keycloak in Keycloak mode and none in generic mode. Generic authentication with Keycloak administration is rejected. Do not confuse a public browser client with the separate confidential administration client.

| Configuration | Sign-in | Provider administration |
| --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration omitted or keycloak | Keycloak endpoint metadata | Available only with configured administration credentials. Sync client provisioning uses Keycloak. |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Keycloak endpoint metadata | Unavailable. Local application roles and access remain available. |
| `AUTH_ADAPTER=oidc`, administration omitted or none | OIDC discovery | Unavailable. Generic machine-to-machine sync provisioning is outside this setup. |

## Internal endpoints and token checks

OIDC_INTERNAL_JWKS_URL can explicitly configure an internal signing-key endpoint. It does not change the expected issuer. OIDC_INTERNAL_ISSUER_URL is Keycloak-specific. Generic mode does not derive endpoints from it. Remove stale Keycloak-only settings from a generic deployment.

OpenLDR checks the API access-token signature, issuer, audience and expiry. Its browser session uses the configured scopes and optional resource. Successful sign-in at the provider does not guarantee the API receives the intended access token.

## Preserve the identity namespace

OpenLDR binds the application database to its issuer before authenticated services start. It does not replicate that binding through settings sync. Changing the URL can change the identity namespace even when usernames match.

On the first upgrade with issuer protection, preserve the existing OIDC_ISSUER_URL. Historical user rows cannot prove which issuer originally created them. The first binding records the configured value and cannot detect an earlier configuration mistake.

If the same provider moved address and every subject stays unchanged, a reviewed `pnpm openldr auth rebind-issuer --force` changes the binding and records auth.issuer.rebind. This is not an automatic account migration. Switching providers, remapping subjects or restoring provider identities needs a separate reviewed procedure. Database migration commands remain available without authenticated service startup.

## Troubleshooting

**Cannot reach the server.** Check the app API and public configuration route. A provider login page does not prove the API is available.

**Provider login succeeds but Studio has no access.** Check the local account subject and role assignment. First login does not grant lab_admin.

**Token rejected.** Compare issuer, audience, signing keys, expiry, scopes and resource against the actual access token configuration. Do not paste tokens into shared logs or screenshots.

**Redirect refused.** Check the registered /studio/auth/callback URI and the exact public origin.

**Issuer mismatch at startup.** Restore the original issuer. Use forced rebind only for the same provider moved without subject changes.

**New user, password reset or sync enrollment is missing.** Generic mode has no provider administration. Use the identity provider for its accounts and sessions.

## Authentication verification limits

The real test used generic OIDC discovery, authorization code with PKCE, JWT access-token verification and local role assignment against an isolated Keycloak realm. Authentication bypass was off. No browser or API responses were mocked.

The fictional provider account was disabled and its sessions revoked after capture. Passwords, client administration credentials and tokens remained outside the repository. This is not a certification of another provider, production TLS, MFA, silent renewal or recovery under outage.

## Related guides

[Environment variables](/docs/environment), [Users](/docs/users), [Roles](/docs/roles) and [Distributed sync](/docs/sync).
