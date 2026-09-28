# Link Matching Facility Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator link every observed facility code to the row in a chosen register that carries the same code, in one action, from the studio, the API and the CLI.

**Architecture:** One function in `@openldr/bootstrap` (`linkMatchingFacilityCodes`) reads the observed codes from the existing resolver, matches them exactly against one register, and writes ordinary SAME-AS rows through the existing `termMappings.saveExclusive`. A route and a CLI command call it. The studio opens a Sheet from the Observed tab's `⋯` menu. Nothing about how a facility resolves changes.

**Tech Stack:** TypeScript, Kysely, pg-mem (tests), Fastify, zod, commander, React, Radix/shadcn, i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-v1-facility-dictionary-design.md`

## Global Constraints

- Match is exact string equality. No trimming. No case folding.
- A code with ANY active `term_mappings` row (any map type) is `kept` and never written.
- Dry run by default on every door. `apply` writes.
- Apply writes all rows in one transaction, or none.
- Rows are written only through `deps.admin.termMappings.saveExclusive`, with `toSystem = FACILITY_REGISTRY_SYSTEM` and `mapType = 'SAME-AS'`.
- `toCode` comes from `registryConceptCodeById`, never from `facility_code` directly.
- Route and CLI enqueue `facility-map-rebuild` after an apply that linked at least one code, inside a try that logs and does not fail the request.
- Studio: actions in a `MoreHorizontal` `DropdownMenu`, a `Sheet` not a `Dialog`, labels left and inputs right, `TablePagination` on the table, `LoadingState` while loading, `StripedEmpty` when empty, shadcn components only.
- New i18n keys in en, fr and pt. A missing key renders as literal braces.
- New writing (docs, strings, commit messages) has no em dashes and no emoji. Short sentences.
- Never add a `Co-Authored-By` trailer.
- Work in this worktree: `D:/Projects/Repositories/openldr_ce/.claude/worktrees/v1-facility-dictionary`, branch `spec/v1-facility-dictionary`. Before every command, `cd` there and check `git branch --show-current` prints `spec/v1-facility-dictionary`.
- Per-package tests: `pnpm --filter <pkg> exec vitest run <path>`. Note: `pnpm --filter <pkg> test -- <path>` does NOT filter.
- Gate: `pnpm turbo run test --force` and `pnpm turbo run typecheck --force`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

---

### Task 1: Expose the mapping system on `ResolvedFacility`, and share the concept-code derivation

**Files:**
- Modify: `packages/bootstrap/src/facility-reconcile.ts` (interface `ResolvedFacility` near line 293; `resolveObservedFacilities` body near lines 649-652 and 746-750)
- Modify: `packages/bootstrap/src/index.ts:1813` (export list)
- Test: `packages/bootstrap/src/facility-reconcile.test.ts` (append two `describe` blocks)

**Interfaces:**
- Produces: `ResolvedFacility.observedSystem: string` (the system `term_mappings.from_system` must equal for this row to resolve).
- Produces: `export function registryConceptCodeById(registry: readonly { id: string; name: string; facility_code: string | null }[]): Map<string, string>` (registry id to the concept code a registry-route mapping must target).

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/facility-reconcile.test.ts`. Add `registryConceptCodeById` to the existing `./facility-reconcile` import on line 3.

```ts
describe('ResolvedFacility.observedSystem', () => {
  it('is the wire performer_system when the wire sends one', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['APHLO', 2]], { sourceSystem: 'cdr-ingest', performerSystem: 'urn:openldr:default_fac' });

    const rows = await resolveObservedFacilities(deps);

    expect(rows).toHaveLength(1);
    expect(rows[0].observedSystem).toBe('urn:openldr:default_fac');
  });

  it('falls back to the feed system when the wire sends none', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['APHLO', 2]], { sourceSystem: 'cdr-ingest' });

    const rows = await resolveObservedFacilities(deps);

    expect(rows[0].observedSystem).toBe(observedSystemForFeed('cdr-ingest'));
  });
});

describe('registryConceptCodeById', () => {
  it('uses the facility code when it is unique across the registry', () => {
    const codes = registryConceptCodeById([
      { id: 'fac-a', name: 'CS Micane', facility_code: 'MICAN' },
      { id: 'fac-b', name: 'CS Mumemo', facility_code: 'MUME' },
    ]);
    expect(codes.get('fac-a')).toBe('MICAN');
    expect(codes.get('fac-b')).toBe('MUME');
  });

  it('falls back to the row id when two registers share a code', () => {
    const codes = registryConceptCodeById([
      { id: 'fac-a', name: 'A', facility_code: 'X' },
      { id: 'fac-b', name: 'B', facility_code: 'X' },
    ]);
    expect(codes.get('fac-a')).toBe('fac-a');
    expect(codes.get('fac-b')).toBe('fac-b');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts -t "observedSystem|registryConceptCodeById"`
Expected: FAIL. `registryConceptCodeById` is not exported, and `observedSystem` is `undefined`.

- [ ] **Step 3: Add the helper**

In `packages/bootstrap/src/facility-reconcile.ts`, directly above `export async function resolveObservedFacilities`, add:

```ts
/**
 * The concept code each registry row projects as, keyed by registry id. A registry-route mapping
 * must target exactly this code or it will not resolve. Shared by `resolveObservedFacilities` and
 * `linkMatchingFacilityCodes` so the two can never derive it differently. A code two rows share
 * falls back to each row's own id (`registryConceptRows`).
 */
export function registryConceptCodeById(
  registry: readonly { id: string; name: string; facility_code: string | null }[],
): Map<string, string> {
  const concepts = registryConceptRows(
    registry.map((r): RegistryRowForConcept => ({ id: r.id, name: r.name, facilityCode: r.facility_code })),
  );
  return new Map(registry.map((r, i) => [r.id, concepts[i].code]));
}
```

- [ ] **Step 4: Use the helper inside `resolveObservedFacilities`**

Replace these lines (near 649-652):

```ts
  const registryConcepts = registryConceptRows(
    registry.map((r): RegistryRowForConcept => ({ id: r.id, name: r.name, facilityCode: r.facility_code })),
  );
  const byRegistryCode = new Map(registry.map((r, i) => [registryConcepts[i].code, r]));
```

with:

```ts
  const codeById = registryConceptCodeById(registry);
  const byRegistryCode = new Map(registry.map((r) => [codeById.get(r.id)!, r]));
```

- [ ] **Step 5: Add the field**

In `interface ResolvedFacility`, directly after `sourceCode: string;`, add:

```ts
  /** The coding system this row's mappings are keyed on: the wire's `performer_system` when it sent
   *  one, else the feed's own system (`observedSystemForFeed`). A mapping resolves this row only
   *  when its `from_system` equals this value. */
  observedSystem: string;
```

In the object `resolveObservedFacilities` returns (near line 746), directly after `sourceCode: r.code,`, add:

```ts
      observedSystem: r.system,
```

- [ ] **Step 6: Export the helper**

In `packages/bootstrap/src/index.ts:1813`, add `registryConceptCodeById` to the `export { ... } from './facility-reconcile';` list.

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-reconcile.test.ts`
Expected: PASS, the whole file (the refactor must not change existing resolution).

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit > /tmp/tc1.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. If a test fixture builds a `ResolvedFacility` literal and now fails, add `observedSystem` to it with the value that fixture's mappings use.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts packages/bootstrap/src/index.ts
git commit -m "refactor(facilities): expose the mapping system on a resolved facility"
```

