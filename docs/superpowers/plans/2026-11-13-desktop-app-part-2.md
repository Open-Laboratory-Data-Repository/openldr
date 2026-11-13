# Desktop App Part 2: The Launcher, the App and the First Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real Electron app in `apps/desktop` that starts the standalone launcher, shows Studio in a window, hands the setup code to Studio, and a first-run flow in Studio with sample data loaded through a new route.

**Architecture:** The launcher gains a machine-readable event stream and a version guard. The app is a thin Electron main process around a tested controller that drives the launcher only through its own commands (`start`, `stop`, `status`, `cli`). Studio asks the app for a setup code through one small object, and runs a three-step flow after the first administrator is made.

**Tech Stack:** Electron 45.3.0, TypeScript, tsup, vitest 2.1.8, React (Studio), Fastify (server), pnpm 11, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-13-desktop-app-design.md`, sections 6.2 to 6.6 (slices 2 to 6).

**Facts:** `docs/superpowers/plans/2026-11-13-desktop-app-part-2-facts.md`. File and line facts for every area below. Confirm a line before you rely on it.

This is part 2 of three. It is built first. Part 1 (packing for three systems) and part 3 (release step, installers, landing page, web docs) follow. Part 3 owns the docs for the two new launcher options, `start --events-fd` and `status --json`: `docs/CLI-REFERENCE.md` and the options table in `apps/web/src/docs/<version>/{en,fr,pt}/standalone.md`. The controller runs `pnpm make:changelog` after the merge to `main`.

**The launcher's address.** The launcher shows `127.0.0.1` as `localhost` and serves Studio under `/studio/`. So the address in the lock, in `status`, and in the `ready` event is `http://localhost:<port>/studio/` (`apps/standalone/src/commands.ts:85`, `:217-220`). Nothing in this plan rewrites that address. Its origin is `http://localhost:<port>`.

## Global Constraints

