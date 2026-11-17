# Publishing cdr-source 0.1.0 to the marketplace: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this plan
> task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bundles/cdr-source-0.1.0/` is in the public marketplace, signed by the reference
publisher, and a clean CE installs it from a registry.

**Architecture:** The plugin is built on the Linux box, signed on the Windows laptop where the
key lives, and checked and committed on the Linux box. Only public files move between machines.

**Tech stack:** Rust to wasm32-wasip1, esbuild and Tailwind for the page, the `openldr` CLI
(`artifact pack`), git, ssh and scp over the tailnet.

**Spec:** `docs/superpowers/specs/2026-11-17-cdr-source-marketplace-publish-design.md`

## Global constraints

- The private key `whonet.priv` is never read, printed, copied or moved. It is passed by path only.
- Publisher id `openldr-ref`, name `OpenLDR Reference Publisher`, fingerprint
  `5ac92136598e4f7066ad726b74b5aed339a2d2f94579adf057caff5ed75d7cf5`.
- Bundle folder `bundles/cdr-source-0.1.0`. Index `kind` is `plugin`.
- The source system's name is in no description, guide, index summary or commit message.
- No push to the marketplace's `main` without the operator's yes in this conversation.
- No `Co-Authored-By` or "Generated with" lines.
- Never stop or change the dev stack on port 3000. Never use the scratch CE on port 3990 for the
  install proof. Throwaway things use port 3991 and databases named `sa_scratch_pub_*`, started
  with `OPENLDR_SKIP_ENV_FILE=true`, and are removed afterwards.
- The laptop's own `openldr_ce` checkout is not pulled, switched or edited.
- Start only after cdr-source `main` holds the source-kind label change, or the operator says to
  go without it.

## Review focus

1. A bundle whose page bytes changed between the machines. Expected: the pack step fails, or
   `verifyBundle` gives `ui-hash-mismatch`. Covered by Task 4, step 2.
2. A build with only one of `PUBLISHER_ID` and `PUBLISHER_NAME` set. Expected: the build stops
   with a message. Covered by Task 1.
3. A file install of a build with no publisher variables. Expected: the manifest is byte for
   byte what today's build writes. Covered by Task 1.
4. An index that ends up listing `cdr-source` twice. Expected: the check fails before the push.
   Covered by Task 4, step 4.
5. A CE that already trusts `openldr-ref` with another key. Expected: the install is refused.
   Not reachable here, since the bundle carries the same key as the published plugins.

---

### Task 0: The CLI can pack a plugin with a page (done before this plan)

Branch `fix/artifact-pack-ui` in `openldr_ce`. `runArtifactPack` reads `payload.ui.entry` from the
project folder and passes the bytes to `packBundle`. Three tests in
`packages/cli/src/artifact.test.ts` under "artifact pack, a plugin with a page". It must be in
`origin/main` before Task 3.

### Task 1: The build can add a publisher

**Files:**
- Modify: `scripts/build.mjs` in cdr-source, on a branch `publish-manifest` from `main`.

- [ ] **Step 1:** Record today's manifest. Run `pnpm build`, then
  `sha256sum dist/manifest.json dist/plugin.wasm dist/ui.html > /tmp/before.txt`.
- [ ] **Step 2:** In `scripts/build.mjs`, before the manifest is written, read
  `process.env.PUBLISHER_ID` and `process.env.PUBLISHER_NAME`. Exactly one set: throw
  `set PUBLISHER_ID and PUBLISHER_NAME together, or neither`. Both set: add
  `publisher: { id, name, keyFingerprint: '0'.repeat(64) }` to the manifest, placed after
  `license`. Neither set: no `publisher` key.
- [ ] **Step 3:** Run `pnpm build` with neither set. Expected: the three sha256 sums equal
  `/tmp/before.txt`.
- [ ] **Step 4:** Run `PUBLISHER_ID=openldr-ref pnpm build`. Expected: exit 1 with the message.
- [ ] **Step 5:** Run with both set. Expected: `dist/manifest.json` has the publisher block, and
  `plugin.wasm` and `ui.html` have the sums of step 1.
- [ ] **Step 6:** Add three lines on the two variables to the developer `README.md`.
- [ ] **Step 7:** Commit as `feat: the build adds a publisher when asked, for a marketplace bundle`.
  Merge into cdr-source `main` and push only on the operator's yes.

### Task 2: Build the bundle's inputs

- [ ] **Step 1:** Confirm cdr-source `main` holds the label change. Record the commit id.
- [ ] **Step 2:** From a `git archive` copy of that commit, run the build with both publisher
  variables set. Record the sha256 of `plugin.wasm`, `ui.html` and `manifest.json`.
- [ ] **Step 3:** Search `dist/manifest.json` for the source system's name, any case. Expected: 0 hits.
- [ ] **Step 4:** Parse `dist/manifest.json` with `parseArtifactManifest`. Expected: no error.

### Task 3: Sign on the laptop

- [ ] **Step 1:** On the laptop, `git fetch origin` in `D:\Projects\Repositories\openldr_ce`, then
  `git worktree add --detach D:\Projects\Repositories\_pack_wt origin/main` and `pnpm install
  --frozen-lockfile` there. Confirm `packages/cli/src/artifact.ts` holds the page read.
- [ ] **Step 2:** `scp` the three files of `dist/` to `D:\Projects\Repositories\_pack_in\`.
  Compare their sha256 with Task 2. Expected: equal.
- [ ] **Step 3:** In the worktree run
  `pnpm openldr artifact pack D:\Projects\Repositories\_pack_in --key D:\Projects\Repositories\openldr_ce\scripts\.marketplace-keys\whonet.priv --out D:\Projects\Repositories\_pack_out\cdr-source-0.1.0 --json`.
  Expected: exit 0, `id` `cdr-source`, `version` `0.1.0`, and the fingerprint of the global constraints.
- [ ] **Step 4:** `scp` the output folder back to the Linux box.
- [ ] **Step 5:** Remove `_pack_in`, `_pack_out` and the worktree on the laptop. Confirm with a
  listing. Confirm the laptop's `openldr_ce` checkout is on the commit it was on.

### Task 4: The marketplace entry

**Files:**
- Create: `bundles/cdr-source-0.1.0/{manifest.json,plugin.wasm,ui.html,publisher.pub}` in the
  marketplace checkout, on a branch `publish-cdr-source-0.1.0`.
- Modify: `index.json`.

- [ ] **Step 1:** Copy the signed folder in. `publisher.pub` must equal
  `bundles/dhis2-sink-0.1.0/publisher.pub`.
- [ ] **Step 2:** `plugin.wasm` and `ui.html` must have the sha256 of Task 2.
- [ ] **Step 3:** Append one entry to `packages` in `index.json`: `id` `cdr-source`, `kind`
  `plugin`, `latestVersion` `0.1.0`, `publisher` `OpenLDR Reference Publisher`, `summary` the
  manifest's `description`, `path` `bundles/cdr-source-0.1.0`, `signatureFingerprint` the
  fingerprint. Set `updatedAt` to the current time.
- [ ] **Step 4:** Run the checkout check (`readBundle`, `verifyBundle`, `isCompatible`, index
  against folders). Expected: 7 packages, no id twice, every bundle `valid=true` and in the index.
- [ ] **Step 5:** Commit on the branch as `feat: publish the cdr-source plugin 0.1.0`. No push.

### Task 5: Prove a clean install

- [ ] **Step 1:** Start a throwaway CE on port 3991 with databases `sa_scratch_pub_internal` and
  `sa_scratch_pub_target`, `OPENLDR_SKIP_ENV_FILE=true`, and the marketplace checkout's `bundles`
  folder as its local registry.
- [ ] **Step 2:** `GET /api/marketplace/available`. Expected: `cdr-source` 0.1.0 with `valid` true.
- [ ] **Step 3:** Install it with the capabilities approved. Expected: installed, publisher
  `openldr-ref`.
- [ ] **Step 4:** Open the plugin's page in the browser at 1280 wide and at 375x812. Expected:
  the page renders and the Guide tab shows the guide. Send the operator one screenshot of each.
  The page holds no patient data in a CE with nothing copied.
- [ ] **Step 5:** Stop the CE, drop both databases, delete its folders. Confirm each is gone.

### Task 6: Push and confirm

- [ ] **Step 1:** Show the operator the diff summary and the Task 5 result. Ask for the push
  with AskUserQuestion and in plain text.
- [ ] **Step 2:** On yes: fast-forward the marketplace's `main`, push, and compare local and
  origin SHA.
- [ ] **Step 3:** Read the public `index.json` at the new commit. Expected: 7 packages with
  `cdr-source@0.1.0`. `bundles/cdr-source-0.1.0/manifest.json` returns 200.
- [ ] **Step 4:** Add the commands that worked to cdr-source's developer `README.md` under
  "Publishing a version", so 0.1.1 repeats them.

## What this plan does not prove

- That a lab's CE behind a firewall can reach the public registry.
- That an install over a plugin already installed from a file keeps its copied rows. The scratch
  CE on port 3990 is left alone for that reason.
- The page on a real phone. The 375x812 check is a resized desktop browser.
