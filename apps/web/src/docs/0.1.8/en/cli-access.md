# CLI sign-in and access keys

Most `openldr` commands now go through the running OpenLDR server, the same way Studio does. You sign in first, as a person with `openldr login` or as a program with an access key. The server checks that your account may run the command, runs it, and records it in the audit log under your account.

This page shows how to sign in, how to make and revoke access keys, and how to give an AI agent or a script its own narrow access. The [CLI reference](/docs/cli) lists the commands themselves.

The examples on this page were run on Linux against a standalone install. Windows and macOS were not tested. A line marked "Not run" comes from reading the code. Nobody has run it by hand.

## Three kinds of command

Every command has a kind.

| Kind | Where it runs | Sign-in |
| --- | --- | --- |
| `app` | In the running server. Almost every command. | Needed. |
| `recovery` | On the machine that runs OpenLDR, straight on the database. | None. The machine's database settings are the permission. |
| `local` | On your own machine. It touches no database and no server. | None. `login`, `logout` and `whoami` talk only to the server's sign-in. |

To see the kind of every command, run:

```sh
openldr commands
```

The first lines of the output:

```text
artifact build                     local
artifact keygen                    local
artifact new                       local                  scaffold plugin|form|report
artifact pack                      local
artifact publish                   app       destructive
artifact sign                      local
artifact test                      local
audit list                         app
```

`openldr commands --json` prints the same list as JSON, for a program to read. Each entry has `path`, `description`, `arguments`, `options`, `kind`, `capability`, `alsoRequires` and `destructive`. This is one entry, without its description, arguments and options:

```json
{
  "path": "user key create",
  "kind": "app",
  "capability": "users.manage",
  "alsoRequires": [],
  "destructive": false
}
```

`capability` is the permission the account needs. `alsoRequires` lists any further permissions it needs too. `destructive` is true when the command removes stored data, overwrites it with no way back, or cuts off access, such as a revoke. It is about data stored in OpenLDR, not about files on your own disk.

## Recovery commands

Ten commands work on the database itself and need no sign-in. They are for setting up an install and for getting back in when nobody can sign in.

| Command | What it is for |
| --- | --- |
| `auth rebind-issuer` | Bind the database to a moved identity provider address. |
| `auth setup-code` | Print a code for creating the first administrator. |
| `db migrate` | Bring the database schema up to date. |
| `db reset` | Drop and recreate the schema. |
| `db seed` | Add the default definitions. |
| `doctor` | Run the setup checks. |
| `health` | Check the services. |
| `storage copy` | Copy files from another S3 store. |
| `target-store test` | Check the analytics database connection. |
| `user reset-password` | Set a temporary password, for an administrator who is locked out. |

Run them on the machine that runs OpenLDR, where the database settings are:

- Docker install: `./openldr` in the install folder. It runs them inside the `api` container.
- Standalone install: `openldr-standalone cli`. See [Run without Docker](/docs/standalone).
- Source checkout: `pnpm openldr`, which reads the checkout's `.env`.

Anywhere else, a recovery command stops before it does anything:

```text
This command works on the database itself. Run it on the machine that runs OpenLDR.
```

## Sign in as a person

This works on installs that use OpenLDR's own sign-in (`AUTH_ADAPTER=local`). On a Keycloak or OIDC install, use an access key instead. There `openldr login` answers `This install signs in through another service. Use an access key: set OPENLDR_KEY.`

```sh
openldr login
```

The CLI asks for your username, then your password. It does not show the password as you type. Then it prints:

```text
Signed in to http://localhost:3991 as admin.
```

Check who you are signed in as:

```sh
openldr whoami
```

```text
Username: admin
Roles: lab_admin
Signed in with: session
```

`openldr whoami --json` prints the same as one JSON line.

A script cannot type at a prompt. It passes the password on standard input with `--password-stdin`, which needs `--username`:

```sh
openldr login --username admin --password-stdin < password.txt
```

There is no `--password` option, because other users on the machine can read command lines.

`openldr logout` ends the session on the server and removes it from your machine.

`login`, `whoami` and `logout` give up when the server takes the connection and sends no answer for 30 seconds. They then print `Cannot reach OpenLDR at <address>: ETIMEDOUT.`

The session is kept in a file only you can read:

| Computer | Session file |
| --- | --- |
| Linux | `~/.config/openldr/session.json`, or `$XDG_CONFIG_HOME/openldr/session.json` |
| macOS, untested | `~/Library/Application Support/OpenLDR/session.json` |
| Windows, untested | `%APPDATA%\OpenLDR\session.json` |

