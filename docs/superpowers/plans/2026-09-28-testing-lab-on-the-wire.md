# Testing Lab on the Wire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the testing lab in `DiagnosticReport.performer` and the requesting clinic (with the doctor) in `ServiceRequest.requester`, from cdr-toolchain through CE's warehouse.

**Architecture:** CE lands first and is additive: a warehouse migration adds three `lab_requests.requester_*` columns, the `ServiceRequest` projection fills them from a contained `PractitionerRole` (or a direct facility reference), and the facility code readers take codes from both roles. cdr-toolchain then sets the V2 payload's existing `testing_facility_code` to a configured lab, which `fhir-transform` already turns into `performer`, and moves the clinic and doctor into a contained `PractitionerRole`. No report SQL changes: the seeded reports already mean the lab (spec 6.4).

**Tech Stack:** CE: TypeScript, Kysely, pg-mem, vitest, pnpm/turbo. cdr-toolchain: TypeScript, `node:test` + `node:assert/strict` via `tsx`, commander.

**Spec:** `docs/superpowers/specs/2026-09-28-testing-lab-on-the-wire-design.md`

## Global Constraints

- Lab identifier system on the wire: `urn:openldr:default_lab` (cdr-toolchain `system_id` `"DEFAULT_LAB"`, turned into the URI by `systemUri`). Clinic system unchanged: `urn:openldr:default_fac` (`"DEFAULT_FAC"`).
- Lab `Organization` id: `lab-<code>`. Clinic `Organization` id stays `facility-<code>`.
- Contained requester: `{ resourceType: "PractitionerRole", id: "requester", practitioner?: { display }, organization?: { identifier: { system, value }, display } }`, referenced as `requester: { reference: "#requester" }`. Omit `practitioner` with no doctor, `organization` with no clinic, and both `contained` and `requester` when neither exists.
- `OPENLDR_LAB_CODE` (flag `--lab-code`) is REQUIRED when the target is CE. `OPENLDR_LAB_NAME` (flag `--lab-name`) is optional; display falls back to the code.
- The lab-number prefix check counts and reports mismatches. It never refuses a push.
- Without a lab code, cdr-toolchain output is byte-for-byte unchanged (v2 push, `export`, `compare-batch`).
- CE warehouse migration number: `018`. Columns: `requester_code`, `requester_system`, `requester_display`, all `textType(engine)`.
- CE's clinic extraction order: `#id` to a contained `PractitionerRole`'s `organization`; else a `requester` that carries `identifier`; else all nulls.
- No report SQL changes in CE.
- New writing has no em dashes and no emoji. Short sentences. Never a `Co-Authored-By` trailer.
- CE work happens in `D:/Projects/Repositories/openldr_ce/.claude/worktrees/testing-lab-on-wire` on branch `spec/testing-lab-on-wire`. cdr-toolchain work happens in `D:/Projects/Repositories/cdr-toolchain/.claude/worktrees/testing-lab-on-wire` on branch `feat/testing-lab-on-wire` (created in Task 5). Prefix every command with `cd <that worktree> &&` and check `git branch --show-current` before committing.
- CE tests: `pnpm --filter <pkg> exec vitest run <path>`. cdr-toolchain tests: `cd apps/cli && node --import tsx --test <path>`. Typecheck: redirect to a file, then `echo "exit=$?"`. Never read an exit code through a pipe.

---

### Task 1: CE warehouse migration 018 (`lab_requests.requester_*`)

**Files:**
- Create: `packages/db/src/migrations/external/018_lab_request_requester.ts`
- Create: `packages/db/src/migrations/external/018_lab_request_requester.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts` (import near line 19, entry near line 39)
- Modify: `packages/db/src/schema/external.ts` (`LabRequestsTable` lines 26-36; `EXTERNAL_TABLE_COLUMNS.lab_requests` line 209)

**Interfaces:**
- Produces: columns `lab_requests.requester_code`, `requester_system`, `requester_display` (`string | null` in `LabRequestsTable`).

- [ ] **Step 1: Check nobody else claims 018**

Run: `git branch -a --no-merged main` and, for each listed branch, `git diff --name-only main...<branch> -- packages/db/src/migrations/external`.
Expected: no branch adds a file starting `018_`. If one does, STOP and report.

- [ ] **Step 2: Write the failing test**

Create `packages/db/src/migrations/external/018_lab_request_requester.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { sql } from 'kysely';

describe('018_lab_request_requester', () => {
  it('round-trips the requesting facility on a lab request', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id, requester_code, requester_system, requester_display)
      values ('sr-1', 'TDS0012345', 'IBPAA', 'urn:openldr:default_fac', 'KCMC')`.execute(db);
    const rows = await sql<{ requester_code: string; requester_system: string; requester_display: string }>`
      select requester_code, requester_system, requester_display from lab_requests`.execute(db);
    expect(rows.rows).toEqual([{ requester_code: 'IBPAA', requester_system: 'urn:openldr:default_fac', requester_display: 'KCMC' }]);
  });

  it('leaves all three NULL when a request names no facility', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into lab_requests (id, request_id) values ('sr-2', 'TDS0012346')`.execute(db);
    const rows = await sql<{ requester_code: null; requester_system: null; requester_display: null }>`
      select requester_code, requester_system, requester_display from lab_requests`.execute(db);
    expect(rows.rows).toEqual([{ requester_code: null, requester_system: null, requester_display: null }]);
  });
});
```

- [ ] **Step 3: Run it and check it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations/external/018_lab_request_requester.test.ts`
Expected: FAIL, column `requester_code` does not exist.

- [ ] **Step 4: Write the migration**

Create `packages/db/src/migrations/external/018_lab_request_requester.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// The requesting facility of a lab request, from `ServiceRequest.requester`. Until slice B of the
// Mozambique work, cdr-toolchain sent the requesting clinic as `DiagnosticReport.performer`, so
// `diagnostic_reports.performer` held the clinic. From slice B it holds the testing laboratory and
// the clinic lands here. Same types as the `performer` trio on `diagnostic_reports` (migrations 010
// and 013). Spec: docs/superpowers/specs/2026-09-28-testing-lab-on-the-wire-design.md.
const COLUMNS = ['requester_code', 'requester_system', 'requester_display'] as const;

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  for (const col of COLUMNS) {
    await db.schema.alterTable('lab_requests').addColumn(col, text).execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const col of [...COLUMNS].reverse()) {
    await db.schema.alterTable('lab_requests').dropColumn(col).execute();
  }
}
```

- [ ] **Step 5: Register it**

In `packages/db/src/migrations/external/index.ts`, after the `m017` import add:

```ts
import * as m018 from './018_lab_request_requester';
```

and after the `'017_...'` entry add:

```ts
    '018_lab_request_requester': { up: (db) => m018.up(db, engine), down: m018.down },
