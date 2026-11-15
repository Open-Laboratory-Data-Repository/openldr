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

So on this server, in the three positions I tried, `ENABLE TRIGGER` and `DISABLE TRIGGER` could not follow a SELECT without a semicolon. Once 4.1 stops a semicolon hiding behind a string, the semicolon rule already catches them. The pair rule in 4.2 then catches nothing more. It refuses no working query either, because `trigger` is reserved. Keeping it costs nothing.

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

I tried whether the row cap then stays on the session. A fresh scratch server held a table `dbo.cap (id int)` with exactly 3 rows. A script sent five requests in order on one `ConnectorDb` from `createConnectorDb`, the real driver path. Each printed `@@SPID`, and all five ran on the same session, 59. I ran the five twice and got the same output both times.

| Request | Rows returned |
|---------|---------------|
| a. `SELECT id, @@SPID AS spid FROM dbo.cap` | 3 |
| b. `set rowcount 1; SELECT id, @@SPID AS spid FROM dbo.cap -- a note; set rowcount 0` | 1 |
| c. `SELECT id, @@SPID AS spid FROM dbo.cap` | 3 |
| d. `set lock_timeout 1234` | 0 |
| e. `SELECT @@LOCK_TIMEOUT AS t, @@SPID AS spid` | 1, with `t` = -1 |

Request b returned 1 row, so its cap was in force for its own query. Request c returned all 3 rows on the same session. So the row cap did not outlive its request, even with its reset swallowed. A `set lock_timeout 1234` sent as its own request was not in force for the next request on the same session. Request e read `@@LOCK_TIMEOUT` as -1, the server's default.

The driver shows how each request is sent. Kysely runs every query with `execSql` (`kysely@0.28.17`, `dist/cjs/dialect/mssql/mssql-driver.js:130`). Tedious sends that text as the `statement` parameter of `sp_executesql` (`tedious@18.6.2`, `lib/connection.js:1638-1660`). Requests c and e fit that. The `SET` in requests b and d ended with its own request.

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
