# Form builder S6: ValueSets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Bind a field's options to a ValueSet picked from a list, show and apply FHIR's own binding for a picked path, and give every install FHIR's standard ValueSets, as corlix does.

**Architecture:** A generator writes FHIR R4's element bindings for CE's path table into `packages/fhir/src/paths/r4-bindings.generated.ts`, read through `lookupBinding`. The boot seed imports the bundled FHIR catalog on every start, with a presence check that sees past migration 072. In the studio, pure helpers in `valueSetBinding.ts` decide what binding does; `OptionsBlock` holds the binding control and the option list; Mapping loses its free-text ValueSet box and gains a "bound:" line; the field editor auto-binds a required or extensible path; the Reference block gets its own ValueSet picker. Codes are always read as stored, through the export route, never recomputed.

**Tech Stack:** TypeScript, vitest, pg-mem, React 18, Testing Library, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S6. Rows B3, B4a, B4b.

## Read this first: state when this plan was written

- Written 2026-09-14 at `main` `a791e324`, **before S4 and S5 ran.** The spec asks for each plan to be written just before its slice starts; the operator asked for this one early. Run it only after S5 is merged, which Task 0 checks. S6 edits `FieldEditorSheet.tsx`, `api.ts` and `seed.ts`, which S4 and S5 also touch. If an anchor below is missing, stop and report; do not guess where it went.
- Corlix is at `~/Projects/Repositories/corlix`. Its source for this slice is `apps/desktop/scripts/gen-fhir-bindings.ts`, `apps/desktop/src/main/fhir-bindings.ts`, `apps/desktop/src/renderer/lib/valueSetBinding.ts`, `components/ValueSetBinding.tsx`, `components/SaveOptionsAsValueSetDialog.tsx` and `components/form-builder/FieldEditor.tsx:450-590`. Its committed R4 table is `apps/desktop/src/main/data/bindings/R4.bindings.json.gz`.
- A `pre:edit-write` GateGuard hook blocks the first Edit or Write to each file until you state four facts: the importers, the public names affected, any data files read, and the operator's instruction. Answer it and retry. Its loop and scope warnings are noise.

## RULE 0: each gap, checked 2026-09-14

| Row | The fact that would make it not real | What the code says |
|---|---|---|
| B3 | The builder can already pick a ValueSet from a list | Mapping has a free-text "Value Set URL" box and a strength select, `MappingEditor.tsx:141-170`. The Options block is a plain list, `OptionsEditor.tsx` |
| B4a | CE already has an element-to-ValueSet table | Nothing in `packages` or `apps` generates or reads one |
| B4b | Every install already holds FHIR's catalog | The import runs only in `seedDatabase` (`packages/bootstrap/src/seed.ts:364`), under `SEED_ON_START`, which defaults to false (`packages/config/src/schema.ts:33`) |

The spec's trap holds: `valueSets.expand()` recomputes the codes and overwrites the stored rows (`packages/db/src/terminology-admin-store.ts:1017-1021`), and an include of a whole system CE holds no terms for expands to nothing (`value-set-expander.ts:62`). `exportFhir` reads the stored rows as they are (`terminology-admin-store.ts:1069-1073`).

Three spec claims failed the same check. The operator ruled on each on 2026-09-14.

1. **The presence check would skip the catalog on every install.** It skips when any `pub-hl7-fhir` set exists. Migration 072 inserts `urn:openldr:valueset:location-status` under that publisher, with no condition (`072_facility_level_status_valuesets.ts:35,222-226`). So on any install migrated past 072, even a `SEED_ON_START` one, the catalog has not been imported. The dev database has it only because it was imported before 072. **Ruling:** skip only when a set under `http://hl7.org/fhir/ValueSet/` exists.
2. **Corlix auto-binds at every strength.** For CE's paths that includes example sets. Picking `ServiceRequest.code` would turn the Lab order's Tests field, a reference to LOINC, into a select of 1,000 SNOMED example codes. 15 of the 77 bound paths in CE's table lead to sets of more than 100 codes. **Ruling:** auto-bind only `required` and `extensible` bindings, and never on a field that already names a reference source.
3. **Removing Mapping's ValueSet box strands reference fields.** The new binding control only shows for selects, and `ReferenceEditor.tsx` edits only `referenceTarget` (`:49-56`). The Facility form's Country, Status and Level are reference fields bound through `valueSetUrl` (`samples/forms.ts:72,127,133`). **Ruling:** the Reference Configuration block gets its own ValueSet picker.

Measured 2026-09-14 against corlix's committed R4 table and the dev database: 77 bindings fall on paths in CE's path table (16 required, 12 extensible, 20 preferred, 29 example). They name 56 distinct sets, 48 of which the dev database holds, all with stored codes. The largest held set has 4,000 codes.

## Global Constraints

- Match corlix's shipped behavior, except where the spec and the three rulings say otherwise. Add nothing beyond them.
- Codes are read as stored, through `GET /api/terminology/valuesets/:id/export`. Never call `expandValueSet` from the builder.
- Storage does not change. No migration. Data entry does not change.
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only in new app code. Never a native `<button>`, `<select>`, `<input>` or `<dialog>`. `ValueSetPicker` is existing code and is reused as it is.
- Block, row and sheet actions go in a `⋯` `DropdownMenu` (AGENTS.md §5). Sheets, not dialogs.
- Never hardcode clinical vocabulary (AGENTS.md §8). The bindings table is generated from FHIR's own definitions, not typed.
- Never pipe turbo through `tail`. Never read `$?` through a pipe. Redirect to a file, then echo the exit code.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s6`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Decisions and adaptations, each with its reason

- **Read codes through the existing export route.** It reads `valueset_expansions` without recomputing, needs no capability, and returns `expansion.contains`. The spec left a choice between it and a new read-only route. The export route needs no server change; Task 8 times it on the largest held set, which is the proof the spec asked for.
- **No Re-expand.** Corlix's binder has a Re-expand button that forces a fresh expansion. In CE that is exactly the trap, so it is left out.
- **The bindings table covers only CE's path table.** The builder can only pick paths in `r4-paths.generated.ts`, so the generator keeps those: 77 entries instead of corlix's 1,101 bound elements. Extending the path table and rerunning both generators brings the rest in.
- **The generator downloads, and has an offline route.** It fetches `https://hl7.org/fhir/R4/profiles-resources.json` (about 35 MB), as corlix's does. `--from <file>` reads a local copy of that Bundle. `--from-table <file>` reads corlix's committed extraction, which the same extractor produced from the same HL7 file. No staleness test: the source is a download, so the committed file is the reference, as in corlix.
- **The presence check looks for a catalog URL** (ruling 1). `importFhirCatalog` runs in one transaction, so a catalog URL present means the import completed. The one case this misses is an operator importing a single hl7.org set by hand before the first boot; that install keeps a partial catalog until the operator imports the rest.
- **The FHIR catalog step moves into `seedEssentials`, and `seedDatabase` keeps calling it.** Both paths share one function. UCUM stays where it is, as the spec says.
- **Auto-bind** (ruling 2) sets the field to `select`, or keeps it `multiselect` if it already is one. Corlix forces `select`; turning a multiselect into a select would drop answers the author meant to allow.
- **"Load from terminology" fills the options from the element's standard set, without binding.** That is the spec's wording. Corlix opens a term picker restricted to the set's systems and adds one term at a time; CE holds no terms for most FHIR catalog systems, so that picker would find nothing here.
- **Unbind keeps the copied options** and drops only the link and the strength, as corlix does.
- **"Save as a new ValueSet" is a Sheet**, with Save and Cancel in its `⋯` menu (AGENTS.md §5). It anchors the codes to `urn:openldr:cs:local`, the local system migration 014 already seeds, under publisher `pub-system`, at a suggested URL `urn:openldr:valueset:<slug>`. Saving needs `terminology.manage` on the server (`terminology-admin-routes.ts:362`), so the item shows only for a user who holds it.
- **The Options block's actions sit in one `⋯` on its header**: Load from terminology, Unbind, Save as a new ValueSet. The `⋯` shows only when at least one applies.
- **The Reference block's ValueSet row** has a picker, and once bound, the set's title and a row `⋯` with Unbind. A reference field searches its set live (`reference-source.ts`), so binding copies no codes. When a Target is also set, the existing lint warning says the ValueSet wins (`lint.ts:117`).
- **The "bound:" line names the set by its URL's last segment**, as corlix does (`FieldEditor.tsx:585-591`). No fetch is needed to draw it.

## File map

