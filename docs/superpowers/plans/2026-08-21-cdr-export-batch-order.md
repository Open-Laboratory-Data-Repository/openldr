# CDR export-batch selection order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `export-batch` an `--order asc|desc` flag so a push can select the newest DISA labs instead of always the oldest.

**Architecture:** One helper in `apps/cli/src/where.ts` composes the lab-selection clause. Both the real query and the `--explain` branch call it, so they cannot drift apart. A new flag picks the direction and defaults to `asc`, which keeps every existing run identical.

**Tech Stack:** TypeScript, Node 18.19+, commander 12, `node:test` with `tsx`, MSSQL via the `disalab` workspace package.

## Global Constraints

- **The code lands in `D:\Projects\Repositories\cdr-toolchain`, not `openldr_ce`.** Only this plan and its spec live in openldr_ce.
- Default order is `asc`. No existing command line may change behaviour.
- Test runner is `node --import tsx --test`. There is no vitest, no jest, no describe blocks. Tests are flat `test("name", () => {})` from `node:test` with `assert from "node:assert/strict"`.
- Imports inside `apps/cli/src` use an explicit `.js` extension, e.g. `import { normalizeWhere } from "../where.js"`. This is an ESM package (`"type": "module"`).
- Never run the CLI through `pnpm dev -- <cmd>`. The literal `--` breaks commander and every flag is silently ignored. Use `apps/cli/node_modules/.bin/tsx apps/cli/src/index.ts`.
- Usage errors throw `new CliError("USAGE", "...")`, matching `--concurrency` and `--quarantine-severity`.
- No em dashes and no emoji anywhere in code, comments, docs, or commit messages.
- Do not add `Co-Authored-By` trailers.
- Commit after each task. Do not push and do not open a PR.

Spec: `docs/superpowers/specs/2026-08-21-cdr-export-batch-order-design.md` in openldr_ce.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/cli/src/where.ts` (modify) | Owns every WHERE-clause composition for the CLI. Gains `composeBatchSelection`. |
| `apps/cli/src/where.test.ts` (create) | Unit tests for `where.ts`. The file does not exist today. |
| `apps/cli/src/commands/export-batch.ts` (modify) | Adds `--order`, validates it, threads it into `fetchLabNumbers` and `--explain`. |
| `apps/cli/src/commands/export-batch-order.test.ts` (create) | Unit tests for the flag's validation function. |
| `scripts/push-to-ce.sh` (modify) | Adds the `ORDER` tunable. |
| `scripts/push-to-ce.ps1` (modify) | Same tunable, PowerShell. |

---

### Task 1: The clause helper

**Files:**
- Modify: `apps/cli/src/where.ts` (append at end of file)
- Test: `apps/cli/src/where.test.ts` (create)

**Interfaces:**
- Consumes: `normalizeWhere` from the same file.
- Produces: `type SelectionOrder = "asc" | "desc"` and `composeBatchSelection(userWhere: string | undefined, column: string, limit: number, offset: number, order: SelectionOrder): string`. Task 2 imports both.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/where.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBatchSelection } from "./where.js";

test("composes an ascending clause with no user WHERE", () => {
  assert.equal(
    composeBatchSelection("", "[LabNo]", 100, 0, "asc"),
    " ORDER BY [LabNo] OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY",
  );
});

test("ascending never emits the word DESC", () => {
  const clause = composeBatchSelection("", "[LabNo]", 10, 0, "asc");
  assert.ok(!/\bDESC\b/.test(clause), `unexpected DESC in ${clause}`);
});

test("descending emits DESC after the column", () => {
  assert.equal(
    composeBatchSelection("", "[LabNo]", 10, 0, "desc"),
    " ORDER BY [LabNo] DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY",
  );
});

test("keeps a bare user clause and prefixes WHERE", () => {
  assert.equal(
    composeBatchSelection("LabNo > 'TDS0125000'", "[LabNo]", 5, 0, "asc"),
    "WHERE LabNo > 'TDS0125000' ORDER BY [LabNo] OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY",
  );
});

test("does not double the WHERE keyword when the user supplied it", () => {
  assert.equal(
    composeBatchSelection("WHERE LabNo > 'TDS0125000'", "[LabNo]", 5, 0, "desc"),
    "WHERE LabNo > 'TDS0125000' ORDER BY [LabNo] DESC OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY",
  );
});

test("carries a non-zero offset", () => {
  assert.equal(
    composeBatchSelection("", "[LabNo]", 50, 200, "desc"),
    " ORDER BY [LabNo] DESC OFFSET 200 ROWS FETCH NEXT 50 ROWS ONLY",
  );
});

test("undefined user clause behaves like an empty one", () => {
  assert.equal(
    composeBatchSelection(undefined, "[LabNo]", 1, 0, "asc"),
    " ORDER BY [LabNo] OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY",
  );
});
```

