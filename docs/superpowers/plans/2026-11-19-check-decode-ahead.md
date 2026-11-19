# Check decode-ahead implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the migration check saves page N, it decodes page N+1 on a worker thread, with saves still in key order on one cursor.

**Architecture:** The plugin runner gets an `offThread` option that turns on the SDK's existing worker mode. The check service gets an optional `decodeOffThread` setting. When it is true, every decode call runs off the main thread, and the page loop reads the next page and starts its decode before it saves the current page.

**Tech stack:** TypeScript, Node worker threads through `@extism/extism` 1.0.3, Kysely on Postgres, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-check-decode-ahead-design.md`. Measurements: `docs/superpowers/specs/2026-11-19-check-as-bulk-load-research.md`.

## Global constraints

- Work on branch `feat/check-decode-ahead` in worktree `.claude/worktrees/decode-ahead`, cut from `main`.
- One page ahead only. Never two.
- Only the decode call goes off the main thread. Twin-keys, copy and choices calls stay as they are.
- With `decodeOffThread` left out, the check behaves exactly as on `main`. Every existing test in `import-check.test.ts` must pass unchanged.
- Saved records must match `main`: the list of type, id, version and content hash in `fhir.change_log` after a run on the 5,000 sample is byte-identical.
- No commit trailers naming an AI. Commit on the branch only. Merge to `main` only when the operator says so.
- No em dashes in code comments, docs or commit messages. Short plain sentences.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Redirect output to a file, then read the exit code. Never pipe turbo through `tail`.
- The bench Postgres on 127.0.0.1:54399 and its database `checkbench_base` hold real patient data. Clone it, never change it. Drop every clone and delete every dump when done.

## Review focus

The design implies these, and a careless build breaks them. Each has a test in the task named.

1. A page ahead whose decode rejects and is then never used must not raise an unhandled rejection. The server's crash handler ends the process on one. (Task 3)
2. A stop that lands while page N saves and page N+1 decodes: the run stops at page N's end, and the drive does not return while a decode is still running. (Task 3)
3. The last page: the page ahead finds no keys. The run completes and no extra decode call is made. (Task 3)
4. A database fault while page N saves: the loop rewinds, the page ahead is thrown away, and each request is saved once. (Task 3)
5. A correction saved after the page ahead was read: the page ahead is thrown away and the plugin gets the correction. (Task 3)

---

### Task 1: The runner can run a call off the main thread

**Files:**
- Modify: `packages/plugins/src/runner.ts:6-14`
- Modify: `packages/plugins/src/extism-runner.ts:44-60`
- Modify: `packages/plugins/src/wasm-sink.ts:9-15`, `:74-82`
- Test: `packages/plugins/src/off-thread.test.ts` (new)
- Test: `packages/plugins/src/wasm-sink.test.ts`

**Interfaces:**
- Produces, exported from `extism-runner.ts` (already re-exported by `packages/plugins/src/index.ts:8`):
  - `canRunOffThread(execArgv?: readonly string[]): boolean`. Default argument `process.execArgv`. False when any entry is `--import`, `--require`, `-r`, `--loader` or `--experimental-loader`, or starts with one of those followed by `=`. True otherwise.
  - `usesWorker(opts: Pick<RunOptions, 'allowedHosts' | 'offThread'>, execArgv?: readonly string[]): boolean`. True when hosts are pinned (as today, whatever `execArgv` says). Else true when `opts.offThread` is true and `canRunOffThread(execArgv)` is true.
- Produces: `RunOptions.offThread?: boolean` and `SinkInvokeOptions.offThread?: boolean`.

- [ ] **Step 1: Write the failing tests** in `off-thread.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { canRunOffThread, usesWorker } from './extism-runner';

