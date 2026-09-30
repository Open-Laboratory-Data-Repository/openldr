# Custom Query Export and Import, and the DISA VL Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any CE install export and import custom queries as a file, and build Mozambique's two VL queries as a DISA pack that lives outside git.

**Architecture:** One `@openldr/bootstrap` module holds the file format, export and import; the Fastify routes and the `openldr query` CLI both call it. The `/query` explorer gains a `⋯` menu with two Sheets. The DISA pack is files in `packs/disa/`, whose contents git and Docker ignore; it is built and checked by the controller after the core merges.

**Tech Stack:** TypeScript, zod, Fastify, commander, React + shadcn/Radix, vitest, pg-mem; SQL Server (read-only) for the pack build.

**Spec:** `docs/superpowers/specs/2026-09-30-custom-query-export-import-design.md`

## Global Constraints

- File format, exactly: `{ "format": "openldr.custom-queries", "version": 1, "exportedAt": "<ISO>", "queries": [ { "name", "sql", "params" } ] }`. No `id`, no `connectorId`. `params` is `CustomQueryParam[]` (`packages/dashboards/src/custom-query.ts`).
- Import: name is the key. New name: create. Existing name: skip and report, unless `replace` is true, which overwrites `sql` and `params` and KEEPS the existing id and connector. Each query passes `CustomQueryInputSchema` and `validateSelectSql` before ANY write; one bad query writes nothing. Unknown `format` or `version` above 1 is refused. Result per query: `created`, `replaced` or `skipped`.
- Connector for created queries: `connectorName` when given, else the connector named `Target Warehouse (Postgres)`. No such connector is an error, and nothing is written.
- Export: by ids (routes) or names (CLI); none given means all. Output sorted by name.
- Writes go through the custom-query store built WITH `referenceCapture` (`createCustomQueryStore(internalDb, referenceCapture)`, as `apps/server/src/app.ts:183` does), so sync capture works. The CLI must build the store the same way; `ctx.customQueries` (`packages/bootstrap/src/index.ts:729`) has no capture and must not be used for writes.
- Audit: `customQuery.create` / `customQuery.update` per written query, entity `customQuery`; the CLI actor is `cliActor()`.
- Capability: the existing `query.run` guard.
- UI (AGENTS.md section 5): actions only in `⋯` DropdownMenus; Sheets, not dialogs; form grid label-left; shadcn only; `TablePagination` on the preview table; `StripedEmpty` / `LoadingState` rules.
- i18n: every new key in en, fr and pt.
- No country or system content in the repo. DISA content lives only under `packs/disa/`, which is git-ignored.
- New writing: no em dashes, no emoji, short sentences. Never a `Co-Authored-By` trailer.
- Work in `D:/Projects/Repositories/openldr_ce/.claude/worktrees/custom-query-transfer`, branch `spec/custom-query-transfer`. Prefix every command with `cd` to it; check `git branch --show-current` before committing; stage by exact path.
- Tests: `pnpm --filter <pkg> exec vitest run <path>`. Never the whole studio suite (it hangs). Typecheck redirected, then `echo "exit=$?"`.

---

### Task 1: The packs folder and the warehouse column rule

**Files:**
- Create: `packs/README.md`
- Modify: `.gitignore`, `.dockerignore`, `AGENTS.md`

- [ ] **Step 1: `packs/README.md`**

```markdown
# packs

Content written for one lab system or one country lives here, never in the repo.
A pack is a folder of files that an operator imports into a CE install:
custom queries (`openldr query import`), value sets (`openldr terminology import resource`)
and facility registers (`openldr facilities import`).

Only this README is tracked. Everything else under `packs/` is ignored by git and Docker,
so a pack can hold one system's codes and dictionary extracts without them entering the repo.

One subfolder per system, for example `packs/disa/` for the DISA ecosystem of apps.
Each pack has its own README with its import order and what it cannot provide.
```

- [ ] **Step 2: ignore rules**

Append to `.gitignore`:

```
# System and country content packs: only the README is tracked (see packs/README.md).
packs/*
!packs/README.md
```

Append to `.dockerignore`:

```
packs
```

Check: `git check-ignore -v packs/disa/x.json` prints the `packs/*` rule; `git check-ignore packs/README.md` prints nothing (exit 1).

- [ ] **Step 3: the AGENTS.md rule**

Under section 8 ("Never hardcode clinical vocabulary"), after its last paragraph, add:

```markdown
**One shared warehouse model. No country or system columns.** A typed warehouse column is only
for a fact any lab system can fill that has a standard slot (a FHIR element, or an HL7 v2 OBR,
OBX, ORC, PID or SPM field). A fact from one system or country is a row in
`lab_request_attributes`, keyed by a code in `urn:openldr:cs:request-attribute`. Queries, value
sets and registers written for one system (for example DISA) are content: they ship as export
files kept in `packs/`, never in the repo. One exception: `lab_requests.age_years` and `age_days`
stay typed, because the source's stored age is more reliable than one worked out from the date of
birth. The operator decided this on 2026-09-30.
```

- [ ] **Step 4: Commit**

```bash
git add packs/README.md .gitignore .dockerignore AGENTS.md
git commit -m "docs: a packs folder for system content, and the warehouse column rule"
```

---

### Task 2: Export and import in `@openldr/bootstrap`

**Files:**
- Create: `packages/bootstrap/src/custom-query-transfer.ts`
- Create: `packages/bootstrap/src/custom-query-transfer.test.ts`
- Modify: `packages/bootstrap/src/seed.ts` (export the connector name constant)
- Modify: `packages/bootstrap/src/index.ts` (re-export)

**Interfaces:**
- Produces:

```ts
export const CUSTOM_QUERY_FILE_FORMAT = 'openldr.custom-queries';
export interface CustomQueryFile { format: typeof CUSTOM_QUERY_FILE_FORMAT; version: 1; exportedAt: string;
  queries: { name: string; sql: string; params: CustomQueryParam[] }[] }
export type ImportOutcome = 'created' | 'replaced' | 'skipped';
export interface ImportResult { results: { name: string; outcome: ImportOutcome; id: string }[] }
export interface TransferDeps {
  customQueries: CustomQueryStore;
  connectors: { list(): Promise<{ id: string; name: string }[]> };
  newId?: () => string;
  now?: () => Date;
}
export async function exportCustomQueries(deps: TransferDeps, select?: { ids?: string[]; names?: string[] }): Promise<CustomQueryFile>;
export async function importCustomQueries(deps: TransferDeps, file: unknown, opts: { connectorName?: string; replace: boolean }): Promise<ImportResult>;
export class CustomQueryTransferError extends Error {}
```

`CustomQueryStore` and `CustomQueryParam` come from `@openldr/db`. Import writes nothing when it throws.

- [ ] **Step 1: Write the failing tests**

Create `custom-query-transfer.test.ts` with an in-memory fake that implements `CustomQueryStore` (create, get, getByName, list, update, remove over a `Map`). Cases:

```ts
import { describe, it, expect } from 'vitest';
import { exportCustomQueries, importCustomQueries, CustomQueryTransferError, CUSTOM_QUERY_FILE_FORMAT } from './custom-query-transfer';

// fakeStore(): CustomQueryStore backed by a Map; fakeConnectors(names): { list }
const file = (queries: unknown[]) => ({ format: CUSTOM_QUERY_FILE_FORMAT, version: 1, exportedAt: '2026-09-30T00:00:00Z', queries });
const q = (name: string, sql = 'select 1') => ({ name, sql, params: [] });

describe('exportCustomQueries', () => {
  it('writes every query sorted by name, with no id and no connector', async () => { /* seed "b", "a"; expect queries [a, b], no id/connectorId keys */ });
  it('exports only the selected ids, or names', async () => { /* ... */ });
});

describe('importCustomQueries', () => {
  it('creates new queries on the default warehouse connector', async () => { /* connectors [{id:'c1',name:'Target Warehouse (Postgres)'}]; expect created, connectorId c1 */ });
  it('skips an existing name unless replace is set', async () => { /* skipped; then replace:true -> replaced, same id, same connectorId, new sql */ });
  it('uses the named connector when given, and refuses an unknown one', async () => { /* ... CustomQueryTransferError, nothing written */ });
  it('refuses the whole file when one query is not a SELECT, writing nothing', async () => { /* [q('a'), q('b','delete from x')] -> throws naming "b"; store empty */ });
  it('refuses an unknown format or a newer version', async () => { /* ... */ });
  it('round-trips: export then import into an empty store gives the same queries', async () => { /* ... */ });
});
```

Write every body in full. The error for a bad query must include the query's name.

