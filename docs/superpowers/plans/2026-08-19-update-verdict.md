# Update Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio Settings then General state whether the install is current and what the latest version is, instead of speaking up only when an update exists.

**Architecture:** One pure function `updateVerdict` in `@openldr/core/pure` turns the existing `UpdateState` into a five-way discriminated union. The About card and `openldr update check` both render from it, so they cannot disagree about which state an install is in. No server change, no new stored key, no new endpoint.

**Tech Stack:** TypeScript, React 18, vitest, react-i18next, Tailwind, shadcn components.

Spec: `docs/superpowers/specs/2026-08-19-update-verdict-design.md`

## Global Constraints

- No em dashes in any new writing, including code comments, docs and commit messages. AGENTS.md section 1.
- No emoji in headings or bullets.
- i18n keys must land in all three of `en`, `fr`, `pt`. A missing key renders as literal braces. `apps/studio/src/i18n/parity.test.ts` enforces this.
- shadcn components only. No native `select`, `button`, `input` or `dialog`.
- After any `package.json` change, run `pnpm install` once before running the gate. pnpm's deps-status check otherwise auto-installs inside each parallel turbo test task and they race on `node_modules/.pnpm/lock.yaml` with EPERM on Windows.
- Never pipe `turbo` through `tail`. It truncates the failure list.
- The CLI exit codes are a scripted contract: 1 means an update exists, 0 means it does not, 2 means the check itself failed. Do not change them.
- `@openldr/core/pure` must stay free of Node built-ins. It is bundled into the browser.

---

### Task 1: The verdict function

**Files:**
- Create: `packages/core/src/update-verdict.ts`
- Create: `packages/core/src/update-verdict.test.ts`
- Modify: `packages/core/src/pure.ts` (add one export line)

**Interfaces:**
- Consumes: `parseSemver`, `isNewerVersion` from `packages/core/src/semver.ts`.
- Produces: `updateVerdict(input: UpdateVerdictInput): UpdateVerdict`, the `UpdateVerdict` union, the `UpdateVerdictInput` interface, and the `BAD_RUNNING_VERSION` constant. Tasks 2 and 3 import all four from `@openldr/core/pure`.

**Deviation from the spec, applied deliberately:** the spec listed `lastCheckedAt` in the input. It is unused, because a successful poll always records a `latestVersion`, so `latestVersion === null` with no error already means no check has ever succeeded. Carrying an unused field would be a lint error and a lie about what the function reads. It is omitted. Callers still pass their whole `UpdateState` because TypeScript's excess property check does not apply to variables.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/update-verdict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isNewerVersion } from './semver';
import { updateVerdict, BAD_RUNNING_VERSION } from './update-verdict';

/** Every field the function reads. Tests override only what they are about. */
const input = (over: Partial<Parameters<typeof updateVerdict>[0]> = {}) => ({
  enabled: true,
  running: '0.1.3',
  latestVersion: '0.1.3',
  releasedAt: '2026-08-19',
  notesUrl: 'https://example.org/v0.1.3',
  lastError: null,
  ...over,
});

