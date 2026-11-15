# A stricter SELECT check and three copy follow-ups: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQL that is not a plain read is refused on every path that runs checked SQL, a write that still gets through on SQL Server is rolled back, and three small follow-ups to the v1 copy land with it.

**Architecture:** One new reader of SQL text blanks strings, comments and quoted names in a single pass; `validateSelectSql` reads its output and gains a SQL Server rule. Token filling in three places refuses a token that does not sit in plain SQL. `ConnectorDb` gains a read-only way to run a statement, and `runReadQuery` rolls back on SQL Server.

**Tech Stack:** TypeScript, Kysely 0.28 (SQL Server side), `pg`, `mysql2`, vitest with pg-mem, Preact for the plugin page, Rust wasm plugin unchanged.

**Spec:** `docs/superpowers/specs/2026-11-15-select-check-and-copy-follow-ups-design.md`. The spec is the authority. Read all of it.

## Global Constraints

- **No query that works today is refused**, except one that was never a plain read. `packages/bootstrap/src/seed-queries-select-gate.test.ts` must stay green in all three dialects, with the dialect now passed to the check.
- **Every refusal is a fixed sentence.** No SQL text, no key, no parameter value and no row value in any error message, log line or audit row this plan writes.
- **No new npm dependency and no new Rust crate.**
- **MySQL gets no transaction** (operator, 2026-11-15). It gets the reader and the token rule only.
- **The import page reader is not changed.** `ConnectorDb.query` keeps its behaviour to the letter. The read-only method is a new method beside it.
- **Wherever engines differ on what is a string or a comment, the reader treats the text as code.** Text that is checked and refused is the safe mistake. Text that is blanked and then run is the unsafe one.
- **Safety on this machine.** A dev stack is in use: a server on port 3000, Postgres on 5433, Keycloak on 8180. Never stop or change it. Never send any request to port 3000. Never point anything at the databases `openldr`, `openldr_target`, `openldr_docs`, `openldr_docs_target` or `keycloak`. Anything started from the worktree gets `OPENLDR_SKIP_ENV_FILE=true` and its own database URLs. Every `openldr` CLI call carries `--server-url http://127.0.0.1:<scratch port>` and `OPENLDR_URL` set to the same, with a harmless proof call first. Scratch ports are 3990 to 3995 and 3997. Port 3996 belongs to another session. Scratch databases are named `sa_scratch_*`. Remove everything you start and list it.
- **The containers `openldr-mssql` (port 1433) and `openldr-docs-system-mssql` (port 15445) are never used by this plan, not even to read.** This plan tries writes on purpose. They happen only on a container the task itself starts from `mcr.microsoft.com/mssql/server:2025-latest`, which is already on the machine. No image download.
- **House rules:** `AGENTS.md` and `CLAUDE.md`. Short sentences, no em dashes, the `unslop` skill over all prose. shadcn rules do not apply inside the plugin page, which has its own small component set; copy its existing dots menu.
- **Git:** work in a worktree on its own branch. Stage files by name. No `Co-Authored-By` line. Implementers and reviewers do not push.
- **Gate:** `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`, output redirected to files, never piped through `tail`. `pnpm depcruise` must stay at 21 violations.

## Review Focus

1. A working query that holds a refused word where it is not a statement: `[open]`, `open_date`, `##open`, `@set`, `'please exec this'`, `-- exec later`, `OPTION (USE HINT('...'))`, `OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`, `CASE ... END`. Each must pass on `mssql`. Tests in Task 3.
2. A comment marker inside a string, a quote inside a comment, a bracket inside a string, an unterminated string or comment. The reader must not lose its place; an unterminated one is refused. Tests in Task 2.
3. A query that makes SQL Server end the transaction by itself (a conversion error). The person sees their own error, not error 3903 from the failed roll-back. Test in Task 5.
4. A slow query cancelled by the deadline while inside the transaction, on the shared reporting pool. The next query on that pool works and finds no open transaction. Test in Task 5.
5. A dashboard viewer's filter value that holds a quote, `--` or `/*`. It stays one literal. A template with the token inside quotes is refused with a sentence that says how to fix it. Tests in Task 4.

