# Facility controlled-value matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A controlled value that differs from its concept only by case, or by Centre against Center, resolves by itself to that concept's code instead of becoming manual work.

**Architecture:** One narrow normalisation function and a per-value-set key map, both inside `facility-controlled-fields.ts`. `resolveControlledFields` gains one ordered step between the mapping lookup and the unmapped fallback. No migration, no route change, no studio change.

**Tech Stack:** TypeScript, vitest, pg-mem via `@openldr/db/testing`.

**Spec:** `docs/superpowers/specs/2026-09-07-facility-controlled-value-matching-design.md`

## Global Constraints

- `AGENTS.md` §8: never hardcode clinical vocabulary. The normalisation adds no code, no organism and
  no status. It folds two spelling variants and nothing else, and the seeded vocabulary is not edited.
- **No migration.** If a step tempts you to write one, stop: the operator decided on 2026-09-07 to
  make the match tolerant rather than edit the seed. See the spec's Scope.
- No em dashes in any file this plan touches. No emoji in headings or bullets.
- Test one file: `npx vitest run <path> --root packages/bootstrap`.
  Full gate: `pnpm turbo run test --concurrency=4`. Never pipe turbo through `tail`.
- No `Co-Authored-By` trailers.
- Branch `feat/facility-controlled-value-matching`, cut from `main` at `e2270dc6`. Task 4 merges to
  local `main` and pushes. No PR unless asked.

---

## Decision record

Facts checked on 2026-09-07. Re-check the cited line rather than guess.

**1. The canonical check is an exact, case-sensitive `Set` lookup.**
`facility-controlled-fields.ts:139-147`: `canonical` collects codes and non-empty displays, then
`canonical.has(raw)` decides. That is the whole defect.

**2. A fold can never be ambiguous today, and that was measured, not assumed.** Over the real seeded
lists in `072_facility_level_status_valuesets.ts`: 63 level concepts, 3 status concepts, and under
both case folding and case-plus-`centre` folding there are **zero** cross-concept collisions. The
only collisions are a concept's own code against its own display (`active`/`Active`), which is not a
collision at all. Task 2 turns this measurement into a test so it cannot rot.

**3. The seeded concept lists are NOT exported** (`072_facility_level_status_valuesets.ts:37`, `:68`
are plain `const`). So the collision test must read what the migration actually seeded, from a
migrated database, rather than importing a copy. `@openldr/bootstrap` already does this in several
tests: `import { makeMigratedDb } from '@openldr/db/testing'`
(`packages/bootstrap/src/facility-health.test.ts:3`). The two coding systems to read are
`urn:openldr:cs:facility-type` and `http://hl7.org/fhir/location-status` (`:57`, `:27`).

**4. There is no column shape to protect.** A canonical value passes through UNCHANGED
(`facility-controlled-fields.ts:180-181`), so `level` already holds codes, displays and raw strings
at once. The live install's 2776 rows carry `Functional`.

**5. The blast radius is the import, and only the import.** `resolveControlledFields` has one
production caller chain: `importFacilities` (`facility-import.ts:738`), which both HTTP doors and the
CLI import run, plus the CLI's `suggest-values` (`packages/cli/src/facilities.ts:744`).

**6. Nothing outside the seed names these strings.** No production file mentions `Health Center`,
`Diagnostic Centre`, or the codes `health-center` / `diagnostic-centre`; only this package's own test
fixtures do.

## File structure

| File | Responsibility |
|---|---|
| Modify `packages/bootstrap/src/facility-controlled-fields.ts` | The normalisation, the key map with its collision guard, and the new step in `resolveControlledFields`. |
| Modify `packages/bootstrap/src/facility-controlled-fields.test.ts` | The rule, the ordering, and the guard. |
| Create `packages/bootstrap/src/facility-controlled-fields.seed.test.ts` | That the REAL seeded vocabulary collides nowhere under the normalisation. The test that fails when somebody adds a colliding concept. |
| Modify `packages/bootstrap/src/facility-import.test.ts` | That the write actually happens: a CSV with `Health Centre` imports as `health-center` with the raw string in `extras.__source`. |
| Modify `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`, `apps/web/src/docs/0.1.0/facilities.md` | What now resolves by itself. |

