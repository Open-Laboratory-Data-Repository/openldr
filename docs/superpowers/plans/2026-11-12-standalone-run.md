# Standalone run implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start OpenLDR CE from one command on a machine with no Docker, with bundled Postgres, files on disk, and the local sign-in that already exists.

**Architecture:** A new adapter stores files in a folder behind the existing `BlobStoragePort`. The server gains a start function another program can call. A new app, `apps/standalone`, starts real Postgres 16 from npm-shipped binaries as a child process, builds the server's config in memory, and runs the server in its own process. Nothing in the core branches on "standalone": only config values and adapters differ.

**Tech stack:** TypeScript, Node, Fastify, Kysely on Postgres, pino, tsup, vitest, the npm package `embedded-postgres`.

**Spec:** `docs/superpowers/specs/2026-11-12-standalone-run-design.md`. Read it first. This plan argues from it.

## Global constraints

- `BlobStoragePort` does not change (`packages/ports/src/blob.ts:4`). If a task seems to need a port change, stop and report.
- No branch on "standalone" inside `packages/*` or `apps/server`. New behaviour there is a generic setting with a default equal to today's behaviour.
- The Docker tiers must not change: every existing default stays, every existing test stays green untouched, and no shipped image gains the Postgres binaries.
- New settings and their defaults: `BLOB_ADAPTER` gains `fs` (default stays `minio`). `BLOB_DIR` (required when `fs`). `LISTEN_HOST` (default `0.0.0.0`). `ROOT_REDIRECT_TO_STUDIO` (default off). `LOG_FILE` (default unset).
- Postgres: major version 16, exact version pinned. `initdb` with `--encoding=UTF8 --locale=C`. Started with `listen_addresses=127.0.0.1`, `timezone=UTC`, `log_timezone=UTC`. The server connects as an ordinary role, never the superuser.
- The launcher process runs with `TZ=UTC` and `NODE_ENV=production`.
- Fixed values: default HTTP port 3000, default host `127.0.0.1`, stop waits 60 seconds before forcing, a leftover Postgres gets 30 seconds to exit.
- The data folder is created with mode 0700 and the state file with mode 0600 on Linux and macOS.
- Never write a password, key or setup code to a log file. The setup code goes to the terminal only.
- Never call `loadConfig()` with no argument from the launcher. It loads the nearest `.env`.
- The launcher cannot run under the `tsx` command. Use a built bundle, or the `register()` form `apps/server/dev.mjs` uses.
- Only Linux can be tested here. Mark every Windows and macOS claim as unproven.
- All prose follows the `unslop` skill. No em dashes. Docs land in en, fr and pt.
- One commit per task. No `Co-Authored-By` trailer. Do not push.
- `packages/config/src/env-docs.test.ts` fails when a setting the server reads is not documented. Each task that adds a setting documents it where that test looks.
- Full gate, at the end, never piped through `tail`:
  `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`, plus `pnpm depcruise`.

## Review focus

Five conditions the spec implies and a person will hit. Each has a test in the task named.

1. A data folder whose path has spaces and non-ASCII letters, as a Windows user name often does. Postgres starts and both database URLs work. Task 5.
2. A start while a Postgres from a hard-killed launcher is still running. The new start succeeds and the data is intact. Tasks 5 and 10.
3. The HTTP port is taken. `start` fails with a message naming the port, exits non-zero, and leaves no Postgres running. Tasks 8 and 10.
4. A storage key that tries to leave the folder, or is not a usable path. It is refused and nothing is written outside. Task 1.
5. A state file that is damaged. `start` refuses with a message naming the file. It never makes new secrets over it, because a new secrets key would make stored secrets unreadable. Task 6.

## File map

| File | Responsibility |
|---|---|
| `packages/adapter-fs-bucket/src/index.ts` | `BlobStoragePort` over a folder |
| `packages/config/src/schema.ts` | The new settings and their rules |
| `packages/bootstrap/src/s3-config.ts` | The one function that picks the storage adapter |
| `packages/core/src/logger.ts` | `LOG_FILE` |
| `apps/server/src/start.ts` | `startServer`, callable from another program |
| `apps/server/src/index.ts` | The Docker-tier entry: config, crash handlers, signals |
| `apps/standalone/src/state.ts` | Data folder, state file, lock file |
| `apps/standalone/src/postgres.ts` | Start, stop and leftover handling for bundled Postgres |
| `apps/standalone/src/environment.ts` | The environment and config a standalone server runs with |
| `apps/standalone/src/commands.ts` | `start`, `stop`, `status`, `cli` |
| `apps/standalone/src/index.ts` | Argument parsing and the process entry |

---

### Task 1: File storage adapter

**Files:**
- Create: `packages/adapter-fs-bucket/package.json`, `tsconfig.json`, `src/index.ts`
- Test: `packages/adapter-fs-bucket/src/index.test.ts`

Copy `packages/adapter-s3-bucket/package.json` and `tsconfig.json` for shape. Dependencies: `@openldr/core`, `@openldr/ports` only.

**Interfaces:**
- Produces:

```ts
export interface FsBucketConfig { dir: string }
export class BlobKeyError extends Error {}
export class BlobPresignUnsupportedError extends Error {}
export function createFsBucket(cfg: FsBucketConfig): BlobStoragePort;
```

Rules the signature does not settle:

- Objects live under `<dir>/objects/`. Temporary files live under `<dir>/tmp/`, on the same file system, so a rename is atomic.
- A key is split on `/`. It is refused with `BlobKeyError` when it is empty, starts with `/`, contains a backslash or a NUL, has an empty part, has a part equal to `.` or `..`, or has a part longer than 255 bytes. After joining, the resolved path must still sit inside `<dir>/objects/`.
- `put` and `putStream` write to a uniquely named file in `tmp/`, flush it to disk, then rename it over the target, creating parent folders as needed. On any failure the temporary file is removed.
- `get` of a missing key rejects. `exists` returns false. `delete` of a missing key resolves.
- `getStream` returns a file read stream. It rejects for a missing key before returning a stream.
- `presign` throws `BlobPresignUnsupportedError`.
- `healthCheck` uses `probe` from `@openldr/core`: write a small file in `tmp/`, delete it, and report `file storage ready`.
- The content type argument is ignored.

- [ ] **Step 1: Write the failing tests**, each against a real folder from `mkdtemp`.

```ts
it('stores and reads back bytes and text', async () => {});
it('reads a missing key as a rejection, exists as false, delete as success', async () => {});
it('refuses keys that leave the folder or are not usable paths', async () => {
  for (const key of ['', '/abs', 'a/../b', '..', 'a//b', 'a/./b', 'a\\b', 'a\0b', 'x'.repeat(256)]) {
    await expect(bucket.put(key, 'x')).rejects.toBeInstanceOf(BlobKeyError);
    await expect(bucket.get(key)).rejects.toBeInstanceOf(BlobKeyError);
    await expect(bucket.delete(key)).rejects.toBeInstanceOf(BlobKeyError);
  }
  expect(await listEverythingUnder(dir)).toEqual([]); // nothing was written anywhere
});
it('writes nothing outside the folder', async () => { /* put 'ok/key', then walk the parent of dir: only dir changed */ });
it('streams a 64 MiB object in and out without holding it in memory', async () => {
  // putStream from a generator of 1 MiB chunks, getStream to a hash; hashes match;
  // process.memoryUsage().arrayBuffers grows by less than 16 MiB during the run
});
it('lets a reader see the old object or the new one, never a partial one', async () => {
  // write A (1 MiB of 'a'); start putStream of B (8 MiB of 'b') held half way; get() returns all 'a'; finish; get() returns all 'b'
});
it('keeps one whole object when two writers race on a key', async () => { /* Promise.all two puts of different bodies; result equals one of them exactly */ });
it('removes its temporary file when a stream fails part way', async () => { /* failing Readable; tmp/ is empty after */ });
it('overwrites an existing key', async () => {});
it('creates the folders it needs under an empty dir', async () => {});
it('reports health as up, and as down when the folder is not writable', async () => { /* chmod 0500, expect status 'down'; skip the second half when running as root */ });
it('does not support presign', async () => {
  await expect(bucket.presign('a')).rejects.toBeInstanceOf(BlobPresignUnsupportedError);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/adapter-fs-bucket exec vitest run`
Expected: FAIL, module not found. Run `pnpm install` first so the new package is linked.

- [ ] **Step 3: Implement `src/index.ts`**

- [ ] **Step 4: Run and confirm pass, then typecheck the package**

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-fs-bucket pnpm-lock.yaml
git commit -m "feat(storage): file storage adapter on a local folder"
```

---

### Task 2: Storage settings and one place that picks the adapter

**Files:**
- Modify: `packages/config/src/schema.ts:44` and `:72-76`, and the `superRefine` block
- Modify: `packages/bootstrap/src/s3-config.ts`, `packages/bootstrap/src/index.ts:686`, `packages/bootstrap/src/ingest-context.ts:54`, `packages/bootstrap/package.json`
- Modify: `packages/cli/src/storage.ts:52`
- Test: `packages/config/src/schema.test.ts`, a new `packages/bootstrap/src/s3-config.test.ts`, `packages/cli/src/storage.test.ts` if it exists

**Interfaces:**
- Consumes: `createFsBucket` (Task 1).
- Produces: `BLOB_ADAPTER: 'minio' | 'fs'`, `BLOB_DIR?: string`. The five `S3_*` settings become optional in the object and required by `superRefine` when the adapter is `minio`.
- Produces: `createBlobFromConfig(cfg: Config): BlobStoragePort` in `s3-config.ts` picks by `cfg.BLOB_ADAPTER`. It already exists and is used by `terminology-context.ts:93`. The two other sites call it instead of building the S3 client themselves.
- `toS3BucketConfig(cfg)` throws `Error('S3 settings are not set: BLOB_ADAPTER is fs')` under `fs`.

- [ ] **Step 1: Write the failing tests**

```ts
// schema.test.ts
it('keeps minio as the default and still requires the S3 settings', () => {
  expect(parse(base).BLOB_ADAPTER).toBe('minio');
  const { S3_ENDPOINT: _drop, ...rest } = base;
  expect(() => parse(rest)).toThrow(/S3_ENDPOINT/);
});
it('accepts file storage with a folder and no S3 settings', () => {
  const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, ...rest } = base;
  expect(parse({ ...rest, BLOB_ADAPTER: 'fs', BLOB_DIR: '/tmp/x' }).BLOB_DIR).toBe('/tmp/x');
});
it('refuses file storage with no folder', () => {
  expect(() => parse({ ...base, BLOB_ADAPTER: 'fs' })).toThrow(/BLOB_DIR/);
});
// s3-config.test.ts
it('builds the file adapter under fs', async () => {
  const blob = createBlobFromConfig({ ...cfg, BLOB_ADAPTER: 'fs', BLOB_DIR: tmp });
  await blob.put('a/b', 'x');
  expect(new TextDecoder().decode(await blob.get('a/b'))).toBe('x');
});
it('builds the S3 adapter under minio', () => { /* does not throw, healthCheck is a function */ });
```

Add a CLI test that `openldr storage copy` under `fs` exits 1 with `storage copy works between two S3 buckets. This install stores files in a folder.` and calls nothing.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/config exec vitest run src/schema.test.ts` and `pnpm --filter @openldr/bootstrap exec vitest run src/s3-config.test.ts`

