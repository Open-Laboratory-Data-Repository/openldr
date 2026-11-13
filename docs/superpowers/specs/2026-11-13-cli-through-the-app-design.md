# CLI through the app: design

Status: APPROVED by the operator on 2026-11-13. No code written.
Date: 2026-11-13.
Relates to: `2026-11-12-local-sign-in-design.md` (design A, merged as `1506c67e`) and
`2026-11-12-standalone-run-design.md` (design B, merged as `e89496bd`).

## 1. What this is and why

The `openldr` CLI talks to the database itself. It has no sign-in and no roles. Whoever can
run it is a full administrator, and the audit log records only the name of their OS user.

The operator's words on 2026-11-12: "our cli has no auth right now which is dangerous."

On 2026-11-13 the operator said who the CLI is for:

- People use Studio. They are not expected at the CLI.
- ICT staff may use it when they troubleshoot over SSH, on the machine that runs OpenLDR.
- The main user is an AI. There is no MCP yet, so the CLI is how an AI operates OpenLDR.

This design sends CLI commands through the running app. The caller signs in, gets the same
permissions as in Studio, and appears by name in the audit log. An AI gets its own account
with a limited role and a key.

This is design C of four. A is local sign-in. B is the standalone run. D is the Electron app
with onboarding. C needs A. C does not need D.

The user action that is broken today: nobody can give an AI, or a junior ICT person, CLI
access that is less than full administrator.

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| The CLI has no sign-in | CONFIRMED | The actor is the OS user name or `cli` (`packages/cli/src/cli-actor.ts:12`). Each command builds its own database context (`packages/cli/src/roles.ts:38`) |
| The server cannot accept a long-lived key | CONFIRMED gap | A bearer value goes only to `ctx.auth.verifyToken` (`apps/server/src/auth-plugin.ts:107` to `:120`). A search of `packages/*/src` and `apps/server/src` found no key feature |
| Commands can run inside the server's own process as they are | REFUTED | A command builds and closes its own context, writes to `process.stdout` and sets `process.exitCode` (`packages/cli/src/roles.ts:38` to `:45`). Some need the ingest context, which routes never see (`apps/server/src/start.ts:92`). Some call `drain()`, which would race the server's own worker (`packages/cli/src/ingest.ts:35`, `start.ts:146`) |
| Commands can run beside the server unchanged | CONFIRMED | On the Docker tier the CLI already runs as its own process in the API container, beside the live server (`install/install.sh:423`). A process the server starts has the same view |
| CLI sign-in needs a new server route | REFUTED | `POST /api/auth/login` returns an access token and sets the session cookie (`apps/server/src/local-auth-routes.ts:185`). `POST /api/auth/refresh` renews it (`:202`) |
| Every command needs a new capability | REFUTED | The catalog covers about 18 areas (`packages/rbac/src/catalog.ts`). About 21 of the 33 CLI groups match one. This is a count by group, not by command |
| Commands need typed answers | REFUTED | Nothing in `packages/cli/src` reads standard input |
| Every command needs the database | REFUTED | The plugin author tools work on local files only. `artifact build` runs `cargo` (`packages/cli/src/artifact.ts:315`) |
| Development needs a key | REFUTED | With `AUTH_DEV_BYPASS` on, a request with no credential is a dev administrator (`apps/server/src/auth-plugin.ts:109`) |
| The next migration number is free | CONFIRMED | Internal migrations end at 116. None of the 30 local branches adds 117 or higher |

Size, measured on 2026-11-13:

| Measure | Count |
|---|---|
| CLI commands | 241, in 33 groups (`packages/cli/src/program.ts`) |
| CLI source files that hold commands | 40, about 8,000 lines |
| CLI tests | 651 |
| Commands with `--json` | 173 |
| Options that take a local file or folder | about 20 |

## 3. Goals, non-goals, anti-goals

Goals:

- Every CLI command that touches the database runs through the app as a signed-in caller,
  apart from a short recovery list.
- A command is allowed only when the caller holds the capability it needs. The server
  makes the check.
- An AI can use the CLI with no person present, under its own account and role.
- ICT staff can sign in from a terminal with their own username and password.
- The audit log names the account that ran each command.
- The CLI client for these commands holds no database password and no secrets key.
- Existing commands keep their names, options and output.
- An AI can ask for the list of commands, with the capability each one needs.

Non-goals:

- An MCP. The command list this design builds is meant to make one easier later.
- Reaching the CLI from another machine. The client takes a server address, and the rest
  is the operator's to set up. The operator said so on 2026-11-12.
