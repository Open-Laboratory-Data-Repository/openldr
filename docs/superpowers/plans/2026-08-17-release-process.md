# A release you can point an operator at — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm release` publishes an immutable version — five images, a verified GitHub release, and a `latest.json` asset — and refuses to publish a broken one.

**Architecture:** Pure decision logic lives in tested packages; `scripts/release.ts` is a thin
orchestrator that gathers facts (git state, registry state) and feeds them to those functions.
Semver comparison goes in `@openldr/core` because Project B's update checker needs the identical
comparison — two implementations that disagree would publish releases B never announces.

**Tech Stack:** TypeScript, vitest, tsx, bash + PowerShell (installers), docker buildx, GitHub
Packages API via `gh`.

**Spec:** `docs/superpowers/specs/2026-08-17-release-process-design.md`

## Global Constraints

- **A `vX.Y.Z` tag exists only if that release is complete and verified.** The tag is pushed at
  step 10, after images are confirmed public and pullable. Never earlier.
- **`latest.json` has exactly three fields:** `version`, `releasedAt`, `notesUrl`. No others.
  Project B reads only these.
- **The installer never writes the word `latest` by default.** On a failed resolve it stops and
  prints the exact `--version` command; it must not silently fall back.
- **Test gate is `pnpm turbo run test`, never piped through `tail`** (CLAUDE.md). A failure is
  usually a timeout — re-run the failing package alone before treating it as real.
- **No `Co-Authored-By` trailers** in commits (AGENTS.md §9).
- **Never claim done without the command and its output** (AGENTS.md §1).
- Per-package test command: `pnpm --filter <pkg> exec vitest run <path>`

## Prerequisite — confirm before starting Task 4

Tasks 4, 5 and 8 need a GitHub token with `read:packages`, `write:packages`, and the scope that
sets package visibility. Measured 2026-08-17: the available `gh` token 403s with
`You need at least read:packages scope` on all five packages.

**Tasks 1, 2, 3, 6 and 7 do not need it** and can be built first. Task 4 onward is blocked
without it. If the token is still missing when Task 4 starts, stop and report rather than
stubbing the registry calls — a stubbed overwrite guard is worse than none, because it looks
like protection.

**Also unknown:** whether `:0.1.0` is already pushed. If it is, the first real release must be
`0.1.1` or higher; precondition 4 will correctly refuse to overwrite it.

---

## File Structure

**Created:**
- `packages/core/src/semver.ts` — parse and compare `X.Y.Z`. Shared with Project B.
- `packages/core/src/semver.test.ts`
- `packages/release/` — new private workspace package for maintainer release tooling. Kept out
  of `@openldr/core` so it never ships inside a runtime image, and out of `packages/cli` so it
  never reaches the operator CLI.
  - `packages/release/package.json`, `tsconfig.json`
  - `src/manifest.ts` + `src/manifest.test.ts` — the `latest.json` shape.
  - `src/preconditions.ts` + `src/preconditions.test.ts` — pure refusal logic.
  - `src/registry.ts` + `src/registry.test.ts` — GHCR tag existence and visibility, injected fetch.
  - `src/index.ts`
  - `src/shell.test.ts` — the shell harness. Shells out to the real scripts.
- `scripts/release.ts` — the orchestrator. Thin.
- `install/lib/resolve-version.sh` — `resolve_version <url>`, sourceable and therefore testable.
- `install/lib/Resolve-Version.ps1` — the PowerShell twin.

**Modified:**
- `packages/core/src/index.ts`, `packages/core/src/pure.ts` — export `./semver`.
- `scripts/build-and-push.sh` — overwrite guard.
- `install/install.sh`, `install/install.ps1` — resolve `latest.json` to a concrete version.
- `package.json` — add the `release` script.
- `RELEASE.md` — rewrite around the new command.

**Why `packages/release` rather than a bare script:** nothing under `scripts/` is currently
tested (`find scripts -name "*.test.ts"` → empty). The spec requires each precondition's refusal
to be tested, and a package is the smallest thing that gives vitest a place to run. This mirrors
the changelog precedent — logic in `apps/web/src/landing/changelog-model.ts`, thin wrapper in
`scripts/make-changelog.ts`.

**Shell harness (operator decision, 2026-08-17).** The spec left Tasks 6 and 7 with manual
verification only. The operator overrode that: the shell paths get real assertions, because the
installer's fail-loud path is the behaviour most likely to regress silently and be noticed only
by a lab.

No new tool — `src/shell.test.ts` is vitest shelling out with `execFileSync`, using the
`git-bash` already required to run these scripts. Two things make the scripts testable:

- The installer's resolve logic moves into `install/lib/resolve-version.sh` (and its PowerShell
  twin), which `install.sh` sources. A sourceable function can be called directly; an inline
  block inside a 400-line installer cannot.
- The fixture is served over `file://`, which `curl` handles natively, so no test needs a
  network or a published `latest.json`.

`bats` was considered and rejected — it is a second test runner for two files, and the repo
already standardises on vitest everywhere.

---

## Task 1: Shared semver comparison

**Files:**
- Create: `packages/core/src/semver.ts`
- Test: `packages/core/src/semver.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/pure.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, used by Tasks 3, 5, 7 and later by Project B:
  - `parseSemver(input: string): Semver | null`
  - `compareSemver(a: string, b: string): number`
  - `isNewerVersion(candidate: string, current: string): boolean`
  - `interface Semver { major: number; minor: number; patch: number }`

**Context:** `compareVersions` already exists twice — `apps/web/src/docs/content.ts` and
`apps/studio/src/docs/version.ts`. **Do not refactor those**; that is unrelated to this goal
(AGENTS.md §4). This task adds one shared implementation so a third private copy is not created.

`pure.ts` is the browser-safe subset and must stay free of Node built-ins. `semver.ts` is pure
string arithmetic, so it belongs in both entrypoints, following how `canonical-json` is listed
in each.

**Design note to honour:** `isNewerVersion` returns `false` when either input is unparseable.
That is the safe default — never announce an update you could not verify. `compareSemver`
throws on unparseable input instead, because a release script must fail loudly rather than
silently treat a malformed version as equal.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/semver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSemver, compareSemver, isNewerVersion } from './semver';

describe('parseSemver', () => {
  it('parses a plain X.Y.Z', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('accepts the v prefix that git tags carry', () => {
    expect(parseSemver('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 });
  });

  it('rejects a two-part version', () => {
    expect(parseSemver('0.1')).toBeNull();
  });

  it('rejects a prerelease suffix — out of scope, and silently dropping it would mislead', () => {
    expect(parseSemver('1.0.0-rc1')).toBeNull();
  });

  it('rejects a non-numeric part', () => {
    expect(parseSemver('1.x.3')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  // The case that bites every naive string compare.
  it('orders 0.10.0 above 0.2.0', () => {
    expect(compareSemver('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareSemver('0.10.0', '0.2.0')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions, v prefix or not', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });

  it('compares major before minor before patch', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareSemver('1.1.2', '1.1.1')).toBeGreaterThan(0);
  });

  it('throws on unparseable input rather than guessing', () => {
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(/1\.0/);
  });
});

describe('isNewerVersion', () => {
  it('is true only when the candidate is strictly greater', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });

  // Never announce an update you could not verify.
  it('is false when either side is unparseable', () => {
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.2.0', 'garbage')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/core exec vitest run src/semver.test.ts`
Expected: FAIL — `Failed to resolve import "./semver"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/semver.ts`:

```ts
/** Strict MAJOR.MINOR.PATCH, with the optional leading `v` that git tags carry.
 *
 * Prereleases (`1.0.0-rc1`) are deliberately rejected rather than tolerated. The release
 * process publishes only plain versions, and silently dropping a suffix would let `1.0.0-rc1`
 * and `1.0.0` compare equal — which would let a release candidate satisfy the "version was
 * bumped" precondition. */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(input: string): Semver | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Negative when a < b, 0 when equal, positive when a > b.
 *  Throws on unparseable input: a release script must fail loudly, not treat garbage as equal. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa) throw new Error(`not a version: ${a}`);
  if (!pb) throw new Error(`not a version: ${b}`);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/** True only when `candidate` is strictly greater than `current`.
 *  Returns false when either side is unparseable — never announce an update you cannot verify. */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!parseSemver(candidate) || !parseSemver(current)) return false;
  return compareSemver(candidate, current) > 0;
}
```

Add to `packages/core/src/index.ts`, after the existing `export * from './canonical-hash';`:

```ts
export * from './semver';
```

Add to `packages/core/src/pure.ts`, after the existing `export * from './canonical-json';`:

```ts
export * from './semver';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/core exec vitest run src/semver.test.ts`
Expected: PASS, 12 tests.

Then confirm the barrel additions did not break consumers:

Run: `pnpm --filter @openldr/core typecheck`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/semver.ts packages/core/src/semver.test.ts packages/core/src/index.ts packages/core/src/pure.ts
git commit -m "feat(core): shared semver comparison for the release process and update checks"
```

---

## Task 2: The `packages/release` package and the `latest.json` model

**Files:**
- Create: `packages/release/package.json`, `packages/release/tsconfig.json`
- Create: `packages/release/src/manifest.ts`, `packages/release/src/manifest.test.ts`
- Create: `packages/release/src/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1 yet.
- Produces, used by Task 5:
  - `interface ReleaseManifest { version: string; releasedAt: string; notesUrl: string }`
  - `buildReleaseManifest(input: { version: string; releasedAt: string; owner: string; repo: string }): ReleaseManifest`
  - `parseReleaseManifest(raw: unknown): ReleaseManifest | null`

**Context:** copy `packages/core/package.json` as the template — same `type: module`, same
`vitest run` test script, same `tsc --noEmit` typecheck, same `"lint": "echo \"no lint\""`.
`private: true` and **no app may depend on it**.

`parseReleaseManifest` exists because Project B will parse this file from the network, where the
input is untrusted. Writing the parser here, next to the writer, is what keeps the two honest.

- [ ] **Step 1: Write the failing test**

Create `packages/release/src/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReleaseManifest, parseReleaseManifest } from './manifest';

describe('buildReleaseManifest', () => {
  it('builds exactly the three fields, with the notes URL pointing at the v-prefixed tag', () => {
    const m = buildReleaseManifest({
      version: '0.2.0',
      releasedAt: '2026-08-20',
      owner: 'Open-Laboratory-Data-Repository',
      repo: 'openldr',
    });
    expect(m).toEqual({
      version: '0.2.0',
      releasedAt: '2026-08-20',
      notesUrl: 'https://github.com/Open-Laboratory-Data-Repository/openldr/releases/tag/v0.2.0',
    });
  });

  // The spec fixes the shape at three fields; a fourth would be read by nothing and mislead.
  it('emits no other keys', () => {
    const m = buildReleaseManifest({ version: '1.0.0', releasedAt: '2026-01-01', owner: 'o', repo: 'r' });
    expect(Object.keys(m).sort()).toEqual(['notesUrl', 'releasedAt', 'version']);
  });

  it('refuses a version it cannot parse', () => {
    expect(() => buildReleaseManifest({ version: 'latest', releasedAt: '2026-01-01', owner: 'o', repo: 'r' }))
      .toThrow(/latest/);
  });

  it('refuses a releasedAt that is not YYYY-MM-DD', () => {
    expect(() => buildReleaseManifest({ version: '1.0.0', releasedAt: '20 Aug 2026', owner: 'o', repo: 'r' }))
      .toThrow(/releasedAt/);
  });
});

describe('parseReleaseManifest', () => {
  const valid = {
    version: '0.2.0',
    releasedAt: '2026-08-20',
    notesUrl: 'https://github.com/o/r/releases/tag/v0.2.0',
  };

  it('accepts a valid manifest', () => {
    expect(parseReleaseManifest(valid)).toEqual(valid);
  });

  it('ignores unknown keys rather than failing, so adding a field later cannot break old installs', () => {
    expect(parseReleaseManifest({ ...valid, futureField: 1 })).toEqual(valid);
  });

  it('rejects a missing field', () => {
    expect(parseReleaseManifest({ version: '0.2.0', releasedAt: '2026-08-20' })).toBeNull();
  });

  it('rejects a wrong type', () => {
    expect(parseReleaseManifest({ ...valid, version: 2 })).toBeNull();
  });

  it('rejects an unparseable version', () => {
    expect(parseReleaseManifest({ ...valid, version: 'latest' })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseReleaseManifest(null)).toBeNull();
    expect(parseReleaseManifest('0.2.0')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

The package does not exist yet, so create the scaffold first.

Create `packages/release/package.json`:

```json
{
  "name": "@openldr/release",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "echo \"no lint\""
  },
  "dependencies": {
    "@openldr/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/release/tsconfig.json` by copying `packages/core/tsconfig.json` verbatim.

Create `packages/release/src/index.ts`:

```ts
export * from './manifest';
```

Then:

Run: `pnpm install`
Run: `pnpm --filter @openldr/release exec vitest run src/manifest.test.ts`
Expected: FAIL — `Failed to resolve import "./manifest"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/release/src/manifest.ts`:

```ts
import { parseSemver } from '@openldr/core/pure';

/** The published `latest.json`. Exactly three fields — Project B reads only these. */
export interface ReleaseManifest {
  version: string;
  releasedAt: string;
  notesUrl: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildReleaseManifest(input: {
  version: string;
  releasedAt: string;
  owner: string;
  repo: string;
}): ReleaseManifest {
  if (!parseSemver(input.version)) throw new Error(`not a version: ${input.version}`);
  if (!DATE_RE.test(input.releasedAt)) throw new Error(`releasedAt must be YYYY-MM-DD: ${input.releasedAt}`);
  return {
    version: input.version,
    releasedAt: input.releasedAt,
    notesUrl: `https://github.com/${input.owner}/${input.repo}/releases/tag/v${input.version}`,
  };
}