- [ ] **Step 2: Run and check they fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/custom-query-transfer.test.ts`. Expected: FAIL (no module).

- [ ] **Step 3: Implement**

In `seed.ts`, change `const DEFAULT_CONNECTOR_NAME` to `export const DEFAULT_CONNECTOR_NAME` (no other change).

`custom-query-transfer.ts`:
- A zod schema for the file: `format` literal, `version` literal `1`, `exportedAt` string, `queries` array of `{ name: string().min(1), sql: string().min(1), params: CustomQueryParamSchema array }` (import the param schema from `@openldr/dashboards`, where `CustomQuerySchema` lives, `packages/dashboards/src/custom-query.ts`). A version other than 1 or another format throws `CustomQueryTransferError` with a plain message.
- Validate everything first: parse the file, then for each query run `CustomQueryInputSchema.safeParse({ name, sql, params, connectorId: '<resolved>' })` and `validateSelectSql(sql)` (from `@openldr/dashboards`); collect the first failure and throw `CustomQueryTransferError(`query "${name}": ${reason}`)`. Duplicate names inside one file are also a failure.
- Resolve the connector once (only needed when at least one query will be created): `opts.connectorName ?? DEFAULT_CONNECTOR_NAME`, matched by exact name in `deps.connectors.list()`.
- Then write: for each query, `getByName`; absent: `create({ id: newId(), name, connectorId, sql, params })` -> `created`; present and `replace`: `update(id, { sql, params })` -> `replaced`; present and not `replace`: `skipped`.
- `newId` default: `` `cq_${randomUUID().slice(0, 8)}` `` (the create route's form, `apps/server/src/query-routes.ts:45`).
- Export: `list()`, filter by ids or names when given, sort by name with `localeCompare`, map to `{ name, sql, params }`.

In `index.ts`, add `export * from './custom-query-transfer';` beside the other feature exports.

- [ ] **Step 4: Run tests and typecheck**, redirected, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/custom-query-transfer.ts packages/bootstrap/src/custom-query-transfer.test.ts packages/bootstrap/src/seed.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): export and import custom queries as a file"
```

---

### Task 3: The routes

**Files:**
- Modify: `apps/server/src/query-routes.ts`
- Modify: `apps/server/src/query-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 `exportCustomQueries`, `importCustomQueries`, `CustomQueryTransferError`.
- Produces: `POST /api/custom-queries/export` body `{ ids?: string[] }` -> `CustomQueryFile`; `POST /api/custom-queries/import` body `{ file: unknown, connectorName?: string, replace?: boolean }` -> `ImportResult`, or 400 `{ error }` on `CustomQueryTransferError`.

- [ ] **Step 1: Write the failing route tests**

Follow the existing setup in `query-routes.test.ts`. Cases: export returns the file shape with sorted queries; import creates and reports `created`; a second import reports `skipped`; `replace: true` reports `replaced`; a non-SELECT query returns 400 with the query name in `error` and writes nothing; a request without `query.run` is refused the same way the other routes are; each written query records one audit event (`customQuery.create` or `customQuery.update`).

- [ ] **Step 2: Run and check they fail.**

- [ ] **Step 3: Implement**

Register the two routes next to the other custom-query routes, with `GUARD`. Call the Task 2 functions with `{ customQueries: deps.customQueries, connectors: deps.connectors }` (the route deps already carry both; `deps.connectors.list()` returns `{ id, name }`). On success of import, record one audit per written query with `recordAudit(ctx, req, { action, entityType: 'customQuery', entityId: id, before, after })`: fetch `before` with `get(id)` for replaced queries before the import runs, or record `before: null` for created ones. Map `CustomQueryTransferError` to 400; rethrow anything else. Every `reply.send` path must be `return`ed (apps/server lint rule).

- [ ] **Step 4: Run tests, lint and typecheck**

`pnpm --filter @openldr/server exec vitest run src/query-routes.test.ts`, `pnpm --filter @openldr/server lint`, server typecheck, each redirected, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/query-routes.ts apps/server/src/query-routes.test.ts
git commit -m "feat(server): routes to export and import custom queries"
```

---

### Task 4: The CLI

**Files:**
- Create: `packages/cli/src/query.ts`
- Create: `packages/cli/src/query.test.ts`
- Create: `packages/cli/src/query-cli-parsing.test.ts`
- Modify: `packages/cli/src/program.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `runQueryExport(opts: { name?: string[]; out: string; json: boolean }): Promise<number>` and `runQueryImport(file: string, opts: { connector?: string; force: boolean; json: boolean }): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

`query-cli-parsing.test.ts`: copy the shape of `facilities-list-cli-parsing.test.ts` (mock `./query`, fresh `buildProgram()` per test). Assert commander delivers: `query export --out f.json` -> `{ out: 'f.json' }`; `query export --name A --name B --out f.json` -> `name: ['A','B']`; `query import f.json --connector "X Y" --force` -> file `f.json`, `connector: 'X Y'`, `force: true`; `force` defaults to false.

