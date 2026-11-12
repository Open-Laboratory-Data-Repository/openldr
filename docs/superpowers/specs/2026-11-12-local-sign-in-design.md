# Local sign-in: design

Status: DRAFT for operator review. No code written.
Date: 2026-11-12.
Relates to: `2026-09-11-p09-auth-portability.md`, `2026-06-20-sp1b-browser-login-design.md`.

## 1. What this is and why

OpenLDR CE cannot sign anyone in without Keycloak. On 2026-11-12 `docker stats` showed
Keycloak at 509 MB. The whole stack was about 1 GB. Keycloak is also an outside product
that can change its license or stop shipping, as MinIO did.

The operator wants three tiers that share one core:

| Tier | Database | Files | Sign-in |
|---|---|---|---|
| Standalone | Bundled Postgres | Folder on disk | Local |
| Server | Postgres in Docker | Garage | Local by default, Keycloak optional |
| Heavy | Several databases | Not decided | Keycloak or a ministry login |

This design adds a third sign-in choice that lives inside the server. Keycloak and plain
OIDC stay as they are.

This is design A of four. B is the standalone run with no Docker. C is the CLI going
through the app with sign-in. D is the Electron app with onboarding. C and D need this
design. B does not.

The user action that is broken today: nobody can sign in to an install that has no
Keycloak. The only other path is `AUTH_DEV_BYPASS`, and config refuses that in production
(`packages/config/src/schema.ts:219`).

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| The server cannot check a password itself | CONFIRMED | `AUTH_ADAPTER` accepts only `keycloak` and `oidc`: `packages/config/src/schema.ts:35` |
| User management needs Keycloak | CONFIRMED | With identity admin `none`, every directory call throws: `packages/adapter-auth/src/index.ts:47` |
| Permissions need Keycloak | REFUTED | The database decides after first sign-in: `apps/server/src/auth-plugin.ts:130`. Tables come from migration `062_rbac` |
| Plugin role checks need role names in the token | CONFIRMED | `packages/bootstrap/src/plugin-broker.ts:259` and `apps/server/src/plugin-ui-routes.ts:75` read `req.user.roles`, which comes from the token: `apps/server/src/auth-plugin.ts:132` |
| Blocking an account needs Keycloak | REFUTED | `account_access_blocks`, read at `apps/server/src/auth-plugin.ts:119` |
| Keycloak enforces password rules or lockout today | REFUTED | `infra/keycloak/openldr-realm.json` sets nine top-level keys. None is `passwordPolicy`, `bruteForceProtected`, or an OTP policy |
| The verifier only accepts keys fetched from a remote issuer | REFUTED | It takes an injected key set: `packages/adapter-auth/src/token-verifier.ts:14` |

So Keycloak's real job today is small. It stores passwords, shows the login page, signs
tokens, forces a password change on first login, ends sessions, and creates credentials
for sync sites. The adapter that talks to it is 221 lines.

## 3. Goals, non-goals, anti-goals

Goals:

- A person signs in with a username and password, and no outside service is involved.
- An admin creates users, sets roles, resets passwords, and ends sessions from the Users
  page and the CLI, the same way as today.
- On a new install the first admin picks their own password. No one-time password.
- Repeated wrong passwords lock the account for a short time.
- One server build serves all three values of `AUTH_ADAPTER`.

Non-goals:

- A second factor. None exists today.
- Password reset by email. It is untested today and many labs have no mail server.
- Self-registration. The realm has it off.
- Moving an existing Keycloak install to local sign-in. P09 decided that a new provider
  needs an explicit identity mapping. Build this when a site asks to drop Keycloak.
- Sync enrollment under local sign-in. Enrollment creates a Keycloak client today
  (`packages/bootstrap/src/enrollment.ts:154`). An install on local sign-in cannot be a
  sync central.
- A full OIDC server with an authorize endpoint and outside clients.
- Signing key rotation on a schedule.
- CLI sign-in. That is design C.

