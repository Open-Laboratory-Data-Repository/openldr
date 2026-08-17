# Telling the operator a new version exists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app polls the `latest.json` that Project A publishes, caches it, and reports "a newer version exists" through four surfaces — without ever pulling an image or restarting anything.

**Architecture:** A poller in `@openldr/bootstrap` writes discrete `update.*` app-settings keys; every surface reads that cache. The decision ("is there an update, and what does the notification look like") is a pure function tested with fixtures. The bell entry is synthetic — derived from the cache, with no source row and no new table.

**Tech Stack:** TypeScript, vitest, Fastify, React 18 + react-i18next, commander (CLI), Kysely.

**Spec:** `docs/superpowers/specs/2026-08-17-update-notice-design.md`

## Global Constraints

- **A check, not an upgrade.** Nothing here pulls an image, restarts a container, or touches the
  Docker socket. Not in any task.
- **Reuse A's primitives.** `parseReleaseManifest` from `packages/release/src/manifest.ts` and
  `isNewerVersion` from `@openldr/core/pure`. **Never write a third version comparison** — a
  third opinion about "newer" publishes releases the app never announces.
- **The manifest URL** is exactly
  `https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json`
- **Default ON.** `update.enabled` defaults to `true` when the key is absent.
- **A failed fetch is silent.** Record it, keep the last good answer, never toast. An air-gapped
  lab must not be nagged for being air-gapped.
- **i18n is en + fr + pt, always all three.** `apps/studio/src/i18n/parity.test.ts` fails the
  build on a key present in one locale and missing from another.
- **No `Co-Authored-By` trailers** (AGENTS.md §9).
- **Never claim done without the command and its output** (AGENTS.md §1).
- Test command: `pnpm --filter <pkg> exec vitest run <path>`. Gate: `pnpm turbo run test`.

## ⛔ Three traps in the bell, all in Task 3

Read these before Task 3. Each one produces a plausible-looking bell that is wrong.

1. **`createdAt` must be the stored `firstSeenAt`, never `now`.** `listNotifications`
   (`packages/bootstrap/src/notifications.ts:202`) marks anything with
   `createdAt <= reads.cursor` as read. A `now` timestamp always beats the cursor, so the
   notification reappears as unread on every single request — a bell that cannot be dismissed.
2. **The id must be `update:<version>`.** That is what makes it one notification per version
   instead of one per poll.
3. **It must be appended OUTSIDE `gather()`'s window.** `gather` drops anything older than
   `WINDOW_DAYS = 30` (`notifications.ts:130`). Inside it, an update still available after 30
   days silently vanishes from the bell. It is not a source row, so it does not have to obey the
   source window — append it after.

---

## File Structure

**Created:**
- `packages/bootstrap/src/update-check.ts` — the cache accessors, the pure decision, the poller.
- `packages/bootstrap/src/update-check.test.ts`
- `packages/cli/src/update.ts` — `runUpdateCheck`.
- `packages/cli/src/update.test.ts`

**Modified:**
- `packages/bootstrap/src/index.ts` — export the new module.
- `packages/bootstrap/src/notifications.ts` — `update_available` type + the synthetic entry.
- `packages/bootstrap/src/notifications.db.test.ts` — the three traps.
- `apps/server/src/app.ts` — start the poller; expose the state.
- `apps/server/src/settings-routes.ts` — the on/off switch.
- `apps/studio/src/pages/settings/General.tsx` — About card + the two commands.
- `apps/studio/src/i18n/{en,fr,pt}.ts`
- `packages/cli/src/program.ts` — register `openldr update check`.
- `apps/studio/src/docs/0.1.0/en/settings.md` — the switch and what it discloses.

**Why `@openldr/bootstrap`:** it is where `validation-settings.ts`, `lab-identity.ts` and
`sync-settings.ts` already live, and putting it there is what makes the Fastify route and the CLI
call identical code rather than two copies (AGENTS.md §6).

---

## Task 1: The cache and the decision

**Files:**
- Create: `packages/bootstrap/src/update-check.ts`, `packages/bootstrap/src/update-check.test.ts`
- Modify: `packages/bootstrap/src/index.ts`

**Interfaces:**
- Consumes: `AppSettingStore` from `@openldr/db` (`get(key)`, `set(key, value, updatedBy)`);
  `isNewerVersion` from `@openldr/core/pure`.
- Produces, used by Tasks 2, 3, 4, 6:
  - `interface UpdateState { enabled: boolean; running: string; latestVersion: string | null; releasedAt: string | null; notesUrl: string | null; firstSeenAt: string | null; lastCheckedAt: string | null; lastError: string | null; updateAvailable: boolean }`
  - `interface UpdateCheck { read(running: string): Promise<UpdateState>; setEnabled(on: boolean, actor: string | null): Promise<void>; record(manifest: {version:string;releasedAt:string;notesUrl:string}, now: string): Promise<void>; recordFailure(message: string, now: string): Promise<void> }`
  - `createUpdateCheck(store: AppSettingStore): UpdateCheck`
  - `decideUpdate(input: { enabled: boolean; running: string; cached: { version: string|null; releasedAt: string|null; notesUrl: string|null; firstSeenAt: string|null }; lastCheckedAt: string|null; lastError: string|null }): UpdateState`
  - `UPDATE_KEYS` — the seven key names.

**Context:** copy the factory shape from `packages/bootstrap/src/validation-settings.ts` — a
`KEY` constant, a small interface, `createX(store)` returning an object literal.

**Why `record` takes `now`:** `firstSeenAt` must only move when the *version* changes. Passing
the clock in keeps the function pure enough to test, and the caller supplies a fixed value in
tests.

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/update-check.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createUpdateCheck, decideUpdate, UPDATE_KEYS } from './update-check';
import type { AppSettingStore } from '@openldr/db';