`query.test.ts`: unit-test `runQueryImport` and `runQueryExport` with `createAppContext` mocked the way `facilities.test.ts` mocks it. Import without `--force` over an existing name prints the skip and exits 0; a bad file exits 1 and prints the query name; `--json` prints the `ImportResult`; audit is recorded with the CLI actor for each written query.

- [ ] **Step 2: Run and check they fail.**

- [ ] **Step 3: Implement**

`query.ts`, in the shape of `runFacilitiesLinkMatching` (`packages/cli/src/facilities.ts:1496`): `createAppContext(loadConfig())`; build the store as `createCustomQueryStore(ctx.internalDb, referenceCapture)` (both from `@openldr/db`); connectors from `ctx.connectors`. Export writes the JSON (2-space indent, trailing newline) to `--out`. Import reads the file, parses JSON (a parse error exits 1 with a plain message), calls `importCustomQueries`, then records audit per written query with `recordAuditEvent(ctx, cliActor(), ...)`. Human output: one line per query, `created|replaced|skipped  <name>`, then a count line. Errors go through `redactError`. Always `ctx.close()`.

In `program.ts`, add a `query` command group with `export` (`--name <name...>`, `--out <file>` required, `--json`) and `import <file>` (`--connector <name>`, `--force` "replace queries that already exist", `--json`). Descriptions in plain words, noting that `--force` overwrites.

- [ ] **Step 4: Run tests and typecheck**, redirected, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/query.ts packages/cli/src/query.test.ts packages/cli/src/query-cli-parsing.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): openldr query export and import"
```

---

### Task 5: The `/query` UI

**Files:**
- Modify: `apps/studio/src/query/api.ts` (two calls)
- Modify: `apps/studio/src/query/QueryPage.tsx` (explorer header `⋯`)
- Create: `apps/studio/src/query/transfer/ExportQueriesSheet.tsx`, `ImportQueriesSheet.tsx`, and a test for each
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: Task 3 routes.
- Produces: `queryApi.exportQueries(ids?: string[])` -> file object; `queryApi.importQueries(body)` -> `ImportResult` (throws with the server's `error` on 400).

- [ ] **Step 1: Write the failing tests**

Two test files beside the sheets, using the existing studio test setup (mock `queryApi`). Export: the checklist lists saved queries; the `⋯` Download is disabled with nothing checked; choosing Download calls `exportQueries` with the checked ids and triggers a download named `openldr-queries-<yyyy-mm-dd>.json`. Import: after a file is chosen, the preview marks each query `new`, `exists (skip)` or `exists (replace)` from the saved-query list; turning the replace switch changes `skip` to `replace`; the `⋯` Import calls `importQueries` with `{ file, connectorName, replace }`; a 400 shows the error message; success shows a toast with the counts and refreshes the saved-query list (bump `savedRevision` in the query store, as `ExplorerTree.tsx:31` reads it).

- [ ] **Step 2: Run them and check they fail**

Run only these two files: `pnpm --filter @openldr/studio exec vitest run src/query/transfer`.

- [ ] **Step 3: Implement**

- `QueryPage.tsx`: in the explorer header (`:76-84`), put a `MoreHorizontal` `DropdownMenu` beside the collapse button with "Export queries" and "Import queries". Copy the header menu from `pages/settings/Connectors.tsx`.
- `ExportQueriesSheet`: a checklist of saved queries (shadcn `Checkbox`), with a select-all; the sheet header `⋯` has Download. Download uses the blob pattern of `downloadReportCsv` (`apps/studio/src/api.ts:218-231`) on a JSON blob.
- `ImportQueriesSheet`: a hidden file input opened from the sheet (copy `pages/Forms.tsx:285`, `accept="application/json,.json"`); parse client-side only to build the preview (the server re-validates). Form grid (`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`): connector picker (shadcn `Select` over `queryApi.connectors()`, default the one named `Target Warehouse (Postgres)`) and the replace `Switch`. Preview `Table` with name and status columns and `TablePagination`; render the table only when rows exist, else `StripedEmpty`; `LoadingState` while importing. The sheet header `⋯` has Import, disabled until a valid file is loaded.
- i18n keys under `query.transfer.*` in all three files; the `parity.test.ts` must stay green.
- Mobile: both sheets use the existing Sheet widths; no horizontal scroll at 375 px (checked in Task 7).

- [ ] **Step 4: Run the tests and typecheck**

`pnpm --filter @openldr/studio exec vitest run src/query/transfer src/i18n`, and the studio typecheck, redirected, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/query apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(studio): export and import custom queries from the query page"
```

---