On Linux the folder is mode 700 and the file mode 600. The CLI refuses a session file that other users can read. The file never holds your password.

A session ends after 12 hours without use, or 7 days after you signed in. Then sign in again.

A session belongs to one server address. `http://localhost:3000` and `http://127.0.0.1:3000` are two addresses, so a session made on one is not used for the other.

## Access keys

An access key lets a program act as one account with no person present. It starts with `oldr_`. Keep it as you would keep a password.

You need the `users.manage` permission to make, list or revoke keys. You can do it in Studio, under **Users**, in the row menu of the account. See **Users** in the studio's Docs. You can also do it with the CLI:

```sh
openldr user key create ai-reader --name claude-test --expires 2026-12-31
```

The key is printed once, alone on standard output. A notice goes to standard error:

```text
oldr_<the new key>
made key 6afa1ead-1382-4cd1-a07e-d233c907fa2b (claude-test) for ai-reader. It cannot be shown again, so store it now.
```

Standard error also holds a JSON log line from the server, as it does for every command sent through the app. "What is different through the app", below, says more.

So a script can keep the key in a file and never show it on screen. The `umask` makes the file readable only by you from the moment it is made:

```sh
(umask 077; openldr user key create ai-reader --name claude-test --expires 2026-12-31 > ai-reader.key)
```

`--expires` takes a date or an ISO date-time ending in `Z` or an offset. A bare date, such as `2026-12-31`, means the end of that day in UTC. In Studio, a chosen date means the end of that day in your browser's time zone. With no expiry, the key works until you revoke it.

List an account's keys. The key itself is never shown again, only its first characters:

```sh
openldr user key list ai-reader
```

```text
6afa1ead-1382-4cd1-a07e-d233c907fa2b	claude-test	oldr_rutK97w	2026-11-13T09:16:46.097Z	2026-12-31T23:59:59.999Z	2026-11-13T09:16:49.894Z	-
```

The columns are the key ID, the name, the first characters, when it was made, when it expires, when it was last used, and when it was revoked.

"Last used" changes when a program presents the key, at most once a minute. It changes even when the server then refuses the call because the account is disabled.

Revoke a key with its ID. Without `--force` it refuses and says what would happen:

```sh
openldr user key revoke ai-reader 6afa1ead-1382-4cd1-a07e-d233c907fa2b --force
```

```text
revoked key 6afa1ead-1382-4cd1-a07e-d233c907fa2b for ai-reader
```

A program that uses the key is refused from its next call. A command that is already running keeps running to its end. The same holds when you disable the account. Not run. Revoking cannot be undone. Make a new key instead.

`user key revoke` takes the key ID, never the key. A value that is not a key ID is refused, and it is not printed back:

```text
user key revoke refused: that is not a key ID. Find the ID with "openldr user key list".
```

A key pasted in the ID's place gets `user key revoke refused: that is a key, not a key ID. Find the ID with "openldr user key list".`

A username that holds `oldr_` is refused the same way by `user key list`, `create` and `revoke`, for example `user key list refused: that looks like a key, not a username. Give the account's username.`

A key name may not hold a tab, a line break or another control character: `user key create refused: name holds a control character, such as a tab or a line break`.

## Give an AI agent access

Give an AI agent, or any script, its own account and its own key. Then you can see what it did, and cut it off without touching anyone else.

1. Make an account with no password, so nobody can sign in to Studio with it, and give it the narrowest role that does the job:

   ```sh
   openldr user create --username ai-reader --name "AI reader" --role data_analyst --no-password
   ```

   ```text
   created ai-reader (50b32c3a-13a3-438e-a2f6-4eb0afbaf719)
   ai-reader has no password and cannot sign in to Studio.
   ```

   `--no-password` is for OpenLDR's own sign-in. On Keycloak or OIDC, see that section below. If no role fits, make one on the **Roles** page with only the permissions the agent needs.

2. Make a key for it, in Studio or with `openldr user key create`. Give it an expiry date.

3. Give the agent the key and the server address. Put the key in a file only the agent's user can read, and point `OPENLDR_KEY_FILE` at it. Set `OPENLDR_URL` when the server is not on the same machine.

4. Let the agent check its access. These commands are safe to run first:

   ```sh
   openldr whoami
   openldr commands --json
   ```

   ```text
   Username: ai-reader
   Roles: data_analyst
   Signed in with: key (claude-test)
   ```

5. Revoke the key when the work is done.

What the agent can do with the key:

- Run the commands its role's permissions allow, and nothing else. Any other command answers `This account lacks the capability <name>.`
- List every command, its kind and the permission it needs, with `openldr commands --json`.

What it cannot do with the key alone:

- Run a recovery command. Those need the database settings, not a key. This holds only while the agent has no shell on the OpenLDR machine with Docker or the database settings. See "What this does not protect against", below.
- Record its work under another name. `--actor` and `--approved-by` are refused.
- Hide what it ran through the app. Every command it runs through the app is in the audit log, with the account, the key's name and the command. The arguments are not recorded. A `local` command, such as `artifact build`, is not audited.

## Which server and which credential

The CLI sends a command to this address, in this order:

1. `--server-url <address>`, before or after the command.
2. `OPENLDR_URL`.
3. `http://127.0.0.1:3000`.

It signs in with the first of these that is set:

1. `OPENLDR_KEY`, the key itself.
2. `OPENLDR_KEY_FILE`, a file that holds the key.
3. The session from `openldr login`.
4. Nothing. An `app` command then answers `Sign in first: openldr login, or set OPENLDR_KEY.`

There is no `--key` option, because other users can read command lines. A key variable that is set but empty stops the command. It does not fall back to your session:

```text
OPENLDR_KEY is set but empty. Set it, or unset it.
```

The CLI refuses to send a command over plain HTTP to another machine. Plain HTTP to `localhost`, `127.0.0.1` or `[::1]` is allowed:

```text
Refusing to send a credential over plain HTTP to 10.0.0.5. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.
```

Use `https`. Set `OPENLDR_ALLOW_PLAIN_HTTP=true` only on a network you trust, such as Tailscale. The refusal also covers a command with no key, because arguments and uploaded files can hold patient data.

| Setting | What it does |
| --- | --- |
| `OPENLDR_URL` | The server address. |
| `OPENLDR_KEY` | An access key. |
| `OPENLDR_KEY_FILE` | A file that holds an access key. The file is read on the machine where you type the command. |
| `OPENLDR_ALLOW_PLAIN_HTTP` | `true` or `1` allows plain HTTP to another machine. |

## What is different through the app

These used to work and now give an error. A script may meet them.

- `--actor` and `--approved-by` are refused before anything is sent: `--actor cannot be used through the app. The signed-in account is recorded.` and `--approved-by cannot be used through the app. The signed-in account is recorded.` The audit log records the account that signed in.
- `audit list --actor <id>` cannot be used. The CLI reads that `--actor` as the refused one. This is a known fault. Filter with `audit list --json` and your own tool instead.
- `sync export` needs `--out <file>`. So does `report run --format pdf`.
- The client and the server must be the same release: `This client is version 0.0.1 and OpenLDR is version 0.1.11. Use the same release on both.`
- A file you name is sent to the server, and a file the command writes comes back to you. So paths are paths on your machine. On a Docker install they are still inside the container. Keep them under `data/` as before.
- A folder you name is sent with everything in it. A link to a folder inside it stops the command: `<path> is a link to a folder. A link to a folder is not sent.` A link to a file inside the folder is followed. A link that points outside the folder stops the command: `<path> is a link that points outside <folder>.` An empty folder inside it is not sent. Not run for the empty folder.
- A file that changes while it is being sent stops the command. Send it again. Not run.
- A program that runs the CLI and reads nothing of its output for 5 minutes loses the command. The server stops it. Not run.
- Ctrl+C stops the command on the server too. A command that does not stop is killed after 10 seconds. Not run.
- If the server stops while a command runs, the CLI prints `OpenLDR stopped while this command was running.` on standard error. The exit code is 130, or 137 when the command had to be killed. Not run.
- Every command sent through the app prints a JSON log line from the server on standard error. On an install with no sync it is one line, with `"msg":"sync disabled (not configured)"`. Standard output stays clean, so `--json` output still parses. A script that treats any standard error output as a failure will fail.

## Who can run what

A command needs the permission that the matching Studio action needs. `openldr commands --json` shows it for each command. Three cases surprise people:

- `patients list`, `patients show` and `patients duplicates list` need `patients.view_identifiers`. An analyst or auditor who sees masked patients in Studio cannot list patients from the CLI, even without `--identifiers`.
- `import start` and `import resume` need both `connectors.manage` and `ingest.run`. Studio lets only the lab administrator role run imports, by name. The CLI checks the two permissions instead. It does not check a plugin's own required roles.
- `import status` and `import failures` can show a row key from the source system. That key can be a lab number.

