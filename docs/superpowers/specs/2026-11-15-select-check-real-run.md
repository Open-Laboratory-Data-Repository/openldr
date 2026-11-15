# The SELECT check's holes, tried on a real SQL Server

Date: 2026-11-15. Task 1 of the plan for `2026-11-15-select-check-and-copy-follow-ups-design.md`.

The holes are real; build as planned. H1 and H2 both wrote to the database through the real connector runner. One change to spec 4.2: drop `load` and `dump` from the word list. SQL Server 2025 accepts both as a bare column name, so refusing them would refuse a working query.

## How I ran it

- A container of my own from `mcr.microsoft.com/mssql/server:2025-latest`, already on this machine, with no volume. Its port was bound to 127.0.0.1 only. The server reported Microsoft SQL Server 2025 (RTM-CU10), 17.0.5035.5, Enterprise Developer Edition (64-bit) on Linux.
- A database `sa_scratch_sel` with a table `dbo.proof (i int)` holding one row. Before each try I put the table back to one row.
- A throwaway script ran `createConnectorSqlRunner` from source with `tsx` (ruling R5). It gave the runner a fake `connectors` object of type `microsoft-sql` that pointed at the scratch server. So the real `validateSelectSql`, `planPagination` and `createConnectorDb` code ran against a real server.
- After each try I counted the rows of `dbo.proof` with `sqlcmd` inside the same container.
- No OpenLDR server, no CLI and no Postgres were started. The operator's two SQL Server containers were not used.

## Tries through the runner

The check passed every statement below. "Sent" is `planPagination(...).sql`, the exact text the runner gave the driver.

| Try | Statement | What the runner sent | What happened |
|-----|-----------|----------------------|---------------|
| H1 | `SELECT 1 AS x EXEC('insert into dbo.proof values (2)')` | `set rowcount 10000; SELECT 1 AS x EXEC('insert into dbo.proof values (2)'); set rowcount 0` | The runner returned `[{"x":1}]`. The table went from 1 row to 2. The insert ran. |
| H1, second shape | `SELECT 1 AS x EXEC sp_executesql N'insert into dbo.proof values (3)'` | `set rowcount 10000; SELECT 1 AS x EXEC sp_executesql N'insert into dbo.proof values (3)'; set rowcount 0` | The runner returned `[{"x":1}]`. The table went from 1 row to 2, with the new row 3. The insert ran. |
| H2 | `SELECT '--' AS x; DELETE FROM dbo.proof` | `set rowcount 10000; SELECT '--' AS x; DELETE FROM dbo.proof; set rowcount 0` | The runner returned `[{"x":"--"}]`. The table went from 1 row to 0. The delete ran. |
| A word that is not reserved | `SELECT * FROM dbo.proof p DISABLE TRIGGER ALL ON dbo.proof` | `set rowcount 10000; SELECT * FROM dbo.proof p DISABLE TRIGGER ALL ON dbo.proof; set rowcount 0` | SQL Server refused it: `Incorrect syntax near 'DISABLE'.` The trigger stayed on and the table kept its row. |

Before the last try I made a trigger that does nothing, `dbo.proof_noop`, so there was something to turn off. I then tried the same idea with `sqlcmd`, outside the runner:

- `SELECT * FROM dbo.proof DISABLE TRIGGER ALL ON dbo.proof` failed with error 156 near `TRIGGER`. SQL Server read `DISABLE` as a table alias.
- `SELECT 1 AS x DISABLE TRIGGER ALL ON dbo.proof` failed with error 102 near `DISABLE`.
- `SELECT 1 AS x ENABLE TRIGGER ALL ON dbo.proof` failed with error 102 near `ENABLE`.
- `SELECT 1 AS x; DISABLE TRIGGER ALL ON dbo.proof` ran and turned the trigger off.

So on this server `DISABLE TRIGGER` could not follow a SELECT without a semicolon in the three positions I tried: after a table alias, after a table name, and after `AS x`. `ENABLE TRIGGER` could not either, in the one position I tried, after `AS x`. Once 4.1 stops a semicolon hiding behind a string, the semicolon rule already catches them. The pair rule in 4.2 then catches nothing more. It refuses no working query either, because `trigger` is reserved. Keeping it costs nothing.