describe('off the main thread', () => {
  it('a_clean_process_can_run_a_call_off_the_main_thread', () => {
    expect(canRunOffThread([])).toBe(true);
    expect(canRunOffThread(['--max-old-space-size=4096'])).toBe(true);
  });
  it('a_process_started_with_a_loader_flag_cannot', () => {
    for (const argv of [['--import', 'x'], ['--require', 'x'], ['-r', 'x'], ['--loader', 'x'], ['--import=x'], ['--experimental-loader=x']]) {
      expect(canRunOffThread(argv)).toBe(false);
    }
  });
  it('pinned_hosts_use_the_worker_as_before_whatever_the_flags', () => {
    expect(usesWorker({ allowedHosts: ['a:443'] }, ['--import', 'x'])).toBe(true);
    expect(usesWorker({ allowedHosts: [] }, [])).toBe(false);
    expect(usesWorker({}, [])).toBe(false);
  });
  it('offThread_uses_the_worker_only_in_a_clean_process', () => {
    expect(usesWorker({ offThread: true }, [])).toBe(true);
    expect(usesWorker({ offThread: true }, ['--import', 'x'])).toBe(false);
    expect(usesWorker({ offThread: false }, [])).toBe(false);
  });
});
```

Add to `wasm-sink.test.ts`, using that file's existing fake runner: a test named `invoke_passes_offThread_to_the_runner` that calls `sink.invoke(entrypoint, {}, { offThread: true })` and expects the runner's `opts.offThread` to be `true`, and a second call without options to give `undefined`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/plugins exec vitest run src/off-thread.test.ts src/wasm-sink.test.ts`
Expected: FAIL, `canRunOffThread` is not exported.

- [ ] **Step 3: Implement**
  - Add `offThread?: boolean` to `RunOptions` with a one-line comment: runs the call on a worker thread when the process allows it.
  - Add `canRunOffThread` and `usesWorker` to `extism-runner.ts`. Replace `const useWorker = (opts.allowedHosts?.length ?? 0) > 0;` with `const useWorker = usesWorker(opts);`.
  - Extend the header comment's "Execution path" list with the third case, and name `apps/server/dev.mjs` as the reason for the guard.
  - Add `offThread?: boolean` to `SinkInvokeOptions` and pass `offThread: opts.offThread` in the `runner.run` call.

- [ ] **Step 4: Run the tests and the package typecheck**

Run: `pnpm --filter @openldr/plugins exec vitest run > /tmp/plugins-test.txt 2>&1; echo "exit=$?"` and `pnpm --filter @openldr/plugins typecheck > /tmp/plugins-tc.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add packages/plugins/src
git commit -m "feat(plugins): a plugin call can run off the main thread (item 16)"
```

---

### Task 2: Every check decode goes off the main thread when the service is told to

**Files:**
- Modify: `packages/bootstrap/src/import-check.ts:171-186` (deps), `:679-690` (`callPlugin`), `:812` (the decode call)
- Test: `packages/bootstrap/src/import-check.test.ts` (`world()` at `:66`, new `describe` at the end)

**Interfaces:**
- Consumes: `SinkInvokeOptions.offThread` from Task 1.
- Produces: `ImportCheckServiceDeps.decodeOffThread?: boolean`. Left out means false.
- Produces for tests: `world({ decodeOffThread: true })` passes the setting to `createImportCheckService`.

- [ ] **Step 1: Write the failing tests** in a new `describe('check: decode off the main thread (item 16)')`

```ts
it('with_decodeOffThread_every_decode_call_asks_for_a_worker_and_no_other_call_does', async () => {
  const w = await world({ decodeOffThread: true });
  await sourceCopy(w, keysOf(4));
  await w.svc.start({ ...START, pageSize: 2 });
  await drive(w.svc);
  const calls = w.invoke.mock.calls as unknown as Array<[string, unknown, { offThread?: boolean } | undefined]>;
  const decode = calls.filter(([ep]) => ep === 'import_decode');
  expect(decode.length).toBeGreaterThan(0);
  for (const [, , opts] of decode) expect(opts).toEqual({ offThread: true });
  for (const [ep, , opts] of calls) if (ep !== 'import_decode') expect(opts?.offThread).toBeUndefined();
});

it('without_it_no_call_asks_for_a_worker', async () => {
  const w = await world();
  await sourceCopy(w, keysOf(2));
  await w.svc.start({ ...START, pageSize: 2 });
  await drive(w.svc);
  for (const [, , opts] of w.invoke.mock.calls as unknown as Array<[string, unknown, { offThread?: boolean } | undefined]>) {
    expect(opts?.offThread).toBeUndefined();
  }
});
```

The fake `invoke` in `world()` takes two parameters today. Give it a third, unused, so the mock records it.

