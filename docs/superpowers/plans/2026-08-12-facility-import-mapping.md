# Facility import mapping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator map a foreign national facility list's columns and vocabulary onto the import contract from inside the app, with shipped offline suggestions.

**Architecture:** The column map is applied inside `parseFacilityCsv`, so unknown columns keep failing the file rather than being silently dropped. A pure suggestion engine lives in `@openldr/bootstrap` and is called by both the HTTP routes and the CLI — never duplicated. Value mappings are written through `termMappings.saveExclusive` under one pinned `mapType`.

**Tech Stack:** TypeScript, vitest, kysely, Fastify, React + shadcn, commander (CLI).

**Spec:** `docs/superpowers/specs/2026-08-12-facility-import-mapping-design.md` (commit `d69e7707`).

## Global Constraints

- **No migration.** The column map rides in `facility_import_runs.options` (`jsonb`, already exists).
- **`extras` keys stay lowercased and trimmed** — existing behaviour (`facility-csv.ts:205`). Column-map keys are headers as they appear in the file; the parser lowercases them for lookup.
- **One pinned `mapType` for every controlled-field value mapping: `'SAME-AS'`.** `MapType` is `'SAME-AS' | 'NARROWER-THAN' | 'BROADER-THAN' | 'RELATED-TO' | 'UNMAPPED-FROM'` (`packages/db/src/terminology-admin-store.ts:44`). Rationale in Task 6 — it is a correctness requirement, not a style choice.
- **No model calls, no network, in the suggestion engine.** These labs are offline.
- **Never weaken the unknown-column refusal.** `facility-csv.ts:166` is a deliberate safety property.
- **No `Co-Authored-By` trailer on any commit** (`AGENTS.md` §9).
- **UI follows `AGENTS.md` §5**: actions in a `⋯` `DropdownMenu`, fields label-left/input-right, `StripedEmpty`/`LoadingState`, shadcn only, `TablePagination` on every table.
- **Test gate:** `pnpm turbo run test`. Never pipe turbo through `tail`. A failure is usually a timeout — grep for `Test timed out` and re-run that package alone before blaming a change.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/terminology/src/facility-csv.ts` (modify) | Column map types; apply the map while parsing; report map errors |
| `packages/bootstrap/src/facility-mapping-suggest.ts` (create) | Pure suggestion engine — normalise, similarity, synonyms, ranking |
| `packages/bootstrap/src/facility-value-mappings.ts` (create) | Write controlled-field value mappings; create source system + concepts |
| `packages/bootstrap/src/facility-import.ts` (modify) | Pass `columnMap` to the parser; surface map errors on the result |
| `apps/server/src/facilities-routes.ts` (modify) | Suggestion and value-mapping routes |
| `apps/studio/src/facilities/ColumnMapStep.tsx` (create) | The column-mapping panel |
| `apps/studio/src/facilities/ValueMapPanel.tsx` (create) | The value-mapping panel |
| `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` (modify) | Host both panels in the existing flow |
| `packages/cli/src/facilities.ts` (modify) | `suggest-map`, `--column-map`, `suggest-values`, `--value-map` |

Two new studio files rather than growing `ImportFacilitiesSheet.tsx`, which is already ~1300 lines. Each new panel owns one step and is testable on its own.

---

### Task 1: Column map types and parser support

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts`
- Test: `packages/terminology/src/facility-csv.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FacilityColumnMap`, `ColumnMapError`, `ColumnMapErrorReason`; `FacilityCsvOptions.columnMap`; `FacilityCsvResult.columnMapErrors`; **`FACILITY_CONTRACT_FIELDS`** (Task 2 imports this rather than re-declaring the field names).

- [ ] **Step 1: Write the failing tests**

Add to `packages/terminology/src/facility-csv.test.ts`:

```ts
describe('parseFacilityCsv with a column map', () => {
  const map = {
    columns: { 'MFL Code': 'national_code', Name: 'name', Province: 'zone', Type: 'level' },
    constants: { country: 'ZMB' },
    extras: ['DHIS2 UID'],
  };

  it('renames headers, applies constants, and carries opted-in columns to extras', () => {
    const r = parseFacilityCsv(
      'MFL Code,Name,Province,Type,DHIS2 UID\n1835,Namatindi RHC,Western,Health Centre,fykM10MbEBA\n',
      { nationalSystem: HFR, columnMap: map },
    );
    expect(r.columnMapErrors).toEqual([]);
    expect(r.unknownColumns).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      nationalCode: '1835', name: 'Namatindi RHC', zone: 'Western',
      level: 'Health Centre', country: 'ZMB',
    });
    // extras keys stay lowercased — existing behaviour, see facility-csv.ts:205
    expect(r.records[0].extras).toEqual({ 'dhis2 uid': 'fykM10MbEBA' });
  });

  it('matches map keys case-insensitively against the file header', () => {
    const r = parseFacilityCsv('mfl code,name\n1835,Namatindi RHC\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' } },
    });
    expect(r.columnMapErrors).toEqual([]);
    expect(r.records[0].nationalCode).toBe('1835');
  });

  it('⛔ refuses a header in neither columns nor extras, exactly as an unknown column today', () => {
    const r = parseFacilityCsv('MFL Code,Name,Surprise\n1835,X,y\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' } },
    });
    expect(r.unknownColumns).toEqual(['surprise']);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses two headers mapped to the same field, reporting both', () => {
    const r = parseFacilityCsv('A,B,Name\n1,2,X\n', {
      nationalSystem: HFR,
      columnMap: { columns: { A: 'national_code', B: 'national_code', Name: 'name' } },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'duplicate_target', subject: 'B', target: 'national_code', other: 'A' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses a constant that collides with a mapped column', () => {
    const r = parseFacilityCsv('MFL Code,Name,Country\n1,X,Zambia\n', {
      nationalSystem: HFR,
      columnMap: {
        columns: { 'MFL Code': 'national_code', Name: 'name', Country: 'country' },
        constants: { country: 'ZMB' },
      },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'constant_collision', subject: 'country', target: 'country', other: 'Country' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses a target outside the contract', () => {
    const r = parseFacilityCsv('MFL Code,Name\n1,X\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name', Nope: 'password' } },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'unknown_target', subject: 'Nope', target: 'password' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('⛔ refuses when a required field is neither mapped nor constant', () => {
    const r = parseFacilityCsv('MFL Code\n1835\n', {
      nationalSystem: HFR,
      columnMap: { columns: { 'MFL Code': 'national_code' } },
    });
    expect(r.columnMapErrors).toEqual([
      { reason: 'missing_required', subject: 'name', target: 'name' },
    ]);
    expect(r.records).toEqual([]);
  });

  it('reports EVERY map problem at once, so one fix pass repairs the file', () => {
    const r = parseFacilityCsv('A,B\n1,2\n', {
      nationalSystem: HFR,
      columnMap: { columns: { A: 'national_code', B: 'national_code' } },
    });
    expect(r.columnMapErrors.map((e) => e.reason).sort())
      .toEqual(['duplicate_target', 'missing_required']);
  });

  it('leaves behaviour identical when no column map is supplied', () => {
    const r = csv('national_code,name\n122023-5,BAHEBE\n');
    expect(r.columnMapErrors).toEqual([]);
    expect(r.records[0].nationalCode).toBe('122023-5');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/terminology test -- facility-csv
```

Expected: FAIL. TypeScript rejects `columnMap` as an unknown option, and `columnMapErrors` does not exist on the result.

- [ ] **Step 3: Add the types**

In `packages/terminology/src/facility-csv.ts`, after the `KNOWN` set (line 13):

