# Authentication providers

<!-- operator-platform -->

Run maintenance on the OpenLDR host, from your installed Compose folder. The examples use `~/Downloads/openldr_ce` on Linux/macOS and `C:\openldr_ce` in PowerShell. Replace these paths with your installation. The blue prompt is already shown by the terminal. Type the command only. Configuration snippets name the file to edit; they are not terminal commands. Pictures are examples, not proof that maintenance succeeded. Sample data is optional.

## Choose authentication and administration

| Configuration | Sign-in | Provider administration | Sync client provisioning |
| --- | --- | --- | --- |
| `AUTH_ADAPTER=keycloak`, administration omitted or `keycloak` | Keycloak metadata | Available with admin credentials | Keycloak only |
| `AUTH_ADAPTER=keycloak`, `IDENTITY_ADMIN_ADAPTER=none` | Keycloak metadata | Unavailable | Unavailable |
| `AUTH_ADAPTER=oidc`, administration omitted or `none` | OIDC discovery | Unavailable | Unavailable |

`IDENTITY_ADMIN_ADAPTER` defaults to `keycloak` for Keycloak authentication and `none` for generic OIDC. Generic authentication with Keycloak administration is rejected.

Without provider administration, manage accounts, passwords and provider sessions at the provider. OpenLDR cannot create, edit or delete provider users, reset passwords or revoke provider sessions. Local role assignment and local disable/enable remain available in Studio and the CLI. Local disable blocks OpenLDR access; it does not disable the provider account. Distributed sync client provisioning still requires Keycloak administration. Generic machine-to-machine sync is outside this guide's supported setup.

## Configure a generic provider

Use a fresh deployment with no identities bound to another issuer. Keycloak remains the default. Generic OIDC needs discovery and signed JWT access tokens; opaque tokens are unsupported. These steps do not certify any external provider. First sign-in screenshots remain deferred to the fresh install.

### 1. Register the browser client at your provider

Replace YOUR_HOST with the configured public address. PKCE binds the code exchange to the browser that started it. Allow the Studio origin for discovery and token calls. Do not give Studio a client secret. Provider screens differ, so this is a configuration example, not a provider screenshot.

```text
{{operator:auth-client}}
```

![Register the browser client at your provider.](guide:operator-auth-client)

### 2. Set the provider values in the environment file

Replace issuer, audience and client ID with provider values. Keep openid in scopes; add provider-required API scopes and OIDC_RESOURCE only when needed. The provider must include the configured audience in access tokens. An ID token is not an API access token. Remove stale Keycloak-only settings. OIDC_INTERNAL_ISSUER_URL is ignored in generic mode; an explicit OIDC_INTERNAL_JWKS_URL changes key retrieval, not issuer validation.

```text
{{operator:auth-config}}
```

![Set the provider values in the environment file.](guide:operator-auth-config)

### 3. Recreate the API and read its startup result

Resolve configuration or discovery errors before continuing. OpenLDR checks token signatures, issuer, audience and expiry. Without a provider logout endpoint, sign-out clears the local session but may leave the provider session active. Test actual sign-in separately during the fresh-install pass.

```sh
{{operator:auth-recreate}}
```

![Recreate the API and read its startup result.](guide:operator-auth-recreate)

## Grant administrator access to a known account

An account must already have completed its first provider login so it exists locally. That login does not automatically grant administrator access. This is an operator task after that prerequisite, not a sign-in walkthrough.

### 1. Read the account and provider subject

Match the subject to the intended provider account. Do not confuse subject with local user ID or username. Keep directory output private.

```sh
{{operator:auth-users}}
```

![Read the account and provider subject.](guide:operator-auth-users)

### 2. Assign the local administrator role

Replace SUBJECT with the verified provider subject. This changes local authorization. Verify the resulting access with that account. Later changes use this command or the Studio user actions.

```sh
{{operator:auth-role}}
```

![Assign the local administrator role.](guide:operator-auth-role)

## Preserve an existing issuer binding

The application database binds to its issuer before authenticated services start. Keep that issuer on upgrades and restores. Usernames cannot prove historical issuer identity. The binding is local and is not replicated through settings sync. A different provider needs an explicit identity-migration procedure.

### 1. Review the issuer move without changing it

Only after the same provider changes hostname or protocol, set the new OIDC_ISSUER_URL and inspect this command’s old/new values. Without --force it does not change a mismatched binding. Resolve pending migrations first.

```sh
{{operator:auth-rebind-review}}
```

![Review the issuer move without changing it.](guide:operator-auth-rebind-review)

### 2. Confirm only an unchanged provider identity

Use --force only when this is the same provider and subject IDs are unchanged. It is not a provider-switch shortcut. Successful changes record auth.issuer.rebind. Restart and verify separately. This guide does not run the change on your host.

```sh
{{operator:auth-rebind}}
```

![Confirm only an unchanged provider identity.](guide:operator-auth-rebind)
