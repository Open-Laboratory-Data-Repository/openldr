# Desktop App Part 3: Packages, Installers, Landing Page and Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One archive per system built on the release machine, a release step that builds, checks and uploads them, two one-line install scripts, the landing page one-liner, and the docs.

**Architecture:** A packing script lays the real app from part 2 into Electron's folder for each system and writes an archive. Every decision it makes (names, layout, what must and must not be inside) lives in `@openldr/release` with tests, as the release script's decisions do today. The install scripts fetch an archive from a GitHub release, check it against `SHA256SUMS`, and unpack it into the person's own folder.

**Tech Stack:** Node 24, tsx, `@electron/get` 5.1.0 (already installed with Electron), GNU tar, Info-ZIP `zip` and `unzip`, POSIX sh, Windows PowerShell 5.1, vitest 2.1.8, `gh` 2.46.

**Spec:** `docs/superpowers/specs/2026-11-13-desktop-app-design.md`, sections 6.7 to 6.9 (slices 7 to 9), and slice 1's half that needs no hands (kickoff order, step 3).

**Facts:** `docs/superpowers/plans/2026-11-13-desktop-app-part-3-facts.md`. Confirm a line before you rely on it.

Task 1 is part 1's half that needs no hands: it packs the real app, not the throwaway. Tasks 3 and 4 of the part 1 plan (the operator's runs on Windows and macOS) and the sudo steps of its Task 6 are not built here. They are on the hands-on list, `docs/superpowers/specs/2026-11-13-desktop-app-hands-on.md`.

## Global Constraints

- Systems: `linux-x64`, `darwin-arm64`, `win32-x64`. No others. A script asked for another system refuses and names the three.
- Electron `45.3.0`. `embedded-postgres` and `@embedded-postgres/*` at `16.15.0-beta.19`.
- Archive names: `openldr-desktop-<version>-linux-x64.tar.gz`, `openldr-desktop-<version>-darwin-arm64.tar.gz`, `openldr-desktop-<version>-win32-x64.zip`. The version is the root `package.json` version.
- `cpu-features` is left out of every archive, with `nan` and `buildcheck`, which only it needs. No file ending in `.node` may be in an archive.
- Nothing is compiled for another system. If a package turns out to need compiling for Windows or macOS, stop and report.
- Every download is checked before it is used: Electron against the `checksums.json` in the installed `electron` package, the Postgres packages against the `integrity` values in `pnpm-lock.yaml`. A failed check stops the pack.
- The archive keeps the launcher's layout: `apps/standalone/dist`, `apps/studio/dist` beside it, and a root `package.json` with the version, all under the app folder.
- The installed app never runs with its sandbox off, on any system. No script writes `--no-sandbox` into a menu entry, a link or a command. There is no fallback.
- The install scripts check the checksum before they unpack. They use `sudo` for the AppArmor profile and for nothing else. They never touch OpenLDR's data folder.
- No signing with a developer identity, no notarising, no double-click installer, no self-update, no build service, no Intel Mac, no ARM Linux or Windows.
- Only Linux is proven here. Everything about Windows and macOS is marked "not proven, waits for the operator" in code comments that make a claim, in docs for maintainers, and in every report. User-facing docs say plainly that the app is not signed.
- Packed archives go to `dist/desktop/v<version>/` at the repo root, beside a `SHA256SUMS` file the pack writes. `dist/` is already ignored by git. That folder has the shape of a release's download folder (`<base>/v<version>/<name>`), so an install script can be pointed at it before any release exists.
- Every archive holds exactly one top folder. A script that unpacks one unpacks into a staging folder and then moves that top folder into place.
- The packages are built on Linux only. The pack and the release's pack step refuse every other system.
- A real run on this machine uses ports 3990 to 3997, folders under the system temp folder, `OPENLDR_SKIP_ENV_FILE=true`, the three `OPENLDR_DESKTOP_*` overrides, and `aa-exec -p unconfined -- <binary> --no-sandbox`, because no AppArmor profile is installed for a temp path.
- `pnpm depcruise` stays at 21 violations. No database migration.
- Shell scripts follow `install/install.sh`: `#!/usr/bin/env sh`, `set -eu`, POSIX sh, `→`, `✓`, `⚠`, `✗` line prefixes, usage errors exit 2. PowerShell follows `install/install.ps1`: Windows PowerShell 5.1, ASCII output only (`->`, `OK`, `!`, `X`).

## Rulings this plan rests on, where the spec says "slice 1 finds out"

Each is the careful assumption. Each is "not proven, waits for the operator".

- **macOS, an unsigned app.** The script signs the unpacked app on the Mac with an ad-hoc signature (`codesign --force --sign -`), inside out: the Postgres binaries and libraries under `Contents/Resources` first, because `--deep` does not reach them, then the app. `codesign` is part of macOS. A failed signing is a warning, not a stop: the app may still open. This is not the "signing" the spec rules out, which is signing with a developer identity.
- **Windows, an unsigned app.** The script does nothing about Windows' own checks. If Windows warns or removes a file, the operator's run shows it.
- **Windows, the Visual C++ runtime.** Task 1 lists what the Windows Postgres package ships. If it ships no `vcruntime140.dll`, the docs say Postgres may need the Visual C++ runtime, and the hands-on list asks the operator to try.
- **Linux, the AppArmor profile.** The profile has the shape of the system's own profiles for Electron apps on this machine (`/etc/apparmor.d/claude-desktop`): `flags=(unconfined)` with `userns,`. It cannot be loaded here without the administrator password.
- **macOS, the app's identity.** The pack changes the app's shown name and its icon file. It does not change `CFBundleIdentifier` or the binary's name: the helper apps inside carry Electron's own identifier and name, and nobody here can try a mismatch.
- **Icons.** The pack makes an `.icns` and an `.ico` from the app's 256 px PNG, each a small container around that PNG. The Mac app's icon file is replaced and the Windows shortcut points at the `.ico`. The Windows `.exe` itself keeps Electron's icon: changing it needs a resource editor that does not run here.
- **The release now runs on Linux only.** The release script has run on Windows before (`RELEASE.md:141`). From this change on, its pack step refuses there. The operator is told in the closing report.

## Review Focus

1. **A home folder with a space in its name.** The AppArmor profile, the menu entry and every path in the scripts must still work. Owner: Task 3, a test with such a `HOME`.
2. **A download cut short.** The checksum fails and nothing is unpacked; an older copy stays as it was. Owner: Task 3 and Task 4.
3. **An update while OpenLDR is running.** Refused, with the words to quit first; the running copy is not touched. Owner: Task 3 and Task 4.
4. **The administrator password declined during an update.** The older copy must still be there and still start. Owner: Task 3.
5. **The newest release has no desktop archive** (an upload failed). The script takes the newest release that has one. Owner: Task 3 and Task 4.

---

### Task 1: Pack the real app for three systems

**Files:**
- Create: `packages/release/src/desktop-pack.ts`, `packages/release/src/desktop-pack.test.ts`
- Modify: `packages/release/src/index.ts` (export)
- Create: `scripts/pack-desktop.ts`
- Modify: `package.json` (script `"pack:desktop": "tsx scripts/pack-desktop.ts"`)
- Modify: `apps/desktop/src/main.ts` (one line, see below), `apps/desktop/README.md`

