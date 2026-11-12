# Standalone run: design

Status: DRAFT for operator review. No code written.
Date: 2026-11-12.
Relates to: `2026-11-12-local-sign-in-design.md` (design A, merged as `1506c67e`).

## 1. What this is and why

OpenLDR CE needs Docker to run. A server tier install starts Postgres, Garage, and
optionally Keycloak as containers. Design A removed the need for Keycloak. This design
removes the need for the other two, so OpenLDR can start from one command on a machine
with no Docker.

This is the standalone tier from the operator's three tiers:

| Tier | Database | Files | Sign-in |
|---|---|---|---|
| Standalone | Bundled Postgres | Folder on disk | Local |
| Server | Postgres in Docker | Garage | Local by default, Keycloak optional |
| Heavy | Several databases | Not decided | Keycloak or a ministry login |

The core is the same in all three. Only the parts behind ports change.

This is design B of four. A is local sign-in, and it is done. C is the CLI going through
the app. D is the Electron app with onboarding. D needs this design. D will wrap what B
builds in a window.

The user action that is broken today: nobody can run OpenLDR without Docker. A person who
wants to try it, or a small lab with one machine, has to install and run three containers
first.

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| File storage needs an S3 service | CONFIRMED | `BLOB_ADAPTER` accepts only `minio` (`packages/config/src/schema.ts:44`), and five `S3_*` settings are required (`schema.ts:72` to `76`) |
| Storage is built in one place | REFUTED | Three places build the S3 client directly: `packages/bootstrap/src/index.ts:686`, `packages/bootstrap/src/ingest-context.ts:54`, `packages/bootstrap/src/s3-config.ts:17` |
| The app needs presigned URLs | REFUTED | `presign` is defined in `packages/adapter-s3-bucket/src/index.ts:77` and nothing calls it |
| The server needs Postgres in Docker | REFUTED | It needs a Postgres URL. A spike on 2026-11-12 ran all 141 migrations, booted the server and loaded sample data on Postgres 16.15 binaries from npm, with no code change |
| The server can be started from another program | CONFIRMED gap | `main()` in `apps/server/src/index.ts` runs on import (`index.ts:190`) and is not exported. It installs its own signal handlers (`index.ts:183`) |
| The server can listen on the local machine only | CONFIRMED gap | The address is fixed: `host: '0.0.0.0'` (`apps/server/src/index.ts:187`) |
| The server cannot serve the studio | REFUTED | It serves the built studio under `/studio/` (`apps/server/src/app.ts:236` to `238`) |
| Sign-in needs Keycloak | REFUTED | Design A added `AUTH_ADAPTER=local` |

Spike numbers from 2026-11-12, on Linux, for reference:

| Measure | Bundled Postgres 16.15 |
|---|---|
| First start, including `initdb` | 0.5 s |
| All migrations | 1.6 s |
| Memory with the server connected | 42 MB |
| Package size, unpacked | Linux 55 MB, Windows 97 MB, macOS 293 MB |

The same spike ruled out PGlite served over a port. It returned wrong rows under parallel
transactions and used 655 MB.

## 3. Goals, non-goals, anti-goals

Goals:

- One command starts OpenLDR on a machine with no Docker, and one command stops it.
- All data lives in one folder. Copying that folder while stopped is a full backup.
- It starts empty, like a real install. The first person sets up the administrator.
- It listens on the local machine only, unless the operator says otherwise.
- A crash or a hard kill does not leave it unable to start again.
- The `openldr` CLI works against it.

Non-goals:

- Installers, a single-file binary, or a signed package. Design D packages it.
- Running as a Windows service or a systemd unit.
- TLS. The standalone tier serves plain HTTP on the local machine.
- Backup and restore tooling beyond "copy the folder while stopped".
- Moving a standalone install's data to a server tier install, or back.
- Upgrading the bundled Postgres to a new major version.
- SQL Server or MySQL as the target store. Standalone uses Postgres for both databases.
  Connectors to outside SQL Server and MySQL sources still work, because they are plain
  network clients.
