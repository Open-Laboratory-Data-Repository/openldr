# Local sign-in implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let OpenLDR CE sign people in with a username and password held by the server itself, with Keycloak and plain OIDC left as they are.

**Architecture:** A third value, `AUTH_ADAPTER=local`, loads a new adapter that fills the existing `AuthPort`. The adapter hashes passwords with scrypt, signs ES256 access tokens with a key it keeps sealed in the database, and tracks sessions as database rows. A small sign-in service sits beside the port for login, refresh, logout, password change and first-admin setup, and five new server routes call it.

**Tech stack:** TypeScript, Kysely on Postgres, Fastify, `jose` (already a dependency of `@openldr/adapter-auth`), Node `crypto.scrypt`, React with shadcn in `apps/studio`, Commander in `packages/cli`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-local-sign-in-design.md`. Read it first. This plan argues from it.

## Global constraints

- `AuthPort` does not change (`packages/ports/src/auth.ts:57`). If a task seems to need a port change, stop and report.
- No new npm dependencies and no native modules. Cookies are set and parsed by hand.
- The schema default for `AUTH_ADAPTER` stays `keycloak`.
- Keycloak and OIDC behaviour must not change. Their existing tests stay green.
- Never write a password, hash, token, session secret, setup code, or the identifier typed at sign-in to a log or an audit row.
- Fixed values: password 10 to 128 characters. Five wrong tries lock for 5 minutes. Access token 600 seconds. Session idle limit 12 hours, total limit 7 days. 30 sign-in attempts per IP per minute. Setup code valid 30 minutes. At most 4 hashes at once. scrypt N=32768, r=8, p=3, 16-byte salt, 64-byte key, `maxmem` 64 MiB.
- Issuer constant: `urn:openldr:local-sign-in`.
- The migration number is 116. Before Task 2 run `git branch -a` and check no branch adds an internal migration. If 116 is taken, use the next free number in every place this plan says 116.
- UI follows AGENTS.md section 5. shadcn only. `h-dvh`, never `h-screen`. Every string lands in en, fr and pt in the same task, because `apps/studio/src/i18n/parity.test.ts` fails otherwise.
- All prose (messages, docs, commits) follows the `unslop` skill. No em dashes.
- One commit per task. No `Co-Authored-By` trailer (AGENTS.md section 9). Do not push. Ask the operator once, at the start, whether to push after each task. A power-cut warning is in force.
- Full gate, run at the end and never piped through `tail`:
  `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`.
  Read an exit code only after redirecting to a file, for example `... > /tmp/tc.txt 2>&1; echo "exit=$?"`.

## Review focus

Five conditions the spec implies and a person will hit. Each has a test in the task named.

1. Two usernames that differ only by case, such as `Bob` and `bob`. The exact spelling signs in. Any other spelling fails as wrong details. Task 2.
2. One email on two accounts. Sign-in by that email fails as wrong details. Both usernames still work. Task 2.
3. Two setup requests at the same moment. Exactly one admin exists afterwards. Tasks 5 and 7.
4. `SECRETS_ENCRYPTION_KEY` changed after the signing key was sealed. The server refuses to start with a message that names the key. It does not create a second key. Task 4.
5. A user who was disabled or blocked while holding a live session cookie. Refresh answers 401 and clears the cookie. Tasks 5 and 8.

## File map

| File | Responsibility |
|---|---|
| `packages/config/src/schema.ts`, `auth.ts` | Accept `local`, make the OIDC issuer optional, report capabilities |
| `packages/ports/src/local-auth.ts` | `LocalAuthStore` interface and its row types |
| `packages/db/src/migrations/internal/116_local_sign_in.ts` | Four tables |
| `packages/db/src/local-auth-store.ts` | Kysely implementation of `LocalAuthStore` |
| `packages/adapter-auth/src/local/password.ts` | Rules, hash, verify, hash limiter |
| `packages/adapter-auth/src/local/tokens.ts` | Signing key and access tokens |
| `packages/adapter-auth/src/local/sign-in.ts` | Login, refresh, logout, change, setup, lockout |
| `packages/adapter-auth/src/local/local-auth.ts` | `AuthPort` under local sign-in |
| `packages/bootstrap/src/index.ts` | Build the local adapter into the app context |
| `packages/bootstrap/src/local-accounts.ts` | Logic shared by CLI and routes |
| `apps/server/src/local-auth-routes.ts`, `session-cookie.ts` | Five routes and the cookie |
| `apps/server/src/auth-plugin.ts`, `app.ts`, `users-routes.ts` | Public paths, forced-change gate, `/api/config` |
| `apps/studio/src/auth/local.ts` | Browser calls and the refresh timer |
| `apps/studio/src/auth/LoginPage.tsx`, `SetupPage.tsx`, `ChangePasswordPage.tsx`, `ChangePasswordSheet.tsx` | Four screens |
| `packages/cli/src/auth.ts`, `user.ts`, `program.ts` | CLI commands |
| `packages/bootstrap/src/setup-checks.ts` | Sign-in check line |

---

### Task 1: Config accepts `local`

**Files:**
- Modify: `packages/config/src/schema.ts:35-36`, `:76`, the `superRefine` near `:200`
- Modify: `packages/config/src/auth.ts`
- Test: `packages/config/src/schema.test.ts`, `packages/config/src/auth.test.ts`

**Interfaces:**
- Produces: `AUTH_ADAPTER: 'keycloak' | 'oidc' | 'local'`. `IDENTITY_ADMIN_ADAPTER?: 'keycloak' | 'none' | 'local'`. `OIDC_ISSUER_URL?: string`.
- Produces: `resolveIdentityAdminAdapter(cfg): 'keycloak' | 'none' | 'local'`.
- Produces: `resolveAuthCapabilities(cfg): { identityAdmin: boolean; syncClientAdmin: boolean; passwordResetEmail: boolean }`.
- Produces: `requireOidcIssuer(cfg: { OIDC_ISSUER_URL?: string }): string`. Throws `Error('OIDC_ISSUER_URL is required for this sign-in mode')` when unset.

- [ ] **Step 1: Write the failing tests**

```ts
// schema.test.ts. `base` is the file's existing valid env object.
it('accepts local sign-in with no OIDC issuer', () => {
  const { OIDC_ISSUER_URL: _drop, ...rest } = base;
  const cfg = parse({ ...rest, AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: VALID_KEY });
  expect(cfg.AUTH_ADAPTER).toBe('local');
});
it('refuses local sign-in with no secrets key', () => {
  expect(() => parse({ ...base, AUTH_ADAPTER: 'local', SECRETS_ENCRYPTION_KEY: undefined })).toThrow(/SECRETS_ENCRYPTION_KEY/);
});
it('still requires an issuer for keycloak and oidc', () => {
  const { OIDC_ISSUER_URL: _drop, ...rest } = base;
  expect(() => parse({ ...rest, AUTH_ADAPTER: 'keycloak' })).toThrow(/OIDC_ISSUER_URL/);
  expect(() => parse({ ...rest, AUTH_ADAPTER: 'oidc' })).toThrow(/OIDC_ISSUER_URL/);
});
it('refuses mixed admin adapters', () => {
  expect(() => parse({ ...base, AUTH_ADAPTER: 'local', IDENTITY_ADMIN_ADAPTER: 'keycloak', SECRETS_ENCRYPTION_KEY: VALID_KEY })).toThrow();
  expect(() => parse({ ...base, AUTH_ADAPTER: 'keycloak', IDENTITY_ADMIN_ADAPTER: 'local' })).toThrow();
});
it('keeps keycloak as the default', () => {
  expect(parse(base).AUTH_ADAPTER).toBe('keycloak');
});

