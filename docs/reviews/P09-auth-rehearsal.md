# P09 authentication protocol rehearsal

Date: 2026-09-11. Worktree: `.worktrees/p09-auth-portability`.

A disposable `oidc-provider` 9.12.2 completed an authorization-code exchange with S256 PKCE.
The real `createAuth` adapter discovered its signing keys and verified the JWT access token.
No deployed identity provider, credentials, database or clinical data were used.

## Commands and output

Run from the worktree in PowerShell:

```powershell
$taskTemp = Join-Path $env:TEMP 'openldr-p09-oidc'
New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
npm install --prefix $taskTemp --no-audit --no-fund oidc-provider
pnpm exec tsx (Join-Path $taskTemp 'protocol.mts')
```

Installation added 40 packages outside the repository. The protocol command exited 0:

```json
{"provider":"oidc-provider","mode":"HTTP protocol rehearsal, no browser","pkceCodeExchange":"passed","discoveryAndJwks":"passed","jwtAccessTokenVerified":"passed","wrongAudienceRejected":"passed","tamperedSignatureRejected":"passed","authorizationCodeReplayRejected":"passed"}
```

The script remains in the task temporary directory. It started an HTTP server on an ephemeral
loopback port and closed it after the assertions. Its public client used no client secret.
The temporary provider used generated development keys and memory storage.
Node 24.6 emitted the provider's unsupported-runtime warning. The assertions still passed.

The script followed authorization redirects with a cookie jar. Its interaction handler approved
login and consent for `disposable-user`. It sent `scope=openid api`, a resource URL at the
loopback provider's `/api` path, and the S256 challenge. The token request supplied the same
resource and the code verifier. Verification used discovery and the provider's actual JWKS endpoint.
It rejected a different audience, modified token payload, and a second exchange of the same code.

## Configuration ruling

This provider required the API scope and resource to issue the intended JWT access token.
The existing Studio request only supplied `openid profile email` and optional `audience`.
The operator delegated this required contract refinement through the parent task.
Add `OIDC_SCOPES`, default `openid profile email`, and optional `OIDC_RESOURCE`.
Publish them as `oidc.scopes` and `oidc.resource` for Studio to pass to its OIDC client.
Keep the separate `OIDC_AUDIENCE` check on the API token verifier.

## Limits

HONEST NON-PROOF: this was an HTTP protocol rehearsal, not browser login.
It does not prove Studio redirects, browser cookies, callback rendering, renewal or logout.
A real browser flow through a disposable provider is required for those claims.
The temporary script does not provide a durable automated regression test.
Repository adapter tests separately cover the JWT validation and unavailable administration methods.
No commits, pushes, deployed services or changelog generation were performed.

## Rehearsal using the Studio client

After adding the scope and resource settings, a second script imported the actual
`apps/studio/src/auth/oidc.ts` `createOidc` function. It used the installed `oidc-client-ts` 3.5.0.
Only window navigation and storage were stubbed. Discovery, redirects, code exchange,
provider signing keys, and API token verification used real HTTP requests.

```powershell
pnpm exec tsx (Join-Path $env:TEMP 'openldr-p09-oidc/studio-protocol.mts')
```

The command exited 0:

```json
{"provider":"oidc-provider","client":"actual Studio createOidc and oidc-client-ts","mode":"HTTP with window/storage stub, no real browser","pkceCodeExchange":"passed","authorizationResource":"passed","tokenResource":"passed","discoveryAndJwks":"passed","jwtAccessTokenVerified":"passed","wrongAudienceRejected":"passed","tamperedSignatureRejected":"passed"}
```

The script called `signinRedirect`, followed provider redirects, then called `handleCallback`.
It checked the actual authorization URL and intercepted the token request body to assert `resource`.
Studio passes the resource in both `resource` and `extraTokenParams` because the installed client
only uses the first property for authorization. The second supplies the token exchange.
This run therefore exercised the current Studio configuration instead of a manually assembled exchange.
It still did not exercise a real browser, rendering, session renewal or logout.

## Repository checks

```powershell
pnpm exec vitest run packages/config/src apps/server/src/config-route.test.ts packages/adapter-auth/src/index.test.ts
pnpm --filter @openldr/config --filter @openldr/adapter-auth --filter @openldr/server typecheck
```

The test command reported 9 files and 137 tests passed. The typecheck command exited 0.
These checks cover configuration validation, adapter behavior and the public config response.
They do not prove browser behavior or database issuer binding.

## Automatic token renewal

A third rehearsal kept the actual Studio client and set provider access-token lifetime to 65 seconds.
It enabled the public client's refresh-token grant and configured the disposable provider to issue refresh tokens.
Studio's automatic renewal exchanged the refresh token after about five seconds.

```powershell
pnpm exec tsx (Join-Path $env:TEMP 'openldr-p09-oidc/studio-refresh.mts')
```

The command exited 0 and additionally reported:

```json
{"automaticRefresh":"passed","refreshRequestResource":null,"renewedJwtVerified":"passed"}
```

The installed client omitted `resource` from the refresh request. This provider retained the granted
resource and returned a different JWT. The API adapter verified its subject and expected audience.
No production code change was required for this provider's refresh behavior.

The provider's default policy did not issue a refresh token when `offline_access` lacked an explicit
consent prompt. The first attempt failed the assertion requiring a refresh token. For the renewal
rehearsal, its temporary configuration used `issueRefreshToken: async () => true`.
This is a provider policy choice, not evidence that every provider supports the same refresh request.
Operators must configure their provider's refresh issuance and resource behavior accordingly.
HONEST NON-PROOF: actual browser background timers, cookie restrictions and provider-specific refresh
requirements remain outside this rehearsal.
