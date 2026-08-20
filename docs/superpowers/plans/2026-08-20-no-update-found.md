# No Update Found Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop showing a version number lower than the running one, because it reads as an instruction to roll back and carries no action either way.

**Architecture:** Split the `up_to_date` verdict into two kinds so the stale number becomes unrepresentable rather than merely unrendered. The CLI and the Studio card both render from that one shared value. Separately, make the release verify the manifest it just published and repoll its verification stack.

**Tech Stack:** TypeScript, React 18, vitest, react-i18next, tsx.

Spec: `docs/superpowers/specs/2026-08-20-no-update-found-design.md`

## Global Constraints

- No em dashes in any new writing, including code comments, docs and commit messages. AGENTS.md section 1. Quoted pre-existing text keeps whatever it has.
- No emoji in headings or bullets. The `⛔` and `⚠` comment markers are an established convention in this codebase and are not emoji.
- i18n keys must land in all three of `en`, `fr`, `pt`. A missing key renders as literal braces. `apps/studio/src/i18n/parity.test.ts` enforces this.
- shadcn components only in `apps/studio`. No native `select`, `button`, `input` or `dialog`.
- **CLI exit codes are a scripted contract and do not move:** 1 means an update exists, 0 means it does not, 2 means the check itself failed. `no_update_found` returns 0.
- `@openldr/core/pure` is bundled into the browser and must stay free of Node built-ins.
- After any `package.json` change, run `pnpm install` once before the gate. No task here changes one, so this should not arise.
- **The full gate must run as `pnpm turbo run test --concurrency=4`.** Measured on a cold cache: turbo's default failed 4 of 4 runs, each on a different package, every one passing alone. Never pipe turbo through `tail`.
- **Out of scope, do not build:** no manual "check now" control, no change to the 24-hour interval, no change to the poll, the notification bell, or the switch, no change to which URL installs fetch, and no new fr or pt docs files.

---

### Task 1: Split the verdict kind

**Files:**
- Modify: `packages/core/src/update-verdict.ts`
- Modify: `packages/core/src/update-verdict.test.ts`

**Interfaces:**
- Consumes: `isNewerVersion`, `parseSemver` from `./semver`.
- Produces: the `UpdateVerdict` union with `up_to_date` carrying only `latest`, and a new `no_update_found` carrying nothing. `runningIsNewer` is gone. Tasks 2 and 3 render from these.

**Why the field is deleted rather than left unused:** two earlier passes reworded the sentence under the number and left the number in the type, so every surface stayed free to print it. `no_update_found` carries no version, so a surface that wanted to print one has nothing to print.

- [ ] **Step 1: Replace the three tests that assert `runningIsNewer`**

In `packages/core/src/update-verdict.test.ts`, replace this line (currently the body of `reports up_to_date when the published version matches`):

```ts
    expect(updateVerdict(input())).toEqual({ kind: 'up_to_date', latest: '0.1.3', runningIsNewer: false });
```

with:

```ts
    expect(updateVerdict(input())).toEqual({ kind: 'up_to_date', latest: '0.1.3' });
```

Then replace the whole final `describe('updateVerdict — running ahead of the cached release', ...)` block with:

```ts
describe('updateVerdict: cache older than the running version', () => {
  const input = (over = {}) => ({
    enabled: true, running: '0.1.4', latestVersion: '0.1.3',
    releasedAt: '2026-08-19', notesUrl: 'https://example.org/x', lastError: null, ...over,
  });

  // ⛔ toEqual with no second key is the point of this test. An operator read "published: 0.1.5"
  // under "running: 0.1.6" as an instruction to roll back. The number carries no action either
  // way, so this kind carries NO version and no surface can print one. Reintroducing a field here
  // means deleting this assertion, which is the intended speed bump.
  it('carries no version at all when the cache is behind', () => {
    expect(updateVerdict(input())).toEqual({ kind: 'no_update_found' });
  });

  it('still reports up_to_date, with the number, when the cache matches', () => {
    expect(updateVerdict(input({ latestVersion: '0.1.4' }))).toEqual({
      kind: 'up_to_date', latest: '0.1.4',
    });
  });

  // The split must not change WHICH verdict fires for a genuine update.
  it('still reports update_available when the cache is genuinely newer', () => {
    expect(updateVerdict(input({ running: '0.1.2' })).kind).toBe('update_available');
  });

  // Precedence: the no_update_found check sits ABOVE the up_to_date fallthrough, but BELOW the
  // error check, so a stale cache under a live error is still cannot_confirm, not no_update_found.
  it('reports cannot_confirm, not no_update_found, when the last check failed', () => {
    expect(updateVerdict(input({ lastError: 'HTTP 404' })).kind).toBe('cannot_confirm');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/core exec vitest run src/update-verdict.test.ts
```

