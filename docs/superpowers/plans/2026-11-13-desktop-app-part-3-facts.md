# Desktop app part 3: facts for the plan

What it is: the file-level facts the part 3 plan needs (packing, the release step, the two install scripts, the landing page and docs), gathered by a read-only run on 2026-11-13.
Read at commit `54408602` on `claude/desktop-app-af24b7`, with part 2 work uncommitted in `apps/desktop/src`.
They record what was true when written. Confirm each one before a brief cites it.

Spec: `docs/superpowers/specs/2026-11-13-desktop-app-design.md`, sections 6.7 to 6.9 and slices 7 to 9. Part 1 (the other systems) has not run yet, so nothing here is known about Windows or macOS beyond what is on disk.

## A. The release script and package

### scripts/release.ts (479 lines, no tests by design)

- Header comment 1-16. "This file gathers facts and sequences commands. Every decision it appears to make lives in @openldr/release, where it is unit-tested" (11-12). It imports from `../packages/release/src/<file>` directly, not from the package entry (24-37).
- `DRY_RUN = process.argv.includes('--dry-run')` (41). `sh(cmd, args)` always runs and returns stdout, stderr piped (56-63). `run(cmd, args)` prints `+ cmd args` and runs only when not a dry run (65-68). `pnpm(args)` tees output, `shell: true` on win32 (83-104).
- The script has been run on Windows: Git Bash lookup (43-46, `git-bash.ts:18`), the pnpm `.cmd` note "measured 2026-08-17 on node v24.6.0" (76-82), RELEASE.md:140-141 "on Windows and Linux alike".
- `main()` (276). Steps, with the line each begins at:
  - version from root `package.json` (277-279); `git fetch origin --tags` with `sh`, so it runs in a dry run too (293-294).
  - Preconditions 1 to 6 are gathered as `ReleaseFacts` (299-317). The gate runs inside the facts (`gateGreen: await gateGreen()`, 312), so heavy work inside fact gathering has a precedent. `evaluatePreconditions(facts)` then refuses and exits 1 (319-325). `console.log('preconditions clear\n')` (325).
  - 7. Build and push five images: `run(BASH, ['scripts/build-and-push.sh', '--tag', 'latest'])` (327-328).
  - 8. Check every package is public; skipped in a dry run (330-356).
  - 9. Verify by installing the published tag into `mkdtempSync(join(tmpdir(), 'openldr-release-'))` with `install/install.sh --dir <probe> --version <v> --require-ready --auth local` (358-377).
  - 10. Write `latest.json` into the probe folder (379-388), then the three irreversible commands in one `try` (398-412):
    - `run('git', ['tag', \`v${version}\`])` (401)
    - `run('git', ['push', 'origin', \`v${version}\`])` (403)
    - `run('gh', ['release', 'create', \`v${version}\`, '--generate-notes', manifestPath, 'deploy/install/docker-compose.yml'])` (405-412)
  - The `catch` (413-464) asks origin with `git ls-remote --tags origin refs/tags/v<v>`, deletes the remote tag then the local one, prints any command it could not run, says the five images are already pushed so a re-run refuses on the registry check, keeps the verification stack, exits 1.
  - After the try: `if (!DRY_RUN) await verifyPublishedManifest(version)` (467). `cleanUp(probe, cleanupPlan(...))` (471). `released <v>` (473).
- Assets uploaded today: `latest.json` and `deploy/install/docker-compose.yml`, both as arguments to `gh release create` (409-411). Nothing uses `gh release upload`.
- The pattern for a failure after the release is public is `verifyPublishedManifest` (204-236): retry three times, then print what is wrong, say the tag is not rolled back and why, print the fix command `gh release upload v${version} latest.json --clobber` (234), `process.exit(1)`. The comment at 229-231 says "Do not 'fix' this later."
- It reads the direct asset URL `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/latest.json` (205). Comment 197-200: the `releases/latest/download/...` alias "served the PREVIOUS release's manifest for over ten minutes after v0.1.3".
- `OWNER = 'Open-Laboratory-Data-Repository'`, `REPO = 'openldr'` (39-40).
- No build step exists. The gate is `['turbo', 'run', 'test', '--concurrency=4', '--continue']` (`gate.ts:59`). Images are built inside Docker by `build-and-push.sh`. Archives need `apps/studio`, `apps/standalone` and `apps/desktop` built on the host first.

Where the two new steps fit:
- **Build and check the archives before the tag.** After `preconditions clear` (325) and before step 7 (327). Step 7 pushes images, and after that a failed run cannot be re-run at the same version (459-461, RELEASE.md:101-110). Between 9 and 10 would also be before the tag, but a pack failure there leaves pushed images. A fact inside `ReleaseFacts` (like `gateGreen` at 312) is the other option; then the refusal goes through `evaluatePreconditions`.
- **Upload after the release is created.** Outside the step 10 `try` (after 464), beside `verifyPublishedManifest` (467). Inside the `try` a failed upload would unwind the tag, which the spec does not want (spec 6.7: "If an upload fails, the script says which file is missing and how to upload it by hand"). Copy the message shape at 226-235.
- **Dry run.** `run()` prints and skips (67). `sh()` runs anyway (56). Packing writes only into an ignored folder, so it changes nothing tracked; whether a dry run packs is a plan call. Packing for darwin and win32 needs the network (Electron zips and Postgres tarballs are not on disk, see C).

### packages/release/src

