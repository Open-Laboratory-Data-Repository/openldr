# A stricter SELECT check, and three small follow-ups to the copy

Date: 2026-11-15. Follows the merge of migration part 1 (`1d0b7b7b`).

## 1. Why

OpenLDR runs SQL it did not write in these places: the Query page (typed SQL, the schema tree's browse SQL at `apps/server/src/query-routes.ts:276`, `:289`, `:309`, and its count wrapper at `:228`), saved custom queries, dashboard SQL widgets, builder dashboards (`packages/dashboards/src/compile.ts:406`), reports (`report-query.ts:22`, `report-designs-routes.ts:171`, `packages/bootstrap/src/index.ts:306`, `:332`, `:385`), the workflow Database node, the workflow SQL Query node (`workflow-sql.ts:30`), and import plugins. All of it is meant to be read-only. One check decides that, in `packages/dashboards/src/sql-runner.ts`. Since the build it has two forms: `validateSelectSql(sql, dialect)` for code that runs SQL, and `validateSelectSqlForSave(sql)` for code that only saves or imports a query (section 10).

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

Amended by the build: the reader follows one engine at a time and refuses text an engine may read two ways. Section 10 has the rules as built. The paragraph below is the design as first approved.

Replace `stripComments` and `stripStringLiterals` with one pass, left to right, that knows five things at once: a `'string'` with `''` inside, a `-- line comment`, a `/* block comment */` with nesting, a `[bracketed name]` with `]]` inside, and a `"quoted name"` or `` `backtick name` ``. It returns the text with each of those blanked. A comment marker inside a string is then text, and a banned word inside a bracketed name is a name.

Everything else in the check reads that blanked text, as today.

### 4.2 A rule for SQL Server (closes H1 and H3)

`validateSelectSql(sql, dialect)` takes the dialect of the engine that will run the SQL. As first approved the dialect was optional; the build made it required and gave the save-time check its own name (section 10). When the dialect is `mssql`, the blanked text is also refused if it holds:

- a reserved word that can start a statement: `exec`, `execute`, `waitfor`, `dbcc`, `backup`, `restore`, `shutdown`, `kill`, `deny`, `declare`, `set`, `reconfigure`, `begin`, `commit`, `rollback`, `save`, `if`, `while`, `print`, `raiserror`, `goto`, `return`, `open`, `close`, `deallocate`, `checkpoint`, `bulk`, `writetext`, `updatetext`, `readtext`, `setuser`, `revert`, `add`;
- `use`, unless it is a query hint: `hint` then `(`, or `plan` then a string;
- `openquery`, `openrowset`, `opendatasource`, `openxml`;
- the pairs `enable trigger`, `disable trigger`, and `next value for`.

`fetch` and `end` stay allowed, because `OFFSET ... FETCH` and `CASE ... END` use them.

`load` and `dump` are not on the list. Task 1's real run found that SQL Server 2025 takes both as plain names (the record is `2026-11-15-select-check-real-run.md`). Microsoft's published list of reserved keywords, read on 2026-11-15, still has both; the server decides.

A word is matched whole. Letters, digits, `#`, `@`, `$` and `_` count as part of a name, so a temp table `##open` or a variable-like name `@set` is not the word `open` or `set`. One case is different, found in review: SQL Server reads a number and a word with no space between them as two things, so in a run of name characters that starts with a digit, a listed word at the end still counts (`1KILL`). A run that starts with `0x` is a binary number, `0x` and its hex digits, and holds no word (`0xADD`). Section 10 has the rule in full.

`SELECT NEXT VALUE FOR dbo.seq` is valid T-SQL today and is refused on purpose: it moves a sequence on.

Not refused, and known: the Service Broker statements `SEND`, `RECEIVE`, `MOVE CONVERSATION`, `END CONVERSATION` and `GET CONVERSATION GROUP`. None of those words is reserved, so refusing them would refuse a column named `send` or `move`. All of them are undone by the roll-back in 4.4. The import page reader has no roll-back, so a plugin's template could still carry one to a source that uses Service Broker. I accept that for now.

Why this refuses no working query: in T-SQL a reserved word cannot be a bare column or table name. It has to be in brackets, and 4.1 blanks brackets. I stated the reserved list from memory. Task 1 checked every word on a scratch SQL Server 2025, and the controller checked the list against Microsoft's published one. Both checks are in section 10.

On Postgres and MySQL the word list stays as it is today. A Postgres column named `backup` keeps working.

Who passes the dialect:

- `createConnectorSqlRunner` already knows the connector type. It passes the dialect and checks after it has read the type.
- The import paths pass `mssql`. An import source can only be SQL Server today.
- `runSqlQuery` already receives its engine and passes it on.
- A check made when a query is saved or imported, where the engine is not known, uses `validateSelectSqlForSave`. It passes when the text passes under at least one engine's reading. It is not the guard for a run. The options SQL of a parameter is checked this way first and then again with the connector's dialect when it runs.

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

## 10. What the build changed in this design

The build's reviews found that parts of sections 4.1 to 4.4 were wrong or left too much open. Each change below was a ruling by the controller during the build. The operator approved the design above; these rulings were made on the operator's behalf and are listed for the operator to check. Sections 4.5, 4.6 and 4.7 were built as approved.

### 10.1 The reader follows one engine

A reader with no engine cannot be right for three engines at once. So the reader always takes a dialect, and it follows that engine exactly. Where an engine's reading depends on its version or its settings, or is not known for certain, the reader refuses the text with a fixed sentence.

- A string is `'...'` with `''` inside, on every engine. A quoted name is `"..."` on every engine, `[...]` on SQL Server only, and a backtick name on MySQL only. Square brackets are array subscripts on Postgres.
- Postgres also has dollar-quoted strings (`$tag$ ... $tag$`) and `E'...'` strings, where a backslash makes the next character ordinary.
- A line comment is `--` to the end of the line. On MySQL `--` opens a comment only before a space or a control character, and `#` also opens one. On Postgres a line comment ends at a line feed or a carriage return. On SQL Server and MySQL it ends at a line feed.
- A block comment nests on SQL Server and Postgres. On MySQL it ends at the first `*/`.
- On MySQL, `/*! ... */` keeps its inside as SQL, because MySQL runs it.

Refused, because the engine's reading is not certain:

- a NUL character anywhere, on every engine;
- on MySQL, a comment that carries a version number (`/*!50000 ... */`, `/*!!50000 ... */`) and a MariaDB comment (`/*M! ... */`): the server's version decides whether it runs;
- on SQL Server, inside a `--` comment, any control character other than a tab, and the two Unicode line separators: nobody had shown how SQL Server ends a line comment. Task 9's real run tries each one, and its result may loosen this;
- on MySQL and SQL Server, a carriage return inside a line comment that is not followed by a line feed and is not the last character.

Three engine defaults the reader assumes, where refusing would break working queries:

- on MySQL, a backslash inside `'...'` and `"..."` makes the next character ordinary. That is the server's default. On a MySQL server set to `NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES`, text after such a string can be hidden from the check. MySQL runs one statement per request, and the run paths wrap the SQL in a derived table, so what could hide is a read or a row lock;
- on Postgres, a backslash in a plain string is an ordinary character. Both Postgres paths now run `SET LOCAL standard_conforming_strings = on` at the start of their transaction, which makes this true whatever the server or the session says;
- on SQL Server, `"..."` is read the same whether it is a name or a string.

### 10.2 Two forms of the check

- `validateSelectSql(sql, dialect)`: the dialect is required. Every path that runs SQL calls it with the engine that will run it. `runSqlQuery` and `runReadQuery` take the engine as a required parameter.
- `validateSelectSqlForSave(sql)`: passes when the text passes under at least one of the three engines' readings. It is used only where a query is saved or imported and the engine is not known. A query can therefore be saved and then refused when it runs.

### 10.3 The SQL Server word rule

- `load` and `dump` are not on the list (section 4.2).
- In a run of name characters that starts with a letter, `_`, `#` or `@`, a listed word counts only when it is the whole run. In a run that starts with a digit or `$`, it counts when the run ends with it, because SQL Server reads a number and a word with no space as two things. A run that starts with `0x` is a binary number: `0x` and as many hex digits as follow; a listed word counts only as the whole of what is left after them.
- The same rule applies to the older word list (`insert`, `update`, `delete` and the rest) on SQL Server and Postgres. MySQL keeps the older word boundary, because a MySQL name may start with a digit.
- Between the words of a pair (`enable trigger`, `disable trigger`, `next value for`), spaces, control characters and Unicode separators all count as a gap.
- `use` is allowed only in the shape of a query hint.

### 10.4 Tokens and the values that fill them

- A token is found by position: every character of it must be plain SQL in the engine's reading. Counting tokens before and after blanking was wrong.
- The fill takes the dialect. The dashboard query passes the target store's engine, and a saved query asks for its connector's dialect. With no dialect, which only the client-side preview has, the token check passes when one engine's reading passes.
- A number goes in only when it is finite. A negative number goes in inside parentheses, so it cannot make `--` after a minus sign. On MySQL a string value doubles its backslashes as well as its quotes.
- The studio's widget editor no longer fills a template in the browser. It sends the template and the values, and the server fills once. The studio's own copy of the fill is deleted.
- A token directly after a lone `E` is refused on Postgres, because the filled value would then be read as an `E'...'` string.

### 10.5 Transactions

- A trailing line comment in a person's SQL used to swallow what `planPagination` and the Query page's count query added after it. Both now put a line feed first. On Postgres and MySQL this makes a query that ends in a comment work, where it failed before.
- The roll-back is always its own request, never text added to the person's SQL.
- On the Postgres connector path a client is taken from the pool by hand. It carries an error listener for as long as it is out, so a dropped connection ends the query with an error and cannot stop the server.
- A connection is never handed back to a pool with an open transaction. Kysely does not release a connection when its own roll-back fails, so the roll-back is wrapped so that the connection is released either way.

### 10.6 Found during the build and not fixed, for the operator

- **A dropped Postgres connection can stop the server.** Kysely's Postgres driver adds no error listener to a client it takes from a pool. This affects every query on OpenLDR's own two Postgres databases. It is older than this work. The fix sits in `packages/adapter-db-store/src/index.ts` and `packages/db/src/internal-db.ts`.
- **The lock-wait limit on a SQL Server target store has no effect.** `runReadQuery` sends `set lock_timeout` as its own request, and the driver ends a session setting with the request that made it.
- **A count for a query that ends in `; -- note` still fails**, as it did before.
