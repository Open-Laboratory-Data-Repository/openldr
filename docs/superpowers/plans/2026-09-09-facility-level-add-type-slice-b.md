# Add a facility type to a register, Slice B, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator add a `level` value the vocabulary does not have yet, scoped to the register it came from, without touching the list every other register sees.

**Architecture:** An added concept goes into a per-register coding system. The register gets its own value set, created on the first add, composing the shared seeded set plus that system. Everything that expands a controlled field's value set stops reading a constant and asks `valueSetForField(field, nationalSystem)` instead.

**Tech Stack:** TypeScript, Kysely, Fastify + zod, React 18, Radix Dialog and Select, vitest, i18next, commander.

**Spec:** `docs/superpowers/specs/2026-09-09-facility-level-value-outcomes-design.md`

**Slice A shipped first** and is on `main` as of `c516bf31`. It added `Ignore this value` to the same pick list. Read `ValueMapRow.tsx` before touching it.

## Global Constraints

- Add is `level` ONLY, keyed on the row's target field, the same gate Slice A used for Ignore. Spec decision 6.
- The SHARED `urn:openldr:valueset:facility-type` is never modified. Migration 072 seeded it enumerating 63 concepts and it stays that way.
- A register's value set is `urn:openldr:valueset:facility-type:<slug>` with EXACTLY TWO include clauses. Within one clause the sets INTERSECT and only separate clauses union (`packages/db/src/value-set-expander.ts:69-73`). One clause naming both the imported set and the register's system expands to their intersection, which is empty.
- The register's own concepts live in `urn:openldr:cs:facility-type:local:<slug>`. The `local` segment is load-bearing: raw source values already live in `urn:openldr:cs:facility-level:<slug>`, which holds the opposite side of every mapping.
- `<slug>` is the register uri put through the SAME derivation `observedFieldSystem` already uses (`packages/bootstrap/src/facility-controlled-fields.ts:60-68`). Reuse it, never reimplement it.
- Adding needs `facilities.manage` AND `terminology.manage`. Spec decision 4.
- A display that normalises to a key already in the expansion is REFUSED, not warned. Adding it poisons that key and BOTH values silently degrade to "ask" (`facility-controlled-fields.ts:192`).
- The code is derived, never operator-typed: display lowercased, runs of non-alphanumeric characters to single hyphens, leading and trailing hyphens trimmed, and a numeric suffix if taken.
- The dialog's own actions go in a `⋯` `DropdownMenu` in a header row, NEVER a footer with Add/Cancel buttons. `RegisterSourceDialog.tsx` is the sibling to copy. AGENTS.md section 5.
- shadcn only. No native `select`, `button`, `input` or `dialog`.
- i18n keys land in en, fr AND pt together. `fr` and `pt` are typed against `en`, so a missing key fails typecheck, but a WRONG translation does not.
- Never pipe turbo through `tail`. Gate: `pnpm turbo run test --concurrency=2 --force`, redirected to a file.
- No `Co-Authored-By` trailers. Short sentences, plain nouns, no em dashes.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/bootstrap/src/facility-register-vocabulary.ts` (new) | Names the register's system and value set, creates them lazily, adds a concept, refuses a colliding display |
| `packages/bootstrap/src/facility-controlled-fields.ts` | Exports the slug helper; resolver expands `valueSetForField` |
| `packages/bootstrap/src/facility-value-mappings.ts` | Writer validates `toCode` against `valueSetForField` |
| `apps/server/src/facilities-routes.ts` | `suggest-values` takes `nationalSystem`; a new route adds a type behind two capabilities |
| `apps/studio/src/api.ts` | Both client calls |
| `apps/studio/src/facilities/AddFacilityTypeDialog.tsx` (new) | The confirm, with the derived code and the collision refusal |
| `apps/studio/src/facilities/ValueMapRow.tsx` | The `Add "<value>" as a new type` option, in Slice A's top section |
| `apps/studio/src/facilities/ColumnMapStep.tsx` | Opens the dialog, refreshes the row after an add |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | New keys |
| `packages/cli/src/facilities.ts`, `packages/cli/src/program.ts` | `facilities add-type` |
| `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`, `apps/web/src/docs/0.1.0/facilities.md` | Operator docs |

---

### Task 1: The register vocabulary module

**Files:**
- Create: `packages/bootstrap/src/facility-register-vocabulary.ts`
- Create: `packages/bootstrap/src/facility-register-vocabulary.test.ts`
- Modify: `packages/bootstrap/src/facility-controlled-fields.ts` (export the slug helper)
- Modify: `packages/bootstrap/src/index.ts` (export the new names)

**Interfaces:**
- Consumes: `observedFieldSystem`, `CONTROLLED_VALUE_SETS`, `normaliseControlledValue`, `ControlledField` from `./facility-controlled-fields`; `TerminologyAdminStore` from `@openldr/db`.
- Produces:
  - `registerSlug(nationalSystem: string): string`
  - `registerLocalSystem(nationalSystem: string): string`
  - `registerValueSetUrl(nationalSystem: string): string`
  - `valueSetForField(admin, field: ControlledField, nationalSystem: string): Promise<string>`
  - `addRegisterFacilityType(admin, input: { nationalSystem: string; display: string }): Promise<{ code: string; system: string; valueSetUrl: string }>`
  - `FacilityTypeCollisionError`, an Error subclass carrying `collidesWith: { code: string; display: string | null }`

- [ ] **Step 1: Export the slug derivation**

`observedFieldSystem` (`packages/bootstrap/src/facility-controlled-fields.ts:60-68`) computes the slug inline. Extract it so the new module reuses it rather than copying it:

```ts
/** The register uri as one path segment: non-alphanumeric runs to underscores, trimmed, lowercased,
 *  with a hash fallback for a uri that has no alphanumeric characters at all. Shared by
 *  `observedFieldSystem` and by the register-scoped vocabulary names, so the two can never disagree
 *  about what one register is called. */
