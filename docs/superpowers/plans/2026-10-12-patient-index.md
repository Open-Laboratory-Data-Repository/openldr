# Patient Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Patient Index page in studio, backed by every `Patient.identifier` in the warehouse, with server-side masking.

**Architecture:** A new warehouse table `patient_identifiers` is filled by the projection's owned-rows path. Two bootstrap modules serve the routes and the CLI. `patient-identifier-systems.ts` owns the operator's labels, which live in a terminology code system. `patient-index.ts` reads patients and does all masking. Studio copies `TestCatalog.tsx`.

**Tech Stack:** Kysely (Postgres, MySQL, MSSQL warehouse; pg-mem in tests), Fastify, commander, React with shadcn and Radix, i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-patient-index-design.md`

## Global Constraints

- Work in `.claude/worktrees/patient-index` on branch `feat/patient-index`. Stage by exact path. Never `git add <dir>`.
- No `Co-Authored-By` trailer on any commit.
- Next external migration is `025_patient_identifiers`. Check `git branch -a` for a branch claiming 025 before Task 1.
- Capability keys are exactly `patients.view`, `patients.view_identifiers`, `patients.manage`.
- Label code system URL is exactly `urn:openldr:cs:patient-identifier-system`.
- A response built without `patients.view_identifiers` never contains a name, an identifier value, `patient_guid`, a full date of birth, phone, email, or a raw patient id.
- Masked name: first character then `***`. Masked identifier: `•••` plus the last 4 characters, or `•••` alone for 4 characters or fewer.
- Masked search is exact match on a searchable identifier value or `patient_guid`. No partial match.
- Audit never records search text.
- Any `ORDER BY` with `OFFSET` ends with a unique column (`AGENTS.md` §7).
- Studio follows `AGENTS.md` §5: actions in a `⋯` `DropdownMenu`, Sheets not Dialogs, label left and input right, `StripedEmpty` and `LoadingState`, `TablePagination` on every table, shadcn only.
- Every studio string goes into `en.ts`, `fr.ts` and `pt.ts` in the same task. A parity test enforces matching keys.
- No em dashes in new prose, comments or strings (`unslop` rule 13).
- Gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`.

## Two changes to the spec, found while planning

1. **The patient id is itself an identifier.** The HL7 v2 converter builds `Patient/hl7-{patient_id}` from PID-3 (`wasm/hl7v2/src/mapping.rs:55`). A masked response that carried `id` would leak the ID. So every row carries an opaque `ref`: the id sealed with AES-256-GCM (`seal` and `open` in `packages/core/src/crypto.ts`) under a random key made when the process starts. Detail routes take the `ref`. Unmasked responses also carry `id`. A `ref` stops working when the server restarts, and the page then reloads its list. The CLI takes the raw id, because its key differs from the server's.
2. **One Identifiers column, not one column per system.** `ColumnDef` headers always render `t(labelKey)` (`apps/studio/src/components/data-table/types.ts:11`, `ColumnPickerPopover.tsx:70`), so an operator's label cannot be a header without changing the shared table. The list has one Identifiers column. It stacks each `listColumn` identifier as `Label: value`, which also suits a phone.

Task 0 writes both into the spec.

## Review Focus

- A Patient whose `identifier` array repeats the same system and value must not crash the writer on a duplicate primary key. Pinned in Task 2.
- A masked user who types a partial name must get zero rows, not a filtered list. Pinned in Task 5 and Task 6.
- A `ref` that is tampered with, from an old process, or not base64 must return 404, never 500. Pinned in Task 5 and Task 6.
- A lab that pulled the label code system from central must refuse a local label edit with 409, and the UI must hide Edit. Pinned in Task 4, Task 6 and Task 9.
- Requests with a null `authored_at` must sort last on every dialect, because Postgres sorts nulls first in `desc`. Pinned in Task 5.

---

### Task 0: Amend the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-patient-index-design.md`

- [ ] **Step 1: Add the ref rule under "2. Access and masking", after the masking table**

```markdown
### Patient references

A patient's resource id can carry an identifier. The HL7 v2 converter builds `Patient/hl7-{patient_id}`
from PID-3 (`wasm/hl7v2/src/mapping.rs:55`). So no masked response carries the id. Every row carries
`ref`, the id sealed with AES-256-GCM under a random key made when the process starts. Detail routes
take `ref`. Unmasked rows carry `id` as well. A `ref` stops working after a restart. The CLI takes the
raw id.
```

- [ ] **Step 2: Replace the Patients tab "Columns" bullet**

Old: `- Columns: name, sex, age, one column per identifier system with \`listColumn\`, managing facility, last request date, request count.`

New:

```markdown
- Columns: name, sex, age, identifiers, managing facility, last request date, request count. The
  identifiers column stacks each `listColumn` identifier as `Label: value`. Table headers are i18n
  keys, so an operator's label cannot be a header without changing the shared table.
```

- [ ] **Step 3: Replace the route table's `:id` paths with `:ref`**

`GET /api/patients/:id` becomes `GET /api/patients/:ref`, and `GET /api/patients/:id/requests` becomes `GET /api/patients/:ref/requests`.

- [ ] **Step 4: Replace the "Terminology sync" open point**

```markdown
- Terminology sync. Checked: a lab that pulls a code system from central stamps it
  `managed_origin = 'central'` (`packages/sync/src/terminology-sync.ts:114`). The label edit refuses
  with 409 there, as result fields do (`packages/bootstrap/src/result-fields.ts:71-83`).
```

- [ ] **Step 5: Name the facility source**

Replace `Managing facility shows the facility name when \`managing_organization\` matches a register facility, else the raw reference.` with:

```markdown
Managing facility shows `facility_name` from the warehouse `facilities` table when its id matches
`managing_organization` without the `Organization/` prefix, else the raw reference. That table holds
projected Organizations, which is what the reference points at.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-12-patient-index-design.md
git commit -m "docs: patient index spec, opaque patient refs and one identifiers column"
```

---

### Task 1: Warehouse table `patient_identifiers`

**Files:**
- Create: `packages/db/src/migrations/external/025_patient_identifiers.ts`
- Create: `packages/db/src/migrations/external/025_patient_identifiers.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/migrations/migrations.test.ts:15`
- Modify: `packages/db/src/schema/external.ts` (new interface, `ExternalSchema`, `EXTERNAL_TABLE_COLUMNS`)
- Modify: `packages/db/src/export-data.test.ts:26-29`
- Modify: `packages/dashboards/src/models/registry.ts:16-49`

**Interfaces:**
- Produces: table `patient_identifiers(id, patient_id, system, value, type_code, type_text, use, source_system, plugin_id, plugin_version, batch_id, created_at)`; type `PatientIdentifiersTable`; key `patient_identifiers` in `ExternalSchema`.

- [ ] **Step 1: Write the failing migration test**

`packages/db/src/migrations/external/025_patient_identifiers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDbWithMem } from '../../test-helpers-external';
import { collectCompiledSql } from './compile-test-helpers';
import * as m025 from './025_patient_identifiers';

// pg-mem checks the table on emulated Postgres. MySQL and MSSQL are checked offline against Kysely's
// compilers, as in 023's test. Neither proves a real MSSQL or MySQL accepts it.
describe('025_patient_identifiers', () => {
  it('creates patient_identifiers with its columns and both indexes', async () => {
    const { mem } = await makeMigratedExternalDbWithMem();
    const table = mem.public.getTable('patient_identifiers');
    const columns = (table as unknown as { listColumns(): Array<{ id: string }> }).listColumns();
    expect(columns.map((c) => c.id).sort()).toEqual([
      'batch_id', 'created_at', 'id', 'patient_id', 'plugin_id', 'plugin_version', 'source_system',
      'system', 'type_code', 'type_text', 'use', 'value',
    ]);
    const indexes = table.listIndices().map((i) => i.name);
    expect(indexes).toContain('patient_identifiers_patient_idx');
    expect(indexes).toContain('patient_identifiers_system_value_idx');
  });

  it('down() drops the table', async () => {
    const { mem, db } = await makeMigratedExternalDbWithMem();
    await m025.down(db);
    expect(() => mem.public.getTable('patient_identifiers')).toThrow();
  });

  it('uses key-sized columns and utf8mb4 on MySQL, and key-sized columns on MSSQL', async () => {
    const mysql = await collectCompiledSql('mysql', (db) => m025.up(db, 'mysql'));
    expect(mysql[0]).toContain('`value` varchar(255) not null');
    expect(mysql[0]).toContain('`system` varchar(255)');
    expect(mysql[0]).toContain('character set utf8mb4');
    expect(mysql[2]).toBe('create index `patient_identifiers_system_value_idx` on `patient_identifiers` (`system`, `value`)');
    const mssql = await collectCompiledSql('mssql', (db) => m025.up(db, 'mssql'));
    expect(mssql[0]).toContain('"value" varchar(450) not null');
    expect(mssql[2]).toBe('create index "patient_identifiers_system_value_idx" on "patient_identifiers" ("system", "value")');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/external/025_patient_identifiers.test.ts`
Expected: FAIL, cannot resolve `./025_patient_identifiers`.

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/external/025_patient_identifiers.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// Every Patient.identifier, one row each (docs/superpowers/specs/2026-10-12-patient-index-design.md,
// section 1). patients.patient_guid keeps only the first identifier and drops its system, so an MPI
// number, NRC or folder number after the first could not be searched. A Patient owns its rows: the
// writer replaces the whole set on each new version, scoped on patient_id.
//
// `id` is derived from (patient_id, system, value) by boundedRowId, as lab_request_attributes' is.
// system and value are key-sized so (system, value) can be indexed on MySQL and MSSQL. On MSSQL
// two varchar(450) columns are 900 bytes, inside the 1,700-byte nonclustered index key limit.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  let built = db.schema.createTable('patient_identifiers')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('patient_id', key, (c) => c.notNull())
    .addColumn('system', key)
    .addColumn('value', key, (c) => c.notNull())
    .addColumn('type_code', text)
    .addColumn('type_text', text)
    .addColumn('use', text)
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // The writer replaces a patient's identifiers by this column (delete in scope, then insert).
  await db.schema.createIndex('patient_identifiers_patient_idx')
    .on('patient_identifiers').column('patient_id').execute();
  // Search matches an exact value within the searchable systems.
  await db.schema.createIndex('patient_identifiers_system_value_idx')
    .on('patient_identifiers').columns(['system', 'value']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('patient_identifiers').execute();
}
```

- [ ] **Step 4: Register it**

In `packages/db/src/migrations/external/index.ts` add after the m024 import:

```ts
import * as m025 from './025_patient_identifiers';
```

and after the `'024_lab_result_status'` entry:

```ts
    '025_patient_identifiers': { up: (db) => m025.up(db, engine), down: m025.down },
```

In `packages/db/src/migrations/migrations.test.ts:15`, append `'025_patient_identifiers'` after `'024_lab_result_status'` in the external list.

- [ ] **Step 5: Add the schema type**

In `packages/db/src/schema/external.ts`, after `LabRequestAttributesTable`:

```ts
/** Every Patient.identifier (migration 025). One row per (patient, system, value). `id` is derived
 *  from those three, so a repeated identifier collapses to one row. The writer replaces a patient's
 *  whole set on every new version of the Patient. `system` is null when the sender gave none. */
export interface PatientIdentifiersTable {
  id: string;
  patient_id: string;
  system: string | null;
  value: string;
  type_code: string | null;
  type_text: string | null;
  use: string | null;
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
  created_at: Generated<Date>;
}
```

Add `patient_identifiers: PatientIdentifiersTable;` as the last key of `ExternalSchema`, and this as the last entry of `EXTERNAL_TABLE_COLUMNS`:

```ts
  patient_identifiers: ['id', 'patient_id', 'system', 'value', 'type_code', 'type_text', 'use', 'source_system', 'plugin_id', 'plugin_version', 'batch_id', 'created_at'],
```

- [ ] **Step 6: Hide it from analytics**

In `packages/dashboards/src/models/registry.ts`, add to `HARDCODED_DENY_UNION` after `test_map`:

```ts
  // patient_identifiers holds MPI numbers, national ids and folder numbers. Hidden until an operator
  // decides, as patients' identifiers are. The patient index page reads it directly, not through
  // this policy.
  patient_identifiers: ['id', 'patient_id', 'value', 'plugin_id', 'plugin_version', 'batch_id'],
```

and to `PII_COLUMNS` after `lab_request_attributes`:

```ts
  patient_identifiers: ['value'],