- `--json` for the 68 commands that lack it.
- A key that can do less than its account. A key carries the account's role and no more.
- People making keys for themselves. Administrators make them.
- A browser or device sign-in for the CLI on a Keycloak install. Those installs use keys.
- A packaged CLI for machines that do not have OpenLDR.
- Faster commands. Each command still pays for its own process, as it does today.
- Recovery commands on a standalone install whose launcher is not running. See section 11.
- New commands and options, apart from the few this design names.

Anti-goals. Any of these makes the work a failure even if it runs:

- A flag, setting or environment variable that lets a caller run a database command with
  no sign-in, outside the recovery list. The operator chose "only the recovery few" on
  2026-11-13.
- A command with no decision about how it runs and what it needs.
- A second role system, or a permission that is not in the capability catalog.
- A key, token or password in a log line, an audit row, an error message, a URL or a
  command line.
- A changed name, option or output for an existing command, apart from the new error
  cases this design names.
- A through-the-app caller choosing a path on the server's disk.
- A Docker install where the `openldr` wrapper stops working.
- A branch on the tier inside `packages/*` or `apps/server`.

## 4. Constraints

- `AuthPort` does not change (`packages/ports/src/auth.ts`). Keys are checked by the server
  itself, so they work with every `AUTH_ADAPTER`.
- Roles live in the database tables. A key resolves to an account, and the account's
  capabilities are read the same way a token's are (`apps/server/src/auth-plugin.ts:157`).
- The next internal migration is 117. Check for unmerged branches that claim it before
  adding one. Kysely refuses a gap, and pg-mem cannot show it.
- No new npm dependency for the client. Node has `fetch`.
- `apps/server` enforces the `return reply.send` lint rule. A streamed reply must not be
  buffered or re-encoded by the compression plugin.
- UI follows AGENTS.md section 5: actions in a dots menu, sheets not dialogs, label left
  and input right, `StripedEmpty` and `LoadingState`, pagination on every table, shadcn
  only, `h-dvh`.
- AGENTS.md section 6: UI, CLI, docs in en, fr and pt, mobile view, changelog after merge.
- The 651 CLI tests keep passing with no change to what they assert.
- Only Linux can be tested on the build machine. Say so for every Windows and macOS claim.
- The repo has no CI. The local gate in `CLAUDE.md` is the only check.
- A dev stack runs on the build machine and is in use. From a worktree, `loadConfig()` finds
  the main checkout's `.env`. Any server or CLI started there needs
  `OPENLDR_SKIP_ENV_FILE=true` or its own database URLs.

## 5. Approaches

Three ways were weighed on 2026-11-13.

1. **A route per command.** Each command calls the route Studio uses, and new routes are
   added where none exists. One API. But it is the largest job, about 12 groups have no
   routes, and route answers differ from what the CLI prints, so JSON output would change
   shape and break what an AI already relies on.
2. **Commands run in the server.** The CLI becomes a small client that only sends requests.
   The server runs the command code that exists today, as the signed-in caller, and sends
   back the output. All commands move at once and output stays the same. The client holds
   no database password. The server ends up with a list of every command, its arguments
   and its capability.
3. **Check sign-in, keep the database connection.** The CLI asks the server who the caller
   is, checks the capability itself, then works as today. Small. But the CLI still holds
   the database password, so anyone who can run it can go around the check.

The operator picked 2.

Inside 2 there were two ways for the server to run a command. This choice is mine, made
after a reviewer read the first draft:

- **In the server's own process.** Fast, and it shares the server's database connections.
  But every one of the 241 command functions must change, because they build their own
  context and write to the process's own output. Some need parts the server's routes
  cannot reach. A command that uses a lot of memory, or exits, would take Studio down
  with it.
- **In a process the server starts for that one command.** The command code does not
  change. Output is the same by construction. A command that fails or runs out of memory
  cannot hurt the server. It is how the CLI already runs on the Docker tier, beside the
  live server. The cost is the start-up time and memory of one process for each command,
  which is what each command costs today.

I picked the second. It removes the largest and riskiest part of the work, and it loses
nothing the operator asked for.

## 6. How it works

### 6.1 Access keys

An access key lets a program act as one account with no person present.

- A key belongs to one account. It carries that account's capabilities, resolved on every
  request. Changing the account's role or disabling the account takes effect at once.
- The account for an AI is an ordinary account with a limited role and no password. Design
  A already allows an account with no password. Such an account cannot sign in to Studio.
