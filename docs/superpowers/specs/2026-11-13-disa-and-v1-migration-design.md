# DISA and OpenLDR v1 migration in CE: design

Status: order approved by the operator on 2026-11-13. Part 1 is ready to build after design C
is merged. Parts 2 to 4 are not designed yet. No code written.
Date: 2026-11-13.
Replaces the route in: `docs/cdr-source-plugin-scoping.md` and
`2026-07-16-cdr-fhir-ingest-to-ce-design.md`. Both describe moving data with `cdr-toolchain`.
Depends on: `2026-11-13-cli-through-the-app-design.md` (design C), which changes how CLI
commands run and claims internal migration 117.

## 1. What this is and why

Zambia and Mozambique have to move their lab history into CE. Each holds about 45 million
requests and about 165 million results. The tool they use today is `cdr-toolchain`, a
separate repository. It is failing in two ways.

- It moves about one request every 4 seconds. At that rate Zambia needs 5.7 years.
- It stops when the link cuts, and a person has to restart it by hand. The links cut often.

The operator's words on 2026-11-13: "we need to stop supporting what's failing and come up
with something better." And: "go with everything on ce and lets stop updating the cdr
toolchain."

This design moves the whole job into CE. CE copies the source rows to its own disk first,
with retries, and does every later step on that local copy.

The user action that is broken today: a country team cannot finish a migration, and cannot
leave one running unattended.

Words used in this document:

- **Source.** A database CE reads from. Here that is DISA*Lab or OpenLDR v1, both on SQL
  Server 2014.
- **Copy.** The rows CE has read from a source, stored on the CE server exactly as read.
- **Set.** One group of rows a plugin asks CE to copy. A set has its own paging key.
- **Twin.** The v1 record that holds the same request as a DISA record.
- **Held back.** A record that failed a check and was not saved to CE.

"v2" and "CE" are the same product. Older documents use "v2".

## 2. Gap check

| Claim | Verdict | Proof |
|---|---|---|
| An import does not retry after an error | CONFIRMED | Any error ends the run as `failed` (`packages/bootstrap/src/import-run.ts:325` to `:329`) |
| An import does not carry on after a server restart | CONFIRMED | A run nobody drives reads as `interrupted` (`import-run.ts:224` to `:229`). Only `resume` restarts it (`:502`) |
| Source rows are not kept | CONFIRMED | A page is read, mapped and saved in one pass (`import-run.ts:289` to `:309`) |
| An import reads one connector | CONFIRMED | A run has one `connectorId` (`import-run.ts:44`). The manifest names connector types only (`packages/marketplace/src/artifact-manifest.ts:54`) |
| A run started from the CLI is driven by the CLI process | CONFIRMED | `follow` waits on a run in its own process (`packages/cli/src/import.ts:128`). Under design C that process is a child of the server and is interrupted when the caller leaves (`2026-11-13-cli-through-the-app-design.md:279`) |
| One query may run for 30 seconds at most | CONFIRMED | `createConnectorDb` refuses a longer limit (`packages/bootstrap/src/connector-db.ts:71`) |
| Binary columns reach the plugin intact | CONFIRMED | Bytes are sent as base64 (`packages/bootstrap/src/import-sql.ts:79`) |
| CE cannot read SQL Server 2014 | REFUTED by reading, not by a run | The version list covers the analytics target only (`packages/adapter-mssql-store/src/supported-versions.ts:21`). The v1 importer pages with `TOP` (`wasm/openldr-v1-import/src/queries.rs:160`). The toolchain reads the same servers with the same driver |
| The 4 seconds per request comes from data size | REFUTED by the toolchain's own notes, not measured in Zambia | One lab costs about 110 round trips, one after another (`cdr-toolchain/scripts/DIAGNOSTICS.md`, step 1). 110 trips at 35 ms is about 4 seconds |
| A file must be carried between servers | REFUTED | Access is remote only. CE can read each source over the network and keep the rows locally |
| The toolchain holds FHIR mapping to reuse | PARTLY | It maps DISA to its own payload, then to FHIR (`cdr-toolchain/packages/ce-fhir/src/fhir-transform.ts`). This is TypeScript and has to be ported |
| The next internal migration is free | REFUTED | Design C's branch adds 117 (`worktree-cli-through-app`). The number for this work is chosen when it is built |