```

- [ ] **Step 7: Update the exhaustive table list test**

In `packages/db/src/export-data.test.ts`, add a comment line above the `it(`:

```ts
  // patient_identifiers is included deliberately: rows a Patient owns (migration 025). Its value
  // column is hidden in Data Exposure by default.
```

Rename the test to end `..., the lab_request_attributes table, and the patient_identifiers table'` and insert `'patient_identifiers'` into the sorted array between `'lab_results'` and `'patients'`.

- [ ] **Step 8: Run the db and dashboards tests**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations src/export-data.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/dashboards exec vitest run`
Expected: PASS. If a dashboards test pins the `HARDCODED_DENY_UNION` keys, add `patient_identifiers` to its list.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/external/025_patient_identifiers.ts packages/db/src/migrations/external/025_patient_identifiers.test.ts packages/db/src/migrations/external/index.ts packages/db/src/migrations/migrations.test.ts packages/db/src/schema/external.ts packages/db/src/export-data.test.ts packages/dashboards/src/models/registry.ts
git commit -m "feat(db): patient_identifiers warehouse table"
```

---

### Task 2: Project every Patient.identifier

**Files:**
- Modify: `packages/db/src/relational/patient.ts`
- Modify: `packages/db/src/relational/index.ts:60-80`
- Test: `packages/db/src/relational/patient.test.ts`
- Test: `packages/db/src/relational-writer.test.ts`

**Interfaces:**
- Consumes: `PatientIdentifiersTable` (Task 1), `boundedRowId` from `./row-id`.
- Produces: `projectPatientIdentifiers(r: Record<string, unknown>, prov: Provenance): Insertable<PatientIdentifiersTable>[]`.

- [ ] **Step 1: Write the failing projector tests**

Append to `packages/db/src/relational/patient.test.ts`:

```ts
import { projectPatientIdentifiers } from './patient';

describe('projectPatientIdentifiers', () => {
  const patient = (identifier: unknown[]) => ({ resourceType: 'Patient', id: 'p1', identifier });

  it('writes one row per identifier with its system, type and use', () => {
    const rows = projectPatientIdentifiers(patient([
      { system: 'urn:zm:mpi', value: 'MPI-1', use: 'official', type: { coding: [{ code: 'MR' }], text: 'MPI number' } },
      { system: 'urn:zm:nrc', value: '123456/10/1', type: { coding: [{ code: 'NI', display: 'National id' }] } },
    ]), { sourceSystem: 'hims' });
    expect(rows.map((r) => [r.patient_id, r.system, r.value, r.type_code, r.type_text, r.use, r.source_system])).toEqual([
      ['p1', 'urn:zm:mpi', 'MPI-1', 'MR', 'MPI number', 'official', 'hims'],
      ['p1', 'urn:zm:nrc', '123456/10/1', 'NI', 'National id', null, 'hims'],
    ]);
  });

  it('keeps an identifier with no system and skips one with no value', () => {
    const rows = projectPatientIdentifiers(patient([{ value: 'F-77' }, { system: 'urn:x' }, { system: 'urn:y', value: '' }]), {});
    expect(rows.map((r) => [r.system, r.value])).toEqual([[null, 'F-77']]);
  });

  it('collapses a repeated system and value to one row', () => {
    const rows = projectPatientIdentifiers(patient([{ system: 'urn:zm:mpi', value: 'A' }, { system: 'urn:zm:mpi', value: 'A' }]), {});
    expect(rows).toHaveLength(1);
  });

  it('returns no rows for a patient without identifiers', () => {
    expect(projectPatientIdentifiers({ resourceType: 'Patient', id: 'p1' }, {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/patient.test.ts`
Expected: FAIL, `projectPatientIdentifiers` is not exported.

- [ ] **Step 3: Write the projector**

In `packages/db/src/relational/patient.ts`, change the type import to `import type { PatientsTable, PatientIdentifiersTable } from '../schema/external';`, add `import { boundedRowId } from './row-id';`, and append:

```ts
/** One row per `Patient.identifier` with a value (patient index spec, section 1). A repeated
 *  (system, value) keeps one row: the id is derived from (patient, system, value), so two rows would
 *  collide on insert (Postgres and SQL Server reject the duplicate key; pg-mem does not). */
export function projectPatientIdentifiers(
  r: Record<string, unknown>, prov: Provenance,
): Insertable<PatientIdentifiersTable>[] {
  const patientId = String(r['id']);
  const identifiers = (r['identifier'] as Record<string, unknown>[] | undefined) ?? [];
  const byId = new Map<string, Insertable<PatientIdentifiersTable>>();
  for (const idn of identifiers) {
    const value = str(idn['value']);
    if (!value) continue;
    const system = str(idn['system']) || null;
    const type = idn['type'] as Record<string, unknown> | undefined;
    const coding = (type?.['coding'] as Record<string, unknown>[] | undefined)?.[0];
    const id = boundedRowId([patientId, system ?? '', value], 'pid');
    byId.set(id, {
      id,
      patient_id: patientId,
      system,
      value,
      type_code: str(coding?.['code']),
      type_text: str(type?.['text']) ?? str(coding?.['display']),
      use: str(idn['use']),
      ...provColumns(prov),
    });
  }
  return [...byId.values()];
}
```

- [ ] **Step 4: Run the projector tests**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/patient.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing writer tests**

Add a `describe` block to `packages/db/src/relational-writer.test.ts`. It uses the file's existing imports (`createRelationalWriter`, `makeMigratedExternalDb`):

```ts
describe('relational writer: patient identifiers', () => {
  const pat = (identifier: unknown[], id = 'p1') => ({ resourceType: 'Patient', id, name: [{ family: 'Banda' }], identifier });

  it('writes the patient and one row per identifier', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    await w.write(pat([{ system: 'urn:zm:mpi', value: 'M1' }, { system: 'urn:zm:nrc', value: 'N1' }]), {});
    expect(await db.selectFrom('patient_identifiers').select(['patient_id', 'system', 'value']).orderBy('system').execute())
      .toEqual([{ patient_id: 'p1', system: 'urn:zm:mpi', value: 'M1' }, { patient_id: 'p1', system: 'urn:zm:nrc', value: 'N1' }]);
    await db.destroy();
  });

  it('replaces the set on a new version, down to none', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    await w.write(pat([{ system: 'urn:zm:mpi', value: 'M1' }, { system: 'urn:zm:nrc', value: 'N1' }]), {});
    await w.write(pat([{ system: 'urn:zm:mpi', value: 'M1' }]), {});
    expect(await db.selectFrom('patient_identifiers').select('value').execute()).toEqual([{ value: 'M1' }]);
    await w.write(pat([]), {});
    expect(await db.selectFrom('patient_identifiers').selectAll().execute()).toEqual([]);
    await db.destroy();
  });

  it('deleteById removes the patient and its identifiers', async () => {
    const db = await makeMigratedExternalDb();
    const w = createRelationalWriter(db as never, 'postgres');
    await w.write(pat([{ system: 'urn:zm:mpi', value: 'M1' }]), {});
    await w.deleteById('Patient', 'p1');
    expect(await db.selectFrom('patient_identifiers').selectAll().execute()).toEqual([]);
    await db.destroy();
  });
});
```

- [ ] **Step 6: Run and see it fail**

Run: `pnpm --filter @openldr/db exec vitest run src/relational-writer.test.ts -t "patient identifiers"`
Expected: FAIL, `patient_identifiers` stays empty.

- [ ] **Step 7: Route Patient through the owned-rows path**

In `packages/db/src/relational/index.ts`, change the import to `import { projectPatient, projectPatientIdentifiers } from './patient';`. Add a case to `projectOwnedRows` before `case 'ServiceRequest'`:

```ts
    case 'Patient':
      return [{
        table: 'patient_identifiers',
        rows: projectPatientIdentifiers(r, prov),
        scope: { column: 'patient_id', value: String(r['id']) },
      }];
```

And to `ownedTablesFor`:

```ts
    case 'Patient': return [{ table: 'patient_identifiers', scopeColumn: 'patient_id' }];
```

- [ ] **Step 8: Run the whole db package**

Run: `pnpm --filter @openldr/db exec vitest run`
Expected: PASS. If `relational/index.test.ts` pins `ownedTablesFor` per resource type, add the Patient row to its expectation.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/relational/patient.ts packages/db/src/relational/patient.test.ts packages/db/src/relational/index.ts packages/db/src/relational-writer.test.ts
git commit -m "feat(db): project every Patient.identifier into patient_identifiers"
```

---

### Task 3: Capabilities

**Files:**
- Modify: `packages/rbac/src/catalog.ts`
- Modify: `packages/rbac/src/presets.ts`
- Test: `packages/rbac/src/catalog.test.ts`

**Interfaces:**
- Produces: keys `patients.view`, `patients.view_identifiers`, `patients.manage` in group `patients`.

- [ ] **Step 1: Write the failing tests**

In `packages/rbac/src/catalog.test.ts`, change the count test to 43, extending its comment with `// 40 -> 43: patients.view, patients.view_identifiers and patients.manage for the Patient Index.`, and append:

```ts
describe('patients capabilities', () => {
  const role = (slug: string) => SYSTEM_ROLES.find((r) => r.slug === slug)!;

  it('exposes view, view_identifiers and manage', () => {
    expect(CAPABILITY_KEYS).toEqual(expect.arrayContaining(['patients.view', 'patients.view_identifiers', 'patients.manage']));
  });

  it('gives the manager all three, analyst and auditor only the masked view, the technician none', () => {
    expect(role('lab_manager').capabilities).toEqual(expect.arrayContaining(['patients.view', 'patients.view_identifiers', 'patients.manage']));
    for (const slug of ['data_analyst', 'system_auditor']) {
      expect(role(slug).capabilities).toContain('patients.view');
      expect(role(slug).capabilities).not.toContain('patients.view_identifiers');
      expect(role(slug).capabilities).not.toContain('patients.manage');
    }
    expect(role('lab_technician').capabilities.some((c) => c.startsWith('patients.'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/rbac exec vitest run`
Expected: FAIL on the count (40) and the new block.

- [ ] **Step 3: Add the catalog rows and group**

In `packages/rbac/src/catalog.ts`, after the Facilities rows:

```ts
  // Patients
  { key: 'patients.view', group: 'patients', label: 'View patient index', description: 'Open the Patient Index. Names and identifiers are masked, and search matches an exact identifier only.' },
  { key: 'patients.view_identifiers', group: 'patients', label: 'View patient identifiers', description: 'See patient names, identifiers, date of birth, phone and email in full, and search by name. Every unmasked view is audited.' },
  { key: 'patients.manage', group: 'patients', label: 'Manage patient index', description: 'Name identifier systems and choose which ones are listed and searched.' },
```

In `GROUP_LABELS`, after `facilities: 'Facilities',` add `patients: 'Patients',`.

- [ ] **Step 4: Add them to the presets**

In `packages/rbac/src/presets.ts`: in `MANAGER` after `'facilities.view', 'facilities.manage',` add `'patients.view', 'patients.view_identifiers', 'patients.manage',`. In `ANALYST` and `AUDITOR`, after `'facilities.view',` add `'patients.view',`.

- [ ] **Step 5: Run the rbac and db role tests**

Run: `pnpm --filter @openldr/rbac exec vitest run`
Expected: PASS.
Run: `pnpm --filter @openldr/db exec vitest run src/role-store.test.ts`
Expected: PASS. If a test there pins the count of capability keys or grants, update it to 43 with a comment naming these three keys. Do not edit internal migration `067_capability_introductions.ts`, whose key list is frozen.

- [ ] **Step 6: Commit**

```bash
git add packages/rbac/src/catalog.ts packages/rbac/src/presets.ts packages/rbac/src/catalog.test.ts
git commit -m "feat(rbac): patients.view, patients.view_identifiers and patients.manage"
```

(Add `packages/db/src/role-store.test.ts` to the `git add` only if Step 5 changed it.)

---

### Task 4: Identifier system labels (bootstrap)

**Files:**
- Create: `packages/bootstrap/src/patient-identifier-systems.ts`
- Create: `packages/bootstrap/src/patient-identifier-systems.test.ts`
- Create: `packages/bootstrap/src/test-support/patient-index-fixture.ts`

**Interfaces:**
- Consumes: `patient_identifiers` (Task 1), `TerminologyAdminStore.codingSystems.upsertByUrl`, `markTerminologyChanged` from `@openldr/db`.
- Produces:

```ts
export const PATIENT_IDENTIFIER_SYSTEM = 'urn:openldr:cs:patient-identifier-system';
export class PatientIndexError extends Error { kind: 'invalid' | 'not-found' | 'central-managed' }
export interface SystemSettings { label: string | null; labelSource: 'operator' | 'source' | 'none'; listColumn: boolean; searchable: boolean }
export interface IdentifierSystemRow { system: string | null; label: string | null; labelSource: 'operator' | 'source' | 'none'; patientCount: number; listColumn: boolean; searchable: boolean }
export interface IdentifierSystemList { rows: IdentifierSystemRow[]; total: number; ownedHere: boolean }
export interface IdentifierSystemInput { system: string; label: string | null; listColumn: boolean; searchable: boolean }
export interface PatientIdentifierSystems {
  list(q: { limit: number; offset: number }): Promise<IdentifierSystemList>;
  settings(): Promise<Map<string, SystemSettings>>;   // keyed by system URI; null system is never a key
  get(system: string): Promise<IdentifierSystemRow | null>;
  set(input: IdentifierSystemInput): Promise<IdentifierSystemRow>;
  ownedHere(): Promise<boolean>;
}
export function createPatientIdentifierSystems(deps: { internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; admin: TerminologyAdminStore }): PatientIdentifierSystems;
export function parseSystemListQuery(raw: Record<string, unknown>): { ok: true; query: { limit: number; offset: number } } | { ok: false; error: string };
export function parseSystemInput(raw: unknown): { ok: true; input: IdentifierSystemInput } | { ok: false; error: string };
```

`label` is null when the system has no operator label and no source type text. The UI then shows the system URI. For the null system the UI shows "No system".

- [ ] **Step 1: Write the fixture**

`packages/bootstrap/src/test-support/patient-index-fixture.ts`:

```ts
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import {
  createFhirStore, createTerminologyStore, createTerminologyAdminStore,
  type ExternalSchema, type ValueSetProjection,
} from '@openldr/db';
import { createPatientIdentifierSystems } from '../patient-identifier-systems';

// Shared by the patient index tests: a migrated internal db with the real terminology admin store,
// a migrated warehouse, and seed helpers that write warehouse rows directly.

export async function buildPatientIndexFixture() {
  const internalDb = await makeMigratedDb();
  const externalDb = (await makeMigratedExternalDb()) as unknown as Kysely<ExternalSchema>;
  const fhirStore = createFhirStore(internalDb);
  const store = createTerminologyStore(internalDb, fhirStore);
  const projection: ValueSetProjection = {
    async saveValueSetResource(resource) {
      const saved = await fhirStore.save(resource as never);
      return (saved as { id?: string })?.id ?? String((resource as { id?: string }).id ?? '');
    },
    async registerSystem(url, version, kind, resourceId) { await store.saveSystem(url, version, kind, resourceId); },
    async deleteValueSetResource(url, id) {
      await fhirStore.delete('ValueSet', id);
      await internalDb.deleteFrom('terminology_systems').where('url', '=', url).execute();
    },
  };
  const admin = createTerminologyAdminStore(internalDb, projection);
  const systems = createPatientIdentifierSystems({ internalDb, externalDb, admin });
  return { internalDb, externalDb, admin, systems };
}

export async function seedPatient(db: Kysely<ExternalSchema>, p: {
  id: string; surname?: string | null; firstname?: string | null; dob?: string | null; sex?: string | null;
  guid?: string | null; phone?: string | null; email?: string | null; org?: string | null;
  active?: boolean; replacedBy?: string | null;
}) {
  await db.insertInto('patients').values({
    id: p.id, patient_guid: p.guid ?? null, surname: p.surname ?? null, firstname: p.firstname ?? null,
    date_of_birth: p.dob ?? null, sex: p.sex ?? null, national_id: null, phone: p.phone ?? null,
    email: p.email ?? null, managing_organization: p.org ?? null, active: p.active ?? true,
    replaced_by_id: p.replacedBy ?? null, source_system: null, plugin_id: null, plugin_version: null, batch_id: null,
  }).execute();
}

export async function seedIdentifier(db: Kysely<ExternalSchema>, patientId: string, system: string | null, value: string, typeText: string | null = null) {
  await db.insertInto('patient_identifiers').values({
    id: `${patientId}|${system ?? ''}|${value}`, patient_id: patientId, system, value,
    type_code: null, type_text: typeText, use: null,
    source_system: null, plugin_id: null, plugin_version: null, batch_id: null,
  }).execute();
}

export async function seedRequest(db: Kysely<ExternalSchema>, r: {
  id: string; patientId: string; authoredAt?: string | null; panel?: string | null; requester?: string | null; status?: string | null;
}) {
  await db.insertInto('lab_requests').values({
    id: r.id, patient_id: r.patientId, authored_at: r.authoredAt ?? null, panel_code: r.panel ?? null,
    panel_desc: r.panel ?? null, requester_display: r.requester ?? null, status: r.status ?? null,
  } as never).execute();
}

export async function seedResult(db: Kysely<ExternalSchema>, id: string, requestId: string, status: string | null = 'final') {
  await db.insertInto('lab_results').values({ id, request_id: requestId, status } as never).execute();
}
```

- [ ] **Step 2: Write the failing tests**

`packages/bootstrap/src/patient-identifier-systems.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PATIENT_IDENTIFIER_SYSTEM, PatientIndexError, parseSystemInput, parseSystemListQuery } from './patient-identifier-systems';
import { buildPatientIndexFixture, seedIdentifier, seedPatient } from './test-support/patient-index-fixture';

const MPI = 'urn:zm:mpi';
const NRC = 'urn:zm:nrc';

describe('patient identifier systems', () => {
  it('lists every system seen, with its patient count and the source type text as label', async () => {
    const { externalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    await seedPatient(externalDb, { id: 'p2' });
    await seedIdentifier(externalDb, 'p1', MPI, 'M1', 'MPI number');
    await seedIdentifier(externalDb, 'p2', MPI, 'M2', 'MPI number');
    await seedIdentifier(externalDb, 'p1', NRC, 'N1');
    await seedIdentifier(externalDb, 'p2', null, 'F-9');

    const out = await systems.list({ limit: 25, offset: 0 });

    expect(out.ownedHere).toBe(true);
    expect(out.total).toBe(3);
    expect(out.rows).toEqual([
      { system: null, label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true },
      { system: MPI, label: 'MPI number', labelSource: 'source', patientCount: 2, listColumn: false, searchable: true },
      { system: NRC, label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true },
    ]);
  });

  it('saves an operator label and both flags, and the operator label wins over the source text', async () => {
    const { externalDb, internalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    await seedIdentifier(externalDb, 'p1', MPI, 'M1', 'MPI number');

    const saved = await systems.set({ system: MPI, label: 'MPI', listColumn: true, searchable: false });

    expect(saved).toEqual({ system: MPI, label: 'MPI', labelSource: 'operator', patientCount: 1, listColumn: true, searchable: false });
    const concept = await internalDb.selectFrom('terminology_concepts').select(['code', 'display', 'properties'])
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).executeTakeFirstOrThrow();
    expect(concept.code).toBe(MPI);
    expect(concept.display).toBe('MPI');
    const props = typeof concept.properties === 'string' ? JSON.parse(concept.properties) : concept.properties;
    expect(props).toEqual({ listColumn: true, searchable: false });
    expect((await systems.settings()).get(MPI)).toEqual({ label: 'MPI', labelSource: 'operator', listColumn: true, searchable: false });
  });

  it('keeps property keys it does not manage', async () => {
    const { internalDb, systems } = await buildPatientIndexFixture();
    await systems.set({ system: MPI, label: 'MPI', listColumn: false, searchable: true });
    await internalDb.updateTable('terminology_concepts')
      .set({ properties: JSON.stringify({ listColumn: false, searchable: true, note: 'keep me' }) as never })
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).execute();
    await systems.set({ system: MPI, label: 'MPI 2', listColumn: true, searchable: true });
    const concept = await internalDb.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).executeTakeFirstOrThrow();
    const props = typeof concept.properties === 'string' ? JSON.parse(concept.properties) : concept.properties;
    expect(props).toEqual({ listColumn: true, searchable: true, note: 'keep me' });
  });

  it('clears the operator label with null and falls back to the source text', async () => {
    const { externalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    await seedIdentifier(externalDb, 'p1', MPI, 'M1', 'MPI number');
    await systems.set({ system: MPI, label: 'MPI', listColumn: false, searchable: true });
    const cleared = await systems.set({ system: MPI, label: null, listColumn: false, searchable: true });
    expect([cleared.label, cleared.labelSource]).toEqual(['MPI number', 'source']);
  });

  it('refuses an edit when central owns the label system', async () => {
    const { internalDb, systems } = await buildPatientIndexFixture();
    await internalDb.insertInto('terminology_systems').values({
      url: PATIENT_IDENTIFIER_SYSTEM, version: null, kind: 'CodeSystem', resource_id: '', generation: 1, managed_origin: 'central',
    } as never).execute();
    expect(await systems.ownedHere()).toBe(false);
    await expect(systems.set({ system: MPI, label: 'MPI', listColumn: false, searchable: true }))
      .rejects.toMatchObject({ kind: 'central-managed' });
    expect((await systems.list({ limit: 25, offset: 0 })).ownedHere).toBe(false);
  });

  it('pages with a stable order', async () => {
    const { externalDb, systems } = await buildPatientIndexFixture();
    await seedPatient(externalDb, { id: 'p1' });
    for (const s of ['urn:c', 'urn:a', 'urn:b']) await seedIdentifier(externalDb, 'p1', s, 'v');
    const page = await systems.list({ limit: 2, offset: 1 });
    expect([page.total, page.rows.map((r) => r.system)]).toEqual([3, ['urn:b', 'urn:c']]);
  });
});

describe('patient identifier system parsers', () => {
  it('parses the list query with defaults and bounds', () => {
    expect(parseSystemListQuery({})).toEqual({ ok: true, query: { limit: 25, offset: 0 } });
    expect(parseSystemListQuery({ limit: '0' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
    expect(parseSystemListQuery({ offset: '-1' })).toEqual({ ok: false, error: 'offset must be a whole number from 0' });
  });

  it('parses the input, trims the label and turns an empty label into null', () => {
    expect(parseSystemInput({ system: ' urn:zm:mpi ', label: '  ', listColumn: true, searchable: false }))
      .toEqual({ ok: true, input: { system: 'urn:zm:mpi', label: null, listColumn: true, searchable: false } });
    expect(parseSystemInput({ system: '', label: 'x', listColumn: true, searchable: true }))
      .toEqual({ ok: false, error: 'system is required' });
    expect(parseSystemInput({ system: 'urn:x', label: 'x', listColumn: 'yes', searchable: true }))
      .toEqual({ ok: false, error: 'listColumn and searchable must be true or false' });
  });

  it('PatientIndexError carries its kind', () => {
    expect(new PatientIndexError('no', 'not-found').kind).toBe('not-found');
  });
});
```

- [ ] **Step 3: Run and see it fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-identifier-systems.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write the module**

`packages/bootstrap/src/patient-identifier-systems.ts`:

```ts
import type { Kysely } from 'kysely';
import { markTerminologyChanged, type ExternalSchema, type InternalSchema, type TerminologyAdminStore } from '@openldr/db';

// Labels for patient identifier systems (docs/superpowers/specs/2026-10-12-patient-index-design.md,
// section 1). One concept per system URI in a code system CE creates on first write. The concept's
// display is the operator's label. Its properties hold two flags: listColumn (show in the list) and
// searchable (search may match it). Terminology lives in the internal db and identifiers in the
// warehouse, so the two are read separately and joined here.

export const PATIENT_IDENTIFIER_SYSTEM = 'urn:openldr:cs:patient-identifier-system';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const MANAGED_KEYS = ['listColumn', 'searchable'] as const;

export class PatientIndexError extends Error {
  constructor(message: string, public readonly kind: 'invalid' | 'not-found' | 'central-managed') {
    super(message);
    this.name = 'PatientIndexError';
  }
}

export interface SystemSettings { label: string | null; labelSource: 'operator' | 'source' | 'none'; listColumn: boolean; searchable: boolean }
export interface IdentifierSystemRow {
  system: string | null; label: string | null; labelSource: 'operator' | 'source' | 'none';
  patientCount: number; listColumn: boolean; searchable: boolean;
}
export interface IdentifierSystemList { rows: IdentifierSystemRow[]; total: number; ownedHere: boolean }
export interface IdentifierSystemInput { system: string; label: string | null; listColumn: boolean; searchable: boolean }

export interface PatientIdentifierSystems {
  list(q: { limit: number; offset: number }): Promise<IdentifierSystemList>;
  settings(): Promise<Map<string, SystemSettings>>;
  get(system: string): Promise<IdentifierSystemRow | null>;
  set(input: IdentifierSystemInput): Promise<IdentifierSystemRow>;
  ownedHere(): Promise<boolean>;
}

export function parseSystemListQuery(raw: Record<string, unknown>): { ok: true; query: { limit: number; offset: number } } | { ok: false; error: string } {
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  return { ok: true, query: { limit, offset: Number(offsetRaw) } };
}

export function parseSystemInput(raw: unknown): { ok: true; input: IdentifierSystemInput } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const system = typeof r.system === 'string' ? r.system.trim() : '';
  if (!system) return { ok: false, error: 'system is required' };
  if (typeof r.listColumn !== 'boolean' || typeof r.searchable !== 'boolean') {
    return { ok: false, error: 'listColumn and searchable must be true or false' };
  }
  if (r.label !== null && r.label !== undefined && typeof r.label !== 'string') return { ok: false, error: 'label must be text' };
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : null;
  return { ok: true, input: { system, label, listColumn: r.listColumn, searchable: r.searchable } };
}

function propsOf(properties: unknown): Record<string, unknown> {
  const value = typeof properties === 'string' ? (JSON.parse(properties) as unknown) : properties;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const compareSystems = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
};

export function createPatientIdentifierSystems(deps: {
  internalDb: Kysely<InternalSchema>; externalDb: Kysely<ExternalSchema>; admin: TerminologyAdminStore;
}): PatientIdentifierSystems {
  const { internalDb, externalDb, admin } = deps;

  async function ownedHere(): Promise<boolean> {
    // A lab that pulled this system from central has it stamped 'central' by its terminology drain,
    // as result fields' is (result-fields.ts, ownedHere).
    const row = await internalDb.selectFrom('terminology_systems').select('managed_origin')
      .where('url', '=', PATIENT_IDENTIFIER_SYSTEM).executeTakeFirst();
    return row?.managed_origin !== 'central';
  }

  async function concepts(): Promise<Map<string, { display: string | null; props: Record<string, unknown> }>> {
    const rows = await internalDb.selectFrom('terminology_concepts').select(['code', 'display', 'properties'])
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).execute();
    return new Map(rows.map((r) => [r.code, { display: r.display, props: propsOf(r.properties) }]));
  }

  /** The most common non-empty type_text per system. Ties go to the alphabetically first text. */
  async function sourceTexts(): Promise<Map<string, string>> {
    const rows = await externalDb.selectFrom('patient_identifiers')
      .select(['system', 'type_text', (eb) => eb.fn.countAll<string | number>().as('n')])
      .where('system', 'is not', null).where('type_text', 'is not', null)
      .groupBy(['system', 'type_text']).execute();
    const best = new Map<string, { text: string; n: number }>();
    for (const r of rows) {
      if (!r.system || !r.type_text) continue;
      const n = Number(r.n);
      const cur = best.get(r.system);
      if (!cur || n > cur.n || (n === cur.n && r.type_text < cur.text)) best.set(r.system, { text: r.type_text, n });
    }
    return new Map([...best].map(([s, v]) => [s, v.text]));
  }

  function settingsFor(system: string | null, concept: { display: string | null; props: Record<string, unknown> } | undefined, source: string | undefined): SystemSettings {
    const listColumn = concept?.props.listColumn === true;
    const searchable = concept?.props.searchable !== false;
    if (concept?.display) return { label: concept.display, labelSource: 'operator', listColumn, searchable };
    if (system !== null && source) return { label: source, labelSource: 'source', listColumn, searchable };
    return { label: null, labelSource: 'none', listColumn, searchable };
  }

  async function settings(): Promise<Map<string, SystemSettings>> {
    const [c, s] = await Promise.all([concepts(), sourceTexts()]);
    const out = new Map<string, SystemSettings>();
    for (const system of new Set([...c.keys(), ...s.keys()])) out.set(system, settingsFor(system, c.get(system), s.get(system)));
    return out;
  }

  async function allRows(): Promise<IdentifierSystemRow[]> {
    const [counts, c, s] = await Promise.all([
      externalDb.selectFrom('patient_identifiers')
        .select(['system', (eb) => eb.fn.count<string | number>('patient_id').distinct().as('n')])
        .groupBy('system').execute(),
      concepts(),
      sourceTexts(),
    ]);
    return counts
      .map((r) => ({ system: r.system, patientCount: Number(r.n), ...settingsFor(r.system, r.system === null ? undefined : c.get(r.system), r.system === null ? undefined : s.get(r.system)) }))
      .sort((a, b) => compareSystems(a.system, b.system));
  }

  async function list(q: { limit: number; offset: number }): Promise<IdentifierSystemList> {
    const rows = await allRows();
    return { rows: rows.slice(q.offset, q.offset + q.limit), total: rows.length, ownedHere: await ownedHere() };
  }

  async function get(system: string): Promise<IdentifierSystemRow | null> {
    const found = (await allRows()).find((r) => r.system === system);
    if (found) return found;
    const c = (await concepts()).get(system);
    return c ? { system, patientCount: 0, ...settingsFor(system, c, undefined) } : null;
  }

  async function set(input: IdentifierSystemInput): Promise<IdentifierSystemRow> {
    if (!(await ownedHere())) {
      throw new PatientIndexError('this lab receives its identifier system labels from central; only central can change them', 'central-managed');
    }
    // NOT SEEDED: the system holds an operator's labels, so the operator can delete it again, as a
    // register's own facility types can (facility-register-vocabulary.ts).
    await admin.codingSystems.upsertByUrl({
      url: PATIENT_IDENTIFIER_SYSTEM, systemCode: 'PATIENT-IDENTIFIER-SYSTEM',
      systemName: 'Patient identifier systems', systemVersion: null, publisherId: 'pub-system', seeded: false,
    });
    const stored = await internalDb.selectFrom('terminology_concepts').select('properties')
      .where('system', '=', PATIENT_IDENTIFIER_SYSTEM).where('code', '=', input.system).executeTakeFirst();
    const next: Record<string, unknown> = { ...propsOf(stored?.properties) };
    for (const k of MANAGED_KEYS) delete next[k];
    next.listColumn = input.listColumn;
    next.searchable = input.searchable;
    await internalDb.insertInto('terminology_concepts').values({
      system: PATIENT_IDENTIFIER_SYSTEM, code: input.system, display: input.label, status: 'ACTIVE',
      properties: JSON.stringify(next) as never,
    }).onConflict((oc) => oc.columns(['system', 'code']).doUpdateSet((eb) => ({
      display: eb.ref('excluded.display'), status: eb.ref('excluded.status'), properties: eb.ref('excluded.properties'),
    }))).execute();
    // One terminology_system signal per edit, as the test catalog does, so central's labels reach labs.
    await markTerminologyChanged(internalDb, PATIENT_IDENTIFIER_SYSTEM);
    const saved = await get(input.system);
    if (!saved) throw new PatientIndexError(`identifier system ${input.system} was not saved`, 'not-found');
    return saved;
  }

  return { list, settings, get, set, ownedHere };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-identifier-systems.test.ts`
Expected: PASS. If pg-mem rejects `count(distinct patient_id)`, replace that query with a `select system, patient_id ... groupBy(['system','patient_id'])` and count per system in code. Say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/patient-identifier-systems.ts packages/bootstrap/src/patient-identifier-systems.test.ts packages/bootstrap/src/test-support/patient-index-fixture.ts
git commit -m "feat(bootstrap): patient identifier system labels"
```

---

### Task 5: Patient index reads and masking (bootstrap)

**Files:**
- Create: `packages/bootstrap/src/patient-mask.ts`
- Create: `packages/bootstrap/src/patient-mask.test.ts`
- Create: `packages/bootstrap/src/patient-index.ts`
- Create: `packages/bootstrap/src/patient-index.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (AppContext fields near `:549-553`, construction near `:1001`, return object near `:1779`, barrel near `:1860`)

**Interfaces:**
- Consumes: `PatientIdentifierSystems`, `PatientIndexError` (Task 4); `seal`, `open` from `@openldr/core`.
- Produces:

```ts
// patient-mask.ts
export function maskName(s: string | null): string | null;
export function maskValue(v: string | null): string | null;
export function ageInYears(dob: string | null, now: Date): number | null;
export function birthYear(dob: string | null): string | null;
export interface RefCodec { encode(id: string): string; decode(ref: string): string | null }
export function createRefCodec(key?: Buffer): RefCodec;

// patient-index.ts
export type PatientStatus = 'active' | 'merged' | 'all';
export interface PatientListQuery { q: string; status: PatientStatus; limit: number; offset: number }
export interface PatientIdentifierView { system: string | null; label: string | null; value: string }
export interface PatientRow {
  ref: string; id: string | null; name: string | null; sex: string | null; birthDate: string | null;
  ageYears: number | null; identifiers: PatientIdentifierView[];
  managingFacility: { reference: string; name: string | null } | null;
  active: boolean; replacedByRef: string | null; lastRequestAt: string | null; requestCount: number;
}
export interface PatientList { rows: PatientRow[]; total: number; masked: boolean }
export interface PatientDetail extends PatientRow { patientGuid: string | null; phone: string | null; email: string | null; masked: boolean }
export interface PatientRequestRow { authoredAt: string | null; panel: string | null; requester: string | null; status: string | null; resultCount: number }
export interface PatientRequestList { rows: PatientRequestRow[]; total: number }
export interface PatientIndex {
  list(q: PatientListQuery, opts: { unmask: boolean }): Promise<PatientList>;
  get(ref: string, opts: { unmask: boolean }): Promise<PatientDetail>;          // throws PatientIndexError('not-found')
  getById(id: string, opts: { unmask: boolean }): Promise<PatientDetail>;       // CLI only
  idForRef(ref: string): string | null;                                         // for the route's audit entry
  requests(ref: string, q: { limit: number; offset: number }): Promise<PatientRequestList>;
  requestsById(id: string, q: { limit: number; offset: number }): Promise<PatientRequestList>; // CLI only
}
export function createPatientIndex(deps: { externalDb: Kysely<ExternalSchema>; systems: PatientIdentifierSystems; now?: () => Date; refKey?: Buffer }): PatientIndex;
export function parsePatientListQuery(raw: Record<string, unknown>): { ok: true; query: PatientListQuery } | { ok: false; error: string };
export function parsePageQuery(raw: Record<string, unknown>): { ok: true; query: { limit: number; offset: number } } | { ok: false; error: string };
```

In a list row, `identifiers` holds only `listColumn` systems. In a detail, it holds every identifier. `id` is null when masked.

- [ ] **Step 1: Write the failing mask tests**

`packages/bootstrap/src/patient-mask.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ageInYears, birthYear, createRefCodec, maskName, maskValue } from './patient-mask';

describe('patient masking', () => {
  it('masks a name to its first character', () => {
    expect([maskName('Mwanza'), maskName(' banda'), maskName('Émile'), maskName(''), maskName(null)]).toEqual(['M***', 'b***', 'É***', null, null]);
  });

  it('masks an identifier to its last four characters, or entirely when it is short', () => {
    expect([maskValue('123456/10/1'), maskValue('ABCDE'), maskValue('ABCD'), maskValue('A'), maskValue(null)])
      .toEqual(['•••10/1', '•••BCDE', '•••', '•••', null]);
  });

  it('works out whole years of age and the birth year', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    expect([ageInYears('1990-10-12', now), ageInYears('1990-10-13', now), ageInYears('2026', now), ageInYears(null, now), ageInYears('bad', now)])
      .toEqual([36, 35, 0, null, null]);
    expect([birthYear('1990-10-12'), birthYear('1990'), birthYear(null), birthYear('x')]).toEqual(['1990', '1990', null, null]);
  });

  it('round-trips a ref, and refuses one from another key or tampered', () => {
    const codec = createRefCodec(randomBytes(32));
    const ref = codec.encode('hl7-12345');
    expect(ref).not.toContain('12345');
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codec.decode(ref)).toBe('hl7-12345');
    expect(createRefCodec(randomBytes(32)).decode(ref)).toBeNull();
    expect(codec.decode(`${ref.slice(0, -2)}AA`)).toBeNull();
    expect(codec.decode('not a ref!')).toBeNull();
    expect(codec.decode('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-mask.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Write the mask module**

`packages/bootstrap/src/patient-mask.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { open, seal } from '@openldr/core';

// Masking for the patient index (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 2).
// Every patient response is built in patient-index.ts, which calls these, so an identifier never
// leaves the server for a caller without patients.view_identifiers.

/** First character then `***`. Array.from keeps a character outside the BMP whole. */
export function maskName(s: string | null): string | null {
  const t = s?.trim();
  if (!t) return null;
  return `${Array.from(t)[0]}***`;
}

/** `•••` plus the last four characters. Four or fewer would show the whole value, so they show none. */
export function maskValue(v: string | null): string | null {
  if (v === null) return null;
  return v.length <= 4 ? '•••' : `•••${v.slice(-4)}`;
}

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/;

export function birthYear(dob: string | null): string | null {
  return dob ? (DATE.exec(dob)?.[1] ?? null) : null;
}

/** Whole years on `now`. A year-only or year-month date counts from its first day. */
export function ageInYears(dob: string | null, now: Date): number | null {
  const m = dob ? DATE.exec(dob) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age < 0 ? null : age;
}

export interface RefCodec { encode(id: string): string; decode(ref: string): string | null }

/** A patient's resource id can carry an identifier (`Patient/hl7-{PID-3}`), so responses carry this
 *  opaque ref instead. AES-256-GCM under a key made when the process starts: a ref stops working on
 *  restart, and the page then reloads its list. base64url, so it fits a URL path. */
export function createRefCodec(key: Buffer = randomBytes(32)): RefCodec {
  return {
    encode(id) {
      return seal(id, key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(ref) {
      if (!/^[A-Za-z0-9_-]+$/.test(ref)) return null;
      const b64 = ref.replace(/-/g, '+').replace(/_/g, '/');
      try {
        return open(b64 + '='.repeat((4 - (b64.length % 4)) % 4), key);
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 4: Run the mask tests**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-mask.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing index tests**

`packages/bootstrap/src/patient-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createPatientIndex, parsePageQuery, parsePatientListQuery } from './patient-index';
import { buildPatientIndexFixture, seedIdentifier, seedPatient, seedRequest, seedResult } from './test-support/patient-index-fixture';

const MPI = 'urn:zm:mpi';
const NRC = 'urn:zm:nrc';
const NOW = () => new Date('2026-10-12T00:00:00Z');
const Q = { q: '', status: 'active' as const, limit: 25, offset: 0 };

async function build() {
  const f = await buildPatientIndexFixture();
  const index = createPatientIndex({ externalDb: f.externalDb, systems: f.systems, now: NOW, refKey: randomBytes(32) });
  await seedPatient(f.externalDb, { id: 'hl7-111', surname: 'Mwanza', firstname: 'John', dob: '1990-01-05', sex: 'M', guid: 'G-111', phone: '0977', email: 'j@x', org: 'Organization/fac-1' });
  await seedPatient(f.externalDb, { id: 'hl7-222', surname: 'Banda', firstname: 'Ruth', dob: '1985', sex: 'F', guid: 'G-222' });
  await seedPatient(f.externalDb, { id: 'hl7-333', surname: 'Phiri', firstname: 'Old', active: false, replacedBy: 'hl7-111' });
  await seedIdentifier(f.externalDb, 'hl7-111', MPI, 'MPI-0001', 'MPI number');
  await seedIdentifier(f.externalDb, 'hl7-111', NRC, '123456/10/1');
  await seedIdentifier(f.externalDb, 'hl7-222', MPI, 'MPI-0002', 'MPI number');
  await f.externalDb.insertInto('facilities').values({ id: 'fac-1', facility_name: 'Chilenje Clinic' } as never).execute();
  await f.systems.set({ system: MPI, label: 'MPI', listColumn: true, searchable: true });
  return { ...f, index };
}

describe('patient index: list', () => {
  it('lists active patients unmasked, by name, with listed identifiers, facility and request stats', async () => {
    const { externalDb, index } = await build();
    await seedRequest(externalDb, { id: 'r1', patientId: 'hl7-111', authoredAt: '2026-01-02' });
    await seedRequest(externalDb, { id: 'r2', patientId: 'hl7-111', authoredAt: '2026-03-04' });

    const out = await index.list(Q, { unmask: true });

    expect(out.masked).toBe(false);
    expect(out.total).toBe(2);
    expect(out.rows.map((r) => r.id)).toEqual(['hl7-222', 'hl7-111']);
    const john = out.rows[1];
    expect(john).toMatchObject({
      name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
      identifiers: [{ system: MPI, label: 'MPI', value: 'MPI-0001' }],
      managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' },
      active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2,
    });
    expect(typeof john.ref).toBe('string');
  });

  it('masks names, identifiers, birth date and the id', async () => {
    const { index } = await build();
    const out = await index.list(Q, { unmask: false });
    expect(out.masked).toBe(true);
    const john = out.rows.find((r) => r.name === 'J*** M***')!;
    expect(john).toMatchObject({ id: null, birthDate: '1990', ageYears: 36, identifiers: [{ system: MPI, label: 'MPI', value: '•••0001' }] });
    expect(JSON.stringify(out)).not.toMatch(/hl7-|Mwanza|MPI-0001|G-111|1990-01-05/);
  });

  it('finds a patient by any searchable identifier, exactly, masked or not', async () => {
    const { index } = await build();
    for (const unmask of [true, false]) {
      const out = await index.list({ ...Q, q: '123456/10/1' }, { unmask });
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].ageYears).toBe(36);
    }
    expect((await index.list({ ...Q, q: 'G-222' }, { unmask: false })).total).toBe(1);
  });

  it('gives a masked user nothing for a partial name or partial identifier', async () => {
    const { index } = await build();
    expect((await index.list({ ...Q, q: 'Mwan' }, { unmask: false })).rows).toEqual([]);
    expect((await index.list({ ...Q, q: 'MPI-000' }, { unmask: false })).rows).toEqual([]);
  });

  it('lets an unmasked user search part of a name or patient_guid, case-insensitively', async () => {
    const { index } = await build();
    expect((await index.list({ ...Q, q: 'mwan' }, { unmask: true })).rows.map((r) => r.id)).toEqual(['hl7-111']);
    expect((await index.list({ ...Q, q: 'g-2' }, { unmask: true })).rows.map((r) => r.id)).toEqual(['hl7-222']);
  });

  it('does not match a system marked not searchable', async () => {
    const { systems, index } = await build();
    await systems.set({ system: NRC, label: 'NRC', listColumn: false, searchable: false });
    expect((await index.list({ ...Q, q: '123456/10/1' }, { unmask: true })).rows).toEqual([]);
  });

  it('filters merged and all', async () => {
    const { index } = await build();
    const merged = await index.list({ ...Q, status: 'merged' }, { unmask: true });
    expect(merged.rows.map((r) => r.id)).toEqual(['hl7-333']);
    expect(merged.rows[0].replacedByRef).not.toBeNull();
    expect((await index.list({ ...Q, status: 'all' }, { unmask: true })).total).toBe(3);
  });

  it('pages with a unique tiebreak when names repeat', async () => {
    const { externalDb, index } = await build();
    await seedPatient(externalDb, { id: 'dup-b', surname: 'Same', firstname: 'Name' });
    await seedPatient(externalDb, { id: 'dup-a', surname: 'Same', firstname: 'Name' });
    const ids = (await index.list({ ...Q, q: 'same', limit: 1, offset: 0 }, { unmask: true })).rows.map((r) => r.id);
    const next = (await index.list({ ...Q, q: 'same', limit: 1, offset: 1 }, { unmask: true })).rows.map((r) => r.id);
    expect([...ids, ...next]).toEqual(['dup-a', 'dup-b']);
  });
});

describe('patient index: detail and requests', () => {
  it('returns every identifier, guid, phone and email unmasked', async () => {
    const { index } = await build();
    const ref = (await index.list({ ...Q, q: 'MPI-0001' }, { unmask: true })).rows[0].ref;
    const d = await index.get(ref, { unmask: true });
    expect(d).toMatchObject({ id: 'hl7-111', patientGuid: 'G-111', phone: '0977', email: 'j@x', masked: false });
    expect(d.identifiers).toEqual([
      { system: MPI, label: 'MPI', value: 'MPI-0001' },
      { system: NRC, label: null, value: '123456/10/1' },
    ]);
  });

  it('masks the detail and leaves out phone and email', async () => {
    const { index } = await build();
    const ref = (await index.list({ ...Q, q: 'MPI-0001' }, { unmask: false })).rows[0].ref;
    const d = await index.get(ref, { unmask: false });
    expect(d).toMatchObject({ id: null, patientGuid: '•••-111', phone: null, email: null, masked: true, name: 'J*** M***' });
    expect(d.identifiers.map((i) => i.value)).toEqual(['•••0001', '•••10/1']);
  });

  it('refuses a bad or foreign ref as not found', async () => {
    const { index, externalDb, systems } = await build();
    await expect(index.get('nope', { unmask: true })).rejects.toMatchObject({ kind: 'not-found' });
    const other = createPatientIndex({ externalDb, systems, now: NOW, refKey: randomBytes(32) });
    const foreign = (await other.list(Q, { unmask: true })).rows[0].ref;
    await expect(index.get(foreign, { unmask: true })).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('lists requests newest first, nulls last, with result counts that skip cancelled results', async () => {
    const { externalDb, index } = await build();
    await seedRequest(externalDb, { id: 'r-null', patientId: 'hl7-111', authoredAt: null, panel: 'CD4' });
    await seedRequest(externalDb, { id: 'r-old', patientId: 'hl7-111', authoredAt: '2026-01-02', panel: 'VL', requester: 'Chilenje', status: 'completed' });
    await seedRequest(externalDb, { id: 'r-new', patientId: 'hl7-111', authoredAt: '2026-03-04', panel: 'EID' });
    await seedResult(externalDb, 'o1', 'r-old');
    await seedResult(externalDb, 'o2', 'r-old');
    await seedResult(externalDb, 'o3', 'r-old', 'cancelled');
    const ref = (await index.list({ ...Q, q: 'MPI-0001' }, { unmask: true })).rows[0].ref;

    const out = await index.requests(ref, { limit: 25, offset: 0 });

    expect(out.total).toBe(3);
    expect(out.rows).toEqual([
      { authoredAt: '2026-03-04', panel: 'EID', requester: null, status: null, resultCount: 0 },
      { authoredAt: '2026-01-02', panel: 'VL', requester: 'Chilenje', status: 'completed', resultCount: 2 },
      { authoredAt: null, panel: 'CD4', requester: null, status: null, resultCount: 0 },
    ]);
  });
});

describe('patient index parsers', () => {
  it('parses the list query', () => {
    expect(parsePatientListQuery({})).toEqual({ ok: true, query: { q: '', status: 'active', limit: 25, offset: 0 } });
    expect(parsePatientListQuery({ search: ' x ', status: 'merged', limit: '10', offset: '20' }))
      .toEqual({ ok: true, query: { q: 'x', status: 'merged', limit: 10, offset: 20 } });
    expect(parsePatientListQuery({ status: 'gone' })).toEqual({ ok: false, error: 'status must be active, merged or all' });
    expect(parsePageQuery({ limit: '500' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
  });
});
```

- [ ] **Step 6: Run and see it fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-index.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 7: Write the index module**

`packages/bootstrap/src/patient-index.ts`:

```ts
import { sql, type Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { ageInYears, birthYear, createRefCodec, maskName, maskValue } from './patient-mask';
import { PatientIndexError, type PatientIdentifierSystems, type SystemSettings } from './patient-identifier-systems';

// The patient index reads (docs/superpowers/specs/2026-10-12-patient-index-design.md, sections 2-4).
// Read-only: the HIMS owns the records. Every response is built here, masked unless the caller holds
// patients.view_identifiers, and carries an opaque ref instead of the resource id.
//
// pg-mem has no correlated subqueries (AGENTS.md section 7), so per-row facts (identifiers, request
// stats, facility names) are separate queries over the page's ids, joined in code.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const STATUSES = ['active', 'merged', 'all'] as const;

export type PatientStatus = typeof STATUSES[number];
export interface PatientListQuery { q: string; status: PatientStatus; limit: number; offset: number }
export interface PatientIdentifierView { system: string | null; label: string | null; value: string }
export interface PatientRow {
  ref: string; id: string | null; name: string | null; sex: string | null; birthDate: string | null;
  ageYears: number | null; identifiers: PatientIdentifierView[];
  managingFacility: { reference: string; name: string | null } | null;
  active: boolean; replacedByRef: string | null; lastRequestAt: string | null; requestCount: number;
}
export interface PatientList { rows: PatientRow[]; total: number; masked: boolean }
export interface PatientDetail extends PatientRow { patientGuid: string | null; phone: string | null; email: string | null; masked: boolean }
export interface PatientRequestRow { authoredAt: string | null; panel: string | null; requester: string | null; status: string | null; resultCount: number }
export interface PatientRequestList { rows: PatientRequestRow[]; total: number }

export interface PatientIndex {
  list(q: PatientListQuery, opts: { unmask: boolean }): Promise<PatientList>;
  get(ref: string, opts: { unmask: boolean }): Promise<PatientDetail>;
  getById(id: string, opts: { unmask: boolean }): Promise<PatientDetail>;
  idForRef(ref: string): string | null;
  requests(ref: string, q: { limit: number; offset: number }): Promise<PatientRequestList>;
  requestsById(id: string, q: { limit: number; offset: number }): Promise<PatientRequestList>;
}

export function parsePageQuery(raw: Record<string, unknown>): { ok: true; query: { limit: number; offset: number } } | { ok: false; error: string } {
  const limitRaw = raw.limit === undefined || raw.limit === '' ? String(DEFAULT_LIMIT) : String(raw.limit);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > MAX_LIMIT) return { ok: false, error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offsetRaw = raw.offset === undefined || raw.offset === '' ? '0' : String(raw.offset);
  if (!/^\d+$/.test(offsetRaw)) return { ok: false, error: 'offset must be a whole number from 0' };
  return { ok: true, query: { limit, offset: Number(offsetRaw) } };
}

export function parsePatientListQuery(raw: Record<string, unknown>): { ok: true; query: PatientListQuery } | { ok: false; error: string } {
  const status = raw.status === undefined || raw.status === '' ? 'active' : String(raw.status);
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status must be active, merged or all' };
  const page = parsePageQuery(raw);
  if (!page.ok) return page;
  const q = typeof raw.search === 'string' ? raw.search.trim() : '';
  return { ok: true, query: { q, status: status as PatientStatus, ...page.query } };
}

type PatientRecord = {
  id: string; patient_guid: string | null; surname: string | null; firstname: string | null;
  date_of_birth: string | null; sex: string | null; phone: string | null; email: string | null;
  managing_organization: string | null; active: boolean; replaced_by_id: string | null;
};

const PATIENT_COLUMNS = ['id', 'patient_guid', 'surname', 'firstname', 'date_of_birth', 'sex', 'phone', 'email',
  'managing_organization', 'active', 'replaced_by_id'] as const;

const fullName = (r: { firstname: string | null; surname: string | null }) =>
  [r.firstname, r.surname].filter((s) => s && s.trim()).join(' ') || null;
const maskedName = (r: { firstname: string | null; surname: string | null }) =>
  [maskName(r.firstname), maskName(r.surname)].filter(Boolean).join(' ') || null;

export function createPatientIndex(deps: {
  externalDb: Kysely<ExternalSchema>; systems: PatientIdentifierSystems; now?: () => Date; refKey?: Buffer;
}): PatientIndex {
  const { externalDb: db, systems } = deps;
  const now = deps.now ?? (() => new Date());
  const refs = createRefCodec(deps.refKey);

  /** Patient ids whose searchable identifier, or patient_guid, equals q exactly. */
  async function exactMatches(q: string, settings: Map<string, SystemSettings>): Promise<string[]> {
    const unsearchable = [...settings].filter(([, s]) => !s.searchable).map(([system]) => system);
    let byIdentifier = db.selectFrom('patient_identifiers').select('patient_id').where('value', '=', q);
    if (unsearchable.length) {
      byIdentifier = byIdentifier.where((eb) => eb.or([eb('system', 'is', null), eb('system', 'not in', unsearchable)]));
    }
    const [a, b] = await Promise.all([
      byIdentifier.execute(),
      db.selectFrom('patients').select('id').where('patient_guid', '=', q).execute(),
    ]);
    return [...new Set([...a.map((r) => r.patient_id), ...b.map((r) => r.id)])];
  }

  async function identifiersFor(ids: string[]) {
    if (!ids.length) return new Map<string, { system: string | null; value: string }[]>();
    const rows = await db.selectFrom('patient_identifiers').select(['patient_id', 'system', 'value'])
      .where('patient_id', 'in', ids).orderBy('system').orderBy('value').execute();
    const out = new Map<string, { system: string | null; value: string }[]>();
    for (const r of rows) out.set(r.patient_id, [...(out.get(r.patient_id) ?? []), { system: r.system, value: r.value }]);
    return out;
  }

  async function requestStatsFor(ids: string[]) {
    if (!ids.length) return new Map<string, { n: number; last: string | null }>();
    const rows = await db.selectFrom('lab_requests')
      .select(['patient_id', (eb) => eb.fn.countAll<string | number>().as('n'), (eb) => eb.fn.max('authored_at').as('last')])
      .where('patient_id', 'in', ids).groupBy('patient_id').execute();
    return new Map(rows.map((r) => [String(r.patient_id), { n: Number(r.n), last: (r.last as string | null) ?? null }]));
  }

  async function facilityNamesFor(refsIn: (string | null)[]) {
    const ids = [...new Set(refsIn.filter((r): r is string => !!r).map((r) => r.replace(/^Organization\//, '')))];
    if (!ids.length) return new Map<string, string | null>();
    const rows = await db.selectFrom('facilities').select(['id', 'facility_name']).where('id', 'in', ids).execute();
    return new Map(rows.map((r) => [r.id, r.facility_name]));
  }

  async function build(records: PatientRecord[], unmask: boolean, allIdentifiers: boolean): Promise<Array<PatientRow & { record: PatientRecord }>> {
    const ids = records.map((r) => r.id);
    const [settings, idents, stats, facilities] = await Promise.all([
      systems.settings(), identifiersFor(ids), requestStatsFor(ids), facilityNamesFor(records.map((r) => r.managing_organization)),
    ]);
    const today = now();
    return records.map((r) => {
      const identifiers = (idents.get(r.id) ?? [])
        .filter((i) => allIdentifiers || (i.system !== null && settings.get(i.system)?.listColumn === true))
        .map((i) => ({
          system: i.system,
          label: i.system === null ? null : settings.get(i.system)?.label ?? null,
          value: unmask ? i.value : (maskValue(i.value) as string),
        }));
      const org = r.managing_organization;
      const s = stats.get(r.id);
      return {
        record: r,
        ref: refs.encode(r.id),
        id: unmask ? r.id : null,
        name: unmask ? fullName(r) : maskedName(r),
        sex: r.sex,
        birthDate: unmask ? r.date_of_birth : birthYear(r.date_of_birth),
        ageYears: ageInYears(r.date_of_birth, today),
        identifiers,
        managingFacility: org ? { reference: org, name: facilities.get(org.replace(/^Organization\//, '')) ?? null } : null,
        active: Boolean(r.active),
        replacedByRef: r.replaced_by_id ? refs.encode(r.replaced_by_id) : null,
        lastRequestAt: s?.last ?? null,
        requestCount: s?.n ?? 0,
      };
    });
  }

  async function list(q: PatientListQuery, opts: { unmask: boolean }): Promise<PatientList> {
    let base = db.selectFrom('patients');
    if (q.status === 'active') base = base.where('active', '=', true).where('replaced_by_id', 'is', null);
    if (q.status === 'merged') base = base.where((eb) => eb.or([eb('active', '=', false), eb('replaced_by_id', 'is not', null)]));
    if (q.q) {
      const exact = await exactMatches(q.q, await systems.settings());
      if (opts.unmask) {
        // lower(col) LIKE lower(?) holds on Postgres, MySQL and MSSQL, as reference-search.ts notes.
        const needle = `%${q.q.toLowerCase()}%`;
        base = base.where((eb) => eb.or([
          ...(['surname', 'firstname', 'patient_guid'] as const).map((c) => sql<boolean>`lower(${sql.ref(c)}) like ${needle}`),
          ...(exact.length ? [eb('id', 'in', exact)] : []),
        ]));
      } else {
        if (!exact.length) return { rows: [], total: 0, masked: true };
        base = base.where('id', 'in', exact);
      }
    }
    // A masked list sorts by id, so the order does not hint at names. The unique id ends both orders.
    let ordered = base.select([...PATIENT_COLUMNS]);
    ordered = opts.unmask ? ordered.orderBy('surname').orderBy('firstname').orderBy('id') : ordered.orderBy('id');
    const [records, counted] = await Promise.all([
      ordered.limit(q.limit).offset(q.offset).execute(),
      base.select((eb) => eb.fn.countAll<string | number>().as('n')).executeTakeFirst(),
    ]);
    const rows = (await build(records as PatientRecord[], opts.unmask, false)).map(({ record: _r, ...row }) => row);
    return { rows, total: Number(counted?.n ?? 0), masked: !opts.unmask };
  }

  async function getById(id: string, opts: { unmask: boolean }): Promise<PatientDetail> {
    const record = await db.selectFrom('patients').select([...PATIENT_COLUMNS]).where('id', '=', id).executeTakeFirst();
    if (!record) throw new PatientIndexError('patient not found', 'not-found');
    const [{ record: r, ...row }] = await build([record as PatientRecord], opts.unmask, true);
    return {
      ...row,
      patientGuid: opts.unmask ? r.patient_guid : maskValue(r.patient_guid),
      phone: opts.unmask ? r.phone : null,
      email: opts.unmask ? r.email : null,
      masked: !opts.unmask,
    };
  }

  function idForRef(ref: string): string | null {
    return refs.decode(ref);
  }

  function requireId(ref: string): string {
    const id = refs.decode(ref);
    if (!id) throw new PatientIndexError('patient not found', 'not-found');
    return id;
  }

  async function requestsById(id: string, q: { limit: number; offset: number }): Promise<PatientRequestList> {
    const base = db.selectFrom('lab_requests').where('patient_id', '=', id);
    // Nulls last on every dialect: Postgres sorts nulls first in a descending order. id breaks ties.
    const [rows, counted] = await Promise.all([
      base.select(['id', 'authored_at', 'panel_code', 'panel_desc', 'requester_display', 'requester_code', 'status'])
        .orderBy(sql`case when authored_at is null then 1 else 0 end`).orderBy('authored_at', 'desc').orderBy('id')
        .limit(q.limit).offset(q.offset).execute(),
      base.select((eb) => eb.fn.countAll<string | number>().as('n')).executeTakeFirst(),
    ]);
    const ids = rows.map((r) => r.id);
    // A cancelled result is a rejected test with no value (024_lab_result_status), so it is not counted.
    const results = ids.length
      ? await db.selectFrom('lab_results').select(['request_id', (eb) => eb.fn.countAll<string | number>().as('n')])
        .where('request_id', 'in', ids)
        .where((eb) => eb.or([eb('status', 'is', null), eb('status', '!=', 'cancelled')]))
        .groupBy('request_id').execute()
      : [];
    const counts = new Map(results.map((r) => [String(r.request_id), Number(r.n)]));
    return {
      rows: rows.map((r) => ({
        authoredAt: r.authored_at,
        panel: r.panel_desc ?? r.panel_code,
        requester: r.requester_display ?? r.requester_code,
        status: r.status,
        resultCount: counts.get(r.id) ?? 0,
      })),
      total: Number(counted?.n ?? 0),
    };
  }

  return {
    list,
    get: (ref, opts) => getById(requireId(ref), opts),
    getById,
    idForRef,
    requests: (ref, q) => requestsById(requireId(ref), q),
    requestsById,
  };
}
```

- [ ] **Step 8: Run the index tests**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/patient-index.test.ts src/patient-mask.test.ts src/patient-identifier-systems.test.ts`
Expected: PASS. If pg-mem rejects the `case when` in `order by`, keep the SQL and assert the three rows' set and the first two rows' order in the test instead. Write "HONEST NON-PROOF: nulls-last order unproven on pg-mem, check live" in the commit body.

- [ ] **Step 9: Wire both into AppContext**

In `packages/bootstrap/src/index.ts`:

After the `resultFields` field in `AppContext` (near line 553):

```ts
  /** Labels and flags for patient identifier systems (patient index spec, section 1). */
  patientIdentifierSystems: PatientIdentifierSystems;
  /** The read-only patient index and its masking (patient index spec, section 2). */
  patientIndex: PatientIndex;
```

With the imports near line 79:

```ts
import { createPatientIdentifierSystems, type PatientIdentifierSystems } from './patient-identifier-systems';
import { createPatientIndex, type PatientIndex } from './patient-index';
```

After the `resultFields` construction (near line 1001):

```ts
  const patientIdentifierSystems = createPatientIdentifierSystems({ internalDb: termDb, externalDb, admin: termAdmin });
  const patientIndex = createPatientIndex({ externalDb, systems: patientIdentifierSystems });
```

In the returned context object, after `resultFields,` add `patientIdentifierSystems,` and `patientIndex,`. Near the barrel line `export * from './result-fields';` add:

```ts
export * from './patient-identifier-systems';
export * from './patient-index';
export * from './patient-mask';
```

- [ ] **Step 10: Typecheck bootstrap**

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit > "$TMP/tc-bootstrap.txt" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Read the file if not.

- [ ] **Step 11: Commit**

```bash
git add packages/bootstrap/src/patient-mask.ts packages/bootstrap/src/patient-mask.test.ts packages/bootstrap/src/patient-index.ts packages/bootstrap/src/patient-index.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): patient index reads with server-side masking"
```

---

### Task 6: Server routes

**Files:**
- Create: `apps/server/src/patient-routes.ts`
- Create: `apps/server/src/patient-routes.test.ts`
- Modify: `apps/server/src/app.ts:18,157`

**Interfaces:**
- Consumes: `ctx.patientIndex`, `ctx.patientIdentifierSystems`, parsers and `PatientIndexError` from `@openldr/bootstrap`.
- Produces: the five routes in spec section 4, with `:ref` paths. Audit actions `patients.list`, `patients.view`, `patients.identifier_system.update`.

- [ ] **Step 1: Write the failing route tests**

`apps/server/src/patient-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { PatientIndexError, type AppContext } from '@openldr/bootstrap';
import { registerPatientRoutes } from './patient-routes';
import './auth-plugin';

type Impl = (...args: any[]) => Promise<unknown> | unknown;
const LIST = { rows: [{ ref: 'r1' }], total: 1, masked: false };
const DETAIL = { ref: 'r1', id: 'hl7-1', masked: false };
const SYSTEM = { system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 1, listColumn: true, searchable: true };

function fakeCtx(over: Record<string, Impl> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const spy = (method: string, impl: Impl): Impl => (...args) => { calls.push({ method, args }); return impl(...args); };
  const ctx = {
    patientIndex: {
      list: spy('list', over.list ?? (async () => LIST)),
      get: spy('get', over.get ?? (async () => DETAIL)),
      requests: spy('requests', over.requests ?? (async () => ({ rows: [], total: 0 }))),
      idForRef: spy('idForRef', over.idForRef ?? (() => 'hl7-1')),
    },
    patientIdentifierSystems: {
      list: spy('systems.list', over['systems.list'] ?? (async () => ({ rows: [SYSTEM], total: 1, ownedHere: true }))),
      get: spy('systems.get', over['systems.get'] ?? (async () => null)),
      set: spy('systems.set', over['systems.set'] ?? (async () => SYSTEM)),
    },
    audit: { record: async (e: Record<string, unknown>) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, calls, audit };
}

function appWith(ctx: AppContext, capabilities: string[]) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'u1', username: 'user', displayName: null, roles: [], capabilities };
  });
  registerPatientRoutes(app, ctx);
  return app;
}

const ALL = ['patients.view', 'patients.view_identifiers', 'patients.manage'];

describe('patient routes', () => {
  it('lists unmasked for view_identifiers and audits the count, never the search text', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const res = await appWith(ctx, ALL).inject({ method: 'GET', url: '/api/patients?search=123456%2F10%2F1&status=all&limit=10' });
    expect([res.statusCode, res.json()]).toEqual([200, LIST]);
    expect(calls[0]).toEqual({ method: 'list', args: [{ q: '123456/10/1', status: 'all', limit: 10, offset: 0 }, { unmask: true }] });
    expect(audit.map((a) => [a.action, a.entityType, a.entityId, a.metadata])).toEqual([['patients.list', 'patient', 'list', { count: 1 }]]);
    expect(JSON.stringify(audit)).not.toContain('123456');
  });

  it('lists masked for view only and writes no audit', async () => {
    const { ctx, calls, audit } = fakeCtx({ list: async () => ({ rows: [], total: 0, masked: true }) });
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients?search=Mwan' });
    expect(res.statusCode).toBe(200);
    expect(calls[0].args[1]).toEqual({ unmask: false });
    expect(audit).toEqual([]);
  });

  it('refuses a bad list query with 400 before the service', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ALL).inject({ method: 'GET', url: '/api/patients?status=gone' });
    expect([res.statusCode, res.json()]).toEqual([400, { error: 'status must be active, merged or all' }]);
    expect(calls).toEqual([]);
  });

  it('refuses every route without patients.view', async () => {
    const { ctx } = fakeCtx();
    const app = appWith(ctx, []);
    for (const url of ['/api/patients', '/api/patients/r1', '/api/patients/r1/requests', '/api/patients/identifier-systems']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
    }
  });

  it('shows a detail unmasked and audits the patient id; masked writes no audit', async () => {
    const a = fakeCtx();
    const res = await appWith(a.ctx, ALL).inject({ method: 'GET', url: '/api/patients/r1' });
    expect([res.statusCode, res.json()]).toEqual([200, DETAIL]);
    expect(a.calls[0]).toEqual({ method: 'get', args: ['r1', { unmask: true }] });
    expect(a.audit.map((e) => [e.action, e.entityId])).toEqual([['patients.view', 'hl7-1']]);
    const b = fakeCtx();
    await appWith(b.ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/r1' });
    expect(b.calls[0].args[1]).toEqual({ unmask: false });
    expect(b.audit).toEqual([]);
  });

  it('answers a bad ref with 404, on the detail and on requests', async () => {
    const notFound = async () => { throw new PatientIndexError('patient not found', 'not-found'); };
    const { ctx } = fakeCtx({ get: notFound, requests: notFound });
    const app = appWith(ctx, ALL);
    for (const url of ['/api/patients/zzz', '/api/patients/zzz/requests']) {
      const res = await app.inject({ method: 'GET', url });
      expect([res.statusCode, res.json()]).toEqual([404, { error: 'patient not found', kind: 'not-found' }]);
    }
  });

  it('pages requests', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/r1/requests?limit=5&offset=10' });
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toEqual({ method: 'requests', args: ['r1', { limit: 5, offset: 10 }] });
  });

  it('routes /identifier-systems to the systems list, not to a patient ref', async () => {
    const { ctx, calls } = fakeCtx();
    const res = await appWith(ctx, ['patients.view']).inject({ method: 'GET', url: '/api/patients/identifier-systems' });
    expect(res.statusCode).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(['systems.list']);
  });

  it('saves a system label with patients.manage and audits before and after', async () => {
    const { ctx, calls, audit } = fakeCtx();
    const body = { system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: true };
    const res = await appWith(ctx, ALL).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: body });
    expect([res.statusCode, res.json()]).toEqual([200, SYSTEM]);
    expect(calls.map((c) => c.method)).toEqual(['systems.get', 'systems.set']);
    expect(audit.map((a) => [a.action, a.entityId, a.before, a.after])).toEqual([['patients.identifier_system.update', 'urn:zm:mpi', null, SYSTEM]]);
  });

  it('refuses the label edit without patients.manage, on bad input, and when central owns it', async () => {
    const body = { system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: true };
    expect((await appWith(fakeCtx().ctx, ['patients.view']).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: body })).statusCode).toBe(403);
    const bad = await appWith(fakeCtx().ctx, ALL).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: { ...body, system: '' } });
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'system is required' }]);
    const central = fakeCtx({ 'systems.set': async () => { throw new PatientIndexError('central owns it', 'central-managed'); } });
    const res = await appWith(central.ctx, ALL).inject({ method: 'PUT', url: '/api/patients/identifier-systems', payload: body });
    expect([res.statusCode, res.json().kind]).toEqual([409, 'central-managed']);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/server exec vitest run src/patient-routes.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Write the routes**

