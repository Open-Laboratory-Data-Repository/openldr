# Item 16: decode the next page while the current page saves

Status: design, waiting for the operator's approval. 2026-11-19.
Measurements and the spike are in `2026-11-19-check-as-bulk-load-research.md`.
Line numbers are from `main` at 6c496749.

## Why

A full check of the Tanzania source is 2.3 million requests. After slice 2a it runs at 175 requests
a second on the 5,000 sample, about 3.7 hours for the full source. Decode is half of that time and
runs on one core, on the server's main thread. Saves cannot start until decode ends, and nothing
else in the server runs while a page decodes.

## What changes for the operator

- The check runs about 1.6 times faster: 275 to 278 requests a second in the spike.
- The studio and the API keep answering during a check. Today the server's main thread is held for
  about 1.4 s on every page. With decode on a worker the longest hold is about 250 ms.
- Nothing else changes. Same counts, same held list, same resume after a stop or a cut.

## Goals

- While page N saves, page N+1 is read and decoded on a worker thread.
- Saves stay in key order, on one cursor, written as today.
- The saved records are the same as today. The check: the list of type, id, version and content
  hash in `fhir.change_log` after a run is byte-identical to a run on `main`.

## Not in this work

- More than one page ahead. The spike showed 2 and 3 pages ahead add nothing, because a page takes
  about 1.3 s to decode and 1.4 s to save.
- Any other plugin call on a worker. A small call is 14 times slower on a worker (21.7 ms against
  1.6 ms). On the list for later: a converter given a large file may hold the main thread too.
- The hash skip, slice 2b (one transaction per page), key ranges, a queue library.
- Copies, and rechecks of corrected requests. They stay as they are.

## What would make this a failure

- A request saved twice, lost, or saved in a different order than today.
- A page decoded ahead being used after something it depends on changed.
- A check that cannot be stopped, or that leaves a decode running after it stopped.

## Approaches

1. **The SDK's own worker mode, for the decode call only. Chosen.** The runner already has it for
   plugins that need the network (`extism-runner.ts:54`, `:60`). Measured at 275 and 277 requests a
   second with one page ahead. It needs one new option and no packaging change.
2. **Our own worker threads.** Measured at 278 and 277. Same speed, but the worker file must be
   shipped in three bundles (server, standalone, CLI), and each bundle inlines the SDK, so the
   worker cannot load it by path. More code and a packaging risk for no gain.
3. **Every plugin call on a worker.** Measured: no gain for the check beyond option 1, and small
   calls get slower. The operator chose check decode only on 2026-11-19.

The operator picked "check decode only". Using the SDK's worker mode and not our own threads is my
call, made after measuring both.

## Design

### 1. The runner takes an "off the main thread" option

- `RunOptions` (`packages/plugins/src/runner.ts:6`) gets `offThread?: boolean`.
- `createExtismRunner` uses the worker when `offThread` is true or when hosts are pinned, as today
  (`extism-runner.ts:54`).
- `SinkInvokeOptions` (`wasm-sink.ts:9`) gets the same option and passes it through
  (`wasm-sink.ts:74`).
- One guard. A process whose `process.execArgv` carries a loader flag (`--import` or `--require`)
  crashes when the SDK starts its worker. `apps/server/dev.mjs` explains why. In such a process
  `offThread` is ignored and the call runs on the main thread, as today. The server, the standalone
  and the CLI all start clean, so the guard is for stray scripts and tests.

### 2. The check decodes one page ahead

All of this is inside `onePage` and its loop in `packages/bootstrap/src/import-check.ts:759-935`.

A page ahead holds: the cursor it was read after, the page size, the keys, the rows, the twins, the
corrections it was sent, and the promise of the decode answer.

- **When it starts.** Right after page N's decode answer is accepted and the next page size is
  known (`:848-851`), before page N's saves begin. It reads the keys after page N's last key, their
  rows, corrections and twins and waits for those reads. Then it calls decode with `offThread` and
  does not wait for it. So the next page's decode is always called before the current page's first
  save. A database fault in those reads means no page ahead this time, and the current page saves
  as today. (My call, made while writing the plan, so the order can be tested.)
- **When it is used.** The next `onePage` call uses it only if all of these hold: the run is not a
  recheck, `run.cursor` equals the cursor it was read after, the page size is the same, and the
  corrections of its keys are still the same. Otherwise it is thrown away and the page is read and
  decoded in line, as today. The corrections comparison already exists for rechecks (`:855-859`).
- **What stays where it is.** The checks at the top of `onePage` (`assertAllowed`,
  `assertUnchanged`, `:761-763`) still run before a page is used. The "another process holds the
  run" check after decode (`:826`) still runs before anything is written.
