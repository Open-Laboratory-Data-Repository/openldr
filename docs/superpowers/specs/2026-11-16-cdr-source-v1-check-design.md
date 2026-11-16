# cdr-source plugin: the check against OpenLDR v1. Design

Date: 2026-11-16. Part 3 of `2026-11-13-disa-and-v1-migration-design.md`. It builds on
`2026-11-15-cdr-source-plugin-design.md`, which is part 2.

## 1. What this is and why

A site that runs the source system also has an OpenLDR v1 database, filled from the same
source by the vendor's own programs. So most requests exist twice. The plugin decodes a
request from the source's raw records. The v1 copy of that request, its twin, is a second
reading of the same facts by other code. Where the two disagree, the migration design says
to assume our decoding is wrong until the difference is explained.

Part 3 adds that check to the plugin. For each request it finds the twin, compares the two,
and says whether the request passed, failed or could not be checked. A request that fails is
held back with the field names and both values, so a person can see why.

The old toolchain has this check. It is about 1,250 lines of TypeScript. This design ports it.

## 2. What was checked first

### 2.1 The old check

Mapped on 2026-11-16 with a file and line for every claim. The map is in the plugin
repository at `.superpowers/notes/part3-compare-map.md`.

- The twin's key is a prefix plus the source lab number (`compare/lab-number.ts:10-29`). For
  Tanzania the prefix is `TZDISA`.
- It compares 13 request fields (`compare/mapping.ts:88-215`), then every result
  (`compare/result-diff.ts:336-472`). A request passes when no request field differs and no
  result is a mismatch or exists only in v1.
- In the export path it runs before the audit. A failure stops there: the audit never runs
  and the record is not sent (`commands/export-batch.ts:515-565`).
- **It has no unit tests.** No test calls `diffRecord`, `diffResults`, `normalizeLabNumber`,
  `splitPointOfCare` or `flattenV1`. Its proof is live runs only.
- It forgives more than its notes say. A source result of "1" passes against a v1 result of
  "10", because a substring match runs after the number match fails. Extra v1 rows for a
  result always pass. A received date can never fail when the source has none. The map lists
  17 such points.
- Its first full run on 129,408 requests failed 33,223. 31,138 of those had no v1 row.

### 2.2 The two real databases

Measured on 2026-11-16 on the restored Tanzania backups, both from one afternoon in January
2019. Counts only. The numbers are in `.superpowers/notes/part3-real-data-facts.md`.

| Fact | Count |
|---|---|
| Source requests | 2,326,075 |
| v1 requests with the `TZDISA` prefix | 1,739,522 |
| Source requests with a twin | 1,739,522 |
| Source requests with no twin | 586,553, which is 25% |
| v1 `TZDISA` requests with no source record | 0 |
| v1 requests written by three other systems | 154,245, which is 8% |

- Almost every request with no twin was last changed in 2018 or 2019. v1 was far behind the
  source when the backups were taken.
- v1's `Requests` has a unique index on `(RequestID, OBRSetID)`, and the source's lab number is
  unique. So a request has at most one twin, and no result row can be doubled by the join.
- This v1 is schema 1.1.1 from 2015. It has `Requests`, `LabResults` and `Monitoring`. It has
  no `Patients` and no `ASTResults` table. Patient facts sit on the request row, and there is
  an age but no date of birth.
- `LIMSVendorCode` is empty on 92% of rows. The prefix of `RequestID` is what tells who wrote
  a v1 request.

### 2.3 What the fault fixes changed

Six of the old tool's faults were fixed in the plugin on 2026-11-16. The plugin's decode now
differs from the old tool's on purpose: on 20,000 real requests, 10,403 gain a date of birth
and 1,170 get a coded result's description where the old tool gave its raw code. So the
plugin's check will not see the same inputs as the old tool's check. Section 6.6 deals with
that.

## 3. Goals, non-goals, anti-goals

Goals:

- A Rust check that gives the old check's answer, row for row, when given the same inputs.
- `source_decode` takes the twins of a page and returns each request's check result.
- A request with no twin is not held. It is saved after the audit rules and marked "not
  checked against v1". The operator decided this on 2026-11-16.
- A request whose check fails is held, with the names of the fields that differ and both
  values.
- A measured count, on real twins, of how many requests pass, fail and are unchecked.

Non-goals:

- The old tool's second comparison, which grades the payload against v1 and only reports. It
  is 640 more lines and never changes a verdict.
- Tightening the loose rules. That is the next plan, one measured change per rule.
- Settling the four faults that wait for v1 (two birth rows, two taken rows, the age bytes,
  runs per order). Also the next plan. Section 7 says how.
