# Report Design Drafts and Published Revisions (T3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Report Designer's autosave from pushing mid-edit designs to every enrolled lab, by adopting the draft/published model forms already use.

**Architecture:** `report_designs` stays the freely-autosaved working copy and gains a `status`. A new `report_design_versions` table holds immutable snapshots. Reference-sync capture fires **only when the resulting status is published**. Lifecycle rules live in a pure module shared with the boot seed.

**Tech Stack:** TypeScript, Kysely, zod, pg-mem, vitest, React, react-i18next, Fastify, pnpm workspaces + turbo.

**Spec:** `docs/superpowers/specs/2026-08-11-report-designer-t3-draft-and-published-revisions-design.md`

**Reference implementation to mirror throughout:** `packages/forms` — `src/lifecycle.ts`, `src/store.ts` (`publish`, `update`), and `packages/db/src/migrations/internal/019_form_versions.ts`. When in doubt, do what forms does.

## Global Constraints

- **Capture fires ONLY when the resulting status is `'published'`.** This single rule is the entire hazard fix. A draft `create`/`update` must emit no `reference_change_log` record.
- **The migration MUST backfill every existing `report_designs` row to `'published'`.** `DEFAULT 'draft'` is correct for new rows and wrong for existing ones — they are live and already mirrored by labs. Backfilling draft freezes every lab's copy silently and permanently.
- **The boot seed MUST write its designs as `'published'`.** If they land as drafts, capture never fires and labs receive **zero** designs — reproducing the exact failure `packages/db/src/migrations/internal/065_report_deps_managed_origin.ts` was written to fix (central published 8 reports; each lab got 8 `reports` rows with dangling `design_id`s and a "No reports yet" page).
- **Migration number is `084`.** It was written as `083` and renumbered when `main` was merged in: the facilities branch carried two migrations (`081` and `082`), which pushed T1's to `083` and this one to `084`. Re-check `packages/db/src/migrations/internal/` on every live branch before creating the file — a numbering gap is a boot-blocking hazard, not bookkeeping (Kysely enforces strict prefix ordering by name; `packages/db/src/migrator.ts` passes no `allowUnorderedMigrations`).
- **`status` is deliberately NOT part of `hashOf`.** See Task 3 — it is a central-side authoring concept, and labs only ever receive published designs.
- **Every new i18n key must exist in `en`, `fr` AND `pt` in the same commit** — `apps/studio/src/i18n/parity.test.ts` asserts exact key-path equality.
- **Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer** to any commit.
- **Stage named paths only. Never `git add -A`** — the repository directory is shared with concurrent sessions.
- **Gate command:** `pnpm turbo run typecheck test --force --continue`. **Never pipe turbo through `tail`.**
- Working directory for every command: `D:/Projects/Repositories/openldr_ce/.worktrees/report-designer-t3`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/migrations/internal/084_report_design_versions.ts` (+ `.test.ts`) | Create — versions table, `status` column, backfill | 1 |
| `packages/db/src/migrations/internal/index.ts` | Modify — register 084 | 1 |
| `packages/db/src/schema/internal.ts` | Modify — `status` on `ReportDesignsTable`, new `ReportDesignVersionsTable` | 1 |
| `packages/report-designer/src/lifecycle.ts` (+ `.test.ts`) | Create — `computeNextDesignVersion`, `designContentFingerprint`, `designContentChanged` | 2 |
| `packages/report-designer/src/pure.ts` | Modify — re-export lifecycle | 2 |
| `packages/report-designer/src/schema.ts` | Modify — `status` on `ReportDesignSchema` | 3 |
| `packages/report-designer/src/store.ts` (+ `.test.ts`) | Modify — status round-trip, capture gating, `publish`, `listVersions` | 3, 4 |
| `packages/reporting/src/seed/report-seeds.ts` (+ `.test.ts`) | Modify — seed publishes; use the shared fingerprint | 5 |
| `apps/server/src/report-designs-routes.ts` (+ `.test.ts`) | Modify — publish + versions endpoints | 6 |
| `packages/cli/src/report-design.ts`, `packages/cli/src/program.ts` | Modify — `publish` / `versions` commands | 6 |
| `apps/studio/src/report-designer/{ReportDesignerPage,CanvasHeader}.tsx` (+ tests), `apps/studio/src/api.ts` | Modify — publish action, rename, status chip | 7 |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | Modify — new keys | 7 |

---

### Task 1: Migration 084 — versions table, status column, backfill

**Files:**
- Create: `packages/db/src/migrations/internal/084_report_design_versions.ts`
- Create: `packages/db/src/migrations/internal/084_report_design_versions.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`
- Modify: `packages/db/src/schema/internal.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `report_design_versions` (`id`, `design_id`, `version`, `name`, `paper`, `orientation`, `pages`, `parameters`, `margins`, `page_numbers`, `published_at`, `published_by`); column `report_designs.status`. TypeScript: `ReportDesignVersionsTable`, and `status: Generated<string>` on `ReportDesignsTable`. Tasks 3-4 read and write both.

- [ ] **Step 1: Confirm 084 is free**

Run:
```bash
git branch -a --format='%(refname:short)' | while read b; do echo "-- $b"; git ls-tree --name-only "$b" packages/db/src/migrations/internal/ 2>/dev/null | grep -E '08[0-9]_' ; done
```
Expected at the time of writing: `081_facility_source_and_register_state` on the facilities branch, `082_report_design_page_numbers` here, and **no** `083_` anywhere. That expectation did not hold — facilities carried `082` as well, so the file ended up as `084`. Run this check against every live branch and take the next genuinely free number.

- [ ] **Step 2: Write the failing migration test**