```

- [ ] **Step 6: Update the schema types**

In `packages/db/src/schema/external.ts`, in `LabRequestsTable` after `authored_at: string | null;` add:

```ts
  /** The requesting facility from `ServiceRequest.requester` (migration 018): a contained
   *  `PractitionerRole`'s organization, or a direct facility reference. Null when the request names
   *  no facility, including a free-text clinician. */
  requester_code: string | null;
  requester_system: string | null;
  requester_display: string | null;
```

In `EXTERNAL_TABLE_COLUMNS.lab_requests`, insert `'requester_code', 'requester_system', 'requester_display'` directly after `'authored_at'`.

- [ ] **Step 7: Run the db package tests and typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/migrations src/schema > /tmp/t1.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. If a test pins the migration count or the column list, update it to include 018 and the three columns, and say so in the report.

Run: `pnpm --filter @openldr/db exec tsc --noEmit > /tmp/tc1.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/external/018_lab_request_requester.ts packages/db/src/migrations/external/018_lab_request_requester.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts
git commit -m "feat(db): add the requesting facility to lab requests"
```

---

### Task 2: CE projects the requesting facility

**Files:**
- Create: `packages/db/src/relational/requester.ts`
- Create: `packages/db/src/relational/requester.test.ts`
- Modify: `packages/db/src/relational/service-request.ts`
- Modify: the `@openldr/db` export surface so `projectServiceRequest` is importable from `@openldr/db`, the same way `projectDiagnosticReport` already is (find it with `grep -rn "projectDiagnosticReport" packages/db/src/index.ts packages/db/src/relational/index.ts`)
- Test: `packages/fhir/src/resources/service-request-requester.test.ts` (create)
- Test: `packages/workflows/src/engine/node-handlers/unwrap-bundle.test.ts` (append one test)

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `export function requesterFacility(r: Record<string, unknown>): { code: string | null; system: string | null; display: string | null }`; `projectServiceRequest` now returns `requester_code`, `requester_system`, `requester_display`; `projectServiceRequest` exported from `@openldr/db`.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/relational/requester.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { requesterFacility } from './requester';
import { projectServiceRequest } from './service-request';

const FAC = 'urn:openldr:default_fac';
const NONE = { code: null, system: null, display: null };

describe('requesterFacility', () => {
  it('reads the clinic from a contained PractitionerRole', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      contained: [{
        resourceType: 'PractitionerRole', id: 'requester',
        practitioner: { display: 'Dr Mushi' },
        organization: { identifier: { system: FAC, value: 'IBPAA' }, display: 'KCMC' },
      }],
      requester: { reference: '#requester' },
    };
    expect(requesterFacility(sr)).toEqual({ code: 'IBPAA', system: FAC, display: 'KCMC' });
  });

  it('reads a direct facility reference (corlix shape)', () => {
    const sr = { resourceType: 'ServiceRequest', requester: { identifier: { system: 'urn:mfl', value: '10123' }, display: 'Kibong\'oto' } };
    expect(requesterFacility(sr)).toEqual({ code: '10123', system: 'urn:mfl', display: 'Kibong\'oto' });
  });

  it('ignores a free-text clinician (CE lab-order form)', () => {
    expect(requesterFacility({ resourceType: 'ServiceRequest', requester: { display: 'Dr Mushi' } })).toEqual(NONE);
  });

  it('gives nulls for a contained PractitionerRole with no organization', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      contained: [{ resourceType: 'PractitionerRole', id: 'requester', practitioner: { display: 'Dr Mushi' } }],
      requester: { reference: '#requester' },
    };
    expect(requesterFacility(sr)).toEqual(NONE);
  });

  it('gives nulls when the # reference names nothing contained', () => {
    expect(requesterFacility({ resourceType: 'ServiceRequest', requester: { reference: '#missing' } })).toEqual(NONE);
  });

  it('gives nulls when the contained resource is not a PractitionerRole', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      contained: [{ resourceType: 'Organization', id: 'requester', identifier: [{ system: FAC, value: 'IBPAA' }] }],
      requester: { reference: '#requester' },
    };
    expect(requesterFacility(sr)).toEqual(NONE);
  });

  it('gives nulls with no requester', () => {
    expect(requesterFacility({ resourceType: 'ServiceRequest' })).toEqual(NONE);
  });
});

describe('projectServiceRequest requester columns', () => {
  it('writes the clinic into requester_code/system/display', () => {
    const row = projectServiceRequest({
      resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
      contained: [{ resourceType: 'PractitionerRole', id: 'requester', organization: { identifier: { system: FAC, value: 'IBPAA' }, display: 'KCMC' } }],
      requester: { reference: '#requester' },
    }, {});
    expect(row).toMatchObject({ requester_code: 'IBPAA', requester_system: FAC, requester_display: 'KCMC' });
  });
});
```

Create `packages/fhir/src/resources/service-request-requester.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';
import './index';

describe('ServiceRequest with a contained PractitionerRole requester', () => {
  it('validates', () => {
    const result = validateResource({
      resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order',
      subject: { reference: 'Patient/p1' },
      contained: [{
        resourceType: 'PractitionerRole', id: 'requester',
        practitioner: { display: 'Dr Mushi' },
        organization: { identifier: { system: 'urn:openldr:default_fac', value: 'IBPAA' }, display: 'KCMC' },
      }],
      requester: { reference: '#requester' },
    });
    expect(result.ok).toBe(true);
  });
});
```

If `validateResource` needs a different import to register resources, copy the import the existing `packages/fhir/src/resources/*.test.ts` files use.

Append to `packages/workflows/src/engine/node-handlers/unwrap-bundle.test.ts` a test that unwraps a transaction Bundle holding a `ServiceRequest` whose `requester` is `{ reference: '#requester' }` with a matching `contained` entry, and asserts the output `ServiceRequest`'s `requester.reference` is still `'#requester'` and `contained` is unchanged. Build it the way the file's existing tests build their Bundles, and call the handler the same way they do.

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @openldr/db exec vitest run src/relational/requester.test.ts`
Expected: FAIL, cannot find `./requester`.

Run the fhir and unwrap tests too. They may already pass: that is fine and says the schema and the unwrap node need no change. Record it.

- [ ] **Step 3: Write `requesterFacility`**

Create `packages/db/src/relational/requester.ts`:

```ts
import { str } from './extract';

type Json = Record<string, unknown>;