HONEST NON-PROOF. Nobody has measured the link between the buildings in Zambia. Nobody has
run a CE import against a real 2014 server from this repo. The copy in part 1 is the first
thing that will measure both.

## 3. What the countries look like

From the two assessment documents the operator shared on 2026-11-13.

| | Zambia | Mozambique |
|---|---|---|
| Requests | about 45,000,000 | about 42,000,000 |
| Results | about 165,000,000 | about 161,000,000 |
| Source database | SQL Server 2014 Standard | SQL Server 2014 Standard |
| Server OS | Windows Server 2012. It cannot run Docker | Windows Server 2019 |
| Layout | DISA, v1 and CE sit in three buildings | Many lab installs feed a central one |
| Access | Remote only | Remote only |
| Written into v1 by | DISA Lab, DISA Link, DISA POC | The same, plus GXAlert through Mirth, plus SISLab |

Two consequences.

- Nothing can be installed on the Zambia source servers. CE reads them over the network and
  they only need to accept a SQL login.
- v1 holds records that never passed through DISA. That is certain for GXAlert in
  Mozambique. A migration that starts from DISA will not see them.

## 4. Goals, non-goals, anti-goals

Goals:

- A migration runs unattended. A cut link or a server restart needs no person.
- Reading a source costs a few round trips per page of requests, never a fixed number per
  request.
- A decoder fix or a rule fix is re-run on the local copy. The source is not read again.
- The copy keeps up with a source that is still in use, until v1 is switched off.
- In mode 2, a DISA record is saved only after it matches its v1 twin and passes the audit
  rules.
- A lab administrator can read why a record was held back, with the values, on the
  plugin's page.
- A v1 record with no DISA record is listed for a person to check.
- Every start, stop, resume and delete is in the audit log, and runs show in Activity.
- `cdr-toolchain` is no longer needed once part 4 lands.

Non-goals:

- Mode 3, a migration for a site with neither DISA nor v1. The operator deferred it on
  2026-11-13.
- WHONET. The existing converter plugin takes a WHONET file in a workflow
  (`wasm/whonet-sqlite/src/lib.rs:40`). It is not a database to page through.
- A file that is carried between servers, and a playground install on a source server.
- Zambia's 78 stored procedures, 53 views and SQL Agent jobs. That is business logic, a
  separate piece of work.
- A review process for held-back records. CE shows them. The country team decides who
  fixes the source.
- Tuning how fast CE saves. The operator said this waits until data is flowing and the new
  servers are known.
- Migrating v1-only records in mode 2. They are flagged, not saved.

Anti-goals. Any of these makes the work a failure even if it runs:

- A write of any kind to a source database.
- A source row value in a log line, an audit row or an error message. The copy and the
  held-back view may hold values. Nothing else may.
- The name DISA, a DISA table name, or DISA decoding code inside CE core. Everything
  specific to DISA lives in a separate plugin with a neutral name, shipped through the
  marketplace.
- A mode 2 record saved without its check, because the check was slow, missing or failed
  to run.
- A copy deleted without a person asking for it.
- A clinical code, organism, status or value set written into source or SQL. See
  AGENTS.md section 8.
- A country or system column in the warehouse.
- A run that needs a person after a cut link.

## 5. Constraints

- SQL Server 2014. No `STRING_AGG`, no `TRIM`, no JSON functions. `HASHBYTES` accepts at
  most 8,000 bytes of input on this version.
- One connector query may run for 30 seconds (`connector-db.ts:71`).
- A paging key is printable ASCII, 200 characters at most (`import-sql.ts:19`).
- A plugin cannot open a network connection. CE runs its SELECT statements, each checked
  to be a single SELECT (`import-run.ts:265`).
- A plugin call has 30 seconds and 512 MB (`reference-plugins/openldr-v1-import/manifest.json`).
- Kysely refuses a gap in migration numbers. Check every branch before picking one.
- Design C sends CLI commands through the app. A command's process ends when its caller
  leaves. Nothing that runs for days may live in that process.
- The copy holds patient data in full. The operator's ruling on 2026-11-13: it is the
  country's server, data and deployment, so values may be stored and shown.
- AGENTS.md section 5 for every screen, and section 6 for every part: UI, CLI, docs in en,
  fr and pt, phone layout, changelog after merge.
- The repo has no CI. The local gate in `CLAUDE.md` is the only check.
- Only Linux can be tested on the build machine.

## 6. Approaches

Three ways were weighed on 2026-11-13.