**Interfaces:**
- Produces, in `desktop-pack.ts` (pure functions, no I/O):

```ts
export type DesktopSystem = 'linux-x64' | 'darwin-arm64' | 'win32-x64';
export const DESKTOP_SYSTEMS: readonly DesktopSystem[];
export const ELECTRON_VERSION = '45.3.0';
export const POSTGRES_VERSION = '16.15.0-beta.19';
export const LEFT_OUT: readonly string[];            // ['cpu-features', 'nan', 'buildcheck']
export function parseDesktopSystem(text: string): DesktopSystem;   // throws, naming the three
export function archiveName(version: string, system: DesktopSystem): string;
export function postgresPackage(system: DesktopSystem): string;
export interface DesktopLayout {
  /** The one top-level folder inside the archive. */
  root: string;
  /** The app folder Electron loads, inside root. */
  appDir: string;
  /** The app's binary, inside root. */
  binary: string;
  /** The openldr-standalone command, inside root. */
  command: string;
}
export function desktopLayout(system: DesktopSystem): DesktopLayout;
/** Problems found in an archive's list of entries. Empty means it passed. */
export function checkArchiveEntries(system: DesktopSystem, entries: readonly string[]): string[];
/** One "<sha256>  <name>" line per file, sorted by name, each ending in a newline. */
export function sha256SumsText(files: readonly { name: string; sha256: string }[]): string;
/** Places each package of a closure at the top level or nested under a dependent, so Node resolves every dependency to the version it needs. */
export function placePackages(closure: readonly ClosurePackage[], roots: readonly PackageId[]): PlacedPackage[];
export interface PackageId { name: string; version: string }
export interface ClosurePackage extends PackageId { dependencies: Record<string, string> }   // dependency name -> resolved version
export interface PlacedPackage extends PackageId { path: string }                             // path relative to the node_modules folder
/** The registry URL of a package's tarball, scoped names included. */
export function npmTarballUrl(name: string, version: string): string;
/** The `integrity` value recorded for `<name>@<version>` in the text of pnpm-lock.yaml. Throws when there is none. */
export function lockfileIntegrity(lockfileText: string, name: string, version: string): string;
/** True when the bytes match an `sha512-<base64>` integrity value. */
export function matchesIntegrity(bytes: Uint8Array, integrity: string): boolean;
/** Info.plist with the two shown names set. Throws when the text is not an XML plist. */
export function renamePlist(plistXml: string, shownName: string): string;
/** The text of the openldr-standalone command for a system. */
export function commandScript(system: DesktopSystem): string;
/** A .ico file that holds one PNG. */
export function icoFromPng(png: Uint8Array, size: number): Uint8Array;
/** A .icns file that holds one 256 px PNG. */
export function icnsFromPng256(png: Uint8Array): Uint8Array;
/** The root package.json of the packed app. */
export function packedPackageJson(version: string): { name: string; version: string; main: string; desktopName: string };
```

`scripts/` is not typechecked by any package, and `tsx` does not typecheck. So everything that can be a pure function lives in `desktop-pack.ts`, where the typecheck and the tests reach it. The script holds only the downloads, the file copies and the commands it runs.

`desktopLayout` gives exactly:

| System | root | appDir | binary | command |
|---|---|---|---|---|
| linux-x64 | `openldr-desktop` | `openldr-desktop/resources/app` | `openldr-desktop/openldr-desktop` | `openldr-desktop/openldr-standalone` |
| win32-x64 | `OpenLDR` | `OpenLDR/resources/app` | `OpenLDR/OpenLDR.exe` | `OpenLDR/openldr-standalone.cmd` |
| darwin-arm64 | `OpenLDR.app` | `OpenLDR.app/Contents/Resources/app` | `OpenLDR.app/Contents/MacOS/Electron` | `OpenLDR.app/Contents/Resources/openldr-standalone` |

On Linux and Windows the pack renames Electron's binary (`electron`, `electron.exe`). On macOS it keeps `Contents/MacOS/Electron`: the helper apps are found by that name, and nobody here can try a rename.

Inside `appDir`, on every system:

```
package.json                          { "name": "openldr-desktop", "version": "<repo version>", "main": "apps/desktop/dist/main.js", "desktopName": "openldr.desktop" }
apps/desktop/package.json             as in the repo (it carries "type": "module")
apps/desktop/dist/                    main.js, preload.cjs
apps/desktop/pages/  apps/desktop/assets/
apps/standalone/package.json          as in the repo (it carries "type": "module")
apps/standalone/dist/                 index.js, cli.js and the chunks
apps/standalone/fixtures/
apps/standalone/node_modules/         the launcher's run-time packages for that system
apps/studio/dist/
```

`desktopName` is what Electron uses for the window's class on X11 and its app ID on Wayland. `openldr.desktop` is the menu entry's file name (Task 3), so the window gets the entry's icon and groups with it.

- Produces, on the command line: `pnpm pack:desktop <linux-x64|darwin-arm64|win32-x64|all> [--out <folder>]`. The default folder is `dist/desktop`. Archives go to `<out>/v<version>/`. It prints each archive's path, size and SHA-256, and writes `<out>/v<version>/SHA256SUMS` from every desktop archive in that folder with `sha256SumsText`.

`checkArchiveEntries` reports a problem for each of these:
- a required entry is missing: the `binary`, the `command`, `<appDir>/package.json`, `<appDir>/apps/desktop/dist/main.js`, `<appDir>/apps/desktop/dist/preload.cjs`, `<appDir>/apps/desktop/pages/page.html`, `<appDir>/apps/standalone/package.json`, `<appDir>/apps/standalone/dist/index.js`, `<appDir>/apps/standalone/dist/cli.js`, an entry under `<appDir>/apps/standalone/fixtures/fhir/`, `<appDir>/apps/studio/dist/index.html`, `<appDir>/apps/standalone/node_modules/embedded-postgres/package.json`, and under `<appDir>/apps/standalone/node_modules/<postgresPackage(system)>/native/bin/` the three of `postgres`, `pg_ctl`, `initdb` (with `.exe` on Windows);
- an entry outside `root`;
- an entry under a `cpu-features`, `nan` or `buildcheck` package folder;
- an entry ending in `.node`;
- an entry under `@embedded-postgres/` for another system;
- on Linux, no `chrome-sandbox` beside the binary.

What `scripts/pack-desktop.ts` does, in order. It gathers and sequences; it decides nothing that `desktop-pack.ts` can decide.