export function registerSlug(nationalSystem: string): string {
  const trimmed = (nationalSystem ?? '').trim();
  const slug = trimmed
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return slug.length > 0 ? slug : djb2Hex(trimmed);
}
```

Then rewrite `observedFieldSystem`'s body to `return `${CONTROLLED_SYSTEM_PREFIX}${field}:${registerSlug(nationalSystem)}`;` and leave its docblock alone. Its existing tests must keep passing untouched; if any of them fails, you have changed the derivation, which is a defect.

- [ ] **Step 2: Write the failing tests**

Create `packages/bootstrap/src/facility-register-vocabulary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  registerLocalSystem, registerValueSetUrl, valueSetForField, addRegisterFacilityType,
  FacilityTypeCollisionError,
} from './facility-register-vocabulary';

const SYSTEM = 'urn:zmb:mfl';
const SHARED_VS = 'urn:openldr:valueset:facility-type';
const LOCAL_SYS = 'urn:openldr:cs:facility-type:local:urn_zmb_mfl';
const LOCAL_VS = 'urn:openldr:valueset:facility-type:urn_zmb_mfl';

/** `valueSets` maps url to the concepts its expansion yields. A url absent from it does not exist. */
function fakeAdmin(valueSets: Record<string, { code: string; display: string | null }[]> = {}) {
  const savedValueSets: any[] = [];
  const savedSystems: any[] = [];
  const createdTerms: any[] = [];
  return {
    savedValueSets, savedSystems, createdTerms, valueSetsByUrl: valueSets,
    valueSets: {
      getByUrl: async (url: string) => (url in valueSets ? { id: url, url } : null),
      expand: async (id: string) => ({ codes: (valueSets[id] ?? []).map((c) => ({ ...c, system: LOCAL_SYS })), total: 0 }),
      save: async (i: any) => { savedValueSets.push(i); valueSets[i.url] = valueSets[i.url] ?? []; return { id: i.url, ...i }; },
    },
    codingSystems: { upsertByUrl: async (i: any) => { savedSystems.push(i); } },
    terms: { create: async (i: any) => { createdTerms.push(i); return i; } },
  } as any;
}

describe('the register-scoped names', () => {
  it('puts a register\'s own concepts in a system the raw values cannot be confused with', () => {
    expect(registerLocalSystem(SYSTEM)).toBe(LOCAL_SYS);
    expect(registerValueSetUrl(SYSTEM)).toBe(LOCAL_VS);
  });
});

describe('valueSetForField', () => {
  it('uses the shared set for a register that has never added anything', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });
    expect(await valueSetForField(admin, 'level', SYSTEM)).toBe(SHARED_VS);
  });

  it('uses the register\'s own set once it exists', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [], [LOCAL_VS]: [] });
    expect(await valueSetForField(admin, 'level', SYSTEM)).toBe(LOCAL_VS);
  });

  // level is the only field that can grow a register set, so the other two never look for one.
  it('never looks for a register set for status or country', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });
    expect(await valueSetForField(admin, 'status', SYSTEM)).toBe('urn:openldr:valueset:location-status');
    expect(await valueSetForField(admin, 'country', SYSTEM)).toBe('urn:openldr:valueset:country');
  });
});