1. **Everything in CE now.** Extend the import service with copy, retry and check steps.
   Port the DISA decoder, the v1 compare and the audit rules to a Rust plugin. One product,
   with the audit log, Activity, CLI and screens. The cost is about 13,700 lines of
   TypeScript to port.
2. **Fix how the toolchain reads, port later.** The fastest relief, with no port. But
   failures stay in files, there is no CE audit trail, and the toolchain lives on.
3. **CE in two steps.** Ship the shared parts with the v1 importer first, then the DISA
   plugin. Useful early, but mode 2 arrives last and the toolchain stays in use meanwhile.

The operator picked 1, and froze the toolchain. All three sites are on the toolchain's DISA
push and it is not working, so keeping it alive buys nothing.

The build order inside option 1 was agreed the same day. It is in section 8.

## 7. The design

### 7.1 Copy first, then check

```
DISA server ──read, retry──┐
                           ├─▶ copy on the CE server ─▶ check ─▶ save to CE
v1 server  ──read, retry───┘     rows as read                │
                                                             └─▶ held back, with reasons
```

- **Copy.** CE reads each source page by page and stores the rows as read. No decoding, no
  checking, no saving to CE. This is the only step that crosses the network.
- **Check.** Runs on the copy. It starts from a DISA record, finds the v1 twin, compares
  them, then applies the audit rules. The operator's rule: the check starts only when both
  copies have finished their first full pass.
- **Save.** A record that passes becomes FHIR and goes through CE's normal save path
  (`import-run.ts:309`).

Why rows as read and not FHIR. The toolchain's briefing says a failed check is usually a
decoder bug on our side. With the raw rows on disk, the decoder is fixed and the check is
run again, locally. With FHIR on disk, every decoder fix would mean reading DISA again.

Why this is fast. The toolchain looks up dictionaries per result parameter, over the link.
The copy reads a page of 500 requests in a handful of queries and reads each dictionary
once. After that, every lookup is local, and the copy can carry any index it needs. DISA is
vendor-controlled, so nobody may add an index there.

### 7.2 The three modes

| Mode | Reads | Check | Status |
|---|---|---|---|
| 1 | v1 only | None. The data has nothing to be checked against | Works today as a one-pass import. Gains retry in part 1 |
| 2 | DISA, with v1 as the reference | v1 twin must match, then audit rules | New. Parts 1 to 4 |
| 3 | Neither | | Deferred |

Zambia runs mode 2. It keeps running until v1 is switched off, then it is retired.

In mode 2 a v1 record with no DISA record is not migrated. CE lists it for a person.

### 7.3 Who holds what

- **CE core** holds everything that is the same for every source: the copy store, the copy
  run with its retries, the check run, the held-back view, the audit entries.
- **A plugin** holds everything about one source: the SELECT statements, the decoder, the
  mapping to FHIR, the compare and the audit rules.
- The v1 plugin stays in this repo (`wasm/openldr-v1-import`).
- The DISA plugin lives in its own repository, under a neutral name, and ships through the
  marketplace. See the open questions in section 11.
- **Every screen for a migration lives on the plugin's own page.** The operator decided this
  on 2026-11-13: "Each plugin should handle its full features itself without having to
  disturb the core functions of openldr_ce." And: "openldr_ce doesn't even know what disa
  it, but it knows plugins." These plugins matter only to sites that have DISA and v1, so
  Studio gets no migration screen of its own. CE core offers operations any plugin page can
  call. The page decides what to show.
- This covers the copy controls in part 1 and the held-back view and the v1-only list in
  part 4.
- The v1 plugin's page in this repo is the reference. The DISA plugin's page starts as a
  copy of it. If the DISA vendor ships an official plugin later, sites use that one, and CE
  core does not change.

### 7.4 What the operator decided about failures

- The held-back view shows the real values from both sides.
- A record stays held back until a later pass reads a corrected version and it passes.
- Workflows do not run for imported records by default. A switch at the start of a save
  turns them on, for people testing with sample data.

## 8. Parts and order

| Part | What it adds | Where |
|---|---|---|
| 1. Copy | Copy store, copy run, retry without a person, carry on after a restart, top-up passes | CE core, the v1 plugin, a query-only DISA plugin |
| 2. DISA plugin | Decoder, mapping to FHIR, audit rules, in Rust | DISA plugin repo |
| 3. Compare | The v1 check, in Rust | DISA plugin repo |
| 4. Check step and screens | Check run on the copy, save from the copy, held-back view, v1-only list, workflows switch | CE core for the operations, each plugin's page for the screens |