---

### Task 1: The normalisation and the ordered resolution

**Files:**
- Modify: `packages/bootstrap/src/facility-controlled-fields.ts`
- Modify: `packages/bootstrap/src/facility-controlled-fields.test.ts`

**Interfaces:**
- Produces:
  `export function normaliseControlledValue(s: string): string`
  `resolveControlledFields` keeps its exact signature and return type. Only which values land in
  `mapped` versus `unmapped` changes.

- [ ] **Step 0: Cut the branch**

```bash
git checkout -b feat/facility-controlled-value-matching
```

Expected: `main` clean at `e2270dc6`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/bootstrap/src/facility-controlled-fields.test.ts`. The file's existing `fakeAdmin`
helper already accepts `{ code, display }` fixtures, so reuse it rather than writing a second one.

```ts
describe('normaliseControlledValue', () => {
  it('folds case and surrounding whitespace', () => {
    expect(normaliseControlledValue('  Health Center ')).toBe('health center');
  });

  // The one spelling variant, and it is here because a real register needed it: the Zambia MFL
  // export writes `Health Centre` while the seeded concept reads `Health Center`.
  it('folds centre onto center', () => {
    expect(normaliseControlledValue('Diagnostic Centre')).toBe('diagnostic center');
    expect(normaliseControlledValue('Health Centre')).toBe(normaliseControlledValue('Health Center'));
  });

  // ⛔ TWO RULES, NOT A SIMILARITY SCORE. Anything that wants more tolerance than an enumerated
  // variant belongs in the ranked suggester, behind the operator's own confirmation.
  it('folds nothing else', () => {
    expect(normaliseControlledValue('Hospital')).not.toBe(normaliseControlledValue('Hospitals'));
    expect(normaliseControlledValue('Organisation')).not.toBe(normaliseControlledValue('Organization'));
    expect(normaliseControlledValue('health-center')).not.toBe(normaliseControlledValue('health center'));
  });
});