Anti-goals. Any of these makes the work a failure even if it runs:

- A setting that turns sign-in off on a real install. `AUTH_DEV_BYPASS` keeps its
  production refusal.
- A second set of roles. The database tables are the only role system.
- A server that behaves differently per tier apart from which adapter is loaded.
- A password, hash, token, or setup code written to a log or an audit row.

## 4. Constraints

- `AuthPort` does not change (`packages/ports/src/auth.ts:57`). The local adapter fills
  it. If the builder finds the port must change, stop and report first.
- No native modules. Hashing uses Node's built-in `crypto.scrypt`. A native module means
  one binary per OS, which is the packaging problem design B is trying to avoid.
- Labs run studio over plain HTTP on a LAN or Tailscale. A cookie that always demands
  HTTPS would lock them out.
- The schema default for `AUTH_ADAPTER` stays `keycloak`. Existing installs with no
  `AUTH_ADAPTER` line rely on it. New installs get `local` from the install templates.
- The next free internal migration number is 116. I checked every local branch on
  2026-11-12 and none adds a migration. Check again before adding one.
- AGENTS.md section 5 for UI, section 6 for the five places a feature lands.

## 5. How it works

### 5.1 Configuration

- `AUTH_ADAPTER` gains the value `local`.
- `IDENTITY_ADMIN_ADAPTER` gains `local`. It is the default when `AUTH_ADAPTER=local`.
- `OIDC_ISSUER_URL` is required only for `keycloak` and `oidc`. Today it is always
  required (`packages/config/src/schema.ts:76`).
- Under `local`, the token issuer is a fixed string owned by the adapter. The issuer
  binding from P09 stores that string, so a database that was bound to a Keycloak issuer
  refuses to start under `local`. That is the intended fail-closed behaviour.
- `GET /api/config` reports the mode and whether setup is finished. See 5.7 for the trap.

### 5.2 Accounts and passwords

- A local account is a row in `users` plus one row in a new credentials table.
- For a local account, `users.subject` equals `users.id`. Role assignments and access
  blocks are keyed by subject, so one ID serves both.
- A person signs in with their username or their email. Matching ignores case. An email
  works only when exactly one account has it, because `users.email` is not unique.
- The hash is scrypt with N=32768, r=8, p=3 and a 16-byte random salt. That is one of the
  OWASP-listed settings and needs about 32 MB per hash. The stored value records the
  parameters, so they can be raised later without a migration.
- The server runs at most four hashes at once and queues the rest. This caps hashing
  memory near 128 MB on a small machine.
- Password rules: at least 10 characters, at most 128, and not equal to the username.
  No rules about character types. No expiry.

### 5.3 Tokens and sessions

- The server signs access tokens itself with an ES256 key pair. It creates the key on
  first start and stores the private half sealed with `SECRETS_ENCRYPTION_KEY`, the way
  workflow secrets are sealed (`packages/db/src/workflow-secret-store.ts:45`). All
  instances of a heavy-tier install read the same key from the database.
- An access token lives 10 minutes. It carries `sub`, `preferred_username`, `name`,
  `email`, and a session ID. The existing user sync reads the first four
  (`packages/users/src/store.ts:189`).
- The token also carries the user's role slugs, read from `user_roles` when the token is
  issued. They go in the same `realm_access.roles` claim Keycloak uses, so the plugin
  role checks work with no change. A role change reaches plugin checks within 10
  minutes, when the next token is issued. Keycloak tokens have the same delay today.
  Permissions are not delayed, because the server reads them from the database on every
  request.
- A session is a database row. Signing in creates one and sets a cookie that holds a
  random session secret. The table stores only a hash of that secret.
- The cookie is `HttpOnly`, `SameSite=Strict`, scoped to the sign-in routes, and marked
  `Secure` only when the request arrived over HTTPS.
- Studio keeps the access token in memory, as it does now (`apps/studio/src/auth/token.ts:3`).
  It asks for a new one shortly before the old one expires, using the cookie.