The order is 1, then 2 and 3 while the copy runs, then 4.

The copy needs no decoder. A DISA plugin that only supplies SELECT statements is enough to
start it. So the countries start copying as soon as part 1 lands, and the port in parts 2
and 3 happens while 45 million requests cross the link. By the time part 4 lands, the copy
is on disk and the check runs locally.

Each part gets its own design and plan when its turn comes. Parts 2 to 4 need the toolchain
code read first. It was counted for this document and not read.

What has to be ported, counted on 2026-11-13 with tests left out:

| Toolchain code | Lines | Part |
|---|---|---|
| DISA decoder, `packages/disalab/src` | 3,954 | 2 |
| DISA to request payload, `apps/cli/src/export` | 2,355 | 2 |
| Payload to FHIR, `packages/ce-fhir/src` | 1,567 | 2 |
| Audit rules and report writers, `apps/cli/src/audit` | 2,368 | 2, less the report writers |
| Compare against v1, `apps/cli/src/compare` | 3,430 | 3 |
| Command wiring, `apps/cli/src/commands` | 4,568 | Not ported. The import service replaces it |

The Rust port is tested the way the v1 importer was: fixed input files, and expected output
generated from the TypeScript code (`wasm/openldr-v1-import/tests/generate-fixtures.mts`).

## 9. Part 1 in detail

### 9.1 What a plugin declares

`importSource` in the manifest gains one optional field, `entrypoints.copy`, the name of the
entrypoint that returns what to copy. A plugin without it behaves as today.

`entrypoints.queries` and `entrypoints.map` become optional when `copy` is present. A plugin
with `copy` alone can be copied from and cannot run a one-pass import. That is the
query-only DISA plugin of part 1.

The copy entrypoint takes `{ options }` and returns a list of sets:

```json
{ "sets": [
  { "name": "requests",
    "keyQuery": { "sql": "SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM ... WHERE [RequestID] > {{after}} ORDER BY [RequestID]" },
    "detailQueries": [ { "name": "results", "sql": "SELECT [RequestID], ... WHERE [RequestID] IN ({{keys}})" } ] }
] }
```

A set pages by its own key, with the same `{{after}}`, `{{limit}}` and `{{keys}}` tokens an
import uses today. A set with no detail queries copies the key query's own rows, which is
how a dictionary table is copied whole.

The first column of every detail row is its paging key. CE files each row under that key.
The v1 plugin's detail queries already start with `[RequestID]`. A detail row whose first
column is not one of the page's keys is a plugin fault and ends the run as `failed`.

A copy reads one source. The v1 plugin copies v1. The DISA plugin copies DISA and holds no
v1 SQL. So v1 crosses the link once, and both mode 1 and mode 2 use that one copy. Part 4
pairs a DISA copy with a v1 copy for the check.

For the v1 plugin there is one set, `requests`, with the key query it already has
(`queries.rs:160`) and one detail query per table.

A copy's detail query reads every column of its table, with the key first:
`SELECT [RequestID] AS [__key], * FROM ... WHERE [RequestID] IN ({{keys}})`. It does not
reuse the import's column list. Checked on 2026-11-13 against a Mozambique v1 restore: the
Requests table has 63 columns and the import reads 53 (`queries.rs:94`). The ten it skips
include `LIMSVendorCode`, which names the system that wrote the record, and `DateTimeStamp`.
Part 4 needs the first and top-up needs the second. Reading every column also covers a
site whose v1 tables carry columns this repo has never seen.

### 9.2 The copy store

One table of its own in the internal database, `import_copy_rows`. It holds nothing else,
so a database backup can leave its rows out by naming the table.

| Column | Meaning |
|---|---|
| `copy_id` | The plugin and the connector, one value per copy |
| `set_name`, `detail_name` | Which set and which query the row came from |
| `key` | The paging key the row belongs to |
| `seq` | The row's position within its key, in the order the query returned it |
| `row` | The row as JSON, in the same form a plugin receives today |
| `read_at` | When CE read it |

The top-up work in 9.4 adds a change marker column when its method is settled.

Rules:

- One copy per plugin and connector. To copy two databases, make two connectors.
- CE remembers the SQL of each set. When a later start brings different SQL for a set,
  because an option changed or the plugin was upgraded, CE refuses and names the set. The
  person must say "read it again". CE then empties that set and reads it from the start.
  A typed-wrong date must not wipe weeks of copying without a question.
