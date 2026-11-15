# A stricter SELECT check, and three small follow-ups to the copy

Date: 2026-11-15. Follows the merge of migration part 1 (`1d0b7b7b`).

## 1. Why

OpenLDR runs SQL it did not write in these places: the Query page (typed SQL, the schema tree's browse SQL at `apps/server/src/query-routes.ts:276`, `:289`, `:309`, and its count wrapper at `:228`), saved custom queries, dashboard SQL widgets, builder dashboards (`packages/dashboards/src/compile.ts:406`), reports (`report-query.ts:22`, `report-designs-routes.ts:171`, `packages/bootstrap/src/index.ts:306`, `:332`, `:385`), the workflow Database node, the workflow SQL Query node (`workflow-sql.ts:30`), and import plugins. All of it is meant to be read-only. One function decides that: `validateSelectSql` (`packages/dashboards/src/sql-runner.ts:17`).

The focused read at the end of part 1 found four ways past it. Reading its callers found that the problem is wider than plugins:

- SQL typed against a connector runs through `createConnectorSqlRunner` (`packages/bootstrap/src/connector-sql-service.ts:38`). It checks the text and then runs it with `conn.query`, with no transaction of any kind, on every engine.
- A person needs only the `query.run` capability to reach it (`apps/server/src/query-routes.ts:30`).
- On SQL Server and MySQL the text check is the only guard. The code says so (`sql-runner.ts:26-28`).

So a person with `query.run` and a SQL Server connector can, by my reading, run a second statement. I have not tried it. Step 1 of the plan is to try it on a scratch SQL Server and record what happens. If it cannot be done, parts 4.2 and 4.4 below shrink and I say so before building.

## 2. The four ways past the check

- **H1.** T-SQL runs `SELECT 1 EXEC dbo.x` as two statements. No semicolon is needed, and `EXEC`, `WAITFOR`, `BACKUP`, `SHUTDOWN` and the like are not refused.
- **H2.** Comments are stripped before strings. `SELECT '--', 1; DELETE FROM t` is seen as `SELECT '` and passes.
- **H3.** `OPENQUERY`, `OPENROWSET` and `OPENDATASOURCE` carry SQL inside a string, which the check blanks before it looks.
- **H4.** A template that puts a token inside quotes or a comment lets the filled value leave its quotes. This applies to import templates (`{{keys}}`, `{{after}}` in `packages/bootstrap/src/import-sql.ts:29`) and to custom query parameters (`{{param.x}}` in `packages/dashboards/src/custom-query-run.ts:43`).

## 3. Goals

- A statement that is not a plain read is refused before it reaches a database, on every path that uses the check.
- On SQL Server, a write that still gets through is undone. On a Postgres connector it is refused by a read-only transaction.
- No query that works today on any engine is refused, except one that was never a plain read.
- The three small follow-ups from part 1 land in the same plan.

Not goals:

- A proof that no harmful statement can pass. The check is a list of rules, not a parser. A login that can only read stays the real guard, and the docs keep saying so.
- Functions that already exist on a server and have side effects, and table hints that lock a source.
- Any change to what the page reader of an import does on a source. It keeps its plain reads.

It would be a failure if a saved query that works today stopped working, or if a Query page run became slower in a way a person notices.

## 4. The design

Approach B, chosen by the operator on 2026-11-15: a better reader of the SQL text, a SQL Server rule, and a roll-back.

### 4.1 One reader of the SQL text (closes H2)

Replace `stripComments` and `stripStringLiterals` with one pass, left to right, that knows five things at once: a `'string'` with `''` inside, a `-- line comment`, a `/* block comment */` with nesting, a `[bracketed name]` with `]]` inside, and a `"quoted name"` or `` `backtick name` ``. It returns the text with each of those blanked. A comment marker inside a string is then text, and a banned word inside a bracketed name is a name.

Everything else in the check reads that blanked text, as today.

### 4.2 A rule for SQL Server (closes H1 and H3)

`validateSelectSql(sql, dialect?)` gains an optional dialect. When it is `mssql`, the blanked text is also refused if it holds:

- a reserved word that can start a statement: `exec`, `execute`, `waitfor`, `dbcc`, `backup`, `restore`, `shutdown`, `kill`, `deny`, `declare`, `set`, `reconfigure`, `begin`, `commit`, `rollback`, `save`, `if`, `while`, `print`, `raiserror`, `goto`, `return`, `open`, `close`, `deallocate`, `checkpoint`, `bulk`, `writetext`, `updatetext`, `readtext`, `load`, `dump`, `setuser`, `revert`, `add`;
- `use`, unless the next word is `hint` or `plan` (a query hint);
- `openquery`, `openrowset`, `opendatasource`, `openxml`;
- the pairs `enable trigger`, `disable trigger`, and `next value for`.

`fetch` and `end` stay allowed, because `OFFSET ... FETCH` and `CASE ... END` use them.

A word is matched whole. The characters `#`, `@`, `$` and `_` count as part of a word, so a temp table `##open` or a variable-like name `@set` is not the word `open` or `set`.

`SELECT NEXT VALUE FOR dbo.seq` is valid T-SQL today and is refused on purpose: it moves a sequence on.

Not refused, and known: the Service Broker statements `SEND`, `RECEIVE`, `MOVE CONVERSATION`, `END CONVERSATION` and `GET CONVERSATION GROUP`. None of those words is reserved, so refusing them would refuse a column named `send` or `move`. All of them are undone by the roll-back in 4.4. The import page reader has no roll-back, so a plugin's template could still carry one to a source that uses Service Broker. I accept that for now.

Why this refuses no working query: in T-SQL a reserved word cannot be a bare column or table name. It has to be in brackets, and 4.1 blanks brackets. I am stating the reserved list from memory. The plan checks every word against Microsoft's reserved keyword list and on a scratch SQL Server, and drops any word that is not reserved.

On Postgres and MySQL the word list stays as it is today. A Postgres column named `backup` keeps working.

Who passes the dialect:

- `createConnectorSqlRunner` already knows the connector type. It passes the dialect and checks after it has read the type.
- The import paths pass `mssql`. An import source can only be SQL Server today.
- `runSqlQuery` already receives its engine and passes it on.
- A check with no dialect (saving a query, importing a pack of queries, the options SQL of a parameter) keeps the base rules. The run-time check with the dialect is the guard.

### 4.3 Tokens sit in plain SQL (closes H4)

Using the reader from 4.1: a template is refused when a token sits inside a string, a comment or a quoted name.

- Import templates: checked in `fill` (`import-sql.ts:29`), so a plugin with such a template fails at the start of a run, with a fixed sentence that names the token and no value.
- Custom query parameters: checked in `substituteParams` (`custom-query-run.ts:22`), at run time. A saved query with `'{{param.x}}'` then fails with a message that says to remove the quotes.
- Dashboard filters: checked in `applyTemplate` (`packages/dashboards/src/template.ts:35`), after the optional `[[ ... ]]` clauses are resolved and before the values go in. A dashboard viewer sets these values, so this is the place where the hole matters most. `packages/bootstrap/src/index.ts:923` changes by one line so the template is always applied, with an empty value set when the widget sends none. The check then never sees a raw `[[ ... ]]`, and the reader in 4.1 does not need to know that syntax.

The builder check counted the seeded and bundled queries: 15 seeded queries in three dialects, the sample dashboard, and the v1 plugin's templates. None puts a token inside a string, a comment or a quoted name. Two tests put `{{limit}}` in a comment on purpose (`import-run.test.ts:344`, `import-copy.test.ts:844`); they will fail with a different message and are updated. A query a site saved itself with `'{{param.x}}'` will be refused after this change, with a message that says how to fix it. I cannot count those.

### 4.4 Roll back what should never have been written

Two runners execute checked SQL. Both change.

- **The connector runner** (`connector-sql-service.ts`). Today: no transaction on any engine (`connector-db.ts:53`, `:88`, `:168`). After: the statement runs inside a transaction. `ConnectorDb` gains one method for this, written per engine, because only its SQL Server side uses Kysely (`connector-db.ts:96`); its Postgres side is a plain `pg` pool and its MySQL side a plain `mysql2` pool.
  - Postgres: a read-only transaction (`BEGIN READ ONLY`), ended with a roll-back. The dashboards runner already does the same for the reporting database.
  - SQL Server: a transaction that is always rolled back, on success as well as on failure. The `set rowcount` batch goes as one request, as it does today.
  - MySQL: no transaction, as today. The operator decided this on 2026-11-15 (section 9).
- **The dashboards runner** (`runReadQuery`, `sql-runner.ts:106`). Today: a transaction that commits. After: on SQL Server it is always rolled back. Postgres keeps its read-only transaction. This runner also serves reports, builder dashboards and the workflow SQL Query node, so they get the same.

A roll-back that fails must not hide the person's own error. SQL Server ends a transaction by itself after some errors, and the roll-back then fails with error 3903. The person must still see the error their query caused.

What a roll-back undoes on SQL Server: a data write, and a table or trigger change. What it does not undo: a shell command, a backup, a message sent to another server.

The import page reader is not changed. It reads a source with plain statements, as part 1 built and proved it.

### 4.5 A wrong password says so

`describeSourceError` (`packages/bootstrap/src/import-retry.ts`) gets one more rule, ahead of the fixed "does not recognise" sentence. When the error has no SQL Server number and `classifyConnectError(message)` says the login failed or the database is missing, the text is a fixed sentence: `the source refused the login` or `the source could not open the database`. No driver words, so no value can leak. The test at `import-source-reader.test.ts:516` is rewritten to use the error shape the connection pool really gives (a `TimeoutError` with no code).

### 4.6 Start copy moves into the dots menu

On the Copy tab, the plain Start copy button goes. Its action becomes the first item of a dots menu, as AGENTS.md section 5 and spec 9.5 of the migration design ask. The menu button sits at the right end of the tab's first row, beside the connector picker, and shows before a connector is picked. Its Start item is off under the same conditions as today's button. The menu button takes over as the focus target the old button was (`CopyPanel.tsx:352`). The label is the same three (`copy.start`, `copy.continue`, `copy.starting`). The copy card's own dots menu (Stop, Delete) stays where it is. The Import tab's plain buttons are older and are not part of this; I list them, I do not change them.

### 4.7 Docs

- The eleven wording items in `task-11-rereview-1.md` of the part 1 notes: the half-true sentence about the last error (all six guides), the Portuguese delete sentence, nine small French and Portuguese cases, two long English sentences. That file lives only in the part 1 worktree's notes folder, which is not on `main`. The plan copies the eleven items in word for word, so it does not depend on that folder.
- The guides' pictures that show the Start copy button are retaken.
- One sentence in the Query page guide, in en, fr and pt: on a SQL Server connector a query that holds a statement word such as `EXEC` is refused, and a name that is such a word goes in brackets.

## 5. Approaches considered

- **A. The text reader and the SQL Server rule only.** Closes the four holes in the check. A write that slips past a rule I missed still lands.
- **B. A plus the roll-back. Chosen.** The same, and a missed rule costs less. It changes how every connector query runs: one transaction around each.
- **C. A SQL parser library.** One SELECT or nothing. The parsers available cover only part of T-SQL, so valid queries on the Query page would be refused, and it adds a dependency.
- **Dropped: ask SQL Server to describe the batch first** (`SET SHOWPLAN_XML`). It needs a permission that a read-only login does not have.

## 6. Proof

- Unit tests for the reader and the rules, with each example from the focused read as a refused case, and each seeded query as a passing case (the existing gate test `seed-queries-select-gate.test.ts` stays and gains the `mssql` dialect).
- A real run on a scratch SQL Server and a scratch Postgres, under the part 1 safety rules (scratch ports, scratch databases, no request to port 3000, no image download): each of the four holes is tried before the change and after it; a write placed behind a rule switched off in a test build is shown to be rolled back; each word of the list is shown to fail as a bare name.
- The real run touches each changed path once: typed SQL on the Query page, a saved query, a report, a builder dashboard, a dashboard SQL widget with a filter, the workflow Database node and the workflow SQL Query node.
- A timing of 100 Query page runs before and after on the scratch SQL Server, to show the transaction costs nothing a person would notice. The other paths are not timed.
- HONEST NON-PROOF, stated now: MySQL has no scratch server on this machine without a download. Nothing about MySQL is proven on a real server.

## 7. Left to the builder

- The reader's exact shape and name.
- How `ConnectorDb` exposes the rolled-back transaction, per engine.
- The wording of each refusal, kept to fixed sentences.
- The dots menu's markup, copied from the copy card's menu in the same file.

## 8. Definition of done

UI (the dots menu), docs in three languages, the mobile look at 375 px, the changelog after the merge. No new CLI command is needed: nothing here is an admin action. The forced gate on the merged head, as in part 1.

## 9. What a builder's read of this design changed

A reviewer read this design as a builder who could not ask questions, and checked its facts against the code.

Facts it confirmed: no transaction on any connector engine today; every single word in 4.2 is reserved in T-SQL (from its memory, not a server); the list refuses no seeded query and no sample dashboard query; no seeded or bundled query has a token inside quotes.

Calls I made from its questions. Each is mine, not the operator's, and can be changed:

- The word match treats `#`, `@`, `$` and `_` as part of a word (4.2).
- The Service Broker statements are left out of the list and left to the roll-back (4.2).
- Dashboard filters join the token rule, and the template is always applied before the check (4.3).
- `ConnectorDb` writes its transaction per engine, and a failed roll-back never hides the query's own error (4.4).
- The dots menu sits in the Copy tab's first row and shows before a connector is picked (4.6).
- The plan carries the eleven wording items itself (4.7).
- The real run touches each changed path once and times only the Query page (6).

Decided by the operator on 2026-11-15: **MySQL does not get the roll-back.** The MySQL driver refuses a second statement by itself (neither `connector-db.ts:115-120` nor `packages/adapter-mysql-store/src/index.ts:29-44` turns `multipleStatements` on), and the existing word list already refuses a single statement that writes. So no statement is known that the roll-back would catch there. Building it would have meant hand-written transaction SQL inside the code that cancels a slow MySQL query (`connector-db.ts:148-176`), with no MySQL server here to try it on. MySQL still gets the new reader (4.1) and the token rule (4.3). One test pins that neither MySQL path turns `multipleStatements` on, because this decision rests on it.

The operator approved this design on 2026-11-15.
