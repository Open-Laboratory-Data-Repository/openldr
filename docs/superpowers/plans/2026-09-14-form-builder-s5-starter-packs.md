# Form builder S5: starter packs

**Status:** merged to `main` on 2026-09-14 as `5f311e08`. The checkboxes below were not ticked while the work ran, so they do not show what was done. Git history does.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The operator prefers inline execution, one task at a time.

**Goal:** Offer a pre-checked list of fields when a form starts, one pack per resource type, and list the pack entries a form lacks at the top of the Library, as corlix does.

**Architecture:** Migration `099_starter_packs` adds two tables. The pack content is built in `packages/forms` from the forms OpenLDR already seeds, and boot writes it into the tables on every start. A small store reads it, and two read-only routes serve it. The studio fetches the pack for the form's resource type, opens a chooser sheet on an empty form, and adds a "Left out of the pack" group to the Library.

**Tech Stack:** TypeScript, Kysely, pg-mem, Fastify, vitest, React 18, Testing Library, Radix via shadcn `components/ui`.

**Spec:** `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, section 5, S5. Rows A5, A6, and the pack half of A10.

## Read this first: state when this plan was written

- Written 2026-09-14 at `main` `04c76e3c`, **before S4 ran.** The spec asks for each plan to be written just before its slice starts; the operator asked for this one early. Run it only after S4 is merged, which Task 0 checks. S5 edits `FormBuilderPage.tsx`, which S4 changes a lot, so the page steps below use S4's names (`openEditor`) and anchor on code S4 leaves alone (`addFromLibrary`, `BuilderHeader`, `LibraryPane`). If an anchor is missing, stop and report; do not guess where it went.
- Corlix is at `~/Projects/Repositories/corlix`. Its source for this slice is `apps/desktop/src/main/starter-packs.ts`, `apps/desktop/src/renderer/lib/packToFields.ts`, `lib/libraryEntries.ts:73-89`, `components/form-builder/StarterPackChooser.tsx`, `components/form-builder/LibraryPane.tsx` and `pages/FormBuilderPage.tsx:386-437,2112-2121`.
- A `pre:edit-write` GateGuard hook blocks the first Edit or Write to each file until you state four facts: the importers, the public names affected, any data files read, and the operator's instruction. Answer it and retry. Its loop and scope warnings are noise.
- A separate session is investigating why the studio sometimes reloads onto the Dashboard. If that happens during the browser checks, re-open the builder and carry on.

## RULE 0: each gap, checked 2026-09-14

| Row | The fact that would make it not real | What the code says |
|---|---|---|
| A5 | Starter packs exist somewhere | The only hit for `starter.pack` in `apps` and `packages` is a comment in `LibraryPane.tsx` saying S5 adds it |
| A6 | The builder already has a pack chooser to fix | None exists |
| A10, pack half | The Library already has a pack group | `LibraryPane.tsx` lists FHIR elements only |

Two spec claims failed the same check. The operator ruled on both on 2026-09-14.

1. **The spec's entry columns cannot make the Lab order pack's reference fields work.** The Lab order form's Patient points at `Patient`, and its Tests point at `http://loinc.org`, several per order (`samples/forms.ts:320,335-338`). A `reference` field with neither a ValueSet nor a target is a publish-blocking lint error (`lint.ts:108-116`). The spec's columns hold neither value. **Ruling:** migration 099 adds `reference_target` and `reference_multiple`.
2. **Ward / Department cannot go in a pack.** Its options are local codes (`opd`, `ipd`, `icu`, `samples/forms.ts:370-374`). `ServiceRequest.locationCode` is a CodeableConcept with no FHIR list behind it (`r4-paths.generated.ts:1254`), and AGENTS.md §8 forbids codes in a seed. **Ruling:** the Lab order pack leaves it out. The Library still offers `ServiceRequest.locationCode`.

Also checked:
- **Migration number.** The last internal migration is `098_auth_issuer_binding`. `git branch -a --no-merged main` printed nothing. Task 0 checks both again.
- **Where boot seeds data that needs a database handle.** Unconditional, best-effort seeds sit in `packages/bootstrap/src/index.ts`, beside `seedColumnExposurePolicy(internal.db)`. `seedEssentials` gets a forms and workflows surface with no database handle (`bootstrap/src/index.ts:648-655`), so packs cannot go there.
- **Coded fields need no codes in the seed.** `Patient.gender` and `ServiceRequest.priority` are `code` elements whose labels are their FHIR lists (`r4-paths.generated.ts:974,1339`). S3's `codeOptionsFromLabel` turns those into options.
- **The sample forms lint clean.** `samples/forms.test.ts:260` asserts no sample form has a lint error, so a pack built from one should not either. Task 5 proves it for each whole pack.

## Global Constraints

- Match corlix's shipped behavior, except where the spec and the two rulings above say otherwise. Add nothing beyond them.
- A pack stores no codes (AGENTS.md §8). Pack content comes only from `packages/forms/src/samples/forms.ts`.
- Packs are read-only. No pack editing, no CLI command (spec section 4).
- UI strings are plain English literals, like the rest of `forms-builder`. No i18n keys.
- shadcn components only in new app code. Never a native `<button>`, `<select>`, `<input>` or `<dialog>`.
- Sheet and header actions go in a `⋯` `DropdownMenu` (AGENTS.md §5). The chooser is a Sheet with no footer.
- Empty uses `StripedEmpty`; loading uses `LoadingState` (AGENTS.md §5).
- Adding a pack is one undo step.
- Kysely migrations run in strict number order. A gap blocks boot.
- Never pipe turbo through `tail`. Never read `$?` through a pipe. Redirect to a file, then echo the exit code.
- No `Co-Authored-By` trailers on commits (AGENTS.md §9).
- Work on branch `feat/form-builder-s5`. Merge to local `main` at the end. Do not push. Do not open a PR.

## Decisions and adaptations, each with its reason

- **Boot writes the packs, not the migration.** The migration makes the tables. `replaceSeeded` writes the four packs on every boot, unconditionally and best-effort, like `seedColumnExposurePolicy`. The content then lives in TypeScript beside the forms it comes from, and a release that changes a pack reaches every install. Corlix seeds in its migration; CE writes its seeded forms and roles at boot, not in SQL.
- **Each pack is built from its sample form by code, not typed out.** `seededStarterPacks()` walks the form's fields, so a pack cannot drift from its form, and a new sample field without a rationale fails a test.
- **Pack ids and names.** `pack-location` "Facility", `pack-practitioner` "Users", `pack-patient` "Patient", `pack-service-request` "Lab order": the source forms' names. The chooser's title reads "Facility pack".
- **Paths are stored with their resource.** The Users form writes bare paths (`name.given`). The pack stores `Practitioner.name.given`, as corlix does, so the Library and the FHIR table can look it up.
- **Locked entries are the keys a live page needs.** Facility locks `facilitySystem`, `facilityCode` and `name` (`page-targets.ts:41`). Users locks `firstName`, `lastName` and `email` (`page-targets.ts:40`). The Patients and Orders pages are `available: false`, so their packs lock nothing. Corlix locks what a record cannot be created without (`StarterPackChooser.tsx`).
- **Every entry ships checked.** Each pack is exactly what OpenLDR's own form collects, so nothing in it is an optional extra. The Library's pack group then lists only what an author unchecked or deleted.
- **Cardinality follows corlix.** A required entry makes `min: 1`; a multiple reference makes `max: '*'`. The sample forms are not consistent about `min`, so the pack does not copy them.
- **An entry with no FHIR path matches by API property.** The Facility pack's System, Zone and Council have no path (`samples/forms.ts:41,88,112`). Corlix matches only by path, and would offer them again forever. Entries with a path match by path plus discriminator, as corlix does.
- **The chooser lists only entries the form lacks.** The spec says entries already on the form are skipped. Listing only the missing ones does that and matches the Library.
- **The chooser opens by itself only when the type has a pack.** Corlix opens it for any resource type and then says "no pack"; the spec narrows it. It fires when the pack arrives for an empty form, and is keyed on the pack, not the fields, so adding the pack's fields does not reopen it (corlix `FormBuilderPage.tsx:432-437`).
- **"Start from a pack" shows in the page `⋯` only when the type has a pack.** An item that opens an empty sheet is noise.
- **The chooser's `⋯` sits in a row under the header, as `FieldEditorSheet.tsx` does,** so it never crowds the close control.
- **Pack fields from the chooser do not join a group.** They append in pack order, as corlix does. A pack entry added one at a time from the Library goes through the same path as a Library element, so it joins its parent group when the form has one.
- **The Library tab's count adds the pack group.** Corlix counts both groups (`FormBuilderPage.tsx:1537`).
- **`LoadingState` draws stripes.** AGENTS.md §5 says loading uses `LoadingState` and that stripes never show while loading, but `components/ui/spinner.tsx` draws `LoadingState` on `StripedEmpty`. This plan uses `LoadingState`, as the rule names it, and puts the mismatch on the side list.
- **The routes need `forms.view`,** like every other forms read.

## File map

| File | Change |
|---|---|
| `packages/forms/src/starter-pack.ts` | new, types |
| `packages/forms/src/samples/starter-packs.ts` + test | new, the four packs |
| `packages/forms/src/pure.ts`, `index.ts` | export them |
| `packages/db/src/migrations/internal/099_starter_packs.ts` + test | new |
| `packages/db/src/migrations/internal/index.ts` | register 099 |
| `packages/db/src/schema/internal.ts` | two table types |
| `packages/forms/src/starter-pack-store.ts` + test | new |
| `packages/bootstrap/src/index.ts` | `AppContext.starterPacks`, seed on boot |
| `apps/server/src/forms-routes.ts` + test | two routes |
| `apps/studio/src/api.ts` | three calls |
| `apps/studio/src/forms-builder/newFormFields.ts` + test | `buildFieldFromPackEntry` |
| `apps/studio/src/forms-builder/libraryEntries.ts` + test | `packEntriesNotOnForm` |
| `apps/studio/src/forms-builder/StarterPackChooser.tsx` + test | new |
| `apps/studio/src/forms-builder/BuilderHeader.tsx` + test | "Start from a pack" |
| `apps/studio/src/forms-builder/LibraryPane.tsx` + test | pack group |
| `apps/studio/src/forms-builder/FormBuilderPage.tsx` + test | pack loading, chooser, Library |
| `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md`, `apps/web/src/docs/0.1.8/forms.md` | new section, one Library bullet |

