# Desktop App Part 1: Windows and macOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out whether the standalone launcher, wrapped in the throwaway desktop app, runs on the operator's Windows laptop and Mac mini, and fix what stops it.

**Architecture:** A throwaway script on the spike branch packs the throwaway app for three systems on this Linux machine. The operator fetches each package with one terminal line and works through a checklist. Faults in `apps/standalone` are fixed on a real branch with tests, re-packed and re-tried. The findings are written down for part 3.

**Tech Stack:** Electron 45.3.0, `@electron/get`, `embedded-postgres` 16.15.0-beta.19 and its platform packages, Node 24, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-11-13-desktop-app-design.md` (section 7, slice 1; section 6.8 for the Linux profile).

This is part 1 of three. Part 2 is the launcher's changes, the app and the first run in Studio. Part 3 is packages, installers and docs, and is written after this part, from its findings.

## Global Constraints

- This part is the design's stop point. If Windows or macOS cannot be made to run the launcher, stop and report. Do not start part 2's Windows or macOS work on a guess.
- The packing script and the throwaway app stay on the branch `worktree-desktop-spike`. They are never merged.
- A fix to `apps/standalone` is product code. It goes on a new branch cut from `main`, with a test where Linux can pin the fault, and through the forced gate before any merge question.
- Systems: Windows x64, macOS arm64, Linux x64. No others.
- Electron `45.3.0`. `embedded-postgres` and `@embedded-postgres/*` at `16.15.0-beta.19`.
- `cpu-features` is left out of every package.
- Nothing is compiled for another system. If a package needs compiling for Windows or macOS, stop and report.
- The dev stack on this machine is in use: a server on port 3000, Postgres on 5433, Keycloak on 8180. Never stop, restart, change or connect to it.
- Anything started here uses ports 3990 to 3997 and folders under the system temp folder, and is stopped and removed afterwards.
- Never print a password, key, token or setup code.
- Anything about Electron's sandbox on Linux is checked with `aa-exec -p unconfined`. The builder's own shell runs under another app's AppArmor profile and proves nothing.
- The builder does not log in to the operator's laptop or Mac. The operator runs every step on those machines, unless they say otherwise.
- `pnpm depcruise` stays at 21 violations.

## Review Focus

These are the conditions the design implies and no step below pins by a test. Each has an owner task.

1. **A home folder with a space or a non-English letter in its name** (`C:\Users\First Last`). The app and Postgres must still start. Owner: Task 3, checklist line 9.
2. **A second start after the app was killed.** Postgres is left running; the next start must stop it and carry on. On Windows this goes through `pg_ctl`, which has never run. Owner: Task 3 and Task 4, checklist line 8.
3. **Port 3990 already taken.** The app must pick another port and still open. Owner: Task 1, step 6.
4. **The system's own protection removing a file after unpacking** (Windows Defender, macOS Gatekeeper). The checklist must catch a missing binary, not only a warning box. Owner: Task 3 and Task 4, checklist line 2.
5. **Closing the window on Windows.** The launcher must stop through its `stop` command. A killed launcher leaves Postgres running. Owner: Task 1, step 3, and checklist line 6.

---

### Task 1: Pack the throwaway for three systems

**Files (all on `worktree-desktop-spike`):**
- Create: `apps/desktop/pack-spike.mjs`
- Modify: `apps/desktop/main.mjs` (stop through the launcher's `stop` command; data folder per system)
- Modify: `apps/desktop/package.json` (script `pack`)
- Modify: `apps/desktop/README.md`

**Interfaces:**
- Produces: `node apps/desktop/pack-spike.mjs <linux-x64|darwin-arm64|win32-x64> <out-folder>` writes `openldr-spike-<system>.tar.gz` (Linux, macOS) or `openldr-spike-<system>.zip` (Windows) and prints the file's path and SHA-256.
- Produces: the layout inside every package, which Task 2's fetch lines and part 3 rely on:

```
linux-x64, win32-x64:   openldr-spike/<Electron's files>, openldr-spike/resources/app/...
darwin-arm64:           OpenLDR.app/Contents/..., OpenLDR.app/Contents/Resources/app/...

resources/app/package.json            name, version (the repo's), "main": "apps/desktop/main.mjs"
resources/app/apps/desktop/           main.mjs, starting.html
resources/app/apps/standalone/dist/   index.js, cli.js
resources/app/apps/standalone/fixtures/
resources/app/apps/standalone/node_modules/   the launcher's run-time packages for that system
resources/app/apps/studio/dist/
```

The launcher finds Studio at `../studio/dist` and the version in the root `package.json`, both relative to itself. This layout keeps both true.

- [ ] **Step 1: Bring `main` into the spike branch**

The spike branch was cut before the two design B follow-ups. Merge `main` into `worktree-desktop-spike` so the packed launcher has them. Expected: no conflicts; `apps/desktop` untouched.

- [ ] **Step 2: Make the throwaway choose its data folder per system**

In `apps/desktop/main.mjs`, the default data folder becomes: Linux `~/.local/share/openldr-desktop-spike`, macOS `~/Library/Application Support/openldr-desktop-spike`, Windows `%LOCALAPPDATA%\openldr-desktop-spike`. `OPENLDR_DESKTOP_DATA` still overrides it. Find the launcher at `../standalone/dist/index.js` relative to `main.mjs`, as now.

- [ ] **Step 3: Make the throwaway stop the launcher through `stop`**

Replace the `SIGINT` in `stopLauncher()` with a second child process: the same binary and environment, arguments `[launcherEntry, 'stop', '--data-dir', dataDir]`. Wait for the first child to exit. On Windows a signal ends the launcher at once and leaves Postgres running, so a signal must not be used anywhere.

- [ ] **Step 4: Check both changes on Linux**

Run from `apps/desktop`, with a temp data folder and the self-check picture path set:

```bash
OPENLDR_DESKTOP_DATA=/tmp/openldr-spike-check/data OPENLDR_DESKTOP_SELFTEST_SHOT=/tmp/openldr-spike-check/shot.png aa-exec -p unconfined -- pnpm dev
```

Expected: exit 0, one `SELFTEST` line with `"setupPage":true`, and afterwards no process whose command line names `/tmp/openldr-spike-check`. Remove the temp folder.

- [ ] **Step 5: Write `apps/desktop/pack-spike.mjs`**

What it does, in order:

1. Refuse a system other than the three, naming the ones it takes.
2. Fetch Electron `45.3.0` for that system with `downloadArtifact` from `@electron/get` (`artifactName: 'electron'`), and unpack it. Keep symbolic links: the macOS package is full of them.
3. Build the `resources/app` tree shown above from this checkout: `apps/standalone/dist`, `apps/standalone/fixtures`, `apps/studio/dist`, `apps/desktop/main.mjs`, `apps/desktop/starting.html`, and a root `package.json` with the repo's `version`. Stop with a message if a build output is missing.
4. Gather the launcher's run-time packages into `resources/app/apps/standalone/node_modules`: `ssh2`, `pdfkit`, `quickjs-emscripten`, `embedded-postgres`, `pg`, each with what it depends on, and `@embedded-postgres/<package for that system>` at `16.15.0-beta.19`. Leave `cpu-features` out. For a system other than this one, fetch the Postgres package from the npm registry and run its own `scripts/hydrate-symlinks.js` against the unpacked copy, as its install would.
5. On macOS, rename `Electron.app` to `OpenLDR.app` and put the app tree in `Contents/Resources/app`.
6. Write the archive and print its path and SHA-256.

Add a `pack` script to `apps/desktop/package.json` that runs it: `"pack": "node pack-spike.mjs"`.

- [ ] **Step 6: Prove the Linux package runs from a folder outside the repo**

```bash
node apps/desktop/pack-spike.mjs linux-x64 /tmp/openldr-spike-out
```

Unpack it under `/tmp/openldr-spike-run`, hold port 3990 with a listener, and start `openldr-spike/electron --no-sandbox` under `aa-exec -p unconfined` with the self-check variables set.

Expected: one `SELFTEST` line with `"setupPage":true` and a `url` on a port other than 3990. No process left. This also proves the layout: the launcher found Studio and the version outside the repo.

- [ ] **Step 7: Pack the other two and check what is inside**

```bash
node apps/desktop/pack-spike.mjs darwin-arm64 /tmp/openldr-spike-out
```

```bash
node apps/desktop/pack-spike.mjs win32-x64 /tmp/openldr-spike-out
```

Expected, from listing each archive:
- macOS: `OpenLDR.app/Contents/MacOS/Electron` is there and executable; the Postgres package's `native/bin/postgres` is there and executable; the links named in its `pg-symlinks.json` exist as links.
- Windows: `openldr-spike/electron.exe` and the Postgres package's `native/bin/postgres.exe` and `pg_ctl.exe` are there.
- Neither holds a `cpu-features` folder or a `.node` file built for Linux.
- Write down whether the Windows Postgres package holds `vcruntime140.dll` and `msvcp140.dll`. If it does not, Postgres needs the Visual C++ runtime on the laptop; that goes in the findings.

- [ ] **Step 8: Commit on the spike branch**

```bash
git add apps/desktop/pack-spike.mjs apps/desktop/main.mjs apps/desktop/package.json apps/desktop/README.md
git commit -m "spike(desktop): pack the throwaway for three systems, stop through the launcher"
```

---

### Task 2: Put the packages where the other two machines can fetch them

**Files:** none in the repo.

**Interfaces:**
- Consumes: the three archives in `/tmp/openldr-spike-out` from Task 1.
- Produces: two lines the operator pastes, one per machine.

- [ ] **Step 1: Serve the folder on this machine's tailnet address**

```bash
python3 -m http.server 3996 --bind "$(tailscale ip -4)" --directory /tmp/openldr-spike-out
```

Run it in the background. It serves three archives and nothing else. The tailnet already encrypts the traffic. Stop it when Task 4 is done.

- [ ] **Step 2: Give the operator the two lines**

They fetch with a terminal command on purpose: that is how the real installer will fetch, and the question is whether the system then warns.

macOS, in Terminal:

```bash
mkdir -p ~/openldr-spike && cd ~/openldr-spike && curl -fsSL http://<this machine's tailnet address>:3996/openldr-spike-darwin-arm64.tar.gz | tar xz && open OpenLDR.app
```

Windows, in PowerShell:

```powershell
$d="$env:LOCALAPPDATA\openldr-spike-app"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest http://<this machine's tailnet address>:3996/openldr-spike-win32-x64.zip -OutFile "$d\spike.zip"; Expand-Archive "$d\spike.zip" $d -Force; & "$d\openldr-spike\electron.exe"
```

- [ ] **Step 3: Check each line's address from this machine**

```bash
curl -sI http://$(tailscale ip -4):3996/openldr-spike-darwin-arm64.tar.gz
```

Expected: `200 OK` and a `Content-Length` equal to the archive's size. The same for the Windows archive.

---

### Task 3: The Windows laptop

**Files:**
- Create: `docs/superpowers/specs/2026-11-13-desktop-app-part-1-findings.md` (started here, finished in Task 6)

The operator runs the Windows line from Task 2 and answers the checklist. The builder records each answer in the findings file, word for word where the system showed a message.

- [ ] **Step 1: The checklist**

1. Did Windows show a warning or block anything while fetching, unpacking or starting? Give its words.
2. Did a window open? If not: is `electron.exe` still in the folder?
3. What did the starting page show? Copy its lines.
4. Did Studio's "Create the administrator" page appear, with the setup code already filled?
5. Create the administrator. Did Studio open?
6. Close the window. Did a "Stopping OpenLDR" page show, and did the app exit by itself?
7. After it exited: does `Get-Process postgres -ErrorAction SilentlyContinue` print anything?
8. Start it again with the last part of the line (`& "$d\openldr-spike\electron.exe"`). Does it open on the sign-in page, with the administrator you made? Then end `electron.exe` from Task Manager, start it once more, and say what happens.
9. What is the Windows user folder's name? Say only whether it has a space or a non-English letter.
10. If anything failed: the last 40 lines of `logs\server.log` and `logs\postgres.log` under `%LOCALAPPDATA%\openldr-desktop-spike`, with any setup code line removed.

- [ ] **Step 2: Record the answers**

Write a "Windows" section in the findings file: one line per checklist item, PROVEN or BROKEN, with the operator's words.

---

### Task 4: The Mac mini

The same checklist as Task 3, with these changes.

- [ ] **Step 1: The checklist**

1 to 6 as in Task 3, reading "macOS" for "Windows" and `OpenLDR.app` for `electron.exe`.
7. After it exited: does `pgrep -lf postgres` print anything?
8. Start it again with `open ~/openldr-spike/OpenLDR.app`. Does it open on the sign-in page? Then end it with `pkill -f OpenLDR.app/Contents/MacOS/Electron`, start it once more, and say what happens.
9. If macOS refused to open the app or said it was damaged, run `xattr -l ~/openldr-spike/OpenLDR.app` and give its output.
10. If anything failed: the last 40 lines of `logs/server.log` and `logs/postgres.log` under `~/Library/Application Support/openldr-desktop-spike`, with any setup code line removed.

- [ ] **Step 2: Record the answers**

Write a "macOS" section in the findings file, in the same form.

- [ ] **Step 3: Stop the file server from Task 2**

Expected: nothing listens on port 3996.

---

### Task 5: Fix what broke in the launcher

Skip this task if Tasks 3 and 4 found no fault in `apps/standalone`.

**Files:**
- Modify: files under `apps/standalone/src`, named by what Tasks 3 and 4 found
- Test: the matching `*.test.ts` beside each

**Interfaces:**
- Produces: a branch `worktree-desktop-other-systems`, cut from `main`, holding only launcher fixes.

- [ ] **Step 1: One fault at a time, cause first**

For each BROKEN line, find the cause from the logs before changing anything. Write it in the findings file as "cause", with `file:line`.

- [ ] **Step 2: A failing test where Linux can show the fault**

A wrong path, a wrong argument or a wrong message can be pinned on Linux by giving the function the other system's name. Write that test and see it fail. A fault that only the other system's kernel or tools can show gets no test; mark it "proven by the operator's run only".

- [ ] **Step 3: Fix, and see the test pass**

- [ ] **Step 4: Re-pack and ask the operator to run the line again**

Merge the fix branch into the spike branch, run Task 1 step 7 for that system, serve it as in Task 2, and repeat the checklist lines that were BROKEN.

- [ ] **Step 5: Stop after three rounds on one system**

If a system is still BROKEN after three rounds, stop. Write what is known and what was tried, and put it to the operator. This is the design's stop point.

- [ ] **Step 6: The forced gate on the fix branch, then commit**

```bash
pnpm turbo run test --force --concurrency=2 --continue
```

```bash
pnpm turbo run typecheck --force --concurrency=2
```

```bash
pnpm depcruise
```

Expected: both exit 0, and 21 violations. Redirect each to a file and read the exit code after the redirect. Then commit each fix by itself, files staged by name.

---

### Task 6: The sandbox on Linux, and the findings

**Files:**
- Modify: `docs/superpowers/specs/2026-11-13-desktop-app-part-1-findings.md`

- [ ] **Step 1: Write the AppArmor profile for the unpacked Linux package**

A profile for the one binary at `/tmp/openldr-spike-run/openldr-spike/electron` that allows user namespaces and nothing more than the other Electron apps' profiles on this machine allow (`/etc/apparmor.d/claude-desktop` is the pattern to copy). Save it under the temp folder.

- [ ] **Step 2: The operator installs it**

Loading a profile needs the administrator password, which the builder does not have. Give the operator one line that copies the profile into `/etc/apparmor.d/` and loads it with `apparmor_parser -r`, and one line that removes it again.

- [ ] **Step 3: Start the package with the sandbox on**

```bash
aa-exec -p unconfined -- /tmp/openldr-spike-run/openldr-spike/electron
```

with the self-check variables set and no `--no-sandbox`. Expected: one `SELFTEST` line. Then check the page process is really confined: its user namespace differs from the main process's (`readlink /proc/<pid>/ns/user`).

- [ ] **Step 4: The operator removes the profile**

Expected: `ls /etc/apparmor.d | grep openldr` prints nothing.

- [ ] **Step 5: Finish the findings file**

One section per system, then a section "What part 3 must do", answering the design's four questions:

1. Does an unsigned app fetched by a terminal command open without a warning, on each system?
2. Does macOS refuse the app or the Postgres inside it, and what fixes it?
3. Does the Windows Postgres package bring its own Visual C++ runtime files?
4. Does the AppArmor profile let the sandbox start on Linux from a normal terminal?

End with HONEST NON-PROOF: what was not tried (a Windows with no Visual C++ runtime, a Mac with another macOS version, any Linux but this one).

- [ ] **Step 6: Clean up**

Stop everything started. Remove `/tmp/openldr-spike-out`, `/tmp/openldr-spike-run` and `/tmp/openldr-spike-check`. Expected: nothing listens on 3990 to 3997, no process names those folders, and the dev server's `/health` answers 200.

- [ ] **Step 7: Commit the findings**

```bash
git add docs/superpowers/specs/2026-11-13-desktop-app-part-1-findings.md
git commit -m "docs(spec): what the desktop app's first run on Windows and macOS showed"
```

Then report to the operator: the findings, any launcher fix waiting for a merge decision, and whether part 3 can be written.