Expected: FAIL. The `no_update_found` test fails with `expected { kind: 'up_to_date', latest: '0.1.3', runningIsNewer: true } to deeply equal { kind: 'no_update_found' }`, and the matching-cache test fails on the extra `runningIsNewer` key.

- [ ] **Step 3: Split the union**

In `packages/core/src/update-verdict.ts`, replace this:

```ts
  // `runningIsNewer` separates "nothing newer exists" from "my cache predates my own version".
  // Both are up to date and neither offers an upgrade, but printing "published: 0.1.3" beside
  // "running: 0.1.4" and calling it up to date reads backwards, and an operator who upgrades
  // promptly sees exactly that until the next daily poll.
  | { kind: 'up_to_date'; latest: string; runningIsNewer: boolean }
```

with:

```ts
  | { kind: 'up_to_date'; latest: string }
  // ⛔ Carries NO version, deliberately. The cache being older than the running version tells an
  // operator nothing they can act on: it cannot mean upgrade, and it must not read as roll back,
  // which is exactly how one read it. A kind with no version is a kind no surface can misprint.
  | { kind: 'no_update_found' }
```

- [ ] **Step 4: Split the final branch**

In the same file, replace this:

```ts
  // Reached only when latestVersion is not newer, so this is either equal or behind. Both sides
  // parse here: `running` was checked at step 2, and an unparseable `latestVersion` would have
  // made isNewerVersion false at step 3 and false again here, giving equal, which is the safe read.
  return { kind: 'up_to_date', latest: latestVersion, runningIsNewer: isNewerVersion(running, latestVersion) };
```

with:

```ts
  // Reached only when latestVersion is not newer, so this is either equal or behind. Both sides
  // parse here: `running` was checked at step 2, and an unparseable `latestVersion` would have
  // made isNewerVersion false at step 3 and false again here, giving equal, which is the safe read.
  //
  // This sits below the lastError check above, so a stale cache under a live error stays
  // cannot_confirm rather than being downgraded to a confident "no update found".
  if (isNewerVersion(running, latestVersion)) return { kind: 'no_update_found' };

  return { kind: 'up_to_date', latest: latestVersion };
```

- [ ] **Step 5: Run the core suite**

```bash
pnpm --filter @openldr/core test
```