export interface RequesterFacility {
  code: string | null;
  system: string | null;
  display: string | null;
}

const NONE: RequesterFacility = { code: null, system: null, display: null };

/**
 * The requesting facility of a ServiceRequest, or all nulls.
 *
 * 1. `requester.reference` is `#<id>`: the contained resource with that id must be a
 *    `PractitionerRole`; its `organization` is the facility (cdr-toolchain's shape: the doctor and
 *    the clinic travel together).
 * 2. Otherwise `requester` itself must carry an `identifier` (corlix's shape: a logical reference
 *    to the facility).
 * 3. Anything else, such as CE's own lab-order form's free-text clinician, names no facility.
 */
export function requesterFacility(r: Json): RequesterFacility {
  const requester = r['requester'];
  if (typeof requester !== 'object' || requester === null) return NONE;
  const ref = str((requester as Json)['reference']);
  if (ref !== null && ref.startsWith('#')) {
    const id = ref.slice(1);
    const contained = Array.isArray(r['contained']) ? (r['contained'] as unknown[]) : [];
    const role = contained.find((c) => typeof c === 'object' && c !== null && (c as Json)['id'] === id) as Json | undefined;
    if (!role || role['resourceType'] !== 'PractitionerRole') return NONE;
    return fromFacilityReference(role['organization']);
  }
  return fromFacilityReference(requester);
}

function fromFacilityReference(v: unknown): RequesterFacility {
  if (typeof v !== 'object' || v === null) return NONE;
  const identifier = (v as Json)['identifier'];
  if (typeof identifier !== 'object' || identifier === null) return NONE;
  const code = str((identifier as Json)['value']);
  if (code === null || code === '') return NONE;
  return { code, system: str((identifier as Json)['system']), display: str((v as Json)['display']) };
}
```

- [ ] **Step 4: Use it in the projection**

In `packages/db/src/relational/service-request.ts`, import `requesterFacility` from `./requester`, and in the returned object after `authored_at: str(r['authoredOn']),` add:

```ts
    ...requesterColumns(requesterFacility(r)),
```

with, below the function:

```ts
function requesterColumns(f: { code: string | null; system: string | null; display: string | null }) {
  return { requester_code: f.code, requester_system: f.system, requester_display: f.display };
}
```

Export `projectServiceRequest` from `@openldr/db` the same way `projectDiagnosticReport` is exported.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @openldr/db exec vitest run src/relational > /tmp/t2.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `pnpm --filter @openldr/fhir exec vitest run src/resources/service-request-requester.test.ts` and `pnpm --filter @openldr/workflows exec vitest run src/engine/node-handlers/unwrap-bundle.test.ts`.
Expected: PASS.

Run `tsc --noEmit` for `@openldr/db` (redirect, echo exit). Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/relational/requester.ts packages/db/src/relational/requester.test.ts packages/db/src/relational/service-request.ts packages/fhir/src/resources/service-request-requester.test.ts packages/workflows/src/engine/node-handlers/unwrap-bundle.test.ts
git add <the @openldr/db export file you changed>
git commit -m "feat(db): project the requesting facility from ServiceRequest.requester"
```

---

### Task 3: CE reads facility codes from both roles

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts` (`scanObservedFacilities` query near line 176; `resolveObservedFacilities` query near line 482; `captureObservedFacilityFromProjection` near line 2006; imports near line 3)
- Modify: `packages/bootstrap/src/test-support/facility-reconcile-fixture.ts` (add `seedRequesters`)
- Test: `packages/bootstrap/src/facility-reconcile.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: Task 1 columns; Task 2 `projectServiceRequest` from `@openldr/db`.
- Produces: `readObservedFacilityRows(externalDb)` (module-private) returning rows shaped `{ performer, performer_display, performer_system, source_system, n }` from both tables; fixture `seedRequesters(deps, pairs, opts)`.

- [ ] **Step 1: Add the fixture helper**

In `packages/bootstrap/src/test-support/facility-reconcile-fixture.ts`, below `seedPerformers`, add:

```ts
/**
 * Inserts `lab_requests` rows carrying a requesting facility, one per unit of count. The clinic
 * side of the facility dimension (migration 018), mirroring `seedPerformers` for the lab side.
 */
export async function seedRequesters(
  deps: ReconcileDeps,
  pairs: [string, number][],
  opts: { sourceSystem?: string; requesterDisplay?: string | null; requesterSystem?: string | null } = {},
): Promise<void> {
  const sourceSystem = opts.sourceSystem ?? 'webhook-ingest';
  const rows: Record<string, unknown>[] = [];
  for (const [code, count] of pairs) {
    for (let i = 0; i < count; i += 1) {
      rows.push({
        id: `sr-${randomUUID()}`,
        requester_code: code,
        requester_display: opts.requesterDisplay ?? null,
        requester_system: opts.requesterSystem ?? null,
        source_system: sourceSystem,
      });
    }
  }
  if (rows.length === 0) return;
  await deps.externalDb.insertInto('lab_requests').values(rows as never).execute();
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/bootstrap/src/facility-reconcile.test.ts` (add `seedRequesters` to the fixture import, and `captureObservedFacilityFromProjection` is already imported):

```ts
describe('facility codes from both roles (slice B)', () => {
  const LAB = 'urn:openldr:default_lab';
  const FAC = 'urn:openldr:default_fac';

  it('resolves lab codes from performer and clinic codes from requester', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['TDS', 5]], { performerSystem: LAB, performerDisplay: 'Dar DISA lab' });
    await seedRequesters(deps, [['IBPAA', 3]], { requesterSystem: FAC, requesterDisplay: 'KCMC' });

    const rows = await resolveObservedFacilities(deps);

    expect(rows.map((r) => [r.observedSystem, r.sourceCode, r.sourceDisplay, r.reportCount]).sort()).toEqual([
      [FAC, 'IBPAA', 'KCMC', 3],
      [LAB, 'TDS', 'Dar DISA lab', 5],
    ]);
  });

  it('keeps a lab and a clinic that share a code apart', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['PAN', 2]], { performerSystem: LAB });
    await seedRequesters(deps, [['PAN', 4]], { requesterSystem: FAC });

    const rows = await resolveObservedFacilities(deps);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.observedSystem).sort()).toEqual([FAC, LAB]);
  });

  it('scan records clinic codes as concepts under their system', async () => {
    const deps = await makeReconcileDeps();
    await seedRequesters(deps, [['IBPAA', 3]], { requesterSystem: FAC });

    const result = await scanObservedFacilities(deps, { now: '2026-09-28T00:00:00.000Z', apply: true });

    expect(result.discovered).toBe(1);
    const { rows } = await deps.admin.terms.search(FAC, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['IBPAA']);
  });

  it('captures a clinic code at ingest from a ServiceRequest', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacilityFromProjection(deps, 'ServiceRequest', {
      resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
      contained: [{ resourceType: 'PractitionerRole', id: 'requester', organization: { identifier: { system: FAC, value: 'IBPAA' }, display: 'KCMC' } }],
      requester: { reference: '#requester' },
    }, 'webhook-ingest', '2026-09-28T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search(FAC, { limit: 10, offset: 0 });
    expect(rows.map((r) => [r.code, r.display])).toEqual([['IBPAA', 'KCMC']]);
  });

  it('does not capture a ServiceRequest with only a free-text clinician', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacilityFromProjection(deps, 'ServiceRequest', {
      resourceType: 'ServiceRequest', id: 'sr-2', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' },
      requester: { display: 'Dr Mushi' },
    }, 'webhook-ingest', '2026-09-28T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search(observedSystemForFeed('webhook-ingest'), { limit: 10, offset: 0 });
    expect(rows).toHaveLength(0);
  });
});
```