- Sync to a central that uses a self-signed certificate. The Docker tier trusts one
  through `NODE_EXTRA_CA_CERTS`, which Node reads only when the process starts.
- Two launchers on one data folder.
- PGlite.

Anti-goals. Any of these makes the work a failure even if it runs:

- A branch on "standalone" inside the core packages. Only config values and adapters
  differ between tiers.
- A change in behaviour for the Docker tiers. Their defaults stay as they are, and their
  images do not grow.
- A data folder other users of the machine can read.
- A database login that can run commands on the host. See 5.4.
- Sample data loaded without being asked. The operator decided on 2026-11-12 that it
  starts empty.

## 4. Constraints

- `BlobStoragePort` does not change (`packages/ports/src/blob.ts:4`).
- The bundled Postgres is version 16, the same major version as the Docker tiers
  (`postgres:16-alpine`). Pin the exact version.
- No change to any existing default. Every new setting defaults to today's behaviour.
- pnpm blocks install scripts unless a package is allowed. The allowed list is
  `allowBuilds` in `pnpm-workspace.yaml`. The Postgres binaries need their script, to
  create symlinks, and it lives on the per-OS packages. Each one needs an entry.
- Both Docker image builds copy the whole repo and install the whole workspace
  (`apps/server/Dockerfile`). A new dependency must not end up in a shipped image. The
  builder checks the image contents and, if the binaries would land in one, filters the
  new app out of that install.
- The launcher cannot run under the `tsx` command. Plugin worker threads would inherit
  the loader and crash. The comment in `apps/server/dev.mjs` explains why.
- Only Linux can be tested on the build machine. Say so for every Windows and macOS claim.
- The repo has no CI. The local gate is the only check.
- AGENTS.md section 6 for the five places a feature lands. Docs in en, fr and pt.

## 5. How it works

### 5.1 File storage on disk

A new adapter package, `packages/adapter-fs-bucket`, fills `BlobStoragePort` with files
under one folder.

- `BLOB_ADAPTER` gains the value `fs`. A new setting, `BLOB_DIR`, names the folder. It is
  required when the adapter is `fs`.
- The five `S3_*` settings become required only when the adapter is `minio`.
- One function in `@openldr/bootstrap` picks the adapter from config. The three places
  that build the S3 client today call it instead.
- A key such as `ingest/<id>` becomes a file path under `<BLOB_DIR>/objects/`. The adapter
  refuses a key with an empty part, a `.` or `..` part, a backslash, a NUL, or a leading
  slash. Nothing outside the folder can be read or written through it.
- A write goes to a temporary file in the same folder, is flushed, and is then renamed
  over the target. A reader never sees half a file, and a crash leaves either the old
  file or the new one.
- `putStream` and `getStream` stream. They never hold a whole large file in memory.
- `delete` of a missing key succeeds, as S3 does.
- `presign` throws a typed "not supported" error. Nothing calls it.
- `healthCheck` writes and deletes a small probe file.
- The content type is not stored. The port never returns it.
- `openldr storage copy` moves objects between two S3 buckets. Under `fs` it refuses with
  a one-line message.

### 5.2 Settings added to the core

Each one is generic, and each defaults to today's behaviour.

| Setting | Default | What it does |
|---|---|---|
| `LISTEN_HOST` | `0.0.0.0` | The address the server listens on. Today it is fixed |
| `ROOT_REDIRECT_TO_STUDIO` | off | `GET /` redirects to `/studio/`. Today `/` answers 404, because the landing site owns it in the Docker tiers |
| `LOG_FILE` | unset | When set, the server log goes to this file instead of standard output |

`LOG_FILE` exists because the server logs JSON lines to standard output
(`packages/core/src/logger.ts:63`). In a terminal that buries the setup code and the
address. The launcher sets it to a file in the data folder.

### 5.3 A server that another program can start