To change what a key or a signed-in person may do, change the account's roles with `openldr user assign-role <subject> <role>` and `openldr user unassign-role <subject> <role>`. On OpenLDR's own sign-in, the subject is the account's ID. The change counts from the account's next request. `openldr user set-role` does not change what a key or a signed-in person may do, so use the two commands above.

## The audit log

Each command run through the app leaves one `cli.run` row. It holds the account, the command, the exit code, and that it came through the CLI. When a key was used, it also holds the key's name. The command's arguments are never recorded.

```sh
openldr audit list --action cli.run --json
```

One row, without its IDs and its time:

```json
{
  "actorType": "user",
  "actorName": "ai-reader",
  "action": "cli.run",
  "entityType": "cli_command",
  "entityId": "report list",
  "metadata": {
    "origin": { "via": "cli", "keyName": "claude-test" },
    "exitCode": 0,
    "interrupted": false
  }
}
```

A command that changes something, such as `user create`, also writes its own audit row as before. That row now names the signed-in account. Making and revoking a key write `access_key.create` and `access_key.revoke`. The key itself is never in the audit log.

## Limits the server sets

| Setting | Default | What it does |
| --- | --- | --- |
| `CLI_MAX_RUNNING` | `2` | Commands that run at once. Others wait up to 30 seconds, then get `OpenLDR is running other commands. Try again shortly.` |
| `CLI_MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | The most file bytes one command may send. |
| `CLI_ENTRY` | found beside the server | The CLI file the server starts. Set it only when the CLI sits somewhere else. |

When `CLI_MAX_RUNNING` is more than 1, one account may run at most one fewer than that at once. So one account cannot take every slot. With the default of 2, one account runs one command at a time, and its second command waits. Not run.

The server writes uploads under `TERMINOLOGY_WORK_DIR`, or the system temp folder when that is unset. A command's uploads are removed when it ends. If the server is killed during a command, what is left is removed at the next start, once it is more than 24 hours old. Not run. `terminology ontology build` keeps its folder in `cli-kept`, so that `terminology ontology rebuild` can read it again. The clean-up at start does not touch `cli-kept`. Each successful build leaves one more copy there.

On a Docker install, if you use `terminology ontology build` through the app, set `TERMINOLOGY_WORK_DIR` to a folder that survives the container being recreated. Otherwise `terminology ontology rebuild` fails after an upgrade. The folder must be on a Docker volume or a mount, and the `api` container's user must be able to write to it. This was not tested.

A Docker install puts the gateway, an nginx proxy, in front of the server. A CLI on another machine that sends its commands to the gateway's address meets two more limits. The gateway refuses a request of more than 50 MiB (`client_max_body_size 50m`), so a bigger upload fails there. It also cuts off a command that sends no output for 120 seconds (`proxy_read_timeout 120s`). The `./openldr` wrapper does not go through the gateway, so neither limit applies to it. Not run.

[Environment variables](/docs/environment) lists every setting.

## Docker installs

The `./openldr` wrapper in the install folder runs the CLI inside the `api` container. The CLI there talks to the server in the same container, so you set no address.

Nothing in this section was run. It comes from reading the wrapper that `install/install.sh` writes.

- `OPENLDR_KEY`, when set, is handed in for each call.
- `OPENLDR_KEY_FILE` is read on the host, not in the container. Point it at a file on the host. The wrapper hands the key in as `OPENLDR_KEY`, so a refused key from a key file is reported as `OpenLDR refused the access key from OPENLDR_KEY. It is revoked, expired or wrong.`
- `./openldr login` asks for the password on the host. It keeps the session in a file of its own for that install folder, under `~/.config/openldr/docker/`. Nothing is stored in the container.
- Renaming or moving the install folder signs you out of the wrapper. Sign in again.
- A link to `./openldr` from another folder, such as one on your `PATH`, works. It runs the install it points to, with that install's session. A plain copy of the wrapper in another folder stops with `This script must stay in its install folder, or be a link to it. <folder> has no .env or no docker-compose.yml.`
- A bad `OPENLDR_KEY_FILE`, or a stored session the wrapper cannot use, stops every command, recovery commands too. The message names the setting or the file. Unset the setting, or remove the file and sign in again.
- On Windows, `.\openldr.ps1` signs in with a key only. Set `OPENLDR_KEY`. `login` and `OPENLDR_KEY_FILE` are refused there. A copy of `openldr.ps1` outside its install folder stops with the same message as the copied wrapper above. When it cannot find its own folder, it stops with `Cannot find the folder this script is in, so the install it belongs to is not known.` This is unproven: it was not run on Windows.

An install made before this change has the old wrapper. With it, every command that goes through the app answers `Sign in first: openldr login, or set OPENLDR_KEY.` Replace the wrapper after the images are on the new release. [Planned upgrades](/docs/upgrading) has the command.

## Run without Docker

`openldr-standalone cli` points the CLI at the launcher's own address, unless you set `OPENLDR_URL` or pass `--server-url`. It gives the database settings only to a recovery command. Any other command goes through the running server, so sign in first:

```sh
pnpm openldr-standalone cli -- login
pnpm openldr-standalone cli -- whoami
```

The password prompt through the launcher was not run. `login --username <name> --password-stdin` was.

A launcher started with `--host` on another address is still this computer, so plain HTTP to it is allowed for these calls. [Run without Docker](/docs/standalone) has the rest.

## Keycloak and OIDC installs

`openldr login` does not work here. Use access keys. Keys on these installs were not tested against a real identity provider.

- Make the AI's account in Studio, or in the identity provider. Give it its roles in Studio. Roles set only in Keycloak reach OpenLDR when the person signs in with a token, and an account that only uses a key never does.
- Studio can make a key for an account that has never signed in. The CLI cannot. `openldr user key create` finds only accounts OpenLDR already knows.
- Disabling an account only in the identity provider's own console does not stop its keys. Disable it in Studio or with `openldr user deactivate`, or revoke the key.

## What this does not protect against

Sign-in and permissions limit a person or program that holds only a key or a session. They do not limit these:

- On a Docker host, anyone who may run `docker compose exec` can already reach the database.
- Anyone who holds the database settings can start the CLI the way the server does, with no sign-in.
- With `AUTH_DEV_BYPASS=true`, anyone who can reach the port can run any command. Use it only on an isolated development machine.

## Messages you may see

| Message | What it means |
| --- | --- |
| `Sign in first: openldr login, or set OPENLDR_KEY.` | No key and no session was found. Sign in, or set a key. |
| `OpenLDR refused the access key from OPENLDR_KEY. It is revoked, expired or wrong.` | The key in `OPENLDR_KEY` no longer works. Make a new key. |
| `OpenLDR refused the access key from OPENLDR_KEY_FILE. It is revoked, expired or wrong.` | The key in that file no longer works. Make a new key. |
| `Your session has ended. Sign in again: openldr login.` | The session is past its limit, or the server ended it. |
| `This account lacks the capability <name>.` | The account's roles do not include that permission. |
| `account disabled` | The account behind the key or session is disabled. `whoami` prints the same. |
| `Cannot reach OpenLDR at <address>: ETIMEDOUT.` | `login`, `whoami` or `logout` got no answer in 30 seconds. |
| `OpenLDR stopped while this command was running.` | The server stopped during the command. Run it again once the server is back. |
| `This client is version <a> and OpenLDR is version <b>. Use the same release on both.` | Update the CLI or the server so both are the same release. |
| `OpenLDR is running other commands. Try again shortly.` | `CLI_MAX_RUNNING` commands are already running. |
| `This command works on the database itself. Run it on the machine that runs OpenLDR.` | A recovery command was run where there are no database settings. |
| `Refusing to send a credential over plain HTTP to <host>. ...` | Use https, or set `OPENLDR_ALLOW_PLAIN_HTTP=true` on a trusted network. |
| `The key file named by OPENLDR_KEY_FILE cannot be read: <file>` | Check the path and the file's owner. |
| `--actor cannot be used through the app. The signed-in account is recorded.` | Remove `--actor`. |
| `--approved-by cannot be used through the app. The signed-in account is recorded.` | Remove `--approved-by`. |
| `Through the app, sync export needs --out <file>.` | Add `--out`. |
| `user key revoke refused: that is not a key ID. Find the ID with "openldr user key list".` | Give the key ID from `user key list`, not the key. |
| `<command> refused: that looks like a key, not a username. Give the account's username.` | A key was typed where the username goes. |
| `no user has that name. Usernames here match exactly, including case.` | No account has that username. The value is not printed because it holds `oldr_`. |
| `user key create refused: name holds a control character, such as a tab or a line break` | Give the key a name without tabs or line breaks. |

## Related guides

- [CLI reference](/docs/cli)
- [Planned upgrades](/docs/upgrading)
- [Run without Docker](/docs/standalone)
- [Authentication providers](/docs/auth-providers)
- [Environment variables](/docs/environment)