/** Parse a manifest fetched from the network. Returns null rather than throwing: a malformed
 *  file must degrade to "no update known", never to a crash in the consumer.
 *
 *  Unknown keys are ignored on purpose — adding a fourth field in a future release must not
 *  break installs running today's parser. */
export function parseReleaseManifest(raw: unknown): ReleaseManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || typeof r.releasedAt !== 'string' || typeof r.notesUrl !== 'string') {
    return null;
  }
  if (!parseSemver(r.version)) return null;
  if (!DATE_RE.test(r.releasedAt)) return null;
  return { version: r.version, releasedAt: r.releasedAt, notesUrl: r.notesUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/release exec vitest run src/manifest.test.ts`
Expected: PASS, 10 tests.

Run: `pnpm --filter @openldr/release typecheck`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/release pnpm-lock.yaml
git commit -m "feat(release): the latest.json manifest, with a parser for untrusted input"
```

---

## Task 3: Precondition evaluation

**Files:**
- Create: `packages/release/src/preconditions.ts`, `packages/release/src/preconditions.test.ts`
- Modify: `packages/release/src/index.ts`

**Interfaces:**
- Consumes: `isNewerVersion` from Task 1.
- Produces, used by Task 5:
  - `interface ReleaseFacts { version: string; lastTag: string | null; treeClean: boolean; branch: string; syncedWithOrigin: boolean; gitTagExists: boolean; registryTagExists: boolean; changelogCommitted: boolean; gateGreen: boolean }`
  - `evaluatePreconditions(facts: ReleaseFacts): string[]` — empty means clear to publish; each
    string is one operator-readable refusal.

**Why pure:** every refusal is testable without a git repo, a registry, or a network. The
orchestrator in Task 5 gathers the facts; this decides. That split is the only reason each
refusal can have a test.

**Refusal messages are the user interface of this feature.** Each one names what is wrong and
what to do about it. Write them as the operator will read them at 2am.

- [ ] **Step 1: Write the failing test**

Create `packages/release/src/preconditions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluatePreconditions, type ReleaseFacts } from './preconditions';

const clean: ReleaseFacts = {
  version: '0.2.0',
  lastTag: 'v0.1.0',
  treeClean: true,
  branch: 'main',
  syncedWithOrigin: true,
  gitTagExists: false,
  registryTagExists: false,
  changelogCommitted: true,
  gateGreen: true,
};

describe('evaluatePreconditions', () => {
  it('returns no refusals when everything is in order', () => {
    expect(evaluatePreconditions(clean)).toEqual([]);
  });

  it('refuses a dirty working tree', () => {
    const r = evaluatePreconditions({ ...clean, treeClean: false });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/working tree/i);
  });

  it('refuses a branch other than main', () => {
    expect(evaluatePreconditions({ ...clean, branch: 'feat/x' })[0]).toMatch(/main/);
  });

  it('refuses when local and origin have diverged', () => {
    expect(evaluatePreconditions({ ...clean, syncedWithOrigin: false })[0]).toMatch(/origin/i);
  });

  it('refuses when the version was not bumped past the last tag', () => {
    const r = evaluatePreconditions({ ...clean, version: '0.1.0', lastTag: 'v0.1.0' });
    expect(r[0]).toMatch(/0\.1\.0/);
    expect(r[0]).toMatch(/package\.json/);
  });

  it('refuses when the version went backwards', () => {
    expect(evaluatePreconditions({ ...clean, version: '0.0.9', lastTag: 'v0.1.0' })).toHaveLength(1);
  });

  it('allows the very first release, when no tag exists yet', () => {
    expect(evaluatePreconditions({ ...clean, lastTag: null })).toEqual([]);
  });

  it('refuses when the git tag already exists', () => {
    expect(evaluatePreconditions({ ...clean, gitTagExists: true })[0]).toMatch(/v0\.2\.0/);
  });

  // The overwrite guard — the reason this task exists.
  it('refuses when the version tag is already in the registry', () => {
    const r = evaluatePreconditions({ ...clean, registryTagExists: true });
    expect(r[0]).toMatch(/registry/i);
    expect(r[0]).toMatch(/0\.2\.0/);
  });

  it('refuses when the changelog was not regenerated', () => {
    expect(evaluatePreconditions({ ...clean, changelogCommitted: false })[0]).toMatch(/changelog/i);
  });

  it('refuses when the test gate is red', () => {
    expect(evaluatePreconditions({ ...clean, gateGreen: false })[0]).toMatch(/test/i);
  });

  it('reports every refusal at once, not just the first', () => {
    const r = evaluatePreconditions({ ...clean, treeClean: false, gateGreen: false, gitTagExists: true });
    expect(r).toHaveLength(3);
  });

  it('refuses a version string it cannot parse', () => {
    expect(evaluatePreconditions({ ...clean, version: 'latest' })[0]).toMatch(/latest/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/release exec vitest run src/preconditions.test.ts`
Expected: FAIL — `Failed to resolve import "./preconditions"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/release/src/preconditions.ts`:

```ts
import { isNewerVersion, parseSemver } from '@openldr/core/pure';

export interface ReleaseFacts {
  /** The version in package.json — the single source of truth for what is being released. */
  version: string;
  /** Newest existing v* tag, or null for the very first release. */
  lastTag: string | null;
  treeClean: boolean;
  branch: string;
  syncedWithOrigin: boolean;
  gitTagExists: boolean;
  registryTagExists: boolean;
  changelogCommitted: boolean;
  gateGreen: boolean;
}

/** Every reason this release must not proceed. Empty means clear to publish.
 *
 *  All checks run — the operator sees every problem at once rather than fixing them one
 *  round-trip at a time. */
export function evaluatePreconditions(f: ReleaseFacts): string[] {
  const refusals: string[] = [];

  if (!parseSemver(f.version)) {
    refusals.push(`package.json version is not a X.Y.Z version: ${f.version}`);
  }
  if (!f.treeClean) {
    refusals.push('working tree is dirty — commit or stash before releasing');
  }
  if (f.branch !== 'main') {
    refusals.push(`releases are cut from main, not ${f.branch}`);
  }
  if (!f.syncedWithOrigin) {
    refusals.push('local main and origin/main differ — push or pull before releasing');
  }
  if (f.lastTag !== null && !isNewerVersion(f.version, f.lastTag)) {
    refusals.push(
      `package.json version ${f.version} is not newer than the last tag ${f.lastTag} — bump it first`,
    );
  }
  if (f.gitTagExists) {
    refusals.push(`tag v${f.version} already exists — a released version is never re-cut`);
  }
  if (f.registryTagExists) {
    refusals.push(
      `image tag ${f.version} is already in the registry — overwriting it would change what ` +
        `that version means for every install already running it`,
    );
  }
  if (!f.changelogCommitted) {
    refusals.push('landing changelog is stale — run pnpm make:changelog and commit it (AGENTS.md §6)');
  }
  if (!f.gateGreen) {
    refusals.push('test gate is red — releases are cut from a green gate only');
  }

  return refusals;
}
```

Add to `packages/release/src/index.ts`:

```ts
export * from './preconditions';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/release exec vitest run src/preconditions.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/release/src/preconditions.ts packages/release/src/preconditions.test.ts packages/release/src/index.ts
git commit -m "feat(release): precondition checks that refuse a broken release"
```

---

## Task 4: GHCR tag existence and visibility

⚠ **Blocked without the token described in the Prerequisite section.** The unit tests below
inject a fake fetch and pass without any credential, but the functions are unusable in Task 5
until the token exists. If it does not, stop and report.

**Files:**
- Create: `packages/release/src/registry.ts`, `packages/release/src/registry.test.ts`
- Modify: `packages/release/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, used by Task 5:
  - `type FetchJson = (path: string) => Promise<unknown>`
  - `IMAGE_NAMES: readonly string[]` — the five image basenames.
  - `tagExistsInRegistry(fetchJson: FetchJson, org: string, image: string, tag: string): Promise<boolean>`
  - `findPrivatePackages(fetchJson: FetchJson, org: string, images: readonly string[]): Promise<string[]>`

**Context:** `fetchJson` takes a GitHub API path (no leading slash — `gh api` rewrites paths
that start with `/` into filesystem paths on Windows Git Bash; measured 2026-08-17) and returns
parsed JSON. Task 5 supplies the real one; the tests supply a fake. That injection is what makes
this testable without a network or a token.

Endpoints used:
- `orgs/{org}/packages/container/{image}/versions` → array; tags at `.metadata.container.tags`.
- `orgs/{org}/packages/container/{image}` → object; visibility at `.visibility`.

**`findPrivatePackages` returns the names that are private, not a boolean.** A release that
leaves one image private is indistinguishable from a release that never happened — a single
private image 401s and aborts the whole `docker compose pull`. The operator needs to be told
*which* one.

- [ ] **Step 1: Write the failing test**

Create `packages/release/src/registry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tagExistsInRegistry, findPrivatePackages, IMAGE_NAMES } from './registry';

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (path: string) => {
    if (!(path in routes)) throw new Error(`unexpected path: ${path}`);
    const v = routes[path];
    if (v instanceof Error) throw v;
    return v;
  });
}

