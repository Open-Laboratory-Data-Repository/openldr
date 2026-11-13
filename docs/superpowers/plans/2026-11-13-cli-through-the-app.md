# CLI through the app implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `openldr` CLI commands through the running app as a signed-in caller, with access keys for an AI and `openldr login` for people.

**Architecture:** The server gains access keys, checked at sign-in beside tokens. A new endpoint runs one CLI command per request as a child process of the server, after a capability check, and streams its output back. The CLI gains a table that says how each command runs and what it needs, and a client that sends through-the-app commands to that endpoint. The command functions themselves do not change.

**Tech stack:** TypeScript, Node, Fastify, Kysely on Postgres, commander, vitest, React with shadcn in `apps/studio`.

**Spec:** `docs/superpowers/specs/2026-11-13-cli-through-the-app-design.md`. Read it first. This plan argues from it.

## Global constraints

- `AuthPort` does not change (`packages/ports/src/auth.ts`). If a task seems to need a port change, stop and report.
- No branch on the tier inside `packages/*` or `apps/server`. New behaviour there is a generic setting.
- No flag, setting or environment variable lets a caller run a database command with no sign-in, outside the recovery list. The one temporary switch in Task 10 is removed in Task 12.
- Existing commands keep their names, options and output. The 651 CLI tests keep passing with no change to what they assert. Widening an import line is allowed.
- The command functions in `packages/cli/src/*.ts` are not rewritten. Only the places this plan names are edited.
- A key, token, password or session value never reaches a log line, an audit row, an error message, a URL or a command line.
- A through-the-app caller never names a path on the server's disk.
- Fixed values: key prefix `oldr_`. Key body 32 random bytes in base64url. "Last used" written at most once every 60 seconds per key. Session limits as design A set them. Default server address `http://127.0.0.1:3000`. `CLI_MAX_RUNNING` default 2. A waiting command gets "busy" after 30 seconds. An interrupted process is killed after 10 seconds. `CLI_MAX_UPLOAD_BYTES` default 2 GiB.
- The next internal migration is 117. Before adding it, run `git branch -a` and check no branch adds an internal migration numbered 117 or higher. If one does, use the next free number everywhere this plan says 117.
- UI follows AGENTS.md section 5. shadcn only. `h-dvh`, never `h-screen`. Every string lands in en, fr and pt in the same task, because `apps/studio/src/i18n/parity.test.ts` fails otherwise.
- `packages/config/src/env-docs.test.ts` fails when a setting the server reads is not on its seven pages. Each task that adds a server setting documents it there.
- `apps/server` lint enforces `return reply.send`. Run `pnpm --filter @openldr/server lint` in every task that touches a route.
- All prose follows the `unslop` skill. No em dashes. Docs land in en, fr and pt.
- One commit per task. No `Co-Authored-By` trailer. Do not push.
- Only Linux can be tested here. Mark every Windows and macOS claim as unproven.
- Safety on the build machine: a dev stack is running and in use. Never stop or change it. Never point branch code at the databases `openldr`, `openldr_target`, `openldr_docs`, `openldr_docs_target` or `keycloak`. From a worktree, `loadConfig()` finds the main checkout's `.env`: set `OPENLDR_SKIP_ENV_FILE=true` or override both database URLs for anything you start. Never run `pnpm --filter @openldr/server build:check` bare. Use ports 3990 to 3997, scratch databases named `sa_scratch_*`, and temp folders, and remove them afterwards.
- Full gate, at the end, never piped through `tail`: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`, plus `pnpm depcruise`, which reports 21 violations on `main` and must not rise.

## Review focus

Five conditions the spec implies and a person or an AI will hit. Each has a test in the task named.

1. A key keeps working after its account was disabled or its role was cut. The next request must be refused or limited, with no restart. Task 3.
2. A caller sends a real server path as a file argument, such as `--file /etc/hostname` or `../x`. The command must refuse before it reads anything. Task 8.
3. A caller names one command for the capability check and sends arguments for another. The child must refuse. Task 8.
4. The server stops, or the caller leaves, while a command runs. The process must end, the request folder must be removed, and no process may be left behind. Task 9.
5. A file with spaces or non-ASCII letters in its name, an empty file, and a file over the limit. The first two work. The third fails with a message that names the limit and leaves nothing on disk. Tasks 9 and 10.

## File map

| File | Responsibility |
|---|---|
| `packages/db/src/migrations/internal/117_access_keys.ts` | The `access_keys` table |
| `packages/db/src/access-key-store.ts` | Reads and writes of that table |
| `packages/bootstrap/src/access-keys.ts` | Making, hashing, resolving and revoking keys, with audit |
| `apps/server/src/access-key-auth.ts` | Turning a key in a request into a signed-in account |
| `apps/server/src/access-key-routes.ts` | The key routes |
| `apps/studio/src/users/AccessKeysSheet.tsx` | The key list and the "new key" form |
| `packages/cli/src/command-meta.ts` | How each command runs and what it needs. Data only |
| `packages/cli/src/command-list.ts` | The command list built from the commander tree and that data |
| `packages/cli/src/wire.ts` | The frames the client and the server exchange |
| `packages/cli/src/served.ts` | The child side: reading the server's hand-off and enforcing it |
| `apps/server/src/cli-runner.ts` | Starting, limiting, interrupting and cleaning up command processes |
| `apps/server/src/cli-routes.ts` | The run and interrupt routes |
| `packages/cli/src/client/credentials.ts` | Which credential and server address a command uses |
| `packages/cli/src/client/run-through-app.ts` | Sending a command and handling the stream |
| `packages/cli/src/client/session.ts` | `login`, `logout`, `whoami` |

---

### Task 1: The access key table and store

**Files:**
- Create: `packages/db/src/migrations/internal/117_access_keys.ts`, `packages/db/src/access-key-store.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (register 117 after `116_local_sign_in`), the schema types under `packages/db/src/schema`, `packages/db/src/index.ts` (export the store)
- Test: `packages/db/src/access-key-store.test.ts`, `packages/db/src/migrations/internal/117_access_keys.test.ts`

Follow `116_local_sign_in.ts` and `local-auth-store.ts` for shape.

**Interfaces:**
- Produces:

```ts
export interface AccessKeyRecord {
  id: string; userId: string; name: string; prefix: string;
  createdBy: string | null; createdAt: string;
  expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null;
}
export interface AccessKeyStore {
  create(input: { userId: string; name: string; keyHash: string; prefix: string; createdBy: string | null; expiresAt: string | null }): Promise<AccessKeyRecord>;
  /** Newest first, then by id, so the order is stable. */
  listForUser(userId: string): Promise<AccessKeyRecord[]>;
  /** Null when no key has this hash, or it is revoked, or it has expired at `now`. */
  findUsableByHash(keyHash: string, now: Date): Promise<AccessKeyRecord | null>;
  /** False when no such key belongs to that user or it was already revoked. */
  revoke(id: string, userId: string, now: Date): Promise<boolean>;
  /** One conditional update: writes only when last_used_at is null or more than 60 seconds before `now`. */
  touchLastUsed(id: string, now: Date): Promise<void>;
}
export function createAccessKeyStore(db: Kysely<InternalDatabase>): AccessKeyStore;
```

Table rules: `user_id` references `users.id` and cascades on delete. `key_hash` is unique. The key itself is never a column.

- [ ] **Step 1: Check the migration number.** Run `git branch -a`, then for each branch `git diff --name-only main...<branch> -- packages/db/src/migrations/internal`. Record the result.
- [ ] **Step 2: Write the failing tests**

```ts
it('creates the table and drops it again', async () => {});
it('stores a key and lists it for its user, newest first', async () => {});
it('finds a usable key by hash, and not a revoked or expired one', async () => {});
it('refuses a second key with the same hash', async () => {});
it('revokes only a key that belongs to that user, once', async () => {
  expect(await store.revoke(k.id, 'other-user', now)).toBe(false);
  expect(await store.revoke(k.id, k.userId, now)).toBe(true);
  expect(await store.revoke(k.id, k.userId, now)).toBe(false);
});
it('writes last used at most once in 60 seconds', async () => {
  // touch at t0, t0+30s, t0+61s: stored values are t0, t0, t0+61s
});
it('removes a user\'s keys when the user is deleted', async () => {});
```

- [ ] **Step 3: Run and confirm failure**

Run: `pnpm --filter @openldr/db exec vitest run src/access-key-store.test.ts`