---

### Task 1: Try the holes on a real SQL Server before building

This task changes no product code. It decides whether Tasks 3 and 5 are needed as written.

**Files:**
- Create: `docs/superpowers/specs/2026-11-15-select-check-real-run.md` (the record)

- [ ] **Step 1: Start a scratch SQL Server.** A container of your own from the 2025 image, on a scratch port, with a database `sa_scratch_sel` holding one table `dbo.proof (i int)` with one row.
- [ ] **Step 2: Try H1 and H2 through the real runner.** Write a throwaway script outside the repo that imports `createConnectorSqlRunner` from the built `@openldr/bootstrap` and points it at the scratch server with a fake `connectors` object. Send:
  - `SELECT 1 AS x EXEC('insert into dbo.proof values (2)')`
  - `SELECT '--' AS x; DELETE FROM dbo.proof`
  After each, count the rows of `dbo.proof` with `sqlcmd`.
  Expected if the holes are real: the first leaves 2 rows, the second leaves 0.
- [ ] **Step 3: Check every word of spec 4.2 is reserved.** For each single word W in the list, run `SELECT 1 AS W` with `sqlcmd`. Expected: a syntax error for every one. Record any word that is accepted.
- [ ] **Step 4: Check what spec 4.2 must keep allowing.** Run each line of Review Focus 1 as a real query against a real table. Expected: each returns rows.
- [ ] **Step 5: Write the record.** For each try: the statement, what happened, in one table. Then one of two endings. "The holes are real; build as planned." Or "H1 or H2 could not be done; stop", with what you saw. In the second case report BLOCKED.
- [ ] **Step 6: Remove the container and the script. Commit the record.**

```bash
git add docs/superpowers/specs/2026-11-15-select-check-real-run.md
git commit -m "docs(spec): the SELECT check's holes, tried on a real SQL Server"
```

### Task 2: One reader of the SQL text

**Files:**
- Create: `packages/dashboards/src/sql-text.ts`
- Create: `packages/dashboards/src/sql-text.test.ts`
- Modify: `packages/dashboards/src/sql-runner.ts:5-32` (the two strip functions go; the check reads the new reader)
- Modify: `packages/dashboards/src/index.ts` (export)

**Interfaces:**
- Produces: `blankSql(sql: string, dialect?: SqlDialect): string`. Returns the text with each string replaced by `''`, each comment by one space, each `[name]` by `[]`, each `"name"` by `""`, each backtick name by two backticks. Throws a fixed sentence on an unterminated string, comment or name, on a block comment opened inside a block comment, and on `/*!`.
- Produces: `tokensInPlainSql(template: string, token: RegExp, dialect?: SqlDialect): boolean`. True when every match of `token` in `template` sits outside strings, comments and quoted names.
- `SqlDialect` moves to `sql-text.ts` and is re-exported from `sql-runner.ts`, so no import elsewhere changes.

- [ ] **Step 1: Write the failing tests** in `sql-text.test.ts`:

```ts
it.each([
  ["SELECT '--', 1; DELETE FROM t", "SELECT '', 1; DELETE FROM t"],
  ["SELECT 'it''s' AS a", "SELECT '' AS a"],
  ["SELECT 1 -- exec later\nFROM t", "SELECT 1  \nFROM t"],
  ["SELECT 1 /* a ' b */ FROM t", "SELECT 1   FROM t"],
  ["SELECT [open], [a]]b] FROM t", "SELECT [], [] FROM t"],
  ['SELECT "set" FROM t', 'SELECT "" FROM t'],
  ["SELECT `use` FROM t", "SELECT `` FROM t"],
  ["SELECT '/*' AS a, '*/' AS b", "SELECT '' AS a, '' AS b"],
  ["SELECT '[' AS a, ']' AS b", "SELECT '' AS a, '' AS b"],
])('blanks %s', (input, want) => { expect(blankSql(input)).toBe(want); });

it.each([
  "SELECT 'abc", "SELECT 1 /* never closed", "SELECT [abc", 'SELECT "abc',
  "SELECT 1 /* a /* b */ c */", "SELECT 1 /*! DROP TABLE t */",
])('refuses %s', (input) => { expect(() => blankSql(input)).toThrow(); });

it('on mysql, two dashes with no space after are code, not a comment', () => {
  expect(blankSql('SELECT 1 --2 AS a', 'mysql')).toBe('SELECT 1 --2 AS a');
  expect(blankSql('SELECT 1 --2 AS a', 'mssql')).toBe('SELECT 1  ');
});

it('finds a token only in plain SQL', () => {
  const T = /\{\{\s*keys\s*\}\}/g;
  expect(tokensInPlainSql('WHERE id IN ({{keys}})', T)).toBe(true);
  expect(tokensInPlainSql("WHERE id IN ('{{keys}}')", T)).toBe(false);
  expect(tokensInPlainSql('WHERE 1=1 /* {{keys}} */', T)).toBe(false);
  expect(tokensInPlainSql('SELECT [{{keys}}] FROM t', T)).toBe(false);
  expect(tokensInPlainSql('WHERE 1=1 -- {{keys}}', T)).toBe(false);
});
```

- [ ] **Step 2: Run them and see them fail.** `pnpm exec vitest run src/sql-text.test.ts` from `packages/dashboards`. Expected: FAIL, `blankSql` is not defined.
- [ ] **Step 3: Implement `blankSql` and `tokensInPlainSql`** as one left-to-right scan over the characters, with a state for each of the five things. No regular expression does the scanning. `tokensInPlainSql` compares the number of matches in the template with the number in the blanked text.
- [ ] **Step 4: Make `validateSelectSql` read `blankSql`** in place of `stripStringLiterals(stripComments(...))`. Its rules do not change in this task. A throw from `blankSql` is a refusal.
- [ ] **Step 5: Add to `sql-runner.test.ts`:** `validateSelectSql("SELECT '--', 1; DELETE FROM t")` throws; every existing case still passes.
- [ ] **Step 6: Run the package suite and the seed gate.** `pnpm exec vitest run` in `packages/dashboards`, then `pnpm exec vitest run src/seed-queries-select-gate.test.ts` in `packages/bootstrap`. Expected: PASS.
- [ ] **Step 7: Commit.**

```bash
git add packages/dashboards/src/sql-text.ts packages/dashboards/src/sql-text.test.ts packages/dashboards/src/sql-runner.ts packages/dashboards/src/sql-runner.test.ts packages/dashboards/src/index.ts
git commit -m "fix(dashboards): the SELECT check reads strings, comments and quoted names in one pass"
```

### Task 3: The SQL Server rule, and every caller passes its dialect

**Files:**
- Modify: `packages/dashboards/src/sql-runner.ts` (`validateSelectSql`, `runSqlQuery`)
- Modify: `packages/bootstrap/src/connector-sql-service.ts:41-49`
- Modify: `packages/bootstrap/src/import-source-reader.ts:152`, `:165`, `:204-205`; `import-copy.ts:314-315`; `import-run.ts:466-467`, `:669`
- Modify: `packages/dashboards/src/custom-query-run.ts:66-70`
- Modify: every other caller found by `grep -rn "validateSelectSql(" packages apps` that knows its engine. List each in the report with the dialect it passes, or why it has none.
- Test: `packages/dashboards/src/sql-runner.test.ts`, `packages/bootstrap/src/seed-queries-select-gate.test.ts`, `packages/bootstrap/src/connector-sql-service.test.ts`

**Interfaces:**
- Consumes: `blankSql` from Task 2.
- Produces: `validateSelectSql(rawSql: string, dialect?: SqlDialect): void`. With `mssql` it also applies spec 4.2. Without a dialect it applies today's rules only.
- Produces: `prepareSelect(sql, params, values, dialect?: SqlDialect): string`.