- Electron is `45.3.0`, pinned exactly. `embedded-postgres` stays at `16.15.0-beta.19`.
- The app never signals the launcher and never kills a child process. It stops OpenLDR by running the launcher's `stop` command and waiting.
- The app always passes `--host 127.0.0.1`. There is no setting that opens OpenLDR to the network.
- A setup code, password, key or token never reaches a log, a launcher event, a page of the app, the tray, the settings file or a test's output.
- The app answers Studio only from a page on the launcher's address, and only when that address is `127.0.0.1`, `localhost` or `[::1]`.
- The window has context isolation on, Node integration off and the sandbox on. It loads only the launcher's address and the app's own pages. Any other link opens in the person's browser.
- The app's own files live in a folder named `OpenLDR Desktop`, never in OpenLDR's data folder.
- The settings file holds the port, start at sign-in and the window size. It holds no secret.
- Sample data loads only when an administrator asks, and only into an install that holds no lab data.
- The first-run flow lives in Studio. Every step after the administrator can be skipped. It is shown once, only to the person who just made the first administrator, only on local sign-in.
- Studio screens follow `AGENTS.md` section 5 and copy `apps/studio/src/auth/SetupPage.tsx`. Every new string exists in English, French and Portuguese. Full-height pages use `h-dvh`.
- `pnpm depcruise` stays at 21 violations.
- No database migration.
- Development and test overrides for the app, read from the environment and documented only in `apps/desktop/README.md`: `OPENLDR_DESKTOP_DATA_DIR` (data folder passed to the launcher as `--data-dir`), `OPENLDR_DESKTOP_PORT` (use exactly this port, remember nothing), `OPENLDR_DESKTOP_USER_DIR` (the app's own folder), `OPENLDR_DESKTOP_SELFCHECK` (path of a JSON file; see Task 4).
- Every real run on this machine passes all of the first three, with a port from 3990 to 3997 and folders under the system temp folder, and starts Electron as `aa-exec -p unconfined -- <electron> --no-sandbox <app>`.

## Review Focus

1. **The app is killed while OpenLDR runs.** The launcher must keep running, and the next start of the app must show that OpenLDR, not start a second one. Owner: Task 1 (a write to a closed events pipe does not end the launcher), Task 4 (attach test), the real run.
2. **The setup code expires while the setup page sits open.** Submitting must still work. Owner: Task 5, test "asks for a fresh code after bad_code".
3. **A data folder whose path has a space and a non-English letter.** The app and the launcher must still start. Owner: Task 4, the smoke run uses such a folder.
4. **Two clicks on "Load sample data".** One load, not two. Owner: Task 6 (busy answer), Task 7 (button disabled while loading).
5. **Port 3000 is taken by another program.** The app picks another port, remembers it, and uses it again next time. Owner: Task 3, `choosePort` tests.

## File Structure

```
apps/standalone/src/
  commands.ts            modify: --events-fd, status --json, events, guard call
  events.ts              create: LauncherEvent, eventSink
  data-version.ts        create: the newer-version guard
  state.ts               modify: one new path
  index.ts               modify: build the sink, emit stopped and error
apps/desktop/
  package.json, tsconfig.json, tsup.config.ts, README.md
  assets/icon.png, assets/tray.png
  pages/page.html, pages/page.js, pages/page.css
  src/settings.ts        the settings file
  src/ports.ts           which port
  src/locality.ts        which pages the app answers, where a link may go
  src/strings.ts         the app's words in three languages
  src/launcher.ts        runs the launcher's commands as child processes
  src/controller.ts      what the app does: start, attach, events, quit, retry
  src/autostart.ts       start at sign-in
  src/bridge.ts          the two calls Studio may make
  src/selfcheck.ts       the builder's check
  src/main.ts            Electron wiring only
  src/preload.ts         the context bridge
apps/studio/src/
  desktop.ts             window.openldrDesktop, typed
  auth/SetupPage.tsx     modify
  auth/AuthProvider.tsx  modify
  first-run/FirstRunPage.tsx, LabStep.tsx, SampleDataStep.tsx, ReadyStep.tsx
  components/setup/SetupCheckRow.tsx   lifted from pages/settings/SetupChecks.tsx
packages/bootstrap/src/sample-data.ts
apps/server/src/sample-data-routes.ts
```

---

### Task 1: Launcher events, no setup code with them, and `status --json`

**Files:**
- Create: `apps/standalone/src/events.ts`, `apps/standalone/src/events.test.ts`
- Modify: `apps/standalone/src/commands.ts`, `apps/standalone/src/index.ts`
- Test: `apps/standalone/src/commands.test.ts`

**Interfaces:**
- Produces, in `events.ts`:

```ts
export type LauncherEvent =
  | { event: 'starting'; step: 'postgres' | 'server' }
  | { event: 'recovering' }
  | { event: 'ready'; address: string }
  | { event: 'stopping' }
  | { event: 'stopped'; result: 'clean' | 'forced' }
  | { event: 'error'; message: string };

/** Writes one JSON object and a newline per event to the descriptor. A failed write is ignored. */
export function eventSink(fd: number, write?: (fd: number, text: string) => void): (e: LauncherEvent) => void;
```

- Produces, in `commands.ts`: `LauncherDeps.emit?: (e: LauncherEvent) => void`; `CommandLine` start gains `eventsFd?: number`; status becomes its own member `{ command: 'status'; dataDir?: string; json?: boolean }`; `runStatus(opts: { dataDir?: string; json?: boolean }, print)`.
- Produces, in `state.ts`: `LockInfo.host?: string`, the `--host` value the launcher was started with. `runStart` writes it into the lock. A lock written before this change has none.
- Produces, on the command line: `start --events-fd <n>` and `status --json`. With `--json`, `status` prints exactly one line, one of:

```json
{"dataDir":"<folder>","running":true,"address":"http://localhost:3000/studio/","host":"127.0.0.1"}
{"dataDir":"<folder>","running":false}
{"dataDir":"<folder>","running":false,"busy":"<the recovery line status prints today>"}
```

`address` is `lock.address`, unchanged. `host` is `lock.host`, and the key is left out when the lock has none. Exit codes stay 0 and 3.

Why `host`: a launcher started with `--host 0.0.0.0` still records a `localhost` address, so the address alone cannot tell the app that OpenLDR is open to the network. The app refuses Studio's setup code request unless the host is this computer's own (Task 4).

- [ ] **Step 1: Write the failing tests**

In `events.test.ts`:
- `eventSink` writes `JSON.stringify(event) + '\n'` to the given descriptor, once per event.
- `eventSink` does not throw when `write` throws (the reader has gone).

In `commands.test.ts`, beside the existing `parseCommandLine` tests:
- `start --events-fd 3` gives `eventsFd: 3`. `start` without it has no `eventsFd` key.
- `start --events-fd 2`, `--events-fd x` and `--events-fd ''` each throw `UsageError` with the message `--events-fd must be a whole number, 3 or higher.`
- `status --json` gives `json: true`. `status` without it has no `json` key (the existing test at `commands.test.ts:1771` expects exactly `{ command: 'status' }`). `stop --json` throws `UsageError`.

Beside the existing `runStart` tests, using `fakes()` and setting `f.deps.emit` to a function that pushes to an array:
- A start that fails after the lock (for example the port is taken) emits `stopping` and no `ready`. `runStart`'s own `catch` calls `stop()`, so this order is expected; `index.ts` then adds `error`.
- After a start with `host: '127.0.0.1'`, the lock file holds `"host":"127.0.0.1"`.
- A normal start emits, in order: `starting/postgres`, `starting/server`, `ready` with the same address `runStart` returns.
- A start whose Postgres reports recovery emits `recovering` between `starting/postgres` and `starting/server`, and still prints `RECOVERING`.
- With `emit` set and `setupRequired` true: `createSetupCode` is never called, and no printed line matches `/setup code/i`.
- Without `emit` and `setupRequired` true: the setup code line is printed as today (the existing test stays green, unchanged).
- `stop()` emits `stopping` exactly once, even when `stop()` is called twice.
- No emitted event, serialised, contains the control token, the secrets key or either Postgres password from the state the fake used.

Beside the existing `runStatus` tests: the three JSON shapes above, each with its exit code; that nothing else is printed with `json: true`; that `address` equals the lock's address character for character; and that `host` is absent for a lock without one.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/standalone exec vitest run src/events.test.ts src/commands.test.ts`
Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement**

- `events.ts` as above. The default `write` is `writeSync` from `node:fs`.
- `parseOptions`: `start` accepts `events-fd` (string), `status` accepts `json` (boolean). `stop` accepts neither. Update `USAGE` with both.
- `runStart`: call `deps.emit?.()` at each point. `starting/postgres` just before `deps.startPostgres`. `recovering` inside `onRecovering`, beside the print. `starting/server` just before `deps.startServer`. `ready` where `OpenLDR is running at` is printed. `stopping` on the first call of `stop()`.
- `runStart` step 11: skip the whole setup code block when `deps.emit` is set.
- `index.ts` `start()`: when `eventsFd` is given, build `emit = eventSink(eventsFd)` and pass it in the deps. After `launcher.done` resolves, emit `stopped` with the result. When `runStart` throws or `done` rejects, emit `error` with the same message that goes to standard error. Those messages have already been through `hideSecrets`.
- `runStatus`: with `json`, print the one line and nothing else.

- [ ] **Step 4: Run the package's tests and typecheck**

Run: `pnpm --filter @openldr/standalone test > /tmp/d-t1-test.txt 2>&1; echo "exit=$?"` and `pnpm --filter @openldr/standalone typecheck > /tmp/d-t1-tc.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`.

- [ ] **Step 5: Prove the stream from the built launcher**

Build Studio and the launcher (`pnpm --filter @openldr/studio build`, `pnpm --filter @openldr/standalone build`). Then start the built launcher on a temp data folder and port 3990 with `OPENLDR_SKIP_ENV_FILE=true`, with descriptor 3 redirected to a temp file (`3>/tmp/<folder>/events.jsonl`), wait for the `ready` line in that file, run `status --json` and `stop` against the same folder, and wait for the launcher to exit.
Expected: the file holds `starting/postgres`, `starting/server`, `ready`, `stopping`, `stopped` with `clean`, one per line; `status --json` printed the running shape; no line of the events file or the launcher's standard output matches `/setup code/i`; nothing listens on 3990 afterwards. Remove the temp folder.

- [ ] **Step 6: Commit**

```bash
git add apps/standalone/src/events.ts apps/standalone/src/events.test.ts apps/standalone/src/commands.ts apps/standalone/src/commands.test.ts apps/standalone/src/index.ts
git commit -m "feat(standalone): launcher events on --events-fd, and status --json"
```

---

### Task 2: An older launcher refuses a data folder a newer one used

**Files:**
- Create: `apps/standalone/src/data-version.ts`, `apps/standalone/src/data-version.test.ts`
- Modify: `apps/standalone/src/state.ts` (one path), `apps/standalone/src/commands.ts` (the call)
- Test: `apps/standalone/src/commands.test.ts`

**Interfaces:**
- Produces: `StandalonePaths.versionFile`, the file `last-version.json` in the data folder's root, holding `{"version":"0.1.11"}`, mode 0600.
- Produces, in `data-version.ts`:

```ts
/** -1, 0 or 1 by the leading x.y.z of each. null when either has no leading x.y.z. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null;
export function newerDataMessage(recorded: string, current: string): string;
/** Throws an Error with newerDataMessage when the folder was last started by a newer version. Writes nothing. */
export async function checkDataVersion(paths: Pick<StandalonePaths, 'versionFile'>, appVersion: string): Promise<void>;
/** Records the current version as the one that last started the folder. */
export async function recordDataVersion(paths: Pick<StandalonePaths, 'versionFile'>, appVersion: string): Promise<void>;
```

`newerDataMessage('0.2.0', '0.1.11')` is exactly:
`This data folder was last used by OpenLDR 0.2.0. This is OpenLDR 0.1.11, which is older and cannot open it. Install OpenLDR 0.2.0 or newer.`

Rules:
- The comparison uses the leading `x.y.z` as numbers. `0.1.11-beta.1` counts as `0.1.11`. `0.1.9` is older than `0.1.11`.
- No file, an unreadable file, or a recorded version with no leading `x.y.z`: `checkDataVersion` does not refuse, and `recordDataVersion` writes the current version.
- A current version of `0.0.0` or with no leading `x.y.z` means the launcher could not find its version: no refusal, and nothing is written.
- Recorded older than or equal to current: no refusal. `recordDataVersion` rewrites the file only when the version differs.
- The write is a temp file in the same folder, mode 0600, synced, then renamed over the old one. A power cut leaves the old file or the new one, never half of one.

- [ ] **Step 1: Write the failing tests**

`data-version.test.ts`: the `compareVersions` cases above and `1.0.0` against `0.99.99`; the exact message; each rule in the list, on a real temp folder; the file's mode is 0600; a second call with the same version does not change the file's modification time.

`commands.test.ts`:
- with `last-version.json` holding `9.9.9` and the fake `appVersion` lower, `runStart` rejects with `newerDataMessage('9.9.9', <fake version>)`, `startPostgres` was never called, the state file was not created, and the lock file is gone afterwards;
- after a normal start, `last-version.json` holds the fake `appVersion`;
- a start that fails at the port check, or whose `startServer` throws, leaves `last-version.json` as it was (absent, or holding the older version).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/standalone exec vitest run src/data-version.test.ts src/commands.test.ts`

- [ ] **Step 3: Implement**

In `runStart`: call `checkDataVersion(paths, deps.appVersion)` right after step 3 (the lock) and before step 4 (the state file), so a newer folder is refused before anything of it is read. Call `recordDataVersion(paths, deps.appVersion)` after `deps.startServer` has returned and before `markStarted()`, so only a start that worked marks the folder. Both run under the lock, so two launchers cannot race on the file. The existing `catch` releases the lock and the control port.

- [ ] **Step 4: Run the package's tests and typecheck** (as Task 1, step 4)

- [ ] **Step 5: Commit**

```bash
git add apps/standalone/src/data-version.ts apps/standalone/src/data-version.test.ts apps/standalone/src/state.ts apps/standalone/src/commands.ts apps/standalone/src/commands.test.ts
git commit -m "feat(standalone): an older launcher refuses a data folder a newer one used"
```

---

### Task 3: The app's package and its plain parts

**Files:**
- Create: `apps/desktop/package.json`, `tsconfig.json`, `tsup.config.ts`, `README.md`
- Create: `apps/desktop/src/settings.ts`, `ports.ts`, `locality.ts`, `strings.ts`, `launcher.ts`, each with a `*.test.ts`
- Modify: `pnpm-workspace.yaml` (`electron: true` under `allowBuilds`), `pnpm-lock.yaml`

Nothing in this task imports `electron`. These files are plain Node and are tested with vitest.

**Interfaces (all produced here, used by Tasks 4 and 5):**

```ts
// settings.ts
export interface Settings { port?: number; startAtSignIn: boolean; window?: { width: number; height: number } }
export const DEFAULT_SETTINGS: Settings;                 // { startAtSignIn: false }
export function loadSettings(file: string): Settings;     // never throws
export function saveSettings(file: string, s: Settings): void;

// ports.ts
export const PREFERRED_PORT = 3000;
export function isPortFree(port: number, host?: string): Promise<boolean>;   // host defaults to 127.0.0.1
export function findFreePort(host?: string): Promise<number>;
export function choosePort(
  remembered: number | undefined,
  deps?: { isPortFree: typeof isPortFree; findFreePort: typeof findFreePort },
): Promise<{ port: number; remember: boolean }>;

// locality.ts
export function isLocalAddress(url: string): boolean;
export function sameOrigin(a: string, b: string): boolean;
export function mayAnswerStudio(senderUrl: string, launcherAddress: string | undefined): boolean;
export function linkTarget(url: string, launcherAddress: string | undefined, ownPages: readonly string[]): 'inside' | 'browser' | 'refuse';

// strings.ts
export type Lang = 'en' | 'fr' | 'pt';
export function pickLang(locale: string): Lang;
export interface AppStrings { /* every word the app shows: page titles and notes, tray items, error lines */ }
export const STRINGS: Record<Lang, AppStrings>;

// launcher.ts
export type LauncherEvent = /* the same six shapes as apps/standalone/src/events.ts */;
export interface LauncherTarget { execPath: string; entry: string; dataDir?: string }
export type Spawn = typeof import('node:child_process').spawn;
export function parseEventLine(line: string): LauncherEvent | undefined;
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void;
export function launcherEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;   // base plus ELECTRON_RUN_AS_NODE=1
export function startArgs(t: LauncherTarget, port: number): string[];
export function runLauncher(t: LauncherTarget, args: string[], spawn?: Spawn): Promise<{ code: number | null; stdout: string; stderr: string }>;
export type Status = { running: true; address: string; dataDir: string; host?: string } | { running: false; dataDir?: string; busy?: string };
export function readStatus(t: LauncherTarget, spawn?: Spawn): Promise<Status>;
export function requestSetupCode(t: LauncherTarget, spawn?: Spawn): Promise<string>;
export function requestStop(t: LauncherTarget, spawn?: Spawn): Promise<number>;   // the exit code of `stop`
export interface RunningLauncher { exited: Promise<number | null> }
export function startLauncher(
  t: LauncherTarget, port: number,
  on: { event(e: LauncherEvent): void; stderrLine(line: string): void },
  spawn?: Spawn,
): RunningLauncher;
```

Rules the tests pin:
- `loadSettings`: a missing, unreadable or malformed file gives `DEFAULT_SETTINGS`. A field of the wrong type gives that field's default. Unknown fields are dropped. `port` must be a whole number from 1 to 65535.
- `saveSettings` writes only the three known fields (a passed object with an extra `setupCode` field does not put it in the file), creates the folder, and replaces the file by rename.
- `choosePort`: remembered and free gives it back with `remember: false`. Remembered and taken gives a free port with `remember: true`. Nothing remembered and 3000 free gives 3000 with `remember: false`. Nothing remembered and 3000 taken gives a free port with `remember: true`.
- `isLocalAddress`: true for `http://localhost:3000/studio/`, `http://127.0.0.1:3000/x`, `http://[::1]:3000`. False for `http://192.168.1.5:3000`, `http://localhost.example.com`, `http://127.0.0.1.example.com`, `file:///x`, `not a url`, an empty string.
- `mayAnswerStudio`: true only when the sender has the launcher address's origin and the launcher address is local. Sender `http://localhost:3990/studio/setup` against launcher `http://localhost:3990/studio/` is true. Sender `http://127.0.0.1:3990/studio/` against that launcher is false (another origin). Sender `http://localhost:3991/studio/` is false. An undefined launcher address is false. A `file:` sender is false.
- `linkTarget`: the launcher's origin and each of the app's own page URLs are `inside`. Any other `http:`, `https:` or `mailto:` URL is `browser`. Everything else, `file:` and `javascript:` included, is `refuse`.
- `pickLang`: `fr-CA` gives `fr`, `pt-BR` gives `pt`, `en-GB` and `de-DE` give `en`. `STRINGS.fr` and `STRINGS.pt` hold exactly the keys of `STRINGS.en`, and no value is empty.
- `startArgs` gives `[entry, 'start', '--host', '127.0.0.1', '--port', '<port>', '--events-fd', '3']`, then `'--data-dir', dataDir` when `dataDir` is set.
- `startLauncher` spawns `execPath` with `startArgs`, the environment from `launcherEnv`, and `stdio: ['ignore', 'ignore', 'pipe', 'pipe']`. Descriptor 3 feeds `on.event` through `lineSplitter` and `parseEventLine`. Standard error feeds `on.stderrLine`. It never calls `kill`.
- `parseEventLine`: each of the six shapes parses. A line that is not JSON, or has an unknown `event`, gives `undefined`.
- `readStatus` runs `[entry, 'status', '--json', ...data dir]` and reads the one line. It passes `address` and `host` through unchanged. Output it cannot read gives `{ running: false }`.
- `requestSetupCode` runs `[entry, 'cli', ...data dir, '--', 'auth', 'setup-code', '--json']` and returns the `setupCode` field of the JSON on standard output (`packages/cli/src/auth.ts:35`). On a non-zero exit or unreadable output it throws an `Error` whose message holds neither the child's standard output nor its standard error.
- `requestStop` runs `[entry, 'stop', ...data dir]`.

- [ ] **Step 1: Create the package**

`package.json`: name `@openldr/desktop`, the repo's version, `private`, `"type": "module"`, `"main": "dist/main.js"`. Scripts: `build` (`tsup`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `lint` (`echo "no lint"`), `start` (`electron .`), `dev` (`electron --no-sandbox .`, for a developer on Ubuntu, spec section 11). Dev dependencies only: `electron` at exactly `45.3.0`; `tsup`, `typescript` and `vitest` at the versions `apps/standalone` uses; `@types/node` at `^24.9.0`, which is what Electron 45.3.0 itself asks for. No run-time dependency.

`tsconfig.json` extends the repo's base and adds `"DOM"` to `lib`, because the preload reads `location`.

`tsup.config.ts`: an array of two builds. `src/main.ts` to `dist/main.js` as ESM. `src/preload.ts` to `dist/preload.cjs` as CommonJS, because a sandboxed preload cannot be an ES module. `electron` is external in both. Set `clean` on the first build only: two builds that both clean one `dist` folder delete each other's output. Until Task 4 adds them, add the two entry files as one-line stubs.

Add `electron: true` under `allowBuilds` in `pnpm-workspace.yaml`. Run `pnpm install`, then `pnpm --filter @openldr/desktop exec install-electron`. Check the lockfile hunk holds only the new importer block and Electron's own packages, and say what it holds in the report.

`README.md`: what the package is, how to build and start it from a checkout, and the four environment overrides from Global Constraints.

- [ ] **Step 2: Write the failing tests** for the five files, from the rules above.

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`

- [ ] **Step 4: Implement the five files**

- [ ] **Step 5: Tests, typecheck, depcruise**

Run: `pnpm --filter @openldr/desktop test > /tmp/d-t3-test.txt 2>&1; echo "exit=$?"`, the same for `typecheck`, and `pnpm depcruise > /tmp/d-t3-dc.txt 2>&1; echo "exit=$?"`.
Expected: tests and typecheck `exit=0`; depcruise reports 21 violations.

- [ ] **Step 6: Commit**

Stage each file by name: the four package files, the ten files under `apps/desktop/src`, the two stubs, `pnpm-workspace.yaml` and `pnpm-lock.yaml`.

```bash
git commit -m "feat(desktop): the app's package, settings, port choice and launcher commands"
```

---

### Task 4: The window, the tray, quitting, and a launcher that is already running

**Files:**
- Create: `apps/desktop/src/controller.ts`, `controller.test.ts`, `autostart.ts`, `autostart.test.ts`, `selfcheck.ts`
- Modify: `apps/desktop/src/main.ts`, `preload.ts` (the stubs from Task 3)
- Create: `apps/desktop/pages/page.html`, `page.js`, `page.css`
- Create: `apps/desktop/assets/icon.png` (256 x 256), `assets/tray.png` (32 x 32), both made from `apps/studio/public/favicon.svg`

**Interfaces:**
- Consumes: everything Task 3 produces; `status --json` and the events from Task 1.
- Produces, in `controller.ts`:

```ts
export type Screen =
  | { screen: 'starting'; note: 'checking' | 'postgres' | 'recovering' | 'server' }
  | { screen: 'studio'; address: string }
  | { screen: 'stopping' }
  | { screen: 'error'; message: string; serverLog?: string; postgresLog?: string };

/** What main sends to the app's own page. The words are already in the person's language. */
export interface PageState { title: string; note?: string; message?: string; logs?: string[]; retryLabel?: string }
export function pageState(screen: Exclude<Screen, { screen: 'studio' }>, strings: AppStrings): PageState;

export interface ControllerDeps {
  readStatus(): Promise<Status>;
  startLauncher(port: number, on: { event(e: LauncherEvent): void; stderrLine(line: string): void }): RunningLauncher;
  requestStop(): Promise<number>;
  /** True once an HTTP request to the address gets any answer. */
  answers(address: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  pollMs?: number;                          // default 5_000, how often an attached launcher is checked
  choosePort(remembered: number | undefined): Promise<{ port: number; remember: boolean }>;
  fixedPort?: number;                       // OPENLDR_DESKTOP_PORT
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  show(screen: Screen): void;
  exit(code: number): void;
  log(line: string): void;
  strings: AppStrings;
  stopWaitMs?: number;                      // default 90_000
}

export class DesktopController {
  constructor(deps: ControllerDeps);
  start(): Promise<void>;
  retry(): Promise<void>;
  quit(): Promise<void>;
  /** The launcher's address once OpenLDR is ready or attached to. */
  address(): string | undefined;
  /** The data folder, as `status --json` reported it. */
  dataDir(): string | undefined;
  /** True when this app did not start the launcher it shows. */
  attached(): boolean;
  /**
   * The address Studio's requests may be answered for, or undefined. It is address() when this app
   * started the launcher (always on 127.0.0.1), or when the attached launcher's status names a host
   * of 127.0.0.1, localhost or ::1. An attached launcher with another host, or with no host in its
   * status, gives undefined: the app shows it and answers nothing.
   */
  bridgeAddress(): string | undefined;
}
```

- Produces, in `preload.ts`, only on the app's own `file:` pages: `window.openldrDesktopPage = { onScreen(cb: (s: PageState) => void): void; retry(): void }`. Main accepts `retry` only from one of its own pages.

What the controller does, each with a test in `controller.test.ts` (fakes for every dep; the fake `RunningLauncher` carries a `kill` spy, and every test asserts it was never called):

1. `start()` shows `starting/checking`, then reads the status.
2. Status says running: `startLauncher` is not called and `attached()` is true. The other launcher may still be starting (its lock is live before its server listens), so the controller shows `starting/server` and asks `answers(address)` once a second until it is true, then shows `studio` at that address. `address()` returns it.
2a. While attached, the controller reads the status every `pollMs`. When it says not running, it shows `error` with a plain line from `strings`, and `retry()` starts again from step 1. The polling stops on quit.
2b. `bridgeAddress()`: the address for a launcher this app started; the address for an attached launcher whose status has `host: '127.0.0.1'`; undefined for an attached launcher with `host: '0.0.0.0'`, and undefined for one with no `host`.
3. Status says `busy`: shows `error` with that line. `retry()` reads the status again.
4. Status says not running: `fixedPort` is used when set, else `choosePort(settings.port)`. With `remember: true` the settings are saved with the new port, other fields kept. Then `startLauncher(port, ...)`.
5. Events move the screen: `starting/postgres`, `recovering`, `starting/server`, then `ready` shows `studio` at the event's address.
6. The launcher exits when no quit is in progress: shows `error` with the last `error` event's message, or else the last standard error line, or else a plain line from `strings`. It carries the paths of `logs/server.log` and `logs/postgres.log` under `dataDir()` when the data folder is known. `retry()` starts again from step 1. A failed start sends `stopping` and then `error` before the exit (the launcher undoes its own start); that order must end on the error screen, not be read as a quit.
7. `quit()` with a launcher this app started, once it is ready: shows `stopping`, calls `requestStop()` once, waits for `exited`, then `exit(0)`.
7a. `quit()` while the launcher this app started is still starting: `stop` may answer "not running" with code 0 because the launcher has not taken its lock yet. So the controller calls `requestStop()`, and while the child has not exited it calls it again every second, until the child exits (`exit(0)`) or `stopWaitMs` has passed (`exit(1)`). Test: the fake child exits only after the third `requestStop()`; the controller called it three times and then `exit(0)`.
8. `quit()` when attached to a launcher it did not start: shows `stopping`, calls `requestStop()`, then `exit(0)`.
9. `quit()` when nothing runs (the error screen, or still checking): `exit(0)` without `requestStop()`.
10. `quit()` twice: one `requestStop()`, one `exit`.
11. `requestStop()` gives a non-zero code, or the launcher has not exited after `stopWaitMs`: `exit(1)`. The launcher is left running. Nothing is killed.
12. Nothing the controller passes to `log` or `show` contains a string a test planted as a secret in a fake's standard error line that names `setup code`. Such a line is replaced by a fixed line from `strings` before it is kept or shown.

What `main.ts` does. It holds no logic of its own beyond wiring; keep it small.

- Before `ready`: `app.setName('OpenLDR Desktop')` and `app.setPath('userData', OPENLDR_DESKTOP_USER_DIR or join(app.getPath('appData'), 'OpenLDR Desktop'))`. Then `requestSingleInstanceLock()`; a second start quits at once, and the first shows and focuses its window on `second-instance`. On macOS, opening a running app sends `activate` instead: that also shows and focuses the window. Not proven on macOS.
- The launcher target: `execPath` is `process.execPath`; `entry` is `../../standalone/dist/index.js` relative to `dist/main.js`; `dataDir` is `OPENLDR_DESKTOP_DATA_DIR` when set. If the entry file is missing, show the error screen saying OpenLDR is not built.
- One `BrowserWindow`, 1360 x 900 or the remembered size, `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload }`. The size is saved when it changes.
- `show(screen)`: `studio` loads the address. The other three load `pages/page.html` and send it `pageState(screen, strings)`. The page holds no words of its own: it shows the title, the note, and on `error` the message, the log paths and a button with `retryLabel`. `page.html` has a content security policy that allows only its own script and style files.
- Closing the window hides it. It closes for real only during a quit.
- A tray icon with a menu: Open OpenLDR, Start when I sign in (a tick), Open the log folder (`logs` under `dataDir()`), Quit. The words come from `STRINGS[pickLang(app.getLocale())]`.
- Quit, from the tray, the app menu, `before-quit`, or a `SIGTERM` or `SIGINT` to the app: prevent the default, call `controller.quit()`, and let `exit` call `app.exit(code)`.
- Shutdown and sign-out: `powerMonitor`'s `shutdown` event (prevent the default, quit; Electron's typings give that listener no event, so expect a cast), and on Windows the window's `query-session-end` and `session-end` events. Not proven on Windows or macOS.
- Every `webContents` the app creates (`app.on('web-contents-created')`): `will-navigate` and `will-redirect` allow only `linkTarget(...) === 'inside'`; `browser` goes to `shell.openExternal` and is stopped; `refuse` is stopped. `setWindowOpenHandler` denies every new window and sends `browser` targets to `shell.openExternal`. A `<webview>` is refused. Permission requests are refused, with one exception: `clipboard-sanitized-write` from a page on the launcher's origin is allowed, because Studio's copy buttons use `navigator.clipboard` (for example `apps/studio/src/pages/users/ResetPasswordDialog.tsx`).
- Start at sign-in (`autostart.ts`): on Linux a file `~/.config/autostart/openldr-desktop.desktop` whose `Exec` line starts this app with `--hidden`; on Windows and macOS `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`. Started with `--hidden`, or on macOS with `getLoginItemSettings().wasOpenedAtLogin`, the app opens no window. `autostart.ts` exports the pure parts (`autostartFilePath(home)`, `autostartFileText(execPath, appArgs)`, `startedHidden(argv, wasOpenedAtLogin)`) and they have tests. The tick is never set by a test or a smoke run on this machine.
- The app's own log: `desktop.log` in the `OpenLDR Desktop` folder. It holds launcher events, exit codes, the launcher's standard error lines and the app's own errors. It never holds the standard output of any child.
- The self-check (`selfcheck.ts`): when `OPENLDR_DESKTOP_SELFCHECK` names a file, the app waits until the error screen shows, or until Studio has loaded and either `#local-setup-code` or the sign-in form is on the page (React draws them after `did-finish-load`; wait up to 20 s, then report what is there). It first hides the element `#local-setup-code` with an injected style rule, then writes one JSON object to that file and quits through the normal quit:
  `{ screen, address, title, setupPage: boolean, attached: boolean, electron, node, platform }`.
  With `OPENLDR_DESKTOP_SELFCHECK_THEN=close` it closes the window and keeps running; with `stay` it does nothing more. It reports no field value, only whether things exist.

- [ ] **Step 1: Write `controller.test.ts` and `autostart.test.ts`**, from the lists above. See them fail.
- [ ] **Step 2: Implement `controller.ts` and `autostart.ts`.** Tests pass.
- [ ] **Step 3: Write `main.ts`, `preload.ts`, `selfcheck.ts`, the page and the icons.**

This machine has no `rsvg-convert`, `convert`, `magick` or `inkscape`. Make the two PNGs from `favicon.svg` with `/usr/bin/google-chrome --headless --screenshot=<file> --window-size=<n>,<n> --default-background-color=00000000` on a small HTML page that shows the SVG, or with a few lines run under the Electron binary. Look at each PNG before you commit it. The PNGs are committed; nothing regenerates them.

- [ ] **Step 4: Tests, typecheck, depcruise, build**

Run the package's tests and typecheck as in Task 3, and `pnpm depcruise` (21 violations). Then `pnpm --filter @openldr/studio build`, `pnpm --filter @openldr/standalone build`, `pnpm --filter @openldr/desktop build`.

- [ ] **Step 5: The smoke run**

Make a temp folder whose name has a space and a non-English letter (for example `/tmp/openldr d-é-<random>`), with `data` and `app` inside it. Start the app:

```bash
OPENLDR_SKIP_ENV_FILE=true OPENLDR_DESKTOP_DATA_DIR="<tmp>/data" OPENLDR_DESKTOP_USER_DIR="<tmp>/app" OPENLDR_DESKTOP_PORT=3990 OPENLDR_DESKTOP_SELFCHECK="<tmp>/check.json" aa-exec -p unconfined -- apps/desktop/node_modules/.bin/electron --no-sandbox apps/desktop
```

Expected, each shown in the report:
1. Exit code 0. `check.json` holds `"screen":"studio"`, `"setupPage":true`, `"attached":false`, and an address on port 3990.
2. Afterwards `status --json` on that data folder says `"running":false`, nothing listens on 3990, and no process names the temp folder.
3. `<tmp>/app/desktop.log` and `<tmp>/data/logs/server.log` hold no line matching `/setup code/i`.
4. Attach: start the built launcher by hand on the same data folder and port 3991, then start the app with the self-check. `check.json` holds `"attached":true` and the 3991 address. The app's quit stopped that launcher.
5. Close keeps it running: start the app with `OPENLDR_DESKTOP_SELFCHECK_THEN=close`. While it runs, `status --json` says running. Start the app a second time: that second process exits at once. Then send `SIGTERM` to the first: it exits, the launcher stopped clean (the events in `desktop.log` end with `stopped` and `clean`), nothing is left.
6. Killed: start the app with `OPENLDR_DESKTOP_SELFCHECK_THEN=stay`, wait for `check.json`, send the app `SIGKILL`. `status --json` still says running (first show the launcher process is still there). Start the app again with the self-check: `"attached":true`. It quits and stops the launcher, and nothing is left.
7. A signal while starting: start the app with `OPENLDR_DESKTOP_SELFCHECK_THEN=stay` and send it `SIGTERM` about one second later, before `check.json` exists. The app exits, `status --json` says not running, no `postgres` process names the temp folder, and nothing listens on 3990.

This run uses `--no-sandbox`, because no AppArmor profile is installed for this path. Say so in the report. Remove the temp folder.

- [ ] **Step 6: Commit**

Stage each file by name.

```bash
git commit -m "feat(desktop): the window, the tray, quit through stop, and attaching to a running launcher"
```

---

### Task 5: The setup code hand-over

**Files:**
- Create: `apps/desktop/src/bridge.ts`, `bridge.test.ts`
- Modify: `apps/desktop/src/main.ts`, `preload.ts`, `selfcheck.ts`
- Create: `apps/studio/src/desktop.ts`
- Modify: `apps/studio/src/auth/SetupPage.tsx`, `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/auth/SetupPage.test.tsx`

**Interfaces:**
- Consumes: `mayAnswerStudio`, `requestSetupCode`, `DesktopController.bridgeAddress()`. `main.ts` passes `bridgeAddress`, not `address`, as `BridgeDeps.address`, so an attached launcher that is open to the network gets no answer.
- Produces, in `bridge.ts`:

```ts
export const SETUP_CODE_CHANNEL = 'openldr-desktop:setup-code';
export const INFO_CHANNEL = 'openldr-desktop:info';
export interface BridgeDeps {
  address(): string | undefined;
  requestSetupCode(): Promise<string>;
  info(): { version: string; platform: string };
}
/** The two handlers, keyed by channel. Each takes the sender's frame URL. */
export function bridgeHandlers(deps: BridgeDeps): Record<string, (senderUrl: string) => Promise<unknown>>;
```

- Produces, in the page, only when the page's own address is `http:` or `https:` on `127.0.0.1`, `localhost` or `[::1]`:

```ts
window.openldrDesktop = {
  setupCode(): Promise<string>;
  info(): Promise<{ version: string; platform: string }>;
};
```

- Produces, in `apps/studio/src/desktop.ts`: the `OpenldrDesktop` interface, the global `Window.openldrDesktop?` declaration, and `export function desktopApp(): OpenldrDesktop | undefined`.

Rules:
- A handler called with a sender URL for which `mayAnswerStudio(senderUrl, deps.address())` is false rejects with `Error('not allowed')` and calls nothing. This is the check that counts. The preload's own check only keeps the object off other pages.
- `main.ts` registers the handlers with `ipcMain.handle`, passing `event.senderFrame?.url ?? ''`.
- A failure of `requestSetupCode` reaches the page as an error whose message is exactly `The setup code could not be made.` The code is never logged.
- `SetupPage`: when `desktopApp()` exists, ask `setupCode()` once on mount. While it waits, the setup code field is disabled. On success the field holds the code, is read-only, has `type="password"`, and the hint is the new string `auth.setupCodeFromApp`. On failure the field is empty and editable and the hint is `auth.setupCodeHint`, as today. No answer within 30 seconds counts as a failure: the app may not kill a child that hangs, so the limit sits in Studio. An answer that arrives after the limit is ignored.
- When the form is sent and the answer is `bad_code`, and the code came from the app: ask `setupCode()` again and send once more with the new code. A second `bad_code` shows the usual error. This covers a code that expired while the page sat open. `SetupPage` clears both password fields after any answer (`SetupPage.tsx:66`), so the second send uses the username and password captured when the person pressed the button, not the fields' state.
- Without `window.openldrDesktop` the page behaves exactly as today.
- `auth.setupCodeFromApp`: en `Filled in by the OpenLDR app.` fr `Rempli par l'application OpenLDR.` pt `Preenchido pela aplicação OpenLDR.`
- The self-check gains three fields: `bridge` (`typeof window.openldrDesktop`), `setupCodeLength` (the field's value length; the value itself never leaves the page), `setupCodeLocked` (the field's `readOnly`). When the setup page is there and the bridge exists, the self-check waits, within its 20 s, until the field is no longer disabled, so it reports the state after the app's answer.

- [ ] **Step 1: Write the failing tests**

`bridge.test.ts`: setup code allowed from `http://localhost:3990/studio/` when the address is `http://localhost:3990/studio/`; refused, with `requestSetupCode` never called, from `http://localhost:3991/studio/`, from `http://127.0.0.1:3990/studio/`, from `https://example.com/`, from a `file:` URL, from an empty string, when the address is undefined, and when the address is `http://192.168.1.5:3990/studio/` with the sender on that same origin. `info` follows the same rule. A rejecting `requestSetupCode` gives an error whose message is exactly `The setup code could not be made.`

`SetupPage.test.tsx`, with `window.openldrDesktop` stubbed and removed again after each test:
- the field ends up read-only, of type `password`, with a value of the stub's length, and the hint is the English `auth.setupCodeFromApp`;
- sending the form calls `localSetup` with the stub's code;
- a rejecting `setupCode()` leaves an empty, editable field and the usual hint;
- a `setupCode()` that never answers leaves an empty, editable field and the usual hint after 30 seconds (fake timers);
- asks for a fresh code after `bad_code`: `localSetup` answers `bad_code` then a session; `setupCode` was called twice; the second `localSetup` call carries the second code and the same username and password as the first; `onSignedIn` was called;
- two `bad_code` answers show the usual error and `localSetup` was called twice, not three times;
- with no desktop object, the existing tests pass unchanged.

- [ ] **Step 2: See them fail.** `pnpm --filter @openldr/desktop exec vitest run src/bridge.test.ts` and `pnpm --filter @openldr/studio exec vitest run src/auth/SetupPage.test.tsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Tests and typecheck** for `@openldr/desktop` and `@openldr/studio`, the i18n parity test (`src/i18n/parity.test.ts`), and `pnpm depcruise` (21 violations).
- [ ] **Step 5: The smoke run**

Build Studio, the launcher and the app. Run the app as in Task 4 step 5, item 1, on a fresh temp data folder.
Expected: `check.json` holds `"setupPage":true`, `"bridge":"object"`, `"setupCodeLocked":true` and a `setupCodeLength` above 0. `desktop.log` and `server.log` hold no line matching `/setup code/i`. Remove the temp folder.

- [ ] **Step 6: Commit**

Stage each file by name.

```bash
git commit -m "feat(desktop): the app hands the setup code to Studio"
```

---

### Task 6: Sample data from Studio, the route

**Files:**
- Create: `packages/bootstrap/src/sample-data.ts`, `sample-data.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export)
- Create: `apps/server/src/sample-data-routes.ts`, `sample-data-routes.test.ts`
- Modify: `apps/server/src/app.ts` (register, beside `registerSetupRoutes`), `docs/HTTP-API.md` (two rows in the settings table)

