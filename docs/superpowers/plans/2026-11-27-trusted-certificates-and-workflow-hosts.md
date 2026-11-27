# Trusted certificates and workflow hosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator can add a trusted certificate and name the hosts a workflow may call, in Studio or the CLI, on every edition.

**Architecture:** Trusted certificates live in one PEM file that Node reads when it starts. The server reads and writes that file through one service in `@openldr/bootstrap`. Workflow hosts are two stored settings, read on every call. A new Settings page, Network, and matching CLI commands call the same two services.

**Tech Stack:** TypeScript, Fastify, vitest, React with shadcn, `node:tls`, `node:crypto`. No new package.

**Spec:** `docs/superpowers/specs/2026-11-27-trusted-certificates-and-workflow-hosts-design.md`. It closes gaps G16 and G19 of `2026-11-27-lab-deployment-setups-design.md`.

This plan stands alone. It does not need plans 1 to 3. The lab-bench direct referral (plan 3) needs this one.

## Global Constraints

- The new permission is `network.manage`, in a new group `network`. Administrators hold it by default.
- The trust file is named by the new setting `TRUSTED_CA_FILE`. Node is started with `NODE_EXTRA_CA_CERTS` naming the same file.
- A new certificate is used after a restart, on every edition.
- "In use" comes from Node: `tls.getCACertificates('extra')`. Never from the file.
- A file the person set themselves in `NODE_EXTRA_CA_CERTS` is never edited.
- A private key is never stored, never logged and never echoed back.
- The certificate that is saved is the one that was shown. It is not fetched a second time.
- Both lists start empty. The switch starts off.
- Stored settings: `workflows.http_hosts` (a JSON array of host names) and `workflows.http_self` (`true` or `false`). Neither is in `CENTER_OWNED_SETTING_KEYS`. They never sync.
- "This OpenLDR" is exactly `http://127.0.0.1:<PORT>`, where PORT is the server's own.
- Fingerprints are SHA-256, 32 upper case hex pairs joined by colons.
- Studio follows AGENTS.md §5. Copy `apps/studio/src/pages/settings/Connectors.tsx`.
- Every route returns or awaits `reply.send`. `apps/server` lint enforces it.
- No product code in core (AGENTS.md §8). Nothing here names referrals or lab-bench.
- Short plain sentences in every doc, string and commit message. No em dashes. Run the `unslop` skill over them.
- No `Co-Authored-By` trailer on any commit (AGENTS.md §9).
- Docs land in en, fr and pt.
- From a worktree, set `OPENLDR_SKIP_ENV_FILE=true` for every command that starts a server or CLI.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

## Review Focus

1. **Someone pastes a certificate and its private key together.** Expected: refused, nothing saved, the key in no log and no error text. Test in Task 2.
2. **Two administrators add a certificate at the same moment.** Expected: both are in the file. Test in Task 2.
3. **The trust file was edited by hand and holds text that is not a certificate.** Expected: the page shows the good ones and says the file is damaged. Nothing is written until it is fixed, so nothing is lost. Test in Task 2.
4. **A redirect goes from an allowed host to another port or scheme.** Expected: the sign-in headers are dropped. A redirect to a host that is not allowed is refused. Test in Task 3.
5. **An install is upgraded.** Expected: its Administrator role holds `network.manage`, and a central certificate it already trusted is still trusted. Test in Task 1 and Task 7.

---

### Task 1: The permission

**Files:**
- Modify: `packages/rbac/src/catalog.ts` (after the Connectors entry at line 65)
- Test: `packages/rbac/src/catalog.test.ts` or the test file that lists every key (`packages/rbac/src/data-scope.test.ts:13` holds one such list)
- Test: the server test that covers role seeding at boot

**Interfaces:**
- Produces: the capability key `'network.manage'`.

```ts
{ key: 'network.manage', group: 'network', label: 'Manage network trust', description: 'Add trusted certificates and name the hosts a workflow may call.' },
```

- [ ] **Step 1: Write the failing tests**

```ts
it('lists network.manage in its own group', ...);
// CAPABILITY_KEYS contains 'network.manage'. Its group is 'network'.
it('gives the Administrator preset network.manage', ...);
// The 'lab_admin' preset at packages/rbac/src/presets.ts:51 spreads CAPABILITY_KEYS, so this should pass once the key exists.
it('gives an existing Administrator role network.manage after a start', ...);
// Seed a database whose lab_admin role was written before this key existed. Run the boot seeding.
// Expect the role to hold 'network.manage'. Find how locked presets are re-synced at boot and test through that.
```

Update any test that holds the full list of keys, such as `data-scope.test.ts:13`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/rbac test`
Expected: the first test FAILS.

- [ ] **Step 3: Add the catalog entry**

If the third test shows that an existing Administrator role is not updated at boot, stop and report. That is a wider fault than this plan, and the operator decides how to fix it.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm --filter @openldr/rbac test` and the server test from Step 1.

- [ ] **Step 5: Commit**

```bash
git add packages/rbac apps/server
git commit -m "feat(rbac): a permission for network trust"
```

---

### Task 2: The trust service