| File | Change |
|---|---|
| `packages/fhir/src/paths/bindings.ts` + test | new: extractor, table reader, renderer |
| `scripts/gen-fhir-bindings.ts`, root `package.json` | new generator and `gen:fhir-bindings` |
| `packages/fhir/src/paths/r4-bindings.generated.ts` | generated |
| `packages/fhir/src/paths/index.ts` | `lookupBinding` |
| `packages/bootstrap/src/seed.ts` + `seed.test.ts` | `seedFhirValueSetCatalog`, on every boot |
| `packages/bootstrap/src/seed-fhir-catalog.test.ts` | new, on the real migration chain |
| `apps/server/src/index.ts` | log the catalog count |
| `apps/studio/src/api.ts` | `storedValueSetCodes`, `findValueSetByUrl` |
| `apps/studio/src/forms-builder/valueSetBinding.ts` + test | new |
| `apps/studio/src/forms-builder/field-editor/OptionsBlock.tsx` + test | new |
| `apps/studio/src/forms-builder/field-editor/SaveOptionsAsValueSetSheet.tsx` | new |
| `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx` + test | box out, "bound:" in |
| `apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx` + test | ValueSet row |
| `apps/studio/src/forms-builder/FieldEditorSheet.tsx` + test | `OptionsBlock`, auto-bind |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | new section |

---

### Task 0: Preconditions and branch

- [ ] **Step 1: S5 is in.** `ls packages/forms/src/starter-pack-store.ts apps/studio/src/forms-builder/StarterPackChooser.tsx`. Both must list. If either does not, stop and tell the operator.

- [ ] **Step 2: Branch.**

```bash
git switch main
git switch -c feat/form-builder-s6
```

---

### Task 1: FHIR's bindings table

**Files:**
- Create: `packages/fhir/src/paths/bindings.ts`, `bindings.test.ts`
- Create: `scripts/gen-fhir-bindings.ts`; modify the root `package.json`
- Create (generated): `packages/fhir/src/paths/r4-bindings.generated.ts`
- Modify: `packages/fhir/src/paths/index.ts`

**Interfaces:** Produces, from `@openldr/fhir/paths`: `type FhirBindingStrength = 'required' | 'extensible' | 'preferred' | 'example'`, `interface FhirBinding { valueSet: string; strength: FhirBindingStrength }`, `lookupBinding(path: string | null | undefined): FhirBinding | null`. From `bindings.ts` directly: `extractBindings`, `bindingsFromTable`, `renderBindingsTable`.

- [ ] **Step 1: Failing test for the pure half.** Create `packages/fhir/src/paths/bindings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bindingsFromTable, extractBindings, renderBindingsTable } from './bindings';

const bundle = {
  resourceType: 'Bundle',
  entry: [
    {
      resource: {
        resourceType: 'StructureDefinition', kind: 'resource',
        snapshot: {
          element: [
            { path: 'Patient' },
            { path: 'Patient.gender', binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1' } },
            { path: 'Patient.maritalStatus', binding: { strength: 'extensible', valueSet: 'http://hl7.org/fhir/ValueSet/marital-status' } },
            { path: 'Patient.name' },
            { path: 'Patient.language', binding: { valueSet: 'http://example.org/no-strength' } },
          ],
        },
      },
    },
    {
      resource: {
        resourceType: 'StructureDefinition', kind: 'complex-type',
        snapshot: { element: [{ path: 'Address.use', binding: { strength: 'required', valueSet: 'http://hl7.org/fhir/ValueSet/address-use' } }] },
      },
    },
  ],
};

describe('extractBindings', () => {
  it('reads each resource element binding, drops the version, and skips anything without a strength', () => {
    expect(extractBindings(bundle)).toEqual({
      'Patient.gender': { valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender', strength: 'required' },
      'Patient.maritalStatus': { valueSet: 'http://hl7.org/fhir/ValueSet/marital-status', strength: 'extensible' },
    });
  });

  it('keeps only the paths it is given', () => {
    expect(Object.keys(extractBindings(bundle, new Set(['Patient.gender'])))).toEqual(['Patient.gender']);
  });
});

describe('bindingsFromTable', () => {
  it("reads corlix's committed table shape and skips reference-only rows", () => {
    expect(bindingsFromTable({
      'Patient.gender': { vs: 'http://v|4.0.1', strength: 'required', targets: [] },
      'Patient.link.other': { targets: ['Patient'] },
    })).toEqual({ 'Patient.gender': { valueSet: 'http://v', strength: 'required' } });
  });
});

describe('renderBindingsTable', () => {
  it('writes the paths sorted, so a rerun diffs cleanly', () => {
    const source = renderBindingsTable({
      b: { valueSet: 'v', strength: 'example' },
      a: { valueSet: 'v', strength: 'required' },
    });
    expect(source.indexOf('"a"')).toBeLessThan(source.indexOf('"b"'));
    expect(source).toContain('GENERATED FILE');
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/fhir exec vitest run src/paths/bindings.test.ts`. Expected: fails to resolve `./bindings`.

- [ ] **Step 3: Write `bindings.ts`.**

```ts
/**
 * FHIR's own ValueSet bindings, by element path. Ported from corlix
 * `apps/desktop/src/main/fhir-bindings.ts`. `scripts/gen-fhir-bindings.ts` runs the extractor and
 * commits the result as `r4-bindings.generated.ts`; nothing reads a FHIR Bundle at run time.
 */

export type FhirBindingStrength = 'required' | 'extensible' | 'preferred' | 'example';

export interface FhirBinding {
  valueSet: string;
  strength: FhirBindingStrength;
}

const STRENGTHS = new Set<string>(['required', 'extensible', 'preferred', 'example']);

interface SdElement {
  path?: string;
  binding?: { valueSet?: string; strength?: string };
}

interface StructureDefinition {
  resourceType?: string;
  kind?: string;
  snapshot?: { element?: SdElement[] };
  differential?: { element?: SdElement[] };
}

/**
 * Each resource element's binding, keyed by path, from a FHIR `profiles-resources` Bundle. `keep`,
 * when given, drops every path it lacks. A `|version` suffix on the ValueSet URL is dropped, and an
 * element whose binding names no valid strength is skipped.
 */
export function extractBindings(bundle: unknown, keep?: ReadonlySet<string>): Record<string, FhirBinding> {
  const out: Record<string, FhirBinding> = {};
  const entries = (bundle as { entry?: Array<{ resource?: StructureDefinition }> } | null)?.entry ?? [];
  for (const { resource: sd } of entries) {
    if (!sd || sd.resourceType !== 'StructureDefinition' || sd.kind !== 'resource') continue;
    for (const el of sd.snapshot?.element ?? sd.differential?.element ?? []) {
      const path = el.path;
      if (!path || !path.includes('.')) continue;
      if (keep && !keep.has(path)) continue;
      const valueSet = el.binding?.valueSet;
      const strength = el.binding?.strength;
      if (!valueSet || !strength || !STRENGTHS.has(strength)) continue;
      out[path] = { valueSet: valueSet.split('|')[0], strength: strength as FhirBindingStrength };
    }
  }
  return out;
}

/**
 * The same map from corlix's committed table (`{ [path]: { vs, strength, targets } }`), which its
 * extractor produced from the same HL7 file. The generator's offline route.
 */
export function bindingsFromTable(table: unknown, keep?: ReadonlySet<string>): Record<string, FhirBinding> {
  const out: Record<string, FhirBinding> = {};
  for (const [path, entry] of Object.entries((table ?? {}) as Record<string, { vs?: string; strength?: string }>)) {
    if (keep && !keep.has(path)) continue;
    if (!entry.vs || !entry.strength || !STRENGTHS.has(entry.strength)) continue;
    out[path] = { valueSet: entry.vs.split('|')[0], strength: entry.strength as FhirBindingStrength };
  }
  return out;
}

/** The committed file's source. Paths are sorted so a rerun diffs cleanly. */
export function renderBindingsTable(table: Record<string, FhirBinding>): string {
  const lines = Object.keys(table)
    .sort()
    .map((path) => `  ${JSON.stringify(path)}: ${JSON.stringify(table[path])},`);
  return [
    '// GENERATED FILE. Do not edit by hand. Run `pnpm gen:fhir-bindings`.',
    "// FHIR R4's own ValueSet bindings for the paths in r4-paths.generated.ts, from hl7.org's",
    '// profiles-resources.json.',
    '',
    "import type { FhirBinding } from './bindings';",
    '',
    'export const R4_BINDINGS: Readonly<Record<string, FhirBinding>> = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run, watch it pass.** Same command as Step 2. Expected: PASS.

- [ ] **Step 5: The generator.** Create `scripts/gen-fhir-bindings.ts`:

```ts
// Generates packages/fhir/src/paths/r4-bindings.generated.ts: FHIR R4's own ValueSet binding for
// each path in r4-paths.generated.ts.
//
// Maintainer-only, and not run at build time. By default it downloads hl7.org's
// profiles-resources.json (about 35 MB). Offline routes:
//   --from <file>        a local copy of that Bundle, .json or .json.gz
//   --from-table <file>  corlix's committed extraction (R4.bindings.json.gz), made from the same file

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  bindingsFromTable, extractBindings, renderBindingsTable, type FhirBinding,
} from '../packages/fhir/src/paths/bindings';
import { R4_PATHS } from '../packages/fhir/src/paths/r4-paths.generated';