- [ ] **Step 2: Run and see the first test fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/import-check.test.ts -t "decode off the main thread"`
Expected: FAIL, `opts` is `undefined`.

- [ ] **Step 3: Implement**
  - Add `decodeOffThread?: boolean` to `ImportCheckServiceDeps` with a comment: when true, decode calls run on a worker thread and the check decodes one page ahead (design 2026-11-19-check-decode-ahead).
  - Give `callPlugin` a fifth optional parameter `opts?: SinkInvokeOptions` and pass it as the third argument of `sink.invoke` only when it is set.
  - The decode call passes `{ offThread: true }` when `deps.decodeOffThread === true`. This covers rechecks too, since they share the call.

- [ ] **Step 4: Run the whole check test file**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/import-check.test.ts > /tmp/check-test.txt 2>&1; echo "exit=$?"`
Expected: `exit=0`, no existing test changed.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/import-check.ts packages/bootstrap/src/import-check.test.ts
git commit -m "feat(imports): check decode calls can run off the main thread (item 16)"
```

---

### Task 3: The check decodes one page ahead

**Files:**
- Modify: `packages/bootstrap/src/import-check.ts:752-960` (`onePage` and its loop)
- Test: `packages/bootstrap/src/import-check.test.ts`, same `describe` as Task 2

**Interfaces:**
- Consumes: `deps.decodeOffThread` from Task 2.
- Produces: nothing outside this file.

**What to build.** Read the design's section 2 first. In short:

- Split the part of `onePage` that turns a key list into a decode result into two helpers. `readPage(keys)` reads the corrections, the rows and the twins (the twin-keys call is part of it). `decodePage(input)` calls decode and returns `{ groups, twice }` or the `PluginCallFault`. The in-line path and the page ahead both use them. A fault from CE's own database (`OwnDbFault`) is thrown by `readPage`, never turned into a result.
- A page ahead is `{ after: string | null; size: number; keys: string[]; stored: Map<string, Correction[]>; work: Promise<decode result> }`.
- Start one only when `deps.decodeOffThread === true`, the run is not a recheck, and the page just decoded was accepted. The moment is after the next page size is known (`:848-851`) and before the first save of the current page.
- To start it: list the keys after the current page's last key, at the next page size. No keys means no page ahead. Otherwise `await readPage(keys)` in line, then call `decodePage` **without awaiting it** and keep the promise as `work`. So the next page's decode is always called before the current page's first save.
- A database fault in those reads is caught there and means no page ahead this time. The current page goes on to save as today.
- Attach a no-op `catch` to `work` the moment it is created, so a rejection nobody awaits is never unhandled. The code that uses the page awaits the original promise and still sees the rejection.
- The next `onePage` call uses the page ahead only when all hold: not a recheck, `run.cursor === after`, `size` is the same, `work` gave groups and not a fault, and the corrections of its keys read again now give the same signature as `stored`. Share the signature function at `:856`.
- In every other case: wait for `work` to settle, drop it, and go on in line exactly as today. A decode fault in the page ahead lands here: the in-line path decodes again and halves the page as today.
- The checks at the top of `onePage` (`:761-763`) and the "another process holds the run" check (`:826`) run before a page ahead is used, in the same order as today.
- On every way out of the drive loop, including a throw, wait for a page ahead still in flight to settle, then drop it.

- [ ] **Step 1: Write the failing tests.** All use `world({ decodeOffThread: true })`.

```ts
it('each_page_is_decoded_once_and_saved_in_key_order', async () => {
  const w = await world({ decodeOffThread: true });
  await sourceCopy(w, keysOf(6));
  await w.svc.start({ ...START, pageSize: 2 });
  await drive(w.svc);
  expect(w.decodeCalls.map((c) => c.keys)).toEqual([keysOf(2), keysOf(4).slice(2), keysOf(6).slice(4)]);
  expect(w.persisted.map((p) => (p.resources[0] as { id: string }).id)).toEqual(keysOf(6));
  expect((await w.svc.get(PLUGIN, CHECK))!).toMatchObject({ status: 'completed', cursor: 'REQ0006', counts: { read: 6, saved: 6 } });
});