```ts
/** The contract's field names, in contract order. Exported so nothing else has to re-declare them —
 *  a second copy would drift the moment a field is added, and the copy would silently stop being
 *  offered by the suggestion engine that reads it. */
export const FACILITY_CONTRACT_FIELDS: readonly string[] = [...REQUIRED, ...OPTIONAL];
```

```ts
/** How a file's own headers map onto the contract above.
 *
 *  ⛔ `columns` keys are headers AS THEY APPEAR IN THE FILE — the operator matches what they see.
 *  The parser lowercases them for lookup, because `headers` is already lowercased (see
 *  `parseFacilityCsv`). `extras` keys, by contrast, stay lowercased on the record: that is existing
 *  behaviour for every register already imported, and re-keying it would silently break them. */
export interface FacilityColumnMap {
  /** file header -> contract field */
  columns: Record<string, string>;
  /** contract field -> literal value written on every row (e.g. `country: 'ZMB'`) */
  constants?: Record<string, string>;
  /** file headers deliberately carried into `extras` rather than mapped */
  extras?: string[];
}

export type ColumnMapErrorReason =
  | 'duplicate_target' | 'constant_collision' | 'unknown_target' | 'missing_required';

export interface ColumnMapError {
  reason: ColumnMapErrorReason;
  /** The header (or, for a constant/required error, the field) the problem is about, spelled as the
   *  operator wrote it — so they can find it in their own map. */
  subject: string;
  /** The contract field involved. */
  target: string;
  /** The other header/field, when the problem is a collision between two things. */
  other?: string;
}
```

Add to `FacilityCsvOptions` (after `allowInvalidCoordinates`, line 34):

```ts
  /** Map this file's headers onto the contract. Omitted ⇒ headers must already BE the contract,
   *  exactly as before this option existed. */
  columnMap?: FacilityColumnMap;
```

Add to `FacilityCsvResult` (after `duplicateColumns`, line 71):

```ts
  /** Problems with the column map itself, ALL of them, so one fix pass repairs the file. Non-empty
   *  ⇒ nothing imported: every one of these is a guess about master data that this parser refuses to
   *  make, the same reasoning as `duplicateColumns` above. */
  columnMapErrors: ColumnMapError[];
```

- [ ] **Step 4: Add the map validator**

Above `parseFacilityCsv` in the same file:

```ts
/** Validate a column map against the contract and return EVERY problem, never just the first. */
export function validateColumnMap(map: FacilityColumnMap): ColumnMapError[] {
  const errors: ColumnMapError[] = [];
  const claimedBy = new Map<string, string>(); // contract field -> the header that claimed it

  for (const [header, target] of Object.entries(map.columns)) {
    if (!KNOWN.has(target)) {
      errors.push({ reason: 'unknown_target', subject: header, target });
      continue;
    }
    const owner = claimedBy.get(target);
    if (owner !== undefined) {
      errors.push({ reason: 'duplicate_target', subject: header, target, other: owner });
      continue;
    }
    claimedBy.set(target, header);
  }

  for (const [field, _value] of Object.entries(map.constants ?? {})) {
    if (!KNOWN.has(field)) {
      errors.push({ reason: 'unknown_target', subject: field, target: field });
      continue;
    }
    const owner = claimedBy.get(field);
    if (owner !== undefined) {
      errors.push({ reason: 'constant_collision', subject: field, target: field, other: owner });
      continue;
    }
    claimedBy.set(field, field);
  }

  for (const required of REQUIRED) {
    if (!claimedBy.has(required)) {
      errors.push({ reason: 'missing_required', subject: required, target: required });
    }
  }

  return errors;
}
```

- [ ] **Step 5: Apply the map inside the parser**

In `parseFacilityCsv`, replace the header block at lines 205-214 with:

```ts
  const rawHeaders = rows[0].record.map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const duplicateColumns = headers.filter((h, i) => h !== '' && headers.indexOf(h) !== i);

  const columnMapErrors = opts.columnMap ? validateColumnMap(opts.columnMap) : [];

  // Rename headers through the map. Lookup is on the LOWERCASED header, so a map written against
  // `MFL Code` still matches a file that spells it `mfl code`.
  const lowerToTarget = new Map<string, string>();
  const extrasOptIn = new Set<string>();
  if (opts.columnMap) {
    for (const [header, target] of Object.entries(opts.columnMap.columns)) {
      lowerToTarget.set(header.trim().toLowerCase(), target);
    }
    for (const header of opts.columnMap.extras ?? []) {
      extrasOptIn.add(header.trim().toLowerCase());
    }
  }
  const effective = opts.columnMap
    ? headers.map((h) => lowerToTarget.get(h) ?? h)
    : headers;

  // A header is unknown unless it mapped to a contract field, already IS one, or was explicitly
  // opted in to extras. The refusal itself is unchanged — see this function's docblock.
  const unknownColumns = effective.filter((h, i) =>
    h !== '' && effective.indexOf(h) === i && !KNOWN.has(h) && !extrasOptIn.has(headers[i]));

  if (duplicateColumns.length > 0) {
    return { records: [], unknownColumns, duplicateColumns: [...new Set(duplicateColumns)], columnMapErrors, quarantined: [], skipped: 0, invalid: [] };
  }
  if (columnMapErrors.length > 0) {
    return { records: [], unknownColumns, duplicateColumns: [], columnMapErrors, quarantined: [], skipped: 0, invalid: [] };
  }
  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
    return { records: [], unknownColumns, duplicateColumns: [], columnMapErrors, quarantined: [], skipped: 0, invalid: [] };
  }
```

Then replace the per-row mapping at line 231-232:

```ts
    const r: Record<string, string> = {};
    effective.forEach((h, i) => { r[h] = record[i]; });
    for (const [field, value] of Object.entries(opts.columnMap?.constants ?? {})) {
      r[field] = value;
    }
```

And the `extras` loop at lines 245-249, so an opted-in column keeps its lowercased original header
as its key even though it never became a contract field:

```ts
    const extras: Record<string, unknown> = {};
    for (let i = 0; i < effective.length; i += 1) {
      const target = effective[i];
      if (KNOWN.has(target)) continue;
      const v = text(record[i]);
      if (v !== null) extras[headers[i]] = v;
    }
```

Finally add `columnMapErrors` to the two remaining `return` statements — the empty-rows early return
at line 202 and the success return at line 276 — as `columnMapErrors: []` and `columnMapErrors`
respectively.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/terminology test -- facility-csv
```

Expected: PASS, including every pre-existing test in the file. If an old test fails on a missing
`columnMapErrors` key, that is the fixture needing the new field, not a regression.

- [ ] **Step 7: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/terminology/src/facility-csv.test.ts
git commit -m "feat(facilities): apply a column map while parsing an import file"
```

---

### Task 2: The suggestion engine

**Files:**
- Create: `packages/bootstrap/src/facility-mapping-suggest.ts`
- Test: `packages/bootstrap/src/facility-mapping-suggest.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export)

**Interfaces:**
- Consumes: nothing.
- Produces: `normaliseLabel(s: string): string`; `similarity(a: string, b: string): number`; `suggestColumns(headers: readonly string[]): ColumnSuggestion[]`; `suggestValues(raw: readonly string[], candidates: readonly ValueCandidate[]): ValueSuggestion[]`; types `Suggestion`, `SuggestionConfidence`, `ColumnSuggestion`, `ValueCandidate`, `ValueSuggestion`.

- [ ] **Step 1: Write the failing tests**

Create `packages/bootstrap/src/facility-mapping-suggest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normaliseLabel, similarity, suggestColumns, suggestValues } from './facility-mapping-suggest';

describe('normaliseLabel', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normaliseLabel('  MFL_Code  ')).toBe('mfl code');
    expect(normaliseLabel('Operational status')).toBe('operational status');
  });
});