---

### Task 2: `linkMatchingFacilityCodes` in `@openldr/bootstrap`

**Files:**
- Create: `packages/bootstrap/src/facility-link-matching.ts`
- Create: `packages/bootstrap/src/facility-link-matching.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export)

**Interfaces:**
- Consumes: `resolveObservedFacilities`, `ResolvedFacility.observedSystem`, `registryConceptCodeById`, `ReconcileDeps` (all from Task 1 / `./facility-reconcile`). `resolveFacilityRegisterForImport`, `createFacilityRegisterSourceStore`, `FACILITY_REGISTRY_SYSTEM` from `@openldr/db`.
- Produces:

```ts
export type LinkOutcome = 'linked' | 'already-linked' | 'kept' | 'no-match';
export interface LinkMatchingPair {
  observedSystem: string;
  code: string;
  sourceDisplay: string | null;
  reportCount: number;
  /** The register row the code matched. Null for `no-match`, and for `kept` with no match. */
  registryId: string | null;
  name: string | null;
  outcome: LinkOutcome;
}
export interface LinkMatchingResult {
  registerUrl: string;
  applied: boolean;
  counts: Record<LinkOutcome, number>;
  /** Sorted by reportCount descending, then code ascending. */
  pairs: LinkMatchingPair[];
}
export type LinkMatchingOutcome =
  | { ok: true; result: LinkMatchingResult }
  | { ok: false; reason: 'unknown-register' | 'deactivated-register'; error: string };
export function linkMatchingFacilityCodes(
  deps: ReconcileDeps,
  opts: { registerUrl: string; apply: boolean },
): Promise<LinkMatchingOutcome>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/facility-link-matching.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFacilityRegisterSourceStore, FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { linkMatchingFacilityCodes } from './facility-link-matching';
import { resolveObservedFacilities } from './facility-reconcile';
import { makeReconcileDeps, seedPerformers, seedRegistry, seedMapping } from './test-support/facility-reconcile-fixture';
import type { ReconcileDeps } from './facility-reconcile';

const MZ = 'urn:openldr:register:mz-disa';
const WIRE = 'urn:openldr:default_fac';

async function register(deps: ReconcileDeps, url = MZ, code = 'MZDISA'): Promise<void> {
  await createFacilityRegisterSourceStore(deps.internalDb).create({ url, name: `Register ${code}`, code });
}

async function activeMappings(deps: ReconcileDeps) {
  return deps.internalDb.selectFrom('term_mappings').selectAll().where('is_active', '=', true).execute();
}