- [ ] **Step 1: Write the failing tests** in `sql-runner.test.ts`:

```ts
const STATEMENT_WORDS = ['exec', 'execute', 'waitfor', 'dbcc', 'backup', 'restore', 'shutdown', 'kill', 'deny',
  'declare', 'set', 'reconfigure', 'begin', 'commit', 'rollback', 'save', 'if', 'while', 'print', 'raiserror',
  'goto', 'return', 'open', 'close', 'deallocate', 'checkpoint', 'bulk', 'writetext', 'updatetext', 'readtext',
  'load', 'dump', 'setuser', 'revert', 'add'];

it.each(STATEMENT_WORDS)('mssql refuses the statement word %s', (w) => {
  expect(() => validateSelectSql(`SELECT 1 AS x ${w.toUpperCase()} something`, 'mssql')).toThrow();
});
it.each(STATEMENT_WORDS)('other dialects keep %s as a name', (w) => {
  expect(() => validateSelectSql(`SELECT ${w} FROM t`, 'postgres')).not.toThrow();
  expect(() => validateSelectSql(`SELECT ${w} FROM t`)).not.toThrow();
});
it.each([
  "SELECT * FROM OPENQUERY(lnk, 'select 1')", "SELECT * FROM OPENROWSET('a','b','c')",
  "SELECT * FROM OPENDATASOURCE('a','b').x.dbo.t", 'SELECT * FROM OPENXML(1, 2)',
  'SELECT 1 AS x USE other', 'SELECT * FROM t x DISABLE TRIGGER trg ON t',
  'SELECT * FROM t x ENABLE TRIGGER trg ON t', 'SELECT NEXT VALUE FOR dbo.seq',
])('mssql refuses %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).toThrow(); });
it.each([
  'SELECT [open], open_date, [set] FROM t', 'SELECT * FROM ##open', 'SELECT @set AS a',
  "SELECT 'please exec this' AS a", 'SELECT 1 -- exec later', "SELECT a FROM t OPTION (USE HINT('X'))",
  'SELECT a FROM t OPTION (USE PLAN N\'<p/>\')', 'SELECT a FROM t ORDER BY a OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
  'SELECT CASE WHEN a = 1 THEN 2 END FROM t', 'SELECT enable, disable, next, value FROM t',
  'SELECT * FROM OPENJSON(@j)',
])('mssql allows %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).not.toThrow(); });
```

Drop from `STATEMENT_WORDS` any word Task 1 found is not reserved, and say so in the report.

- [ ] **Step 2: Run and see them fail.** Expected: FAIL on the `mssql refuses` cases.
- [ ] **Step 3: Implement the rule** in `validateSelectSql`. A word is whole when the characters on both sides are not letters, digits, `_`, `#`, `@` or `$`. The refusal is one fixed sentence: `only read-only SELECT queries are allowed on SQL Server (statement words such as EXEC are refused; put a name that is such a word in [brackets])`.
- [ ] **Step 4: Pass the dialect from every caller.** In `connector-sql-service.ts`, work out the dialect before the check and pass it; the check still runs before the config is decrypted. `runSqlQuery` passes `engine`. The import paths pass `'mssql'`. `prepareSelect` takes it as a fourth parameter and `runStoredQuery` leaves it out, because the connector runner checks again with the dialect.
- [ ] **Step 5: The seed gate passes the dialect.** In `seed-queries-select-gate.test.ts`, the loop over `DIALECTS` calls `prepareSelect(..., dialect)` and `validateSelectSql(..., dialect)`. Expected: PASS for all 15 queries in three dialects.
- [ ] **Step 6: A connector runner test:** with a `microsoft-sql` connector, `SELECT 1 AS x EXEC p` is refused before `createDb` is called; with a `postgres` connector, `SELECT backup FROM t` reaches `createDb`.
- [ ] **Step 7: Run the suites of `@openldr/dashboards` and `@openldr/bootstrap`, then commit.**