- A session ends after 12 hours with no use, or 7 days after sign-in, whichever is first.
- `verifyToken` checks the signature, then checks that the session row is still live.
  Ending a session therefore takes effect on that user's next request. The auth plugin
  already runs three queries per request (`apps/server/src/auth-plugin.ts:119` to `138`),
  so one more indexed lookup is cheap.

Routes, all under `/api/auth/`:

| Route | Who can call | What it does |
|---|---|---|
| `POST login` | Anyone | Checks the password. Returns an access token and sets the cookie |
| `POST refresh` | Cookie holder | Returns a new access token |
| `POST logout` | Cookie holder | Deletes the session and clears the cookie |
| `POST change-password` | Signed-in user | Needs the current password. Ends the user's other sessions |
| `POST setup` | Anyone, once | Creates the first admin. See 5.5 |

`login`, `refresh`, `logout`, and `setup` must pass the auth plugin without a bearer
token, the way `/api/config` does (`apps/server/src/auth-plugin.ts:85`).

### 5.4 Sign-in rules

- Five wrong passwords in a row lock the account for five minutes. A correct sign-in or
  an admin reset clears the count. The count is raised with one atomic update, so two
  wrong attempts at the same moment both count.
- A lock is always temporary. Nobody can lock the last admin out for good by guessing.
- A wrong username, a wrong password, and a locked account all return the same 401 and
  the same message. The message says the details are wrong or the account is locked for
  a few minutes.
- For a username that does not exist, the server still runs one hash, so the reply takes
  the same time.
- Each IP address gets at most 30 sign-in attempts per minute. This counter is in memory
  and per server instance.
- An account that must change its password gets a token that only works on
  `change-password` and `logout`. Every other `/api` route answers 403.
- Audit rows record sign-in, sign-out, failed sign-in, lock, password change, and admin
  reset. The existing `auth.failed` row and its per-IP throttle are reused
  (`apps/server/src/auth-plugin.ts:70`).

### 5.5 The first admin

An install needs setup while no local account has a password.

- The setup page asks for a username, a password, and a setup code.
- The setup code proves the person can reach the machine. Without it, anyone on the lab
  network who opened a fresh server first would become the admin.
- `openldr auth setup-code` prints a new code. It works only on the machine itself, with
  direct database access. The database stores a hash of the code, and the code expires
  after 30 minutes.
- The CLI is the only source of a code. The server never creates one and never logs
  one. A restart therefore cannot replace a code someone is about to type, and several
  server instances cannot overwrite each other's codes.
- The Docker install script runs that command inside the server container and prints
  the code at the end, where it prints the one-time password today.
- The first admin gets the locked `lab_admin` role (`packages/rbac/src/presets.ts:51`).
- Once an admin exists, `setup` answers 409 for the life of the install.

Design D's Electron app will fetch the code in-process and fill it in. The person at the
keyboard only chooses a password. That wiring belongs to D.

### 5.6 What each port method does under local sign-in

| Port method | Local behaviour |
|---|---|
| `verifyToken` | Verify with the local public key and fixed issuer, then confirm the session is live |
| `healthCheck` | Pass when the signing key loads and the database answers |
| `resetPassword(userId, password, temporary)` | Store the new hash. Set the must-change flag from `temporary`. Clear any lock. End the user's sessions |
| `sendPasswordResetEmail` | Not supported. Studio hides the menu item |
| `forceLogout` | Delete the user's sessions |
| `directory.list`, `get` | Read `users` joined to credentials |
| `directory.create` | Insert the user and credentials. Assign the given roles in `user_roles`. Mark RBAC as initialised |
| `directory.update` | Update email, names, and enabled state |
| `directory.setRoles` | Replace the user's rows in `user_roles` |
| `clients.*` | Throw `IdentityAdminNotConfiguredError`, as identity admin `none` does today |

