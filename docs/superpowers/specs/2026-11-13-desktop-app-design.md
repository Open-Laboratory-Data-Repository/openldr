# Desktop app: design

Status: approved by the operator on 2026-11-13. No product code written.
Date: 2026-11-13.
Relates to: `2026-11-12-local-sign-in-design.md` (design A), `2026-11-12-standalone-run-design.md`
(design B), `2026-11-13-cli-through-the-app-design.md` (design C). All three are merged.

## 1. What this is and why

Design B made OpenLDR start from one command with no Docker. That command needs a built
checkout of this repo, so only a developer can use it.

This design puts that launcher in a desktop app that a person installs with one line. The
app opens a window, starts OpenLDR on the same computer, and walks the person through the
first steps. It runs on Windows, macOS and Linux.

This is design D of four. It needs A, B and C, and changes none of their decisions.

The user action that is broken today: a person without the repo cannot run the standalone
tier at all. `README.md:216` says "There is no installer yet, so you run it from a built
checkout."

Who installs it: someone who knows how to install software. Not a first-time computer user.
The operator's bar is the Docker tier's one-line installer on the landing page.

## 2. Gap check

Each gap was checked against the code on `main` at `3981c990`.

| Gap | Proof |
|---|---|
| No desktop app exists | No `package.json` in the repo names Electron, a builder or Tauri. There is no `apps/desktop` on `main`. |
| The launcher is a command, not something a program can drive | `apps/standalone/package.json:6` has `bin` only. `runStart` prints text lines for a person. |
| The setup page cannot receive a setup code | `apps/studio/src/auth/SetupPage.tsx:83-93` is a typed field. The page reads no outside value. |
| Nothing guides the person after the first administrator is made | Studio opens on an empty dashboard. The nearest thing is `apps/studio/src/pages/settings/SetupChecks.tsx`, three clicks away. |
| Sample data can only be loaded from the command line | `packages/cli/src/db.ts:141` (`runDbSeed`). No HTTP route calls `seedDatabase`. |
| Nothing builds for Windows or macOS | The repo has no build service. Releases run from one Linux machine: `package.json:30` (`release`), `package.json:72` (`publish:images`). |
| The launcher has never run on Windows or macOS | `apps/standalone/src/postgres.ts:80` and `apps/web/src/docs/0.1.8/en/standalone.md:5` both say only Linux is tested. |

A throwaway app was built to test the idea (branch `worktree-desktop-spike`, last commit
`9b2d35e1`). It is not the base for this work. What it showed, on Ubuntu 26.04:

- The launcher runs unchanged as a child process of Electron 45.3.0, with Electron's own
  binary acting as Node 24.22.2. So the app needs no separate Node.
- Studio loads in the window and the setup page appears.
- Closing the window stopped the launcher cleanly and left no process behind.
- Electron's sandbox does not start for an app that has no AppArmor profile. From a normal
  terminal the app aborts with "The SUID sandbox helper binary was found, but is not
  configured correctly". Installing a profile needs administrator rights. The throwaway runs
  with the sandbox off for that reason. Section 6.7 says what the real install does.

## 3. Goals, non-goals, anti-goals

### Goals

1. One line installs the app on Windows x64, macOS on Apple silicon, and Linux x64. No
   administrator rights are needed on Windows and macOS. On Linux the install asks for the
   administrator password once, where the system needs it for the sandbox (section 6.7).
2. Opening the app starts OpenLDR on that computer and shows Studio in a window.
3. On the first run the person chooses a username and a password, and nothing else. The app
   hands the setup code to Studio.
4. After the first administrator is made, Studio leads the person through naming the
   laboratory, offers sample data, and shows what still needs them. Every install on local
   sign-in gets this, Docker included.
5. Sample data loads only when an administrator asks, and only into an install that holds
   no lab data yet.
6. Closing the window does not stop OpenLDR. It keeps running, with an icon in the system
   tray. Quit stops it.
7. The same one line updates the app. A second option removes it.
8. The install gives the person the `openldr-standalone` command, working on the same data.

### Non-goals