**Interfaces:**
- Produces, in `@openldr/bootstrap`:

```ts
/** The few things sample data touches. Built from the app context in index.ts. */
export interface SampleDataDeps { /* cfg, the FHIR store's listByType, the target store's db, and the seed target */ }
export function sampleDataDeps(ctx: AppContext): SampleDataDeps;       // lives in index.ts, beside setupCheckDeps
/** True when the install holds lab data. Sample data is refused then. */
export async function installHoldsLabData(deps: SampleDataDeps): Promise<boolean>;
/** Loads what `openldr db seed` loads, by calling the same seedDatabase. */
export async function loadSampleData(deps: SampleDataDeps): Promise<SampleDataCounts>;
export interface SampleDataCounts { formsSeeded: number; workflowsSeeded: number; connectorsSeeded: number; dashboardsSeeded: number; settingsSeeded: number }
```

`sample-data.ts` must not import from `./index`, not even a type. `pnpm depcruise` counts type-only imports (`.dependency-cruiser.cjs:33-45`), and `index.ts` re-exports this file, so that import is a cycle. Follow `setupCheckDeps(ctx)` and its use at `apps/server/src/setup-routes.ts:12`: a narrow deps type in the new file, and the function that builds it from the context in `index.ts`.

- Produces, on the server, both needing the capability `settings.danger_zone`:
  - `GET /api/settings/sample-data` answers `{ "allowed": boolean }`, `Cache-Control: no-store`.
  - `POST /api/settings/sample-data` loads and answers `{ "ok": true, "formsSeeded": n, "workflowsSeeded": n, "connectorsSeeded": n, "dashboardsSeeded": n, "settingsSeeded": n }`. It answers 409 with `{ "error": "<one sentence>", "code": "has_lab_data" }` when the install holds lab data, and 409 with `{ "error": "<one sentence>", "code": "sample_data_busy" }` while another load runs. Studio reads both `error` and `code` (`api.ts`, `errorDetail`).