it('the_next_page_is_decoded_before_the_current_page_is_saved', async () => {
  const w = await world({ decodeOffThread: true });
  await sourceCopy(w, keysOf(4));
  const order: string[] = [];
  w.setDecode((input) => { order.push(`decode ${input.keys[0]}`); return { groups: input.keys.map(pass) }; });
  w.failPersist((resources) => { order.push(`save ${(resources[0] as { id: string }).id}`); return null; });
  await w.svc.start({ ...START, pageSize: 2 });
  await drive(w.svc);
  expect(order).toEqual(['decode REQ0001', 'decode REQ0003', 'save REQ0001', 'save REQ0002', 'save REQ0003', 'save REQ0004']);
});
```

Then one test for each line below. Each asserts the decode key lists, that `w.persisted` holds every expected key exactly once and in key order, and the final status and counts.

| Test name | Set-up | Must hold |
|---|---|---|
| `a_page_ahead_that_cannot_be_decoded_is_decoded_again_and_halved` | 8 keys, page 4, decode throws on its 2nd call | Keys saved once each. The 2nd page is asked for again at size 4 in line, then halved to 2. Status `completed`. |
| `a_rejected_page_ahead_never_used_raises_no_unhandled_rejection` | 4 keys, page 2. Decode call 1 stops the run (`w.svc.stop`), decode call 2 throws | Listen on `process.on('unhandledRejection')` for the test and one `setImmediate` tick after `drive`. None fires. Status `stopped`, cursor `REQ0002`. |
| `a_stop_while_a_page_saves_ends_the_run_and_waits_for_the_page_ahead` | 6 keys, page 2. Decode call 2 returns a promise the test resolves later. `failPersist` on the first save calls `w.svc.stop` | `w.svc.idle()` does not resolve until the test resolves decode call 2. Then status `stopped`, cursor `REQ0002`, saved 2. |
| `the_last_page_makes_no_extra_decode_call` | 4 keys, page 2 | Exactly 2 decode calls. |
| `a_database_fault_while_saving_throws_the_page_ahead_away` | 4 keys, page 2. `w.failHeldRemoves(1)` so the first page's held-list removal faults once | Run the same set-up with `decodeOffThread` on and off. Expect equal `persisted` ids, counts and status. |
| `a_database_fault_reading_the_page_ahead_means_no_page_ahead` | 4 keys, page 2. Make the second `listKeys` read fault once (add a small hook to `world()` beside `failReadSet`) | All 4 keys saved once, in order. Status `completed`. |
| `a_correction_saved_after_the_page_ahead_was_read_reaches_the_plugin` | `world({ decodeOffThread: true, corrections: ['dob'] })`, 4 keys, page 2. In the save of `REQ0001`, store a correction for `REQ0003` through `w.corrections` | The last decode call holding `REQ0003` carries that correction in `input.corrections`. `REQ0003` is saved once. |
| `a_recheck_never_decodes_ahead` | Copy the set-up of an existing recheck test in `describe('held corrections ...')`, with `decodeOffThread: true` | Same decode calls as that test makes today. |
| `a_run_another_process_took_over_writes_nothing_from_the_page_ahead` | Copy the set-up of the existing lost-driver test in `describe('check: start again, stop, and who drives')`, with `decodeOffThread: true` | No save after the takeover, as that test asserts today. |

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/import-check.test.ts -t "decode off the main thread"`
Expected: `the_next_page_is_decoded_before_the_current_page_is_saved` fails with the order `decode, save, save, decode, save, save`.

- [ ] **Step 3: Implement** as described under "What to build".

- [ ] **Step 4: Run the whole file, then the package typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/import-check.test.ts > /tmp/check-test.txt 2>&1; echo "exit=$?"` and `pnpm --filter @openldr/bootstrap typecheck > /tmp/bootstrap-tc.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`. Grep the test output for `Test timed out` before reading a failure as real.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/import-check.ts packages/bootstrap/src/import-check.test.ts
git commit -m "perf(imports): a check decodes the next page while it saves the current one (item 16)"
```

---

### Task 4: Turn it on where the service is built

**Files:**
- Modify: `packages/bootstrap/src/index.ts:1958-1971`

**Interfaces:**
- Consumes: `canRunOffThread` from `@openldr/plugins` (Task 1), `decodeOffThread` (Task 2).

- [ ] **Step 1: Add `decodeOffThread: canRunOffThread(),`** to the `createImportCheckService({ ... })` call, with a comment: decode runs on a worker thread and one page ahead, unless this process was started with a loader flag (apps/server/dev.mjs says why).

- [ ] **Step 2: Find out whether vitest allows the worker path.** Add a temporary `console.log(process.execArgv)` to any test in `packages/plugins`, run it, read the output, remove the line. Write the answer in the commit body: either "vitest workers start clean, so integration tests run the worker path" or "vitest workers carry a loader flag, so the bench is the first real run of the worker path".