## The words of spec 4.2

Each word W ran as `SELECT 1 AS W` with `sqlcmd`. A reserved word fails with this error, here for `exec`:

```
Msg 156, Level 15, State 1, Line 1
Incorrect syntax near the keyword 'exec'.
```

Every refusal below was error 156 with that sentence and the word. For `set`, `sqlcmd` printed the 156 error twice.

| Word | In the 4.2 list | SQL Server |
|------|-----------------|------------|
| `exec` | yes | refused |
| `execute` | yes | refused |
| `waitfor` | yes | refused |
| `dbcc` | yes | refused |
| `backup` | yes | refused |
| `restore` | yes | refused |
| `shutdown` | yes | refused |
| `kill` | yes | refused |
| `deny` | yes | refused |
| `declare` | yes | refused |
| `set` | yes | refused |
| `reconfigure` | yes | refused |
| `begin` | yes | refused |
| `commit` | yes | refused |
| `rollback` | yes | refused |
| `save` | yes | refused |
| `if` | yes | refused |
| `while` | yes | refused |
| `print` | yes | refused |
| `raiserror` | yes | refused |
| `goto` | yes | refused |
| `return` | yes | refused |
| `open` | yes | refused |
| `close` | yes | refused |
| `deallocate` | yes | refused |
| `checkpoint` | yes | refused |
| `bulk` | yes | refused |
| `writetext` | yes | refused |
| `updatetext` | yes | refused |
| `readtext` | yes | refused |
| `load` | yes | **accepted** |
| `dump` | yes | **accepted** |
| `setuser` | yes | refused |
| `revert` | yes | refused |
| `add` | yes | refused |
| `use` | yes | refused |
| `openquery` | yes | refused |
| `openrowset` | yes | refused |
| `opendatasource` | yes | refused |
| `openxml` | yes | refused |
| `fetch` | no, kept allowed | refused |
| `end` | no, kept allowed | refused |
| `plan` | no, follows `use` | refused |
| `trigger` | no, in a pair | refused |
| `enable` | no, in a pair | accepted |
| `disable` | no, in a pair | accepted |
| `next` | no, in a pair | accepted |
| `value` | no, in a pair | accepted |
| `hint` | no, follows `use` | accepted |
| `send` | no | accepted |
| `receive` | no | accepted |
| `move` | no | accepted |
| `throw` | no | accepted |
| `go` | no | accepted |

More on `load` and `dump`. A table `dbo.load (load int, dump int)` was created, and `select load, dump from dbo.load` returned its row. I tried one statement form of each. `dump database sa_scratch_sel to disk = ...` and `load database sa_scratch_sel from disk = ...` both failed with error 156 near `database`. Other forms may exist. An accepted alias does not prove a word cannot start a statement, as `throw` and `send` show. The plan needs only "not reserved", and that part is direct. So refusing them would block a working query.

`fetch` and `end` are reserved, but 4.2 keeps them allowed on purpose. That is right, because the next section shows `OFFSET ... FETCH` and `CASE ... END` working.

## What 4.2 must keep allowing

I ran each Review Focus 1 line as a real query. The table `dbo.rf (id int, [open] int, open_date date)` held two rows. All nine returned rows with `sqlcmd`. Seven also went through the runner, which passed them and returned the same rows. The runner ran today's check, which has no 4.2 rule. So the Runner column shows only that the server returns rows. Task 3's tests are what show the 4.2 rule lets these through.

| Line | Query | sqlcmd | Runner |
|------|-------|--------|--------|
| `[open]` | `SELECT [open] FROM dbo.rf` | 2 rows | 2 rows |
| `open_date` | `SELECT open_date FROM dbo.rf` | 2 rows | 2 rows |
| `##open` | `create table ##open (i int); insert into ##open values (7); SELECT i FROM ##open; drop table ##open` | 1 row | not tried |
| `@set` | `EXEC sp_executesql N'SELECT id FROM dbo.rf WHERE id = @set', N'@set int', @set = 1` | 1 row | not tried |
| `'please exec this'` | `SELECT 'please exec this' AS note, id FROM dbo.rf` | 2 rows | 2 rows |
| `-- exec later` | `SELECT id FROM dbo.rf -- exec later` | 2 rows | 2 rows |
| `OPTION (USE HINT('...'))` | `SELECT id FROM dbo.rf OPTION (USE HINT('DISABLE_OPTIMIZER_ROWGOAL'))` | 2 rows | 2 rows |
| `OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY` | `SELECT id FROM dbo.rf ORDER BY id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY` | 2 rows | 2 rows |
| `CASE ... END` | `SELECT CASE WHEN id = 1 THEN 'one' ELSE 'other' END AS c FROM dbo.rf` | 2 rows | 2 rows |