- [ ] **Step 4: Implement the migration and the store**
- [ ] **Step 5: Run the db suite and typecheck**
- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): access keys table and store"
```

---

### Task 2: Access key logic and a password-less account

**Files:**
- Create: `packages/bootstrap/src/access-keys.ts`
- Modify: `packages/bootstrap/src/index.ts` (add `accessKeys: AccessKeyStore` to `AppContext` near `:472` and build it where the other stores are built; export the new functions), `packages/bootstrap/src/local-accounts.ts:80` (`createLocalAccount`)
- Test: `packages/bootstrap/src/access-keys.test.ts`, `packages/bootstrap/src/local-accounts.test.ts`

**Interfaces:**
- Consumes: `AccessKeyStore` (Task 1).
- Produces:

```ts
export const ACCESS_KEY_PREFIX = 'oldr_';
/** `oldr_` plus 32 random bytes in base64url. */
export function generateAccessKey(): string;
/** SHA-256 of the whole key, hex. Keys are random, so a fast hash is right. */
export function hashAccessKey(key: string): string;
export function looksLikeAccessKey(value: string): boolean; // starts with the prefix
export class UnknownAccessKeyError extends Error {}
export async function createAccessKey(ctx: KeyContext, actor: AuditActor, input: { userId: string; name: string; expiresAt?: string | null }): Promise<{ record: AccessKeyRecord; key: string }>;
export async function listAccessKeys(ctx: KeyContext, userId: string): Promise<AccessKeyRecord[]>;
export async function revokeAccessKey(ctx: KeyContext, actor: AuditActor, input: { userId: string; keyId: string }): Promise<void>;
/** Null for anything that is not a usable key. Calls touchLastUsed on success. */
export async function resolveAccessKey(ctx: KeyContext, key: string, now: Date): Promise<AccessKeyRecord | null>;
```

- `createAccessKey` refuses an unknown user, an empty name, a name over 80 characters, and an expiry in the past. The stored `prefix` is the first 12 characters of the key.
- Audit actions: `access_key.create` and `access_key.revoke`, entity type `access_key`, entity id the key's id. Metadata holds the key's name, its prefix and the user id. Never the key or its hash.
- `createLocalAccount` gains an option `password: 'temporary' | 'none'`, default `'temporary'`. With `'none'` it makes no credential row and returns no password.

- [ ] **Step 1: Write the failing tests**

```ts
it('makes a key with the prefix and 43 body characters, different every time', () => {});
it('stores only the hash and the first 12 characters', async () => {
  const { record, key } = await createAccessKey(ctx, actor, { userId, name: 'assistant' });
  const rows = JSON.stringify(await allRowsOf('access_keys'));
  expect(rows).not.toContain(key); expect(record.prefix).toBe(key.slice(0, 12));
});
it('resolves a fresh key, and not a revoked, expired or unknown one', async () => {});
it('refuses an unknown user, an empty name and a past expiry', async () => {});
it('audits create and revoke without the key or its hash', async () => {});
it('revoking a key of another user throws UnknownAccessKeyError and changes nothing', async () => {});
it('creates an account with no password and no credential row', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the bootstrap suite and typecheck**
- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap
git commit -m "feat(auth): access key logic and accounts with no password"
```

---

### Task 3: Keys at sign-in, and the key routes

**Files:**
- Create: `apps/server/src/access-key-auth.ts`, `apps/server/src/access-key-routes.ts`
- Modify: `apps/server/src/auth-plugin.ts` (the `onRequest` hook near `:107`, and `RequestActor` at `:7`), `apps/server/src/app.ts` (register the routes), `apps/server/src/audit-helper.ts` (`actorFromRequest`)
- Test: `apps/server/src/access-key-auth.test.ts`, `apps/server/src/access-key-routes.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `RequestActor` gains `accessKey?: { id: string; name: string }`.
- In the hook: when the bearer value `looksLikeAccessKey`, it is resolved as a key and never passed to `verifyToken`. An unusable key answers 401 `{ error: 'invalid access key' }`. A key whose account is blocked or disabled answers 403 `{ error: 'account disabled' }`. Capabilities come from `ctx.roles.resolveCapabilities` for the account, on every request.
- The `access_token` query parameter is never treated as a key. A key there answers 401.
- Routes, all guarded by `users.manage`:
  - `GET /api/users/:id/keys` answers `{ keys: AccessKeyRecord[] }`.
  - `POST /api/users/:id/keys` with `{ name: string, expiresAt?: string | null }` answers 201 `{ key: string, record: AccessKeyRecord }`. This is the only response that ever holds a key.
  - `DELETE /api/users/:id/keys/:keyId` answers 204, or 404 for a key that is not that user's.
- `actorFromRequest` adds `via: 'access-key'` and the key's name to the actor's detail when `req.user.accessKey` is set. Read how the audit actor carries detail today and follow it.

- [ ] **Step 1: Write the failing tests**

```ts
it('signs a request in with a key and gives it the account\'s capabilities', async () => {});
it('refuses a revoked key, an expired key and a made-up key with 401', async () => {});
it('refuses a key whose account was disabled after the key was made', async () => {});
it('limits a key at once when its account loses a role', async () => {
  // request passes, role removed, the same key now gets 403 on the same route
});
it('never calls verifyToken for a value with the key prefix', async () => {});
it('does not accept a key in the access_token query parameter', async () => {});
it('answers the key once on create and never on list', async () => {});
it('needs users.manage for all three routes', async () => {});
it('answers 404 when revoking another user\'s key', async () => {});
it('writes neither the key nor its hash to the log or the audit rows', async () => {
  // capture the logger; create, use and revoke a key; search every line and row
});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement.** Each handler returns what it sends.
- [ ] **Step 4: Run the server suite, lint and typecheck**
- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): sign in with an access key, and routes to manage keys"
```

---

### Task 4: Access keys in Studio

**Files:**
- Create: `apps/studio/src/users/AccessKeysSheet.tsx`
- Modify: `apps/studio/src/pages/Users.tsx` (a row action "Access keys" in the existing dots menu near `:157`), `apps/studio/src/api.ts`, `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/users/AccessKeysSheet.test.tsx`, `apps/studio/src/pages/Users.test.tsx`

The Users page opens `UserDialog` and `ResetPasswordDialog` today. Those predate the sheet rule. Do not convert them. Add the keys as a new `Sheet`, opened from the row's dots menu. Copy `forms-builder/FieldEditorSheet.tsx` for the sheet and `pages/settings/Connectors.tsx` for the form rows.

**Interfaces:**
- Consumes: the three routes from Task 3.
- Produces in `api.ts`: `listAccessKeys(userId)`, `createAccessKey(userId, { name, expiresAt })`, `revokeAccessKey(userId, keyId)`.

Behaviour:

- The sheet's title names the user. Its dots menu holds "New key".
- The list is a `Table` with `TablePagination`: name, prefix, created, expires, last used, status. Each row's dots menu holds "Revoke", which asks for confirmation.
- Empty state is `StripedEmpty`. Loading is `LoadingState`. Render `<Table>` only when there are rows.
- "New key" shows a form in the sheet: name on one row, optional expiry date on the next, label left and input right.
- After creation the sheet shows the key once, in a read-only field with a copy button, and one line: it cannot be shown again. Closing the sheet clears it from memory.
- The row action is shown only to a user with `users.manage`.
- At 375 px wide the sheet has no sideways scroll.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists a user\'s keys with pagination', async () => {});
it('shows the striped empty state with no keys, and the spinner while loading', async () => {});
it('creates a key and shows it once with a copy button', async () => {});
it('does not show the key again after the sheet is closed and reopened', async () => {});
it('revokes a key after confirmation', async () => {});
it('hides the row action without users.manage', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement, with every string in en, fr and pt**
- [ ] **Step 4: Run the studio suite and typecheck**
- [ ] **Step 5: Commit**

```bash
git add apps/studio
git commit -m "feat(studio): manage a user's access keys"
```

The phone layout is checked for real in Task 15. Say in the report that it is not yet proven.

---

### Task 5: Key commands and `user create --no-password`

**Files:**
- Modify: `packages/cli/src/user.ts`, `packages/cli/src/program.ts` (the `user` group)
- Test: `packages/cli/src/user.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces three commands and one option, in the style of their neighbours:
  - `openldr user key list <username> [--json]`
  - `openldr user key create <username> --name <name> [--expires <date>] [--json]`. It prints the key once, on its own line, and one line saying it cannot be shown again.
  - `openldr user key revoke <username> <keyId> --force`. It refuses without `--force`.
  - `openldr user create ... --no-password`.

They are ordinary command functions. They build a context and call the Task 2 functions, like the commands beside them.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists keys as text and as JSON, without any key value', async () => {});
it('creates a key and prints it once', async () => {});
it('refuses to revoke without --force', async () => {});
it('revokes a key and audits it', async () => {});
it('creates an account with no password and prints no password', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli suite and typecheck**
- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): key commands and accounts with no password"
```

---

### Task 6: How each command runs

**Files:**
- Create: `packages/cli/src/command-meta.ts`, `packages/cli/src/command-list.ts`
- Modify: `packages/cli/src/program.ts` (one new command, `commands`), `packages/cli/package.json` (exports `"./meta": "./src/command-meta.ts"`)
- Test: `packages/cli/src/command-meta.test.ts`, `packages/cli/src/command-list.test.ts`

`command-meta.ts` is data. It imports nothing from the command files, the bootstrap package or the config package. The server will import it.

**Interfaces:**
- Produces:

```ts
export type CommandKind = 'app' | 'recovery' | 'local';
export type PathKind = 'input-file' | 'input-dir' | 'output-file' | 'output-dir';
export interface PathMark {
  /** An option's long flag such as '--out', or a positional argument's name such as 'file'. */
  target: string;
  /** A function when the kind depends on the other arguments. */
  kind: PathKind | ((args: string[], opts: Record<string, unknown>) => PathKind);
  /** True when the server keeps the upload after the request, for a command that needs it again. */
  keep?: boolean;
}
export interface CommandMeta { kind: CommandKind; capability?: string; destructive?: boolean; paths?: PathMark[] }
/** Keyed by the command's path, words joined by one space: 'roles list', 'user key create'. */
export const COMMAND_META: Readonly<Record<string, CommandMeta>>;

// command-list.ts
export function commandPath(cmd: Command): string;
export interface CommandEntry {
  path: string; description: string;
  arguments: { name: string; required: boolean; variadic: boolean }[];
  options: { flags: string; description: string }[];
  kind: CommandKind; capability: string | null; destructive: boolean;
}
export function listCommands(program: Command): CommandEntry[];
```

Fill `kind`, `paths` and `destructive` for every command in this task. `capability` is Task 7.

- `recovery` is exactly: `db migrate`, `db reset`, `db seed`, `doctor`, `health`, `target-store test`, `storage copy`, `auth setup-code`, `auth rebind-issuer`, `user reset-password`.
- `local` is every command that touches no database and no server. Start from `artifact keygen`, `new`, `build`, `pack`, `sign`, `test`, `market verify`, `fhir validate`, `errors list`, `facilities suggest-map`, plus `commands`, `login`, `logout` and `whoami`. Read each command's code to confirm. Add any other you find, and name it in the report.
- A command with a local part and a database part is a finding. `artifact publish` is one: `--to` is local and `--install` uses the database. Report each such command with its options. Do not split it in this task.
- `destructive` is true for every command that refuses without `--force` today.
- `paths` marks every argument and option that names a file or folder. `terminology import <kind> <path>` needs the function form. `terminology ontology build <systemId> <dir>` is an input folder with `keep: true`.
- `openldr commands [--json]` prints `listCommands`. It works with no server and no database settings.

- [ ] **Step 1: Write the failing tests**

```ts
it('has an entry for every command in the program and no entry for a command that does not exist', () => {
  const paths = leafCommands(buildProgram()).map(commandPath).sort();
  expect(Object.keys(COMMAND_META).sort()).toEqual(paths);
});
it('marks exactly the ten recovery commands', () => {
  expect(byKind('recovery')).toEqual([...TEN_PATHS].sort());
});
it('marks every option and argument whose name or placeholder names a file, path, dir or folder', () => {
  // walk the tree; any '<file>', '<path>', '<dir>', '<folder>', '--out', '--file' not in paths fails,
  // unless it is in a short allow-list of names that are not paths, each with a reason
});
it('marks destructive every command that has a --force option', () => {});
it('command-meta imports nothing from bootstrap, config or a command file', async () => {
  // read the file's import lines
});
it('prints the list as JSON with one row per command and no secrets', async () => {});
it('a local command\'s code reaches no context builder', async () => {
  // for each local command's handler module, assert the handler does not call createAppContext,
  // createDbContext, createIngestContext, createTerminologyContext or loadConfig. Say how you checked.
});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli suite and typecheck, and `pnpm depcruise`**
- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): record how each command runs, and list the commands"
```

---

### Task 7: The capability for every command

**Files:**
- Modify: `packages/cli/src/command-meta.ts`, `packages/rbac/src/catalog.ts`, `packages/rbac/src/presets.ts` if a preset needs a new key, the Studio i18n files where capability labels are translated (`apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`, near the `capability` block)
- Test: `packages/cli/src/command-meta.test.ts`, `packages/rbac/src/catalog.test.ts`, `packages/rbac/src/presets.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces: `capability` set on every `app` command. `recovery` and `local` commands have none.

Rules:

- Where a route does the same thing, use the key in that route's `requireCapability`. Cite the route in a comment beside each group.
- A command that only reads uses the area's view key. A command that writes uses the key the matching Studio action needs.
- The key commands from Task 5 use `users.manage`. `user list` and `user show` use `users.view`.
- For an area with no key, add keys to `catalog.ts` in a new group, one for reading and one for writing where both exist. Likely areas: storage, the target store, the ingest pipeline and queue, plugins, provenance, the import tools. Confirm command by command.
- `lab_admin` holds every key already, because it takes `CAPABILITY_KEYS`. No other preset gains a new key unless the matching Studio screen already gives that role the same power. Say which, if any.
- Every new key has a label and a description in en, fr and pt.
- Put a table in the report: each group, its commands, the key, and the route or reason.

- [ ] **Step 1: Write the failing tests**

```ts
it('gives every app command a capability that is in the catalog', () => {});
it('gives no capability to a recovery or local command', () => {});
it('a command named list, show, status, inspect or export does not need a write key', () => {
  // a short allow-list of exceptions, each with a reason
});
it('lab_admin holds every new key and the other presets are unchanged unless listed', () => {});
it('every catalog key has a label in en, fr and pt', () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli, rbac, studio and server suites and their typechecks.** `roles doctor` logic must report no drift for the presets.
- [ ] **Step 5: Commit**

```bash
git add packages/cli packages/rbac apps/studio
git commit -m "feat(rbac): a capability for every CLI command"
```

---

### Task 8: The child side

**Files:**
- Create: `packages/cli/src/served.ts`
- Modify: `packages/cli/src/index.ts`, `packages/cli/src/program.ts` (one `preAction` hook), `packages/cli/src/cli-actor.ts`, `packages/cli/src/terminology.ts:269`, `packages/cli/src/market.ts:76`
- Test: `packages/cli/src/served.test.ts`, `packages/cli/src/cli-actor.test.ts`

When the server starts the CLI, it hands over one JSON message on file descriptor 3. The CLI then runs in served mode.

**Interfaces:**
- Consumes: Task 6.
- Produces:

```ts
export interface ServedHandoff {
  /** The command the capability check was made for. */
  path: string;
  /** The caller's tokens after the program name. Path values are real paths inside runDir. */
  argv: string[];
  caller: { id: string; username: string; displayName: string | null; keyName: string | null };
  /** The folder made for this one request. */
  runDir: string;
  /** Folders outside runDir that this request may also use, for kept uploads. */
  keptDirs: string[];
}
export const SERVED_FD = 3;
/** Null when the process was not started by the server. */
export function readHandoff(): ServedHandoff | null;
export function servedHandoff(): ServedHandoff | null; // the one read at start, for the rest of the CLI
```

- The CLI looks for a hand-off only when the environment has `OPENLDR_SERVED_FD=3`, which the server sets for the processes it starts. Without it, descriptor 3 is never read.
- `index.ts`: with a hand-off, parse `['node', 'openldr', ...handoff.argv]`. With none, parse `process.argv` as today.
- Be plain in a comment about the limit: served mode is the server's own hand-off, not a feature. Someone who already holds the database settings could imitate it, and that person is outside what this design bounds (spec 6.8).
- The `preAction` hook, in served mode, refuses and exits 1 before any action when:
  - the command's path is not `handoff.path`
  - the command's kind is not `app`
  - `--actor` or `--approved-by` was given. Message: `--actor cannot be used through the app. The signed-in account is recorded.` and the same for `--approved-by`.
  - any value of a marked path lies outside `runDir` and `keptDirs` after resolving it, or is not absolute
- `cliActor()` in served mode returns `{ actorType: 'user', actorId: caller.id, actorName: caller.username }`. Add the detail that it came through the CLI, and the key's name, the way Task 3 did for routes.
- `terminology.ts:269` and `market.ts:76` record the caller's username in served mode and `'cli'` otherwise. Use one helper for both.
- Outside served mode nothing changes in this task.

- [ ] **Step 1: Write the failing tests**

```ts
it('reads the hand-off from descriptor 3 and returns null when there is none', async () => {
  // spawn the built or tsx-registered entry with and without a fourth stdio pipe
});
it('runs the command in the hand-off with its output unchanged', async () => {});
it('refuses when the arguments name a different command than the hand-off path', async () => {
  // path 'roles list', argv ['user','key','create',...]: exit 1, no action ran
});
it('refuses a recovery command and a local command in served mode', async () => {});
it('refuses --actor and --approved-by in served mode with the message', async () => {});
it('refuses a marked path outside the request folder', async () => {
  for (const p of ['/etc/hostname', '../x', 'relative.json', runDir + '/../y']) { /* exit 1, nothing read */ }
});
it('accepts a marked path inside the request folder and inside a kept folder', async () => {});
it('records the account as the audit actor in served mode, and cli otherwise', async () => {});
it('records the caller as createdBy and as the default approver in served mode', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli suite and typecheck.** No existing test may change what it asserts.
- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): run a command handed over by the server"
```

---

### Task 9: Running a command in the server

**Files:**
- Create: `packages/cli/src/wire.ts`, `apps/server/src/cli-runner.ts`, `apps/server/src/cli-routes.ts`, `apps/server/src/__fixtures__/fake-cli.mjs`
- Modify: `packages/cli/package.json` (exports `"./wire": "./src/wire.ts"`), `apps/server/package.json` (dependency `@openldr/cli`), `apps/server/src/app.ts`, `apps/server/src/start.ts` (stop running commands in the shutdown, before the context closes), `packages/config/src/schema.ts`, the seven environment docs pages, `.env.example`
- Test: `packages/cli/src/wire.test.ts`, `apps/server/src/cli-runner.test.ts`, `apps/server/src/cli-routes.test.ts`

**Interfaces:**
- Consumes: `COMMAND_META` (Tasks 6 and 7), `ServedHandoff` and `SERVED_FD` (Task 8).
- Produces the settings: `CLI_ENTRY` (a path to the CLI's entry file; when unset, `<folder of the server's entry file>/../cli/dist/index.js`), `CLI_MAX_RUNNING` (default 2), `CLI_MAX_UPLOAD_BYTES` (default 2147483648).
- Produces the wire format. Both directions are lines of JSON (`application/x-ndjson`). Bytes travel as base64 in chunks of at most 64 KiB.

```ts
// wire.ts
export const PATH_PLACEHOLDER = '@@'; // a path value in argv is '@@' + ref
export type ClientFrame =
  | { t: 'start'; version: string; path: string; argv: string[];
      inputs: { ref: string; kind: 'input-file' | 'input-dir'; name: string; keep: boolean }[];
      outputs: { ref: string; kind: 'output-file' | 'output-dir' }[] }
  | { t: 'file'; ref: string; rel: string }   // opens a file; rel is '' for an input-file
  | { t: 'data'; d: string }                  // bytes of the open file
  | { t: 'end' }                              // closes the open file
  | { t: 'go' };
export type ServerFrame =
  | { t: 'run'; id: string }
  | { t: 'out'; d: string } | { t: 'err'; d: string }
  | { t: 'file'; ref: string; rel: string } | { t: 'data'; d: string } | { t: 'end' }
  | { t: 'exit'; code: number }
  | { t: 'error'; message: string };
export function encodeFrame(f: ClientFrame | ServerFrame): string;
export function decodeFrames<T>(source: AsyncIterable<Uint8Array>): AsyncIterable<T>;
```

- Produces the routes:
  - `POST /api/cli/run`. Body: client frames. Answer: server frames, streamed, with compression off for this route.
  - `POST /api/cli/runs/:id/interrupt`. Answers 204. Only the account that started the run may interrupt it. Anyone else gets 404.
- Order inside a run: read `start`. Check the version equals the server's (`readAppVersion()`); a mismatch answers `error` naming both. Look up `COMMAND_META[path]`: unknown or not `app` answers 400. No signed-in account answers 401. Missing capability answers 403 `{ error: 'insufficient capability', capability }`. None of these starts a process or makes a folder.
- Then: make the request folder, write the inputs, replace each placeholder in `argv` with its real path, wait for a free slot (30 seconds, then 503 `{ error: 'busy' }`), start the process, send `run`, stream output, send output files, send `exit`, remove the folder.
- The process: `process.execPath` with `CLI_ENTRY`, stdio `['ignore', 'pipe', 'pipe', 'pipe']`, the server's own environment plus `OPENLDR_SERVED_FD=3`, the working folder set to the request folder. The hand-off goes down descriptor 3, then the pipe is closed. Nothing from the request goes on the command line or into the environment.
- The version the server compares is `readAppVersion()` (`apps/server/src/version.ts`). The client must send a value made by the same rule: `APP_VERSION` when set, else the root `package.json` version. If the CLI cannot import that function, move the rule to a place both can import, and say where.
- The request folder is `<work>/cli-runs/<id>`, where `<work>` is `TERMINOLOGY_WORK_DIR` or the system temp folder. A kept input goes to `<work>/cli-kept/<ref folder>` and is listed in `keptDirs`. Folders are mode 0700.
- An input `rel` and `name` are checked: no `..` part, no absolute path, no NUL, no backslash. A bad one answers `error` and removes the folder.
- Bytes received are counted. Over `CLI_MAX_UPLOAD_BYTES` answers `error` with a message that names the limit, and removes the folder.
- Interrupt, a closed connection, and server shutdown each send the process `SIGINT`, then `SIGKILL` after 10 seconds. The folder is removed after the process has gone.
- The route logs the command path, the account and the exit code. It never logs `argv`, a file name or file bytes.

- [ ] **Step 1: The proof, before anything else.** Write `fake-cli.mjs`: it reads descriptor 3, prints the hand-off's `argv` to standard output and the caller's username to standard error, sleeps when asked, and exits 0 on `SIGINT` after printing `interrupted`. Write one test that starts it through `cli-runner.ts` and checks the output, the exit code, and that `SIGINT` reaches it. If a process the server starts cannot be handed its arguments this way, stop and report.
- [ ] **Step 2: Write the remaining failing tests**

```ts
// wire.test.ts
it('round-trips every frame, and decodes frames split across chunks and several in one chunk', async () => {});
// cli-routes.test.ts, with CLI_ENTRY pointing at the fake
it('answers 401 with no credential and starts nothing', async () => {});
it('answers 403 with the capability name and starts nothing', async () => {});
it('answers 400 for an unknown, recovery or local command', async () => {});
it('refuses a client of another version with both versions in the message', async () => {});
it('streams output and the exit code of a command', async () => {});
it('hands the caller to the process and keeps the arguments off the command line and out of the environment', async () => {
  // the fake prints its own process.argv and Object.keys(process.env); neither holds a secret argument
});
it('uploads an input file and an input folder, and replaces the placeholders with real paths', async () => {});
it('accepts names with spaces and non-ASCII letters, and an empty file', async () => {});
it('refuses an input name that leaves the folder', async () => {});
it('refuses an upload over the limit, names the limit, and leaves no folder', async () => {});
it('sends an output file and an output folder back', async () => {});
it('removes the request folder after a clean run, a failed run and a refused run', async () => {});
it('runs two at once and makes the third wait, then answers busy after 30 seconds', async () => { /* fake timers */ });
it('interrupts a run when asked by its owner, and answers 404 to anyone else', async () => {});
it('interrupts a run when the connection closes, and kills it after 10 seconds if it ignores that', async () => {});
it('interrupts running commands on shutdown and leaves no process behind', async () => {});
it('logs the command path and exit code and never an argument or a file name', async () => {});
```

- [ ] **Step 3: Run and confirm failure**
- [ ] **Step 4: Implement.** Each handler returns what it sends. Document the three settings on the seven pages and in `.env.example`, where `CLI_ENTRY` is set for a checkout.
- [ ] **Step 5: Run the server, cli and config suites, lint, typechecks, and `pnpm depcruise`**
- [ ] **Step 6: Commit**

```bash
git add packages/cli packages/config apps/server apps/studio apps/web docs .env.example pnpm-lock.yaml
git commit -m "feat(server): run a CLI command as a signed-in caller"
```

---

### Task 10: The client

**Files:**
- Create: `packages/cli/src/client/credentials.ts`, `packages/cli/src/client/run-through-app.ts`
- Modify: `packages/cli/src/program.ts` (the root options and one function that rewires `app` commands)
- Test: `packages/cli/src/client/credentials.test.ts`, `packages/cli/src/client/run-through-app.test.ts`

**Interfaces:**
- Consumes: `wire.ts` (Task 9), `COMMAND_META` (Tasks 6 and 7).
- Produces:

```ts
// credentials.ts
export interface Credential { kind: 'key' | 'session' | 'none'; authorization: string | null }
export function serverUrl(opts: { url?: string; env: NodeJS.ProcessEnv }): string;
export function assertSafeUrl(url: string, env: NodeJS.ProcessEnv): void; // throws PlainHttpError
export async function findCredential(env: NodeJS.ProcessEnv, url: string): Promise<Credential>;
export class PlainHttpError extends Error {}
// run-through-app.ts
export async function runThroughApp(input: {
  path: string; tokens: string[]; meta: CommandMeta;
  parsedArgs: string[]; parsedOpts: Record<string, unknown>;
  url: string; credential: Credential;
  out: NodeJS.WritableStream; err: NodeJS.WritableStream; signals: NodeJS.EventEmitter;
}): Promise<number>;
```

- The root program gains `--url <address>`.
- The address is `--url`, then `OPENLDR_URL`, then `http://127.0.0.1:3000`.
- `assertSafeUrl` refuses `http:` to a host that is not `127.0.0.1`, `localhost` or `::1`, unless `OPENLDR_ALLOW_PLAIN_HTTP` is `true` or `1`. Message: `Refusing to send a credential over plain HTTP to <host>. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.`
- `findCredential` order: `OPENLDR_KEY`, then the file named by `OPENLDR_KEY_FILE`, then the session file (Task 11 writes it; until then this step finds none), then none.
- There is no `--key` option.
- `tokens` are the caller's words after the command path. The client replaces each marked path value with `@@<ref>`, by position, for `--flag value`, `--flag=value` and positional forms. An input file or folder that does not exist fails before any request, with the path in the message.
- Output files are written to a temporary name beside the target and renamed when the file is complete.
- On `401`: `Sign in first: openldr login, or set OPENLDR_KEY.` On `403`: `This account lacks the capability <key>.` On a refused connection: `Cannot reach OpenLDR at <url>. Is it running?` On `busy`: `OpenLDR is running other commands. Try again shortly.` Exit code 1 for each.
- The first `SIGINT` sends the interrupt request and keeps reading until `exit`. A second ends the client with code 130.
- Until Task 12, an `app` command runs through the app only when `OPENLDR_THROUGH_APP=1`. Task 12 removes that variable.

- [ ] **Step 1: Write the failing tests**, against a small HTTP server in the test that speaks the wire format.

```ts
it('picks the address from --url, then OPENLDR_URL, then the default', () => {});
it('refuses plain HTTP to another machine and allows it with the setting', () => {});
it('uses OPENLDR_KEY, then OPENLDR_KEY_FILE, then nothing', async () => {});
it('never puts the key in the URL', async () => {});
it('sends the command and prints output in order, and returns the exit code', async () => {});
it('replaces path values by position for --flag value, --flag=value and positionals', async () => {
  // includes a case where the same string appears twice and only one is a path
});
it('uploads a file with spaces and non-ASCII letters in its name, an empty file, and a folder', async () => {});
it('fails before any request when an input file does not exist', async () => {});
it('writes an output file only when it is complete', async () => {
  // the server drops the connection half way: no file and no partial file at the target
});
it('prints the right message for 401, 403, busy and a refused connection', async () => {});
it('sends an interrupt on the first SIGINT and keeps reading to the exit frame', async () => {});
it('does not run through the app without OPENLDR_THROUGH_APP', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli suite and typecheck**
- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): send a command through the app"
```

---

### Task 11: `login`, `logout` and `whoami`

**Files:**
- Create: `packages/cli/src/client/session.ts`
- Modify: `packages/cli/src/program.ts`, `packages/cli/src/client/credentials.ts`
- Test: `packages/cli/src/client/session.test.ts`

Read `apps/server/src/local-auth-routes.ts:185` to `:220` and `apps/server/src/session-cookie.ts` first. The session travels as a cookie. The client keeps the cookie's value and sends it back on `POST /api/auth/refresh`. If the server sets a new value on refresh, the client stores the new one.

**Interfaces:**
- Consumes: Task 10.
- Produces:

```ts
export function sessionFilePath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homedir: string): string;
export async function runLogin(opts: { url: string; username?: string; passwordStdin: boolean }, io: LoginIo): Promise<number>;
export async function runLogout(opts: { url: string }, io: LoginIo): Promise<number>;
export async function runWhoami(opts: { url: string; json: boolean }, io: LoginIo): Promise<number>;
```

- The file: Linux `$XDG_CONFIG_HOME/openldr/session.json`, else `~/.config/openldr/session.json`. macOS `~/Library/Application Support/OpenLDR/session.json`. Windows `%APPDATA%\OpenLDR\session.json`. The folder is mode 0700 and the file 0600, created by hard-linking a fully written temporary file. It holds one entry per server address.
- `login` asks for the username when `--username` is absent, and for the password with no echo. `--password-stdin` reads one line from standard input. There is no `--password` option.
- `login` reads `GET /api/config`. When the install does not use local sign-in it prints `This install signs in through another service. Use an access key: set OPENLDR_KEY.` and exits 1.
- A response with `mustChangePassword` prints `Change your password in Studio first, then sign in again.`, stores nothing, exits 1.
- A wrong password, a locked account and a rate limit each print the server's meaning in plain words and exit 1. The password is never printed or stored.
- `findCredential` now reads the session file, calls refresh, and uses the access token. A refused refresh removes that server's entry and answers as "none".
- `logout` calls `POST /api/auth/logout` and removes the entry even when the call fails.
- `whoami` calls `GET /api/me` and prints the username, the roles and `key`, `session` or `none`.

- [ ] **Step 1: Write the failing tests**, against a test HTTP server that sets and checks a cookie.

```ts
it('puts the session file in the right place on each platform', () => {});
it('signs in, stores the session owner-only, and signs later requests', async () => {});
it('stores a new session value when refresh gives one', async () => {});
it('removes the entry when refresh is refused', async () => {});
it('reads the password from standard input and never from an argument', async () => {});
it('refuses on an install without local sign-in, with the message', async () => {});
it('refuses when the password must be changed and stores nothing', async () => {});
it('logs out and removes the entry even when the server is down', async () => {});
it('never writes the password or the session value to standard output or standard error', async () => {});
it('keeps separate sessions for two server addresses', async () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli suite and typecheck**
- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): sign in, sign out and whoami"
```

---

### Task 12: The switch, the standalone tier and the scripts

**Files:**
- Modify: `packages/cli/src/program.ts`, `packages/cli/src/client/run-through-app.ts`, `apps/standalone/src/commands.ts:632` (`runCli`), `apps/standalone/src/environment.ts`, `apps/standalone/tsup.config.ts`, `package.json` (`e2e:seed`, `docs:seed`), `scripts/sync-bundle-live-acceptance.ts`, `scripts/sync-two-instance-harness.ts`, `scripts/load-measure.mjs`, `scripts/build-v1-import-plugin.mjs`, `e2e/tests/plugin-ui.spec.ts`, `e2e/tests/dhis2-plugin.spec.ts`, `install/development.ps1`
- Test: `packages/cli/src/switch.test.ts`, `apps/standalone/src/commands.test.ts`, `apps/standalone/src/environment.test.ts`

**Interfaces:**
- Consumes: every earlier task.
- Produces:
  - Outside served mode, an `app` command always goes through the app. `OPENLDR_THROUGH_APP` is gone from the code.
  - Outside served mode, a `recovery` command runs in-process as before. Without the database settings it prints `This command works on the database itself. Run it on the machine that runs OpenLDR.` and exits 1.
  - A command with a local part and a database part, found in Task 6, is split as the spec says: the local part runs on the caller's machine, then the rest goes through the app. Do this for each one Task 6 reported.
  - The standalone bundle gains a second entry file, `dist/cli.js`, the plain CLI entry. `buildEnvironment` sets `CLI_ENTRY` to it.
  - `runCli` in the standalone launcher: for a `recovery` command it builds the environment as today. For anything else it sets only `OPENLDR_URL` to the running launcher's address and `APP_VERSION`, passes the caller's own `OPENLDR_KEY`, `OPENLDR_KEY_FILE` and session through, and never sets a database URL or the secrets key.
  - Each script and test in the list above is read. Those that call a through-the-app command with no server are changed to start one or to expect one, in the smallest way. List each file with what you changed, or why nothing was needed.

- [ ] **Step 1: Write the failing tests**

```ts
it('sends an app command through the app even when the database settings are present', async () => {
  // INTERNAL_DATABASE_URL set, server unreachable: a connection message, exit 1, and no database call
});
it('has no reference to OPENLDR_THROUGH_APP left in the source', async () => {});
it('runs a recovery command in-process, and explains itself without database settings', async () => {});
it('gives a non-recovery command no database URL and no secrets key (standalone)', async () => {});
it('gives a recovery command the database settings (standalone)', async () => {});
it('sets CLI_ENTRY to the bundle\'s cli entry', () => {});
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the cli and standalone suites, typechecks, `pnpm --filter @openldr/standalone build`, and `pnpm depcruise`.** Check `apps/standalone/dist/cli.js` exists.
- [ ] **Step 5: Commit**

```bash
git add packages/cli apps/standalone package.json scripts e2e install
git commit -m "feat(cli): send database commands through the app by default"
```

---

### Task 13: The Docker wrapper

**Files:**
- Modify: `install/install.sh` (the wrapper it writes, near `:400` to `:445`), `apps/server/Dockerfile` only if `CLI_ENTRY`'s default does not already fit `/app/cli/dist/index.js`
- Test: `packages/release/src/shell.test.ts`, and any other test that pins the wrapper's text

Read how the wrapper is written and tested before changing it.

Behaviour:

- The wrapper passes `OPENLDR_KEY` from the caller's environment into the container for that one call, when it is set. It reads `OPENLDR_KEY_FILE` on the host and passes the key the same way.
- `openldr login` is handled by the wrapper on the host: it asks for the username and, with no echo, the password, and passes the password to the client's `--password-stdin`. The client prints the session entry to the wrapper on a separate descriptor, and the wrapper stores it on the host at `~/.config/openldr/session.json`, mode 0600. Add to the client only what this needs, as a hidden option, and test it in `session.test.ts`.
- For later calls the wrapper passes the stored session in, and stores a new value when the client reports one.
- `openldr logout` removes the host file.
- Nothing is written inside the container. The existing behaviour for every other command, including the `-T` flag and the working folder, does not change.
- The wrapper's fixed path `/app/cli/dist/index.js` does not change.

- [ ] **Step 1: Write the failing tests** in the style the shell tests already use: the wrapper text passes a key through, handles `login` and `logout` on the host, and writes nothing in the container.
- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run the release suite and the cli suite**
- [ ] **Step 5: Commit**

```bash
git add install packages/release packages/cli apps/server/Dockerfile
git commit -m "feat(install): pass a key or a session to the CLI in the container"
```

Say in the report that no image was built and the wrapper was not run against a real container, unless you did both safely.

---

### Task 14: Docs

**Files:**
- In-app guides under `apps/studio/src/docs/`, in en, fr and pt, following `apps/studio/src/docs/HOW-TO-TEMPLATE.md`: make an access key for an AI, and revoke one.
- Web docs under `apps/web/src/docs/` in en, fr and pt. Find the current version folder and how the newest page was registered, and follow it.
- `docs/CLI-REFERENCE.md`, `docs/OPERATOR-GUIDE.md`, `docs/HTTP-API.md`, and the standalone page from design B where it describes `cli`.

Content:

- A web page on the CLI: the three kinds of command, signing in with `openldr login`, access keys, the server address and the plain-HTTP refusal, the recovery commands and where they must be run, and `openldr commands --json`.
- A section on giving an AI access: make an account with no password and a narrow role, make a key, hand over the key and the address, revoke it when done. Say plainly what the AI can and cannot do with it.
- The limit from the spec, in plain words: on a Docker host, a person who may run `docker compose exec` can already reach the database.
- `--actor` and `--approved-by` are refused through the app.
- Client settings: `OPENLDR_URL`, `OPENLDR_KEY`, `OPENLDR_KEY_FILE`, `OPENLDR_ALLOW_PLAIN_HTTP`.
- `docs/HTTP-API.md`: the three key routes. The run route is described as the CLI's own, not a public API.

- [ ] **Step 1: Write the English pages from the code as built.** Run each command against a server you start under the safety rules, and copy its real output. Replace any key or session value with a placeholder.
- [ ] **Step 2: Write French and European Portuguese.** Commands, flags and printed messages stay in English.
- [ ] **Step 3: Run the docs tests**

Run: `pnpm --filter @openldr/web exec vitest run`, `pnpm --filter @openldr/studio exec vitest run`, and `pnpm --filter @openldr/config exec vitest run src/env-docs.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/studio apps/web docs
git commit -m "docs: the CLI through the app, sign-in and access keys"
```

---

### Task 15: Real run proof and the gate

No product code. If something is broken, report it precisely. Do not fix it.

Use a standalone launcher on a temp folder, and a server from the checkout on two scratch databases. Ports 3990 to 3997. Stop everything you start.

- [ ] **Step 1: Build** the studio and the standalone bundle.
- [ ] **Step 2: Walk it and record each result**

1. Set up an administrator. Sign in with `openldr login`. `whoami` shows the account and `session`.
2. Make an account with `user create --no-password` and a narrow role. Make a key for it.
3. With only `OPENLDR_KEY` and `OPENLDR_URL` set: an allowed command works and a forbidden one answers 403 with the capability's name.
4. The audit log shows that account for the allowed command, with the key's name.
5. Change the account's role. The same key is limited on the next command, with no restart. Disable the account. The key is refused.
6. Revoke the key. It is refused.
7. The client process's environment holds no database URL and no secrets key. Show the variable names only.
8. While a command with a secret argument runs, the process list on the server does not show the secret.
9. A command with an input file whose name has spaces and non-ASCII letters, one with an input folder, and one with an output file. Compare the output file with a direct run.
10. A large file: memory of the server and the client while it uploads.
11. For one read command from every group that has a through-the-app command, output and exit code through the app equal a direct run on the same data, as text and, where the command has it, as JSON. A direct run here means the CLI entry started with the database settings and a hand-off, as the server does. List the groups and the result for each.
12. Ctrl+C during `import start`: it stops at a page and can be resumed.
13. Three slow commands at once with `CLI_MAX_RUNNING=2`: the third waits, then runs.
14. Stop the server while a command runs: the client reports it, no process is left, the request folder is gone.
15. `logout`, then a command: refused with the sign-in message.
16. A recovery command on the checkout server with the server stopped. A through-the-app command in the same state: a connection message and no database call.
17. `--actor` through the app: refused with the message.
18. `/etc/hostname` given as a file argument through a hand-made request: refused, nothing read.
19. A search of the server log, the Postgres log and the audit rows for the key, the password, the session value and a secret argument. Report the count for each. All must be 0.
20. Time for `roles list` through the app and directly, five runs each.
21. Studio at 375 x 812: the access keys sheet, the new key form and the shown key, with no sideways scroll. This needs a browser. If you have none, say so and leave it to the controller.
22. Give a fresh AI agent only the key, the address and the `openldr` command. Ask it to find and run a command from `openldr commands --json`. Record what it did.

- [ ] **Step 3: Run the full gate**

Run: `pnpm turbo run test --force --concurrency=2 --continue > <scratch>/c-test.txt 2>&1; echo "exit=$?"`
Run: `pnpm turbo run typecheck --force --concurrency=2 > <scratch>/c-tc.txt 2>&1; echo "exit=$?"`
Run: `pnpm depcruise > <scratch>/c-dc.txt 2>&1; echo "exit=$?"` and compare the count with `main`.
Run: `pnpm --filter @openldr/server lint`
On a failure, search for `Test timed out`, `out of memory` and `VirtualAlloc`, and re-run that package alone before calling it a regression.

- [ ] **Step 4: Clean up.** Stop every launcher and server. Drop the scratch databases. Remove the temp folders. Show the checks.
- [ ] **Step 5: Write the report.** One table per step: the claim, the command, the result, PROVEN or NOT PROVEN. End with a list headed HONEST NON-PROOF. It must include Windows, macOS, keys on a Keycloak install, and the Docker wrapper against a real container.
- [ ] **Step 6: After the work merges to `main`, update the changelog**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog for the CLI through the app"
```