describe('addRegisterFacilityType', () => {
  it('creates the system, the value set and the concept on the first add', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });

    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(res).toEqual({ code: 'first-aid-stations', system: LOCAL_SYS, valueSetUrl: LOCAL_VS });
    expect(admin.savedSystems[0]).toMatchObject({ url: LOCAL_SYS });
    expect(admin.createdTerms[0]).toMatchObject({
      system: LOCAL_SYS, code: 'first-aid-stations', display: 'First-aid stations', status: 'ACTIVE',
    });
  });

  // ⛔ TWO CLAUSES. One clause naming both would expand to their intersection, which is empty.
  it('composes the register set as two include clauses, imported set and own system', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });

    await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(admin.savedValueSets[0].compose).toEqual({
      include: [{ valueSet: [SHARED_VS] }, { system: LOCAL_SYS }],
    });
  });

  it('does not rewrite the value set on a later add', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [], [LOCAL_VS]: [] });

    await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'First-aid stations' });

    expect(admin.savedValueSets).toEqual([]);
    expect(admin.createdTerms).toHaveLength(1);
  });

  it('derives the code and never lets the caller choose it', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });
    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: '  Optic   Clinics!! ' });
    expect(res.code).toBe('optic-clinics');
  });

  it('suffixes a code already taken in the register\'s own system', async () => {
    const admin = fakeAdmin({
      [SHARED_VS]: [],
      [LOCAL_VS]: [{ code: 'optic-clinics', display: 'Optic Clinics' }],
    });

    const res = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'Optic-Clinics' });

    expect(res.code).toBe('optic-clinics-2');
  });

  // ⛔ THE SILENT FAILURE THIS GUARD EXISTS FOR. Two concepts whose displays normalise alike poison
  // that key, and BOTH values stop resolving with no error anywhere.
  it('refuses a display that normalises onto one already in the list', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });

    await expect(addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'Health Centre' }))
      .rejects.toBeInstanceOf(FacilityTypeCollisionError);
  });

  it('names what it collided with, so the operator can map to it instead', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [{ code: 'health-center', display: 'Health Center' }] });

    const err = await addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: 'health centre' })
      .catch((e) => e as FacilityTypeCollisionError);

    expect(err.collidesWith).toEqual({ code: 'health-center', display: 'Health Center' });
  });

  it('refuses a display that is only punctuation, because it has no code', async () => {
    const admin = fakeAdmin({ [SHARED_VS]: [] });
    await expect(addRegisterFacilityType(admin, { nationalSystem: SYSTEM, display: '!!!' }))
      .rejects.toThrow(/needs at least one letter or digit/i);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-register-vocabulary.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write the module**

Create `packages/bootstrap/src/facility-register-vocabulary.ts`:

```ts
import type { TerminologyAdminStore } from '@openldr/db';
import {
  CONTROLLED_VALUE_SETS, normaliseControlledValue, registerSlug, type ControlledField,
} from './facility-controlled-fields';

/** Where a register's OWN facility types live.
 *
 *  ⛔ THE `local` SEGMENT IS LOAD-BEARING. Raw source values already live in
 *  `urn:openldr:cs:facility-level:<slug>`, which holds the opposite side of every mapping. A
 *  canonical system named `urn:openldr:cs:facility-type:<slug>` would sit one word from it. */
export const registerLocalSystem = (nationalSystem: string): string =>
  `urn:openldr:cs:facility-type:local:${registerSlug(nationalSystem)}`;

/** A display whose normalised form already names a concept in the list. Adding it would poison that
 *  key and BOTH values would stop resolving, with no error anywhere. Carries what it hit so the
 *  operator can be offered that concept instead. */
export class FacilityTypeCollisionError extends Error {
  constructor(public readonly collidesWith: { code: string; display: string | null }) {
    super(`"${collidesWith.display ?? collidesWith.code}" is already in this list`);
    this.name = 'FacilityTypeCollisionError';
  }
}

/** Which list this field's values are checked against, for THIS register.
 *
 *  ⛔ A LOOKUP, NOT A CONSTANT, and every caller that used to read `CONTROLLED_VALUE_SETS[field]`
 *  to expand a value set must come through here. A register that has never added anything gets the
 *  shared set and behaves exactly as it did before Slice B, so no install grows an empty value set. */
⛔ THIS ONE GOES IN `facility-controlled-fields.ts`, NOT HERE, and is re-exported from this module.
Task 2 needs `facility-controlled-fields.ts` to call it, and this module already imports that file,
so declaring it here would be an import cycle. Same shape Slice A used for `FACILITY_IGNORE_MAP_TYPE`.
Put this in `packages/bootstrap/src/facility-controlled-fields.ts`, and note it needs
`registerValueSetUrl`, so move that one there too and re-export BOTH from this module:

```ts
export async function valueSetForField(
  admin: TerminologyAdminStore,
  field: ControlledField,
  nationalSystem: string,
): Promise<string> {
  if (field !== 'level') return CONTROLLED_VALUE_SETS[field];
  const url = registerValueSetUrl(nationalSystem);
  const existing = await admin.valueSets.getByUrl(url);
  return existing ? url : CONTROLLED_VALUE_SETS.level;
}
```

Then in `facility-register-vocabulary.ts`:

```ts
export { registerValueSetUrl, valueSetForField } from './facility-controlled-fields';
```

Task 1's tests import both from `facility-register-vocabulary`, which the re-export satisfies.

/** The code for a display: lowercase, non-alphanumeric runs to single hyphens, ends trimmed. */
function codeFor(display: string): string {
  return display.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Add one facility type to a register's own list, creating the system and the value set the first
 *  time. Returns the code it minted.
 *
 *  ⛔ THE SHARED VALUE SET IS NEVER TOUCHED. Migration 072 seeded
 *  `urn:openldr:valueset:facility-type` enumerating its 63 concepts and it stays that way. The
 *  register's set IMPORTS it and adds its own system beside it.
 *
 *  ⛔ TWO INCLUDE CLAUSES, NOT ONE. Within a single clause the sets INTERSECT and only separate
 *  clauses union (`packages/db/src/value-set-expander.ts:69-73`), so one clause naming both the
 *  imported set and this system would expand to their intersection, which is empty. The second
 *  clause names the system with no `concept` and no `filter`, which expands to everything in it
 *  (`value-set-expander.ts:62`), so a later add is one insert and this compose never changes again. */
export async function addRegisterFacilityType(
  admin: TerminologyAdminStore,
  input: { nationalSystem: string; display: string },
): Promise<{ code: string; system: string; valueSetUrl: string }> {
  const display = input.display.trim();
  const base = codeFor(display);
  if (!base) throw new Error('a facility type needs at least one letter or digit');

  const system = registerLocalSystem(input.nationalSystem);
  const valueSetUrl = registerValueSetUrl(input.nationalSystem);

  // Read the list the operator is actually looking at, which is the register's own once it exists.
  const currentUrl = await valueSetForField(admin, 'level', input.nationalSystem);
  const current = await admin.valueSets.getByUrl(currentUrl);
  const codes = current ? (await admin.valueSets.expand(current.id)).codes : [];

  const key = normaliseControlledValue(display);
  for (const c of codes) {
    if (normaliseControlledValue(c.code) === key
      || (c.display && normaliseControlledValue(c.display) === key)) {
      throw new FacilityTypeCollisionError({ code: c.code, display: c.display ?? null });
    }
  }

  // A code already taken is not a collision: two different types can share a slug without their
  // displays normalising alike. Suffix rather than refuse.
  const taken = new Set(codes.map((c) => c.code));
  let code = base;
  for (let n = 2; taken.has(code); n += 1) code = `${base}-${n}`;

  if (!(await admin.valueSets.getByUrl(valueSetUrl))) {
    await admin.codingSystems.upsertByUrl({
      systemCode: `FAC-TYPE-LOCAL-${registerSlug(input.nationalSystem).toUpperCase()}`,
      systemName: `Facility types added for ${input.nationalSystem}`,
      url: system,
      systemVersion: null,
      publisherId: 'pub-system',
    });
    await admin.valueSets.save({
      url: valueSetUrl,
      name: `facility-type-${registerSlug(input.nationalSystem)}`,
      title: `Facility Type (${input.nationalSystem})`,
      status: 'active',
      compose: { include: [{ valueSet: [CONTROLLED_VALUE_SETS.level] }, { system }] },
    });
  }

  await admin.terms.create({ system, code, display, status: 'ACTIVE' });
  return { code, system, valueSetUrl };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-register-vocabulary.test.ts`
Expected: PASS.

- [ ] **Step 6: Export the new names**

Add to `packages/bootstrap/src/index.ts`, beside the existing `CONTROLLED_VALUE_SETS` export line:

```ts
  registerLocalSystem, registerValueSetUrl, valueSetForField, addRegisterFacilityType,
  FacilityTypeCollisionError,
```

Also export `registerSlug` from `facility-controlled-fields` there if that file's exports are enumerated rather than re-exported wholesale.

- [ ] **Step 7: Run the whole package and typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run`
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit -p tsconfig.json`
Expected: PASS and clean. `observedFieldSystem`'s own tests prove step 1's extraction changed no derivation.

- [ ] **Step 8: Commit**

```bash
git add packages/bootstrap/src
git commit -m "feat(facilities): a register can carry its own facility types"
```

---

### Task 2: The resolver and the writer read the register's list

**Files:**
- Modify: `packages/bootstrap/src/facility-controlled-fields.ts:161`
- Modify: `packages/bootstrap/src/facility-value-mappings.ts:85`
- Test: `packages/bootstrap/src/facility-controlled-fields.test.ts`, `packages/bootstrap/src/facility-value-mappings.test.ts`

**Interfaces:**
- Consumes: `valueSetForField(admin, field, nationalSystem)` from Task 1.
- Produces: nothing new. Both functions keep their signatures; both already receive `nationalSystem`.

⛔ `facility-controlled-fields.ts` cannot import `facility-register-vocabulary.ts`, because that module imports IT. Move `valueSetForField` into `facility-controlled-fields.ts` beside `CONTROLLED_VALUE_SETS` and re-export it from `facility-register-vocabulary.ts`, exactly as Slice A did with `FACILITY_IGNORE_MAP_TYPE`. Task 1's tests import it from `facility-register-vocabulary`, so the re-export keeps them passing.

- [ ] **Step 1: Write the failing tests**

In `packages/bootstrap/src/facility-controlled-fields.test.ts`:

```ts
it('checks values against the register\'s own list once it has one', async () => {
  const admin = fakeAdmin({
    valueSets: {
      'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }],
      'urn:openldr:valueset:facility-type:urn_tz_hfr': [
        { code: 'health-center', display: 'Health Center' },
        { code: 'first-aid-stations', display: 'First-aid stations' },
      ],
    },
  });

  const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'First-aid stations' })]);

  // Resolved through the register's own concept, so it is neither unmapped nor rewritten.
  expect(res.unmapped.level).toEqual([]);
});

it('falls back to the shared list for a register that has added nothing', async () => {
  const admin = fakeAdmin({
    valueSets: { 'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }] },
  });

  const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'First-aid stations' })]);

  expect(res.unmapped.level).toEqual(['First-aid stations']);
});
```

In `packages/bootstrap/src/facility-value-mappings.test.ts`:

```ts
it('accepts a toCode that only the register\'s own list carries', async () => {
  const admin = fakeAdmin({}, {
    'urn:openldr:valueset:facility-type:urn_zmb_mfl': [
      { system: 'urn:openldr:cs:facility-type:local:urn_zmb_mfl', code: 'first-aid-stations', display: 'First-aid stations' },
    ],
  });

  const res = await saveFacilityValueMappings(admin, SYSTEM, [
    { field: 'level', rawValue: 'FAS', toCode: 'first-aid-stations' },
  ]);

  expect(res.written).toBe(1);
  expect(admin.saved[0]).toMatchObject({
    toSystem: 'urn:openldr:cs:facility-type:local:urn_zmb_mfl', toCode: 'first-aid-stations',
  });
});
```

⛔ THE TWO FAKES ARE NOT THE SAME SHAPE, so widen them differently and read each before touching it.

`facility-controlled-fields.test.ts`'s `fakeAdmin({ valueSets, mappings })` already takes its value
sets as an argument, so the first test above needs no change to it at all.

`facility-value-mappings.test.ts`'s `fakeAdmin(mappings)` resolves from a MODULE-LEVEL `EXPANSIONS`
const (that file, around line 15) and takes no value-set argument. Give it a SECOND optional
argument, merged over `EXPANSIONS`, which is the shape the test above uses:

```ts
function fakeAdmin(
  mappings: Record<string, any[]> = {},
  extraExpansions: Record<string, { system: string; code: string; display: string }[]> = {},
) {
  const expansions = { ...EXPANSIONS, ...extraExpansions };
  // ... unchanged, except getByUrl and expand read `expansions` instead of `EXPANSIONS`
}
```

Every pre-existing call passes at most one argument and keeps working. Do not add a second fake.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/facility-controlled-fields.test.ts src/facility-value-mappings.test.ts`
Expected: FAIL. Both read `CONTROLLED_VALUE_SETS[field]` and never see the register's set.

- [ ] **Step 3: Replace both lookups**

In `packages/bootstrap/src/facility-controlled-fields.ts`, inside `resolveControlledFields`, replace:

```ts
    const vs = await admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[field]);
```

with:

```ts
    // ⛔ THE REGISTER'S OWN LIST WHEN IT HAS ONE. A register that has added a facility type checks
    // its values against the shared 63 PLUS its own; one that has added nothing behaves exactly as
    // it did before Slice B. See `valueSetForField`.
    const vs = await admin.valueSets.getByUrl(await valueSetForField(admin, field, nationalSystem));
```

In `packages/bootstrap/src/facility-value-mappings.ts`, replace:

```ts
      const vs = await admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[entry.field]);