`apps/server/src/patient-routes.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parsePageQuery, parsePatientListQuery, parseSystemInput, parseSystemListQuery, PatientIndexError, type AppContext,
} from '@openldr/bootstrap';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Patient index (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 4). patients.view
// reads; patients.view_identifiers unmasks; patients.manage edits identifier system labels. Masking
// happens in bootstrap's patient-index.ts, so these routes only pass the caller's right along.
const VIEW = { preHandler: requireCapability('patients.view') };
const MANAGE = { preHandler: requireCapability('patients.manage') };

function canUnmask(req: FastifyRequest): boolean {
  return (req.user?.capabilities ?? []).includes('patients.view_identifiers');
}

function replyPatientError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof PatientIndexError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

export function registerPatientRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/patients', VIEW, async (req, reply) => {
    const parsed = parsePatientListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const unmask = canUnmask(req);
    const out = await ctx.patientIndex.list(parsed.query, { unmask });
    // The search text is often an identifier, so only the count is recorded.
    if (unmask) await recordAudit(ctx, req, { action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { count: out.total } });
    return reply.send(out);
  });

  // Registered before /:ref so this literal path is never read as a patient ref.
  app.get('/api/patients/identifier-systems', VIEW, async (req, reply) => {
    const parsed = parseSystemListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.patientIdentifierSystems.list(parsed.query));
  });

  // The system URI goes in the body: URIs carry slashes and colons.
  app.put('/api/patients/identifier-systems', MANAGE, async (req, reply) => {
    const parsed = parseSystemInput(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    try {
      const before = await ctx.patientIdentifierSystems.get(parsed.input.system);
      const after = await ctx.patientIdentifierSystems.set(parsed.input);
      await recordAudit(ctx, req, { action: 'patients.identifier_system.update', entityType: 'patient_identifier_system', entityId: parsed.input.system, before, after });
      return reply.send(after);
    } catch (err) {
      return replyPatientError(err, reply);
    }
  });

  app.get('/api/patients/:ref', VIEW, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    const unmask = canUnmask(req);
    try {
      const detail = await ctx.patientIndex.get(ref, { unmask });
      if (unmask) await recordAudit(ctx, req, { action: 'patients.view', entityType: 'patient', entityId: ctx.patientIndex.idForRef(ref) ?? 'unknown' });
      return reply.send(detail);
    } catch (err) {
      return replyPatientError(err, reply);
    }
  });

  app.get('/api/patients/:ref/requests', VIEW, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    const parsed = parsePageQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    try {
      return reply.send(await ctx.patientIndex.requests(ref, parsed.query));
    } catch (err) {
      return replyPatientError(err, reply);
    }
  });
}
```

