# Run without Docker

Run OpenLDR on one computer that has no Docker. One command starts a Postgres 16 database that ships with OpenLDR, then the OpenLDR server. All your data stays in one folder. This suits a person who wants to try OpenLDR, or a small lab with one computer.

Only Linux has been tested. macOS and Windows may work, but nobody has checked them yet.

You run it from a copy of the source code that you build on your own computer. There is no installer yet. The launcher is the `openldr-standalone` command, and its messages use that name. In a source checkout that command is not on your PATH. Put `pnpm` in front of it and run it from the checkout's root folder, for example `pnpm openldr-standalone start`.

## What you need

- Git, Node.js 22.13 or later, and pnpm. The checkout pins pnpm 11.22.0. [Development](/docs/development) shows how to install them.
- No Docker and no database. Postgres comes with the dependencies.
- Network access for the first `pnpm install`. It downloads the Postgres program files, about 59 MB on Linux.

## Build it

Run every command on this page from the checkout's root folder, where `package.json` is.

When a launcher command ends with an exit code other than 0, pnpm adds a line of its own. It does the same when you press Ctrl+C. That line starts with `[ELIFECYCLE]`, such as `[ELIFECYCLE] Command failed.` It comes from pnpm. It is not an OpenLDR error.

### 1. Get the source code

```sh
git clone https://github.com/Open-Laboratory-Data-Repository/openldr.git ~/Downloads/openldr_ce
cd ~/Downloads/openldr_ce
```

### 2. Install the dependencies

```sh
pnpm install --frozen-lockfile
```

This also downloads Postgres 16.15 from the npm package `embedded-postgres`. The checkout pins its exact version, `16.15.0-beta.19`, so every install gets the same Postgres.

### 3. Build Studio and the launcher

```sh
pnpm --filter @openldr/studio build
pnpm --filter @openldr/standalone build
```

Build both again each time you pull new code. The next start then updates the database. If Studio was not built, `start` stops with `The studio is not built. Run: pnpm --filter @openldr/studio build`.

## Start OpenLDR

### 1. Start it

```sh
pnpm openldr-standalone start
```

The first start looks like this:

```text
$ node apps/standalone/dist/index.js start
(node:12345) ExperimentalWarning: WASI is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[seed] created default connector "Target Warehouse (Postgres)"
[seed] imported 672 FHIR R4 value set(s) (0 already present)
No administrator exists yet. Open the address and enter this setup code: XXXX-XXXX-XXXX
The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code
OpenLDR is running at http://localhost:3000/studio/
Server log: /home/you/.local/share/openldr/logs/server.log
```

The first line comes from pnpm. Node then warns about WASI, a feature plugins use. You can ignore that warning. The two `[seed]` lines appear until a start has finished them. That is usually the first start. If the first start was cut off, the next start prints the ones still to do. They add the standard FHIR value sets and a connector to the analytics database. OpenLDR starts with no sample data.

Keep this terminal open. OpenLDR runs only while this command runs.

### 2. Create the first administrator

Open `http://localhost:3000/studio/` in a browser on this computer. Studio shows **Create the administrator**. Enter the setup code from your terminal, then choose a username and a password. [Install](/docs/install) shows each screen under **Create the first administrator**.

The code works for 30 minutes. Each start prints a new code until an administrator exists. For a new code while OpenLDR runs, open a second terminal in the checkout and run:

```sh
pnpm openldr-standalone cli -- auth setup-code
```

The setup code goes to the terminal only. The launcher never writes it to a log file.

### 3. Choose other options if you need them

| Option | Default | What it does |
| --- | --- | --- |
| `--data-dir <folder>` | See the next section | The folder that holds all of this install's data. |
| `--port <port>` | `3000` | The web port. If another program uses it, `start` stops with `Port 3000 is already in use. Choose another with --port.` It never picks another port by itself. |
| `--host <address>` | `127.0.0.1` | The address OpenLDR listens on. The default lets only this computer in. See **Open it to a phone or another computer** below. |

Give `--data-dir` a full path. pnpm runs the launcher from the checkout's root folder. A short path such as `mydata` then points into the checkout, not into the folder your terminal is in.

## Where the data folder is