describe('resolveControlledFields: the four ordered steps', () => {
  const LEVEL = 'urn:openldr:valueset:facility-type';
  const concepts = [{ code: 'health-center', display: 'Health Center' }];

  it('1. a value that IS a code is left alone: neither mapped nor unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health-center' })]);
    expect(res.mapped.level.size).toBe(0);
    expect(res.unmapped.level).toEqual([]);
  });

  // ⛔ THE ORDER IS THE POINT. An operator who deliberately mapped their register's `Health Centre`
  // onto something else keeps that decision; an automatic fold must never overrule them.
  it('2. an active mapping BEATS a fold that would have said something different', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { [LEVEL]: [...concepts, { code: 'district-hospital', display: 'District Hospital' }] },
      mappings: { [`${from}|Health Centre`]: [{ toCode: 'district-hospital', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Centre' })]);
    expect(res.mapped.level.get('Health Centre')).toBe('district-hospital');
  });

  it('3. a case-only difference resolves to the CODE, not to the display', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health center' })]);
    expect(res.mapped.level.get('health center')).toBe('health-center');
    expect(res.unmapped.level).toEqual([]);
  });

  it('3. the Centre spelling resolves too, which is what the Zambia export needs', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Centre' })]);
    expect(res.mapped.level.get('Health Centre')).toBe('health-center');
  });

  it('3. an exact DISPLAY now resolves to the code as well', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Health Center' })]);
    expect(res.mapped.level.get('Health Center')).toBe('health-center');
  });

  it('4. anything else is still unmapped, and still never blocks', async () => {
    const admin = fakeAdmin({ valueSets: { [LEVEL]: concepts } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'Something Else' })]);
    expect(res.unmapped.level).toEqual(['Something Else']);
  });

  // ⛔ FAIL CLOSED. Two different concepts that normalise alike make the key USELESS, not ambiguous:
  // values matching it go to the operator rather than to a guess. Zero seeded keys collide today
  // (see the seed test), so this exists for the concept somebody adds next year.
  it('discards a key two different concepts share, leaving those values unmapped', async () => {
    const admin = fakeAdmin({
      valueSets: {
        [LEVEL]: [
          { code: 'a-center', display: 'A Center' },
          { code: 'a-centre', display: 'A Centre' },
        ],
      },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'a center' })]);
    expect(res.mapped.level.size).toBe(0);
    expect(res.unmapped.level).toEqual(['a center']);
  });

  // A colliding key must not poison the rest of the set.
  it('a collision does not stop other values resolving', async () => {
    const admin = fakeAdmin({
      valueSets: {
        [LEVEL]: [
          { code: 'a-center', display: 'A Center' },
          { code: 'a-centre', display: 'A Centre' },
          { code: 'health-center', display: 'Health Center' },
        ],
      },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health centre' })]);
    expect(res.mapped.level.get('health centre')).toBe('health-center');
  });
});
```

Add `normaliseControlledValue` to this file's import from `./facility-controlled-fields`.

- [ ] **Step 2: Run them, expect failure**

Run: `npx vitest run src/facility-controlled-fields.test.ts --root packages/bootstrap`
Expected: FAIL. The first error names `normaliseControlledValue` as not exported.

- [ ] **Step 3: Write the normalisation**

In `packages/bootstrap/src/facility-controlled-fields.ts`, above `resolveControlledFields`:

```ts
/**
 * How a controlled value is compared against a concept: the difference between two strings that a
 * person would call the same word.
 *
 * ⛔ AN ENUMERATED LIST OF VARIANTS, NOT A SIMILARITY SCORE, and the difference is the whole reason
 * this can sit in a path that writes without asking. A rule is added here only when a REAL register
 * has been measured needing it, AND only when adding it introduces no cross-concept collision in any
 * seeded set (`facility-controlled-fields.seed.test.ts` is what proves the second half).
 *
 * The two rules and why each exists:
 *   - case, because a national export capitalises to its own house style;
 *   - `centre` -> `center`, because the Zambia MFL export writes `Health Centre` while the seeded
 *     concept reads `Health Center`, and the seed itself is inconsistent (`Health Center` and
 *     `Radiology Services Center` against `Diagnostic Centre` and `Mobile Radiology and Imaging
 *     Centre`, migration 072).
 *
 * ⛔ ANYTHING BEYOND AN ENUMERATED VARIANT BELONGS IN THE RANKER (`facility-mapping-suggest.ts`),
 * which scores and then asks. Its `WEAK_MIN` of 0.62 exists to offer nothing rather than a wrong
 * guess; this function must keep the same discipline by refusing to be clever at all.
 */