- `registerSampleDataRoutes(app, ctx, deps?: { holdsLabData?: () => Promise<boolean>; load?: () => Promise<SampleDataCounts> })`. The defaults call the two functions above with `sampleDataDeps(ctx)`.

Rules:
- "Holds lab data" means: the external table `patients` or `lab_requests` has a row, or the FHIR store holds a resource of type Patient, ServiceRequest, Specimen, Observation, DiagnosticReport, Organization or Location. `ctx.fhirStore.listByType(type, 1)` is one indexed query (`packages/db/src/fhir-store.ts:316-325`). Loading sample data adds a Patient to the FHIR store at once, so a second load is refused. The `patients` table fills later, when the projector runs (`packages/db/src/persist.ts:52-53`), so the FHIR store check is the one that refuses a second load. A fresh install holds no Organization or Location: `seedEssentials`, which runs on every boot, writes no FHIR resource (`packages/bootstrap/src/seed.ts:263-273`); only `seedDatabase` writes `seed-org` and `seed-loc` (`seed.ts:281-304`). So both types stay in the list.
- `loadSampleData` does three things and no more: `createDbContext(ctx.cfg)`, `seedDatabase(dbCtx, ctx)`, and it closes the context in a `finally`. `dangerFactoryReset` (`packages/bootstrap/src/index.ts:2155-2178`) shows those calls, but it wipes the database first and reseeds roles afterwards. Copy neither of those.
- The capability is `settings.danger_zone`. Only the administrator role holds it, and its holder can already reset the install, which seeds too. No new capability.
- The load writes an audit row: `{ action: 'settings.sample_data.load', entityType: 'system', entityId: 'sample-data', metadata: <the five counts of SampleDataCounts> }`. A refused load writes none.
- The check and the load are one step for a caller: `POST` checks again itself and never trusts an earlier `GET`.
- The busy flag is cleared when the load ends, whether it worked or threw.
- `openldr db seed` is not changed.