---

### Task 0: Preconditions and branch

- [ ] **Step 1: S4 is in.** `ls apps/studio/src/forms-builder/selection.ts && grep -n "const openEditor" apps/studio/src/forms-builder/FormBuilderPage.tsx`. Both must print. If either does not, S4 has not merged: stop and tell the operator.

- [ ] **Step 2: 099 is still free.**

```bash
ls packages/db/src/migrations/internal | grep -E '^09[89]_'
git branch -a --no-merged main
```

The first must print only `098_auth_issuer_binding.ts`. The second must print nothing, or no branch that adds a `099_` file. If 099 is taken, stop and ask which number to use.

- [ ] **Step 3: Branch.**

```bash
git switch main
git switch -c feat/form-builder-s5
```

---

### Task 1: Pack types and the four seeded packs

**Files:**
- Create: `packages/forms/src/starter-pack.ts`
- Create: `packages/forms/src/samples/starter-packs.ts`, `starter-packs.test.ts`
- Modify: `packages/forms/src/pure.ts`, `packages/forms/src/index.ts`

**Interfaces:** Produces, from `@openldr/forms/pure` and `@openldr/forms`:
- `interface StarterPack { id: string; resourceType: string; name: string; version: string; seeded: boolean; createdAt: string; updatedAt: string }`
- `interface StarterPackEntry { ord: number; fhirPath: string | null; label: string; apiProperty: string | null; fieldType: FieldType | null; fhirValueField: string | null; required: boolean; locked: boolean; defaultOn: boolean; discriminator?: FieldDiscriminator; boundValueSet: string | null; referenceTarget: string | null; referenceMultiple: boolean; rationale: string }`
- `interface StarterPackWithEntries extends StarterPack { entries: StarterPackEntry[] }`
- `interface SeededStarterPack { id: string; resourceType: string; name: string; version: string; entries: StarterPackEntry[] }`
- `STARTER_PACK_VERSION: string`, `seededStarterPacks(): SeededStarterPack[]`

- [ ] **Step 1: Failing test.** Create `packages/forms/src/samples/starter-packs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { seededStarterPacks } from './starter-packs';
import { sampleForms } from './forms';

const packs = seededStarterPacks();
const pack = (id: string) => packs.find((p) => p.id === id)!;
const entry = (id: string, label: string) => pack(id).entries.find((e) => e.label === label);

describe('seeded starter packs', () => {
  it('ships one pack per resource type the sample forms cover', () => {
    expect(packs.map((p) => [p.id, p.resourceType, p.name])).toEqual([
      ['pack-location', 'Location', 'Facility'],
      ['pack-practitioner', 'Practitioner', 'Users'],
      ['pack-patient', 'Patient', 'Patient'],
      ['pack-service-request', 'ServiceRequest', 'Lab order'],
    ]);
  });

  it('gives every entry a rationale and numbers the entries from 0', () => {
    for (const p of packs) {
      expect(p.entries.map((e) => e.ord)).toEqual(p.entries.map((_, i) => i));
      for (const e of p.entries) expect(e.rationale.trim(), `${p.id}: ${e.label}`).not.toBe('');
    }
  });

  it('locks what the Facilities and Users pages cannot save without, and nothing else', () => {
    const locked = (id: string) => pack(id).entries.filter((e) => e.locked).map((e) => e.apiProperty);
    expect(locked('pack-location')).toEqual(['facilitySystem', 'facilityCode', 'name']);
    expect(locked('pack-practitioner')).toEqual(['firstName', 'lastName', 'email']);
    expect(locked('pack-patient')).toEqual([]);
    expect(locked('pack-service-request')).toEqual([]);
  });

  it('ships every entry checked', () => {
    for (const p of packs) expect(p.entries.every((e) => e.defaultOn), p.id).toBe(true);
  });

  it('writes every path with its resource, the bare Users paths included', () => {
    expect(entry('pack-practitioner', 'First name')?.fhirPath).toBe('Practitioner.name.given');
    expect(entry('pack-service-request', 'Specimen Type')?.fhirPath).toBe('Specimen.type');
  });

  it('keeps the Facility code discriminator and the fields with no FHIR path', () => {
    expect(entry('pack-location', 'Facility code')?.discriminator).toEqual({ system: 'urn:openldr:facility:national' });
    expect(entry('pack-location', 'Zone')).toMatchObject({ fhirPath: null, apiProperty: 'zone' });
  });

  it('carries the Lab order reference sources and several tests', () => {
    expect(entry('pack-service-request', 'Patient')).toMatchObject({ referenceTarget: 'Patient', referenceMultiple: false });
    expect(entry('pack-service-request', 'Tests')).toMatchObject({ referenceTarget: 'http://loinc.org', referenceMultiple: true });
    expect(entry('pack-location', 'Status')?.boundValueSet).toBe('urn:openldr:valueset:location-status');
  });

  it('leaves Ward / Department out, because its codes are local', () => {
    expect(entry('pack-service-request', 'Ward / Department')).toBeUndefined();
  });

  it('holds every other field of each source form', () => {
    const size = (id: string) => sampleForms.find((f) => f.id === id)!.fields.length;
    expect(packs.map((p) => p.entries.length)).toEqual([
      size('sample-facility'), size('sample-users'), size('sample-patient'), size('sample-order') - 1,
    ]);
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/forms exec vitest run src/samples/starter-packs.test.ts`. Expected: fails to resolve `./starter-packs`.

- [ ] **Step 3: Write `starter-pack.ts`.**

```ts
import type { FieldDiscriminator, FieldType } from './schema/form-schema';

/**
 * A starter pack: the fields OpenLDR's own form collects for one resource type, offered when an
 * author starts a form. The FHIR schema lists every element and ranks none; a pack is the opinion.
 * Ported from corlix `@corlix/shared-types` `StarterPack`. Read-only: neither app edits packs.
 */
export interface StarterPack {
  id: string;
  resourceType: string;
  name: string;
  version: string;
  seeded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StarterPackEntry {
  /** Position in the pack, from 0. With the pack id, the entry's identity. */
  ord: number;
  /** Resource-prefixed. Null for a field the form saves by API property only. */
  fhirPath: string | null;
  label: string;
  apiProperty: string | null;
  /** Null lets the studio fall back to text. */
  fieldType: FieldType | null;
  fhirValueField: string | null;
  required: boolean;
  /** Checked and cannot be unchecked: a page the form feeds cannot save a record without it. */
  locked: boolean;
  /** Checked when the chooser opens. */
  defaultOn: boolean;
  discriminator?: FieldDiscriminator;
  boundValueSet: string | null;
  referenceTarget: string | null;
  referenceMultiple: boolean;
  /** One line, shown in the chooser. */
  rationale: string;
}

export interface StarterPackWithEntries extends StarterPack {
  entries: StarterPackEntry[];
}

/** A pack as the seed writes it. The store adds `seeded` and the timestamps. */
export interface SeededStarterPack {
  id: string;
  resourceType: string;
  name: string;
  version: string;
  entries: StarterPackEntry[];
}
```

- [ ] **Step 4: Write `samples/starter-packs.ts`.**

```ts
import type { FormField, FormSchema } from '../schema/form-schema';
import type { SeededStarterPack, StarterPackEntry } from '../starter-pack';
import { resolveFhirPath } from '../fhir-path';
import { getPageTarget } from '../page-targets';
import { sampleForms } from './forms';

/**
 * The four seeded starter packs. Each is built from the form OpenLDR itself ships for that resource
 * type (`./forms.ts`), so a pack cannot drift from its form. Corlix's packs use its own code systems
 * and API property names, which CE's pages would not save (spec S5).
 *
 * A pack stores no codes (AGENTS.md §8). A coded select takes its options from the FHIR element's own
 * list when the studio turns the entry into a field.
 */

/** Bump when a pack's content changes. Boot rewrites the seeded packs either way. */
export const STARTER_PACK_VERSION = '1';

interface PackSource {
  id: string;
  name: string;
  formId: string;
  /** The live page whose required keys this pack locks. */
  page?: string;
}

const SOURCES: PackSource[] = [
  { id: 'pack-location', name: 'Facility', formId: 'sample-facility', page: 'facilities' },
  { id: 'pack-practitioner', name: 'Users', formId: 'sample-users', page: 'users' },
  { id: 'pack-patient', name: 'Patient', formId: 'sample-patient' },
  { id: 'pack-service-request', name: 'Lab order', formId: 'sample-order' },
];

/**
 * Fields no pack offers. Ward / Department's options are local codes with no FHIR list behind them,
 * and a seed may not carry codes. The Library still offers `ServiceRequest.locationCode`.
 */
const LEFT_OUT = new Set(['fld-ord-ward']);

/** One line per entry, shown in the chooser. An entry that cannot say why it is there does not belong. */
const RATIONALE: Record<string, string> = {
  'fld-fac-system': 'With the code, it identifies the facility. The Facilities page cannot save a row without it.',
  'fld-fac-code': "The facility's code in that register. The Facilities page cannot save a row without it.",
  'fld-fac-name': 'The name people search for. The Facilities page cannot save a row without it.',
  'fld-fac-country': 'Picks from the seeded country list, so every facility names its country the same way.',
  'fld-fac-zone': 'The top administrative tier. FHIR has no address slot for it, so it is saved by API property only.',
  'fld-fac-region': 'Optional, because some national registers have no tier between province and district.',
  'fld-fac-district': 'The tier most reports group facilities by.',
  'fld-fac-council': 'Optional. Like zone, FHIR has no address slot for it.',
  'fld-fac-status': 'Whether the facility is active, from the seeded status list.',
  'fld-fac-level': 'The facility type, from the seeded list. Reports filter by it.',
  'fld-usr-first-name': 'The Users page cannot create an account without it.',
  'fld-usr-last-name': 'The Users page cannot create an account without it.',
  'fld-usr-email': 'Sign-in and notices go to this address. The Users page cannot create an account without it.',
  'fld-pat-first-name': 'Needed to find the patient again at the next visit.',
  'fld-pat-last-name': 'Needed with the first name to tell patients apart.',
  'fld-pat-dob': 'Age-based reference ranges depend on it.',
  'fld-pat-sex': "Sex-based reference ranges depend on it. The options come from FHIR's own list.",
  'fld-pat-phone': 'Optional. Lets the lab reach the patient about a result.',
  patient: 'Every order is for one patient. It links the order to the Patient record.',
  tests: 'What the lab is asked to run, from LOINC. An order can hold several.',
  'fld-ord-priority': "How fast the lab should work the order. The options come from FHIR's own list.",
  'fld-ord-clinician': 'Who to call about the result.',
  'fld-ord-ref-number': 'The requisition number on the paper form, so the two can be matched.',
  'fld-ord-notes': 'Clinical context the lab may need to choose or read a test.',
  'fld-ord-ref-facility': 'Where the order came from, so results go back there.',
  'fld-ord-specimen-type': 'What was collected, from the seeded specimen type list.',
};

function toEntry(field: FormField, ord: number, form: FormSchema, page: string | undefined): StarterPackEntry {
  const rationale = RATIONALE[field.id];
  if (!rationale) throw new Error(`starter pack: no rationale for field ${field.id}`);
  const lockedKeys = page ? (getPageTarget(page)?.requiredKeys ?? []) : [];
  const entry: StarterPackEntry = {
    ord,
    fhirPath: field.fhirPath ? (resolveFhirPath(field.fhirPath, form.fhirResourceType) ?? field.fhirPath) : null,
    label: field.displayLabel,
    apiProperty: field.apiProperty ?? null,
    fieldType: field.fieldType,
    fhirValueField: field.fhirValueField ?? null,
    required: field.required,
    locked: field.apiProperty ? lockedKeys.includes(field.apiProperty) : false,
    defaultOn: true,
    boundValueSet: field.valueSetUrl ?? null,
    referenceTarget: field.referenceTarget ?? null,
    referenceMultiple: field.referenceMultiple === true,
    rationale,
  };
  if (field.fhirDiscriminator) entry.discriminator = field.fhirDiscriminator;
  return entry;
}

export function seededStarterPacks(): SeededStarterPack[] {
  return SOURCES.map((source) => {
    const form = sampleForms.find((f) => f.id === source.formId);
    if (!form || !form.fhirResourceType) throw new Error(`starter pack: no sample form ${source.formId}`);
    const fields = [...form.fields].sort((a, b) => a.order - b.order).filter((f) => !LEFT_OUT.has(f.id));
    return {
      id: source.id,
      resourceType: form.fhirResourceType,
      name: source.name,
      version: STARTER_PACK_VERSION,
      entries: fields.map((f, i) => toEntry(f, i, form, source.page)),
    };
  });
}
```