A temp table lives only in the session that made it, and the runner opens a new session for each query. So `##open` ran with `sqlcmd` only. A variable such as `@set` needs a value from somewhere. I gave it a bound value through `sp_executesql`, the way a driver sends a parameter. The runner sends no parameters, so that line was not sent through it.

## Something the next tasks should know

With `-- exec later` at the end, the runner sent `set rowcount 10000; SELECT id FROM dbo.rf -- exec later; set rowcount 0`. The line comment swallows the runner's own `; set rowcount 0`.

I tried whether the row cap then stays on the session. A fresh scratch server held a table `dbo.cap (id int)` with exactly 3 rows. A script sent five requests in order on one `ConnectorDb` from `createConnectorDb`, the real driver path. The four that return rows each printed `@@SPID` 59. Request d returns no rows, so it printed no session id. I ran the five twice and got the same output both times.

| Request | Rows returned |
|---------|---------------|
| a. `SELECT id, @@SPID AS spid FROM dbo.cap` | 3 |
| b. `set rowcount 1; SELECT id, @@SPID AS spid FROM dbo.cap -- a note; set rowcount 0` | 1 |
| c. `SELECT id, @@SPID AS spid FROM dbo.cap` | 3 |
| d. `set lock_timeout 1234` | 0 |
| e. `SELECT @@LOCK_TIMEOUT AS t, @@SPID AS spid` | 1, with `t` = -1 |

Request b returned 1 row, so its cap was in force for its own query. Request c returned all 3 rows on the same session. So the row cap was not in force on the next request, even with its reset swallowed. A `set lock_timeout 1234` sent as its own request was not in force on the next request either. Request e read `@@LOCK_TIMEOUT` as -1.

That try alone has two possible causes. Each `db.query` takes a connection from the pool and gives it back after the request. This store resets a connection when it is given back (`resetConnectionsOnRelease: true`, `packages/adapter-mssql-store/src/index.ts:44`, run by Kysely at `mssql-driver.js:57-62`). The other cause is the way each request is sent. Kysely runs every query with `execSql` (`kysely@0.28.17`, `dist/cjs/dialect/mssql/mssql-driver.js:130`). Tedious sends that text as the `statement` parameter of `sp_executesql` (`tedious@18.6.2`, `lib/connection.js:1638-1660`).

So I tried again inside one transaction, where the connection is not given back between requests. A fresh scratch server held `dbo.cap` with 3 rows. A script built the store with `createMssqlStore` and the settings `createConnectorDb` uses, then sent six separate requests inside one `store.db.transaction()`. I ran it three times. Requests a to e printed the same output each time. Request f was added in the third run only. The requests that return rows each printed session 57. Requests a and c return no rows, so they printed no session id.

| Request | Rows returned |
|---------|---------------|
| a. `set lock_timeout 1234` | 0 |
| b. `SELECT @@LOCK_TIMEOUT AS t, @@SPID AS spid` | 1, with `t` = -1 |
| c. `set rowcount 1` | 0 |
| d. `SELECT id, @@SPID AS spid FROM dbo.cap` | 3 |
| e. `SELECT @@TRANCOUNT AS trancount, @@SPID AS spid` | 1, with `trancount` = 1 |
| f. `set lock_timeout 1234; SELECT @@LOCK_TIMEOUT AS t, @@SPID AS spid` | 1, with `t` = 1234 |

Request e shows the transaction was still open. Request f shows the `SET` works inside its own request. Yet b read -1 and d returned all 3 rows. No connection went back to the pool between them, so no reset ran. So the request's own scope ended each setting. That points to `sp_executesql` as the cause, both outside a transaction and inside one.