const SOURCE = 'https://hl7.org/fhir/R4/profiles-resources.json';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(repoRoot, 'packages/fhir/src/paths/r4-bindings.generated.ts');

function readJson(file: string): unknown {
  const buf = readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8'));
}

function argAfter(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function main(): Promise<void> {
  const keep = new Set(R4_PATHS.map(([path]) => path));
  const fromTable = argAfter('--from-table');
  const from = argAfter('--from');
  let table: Record<string, FhirBinding>;
  if (fromTable) {
    table = bindingsFromTable(readJson(fromTable), keep);
  } else if (from) {
    table = extractBindings(readJson(from), keep);
  } else {
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
    table = extractBindings(await res.json(), keep);
  }
  writeFileSync(OUT, renderBindingsTable(table), 'utf8');
  console.log(`wrote ${Object.keys(table).length} bindings to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

In the root `package.json`, beside `"gen:fhir-paths"`, add `"gen:fhir-bindings": "tsx scripts/gen-fhir-bindings.ts",`.

- [ ] **Step 6: Run the generator.** `pnpm gen:fhir-bindings > /tmp/s6-gen.txt 2>&1; echo "exit=$?"; cat /tmp/s6-gen.txt`. Expected: `exit=0` and `wrote 77 bindings`. If the download fails, run the offline route instead:

```bash
pnpm gen:fhir-bindings --from-table ~/Projects/Repositories/corlix/apps/desktop/src/main/data/bindings/R4.bindings.json.gz > /tmp/s6-gen.txt 2>&1; echo "exit=$?"; cat /tmp/s6-gen.txt
```

Say in the report which route produced the file. If the count is not 77, report the number and the route; do not edit the file by hand.

- [ ] **Step 7: Failing test for the lookup.** Add these imports at the top of `bindings.test.ts`:

```ts
import { lookupBinding } from './index';
import { R4_BINDINGS } from './r4-bindings.generated';
import { R4_PATHS } from './r4-paths.generated';
```

and append:

```ts
describe('the committed R4 bindings', () => {
  it('binds Patient.gender to administrative-gender, required', () => {
    expect(lookupBinding('Patient.gender')).toEqual({ valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender', strength: 'required' });
  });

  it('answers null for a path FHIR does not bind, and for no path', () => {
    expect(lookupBinding('Patient.name')).toBeNull();
    expect(lookupBinding(null)).toBeNull();
  });

  it('holds only paths the path table offers', () => {
    const paths = new Set(R4_PATHS.map(([p]) => p));
    expect(Object.keys(R4_BINDINGS).filter((p) => !paths.has(p))).toEqual([]);
    expect(Object.keys(R4_BINDINGS).length).toBeGreaterThan(60);
  });
});
```

- [ ] **Step 8: Run, watch it fail.** Same command as Step 2. Expected: `lookupBinding` is not exported.

- [ ] **Step 9: The lookup.** In `packages/fhir/src/paths/index.ts`, add:

```ts
import { R4_BINDINGS } from './r4-bindings.generated';
import type { FhirBinding } from './bindings';

export type { FhirBinding, FhirBindingStrength } from './bindings';

/** The ValueSet FHIR binds this path's element to, and how strongly. Null when FHIR binds none. */
export function lookupBinding(path: string | null | undefined): FhirBinding | null {
  if (!path) return null;
  return R4_BINDINGS[path] ?? null;
}
```

- [ ] **Step 10: Run, watch it pass.** `pnpm --filter @openldr/fhir exec vitest run`, then `pnpm --filter @openldr/fhir typecheck > /tmp/s6-t1-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`.

- [ ] **Step 11: Commit.** `git add` the four files and `package.json`, then `git commit -m "feat(fhir): generate FHIR R4's element bindings for the path table"`

---

### Task 2: FHIR's ValueSets on every install

**Files:**
- Modify: `packages/bootstrap/src/seed.ts`, `seed.test.ts`
- Create: `packages/bootstrap/src/seed-fhir-catalog.test.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:** Produces `seedFhirValueSetCatalog(app: { terminology: { admin: { valueSets: Pick<TerminologyAdminStore['valueSets'], 'list' | 'importFhirCatalog'> } } }): Promise<number>`. `EssentialSeedTarget` gains that `terminology` member. `seedEssentials` also returns `valueSetsImported: number`.

- [ ] **Step 1: Failing tests.** In `seed.test.ts`, the test `'seeds the default connector (with config) but no dashboard/terminology demo data'` pins the behavior S6 changes on purpose. Replace it with:

```ts
  it('seeds the default connector and the FHIR catalog, but no dashboard and no UCUM', async () => {
    const { app, connectors, dashboards, valueSets, concepts } = fakeApp({ SECRETS_ENCRYPTION_KEY: 'k', TARGET_DATABASE_URL: 'postgres://u:p@h:5432/d' });
    const res = await seedEssentials(app);
    expect(res.connectorsSeeded).toBe(1);
    expect(connectors[0].name).toBe('Target Warehouse (Postgres)');
    // The FHIR catalog is an essential since S6: the builder's standard bindings need the sets.
    expect(res.valueSetsImported).toBeGreaterThan(100);
    expect(valueSets.every((v) => v.publisherId === 'pub-hl7-fhir')).toBe(true);
    // Dashboards and UCUM stay opt-in, seeded only by the full SEED_ON_START seed.
    expect(dashboards).toHaveLength(0);
    expect(concepts.size).toBe(0);
  });
```

Then append:

```ts
describe('the FHIR catalog on every boot', () => {
  it("imports the catalog even with migration 072's location-status set there", async () => {
    const { app, valueSets } = fakeApp();
    valueSets.push({ url: 'urn:openldr:valueset:location-status', publisherId: 'pub-hl7-fhir' });
    expect((await seedEssentials(app)).valueSetsImported).toBeGreaterThan(100);
  });

  it('skips when a catalog set is already held', async () => {
    const { app, valueSets } = fakeApp();
    valueSets.push({ url: 'http://hl7.org/fhir/ValueSet/administrative-gender', publisherId: 'pub-hl7-fhir' });
    const importCatalog = vi.spyOn(app.terminology.admin.valueSets, 'importFhirCatalog');
    expect((await seedEssentials(app)).valueSetsImported).toBe(0);
    expect(importCatalog).not.toHaveBeenCalled();
  });

  it('the full seed gets the same check', async () => {
    const { app, valueSets } = fakeApp();
    valueSets.push({ url: 'urn:openldr:valueset:location-status', publisherId: 'pub-hl7-fhir' });
    expect((await seedDatabase(fakeDb, app)).terminology.valueSetsImported).toBeGreaterThan(100);
  });
});
```

Create `seed-fhir-catalog.test.ts`, which runs the real migration chain:

```ts
import { describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { createTerminologyAdminStore, internalMigrations, type InternalSchema } from '@openldr/db';
import { seedFhirValueSetCatalog } from './seed';

describe('seedFhirValueSetCatalog on the real migration chain', () => {
  it('imports on a freshly migrated database, where migration 072 has already added an HL7 set', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    for (const migration of Object.values(internalMigrations)) await migration.up(db as never);
    const valueSets = createTerminologyAdminStore(db).valueSets;

    // The precondition that defeated the old check: an HL7-published set exists, and none is a catalog set.
    const hl7 = (await valueSets.list('pub-hl7-fhir')).map((v) => v.url);
    expect(hl7).toContain('urn:openldr:valueset:location-status');
    expect(hl7.some((url) => url.startsWith('http://hl7.org/fhir/ValueSet/'))).toBe(false);

    const importFhirCatalog = vi.fn(async () => ({ imported: 672, skipped: 0, valueSet: null }));
    const imported = await seedFhirValueSetCatalog({
      terminology: { admin: { valueSets: { list: valueSets.list, importFhirCatalog } } },
    } as never);
    expect(importFhirCatalog).toHaveBeenCalledOnce();
    expect(imported).toBe(672);
  });
});
```

The import itself is stubbed: pg-mem holding 672 sets and their codes would be slow, and the store's own tests cover `importFhirCatalog`. This test proves the check against the real schema.

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/bootstrap exec vitest run src/seed.test.ts src/seed-fhir-catalog.test.ts`.

- [ ] **Step 3: The shared step.** In `seed.ts`, below `const FHIR_PUBLISHER_ID = 'pub-hl7-fhir';`, add:

```ts
/** Catalog set URLs start with this. Migration 072's own `pub-hl7-fhir` set is `urn:openldr:...`. */
const FHIR_CATALOG_URL_PREFIX = 'http://hl7.org/fhir/ValueSet/';
```

Add this exported function above `seedBundledTerminology`:

```ts
/**
 * Import the bundled HL7 FHIR R4 ValueSet catalog when this install holds none of it. Runs on every
 * boot since S6, from both `seedEssentials` and `seedDatabase`. Best-effort: a failure logs and
 * returns 0, and never aborts the seed.
 *
 * The check looks for a catalog URL, not merely a `pub-hl7-fhir` set. Migration 072 inserts
 * `urn:openldr:valueset:location-status` under that publisher on every install, so the old check
 * ("any HL7 set?") skipped the catalog on every install migrated past 072. `importFhirCatalog` runs in
 * one transaction, so a catalog URL present means an import completed. The case this misses is an
 * operator importing one hl7.org set by hand before the first boot.
 */
export async function seedFhirValueSetCatalog(app: {
  terminology: { admin: { valueSets: Pick<TerminologyAdminStore['valueSets'], 'list' | 'importFhirCatalog'> } };
}): Promise<number> {
  try {
    const existing = await app.terminology.admin.valueSets.list(FHIR_PUBLISHER_ID);
    if (existing.some((vs) => vs.url.startsWith(FHIR_CATALOG_URL_PREFIX))) return 0;
    const catalog = await readBundledTerminology(BUNDLED_TERMINOLOGY.fhirR4Catalog);
    if (!catalog) {
      console.warn('[seed] FHIR R4 catalog fixture missing, so no value sets were imported');
      return 0;
    }
    const r = await app.terminology.admin.valueSets.importFhirCatalog(catalog);
    if (r.imported) console.log(`[seed] imported ${r.imported} FHIR R4 value set(s) (${r.skipped} already present)`);
    return r.imported;
  } catch (e) {
    console.warn('[seed] FHIR R4 catalog import skipped:', e instanceof Error ? e.message : String(e));
    return 0;
  }
}
```

In `seedBundledTerminology`, replace the whole `// (a) FHIR R4 base ValueSet catalog.` `try { … } catch { … }` block with:

```ts
  // (a) FHIR R4 base ValueSet catalog. Shared with seedEssentials, which runs it on every boot.
  valueSetsImported = await seedFhirValueSetCatalog(app);
```

- [ ] **Step 4: Into the essentials.** In `EssentialSeedTarget`, after `cfg`, add:

```ts
  // The FHIR R4 ValueSet catalog is an essential since S6: the form builder's standard bindings
  // (`lookupBinding`) are only useful when the sets are held. AppContext satisfies it.
  terminology: { admin: { valueSets: Pick<TerminologyAdminStore['valueSets'], 'list' | 'importFhirCatalog'> } };
```

`FormSeedTarget` declares a wider `terminology`, which still satisfies this one. Change `seedEssentials` so it also runs the catalog step and returns its count, keeping the comments already inside it:

```ts
export async function seedEssentials(app: EssentialSeedTarget): Promise<{ formsSeeded: number; workflowsSeeded: number; connectorsSeeded: number; valueSetsImported: number }> {
  const essentialForms = sampleForms.filter((f) => ESSENTIAL_FORM_NAMES.has(f.name));
  const { seeded: formsSeeded, orderFormId } = await upsertPublishedForms(app, essentialForms);
  const workflowsSeeded = await seedDefaultWorkflowsFor(app, orderFormId);
  const connectorsSeeded = await seedDefaultConnector(app);
  const valueSetsImported = await seedFhirValueSetCatalog(app);
  return { formsSeeded, workflowsSeeded, connectorsSeeded, valueSetsImported };
}
```

In `apps/server/src/index.ts`, change the essentials call to read and log the new count:

```ts
      const { formsSeeded, workflowsSeeded, connectorsSeeded, valueSetsImported } = await seedEssentials(ctx);
      logger.info({ formsSeeded, workflowsSeeded, connectorsSeeded, valueSetsImported }, 'essential seed complete (SEED_ON_START off)');
```

- [ ] **Step 5: Run, watch them pass.** Same command as Step 2. Then:

```bash
pnpm --filter @openldr/bootstrap typecheck > /tmp/s6-t2-boot-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server typecheck > /tmp/s6-t2-srv-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server lint > /tmp/s6-t2-lint.txt 2>&1; echo "exit=$?"
```

All three must print `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "fix(bootstrap): import FHIR's ValueSets on every boot, past migration 072's own HL7 set"`

---

### Task 3: The studio's binding helpers

**Files:**
- Modify: `apps/studio/src/api.ts`
- Create: `apps/studio/src/forms-builder/valueSetBinding.ts`, `valueSetBinding.test.ts`

**Interfaces:**
- `api.ts`: `storedValueSetCodes(id: string): Promise<ExpandedCode[]>`, `findValueSetByUrl(url: string): Promise<ValueSetSummary | null>`.
- `valueSetBinding.ts`: `BINDING_STRENGTHS: readonly BindingStrength[]`, `LOCAL_OPTIONS_SYSTEM: string`, `strengthLocksCustomValue(s: BindingStrength): boolean`, `codesToOptions(codes: ExpandedCode[]): FormFieldOption[]`, `bindingUpdates(url: string, strength: BindingStrength, options: FormFieldOption[]): Partial<FormField>`, `autoBindApplies(field: FormField, binding: FhirBinding | null): boolean`, `suggestValueSetUrl(title: string): string`, `optionsToValueSetInput(p: { title: string; url: string; options: FormFieldOption[] }): ValueSetInput`.

- [ ] **Step 1: Failing test.** Create `valueSetBinding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import {
  LOCAL_OPTIONS_SYSTEM, autoBindApplies, bindingUpdates, codesToOptions, optionsToValueSetInput, suggestValueSetUrl,
} from './valueSetBinding';

const f = (extra: Partial<FormField> = {}): FormField => ({
  id: 'x', displayLabel: 'x', fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const REQUIRED = { valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender', strength: 'required' as const };

describe('codesToOptions', () => {
  it('uses the code when a display is missing', () => {
    expect(codesToOptions([
      { system: 's', code: 'a', display: 'A' },
      { system: 's', code: 'b', display: null },
    ])).toEqual([{ code: 'a', display: 'A' }, { code: 'b', display: 'b' }]);
  });
});

describe('bindingUpdates', () => {
  it('sets the URL, the strength and the options, and a required binding forbids custom values', () => {
    expect(bindingUpdates('u', 'required', [{ code: 'a', display: 'A' }])).toEqual({
      valueSetUrl: 'u', bindingStrength: 'required', valueSetOptions: [{ code: 'a', display: 'A' }], allowCustomValue: false,
    });
    expect(bindingUpdates('u', 'extensible', [])).not.toHaveProperty('allowCustomValue');
  });
});

describe('autoBindApplies', () => {
  it('binds a required or extensible element on an unbound field', () => {
    expect(autoBindApplies(f(), REQUIRED)).toBe(true);
    expect(autoBindApplies(f(), { ...REQUIRED, strength: 'extensible' })).toBe(true);
  });

  it('leaves preferred and example bindings to the author', () => {
    expect(autoBindApplies(f(), { ...REQUIRED, strength: 'preferred' })).toBe(false);
    expect(autoBindApplies(f(), { ...REQUIRED, strength: 'example' })).toBe(false);
  });

  it('never touches a bound field, a group, or a field that names a reference source', () => {
    expect(autoBindApplies(f({ valueSetUrl: 'v' }), REQUIRED)).toBe(false);
    expect(autoBindApplies(f({ fieldType: 'group' }), REQUIRED)).toBe(false);
    expect(autoBindApplies(f({ fieldType: 'reference', referenceTarget: 'http://loinc.org' }), REQUIRED)).toBe(false);
    expect(autoBindApplies(f(), null)).toBe(false);
  });
});

describe('saving typed options as a ValueSet', () => {
  it('suggests a local URL from the title', () => {
    expect(suggestValueSetUrl('Ward / Department')).toBe('urn:openldr:valueset:ward-department');
  });

  it('lists the options as local concepts, published by System', () => {
    expect(optionsToValueSetInput({ title: 'Ward', url: 'urn:openldr:valueset:ward', options: [{ code: 'opd', display: 'OPD' }] })).toEqual({
      url: 'urn:openldr:valueset:ward', name: 'ward', title: 'Ward', status: 'active', publisherId: 'pub-system',
      compose: { include: [{ system: LOCAL_OPTIONS_SYSTEM, concept: [{ code: 'opd', display: 'OPD' }] }] },
    });
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/valueSetBinding.test.ts`.

- [ ] **Step 3: API reads.** In `api.ts`, after `valueSetExportUrl`, add:

```ts
/**
 * A ValueSet's stored codes, read through the export route. It reads `valueset_expansions` as they
 * are. `expandValueSet` must not be used for this: it recomputes the codes from CE's own terms and
 * overwrites the stored ones, which empties a FHIR catalog set whose system CE holds no terms for.
 */
export async function storedValueSetCodes(id: string): Promise<ExpandedCode[]> {
  const resource = await authFetch(valueSetExportUrl(id)).then((r) =>
    okJson<{ expansion?: { contains?: { system: string; code: string; display?: string }[] } }>(r, 'read value set codes'),
  );
  return (resource.expansion?.contains ?? []).map((c) => ({ system: c.system, code: c.code, display: c.display ?? null }));
}

/** The held ValueSet with this canonical URL, or null. */
export async function findValueSetByUrl(url: string): Promise<ValueSetSummary | null> {
  return (await listValueSets()).find((v) => v.url === url) ?? null;
}
```

- [ ] **Step 4: Write `valueSetBinding.ts`.**

```ts
import type { FhirBinding } from '@openldr/fhir/paths';
import type { BindingStrength, FormField, FormFieldOption } from '@openldr/forms/pure';
import type { ExpandedCode, ValueSetInput } from '../api';

/**
 * What binding a field to a ValueSet does. Pure. Ported from corlix `lib/valueSetBinding.ts`.
 */

export const BINDING_STRENGTHS: readonly BindingStrength[] = ['required', 'extensible', 'preferred', 'example'];

/** Where "Save as a new ValueSet" anchors typed options. Migration 014 already seeds local codes on it. */
export const LOCAL_OPTIONS_SYSTEM = 'urn:openldr:cs:local';

/** `required` is the only strength that forbids a value outside the set. */
export function strengthLocksCustomValue(strength: BindingStrength): boolean {
  return strength === 'required';
}

export function codesToOptions(codes: ExpandedCode[]): FormFieldOption[] {
  return codes.map((c) => ({ code: c.code, display: c.display ?? c.code }));
}

/** The patch that binds a field: the link, the strength, and the set's stored codes as options. */
export function bindingUpdates(url: string, strength: BindingStrength, options: FormFieldOption[]): Partial<FormField> {
  const patch: Partial<FormField> = { valueSetUrl: url, bindingStrength: strength, valueSetOptions: options };
  if (strengthLocksCustomValue(strength)) patch.allowCustomValue = false;
  return patch;
}

/**
 * Whether picking a path auto-binds the field to FHIR's standard set. Only a `required` or
 * `extensible` binding does: preferred and example sets are illustrations, and some hold thousands
 * of codes. A bound field, a group, and a field that names a reference source are left alone
 * (operator ruling, 2026-09-14). Corlix auto-binds at every strength.
 */
export function autoBindApplies(field: FormField, binding: FhirBinding | null): boolean {
  if (!binding) return false;
  if (binding.strength !== 'required' && binding.strength !== 'extensible') return false;
  if (field.valueSetUrl) return false;
  if (field.fieldType === 'group') return false;
  if (field.referenceTarget) return false;
  return true;
}

export function suggestValueSetUrl(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'value-set';
  return `urn:openldr:valueset:${slug}`;
}

/** An enumerated ValueSet from a typed option list, on the local system. */
export function optionsToValueSetInput(p: { title: string; url: string; options: FormFieldOption[] }): ValueSetInput {
  return {
    url: p.url,
    name: p.url.split(/[:/]/).pop() || p.url,
    title: p.title,
    status: 'active',
    publisherId: 'pub-system',
    compose: { include: [{ system: LOCAL_OPTIONS_SYSTEM, concept: p.options.map((o) => ({ code: o.code, display: o.display })) }] },
  };
}
```

- [ ] **Step 5: Run, watch it pass.** Same command as Step 2, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "feat(studio): decide what binding a field to a ValueSet does"`

---

### Task 4: The Options block

**Files:**
- Create: `apps/studio/src/forms-builder/field-editor/OptionsBlock.tsx`, `OptionsBlock.test.tsx`
- Create: `apps/studio/src/forms-builder/field-editor/SaveOptionsAsValueSetSheet.tsx`
- Modify: `apps/studio/src/forms-builder/FieldEditorSheet.tsx` and its test

**Interfaces:** Produces `OptionsBlock({ field, surveyMode, onUpdate })` and `SaveOptionsAsValueSetSheet({ open, onOpenChange, options, fieldLabel, onSaved })`, where `onSaved: (url: string) => void`.

- [ ] **Step 1: Failing tests.** Create `OptionsBlock.test.tsx`:

```tsx
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';

const mocks = vi.hoisted(() => ({
  canManage: false,
  gender: {
    id: 'vs-g', url: 'http://hl7.org/fhir/ValueSet/administrative-gender', name: 'AdministrativeGender',
    title: 'AdministrativeGender', version: null, status: 'active', immutable: true, publisherId: 'pub-hl7-fhir',
    category: null, codeCount: 4, primarySystem: null,
  },
}));

vi.mock('../../api', () => ({
  listValueSets: vi.fn(async () => [mocks.gender]),
  storedValueSetCodes: vi.fn(async () => [
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'male', display: 'Male' },
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: 'Female' },
  ]),
  saveValueSet: vi.fn(async (input: { url: string }) => ({ id: 'vs-new', url: input.url })),
}));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: () => mocks.canManage }) }));