- [ ] **Step 3: Implement.** Document `BLOB_DIR` and the new `BLOB_ADAPTER` value wherever `env-docs.test.ts` requires.

- [ ] **Step 4: Run the config, bootstrap and cli suites and their typechecks**

Expected: PASS, with no existing test changed.

- [ ] **Step 5: Commit**

```bash
git add packages/config packages/bootstrap packages/cli apps docs pnpm-lock.yaml
git commit -m "feat(config): choose file storage with BLOB_ADAPTER=fs"
```

---

### Task 3: Listen address, root redirect and log file

**Files:**
- Modify: `packages/config/src/schema.ts`, `packages/core/src/logger.ts:42-66`, `apps/server/src/index.ts:187`, `apps/server/src/app.ts` near `:236`
- Test: `packages/config/src/schema.test.ts`, `packages/core/src/logger.test.ts`, `apps/server/src/app.test.ts`

**Interfaces:**
- Produces: `LISTEN_HOST: string` (default `'0.0.0.0'`), `ROOT_REDIRECT_TO_STUDIO: boolean` (default false, parsed with the schema's existing `envBoolean`), `LOG_FILE?: string`.
- `createLogger` keeps its signature. When `process.env.LOG_FILE` is set, it writes to that file in append mode and creates the parent folder. Standard output gets nothing. When unset, behaviour is exactly as today, including the existing `logFd === 2` path.
- `buildApp` registers `GET /` only when `ctx.cfg.ROOT_REDIRECT_TO_STUDIO` is true. It answers 302 with `Location: /studio/`.
- The entry file listens on `cfg.LISTEN_HOST`.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults LISTEN_HOST to all interfaces and the redirect to off', () => {
  const cfg = parse(base);
  expect(cfg.LISTEN_HOST).toBe('0.0.0.0'); expect(cfg.ROOT_REDIRECT_TO_STUDIO).toBe(false);
});
it('writes log lines to LOG_FILE and nothing to standard output', async () => {
  // set LOG_FILE to a temp path, createLogger().info('hello'), flush; file contains "hello"; a stdout spy saw nothing
});
it('logs to standard output when LOG_FILE is unset', async () => {});
it('answers 404 at / by default', async () => {});
it('redirects / to /studio/ when the setting is on', async () => {
  const r = await app.inject({ method: 'GET', url: '/' });
  expect(r.statusCode).toBe(302); expect(r.headers.location).toBe('/studio/');
});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement.** The handler must return what it sends. Document the three settings where `env-docs.test.ts` requires.
- [ ] **Step 4: Run the config, core and server suites, server lint, and typechecks**
- [ ] **Step 5: Commit**

```bash
git add packages/config packages/core apps/server apps docs
git commit -m "feat(server): settings for the listen address, root redirect and log file"
```

---

### Task 4: A server another program can start

**Files:**
- Create: `apps/server/src/start.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/package.json` (add the export `"./start": "./src/start.ts"`)
- Test: `apps/server/src/start.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RunningServer {
  /** For example http://127.0.0.1:3000 */
  address: string;
  context: AppContext;
  /** Runs the existing shutdown. Safe to call twice. */
  close(): Promise<void>;
}
export function startServer(cfg: Config, logger: Logger): Promise<RunningServer>;
```

`startServer` holds everything `main()` does today from the `MIGRATE_ON_START` block (`index.ts:48`) through `app.listen`. It listens on `cfg.LISTEN_HOST`. It never calls `process.exit` and never installs signal or crash handlers. If any step throws after resources were opened, it closes what it opened before rethrowing.

`index.ts` keeps, in this order: `loadConfig()`, the bypass warning, the two crash handlers, the crash-loop guard, then `startServer`, then the `SIGTERM` and `SIGINT` handlers that call `close()` and set `process.exitCode`, as today. The comments about the facility queues move with the code they describe.

- [ ] **Step 1: Write the failing test**

`startServer` needs a database, so its own test is thin and the proof is the real boot in Step 5.

