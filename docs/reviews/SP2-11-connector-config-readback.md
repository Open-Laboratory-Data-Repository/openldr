# SP2-11: connector configuration readback

Worktree: `.worktrees/connector-config-readback`, branch `codex/connector-config-readback`, based on `2c7bc502`.
The operator approved this implementation batch. No commit, merge, push, or live configuration write was authorized.

## Refutation and scope

The refuting fact would be an existing safe configuration view used when reopening a connector.
At baseline, `apps/studio/src/pages/settings/Connectors.tsx:180` assigned an empty `dbConfig` on edit.
`packages/db/src/connector-store.ts:48` deliberately excludes encrypted configuration from normal records.
`packages/db/src/connector-store.ts:98` replaces configuration when a patch includes it. Re-entering ordinary fields could therefore remove omitted credentials.

The implementation adds authorized host configuration inspection and preserves omitted credentials during host edits.
It does not expose plugin configuration, URLs, or unknown configuration keys.
No migration or credential re-entry is needed for existing encrypted records.

## Implementation

1. `packages/bootstrap/src/connector-config.ts` defines per-type ordinary-field allowlists. The inspection result contains `config` and boolean `secretsSet` maps. Passwords, OAuth secrets, refresh tokens, URLs, and unknown keys never enter that view.
2. The shared host updater merges a patch into decrypted configuration before resealing it. Missing fields remain stored. Empty secret inputs preserve existing secrets. Unknown submitted host keys are rejected; legacy stored keys survive internally. Name-only patches do not need the encryption key.
3. `GET /api/connectors/:id/config` requires `connectors.manage` and returns `Cache-Control: no-store`. Read failures return a generic error. Update failures cannot expose decrypted parser errors. Creation audit metadata no longer copies arbitrary configuration keys.
4. Studio loads the safe view before opening a host editor. Secret placeholders reflect stored presence. The sheet uses its required MoreHorizontal menu for Save. This follows AGENTS section 5 and the operator's ruling for this edited sheet only. The standard close control remains.
5. `openldr connectors inspect <id>` prints the same safe view. `openldr connectors update <id> --file patch.json` updates host connectors through the same bootstrap function. It records `actorName: 'cli'` and excludes configuration values from audit metadata and output.
6. Studio connector guides and the public Getting started guide explain readback, secret preservation, CLI use, and the Save menu in English, French, and Portuguese.

## Verification

All commands ran inside this worktree. Regression tests failed before the corresponding code changes.
Initial route tests returned 404 for inspection and lost database/password fields after a partial edit.
Initial UI readback returned an empty host. The menu test found a standalone Save button.
The rename test caught unchanged configuration being resent. The optional-field test caught a cleared username being ignored. Security tests caught arbitrary audit keys and parser-error disclosure.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Dependencies installed without changing the lockfile |
| `pnpm --filter @openldr/server test -- src/connectors-routes.test.ts --maxWorkers 1 --minWorkers 1` | 29 tests passed, exit 0 |
| `pnpm --filter @openldr/bootstrap test -- src/connector-config.test.ts --maxWorkers 1 --minWorkers 1` | 2 tests passed, exit 0 |
| `pnpm --filter @openldr/cli test -- src/connectors.test.ts src/connectors-execution.test.ts --maxWorkers 1 --minWorkers 1` | 2 tests passed, exit 0 |
| `pnpm --filter @openldr/studio test -- src/pages/settings/Connectors.test.tsx src/docs/registry.test.ts src/docs/validation.test.ts --maxWorkers 1 --minWorkers 1` | 54 tests passed, exit 0 |
| `pnpm --filter @openldr/web test -- src/docs/DocsPage.test.tsx --maxWorkers 1 --minWorkers 1` | 15 tests passed, exit 0 |
| `pnpm --filter @openldr/bootstrap --filter @openldr/server --filter @openldr/cli --filter @openldr/studio typecheck` | Four packages passed, exit 0 |
| `pnpm --filter @openldr/cli --filter @openldr/studio typecheck` | Final CLI and Studio changes passed, exit 0 |
| `git diff --check` | Exit 0 |

The API tests exercise Fastify permissions and response JSON with an in-memory store.
Bootstrap tests exercise the real encrypted store on pg-mem. They cover legacy credentials, blank and rotated secrets, unknown stored fields, and name-only updates without a key.
CLI execution tests exercise shared logic with a fake application context and a temporary patch file.
Studio tests exercise rendered fields and submitted requests in jsdom.
Existing React Router, WASI, and web jsdom scrollTo warnings remain.

## Limits and follow-up

HONEST NON-PROOF: these tests do not prove connectivity to a database, mail service, or plugin. No live connector was modified or tested.
The root agent owns the browser pass. A temporary local preview on port 5182 intercepts every API call and uses synthetic data. Its temporary files are not deliverables.
Only a real phone can confirm behavior with retractable browser chrome. No physical-phone test ran here.
No concurrency guarantee was added: simultaneous edits can still overwrite another editor's ordinary values.
Plugin credential editing retains its existing all-fields-together rule. URL readback remains omitted because URLs can embed credentials or tokens.
No full repository suite ran. No landing changelog was generated because no merge occurred; the repository requires generation after merging to main.

## Independent review correction

The new allowlist initially rejected the existing MySQL sslRejectUnauthorized setting.
The runtime reads it in packages/bootstrap/src/connector-db.ts:66. The MySQL allowlist now
includes this ordinary setting. No secret field was added to readback.
A regression first failed with expected false, received undefined. After the correction,
pnpm --filter @openldr/bootstrap test src/connector-config.test.ts reported 3 passed.
The test verifies readback, update, and retention of the stored password. It exercises the
shared helper with an encrypted test store, not a live MySQL TLS connection.
Review of Mongo, Redis, email, IMAP and SFTP config reads found no further omitted ordinary keys.


The parent inspected the mocked browser at 375 by 812 pixels. Host, port, database and user
were prefilled. The password stayed empty with its stored-secret placeholder. Changing the
host to new-db.example.test and choosing Save in the menu showed Saved Example lab database.
Reopening showed the new host. Document width was 375 pixels and sheet height was 812 pixels.
The parent closed the tab, stopped preview session 12909 and removed all three preview files.
HONEST NON-PROOF: this does not establish a live connection or physical-phone behavior.