**Files:**
- Modify: `packages/config/src/schema.ts` (beside `TLS_CERT_PATH` at line 120)
- Create: `packages/bootstrap/src/network-trust.ts`
- Modify: `packages/bootstrap/src/index.ts` (build the service, add it to `AppContext` as `trust`)
- Test: `packages/bootstrap/src/network-trust.test.ts`

**Interfaces:**
- Produces:

```ts
// schema.ts
TRUSTED_CA_FILE: z.string().optional(),

// network-trust.ts
export type TrustError = 'not-a-certificate' | 'private-key' | 'duplicate' | 'not-found' | 'read-only' | 'damaged' | 'no-answer';
export class TrustRefused extends Error { constructor(readonly code: TrustError); }

export interface TrustedCert {
  fingerprint: string;          // 'AB:CD:...'
  subject: string;              // the certificate's common name, or its first DNS or IP name
  validTo: string;              // ISO date
  expired: boolean;
  /** in-use: Node loaded it and it is in the file.
   *  added: in the file, not loaded. Used after a restart.
   *  removed: loaded, no longer in the file. Dropped after a restart.
   *  outside: loaded from a file OpenLDR does not manage. */
  state: 'in-use' | 'added' | 'removed' | 'outside';
}

export interface TrustStatus {
  /** editable: TRUSTED_CA_FILE is set and NODE_EXTRA_CA_CERTS names the same file.
   *  not-configured: TRUSTED_CA_FILE is not set.
   *  set-outside: NODE_EXTRA_CA_CERTS names another file.
   *  damaged: the file holds text that is not a certificate. */
  mode: 'editable' | 'not-configured' | 'set-outside' | 'damaged';
}

export interface CertPreview { pem: string; fingerprint: string; subject: string; validTo: string; expired: boolean }

export interface TrustActor { type: 'user' | 'cli'; id: string | null; name: string }

export interface TrustService {
  status(): Promise<TrustStatus>;
  list(): Promise<TrustedCert[]>;                                  // sorted by subject, then fingerprint
  /** One TLS connection to host:port, 10 s limit, no web request. Throws TrustRefused('no-answer'). */
  preview(address: string): Promise<CertPreview>;
  /** Reads pasted or uploaded text. Throws 'not-a-certificate' or 'private-key'. */
  read(text: string): CertPreview[];
  add(pem: string, actor: TrustActor): Promise<TrustedCert>;       // throws 'duplicate', 'read-only', 'damaged'
  remove(fingerprint: string, actor: TrustActor): Promise<void>;   // throws 'not-found', 'read-only', 'damaged'
}

export function createTrustService(deps: {
  file: string | undefined;                 // cfg.TRUSTED_CA_FILE
  nodeExtraCaFile: string | undefined;      // process.env.NODE_EXTRA_CA_CERTS
  loaded(): string[];                       // PEMs Node loaded: tls.getCACertificates('extra')
  readPeer(host: string, port: number): Promise<string | undefined>;   // the peer certificate as PEM
  audit(action: 'network.trust.add' | 'network.trust.remove', actor: TrustActor, fingerprint: string, subject: string): Promise<void>;
  now(): Date;
}): TrustService;
```

Rules:
- `read` splits the text into PEM blocks. Any block that is not a certificate gives `not-a-certificate`. Any `PRIVATE KEY` block anywhere gives `private-key`, whatever else is there. The text of a refused input goes into no log and no error message.
- `preview` takes `host` or `host:port`. No scheme. The port defaults to 443.
- `add` takes exactly one certificate. It is the PEM the caller got from `preview` or `read`.
- The file is written to a temp name in the same folder, then renamed into place. Writes run one at a time, through one promise chain inside the service.
- Paths are compared after `path.resolve`.
- `mode: 'set-outside'` and `'not-configured'` make `add` and `remove` throw `read-only`. `list` still returns what Node loaded, with state `outside`.
- `mode: 'damaged'` makes `add` and `remove` throw `damaged`. `list` returns the certificates it can read.
- An expired certificate is accepted. `expired` is true on it.

- [ ] **Step 1: Write the failing tests**

Keep three fixed self-signed test certificates with keys in the test file: `A`, `B`, and `OLD` (already expired).