describe('linkMatchingFacilityCodes', () => {
  it('refuses an unknown register', async () => {
    const deps = await makeReconcileDeps();
    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });
    expect(out).toMatchObject({ ok: false, reason: 'unknown-register' });
  });

  it('refuses a deactivated register', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await deps.internalDb.updateTable('coding_systems').set({ active: false }).where('url', '=', MZ).execute();
    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });
    expect(out).toMatchObject({ ok: false, reason: 'deactivated-register' });
  });

  it('dry run reports a match and a miss and writes nothing', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['MICAN', 5], ['ZZZZZ', 2]], { performerSystem: WIRE });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: false });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.applied).toBe(false);
    expect(out.result.counts).toEqual({ linked: 1, 'already-linked': 0, kept: 0, 'no-match': 1 });
    expect(out.result.pairs.map((p) => [p.code, p.outcome])).toEqual([['MICAN', 'linked'], ['ZZZZZ', 'no-match']]);
    expect(await activeMappings(deps)).toHaveLength(0);
  });

  it('apply writes a SAME-AS registry mapping that makes the code resolve', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN', region: 'Nampula', district: 'Nacala' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.applied).toBe(true);
    const rows = await activeMappings(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_system: WIRE, from_code: 'MICAN', to_system: FACILITY_REGISTRY_SYSTEM, map_type: 'SAME-AS' });
    const [resolved] = await resolveObservedFacilities(deps);
    expect(resolved).toMatchObject({ registryId: 'fac-mican', name: 'CS Micane', region: 'Nampula', resolvedVia: 'registry' });
  });

  it('does not match on a different case', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['mican', 1]], { performerSystem: WIRE });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: false });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.counts['no-match']).toBe(1);
  });

  it('keeps a code an operator already mapped elsewhere, and leaves that mapping alone', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedRegistry(deps, { id: 'fac-other', name: 'Other', localCode: 'OTH' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });
    await seedMapping(deps, { fromSystem: WIRE, fromCode: 'MICAN', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OTH' });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.counts.kept).toBe(1);
    const rows = await activeMappings(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0].to_code).toBe('OTH');
  });

  it('keeps a code that carries only a non-SAME-AS mapping', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });
    await seedMapping(deps, { fromSystem: WIRE, fromCode: 'MICAN', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'MICAN', mapType: 'UNMAPPED-FROM' });

    const out = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!out.ok) throw new Error(out.error);
    expect(out.result.counts.kept).toBe(1);
    expect((await activeMappings(deps)).filter((m) => m.map_type === 'SAME-AS')).toHaveLength(0);
  });

  it('reports already-linked and writes no second row on a re-run', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-mican', name: 'CS Micane', nationalSystem: MZ, nationalCode: 'MICAN' });
    await seedPerformers(deps, [['MICAN', 5]], { performerSystem: WIRE });

    await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });
    const second = await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    if (!second.ok) throw new Error(second.error);
    expect(second.result.counts).toEqual({ linked: 0, 'already-linked': 1, kept: 0, 'no-match': 0 });
    expect(await activeMappings(deps)).toHaveLength(1);
  });

  it('targets the fallback concept code when two registers share a code', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await register(deps, 'urn:openldr:register:other', 'OTHER');
    await seedRegistry(deps, { id: 'fac-mz', name: 'Moz row', nationalSystem: MZ, nationalCode: 'X1' });
    await seedRegistry(deps, { id: 'fac-ot', name: 'Other row', nationalSystem: 'urn:openldr:register:other', nationalCode: 'X1' });
    await seedPerformers(deps, [['X1', 3]], { performerSystem: WIRE });

    await linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true });

    const [resolved] = await resolveObservedFacilities(deps);
    expect(resolved.registryId).toBe('fac-mz');
  });

  it('writes nothing when a write fails part way', async () => {
    const deps = await makeReconcileDeps();
    await register(deps);
    await seedRegistry(deps, { id: 'fac-a', name: 'A', nationalSystem: MZ, nationalCode: 'AAAAA' });
    await seedRegistry(deps, { id: 'fac-b', name: 'B', nationalSystem: MZ, nationalCode: 'BBBBB' });
    await seedPerformers(deps, [['AAAAA', 5], ['BBBBB', 4]], { performerSystem: WIRE });
    const real = deps.admin.termMappings.saveExclusive.bind(deps.admin.termMappings);
    let calls = 0;
    vi.spyOn(deps.admin.termMappings, 'saveExclusive').mockImplementation(async (input, opts) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      return real(input, opts);
    });

    await expect(linkMatchingFacilityCodes(deps, { registerUrl: MZ, apply: true })).rejects.toThrow('boom');

    expect(await activeMappings(deps)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-link-matching.test.ts`
Expected: FAIL with "Cannot find module './facility-link-matching'".

- [ ] **Step 3: Write the implementation**

Create `packages/bootstrap/src/facility-link-matching.ts`:

```ts
import { createFacilityRegisterSourceStore, FACILITY_REGISTRY_SYSTEM, resolveFacilityRegisterForImport } from '@openldr/db';
import { registryConceptCodeById, resolveObservedFacilities, type ReconcileDeps } from './facility-reconcile';

// Links each observed facility code to the row in ONE register that carries exactly the same code.
// It writes the same SAME-AS registry mapping an operator writes by hand in the Observed tab, through
// the same writer, so resolution, the Observed tab, sync and audit all work unchanged. It never
// touches a code that already has any active mapping: that is a person's decision.
//
// Built for a register keyed on the feed's own codes (Mozambique's v1 dictionary is keyed on DISA
// facility codes). Spec: docs/superpowers/specs/2026-09-28-v1-facility-dictionary-design.md.

export type LinkOutcome = 'linked' | 'already-linked' | 'kept' | 'no-match';

export interface LinkMatchingPair {
  observedSystem: string;
  code: string;
  sourceDisplay: string | null;
  reportCount: number;
  /** The register row the code matched. Null for `no-match`, and for `kept` with no match. */
  registryId: string | null;
  name: string | null;
  outcome: LinkOutcome;
}

export interface LinkMatchingResult {
  registerUrl: string;
  applied: boolean;
  counts: Record<LinkOutcome, number>;
  /** Sorted by reportCount descending, then code ascending. */
  pairs: LinkMatchingPair[];
}

export type LinkMatchingOutcome =
  | { ok: true; result: LinkMatchingResult }
  | { ok: false; reason: 'unknown-register' | 'deactivated-register'; error: string };

export async function linkMatchingFacilityCodes(
  deps: ReconcileDeps,
  opts: { registerUrl: string; apply: boolean },
): Promise<LinkMatchingOutcome> {
  // The same gate, and the same two messages, as every import door.
  const gate = await resolveFacilityRegisterForImport(createFacilityRegisterSourceStore(deps.internalDb), opts.registerUrl);
  if (!gate.ok) return { ok: false, reason: gate.reason, error: gate.error };

  const observed = await resolveObservedFacilities(deps);

  // The WHOLE registry, not just this register: a code two registers share projects as each row's id,
  // and only a full view can see that collision (see `registryConceptCodeById`).
  const registry = await deps.internalDb
    .selectFrom('facility_registry')
    .select(['id', 'name', 'facility_code', 'facility_system'])
    .execute();
  const codeById = registryConceptCodeById(registry);
  const inRegister = new Map<string, { id: string; name: string }>();
  for (const r of registry) {
    if (r.facility_system === opts.registerUrl && r.facility_code !== null) inRegister.set(r.facility_code, r);
  }

  // ANY active mapping, of any map type. A non-SAME-AS row never resolves, but it is still an
  // operator's recorded decision and must not be overridden.
  const systems = [...new Set(observed.map((o) => o.observedSystem))];
  const mapped = new Set<string>();
  if (systems.length > 0) {
    const rows = await deps.internalDb
      .selectFrom('term_mappings')
      .select(['from_system', 'from_code'])
      .where('from_system', 'in', systems)
      .where('is_active', '=', true)
      .execute();
    for (const r of rows) mapped.add(`${r.from_system}\n${r.from_code}`);
  }

  const counts: Record<LinkOutcome, number> = { linked: 0, 'already-linked': 0, kept: 0, 'no-match': 0 };
  const pairs: LinkMatchingPair[] = observed.map((o) => {
    const match = inRegister.get(o.sourceCode) ?? null;
    let outcome: LinkOutcome;
    if (match && o.registryId === match.id) outcome = 'already-linked';
    else if (mapped.has(`${o.observedSystem}\n${o.sourceCode}`)) outcome = 'kept';
    else if (!match) outcome = 'no-match';
    else outcome = 'linked';
    counts[outcome] += 1;
    return {
      observedSystem: o.observedSystem,
      code: o.sourceCode,
      sourceDisplay: o.sourceDisplay,
      reportCount: o.reportCount,
      registryId: match?.id ?? null,
      name: match?.name ?? null,
      outcome,
    };
  });
  pairs.sort((a, b) => b.reportCount - a.reportCount || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const toLink = pairs.filter((p) => p.outcome === 'linked');
  if (opts.apply && toLink.length > 0) {
    // One transaction: every row lands or none does.
    await deps.internalDb.transaction().execute(async (trx) => {
      for (const p of toLink) {
        await deps.admin.termMappings.saveExclusive({
          fromSystem: p.observedSystem,
          fromCode: p.code,
          toSystem: FACILITY_REGISTRY_SYSTEM,
          toCode: codeById.get(p.registryId!)!,
          toDisplay: p.name,
          mapType: 'SAME-AS',
          isActive: true,
        }, { trx });
      }
    });
  }

  return { ok: true, result: { registerUrl: opts.registerUrl, applied: opts.apply, counts, pairs } };
}
```

- [ ] **Step 4: Export it**

In `packages/bootstrap/src/index.ts`, directly after the two `./facility-reconcile` export lines (near 1813-1814), add:

```ts
export { linkMatchingFacilityCodes } from './facility-link-matching';
export type { LinkOutcome, LinkMatchingPair, LinkMatchingResult, LinkMatchingOutcome } from './facility-link-matching';
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-link-matching.test.ts`
Expected: PASS, 10 tests.

If "writes nothing when a write fails part way" fails because pg-mem did not roll back, STOP and report it. Do not weaken the test. That would mean pg-mem cannot prove atomicity here, and the live check in Task 7 must prove it instead.

Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit > /tmp/tc2.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-link-matching.ts packages/bootstrap/src/facility-link-matching.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(facilities): link observed codes to a register's matching codes"
```

---

### Task 3: Route `POST /api/facilities/link-matching`

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (bootstrap import list near line 16; schema near line 746; route directly after `/api/facilities/publish` near line 1083)
- Test: `apps/server/src/facilities-routes.test.ts` (append a `describe`)
- Modify: `docs/HTTP-API.md` (add the route next to the other `/api/facilities` routes)

**Interfaces:**
- Consumes: `linkMatchingFacilityCodes`, `LinkMatchingResult` from `@openldr/bootstrap` (Task 2).
- Produces: `POST /api/facilities/link-matching`, body `{ registerUrl: string; apply?: boolean }`. 200 with `LinkMatchingResult`. 400 with `{ error }` on a bad body or a refused register. 403 without `facilities.manage`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/facilities-routes.test.ts`. `fakeReconcileCtx`, `appWith`, `seedObservedReports`, `makeMigratedDb`, `makeMigratedExternalDb`, `createFacilityRegistryStore` and `FACILITY_REGISTRY_SYSTEM` are already in this file or its imports; add `createFacilityRegisterSourceStore` to the `@openldr/db` import if it is not there.

```ts
describe('POST /api/facilities/link-matching', () => {
  const MZ = 'urn:openldr:register:mz-disa';

  async function setup() {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    await createFacilityRegisterSourceStore(internalDb).create({ url: MZ, name: 'Mozambique DISA facility codes', code: 'MZDISA' });
    await createFacilityRegistryStore(internalDb).upsert({ id: 'fac-mican', name: 'CS Micane', facilityCode: 'MICAN', facilitySystem: MZ, source: 'import' });
    await seedObservedReports(externalDb, [['MICAN', 5], ['ZZZZZ', 2]]);
    const ctx = fakeReconcileCtx(internalDb, externalDb);
    return { internalDb, ctx, app: await appWith(ctx) };
  }

  it('dry-runs by default: returns counts, writes nothing, does not audit', async () => {
    const { internalDb, ctx, app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/facilities/link-matching', payload: { registerUrl: MZ } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ registerUrl: MZ, applied: false, counts: { linked: 1, 'already-linked': 0, kept: 0, 'no-match': 1 } });
    expect(res.json().pairs[0]).toMatchObject({ code: 'MICAN', outcome: 'linked', registryId: 'fac-mican', name: 'CS Micane' });
    expect(await internalDb.selectFrom('term_mappings').selectAll().execute()).toHaveLength(0);
    expect(ctx.__audit).toHaveLength(0);
  });

  it('apply writes the mapping, audits counts only, and queues a facility map rebuild', async () => {
    const { internalDb, ctx, app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/facilities/link-matching', payload: { registerUrl: MZ, apply: true } });
    expect(res.statusCode).toBe(200);
    const rows = await internalDb.selectFrom('term_mappings').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_code: 'MICAN', to_system: FACILITY_REGISTRY_SYSTEM, map_type: 'SAME-AS' });
    expect(ctx.__audit).toHaveLength(1);
    expect(ctx.__audit[0]).toMatchObject({ action: 'facility.link-matching', entityId: `facility-register:${MZ}` });
    expect(ctx.__audit[0].metadata).toEqual({ registerUrl: MZ, counts: { linked: 1, 'already-linked': 0, kept: 0, 'no-match': 1 } });
    expect(await ctx.facilityJobs.latest('facility-map-rebuild')).not.toBeNull();
  });

  it('answers 400 with the import gate message for an unknown register', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/facilities/link-matching', payload: { registerUrl: 'urn:nope', apply: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/is not a known facility register/);
  });

  it('answers 400 without a registerUrl', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/facilities/link-matching', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('is gated on facilities.manage', async () => {
    const internalDb = await makeMigratedDb();
    const externalDb = await makeMigratedExternalDb();
    const app = await appWith(fakeReconcileCtx(internalDb, externalDb), ['facilities.view']);
    const res = await app.inject({ method: 'POST', url: '/api/facilities/link-matching', payload: { registerUrl: MZ } });
    expect(res.statusCode).toBe(403);
  });
});
```

Check how `fakeReconcileCtx`'s `audit.record` stores an event before relying on `ctx.__audit[0].action`: read `recordAudit` in `apps/server/src/audit-helper.ts` and adjust the two audit assertions to the shape it actually passes (for example `ctx.__audit[0].action` may sit under a nested key). Keep the assertions' meaning: one event, that action, counts-only metadata.

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "link-matching"`
Expected: FAIL with 404 on every request.

- [ ] **Step 3: Add the schema**

In `apps/server/src/facilities-routes.ts`, directly after `const PublishSchema = z.object({ ... });` (near line 746), add:

```ts
const LinkMatchingSchema = z.object({
  registerUrl: z.string().min(1),
  apply: z.boolean().optional(),
});
```

- [ ] **Step 4: Add the route**

Add `linkMatchingFacilityCodes` and `type LinkMatchingResult` to the `@openldr/bootstrap` import near line 16. Then, directly after the `/api/facilities/publish` route's closing `});`, add:

```ts
  // Link every observed code to the row in ONE register that carries the same code (spec
  // 2026-09-28-v1-facility-dictionary). Same dry-run-by-default contract as scan and publish.
  app.post('/api/facilities/link-matching', MANAGE, async (req, reply) => {
    const p = LinkMatchingSchema.safeParse(req.body ?? {});
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const outcome = await linkMatchingFacilityCodes(reconcileDeps(ctx), {
      registerUrl: p.data.registerUrl,
      apply: !!p.data.apply,
    });
    if (!outcome.ok) { reply.code(400); return { error: outcome.error }; }
    const result: LinkMatchingResult = outcome.result;

    // Same containment as the mapping routes (terminology-admin-routes.ts): the mappings are
    // committed, so a lost enqueue must not turn this into a 500. Logged, because a lost enqueue
    // leaves the report dimension stale.
    if (result.applied && result.counts.linked > 0) {
      try {
        await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorFromRequest(req).actorId });
      } catch (err) {
        ctx.logger.error({ err, registerUrl: p.data.registerUrl }, 'failed to enqueue a facility-map-rebuild job after linking matching facility codes');
      }
    }

    // Counts only. A national register can link thousands of codes, and each row is already
    // captured one by one for sync by `saveExclusive`.
    if (result.applied) {
      await recordAudit(ctx, req, {
        action: 'facility.link-matching',
        entityType: 'facility',
        entityId: `facility-register:${p.data.registerUrl}`,
        before: null,
        after: null,
        metadata: { registerUrl: p.data.registerUrl, counts: result.counts },
      });
    }
    return result;
  });
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "link-matching"`
Expected: PASS, 5 tests.

Run: `pnpm --filter @openldr/server exec eslint src/facilities-routes.ts > /tmp/lint3.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`. `apps/server` is the one package with real lint.

- [ ] **Step 6: Document the route**

In `docs/HTTP-API.md`, next to the other `/api/facilities` routes, add:

```markdown
### POST /api/facilities/link-matching

Links each observed facility code to the row in one register that has exactly the same code.
Needs `facilities.manage`. A dry run by default.

Body: `{ "registerUrl": "<register canonical URI>", "apply": false }`

Returns `{ registerUrl, applied, counts, pairs }`. `counts` has four keys: `linked`,
`already-linked`, `kept` (the code already has a mapping, which is left alone) and `no-match`.
Each pair gives `observedSystem`, `code`, `sourceDisplay`, `reportCount`, `registryId`, `name` and
`outcome`.

An unknown or deactivated register answers 400 with `{ "error": "..." }`. An applied run that
linked at least one code queues a facility map rebuild.
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts docs/HTTP-API.md
git commit -m "feat(server): route to link observed codes to a register's matching codes"
```

---

### Task 4: CLI `openldr facilities link-matching`

**Files:**
- Modify: `packages/cli/src/facilities.ts` (bootstrap import near line 5; new function after `runFacilitiesPublish`)
- Modify: `packages/cli/src/program.ts` (register after `publish`, near line 533)
- Test: `packages/cli/src/facilities.test.ts` (hoisted mocks near line 11, bootstrap mock factory near line 90, import near line 153, new `describe`)
- Modify: `docs/CLI-REFERENCE.md`

**Interfaces:**
- Consumes: `linkMatchingFacilityCodes`, `LinkMatchingResult` from `@openldr/bootstrap` (Task 2).
- Produces: `export async function runFacilitiesLinkMatching(opts: { register: string; apply?: boolean; json: boolean }): Promise<number>` (exit code).

- [ ] **Step 1: Wire the mock**

In `packages/cli/src/facilities.test.ts`:
- In `vi.hoisted`, next to `publishFacilityMap: vi.fn(),`, add `linkMatchingFacilityCodes: vi.fn(),`.
- In the `vi.mock('@openldr/bootstrap', ...)` return object, next to `publishFacilityMap: mocks.publishFacilityMap,`, add `linkMatchingFacilityCodes: mocks.linkMatchingFacilityCodes,`.
- Add `runFacilitiesLinkMatching` to the `./facilities` import list near line 153.

- [ ] **Step 2: Write the failing tests**

Append to `packages/cli/src/facilities.test.ts`:

```ts
describe('facilities link-matching CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;
  const MZ = 'urn:openldr:register:mz-disa';
  const RESULT = (applied: boolean) => ({
    registerUrl: MZ, applied,
    counts: { linked: 12, 'already-linked': 3, kept: 1, 'no-match': 40 },
    pairs: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-runs by default: prints counts, does not audit or enqueue', async () => {
    mocks.linkMatchingFacilityCodes.mockResolvedValue({ ok: true, result: RESULT(false) });

    const code = await runFacilitiesLinkMatching({ register: MZ, json: false });

    expect(code).toBe(0);
    expect(mocks.linkMatchingFacilityCodes).toHaveBeenCalledWith(RECONCILE_DEPS, { registerUrl: MZ, apply: false });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.ctx.facilityJobs.enqueue).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/12 would link/);
    expect(human).toMatch(/--apply/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('--apply audits counts and queues a facility map rebuild', async () => {
    mocks.linkMatchingFacilityCodes.mockResolvedValue({ ok: true, result: RESULT(true) });

    const code = await runFacilitiesLinkMatching({ register: MZ, apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.ctx.facilityJobs.enqueue).toHaveBeenCalledWith({ kind: 'facility-map-rebuild', requestedBy: 'cli' });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(mocks.ctx, expect.anything(), expect.objectContaining({
      action: 'facility.link-matching',
      entityId: `facility-register:${MZ}`,
      metadata: { registerUrl: MZ, counts: RESULT(true).counts },
    }));
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/linked 12/);
  });

  it('--json prints the result', async () => {
    mocks.linkMatchingFacilityCodes.mockResolvedValue({ ok: true, result: RESULT(false) });

    const code = await runFacilitiesLinkMatching({ register: MZ, json: true });

    expect(code).toBe(0);
    const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(JSON.parse(printed)).toMatchObject({ registerUrl: MZ, counts: { linked: 12 } });
  });

  it('exits 1 with the gate message for a refused register', async () => {
    mocks.linkMatchingFacilityCodes.mockResolvedValue({ ok: false, reason: 'unknown-register', error: '"urn:nope" is not a known facility register' });

    const code = await runFacilitiesLinkMatching({ register: 'urn:nope', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/is not a known facility register/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts -t "link-matching"`
Expected: FAIL with "runFacilitiesLinkMatching is not a function" or an import error.

- [ ] **Step 4: Write the implementation**

In `packages/cli/src/facilities.ts`, add `linkMatchingFacilityCodes` and `type LinkMatchingResult` to the `@openldr/bootstrap` import. Then, after `runFacilitiesPublish` and its formatter, add:

```ts
export interface FacilitiesLinkMatchingOpts {
  /** The register's canonical URI. */
  register: string;
  /** The caller opts IN to writing. Omitted or false means a dry run. */
  apply?: boolean;
  json: boolean;
}

/**
 * `openldr facilities link-matching --register <url> [--apply] [--json]`
 *
 * Links each observed facility code to the row in one register that has exactly the same code.
 * The same `@openldr/bootstrap` function `POST /api/facilities/link-matching` calls. Dry run by
 * default.
 */
export async function runFacilitiesLinkMatching(opts: FacilitiesLinkMatchingOpts): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const outcome = await linkMatchingFacilityCodes(reconcileDeps(ctx), { registerUrl: opts.register, apply: !!opts.apply });
    if (!outcome.ok) {
      if (opts.json) process.stdout.write(JSON.stringify({ error: outcome.error }) + '\n');
      else process.stderr.write(`facilities link-matching refused: ${outcome.error}\n`);
      return 1;
    }
    const result = outcome.result;

    if (result.applied && result.counts.linked > 0) {
      try {
        await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'cli' });
      } catch (err) {
        process.stderr.write(`warning: the mappings were written, but queueing the facility map rebuild failed: ${redactError(err)}. Run: openldr facilities publish --apply\n`);
      }
    }

    if (result.applied) {
      await recordAuditEvent(ctx, cliActor(), {
        action: 'facility.link-matching',
        entityType: 'facility',
        entityId: `facility-register:${opts.register}`,
        before: null,
        after: null,
        metadata: { registerUrl: opts.register, counts: result.counts },
      });
    }

    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else process.stdout.write(formatLinkMatchingHuman(result) + '\n');
    return 0;
  } catch (err) {
    const msg = redactError(err);
    if (opts.json) process.stdout.write(JSON.stringify({ error: msg }) + '\n');
    else process.stderr.write(`facilities link-matching failed: ${msg}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

function formatLinkMatchingHuman(result: LinkMatchingResult): string {
  const c = result.counts;
  const rest = `${c['already-linked']} already linked, ${c.kept} kept, ${c['no-match']} with no match`;
  return result.applied
    ? `linked ${c.linked}, ${rest}.`
    : `dry run: ${c.linked} would link, ${rest}. Nothing written. Pass --apply to write.`;
}
```

- [ ] **Step 5: Register the command**

In `packages/cli/src/program.ts`, add `runFacilitiesLinkMatching` to the `./facilities` import, and directly after the `publish` command's block add:

```ts
  facilities
    .command('link-matching')
    .description('Link observed facility codes to the rows in one register that have exactly the same code. Dry run by default. Pass --apply to write.')
    .requiredOption('--register <url>', 'canonical URI of the facility register to match against')
    .option('--apply', 'write the mappings (default: dry run, write nothing)', false)
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (opts: { register: string; apply: boolean; json: boolean }) => {
      process.exitCode = await runFacilitiesLinkMatching(opts);
    });
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts`
Expected: PASS, the whole file.

Run: `pnpm --filter @openldr/cli exec tsc --noEmit > /tmp/tc4.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 7: Document the command**