describe('updateVerdict', () => {
  it('reports up_to_date when the published version matches', () => {
    expect(updateVerdict(input())).toEqual({ kind: 'up_to_date', latest: '0.1.3' });
  });

  it('reports update_available and carries the notes through', () => {
    expect(updateVerdict(input({ running: '0.1.2' }))).toEqual({
      kind: 'update_available',
      latest: '0.1.3',
      releasedAt: '2026-08-19',
      notesUrl: 'https://example.org/v0.1.3',
    });
  });

  it('reports never_checked when nothing has been cached and nothing failed', () => {
    expect(updateVerdict(input({ latestVersion: null }))).toEqual({ kind: 'never_checked' });
  });

  // Precedence 1. The switch suppresses the ANSWER, not just the polling. An operator who turned
  // it off must not be shown a verdict computed from a cache written before they did.
  it('reports check_off even when the cache holds something newer', () => {
    expect(updateVerdict(input({ enabled: false, running: '0.1.2' }))).toEqual({ kind: 'check_off' });
  });

  // Precedence 3 over 4. Today's fetch failing does not make yesterday's answer wrong.
  it('still reports update_available when the last check failed', () => {
    const v = updateVerdict(input({ running: '0.1.2', lastError: 'HTTP 404' }));
    expect(v.kind).toBe('update_available');
  });

  // Precedence 4. A stale cache naming the running version must not read as confirmed.
  it('reports cannot_confirm when the cache matches but the last check failed', () => {
    expect(updateVerdict(input({ lastError: 'HTTP 404' }))).toEqual({
      kind: 'cannot_confirm', error: 'HTTP 404', cause: 'check_failed',
    });
  });

  it('reports cannot_confirm rather than never_checked when there is an error and no cache', () => {
    expect(updateVerdict(input({ latestVersion: null, lastError: 'ENOTFOUND' }))).toEqual({
      kind: 'cannot_confirm', error: 'ENOTFOUND', cause: 'check_failed',
    });
  });

  // ⛔ The trap this whole step exists for. isNewerVersion returns false when EITHER side is
  // unparseable, so without precedence 2 this falls through to up_to_date and the card claims to
  // be current on a version it cannot read.
  it('reports cannot_confirm when the running version is not a version', () => {
    expect(updateVerdict(input({ running: 'dev' }))).toEqual({
      kind: 'cannot_confirm', error: BAD_RUNNING_VERSION, cause: 'bad_running_version',
    });
  });

  it('flags a bad running version with a null lastError, not a copied one', () => {
    const v = updateVerdict(input({ running: 'dev', lastError: null }));
    expect(v).toMatchObject({ cause: 'bad_running_version' });
    expect(v.kind === 'cannot_confirm' && v.error).toBe(BAD_RUNNING_VERSION);
  });

  // The invariant that keeps the card and the notification bell from contradicting each other.
  // The right-hand side is decideUpdate's rule copied literally from bootstrap/update-check.ts:
  //   enabled && cached.version !== null && isNewerVersion(cached.version, running)
  // If these two ever diverge, one surface shows a banner while the other says nothing.
  it('agrees with decideUpdate about when an update is available', () => {
    const cases = [
      { enabled: true, running: '0.1.2', latestVersion: '0.1.3' },
      { enabled: true, running: '0.1.3', latestVersion: '0.1.3' },
      { enabled: true, running: '0.2.0', latestVersion: '0.1.3' },
      { enabled: false, running: '0.1.2', latestVersion: '0.1.3' },
      { enabled: true, running: '0.1.2', latestVersion: null },
      { enabled: true, running: 'dev', latestVersion: '0.1.3' },
    ];
    for (const c of cases) {
      const decideUpdateSays =
        c.enabled && c.latestVersion !== null && isNewerVersion(c.latestVersion, c.running);
      expect(updateVerdict(input(c)).kind === 'update_available').toBe(decideUpdateSays);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/core exec vitest run src/update-verdict.test.ts
```

Expected: FAIL. `Failed to resolve import "./update-verdict"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/update-verdict.ts`:

```ts
import { isNewerVersion, parseSemver } from './semver';

/** Where an install stands, as one value rather than four overlapping booleans.
 *
 *  Shared with the CLI on purpose. The About card and `openldr update check` must never disagree
 *  about which state an install is in. Wording may differ between them, the verdict may not. */
export type UpdateVerdict =
  | { kind: 'update_available'; latest: string; releasedAt: string | null; notesUrl: string | null }
  | { kind: 'up_to_date'; latest: string }
  | { kind: 'check_off' }
  | { kind: 'cannot_confirm'; error: string; cause: 'check_failed' | 'bad_running_version' }
  | { kind: 'never_checked' };

/** Structurally a subset of UpdateState, so both callers pass their state straight in. */
export interface UpdateVerdictInput {
  enabled: boolean;
  running: string;
  latestVersion: string | null;
  releasedAt: string | null;
  notesUrl: string | null;
  lastError: string | null;
}

/** Not a copy of lastError. This cause fires when lastError is null, and naming a check failure
 *  that never happened sends the operator after the wrong problem. */
export const BAD_RUNNING_VERSION = 'unrecognised running version';

export function updateVerdict(input: UpdateVerdictInput): UpdateVerdict {
  const { enabled, running, latestVersion, releasedAt, notesUrl, lastError } = input;

  // 1. Off means off, matching decideUpdate. Suppressing the poll but still showing a verdict
  //    built from the pre-existing cache would defeat the point of the switch.
  if (!enabled) return { kind: 'check_off' };

  // 2. ⛔ isNewerVersion returns FALSE when either side is unparseable, so without this an
  //    unreadable running version falls through to up_to_date and the card states it is current
  //    on a version it cannot even parse. This cannot displace update_available below, because an
  //    unparseable running version already forces isNewerVersion to false.
  if (!parseSemver(running)) {
    return { kind: 'cannot_confirm', error: BAD_RUNNING_VERSION, cause: 'bad_running_version' };
  }

  // 3. A known newer version beats a failed poll. Today's fetch failing does not make yesterday's
  //    answer wrong, and decideUpdate already ignores lastError for exactly this reason.
  if (latestVersion !== null && isNewerVersion(latestVersion, running)) {
    return { kind: 'update_available', latest: latestVersion, releasedAt, notesUrl };
  }

  // 4. Below the check above, so a real update is never downgraded to a shrug.
  if (lastError) return { kind: 'cannot_confirm', error: lastError, cause: 'check_failed' };

  if (latestVersion === null) return { kind: 'never_checked' };

  return { kind: 'up_to_date', latest: latestVersion };
}
```

- [ ] **Step 4: Export it from the browser-safe entry**

Modify `packages/core/src/pure.ts`, adding one line after the `release-manifest` export:

```ts
export * from './update-verdict';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/core test
```

Expected: PASS, including all 10 new `updateVerdict` cases.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/update-verdict.ts packages/core/src/update-verdict.test.ts packages/core/src/pure.ts
git commit -m "feat(core): one shared verdict for where an install stands"
```

---

### Task 2: Render the CLI from the verdict

**Files:**
- Modify: `packages/cli/src/update.ts:33-54` (the body of `renderUpdateCheck`)
- Modify: `packages/cli/src/update.test.ts` (add cases, existing ones stand)

**Interfaces:**
- Consumes: `updateVerdict` from `@openldr/core/pure` (Task 1). It does not import `BAD_RUNNING_VERSION`; that string reaches the CLI inside the verdict's `error` field. `packages/cli/package.json` already declares `@openldr/core`, so no dependency change is needed.
- Produces: nothing consumed by later tasks.

**Verified before writing this task:** all seven existing `renderUpdateCheck` tests pass unchanged against the new implementation. `cannot confirm this is the latest` does not contain the substring `up to date`, so the `not.toMatch(/up to date/)` assertion still holds, and the JSON test uses `toMatchObject`, so the added `verdict` field does not break it. The CLI change is additive.

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/update.test.ts`, inside the existing `describe('renderUpdateCheck')` block:

```ts
  it('says it cannot confirm when the cache matches but the check failed', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: '0.2.0', updateAvailable: false, lastError: 'HTTP 404' }),
      { json: false },
    );
    expect(text).toMatch(/last check failed: HTTP 404/);
    expect(text).toMatch(/cannot confirm this is the latest/);
    expect(code).toBe(0);
  });

  it('says not checked yet rather than stopping at "published: unknown"', () => {
    const { text, code } = renderUpdateCheck(
      state({ updateAvailable: false, latestVersion: null, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/published: unknown/);
    expect(text).toMatch(/not checked yet/);
    expect(code).toBe(0);
  });

  // ⛔ There was no check failure here. Printing "last check failed: unrecognised running
  // version" would send the operator to look at the network.
  it('prints no failure line when the running version is the thing that is wrong', () => {
    const { text, code } = renderUpdateCheck(
      state({ running: 'dev', updateAvailable: false, lastError: null }),
      { json: false },
    );
    expect(text).toMatch(/cannot confirm this is the latest/);
    expect(text).not.toMatch(/last check failed/);
    expect(code).toBe(0);
  });

  it('includes the verdict in JSON without dropping any existing field', () => {
    const parsed = JSON.parse(renderUpdateCheck(state(), { json: true }).text);
    expect(parsed).toMatchObject({ running: '0.1.1', latestVersion: '0.2.0', updateAvailable: true });
    expect(parsed.verdict).toMatchObject({ kind: 'update_available', latest: '0.2.0' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/cli exec vitest run src/update.test.ts
```

Expected: FAIL. The three text tests fail on the missing new lines, and the JSON test fails with `expected undefined to match object`.

- [ ] **Step 3: Rewrite renderUpdateCheck onto the verdict**

In `packages/cli/src/update.ts`, add to the imports at the top:

```ts
import { updateVerdict } from '@openldr/core/pure';
```

Replace the whole body of `renderUpdateCheck` with:

```ts
export function renderUpdateCheck(state: UpdateState, opts: { json: boolean }): { text: string; code: number } {
  const verdict = updateVerdict(state);
  // Exit 1 means "an update exists" so this can be scripted; it is not an error. Errors exit 2,
  // see UPDATE_ERROR_EXIT below.
  const code = verdict.kind === 'update_available' ? 1 : 0;

  // Every pre-existing field is kept. Adding `verdict` is safe for a script reading this;
  // removing anything would not be.
  if (opts.json) return { text: JSON.stringify({ ...state, verdict }, null, 2), code };

  const lines = [`running:   ${state.running}`];
  if (verdict.kind === 'check_off') {
    lines.push('update check is disabled (Studio: Settings → General)');
    return { text: lines.join('\n'), code };
  }
  lines.push(`published: ${state.latestVersion ?? 'unknown'}`);

  // ⛔ Only a real check failure prints this. The bad_running_version cause fires with lastError
  // null, and naming a failure that never happened points the operator at the network when the
  // problem is the build's own version string.
  if (verdict.kind === 'cannot_confirm' && verdict.cause === 'check_failed') {
    lines.push(`last check failed: ${verdict.error}`);
  }

  switch (verdict.kind) {
    case 'update_available':
      lines.push(
        '',
        `${verdict.latest} is available. To upgrade, run these in your install directory:`,
        '', '  docker compose pull', '  docker compose up -d',
      );
      if (verdict.notesUrl) lines.push('', `release notes: ${verdict.notesUrl}`);
      return { text: lines.join('\n'), code };
    case 'cannot_confirm':
      lines.push('', verdict.cause === 'bad_running_version'
        ? `cannot confirm this is the latest: ${verdict.error}.`
        : 'cannot confirm this is the latest.');
      return { text: lines.join('\n'), code };
    case 'never_checked':
      lines.push('', 'not checked yet.');
      return { text: lines.join('\n'), code };
    case 'up_to_date':
      lines.push('', 'this install is up to date.');
      return { text: lines.join('\n'), code };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/cli exec vitest run src/update.test.ts
```

Expected: PASS, 17 tests. The seven original `renderUpdateCheck` tests, the three `runUpdateCheck` exit code tests, the three `runningVersion` tests, and the four added above.

- [ ] **Step 5: Run the whole CLI package**

```bash
pnpm --filter @openldr/cli test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/update.ts packages/cli/src/update.test.ts
git commit -m "feat(cli): name the state when the check cannot confirm or never ran"
```

---

### Task 3: The Latest row in the About card

**Files:**
- Modify: `apps/studio/package.json` (add one dependency)
- Modify: `apps/studio/src/i18n/en.ts:325-332`
- Modify: `apps/studio/src/i18n/fr.ts:327-334`
- Modify: `apps/studio/src/i18n/pt.ts:327-334`
- Modify: `apps/studio/src/pages/settings/General.tsx` (compute the verdict, add the row, remove the inline span)
- Modify: `apps/studio/src/pages/settings/General.test.tsx` (add render cases)

**Interfaces:**
- Consumes: `updateVerdict` from `@openldr/core/pure` (Task 1).
- Produces: a `data-testid="update-latest"` element. Task 4 uses it to find the row in the browser.

**Why the dependency is needed and why it is low risk:** `apps/studio/package.json` does not list `@openldr/core` today. It does depend on `@openldr/report-designer`, which already imports `@openldr/core/pure`, so that module already reaches the studio bundle and is proven to build. This adds the direct declaration so the import is honest rather than transitive.

- [ ] **Step 1: Add the dependency and install**

In `apps/studio/package.json`, add to `dependencies`, keeping alphabetical order among the `@openldr/*` entries:

```json
    "@openldr/core": "workspace:*",
```

Then, before anything else:

```bash
pnpm install
```

Expected: `Already up to date` or a short link step. This must run now. Skipping it makes the gate fail later on a lockfile race, not on anything to do with this change.

- [ ] **Step 2: Add the i18n keys to all three languages**

In `apps/studio/src/i18n/en.ts`, inside the `about` block, add five keys and trim one:

```ts
        latest: 'Latest',
        upToDate: 'up to date',
        checkOff: 'update check is off',
        cannotConfirm: 'cannot confirm',
        notCheckedYet: 'not checked yet',
```

and change `checkFailed` from `'The last check failed: {{error}}. This install may not be up to date.'` to:

```ts
        checkFailed: 'The last check failed: {{error}}.',
```

In `apps/studio/src/i18n/fr.ts`, same block:

```ts
        latest: 'Dernière version',
        upToDate: 'à jour',
        checkOff: 'vérification des mises à jour désactivée',
        cannotConfirm: 'impossible de confirmer',
        notCheckedYet: 'pas encore vérifié',
```

and `checkFailed: 'La dernière vérification a échoué : {{error}}.'`

In `apps/studio/src/i18n/pt.ts`, same block:

```ts
        latest: 'Versão mais recente',
        upToDate: 'atualizado',
        checkOff: 'verificação de atualizações desativada',
        cannotConfirm: 'não é possível confirmar',
        notCheckedYet: 'ainda não verificado',
```

and `checkFailed: 'A última verificação falhou: {{error}}.'`

- [ ] **Step 3: Run the parity test to prove all three match**

```bash
pnpm --filter @openldr/studio exec vitest run src/i18n/parity.test.ts
```

Expected: PASS. If it fails it names the language missing a key, which is the failure this test exists to catch.

- [ ] **Step 4: Write the failing card tests**

Append to `apps/studio/src/pages/settings/General.test.tsx`, inside the existing `describe('General settings — About card update notice')` block:

```ts
  it('states the install is up to date, naming the version', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, running: '0.1.3', latestVersion: '0.1.3', updateAvailable: false, lastError: null,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    const row = await screen.findByTestId('update-latest');
    expect(row).toHaveTextContent('0.1.3');
    expect(row).toHaveTextContent(/up to date/i);
  });

  it('names the newer version and its notes in the Latest row', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(AVAILABLE);
    render(<MemoryRouter><General /></MemoryRouter>);
    const row = await screen.findByTestId('update-latest');
    expect(row).toHaveTextContent('0.2.0');
    expect(row).toHaveTextContent(/Release notes/i);
  });

  // ⛔ Without this row, "check is off" and "you are current" look identical on screen, and the
  // switch that would tell them apart is hidden from anyone without settings.edit_general.
  it('says the check is off rather than implying the install is current', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, enabled: false, updateAvailable: false,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-latest')).toHaveTextContent(/off/i);
  });

  it('says it cannot confirm when the last check failed', async () => {
    (api.fetchUpdateState as any).mockResolvedValue(FAILING);
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-latest')).toHaveTextContent(/cannot confirm/i);
  });

  it('says not checked yet when nothing has ever been cached', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      ...AVAILABLE, latestVersion: null, releasedAt: null, notesUrl: null,
      lastCheckedAt: null, lastError: null, updateAvailable: false,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByTestId('update-latest')).toHaveTextContent(/not checked yet/i);
  });

  // An older server has no /api/update, so the studio sets update to null. The card must fall
  // back to today's behaviour rather than showing a Latest row with a dash in it.
  it('omits the Latest row entirely when the update state cannot be loaded', async () => {
    (api.fetchUpdateState as any).mockRejectedValue(new Error('404'));
    render(<MemoryRouter><General /></MemoryRouter>);
    await screen.findByText('About');
    expect(screen.queryByTestId('update-latest')).toBeNull();
  });
```

- [ ] **Step 5: Run them to verify they fail**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/settings/General.test.tsx
```

Expected: FAIL, six failures, all `Unable to find an element by: [data-testid="update-latest"]` except the last, which passes already because the element does not exist yet.

- [ ] **Step 6: Compute the verdict in the component**

In `apps/studio/src/pages/settings/General.tsx`, add to the imports:

```ts
import { updateVerdict } from '@openldr/core/pure';
```

Then, immediately after the `toggleUpdateCheck` callback definition and before the `commitNumber` callback, add:

```ts
  // Derived, not state. `update` is the only input, so recomputing on render is cheaper than
  // keeping a second copy in sync with it.
  const verdict = update ? updateVerdict(update) : null;
```

- [ ] **Step 7: Replace the Version row and add the Latest row**

In the same file, replace this block:

```tsx
            <dd className="font-mono">
              {/* `update.running` is the server's own answer and survives a failed /api/config;
                  falling back to config keeps an older server (no /api/update) working. */}
              {update?.running || config?.version || '—'}
              {update?.updateAvailable && (
                <span className="ml-2 font-sans text-xs text-muted-foreground">
                  — {t('settings.general.about.updateAvailable', { version: update.latestVersion })}
                  {/* The manifest carries a full ISO timestamp; the operator only needs the day. */}
                  {update.releasedAt && ` · ${t('settings.general.about.released', { date: update.releasedAt.slice(0, 10) })}`}
                  {update.notesUrl && (
                    <a href={update.notesUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                      {t('settings.general.about.releaseNotes')}
                    </a>
                  )}
                </span>
              )}
            </dd>
```

with:

```tsx
            <dd className="font-mono">
              {/* `update.running` is the server's own answer and survives a failed /api/config;
                  falling back to config keeps an older server (no /api/update) working. */}
              {update?.running || config?.version || '—'}
            </dd>
            {/* The whole point of this row: the card used to speak only when an update existed, so
                "current", "check turned off" and "never checked" all rendered as silence. When
                there is no update state at all (older server, or the 500 path) the row is omitted
                rather than showing a dash, which keeps the card exactly as it was. */}
            {verdict && (
              <>
                <dt className="text-muted-foreground">{t('settings.general.about.latest')}</dt>
                <dd className="font-mono" data-testid="update-latest">
                  {verdict.kind === 'update_available' && (
                    <span className="font-sans text-xs text-muted-foreground">
                      {t('settings.general.about.updateAvailable', { version: verdict.latest })}
                      {/* The manifest carries a full ISO timestamp; the operator only needs the day. */}
                      {verdict.releasedAt && ` · ${t('settings.general.about.released', { date: verdict.releasedAt.slice(0, 10) })}`}
                      {verdict.notesUrl && (
                        <a href={verdict.notesUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
                          {t('settings.general.about.releaseNotes')}
                        </a>
                      )}
                    </span>
                  )}
                  {verdict.kind === 'up_to_date' && (
                    <>
                      {verdict.latest}
                      <span className="ml-1 font-sans text-xs text-muted-foreground">
                        · {t('settings.general.about.upToDate')}
                      </span>
                    </>
                  )}
                  {verdict.kind === 'check_off' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.checkOff')}</span>
                  )}
                  {verdict.kind === 'cannot_confirm' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.cannotConfirm')}</span>
                  )}
                  {verdict.kind === 'never_checked' && (
                    <span className="font-sans text-xs text-muted-foreground">{t('settings.general.about.notCheckedYet')}</span>
                  )}
                </dd>
              </>
            )}
```

Then change the upgrade commands box guard from `update?.updateAvailable` to the verdict, so the card has exactly one source of truth:

```tsx
          {verdict?.kind === 'update_available' && (
```

- [ ] **Step 8: Run the card tests to verify they pass**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/settings/General.test.tsx
```

Expected: PASS, including the six new cases and all pre-existing ones.

- [ ] **Step 9: Typecheck the studio**

```bash
pnpm --filter @openldr/studio typecheck
```

Expected: PASS. A failure here most likely means the `@openldr/core` dependency was added but `pnpm install` in Step 1 was skipped.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/package.json apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts apps/studio/src/pages/settings/General.tsx apps/studio/src/pages/settings/General.test.tsx pnpm-lock.yaml
git commit -m "feat(studio): say whether this install is the latest, not only when it is not"
```

---

### Task 4: Docs, mobile check, and the gate

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/settings.md:19-20`
- Modify: `apps/web/src/landing/changelog.json` (generated)

**Interfaces:**
- Consumes: the `data-testid="update-latest"` element from Task 3.
- Produces: nothing.

**Docs scope, verified 2026-08-19:** only `en/settings.md` exists. `fr/settings.md` and `pt/settings.md` are absent and fall back to English by design, and `apps/web` has no settings doc at all. So this is one file. Do not create the fr and pt files.

- [ ] **Step 1: Rewrite the stale paragraph**

In `apps/studio/src/docs/0.1.0/en/settings.md`, replace these two lines under `## Update checks`:

```markdown
**Settings → General** shows the version this install is running, and — when one exists — the
newer version that has been published, with the two commands to upgrade.
```

with:

```markdown
**Settings → General** shows the version this install is running and, on the line below it, where
that version stands. That line reads one of five ways: the version number and *up to date*; a
newer version with its release date and notes, followed by the two commands to upgrade; *update
check is off*; *cannot confirm*, when the last check failed or the running version could not be
read; or *not checked yet*.
```

Note the existing file uses em dashes. Leave the rest of the file alone. The rule applies to new writing, and reformatting the whole file is out of scope.

- [ ] **Step 2: Run the full gate**

```bash
pnpm turbo run test
```

Expected: PASS, 35 of 35 tasks. Do not pipe this through `tail`. If a package fails, re-run that package alone before assuming a regression, because the usual cause is a timeout under load.

- [ ] **Step 3: Start the studio and check the row at desktop width**

Use `preview_start` with the studio dev server, sign in, and open Settings then General. Confirm the Latest row appears under Version and reads sensibly for whatever state that install is in.

- [ ] **Step 4: Check the row at 375px**

Resize to 375x812 and reload. The `update_available` string is the longest on the card and the grid is `grid-cols-[8rem_1fr]`.

Confirm two things: the row wraps inside its column, and the card itself does not scroll sideways. If it does scroll, the fix is to let the value column wrap rather than widening the grid, because the `8rem` label column is shared with the Version, Environment and License rows.

State plainly in the report which of the five states was actually observed in the browser and which were only proven by test. Do not claim the mobile layout is verified for a state you did not render.

- [ ] **Step 5: Commit the docs**

```bash
git add apps/studio/src/docs/0.1.0/en/settings.md
git commit -m "docs(settings): describe all five states the Latest line can show"
```

- [ ] **Step 6: Regenerate the changelog after merging to main**

```bash
pnpm make:changelog
```

Then commit the result. AGENTS.md section 6 item 5. The generator reads git history, so it must run after the work is on `main`, not before. It publishes only `feat`, `fix` and `perf` commits, so the two `feat` commits from Tasks 1 to 3 will appear.

```bash
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```
