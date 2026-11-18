# Long jobs survive an interruption, and say so

Date: 2026-11-18. Finding F17 of the real-environment test.

## Why

During the 2026-11-18 test the API stopped three times in an hour: a planned restart, a Node crash,
and a merge into `main` that reloaded the dev server. The cdr-source check and copy carried on by
themselves, which was good, but the page never said they had been interrupted. The operator: "that
was a good test, no continue action is bad cause interruptions are bound to happen", and "loading an
excel/csv might sound like a small job but look at what just happened".

Labs run CE on small servers with power cuts. Any job that takes more than a few seconds will be cut
off sometimes.

## What the operator chose

- When the server comes back, a long job **carries on by itself** where it can, and the page **says
  so**: "Interrupted at 08:15, carried on by itself".
- When a job cannot carry on by itself, the page says "Interrupted at 08:15" and offers **Continue**
  in the row's `⋯` menu.
- Approach B (below): one shared helper and one shared badge, wired into each job.

## How each job behaves today

| Job | Code | After a restart today | Page today |
| --- | --- | --- | --- |
| cdr-source copy, check, import | `packages/bootstrap/src/import-driver.ts`, `import-run.ts` | carries on by itself (adopt at boot) | nothing; reads as never stopped |
| Facility import (CSV, Excel, JSONL register) | `facility-import-worker.ts` | failed once a 15-minute lease runs out; register released | Failed; user starts again |
| Facility map rebuild | `facility-job-worker.ts` | failed at boot ("interrupted, the server restarted") | Failed |
| Terminology upload (LOINC, ontology, CSV) | `terminology-ingest-worker.ts`, `db/src/terminology-ingest-job-store.ts` | failed at boot | Failed |
| Ingest batch (file through a converter plugin) | `packages/ingest`, outbox in `adapter-event-bus` | the outbox takes the event back after its 5-minute lease and runs it again | nothing |
| Workflow webhook run | `packages/workflows/src/receipt-service.ts` | running becomes `interrupted` ("outcome is uncertain"), queued becomes `cancelled` | badge on the History panel |

## Goals

1. Every job above records each interruption: when it was cut off, and when and how it came back
   (by itself, by a person's Continue, or not at all).
2. Facility import, facility map rebuild, terminology upload and ingest batch carry on by themselves
   after a restart instead of failing. Each one's input is already stored (a blob or a database
   row), and its writes are upserts, so running it again from its start is safe.
3. cdr-source runs keep resuming as now, and now also record the interruption.
4. One shared studio badge shows the record on every page that lists these jobs.
5. CLI parity: each job's `status` command prints the same record, and a `continue` command exists
   wherever the page offers Continue.

## Non-goals

- No new job framework. Each worker keeps its own table and loop (approach A was rejected).
- No resume from the middle of a file for jobs that run again from the start. Running again from
  the start is enough at today's sizes: the 13,000-row Tanzanian register applies in about 2.3 s.
- No change to how cdr-source resumes; it already saves its place.

## Anti-goals (a failure even if it technically works)

- **A workflow run re-runs by itself.** A workflow may have sent an email or called another system
  before the cut, so running it again could do that twice. Workflow runs never carry on by
  themselves. An interrupted run shows "Interrupted, outcome uncertain" and offers Continue, which
  starts a new run with the same input and says so.
- **Two copies of one job run at once.** Taking back a job must not race a live worker. Today's
  leases exist for that reason (`FACILITY_IMPORT_STALE_LEASE_MS` explains it); the helper keeps a
  lease or an owner check.
- **A job that keeps dying loops forever.** After a set number of interruptions in a row (3) the
  job stops carrying on by itself and waits for Continue, with the reason shown.
- **The page says "carried on" when it did not.** The record is written by the code that takes the
  job back, not inferred by the page.

## Approaches

| | Approach | Trade-off | Chosen |
| --- | --- | --- | --- |
| A | One shared job runner for every job, like the cdr-source driver | most uniform; rewrites five workers before the funding deadline | No |
| B | A shared "take back and record" helper plus one shared badge, wired into each worker | each worker changes only at its boot sweep and its status shape; consistent page | **Yes** |
| C | Show interruptions only; jobs still fail | does not meet "carry on" | No |