| Computer | Default data folder |
| --- | --- |
| Linux | `~/.local/share/openldr`. If `XDG_DATA_HOME` holds a full path, `$XDG_DATA_HOME/openldr` instead. |
| macOS, untested | `~/Library/Application Support/OpenLDR` |
| Windows, untested | `%LOCALAPPDATA%\OpenLDR` |

Set `OPENLDR_HOME` in the shell to use another folder. Give it a full path too. `--data-dir` wins over both. If you started with `--data-dir`, give `stop`, `status` and `cli` the same folder. Without it they look in the default folder. `stop` and `status` then print `OpenLDR is not running.`, and `cli` prints `Start OpenLDR first: openldr-standalone start`.

The folder holds:

| Path | What it holds |
| --- | --- |
| `postgres/` | The database. |
| `blobs/` | Stored files, such as uploads. |
| `logs/` | `server.log` and `postgres.log`. |
| `crash/` | Notes written when the server or a plugin crashes. |
| `work/` | Scratch files, such as a terminology download while it is imported. |
| `standalone.json` | The secrets key, the two database passwords and the database port. |
| `standalone.lock` | Exists while a launcher runs. It names that launcher's process and address. It can stay behind after a crash or a hard kill. The next `start` replaces it. |

On Linux only your user can open the folder. The launcher sets the folder to mode 700 and the two files to mode 600. The database listens on `127.0.0.1` only. Its port is chosen at the first start, 54320 if that one is free, and is kept in `standalone.json`.

## Check, stop and restart

### 1. Check whether it runs

```sh
pnpm openldr-standalone status
```

```text
Data folder: /home/you/.local/share/openldr
OpenLDR is running at http://localhost:3000/studio/
```

`status` exits with code 0 when OpenLDR runs and 3 when it does not. When it does not run, you see `OpenLDR is not running.`, then pnpm's line `[ELIFECYCLE] Command failed with exit code 3.`

### 2. Stop it

From a second terminal:

```sh
pnpm openldr-standalone stop
```

```text
Stopped.
```

If the server is still busy after 60 seconds, Postgres stops anyway. `stop` then prints this line instead, after about a minute:

```text
Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.
```

Both end with exit code 0. `stop` asks the running launcher to stop through a small port open only on this computer. It sends no signal to a process number. If nothing runs, it prints `OpenLDR is not running.`

You can also press Ctrl+C in the terminal where `start` runs. Closing that terminal window is a normal stop too. Each way stops the server first, then Postgres. The `start` terminal prints the same `Stopped.` line, or the 60-second line above.

To skip the 60-second wait, pause a moment, then press Ctrl+C again. After a Ctrl+C, the launcher ignores further presses for a second and a half. It does this because pnpm and the shell can pass the same signal on a second time. A third Ctrl+C, again after a moment, ends the launcher at once with exit code 1. Postgres is still told to stop as the launcher exits. Closing the terminal never skips the wait.

### 3. Start it again after a power cut or a crash

Run `pnpm openldr-standalone start` again. If a launcher was killed, `start` first replaces its old lock. If that launcher left its Postgres running, `start` logs in to the database to check that this Postgres belongs to this folder. It then stops that Postgres and starts as usual. You see the normal start lines and nothing else.

We tested this by killing the launcher on Linux. A real power cut has not been tested.

### 4. Run one launcher per folder

A second `start` on the same folder is refused:

```text
OpenLDR is already running (process 12345) at http://localhost:3000/studio/.
```

To run two installs at once, give each its own `--data-dir` and its own `--port`.

## Run CLI commands

The `openldr` CLI works through the launcher, and OpenLDR must be running. `cli` points the CLI at the launcher's own address, unless you set `OPENLDR_URL` or pass `--server-url`. It gives the database settings only to a recovery command, such as `doctor` below. Every other command goes through the running server, so sign in first:

```sh
pnpm openldr-standalone cli -- login
```

[CLI sign-in and access keys](/docs/cli-access) explains signing in, access keys and the recovery commands. A recovery command needs no sign-in:

```sh
pnpm openldr-standalone cli -- doctor
```

```text
PASS  Services
WARN  Sign-in
      No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.
PASS  Secrets key
WARN  Laboratory name
      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.
WARN  Time zone
      No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.
PASS  Connectors: 1 of 1
SKIP  Sync with central
SKIP  Facilities in the data

3 warnings.
```