```ts
describe('read', () => {
  it('reads one certificate and gives its fingerprint, subject and end date', ...);
  it('reads two certificates from one text', ...);
  it('refuses text that is not a certificate', ...);                       // 'hello' -> not-a-certificate
  it('refuses a certificate with one bad block beside it', ...);            // A.cert + garbage block -> not-a-certificate
  it('refuses a private key, alone or beside a certificate', ...);          // A.key, and A.cert + A.key -> private-key
  it('puts none of the refused text in the error', ...);                    // String(err) contains no line of A.key
  it('marks an expired certificate', ...);                                  // OLD -> expired true
});
describe('status', () => {
  it('is editable when both settings name the same file', ...);             // also when one path is relative
  it('is not-configured without TRUSTED_CA_FILE', ...);
  it('is set-outside when NODE_EXTRA_CA_CERTS names another file', ...);
  it('is damaged when the file holds text that is not a certificate', ...);
});
describe('list', () => {
  it('shows a certificate Node loaded and the file holds as in-use', ...);
  it('shows one in the file that Node did not load as added', ...);
  it('shows one Node loaded that left the file as removed', ...);
  it('shows what Node loaded as outside when the file is not managed', ...);
  it('still lists the good certificates of a damaged file', ...);
});
describe('add and remove', () => {
  it('adds a certificate, writes the file, and audits the fingerprint', ...);
  it('refuses a duplicate', ...);
  it('accepts an expired certificate', ...);
  it('removes by fingerprint and audits it', ...);
  it('refuses to remove one that is not there', ...);
  it('refuses both when the file is not managed, and leaves it untouched', ...);   // read-only
  it('refuses both when the file is damaged, and leaves it untouched', ...);       // damaged, bytes unchanged
  it('keeps both certificates when two adds run at once', ...);
  // Promise.all([add(A), add(B)]). Expect the file to hold both.
  it('leaves no temp file behind', ...);
});
describe('preview', () => {
  it('reads the certificate of a self-signed server', ...);                 // node:https on 127.0.0.1 port 0 with A
  it('throws no-answer when nothing listens', ...);
  it('refuses an address with a scheme or a path', ...);
  // 'https://x' and 'x/y' throw Error('Type a host name, or a host name and a port.')
});
```

An address that is not `host` or `host:port` is a caller mistake, not a trust refusal. So it throws a plain `Error` with that line, not a `TrustRefused`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/network-trust.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the service and wire it into the context**

In `index.ts`, `loaded` is `() => tls.getCACertificates('extra')` when that function exists, and `() => []` when it does not. `readPeer` uses `tls.connect` with `rejectUnauthorized: false`, as plan 2's `readServerCertificate` does. `audit` writes through the same audit path the connector access service uses.

- [ ] **Step 4: Run them and see them pass**

Run the command from Step 2, then `pnpm --filter @openldr/bootstrap typecheck > /tmp/tc-bootstrap.txt 2>&1; echo "exit=$?"`.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/bootstrap/src
git commit -m "feat(bootstrap): a service that manages trusted certificates"
```

---

### Task 3: Workflow hosts

**Files:**
- Create: `packages/bootstrap/src/workflow-hosts.ts`
- Modify: `packages/workflows/src/engine/services.ts:145-260` (`parseAllowlist`, `validateHop`, `guardedFetch`)
- Modify: `packages/bootstrap/src/index.ts:1517` (the `httpFetch` line), and add the service to `AppContext` as `workflowHosts`
- Test: `packages/bootstrap/src/workflow-hosts.test.ts`, `packages/workflows/src/engine/services.test.ts`

**Interfaces:**
- Produces:

```ts
// packages/workflows/src/engine/services.ts
/** What an HTTP step may call. `hosts` match the host name on any port and scheme.
 *  `origins` match scheme, host and port exactly, such as 'http://127.0.0.1:3000'. */
export interface HttpAllowRule { hosts: string[]; origins: string[] }

export async function guardedFetch(req: HttpRequest, allow: string | HttpAllowRule, fetchImpl?: typeof fetch): Promise<HttpResponse>;
// A string is the old comma-separated list and means { hosts: parseAllowlist(s), origins: [] }.

// packages/bootstrap/src/workflow-hosts.ts
export const KEY_HOSTS = 'workflows.http_hosts';
export const KEY_SELF = 'workflows.http_self';

export interface WorkflowHostRow { host: string; source: 'setting' | 'server' }

export interface WorkflowHosts {
  list(): Promise<WorkflowHostRow[]>;                 // server hosts first, then the stored ones, each sorted. A host in both appears once, as 'server'.
  add(host: string, actor: TrustActor): Promise<void>;
  remove(host: string, actor: TrustActor): Promise<void>;
  self(): Promise<{ on: boolean; origin: string }>;
  setSelf(on: boolean, actor: TrustActor): Promise<void>;
  /** The rule in force right now. Read from the database on every call. */
  rule(): Promise<HttpAllowRule>;
}

export function createWorkflowHosts(deps: {
  appSettings: AppSettingStore;
  serverList: string;            // cfg.WORKFLOW_HTTP_ALLOWLIST
  port: number;                  // cfg.PORT
  audit(action: 'network.workflow_host.add' | 'network.workflow_host.remove' | 'network.workflow_self.set', actor: TrustActor, detail: string): Promise<void>;
}): WorkflowHosts;
```

Rules:
- A host is lower-cased and trimmed. It is a host name of up to 253 characters, or an IPv4 or IPv6 address. A scheme, a port, a path, a space or an empty value throws `Error('Type a host name or an IP address, with no port and no path.')`.
- Adding a host that is already there, from either source, does nothing and writes no audit row.
- Removing a host that comes from the server setting throws `Error('This host comes from the server setting WORKFLOW_HTTP_ALLOWLIST.')`.
- `self().origin` is `http://127.0.0.1:<port>`. `rule().origins` holds it only when the switch is on.
- In `guardedFetch`, a hop passes when its host is in `hosts` or its origin is in `origins`. Every redirect hop is checked the same way, as today.
- The header fix: today the sign-in headers are dropped only when the host name changes (`services.ts:250`). Drop them when the origin changes: scheme, host or port.
- `index.ts:1517` becomes `httpFetch: async (req) => guardedFetch(req, await workflowHosts.rule())`.