```bash
git commit -m "fix(dashboards): on SQL Server the SELECT check refuses a second statement and pass-through SQL"
```

### Task 4: Tokens sit in plain SQL

**Files:**
- Modify: `packages/bootstrap/src/import-sql.ts:29-38` (`fill`)
- Modify: `packages/dashboards/src/custom-query-run.ts:22-48` (`substituteParams`)
- Modify: `packages/dashboards/src/template.ts:35-46` (`applyTemplate`)
- Modify: `packages/bootstrap/src/index.ts:923`
- Test: `packages/bootstrap/src/import-sql.test.ts`, `packages/dashboards/src/custom-query-run.test.ts`, `packages/dashboards/src/template.test.ts`
- Modify: `packages/bootstrap/src/import-run.test.ts:344`, `packages/bootstrap/src/import-copy.test.ts:844` (they put `{{limit}}` in a comment on purpose; the expected message changes)

**Interfaces:**
- Consumes: `tokensInPlainSql` from Task 2.

- [ ] **Step 1: Write the failing tests.**

```ts
// import-sql.test.ts
it('refuses a template with a token inside quotes or a comment', () => {
  expect(() => fillDetailQuery("SELECT * FROM t WHERE id IN ('{{keys}}')", ['A'])).toThrow(/\{\{keys\}\}/);
  expect(() => fillKeyQuery('SELECT TOP ({{limit}}) id FROM t WHERE id > {{after}} /* {{after}} */ ORDER BY id', null, 1)).toThrow();
});
it('the refusal names the token and holds no key', () => {
  try { fillDetailQuery("SELECT * FROM t WHERE id IN ('{{keys}}')", ['SECRETKEY1']); } catch (e) {
    expect(String(e)).not.toContain('SECRETKEY1');
  }
});
// custom-query-run.test.ts
it('refuses a parameter token inside quotes and says how to fix it', () => {
  const p = [{ id: 'name', type: 'text', label: 'Name', required: false }];
  expect(() => substituteParams("SELECT * FROM t WHERE n = '{{param.name}}'", p as never, { name: 'x' }))
    .toThrow(/remove the quotes/);
});
// template.test.ts
it('a viewer value with a quote, two dashes or a comment opener stays one literal', () => {
  const out = applyTemplate('SELECT * FROM t WHERE n = {{n}}', { n: "a' -- /* b" });
  expect(out).toBe("SELECT * FROM t WHERE n = 'a'' -- /* b'");
});
it('refuses a filter token inside quotes', () => {
  expect(() => applyTemplate("SELECT * FROM t WHERE n = '{{n}}'", { n: 'x' })).toThrow(/remove the quotes/);
});
it('a token inside an optional clause that is dropped is not checked', () => {
  expect(applyTemplate('SELECT 1 [[ AND a = {{a}} ]]', {})).toBe('SELECT 1 ');
});
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** In `fill`: refuse when `tokensInPlainSql(sql, TOKEN, 'mssql')` is false, with `import SQL has a token inside quotes, a comment or a quoted name: remove the quotes around {{name}}`, naming the first such token. In `substituteParams` and `applyTemplate`: the same check on the text after the optional clauses are resolved and before values go in, with `a {{token}} sits inside quotes, a comment or a quoted name: remove the quotes; the value is quoted for you`.
- [ ] **Step 4: `index.ts:923` always applies the template:** `applyTemplate(q.sql, resolveValues(q.values ?? {}))`. Add one test in the dashboard query tests that a widget sent without `values` and holding `[[ ... ]]` runs with the clause dropped.
- [ ] **Step 5: Update the two import tests** whose expected message changes. Say so in the report, test by test.
- [ ] **Step 6: Run the suites of `@openldr/dashboards` and `@openldr/bootstrap`, the plugin's `cargo test`, and the seed gate. Commit.**

```bash
git commit -m "fix(import): a token inside quotes or a comment in a SQL template is refused"
```

### Task 5: Run checked SQL in a transaction that cannot keep a write

**Files:**
- Modify: `packages/bootstrap/src/connector-db.ts` (interface and the three engines)
- Modify: `packages/bootstrap/src/connector-sql-service.ts:52-62`
- Modify: `packages/dashboards/src/sql-runner.ts:106-129` (`runReadQuery`)
- Test: `packages/bootstrap/src/connector-db.test.ts`, `packages/bootstrap/src/connector-sql-service.test.ts`, `packages/dashboards/src/sql-runner.test.ts`

**Interfaces:**
- Produces: `ConnectorDb.queryReadOnly(rawSql: string): Promise<{ rows: Record<string, unknown>[] }>`.
  - `postgres`: one client from the pool; `BEGIN READ ONLY`; the statement; `ROLLBACK`; release. On any error the client is released as broken so the pool drops it.
  - `microsoft-sql`: `store.db.startTransaction()`, the statement on that transaction, then `rollback()`, all inside `withRequestTimeout` as `query` is today.
  - `mysql`: the same as `query`.
- `ConnectorDb.query` is unchanged. The import page reader keeps calling it.

- [ ] **Step 1: Write the failing tests.** With fake `pg` and Kysely objects that record what they are sent:

```ts
it('postgres: BEGIN READ ONLY, the statement, ROLLBACK, in that order on one client', ...);
it('postgres: an error in the statement still sends ROLLBACK and releases the client as broken', ...);
it('mssql: the statement runs on a transaction that is rolled back on success', ...);
it('mssql: the statement runs on a transaction that is rolled back on failure', ...);
it('mssql: when the roll-back itself fails, the error thrown is the statement\'s own', async () => {
  // statement rejects with Error('Conversion failed'), rollback rejects with Error('3903')
  await expect(conn.queryReadOnly('SELECT 1')).rejects.toThrow('Conversion failed');
});
it('mysql: queryReadOnly sends exactly what query sends', ...);
it('mysql: neither pool turns multipleStatements on', () => {
  // read the options passed to createPool in connector-db.ts and adapter-mysql-store
  expect(options.multipleStatements).toBeUndefined();
});
it('query is unchanged: one raw statement, no transaction', ...);
// sql-runner.test.ts
it('runReadQuery on mssql rolls back after a good query and after a failed one', ...);
it('runReadQuery on mssql: after a deadline cancels the query, the next query on the same db finds no open transaction', ...);
it('runReadQuery on postgres still sets the transaction read only', ...);
```

Write each with real assertions on the recorded calls.

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement `queryReadOnly`** for the three engines as the Interfaces block says.
- [ ] **Step 4: The connector runner calls `queryReadOnly`** in both places it calls `query` today (`connector-sql-service.ts:54`, `:61`).
- [ ] **Step 5: `runReadQuery` rolls back on `mssql`.** Use `db.startTransaction()` for that engine, roll back in a `finally`, and never let a failed roll-back replace the query's error. The `postgres` and `mysql` arms keep what they do.
- [ ] **Step 6: Run the suites of `@openldr/dashboards`, `@openldr/bootstrap` and `@openldr/server`. Commit.**

```bash
git commit -m "fix(query): checked SQL runs read-only on a Postgres connector and is rolled back on SQL Server"
```

### Task 6: A wrong password says so

**Files:**
- Modify: `packages/bootstrap/src/import-retry.ts:95-115` (`describeSourceError`) and its doc comment
- Test: `packages/bootstrap/src/import-retry.test.ts`, `packages/bootstrap/src/import-source-reader.test.ts:516`

- [ ] **Step 1: Write the failing tests.**

```ts
const poolError = (message: string) => Object.assign(new Error(message), { name: 'TimeoutError' });
it('a login refused at connect reads as a refused login', () => {
  expect(describeSourceError(poolError("Login failed for user 'copy'."), clean)).toBe('the source refused the login');
});
it('a database that cannot be opened reads as that', () => {
  expect(describeSourceError(poolError('Cannot open database "LabA" requested by the login.'), clean))
    .toBe('the source could not open the database');
});
it('the sentence holds none of the driver\'s words', () => {
  expect(describeSourceError(poolError("Login failed for user 'SECRETUSER'."), clean)).not.toContain('SECRETUSER');
});
```

Check the two message texts against what `classifyConnectError` matches before you rely on them.

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.** After the `number !== null` branch and before the kind is worked out: when `classifyConnectError(message)` is `loginFailed`, return `the source refused the login`; when it is `databaseMissing`, return `the source could not open the database`. Update the rule list in the doc comment.
- [ ] **Step 4: Rewrite the reader test at `import-source-reader.test.ts:516`** to use `poolError`, the shape the connection pool really gives. Its assertions on behaviour stay.
- [ ] **Step 5: Run the bootstrap suite. Commit.**

```bash
git commit -m "fix(import): a wrong password on a source reads as a refused login"
```

### Task 7: Start copy moves into a dots menu

**Files:**
- Modify: `wasm/openldr-v1-import/ui/src/CopyPanel.tsx:328-362`
- Modify: `wasm/openldr-v1-import/ui/src/i18n.ts` (one new key `copy.actions` in en, fr, pt: the menu button's label)
- Modify: `wasm/openldr-v1-import/ui/src/styles.css` (only if the first row needs it)
- Test: `wasm/openldr-v1-import/ui/src/CopyPanel.test.tsx`, `i18n.test.ts`

- [ ] **Step 1: Write the failing tests.** The plain button `copy-start` is gone from the page. A menu button `copy-actions` sits in the first row and shows before a connector is picked. Opening it shows one item `copy-start` with the label `copy.start`, `copy.continue` or `copy.starting` under today's rules. The item is `aria-disabled` under the conditions `canStart` is false today. Choosing it calls `start` with the form's options. After a start, focus goes to the menu button. Escape closes the menu and returns focus to its button. The copy card's own menu (`copy-menu`, Stop and Delete) is unchanged.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement,** copying the markup, the outside-click handling and the keyboard handling of the existing menu at `CopyPanel.tsx:375-420`. Two menus must not be open at once.
- [ ] **Step 4: Run the plugin page's tests and `pnpm build:v1-import`. Commit.**

```bash
git commit -m "fix(v1-import): Start copy sits in a dots menu on the Copy tab"
```

### Task 8: Docs in three languages

**Files:**
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/v1-import.md`, `apps/web/src/docs/0.1.8/{en,fr,pt}/v1-import.md`
- Modify: `apps/studio/src/docs/0.1.8/{en,fr,pt}/query.md`
- Modify: the pictures in both apps that show the Start copy button