1. Refuse to run on any system but Linux, saying the packages are built on Linux (symbolic links, file modes and GNU tar's options are needed).
2. Stop with a clear message if a build output is missing: `apps/studio/dist/index.html`, `apps/standalone/dist/index.js`, `apps/standalone/dist/cli.js`, `apps/standalone/fixtures/fhir`, `apps/desktop/dist/main.js`, `apps/desktop/dist/preload.cjs`.
3. Fetch Electron for the system with `downloadArtifact` from `@electron/get` (`artifactName: 'electron'`, `version`, `platform`, `arch`, and `checksums` from the installed `electron` package's `checksums.json`). `@electron/get` 5.1.0 is an ES module and is not importable from the repo root: find it with `createRequire(<real folder of apps/desktop/node_modules/electron>).resolve('@electron/get')` and load it with `await import(pathToFileURL(path).href)`. Unpack the zip with the system `unzip`, straight into the staging folder where it will stay, so the symbolic links the macOS zip is full of are never copied.
4. Rename the binary on Linux and Windows. On macOS rename `Electron.app` to `OpenLDR.app`. Read `Contents/Info.plist`: if it begins with `<?xml`, write back `renamePlist(text, 'OpenLDR')`, which sets `CFBundleName` and `CFBundleDisplayName` and nothing else; if it is a binary plist (`bplist00`), stop and report. Replace the file `CFBundleIconFile` names (under `Contents/Resources`) with `icnsFromPng256` of `apps/desktop/assets/icon.png`. Remove `resources/default_app.asar` (macOS: `Contents/Resources/default_app.asar`).
5. Build the app folder shown above from this checkout. Write `icoFromPng(icon.png, 256)` to `apps/desktop/assets/icon.ico` inside the app folder. Every copy in this script keeps a symbolic link as it is (`cpSync` with `verbatimSymlinks: true`): Node otherwise rewrites a relative link into an absolute path on the build machine.
6. Gather the launcher's run-time packages. Start from `ssh2`, `pdfkit`, `quickjs-emscripten`, `embedded-postgres` and `pg` as `apps/standalone` resolves them, and follow each package's `dependencies` and those `optionalDependencies` that are installed. Find a dependency by walking the `node_modules` folders upward from the dependent's real folder and taking the first `<dir>/node_modules/<name>/package.json` that exists. Do not use `require.resolve` for this: ten packages in this closure (`fontkit`, `embedded-postgres`, `pg-pool` among them) have an `exports` map without `./package.json`, and two export no `.` at all. Skip `LEFT_OUT` and every `@embedded-postgres/*`. Place them with `placePackages` and copy each package's real folder (follow the link into the pnpm store, keep the files, drop any nested `node_modules`).
7. Add the Postgres package for the system at `node_modules/@embedded-postgres/<name>`. For `linux-x64`, copy the installed one. For the other two, fetch `npmTarballUrl(...)`, check the bytes with `matchesIntegrity` against `lockfileIntegrity(<text of pnpm-lock.yaml>, ...)`, and unpack it (an npm tarball unpacks into `package/`). Then, for all three: remove the link targets named in the package's `native/pg-symlinks.json` if they exist as plain files, and run the package's own `scripts/hydrate-symlinks.js` with the package folder as the working folder, as its install would. On this machine the installed Linux package holds those 14 targets as hard-linked copies; without this step the Linux archive carries `libicudata` three times.
8. Check the placement: for every placed package and every dependency the closure recorded for it (not every name in its `package.json`: the left-out and uninstalled optional ones are not in the closure), walk the `node_modules` folders upward from the copy as Node would and compare the version found with the version recorded. Any difference stops the pack.
9. Write `commandScript(system)` to the layout's `command` path, mode 0755.
10. Write the archive from the staging folder with the one top folder as the only argument (`-C <staging> <root>`), so no entry starts with `./`. `tar.gz` for Linux and macOS, made with `tar --owner=0 --group=0 --numeric-owner --sort=name`, keeping links and modes. `zip` for Windows, made with `zip -r -q`, which stores a link as the file it points to.
11. List the archive (`tar -tzf`, `unzip -Z1`), run `checkArchiveEntries`, and stop on any problem. For a tar, also list it long (`tar -tvzf`) and stop if any link entry points at a path that starts with `/`. Print the path, the size and the SHA-256, then write `SHA256SUMS`.

`placePackages`, the rules:
- A name with one version in the closure goes at the top level.
- A name with several versions: the version a root asks for goes at the top level; with no root among them, the version with the most dependents, then the higher version. Each other version is nested under each package that needs it: `<dependent>/node_modules/<name>`.
- A nested package's own dependencies resolve upward. One that the top level does not satisfy is nested under the package that needs it, in the same way.

`lockfileIntegrity`: each package key appears twice in `pnpm-lock.yaml` (for the Mac package, lines 1933 and 8256). Only the first is followed by `resolution: {integrity: sha512-...}`.

`icoFromPng`: a 6-byte header (reserved 0, type 1, count 1), one 16-byte entry (width and height bytes 0 for 256, colours 0, reserved 0, planes 1, bits 32, the PNG's length, offset 22), then the PNG. `icnsFromPng256`: the bytes `icns`, the whole file's length as a big-endian 32-bit number, then one entry: the type `ic08`, the entry's length (8 plus the PNG's length) big-endian, then the PNG.

The `openldr-standalone` command runs the launcher with the app's own Electron acting as Node:

- Linux, a POSIX sh script. It finds its own real folder, following symbolic links one step at a time with `readlink` (the install links it into `~/.local/bin`, and macOS has no `readlink -f`). A relative link target is taken relative to the link's own folder; `install/install.sh:224-241` already does this and is the pattern to copy. Then: `ELECTRON_RUN_AS_NODE=1 exec "$dir/openldr-desktop" "$dir/resources/app/apps/standalone/dist/index.js" "$@"`.
- macOS, the same script, with `"$dir/../MacOS/Electron"` and `"$dir/app/apps/standalone/dist/index.js"`.
- Windows, `openldr-standalone.cmd`: `@echo off`, `setlocal`, `set ELECTRON_RUN_AS_NODE=1`, `"%~dp0OpenLDR.exe" "%~dp0resources\app\apps\standalone\dist\index.js" %*`.

The one line in `apps/desktop/src/main.ts`: where the start-at-sign-in entry is built, the app decides whether to add its own folder as an argument with `app.isPackaged`. Electron answers that from the binary's name. Use `process.defaultApp` instead: it is true only when the app was started as `electron <folder>` (`electron.d.ts`, `defaultApp`). The entry's arguments are read on Linux only, where the pack renames the binary anyway, so this is a guard against a Linux binary still named `electron`. Add a line to `autostart.test.ts` if the decision sits in a pure function; otherwise say in the report that it is proven by reading only. Also pass `icon: <assets/icon.png>` to the `BrowserWindow` if it is not there yet, so the window and the Windows taskbar show the app's icon.

`apps/desktop/README.md` gains a short section: how to pack (`pnpm pack:desktop all`), where the archives go, and that packing runs on Linux only.

- [ ] **Step 1: Write the failing tests in `desktop-pack.test.ts`**

- `parseDesktopSystem('linux-arm64')` throws an error whose message names all three systems.
- `archiveName('0.1.11', s)` gives the three names in Global Constraints.
- `postgresPackage` gives `@embedded-postgres/linux-x64`, `@embedded-postgres/darwin-arm64`, `@embedded-postgres/windows-x64`.
- `desktopLayout` gives the table above, exactly.
- `checkArchiveEntries`: a full, correct list for each system gives `[]`. Then, one at a time: remove each required entry; add `openldr-desktop/resources/app/apps/standalone/node_modules/cpu-features/package.json`; add an entry ending `sshcrypto.node`; add an entry under `@embedded-postgres/linux-x64/` to the Windows list; add an entry `other/file`; remove `openldr-desktop/chrome-sandbox` from the Linux list. Each gives exactly one problem that names the entry.
- `sha256SumsText` sorts by name and ends every line with a newline; a file named with a space is refused with an error.
- `placePackages`: a closure where one name has one version puts it at the top level. A closure where `pg` appears as `8.21.0` (a root) and `8.23.1` (needed by `embedded-postgres`) puts `8.21.0` at `pg` and `8.23.1` at `embedded-postgres/node_modules/pg`. A dependency of a nested package that the top level already satisfies is not copied again. A dependency of a nested package that the top level does not satisfy is nested under the package that needs it. Two versions of a name with no root among them: the one with more dependents is at the top level, and with equal dependents the higher version.
- `npmTarballUrl('@embedded-postgres/darwin-arm64', '16.15.0-beta.19')` is `https://registry.npmjs.org/@embedded-postgres/darwin-arm64/-/darwin-arm64-16.15.0-beta.19.tgz`.
- `lockfileIntegrity`, on a small lockfile text where the key appears twice and only the first has a `resolution` line, gives that line's `sha512-...` value; a name that is not there throws.
- `matchesIntegrity`: true for bytes against their own `sha512-<base64>`, false after one byte changes, false for an integrity that does not start with `sha512-`.
- `renamePlist`: on a small XML plist, the strings after `CFBundleName` and `CFBundleDisplayName` become `OpenLDR`, `CFBundleIdentifier` and every other line are unchanged; a text that does not begin with `<?xml` throws.
- `commandScript`: the Linux text holds `ELECTRON_RUN_AS_NODE=1 exec "$dir/openldr-desktop" "$dir/resources/app/apps/standalone/dist/index.js" "$@"`; the macOS text holds `"$dir/../MacOS/Electron"`; the Windows text holds `"%~dp0OpenLDR.exe" "%~dp0resources\app\apps\standalone\dist\index.js" %*`; none holds `--no-sandbox`.
- `icoFromPng` and `icnsFromPng256`: the header bytes and lengths above, and the PNG's bytes at the stated offset.
- `packedPackageJson('0.1.11')` is exactly the root `package.json` shown above.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/release exec vitest run src/desktop-pack.test.ts`

- [ ] **Step 3: Implement `desktop-pack.ts`, then `scripts/pack-desktop.ts`, the `pack:desktop` script and the `main.ts` line**

- [ ] **Step 4: Tests, typecheck, depcruise**

`pnpm --filter @openldr/release test`, `pnpm --filter @openldr/release typecheck`, `pnpm --filter @openldr/desktop test`, `pnpm --filter @openldr/desktop typecheck`, `pnpm depcruise` (21), each redirected to a file with the exit code read after.

- [ ] **Step 5: Build, then pack all three**

`pnpm --filter @openldr/studio build`, `pnpm --filter @openldr/standalone build`, `pnpm --filter @openldr/desktop build`, then `pnpm pack:desktop all`. The two downloads for macOS and Windows need the network once. Run it in the background.
Expected: three archives and `SHA256SUMS` in `dist/desktop/v<version>/`, each with its SHA-256 printed, no problem reported. `sha256sum -c SHA256SUMS` in that folder passes. `git status --short` shows nothing new (the folder is ignored).

- [ ] **Step 6: Prove the Linux package from a folder outside the repo**

Unpack `dist/desktop/v<version>/openldr-desktop-<version>-linux-x64.tar.gz` under a new folder in the system temp folder. Then, with a temp data folder and a temp app folder beside it:

```bash
OPENLDR_SKIP_ENV_FILE=true OPENLDR_DESKTOP_DATA_DIR="<tmp>/data" OPENLDR_DESKTOP_USER_DIR="<tmp>/app" OPENLDR_DESKTOP_PORT=3990 OPENLDR_DESKTOP_SELFCHECK="<tmp>/check.json" aa-exec -p unconfined -- "<tmp>/openldr-desktop/openldr-desktop" --no-sandbox
```

Expected: exit 0; `check.json` holds `"screen":"studio"`, `"setupPage":true`, `"bridge":"object"`, `"setupCodeLocked":true`. So the launcher found Studio, its version and its packages outside the repo, and Postgres started from the packed copy. Then run the packed command: `"<tmp>/openldr-desktop/openldr-standalone" status --json --data-dir "<tmp>/data"` prints the not-running line, and through a symbolic link to it from another folder it prints the same. Nothing is left running; remove the temp folder. Say in the report that this run used `--no-sandbox`.

Also start it once without `--no-sandbox` under `aa-exec -p unconfined` and record what it prints and its exit code. It is expected to refuse to start: no AppArmor profile is installed for a temp path. That refusal is the evidence that the packed app does not turn its own sandbox off.

- [ ] **Step 7: Check the other two by what is inside them**

From the lists of the macOS and Windows archives, write down in the report:
- macOS: `OpenLDR.app/Contents/MacOS/Electron` is there with an executable mode; the Postgres package's `native/bin/postgres` is there with an executable mode; the links named in its `pg-symlinks.json` are link entries in the tar (`tar -tvzf` shows `l`), and no link in the archive points at a path that starts with `/`; `Info.plist` holds the two new names and Electron's own identifier; the framework's `Versions/Current` is a link.
- Windows: `OpenLDR/OpenLDR.exe`, `OpenLDR/openldr-standalone.cmd`, and the Postgres package's `native/bin/postgres.exe`, `pg_ctl.exe`, `initdb.exe` are there.
- Whether the Windows Postgres package holds `vcruntime140.dll` and `msvcp140.dll`, and where.
- How the Windows package's `dist/index.js` names the three binaries (with `.exe` or without).
- The size of each archive.
- Neither holds a `cpu-features` folder or a `.node` file (the check already enforces it).

Nothing here proves either archive runs. Mark all of it "not proven, waits for the operator".

- [ ] **Step 8: Commit**

Stage by name: the two `desktop-pack` files, `packages/release/src/index.ts`, `scripts/pack-desktop.ts`, `package.json`, `apps/desktop/src/main.ts`, `apps/desktop/README.md`, and `autostart.ts` with its test if you changed them. Do not stage anything under `dist/`.

```bash
git commit -m "feat(release): pack the desktop app for Linux, macOS and Windows"
```

Leave the three archives and `SHA256SUMS` in `dist/desktop/v<version>/`. The operator fetches them from there.

---

### Task 2: The packages in the release

**Files:**
- Create: `packages/release/src/desktop-release.ts`, `packages/release/src/desktop-release.test.ts`
- Modify: `packages/release/src/index.ts`, `scripts/release.ts`, `RELEASE.md`

**Interfaces:**
- Consumes: `DESKTOP_SYSTEMS`, `archiveName`, `sha256SumsText` from Task 1; `pnpm pack:desktop all`.
- Produces, in `desktop-release.ts`:

```ts
export const SHA256SUMS_NAME = 'SHA256SUMS';
/** The four file names a release carries for the desktop app. */
export function desktopAssetNames(version: string): string[];
/** Why the desktop packages cannot be built on this host, or null. */
export function desktopPackRefusal(platform: NodeJS.Platform): string | null;
/** What to print when an upload failed after the release was created. */
export function uploadFailureMessage(version: string, missing: readonly string[], outDir: string): string;
/** The assets a published release lacks, from the names `gh release view` reports. */
export function missingDesktopAssets(version: string, publishedNames: readonly string[]): string[];
```

Rules:
- `desktopPackRefusal('linux')` is `null`. For every other platform it is exactly: `The desktop packages are built on Linux. Other systems cannot make them: the macOS and Linux packages need symbolic links, file modes and GNU tar. Run the release on the Linux release machine.`
- `uploadFailureMessage` names each missing file, says the release and its tag are public and are not rolled back, and gives the command to finish by hand: `gh release upload v<version> <outDir>/v<version>/<file> ... --clobber`.
- In `scripts/release.ts` (the new imports go with the others at lines 24-37):
  1. After line 325 (`preconditions clear`) and before line 327 (step 7, the image push): stop if `desktopPackRefusal(process.platform)` gives a message. Then build the three packages the archives need (`pnpm turbo run build --filter=@openldr/studio --filter=@openldr/standalone --filter=@openldr/desktop`; turbo builds their dependencies too) and run `pnpm pack:desktop all`, which writes the archives and `SHA256SUMS` into `dist/desktop/v<version>/`. Any failure stops the release here. Nothing has been pushed yet, so the same version can be run again.
  2. After line 464 (the end of the `catch` that unwinds the tag) and before `verifyPublishedManifest` at 467: `gh release upload v<version>` with the three archives and `SHA256SUMS`. Then read the release's asset names back (`gh release view v<version> --json assets`) and pass them to `missingDesktopAssets`. The upload and the manifest check can each fail, and each ends the script today. Collect both results, run `cleanUp` so the verification stack is not left on ports 80 and 443, print every failure (`uploadFailureMessage` for a missing asset), and exit 1 once. The tag is not rolled back.
  3. A dry run prints the build, pack and upload commands and runs none of them. It also skips reading the release's assets back: guard that read with `DRY_RUN`, because `sh()` runs even in a dry run.
- `RELEASE.md`: the steps paragraph gains the pack step and the upload; "What is NOT proven by tests" gains a paragraph saying the pack step's sequencing and the upload are proven only by a real release, and that the macOS and Windows archives are never run on the release machine; a short section says the release must run on Linux.

- [ ] **Step 1: Write the failing tests** for the four functions: the four names for `0.1.11`; the refusal text for `win32` and `darwin` and `null` for `linux`; the message names every missing file, the tag `v0.1.11` and the `gh release upload` command with `--clobber`; `missingDesktopAssets` gives `[]` when all four are published and the missing names otherwise.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement, and edit `scripts/release.ts` and `RELEASE.md`.**
- [ ] **Step 4: Tests and typecheck** for `@openldr/release`. Do not run `pnpm release`, with or without `--dry-run`: it runs the whole gate and reads the registry. The sequencing in `scripts/release.ts` has no tests by design; say in the report that it is proven by reading only.
- [ ] **Step 5: Commit**, files staged by name: `feat(release): build, check and upload the desktop packages`.

---

### Task 3: The installer for Linux and macOS

**Files:**
- Create: `install/desktop.sh`
- Create: `packages/release/src/desktop-shell.test.ts`

**Interfaces:**
- Consumes: the archive layout from Task 1 (`desktopLayout`), `SHA256SUMS` from Task 2, the launcher's `status` exit codes (0 running, 3 not running).
- Produces: `curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash`, with options passed as `| bash -s -- --version 0.1.12` and `| bash -s -- --uninstall`.

Where things go:

| | Linux | macOS |
|---|---|---|
| The app | `~/.local/share/openldr-desktop/` | `~/Applications/OpenLDR.app` |
| Menu entry | `~/.local/share/applications/openldr.desktop` | none, Launchpad finds it |
| The command | `~/.local/share/openldr-desktop/openldr-standalone` | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone` |
| The app's own folder | `~/.config/OpenLDR Desktop` | `~/Library/Application Support/OpenLDR Desktop` |
| Start at sign-in | `~/.config/autostart/openldr-desktop.desktop` | a login item, left alone |
| OpenLDR's data, never touched | `~/.local/share/openldr` | `~/Library/Application Support/OpenLDR` |

Confirm the two data folder paths against `resolveDataDir` in `apps/standalone/src/state.ts` and print the right one. On Linux the app's own folder and the start-at-sign-in file sit under `$XDG_CONFIG_HOME` when that is set, else `~/.config`, as Electron's do.

What is inside an archive (Task 1 packs it; this task only reads it):

| System | The one top folder | The binary | The command |
|---|---|---|---|
| linux-x64 | `openldr-desktop` | `openldr-desktop/openldr-desktop` | `openldr-desktop/openldr-standalone` |
| darwin-arm64 | `OpenLDR.app` | `OpenLDR.app/Contents/MacOS/Electron` | `OpenLDR.app/Contents/Resources/openldr-standalone` |

On macOS the app folder is `OpenLDR.app/Contents/Resources/app`, and the Postgres binaries and libraries are under `OpenLDR.app/Contents/Resources/app/apps/standalone/node_modules/@embedded-postgres/darwin-arm64/native/bin` and `native/lib`.

The whole script body sits in one function called on the last line, so a download of the script that was cut short runs nothing. Any command that might read standard input (the installed copy's `openldr-standalone status`) gets `</dev/null`: under `curl | bash`, standard input is the script itself.

Environment overrides, named in a comment at the top of the script. They are for the tests, and for trying a package from a folder before a release exists:
- `OPENLDR_DESKTOP_RELEASES_URL`: the list of releases. Default `https://api.github.com/repos/Open-Laboratory-Data-Repository/openldr/releases?per_page=30`.
- `OPENLDR_DESKTOP_DOWNLOAD_BASE`: where a release's files are. Default `https://github.com/Open-Laboratory-Data-Repository/openldr/releases/download`. A file is at `<base>/v<version>/<name>`.
- `OPENLDR_DESKTOP_USERNS_FILE`: default `/proc/sys/kernel/apparmor_restrict_unprivileged_userns`.
- `OPENLDR_DESKTOP_APPARMOR_DIR`: default `/etc/apparmor.d`.

What an install does, in this order:

1. Work out the system from `uname -s` and `uname -m`. `Linux` with `x86_64` is `linux-x64`. `Darwin` with `arm64` is `darwin-arm64`. Anything else stops with `✗ There is no OpenLDR desktop package for <system> <machine>. Packages exist for Linux x64, macOS on Apple silicon and Windows x64.`
2. Find the version. With `--version`, use it. Otherwise read the list of releases and take the first asset name, in the order given (releases come newest first), that matches `openldr-desktop-<X.Y.Z>-<system>.tar.gz` with `X.Y.Z` strictly three numbers; the version is read from that name. No `jq`: break the text at every `,` and `{` (the list may come pretty-printed or on one line) and match the `"name"` values with `grep` and `sed`. A release tagged with anything after the three numbers is passed over. If no release has one, stop with `✗ No OpenLDR release has a desktop package for <system> yet.` If the list cannot be read, stop and say to try again or pass `--version`.
3. If a swap from an earlier run died half way (there is a `<target>.old` and no target), move `.old` back first. Create `~/Applications` on macOS if it is missing.
4. Download the archive and `SHA256SUMS` into a new folder beside the target (`~/.local/share/openldr-desktop.download`, `~/Applications/.OpenLDR.download`), not the system temp folder: an archive is several hundred megabytes, and `/tmp` is memory on many systems. A leftover folder of that name is removed first. Before downloading, stop with a plain message if the target's volume has less than 2 GB free (`df -Pk`). Show `curl`'s progress bar when standard error is a terminal. Work out the archive's SHA-256 with `sha256sum`, or `shasum -a 256` where that is missing, and compare its first field. If `SHA256SUMS` has no line for the archive, or the value differs, remove the download folder and stop: `✗ The download does not match its checksum. Nothing was installed.` Nothing has been unpacked at this point.
5. If a copy is already installed, refuse while OpenLDR runs from it: run that copy's `openldr-standalone status </dev/null`, and if it exits 0, or `ps -A -ww -o args=` shows a line holding the installed app folder's path (`grep -F`, which also catches a Postgres left from that copy), stop with `✗ OpenLDR is running. Quit it from its tray icon, then run this again.` The installed copy is not touched.
6. Unpack the archive inside the download folder, then move its one top folder to `<target>.new` (`~/.local/share/openldr-desktop.new`, `~/Applications/OpenLDR.app.new`). A leftover `.new` folder from an earlier run is removed first.
7. Linux only, the sandbox. If the userns file holds `1`:
   - Build the profile text (below) for the final path of the binary. The home folder in it is the real one, `$(cd -P "$HOME" && pwd -P)`: AppArmor matches the real path, and a home that is a link would never match.
   - If `<apparmor dir>/openldr-desktop-<uid>` exists and holds exactly that text, do nothing.
   - Otherwise say what is about to happen and why, in three lines at most: this system does not let an app start its sandbox without an AppArmor profile; the script will install a small profile for OpenLDR with `sudo`; that asks for the administrator password once. Then run exactly two commands under `sudo`, in this order: `apparmor_parser -r <temp profile>` and then `install -m 0644 <temp profile> <apparmor dir>/openldr-desktop-<uid>`. Loading comes first, so a profile that fails to load is never left on disk for the next run to mistake for a loaded one.
   - Look for `apparmor_parser` on `PATH`, then in `/usr/sbin` and `/sbin`. If it is nowhere, or either command fails (the person declined, or the password was wrong): remove the `.new` folder and the download folder, and stop with `✗ The sandbox profile was not installed, so OpenLDR was not installed.` An older copy stays as it was. There is no fallback.
   - If the userns file is missing or holds `0`, ask for nothing.
8. macOS only: sign the `.new` app with an ad-hoc signature, inside out (the ruling above): `codesign --force --sign -` on each file in the Postgres `native/bin` and `native/lib` folders named above, then `codesign --force --deep --sign -` on the app. A failure prints a `⚠` line and the install goes on.
9. Swap: move the old copy to `<target>.old`, move `.new` to the target, remove `.old`. If the second move fails, move the old copy back. Remove the download folder.
10. Linux: write the menu entry (below) and run `update-desktop-database ~/.local/share/applications` if that tool exists; ignore its failure.
11. The command: if `~/.local/bin` is a folder and is on `PATH`, link `openldr-standalone` into it with an absolute target (replace an older link; never replace a real file). Otherwise change nothing.
12. Say where the app is, how to start it (the menu, or the full path), the full path of `openldr-standalone`, whether it was linked, and where the data is.

The profile, with the person's numeric user ID and the binary's full path, the path in double quotes because a home folder may hold a space:

```
abi <abi/4.0>,
include <tunables/global>

profile openldr-desktop-<uid> "<home>/.local/share/openldr-desktop/openldr-desktop" flags=(unconfined) {
  userns,

  include if exists <local/openldr-desktop-<uid>>
}
```

The menu entry:

```
[Desktop Entry]
Type=Application
Name=OpenLDR
Comment=Laboratory data repository
Exec="<home>/.local/share/openldr-desktop/openldr-desktop"
Icon=<home>/.local/share/openldr-desktop/resources/app/apps/desktop/assets/icon.png
Terminal=false
Categories=Science;MedicalSoftware;
```

There is no `StartupWMClass` line: the packed app's `desktopName` is `openldr.desktop`, this file's name, and that is how the window finds its entry. The path in `Exec` is escaped as the desktop entry rules ask, the same way `apps/desktop/src/autostart.ts:18-22` does it: `"`, a backtick, `$` and `\` take a backslash, then every backslash is doubled, and `%` becomes `%%`.

`--uninstall`, in this order: refuse while OpenLDR is running (as step 5); remove the app, the menu entry, the link in `~/.local/bin` if it points into the app, the start-at-sign-in file, and the app's own `OpenLDR Desktop` folder; on Linux, if `<apparmor dir>/openldr-desktop-<uid>` exists, say that removing it needs the administrator password, then run `apparmor_parser -R` on it and `rm -f` it under `sudo` (a failure here is a `⚠` line naming the file, not a stop); on macOS say that a "start when I sign in" entry, if one was set, is removed in System Settings; then say the data folder was left alone and where it is. With nothing installed, say so and exit 0.

An unknown option prints `unknown flag: <flag>` to standard error and exits 2. The script holds no `--no-sandbox` anywhere.

- [ ] **Step 1: Write the failing tests in `desktop-shell.test.ts`**

Copy the helpers' shape from `shell.test.ts` (`tempDir`, `toPosix`, `resolveGitBash`, the `wrapperHost` style of a fake `HOME`, fake tools on `PATH` that record their calls). Run the script with a clean environment, as `wrapperHost` does (`shell.test.ts:700-709`): `PATH`, the fake `HOME`, `TMPDIR` and the overrides, and no `XDG_*` variable. A test that passed the real environment through would point `--uninstall` at the operator's real `~/.config/OpenLDR Desktop`. The whole file is `describe.skipIf(platform() === 'win32')`. Fake `df` and `ps` sit on `PATH` too, so free space and running processes are the test's to decide. A fake release is a folder: a releases list JSON, and under `v<version>/` a small `tar.gz` built by the test with the Linux layout (a stub `openldr-desktop/openldr-desktop`, a stub `openldr-desktop/openldr-standalone` whose `status` exit code a file controls, `chrome-sandbox`, `resources/app/apps/desktop/assets/icon.png`) and a matching `SHA256SUMS`. Both overrides point at it with `file://` and the real `curl`. Fake `uname`, `sudo`, `apparmor_parser`, `update-desktop-database` and `codesign` sit first on `PATH`. The fake `sudo` records its arguments and then runs them, or exits 1 when a file tells it to. The userns file and the AppArmor folder are temp paths.

Tests, each on a fresh fake home:
- installs: the binary is at `~/.local/share/openldr-desktop/openldr-desktop` and executable; the menu entry exists with the `Exec` line above; exit 0; the output names the app's path and the command's full path.
- a `HOME` with a space in its name installs, and the profile and the menu entry hold the path in quotes.
- `uname` says `Linux aarch64`: exit 1, the message names `Linux aarch64`, nothing was downloaded.
- a `SHA256SUMS` with a wrong value: exit 1, the checksum message, and neither the app folder nor a `.new` folder exists.
- a `SHA256SUMS` with no line for the archive: the same.
- the newest release has no archive for this system and the second has: the second's version is installed.
- `--version 0.1.10` downloads from `v0.1.10` and never reads the releases list (the list file is absent).
- an update: an older copy is installed, with a marker file in OpenLDR's data folder. After the run the app is the new one, the marker file is unchanged, and no `.new` or `.old` folder is left.
- an update while running (the older copy's `status` exits 0): exit 1, the "is running" message, the older copy unchanged.
- the releases list on one line and the same list pretty-printed give the same version; a release whose archive is named `openldr-desktop-0.2.0-beta.1-linux-x64.tar.gz` is passed over.
- no release has an archive: exit 1 with the "no release has a desktop package" message.
- the written menu entry passes `desktop-file-validate` (skip the test when that tool is missing), for a plain home and for a home with a space.
- a leftover `<target>.old` with no target is moved back before anything else.
- less than 2 GB free (the fake `df` says so): exit 1, a plain message, nothing downloaded.
- a `ps` line that holds the app folder's path: the "is running" message, even when `status` exits 3.
- userns file holds `1`: `sudo` was called exactly twice, first with `apparmor_parser -r <a temp file>` and then with `install -m 0644 ... openldr-desktop-<uid>`; the installed profile holds the text above; no other call to `sudo`.
- `apparmor_parser -r` fails: exit 1, the sandbox message, and no profile file was written.
- userns file holds `0`, and userns file missing: `sudo` was never called.
- `sudo` fails on a first install: exit 1, the sandbox message, no app folder, no `.new` folder.
- `sudo` fails on an update: exit 1, the older copy is still there and its stub still runs.
- an update where the installed profile already holds the same text: `sudo` was never called.
- `~/.local/bin` on `PATH`: the link exists and resolves to the app's command. Not on `PATH`: no link, and the output holds the full path.
- `--uninstall`: the app, the menu entry, the link, the start-at-sign-in file and the `OpenLDR Desktop` folder are gone; the marker file in the data folder is unchanged; `sudo` was called with `apparmor_parser -R` and `rm -f` for the profile; the output names the data folder.
- `--uninstall` with nothing installed: exit 0.
- `--bogus`: exit 2 and `unknown flag: --bogus`.
- the script's text holds no `--no-sandbox`, and every `sudo` in it is on a line that names `apparmor_parser` or the profile file.
- macOS (`uname` says `Darwin arm64`, a fake archive with the macOS layout): the app lands at `~/Applications/OpenLDR.app`, the fake `codesign` was called, `sudo` was never called, no menu entry was written.
- the script runs under `sh` (dash) as well as `bash`: the install test passes with both.

- [ ] **Step 2: See them fail.** `pnpm --filter @openldr/release exec vitest run src/desktop-shell.test.ts`
- [ ] **Step 3: Write `install/desktop.sh`.**
- [ ] **Step 4: Tests and typecheck** for `@openldr/release`. Name the five slowest tests.
- [ ] **Step 5: One real run against the real Linux archive, without sudo**

With a fake `HOME` under the system temp folder (and no `XDG_*` variable set), `OPENLDR_DESKTOP_DOWNLOAD_BASE` pointing with `file://` at `dist/desktop` (which holds `v<version>/` with the real Linux archive and its `SHA256SUMS`), `--version <version>`, and `OPENLDR_DESKTOP_USERNS_FILE` pointing at a file that holds `0` (so no `sudo`): the script installs the real app into the fake home. Then start the installed binary as in Task 1 step 6 (with `--no-sandbox`, because the profile step was skipped on purpose here) and show `check.json`. Then `--uninstall` and show the fake home holds no app. This proves the unpack and the layout against the real archive. It does not prove the profile; that is on the hands-on list.

- [ ] **Step 6: Commit**, files staged by name: `feat(install): a one-line installer for the desktop app on Linux and macOS`.

---

### Task 4: The installer for Windows

**Files:**
- Create: `install/desktop.ps1`
- Modify: `packages/release/src/desktop-shell.test.ts` (a describe that reads the script as text)

**Interfaces:**
- Produces: `irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1 | iex`. Options need the script-block form the docs already use, because `irm | iex` takes none: `& ([scriptblock]::Create((irm <url>))) -Version 0.1.12` and `... -Uninstall`.

Nothing on this machine runs PowerShell. The whole script is "not proven, waits for the operator". Write it to be read: short functions, one job each, a comment where a choice is not obvious.

What it does, mirroring Task 3:

- `param([string]$Version = '', [switch]$Uninstall)`. Works in Windows PowerShell 5.1. ASCII output only.
- The body runs inside one function, called on the last line. Under `irm | iex` the script runs in the person's own session: an `exit` would close their window, and `$ErrorActionPreference = 'Stop'` set at the top would stay set after the script ends. So set it inside the function, and end with `return` after printing an `X` line, never `exit`. (`install.ps1` uses `exit`; do not copy that.)
- `$ProgressPreference = 'SilentlyContinue'` inside the function, around the downloads: `Invoke-WebRequest` with its progress bar is many times slower on a file of several hundred megabytes. Print a `->` line before the download saying it may take some minutes.
- The same two overrides from the environment: `OPENLDR_DESKTOP_RELEASES_URL`, `OPENLDR_DESKTOP_DOWNLOAD_BASE`.
- Refuse a system that is not 64-bit x64 (`$env:PROCESSOR_ARCHITECTURE` is not `AMD64`, also reading `PROCESSOR_ARCHITEW6432`), naming it and the three systems that have a package.
- Find the version: `-Version`, or the first release in the list with an asset named `openldr-desktop-<version>-win32-x64.zip` (`Invoke-RestMethod` gives objects).
- Download the zip and `SHA256SUMS` to a new temp folder with `Invoke-WebRequest -UseBasicParsing`. Compare `Get-FileHash -Algorithm SHA256` with the line for the zip, ignoring case. A missing line or a different value stops: `X The download does not match its checksum. Nothing was installed.`
- The app goes to `$env:LOCALAPPDATA\Programs\OpenLDR`. If a copy is there, refuse while OpenLDR runs: its `openldr-standalone.cmd status` exits 0, or a process has its path under that folder. `X OpenLDR is running. Quit it from its tray icon, then run this again.`
- The zip holds one top folder, `OpenLDR`, with `OpenLDR\OpenLDR.exe` and `OpenLDR\openldr-standalone.cmd` in it. Unpack into the temp folder (with `"$env:SystemRoot\System32\tar.exe" -xf` when that file exists, which is much faster on a large zip, else `Expand-Archive`; call `tar.exe` by its full path, because a GNU `tar` from Git cannot read a zip), then move the unpacked `OpenLDR` folder to `...\Programs\OpenLDR.new`, then swap as in Task 3 step 9. A leftover `OpenLDR.old` with no `OpenLDR` is moved back first.
- A Start menu shortcut, `$env:APPDATA\Microsoft\Windows\Start Menu\Programs\OpenLDR.lnk`, made with the `WScript.Shell` COM object, pointing at `OpenLDR.exe`, with `IconLocation` set to `resources\app\apps\desktop\assets\icon.ico` under the app folder.
- Change no `PATH`. Print where the app is, that it is in the Start menu, the full path of `openldr-standalone.cmd`, and where the data is (the Windows path from `resolveDataDir` in `apps/standalone/src/state.ts`).
- `-Uninstall`: refuse while running; remove the app, the shortcut, the app's own folder `$env:APPDATA\OpenLDR Desktop`, and any value under `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` whose data holds the installed `OpenLDR.exe` path (match by the data, not the value's name: Electron chooses the name); leave the data folder and say where it is. With nothing installed, say so and return.
- No administrator rights anywhere: no `Start-Process -Verb RunAs`, no write outside the person's own folders and `HKCU`.

- [ ] **Step 1: Write the failing text tests**, in a describe named `'desktop.ps1 (unproven: nothing here runs PowerShell)'`, in the style of `shell.test.ts:1760-1836`:
- the file is ASCII only;
- inside the install function's own text, the checksum comparison comes before the first unpack (`indexOf` of the call that checks the hash is before the call that unpacks; helper functions defined above do not count, so cut the function's body out first);
- it holds the checksum message and the "is running" message;
- it never names `--no-sandbox`, `RunAs`, `[Environment]::SetEnvironmentVariable`, `setx` or `HKLM`;
- it holds no `exit` statement, and `$ErrorActionPreference` is set only inside a function;
- it names `System32\tar.exe` and `SilentlyContinue`;
- it names `$env:LOCALAPPDATA\Programs\OpenLDR`, `OpenLDR.lnk` and `openldr-standalone.cmd`;
- it has a `param(` block with `$Version` and `[switch]$Uninstall`;
- the asset name pattern matches `archiveName(<v>, 'win32-x64')` from `desktop-pack.ts` for a sample version.
- [ ] **Step 2: See them fail. Step 3: Write the script. Step 4: Tests and typecheck.**
- [ ] **Step 5: Commit**: `feat(install): a one-line installer for the desktop app on Windows`.

---

### Task 5: The landing page

**Files:**
- Modify: `apps/web/src/components/InstallBlock.tsx`, `apps/web/src/components/InstallBlock.test.tsx`

The landing page has no translations; its words are English literals.

Rules:
- The block shows two panels, the server install first and the desktop app second, one under the other on a phone and side by side from the `lg` breakpoint. The existing panel keeps its tabs and commands unchanged.
- Today the only words about Docker are the section's subtitle (`InstallBlock.tsx:78-80`), which would sit over both panels. The subtitle becomes `Two ways to install. Each takes one line.` The server panel gains the heading `Server, with Docker` and the sentence `The full stack on a server or a workstation. Requires Docker.`
- The desktop panel: heading `Desktop app`, one sentence `One computer, no Docker. It runs OpenLDR in a window, with its own database.`, tabs `Linux`, `macOS`, `Windows`, each with the same `CommandRow` and copy button. Commands, from the same `BASE`: Linux and macOS `curl -fsSL ${BASE}/desktop.sh | bash`; Windows `irm ${BASE}/desktop.ps1 | iex`. Under the command, one note per tab: Linux `On Ubuntu 24.04 and later it asks for the administrator password once, for the app's sandbox.`; macOS `Apple silicon only. The app is not signed.`; Windows `Windows 10 or 11, 64-bit. The app is not signed.` Each note links to `/docs/desktop-app`.
- Each panel has its own `aria-label` (`OpenLDR install command`, as today, and `OpenLDR desktop install command`), so a test can look inside one.
- At 375 px wide nothing overflows the page; a long command scrolls inside its own row, as today.

- [ ] **Step 1: Update and add tests.** The existing seven keep passing with their queries scoped to the first panel (`within`): `getByText(/curl -fsSL/)`, the copy button, `getByRole('tablist')` and `getByRole('tab', { name: 'Windows' })` each match twice once the second panel exists. New: the desktop panel shows `desktop.sh | bash` by default; its `Windows` tab shows `desktop.ps1 | iex`; its copy button writes a string containing `desktop.sh`; both panels are in the document.
- [ ] **Step 2: See the new ones fail. Step 3: Implement. Step 4:** `pnpm --filter @openldr/web test`, typecheck, each with the exit code read after a redirect.
- [ ] **Step 5: Commit**: `feat(web): the desktop app's one-line install on the landing page`.

---

### Task 6: The docs

**Files:**
- Create: `apps/web/src/docs/0.1.8/en/desktop-app.md`, `fr/desktop-app.md`, `pt/desktop-app.md`
- Modify: `apps/web/src/docs/content.ts` (`NAV`: `{ slug: 'install', children: ['windows-server', 'standalone', 'desktop-app', 'upgrading'] }`)
- Modify: `apps/web/src/docs/0.1.8/{en,fr,pt}/standalone.md`
- Modify: `README.md`, `docs/CLI-REFERENCE.md`

Do this task last, after the code fix wave, so every quoted message matches the source. Copy each quoted message, option and path from the source file, never from a report or this plan: `install/desktop.sh`, `install/desktop.ps1`, `apps/standalone/src/commands.ts` (`USAGE`), `apps/desktop/src/strings.ts` (the tray's words), `apps/studio/src/i18n/{en,fr,pt}.ts` (the first-run words).

Rules:
- `desktop-app.md`, the same headings in the same order in the three languages (`content.test.ts:12-22` counts them): what it is and which systems; install (the two one-liners, the Linux password and why, that the app is not signed); the first run (the setup code is filled in, then the three steps, each can be skipped); the window and the tray (closing keeps OpenLDR running, the four menu items, Quit stops it, starting it again shows the window); update (the same line again, quit first); remove (the option, what it removes, what it leaves); where the data is on each system, and that `openldr-standalone` works on the same data; when it will not start (the error page, the two log files, the app's own log, an older app on a newer data folder and its message, a recovery command holding the folder); limits (this computer only; no self-update; not signed; Windows and macOS packages are built on Linux).
- Say what is true today. Linux is tried. Do not write that Windows or macOS were tested.
- `standalone.md` in the three languages: the two "no installer" sentences (lines 7 and 291) now say the desktop app installs with one line and link to `/docs/desktop-app`, and that the built checkout remains the way for a developer. The options table gains `--events-fd <n>` and `status --json`, worded from `USAGE`. The data folder table gains `last-version.json` and one sentence on what it is for.
- `README.md` near line 216: stop saying there is no installer; give the two one-liners and keep the built-checkout commands for developers. Keep "Only Linux has been tested" true: say the Windows and macOS packages are new and built on Linux.
- `docs/CLI-REFERENCE.md`: a third line in the "two ways to invoke it" block for `openldr-standalone`, and a new `## The standalone launcher` section before `## Captured Terminal Output`: the four commands, `--data-dir`, `--port`, `--host`, `--events-fd` with the six event shapes, `status --json` with its three lines, the exit codes of `status`.

- [ ] **Step 1: Write the pages and edits.**
- [ ] **Step 2:** `pnpm --filter @openldr/web test` (the docs tests pin the nav and the heading counts) and typecheck.
- [ ] **Step 3: Commit**: `docs: the desktop app, its install, and the launcher's new options`.

---

### The real run (the controller does this, after Task 6)

0. Build Studio, the launcher and the app from the final head and run `pnpm pack:desktop all` again, so the archives kept for the operator hold the reviewed code. Copy `install/desktop.sh` and `install/desktop.ps1` into `dist/desktop/`, so one served folder holds the scripts and the packages.
1. The Linux archive, unpacked outside the repo, starts and shows the setup page (Task 1 step 6).
2. `install/desktop.sh` against the real archive on a fake home (Task 3 step 5), then `--uninstall`.
3. The landing block in the built-in browser at 375 x 812, with a picture.
4. The web docs page renders in the three languages.
5. Every item a review marked "proven by reading only".

HONEST NON-PROOF, stated now: nothing here runs the macOS or Windows archive, `desktop.ps1`, the macOS half of `desktop.sh` beyond a fake, the AppArmor profile, or a real release. Each is on the hands-on list.