- [ ] **Step 4: Register in app.ts**

In `apps/server/src/app.ts` add near line 18 `import { registerPatientRoutes } from './patient-routes';` and after `registerResultFieldsRoutes(app, ctx);` (line 157) add `registerPatientRoutes(app, ctx);`.

- [ ] **Step 5: Run the route tests and server lint**

Run: `pnpm --filter @openldr/server exec vitest run src/patient-routes.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/server run lint`
Expected: no errors. The reply.send rule needs every `reply.send` returned, as above.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/patient-routes.ts apps/server/src/patient-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): patient index routes with masking and audit"
```

---

### Task 7: CLI

**Files:**
- Create: `packages/cli/src/patients.ts`
- Create: `packages/cli/src/patients.test.ts`
- Modify: `packages/cli/src/program.ts` (import near `:46`, commands after the `test-catalog` block ending near `:487`)

**Interfaces:**
- Consumes: `ctx.patientIndex.list/getById/requestsById`, `ctx.patientIdentifierSystems.list/get/set`, parsers, `recordAuditEvent`, `cliActor`.
- Produces: `runPatientsList`, `runPatientsShow`, `runIdentifierSystemsList`, `runIdentifierSystemsSet`.

- [ ] **Step 1: Write the failing CLI tests**

`packages/cli/src/patients.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const patientIndex = { list: vi.fn(), getById: vi.fn(), requestsById: vi.fn() };
const patientIdentifierSystems = { list: vi.fn(), get: vi.fn(), set: vi.fn() };
const audit: Array<Record<string, unknown>> = [];
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));
vi.mock('@openldr/bootstrap', async (orig) => {
  const actual = await orig<typeof import('@openldr/bootstrap')>();
  return {
    ...actual,
    createAppContext: async () => ({ patientIndex, patientIdentifierSystems, close: async () => {} }),
    recordAuditEvent: async (_ctx: unknown, _actor: unknown, e: Record<string, unknown>) => { audit.push(e); },
  };
});