- `package.json`: `"exports": { ".": "./src/index.ts" }`, scripts `typecheck`, `test` (`vitest run`), `lint` (no-op). Depends on `@openldr/core` only.
- `index.ts` re-exports `cleanup`, `gate`, `manifest`, `preconditions`, `registry`, `third-party`, `third-party-files` (1-7). `git-bash.ts` is not re-exported; `release.ts` and `shell.test.ts` import it by path.
- `cleanup.ts` (38 lines): `type ReleaseOutcome = 'released' | 'failed'` (2); `interface CleanupPlan { teardownStack: boolean; removeDir: boolean }` (5-10); `cleanupPlan(input: { dryRun: boolean; outcome: ReleaseOutcome }): CleanupPlan` (26); `teardownCommand(dir: string): string` (36). Pure functions, a long comment saying why.
- `preconditions.ts`: `interface ReleaseFacts` (3-22) with `version, lastTag, treeClean, branch, syncedWithOrigin, gitTagExists, registryTagImages, changelogCommitted, gateGreen, thirdPartyUnavailable`; `evaluatePreconditions(f: ReleaseFacts): string[]` (28-74). Each refusal is one sentence pushed onto an array.
- `manifest.ts` is a 3-line re-export from `@openldr/core/pure` ("packages/release is maintainer tooling and must never ship in a runtime image").
- `gate.ts`: `parseFailedTasks(turboOutput): FailedTask[]` (25), `tasksNeverFinished(turboOutput, failedCount): number | null` (68), `formatFailedTask(t)` (79), `GATE_TURBO_ARGS` (59).
- `registry.ts`: `type FetchJson = (path: string) => Promise<unknown>` (5), `IMAGE_NAMES` (8), `parseGhPages` (27), `tagExistsInRegistry` (63), `imagesWithTag` (102), `findPrivatePackages` (120), `findUnavailablePackages` (135). I/O is injected as `FetchJson`, which is what makes them testable.
- The pattern a `desktop-pack.ts` decision file copies: `cleanup.ts` plus `cleanup.test.ts`. Pure function in, plain object out, `describe`/`it` with a comment per case saying why (`cleanup.test.ts:1-40`). Export it from `index.ts`. Spawning, downloads and file writes stay in the script.

### packages/release/src/shell.test.ts (1908 lines), the pattern for testing `install/desktop.sh`

- `REPO = resolve(__dirname, '../../..')` (12). `tempDir(prefix)` records every temp folder and `afterAll` removes them (14-35); the comment says 1318 stale folders once piled up.
- `toPosix(p)` turns `C:\tmp\bin` into `/c/tmp/bin` for PATH on Windows (37-44). `BASH = resolveGitBash()` (58). The gate does run these on Windows with Git Bash; Unix-only blocks use `describe.skipIf(platform() === 'win32')` (772, 1506).
- `installSh(args, existingEnv?, extraEnv)` (277-367): writes fake `docker`, `curl`, `openssl` into a temp `bin`, `chmod 0o755` (290-330), then `execFileSync(BASH, [install.sh, '--dir', dir, '--http-port', '18080', '--https-port', '18443', ...args], { env: { ...process.env, DOCKER_HOST: 'tcp://127.0.0.1:1', PATH: \`${toPosix(bin)}:${PATH}\`, OPENLDR_REPO_RAW: \`file:///${REPO}\` } })` (332-361). Returns `{ code, out, dir }`; a throw is turned into its status and output (363-366).
- The fake `curl` (313-327) creates whatever `-o` names and fails any `127.0.0.1` URL with exit 7. `DOCKER_HOST` points at a dead port as a second guard (307-312).
- `OPENLDR_REPO_RAW` is the installer's own override for its download base (`install.sh:42`, comment 37-41: two gate runs once failed on GitHub 503 and 429). `desktop.sh` needs the same kind of override for its release base URL, so a test can serve a fake release from `file://` with the real `curl`.
- Assertions are on exit code, output text (`toContain` of the exact message) and files on disk (`existsSync`, `statSync(...).mode & 0o777`, `filesUnder(dir)` at 760-770).
- `wrapperHost()` (647-728) is the pattern for a fake `HOME`: it makes `bin`, `rec`, `home`, `work`, `tmp`, and runs with a clean env `{ PATH, HOME, TMPDIR, DOCKER_HOST, ... }` (700-709) through `spawnSync(..., { timeout: 20_000 })` (722-723). The fake `docker` records each call's argv, cwd, env and stdin into numbered folders (664-683). This shape suits fake `sudo`, `apparmor_parser`, `update-desktop-database`.
- `SHELLS` runs a script under `sh` (dash), `bash`, and `busybox sh` when present (753-757).
- PowerShell is never run. The `.ps1` is read as text and asserted with `indexOf`/regex, under a describe named `'the openldr.ps1 wrapper (unproven: nothing here runs PowerShell)'` (1760-1836). That is the only test pattern for `desktop.ps1`.
- `resolveVersion(url)` sources `install/lib/resolve-version.sh` and calls it (1839-1851); `fixture(body)` writes a `latest.json` and returns a `file://` URL (1854-1859).

### RELEASE.md (228 lines)

- Preconditions are a numbered list 1-6 (22-40). Steps 7-10 are one prose paragraph (42-44): "Then it pushes the five images, checks that every package is public ..., verifies by installing the published tag into a clean directory, and only then creates the git tag, pushes it, and cuts the GitHub release with `latest.json` attached." The pack step and the upload go into that paragraph.
- "Two windows the rollback cannot cover" (57-63): a failed asset upload in `gh release create` "can leave a draft release behind, which nothing checks for".
- `### What is NOT proven by tests` (165-204). It lists, as real-release-only: the spawn helpers, `gh api --paginate` wiring, the step 10 sequence and rollback (167-171), the visibility read-back, the manifest check (178-180), the cleanup actions (182-187). Then what is unit-tested (189-196). A new pack step and upload step get a paragraph here.
- `### Installs learn about a release from latest.json` (206-212).

### package.json scripts

- `"release": "tsx scripts/release.ts"` (30), `"publish:images": "bash scripts/build-and-push.sh"` (72), `"make:changelog": "tsx scripts/make-changelog.ts"` (26), `"openldr-standalone": "node apps/standalone/dist/index.js"` (17).
- Nothing named pack or bundle for the desktop. The only bundle scripts are marketplace ones (`make:marketplace-bundle`, `make:docs-marketplace-bundle`).
- Root `version` is `0.1.11` (4). `apps/standalone` and `apps/desktop` are also `0.1.11`.

## B. The existing installers

### install/install.sh (1260 lines)