- [ ] **Step 5: Export.** Add `export * from './starter-pack';` and `export * from './samples/starter-packs';` to both `pure.ts` and `index.ts`. Both files are browser-safe: they import only types, `./forms`, `page-targets` and `fhir-path`.

- [ ] **Step 6: Run, watch it pass.** Same command as Step 2. Expected: PASS. Then `pnpm --filter @openldr/forms typecheck > /tmp/s5-t1-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`.

- [ ] **Step 7: Commit.** `git commit -m "feat(forms): build four starter packs from the forms OpenLDR ships"`

---

### Task 2: Migration 099

**Files:**
- Create: `packages/db/src/migrations/internal/099_starter_packs.ts`, `099_starter_packs.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/schema/internal.ts`

**Interfaces:** Produces tables `starter_packs` and `starter_pack_entries`, and `InternalSchema` members `starter_packs: StarterPacksTable` and `starter_pack_entries: StarterPackEntriesTable`.

- [ ] **Step 1: Failing test.** Create `099_starter_packs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './099_starter_packs';

describe('starter packs migration', () => {
  it('stores a pack and its entries, allows an entry with no path, and refuses a repeated position', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('starter_packs').values({ id: 'p', resource_type: 'Location', name: 'Facility', version: '1', seeded: true }).execute();
      await db.insertInto('starter_pack_entries').values({ pack_id: 'p', ord: 0, fhir_path: null, label: 'Zone', rationale: 'r' }).execute();
      await expect(
        db.insertInto('starter_pack_entries').values({ pack_id: 'p', ord: 0, fhir_path: 'Location.name', label: 'Name', rationale: 'r' }).execute(),
      ).rejects.toThrow();
      const [row] = await db.selectFrom('starter_pack_entries').selectAll().execute();
      expect(row).toMatchObject({ fhir_path: null, required: false, locked: false, default_on: true, reference_multiple: false });
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('starter_packs').selectAll().execute()).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/db exec vitest run src/migrations/internal/099_starter_packs.test.ts`. Expected: fails to resolve the module.

- [ ] **Step 3: Write the migration.**