```ts
it('exports startServer and does not run it on import', async () => {
  const listen = vi.spyOn(Fastify.prototype, 'listen'); // or the equivalent seam in this code base
  const mod = await import('./start');
  expect(typeof mod.startServer).toBe('function');
  expect(listen).not.toHaveBeenCalled();
});
it('installs no signal handlers on import', async () => {
  const before = process.listenerCount('SIGTERM');
  await import('./start');
  expect(process.listenerCount('SIGTERM')).toBe(before);
});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Move the code and wire `index.ts` to it.** Move, do not rewrite. The diff of the moved block should be indentation and the listen host only.
- [ ] **Step 4: Run the server suite, lint and typecheck, and `pnpm --filter @openldr/server build:check`**

Expected: PASS. `build:check` proves the bundled Docker entry still starts far enough to pass its smoke script.

- [ ] **Step 5: Prove the Docker-tier entry still boots for real**

Create two scratch databases in the dev Postgres container with names starting `sa_scratch_`. Never use `openldr`, `openldr_target` or `keycloak`. Start `node dev.mjs` from `apps/server` on a spare port from 3990 to 3997 with both database URLs overridden. Check `/health` answers 200 and the log shows the server listening. Send `SIGTERM` and check it exits with code 0 inside 30 seconds. Drop both databases. Record the commands and results in the report.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "refactor(server): split a callable startServer out of the entry file"
```

---

### Task 5: Bundled Postgres runner

**Files:**
- Create: `apps/standalone/package.json`, `tsconfig.json`, `src/postgres.ts`
- Modify: `pnpm-workspace.yaml` (`allowBuilds`)
- Test: `apps/standalone/src/postgres.test.ts` (pure parts), `apps/standalone/src/postgres.live.test.ts` (real Postgres)

Package name `@openldr/standalone`, private, `"type": "module"`. Dependency: `embedded-postgres`, pinned to the newest exact `16.x` version the package offers. Record the version in the report. Add one `allowBuilds` entry per platform package it lists as an optional dependency, each set to `true`.

**Interfaces:**
- Produces:

```ts
export interface PostgresSettings { port: number; superPassword: string; appPassword: string }
export const APP_ROLE = 'openldr_app';
export const INTERNAL_DB = 'openldr';
export const TARGET_DB = 'openldr_target';
export interface RunningPostgres {
  pid: number;
  internalUrl: string; // postgres://openldr_app:<appPassword>@127.0.0.1:<port>/openldr
  targetUrl: string;
  /** Fast shutdown. Resolves when the process has gone. */
  stop(): Promise<void>;
  /** Tells Postgres to shut down without waiting. Safe in a process exit handler. */
  stopSync(): void;
}
export function readPostmasterPid(clusterDir: string): { pid: number; dataDir: string } | null;
export function stopLeftoverPostgres(clusterDir: string, waitMs?: number): Promise<'none' | 'stale' | 'stopped'>;
export function startPostgres(opts: { clusterDir: string; logFile: string; settings: PostgresSettings }): Promise<RunningPostgres>;
export function findFreePort(preferred: number): Promise<number>;
/** The two URLs the server and the CLI use, built from the settings alone. */
export function postgresUrls(settings: PostgresSettings): { internalUrl: string; targetUrl: string };
```

Rules:

- `startPostgres` runs `initdb` only when `<clusterDir>/PG_VERSION` is missing, with `--encoding=UTF8 --locale=C` and the superuser password.
- It starts Postgres with `listen_addresses=127.0.0.1`, the given port, `timezone=UTC` and `log_timezone=UTC`. Output goes to `logFile`.
- On the first start only, it connects as the superuser, creates the role `openldr_app` with login and `appPassword` and no other attribute, creates both databases owned by that role, and revokes `CONNECT` on both from `PUBLIC`.
- If the port is taken it rejects with a message naming the port. It does not pick another.
- If anything fails after Postgres started, it stops Postgres before rejecting.
- `readPostmasterPid` reads the first line (the process ID) and the second line (the data folder) of `postmaster.pid`. It returns null when the file is missing or malformed.
- `stopLeftoverPostgres` returns `none` with no pid file. It returns `stale` when the recorded process is gone, or when its data folder is not this cluster. Otherwise it sends a fast shutdown, waits up to `waitMs` (default 30,000) for the process to go, and returns `stopped`. If the process is still there after the wait it rejects.
- Fast shutdown is `SIGINT` to the postmaster on Linux and macOS. On Windows it is `pg_ctl stop -m fast -D <clusterDir>` from the package's own binaries. Mark the Windows path unproven.
- Passwords never appear in an error message or the log file. Build URLs with `encodeURIComponent`.

- [ ] **Step 1: Write the failing pure tests**

```ts
it('reads the pid and data folder from postmaster.pid', () => {});
it('returns null for a missing or malformed postmaster.pid', () => {});
it('reports none when there is no pid file, and stale when the process is gone', async () => {});
it('reports stale when the pid belongs to a process with a different data folder', async () => {});
it('finds the preferred port when it is free and another when it is not', async () => {});
it('encodes a password with special characters in both URLs', () => {});
```

- [ ] **Step 2: Write the live tests.** Use `describe.skipIf(!process.env.STANDALONE_LIVE)`. Each test uses its own temporary folder and a free port, and stops everything it starts in `afterEach`.

```ts
it('starts on an empty folder, creates both databases, and answers as the ordinary role', async () => {
  // select current_user -> 'openldr_app'; select rolsuper from pg_roles where rolname = current_user -> false
  // show server_encoding -> UTF8; show lc_collate -> C; show timezone -> UTC; show listen_addresses -> 127.0.0.1
});
it('starts again on the same folder without running initdb, and keeps the data', async () => {});
it('works in a folder whose path has spaces and non-ASCII letters', async () => {
  // mkdtemp, then a subfolder named "Lab São José ñ" inside it
});
it('refuses a taken port with a message that names it, and leaves nothing running', async () => {});
it('stops a leftover Postgres whose parent was killed, then starts clean', async () => {
  // start in a child process, SIGKILL the child, confirm the postmaster is still alive,
  // stopLeftoverPostgres -> 'stopped', startPostgres succeeds, earlier data is there
});
it('stopSync makes Postgres exit without waiting', async () => {});
it('the ordinary role cannot run a host command or read a host file', async () => {
  await expect(query("copy (select 1) to program 'id'")).rejects.toThrow();
  await expect(query("select pg_read_file('/etc/hostname')")).rejects.toThrow();
});
it('never writes a password to the log file', async () => {});
```