Line numbers below were read at `f19d4b15`; find each sentence by its words.

- [ ] **Step 1: The eleven wording items.**
  1. All six guides, "The last error of a lost link starts with plain words, then gives the driver's own words." (studio near 205, web near 209). Add "usually": en "usually starts", fr "commence en général", pt "começa em geral".
  2. pt, studio near 258, web near 333: "Tal como o botão, termina antes de as linhas desaparecerem" and "Termina antes de as linhas desaparecerem." Make the subject the command: "o comando termina antes de...".
  3. pt, studio near 215, web near 219: "Uma cópia na fila para logo." Use "Uma cópia na fila é parada logo."
  4. pt, same lines: "à parte uma dica cinzenta". Use "exceto um exemplo a cinzento".
  5. pt, studio near 205, web near 209: "dizer que a base de dados falta". Use "indicar que a base de dados não está disponível".
  6. pt, studio near 286, web near 365: "o estado lê-se". Use "o estado aparece como".
  7. pt, studio near 15, web near 19: "cujo início de sessão tenha SELECT". Use "tenha só a permissão SELECT".
  8. fr, studio near 215, web near 219: "à part un indice gris". Use "à part un exemple grisé".
  9. fr, studio near 205, web near 209: "dire que sa base manque". Use "signaler que sa base est introuvable".
  10. fr, studio near 15, web near 19: "dont l'identifiant a SELECT sur les tables v1". Use "dont le compte de connexion n'a que le droit SELECT sur les tables v1". fr, studio near 286, web near 365: "l'état se lit". Use "l'état affiché est".
  11. en, studio near 203 and 215 and their web twins: two sentences of over 30 words. Split each in two.