`authCapabilities` on `/api/config` reports `identityAdmin: true` and
`syncClientAdmin: false`. It gains a third flag for the reset email, true only under
Keycloak. Studio already hides sync enrollment when `syncClientAdmin` is false.

### 5.7 Studio

- A sign-in page. It renders in place at whatever address the person opened, the way
  the signed-out screen does today, so it needs no route. It is a full page, because no app shell exists before
  sign-in. Fields use the label-left grid from `pages/settings/Connectors.tsx`. It has one
  visible submit button. AGENTS.md section 5 puts actions in a dots menu, but that rule
  covers page headers, sheets, and rows inside the app. The existing signed-out screen
  already uses a visible button (`apps/studio/src/auth/AuthProvider.tsx:117`).
- A forced change page with the same layout, shown when the account must change its
  password.
- A setup page with the same layout, shown while the install needs setup.
- "Change password" in the user menu opens a Sheet. Its fields are label-left and its
  save action sits in the sheet's dots menu, copied from
  `forms-builder/FieldEditorSheet.tsx`.
- The Users page keeps its create, edit, reset, and end-session actions. It hides "send
  reset email" when the flag is off. Text that names Keycloak gets a provider-neutral
  wording in en, fr, and pt.
- All four screens use `h-dvh` and are checked at 375x812.

The trap in `AuthProvider`: it treats a missing `oidc` block as dev bypass and skips
sign-in (`apps/studio/src/auth/AuthProvider.tsx:69`). Under local sign-in there is no
`oidc` block and auth is enforced. The local branch must come before that check, or
studio will load with no user and every request will 401.

### 5.8 CLI

- `openldr auth setup-code`. See 5.5.
- `openldr user reset-password <username> --force`. It sets a generated temporary
  password, prints it once, ends the user's sessions, and audits as `actorName: 'cli'`.
  This is how the last admin recovers a forgotten password. It needs access to the
  machine, which is the proof of authority.
- `openldr user create` must produce an account that can sign in. Today it writes a
  `users` row with no subject and no password (`packages/cli/src/user.ts:53`). Under
  local sign-in that row cannot sign in, and it blocks the same username on the Users
  page, because `users.username` is unique. Under `local` the command goes through the
  directory, sets a generated temporary password, and prints it once.
- `openldr user end-sessions <username>`. No CLI command ends sessions today.
- Roles are assigned with the existing `assign-role` and `unassign-role`, which write
  `user_roles`.
- The builder runs every other `users` and `user` command under `AUTH_ADAPTER=local`
  and reports each one that fails, or that succeeds but leaves an account unusable.
- The shared logic lives in `@openldr/bootstrap`, so the route and the CLI call the same
  code.

### 5.9 Setup checks and health

The Sign-in check in `packages/bootstrap/src/setup-checks.ts:92` passes whenever the
bypass is off. Under local sign-in it also warns while the install still needs setup,
and tells the reader to run `openldr auth setup-code`. `openldr doctor` shows the same
line.

### 5.10 New installs

- `.env.example` and the install templates set `AUTH_ADAPTER=local`.
- In `docker-compose.prod.yml` the server waits for Keycloak to be healthy (line 18).
  Keycloak moves behind a compose profile, and the server stops depending on it unless
  that profile is on.
- The install script asks which sign-in to use and defaults to local.

## 6. Data

One internal migration, number 116 unless a branch has taken it.

| Table | Holds |
|---|---|
| Credentials, one row per local user | Password hash with parameters, must-change flag, failed count, locked-until time, password-changed time, first and last name |
| Sessions | ID, user, hash of the session secret, created, last used, expires, IP, user agent |
| Signing keys | Key ID, sealed private key, public key, created |
| Setup code | Hash and expiry. One row at most |

The directory returns first and last names, and `users` has only `display_name`. The
builder picks where the two names live.

## 7. Slices

Each slice lands with its tests and leaves `main` working.