`apps/server` gains a start function. It takes a config object and returns a handle with
a `close()` that runs the existing shutdown.

- The existing entry file keeps reading config, the crash handlers, the crash-loop guard
  and the signal handlers. It calls the new function. The Docker tiers see no change.
- The launcher calls the same function in its own process. It owns the signals and the
  order of shutdown.
- The start function does not call `process.exit`.

Some code reads the environment directly, outside the config object: `NODE_ENV`
(`apps/server/src/app.ts:65`), `LOG_LEVEL` (`packages/core/src/logger.ts:45`),
`APP_VERSION` (`apps/server/src/version.ts:11`), `WEB_DIST_DIR`
(`apps/server/src/app.ts:236`), and a few others. This design does not move those reads.
The launcher sets those keys in its own environment before it loads the server.

The launcher builds its config by passing a copy of that environment to `loadConfig`.
It must not call `loadConfig()` with no argument. That form loads the nearest `.env` file
(`packages/config/src/load.ts:30`), which in a checkout is the developer's own.

Two more things the launcher must match, because the Docker image does:

- The bundled terminology files are found next to the running bundle
  (`packages/db/src/bundled-terminology.ts:14`). The Docker build copies them there. The
  launcher's build must copy them too, or first start imports no value sets and only logs
  a warning.
- The Docker containers run in UTC. The launcher sets `TZ=UTC` for its own process, so
  dates behave the same in every tier.

Crashes: the server's crash handlers write a marker file and then exit the process
(`packages/core/src/crash-log.ts:185`). The launcher installs the same handlers, pointed
at the data folder. It does not use the crash-loop guard, because nothing restarts a
launcher.

### 5.4 Bundled Postgres

The launcher starts real Postgres 16 as a child process, from binaries shipped as an npm
package (`embedded-postgres`, with one platform package per OS).

- The cluster lives in `<data>/postgres`. `initdb` runs only when that folder has no
  `PG_VERSION` file. The spike showed `initdb` fails on a folder that is not empty.
- `initdb` is given UTF-8 encoding and the `C` locale, and Postgres is started with its
  time zone set to UTC. These cannot be changed later without a dump and restore, and the
  host's own locale would make sort order and dates differ from the Docker tiers.
- Postgres listens on `127.0.0.1` only.
- The port is picked on first start and never moves by itself. If it is taken on a later
  start, `start` fails with a message that names the port. The reason: first boot writes
  the database address into the default connector row and later boots never update it
  (`packages/bootstrap/src/seed.ts:599`). A port that moved would break every report.
- The server does not connect as the superuser. On first start the launcher creates an
  ordinary role that owns the two databases, and the server and the default connector use
  that role. The reason: a superuser can run host commands and read host files through
  SQL, and report queries are written by users. In Docker that reaches only the
  container. Here it would reach the operator's own account. No migration creates an
  extension, so an ordinary role should be enough. Slice 6 proves it.
- Both passwords are random, made on first start, and kept in the state file (5.5).
- Two databases are created on first start: one internal, one target.
- A leftover Postgres is handled at start. The spike showed Postgres keeps running when
  its parent is hard-killed. Before starting, the launcher reads
  `<data>/postgres/postmaster.pid`. If that process is alive, the launcher stops it with a
  fast shutdown and waits for it to exit. Then it starts Postgres fresh.
- The launcher also registers a last-moment exit hook that tells Postgres to shut down.
  It covers the paths where the process exits without running the normal stop, such as a
  crash handler.
- Postgres output goes to a log file in `<data>/logs`.

### 5.5 The launcher

A new app, `apps/standalone`, with the command `openldr-standalone`.

| Command | What it does |
|---|---|
| `start` | Starts Postgres and the server in the foreground. Ctrl+C stops both |
| `stop` | Asks a running launcher on the same data folder to stop, and waits |
| `status` | Says whether it is running, on which address, and where the data folder is |
| `cli -- <args>` | Runs the `openldr` CLI against this install. See 5.6 |

