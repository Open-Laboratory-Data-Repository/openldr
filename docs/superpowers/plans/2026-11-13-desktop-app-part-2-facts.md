# Desktop app part 2: facts for the plan

Gathered by a read-only research run on 2026-11-13, against `main` at `3981c990`. These are
the file-level facts the plan for part 2 needs (the launcher's changes, the app, the setup
code hand-over, sample data, and the first run in Studio).

They record what was true when written. Lines drift. Confirm each one before a brief cites
it.

Spec: `docs/superpowers/specs/2026-11-13-desktop-app-design.md`, sections 6.2 to 6.6.

## A. The launcher, `apps/standalone/src`

### commands.ts

- `CommandLine` (930-934): `{ command: 'start'; dataDir?: string; port: number; host: string } | { command: 'stop' | 'status'; dataDir?: string } | { command: 'cli'; dataDir?: string; args: string[] } | { command: 'help' }`.
- `parseCommandLine(argv: string[]): CommandLine` (989). `start` goes through `parseOptions(command, args, withListen)` (963-976), which is `node:util` `parseArgs` with `strict: true` and `allowPositionals: false`. Options today: `'data-dir'`, `port`, `host`, all strings. A new option goes in that options object, in the cast at 972, and in the return at 1012-1017.
- An unknown option makes `parseArgs` throw; it is rethrown as `UsageError` (973-975). `notBlank` refuses an empty value (979-982). `parsePort` gives `'--port must be a whole number from 1 to 65535.'` (955-961). The usage text is `USAGE` (943-953).
- `export async function runStart(opts: { dataDir?: string; port: number; host: string }, deps: LauncherDeps): Promise<Launcher>` (301).
- `LauncherDeps` (44-57): `startPostgres`, `stopLeftoverPostgres`, `startServer: (cfg: Config, logger: Logger) => Promise<RunningServer>`, `print`, `printNow`, `now: () => Date`, `studioDist`, `appVersion`, `cliEntry`.
- `Launcher` (59-73): `{ address: string; stop(force?: boolean): Promise<StopResult>; done: Promise<StopResult> }`. `StopResult = 'clean' | 'forced'` (42).
- Steps inside `runStart`, with the line each begins at:
  1. folders and Studio check: 302
  2. control port, `startControl({ token, onStop: () => stop() })`: 463-464
  3. lock, `acquireLock`: 467
  4. state file, `loadOrCreateState(paths, () => findFreePort(PREFERRED_PG_PORT))`: 488-489
  5. port check, `checkPortFree`: 493-495
  6 and 7. Postgres: leftover stop, then `deps.startPostgres({... onRecovering: () => deps.print(RECOVERING)})`: 497-504
  8. environment and `loadConfig`: 533-551
  9. crash handlers: 553-577
  10. server start: 579-585
  11. setup code: 587-594
  Then the address print (595), the server log line (596), the plain-HTTP note (597-599), `markStarted()` (600).
- The setup code lines (588-594): `if (await context.localSignIn?.setupRequired())`, then `createSetupCode(context)` from `@openldr/bootstrap`, then two `deps.print` lines. The first holds the code.
- `teardown` starts `'clean'` and becomes `'forced'` when the server close loses to the 60 s timer or a `stop(true)` (398-404). A failed step throws `StopError(result, problems)` (426). `runStop` prints `STOPPED` or `STOPPED_FORCED` (630-631); the strings are at 92-93.
- `RECOVERING` (109): `'The database is recovering after an unclean stop. This can take a few minutes.'`
- `launcherFiles(appDir?)` (151-157) returns `{ studioDist, appVersion }`. `appVersion` is the `version` of the checkout root `package.json` (`appDir/../../package.json`), then the app's own `package.json`, then `'0.0.0'`. It reaches the server as `APP_VERSION` (`environment.ts:63`).
- `runCli(opts, print, deps?: CliDeps)` gained a third argument in `b8e94b4b`: with it, a recovery command starts Postgres for itself when no launcher runs. `LockInfo` gained `holder?: 'recovery'`.

### state.ts