In `docs/CLI-REFERENCE.md`, in the facilities section, add:

```markdown
### openldr facilities link-matching

Links each observed facility code to the row in one register that has exactly the same code. Use
it after importing a facility list keyed on the codes your LIMS sends, such as a v1 facility
dictionary keyed on DISA codes.

    openldr facilities link-matching --register <url> [--apply] [--json]

A dry run by default. It reports four counts: codes it would link, codes already linked, codes
kept because they already have a mapping, and codes with no match. It never changes a code that
already has a mapping. With `--apply` it writes every link in one transaction and queues a
facility map rebuild. An unknown or deactivated register exits 1.
```

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/program.ts packages/cli/src/facilities.test.ts docs/CLI-REFERENCE.md
git commit -m "feat(cli): openldr facilities link-matching"
```

---

### Task 5: Studio Sheet from the Observed tab

**Files:**
- Modify: `apps/studio/src/api.ts` (after `publishFacilities`, near line 1827)
- Create: `apps/studio/src/facilities/LinkMatchingSheet.tsx`
- Create: `apps/studio/src/facilities/LinkMatchingSheet.test.tsx`
- Modify: `apps/studio/src/facilities/ObservedTab.tsx` (menu near line 295, state near line 128, render the sheet)
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts` (`facilities.observed` block)

