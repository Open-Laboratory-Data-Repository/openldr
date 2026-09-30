# Numeric Results Outside the Reporting Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dropping viral loads DISA stores as 0, and send every numeric result outside its reporting range as `<` or `>` its limit, as v1 shows it; CE stores the comparator.

**Architecture:** CE first: warehouse migration 020 adds `lab_results.numeric_comparator`, and the Observation projection reads `valueQuantity.comparator`. Then cdr-toolchain: disalab reads each result item's entered flag (byte 6) and keeps PARMDICT's raw bytes; the CLI reads the low and high limits from configured offsets; `toV2` applies the rule; `toFhir` sends the comparator.

**Tech Stack:** TypeScript, Kysely, pg-mem, vitest (CE); node:test + tsx, zod, yaml (cdr-toolchain); SQL Server read-only for measurements.

**Spec:** `docs/superpowers/specs/2026-09-30-censored-numeric-results-design.md`

## Global Constraints

- Rule, exactly: for a numeric result value `v` with limits `low` and `high` (each `number | null`; 0 and unconfigured are null): `low !== null && v < low` gives comparator `<` and value `low`; else `high !== null && v > high` gives `>` and `high`; else no comparator and value `v`. Equal to a limit is not censored.
- An entered numeric 0 is a result: for item types 1 and 2, the item is resulted when byte 6 is not 0, even if the value bytes are all zero. Other types unchanged.
- Offsets (Tanzania measured): PARMDICT_STATUS float32 little-endian at byte 103 = high limit, byte 107 = low limit. They live in `config/<country>.yaml` as `disa_parmdict_offsets: { high_limit: 103, low_limit: 107 }`. Unconfigured means no comparator.
- PARMDICT floats must be read from the raw bytes (`Core.ConvertToBytes`, latin1), never `Core.FixBytes` (it turns byte 0 into a space and corrupts floats).
- Wire: FHIR `Observation.valueQuantity.comparator` is `<` or `>`; `value` is the limit. V2: `numeric_value` is the limit, `result_value` is `< 20` / `> 10000000` (the limit with JS number formatting), `raw_result.numeric_comparator` holds the sign. No new V2 field.
- CE: `lab_results.numeric_comparator` text, nullable, migration `020`, on Postgres, SQL Server and MySQL. The projection keeps only `<`, `<=`, `>=`, `>`; anything else is null. `result_type` stays `NM`.
- No hardcoded parameter codes (HIVVM etc.) in source; the rule is generic.
- No em dashes or emoji in new writing. Never a `Co-Authored-By` trailer.
- CE work: worktree `D:/Projects/Repositories/openldr_ce/.claude/worktrees/censored-results`, branch `spec/censored-results`. cdr work: worktree `D:/Projects/Repositories/cdr-toolchain/.claude/worktrees/censored-results`, branch `spec/censored-results` (the controller creates it before Task 3). Prefix every command with `cd` to the right worktree; check `git branch --show-current` before committing; stage by exact path.
- Tests: CE `pnpm --filter <pkg> exec vitest run <path>`; cdr `pnpm --filter <pkg> exec node --import tsx --test <file>`. Never read an exit code through a pipe.

---

### Task 1: CE: the comparator column and the projection

**Files:**
- Create: `packages/db/src/migrations/external/020_lab_result_comparator.ts`, `020_lab_result_comparator.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`, `packages/db/src/migrations/migrations.test.ts` (pinned list), `packages/db/src/facility-registry-store.test.ts:380` (pinned count "010..019 ten rows")
- Modify: `packages/db/src/schema/external.ts` (`LabResultsTable`, `EXTERNAL_TABLE_COLUMNS.lab_results`)
- Modify: `packages/db/src/relational/observation.ts`
- Create: `packages/db/src/relational/observation.test.ts`