describe('similarity', () => {
  it('is 1 for identical strings and 0 for nothing in common', () => {
    expect(similarity('health centre', 'health centre')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });

  it('scores a near miss above a far one', () => {
    expect(similarity('health centre', 'health center'))
      .toBeGreaterThan(similarity('health centre', 'health post'));
  });
});

describe('suggestColumns', () => {
  it('matches a contract field by its own name', () => {
    const [s] = suggestColumns(['Name']);
    expect(s.candidates[0]).toMatchObject({ target: 'name', confidence: 'exact' });
  });

  it('resolves the shipped synonyms', () => {
    const byHeader = Object.fromEntries(
      suggestColumns(['MFL Code', 'Province', 'Type', 'Operational status'])
        .map((s) => [s.header, s.candidates[0]]),
    );
    expect(byHeader['MFL Code']).toMatchObject({ target: 'national_code', confidence: 'exact' });
    expect(byHeader.Province).toMatchObject({ target: 'zone', confidence: 'exact' });
    expect(byHeader.Type).toMatchObject({ target: 'level', confidence: 'exact' });
    expect(byHeader['Operational status']).toMatchObject({ target: 'status', confidence: 'exact' });
  });

  it('⛔ offers NOTHING for a header with no plausible target', () => {
    const [s] = suggestColumns(['Catchment population cso']);
    expect(s.candidates).toEqual([]);
  });

  it('measured against the Zambia MFL export: 10 of 21 headers get a suggestion', () => {
    const headers = [
      'MFL Code', 'DHIS2 UID', 'Hims code', 'Name', 'Province', 'District', 'Constituency',
      'Ward', 'Zone', 'Location', 'Type', 'Ownership', 'Ownership type', 'Operational status',
      'Mobility status', 'Accesibility', 'Catchment population head count',
      'Catchment population cso', 'Number of households', 'Latitude', 'Longitude',
    ];
    const suggested = suggestColumns(headers).filter((s) => s.candidates.length > 0);
    expect(suggested.map((s) => s.header).sort()).toEqual([
      'District', 'Latitude', 'Longitude', 'MFL Code', 'Name', 'Operational status',
      'Ownership', 'Province', 'Type', 'Ward',
    ]);
  });
});

describe('suggestValues', () => {
  const levels = [
    { code: 'health-center', display: 'Health Center' },
    { code: 'health-post', display: 'Health Post' },
    { code: 'district-hospital', display: 'District Hospital' },
    { code: 'general-clinic', display: 'General Clinic' },
  ];

  it('matches a display that differs only in spelling', () => {
    const [s] = suggestValues(['Health Centre'], levels);
    expect(s.candidates[0]).toMatchObject({ target: 'health-center', confidence: 'likely' });
  });

  it('matches an exact display outright', () => {
    const [s] = suggestValues(['Health Post'], levels);
    expect(s.candidates[0]).toMatchObject({ target: 'health-post', confidence: 'exact' });
  });

  it('⛔ offers NOTHING for 1st Level Hospital — a weak guess is worse than none', () => {
    // This needs knowledge of how Zambia tiers its hospitals. String similarity cannot reach it,
    // and pretending otherwise is how a wrong vocabulary ships looking confirmed.
    const [s] = suggestValues(['1st Level Hospital'], levels);
    expect(s.candidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/bootstrap test -- facility-mapping-suggest
```

Expected: FAIL with "Cannot find module './facility-mapping-suggest'".

- [ ] **Step 3: Write the engine**

Create `packages/bootstrap/src/facility-mapping-suggest.ts`:

```ts
// Ranked mapping suggestions for a national facility list whose columns and vocabulary are not ours.
//
// ⛔ PURE AND OFFLINE. No database, no network, no model call — these labs run without connectivity,
// so a suggestion an operator cannot get in the room is no suggestion at all. Everything here is a
// string function over data the caller already has, which is also why it is exhaustively testable.
//
// ⛔ IT MUST BE WILLING TO SAY NOTHING. A weak guess that an operator confirms without reading is
// worse than a blank they have to fill in: it ships a wrong vocabulary looking confirmed. `WEAK_MIN`
// is the floor below which this module returns no candidate at all.

import { FACILITY_CONTRACT_FIELDS } from '@openldr/terminology';

/** Header words that name a contract field without spelling it.
 *
 *  ⛔ Country-specific vocabulary, and deliberately AMBIGUOUS across countries: Tanzania's `region`
 *  is a contract field in its own right, while Zambia's `province` means our `zone`. This table can
 *  never know which country a file came from, so it only ever SUGGESTS — nothing here is applied
 *  without an operator confirming it. */
const SYNONYMS: Record<string, string> = {
  'mfl code': 'national_code', 'hfr code': 'national_code', 'facility code': 'national_code',
  'national code': 'national_code', code: 'national_code',
  'facility name': 'name',
  province: 'zone', state: 'zone', zonal: 'zone',
  county: 'region', 'sub region': 'region',
  woreda: 'district', lga: 'district',
  'local authority': 'council', municipality: 'council',
  type: 'level', 'facility type': 'level', tier: 'level',
  'operational status': 'status', 'facility status': 'status',
  owner: 'ownership', 'ownership type': 'ownership',
  lat: 'latitude', lon: 'longitude', lng: 'longitude',
  telephone: 'phone', 'phone number': 'phone', msisdn: 'phone',
  'physical address': 'address', 'street address': 'address',
};

export type SuggestionConfidence = 'exact' | 'likely' | 'weak';

export interface Suggestion {
  /** The contract field, or the value-set code, being suggested. */
  target: string;
  /** Human label for the target, when it has one distinct from the code. */
  display: string | null;
  /** 0..1. Exact matches are 1. */
  score: number;
  confidence: SuggestionConfidence;
}

export interface ColumnSuggestion {
  /** The header exactly as it appears in the file. */
  header: string;
  /** Best first. EMPTY when nothing scored above `WEAK_MIN` — see this file's header. */
  candidates: Suggestion[];
}

export interface ValueCandidate { code: string; display: string | null }

export interface ValueSuggestion {
  /** The raw source value exactly as it appears in the file. */
  value: string;
  candidates: Suggestion[];
}

/** Below this, no candidate is offered at all. */
const WEAK_MIN = 0.62;
/** At or above this, a similarity match is pre-selected in the UI (badged for checking). */
const LIKELY_MIN = 0.78;
/** How many candidates to return per subject. */
const MAX_CANDIDATES = 5;

export function normaliseLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Sørensen–Dice over character bigrams. Chosen over edit distance because it is length-insensitive
 *  and rewards shared word fragments — `health centre` vs `health center` scores high, while
 *  `1st level hospital` vs `district hospital` does not clear `WEAK_MIN`, which is the outcome that
 *  matters most here. */
export function similarity(a: string, b: string): number {
  const na = normaliseLabel(a);
  const nb = normaliseLabel(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let shared = 0;
  let total = 0;
  for (const n of ba.values()) total += n;
  for (const [g, n] of bb) {
    total += n;
    shared += Math.min(n, ba.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

function rank(subject: string, candidates: readonly ValueCandidate[]): Suggestion[] {
  const scored: Suggestion[] = [];
  for (const c of candidates) {
    const byCode = similarity(subject, c.code);
    const byDisplay = c.display ? similarity(subject, c.display) : 0;
    const score = Math.max(byCode, byDisplay);
    if (score < WEAK_MIN) continue;
    scored.push({
      target: c.code,
      display: c.display,
      score,
      confidence: score === 1 ? 'exact' : score >= LIKELY_MIN ? 'likely' : 'weak',
    });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, MAX_CANDIDATES);
}

export function suggestColumns(headers: readonly string[]): ColumnSuggestion[] {
  return headers.map((header) => {
    const n = normaliseLabel(header);

    const synonym = SYNONYMS[n];
    if (synonym) {
      return { header, candidates: [{ target: synonym, display: null, score: 1, confidence: 'exact' as const }] };
    }
    const direct = FACILITY_CONTRACT_FIELDS.find((f) => normaliseLabel(f) === n);
    if (direct) {
      return { header, candidates: [{ target: direct, display: null, score: 1, confidence: 'exact' as const }] };
    }
    return {
      header,
      candidates: rank(header, FACILITY_CONTRACT_FIELDS.map((f) => ({ code: f, display: null }))),
    };
  });
}

export function suggestValues(
  raw: readonly string[], candidates: readonly ValueCandidate[],
): ValueSuggestion[] {
  return raw.map((value) => ({ value, candidates: rank(value, candidates) }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap test -- facility-mapping-suggest
```

Expected: PASS.

If the "10 of 21 headers" test fails, do **not** loosen `WEAK_MIN` to make it pass — that threshold
is what stops `1st Level Hospital` getting a false suggestion, and the two tests are in tension by
design. Adjust `SYNONYMS` instead, and if a header genuinely has no defensible target, change the
expected list and say so in the commit message.

- [ ] **Step 5: Export from the package**

In `packages/bootstrap/src/index.ts`, beside the existing controlled-field export block (~line 1643):

```ts
export {
  normaliseLabel, similarity, suggestColumns, suggestValues,
} from './facility-mapping-suggest';
export type {
  Suggestion, SuggestionConfidence, ColumnSuggestion, ValueCandidate, ValueSuggestion,
} from './facility-mapping-suggest';
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @openldr/bootstrap typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/facility-mapping-suggest.ts packages/bootstrap/src/facility-mapping-suggest.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(facilities): rank column and value mapping suggestions offline"
```

---

### Task 3: Carry the column map through `importFacilities`

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts`
- Test: `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Consumes: `FacilityColumnMap`, `ColumnMapError` (Task 1).
- Produces: `FacilityImportOptions.columnMap`; `FacilityImportResult.columnMapErrors`; `FacilityImportBlockedReason` gains `'column-map'`.

- [ ] **Step 1: Write the failing test**

Add to `packages/bootstrap/src/facility-import.test.ts`:

```ts
it('imports a file whose headers are not the contract, through a column map', async () => {
  const res = await importFacilities(
    { db },
    'MFL Code,Name,Province\n1835,Namatindi RHC,Western\n',
    {
      nationalSystem: SYSTEM,
      columnMap: {
        columns: { 'MFL Code': 'national_code', Name: 'name', Province: 'zone' },
        constants: { country: 'ZMB' },
      },
      apply: true,
    },
  );
  expect(res.columnMapErrors).toEqual([]);
  expect(res.blocked).toBeNull();
  expect(res.written.created).toBe(1);
});

it('⛔ BLOCKS on a bad column map and writes nothing', async () => {
  const res = await importFacilities(
    { db },
    'A,B\n1,2\n',
    {
      nationalSystem: SYSTEM,
      columnMap: { columns: { A: 'national_code', B: 'national_code' } },
      apply: true,
    },
  );
  expect(res.blocked).toBe(true);
  expect(res.blockedReason).toBe('column-map');
  expect(res.columnMapErrors.map((e) => e.reason).sort())
    .toEqual(['duplicate_target', 'missing_required']);
  expect(res.written.created).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/bootstrap test -- facility-import
```

Expected: FAIL — `columnMap` is not an accepted option.

- [ ] **Step 3: Add the option and thread it to the parser**

In `packages/bootstrap/src/facility-import.ts`, add to `FacilityImportOptions` beside
`allowUnknownColumns` (~line 121):

```ts
  /** Map this file's headers onto the contract before parsing (`FacilityColumnMap`,
   *  packages/terminology). CSV only — a JSONL release is already in the contract's own shape, so a
   *  map for one is meaningless and is ignored rather than erroring. */
  columnMap?: FacilityColumnMap;
```

Import the type at the top of the file, from the existing `@openldr/terminology` import block:

```ts
import {
  parseFacilityCsv, parseFacilityRelease,
  type FacilityReleaseResult, type FacilityReleaseMeta, type QuarantinedRow, type RowError,
  type FacilityColumnMap, type ColumnMapError,
} from '@openldr/terminology';
```

At the parse call site (line 592), the map goes into `parseOpts`, which is already built for both
parsers. Add `columnMap: opts.columnMap` to that object. `parseFacilityRelease` ignores it.

- [ ] **Step 4: Block on map errors**

`FacilityImportBlockedReason` (line 186) gains the new member:

```ts
export type FacilityImportBlockedReason =
  'duplicate-columns' | 'column-map' | 'quarantined-rows' | null;
```

⛔ **There is no early `return` here, and no `emptyResult` object.** The result carries
`blocked: boolean` **and** `blockedReason` (`facility-import.ts:245-253`), and both are computed in
exactly one place — the `blockedReason` ternary at `facility-import.ts:647-650`. Extend that ternary
rather than adding a return path; every consumer reads `blocked`/`blockedReason` and the file's own
docblock forbids re-deriving the predicate anywhere else.

```ts
  const blockedReason: FacilityImportResult['blockedReason'] =
    duplicateColumns.length > 0
      ? 'duplicate-columns'
      : (parsed.columnMapErrors.length > 0
        ? 'column-map'
        : (quarantined.length > 0 && !opts.allowMalformedRows ? 'quarantined-rows' : null));
  const blocked = blockedReason !== null;
```

**Precedence, stated because it is a decision and not an accident:** `'duplicate-columns'` still
wins, because a header appearing twice makes any map for it ambiguous — no map can fix it, so
reporting the map error first would offer the operator a repair that cannot work. `'column-map'`
beats `'quarantined-rows'` for the mirror-image reason: a misrouted column makes rows look malformed,
so an operator shown the quarantine count would chase the wrong problem. This matches the parser's
own ordering in Task 1.

Add `columnMapErrors: ColumnMapError[]` to `FacilityImportResult`, and include
`columnMapErrors: parsed.columnMapErrors` in the single result construction at
`facility-import.ts:740`, beside `duplicates, blocked, blockedReason`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap test -- facility-import
```

Expected: PASS, with every pre-existing test in the file still green.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "feat(facilities): accept a column map on an import and block on a bad one"
```

---

### Task 4: The suggestion route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `suggestColumns`, `suggestValues`, `ValueCandidate` (Task 2); `CONTROLLED_VALUE_SETS` (existing).
- Produces: `POST /api/facilities/import/suggest-map` → `{ headers: string[], columns: ColumnSuggestion[] }`; `POST /api/facilities/import/suggest-values` → `{ values: ValueSuggestion[] }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/facilities-routes.test.ts`:

```ts
it('suggests a column map from a file header row', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import/suggest-map',
    payload: { csv: 'MFL Code,Name,Province,Catchment population cso\n1835,X,Western,10\n' },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.headers).toEqual(['MFL Code', 'Name', 'Province', 'Catchment population cso']);
  const byHeader = Object.fromEntries(body.columns.map((c: any) => [c.header, c.candidates]));
  expect(byHeader['MFL Code'][0]).toMatchObject({ target: 'national_code' });
  expect(byHeader.Province[0]).toMatchObject({ target: 'zone' });
  expect(byHeader['Catchment population cso']).toEqual([]);
});

it('refuses a suggest-map request with no header row', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import/suggest-map', payload: { csv: '' },
  });
  expect(res.statusCode).toBe(400);
});

it('suggests value mappings from the bound value set', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import/suggest-values',
    payload: { field: 'status', values: ['Functional', 'Temporarily closure'] },
  });
  expect(res.statusCode).toBe(200);
  const byValue = Object.fromEntries(res.json().values.map((v: any) => [v.value, v.candidates]));
  // Neither Zambian word resembles active/suspended/inactive closely enough to clear the floor.
  // Mapping them is a human judgement, and the engine says so by offering nothing.
  expect(byValue.Functional).toEqual([]);
  expect(byValue['Temporarily closure']).toEqual([]);
});

it('refuses suggest-values for a field that is not controlled', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import/suggest-values',
    payload: { field: 'name', values: ['x'] },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server test -- facilities-routes
```

Expected: FAIL with 404 on both new routes.

- [ ] **Step 3: Add the routes**

In `apps/server/src/facilities-routes.ts`, beside the other import routes (after
`/api/facilities/import/sources`, ~line 1460):

```ts
  // Header row + ranked suggestions, for BOTH import doors. The inline path already holds the file
  // text client-side; the streamed path does not, since the file is a blob only the server can read.
  // One endpoint rather than two mechanisms that would drift.
  app.post('/api/facilities/import/suggest-map', IMPORT, async (req, reply) => {
    const body = (req.body ?? {}) as { csv?: string };
    // Only the first line is needed. Parsing the whole file to read its header would make a 64 MiB
    // upload pay for a suggestion.
    const firstLine = (body.csv ?? '').split(/\r?\n/, 1)[0] ?? '';
    const headers = firstLine.split(',').map((h) => h.trim()).filter((h) => h !== '');
    if (headers.length === 0) {
      return reply.code(400).send({ error: 'no header row found in the supplied file' });
    }
    return { headers, columns: suggestColumns(headers) };
  });

  app.post('/api/facilities/import/suggest-values', IMPORT, async (req, reply) => {
    const body = (req.body ?? {}) as { field?: string; values?: string[] };
    const field = body.field as ControlledField | undefined;
    if (!field || !CONTROLLED_FIELDS.includes(field)) {
      return reply.code(400).send({ error: `field must be one of ${CONTROLLED_FIELDS.join(', ')}` });
    }
    const values = Array.isArray(body.values) ? body.values : [];

    const vs = await ctx.terminologyAdmin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[field]);
    if (!vs) {
      // The field's value set is not seeded on this install — the same condition
      // `resolveControlledFields` reports as `notValidated`. No candidates exist to rank against.
      return { values: values.map((value) => ({ value, candidates: [] })), notValidated: true };
    }
    const { codes } = await ctx.terminologyAdmin.valueSets.expand(vs.id);
    const candidates = codes.map((c) => ({ code: c.code, display: c.display ?? null }));
    return { values: suggestValues(values, candidates), notValidated: false };
  });
```

Add to the file's `@openldr/bootstrap` import block:

```ts
  suggestColumns, suggestValues, CONTROLLED_FIELDS, CONTROLLED_VALUE_SETS, type ControlledField,
```

Note the CSV split above is deliberately naive — a quoted header containing a comma would split
wrongly. That is acceptable here because the suggestion is advisory and the operator sees and
confirms every header before anything is imported; the authoritative header parse remains
`parseFacilityCsv`'s. Leave a comment saying so, so a later reader does not "fix" it into a second
CSV parser.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server test -- facilities-routes
```

Expected: PASS.

- [ ] **Step 5: Lint**

`apps/server` is the only package with real lint, and it enforces the return/await `reply.send`
gzip-clobber invariant.

```bash
pnpm --filter @openldr/server lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): serve column and value mapping suggestions"
```

---

### Task 5: Write value mappings

**Files:**
- Create: `packages/bootstrap/src/facility-value-mappings.ts`
- Test: `packages/bootstrap/src/facility-value-mappings.test.ts`
- Modify: `packages/bootstrap/src/index.ts` (export)

**Interfaces:**
- Consumes: `observedFieldSystem`, `CONTROLLED_VALUE_SETS`, `ControlledField` (existing); `TerminologyAdminStore`.
- Produces: `FACILITY_VALUE_MAP_TYPE`; `saveFacilityValueMappings(admin, nationalSystem, entries): Promise<SaveValueMappingsResult>`; types `ValueMappingEntry`, `SaveValueMappingsResult`.

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/facility-value-mappings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { saveFacilityValueMappings, FACILITY_VALUE_MAP_TYPE } from './facility-value-mappings';
import { observedFieldSystem } from './facility-controlled-fields';

const SYSTEM = 'urn:zm:mfl';

/** Codes per value-set url, so a `status` entry validates against status codes rather than level's. */
const EXPANSIONS: Record<string, { code: string; display: string }[]> = {
  'urn:openldr:valueset:facility-type': [
    { code: 'health-center', display: 'Health Center' },
    { code: 'health-post', display: 'Health Post' },
  ],
  'urn:openldr:valueset:location-status': [
    { code: 'active', display: 'Active' },
    { code: 'inactive', display: 'Inactive' },
  ],
  'urn:openldr:valueset:country': [{ code: 'ZMB', display: 'Zambia' }],
};

function fakeAdmin() {
  const saved: any[] = [];
  const systems: any[] = [];
  const createdTerms: any[] = [];
  return {
    saved, systems, createdTerms,
    valueSets: {
      getByUrl: async (url: string) => ({ id: url }),
      expand: async (id: string) => ({ codes: EXPANSIONS[id] ?? [] }),
    },
    codingSystems: { upsertByUrl: async (i: any) => { systems.push(i); } },
    terms: { create: async (i: any) => { createdTerms.push(i); } },
    termMappings: {
      saveExclusive: async (i: any) => { saved.push(i); return { mapping: i, draftCreated: false, superseded: [] }; },
    },
  } as any;
}

describe('saveFacilityValueMappings', () => {
  it('writes one exclusive mapping per raw value, under the derived source system', async () => {
    const admin = fakeAdmin();
    const res = await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
    ]);
    expect(res.written).toBe(1);
    expect(admin.saved[0]).toMatchObject({
      fromSystem: observedFieldSystem('level', SYSTEM),
      fromCode: 'Health Centre',
      toCode: 'health-center',
      mapType: FACILITY_VALUE_MAP_TYPE,
      isActive: true,
    });
  });

  it('uses the SAME map type for every field, so exclusivity and resolution agree', async () => {
    // Not an assertion about the constant's literal value — that would prove nothing. This asserts
    // the property that matters: two mappings written for DIFFERENT fields still share one map type,
    // which is what makes saveExclusive's (toSystem, mapType) scope line up with
    // resolveControlledFields' toSystem-blind lookup. Vary the type per field and the two disagree.
    const admin = fakeAdmin();
    await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
      { field: 'status', rawValue: 'Functional', toCode: 'active' },
    ]);
    expect(new Set(admin.saved.map((m: any) => m.mapType)).size).toBe(1);
  });

  it('creates the source coding system and its concept, so the mapping is editable afterwards', async () => {
    const admin = fakeAdmin();
    await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'status', rawValue: 'Functional', toCode: 'active' },
    ]);
    expect(admin.systems[0]).toMatchObject({ url: observedFieldSystem('status', SYSTEM) });
    expect(admin.createdTerms[0]).toMatchObject({ code: 'Functional' });
  });

  it('refuses a target that is not in the field value set, rather than minting a draft', async () => {
    const admin = fakeAdmin();
    await expect(saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Hospice', toCode: 'not-a-real-code' },
    ])).rejects.toThrow(/not in the .* value set/);
    expect(admin.saved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/bootstrap test -- facility-value-mappings
```

Expected: FAIL with "Cannot find module './facility-value-mappings'".

- [ ] **Step 3: Write the module**

Create `packages/bootstrap/src/facility-value-mappings.ts`:

```ts
import type { MapType, TerminologyAdminStore } from '@openldr/db';
import {
  CONTROLLED_VALUE_SETS, observedFieldSystem, type ControlledField,
} from './facility-controlled-fields';

/**
 * ⛔ ONE map type for EVERY controlled-field value mapping, and it is load-bearing.
 *
 * `resolveControlledFields` (facility-controlled-fields.ts) reads
 * `termMappings.listOutgoing(fromSystem, raw)` and takes the FIRST ACTIVE row — it never looks at
 * `toSystem` or `mapType` at all. `saveExclusive` (packages/db/src/terminology-admin-store.ts:199)
 * scopes its "exactly one active mapping" guarantee BY `(toSystem, mapType)`. So two mappings for
 * the same raw value written under different scopes would BOTH stay active, and resolution would
 * pick between them arbitrarily — a silent wrong value, not an error.
 *
 * Pinning one constant makes the store's exclusivity and the resolver's lookup describe the same
 * set. `'SAME-AS'` because a register's own word for a concept IS that concept; a mapping like
 * `1st Level Hospital -> district-hospital` is arguably `NARROWER-THAN`, but expressing that nuance
 * would cost the exclusivity guarantee, and the resolver discards the nuance anyway.
 */
export const FACILITY_VALUE_MAP_TYPE: MapType = 'SAME-AS';

export interface ValueMappingEntry {
  field: ControlledField;
  /** The source value EXACTLY as the parser produced it — trimmed, since `text()` already trimmed
   *  it (`packages/terminology/src/facility-csv.ts:114`). `resolveControlledFields` looks it up by
   *  exact string, so a differently-spaced copy would never resolve. */
  rawValue: string;
  /** A code from the field's bound value set. */
  toCode: string;
}

export interface SaveValueMappingsResult {
  written: number;
  /** Mapping ids deactivated because they were the previous active mapping for the same value. */
  superseded: string[];
}

/**
 * Write value mappings for one register's controlled fields.
 *
 * Also creates the source coding system and a concept per raw value. `term_mappings` does not
 * require the source concept to exist, so this could be skipped — it must not be. A mapping with no
 * source term is invisible in Settings -> Terminology and therefore uneditable afterwards, which
 * turns a correction into a support call. This mirrors what `termMappings.create` already does for a
 * missing TARGET concept (terminology-admin-store.ts:724).
 */
export async function saveFacilityValueMappings(
  admin: TerminologyAdminStore,
  nationalSystem: string,
  entries: readonly ValueMappingEntry[],
): Promise<SaveValueMappingsResult> {
  // Validate EVERY entry before writing ANY of them: a half-applied mapping set is worse than a
  // refused one, because the operator cannot tell which half landed.
  const expansions = new Map<ControlledField, Map<string, string | null>>();
  for (const entry of entries) {
    if (!expansions.has(entry.field)) {
      const vs = await admin.valueSets.getByUrl(CONTROLLED_VALUE_SETS[entry.field]);
      if (!vs) throw new Error(`no ${entry.field} value set is seeded on this install`);
      const { codes } = await admin.valueSets.expand(vs.id);
      expansions.set(entry.field, new Map(codes.map((c) => [c.code, c.display ?? null])));
    }
    if (!expansions.get(entry.field)!.has(entry.toCode)) {
      throw new Error(
        `${entry.toCode} is not in the ${entry.field} value set — refusing rather than minting a draft concept`,
      );
    }
  }

  const superseded: string[] = [];
  let written = 0;

  for (const entry of entries) {
    const fromSystem = observedFieldSystem(entry.field, nationalSystem);
    const toDisplay = expansions.get(entry.field)!.get(entry.toCode) ?? null;

    await admin.codingSystems.upsertByUrl({
      systemCode: `FAC-${entry.field.toUpperCase()}-OBSERVED`,
      systemName: `Observed facility ${entry.field} values`,
      url: fromSystem,
      systemVersion: null,
      publisherId: 'pub-system',
    });
    await admin.terms.create({ system: fromSystem, code: entry.rawValue, display: entry.rawValue });

    const res = await admin.termMappings.saveExclusive({
      fromSystem,
      fromCode: entry.rawValue,
      toSystem: CONTROLLED_VALUE_SETS[entry.field],
      toCode: entry.toCode,
      toDisplay,
      mapType: FACILITY_VALUE_MAP_TYPE,
      isActive: true,
    });
    superseded.push(...res.superseded);
    written += 1;
  }

  return { written, superseded };
}
```

⚠ Before implementing, confirm the real signatures of `admin.codingSystems.upsertByUrl` and
`admin.terms.create` against `packages/db/src/terminology-admin-store.ts` and adjust the calls —
`upsertByUrl` is at line ~588 and takes `{ systemCode, systemName, url, systemVersion, publisherId }`.
If `terms.create` rejects a duplicate code, catch and ignore that specific case: re-running a mapping
must be idempotent.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap test -- facility-value-mappings
```

Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/bootstrap/src/index.ts`:

```ts
export { saveFacilityValueMappings, FACILITY_VALUE_MAP_TYPE } from './facility-value-mappings';
export type { ValueMappingEntry, SaveValueMappingsResult } from './facility-value-mappings';
```

```bash
git add packages/bootstrap/src/facility-value-mappings.ts packages/bootstrap/src/facility-value-mappings.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(facilities): write controlled-field value mappings under one pinned map type"
```

---

### Task 6: The value-mapping route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `saveFacilityValueMappings`, `ValueMappingEntry` (Task 5).
- Produces: `POST /api/facilities/import/value-mappings` → `{ written: number, superseded: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
it('writes value mappings and audits them', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import/value-mappings',
    payload: {
      nationalSystem: 'urn:tz:hfr',
      mappings: [{ field: 'status', rawValue: 'Operating', toCode: 'active' }],
    },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().written).toBe(1);
  const events = await auditStore.list({ action: 'facility.value-mapping' });
  expect(events).toHaveLength(1);
});

it('refuses a nationalSystem that names no registered source', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/facilities/import/value-mappings',
    payload: { nationalSystem: 'typed by hand', mappings: [] },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/server test -- facilities-routes
```

Expected: FAIL with 404.

- [ ] **Step 3: Add the route**

```ts
  app.post('/api/facilities/import/value-mappings', MANAGE, async (req, reply) => {
    const body = (req.body ?? {}) as { nationalSystem?: string; mappings?: ValueMappingEntry[] };

    // Same gate as both import doors: `nationalSystem` is a REGISTERED source's url, never a label
    // somebody typed. `observedFieldSystem` slugifies whatever it is given, so a typed string writes
    // mappings under a namespace nothing will ever resolve against (facility-controlled-fields.ts:60).
    const source = body.nationalSystem
      ? await ctx.facilityRegisterSources.getByUrl(body.nationalSystem)
      : null;
    if (!source) {
      return reply.code(400).send({ error: 'nationalSystem must name a registered facility register' });
    }

    const mappings = Array.isArray(body.mappings) ? body.mappings : [];
    let result;
    try {
      result = await saveFacilityValueMappings(ctx.terminologyAdmin, source.url, mappings);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    await recordAuditEvent(ctx, req, {
      action: 'facility.value-mapping',
      detail: { nationalSystem: source.url, written: result.written, superseded: result.superseded.length },
    });
    return result;
  });
```

⚠ Match `recordAuditEvent`'s real signature in this file — copy the shape from the neighbouring
`/api/facilities/publish` handler rather than the sketch above.

- [ ] **Step 4: Run the tests, then lint**

```bash
pnpm --filter @openldr/server test -- facilities-routes
pnpm --filter @openldr/server lint
```

Expected: PASS, then clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): write value mappings through a gated route"
```

---

### Task 7: The column-mapping panel

**Files:**
- Create: `apps/studio/src/facilities/ColumnMapStep.tsx`
- Test: `apps/studio/src/facilities/ColumnMapStep.test.tsx`
- Modify: `apps/studio/src/api.ts` (client functions and types)

**Interfaces:**
- Consumes: `POST /api/facilities/import/suggest-map` (Task 4).
- Produces: `<ColumnMapStep headers value onChange />` where `value: FacilityColumnMap`; `suggestColumnMap(csv): Promise<{ headers, columns }>` in `api.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnMapStep } from './ColumnMapStep';

const suggestions = [
  { header: 'MFL Code', candidates: [{ target: 'national_code', display: null, score: 1, confidence: 'exact' }] },
  { header: 'Province', candidates: [{ target: 'zone', display: null, score: 1, confidence: 'exact' }] },
  { header: 'Catchment population cso', candidates: [] },
];

it('pre-selects exact suggestions and leaves unmatched headers unset', () => {
  render(<ColumnMapStep headers={suggestions.map((s) => s.header)} suggestions={suggestions}
    value={{ columns: {}, constants: {}, extras: [] }} onChange={() => {}} />);
  expect(screen.getByLabelText('MFL Code')).toHaveTextContent('national_code');
  expect(screen.getByLabelText('Catchment population cso')).toHaveTextContent('Not mapped');
});

it('⛔ refuses to continue while a required field is unmapped', () => {
  render(<ColumnMapStep headers={['Province']} suggestions={[suggestions[1]]}
    value={{ columns: { Province: 'zone' }, constants: {}, extras: [] }} onChange={() => {}} />);
  expect(screen.getByText(/name is not mapped/i)).toBeInTheDocument();
});

it('sends a header to extras in one action', async () => {
  const onChange = vi.fn();
  render(<ColumnMapStep headers={['Catchment population cso']} suggestions={[suggestions[2]]}
    value={{ columns: {}, constants: {}, extras: [] }} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: /keep as extra/i }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ extras: ['Catchment population cso'] }));
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/studio test -- ColumnMapStep
```

Expected: FAIL with "Cannot find module './ColumnMapStep'".

- [ ] **Step 3: Build the panel**

Follow `AGENTS.md` §5 exactly. Before writing it, **open `apps/studio/src/pages/settings/Connectors.tsx`
and copy its field layout** — `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`, label-left /
input-right. Requirements:

- One row per file header. Label is the header **as it appears in the file**. Control is a shadcn
  `Select` over the 16 contract fields plus `Not mapped`.
- A header whose top candidate is `exact` is pre-selected with no badge. `likely` is pre-selected
  **with a badge reading "check this"**. `weak` and empty pre-select nothing.
- A `⋯` `DropdownMenu` per row carries "Keep as extra" and "Clear". **Never a standalone button.**
- A constants section for fields no column maps — `country` is the case that forced it. A shadcn
  `Input`, never a native one.
- A blocking summary listing every unmapped required field by name. The Continue action stays
  disabled while it is non-empty.
- Show the row count each decision affects where known, per the spec: facilities, not strings.

Add to `apps/studio/src/api.ts`:

```ts
export interface ColumnSuggestion {
  header: string;
  candidates: { target: string; display: string | null; score: number; confidence: 'exact' | 'likely' | 'weak' }[];
}

export async function suggestColumnMap(csv: string): Promise<{ headers: string[]; columns: ColumnSuggestion[] }> {
  return postJson('/api/facilities/import/suggest-map', { csv });
}
```

Match `postJson`'s real name and signature in that file — copy a neighbouring call rather than
assuming.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/studio test -- ColumnMapStep
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/ColumnMapStep.tsx apps/studio/src/facilities/ColumnMapStep.test.tsx apps/studio/src/api.ts
git commit -m "feat(facilities): map file columns to the contract in the import sheet"
```

---

### Task 8: The value-mapping panel and wizard wiring

**Files:**
- Create: `apps/studio/src/facilities/ValueMapPanel.tsx`
- Test: `apps/studio/src/facilities/ValueMapPanel.test.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/api.ts`

**Interfaces:**
- Consumes: `POST /api/facilities/import/suggest-values` (Task 4); `POST /api/facilities/import/value-mappings` (Task 6); `FacilityImportResult.unmapped` (existing).
- Produces: `<ValueMapPanel nationalSystem unmapped onSaved />`.

- [ ] **Step 1: Write the failing test**

```tsx
it('lists every unmapped value with a ranked pick-list', async () => {
  render(<ValueMapPanel nationalSystem="urn:zm:mfl"
    unmapped={{ level: ['Health Centre', '1st Level Hospital'], status: [], country: [] }}
    onSaved={() => {}} />);
  expect(await screen.findByLabelText('Health Centre')).toBeInTheDocument();
  expect(screen.getByLabelText('1st Level Hospital')).toHaveTextContent('Not mapped');
});

it('saves the chosen mappings and reports how many were written', async () => {
  const onSaved = vi.fn();
  render(<ValueMapPanel nationalSystem="urn:zm:mfl"
    unmapped={{ level: ['Health Centre'], status: [], country: [] }} onSaved={onSaved} />);
  await userEvent.click(await screen.findByRole('button', { name: /save mappings/i }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('leaves an unmapped value alone rather than blocking the import', async () => {
  // Existing behaviour and it is right: an unmapped value writes through raw and is reported
  // (facility-controlled-fields.ts:155). This panel must never turn a warning into a wall.
  render(<ValueMapPanel nationalSystem="urn:zm:mfl"
    unmapped={{ level: ['Hospice'], status: [], country: [] }} onSaved={() => {}} />);
  expect(screen.queryByText(/cannot continue/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/studio test -- ValueMapPanel
```

Expected: FAIL with "Cannot find module './ValueMapPanel'".

- [ ] **Step 3: Build the panel and wire it in**

The panel renders one row per unmapped value, grouped by field, each with a shadcn `Select` of
ranked candidates. Actions live in a `⋯` `DropdownMenu`. On save it calls the value-mappings route,
then invokes `onSaved` so the sheet can **re-run the preview** — the mappings only take effect on a
fresh parse.

In `ImportFacilitiesSheet.tsx`:

- Render `<ColumnMapStep>` after a file is chosen and before the preview, for `format === 'csv'`
  only. A JSONL release is already in the contract's shape.
- Send the resulting map on every preview **and** every apply, beside `allowUnknownColumns` — the
  same discipline `format`/`completeRelease` already follow, and for the same reason: a preview and
  an apply that parse differently is the bug this sheet keeps re-learning.
- Render `<ValueMapPanel>` where the current unmapped warning sits (~line 452), keeping the warning
  text as the panel's own heading.
- After `onSaved`, re-run the preview.

⚠ Add `columnMap` to `FacilityImportRequest` in `api.ts`, and to `confirmOptionsFor` (~line 131) so a
confirmed background run applies with the same map it was validated with. A map dropped between
validate and apply would re-parse the file as raw headers and refuse it — the same class of bug the
existing comment at line 124 documents for `allowMalformedRows`.

- [ ] **Step 4: Run the studio tests**

```bash
pnpm --filter @openldr/studio test -- facilities
```

Expected: PASS, including the existing `ImportFacilitiesSheet` suite.

- [ ] **Step 5: Check it in a browser at phone width**

Start the dev server and drive the import with a small Zambia sample. Check at 375×812 that the
mapping rows do not overflow sideways and the pick-lists are reachable.

⛔ A portalled `PopoverContent` inside a Sheet cannot scroll — `react-remove-scroll` only allows the
Sheet's own subtree. If a `Select` list is unreachable, wrap rather than scrolling horizontally.

⛔ Headless Chromium cannot see the `vh`-vs-`dvh` bug class. If anything here ends up bottom-anchored,
say only a real phone can confirm it. Do not report it verified.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities/ValueMapPanel.tsx apps/studio/src/facilities/ValueMapPanel.test.tsx apps/studio/src/facilities/ImportFacilitiesSheet.tsx apps/studio/src/api.ts
git commit -m "feat(facilities): map source vocabulary during an import"
```

---

### Task 9: CLI parity

**Files:**
- Modify: `packages/cli/src/facilities.ts`
- Modify: `packages/cli/src/index.ts` (register the new commands)
- Test: `packages/cli/src/facilities.test.ts`

**Interfaces:**
- Consumes: `suggestColumns` (Task 2); `saveFacilityValueMappings` (Task 5); `FacilityImportOptions.columnMap` (Task 3).
- Produces: `facilitiesSuggestMap(opts)`, `facilitiesSuggestValues(opts)`; `FacilitiesImportOpts.columnMap`, `.valueMap`.

- [ ] **Step 1: Write the failing tests**

```ts
it('suggest-map prints a column map ready to edit and feed back', async () => {
  const out = await runCli(['facilities', 'suggest-map', fixture('zm-mfl-head.csv'), '--json']);
  const map = JSON.parse(out);
  expect(map.columns['MFL Code']).toBe('national_code');
  expect(map.columns.Province).toBe('zone');
  expect(map.extras).toContain('Catchment population cso');
});

it('import accepts a column map file', async () => {
  const out = await runCli([
    'facilities', 'import', fixture('zm-mfl-head.csv'),
    '--national-system', 'urn:zm:mfl', '--column-map', fixture('zm-mfl-map.json'), '--json',
  ]);
  expect(JSON.parse(out).columnMapErrors).toEqual([]);
});

it('⛔ reports a bad column map instead of importing', async () => {
  const out = await runCli([
    'facilities', 'import', fixture('zm-mfl-head.csv'),
    '--national-system', 'urn:zm:mfl', '--column-map', fixture('bad-map.json'), '--json',
  ]);
  expect(JSON.parse(out).blocked).toBe('column-map');
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/cli test -- facilities
```

Expected: FAIL — unknown command `suggest-map`, unknown option `--column-map`.

- [ ] **Step 3: Add the options and commands**

Add to `FacilitiesImportOpts`:

```ts
  /** Path to a column-map JSON file (`FacilityColumnMap`, packages/terminology) mapping this file's
   *  headers onto the contract. Produce a starting point with `openldr facilities suggest-map`. */
  columnMap?: string;
  /** Path to a value-map JSON file — an array of `{ field, rawValue, toCode }` written through
   *  `saveFacilityValueMappings`. */
  valueMap?: string;
```

Read and parse the file with `readFileSync` (already imported at line 1), pass the parsed object as
`columnMap` in the `importFacilities` options, and print `columnMapErrors` in both the JSON and the
human output.

Add the two new commands, registered in `packages/cli/src/index.ts` beside the existing facilities
commands:

```
openldr facilities suggest-map <path> [--json]
openldr facilities suggest-values <path> --national-system <sys> [--column-map <file>] [--json]
```

`suggest-map` reads only the first line of the file and prints a `FacilityColumnMap` whose `columns`
holds every exact/likely suggestion and whose `extras` holds every header with no candidate — so the
output is directly usable as `--column-map` after review.

⚠ Do NOT add a registered-source gate to `--national-system` here. The HTTP doors have one and the
CLI does not (`facility-csv.ts:103`); closing that is a separate slice. Do not widen it either — a
`--value-map` writes under `observedFieldSystem(field, <whatever was typed>)`, so document in the
command's help that a mistyped register writes mappings that will never resolve.

- [ ] **Step 4: Add fixtures**

Create `packages/cli/src/__fixtures__/zm-mfl-head.csv` with the real Zambia header row and three
rows, `zm-mfl-map.json` with a valid map, and `bad-map.json` mapping two headers to `national_code`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/cli test -- facilities
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/index.ts packages/cli/src/facilities.test.ts packages/cli/src/__fixtures__
git commit -m "feat(cli): suggest and apply facility import mappings headlessly"
```

---

### Task 10: Docs, the real-file check, and the gate

**Files:**
- Modify: in-app docs and web docs, **en, fr and pt**
- Test: `packages/terminology/src/facility-csv.test.ts` (fixture assertion)

- [ ] **Step 1: Add the measured Zambia fixture test**

Commit a trimmed sample of the real export (header plus ~20 rows) and assert the whole path:

```ts
it('maps the real Zambia MFL export end to end', () => {
  const r = parseFacilityCsv(readFileSync(fixture('zm-mfl-sample.csv'), 'utf8'), {
    nationalSystem: 'urn:zm:mfl',
    columnMap: ZM_MFL_MAP,
    allowUnknownColumns: false,
  });
  expect(r.columnMapErrors).toEqual([]);
  expect(r.unknownColumns).toEqual([]);
  expect(r.records).toHaveLength(20);
  expect(r.records.every((x) => x.country === 'ZMB')).toBe(true);
  expect(Object.keys(r.records[0].extras ?? {})).toHaveLength(9);
  expect(r.invalid).toEqual([]);  // 98 rows have BOTH coordinates blank; blank is absent, not invalid
});
```

- [ ] **Step 2: Write the docs**

Cover: what a column map is, how to get a suggested one, what each refusal means and how to fix it,
and that an unmapped *value* imports raw while an unmapped *required column* blocks.

⛔ **A missing i18n key renders as literal braces**, so a partial translation ships visibly broken.
All three languages or none.

- [ ] **Step 3: Run the full gate**

```bash
pnpm turbo run test
```

Never pipe this through `tail` — it truncates the failure list and hides which package failed. A
failure is usually a timeout: grep the output for `Test timed out` and re-run that package alone
before blaming a change.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(facilities): explain import column and value mapping"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: column map §1 → Task 1; parser-native §2 →
Task 1; refusals §3 → Task 1; suggestion engine §4 → Task 2; value mapping §5 → Tasks 5, 6, 8; flow
§6 → Tasks 4, 7, 8; CLI parity §7 → Task 9; error handling → Tasks 1, 5, 6; testing → every task
plus Task 10.

**Two gaps found and closed while reviewing.**

1. The spec's flow requires the column map to survive from validate to apply on the background path.
   Nothing covered it. Added to Task 8, Step 3 as an explicit `confirmOptionsFor` change — a map
   dropped there would re-parse the file with raw headers and refuse it.
2. `FacilityImportResult.columnMapErrors` has to reach the studio's own copy of that type in
   `api.ts`, not just the bootstrap one. Folded into Task 7, Step 3.

**Known soft spots, stated rather than hidden.**

- Task 5's `admin.codingSystems.upsertByUrl` and `admin.terms.create` call shapes are written from
  the store's interface, not from a call site I executed. Both steps carry a ⚠ to verify against
  `terminology-admin-store.ts` first.
- Task 4's route sketch uses `ctx.terminologyAdmin` and `ctx.facilityRegisterSources`. Confirm those
  names against the neighbouring handlers in `facilities-routes.ts` before writing.
- Task 6's `recordAuditEvent` call is a sketch; copy the shape from `/api/facilities/publish`.

**pg-mem warning.** Task 5's tests use a hand-written fake, not pg-mem, precisely because pg-mem
would prove nothing about `saveExclusive`'s partial unique index. Real exclusivity behaviour needs a
Postgres-backed test — add one alongside the existing Postgres-only external-migration tests, or
record it as an HONEST NON-PROOF in the completion report.

**HONEST NON-PROOF, carried from the spec.** Nothing in this plan proves an operator reads the
confidence badges as intended, or that the ranking is *useful* rather than merely correct. Only
watching someone map an unfamiliar national list start to finish shows that. The Zambia file is the
obvious candidate.