- Listing v1 requests that have no source record, and deciding what happens to the 8% that
  other systems wrote. Part 4, or a rule per site.
- The screens. Part 4.
- Making CE's v1 import read this older v1 layout. It is CE work, named in section 8.

Anti-goals. Any of these makes the work a failure even if it runs:

- A request marked "not checked" because the host did not send the twins, when a twin exists.
  Not sending twins is an error. Having none is a fact.
- A request that failed its check and was saved anyway.
- A row value in a log line or an error text. The check's result holds values. Nothing else
  does.
- The name of the source system in a string that leaves the plugin.

## 4. Constraints

- The old check is the reference, loose rules included. A place where the Rust is stricter or
  looser than the TypeScript is a defect in this plan.
- `cdr-toolchain` is frozen. Read it. Never change it.
- No real row in the repository. A tool that reads real rows prints counts and field names.
- Nothing under `src/` reads the clock, the time zone, the locale or a file. The toolchain is
  run with `TZ=UTC`.
- The check's code tables stay in plugin source, each with the toolchain file and line it came
  from. That includes the HIV below-detection codes at `compare/result-diff.ts:287-334`. The
  operator decided on 2026-11-15 that the plugin keeps such tables.
- A plugin call has 30 seconds and 512 MB.
- The existing 46 fixtures and their override files do not change.

## 5. Approaches

Three were put to the operator on 2026-11-16.

| | Approach | Gain | Cost |
|---|---|---|---|
| A | Port the old check as it is, then tighten it | Every difference from the old tool is ours to explain. Its past run numbers stay comparable | The first version still lets "1" pass against "10" |
| B | Write a new strict check | Nothing loose is inherited | Nothing to test it against. The first real run floods with differences the old tool already explains |
| C | Port as in A, but only report at first | Data flows sooner | Breaks the rule that a record is saved only after it matches its twin |

The operator chose A. It is the rule already chosen for part 2: match first, then fix each
fault as its own measured change.

## 6. The design

### 6.1 What the plugin offers

`source_decode` changes, and one small entrypoint is new.

| Entrypoint | Input | Output |
|---|---|---|
| `source_twin_keys` | `{ options, keys }` | `{ keys }`, the v1 request id for each source key, in order |
| `source_decode` | `{ options, now, dictionaries, keys, rows, twins }` | `{ groups }` |

`source_twin_keys` exists so that CE core never learns the prefix rule. The host asks the
plugin which v1 keys to fetch, reads them from the v1 copy, and passes the rows back.

`twins` is `{ requests: [...], results: [...] }`: the v1 `Requests` rows and `LabResults` rows
for the page's twin keys, in the form the v1 plugin's copy stores them. Each row carries its
`RequestID`. The check reads 36 columns of the first and 21 of the second. The map lists them.

**The shape of a twin row.** It is a row of `SELECT [RequestID] AS [__key], *` on v1's
`Requests` or `LabResults`, converted the way CE converts every copied row
(`packages/bootstrap/src/import-sql.ts:74-93`): a datetime is the text
`YYYY-MM-DDTHH:MM:SS.mmm` with no zone, a number is a number, text is text, NULL is null. This
is the conversion the plugin's own rows already get, and `tests/plugin-rows.mts` holds the
hand copy used by the fixtures. The v1 plugin's copy statements for these two tables are
exactly that SELECT (`wasm/openldr-v1-import/src/queries.rs:178-184`). It is only that
plugin's two other tables that this v1 lacks.

**A result row has no panel code.** v1's `LabResults` table holds none. The old tool read the
panel code and its description from the request row, through an inner join on `RequestID` and
`OBRSetID` (`openldr.ts:280-292`). The plugin is handed the two tables apart, so it does that
join itself: a result row takes the panel code of the request row with the same `OBRSetID`,
and a result row with no such request row is dropped, as the join dropped it. v1's unique
index on `(RequestID, OBRSetID)` means a result row never has two. Found by the review of the
second task on 2026-11-16; the first fixtures had wrongly put a panel code on the result rows.

`twins` must be present, with both lists. A call without it fails with `twins must hold
requests and results`. A request whose key has no row in `twins.requests` is unchecked. The
stage tests call the stages directly and do not change. The callers of `source_decode` itself,
which are its own tests and the `decode_file` example, pass `twins`. With two empty lists
every request is unchecked.