One result for Task 5 follows from this. `runReadQuery` sends `set lock_timeout` as its own request and the query after it, inside one transaction (`packages/dashboards/src/sql-runner.ts:303-307` after the change; `set lock_timeout` is line 305). By this try, that lock timeout is not in force when the query runs. I did not run `runReadQuery` itself.

Any text that 4.4 adds after the person's SQL in the same request can be swallowed by a trailing line comment, a roll-back included. A roll-back sent as its own request is not.

## What I did not try

- The two holes on the dashboards runner (`runReadQuery`). It uses the same check and the same wrapper, but I did not send anything through it.
- H3 (`OPENQUERY` and the like) and H4 (a token inside quotes). The brief did not ask.
- `SELECT NEXT VALUE FOR dbo.seq` and whether it moves a sequence on.
- Whether `THROW`, `SEND`, `RECEIVE`, `MOVE`, `GET CONVERSATION GROUP` or `END CONVERSATION` can follow a SELECT without a semicolon. I did not test `get` or `conversation` as bare names either.
- `ENABLE TRIGGER` or `DISABLE TRIGGER` after a closing parenthesis, a string, a `WHERE` expression or an `ORDER BY`. I also did not run `ENABLE TRIGGER` after a semicolon.
- Any other statement word as a second statement without a semicolon. Only `EXEC` was shown running that way. `WAITFOR`, `BACKUP`, `SHUTDOWN` and the other H1 words were not tried. The plan does not need it, because 4.2 refuses the reserved words anyway.
- `OPTION (USE PLAN ...)` as a working query. Only `USE HINT` was run.
- Microsoft's published reserved keyword list. I checked the words on the server only.
- A trailing line comment on the Postgres or MySQL arm of the wrapper, or any Postgres or MySQL connector.

## After the change

Date: 2026-11-15. Task 9 of the same plan, at `b8f2d10d`.

The holes are closed on a real SQL Server 2025 and a real Postgres 16, through the product. Every hole statement was refused with its fixed sentence and `dbo.proof` never changed. A write sent below the check was rolled back on SQL Server and refused on Postgres, and a person sees their own conversion error. Three things did not go as expected. A wrong password fails with the right sentence, but after 30 s and about 120 failed logins, not at once. The lock timeout that `runReadQuery` asks for is not in force. A lone carriage return ends a SQL Server `--` comment, so the reader's refusal of it is needed.

Counts: 55 rows in the tables below. 53 PROVEN, 2 DISPROVEN (D7 and the second F3 row), 0 NOT TESTED. What I did not try is listed at the end.

### How I ran it

- My own SQL Server container from `mcr.microsoft.com/mssql/server:2025-latest`, port bound to 127.0.0.1 only, no volume. It reported 17.0.5035.5 (RTM-CU10), Enterprise Developer Edition, on Linux. Database `sa_scratch_sel`: `dbo.proof (i int)` with one row 1, a trigger that does nothing (`dbo.proof_noop`), and `dbo.rf (id int, [open] int, open_date date)` with two rows.
- My own Postgres container from `postgres:16-alpine`, already on the machine, port bound to 127.0.0.1 only, no volume. It held the scratch OpenLDR's internal database and the database a Postgres connector read (`proof (i int)`, one row).
- Scripts called `createConnectorDb` and `runReadQuery` from source with `tsx`, under `env -i`.
- A scratch OpenLDR on 127.0.0.1:3992, started from this worktree under `env -i` with `OPENLDR_SKIP_ENV_FILE=true`, its own database settings, `AUTH_DEV_BYPASS=true` and file blob storage in a temp folder. **Its target store was SQL Server**, a second database in my own SQL Server container. So builder dashboards, SQL widgets and the workflow SQL Query node ran through `runReadQuery` on SQL Server.
- Every CLI call carried `--server-url http://127.0.0.1:3992` and had `OPENLDR_URL` set to the same. The first, `plugin list`, showed up in my server's log as `POST /api/cli/run` on host 127.0.0.1:3992 before any changing call.
- Query page tries went to `POST /api/query/run`, the call the page makes. The Copy tab tries used the Browser pane on 127.0.0.1:3992.
- No request went to port 3000. The dev Postgres on 5433 and the operator's two SQL Server containers were not used. Port 3000, 5433 and 8180 listened before and after.