- [ ] **Step 3: Run the server lint and the package typecheck**

Run: `pnpm --filter @openldr/server lint > /tmp/server-lint.txt 2>&1; echo "exit=$?"` and `pnpm --filter @openldr/bootstrap typecheck > /tmp/bootstrap-tc.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/index.ts
git commit -m "perf(imports): the server and the CLI decode a check off the main thread (item 16)"
```

---

### Task 5: Prove it on real data, then run the gate

**Files:**
- Create, outside the repo: `/home/fredrick/.cache/openldr-speed-bench/run-check.mts`, `launch.mjs`, `dump-hashes.mjs`
- Modify: `docs/superpowers/specs/2026-11-19-check-as-bulk-load-research.md` (add a "Built result" section)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Make the bench script.** Copy `/home/fredrick/.cache/openldr-speed-bench/run.mts` to `run-check.mts` and change four things:
  1. Clone into database `checkbench_check`, not `checkbench_run`.
  2. After the clone, run `dbm.createMigrator(db, dbm.internalMigrations).migrateToLatest()` and exit 1 on an error. The sample stops at migration 127.
  3. Pass `decodeOffThread: process.env.OFF_THREAD === '1'` to `createImportCheckService`.
  4. Time main-thread stalls: a 20 ms `setInterval` that records the longest gap beyond 20 ms and the count of gaps over 500 ms. Print both at the end.

  `launch.mjs` registers `tsx` in-process and then imports the script named in `process.argv[2]`, the way `apps/server/dev.mjs` does. Do not start the bench with the `tsx` command: the worker crashes under it.

  `dump-hashes.mjs` writes `resource_type, resource_id, version, op, content_hash` of every `fhir.change_log` row of `checkbench_check`, ordered by type, id, version, as tab-separated lines to the file named in `process.argv[2]`.

- [ ] **Step 2: Check nobody else is using the bench.** Query `pg_stat_activity` on port 54399. Go on only when no other session is connected.

- [ ] **Step 3: Run before and after, two runs each**

```bash
REPO=/home/fredrick/Projects/Repositories/openldr_ce node /home/fredrick/.cache/openldr-speed-bench/launch.mjs /home/fredrick/.cache/openldr-speed-bench/run-check.mts
```

```bash
REPO=/home/fredrick/Projects/Repositories/openldr_ce/.claude/worktrees/decode-ahead OFF_THREAD=1 node /home/fredrick/.cache/openldr-speed-bench/launch.mjs /home/fredrick/.cache/openldr-speed-bench/run-check.mts
```

Dump the hashes after one run of each. Expected: every run reads 5,000, saves 4,850, holds 119, fails 31, with 69,667 resources. `cmp` of the two hash dumps exits 0. The "after" runs are faster than 175 requests a second, and no stall is over 500 ms. Record the real numbers. If "after" is below 240 a second, stop and report rather than tuning.

- [ ] **Step 4: Stop and start again.** Start an "after" run, stop it part-way with the service's `stop`, start it again, let it finish. Expected: the final counts equal a clean run's. The hash dump may differ from a clean run, because a stop can save a page's requests twice, as on `main`. Say which it was.

- [ ] **Step 5: Clean up.** Drop `checkbench_check`. Delete the hash dumps. Leave `checkbench_base` alone.

- [ ] **Step 6: Run the full gate in the worktree**

Run: `pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "exit=$?"` and `pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "exit=$?"`
Expected: both `exit=0`. On a failure, grep for `out of memory`, `VirtualAlloc` and `Test timed out`, and run that package alone before blaming the change.

- [ ] **Step 7: Write the result down.** Add a "Built result" section to the research doc: the before and after table, the hash comparison, the stop and start result, the vitest finding from Task 4, and what was not covered. Not covered unless you ran them: the built standalone app and the Docker image. Write "HONEST NON-PROOF" for each of those and say what would prove it (`pnpm --filter @openldr/server build:check`, then one check in the built app).

- [ ] **Step 8: Commit, then report to the operator**

```bash
git add docs/superpowers
git commit -m "docs(specs): decode-ahead built result on the 5,000 sample (item 16)"
```

Report the numbers and ask before merging. After the merge to `main`, run `pnpm make:changelog` and commit `apps/web/src/landing/changelog.json`. The dev server runs from the main checkout, so say that a merge reaches it.