**Interfaces:**
- Consumes: `POST /api/facilities/link-matching` (Task 3). `listFacilityImportSources(): Promise<FacilityRegisterSource[]>` (existing, `api.ts:1279`; each source has `url` and `name`).
- Produces: `linkMatchingFacilityCodes(body: { registerUrl: string; apply?: boolean }): Promise<LinkMatchingResult>` in `@/api`. `LinkMatchingSheet` with props `{ open: boolean; onOpenChange: (open: boolean) => void; onLinked: (result: LinkMatchingResult) => void }`.

- [ ] **Step 1: Add the API client**

In `apps/studio/src/api.ts`, directly after `publishFacilities`, add:

```ts
// Mirrors @openldr/bootstrap's LinkMatchingResult (packages/bootstrap/src/facility-link-matching.ts).
export type LinkOutcome = 'linked' | 'already-linked' | 'kept' | 'no-match';
export interface LinkMatchingPair {
  observedSystem: string; code: string; sourceDisplay: string | null; reportCount: number;
  registryId: string | null; name: string | null; outcome: LinkOutcome;
}
export interface LinkMatchingResult {
  registerUrl: string; applied: boolean; counts: Record<LinkOutcome, number>; pairs: LinkMatchingPair[];
}
export const linkMatchingFacilityCodes = (body: { registerUrl: string; apply?: boolean }): Promise<LinkMatchingResult> =>
  authFetch('/api/facilities/link-matching', jbody(body, 'POST')).then((r) => okJson<LinkMatchingResult>(r, 'link matching facility codes'));
```