- Signing and notarising the app. The operator decided: not in the first release.
- A double-click installer (`.exe`, `.dmg`, `.deb`). The one line is the supported way in.
- Updating itself. An update is the one line, run again.
- Going back to an older version. An older app refuses a data folder that a newer one used.
- Intel Macs, Linux on ARM, Windows on ARM. Nobody here can try them.
- Letting other computers on the network reach this OpenLDR. The app listens on this
  computer only. The command-line launcher still has `--host`.
- A build service. Packages are built on the machine that makes releases today.
- Keycloak. The app runs the standalone tier, which uses local sign-in.
- Changing what the standalone tier is: bundled Postgres, files on disk, local sign-in.

### Anti-goals

These would make the work a failure even if it runs.

- Sample data loaded without being asked, or into a lab that already has data. Design B
  already forbids the first (`2026-11-12-standalone-run-design.md:92-93`).
- A setup code, password, key or token in a log, on the starting page, in the tray, or in
  the app's own settings file.
- The app stopping OpenLDR by killing its process. That skips the database's clean shutdown.
- Two databases started on one data folder.
- The installed app running with its sandbox off, on any system. The operator decided: on
  Linux the install asks for the administrator password once so the sandbox can stay on.
- A first-run flow that exists only in the desktop app. The operator decided it lives in
  Studio.
- Onboarding steps that a person cannot leave. Every step after the administrator can be
  skipped.
- The app's own files mixed into OpenLDR's data folder.

## 4. Constraints

- AGENTS.md section 6 applies. The Studio screens need English, French and Portuguese, a
  phone layout, in-app docs and web docs. New launcher options are CLI surface and need docs.
- AGENTS.md section 5 applies to every Studio screen. The first-run pages copy
  `apps/studio/src/auth/SetupPage.tsx`.
- The launcher's rules from design B stand: a lock with a live control port decides who owns
  a data folder, and a recorded process ID is never proof of anything.
- Design C's rule stands: a command that is not a recovery command goes through the running
  app as a signed-in caller.
- Node on Windows cannot send a signal that a program can catch. Killing a child there ends
  it at once. So nothing in this design may rely on a signal to stop the launcher.
- A package for Windows or macOS is built on Linux and cannot be run there. Each release is
  tried on the operator's Windows laptop and Mac mini before it ships.
- A check run from the builder's own shell on this machine does not prove what a normal
  terminal does: that shell runs under another app's AppArmor profile. Anything about the
  sandbox is checked with `aa-exec -p unconfined`.
- `pnpm depcruise` must stay at 21 violations.

## 5. Approaches

Three ways were weighed. The operator picked the first.

**1. Packages built on the release machine, installed by a script. Chosen.** The release
script makes one archive per system. Each holds Electron for that system, the app's files
and that system's Postgres. A one-line script fetches the right archive, checks it, unpacks
it and adds a menu entry. It fits how releases are made today and adds no service and no
packaging tool. It gives no double-click installer, which matches "no signing yet". Its cost:
a package built on Linux has to be tried on the other two machines by hand.

**2. A build service that makes real installers.** GitHub's build machines would build on
each system with a packaging tool and produce `.exe`, `.dmg` and AppImage files. It is the
usual route and the best base for signing later. It adds a build service and a large tool
the repo has never had, and an unsigned installer still warns on double-click, so the one
line would stay the only supported way in. It can be added later without undoing way 1.

**3. The launcher inside the app's own process.** No child process and no channel between
the two. Rejected: the launcher changes its whole process when it starts (environment, crash
handlers), and a server crash would take the window with it.

Tauri was also set aside. It would still need a Node shipped beside it, and the throwaway
showed Electron can be that Node.

## 6. How it works

### 6.1 The parts

```
one-line script ──fetches──> archive ──unpacks──> the app
                                                   │
        the app (Electron)                         │
        ├─ main process: window, tray, settings    │
        ├─ starts ──> launcher (apps/standalone) as a child process, Electron acting as Node
        │              ├─ Postgres
        │              └─ the server, which serves Studio
        └─ window ──loads──> Studio from the server on this computer
                              └─ asks the app for the setup code
```

A new workspace package, `apps/desktop`, holds the app. It is plain Electron: a main
process, a preload script, and two or three small pages of its own (starting, stopping, an
error page). Everything else the person sees is Studio.

### 6.2 The app and the launcher

The app starts the launcher's `start` command as a child process. It uses its own Electron
binary with `ELECTRON_RUN_AS_NODE=1`, so the launcher runs as it does under Node.