## The design

### 1. The interruption record

Each job row gains `interruptions`: a JSON array, newest last, of
`{ at, cause, resumedAt | null, resumedBy: 'self' | 'person' | null }`.
`at` is the job's last heartbeat or `updated_at` before the cut (the best time CE knows), `cause`
is a short fixed code (`server-restart`, `lease-expired`). One migration per job table, or one
shared table keyed by job kind and id, is the builder's call.

### 2. The helper

In `@openldr/bootstrap`: given a store's "running jobs older than X" query, it takes each job back,
appends an interruption, and either sets it to run again (`resumedBy: 'self'`) or, for workflow runs
and for a job past 3 interruptions in a row, leaves it waiting for Continue. Each worker calls it
at boot and on its existing sweep, in place of `failStaleRunning`.

### 3. The badge

One studio component, beside `StripedEmpty` and `LoadingState` in `components/ui/`: a small
`Badge` with a `Tooltip` listing each interruption in plain words ("Interrupted at 08:15. Carried on
by itself at 08:15."). Continue lives in the row's `⋯` menu, per AGENTS.md section 5. It appears on:
the facility import history, the terminology page's jobs, the Activity page's ingest batches, the
workflow History panel, and, through CE's run API, the cdr-source page (that page is in the
cdr-source repository and ships in its next release).

### 4. Per job

- **cdr-source runs**: the driver's adopt step appends the record (`resumedBy: 'self'`).
- **Facility import**: at boot, a run in `validating` or `applying` is taken back and run again from
  its stored blob. The sweep's lease stays for the case of a second process.
- **Facility map rebuild, terminology upload**: at boot, a `running` job goes back to `queued`
  with the record, instead of `failed`.
- **Ingest batch**: when the outbox hands back an event whose batch is `processing`, the handler
  appends the record before running it again.
- **Workflow webhook run**: today's `interrupted` stays, now with the record; Continue starts a new
  run with the same stored input, linked to the old one.

## Calls made after the builder check (Claude's, for the operator to check)

1. **Workflow Continue** runs the workflow's current definition with the stored input, under a fresh
   idempotency key. The new run's id goes into the old run's interruption record (`continuedAs`).
   The confirm text says when the definition changed since the cut. Reason: Continue is pressed by a
   person looking at today's workflow.
2. **Queued webhook runs** that had not started go back to `queued` with the record, instead of
   `cancelled`. Nothing ran, so running them cannot do anything twice. The existing rule that cancels
   a queued run whose definition changed (`receipt-service.ts:107-110`) stays.
3. **Every job kind gets Continue**, page and CLI, because any of them can stop carrying on after 3
   interruptions in a row. The count resets when the job finishes or reaches a later phase than at
   its last cut.
4. **Ingest batch Continue** is the existing retry (`batchStore.reset` and a new event). The
   handler records each outbox redelivery. If the outbox runs out of attempts first, the batch
   shows "Interrupted" with Continue instead of staying `processing`.
5. **A facility import cut during `applying`** carries on applying without asking for a second
   confirm. The operator already confirmed it and the file is the same stored blob. A cut during
   `validating` validates again and stops at the usual confirm.
6. **CLI**: new `status` commands where none exist (facility map rebuild, workflow runs); existing
   ones (facility import, terminology, ingest, cdr-source runs) gain the record.
7. **The cdr-source page** shows the badge in its next release. This plan covers only CE's run API
   field for it.

## Definition of done (AGENTS.md section 6)

UI as above; CLI `status` shows the record and `continue` exists where the page has Continue; docs in
en, fr and pt (in-app and web troubleshooting); phone width checked; changelog after merge.

## Left to the builder

- One shared interruptions table, or a column per job table.
- The exact wording of each cause, kept short and plain.
- Whether facility import keeps its 15-minute lease for the sweep after boot, given CE runs one API
  process per install today.
- Test layers: each worker's boot path with pg-mem, plus one real restart per job kind on the dev
  stack, recorded with HONEST NON-PROOF where only a real phone or a real power cut can show it.