- [ ] **Step 1: Failing tests.** Migration test (copy `019_v1_request_facts.test.ts`'s shape): insert a `lab_results` row with `numeric_comparator = '<'` and read it back; a row without it reads NULL. Projection test:

```ts
import { describe, it, expect } from 'vitest';
import { projectObservation } from './observation';

const obs = (valueQuantity: Record<string, unknown>) => ({
  resourceType: 'Observation', id: 'o1', status: 'final', code: { coding: [{ code: 'HIVVM' }] }, valueQuantity,
});

describe('projectObservation comparator', () => {
  it.each(['<', '<=', '>=', '>'])('keeps %s', (c) => {
    expect(projectObservation(obs({ value: 20, comparator: c }), {})).toMatchObject({ numeric_value: 20, numeric_comparator: c, result_type: 'NM' });
  });
  it('is null without a comparator', () => {
    expect(projectObservation(obs({ value: 540 }), {}).numeric_comparator).toBeNull();
  });
  it('drops an unknown comparator', () => {
    expect(projectObservation(obs({ value: 20, comparator: 'ad' }), {}).numeric_comparator).toBeNull();
  });
});
```

- [ ] **Step 2: Run and check they fail.**
- [ ] **Step 3: Implement.** Migration 020 in 019's style: `alterTable('lab_results').addColumn('numeric_comparator', sql.raw(textType(engine)))`; `down` drops it. Register `020` after `019` in `index.ts`. `LabResultsTable` gains `numeric_comparator: string | null`; `EXTERNAL_TABLE_COLUMNS.lab_results` gains it after `numeric_units`. `observation.ts`: `const comparator = str(quantity?.['comparator']);` then `numeric_comparator: comparator !== null && ['<', '<=', '>=', '>'].includes(comparator) ? comparator : null` (a named `const COMPARATORS` set at the top). Update the two pinned tests.
- [ ] **Step 4: Run** `pnpm --filter @openldr/db exec vitest run src/migrations src/relational src/facility-registry-store.test.ts src/export-data.test.ts` and the db typecheck, redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(db): store the comparator of a numeric result`.

### Task 2: CE: docs

**Files:** `apps/studio/src/docs/0.1.8/{en,fr,pt}/advanced-docs.md`, `apps/web/src/docs/0.1.8/load-data.md`

- [ ] **Step 1.** In each file's "Request facts and request attributes" section (or next to where `lab_results` is described in `load-data.md`), add two sentences: a numeric result outside the lab's reporting range arrives as the limit with a comparator, for example `< 20`; `lab_results.numeric_comparator` holds `<`, `<=`, `>=` or `>`, and is empty for an ordinary number. fr and pt in each file's vocabulary; no em dashes.
- [ ] **Step 2.** `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web exec vitest run src/docs`, redirected, `exit=0`.
- [ ] **Step 3: Commit** `docs: numeric results outside the reporting range`.

### Task 3: cdr: the entered flag and PARMDICT raw bytes (disalab)

**Files:** `packages/disalab/src/lib/orderitem.ts`, `packages/disalab/src/lib/DisaGlobal/PARMDICT.ts`, create `packages/disalab/src/lib/orderitem.test.ts`, `packages/disalab/src/lib/DisaGlobal/PARMDICT.test.ts`

**Interfaces:** Produces `OrderItem` constructor option `entered?: boolean` (appended last); `PARMDICT.Raw: string` (latin1, byte 0 kept).

- [ ] **Step 1: Failing tests.**
  - `new OrderItem(1, 'HIVVM', '\0\0\0\0\0', 1, null, undefined, undefined, true)` has `IsResulted === true` and `Value === 0`; the same with `entered` false has `IsResulted === false`; a coded item (type 3) with an empty value and `entered` true stays not resulted.
  - `OrderItem.Parse` over a hand-built 80-byte header plus two 12-byte items (`HIVVM`, type 1, byte 6 = 9, zero value; `HIVTL`, type 1, byte 6 = 0, zero value) returns HIVVM resulted with value 0 and HIVTL not resulted. Parse needs no server for this (`code` empty skips PARMDICT); check its signature and pass what it needs.
  - A PARMDICT built from bytes with float 20 at 107 and 1e7 at 103 has `Raw.charCodeAt(107..110)` equal to those bytes (byte 0 preserved).
- [ ] **Step 2: Run and check they fail.**
- [ ] **Step 3: Implement.** In `Parse`, read `const entered = data.charCodeAt(startIndex + 6) !== 0;` and pass it to the constructor. In the constructor, for numeric types (1, 2, `Real`, `Integer`, `Accounting`): `this.IsResulted = hasValue || entered === true`; when resulted, `this.Value = converter.ToSingle(value)` (four zero bytes give 0). Leave line 112's `resulted` argument as it is (it feeds `ResultType`; say so in a comment). In `PARMDICT`, set `this.Raw = Core.ConvertToBytes(bytes)` first in the constructor.
- [ ] **Step 4.** disalab tests, typecheck, `pnpm --filter disalab build`, each redirected, `exit=0`.
- [ ] **Step 5: Commit** `fix(disalab): an entered numeric zero is a result; keep PARMDICT raw bytes`.

### Task 4: cdr: the limits in config and the codebook

**Files:** create `apps/cli/src/config/parmdict-offsets.ts` + test; modify `config/tanzania.yaml`, `apps/cli/src/export/codebook.ts` (+ its test or a new one), the `loadCodebook` callers in `apps/cli/src/commands/export.ts:228`, `export-batch.ts:1071`, `compare-batch.ts:354` (and `audit.ts:125` passes nothing).

**Interfaces:** `loadParmdictOffsets(country: string | undefined, dir?: string): { highLimit: number; lowLimit: number } | null`; `loadCodebook(server, parmdictOffsets?: {highLimit; lowLimit} | null)`; `ParmEntry` gains `lowLimit: number | null; highLimit: number | null`; a pure `readParmLimits(raw: string, offsets): { lowLimit: number | null; highLimit: number | null }` (float32 LE; 0, non-finite or offset past the end give null).

- [ ] **Step 1: Failing tests.** Loader: reads `disa_parmdict_offsets` from a temp yaml; unknown country or missing block gives null; a non-integer offset is refused (copy `blob-offsets.test.ts`'s `dirWith` pattern); the real `config/tanzania.yaml` gives `{ highLimit: 103, lowLimit: 107 }`. `readParmLimits`: a raw string with 20.0 at 107 and 1e7 at 103 gives `{ lowLimit: 20, highLimit: 10000000 }`; zero bytes give null; offsets null give both null.
- [ ] **Step 2: Run and check they fail.**
- [ ] **Step 3: Implement.** Loader in `blob-offsets.ts`'s style (zod, `CliError('CONFIG_INVALID')`, no Tanzania fallback). YAML block under the existing offsets with a comment: measured 2026-09-30 on Tanzania PARMDICT (HIVVM 10,000,000 / 20, HIVVQ 3,000,000 / 40, HIVTL 6.7 / 0). `loadCodebook` computes each `ParmEntry`'s limits from `p.Raw` with `readParmLimits`. Each caller loads the offsets once with the same country expression as its `loadBlobOffsets` call and passes them.
- [ ] **Step 4.** cli tests for these files and the whole cli suite, and the cli typecheck, redirected, `exit=0`.
- [ ] **Step 5: Commit** `feat(export): read each parameter's reporting limits`.

### Task 5: cdr: the rule and the wire

**Files:** `apps/cli/src/export/v2-transform.ts`, `apps/cli/src/export/fhir-transform.ts`, create `apps/cli/src/export/numeric-censoring.ts` + test, extend `fhir-transform.test.ts`, `fhir-conformance.test.ts`.

**Interfaces:** `censorNumeric(v: number, limits: { lowLimit: number | null; highLimit: number | null }): { value: number; comparator: '<' | '>' | null }`.

- [ ] **Step 1: Failing tests.** `censorNumeric`: `0` with low 20 gives `{ value: 20, comparator: '<' }`; `12000000` with high 1e7 gives `{ value: 10000000, comparator: '>' }`; `20` with low 20 gives `{ 20, null }`; `540` gives `{ 540, null }`; both limits null gives the value unchanged. A `toV2` test: a numeric HIVVM of 0 whose parm entry has low 20 gives `numeric_value: 20`, `result_value: '< 20'`, `raw_result.numeric_comparator: '<'`. A `toFhir` test: that result's Observation has `valueQuantity: { value: 20, comparator: '<', unit: ... }`; a plain result has no `comparator` key. Add the censored result to the conformance full-facts payload.
- [ ] **Step 2: Run and check they fail.**
- [ ] **Step 3: Implement.** In `buildLabResults`, after `numericValue` is computed for a numeric type, apply `censorNumeric` with `parm?.lowLimit ?? null` and `parm?.highLimit ?? null`; set `numeric_value`, `result_value` (`` `${comparator} ${value}` `` when censored, else unchanged) and `raw_result.numeric_comparator` (only when censored). In `observationResource`, read `r.raw_result.numeric_comparator` through a small typed accessor and add `comparator` to `valueQuantity` when present.
- [ ] **Step 4.** The new and changed test files, the whole cli suite, the cli typecheck, and `FHIR_CONFORMANCE=1` on the conformance file, redirected, `exit=0`. Existing tests that pin a plain value for a now-censored result: update them and list each in the report; anything else failing is a regression.
- [ ] **Step 5: Commit** `feat(export): send numeric results outside the reporting range with a comparator`.

### Task 6: Gates, engines, merge, live check (controller)

- [ ] **Step 1: CE gates.** `pnpm turbo run test --force --concurrency=4` and `pnpm turbo run typecheck --force`, redirected, `exit=0`. `pnpm mssql:accept` on a throwaway database and `pnpm mysql:accept`, both showing `020_lab_result_comparator` applied.
- [ ] **Step 2: cdr gates.** `pnpm turbo run test --force` and `pnpm turbo run typecheck --force`, redirected, `exit=0`.
- [ ] **Step 3 (ask first).** Merge CE to local `main`, start the dev API so 020 runs, `pnpm make:changelog`. Merge cdr to local `main`, rebuild disalab there.
- [ ] **Step 4 (ask first; writes the dev database).** Re-push the Tanzania sample (`abs(checksum([LabNo])) % 2000 = 0`) to the dev CE with the live webhook token, then compare with v1: the `< 20` HIVVM rows now present with comparator `<` and value 20; `> 10000000`, `< 40`, `< 1.00` where the sample has them; ARTCD values stay plain numbers. Update the DISA pack query (outside git) so `LIMSRptResult` shows the comparator, a space and the number, and re-import it with `--force`.
- [ ] **Step 5.** Push both repos only when asked.