**The twin key.** `source_twin_keys` is given the source keys of a page, which are bare lab
numbers. It ports `normalizeLabNumber` for the v1 side only: the v1 key is the prefix plus
the lab number, unless the lab number already starts with the prefix in any letter case, in
which case it is the lab number as it is. The source key is never changed, because the plugin
already holds that request's rows. Keeping the odd branch is my call. It is the old tool's
behaviour and no Tanzania lab number can reach it.

**What passes.** The reference is the old tool's export path, with no pending rule. The two
levels have different rules and both are copied as they are. At the request level any row
that is not a match fails: a mismatch, a value only in the source, or a value only in v1. At
the result level a mismatch or a row only in v1 fails, and a row only in the source passes.

Two options are new. `poc_format` says how v1's point-of-care text splits into facility and
ward: `facility_ward`, the default, or `district_facility_ward`. `prefix` already exists.

Each group gains `check`:

```
{ "key": "...", "held": true, "findings": [...],
  "check": {
    "status": "failed",
    "fields": [ { "field": "ward", "status": "mismatch", "source": "...", "v1": "...", "reason": "..." } ],
    "results": { "total": 12, "match": 10, "mismatch": 1, "only_source": 1, "only_v1": 0,
                 "rows": [ { "panel_code": "...", "param_code": "...", "status": "mismatch",
                             "fields": [ ... ] } ] } } }
```

- `status` is `passed`, `failed` or `unchecked`.
- `fields` holds the 13 request rows when there is a twin. `results.rows` holds only the
  observations that did not match, so a clean request stays small.
- The statuses of a row are the old tool's four: match, mismatch, only in the source, only in
  v1. The output says `source` where the old tool says `disa`. That is the one renaming, and
  the tests map it.
- `held` is true when the check failed or the audit holds the request.

Part 4 decides how the host calls both entrypoints and where it keeps the check rows for the
held-back view.

### 6.2 The order of work for one request

1. Decode the request. A decode error ends here, as today.
2. Find the twin's rows by the twin key. The compare of keys follows SQL Server's rule, case
   and trailing spaces ignored, as the old tool's query did.
3. No twin: `check.status` is `unchecked`.
4. A twin: run the request level, then the result level. Both always run.
5. Run the audit.
6. `held` is true when the check failed or the audit has an error-level finding.
7. Not held: build the payload and FHIR, then add the mark of 6.4.

Two calls here are mine, and both differ from the old tool in what is reported, never in the
verdict.

- The old tool stops at a failed check and never runs the audit. The plugin runs both and
  returns both, so the held-back view can show every reason at once.
- The old tool skips the result level when the request level fails. The plugin runs both.

### 6.3 What is ported

| Part | From | About |
|---|---|---|
| Twin key | `compare/lab-number.ts` | 25 lines |
| Comparators: text, loose text, dates to the minute, the three "v1 dropped it" rules | `compare/comparators.ts` | 170 |
| The 13 request fields and their candidates | `compare/mapping.ts`, `compare/diff.ts` | 235 |
| v1 row shaping: panel codes across order rows, the point-of-care split, dropping empty result rows | `openldr.ts`, `compare/result-mapping.ts:714-777` | 170 |
| Result pairing and the five result fields, with the number tolerance and the bound rule | `compare/result-diff.ts`, `compare/result-mapping.ts:195-443` | 630 |

The observation list the result level reads is the one the plugin already builds
(`flatten` with empties left out, then `supersede`, kept rows only).

JavaScript behaviour to copy exactly: `trim`, `Number()`, `Math.round` (which rounds a half
up, where Rust rounds it away from zero), full Unicode lower-casing, and sorting keys by
UTF-16 code unit. The map's section 7 lists each with its line.

### 6.4 The mark

A request that is saved carries one request attribute, code `v1-check`, with the value
`passed` or `unchecked`. It becomes a row in `lab_request_attributes`, which is where
AGENTS.md section 8 puts a fact that one system supplies.

`source_decode` adds it after the stages have run, on the request resource. The payload and
FHIR stages themselves stay equal to the old tool, so the 46 fixtures and their golden tests
do not move.

It is encoded as the plugin's other request attributes already are: an extension
`urn:openldr:ext:request-attribute` on the ServiceRequest, holding the code and a text value
(`src/fhir.rs:356`, with examples in its tests near `:1103`). CE reads that extension into
`lab_request_attributes` today (`packages/db/src/relational/request-facts.ts`, with its test
beside it).

CE's code system `urn:openldr:cs:request-attribute` is a fixed list in
`packages/terminology/codesystems/openldr-request-attribute.json`. It needs the new code. That
is a one-line change in CE with its own test, and it is the only CE change in part 3.

### 6.5 How it is tested

The old check has no tests, so the port builds its own answers first. Three layers.