```

with:

```ts
      // The same list the operator picked from. Validating a register-scoped code against the
      // shared set alone would refuse the very type this register just added.
      const vs = await admin.valueSets.getByUrl(await valueSetForField(admin, entry.field, nationalSystem));
```

Remove the now-unused `CONTROLLED_VALUE_SETS` import from `facility-value-mappings.ts` if nothing else there reads it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/bootstrap exec vitest run`
Expected: PASS, the whole package.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src
git commit -m "fix(facilities): value checks read the register's own list"
```

---

### Task 3: suggest-values learns which register it is for

**Files:**
- Modify: `apps/server/src/facilities-routes.ts:1953`
- Modify: `apps/studio/src/api.ts:1357`
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx` (the `suggestValueMappings` call)
- Modify: `packages/cli/src/facilities.ts:826`
- Test: `apps/server/src/facilities-routes.test.ts`, `apps/studio/src/facilities/ColumnMapStep.test.tsx`

**Interfaces:**
- Consumes: `valueSetForField` from Task 2's location.
- Produces: `suggestValueMappings(field, values, nationalSystem)` on the client, a third REQUIRED argument. The route body gains an optional `nationalSystem: string`.

The route body's field is OPTIONAL on the wire and defaults to `''`, so an older client keeps working and gets the shared list. The client argument is REQUIRED, so no studio call site can forget it.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/facilities-routes.test.ts`, beside the existing `suggest-values` tests:

```ts
it('ranks against the register\'s own list when one is named', async () => {
  // Arrange a register value set carrying a type the shared list does not have, using the same
  // harness the file's other suggest-values tests use.
  const res = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/suggest-values',
    payload: { field: 'level', values: ['First-aid stations'], nationalSystem: 'HFR' },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().options.map((o: { code: string }) => o.code)).toContain('first-aid-stations');
});

it('ranks against the shared list when no register is named', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/suggest-values',
    payload: { field: 'level', values: ['First-aid stations'] },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().options.map((o: { code: string }) => o.code)).not.toContain('first-aid-stations');
});
```

Build the register value set through `addRegisterFacilityType` in the arrange step rather than hand-writing rows, so the test exercises the same shape the route will see. Reuse the app builder the file's existing value-mapping and suggest-values tests use.

In `apps/studio/src/facilities/ColumnMapStep.test.tsx`:

```ts
it('tells suggest-values which register the values came from', async () => {
  mockedApi(api.readFacilityImportColumnValues).mockResolvedValue({
    header: 'Type', values: ['Others'], distinct: 1, truncated: false,
  });
  renderColumnMapStep({
    runId: 'run-1', headers: ['Type'], nationalSystem: 'urn:zm:mfl',
    value: { columns: { Type: 'level' }, constants: {}, extras: [] },
  });

  fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));

  await waitFor(() => expect(api.suggestValueMappings).toHaveBeenCalledWith('level', ['Others'], 'urn:zm:mfl'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "register"`
Run: `pnpm --filter @openldr/studio exec vitest run src/facilities/ColumnMapStep.test.tsx -t "which register"`
Expected: FAIL. The route ignores `nationalSystem` and the client sends two arguments.

- [ ] **Step 3: Widen the route**

In `apps/server/src/facilities-routes.ts`, in the `suggest-values` handler, read the field from the body and use it:

```ts
    // Optional on the wire so an older client keeps working and gets the shared list. Present, it
    // selects the register's own list, which is what the studio always sends.
    const nationalSystem = typeof reqBody.nationalSystem === 'string' ? reqBody.nationalSystem : '';
    const vs = await ctx.terminology.admin.valueSets.getByUrl(
      await valueSetForField(ctx.terminology.admin, field, nationalSystem),
    );
```

Import `valueSetForField` from `@openldr/bootstrap` beside the existing `CONTROLLED_VALUE_SETS` import, and drop `CONTROLLED_VALUE_SETS` from that import list if nothing else in the file reads it.

- [ ] **Step 4: Widen the client and its one caller**

In `apps/studio/src/api.ts`:

```ts
export const suggestValueMappings = (
  field: ControlledField, values: string[], nationalSystem: string,
): Promise<{ values: ValueSuggestion[]; options: ValueSetOption[]; notValidated: boolean }> =>
  authFetch('/api/facilities/import/suggest-values', jbody({ field, values, nationalSystem }, 'POST'))
    .then((r) => okJson<{
      values: ValueSuggestion[]; options: ValueSetOption[]; notValidated: boolean;
    }>(r, 'suggest value mappings'));
```

In `ColumnMapStep.tsx`, pass `nationalSystem ?? ''` at every `suggestValueMappings` call. There is more than one: the per-row check and the constants section both call it. Find them all with `grep -n "suggestValueMappings" apps/studio/src/facilities/ColumnMapStep.tsx`.

- [ ] **Step 5: Widen the CLI**

In `packages/cli/src/facilities.ts:826`, replace the constant lookup the same way, passing `opts.nationalSystem`. The CLI already has it in scope on that path.

- [ ] **Step 6: Run everything touched**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts`
Run: `pnpm --filter @openldr/server lint`
Run: `pnpm --filter @openldr/studio exec vitest run src/facilities`
Run: `pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts`
Expected: PASS. Existing studio tests that assert `suggestValueMappings` was called with two arguments need their expectations widened; that is honest, the call really did change.

- [ ] **Step 7: Commit**

```bash
git add apps packages
git commit -m "feat(facilities): suggest-values ranks against the register's own list"
```

---

### Task 4: The route that adds a type

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `addRegisterFacilityType`, `FacilityTypeCollisionError` from `@openldr/bootstrap`.
- Produces: `POST /api/facilities/import/facility-types`, body `{ nationalSystem: string; display: string }`, 200 `{ code, system, valueSetUrl }`, 409 on a collision with `{ error, collidesWith }`, 403 without both capabilities.

- [ ] **Step 1: Write the failing tests**

```ts
it('adds a facility type to the register and returns its code', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/facility-types',
    payload: { nationalSystem: 'HFR', display: 'First-aid stations' },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().code).toBe('first-aid-stations');
});

// ⛔ A 409, not a 200 with a warning. Adding it would poison the normalised key and BOTH values
// would stop resolving, silently.
it('refuses a display that collides, and names what it hit', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/facility-types',
    payload: { nationalSystem: 'HFR', display: 'Health Centre' },
  });

  expect(res.statusCode).toBe(409);
  expect(res.json().collidesWith).toMatchObject({ code: 'health-center' });
});

it('refuses an empty display', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/facility-types',
    payload: { nationalSystem: 'HFR', display: '   ' },
  });

  expect(res.statusCode).toBe(400);
});