Expected: PASS. TypeScript will not complain here, but Tasks 2 and 3 will not compile until they are done; that is expected and is why they follow.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/update-verdict.ts packages/core/src/update-verdict.test.ts
git commit -m "feat(core): a verdict that carries no version when the cache is behind"
```

---

### Task 2: Render it in the CLI

**Files:**
- Modify: `packages/cli/src/update.ts`
- Modify: `packages/cli/src/update.test.ts`
- Verify only, do not edit: `packages/bootstrap/src/update-check.test.ts`

**Interfaces:**
- Consumes: `updateVerdict` and the split union from Task 1.
- Produces: nothing later tasks depend on.

**The regression being prevented:** the `published:` line is currently pushed unconditionally before the switch. If it stays unconditional, the stale number still prints and this whole change achieves nothing.

- [ ] **Step 1: Replace the CLI's ahead tests**

In `packages/cli/src/update.test.ts`, replace the whole final `describe('renderUpdateCheck — running ahead of the cached release', ...)` block with:

```ts
describe('renderUpdateCheck: cache older than the running version', () => {
  // ⛔ The assertion that matters is the NEGATIVE one. An operator read "published: 0.1.5" under
  // "running: 0.1.6" as an instruction to roll back, so the number must not be printed at all.
  it('prints no published line, and names when the check last ran', () => {
    const { text, code } = renderUpdateCheck(
      state({
        running: '0.1.4', latestVersion: '0.1.3', updateAvailable: false, lastError: null,
        lastCheckedAt: '2026-08-20T05:32:24.718Z',
      }),
      { json: false },
    );
    expect(text).not.toMatch(/published:/);
    expect(text).not.toMatch(/0\.1\.3/);
    expect(text).toMatch(/no update found \(last checked 2026-08-20T05:32:24\.718Z\)/);
    expect(code).toBe(0);
  });

  it('omits the parenthetical rather than printing a null timestamp', () => {
    const { text } = renderUpdateCheck(
      state({
        running: '0.1.4', latestVersion: '0.1.3', updateAvailable: false, lastError: null,
        lastCheckedAt: null,
      }),
      { json: false },
    );
    expect(text).toMatch(/no update found\./);
    expect(text).not.toMatch(/last checked/);
  });

  it('keeps the published line and the plain wording when the cache matches', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: '0.1.4', latestVersion: '0.1.4', updateAvailable: false, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/published: 0\.1\.4/);
    expect(text).toMatch(/this install is up to date/);
    expect(text).not.toMatch(/no update found/);
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/cli exec vitest run src/update.test.ts
```

Expected: FAIL. The first test fails on `expected '…published: 0.1.3…' not to match /published:/`, and TypeScript reports `runningIsNewer` no longer exists on the union.

- [ ] **Step 3: Make the published line conditional**

In `packages/cli/src/update.ts`, replace this:

```ts
  lines.push(`published: ${state.latestVersion ?? 'unknown'}`);
```

with:

```ts
  // ⛔ Not printed for no_update_found. The cached version is OLDER than the running one there,
  // and an operator read that lower number as an instruction to roll back. It is the only state
  // where this line has nothing honest to say.
  if (verdict.kind !== 'no_update_found') {
    lines.push(`published: ${state.latestVersion ?? 'unknown'}`);
  }
```

- [ ] **Step 4: Replace the up_to_date case and add the new one**

In the same file, replace this:

```ts
    case 'up_to_date':
      // Both readings are "nothing to upgrade to", but they are not the same situation and the
      // numbers above make that obvious. Saying "up to date" under a LOWER published version reads
      // backwards, and an operator who upgrades promptly sees it until the next daily poll.
      lines.push('', verdict.runningIsNewer
        ? 'this install is newer than the last release it saw.\nnothing to upgrade to.'
        : 'this install is up to date.');
      return { text: lines.join('\n'), code };
```

with:

```ts
    case 'up_to_date':
      lines.push('', 'this install is up to date.');
      return { text: lines.join('\n'), code };
    case 'no_update_found':
      // The raw ISO stamp, not a relative phrase. This package has no date-formatting dependency
      // and has never rendered lastCheckedAt at all; hand-rolling relative time means untested,
      // unlocalised date logic, and ISO is better for anything scripting this output.
      // lastCheckedAt is non-null whenever this state is reached, because a cached version is only
      // written by a successful poll. The null branch exists so a surprise cannot print "null".
      lines.push('', state.lastCheckedAt
        ? `no update found (last checked ${state.lastCheckedAt})`
        : 'no update found.');
      return { text: lines.join('\n'), code };
```

- [ ] **Step 5: Run the CLI package**

```bash
pnpm --filter @openldr/cli test
```

Expected: PASS. All pre-existing `renderUpdateCheck` tests still pass unchanged, because none of them exercise a cache older than the running version.

- [ ] **Step 6: Confirm the bootstrap agreement test still holds**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/update-check.test.ts
```

Expected: PASS, unchanged, with no edit to that file. It asserts `updateVerdict(...).kind === 'update_available'` matches `decideUpdate(...).updateAvailable`, and `no_update_found` is not `update_available`, so the invariant is untouched. **If it fails, stop and report rather than editing it.** A failure there means the split changed which verdict fires, which is not the intent.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/update.ts packages/cli/src/update.test.ts
git commit -m "fix(cli): print no version when the cached release is older than this install"
```

---

### Task 3: Render it in the card

**Files:**
- Modify: `apps/studio/src/pages/settings/General.tsx`
- Modify: `apps/studio/src/i18n/en.ts`
- Modify: `apps/studio/src/i18n/fr.ts`
- Modify: `apps/studio/src/i18n/pt.ts`
- Modify: `apps/studio/src/pages/settings/General.test.tsx`

**Interfaces:**
- Consumes: `updateVerdict` and the split union from Task 1.
- Produces: the `data-testid="update-latest"` row keeps its id, so Task 5's browser check can find it.

**No new mobile risk.** `no update found` is shorter than the `update_available` row already measured wrapping cleanly at 375x812, and no other layout changes.

- [ ] **Step 1: Replace the `nothingNewer` key in all three languages**

In `apps/studio/src/i18n/en.ts`, replace:

```ts
        nothingNewer: 'nothing newer',
```

with:

```ts
        noUpdateFound: 'no update found',
```

In `apps/studio/src/i18n/fr.ts`, replace:

```ts
        nothingNewer: 'rien de plus récent',
```

with:

```ts
        noUpdateFound: 'aucune mise à jour trouvée',
```

In `apps/studio/src/i18n/pt.ts`, replace:

```ts
        nothingNewer: 'nada mais recente',
```

with:

```ts
        noUpdateFound: 'nenhuma atualização encontrada',
```

Renaming rather than editing the value in place: the meaning changed, and a stale key name is how the next reader misunderstands what it does.

- [ ] **Step 2: Run the parity test**

```bash
pnpm --filter @openldr/studio exec vitest run src/i18n/parity.test.ts
```

Expected: PASS. If it fails it names the language still carrying `nothingNewer` or missing `noUpdateFound`, which is the failure this test exists to catch.

- [ ] **Step 3: Write the failing card tests**

In `apps/studio/src/pages/settings/General.test.tsx`, replace the whole final `describe('General settings — Latest row when the install is ahead of its cache', ...)` block with:

```ts
describe('General settings: Latest row when the cache is older than this install', () => {
  // ⛔ The negative assertion is the point. An operator read a lower version number here as an
  // instruction to roll back, so the number must not reach the screen at all.
  it('shows no version number when the cache is behind', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, running: '0.1.4', latestVersion: '0.1.3', updateAvailable: false, lastError: null,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    const row = await screen.findByTestId('update-latest');
    expect(row).toHaveTextContent(/no update found/i);
    expect(row).not.toHaveTextContent('0.1.3');
    expect(row).not.toHaveTextContent(/up to date/i);
  });

  it('keeps the version and up to date when the cache matches', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, running: '0.1.4', latestVersion: '0.1.4', updateAvailable: false, lastError: null,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    const row = await screen.findByTestId('update-latest');
    expect(row).toHaveTextContent('0.1.4');
    expect(row).toHaveTextContent(/up to date/i);
    expect(row).not.toHaveTextContent(/no update found/i);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/settings/General.test.tsx
```

Expected: FAIL. The first test fails because the row still renders `0.1.3`, and TypeScript reports `runningIsNewer` no longer exists on the union.

- [ ] **Step 5: Render the new kind**

In `apps/studio/src/pages/settings/General.tsx`, replace this:

```tsx
                  {verdict.kind === 'up_to_date' && (
                    <>
                      {verdict.latest}
                      {/* "up to date" under a LOWER Latest than Version reads backwards. That
                          happens whenever the cache predates the running version, which an
                          operator who upgrades promptly sees until the next daily poll. */}
                      <span className="ml-1 font-sans text-xs text-muted-foreground">
                        · {t(verdict.runningIsNewer
                          ? 'settings.general.about.nothingNewer'
                          : 'settings.general.about.upToDate')}
                      </span>
                    </>
                  )}
```

with:

```tsx
                  {verdict.kind === 'up_to_date' && (
                    <>
                      {verdict.latest}
                      <span className="ml-1 font-sans text-xs text-muted-foreground">
                        · {t('settings.general.about.upToDate')}
                      </span>
                    </>
                  )}
                  {/* ⛔ No version number here, and the verdict does not carry one to print. The
                      cache is OLDER than the running version in this state, and an operator read
                      that lower number as an instruction to roll back. "Last checked" below the
                      divider is what conveys the staleness. */}
                  {verdict.kind === 'no_update_found' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.noUpdateFound')}</span>
                  )}
```

- [ ] **Step 6: Run the card tests and the typecheck**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/settings/General.test.tsx
```

Expected: PASS, including every pre-existing case.

```bash
pnpm --filter @openldr/studio typecheck
```

Expected: PASS. A `runningIsNewer` error here means Step 5 was not applied.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/pages/settings/General.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/pages/settings/General.test.tsx
git commit -m "fix(studio): show no version when the cached release is older than this install"
```

---

### Task 4: Verify the published manifest, and repoll the verification stack

**Files:**
- Modify: `scripts/release.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. This task is independent of Tasks 1 to 3 and could be done in any order relative to them.
- Produces: nothing later tasks depend on.

**No tests, and that is by design.** `scripts/release.ts` sequences commands; every decision it appears to make lives in `@openldr/release` where it is unit-tested. Its own header says so. Neither change here is proven until the next real release. Do not invent a test harness for it.

- [ ] **Step 1: Add the two helpers**

In `scripts/release.ts`, add these two functions immediately above `async function main(): Promise<void> {`:

```ts
/** Prove the manifest the release just uploaded is actually readable, and says what it should.
 *
 *  ⛔ The DIRECT asset URL, never `releases/latest/download/…`. Measured 2026-08-19 and 08-20: the
 *  direct URL was correct immediately every time, while the `latest` alias served the PREVIOUS
 *  release's manifest for over ten minutes after v0.1.3. This runs AFTER the tag is public, so
 *  gating on the alias would fail a release that is already released.
 *
 *  Closes a real gap: nothing else checks that this file is readable, and a broken asset silently
 *  disables the update check on every install in the field while the release reports success. */
async function verifyPublishedManifest(version: string): Promise<void> {
  const url = `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/latest.json`;
  let problem = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = JSON.parse(await res.text()) as { version?: unknown };
      if (parsed.version !== version) throw new Error(`the asset names ${String(parsed.version)}`);
      console.log(`published manifest verified: ${url}`);
      return;
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  console.error(`\n⛔ the release published, but its latest.json is not readable: ${problem}`);
  console.error(`  ${url}`);
  console.error('Every install polls this file, so update checks stay broken until it is fixed.');
  // ⛔ No rollback here, unlike step 10. The images are public and :latest has already moved, so
  // deleting the tag would remove the record and leave the artifacts. A loud failure naming the
  // fix is more honest than a rollback that undoes the wrong half. Do not "fix" this later.
  console.error('The tag is NOT rolled back: the images are already public, so deleting it would');
  console.error('remove the record and leave the artifacts. Re-upload the asset instead:');
  console.error(`  gh release upload v${version} latest.json --clobber`);
  process.exit(1);
}

/** Make the verification stack poll again, now that the release exists.
 *
 *  It polled at step 9, BEFORE step 10 published, so its cached answer predates the version it is
 *  running. That ordering is structural, so this happens on every release.
 *
 *  ⚠ This may change nothing, and must not be described as if it fixes anything. Installs poll the
 *  `latest` alias, which lagged over ten minutes after v0.1.3, so the stack can come back with the
 *  same stale answer. It then reads "no update found", which is honest. Never fail a release over
 *  a cosmetic repoll. */
function repollVerificationStack(probeDir: string): void {
  try {
    execFileSync('docker', ['compose', 'restart', 'api'], { cwd: probeDir, stdio: 'inherit' });
    console.log('verification stack repolled');
  } catch (err) {
    console.warn(`could not repoll the verification stack, harmless: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 2: Call them after the release succeeds**

In the same file, replace this line near the end of `main`:

```ts
  console.log(`\nreleased ${version}`);
```

with:

```ts
  // Both are skipped under --dry-run: nothing was published, so there is no asset to read and no
  // stack to repoll.
  if (!DRY_RUN) {
    await verifyPublishedManifest(version);
    repollVerificationStack(probe);
  }

  console.log(`\nreleased ${version}`);
```

- [ ] **Step 3: Run the neighbouring package's tests**

```bash
pnpm --filter @openldr/release test
```

Expected: PASS, 86 tests. That package covers `install.sh`, `build-and-push.sh` and the preconditions, **not** `release.ts`, so this only proves nothing adjacent broke.

**Be honest about what is not checked here.** `scripts/` is not a workspace package, so no `turbo typecheck` task compiles this file, and there is no cheap standalone typecheck for it: it imports across the workspace and checking it alone produces unrelated resolution noise. Re-read your two edits carefully instead, and state in your report that `release.ts` is unverified by any gate and is proven only by the next real release. Do not invent a test harness for it, and do not run `pnpm release --dry-run` to check it, that runs the whole gate and takes several minutes.

- [ ] **Step 4: Commit**

```bash
git add scripts/release.ts
git commit -m "fix(release): verify the published manifest, and repoll the verification stack"
```

---

### Task 5: Docs, the gate, and the changelog

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/settings.md`
- Modify: `apps/web/src/landing/changelog.json` (generated)

**Interfaces:**
- Consumes: the rendered strings from Tasks 2 and 3.
- Produces: nothing.

**Docs scope is one file, verified 2026-08-19:** `fr/settings.md` and `pt/settings.md` do not exist and fall back to English by design, and `apps/web` has no settings doc. Do not create the fr or pt files.

- [ ] **Step 1: Rewrite the two stale paragraphs**

In `apps/studio/src/docs/0.1.0/en/settings.md`, replace this:

```markdown
**Settings → General** shows the version this install is running and, on the line below it, where
that version stands. That line reads one of six ways: the version number and *up to date*; the
version number and *nothing newer*; a newer version with its release date and notes, followed by
the two commands to upgrade; *update check is off*; *cannot confirm*, when the last check failed or
the running version could not be read; or *not checked yet*.

*Nothing newer* means the last successful check saw an **older** release than the one you are
running. There is still nothing to upgrade to. It happens when you upgrade shortly after a release,
because the check runs once a day and the answer it cached predates your own version. It corrects
itself at the next check, or immediately if you restart the api container.
```

with:

```markdown
**Settings → General** shows the version this install is running and, on the line below it, where
that version stands. That line reads one of six ways: the version number and *up to date*; *no
update found*; a newer version with its release date and notes, followed by the two commands to
upgrade; *update check is off*; *cannot confirm*, when the last check failed or the running version
could not be read; or *not checked yet*.

*No update found* means the last successful check saw an **older** release than the one you are
running, so it has nothing to tell you. **No version number is shown in this case, on purpose.** A
number lower than the one you are running is not something to act on, and reading it as an
instruction to downgrade would be wrong. Use *Last checked* underneath to see how old the answer is.

This happens when you upgrade shortly after a release, because the check runs once a day and the
answer it cached predates your own version. It corrects itself at the next check, or immediately if
you restart the api container.
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm turbo run test --concurrency=4
```

Expected: PASS, 35 of 35 tasks. **Do not pipe this through `tail`**, it truncates the failure list. Do not drop `--concurrency=4`: at the default this gate failed 4 of 4 measured runs, each on a different package, every one passing alone. If a package does fail, re-run it alone before concluding anything, and report either way rather than "fixing" an undiagnosed failure.

- [ ] **Step 3: Commit the docs**

```bash
git add apps/studio/src/docs/0.1.0/en/settings.md
git commit -m "docs(settings): explain why no version is shown when the cache is behind"
```

- [ ] **Step 4: Regenerate the changelog after merging to main**

```bash
pnpm make:changelog
```

Then commit the result. AGENTS.md section 6 item 5. The generator reads git history, so it must run after the work is on `main`, not before. It publishes only `feat`, `fix` and `perf`, so the four commits from Tasks 1 to 4 all appear.

```bash
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```