- [ ] **Step 2: Add the strings**

In `apps/studio/src/i18n/en.ts`, inside `facilities.observed`, add:

```ts
      linkMatching: 'Link matching codes',
      linkMatchingDescription: 'Links each observed code to the facility in a register that has exactly the same code. Codes that already have a mapping are left as they are.',
      linkMatchingActions: 'Link actions',
      linkMatchingRegister: 'Register',
      linkMatchingRegisterPlaceholder: 'Choose a register',
      linkMatchingCounts: '{{linked}} to link, {{alreadyLinked}} already linked, {{kept}} kept, {{noMatch}} with no match.',
      linkMatchingApply_one: 'Link {{count}} code',
      linkMatchingApply_other: 'Link {{count}} codes',
      linkMatchingEmpty: 'No codes would be linked.',
      linkMatchingPickFirst: 'Choose a register to see which codes would be linked.',
      linkMatchingDone_one: 'Linked {{count}} code.',
      linkMatchingDone_other: 'Linked {{count}} codes.',
```

In `fr.ts`:

```ts
      linkMatching: 'Lier les codes correspondants',
      linkMatchingDescription: 'Lie chaque code observé à l’établissement d’un registre qui porte exactement le même code. Les codes déjà associés ne sont pas modifiés.',
      linkMatchingActions: 'Actions de liaison',
      linkMatchingRegister: 'Registre',
      linkMatchingRegisterPlaceholder: 'Choisir un registre',
      linkMatchingCounts: '{{linked}} à lier, {{alreadyLinked}} déjà liés, {{kept}} conservés, {{noMatch}} sans correspondance.',
      linkMatchingApply_one: 'Lier {{count}} code',
      linkMatchingApply_other: 'Lier {{count}} codes',
      linkMatchingEmpty: 'Aucun code ne serait lié.',
      linkMatchingPickFirst: 'Choisissez un registre pour voir quels codes seraient liés.',
      linkMatchingDone_one: '{{count}} code lié.',
      linkMatchingDone_other: '{{count}} codes liés.',
```

In `pt.ts`:

```ts
      linkMatching: 'Ligar códigos correspondentes',
      linkMatchingDescription: 'Liga cada código observado à unidade de um registo que tem exatamente o mesmo código. Os códigos que já têm um mapeamento ficam como estão.',
      linkMatchingActions: 'Ações de ligação',
      linkMatchingRegister: 'Registo',
      linkMatchingRegisterPlaceholder: 'Escolha um registo',
      linkMatchingCounts: '{{linked}} a ligar, {{alreadyLinked}} já ligados, {{kept}} mantidos, {{noMatch}} sem correspondência.',
      linkMatchingApply_one: 'Ligar {{count}} código',
      linkMatchingApply_other: 'Ligar {{count}} códigos',
      linkMatchingEmpty: 'Nenhum código seria ligado.',
      linkMatchingPickFirst: 'Escolha um registo para ver que códigos seriam ligados.',
      linkMatchingDone_one: '{{count}} código ligado.',
      linkMatchingDone_other: '{{count}} códigos ligados.',
```

Before writing fr and pt, read each file's existing `facilities.observed` block and match its word choices (for example how it translates "register" and "mapping"). Change the strings above to match. Consistency with the existing translation wins.

- [ ] **Step 3: Write the failing component test**

Create `apps/studio/src/facilities/LinkMatchingSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listFacilityImportSources: vi.fn(), linkMatchingFacilityCodes: vi.fn() };
});

import { listFacilityImportSources, linkMatchingFacilityCodes, type LinkMatchingResult } from '@/api';
import { LinkMatchingSheet } from './LinkMatchingSheet';

const MZ = 'urn:openldr:register:mz-disa';
const preview: LinkMatchingResult = {
  registerUrl: MZ, applied: false,
  counts: { linked: 1, 'already-linked': 2, kept: 0, 'no-match': 5 },
  pairs: [
    { observedSystem: 'urn:openldr:default_fac', code: 'MICAN', sourceDisplay: 'CS Micane', reportCount: 9, registryId: 'fac-mican', name: 'CS Micane', outcome: 'linked' },
    { observedSystem: 'urn:openldr:default_fac', code: 'ZZZZZ', sourceDisplay: null, reportCount: 1, registryId: null, name: null, outcome: 'no-match' },
  ],
};

function openMenu(trigger: HTMLElement, itemName: RegExp) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: itemName })) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('LinkMatchingSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFacilityImportSources as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: MZ, name: 'Mozambique DISA facility codes' }]);
  });

  it('asks for a register before previewing', async () => {
    render(<LinkMatchingSheet open onOpenChange={() => {}} onLinked={() => {}} />);
    expect(await screen.findByText(/choose a register to see/i)).toBeInTheDocument();
    expect(linkMatchingFacilityCodes).not.toHaveBeenCalled();
  });

  it('dry-runs on register choice, lists only codes to link, and applies from the menu', async () => {
    (linkMatchingFacilityCodes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce({ ...preview, applied: true });
    const onLinked = vi.fn();
    render(<LinkMatchingSheet open onOpenChange={() => {}} onLinked={onLinked} initialRegisterUrl={MZ} />);

    await waitFor(() => expect(linkMatchingFacilityCodes).toHaveBeenCalledWith({ registerUrl: MZ }));
    expect(await screen.findByText(/1 to link, 2 already linked/i)).toBeInTheDocument();
    expect(screen.getByText('MICAN')).toBeInTheDocument();
    expect(screen.queryByText('ZZZZZ')).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Link actions' });
    openMenu(trigger, /link 1 code/i);
    fireEvent.click(screen.getByRole('menuitem', { name: /link 1 code/i }));

    await waitFor(() => expect(linkMatchingFacilityCodes).toHaveBeenLastCalledWith({ registerUrl: MZ, apply: true }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ applied: true })));
  });

  it('shows the empty state and disables apply when nothing would link', async () => {
    (linkMatchingFacilityCodes as ReturnType<typeof vi.fn>).mockResolvedValue({ ...preview, counts: { linked: 0, 'already-linked': 2, kept: 0, 'no-match': 5 }, pairs: [] });
    render(<LinkMatchingSheet open onOpenChange={() => {}} onLinked={() => {}} initialRegisterUrl={MZ} />);

    expect(await screen.findByText(/no codes would be linked/i)).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Link actions' });
    openMenu(trigger, /link 0 codes/i);
    expect(screen.getByRole('menuitem', { name: /link 0 codes/i })).toHaveAttribute('data-disabled');
  });
});
```