- [ ] **Step 3: Run and confirm failure**

Run: `pnpm install`, then `pnpm --filter @openldr/standalone exec vitest run` and `STANDALONE_LIVE=1 pnpm --filter @openldr/standalone exec vitest run src/postgres.live.test.ts`

- [ ] **Step 4: Implement `postgres.ts`**
- [ ] **Step 5: Run both sets and confirm pass.** Confirm no `postgres` process from the tests is left: list processes whose command line includes the temporary folder.
- [ ] **Step 6: Check the Docker images do not gain the binaries**

Read `apps/server/Dockerfile` and `apps/studio/Dockerfile`. Say in the report which stage installs dependencies and which files reach the final image. If `node_modules/@embedded-postgres` or `apps/standalone` would reach a final image, add a filter to that install so it does not, and say what you changed. Do not build an image unless reading the Dockerfile leaves the answer unclear.

- [ ] **Step 7: Commit**

```bash
git add apps/standalone pnpm-workspace.yaml pnpm-lock.yaml apps/server/Dockerfile apps/studio/Dockerfile
git commit -m "feat(standalone): run bundled Postgres 16 as an ordinary role"
```

---

### Task 6: Data folder, state file and lock

**Files:**
- Create: `apps/standalone/src/state.ts`
- Test: `apps/standalone/src/state.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StandalonePaths {
  root: string; cluster: string; blobs: string; logs: string; crash: string;
  stateFile: string; lockFile: string; serverLog: string; postgresLog: string;
}
export interface StandaloneState {
  version: 1; secretsKey: string; pgPort: number; pgSuperPassword: string; pgAppPassword: string;
}
export interface LockInfo { pid: number; address: string; startedAt: string }
export class StateFileError extends Error {}
export class AlreadyRunningError extends Error { constructor(public info: LockInfo) }
export function resolveDataDir(opts: { flag?: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; homedir: string }): string;
export function pathsFor(root: string): StandalonePaths;
export function ensureFolders(paths: StandalonePaths): Promise<void>;
export function loadOrCreateState(paths: StandalonePaths, pickPort: () => Promise<number>): Promise<StandaloneState>;
export function readLock(paths: StandalonePaths): Promise<LockInfo | null>;
export function acquireLock(paths: StandalonePaths, info: LockInfo): Promise<void>;
export function releaseLock(paths: StandalonePaths): Promise<void>;
```

Rules:

- `resolveDataDir` order: the flag, then `OPENLDR_HOME`, then the OS default. Linux: `$XDG_DATA_HOME/openldr` when that variable is set, else `<home>/.local/share/openldr`. macOS: `<home>/Library/Application Support/OpenLDR`. Windows: `%LOCALAPPDATA%\OpenLDR`. The result is always absolute.
- `ensureFolders` creates the root with mode 0700 and the subfolders.
- `secretsKey` is 32 random bytes in base64, the form `parseSecretKey` in `packages/core/src/crypto.ts` accepts. Each password is 24 random bytes in base64url.
- A new state file is written with mode 0600 by writing a temporary file and renaming it.
- A state file that exists but does not parse, or lacks a field, throws `StateFileError` whose message names the file. It is never replaced.
- `acquireLock` throws `AlreadyRunningError` when the lock names a live process. It replaces a lock whose process is gone. It creates the file with an exclusive create, so two launchers starting together cannot both win.

- [ ] **Step 1: Write the failing tests**