export function normaliseControlledValue(s: string): string {
  return s.trim().toLowerCase().replace(/centre/g, 'center');
}
```

- [ ] **Step 4: Build the key map and add the step**

Replace the canonical-set construction (`facility-controlled-fields.ts:139-143`) and the resolution
loop (`:146-155`) with:

```ts
    // Every concept's code, for step 1: a value that already IS a code needs nothing done to it.
    const codes_ = new Set(codes.map((c) => c.code));

    /**
     * Normalised key -> the code it resolves to, for step 3.
     *
     * ⛔ A KEY TWO DIFFERENT CONCEPTS CLAIM IS DELETED, not resolved to whichever was seen first.
     * Values matching it fall through to `unmapped` and reach the operator, which is where an
     * ambiguous value belongs. MEASURED: zero keys collide across the seeded sets today (63 level
     * concepts, 3 status), so this branch is unreachable on a stock install. It exists so that a
     * concept added later degrades to "ask" rather than to a wrong answer.
     */
    const byKey = new Map<string, string>();
    const poisoned = new Set<string>();
    for (const c of codes) {
      for (const token of [c.code, c.display]) {
        if (token === null || token === '') continue;
        const key = normaliseControlledValue(token);
        const seen = byKey.get(key);
        if (seen !== undefined && seen !== c.code) { poisoned.add(key); continue; }
        byKey.set(key, c.code);
      }
    }
    for (const key of poisoned) byKey.delete(key);

    const fromSystem = observedFieldSystem(field, nationalSystem);
    for (const raw of rawValues) {
      // 1. Already the canonical form. Rewriting it to itself would be noise.
      if (codes_.has(raw)) continue;

      // 2. ⛔ THE OPERATOR'S OWN DECISION WINS over any automatic fold below. A register that
      // deliberately maps its `Health Centre` onto something other than `health-center` keeps that.
      // The `m.isActive` check is load-bearing: a DEACTIVATED mapping must not resolve. The first
      // ACTIVE mapping wins, matching `saveExclusive`'s invariant of at most one active mapping per
      // `(fromSystem, fromCode)` within a scope.
      const outgoing = await admin.termMappings.listOutgoing(fromSystem, raw);
      const active = outgoing.find((m) => m.isActive);
      if (active) { mapped[field].set(raw, active.toCode); continue; }

      // 3. The same word, read the way a person reads it. Resolves to the CODE, so every resolved
      // value in the column is one shape; `applyControlledFields` keeps the raw string in
      // `extras.__source`.
      const code = byKey.get(normaliseControlledValue(raw));
      if (code !== undefined) { mapped[field].set(raw, code); continue; }

      // 4. Unmapped. NEVER blocks and NEVER blanks: written exactly as it is today.
      unmapped[field].push(raw);
    }
```

Delete the now-unused `canonical` set. Keep the docblock above it that explains why displays are
matched at all, moving it onto `byKey` where it is still true.

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run src/facility-controlled-fields.test.ts --root packages/bootstrap`
Expected: PASS, including the file's pre-existing tests.

⚠ **One pre-existing test WILL fail, and it is the right one to change.**
`'accepts a canonical display, not only a canonical code'`
(`facility-controlled-fields.test.ts:128-137`) asserts `mapped.level.size` is 0 for
`level: 'Health Center'`. Under the new rule that display resolves to `health-center`, so its last
line becomes:

```ts
    expect(res.unmapped.level).toEqual([]);
    // CHANGED by this slice: a display no longer passes through as itself, it resolves to the
    // concept's CODE, so every resolved value in the column is one shape. The test's original point
    // stands and is still what matters: the value set's OWN vocabulary is accepted. A live create
    // really did fail with `level 'Health Center' is not a recognised canonical level value`.
    expect(res.mapped.level.get('Health Center')).toBe('health-center');
```

`'still accepts a canonical code'` (`:139`) does NOT change: a raw value that IS a code is step 1 and
is left alone. `'reports a value already canonical as neither mapped nor unmapped'` (`:38`) does not
change either, because its fixture is a bare code. Do not weaken any of the three to make them pass.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p packages/bootstrap`

```bash
git add packages/bootstrap/src/facility-controlled-fields.ts packages/bootstrap/src/facility-controlled-fields.test.ts
git commit -m "fix(facilities): a value that differs only by case resolves to its concept's code"
```

---

### Task 2: Prove the real seeded vocabulary never collides

The test that makes the fail-closed guard unnecessary in practice, and that fails the day somebody
adds a concept which would make it necessary.

**Files:**
- Create: `packages/bootstrap/src/facility-controlled-fields.seed.test.ts`

**Interfaces:**
- Consumes: `normaliseControlledValue` from Task 1, and `makeMigratedDb` from `@openldr/db/testing`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { normaliseControlledValue } from './facility-controlled-fields';

/** The two coding systems migration 072 seeds (`072_facility_level_status_valuesets.ts:27`, `:57`). */
const SYSTEMS = {
  level: 'urn:openldr:cs:facility-type',
  status: 'http://hl7.org/fhir/location-status',
};

/**
 * ⛔ READS THE MIGRATED DATABASE, not a copy of the concept list. `LEVEL_CONCEPTS` and
 * `STATUS_CONCEPTS` are plain `const`s inside the migration and are deliberately not exported, so a
 * fixture here would be a second copy free to drift from the one that actually ships. This asserts
 * what an install really contains.
 */
describe('the seeded controlled vocabularies collide nowhere under the normalisation', () => {
  it.each(Object.entries(SYSTEMS))('%s', async (_field, system) => {
    const db = await makeMigratedDb();
    const rows = await db.selectFrom('terminology_concepts')
      .select(['code', 'display'])
      .where('system', '=', system)
      .execute() as { code: string; display: string | null }[];

    // The premise, asserted rather than assumed: a seed that stopped seeding would make every
    // collision assertion below pass for the uninteresting reason that there is nothing to collide.
    expect(rows.length).toBeGreaterThan(2);

    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const r of rows) {
      for (const token of [r.code, r.display]) {
        if (!token) continue;
        const key = normaliseControlledValue(token);
        const seen = owner.get(key);
        // A concept's own code and display legitimately share a key (`active` / `Active`). Only two
        // DIFFERENT concepts sharing one is a problem.
        if (seen !== undefined && seen !== r.code) collisions.push(`${key}: ${seen} vs ${r.code}`);
        else owner.set(key, r.code);
      }
    }

    // ⛔ IF THIS FAILS, DO NOT LOOSEN IT. It means a concept was added whose code or display reads
    // the same as another's once case and the Centre/Center variant are folded. Two different
    // concepts cannot share a key, so either rename the new concept or accept that values matching
    // that key go to the operator (which the resolver already does; see its `poisoned` set).
    expect(collisions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/facility-controlled-fields.seed.test.ts --root packages/bootstrap`
