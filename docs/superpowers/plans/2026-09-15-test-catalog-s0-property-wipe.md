# Test catalog S0: stop the property wipe, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Editing a term on the Terminology page keeps every property key the page does not manage, instead of replacing the whole properties blob.

**Architecture:** `terms.update` and the conflict branch of `terms.create` in `packages/db/src/terminology-admin-store.ts` read the stored `properties`, keep the keys `packProps` does not write, and write `packProps`' five managed fields over them. One helper, `mergeProps`, does it for both. Nothing else in the store changes.

**Tech Stack:** TypeScript, Kysely, Postgres (`jsonb`), vitest with pg-mem.

**Spec:** `docs/superpowers/specs/2026-09-15-test-catalog-design.md`, section 4.1.

## Global Constraints

- Work in a git worktree under `.claude/worktrees/`, never the main checkout. Another session edits it.
- Stage by exact path. Never `git add <dir>`.
- No `Co-Authored-By` trailer on any commit.
- Commit only as these steps say, and merge or push only when the operator asks.
- New writing follows the `unslop` skill: no em dashes, no emoji in headings or bullets.
- Run a single test file as `cd <package> && npx vitest run <path>`. `pnpm --filter <pkg> test -- <path>` does not filter.
- The gate is `pnpm turbo run test --force --concurrency=4 --continue` and `pnpm turbo run typecheck --force --concurrency=4`. Never pipe turbo through `tail`. A failure is usually a timeout: grep for `Test timed out` and re-run that package alone.

---

## What changes, and what does not

| File | Change |
|---|---|
| `packages/db/src/terminology-admin-store.ts` | Add `MANAGED_PROPS` and `mergeProps` next to `packProps` (`:252-260`). `update` (`:766-780`) and `create` (`:752-765`) use it. |
| `packages/db/src/terminology-admin-store.test.ts` | New `describe` block after the `terms` block's last test. |
| `packages/bootstrap/src/facility-reconcile.test.ts` | The test at `:108-148` that pins the bug flips to assert the fix. |
| `packages/bootstrap/src/facility-reconcile.ts` | The comment at `:157-167` that describes the bug is rewritten. |
| `apps/studio/src/docs/0.1.8/en/terminology.md` | One Troubleshooting bullet. |

**Deliberately unchanged:**

- `terms.importRows` (`:789-803`) also replaces properties on conflict. It is a whole-row write, and one caller, the facility projection (`packages/bootstrap/src/facility-reconcile.ts:1512`), writes each facility entry's full, authoritative properties. Merging there could bring back a key the projection meant to drop. Out of scope.
- `terms.createIfAbsent` (`:829-846`) never touches an existing row.
- `packProps` and `termRow` keep their behaviour.
- **fr and pt docs:** they have no Terminology page. The registry shows English in its place (`apps/studio/src/docs/registry.ts:416`). The web docs have no Terminology page either.

---

