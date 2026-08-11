# Report design round-trip integrity — `pageNumbers` and the guard against its recurrence

Date: 2026-08-11
Status: designed, not implemented.
Source: `docs/audit/2026-08-07-report-visual-design-audit.md` (external audit) — addendum finding
**RD-P0-04**, i.e. Designer Phase 0 item 1 ("Persist `pageNumbers`, add a store round-trip test, and
audit every schema property for the same schema/store/API/render round-trip gap").
Position: **slice T1** of five. See "The wider arc" below.

## Purpose

`ReportDesign.pageNumbers` is declared in the schema, edited in the Properties tab, and shipped as
`true` by every design `simpleTableDesign` builds — and the store drops it on the floor. The audit
reports this as a lost checkbox. It is not. The dropped field feeds a drift comparison in the boot
seed, and that comparison decides whether to overwrite a built-in design with the product's copy.

The consequence is a silent, repeating overwrite of operator work:

1. `simpleTableDesign` sets `pageNumbers: true` unconditionally
   (`packages/reporting/src/seed/simple-design.ts:125`), so 8 of the 9 `SEED_DESIGNS` entries carry
   it. The ninth — the clinical microbiology report, authored as a literal rather than through the
   builder (`report-seeds.ts:2159`) — never sets the flag, and so is the one built-in that does not
   drift.
2. `toRow` omits the field (`packages/report-designer/src/store.ts:6-16`); `fromRow` never reads it
   back (`:18-31`). The column does not exist (`packages/db/src/migrations/internal/042_report_designs.ts`).
3. The boot seed compares `designContent(existing) !== designContent(d)`
   (`packages/reporting/src/seed/report-seeds.ts:2529`), and `designContent` normalises
   `pageNumbers: d.pageNumbers ?? false` (`:2459`). Stored reads back as `undefined` → `false`;
   the product copy is `true`. **The comparison is permanently unequal.**
4. So `deps.designs.update(d.id, d)` runs on **every boot, forever**, for all 8 built-ins.

Step 4 is the damage. The comment directly above that call (`:2534`) states the accepted trade:

> ⚠ An operator who edits a built-in IN PLACE loses those edits here. That is the accepted trade:
> customise via Duplicate (⋯ menu), which mints a new id this loop never iterates.

That trade is sound when it fires on a shipped product change. Here it fires on a field the store
cannot persist, so an operator's in-place edit to any of the 8 built-in designs is reverted at every
restart, for a reason nothing surfaces.

It is invisible in sync as well. `hashOf` (`packages/report-designer/src/store.ts:43-48`) also omits
`pageNumbers`, so the repeated `update` produces an unchanged content hash and is suppressed by the
de-dupe at `packages/db/src/reference-change-log.ts:68`. The reference change log shows nothing.

The same `hashOf` omission is a second, independent defect: once the column exists, toggling page
numbers would still not change the content hash, so the change would never propagate central→lab.

This also explains the audit's observed symptom — page numbers absent from output whose design has
them enabled.

## Scope

In scope: the `pageNumbers` round trip across migration, `toRow`, `fromRow` and `hashOf`; a guard
that makes this class of defect fail loudly for future fields; and an acceptance test proving the
boot seed no longer sees drift.

Explicitly **out of scope**:

- The seed's managed-overwrite contract itself. T1 removes one spurious trigger; it does not change
  what a legitimate product change is allowed to overwrite. (Considered and deliberately declined —
  see "Rejected alternatives".)
- Draft-vs-published revisions and the autosave→reference-sync hazard — **slice T3**.
- `Check`/`Duplicate`, image `src` validation, canvas `boundColumns` — **slice T2**.
- Preflight and the publication gate — **slice T4**.
- Delete guards and optimistic concurrency — **slice T5**.
- Every element-level property. They ride inside the `pages` jsonb blob and round-trip already;
  `pageNumbers` is the only top-level field affected. This is the full answer to the audit's "audit
  every schema property" instruction, not a sample of it.

## Measured before designing

Measured 2026-08-11 in a worktree at `main` (`b4c2194e`). Every row below was read from source or
executed, not inferred from the audit.

| Fact | Value | How |
|---|---|---|
| Top-level `ReportDesignSchema` fields | 10 | read `schema.ts:115-127` |
| …present in `toRow` | 7 (`id,name,paper,orientation,pages,parameters,margins`) | read `store.ts:6-16` |
| …stamped by the store, not persisted by it | 2 (`createdAt`, `updatedAt`) | read `store.ts:28-29` |
| …**silently dropped** | **1 — `pageNumbers`** | difference of the above |
| `page_numbers` column in `report_designs` | **absent** | read migration 042; no later migration alters the table |
| `SEED_DESIGNS` entries | 9 | counted `report-seeds.ts:2010-2261` |
| …built by `simpleTableDesign` | 8 | same |
| …shipping `pageNumbers: true` | 8 (set unconditionally by the builder) | read `simple-design.ts:125` |
| …that therefore drift on every boot | 8 (the literal clinical report does not) | derived |
| `hashOf` includes `pageNumbers` | **no** | read `store.ts:43-48` |
| `canonicalHash` with key absent vs `undefined` | **identical** (`6ffddfd66fb48cc1`) | executed |
| `canonicalHash` with `false` | **differs** (`73d48a5cffe2bba7`) | executed |
| `canonicalHash` with `true` | differs from both (`f8704a050fa04342`) | executed |
| Round trip through the real store loses `pageNumbers` | **yes** | throwaway pg-mem probe, failed as predicted |
| `designContent(stored) !== designContent(seeded)` | **true** | same probe, failed as predicted |
| `referenceCapture` wired in production | yes (`index.ts:610`) | read |
| Latest migration on `main` | `080` | `ls` |
| Latest migration on `slice/facility-canonical-identity` | `081` | `git ls-tree` |

The two probe assertions were written to fail and did. The probe was deleted; its two claims become
permanent tests in this slice.

## Design

### 1. Migration `082_report_design_page_numbers`

Add a **nullable** `boolean` column `page_numbers` to `report_designs`. No backfill.

Nullability is load-bearing, not stylistic. From the measured hash table above:

- **Nullable**, with `fromRow` mapping `null → undefined`: a design that never set the flag hashes
  byte-identically to today. No reference-change record is emitted for it, so no re-pull.
- **`notNull default false`**: every such design's `hashOf` output changes the moment `pageNumbers`
  joins the hash. The next write of each emits a reference change and labs re-pull designs whose
  content did not change.

The 8 built-ins will legitimately re-propagate once, because their content genuinely changes — page
numbers begin working. That is a correct one-time propagation, not the spurious kind.

`down` drops the column.

### 2. Store — three call sites in one file

- `toRow`: `page_numbers: d.pageNumbers ?? null`
- `fromRow`: `pageNumbers: r.page_numbers == null ? undefined : Boolean(r.page_numbers)`
- `hashOf`: add `pageNumbers: d.pageNumbers`

`fromRow` must yield `undefined` rather than `false` for a null column, or the hash-identity property
above is lost.

### 3. The recurrence guard

Two halves. Neither is worth much alone, and the reason is the failure mode itself: a future field is
simply absent from any fixture, so the fixture passes while the field is dropped.

**(a) Key-set tripwire.** Assert `Object.keys(ReportDesignSchema.shape)` equals a declared literal
list. Adding a top-level field fails this test until the author acknowledges it — which is what
forces them into (b).

**(b) Exhaustive round-trip fixture.** One `ReportDesign` with every top-level field set to a
non-default value. Save → load → deep-equal, proving `toRow` and `fromRow` together. Then, per
field, mutate it and assert `hashOf` changes, proving `hashOf`. The `undefined`-vs-`false` hash
identity for `pageNumbers` gets its own assertion, since it is the property the migration choice
rests on.

The tripwire's failure message must name the fixture, so the next author is told what to do rather
than left to rediscover it.

### 4. Acceptance test — the drift is actually gone

Run the seed's design loop twice against the same store; the second run must report
`designsUpdated: 0`. This is the test that would have caught the original defect, and it is the one
that proves the operator-overwrite behaviour has stopped.

## Testing notes

- `packages/report-designer/src/store.test.ts` hand-builds its `report_designs` table rather than
  running migrations (`store.test.ts:10-18`). It must gain the `page_numbers` column, or the new
  fixture fails for the wrong reason and reads as a real defect.
- The migration needs its own `makeMigratedDb` test in the style of `042_report_designs.test.ts`.
  pg-mem hides real-Postgres behaviour, so column existence proven under pg-mem alone is not proof.
- Gate: `pnpm turbo run typecheck test --force`, never piped through `tail`.

## Rejected alternatives

**Drop `pageNumbers` from `designContent` instead of persisting it.** This silences the drift with a
one-line change and no migration. Rejected: it makes the seed unable to ever ship a page-number
change to an existing install, and it leaves the field unpersisted — the audit's actual finding —
so the checkbox still lies to the author.

**`notNull default false`.** Cleaner schema, but costs a fleet-wide re-pull of unchanged designs, as
measured. Declined on that evidence.

**Fixture without the tripwire.** Rejected: the defect being fixed is precisely "a field nobody
remembered", and a fixture nobody extends cannot catch it.

**Widening T1 to harden the managed-overwrite contract.** The permanent-drift behaviour is alarming
enough to invite this, but the contract is doing what it was designed to do; only its trigger was
wrong. Changing what a legitimate product change may overwrite is a separate decision, and it
belongs with the revision model in T3, where "published revision" gives it somewhere to stand.

## The wider arc

The audit's Designer Phase 0 is seven items, decomposed into five slices:

| Slice | Covers | Depends on |
|---|---|---|
| **T1** (this) | Round-trip integrity | — |
| **T2** | Canvas `boundColumns`; image `src` validated at write time; `Duplicate` implemented; `Check` disabled with an explanation rather than wired | — (parallel with T1) |
| **T3** | Draft vs immutable published revision; report defs pin a revision; autosave stops emitting reference-sync records | T1 |
| **T4** | Preflight; publication gate; preview/diagnostic/official PDFs distinguished | T3, completes T2's `Check` |
| **T5** | Delete guard; archive over delete; optimistic concurrency (409) | T3 |

T3 carries the live hazard: `createReportDesignStore(internal.db, referenceCapture)` records a
reference change inside every `update` transaction, and autosave fires 1.2 s after a keystroke, so
mid-edit designs propagate to labs. T1 is sequenced first only because T3's revision snapshot must
carry every field, and today it would not.

## Known limits

- T1 does not stop the boot seed from overwriting an operator's in-place edit to a built-in when the
  product *does* ship a change. That remains the documented trade.
- `pageNumbers` becomes correct; whether "Page X of Y" renders well is a P1-05 concern in the main
  audit, untouched here.

## Coordination

Migration number **082**. `081` is taken by `slice/facility-canonical-identity`, which is unmerged.
A third concurrent session claiming `082` would collide at merge — check
`packages/db/src/migrations/internal/` against every live branch before writing the file.

⛔ **The `081` gap is also a runtime hazard, which this spec originally missed.** `createMigrator`
(`packages/db/src/migrator.ts:5-10`) builds `new Migrator({ db, provider })` with no
`allowUnorderedMigrations`; Kysely 0.28.17 defaults it to `false`, sorts migrations by name, and
requires the executed set to be a strict prefix. A database that applies `082` without `081` and is
later upgraded to a build containing `081` throws `corrupted migrations` — and since `apps/server`
self-migrates on startup, that server will not boot. `makeMigratedDb` iterates
`Object.values(internalMigrations)` and never invokes Kysely's `Migrator`, so no test in this
repository can catch it.

**Resolution: merge `slice/facility-canonical-identity` first**, so `main` only ever sees `081` then
`082` in order. Until then, do not boot a server or run migrations against a persistent database from
this worktree. Worth a standing decision beyond this slice: the repository runs concurrent branches
that each claim migration numbers, so this will recur — `allowUnorderedMigrations: true` is the flag
Kysely provides for exactly that, but it changes migration semantics repo-wide.

Both this slice and the facilities work edit `apps/studio/src/i18n/{en,fr,pt}.ts` if any user-facing
string appears. Stage named paths only; never `git add -A`.