`initialRegisterUrl` is a test-friendly prop: the Radix `Select` is hard to drive in jsdom. It is also useful in production: the sheet preselects when only one register exists.

- [ ] **Step 4: Run it and check it fails**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/LinkMatchingSheet.test.tsx`
Expected: FAIL with "Cannot find module './LinkMatchingSheet'".

- [ ] **Step 5: Write the component**

Create `apps/studio/src/facilities/LinkMatchingSheet.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  listFacilityImportSources, linkMatchingFacilityCodes,
  type FacilityRegisterSource, type LinkMatchingResult,
} from '@/api';

export interface LinkMatchingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: (result: LinkMatchingResult) => void;
  /** Preselects a register. Also set automatically when exactly one register exists. */
  initialRegisterUrl?: string;
}

export function LinkMatchingSheet({ open, onOpenChange, onLinked, initialRegisterUrl }: LinkMatchingSheetProps) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<FacilityRegisterSource[]>([]);
  const [registerUrl, setRegisterUrl] = useState(initialRegisterUrl ?? '');
  const [preview, setPreview] = useState<LinkMatchingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    if (!open) return;
    void listFacilityImportSources()
      .then((rows) => {
        setSources(rows);
        if (!initialRegisterUrl && rows.length === 1) setRegisterUrl(rows[0].url);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, initialRegisterUrl]);

  useEffect(() => {
    if (!open || registerUrl === '') { setPreview(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(0);
    linkMatchingFacilityCodes({ registerUrl })
      .then((r) => { if (!cancelled) setPreview(r); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, registerUrl]);

  const toLink = preview ? preview.pairs.filter((p) => p.outcome === 'linked') : [];
  const linkCount = preview?.counts.linked ?? 0;

  const apply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const result = await linkMatchingFacilityCodes({ registerUrl, apply: true });
      toast.success(t('facilities.observed.linkMatchingDone', { count: result.counts.linked }));
      onLinked(result);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [registerUrl, onLinked, onOpenChange, t]);

  const pageRows = toLink.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{t('facilities.observed.linkMatching')}</SheetTitle>
          <SheetDescription>{t('facilities.observed.linkMatchingDescription')}</SheetDescription>
        </SheetHeader>

        {/* The ⋯ menu sits in this row, not in SheetHeader, where SheetContent's close X covers it. */}
        <div className="flex items-center justify-between px-6 py-3">
          <span className="text-sm text-muted-foreground">
            {preview && t('facilities.observed.linkMatchingCounts', {
              linked: preview.counts.linked,
              alreadyLinked: preview.counts['already-linked'],
              kept: preview.counts.kept,
              noMatch: preview.counts['no-match'],
            })}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('facilities.observed.linkMatchingActions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={linkCount === 0 || applying || loading} onSelect={() => void apply()}>
                {t('facilities.observed.linkMatchingApply', { count: linkCount })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
          <Label htmlFor="link-matching-register" className="whitespace-nowrap">{t('facilities.observed.linkMatchingRegister')}</Label>
          <Select value={registerUrl} onValueChange={setRegisterUrl} disabled={sources.length === 0 || applying}>
            <SelectTrigger id="link-matching-register" className="w-full">
              <SelectValue placeholder={t('facilities.observed.linkMatchingRegisterPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => <SelectItem key={s.url} value={s.url}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="mx-6 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {registerUrl === '' ? (
            <StripedEmpty className="min-h-[16rem]">
              <span className="text-sm text-muted-foreground">{t('facilities.observed.linkMatchingPickFirst')}</span>
            </StripedEmpty>
          ) : loading ? (
            <LoadingState className="min-h-[16rem]" label={t('common.loading')} />
          ) : toLink.length === 0 ? (
            <StripedEmpty className="min-h-[16rem]">
              <span className="text-sm text-muted-foreground">{t('facilities.observed.linkMatchingEmpty')}</span>
            </StripedEmpty>
          ) : (
            <>
              <Table wrapperClassName="min-h-0 flex-1">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-6">{t('facilities.observed.code')}</TableHead>
                    <TableHead>{t('facilities.observed.resolvesTo')}</TableHead>
                    <TableHead className="text-right pr-6">{t('facilities.observed.reports')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((p) => (
                    <TableRow key={`${p.observedSystem}|${p.code}`}>
                      <TableCell className="px-6 font-mono text-xs">{p.code}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-right pr-6">{p.reportCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={toLink.length}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

Before running, check three things against the real components and adjust the code, not the test:
- `Table` accepts `wrapperClassName` (AGENTS.md §6 says it does). If not, read `components/ui/table.tsx` and use what it offers.
- `common.loading` exists in `en.ts` (ObservedTab uses it).
- `FacilityRegisterSource` has `url` and `name` (`api.ts:1241`).

- [ ] **Step 6: Run the component test and check it passes**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/LinkMatchingSheet.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 7: Add the menu item to the Observed tab**

In `apps/studio/src/facilities/ObservedTab.tsx`:

Add the import:

```tsx
import { LinkMatchingSheet } from './LinkMatchingSheet';
```

Next to `const [publishing, setPublishing] = useState(false);`, add:

```tsx
  const [linkOpen, setLinkOpen] = useState(false);
```

In the header `DropdownMenuContent`, after the Publish item, add:

```tsx
        <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
          {t('facilities.observed.linkMatching')}
        </DropdownMenuItem>
```

Directly before the component's final closing `</div>` of the returned tree, add:

```tsx
      {canManage && (
        <LinkMatchingSheet
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onLinked={(result) => {
            setActionResult(t('facilities.observed.linkMatchingDone', { count: result.counts.linked }));
            setPage(0);
            void reload({ background: true });
          }}
        />
      )}
```

Add `linkMatchingFacilityCodes: vi.fn()` and `listFacilityImportSources: vi.fn()` to the `vi.mock('@/api', ...)` return in `apps/studio/src/facilities/ObservedTab.test.tsx`, then add this test to its `describe`:

```tsx
  it('offers Link matching codes in the header ⋯ menu for a manage-capable actor', async () => {
    (listFacilityImportSources as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    show();
    await screen.findByText('Dodoma');

    const trigger = screen.getByRole('button', { name: 'Observed facility actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /link matching codes/i })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: /link matching codes/i }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/link matching codes/i);
  });
```

Add `listFacilityImportSources` to that test file's `@/api` import. `show()` is the file's existing render helper; if it has a different name, use the one the Scan test uses.

- [ ] **Step 8: Run the studio tests and check they pass**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/ObservedTab.test.tsx src/facilities/LinkMatchingSheet.test.tsx src/i18n`
Expected: PASS. The i18n parity test fails if a key is missing in fr or pt.

Run: `pnpm --filter @openldr/studio exec tsc --noEmit > /tmp/tc5.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 9: Check the sheet at phone width**

Start the dev stack as `.claude/launch.json` defines it (use `preview_start`, never Bash, for the dev server). If `preview_start` cannot serve a worktree (a known limit), say so and do this check in Task 7 after merge instead.

With a register and observed data present: open Facilities, then Observed, then `⋯`, then Link matching codes. `resize_window` to 375x812. Check that nothing scrolls sideways, the Select is full width, the `⋯` is reachable and not under the close X, and the table paginates. Take a screenshot.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/facilities/LinkMatchingSheet.tsx apps/studio/src/facilities/LinkMatchingSheet.test.tsx apps/studio/src/facilities/ObservedTab.tsx apps/studio/src/facilities/ObservedTab.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): link matching facility codes from the Observed tab"
```

---

### Task 6: User docs (studio en, fr, pt and web)

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/en/facilities.md`
- Modify: `apps/studio/src/docs/0.1.8/fr/facilities.md`
- Modify: `apps/studio/src/docs/0.1.8/pt/facilities.md`
- Modify: `apps/web/src/docs/0.1.8/facilities.md`

Check the newest version folder first: `ls apps/studio/src/docs apps/web/src/docs`. If a folder newer than `0.1.8` exists, write there instead.

- [ ] **Step 1: Write the English section**

Add this section to `apps/studio/src/docs/0.1.8/en/facilities.md`, after the Observed-tab material (or after "Filtering, sorting, and search" if there is no Observed section), and the same text to `apps/web/src/docs/0.1.8/facilities.md`:

````markdown
## Linking observed codes to a register in one step

Some facility lists use the same codes your LIMS sends. An OpenLDR v1 facility dictionary is one:
it is keyed on DISA facility codes. After you import such a list, you do not need to map each
observed code by hand.

1. Open Facilities, then Observed.
2. Open the `⋯` menu and choose **Link matching codes**.
3. Choose the register. The sheet shows what would happen, and writes nothing yet.
4. Open the sheet's `⋯` menu and choose **Link N codes**.

Every code falls into one of four groups:

- **To link.** The register has exactly this code, and nothing maps the code yet.
- **Already linked.** The code already resolves to that facility.
- **Kept.** The code already has a mapping. It is left as it is. Change it by hand if it is wrong.
- **No match.** The register has no row with this code.

The match is exact. `MICAN` does not match `mican` or `MICAN ` with a trailing space. All links
are written together, or none are. Reports pick up the new links after the facility map rebuild
that the action queues.

From the command line:

    openldr facilities link-matching --register <register URL>
    openldr facilities link-matching --register <register URL> --apply

### Example: a v1 facility dictionary (Mozambique)

Export the facility list from the v1 dictionary database. The `WHERE` leaves out provinces and
districts, which the table stores as rows with no facility type.

```sql
SELECT FacilityCode, Description, FacilityType, HFStatus, FacilityNationalCode,
       CountryName, ProvinceName, DistrictName
FROM dbo.viewFacilities
WHERE ISNULL(FacilityType, '') <> ''
```

Save the result as CSV with every column as text. Excel turns codes such as `01` into `1`, so do
not round-trip the file through Excel.

Create a register for it, for example "Mozambique DISA facility codes". Then import the CSV with
this column map:

| File column | Field |
|---|---|
| FacilityCode | Facility code |
| Description | Name |
| ProvinceName | Region |
| DistrictName | District |
| CountryName | Country |
| FacilityType | Level |
| HFStatus | Status |
| FacilityNationalCode | Keep as an extra field |

Map the province to Region, not Zone. Reports read region, district and council.

Then run **Link matching codes** against the new register.
````

Adjust the field names in the column map table to the exact labels the import wizard shows (read `en.ts` for the `facilities.import` field labels).

- [ ] **Step 2: Write the French and Portuguese sections**

Translate the same section into `fr/facilities.md` and `pt/facilities.md`. Use the wizard labels and menu strings exactly as `fr.ts` and `pt.ts` spell them, including the strings added in Task 5. Keep the SQL and the command lines unchanged.

- [ ] **Step 3: Check the docs render**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS (the docs validation and registry tests).

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs/0.1.8/en/facilities.md apps/studio/src/docs/0.1.8/fr/facilities.md apps/studio/src/docs/0.1.8/pt/facilities.md apps/web/src/docs/0.1.8/facilities.md
git commit -m "docs(facilities): link observed codes to a register in one step"
```

---

### Task 7: Gate, live check, merge, changelog

**Files:** none new. `apps/web/src/landing/changelog.json` after merge.

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --force --concurrency=4 > /tmp/gate-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/gate-tc.txt 2>&1; echo "exit=$?"
```

Expected: both `exit=0`. On a failure, grep `/tmp/gate-test.txt` for `Test timed out` and re-run that package alone before blaming this change.

- [ ] **Step 2: Live check against the dev CE with Tanzania data**

No Moz request data exists. Tanzania's v1 dictionary also uses DISA codes, so it proves the mechanism.

1. Start the dev stack. Confirm the dev DB holds CDR data: `select count(*) from diagnostic_reports where performer is not null` on the warehouse.
2. Export Tanzania's facility list from the `sqlserver` container (database `OpenLDRDict`) to CSV. Use the query from Task 6 without the `WHERE` first, and check how many rows have an empty `FacilityType`. Tanzania's data may use that column differently.
3. In the studio, create a register "Tanzania DISA facility codes (test)" and import the CSV with the Task 6 column map.
4. Run `openldr facilities link-matching --register <url>`. Record the four counts.
5. Run it again with `--apply`. Wait for the facility map rebuild job to finish (Facilities health chip, or `openldr facilities jobs`).
6. On the warehouse, compare the names:

```sql
select fm.source_code, fm.name as registry_name, min(dr.performer_display) as wire_name
from facility_map fm
join diagnostic_reports dr on dr.performer = fm.source_code
where fm.resolved_via = 'registry'
group by fm.source_code, fm.name
order by fm.source_code;
```

Expected: `registry_name` equals `wire_name` on the linked codes (both come from DISA's facility dictionary). List every mismatch in the report. Do not explain them away.

7. Record the apply time for the number of codes linked. If it took more than about a minute, say so. The route runs the writes inline.

Report the counts, the name comparison, and the timing. Write **HONEST NON-PROOF** for Moz coverage, which this does not measure.

- [ ] **Step 3: Merge to local main**

Only after the operator approves the live-check report:

```bash
cd D:/Projects/Repositories/openldr_ce
git checkout main
git merge --no-ff spec/v1-facility-dictionary -m "Merge branch 'spec/v1-facility-dictionary': link observed codes to a register's matching codes"
```

Stage and merge by exact branch name only. Another session may be using the main checkout.

- [ ] **Step 4: Regenerate the landing changelog**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after linking matching facility codes"
```

- [ ] **Step 5: Push only when the operator asks**

Then confirm the origin SHA: `git rev-parse origin/main`.