- [ ] **Step 1: Write the failing tests**

```ts
// services.test.ts
it('allows an exact origin and refuses the same host on another port', async () => {
  const allow = { hosts: [], origins: ['http://127.0.0.1:3000'] };
  await expect(guardedFetch({ url: 'http://127.0.0.1:3000/health' }, allow, okFetch)).resolves.toBeDefined();
  await expect(guardedFetch({ url: 'http://127.0.0.1:5432/' }, allow, okFetch)).rejects.toThrow('HTTP host not allowed: 127.0.0.1');
  await expect(guardedFetch({ url: 'https://127.0.0.1:3000/' }, allow, okFetch)).rejects.toThrow('HTTP host not allowed');
});
it('still takes the old comma-separated list', ...);                       // 'a.example, b.example'
it('drops the sign-in headers on a redirect to another port of the same host', ...);
// allow hosts ['a.example']. First answer 302 to http://a.example:8080/x. The second call must carry no Authorization and no Cookie.
it('drops them on a redirect from http to https on the same host', ...);
it('keeps them on a redirect within the same origin', ...);
it('refuses a redirect from an allowed origin to a host that is not allowed', ...);

// workflow-hosts.test.ts
it('starts empty with the switch off', ...);                               // rule() is { hosts: [], origins: [] }
it('merges the server list and the stored list, each host once', ...);
// serverList 'a.example', stored ['a.example','b.example'] -> list has a.example as 'server' and b.example as 'setting'.
it('adds a host in lower case and audits it', ...);                        // 'Hub.District ' -> 'hub.district'
it('adding a host twice writes one audit row', ...);
it.each(['http://x', 'x:8080', 'x/y', 'a b', ''])('refuses %j as a host', ...);
it('refuses to remove a host that comes from the server setting', ...);
it('a removed host is gone from the very next rule', ...);
it('the switch adds exactly this OpenLDR origin', ...);                    // port 3000, setSelf(true) -> origins ['http://127.0.0.1:3000']
it('reads the database on every rule call', ...);
// Change the stored value behind the service's back. Expect the next rule() to show it.
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/workflows exec vitest run src/engine/services.test.ts` and `pnpm --filter @openldr/bootstrap exec vitest run src/workflow-hosts.test.ts`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run them and see them pass**