describe('IMAGE_NAMES', () => {
  it('is the five images the compose file pins', () => {
    expect([...IMAGE_NAMES]).toEqual([
      'openldr-api', 'openldr-studio', 'openldr-web', 'openldr-gateway', 'openldr-keycloak',
    ]);
  });
});

describe('tagExistsInRegistry', () => {
  const path = 'orgs/acme/packages/container/openldr-api/versions';

  it('is true when the tag is present', async () => {
    const f = fakeFetch({ [path]: [{ metadata: { container: { tags: ['latest', '0.1.0'] } } }] });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).toBe(true);
  });

  it('is false when the tag is absent', async () => {
    const f = fakeFetch({ [path]: [{ metadata: { container: { tags: ['latest'] } } }] });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.2.0')).toBe(false);
  });

  it('is false when the package does not exist yet — the first release of a new image', async () => {
    const f = vi.fn(async () => { throw new Error('HTTP 404: Not Found'); });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).toBe(false);
  });

  // A 403 must never read as "tag is free" — that is how an overwrite guard silently disarms.
  it('rethrows a permission error rather than reporting the tag as absent', async () => {
    const f = vi.fn(async () => { throw new Error('You need at least read:packages scope (HTTP 403)'); });
    await expect(tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).rejects.toThrow(/read:packages/);
  });

  it('tolerates a version entry with no tags array', async () => {
    const f = fakeFetch({ [path]: [{ metadata: {} }, { metadata: { container: { tags: ['0.1.0'] } } }] });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).toBe(true);
  });
});