```ts
it('prefers the flag, then OPENLDR_HOME, then the OS default', () => {
  expect(resolveDataDir({ flag: '/a', env: { OPENLDR_HOME: '/b' }, platform: 'linux', homedir: '/h' })).toBe('/a');
  expect(resolveDataDir({ env: { OPENLDR_HOME: '/b' }, platform: 'linux', homedir: '/h' })).toBe('/b');
  expect(resolveDataDir({ env: {}, platform: 'linux', homedir: '/h' })).toBe('/h/.local/share/openldr');
  expect(resolveDataDir({ env: { XDG_DATA_HOME: '/x' }, platform: 'linux', homedir: '/h' })).toBe('/x/openldr');
  expect(resolveDataDir({ env: {}, platform: 'darwin', homedir: '/h' })).toBe('/h/Library/Application Support/OpenLDR');
});
it('makes a relative flag absolute', () => {});
it('creates the root owner-only and the state file owner-only', async () => { /* stat mode & 0o777 is 0o700 and 0o600 */ });
it('creates a state with a key parseSecretKey accepts, and returns the same one next time', async () => {});
it('refuses a damaged state file and leaves it untouched', async () => {
  await writeFile(paths.stateFile, '{ not json');
  await expect(loadOrCreateState(paths, pick)).rejects.toBeInstanceOf(StateFileError);
  expect(await readFile(paths.stateFile, 'utf8')).toBe('{ not json');
});
it('refuses a state file with a missing field', async () => {});
it('refuses a second lock while the first process is alive, and replaces a dead one', async () => {});
it('lets only one of two racing acquires win', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement `state.ts`**
- [ ] **Step 4: Run and confirm pass**
- [ ] **Step 5: Commit**

```bash
git add apps/standalone
git commit -m "feat(standalone): data folder, state file and lock"
```

---

### Task 7: The environment a standalone server runs with

**Files:**
- Create: `apps/standalone/src/environment.ts`
- Test: `apps/standalone/src/environment.test.ts`

**Interfaces:**
- Consumes: `StandalonePaths`, `StandaloneState` (Task 6), `RunningPostgres` URLs (Task 5).
- Produces:

```ts
export interface EnvironmentInput {
  paths: StandalonePaths; state: StandaloneState;
  internalUrl: string; targetUrl: string;
  port: number; host: string; studioDist: string; appVersion: string;
}
export function buildEnvironment(input: EnvironmentInput): Record<string, string>;
```

It returns exactly the keys a standalone server needs, and nothing inherited: `NODE_ENV=production`, `TZ=UTC`, `PORT`, `LISTEN_HOST`, `ROOT_REDIRECT_TO_STUDIO=true`, `LOG_LEVEL=info`, `LOG_FILE`, `AUTH_ADAPTER=local`, `AUTH_DEV_BYPASS=false`, `BLOB_ADAPTER=fs`, `BLOB_DIR`, `EVENTING_ADAPTER=pg`, `TARGET_STORE_ADAPTER=pg`, `INTERNAL_DATABASE_URL`, `TARGET_DATABASE_URL`, `MIGRATE_ON_START=true`, `SEED_ON_START=false`, `SECRETS_ENCRYPTION_KEY`, `PLUGIN_CRASH_LOG_DIR`, `WEB_DIST_DIR`, `APP_VERSION`. It sets no `OIDC_*`, `KEYCLOAK_*`, `S3_*` or `IDENTITY_ADMIN_ADAPTER` key.

- [ ] **Step 1: Write the failing tests**

```ts
it('produces an environment the real config schema accepts', () => {
  const env = buildEnvironment(input);
  const cfg = loadConfig(env); // a plain object, so no .env file is read
  expect(cfg.AUTH_ADAPTER).toBe('local'); expect(cfg.BLOB_ADAPTER).toBe('fs');
  expect(cfg.LISTEN_HOST).toBe('127.0.0.1'); expect(cfg.SEED_ON_START).toBe(false);
  expect(cfg.MIGRATE_ON_START).toBe(true); expect(cfg.ROOT_REDIRECT_TO_STUDIO).toBe(true);
});
it('sets nothing for Keycloak, OIDC or S3', () => {
  expect(Object.keys(buildEnvironment(input)).filter(k => /^(OIDC_|KEYCLOAK_|S3_|IDENTITY_ADMIN)/.test(k))).toEqual([]);
});
it('carries the key from the state file, not the public development key', () => {
  expect(buildEnvironment(input).SECRETS_ENCRYPTION_KEY).toBe(input.state.secretsKey);
});
it('puts every path inside the data folder, apart from the studio build', () => {});
it('is accepted under NODE_ENV=production', () => { /* the schema refuses the dev key and the bypass there */ });
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement `environment.ts`**
- [ ] **Step 4: Run and confirm pass**
- [ ] **Step 5: Commit**

```bash
git add apps/standalone
git commit -m "feat(standalone): build the server environment for a standalone run"
```

---

### Task 8: The launcher commands

**Files:**
- Create: `apps/standalone/src/commands.ts`, `src/index.ts`, `tsup.config.ts`
- Modify: `apps/standalone/package.json` (bin `openldr-standalone`, scripts), `packages/cli/package.json` (add the export `"./program": "./src/program.ts"`), root `package.json` (script `"standalone": "node apps/standalone/dist/index.js"`)
- Test: `apps/standalone/src/commands.test.ts`

**Interfaces:**
- Consumes: Tasks 4 to 7. `createSetupCode` from `@openldr/bootstrap`. `makeCrashHandler` from `@openldr/core`. `buildProgram` from `@openldr/cli/program`.
- Produces:

```ts
export interface LauncherDeps {
  startPostgres: typeof startPostgres; stopLeftoverPostgres: typeof stopLeftoverPostgres;
  startServer: (cfg: Config, logger: Logger) => Promise<RunningServer>;
  print: (line: string) => void; now: () => Date;
}
export const STOP_WAIT_MS = 60_000;
export function runStart(opts: { dataDir?: string; port: number; host: string }, deps: LauncherDeps): Promise<{ stop(force?: boolean): Promise<'clean' | 'forced'> }>;
export function runStop(opts: { dataDir?: string }): Promise<number>;
export function runStatus(opts: { dataDir?: string }, print: (line: string) => void): Promise<number>;
export function runCli(opts: { dataDir?: string; args: string[] }): Promise<number>;
```

`runStart`, in order: resolve and create the folders. Acquire the lock. Load or create the state. Stop a leftover Postgres. Start Postgres. Build the environment, assign it onto `process.env`, and build the config with `loadConfig({ ...process.env })`. Install the crash handlers pointed at the crash folder. Register a `process.on('exit')` hook that calls `stopSync()`. Start the server. If `context.localSignIn` says setup is required, call `createSetupCode` and print the code. Print the address and the server log path.