Note the leading space when there is no user clause. That reproduces the string the current code already builds at `export-batch.ts:208`, where `userClause` is `""` and the template literal starts with a space. Keeping it byte-identical is what proves the refactor changed nothing.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd D:/Projects/Repositories/cdr-toolchain/apps/cli && node --import tsx --test src/where.test.ts
```

Expected: every test fails. The error names `composeBatchSelection` as not exported by `./where.js`.

- [ ] **Step 3: Write the implementation**

Append to `apps/cli/src/where.ts`:

```ts
/** Direction for a batch lab-selection scan. */
export type SelectionOrder = "asc" | "desc";

/**
 * Compose the lab-selection clause used by the batch commands: the user's
 * WHERE, then a deterministic ORDER BY, then OFFSET/FETCH paging.
 *
 * `export-batch` builds this clause twice, once for the query and once for
 * --explain. Both call this function so --explain can never describe an order
 * the query does not use.
 *
 * DISA lab numbers are chronological, so the order decides which era of data a
 * bounded run selects. Ascending is oldest first and stays the default.
 */
export function composeBatchSelection(
  userWhere: string | undefined,
  column: string,
  limit: number,
  offset: number,
  order: SelectionOrder,
): string {
  const userClause = normalizeWhere(userWhere);
  const direction = order === "desc" ? " DESC" : "";
  return `${userClause} ORDER BY ${column}${direction} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd D:/Projects/Repositories/cdr-toolchain/apps/cli && node --import tsx --test src/where.test.ts
```

Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd D:/Projects/Repositories/cdr-toolchain && git add apps/cli/src/where.ts apps/cli/src/where.test.ts && git commit -m "feat(cli): add composeBatchSelection with a selectable scan order"
```

---

### Task 2: The flag

**Files:**
- Modify: `apps/cli/src/commands/export-batch.ts`
- Test: `apps/cli/src/commands/export-batch-order.test.ts` (create)

**Interfaces:**
- Consumes: `composeBatchSelection` and `SelectionOrder` from Task 1.
- Produces: `parseSelectionOrder(raw: string | undefined): SelectionOrder`, exported from `export-batch.ts` so the test can reach it. This follows `assertCeGatesEnabled` and `requireCeTimezone`, which are already exported for exactly that reason and are tested in `export-batch-ce-guard.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/src/commands/export-batch-order.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSelectionOrder } from "./export-batch.js";

test("defaults to ascending when the flag is absent", () => {
  assert.equal(parseSelectionOrder(undefined), "asc");
});

test("accepts asc and desc", () => {
  assert.equal(parseSelectionOrder("asc"), "asc");
  assert.equal(parseSelectionOrder("desc"), "desc");
});

test("accepts either case", () => {
  assert.equal(parseSelectionOrder("DESC"), "desc");
  assert.equal(parseSelectionOrder("Asc"), "asc");
});

