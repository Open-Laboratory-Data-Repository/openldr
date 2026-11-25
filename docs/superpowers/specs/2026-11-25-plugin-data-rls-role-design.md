# Row-level security on plugin data under a superuser login

Date: 2026-11-25. Batch 5, item C2. The operator chose the role switch on 2026-11-25. The droplet
is not touched by this work; it gets the migration at its next update, when the operator decides.

## Why

CE puts a facility policy on every plugin data table that has a facility column, with
`FORCE ROW LEVEL SECURITY` (`packages/db/src/plugin-schema.ts:324-332`). A Docker install logs in as
`openldr`, and the Postgres image makes `POSTGRES_USER` a superuser
(`deploy/install/docker-compose.yml:68`). Postgres skips every policy for a superuser (and for a
role with `BYPASSRLS`). So on Docker installs, the droplet included, the policy never runs. The
facility filter CE adds in code is the only guard, as the code already says
(`packages/db/src/plugin-data-requests.ts:18-21`). Nothing leaks today; the second guard is off.

## Facts checked first

- Only plugin data tables carry a policy. No other CE table uses row-level security.
- Every plugin data request runs in its own transaction and first sets `openldr.facilities` for that
  transaction (`plugin-data-requests.ts:429`). The policy reads that setting.
- `FORCE ROW LEVEL SECURITY` makes the policy apply to the table owner. On an install whose login is
  not a superuser and lacks `BYPASSRLS`, the policy already applies; nothing needs to change there.
- The live test already proves the policy by switching to a no-login role with `set local role`
  (`plugin-schema.live.test.ts:48-61`).
- The next free migration is 145. No unmerged branch adds a migration.

## Approaches

- Chosen: a no-login role for plugin data, and a role switch inside each plugin data transaction
  when CE's login bypasses row-level security. One migration, no `.env` change.
- Not chosen: a second, non-superuser login for the whole app. Every install, the droplet too, would
  need a new role, grants, two connection settings and a hand-edited `.env`, for a policy that guards
  plugin data only.
- Not chosen: document only. The second guard would stay off.

## Design

- **The role.** `openldr_plugin_data`: `NOLOGIN NOSUPERUSER NOBYPASSRLS`. It owns nothing.
- **Migration 145 (`145_plugin_data_role`).** When CE's login may create roles (superuser, or
  `CREATEROLE`): create the role if it is missing, grant it to the login (a `CREATEROLE` login must be
  a member to switch to it), and for every schema CE made for a plugin (the ones holding
  `_openldr_shapes`) grant `USAGE` on the schema and `SELECT, INSERT, UPDATE, DELETE` on all its
  tables. When it may not: log that it skipped, and change nothing. Down drops the grants and the role.
- **New tables.** When `apply` makes a schema or a table and the role exists, it grants the same
  rights in the same transaction.
- **The switch.** At the start of each plugin data transaction, after the facility setting: when the
  login bypasses row-level security and the role exists and the login may use it, `SET LOCAL ROLE
  openldr_plugin_data`. `SET LOCAL` ends with the transaction, so nothing else runs as that role. The
  check is read once per process and kept.
- **When the role is missing** under a superuser login (the migration skipped): no switch, and one
  warning at start, naming the reason. The code filter still guards, as today.
- **pg-mem.** Tests that run without row-level security (`PG_MEM_WITHOUT_RLS`) skip the role and the
  switch, as they skip the policy.

## What touches the dev stack (part of this approval)

- The live tests run against a throwaway database made on the dev Postgres container for the run
  (`openldr_rls_test`), dropped afterwards.
- Merging to `main` reaches the dev server, which then runs migration 145 on the dev database: it
  creates `openldr_plugin_data` and grants it the existing plugin schemas there (lab, cdr-source).
- The lab plugin's live check then runs on the dev stack to prove plugin data still works through
  the role.

## Proof

- Live tests on real Postgres, as a superuser login: inside a plugin data request `current_user` is
  `openldr_plugin_data`; a raw select in that transaction sees only the set facilities; an insert for
  another facility is refused by the policy; a login that does not bypass row-level security gets no
  switch; with the role missing the request still works and the warning is logged.
- Migration 145 on real Postgres: role made, grants on an existing plugin schema, idempotent on a
  second run, and a clean skip for a login that cannot create roles.
- Full gate. The lab plugin live check on dev after the merge.
- HONEST NON-PROOF until then: the droplet. It runs the migration only when the operator updates it.

## Left to the builder

- Where the once-per-process check lives (the plugin data request factory is the natural place).