Create `packages/db/src/migrations/internal/084_report_design_versions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './index';

/** Runs migrations in order, pausing before 084 so a pre-existing design row can be inserted —
 *  which is the only way to test the backfill. */
async function migrateWithLegacyRow(): Promise<Kysely<any>> {
  const db = newDb().adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    if (name === '084_report_design_versions') {
      await db.insertInto('report_designs').values({
        id: 'legacy', name: 'Already live',
        pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null,
      } as never).execute();
    }
    await migration.up(db);
  }
  return db;
}

describe('084_report_design_versions', () => {
  it('backfills an existing design to published, not draft', async () => {
    // ⛔ Existing designs are live and already mirrored by labs. Left as 'draft', capture never
    // fires for them again and every lab's copy freezes silently and permanently.
    const db = await migrateWithLegacyRow();
    const row = await db.selectFrom('report_designs').select(['id', 'status']).where('id', '=', 'legacy').executeTakeFirst();
    expect(row).toEqual({ id: 'legacy', status: 'published' });
  });

  it('defaults a NEW design to draft', async () => {
    const db = await migrateWithLegacyRow();
    await db.insertInto('report_designs').values({
      id: 'fresh', name: 'New', pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null,
    } as never).execute();
    const row = await db.selectFrom('report_designs').select(['status']).where('id', '=', 'fresh').executeTakeFirst();
    expect(row).toEqual({ status: 'draft' });
  });

  it('creates report_design_versions and round-trips a snapshot', async () => {
    const db = await migrateWithLegacyRow();
    await db.insertInto('report_design_versions').values({
      id: 'rdv-1', design_id: 'legacy', version: 1, name: 'Already live',
      paper: 'A4', orientation: 'portrait',
      pages: JSON.stringify([]), parameters: JSON.stringify([]), margins: null,
      page_numbers: true, published_by: 'u1',
    } as never).execute();

    const rows = await db.selectFrom('report_design_versions')
      .select(['design_id', 'version', 'page_numbers', 'published_by']).execute();
    expect(rows).toEqual([{ design_id: 'legacy', version: 1, page_numbers: true, published_by: 'u1' }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd packages/db && npx vitest run src/migrations/internal/084_report_design_versions.test.ts
```
Expected: FAIL — pg-mem reports that column `status` (and relation `report_design_versions`) does not exist.

- [ ] **Step 4: Write the migration**

Create `packages/db/src/migrations/internal/084_report_design_versions.ts`:

```ts
import { type Kysely, sql } from 'kysely';

// Draft/published for report designs, mirroring form_definitions + form_versions (016, 019).
//
// The Report Designer autosaves 1.2s after a keystroke, and the design store captures a
// reference-sync change inside EVERY update transaction — so a mid-edit design propagated to every
// enrolled lab. Forms already solved this: the working copy stays in the main table, publishing
// snapshots into a versions table, and capture fires only when the result is published.
//
// ⛔ The backfill is not optional. `DEFAULT 'draft'` is right for new rows and WRONG for existing
// ones: they are live and already mirrored by labs, so leaving them draft means capture never fires
// for them again and every lab's copy freezes at whatever it holds — silently, and invisibly in the
// change log.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('report_designs')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .execute();

  // Every design that existed before this migration is already published, by definition.
  await db.updateTable('report_designs').set({ status: 'published' } as never).execute();

  await db.schema.createIndex('report_designs_status').ifNotExists().on('report_designs').column('status').execute();

  await db.schema
    .createTable('report_design_versions')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('design_id', 'text', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('paper', 'text', (c) => c.notNull().defaultTo('A4'))
    .addColumn('orientation', 'text', (c) => c.notNull().defaultTo('portrait'))
    .addColumn('pages', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('parameters', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('margins', 'jsonb')
    .addColumn('page_numbers', 'boolean')
    .addColumn('published_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('published_by', 'text')
    .execute();

  await db.schema
    .createIndex('report_design_versions_design_version')
    .ifNotExists().on('report_design_versions').columns(['design_id', 'version']).unique()
    .execute();

  await db.schema
    .createIndex('report_design_versions_design_id')
    .ifNotExists().on('report_design_versions').column('design_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('report_design_versions').ifExists().execute();
  await db.schema.alterTable('report_designs').dropColumn('status').execute();
}
```

- [ ] **Step 5: Register it**

In `packages/db/src/migrations/internal/index.ts`, add the import after the `m082` import:

```ts
import * as m084 from './084_report_design_versions';
```

and the entry as the last line of `internalMigrations`:

```ts
  '084_report_design_versions': { up: m084.up, down: m084.down },
```

- [ ] **Step 6: Add the TypeScript table types**

In `packages/db/src/schema/internal.ts`, add `status` to `ReportDesignsTable` after `page_numbers`:

```ts
  status: Generated<string>;
```

Add a new interface beside it:

```ts
export interface ReportDesignVersionsTable {
  id: string;
  design_id: string;
  version: number;
  name: string;
  paper: Generated<string>;
  orientation: Generated<string>;
  pages: unknown;
  parameters: unknown;
  margins: unknown | null;
  page_numbers: boolean | null;
  published_at: Generated<Date>;
  published_by: string | null;
}
```

and register it on the `InternalSchema` interface beside `report_designs`:

```ts
  report_design_versions: ReportDesignVersionsTable;
```

- [ ] **Step 7: Run the test and typecheck**

```bash
cd packages/db && npx vitest run src/migrations/internal/084_report_design_versions.test.ts
```
Expected: PASS, 3 tests.

```bash
cd packages/db && npx tsc --noEmit
```
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/084_report_design_versions.ts packages/db/src/migrations/internal/084_report_design_versions.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): add report design versions and a draft/published status