it('refuses a caller without terminology.manage', async () => {
  // Build the app with a principal carrying facilities.manage only, using whatever mechanism this
  // file's other capability tests use.
  const res = await appWithout('terminology.manage').inject({
    method: 'POST',
    url: '/api/facilities/import/facility-types',
    payload: { nationalSystem: 'HFR', display: 'First-aid stations' },
  });

  expect(res.statusCode).toBe(403);
});
```

Read how the file's existing tests assert a capability refusal before writing the last one; `appWithout` is a placeholder for that mechanism, not a helper to invent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t "facility type"`
Expected: FAIL with 404, the route does not exist.

- [ ] **Step 3: Add the route**

Beside the `value-mappings` route in `apps/server/src/facilities-routes.ts`:

```ts
  // ⛔ TWO CAPABILITIES, and that is the point of this route existing rather than the operator
  // being sent to the Terminology page. It writes to the vocabulary, so it is gated like a
  // vocabulary write, on top of the facilities gate every route in this file carries. Spec
  // decision 4. An importer without `terminology.manage` still maps and ignores, so the import is
  // never blocked outright, only this one outcome.
  app.post('/api/facilities/import/facility-types', {
    preHandler: [requireCapability('facilities.manage'), requireCapability('terminology.manage')],
  }, async (req, reply) => {
    const p = z.object({
      nationalSystem: z.string().min(1),
      display: z.string().trim().min(1),
    }).safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }

    const register = await resolveFacilityRegisterForImport(registerSources, p.data.nationalSystem);
    if (!register.ok) { reply.code(400); return { error: register.error }; }

    let result;
    try {
      result = await addRegisterFacilityType(ctx.terminology.admin, {
        nationalSystem: register.source.url, display: p.data.display,
      });
    } catch (err) {
      if (err instanceof FacilityTypeCollisionError) {
        reply.code(409);
        return { error: err.message, collidesWith: err.collidesWith };
      }
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }

    await recordAudit(ctx, req, {
      action: 'facility.type-added',
      entityType: 'facility',
      entityId: register.source.url,
      before: null,
      after: null,
      metadata: { nationalSystem: register.source.url, code: result.code, display: p.data.display },
    });
    return result;
  });
```

Check how `requireCapability` composes when two are needed; if `preHandler` does not accept an array in this Fastify setup, write one `preHandler` that calls both in sequence.

- [ ] **Step 4: Run the tests, the lint and the typecheck**

Run: `pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts`
Run: `pnpm --filter @openldr/server lint`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src
git commit -m "feat(facilities): a route that adds a facility type to one register"
```

---

### Task 5: The dialog and the pick-list option

**Files:**
- Create: `apps/studio/src/facilities/AddFacilityTypeDialog.tsx`
- Create: `apps/studio/src/facilities/AddFacilityTypeDialog.test.tsx`
- Modify: `apps/studio/src/api.ts`, `ValueMapRow.tsx`, `ColumnMapStep.tsx`, `i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/facilities/ColumnMapStep.test.tsx`

**Interfaces:**
- Consumes: `VALUE_MAP_UNMAPPED`, `VALUE_MAP_IGNORE` from `ValueMapRow.tsx` (Slice A); `useAuth().hasCapability` from `@/auth/AuthProvider`.
- Produces: `VALUE_MAP_ADD = '__add_type__'` from `ValueMapRow.tsx`; `addFacilityType(nationalSystem, display)` in `api.ts`; the dialog component.

- [ ] **Step 1: Add the i18n keys**

`en.ts`, under `facilities.import.valueMap`:

```ts
        addTypeOption: 'Add "{{value}}" as a new type…',
        addTypeTitle: 'Add a facility type',
        addTypeDescription: 'Added to {{register}} only. Other registers keep the list they have.',
        addTypeDisplay: 'Name',
        addTypeCode: 'Code',
        addTypeCodeHint: 'Derived from the name. Not editable.',
        addTypeAction: 'Add type',
        addTypeCollision: '"{{display}}" is already in this list. Map to it instead of adding a second one.',
        addTypeNeedsCapability: 'Adding a type needs the terminology.manage capability.',
```

`fr.ts`:

```ts
        addTypeOption: 'Ajouter « {{value}} » comme nouveau type…',
        addTypeTitle: 'Ajouter un type d\'établissement',
        addTypeDescription: 'Ajouté à {{register}} uniquement. Les autres registres gardent leur liste.',
        addTypeDisplay: 'Nom',
        addTypeCode: 'Code',
        addTypeCodeHint: 'Dérivé du nom. Non modifiable.',
        addTypeAction: 'Ajouter le type',
        addTypeCollision: '« {{display}} » est déjà dans cette liste. Faites-y correspondre la valeur au lieu d\'en ajouter une seconde.',
        addTypeNeedsCapability: 'Ajouter un type demande la capacité terminology.manage.',
```

`pt.ts`:

```ts
        addTypeOption: 'Adicionar "{{value}}" como novo tipo…',
        addTypeTitle: 'Adicionar um tipo de unidade',
        addTypeDescription: 'Adicionado apenas a {{register}}. Os outros registos mantêm a lista que têm.',
        addTypeDisplay: 'Nome',
        addTypeCode: 'Código',
        addTypeCodeHint: 'Derivado do nome. Não editável.',
        addTypeAction: 'Adicionar tipo',
        addTypeCollision: '"{{display}}" já está nesta lista. Faça o mapeamento para ele em vez de adicionar um segundo.',
        addTypeNeedsCapability: 'Adicionar um tipo exige a capacidade terminology.manage.',
```

- [ ] **Step 2: Write the failing tests**

`AddFacilityTypeDialog.test.tsx`:

```ts
it('shows the derived code and does not let it be edited', async () => {
  render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
    rawValue="First-aid stations" onOpenChange={vi.fn()} onAdded={vi.fn()} />);

  expect(screen.getByLabelText('Name')).toHaveValue('First-aid stations');
  expect(screen.getByText('first-aid-stations')).toBeInTheDocument();
  expect(screen.queryByLabelText('Code')).not.toHaveAttribute('type', 'text');
});

