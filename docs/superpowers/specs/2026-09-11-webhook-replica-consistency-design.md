# Webhook consistency across API instances

P14 is the authorized scope. Main starts at `138b83dd`. No commits, merges or pushes are authorized for this slice yet.

## Evidence and goal

The gap would be false if webhook authentication already read shared current credentials. It does not. `packages/workflows/src/webhook-registry.ts:51` creates a process-local map. `apps/server/src/workflows-routes.ts:17` refreshes only that context after a save, and line 476 authenticates against its entry.

After a workflow edit completes, every upgraded API instance must use its current path and secret. Requests already authenticated before the edit may finish. This does not add durable webhook acceptance or revoke running workflows.

## Chosen approach

Use an indexed shared path lookup and resolve credentials at request time. Notifications alone can be missed. Periodic cache refresh leaves a window where revoked secrets remain accepted. A shared lookup has a database cost per request but no invalidation delay.

Migration 096 adds a derived `workflow_webhook_paths` table with a workflow foreign key, normalized path, and an index for path lookup. WorkflowStore create and update replace that workflow's derived paths in the same transaction as its definition. Delete cascades. Backfill existing definitions in bounded batches. All current workflow writers use this store.

The store exposes `findByWebhookPath(path)`, returning at most two enabled workflow candidates through the index. The resolver inspects current definitions and resolves the matching secret reference afresh. It retains no credentials between requests. A missing path returns no entry. Missing or undecryptable secrets deny authentication. Database failures return a generic retryable error without falling back to memory.

Conflicting paths fail closed. Do not select an arbitrary workflow when multiple enabled workflows or multiple trigger nodes claim the same path. Existing duplicates remain representable during migration, but operators must give them unique paths before using them.

The existing in-memory registry can remain a pure test utility. Production bootstrap uses only the shared resolver. Remove production startup and route cache synchronization. Schedule and ingest behavior is outside this change.

## Compatibility and rollout

Preserve slash normalization, header-only token authentication, constant-time comparison and existing successful response shapes. Disabled and deleted workflows cannot authenticate new requests. No payload logging or plaintext database credential copies are introduced.

Stop all old API instances and old workflow writers before migration 096. Run the migration, then start upgraded instances. Old writers cannot maintain the derived path index. This release requires downtime. Mixed-version writes and uninterrupted upgrades belong to P15. A live encryption-key change is outside scope; instances must share the configured key.

No new UI controls are needed. Existing workflow saves gain shared behavior. Existing bootstrap/store callers use the same path indexing, including headless seed/import paths. Document operator behavior in Studio and public docs in English, French and Portuguese.

## Acceptance

Use two independent application contexts against one disposable PostgreSQL database. Save or rotate through one, then request both. Verify old-secret rejection, new-secret acceptance, new-path visibility, old-path removal, disable/delete rejection, conflict rejection and failure-closed lookup. Include process-boundary HTTP proof if the existing test setup supports it. State precisely if only independent contexts were tested.

Verify transactional path replacement and indexed bounded lookup on real PostgreSQL. Unit tests alone cannot establish transaction rollback or cross-instance consistency. Do not touch live clinical data or deployed secrets.