- `openldr user create` gains `--no-password`, so the account can be made from the CLI.
  Today only the API can leave the password out
  (`packages/bootstrap/src/local-accounts.ts:89`).
- A key is a long random value with a fixed prefix, so it can be told from a token. The
  server stores only a hash of it, plus a short visible prefix to tell keys apart. The key
  is shown once, when it is made.
- A key has a name, the account it belongs to, who made it, when, an optional expiry, and
  when it was last used. No expiry is the default. "Last used" is written at most once a
  minute for each key.
- A revoked or expired key is refused. So is a key whose account is disabled.
- A key is accepted only in the `Authorization` header. It is never read from the URL.
- The check sits in the server's sign-in step, before `verifyToken`. It is the same on
  every sign-in adapter and every tier.
- Making and revoking keys needs the capability that already lets someone manage users.
- Making and revoking a key are audited. The key value never is.
- Three places manage keys: Studio (a sheet opened from the user's row on the Users page), the API, and the
  CLI (`openldr user key list`, `create`, `revoke`). The logic lives in `@openldr/bootstrap`
  so the route and the command call the same code.

In Studio the key list is a table with pagination inside that sheet. "New key" and
"Revoke" sit in dots menus. The new key is shown once in the sheet, with a copy button and
one line saying it cannot be shown again.

### 6.2 Sign-in for people

`openldr login` signs a person in from a terminal.

- It asks for a username, and for a password with no echo. `--password-stdin` reads the
  password from standard input for scripts. The password is never a command-line argument.
- It calls `POST /api/auth/login`, the route Studio uses. Lockout and the per-address
  limit apply as they do there.
- It keeps the session in a file only that OS user can read, in the user's config folder,
  keyed by server address. Later commands use it and renew the short access token through
  `POST /api/auth/refresh`. If the server gives a new session value on renewal, the file is
  updated.
- The session ends as design A set it: after 12 idle hours or 7 days. Then the person
  signs in again.
- If the account must change its password, `login` says so and points to Studio.
- `openldr logout` ends the session on the server and deletes the file. `openldr whoami`
  prints the account, its roles and how the caller is signed in.
- `login` works with local sign-in only. On a Keycloak or OIDC install it says to use an
  access key.

### 6.3 Which credential a command uses

In this order:

1. A key in the `OPENLDR_KEY` environment variable.
2. A key in the file named by `OPENLDR_KEY_FILE`.
3. The session file from `openldr login`.
4. Nothing. The server then decides. A dev server with `AUTH_DEV_BYPASS` on accepts it.
   Any other server answers 401, and the client says how to sign in.

There is no `--key` option, because other users can read command lines.

The server address comes from `--url`, then `OPENLDR_URL`, then `http://127.0.0.1:3000`.
The client refuses to send a key or a password to an address that is plain HTTP and not
the local machine, unless `OPENLDR_ALLOW_PLAIN_HTTP` is set. The message names the setting.

### 6.4 Three kinds of command

Every command is marked as one of three kinds. The mark sits in the command definitions,
which the client and the server share.

| Kind | Where it runs | Sign-in | Examples |
|---|---|---|---|
| Through the app | In a process the server starts | Required | Almost everything |
| Recovery | On the machine, straight on the database | None | The list in 6.7 |
| On your machine | In the client, touching no database and no server | None | Plugin author tools |

"On your machine" is for commands that work only on local files. From the code these are
`artifact keygen`, `new`, `build`, `pack`, `sign`, `test` and `publish --to`,
`market verify`, `fhir validate`, `errors list` and `facilities suggest-map`. The builder
confirms each one. A test fails when a command of this kind can reach a context builder or
a database setting. A command with a local part and a database part, such as
`artifact publish --install`, is split by option: the local part runs first, on the
caller's machine, and the rest goes through the app.

### 6.5 Running a command through the app

The client parses the command line. It then sends one request: the command, its arguments
and the content of any input file or folder. The server answers with a stream: output as
it is produced, any output files, and the exit code last.

- **The check comes first.** No credential: 401. A credential without the capability: 403,
  with the capability's name in the message. Nothing is started.
- **The server starts one process for the command.** It runs the same CLI code the tier
  already ships, with the server's own settings. The command code is not rewritten. Its
  standard output, standard error and exit code go back to the client as they are.
- **Arguments do not go on the command line.** The server hands them to the new process
  through a pipe, so no other user of the machine can read them in the process list.
- **The server says who the caller is.** It passes the account to the new process, and the
  CLI's audit actor uses it. The few places that record `cli` as a person's name, such as
  `createdBy` (`packages/cli/src/terminology.ts:269`) and the default approver
  (`packages/cli/src/market.ts:76`), record the account.
- **The caller cannot name someone else.** `--actor` and `--approved-by` are refused
  through the app, with a message that the signed-in account is used. They would put a
  false name in the audit log.
- **Files.** Each command definition marks which arguments are an input file, an input
  folder, an output file or an output folder. The client uploads inputs. The server writes
  them to a folder made for that one request and gives the command those paths. Outputs
  are written there and streamed back, and the client writes them where the caller asked.
  The folder is removed when the request ends. Large files are streamed.
- **The caller never names a path on the server.** A folder a command needs again later,
  such as the distribution folder that `terminology ontology build` records for `rebuild`
  (`packages/bootstrap/src/terminology-context.ts:23`), is uploaded to a kept place under
  the server's work folder, and that place is what gets recorded.
- **An argument can change kind.** `terminology import <kind> <path>` takes a folder, a
  database file or a JSON file, depending on the kind
  (`packages/cli/src/terminology.ts:17`). The definition decides from the arguments.
- **Ctrl+C works as it does today.** The client tells the server, and the server sends the
  command's process the same interrupt it would get in a terminal. `import start` then
  stops at its next page, as it does now. A lost connection is treated the same way. A
  process that does not end within a time limit is killed.
- **A stopping server interrupts running commands** the same way, and the client reports
  that the server stopped.
- **A limit on commands at once.** The server runs a small number at a time and makes the
  rest wait, so several commands cannot use up the machine's memory. A caller that waits
  too long gets a clear "busy" answer.
- **Nothing the caller sent is logged.** The endpoint does not log or audit arguments or
  file contents. Some are secrets, such as `settings sync set clientSecret <value>`. The
  audit rows the commands write themselves do not change.
- **`--force` stays.** Destructive commands still refuse without it.
- **Same version only.** The client sends its version. The server refuses a client from a
  different release with a message that names both versions. The two always ship together.
- **The command list.** `openldr commands --json` prints every command with its
  description, arguments, options, kind, capability, and whether it is destructive. The
  client can print it with no server.

### 6.6 Capabilities

- A command that reads uses the capability the matching route uses for reading. A command
  that writes uses the one for writing. The builder reads the route's `requireCapability`
  and uses the same key.
- Areas with no capability today get new keys in the catalog. From the group names these
  are likely storage, the target store, the ingest pipeline and its queue, plugins,
  provenance and the import tools. The builder confirms the list command by command.
- A new key lands with its label in en, fr and pt, in the same change.
- The locked `lab_admin` role holds every new key. No other preset gets one unless the
  matching Studio screen already gives that role the same power.
- A test fails when any through-the-app command has no capability.

### 6.7 The recovery commands

These keep direct database access. Each must work when the server is down or when nobody
can sign in:

| Command | Why it stays direct |
|---|---|
| `db migrate` | The server may not start until it runs |
| `db reset`, `db seed` | They rebuild the database the server runs on |
| `doctor`, `health` | They diagnose an install that will not start |
| `target-store test` | It checks the warehouse connection, which can be why the server is down |
| `storage copy` | The upgrade guide runs it with the server stopped (`apps/web/src/docs/0.1.8/en/upgrading.md:178`) |
| `auth setup-code` | No administrator exists yet. Design A makes the CLI the only source of this code |
| `auth rebind-issuer` | Nobody can sign in until it runs |
| `user reset-password` | The last administrator is locked out |

- They run in-process, as today. They need the database settings in the environment.
- They are audited as `cli` with the OS user name, as today. `--actor` still works here.
- No other database command can run this way. There is no flag for it.

### 6.8 The three tiers and development

- **Server tier (Docker).** The `openldr` wrapper keeps running the CLI inside the API
  container. Through-the-app commands call the server on `127.0.0.1`. Recovery commands
  find the database settings there, as today.
- **Sign-in on the Docker tier.** The wrapper runs without a terminal in the container
  (`install/install.sh:423`), so the password cannot be asked for there. The wrapper asks
  for it on the host, and keeps the session and any key in a file on the host that only
  that OS user can read. It hands the credential to the client for each call. Nothing is
  stored in the container.
- **Standalone tier.** `openldr-standalone cli` gives the CLI the server address. It gives
  the database settings only to a recovery command. The CLI no longer holds the ordinary
  role's password for anything else.
- **A checkout.** `pnpm openldr` talks to the dev server. With `AUTH_DEV_BYPASS` on, no key
  is needed.
- **Scripts that call the CLI with no server.** These must start a server, or expect one,
  for through-the-app commands: the `e2e:seed` and `docs:seed` scripts in `package.json`,
  `scripts/sync-bundle-live-acceptance.ts`, `scripts/sync-two-instance-harness.ts`,
  `scripts/load-measure.mjs`, `scripts/build-v1-import-plugin.mjs`,
  `e2e/tests/plugin-ui.spec.ts`, `e2e/tests/dhis2-plugin.spec.ts` and
  `install/development.ps1`. The builder checks each one and fixes those that break.
- **How the server finds the CLI to start.** A generic setting names it, with a default
  that fits each tier's layout. No code under `packages/*` or `apps/server` asks which
  tier it is.

Be plain about the limit. On a Docker host, anyone who may run `docker compose exec` can
already reach the database. This design bounds a caller who holds only a key or a session.
It does not bound someone with those rights on the host. The same holds on every tier for
someone who holds the database settings: they could start the CLI the way the server does.

### 6.9 The audit log

- A through-the-app command is recorded under the account that ran it, with the detail
  that it came through the CLI and, for a key, the key's name.
- A recovery command is recorded as `cli`, as today.

### 6.10 Docs

- In-app guides, following `apps/studio/src/docs/HOW-TO-TEMPLATE.md`: how to make an access
  key for an AI, and how to revoke one.
- Web docs: a CLI page that covers signing in, keys, the server address, the three kinds
  of command, and giving an AI access with a limited role.
- `docs/CLI-REFERENCE.md`, `docs/OPERATOR-GUIDE.md` and `docs/HTTP-API.md` are updated.
- The new client settings are listed where settings are documented: `OPENLDR_URL`,
  `OPENLDR_KEY`, `OPENLDR_KEY_FILE`, `OPENLDR_ALLOW_PLAIN_HTTP`. So is any new server
  setting, on the seven pages `packages/config/src/env-docs.test.ts` checks.
- All of it in en, fr and pt.

## 7. Slices

Each slice lands with its tests and leaves `main` working. Until slice 7, every command
still runs as it does today.

1. Access keys in the server: the table, the check at sign-in, the shared logic, the
   routes, `user create --no-password`.
2. Access keys in Studio, with phone layout.
3. The command list: the kind of every command, the capability of every through-the-app
   command, the file and folder marks, the new capability keys with their labels, and the
   tests that no command is undecided. `openldr commands --json`.
4. Running a command in the server: the endpoint, the check, the process, arguments
   through a pipe, the caller passed to the audit actor, files, the stream, interrupts,
   the limit on commands at once, the version check.
5. The client: the request, the stream, files, the credential order, the plain-HTTP
   refusal, Ctrl+C. `openldr login`, `logout` and `whoami`.
6. `openldr user key list`, `create` and `revoke`.
7. The switch. Through-the-app commands lose direct access. The recovery list keeps it.
   `--actor` and `--approved-by` are refused through the app. The Docker wrapper, the
   standalone `cli` command, and the scripts in 6.8.
8. Docs in en, fr and pt. The changelog after the merge.
9. A real run, written up as proof.

Slice 4 starts with a short proof, before anything is built on it: one command run as a
process the server starts, with its arguments through a pipe, its output streamed, and an
interrupt passed on. If that proof fails, stop and report.

## 8. Verification

Say which layer each test proves.

- **Keys.** Route tests pin the wire shape. Tests cover a revoked key, an expired key, a
  key of a disabled account, a key sent in the URL, and a role change taking effect on the
  next request. pg-mem is not Postgres, so the real run repeats the main cases.
- **Output stays the same.** The command code does not change, so the 651 CLI tests keep
  proving its behaviour. A process the server starts needs a real database, which the
  unit tests do not have. So the comparison is part of the real run: one read command
  from every group, through the app and directly, on the same data.
- **The capability map.** The tests in 6.4 and 6.6. A second test checks that a caller
  without the capability gets 403 and that no process was started.
- **No direct access.** A test runs a through-the-app command with the database settings
  present and the server unreachable. It must fail with a connection message and must not
  touch the database.
- **The real run** (slice 9), on the standalone tier and on a server from a checkout with
  scratch databases:
  - An account with a narrow role and a key. An allowed command works. A forbidden one
    answers 403. The audit log shows the account and the key's name.
  - `login`, a command, `logout`, then the same command refused.
  - The environment of the client process holds no database URL and no secrets key.
  - The process list on the server, while a command with a secret argument runs, does not
    show the secret.
  - A command with an input file, one with an input folder and one with an output file. A
    large file, with the memory of the server and the client measured.
  - Ctrl+C during `import start`: it stops at a page and can be resumed.
  - More commands at once than the limit: the extra ones wait, then run.
  - A recovery command with the server stopped, on the checkout server.
  - A search of the server log, the Postgres log and the audit rows for the key, the
    password, the session value and a secret argument. Every count must be 0.
  - An AI given only a key, the server address and the `openldr` command. It must be able
    to find a command from `openldr commands --json` and run it.
  - The time one small command takes through the app, beside a direct run.

HONEST NON-PROOF items the builder must state, not hide:

- Windows and macOS.
- Keys on a Keycloak install, unless the builder can prove them against a scratch database
  without touching the dev stack's own databases.
- The Docker wrapper asking for the password on the host and handing the credential in. It
  needs a built image. If the builder cannot run one safely, say so.
- A person closing the terminal in the middle of a long command.

## 9. Left to the builder

- Names of files, functions, the table and its columns, and the endpoint's path.
- The key's exact format and length, within "long, random, fixed prefix, only a hash
  stored".
- How the stream is framed and how files travel in it, within "streamed, not held whole in
  memory, not re-encoded by compression".
- How the server passes the arguments and the caller to the process it starts, within "not
  on the command line" and "a direct run cannot claim to be an account".
- Where the session file lives on each OS, within "the user's config folder, owner-only".
- How the Docker wrapper hands a credential to the client in the container, within "never
  stored in the container".
- Which existing capability manages keys, and the names of the new capability keys.
- How many commands run at once, how long one waits, and how long an interrupted process
  gets before it is killed. Each has a default that suits a small machine.
- The size limit for an upload, and its setting if one is needed.
- The wording of every message, within the unslop rules.

## 10. Calls I made for the operator to check

These are mine. Any of them can be overturned.

1. The server runs each command as its own process, not inside itself. The command code
   does not change. Each command costs a process, as it does today.
2. A third kind of command runs on the caller's machine with no sign-in, because it
   touches no database. The plugin author tools are in it.
3. The recovery list is the ten commands in 6.7. A reviewer found three I had missed:
   `health`, `target-store test` and `storage copy`. `db reproject` is not on it.
4. A key carries its account's whole role. No narrower scope per key.
5. Only people who can manage users can make or revoke keys.
6. A key has no expiry unless one is set.
7. `openldr login` works with local sign-in only. Keycloak and OIDC installs use keys.
8. No `--key` option. A key comes from the environment or a file.
9. The client refuses plain HTTP to another machine unless a setting allows it.
10. `--actor` and `--approved-by` are refused through the app. The signed-in account is
    used. This is a new error for a script that passes them today.
11. Ctrl+C and a lost connection interrupt the command, as closing a terminal does today.
12. The server runs a small number of commands at once and makes the rest wait.
13. The client and the server must be the same release.
14. New capability keys go to `lab_admin` only.
15. `user create` gains `--no-password`.
16. `--json` for the 68 commands that lack it is not part of this.
17. Development needs no key, because the dev server's bypass already lets a request in.
18. A standalone install gets no new way to run recovery commands while its launcher is
    stopped. See section 11.

## 11. Noticed, not fixed

- **Standalone recovery with the launcher stopped.** `openldr-standalone cli` refuses when
  no launcher runs (`apps/standalone/src/commands.ts:634`), and a failed start stops
  Postgres too. So `doctor` and `db migrate` cannot help a standalone install whose server
  will not start. This gap is in design B, not this one. Closing it needs a way to start
  the bundled Postgres alone.
- 68 commands have no `--json`.
- Two ontology routes accept a token in the URL's `access_token` parameter
  (`apps/server/src/auth-plugin.ts:33` to `:40`). Keys are not accepted there. Tokens
  still are.
- Someone who can manage users can already give a role to any account, and so can make a
  key for a stronger account than their own. That is how role assignment works today. Keys
  do not make it worse, but they make it easier to use unattended.
- A server-side `pg` connection has no `error` listener, so a dead Postgres ends the
  server through the crash handler. Found in design B. Still open.
- `export` builds its whole result in memory (`packages/cli/src/export.ts:34`). It keeps
  doing so in its own process, so it cannot take the server down.
- On a Docker host the wrapper needs the right to run `docker compose exec`, which is as
  strong as the database password. A client that runs outside the container would avoid
  that. This design does not package one.