describe('findPrivatePackages', () => {
  it('returns the names of the private ones', async () => {
    const f = fakeFetch({
      'orgs/acme/packages/container/a': { visibility: 'public' },
      'orgs/acme/packages/container/b': { visibility: 'private' },
      'orgs/acme/packages/container/c': { visibility: 'private' },
    });
    expect(await findPrivatePackages(f, 'acme', ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });

  it('returns empty when all are public', async () => {
    const f = fakeFetch({
      'orgs/acme/packages/container/a': { visibility: 'public' },
      'orgs/acme/packages/container/b': { visibility: 'public' },
    });
    expect(await findPrivatePackages(f, 'acme', ['a', 'b'])).toEqual([]);
  });

  // Unreadable is not the same as public. Treating it as public is how the trap fires.
  it('reports a package whose visibility cannot be read', async () => {
    const f = fakeFetch({ 'orgs/acme/packages/container/a': { notVisibility: true } });
    expect(await findPrivatePackages(f, 'acme', ['a'])).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/release exec vitest run src/registry.test.ts`
Expected: FAIL — `Failed to resolve import "./registry"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/release/src/registry.ts`:

```ts
/** Reads a GitHub API path and returns parsed JSON.
 *
 *  Paths must NOT start with '/': `gh api` on Windows Git Bash rewrites a leading slash into a
 *  filesystem path and fails with "invalid API endpoint" (measured 2026-08-17). */
export type FetchJson = (path: string) => Promise<unknown>;

/** The five images `deploy/install/docker-compose.yml` pins to ${OPENLDR_VERSION}. */
export const IMAGE_NAMES = [
  'openldr-api',
  'openldr-studio',
  'openldr-web',
  'openldr-gateway',
  'openldr-keycloak',
] as const;

function isNotFound(err: unknown): boolean {
  return /\b404\b|not found/i.test(err instanceof Error ? err.message : String(err));
}

/** True when `tag` is already published for `image`.
 *
 *  A missing package means the tag is free — that is the first release of a new image. Any
 *  OTHER error rethrows: a 403 reported as "absent" would silently disarm the overwrite guard,
 *  which is the one thing this function exists to prevent. */
export async function tagExistsInRegistry(
  fetchJson: FetchJson,
  org: string,
  image: string,
  tag: string,
): Promise<boolean> {
  let versions: unknown;
  try {
    versions = await fetchJson(`orgs/${org}/packages/container/${image}/versions`);
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
  if (!Array.isArray(versions)) return false;
  return versions.some((v) => {
    const tags = (v as { metadata?: { container?: { tags?: unknown } } })?.metadata?.container?.tags;
    return Array.isArray(tags) && tags.includes(tag);
  });
}

/** The images that are NOT confirmed public.
 *
 *  Anything whose visibility cannot be read counts as private. New GHCR packages default to
 *  private, and one private image 401s and aborts the entire `docker compose pull` — so an
 *  unreadable answer must never be optimistically treated as public. */
export async function findPrivatePackages(
  fetchJson: FetchJson,
  org: string,
  images: readonly string[],
): Promise<string[]> {
  const bad: string[] = [];
  for (const image of images) {
    const pkg = (await fetchJson(`orgs/${org}/packages/container/${image}`)) as { visibility?: unknown };
    if (pkg?.visibility !== 'public') bad.push(image);
  }
  return bad;
}
```

Add to `packages/release/src/index.ts`:

```ts
export * from './registry';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/release exec vitest run src/registry.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/release/src/registry.ts packages/release/src/registry.test.ts packages/release/src/index.ts
git commit -m "feat(release): GHCR tag-existence and visibility probes"
```

---

## Task 5: The `pnpm release` orchestrator

**Files:**
- Create: `scripts/release.ts`
- Modify: `package.json` (add the `release` script)

**Interfaces:**
- Consumes: `evaluatePreconditions`, `ReleaseFacts` (Task 3); `tagExistsInRegistry`,
  `findPrivatePackages`, `IMAGE_NAMES`, `FetchJson` (Task 4); `buildReleaseManifest` (Task 2).
- Produces: the `pnpm release` command. Nothing imports this.

**Context:** `scripts/make-changelog.ts` is the model for a thin script — it imports its logic
from a package and does only I/O. Follow it. This file gathers facts and sequences commands; it
must contain no decision logic that could have been unit-tested.

**Ordering is the safety property.** Local and reversible work first; irreversible last. Images
cannot be cleanly unpushed, so everything that can fail fails before the push. The git tag is
last, so a failure at verification leaves no tag — and therefore no half-release for any lab to
find.

`--dry-run` prints every command without running it, and still evaluates all preconditions. That
is the only way to exercise this before a real release exists.

- [ ] **Step 1: Write the script**

There is no unit test for this file — it is I/O and sequencing, and its decisions live in Tasks
2–4 where they are already tested. Its own verification is Step 2's dry run.

Create `scripts/release.ts`:

```ts
// Publishes a release: five images, a verified GitHub release, and a latest.json asset.
//
// The value of this script is what it refuses to do. Every precondition is checked before
// anything is pushed, and the git tag is created LAST — so a failure during verification leaves
// no tag behind, and no lab ever sees a half-release.
//
//   pnpm release            # publish
//   pnpm release --dry-run  # check preconditions, print commands, change nothing

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildReleaseManifest } from '../packages/release/src/manifest';
import { evaluatePreconditions, type ReleaseFacts } from '../packages/release/src/preconditions';
import { tagExistsInRegistry, findPrivatePackages, IMAGE_NAMES, type FetchJson } from '../packages/release/src/registry';

const OWNER = 'Open-Laboratory-Data-Repository';
const REPO = 'openldr';
const DRY_RUN = process.argv.includes('--dry-run');

function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function run(cmd: string, args: string[]): void {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  if (!DRY_RUN) execFileSync(cmd, args, { stdio: 'inherit' });
}

const ghJson: FetchJson = async (path) => JSON.parse(sh('gh', ['api', path]));

/** The newest v* tag by semver, or null for the first release. */
function newestTag(): string | null {
  const out = sh('git', ['tag', '--list', 'v*', '--sort=-v:refname']);
  return out ? out.split('\n')[0]!.trim() : null;
}

/** Green, or green on a lone re-run of the one package that failed.
 *
 *  Gate failures here are usually timeouts under parallel load, not regressions — measured
 *  2026-08-17, @openldr/forms store.test.ts took 41672ms under turbo and 752ms alone. Refusing
 *  on the first non-zero exit would block releases at random. A real failure still refuses:
 *  the isolated re-run has to pass too. */
function gateGreen(): boolean {
  try {
    execFileSync('pnpm', ['turbo', 'run', 'test'], { stdio: 'inherit' });
    return true;
  } catch {
    console.warn('\ngate failed — re-running the failing package alone to tell a timeout from a regression');
    const failed = process.env.RELEASE_RETRY_PKG;
    if (!failed) {
      console.error('set RELEASE_RETRY_PKG=<package> and re-run, or fix the failure');
      return false;
    }
    try {
      execFileSync('pnpm', ['--filter', failed, 'test'], { stdio: 'inherit' });
      console.warn(`${failed} passes alone — treating the turbo failure as a load timeout`);
      return true;
    } catch {
      return false;
    }
  }
}

async function main(): Promise<void> {
  const version = String(JSON.parse(sh('node', ['-p', 'JSON.stringify(require("./package.json"))'])).version);
  const lastTag = newestTag();

  console.log(`releasing ${version}${lastTag ? ` (last tag ${lastTag})` : ' (first release)'}`);

  const facts: ReleaseFacts = {
    version,
    lastTag,
    treeClean: sh('git', ['status', '--porcelain']) === '',
    branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    syncedWithOrigin: sh('git', ['rev-list', '--left-right', '--count', 'origin/main...main']) === '0\t0',
    gitTagExists: sh('git', ['tag', '--list', `v${version}`]) !== '',
    registryTagExists: await tagExistsInRegistry(ghJson, OWNER, 'openldr-api', version),
    changelogCommitted: sh('git', ['status', '--porcelain', 'apps/web/src/landing/changelog.json']) === '',
    gateGreen: gateGreen(),
  };

  const refusals = evaluatePreconditions(facts);
  if (refusals.length > 0) {
    console.error('\nrefusing to release:');
    for (const r of refusals) console.error(`  - ${r}`);
    process.exit(1);
  }
  console.log('preconditions clear\n');

  // 7. Build and push all five images.
  run('bash', ['scripts/build-and-push.sh', '--tag', 'latest']);

  // 8. Make every package public, then READ IT BACK. One private image aborts the whole pull.
  for (const image of IMAGE_NAMES) {
    run('gh', ['api', '--method', 'PATCH', `orgs/${OWNER}/packages/container/${image}`,
      '-f', 'visibility=public']);
  }
  if (!DRY_RUN) {
    const stillPrivate = await findPrivatePackages(ghJson, OWNER, IMAGE_NAMES);
    if (stillPrivate.length > 0) {
      console.error(`\nnot public after PATCH: ${stillPrivate.join(', ')}`);
      console.error('a single private image 401s and aborts the entire docker compose pull.');
      console.error('no tag was created — fix visibility and re-run.');
      process.exit(1);
    }
    console.log('all five packages confirmed public');
  }

  // 9. Verify by pulling the published tag into a clean directory.
  const probe = mkdtempSync(join(tmpdir(), 'openldr-release-'));
  run('bash', ['install/install.sh', '--dir', probe, '--version', version]);
  console.log(`verification install completed in ${probe}`);

  // 10. Only now is the release real: tag, push, publish.
  const manifest = buildReleaseManifest({
    version,
    releasedAt: new Date().toISOString().slice(0, 10),
    owner: OWNER,
    repo: REPO,
  });
  const manifestPath = join(probe, 'latest.json');
  console.log(`+ write ${manifestPath}`);
  if (!DRY_RUN) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  run('git', ['tag', `v${version}`]);
  run('git', ['push', 'origin', `v${version}`]);
  run('gh', ['release', 'create', `v${version}`, '--generate-notes',
    manifestPath, 'deploy/install/docker-compose.yml']);

  console.log(`\nreleased ${version}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

Add to `package.json` scripts, next to `"make:changelog"`:

```json
"release": "tsx scripts/release.ts",
```

- [ ] **Step 2: Verify the dry run refuses correctly**

The repo is currently at `package.json` version `0.1.0` with no `v*` tags, so a dry run should
reach the registry check. Run:

`pnpm release --dry-run`

Expected: it prints `releasing 0.1.0 (first release)`, runs the gate, then either prints
`preconditions clear` and the command list, or a `refusing to release:` block naming each
problem. **Either is a pass** — what must not happen is a crash or a silent success that skips
checks.

If it fails on `read:packages`, that is the Prerequisite section, not a bug in this task.

- [ ] **Step 3: Verify it refuses a dirty tree**

```bash
echo "scratch" > release-probe.txt
pnpm release --dry-run
rm release-probe.txt
```

Expected: refusal list includes `working tree is dirty — commit or stash before releasing`.

- [ ] **Step 4: Commit**

```bash
git add scripts/release.ts package.json
git commit -m "feat(release): pnpm release, with the git tag written last"
```

---

## Task 6: The overwrite guard in `build-and-push.sh`

**Files:**
- Modify: `scripts/build-and-push.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

**Why this exists separately from Task 3's guard.** `build-and-push.sh` is documented in
`RELEASE.md` as a standalone command and will be run standalone. A guard that lives only in
`pnpm release` leaves the direct path unprotected — which is the path someone reaches for when
`pnpm release` has just refused them.

`--allow-overwrite` is the deliberate escape hatch, for republishing a version that was never
announced.

- [ ] **Step 1: Add the guard**

In `scripts/build-and-push.sh`, add to the flag loop, after the `--dry-run` case:

```bash
    --allow-overwrite) ALLOW_OVERWRITE=true; shift ;;
```

Add to the defaults block, after `PUSH=true`:

```bash
ALLOW_OVERWRITE=false
```

Update the usage line in `-h|--help` to include `[--allow-overwrite]`.

Then, immediately after the existing `VERSION="$(node -p ...)"` line, insert:

```bash
# Refuse to overwrite a published version tag. A version tag that silently changes content is
# worse than :latest — :latest at least advertises that it moves, and readAppVersion() reports
# this same number in the studio's About card.
if [ "$PUSH" = true ] && [ "$ALLOW_OVERWRITE" = false ] && [ "$DRY_RUN" = false ]; then
  ORG="$(basename "$REGISTRY")"
  # `index()` yields the position or null; `// "absent"` turns null into a word, and the `|| echo
  # absent` covers a package that does not exist yet (the first release of a new image).
  FOUND="$(gh api "orgs/$ORG/packages/container/openldr-api/versions" \
             --jq '[.[].metadata.container.tags[]] | index("'"$VERSION"'") // "absent"' 2>/dev/null \
           || echo absent)"
  if [ "$FOUND" != "absent" ]; then
    echo "ERROR: $REGISTRY/openldr-api:$VERSION is already published." >&2
    echo "Bump the version in package.json, or pass --allow-overwrite if that tag was never announced." >&2
    exit 1
  fi
fi
```

- [ ] **Step 2: Add the guard's tests to the shell harness**

Append to `packages/release/src/shell.test.ts` (created in Task 7 — if Task 7 has not run yet,
create the file with just this block and its imports):

```ts
import { chmodSync } from 'node:fs';

/** Run build-and-push.sh with a fake `gh` first on PATH, so no network or token is involved. */
function buildAndPush(args: string[], ghStdout: string): { code: number; out: string } {
  const bin = mkdtempSync(join(tmpdir(), 'openldr-fakebin-'));
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/usr/bin/env bash\nprintf '%s\\n' '${ghStdout}'\n`);
  chmodSync(gh, 0o755);
  try {
    const out = execFileSync('bash', [join(REPO, 'scripts/build-and-push.sh').replace(/\\/g, '/'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('build-and-push.sh overwrite guard', () => {
  // The guard is the reason this change exists: a published version tag is immutable.
  it('refuses when the version tag is already published', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], '0');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already published/i);
  });

  it('names --allow-overwrite in the refusal, so the escape hatch is discoverable', () => {
    expect(buildAndPush(['--platform', 'linux/amd64'], '0').out).toMatch(/--allow-overwrite/);
  });

  it('does not fire on a dry run', () => {
    const r = buildAndPush(['--dry-run'], '0');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/docker buildx build/);
  });

  // "absent" is what the jq `// "absent"` fallback yields when the tag is not in the list.
  it('proceeds when the tag is absent', () => {
    expect(buildAndPush(['--dry-run'], 'absent').code).toBe(0);
  });

  it('does not fire with --no-push, since nothing can be overwritten', () => {
    expect(buildAndPush(['--no-push', '--dry-run'], '0').code).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @openldr/release exec vitest run src/shell.test.ts`
Expected: PASS. The guard cases fail before the edit in Step 1 and pass after — run them both
ways to confirm the test actually exercises the guard rather than passing vacuously.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-and-push.sh packages/release/src/shell.test.ts
git commit -m "fix(release): refuse to overwrite an already-published version tag"
```

---

## Task 7: Installers resolve `latest.json` to a concrete version

**Files:**
- Modify: `install/install.sh`
- Modify: `install/install.ps1`

**Interfaces:**
- Consumes: the `latest.json` shape from Task 2.
- Produces: nothing other tasks depend on.

**Context:** `install/install.sh:28` sets `VERSION="latest"`; `install/install.ps1:26` sets
`[string]$Version = "latest"`. Both write it to `.env` as `OPENLDR_VERSION` (line 338 in each).

The change: default becomes the sentinel `auto`, which resolves via `latest.json`. `--version`
still pins. `--version latest` still opts into the moving tag.

**`install.sh` cannot assume node exists** — it runs before anything is installed. Parse the
three-field JSON with `grep`/`sed`. `install.ps1` has `ConvertFrom-Json` built in.

**On a failed resolve, stop.** Falling back to `latest` would reintroduce the moving tag at
exactly the moment the operator cannot see it happening.

- [ ] **Step 1: Write the failing shell test**

The resolve logic is extracted into a sourceable function so it can be called directly. Write
the test first — it defines the contract.

Create `packages/release/src/shell.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = resolve(__dirname, '../../..');
const LIB = join(REPO, 'install/lib/resolve-version.sh').replace(/\\/g, '/');

/** Source the lib and call resolve_version with `url`. Returns { code, stdout, stderr }. */
function resolveVersion(url: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', ['-c', `source "${LIB}"; resolve_version "${url}"`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim() };
  }
}

function fixture(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'openldr-fixture-'));
  const file = join(dir, 'latest.json');
  writeFileSync(file, body);
  return pathToFileURL(file).href;
}

describe('resolve_version', () => {
  it('extracts the version from a well-formed manifest', () => {
    const url = fixture('{\n  "version": "0.2.0",\n  "releasedAt": "2026-08-20",\n  "notesUrl": "https://example.org/x"\n}\n');
    const r = resolveVersion(url);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('0.2.0');
  });

  it('handles a single-line manifest with no spaces', () => {
    const url = fixture('{"version":"1.10.3","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}');
    expect(resolveVersion(url).stdout).toBe('1.10.3');
  });

  // The version field is not always first; a naive grep of the first quoted value would take
  // releasedAt.
  it('takes the version field, not whichever field comes first', () => {
    const url = fixture('{"releasedAt":"2026-08-20","version":"0.3.1","notesUrl":"https://example.org/x"}');
    expect(resolveVersion(url).stdout).toBe('0.3.1');
  });

  it('fails when the URL cannot be fetched', () => {
    const r = resolveVersion('file:///definitely/not/here/latest.json');
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('fails on a manifest with no version field', () => {
    const url = fixture('{"releasedAt":"2026-08-20"}');
    const r = resolveVersion(url);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  // The moving tag must never satisfy the resolve — that is the whole point of the change.
  it('rejects a version that is not X.Y.Z', () => {
    const url = fixture('{"version":"latest","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}');
    const r = resolveVersion(url);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('rejects an empty version', () => {
    const url = fixture('{"version":"","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}');
    expect(resolveVersion(url).code).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/release exec vitest run src/shell.test.ts`
Expected: FAIL — every case fails because `install/lib/resolve-version.sh` does not exist.

- [ ] **Step 3: Write the lib, then wire the installer to it**

Create `install/lib/resolve-version.sh`:

```bash
#!/usr/bin/env bash
# resolve_version <url> — print the version from a latest.json, or fail.
#
# Sourced by install/install.sh, and called directly by packages/release/src/shell.test.ts.
# It lives in its own file precisely so it can be tested: a block inlined in the installer
# cannot be invoked without running the whole installer.
#
# Prints nothing and returns non-zero on any failure. The caller decides what to say —
# and it must NOT fall back to `latest`.

resolve_version() {
  url="$1"
  body="$(curl -fsSL --retry 3 --retry-delay 2 "$url" 2>/dev/null)" || return 1
  # Match the `version` KEY specifically. A naive first-quoted-value grep would return
  # releasedAt whenever a future manifest orders the fields differently.
  version="$(printf '%s' "$body" \
    | tr ',{}' '\n\n\n' \
    | grep -E '"version"[[:space:]]*:' \
    | head -1 \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
  # Only a plain X.Y.Z resolves. `latest` must never satisfy this.
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  printf '%s\n' "$version"
}
```

In `install/install.sh`, replace line 28, `VERSION="latest"`, with:

```bash
VERSION="auto"   # resolved from latest.json; --version pins, --version latest opts into the moving tag
LATEST_URL="https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json"
```

Then, immediately after the `while` flag loop ends, insert:

```bash
# Resolve `auto` to a concrete published version, so .env records exactly what this lab runs.
# Two installs on the same day then get the same stack, and a rollback has something to name.
if [ "$VERSION" = "auto" ]; then
  echo "Resolving the newest release..."
  # shellcheck source=install/lib/resolve-version.sh
  . "$(dirname "$0")/lib/resolve-version.sh"
  if ! VERSION="$(resolve_version "$LATEST_URL")"; then
    echo "ERROR: could not resolve the newest release from $LATEST_URL" >&2
    echo "Pass a version explicitly, e.g.:  $0 --version 0.1.0" >&2
    echo "(Passing --version latest tracks the moving tag instead, which is fine for a demo" >&2
    echo " but means an upgrade is unbounded.)" >&2
    exit 1
  fi
  echo "Newest release: $VERSION"
fi
```

⚠ **`install.sh` is also run by `curl | sh`**, where `$(dirname "$0")` is not the repo. The
installer already downloads files from `$REPO_RAW`; if sourcing locally fails, fetch the lib the
same way it fetches everything else. Verify which path applies before assuming.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/release exec vitest run src/shell.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the installer stops rather than falling back**

Point `LATEST_URL` at an unreachable URL and run the installer:

```bash
bash install/install.sh --dir /tmp/openldr-resolve-probe
```

Expected: exits non-zero, prints `could not resolve the newest release`, and prints the
`--version` command. **It must not write a `.env` containing `OPENLDR_VERSION=latest`.**

```bash
grep -r OPENLDR_VERSION /tmp/openldr-resolve-probe 2>/dev/null || echo "no .env written - correct"
```

- [ ] **Step 6: Change `install/install.ps1`**

Create `install/lib/Resolve-Version.ps1`, the PowerShell twin — same contract, same refusals:

```powershell
# Resolve-OpenLdrVersion <url> - return the version from a latest.json, or $null.
# Dot-sourced by install/install.ps1. Returns $null on every failure; the caller decides
# what to say, and it must NOT fall back to `latest`.
function Resolve-OpenLdrVersion {
  param([Parameter(Mandatory = $true)][string]$Url)
  try {
    $manifest = Invoke-RestMethod -Uri $Url -TimeoutSec 20
  } catch {
    return $null
  }
  if ($manifest.version -match '^\d+\.\d+\.\d+$') { return $manifest.version }
  return $null
}
```

Replace line 26, `[string]$Version = "latest",`, with:

```powershell
  [string]$Version = "auto",
```

Update the flags comment at line 5 to:

```powershell
#   -Version <tag>      image tag (default auto - resolves the newest release; "latest" tracks the moving tag)
```

Then, immediately after the `param(...)` block closes, insert:

```powershell
# Resolve `auto` to a concrete published version, so .env records exactly what this lab runs.
if ($Version -eq "auto") {
  $latestUrl = "https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json"
  Write-Host "Resolving the newest release..."
  . (Join-Path $PSScriptRoot "lib/Resolve-Version.ps1")
  $resolved = Resolve-OpenLdrVersion -Url $latestUrl
  if (-not $resolved) {
    Write-Error "Could not resolve the newest release from $latestUrl"
    Write-Host  "Pass a version explicitly, e.g.:  -Version 0.1.0"
    Write-Host  "(-Version latest tracks the moving tag instead, which is fine for a demo but"
    Write-Host  " means an upgrade is unbounded.)"
    exit 1
  }
  $Version = $resolved
  Write-Host "Newest release: $Version"
}
```

- [ ] **Step 7: Verify the PowerShell twin, including its refusal**

```powershell
. install/lib/Resolve-Version.ps1
$f = Join-Path $env:TEMP 'latest.json'
'{"version":"0.2.0","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}' | Set-Content $f -Encoding utf8
Resolve-OpenLdrVersion -Url ([uri]::new($f).AbsoluteUri)
```

Expected output: `0.2.0`

```powershell
. install/lib/Resolve-Version.ps1
$f = Join-Path $env:TEMP 'latest-bad.json'
'{"version":"latest","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}' | Set-Content $f -Encoding utf8
$r = Resolve-OpenLdrVersion -Url ([uri]::new($f).AbsoluteUri)
if ($null -eq $r) { "REJECTED" } else { $r }
```

Expected output: `REJECTED` — the moving tag must never satisfy the resolve.

- [ ] **Step 8: Commit**

```bash
git add install/install.sh install/install.ps1 install/lib packages/release/src/shell.test.ts
git commit -m "feat(install): pin new installs to a resolved release instead of the moving latest tag"
```

---

## Task 8: `RELEASE.md`

**Files:**
- Modify: `RELEASE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

**Context:** `RELEASE.md` currently documents the manual `pnpm run publish:images` flow and ends
with a "Follow-up (Approach B)" section naming GitHub Actions as the intended end state. Keep
that section — Actions is still the plan, and this script is written to be callable from one.

- [ ] **Step 1: Rewrite the build-and-push section**

Replace the `## Build & push the images` section body with:

````markdown
## Cutting a release

```
pnpm release --dry-run    # check every precondition, change nothing
pnpm release              # publish
```

The command refuses to publish a broken release. It checks all of these before anything is
pushed, and reports every problem at once:

1. Clean tree, on `main`, in sync with `origin`.
2. `package.json` version is newer than the last `v*` tag.
3. No `vX.Y.Z` tag exists.
4. `:X.Y.Z` is not already in the registry.
5. Test gate green.
6. Landing changelog regenerated and committed.

Then it pushes the five images, makes every package public **and reads the visibility back**,
verifies by installing the published tag into a clean directory, and only then creates the git
tag, pushes it, and cuts the GitHub release with `latest.json` attached.

**The tag is last on purpose.** A `vX.Y.Z` tag exists only if that release is complete and
verified — so a failure part-way through leaves no tag, and no lab ever sees a half-release.

### Prerequisites

- A GitHub token with `read:packages`, `write:packages`, and permission to change package
  visibility. Without `read:packages` the overwrite guard cannot run.
- `docker login ghcr.io` with that token.

### Releasing by hand

`scripts/build-and-push.sh` still works standalone and carries the same overwrite guard. Pass
`--allow-overwrite` only to republish a version that was never announced.

### What is NOT proven by tests

The visibility read-back and the verification install touch a real registry, so **no test in the
suite covers them**. The first real release is the test for those two steps. Everything else —
semver comparison, each precondition's refusal, the manifest shape, the registry probes — is
unit-tested with injected inputs.
````

- [ ] **Step 2: Update the installer note**

Replace the paragraph beginning `The image tag maps to OPENLDR_VERSION` with:

```markdown
The installer resolves the newest release from `latest.json` and writes a concrete
`OPENLDR_VERSION=X.Y.Z` into `.env` — never the word `latest`. `--version 0.1.9` pins
deliberately; `--version latest` opts into the moving tag for demos. If the resolve fails the
installer stops rather than falling back, so a lab never silently ends up on a moving tag.
```

- [ ] **Step 3: Verify the docs tests still pass**

Run: `pnpm --filter @openldr/web test`
Expected: PASS. `RELEASE.md` is not bundled into the docs site, so this is a regression check
rather than a direct test of the edit.

- [ ] **Step 4: Commit**

```bash
git add RELEASE.md
git commit -m "docs: pnpm release, its refusals, and what its tests do not cover"
```

---

## Task 9: Full gate

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run test`
Expected: all packages pass, including the two new suites in `@openldr/release`.

If it fails, grep the output for `Test timed out` and re-run that package alone before blaming a
change — `@openldr/forms` `store.test.ts` is a known load-timeout (CLAUDE.md).

- [ ] **Step 2: Typecheck**

Run: `pnpm turbo run typecheck`
Expected: clean. `@openldr/cli#build` is a known Windows failure and is not part of this.

- [ ] **Step 3: State what was not proven**

Write it plainly in the completion report:

- No test touches a real registry. The overwrite guard, the visibility read-back and the
  verification install are exercised only by a real release.
- `latest.json` has never been published, so the installers' resolve path is proven against a
  fixture, not against the live URL.
- `pnpm release` has been dry-run only. **HONEST NON-PROOF** until a real release runs.

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: the manifest and its permanent URL are
Task 2; the ten-step ordering and the tag-last invariant are Task 5; preconditions 1–6 are Task
3 with the gate-flake handling in Task 5; the overwrite guard is Tasks 3 and 6 (script and
standalone paths); step 8's visibility read-back is Task 4 plus Task 5; installer resolution is
Task 7; shared semver placement is Task 1; `RELEASE.md` and the HONEST NON-PROOF disclosure are
Task 8.

**Deliberately not covered, matching the spec's Out of scope:** Project B, GitHub Actions, any
auto-apply, the two existing `compareVersions` copies, and the `minio`/`mc`/`certbot` moving
tags in `deploy/install/docker-compose.yml`.

**The riskiest task is 5**, because it is the only one without unit tests — by design, since its
decisions live in Tasks 2–4. If it grows logic worth testing, that logic belongs in
`packages/release`, not in the script.

**Task 4 is the one that can block the plan.** If the token prerequisite is unmet, Tasks 1, 2,
3, 6 and 7 still land and are independently useful; Tasks 4, 5 and 8 stall. Report rather than
stub.