In the tables a code point is written `<XXXX>`.

### A. The record

| Item | What was done | Result |
|------|---------------|--------|
| A1 | The line cited `sql-runner.ts:113-126`. | Now cites `sql-runner.ts:303-307`, where `runReadQuery` sends `set lock_timeout` (line 305). |

### B. How SQL Server ends a `--` comment

Sent through `createConnectorDb(...).query`: `SELECT 1 AS a --x<ch>, 2 AS b`. One column means `<ch>` is part of the comment. Two means it ended the comment.

| Item | `<ch>` | Columns back | Reader on `mssql` | Verdict |
|------|--------|--------------|-------------------|---------|
| B1 | `<000D>` alone | **2** | refuses | PROVEN: it ends the comment |
| B2 | `<000B>` | 1 | refuses | PROVEN: part of the comment |
| B3 | `<000C>` | 1 | refuses | PROVEN: part of the comment |
| B4 | `<0085>` | 1 | refuses | PROVEN: part of the comment |
| B5 | `<2028>` | 1 | refuses | PROVEN: part of the comment |
| B6 | `<2029>` | 1 | refuses | PROVEN: part of the comment |
| B7 | `<0000>` | 1 | refuses | PROVEN: part of the comment |
| B8 | `<001C>`, `<001D>`, `<001E>` | 1 each | refuses | PROVEN: part of the comment |
| B9 | `<000A>` | 2 | passes | PROVEN: the control |

Three more sends settle B1 and B7. `SELECT 1 AS a --x<0000><000A>, 2 AS b` gave 2 columns, so a NUL does not cut the text. `SELECT 1 AS a<0000>, 2 AS b` gave 2 columns, so a NUL in code reads as a space. `SELECT 1 AS a --x<000D>` at the very end gave 1 column, and `--x<000D><000A>` then `, 2 AS b` gave 2.

What this decides. SQL Server ends a `--` comment at a lone carriage return, the way Postgres does. The reader refuses a lone carriage return in a SQL Server line comment. That refusal keeps the check honest: without it the reader would blank text that SQL Server runs. The refusal of B2 to B8 is stricter than needed, because SQL Server keeps each of those inside the comment. Keeping it refuses only a query with such a character in a comment.

### C. Numbers and words on SQL Server

| Item | Sent | What came back | Reader on `mssql` | Verdict |
|------|------|----------------|-------------------|---------|
| C1 | `SELECT 1FROM dbo.proof` | 1 row, one column with no name, value 1 | passes | PROVEN |
| C2 | `SELECT 0xADD AS b` | 1 row, `b` = bytes 0x0ADD | passes | PROVEN |
| C3 | `SELECT 0x1G FROM dbo.proof` | 1 row, a column named `G` = bytes 0x01 | passes | PROVEN: `G` is the name, `0x1` the value |
| C4 | `SELECT 0x1FROM dbo.proof` | error 102, `Incorrect syntax near 'dbo'.` | passes | PROVEN: the rule's reading holds. `SELECT 0x1FROM` alone gave a column named `ROM` = 0x1F. |
| C5 | `SELECT 1 AS x <FF25><FF38><FF25><FF23> sa_scratch_no_such_proc` | error 102, incorrect syntax near the fullwidth word | passes | PROVEN: a name, not `EXEC`. `SELECT 1 AS <FF25><FF38><FF25><FF23>` gave a column of that name. The control with a plain `EXEC` gave error 2812, no such procedure. |
| C6 | `SELECT 1 AS x DISABLE<001F>TRIGGER ALL ON dbo.proof` | error 102 near `DISABLE`; trigger still on | refuses | PROVEN: `<001F>` is a space. `SELECT 1<001F>AS<001F>x` gave column `x`, and `SELECT 1 AS x; DISABLE<001F>TRIGGER ALL ON dbo.proof` turned the trigger off. I turned it back on and checked it. |

### D. The roll-back on SQL Server