If `terms.search` on a system that was never registered throws instead of returning no rows, change the last assertion to check that no `terminology_concepts` row exists with `code = 'Dr Mushi'`, and say so in the report.

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t "both roles"`
Expected: FAIL. The clinic rows are missing, and the capture ignores `ServiceRequest`.

- [ ] **Step 4: Add the shared reader**

In `packages/bootstrap/src/facility-reconcile.ts`, above `scanObservedFacilities`, add:

```ts
/** One observed facility code group, whichever role it came from. The lab side reads
 *  `diagnostic_reports.performer*`; the clinic side reads `lab_requests.requester*` (migration 018,
 *  slice B). Both are returned under the `performer*` names every caller already folds, so the
 *  fold, the per-feed system rule and `facility_map` stay role-agnostic. A lab and a clinic sharing
 *  a code stay apart because they arrive under different systems. */
interface ObservedFacilityRow {
  performer: string | null;
  performer_display: string | null;
  performer_system: string | null;
  source_system: string | null;
  n: number | string | bigint;
}

async function readObservedFacilityRows(externalDb: Kysely<ExternalSchema>): Promise<ObservedFacilityRow[]> {
  const labs = await externalDb
    .selectFrom('diagnostic_reports')
    .select(({ fn }) => ['performer', 'performer_display', 'performer_system', 'source_system', fn.countAll<number>().as('n')])
    .where('performer', 'is not', null)
    .groupBy(['performer', 'performer_display', 'performer_system', 'source_system'])
    .execute();
  const clinics = await externalDb
    .selectFrom('lab_requests')
    .select(({ fn }) => [
      'requester_code as performer',
      'requester_display as performer_display',
      'requester_system as performer_system',
      'source_system',
      fn.countAll<number>().as('n'),
    ])
    .where('requester_code', 'is not', null)
    .groupBy(['requester_code', 'requester_display', 'requester_system', 'source_system'])
    .execute();
  return [...labs, ...clinics];
}
```

- [ ] **Step 5: Use it in scan and resolve**

In `scanObservedFacilities`, replace the `const observed = await deps.externalDb.selectFrom('diagnostic_reports')...execute();` statement with:

```ts
  const observed = await readObservedFacilityRows(deps.externalDb);
```

Do the same in `resolveObservedFacilities`. Leave every line after those statements unchanged. Update the doc comments on both functions that say the codes come from `diagnostic_reports` so they name both tables.

- [ ] **Step 6: Capture clinic codes at ingest**

In `captureObservedFacilityFromProjection`, replace the first line `if (resourceType !== 'DiagnosticReport') return;` with:

```ts
  if (resourceType === 'ServiceRequest') {
    const request = projectServiceRequest(resource, {});
    if (!request.requester_code) return;
    const system = resolvedObservedSystem(request.requester_system, sourceSystem);
    await captureObservedFacility(deps, system, request.requester_code, now, request.requester_display);
    return;
  }
  if (resourceType !== 'DiagnosticReport') return;
```

Add `projectServiceRequest` to the `@openldr/db` import on line 3. Update the function's doc comment: it now handles the clinic from `ServiceRequest` as well as the lab from `DiagnosticReport`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts src/facility-link-matching.test.ts src/facility-map-namespace.e2e.test.ts > /tmp/t3.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "observed" > /tmp/t3s.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. The route tests use pg-mem external dbs migrated to the latest, so `lab_requests` has the new columns.

Run `tsc --noEmit` for `@openldr/bootstrap` (redirect, echo exit). Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/test-support/facility-reconcile-fixture.ts
git commit -m "feat(facilities): read observed codes from the lab and the requesting clinic"
```

---

### Task 4: CE docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/facilities.md`, `fr/facilities.md`, `pt/facilities.md`
- Modify: `apps/web/src/docs/0.1.8/facilities.md`
- Modify: the studio and web docs page for reports (find it with `ls apps/studio/src/docs/0.1.8/en apps/web/src/docs/0.1.8 | grep -i report`), en, fr, pt for the studio

Check first for a newer docs version folder: `ls apps/studio/src/docs apps/web/src/docs`. Use the newest.

- [ ] **Step 1: Write the facilities text (English)**

In the Observed section of the English facilities doc (and the web doc), add:

```markdown
### Labs and clinics in the Observed list

The Observed list holds two kinds of code:

- **Testing laboratories.** The lab that ran each test, from each report.
- **Requesting facilities.** The clinic or hospital that sent the sample, from each order.

A lab and a clinic can use the same code. They stay separate rows, because each arrives under its
own coding system. Map each one to the right facility.

Data pushed by an older cdr-toolchain put the requesting clinic where the lab now goes. Re-push that
data to move each code to its correct role.
```

- [ ] **Step 2: Write the reports text (English)**

In the reports doc, add:

```markdown
### What "Facility" means in the built-in reports

The Facility picker and the facility columns in the built-in reports mean the **testing
laboratory**: the lab that ran the test. They do not group by the clinic that sent the sample.
```

- [ ] **Step 3: Translate**

Translate both sections into `fr` and `pt`. Use each language's existing wording for Observed, laboratory, facility and mapping, as its `facilities.md` and `apps/studio/src/i18n/{fr,pt}.ts` spell them. The web docs are English only.