Expected: PASS, 2 tests.

If it fails on the `rows.length` assertion, the migration did not seed under the system url this test
names. Read `072_facility_level_status_valuesets.ts:27` and `:57` and correct the constant here, not
the assertion.

- [ ] **Step 3: Commit**

```bash
git add packages/bootstrap/src/facility-controlled-fields.seed.test.ts
git commit -m "test(facilities): the seeded vocabularies collide nowhere once case and Centre fold"
```

---

### Task 3: Prove the write, then say so in the docs

A unit test proves the classification. Only an import proves what lands in the row.

**Files:**
- Modify: `packages/bootstrap/src/facility-import.test.ts`
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`
- Modify: `apps/web/src/docs/0.1.0/facilities.md`

- [ ] **Step 1: Write the import-level test**

Find this file's existing controlled-field test (search for `unmapped` or `__source`) and add beside
it, reusing whatever `deps`/admin fixture it already builds:

```ts
```ts
  // ⛔ THE UNIT TEST PROVES THE CLASSIFICATION; THIS PROVES THE WRITE. `resolveControlledFields` can
  // say "mapped" and `applyControlledFields` still leave the row alone if the two disagree about
  // which string is canonical, which is exactly the class of bug a per-function test cannot see.
  it('writes the CODE for a value that differed only by spelling, keeping the raw string', async () => {
    const res = await importFacilities(
      deps,
      'national_code,name,level
A1,Alpha,Health Centre
',
      { nationalSystem: SYSTEM, apply: true },
    );

    expect(res.unmapped.level).toEqual([]);
    const row = await rowFor(deps.db, 'A1');
    expect(row?.level).toBe('health-center');
    expect((row?.extras as { __source?: Record<string, string> })?.__source?.level).toBe('Health Centre');
  });
```

`importFacilities(deps, input, opts)` is the REAL signature (`facility-import.ts:681-685`): the CSV is
the SECOND positional argument, not a field on the options object. `rowFor(deps.db, code)` is this
file's own reader (`facility-import.test.ts:21`) and `SYSTEM` its own register constant. Use the
`deps` its other `apply: true` tests build; do not add a second harness.

⚠ This test needs the level value set available to whatever admin store `deps` carries. Check how
this file's existing controlled-field tests provide it before writing this one, and follow that. If
nothing here exercises the controlled layer at all, put this test where that layer is already wired
rather than wiring it a second time.
- [ ] **Step 2: Run the import suite**

Run: `npx vitest run src/facility-import.test.ts --root packages/bootstrap`
Expected: PASS.