import { runIdentifierSystemsList, runIdentifierSystemsSet, runPatientsList, runPatientsShow } from './patients';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  return { out: () => out.join(''), err: () => err.join('') };
}

const ROW = { ref: 'r', id: null, name: 'J*** M***', sex: 'M', birthDate: '1990', ageYears: 36, identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: '•••0001' }], managingFacility: null, active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2 };

beforeEach(() => {
  vi.restoreAllMocks();
  audit.length = 0;
  for (const f of [...Object.values(patientIndex), ...Object.values(patientIdentifierSystems)]) f.mockReset();
});

describe('openldr patients', () => {
  it('list is masked by default and writes no audit', async () => {
    patientIndex.list.mockResolvedValue({ rows: [ROW], total: 1, masked: true });
    const io = capture();
    expect(await runPatientsList({ json: false, identifiers: false })).toBe(0);
    expect(patientIndex.list).toHaveBeenCalledWith({ q: '', status: 'active', limit: 25, offset: 0 }, { unmask: false });
    expect(io.out()).toContain('J*** M***');
    expect(io.out()).toContain('MPI •••0001');
    expect(audit).toEqual([]);
  });

  it('list --identifiers unmasks and audits the count, not the search', async () => {
    patientIndex.list.mockResolvedValue({ rows: [{ ...ROW, id: 'hl7-1', name: 'John Mwanza' }], total: 1, masked: false });
    capture();
    expect(await runPatientsList({ search: 'MPI-0001', json: false, identifiers: true })).toBe(0);
    expect(patientIndex.list.mock.calls[0][1]).toEqual({ unmask: true });
    expect(audit).toEqual([{ action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { count: 1 } }]);
  });

  it('list refuses a bad status in the route parser\'s words', async () => {
    const io = capture();
    expect(await runPatientsList({ status: 'gone', json: false, identifiers: false })).toBe(1);
    expect(io.err()).toContain('status must be active, merged or all');
  });

  it('show prints the patient and its requests; --identifiers audits the id', async () => {
    patientIndex.getById.mockResolvedValue({ ...ROW, id: 'hl7-1', name: 'John Mwanza', patientGuid: 'G-1', phone: null, email: null, masked: false });
    patientIndex.requestsById.mockResolvedValue({ rows: [{ authoredAt: '2026-03-04', panel: 'VL', requester: 'Chilenje', status: 'completed', resultCount: 2 }], total: 1 });
    const io = capture();
    expect(await runPatientsShow('hl7-1', { json: false, identifiers: true })).toBe(0);
    expect(io.out()).toContain('John Mwanza');
    expect(io.out()).toContain('2026-03-04  VL  Chilenje  completed  2 result(s)');
    expect(audit).toEqual([{ action: 'patients.view', entityType: 'patient', entityId: 'hl7-1' }]);
  });

  it('show reports a missing patient and exits 1', async () => {
    const { PatientIndexError } = await import('@openldr/bootstrap');
    patientIndex.getById.mockRejectedValue(new PatientIndexError('patient not found', 'not-found'));
    const io = capture();
    expect(await runPatientsShow('nope', { json: false, identifiers: false })).toBe(1);
    expect(io.err()).toContain('patients show failed: patient not found');
  });

  it('identifier-systems list prints label, count and flags', async () => {
    patientIdentifierSystems.list.mockResolvedValue({ rows: [{ system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: false }], total: 1, ownedHere: true });
    const io = capture();
    expect(await runIdentifierSystemsList({ json: false })).toBe(0);
    expect(io.out()).toContain('urn:zm:mpi  MPI  3 patient(s)  listed  not searched');
  });

  it('identifier-systems set keeps unspecified flags and audits', async () => {
    patientIdentifierSystems.get.mockResolvedValue({ system: 'urn:zm:mpi', label: 'Old', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: true });
    patientIdentifierSystems.set.mockResolvedValue({ system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: false });
    capture();
    expect(await runIdentifierSystemsSet('urn:zm:mpi', { label: 'MPI', searchable: 'off', json: false })).toBe(0);
    expect(patientIdentifierSystems.set).toHaveBeenCalledWith({ system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: false });
    expect(audit[0]).toMatchObject({ action: 'patients.identifier_system.update', entityId: 'urn:zm:mpi' });
  });

  it('identifier-systems set refuses a flag that is not on or off', async () => {
    const io = capture();
    expect(await runIdentifierSystemsSet('urn:zm:mpi', { listColumn: 'yes', json: false })).toBe(1);
    expect(io.err()).toContain('--list-column must be on or off');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/cli exec vitest run src/patients.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Write the commands**

`packages/cli/src/patients.ts`:

```ts
import { loadConfig } from '@openldr/config';
import {
  createAppContext, parsePatientListQuery, parseSystemInput, recordAuditEvent,
  type PatientIdentifierView, type PatientRow,
} from '@openldr/bootstrap';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

// `openldr patients ...`: the CLI doors to the patient index routes (patient index spec, section 5).
// Masked by default. --identifiers unmasks and writes the same audit entries the routes write. The
// CLI takes a raw patient id, because the server's refs are sealed under a key only it holds.

function fail(command: string, err: unknown, json: boolean): number {
  const msg = redactError(err);
  if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
  else process.stderr.write(`patients ${command} failed: ${msg}\n`);
  return 1;
}

const idents = (list: PatientIdentifierView[]) => list.map((i) => `${i.label ?? i.system ?? 'No system'} ${i.value}`).join(', ');
const line = (r: PatientRow) => [
  r.id ?? '', r.name ?? '', r.sex ?? '', r.ageYears === null ? '' : `${r.ageYears}y`, idents(r.identifiers),
  r.managingFacility?.name ?? r.managingFacility?.reference ?? '', r.lastRequestAt ?? '', `${r.requestCount} request(s)`,
].filter((s) => s !== '').join('  ');

export interface PatientsListOpts { search?: string; status?: string; limit?: string; offset?: string; identifiers: boolean; json: boolean }

export async function runPatientsList(opts: PatientsListOpts): Promise<number> {
  const parsed = parsePatientListQuery({ search: opts.search, status: opts.status, limit: opts.limit, offset: opts.offset });
  if (!parsed.ok) { process.stderr.write(`patients list failed: ${parsed.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientIndex.list(parsed.query, { unmask: opts.identifiers });
    if (opts.identifiers) {
      await recordAuditEvent(ctx, cliActor(), { action: 'patients.list', entityType: 'patient', entityId: 'list', metadata: { count: out.total } });
    }
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const footer = `${out.rows.length} of ${out.total} patient(s)${out.masked ? ' (masked; --identifiers shows names and ids)' : ''}`;
    process.stdout.write([...out.rows.map(line), footer].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('list', err, opts.json); } finally { await ctx.close(); }
}

export async function runPatientsShow(id: string, opts: { identifiers: boolean; json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const detail = await ctx.patientIndex.getById(id, { unmask: opts.identifiers });
    if (opts.identifiers) await recordAuditEvent(ctx, cliActor(), { action: 'patients.view', entityType: 'patient', entityId: id });
    const requests = await ctx.patientIndex.requestsById(id, { limit: 200, offset: 0 });
    if (opts.json) { process.stdout.write(JSON.stringify({ ...detail, requests }, null, 2) + '\n'); return 0; }
    const lines = [
      `${detail.name ?? '(no name)'}  ${detail.sex ?? ''}  ${detail.birthDate ?? ''}${detail.ageYears === null ? '' : `  ${detail.ageYears}y`}`,
      `Status: ${detail.active && !detail.replacedByRef ? 'active' : 'merged'}`,
      ...detail.identifiers.map((i) => `${i.label ?? i.system ?? 'No system'}: ${i.value}`),
      ...(detail.phone ? [`Phone: ${detail.phone}`] : []),
      ...(detail.email ? [`Email: ${detail.email}`] : []),
      `Requests (${requests.total}):`,
      ...requests.rows.map((r) => [r.authoredAt ?? 'no date', r.panel ?? '', r.requester ?? '', r.status ?? '', `${r.resultCount} result(s)`].join('  ')),
    ];
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (err) { return fail('show', err, opts.json); } finally { await ctx.close(); }
}

export async function runIdentifierSystemsList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const out = await ctx.patientIdentifierSystems.list({ limit: 200, offset: 0 });
    if (opts.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }
    const lines = out.rows.map((r) => [
      r.system ?? '(no system)', r.label ?? '', `${r.patientCount} patient(s)`,
      r.listColumn ? 'listed' : 'not listed', r.searchable ? 'searched' : 'not searched',
    ].filter((s) => s !== '').join('  '));
    process.stdout.write([...lines, `${out.total} system(s)${out.ownedHere ? '' : ' (labels from central, read-only here)'}`].join('\n') + '\n');
    return 0;
  } catch (err) { return fail('identifier-systems list', err, opts.json); } finally { await ctx.close(); }
}

export interface IdentifierSystemsSetOpts { label?: string; listColumn?: string; searchable?: string; json: boolean }

function onOff(v: string | undefined, flag: string): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === 'on') return { ok: true, value: true };
  if (v === 'off') return { ok: true, value: false };
  return { ok: false, error: `${flag} must be on or off` };
}

export async function runIdentifierSystemsSet(system: string, opts: IdentifierSystemsSetOpts): Promise<number> {
  const list = onOff(opts.listColumn, '--list-column');
  const search = onOff(opts.searchable, '--searchable');
  for (const r of [list, search]) if (!r.ok) { process.stderr.write(`patients identifier-systems set failed: ${r.error}\n`); return 1; }
  const ctx = await createAppContext(loadConfig());
  try {
    const before = await ctx.patientIdentifierSystems.get(system.trim());
    const parsed = parseSystemInput({
      system,
      label: opts.label !== undefined ? opts.label : before?.labelSource === 'operator' ? before.label : null,
      listColumn: (list.ok && list.value !== undefined) ? list.value : before?.listColumn ?? false,
      searchable: (search.ok && search.value !== undefined) ? search.value : before?.searchable ?? true,
    });
    if (!parsed.ok) { process.stderr.write(`patients identifier-systems set failed: ${parsed.error}\n`); return 1; }
    const after = await ctx.patientIdentifierSystems.set(parsed.input);
    await recordAuditEvent(ctx, cliActor(), { action: 'patients.identifier_system.update', entityType: 'patient_identifier_system', entityId: parsed.input.system, before, after });
    process.stdout.write(opts.json ? JSON.stringify(after, null, 2) + '\n' : `${after.system} saved as ${after.label ?? '(no label)'}.\n`);
    return 0;
  } catch (err) { return fail('identifier-systems set', err, opts.json); } finally { await ctx.close(); }
}
```

- [ ] **Step 4: Register in program.ts**

Add the import near the other `./result-fields` import:

```ts
import {
  runIdentifierSystemsList, runIdentifierSystemsSet, runPatientsList, runPatientsShow,
  type IdentifierSystemsSetOpts, type PatientsListOpts,
} from './patients';
```

After the `test-catalog` command block, before `facilities`:

```ts
  // Patient index spec, section 5. Masked unless --identifiers, which is audited.
  const patients = program.command('patients').description('The patient index (read-only; the source system owns patients)');
  patients.command('list')
    .description('List patients; masked unless --identifiers')
    .option('--search <text>', 'masked: exact identifier; with --identifiers: also part of a name')
    .option('--status <active|merged|all>', 'which patients (default: active)')
    .option('--limit <n>', 'rows per page, 1 to 200 (default: 25)')
    .option('--offset <n>', 'rows to skip (default: 0)')
    .option('--identifiers', 'show names and identifiers in full (audited)', false)
    .option('--json', 'emit JSON', false)
    .action(async (opts: PatientsListOpts) => { process.exitCode = await runPatientsList(opts); });
  patients.command('show <id>')
    .description('Show one patient by id, with its requests')
    .option('--identifiers', 'show names and identifiers in full (audited)', false)
    .option('--json', 'emit JSON', false)
    .action(async (id: string, opts: { identifiers: boolean; json: boolean }) => { process.exitCode = await runPatientsShow(id, opts); });
  const idSystems = patients.command('identifier-systems').description('Labels for patient identifier systems');
  idSystems.command('list')
    .description('List identifier systems with label, patient count and flags')
    .option('--json', 'emit JSON', false)
    .action(async (opts: { json: boolean }) => { process.exitCode = await runIdentifierSystemsList(opts); });
  idSystems.command('set <system>')
    .description('Set a system\'s label, and whether it is listed and searched')
    .option('--label <text>', 'the label; an empty string clears it')
    .option('--list-column <on|off>', 'show this identifier in the list')
    .option('--searchable <on|off>', 'let search match this identifier')
    .option('--json', 'emit JSON', false)
    .action(async (system: string, opts: IdentifierSystemsSetOpts) => { process.exitCode = await runIdentifierSystemsSet(system, opts); });
```

- [ ] **Step 5: Run the CLI tests**

Run: `pnpm --filter @openldr/cli exec vitest run src/patients.test.ts`
Expected: PASS.
Run: `pnpm --filter @openldr/cli exec vitest run`
Expected: PASS. If a test pins the top-level command list, add `patients`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/patients.ts packages/cli/src/patients.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): openldr patients list, show and identifier-systems"
```

---

### Task 8: Studio page, Patients tab and nav

**Files:**
- Modify: `apps/studio/src/api.ts` (append after the result fields block near `:2663`)
- Create: `apps/studio/src/pages/Patients.tsx`
- Create: `apps/studio/src/patients/PatientsTab.tsx`
- Create: `apps/studio/src/patients/PatientsTab.test.tsx`
- Modify: `apps/studio/src/App.tsx:49`
- Modify: `apps/studio/src/shell/AppShell.tsx:3-6,33`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (`nav.patients` and a new `patients` block)

**Interfaces:**
- Consumes: routes from Task 6.
- Produces (api.ts): types mirroring Task 5 (`PatientRow`, `PatientList`, `PatientDetail`, `PatientRequestList`, `IdentifierSystemRow`, `IdentifierSystemList`) and `listPatients`, `getPatient`, `listPatientRequests`, `listIdentifierSystems`, `saveIdentifierSystem`. `PatientsTab({ onOpen }: { onOpen: (ref: string) => void })`.

- [ ] **Step 1: Add the API client**

Append to `apps/studio/src/api.ts`:

```ts
// Patient index (docs/superpowers/specs/2026-10-12-patient-index-design.md). The server masks; these
// types carry whatever it sent. `ref` is opaque and dies with the server process.
export interface PatientIdentifierView { system: string | null; label: string | null; value: string }
export interface PatientRow {
  ref: string; id: string | null; name: string | null; sex: string | null; birthDate: string | null;
  ageYears: number | null; identifiers: PatientIdentifierView[];
  managingFacility: { reference: string; name: string | null } | null;
  active: boolean; replacedByRef: string | null; lastRequestAt: string | null; requestCount: number;
}
export interface PatientList { rows: PatientRow[]; total: number; masked: boolean }
export interface PatientDetail extends PatientRow { patientGuid: string | null; phone: string | null; email: string | null; masked: boolean }
export interface PatientRequestRow { authoredAt: string | null; panel: string | null; requester: string | null; status: string | null; resultCount: number }
export interface PatientRequestList { rows: PatientRequestRow[]; total: number }
export interface IdentifierSystemRow {
  system: string | null; label: string | null; labelSource: 'operator' | 'source' | 'none';
  patientCount: number; listColumn: boolean; searchable: boolean;
}
export interface IdentifierSystemList { rows: IdentifierSystemRow[]; total: number; ownedHere: boolean }

export function listPatients(p: { search?: string; status?: 'active' | 'merged' | 'all'; limit: number; offset: number }): Promise<PatientList> {
  const s = new URLSearchParams();
  if (p.search) s.set('search', p.search);
  if (p.status && p.status !== 'active') s.set('status', p.status);
  s.set('limit', String(p.limit));
  s.set('offset', String(p.offset));
  return apiGet<PatientList>(`/api/patients?${s}`, 'list patients');
}
export const getPatient = (ref: string): Promise<PatientDetail> =>
  apiGet<PatientDetail>(`/api/patients/${encodeURIComponent(ref)}`, 'open patient');
export const listPatientRequests = (ref: string, p: { limit: number; offset: number }): Promise<PatientRequestList> =>
  apiGet<PatientRequestList>(`/api/patients/${encodeURIComponent(ref)}/requests?limit=${p.limit}&offset=${p.offset}`, 'list patient requests');
export const listIdentifierSystems = (p: { limit: number; offset: number }): Promise<IdentifierSystemList> =>
  apiGet<IdentifierSystemList>(`/api/patients/identifier-systems?limit=${p.limit}&offset=${p.offset}`, 'list identifier systems');
export const saveIdentifierSystem = (i: { system: string; label: string | null; listColumn: boolean; searchable: boolean }): Promise<IdentifierSystemRow> =>
  authFetch('/api/patients/identifier-systems', jbody(i, 'PUT')).then((r) => okJson<IdentifierSystemRow>(r, 'save identifier system'));
```

- [ ] **Step 2: Add the English strings**

In `apps/studio/src/i18n/en.ts`, add `patients: 'Patients',` to `nav` after `testCatalog`. Add a top-level block after `testCatalog: { ... },`:

```ts
  patients: {
    title: 'Patients',
    tabs: { patients: 'Patients', systems: 'Identifier systems' },
    searchPlaceholder: 'Search name or identifier',
    searchPlaceholderMasked: 'Exact identifier',
    maskedNote: 'Names and identifiers are masked. Search matches an exact identifier only.',
    empty: 'No patients yet. Patients arrive with lab data from the source system.',
    noMatch: 'No patient matches.',
    count_one: '{{count}} patient',
    count_other: '{{count}} patients',
    rowActions: 'Row actions',
    actionsFor: 'Actions for patient',
    view: 'View',
    noSystem: 'No system',
    status: { active: 'Active', merged: 'Merged' },
    col: {
      name: 'Name', sex: 'Sex', age: 'Age', identifiers: 'Identifiers', facility: 'Managing facility',
      lastRequest: 'Last request', requests: 'Requests', status: 'Status',
    },
    sheet: {
      title: 'Patient',
      description: 'From the source system. CE does not edit patients.',
      identity: 'Identity',
      name: 'Name', sex: 'Sex', birthDate: 'Date of birth', birthYear: 'Birth year', age: 'Age',
      facility: 'Managing facility', status: 'Status', guid: 'Source id', phone: 'Phone', email: 'Email',
      identifiers: 'Identifiers', noIdentifiers: 'No identifiers.',
      replacedBy: 'Replaced by', openReplacement: 'Open the patient this record was merged into',
      requests: 'Requests', noRequests: 'No requests for this patient.',
      reqCol: { date: 'Date', panel: 'Panel', requester: 'Requesting facility', status: 'Status', results: 'Results' },
      gone: 'This list is out of date. Reload the page to open the patient.',
    },
    systems: {
      empty: 'No identifiers have arrived yet.',
      fromCentral: 'These labels come from central. Only central can change them.',
      col: { label: 'Label', system: 'System', patients: 'Patients', listed: 'Listed', searched: 'Searched' },
      yes: 'Yes', no: 'No',
      edit: 'Edit',
      actionsFor: 'Actions for {{system}}',
      sheetTitle: 'Identifier system',
      sheetDescription: 'Name this system, and choose whether the list shows it and search matches it.',
      actions: 'Identifier system actions',
      label: 'Label', labelHint: 'Leave empty to use the name the source system sends.',
      listColumn: 'Show in the list', searchable: 'Search matches it',
      saved: 'Saved {{system}}.',
    },
  },
```

- [ ] **Step 3: Add the French and Portuguese strings**

In `apps/studio/src/i18n/fr.ts`, `nav.patients: 'Patients',` and:

```ts
  patients: {
    title: 'Patients',
    tabs: { patients: 'Patients', systems: 'Systèmes d\'identifiants' },
    searchPlaceholder: 'Rechercher un nom ou un identifiant',
    searchPlaceholderMasked: 'Identifiant exact',
    maskedNote: 'Les noms et les identifiants sont masqués. La recherche ne trouve qu\'un identifiant exact.',
    empty: 'Aucun patient. Les patients arrivent avec les données du laboratoire depuis le système source.',
    noMatch: 'Aucun patient ne correspond.',
    count_one: '{{count}} patient',
    count_other: '{{count}} patients',
    rowActions: 'Actions de ligne',
    actionsFor: 'Actions pour le patient',
    view: 'Voir',
    noSystem: 'Sans système',
    status: { active: 'Actif', merged: 'Fusionné' },
    col: {
      name: 'Nom', sex: 'Sexe', age: 'Âge', identifiers: 'Identifiants', facility: 'Établissement de rattachement',
      lastRequest: 'Dernière demande', requests: 'Demandes', status: 'Statut',
    },
    sheet: {
      title: 'Patient',
      description: 'Issu du système source. CE ne modifie pas les patients.',
      identity: 'Identité',
      name: 'Nom', sex: 'Sexe', birthDate: 'Date de naissance', birthYear: 'Année de naissance', age: 'Âge',
      facility: 'Établissement de rattachement', status: 'Statut', guid: 'Identifiant source', phone: 'Téléphone', email: 'E-mail',
      identifiers: 'Identifiants', noIdentifiers: 'Aucun identifiant.',
      replacedBy: 'Remplacé par', openReplacement: 'Ouvrir le patient dans lequel ce dossier a été fusionné',
      requests: 'Demandes', noRequests: 'Aucune demande pour ce patient.',
      reqCol: { date: 'Date', panel: 'Panel', requester: 'Établissement demandeur', status: 'Statut', results: 'Résultats' },
      gone: 'Cette liste n\'est plus à jour. Rechargez la page pour ouvrir le patient.',
    },
    systems: {
      empty: 'Aucun identifiant n\'est encore arrivé.',
      fromCentral: 'Ces libellés viennent du central. Seul le central peut les modifier.',
      col: { label: 'Libellé', system: 'Système', patients: 'Patients', listed: 'Affiché', searched: 'Recherché' },
      yes: 'Oui', no: 'Non',
      edit: 'Modifier',
      actionsFor: 'Actions pour {{system}}',
      sheetTitle: 'Système d\'identifiants',
      sheetDescription: 'Nommez ce système et choisissez si la liste l\'affiche et si la recherche le trouve.',
      actions: 'Actions du système d\'identifiants',
      label: 'Libellé', labelHint: 'Laissez vide pour utiliser le nom envoyé par le système source.',
      listColumn: 'Afficher dans la liste', searchable: 'La recherche le trouve',
      saved: '{{system}} enregistré.',
    },
  },
```

In `apps/studio/src/i18n/pt.ts`, `nav.patients: 'Pacientes',` and:

```ts
  patients: {
    title: 'Pacientes',
    tabs: { patients: 'Pacientes', systems: 'Sistemas de identificadores' },
    searchPlaceholder: 'Pesquisar nome ou identificador',
    searchPlaceholderMasked: 'Identificador exato',
    maskedNote: 'Os nomes e os identificadores estão ocultos. A pesquisa só encontra um identificador exato.',
    empty: 'Ainda não há pacientes. Os pacientes chegam com os dados do laboratório a partir do sistema de origem.',
    noMatch: 'Nenhum paciente corresponde.',
    count_one: '{{count}} paciente',
    count_other: '{{count}} pacientes',
    rowActions: 'Ações da linha',
    actionsFor: 'Ações para o paciente',
    view: 'Ver',
    noSystem: 'Sem sistema',
    status: { active: 'Ativo', merged: 'Fundido' },
    col: {
      name: 'Nome', sex: 'Sexo', age: 'Idade', identifiers: 'Identificadores', facility: 'Unidade de referência',
      lastRequest: 'Último pedido', requests: 'Pedidos', status: 'Estado',
    },
    sheet: {
      title: 'Paciente',
      description: 'Vem do sistema de origem. O CE não edita pacientes.',
      identity: 'Identidade',
      name: 'Nome', sex: 'Sexo', birthDate: 'Data de nascimento', birthYear: 'Ano de nascimento', age: 'Idade',
      facility: 'Unidade de referência', status: 'Estado', guid: 'Identificador de origem', phone: 'Telefone', email: 'E-mail',
      identifiers: 'Identificadores', noIdentifiers: 'Sem identificadores.',
      replacedBy: 'Substituído por', openReplacement: 'Abrir o paciente em que este registo foi fundido',
      requests: 'Pedidos', noRequests: 'Não há pedidos para este paciente.',
      reqCol: { date: 'Data', panel: 'Painel', requester: 'Unidade requisitante', status: 'Estado', results: 'Resultados' },
      gone: 'Esta lista está desatualizada. Recarregue a página para abrir o paciente.',
    },
    systems: {
      empty: 'Ainda não chegou nenhum identificador.',
      fromCentral: 'Estas etiquetas vêm do central. Só o central as pode alterar.',
      col: { label: 'Etiqueta', system: 'Sistema', patients: 'Pacientes', listed: 'Na lista', searched: 'Pesquisado' },
      yes: 'Sim', no: 'Não',
      edit: 'Editar',
      actionsFor: 'Ações para {{system}}',
      sheetTitle: 'Sistema de identificadores',
      sheetDescription: 'Dê um nome a este sistema e escolha se a lista o mostra e se a pesquisa o encontra.',
      actions: 'Ações do sistema de identificadores',
      label: 'Etiqueta', labelHint: 'Deixe vazio para usar o nome que o sistema de origem envia.',
      listColumn: 'Mostrar na lista', searchable: 'A pesquisa encontra-o',
      saved: '{{system}} guardado.',
    },
  },
```

- [ ] **Step 4: Write the failing tab test**

`apps/studio/src/patients/PatientsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPatients: vi.fn() };
});

import * as api from '@/api';
import { PatientsTab } from './PatientsTab';

const ROW: api.PatientRow = {
  ref: 'r1', id: 'hl7-1', name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: 'MPI-0001' }],
  managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' },
  active: true, replacedByRef: null, lastRequestAt: '2026-03-04', requestCount: 2,
};

beforeEach(() => { vi.mocked(api.listPatients).mockReset(); });

describe('PatientsTab', () => {
  it('shows the spinner, then a row with its listed identifier and facility', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [ROW], total: 1, masked: false });
    render(<PatientsTab onOpen={() => {}} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const row = await screen.findByTestId('patient-row-r1');
    expect(row.textContent).toContain('John Mwanza');
    expect(row.textContent).toContain('MPI: MPI-0001');
    expect(row.textContent).toContain('Chilenje Clinic');
    expect(vi.mocked(api.listPatients)).toHaveBeenCalledWith({ search: undefined, status: 'active', limit: 25, offset: 0 });
  });

  it('says it is masked and asks for an exact identifier', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [{ ...ROW, id: null, name: 'J*** M***' }], total: 1, masked: true });
    render(<PatientsTab onOpen={() => {}} />);
    await screen.findByTestId('patient-row-r1');
    expect(screen.getByText('Names and identifiers are masked. Search matches an exact identifier only.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Exact identifier')).toBeTruthy();
  });

  it('shows stripes and no table when empty', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [], total: 0, masked: false });
    render(<PatientsTab onOpen={() => {}} />);
    expect(await screen.findByText('No patients yet. Patients arrive with lab data from the source system.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a patient when its row is clicked', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [ROW], total: 1, masked: false });
    const onOpen = vi.fn();
    render(<PatientsTab onOpen={onOpen} />);
    fireEvent.click(await screen.findByTestId('patient-row-r1'));
    expect(onOpen).toHaveBeenCalledWith('r1');
  });

  it('searches after a pause, from page one', async () => {
    vi.mocked(api.listPatients).mockResolvedValue({ rows: [ROW], total: 1, masked: false });
    render(<PatientsTab onOpen={() => {}} />);
    await screen.findByTestId('patient-row-r1');
    fireEvent.change(screen.getByPlaceholderText('Search name or identifier'), { target: { value: 'MPI-0001' } });
    await waitFor(() => expect(vi.mocked(api.listPatients)).toHaveBeenLastCalledWith({ search: 'MPI-0001', status: 'active', limit: 25, offset: 0 }));
  });
});
```

- [ ] **Step 5: Run and see it fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients/PatientsTab.test.tsx`
Expected: FAIL, module missing.

- [ ] **Step 6: Write the tab**

`apps/studio/src/patients/PatientsTab.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ActiveFilterChips, DataTableToolbar, useTableState, type ColumnDef, type FilterRule } from '@/components/data-table';
import { listPatients, type PatientRow } from '@/api';