- [ ] **Step 4: Check the docs**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs > /tmp/t4.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `git diff HEAD | grep "^+" | grep -c "—"`. Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs(facilities): labs and requesting clinics are separate roles"
```

---

### Task 5: cdr-toolchain site config carries the lab

**Files:**
- Modify: `apps/cli/src/export/site-config.ts`
- Modify: `apps/cli/src/export/v2-transform.ts` (the facility block near lines 310-373)
- Test: `apps/cli/src/export/site-config.test.ts` (create)
- Test: the existing v2-transform test that builds a full payload from a SpecimenRecpt fixture (find with `grep -ln "toV2(" apps/cli/src/export/*.test.ts`), append two tests

**Interfaces:**
- Produces:

```ts
export interface LabIdentity { code: string; name: string | null }
// SiteConfig gains:
lab_system_id: string;                 // "DEFAULT_LAB"
testing_facility: LabIdentity | null;  // null: unchanged behaviour
export const LAB_SYSTEM_ID = "DEFAULT_LAB";
export function siteWithLab(lab: LabIdentity | null): SiteConfig;
export function buildLabConcept(site: SiteConfig): V2ConceptCode | null;
```

- [ ] **Step 1: Create the cdr-toolchain worktree**

```bash
cd D:/Projects/Repositories/cdr-toolchain && git status --short && git branch --show-current
git worktree add .claude/worktrees/testing-lab-on-wire -b feat/testing-lab-on-wire main
cd .claude/worktrees/testing-lab-on-wire && pnpm install --frozen-lockfile --prefer-offline
```

If the main checkout is not on `main` or has uncommitted changes, STOP and report. Run a baseline: `cd apps/cli && node --import tsx --test src/export/fhir-transform.test.ts`; expect all pass.

- [ ] **Step 2: Write the failing tests**

Create `apps/cli/src/export/site-config.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SITE, LAB_SYSTEM_ID, siteWithLab, buildLabConcept } from "./site-config.js";

test("DEFAULT_SITE carries no lab", () => {
  assert.equal(DEFAULT_SITE.testing_facility, null);
  assert.equal(DEFAULT_SITE.lab_system_id, LAB_SYSTEM_ID);
  assert.equal(buildLabConcept(DEFAULT_SITE), null);
});

test("siteWithLab builds a lab concept under the lab system", () => {
  const site = siteWithLab({ code: "TDS", name: "Dar DISA lab" });
  assert.deepEqual(buildLabConcept(site), {
    system_id: "DEFAULT_LAB", concept_code: "TDS", display_name: "Dar DISA lab",
    concept_class: "facility", datatype: "coded",
  });
});

test("a lab with no name displays its code", () => {
  assert.equal(buildLabConcept(siteWithLab({ code: "TDS", name: null }))?.display_name, "TDS");
});

test("siteWithLab leaves every other system id as DEFAULT_SITE has it", () => {
  const { testing_facility: _t, ...rest } = siteWithLab({ code: "TDS", name: null });
  const { testing_facility: _d, ...base } = DEFAULT_SITE;
  assert.deepEqual(rest, base);
});
```

In the v2-transform test file, append:
- with `site: siteWithLab({ code: "TDS", name: null })`, every lab request's `testing_facility_code` is the lab concept (`system_id: "DEFAULT_LAB"`, `concept_code: "TDS"`) and `requesting_facility_code` is still the DISA facility concept;
- with `site: DEFAULT_SITE`, `testing_facility_code` deep-equals `requesting_facility_code` (today's behaviour).

Use the file's existing SpecimenRecpt fixture and `toV2` call.

- [ ] **Step 3: Run them and check they fail**

Run: `cd apps/cli && node --import tsx --test src/export/site-config.test.ts`
Expected: FAIL, `siteWithLab` is not exported.

- [ ] **Step 4: Implement the site config**

In `apps/cli/src/export/site-config.ts`, add to `SiteConfig`:

```ts
  /** Coding system for the testing laboratory's code. A separate code space from facilities:
   *  DISA lab codes (TDS, TMS) are not in LOCNDIC4, and in Mozambique 46 of 93 lab codes also
   *  appear as facility codes with other meanings. */
  lab_system_id: string;
  /** The laboratory this DISA installation is. DISA records no lab code, so it is configured per
   *  push (OPENLDR_LAB_CODE). Null keeps the old behaviour, where testing_facility_code repeats the
   *  requesting facility. */
  testing_facility: LabIdentity | null;
```

and above the interface:

```ts
import type { V2ConceptCode } from "./types.js";

export interface LabIdentity {
  code: string;
  name: string | null;
}

export const LAB_SYSTEM_ID = "DEFAULT_LAB";
```

Add to `DEFAULT_SITE`: `lab_system_id: LAB_SYSTEM_ID, testing_facility: null,`. Below it add:

```ts
export function siteWithLab(lab: LabIdentity | null): SiteConfig {
  return { ...DEFAULT_SITE, testing_facility: lab };
}

export function buildLabConcept(site: SiteConfig): V2ConceptCode | null {
  const lab = site.testing_facility;
  if (lab === null) return null;
  return {
    system_id: site.lab_system_id,
    concept_code: lab.code,
    display_name: lab.name ?? lab.code,
    concept_class: "facility",
    datatype: "coded",
  };
}
```

- [ ] **Step 5: Use it in toV2**

In `apps/cli/src/export/v2-transform.ts`, where the lab request object sets `testing_facility_code: facilityConcept,`, change it to:

```ts
    testing_facility_code: buildLabConcept(site) ?? facilityConcept,
```

`site` must be the `SiteConfig` passed to `toV2`. If the function building this object does not receive it yet, thread `opts.site` through as a parameter. Replace the comment block above `const requestingFacilityConcept = facilityConcept;` (the one ending "the lab is a property of the deployment, not of a record") with a short one saying: the requesting facility is DISA's Facility; the testing lab is the configured `site.testing_facility` when set (slice B, `2026-09-28-testing-lab-on-the-wire-design.md`), else the old fallback to the facility concept. Update the comment above `requesting_facility_code:` the same way.

- [ ] **Step 6: Run the tests and typecheck**

Run: `cd apps/cli && node --import tsx --test "src/export/**/*.test.ts" > /tmp/c5.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `pnpm --filter @cdr-toolchain/cli typecheck > /tmp/c5tc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. Any other `SiteConfig` literal that now misses the two fields gets them added.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/export/site-config.ts apps/cli/src/export/site-config.test.ts apps/cli/src/export/v2-transform.ts <the v2-transform test file>
git commit -m "feat(export): carry a configured testing lab in the site config"
```

---

### Task 6: cdr-toolchain FHIR shape (performer lab, contained requester)

**Files:**
- Modify: `apps/cli/src/export/fhir-transform.ts` (`requestResources` lines ~236-237; `organizationResource` ~line 330; the Organization loop ~line 573)
- Test: `apps/cli/src/export/fhir-transform.test.ts`
- Test: `apps/cli/src/export/fhir-conformance.test.ts` (extend a fixture)