Mirrors form_definitions + form_versions. Existing designs are backfilled to
published, not left on the 'draft' default: they are live and already
mirrored by labs, so draft would freeze every lab's copy silently."
```

---

### Task 2: The lifecycle module

**Files:**
- Create: `packages/report-designer/src/lifecycle.ts`, `packages/report-designer/src/lifecycle.test.ts`
- Modify: `packages/report-designer/src/pure.ts`

**Interfaces:**
- Consumes: `ReportDesign` from `./schema`.
- Produces: `computeNextDesignVersion(existing: readonly number[]): number`; `designContentFingerprint(d: ReportDesign): string`; `designContentChanged(before: ReportDesign, after: ReportDesign): boolean`. Task 3 uses `designContentChanged`, Task 4 uses `computeNextDesignVersion`, Task 5 replaces its private `designContent` with `designContentFingerprint`.

- [ ] **Step 1: Write the failing test**

Create `packages/report-designer/src/lifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeNextDesignVersion, designContentFingerprint, designContentChanged } from './lifecycle';
import type { ReportDesign } from './schema';

const base: ReportDesign = {
  id: 'd', name: 'Design', paper: 'A4', orientation: 'portrait',
  pages: [{ id: 'p1', elements: [] }], parameters: [],
};

describe('computeNextDesignVersion', () => {
  it('starts at 1 and otherwise takes max + 1', () => {
    expect(computeNextDesignVersion([])).toBe(1);
    expect(computeNextDesignVersion([1, 2, 3])).toBe(4);
    expect(computeNextDesignVersion([3, 1, 2])).toBe(4);
  });
});