### Task 1: `terms.update` keeps keys it does not manage

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts` (add after `packProps`, `:260`; change `update`, `:766-780`)
- Test: `packages/db/src/terminology-admin-store.test.ts`

**Interfaces:**
- Consumes: `packProps(i: TermInput): Record<string, unknown> | null` (`:252-260`), `TermInput` (`:60-64`).
- Produces: `mergeProps(stored: unknown, i: TermInput): Record<string, unknown> | null`, private to the store factory. Task 2 uses it.

- [ ] **Step 1: Write the failing tests**

Add this block inside `describe('terminology admin store', ...)`, directly after the `describe('terms', ...)` block closes. `store()` (`:23-26`) returns `{ db, s }`, and `Kysely` and `InternalSchema` are already imported at the top of the file.

```ts
  // A loader, an ontology build or the facility scan writes property keys the Terminology page
  // knows nothing about: LOINC's axis parts, the AMR `organism_type`, the facility scan's
  // firstSeen. An edit used to replace the whole blob with the page's five fields, dropping them.
  describe('terms keep the properties an edit does not manage', () => {
    const edit = {
      system: 'http://x', code: 'ECO', display: 'Escherichia coli', status: 'ACTIVE' as const,
      shortName: null, class: null, unit: null, replacedBy: null, metadata: null,
    };

    async function seeded(properties: Record<string, unknown>) {
      const { db, s } = await store();
      await db.insertInto('terminology_concepts').values({
        system: 'http://x', code: 'ECO', display: 'E. coli', status: 'ACTIVE',
        properties: JSON.stringify(properties) as never,
      }).execute();
      return { db, s };
    }

    async function stored(db: Kysely<InternalSchema>): Promise<unknown> {
      const row = await db.selectFrom('terminology_concepts').select('properties')
        .where('system', '=', 'http://x').where('code', '=', 'ECO').executeTakeFirstOrThrow();
      return typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties;
    }

    it('update keeps unknown keys through a display-only edit', async () => {
      const { db, s } = await seeded({ organism_type: 'bacteria', SYSTEM: 'Ser/Plas' });
      await s.terms.update('http://x', 'ECO', edit);
      expect(await stored(db)).toEqual({ organism_type: 'bacteria', SYSTEM: 'Ser/Plas' });
    });

    it('update writes the managed fields over the unknown ones', async () => {
      const { db, s } = await seeded({ organism_type: 'bacteria', shortName: 'Old' });
      await s.terms.update('http://x', 'ECO', { ...edit, shortName: 'New' });
      expect(await stored(db)).toEqual({ organism_type: 'bacteria', shortName: 'New' });
    });

    it('update clears a managed field the edit leaves empty', async () => {
      const { db, s } = await seeded({ organism_type: 'bacteria', shortName: 'Old' });
      await s.terms.update('http://x', 'ECO', edit);
      expect(await stored(db)).toEqual({ organism_type: 'bacteria' });
    });

    it('update stores null when nothing is left', async () => {
      const { db, s } = await seeded({ shortName: 'Old' });
      await s.terms.update('http://x', 'ECO', edit);
      expect(await stored(db)).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts`

Expected: the first three new tests FAIL, because `update` writes `null` or `{ shortName: 'New' }` and drops `organism_type`. `update stores null when nothing is left` already passes. That is fine: it pins the clearing behaviour the fix must keep.

- [ ] **Step 3: Add `mergeProps`**

In `packages/db/src/terminology-admin-store.ts`, directly after `packProps` ends (`:260`), add:

```ts
  /** The property keys `packProps` writes. Every other key belongs to whoever put it there (a
   *  loader, an ontology build, the facility scan) and an edit must keep it. */
  const MANAGED_PROPS: readonly string[] = ['shortName', 'class', 'unit', 'replacedBy', 'meta'];

  /**
   * The properties to store after an edit: every stored key the edit does not manage, kept as it
   * was, with the edit's managed fields written over them. A managed field the edit leaves empty is
   * dropped, so clearing Short name still clears it. Null when nothing is left.
   */
  function mergeProps(stored: unknown, i: TermInput): Record<string, unknown> | null {
    const parsed = typeof stored === 'string' ? (JSON.parse(stored) as unknown) : stored;
    const kept: Record<string, unknown> = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!MANAGED_PROPS.includes(k)) kept[k] = v;
      }
    }
    const next = { ...kept, ...(packProps(i) ?? {}) };
    return Object.keys(next).length ? next : null;
  }
```

- [ ] **Step 4: Use it in `update`**

Replace the start of `update` (`:766-774`):

```ts
      async update(system, code, input) {
        const existing = await db.selectFrom('terminology_concepts').select(['code'])
          .where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        const props = packProps(input);
```

with:

```ts
      async update(system, code, input) {
        const existing = await db.selectFrom('terminology_concepts').select(['code', 'properties'])
          .where('system', '=', system).where('code', '=', code).executeTakeFirst();
        if (!existing) throw new TerminologyAdminError(`term not found: ${system}|${code}`, 'not-found');
        // Keep the keys this edit does not manage (LOINC parts, organism_type, the facility scan's
        // firstSeen). Replacing the whole blob dropped them.
        const props = mergeProps(existing.properties, input);
```

Leave the `updateTable(...).set({ ... properties: props === null ? null : ... })` that follows unchanged.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts`

Expected: every test in the file PASSES, including the existing `updates and deletes a term` (`:198-206`).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "fix(db): keep a term's unmanaged properties when it is edited" -m "terms.update replaced the whole properties blob with the five fields packProps manages, so editing a term's display dropped LOINC's axis parts, the AMR organism_type key and the facility scan's firstSeen. It now keeps every key packProps does not manage and writes the managed fields over them. Clearing a managed field still clears it."
```

---

### Task 2: the conflict branch of `terms.create` does the same

`create` is an upsert (`:752-759`). When the entry already exists, its `doUpdateSet` writes `excluded.properties`, the new blob built by `packProps`, over the stored one.

**Files:**
- Modify: `packages/db/src/terminology-admin-store.ts` (`create`, `:752-765`)
- Test: `packages/db/src/terminology-admin-store.test.ts` (the block from Task 1)

**Interfaces:**
- Consumes: `mergeProps` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe('terms keep the properties an edit does not manage', ...)` block from Task 1:

```ts
    it('create on an existing entry keeps unknown keys', async () => {
      const { db, s } = await seeded({ organism_type: 'bacteria' });
      await s.terms.create({ ...edit, class: 'GNB' });
      expect(await stored(db)).toEqual({ organism_type: 'bacteria', class: 'GNB' });
    });

    it('create of a new entry stores only the managed fields', async () => {
      const { db, s } = await store();
      await s.terms.create({ ...edit, shortName: 'E. coli' });
      expect(await stored(db)).toEqual({ shortName: 'E. coli' });
    });
```

- [ ] **Step 2: Run the tests and watch the first fail**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts`

Expected: `create on an existing entry keeps unknown keys` FAILS with `{ class: 'GNB' }`. `create of a new entry stores only the managed fields` PASSES already.

- [ ] **Step 3: Use `mergeProps` in `create`**

Replace the start of `create` (`:752-753`):

```ts
      async create(input) {
        const props = packProps(input);
```

with:

```ts
      async create(input) {
        // An upsert. On an existing entry, keep the keys this edit does not manage, as `update`
        // does; the conflict branch below writes `excluded.properties`, which is this value.
        const held = await db.selectFrom('terminology_concepts').select(['properties'])
          .where('system', '=', input.system).where('code', '=', input.code).executeTakeFirst();
        const props = held ? mergeProps(held.properties, input) : packProps(input);
```

Leave the `insertInto(...).onConflict(...)` that follows unchanged.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd packages/db && npx vitest run src/terminology-admin-store.test.ts`

Expected: every test in the file PASSES.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/terminology-admin-store.ts packages/db/src/terminology-admin-store.test.ts
git commit -m "fix(db): keep a term's unmanaged properties when create updates it" -m "terms.create is an upsert, and its conflict branch wrote the new packProps blob over the stored one, with the same loss as terms.update. It now reads the stored properties first and writes the merge, so both paths keep unknown keys."
```

---

### Task 3: flip the Facilities test that pinned the bug

`packages/bootstrap/src/facility-reconcile.test.ts:108-148` asserts the bug on purpose: after an operator edits the facility's display, `firstSeen` resets to the second scan's date. With Tasks 1 and 2 it fails, which is its job. It now asserts the fix.

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.test.ts:108-148`
- Modify: `packages/bootstrap/src/facility-reconcile.ts:157-167` (comment only)

**Interfaces:**
- Consumes: the fixed `terms.update` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Confirm it now fails**

Run: `cd packages/bootstrap && npx vitest run src/facility-reconcile.test.ts`

Expected: `firstSeen resets if an operator edits the term in /terminology` FAILS. `firstSeen` is `2026-08-01T00:00:00.000Z`, not `2026-08-10T00:00:00.000Z`.

- [ ] **Step 2: Rewrite the test**

Replace the comment at `:108-113` and the test at `:114-148` with:

```ts
  // An operator editing a facility's display in /terminology keeps the scan's blob. Before
  // S0 of the test catalog (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.1),
  // terms.update replaced the whole properties object and wiped firstSeen/lastSeen/reportCount,
  // and this test pinned that behaviour so the fix would have to find it.
  it('firstSeen survives an operator edit in /terminology', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]);
    await scanObservedFacilities(deps, { now: '2026-08-01T00:00:00.000Z', apply: true });

    // The operator curates the display. No managed field is supplied, so only the display changes.
    await deps.admin.terms.update('urn:openldr:default_fac', 'Dodoma', {
      system: 'urn:openldr:default_fac',
      code: 'Dodoma',
      display: 'Dodoma Regional Hospital',
      status: 'ACTIVE',
    });

    await seedPerformers(deps, [['Dodoma', 1]]);
    await scanObservedFacilities(deps, { now: '2026-08-10T00:00:00.000Z', apply: true });

    const raw = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Dodoma')
      .executeTakeFirstOrThrow();
    const props = (typeof raw.properties === 'string' ? JSON.parse(raw.properties) : raw.properties) as {
      firstSeen: string;
      lastSeen: string;
      reportCount: number;
    };
    // firstSeen is carried forward from the first scan; lastSeen and reportCount come from the
    // second scan, which counts both seeded performer rows.
    expect(props.firstSeen).toBe('2026-08-01T00:00:00.000Z');
    expect(props.lastSeen).toBe('2026-08-10T00:00:00.000Z');
    expect(props.reportCount).toBe(2);
  });
```

- [ ] **Step 3: Rewrite the comment in `facility-reconcile.ts`**

Replace `:157-167` (the paragraph beginning "⚠ `firstSeen` guarantee is WEAKER than it looks") with:

```ts
 * `firstSeen` is carried forward across re-scans (see `does not advance firstSeen on a re-scan` in
 * the test file), and it survives an operator editing this facility's display through
 * `/terminology`: `terms.update` keeps every property key it does not manage (see `firstSeen
 * survives an operator edit in /terminology`). Before 2026-09-15 that edit wiped the
 * firstSeen/lastSeen/reportCount blob and the next scan re-stamped firstSeen to "now".
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/bootstrap && npx vitest run src/facility-reconcile.test.ts`

Expected: every test in the file PASSES.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/facility-reconcile.ts
git commit -m "test(bootstrap): assert firstSeen survives a term edit now that edits keep properties" -m "This test pinned terms.update wiping the facility scan's firstSeen so the fix would have to find it. The fix has landed, so it now asserts firstSeen carries forward from the first scan, and the comment in facility-reconcile.ts that described the bug says it is fixed."
```

---

### Task 4: tell operators what an edit used to lose

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/terminology.md` (the Troubleshooting list, after the "An ontology index is empty" bullet)

**Interfaces:** none.

- [ ] **Step 1: Add the bullet**

After the line that starts `- **An ontology index is empty:**`, add:

```markdown
- **An entry lost properties after it was edited:** before 2026-09-15, saving a term here dropped every property the page does not show, such as LOINC's parts, an organism's type or a result parameter's role. Saving no longer does. Entries damaged before then stay damaged until their source is imported again: `openldr terminology import loinc <path> --accept-license` for LOINC, `openldr terminology import organisms <file>` for organisms, and `openldr terminology import parameters <file>` for result parameters.
```

- [ ] **Step 2: Check the docs tests still pass**

Run: `cd apps/studio && npx vitest run src/docs`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/terminology.md
git commit -m "docs(terminology): say what an edit used to drop and how to restore it"
```

---

### Task 5: gate and live check

**Files:** none.

- [ ] **Step 1: Run the full forced gate**

Run, from the worktree root:

```bash
pnpm turbo run typecheck --force --concurrency=4 > "$TEMP/s0-tc.txt" 2>&1; echo "typecheck exit=$?"
pnpm turbo run test --force --concurrency=4 --continue > "$TEMP/s0-test.txt" 2>&1; echo "test exit=$?"
grep -E "Tasks:|Failed:|Test timed out" "$TEMP/s0-tc.txt" "$TEMP/s0-test.txt"
```

Expected: both exit 0, typecheck `36 successful, 36 total`, tests `35 successful, 35 total`. If a package fails, grep its output for `Test timed out` and re-run that package alone before blaming the change.

- [ ] **Step 2: Report, and ask before merging**

Tell the operator what each test proves:

- **Store tests (pg-mem):** both write paths keep unknown keys and still clear a cleared managed field. pg-mem is not Postgres, so this does not prove the `jsonb` round trip on a real server.
- **Facilities test:** the facility scan's `firstSeen` survives a display edit.
- **HONEST NON-PROOF until merged:** a display edit on the running app. After a merge, prove it on the operator's Postgres with a scratch entry, and ask before creating it: create `urn:openldr:s0-check|ECO` with properties `{"organism_type":"bacteria"}` through the admin API, edit its display in the Terminology page, read `properties` back with `psql`, then delete the entry.

Merge, changelog (`pnpm make:changelog` after merging, per AGENTS.md §6) and push only when the operator asks.