**Data folder.** The launcher's own default for each system (`apps/standalone/src/state.ts`,
`resolveDataDir`). The app and the command-line launcher then share one install.

**Port.** 3000 when it is free. If not, the app picks another free port and remembers it in
its settings file, so the address stays the same from then on. The app always passes
`--host 127.0.0.1`.

**Knowing what the launcher is doing.** The launcher gains one option, `--events-fd <n>`.
With it, the launcher writes one JSON object per line to that file descriptor: that Postgres
is starting, that the database is recovering, that OpenLDR is ready and at which address,
that it is stopping, that it has stopped and how, and an error with its message. No event
ever carries a secret. The app opens the descriptor as a pipe when it starts the child. The
launcher's printed lines stay as they are for a person at a terminal.

**The setup code.** With `--events-fd`, the launcher does not make or print a setup code at
start. The app asks for one only when Studio needs it, by running
`openldr-standalone cli -- auth setup-code --json` as a second short child process. That is
an existing recovery command (`packages/cli/src/auth.ts`). It also covers a code that
expired while the setup page sat open: Studio asks again and gets a fresh one.

**Stopping.** The app stops OpenLDR by running the launcher's `stop` command and waiting for
the child to end. `stop` goes through the control port, which works the same on all three
systems. The app never signals the launcher.

**The computer shuts down, or the person signs out.** The app asks OpenLDR to stop and holds
the shutdown for as long as the system lets it. If the system ends the processes anyway, the
database recovers at the next start. Design B already handles that and says so on screen.

**A launcher that is already running.** If the lock is live when the app starts, another
launcher owns the data folder: one started from the command line, or one left by an app that
was killed. The app does not start a second. It reads the address with the launcher's
`status` command and shows that OpenLDR. Quit still stops it, through `stop`. If that
launcher listens on an address that is not this computer's own, the app still shows it, and
does not answer Studio's request for a setup code (section 6.4).

**A recovery command that holds the folder.** `status` then says so (the follow-up to design
B, `baf78198`). The app shows that line and offers to try again.

**A data folder from a newer version.** The launcher records, in its state file, the version
that last started the data folder. A launcher older than that version refuses to start and
names both versions. Without this the database fails with a migration error that tells the
person nothing. This guard is for every launcher, not only the app's.

**The launcher ends by itself.** The app shows its error page with the launcher's last
message, the paths of `logs/server.log` and `logs/postgres.log`, and a button to start again.

### 6.3 The window, the tray and quitting

- One window. It shows the app's starting page until the launcher says OpenLDR is ready, then
  Studio.
- Closing the window hides it. OpenLDR keeps running.
- A tray icon with a menu: Open OpenLDR, Start when I sign in (a tick, off at first), Open
  the log folder, Quit.
- Quit shows the stopping page, runs `stop`, waits, then exits.
- Starting the app a second time shows the window of the first. This is also the way back
  in on a desktop that shows no tray icons.
- A link that leaves OpenLDR opens in the person's browser.
- The window loads only the launcher's own address. It has context isolation on, Node
  integration off, and the sandbox on.
- "Start when I sign in" uses Electron's login-item setting on Windows and macOS, and a
  file in `~/.config/autostart` on Linux. Started this way, the app opens no window. If a
  system gives the app no way to tell it was started at sign-in, the window opens there and
  the docs say so.