1. **Made-up pairs.** A new generator runs the toolchain's own `diffRecord` and `diffResults`
   on made-up requests and made-up v1 rows, and stores inputs and outputs as fixture files in
   a new folder. The v1 side needs no database, because those functions take plain rows. The
   source side reuses the scratch-server path the existing generator has. One case per rule:
   each of the 13 fields matching, differing and missing on each side, each forgiveness rule,
   the number tolerance at its edges, the bound rule, the HIV below-detection rule, a v1 row
   with no partner, a twin with no results, and no twin at all.
2. **Real twins, the check alone.** A tool samples 20,000 real requests that have a twin,
   reads their v1 rows through a login that can only read, and runs the old check. It writes
   the check's exact inputs and outputs. The Rust check is run on those same inputs. Every
   row must be equal. This proves the port, whatever the decode does.
3. **Real twins, end to end.** The whole plugin, with its fixed decode, runs on the same
   requests. The counts of passed and failed are set beside the old tool's. Each request whose
   verdict differs is attributed, by field name, to a fault fix. Any that cannot be attributed
   is a defect.

Layer 1 needs no real data and comes first. Layers 2 and 3 need the read-only login of open
question 2, and are a separate step of the plan that waits for the operator's yes.

Dates follow the toolchain as it is always run, with `TZ=UTC`. The Rust gives the answer that
run gives. What the old tool would do under another host zone is out of scope.

To make layer 2 possible, the check takes its input as its own small type: the 19 request
fields it reads, the kept observations, and the twin rows. It can be filled from the plugin's
own request or from the old tool's request JSON.

### 6.6 What the fault fixes mean for the check

Layer 3 is where the fixes show. Two are expected to change verdicts.

- A coded result now carries its description. v1 was written by the source's own programs,
  so v1 most likely holds the description too. If so, requests that failed the old check on
  such a result now pass. This is the first real evidence that a fix is right, and not only
  different.
- The date of birth is not compared, because this v1 has none. No change is expected.

A fix that makes more requests fail against v1 than before is a finding to bring to the
operator, not to explain away.

## 7. After the port matches

The next plan, not this one. Each item is a claim until it is measured on real twins.

**The four faults that wait for v1.** For each, a tool measures one fact against v1 on real
twins and prints counts.

| Fault | Measured against v1 |
|---|---|
| Two birth rows: which date | The age each date gives at the received time, against v1's age |
| Two taken rows: which date | Each date against v1's specimen time |
| Two age decoders | The days each byte range gives, against v1's age in days |
| One run per panel code | Which runs v1 kept, per order row |

**The loose rules.** From the map's section 7. Each fix is one change, and it records how many
real twins change verdict.

| Rule | What it lets through |
|---|---|
| Substring match after the number match fails | "1" against "10" |
| The parameter's description offered as a result | A v1 result that is the description text |
| Extra v1 rows always match | v1 with five rows where the source has one |
| A received date with no source value | Any v1 date |
| Midnight on either side forgives the time | A wrong time on a date-only value |
| A one-letter v1 ward or facility | Any source text holding that letter |

## 8. What part 3 leaves for part 4 and for CE

- **How the host pairs the copies.** It calls `source_twin_keys`, reads those keys from the v1
  copy, and passes the rows as `twins`.
- **CE's v1 import cannot copy this v1.** Its copy reads `Patients` and `ASTResults`, which
  schema 1.1.1 lacks (`wasm/openldr-v1-import/src/queries.rs:221-230`). The check needs only
  `Requests` and `LabResults`, so part 3 is not blocked. A real end-to-end run in part 4 is.
- **The v1-only list and the other systems' records.** 154,245 v1 requests in Tanzania have no
  source record and never will.
- **The held-back view** shows the check rows of 6.1 beside the audit findings.
- **Translating a finding or a field name** by its code, if the page should.

## 9. What is left to the builder

- The Rust types and module split, within the file sizes the plugin keeps.
- The fixture file format for made-up pairs.
- How the real-twin tool samples, as long as every sampled request has a twin and the sample
  spreads across the whole table.

## 10. Open questions

1. **The mark's code.** Settled on 2026-11-16: `v1-check`. It names OpenLDR v1, which is CE's
   own older product, not the source system.
2. **A login that reads v1.** The real-twin runs need SELECT on the restored `OpenLDRData_TZ`
   as well as the three source databases. Same terms as before: created for the run, dropped
   after it, rows deleted.
3. **Running both levels and the audit after a failed check** is my call (6.2). It costs time
   on requests that are held anyway. Under a second per page of 500 today.
