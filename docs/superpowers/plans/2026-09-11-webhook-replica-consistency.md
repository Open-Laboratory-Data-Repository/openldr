# Webhook replica consistency implementation plan

> For agentic workers: use superpowers:subagent-driven-development. Do not commit until the operator requests it.

Goal: authenticate workflow webhooks from current shared state on every API instance.

Architecture: transactional derived path index plus request-time credential resolution. No cache invalidation service.

Tech stack: TypeScript, Kysely, PostgreSQL, Fastify, Vitest.

Spec: `docs/superpowers/specs/2026-09-11-webhook-replica-consistency-design.md`.

## Constraints

- Work only in `.worktrees/webhook-replica-consistency`.
- No commits, merges, pushes, live provider changes or clinical data mutations.
- Scope is P14. P05 durability and other trigger caches are separate work.
- No new UI controls. Docs in English, French and Portuguese.
- Record commands and results in `docs/reviews/P14-webhook-replica-consistency.md`.

## Tasks

- [x] Establish baseline workflow/store/route tests in the new worktree.
- [x] Write failing store and resolver tests. Add migration 096, schema, bounded indexed lookup and transactional path maintenance. Files: `packages/db/src/migrations/internal`, `packages/db/src/schema/internal.ts`, `packages/workflows/src/store.ts`, new shared resolver module and tests.
- [x] Wire bootstrap's shared resolver, await authentication lookup in the route, and remove production map refreshes. Add HTTP regressions for two contexts and unavailable lookups. Preserve unrelated schedule handling.
- [x] Prove path replacement, rollback and two-instance rotation on disposable PostgreSQL. Inspect the query plan for indexed lookup. Record any missing process-level proof.
- [x] Update Studio workflow docs and public workflow docs in all three languages, including rollout, conflicts and in-flight requests.
- [x] Review the full diff, run affected tests and typechecks, and finish the handoff. Changelog generation waits for an authorized merge.