⚠ Other tests in this file may assert that an exact-display value passes through unchanged. That
expectation changed. Update the assertion and say why in a comment; do not weaken the resolver.

- [ ] **Step 3: The English doc**

In `apps/studio/src/docs/0.1.0/en/facilities.md`, in the section about unrecognised values, add:

```markdown
Spelling and capitalisation are not your problem. A value that differs from the vocabulary only by
capitals, or by writing Centre where the vocabulary writes Center, resolves on its own and never
reaches the list. Your register's `Health Centre` is imported as `health-center`, and the words your
file actually used are kept alongside the row.

If you have already mapped a value by hand, your mapping wins. Nothing decided automatically
overrules a decision you made.
```

- [ ] **Step 4: The French and Portuguese docs**

Match each file's existing register. Every idea must survive: capitals and the Centre spelling
resolve by themselves, the code is what gets written, the original words are kept, and a hand-made
mapping always wins.

- [ ] **Step 5: The web doc**

One sentence in the same section: capitalisation and the Centre/Center variant resolve automatically
to the vocabulary's code, and a mapping made by hand always takes precedence.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/docs --root apps/studio`
Run: `npx vitest run --root apps/web`

Do NOT run `pnpm docs:seed` or `pnpm gallery:screenshots`.

```bash
git add packages/bootstrap/src/facility-import.test.ts apps/studio/src/docs apps/web/src/docs
git commit -m "docs(facilities): capitals and the Centre spelling resolve by themselves"
```

---

### Task 4: Verify, merge, changelog

- [ ] **Step 1: Full gate**

Run: `pnpm turbo run test --concurrency=4`
Expected: every task successful. Never pipe through `tail`. A failure is usually a timeout: grep for
`Test timed out` and re-run that package alone before blaming a change.

- [ ] **Step 2: Measure it on the real register**

This is the proof the spec asks for, and the only one that says whether the change was worth making.

Start the stack with the Browser pane's `preview_start`, never Bash. `AUTH_DEV_BYPASS` is `false`;
say so out loud before flipping it and set it back afterwards.

⚠ `preview_start` has refused port 3000 as held by another chat all session, and a real `node dev.mjs`
was found listening there. The workaround that has worked twice: a temporary `api-alt` launch entry
on 3001 plus a one-line `vite.config.ts` proxy edit, both reverted before merging.

Import the Zambia export through the streamed door and record **how many distinct `level` values
still need a decision, against the number before this change**. The earlier live run showed
`Health Centre` and `1st Level Hospital` in the worklist for a two-row file; `Health Centre` should
now be gone and `1st Level Hospital` should remain, because it is a genuinely different name and
belongs in front of a person.

Cancel any run you create and confirm the register is free afterwards.

- [ ] **Step 3: Stop the stack, restore the flag**

`preview_stop` does not kill `node dev.mjs` or its vite children. Check ports 3001 and 5173 are free,
leave port 3000 alone if the process there is not yours, and confirm `AUTH_DEV_BYPASS=false`.

- [ ] **Step 4: Merge and push**

```bash
git checkout main
git merge --no-ff feat/facility-controlled-value-matching
git push origin main
git rev-parse origin/main
```

Confirm the origin SHA. No PR unless asked.

- [ ] **Step 5: Changelog, after the merge**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
git push origin main
```

---

## What this plan does not do

State these when reporting completion.

- **No migration and no edit to the seeded vocabulary.** `diagnostic-centre` and `health-center` keep
  their codes and their displays. Operator decision, 2026-09-07.
- **No backfill.** Nothing already written moves. The next import touching a register rewrites its
  resolved values to codes, and a column holding `Health Center` today will hold `health-center`
  after. That is intended and is stated in the spec.
- **The facility form still writes displays.** A hand-made facility and an imported one keep
  different shapes in `level`. Closing that is a decision about the form, not the import.
- **No new tolerance beyond the two enumerated rules.** Anything else belongs in the ranked
  suggester, which asks before it acts.
- **S-6 is untouched.** The 66-item picker is still in seed order. It is next.