- [ ] **Step 1: Write the failing tests**

`sample-data-routes.test.ts`, copying `apps/server/src/setup-routes.test.ts`:
- `GET` and `POST` answer 403 to a user with only `settings.view`, and `load` is never called.
- `GET` answers `{ allowed: true }` when `holdsLabData` gives false, and `{ allowed: false }` when it gives true.
- `POST` with lab data answers 409 `has_lab_data`; `load` is never called; no audit row.
- `POST` without lab data calls `load` once, answers 200 with the counts, and writes one audit row with the action above.
- A second `POST` while the first `load` is still pending answers 409 `sample_data_busy`; `load` was called once. After the first ends, a new `POST` reaches `holdsLabData` again.
- A `load` that throws clears the busy flag: the next `POST` is not answered `sample_data_busy`.

`sample-data.test.ts`: `installHoldsLabData` is false on an empty store and true for each of the listed sources by itself. Use the test database helpers the package's other tests use.

- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.** Add the two rows to `docs/HTTP-API.md`.
- [ ] **Step 4: Tests, typecheck, lint and depcruise**

`pnpm --filter @openldr/bootstrap test`, `pnpm --filter @openldr/server test`, both typechecks, `pnpm --filter @openldr/server lint` (the `reply.send` rule), and `pnpm depcruise` (21 violations), each redirected to a file with the exit code read after.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sample-data.ts packages/bootstrap/src/sample-data.test.ts packages/bootstrap/src/index.ts apps/server/src/sample-data-routes.ts apps/server/src/sample-data-routes.test.ts apps/server/src/app.ts docs/HTTP-API.md
git commit -m "feat(server): load sample data through a route, for an administrator, on an empty install"
```

---

### Task 7: The first run in Studio

**Files:**
- Create: `apps/studio/src/first-run/FirstRunPage.tsx`, `LabStep.tsx`, `SampleDataStep.tsx`, `ReadyStep.tsx`, `FirstRunPage.test.tsx`
- Create: `apps/studio/src/components/setup/SetupCheckRow.tsx`
- Modify: `apps/studio/src/pages/settings/SetupChecks.tsx` (use the lifted row; no change in what it shows)
- Modify: `apps/studio/src/auth/AuthProvider.tsx`, `AuthProvider.test.tsx`
- Modify: `apps/studio/src/api.ts`, `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: the two routes from Task 6; `fetchLabIdentity`, `saveLabIdentity`, `runSetupChecks` (`api.ts`).
- Produces, in `api.ts`: `fetchSampleDataAllowed(): Promise<boolean>` and `loadSampleData(): Promise<void>`.
- Produces: `FirstRunPage({ onDone }: { onDone: () => void })`.
- Produces: `SetupCheckRow({ check, onOpen }: { check: SetupCheck; onOpen?: () => void })`, the row `SetupChecks.tsx` renders today, with its icon and fix link. `onOpen` is called when the fix link is clicked. `ICON` and `FIX_LABEL` (`SetupChecks.tsx:11-24`) move into `SetupCheckRow.tsx`.