`start` takes `--data-dir`, `--port` (default 3000) and `--host` (default `127.0.0.1`).

The data folder defaults to the usual per-user place for the OS:
`~/.local/share/openldr` on Linux, `~/Library/Application Support/OpenLDR` on macOS, and
`%LOCALAPPDATA%\OpenLDR` on Windows. `OPENLDR_HOME` overrides it.

Layout:

| Path | Holds |
|---|---|
| `postgres/` | The database cluster |
| `blobs/` | Stored files |
| `logs/` | Server, Postgres and launcher logs |
| `crash/` | Plugin crash markers |
| `standalone.json` | The secrets key, the two database passwords and the port. Owner-only |
| `standalone.lock` | The running launcher's process ID, HTTP address and start time |

The folder and the state file are created owner-only (mode 0700 and 0600 on Linux and
macOS).

What `start` does, in order:

1. Resolve the data folder and create it.
2. Refuse if `standalone.lock` names a live launcher. Say its process ID and address.
   Remove a lock whose process is gone.
3. Load `standalone.json`, or create it with a new secrets key and database passwords.
4. Handle a leftover Postgres, then start Postgres (5.4).
5. Set the environment and build the config: local sign-in, file storage, both database
   URLs, Postgres for the target store, migrate on start, no sample data,
   `NODE_ENV=production`, the listen address, the root redirect on, the log file, and the
   paths above.
6. Start the server with the function from 5.3.
7. If the install still needs its first administrator, make a setup code in-process and
   print it.
8. Print the address, `http://localhost:<port>/studio/`, and where the server log is.

If the HTTP port is taken, `start` fails with a message that names the port and the
`--port` flag. It does not pick another one, so the address stays predictable.

If any step fails, the launcher stops whatever it started, in reverse order, and exits
with a non-zero code.

Stopping: the launcher closes the server first, then stops Postgres. Closing the server
waits for the event worker's current batch, with no limit of its own
(`packages/adapter-event-bus/src/index.ts:240`). The launcher waits up to 60 seconds,
then stops Postgres anyway and says it did. A second Ctrl+C skips the wait. `stop`
reports whether the stop was clean or forced. Events cut off this way are retried after
their five-minute lease, as they are in Docker.

`--host 0.0.0.0` is allowed, for a phone on the same network or Tailscale. The launcher
prints a warning that sign-in then travels over plain HTTP.

### 5.6 The CLI

`openldr-standalone cli -- <args>` runs the `openldr` CLI with this install's settings
passed in its environment. For example:

```bash
openldr-standalone cli -- doctor
```

The CLI itself does not change. Settings passed in the environment win over any `.env`
file, because the loader never overrides a variable that is already set
(`packages/config/src/load.ts:32`).

A plain `pnpm openldr` in a checkout does not reach a standalone install. It runs from
the repo root and reads the developer's own `.env`. The docs must say so.

The CLI needs the launcher to be running, because it connects to the bundled Postgres.
When it is not, the command says so.

Design C will later send the CLI through the running app. Nothing here blocks that.

### 5.7 What ships and what does not

The standalone tier runs the server, the studio, and Postgres. It does not run Keycloak,
Garage, the nginx gateway, or the public landing site.

B is run from a built checkout of the repo: build, then `openldr-standalone start`.
Packaging it for people who do not have the repo is design D.

## 6. Slices

Each slice lands with its tests and leaves `main` working.

1. File storage adapter, the `BLOB_ADAPTER` and `BLOB_DIR` settings, and the one function
   that picks the adapter.
2. `LISTEN_HOST`, the root redirect, `LOG_FILE`, and the server start function.
3. The Postgres runner: first start with its `initdb` settings and the ordinary role,
   restart, the leftover handling, the exit hook, and stop.
4. The launcher: `start`, `stop`, `status`, `cli`, the state and lock files, the
   environment and config, the crash handlers, the stop timeout, and the setup code.
