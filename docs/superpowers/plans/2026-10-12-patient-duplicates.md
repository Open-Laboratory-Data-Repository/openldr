# Patient Duplicate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List likely duplicate patients with their evidence, let a manager mark a group "not duplicates", and export the open groups for the source system's team. CE does not merge.

**Architecture:** The Patient projector stores a normalised `match_key` on `patients` (external migration 026). A new bootstrap module, `patient-duplicates.ts`, finds groups with two GROUP BY queries (shared identifier, shared `match_key`), drops fully dismissed groups using a new internal table (internal migration 111), and builds member rows through `PatientIndex.rowsByIds`, so masking stays in one place. Routes, CLI and a studio tab sit on top.

**Tech Stack:** Kysely (Postgres, MySQL, MSSQL warehouse; Postgres internal db; pg-mem in tests), Fastify, commander, React with shadcn and Radix, i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-patient-duplicates-design.md`

## Global Constraints

- Work in `.claude/worktrees/patient-duplicates` on branch `feat/patient-duplicates`. Stage by exact path. Never `git add <dir>` or `-A`.
- No `Co-Authored-By` trailer on any commit.
- External migration is exactly `026_patient_match_key`. Internal migration is exactly `111_patient_duplicate_dismissals`.
- A group is two or more patients with `active = true` and `replaced_by_id is null` that share one key.
- Rule 1 skips identifiers with a null system and systems marked not searchable.
- Rule 2 needs surname, first name and date of birth all present. Sexes are compatible when equal or when either is null.
- A group is hidden from `open` only when every compatible pair in it is dismissed.
- Without `patients.view_identifiers`, nothing in a response may contain a name, identifier value, full date of birth or raw patient id. Member rows come from `PatientIndex.rowsByIds`; do not copy masking code.
- Capabilities: list needs `patients.view`; dismiss and restore need `patients.manage`; export needs `patients.view_identifiers`. No new capability.
- Audit never records search text or export contents.
- Studio follows `AGENTS.md` §5: actions in `⋯` menus, Sheets, label left and input right, `StripedEmpty`, `LoadingState`, `TablePagination`, shadcn only. Guard loads against stale responses.
- Every studio string goes into `en.ts`, `fr.ts` and `pt.ts` in the same task.
- No em dashes in new prose, comments or strings.
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.

## Review Focus

- A name over 200 characters must not break the insert on MySQL or SQL Server. `match_key` goes through `boundedRowId`, which hashes long keys. Pinned in Task 1.
- Three members where one sex conflicts (M, F, null) must still report a group, and its pairs must be only the compatible ones. Pinned in Task 3.
- Dismissing a pair given in either order must hit the same row. Pinned in Task 2 and Task 3.
- A masked group response must not leak through its evidence text. The evidence is built from the already-masked member row. Pinned in Task 3 with a whole-JSON check.
- `/api/patients/duplicates` must not be read as a patient ref. Pinned in Task 4.

---

### Task 0: Commit the spec

**Files:**
- Commit: `docs/superpowers/specs/2026-10-12-patient-duplicates-design.md` (already written, uncommitted)

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-patient-duplicates-design.md docs/superpowers/plans/2026-10-12-patient-duplicates.md
git commit -m "docs: patient duplicate detection design and plan"
```

---

### Task 1: `patients.match_key`

**Files:**
- Create: `packages/db/src/migrations/external/026_patient_match_key.ts`
- Create: `packages/db/src/migrations/external/026_patient_match_key.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts:15`
- Modify: `packages/db/src/schema/external.ts` (`PatientsTable`, `EXTERNAL_TABLE_COLUMNS.patients`)
- Modify: `packages/db/src/relational/patient.ts`
- Test: `packages/db/src/relational/patient.test.ts`
- Modify: `packages/dashboards/src/models/registry.ts` (`patients` in `HARDCODED_DENY_UNION` and `PII_COLUMNS`)

**Interfaces:**
- Produces: column `patients.match_key` (nullable); `patientMatchKey(surname: string | null, firstname: string | null, dob: string | null): string | null` exported from `packages/db/src/relational/patient.ts`; `projectPatient` returns `match_key`.

- [ ] **Step 1: Write the failing migration test**

`packages/db/src/migrations/external/026_patient_match_key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m026 from './026_patient_match_key';

// pg-mem checks the column on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// compilers. Neither proves a real MySQL or SQL Server accepts it.
describe('026_patient_match_key', () => {
  it('adds match_key to patients with an index', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const table = mem.public.getTable('patients');
    const columns = (table as unknown as { listColumns(): Array<{ id: string }> }).listColumns().map((c) => c.id);
    expect(columns).toContain('match_key');
    expect(table.listIndices().map((i) => i.name)).toContain('patients_match_key_idx');
  });

  it('down() drops the column', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m026.down(db);
    const columns = (mem.public.getTable('patients') as unknown as { listColumns(): Array<{ id: string }> }).listColumns().map((c) => c.id);
    expect(columns).not.toContain('match_key');
  });

  it('uses a key-sized column on MySQL and MSSQL', async () => {
    const mysql = await collectCompiledSql('mysql', (db) => m026.up(db, 'mysql'));
    expect(mysql[0]).toBe('alter table `patients` add column `match_key` varchar(255)');
    expect(mysql[1]).toBe('create index `patients_match_key_idx` on `patients` (`match_key`)');
    const mssql = await collectCompiledSql('mssql', (db) => m026.up(db, 'mssql'));
    expect(mssql[0]).toBe('alter table "patients" add "match_key" varchar(450)');
    expect(mssql[1]).toBe('create index "patients_match_key_idx" on "patients" ("match_key")');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/external/026_patient_match_key.test.ts`
Expected: FAIL, cannot resolve `./026_patient_match_key`.

- [ ] **Step 3: Write and register the migration**

`packages/db/src/migrations/external/026_patient_match_key.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// Patient duplicate detection (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md,
// section 2). The projector stores a normalised surname|firstname|dob here, so finding patients with
// the same details is a GROUP BY. Normalising in SQL is not portable: stripping accents needs an
// extension on Postgres and collations on MySQL and SQL Server. Key-sized so it can be indexed.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('patients').addColumn('match_key', sql.raw(keyType(engine))).execute();
  await db.schema.createIndex('patients_match_key_idx').on('patients').column('match_key').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('patients_match_key_idx').on('patients').execute();
  await db.schema.alterTable('patients').dropColumn('match_key').execute();
}
```

If `dropIndex(...).on(...)` does not compile for Postgres in this Kysely version, use `db.schema.dropIndex('patients_match_key_idx').execute()` and note it in the report.

In `packages/db/src/migrations/external/index.ts` add `import * as m026 from './026_patient_match_key';` and the entry `'026_patient_match_key': { up: (db) => m026.up(db, engine), down: m026.down },` after `025`. In `packages/db/src/migrations/migrations.test.ts:15` append `'026_patient_match_key'` to the external list.

If Kysely compiles the MySQL or MSSQL statement with different syntax than the strings above (for example `add column` against `add`), keep the migration and change the expected string to Kysely's actual output. The point of the test is the column type and the index.

- [ ] **Step 4: Add the schema column**

In `packages/db/src/schema/external.ts`, add to `PatientsTable` after `replaced_by_id`:

```ts
  /** Normalised surname|firstname|dob for duplicate detection (migration 026). Null when any part is
   *  missing. Written by the projector, never by hand. */
  match_key: string | null;
```

In `EXTERNAL_TABLE_COLUMNS.patients`, insert `'match_key'` after `'replaced_by_id'`.

- [ ] **Step 5: Write the failing projector tests**

Append to `packages/db/src/relational/patient.test.ts`:

```ts
import { patientMatchKey } from './patient';

describe('patientMatchKey', () => {
  it('lowercases, strips accents and collapses spaces', () => {
    expect(patientMatchKey('  Mwanza ', 'Émile  Jean', '1990-01-05')).toBe('mwanza|emile jean|1990-01-05');
    expect(patientMatchKey('MWANZA', 'emile jean', '1990-01-05')).toBe(patientMatchKey('mwanza', 'Émile Jean', '1990-01-05'));
  });

  it('is null when any part is missing or blank', () => {
    expect(patientMatchKey(null, 'A', '1990')).toBeNull();
    expect(patientMatchKey('B', '  ', '1990')).toBeNull();
    expect(patientMatchKey('B', 'A', null)).toBeNull();
  });

  it('keeps a partial date as given', () => {
    expect(patientMatchKey('B', 'A', '1990')).toBe('b|a|1990');
  });

  it('hashes a key too long for a key-sized column', () => {
    const key = patientMatchKey('x'.repeat(300), 'A', '1990') as string;
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key).toMatch(/^mk-/);
    expect(patientMatchKey('x'.repeat(300), 'A', '1990')).toBe(key);
  });
});

describe('projectPatient match_key', () => {
  it('stores the key from the first name entry and birth date', () => {
    const out = projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Banda', given: ['Ruth'] }], birthDate: '1985-02-03' }, {});
    expect(out.match_key).toBe('banda|ruth|1985-02-03');
  });

  it('stores null without a birth date', () => {
    expect(projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'Banda', given: ['Ruth'] }] }, {}).match_key).toBeNull();
  });
});
```

- [ ] **Step 6: Run and see it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/patient.test.ts`
Expected: FAIL, `patientMatchKey` is not exported.

- [ ] **Step 7: Write the key and project it**

In `packages/db/src/relational/patient.ts`, add above `projectPatient`:

```ts
/** One normalised name part: accents removed, lowercase, single spaces. Null when blank. */
function normaliseNamePart(s: string | null): string | null {
  if (!s) return null;
  const out = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return out || null;
}

/** surname|firstname|dob for duplicate detection (patient duplicates spec, section 1). Null when any
 *  part is missing: a name with no date of birth matches too many unrelated people. boundedRowId keeps
 *  it readable when short and hashes it when it would not fit a key-sized column. */
export function patientMatchKey(surname: string | null, firstname: string | null, dob: string | null): string | null {
  const s = normaliseNamePart(surname);
  const f = normaliseNamePart(firstname);
  const d = dob?.trim() || null;
  if (!s || !f || !d) return null;
  return boundedRowId([s, f, d], 'mk');
}
```

In `projectPatient`, compute the name parts once and add `match_key`. Replace the `surname`, `firstname` and `date_of_birth` lines with:

```ts
    surname: str(name?.['family']),
    firstname: str((name?.['given'] as string[] | undefined)?.[0]),
    date_of_birth: str(r['birthDate']),
    match_key: patientMatchKey(str(name?.['family']), str((name?.['given'] as string[] | undefined)?.[0]), str(r['birthDate'])),