it('re-derives the code as the name is edited', async () => {
  render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
    rawValue="Optic Clinics" onOpenChange={vi.fn()} onAdded={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Optic Clinic' } });

  expect(screen.getByText('optic-clinic')).toBeInTheDocument();
});

it('reports a collision with the concept it hit, rather than adding a second one', async () => {
  mocked(api.addFacilityType).mockRejectedValue(
    Object.assign(new Error('conflict'), { collidesWith: { code: 'health-center', display: 'Health Center' } }),
  );
  const onAdded = vi.fn();
  render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
    rawValue="Health Centre" onOpenChange={vi.fn()} onAdded={onAdded} />);

  fireEvent.click(screen.getByRole('button', { name: 'Add type' }));

  expect(await screen.findByText(/Health Center.*already in this list/i)).toBeInTheDocument();
  expect(onAdded).not.toHaveBeenCalled();
});

// ⛔ AGENTS.md section 5. Its own actions are a ⋯ menu in a header row, never a footer pair.
it('puts its own actions in a dots menu, not a footer', () => {
  render(<AddFacilityTypeDialog open nationalSystem="urn:zm:mfl" registerName="Zambia MFL"
    rawValue="First-aid stations" onOpenChange={vi.fn()} onAdded={vi.fn()} />);

  expect(screen.getByRole('button', { name: /actions/i })).toBeInTheDocument();
});
```

In `ColumnMapStep.test.tsx`:

```ts
it('offers Add as a new type on a level row', async () => {
  // Same arrange as the Slice A "offers Ignore this value" test, with `Others` as the value.
  fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
  fireEvent.click(await screen.findByLabelText('Others'));

  expect(await screen.findByRole('option', { name: /Add "Others" as a new type/ })).toBeInTheDocument();
});

it('does not offer Add on a status row', async () => {
  // Same arrange as the Slice A "does not offer Ignore on a status row" test.
  expect(screen.queryByRole('option', { name: /as a new type/ })).not.toBeInTheDocument();
});

it('disables Add without terminology.manage and says why', async () => {
  // Render inside an auth context whose hasCapability returns false for terminology.manage.
  fireEvent.click(screen.getByRole('button', { name: /^Type:/ }));
  fireEvent.click(await screen.findByLabelText('Others'));

  expect(await screen.findByRole('option', { name: /Add "Others" as a new type/ })).toHaveAttribute('data-disabled');
});
```

Read how `ColumnMapStep.test.tsx` currently provides (or does not provide) an auth context before writing the last one. If it renders without a provider, `hasCapability` returns false by default (`AuthProvider.tsx:31`), so the DEFAULT in that suite is "cannot add"; arrange the enabled case explicitly and say so in a comment.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities`
Expected: FAIL, the dialog and the option do not exist.

- [ ] **Step 4: Add the client call**

In `apps/studio/src/api.ts`:

```ts
/** A collision carries the concept it hit, so the caller can offer that instead of a second one. */
export interface FacilityTypeCollision { code: string; display: string | null }

export const addFacilityType = (
  nationalSystem: string, display: string,
): Promise<{ code: string; system: string; valueSetUrl: string }> =>
  authFetch('/api/facilities/import/facility-types', jbody({ nationalSystem, display }, 'POST'))
    .then(async (r) => {
      if (r.status === 409) {
        const body = await r.json() as { error: string; collidesWith: FacilityTypeCollision };
        throw Object.assign(new Error(body.error), { collidesWith: body.collidesWith });
      }
      return okJson<{ code: string; system: string; valueSetUrl: string }>(r, 'add facility type');
    });
```

- [ ] **Step 5: Write the dialog**

Create `apps/studio/src/facilities/AddFacilityTypeDialog.tsx`, copying `RegisterSourceDialog.tsx`'s shape: a `Dialog`, a header row whose actions are a `⋯` `DropdownMenu`, fields in a `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`, and a fresh form on every open. The code is rendered as text beside its label, never an `Input`. On a rejection carrying `collidesWith`, render `addTypeCollision` with that concept's display and leave the dialog open.

- [ ] **Step 6: Add the option and wire it**

In `ValueMapRow.tsx`, export `VALUE_MAP_ADD = '__add_type__'` beside the other two sentinels, and render it in Slice A's top section, after `Ignore this value` and before the separator, gated on `field === 'level'`. Disable it when `hasCapability('terminology.manage')` is false, with `addTypeNeedsCapability` as its title.

In `ColumnMapStep.tsx`, when a row's choice becomes `VALUE_MAP_ADD`, open the dialog for that value rather than storing the sentinel as a choice. ⛔ `VALUE_MAP_ADD` must never reach `pendingValueMappings`: it is not an outcome, it is a door. On success, set that value's choice to the returned code and re-run the row's check so the new concept is in the list.

- [ ] **Step 7: Run everything and typecheck**

Run: `pnpm --filter @openldr/studio exec vitest run src/facilities`
Run: `pnpm --filter @openldr/studio exec tsc --noEmit -p tsconfig.json`
Expected: PASS and clean.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src
git commit -m "feat(facilities): add a facility type from the mapping step"
```

---

### Task 6: CLI parity and the operator docs

**Files:**
- Modify: `packages/cli/src/facilities.ts`, `packages/cli/src/program.ts`
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`, `apps/web/src/docs/0.1.0/facilities.md`
- Test: `packages/cli/src/facilities.test.ts`