import * as api from '../../api';
import { OptionsBlock } from './OptionsBlock';

const SELECT: FormField = {
  id: 'sex', displayLabel: 'Sex', fieldType: 'select', required: false, enabled: true, fhirPath: null,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
};

function Harness({ field, surveyMode, onUpdate }: { field: FormField; surveyMode: boolean; onUpdate: (p: Partial<FormField>) => void }) {
  const [current, setCurrent] = useState(field);
  return <OptionsBlock field={current} surveyMode={surveyMode} onUpdate={(p) => { onUpdate(p); setCurrent((f) => ({ ...f, ...p })); }} />;
}

function renderBlock(extra: Partial<FormField> = {}, surveyMode = false) {
  const onUpdate = vi.fn();
  render(<Harness field={{ ...SELECT, ...extra }} surveyMode={surveyMode} onUpdate={onUpdate} />);
  return { onUpdate };
}

function clickMenu(item: string) {
  const trigger = screen.getByRole('button', { name: 'Options actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('OptionsBlock', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.canManage = false; });

  it('binds a picked set, copying its stored codes', async () => {
    const { onUpdate } = renderBlock();
    fireEvent.focus(screen.getByLabelText('Bind to a ValueSet…'));
    fireEvent.click((await screen.findByText('AdministrativeGender')).closest('button')!);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      valueSetUrl: mocks.gender.url, bindingStrength: 'extensible',
      valueSetOptions: [{ code: 'male', display: 'Male' }, { code: 'female', display: 'Female' }],
    }));
    expect(api.storedValueSetCodes).toHaveBeenCalledWith('vs-g');
    expect(await screen.findByText('2 codes from AdministrativeGender')).toBeTruthy();
  });

  it('a required strength forbids custom values', async () => {
    const { onUpdate } = renderBlock({ valueSetUrl: mocks.gender.url, bindingStrength: 'extensible', valueSetOptions: [{ code: 'male', display: 'Male' }] });
    fireEvent.click(screen.getByRole('combobox', { name: 'Strength' }));
    fireEvent.click(await screen.findByRole('option', { name: 'required' }));
    expect(onUpdate).toHaveBeenCalledWith({ bindingStrength: 'required', allowCustomValue: false });
  });

  it('Unbind keeps the options and drops the link', () => {
    const { onUpdate } = renderBlock({ valueSetUrl: mocks.gender.url, bindingStrength: 'required', valueSetOptions: [{ code: 'male', display: 'Male' }] });
    clickMenu('Unbind');
    expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: undefined, bindingStrength: undefined });
    expect(screen.getByDisplayValue('male')).toBeTruthy();
  });

  it("Load from terminology fills the options from the element's standard set, without binding", async () => {
    const { onUpdate } = renderBlock({ fhirPath: 'Patient.gender' });
    await screen.findByRole('button', { name: 'Options actions' });
    clickMenu('Load from terminology');
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      valueSetOptions: [{ code: 'male', display: 'Male' }, { code: 'female', display: 'Female' }],
    }));
  });

  it('offers no Load from terminology on a survey form', () => {
    renderBlock({ fhirPath: 'Patient.gender' }, true);
    expect(screen.queryByRole('button', { name: 'Options actions' })).toBeNull();
  });

  it('offers Save as a new ValueSet only to a user who may manage terminology', () => {
    renderBlock({ valueSetOptions: [{ code: 'opd', display: 'OPD' }] });
    expect(screen.queryByRole('button', { name: 'Options actions' })).toBeNull();
  });

  it('saves typed options as a set and binds the field to it', async () => {
    mocks.canManage = true;
    const { onUpdate } = renderBlock({ displayLabel: 'Ward', valueSetOptions: [{ code: 'opd', display: 'OPD' }] });
    clickMenu('Save as a new ValueSet');
    const trigger = await screen.findByRole('button', { name: 'Save actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Save' })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(api.saveValueSet).toHaveBeenCalledWith(expect.objectContaining({ url: 'urn:openldr:valueset:ward', title: 'Ward' })));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: 'urn:openldr:valueset:ward', bindingStrength: 'extensible' }));
  });
});
```

The survey test holds whenever it runs: on a survey form there is no standard binding, so the `⋯` never has an action to show.

In `FieldEditorSheet.test.tsx`, add `listValueSets: vi.fn(async () => [])` to the `vi.mock('../api', …)` factory, next to `listCodingSystems`. `ValueSetPicker` has no `.catch`, so a real fetch failing there would surface as an unhandled rejection.

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/OptionsBlock.test.tsx`.