Rules:
- No file under `first-run/` and not `SetupCheckRow.tsx` may import `auth/AuthProvider.tsx` or `pages/settings/SetupChecks.tsx`. `AuthProvider` imports `FirstRunPage`, so either import closes a cycle, and `pnpm depcruise` counts it. The steps call `@/api` directly; they do not need `useAuth()`.
- The Router sits outside `AuthProvider` (`apps/studio/src/main.tsx:23-27`), so router links work inside the flow.
- `AuthProvider` remembers that this person just made the first administrator: when `SetupPage` reports a session, it sets `sessionStorage['openldr.firstRun'] = '1'`. While that flag is set, the sign-in mode is local and a user is signed in, it renders `FirstRunPage` in place of the app, inside the auth context. `onDone` removes the flag and shows the app. A reload in the middle shows the flow again from step 1. Signing in through `LoginPage` never sets the flag. A Keycloak install never reaches `SetupPage`, so it never sees the flow. Setup succeeds once per install, so the flow cannot show for a second person.
- The page copies `SetupPage`'s layout: `StripedEmpty className="h-dvh"`, one card, the same widths, fields in `grid grid-cols-[auto_1fr]`, shadcn components only. It shows which step it is on ("Step 1 of 3").
- Step 1, name the laboratory: a name `Input` and a time zone `Combobox`. The list is `Intl.supportedValuesOf('timeZone')` with the browser's own zone first; where that function is missing, the list is the browser's zone and `UTC`. Both fields start from `fetchLabIdentity()`; an empty stored time zone starts as the browser's zone. Save sends `saveLabIdentity` with the two keys `Laboratory.tsx` uses for name and time zone, then goes on. Skip goes on and sends nothing. A failed save shows the error and stays.
- Step 2, sample data: shown only when `fetchSampleDataAllowed()` answers true. When it answers false or fails, the flow goes straight to step 3. One sentence says what sample data is. Load calls `loadSampleData()`, shows `LoadingState`, disables both buttons while it runs, then goes on. A failed load shows the error and leaves Skip usable.
- Step 3, you are ready: calls `runSetupChecks()` and lists the checks whose status is `warn` or `fail`, each as a `SetupCheckRow`. With none, it says nothing needs the person. "Open OpenLDR" calls `onDone`. Following a row's link also ends the flow and opens that page.
- In `api.ts` (3349-3353), `SETUP_CHECK_IDS` gains the check id `facilities` and `SETUP_HINTS` gains the hint `facilitiesUnmatched`. One name per list: `facilities` is a check and `facilitiesUnmatched` is a hint (`packages/bootstrap/src/setup-checks.ts:15-19`). The server already sends both and the strings already exist in the three languages; only the lists lag, and the coverage loop in `SetupChecks.test.tsx:93-94` reads them.
- Every string is under a new `firstRun` block in `en.ts`, `fr.ts` and `pt.ts`.
- At 375 x 812 nothing overflows sideways and every button can be reached.