- `StandaloneState` (26-32): `{ version: 1; secretsKey: string; pgPort: number; pgSuperPassword: string; pgAppPassword: string }`.
- `loadOrCreateState(paths, pickPort): Promise<StandaloneState>` (149-186). An existing file is returned through `parseState` (154). A missing file over an existing `PG_VERSION` throws `StateFileError` (156-161). Otherwise it creates the file with `writeOwnerOnly(tmp)` (`'wx'`, 0600) plus `link(tmp, stateFile)`.
- `parseState` (188-211) validates each field and returns a new object holding only the five known fields. An extra field is dropped on read. `version !== 1` is refused (199).
- **The state file is never rewritten after creation.** Nothing updates it in place and no helper does an atomic replace. The design's "the launcher records the version that last started the data folder" therefore needs either a new write path for the state file or a second small file. That is a builder call; whichever is chosen must keep the 0600 mode and survive a power cut.
- Tests that pin the shape: `state.test.ts:164-189` (bad shapes, including `version: 2`), `:142-154`, `:194` (the file on disk equals the returned state). `commands.test.ts:71,116-124` writes its own state literal.

### index.ts

- `print` writes a line to stdout, `printError` to stderr, both swallowing write errors (27-35). `printNow` is `writeSync(2, ...)` (37-43).
- `start(opts)` (49-82) builds `handleSignals`, calls `runStart` with the real deps, awaits `launcher.done`, prints the result and exits 0 or 1.
- `main()` (84-121): a `UsageError` prints the message plus `USAGE` to stderr and sets exit code 2.

### Tests

- `commands.test.ts`: `fakes(o)` (190-265) builds `LauncherDeps`; `print` pushes to `f.printed`. The fake server's `context.localSignIn.{setupRequired, createSetupCode}` follows `o.setupRequired` (206-214). `start(deps, extra)` (267-271) calls `runStart({ dataDir: root, port: PORT, host: '127.0.0.1' }, deps)`. The setup code test is at 342-356, `RECOVERING` at 368-381. `afterEach` checks that listener and TCP-server counts are back where they started (143-144).
- `parseCommandLine` tests: 1736-1780. `launcherFiles` tests: 1716-1734.

### Docs

- `docs/CLI-REFERENCE.md` does not mention `openldr-standalone` at all.
- The web page `apps/web/src/docs/0.1.8/{en,fr,pt}/standalone.md` lists the options in a table at lines 87-89, under "### 3. Choose other options if you need them" (83).

## B. Studio, `apps/studio/src`

### AuthProvider and the setup page

- `auth/AuthProvider.tsx`: the `/api/config` effect (132-205) calls `setLocalScreen('setup')` when `cfg.authEnforced && cfg.auth?.mode === 'local'` and `cfg.auth.setupRequired` (153-156). It renders `<SetupPage onSignedIn={(session) => { void openLocalSession(session); }} onSignInInstead={() => setLocalScreen('login')} />` (226-233).
- `openLocalSession(session)` (93-109) keeps the session, then either shows the `'change'` screen or calls `getMe()` and `getMyCapabilities()`, sets the user and clears `localScreen`. After that it renders `<AuthContext.Provider>{children}</AuthContext.Provider>` (288); the children are `<App />`.
- **No flag records "just set up".** The setup path and the login path both go through `openLocalSession`. `AuthState` (24-35) has no such field. `localScreen` is `'login' | 'change' | 'setup' | null` (64). The first-run flow needs a new state here.
- `LoginPage`, `SetupPage` and `ChangePasswordPage` are not routes. `AuthProvider` returns them in place of `children` (226-253).
- `auth/SetupPage.tsx`: `SetupPage({ onSignedIn, onSignInInstead })` (27-31). Layout: `StripedEmpty className="h-dvh"`, a form, a card `w-[calc(100vw-2rem)] max-w-sm ... bg-card p-4 ... sm:p-6` (78-80), fields in `grid grid-cols-[auto_1fr]` (82). The setup code `Input` has `id="local-setup-code"`; its hint has `id="local-setup-code-hint"` and uses `t('auth.setupCodeHint')` (83-94).
- `auth/SetupPage.test.tsx` mocks `./local` (`localSetup: vi.fn()`), imports `'@/i18n'`, and finds fields by English label. The hint text is asserted at 105. `AuthProvider.test.tsx:227-260` tests the setup flow.
- `localSetup(input: { setupCode: string; username: string; displayName?: string; password: string }): Promise<LocalSession | SetupFailure>` (`auth/local.ts:106-115`).