- [ ] **Step 3: Write `SaveOptionsAsValueSetSheet.tsx`.**

```tsx
import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { FormFieldOption } from '@openldr/forms/pure';
import { saveValueSet } from '../../api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { optionsToValueSetInput, suggestValueSetUrl } from '../valueSetBinding';

/**
 * Turn a field's typed options into a reusable ValueSet and bind the field to it. Ported from corlix
 * `SaveOptionsAsValueSetDialog.tsx`, as a Sheet with Save and Cancel in its ⋯ menu (AGENTS.md §5).
 * Saving needs `terminology.manage` on the server; the Options block offers it only to a user who
 * holds it.
 */
export function SaveOptionsAsValueSetSheet({
  open,
  onOpenChange,
  options,
  fieldLabel,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: FormFieldOption[];
  fieldLabel: string;
  onSaved: (url: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState(fieldLabel);
  const [url, setUrl] = useState(suggestValueSetUrl(fieldLabel));
  const [urlTouched, setUrlTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(fieldLabel);
    setUrl(suggestValueSetUrl(fieldLabel));
    setUrlTouched(false);
    setError(null);
  }, [open, fieldLabel]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveValueSet(optionsToValueSetInput({ title: title.trim(), url: url.trim(), options }));
      onSaved(saved.url);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the ValueSet.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>Save as a new ValueSet</SheetTitle>
          <SheetDescription>{`Create a reusable ValueSet from ${options.length} options and bind this field to it.`}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">ValueSet</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Save actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={saving || !title.trim() || !url.trim()} onSelect={() => void save()}>Save</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenChange(false)}>Cancel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-6 py-4">
          <Label htmlFor="vs-save-title" className="whitespace-nowrap">Title</Label>
          <Input
            id="vs-save-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!urlTouched) setUrl(suggestValueSetUrl(e.target.value));
            }}
          />
          <Label htmlFor="vs-save-url" className="whitespace-nowrap">Canonical URL</Label>
          <Input
            id="vs-save-url"
            className="font-mono text-xs"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlTouched(true);
            }}
          />
        </div>
        {error && <p role="alert" className="px-6 text-xs text-destructive">{error}</p>}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Write `OptionsBlock.tsx`.**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { lookupBinding } from '@openldr/fhir/paths';
import type { BindingStrength, FormField } from '@openldr/forms/pure';
import { listValueSets, storedValueSetCodes, type ValueSetSummary } from '../../api';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ValueSetPicker } from '../../terminology/ValueSetPicker';
import { OptionsEditor } from './OptionsEditor';
import { SaveOptionsAsValueSetSheet } from './SaveOptionsAsValueSetSheet';
import { BINDING_STRENGTHS, bindingUpdates, codesToOptions, strengthLocksCustomValue } from '../valueSetBinding';

/**
 * The Options block of a select or multiselect field: its ValueSet binding and its option list.
 * Ported from corlix `components/ValueSetBinding.tsx`, with its actions in the block's ⋯ menu
 * (AGENTS.md §5). Binding copies the set's stored codes into the options, read through the export
 * route and never recomputed (spec S6), which is also why corlix's Re-expand is left out.
 */
export function OptionsBlock({
  field,
  surveyMode,
  onUpdate,
}: {
  field: FormField;
  surveyMode: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
}): JSX.Element {
  const { hasCapability } = useAuth();
  const [sets, setSets] = useState<ValueSetSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void listValueSets()
      .then((rows) => { if (alive) setSets(rows); })
      .catch(() => { /* the title and the standard set are niceties; binding still works through the picker */ });
    return () => { alive = false; };
  }, []);

  const bound = useMemo(() => sets.find((s) => s.url === field.valueSetUrl) ?? null, [sets, field.valueSetUrl]);
  // A survey question points at no resource, so it has no standard binding (spec S6, as corlix P15.1).
  const standard = surveyMode ? null : lookupBinding(field.fhirPath);
  const standardHeld = useMemo(
    () => (standard ? sets.find((s) => s.url === standard.valueSet) ?? null : null),
    [sets, standard],
  );
  const strength: BindingStrength = field.bindingStrength ?? 'extensible';
  const hasOptions = (field.valueSetOptions?.length ?? 0) > 0;
  const canSave = hasOptions && !field.valueSetUrl && hasCapability('terminology.manage');

  const readCodes = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      return codesToOptions(await storedValueSetCodes(id));
    } catch {
      setError('Could not read the ValueSet codes.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const bind = async (vs: ValueSetSummary) => {
    const options = await readCodes(vs.id);
    if (options) onUpdate(bindingUpdates(vs.url, strength, options));
  };

  /** The spec's "Load from terminology": the standard set's codes as options, without binding. */
  const loadStandard = async () => {
    if (!standardHeld) return;
    const options = await readCodes(standardHeld.id);
    if (options) onUpdate({ valueSetOptions: options });
  };

  const changeStrength = (s: BindingStrength) => {
    onUpdate(strengthLocksCustomValue(s) ? { bindingStrength: s, allowCustomValue: false } : { bindingStrength: s });
  };

  // Unbind keeps the copied options and drops only the link and the strength, as corlix does.
  const unbind = () => {
    onUpdate({ valueSetUrl: undefined, bindingStrength: undefined });
    setError(null);
  };

  const hasActions = Boolean(standardHeld) || Boolean(field.valueSetUrl) || canSave;

  return (
    <>
      <div className="border-t border-border" />
      <div className="flex items-center justify-between px-6 py-3">
        <h3 className="text-sm font-medium text-foreground">Options</h3>
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Options actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {standardHeld && (
                <DropdownMenuItem disabled={busy} onSelect={() => void loadStandard()}>Load from terminology</DropdownMenuItem>
              )}
              {field.valueSetUrl && <DropdownMenuItem onSelect={unbind}>Unbind</DropdownMenuItem>}
              {canSave && <DropdownMenuItem onSelect={() => setSaveOpen(true)}>Save as a new ValueSet</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="border-t border-border" />
      <div className="px-6 py-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-3">
          <Label className="whitespace-nowrap">ValueSet</Label>
          {field.valueSetUrl ? (
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {`${field.valueSetOptions?.length ?? 0} codes from ${bound?.title ?? bound?.name ?? field.valueSetUrl}`}
              </p>
              {!bound && <p className="truncate text-xs text-muted-foreground">Not held on this install, so its codes cannot be read.</p>}
            </div>
          ) : (
            <ValueSetPicker onPick={(vs) => void bind(vs)} placeholder="Bind to a ValueSet…" />
          )}
          {field.valueSetUrl && (
            <>
              <Label htmlFor="options-strength" className="whitespace-nowrap">Strength</Label>
              <Select value={strength} onValueChange={(v) => changeStrength(v as BindingStrength)}>
                <SelectTrigger id="options-strength" aria-label="Strength">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BINDING_STRENGTHS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        {error && <p role="alert" className="pb-2 text-xs text-destructive">{error}</p>}
        <OptionsEditor field={field} onUpdate={onUpdate} />
      </div>
      <SaveOptionsAsValueSetSheet
        open={saveOpen}
        onOpenChange={setSaveOpen}
        options={field.valueSetOptions ?? []}
        fieldLabel={field.displayLabel}
        onSaved={(url) => {
          const s = field.bindingStrength ?? 'extensible';
          onUpdate(strengthLocksCustomValue(s) ? { valueSetUrl: url, bindingStrength: s, allowCustomValue: false } : { valueSetUrl: url, bindingStrength: s });
        }}
      />
    </>
  );
}
```