test("rejects anything else", () => {
  assert.throws(() => parseSelectionOrder("newest"), /--order must be asc or desc/);
  assert.throws(() => parseSelectionOrder(""), /--order must be asc or desc/);
  assert.throws(() => parseSelectionOrder("descending"), /--order must be asc or desc/);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd D:/Projects/Repositories/cdr-toolchain/apps/cli && node --import tsx --test src/commands/export-batch-order.test.ts
```

Expected: fails because `parseSelectionOrder` is not exported.

- [ ] **Step 3: Add the parser**

In `apps/cli/src/commands/export-batch.ts`, add to the imports near the top:

```ts
import { composeBatchSelection, type SelectionOrder } from "../where.js";
```

Then add this function beside the other exported guards, next to `assertCeGatesEnabled`:

```ts
/** Validate --order. Exported so the guard can be unit-tested without a database. */
export function parseSelectionOrder(raw: string | undefined): SelectionOrder {
  if (raw === undefined) return "asc";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  throw new CliError("USAGE", `--order must be asc or desc (got ${JSON.stringify(raw)}).`);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
cd D:/Projects/Repositories/cdr-toolchain/apps/cli && node --import tsx --test src/commands/export-batch-order.test.ts
```

Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Add the option to the type**

In the `ExportBatchOpts` interface, directly under `offset?: string;`:

```ts
  order?: string;
```

- [ ] **Step 6: Register the flag**

In `registerExportBatchCommand`, immediately after the `--offset` option:

```ts
    .option(
      "--order <asc|desc>",
      "Direction of the lab scan. DISA lab numbers are chronological, so asc (the default) selects the oldest labs and desc selects the newest. Under desc, --offset skips from the newest end.",
      "asc",
    )
```

- [ ] **Step 7: Replace the query composition**

In `fetchLabNumbers`, change the signature and body. It currently reads:

```ts
async function fetchLabNumbers(
  where: string,
  limit: number,
  offset: number,
  connectionString: string,
): Promise<string[]> {
  const trimmed = where.trim().replace(/^WHERE\s+/i, "");
  const userClause = trimmed.length > 0 ? `WHERE ${trimmed}` : "";
  const composedWhere = `${userClause} ORDER BY [LabNo] OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
```

Replace those three body lines and add the parameter:

```ts
async function fetchLabNumbers(
  where: string,
  limit: number,
  offset: number,
  order: SelectionOrder,
  connectionString: string,
): Promise<string[]> {
  const composedWhere = composeBatchSelection(where, "[LabNo]", limit, offset, order);
```

The rest of the function is unchanged.

- [ ] **Step 8: Thread the value through the action**

In the `.action(...)` handler, beside the existing `offset` line:

```ts
      const order = parseSelectionOrder(opts.order);
```

Then update the call site, which currently reads
`const labIds = await fetchLabNumbers(where, limit, offset, config.connectionString);`:

```ts
      const labIds = await fetchLabNumbers(where, limit, offset, order, config.connectionString);
```

- [ ] **Step 9: Make --explain use the same helper**

The `--explain` branch currently rebuilds the clause from its own literal. Replace those lines:

```ts
      if (opts.explain === true) {
        const trimmed = where.trim().replace(/^WHERE\s+/i, "");
        const userClause = trimmed.length > 0 ? `WHERE ${trimmed}` : "";
        process.stdout.write(JSON.stringify({
          operation: "export-batch",
          lab_selection: {
            method: "REGDAT4.LabNumbers",
            where: `${userClause} ORDER BY [LabNo] OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
          },
```

with:

```ts
      if (opts.explain === true) {
        process.stdout.write(JSON.stringify({
          operation: "export-batch",
          lab_selection: {
            method: "REGDAT4.LabNumbers",
            order,
            where: composeBatchSelection(where, "[LabNo]", limit, offset, order),
          },
```

The `trimmed` and `userClause` locals are now unused in that branch. Delete them, or `typecheck` will flag them.

- [ ] **Step 10: Typecheck and run the whole CLI suite**

```bash
cd D:/Projects/Repositories/cdr-toolchain/apps/cli && pnpm typecheck && pnpm test
```

Expected: typecheck clean, and no test that passed before now fails. If `export-batch.ce.test.ts` asserts on `--explain` output, its expectation may need the new `order` key. Read the failure before changing anything.

- [ ] **Step 11: Commit**

```bash
cd D:/Projects/Repositories/cdr-toolchain && git add apps/cli/src/commands/export-batch.ts apps/cli/src/commands/export-batch-order.test.ts && git commit -m "feat(cli): add --order to export-batch so a push can start from the newest labs"
```

---

### Task 3: The push scripts

**Files:**
- Modify: `scripts/push-to-ce.sh`
- Modify: `scripts/push-to-ce.ps1`

**Interfaces:**
- Consumes: the `--order` flag from Task 2.
- Produces: an `ORDER` environment tunable for both scripts.

There is no test for this. Both scripts are shell wrappers with no harness in the repo. Task 4 exercises them live, which is the only real proof either way. Say so rather than implying coverage.

- [ ] **Step 1: Add the bash tunable**

In `scripts/push-to-ce.sh`, in the tunables block beside `LIMIT` and `CONCURRENCY`:

```bash
ORDER="${ORDER:-asc}"            # asc = oldest labs first (default), desc = newest first
```

- [ ] **Step 2: Pass it in bash**

Add `--order "$ORDER"` to the `common` array, after `--concurrency "$CONCURRENCY"`:

```bash
common=(export-batch
  --limit "$LIMIT"
  --concurrency "$CONCURRENCY"
  --order "$ORDER"
  --country "$OPENLDR_COUNTRY"
  --ce-url "$OPENLDR_CE_URL"
  --ce-tz "$OPENLDR_CE_TIMEZONE")
```

And to the `smoke` array, so a smoke run previews the same labs a real run would take:

```bash
    smoke=(export-batch --limit 10 --concurrency 1
      --order "$ORDER"
      --country "$OPENLDR_COUNTRY"
      --ce-url "$OPENLDR_CE_URL" --ce-tz "$OPENLDR_CE_TIMEZONE"
      --dry-run)
```

- [ ] **Step 3: Add the PowerShell tunable**

In `scripts/push-to-ce.ps1`, beside the other `$env:` reads near line 13:

```powershell
$Order       = if ($env:ORDER)       { $env:ORDER }       else { 'asc' }
```

- [ ] **Step 4: Pass it in PowerShell**

In the `$args` string, and again in the `$s` smoke string:

```powershell
$args = "export-batch --limit $Limit --concurrency $Concurrency --order $Order " +
        "--country $($env:OPENLDR_COUNTRY) --ce-url $($env:OPENLDR_CE_URL) --ce-tz $($env:OPENLDR_CE_TIMEZONE)"
```

```powershell
    $s = "export-batch --limit 10 --concurrency 1 --order $Order --country $($env:OPENLDR_COUNTRY) " +
         "--ce-url $($env:OPENLDR_CE_URL) --ce-tz $($env:OPENLDR_CE_TIMEZONE) --dry-run"
```

- [ ] **Step 5: Confirm the default is still ascending**

```bash
cd D:/Projects/Repositories/cdr-toolchain && MSYS2_ENV_CONV_EXCL='*' ./scripts/push-to-ce.sh verify
```

Expected: the JSON `lab_selection.where` contains `ORDER BY [LabNo] OFFSET`, with no `DESC`, and `lab_selection.order` is `"asc"`.

`MSYS2_ENV_CONV_EXCL='*'` is required under Git Bash. Without it MSYS rewrites `OPENLDR_CE_HOOK_PATH` into `C:/Program Files/Git/api/workflows/hooks/ingest` and the run 404s. This bites env vars, not just arguments.

- [ ] **Step 6: Commit**

```bash
cd D:/Projects/Repositories/cdr-toolchain && git add scripts/push-to-ce.sh scripts/push-to-ce.ps1 && git commit -m "feat(scripts): add an ORDER tunable to the CE push scripts"
```

---

### Task 4: Prove it against a real database

**Files:** none. This task changes nothing and produces evidence.

Everything before this is unit level. No test so far has asked SQL Server whether it accepts the composed clause, and none can. This task is the only thing that does.

- [ ] **Step 1: Confirm the flag reaches the clause**

```bash
cd D:/Projects/Repositories/cdr-toolchain && MSYS2_ENV_CONV_EXCL='*' ORDER=desc ./scripts/push-to-ce.sh verify
```

Expected: `lab_selection.where` contains `ORDER BY [LabNo] DESC OFFSET 0 ROWS`, and `lab_selection.order` is `"desc"`. This opens no database connection.

- [ ] **Step 2: Run a real descending push against dev CE**

```bash
cd D:/Projects/Repositories/cdr-toolchain && MSYS2_ENV_CONV_EXCL='*' ORDER=desc LIMIT=20 CONCURRENCY=2 OUTDIR=./temp/ce-push-desc ./scripts/push-to-ce.sh run
```

Expected: it exits non-zero with `API_REJECTED`. That is normal. The script uses `set -e`, and the CLI exits non-zero whenever any lab fails, which kills the script's own trailing summary block. Read the files instead.

- [ ] **Step 3: Confirm the labs really were the newest**

```bash
cd D:/Projects/Repositories/cdr-toolchain && grep -o '"lab_number":"[^"]*"' temp/ce-push-desc/journal.ndjson | sed 's/.*://;s/"//g' | sort | tail -3
```

Expected: lab numbers at the top of the range, near `TDS0139520`. An ascending run would have returned numbers near `TDS0010001`, so this distinguishes the two unambiguously.

- [ ] **Step 4: Expect most of them to be rejected, and confirm why**

```bash
cd D:/Projects/Repositories/cdr-toolchain && grep -o '"reason":"[^"]*"' temp/ce-push-desc/journal.ndjson | sort | uniq -c
```

Expected: mostly `OpenLDR v1 has no Requests row for this lab`. The newest block, TDS013, has only 1,746 of 9,516 labs in the laptop's v1 mirror. Around 8 of 10 labs failing here is the flag working correctly against a thin mirror, not the flag being broken. Do not treat a low posted count as a defect.

- [ ] **Step 5: Run the full CLI suite once more**

```bash
cd D:/Projects/Repositories/cdr-toolchain/apps/cli && pnpm test
```

Expected: no failures.

- [ ] **Step 6: Record the outcome**

Append a short section to the spec at
`D:/Projects/Repositories/openldr_ce/docs/superpowers/specs/2026-08-21-cdr-export-batch-order-design.md`
giving the observed posted and check_failed counts from Step 2 and the lab range from Step 3. Commit it in the openldr_ce repo.

---

## One deliberate change from the spec

The spec asked for a test asserting that `--explain` output contains `ORDER BY [LabNo] DESC`.
Reaching `--explain` from a test means spawning the CLI as a subprocess, because the branch sits
inside a commander action that first calls `loadRuntime`. That test would depend on a `.env` file
and would fail in a clean checkout for reasons unrelated to the flag.

This plan tests `parseSelectionOrder` as a unit instead, and moves the `--explain` proof to the
live check in Task 4 Step 1. The structural guarantee still holds: `--explain` and the query call
the same function, so they cannot disagree. What is lost is an automated regression guard on the
`--explain` payload shape. If that matters later, a subprocess test with a fixture `.env` is the
way to add it.

## What this plan does not do

`audit.ts:116`, `compare-batch.ts:223`, and `buildRequestIdsSql` in `openldr.ts` still hardcode ascending order. `composeBatchSelection` now exists, so each is a small change, but they are out of scope and must stay untouched.

No in-app or web documentation changes. `export-batch` is a developer tool in a separate repository and has no page in the OpenLDR CE docs, so the five-place definition of done in `AGENTS.md` section 6 does not apply here. Confirm that before assuming it, and say so if a doc page does turn out to reference the flag list.