### i18n

- `i18n/en.ts` is one nested object. `auth` is at 7-35. `export type EnShape = DeepString<typeof en>` (2875). `fr.ts` and `pt.ts` are typed `EnShape`.
- `i18n/parity.test.ts:7-27` requires fr and pt to hold exactly en's key paths. Lines 48-80 require a label and description for every capability under `roles.capability.<key>`, with English matching `catalog.ts`. A new capability therefore needs six strings.
- Related blocks: `settings.laboratory` (en.ts:552, `timezoneHint` at 563), `settings.setup` (581).

### api.ts

- `LabIdentity = Record<string, string>` (458). `fetchLabIdentity(): Promise<LabIdentityResponse>` does GET `/api/settings/lab` (478-479). `saveLabIdentity(patch: LabIdentity): Promise<LabIdentity>` does PUT and returns the values map (491-492).
- `SetupStatus = 'pass'|'warn'|'fail'|'skip'` (3354). `SetupCheck { id; status; detail?; hint?; fix? }` (3355). `SetupReport { ok: boolean; checks: SetupCheck[] }` (3356). `runSetupChecks()` does POST `/api/settings/setup-checks` (3357-3358).
- `okJson<T>(res, what)` (2192-2195) throws `formatApiError(what, ...)` on a non-OK answer. `formatApiError` (2185-2190) builds `"<what> failed: <message> · <code> · <correlationId>"`.

### Pages and pieces

- `pages/settings/Laboratory.tsx`: `lab.name` and `lab.timezone` are plain `Input`s (179-193); `TIMEZONE_KEY = 'lab.timezone'` (19). Saving is a dots-menu item that sends every field (90-105, menu 134-145).
- **There is no time zone picker and no IANA list in Studio**, and no `Intl.supportedValuesOf` in the repo. The validator is `isValidIanaZone` in `packages/core/src/param-format.ts:81`; Studio already imports `@openldr/core/pure` (`General.tsx:23`).
- The server's `PUT /api/settings/lab` takes a partial patch, `.strict()` (`settings-routes.ts:17-28`, route 89-102).
- `pages/settings/SetupChecks.tsx`: rows are rendered inline (90-115) and not exported. `ICON` (11-16) and `FIX_LABEL` (19-24) are module-private. Reusing the list in the first-run flow means lifting the row into a shared piece.
- `App.tsx`: flat `<Route>` entries, each gated by `<RequireCapability cap=...>`. `AppShell` is not a layout route; each page wraps itself.
- UI pieces: `StripedEmpty` (`striped-empty.tsx:16`), `Button` (variants `default | secondary | ghost | outline`), `Input`, `Label`, `Select` family (`select.tsx`), `Combobox({ options, value, onChange, placeholder, searchPlaceholder, disabled? })` (`combobox.tsx:9-20`), `SuggestCombobox`, `LoadingState` (`spinner.tsx`).
- Nothing declares `window.*`. `vite-env.d.ts` holds only `declare const __APP_VERSION__: string;`.
- In-app docs: newest version `apps/studio/src/docs/0.1.8/{en,fr,pt}/`. The likely home is `sign-in.md`, section "Create the first administrator" (en:81-96), beside `setup-checks.md` and `laboratory.md`. Registry entry for `sign-in`: `registry.ts:1832`. `HOW-TO-TEMPLATE.md` wants, in order: title, summary, clip, tasks (each with numbered steps and an **Expected result** line), end of page (limits, troubleshooting, related guides), and the same sections in all three languages.

## C. The server and packages