- [ ] **Step 5: Use it.** In `FieldEditorSheet.tsx`, replace the whole `{/* ── Options / Value-set section ── */}` block with:

```tsx
        {(activeDraft.fieldType === 'select' || activeDraft.fieldType === 'multiselect') && (
          <OptionsBlock field={activeDraft} surveyMode={isSurveyForm(fhirResourceType)} onUpdate={patchDraft} />
        )}
```

Import `OptionsBlock` from `./field-editor/OptionsBlock`, and drop the `OptionsEditor` import if nothing else in the file uses it.

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 7: Commit.** `git commit -m "feat(studio): bind a field's options to a ValueSet picked from a list"`

---

### Task 5: Mapping's "bound:" line, and auto-bind

**Files:** Modify `apps/studio/src/forms-builder/field-editor/MappingEditor.tsx` and its test, `FieldEditorSheet.tsx` and its test.

**Interfaces:** Consumes `lookupBinding`, `autoBindApplies`, `bindingUpdates`, `codesToOptions`, `findValueSetByUrl`, `storedValueSetCodes`.

- [ ] **Step 1: Failing tests.** In `MappingEditor.test.tsx`, delete the `describe('valueSetUrl input', …)` and `describe('bindingStrength Select', …)` blocks: those controls leave Mapping. Add:

```tsx
  describe('standard binding', () => {
    it('shows the set FHIR binds the path to, and how strongly', () => {
      render(<Harness field={{ ...BASE_FIELD, fhirPath: 'Patient.gender' }} fhirResourceType="Patient" onUpdate={vi.fn()} />);
      expect(screen.getByTestId('fhir-path-binding').textContent).toBe('bound: administrative-gender required');
    });

    it('shows nothing for a path FHIR does not bind', () => {
      render(<Harness field={{ ...BASE_FIELD, fhirPath: 'Patient.name' }} fhirResourceType="Patient" onUpdate={vi.fn()} />);
      expect(screen.queryByTestId('fhir-path-binding')).toBeNull();
    });

    it('no longer has a free-text ValueSet box or a strength select', () => {
      render(<Harness field={BASE_FIELD} fhirResourceType="Patient" onUpdate={vi.fn()} />);
      expect(screen.queryByLabelText('Value Set URL')).toBeNull();
      expect(screen.queryByLabelText('Binding Strength')).toBeNull();
    });
  });
```

In `FieldEditorSheet.test.tsx`, replace the `vi.mock('../api', …)` factory with one fed by hoisted values, so the auto-bind tests can control it:

```tsx
const vsMocks = vi.hoisted(() => ({
  gender: {
    id: 'vs-g', url: 'http://hl7.org/fhir/ValueSet/administrative-gender', name: 'AdministrativeGender',
    title: 'AdministrativeGender', version: null, status: 'active', immutable: true, publisherId: 'pub-hl7-fhir',
    category: null, codeCount: 2, primarySystem: null,
  },
}));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listCodingSystems: vi.fn(async () => []),
  listValueSets: vi.fn(async () => [vsMocks.gender]),
  findValueSetByUrl: vi.fn(async (url: string) => (url === vsMocks.gender.url ? vsMocks.gender : null)),
  storedValueSetCodes: vi.fn(async () => [
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'male', display: 'Male' },
    { system: 'http://hl7.org/fhir/administrative-gender', code: 'female', display: 'Female' },
  ]),
}));
```

Add `import * as api from '../api';`, add `beforeEach` to the vitest import and `waitFor` to the Testing Library import, and append inside the outer `describe`:

```tsx
  describe('auto-bind', () => {
    beforeEach(() => vi.mocked(api.findValueSetByUrl).mockClear());

    function saveDraft() {
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) fireEvent.keyDown(trigger, { key: 'Enter' });
      fireEvent.click(screen.getByText('Save'));
    }

    it('picking a required-bound path makes the field a select over the held set', async () => {
      const { onSave } = renderSheet({ fhirResourceType: 'Patient' });
      fireEvent.change(screen.getByLabelText('FHIR Path'), { target: { value: 'Patient.gender' } });
      expect(await screen.findByDisplayValue('male')).toBeTruthy();
      saveDraft();
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        fieldType: 'select', valueSetUrl: vsMocks.gender.url, bindingStrength: 'required', allowCustomValue: false,
      }));
    });

    it('leaves an example-bound path to the author', async () => {
      renderSheet({ fhirResourceType: 'ServiceRequest' });
      fireEvent.change(screen.getByLabelText('FHIR Path'), { target: { value: 'ServiceRequest.code' } });
      await waitFor(() => expect(screen.getByLabelText('FHIR Path')).toHaveValue('ServiceRequest.code'));
      expect(api.findValueSetByUrl).not.toHaveBeenCalled();
    });

    it('leaves a field that names a reference source alone', async () => {
      renderSheet({ fhirResourceType: 'Patient', field: { ...BASE_FIELD, fieldType: 'reference', referenceTarget: 'http://loinc.org' } });
      fireEvent.change(screen.getByLabelText('FHIR Path'), { target: { value: 'Patient.gender' } });
      await waitFor(() => expect(screen.getByLabelText('FHIR Path')).toHaveValue('Patient.gender'));
      expect(api.findValueSetByUrl).not.toHaveBeenCalled();
    });
  });
```

`ServiceRequest.code` is bound at `example` strength in FHIR R4. If Task 1's table says otherwise, use a path it lists as `example` and say so in the report.

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/MappingEditor.test.tsx src/forms-builder/FieldEditorSheet.test.tsx`.

- [ ] **Step 3: Mapping.** In `MappingEditor.tsx`:
- Import `lookupBinding` from `@openldr/fhir/paths` beside `fhirPathOptionsFor`.
- Delete the `{/* Value Set URL */}` label and input, the `{/* Binding Strength */}` label and select, and the `BINDING_STRENGTHS` constant. Remove any import that is then unused; the typecheck will name it.
- After `const currentDefinition = …`, add `const binding = lookupBinding(field.fhirPath);`.
- Under the `currentDefinition` paragraph, inside the FHIR Path cell, add:

```tsx
            {/* FHIR's own binding for this element, named by its URL's last segment, as corlix does. */}
            {binding && (
              <p data-testid="fhir-path-binding" className="mt-1 text-xs text-muted-foreground">
                {`bound: ${binding.valueSet.split('/').pop()} ${binding.strength}`}
              </p>
            )}
```

- [ ] **Step 4: Auto-bind.** In `FieldEditorSheet.tsx`:
- Import `lookupBinding` from `@openldr/fhir/paths`, `findValueSetByUrl` and `storedValueSetCodes` from `../api`, and `autoBindApplies`, `bindingUpdates`, `codesToOptions` from `./valueSetBinding`. Add `useRef` to the React import if it is not there.
- Before the `return`, add:

```tsx
  // Auto-bind: picking a path whose element FHIR binds `required` or `extensible` to a set CE holds
  // makes the field a select over that set's stored codes. Corlix `FieldEditor.tsx:562-573`, narrowed
  // by the operator's ruling of 2026-09-14. A later path change wins over an earlier lookup.
  const autoBindToken = useRef(0);
  const onMappingUpdate = (patch: Partial<FormField>) => {
    patchDraft(patch);
    if (!('fhirPath' in patch) || !patch.fhirPath || isSurveyForm(fhirResourceType)) return;
    const binding = lookupBinding(patch.fhirPath);
    if (!binding || !autoBindApplies(activeDraft, binding)) return;
    const token = ++autoBindToken.current;
    const fieldType = activeDraft.fieldType === 'multiselect' ? 'multiselect' : 'select';
    void (async () => {
      const held = await findValueSetByUrl(binding.valueSet);
      if (!held || token !== autoBindToken.current) return;
      const codes = await storedValueSetCodes(held.id);
      if (token !== autoBindToken.current) return;
      patchDraft({ ...bindingUpdates(held.url, binding.strength, codesToOptions(codes)), fieldType });
    })().catch(() => { /* a failed lookup leaves the field as the author left it */ });
  };
```

- Pass `onUpdate={onMappingUpdate}` to `<MappingEditor>` instead of `patchDraft`.

If `activeDraft` or `patchDraft` have other names in this file, use those; they are the draft field and the function that patches it.

- [ ] **Step 5: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "feat(studio): show FHIR's binding for a path, and bind to it when FHIR requires one"`

---

### Task 6: A ValueSet for a reference field

**Files:** Modify `apps/studio/src/forms-builder/field-editor/ReferenceEditor.tsx` and its test.

- [ ] **Step 1: Failing tests.** In `ReferenceEditor.test.tsx`, add `listValueSets` to the `vi.mock('../../api', …)` factory:

```tsx
  listValueSets: vi.fn(async () => [{
    id: 'vs-country', url: 'urn:openldr:valueset:country', name: 'country', title: 'Country', version: null,
    status: 'active', immutable: false, publisherId: 'pub-system', category: null, codeCount: 250, primarySystem: null,
  }]),
```

`ValueSetPicker` imports the same module, so it reads this mock too. Append inside the `describe`:

```tsx
  it('binds a ValueSet picked from the list, copying no codes', async () => {
    const { onUpdate } = renderRef();
    fireEvent.focus(screen.getByLabelText('Search a ValueSet…'));
    fireEvent.click((await screen.findByText('Country')).closest('button')!);
    expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: 'urn:openldr:valueset:country' });
  });

  it('shows the bound set and unbinds it from its row menu', async () => {
    const { onUpdate } = renderRef({ valueSetUrl: 'urn:openldr:valueset:country' });
    expect(await screen.findByText('Country')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Value Set actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unbind' }));
    expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: undefined });
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/field-editor/ReferenceEditor.test.tsx`.