```ts
import { type Kysely, sql } from 'kysely';

/**
 * Starter packs: the fields OpenLDR's own form collects for one resource type, offered when an author
 * starts a form. Read-only seeded data. Boot writes the content on every start from
 * `packages/forms/src/samples/starter-packs.ts`; this migration only makes the tables. Spec:
 * `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, S5.
 *
 * Differs from corlix's tables on purpose. No `suggested_codes`: codes in a seed break AGENTS.md §8.
 * `fhir_path` is nullable: CE's Facility form has three fields with no path. No `facility_id`: CE form
 * definitions are not facility-scoped. `reference_target` and `reference_multiple` are added: a
 * reference field with no source cannot publish (`packages/forms/src/lint.ts:108`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('starter_packs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('version', 'text', (c) => c.notNull())
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('starter_packs_resource_type').on('starter_packs').column('resource_type').execute();

  await db.schema
    .createTable('starter_pack_entries')
    .addColumn('pack_id', 'text', (c) => c.notNull().references('starter_packs.id').onDelete('cascade'))
    .addColumn('ord', 'integer', (c) => c.notNull())
    .addColumn('fhir_path', 'text')
    .addColumn('label', 'text', (c) => c.notNull())
    .addColumn('api_property', 'text')
    .addColumn('field_type', 'text')
    .addColumn('fhir_value_field', 'text')
    .addColumn('required', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('locked', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('default_on', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('discriminator', 'jsonb')
    .addColumn('bound_value_set', 'text')
    .addColumn('reference_target', 'text')
    .addColumn('reference_multiple', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('rationale', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('starter_pack_entries_pkey', ['pack_id', 'ord'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('starter_pack_entries').execute();
  await db.schema.dropTable('starter_packs').execute();
}
```

- [ ] **Step 4: Register it.** In `migrations/internal/index.ts`, add `import * as m099 from './099_starter_packs';` after the `m098` import, and `'099_starter_packs': { up: m099.up, down: m099.down },` after the `098` entry. `registration.test.ts` fails if either is missing.

- [ ] **Step 5: The table types.** In `packages/db/src/schema/internal.ts`, after `FormDefinitionsTable`, add:

```ts
export interface StarterPacksTable {
  id: string;
  resource_type: string;
  name: string;
  version: string;
  seeded: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface StarterPackEntriesTable {
  pack_id: string;
  ord: number;
  fhir_path: string | null;
  label: string;
  api_property: Generated<string | null>;
  field_type: Generated<string | null>;
  fhir_value_field: Generated<string | null>;
  required: Generated<boolean>;
  locked: Generated<boolean>;
  default_on: Generated<boolean>;
  discriminator: Generated<unknown | null>;
  bound_value_set: Generated<string | null>;
  reference_target: Generated<string | null>;
  reference_multiple: Generated<boolean>;
  rationale: string;
}
```

and in `InternalSchema`, after `form_versions: FormVersionsTable;`, add `starter_packs: StarterPacksTable;` and `starter_pack_entries: StarterPackEntriesTable;`. `Generated` marks a column an insert may leave out; the migration gives each a default or allows null.

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/db exec vitest run src/migrations/internal`. Expected: PASS, including `registration.test.ts`. Then `pnpm --filter @openldr/db typecheck > /tmp/s5-t2-tc.txt 2>&1; echo "exit=$?"`, expecting `exit=0`.

pg-mem proves the schema. It cannot prove boot order on real Postgres; Task 9 boots the real API on the dev database.

- [ ] **Step 7: Commit.** `git commit -m "feat(db): add the starter pack tables (migration 099)"`

---

### Task 3: The store, and seeding on boot

**Files:**
- Create: `packages/forms/src/starter-pack-store.ts`, `starter-pack-store.test.ts`
- Modify: `packages/forms/src/index.ts`, `packages/bootstrap/src/index.ts`

**Interfaces:** Produces `createStarterPackStore(db: Kysely<InternalSchema>)` returning `{ listForResource(resourceType: string): Promise<StarterPack[]>; get(id: string): Promise<StarterPackWithEntries | null>; replaceSeeded(packs: readonly SeededStarterPack[]): Promise<void> }`, the type `StarterPackStore`, and `AppContext.starterPacks: StarterPackStore`.

- [ ] **Step 1: Failing test.** Create `starter-pack-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createStarterPackStore } from './starter-pack-store';
import { seededStarterPacks } from './samples/starter-packs';
import type { SeededStarterPack } from './starter-pack';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) await migration.up(db);
  return db;
}

const tiny = (id: string, labels: string[]): SeededStarterPack => ({
  id, resourceType: 'Location', name: id, version: '1',
  entries: labels.map((label, ord) => ({
    ord, fhirPath: null, label, apiProperty: null, fieldType: 'text', fhirValueField: null, required: false,
    locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false, rationale: 'r',
  })),
});

describe('starter pack store', () => {
  it('writes the seeded packs and reads them back, entries in order', async () => {
    const store = createStarterPackStore(await makeMigratedDb());
    await store.replaceSeeded(seededStarterPacks());
    expect((await store.listForResource('Location')).map((p) => [p.id, p.seeded])).toEqual([['pack-location', true]]);
    const pack = (await store.get('pack-location'))!;
    expect(pack.entries.map((e) => e.ord)).toEqual(pack.entries.map((_, i) => i));
    expect(pack.entries[1]).toMatchObject({ label: 'Facility code', discriminator: { system: 'urn:openldr:facility:national' }, locked: true });
    expect(typeof pack.createdAt).toBe('string');
  });

  it('answers an empty list for a type with no pack, and null for an unknown id', async () => {
    const store = createStarterPackStore(await makeMigratedDb());
    await store.replaceSeeded(seededStarterPacks());
    expect(await store.listForResource('Specimen')).toEqual([]);
    expect(await store.get('nope')).toBeNull();
  });

  it('replaces a pack when it runs again, and drops a seeded pack no longer listed', async () => {
    const store = createStarterPackStore(await makeMigratedDb());
    await store.replaceSeeded([tiny('a', ['One', 'Two']), tiny('b', ['Three'])]);
    await store.replaceSeeded([tiny('a', ['Only'])]);
    expect((await store.get('a'))!.entries.map((e) => e.label)).toEqual(['Only']);
    expect(await store.get('b')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @openldr/forms exec vitest run src/starter-pack-store.test.ts`.

- [ ] **Step 3: Write the store.**

```ts
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import type { FieldDiscriminator, FieldType } from './schema/form-schema';
import type { SeededStarterPack, StarterPack, StarterPackEntry, StarterPackWithEntries } from './starter-pack';

/**
 * The only file that knows the starter pack tables' column names. Everything else speaks
 * `StarterPack`. Read-only apart from `replaceSeeded`, which boot calls. Ported from corlix
 * `apps/desktop/src/main/starter-packs.ts`.
 */

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function toTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface PackRow {
  id: string;
  resource_type: string;
  name: string;
  version: string;
  seeded: boolean;
  created_at: unknown;
  updated_at: unknown;
}

interface EntryRow {
  ord: number;
  fhir_path: string | null;
  label: string;
  api_property: string | null;
  field_type: string | null;
  fhir_value_field: string | null;
  required: boolean;
  locked: boolean;
  default_on: boolean;
  discriminator: unknown;
  bound_value_set: string | null;
  reference_target: string | null;
  reference_multiple: boolean;
  rationale: string;
}

function toPack(r: PackRow): StarterPack {
  return {
    id: r.id,
    resourceType: r.resource_type,
    name: r.name,
    version: r.version,
    seeded: r.seeded,
    createdAt: toTimestamp(r.created_at),
    updatedAt: toTimestamp(r.updated_at),
  };
}

function toEntry(r: EntryRow): StarterPackEntry {
  const entry: StarterPackEntry = {
    ord: r.ord,
    fhirPath: r.fhir_path,
    label: r.label,
    apiProperty: r.api_property,
    fieldType: r.field_type as FieldType | null,
    fhirValueField: r.fhir_value_field,
    required: r.required,
    locked: r.locked,
    defaultOn: r.default_on,
    boundValueSet: r.bound_value_set,
    referenceTarget: r.reference_target,
    referenceMultiple: r.reference_multiple,
    rationale: r.rationale,
  };
  const discriminator = parseJson(r.discriminator);
  if (discriminator) entry.discriminator = discriminator as FieldDiscriminator;
  return entry;
}

export function createStarterPackStore(db: Kysely<InternalSchema>) {
  return {
    /** The packs for one resource type, by name. Empty when the type has none, which is a real answer. */
    async listForResource(resourceType: string): Promise<StarterPack[]> {
      const rows = await db.selectFrom('starter_packs').selectAll().where('resource_type', '=', resourceType).orderBy('name').execute();
      return rows.map(toPack);
    },

    /** One pack with its entries in pack order, or null for an unknown id. */
    async get(id: string): Promise<StarterPackWithEntries | null> {
      const row = await db.selectFrom('starter_packs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!row) return null;
      const entries = await db.selectFrom('starter_pack_entries').selectAll().where('pack_id', '=', id).orderBy('ord').execute();
      return { ...toPack(row), entries: entries.map(toEntry) };
    },

    /**
     * Make the seeded packs exactly `packs`: each is written with its entries, and a seeded pack no
     * longer listed goes. One transaction, so no pack is left half-written. Boot calls this on every
     * start, so `updated_at` says when the pack was last written.
     */
    async replaceSeeded(packs: readonly SeededStarterPack[]): Promise<void> {
      const ids = new Set(packs.map((p) => p.id));
      await db.transaction().execute(async (trx) => {
        const seeded = await trx.selectFrom('starter_packs').select('id').where('seeded', '=', true).execute();
        for (const { id } of seeded) {
          if (ids.has(id)) continue;
          await trx.deleteFrom('starter_pack_entries').where('pack_id', '=', id).execute();
          await trx.deleteFrom('starter_packs').where('id', '=', id).execute();
        }
        for (const pack of packs) {
          await trx
            .insertInto('starter_packs')
            .values({ id: pack.id, resource_type: pack.resourceType, name: pack.name, version: pack.version, seeded: true })
            .onConflict((oc) =>
              oc.column('id').doUpdateSet({
                resource_type: pack.resourceType,
                name: pack.name,
                version: pack.version,
                seeded: true,
                updated_at: sql`now()`,
              }),
            )
            .execute();
          await trx.deleteFrom('starter_pack_entries').where('pack_id', '=', pack.id).execute();
          if (pack.entries.length === 0) continue;
          await trx
            .insertInto('starter_pack_entries')
            .values(
              pack.entries.map((e) => ({
                pack_id: pack.id,
                ord: e.ord,
                fhir_path: e.fhirPath,
                label: e.label,
                api_property: e.apiProperty,
                field_type: e.fieldType,
                fhir_value_field: e.fhirValueField,
                required: e.required,
                locked: e.locked,
                default_on: e.defaultOn,
                discriminator: e.discriminator ? (JSON.stringify(e.discriminator) as never) : null,
                bound_value_set: e.boundValueSet,
                reference_target: e.referenceTarget,
                reference_multiple: e.referenceMultiple,
                rationale: e.rationale,
              })),
            )
            .execute();
        }
      });
    },
  };
}

export type StarterPackStore = ReturnType<typeof createStarterPackStore>;
```

The entries are deleted explicitly rather than left to the cascade, so the store does not depend on pg-mem honouring `ON DELETE CASCADE`.

- [ ] **Step 4: Export.** Add `export * from './starter-pack-store';` to `packages/forms/src/index.ts` only. It imports Kysely, so it does not go in `pure.ts`.

- [ ] **Step 5: Boot.** In `packages/bootstrap/src/index.ts`:
- Extend the `@openldr/forms` import to `import { createFormStore, createStarterPackStore, seededStarterPacks, type FormStore, type StarterPackStore } from '@openldr/forms';`.
- In `AppContext`, after `forms: FormStore;`, add:

```ts
  /** Read-only starter packs for the form builder. Rewritten from source on every boot. */
  starterPacks: StarterPackStore;
```

- After `const forms = createFormStore(internal.db, referenceCapture);`, add:

```ts
  const starterPacks = createStarterPackStore(internal.db);
  // Starter packs are read-only seeded data, rewritten on every boot from
  // `packages/forms/src/samples/starter-packs.ts` so a release that changes one reaches every
  // install. Unconditional and best-effort, like the column-exposure seed above. A failure leaves the
  // builder with no pack to offer, never an install that will not boot. The try also covers
  // `seededStarterPacks()` itself, which throws on a sample field with no rationale.
  try {
    await starterPacks.replaceSeeded(seededStarterPacks());
  } catch (err) {
    logger.warn({ err }, 'starter-pack seed failed');
  }
```

- In the returned context object, after `forms,`, add `starterPacks,`.

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/forms exec vitest run src/starter-pack-store.test.ts`. Then the two typechecks, each expecting `exit=0`:

```bash
pnpm --filter @openldr/forms typecheck > /tmp/s5-t3-forms-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/bootstrap typecheck > /tmp/s5-t3-boot-tc.txt 2>&1; echo "exit=$?"
```

- [ ] **Step 7: Commit.** `git commit -m "feat(forms): store starter packs and write them on every boot"`

---

### Task 4: The routes

**Files:** Modify `apps/server/src/forms-routes.ts` and `forms-routes.test.ts`.

**Interfaces:** Produces `GET /api/forms/starter-packs?resourceType=` returning `StarterPack[]`, and `GET /api/forms/starter-packs/:id` returning `StarterPackWithEntries`. Both need `forms.view`.

- [ ] **Step 1: Failing tests.** Append to `forms-routes.test.ts`:

```ts
describe('starter pack routes', () => {
  const PACK = { id: 'pack-location', resourceType: 'Location', name: 'Facility', version: '1', seeded: true, createdAt: NOW, updatedAt: NOW };
  const ENTRY = {
    ord: 0, fhirPath: 'Location.name', label: 'Name', apiProperty: 'name', fieldType: 'text', fhirValueField: null,
    required: true, locked: true, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
    rationale: 'The Facilities page cannot save a row without it.',
  };
  const ctx = {
    starterPacks: {
      listForResource: async (resourceType: string) => (resourceType === 'Location' ? [PACK] : []),
      get: async (id: string) => (id === PACK.id ? { ...PACK, entries: [ENTRY] } : null),
    },
    forms: { get: async (id: string) => (id === 'form-1' ? { id: 'form-1' } : null) },
  };

  it('lists the packs for a resource type', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs?resourceType=Location' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([PACK]);
  });

  it('answers an empty list for a type with no pack', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs?resourceType=Specimen' });
    expect(res.json()).toEqual([]);
  });

  it('refuses a list with no resource type', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs' });
    expect(res.statusCode).toBe(400);
  });

  it('returns one pack with its entries', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs/pack-location' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...PACK, entries: [ENTRY] });
  });

  it('404s an unknown pack', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/starter-packs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('needs forms.view', async () => {
    const res = await appWithForms(ctx, ['guest'], []).inject({ method: 'GET', url: '/api/forms/starter-packs?resourceType=Location' });
    expect(res.statusCode).toBe(403);
  });

  it('leaves GET /api/forms/:id working', async () => {
    const res = await appWithForms(ctx).inject({ method: 'GET', url: '/api/forms/form-1' });
    expect(res.json()).toEqual({ id: 'form-1' });
  });
});
```

These tests pin the route's wire shape. The store test in Task 3 pins the row mapping. Neither proves the other.

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/server exec vitest run src/forms-routes.test.ts`.

- [ ] **Step 3: The routes.** In `registerFormsRoutes`, after the `GET /api/forms/published` route, add:

```ts
  // Starter packs: read-only seeded data for the builder (spec S5). Static segments, so find-my-way
  // matches them before `GET /api/forms/:id`, as it does `/api/forms/published`.
  app.get('/api/forms/starter-packs', VIEW, async (req, reply) => {
    const resourceType = (req.query as { resourceType?: string }).resourceType?.trim();
    if (!resourceType) {
      reply.code(400);
      return { error: 'resourceType is required' };
    }
    return ctx.starterPacks.listForResource(resourceType);
  });

  app.get('/api/forms/starter-packs/:id', VIEW, async (req, reply) => {
    const pack = await ctx.starterPacks.get((req.params as { id: string }).id);
    if (!pack) {
      reply.code(404);
      return { error: 'not found' };
    }
    return pack;
  });
```

- [ ] **Step 4: Run, watch them pass.** Same command as Step 2. Then the server's typecheck and lint, the only real lint in the repo:

```bash
pnpm --filter @openldr/server typecheck > /tmp/s5-t4-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server lint > /tmp/s5-t4-lint.txt 2>&1; echo "exit=$?"
```

Both must print `exit=0`.

- [ ] **Step 5: Commit.** `git commit -m "feat(server): serve starter packs to the form builder"`

---

### Task 5: The studio's pack helpers

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/forms-builder/newFormFields.ts` and its test
- Modify: `apps/studio/src/forms-builder/libraryEntries.ts` and its test

**Interfaces:**
- Produces in `api.ts`: `listStarterPacks(resourceType: string): Promise<StarterPack[]>`, `getStarterPack(id: string): Promise<StarterPackWithEntries>`, `loadStarterPack(resourceType: string): Promise<StarterPackWithEntries | null>`.
- Produces `buildFieldFromPackEntry(entry: StarterPackEntry, id: string): FormField` and `packEntriesNotOnForm(entries: readonly StarterPackEntry[], fields: readonly FormField[], resourceType: string | null | undefined): StarterPackEntry[]`.

- [ ] **Step 1: Failing tests.** In `newFormFields.test.ts`, add `buildFieldFromPackEntry` to the `./newFormFields` import, and add `import { lintFormSchema, seededStarterPacks, type FormSchema, type StarterPackEntry } from '@openldr/forms/pure';`. Append:

```ts
const packEntry = (over: Partial<StarterPackEntry>): StarterPackEntry => ({
  ord: 0, fhirPath: 'Location.name', label: 'Name', apiProperty: null, fieldType: 'text', fhirValueField: null,
  required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
  rationale: 'r', ...over,
});

describe('buildFieldFromPackEntry', () => {
  it('copies what makes the field save', () => {
    const field = buildFieldFromPackEntry(packEntry({
      fhirPath: 'Location.identifier.value', label: 'Facility code', apiProperty: 'facilityCode', fieldType: 'identifier',
      required: true, locked: true, discriminator: { system: 'urn:x' },
    }), 'code');
    expect(field).toMatchObject({
      id: 'code', fhirPath: 'Location.identifier.value', displayLabel: 'Facility code', apiProperty: 'facilityCode',
      fieldType: 'identifier', required: true, locked: true, fhirDiscriminator: { system: 'urn:x' },
      cardinality: { min: 1, max: '1' },
    });
  });

  it('keeps a reference source, and several answers', () => {
    const field = buildFieldFromPackEntry(packEntry({ fieldType: 'reference', referenceTarget: 'http://loinc.org', referenceMultiple: true }), 'tests');
    expect(field).toMatchObject({ referenceTarget: 'http://loinc.org', referenceMultiple: true, cardinality: { min: 0, max: '*' } });
  });

  it('binds a ValueSet', () => {
    expect(buildFieldFromPackEntry(packEntry({ boundValueSet: 'urn:vs' }), 'x').valueSetUrl).toBe('urn:vs');
  });

  it("reads a coded select's options from the FHIR label, since a pack stores no codes", () => {
    const field = buildFieldFromPackEntry(packEntry({ fhirPath: 'Patient.gender', fieldType: 'select' }), 'sex');
    expect(field.valueSetOptions?.map((o) => o.code)).toEqual(['male', 'female', 'other', 'unknown']);
  });

  it('falls back to text when the entry names no type', () => {
    expect(buildFieldFromPackEntry(packEntry({ fieldType: null }), 'x').fieldType).toBe('text');
  });
});

describe('each seeded starter pack, taken whole', () => {
  const PAGES: Record<string, string[]> = { 'pack-location': ['facilities'], 'pack-practitioner': ['users'] };

  it.each(seededStarterPacks().map((p) => [p.id, p] as const))('%s makes a form with no lint error', (_id, pack) => {
    const form: FormSchema = {
      id: pack.id, name: pack.name, versionLabel: null, fhirVersion: 'R4', fhirResourceType: pack.resourceType,
      fhirProfileUrl: null, facilityId: null,
      fields: pack.entries.map((e, i) => ({ ...buildFieldFromPackEntry(e, `f${i}`), order: i })),
      sections: [], targetPages: PAGES[pack.id] ?? [], version: 1, active: true, status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const errors = lintFormSchema(form).filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});
```

If a pack does not lint clean, stop and report the pack, the field and the rule. Do not loosen the test.

In `libraryEntries.test.ts`, add `packEntriesNotOnForm` to the `./libraryEntries` import, add `import type { StarterPackEntry } from '@openldr/forms/pure';`, and append:

```ts
describe('packEntriesNotOnForm', () => {
  const entry = (ord: number, fhirPath: string | null, extra: Partial<StarterPackEntry> = {}): StarterPackEntry => ({
    ord, fhirPath, label: String(ord), apiProperty: null, fieldType: 'text', fhirValueField: null, required: false,
    locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false, rationale: 'r', ...extra,
  });

  it('tells two slots of one path apart by their discriminator', () => {
    const entries = [
      entry(0, 'Location.identifier.value', { discriminator: { system: 'a' } }),
      entry(1, 'Location.identifier.value', { discriminator: { system: 'b' } }),
    ];
    const fields = [{ ...field('x', 'Location.identifier.value'), fhirDiscriminator: { system: 'a' } }];
    expect(packEntriesNotOnForm(entries, fields, 'Location').map((e) => e.ord)).toEqual([1]);
  });

  it('resolves a bare path against the form resource type', () => {
    expect(packEntriesNotOnForm([entry(0, 'Practitioner.name.given')], [field('x', 'name.given')], 'Practitioner')).toEqual([]);
  });

  it('matches an entry with no path by its API property', () => {
    const zone = entry(0, null, { apiProperty: 'zone' });
    expect(packEntriesNotOnForm([zone], [], 'Location')).toEqual([zone]);
    expect(packEntriesNotOnForm([zone], [{ ...field('z', null), apiProperty: 'zone' }], 'Location')).toEqual([]);
  });

  it('keeps pack order, and a disabled field still counts as on the form', () => {
    const entries = [entry(2, 'Location.alias'), entry(0, 'Location.name'), entry(1, 'Location.status')];
    const fields = [{ ...field('s', 'Location.status'), enabled: false }];
    expect(packEntriesNotOnForm(entries, fields, 'Location').map((e) => e.ord)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/newFormFields.test.ts src/forms-builder/libraryEntries.test.ts`.

- [ ] **Step 3: API calls.** In `api.ts`, add `import type { StarterPack, StarterPackWithEntries } from '@openldr/forms/pure';` with the other imports, and after `getFormVersion` add:

```ts
export const listStarterPacks = (resourceType: string): Promise<StarterPack[]> =>
  apiGet(`/api/forms/starter-packs?resourceType=${encodeURIComponent(resourceType)}`, 'list starter packs');
export const getStarterPack = (id: string): Promise<StarterPackWithEntries> =>
  apiGet(`/api/forms/starter-packs/${encodeURIComponent(id)}`, 'get starter pack');
/** The pack for a resource type, with its entries, or null when the type has none. Corlix takes the first. */
export async function loadStarterPack(resourceType: string): Promise<StarterPackWithEntries | null> {
  const packs = await listStarterPacks(resourceType);
  return packs.length > 0 ? getStarterPack(packs[0].id) : null;
}
```

- [ ] **Step 4: Entry to field.** In `newFormFields.ts`, add `type StarterPackEntry` to the `@openldr/forms/pure` import, turn the `@openldr/fhir/paths` import into `import { lookupFhirPath, type FhirPathInfo } from '@openldr/fhir/paths';`, and append:

```ts
/**
 * A field from one starter pack entry. Ported from corlix `lib/packToFields.ts`. It keeps the small
 * parts that make a field save: the API property, the lock, the discriminator, the ValueSet and the
 * reference source. A required entry makes `min: 1`, and a multiple reference makes `max: '*'`.
 *
 * A pack stores no codes (AGENTS.md §8). A coded select reads its options from the FHIR element's own
 * list, as a Library element does.
 */
export function buildFieldFromPackEntry(entry: StarterPackEntry, id: string): FormField {
  const field: FormField = {
    id,
    fhirPath: entry.fhirPath,
    displayLabel: entry.label,
    description: null,
    fieldType: entry.fieldType ?? 'text',
    required: entry.required,
    enabled: true,
    order: 0,
    cardinality: { min: entry.required ? 1 : 0, max: entry.referenceMultiple ? '*' : '1' },
  };
  if (entry.apiProperty) field.apiProperty = entry.apiProperty;
  if (entry.locked) field.locked = true;
  if (entry.discriminator) field.fhirDiscriminator = entry.discriminator;
  if (entry.fhirValueField) field.fhirValueField = entry.fhirValueField;
  if (entry.boundValueSet) field.valueSetUrl = entry.boundValueSet;
  if (entry.referenceTarget) field.referenceTarget = entry.referenceTarget;
  if (entry.referenceMultiple) field.referenceMultiple = true;
  const isChoice = field.fieldType === 'select' || field.fieldType === 'multiselect';
  if (isChoice && !field.valueSetUrl && entry.fhirPath) {
    const info = lookupFhirPath(entry.fhirPath);
    const options = info && info.leafType === 'code' ? codeOptionsFromLabel(info.label) : null;
    if (options) field.valueSetOptions = options;
  }
  return field;
}
```

- [ ] **Step 5: What the form lacks.** In `libraryEntries.ts`, change the pure import to `import { discriminatorIdentity, resolveFhirPath, type FormField, type StarterPackEntry } from '@openldr/forms/pure';` and append:

```ts
/**
 * Pack entries the form does not have yet, in pack order. Ported from corlix `lib/libraryEntries.ts:73`.
 *
 * An entry with a path matches by path and discriminator, so two slots of one list stay two entries.
 * A path the form writes bare, as the Users form does (`name.given`), is resolved against the form's
 * resource type first. An entry with no path, such as the Facility pack's System, matches by API
 * property; corlix matches by path only and would offer those again forever. A disabled field counts.
 */
export function packEntriesNotOnForm(
  entries: readonly StarterPackEntry[],
  fields: readonly FormField[],
  resourceType: string | null | undefined,
): StarterPackEntry[] {
  const bound = new Set<string>();
  for (const f of fields) {
    const path = resolveFhirPath(f.fhirPath, resourceType);
    if (path) bound.add(`path:${path}|${discriminatorIdentity(f.fhirDiscriminator)}`);
    if (f.apiProperty) bound.add(`api:${f.apiProperty}`);
  }
  return [...entries]
    .sort((a, b) => a.ord - b.ord)
    .filter((e) => {
      const key = e.fhirPath
        ? `path:${e.fhirPath}|${discriminatorIdentity(e.discriminator)}`
        : e.apiProperty ? `api:${e.apiProperty}` : null;
      return key === null || !bound.has(key);
    });
}
```

- [ ] **Step 6: Run, watch them pass.** Same command as Step 2, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 7: Commit.** `git commit -m "feat(studio): turn a starter pack entry into a field, and find what a form lacks"`

---

### Task 6: The chooser

**Files:**
- Create: `apps/studio/src/forms-builder/StarterPackChooser.tsx`, `StarterPackChooser.test.tsx`
- Modify: `BuilderHeader.tsx` and its test, `FormBuilderPage.tsx` and its test

**Interfaces:**
- Consumes: `packEntriesNotOnForm`, `buildFieldFromPackEntry`, `loadStarterPack` from Task 5.
- Produces: `StarterPackChooser({ open, onOpenChange, pack, loading, fields, resourceType, onAdd })`, where `onAdd: (entries: StarterPackEntry[]) => void`. `BuilderHeaderProps.onStartFromPack?: () => void`. In the page: `pack`, `packLoading`, `packChooserOpen`, `addPackEntries`.

- [ ] **Step 1: Failing tests.** Create `StarterPackChooser.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, StarterPackEntry, StarterPackWithEntries } from '@openldr/forms/pure';
import { StarterPackChooser } from './StarterPackChooser';

const entry = (ord: number, label: string, extra: Partial<StarterPackEntry> = {}): StarterPackEntry => ({
  ord, fhirPath: `Location.${label.toLowerCase()}`, label, apiProperty: null, fieldType: 'text', fhirValueField: null,
  required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
  rationale: `Why ${label}.`, ...extra,
});

const PACK: StarterPackWithEntries = {
  id: 'pack-location', resourceType: 'Location', name: 'Facility', version: '1', seeded: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  entries: [
    entry(0, 'Name', { required: true, locked: true }),
    entry(1, 'Code', { fhirPath: 'Location.identifier.value', discriminator: { system: 'urn:national' } }),
    entry(2, 'Alias'),
  ],
};

const onForm = (fhirPath: string): FormField => ({
  id: 'x', displayLabel: 'x', fieldType: 'text', required: false, enabled: true, fhirPath,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});

function renderChooser(props: Partial<Parameters<typeof StarterPackChooser>[0]> = {}) {
  const onAdd = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <StarterPackChooser
      open pack={PACK} loading={false} fields={[]} resourceType="Location"
      onAdd={onAdd} onOpenChange={onOpenChange} {...props}
    />,
  );
  return { onAdd, onOpenChange };
}

function clickMenu(item: string) {
  const trigger = screen.getByRole('button', { name: 'Pack actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('StarterPackChooser', () => {
  it('is a sheet titled with the pack, one row per entry with its reason', () => {
    renderChooser();
    const sheet = screen.getByRole('dialog', { name: 'Facility pack' });
    expect(sheet).toHaveTextContent('Why Alias.');
    expect(sheet).toHaveTextContent('system = urn:national');
    expect(screen.getByText('Required')).toBeTruthy();
  });

  it('keeps a locked entry checked and unchangeable', () => {
    renderChooser();
    const name = screen.getByRole('checkbox', { name: 'Include Name' });
    expect(name).toHaveAttribute('aria-checked', 'true');
    expect(name).toBeDisabled();
  });

  it('adds what is checked, and nothing unchecked', () => {
    const { onAdd, onOpenChange } = renderChooser();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Alias' }));
    clickMenu('Add 2 fields');
    expect(onAdd.mock.calls[0][0].map((e: StarterPackEntry) => e.label)).toEqual(['Name', 'Code']);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves out entries already on the form', () => {
    renderChooser({ fields: [onForm('Location.alias')] });
    expect(screen.queryByRole('checkbox', { name: 'Include Alias' })).toBeNull();
  });

  it('says so when the whole pack is on the form', () => {
    renderChooser({ fields: PACK.entries.map((e) => ({ ...onForm(e.fhirPath!), fhirDiscriminator: e.discriminator })) });
    expect(screen.getByText('Every entry in this pack is on the form.')).toBeTruthy();
  });

  it('Cancel closes it', () => {
    const { onOpenChange, onAdd } = renderChooser();
    clickMenu('Cancel');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows a spinner while the pack loads', () => {
    renderChooser({ pack: null, loading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });
});
```

In `BuilderHeader.test.tsx`, add inside `describe('Builder actions menu (⋯)', …)`:

```tsx
    it('offers "Start from a pack" when there is a pack, and calls it', () => {
      const onStartFromPack = vi.fn();
      renderHeader({ onStartFromPack });
      openMenuAndClick('Builder actions', 'Start from a pack');
      expect(onStartFromPack).toHaveBeenCalled();
    });

    it('hides "Start from a pack" when there is none', () => {
      renderHeader();
      const trigger = screen.getByLabelText('Builder actions');
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Add field')) fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(screen.queryByText('Start from a pack')).toBeNull();
    });
```

In `FormBuilderPage.test.tsx`: add `import type { FormField, StarterPackWithEntries } from '@openldr/forms/pure';`, merging with any existing type import from that module. In the existing `beforeEach`, add `vi.spyOn(api, 'loadStarterPack').mockResolvedValue(null);` so no test reaches the network. Add these fixtures and helpers after the existing helpers:

```tsx
const STARTER: StarterPackWithEntries = {
  id: 'pack-location', resourceType: 'Location', name: 'Facility', version: '1', seeded: true, createdAt: NOW, updatedAt: NOW,
  entries: [
    { ord: 0, fhirPath: 'Location.name', label: 'Name', apiProperty: 'name', fieldType: 'text', fhirValueField: null,
      required: true, locked: true, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
      rationale: 'The Facilities page cannot save a row without it.' },
    { ord: 1, fhirPath: 'Location.alias', label: 'Other name', apiProperty: null, fieldType: 'text', fhirValueField: null,
      required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
      rationale: 'Other names people use.' },
  ],
};

/** Load the builder on a stored form of this type, holding these fields. */
async function renderBuilderForm(fhirResourceType: string, fields: FormField[]) {
  const base = makeFormDef();
  vi.spyOn(api, 'getForm').mockResolvedValue(
    makeFormDef({ fhirResourceType, schema: { ...base.schema, fhirResourceType, fields } }) as never,
  );
  vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/forms/form-1/builder']}>
      <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Form name');
}

function openPackMenu(item: string) {
  const trigger = screen.getByRole('button', { name: 'Pack actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menu')) fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

const oneField = (fhirPath: string): FormField => ({
  id: 'held', displayLabel: 'Held', fieldType: 'text', required: false, enabled: true, fhirPath,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});
```

and these tests:

```tsx
  it('opens the pack by itself on an empty form whose type has one, and adds it as one undo step', async () => {
    vi.mocked(api.loadStarterPack).mockResolvedValue(STARTER);
    await renderBuilderForm('Location', []);
    expect(await screen.findByRole('dialog', { name: 'Facility pack' })).toBeInTheDocument();
    openPackMenu('Add 2 fields');
    expect(await screen.findByRole('button', { name: 'Edit field Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit field Other name' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(screen.queryByRole('button', { name: 'Edit field Name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit field Other name' })).toBeNull();
  });

  it('does not open by itself on a form that has fields, but Start from a pack opens it', async () => {
    vi.mocked(api.loadStarterPack).mockResolvedValue(STARTER);
    await renderBuilderForm('Location', [oneField('Location.status')]);
    openBuilderMenu();
    // The item appears only once the pack has arrived, so from here the chooser could have opened.
    const item = await screen.findByText('Start from a pack');
    expect(screen.queryByRole('dialog', { name: 'Facility pack' })).toBeNull();
    fireEvent.click(item);
    expect(await screen.findByRole('dialog', { name: 'Facility pack' })).toBeInTheDocument();
  });

  it('never looks for a pack on a survey form', async () => {
    vi.mocked(api.loadStarterPack).mockClear();
    await renderBuilderForm('Questionnaire', []);
    expect(api.loadStarterPack).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/StarterPackChooser.test.tsx src/forms-builder/BuilderHeader.test.tsx src/forms-builder/FormBuilderPage.test.tsx`.

- [ ] **Step 3: Write `StarterPackChooser.tsx`.**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Lock, MoreHorizontal } from 'lucide-react';
import { discriminatorLabel, type FormField, type StarterPackEntry, type StarterPackWithEntries } from '@openldr/forms/pure';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { packEntriesNotOnForm } from './libraryEntries';

/**
 * The starter pack for the form's resource type, as a checklist. The author unchecks what they do not
 * collect instead of hunting the FHIR element list for the fields that matter. Every row says why it
 * is there. Ported from corlix `components/form-builder/StarterPackChooser.tsx`, as a Sheet with its
 * actions in a ⋯ menu (AGENTS.md §5) where corlix uses a Dialog with footer buttons. Only entries the
 * form lacks are listed, so adding never makes a second copy of a field.
 */
export function StarterPackChooser({
  open,
  onOpenChange,
  pack,
  loading,
  fields,
  resourceType,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack: StarterPackWithEntries | null;
  loading: boolean;
  fields: FormField[];
  resourceType: string | null;
  onAdd: (entries: StarterPackEntry[]) => void;
}): JSX.Element {
  const offered = useMemo(
    () => (pack ? packEntriesNotOnForm(pack.entries, fields, resourceType) : []),
    [pack, fields, resourceType],
  );
  const [checked, setChecked] = useState<Set<number>>(new Set());

  // Fresh ticks each time the sheet opens. A locked entry starts checked and cannot be unchecked:
  // a page the form feeds cannot save a record without it.
  useEffect(() => {
    if (open) setChecked(new Set(offered.filter((e) => e.defaultOn || e.locked).map((e) => e.ord)));
  }, [open, offered]);

  const toggle = (e: StarterPackEntry) => {
    if (e.locked) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(e.ord)) next.delete(e.ord);
      else next.add(e.ord);
      return next;
    });
  };

  const kept = offered.filter((e) => checked.has(e.ord));
  const add = () => {
    onAdd(kept);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{pack ? `${pack.name} pack` : 'Starter pack'}</SheetTitle>
          <SheetDescription>
            FHIR lists every element and ranks none. These are the fields OpenLDR's own form uses. Uncheck
            what you do not collect.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-6 py-3">
          <h3 className="text-sm font-medium text-foreground">{`${kept.length} of ${offered.length} selected`}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Pack actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={kept.length === 0} onSelect={add}>
                {`Add ${kept.length} field${kept.length === 1 ? '' : 's'}`}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onOpenChange(false)}>Cancel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <LoadingState className="min-h-[16rem]" />
          ) : !pack ? (
            <StripedEmpty className="min-h-[16rem]">{`No starter pack for ${resourceType ?? 'this form'}.`}</StripedEmpty>
          ) : offered.length === 0 ? (
            <StripedEmpty className="min-h-[16rem]">Every entry in this pack is on the form.</StripedEmpty>
          ) : (
            offered.map((e) => (
              <div key={e.ord} className="flex items-start gap-3 border-b border-border px-6 py-2.5 last:border-b-0">
                <Checkbox
                  className="mt-0.5"
                  checked={checked.has(e.ord)}
                  disabled={e.locked}
                  onCheckedChange={() => toggle(e)}
                  aria-label={`Include ${e.label}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{e.label}</span>
                    {e.required && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                    {e.locked && (
                      <span
                        role="img"
                        aria-label="Locked"
                        className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted text-muted-foreground"
                      >
                        <Lock className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">{e.fhirPath ?? 'No FHIR path'}</div>
                  {/* Two slots of one list share a path, so the discriminator gets its own line. */}
                  {discriminatorLabel(e.discriminator) && (
                    <div className="font-mono text-[10px] text-primary">{discriminatorLabel(e.discriminator)}</div>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.rationale}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: The header item.** In `BuilderHeader.tsx`, add to the props:

```ts
  /** Open the starter pack chooser. Absent when the form's resource type has no pack. */
  onStartFromPack?: () => void;
```

destructure it, and after the Preview item add:

```tsx
              {onStartFromPack ? (
                <DropdownMenuItem onSelect={() => onStartFromPack()}>
                  Start from a pack
                </DropdownMenuItem>
              ) : null}
```

- [ ] **Step 5: The page.** In `FormBuilderPage.tsx`:
- Add `useRef` to the React import. Add `loadStarterPack` to the `../api` import. Add `type StarterPackEntry, type StarterPackWithEntries` to the `@openldr/forms/pure` import. Import `StarterPackChooser` from `./StarterPackChooser`, and add `buildFieldFromPackEntry` to the `./newFormFields` import.
- With the other state, add:

```ts
  const [pack, setPack] = useState<StarterPackWithEntries | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const [packChooserOpen, setPackChooserOpen] = useState(false);
```

- After the `elements` memo, add:

```ts
  // The pack for the form's resource type. The chooser and the Library both read it. Empty is a real
  // answer: a survey, a Bundle form and a type with no pack get none. A failed load must not break the
  // builder, so it reads as no pack.
  useEffect(() => {
    const resourceType = schema.fhirResourceType;
    if (!mapsToResource(resourceType) || !resourceType) {
      setPack(null);
      return;
    }
    let cancelled = false;
    setPackLoading(true);
    void loadStarterPack(resourceType)
      .then((p) => { if (!cancelled) setPack(p); })
      .catch(() => { if (!cancelled) setPack(null); })
      .finally(() => { if (!cancelled) setPackLoading(false); });
    return () => { cancelled = true; };
  }, [schema.fhirResourceType]);

  // An empty form whose type has a pack offers it. Keyed on the pack, not the fields, so adding the
  // pack's fields does not reopen it. Corlix `FormBuilderPage.tsx:432-437`.
  const fieldCountRef = useRef(schema.fields.length);
  fieldCountRef.current = schema.fields.length;
  useEffect(() => {
    if (pack && fieldCountRef.current === 0) setPackChooserOpen(true);
  }, [pack]);

  /** Add the chosen pack entries after the last field, in pack order. One undo step. */
  const addPackEntries = (entries: StarterPackEntry[]) => {
    if (entries.length === 0) return;
    history.pushHistory();
    setSchema((prev) => {
      const taken = new Set(prev.fields.map((f) => f.id));
      let order = prev.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
      const added = entries.map((e) => {
        const id = makeUniqueFieldId(slugify(e.label), taken);
        taken.add(id);
        return { ...buildFieldFromPackEntry(e, id), order: order++ };
      });
      return { ...prev, fields: [...prev.fields, ...added] };
    });
  };
```

- Pass `onStartFromPack={pack ? () => setPackChooserOpen(true) : undefined}` to `<BuilderHeader>`.
- Next to `<PreviewSheet … />`, render:

```tsx
      <StarterPackChooser
        open={packChooserOpen}
        onOpenChange={setPackChooserOpen}
        pack={pack}
        loading={packLoading}
        fields={schema.fields}
        resourceType={schema.fhirResourceType ?? null}
        onAdd={addPackEntries}
      />
```

- [ ] **Step 6: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 7: Commit.** `git commit -m "feat(studio): offer the starter pack when a form starts"`

---

### Task 7: The Library's pack group

**Files:** Modify `apps/studio/src/forms-builder/LibraryPane.tsx` and its test, `FormBuilderPage.tsx` and its test.

**Interfaces:** `LibraryPane` gains optional `packName?: string | null`, `packLeft?: StarterPackEntry[]`, `packLoading?: boolean`, `onAddPackEntry?: (entry: StarterPackEntry) => void`. The page gains `packLeft`, `placeLibraryField` and `addPackEntryFromLibrary`.

- [ ] **Step 1: Failing tests.** In `LibraryPane.test.tsx`, add `import type { StarterPackEntry } from '@openldr/forms/pure';` and append inside the `describe`:

```tsx
  const packEntry = (ord: number, label: string, extra: Partial<StarterPackEntry> = {}): StarterPackEntry => ({
    ord, fhirPath: `Location.${label.toLowerCase()}`, label, apiProperty: null, fieldType: 'text', fhirValueField: null,
    required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
    rationale: 'r', ...extra,
  });

  it('lists what the form lacks from the pack first, with the discriminator line', () => {
    const left = [packEntry(1, 'Code', { fhirPath: 'Location.identifier.value', discriminator: { system: 'urn:national' } })];
    render(<LibraryPane resourceType="Location" elements={els} packName="Facility" packLeft={left} onAddElement={vi.fn()} onAddPackEntry={vi.fn()} />);
    expect(screen.getByText('Left out of the pack')).toBeTruthy();
    expect(screen.getByText('These are in the Facility pack and not on the form. Click one to put it back.')).toBeTruthy();
    expect(screen.getByText('system = urn:national')).toBeTruthy();
  });

  it('hands a clicked pack entry back', () => {
    const onAddPackEntry = vi.fn();
    const left = [packEntry(0, 'Alias')];
    render(<LibraryPane resourceType="Location" elements={[]} packName="Facility" packLeft={left} onAddElement={vi.fn()} onAddPackEntry={onAddPackEntry} />);
    fireEvent.click(screen.getByRole('button', { name: /Alias/ }));
    expect(onAddPackEntry).toHaveBeenCalledWith(left[0]);
  });

  it('says so when every pack entry is on the form', () => {
    render(<LibraryPane resourceType="Location" elements={els} packName="Facility" packLeft={[]} onAddElement={vi.fn()} />);
    expect(screen.getByText('Every entry in the Facility pack is on the form.')).toBeTruthy();
  });

  it('shows a spinner while the pack loads, and no pack group without a pack', () => {
    const { rerender } = render(<LibraryPane resourceType="Location" elements={els} packLoading onAddElement={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    rerender(<LibraryPane resourceType="Location" elements={els} onAddElement={vi.fn()} />);
    expect(screen.queryByText('Left out of the pack')).toBeNull();
  });

  it('search filters the pack group too', () => {
    const left = [packEntry(0, 'Alias'), packEntry(1, 'Description')];
    render(<LibraryPane resourceType="Location" elements={[]} packName="Facility" packLeft={left} onAddElement={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the library' }), { target: { value: 'desc' } });
    expect(screen.queryByText('Alias')).toBeNull();
    expect(screen.getByText('Description')).toBeTruthy();
  });
```

In `FormBuilderPage.test.tsx`, add `within` to the Testing Library import if it is not there, and add:

```tsx
  it('lists the pack entries the form lacks in the Library, and adds one', async () => {
    vi.mocked(api.loadStarterPack).mockResolvedValue(STARTER);
    await renderBuilderForm('Location', [oneField('Location.name')]);
    const group = (await screen.findByText('Left out of the pack')).closest('div')!.parentElement!;
    fireEvent.click(within(group).getByRole('button', { name: /Other name/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Other name');
  });
```

`Location.name` is on the form, so only "Other name" is left out of the pack.

- [ ] **Step 2: Run, watch them fail.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder/LibraryPane.test.tsx src/forms-builder/FormBuilderPage.test.tsx`.

- [ ] **Step 3: The group.** In `LibraryPane.tsx`:
- Import `discriminatorLabel` and `type StarterPackEntry` from `@openldr/forms/pure`, and `LoadingState` from `@/components/ui/spinner`.
- Add the four optional props, destructured with `packName = null`, `packLeft = []`, `packLoading = false`.
- Beside `matching`, add:

```ts
  const matchingPack = useMemo(
    () =>
      q
        ? packLeft.filter((e) => e.label.toLowerCase().includes(q) || (e.fhirPath?.toLowerCase().includes(q) ?? false))
        : packLeft,
    [packLeft, q],
  );
```

- After the search box and before the `All {resourceType} elements` header, render:

```tsx
            {/* The pack group comes first because it is ranked: the pack says what OpenLDR's own form
                collects, and the element list below ranks nothing. Corlix `LibraryPane.tsx`. */}
            {packLoading ? (
              <LoadingState className="mb-4 min-h-[5rem] rounded-md" />
            ) : packName ? (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 px-0.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="min-w-0 truncate">Left out of the pack</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px]">{matchingPack.length}</span>
                </div>
                <p className={`px-0.5 pb-2 text-xs leading-relaxed ${packLeft.length > 0 ? 'text-muted-foreground' : 'text-emerald-500'}`}>
                  {packLeft.length > 0
                    ? `These are in the ${packName} pack and not on the form. Click one to put it back.`
                    : `Every entry in the ${packName} pack is on the form.`}
                </p>
                {matchingPack.map((e) => (
                  <Button
                    key={e.ord}
                    variant="ghost"
                    onClick={() => onAddPackEntry?.(e)}
                    className="group mb-0.5 h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal"
                  >
                    <span className="mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground group-hover:border-primary group-hover:text-primary">
                      <Plus className="h-2.5 w-2.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-foreground">{e.label}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{e.fhirPath ?? 'No FHIR path'}</span>
                      {discriminatorLabel(e.discriminator) && (
                        <span className="block truncate font-mono text-[10px] text-primary">{discriminatorLabel(e.discriminator)}</span>
                      )}
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
```

- Change the no-match line's condition from `q && matching.length === 0` to `q && matching.length === 0 && matchingPack.length === 0`.

- [ ] **Step 4: The page.** In `FormBuilderPage.tsx`:
- Import `packEntriesNotOnForm` from `./libraryEntries`.
- After the pack effects, add:

```ts
  const packLeft = useMemo(
    () => (pack ? packEntriesNotOnForm(pack.entries, schema.fields, schema.fhirResourceType) : []),
    [pack, schema.fields, schema.fhirResourceType],
  );
```

- Split `addFromLibrary` in two. Everything after the line that builds `field` moves into `placeLibraryField`, unchanged, so the result is:

```ts
  /**
   * Put a field made in the Library on the form, inside its parent group when that group is there.
   * One undo step. Library elements and pack entries both come through here.
   */
  const placeLibraryField = (field: FormField) => {
    history.pushHistory();
    const groupId = groupIdForPath(schema.fields, field.fhirPath);
    setSchema((prev) => {
      if (groupId) {
        return { ...prev, fields: insertFieldAfter(prev.fields, lastPartIdOf(prev.fields, groupId), { ...field, groupId }) };
      }
      const nextOrder = prev.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
      return { ...prev, fields: [...prev.fields, { ...field, order: nextOrder }] };
    });
    setPendingNewFieldId(null);
    openEditor(field.id);
    // On a narrow workspace the new field would otherwise sit behind the Library tab.
    setPane('form');
  };

  const addFromLibrary = (info: FhirPathInfo) =>
    placeLibraryField(buildFieldFromElement(info, freshId(elementDisplayName(info.path))));

  const addPackEntryFromLibrary = (entry: StarterPackEntry) =>
    placeLibraryField(buildFieldFromPackEntry(entry, freshId(entry.label)));
```

If the body you moved differs from this (S4 may have reworded it), keep S4's body and change only the function boundary.

- Pass the pack to both `LibraryPane` elements, the side pane and the tab:

```tsx
              packName={pack?.name ?? null}
              packLeft={packLeft}
              packLoading={packLoading}
              onAddPackEntry={addPackEntryFromLibrary}
```

- The Library tab's count becomes `{packLeft.length + elements.length}`, as corlix counts both groups.

- [ ] **Step 5: Run, watch them pass.** `pnpm --filter @openldr/studio exec vitest run src/forms-builder`, then the studio typecheck, expecting `exit=0`.

- [ ] **Step 6: Commit.** `git commit -m "feat(studio): list the pack entries a form lacks at the top of the Library"`

---

### Task 8: Docs

**Files:** `apps/studio/src/docs/0.1.8/{en,fr,pt}/forms.md` and `apps/web/src/docs/0.1.8/forms.md`.

- [ ] **Step 1: English.** In `en/forms.md`, insert this section directly before `## The Library`:

```md
## Starter packs

- A starter pack is a ready list of fields for one resource type, taken from the forms OpenLDR ships: Location (Facility), Practitioner (Users), Patient, and ServiceRequest (Lab order).
- When you pick a resource type on an empty form, its pack opens by itself in a sheet. On a form that has fields, choose **Start from a pack** from the ⋯ menu.
- Each entry says why it is there. Uncheck what you do not collect, then choose **Add N fields** from the sheet's ⋯ menu. Adding is one undo step.
- A locked entry stays checked, because the page the form feeds cannot save a record without it.
- Entries already on the form are left out of the sheet.
- Coded entries take their options from FHIR's own list. The Lab order pack leaves out Ward / Department, because its codes are local; add it from the Library and give it options.
- Survey forms and forms with no resource type have no pack.
```

In the `## The Library` section, add as its second bullet:

```md
- Above the elements, **Left out of the pack** lists the pack entries the form does not have, in the pack's order. Click one to add it.
```

- [ ] **Step 2: French and Portuguese.** Translate the section and the bullet into `fr/forms.md` and `pt/forms.md`: the section goes directly before `## Le volet Library` and `## O painel Library`, the bullet into those sections. Keep UI labels in English, as those files already do: **Start from a pack**, **Add N fields**, **Left out of the pack**, **Ward / Department**. Keep the same number of bullets as the English.

- [ ] **Step 3: Web.** In `apps/web/src/docs/0.1.8/forms.md`, add each language's section directly before that language's `### The Library`, `### Le volet Library` and `### O painel Library`, with a `###` heading, and the bullet into each Library section.

- [ ] **Step 4: Run the docs tests.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git commit -m "docs(forms): describe starter packs and the Library's pack group"`

---

### Task 9: Verify, merge, changelog

- [ ] **Step 1: Gates and lint on the branch.**

```bash
pnpm turbo run test --force > /tmp/s5-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s5-tc.txt 2>&1; echo "exit=$?"
pnpm --filter @openldr/server lint > /tmp/s5-lint.txt 2>&1; echo "exit=$?"
```

All three must print `exit=0`. Read each turbo `Tasks:` line: turbo stops at the first failure, so a short count means packages did not run. On a test failure, run `grep -n "Test timed out\|Unhandled Errors" /tmp/s5-test.txt` first, and re-run that package alone.

- [ ] **Step 2: A real boot.** `preview_start` the `api` configuration. It runs migrations on the dev database. `preview_logs` for the `api` server must show no migration error and no `starter-pack seed failed` warning. Then `preview_start` `studio`. The operator signs in; never type credentials.

In the studio tab, through the page's API module:

```js
const api = await import('/studio/src/api.ts');
const packs = await Promise.all(['Location', 'Practitioner', 'Patient', 'ServiceRequest'].map((t) => api.listStarterPacks(t)));
const facility = await api.getStarterPack('pack-location');
({ names: packs.map((p) => p.map((x) => x.name)), facilityEntries: facility.entries.length, lockedFacility: facility.entries.filter((e) => e.locked).map((e) => e.apiProperty) });
```

Expected: `[['Facility'], ['Users'], ['Patient'], ['Lab order']]`, 10 Facility entries, and `['facilitySystem', 'facilityCode', 'name']`. That proves migration 099 ran on real Postgres and boot wrote the packs.

- [ ] **Step 3: Browser, desktop.** `resize_window` to 1600x900. On `/studio/forms/new`, pick Resource Type `Location`. The Facility pack sheet opens by itself. Check:

- The sheet is on the right with its `⋯` in the row under the header. Facility code shows `system = urn:openldr:facility:national`. System, Facility code and Name show a lock and cannot be unchecked. Every row has its reason.
- Uncheck Council and Zone. The `⋯` reads "Add 8 fields". Choose it: eight fields land in pack order. Ctrl+Z removes all eight in one step. Ctrl+Shift+Z brings them back.
- The Library's first group is "Left out of the pack", with Zone and Council. Click Zone: a Zone field is added and its editor opens.
- On a new empty form, pick `ServiceRequest`: the Lab order pack opens with 8 entries and no Ward / Department. Add them all. Patient and Tests carry their sources, and Priority has four options. The lint banner shows no errors.
- On a form with fields, the page `⋯` has "Start from a pack". A `Questionnaire` form shows no pack and no "Start from a pack".

Compare against corlix `apps/desktop/test-output/p14-2-library-pane/01-library.png` for the pack group.

- [ ] **Step 4: Phone.** `resize_window` preset `mobile` and reload a new Location form. The chooser opens full width, rows wrap, and nothing scrolls sideways (`document.documentElement.scrollWidth === innerWidth`). Reset with preset `desktop`. Nothing in S5 is anchored to the bottom edge.

Delete any throwaway forms with `api.deleteForm(id)`. Stop both servers before the gates on `main`.

- [ ] **Step 5: Merge, gates on main, changelog.**

```bash
git switch main
git merge --no-ff feat/form-builder-s5 -m "Merge branch 'feat/form-builder-s5'"
pnpm turbo run test --force > /tmp/s5-main-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force > /tmp/s5-main-tc.txt 2>&1; echo "exit=$?"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog after form builder S5 merge"
git branch -d feat/form-builder-s5
```

Both gates must print `exit=0` before the changelog commit. Do not push.

- [ ] **Step 6: Report.** The commits, every gate and lint result with the command and exit code, the real-boot check's output, screenshots, anything that was stopped rather than fixed, and a plain line that nothing in S5 is bottom-anchored.

---

## Side list (not S5 work)

- **`LoadingState` draws stripes.** AGENTS.md §5 says loading shows no stripes, but `components/ui/spinner.tsx` draws `LoadingState` on `StripedEmpty`. One of them is wrong. S5 follows the component the rule names.
- **The Orders page keys fields by id (`page-targets.ts:45`)**, and pack fields get fresh ids. When that page ships, a Lab order form built from the pack will not satisfy it until the author renames two ids to `patient` and `tests`. The page is `available: false` today.
- **The sample forms disagree on `cardinality.min` for required fields.** The pack follows corlix (`min: 1` when required) rather than copying them.
- **Carried from S3 and S4:** the Dashboard reload (a separate session), the Library search emptying at 980px, the `dhis2-sink-ui` teardown error, the data-entry step, `ValueSetBuilder.tsx:103`, the Lab order seed drift, the narrow condition inputs at 375px.