Messages, exact:

- `OpenLDR is running at http://localhost:<port>/studio/`
- `Server log: <path>`
- `No administrator exists yet. Open the address and enter this setup code: <code>`
- `The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code`
- `Port <port> is already in use. Choose another with --port.`
- `OpenLDR is already running (process <pid>) at <address>.`
- `Listening on <host>. Sign-in travels over plain HTTP on this network.` Printed when the host is not `127.0.0.1` or `localhost`.
- `Stopped.` and `Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.`

Failure: if any step throws, undo in reverse order (server, Postgres, lock), print the message, and resolve the process with exit code 1. A taken HTTP port is detected before Postgres starts, by trying to bind it, and again handled if `startServer` rejects with `EADDRINUSE`.

`stop(force)`: close the server, racing against `STOP_WAIT_MS`. Then stop Postgres. Then release the lock. `force` skips the wait. The first `SIGINT` or `SIGTERM` calls `stop()`. A second one calls `stop(true)`.

`runStop`: read the lock. With none, print `OpenLDR is not running.` and return 0. Otherwise send `SIGTERM` to the recorded process and wait up to 90 seconds for the lock to go. Return 0 when it goes, 1 when it does not. Mark Windows unproven.

`runStatus`: print the data folder, whether it is running, and the address. Return 0 when running, 3 when not.