**Interfaces:**
- Consumes: `addRegisterFacilityType`, `FacilityTypeCollisionError` from `@openldr/bootstrap`.
- Produces: `openldr facilities add-type <display> --national-system <uri>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('add-type', () => {
  it('adds the type and prints its code', async () => {
    mocks.addRegisterFacilityType.mockResolvedValue({
      code: 'first-aid-stations',
      system: 'urn:openldr:cs:facility-type:local:urn_tz_hfr',
      valueSetUrl: 'urn:openldr:valueset:facility-type:urn_tz_hfr',
    });

    const code = await runFacilitiesAddType('First-aid stations', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(0);
    expect(mocks.addRegisterFacilityType).toHaveBeenCalledWith(
      mocks.ctx.terminology.admin, { nationalSystem: 'urn:tz:hfr', display: 'First-aid stations' },
    );
  });

  it('exits non-zero and names the collision rather than adding a second one', async () => {
    mocks.addRegisterFacilityType.mockRejectedValue(
      new FacilityTypeCollisionError({ code: 'health-center', display: 'Health Center' }),
    );

    const code = await runFacilitiesAddType('Health Centre', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(1);
  });
});
```

Add `addRegisterFacilityType` to the `@openldr/bootstrap` mock factory at the top of that file, beside `saveFacilityValueMappings`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts -t "add-type"`
Expected: FAIL, `runFacilitiesAddType` does not exist.

- [ ] **Step 3: Write the command**

In `packages/cli/src/facilities.ts`, add `runFacilitiesAddType(display, opts)` following `runFacilitiesSuggestValues`'s shape: build the context, call the shared function, print a table or JSON, return 0 or 1. A `FacilityTypeCollisionError` prints what it collided with and returns 1.

In `packages/cli/src/program.ts`, register it beside `suggest-map`:

```ts
  // CLI parity for `POST /api/facilities/import/facility-types`, calling the SAME
  // `addRegisterFacilityType` (@openldr/bootstrap) the route calls.
  facilities
    .command('add-type <display>')
    .description('Add a facility type to one register\'s own list. The shared list every other register sees is untouched.')
    .requiredOption('--national-system <uri>', 'the register this type belongs to; spell it exactly as `facilities import-sources` prints it')
    .option('--json', 'emit machine-readable JSON', false)
    .action(async (display: string, opts: { nationalSystem: string; json: boolean }) => {
      process.exitCode = await runFacilitiesAddType(display, opts);
    });
```

- [ ] **Step 4: Write the docs**

In `apps/studio/src/docs/0.1.0/en/facilities.md`, beside the paragraph Slice A added about ignoring:

```markdown
**A level value the list does not have can be added to it.** Pick **Add "…" as a new type** from the
top of the list. A confirm opens showing the name, which you can correct, and the code it will get,
which you cannot. The type is added to that register only: every other register keeps the list it
has. If the name you typed already matches something in the list, the add is refused and names what
it matched, because two entries that read alike would stop both of them resolving. Adding a type
needs the `terminology.manage` capability as well as `facilities.manage`; without it the option is
disabled and you can still map or ignore.
```

Translate into `fr` and `pt`, matching the register of the surrounding prose in each. Add a shorter version to `apps/web/src/docs/0.1.0/facilities.md`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src apps/studio/src/docs apps/web/src/docs
git commit -m "feat(facilities): openldr facilities add-type, and the operator docs"
```

---

### Task 7: The gate, and the live checks this slice actually needs

**Files:** none.

- [ ] **Step 1: Run the full gate**

Run: `pnpm turbo run test --concurrency=2 --force > gate.txt 2>&1`
Expected: 35 of 35 tasks, 0 cached. Never pipe turbo through `tail`; read `gate.txt`.

- [ ] **Step 2: Prove the two-clause union against a REAL Postgres**

⛔ THIS IS THE ONE THING pg-mem CANNOT SETTLE, and it is the load-bearing claim of the whole slice. Every unit test above uses a fake expander. If the register value set's compose is wrong, the pick list silently loses all 63 seeded types, or gains nothing.

Start the stack, import a CSV whose `Type` column carries a value the list does not have, add it, and confirm the pick list on another value still shows the seeded types AND the new one. Then query the register value set directly and confirm its expansion count is 64, not 1 and not 63.

- [ ] **Step 3: Prove a second register is unaffected**

Add a type under one register, then open an import for a different register and confirm its pick list does not carry it. This is the promise the whole design was shaped around and no unit test proves it end to end.

- [ ] **Step 4: Record what could not be proven**

Say plainly which of steps 2 and 3 you actually ran. If you could not run them, say the slice is unverified on its central claim rather than implying the gate covered it.

- [ ] **Step 5: Clean up after the live checks**

The checks write real concepts, a real coding system and a real value set into the dev install, and mint import runs. List what you created and either remove it or say what was left behind.

---

## Self-review

**Spec coverage.** Register-scoped value set and coding system, Task 1. Two include clauses with the intersection trap named, Task 1 steps 2 and 4. The `local` segment, Task 1 step 4. Slug reuse, Task 1 step 1. `valueSetForField` as a lookup, Tasks 1 and 2, applied at all four read sites across Tasks 2 and 3. Confirm dialog with the derived non-editable code, Task 5. Collision refused not warned, Tasks 1, 4 and 5. Two capabilities, Task 4 and Task 5 step 6. CLI parity, Task 6. Docs in en, fr, pt and web, Task 6. Shared value set never modified, asserted in Task 1's compose test and stated in Global Constraints. Removing or renaming an added concept stays out of scope, per the spec.

**Type consistency.** `addRegisterFacilityType` returns `{ code, system, valueSetUrl }` in Task 1 and is consumed with that shape in Tasks 4, 5 and 6. `FacilityTypeCollisionError.collidesWith` is `{ code, display }` in Task 1, surfaced as a 409 body in Task 4, rethrown with the same key by the client in Task 5 step 4, and read by the dialog in Task 5's third test. `valueSetForField(admin, field, nationalSystem)` is defined in Task 1, relocated for the import cycle in Task 2's note, and called in Tasks 2 and 3. `suggestValueMappings` gains a third required argument in Task 3 and Task 5's tests assume it.

**Known soft spots.** Task 3 changes a client signature with more than one caller; the plan says to grep rather than naming line numbers that will have moved. Task 4's capability test and Task 5's auth-context test both depend on harness details I have not read, and both say so rather than inventing a helper. Task 7's steps 2 and 3 are the only evidence for the design's central claim and no unit test can replace them.
