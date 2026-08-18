# CLI Distribution (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `openldr` CLI runnable on a production Docker install, where today it does not exist.

**Architecture:** Ship the CLI's built bundle inside the existing api image rather than as a
sixth image. The installer writes a small `openldr` wrapper into the install directory that
shells to `docker compose exec api`. A `./data` bind mount gives file-taking commands a path
that exists on both sides.

**Tech Stack:** Node 22, tsup (esbuild), pnpm workspaces + `pnpm deploy`, Docker Compose,
POSIX sh and PowerShell installers, vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-cli-distribution-and-identity-design.md` (sections
1, 6, 7, 8). Sections 2-5 of that spec are slice 2 and are **out of scope here**.

## Global Constraints

- No `Co-Authored-By` trailers on any commit (`AGENTS.md` §9).
- Never pipe `pnpm turbo run test` through `tail` — it truncates the failure list (`CLAUDE.md`).
- `apps/server` is the only package with real lint. It enforces the `return`/`await reply.send`
  rule. This slice does not touch server routes, so that rule should not come up.
- Build the asked thing only (`AGENTS.md` §4). Slice 1 adds **no** authentication and **no**
  capability gating. If you find yourself editing `packages/cli/src/cli-actor.ts`, stop — that is
  slice 2.
- Commit after each task. Do not squash tasks together.
- Do not push. Do not open a PR. (`AGENTS.md` §9 — commit only when asked, and merging is to
  local `main` first.)

---

## File Structure

**Modified:**

- `packages/cli/tsup.config.ts` — add the same `external` list the server already carries, so the
  built CLI does not inline packages that must resolve from disk at runtime.
- `packages/cli/package.json` — declare those four externals as direct dependencies so
  `pnpm deploy` installs them into the CLI's `node_modules`.
- `apps/server/Dockerfile` — build and deploy `@openldr/cli` alongside the server; copy its
  bundle and its terminology fixtures into the runtime image.
- `deploy/install/docker-compose.yml` — add the `./data:/data` bind mount to the `api` service.
- `install/install.sh` — create `./data`, write the `openldr` wrapper, make it executable.
- `install/install.ps1` — the same, writing `openldr.ps1`.
- `docs/OPERATOR-GUIDE.md`, `docs/CLI-REFERENCE.md`, `docs/CONFIGURATION.md`,
  `apps/web/src/docs/0.1.0/cli.md`, `apps/web/src/docs/0.1.0/load-data.md` — replace
  `pnpm openldr` with the deployed invocation and explain the two ways to run it.

**Created:**

- `packages/cli/src/build-config.test.ts` — guards the externals against drift, and asserts the
  built bundle did not inline pdfkit.

**Not touched:** `packages/cli/src/cli-actor.ts`, `packages/cli/src/program.ts`,
`packages/db/src/role-store.ts`, anything under `apps/studio`.

---

## Why Task 1 exists — read this before starting

`packages/cli/tsup.config.ts` sets `noExternal: [/^@openldr\//]`, so the CLI bundle inlines every
workspace package, exactly like the server's. But the server's `tsup.config.ts:22` also carries:

```ts
external: ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten'],
```

with a long comment explaining that each of those four resolves a file from disk at runtime —
native `.node` addons, pdfkit's `.afm` font metrics, quickjs's `emscripten-module.wasm` — and that
bundling them breaks that resolution **only in the built image**, never from a source checkout.

**The CLI config has no `external` list at all.** It reaches all four through
`@openldr/bootstrap`. Nothing has caught this because `pnpm openldr` runs the TypeScript source
through tsx (`packages/cli/dev.mjs`), never `dist/`, and the CLI's `build:check` only runs
`--help`, which loads none of those paths.

So the built CLI is essentially unexercised. Putting it in the image without Task 1 ships a binary
that prints `--help` correctly and then dies the first time someone runs a report or a workflow.

---

### Task 1: Make the built CLI survive outside a source checkout

**Files:**
- Modify: `packages/cli/tsup.config.ts`
- Modify: `packages/cli/package.json`
- Test: `packages/cli/src/build-config.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `packages/cli/dist/index.js` that leaves `ssh2`, `cpu-features`, `pdfkit`, and
  `quickjs-emscripten` as runtime imports, plus a `packages/cli/node_modules` populated by
  `pnpm deploy`. Task 2 copies both into the image.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/build-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Module scope, not inside the test — `it.skipIf` is evaluated at collection time.
const BUNDLE = join(PKG_ROOT, 'dist', 'index.js');

/** The four packages the SERVER externalises. Each resolves a data file or a native addon from
 *  disk at runtime, so bundling it breaks that lookup in the built image only. The CLI reaches
 *  all four through @openldr/bootstrap, so it needs the identical treatment.
 *  Source of truth: apps/server/tsup.config.ts. */
const MUST_BE_EXTERNAL = ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten'];

describe('cli build config', () => {
  it('externalises every package the server externalises', async () => {
    const mod = await import('../tsup.config');
    const cfg = mod.default as { external?: string[] };
    for (const dep of MUST_BE_EXTERNAL) {
      expect(cfg.external ?? []).toContain(dep);
    }
  });

  it('declares each externalised package as a direct dependency', () => {
    // An external that is NOT a direct dependency is worse than bundling it: pnpm deploy
    // resolves only declared deps, so the import survives the bundle and then fails to
    // resolve at runtime with ERR_MODULE_NOT_FOUND.
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const dep of MUST_BE_EXTERNAL) {
      expect(pkg.dependencies[dep], `${dep} missing from packages/cli dependencies`).toBeTruthy();
    }
  });

  // `skipIf`, not an early `return`. The plain test gate runs without a prior build, so an
  // early return would report GREEN having checked nothing — a test that silently asserts
  // nothing in its most common execution. Skipped is the honest signal.
  it.skipIf(!existsSync(BUNDLE))('does not inline pdfkit into the bundle', () => {
    // `AFMFont` is a pdfkit-internal identifier that appears nowhere else. Present in the
    // bundle ⇒ pdfkit was inlined ⇒ its .afm font metric files will not travel and every
    // PDF-producing command dies in the image.
    expect(readFileSync(BUNDLE, 'utf8')).not.toContain('AFMFont');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @openldr/cli exec vitest run src/build-config.test.ts
```

Expected: the first two tests FAIL. The first reports the received array as `undefined` or
missing `ssh2`. The second reports `ssh2 missing from packages/cli dependencies`.

The third test reports **skipped**, not passed, because `packages/cli/dist/` does not exist yet.
That is intended — Step 5 builds it and gives that test something to check. If it reports
*passed* here, `it.skipIf` was written as an early `return` instead; go back and fix it.

- [ ] **Step 3: Add the external list**

In `packages/cli/tsup.config.ts`, add the `external` key immediately after `noExternal`:

```ts
  noExternal: [/^@openldr\//],
  // Deps that must stay external — bundling them breaks runtime file resolution. The CLI
  // reaches all four through @openldr/bootstrap and needs the same treatment the server
  // already has (apps/server/tsup.config.ts), for the same reasons:
  //  - ssh2 / cpu-features: native `.node` addons (SFTP).
  //  - pdfkit: loads its standard-font `.afm` metric files from disk at runtime.
  //  - quickjs-emscripten: resolves `emscripten-module.wasm` relative to its own module URL.
  // Bundled, each fails ONLY in the built image — from a source checkout `pnpm openldr` runs
  // the TypeScript source through tsx and never touches dist/, so nothing here is exercised
  // by the dev path or by `build:check`'s `--help`.
  external: ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten'],
```

- [ ] **Step 4: Declare them as direct dependencies**

In `packages/cli/package.json`, add these four to `dependencies`, keeping the block
alphabetically sorted is not the local style — the existing list is grouped, so append them after
`commander`. Use the exact versions `apps/server/package.json` already pins, so pnpm resolves one
copy, not two:

```json
    "commander": "^12.1.0",
    "cpu-features": "^0.0.10",
    "pdfkit": "^0.15.0",
    "quickjs-emscripten": "0.32.0",
    "ssh2": "^1.17.0"
```

Note `quickjs-emscripten` is pinned exactly (no caret) in the server. Match it exactly — a
mismatch here means two versions in the store and a different wasm file per copy.

- [ ] **Step 5: Install, build, and run the tests**

```bash
pnpm install
pnpm --filter @openldr/cli build
pnpm --filter @openldr/cli exec vitest run src/build-config.test.ts
```

Expected: `pnpm install` reports the four additions to `packages/cli`. The build succeeds. All
three tests PASS — and the third is now a real assertion, because `dist/index.js` exists.

- [ ] **Step 6: Confirm the built binary still runs**

```bash
node packages/cli/dist/index.js --help
```

Expected: the command list prints, starting with `Usage: openldr`. Exit code 0.

This is the same check `build:check` does. It proves the bundle loads. It does **not** prove
pdfkit or quickjs work — no offline command exercises them. That is verified by hand in Task 5.

- [ ] **Step 7: Run the CLI package's full suite**

```bash
pnpm --filter @openldr/cli test
```

Expected: PASS. If a test times out, re-run this package alone before blaming the change —
gate failures here are usually timeouts, not regressions (`CLAUDE.md`).

- [ ] **Step 8: Commit**

```bash
git add packages/cli/tsup.config.ts packages/cli/package.json packages/cli/src/build-config.test.ts pnpm-lock.yaml
git commit -m "fix(cli): externalise the deps that resolve files from disk at runtime"
```

---

### Task 2: Put the CLI in the api image

**Files:**
- Modify: `apps/server/Dockerfile`

**Interfaces:**
- Consumes: Task 1's `packages/cli/dist/index.js` and its four external deps.
- Produces: the CLI at **`/app/cli/dist/index.js`** inside `ghcr.io/…/openldr-api`, with
  terminology fixtures at `/app/cli/fixtures/fhir/`. Tasks 3 and 4 hardcode that path.

**Background you need:** `@openldr/db` resolves its bundled terminology fixtures relative to its
own module URL — `packages/db/src/bundled-terminology.ts:14` computes
`dirname(import.meta.url)/../fixtures/fhir`. Because `noExternal` inlines `@openldr/db` into
whichever bundle imports it, that path becomes `<bundle-dir>/../fixtures/fhir`. The server
Dockerfile already handles this for `/app/dist` by copying fixtures to `/app/fixtures`. The CLI
bundle sits in a different directory, so it needs **its own copy** at `/app/cli/fixtures`, or
`openldr db seed` and the terminology commands log "fixture missing" and come up with no
terminology.

- [ ] **Step 1: Build both packages in the build stage**

In `apps/server/Dockerfile`, replace the single build line:

```dockerfile
RUN pnpm turbo build --filter @openldr/server
```

with:

```dockerfile
RUN pnpm turbo build --filter @openldr/server --filter @openldr/cli
```

- [ ] **Step 2: Deploy the CLI beside the server**

Immediately after the existing server deploy line, add a second deploy and a second fixture
copy. The full block becomes:

```dockerfile
# pnpm deploy resolves the server's workspace deps into a self-contained dir (/deploy).
RUN pnpm --filter @openldr/server deploy --prod --legacy /deploy
# The operator CLI, deployed the same way into its own dir. It is NOT a dependency of the
# server — a separate deploy keeps the server's runtime tree unchanged. Shipping it here
# rather than as a sixth image is deliberate: every workspace package the CLI needs is already
# in this image via @openldr/bootstrap, and a new GHCR package defaults to PRIVATE, where one
# private image aborts the whole `docker compose pull`.
RUN pnpm --filter @openldr/cli deploy --prod --legacy /deploy-cli
# Bundled, license-safe terminology fixtures (FHIR R4 ValueSet catalog + full UCUM). @openldr/db
# resolves these at runtime relative to the server bundle (dist/../fixtures/fhir), but pnpm deploy
# carries only code, not packages/db's data dir — so stage them explicitly. Without this the
# first-boot seed logs "fixture missing" and coded form-fields come up with no terminology.
RUN mkdir -p /deploy/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy/fixtures/fhir/
# Same resolution rule, different bundle directory: the CLI's copy of @openldr/db computes
# <cli-dist>/../fixtures/fhir, so it needs its own staged copy. Without it `openldr db seed`
# and the terminology commands come up with no terminology inside the container.
RUN mkdir -p /deploy-cli/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy-cli/fixtures/fhir/
```

- [ ] **Step 3: Copy the CLI into the runtime stage**

In the runtime stage, immediately after the existing `COPY --from=build /deploy /app`, add:

```dockerfile
COPY --from=build /deploy /app
# The operator CLI at a fixed path. install/install.sh's `openldr` wrapper hardcodes
# /app/cli/dist/index.js — changing this path breaks every installed wrapper already on disk.
COPY --from=build /deploy-cli /app/cli
```

The existing `RUN useradd … && chown -R openldr /app` line sits **after** these COPYs, so it
already covers `/app/cli`. Do not add a second chown. Verify the ordering is unchanged before
moving on.

- [ ] **Step 4: Build the image**

```bash
docker build -f apps/server/Dockerfile -t openldr-api:cli-test .
```

Expected: the build completes. Both `pnpm deploy` steps run without an error about an
unresolvable workspace dependency.

If `pnpm --filter @openldr/cli deploy` fails with a missing-dependency error, the cause is
almost certainly Task 1 Step 4 — an external that is not a declared dependency. Go back and
check `packages/cli/package.json`.

- [ ] **Step 5: Prove the CLI is in the image and runs**

```bash
docker run --rm openldr-api:cli-test node /app/cli/dist/index.js --help
```

Expected: the same command list as Task 1 Step 6. Exit code 0.

Then confirm the fixtures landed:

```bash
docker run --rm openldr-api:cli-test ls /app/cli/fixtures/fhir
```

Expected: one or more `.gz` files. An empty result or "No such file" means Step 2's second
`mkdir`/`cp` did not run.

- [ ] **Step 6: Confirm the server still starts**

```bash
docker run --rm openldr-api:cli-test node -e "console.log('server bundle:', require('fs').existsSync('/app/dist/index.js'))"
```

Expected: `server bundle: true`.

This checks the server's own layout was not disturbed by the second deploy. It does **not**
boot the server — that needs a database, and it happens in Task 5's manual pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/Dockerfile
git commit -m "feat(deploy): ship the operator CLI inside the api image"
```

---

### Task 3: Add the data mount and the wrapper to the installers

**Files:**
- Modify: `deploy/install/docker-compose.yml`
- Modify: `install/install.sh`
- Modify: `install/install.ps1`

**Interfaces:**
- Consumes: Task 2's `/app/cli/dist/index.js`.
- Produces: an `openldr` (and `openldr.ps1`) executable in the install directory, and a `./data`
  directory bind-mounted at `/data` in the api container.

**Background:** `openldr ingest <file>`, `openldr sync export --out`, and
`openldr artifact keygen --out` take paths. Inside the container, host paths do not exist, and an
`--out` path writes into a container layer that is lost on restart. The mount plus
`docker compose exec -w /data` gives one directory that means the same thing on both sides.

Host-path translation in the wrapper was considered and rejected in the spec: it would work under
the install directory and fail silently anywhere else.

- [ ] **Step 1: Add the bind mount to the api service**

In `deploy/install/docker-compose.yml`, add to the `api` service's existing `volumes:` list,
after the central-certificate mount:

```yaml
      # Shared working directory for the `openldr` CLI wrapper, which runs
      # `docker compose exec -w /data api …`. File-taking commands (`ingest <file>`,
      # `sync export --out`, `artifact keygen --out`) then name paths that exist on BOTH
      # sides: the operator drops a file in ./data next to the wrapper and refers to it as
      # `data/bundle.json`. Without this, an --out path writes into the container layer and
      # is lost on the next restart.
      - ./data:/data
```

- [ ] **Step 2: Create the directory in the shell installer**

In `install/install.sh`, extend the existing scaffold `mkdir` at line 280 so the directory exists
before `docker compose up`. Docker turns a missing bind-mount source into a root-owned directory,
which is how the central-certificate file above earned its own comment.

```sh
mkdir -p "$DIR/config/nginx/certs" "$DIR/config/nginx/certs/central" "$DIR/config/keycloak" "$DIR/data"
```

- [ ] **Step 3: Write the wrapper in the shell installer**

In `install/install.sh`, immediately after the `renew-cert.sh` fetch and `chmod` (around line
296), add:

```sh
# The `openldr` operator CLI. It ships inside the api image (apps/server/Dockerfile), so the
# wrapper is a one-line shim rather than a downloaded binary. `-T` disables TTY allocation so
# `./openldr report list --json | jq` works in a pipeline. `-w /data` makes the container's
# working directory the ./data bind mount, so `./openldr ingest data/x.json` resolves on both
# sides. The path /app/cli/dist/index.js is fixed by the image — see the COPY in
# apps/server/Dockerfile.
cat > "$DIR/openldr" <<'WRAPPER'
#!/bin/sh
# OpenLDR operator CLI. Runs inside the api container.
# Files must live under ./data (mounted at /data) — e.g. ./openldr ingest data/bundle.json
exec docker compose exec -T -w /data api node /app/cli/dist/index.js "$@"
WRAPPER
chmod +x "$DIR/openldr" 2>/dev/null || true
```

- [ ] **Step 4: Do the same in the PowerShell installer**

In `install/install.ps1`, extend the directory creation at line 254:

```powershell
New-Item -ItemType Directory -Force -Path "$Dir/config/nginx/certs","$Dir/config/nginx/certs/central","$Dir/config/keycloak","$Dir/data" | Out-Null
```

Then, alongside where the shell installer writes its wrapper, add:

```powershell
# The `openldr` operator CLI wrapper — see the matching block in install/install.sh.
# Single-quoted here-string so $args is written literally, not expanded at install time.
# The closing '@ must be at column 0.
$wrapper = @'
# OpenLDR operator CLI. Runs inside the api container.
# Files must live under .\data (mounted at /data) - e.g. .\openldr.ps1 ingest data/bundle.json
docker compose exec -T -w /data api node /app/cli/dist/index.js $args
'@
Set-Content -Path "$Dir/openldr.ps1" -Value $wrapper -Encoding utf8
```

`-Encoding utf8` is required — `Set-Content` otherwise defaults to the system ANSI codepage.

- [ ] **Step 5: Check both wrappers are written before the early exit**

```bash
grep -n "openldr\"\|openldr.ps1\|NO_START\|NoStart" install/install.sh install/install.ps1
```

Expected: in each file, the wrapper-writing line number is **lower** than the `--no-start` /
`-NoStart` early-exit line (`install/install.sh` around 468, `install/install.ps1` line 476).

This matters: `--no-start` scaffolds without starting the stack, and an operator who uses it
still needs the wrapper on disk. If the wrapper is written after the exit, `--no-start` installs
silently lack it.

- [ ] **Step 6: Confirm the shell wrapper is valid POSIX sh**

```bash
sh -n install/install.sh && echo "install.sh syntax OK"
```

Expected: `install.sh syntax OK`.

- [ ] **Step 7: Commit**

```bash
git add deploy/install/docker-compose.yml install/install.sh install/install.ps1
git commit -m "feat(install): write an openldr wrapper and mount ./data for the CLI"
```

---

### Task 4: Correct the docs

**Files:**
- Modify: `docs/OPERATOR-GUIDE.md` (27 occurrences of `pnpm openldr`)
- Modify: `docs/CLI-REFERENCE.md` (20)
- Modify: `docs/CONFIGURATION.md` (2)
- Modify: `apps/web/src/docs/0.1.0/cli.md` (20)
- Modify: `apps/web/src/docs/0.1.0/load-data.md` (8)

**Interfaces:**
- Consumes: the wrapper name and the `./data` rule from Task 3.
- Produces: nothing later tasks depend on.

**The problem being fixed:** every one of those 77 lines tells an operator to run
`pnpm openldr …`, which requires a source checkout with pnpm. A Docker install has neither. The
instruction cannot be followed.

**On translations:** `AGENTS.md` §6 item 3 asks for en, fr, and pt. The docs content tree has
**only `en`** today — `apps/studio/src/docs/0.1.0/` contains a single `en` directory, and
`apps/web/src/docs/0.1.0/` is flat. The registry already falls back to English for a missing
locale (`apps/studio/src/docs/registry.ts:344`), so fr and pt readers see English for every
existing page. Editing English-only here matches the current state and creates no new gap. Do
not invent fr/pt files that no other page has — raise it as a separate question instead.

- [ ] **Step 1: Rewrite the "Running it" section of the public CLI doc**

In `apps/web/src/docs/0.1.0/cli.md`, replace the "## Running it" section (currently lines 8-21,
beginning "From a source checkout") with the following. The outer fence below is four backticks
so the inner three-backtick blocks are part of the content you paste — do not copy the outer
fence itself.

````markdown
## Running it

**On an installed stack**, the installer puts an `openldr` wrapper in your install directory.
Run it from there:

```
./openldr <command>
./openldr --help           # list every command group
./openldr db --help        # drill into a group
```

On Windows, use `.\openldr.ps1` instead.

The wrapper runs the CLI inside the `api` container. That has one consequence worth knowing:
**commands that read or write files only see the `data` directory.** Put a file in `./data`
next to the wrapper and name it with the `data/` prefix:

```
./openldr ingest data/bundle.json
./openldr sync export --out data/export.ndjson
```

A path outside `data/` will not be found, and an `--out` path outside it is written inside the
container and lost when the container restarts.

**From a source checkout**, run it through the workspace instead:

```
pnpm openldr <command>
```

Most read commands accept `--json` for machine-readable output.
````

- [ ] **Step 2: Replace the remaining occurrences in that file**

Every other `pnpm openldr` in `apps/web/src/docs/0.1.0/cli.md` becomes `./openldr`. The section
you just wrote is where the source-checkout form is documented; the command examples below it
should show the deployed form.

```bash
grep -c "pnpm openldr" apps/web/src/docs/0.1.0/cli.md
```

Expected after editing: `1` — the single mention inside the "From a source checkout" paragraph.

- [ ] **Step 3: Do the same for the other four files**

For each of `docs/OPERATOR-GUIDE.md`, `docs/CLI-REFERENCE.md`, `docs/CONFIGURATION.md`, and
`apps/web/src/docs/0.1.0/load-data.md`, replace `pnpm openldr` with `./openldr`.

Then add this note once, near the top of `docs/OPERATOR-GUIDE.md` and once near the top of
`docs/CLI-REFERENCE.md`:

```markdown
> Commands below are written for an installed stack, where the installer provides an `openldr`
> wrapper in the install directory (`.\openldr.ps1` on Windows). From a source checkout, use
> `pnpm openldr` instead — the arguments are identical. File arguments on an installed stack
> must live under `./data`; see the CLI doc's "Running it" section.
```

- [ ] **Step 4: Verify no stale instructions remain**

```bash
grep -rn "pnpm openldr" docs/ apps/web/src/docs/ | grep -v "source checkout" | grep -v "^docs/superpowers/"
```

Expected: no output apart from the two notes you added in Step 3, which mention
`pnpm openldr` deliberately.

`docs/superpowers/` is excluded because past plans and specs are a historical record. Do not
rewrite them.

- [ ] **Step 5: Confirm the docs still build**

```bash
pnpm --filter @openldr/web build
```

Expected: build succeeds. The web docs are bundled by an import glob
(`apps/web/src/docs/content.ts:6`), so a file that fails to load surfaces here.

- [ ] **Step 6: Commit**

```bash
git add docs/OPERATOR-GUIDE.md docs/CLI-REFERENCE.md docs/CONFIGURATION.md apps/web/src/docs/0.1.0/cli.md apps/web/src/docs/0.1.0/load-data.md
git commit -m "docs(cli): document the deployed openldr wrapper and the data directory"
```

---

### Task 5: Gate and manual acceptance

**Files:** none. This task runs commands and reports; it does not edit source.

The changelog (`apps/web/src/landing/changelog.json`) is **not** part of this task — see Step 6.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the full test gate**

```bash
pnpm turbo run test
```

Expected: PASS. Do not pipe this through `tail` — it truncates the failure list and hides which
package failed. If something fails, grep the output for `Test timed out` and re-run that package
alone before assuming a regression.

- [ ] **Step 2: Run typecheck**

```bash
pnpm turbo run typecheck
```

Expected: PASS.

- [ ] **Step 3: Manual acceptance — the part CI cannot do**

This is the only step that proves the slice works. `docker compose exec` needs a running stack,
so none of it can run in CI.

**First, make compose actually use the image you built.** `deploy/install/docker-compose.yml:6`
pins the api service to `ghcr.io/open-laboratory-data-repository/openldr-api:${OPENLDR_VERSION:-latest}`.
Task 2 built the local tag `openldr-api:cli-test`, which compose will never look at. Without this
tag step the acceptance run comes up on whatever published image is already in the local Docker
cache — an image with no CLI in it — and every check below fails, or worse, appears to pass
against something you did not build.

```bash
docker tag openldr-api:cli-test ghcr.io/open-laboratory-data-repository/openldr-api:latest
```

Then scaffold a throwaway install, with `--no-pull` so that tag is not overwritten:

```bash
sh install/install.sh --dir /tmp/openldr-cli-test --no-pull
```

`install.sh` still fetches config files over the network (`REPO_RAW`), so this step needs
internet even with `--no-pull`.

Then, from `/tmp/openldr-cli-test`, work through this list and record the actual output of each:

1. `./openldr --help` — prints the command list.
2. `./openldr health --json` — reports adapter status. Proves the CLI reaches the database and
   the adapters from inside the container, which `--help` does not.
3. `./openldr errors list --json` — an offline command, no database.
4. `echo '{}' > data/probe.json && ./openldr fhir validate data/probe.json` — proves the `./data`
   mount and `-w /data` resolve a host-written file. Expect a validation error about the content,
   **not** a "file not found" error. File-not-found means the mount or the working directory is
   wrong.
5. `./openldr report list --json` — the pdfkit path. This is the command Task 1 exists for. A
   crash mentioning `.afm`, a missing font file, or `ENOENT` means the external list did not take
   effect in the image.
6. `./openldr db --help` then **stop**. Do not run `db reset` against anything you care about.

- [ ] **Step 4: Write down what you could not prove**

In the commit message or the PR description, state plainly:

- The wrapper and the bind mount are **not covered by any automated test**. They were verified by
  hand on a real install, by the steps above. Mark this **HONEST NON-PROOF** and paste the actual
  output of steps 2, 4, and 5.
- The `openldr.ps1` wrapper was verified on Windows, or it was not. Say which. Do not report it
  working from a Linux run.

- [ ] **Step 5: Clean up the test install**

```bash
cd /tmp/openldr-cli-test && docker compose down -v && cd - && rm -rf /tmp/openldr-cli-test
```

Look at the directory before removing it. `-v` deletes its volumes.

Then remove the tag from Step 3. Leaving it in place means the operator's next real
`docker compose pull` is shadowed by a local build that looks official:

```bash
docker rmi ghcr.io/open-laboratory-data-repository/openldr-api:latest
```

That removes the tag, not the underlying image — `openldr-api:cli-test` still points at it.

- [ ] **Step 6: Stop, and hand the merge and changelog back to the operator**

**Do not merge. Do not push. Do not run `pnpm make:changelog`.** This task ends here.

`AGENTS.md` §9 says commit only when asked, and merging to local `main` is the operator's
decision, not an implementer's. The changelog depends on that merge: `pnpm make:changelog` reads
git history and cannot see commits that are not on `main` yet (`AGENTS.md` §6 item 5).

Report to the operator that the slice is complete and that two steps remain for them:

1. Merge this branch to local `main`.
2. Then run, from `main`:

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): regenerate the landing changelog"
```

Do **not** run `pnpm gallery:screenshots` at any point. That is a heavy Playwright capture
belonging to a release pass, not to this slice.

---

## What this slice deliberately does not do

Stated here so a reviewer does not read the omissions as oversights:

- **No authentication and no capability gating.** After this slice, anyone who can reach the
  install directory can run any command. That is a strictly larger opening than today, where the
  CLI cannot be run at all, and it stays open until slice 2 lands. That is the accepted trade.
- **No `openldr login`.** Spec section 5 leaves the seam; nothing here builds it.
- **No sixth image.** Rejected in the spec — a new GHCR package defaults to private, and one
  private image aborts the whole pull.
- **No standalone binary.** Rejected in the spec.
- **No fr/pt doc translations.** No page in the tree has them today.