| Item | Sent | What came back | Verdict |
|------|------|----------------|---------|
| D1 | `queryReadOnly('INSERT INTO dbo.proof VALUES (9)')`, below the check | no error; table still 1 row, no 9 | PROVEN |
| D2 | `queryReadOnly` with `CREATE TABLE dbo.sel_t9_made (i int); INSERT ...; SELECT COUNT(*) AS made ...` | `made` 1; afterwards `OBJECT_ID('dbo.sel_t9_made')` null | PROVEN |
| D3 | `queryReadOnly("SELECT CAST('x' AS int)")` | error EREQUEST 245, the conversion error, not 3903 | PROVEN |
| D4 | after D3, on the same `ConnectorDb` | `queryReadOnly('SELECT 1 AS ok')` gave 1; `query('SELECT @@TRANCOUNT')` gave 0. A second run showed session 78 before D3, after it, and for the 0. | PROVEN |
| D5 | `runReadQuery` on a Kysely handle from `createMssqlStore` with the store's settings; then through the product, a SQL widget on the SQL Server target store | insert: no error, no row 9. Made table: gone. CAST: error 245. Next read: works; on the store's own handle, session 78 read `@@TRANCOUNT` 0 after the failed one. Through the product: CAST gave the conversion error, then `SELECT COUNT(*)` worked and `@@TRANCOUNT` read 1 inside its own transaction. | PROVEN |
| D6 | 100 runs each of `SELECT TOP 1 * FROM dbo.proof`, one `ConnectorDb`, both orders | see the figures | PROVEN |
| D7 | another session held a lock on `dbo.proof` (`begin tran; update dbo.proof set i = i; waitfor delay '00:00:25'`); `runReadQuery('SELECT * FROM dbo.proof')` with `timeoutMs` 2000 and no deadline | waited 15057 ms, then `Timeout: Request failed to complete in 15000ms` (code ETIMEOUT), the driver's own request timeout. Control: `set lock_timeout 2000; SELECT * FROM dbo.proof` in one request gave error 1222 after 2008 ms. | DISPROVEN |

D7 is older code and is not fixed here. The `set lock_timeout` that `runReadQuery` sends as its own request is not in force for the query after it, as Task 1's run predicted. On the product paths a deadline (`withDeadline`) may stop the wait sooner. I did not try that.

### E. Postgres

| Item | Sent | What came back | Verdict |
|------|------|----------------|---------|
| E1 | `queryReadOnly('INSERT INTO proof VALUES (9)')` | error 25006, `cannot execute INSERT in a read-only transaction`; no row 9 | PROVEN |
| E2 | on a database set to `standard_conforming_strings = off`: `SHOW standard_conforming_strings` | `query`: off. `queryReadOnly`: on. `query` again: off. | PROVEN |
| E3 | `SELECT 1 AS a --x<000D>, 2 AS b` and `SELECT 1 AS a --x<2028>, 2 AS b` | 2 columns and 1 column, through `query` and `queryReadOnly` | PROVEN |
| E4 | `SELECT pg_sleep(20)` on the Query page; at 4 s, `pg_terminate_backend` on that one backend, found in my container by database name and query text | the person got 400 `terminating connection due to administrator command` after 4094 ms. `/health` answered 200 twice, the next query ran, and the log has no warning or error for it. | PROVEN |
| E5 | `SELECT i FROM proof -- note` on the Query page | 200, 1 row, `total` 1 | PROVEN |

### F. Through the product

All on the scratch server's Query page call unless the row says otherwise. After every F1 request `sqlcmd` counted `dbo.proof`: 1 row, sum 1, every time.