Above these lines you also see pnpm's line, Node's WASI warning and one log line. When OpenLDR is not running, a recovery command such as `doctor` starts the database for itself. It prints `OpenLDR is not running. Starting its database for this command.`, runs, and stops the database again. So you can repair an install that will not start. Any other command prints `Start OpenLDR first: openldr-standalone start`.

- The `--` is optional. `cli doctor` runs the same command.
- `--data-dir` goes before the `--`, for example `pnpm openldr-standalone cli --data-dir /srv/openldr -- doctor`.
- When a CLI message tells you to run an `openldr` command, run it through the launcher. `openldr auth setup-code` becomes `pnpm openldr-standalone cli -- auth setup-code`.
- `sync export` needs `--out`. A relative path is taken from the checkout's root folder, so give `--out` a full path.

`pnpm openldr` in a checkout is not the same. For a recovery command it reads the checkout's own `.env` file and connects to the databases named there. It sends every other command to `OPENLDR_URL`, by default `http://127.0.0.1:3000`. Use `pnpm openldr-standalone cli` instead, so each command reaches this install. [CLI reference](/docs/cli) lists every command.

## Change a setting

The launcher reads no `.env` file. It sets these settings itself, and they always win over the shell:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `TZ` | `UTC` |
| `OPENLDR_SKIP_ENV_FILE` | `true` |
| `PORT` | The `--port` value |
| `LISTEN_HOST` | The `--host` value |
| `ROOT_REDIRECT_TO_STUDIO` | `true` |
| `LOG_LEVEL` | `info` |
| `LOG_FILE` | `logs/server.log` in the data folder |
| `AUTH_ADAPTER` | `local` |
| `AUTH_DEV_BYPASS` | `false` |
| `BLOB_ADAPTER` | `fs` |
| `BLOB_DIR` | `blobs/` in the data folder |
| `EVENTING_ADAPTER` | `pg` |
| `TARGET_STORE_ADAPTER` | `pg` |
| `INTERNAL_DATABASE_URL`, `TARGET_DATABASE_URL` | The bundled Postgres |
| `MIGRATE_ON_START` | `true` |
| `SEED_ON_START` | `false` |
| `SECRETS_ENCRYPTION_KEY` | The key in `standalone.json` |
| `PLUGIN_CRASH_LOG_DIR` | `crash/` in the data folder |
| `TERMINOLOGY_WORK_DIR` | `work/` in the data folder |
| `WEB_DIST_DIR` | The Studio build in the checkout |
| `APP_VERSION` | The launcher's version |
| `CLI_ENTRY` | `dist/cli.js` in the launcher's folder |

So `LOG_LEVEL` stays `info`, and you cannot change it.

Set any other setting in the shell before `start`. For example, this blocks every plugin network call:

```sh
PLUGIN_EGRESS_ENABLED=false pnpm openldr-standalone start
```

A setting given this way applies only to that one command. If a CLI command needs it too, put it in front of that `cli` command as well. [Environment variables](/docs/environment) lists them all.

The launcher removes settings for parts a standalone install does not have. It ignores `OIDC_*`, `KEYCLOAK_*`, `S3_*`, `MSSQL_*`, `MYSQL_*`, `IDENTITY_ADMIN_ADAPTER`, `AUTH_DEV_USERNAME` and `AUTH_DEV_ROLES`.

## Open it to a phone or another computer

By default only this computer can open OpenLDR. To let a phone on the same network or on Tailscale in, start with the address of this computer on that network:

```sh
pnpm openldr-standalone start --host 100.64.0.10
```

```text
OpenLDR is running at http://100.64.0.10:3000/studio/
Server log: /home/you/.local/share/openldr/logs/server.log
Listening on 100.64.0.10. Sign-in travels over plain HTTP on this network.
```

Replace `100.64.0.10` with your computer's private or Tailscale address. Open the printed address on the phone. `--host 0.0.0.0` listens on every address this computer has. The launcher then prints `http://localhost:3000/studio/`, which works on this computer only. On the phone, use the computer's own address instead.