describe('designContentChanged', () => {
  it('ignores id and the stamped timestamps', () => {
    // These are envelope, not content: a re-read that stamps updated_at must not un-publish.
    expect(designContentChanged(base, { ...base, id: 'other', createdAt: 'x', updatedAt: 'y' })).toBe(false);
  });

  it('detects a rename', () => {
    // ⚠ Deliberate: a rename IS content, matching formContentChanged and report-seeds' designContent.
    // Renaming a published design therefore drops it to draft until republished.
    expect(designContentChanged(base, { ...base, name: 'Renamed' })).toBe(true);
  });

  it('detects paper, orientation, margins, pageNumbers, parameters and pages', () => {
    expect(designContentChanged(base, { ...base, paper: 'Letter' })).toBe(true);
    expect(designContentChanged(base, { ...base, orientation: 'landscape' })).toBe(true);
    expect(designContentChanged(base, { ...base, margins: { top: 1, right: 2, bottom: 3, left: 4 } })).toBe(true);
    expect(designContentChanged(base, { ...base, pageNumbers: true })).toBe(true);
    expect(designContentChanged(base, { ...base, parameters: [{ key: 'f', label: 'F' }] })).toBe(true);
    expect(designContentChanged(base, { ...base, pages: [{ id: 'p1', elements: [{ id: 'e', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 } }] }] })).toBe(true);
  });

  it('treats an unset pageNumbers and an explicit false as the same content', () => {
    // Matches report-seeds' `pageNumbers ?? false` normalisation, so the seed's drift check and the
    // store's un-publish check cannot disagree.
    expect(designContentChanged(base, { ...base, pageNumbers: false })).toBe(false);
  });

  it('is stable against key order', () => {
    const reordered = { parameters: [], pages: [{ id: 'p1', elements: [] }], orientation: 'portrait', paper: 'A4', name: 'Design', id: 'd' } as ReportDesign;
    expect(designContentFingerprint(base)).toBe(designContentFingerprint(reordered));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/report-designer && npx vitest run src/lifecycle.test.ts
```
Expected: FAIL — `Failed to resolve import "./lifecycle"`.

- [ ] **Step 3: Write the implementation**

Create `packages/report-designer/src/lifecycle.ts`:

```ts
import { canonicalJson } from '@openldr/core';
import type { ReportDesign } from './schema';

/**
 * Design lifecycle rules, mirroring `packages/forms/src/lifecycle.ts`.
 *
 * ⚠ `designContentFingerprint` is the SINGLE definition of "did this design's content change". The
 * boot seed's drift check (`packages/reporting/src/seed/report-seeds.ts`) and the store's
 * un-publish check must both use it. T1's defect was precisely two answers to that question
 * disagreeing: the seed compared a field the store did not persist, so it rewrote eight built-in
 * designs on every boot, reverting operator edits.
 */

/** `max + 1`, or 1 when nothing has been published yet. */
export function computeNextDesignVersion(existing: readonly number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

/** The product-owned content of a design. Excludes `id` and the DB-stamped timestamps, which are
 *  envelope: a re-read that restamps `updated_at` must not count as an edit.
 *
 *  `pageNumbers ?? false` normalises unset and explicit-false to one value, so a design that never
 *  set the flag and one that set it off are the same content. */
export function designContentFingerprint(d: ReportDesign): string {
  return canonicalJson({
    name: d.name,
    paper: d.paper,
    orientation: d.orientation,
    margins: d.margins ?? null,
    pageNumbers: d.pageNumbers ?? false,
    parameters: d.parameters ?? [],
    pages: d.pages ?? [],
  });
}

export function designContentChanged(before: ReportDesign, after: ReportDesign): boolean {
  return designContentFingerprint(before) !== designContentFingerprint(after);
}
```

- [ ] **Step 4: Re-export from the pure entry point**

In `packages/report-designer/src/pure.ts`, add:

```ts
export * from './lifecycle';
```

- [ ] **Step 5: Run the tests**

```bash
cd packages/report-designer && npx vitest run src/lifecycle.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/report-designer/src/lifecycle.ts packages/report-designer/src/lifecycle.test.ts packages/report-designer/src/pure.ts
git commit -m "feat(report-designer): add the design lifecycle module

One definition of 'did this design's content change', shared by the store's
un-publish check and the boot seed's drift check. T1's defect was two
answers to that question disagreeing."
```

---

### Task 3: Status on the design, and capture gating

**Files:**
- Modify: `packages/report-designer/src/schema.ts`, `packages/report-designer/src/store.ts`, `packages/report-designer/src/store.test.ts`

**Interfaces:**
- Consumes: `designContentChanged` (Task 2); `report_designs.status` (Task 1).
- Produces: `ReportDesign.status?: 'draft' | 'published'`; `create`/`update` capture only when the resulting status is published. Task 4 adds `publish` on top.

**⚠ T1's tripwire will fire, and that is correct.** `store.test.ts` asserts `Object.keys(ReportDesignSchema.shape)` equals `KNOWN_TOP_LEVEL_FIELDS`. Adding `status` breaks it deliberately — that guard exists to force exactly this review. Extend `KNOWN_TOP_LEVEL_FIELDS` **and** `EVERY_FIELD`, and read the next paragraph before touching `hashOf`.

**`status` must NOT go into `hashOf`.** `hashOf` is the content hash labs consume, and labs only ever receive published designs — a status field in the hash would be a constant from their side. More importantly the per-field hash-mutation test added in T1 iterates the *hashed* fields; `status` is a known field that is deliberately not hashed, so it belongs in `KNOWN_TOP_LEVEL_FIELDS` but not in that mutation table.

- [ ] **Step 1: Write the failing tests**

Append to `packages/report-designer/src/store.test.ts`. First add `status` to the hand-built table in `beforeEach`, after `page_numbers`:

```ts
    .addColumn('status', 'text')
```

Then the tests:

```ts
  it('round-trips status and defaults a design with no status to draft', async () => {
    const store = createReportDesignStore(db);
    await store.create({ ...makeDesign('s1', 'S'), status: 'published' });
    expect((await store.get('s1'))?.status).toBe('published');

    await store.create(makeDesign('s2', 'S'));
    expect((await store.get('s2'))?.status).toBe('draft');
  });

  it('emits NO reference-sync record for a draft write', async () => {
    // ⛔ This is the whole hazard: autosave fires 1.2s after a keystroke, and every update used to
    // capture unconditionally, so a mid-edit design propagated to every enrolled lab.
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create(makeDesign('d1', 'Draft'));
    await store.update('d1', { ...makeDesign('d1', 'Draft'), name: 'Edited' });
    expect(hashes).toEqual([]);
  });

  it('emits a record for a published write', async () => {
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create({ ...makeDesign('p1', 'Pub'), status: 'published' });
    expect(hashes).toHaveLength(1);
  });

  it('drops a published design to draft when its content changes, and stops capturing', async () => {
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    const created = await store.create({ ...makeDesign('p2', 'Pub'), status: 'published' });
    expect(hashes).toHaveLength(1);

    const updated = await store.update('p2', { ...created, name: 'Renamed' });
    expect(updated.status).toBe('draft');
    expect(hashes).toHaveLength(1); // the draft edit emitted nothing
  });

  it('does not un-publish on a no-op save', async () => {
    // Autosave fires on any dirty state; only a real content change may un-publish.
    const store = createReportDesignStore(db);
    const created = await store.create({ ...makeDesign('p3', 'Pub'), status: 'published' });
    const updated = await store.update('p3', { ...created });
    expect(updated.status).toBe('published');
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: FAIL — the tripwire fails naming `status`, and the new tests fail because status is neither persisted nor gating capture.

- [ ] **Step 3: Add `status` to the schema**

In `packages/report-designer/src/schema.ts`, inside `ReportDesignSchema`, after `pageNumbers`:

```ts
  /** Authoring state. `draft` is the working copy; `published` is what labs mirror and what the
   *  reference-sync capture is gated on. Mirrors `form_definitions.status`. */
  status: z.enum(['draft', 'published']).default('draft'),
```

- [ ] **Step 4: Extend T1's guards**

In `packages/report-designer/src/store.test.ts`, add `'status'` to `KNOWN_TOP_LEVEL_FIELDS`, and add `status: 'published'` to the `EVERY_FIELD` fixture. Do **not** add it to the hash-mutation table — see the note above.

- [ ] **Step 5: Write the implementation**

In `packages/report-designer/src/store.ts`:

Add the import:
```ts
import { designContentChanged } from './lifecycle';
```

Add `status` to `toRow`:
```ts
    status: d.status ?? 'draft',
```

Add it to `fromRow`, after `pageNumbers`:
```ts
    status: r.status === 'published' ? 'published' : 'draft',
```

Leave `hashOf` unchanged.

Replace `create`'s capture line so it is conditional:
```ts
        // Drafts are not synced. Labs mirror the published design; the eventual publish() captures
        // the final state. Mirrors packages/forms/src/store.ts.
        if (capture && persisted.status === 'published') {
          await capture.record(trx, 'report_design', d.id, 'upsert', hashOf(persisted));
        }
```

Replace `update` entirely:
```ts
    async update(id, d) {
      return db.transaction().execute(async (trx) => {
        const beforeRow = await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst();
        const before = beforeRow ? fromRow(beforeRow as Record<string, unknown>) : undefined;
        // A published design drops to draft when its CONTENT changes. Gating on content matters:
        // autosave fires on any dirty state, and a no-op save must not un-publish.
        const nextStatus = before && before.status === 'published' && !designContentChanged(before, { ...d, id })
          ? 'published'
          : 'draft';
        await trx.updateTable('report_designs')
          .set({ ...toRow({ ...d, id, status: nextStatus }) } as never)
          .where('id', '=', id).execute();
        const persisted = fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst()) as Record<string, unknown>);
        if (capture && persisted.status === 'published') {
          await capture.record(trx, 'report_design', id, 'upsert', hashOf(persisted));
        }
        return persisted;
      });
    },
```

Note `remove` keeps capturing unconditionally — a delete must reach labs whether or not the design was published, otherwise a lab keeps rendering a design central deleted.

- [ ] **Step 6: Run the tests**

```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: PASS, all tests including the restored tripwire.

- [ ] **Step 7: Commit**

```bash
git add packages/report-designer/src/schema.ts packages/report-designer/src/store.ts packages/report-designer/src/store.test.ts
git commit -m "feat(report-designer): gate reference-sync capture on published status

Autosave fires 1.2s after a keystroke and every update captured
unconditionally, so a mid-edit design reached every enrolled lab. Drafts now
emit nothing, and a content change drops a published design back to draft."
```

---

### Task 4: `publish` and `listVersions`

**Files:**
- Modify: `packages/report-designer/src/store.ts`, `packages/report-designer/src/store.test.ts`

**Interfaces:**
- Consumes: `computeNextDesignVersion` (Task 2); `report_design_versions` (Task 1).
- Produces: on `ReportDesignStore` — `publish(id: string, publishedBy?: string | null): Promise<ReportDesign>` and `listVersions(id: string): Promise<ReportDesignVersion[]>`, where `ReportDesignVersion` is `{ version: number; name: string; publishedAt: string; publishedBy: string | null }`. Tasks 6 and 7 call both.

- [ ] **Step 1: Write the failing tests**

Add the versions table to `beforeEach` in `store.test.ts`:

```ts
  await db.schema.createTable('report_design_versions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('design_id', 'text').addColumn('version', 'integer')
    .addColumn('name', 'text').addColumn('paper', 'text').addColumn('orientation', 'text')
    .addColumn('pages', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('margins', 'jsonb').addColumn('page_numbers', 'boolean')
    .addColumn('published_at', 'text').addColumn('published_by', 'text').execute();
```

Then:

```ts
  it('publish mints version 1 then 2, snapshots content, and captures', async () => {
    const { capture, hashes } = spyCapture();
    const store = createReportDesignStore(db, capture);
    await store.create({ ...makeDesign('v1', 'V'), pageNumbers: true });
    expect(hashes).toEqual([]); // created as a draft

    const published = await store.publish('v1', 'alice');
    expect(published.status).toBe('published');
    expect(hashes).toHaveLength(1);

    await store.update('v1', { ...published, name: 'Second' });
    await store.publish('v1', 'alice');

    const versions = await store.listVersions('v1');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions.map((v) => v.name)).toEqual(['Second', 'V']);
    expect(versions[0].publishedBy).toBe('alice');
  });

  it('snapshots pageNumbers and margins, not just pages', async () => {
    const store = createReportDesignStore(db);
    await store.create({ ...makeDesign('v2', 'V'), pageNumbers: true, margins: { top: 9, right: 8, bottom: 7, left: 6 } });
    await store.publish('v2', null);
    const rows = await db.selectFrom('report_design_versions').selectAll().where('design_id', '=', 'v2').execute();
    expect(rows[0].page_numbers).toBe(true);
    expect(JSON.parse(String(rows[0].margins))).toMatchObject({ top: 9, left: 6 });
  });

  it('listVersions on an unpublished design is empty, not an error', async () => {
    const store = createReportDesignStore(db);
    await store.create(makeDesign('v3', 'V'));
    expect(await store.listVersions('v3')).toEqual([]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd packages/report-designer && npx vitest run src/store.test.ts
```
Expected: FAIL — `store.publish is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/report-designer/src/store.ts`, add the import:

```ts
import { randomUUID } from 'node:crypto';
import { computeNextDesignVersion } from './lifecycle';
```

Add the version type and extend the interface:

```ts
export interface ReportDesignVersion {
  version: number;
  name: string;
  publishedAt: string;
  publishedBy: string | null;
}
```

```ts
export interface ReportDesignStore {
  list(): Promise<ReportDesign[]>;
  get(id: string): Promise<ReportDesign | undefined>;
  create(d: ReportDesign): Promise<ReportDesign>;
  update(id: string, d: ReportDesign): Promise<ReportDesign>;
  publish(id: string, publishedBy?: string | null): Promise<ReportDesign>;
  listVersions(id: string): Promise<ReportDesignVersion[]>;
  remove(id: string): Promise<void>;
}
```

Add the two methods to the store object, mirroring `packages/forms/src/store.ts`'s `publish`:

```ts
    /** Snapshot the current design as the next immutable revision and mark it published.
     *  Capture happens HERE and, for a draft, nowhere else — this is the deliberate act that
     *  reaches labs. */
    async publish(id, publishedBy = null) {
      return db.transaction().execute(async (trx) => {
        const row = await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst();
        if (!row) throw new Error(`report design not found: ${id}`);
        const design = fromRow(row as Record<string, unknown>);

        const existing = await trx.selectFrom('report_design_versions').select(['version']).where('design_id', '=', id).execute();
        const version = computeNextDesignVersion(existing.map((v) => Number(v.version)));

        await trx.insertInto('report_design_versions').values({
          id: `rdv-${randomUUID()}`,
          design_id: id,
          version,
          name: design.name,
          paper: design.paper,
          orientation: design.orientation,
          pages: JSON.stringify(design.pages),
          parameters: JSON.stringify(design.parameters),
          margins: design.margins ? JSON.stringify(design.margins) : null,
          page_numbers: design.pageNumbers ?? null,
          published_by: publishedBy,
        } as never).execute();

        await trx.updateTable('report_designs').set({ status: 'published' } as never).where('id', '=', id).execute();

        const persisted = fromRow((await trx.selectFrom('report_designs').selectAll().where('id', '=', id).executeTakeFirst()) as Record<string, unknown>);
        if (capture) await capture.record(trx, 'report_design', id, 'upsert', hashOf(persisted));
        return persisted;
      });
    },
    async listVersions(id) {
      const rows = await db.selectFrom('report_design_versions').selectAll()
        .where('design_id', '=', id).orderBy('version', 'desc').execute();
      return rows.map((r) => ({
        version: Number(r.version),
        name: String(r.name),
        publishedAt: String(r.published_at),
        publishedBy: r.published_by == null ? null : String(r.published_by),
      }));
    },
```

- [ ] **Step 4: Run the tests**

```bash
cd packages/report-designer && npx vitest run
```
Expected: PASS, whole package.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/store.ts packages/report-designer/src/store.test.ts
git commit -m "feat(report-designer): add publish and listVersions

Publishing snapshots the design as the next immutable revision, marks it
published, and captures for reference sync — the deliberate act that reaches
labs, mirroring packages/forms/src/store.ts."
```

---

### Task 5: The seed publishes, and shares one definition of "changed"

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts`, `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: `designContentFingerprint` (Task 2); `status` on `ReportDesign` (Task 3).
- Produces: nothing downstream.

**⛔ This is the highest-risk task in the slice.** `seedDataDrivenReports` writes `SEED_DESIGNS` straight through the store. Now that capture is gated on published status, designs seeded as drafts emit nothing and **labs receive zero designs** — reproducing exactly what `065_report_deps_managed_origin.ts` was written to fix.

- [ ] **Step 1: Write the failing tests**

Add to `packages/reporting/src/seed/report-seeds.test.ts`, using its existing `fakeDeps` helper:

```ts
  it('seeds every built-in design as PUBLISHED', async () => {
    // ⛔ Capture is gated on published status. A built-in seeded as a draft emits no reference
    // change, so labs receive ZERO designs — the exact failure migration 065 was written to fix
    // (central published 8 reports, each lab got 8 rows with dangling design_ids).
    const { deps, designs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    for (const d of SEED_DESIGNS) {
      expect((designs.get(d.id) as { status?: string } | undefined)?.status).toBe('published');
    }
  });

  it('is still idempotent once designs carry a status', async () => {
    const { deps } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const second = await seedDataDrivenReports(deps);
    expect(second.designsUpdated).toBe(0);
    const third = await seedDataDrivenReports(deps);
    expect(third.designsUpdated).toBe(0);
  });
```

- [ ] **Step 2: Run them to verify the first fails**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts
```
Expected: FAIL on the published assertion (`undefined` is not `'published'`). The idempotence test should already pass.

- [ ] **Step 3: Write the implementation**

In `packages/reporting/src/seed/report-seeds.ts`:

Replace the private `designContent` function with the shared one — change its body to delegate, so the seed and the store cannot drift:

```ts
import { designContentFingerprint } from '@openldr/report-designer/pure';
```

**Delete the private `designContent` function entirely** and call the shared one at its use sites. A wrapper that only forwards to another function is indirection without benefit — the point of this change is that there is exactly ONE definition, and leaving a local alias invites the two to drift apart again later.

Then in the seed loop, use the shared fingerprint directly and stamp the status on both paths:

```ts
    const existing = await deps.designs.get(d.id);
    if (!existing) {
      await deps.designs.create({ ...d, status: 'published' });
      designsSeeded += 1;
      // ⛔ `status: 'published'` is not cosmetic. Capture is gated on published status, so a
      // built-in seeded as a draft emits no reference change and labs receive ZERO designs.
    } else if (designContentFingerprint(existing) !== designContentFingerprint(d)) {
      await deps.designs.update(d.id, { ...d, status: 'published' });
      designsUpdated += 1;
    }
```

Check for other callers of `designContent` before deleting it (`grep -n "designContent" packages/reporting/src/seed/report-seeds.ts`) and update each to the shared function.

⚠ `status` is deliberately absent from `designContentFingerprint`, so stamping it cannot itself trigger drift on the next boot.

- [ ] **Step 4: Run the tests**

```bash
cd packages/reporting && npx vitest run
```
Expected: PASS, whole package.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "fix(reporting): seed built-in designs as published

Capture is now gated on published status, so a built-in seeded as a draft
would emit no reference change and labs would receive zero designs — the
failure migration 065 exists to prevent. The drift check now delegates to
the shared lifecycle fingerprint so it cannot disagree with the store."
```

---

### Task 6: Publish over the API and the CLI

**Files:**
- Modify: `apps/server/src/report-designs-routes.ts`, `apps/server/src/report-designs-routes.test.ts`
- Modify: `packages/cli/src/report-design.ts`, `packages/cli/src/program.ts`

**Interfaces:**
- Consumes: `publish`, `listVersions` (Task 4).
- Produces: `POST /api/report-designs/:id/publish` → the published design; `GET /api/report-designs/:id/versions` → `ReportDesignVersion[]`. CLI `report-design publish <id>` and `report-design versions <id>`. Task 7 calls both endpoints.

- [ ] **Step 1: Write the failing route tests**

Add to `apps/server/src/report-designs-routes.test.ts`, following its existing fixtures:

```ts
  it('publishes a design and records an audit event', async () => {
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/rd1/publish' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('published');
    expect(ctx.__auditEvents.some((e: any) => e.action === 'report-design.publish')).toBe(true);
  });

  it('404s publishing a design that does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/report-designs/nope/publish' });
    expect(res.statusCode).toBe(404);
  });

  it('lists versions, newest first', async () => {
    await app.inject({ method: 'POST', url: '/api/report-designs', payload: minimal });
    await app.inject({ method: 'POST', url: '/api/report-designs/rd1/publish' });
    const res = await app.inject({ method: 'GET', url: '/api/report-designs/rd1/versions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].version).toBe(1);
  });
```

If the test file's fake store lacks `publish`/`listVersions`, add them to that fake — it must model the real contract (version numbers ascending, status flipping to published), not stub them to constants.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd apps/server && npx vitest run src/report-designs-routes.test.ts
```
Expected: FAIL — 404 on the publish route (it does not exist yet).

- [ ] **Step 3: Add the routes**

In `apps/server/src/report-designs-routes.ts`, after the `PUT` handler:

```ts
  app.post('/api/report-designs/:id/publish', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDesigns.publish(id, req.user?.id ?? null);
    await recordAudit(ctx, req, { action: 'report-design.publish', entityType: 'report-design', entityId: id, before, after });
    return after;
  });

  app.get('/api/report-designs/:id/versions', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const design = await ctx.reportDesigns.get(id);
    if (!design) { reply.code(404); return { error: 'not found' }; }
    return ctx.reportDesigns.listVersions(id);
  });
```

- [ ] **Step 4: Add the CLI commands**

In `packages/cli/src/report-design.ts`, add two pure handlers beside the existing ones:

```ts
export async function publishDesign(store: ReportDesignStore, id: string, write: Writer = stdout): Promise<void> {
  const d = await store.publish(id, 'cli');
  write(`published ${d.id}\n`);
}

export async function listDesignVersions(store: ReportDesignStore, id: string, opts: { json: boolean }, write: Writer = stdout): Promise<void> {
  const versions = await store.listVersions(id);
  if (opts.json) { write(JSON.stringify(versions, null, 2) + '\n'); return; }
  const lines = versions.map((v) => `v${v.version}\t${v.publishedAt}\t${v.publishedBy ?? '-'}\t${v.name}`);
  write((lines.length ? lines.join('\n') : '(no published versions)') + '\n');
}
```

and two entrypoints matching the existing style:

```ts
export async function runPublish(id: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await publishDesign(ctx.reportDesigns, id); return 0; } finally { await ctx.close(); }
}

export async function runVersions(id: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try { await listDesignVersions(ctx.reportDesigns, id, opts); return 0; } finally { await ctx.close(); }
}
```

In `packages/cli/src/program.ts`, extend the import on line 9:

```ts
import { runList as runReportDesignList, runDelete as runReportDesignDelete, runPublish as runReportDesignPublish, runVersions as runReportDesignVersions } from './report-design';
```

and add the two commands inside the existing `report-design` group (after the `delete` command, around line 547), matching that group's exact error-handling idiom:

```ts
  reportDesign.command('publish <id>').description('Publish the design as a new immutable revision').action(async (id: string) => {
    try { process.exitCode = await runReportDesignPublish(id); } catch (err) { process.stderr.write(`report-design publish failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
  reportDesign.command('versions <id>').description('List a design\'s published revisions').option('--json', 'emit JSON', false).action(async (id: string, opts: { json: boolean }) => {
    try { process.exitCode = await runReportDesignVersions(id, opts); } catch (err) { process.stderr.write(`report-design versions failed: ${redactError(err)}\n`); process.exitCode = 1; }
  });
```

- [ ] **Step 5: Run the suites and lint**

```bash
cd apps/server && npx vitest run src/report-designs-routes.test.ts
cd packages/cli && npx vitest run
cd apps/server && npx eslint src/report-designs-routes.ts
```
Expected: all green; eslint silent.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/report-designs-routes.ts apps/server/src/report-designs-routes.test.ts packages/cli/src/report-design.ts packages/cli/src/program.ts
git commit -m "feat(server,cli): publish a report design revision

POST /api/report-designs/:id/publish and GET .../versions, plus the CLI
equivalents so the operator surface keeps parity."
```

---

### Task 7: The designer shows and controls publication state

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/report-designer/ReportDesignerPage.tsx`, `apps/studio/src/report-designer/CanvasHeader.tsx`, and their tests
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: the two endpoints from Task 6.
- Produces: nothing downstream.

- [ ] **Step 1: Add the i18n keys to all three files**

`en.ts`, in the `reportDesigner` block:

```ts
    publishRevision: 'Publish revision',
    createReportFrom: 'Create report from this design',
    statusDraft: 'Draft',
    statusPublished: 'Published',
    publishedToast: 'Published {{name}}',
```

`fr.ts`:

```ts
    publishRevision: 'Publier une révision',
    createReportFrom: 'Créer un rapport à partir de ce modèle',
    statusDraft: 'Brouillon',
    statusPublished: 'Publié',
    publishedToast: '{{name}} publié',
```

`pt.ts`:

```ts
    publishRevision: 'Publicar revisão',
    createReportFrom: 'Criar relatório a partir deste modelo',
    statusDraft: 'Rascunho',
    statusPublished: 'Publicado',
    publishedToast: '{{name}} publicado',
```

⚠ The existing `reportDesigner.publishAsReport` key stays — it is now rendered with `createReportFrom`'s text. Do not delete it unless nothing references it; check with `grep -rn "publishAsReport" apps/studio/src`.

- [ ] **Step 2: Verify parity before writing component code**

```bash
cd apps/studio && npx vitest run src/i18n/parity.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 3: Write the failing tests**

In `apps/studio/src/report-designer/CanvasHeader.test.tsx` — its `setup` helper needs the new props (`status`, `onPublishRevision`); add them to the props object:

```ts
  it('shows the design status alongside the save status', async () => {
    setup({ status: 'draft' });
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('offers Publish revision separately from creating a report', async () => {
    const props = setup();
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /publish revision/i }));
    expect(props.onPublishRevision).toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: /^publish$/i })).not.toBeInTheDocument();
  });
```

In `apps/studio/src/report-designer/ReportDesignerPage.test.tsx`, using its `renderPage`/`openKebab` helpers and the `../api` mock (add `publishReportDesign` to that mock):

```ts
  it('publishes the open design and reflects the new status', async () => {
    await renderPage('rt-amr-summary');
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /publish revision/i }));
    await waitFor(() => expect(publishReportDesign).toHaveBeenCalledWith('rt-amr-summary'));
  });
```

- [ ] **Step 4: Run them to verify they fail**

```bash
cd apps/studio && npx vitest run src/report-designer/CanvasHeader.test.tsx src/report-designer/ReportDesignerPage.test.tsx
```
Expected: FAIL — no `Draft` text, no `Publish revision` menu item.

- [ ] **Step 5: Add the API client functions**

In `apps/studio/src/api.ts`, beside the existing report-design functions (find them with `grep -n "ReportDesign" apps/studio/src/api.ts`), add:

The neighbouring report-design functions (around line 1519) use `authFetch` + `okJson`, and `jbody(body, method)` only when there is a body. A bodyless POST therefore passes the method directly:

```ts
export const publishReportDesign = (id: string): Promise<ReportDesign> =>
  authFetch(`/api/report-designs/${encodeURIComponent(id)}/publish`, { method: 'POST' }).then((r) => okJson<ReportDesign>(r, 'publish report design'));
```

Check `jbody`'s signature before assuming; if it accepts an empty body cleanly, prefer whichever form the file's other bodyless POSTs already use.

- [ ] **Step 6: Wire the header**

In `apps/studio/src/report-designer/CanvasHeader.tsx`:

Add to the props interface:
```ts
  status?: 'draft' | 'published';
  onPublishRevision(): void;
```

Beside the existing save-status chip, render the design status:
```tsx
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t(props.status === 'published' ? 'reportDesigner.statusPublished' : 'reportDesigner.statusDraft')}
        </span>
```

Rename the existing publish item's label and add the new action above it:
```tsx
            <DropdownMenuItem onSelect={props.onPublishRevision}><Upload className="mr-2 h-4 w-4" /> {t('reportDesigner.publishRevision')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onPublishAsReport}><FileText className="mr-2 h-4 w-4" /> {t('reportDesigner.createReportFrom')}</DropdownMenuItem>
```

Import `Upload` from `lucide-react` alongside the existing icons.

- [ ] **Step 7: Wire the page**

In `apps/studio/src/report-designer/ReportDesignerPage.tsx`, import `publishReportDesign` from `../api`, add the handler beside `onPublishAsReport`:

```ts
  // Publishing is the deliberate act that reaches labs — autosave only ever writes a draft.
  const onPublishRevision = async () => {
    if (!template) return;
    if (transientIds.has(template.id)) { toast.info(t('reportDesigner.saveBeforePublish')); return; }
    try {
      flushOpen(); // publish the saved state, not a stale one
      const published = await publishReportDesign(template.id);
      setTemplates((ts) => upsert(ts, published));
      // No version number here on purpose: the publish endpoint returns the DESIGN, not the version
      // it minted. Interpolating a guessed number would be wrong from v2 onward.
      toast.success(t('reportDesigner.publishedToast', { name: published.name }));
    } catch (e) { fail(e); }
  };
```

and pass both new props where `CanvasHeader` is rendered:

```tsx
                status={template?.status} onPublishRevision={() => void onPublishRevision()}
```

- [ ] **Step 8: Run the tests**

```bash
cd apps/studio && npx vitest run src/report-designer src/i18n
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/report-designer/CanvasHeader.tsx apps/studio/src/report-designer/ReportDesignerPage.tsx apps/studio/src/report-designer/CanvasHeader.test.tsx apps/studio/src/report-designer/ReportDesignerPage.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): publish a revision, and show whether a design is a draft

Autosave now only ever writes a draft, so the author needs to see that state
and have a deliberate way to leave it. The pre-existing Publish action made
a report record, not a revision — renamed to say so."
```

---

### Task 8: Full gate

**Files:** none modified.

- [ ] **Step 1: Run the gate**

```bash
pnpm turbo run typecheck test --force --continue
```
`--continue` surfaces every failing package in one pass. **Do not pipe through `tail`.**

- [ ] **Step 2: Triage before blaming this slice**

Grep the output for `Test timed out` — gate failures in this repo are frequently parallel-execution flakes. Re-run any failing package alone with `cd packages/<name> && npx vitest run`; if it passes in isolation it was a flake, and say so. If it fails in isolation it is a real regression.

Pay particular attention to `@openldr/bootstrap` and `@openldr/db`: the store's interface grew, so any fake or partial implementation of `ReportDesignStore` elsewhere must gain `publish`/`listVersions` or it will not typecheck.

- [ ] **Step 3: Confirm the tree**

```bash
git status --short
git log --oneline slice/report-designer-trust..HEAD
```
Expected: clean tree; the spec commit plus seven implementation commits. Delete any generated `apps/web/vite.config.ts.timestamp-*.mjs`.

---

## Definition of Done

- A draft `create`/`update` emits no `reference_change_log` record; publishing emits exactly one.
- Editing a published design drops it to draft; a no-op save does not.
- `publish` mints 1 then 2, snapshots `pageNumbers` and `margins`, and leaves earlier versions untouched.
- Every built-in design is seeded **published**, and the seed remains idempotent across three runs.
- The migration backfills pre-existing designs to `published`; new rows default to `draft`.
- `report-seeds.ts` and the store share one definition of "content changed".
- `POST /api/report-designs/:id/publish` and `GET .../versions` work and are audited; CLI parity exists.
- The editor shows Draft/Published, and "Publish revision" is distinct from creating a report.
- `pnpm turbo run typecheck test --force --continue` is clean.