- [ ] **Step 1: Write the failing tests**

`FirstRunPage.test.tsx` (mock `@/api`):
- step 1 shows the stored name; Save calls `saveLabIdentity` once with both keys, then step 2 shows;
- the time zone list's first option is the browser's zone;
- Skip on step 1, Skip on step 2, then "Open OpenLDR" on step 3 calls `onDone`, and `saveLabIdentity` and `loadSampleData` were never called;
- with `fetchSampleDataAllowed` false, Skip on step 1 lands on step 3; the same when it rejects;
- Load calls `loadSampleData` once, both buttons are disabled while it is pending, then step 3 shows;
- a rejected load shows its message and Skip still works;
- step 3 lists a `warn` and a `fail` check and not a `pass` or `skip` one; with only passing checks it shows the "nothing needs you" line;
- "Open OpenLDR" calls `onDone`; clicking a row's fix link calls `onDone` too.

`AuthProvider.test.tsx`, beside the setup flow test at 227-260. That file mocks `@/api` with three functions only (line 7), and a real `FirstRunPage` would call others, so mock `../first-run/FirstRunPage` there with a stub that shows a marker and a button calling `onDone`:
- after `SetupPage` signs in, the first-run page shows and the app's children do not; after `onDone` the children show and the flag is gone;
- after a sign-in through `LoginPage`, the children show and the flag was never set;
- with the flag already in `sessionStorage` and a local session restored, the first-run page shows.

- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Tests and typecheck**

`pnpm --filter @openldr/studio test > /tmp/d-t7-test.txt 2>&1; echo "exit=$?"`, the typecheck, and `pnpm depcruise` (21 violations). The parity test must pass.

- [ ] **Step 5: Commit**

Stage each file by name.

```bash
git commit -m "feat(studio): a first-run flow after the first administrator is made"
```

---

### Task 8: In-app docs for the first run

**Files:**
- Create: `apps/studio/src/docs/<newest version>/{en,fr,pt}/first-run.md`
- Modify: `apps/studio/src/docs/registry.ts`, `apps/studio/src/docs/registry.test.ts`, and the related-guides lists of `sign-in.md` and `setup-checks.md` in the three languages
- Modify: `sign-in.md` in the three languages, section "Create the first administrator": one sentence saying the OpenLDR app fills in the setup code.

The registry entry, decided here because `registry.test.ts:55-131` pins the order and the related lists:

```ts
{
  slug: 'first-run',
  title: 'First run',
  group: 'administration',
  summary: 'Name the laboratory, load sample data and see what still needs you, straight after the first administrator is made.',
  audience: ['administrators'],
  requiredRoles: [],
  estimatedMinutes: 5,
  difficulty: 'beginner',
  relatedSlugs: ['sign-in', 'setup-checks', 'laboratory'],
  screenshotNames: [],
  status: 'published',
}
```

- Its place in the order: after `settings` and before `setup-checks`.
- `sign-in`'s related list becomes `['user-preferences', 'users', 'setup-checks', 'first-run']`. `setup-checks`'s becomes `['settings', 'connectors', 'connector-diagnose', 'first-run']`.
- Update the two pinned lists in `registry.test.ts` to match.
- No clip and no screenshots. `sign-in` has none either. If a test requires a picture for a published guide, report it; do not make one.

Rules:
- Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md`: title, summary, tasks with numbered steps and an **Expected result** line, then limits, troubleshooting and related guides. The same sections in all three languages.
- Three tasks: name the laboratory, load sample data, see what still needs you. Say that each step can be skipped, that the flow shows once, and that Settings, Setup checks holds the same list afterwards. Say that sample data is offered only while the install holds no lab data.
- Every button label and message quoted in the page is copied from `apps/studio/src/i18n/en.ts`, `fr.ts` or `pt.ts`, never from a report.
- Before writing, look at how the last change added an in-app docs page (`git log --oneline -8 -- apps/studio/src/docs`) and do the same: the version folder, the registry entry, and any test that checks the registry against the files.

- [ ] **Step 1: Write the three pages and the registry entry.**
- [ ] **Step 2: Run the Studio tests that cover docs and the registry**, and the typecheck.
- [ ] **Step 3: Commit**, files staged by name, message `docs(studio): the first-run flow, in three languages`.

---

### The real run (the controller does this, after Task 8)

1. Build Studio, the launcher and the app from the branch head.
2. The app on a fresh temp data folder, port 3990: the self-check shows the setup page, the bridge, a locked setup code field. No secret in `desktop.log`, `server.log` or the events.
3. Attach, close-keeps-running, second start, `SIGTERM`, `SIGKILL` then attach: as Task 4 step 5.
4. The version guard on a real folder: put a higher version in `last-version.json`, start, see the refusal and that nothing was started.
5. The sample data route on the real server: refused without a session, allowed for the administrator on the fresh install, refused the second time. The administrator is made with a setup code read from `cli -- auth setup-code --json` into a shell variable and sent with curl. The code is never printed.
6. The first-run pages in the built-in browser at 375 x 812, with pictures.
7. A copy button in Studio inside the app (the clipboard permission).
8. Every item a review marked "proven by reading only".

HONEST NON-PROOF: the port choice is never run for real, because every run here sets `OPENLDR_DESKTOP_PORT`. Its unit tests are the only proof.