- **Faults.** A decode fault or a database fault inside the page ahead is not handled there. The
  page ahead is thrown away, and the in-line path meets the same fault and handles it as today:
  halve the page (`:833-837`), or rewind and wait (`:940-945`). Halving changes the size and
  rewinding changes the cursor, so both throw the page ahead away by the rule above.
- **Stop.** When the drive ends for any reason, it waits for a page ahead still decoding, then
  drops it. No decode is left running. On the worker path a timeout ends the worker
  (`extism-runner.ts:29-31`).
- **Every check decode goes to the worker, not only the page ahead.** That covers the first page,
  a page decoded in line after a page ahead was thrown away, a retry after a halving, and a
  recheck. Otherwise a run with bad pages would still hold the server for 1.4 s per retry. A recheck
  still never decodes ahead. (My call, after the builder check.)
- **A thrown-away page ahead is waited for before the page is decoded in line.** The runner has no
  way to end a call early (`runner.ts:6-14`). Waiting keeps memory at one extra page. It costs up
  to 1.3 s per discard, or the plugin's timeout if the decode hangs. (My call.)
- **Only decode goes off the main thread.** The twin-keys call stays in line. It is a small call.
- **No worker, no page ahead.** If the guard in part 1 would keep decode on the main thread, the
  check does not decode ahead at all. A decode started early on the main thread would hold the
  server at a worse moment than today.
- **How the check learns that.** `@openldr/plugins` exports one function that says whether a call
  can run off the main thread in this process. It is the same test the runner's guard uses.
  `createImportCheckService` gets a new optional dep, `decodeOffThread`, set from that function
  where the service is built in `@openldr/bootstrap`. Left out, it is false and the check runs as
  today. Tests with a fake sink set it to true. (My call.)

### 3. What it costs

- One more page in memory: about 20 MB of input JSON and its answer, at a page of 500.
- One more worker thread while a check runs.
- A second plugin call in flight. The in-flight list used for crash reports already holds several
  (`packages/core/src/crash-log.ts:60-64`).
- Known and unchanged: a worker that throws outside a call ends the server process
  (`extism-runner.ts:33-42`). The network path has the same risk today.
- Found by the branch review: on a worker the plugin's time limit really ends a decode. On the
  main thread the timer could never fire while the plugin ran, so a decode slower than the limit
  (30 s by default, `manifest.ts:21`) simply finished. Now such a page fails as timed out and is
  halved, as any failed page is. A page of 500 takes about 1.3 s here, so this needs a box about
  20 times slower, or a far larger page.
- Found by the branch review: the next page's rows are sent to the plugin before that page's own
  permission check. If an admin revokes the connector while a page saves, one more page of rows
  reaches the plugin than before. Nothing of it is saved, because the check at the top of the next
  page stops the run, and the plugin has no network.
- The worker risk above now applies to every page of a check, not only to network calls. Not
  tested: a worker that runs out of memory.

## Left to the builder

- The shape of the page-ahead object and where its helper sits in `import-check.ts`.
- How the guard reads `process.execArgv`.
- How the drive waits for and drops a page ahead on every way out, including a thrown error.

## Tests and proof

- Unit, with a fake sink: a page ahead is used when nothing changed. It is thrown away on a recheck,
  a changed page size, a rewound cursor, changed corrections, a decode fault and a stop. Layer: the
  check loop only, not Postgres and not the real plugin.
- Unit: the runner passes `offThread` to the SDK, and ignores it under a loader flag.
- Real Postgres and the real plugin, on the 5,000 sample: two runs before and two after. Report
  requests a second, the time split and the longest main-thread stall. Compare the `change_log`
  hash list with `main`. It must be byte-identical.
- Stop a run part-way and start it again. Counts must match a clean run.
- Full gate: tests and typecheck, both forced, `--concurrency=2`.
- Not known: whether vitest's own workers carry a loader flag. If they do, the real-plugin
  integration tests stay on the main thread and the bench is the first real run of the worker path.
  The builder checks this first and says which it is.
- Not proven by the spike: the page ahead came from recorded inputs. The real one reads keys, rows,
  corrections and twins while page N saves, on the same database. The 275 to 278 a second does not
  include that overlap, so the built number may be lower. The bench after the build is the proof.
- Not covered: the built standalone and the Docker image. Say so, or run `build:check` and one check
  in the built app.

## Definition of done (AGENTS.md section 6)

- UI: none. No screen changes.
- CLI: none. No new command or setting.
- Docs: none for users. The behaviour they see is the same, only faster.
- Mobile: none.
- Changelog: the commit is a `perf`. Run `pnpm make:changelog` after it merges to `main`.