- Shebang `#!/usr/bin/env sh` (1), `set -eu` (35). POSIX sh, no `pipefail`. It is advertised as `curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash` (3).
- Options: a `while [ $# -gt 0 ]; do case "$1" in ... esac done` loop (88-127). Unknown option: `echo "unknown flag: $1" >&2; exit 2` (125).
- Finding the newest release: no GitHub API. `LATEST_URL="https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json"` (50). With `--version auto` it sources `install/lib/resolve-version.sh` from beside itself, or downloads it from `$REPO_RAW` into a temp file when piped (596-626). The default is still `VERSION="latest"`, the moving image tag (49).
- `install/lib` holds `resolve-version.sh` (24 lines, `resolve_version <url>` prints `X.Y.Z` or returns 1, "it must NOT fall back to `latest`") and `Resolve-Version.ps1` (13 lines, `Resolve-OpenLdrVersion -Url`, returns `$null` on any failure).
- No checksum is checked anywhere. Downloads are `fetch() { curl -fsSL "$REPO_RAW/$1" -o "$2" || err "failed to download $1"; }` (857).
- OS check: `case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*)` (514-515).
- Printing: plain `echo`. `err() { echo "✗ $1" >&2; exit 1; }` (713). Progress `→ ...`, success `✓ ...` (585, 1103, 1204), warning `⚠ ...`. Usage errors exit 2 (595, 716, 719).

### install/install.ps1 (812 lines)

- Advertised as `irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex` (2).
- `param(...)` block (29-71) with `[string]`, `[int]`, `[switch]`, `[ValidateSet(...)]`. `$ErrorActionPreference = "Stop"` is set after version resolution (231).
- `irm | iex` cannot pass parameters; the script says so (396: "the irm|iex one-liner can't take params"). The docs pass them with `& ([scriptblock]::Create($installer)) -Dir ...` after `$installer = Invoke-RestMethod <url>` (`apps/web/src/docs/installGuide.ts:32-49`, `operator-examples/upgrading.json:71`). `desktop.ps1 -Version` and `-Uninstall` need the same form.
- `-Version auto` uses the same `latest.json` URL (190) and loads `Resolve-Version.ps1` in memory with `Invoke-Expression ((Invoke-WebRequest -Uri $libUrl -UseBasicParsing).Content)` (213); the comment says saving and dot-sourcing a `.ps1` is blocked under the default execution policy (207-212).
- Output strings are ASCII only: `X ...` for errors (146, 172), `OK ...` (184), `-> ...` (412, 416), `! ...` (325). Non-ASCII appears only in comments. Errors use `Write-Host ... -ForegroundColor Red` then `exit 1`, or `function Die($m) { Write-Error "X $m"; exit 1 }` (330).
- It targets Windows PowerShell 5.1 as well as 7 (336, 719 mention 5.1). `Invoke-WebRequest -UseBasicParsing` throughout (428).
- Nothing on this machine runs PowerShell (`pwsh` not installed).

### How the scripts are published

- From `raw.githubusercontent.com` on `main`, not from a release asset and not from the landing site.
- `apps/web/src/components/InstallBlock.tsx:7-15`:

```ts
// Served from raw GitHub until the landing has a stable domain; then switch to
// https://<domain>/install.sh and /install.ps1.
const BASE = 'https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install';
const COMMANDS: Record<string, string> = {
  unix: `curl -fsSL ${BASE}/install.sh | bash`,
  windows: `irm ${BASE}/install.ps1 | iex`,
  // Inside a WSL2 distro you're on Linux, so it's the same shell installer as unix.
  wsl: `curl -fsSL ${BASE}/install.sh | bash`,
};
```

- `README.md:152` `curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash -s -- --server-name your.domain.com --letsencrypt you@email.com`; `README.md:160` the same for `install/development.sh`.
- So `desktop.sh` from `main` downloads archives from a release. A change to `desktop.sh` reaches people when it merges to `main`, not when a release is cut.

## C. Packing inputs

### apps/standalone

- `package.json` dependencies: `@openldr/bootstrap`, `@openldr/cli`, `@openldr/config`, `@openldr/core`, `@openldr/server` (all `workspace:*`), `cpu-features ^0.0.10`, `embedded-postgres 16.15.0-beta.19`, `pdfkit ^0.15.0`, `pg 8.21.0`, `quickjs-emscripten 0.32.0`, `ssh2 ^1.17.0`. `"type": "module"`, `"bin": { "openldr-standalone": "./dist/index.js" }`.
- `tsup.config.ts`: entries `index` and `cli` (26-29), `noExternal: [/^@openldr\//]` (33), externals `'ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten', 'embedded-postgres', /^@embedded-postgres\//, 'pg'` (41-49). The banner is `#!/usr/bin/env node` plus a `createRequire` shim (53-59). `onSuccess` copies `packages/db/fixtures/fhir/*.gz` to `apps/standalone/fixtures/fhir` (13-20, 60-62).
- `apps/standalone/node_modules` holds symlinks into the worktree's `node_modules/.pnpm`, for example `embedded-postgres -> ../../../node_modules/.pnpm/embedded-postgres@16.15.0-beta.19/node_modules/embedded-postgres`. No `@embedded-postgres/*` link sits there; the platform package is a sibling inside `.pnpm/embedded-postgres@.../node_modules/`.
- Built output today: `apps/standalone/dist` is 32 MB (index.js, cli.js and 37 chunk files). `apps/standalone/fixtures` is 972 KB (`R4.valuesets.json.gz`, `ucum.codesystem.json.gz`).

### Run-time closure of the externals (walked with Node's resolution from each real path)

116 packages in all. Sizes are apparent sizes on disk.