- `apps/server/src/setup-routes.ts` (33 lines): `registerSetupRoutes(app, ctx, deps: SetupRouteDeps = {})`. The route is `app.post('/api/settings/setup-checks', { preHandler: requireCapability('settings.view') }, ...)` (17). It audits `{ action: 'setup.check', entityType: 'system', entityId: 'setup', metadata }`, sets `Cache-Control: no-store`, and is registered at `app.ts:230`.
- `export async function seedDatabase(db: DbContext, app: FormSeedTarget): Promise<SeedResult>` (`packages/bootstrap/src/seed.ts:280`). `DbContext` is built by `createDbContext(cfg: Config)` (`db-context.ts:38`). `AppContext` satisfies `FormSeedTarget` and holds `cfg`.
- The only lab data `seedDatabase` adds is one Organization (`seed-org`), one Location (`seed-loc`) and one Patient (`seed-pat`), through `db.persist` (281-304). The rest is forms, workflows, a connector, dashboards, report designs, settings and terminology.
- **An in-server precedent exists.** `dangerFactoryReset(ctx)` (`bootstrap/src/index.ts:2155-2163`) does `createDbContext(ctx.cfg)` then `seedDatabase(dbCtx, ctx)`, from `POST /api/settings/danger/:action`, which needs `settings.danger_zone`. `start.ts:83-90` does the same when `SEED_ON_START` is set.
- `runDbSeed` (`packages/cli/src/db.ts:141-170`) refuses pending migrations first, then seeds, then emits `{ ok: true, results, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology }` or the matching one-line text.
- **There is no helper for "the install holds lab data".** Candidates: the external tables `patients` and `lab_requests` (`packages/db/src/schema/external.ts:304-305`) through `ctx.store.db`, with the count pattern at `patient-index.ts:209`; `ctx.patientIndex.list(...)`, which returns `.total` (`patient-index.ts:183`); `ctx.fhirStore.listByType(resourceType, limit?)` (`packages/db/src/fhir-store.ts:123`), the store `seedDatabase` writes to.
- Capabilities (`packages/rbac/src/catalog.ts`): `settings.view`, `settings.edit_general`, `settings.feature_flags`, `settings.danger_zone` (66-69). `lab_admin` has every capability (`presets.ts:51`). Only `lab_admin` holds any `settings.*`, `users.*`, `roles.*`, `connectors.manage`, `ingest.run`, `data.export`.
- `recordAudit(ctx, req, d: AuditDetails): Promise<void>` (`apps/server/src/audit-helper.ts:16`). Example: `settings-routes.ts:493-496`.
- `ctx.appSettings`: `get(key)`, `getAll()`, `set(key, value: string, updatedBy: string | null)` (`packages/db/src/app-settings-store.ts:13-17`). Example of a simple install-wide flag: `update.enabled` (`bootstrap/src/update-check.ts:84-96`, route `settings-routes.ts:483-498`).
- Route tests: the smallest to copy is `apps/server/src/setup-routes.test.ts` (47 lines). It builds a minimal `ctx`, injects a user with given capabilities through an `onRequest` hook, and calls `app.inject`. `ctxWith` (`test-helpers.ts:481`) is the full fake; note `appSettings: {} as never` (540).
- `docs/HTTP-API.md`: one table row per route, `| Method | Path | Purpose |`. Settings section at 304-314.

## D. `apps/web`

- The landing install block is `InstallBlock` in `apps/web/src/components/InstallBlock.tsx:65`, with `COMMANDS` at 9-15 and tabs `unix`, `windows`, `wsl`. Mounted at `App.tsx:42`.
- Web docs pages are found by glob in `apps/web/src/docs/content.ts` (16). `NAV` is at 54-65; the standalone entry is `{ slug: 'install', children: ['windows-server', 'standalone', 'upgrading'] }` (57).

## Gaps the research found

- Studio's `SETUP_CHECK_IDS` and `SETUP_HINTS` (`api.ts:3349-3353`) lack `'facilities'` and `'facilitiesUnmatched'`, which the server sends (`setup-checks.ts:15,20,158`). `en.ts:606` already has the label. The first-run "You are ready" step shows this list, so part 2 has to fix it.
- `docs/HTTP-API.md` lacks `/api/settings/lab` and `/api/auth/setup`.
- `GET /api/settings/lab` needs `reports.view`; `PUT` needs `settings.edit_general`. The first administrator holds both.

## What the builder check said that is not in the design

The design already holds its decisions. These smaller risks are for the builder:

- On macOS 13 and later, Electron's hidden-at-login options may not work. The app may need its own way to tell it was started at sign-in.
- An ad-hoc `codesign --deep` does not reach executables under `Contents/Resources`, which is where Postgres sits.
- Postgres on Windows usually needs the Visual C++ runtime. Check what the Windows package ships.
- Windows gives a program a few seconds at shutdown. The launcher's stop can wait 60 seconds (`STOP_WAIT_MS`, `commands.ts:75`).