**Interfaces:**
- Consumes: Task 5 `LAB_SYSTEM_ID`, lab concept in `testing_facility_code`.
- Produces: the wire shape in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Append to `apps/cli/src/export/fhir-transform.test.ts` (reuse `basePayload`, `findOne`, `TZ`):

```ts
const LAB = { system_id: "DEFAULT_LAB", concept_code: "TDS", display_name: "Dar DISA lab", concept_class: "facility", datatype: "coded" };
const CLINIC = { system_id: "DEFAULT_FAC", concept_code: "IBPAA", display_name: "KCMC", concept_class: "facility", datatype: "coded" };

function withFacilities(over: Record<string, unknown>) {
  const pl = basePayload();
  Object.assign(pl.lab_requests[0]!, over);
  return pl;
}

test("performer is the lab, under the lab system", () => {
  const dr = findOne(toFhir(withFacilities({ testing_facility_code: LAB, requesting_facility_code: CLINIC }), TZ), "DiagnosticReport");
  assert.deepEqual(dr.performer, [{ identifier: { system: "urn:openldr:default_lab", value: "TDS" }, display: "Dar DISA lab" }]);
});

test("the lab Organization is keyed lab-<code>, the clinic facility-<code>", () => {
  const orgs = toFhir(withFacilities({ testing_facility_code: LAB, requesting_facility_code: CLINIC }), TZ)
    .filter((r: any) => r.resourceType === "Organization").map((r: any) => r.id).sort();
  assert.deepEqual(orgs, ["facility-IBPAA", "lab-TDS"]);
});

test("a lab and a clinic sharing a code give two Organizations", () => {
  const lab = { ...LAB, concept_code: "PAN" };
  const clinic = { ...CLINIC, concept_code: "PAN" };
  const orgs = toFhir(withFacilities({ testing_facility_code: lab, requesting_facility_code: clinic }), TZ)
    .filter((r: any) => r.resourceType === "Organization").map((r: any) => r.id).sort();
  assert.deepEqual(orgs, ["facility-PAN", "lab-PAN"]);
});

test("requester is a contained PractitionerRole with the doctor and the clinic", () => {
  const sr = findOne(toFhir(withFacilities({ requesting_facility_code: CLINIC, requesting_doctor: "Dr Mushi" }), TZ), "ServiceRequest");
  assert.deepEqual(sr.requester, { reference: "#requester" });
  assert.deepEqual(sr.contained, [{
    resourceType: "PractitionerRole", id: "requester",
    practitioner: { display: "Dr Mushi" },
    organization: { identifier: { system: "urn:openldr:default_fac", value: "IBPAA" }, display: "KCMC" },
  }]);
});

test("no doctor: the PractitionerRole carries only the clinic", () => {
  const sr = findOne(toFhir(withFacilities({ requesting_facility_code: CLINIC }), TZ), "ServiceRequest");
  assert.equal("practitioner" in sr.contained[0], false);
  assert.equal(sr.contained[0].organization.identifier.value, "IBPAA");
});

test("no clinic: the PractitionerRole carries only the doctor", () => {
  const sr = findOne(toFhir(withFacilities({ requesting_doctor: "Dr Mushi" }), TZ), "ServiceRequest");
  assert.equal("organization" in sr.contained[0], false);
  assert.deepEqual(sr.contained[0].practitioner, { display: "Dr Mushi" });
});

test("neither: no contained and no requester", () => {
  const sr = findOne(toFhir(basePayload(), TZ), "ServiceRequest");
  assert.equal("contained" in sr, false);
  assert.equal("requester" in sr, false);
});

test("without a configured lab the clinic still becomes one Organization", () => {
  const orgs = toFhir(withFacilities({ testing_facility_code: CLINIC, requesting_facility_code: CLINIC }), TZ)
    .filter((r: any) => r.resourceType === "Organization").map((r: any) => r.id);
  assert.deepEqual(orgs, ["facility-IBPAA"]);
});
```

Existing tests in this file that assert the old `requester: { display }` shape, or an Organization count, will fail after the change. Update them to the new shape and list each one in the report. Do not delete a test to make it pass.

In `apps/cli/src/export/fhir-conformance.test.ts`, give one fixture a lab `testing_facility_code`, a clinic `requesting_facility_code` and a `requesting_doctor`, so the conformance run validates the contained `PractitionerRole`.

- [ ] **Step 2: Run them and check they fail**

Run: `cd apps/cli && node --import tsx --test src/export/fhir-transform.test.ts`
Expected: the Organization-id and requester tests FAIL. The performer test may already pass, because `performer` already follows the concept's `system_id`; record which ones passed before the change.

- [ ] **Step 3: Organization id per role**

Change `organizationResource(code: V2ConceptCode)` to take the id prefix:

```ts
function organizationResource(code: V2ConceptCode, idPrefix: "facility" | "lab"): FhirResource | undefined {
  const id = fhirId(`${idPrefix}-${code.concept_code}`);
```

and leave the rest of its body unchanged. Add above it:

```ts
/** A lab code and a clinic code are separate code spaces (site-config.ts LAB_SYSTEM_ID); the
 *  Organization id keeps them apart when they share a code. */
function organizationIdPrefix(code: V2ConceptCode): "facility" | "lab" {
  return code.system_id === LAB_SYSTEM_ID ? "lab" : "facility";
}
```

importing `LAB_SYSTEM_ID` from `./site-config.js`. Update the doc comment on `organizationResource`: it now serves the testing lab and the requesting facility.

- [ ] **Step 4: Emit both Organizations**

Replace the Organization loop (the `for (const lr of payload.lab_requests)` that reads `testing_facility_code`) with:

```ts
  const organizations = new Map<string, FhirResource>();
  for (const lr of payload.lab_requests) {
    for (const code of [lr.testing_facility_code, lr.requesting_facility_code]) {
      if (code === null) continue;
      const org = organizationResource(code, organizationIdPrefix(code));
      if (org === undefined) continue;
      organizations.set(org.id as string, org);
    }
  }
```

Update the comment above it: one Organization per distinct lab and clinic code; keyed on the id, so a clinic that is both testing and requesting facility (no configured lab) appears once.

- [ ] **Step 5: The contained requester**

In `requestResources`, replace:

```ts
    ...(fhirText(lr.requesting_doctor) !== undefined
      ? { requester: { display: fhirText(lr.requesting_doctor) } } : {}),
```

with:

```ts
    ...requesterFields(lr),
```

and add below `requestResources`:

```ts
/** The doctor and the requesting clinic travel together as a contained PractitionerRole: FHIR
 *  allows one requester, and PractitionerRole is its pairing of a practitioner with an
 *  organization. The clinic's identifier matches its Organization and CE's facility dimension.
 *  Spec: openldr_ce docs/superpowers/specs/2026-09-28-testing-lab-on-the-wire-design.md, 5.4. */
function requesterFields(lr: V2LabRequest): Record<string, unknown> {
  const doctor = fhirText(lr.requesting_doctor);
  const clinic = lr.requesting_facility_code;
  const clinicCode = clinic === null ? undefined : fhirText(clinic.concept_code);
  if (doctor === undefined && clinicCode === undefined) return {};
  const role = compact({
    resourceType: "PractitionerRole",
    id: "requester",
    ...(doctor !== undefined ? { practitioner: { display: doctor } } : {}),
    ...(clinicCode !== undefined
      ? {
          organization: compact({
            identifier: compact({ system: systemUri(clinic!.system_id), value: clinicCode }),
            display: fhirText(clinic!.display_name),
          }),
        }
      : {}),
  });
  return { contained: [role], requester: { reference: "#requester" } };
}
```

- [ ] **Step 6: Run the tests, conformance and typecheck**

Run: `cd apps/cli && node --import tsx --test "src/export/**/*.test.ts" > /tmp/c6.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `cd apps/cli && FHIR_CONFORMANCE=1 node --import tsx --test src/export/fhir-conformance.test.ts > /tmp/c6c.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. If the validator is unavailable offline, report that and the exact error.

Run: `pnpm --filter @cdr-toolchain/cli typecheck > /tmp/c6tc.txt 2>&1; echo "exit=$?"`. Expected: `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/export/fhir-transform.ts apps/cli/src/export/fhir-transform.test.ts apps/cli/src/export/fhir-conformance.test.ts
git commit -m "feat(export): send the lab as performer and the clinic with the doctor as requester"
```

---

### Task 7: cdr-toolchain settings, prefix check, push scripts

**Files:**
- Modify: `apps/cli/src/config.ts` (lines 37, 81, 122, 218 hold the `openldrCeTimezone` pattern to copy)
- Modify: `apps/cli/src/commands/export-batch.ts` (opts ~line 39; `BatchSummary` 138; `ProcessLabContext` 384; `DEFAULT_SITE` uses 567, 599, 731; `requireCeTimezone` ~822; options ~863; action ~908; tally ~1145; ctx ~1125; `makeSummary` ~969)
- Create: `apps/cli/src/commands/export-batch-lab.test.ts`
- Modify: `scripts/push-to-ce.sh`, `scripts/push-to-ce.ps1`, `scripts/.env.ce.example`
- Modify: `CDR_TOOLCHAIN.md` (where it documents `OPENLDR_CE_TIMEZONE`)

**Interfaces:**
- Consumes: Task 5 `siteWithLab`, `LabIdentity`.
- Produces: `export function requireLabCode(ceUrl: string | undefined, code: string | undefined): string | undefined`; `export function labNumberMatchesLab(labNumber: string, labCode: string): boolean`; summary fields `lab_prefix_mismatch: number | null`, `lab_prefix_mismatch_examples: string[]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/src/commands/export-batch-lab.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireLabCode, labNumberMatchesLab } from "./export-batch.js";

test("a lab code is required when the target is CE", () => {
  assert.throws(() => requireLabCode("http://localhost:3000", undefined), /OPENLDR_LAB_CODE/);
  assert.throws(() => requireLabCode("http://localhost:3000", "   "), /OPENLDR_LAB_CODE/);
});

test("a lab code is trimmed and returned for CE", () => {
  assert.equal(requireLabCode("http://localhost:3000", " TDS "), "TDS");
});

test("no CE target: the lab code is optional and passed through", () => {
  assert.equal(requireLabCode(undefined, undefined), undefined);
  assert.equal(requireLabCode(undefined, "TDS"), "TDS");
});

test("a lab number matches its lab by prefix, ignoring case and spaces", () => {
  assert.equal(labNumberMatchesLab("TDS0012345", "TDS"), true);
  assert.equal(labNumberMatchesLab(" tds0012345", "TDS"), true);
  assert.equal(labNumberMatchesLab("TMS0012345", "TDS"), false);
  assert.equal(labNumberMatchesLab("138-001001", "PCA"), false);
});
```

Look at `apps/cli/src/commands/export-batch.ce.test.ts` for how that file imports from `export-batch.js`, and copy it if the import differs.

- [ ] **Step 2: Run them and check they fail**

Run: `cd apps/cli && node --import tsx --test src/commands/export-batch-lab.test.ts`
Expected: FAIL, the functions are not exported.

- [ ] **Step 3: Config**

In `apps/cli/src/config.ts`, copy the four `openldrCeTimezone`/`OPENLDR_CE_TIMEZONE` lines for two new settings: `openldrLabCode` from `OPENLDR_LAB_CODE` and `openldrLabName` from `OPENLDR_LAB_NAME`, both optional strings.

- [ ] **Step 4: The two functions**

In `export-batch.ts`, below `requireCeTimezone`, add:

```ts
/** The testing laboratory this DISA installation is. DISA records no lab code, so a CE push must
 *  be told (spec 2026-09-28-testing-lab-on-the-wire, D2). Required with --ce-url, like the
 *  timezone. Without a CE target it is optional, and when absent the payload is unchanged. */
export function requireLabCode(ceUrl: string | undefined, code: string | undefined): string | undefined {
  const c = (code ?? "").trim();
  if (ceUrl !== undefined && ceUrl.length > 0 && c.length === 0) {
    throw new CliError(
      "CONFIG_MISSING",
      "A lab code is required when the target is OpenLDR CE. DISA records no lab code, so every report would be sent without its testing laboratory. Set OPENLDR_LAB_CODE or pass --lab-code, e.g. TDS.",
    );
  }
  return c.length > 0 ? c : undefined;
}

/** Whether a DISA lab number starts with the configured lab code. v1 derived the receiving lab
 *  from this prefix in Tanzania (3,437,966 of 3,437,966 rows), but nothing guarantees it for
 *  another country, so a mismatch is counted and reported, never refused. */
export function labNumberMatchesLab(labNumber: string, labCode: string): boolean {
  return labNumber.trim().toUpperCase().startsWith(labCode.trim().toUpperCase());
}
```

- [ ] **Step 5: Options, site and summary**

- Add to `ExportBatchOpts`: `labCode?: string; labName?: string;`.
- Add options after `--ce-tz`:

```ts
    .option("--lab-code <code>", "Code of the testing laboratory this DISA installation is, e.g. TDS. REQUIRED with --ce-url (overrides OPENLDR_LAB_CODE env)")
    .option("--lab-name <name>", "Display name of the testing laboratory (overrides OPENLDR_LAB_NAME env; default: the code)")
```

- In the action, directly after `const ceTz = requireCeTimezone(...)`:

```ts
      const labCode = requireLabCode(ceUrl, opts.labCode ?? config.openldrLabCode);
      const labNameRaw = (opts.labName ?? config.openldrLabName ?? "").trim();
      const site = siteWithLab(labCode === undefined ? null : { code: labCode, name: labNameRaw.length > 0 ? labNameRaw : null });
```

- Add `site: SiteConfig;` to `ProcessLabContext`, set `site` where `ctx` is built (~line 1125), and replace the three `site: DEFAULT_SITE,` uses in `processOneLab` with `site: ctx.site,`. Remove the `DEFAULT_SITE` import if it becomes unused; import `siteWithLab` and `type SiteConfig` from `../export/site-config.js`.
- Add to `BatchSummary`:

```ts
  /** Labs whose lab number does not start with the configured lab code. Null when no lab code is
   *  configured. Reported, never refused. */
  lab_prefix_mismatch: number | null;
  /** Up to five of those lab numbers. */
  lab_prefix_mismatch_examples: string[];
```

- Next to the other counters (~line 965) add `let labPrefixMismatch = 0; const labPrefixExamples: string[] = [];`. In `tally`, before the `switch`, add:

```ts
        if (labCode !== undefined && !labNumberMatchesLab(r.lab_number, labCode)) {
          labPrefixMismatch++;
          if (labPrefixExamples.length < 5) labPrefixExamples.push(r.lab_number);
        }
```

- In `makeSummary` add `lab_prefix_mismatch: labCode === undefined ? null : labPrefixMismatch, lab_prefix_mismatch_examples: labPrefixExamples,`.

- [ ] **Step 6: Push scripts and docs**

- `scripts/push-to-ce.sh`: next to `need OPENLDR_CE_TIMEZONE ...` (line 77) add `need OPENLDR_LAB_CODE "the testing laboratory this DISA installation is, e.g. TDS"`. Where `--ce-tz "$OPENLDR_CE_TIMEZONE"` is passed (lines 108 and 128), also pass `--lab-code "$OPENLDR_LAB_CODE"`, and `--lab-name "$OPENLDR_LAB_NAME"` only when that variable is set and non-empty.
- `scripts/push-to-ce.ps1`: the same, following its `Need 'OPENLDR_CE_TIMEZONE'` line (54) and argument line (77).
- `scripts/.env.ce.example`: add `OPENLDR_LAB_CODE=` with a comment ("the testing laboratory this DISA installation is, e.g. TDS; required") and `OPENLDR_LAB_NAME=` ("optional display name").
- `CDR_TOOLCHAIN.md`: where the CE settings are listed, add both, and one sentence on the prefix count in the run summary.

No em dashes in any of these.

- [ ] **Step 7: Run the tests and typecheck**

Run: `cd apps/cli && node --import tsx --test "src/commands/**/*.test.ts" "src/export/**/*.test.ts" > /tmp/c7.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Run: `pnpm --filter @cdr-toolchain/cli typecheck > /tmp/c7tc.txt 2>&1; echo "exit=$?"`. Expected: `exit=0`.

Run: `bash -n scripts/push-to-ce.sh; echo "exit=$?"`. Expected: `exit=0`.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/config.ts apps/cli/src/commands/export-batch.ts apps/cli/src/commands/export-batch-lab.test.ts scripts/push-to-ce.sh scripts/push-to-ce.ps1 scripts/.env.ce.example CDR_TOOLCHAIN.md
git commit -m "feat(export-batch): require the lab code for CE and report lab-number mismatches"
```

---

### Task 8: Gates, live check, merge (controller)

Run by the controller, not a subagent. Steps 1 to 4 run inside the worktrees and the local containers. Step 5 writes to the shared dev DB and merges CE, and step 6 merges cdr-toolchain: ask the operator before each of those.

- [ ] **Step 1: CE gate**

In the CE worktree: `pnpm turbo run test --force --concurrency=4 > /tmp/b-test.txt 2>&1; echo "exit=$?"` and `pnpm turbo run typecheck --force > /tmp/b-tc.txt 2>&1; echo "exit=$?"`. Expected: both `exit=0`. On failure grep `Test timed out` and re-run that package alone first.

- [ ] **Step 2: CE on three engines**

With the SQL Server and MySQL containers running: `pnpm mssql:accept`, `pnpm mysql:accept`, `pnpm reports:accept`. Expected: each exits 0. If a container is unavailable, record HONEST NON-PROOF for that engine.

- [ ] **Step 3: cdr-toolchain gate**

In the cdr worktree: `pnpm test > /tmp/cdr-test.txt 2>&1; echo "exit=$?"` and `pnpm typecheck > /tmp/cdr-tc.txt 2>&1; echo "exit=$?"`. Expected: both `exit=0`.

- [ ] **Step 4: Compare gate on a sample**

From the cdr worktree, with the local `sqlserver` container: run `export-batch --check` in dry-run mode on the deterministic spread `--where "abs(checksum([LabNo])) % 500 = 0"` with `--lab-code TDS`. Expected: `testing_facility_code` shows zero `mismatch`; rows v1 left empty show as v1-only. Record the counts.

- [ ] **Step 5: Merge CE, re-push, verify**

1. Merge CE `spec/testing-lab-on-wire` to local `main` (`--no-ff`); restart the dev API so migration 018 runs.
2. Push about 50 TDS labs from the cdr worktree with `--lab-code TDS` to the dev CE.
3. Check the warehouse:

```sql
select count(*) filter (where requester_code is not null) as with_clinic, count(*) from lab_requests where batch_id = '<this run>';
select performer, performer_system, count(*) from diagnostic_reports where batch_id = '<this run>' group by 1, 2;
```

Expected: every re-pushed request with a DISA facility has `requester_code`; `performer` is `TDS` under `urn:openldr:default_lab`.

4. `openldr facilities scan-observed --apply` then `publish --apply`; confirm `facility_map` has a `TDS` row under the lab system and clinic rows under the facility system.
5. Render the Clinical Microbiology report for one re-pushed lab and confirm "Performing lab" shows the lab.

- [ ] **Step 6: Merge cdr-toolchain, changelog**

Merge `feat/testing-lab-on-wire` into cdr-toolchain local `main`. In CE, `pnpm make:changelog` and commit. Push both only when the operator asks.