- [ ] **Step 2: The Copy tab's new menu.** Every sentence in the six guides that tells a person to press **Start copy** or **Continue copy** now says to open the dots menu first. Copy the labels from `i18n.ts`.
- [ ] **Step 3: The Query guide,** in `query.md` in en, fr and pt, one short paragraph: on a SQL Server connector a query that holds a statement word such as `EXEC` is refused; a column or table whose name is such a word goes in `[brackets]`; a `{{param}}` is written without quotes because OpenLDR quotes the value.
- [ ] **Step 4: Retake the pictures** that show the old Start copy button, on a scratch server under the Global Constraints, with fictional data only.
- [ ] **Step 5: Run the docs tests of `apps/studio` and `apps/web`. Commit.**

```bash
git commit -m "docs: the copy guide's wording, the Start copy menu, and what the Query page refuses on SQL Server"
```

### Task 9: The real run after the change

**Files:**
- Modify: `docs/superpowers/specs/2026-11-15-select-check-real-run.md` (append "After the change")

- [ ] **Step 1: Scratch servers.** Your own SQL Server container from the 2025 image, a scratch Postgres database for a Postgres connector, and a scratch OpenLDR on a scratch port, all under the Global Constraints.
- [ ] **Step 2: The holes again, through the product.** On the Query page against the SQL Server connector, send the two statements of Task 1, an `OPENQUERY` statement, and a saved query with `'{{param.x}}'`. Expected: each is refused with its fixed sentence, and `dbo.proof` is unchanged.
- [ ] **Step 3: The roll-back by itself.** In a throwaway script, call `queryReadOnly` on the SQL Server connection with `INSERT INTO dbo.proof VALUES (9)`, which goes below the check. Expected: no error, and the row is not there afterwards. On the Postgres connection, the same statement. Expected: an error that the transaction is read-only.
- [ ] **Step 4: The person's own error.** On the Query page run `SELECT CAST('x' AS int)` against SQL Server. Expected: the conversion error, not error 3903.
- [ ] **Step 5: Each changed path once.** Typed SQL on the Query page, a saved query with a parameter, a report, a builder dashboard, a dashboard SQL widget with a filter, the workflow Database node, the workflow SQL Query node. Expected: each returns its rows as before. Say which target store the scratch server uses.
- [ ] **Step 6: The cost.** In a throwaway script, 100 runs of `SELECT TOP 1 * FROM dbo.proof` with `query` and 100 with `queryReadOnly` on the same SQL Server connection. Report the two medians.
- [ ] **Step 7: The Copy tab.** With the plugin installed on the scratch server, take a picture at desktop width and one at 375 by 812 with the dots menu open. The Start item must be on screen in both.
- [ ] **Step 8: Remove everything. Append the record. Commit.** State plainly what was not tried: MySQL on a real server, a linked server for `OPENQUERY` if none was made, a real phone.

```bash
git commit -m "docs(spec): the SELECT check after the change, tried on real servers"
```

### Task 10: Gate and changelog

- [ ] **Step 1: Build the plugin.** `pnpm build:v1-import`.
- [ ] **Step 2: Merge `main` into the branch as its own step.**
- [ ] **Step 3: Run the forced gate on the merged head,** each command's output redirected to a file, the exit code read after the redirect. Search the output for `Test timed out`, `out of memory` and `VirtualAlloc` before reading a failure as a regression.
- [ ] **Step 4: Report the three results with their summary lines.** The merge into `main`, `pnpm make:changelog` and the push are the operator's to approve.