1. Config, the migration, the hashing module, and the signing key. No routes, no UI.
2. The sign-in routes, the session check in `verifyToken`, lockout, and audit rows.
3. The directory and admin methods. The Users page works under `AUTH_ADAPTER=local`.
4. Studio: the sign-in, forced change, and setup pages, the change-password sheet, and
   the `AuthProvider` branch. Strings in en, fr, and pt.
5. CLI commands and the Setup checks line.
6. Docs in en, fr, and pt for the in-app guide and the web docs. Install templates and
   the compose profile. `pnpm make:changelog` after the merge.

## 8. Verification

Say which layer each test proves.

- Route tests pin the wire shape of the five routes and the 401, 403, and 409 answers.
  Typecheck does not.
- pg-mem cannot prove the atomic failed-count update or the session lookup under real
  concurrency. Run those two against real Postgres.
- A fresh database must boot under `AUTH_ADAPTER=local` with migration 116 applied. Only
  a real boot catches a migration number clash.
- An existing database bound to a Keycloak issuer must refuse to start under `local`.
- Existing Keycloak and OIDC tests must stay green. That is the proof the other two
  modes did not change.
- Measure one scrypt hash on the dev machine and record the time. If it is over 300 ms,
  report before changing the parameters.

HONEST NON-PROOF items the builder must state, not hide:

- Hash time on a small lab machine. Only that hardware can show it.
- The session cookie over plain HTTP in a phone browser on Tailscale. Headless Chromium
  will pass either way. Only a real phone confirms it.

## 9. Left to the builder

- Table and column names, and where first and last name are stored.
- The exact cookie name and path.
- The wording of every message, within the unslop rules.
- Whether the setup code hash sits in its own table or in `app_settings`.
- The shape of the new block on `/api/config`, as long as the existing fields stay.
- How the Users page reads roles today against the Roles page. If the two disagree under
  Keycloak, report it. Do not fix it in this work.

## 10. Calls I made for the operator to check

These are mine, not the operator's. Any of them can be overturned.

1. No full OIDC server. The server signs its own tokens and the existing verifier checks
   them.
2. The setup code. The simpler choice is no code, which leaves a fresh server open to
   whoever reaches it first.
3. Numbers: 10-character minimum, five wrong tries, five-minute lock, 10-minute tokens,
   12 hours idle, 7 days total. They are constants. They become settings when a site
   asks for different values.
4. One message for wrong details and for a locked account. It hides whether an account
   exists, and it will confuse a locked-out user for five minutes.
5. Slice 6 changes the Docker install. It could be its own piece of work.
6. A visible submit button on the three pre-sign-in pages.
7. Role slugs ride in the token for plugin checks, with up to 10 minutes of delay. The
   other choice was to read roles from the database on every request in all three
   modes, which changes Keycloak and OIDC installs too.
8. `openldr user create` changes behaviour under local sign-in, and one new command ends
   sessions. AGENTS.md section 6 asks for CLI parity, so I treated this as required.

## 11. Noticed, not fixed

- The server listens on every network interface (`apps/server/src/index.ts:187`). The
  standalone tier should listen on the local machine only. That belongs to design B.
- `AuthProvider` uses `h-screen` on its loading and error screens
  (`apps/studio/src/auth/AuthProvider.tsx:123` and `139`). AGENTS.md asks for `h-dvh`.
- `openldr user set-role` writes the old `users.roles` column
  (`packages/cli/src/user.ts:74`). That column grants no permissions in any mode.
- Under plain OIDC the token roles are dropped (`apps/server/src/auth-plugin.ts:132`), so
  plugin role checks fail for every user on an OIDC install. A comment at
  `apps/server/src/layout-routes.ts:23` already notes it.
- `users.username` is unique (`packages/db/src/migrations/internal/006_users.ts:17`).
  Email is not. Sign-in by email needs a rule for two accounts that share one.
- I did not confirm that an install on local sign-in can still push to a Keycloak
  central as a sync site. `packages/sync/src/token.ts:51` requests a token from the
  central, which suggests it can.