- The app keeps its own files (its settings, and Electron's own browser profile) in a folder
  named `OpenLDR Desktop`, never in OpenLDR's data folder. On macOS Electron's default would
  be `~/Library/Application Support/OpenLDR`, which is the data folder
  (`apps/standalone/src/state.ts:105`), so the name is set on purpose.
- The settings file holds the port, start at sign-in and the window size. It holds no secret.
- The app's own words (starting page, tray menu, errors) are in English, French and
  Portuguese, following the system language.

### 6.4 What Studio asks the app for

The preload script gives pages at the launcher's address one object, `window.openldrDesktop`,
through Electron's context bridge. Studio checks whether it exists. In a browser, and on a
Docker install, it does not.

| Call | What the app does |
|---|---|
| `setupCode()` | Runs `cli -- auth setup-code --json` and returns the code. Fails once an administrator exists, as the command does. |
| `info()` | The app's version and the system it runs on. No secret. |

Nothing else is exposed. The app answers only a page on the launcher's address, and only
when that address is this computer's own (`127.0.0.1`, `localhost` or `[::1]`).

### 6.5 First run, in Studio

**Create the administrator.** `SetupPage` asks `window.openldrDesktop.setupCode()` when it
exists. The setup code field is then filled and locked, and its hint says the app filled it
in. If the call fails, the field stays empty and typed entry works as today. Without the
desktop object the page is unchanged.

**The steps after it.** A new first-run flow in Studio, shown once, straight after
`POST /api/auth/setup` succeeds. It is shown to the person who just became the first
administrator and to nobody else.

```
1. Name the laboratory     name and time zone          Save, or Skip
2. Sample data             Load sample data, or Skip
3. You are ready           the setup checks that still need you, each with its link
                           Open OpenLDR
```

- Step 1 writes through the existing `PUT /api/settings/lab`
  (`apps/server/src/settings-routes.ts:89`). The time zone is picked from a list, not typed,
  and the browser's own zone is offered first.
- Step 2 says in one sentence what sample data is, and loads it through the new route in
  section 6.6. It is not shown when the route says the install already holds lab data.
- Step 3 shows the same list as Settings, Setup checks, from the existing
  `POST /api/settings/setup-checks`. Passing checks are not listed.
- Every step can be skipped. Skipping all three lands on the dashboard.
- Studio remembers, for the install, that the flow was shown, so it never shows twice. The
  Setup checks page stays the permanent place for all of it.
- An install that signs in with Keycloak never sees `SetupPage`, so it never sees this flow.
  It keeps the Setup checks page.

### 6.6 Sample data from Studio

A new server route loads the sample data that `openldr db seed` loads, by calling the same
`seedDatabase` (`packages/bootstrap/src/seed.ts`).

- It needs a signed-in caller with a capability that the administrator role has and no
  lesser role has.
- It refuses when the install already holds lab data. A second route, or the same one asked
  first, tells Studio whether loading is allowed, so step 2 can hide itself.
- It writes an audit row.
- `openldr db seed` stays as it is, so the command line has the same thing.

Sample data was first meant to be a call the desktop app answers. That was dropped: any page
in the window could have called it, signed in or not, on a lab with real data. A route can
check who is asking and what the install holds.

### 6.7 Packages and the release

The release script gains a step that makes three archives:

| System | File | Holds |
|---|---|---|
| Linux x64 | `openldr-desktop-<version>-linux-x64.tar.gz` | Electron for Linux, the app, `@embedded-postgres/linux-x64` |
| macOS arm64 | `openldr-desktop-<version>-darwin-arm64.tar.gz` | `OpenLDR.app` with Electron for macOS, the app, `@embedded-postgres/darwin-arm64` |
| Windows x64 | `openldr-desktop-<version>-win32-x64.zip` | Electron for Windows, the app, `@embedded-postgres/windows-x64` |

"The app" is the same in all three: `apps/desktop`'s files, the launcher's `dist`, Studio's
`dist`, the terminology files, the launcher's run-time packages
(`apps/standalone/tsup.config.ts:41-49`), and a small `openldr-standalone` command that runs
the launcher with the app's own Electron acting as Node.

The archive keeps the launcher's layout. The launcher finds Studio at `../studio/dist` and
the version in the root `package.json`, relative to itself, and both must still be there.

`cpu-features` is left out of every archive. It is the one run-time package that compiles at
install. `ssh2` loads it inside a `try` and works without it, and this checkout does not
build it today either. Nothing else is compiled for another system: Electron ships a built
binary for each, and the Postgres packages are built binaries too. If another run-time
package turns out to need compiling for Windows or macOS, the builder stops and reports it.

The step also writes `SHA256SUMS` with one line per archive.

**Order in a release.** The three archives are built and checked before the release is
tagged. A build that fails stops the release there: tagging, pushing and creating the GitHub
release cannot be undone (`scripts/release.ts`). The archives and `SHA256SUMS` are uploaded
to the release's page after it is created. If an upload fails, the script says which file is
missing and how to upload it by hand.

The version is the repo's version, as the launcher already reads it.

### 6.8 The one-line installers

Two scripts, beside the Docker ones in `install/`:

- `install/desktop.sh` for Linux and macOS, run with `curl ... | bash`.
- `install/desktop.ps1` for Windows, run with `irm ... | iex`.

Each one:

1. Works out the system and refuses one that has no package, naming it.
2. Finds the newest release that has an archive for this system, or the one named by
   `--version`.
3. Fetches the archive and `SHA256SUMS`, and stops if the checksum does not match.
4. Refuses to go on while OpenLDR is running from an older copy, and says to quit it first.
5. Unpacks into the person's own folder and replaces an older copy of the app. The data
   folder is never touched.
6. Adds a menu entry.
7. Says where the app is, how to start it, and the full path of `openldr-standalone`.

| System | Where the app goes | Menu entry |
|---|---|---|
| Linux | `~/.local/share/openldr-desktop/` | `~/.local/share/applications/openldr.desktop` |
| macOS | `~/Applications/OpenLDR.app` | Launchpad finds it there |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR\` | A Start menu shortcut |

**The command.** On Linux and macOS the script links `openldr-standalone` into `~/.local/bin`
when that folder is on the person's `PATH`. Otherwise, and always on Windows, it prints the
full path and changes no `PATH`.

**The sandbox on Linux.** Where the system restricts user namespaces
(`kernel.apparmor_restrict_unprivileged_userns` is 1, the default on Ubuntu 24.04 and
later), the script installs a small AppArmor profile for the app's binary, so the sandbox can
start. That step runs under `sudo` and asks for the administrator password once. The script
says what it is about to do and why before it asks. If the person declines, the install
stops and removes what it unpacked; it never falls back to running with the sandbox off. On
a system without the restriction the script asks for nothing. An update asks again only when
the profile has to change. `--uninstall` removes the profile, which asks again.

**macOS.** If macOS refuses to open the unpacked app or the Postgres inside it, slice 1
finds out why and what fixes it. One candidate is signing the binaries on that Mac with an
ad-hoc signature. The design promises no particular fix before slice 1 has run.

`--uninstall` removes the app, its menu entry, the command link and the app's own
`OpenLDR Desktop` folder. It leaves the data folder and says where the data is.

### 6.9 Landing page and docs

- The landing page shows the desktop one-liner beside the Docker one.
- Web docs get a "Desktop app" page under install: install, first run, tray, update, remove,
  where the data is, and what to do when it will not start. In English, French and Portuguese.
- In-app docs get the first-run flow as a how-to, in the three languages.
- `README.md:216` and `apps/web/src/docs/0.1.8/*/standalone.md` stop saying there is no
  installer.
- `docs/CLI-REFERENCE.md` gets `--events-fd`. `docs/HTTP-API.md` gets the sample data route.

## 7. Slices

In this order. Each ends with something that runs.

1. **Prove the launcher on Windows and macOS.** Package the throwaway by hand for both, and
   try it on the laptop and the Mac mini. Fix what breaks in `apps/standalone`. Find out
   here:
   - whether an unsigned app fetched by a terminal command opens without a warning on each
     system, Windows 11's newer app check included;
   - whether macOS refuses the app or the Postgres inside it, and what fixes that;
   - whether the Windows Postgres package runs on a Windows with no Visual C++ runtime
     installed;
   - whether the AppArmor profile lets the sandbox start on Linux from a normal terminal.

   If Windows or macOS cannot be made to work, stop and report before any other slice.
2. **The launcher's changes.** `--events-fd`, no setup code at start when it is given, and
   the newer-version guard.
3. **The app.** Window, starting and stopping pages, error page, tray, quit, second start,
   attaching to a running launcher, shutdown, its own folder, the settings file.
4. **The setup code hand-over.** The preload object, and `SetupPage` using it.
5. **Sample data from Studio.** The route and its checks.
6. **First run in Studio.** The three steps, in three languages, on a phone, with docs.
7. **Packages.** The release step, `SHA256SUMS`, and the order in a release.
8. **The one-line installers.** Install, update, remove, on three systems, with the Linux
   profile.
9. **Landing page and docs.**
10. **The real run.** One line on each of the three machines, then the first-run flow by
    hand on each.

## 8. Verification

| What | How | Where |
|---|---|---|
| Launcher events, the version guard, the settings file, the bridge's rules | Unit tests | Linux, in the gate |
| The sample data route | Route tests: refused without the capability, refused when lab data exists, audited | Linux, in the gate |
| First-run flow in Studio | Component tests, then the built-in browser at 375 x 812 | Linux |
| Install scripts | Tests that run the script against a fake release, as `packages/release/src/shell.test.ts` does for `install.sh` | Linux for `desktop.sh`. `desktop.ps1` cannot be run here. |
| The app itself: window, tray, quit, second start | A real run | Linux by the builder. Windows and macOS by the operator, from a checklist. |
| The sandbox on Linux | The installed app started with `aa-exec -p unconfined`, with and without the profile | Linux |
| Packages built on Linux for the other two | Fetched and opened | The operator's laptop and Mac mini |
| No secret in a log | Search the app log, the server log and the events for the setup code after a first run | Linux |

HONEST NON-PROOF, stated now:

- The builder cannot see a window on Windows or macOS. Everything there rests on the operator
  running a checklist and reporting what they saw.
- A tray icon cannot be checked by a test. It is looked at on each system.
- Whether Windows 11's newer app check objects to an unsigned app is not known. Slice 1
  finds out.
- The AppArmor profile is tried on this Ubuntu 26.04 only. Other Linux systems are not tried.
- What each system does to the app at shutdown is seen only by shutting a machine down.

## 9. Left to the builder

- The names and exact shape of the launcher's events.
- The format of the app's settings file.
- How the run-time packages for another system are gathered on Linux.
- Where Studio records that the first-run flow was shown.
- The sample data route's path, its capability, and what counts as "holds lab data", within
  section 6.6.
- The text of the AppArmor profile, within section 6.8.
- How the app tells it was started at sign-in, on each system.
- The tray and app icons, from the existing logo.
- Whether the first-run flow is one page with steps or three routes.
- The wording of every message, in three languages.

## 10. Calls I made for the operator to check

1. The launcher runs as a child process, with Electron acting as Node.
2. The app never reads the setup code from the launcher's start. It asks for one when Studio
   needs it.
3. Studio reaches the app through one small object with two calls, and only on this
   computer's own address.
4. Sample data loads through a new server route, for an administrator, only while the
   install holds no lab data. Every install gets the step, not only the desktop app.
5. The first-run flow is shown once, to the person who creates the first administrator, on
   local sign-in. Keycloak installs keep the Setup checks page only.
6. The app uses the launcher's default data folder, so the app and `openldr-standalone` share
   one install.
7. Port 3000, or a remembered free port.
8. This computer only. No setting to open OpenLDR to the network.
9. Stopping always goes through the launcher's `stop` command.
10. At shutdown the app asks OpenLDR to stop and holds on as long as the system allows. A
    forced end is left to the database's own recovery.
11. An app that was killed leaves OpenLDR running. The next start shows it.
12. An older launcher refuses a data folder that a newer one used, for every launcher.
13. The app's own files live in a folder named `OpenLDR Desktop`.
14. Archives are `.tar.gz` for Linux and macOS and `.zip` for Windows, published with a
    `SHA256SUMS` file on the GitHub releases page.
15. The archives are built before the release is tagged. A failed build stops the release.
16. `cpu-features` is left out of the archives.
17. The install gives the `openldr-standalone` command, linked onto `PATH` only where
    `~/.local/bin` is already on it.
18. On Linux, a person who declines the password gets no install. There is no sandbox-off
    fallback.
19. An update refuses to run while OpenLDR is running. No older copy is kept.
20. The app's own words are in three languages.
21. The throwaway is not kept. The real app is written fresh.
22. Slice 1 is a stop point. If Windows or macOS cannot run the launcher, the rest waits for
    the operator.

## 11. Noticed, not fixed

- `apps/studio/src/i18n/en.ts:18` tells every person to run `openldr auth setup-code`. In the
  desktop app that hint is wrong; this design changes it only when the app fills the field.
- The launcher prints the setup code to the terminal at start. That stays for the
  command-line launcher.
- The checksum file proves an archive arrived whole. It does not prove who made it. Signing
  the archives with the publisher key that signs content packs would, and is not in this
  design.
- A developer running the app from a checkout on Ubuntu still needs `--no-sandbox`, because
  the profile is installed for the installed app's path only.
