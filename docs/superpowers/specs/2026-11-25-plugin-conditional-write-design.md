# Conditional plugin writes, and the lab's hold on authorise

Date: 2026-11-25. Small project: one CE host feature, then the lab plugin uses it.

## Why

The lab plugin has two known limits (plugin README, "Known limits"):

1. A reject that lands between authorise's last read and its write is lost. CE's update takes only
   a primary key (`packages/db/src/plugin-data-requests.ts:74`), so authorise cannot say "only if
   the test is still waiting for review".
2. A test can end up rejected while CE holds its final result. Authorise sends to CE first and
   changes the test after. A reject in between wins.

Cancel and send back race authorise the same way. The operator asked for both limits fixed, and
chose to do it with a conditional write in CE (2026-11-25), not a plugin-only lock table.

## Goals

- A plugin can make an update or delete apply only while the row still holds given values, and can
  say how many rows it expects to change. When the row changed, nothing in the request is saved and
  the plugin gets a clear code.
- The lab plugin holds a test while authorise sends it to CE. Reject, cancel and send back are
  refused while the hold is on.

## Non-goals

- No locking API, no transactions across host calls, no SQL.
- No change to inserts. A duplicate key stays as it is.
- No retry inside CE. The plugin decides what to tell the person.

## Approaches

- **A, chosen: a conditional update and delete in CE.** Every plugin can use it. The lab plugin then
  needs the CE version that has it.
- B, not chosen: a plugin-only lock table, where a duplicate insert blocks the others. No CE change,
  but CE answers a duplicate key as a generic `HOST_ERROR`, so the plugin cannot tell a lock from a
  real failure.

## CE: the conditional step

An `update` or `delete` step in `db_write` takes two optional fields:

- `where`: a list of filters, the same shape and operators `db_select` takes (`eq`, `lt`, `lte`,
  `gt`, `gte`, `in`, `is_null`, `prefix`), checked against the declared columns the same way. CE
  joins them with AND to the key and to the caller's facility filter.
- `expect`: a whole number, 0 or more. When the step changed a different number of rows, CE rolls
  back the whole request and answers `REQUEST_CONFLICT`, naming the step and table. Without
  `expect`, the step answers its row count as today.

So `{ op: 'update', table: 'order_tests', key: { id }, set: { status: 'rejected' }, where: [{ column:
'hold', op: 'is_null', value: true }], expect: 1 }` changes the test only when no one holds it.

The Rust SDK passes JSON through, so it needs no change. The plugin-author docs (en, fr, pt) gain
the two fields and the `REQUEST_CONFLICT` code.

## Lab plugin: the hold

- `order_tests` gains two nullable columns, `hold` (text, a token for one authorise call) and
  `hold_at` (timestamp). Adding nullable columns is allowed.
- **Authorise** first sets `hold` and `hold_at`, only where the status is the one it read and no one
  holds the test, expecting 1 row. Then it sends to CE. Its final write sets `authorised` and clears
  the hold, only where `hold` is still its own token, expecting 1 row.
- If the send to CE fails, authorise clears its own hold.
- If authorise cannot finish after CE saved (the existing "keep held" path), it records the send as
  today and clears its hold. The test is then held by CE and only authorise can finish it, as today.
- **Reject (test or sample), cancel and send back** change a test only where `hold` is empty,
  expecting 1 row. On `REQUEST_CONFLICT` they answer "This test is being authorised. Try again in a
  moment."
- **A hold left behind** (the server stopped mid-call) is stale after 2 minutes. Authorise takes a
  stale hold over. Reject, cancel and send back stay refused while any hold is on, since CE may hold
  the result. The message then says to authorise the test to finish.

## Proof

- CE: pg-mem tests for the filters, the row count and the rollback. A live PostgreSQL test that a
  conditional update in one request loses to a change committed by another, and saves nothing.
- Plugin: `cargo test` with the fake host taught the new fields. The live check on the dev stack:
  authorise and reject at the same moment never leave a test rejected while CE holds its result.
- The README's "Known limits" loses both entries.

## Left to the builder

- The token's form, and the exact wording in fr and pt.
- Whether `expect` without `where` is useful (it is allowed).