| Item | Sent | What came back | Verdict |
|------|------|----------------|---------|
| F1 | `SELECT 1 AS x EXEC('insert into dbo.proof values (2)')` | 400, `only read-only SELECT queries are allowed on SQL Server (statement words such as EXEC are refused; put a name that is such a word in [brackets])` | PROVEN |
| F1 | `SELECT 1 AS x EXEC sp_executesql N'insert into dbo.proof values (3)'` | 400, the same sentence | PROVEN |
| F1 | `SELECT '--' AS x; DELETE FROM dbo.proof` | 400, `only a single statement is allowed` | PROVEN |
| F1 | `SELECT * FROM OPENQUERY(sa_scratch_link, 'delete from dbo.proof')` | 400, the SQL Server sentence. No linked server existed. | PROVEN |
| F1 | `SELECT 1WAITFOR DELAY '00:00:01'` | 400, the SQL Server sentence, in 3 ms | PROVEN |
| F1 | saved query `SELECT * FROM dbo.proof WHERE i = '{{param.x}}'`, text parameter `x` = 1 | 400, `a {{param.x}} sits inside quotes, a comment or a quoted name: remove the quotes; the value is quoted for you`. Saving it was allowed. Without the quotes it returned 1 row. | PROVEN |
| step 4 | `SELECT CAST('x' AS int)` | 400, `Conversion failed when converting the varchar value 'x' to data type int.` | PROVEN |
| F2 | `[open]`, `open_date`, `'please exec this'`, `-- exec later`, `OPTION (USE HINT('DISABLE_OPTIMIZER_ROWGOAL'))`, `OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`, `CASE ... END`, each against `dbo.rf` as in Task 1 | 200, 2 rows each | PROVEN |
| F2 | `SELECT i FROM ##open`, while another session held a global temp table `##open` | 200, 1 row, 7 | PROVEN |
| F2 | `SELECT id FROM dbo.rf WHERE id = @set` | passed the check; SQL Server answered `Must declare the scalar variable "@set".` Nothing on this page binds a variable. | PROVEN: not refused by the check |
| F2 | `SELECT 0xADD AS b` | 200, bytes 0x0ADD | PROVEN |
| F3 | a second connector to my SQL Server with a wrong password, plugin allowed, `import copy start` | the copy failed with `the source refused the login`, and the Copy tab showed `Last error: the source refused the login` | PROVEN |
| F3 | the same copy: does it fail at once? | no. Started 12:11:40.373 UTC, failed 12:12:12.976 UTC, 32.6 s. My SQL Server logged 122 failed logins for it. The error the reader got: constructor `TimeoutError`, name `Error`, no code, no number, no cause, after 30002 ms. | DISPROVEN |
| F4 | widget preview, raw SQL on, `SELECT {{word}} AS v` with `word` = `it's a \ {{word}}` | 200, `v` = `it's a \ {{word}}`, as the plain literal `SELECT 'it''s a \ x' AS v` gave `it's a \ x` | PROVEN |
| F4 | `SELECT '{{word}}' AS v` | refused with the token sentence | PROVEN |
| F5 | typed SQL `SELECT * FROM dbo.proof` | 200, 1 row | PROVEN |
| F5 | saved query `SELECT i FROM dbo.proof WHERE i = {{param.x}}`, saved, then run with `x` = 1 | 200, 1 row | PROVEN |
| F5 | report "Test Volume Over Time" for 2026 | 200, 2 rows, first `2026-06`, `Full blood count`, 2 | PROVEN |
| F5 | builder widget: count of `service_requests` by `status` | 200, 2 rows, first `final` 2 | PROVEN |
| F5 | the sample dashboard's first SQL widget, its stored template, with a period filter | 200, value 3. With `from` = `2027-01-01' OR 1=1 --` or `2027-01-01' /*` it gave 0, the same as a plain `2027-01-01`. | PROVEN |
| F5 | workflow: manual trigger, then a SQL Query node (`SELECT COUNT(*) AS n FROM lab_requests`) and a Microsoft SQL Database node (`SELECT i FROM dbo.proof`) | both nodes succeeded, `n` 3 and `i` 1 | PROVEN |

On F3: the pool tries the login about four times a second until its 30 s wait for a connection runs out. Only then does the reader get an error, a `TimeoutError` with no code, which `describeSourceError` turns into the right sentence. The person waits 30 s. A server that locks a login after some failed tries would lock it. The spec said "fails at once". This is the connection pool's behaviour, not the code this plan wrote.

On F5: the warehouse was empty at first. The server's own projection into a SQL Server warehouse failed (see below), so I put three rows into the warehouse's `lab_requests` table with `sqlcmd`. The first run, on the empty warehouse, also succeeded on every path, with 0 rows.