- [ ] **Step 3: The row.** In `ReferenceEditor.tsx`:
- Import `MoreHorizontal` from `lucide-react`, `listValueSets` and `type ValueSetSummary` from `../../api`, `Button` from `@/components/ui/button`, `TruncatedText` from `@/components/ui/truncated-text`, the `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem` and `DropdownMenuTrigger` parts from `@/components/ui/dropdown-menu`, and `ValueSetPicker` from `../../terminology/ValueSetPicker`.
- Add `const [sets, setSets] = useState<ValueSetSummary[]>([]);`, and in the existing effect, beside `listCodingSystems`, load them the same way: `void listValueSets().then((rows) => { if (alive) setSets(rows); }).catch(() => { /* the title is a nicety */ });`.
- Add `const boundSet = sets.find((s) => s.url === field.valueSetUrl) ?? null;`.
- Add one paragraph to the component's doc comment: "A reference field can search a ValueSet instead of a Target. It searches the set live (`reference-source.ts`), so binding copies no codes. When both are set, the ValueSet wins and the linter warns (`lint.ts:117`)."
- After the Target `Select`, add:

```tsx
      <Label className="whitespace-nowrap">Value Set</Label>
      {field.valueSetUrl ? (
        <div className="flex min-w-0 items-center gap-1">
          <TruncatedText text={boundSet?.title ?? boundSet?.name ?? field.valueSetUrl} className="min-w-0 flex-1 text-sm" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Value Set actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onUpdate({ valueSetUrl: undefined })}>Unbind</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <ValueSetPicker onPick={(vs) => onUpdate({ valueSetUrl: vs.url })} placeholder="Search a ValueSet…" />
      )}
```

- [ ] **Step 4: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 5: Commit.** `git commit -m "feat(studio): pick a ValueSet for a reference field"`

---

### Task 7: Docs

**Files:** `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`.

- [ ] **Step 1: English.** In `en/forms.md`, insert this section directly after the `## Editing a field` section:

```md
## Options and ValueSets

- A select or multiselect field can take its options from a ValueSet. In the Options block, search for a set and pick it. Its codes are copied into the options, and the field keeps a link to the set with a strength. A required strength stops data entry accepting other values.
- **Unbind**, in the Options ⋯ menu, drops the link and keeps the options. **Save as a new ValueSet** turns typed options into a set you can reuse; it shows only if you may manage terminology.
- Under the FHIR path, **bound:** names the ValueSet FHIR itself binds that element to, and how strongly. **Load from terminology**, in the Options ⋯ menu, fills the options from that set.
- Picking a path FHIR binds as required or extensible, on a field with no ValueSet, binds it for you and makes it a select. Preferred and example bindings are left to you, and so is a field that already names a reference source.
- A reference field picks its ValueSet in the Reference Configuration block. It searches the set live, so nothing is copied.
- Every install holds FHIR's 672 standard ValueSets. Survey forms have no bound elements, so they show no **bound:** line.
```

- [ ] **Step 2: French and Portuguese.** Translate the section into `fr/forms.md` and `pt/forms.md`, directly after `## Modifier un champ` and `## Editar um campo`. Keep UI labels in English, as those files already do: **Unbind**, **Save as a new ValueSet**, **bound:**, **Load from terminology**. Keep the same number of bullets as the English.

- [ ] **Step 3: Web.** In `apps/web/src/docs/0.1.8/forms.md`, add each language's section directly after that language's `### Editing a field`, `### Modifier un champ` and `### Editar um campo`, with a `###` heading.

- [ ] **Step 4: Run the docs tests.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git commit -m "docs(forms): describe ValueSet binding, FHIR's standard bindings, and the catalog on every install"`

---

### Task 8: Verify, merge, changelog

- [ ] **Step 1: Gates and lint on the branch.**

```bash
pnpm turbo run test --force > /tmp/s6-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s6-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server lint > /tmp/s6-lint.txt 2>&1; echo "exit=$?"
```

All three must print `exit=0`. Read each turbo `Tasks:` line: turbo stops at the first failure, so a short count means packages did not run. On a test failure, run `grep -n "Test timed out\|Unhandled Errors" /tmp/s6-test.txt` first, and re-run that package alone.

- [ ] **Step 2: A real boot, and the timing the spec asked for.** `preview_start` the `api` configuration, then `studio`. `preview_logs` for the `api` must show no seed error. The dev database already holds the catalog, so the log shows `valueSetsImported: 0`; a fresh install is covered by `seed-fhir-catalog.test.ts`, not by this boot. The operator signs in; never type credentials. In the studio tab:

```js
const api = await import('/studio/src/api.ts');
const sets = await api.listValueSets();
const biggest = [...sets].sort((a, b) => b.codeCount - a.codeCount)[0];
const t0 = performance.now();
const codes = await api.storedValueSetCodes(biggest.id);
const ms = Math.round(performance.now() - t0);
const gender = await api.findValueSetByUrl('http://hl7.org/fhir/ValueSet/administrative-gender');
const genderCodes = gender ? await api.storedValueSetCodes(gender.id) : null;
({ hl7: sets.filter((s) => s.url.startsWith('http://hl7.org/fhir/ValueSet/')).length, biggest: biggest.codeCount, read: codes.length, ms, gender: genderCodes?.map((c) => c.code) });
```

Expected: 672 catalog sets, the largest set read in full (`read` equals `biggest`), and gender's four codes. Report `ms`. Under 1,000 ms answers the spec's open question; over it, report the number and stop before building on the export route.

Then run the `gender` lines again. The four codes must still be there. That is the proof the builder's read never triggers the recompute.

- [ ] **Step 3: Browser, desktop.** `resize_window` to 1600x900. On a new `Patient` form, add a field and open its editor. Check:

- Mapping has no Value Set URL box and no Binding Strength select.
- Pick FHIR Path `Patient.gender`. Under it: `bound: administrative-gender required`. The field turns into a select, the Options block shows "4 codes from AdministrativeGender", Strength reads `required`, and the options are male, female, other and unknown.
- The Options `⋯` has Load from terminology and Unbind. Unbind keeps the four options and shows the picker again. Pick "AdministrativeGender" in the picker: it binds again.
- On a `ServiceRequest` form, a reference field with Target `http://loinc.org` and path `ServiceRequest.code` stays a reference field, with a `bound:` line naming the example set.
- On the seeded Facility form, open Country: the Reference block's Value Set row shows Country, and its `⋯` has Unbind.
- Signed in as a user with `terminology.manage`: on a select with typed options and no binding, the Options `⋯` has Save as a new ValueSet. It opens a right sheet with Title, Canonical URL and its own `⋯`. Save it; the field binds to the new set. Delete that set afterwards from the Terminology page.

- [ ] **Step 4: Phone.** `resize_window` preset `mobile` and reload. Open a select field's editor. The ValueSet picker's list fits the sheet and nothing scrolls sideways (`document.documentElement.scrollWidth === innerWidth`). Reset with preset `desktop`. Nothing in S6 is anchored to the bottom edge.

Delete any throwaway forms with `api.deleteForm(id)`. Stop both servers before the gates on `main`.

- [ ] **Step 5: Merge, gates on main, changelog.**

```bash
git switch main
git merge --no-ff feat/form-builder-s6 -m "Merge branch 'feat/form-builder-s6'"
pnpm turbo run test --force > /tmp/s6-main-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s6-main-tc.txt 2>&1; echo "exit=$?"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S6 merge"
git branch -d feat/form-builder-s6
```

Both gates must print `exit=0` before the changelog commit. Do not push.

- [ ] **Step 6: Report.** The commits, which route produced `r4-bindings.generated.ts`, every gate and lint result with the command and exit code, the timing and survival output, screenshots, anything that was stopped rather than fixed, and a plain line that nothing in S6 is bottom-anchored.

---

## Side list (not S6 work)

- **`GET /api/terminology/valuesets/:id/expand` needs no capability, and it rewrites the stored codes** (`terminology-admin-routes.ts:407-412`, `terminology-admin-store.ts:1017-1021`). Any signed-in user can empty a FHIR catalog set by calling it. This confirms the S3 side-list note about `terminology/ValueSetBuilder.tsx:103`. It needs its own falsification pass and fix.
- **Installs migrated past 072 with `SEED_ON_START` on never got the FHIR catalog** under the old check. S6's fix imports it on their next boot. Worth a line in the release notes.
- **Corlix has an "Allow custom value" checkbox** in its Options block, disabled under a required binding. CE has no control for `allowCustomValue`. After unbinding a required set, an author cannot turn custom values back on in the builder.
- **The export route does not order its rows** (`terminology-admin-store.ts:1071`), so bound options come in stored order. It has been stable on Postgres in practice; nothing guarantees it.
- **Carried from S3 to S5:** the Library search emptying at 980px, the `dhis2-sink-ui` teardown error, the data-entry step, the Lab order seed drift, the narrow condition inputs at 375px, `LoadingState`'s stripes, the Orders page's id keys.