- `ssh2@1.17.0` (1.1 MB): deps `asn1` (then `safer-buffer`), `bcrypt-pbkdf` (then `tweetnacl`); optional `cpu-features`, `nan`. **Has `"install": "node install.js"`**, which runs `node-gyp rebuild` in `lib/protocol/crypto` (its own `binding.gyp`) and exits 0 on failure. Nothing was built here: no `build/` folder. `lib/protocol/crypto.js:29-33` loads `./crypto/build/Release/sshcrypto.node` inside `try {} catch {}`. `lib/protocol/constants.js:6-8` loads `cpu-features` inside `try`. `pnpm-workspace.yaml:30-31` has `cpu-features: false` and `ssh2: false`.
- `cpu-features@0.0.10` (0.6 MB): `binding.gyp`, `"install": "node buildcheck.js > buildcheck.gypi && node-gyp rebuild"`, deps `buildcheck`, `nan`. Not built here. Left out per spec 6.7.
- `pdfkit@0.15.2` (4.6 MB): deps `crypto-js`, `fontkit` (9 deps, among them `deep-equal`, which alone pulls about 55 small `es-*`/`is-*`/`side-channel*` packages), `jpeg-exif`, `linebreak`, `png-js`. Two copies each of `base64-js` (1.5.1 and 0.0.8) and `pako` (0.2.9 and 1.0.11). Reads its standard fonts from disk: `__dirname + '/data/Helvetica.afm'` and the rest (`js/pdfkit.js`). `packages/report-pdf/src/index.ts:160-188` uses only `Helvetica` and `Helvetica-Bold`.
- `quickjs-emscripten@0.32.0` (2.5 MB): deps `@jitl/quickjs-wasmfile-debug-asyncify`, `-debug-sync`, `-release-asyncify`, `-release-sync` (each depends on `@jitl/quickjs-ffi-types`), `quickjs-emscripten-core`. `dist/chunk-OHAYRCBA.mjs` imports all four variant packages statically, so all four must be present. `getQuickJS()` calls `newQuickJSWASMModule()`, whose default is `RELEASE_SYNC`, so only `@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm` is loaded at run time. The one caller is `packages/workflows/src/engine/js-isolate.ts:30`. The quickjs packages total about 9.2 MB.
- `embedded-postgres@16.15.0-beta.19` (40 KB): deps `exit-hook`, `pg ^8.23.1` (installed 8.23.1, a second `pg` beside the launcher's 8.21.0); optional the eight `@embedded-postgres/*` packages. The launcher never loads its code (`postgres.ts:9-10`); it only resolves it to find the platform package (`postgres.ts:102`). So `exit-hook` and `pg@8.23.1` are not needed at run time, though `embedded-postgres/package.json` and `dist/index.js` must exist for `resolve('embedded-postgres')` to succeed (its `"exports": "./dist/index.js"`).
- `pg@8.21.0` (0.1 MB): deps `pg-connection-string`, `pg-pool`, `pg-protocol`, `pg-types` (then `pg-int8`, `postgres-array`, `postgres-bytea`, `postgres-date`, `postgres-interval`, then `xtend`), `pgpass` (then `split2`); optional `pg-cloudflare`.
- Native addons in the closure: only `ssh2` (optional crypto binding, not built) and `cpu-features` (not built). No `.node` file exists anywhere in the closure. The only install scripts are those two and the Postgres platform package's `postinstall`.
- Without the Postgres package and without `cpu-features`, `nan`, `buildcheck`, the closure is about 26 MB.
- The bundle still holds bare `require("...")` calls for packages that are not in the closure: `snappy`, `kerberos`, `mongodb-client-encryption`, `@mongodb-js/zstd`, `gcp-metadata`, `aws4`, `@aws-sdk/credential-providers`, `@aws-sdk/signature-v4-crt`, `ajv/dist/runtime/*`, `ajv-formats/dist/formats`. None of them resolve from `apps/standalone/dist` in this checkout either (root `node_modules` holds 11 entries, no `ajv`, no `mongodb`), and the launcher runs from the checkout. So they are optional or code-generation strings on the paths that have run. HONEST NON-PROOF: a path not exercised in a checkout could reach one; the packed app behaves the same as the checkout there.

### embedded-postgres and its platform packages

- `embedded-postgres/dist/binary.js:2-40`: `import('@embedded-postgres/darwin-arm64')` for darwin arm64 (9), `import('@embedded-postgres/linux-x64')` (26), `import('@embedded-postgres/windows-x64')` for win32 x64 (33). The launcher does not use this file.
- The launcher's own map: `PLATFORM_PACKAGES` in `apps/standalone/src/postgres.ts:81-90`, keyed `${process.platform}-${process.arch}`: `'darwin-arm64': '@embedded-postgres/darwin-arm64'`, `'linux-x64': '@embedded-postgres/linux-x64'`, `'win32-x64': '@embedded-postgres/windows-x64'`. Comment 80: "Only linux-x64 is tested. Every other entry is unproven."
- `loadBinaries()` (94-115): `createRequire(createRequire(import.meta.url).resolve('embedded-postgres')).resolve(name)` (102-103), then `import()` of that entry, which exports three paths. Error when it cannot resolve: `` `The Postgres binaries for this computer (${name}) are not installed.` `` (105). So the platform package must be resolvable from embedded-postgres's real folder: a sibling `node_modules/@embedded-postgres/<x>` works.
- The platform package's `dist/index.js` exports `pg_ctl`, `initdb`, `postgres` as `path.resolve(__dirname, '..', 'native', 'bin', <name>)`, with no `.exe`. On Windows the binary is `postgres.exe`; whether `windows-x64`'s `dist/index.js` adds `.exe` is not known (the package is not on disk).
- `@embedded-postgres/linux-x64` layout: `LICENSE.md`, `README.md`, `dist/` (483 bytes), `native/bin` (`initdb`, `pg_ctl`, `postgres`, 9.3 MB, mode 755), `native/lib` (46.3 MB unique), `native/share` (2.1 MB), `native/pg-symlinks.json`, `scripts/hydrate-symlinks.js`, `package.json` with `"postinstall": "node scripts/hydrate-symlinks.js"`, `"os": ["linux"]`, `"cpu": ["x64"]`. Total 57.7 MB on disk.
- `pg-symlinks.json` lists 14 pairs, all inside `native/lib`, for example `{"source":"native/lib/libicudata.so.60.2","target":"native/lib/libicudata.so"}`.
- **No symlinks exist in the installed copy** (`find . -type l` gives 0). The 14 targets are regular files, hard links of the same content (link count 13 for the ICU files, shared with the store). So here the link targets came as full files and `hydrate-symlinks.js` had nothing to do (it swallows "already exists", `hydrate-symlinks.js:27-32`). Counted per name, as `zip` would store them, `native/lib` is 111.6 MB instead of 46.3 MB (`libicudata.so*` is 26.9 MB three times). GNU `tar` stores a second hard link as a link entry; `zip` stores the file again.
- `embedded-postgres/dist/symlinks.js`: `verifySymlinks` checks each target with `fs.access` (17-32). The launcher does not call it.
- `pnpm-lock.yaml` has the npm integrity for the two other packages: `'@embedded-postgres/darwin-arm64@16.15.0-beta.19'` `sha512-pXgn5H+fHX+jjjE4NcvG2+J3uob8rzuoV0VWXOPkGJqUcaKfctcNFm7Z7DwR2kG5SaXwyfww/q0/OwtQHG7Ivg==` (1933-1934) and `'@embedded-postgres/windows-x64@16.15.0-beta.19'` `sha512-WRXocVOMYzCweLMLEBKNBZwAup9cnZSkJhHqodrFitiQTsxFxCEak7tq5ITu23igqQs4kJTjA6XqxCMR4wytTg==` (1975-1976). A pack script can check a fetched tarball against these.
- `pnpm-workspace.yaml:35-44` allows builds for all eight `@embedded-postgres/*` packages.

### What the launcher reads from disk beside itself

All relative to `apps/standalone/dist/index.js` (the bundle; `import.meta.url` is the bundle file for every bundled package):

- `../fixtures/fhir/*.gz`: `packages/db/src/bundled-terminology.ts:14` `join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fhir')`, filled by tsup `onSuccess`. The Docker image does the same copy (`apps/server/Dockerfile:19-27`).
- `../../studio/dist` (must hold `index.html`): `launcherFiles` in `apps/standalone/src/commands.ts:158-163`, checked at 311 with `STUDIO_MISSING` (115). It reaches the server as `WEB_DIST_DIR` (`environment.ts:62`); the server's own fallback is `apps/server/src/app.ts:247`.
- `../../../package.json` for the version: `commands.ts:162` reads `resolve(appDir, '..', '..', 'package.json')` with `appDir = <bundle>/..`, then the app's own `package.json`, then `'0.0.0'`. It reaches the server as `APP_VERSION`. `readCeVersion` (`packages/bootstrap/src/plugin-registry.ts:21-39`), `runningVersion` (`packages/cli/src/update.ts:22-40`) and `readAppVersion` (`apps/server/src/version.ts:10-27`) all prefer `APP_VERSION`, then walk `../../../package.json`, `../../package.json`, `../package.json`.
- `dist/cli.js`: `cliEntryFile` (`commands.ts:171-173`) returns `join(appDir, 'dist', 'cli.js')`.
- `apps/standalone/package.json` is needed for `"type": "module"`: `dist/index.js` is ESM with a `.js` name. The same holds for `apps/desktop/package.json` (`"type": "module"`, `"main": "dist/main.js"`).
- External packages' own files: pdfkit's `js/data/*.afm`, quickjs's `.wasm`, Postgres `native/`.
- Nothing else found. `packages/fhir/src/paths/generate.ts:47` is a dev generator. `packages/terminology/src/ontology/adapters/loinc.ts` reads files the person supplies. No Kysely `FileMigrationProvider` or `readdirSync` of migrations exists in `packages/db`, `packages/bootstrap` or `apps/server` (migrations are bundled). `apps/server/src/cli-runner.ts:65-69` looks for `../cli/dist/index.js` or `../../../packages/cli/dev.mjs` only when `CLI_ENTRY` is unset; the launcher sets it.

### apps/studio/dist is large

- `apps/studio/dist` is **407 MB**: `assets/` 406 MB, of which 1101 PNG files are 403 MB (in-app docs screenshots such as `preferences-guide-language-french-*.png`, about 1 MB each) and 66 MP4 files 9 MB. JS is 9.2 MB. PNG does not compress further.
- So one archive holds roughly: Electron 274 MB (linux, unpacked) + Studio 407 MB + Postgres 58 MB (123 MB in a zip) + launcher 33 MB + packages 26 MB. Each compressed archive will be several hundred MB, mostly the PNGs and Electron. Three per release.

### apps/desktop as it is now (mid-build)

- `package.json`: `"main": "dist/main.js"`, `"type": "module"`, scripts `build` (`tsup`), `typecheck`, `test`, `lint`, `start` (`electron .`), `dev` (`electron --no-sandbox .`). Only devDependencies: `electron 45.3.0`, `tsup`, `typescript`, `vitest`. No run-time dependencies.
- `tsup.config.ts`: `main` as ESM (`target: 'node22'`, `external: ['electron']`), `preload` as CJS to `preload.cjs`.
- Folders: `assets/` (`icon.png`, `tray.png`), `pages/` (`page.css`, `page.html`, `page.js`), `dist/` (`main.js`, `preload.cjs`), `src/`.
- `src`: `autostart.ts`, `channels.ts`, `controller.ts`, `launcher.ts`, `locality.ts`, `main.ts`, `ports.ts`, `preload.ts`, `selfcheck.ts`, `settings.ts`, `strings.ts`, plus tests.
- `main.ts:43` finds the launcher at `resolve(here, '..', '..', 'standalone', 'dist', 'index.js')`. `main.ts:39` finds the page at `join(here, '..', 'pages', 'page.html')`; `main.ts:252` the tray at `join(here, '..', 'assets', 'tray.png')`.
- The launcher runs as Node through `ELECTRON_RUN_AS_NODE: '1'` (`launcher.ts:77-79`) with `process.execPath` (`main.ts:42`).
- The app's own folder: `app.setName('OpenLDR Desktop')` and `join(app.getPath('appData'), 'OpenLDR Desktop')`, overridable with `OPENLDR_DESKTOP_USER_DIR` (`main.ts:24-26`). Test overrides: `OPENLDR_DESKTOP_DATA_DIR` (44), `OPENLDR_DESKTOP_PORT` (46).
- Autostart on Linux writes `~/.config/autostart/openldr-desktop.desktop` (`autostart.ts:10-11`) with `Exec=<execPath> [appArgs] --hidden` (25-27). `--uninstall` should remove it too.
- `main.ts:248`: `appArgs: app.isPackaged ? [] : [app.getAppPath()]`. See the trap on `isPackaged` below.

### Electron 45.3.0 on disk

- `apps/desktop/node_modules/electron -> ../../../node_modules/.pnpm/electron@45.3.0_supports-color@7.2.0/node_modules/electron`. Its `package.json` deps: `@electron-internal/extract-zip ^1.0.1`, `@electron/get ^5.0.0`, `@types/node ^24.9.0`; bins `electron` (`cli.js`) and `install-electron` (`install.js`); `"engines": { "node": ">= 22.12.0" }`.
- `dist/` (linux) is 274 MB: binary `electron` (234 MB), `chrome-sandbox` (15 KB, **mode 0755, not setuid**), `chrome_crashpad_handler`, `icudtl.dat`, `libffmpeg.so`, `libvk_swiftshader.so`, `libvulkan.so.1`, `locales/`, `resources/`, `resources.pak`, `chrome_100_percent.pak`, `chrome_200_percent.pak`, `snapshot_blob.bin`, `v8_context_snapshot.bin`, `vk_swiftshader_icd.json`, `LICENSE`, `LICENSES.chromium.html`, `version` (`45.3.0`). All dated 1980 (from the zip). `path.txt` holds `electron`.
- `dist/resources/` holds only `default_app.asar`. Electron loads `resources/app.asar`, then `resources/app`, then `default_app.asar`; that order is from Electron's docs, no copy on disk confirms it.
- `checksums.json` holds 67 SHA-256 values, among them:
  - `electron-v45.3.0-darwin-arm64.zip` `b0c7cbb70f98ff72beffa98b4c449a7d92d8b51d3d25817cfcdcb6ee2d61711a`
  - `electron-v45.3.0-linux-x64.zip` `4930ece46f988e5874df77e943d98a10655d3da9e268e66ed86c1250bdca089c`
  - `electron-v45.3.0-win32-x64.zip` `b43b532e712a4323f4224627b73808a039c9769fdf7ba1dbc3cb49c1dbfa350b`
- `install.js:3` `require('@electron/get')`; it honours `ELECTRON_INSTALL_PLATFORM` and `ELECTRON_INSTALL_ARCH` (18-19) and passes `checksums: require('./checksums.json')` (45-48).
- `@electron/get@5.1.0` is installed at `node_modules/.pnpm/@electron+get@5.1.0_supports-color@7.2.0/node_modules/@electron/get`, `"exports": "./dist/index.js"`. It is **not** at the root `node_modules` and not in `apps/desktop/node_modules`; only in `.pnpm/node_modules/@electron/get` (pnpm's hidden hoist). A script reaches it by resolving from Electron's real folder, or the plan adds it as a devDependency.
- Signature (`dist/index.d.ts:17`): `export declare function downloadArtifact(artifactDetails: ElectronPlatformArtifactDetailsWithDefaults | ElectronGenericArtifactDetails): Promise<string>;`. Fields (`dist/types.d.ts`): `version`, `artifactName: string` (72), `platform?`, `arch?` (225-243), `checksums?: Record<string, string>` (122), `unsafelyDisableChecksums?` (105), `cacheRoot?` (132), `isGeneric` (196, 207).
- Download cache `~/.cache/electron/` holds `electron-v45.3.0-linux-x64.zip` (123,825,417 bytes) and older Linux versions. **No darwin or win32 zip is cached.**
- Fuses: no `@electron/fuses` or `@electron/asar` package is installed. The fuse wire in `dist/electron` after the sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX` reads version 1, length 9, states `101100011`. With the fuse order as `@electron/fuses` defines it (RunAsNode first), **RunAsNode is on** in the stock binary. The order is from memory of that package, not from a file on disk. The app depends on it (`ELECTRON_RUN_AS_NODE`).

### AppArmor on this machine (Ubuntu 26.04)

- `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` is `1`. `/proc/sys/kernel/apparmor_restrict_unprivileged_unconfined` is `1`.
- `apparmor_parser --version`: `AppArmor parser version 5.0.2`. `/etc/apparmor.d/abi/` holds `3.0`, `4.0`, `4.0-ip`, `5.0`, `5.0-interface`, `kernel-5.4-*`.
- Electron and Chromium profiles present: `Discord`, `ai.opencode.desktop`, `brave`, `chrome`, `claude-desktop`, `code`, `msedge`, `obsidian`, `opera`, `signal-desktop`, `slack`, `vivaldi-bin`.
- `/etc/apparmor.d/code` (from the `apparmor` package), in full:

```
# This profile allows everything and only exists to give the
# application a name instead of having the label "unconfined"

abi <abi/5.0>,
include <tunables/global>

profile vscode /usr/share/code{/bin,}/code flags=(unconfined) {
  userns,
  @{exec_path} mr,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/code>
}
```

- `/etc/apparmor.d/claude-desktop` (181 bytes, not from a package), in full:

```
abi <abi/4.0>,
include <tunables/global>

profile claude-desktop /usr/lib/claude-desktop/claude-desktop flags=(unconfined) {
  userns,

  include if exists <local/claude-desktop>
}
```

- `chrome` and `obsidian` match `code`'s shape with `abi <abi/5.0>`. Every one names one absolute path for the binary.

## D. Landing page and docs

### InstallBlock

- `apps/web/src/components/InstallBlock.tsx` (131 lines). English literals, no i18n: the landing page has none (`apps/web/src` has no `i18n` folder; no `useTranslation`). Only the web docs are in three languages.
- Shape: section `id="install"`, `aria-label="OpenLDR installation"` (69-72); heading `Install in one line` (77) and subtitle `Requires Docker. The installer brings up the full stack locally` (78-80); a panel `aria-label="OpenLDR install command"` (83-86); `Tabs` with `value={activeCommand}` (87), triggers `unix` "Linux / macOS", `windows` "Windows", `wsl` "Windows Server" (89-106); each `TabsContent` holds `<CommandRow command={COMMANDS.x} />` and a `<PlatformNote>` (108-126).
- `CommandRow` (44-54): label `Installation command`, a `CopyCommandButton`, and the command in a `code` with `min-w-0 overflow-x-auto whitespace-nowrap`. `CopyCommandButton` (17-42): `Button variant="ghost" size="icon" aria-label="Copy command"`, `navigator.clipboard.writeText`, a tick for 1.5 s.
- Mounted at `apps/web/src/App.tsx:42`.
- Tests `InstallBlock.test.tsx` (63 lines, 7 tests): default shows `curl -fsSL` and `install\.sh \| bash`; the `Windows` tab (opened with `fireEvent.mouseDown(..., { button: 0, ctrlKey: false })`, comment 14-16) shows `irm` and `install\.ps1`; the `Windows Server` tab text and link; copy writes a string containing `install.sh`; the region label; `min-w-0`; the panel classes. `getByText(/curl -fsSL/)` and `getByRole('button', { name: /copy/i })` will match twice once a second command shows at the same time, so "beside the Docker one" breaks those queries.
- To add the desktop one-liner: `InstallBlock.tsx` (a second command constant set, rows or tabs, and the subtitle, which says Docker is required) and `InstallBlock.test.tsx`. No i18n files.

### Web docs

- `apps/web/src/docs/content.ts`: glob `import.meta.glob('./*/*/*.md', { query: '?raw', eager: true, import: 'default' })` (16-20), keyed `version/locale/slug` (22-29). `DEFAULT_DOC_VERSION` is the app version if a folder has that name, else the newest folder (50-51). Folders: `0.1.0` and `0.1.8`; the app is `0.1.11`, so `0.1.8` is shown.
- A new page: add the three files `0.1.8/{en,fr,pt}/<slug>.md` and the slug in `NAV` (54-65). Install today: `{ slug: 'install', children: ['windows-server', 'standalone', 'upgrading'] }` (57). The title is each file's first `# ` line.
- `content.test.ts` pins: `DEFAULT_DOC_VERSION` is `'0.1.8'` (8); every `NAV` slug has en, fr and pt with the same count of `#`, `##`, `###` headings (12-22); `has no page outside the sidebar` (46-48). `DocsPage.test.tsx:51-60` renders `/docs/standalone` and expects an h2 `Build it`.
- `standalone.md` lines that say there is no installer:
  - en:7 "There is no installer yet." and en:291 "- No installer yet. You run it from a built source checkout."
  - fr:7 "Il n'existe pas encore d'installateur." and fr:291 "- Pas encore d'installateur. Vous l'exécutez depuis une copie compilée du dépôt."
  - pt:7 "Ainda não existe instalador." and pt:291 "- Ainda sem instalador. Executa-o a partir de uma cópia compilada do repositório."
- en:83 `### 3. Choose other options if you need them`; the options table 85-89 lists `--data-dir`, `--port`, `--host`. It lacks `--events-fd` and `status --json`, which part 2 added (`commands.ts:978-991`; ruling R27 gives part 3 their docs). The `USAGE` lines are:
  - `'           --events-fd <n>  Write one JSON line per event to descriptor n (3 or higher).'`
  - `'                            No setup code is made or printed.'`
  - `'           --json  Print one JSON line instead.'` (under `status`)
- en:93-116 data folder table lacks `last-version.json`, added by part 2 (`apps/standalone/src/state.ts:128`).
- Other pages that will read wrong: `getting-started.md:22` ("Only Linux has been tested", links `/docs/standalone`); `cli-access.md` links the standalone page.
- `installGuide.ts` holds Windows example commands for the install page (`& ([scriptblock]::Create($installer)) ...`, 32-49).

### Repo docs

- `README.md:214` `### 4. Run without Docker on one computer`; `README.md:216` "Only Linux has been tested. There is no installer yet, so you run it from a built checkout:". Commands 218-223 and 228-232; the docs link at 234.
- `docs/CLI-REFERENCE.md` (259 lines): `# OpenLDR CE CLI Reference` (1), "two ways to invoke it" block (10-17), `## How a command runs` (20), `## Exit Codes` (40), `## Command Families` (44, a `| Command | Purpose |` table), `## Copy-Paste Examples` (83), `## Ingesting data with openldr ingest` (107), `## Sync` (135), `## Facilities` (203), `## Patients` (218), `## Captured Terminal Output` (251). It never mentions `openldr-standalone`. A launcher section fits after `## Exit Codes` or as a new `##` before `## Captured Terminal Output`, plus a third line in the "two ways to invoke it" block.
- `docs/HTTP-API.md` `## Settings` (304), table header 308-309, rows 310-314 (`flags`, `numbers`, `danger/:action`), each `| Method | Path | Purpose |`. `/api/settings/setup-checks` is under `## Core` (20). The sample data route is not in the server yet (no `sample` route under `apps/server/src`), so its row waits for part 2.

### Landing changelog

- `scripts/make-changelog.ts:17` `const OUT = join(repoRoot, 'apps/web/src/landing/changelog.json');`, written at 78-79. Nothing more for part 3.

### .gitignore

- `dist/` is ignored at every depth (2). Also `temp/`, `output/playwright/`, `e2e/artifacts/`, `.superpowers/`, `apps/standalone/fixtures/`. No `out/`, `release/` or `artifacts/` entry.
- A root `dist/desktop/` (or `apps/desktop/dist/release/`) is already ignored by `dist/`, so the release's clean-tree check (`release.ts:302`) stays clean after packing. A new name such as `release-out/` would need its own line.

## E. Tools on this machine

- Present: `zip` (Info-ZIP 3.0), `unzip` (6.00), `tar` (GNU tar 1.35; has `--owner`, `--numeric-owner`, `--sort=name`, `--mtime`, `--hard-dereference`), `sha256sum`, `shasum`, `7z`, `gh` 2.46.0, `desktop-file-validate`, `update-desktop-database`, `apparmor_parser`, `aa-exec`, `node` v24.1.0, `npm` 11.3.0.
- Missing: `pwsh`, `shellcheck`, `bsdtar`, `codesign`, `xattr`.
- `gh release upload <tag> <files>... [flags]`, one flag `--clobber` ("Overwrite existing assets of the same name"). `gh release create` has `--draft`, `--verify-tag`, `--notes-file`, `--latest`.
- `@embedded-postgres/darwin-arm64` and `@embedded-postgres/windows-x64` are **not** on disk: not in `node_modules/.pnpm`, not in the pnpm store index (`~/.local/share/pnpm/store/v10`), nowhere under `/` to depth 6. pnpm skipped them as optional packages for other systems. Packing for macOS and Windows has to fetch them.

## Gaps and traps the research found

1. **The release has been run on Windows.** `release.ts` carries Windows guards (43-46, 76-82) and RELEASE.md:141 says the login works "on Windows and Linux alike". A pack step that builds the macOS app (symlinks, exec bits) or a Linux tar (modes) cannot be made on Windows with the same tools. The plan must say the release runs on Linux, or make the pack step refuse on Windows.
2. **Place the pack step before step 7, not just before the tag.** Images pushed in step 7 make every re-run of that version refuse (`release.ts:457-461`). A pack failure after step 7 costs a version number.
3. **Upload outside the step 10 `try`.** Inside it, a failed upload unwinds the tag. Copy `verifyPublishedManifest`'s no-rollback message (226-235). `gh release create` with extra files also risks the draft release RELEASE.md:57-60 warns about.
4. **`app.isPackaged` and the binary name.** `main.ts:248` passes `app.getAppPath()` to the autostart entry when not packaged. Electron decides `isPackaged` from the executable's name (`electron` or `electron.exe` means not packaged); this is from Electron's source as remembered, not confirmed on disk (`electron.d.ts:2154-2159` only says "returns true if the app is packaged"). On macOS the binary is `Contents/MacOS/Electron`. If the archives keep Electron's names, autostart gets an extra argument. Renaming the binary (and on macOS `CFBundleExecutable` in `Info.plist`) is the usual fix. Check on Linux with the packed app.
5. **`ELECTRON_RUN_AS_NODE` needs the RunAsNode fuse on.** It is on in the stock binary (fuse wire `101100011`, mapping from memory). Nothing here flips fuses, and nothing should.
6. **Hard links and size.** The Postgres package's 14 "symlinks" are regular files here. A tar keeps them as hard links if the source copies are hard-linked; a zip stores 123 MB instead of 58 MB. Packages fetched from npm for macOS and Windows may hold real files, symlinks, or neither until `hydrate-symlinks.js` runs. Part 1, Task 1 step 5 says to run that script on the unpacked copy; check `find -type l` afterwards.
7. **Studio is 407 MB, almost all PNG.** Each archive is several hundred MB compressed, three per release. Worth a line in the plan; not something part 3 should change on its own.
8. **`@electron/get` is not importable from the repo root or `apps/desktop`.** It lives only under `.pnpm`. Resolve it from Electron's real folder, or add it as a devDependency (a lockfile change in the `apps/desktop` importer).
9. **No darwin or win32 inputs are on disk.** Electron zips (checksums in `checksums.json`) and the two Postgres tarballs (integrity in `pnpm-lock.yaml:1933-1934`, `1975-1976`) must be downloaded. Building and checking all three archives on this machine needs the network once.
10. **`chrome-sandbox` is mode 0755 in the zip.** With the AppArmor profile giving `userns`, the setuid helper is not needed. Without the profile, Electron cannot start sandboxed on this Ubuntu (`apparmor_restrict_unprivileged_userns` is 1).
11. **The AppArmor profile names one absolute path.** Every profile here attaches to a fixed path. The install goes under the person's home, so the profile names that home's path, and a second user needs a second profile. Use `abi <abi/4.0>`: Ubuntu 24.04 ships AppArmor 4.0, and `abi/5.0` exists only from 5.0 (this machine has both). `flags=(unconfined)` with `userns,` is the shape the system's own profiles use.
12. **Testing `desktop.sh`'s sudo step.** The script reads `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` and calls `sudo` and `apparmor_parser`. A test needs that path overridable by an environment variable, and fake `sudo`/`apparmor_parser` on `PATH`, in the `wrapperHost` style. These tests must `skipIf(platform() === 'win32')`.
13. **A release base URL override.** `desktop.sh` needs an env override for where it downloads releases (like `OPENLDR_REPO_RAW`, `install.sh:42`), or the shell tests hit GitHub.
14. **Finding the newest release.** The installers use `releases/latest/download/latest.json`; that alias lagged the new release by over ten minutes (`release.ts:197-200`). The GitHub API (`api.github.com/repos/.../releases`) is not used anywhere and is rate-limited without a token. "Newest release that has an archive for this system" needs one of the two.
15. **"Running from an older copy" is not visible.** `status --json` prints `{ dataDir, running, address, host? }` (`commands.ts:669-688`): no executable path, no version. The installer can tell that OpenLDR runs, not from which copy. The lock's pid is the only lead.
16. **PowerShell options.** `irm | iex` takes no parameters (`install.ps1:396`). `desktop.ps1 -Version` and `-Uninstall` need the `& ([scriptblock]::Create($installer)) -Uninstall` form the docs already use. Keep output ASCII (`X`, `OK`, `->`) as `install.ps1` does. Nothing here can run it.
17. **`InstallBlock` tests break on two commands at once.** `getByText(/curl -fsSL/)` and the single copy button query assume one visible command.
18. **Docs already stale beyond the installer lines.** `standalone.md`'s options table lacks `--events-fd` and `status --json`; the data folder table lacks `last-version.json`; `getting-started.md:22` says only Linux was tested. `content.test.ts:12-22` makes any heading added in one language fail until the other two match.
19. **The launcher's `package.json` files must ship.** `dist/index.js` and `apps/desktop/dist/main.js` are ESM with `.js` names; `"type": "module"` comes from `apps/standalone/package.json` and `apps/desktop/package.json`. The root `package.json` in the archive gives the version (`commands.ts:162`).
20. **Electron's Node and `node:sqlite`.** The launcher keeps `node:sqlite` (`tsup.config.ts:50-52`) and targets `node20`. Which Node Electron 45 carries was not checked here; part 2's real runs under `ELECTRON_RUN_AS_NODE` are the evidence to cite.