- An option that does not change the SQL, such as the time zone, changes nothing in the copy.
- The query-only DISA plugin of part 1 must read every column parts 2 and 3 will need.
  A column added later means reading that set again over the link.
- A page is written by replacing every row for its keys. Reading a page twice leaves one
  copy of it.
- The rows are written before the paging position is saved. A crash between the two means
  the page is read again, which is harmless.
- The copy reports rows and bytes per set. That is how a country learns its real link
  speed and how much disk it needs.

My call: a plain table, and a delete that the server works through in batches. A partition
per copy would make a delete instant. But every package's tests build the schema on pg-mem,
no migration here uses a partition, and I have not checked that pg-mem can run one.

### 9.3 The copy run

A copy run is an import run of a new kind. It has the same record, the same statuses and
the same audit entries, plus the points below.

- **The server drives it.** A copy runs for days. The server process picks up any copy run
  that needs driving. A CLI command only records the request and then follows progress by
  reading the stored run. Stopping works the same way, as it does today
  (`import-run.ts:494`).
- **It carries on after a restart.** When the server starts, it picks up every copy run
  that was running. No person presses Resume. The audit log records this with the actor
  `system`.
- **It does not touch runs from before this change.** A one-pass run recorded by an older
  version still says `running` when nobody drives it. The server never picks those up.
  Only a run that records the server as its starter is picked up.
- **Taking over is decided by a heartbeat, never by a process id.** The driver writes the
  run every 30 seconds on a timer of its own, even in the middle of a page or a wait. A run
  whose last write is older than 2 minutes has no driver and may be taken. Today a run is
  written only after each page (`import-run.ts:323`), and one page can take longer than
  that, so the timer is required.
- **It retries without a person.** When the source cannot be reached, the run shows
  `waiting` with the last error and tries again. The wait starts at 5 seconds and doubles
  to a ceiling of 5 minutes. It retries until a person stops it.
- **It tells a cut link from a broken query.** A lost connection or a timeout is retried.
  An error the SQL Server itself returned, such as a missing table or a refused login, ends
  the run as `failed`, because retrying cannot fix it.
- **It shrinks a page that is too slow, and only then.** A cut link often shows up as a
  timeout. So after a timeout CE first sends the source a trivial query with a 5-second
  limit. No answer means the link is down, and the run waits as above without changing the
  page size. An answer means the page was too big, and it is halved and read again. Pages
  grow back after pages succeed.
- **A key it cannot read is kept on a list and tried again.** A single key that still times
  out at a page of one is recorded as skipped, with the code `SOURCE_TIMEOUT`, and the run
  moves on. Skipped keys are read again at the end of the pass and at every later start.
  A copy with a skipped key left is shown as complete with a warning, never as clean.
- **It copies set by set.** Each set keeps its own position, so a restart continues in the
  middle of a set.

The one-pass import that exists today gains the same retry rule. A one-pass run started in
the server also carries on after a restart.

### 9.4 Top-up passes

After the first full pass a copy has to pick up new and corrected records, for as long as
the source is in use.

What a top-up must do:

- Read every key that is new since the last pass.
- Read again every key whose rows changed at the source.
- Cost far less than a full pass when little has changed.
- Run on a schedule the administrator sets, and on request.

How it finds changed rows depends on two facts about each source that nobody has checked
yet. They are in section 11. The candidates:

- A column that SQL Server updates on every change. DISA tables carry a `DATESTAMP` column
  (`cdr-toolchain/packages/disalab/src/lib/DisalabData/TESTDATA.ts:74`). If it is a row
  version, a top-up asks for rows above the last value seen.
- A hash of the binary column, computed at the source and compared with the stored marker.
  On 2014 this needs slicing for anything over 8,000 bytes.

What is known for v1, from a Mozambique restore on 2026-11-13. The restore holds generated
data, 557,151 request rows, so it shows the table shapes and nothing about real volumes.

- No v1 table has a row version column.
- Requests, LabResults, Patients and ASTResults each have `DateTimeStamp` and
  `LIMSDateTimeStamp`, both `datetime`, filled on every row.
- No index covers `DateTimeStamp`. The Requests indexes are on `RequestID, OBRSetID` and on
  the clinical dates paired with a panel code. A top-up that filters on `DateTimeStamp`
  would scan the table, so it has to page by key range to stay under 30 seconds.