Run the two commands from Step 2, then `pnpm --filter @openldr/workflows test`.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine packages/bootstrap/src
git commit -m "feat(workflows): an administrator names the hosts an HTTP step may call"
```

---

### Task 4: The routes

**Files:**
- Create: `apps/server/src/network-routes.ts`
- Modify: `apps/server/src/app.ts` (register it beside `registerConnectorsRoutes` at line 213)
- Test: `apps/server/src/network-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.trust` (Task 2), `ctx.workflowHosts` (Task 3).
- Produces: eight routes, all behind `requireCapability('network.manage')`.

| Method and path | Body | Answer |
|---|---|---|
| `GET /api/network/trust` | | `{ mode, certificates: TrustedCert[] }` |
| `POST /api/network/trust/preview` | `{ address }` or `{ text }` | `{ certificates: CertPreview[] }` |
| `POST /api/network/trust` | `{ pem }` | the new `TrustedCert`, status 201 |
| `DELETE /api/network/trust/:fingerprint` | | status 204 |
| `GET /api/network/workflow-hosts` | | `{ self: { on, origin }, hosts: WorkflowHostRow[] }` |
| `POST /api/network/workflow-hosts` | `{ host }` | status 204 |
| `DELETE /api/network/workflow-hosts/:host` | | status 204 |
| `PUT /api/network/workflow-hosts/self` | `{ on }` | `{ on, origin }` |

Refusals: `TrustRefused` codes map to status 400 with `{ error: <code> }`, except `not-found` which is 404 and `read-only` and `damaged` which are 409. A bad host or address is 400 with the service's message. A missing permission is 403, as every other route.

The actor is the signed-in user, as the connector routes take it.

- [ ] **Step 1: Write the failing route tests**

Use the app test setup that `apps/server/src/connectors-routes.test.ts` uses. These tests pin the wire shape.

```ts
it('refuses every route without network.manage', ...);               // one request per route, expect 403
it('lists certificates with the mode', ...);
it('previews pasted text and returns the same PEM back', ...);
it('previews an address', ...);                                       // against a local self-signed server
it('refuses a private key with code private-key and echoes nothing', ...);
// POST preview { text: A.key }. Expect 400 { error: 'private-key' }. The body holds no line of the key.
it('adds the previewed certificate and answers 201', ...);
it('answers 409 read-only when the file is not managed', ...);
it('answers 409 damaged when the file is damaged', ...);
it('removes a certificate and answers 204, and 404 for one that is not there', ...);
it('lists workflow hosts with the switch', ...);
it('adds and removes a host', ...);
it('answers 400 with the message for a bad host', ...);
it('turns the switch on and returns the origin', ...);
it('writes an audit row for each change', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/server exec vitest run src/network-routes.test.ts`

- [ ] **Step 3: Write the routes**

- [ ] **Step 4: Run the tests and the lint**

Run the command from Step 2, then `pnpm --filter @openldr/server lint`.
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/network-routes.ts apps/server/src/network-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): routes for trusted certificates and workflow hosts"
```

---

### Task 5: The CLI

**Files:**
- Create: `packages/cli/src/network.ts`
- Modify: `packages/cli/src/program.ts` (a new `trust` command, and `hosts` under `workflows` at line 107)
- Modify: `packages/cli/src/command-meta.ts` (beside the connector entries at line 202)
- Test: `packages/cli/src/network.test.ts`, and the command-meta test that checks every command has an entry

**Interfaces:**
- Consumes: `ctx.trust`, `ctx.workflowHosts`, `cliActor()` (`packages/cli/src/cli-actor.ts`).
- Produces:

```
openldr trust list [--json]
openldr trust add <file.pem> [--fingerprint <SHA-256>]
openldr trust add --from <host:port> --fingerprint <SHA-256>
openldr trust remove <fingerprint> --force
openldr workflows hosts list [--json]
openldr workflows hosts add <host>
openldr workflows hosts remove <host> --force
openldr workflows hosts self <on|off>
```

```ts
// command-meta.ts
'trust list': { kind: 'app', capability: 'network.manage' },
'trust add': { kind: 'app', capability: 'network.manage', paths: [inFile('file')] },
'trust remove': { kind: 'app', capability: 'network.manage', destructive: true },
'workflows hosts list': { kind: 'app', capability: 'network.manage' },
'workflows hosts add': { kind: 'app', capability: 'network.manage' },
'workflows hosts remove': { kind: 'app', capability: 'network.manage', destructive: true },
'workflows hosts self': { kind: 'app', capability: 'network.manage' },
```

Behaviour:
- `trust list` prints one line per certificate: the state, the fingerprint, the end date, the subject. The first line names the mode when it is not `editable`.
- `trust add <file>` prints the fingerprint and the subject, then asks `Trust this certificate? (y/N)`. With `--fingerprint`, it does not ask: it saves when the value matches and exits 1 with `The fingerprint does not match.` when it does not. When nothing can answer the question (no terminal) and no `--fingerprint` is given, it exits 1 with `Give --fingerprint to add a certificate without a prompt.`
- `trust add --from` needs `--fingerprint`. It saves only when the certificate at the address has that fingerprint.
- After a save it prints `Saved. Restart OpenLDR to use it.`
- `trust remove` and `workflows hosts remove` refuse without `--force`, as `connectors remove` does.
- Every refusal from the service prints its plain line and exits 1. No stack trace.

- [ ] **Step 1: Write the failing tests**

```ts
it('formats the list with state, fingerprint, end date and subject', ...);
it('names the mode on the first line when the file is not managed', ...);
it('adds a certificate when the fingerprint matches, without asking', ...);
it('refuses when the fingerprint does not match and saves nothing', ...);
it('refuses to add without a prompt when it cannot ask', ...);
it('adds from an address only with a matching fingerprint', ...);
it('refuses to remove without --force', ...);
it('prints the service's line for a private key and exits 1', ...);
it('turns the switch on and off', ...);
it('refuses to remove a host without --force', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/cli exec vitest run src/network.test.ts`

- [ ] **Step 3: Write the commands**

Follow `packages/cli/src/connector-access.ts` for the shape: a `run...` function per command that builds the context, calls the service and returns an exit code.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @openldr/cli test`
Expected: PASS, including the test that every command has a `command-meta` entry.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): trust and workflow host commands"
```

---

### Task 6: The launcher and the desktop app

**Files:**
- Modify: `apps/standalone/src/state.ts:117-130` (one new path)
- Modify: `apps/standalone/src/environment.ts:40-72`
- Create: `apps/standalone/src/trust-start.ts`
- Modify: `apps/standalone/src/index.ts:50` (call it first in `start`)
- Modify: `apps/desktop/src/launcher.ts:78` (`launcherEnv`) and its caller
- Test: `apps/standalone/src/trust-start.test.ts`, `apps/standalone/src/environment.test.ts`, `apps/desktop/src/launcher.test.ts`

**Interfaces:**
- Produces:

```ts
// state.ts: StandalonePaths gains
trustFile: string;   // join(root, 'trust', 'ca.pem')

// environment.ts: EnvironmentInput gains
trustFile?: string;
// When set, the environment also holds  TRUSTED_CA_FILE: <trustFile>.

// trust-start.ts
/** What `start` does about the trust file, decided before anything else is started.
 *   'go':      NODE_EXTRA_CA_CERTS already names the trust file. Start, with trustFile managed.
 *   'outside': NODE_EXTRA_CA_CERTS names another file. Start, with no managed file.
 *   'again':   NODE_EXTRA_CA_CERTS is not set. Start this program again with it set. */
export function trustStart(input: { trustFile: string; envValue: string | undefined; alreadyRestarted: boolean }): 'go' | 'outside' | 'again';

/** Makes the folder and an empty file when missing. Never changes an existing file. */
export function ensureTrustFile(trustFile: string): void;

/** Starts this program again with the same arguments, NODE_EXTRA_CA_CERTS set, and
 *  OPENLDR_TRUST_RESTARTED=1. Passes stdin, stdout, stderr and the events descriptor through.
 *  Forwards SIGINT and SIGTERM. Resolves with the child's exit code. */
export function startAgain(input: { trustFile: string; argv: readonly string[]; eventsFd: number | undefined }): Promise<number>;

// desktop launcher.ts
export function launcherEnv(base: NodeJS.ProcessEnv, trustFile?: string): NodeJS.ProcessEnv;
// With trustFile, and with no NODE_EXTRA_CA_CERTS in base, adds NODE_EXTRA_CA_CERTS: trustFile.
```

Rules:
- `trustStart` with `alreadyRestarted` true never returns `'again'`. It returns `'go'` or `'outside'`. This stops a loop.
- In `index.ts`, the decision runs first in `start`: before the control socket (`commands.ts:514`), the lock (`:520`) and Postgres. Only `start` does this. No other command.
- `'again'` runs `startAgain` and exits with its code. Nothing else has been started.
- `'go'` passes `trustFile` to `runStart`, which passes it to `buildEnvironment`.
- `'outside'` passes no `trustFile`. The Network page then shows the outside certificates as read-only.
- The desktop app knows the data folder from the launcher's status before it starts the launcher. It passes `<data folder>/trust/ca.pem` to `launcherEnv`, makes the file when missing, and so the launcher never needs to start itself again there.
- Paths are compared after `path.resolve`.

- [ ] **Step 1: Write the failing tests**

```ts
// trust-start.test.ts
it('goes ahead when the variable already names the trust file', ...);        // also with a relative spelling of the same path
it('treats another file as outside', ...);
it('asks to start again when the variable is not set', ...);
it('never asks twice', ...);                                                  // alreadyRestarted true, envValue undefined -> 'outside'
it('makes an empty file and its folder when missing', ...);
it('leaves an existing file as it is', ...);
it('starts again with the same arguments and the variable set, and returns the exit code', ...);
// Run a tiny script through startAgain that prints its NODE_EXTRA_CA_CERTS and OPENLDR_TRUST_RESTARTED and exits 7.
// Expect both values and the code 7.
it('passes the events descriptor through', ...);
// The child writes one line to descriptor 3. Expect the parent's reader to get it.

// environment.test.ts
it('sets TRUSTED_CA_FILE only when a trust file is given', ...);

// desktop launcher.test.ts
it('adds NODE_EXTRA_CA_CERTS for the trust file', ...);
it('keeps a NODE_EXTRA_CA_CERTS the person set', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/standalone exec vitest run src/trust-start.test.ts src/environment.test.ts` and `pnpm --filter @openldr/desktop exec vitest run src/launcher.test.ts`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run the tests and both typechecks**

Run `pnpm --filter @openldr/standalone test`, `pnpm --filter @openldr/desktop test`, and a typecheck of each with the exit code read after a redirect.

- [ ] **Step 5: Commit**

```bash
git add apps/standalone/src apps/desktop/src
git commit -m "feat(standalone): the launcher starts Node with a managed trust file"
```

---

### Task 7: The server edition's installer

**Files:**
- Modify: `deploy/install/docker-compose.yml:13-18`
- Modify: `install/install.sh:846-856` (the scaffold) and `:1023` (the variable)
- Modify: `install/install.ps1`, the matching lines
- Test: the installer's existing tests, if `install/lib` has any. Otherwise the live check in Task 10.

What changes:
- The API container mounts a folder, `./config/trust`, at `/etc/openldr/trust`, read and write. Not a single file. A single-file mount breaks when a new file is renamed over it.
- The environment gets `TRUSTED_CA_FILE=/etc/openldr/trust/ca.pem` and `NODE_EXTRA_CA_CERTS=/etc/openldr/trust/ca.pem`.
- The installer makes `./config/trust/ca.pem` when missing. The folder must be writable by the container's user, uid `10001` (`apps/server/Dockerfile:50`).
- **Upgrade.** When `./config/nginx/certs/central/fullchain.pem` exists and is not empty, and `./config/trust/ca.pem` is missing or empty, the installer copies the first into the second. A lab that already trusts a central keeps trusting it. The old file is left where it is.
- An install that is not upgraded keeps working as before. Its Network page says "not configured".

- [ ] **Step 1: Read how the installer is tested**

Look in `install/lib` and for any `*.test.*` or `bats` file that covers `install.sh`. If there are tests, write the failing ones first: the folder is made, the variables are set, and an existing central certificate is copied. If there are none, say so in the hand-over and rely on Task 10.

- [ ] **Step 2: Make the changes in `install.sh`, `install.ps1` and the compose file**

- [ ] **Step 3: Run the installer's tests, if any**

- [ ] **Step 4: Commit**

```bash
git add deploy/install/docker-compose.yml install
git commit -m "feat(install): the server edition gets a managed trust folder"
```

---

### Task 8: The Network page

**Files:**
- Create: `apps/studio/src/pages/settings/Network.tsx`
- Create: `apps/studio/src/pages/settings/TrustCertificateSheet.tsx`, `apps/studio/src/pages/settings/WorkflowHostSheet.tsx`
- Modify: `apps/studio/src/pages/settings/settingsNav.ts:9-21` (one entry, after Connectors)
- Modify: `apps/studio/src/App.tsx:84` (one nested route, beside Connectors)
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/pages/settings/Network.test.tsx`

**Interfaces:**
- Consumes: the eight routes of Task 4.
- Produces: the route `/settings/network`, gated by `network.manage`, with the nav entry `{ labelKey: 'settings.subNav.network', to: '/settings/network', caps: ['network.manage'] }`.

Open `Connectors.tsx` and `forms-builder/FieldEditorSheet.tsx` first and copy them. The rules that bind this page:
- Actions go in a `MoreHorizontal` dropdown: the page header (Add certificate, or Add host on the second tab), each sheet (Save), each row (Remove). No standalone buttons, no sheet footer.
- Adding is a `Sheet`. Removing asks in a confirm `Dialog`, which is one of the cases a dialog is for.
- Form fields put the label left and the input right. The paste box is a textarea with `items-start`.
- Both tables get `TablePagination`.
- Empty uses `StripedEmpty`. Loading uses `LoadingState`. Never stripes while loading.
- The result of a save or a remove goes in a sonner toast. No banner in the form.
- shadcn components only.

The first tab, Trusted certificates:
- Columns: Name, Fingerprint with a copy control, Valid until, State.
- State words: "In use", "After restart" (added), "Removed after restart", "Set outside OpenLDR". An expired certificate shows "Expired" beside its date.
- When the mode is not `editable`, one line above the table says why, and the Add and Remove actions are off:
  - `not-configured`: "This install was set up before trusted certificates could be managed here. See the guide to turn it on."
  - `set-outside`: "Trusted certificates are set outside OpenLDR, in NODE_EXTRA_CA_CERTS. They are shown here and cannot be changed here."
  - `damaged`: "The trust file holds text that is not a certificate. Fix the file, then manage it here."
- The sheet: an Address field with a "Read certificate" control, or a paste box. Either fills a read-only block: Fingerprint, Issued to, Valid until. Save is off until a certificate is shown. Save sends that exact PEM.
- After a save, the toast says: "Saved. Restart OpenLDR to use it."
- Refusals show the service's code as a plain line: `private-key` "That text holds a private key. Never paste a key. Nothing was saved." `not-a-certificate` "That is not a certificate." `duplicate` "That certificate is already trusted." `no-answer` "Nothing answered at that address."

The second tab, Workflow hosts:
- A switch on top: "Let workflows call this OpenLDR", with the origin beside it, such as `http://127.0.0.1:3000 only`.
- Columns: Host, Source. Source words: "Set here" and "Server setting". A server row has no Remove.
- One line under the table: "A host here covers every web service on that host."
- The sheet has one field, Host.

- [ ] **Step 1: Write the failing tests**

```tsx
it('lists certificates with their state words', ...);
it('shows the reason and turns the actions off when the file is not managed', ...);   // one case per mode
it('shows the striped empty state with no certificates, and the spinner while loading', ...);
it('keeps Save off until a certificate is shown', ...);
it('reads a certificate from an address, shows its fingerprint, and saves that PEM', ...);
// Mock preview to return PEM X. Press Save. Expect the POST body to hold exactly X.
it('shows the private key line and saves nothing', ...);
it('says to restart after a save', ...);
it('removes a certificate after the confirm', ...);
it('turns the switch on and shows the origin', ...);
it('adds a host and shows it as Set here', ...);
it('gives a server host no Remove action', ...);
it('paginates both tables', ...);
```

`apps/studio/src/i18n/parity.test.ts` already fails when a key is missing in fr or pt. Run it.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/pages/settings/Network.test.tsx src/i18n`

- [ ] **Step 3: Write the page, the two sheets, the API calls and the strings**

- [ ] **Step 4: Run the tests and the typecheck**

Run the command from Step 2, then `pnpm --filter @openldr/studio typecheck > /tmp/tc-studio.txt 2>&1; echo "exit=$?"`.

- [ ] **Step 5: Look at the page**

Start the preview for the worktree's Studio. Open `/settings/network` at desktop width and at 375 by 812. Check both tabs, both sheets, the empty state and a long fingerprint. Take a screenshot of each and publish them on the screenshot Artifact page for the operator. The page has nothing pinned to the bottom edge, so a headless browser is a fair check of this layout.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): a Network settings page for trusted certificates and workflow hosts"
```

---

### Task 9: Docs

**Files:**
- Create: `apps/studio/src/docs/0.1.8/en/network.md`, and the same page in `fr` and `pt`
- Modify: `apps/studio/src/docs/registry.ts` (one entry, slug `network`, related to `connectors`, `sync` and `workflows`)
- Modify: `apps/web/src/docs/0.1.8/en/environment.md`, `standalone.md`, and the same pages in `fr` and `pt`
- Modify: `apps/studio/src/docs/0.1.8/en/sync.md:185-191` ("Trust central TLS on the lab server"), and the same section in `fr` and `pt`

- [ ] **Step 1: Write the in-app guide**

Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md`. Title: "Network". Tasks: "Trust another OpenLDR's certificate", "Remove a trusted certificate", "Let a workflow call this OpenLDR", "Let a workflow call another host". Say plainly that a new certificate needs a restart, and how to restart on each edition. Give the CLI command under each task.

- [ ] **Step 2: Update the web docs**

`environment.md`: add `TRUSTED_CA_FILE`, and say that `WORKFLOW_HTTP_ALLOWLIST` is now joined by the Network page's list. `standalone.md`: the new file under the data folder, and that the launcher starts itself once more to load it.

- [ ] **Step 3: Shorten the sync guide's trust section**

It now says: open Settings, Network, add central's certificate, restart. Keep one line for installs made before this change.

- [ ] **Step 4: Translate to fr and pt, and run `unslop` over every file touched**

- [ ] **Step 5: Run the docs tests**

Run: `pnpm --filter @openldr/studio exec vitest run src/docs` and `pnpm --filter @openldr/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs: trusted certificates and workflow hosts"
```

---

### Task 10: The gate and a live check

A CE branch needs its own install for a live check. The dev stack runs the main checkout and must not be touched. Tell the operator before starting this install.

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0` twice. On a failure, grep for `Test timed out`, `out of memory` and `VirtualAlloc` before reading it as a regression.

- [ ] **Step 2: Start a standalone install from the worktree, and a self-signed test server**

```bash
pnpm --filter @openldr/studio build && pnpm --filter @openldr/standalone build
OPENLDR_SKIP_ENV_FILE=true node apps/standalone/dist/index.js start --data-dir /tmp/openldr-trust-check --port 3232
```

Run it in the background. In the scratchpad, write a small script that serves `ok` over HTTPS on `127.0.0.1:9443` with a self-signed certificate for `127.0.0.1`. Run it in the background too.

Expected: the launcher's process list shows it started once more with `NODE_EXTRA_CA_CERTS` set to `/tmp/openldr-trust-check/trust/ca.pem`. `openldr-standalone status` still works, and `stop` still reaches it.

- [ ] **Step 3: Trusted certificates, end to end**

1. Make a workflow with an HTTP step to `https://127.0.0.1:9443/`. Add `127.0.0.1` as a workflow host. Run it. Expected: refused with a certificate error.
2. `openldr trust add --from 127.0.0.1:9443 --fingerprint <the test server's>`. Expected: `Saved. Restart OpenLDR to use it.` `trust list` shows it as waiting.
3. Run the workflow again without a restart. Expected: still refused.
4. Stop and start the install. `trust list` shows it as in use. Run the workflow. Expected: `ok`.
5. `openldr trust remove <fingerprint> --force`. `trust list` shows it as removed after a restart. Restart. Run the workflow. Expected: refused again.

- [ ] **Step 4: The switch, end to end**

1. Remove `127.0.0.1` from the workflow hosts. Make a workflow with an HTTP step to `http://127.0.0.1:3232/health`. Run it. Expected: refused, host not allowed.
2. `openldr workflows hosts self on`. Run it at once, with no restart. Expected: it answers.
3. Point the step at `http://127.0.0.1:9443/` or another port. Expected: refused. The switch covers this OpenLDR only.
4. `openldr workflows hosts self off`. Run the first workflow. Expected: refused at once.

- [ ] **Step 5: The refusals**

Paste a private key into the Add certificate sheet. Expected: the private key line, nothing saved. Then grep the server log at `/tmp/openldr-trust-check/logs/server.log` for a line of the key. Expected: none.

Start the launcher with `NODE_EXTRA_CA_CERTS` set to another file. Expected: the Network page says the certificates are set outside OpenLDR, and Add is off.

- [ ] **Step 6: A plugin's network call**

Install any plugin that has a connector, point the connector at `https://127.0.0.1:9443`, and run it with the test certificate trusted and the install restarted. Expected: the call succeeds. Codex showed this on 2026-11-27 with the plugin runner alone. This step shows it through an installed plugin.

- [ ] **Step 7: Stop everything and write down what was not shown**

In the hand-over, write **HONEST NON-PROOF** for each of these:
- The server edition. The installer change was not run on a Docker host here. A native Linux host and Docker Desktop own files differently.
- An upgrade of a server install that already trusts a central.
- The packaged desktop app, and Windows and macOS. Only a development build on Linux was run.
- Two sites end to end: a spoke's scheduled workflow, its own OpenLDR, and a hub with a self-signed certificate.

- [ ] **Step 8: After the merge to `main`, update the changelog**

Merging is the operator's call. Once merged, run `pnpm make:changelog` on `main` and commit `apps/web/src/landing/changelog.json`.