5. Docs in en, fr and pt: a web page on running without Docker, and the tiers. The
   changelog after the merge.
6. A real run on a fresh data folder, written up as proof.

## 7. Verification

Say which layer each test proves.

- The file adapter is tested against a real temporary folder, not a mock. Tests cover a
  key that tries to leave the folder, two writers on one key, a large stream, and a
  reader during a write.
- Existing Docker-tier tests must stay green with no change. That is the proof the
  defaults did not move. The server image is built and its contents compared, to prove
  the Postgres binaries did not land in it.
- The Postgres runner needs real binaries. Its tests start a real Postgres in a temporary
  folder. They are skipped unless an environment variable turns them on, so the normal
  gate does not start database servers.
- Slice 6 is a real run, not a test. On a fresh folder: start, set up the administrator,
  sign in, load the sample data through `cli`, check the value sets were imported, stop,
  start again and find the data. Then hard-kill the launcher and start again. Then make a
  plugin crash and confirm Postgres stops. It also proves two security points: all
  migrations run under the ordinary role, and a report query that tries to run a host
  command or read a host file is refused.

HONEST NON-PROOF items the builder must state, not hide:

- Windows and macOS. Only Linux exists on the build machine. Postgres on Windows is known
  to refuse an administrator token when started directly, and whether the npm package
  avoids that is unknown. The exit hook is also harder there, because Windows has no
  matching signal.
- Antivirus software holding the binaries or the data folder.
- A machine where the per-user data folder sits on a network drive.

## 8. Left to the builder

- File and function names, and the exact shape of `standalone.json` and the lock file.
- How `stop` reaches the running launcher: a signal to the recorded process, or a small
  local endpoint.
- The Postgres port the launcher tries first.
- The wording of every message, within the unslop rules.
- How the build bundles `apps/standalone`, within these limits: the Postgres binaries are
  not bundled into a single file, the four packages `apps/server/tsup.config.ts` keeps
  external stay external, and the terminology files travel with the bundle.

## 9. Calls I made for the operator to check

These are mine. Any of them can be overturned.

1. Postgres binaries come from the npm package `embedded-postgres`. It is tagged beta and
   is one more outside product. Every developer install will download them: about 55 MB
   on Linux and 293 MB on macOS. The other choice is to fetch and keep the binaries
   ourselves.
2. The launcher is a new app, not a subcommand of the `openldr` CLI. The CLI does not
   depend on the server today, and this keeps it that way.
3. B runs from a built checkout. No installer.
4. The CLI reaches a standalone install through `openldr-standalone cli`, not through a
   `.env` file in the data folder.
5. Neither port moves by itself. A taken port fails with a clear message.
6. The server connects to Postgres as an ordinary role, not the superuser.
7. Three small generic settings are added to the core: `LISTEN_HOST`,
   `ROOT_REDIRECT_TO_STUDIO` and `LOG_FILE`.
8. The launcher runs in UTC and creates the database in the `C` locale.
9. A stop waits 60 seconds for work in flight, then forces.
10. Local machine only by default, with `--host` to open it up.
11. No sample data on first start. The onboarding in design D can offer it.
12. `presign` is not built for file storage.

## 10. Noticed, not fixed

- Keys are used as file paths. Windows has reserved names and ignores case. Keys today
  are built from IDs, so this is not reachable, but nothing enforces it.
- The server's start-up does many "best effort" steps that log and continue
  (`apps/server/src/index.ts:79` onward). A standalone user sees only the terminal, so a
  swallowed warning there is easy to miss.
- The third-party image policy (`packages/release/src/third-party-files.ts`) covers
  Docker images only. The Postgres binaries from npm are a new kind of outside
  dependency that the policy does not track.
- The Docker tiers connect to Postgres as a superuser too (`docker-compose.prod.yml:73`).
  There it reaches only the container, but a report query can still read any file inside
  it.
- The server reads several settings straight from the environment, outside the config
  schema. This design works around that. It does not fix it.