`runCli`: needs a running launcher, since the CLI connects to the bundled Postgres. With no live lock, print `Start OpenLDR first: openldr-standalone start` and return 1. Otherwise load the state, build the environment (the database URLs come from the state's port and app password), assign it onto `process.env`, and run `buildProgram().parseAsync(['node', 'openldr', ...args])`.

Build: `tsup` bundles `src/index.ts` to ESM with `noExternal: [/^@openldr\//]`. Keep external everything `apps/server/tsup.config.ts` keeps external, plus `embedded-postgres` and its platform packages. After bundling, copy the terminology files to `apps/standalone/fixtures/fhir`, the place `packages/db/src/bundled-terminology.ts:14` resolves from a bundle in `dist/`. Read how `apps/server/Dockerfile` copies them and copy the same source. `studioDist` is `apps/studio/dist`, resolved from the bundle's own location. If it is missing, `start` fails with `The studio is not built. Run: pnpm --filter @openldr/studio build`.

- [ ] **Step 1: Write the failing tests**, with fake `startPostgres`, `startServer` and `print`, on a temporary data folder.

```ts
it('starts Postgres, then the server, and prints the address and the log path', async () => {});
it('prints a setup code when the install needs its first administrator, and none when it does not', async () => {});
it('never writes the setup code to the server log file', async () => {});
it('stops Postgres and releases the lock when the server fails to start', async () => {
  deps.startServer = async () => { throw new Error('boom'); };
  await expect(runStart(opts, deps)).rejects.toThrow('boom');
  expect(fakePg.stopped).toBe(true); expect(await readLock(paths)).toBeNull();
});
it('reports a taken HTTP port before starting Postgres', async () => {
  // hold the port with net.createServer; expect the exact message and fakePg never started
});
it('refuses a second start on the same folder and names the first', async () => {});
it('stops the server before Postgres', async () => { /* order array equals ['server.close', 'pg.stop', 'lock.release'] */ });
it('forces after 60 seconds when the server will not close', async () => {
  // fake timers; server.close never resolves; advance 60_000; result 'forced'; pg stopped
});
it('skips the wait on a forced stop', async () => {});
it('warns when the host is not the local machine', async () => {});
it('status reports not running with exit code 3, and running with the address', async () => {});
it('cli refuses when the launcher is not running', async () => {});
it('builds its config from a copy of the environment, not from a .env file', async () => {
  // a .env in the temp cwd sets AUTH_ADAPTER=keycloak; the config the server receives has AUTH_ADAPTER local
});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement the commands, the entry file and the build**
- [ ] **Step 4: Run the suite, typecheck, and `pnpm --filter @openldr/standalone build`.** Check `apps/standalone/fixtures/fhir` exists after the build and that `git status` shows no build output as untracked. Add ignore rules if it does.
- [ ] **Step 5: Run `pnpm depcruise`** and compare the violation count with the base commit. It must not rise.
- [ ] **Step 6: Commit**

```bash
git add apps/standalone packages/cli/package.json package.json .gitignore pnpm-lock.yaml
git commit -m "feat(standalone): start, stop, status and cli commands"
```

---

### Task 9: Docs

**Files:**
- Web docs under `apps/web/src/docs/` in en, fr and pt. Find the current version folder and how pages are registered before adding one. Follow what the newest page added there did.
- `README.md`, one short section.

Content:

- A new web page, "Run without Docker": what it is for, the build step, `openldr-standalone start`, the setup code, where the data folder is on each OS, `stop`, `status`, `cli -- <args>`, how to back up (stop, then copy the folder), and how to open it to a phone with `--host` and what that means for sign-in over plain HTTP.
- The same page states the limits plainly: no TLS, no installer yet, Postgres target only, one launcher per folder, and that Windows and macOS are untested.
- It says that `pnpm openldr` in a checkout does not reach a standalone install, and to use `openldr-standalone cli`.
- The three tiers, as one table, on the page where the web docs describe deployment choices.
- Rows for `BLOB_ADAPTER`, `BLOB_DIR`, `LISTEN_HOST`, `ROOT_REDIRECT_TO_STUDIO` and `LOG_FILE` in the environment reference, in all three languages, if Tasks 2 and 3 did not already add them.
- No in-app guide. Setup belongs on the website (`apps/studio/src/docs/HOW-TO-TEMPLATE.md`).

- [ ] **Step 1: Write the English page from the code as built.** Run each command and copy its real output.
- [ ] **Step 2: Write French and European Portuguese.**
- [ ] **Step 3: Run the web docs tests and the env docs test**

Run: `pnpm --filter @openldr/web exec vitest run` and `pnpm --filter @openldr/config exec vitest run src/env-docs.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web README.md
git commit -m "docs: run OpenLDR without Docker"
```

---

### Task 10: Real run proof and the gate

No product code. If something is broken, report it precisely. Do not fix it.

Safety: a dev stack is running on this machine and is in use. Do not stop or change it. The launcher uses its own bundled Postgres, so this task needs no scratch database in the dev container. Use a data folder under the system temp folder, an HTTP port from 3990 to 3997, and stop everything you start.

- [ ] **Step 1: Build**

`pnpm --filter @openldr/studio build`, then `pnpm --filter @openldr/standalone build`.

- [ ] **Step 2: Walk a fresh install and record each result**

1. `start` on an empty folder. It prints the address, the log path and a setup code. Time from command to "is running".
2. `GET /` answers 302 to `/studio/`. `GET /studio/` answers 200. `GET /health` reports every check up, with file storage and local sign-in.
3. The server listens on `127.0.0.1` only. Show the listening sockets for the HTTP port and the Postgres port.
4. Finish setup with the code through `POST /api/auth/setup`. Sign in. `GET /api/me` answers 200.
5. `cli -- doctor` runs and shows no "no administrator" warning.
6. `cli -- ingest` loads `apps/web/public/docs-samples/openldr-sample-lab-data.json`. The row counts appear in the target tables.
7. The value sets were imported on first start. Show a count from the terminology tables, and that the start-up warning about missing terminology files is absent from the server log.
8. A stored object exists as a file under `blobs/objects/`.
9. `status` reports running. `stop` prints `Stopped.` and exits 0. No `postgres` process for this folder remains.
10. `start` again. Sign in with the same password. The ingested rows are still there.
11. Hard-kill the launcher with `SIGKILL`. Confirm Postgres is still running. `start` again succeeds and the data is intact.
12. Hold the HTTP port with another process and `start`. It prints the port message, exits 1, and leaves no Postgres running.
13. Start a second launcher on the same folder. It names the first and exits 1.
14. Permissions: the data folder is 0700 and `standalone.json` is 0600.
15. Search `logs/` for the admin password, the setup code, the database passwords and the secrets key. Report the count for each. All must be 0.
16. As a signed-in admin, try a report or custom query that runs `copy (select 1) to program 'id'` and one that calls `pg_read_file`. Both must be refused. If the feature that runs raw SQL is off by default, turn it on for this check and say how.
17. Memory: resident memory of the launcher process and of the Postgres processes, with the studio open.

- [ ] **Step 3: Prove a crash stops Postgres**

Make the server process exit through the crash handler. Sending an unhandled rejection from a small script that imports the launcher's start is enough. Confirm a crash marker lands in `crash/`, and that Postgres exits. Then `start` again and confirm the marker was drained into the audit log.

- [ ] **Step 4: Run the full gate**

Run: `pnpm turbo run test --force --concurrency=2 --continue > /tmp/sa-test.txt 2>&1; echo "exit=$?"`
Run: `pnpm turbo run typecheck --force --concurrency=2 > /tmp/sa-tc.txt 2>&1; echo "exit=$?"`
Run: `pnpm depcruise > /tmp/sa-dc.txt 2>&1; echo "exit=$?"` and compare the count with `main`.
Run: `STANDALONE_LIVE=1 pnpm --filter @openldr/standalone exec vitest run src/postgres.live.test.ts`
Run: `pnpm --filter @openldr/server lint`
On a failure, search for `Test timed out`, `out of memory` and `VirtualAlloc`, and re-run that package alone before calling it a regression.

- [ ] **Step 5: Prove the server image did not gain the binaries**

Build the server image with a throwaway tag: `docker build -f apps/server/Dockerfile -t sa-image-check .` Then list what it holds, in a container that is removed when it exits: `docker run --rm --entrypoint sh sa-image-check -c "find / -path /proc -prune -o -name '*embedded-postgres*' -print 2>/dev/null | head; ls /app/apps 2>/dev/null"`. Expected: no `embedded-postgres` path, and no `standalone` folder. Record the image size beside the size of the current image for the same Dockerfile on `main`, if one exists locally. Remove the throwaway image afterwards. This starts no long-running container and touches nothing in the dev stack.

- [ ] **Step 6: Clean up**

Stop every launcher. Confirm no `postgres` process from this task remains. Remove the temporary data folders.

- [ ] **Step 7: Write the report**

One table per step: the claim, the command, the result, PROVEN or NOT PROVEN. End with a list headed HONEST NON-PROOF. It must include Windows, macOS, antivirus software, and a data folder on a network drive.

- [ ] **Step 8: After the work merges to `main`, update the changelog**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog for the standalone run"
```