- Not known: whether the program that writes v1 moves `DateTimeStamp` when it corrects a
  row.

The DISA half is still unchecked. No DISA database is restored.

The first full copy does not depend on this. Top-up is the last task in the part 1 plan and
waits for these facts.

### 9.5 Screens, CLI and docs

- **Screens.** Copy controls sit on the importer plugin's own page, as import controls do
  today (`wasm/openldr-v1-import/ui/src`). The page shows each set with its rows, bytes and
  state, the last error while waiting, and Start, Stop and Delete in a dots menu. Delete is
  a type-to-confirm step. That is a `Dialog`, and AGENTS.md section 5 allows a dialog for
  exactly that.
- **Activity.** A copy run is listed with its state and counts.
- **CLI.** `openldr import copy start`, `status`, `stop` and `delete`, beside the commands
  that exist. `delete` refuses without `--force`. `start` records the request and returns,
  because the server does the driving. `openldr import start` keeps working as it does
  today. The plugin page's broker operations and the CLI call the same code in
  `@openldr/bootstrap`. There is no Fastify route for imports
  (`packages/bootstrap/src/plugin-broker.ts:363`).
- **Docs.** The v1 import guide gains the copy steps, in en, fr and pt, in the in-app docs
  and the web docs.
- **Phone.** The page is checked at 375 by 812.

### 9.6 What part 1 does not do

It does not decode, check or save from the copy. After part 1 a copy can be made and kept
current, and nothing reads it yet. Mode 1 keeps saving through the one-pass import.

## 10. What is left to the builder

- The table layout beyond the columns in 9.2, and the indexes.
- How the server finds runs that need driving, and how often it looks.
- Which driver errors count as a lost connection. `classifyConnectError`
  (`packages/bootstrap/src/connector-diagnose.ts:71`) already sorts some.
- Page growth after a shrink.
- The audit action names for the new events, in the style of `import.start`.
- Which exact DISA tables and columns the copy reads. The rule: the tables and columns the
  toolchain decoder reads on its export path, and no index tables that only exist to speed
  up lookups.

## 11. Open questions

The operator's decision on 2026-11-13: stop designing here. Build part 1 as planned once
design C is merged, then settle the rest with the country teams. The questions below are
past what can be checked from this machine. The operator can run queries only on the sample
databases the countries provide, never on a country's real servers. None of these
questions blocks tasks 1 to 13 of the part 1 plan.

For the operator:

1. **The DISA plugin's name and home.** It needs a neutral name and a repository. The old
   scoping note suggested `cdr-source` or `cdr-bridge`.
2. **May I run one read-only query against a DISA copy and a v1 copy?** It reads column
   names, types and sizes from the system tables and no patient data. It settles the
   top-up method in 9.4 and tells us whether any binary column passes 8,000 bytes.
3. **Mozambique's mode.** Mozambique has GXAlert and SISLab records in v1 that never came
   from DISA. Mode 2 would flag every one of them. Does Mozambique run mode 2, mode 1, or
   mode 2 with a later mode 1 pass over the flagged records?

   The operator's view on 2026-11-13: flagging every v1 record that has no DISA record does
   not work when other systems write to v1, and the plugin needs rules. The candidate rule,
   not yet agreed:

   | v1 request | What happens |
   |---|---|
   | Written by DISA, and DISA has the record | Checked, then saved from DISA |
   | Written by DISA, and DISA has no record | Flagged for a person |
   | Written by another system | Saved from v1, unchecked, marked as v1-only |

   What tells the rule who wrote a record. v1 has a column for it, `LIMSVendorCode`, four
   characters. In the Mozambique restore every request row holds `DISA`, and so does every
   lab in the dictionary. That restore is generated data with DISA rows only, so it does
   not show what GXAlert and SISLab rows hold. A count of request rows by `LIMSVendorCode`
   on the real Mozambique and Zambia v1 databases settles it. The values go in as plugin
   options per site, never in code.

Settled on 2026-11-13: the copy screens live on each plugin's own page. See 7.3. The part 1
plan was already written that way and does not change.

Unknown, and settled only by running part 1 at a site:

- The real speed of a copy over the Zambia link.
- The size of a full copy on disk.
- How many saves per second CE manages, and whether it can hold about 400 million FHIR
  records. That figure is an estimate from 3.7 results per request.