// auth.test.ts
it('reports local capabilities', () => {
  expect(resolveAuthCapabilities({ AUTH_ADAPTER: 'local' }))
    .toEqual({ identityAdmin: true, syncClientAdmin: false, passwordResetEmail: false });
});
it('reports reset email only for a configured keycloak', () => {
  expect(resolveAuthCapabilities({ AUTH_ADAPTER: 'keycloak', KEYCLOAK_ADMIN_CLIENT_ID: 'a', KEYCLOAK_ADMIN_CLIENT_SECRET: 'b' }).passwordResetEmail).toBe(true);
  expect(resolveAuthCapabilities({ AUTH_ADAPTER: 'oidc' }).passwordResetEmail).toBe(false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @openldr/config exec vitest run src/schema.test.ts src/auth.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Change the schema and `auth.ts`** to the interfaces above. `IDENTITY_ADMIN_ADAPTER` defaults to `local` when the mode is `local`.

- [ ] **Step 4: Fix the compile errors the optional issuer causes**

These read `cfg.OIDC_ISSUER_URL` and only run under Keycloak or OIDC. Route each through `requireOidcIssuer`:
`packages/bootstrap/src/index.ts:646` and `:655`, `packages/bootstrap/src/enrollment.ts:188`, `packages/cli/src/auth.ts:18`, `apps/server/src/app.ts:64`. Task 7 replaces the two `index.ts` lines. Do not change behaviour here.

`createAuth` accepts only `keycloak` and `oidc` as its mode (`packages/adapter-auth/src/index.ts:7`). Until Task 7 wires the local adapter, make `createAppContext` throw `Error('local sign-in is not wired yet')` when `AUTH_ADAPTER` is `local`, before it calls `createAuth`. That keeps the types honest and the tree green between tasks.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @openldr/config exec vitest run` then `pnpm turbo run typecheck --force --concurrency=2 > /tmp/tc.txt 2>&1; echo "exit=$?"`
Expected: PASS and `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add packages/config packages/bootstrap packages/cli apps/server
git commit -m "feat(config): accept AUTH_ADAPTER=local"
```

---

### Task 2: Migration 116 and the local auth store

**Files:**
- Create: `packages/ports/src/local-auth.ts`, exported from `packages/ports/src/index.ts`
- Create: `packages/db/src/migrations/internal/116_local_sign_in.ts`
- Modify: `packages/db/src/migrations/internal/index.ts` (import as `m116`, add the map entry after `115`)
- Modify: `packages/db/src/schema/internal.ts` (four table types, added to `InternalSchema`)
- Create: `packages/db/src/local-auth-store.ts`, exported from `packages/db/src/index.ts`
- Test: `packages/db/src/local-auth-store.test.ts`

**Tables:**

| Table | Columns |
|---|---|
| `local_credentials` | `user_id` text primary key, references `users.id`, cascade. `password_hash` text not null. `must_change` boolean not null default false. `failed_count` integer not null default 0. `locked_until` timestamptz. `password_changed_at` timestamptz not null default now. `first_name` text. `last_name` text |
| `auth_sessions` | `id` text primary key. `user_id` text not null, references `users.id`, cascade, indexed. `secret_hash` text not null. `created_at`, `last_used_at` timestamptz not null default now. `expires_at` timestamptz not null. `ip` text. `user_agent` text |
| `auth_signing_keys` | `kid` text primary key. `sealed_private_jwk` text not null. `public_jwk` jsonb not null. `created_at` timestamptz not null default now |
| `auth_setup_code` | `id` integer primary key, always 1. `code_hash` text not null. `expires_at` timestamptz not null |

Copy the style of `114_layout_presets.ts`, including `ifNotExists` and a `down`.

**Interfaces:**
- Produces, in `packages/ports/src/local-auth.ts`:

```ts
export interface LocalCredential {
  userId: string; passwordHash: string; mustChange: boolean; failedCount: number;
  lockedUntil: Date | null; passwordChangedAt: Date; firstName: string | null; lastName: string | null;
}
export interface LocalSession { id: string; userId: string; secretHash: string; createdAt: Date; lastUsedAt: Date; expiresAt: Date }
export interface StoredSigningKey { kid: string; sealedPrivateJwk: string; publicJwk: Record<string, unknown> }
export interface LocalAuthStore {
  /** Inserts a users row with subject = id and rbac_initialized = true. */
  createUser(input: { username: string; email?: string | null; displayName?: string | null }): Promise<{ id: string }>;
  findUserIdByIdentifier(identifier: string): Promise<string | null>;
  getCredential(userId: string): Promise<LocalCredential | null>;
  /** Upsert. Clears failed_count and locked_until. Sets password_changed_at to now. */
  setPassword(userId: string, passwordHash: string, mustChange: boolean): Promise<void>;
  setNames(userId: string, firstName: string | null, lastName: string | null): Promise<void>;
  recordFailure(userId: string, now: Date, maxFailures: number, lockMs: number): Promise<{ lockedUntil: Date | null }>;
  clearFailures(userId: string): Promise<void>;
  anyCredentialExists(): Promise<boolean>;
  createSession(input: { userId: string; secretHash: string; expiresAt: Date; ip: string | null; userAgent: string | null }): Promise<LocalSession>;
  getSession(id: string): Promise<LocalSession | null>;
  touchSession(id: string, now: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string, exceptSessionId?: string): Promise<number>;
  getSigningKey(): Promise<StoredSigningKey | null>;
  /** Inserts only when the table is empty. Returns the row that is stored afterwards. */
  insertSigningKeyIfNone(key: StoredSigningKey): Promise<StoredSigningKey>;
  replaceSetupCode(codeHash: string, expiresAt: Date): Promise<void>;
  /** Deletes the row when hash matches and it has not expired. True when it deleted one. */
  consumeSetupCode(codeHash: string, now: Date): Promise<boolean>;
}
```

- Produces, in `packages/db`: `createLocalAuthStore(db: Kysely<InternalSchema>): LocalAuthStore`.

Two algorithms the signatures do not settle:

`findUserIdByIdentifier`. An exact `username` match wins. Otherwise take rows where `lower(username) = lower(identifier)` and return the ID only when there is exactly one. Otherwise take rows where `lower(email) = lower(identifier)` and return the ID only when there is exactly one. Otherwise null.

`recordFailure` is one statement, so two wrong tries at once both count. When it locks, it resets the count to zero. That way one typo after the lock ends does not lock the account again.

```sql
update local_credentials
set failed_count = case when failed_count + 1 >= :max then 0 else failed_count + 1 end,
    locked_until = case when failed_count + 1 >= :max then :lockUntil else locked_until end
where user_id = :userId
returning locked_until
```

- [ ] **Step 1: Write the failing tests**

Use `makeMigratedDb` from `./migrations/internal/test-helpers`, as `role-store.test.ts` does.

```ts
it('creates a user whose subject equals its id and is RBAC initialised', async () => {
  const { id } = await store.createUser({ username: 'ada' });
  const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  expect(row.subject).toBe(id);
  expect(row.rbac_initialized).toBe(true);
});
it('prefers the exact username over a case variant', async () => {
  const a = await store.createUser({ username: 'Bob' });
  const b = await store.createUser({ username: 'bob' });
  expect(await store.findUserIdByIdentifier('Bob')).toBe(a.id);
  expect(await store.findUserIdByIdentifier('bob')).toBe(b.id);
  expect(await store.findUserIdByIdentifier('BOB')).toBeNull();
});
it('matches a single user ignoring case', async () => {
  const a = await store.createUser({ username: 'Ada' });
  expect(await store.findUserIdByIdentifier('ada')).toBe(a.id);
});
it('refuses an email that two accounts share', async () => {
  await store.createUser({ username: 'u1', email: 'lab@x.org' });
  await store.createUser({ username: 'u2', email: 'LAB@x.org' });
  expect(await store.findUserIdByIdentifier('lab@x.org')).toBeNull();
  expect(await store.findUserIdByIdentifier('u1')).not.toBeNull();
});
it('locks on the fifth failure and resets the count', async () => {
  const { id } = await store.createUser({ username: 'ada' });
  await store.setPassword(id, 'h', false);
  const now = new Date('2026-01-01T00:00:00Z');
  for (let i = 0; i < 4; i++) expect((await store.recordFailure(id, now, 5, 300_000)).lockedUntil).toBeNull();
  const fifth = await store.recordFailure(id, now, 5, 300_000);
  expect(fifth.lockedUntil?.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  expect((await store.getCredential(id))!.failedCount).toBe(0);
});
it('setPassword clears a lock', async () => { /* lock, setPassword, expect lockedUntil null and failedCount 0 */ });
it('insertSigningKeyIfNone keeps the first key', async () => {
  const first = await store.insertSigningKeyIfNone({ kid: 'k1', sealedPrivateJwk: 's1', publicJwk: {} });
  const second = await store.insertSigningKeyIfNone({ kid: 'k2', sealedPrivateJwk: 's2', publicJwk: {} });
  expect(first.kid).toBe('k1'); expect(second.kid).toBe('k1');
});
it('consumes a setup code once, and not after it expires', async () => {
  await store.replaceSetupCode('h', new Date('2026-01-01T00:30:00Z'));
  expect(await store.consumeSetupCode('h', new Date('2026-01-01T00:31:00Z'))).toBe(false);
  await store.replaceSetupCode('h', new Date('2026-01-01T00:30:00Z'));
  expect(await store.consumeSetupCode('h', new Date('2026-01-01T00:10:00Z'))).toBe(true);
  expect(await store.consumeSetupCode('h', new Date('2026-01-01T00:10:00Z'))).toBe(false);
});
it('deleteSessionsForUser can spare one session', async () => { /* three sessions, spare one, expect 2 deleted and 1 left */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/db exec vitest run src/local-auth-store.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the port types, the migration, the schema types and the store**

- [ ] **Step 4: Run the store test and the migration tests**

Run: `pnpm --filter @openldr/db exec vitest run src/local-auth-store.test.ts src/migrations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ports packages/db
git commit -m "feat(db): tables and store for local sign-in"
```

---

### Task 3: Password rules and hashing

**Files:**
- Create: `packages/adapter-auth/src/local/password.ts`
- Test: `packages/adapter-auth/src/local/password.test.ts`

**Interfaces:**
- Produces:

```ts
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export type PasswordRuleFailure = 'too_short' | 'too_long' | 'same_as_username';
export function checkPasswordRules(password: string, username: string): 'ok' | PasswordRuleFailure;
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for a stored value it cannot parse. Never throws. */
  verify(password: string, stored: string): Promise<boolean>;
  /** Spends one hash. Called for unknown usernames so the reply takes the same time. */
  burn(): Promise<void>;
}
export type ScryptFn = (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
export function createPasswordHasher(opts?: { maxConcurrent?: number; scrypt?: ScryptFn }): PasswordHasher;
```

Stored format: `scrypt$32768$8$3$<salt base64>$<key base64>`. `verify` reads N, r and p from the stored value. It compares with `timingSafeEqual`. `maxmem` must be 64 MiB, because Node's default of 32 MiB is below what N=32768, r=8 needs. `same_as_username` ignores case.

- [ ] **Step 1: Write the failing tests**

```ts
it('applies the three rules', () => {
  expect(checkPasswordRules('short', 'ada')).toBe('too_short');
  expect(checkPasswordRules('x'.repeat(129), 'ada')).toBe('too_long');
  expect(checkPasswordRules('AdaLovelace1', 'adalovelace1')).toBe('same_as_username');
  expect(checkPasswordRules('correct horse', 'ada')).toBe('ok');
});
it('round-trips a password', async () => {
  const h = createPasswordHasher();
  const stored = await h.hash('correct horse');
  expect(stored.startsWith('scrypt$32768$8$3$')).toBe(true);
  expect(await h.verify('correct horse', stored)).toBe(true);
  expect(await h.verify('wrong horse!!', stored)).toBe(false);
});
it('uses a new salt each time', async () => {
  const h = createPasswordHasher();
  expect(await h.hash('correct horse')).not.toBe(await h.hash('correct horse'));
});
it('returns false for a stored value it cannot parse', async () => {
  const h = createPasswordHasher();
  for (const bad of ['', 'plain', 'scrypt$x$8$3$a$b', 'bcrypt$1$2$3$4$5']) expect(await h.verify('pw', bad)).toBe(false);
});
it('verifies with the parameters in the stored value', async () => {
  // Build a hash by hand with N=16384 using node:crypto, then expect verify to return true.
});
it('runs at most four hashes at once', async () => {
  let inFlight = 0, peak = 0;
  const scrypt: ScryptFn = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 10)); inFlight--; return Buffer.alloc(64); };
  const h = createPasswordHasher({ scrypt });
  await Promise.all(Array.from({ length: 10 }, () => h.hash('correct horse')));
  expect(peak).toBe(4);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/adapter-auth exec vitest run src/local/password.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `password.ts`**

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Measure one real hash and record it**

Run: `node -e "const c=require('node:crypto');const t=Date.now();c.scryptSync('x',c.randomBytes(16),64,{N:32768,r:8,p:3,maxmem:64*1024*1024});console.log(Date.now()-t,'ms')"`
Write the number in the task report. If it is over 300 ms, report it and do not change the parameters.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-auth
git commit -m "feat(auth): password rules and scrypt hashing"
```

---

### Task 4: Signing key and access tokens

**Files:**
- Create: `packages/adapter-auth/src/local/tokens.ts`
- Test: `packages/adapter-auth/src/local/tokens.test.ts`

**Interfaces:**
- Consumes: `LocalAuthStore.getSigningKey`, `insertSigningKeyIfNone` (Task 2). `seal`, `open` from `@openldr/core` (`packages/core/src/crypto.ts:18`, `:28`).
- Produces:

```ts
export const LOCAL_ISSUER = 'urn:openldr:local-sign-in';
export const ACCESS_TOKEN_TTL_SECONDS = 600;
export interface SigningKey { kid: string; privateKey: KeyLike; keySet: JWTVerifyGetKey }
export class SigningKeyUnreadableError extends Error {}
export function loadOrCreateSigningKey(store: Pick<LocalAuthStore, 'getSigningKey' | 'insertSigningKeyIfNone'>, secretKey: Buffer): Promise<SigningKey>;
export interface AccessClaims {
  sub: string; username: string; name: string | null; email: string | null;
  sid: string; roles: string[]; mustChangePassword: boolean;
}
export function signAccessToken(key: SigningKey, claims: AccessClaims, now?: Date): Promise<string>;
```

Token payload: `iss` is `LOCAL_ISSUER`. `sub`. `preferred_username`. `name` and `email` only when not null. `sid`. `realm_access: { roles }`. `pwd_change: true` only when `mustChangePassword`. `iat`, and `exp = iat + 600`. Header: `alg: 'ES256'` and `kid`.

`SigningKeyUnreadableError` message, exact: `local sign-in key cannot be opened. SECRETS_ENCRYPTION_KEY differs from the one that sealed it.`

- [ ] **Step 1: Write the failing tests**

```ts
it('creates one key and returns the same one next time', async () => {
  const a = await loadOrCreateSigningKey(store, key1);
  const b = await loadOrCreateSigningKey(store, key1);
  expect(b.kid).toBe(a.kid);
});
it('refuses a changed secrets key and does not create a second key', async () => {
  const a = await loadOrCreateSigningKey(store, key1);
  await expect(loadOrCreateSigningKey(store, key2)).rejects.toBeInstanceOf(SigningKeyUnreadableError);
  expect((await store.getSigningKey())!.kid).toBe(a.kid);
});
it('signs a token that verifies with the key set and issuer', async () => {
  const k = await loadOrCreateSigningKey(store, key1);
  const now = new Date('2026-01-01T00:00:00Z');
  const tok = await signAccessToken(k, { sub: 'u1', username: 'ada', name: 'Ada L', email: null, sid: 's1', roles: ['lab_admin'], mustChangePassword: false }, now);
  const { payload, protectedHeader } = await jwtVerify(tok, k.keySet, { issuer: LOCAL_ISSUER, algorithms: ['ES256'], currentDate: now });
  expect(protectedHeader.kid).toBe(k.kid);
  expect(payload).toMatchObject({ sub: 'u1', preferred_username: 'ada', name: 'Ada L', sid: 's1', realm_access: { roles: ['lab_admin'] } });
  expect(payload.email).toBeUndefined();
  expect(payload.pwd_change).toBeUndefined();
  expect(payload.exp! - payload.iat!).toBe(600);
});
it('marks a token that must change its password', async () => { /* mustChangePassword true, expect payload.pwd_change === true */ });
```

Use an in-memory object that satisfies the two store methods. Make `key1` and `key2` with `randomBytes(32)`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/adapter-auth exec vitest run src/local/tokens.test.ts`

- [ ] **Step 3: Implement `tokens.ts`.** Generate with `generateKeyPair('ES256', { extractable: true })`. Seal `JSON.stringify(privateJwk)`.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-auth
git commit -m "feat(auth): local signing key and access tokens"
```

---

### Task 5: Sign-in service

**Files:**
- Create: `packages/adapter-auth/src/local/sign-in.ts`
- Create: `packages/adapter-auth/src/local/test-support.ts` (an in-memory `LocalAuthStore` and fake users and roles, reused by Task 6)
- Test: `packages/adapter-auth/src/local/sign-in.test.ts`

**Interfaces:**
- Consumes: `LocalAuthStore` (Task 2), `PasswordHasher`, `checkPasswordRules`, `PasswordRuleFailure` (Task 3), `SigningKey`, `signAccessToken`, `ACCESS_TOKEN_TTL_SECONDS` (Task 4).
- Produces:

```ts
export interface SignInUser { id: string; username: string; displayName: string | null; email: string | null; status: 'active' | 'disabled' }
export interface SignInUsers {
  get(id: string): Promise<SignInUser | undefined>;
  isSubjectBlocked(subject: string): Promise<boolean>;
}
export interface SignInRoles {
  rolesForUser(subject: string): Promise<Array<{ id: string; slug: string }>>;
  getBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
  setUserRoles(subject: string, roleIds: string[]): Promise<void>;
}
export interface LocalSignInDeps {
  store: LocalAuthStore; users: SignInUsers; roles: SignInRoles;
  hasher: PasswordHasher; key: SigningKey; now?: () => Date;
}
export interface SessionGrant { accessToken: string; expiresIn: number; mustChangePassword: boolean }
export interface NewSession extends SessionGrant { cookieValue: string; cookieExpiresAt: Date; userId: string }
export type LoginResult = ({ ok: true } & NewSession) | { ok: false; reason: 'invalid' | 'locked' | 'disabled' };
export type SetupResult = ({ ok: true } & NewSession)
  | { ok: false; reason: 'already_set_up' | 'bad_code' | 'bad_username' | PasswordRuleFailure };
export interface LocalSignIn {
  setupRequired(): Promise<boolean>;
  login(input: { identifier: string; password: string; ip: string | null; userAgent: string | null }): Promise<LoginResult>;
  refresh(cookieValue: string): Promise<SessionGrant | null>;
  logout(cookieValue: string): Promise<{ userId: string } | null>;
  changePassword(input: { userId: string; sessionId: string; currentPassword: string; newPassword: string }): Promise<'ok' | 'wrong_current' | PasswordRuleFailure>;
  createSetupCode(): Promise<string>;
  setup(input: { setupCode: string; username: string; displayName?: string; password: string; ip: string | null; userAgent: string | null }): Promise<SetupResult>;
  sessionIsLive(sessionId: string): Promise<boolean>;
}
export const MAX_FAILURES = 5;
export const LOCK_MS = 5 * 60_000;
export const SESSION_IDLE_MS = 12 * 3_600_000;
export const SESSION_TOTAL_MS = 7 * 86_400_000;
export const SETUP_CODE_TTL_MS = 30 * 60_000;
export function createLocalSignIn(deps: LocalSignInDeps): LocalSignIn;
```

Rules the signatures do not settle:

- `cookieValue` is `<sessionId>.<secret>`. The secret is 32 random bytes in base64url. The store holds its SHA-256 in hex. Compare with `timingSafeEqual`.
- A session is live when `now < expiresAt` and `now - lastUsedAt < SESSION_IDLE_MS`. `sessionIsLive` and `refresh` call `touchSession` only when `lastUsedAt` is more than 60 seconds old.
- `login` order: find the user ID. If none, `hasher.burn()` and return `invalid`. If no credential, burn and return `invalid`. If `lockedUntil > now`, burn and return `locked`. Verify. On a wrong password call `recordFailure` and return `invalid`. If the user is disabled or blocked return `disabled`. Otherwise `clearFailures`, create the session, sign the token.
- `refresh` returns null when the session is not live, the secret is wrong, or the user is disabled or blocked. In the last case it also deletes the session.
- `changePassword` checks the current password first, then the rules against the username, then stores the hash with `mustChange` false and deletes the user's other sessions.
- A setup code is 12 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown as `XXXX-XXXX-XXXX`. Its stored hash is the SHA-256 of the code in upper case with dashes removed.
- `setup` order: if `anyCredentialExists` return `already_set_up`. Username must match `/^[A-Za-z0-9._-]{3,64}$/` or return `bad_username`. Check the password rules. Then `consumeSetupCode`, and return `bad_code` when it is false. Then create the user, store the password with `mustChange` false, set `displayName`, assign the `lab_admin` role, and open a session. Consuming the code before creating the user is what lets only one of two racing requests through.

- [ ] **Step 1: Write the failing tests**

Build the service over `test-support.ts` with a hasher whose fake `scrypt` returns a buffer derived from the password, so tests are fast. `test-support.ts` exports `makeFakes()`, which returns `{ store, users, roles, clock }`. Beyond the real interfaces it gives the tests `store.credentialCount()`, `users.disable(username)`, `roles.slugsFor(userId)` and `clock.advance(ms)`. Its `consumeSetupCode` must be atomic, as the real one is.

```ts
it('signs in with the right password and returns a cookie and a token', async () => { /* ok true, expiresIn 600, cookieValue has one dot */ });
it('gives the same failure for an unknown user and a wrong password', async () => {
  expect(await svc.login({ identifier: 'nobody', password: 'x'.repeat(12), ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid' });
  expect(await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid' });
});
it('burns a hash for an unknown user', async () => { /* spy on hasher.burn, expect called once */ });
it('locks after five wrong tries, even for the right password, then unlocks after five minutes', async () => {
  for (let i = 0; i < 5; i++) await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
  expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null }))).toEqual({ ok: false, reason: 'locked' });
  clock.advance(LOCK_MS + 1);
  expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
});
it('refuses a disabled user', async () => { /* status disabled, expect reason 'disabled' */ });
it('puts role slugs and the must-change mark in the token', async () => { /* decodeJwt, expect realm_access.roles and pwd_change */ });
it('refreshes a live session and refuses a dead one', async () => {
  const s = await login();
  expect(await svc.refresh(s.cookieValue)).toMatchObject({ expiresIn: 600 });
  clock.advance(SESSION_IDLE_MS + 1);
  expect(await svc.refresh(s.cookieValue)).toBeNull();
});
it('ends a session at seven days even when it is used every hour', async () => { /* advance in 1h steps with refresh, expect null after SESSION_TOTAL_MS */ });
it('refuses refresh with a wrong secret', async () => { /* same id, other secret, expect null */ });
it('refuses refresh for a user disabled after sign-in and deletes the session', async () => {
  const s = await login(); users.disable('ada');
  expect(await svc.refresh(s.cookieValue)).toBeNull();
  expect(await store.getSession(s.cookieValue.split('.')[0])).toBeNull();
});
it('changes a password, clears must-change, and ends other sessions', async () => { /* two sessions, change from one, other is gone */ });
it('refuses a wrong current password and a weak new one', async () => { /* 'wrong_current', 'too_short' */ });
it('sets up the first admin once', async () => {
  const code = await svc.createSetupCode();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const r = await svc.setup({ setupCode: code.toLowerCase(), username: 'ada', password: GOOD, ip: null, userAgent: null });
  expect(r.ok).toBe(true);
  expect(roles.slugsFor(r.ok ? r.userId : '')).toEqual(['lab_admin']);
  expect(await svc.setupRequired()).toBe(false);
  expect(await svc.setup({ setupCode: code, username: 'eve', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'already_set_up' });
});
it('lets only one of two setup requests at the same moment create an admin', async () => {
  const code = await svc.createSetupCode();
  const [a, b] = await Promise.all([
    svc.setup({ setupCode: code, username: 'ada', password: GOOD, ip: null, userAgent: null }),
    svc.setup({ setupCode: code, username: 'eve', password: GOOD, ip: null, userAgent: null }),
  ]);
  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  expect(store.credentialCount()).toBe(1);
});
it('refuses a wrong or expired setup code', async () => { /* 'bad_code' twice, second after SETUP_CODE_TTL_MS */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/adapter-auth exec vitest run src/local/sign-in.test.ts`

- [ ] **Step 3: Implement `sign-in.ts` and `test-support.ts`**

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-auth
git commit -m "feat(auth): local sign-in service with lockout and setup"
```

---

### Task 6: The local `AuthPort`

**Files:**
- Create: `packages/adapter-auth/src/local/local-auth.ts`
- Modify: `packages/adapter-auth/src/index.ts` (export `createLocalAuth`, `LOCAL_ISSUER`, `SigningKeyUnreadableError`, `PasswordResetEmailUnsupportedError`, and the `LocalSignIn` type)
- Test: `packages/adapter-auth/src/local/local-auth.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 5.
- Produces:

```ts
export class PasswordResetEmailUnsupportedError extends Error {}
export interface DirectoryUsers extends SignInUsers {
  list(opts?: { offset: number; limit: number; search?: string; enabled?: boolean }): Promise<SignInUser[]>;
  getByUsername(username: string): Promise<SignInUser | undefined>;
  update(id: string, input: { displayName?: string | null; email?: string | null }): Promise<void>;
  setStatus(id: string, status: 'active' | 'disabled'): Promise<void>;
}
export interface LocalAuthDeps {
  store: LocalAuthStore; users: DirectoryUsers; roles: SignInRoles;
  secretKey: Buffer; ping: () => Promise<void>; now?: () => Date; hasher?: PasswordHasher;
}
export function createLocalAuth(deps: LocalAuthDeps): Promise<{ auth: AuthPort; signIn: LocalSignIn }>;
```

Behaviour per port method is the table in spec section 5.6. Details it leaves open:

- `verifyToken` uses `jwtVerify` with `key.keySet`, issuer `LOCAL_ISSUER`, algorithms `['ES256']`. It throws when `sub` or `sid` is missing, and throws `Error('session ended')` when `signIn.sessionIsLive(sid)` is false.
- `DirectoryUser.id` is `users.id`. `enabled` is `status === 'active'`. `roles` are the slugs from `roles.rolesForUser`. `createdAt` is null. `firstName` and `lastName` come from the credential row.
- `directory.create` refuses a password that fails `checkPasswordRules` by throwing `Error('password ' + failure)`. With a password it stores the hash with `mustChange = input.temporaryPassword ?? true`. With no password it creates no credential row, and the account cannot sign in until an admin resets it. It maps role slugs to IDs with `roles.getBySlug` and ignores unknown slugs.
- `directory.update` writes `email`, sets `displayName` to the two names joined with a space, stores the names, and calls `setStatus` when `enabled` is given.
- `resetPassword` applies the same password rules, then follows the table.
- `sendPasswordResetEmail` throws `PasswordResetEmailUnsupportedError`.
- Every `clients.*` method throws `IdentityAdminNotConfiguredError`.
- `healthCheck` uses `probe` from `@openldr/core`, calls `deps.ping()`, and returns the detail `local sign-in ready`.

- [ ] **Step 1: Write the failing tests**

```ts
it('verifies its own token while the session is live', async () => {
  const s = await login(signIn);
  expect((await auth.verifyToken(s.accessToken)).sub).toBe(s.userId);
});
it('refuses a token after forceLogout', async () => {
  const s = await login(signIn);
  await auth.forceLogout(s.userId);
  await expect(auth.verifyToken(s.accessToken)).rejects.toThrow('session ended');
});
it('refuses a token signed by another key', async () => { /* second createLocalAuth with its own store, cross-verify rejects */ });
it('creates a user who must change a temporary password', async () => {
  const u = await auth.directory.create({ username: 'bo', firstName: 'Bo', lastName: 'Li', roles: ['lab_technician'], password: 'temporary pw 1' });
  expect(u).toMatchObject({ username: 'bo', firstName: 'Bo', lastName: 'Li', enabled: true, roles: ['lab_technician'] });
  const r = await signIn.login({ identifier: 'bo', password: 'temporary pw 1', ip: null, userAgent: null });
  expect(r.ok && r.mustChangePassword).toBe(true);
});
it('refuses a weak password on create and on reset', async () => {
  await expect(auth.directory.create({ username: 'bo', password: 'short' })).rejects.toThrow('password too_short');
  await expect(auth.resetPassword(adaId, 'short', true)).rejects.toThrow('password too_short');
});
it('replaces roles with setRoles', async () => { /* setRoles(id, ['data_analyst']), get returns exactly that */ });
it('disables through update and blocks sign-in', async () => { /* update enabled false, login reason 'disabled' */ });
it('resetPassword clears a lock and ends sessions', async () => { /* lock, reset, old token rejected, new password signs in */ });
it('does not support the reset email', async () => {
  await expect(auth.sendPasswordResetEmail(adaId)).rejects.toBeInstanceOf(PasswordResetEmailUnsupportedError);
});
it('reports sync client admin as not configured', async () => {
  await expect(auth.clients.findUuidByClientId('x')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
});
it('reports health from the ping', async () => { /* ping resolves -> status 'up'; ping rejects -> 'down' */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/adapter-auth exec vitest run src/local/local-auth.test.ts`

- [ ] **Step 3: Implement `local-auth.ts` and the exports**

- [ ] **Step 4: Run the whole package and confirm the Keycloak tests still pass**

Run: `pnpm --filter @openldr/adapter-auth exec vitest run`
Expected: PASS, including every test in `src/index.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-auth
git commit -m "feat(auth): AuthPort backed by local accounts"
```

---

### Task 7: Bootstrap wiring and shared account logic

**Files:**
- Modify: `packages/bootstrap/src/index.ts:643-660` and the `AppContext` type
- Create: `packages/bootstrap/src/local-accounts.ts`, exported from the package index
- Test: `packages/bootstrap/src/local-accounts.test.ts`
- Test: `packages/bootstrap/src/local-sign-in.live.test.ts`

**Interfaces:**
- Consumes: `createLocalAuth`, `LOCAL_ISSUER`, `LocalSignIn` (Task 6). `createLocalAuthStore` (Task 2). `parseSecretKey` from `@openldr/core`. `requireOidcIssuer` (Task 1).
- Produces: `AppContext.localSignIn?: LocalSignIn`, set only under `AUTH_ADAPTER=local`.
- Produces, in `local-accounts.ts`:

```ts
export class LocalSignInNotEnabledError extends Error {}
export class SetupAlreadyDoneError extends Error {}
export class UnknownUserError extends Error {}
export function generateTemporaryPassword(): string; // 16 characters from ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789
export function createSetupCode(ctx: Pick<AppContext, 'localSignIn'>): Promise<string>;
export function createLocalAccount(ctx: AppContext, actor: AuditActor, input: { username: string; name?: string; email?: string; roles?: string[] }): Promise<{ user: DirectoryUser; temporaryPassword: string }>;
export function resetLocalPassword(ctx: AppContext, actor: AuditActor, username: string): Promise<{ temporaryPassword: string }>;
export function endLocalSessions(ctx: AppContext, actor: AuditActor, username: string): Promise<void>;
```

Wiring in `createAppContext`: create the internal database first. Under `local`, build the store from `internal.db`, call `createLocalAuth` with `users` and `roles` from the same stores the context already builds, `secretKey: parseSecretKey(cfg.SECRETS_ENCRYPTION_KEY)`, and a `ping` that runs `select 1`. Call `bindAuthIssuer(internal.db, LOCAL_ISSUER)` unless the bypass is on. Under `keycloak` and `oidc`, keep the current `createAuth` call and bind `requireOidcIssuer(cfg)`. If `createLocalAuth` throws, close the internal database before rethrowing, as the existing `bindAuthIssuer` failure path does.

Audit actions: `user.create`, `user.reset_password`, `user.force_logout`. These match `apps/server/src/users-routes.ts`. Audit metadata holds the username and never the password.

- [ ] **Step 1: Write the failing unit tests**

```ts
it('createSetupCode refuses when local sign-in is off', async () => {
  await expect(createSetupCode({ localSignIn: undefined })).rejects.toBeInstanceOf(LocalSignInNotEnabledError);
});
it('createSetupCode refuses once an admin exists', async () => {
  await expect(createSetupCode({ localSignIn: fake({ setupRequired: false }) })).rejects.toBeInstanceOf(SetupAlreadyDoneError);
});
it('makes a 16-character temporary password that passes the rules', () => {
  const p = generateTemporaryPassword();
  expect(p).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]{16}$/);
});
it('resetLocalPassword sets a temporary password and audits without it', async () => {
  const { temporaryPassword } = await resetLocalPassword(ctx, actor, 'ada');
  expect(ctx.auth.resetPassword).toHaveBeenCalledWith(adaId, temporaryPassword, true);
  expect(JSON.stringify(audit.events)).not.toContain(temporaryPassword);
  expect(audit.events[0]).toMatchObject({ action: 'user.reset_password', entityId: adaId });
});
it('resetLocalPassword refuses an unknown username', async () => {
  await expect(resetLocalPassword(ctx, actor, 'nobody')).rejects.toBeInstanceOf(UnknownUserError);
});
it('createLocalAccount creates through the directory with a temporary password', async () => { /* directory.create called with temporaryPassword: true */ });
it('endLocalSessions calls forceLogout and audits', async () => { /* action 'user.force_logout' */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/local-accounts.test.ts`

- [ ] **Step 3: Implement the wiring and `local-accounts.ts`**

- [ ] **Step 4: Write the live tests against real Postgres**

Copy the fixture in `packages/bootstrap/src/account-status.live.test.ts`: it reads `P08_TEST_DATABASE_URL` and makes a throwaway schema. pg-mem cannot prove these three.

```ts
it('counts two wrong tries that arrive together', async () => {
  // two connections, recordFailure on each at once with max 5, then getCredential().failedCount === 2
});
it('creates one admin from two setup requests on two connections', async () => {
  // one setup code, two createLocalSignIn instances over two connections, Promise.all, one ok, one credential row
});
it('refuses to bind the local issuer on a database bound to a Keycloak issuer', async () => {
  // bindAuthIssuer(db, 'http://kc/realms/openldr') then expect bindAuthIssuer(db, LOCAL_ISSUER) to reject
});
```

- [ ] **Step 5: Run unit and live tests**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/local-accounts.test.ts`
Run: `P08_TEST_DATABASE_URL=<a scratch database on the dev Postgres> pnpm --filter @openldr/bootstrap exec vitest run src/local-sign-in.live.test.ts`
Expected: PASS for both. If no scratch database is available, write HONEST NON-PROOF in the report and say which three cases are unproven.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap
git commit -m "feat(bootstrap): wire local sign-in into the app context"
```

---

### Task 8: Server routes

**Files:**
- Create: `apps/server/src/session-cookie.ts`, `apps/server/src/local-auth-routes.ts`
- Modify: `apps/server/src/auth-plugin.ts:83-95` (public paths) and after `:115` (forced-change gate)
- Modify: `apps/server/src/app.ts:48-71` (config route) and the route registration list near `:155`
- Modify: `apps/server/src/users-routes.ts:304-314` (reset email)
- Test: `apps/server/src/local-auth-routes.test.ts`, `session-cookie.test.ts`, additions to `auth-plugin.test.ts` and `config-route.test.ts`

**Interfaces:**
- Consumes: `ctx.localSignIn` (Task 7), `PasswordResetEmailUnsupportedError` (Task 6).
- Produces:

```ts
// session-cookie.ts
export const SESSION_COOKIE = 'openldr_session';
export function readSessionCookie(header: string | undefined): string | null;
export function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date, secure: boolean, now?: Date): void;
export function clearSessionCookie(reply: FastifyReply, secure: boolean): void;
// local-auth-routes.ts
export function registerLocalAuthRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void;
```

Cookie attributes: `Path=/api/auth`, `HttpOnly`, `SameSite=Strict`, `Max-Age` in whole seconds, and `Secure` only when `req.protocol === 'https'`. `req.protocol` already honours `TRUST_PROXY` (`apps/server/src/app.ts:93`).

Wire shapes. `registerLocalAuthRoutes` registers nothing when `ctx.localSignIn` is undefined.

| Route | Body | Answers |
|---|---|---|
| `POST /api/auth/login` | `{ username, password }` | 200 `{ accessToken, expiresIn, mustChangePassword }` with the cookie. 401 `{ error: 'invalid_credentials' }` for `invalid`, `locked` and `disabled` alike. 429 `{ error: 'too_many_attempts' }`. 400 `{ error: 'invalid_body' }` |
| `POST /api/auth/refresh` | none | 200 `{ accessToken, expiresIn, mustChangePassword }`. 401 `{ error: 'session_ended' }` and the cookie cleared |
| `POST /api/auth/logout` | none | 204 and the cookie cleared, with or without a session |
| `POST /api/auth/change-password` | `{ currentPassword, newPassword }` | 204. 400 `{ error }` where error is `wrong_current`, `too_short`, `too_long` or `same_as_username` |
| `POST /api/auth/setup` | `{ setupCode, username, displayName?, password }` | 201 with the login body and the cookie. 409 `{ error: 'already_set_up' }`. 401 `{ error: 'bad_code' }`. 400 `{ error }` for `bad_username` and the rule failures. 429 as for login |

Other rules:

- The body schema caps `password` at 1,024 characters and `username` at 320, so an oversized value is refused before any hash runs.
- `login` and `setup` share one in-memory limiter keyed by `req.ip`: 30 requests per 60 seconds.
- `change-password` needs a bearer token. It is not a public path. It takes the user from `req.user.id` and the session from `req.sessionId`. The auth plugin does not keep the verified claims today, so add `sessionId?: string` to the `FastifyRequest` declaration in `auth-plugin.ts` and set it from `claims.sid` when that is a string.
- In `auth-plugin.ts`, `login`, `refresh`, `logout` and `setup` return early like `/api/config` does. After `verifyToken`, when `claims.pwd_change === true` and the path is not `/api/auth/change-password`, answer 403 `{ error: 'password_change_required' }`.
- `GET /api/config` gains `auth: { mode, setupRequired }`. `mode` is `AUTH_ADAPTER`. `setupRequired` is `await ctx.localSignIn?.setupRequired() ?? false`. Under `local`, `oidc` is `null`. Under the other two modes the `oidc` block is unchanged.
- `users-routes.ts`: when `sendPasswordResetEmail` throws `PasswordResetEmailUnsupportedError`, answer 501 `{ error: 'password reset email is not available with local sign-in' }`.
- Audit with `safeRecord`. Actions: `auth.login`, `auth.logout`, `auth.setup`, `user.change_password`, and the existing `auth.failed` with `entityId` `bad-credentials` or `locked`. Metadata holds `ip` and, where a user was matched, the user ID. It never holds the identifier that was typed, because people type passwords into the username field.

- [ ] **Step 1: Write the failing tests**

Build a Fastify app with `registerAuth` and `registerLocalAuthRoutes` over a fake `ctx`, as `users-routes.test.ts` does. Give it a fake `localSignIn`.

```ts
it('signs in and sets an HttpOnly strict cookie scoped to /api/auth', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ada', password: GOOD } });
  expect(r.statusCode).toBe(200);
  expect(r.json()).toEqual({ accessToken: 'tok', expiresIn: 600, mustChangePassword: false });
  const c = String(r.headers['set-cookie']);
  expect(c).toContain('openldr_session='); expect(c).toContain('HttpOnly');
  expect(c).toContain('SameSite=Strict'); expect(c).toContain('Path=/api/auth');
  expect(c).not.toContain('Secure');
});
it('marks the cookie Secure over https', async () => { /* inject with x-forwarded-proto https and trustProxy on */ });
it('answers the same 401 for invalid, locked and disabled', async () => {
  for (const reason of ['invalid', 'locked', 'disabled'] as const) {
    fake.loginResult = { ok: false, reason };
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ada', password: GOOD } });
    expect(r.statusCode).toBe(401); expect(r.json()).toEqual({ error: 'invalid_credentials' });
  }
});
it('never audits the typed identifier', async () => {
  fake.loginResult = { ok: false, reason: 'invalid' };
  await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'my-real-password', password: GOOD } });
  expect(JSON.stringify(audit.events)).not.toContain('my-real-password');
});
it('refuses the 31st attempt from one address in a minute', async () => { /* 30 x 401 then 429 too_many_attempts */ });
it('refuses an oversized password before calling the service', async () => { /* 2000 chars -> 400, fake.login not called */ });
it('refresh returns a token, or 401 and a cleared cookie', async () => { /* Max-Age=0 on the failure */ });
it('refresh fails for a user disabled after sign-in', async () => { /* fake.refresh returns null -> 401 session_ended */ });
it('logout always answers 204 and clears the cookie', async () => {});
it('change-password needs a bearer token', async () => { /* no header -> 401 */ });
it('change-password maps each failure to a 400', async () => { /* wrong_current, too_short */ });
it('setup answers 201, 409, 401 and 400', async () => {});
it('a must-change token reaches change-password and nothing else', async () => {
  fake.claims = { sub: 'u1', sid: 's1', pwd_change: true };
  expect((await app.inject({ method: 'GET', url: '/api/users', headers: BEARER })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: BEARER, payload: { currentPassword: 'a', newPassword: GOOD } })).statusCode).toBe(204);
});
it('registers no auth routes without local sign-in', async () => { /* ctx.localSignIn undefined -> 404 */ });
// config-route.test.ts
it('reports local mode with oidc null and the setup state', async () => {
  expect(body.auth).toEqual({ mode: 'local', setupRequired: true });
  expect(body.oidc).toBeNull();
  expect(body.authCapabilities).toEqual({ identityAdmin: true, syncClientAdmin: false, passwordResetEmail: false });
});
it('leaves the keycloak config block as it was', async () => { /* oidc.mode 'keycloak', issuerUrl present, auth.mode 'keycloak' */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/server exec vitest run src/local-auth-routes.test.ts src/session-cookie.test.ts src/config-route.test.ts src/auth-plugin.test.ts`

- [ ] **Step 3: Implement the cookie helper, the routes, and the three edits**

Every handler must `return reply.send(...)` or return the value. `apps/server` lint enforces this so gzip cannot clobber the response.

- [ ] **Step 4: Run tests and lint**

Run: the command from Step 2, then `pnpm --filter @openldr/server lint > /tmp/lint.txt 2>&1; echo "exit=$?"`
Expected: PASS and `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): sign-in, refresh, logout, password and setup routes"
```

---

### Task 9: Studio sign-in page and the `AuthProvider` branch

**Files:**
- Create: `apps/studio/src/auth/local.ts`, `apps/studio/src/auth/LoginPage.tsx`
- Modify: `apps/studio/src/api.ts:437-439`, `apps/studio/src/auth/capabilities.ts`, `apps/studio/src/auth/AuthProvider.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/auth/local.test.ts`, `LoginPage.test.tsx`, additions to `AuthProvider.test.tsx` and `capabilities.test.ts`

**Interfaces:**
- Consumes: the wire shapes from Task 8.
- Produces:

```ts
// api.ts
export interface AuthCapabilities { identityAdmin: boolean; syncClientAdmin: boolean; passwordResetEmail?: boolean }
export interface AuthModeConfig { mode: 'keycloak' | 'oidc' | 'local'; setupRequired: boolean }
// ClientConfig gains `auth?: AuthModeConfig`, and `oidc` may be null.

// auth/local.ts
export interface LocalSession { accessToken: string; expiresIn: number; mustChangePassword: boolean }
export type PasswordFailure = 'too_short' | 'too_long' | 'same_as_username';
export function localLogin(username: string, password: string): Promise<LocalSession | 'invalid' | 'too_many'>;
export function localRefresh(): Promise<LocalSession | null>;
export function localLogout(): Promise<void>;
export function localChangePassword(current: string, next: string): Promise<'ok' | 'wrong_current' | PasswordFailure>;
export function localSetup(input: { setupCode: string; username: string; displayName?: string; password: string }): Promise<LocalSession | 'already_set_up' | 'bad_code' | 'bad_username' | 'too_many' | PasswordFailure>;
/** Stores the token with setAccessToken, then refreshes 60 seconds before it expires. Returns a stop function. */
export function keepSessionFresh(session: LocalSession, onEnded: () => void): () => void;
```

All calls use plain `fetch` with `credentials: 'same-origin'`, not `authFetch`, so a 401 here cannot trigger the re-login handler.

`AuthProvider` under local sign-in. This branch goes before the `!cfg.authEnforced || !cfg.oidc` check at `AuthProvider.tsx:69`. That check treats a missing `oidc` block as dev bypass, and under local sign-in `oidc` is null.

- When `cfg.auth?.setupRequired`, render the setup screen. Task 10 builds it. Until then render the sign-in page.
- Otherwise call `localRefresh()`. On null render `LoginPage`. On a session with `mustChangePassword` render the forced-change screen from Task 10. Otherwise call `keepSessionFresh`, load the user and capabilities, and render the app.
- `signOut` calls `localLogout()`, clears the token, and renders `LoginPage`.
- Register `setUnauthorizedHandler` to try `localRefresh()` once, then render `LoginPage`.
- The pre-sign-in screens render in place at whatever URL the person opened. After sign-in the app shows that URL. Add no route.

`LoginPage` layout: a centred card inside `StripedEmpty` with `h-dvh`. The fields use `grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3`, copied from `pages/settings/Connectors.tsx`. One submit `Button`. Enter submits. The message sits under the fields. The username input has `autoComplete="username"` and the password input `autoComplete="current-password"`.

Strings, under a new `auth` block in all three files:

| Key | en | fr | pt |
|---|---|---|---|
| `signInTitle` | Sign in to OpenLDR | Connexion à OpenLDR | Iniciar sessão no OpenLDR |
| `username` | Username or email | Nom d'utilisateur ou e-mail | Nome de utilizador ou e-mail |
| `password` | Password | Mot de passe | Palavra-passe |
| `invalid` | Those details are wrong, or the account is locked for a few minutes. | Ces informations sont incorrectes, ou le compte est verrouillé pour quelques minutes. | Estes dados estão errados, ou a conta está bloqueada durante alguns minutos. |
| `tooMany` | Too many attempts. Wait a minute and try again. | Trop de tentatives. Attendez une minute et réessayez. | Demasiadas tentativas. Aguarde um minuto e tente novamente. |

The submit button reuses `common.signIn`.

- [ ] **Step 1: Write the failing tests**

```tsx
// AuthProvider.test.tsx
it('shows the sign-in form under local sign-in and loads no user', async () => {
  mockConfig({ authEnforced: true, oidc: null, auth: { mode: 'local', setupRequired: false } });
  mockLocalRefresh(null);
  render(<AuthProvider><p>app</p></AuthProvider>);
  expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
  expect(screen.queryByText('app')).toBeNull();
  expect(getMe).not.toHaveBeenCalled();
});
it('loads the app when a local session exists', async () => {
  mockLocalRefresh({ accessToken: 't', expiresIn: 600, mustChangePassword: false });
  render(<AuthProvider><p>app</p></AuthProvider>);
  expect(await screen.findByText('app')).toBeInTheDocument();
  expect(getAccessToken()).toBe('t');
});
it('still treats a missing oidc block as bypass when auth is not enforced', async () => { /* existing dev-bypass behaviour unchanged */ });
// LoginPage.test.tsx
it('signs in and calls onSignedIn with the session', async () => {});
it('shows the invalid message and keeps the username', async () => {});
it('shows the too-many message on 429', async () => {});
it('disables the button while the request runs', async () => {});
// local.test.ts
it('maps 401 to invalid and 429 to too_many', async () => {});
it('refreshes 60 seconds before expiry and stores the new token', async () => { /* fake timers: advance 540_000 ms, expect second fetch and setAccessToken */ });
it('calls onEnded when a refresh fails', async () => {});
// capabilities.test.ts
it('passes passwordResetEmail through from the server', () => {});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/studio exec vitest run src/auth`

- [ ] **Step 3: Implement `local.ts`, `LoginPage.tsx`, the `AuthProvider` branch, the types and the strings**

- [ ] **Step 4: Run the auth tests and the i18n parity test**

Run: `pnpm --filter @openldr/studio exec vitest run src/auth src/i18n`
Expected: PASS.

- [ ] **Step 5: Check the page at 375x812**

Boot the server with `AUTH_ADAPTER=local` against a scratch database, open studio, and resize to 375x812. The card must fit with no sideways scroll, and the button must be reachable. Record a screenshot. Write in the report that the cookie over plain HTTP on a phone is not proven by this check.

- [ ] **Step 6: Commit**

```bash
git add apps/studio
git commit -m "feat(studio): sign-in page for local sign-in"
```

---

### Task 10: Setup page, forced change, change-password sheet, Users page

**Files:**
- Create: `apps/studio/src/auth/SetupPage.tsx`, `ChangePasswordPage.tsx`, `ChangePasswordSheet.tsx`
- Modify: `apps/studio/src/auth/AuthProvider.tsx` (render the two pages), `apps/studio/src/shell/AppShell.tsx` near `:295` (menu item), `apps/studio/src/pages/Users.tsx:118-122`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: one test file per new component, plus additions to the Users page test

**Interfaces:**
- Consumes: `localSetup`, `localChangePassword`, `LocalSession` (Task 9). `useAuth().authCapabilities`.
- Produces: `useAuth()` gains `authMode: 'keycloak' | 'oidc' | 'local'`.

Behaviour:

- `SetupPage` has four fields: setup code, username, password, repeat password. It uses the `LoginPage` layout. On success it behaves like a sign-in.
- `ChangePasswordPage` shows when a session must change its password. Fields: current password, new password, repeat. On success it calls `localRefresh()` and loads the app. It offers a sign-out link.
- `ChangePasswordSheet` opens from a "Change password" item in the user menu, above sign-out. The item shows only when `authMode === 'local'`. It is a `Sheet`. Its fields are label-left. Its save action sits in the sheet's dots menu. Copy `forms-builder/FieldEditorSheet.tsx`.
- New password inputs use `autoComplete="new-password"`.
- The repeat field is checked in the browser. Nothing is sent when the two differ.
- `Users.tsx` hides "Send reset email" when `authCapabilities.passwordResetEmail === false`. It still shows when the flag is undefined, so an older server keeps today's behaviour.
- Run `grep -n -i keycloak apps/studio/src/i18n/en.ts`. For each string a user sees under local sign-in, write provider-neutral wording in all three languages. List the changed keys in the report.
- Under Keycloak, compare the roles the Users page shows for one user with what the Roles page shows for the same user. If they disagree, say so in the report. Do not fix it in this work.

Strings, added to the `auth` block:

| Key | en | fr | pt |
|---|---|---|---|
| `setupTitle` | Create the administrator | Créer l'administrateur | Criar o administrador |
| `setupCode` | Setup code | Code de configuration | Código de configuração |
| `setupCodeHint` | Run "openldr auth setup-code" on the server to get one. | Exécutez « openldr auth setup-code » sur le serveur pour en obtenir un. | Execute "openldr auth setup-code" no servidor para obter um. |
| `newPassword` | New password | Nouveau mot de passe | Nova palavra-passe |
| `repeatPassword` | Repeat password | Répéter le mot de passe | Repetir a palavra-passe |
| `currentPassword` | Current password | Mot de passe actuel | Palavra-passe atual |
| `changePassword` | Change password | Changer le mot de passe | Alterar a palavra-passe |
| `mustChangeTitle` | Choose a new password | Choisissez un nouveau mot de passe | Escolha uma nova palavra-passe |
| `tooShort` | Use at least 10 characters. | Utilisez au moins 10 caractères. | Utilize pelo menos 10 caracteres. |
| `tooLong` | Use 128 characters or fewer. | Utilisez 128 caractères ou moins. | Utilize 128 caracteres ou menos. |
| `sameAsUsername` | The password cannot be the username. | Le mot de passe ne peut pas être le nom d'utilisateur. | A palavra-passe não pode ser o nome de utilizador. |
| `passwordsDiffer` | The two passwords do not match. | Les deux mots de passe ne correspondent pas. | As duas palavras-passe não coincidem. |
| `wrongCurrent` | The current password is wrong. | Le mot de passe actuel est incorrect. | A palavra-passe atual está errada. |
| `badCode` | That setup code is wrong or has expired. | Ce code de configuration est incorrect ou a expiré. | Este código de configuração está errado ou expirou. |
| `badUsername` | Use 3 to 64 letters, digits, dots, dashes or underscores. | Utilisez 3 à 64 lettres, chiffres, points, tirets ou traits de soulignement. | Utilize 3 a 64 letras, dígitos, pontos, hífenes ou sublinhados. |
| `alreadySetUp` | An administrator already exists. Sign in instead. | Un administrateur existe déjà. Connectez-vous. | Já existe um administrador. Inicie sessão. |
| `passwordChanged` | Password changed. | Mot de passe modifié. | Palavra-passe alterada. |

- [ ] **Step 1: Write the failing tests**

```tsx
it('SetupPage sends nothing when the two passwords differ', async () => { /* expect message passwordsDiffer and localSetup not called */ });
it('SetupPage shows each server failure in words', async () => { /* bad_code, already_set_up, too_short, bad_username */ });
it('SetupPage signs the admin in on success', async () => {});
it('ChangePasswordPage loads the app after a successful change', async () => { /* localChangePassword 'ok', then localRefresh called */ });
it('ChangePasswordPage shows wrong_current', async () => {});
it('ChangePasswordSheet saves from the dots menu and closes', async () => {});
it('the user menu shows Change password only under local sign-in', async () => {});
it('Users hides Send reset email when the flag is false and shows it when undefined', async () => {});
it('AuthProvider shows the setup page when setup is required', async () => {});
it('AuthProvider shows the forced change page for a must-change session', async () => {});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/studio exec vitest run src/auth src/pages/Users src/shell`

- [ ] **Step 3: Implement the three components and the edits**

- [ ] **Step 4: Run the tests and the parity test**

Run: `pnpm --filter @openldr/studio exec vitest run src/auth src/pages src/shell src/i18n`
Expected: PASS.

- [ ] **Step 5: Check all three screens and the sheet at 375x812** and record screenshots.

- [ ] **Step 6: Commit**

```bash
git add apps/studio
git commit -m "feat(studio): setup, forced change and change-password screens"
```

---

### Task 11: CLI commands

**Files:**
- Modify: `packages/cli/src/auth.ts`, `packages/cli/src/user.ts`, `packages/cli/src/program.ts:305` and `:1233`
- Test: `packages/cli/src/auth.test.ts`, `packages/cli/src/user.test.ts`

**Interfaces:**
- Consumes: `createSetupCode`, `createLocalAccount`, `resetLocalPassword`, `endLocalSessions` and their error classes (Task 7). `cliActor` from `./cli-actor`.
- Produces:

```ts
export function runAuthSetupCode(opts: { json: boolean }): Promise<number>;
export function runUserResetPassword(username: string, opts: { json: boolean; force: boolean }): Promise<number>;
export function runUserEndSessions(username: string, opts: { json: boolean }): Promise<number>;
```

Commands:

| Command | Output and exit code |
|---|---|
| `openldr auth setup-code [--json]` | Prints the code and `valid for 30 minutes`. Exit 1 with `local sign-in is not enabled` or `an administrator already exists` |
| `openldr user create ...` | Flags unchanged. Under `local` it calls `createLocalAccount` and prints the temporary password once. Under the other modes it behaves as today |
| `openldr user reset-password <username> --force [--json]` | Prints the temporary password once. Without `--force` it refuses, exit 1, and says the user's sessions will end |
| `openldr user end-sessions <username> [--json]` | Prints `ended sessions for <username>` |

`reset-password` and `end-sessions` exit 1 with `local sign-in is not enabled` under the other two modes. Follow the `try`, `redactError`, `process.exitCode` pattern at `program.ts:305-316`.

- [ ] **Step 1: Write the failing tests**

```ts
it('setup-code prints a code under local sign-in', async () => { /* stdout matches /[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/, exit 0 */ });
it('setup-code exits 1 when an administrator exists', async () => {});
it('reset-password refuses without --force and changes nothing', async () => { /* exit 1, resetLocalPassword not called */ });
it('reset-password prints the temporary password once with --force', async () => {});
it('reset-password exits 1 for an unknown user', async () => {});
it('end-sessions calls endLocalSessions', async () => {});
it('user create under local sign-in goes through the directory', async () => { /* createLocalAccount called, ctx.users.create not called */ });
it('user create under keycloak still writes the local row', async () => { /* ctx.users.create called, as today */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/cli exec vitest run src/auth.test.ts src/user.test.ts`

- [ ] **Step 3: Implement the three functions, the `user create` branch, and the registrations**

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Run every other `users` and `user` command under local sign-in**

Against a scratch database with `AUTH_ADAPTER=local`, run each subcommand registered under `users` and `user` in `program.ts`. For each, write one line in the report: works, fails, or succeeds but leaves an account that cannot be used. Do not fix what you find here. `openldr user set-role` is already known to write a column that grants nothing (`packages/cli/src/user.ts:74`).

- [ ] **Step 6: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): setup code, password reset and session commands"
```

---

### Task 12: Setup checks line

**Files:**
- Modify: `packages/bootstrap/src/setup-checks.ts:15-18`, `:39`, `:92-95`, and `setupCheckDeps`
- Modify: the hint strings in `apps/studio/src/i18n/en.ts` near `:447`, and `fr.ts`, `pt.ts`
- Test: `packages/bootstrap/src/setup-checks.test.ts`

**Interfaces:**
- Consumes: `ctx.localSignIn?.setupRequired` (Task 7).
- Produces: `SetupCheckDeps.setupRequired?: () => Promise<boolean>`. A new hint ID `signInSetup`.

The `signIn` check keeps its bypass result first. When the bypass is off and `setupRequired` returns true, it returns `{ id: 'signIn', status: 'warn', hint: 'signInSetup' }` with no `fix` link, because the setup screen already shows before the app loads.

Hint text: en `No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.` Translate it for fr and pt in the same style as the neighbouring hints.

- [ ] **Step 1: Write the failing tests**

```ts
it('warns while local sign-in still needs setup', async () => {
  const r = await runSetupChecks(deps({ setupRequired: async () => true }));
  expect(r.checks.find(c => c.id === 'signIn')).toMatchObject({ status: 'warn', hint: 'signInSetup' });
});
it('passes once an administrator exists', async () => { /* setupRequired false -> pass */ });
it('reports the bypass before the setup state', async () => { /* AUTH_DEV_BYPASS true and setupRequired true -> hint signInOff */ });
it('passes when setupRequired is not provided', async () => { /* keycloak and oidc installs */ });
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/setup-checks.test.ts`

- [ ] **Step 3: Implement.** `openldr doctor` and `POST /api/settings/setup-checks` both go through `setupCheckDeps`, so one edit covers both.

- [ ] **Step 4: Run the bootstrap test, the doctor test and the parity test**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/setup-checks.test.ts && pnpm --filter @openldr/cli exec vitest run src/doctor.test.ts && pnpm --filter @openldr/studio exec vitest run src/i18n`

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap apps/studio
git commit -m "feat(setup): warn while local sign-in has no administrator"
```

---

### Task 13: Docs

**Files:**
- In-app guide in en, fr and pt under `apps/studio/src/docs/`. Run `git show --stat f37702ef` to see every file the preferences guide added, and add the same set for this guide.
- Web docs under `apps/web/src/docs/`.
- Test: `apps/studio/src/docs/registry.test.ts`, `validation.test.ts`, and `apps/web/src/docs/content.test.ts` must pass.

Content:

- In-app guide, following `apps/studio/src/docs/HOW-TO-TEMPLATE.md`: sign in, change your own password, what happens after five wrong tries, and what to do when you forget your password. That last part tells the reader to ask an administrator.
- In-app admin section: create a user with a temporary password, reset a password, end a user's sessions.
- Web docs: the three sign-in choices and when to pick each, the setup code on a new install, and a troubleshooting entry for a forgotten administrator password with `openldr user reset-password <username> --force`.
- State plainly that on plain HTTP a password crosses the network unencrypted, and that HTTPS or Tailscale closes that.

- [ ] **Step 1: Write the guide in English, then French and Portuguese.** Use European Portuguese, as `c27b98f9` did.
- [ ] **Step 2: Capture screenshots if the template needs them.** If you cannot capture them, say so in the report. Do not ship a guide that points at missing images.
- [ ] **Step 3: Run the docs tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs && pnpm --filter @openldr/web exec vitest run src/docs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs: sign-in and password guide for local sign-in"
```

---

### Task 14: New installs default to local sign-in

**Files:**
- Modify: `.env.example:8` and the OIDC and Keycloak lines at `:29-43`
- Modify: `docker-compose.prod.yml:18`, `:53`, `:111`. `deploy/install/docker-compose.yml:32`, `:59`, and its Keycloak service
- Modify: `install/install.sh`, `install/install.ps1`, `scripts/init.mjs`, `scripts/init/secrets.mjs`
- Modify: `DEPLOYMENT.md`
- Test: `scripts/init/secrets.test.mjs`, `packages/config/src/env-docs.test.ts`

Changes:

- `.env.example` sets `AUTH_ADAPTER=local`. The OIDC and Keycloak lines move under a commented heading that says they apply to `keycloak` and `oidc` only.
- In both compose files the `keycloak` service gets `profiles: ["keycloak"]`. Each `depends_on` entry for it becomes `keycloak: { condition: service_healthy, required: false }`. That needs Docker Compose 2.20 or later. State the version floor in `DEPLOYMENT.md`.
- The install scripts ask which sign-in to use, with local as the default. For Keycloak they add `--profile keycloak` and write today's Keycloak settings. For local they write no Keycloak secrets.
- At the end of a local install the script runs `openldr auth setup-code` inside the server container and prints the code where it prints the one-time password today.
- `DEPLOYMENT.md` explains both paths and how to turn Keycloak on later for a fresh install. Moving an existing install between sign-in modes is not supported, and the doc says so.

- [ ] **Step 1: Extend `scripts/init/secrets.test.mjs`**

```js
test('a local install writes AUTH_ADAPTER=local and no Keycloak admin secret', () => {});
test('a keycloak install writes the same values as before this change', () => {});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/init/secrets.test.mjs`

- [ ] **Step 3: Make the changes**

- [ ] **Step 4: Check both compose files parse in both shapes**

Run: `docker compose -f docker-compose.prod.yml config > /tmp/c1.txt 2>&1; echo "exit=$?"`
Run: `docker compose -f docker-compose.prod.yml --profile keycloak config > /tmp/c2.txt 2>&1; echo "exit=$?"`
Expected: `exit=0` twice. `/tmp/c1.txt` has no `keycloak` service and `/tmp/c2.txt` has one. Repeat for `deploy/install/docker-compose.yml`.

- [ ] **Step 5: Run the script test and the env docs test**

Run: `node --test scripts/init/secrets.test.mjs && pnpm --filter @openldr/config exec vitest run src/env-docs.test.ts`

- [ ] **Step 6: Commit**

```bash
git add .env.example docker-compose.prod.yml deploy install scripts DEPLOYMENT.md
git commit -m "feat(install): new installs use local sign-in, Keycloak is optional"
```

A full Docker install from scratch is not run in this task. Write HONEST NON-PROOF for it in the report unless you ran one.

---

### Task 15: Real boot proof and the gate

No new files. This task proves the pieces work together on real Postgres.

- [ ] **Step 1: Boot on a fresh database**

Create a new database on the dev Postgres with a name that is not `openldr` or `openldr_target`. Start the server on a spare port with `AUTH_ADAPTER=local`, `AUTH_DEV_BYPASS=false`, `MIGRATE_ON_START=true`, and both database URLs pointing at fresh databases. Expected: it starts, and the log shows migration `116_local_sign_in` applied.

- [ ] **Step 2: Walk the flow with curl and record each status**

1. `GET /api/config` shows `auth.mode` `local` and `setupRequired` true.
2. `GET /api/users` with no token answers 401.
3. `openldr auth setup-code` prints a code.
4. `POST /api/auth/setup` answers 201 and sets the cookie.
5. `GET /api/me` with the token answers 200 with the admin.
6. `POST /api/auth/setup` again answers 409.
7. `POST /api/auth/logout`, then `POST /api/auth/refresh`, answers 401.
8. Five wrong passwords, then the right one, answers 401. Do not wait out the five minutes.
9. `openldr user reset-password <admin> --force` prints a temporary password. Sign-in with it returns `mustChangePassword` true. `GET /api/users` answers 403. After `change-password`, `GET /api/users` answers 200.
10. Restart the server. The token from before the restart still verifies, which proves the key came from the database.

- [ ] **Step 3: Prove the refusal on a Keycloak-bound database**

Start the server with `AUTH_ADAPTER=local` against the normal dev database, which is bound to the Keycloak issuer. Expected: it refuses to start with the issuer-binding error and changes nothing. Then stop.

- [ ] **Step 4: Prove Keycloak mode is unchanged**

Start the server with the normal dev `.env`. Sign in through Keycloak in studio and open the Users page. Expected: it behaves as before, and "Send reset email" still shows.

- [ ] **Step 5: Run the full gate**

Run: `pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "exit=$?"`
Run: `pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "exit=$?"`
Run: `pnpm depcruise > /tmp/gate-dc.txt 2>&1; echo "exit=$?"`
Expected: `exit=0` three times. On a failure, grep for `Test timed out`, `out of memory` and `VirtualAlloc` before reading it as a regression, and re-run that package alone.

- [ ] **Step 6: Drop the scratch databases and stop the spare server**

- [ ] **Step 7: After the work merges to `main`, update the changelog**

```bash
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(web): update changelog for local sign-in"
```

- [ ] **Step 8: Write the final report**

List what each layer proved, and these as HONEST NON-PROOF unless you tested them: hash time on a small lab machine, the session cookie over plain HTTP in a real phone browser, and a full Docker install from scratch.