```

- [ ] **Step 8: Hide it from analytics**

In `packages/dashboards/src/models/registry.ts`, append `'match_key'` to the `patients` arrays in both `HARDCODED_DENY_UNION` and `PII_COLUMNS`. It holds a name and a date of birth.

- [ ] **Step 9: Run the db and dashboards tests**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations src/relational src/export-data.test.ts src/relational-writer.test.ts src/reference-search.test.ts`
Expected: PASS. If a test pins the patients column list, add `match_key`.
Run: `pnpm --filter @openldr/dashboards exec vitest run`
Expected: PASS. `registry.test.ts` pins `patients` deny entries; add `match_key` there if it fails.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/migrations/external/026_patient_match_key.ts packages/db/src/migrations/external/026_patient_match_key.test.ts packages/db/src/migrations/external/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/external.ts packages/db/src/relational/patient.ts packages/db/src/relational/patient.test.ts packages/dashboards/src/models/registry.ts
git commit -m "feat(db): patients.match_key for duplicate detection"
```

Add any test file Step 9 changed to the `git add`.

---

### Task 2: Dismissals table

**Files:**
- Create: `packages/db/src/migrations/internal/111_patient_duplicate_dismissals.ts`
- Create: `packages/db/src/migrations/internal/111_patient_duplicate_dismissals.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (import near `:111`, entry near `:224`)
- Modify: `packages/db/src/migrations/migrations.test.ts:7`
- Modify: `packages/db/src/schema/internal.ts` (`InternalSchema`)

**Interfaces:**
- Produces: table `patient_duplicate_dismissals(patient_a, patient_b, reason, dismissed_by, dismissed_at)`, primary key `(patient_a, patient_b)`; `InternalSchema.patient_duplicate_dismissals`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/migrations/internal/111_patient_duplicate_dismissals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './111_patient_duplicate_dismissals';

describe('111_patient_duplicate_dismissals', () => {
  it('stores one row per pair and rejects the same pair twice', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('patient_duplicate_dismissals').values({ patient_a: 'p1', patient_b: 'p2', reason: 'twins', dismissed_by: 'dev-admin' }).execute();
      await expect(db.insertInto('patient_duplicate_dismissals').values({ patient_a: 'p1', patient_b: 'p2', reason: null, dismissed_by: 'x' }).execute()).rejects.toThrow();
      const rows = await db.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b', 'reason', 'dismissed_by']).execute();
      expect(rows).toEqual([{ patient_a: 'p1', patient_b: 'p2', reason: 'twins', dismissed_by: 'dev-admin' }]);
      const at = await db.selectFrom('patient_duplicate_dismissals').select('dismissed_at').executeTakeFirstOrThrow();
      expect(at.dismissed_at).toBeInstanceOf(Date);
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('patient_duplicate_dismissals').selectAll().execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/internal/111_patient_duplicate_dismissals.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Write the migration, register it, add the type**

`packages/db/src/migrations/internal/111_patient_duplicate_dismissals.ts`:

```ts
import { type Kysely, sql } from 'kysely';

// Patient duplicate detection (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md,
// section 2). One row says two patients are different people. The ids are stored in sorted order
// (patient_a < patient_b), so a pair has one row whichever way round it was dismissed. Patients live
// in the warehouse, so there is no foreign key.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('patient_duplicate_dismissals').ifNotExists()
    .addColumn('patient_a', 'text', (c) => c.notNull())
    .addColumn('patient_b', 'text', (c) => c.notNull())
    .addColumn('reason', 'text')
    .addColumn('dismissed_by', 'text', (c) => c.notNull())
    .addColumn('dismissed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('patient_duplicate_dismissals_pk', ['patient_a', 'patient_b'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('patient_duplicate_dismissals').ifExists().execute();
}
```

In `packages/db/src/migrations/internal/index.ts` add `import * as m111 from './111_patient_duplicate_dismissals';` after the m110 import and `'111_patient_duplicate_dismissals': { up: m111.up, down: m111.down },` after the `110` entry. In `migrations.test.ts:7` append `'111_patient_duplicate_dismissals'` after `'110_lab_order_rejection'`.

In `packages/db/src/schema/internal.ts`, add to `InternalSchema` after `account_access_blocks`:

```ts
  /** Pairs of patients marked "not duplicates" (migration 111). patient_a < patient_b. */
  patient_duplicate_dismissals: {
    patient_a: string; patient_b: string; reason: string | null; dismissed_by: string; dismissed_at: Generated<Date>;
  };
```

If `Generated` is not imported in that file, import it from `kysely` as a type.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/internal/111_patient_duplicate_dismissals.ts packages/db/src/migrations/internal/111_patient_duplicate_dismissals.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/internal.ts
git commit -m "feat(db): patient_duplicate_dismissals table"
```

---

### Task 3: Duplicate detection (bootstrap)

**Files:**
- Modify: `packages/bootstrap/src/patient-index.ts` (add `rowsByIds`)
- Create: `packages/bootstrap/src/patient-duplicates.ts`
- Create: `packages/bootstrap/src/patient-duplicates.test.ts`
- Modify: `packages/bootstrap/src/test-support/patient-index-fixture.ts` (`seedPatient` writes `match_key`)
- Modify: `packages/bootstrap/src/index.ts` (AppContext field, construction after `patientIndex`, return object, barrel)

**Interfaces:**
- Consumes: `PatientIndex`, `PatientRow`, `PatientIdentifierSystems.unsearchableSystems/settingsFor`, `PatientIndexError`, `patientMatchKey` from `@openldr/db`.
- Produces:

```ts
// patient-index.ts, added to PatientIndex:
rowsByIds(ids: string[], opts: { unmask: boolean }): Promise<PatientRow[]>; // input order, missing ids skipped

// patient-duplicates.ts:
export type DuplicateRule = 'identifier' | 'details';
export type DuplicateStatus = 'open' | 'dismissed' | 'all';
export interface DuplicateGroup {
  rule: DuplicateRule;
  evidence: { system: string | null; label: string | null; text: string };
  members: PatientRow[];
  pairs: number;          // compatible pairs in the group
  dismissedPairs: number;
}
export interface DuplicateList { rows: DuplicateGroup[]; total: number; masked: boolean }
export interface PatientDuplicates {
  list(q: { status: DuplicateStatus; limit: number; offset: number }, opts: { unmask: boolean }): Promise<DuplicateList>;
  dismiss(input: { ids: string[]; reason: string | null; by: string }): Promise<{ changed: number }>;
  restore(input: { ids: string[] }): Promise<{ changed: number }>;
  exportCsv(): Promise<{ csv: string; groups: number }>;
}
export function parseDuplicateListQuery(raw: Record<string, unknown>): { ok: true; query: { status: DuplicateStatus; limit: number; offset: number } } | { ok: false; error: string };
export function parsePairInput(raw: unknown): { ok: true; refs: string[]; reason: string | null } | { ok: false; error: string };
export function createPatientDuplicates(deps: {
  internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; index: PatientIndex; systems: PatientIdentifierSystems;
}): PatientDuplicates;
```

`dismiss` and `restore` take raw patient ids. Routes turn refs into ids with `index.idForRef` first.

- [ ] **Step 1: Make the fixture write match_key**

In `packages/bootstrap/src/test-support/patient-index-fixture.ts`, import `patientMatchKey` from `@openldr/db` and add to the `seedPatient` insert values:

```ts
    match_key: patientMatchKey(p.surname ?? null, p.firstname ?? null, p.dob ?? null),
```

If `@openldr/db` does not re-export it, import it from `@openldr/db/relational` or add `patientMatchKey` to the db barrel's relational re-export, and say which in the report.

- [ ] **Step 2: Write the failing tests**

`packages/bootstrap/src/patient-duplicates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPatientIndex } from './patient-index';
import { createPatientDuplicates, parseDuplicateListQuery, parsePairInput } from './patient-duplicates';
import { buildPatientIndexFixture, seedIdentifier, seedPatient } from './test-support/patient-index-fixture';

const NRC = 'urn:zm:nrc';
const NOW = () => new Date('2026-10-12T00:00:00Z');
const OPEN = { status: 'open' as const, limit: 25, offset: 0 };

async function build() {
  const f = await buildPatientIndexFixture();
  const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, engine: 'postgres', now: NOW, refKey: randomBytes(32) });
  const dups = createPatientDuplicates({ internalDb: f.internalDb, externalDb: f.externalDb, index, systems: f.systems });
  return { ...f, index, dups };
}

describe('patient duplicates: rules', () => {
  it('groups patients sharing an identifier value in one system', async () => {
    const { externalDb, dups } = await build();
    for (const id of ['a', 'b', 'c']) await seedPatient(externalDb, { id, surname: `S${id}`, firstname: 'F', dob: '1990' });
    await seedIdentifier(externalDb, 'a', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'b', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'c', NRC, '111111/10/1');
    const out = await dups.list(OPEN, { unmask: true });
    expect(out.total).toBe(1);
    expect(out.rows[0]).toMatchObject({ rule: 'identifier', evidence: { system: NRC, text: '998877/10/1' }, pairs: 1, dismissedPairs: 0 });
    expect(out.rows[0].members.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('puts three patients sharing one identifier in one group with three pairs', async () => {
    const { externalDb, dups } = await build();
    for (const id of ['a', 'b', 'c']) { await seedPatient(externalDb, { id }); await seedIdentifier(externalDb, id, NRC, 'X1'); }
    const out = await dups.list(OPEN, { unmask: true });
    expect([out.total, out.rows[0].members.length, out.rows[0].pairs]).toEqual([1, 3, 3]);
  });

  it('ignores null-system identifiers, non-searchable systems, and inactive or merged patients', async () => {
    const { externalDb, systems, dups } = await build();
    await seedPatient(externalDb, { id: 'a' }); await seedPatient(externalDb, { id: 'b' });
    await seedPatient(externalDb, { id: 'gone', active: false }); await seedPatient(externalDb, { id: 'merged', replacedBy: 'a' });
    await seedIdentifier(externalDb, 'a', null, 'FOLDER-1'); await seedIdentifier(externalDb, 'b', null, 'FOLDER-1');
    await seedIdentifier(externalDb, 'a', 'urn:x', 'Q'); await seedIdentifier(externalDb, 'b', 'urn:x', 'Q');
    await systems.set({ system: 'urn:x', label: null, listColumn: false, searchable: false });
    await seedIdentifier(externalDb, 'a', NRC, 'N'); await seedIdentifier(externalDb, 'gone', NRC, 'N'); await seedIdentifier(externalDb, 'merged', NRC, 'N');
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(0);
  });

  it('groups same details, ignoring case and accents, when sexes agree or one is missing', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Mwanza', firstname: 'Émile', dob: '1990-01-05', sex: 'M' });
    await seedPatient(externalDb, { id: 'b', surname: 'MWANZA', firstname: 'emile', dob: '1990-01-05', sex: null });
    const out = await dups.list(OPEN, { unmask: true });
    expect(out.rows.map((r) => [r.rule, r.members.map((m) => m.id), r.pairs])).toEqual([['details', ['a', 'b'], 1]]);
    expect(out.rows[0].evidence.text).toBe('Émile Mwanza, 1990-01-05');
  });

  it('does not report same details with different sexes', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'M' });
    await seedPatient(externalDb, { id: 'b', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'F' });
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(0);
  });

  it('keeps a three-member group with one conflict, counting only compatible pairs', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'M' });
    await seedPatient(externalDb, { id: 'b', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: 'F' });
    await seedPatient(externalDb, { id: 'c', surname: 'Banda', firstname: 'Chris', dob: '1990', sex: null });
    const out = await dups.list(OPEN, { unmask: true });
    expect([out.total, out.rows[0].members.length, out.rows[0].pairs]).toEqual([1, 3, 2]);
  });
});