Over plain HTTP, the browser turns off a feature Studio uses, so some screens can fail. Plugin pages and dashboard editing are among them. This happens on the phone, and also on this computer when you open the `--host` address. These screens work when you open Studio at `http://localhost:3000/studio/` on the computer that runs OpenLDR. That address answers when you start without `--host`, or with `--host localhost`, `0.0.0.0`, `::1` or `::`.

The last line is a warning. A standalone install has no TLS. Usernames, passwords and patient data cross the network unencrypted. Anyone who can watch that network can read them. Use it only on a network you trust. Tailscale encrypts traffic between your own devices. Never open the port to the internet. Your firewall may need to allow the port.

## Back up and restore

A backup is a copy of the whole data folder, made while OpenLDR is stopped. A copy of a running database may not open.

```sh
pnpm openldr-standalone stop
cp -a ~/.local/share/openldr /media/backup/openldr-2026-11-13
```

Keep `standalone.json` with the rest. Without it, the launcher refuses to start on that database. Without the key it holds, the secrets stored in the database cannot be read.

The copy holds patient data. It also holds the state file, `standalone.json`, with the database administrator password and the key for stored secrets. Keep the copy in a folder that only your user can open. A FAT or exFAT drive does not keep the folder's permissions. Anyone who can read that drive can read the copy.

To restore, stop OpenLDR, put the copied folder back where it was, and start again. You can also start with `--data-dir` pointing at the copy.

## Limits

- No TLS. OpenLDR serves plain HTTP.
- No installer yet. You run it from a built source checkout.
- Postgres only. The bundled Postgres holds both databases. SQL Server and MySQL cannot be the analytics database.
- One launcher per data folder.
- Only Linux has been tested. Windows and macOS are untested.
- Sync to a central server that uses a self-signed certificate is not supported.
- Over plain HTTP, some Studio screens need an address the browser treats as local: `localhost` or `127.0.0.1`. Plugin pages and dashboard editing are among them. At any other address they can fail. `http://localhost:3000/studio/` answers when you start without `--host`, or with `--host localhost`, `0.0.0.0`, `::1` or `::`.
- The bundled Postgres cannot be upgraded to a new major version. The data folder works with Postgres 16 only.
- Backup means stop, then copy the folder. There is no backup tool.
- The server log and the Postgres log are not rotated. They grow until you delete them while OpenLDR is stopped.
- You cannot move data between a standalone install and a Docker install.
- It does not start with the computer. It runs only while `start` runs in a terminal.

## Messages that need you

| Message | What to do |
| --- | --- |
| `Port 3000 is already in use. Choose another with --port.` | Stop the other program on that port, or start with another `--port`. |
| `Port 54320 on 127.0.0.1 is in use by another program. This install's database always uses port 54320. Free that port, then start again.` | Stop the program that took the database port. The port is fixed per data folder. |
| `A Postgres for <folder> is running as process <n> but does not accept this install's login. Stop that process, then start again.` | A Postgres that this install did not start uses its database folder. Stop it, then start again. |
| `The state file <file> is missing, but a database already exists in <folder>.` | Restore `standalone.json` from your backup. Do not delete the database to get past this. |
| `Could not confirm that OpenLDR stopped: ...` | Run `status`. If it still runs, press Ctrl+C in its terminal. |
| `The database is recovering after an unclean stop. This can take a few minutes.` | Wait. The start goes on by itself once Postgres has finished its repair. |
| `WORKFLOW_FILE_ACCESS_ROOT must not be the OpenLDR data folder, hold it, or sit inside it.` | Set `WORKFLOW_FILE_ACCESS_ROOT` to a folder outside the data folder, then start again. |
| `OpenLDR stopped after an error. See <path>.` | The launcher has stopped. The server log holds the reason. Run `start` again. |
| `The database stopped by itself. OpenLDR has stopped. See <path>.` | The launcher has stopped. The Postgres log holds the reason. Run `start` again. |

If the database stops while OpenLDR runs, OpenLDR stops too. Either of the last two lines can be the one you see.

## Related guides

- [Getting started](/docs/getting-started)
- [Install](/docs/install)
- [Environment variables](/docs/environment)
- [CLI reference](/docs/cli)
- [Development](/docs/development)