// The Patients tab (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 3). Copies
// TestCatalog.tsx's tests tab. Read-only, so it has no header menu. The server masks; this tab only
// changes its placeholder and shows a note when the list came back masked.

const SEARCH_DEBOUNCE_MS = 250;

function statusFrom(filters: FilterRule[]): 'active' | 'merged' | 'all' {
  const f = filters.find((r) => r.column === 'status' && r.operator === 'eq' && typeof r.value === 'string');
  return f?.value === 'merged' ? 'merged' : f?.value === 'all' ? 'all' : 'active';
}

export function PatientsTab({ onOpen }: { onOpen: (ref: string) => void }): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [masked, setMasked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  const columns = useMemo<ColumnDef<PatientRow>[]>(() => [
    {
      id: 'name', labelKey: 'patients.col.name', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => (
        <span className="flex items-center gap-2">
          {r.name ?? ''}
          {(!r.active || r.replacedByRef) && <Badge variant="outline">{t('patients.status.merged')}</Badge>}
        </span>
      ),
    },
    { id: 'sex', labelKey: 'patients.col.sex', type: 'text', defaultVisible: true, filterable: false, sortable: false, accessor: (r) => r.sex ?? '' },
    { id: 'age', labelKey: 'patients.col.age', type: 'text', defaultVisible: true, filterable: false, sortable: false, accessor: (r) => (r.ageYears === null ? '' : String(r.ageYears)) },
    {
      id: 'identifiers', labelKey: 'patients.col.identifiers', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => (
        <div className="flex flex-col">
          {r.identifiers.map((i) => (
            <span key={`${i.system ?? ''}|${i.value}`} className="whitespace-nowrap text-xs">
              <span className="text-muted-foreground">{i.label ?? i.system ?? t('patients.noSystem')}: </span>
              <span className="font-mono">{i.value}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      id: 'facility', labelKey: 'patients.col.facility', type: 'text', defaultVisible: true, filterable: false, sortable: false,
      accessor: (r) => r.managingFacility?.name ?? r.managingFacility?.reference ?? '',
    },
    { id: 'lastRequest', labelKey: 'patients.col.lastRequest', type: 'text', defaultVisible: true, filterable: false, sortable: false, cellClassName: 'whitespace-nowrap', accessor: (r) => r.lastRequestAt ?? '' },
    { id: 'requests', labelKey: 'patients.col.requests', type: 'text', defaultVisible: true, filterable: false, sortable: false, accessor: (r) => String(r.requestCount) },
    {
      id: 'status', labelKey: 'patients.col.status', type: 'enum', defaultVisible: false, sortable: false, operators: ['eq'],
      enumOptions: [{ value: 'active', labelKey: 'patients.status.active' }, { value: 'merged', labelKey: 'patients.status.merged' }],
      accessor: (r) => (r.active && !r.replacedByRef ? t('patients.status.active') : t('patients.status.merged')),
    },
  ], [t]);

  const table = useTableState({ columns, defaultPageSize: 25 });
  const { setPage } = table;

  useEffect(() => {
    const next = search.trim();
    if (next === q) return undefined;
    const timer = setTimeout(() => { setQ(next); setPage(0); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q, setPage]);

  const status = useMemo(() => statusFrom(table.filters), [table.filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await listPatients({ search: q || undefined, status, limit: table.pageSize, offset: table.page * table.pageSize });
      setRows(out.rows);
      setTotal(out.total);
      setMasked(out.masked);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, table.page, table.pageSize]);

  useEffect(() => { void load(); }, [load]);

  const hasFilters = q !== '' || table.filters.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="patients-page">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:gap-2 sm:py-2">
        <DataTableToolbar
          columns={columns}
          filters={table.filters}
          onFiltersChange={table.setFilters}
          sorts={table.sorts}
          onSortsChange={table.setSorts}
          visibleIds={table.visibleIds}
          onVisibleIdsChange={table.setVisibleIds}
          onResetColumns={table.resetColumns}
          onResetAll={() => { table.resetAll(); setSearch(''); }}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={masked ? t('patients.searchPlaceholderMasked') : t('patients.searchPlaceholder')}
        />
        <ActiveFilterChips columns={columns} filters={table.filters} onChange={table.setFilters} />
        {masked && <div className="text-xs text-muted-foreground">{t('patients.maskedNote')}</div>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">{hasFilters ? t('patients.noMatch') : t('patients.empty')}</StripedEmpty>
        )}
        {/* Rendered only when populated: an empty table's header scrolls a phone sideways (AGENTS.md section 6). */}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {table.visibleColumns.map((c) => <TableHead key={c.id} className={c.headClassName}>{t(c.labelKey)}</TableHead>)}
                <TableHead className="w-12"><span className="sr-only">{t('patients.rowActions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((r) => (
                <TableRow key={r.ref} data-testid={`patient-row-${r.ref}`} className="cursor-pointer" onClick={() => onOpen(r.ref)}>
                  {table.visibleColumns.map((c) => <TableCell key={c.id} className={c.cellClassName}>{c.accessor(r)}</TableCell>)}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid={`patient-actions-${r.ref}`} aria-label={t('patients.actionsFor')}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-testid={`patient-view-${r.ref}`} onSelect={() => onOpen(r.ref)}>{t('patients.view')}</DropdownMenuItem>
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
        page={table.page}
        pageSize={table.pageSize}
        total={total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        leftSlot={<span className="text-muted-foreground">{t('patients.count', { count: total })}</span>}
      />
    </div>
  );
}
```

If `FilterRule` is not exported from `@/components/data-table`, import it from `@/components/data-table/types`.

- [ ] **Step 7: Write the page shell, route and nav**

`apps/studio/src/pages/Patients.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PatientsTab } from '@/patients/PatientsTab';

// Patient Index (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 3). Tabs copy
// TestCatalog.tsx. data-[state=inactive]:hidden stops a flex panel out-ranking Radix's hidden rule
// (AGENTS.md section 6).
export function Patients() {
  const { t } = useTranslation();
  const [, setOpenRef] = useState<string | null>(null);
  return (
    <AppShell title={t('patients.title')} fullBleed>
      <Tabs defaultValue="patients" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4">
          <TabsList className="border-b-0">
            <TabsTrigger value="patients" data-testid="patients-tab-patients">{t('patients.tabs.patients')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="patients" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <PatientsTab onOpen={setOpenRef} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
```

Task 9 wires the detail sheet to `openRef`. Task 10 adds the second tab.

In `apps/studio/src/App.tsx`, import `{ Patients } from '@/pages/Patients'` and add after the test-catalog route:

```tsx
      <Route path="/patients" element={<RequireCapability cap="patients.view"><Patients /></RequireCapability>} />
```

In `apps/studio/src/shell/AppShell.tsx`, add `Contact` to the lucide import and after the Test Catalog entry:

```ts
  { to: '/patients', labelKey: 'nav.patients', end: false, icon: Contact, caps: ['patients.view'] },
```

- [ ] **Step 8: Run the studio tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients src/i18n`
Expected: PASS, including the locale parity test.

- [ ] **Step 9: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/pages/Patients.tsx apps/studio/src/patients/PatientsTab.tsx apps/studio/src/patients/PatientsTab.test.tsx apps/studio/src/App.tsx apps/studio/src/shell/AppShell.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): Patients page with the patient list"
```

---

### Task 9: Studio patient detail sheet

**Files:**
- Create: `apps/studio/src/patients/PatientSheet.tsx`
- Create: `apps/studio/src/patients/PatientSheet.test.tsx`
- Modify: `apps/studio/src/pages/Patients.tsx`

**Interfaces:**
- Consumes: `getPatient`, `listPatientRequests`, `PatientDetail` (Task 8).
- Produces: `PatientSheet({ patientRef, onClose, onOpen }: { patientRef: string | null; onClose: () => void; onOpen: (ref: string) => void })`.

- [ ] **Step 1: Write the failing sheet test**

`apps/studio/src/patients/PatientSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getPatient: vi.fn(), listPatientRequests: vi.fn() };
});

import * as api from '@/api';
import { PatientSheet } from './PatientSheet';

const DETAIL: api.PatientDetail = {
  ref: 'r1', id: 'hl7-1', name: 'John Mwanza', sex: 'M', birthDate: '1990-01-05', ageYears: 36,
  identifiers: [{ system: 'urn:zm:mpi', label: 'MPI', value: 'MPI-0001' }, { system: null, label: null, value: 'F-9' }],
  managingFacility: { reference: 'Organization/fac-1', name: 'Chilenje Clinic' }, active: false, replacedByRef: 'r2',
  lastRequestAt: '2026-03-04', requestCount: 1, patientGuid: 'G-1', phone: '0977', email: null, masked: false,
};

beforeEach(() => {
  vi.mocked(api.getPatient).mockReset();
  vi.mocked(api.listPatientRequests).mockReset();
});

describe('PatientSheet', () => {
  it('shows identity, labelled identifiers and the requests table', async () => {
    vi.mocked(api.getPatient).mockResolvedValue(DETAIL);
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [{ authoredAt: '2026-03-04', panel: 'VL', requester: 'Chilenje', status: 'completed', resultCount: 2 }], total: 1 });
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('John Mwanza')).toBeTruthy();
    expect(screen.getByText('MPI')).toBeTruthy();
    expect(screen.getByText('No system')).toBeTruthy();
    expect(screen.getByText('0977')).toBeTruthy();
    expect((await screen.findByTestId('patient-request-0')).textContent).toContain('VL');
    expect(vi.mocked(api.listPatientRequests)).toHaveBeenCalledWith('r1', { limit: 10, offset: 0 });
  });

  it('opens the replacement patient from its ⋯ menu', async () => {
    vi.mocked(api.getPatient).mockResolvedValue(DETAIL);
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [], total: 0 });
    const onOpen = vi.fn();
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={onOpen} />);
    await screen.findByText('John Mwanza');
    const trigger = screen.getByTestId('patient-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('patient-open-replacement'));
    expect(onOpen).toHaveBeenCalledWith('r2');
  });

  it('shows the birth year label and no phone row when masked', async () => {
    vi.mocked(api.getPatient).mockResolvedValue({ ...DETAIL, id: null, name: 'J*** M***', birthDate: '1990', phone: null, patientGuid: '•••-1', masked: true });
    vi.mocked(api.listPatientRequests).mockResolvedValue({ rows: [], total: 0 });
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('Birth year')).toBeTruthy();
    expect(screen.queryByText('Phone')).toBeNull();
    expect(await screen.findByText('No requests for this patient.')).toBeTruthy();
  });

  it('asks for a reload when the ref is no longer valid', async () => {
    vi.mocked(api.getPatient).mockRejectedValue(new Error('open patient failed: 404'));
    vi.mocked(api.listPatientRequests).mockRejectedValue(new Error('404'));
    render(<PatientSheet patientRef="r1" onClose={() => {}} onOpen={() => {}} />);
    expect(await screen.findByText('This list is out of date. Reload the page to open the patient.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients/PatientSheet.test.tsx`
Expected: FAIL, module missing.

- [ ] **Step 3: Write the sheet**

`apps/studio/src/patients/PatientSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getPatient, listPatientRequests, type PatientDetail, type PatientRequestList } from '@/api';

// One patient (docs/superpowers/specs/2026-10-12-patient-index-design.md, section 3). Read-only.
// Header and label-left grid copy ResultFieldSheet.tsx. The only action, opening the record this one
// was merged into, sits in the section's ⋯ menu (AGENTS.md section 5).

const REQUEST_PAGE = 10;

export function PatientSheet({ patientRef, onClose, onOpen }: {
  patientRef: string | null; onClose: () => void; onOpen: (ref: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [requests, setRequests] = useState<PatientRequestList | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(REQUEST_PAGE);

  useEffect(() => {
    setDetail(null);
    setGone(false);
    setPage(0);
    if (!patientRef) return;
    getPatient(patientRef).then(setDetail).catch(() => setGone(true));
  }, [patientRef]);

  useEffect(() => {
    setRequests(null);
    if (!patientRef) return;
    listPatientRequests(patientRef, { limit: pageSize, offset: page * pageSize })
      .then(setRequests)
      .catch(() => setRequests({ rows: [], total: 0 }));
  }, [patientRef, page, pageSize]);

  const row = (label: string, value: string | null | undefined) => (value ? (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className="break-words">{value}</div>
    </>
  ) : null);

  return (
    <Sheet open={patientRef !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('patients.sheet.title')}</SheetTitle>
          <SheetDescription>{t('patients.sheet.description')}</SheetDescription>
        </SheetHeader>
        {gone && <div className="px-6 py-6 text-sm text-destructive">{t('patients.sheet.gone')}</div>}
        {!gone && !detail && <LoadingState className="min-h-[16rem]" label={t('common.loading')} />}
        {detail && (
          <>
            <section>
              <div className="flex items-center justify-between px-6 py-3">
                <div className="text-sm font-medium text-foreground">{t('patients.sheet.identity')}</div>
                {detail.replacedByRef && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="patient-sheet-menu" aria-label={t('patients.rowActions')}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem data-testid="patient-open-replacement" onSelect={() => onOpen(detail.replacedByRef as string)}>
                        {t('patients.sheet.openReplacement')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <div className="border-t border-border" />
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                {row(t('patients.sheet.name'), detail.name)}
                {row(t('patients.sheet.sex'), detail.sex)}
                {row(detail.masked ? t('patients.sheet.birthYear') : t('patients.sheet.birthDate'), detail.birthDate)}
                {row(t('patients.sheet.age'), detail.ageYears === null ? null : String(detail.ageYears))}
                {row(t('patients.sheet.facility'), detail.managingFacility?.name ?? detail.managingFacility?.reference)}
                {row(t('patients.sheet.status'), detail.active && !detail.replacedByRef ? t('patients.status.active') : t('patients.status.merged'))}
                {row(t('patients.sheet.guid'), detail.patientGuid)}
                {row(t('patients.sheet.phone'), detail.phone)}
                {row(t('patients.sheet.email'), detail.email)}
              </div>
            </section>
            <section>
              <div className="border-t border-border" />
              <div className="px-6 py-3 text-sm font-medium text-foreground">{t('patients.sheet.identifiers')}</div>
              <div className="border-t border-border" />
              {detail.identifiers.length === 0 ? (
                <div className="px-6 py-4 text-sm text-muted-foreground">{t('patients.sheet.noIdentifiers')}</div>
              ) : (
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
                  {detail.identifiers.map((i) => (
                    <div key={`${i.system ?? ''}|${i.value}`} className="contents">
                      <div className="text-muted-foreground">{i.label ?? i.system ?? t('patients.noSystem')}</div>
                      <div className="break-all font-mono text-xs">{i.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="flex flex-col">
              <div className="border-t border-border" />
              <div className="px-6 py-3 text-sm font-medium text-foreground">{t('patients.sheet.requests')}</div>
              <div className="border-t border-border" />
              {!requests && <LoadingState className="min-h-[10rem]" label={t('common.loading')} />}
              {requests && requests.rows.length === 0 && (
                <StripedEmpty className="min-h-[10rem]">{t('patients.sheet.noRequests')}</StripedEmpty>
              )}
              {requests && requests.rows.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">{t('patients.sheet.reqCol.date')}</TableHead>
                      <TableHead>{t('patients.sheet.reqCol.panel')}</TableHead>
                      <TableHead>{t('patients.sheet.reqCol.requester')}</TableHead>
                      <TableHead>{t('patients.sheet.reqCol.status')}</TableHead>
                      <TableHead className="pr-6 text-right">{t('patients.sheet.reqCol.results')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.rows.map((r, i) => (
                      <TableRow key={`${page}-${i}`} data-testid={`patient-request-${i}`}>
                        <TableCell className="whitespace-nowrap pl-6">{r.authoredAt ?? ''}</TableCell>
                        <TableCell>{r.panel ?? ''}</TableCell>
                        <TableCell>{r.requester ?? ''}</TableCell>
                        <TableCell>{r.status ?? ''}</TableCell>
                        <TableCell className="pr-6 text-right">{r.resultCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={requests?.total ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
              />
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default PatientSheet;
```

- [ ] **Step 4: Wire the sheet into the page**

In `apps/studio/src/pages/Patients.tsx`, import `{ PatientSheet } from '@/patients/PatientSheet'`, change `const [, setOpenRef]` to `const [openRef, setOpenRef]`, and add before `</AppShell>`:

```tsx
      <PatientSheet patientRef={openRef} onClose={() => setOpenRef(null)} onOpen={setOpenRef} />
```

- [ ] **Step 5: Run the studio tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/patients/PatientSheet.tsx apps/studio/src/patients/PatientSheet.test.tsx apps/studio/src/pages/Patients.tsx
git commit -m "feat(studio): patient detail sheet with request history"
```

---

### Task 10: Studio Identifier systems tab and edit sheet

**Files:**
- Create: `apps/studio/src/patients/IdentifierSystemsTab.tsx`
- Create: `apps/studio/src/patients/IdentifierSystemsTab.test.tsx`
- Create: `apps/studio/src/patients/IdentifierSystemSheet.tsx`
- Create: `apps/studio/src/patients/IdentifierSystemSheet.test.tsx`
- Modify: `apps/studio/src/pages/Patients.tsx`

**Interfaces:**
- Consumes: `listIdentifierSystems`, `saveIdentifierSystem`, `IdentifierSystemRow` (Task 8).
- Produces: `IdentifierSystemsTab({ canManage }: { canManage: boolean })`; `IdentifierSystemSheet({ system, onClose, onSaved }: { system: IdentifierSystemRow | null; onClose: () => void; onSaved: () => void })`.

- [ ] **Step 1: Write the failing tests**

`apps/studio/src/patients/IdentifierSystemsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listIdentifierSystems: vi.fn() };
});

import * as api from '@/api';
import { IdentifierSystemsTab } from './IdentifierSystemsTab';

const MPI: api.IdentifierSystemRow = { system: 'urn:zm:mpi', label: 'MPI', labelSource: 'operator', patientCount: 3, listColumn: true, searchable: true };
const NONE: api.IdentifierSystemRow = { system: null, label: null, labelSource: 'none', patientCount: 1, listColumn: false, searchable: true };

beforeEach(() => { vi.mocked(api.listIdentifierSystems).mockReset(); });

describe('IdentifierSystemsTab', () => {
  it('lists systems with label, count and flags, and offers Edit to a manager only for a real system', async () => {
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [NONE, MPI], total: 2, ownedHere: true });
    render(<IdentifierSystemsTab canManage />);
    const row = await screen.findByTestId('identifier-system-row-urn:zm:mpi');
    expect(row.textContent).toContain('MPI');
    expect(row.textContent).toContain('3');
    expect(screen.getByTestId('identifier-system-actions-urn:zm:mpi')).toBeTruthy();
    expect(screen.getByTestId('identifier-system-row-none').textContent).toContain('No system');
    expect(screen.queryByTestId('identifier-system-actions-none')).toBeNull();
  });

  it('hides Edit without patients.manage and when central owns the labels', async () => {
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [MPI], total: 1, ownedHere: true });
    const { unmount } = render(<IdentifierSystemsTab canManage={false} />);
    await screen.findByTestId('identifier-system-row-urn:zm:mpi');
    expect(screen.queryByTestId('identifier-system-actions-urn:zm:mpi')).toBeNull();
    unmount();
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [MPI], total: 1, ownedHere: false });
    render(<IdentifierSystemsTab canManage />);
    await screen.findByTestId('identifier-system-row-urn:zm:mpi');
    expect(screen.getByText('These labels come from central. Only central can change them.')).toBeTruthy();
    expect(screen.queryByTestId('identifier-system-actions-urn:zm:mpi')).toBeNull();
  });

  it('shows stripes when no identifier has arrived', async () => {
    vi.mocked(api.listIdentifierSystems).mockResolvedValue({ rows: [], total: 0, ownedHere: true });
    render(<IdentifierSystemsTab canManage />);
    expect(await screen.findByText('No identifiers have arrived yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
```

`apps/studio/src/patients/IdentifierSystemSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, saveIdentifierSystem: vi.fn() };
});

import * as api from '@/api';
import { IdentifierSystemSheet } from './IdentifierSystemSheet';

const SRC: api.IdentifierSystemRow = { system: 'urn:zm:mpi', label: 'MPI number', labelSource: 'source', patientCount: 3, listColumn: false, searchable: true };

beforeEach(() => { vi.mocked(api.saveIdentifierSystem).mockReset(); });

describe('IdentifierSystemSheet', () => {
  it('starts with an empty label when the label came from the source, and saves from the ⋯ menu', async () => {
    vi.mocked(api.saveIdentifierSystem).mockResolvedValue({ ...SRC, label: 'MPI', labelSource: 'operator', listColumn: true });
    const onSaved = vi.fn();
    render(<IdentifierSystemSheet system={SRC} onClose={() => {}} onSaved={onSaved} />);
    const input = screen.getByTestId('identifier-system-label') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('MPI number');
    fireEvent.change(input, { target: { value: 'MPI' } });
    fireEvent.click(screen.getByTestId('identifier-system-list-column'));
    const trigger = screen.getByTestId('identifier-system-sheet-menu');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('identifier-system-save'));
    await waitFor(() => expect(vi.mocked(api.saveIdentifierSystem)).toHaveBeenCalledWith({ system: 'urn:zm:mpi', label: 'MPI', listColumn: true, searchable: true }));
    expect(onSaved).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients/IdentifierSystemsTab.test.tsx src/patients/IdentifierSystemSheet.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 3: Write the sheet**

`apps/studio/src/patients/IdentifierSystemSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { saveIdentifierSystem, type IdentifierSystemRow } from '@/api';

// One identifier system's label and flags (patient index spec, section 3). Copies ResultFieldSheet.tsx:
// Save and Cancel in the section's ⋯ menu, label left and input right.

export function IdentifierSystemSheet({ system, onClose, onSaved }: {
  system: IdentifierSystemRow | null; onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [listColumn, setListColumn] = useState(false);
  const [searchable, setSearchable] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Only an operator's own label is editable text. A source label shows as the placeholder.
    setLabel(system?.labelSource === 'operator' ? system.label ?? '' : '');
    setListColumn(system?.listColumn ?? false);
    setSearchable(system?.searchable ?? true);
  }, [system]);

  const save = async () => {
    if (!system?.system) return;
    setBusy(true);
    try {
      await saveIdentifierSystem({ system: system.system, label: label.trim() || null, listColumn, searchable });
      toast.success(t('patients.systems.saved', { system: system.system }));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={system !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('patients.systems.sheetTitle')}</SheetTitle>
          <SheetDescription>{t('patients.systems.sheetDescription')}</SheetDescription>
        </SheetHeader>
        {system && (
          <section>
            <div className="flex items-center justify-between px-6 py-3">
              <div className="break-all font-mono text-xs text-foreground">{system.system}</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid="identifier-system-sheet-menu" aria-label={t('patients.systems.actions')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem data-testid="identifier-system-save" disabled={busy} onSelect={() => void save()}>{t('common.save')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onClose}>{t('common.cancel')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="border-t border-border" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4 text-sm">
              <div className="text-muted-foreground">{t('patients.systems.label')}</div>
              <div className="flex flex-col gap-1">
                <Input
                  data-testid="identifier-system-label" value={label} disabled={busy}
                  placeholder={system.labelSource === 'source' ? system.label ?? '' : ''}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">{t('patients.systems.labelHint')}</span>
              </div>
              <div className="text-muted-foreground">{t('patients.systems.listColumn')}</div>
              <div><Switch data-testid="identifier-system-list-column" checked={listColumn} onCheckedChange={setListColumn} disabled={busy} /></div>
              <div className="text-muted-foreground">{t('patients.systems.searchable')}</div>
              <div><Switch data-testid="identifier-system-searchable" checked={searchable} onCheckedChange={setSearchable} disabled={busy} /></div>
            </div>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default IdentifierSystemSheet;
```

If `Switch` does not forward `data-testid` through `...rest`, put the test id on a wrapping `div` and click the `button` inside it in the test.

- [ ] **Step 4: Write the tab**

`apps/studio/src/patients/IdentifierSystemsTab.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { listIdentifierSystems, type IdentifierSystemRow } from '@/api';
import { IdentifierSystemSheet } from './IdentifierSystemSheet';

// Identifier systems seen in the warehouse (patient index spec, section 3), the way the Observed tabs
// on Facilities and Test Catalog list codes CE sees but does not own. The null system has no URI to
// label, so it has no Edit.

export function IdentifierSystemsTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useTranslation();
  const [rows, setRows] = useState<IdentifierSystemRow[]>([]);
  const [total, setTotal] = useState(0);
  const [ownedHere, setOwnedHere] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<IdentifierSystemRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await listIdentifierSystems({ limit: pageSize, offset: page * pageSize });
      setRows(out.rows);
      setTotal(out.total);
      setOwnedHere(out.ownedHere);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => { void load(); }, [load]);

  const editable = canManage && ownedHere;
  const key = (r: IdentifierSystemRow) => r.system ?? 'none';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!ownedHere && <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t('patients.systems.fromCentral')}</div>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <LoadingState className="min-h-[16rem] flex-1" label={t('common.loading')} />}
        {!loading && error && (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <StripedEmpty className="min-h-[16rem] flex-1">{t('patients.systems.empty')}</StripedEmpty>
        )}
        {!loading && !error && rows.length > 0 && (
          <Table wrapperClassName="min-h-0 flex-1">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t('patients.systems.col.label')}</TableHead>
                <TableHead>{t('patients.systems.col.system')}</TableHead>
                <TableHead>{t('patients.systems.col.patients')}</TableHead>
                <TableHead>{t('patients.systems.col.listed')}</TableHead>
                <TableHead>{t('patients.systems.col.searched')}</TableHead>
                {editable && <TableHead className="w-12"><span className="sr-only">{t('patients.rowActions')}</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((r) => (
                <TableRow key={key(r)} data-testid={`identifier-system-row-${key(r)}`}>
                  <TableCell>{r.system === null ? t('patients.noSystem') : r.label ?? ''}</TableCell>
                  <TableCell className="break-all font-mono text-xs">{r.system ?? ''}</TableCell>
                  <TableCell>{r.patientCount}</TableCell>
                  <TableCell>{r.listColumn ? t('patients.systems.yes') : t('patients.systems.no')}</TableCell>
                  <TableCell>{r.searchable ? t('patients.systems.yes') : t('patients.systems.no')}</TableCell>
                  {editable && (
                    <TableCell>
                      {r.system !== null && (
                        <div className="flex items-center justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                                data-testid={`identifier-system-actions-${key(r)}`}
                                aria-label={t('patients.systems.actionsFor', { system: r.system })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem data-testid={`identifier-system-edit-${key(r)}`} onSelect={() => setEditing(r)}>
                                {t('patients.systems.edit')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(0); }} />
      <IdentifierSystemSheet system={editing} onClose={() => setEditing(null)} onSaved={() => { void load(); }} />
    </div>
  );
}
```

- [ ] **Step 5: Add the tab to the page**

In `apps/studio/src/pages/Patients.tsx`: import `{ useAuth } from '@/auth/AuthProvider'` and `{ IdentifierSystemsTab } from '@/patients/IdentifierSystemsTab'`. In the component add `const { hasCapability } = useAuth();`. Add a trigger after the patients trigger:

```tsx
            <TabsTrigger value="systems" data-testid="patients-tab-systems">{t('patients.tabs.systems')}</TabsTrigger>
```

and a panel after the patients panel:

```tsx
        <TabsContent value="systems" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <IdentifierSystemsTab canManage={hasCapability('patients.manage')} />
        </TabsContent>
```

- [ ] **Step 6: Run the studio suite for this folder, then typecheck studio**

Run: `pnpm --filter @openldr/studio exec vitest run src/patients src/i18n`
Expected: PASS.
Run: `pnpm --filter @openldr/studio exec tsc --noEmit > "$TMP/tc-studio.txt" 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/patients/IdentifierSystemsTab.tsx apps/studio/src/patients/IdentifierSystemsTab.test.tsx apps/studio/src/patients/IdentifierSystemSheet.tsx apps/studio/src/patients/IdentifierSystemSheet.test.tsx apps/studio/src/pages/Patients.tsx
git commit -m "feat(studio): identifier systems tab and label sheet"
```

---

### Task 11: Docs

**Files:**
- Create: `apps/studio/src/docs/0.1.8/en/patients.md`, `fr/patients.md`, `pt/patients.md`
- Modify: `apps/studio/src/docs/registry.ts` (after the `test-catalog` entry near `:187`)
- Create: `apps/web/src/docs/0.1.8/patients.md`
- Modify: `apps/web/src/docs/content.ts` (`TITLES` and `NAV`, after `test-catalog`)
- Modify: `apps/web/src/docs/0.1.8/cli.md` (command table near `:58`)
- Modify: `apps/web/src/docs/0.1.8/upgrading.md` (after line 77)
- Modify: `docs/CLI-REFERENCE.md`, `docs/HTTP-API.md`

- [ ] **Step 1: Write the English in-app page**

`apps/studio/src/docs/0.1.8/en/patients.md`:

```markdown
# Patients

The Patient Index lists the patients CE has received with lab data. The source system, such as a HIMS, owns each patient. CE shows patients and never edits them.

Open **Patients** in the sidebar. You need the Patients view permission.

## What you see

Without the View patient identifiers permission, names and identifiers are masked. A name shows its first letter, such as `J*** M***`. An identifier shows its last four characters. You see the birth year, not the date of birth, and no phone or email. Search then matches an exact identifier only, because a partial name search would reveal names one letter at a time.

With View patient identifiers, you see everything, and search also matches part of a name. Every list and every patient you open is written to the audit log. The audit log records how many patients matched, never what you searched for.

## Finding a patient

Type an identifier, such as an MPI number or a national id, and CE finds the patient whichever identifier it is. Use **Filter** and **Status** to show merged records.

The **Identifiers** column shows the identifier systems chosen on the **Identifier systems** tab.

## A patient's sheet

Click a row, or choose **View** from its ⋯ menu. The sheet shows the patient's details, every identifier with its label, and their lab requests, newest first. If the record was merged into another, choose **Open the patient this record was merged into** from the ⋯ menu.

If the sheet says the list is out of date, the server has restarted. Reload the page.

## Identifier systems

Each identifier arrives with a system, a URI that says what kind of identifier it is. This tab lists every system CE has seen, with how many patients carry it.

With the Manage patient index permission, choose **Edit** from a row's ⋯ menu to give a system a label, such as NRC or ART number. Leave the label empty to use the name the source system sends. **Show in the list** adds it to the Identifiers column. **Search matches it** lets search find patients by it. Choose **Save** from the sheet's ⋯ menu.

A lab that receives these labels from central cannot change them.

## After upgrading

Patients received before this release have no identifiers listed until you run `openldr db reproject --force` once.

## From the command line

- `openldr patients list [--search <text>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off]`

Output is masked unless you pass `--identifiers`, which is audited.
```

- [ ] **Step 2: Write the French and Portuguese in-app pages**

`apps/studio/src/docs/0.1.8/fr/patients.md`:

```markdown
# Patients

L'index des patients liste les patients que CE a reçus avec les données du laboratoire. Le système source, par exemple un HIMS, possède chaque patient. CE affiche les patients et ne les modifie jamais.

Ouvrez **Patients** dans la barre latérale. Il faut l'autorisation Voir l'index des patients.

## Ce que vous voyez

Sans l'autorisation Voir les identifiants des patients, les noms et les identifiants sont masqués. Un nom affiche sa première lettre, par exemple `J*** M***`. Un identifiant affiche ses quatre derniers caractères. Vous voyez l'année de naissance, pas la date, et ni téléphone ni e-mail. La recherche ne trouve alors qu'un identifiant exact, car une recherche sur une partie du nom révélerait les noms lettre par lettre.

Avec Voir les identifiants des patients, vous voyez tout, et la recherche trouve aussi une partie d'un nom. Chaque liste et chaque patient ouvert est inscrit au journal d'audit. Le journal enregistre combien de patients correspondent, jamais ce que vous avez cherché.

## Trouver un patient

Saisissez un identifiant, par exemple un numéro MPI ou un identifiant national, et CE trouve le patient quel que soit l'identifiant. Utilisez **Filtre** et **Statut** pour afficher les dossiers fusionnés.

La colonne **Identifiants** affiche les systèmes choisis dans l'onglet **Systèmes d'identifiants**.

## La fiche d'un patient

Cliquez sur une ligne, ou choisissez **Voir** dans son menu ⋯. La fiche affiche les informations du patient, chaque identifiant avec son libellé, et ses demandes de laboratoire, de la plus récente à la plus ancienne. Si le dossier a été fusionné dans un autre, choisissez **Ouvrir le patient dans lequel ce dossier a été fusionné** dans le menu ⋯.

Si la fiche indique que la liste n'est plus à jour, le serveur a redémarré. Rechargez la page.

## Systèmes d'identifiants

Chaque identifiant arrive avec un système, une URI qui indique de quel type d'identifiant il s'agit. Cet onglet liste chaque système vu par CE, avec le nombre de patients qui le portent.

Avec l'autorisation Gérer l'index des patients, choisissez **Modifier** dans le menu ⋯ d'une ligne pour donner un libellé au système, par exemple NRC ou numéro ART. Laissez le libellé vide pour utiliser le nom envoyé par le système source. **Afficher dans la liste** l'ajoute à la colonne Identifiants. **La recherche le trouve** permet de chercher les patients par cet identifiant. Choisissez **Enregistrer** dans le menu ⋯ de la fiche.

Un laboratoire qui reçoit ces libellés du central ne peut pas les modifier.

## Après la mise à jour

Les patients reçus avant cette version n'ont aucun identifiant listé tant que vous n'avez pas lancé `openldr db reproject --force` une fois.

## En ligne de commande

- `openldr patients list [--search <texte>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <système> [--label <texte>] [--list-column on|off] [--searchable on|off]`

La sortie est masquée sauf avec `--identifiers`, qui est audité.
```

`apps/studio/src/docs/0.1.8/pt/patients.md`:

```markdown
# Pacientes

O índice de pacientes lista os pacientes que o CE recebeu com os dados do laboratório. O sistema de origem, por exemplo um HIMS, é o dono de cada paciente. O CE mostra os pacientes e nunca os edita.

Abra **Pacientes** na barra lateral. Precisa da permissão Ver índice de pacientes.

## O que vê

Sem a permissão Ver identificadores de pacientes, os nomes e os identificadores estão ocultos. Um nome mostra a primeira letra, por exemplo `J*** M***`. Um identificador mostra os últimos quatro caracteres. Vê o ano de nascimento, não a data, e não vê telefone nem e-mail. A pesquisa só encontra então um identificador exato, porque pesquisar parte de um nome revelaria os nomes letra a letra.

Com Ver identificadores de pacientes, vê tudo, e a pesquisa também encontra parte de um nome. Cada lista e cada paciente que abre fica registado no registo de auditoria. O registo guarda quantos pacientes corresponderam, nunca o que pesquisou.

## Encontrar um paciente

Escreva um identificador, por exemplo um número MPI ou um identificador nacional, e o CE encontra o paciente seja qual for o identificador. Use **Filtro** e **Estado** para mostrar registos fundidos.

A coluna **Identificadores** mostra os sistemas escolhidos no separador **Sistemas de identificadores**.

## A ficha de um paciente

Clique numa linha, ou escolha **Ver** no menu ⋯. A ficha mostra os dados do paciente, cada identificador com a sua etiqueta e os pedidos de laboratório, do mais recente para o mais antigo. Se o registo foi fundido noutro, escolha **Abrir o paciente em que este registo foi fundido** no menu ⋯.

Se a ficha disser que a lista está desatualizada, o servidor reiniciou. Recarregue a página.

## Sistemas de identificadores

Cada identificador chega com um sistema, um URI que diz que tipo de identificador é. Este separador lista cada sistema que o CE viu, com quantos pacientes o têm.

Com a permissão Gerir índice de pacientes, escolha **Editar** no menu ⋯ de uma linha para dar uma etiqueta ao sistema, por exemplo NRC ou número TARV. Deixe a etiqueta vazia para usar o nome que o sistema de origem envia. **Mostrar na lista** acrescenta-o à coluna Identificadores. **A pesquisa encontra-o** permite encontrar pacientes por ele. Escolha **Guardar** no menu ⋯ da ficha.

Um laboratório que recebe estas etiquetas do central não as pode alterar.

## Depois de atualizar

Os pacientes recebidos antes desta versão não têm identificadores listados até executar `openldr db reproject --force` uma vez.

## Na linha de comandos

- `openldr patients list [--search <texto>] [--status active|merged|all] [--identifiers]`
- `openldr patients show <id> [--identifiers]`
- `openldr patients identifier-systems list`
- `openldr patients identifier-systems set <sistema> [--label <texto>] [--list-column on|off] [--searchable on|off]`

A saída está oculta, a não ser que passe `--identifiers`, que fica registado na auditoria.
```

- [ ] **Step 3: Register the in-app page**

In `apps/studio/src/docs/registry.ts`, after the `test-catalog` entry:

```ts
  {
    slug: 'patients',
    title: 'Patients',
    group: 'data-design',
    summary: 'Find a patient by any identifier, and see where they were tested. Identifiers are masked unless you may see them.',
    audience: ['lab-managers', 'administrators'],
    requiredRoles: [],
    estimatedMinutes: 6,
    difficulty: 'beginner',
    relatedSlugs: ['facilities', 'test-catalog', 'data-exposure'],
    screenshotNames: [],
    status: 'published',
  },
```

If `difficulty: 'beginner'` is not an allowed value, use `'intermediate'`. If `data-exposure` is not a registry slug, drop it from `relatedSlugs`.

- [ ] **Step 4: Write the web page and register it**

`apps/web/src/docs/0.1.8/patients.md`: copy the English in-app page from Step 1 unchanged.

In `apps/web/src/docs/content.ts`, add `patients: 'Patients',` to `TITLES` after `'test-catalog'`, and `{ slug: 'patients' },` to `NAV` after `{ slug: 'test-catalog' },`.

- [ ] **Step 5: CLI, HTTP and upgrade docs**

In `apps/web/src/docs/0.1.8/cli.md`, add a row to the command table after the `db` row:

```markdown
| `patients` | `list` and `show` patients (masked unless `--identifiers`, which is audited); `identifier-systems list` and `set` labels. |
```

In `apps/web/src/docs/0.1.8/upgrading.md`, after line 77:

```markdown
If you upgrade from a release before the Patient Index, run `openldr db reproject --force` once. It lists every identifier of patients already in the warehouse, so search can find them by any identifier, not only the first.
```

In `docs/CLI-REFERENCE.md`, add a `patients` section listing the four commands with the options from Task 7 Step 4. In `docs/HTTP-API.md`, add the five routes from spec section 4 with `:ref` paths, their capabilities, and one sentence each: masked unless the caller holds `patients.view_identifiers`; unmasked list and detail calls are audited.

- [ ] **Step 6: Run the docs tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS, including registry and validation tests that check each locale file exists.
Run: `pnpm --filter @openldr/web exec vitest run src/docs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/patients.md apps/studio/src/docs/0.1.8/fr/patients.md apps/studio/src/docs/0.1.8/pt/patients.md apps/studio/src/docs/registry.ts apps/web/src/docs/0.1.8/patients.md apps/web/src/docs/content.ts apps/web/src/docs/0.1.8/cli.md apps/web/src/docs/0.1.8/upgrading.md docs/CLI-REFERENCE.md docs/HTTP-API.md
git commit -m "docs: patient index in en, fr and pt, CLI and HTTP reference, upgrade note"
```

---

### Task 12: Gate, mobile check, merge, changelog, live check

This task needs the operator at three points: before merging, before pushing, and for the live check.

- [ ] **Step 1: Run the full gate in the worktree**

```bash
pnpm turbo run test --force --concurrency=2 --continue > "$TMP/gate-test.txt" 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > "$TMP/gate-tc.txt" 2>&1; echo "exit=$?"
```

Expected: both `exit=0`. On a failure, grep the file for `Test timed out`, `out of memory` and `VirtualAlloc` first, and re-run that package alone before calling it a regression.

- [ ] **Step 2: Run the server lint**

Run: `pnpm --filter @openldr/server run lint`
Expected: no errors.

- [ ] **Step 3: Ask the operator to merge**

Report the gate output and ask. On a yes, merge `feat/patient-index` into local `main` from the main checkout with `git merge --no-ff feat/patient-index`.

- [ ] **Step 4: Changelog**

On `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json` as `chore(web): update changelog after patient index`.

- [ ] **Step 5: Live check against the operator's dev stack**

`AUTH_DEV_BYPASS` grants every capability (`apps/server/src/auth-plugin.ts:61,64`), so the live check sees the unmasked view only. The route tests are the proof for the masked view.

1. Restart the API server so it runs migration 025.
2. Ingest a FHIR Bundle with one Patient carrying three identifiers (`urn:zm:mpi`, `urn:zm:nrc`, and one with no system) and one ServiceRequest for that patient.
3. Run `openldr db reproject --force`.
4. In `/patients`, find the patient by the NRC value. Open the sheet and check the three identifiers and the request.
5. On Identifier systems, label `urn:zm:mpi` as "MPI" with Show in the list on. Check that the list shows `MPI: <value>`.
6. Check `/audit` for `patients.list` and `patients.view` entries with no search text.
7. At 375x812 with `resize_window`, check the list does not scroll sideways when empty, and the sheet fits. Say that only a real phone can confirm the sheet's bottom edge.

- [ ] **Step 6: Ask the operator to push**

On a yes, push `main` and confirm the origin SHA with `git rev-parse origin/main`.

- [ ] **Step 7: Update memory**

Add a `patient-index` memory note: what shipped, the ref rule, the masked-search rule, and that the live check could not exercise masking under `AUTH_DEV_BYPASS`.