Which runner served each F5 path here: the Query page, the saved query, the report and the Database node used `createConnectorSqlRunner` and `queryReadOnly`. The builder widget, the SQL widget and the SQL Query node used `runReadQuery` on the SQL Server target store.

### G. The Copy tab, in a real browser

The page sits in an iframe with `sandbox="allow-scripts"`. Neither page script nor the accessibility tree can see inside it, so I judged focus by the focus ring in each picture.

| Item | What was done | What I saw | Verdict |
|------|---------------|------------|---------|
| G1 | desktop, 1280 by 800, Start menu open | the menu's one item, Start copy, on screen beside the first row. Picture `task-9-copy-desktop.png` in the notes folder. | PROVEN |
| G1 | phone, 375 by 812, Start menu open | the first row holds the heading and the dots button with no overflow. The item is on screen. It reads Continue copy, because this connector now had a failed copy. Picture `task-9-copy-phone.png`. | PROVEN |
| G2 | keyboard: Enter on the dots button, then Tab | the menu opened with the ring on Start copy. Tab closed it and moved focus to the Site time zone field, the next field after the menu. | PROVEN |
| G2 | Enter on Start copy, with my Postgres paused for 9 s so the start stayed out | the line "Starting" (with a U+2026 ellipsis) showed under the connector list, and the dots button went dim | PROVEN |
| G2 | after the start succeeded, where is focus? | no ring anywhere. The dots button is disabled while the copy is live, so it lost focus. One Tab then reached Site time zone. The button before this plan was disabled during a start too (`30b3b29f`, `CopyPanel.tsx:356`), so this is not new. | PROVEN |
| G3 | Tab from the open menu to From date, then ArrowUp, ArrowUp, ArrowDown, then Escape | the month read 01, 02, then 01. After Escape the field kept focus and its value. The Tab had already closed the menu, so this shows that a closed menu takes no keys. | PROVEN |
| G4 | does the form move while "Starting" shows? | yes. "Copy options" moved down about 31 CSS px at 1280 wide, and back up when the line emptied. | PROVEN: it moves |

### The figures

- D6, 100 runs each of `SELECT TOP 1 * FROM dbo.proof` on one `ConnectorDb`, after 5 warm-up runs of each:
  - `query` first: `query` median 1.51 ms, worst 2.33 ms. `queryReadOnly` median 2.06 ms, worst 4.24 ms.
  - `queryReadOnly` first: `queryReadOnly` median 1.92 ms, worst 4.24 ms. `query` median 1.24 ms, worst 6.22 ms.
  - So the transaction adds about 0.6 ms a run. A Query page run took about 55 ms end to end.
- D7: the lock wait lasted 15057 ms against 2000 ms asked. The control stopped at 2008 ms.
- F3: 32.6 s from start to failed, 122 failed logins. My own `createConnectorDb` try: 30002 ms, 118 failed logins.
- E4: the person's error came 4094 ms after the request.
- G4: about 31 CSS px.

### Seen, and not part of this plan

- On a SQL Server target store the server's projection failed at boot: `projection failed; durable retry scheduled`, `Incorrect syntax near the keyword 'use'.`, from `mergeBatchMssql` (`packages/db/src/batch-upsert.ts:55`). It repeated 11 times during the run. So a fresh server with a SQL Server warehouse showed no sample rows.
- `POST /api/dashboards/query` answers a refused template, and the older single-statement refusal, with HTTP 500 rather than 400 (`mapError`, `apps/server/src/dashboards-routes.ts:198-201`). The sentence is right, and the log holds no SQL.

### What was not tried

- MySQL. There is no MySQL server on this machine without a download. Nothing about MySQL is proven on a real server.
- `OPENQUERY` through a real linked server. None was made. The text was refused before it ran, so no linked server was needed to show that.
- A real phone. The phone picture is the Browser pane at 375 by 812.
- Whether a product deadline (`withDeadline`) shortens the D7 lock wait.
- G3 with the menu still open while a date field takes keys. The Tab closes the menu first, so that state does not come up from the keyboard.
- A Postgres target store for the scratch server. Its warehouse was SQL Server. The Postgres side of `runReadQuery` was not run.