describe('patient duplicates: dismissals', () => {
  async function twoSharing() {
    const b = await build();
    for (const id of ['a', 'b', 'c']) { await seedPatient(b.externalDb, { id }); await seedIdentifier(b.externalDb, id, NRC, 'X1'); }
    return b;
  }

  it('hides a group only when every pair is dismissed, whichever way round', async () => {
    const { dups, internalDb } = await twoSharing();
    expect(await dups.dismiss({ ids: ['b', 'a'], reason: 'twins', by: 'dev-admin' })).toEqual({ changed: 1 });
    expect(await internalDb.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b']).execute()).toEqual([{ patient_a: 'a', patient_b: 'b' }]);
    expect((await dups.list(OPEN, { unmask: true })).rows[0].dismissedPairs).toBe(1);
    expect(await dups.dismiss({ ids: ['a', 'b', 'c'], reason: null, by: 'dev-admin' })).toEqual({ changed: 2 });
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(0);
    expect((await dups.list({ ...OPEN, status: 'dismissed' }, { unmask: true })).total).toBe(1);
    expect((await dups.list({ ...OPEN, status: 'all' }, { unmask: true })).total).toBe(1);
  });

  it('restores dismissed pairs and reports how many changed', async () => {
    const { dups } = await twoSharing();
    await dups.dismiss({ ids: ['a', 'b', 'c'], reason: null, by: 'x' });
    expect(await dups.restore({ ids: ['c', 'a'] })).toEqual({ changed: 1 });
    expect((await dups.list(OPEN, { unmask: true })).total).toBe(1);
    expect(await dups.restore({ ids: ['c', 'a'] })).toEqual({ changed: 0 });
  });

  it('refuses fewer than two ids, a repeated id, and an unknown patient', async () => {
    const { dups } = await twoSharing();
    await expect(dups.dismiss({ ids: ['a'], reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(dups.dismiss({ ids: ['a', 'a'], reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(dups.dismiss({ ids: ['a', 'nope'], reason: null, by: 'x' })).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('patient duplicates: masking, paging and export', () => {
  it('masks members and evidence without patients.view_identifiers', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'hl7-111', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05' });
    await seedPatient(externalDb, { id: 'hl7-222', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05' });
    await seedIdentifier(externalDb, 'hl7-111', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'hl7-222', NRC, '998877/10/1');
    const out = await dups.list(OPEN, { unmask: false });
    expect(out.masked).toBe(true);
    expect(out.rows.map((r) => r.evidence.text).sort()).toEqual(['J*** M***, 1990', '•••10/1']);
    expect(JSON.stringify(out)).not.toMatch(/hl7-|Mwanza|John|998877|1990-01-05/);
  });

  it('pages in a stable order', async () => {
    const { externalDb, dups } = await build();
    for (const n of [1, 2, 3]) {
      for (const s of ['a', 'b']) { await seedPatient(externalDb, { id: `${s}${n}` }); await seedIdentifier(externalDb, `${s}${n}`, NRC, `V${n}`); }
    }
    const all = (await dups.list(OPEN, { unmask: true })).rows.map((r) => r.evidence.text);
    const p1 = (await dups.list({ ...OPEN, limit: 2, offset: 0 }, { unmask: true })).rows.map((r) => r.evidence.text);
    const p2 = (await dups.list({ ...OPEN, limit: 2, offset: 2 }, { unmask: true })).rows.map((r) => r.evidence.text);
    expect([...p1, ...p2]).toEqual(all);
    expect(all).toHaveLength(3);
  });

  it('exports one row per member of each open group', async () => {
    const { externalDb, dups } = await build();
    await seedPatient(externalDb, { id: 'a', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', sex: 'M', guid: 'G-a' });
    await seedPatient(externalDb, { id: 'b', surname: 'Phiri', firstname: 'Ann', dob: '1991', sex: 'F', guid: 'G-b' });
    await seedIdentifier(externalDb, 'a', NRC, '998877/10/1');
    await seedIdentifier(externalDb, 'b', NRC, '998877/10/1');
    const { csv, groups } = await dups.exportCsv();
    const lines = csv.trim().split(/\r?\n/);
    expect(groups).toBe(1);
    expect(lines[0]).toBe('group,rule,system_label,evidence,patient_id,patient_guid,surname,firstname,date_of_birth,sex,managing_facility');
    expect(lines.slice(1)).toEqual([
      `1,identifier,${NRC},998877/10/1,a,G-a,Mwanza,John,1990-01-05,M,`,
      `1,identifier,${NRC},998877/10/1,b,G-b,Phiri,Ann,1991,F,`,
    ]);
  });
});

describe('patient duplicates: parsers', () => {
  it('parses the list query', () => {
    expect(parseDuplicateListQuery({})).toEqual({ ok: true, query: { status: 'open', limit: 25, offset: 0 } });
    expect(parseDuplicateListQuery({ status: 'gone' })).toEqual({ ok: false, error: 'status must be open, dismissed or all' });
  });

  it('parses refs and reason', () => {
    expect(parsePairInput({ refs: ['r1', 'r2'], reason: '  twins ' })).toEqual({ ok: true, refs: ['r1', 'r2'], reason: 'twins' });
    expect(parsePairInput({ refs: ['r1'] })).toEqual({ ok: false, error: 'refs must list at least two different patients' });
    expect(parsePairInput({ refs: ['r1', 'r1'] })).toEqual({ ok: false, error: 'refs must list at least two different patients' });
    expect(parsePairInput({ refs: 'r1' })).toEqual({ ok: false, error: 'refs must list at least two different patients' });
  });
});
```

- [ ] **Step 3: Run and see it fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-duplicates.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Add `rowsByIds` to the patient index**

In `packages/bootstrap/src/patient-index.ts`, add to the `PatientIndex` interface:

```ts
  /** Patient rows for these ids, masked unless `unmask`, in the given order. Missing ids are skipped.
   *  The duplicates list builds its members here so masking stays in this file. */
  rowsByIds(ids: string[], opts: { unmask: boolean }): Promise<PatientRow[]>;
```

Inside `createPatientIndex`, before the `return`:

```ts
  async function rowsByIds(ids: string[], opts: { unmask: boolean }): Promise<PatientRow[]> {
    if (!ids.length) return [];
    const records = await db.selectFrom('patients').select([...PATIENT_COLUMNS]).where('id', 'in', ids).execute();
    const built = await build(records as PatientRecord[], opts.unmask, false);
    const byId = new Map(built.map(({ record, ...row }) => [record.id, row]));
    return ids.map((id) => byId.get(id)).filter((r): r is PatientRow => r !== undefined);
  }
```

and add `rowsByIds,` to the returned object.

- [ ] **Step 5: Write the module**

`packages/bootstrap/src/patient-duplicates.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { ExternalSchema, InternalSchema } from '@openldr/db';
import { toCsv } from '@openldr/reporting';
import { maskValue } from './patient-mask';
import { PatientIndexError, type PatientIdentifierSystems } from './patient-identifier-systems';
import type { PatientIndex, PatientRow } from './patient-index';

// Likely duplicate patients (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md). CE lists
// them with the evidence; the source system's team fixes them there. CE does not merge.
//
// Two exact rules: a shared identifier value in one searchable system, and a shared match_key with
// compatible sexes. Dismissals live in the internal db and patients in the warehouse, so groups are
// filtered and paged in code. That holds for thousands of groups, not hundreds of thousands.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const STATUSES = ['open', 'dismissed', 'all'] as const;
const CHUNK = 500;

export type DuplicateRule = 'identifier' | 'details';
export type DuplicateStatus = typeof STATUSES[number];
export interface DuplicateGroup {
  rule: DuplicateRule;
  evidence: { system: string | null; label: string | null; text: string };
  members: PatientRow[];
  pairs: number;
  dismissedPairs: number;
}
export interface DuplicateList { rows: DuplicateGroup[]; total: number; masked: boolean }
export interface PatientDuplicates {
  list(q: { status: DuplicateStatus; limit: number; offset: number }, opts: { unmask: boolean }): Promise<DuplicateList>;
  dismiss(input: { ids: string[]; reason: string | null; by: string }): Promise<{ changed: number }>;
  restore(input: { ids: string[] }): Promise<{ changed: number }>;
  exportCsv(): Promise<{ csv: string; groups: number }>;
}

export function parseDuplicateListQuery(raw: Record<string, unknown>): { ok: true; query: { status: DuplicateStatus; limit: number; offset: number } } | { ok: false; error: string } {
  const status = raw.status === undefined || raw.status === '' ? 'open' : String(raw.status);
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be open, dismissed or all' };
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  return { ok: true, query: { status: status as DuplicateStatus, limit, offset: Number(offsetRaw) } };
}

export function parsePairInput(raw: unknown): { ok: true; refs: string[]; reason: string | null } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const refs = Array.isArray(r.refs) ? r.refs.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  if (new Set(refs).size < 2 || refs.length !== new Set(refs).size) return { ok: false, error: 'refs must list at least two different patients' };
  const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null;
  return { ok: true, refs, reason };
}

type RawGroup = { rule: DuplicateRule; system: string | null; value: string; ids: string[]; pairs: [string, string][] };

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const sorted = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
// The list order is a hash of the group key, so it hints at neither names nor identifier values, the
// same reason the masked patient list orders by md5(id).
const orderKey = (g: RawGroup) => createHash('md5').update(`${g.rule}|${g.system ?? ''}|${g.value}`).digest('hex');

function allPairs(ids: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) out.push(sorted(ids[i], ids[j]));
  return out;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export function createPatientDuplicates(deps: {
  internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; index: PatientIndex; systems: PatientIdentifierSystems;
}): PatientDuplicates {
  const { internalDb, externalDb: db, index, systems } = deps;

  async function identifierGroups(): Promise<RawGroup[]> {
    const unsearchable = await systems.unsearchableSystems();
    let keys = db.selectFrom('patient_identifiers as i')
      .innerJoin('patients as p', 'p.id', 'i.patient_id')
      .select(['i.system', 'i.value'])
      .where('i.system', 'is not', null)
      .where('p.active', '=', true).where('p.replaced_by_id', 'is', null);
    if (unsearchable.length) keys = keys.where('i.system', 'not in', unsearchable);
    const found = await keys.groupBy(['i.system', 'i.value'])
      .having((eb) => eb.fn.count('i.patient_id').distinct(), '>', 1).execute();
    const wanted = new Set(found.map((k) => `${k.system}\u0000${k.value}`));
    const members = new Map<string, Set<string>>();
    for (const values of chunks([...new Set(found.map((k) => k.value))])) {
      const rows = await db.selectFrom('patient_identifiers as i')
        .innerJoin('patients as p', 'p.id', 'i.patient_id')
        .select(['i.system', 'i.value', 'i.patient_id'])
        .where('i.value', 'in', values)
        .where('p.active', '=', true).where('p.replaced_by_id', 'is', null).execute();
      for (const r of rows) {
        const k = `${r.system}\u0000${r.value}`;
        if (!wanted.has(k)) continue;
        members.set(k, (members.get(k) ?? new Set()).add(r.patient_id));
      }
    }
    return [...members].map(([k, set]) => {
      const [system, value] = k.split('\u0000');
      const ids = [...set].sort();
      return { rule: 'identifier' as const, system, value, ids, pairs: allPairs(ids) };
    });
  }

  async function detailGroups(): Promise<RawGroup[]> {
    const found = await db.selectFrom('patients').select('match_key')
      .where('match_key', 'is not', null).where('active', '=', true).where('replaced_by_id', 'is', null)
      .groupBy('match_key').having((eb) => eb.fn.countAll(), '>', 1).execute();
    const byKey = new Map<string, { id: string; sex: string | null }[]>();
    for (const keys of chunks(found.map((f) => f.match_key as string))) {
      const rows = await db.selectFrom('patients').select(['id', 'sex', 'match_key'])
        .where('match_key', 'in', keys).where('active', '=', true).where('replaced_by_id', 'is', null).execute();
      for (const r of rows) byKey.set(r.match_key as string, [...(byKey.get(r.match_key as string) ?? []), { id: r.id, sex: r.sex }]);
    }
    const out: RawGroup[] = [];
    for (const [value, list] of byKey) {
      const people = [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
      // Sexes are compatible when equal or when either is missing (spec section 1).
      const pairs: [string, string][] = [];
      for (let i = 0; i < people.length; i += 1) {
        for (let j = i + 1; j < people.length; j += 1) {
          const a = people[i]; const b = people[j];
          if (!a.sex || !b.sex || a.sex === b.sex) pairs.push(sorted(a.id, b.id));
        }
      }
      if (!pairs.length) continue;
      const ids = [...new Set(pairs.flat())].sort();
      out.push({ rule: 'details', system: null, value, ids, pairs });
    }
    return out;
  }

  async function dismissedAmong(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunks([...new Set(ids)])) {
      const rows = await internalDb.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b'])
        .where('patient_a', 'in', part).execute();
      for (const r of rows) out.add(pairKey(r.patient_a, r.patient_b));
    }
    return out;
  }

  async function groupsWithStatus(): Promise<Array<RawGroup & { dismissedPairs: number }>> {
    const groups = [...await identifierGroups(), ...await detailGroups()];
    const dismissed = await dismissedAmong(groups.flatMap((g) => g.ids));
    return groups
      .map((g) => ({ ...g, dismissedPairs: g.pairs.filter(([a, b]) => dismissed.has(pairKey(a, b))).length }))
      .sort((x, y) => (orderKey(x) < orderKey(y) ? -1 : orderKey(x) > orderKey(y) ? 1 : 0));
  }

  async function list(q: { status: DuplicateStatus; limit: number; offset: number }, opts: { unmask: boolean }): Promise<DuplicateList> {
    const all = await groupsWithStatus();
    const matched = all.filter((g) => q.status === 'all'
      || (q.status === 'open' ? g.dismissedPairs < g.pairs.length : g.dismissedPairs === g.pairs.length));
    const page = matched.slice(q.offset, q.offset + q.limit);
    const systemsOnPage = [...new Set(page.map((g) => g.system).filter((s): s is string => s !== null))];
    const labels = await systems.settingsFor(systemsOnPage);
    const rows: DuplicateGroup[] = [];
    for (const g of page) {
      const members = await index.rowsByIds(g.ids, opts);
      // Details evidence comes from the first member's row, which rowsByIds has already masked.
      const text = g.rule === 'identifier'
        ? (opts.unmask ? g.value : (maskValue(g.value) as string))
        : [members[0]?.name, members[0]?.birthDate].filter(Boolean).join(', ');
      rows.push({
        rule: g.rule,
        evidence: { system: g.system, label: g.system ? labels.get(g.system)?.label ?? null : null, text },
        members,
        pairs: g.pairs.length,
        dismissedPairs: g.dismissedPairs,
      });
    }
    return { rows, total: matched.length, masked: !opts.unmask };
  }

  async function requireKnown(ids: string[]): Promise<void> {
    if (new Set(ids).size < 2 || ids.length !== new Set(ids).size) {
      throw new PatientIndexError('list at least two different patients', 'invalid');
    }
    const found = await db.selectFrom('patients').select('id').where('id', 'in', ids).execute();
    if (found.length !== ids.length) throw new PatientIndexError('patient not found', 'not-found');
  }

  async function dismiss(input: { ids: string[]; reason: string | null; by: string }): Promise<{ changed: number }> {
    await requireKnown(input.ids);
    const pairs = allPairs([...input.ids].sort());
    const existing = await dismissedAmong(input.ids);
    const fresh = pairs.filter(([a, b]) => !existing.has(pairKey(a, b)));
    if (fresh.length) {
      await internalDb.insertInto('patient_duplicate_dismissals')
        .values(fresh.map(([a, b]) => ({ patient_a: a, patient_b: b, reason: input.reason, dismissed_by: input.by })))
        .execute();
    }
    return { changed: fresh.length };
  }

  async function restore(input: { ids: string[] }): Promise<{ changed: number }> {
    await requireKnown(input.ids);
    let changed = 0;
    for (const [a, b] of allPairs([...input.ids].sort())) {
      const res = await internalDb.deleteFrom('patient_duplicate_dismissals')
        .where('patient_a', '=', a).where('patient_b', '=', b).executeTakeFirst();
      changed += Number(res.numDeletedRows ?? 0);
    }
    return { changed };
  }

  async function exportCsv(): Promise<{ csv: string; groups: number }> {
    const open = (await groupsWithStatus()).filter((g) => g.dismissedPairs < g.pairs.length);
    const ids = [...new Set(open.flatMap((g) => g.ids))];
    const people = new Map<string, Record<string, string | null>>();
    for (const part of chunks(ids)) {
      const rows = await db.selectFrom('patients')
        .select(['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'managing_organization'])
        .where('id', 'in', part).execute();
      for (const r of rows) people.set(r.id, r as unknown as Record<string, string | null>);
    }
    const facilityIds = [...new Set([...people.values()].map((p) => p.managing_organization).filter((x): x is string => !!x)
      .map((x) => x.replace(/^Organization\//, '')))];
    const facilities = new Map<string, string | null>();
    for (const part of chunks(facilityIds)) {
      for (const f of await db.selectFrom('facilities').select(['id', 'facility_name']).where('id', 'in', part).execute()) {
        facilities.set(f.id, f.facility_name);
      }
    }
    const labels = await systems.settingsFor([...new Set(open.map((g) => g.system).filter((s): s is string => s !== null))]);
    const columns = ['group', 'rule', 'system_label', 'evidence', 'patient_id', 'patient_guid', 'surname', 'firstname',
      'date_of_birth', 'sex', 'managing_facility'].map((k) => ({ key: k, label: k }));
    const rows: Record<string, unknown>[] = [];
    open.forEach((g, i) => {
      for (const id of g.ids) {
        const p = people.get(id);
        if (!p) continue;
        const org = p.managing_organization?.replace(/^Organization\//, '') ?? null;
        rows.push({
          group: i + 1, rule: g.rule,
          system_label: g.system ? labels.get(g.system)?.label ?? g.system : '',
          evidence: g.rule === 'identifier' ? g.value : [p.surname, p.firstname, p.date_of_birth].filter(Boolean).join(' '),
          patient_id: id, patient_guid: p.patient_guid, surname: p.surname, firstname: p.firstname,
          date_of_birth: p.date_of_birth, sex: p.sex, managing_facility: org ? facilities.get(org) ?? p.managing_organization : '',
        });
      }
    });
    return { csv: toCsv(columns, rows), groups: open.length };
  }

  return { list, dismiss, restore, exportCsv };
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-duplicates.test.ts src/patient-index.test.ts src/patient-identifier-systems.test.ts`
Expected: PASS.
- If pg-mem rejects `having count(distinct ...)` or the join alias form, rewrite the key query as a plain select of `(system, value, patient_id)` for active patients and count in code. Say so in the commit body.
- If the export expectation fails only on line endings or quoting from `toCsv`, adjust the test's split, not the CSV.

- [ ] **Step 7: Wire into AppContext**

In `packages/bootstrap/src/index.ts`: import `createPatientDuplicates` and type `PatientDuplicates` from `./patient-duplicates`; add the field next to `patientIndex`:

```ts
  /** Likely duplicate patients and their dismissals (patient duplicates spec). */
  patientDuplicates: PatientDuplicates;
```

After the `patientIndex` construction:

```ts
  const patientDuplicates = createPatientDuplicates({ internalDb: termDb, externalDb, index: patientIndex, systems: patientIdentifierSystems });
```

Add `patientDuplicates,` to the returned context and `export * from './patient-duplicates';` to the barrel. Add `patientDuplicates: {} as never,` to `apps/server/src/test-helpers.ts` next to `patientIndex`.

- [ ] **Step 8: Typecheck**

Run each, redirected to a file, and read the exit code: `pnpm --filter @openldr/bootstrap run typecheck`, `pnpm --filter @openldr/server run typecheck`, `pnpm --filter @openldr/cli run typecheck`.
Expected: all `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add packages/bootstrap/src/patient-index.ts packages/bootstrap/src/patient-duplicates.ts packages/bootstrap/src/patient-duplicates.test.ts packages/bootstrap/src/test-support/patient-index-fixture.ts packages/bootstrap/src/index.ts apps/server/src/test-helpers.ts
git commit -m "feat(bootstrap): likely duplicate patients with dismissals and export"
```

---

### Task 4: Routes

**Files:**
- Modify: `apps/server/src/patient-routes.ts`
- Test: `apps/server/src/patient-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.patientDuplicates`, `parseDuplicateListQuery`, `parsePairInput`, `ctx.patientIndex.idForRef`.
- Produces: the four routes in spec section 5. Audit actions `patients.duplicate.dismiss`, `patients.duplicate.restore`, `patients.duplicate.export`.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/patient-routes.test.ts`, extend `fakeCtx` so `ctx.patientDuplicates` has spies `dup.list`, `dup.dismiss`, `dup.restore`, `dup.export`:

```ts
    patientDuplicates: {
      list: spy('dup.list', over['dup.list'] ?? (async () => ({ rows: [], total: 0, masked: false }))),
      dismiss: spy('dup.dismiss', over['dup.dismiss'] ?? (async () => ({ changed: 1 }))),
      restore: spy('dup.restore', over['dup.restore'] ?? (async () => ({ changed: 1 }))),
      exportCsv: spy('dup.export', over['dup.export'] ?? (async () => ({ csv: 'group,rule\n', groups: 2 }))),
    },
```

Do not change the default `idForRef` fake; an existing test relies on it returning `'hl7-1'`. The new tests pass their own. Add at the top of the new block `const REFS = { idForRef: (ref: string) => (ref.startsWith('r') ? `id-${ref}` : null) };` and call `fakeCtx(REFS)` (or `fakeCtx({ ...REFS, ...other })`) in every dismiss and restore test below. Then add:

```ts
describe('patient duplicate routes', () => {
  it('lists duplicates masked for view only, unmasked with view_identifiers', async () => {
    const a = fakeCtx();
    expect((await appWith(a.ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/duplicates?status=all' })).statusCode).toBe(200);
    expect(a.calls.find((c) => c.method === 'dup.list')?.args).toEqual([{ status: 'all', limit: 25, offset: 0 }, { unmask: false }]);
    const b = fakeCtx();
    await appWith(b.ctx, ALL).inject({ method: 'GET', url: '/api/patients/duplicates' });
    expect(b.calls.find((c) => c.method === 'dup.list')?.args[1]).toEqual({ unmask: true });
  });

  it('is not read as a patient ref', async () => {
    const { ctx, calls } = fakeCtx();
    await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/duplicates' });
    expect(calls.some((c) => c.method === 'get')).toBe(false);
  });

  it('refuses a bad status with 400', async () => {
    const { ctx } = fakeCtx();
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/duplicates?status=gone' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'status must be open, dismissed or all' }]);
  });

  it('dismisses with patients.manage, turning refs into ids, and audits ids and reason', async () => {
    const { ctx, calls, audit } = fakeCtx(REFS);
    const res = await appWith(ctx, ALL).inject({ method: 'POST', url: '/api/patients/duplicates/dismiss', payload: { refs: ['r1', 'r2'], reason: 'twins' } });
    expect([res.statusCode, res.json()]).toEqual([200, { changed: 1 }]);
    expect(calls.find((c) => c.method === 'dup.dismiss')?.args).toEqual([{ ids: ['id-r1', 'id-r2'], reason: 'twins', by: 'user' }]);
    expect(audit.map((e) => [e.action, e.entityId, e.metadata])).toEqual([['patients.duplicate.dismiss', 'id-r1', { ids: ['id-r1', 'id-r2'], reason: 'twins', changed: 1 }]]);
  });

  it('restores with patients.manage and audits', async () => {
    const { ctx, audit } = fakeCtx(REFS);
    const res = await appWith(ctx, ALL).inject({ method: 'POST', url: '/api/patients/duplicates/restore', payload: { refs: ['r1', 'r2'] } });
    expect(res.statusCode).toBe(200);
    expect(audit.map((e) => e.action)).toEqual(['patients.duplicate.restore']);
  });

  it('refuses dismiss without patients.manage, with one ref, and with an unknown ref', async () => {
    const body = { refs: ['r1', 'r2'] };
    expect((await appWith(fakeCtx(REFS).ctx, ['patients.view']).inject({ method: 'POST', url: '/api/patients/duplicates/dismiss', payload: body })).statusCode).toBe(403);
    const one = await appWith(fakeCtx(REFS).ctx, ALL).inject({ method: 'POST', url: '/api/patients/duplicates/dismiss', payload: { refs: ['r1'] } });
    expect([one.statusCode, one.json()]).toEqual([400, { error: 'refs must list at least two different patients' }]);
    const bad = await appWith(fakeCtx(REFS).ctx, ALL).inject({ method: 'POST', url: '/api/patients/duplicates/dismiss', payload: { refs: ['r1', 'zzz'] } });
    expect([bad.statusCode, bad.json()]).toEqual([404, { error: 'patient not found', kind: 'not-found' }]);
  });

  it('exports with view_identifiers as CSV and audits the group count only', async () => {
    const { ctx, audit } = fakeCtx();
    const res = await appWith(ctx, ['patients.view', 'patients.view_identifiers']).inject({ method: 'GET', url: '/api/patients/duplicates/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('patient-duplicates.csv');
    expect(res.body).toBe('group,rule\n');
    expect(audit.map((e) => [e.action, e.metadata])).toEqual([['patients.duplicate.export', { groups: 2 }]]);
    expect((await appWith(fakeCtx().ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/duplicates/export' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/server exec vitest run src/patient-routes.test.ts`
Expected: FAIL, the duplicate routes are missing.

- [ ] **Step 3: Add the routes**

In `apps/server/src/patient-routes.ts`, add `parseDuplicateListQuery, parsePairInput` to the bootstrap import and add `const IDENTIFIERS = { preHandler: requireCapability('patients.view_identifiers') };` next to `VIEW` and `MANAGE`. Add these routes right after `GET /api/patients` (static paths, before `/:ref`):

```ts
  // Likely duplicates (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md, section 5).
  app.get('/api/patients/duplicates', VIEW, async (req, reply) => {
    const parsed = parseDuplicateListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.patientDuplicates.list(parsed.query, { unmask: canUnmask(req) }));
  });

  app.get('/api/patients/duplicates/export', IDENTIFIERS, async (req, reply) => {
    const { csv, groups } = await ctx.patientDuplicates.exportCsv();
    await recordAudit(ctx, req, { action: 'patients.duplicate.export', entityType: 'patient', entityId: 'duplicates', metadata: { groups } });
    return reply.header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="patient-duplicates.csv"').send(csv);
  });

  for (const action of ['dismiss', 'restore'] as const) {
    app.post(`/api/patients/duplicates/${action}`, MANAGE, async (req, reply) => {
      const parsed = parsePairInput(req.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      const ids = parsed.refs.map((r) => ctx.patientIndex.idForRef(r));
      if (ids.some((id) => id === null)) return reply.code(404).send({ error: 'patient not found', kind: 'not-found' });
      const known = ids as string[];
      try {
        const out = action === 'dismiss'
          ? await ctx.patientDuplicates.dismiss({ ids: known, reason: parsed.reason, by: req.user?.username ?? 'unknown' })
          : await ctx.patientDuplicates.restore({ ids: known });
        await recordAudit(ctx, req, {
          action: `patients.duplicate.${action}`, entityType: 'patient', entityId: known[0],
          metadata: action === 'dismiss' ? { ids: known, reason: parsed.reason, changed: out.changed } : { ids: known, changed: out.changed },
        });
        return reply.send(out);
      } catch (err) {
        return replyPatientError(err, reply);
      }
    });
  }
```

- [ ] **Step 4: Run the tests and lint**

Run: `pnpm --filter @openldr/server exec vitest run src/patient-routes.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/server run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/patient-routes.ts apps/server/src/patient-routes.test.ts
git commit -m "feat(server): patient duplicate routes"
```

---

### Task 5: CLI

**Files:**
- Modify: `packages/cli/src/patients.ts`
- Modify: `packages/cli/src/patients.test.ts`
- Modify: `packages/cli/src/program.ts` (import near `:49-52`, commands after the `identifier-systems set` command near `:521`)

**Interfaces:**
- Consumes: `ctx.patientDuplicates`, `parseDuplicateListQuery`, `recordAuditEvent`, `cliActor`.
- Produces: `runDuplicatesList`, `runDuplicatesDismiss`, `runDuplicatesRestore`, `runDuplicatesExport`.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/src/patients.test.ts`, add `patientDuplicates = { list: vi.fn(), dismiss: vi.fn(), restore: vi.fn(), exportCsv: vi.fn() }`, return it from the mocked `createAppContext`, reset it in `beforeEach`, import the four runners, and add:

```ts
describe('openldr patients duplicates', () => {
  const GROUP = { rule: 'identifier', evidence: { system: 'urn:zm:nrc', label: 'NRC', text: '•••10/1' }, members: [ROW, ROW], pairs: 1, dismissedPairs: 0 };

  it('list is masked by default and prints one line per group', async () => {
    patientDuplicates.list.mockResolvedValue({ rows: [GROUP], total: 1, masked: true });
    const io = capture();
    expect(await runDuplicatesList({ json: false, identifiers: false })).toBe(0);
    expect(patientDuplicates.list).toHaveBeenCalledWith({ status: 'open', limit: 200, offset: 0 }, { unmask: false });
    expect(io.out()).toContain('Same NRC  •••10/1  2 patient(s)  0 of 1 pair(s) dismissed');
  });

  it('list refuses a bad status', async () => {
    const io = capture();
    expect(await runDuplicatesList({ status: 'gone', json: false, identifiers: false })).toBe(1);
    expect(io.err()).toContain('status must be open, dismissed or all');
  });

  it('dismiss writes and audits as the CLI actor', async () => {
    patientDuplicates.dismiss.mockResolvedValue({ changed: 1 });
    capture();
    expect(await runDuplicatesDismiss('a', 'b', { reason: 'twins', json: false })).toBe(0);
    expect(patientDuplicates.dismiss.mock.calls[0][0]).toMatchObject({ ids: ['a', 'b'], reason: 'twins' });
    expect(audit[0]).toMatchObject({ action: 'patients.duplicate.dismiss', entityId: 'a', metadata: { ids: ['a', 'b'], reason: 'twins', changed: 1 } });
  });

  it('restore audits', async () => {
    patientDuplicates.restore.mockResolvedValue({ changed: 0 });
    const io = capture();
    expect(await runDuplicatesRestore('a', 'b', { json: false })).toBe(0);
    expect(io.out()).toContain('0 pair(s) restored');
    expect(audit[0]).toMatchObject({ action: 'patients.duplicate.restore' });
  });

  it('export writes the CSV to stdout and audits the group count', async () => {
    patientDuplicates.exportCsv.mockResolvedValue({ csv: 'group,rule\n1,identifier\n', groups: 1 });
    const io = capture();
    expect(await runDuplicatesExport({})).toBe(0);
    expect(io.out()).toBe('group,rule\n1,identifier\n');
    expect(audit[0]).toEqual({ action: 'patients.duplicate.export', entityType: 'patient', entityId: 'duplicates', metadata: { groups: 1 } });
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/cli exec vitest run src/patients.test.ts`
Expected: FAIL, the runners are missing.

- [ ] **Step 3: Write the runners**

Append to `packages/cli/src/patients.ts` (add `parseDuplicateListQuery` and type `DuplicateGroup` to the bootstrap import, and `writeFileSync` from `node:fs`):

```ts
export interface DuplicatesListOpts { status?: string; identifiers: boolean; json: boolean }

const ruleText = (g: DuplicateGroup) => (g.rule === 'identifier' ? `Same ${g.evidence.label ?? g.evidence.system ?? 'identifier'}` : 'Same name and date of birth');

export async function runDuplicatesList(opts: DuplicatesListOpts): Promise<number> {
  const parsed = parseDuplicateListQuery({ status: opts.status, limit: '200' });
  if (!parsed.ok) { process.stderr.write(`patients duplicates list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientDuplicates.list(parsed.query, { unmask: opts.identifiers });
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const lines = out.rows.map((g) => [
      ruleText(g), g.evidence.text, `${g.members.length} patient(s)`, `${g.dismissedPairs} of ${g.pairs} pair(s) dismissed`,
      ...(opts.identifiers ? [g.members.map((m) => m.id).join(' ')] : []),
    ].join('  '));
    process.stdout.write([...lines, `${out.rows.length} of ${out.total} group(s)${out.masked ? ' (masked; --identifiers shows names and ids)' : ''}`].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('duplicates list', err, opts.json); } finally { await ctx.close(); }
}

export async function runDuplicatesDismiss(idA: string, idB: string, opts: { reason?: string; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const actor = cliActor();
    const reason = opts.reason?.trim() || null;
    const out = await ctx.patientDuplicates.dismiss({ ids: [idA, idB], reason, by: actor.actorName });
    await recordAuditEvent(ctx, actor, { action: 'patients.duplicate.dismiss', entityType: 'patient', entityId: idA, metadata: { ids: [idA, idB], reason, changed: out.changed } });
    process.stdout.write(opts.json ? JSON.stringify(out) + '\n' : `${out.changed} pair(s) dismissed.\n`);
    return 0;
  } catch (err) { return fail('duplicates dismiss', err, opts.json); } finally { await ctx.close(); }
}

export async function runDuplicatesRestore(idA: string, idB: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientDuplicates.restore({ ids: [idA, idB] });
    await recordAuditEvent(ctx, cliActor(), { action: 'patients.duplicate.restore', entityType: 'patient', entityId: idA, metadata: { ids: [idA, idB], changed: out.changed } });
    process.stdout.write(opts.json ? JSON.stringify(out) + '\n' : `${out.changed} pair(s) restored.\n`);
    return 0;
  } catch (err) { return fail('duplicates restore', err, opts.json); } finally { await ctx.close(); }
}

export async function runDuplicatesExport(opts: { out?: string }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const { csv, groups } = await ctx.patientDuplicates.exportCsv();
    await recordAuditEvent(ctx, cliActor(), { action: 'patients.duplicate.export', entityType: 'patient', entityId: 'duplicates', metadata: { groups } });
    if (opts.out) writeFileSync(opts.out, csv, 'utf8'); else process.stdout.write(csv);
    return 0;
  } catch (err) { return fail('duplicates export', err, false); } finally { await ctx.close(); }
}
```

- [ ] **Step 4: Register the commands**

In `packages/cli/src/program.ts`, add `runDuplicatesDismiss, runDuplicatesExport, runDuplicatesList, runDuplicatesRestore, type DuplicatesListOpts` to the `./patients` import, and after the `identifier-systems set` command:

```ts
  const dups = patients.command('duplicates').description('Likely duplicate patients (CE lists them; the source system fixes them)');
  dups.command('list')
    .description('List likely duplicate groups; masked unless --identifiers')
    .option('--status <open|dismissed|all>', 'which groups (default: open)')
    .option('--identifiers', 'show names, identifiers and patient ids', false)
    .option('--json', 'emit JSON', false)
    .action(async (opts: DuplicatesListOpts) => { process.exitCode = await runDuplicatesList(opts); });
  dups.command('dismiss <idA> <idB>')
    .description('Mark two patients as different people')
    .option('--reason <text>', 'why they are not duplicates')
    .option('--json', 'emit JSON', false)
    .action(async (a: string, b: string, opts: { reason?: string; json: boolean }) => { process.exitCode = await runDuplicatesDismiss(a, b, opts); });
  dups.command('restore <idA> <idB>')
    .description('Undo a dismissal')
    .option('--json', 'emit JSON', false)
    .action(async (a: string, b: string, opts: { json: boolean }) => { process.exitCode = await runDuplicatesRestore(a, b, opts); });
  dups.command('export')
    .description('Write the open groups as CSV, unmasked (audited)')
    .option('--out <file>', 'write to a file instead of stdout')
    .action(async (opts: { out?: string }) => { process.exitCode = await runDuplicatesExport(opts); });
```

The list with `--identifiers` is not audited, because the route does not audit an unmasked duplicates list either (spec section 4 audits dismiss, restore and export only).

- [ ] **Step 5: Run the CLI tests and typecheck**

Run: `pnpm --filter @openldr/cli exec vitest run src/patients.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/cli run typecheck`, redirected, read the exit code.
Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/patients.ts packages/cli/src/patients.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): openldr patients duplicates list, dismiss, restore and export"
```

---

### Task 6: Studio Duplicates tab and group sheet

**Files:**
- Modify: `apps/studio/src/api.ts` (append after the patient index block)
- Create: `apps/studio/src/patients/DuplicatesTab.tsx`
- Create: `apps/studio/src/patients/DuplicatesTab.test.tsx`
- Create: `apps/studio/src/patients/DuplicateGroupSheet.tsx`
- Create: `apps/studio/src/patients/DuplicateGroupSheet.test.tsx`
- Modify: `apps/studio/src/pages/Patients.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (`patients.tabs.duplicates`, `patients.duplicates.*`)

**Interfaces:**
- Consumes: routes from Task 4; `PatientRow` from api.ts.
- Produces: `DuplicatesTab({ canManage, canExport, onOpen })`, `DuplicateGroupSheet({ group, canManage, onClose, onChanged, onOpen })`.

- [ ] **Step 1: Add the API client**

Append to `apps/studio/src/api.ts`:

```ts
// Patient duplicates (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md).
export interface DuplicateGroup {
  rule: 'identifier' | 'details';
  evidence: { system: string | null; label: string | null; text: string };
  members: PatientRow[];
  pairs: number;
  dismissedPairs: number;
}
export interface DuplicateList { rows: DuplicateGroup[]; total: number; masked: boolean }
export const listPatientDuplicates = (p: { status: 'open' | 'dismissed' | 'all'; limit: number; offset: number }): Promise<DuplicateList> =>
  apiGet<DuplicateList>(`/api/patients/duplicates?status=${p.status}&limit=${p.limit}&offset=${p.offset}`, 'list duplicate patients');
export const dismissPatientDuplicates = (refs: string[], reason: string | null): Promise<{ changed: number }> =>
  authFetch('/api/patients/duplicates/dismiss', jbody({ refs, reason }, 'POST')).then((r) => okJson<{ changed: number }>(r, 'mark as not duplicates'));
export const restorePatientDuplicates = (refs: string[]): Promise<{ changed: number }> =>
  authFetch('/api/patients/duplicates/restore', jbody({ refs }, 'POST')).then((r) => okJson<{ changed: number }>(r, 'show duplicates again'));
export const downloadPatientDuplicatesCsv = (): Promise<void> =>
  downloadCsv('/api/patients/duplicates/export', 'patient-duplicates.csv', 'export duplicate patients');
```

- [ ] **Step 2: Add the strings in three languages**

In each locale file, add `duplicates: 'Duplicates'` (fr `'Doublons'`, pt `'Duplicados'`) to `patients.tabs`, and add this block after the `patients.systems` block.

en:

```ts
    duplicates: {
      empty: 'No likely duplicates.',
      statusFilter: 'Status',
      status: { open: 'Open', dismissed: 'Not duplicates', all: 'All' },
      menu: 'Duplicates actions',
      export: 'Export CSV',
      col: { rule: 'Rule', evidence: 'Evidence', members: 'Patients', dismissed: 'Dismissed pairs' },
      ruleIdentifier: 'Same {{label}}',
      ruleDetails: 'Same name and date of birth',
      dismissedOf: '{{dismissed}} of {{pairs}}',
      count_one: '{{count}} group',
      count_other: '{{count}} groups',
      view: 'View',
      actionsFor: 'Actions for this group',
      sheetTitle: 'Likely duplicates',
      sheetDescription: 'Fix these in the source system. CE does not merge patients.',
      evidence: 'Evidence',
      members: 'Patients',
      reason: 'Reason',
      reasonHint: 'Optional. Saved with the decision.',
      markNot: 'Mark as not duplicates',
      showAgain: 'Show again',
      openPatient: 'Open patient',
      memberActions: 'Actions for this patient',
      marked: 'Marked as not duplicates.',
      restored: 'Shown again.',
    },
```

fr:

```ts
    duplicates: {
      empty: 'Aucun doublon probable.',
      statusFilter: 'Statut',
      status: { open: 'Ouverts', dismissed: 'Pas des doublons', all: 'Tous' },
      menu: 'Actions des doublons',
      export: 'Exporter en CSV',
      col: { rule: 'Règle', evidence: 'Élément commun', members: 'Patients', dismissed: 'Paires écartées' },
      ruleIdentifier: 'Même {{label}}',
      ruleDetails: 'Même nom et même date de naissance',
      dismissedOf: '{{dismissed}} sur {{pairs}}',
      count_one: '{{count}} groupe',
      count_other: '{{count}} groupes',
      view: 'Voir',
      actionsFor: 'Actions pour ce groupe',
      sheetTitle: 'Doublons probables',
      sheetDescription: 'Corrigez-les dans le système source. CE ne fusionne pas les patients.',
      evidence: 'Élément commun',
      members: 'Patients',
      reason: 'Motif',
      reasonHint: 'Facultatif. Enregistré avec la décision.',
      markNot: 'Marquer comme pas des doublons',
      showAgain: 'Afficher à nouveau',
      openPatient: 'Ouvrir le patient',
      memberActions: 'Actions pour ce patient',
      marked: 'Marqués comme pas des doublons.',
      restored: 'Affichés à nouveau.',
    },
```

pt:

```ts
    duplicates: {
      empty: 'Não há duplicados prováveis.',
      statusFilter: 'Estado',
      status: { open: 'Abertos', dismissed: 'Não são duplicados', all: 'Todos' },
      menu: 'Ações dos duplicados',
      export: 'Exportar CSV',
      col: { rule: 'Regra', evidence: 'Elemento comum', members: 'Pacientes', dismissed: 'Pares descartados' },
      ruleIdentifier: 'Mesmo {{label}}',
      ruleDetails: 'Mesmo nome e data de nascimento',
      dismissedOf: '{{dismissed}} de {{pairs}}',
      count_one: '{{count}} grupo',
      count_other: '{{count}} grupos',
      view: 'Ver',
      actionsFor: 'Ações para este grupo',
      sheetTitle: 'Duplicados prováveis',
      sheetDescription: 'Corrija-os no sistema de origem. O CE não funde pacientes.',
      evidence: 'Elemento comum',
      members: 'Pacientes',
      reason: 'Motivo',
      reasonHint: 'Opcional. Guardado com a decisão.',
      markNot: 'Marcar como não duplicados',
      showAgain: 'Mostrar de novo',
      openPatient: 'Abrir paciente',
      memberActions: 'Ações para este paciente',
      marked: 'Marcados como não duplicados.',
      restored: 'Mostrados de novo.',
    },
```

- [ ] **Step 3: Write the failing tests**

`apps/studio/src/patients/DuplicatesTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPatientDuplicates: vi.fn(), downloadPatientDuplicatesCsv: vi.fn() };
});

import * as api from '@/api';
import { DuplicatesTab } from './DuplicatesTab';

const ROW = (ref: string, name: string): api.PatientRow => ({
  ref, id: null, name, sex: 'M', birthDate: '1990', ageYears: 36, identifiers: [], managingFacility: null,
  active: true, replacedByRef: null, lastRequestAt: null, requestCount: 0,
});
const GROUP: api.DuplicateGroup = {
  rule: 'identifier', evidence: { system: 'urn:zm:nrc', label: 'NRC', text: '•••10/1' },
  members: [ROW('r1', 'J*** M***'), ROW('r2', 'J*** M***')], pairs: 1, dismissedPairs: 0,
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => { vi.mocked(api.listPatientDuplicates).mockReset(); });

describe('DuplicatesTab', () => {
  it('shows the spinner, then a group with rule, evidence and member count', async () => {
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [GROUP], total: 1, masked: true });
    render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const row = await screen.findByTestId('duplicate-row-0');
    expect(row.textContent).toContain('Same NRC');
    expect(row.textContent).toContain('•••10/1');
    expect(row.textContent).toContain('2');
    expect(vi.mocked(api.listPatientDuplicates)).toHaveBeenCalledWith({ status: 'open', limit: 25, offset: 0 });
  });

  it('shows stripes and no table when there are none', async () => {
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [], total: 0, masked: false });
    render(<DuplicatesTab canManage canExport onOpen={() => {}} />);
    expect(await screen.findByText('No likely duplicates.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers Export only with patients.view_identifiers', async () => {
    vi.mocked(api.listPatientDuplicates).mockResolvedValue({ rows: [GROUP], total: 1, masked: false });
    const { unmount } = render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    await screen.findByTestId('duplicate-row-0');
    expect(screen.queryByTestId('duplicates-menu-trigger')).toBeNull();
    unmount();
    render(<DuplicatesTab canManage canExport onOpen={() => {}} />);
    await screen.findByTestId('duplicate-row-0');
    openMenu('duplicates-menu-trigger');
    fireEvent.click(await screen.findByTestId('duplicates-export'));
    await waitFor(() => expect(vi.mocked(api.downloadPatientDuplicatesCsv)).toHaveBeenCalled());
  });

  it('ignores a late response from an earlier load', async () => {
    let resolveFirst: (v: api.DuplicateList) => void = () => {};
    vi.mocked(api.listPatientDuplicates)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ rows: [{ ...GROUP, evidence: { ...GROUP.evidence, text: 'second' } }], total: 1, masked: false });
    render(<DuplicatesTab canManage canExport={false} onOpen={() => {}} />);
    fireEvent.click(screen.getByTestId('duplicates-status-trigger'));
    fireEvent.click(await screen.findByText('All'));
    expect((await screen.findByTestId('duplicate-row-0')).textContent).toContain('second');
    resolveFirst({ rows: [{ ...GROUP, evidence: { ...GROUP.evidence, text: 'first' } }], total: 1, masked: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('duplicate-row-0').textContent).toContain('second');
  });
});
```

`apps/studio/src/patients/DuplicateGroupSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, dismissPatientDuplicates: vi.fn(), restorePatientDuplicates: vi.fn() };
});

import * as api from '@/api';
import { DuplicateGroupSheet } from './DuplicateGroupSheet';

const ROW = (ref: string): api.PatientRow => ({
  ref, id: ref, name: `Name ${ref}`, sex: 'F', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:nrc', label: 'NRC', value: '998877/10/1' }], managingFacility: null,
  active: true, replacedByRef: null, lastRequestAt: null, requestCount: 0,
});
const GROUP: api.DuplicateGroup = {
  rule: 'identifier', evidence: { system: 'urn:zm:nrc', label: 'NRC', text: '998877/10/1' },
  members: [ROW('r1'), ROW('r2')], pairs: 1, dismissedPairs: 0,
};

function openMenu(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  vi.mocked(api.dismissPatientDuplicates).mockReset();
  vi.mocked(api.restorePatientDuplicates).mockReset();
});

describe('DuplicateGroupSheet', () => {
  it('lists the evidence and every member', () => {
    render(<DuplicateGroupSheet group={GROUP} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('Same NRC')).toBeTruthy();
    expect(screen.getByText('Name r1')).toBeTruthy();
    expect(screen.getByText('Name r2')).toBeTruthy();
  });

  it('marks the group as not duplicates with the reason', async () => {
    vi.mocked(api.dismissPatientDuplicates).mockResolvedValue({ changed: 1 });
    const onChanged = vi.fn();
    render(<DuplicateGroupSheet group={GROUP} canManage onClose={() => {}} onChanged={onChanged} onOpen={() => {}} />);
    fireEvent.change(screen.getByTestId('duplicate-reason'), { target: { value: 'twins' } });
    openMenu('duplicate-sheet-menu');
    fireEvent.click(await screen.findByTestId('duplicate-mark-not'));
    await waitFor(() => expect(vi.mocked(api.dismissPatientDuplicates)).toHaveBeenCalledWith(['r1', 'r2'], 'twins'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the group again when it has dismissed pairs', async () => {
    vi.mocked(api.restorePatientDuplicates).mockResolvedValue({ changed: 1 });
    render(<DuplicateGroupSheet group={{ ...GROUP, dismissedPairs: 1 }} canManage onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    openMenu('duplicate-sheet-menu');
    expect(screen.queryByTestId('duplicate-mark-not')).toBeNull();
    fireEvent.click(await screen.findByTestId('duplicate-show-again'));
    await waitFor(() => expect(vi.mocked(api.restorePatientDuplicates)).toHaveBeenCalledWith(['r1', 'r2']));
  });

  it('has no sheet menu or reason without patients.manage', () => {
    render(<DuplicateGroupSheet group={GROUP} canManage={false} onClose={() => {}} onChanged={() => {}} onOpen={() => {}} />);
    expect(screen.queryByTestId('duplicate-sheet-menu')).toBeNull();
    expect(screen.queryByTestId('duplicate-reason')).toBeNull();
  });

  it('opens a member patient from its menu', async () => {
    const onOpen = vi.fn();
    render(<DuplicateGroupSheet group={GROUP} canManage onClose={() => {}} onChanged={() => {}} onOpen={onOpen} />);
    openMenu('duplicate-member-menu-r2');
    fireEvent.click(await screen.findByTestId('duplicate-open-r2'));
    expect(onOpen).toHaveBeenCalledWith('r2');
  });
});
```

- [ ] **Step 4: Run and see them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients/DuplicatesTab.test.tsx src/patients/DuplicateGroupSheet.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 5: Write the sheet**

`apps/studio/src/patients/DuplicateGroupSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { dismissPatientDuplicates, restorePatientDuplicates, type DuplicateGroup } from '@/api';

// One likely duplicate group (patient duplicates spec, section 6). Header, ⋯ menu and label-left grid
// copy IdentifierSystemSheet.tsx. A group is one decision: Mark as not duplicates dismisses every pair.

export function ruleLabel(t: (k: string, o?: Record<string, unknown>) => string, g: DuplicateGroup): string {
  return g.rule === 'identifier'
    ? t('patients.duplicates.ruleIdentifier', { label: g.evidence.label ?? g.evidence.system ?? '' })
    : t('patients.duplicates.ruleDetails');
}

export function DuplicateGroupSheet({ group, canManage, onClose, onChanged, onOpen }: {
  group: DuplicateGroup | null; canManage: boolean; onClose: () => void; onChanged: () => void; onOpen: (ref: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setReason(''); }, [group]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const refs = group?.members.map((m) => m.ref) ?? [];
  const open = group ? group.dismissedPairs < group.pairs : false;

  return (
    <Sheet open={group !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('patients.duplicates.sheetTitle')}</SheetTitle>
          <SheetDescription>{t('patients.duplicates.sheetDescription')}</SheetDescription>
        </SheetHeader>
        {group && (
          <>
            <section>
              <div className="flex items-center justify-between px-6 py-3">
                <div className="text-sm font-medium text-foreground">{t('patients.duplicates.evidence')}</div>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="duplicate-sheet-menu" aria-label={t('patients.duplicates.actionsFor')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {open && (
                        <DropdownMenuItem data-testid="duplicate-mark-not" disabled={busy}
                          onSelect={() => void run(() => dismissPatientDuplicates(refs, reason.trim() || null), t('patients.duplicates.marked'))}>
                          {t('patients.duplicates.markNot')}
                        </DropdownMenuItem>
                      )}
                      {group.dismissedPairs > 0 && (
                        <DropdownMenuItem data-testid="duplicate-show-again" disabled={busy}
                          onSelect={() => void run(() => restorePatientDuplicates(refs), t('patients.duplicates.restored'))}>
                          {t('patients.duplicates.showAgain')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="border-t border-border" />
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                <div className="text-muted-foreground">{t('patients.duplicates.col.rule')}</div>
                <div>{ruleLabel(t, group)}</div>
                <div className="text-muted-foreground">{t('patients.duplicates.col.evidence')}</div>
                <div className="break-all font-mono text-xs">{group.evidence.text}</div>
                <div className="text-muted-foreground">{t('patients.duplicates.col.dismissed')}</div>
                <div>{t('patients.duplicates.dismissedOf', { dismissed: group.dismissedPairs, pairs: group.pairs })}</div>
                {canManage && open && (
                  <>
                    <div className="text-muted-foreground">{t('patients.duplicates.reason')}</div>
                    <div className="flex flex-col gap-1">
                      <Input data-testid="duplicate-reason" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
                      <span className="text-xs text-muted-foreground">{t('patients.duplicates.reasonHint')}</span>
                    </div>
                  </>
                )}
              </div>
            </section>
            <section>
              <div className="border-t border-border" />
              <div className="px-6 py-3 text-sm font-medium text-foreground">{t('patients.duplicates.members')}</div>
              <div className="border-t border-border" />
              {group.members.map((m) => (
                <div key={m.ref} className="flex items-start justify-between gap-3 border-b border-border px-6 py-3 text-sm">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{m.name ?? ''}</span>
                    <span className="text-xs text-muted-foreground">
                      {[m.sex, m.birthDate, m.ageYears === null ? null : `${m.ageYears}`].filter(Boolean).join(' · ')}
                    </span>
                    {m.identifiers.map((i) => (
                      <span key={`${i.system ?? ''}|${i.value}`} className="break-all text-xs">
                        <span className="text-muted-foreground">{i.label ?? i.system ?? t('patients.noSystem')}: </span>
                        <span className="font-mono">{i.value}</span>
                      </span>
                    ))}
                    {m.managingFacility && (
                      <span className="text-xs text-muted-foreground">{m.managingFacility.name ?? m.managingFacility.reference}</span>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid={`duplicate-member-menu-${m.ref}`} aria-label={t('patients.duplicates.memberActions')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem data-testid={`duplicate-open-${m.ref}`} onSelect={() => onOpen(m.ref)}>
                        {t('patients.duplicates.openPatient')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default DuplicateGroupSheet;
```

Note the member rows in the list API carry only `listColumn` identifiers (they come from `rowsByIds` with `allIdentifiers = false`). That is the intended amount of detail here; the patient sheet shows the rest.

- [ ] **Step 6: Write the tab**

`apps/studio/src/patients/DuplicatesTab.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { downloadPatientDuplicatesCsv, listPatientDuplicates, type DuplicateGroup } from '@/api';
import { DuplicateGroupSheet, ruleLabel } from './DuplicateGroupSheet';

// Likely duplicate patients (patient duplicates spec, section 6). Copies IdentifierSystemsTab.tsx,
// including its guard against a late response overwriting a newer one.

type Status = 'open' | 'dismissed' | 'all';

export function DuplicatesTab({ canManage, canExport, onOpen }: {
  canManage: boolean; canExport: boolean; onOpen: (ref: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DuplicateGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('open');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<DuplicateGroup | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const out = await listPatientDuplicates({ status, limit: pageSize, offset: page * pageSize });
      if (seq !== loadSeq.current) return;
      setRows(out.rows);
      setTotal(out.total);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <Select value={status} onValueChange={(v) => { setStatus(v as Status); setPage(0); }}>
          <SelectTrigger className="h-8 w-44" aria-label={t('patients.duplicates.statusFilter')} data-testid="duplicates-status-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t('patients.duplicates.status.open')}</SelectItem>
            <SelectItem value="dismissed">{t('patients.duplicates.status.dismissed')}</SelectItem>
            <SelectItem value="all">{t('patients.duplicates.status.all')}</SelectItem>
          </SelectContent>
        </Select>
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="duplicates-menu-trigger" aria-label={t('patients.duplicates.menu')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="duplicates-export"
                onSelect={() => { downloadPatientDuplicatesCsv().catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e))); }}>
                {t('patients.duplicates.export')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">{t('patients.duplicates.empty')}</StripedEmpty>
        )}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('patients.duplicates.col.rule')}</TableHead>
                <TableHead>{t('patients.duplicates.col.evidence')}</TableHead>
                <TableHead>{t('patients.duplicates.col.members')}</TableHead>
                <TableHead>{t('patients.duplicates.col.dismissed')}</TableHead>
                <TableHead className="w-12"><span className="sr-only">{t('patients.rowActions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((g, i) => (
                <TableRow key={`${page}-${i}`} data-testid={`duplicate-row-${i}`} className="cursor-pointer" onClick={() => setSelected(g)}>
                  <TableCell>{ruleLabel(t, g)}</TableCell>
                  <TableCell className="break-all font-mono text-xs">{g.evidence.text}</TableCell>
                  <TableCell>{g.members.length}</TableCell>
                  <TableCell>{t('patients.duplicates.dismissedOf', { dismissed: g.dismissedPairs, pairs: g.pairs })}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`duplicate-actions-${i}`} aria-label={t('patients.duplicates.actionsFor')}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`duplicate-view-${i}`} onSelect={() => setSelected(g)}>{t('patients.duplicates.view')}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <TablePagination
        page={page} pageSize={pageSize} total={total} onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
        leftSlot={<span className="text-muted-foreground">{t('patients.duplicates.count', { count: total })}</span>}
      />
      <DuplicateGroupSheet
        group={selected} canManage={canManage} onClose={() => setSelected(null)} onChanged={() => { void load(); }}
        onOpen={(ref) => { setSelected(null); onOpen(ref); }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Add the tab to the page**

In `apps/studio/src/pages/Patients.tsx`, import `{ DuplicatesTab } from '@/patients/DuplicatesTab'`, add a trigger after the systems trigger:

```tsx
            <TabsTrigger value="duplicates" data-testid="patients-tab-duplicates">{t('patients.tabs.duplicates')}</TabsTrigger>
```

and a panel after the systems panel:

```tsx
        <TabsContent value="duplicates" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <DuplicatesTab
            canManage={hasCapability('patients.manage')}
            canExport={hasCapability('patients.view_identifiers')}
            onOpen={setOpenRef}
          />
        </TabsContent>
```

- [ ] **Step 8: Run the studio tests and typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients src/i18n`. Never the whole studio suite.
Expected: PASS, including the locale parity test.
Run: `pnpm --filter @openldr/studio run typecheck`, redirected, read the exit code.
Expected: `exit=0`.
If the Radix Select does not open on `click` in jsdom, open it with `pointerDown` as `openMenu` does, and say so in the report.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/patients/DuplicatesTab.tsx apps/studio/src/patients/DuplicatesTab.test.tsx apps/studio/src/patients/DuplicateGroupSheet.tsx apps/studio/src/patients/DuplicateGroupSheet.test.tsx apps/studio/src/pages/Patients.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): duplicates tab and group sheet on the Patients page"
```

---

### Task 7: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/patients.md`, `fr/patients.md`, `pt/patients.md`
- Modify: `apps/web/src/docs/0.1.8/patients.md`
- Modify: `apps/web/src/docs/0.1.8/upgrading.md`
- Modify: `docs/CLI-REFERENCE.md`, `docs/HTTP-API.md`

- [ ] **Step 1: Add the section to each in-app page and the web page**

Insert before the "## After upgrading" heading in each file.

en (in-app and web):

```markdown
## Duplicates

The **Duplicates** tab lists patients that look like the same person. CE finds two kinds:

- **Same identifier.** Two or more patients carry the same value in the same identifier system, such as the same NRC. Identifiers with no system, and systems where **Search matches it** is off, are not used.
- **Same name and date of birth.** Surname, first name and date of birth match, ignoring case, extra spaces and accents. Patients whose sexes differ are not matched. A patient with no date of birth is never matched this way.

Only active patients are compared. CE does not merge patients: fix duplicates in the source system, and the next update from it clears the group here.

Click a group to see its patients. Choose **Open patient** from a patient's ⋯ menu to see the full record.

With the Manage patient index permission, choose **Mark as not duplicates** from the group's ⋯ menu when the patients are different people. You can add a reason. Use **Status** to see these groups again, and **Show again** to undo.

With the View patient identifiers permission, choose **Export CSV** from the tab's ⋯ menu to send the open groups to the source system's team. Each export is written to the audit log.
```

fr:

```markdown
## Doublons

L'onglet **Doublons** liste les patients qui semblent être la même personne. CE en trouve deux sortes :

- **Même identifiant.** Deux patients ou plus portent la même valeur dans le même système d'identifiants, par exemple le même NRC. Les identifiants sans système, et les systèmes où **La recherche le trouve** est désactivé, ne sont pas utilisés.
- **Même nom et même date de naissance.** Le nom, le prénom et la date de naissance correspondent, sans tenir compte des majuscules, des espaces en trop ni des accents. Les patients de sexes différents ne sont pas rapprochés. Un patient sans date de naissance n'est jamais rapproché de cette façon.

Seuls les patients actifs sont comparés. CE ne fusionne pas les patients : corrigez les doublons dans le système source, et la mise à jour suivante fait disparaître le groupe ici.

Cliquez sur un groupe pour voir ses patients. Choisissez **Ouvrir le patient** dans le menu ⋯ d'un patient pour voir le dossier complet.

Avec l'autorisation Gérer l'index des patients, choisissez **Marquer comme pas des doublons** dans le menu ⋯ du groupe quand les patients sont des personnes différentes. Vous pouvez ajouter un motif. Utilisez **Statut** pour revoir ces groupes, et **Afficher à nouveau** pour annuler.

Avec l'autorisation Voir les identifiants des patients, choisissez **Exporter en CSV** dans le menu ⋯ de l'onglet pour envoyer les groupes ouverts à l'équipe du système source. Chaque export est inscrit au journal d'audit.
```

pt:

```markdown
## Duplicados

O separador **Duplicados** lista pacientes que parecem ser a mesma pessoa. O CE encontra dois tipos:

- **Mesmo identificador.** Dois ou mais pacientes têm o mesmo valor no mesmo sistema de identificadores, por exemplo o mesmo NRC. Os identificadores sem sistema, e os sistemas em que **A pesquisa encontra-o** está desligado, não são usados.
- **Mesmo nome e data de nascimento.** O apelido, o nome próprio e a data de nascimento coincidem, sem contar maiúsculas, espaços a mais nem acentos. Pacientes de sexos diferentes não são juntados. Um paciente sem data de nascimento nunca é juntado desta forma.

Só os pacientes ativos são comparados. O CE não funde pacientes: corrija os duplicados no sistema de origem, e a atualização seguinte remove o grupo aqui.

Clique num grupo para ver os seus pacientes. Escolha **Abrir paciente** no menu ⋯ de um paciente para ver o registo completo.

Com a permissão Gerir índice de pacientes, escolha **Marcar como não duplicados** no menu ⋯ do grupo quando os pacientes são pessoas diferentes. Pode acrescentar um motivo. Use **Estado** para voltar a ver esses grupos, e **Mostrar de novo** para anular.

Com a permissão Ver identificadores de pacientes, escolha **Exportar CSV** no menu ⋯ do separador para enviar os grupos abertos à equipa do sistema de origem. Cada exportação fica registada na auditoria.
```

In each page's "From the command line" list, add:

```markdown
- `openldr patients duplicates list [--status open|dismissed|all] [--identifiers]`
- `openldr patients duplicates dismiss <idA> <idB> [--reason <text>]` and `restore <idA> <idB>`
- `openldr patients duplicates export [--out <file>]`
```

In each page's "After upgrading" section, change the sentence so it says the reproject also fills in the name and date of birth used to find duplicates (en: "It also fills in what CE needs to find patients with the same name and date of birth."; fr: "Elle remplit aussi ce dont CE a besoin pour trouver les patients ayant le même nom et la même date de naissance."; pt: "Também preenche o que o CE precisa para encontrar pacientes com o mesmo nome e data de nascimento.").

- [ ] **Step 2: Upgrade note, CLI and HTTP reference**

In `apps/web/src/docs/0.1.8/upgrading.md`, after the Patient Index paragraph:

```markdown
If you upgrade from a release before duplicate detection, run `openldr db reproject --force` once. It stores the normalised name and date of birth that the Duplicates tab matches on.
```

In `docs/CLI-REFERENCE.md`, add the four `patients duplicates` commands to the patients section, matching its format. In `docs/HTTP-API.md`, add the four routes from spec section 5 with their capabilities, the 400 and 404 rules, and the audit actions.

- [ ] **Step 3: Run the docs tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run src/docs`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/patients.md apps/studio/src/docs/0.1.8/fr/patients.md apps/studio/src/docs/0.1.8/pt/patients.md apps/web/src/docs/0.1.8/patients.md apps/web/src/docs/0.1.8/upgrading.md docs/CLI-REFERENCE.md docs/HTTP-API.md
git commit -m "docs: patient duplicates in en, fr and pt, CLI and HTTP reference, upgrade note"
```

---

### Task 8: Gate, merge, changelog, live check

Operator-gated: merge and push wait for a yes.

- [ ] **Step 1: Full gate**

```bash
pnpm turbo run test --force --concurrency=2 --continue > "$TMP/dup-gate-test.txt" 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > "$TMP/dup-gate-tc.txt" 2>&1; echo "exit=$?"
```

On a failure, grep for `Test timed out`, `out of memory` and `VirtualAlloc` before calling it a regression.

- [ ] **Step 2: Ask the operator to merge. On a yes:** merge `feat/patient-duplicates` into local `main` with `--no-ff`, run `pnpm make:changelog`, commit the changelog, push, confirm the origin SHA.

- [ ] **Step 3: Live check.** Nodemon restarts the API when the merge touches `packages/` (confirm the new PID). Then:
  1. Run `openldr db reproject --force` to fill `match_key`.
  2. Ingest two Patients sharing an NRC and two sharing name and date of birth (one with sex, one without).
  3. In `/studio/patients`, open Duplicates: both groups show. Open one, open a member patient.
  4. Mark one group as not duplicates with a reason; it leaves Open and shows under Not duplicates; Show again brings it back.
  5. Export CSV and check the rows.
  6. Check `/audit` for the dismiss, restore and export entries.
  7. 375x812: the tab and the group sheet fit the width.