function fakeStore(initial: Record<string, string> = {}): AppSettingStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (k: string) => (k in data ? { key: k, value: data[k]!, updatedAt: new Date(), updatedBy: null } : null)),
    getAll: vi.fn(async () => []),
    set: vi.fn(async (k: string, v: string) => { data[k] = v; }),
  } as unknown as AppSettingStore & { data: Record<string, string> };
}

const cached = (over: Partial<{ version: string|null; releasedAt: string|null; notesUrl: string|null; firstSeenAt: string|null }> = {}) => ({
  version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z', ...over,
});

describe('decideUpdate', () => {
  it('reports an update when the published version is newer', () => {
    const s = decideUpdate({ enabled: true, running: '0.1.1', cached: cached(), lastCheckedAt: null, lastError: null });
    expect(s.updateAvailable).toBe(true);
    expect(s.latestVersion).toBe('0.2.0');
  });

  it('reports none when the running version equals the published one', () => {
    expect(decideUpdate({ enabled: true, running: '0.2.0', cached: cached(), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  it('reports none when the running version is ahead — a dev build must not be told to downgrade', () => {
    expect(decideUpdate({ enabled: true, running: '0.3.0', cached: cached(), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  // Never announce an update you could not verify.
  it('reports none when the cached version is unparseable', () => {
    expect(decideUpdate({ enabled: true, running: '0.1.1', cached: cached({ version: 'latest' }), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  it('reports none when the running version is unparseable', () => {
    expect(decideUpdate({ enabled: true, running: 'dev', cached: cached(), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  it('reports none when nothing is cached yet', () => {
    expect(decideUpdate({ enabled: true, running: '0.1.1', cached: cached({ version: null }), lastCheckedAt: null, lastError: null }).updateAvailable).toBe(false);
  });

  // The switch suppresses the ANSWER, not just the polling — an operator who turned it off
  // must not still see a banner from a stale cache.
  it('reports none when the check is disabled, even with a newer version cached', () => {
    const s = decideUpdate({ enabled: false, running: '0.1.1', cached: cached(), lastCheckedAt: null, lastError: null });
    expect(s.updateAvailable).toBe(false);
    expect(s.enabled).toBe(false);
  });

  it('passes through lastCheckedAt and lastError so the UI can say "never checked"', () => {
    const s = decideUpdate({ enabled: true, running: '0.1.1', cached: cached(), lastCheckedAt: '2026-08-21T00:00:00.000Z', lastError: 'getaddrinfo ENOTFOUND' });
    expect(s.lastCheckedAt).toBe('2026-08-21T00:00:00.000Z');
    expect(s.lastError).toBe('getaddrinfo ENOTFOUND');
  });
});

describe('createUpdateCheck', () => {
  it('defaults to enabled when the key is absent', async () => {
    const s = await createUpdateCheck(fakeStore()).read('0.1.1');
    expect(s.enabled).toBe(true);
  });

  it('treats only the exact string "false" as off', async () => {
    expect((await createUpdateCheck(fakeStore({ [UPDATE_KEYS.enabled]: 'false' })).read('0.1.1')).enabled).toBe(false);
    expect((await createUpdateCheck(fakeStore({ [UPDATE_KEYS.enabled]: 'true' })).read('0.1.1')).enabled).toBe(true);
    expect((await createUpdateCheck(fakeStore({ [UPDATE_KEYS.enabled]: 'nonsense' })).read('0.1.1')).enabled).toBe(true);
  });

  it('setEnabled writes the flag', async () => {
    const store = fakeStore();
    await createUpdateCheck(store).setEnabled(false, 'admin');
    expect(store.data[UPDATE_KEYS.enabled]).toBe('false');
  });

  // firstSeenAt is what keeps the bell dismissible. It must not move on a repeat sighting.
  it('record sets firstSeenAt on a new version and does NOT move it on a repeat', async () => {
    const store = fakeStore();
    const uc = createUpdateCheck(store);
    const m = { version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'https://example.org/x' };
    await uc.record(m, '2026-08-20T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.firstSeenAt]).toBe('2026-08-20T10:00:00.000Z');
    await uc.record(m, '2026-08-25T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.firstSeenAt]).toBe('2026-08-20T10:00:00.000Z');
  });

  it('record moves firstSeenAt when the version changes', async () => {
    const store = fakeStore();
    const uc = createUpdateCheck(store);
    await uc.record({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'u' }, '2026-08-20T10:00:00.000Z');
    await uc.record({ version: '0.3.0', releasedAt: '2026-09-01', notesUrl: 'u2' }, '2026-09-01T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.firstSeenAt]).toBe('2026-09-01T10:00:00.000Z');
  });

  it('record clears a previous error', async () => {
    const store = fakeStore({ [UPDATE_KEYS.lastError]: 'boom' });
    await createUpdateCheck(store).record({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'u' }, '2026-08-20T10:00:00.000Z');
    expect(store.data[UPDATE_KEYS.lastError]).toBe('');
  });

  // A failed fetch must never discard a good answer — an air-gapped lab keeps what it knew.
  it('recordFailure keeps the cached version and records the error', async () => {
    const store = fakeStore();
    const uc = createUpdateCheck(store);
    await uc.record({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'u' }, '2026-08-20T10:00:00.000Z');
    await uc.recordFailure('getaddrinfo ENOTFOUND', '2026-08-26T10:00:00.000Z');
    const s = await uc.read('0.1.1');
    expect(s.latestVersion).toBe('0.2.0');
    expect(s.updateAvailable).toBe(true);
    expect(s.lastError).toBe('getaddrinfo ENOTFOUND');
    expect(s.lastCheckedAt).toBe('2026-08-26T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/update-check.test.ts`
Expected: FAIL — `Failed to resolve import "./update-check"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/bootstrap/src/update-check.ts`:

```ts
import type { AppSettingStore } from '@openldr/db';
import { isNewerVersion } from '@openldr/core/pure';

/** Discrete keys, deliberately not one JSON blob. A blob written by one surface and never read
 *  by another is a failure mode this repo has already shipped once — see the sync config
 *  migration in sync-settings-migrate.ts. */
export const UPDATE_KEYS = {
  enabled: 'update.enabled',
  latestVersion: 'update.latestVersion',
  releasedAt: 'update.releasedAt',
  notesUrl: 'update.notesUrl',
  firstSeenAt: 'update.firstSeenAt',
  lastCheckedAt: 'update.lastCheckedAt',
  lastError: 'update.lastError',
} as const;

export interface UpdateState {
  enabled: boolean;
  running: string;
  latestVersion: string | null;
  releasedAt: string | null;
  notesUrl: string | null;
  firstSeenAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updateAvailable: boolean;
}

export interface UpdateCheck {
  read(running: string): Promise<UpdateState>;
  setEnabled(on: boolean, actor: string | null): Promise<void>;
  record(manifest: { version: string; releasedAt: string; notesUrl: string }, now: string): Promise<void>;
  recordFailure(message: string, now: string): Promise<void>;
}

/** Pure. Given what is running, what is cached and whether the check is on, is there an update?
 *
 *  `isNewerVersion` returns false when either side is unparseable, so a malformed manifest or a
 *  dev build degrades to "no update known" rather than a false alarm. */
export function decideUpdate(input: {
  enabled: boolean;
  running: string;
  cached: { version: string | null; releasedAt: string | null; notesUrl: string | null; firstSeenAt: string | null };
  lastCheckedAt: string | null;
  lastError: string | null;
}): UpdateState {
  const { enabled, running, cached } = input;
  // The switch suppresses the ANSWER, not just the polling: an operator who turned it off must
  // not keep seeing a banner produced from a cache written before they did.
  const updateAvailable = enabled && cached.version !== null && isNewerVersion(cached.version, running);
  return {
    enabled,
    running,
    latestVersion: cached.version,
    releasedAt: cached.releasedAt,
    notesUrl: cached.notesUrl,
    firstSeenAt: cached.firstSeenAt,
    lastCheckedAt: input.lastCheckedAt,
    lastError: input.lastError,
    updateAvailable,
  };
}

export function createUpdateCheck(store: AppSettingStore): UpdateCheck {
  const read1 = async (key: string): Promise<string | null> => {
    const row = await store.get(key);
    const v = row?.value ?? '';
    return v === '' ? null : v;
  };

  return {
    async read(running) {
      const [enabledRaw, version, releasedAt, notesUrl, firstSeenAt, lastCheckedAt, lastError] = await Promise.all([
        read1(UPDATE_KEYS.enabled),
        read1(UPDATE_KEYS.latestVersion),
        read1(UPDATE_KEYS.releasedAt),
        read1(UPDATE_KEYS.notesUrl),
        read1(UPDATE_KEYS.firstSeenAt),
        read1(UPDATE_KEYS.lastCheckedAt),
        read1(UPDATE_KEYS.lastError),
      ]);
      // Default ON: only the exact string 'false' turns it off, so an absent or corrupt value
      // fails toward the operator being told.
      const enabled = enabledRaw !== 'false';
      return decideUpdate({
        enabled,
        running,
        cached: { version, releasedAt, notesUrl, firstSeenAt },
        lastCheckedAt,
        lastError,
      });
    },

    async setEnabled(on, actor) {
      await store.set(UPDATE_KEYS.enabled, on ? 'true' : 'false', actor);
    },

    async record(manifest, now) {
      const previous = await read1(UPDATE_KEYS.latestVersion);
      // ⛔ firstSeenAt moves ONLY when the version changes. It is the notification's createdAt,
      // and a value that moves on every poll makes the bell entry undismissable.
      if (previous !== manifest.version) {
        await store.set(UPDATE_KEYS.firstSeenAt, now, 'update-check');
      }
      await store.set(UPDATE_KEYS.latestVersion, manifest.version, 'update-check');
      await store.set(UPDATE_KEYS.releasedAt, manifest.releasedAt, 'update-check');
      await store.set(UPDATE_KEYS.notesUrl, manifest.notesUrl, 'update-check');
      await store.set(UPDATE_KEYS.lastCheckedAt, now, 'update-check');
      await store.set(UPDATE_KEYS.lastError, '', 'update-check');
    },

    async recordFailure(message, now) {
      // Deliberately does NOT touch latestVersion. An air-gapped lab keeps what it last knew.
      await store.set(UPDATE_KEYS.lastCheckedAt, now, 'update-check');
      await store.set(UPDATE_KEYS.lastError, message, 'update-check');
    },
  };
}
```

Add to `packages/bootstrap/src/index.ts`:

```ts
export * from './update-check';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/update-check.test.ts`
Expected: PASS, 15 tests.

Run: `pnpm --filter @openldr/bootstrap typecheck`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/update-check.ts packages/bootstrap/src/update-check.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): cache and decide whether a newer version exists"
```

---

## Task 2: The poller

**Files:**
- Modify: `packages/bootstrap/src/update-check.ts`, `packages/bootstrap/src/update-check.test.ts`

**Interfaces:**
- Consumes: `UpdateCheck` from Task 1; `parseReleaseManifest` from `packages/release/src/manifest.ts`.
- Produces, used by Task 4:
  - `LATEST_JSON_URL` — the constant.
  - `pollOnce(deps: { check: UpdateCheck; fetchText: (url: string) => Promise<string>; now: () => string; url?: string }): Promise<void>`
  - `startUpdateCheck(deps: { check: UpdateCheck; fetchText: (url: string) => Promise<string>; now: () => string; intervalMs?: number; logger?: { warn(o: unknown, m: string): void } }): () => void` — returns a stop function.

**Context:** `fetchText` is injected so no test touches the network. The server passes a real one
built on `fetch`. `parseReleaseManifest` already returns `null` rather than throwing on anything
malformed — it was written for this consumer.

⚠ **`@openldr/bootstrap` must not gain a dependency on `@openldr/release`.** `packages/release` is
private maintainer tooling that must never ship inside a runtime image. Import the parser by
relative path is NOT acceptable either. **Copy nothing** — instead, move `manifest.ts` into
`@openldr/core/pure` in this task and have `packages/release` import it from there. It is ~40
lines with no dependencies beyond `parseSemver`, which is already in `core/pure`. Update
`packages/release/src/manifest.ts` to re-export from core so its existing tests keep passing, and
say in your report that you did this.

- [ ] **Step 1: Write the failing test**

Append to `packages/bootstrap/src/update-check.test.ts`:

```ts
import { pollOnce, startUpdateCheck, LATEST_JSON_URL } from './update-check';

const MANIFEST = JSON.stringify({ version: '0.2.0', releasedAt: '2026-08-20', notesUrl: 'https://example.org/x' });

describe('pollOnce', () => {
  it('caches a good manifest', async () => {
    const store = fakeStore();
    const check = createUpdateCheck(store);
    await pollOnce({ check, fetchText: async () => MANIFEST, now: () => '2026-08-20T10:00:00.000Z' });
    const s = await check.read('0.1.1');
    expect(s.latestVersion).toBe('0.2.0');
    expect(s.updateAvailable).toBe(true);
    expect(s.lastError).toBeNull();
  });

  it('fetches the published release asset URL by default', async () => {
    const seen: string[] = [];
    await pollOnce({
      check: createUpdateCheck(fakeStore()),
      fetchText: async (u) => { seen.push(u); return MANIFEST; },
      now: () => '2026-08-20T10:00:00.000Z',
    });
    expect(seen).toEqual([LATEST_JSON_URL]);
    expect(LATEST_JSON_URL).toBe(
      'https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json',
    );
  });

  // An air-gapped lab must not be nagged, and must not lose what it knew.
  it('records a network failure without discarding the cached answer', async () => {
    const store = fakeStore();
    const check = createUpdateCheck(store);
    await pollOnce({ check, fetchText: async () => MANIFEST, now: () => '2026-08-20T10:00:00.000Z' });
    await pollOnce({
      check,
      fetchText: async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); },
      now: () => '2026-08-26T10:00:00.000Z',
    });
    const s = await check.read('0.1.1');
    expect(s.latestVersion).toBe('0.2.0');
    expect(s.lastError).toMatch(/ENOTFOUND/);
  });

  it('records a malformed manifest as a failure, not as an update', async () => {
    const store = fakeStore();
    const check = createUpdateCheck(store);
    await pollOnce({ check, fetchText: async () => '{"version":"latest"}', now: () => '2026-08-20T10:00:00.000Z' });
    const s = await check.read('0.1.1');
    expect(s.latestVersion).toBeNull();
    expect(s.updateAvailable).toBe(false);
    expect(s.lastError).toMatch(/manifest/i);
  });

  it('records non-JSON as a failure', async () => {
    const store = fakeStore();
    const check = createUpdateCheck(store);
    await pollOnce({ check, fetchText: async () => '<html>404</html>', now: () => '2026-08-20T10:00:00.000Z' });
    expect((await check.read('0.1.1')).lastError).toBeTruthy();
  });

  // The switch suppresses the request itself. "Off" must mean no traffic leaves the lab.
  it('does not fetch at all when the check is disabled', async () => {
    const store = fakeStore({ [UPDATE_KEYS.enabled]: 'false' });
    let called = 0;
    await pollOnce({
      check: createUpdateCheck(store),
      fetchText: async () => { called += 1; return MANIFEST; },
      now: () => '2026-08-20T10:00:00.000Z',
    });
    expect(called).toBe(0);
  });

  it('never throws — a poll failure must not take down the caller', async () => {
    await expect(pollOnce({
      check: createUpdateCheck(fakeStore()),
      fetchText: async () => { throw new Error('boom'); },
      now: () => '2026-08-20T10:00:00.000Z',
    })).resolves.toBeUndefined();
  });
});

describe('startUpdateCheck', () => {
  it('polls immediately and returns a stop function that stops further polls', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const stop = startUpdateCheck({
      check: createUpdateCheck(fakeStore()),
      fetchText: async () => { calls += 1; return MANIFEST; },
      now: () => '2026-08-20T10:00:00.000Z',
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/update-check.test.ts`
Expected: FAIL — `pollOnce is not exported`.

- [ ] **Step 3: Write minimal implementation**

First move the manifest model into core. Create `packages/core/src/release-manifest.ts` with the
exact contents of `packages/release/src/manifest.ts`, changing only its import of `parseSemver`
to `./semver`. Add `export * from './release-manifest';` to BOTH `packages/core/src/index.ts` and
`packages/core/src/pure.ts` (following how `semver` is listed in each). Then replace
`packages/release/src/manifest.ts` with:

```ts
// Moved to @openldr/core/pure so @openldr/bootstrap can parse a manifest without depending on
// this package — packages/release is maintainer tooling and must never ship in a runtime image.
export { buildReleaseManifest, parseReleaseManifest, type ReleaseManifest } from '@openldr/core/pure';
```

Then append to `packages/bootstrap/src/update-check.ts`:

```ts
import { parseReleaseManifest } from '@openldr/core/pure';

export const LATEST_JSON_URL =
  'https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PollDeps {
  check: UpdateCheck;
  fetchText: (url: string) => Promise<string>;
  now: () => string;
  url?: string;
}

/** One poll. NEVER throws: a background check that can crash its caller is worse than one that
 *  silently misses a release. */
export async function pollOnce(deps: PollDeps): Promise<void> {
  const { check, fetchText, now } = deps;
  try {
    // "Off" means no traffic leaves the lab, not merely a hidden answer.
    const state = await check.read('0.0.0');
    if (!state.enabled) return;

    const text = await fetchText(deps.url ?? LATEST_JSON_URL);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await check.recordFailure('response was not JSON', now());
      return;
    }
    const manifest = parseReleaseManifest(raw);
    if (!manifest) {
      await check.recordFailure('manifest did not match the expected shape', now());
      return;
    }
    await check.record(manifest, now());
  } catch (err) {
    try {
      await deps.check.recordFailure(err instanceof Error ? err.message : String(err), deps.now());
    } catch {
      // The store itself is unavailable. Nothing useful left to do, and throwing here would
      // defeat the whole point of this catch.
    }
  }
}

export function startUpdateCheck(deps: PollDeps & {
  intervalMs?: number;
  logger?: { warn(o: unknown, m: string): void };
}): () => void {
  const interval = deps.intervalMs ?? DAY_MS;
  void pollOnce(deps);
  const timer = setInterval(() => { void pollOnce(deps); }, interval);
  // Do not hold the process open for a background check.
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/update-check.test.ts`
Expected: PASS, 23 tests.

Run: `pnpm --filter @openldr/release exec vitest run` — the moved parser must not break A.
Expected: PASS, all existing tests.

Run: `pnpm --filter @openldr/core exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/update-check.ts packages/bootstrap/src/update-check.test.ts packages/core/src/release-manifest.ts packages/core/src/index.ts packages/core/src/pure.ts packages/release/src/manifest.ts
git commit -m "feat(bootstrap): poll the published manifest, silently on failure"
```

---

## Task 3: The bell entry

**Files:**
- Modify: `packages/bootstrap/src/notifications.ts`
- Modify: `packages/bootstrap/src/notifications.db.test.ts`

**Interfaces:**
- Consumes: `UpdateState` from Task 1.
- Produces, used by Task 4: `updateStateToNotification(state: UpdateState): Notification | null`,
  and `NotificationCtx` gains an optional `updateState?: UpdateState`.

**⛔ Read the three traps at the top of this plan before writing anything.**

- [ ] **Step 1: Write the failing test**

Append to `packages/bootstrap/src/notifications.db.test.ts`:

```ts
import { updateStateToNotification } from './notifications';
import type { UpdateState } from './update-check';

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
  notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
  lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true, ...over,
});

describe('updateStateToNotification', () => {
  it('is null when no update is available', () => {
    expect(updateStateToNotification(state({ updateAvailable: false }))).toBeNull();
  });

  it('is null when the check is disabled', () => {
    expect(updateStateToNotification(state({ enabled: false, updateAvailable: false }))).toBeNull();
  });

  it('is null when firstSeenAt is missing — without it the entry cannot be dismissed', () => {
    expect(updateStateToNotification(state({ firstSeenAt: null }))).toBeNull();
  });

  // Trap 2: one notification per VERSION, not per poll.
  it('uses a stable id keyed on the version', () => {
    expect(updateStateToNotification(state())!.id).toBe('update:0.2.0');
    expect(updateStateToNotification(state({ latestVersion: '0.3.0' }))!.id).toBe('update:0.3.0');
  });

  // Trap 1: createdAt must be firstSeenAt. A `now` value always beats the mark-all-read cursor,
  // so the entry would come back unread on every request.
  it('uses firstSeenAt as createdAt, unchanged across calls', () => {
    const a = updateStateToNotification(state())!;
    const b = updateStateToNotification(state())!;
    expect(a.createdAt).toBe('2026-08-20T10:00:00.000Z');
    expect(b.createdAt).toBe(a.createdAt);
  });

  it('is an info notification pointing at the settings page', () => {
    const n = updateStateToNotification(state())!;
    expect(n.type).toBe('update_available');
    expect(n.priority).toBe('info');
    expect(n.linkTo).toBe('/settings/general');
    expect(n.metadata).toMatchObject({ version: '0.2.0', running: '0.1.1' });
  });
});
```

Add to the existing `listNotifications` describe block in the same file:

```ts
  // Trap 3: gather() drops source rows older than WINDOW_DAYS=30. The update entry is NOT a
  // source row, so it must survive past the window — the update is still available.
  it('includes the update entry even when firstSeenAt is older than the source window', async () => {
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const res = await listNotifications(
      { ...ctx, updateState: state({ firstSeenAt: old }) } as never,
      'u1',
      {},
    );
    expect(res.notifications.some((n) => n.id === 'update:0.2.0')).toBe(true);
  });

  it('stays dismissed after mark-all-read', async () => {
    const c = { ...ctx, updateState: state() } as never;
    await markAllNotificationsRead(c, 'u1');
    const res = await listNotifications(c, 'u1', {});
    const n = res.notifications.find((x) => x.id === 'update:0.2.0');
    expect(n?.readAt).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/notifications.db.test.ts`
Expected: FAIL — `updateStateToNotification is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `packages/bootstrap/src/notifications.ts`, add `'update_available'` to the `NotificationType`
union (line 7-10), add `updateState?: UpdateState` to `NotificationCtx` (line 122), import
`type { UpdateState } from './update-check'`, and add:

```ts
/** The bell entry for an available update. Synthetic — derived from the cached state, with no
 *  source row and no table of its own.
 *
 *  ⛔ Three things this must get right, each of which produces a plausible but broken bell:
 *   - `createdAt` is firstSeenAt, NEVER now. listNotifications marks anything with
 *     createdAt <= the mark-all-read cursor as read; a `now` value always beats the cursor, so
 *     the entry would reappear unread on every request and could never be dismissed.
 *   - the id is keyed on the VERSION, so there is one entry per release rather than per poll.
 *   - it is appended OUTSIDE gather()'s 30-day window (see listNotifications) — it is not a
 *     source row, and an update still available after 30 days must not vanish from the bell. */
export function updateStateToNotification(state: UpdateState): Notification | null {
  if (!state.enabled || !state.updateAvailable) return null;
  if (!state.latestVersion || !state.firstSeenAt) return null;
  return {
    id: `update:${state.latestVersion}`,
    type: 'update_available',
    priority: 'info',
    title: `Version ${state.latestVersion} is available`,
    body: `This install is running ${state.running}.`,
    linkTo: '/settings/general',
    createdAt: state.firstSeenAt,
    readAt: null,
    metadata: {
      version: state.latestVersion,
      running: state.running,
      releasedAt: state.releasedAt,
      notesUrl: state.notesUrl,
    },
  };
}
```

In `listNotifications`, immediately after `const visible = all.filter(...)`, insert:

```ts
  // Appended AFTER gather()'s window filter on purpose — see updateStateToNotification. Prefs
  // still apply, so an operator can switch this type off like any other.
  const update = ctx.updateState ? updateStateToNotification(ctx.updateState) : null;
  if (update && passesPrefs(update, disabled, prefs.minPriority)) visible.push(update);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/notifications.db.test.ts`
Expected: PASS, including the two dismissal tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/notifications.ts packages/bootstrap/src/notifications.db.test.ts
git commit -m "feat(bootstrap): a dismissible bell entry for an available update"
```

---

## Task 4: Server — start the poller, expose the state, own the switch

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/settings-routes.ts`
- Modify: `apps/server/src/notification-routes.ts`
- Test: `apps/server/src/settings-routes.test.ts`

**Interfaces:**
- Consumes: `createUpdateCheck`, `startUpdateCheck`, `UpdateState` (Tasks 1-2);
  `updateStateToNotification` wiring (Task 3).
- Produces, used by Tasks 5 and 6:
  - `GET /api/update` → the `UpdateState` JSON.
  - `PUT /api/settings/update` with body `{ enabled: boolean }`.

**Context:** `apps/server` is the only package with real lint, and it enforces the
return/await `reply.send` gzip-clobber invariant — follow the surrounding handlers exactly.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/settings-routes.test.ts`, following the file's existing app-building
helper:

```ts
  it('GET /api/update reports the running version and whether an update exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/update' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { running: string; enabled: boolean; updateAvailable: boolean };
    expect(typeof body.running).toBe('string');
    expect(body.enabled).toBe(true);
    expect(body.updateAvailable).toBe(false);
  });

  it('PUT /api/settings/update turns the check off and GET reflects it', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/settings/update', payload: { enabled: false } });
    expect(put.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/update' });
    expect((res.json() as { enabled: boolean }).enabled).toBe(false);
  });

  it('PUT /api/settings/update rejects a non-boolean', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings/update', payload: { enabled: 'yes' } });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-routes.test.ts`
Expected: FAIL — 404 on both routes.

- [ ] **Step 3: Write minimal implementation**

In `apps/server/src/app.ts`, alongside the existing service construction, add:

```ts
const updateCheck = createUpdateCheck(appSettings);
startUpdateCheck({
  check: updateCheck,
  fetchText: async (url) => {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  },
  now: () => new Date().toISOString(),
  logger: app.log,
});
```

Register the read route next to `/api/config`:

```ts
app.get('/api/update', async () => updateCheck.read(readAppVersion()));
```

In `apps/server/src/settings-routes.ts`, following the surrounding handlers' capability guard and
`return reply.send(...)` shape:

```ts
  app.put('/api/settings/update', SETTINGS_MANAGE, async (req, reply) => {
    const body = req.body as { enabled?: unknown };
    if (typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled must be a boolean' });
    }
    await ctx.updateCheck.setEnabled(body.enabled, actorName(req));
    return reply.send({ enabled: body.enabled });
  });
```

In `apps/server/src/notification-routes.ts:21`, pass the state into the ctx so the bell can see it:

```ts
      const updateState = await ctx.updateCheck.read(readAppVersion());
      return await listNotifications({ ...ctx, updateState }, userId(req), {
```

Wire `updateCheck` into whatever ctx object those two route modules already receive, matching how
the neighbouring services are threaded through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/settings-routes.test.ts`
Expected: PASS.

Run: `pnpm --filter @openldr/server lint`
Expected: no errors. This package's lint enforces the `reply.send` invariant.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src
git commit -m "feat(server): poll for updates, expose the state, own the switch"
```

---

## Task 5: Studio — the About card, the switch, and the two commands

**Files:**
- Modify: `apps/studio/src/pages/settings/General.tsx`
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/pages/settings/General.test.tsx`

**Interfaces:**
- Consumes: `GET /api/update`, `PUT /api/settings/update` (Task 4).
- Produces: nothing later tasks depend on.

**Context:** the About card is at `General.tsx:131-137`; the version line is
`{config?.version || '—'}`. Follow AGENTS.md §5 — no standalone buttons, fields are
label-left / input-right, and the switch is a shadcn `Switch`.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/pages/settings/General.test.tsx`, reusing the file's existing api mock:

```tsx
  it('shows the available version next to the running one', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
      notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
      lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText(/0\.2\.0 available/i)).toBeInTheDocument();
  });

  it('shows the two upgrade commands when an update exists', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
      notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
      lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    expect(await screen.findByText(/docker compose pull/)).toBeInTheDocument();
    expect(screen.getByText(/docker compose up -d/)).toBeInTheDocument();
  });

  it('does not show the commands when the install is current', async () => {
    (api.fetchUpdateState as any).mockResolvedValue({
      enabled: true, running: '0.2.0', latestVersion: '0.2.0', releasedAt: '2026-08-20',
      notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
      lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: false,
    });
    render(<MemoryRouter><General /></MemoryRouter>);
    await screen.findByText('0.2.0');
    expect(screen.queryByText(/docker compose pull/)).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/General.test.tsx`
Expected: FAIL — `api.fetchUpdateState is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/studio/src/api.ts`:

```ts
export interface UpdateState {
  enabled: boolean; running: string; latestVersion: string | null; releasedAt: string | null;
  notesUrl: string | null; firstSeenAt: string | null; lastCheckedAt: string | null;
  lastError: string | null; updateAvailable: boolean;
}
export const fetchUpdateState = (): Promise<UpdateState> =>
  apiGet<UpdateState>('/api/update', 'update state');
export const setUpdateCheckEnabled = (enabled: boolean): Promise<{ enabled: boolean }> =>
  authFetch('/api/settings/update', jbody({ enabled }, 'PUT')).then((r) => okJson(r, 'update check'));
```

In `General.tsx`, load the state alongside the existing config, and replace the version `<dd>`:

```tsx
<dd className="font-mono">
  {config?.version || '—'}
  {update?.updateAvailable && (
    <span className="ml-2 font-sans text-xs text-muted-foreground">
      — {t('settings.general.about.updateAvailable', { version: update.latestVersion })}
      {update.notesUrl && (
        <a href={update.notesUrl} target="_blank" rel="noreferrer" className="ml-1 underline">
          {t('settings.general.about.releaseNotes')}
        </a>
      )}
    </span>
  )}
</dd>
```

Add, inside the About card, after the dl:

```tsx
{update?.updateAvailable && (
  <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
    <p className="mb-2 text-xs text-muted-foreground">{t('settings.general.about.upgradeHow')}</p>
    <pre className="overflow-x-auto font-mono text-xs">docker compose pull{'\n'}docker compose up -d</pre>
  </div>
)}
```

Add the switch to the same card, label-left / input-right per AGENTS.md §5, calling
`setUpdateCheckEnabled` and reloading the state.

Add these keys under `settings.general.about` in all three locales:

```ts
// en.ts
updateAvailable: '{{version}} available',
releaseNotes: 'Release notes',
upgradeHow: 'To upgrade, run these in your install directory:',
checkForUpdates: 'Check for updates',
lastChecked: 'Last checked {{when}}',
neverChecked: 'Never checked',
```

```ts
// fr.ts
updateAvailable: '{{version}} disponible',
releaseNotes: 'Notes de version',
upgradeHow: 'Pour mettre à jour, exécutez ceci dans votre répertoire d’installation :',
checkForUpdates: 'Rechercher des mises à jour',
lastChecked: 'Dernière vérification {{when}}',
neverChecked: 'Jamais vérifié',
```

```ts
// pt.ts
updateAvailable: '{{version}} disponível',
releaseNotes: 'Notas da versão',
upgradeHow: 'Para atualizar, execute isto na pasta de instalação:',
checkForUpdates: 'Procurar atualizações',
lastChecked: 'Última verificação {{when}}',
neverChecked: 'Nunca verificado',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/General.test.tsx src/i18n/parity.test.ts`
Expected: PASS. `parity.test.ts` proves the keys landed in all three locales.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): show the available version and how to upgrade"
```

---

## Task 6: `openldr update check`

**Files:**
- Create: `packages/cli/src/update.ts`, `packages/cli/src/update.test.ts`
- Modify: `packages/cli/src/program.ts`

**Interfaces:**
- Consumes: `UpdateState` (Task 1).
- Produces: the CLI command.

**Context:** the pattern is `packages/cli/src/errors.ts` — a pure `renderX` plus a `runX` that
writes and returns an exit code — registered in `program.ts` with
`program.command('update').command('check')`.

**Exit codes are the contract:** 0 when current, 1 when an update exists, so it can be scripted.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/update.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderUpdateCheck } from './update';
import type { UpdateState } from '@openldr/bootstrap';

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  enabled: true, running: '0.1.1', latestVersion: '0.2.0', releasedAt: '2026-08-20',
  notesUrl: 'https://example.org/x', firstSeenAt: '2026-08-20T10:00:00.000Z',
  lastCheckedAt: '2026-08-20T10:00:00.000Z', lastError: null, updateAvailable: true, ...over,
});

describe('renderUpdateCheck', () => {
  it('names both versions and the two commands when an update exists', () => {
    const { text, code } = renderUpdateCheck(state(), { json: false });
    expect(text).toMatch(/0\.1\.1/);
    expect(text).toMatch(/0\.2\.0/);
    expect(text).toMatch(/docker compose pull/);
    expect(text).toMatch(/docker compose up -d/);
    expect(code).toBe(1);
  });

  it('exits 0 and shows no commands when current', () => {
    const { text, code } = renderUpdateCheck(state({ running: '0.2.0', updateAvailable: false }), { json: false });
    expect(code).toBe(0);
    expect(text).not.toMatch(/docker compose pull/);
  });

  it('says so when the check is disabled, and exits 0', () => {
    const { text, code } = renderUpdateCheck(state({ enabled: false, updateAvailable: false }), { json: false });
    expect(text).toMatch(/disabled/i);
    expect(code).toBe(0);
  });

  it('reports a failed check rather than implying the install is current', () => {
    const { text } = renderUpdateCheck(state({ updateAvailable: false, latestVersion: null, lastError: 'ENOTFOUND' }), { json: false });
    expect(text).toMatch(/ENOTFOUND/);
  });

  it('emits the raw state as JSON when asked', () => {
    const { text } = renderUpdateCheck(state(), { json: true });
    expect(JSON.parse(text)).toMatchObject({ running: '0.1.1', latestVersion: '0.2.0' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/cli exec vitest run src/update.test.ts`
Expected: FAIL — `Failed to resolve import "./update"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/update.ts`:

```ts
import type { UpdateState } from '@openldr/bootstrap';

/** Pure: state in, text and exit code out. Exit 1 means "an update exists" so this can be
 *  scripted; it is not an error. */
export function renderUpdateCheck(state: UpdateState, opts: { json: boolean }): { text: string; code: number } {
  if (opts.json) return { text: JSON.stringify(state, null, 2), code: state.updateAvailable ? 1 : 0 };

  const lines = [`running:   ${state.running}`];
  if (!state.enabled) {
    lines.push('update check is disabled (Settings → General, or `openldr settings set update.enabled true`)');
    return { text: lines.join('\n'), code: 0 };
  }
  lines.push(`published: ${state.latestVersion ?? 'unknown'}`);
  if (state.lastError) lines.push(`last check failed: ${state.lastError}`);
  if (state.updateAvailable) {
    lines.push('', `${state.latestVersion} is available. To upgrade, run these in your install directory:`, '', '  docker compose pull', '  docker compose up -d');
    if (state.notesUrl) lines.push('', `release notes: ${state.notesUrl}`);
    return { text: lines.join('\n'), code: 1 };
  }
  if (state.latestVersion) lines.push('', 'this install is up to date.');
  return { text: lines.join('\n'), code: 0 };
}
```

Register in `packages/cli/src/program.ts`, following the `errors` block at line 72:

```ts
  const update = program.command('update').description('Version and update checks');
  update
    .command('check')
    .description('Report whether a newer OpenLDR version has been published')
    .option('--json', 'emit raw JSON', false)
    .action(async (opts: { json: boolean }) => {
      const ctx = await buildCtx();
      const state = await createUpdateCheck(ctx.appSettings).read(readAppVersion());
      const { text, code } = renderUpdateCheck(state, opts);
      process.stdout.write(text + '\n');
      process.exitCode = code;
    });
```

Match `buildCtx()` and the version helper to whatever the neighbouring commands in this file
already use — do not invent a new bootstrapping path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/cli exec vitest run src/update.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/update.ts packages/cli/src/update.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): openldr update check"
```

---

## Task 7: Docs, in three languages

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/settings.md`
- Modify: `RELEASE.md`

**Context:** `apps/studio/src/docs/0.1.0/` has only an `en/` folder; the registry falls back to
English for fr and pt (`packages/.../registry.ts:351`). **Do not create fr/ and pt/ folders** —
that would mean translating all 19 guides and is out of scope. Write the English doc; the
existing fallback covers the other locales, exactly as it does for every other guide today.

The i18n that DOES need all three locales is the UI strings, and those landed in Task 5.

- [ ] **Step 1: Document the switch and what it discloses**

Add to `apps/studio/src/docs/0.1.0/en/settings.md`, under the General section:

```markdown
## Update checks

**Settings → General** shows the version this install is running, and — when one exists — the
newer version that has been published, with the two commands to upgrade.

The check is **on by default**. It fetches a small file from GitHub once a day and compares
version numbers. It never downloads an image and never restarts anything; upgrading is always
something you do yourself.

**What the check sends:** nothing but an ordinary web request for a public file. No site name, no
version, no identifier. As with any web request, the server that answers it can see your
network's IP address and the time you asked.

**To turn it off,** switch off *Check for updates* in **Settings → General**. The install then
makes no outbound request at all, and the version line shows only what you are running. An
air-gapped lab can leave it on — a failed check is silent, and the last known answer is kept.

**From the command line:** `openldr update check` prints the same information, and exits 1 when
an update is available so it can be scripted.
```

- [ ] **Step 2: Note the coupling in RELEASE.md**

Add under "Cutting a release":

```markdown
### Installs learn about a release from `latest.json`

The update check in **Settings → General** reads the `latest.json` attached to the newest
release. It follows `releases/latest`, so it needs no change per release — but it means an
install only learns about versions published *after* the release that gave it the update check.
```

- [ ] **Step 3: Verify the docs tests still pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS. `validation.test.ts` checks doc structure and image references.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs RELEASE.md
git commit -m "docs: the update check, and what it sends"
```

---

## Task 8: Full gate

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run test`
Expected: all packages pass.

A failure here is usually a load timeout, not a regression. Re-run the failing package alone
before blaming a change (CLAUDE.md).

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm turbo run typecheck`
Expected: clean.

Run: `pnpm --filter @openldr/server lint`
Expected: clean. This is the only package with real lint.

- [ ] **Step 3: Check the studio at 375×812**

The About card gained a `<pre>` with two commands. A `<pre>` does not wrap, so confirm it
scrolls inside its own container rather than widening the page. Use `resize_window` at 375×812
and check `document.documentElement.scrollWidth === clientWidth`.

- [ ] **Step 4: State what was not proven**

In the completion report, plainly:

- `latest.json` does not exist yet. **Every test is against a fixture, and the live fetch has
  never run.** It is proven when `0.1.1` publishes the file, and not before.
- The 24-hour timer is tested with fake timers, not by waiting.
- Nothing verifies that GitHub's `releases/latest/download/` redirect behaves as expected for an
  unauthenticated client, because there is no release to redirect to.

---

## Self-review notes

**Spec coverage.** Cache and decision → Task 1. Poll policy, silent failure, the URL → Task 2.
The three bell traps → Task 3. Server wiring, the switch, `/api/update` → Task 4. About card,
inline commands, i18n in three locales → Task 5. CLI parity → Task 6. Docs and the telemetry
disclosure → Task 7. Gate and mobile → Task 8.

**The one structural change.** Task 2 moves `manifest.ts` from `packages/release` into
`@openldr/core/pure`. Without it `@openldr/bootstrap` would have to depend on `packages/release`,
which is maintainer tooling that must never ship inside a runtime image. Copying the parser
instead would give two things that can disagree about a wire format — the exact failure the spec
forbids for version comparison.

**Deliberately not covered, matching the spec's Out of scope:** auto-apply, the Docker socket,
the `minio`/`mc`/`certbot` moving tags, downgrade guidance, and the two existing
`compareVersions` copies.