### Task 6: Docs

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/query.md`
- Create: `apps/web/src/docs/0.1.8/query-export-import.md`
- Modify: `apps/web/src/docs/content.ts` (title entry, next to `'query-naming'`)

- [ ] **Step 1: Write the docs**

One section, "Export and import queries", in each studio page, and the same content as a web page:
- What the file holds (name, SQL, parameters) and what it leaves out (the id and the connector).
- Import rules: new names are created; existing names are skipped unless you choose to replace them; replace keeps the query's id, so reports that use it keep working; one bad query stops the whole file.
- Connector: new queries use `Target Warehouse (Postgres)` unless you pick another.
- CLI: `openldr query export --out queries.json [--name <name>...]` and `openldr query import queries.json [--connector <name>] [--force]`, noting that `--force` overwrites.
- One line: content written for one lab system is shared as these files, kept in the operator's `packs/` folder, not in CE itself.

fr and pt use each file's existing vocabulary; commands unchanged. No em dashes.

- [ ] **Step 2: Run the docs tests**

`pnpm --filter @openldr/studio exec vitest run src/docs` and the web docs test if one exists (`apps/web/src/docs/DocsPage.test.tsx`), redirected, `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/src/docs/0.1.8 apps/web/src/docs/0.1.8/query-export-import.md apps/web/src/docs/content.ts
git commit -m "docs: export and import custom queries"
```

---

### Task 7: Gates, live check, merge (controller)

- [ ] **Step 1: Gates.** `pnpm turbo run test --force --concurrency=4` and `pnpm turbo run typecheck --force`, each redirected, each `exit=0`. `pnpm --filter @openldr/server lint`, `exit=0`.
- [ ] **Step 2: Live check (ask the operator first; it writes the dev database).** Start the dev API and studio. Export two seeded queries, delete nothing, import the file back (all `skipped`), import with replace (all `replaced`, same ids), import a file with a renamed copy (`created`). Check both sheets at 375x812. Repeat the import with the CLI. Remove the created copy afterwards.
- [ ] **Step 3: Merge (ask first).** `--no-ff` to local `main`, then `pnpm make:changelog`, commit the changelog. Push only when asked.

---

### Task 8: The DISA VL pack (controller, after the merge; outside git)

Built in the main checkout's `packs/disa/` only after Task 1 is on `main`, so the ignore rule is live there. Nothing in this task is committed. Check `git status --short` in the main checkout shows nothing new afterwards.

- [ ] **Step 1: The lab register and value sets.** `packs/disa/build.mjs` reads `OpenLDRDict_MZ` on the `sqlserver` container (read-only) and writes:
  - `moz-laboratories-register.csv`: `Laboratories` (code `LabCode`, name `LabName`) plus `DisaPoc` (code = first 3 characters of `DisaPocLabNo`, name `DisaPocName`, region `DisaPocProvinceName`, district `DisapocDistrictName`), in the column shape the facility import expects (see `docs` for `openldr facilities import`; map province to `region`, as slice A did).
  - `disa-poc.valueset.json` and `disa-link.valueset.json`: a CodeSystem plus ValueSet pair each, URLs `urn:openldr:disa:poc-sites` and `urn:openldr:disa:link-sites`, codes `DisaPocCode` and `DlinkCode`, display the names.
- [ ] **Step 2: The queries.** `packs/disa/disa-vl-queries.json` in the Task 2 format, "DISA VL info" and "DISA VL results", per spec section 7.2. Before writing SQL, confirm each join against the code: `lab_results.request_id` = `lab_requests.id`; the requester's `facility_map` key as the observed-facility scan builds it for requesters (`packages/db/src/facility-observed.ts`); the testing lab through `diagnostic_reports.performer` (`packages/reporting/src/seed/report-seeds.ts:229` shows the join); value sets by `value_set_url`, never the id. Every v1 column appears in v1 order; a column with no CE source is `NULL AS "<v1 name>"`.
- [ ] **Step 3: `packs/disa/README.md`.** Import order (register, value sets, then queries); every NULL column and why; the three missing functions and the request to Mozambique for their scripts; HONEST NON-PROOF list.
- [ ] **Step 4: Check (ask first; it writes the dev database).** Import the pack into the dev CE; run both queries with a wide date range; they must run without error and return zero rows. Then a test copy (kept in the scratch folder, never in the pack) with Tanzania's codes: panel `HIVVL`, observations `HIVVM`, `HIVVC`, `HIVTL` in the result slots; run it on the dev CE over the Tanzania labs pushed on 2026-09-30 and compare row by row with the same shape queried from Tanzania v1 `OpenLDRData` (`RequestID = 'TZDISA' + LabNo`). The info query's Tanzania equivalent (`VLID`) is routed to forms by `config/tanzania.yaml`, so only its request-level columns can be compared: say so.
