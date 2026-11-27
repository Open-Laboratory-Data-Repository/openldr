# Share on the lab network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One desktop app or standalone install can be opened from other PCs on the lab network over HTTPS.

**Architecture:** The server does not change. It keeps listening on `127.0.0.1` over plain HTTP. The launcher makes a self-signed certificate and runs a small HTTPS front in its own process. The front listens on every network address and passes each request to the server on `127.0.0.1`. The desktop app gets a tray switch that starts its launcher with the new flag.

**Tech Stack:** Node 24 (`node:https`, `node:http`, `node:crypto`), TypeScript, vitest, Electron (tray and dialogs), one new npm package for making the certificate.

**Spec:** `docs/superpowers/specs/2026-11-27-lab-deployment-setups-design.md`, section "Share on the lab network". This plan closes gaps G1, G2, G4 and G14, and settles G3.

**This is plan 1 of 4.** The spec covers four separate pieces of work. The others get their own plans:

| Plan | Covers | Repo |
|---|---|---|
| 1 (this one) | Sharing switch with HTTPS | CE |
| 2 | Connect mode and the lock setting, and the "which setup" guide | CE |
| 3 | Direct referral between spoke and hub | lab-bench |
| 4 | Serial ports for plugin pages. Needs its own design first. | CE |

## Global Constraints

- Default share port: `3443`.
- The front listens on `0.0.0.0`. The server keeps listening on `127.0.0.1`.
- Certificate: RSA 2048, SHA-256, valid `825` days. The same values as `install/install.sh:1074`.
- A new certificate is made when none exists, when it expires within `30` days, or when the PC's name or one of its addresses is not in it.
- Certificate folder: `<data folder>/share/`. Files `cert.pem` and `key.pem`. The key file is mode `0600`.
- Sharing is off by default. Nothing listens on the network until someone turns it on.
- With `--share`, `--host` is left out or is exactly `127.0.0.1`. The front reaches the server on `127.0.0.1` only.
- No product code in core (AGENTS.md §8).
- Short plain sentences in every doc, string and commit message. No em dashes. Run the `unslop` skill over them.
- No `Co-Authored-By` trailer on any commit (AGENTS.md §9).
- Docs land in en, fr and pt.
- From a worktree, set `OPENLDR_SKIP_ENV_FILE=true` for every command that starts a server or CLI.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

## Review Focus

1. **The PC's address changes** (DHCP gives a new one). Expected: the next start makes a new certificate and prints the new fingerprint. Test in Task 2.
2. **A client sends its own `X-Forwarded-For` or `X-Forwarded-Proto`.** Expected: the front drops them and writes its own. Test in Task 3.
3. **A long event stream is open when OpenLDR stops.** Expected: stop does not hang. Test in Task 3.
4. **The share port is taken.** Expected: one clear line naming `--share-port`, before Postgres starts. Test in Task 4.
5. **The PC's name cannot go in a certificate or an address** (spaces, underscores, accents). Expected: the name is left out and the addresses are listed by number only. Test in Task 2.

---

### Task 1: Settle G3 before building anything

The spec says plugin pages may fail from another PC over plain HTTP. Nobody has reproduced it. The operator already uses a built Studio over plain HTTP at `http://100.107.125.94:4173/studio/`, so it may be out of date.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-27-lab-deployment-setups-design.md` (the HONEST NON-PROOF part and row G3)

- [ ] **Step 1: Open three screens at the plain HTTP address**

Use the browser pane at `http://100.107.125.94:4173/studio/`. Do not start, stop or restart the dev stack. Opening a screen is not enough. Do one real action on each, with test data, and read the console with `read_console_messages` after it:
- On a lab-bench page, save one change to a test record.
- In the dashboard editor, add a widget to a test dashboard, save, then remove it.
- In the access keys sheet, make a key, press its copy button, then delete the key.

Put back anything the check changes. Report only the actions you did.

- [ ] **Step 2: Write the result into the spec**

Replace the G3 paragraph with what happened: each screen, the action, and the error text or "works". If all three actions work, mark G3 "REFUTED on 2026-11-27 for these three actions" in the gaps table.

- [ ] **Step 3: Note the docs lines for Task 6**

If all three screens work, the lines about failing screens in `apps/web/src/docs/0.1.8/{en,fr,pt}/standalone.md` (en lines 282 and 309) must go. Change no docs in this task. Task 6 does it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-27-lab-deployment-setups-design.md
git commit -m "docs: record the plain HTTP check for plugin pages"
```

G2 is built whatever the result. The analyser companion refuses plain HTTP, and passwords must not cross the network in the clear.

---

### Task 2: The certificate

**Files:**
- Create: `apps/standalone/src/share-cert.ts`
- Test: `apps/standalone/src/share-cert.test.ts`
- Modify: `apps/standalone/package.json` (one new dependency)

**Interfaces:**
- Produces:

```ts
export const SHARE_CERT_DAYS = 825;
export const SHARE_RENEW_DAYS = 30;

/** Names a certificate must carry. Both lists are sorted and hold no duplicates. */
export interface ShareNames { dns: string[]; ips: string[] }

/** dns: the PC's name in lower case when it is a valid host name, then 'localhost'.
 *  ips: every IPv4 address that is not internal, then '127.0.0.1'. No IPv6. */
export function shareNames(hostname: string, interfaces: NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>): ShareNames;

export type MakeCert = (names: ShareNames, notBefore: Date, days: number) => Promise<{ certPem: string; keyPem: string }>;

/** The default MakeCert. RSA 2048, SHA-256, subject CN 'OpenLDR', the names as subjectAltName. */
export const makeCert: MakeCert;

/** False when the certificate expires within SHARE_RENEW_DAYS of `now`, or lacks one of the names. */
export function certCovers(certPem: string, names: ShareNames, now: Date): boolean;

export interface ShareCert {
  certPem: string;
  keyPem: string;
  /** SHA-256, upper case hex pairs joined by colons, as `X509Certificate.fingerprint256` gives it. */
  fingerprint: string;
  certFile: string;
  created: boolean;
}

/** Reads `<dir>/cert.pem` and `<dir>/key.pem`. Makes and writes new ones when certCovers is false,
 *  when either file is missing or unreadable, or when the key does not fit the certificate
 *  (`X509Certificate.checkPrivateKey`). Writes the key with mode 0600. */
export function loadOrCreateShareCert(dir: string, names: ShareNames, now: Date, make?: MakeCert): Promise<ShareCert>;
```

A valid host name here: 1 to 63 characters, letters, digits and hyphens, not starting or ending with a hyphen. Anything else is left out of `dns`.

- [ ] **Step 1: Add the dependency**

Run `pnpm --filter @openldr/standalone add selfsigned`. Read the installed version's README for its `generate` call. Version 2 is synchronous and version 3 returns a promise. `makeCert` hides the difference. The launcher is bundled by tsup, so check `apps/standalone/tsup.config.ts`: if other dependencies are listed as external, treat this one the same way.

- [ ] **Step 2: Write the failing tests**

```ts
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { certCovers, loadOrCreateShareCert, makeCert, shareNames, SHARE_CERT_DAYS } from './share-cert';

const NOW = new Date('2026-12-01T00:00:00Z');
const iface = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') =>
  ({ address, internal, family, netmask: '', mac: '', cidr: null }) as never;

describe('shareNames', () => {
  it('lists the name and every outside IPv4 address', () => {
    const n = shareNames('LabPC', { lo: [iface('127.0.0.1', true)], eth0: [iface('192.168.1.20'), iface('fe80::1', false, 'IPv6')], wlan0: [iface('10.0.0.7')] });
    expect(n).toEqual({ dns: ['labpc', 'localhost'], ips: ['10.0.0.7', '127.0.0.1', '192.168.1.20'] });
  });
  it.each(['lab pc', 'lab_pc', 'laboratório', '-lab', ''])('leaves out a name that is not a host name: %j', (name) => {
    expect(shareNames(name, {}).dns).toEqual(['localhost']);
  });
});

describe('loadOrCreateShareCert', () => {
  const names = { dns: ['labpc', 'localhost'], ips: ['127.0.0.1', '192.168.1.20'] };
  it('makes a certificate with the names, valid for 825 days, and a 0600 key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    const c = await loadOrCreateShareCert(dir, names, NOW);
    const x = new X509Certificate(c.certPem);
    expect(c.created).toBe(true);
    expect(x.subjectAltName).toContain('DNS:labpc');
    expect(x.subjectAltName).toContain('IP Address:192.168.1.20');
    expect(Math.round((Date.parse(x.validTo) - Date.parse(x.validFrom)) / 86_400_000)).toBe(SHARE_CERT_DAYS);
    expect(c.fingerprint).toBe(x.fingerprint256);
    expect(c.certFile).toBe(join(dir, 'cert.pem'));
    if (process.platform !== 'win32') expect(statSync(join(dir, 'key.pem')).mode & 0o777).toBe(0o600);
  });
  it('reuses the certificate on the next start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    const first = await loadOrCreateShareCert(dir, names, NOW);
    const second = await loadOrCreateShareCert(dir, names, NOW);
    expect(second.created).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
  });
  it('makes a new one when the PC has a new address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    const first = await loadOrCreateShareCert(dir, names, NOW);
    const moved = await loadOrCreateShareCert(dir, { ...names, ips: ['127.0.0.1', '192.168.1.99'] }, NOW);
    expect(moved.created).toBe(true);
    expect(moved.fingerprint).not.toBe(first.fingerprint);
  });
  it('makes a new one within 30 days of the end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    await loadOrCreateShareCert(dir, names, NOW);
    const late = new Date(NOW.getTime() + (SHARE_CERT_DAYS - 29) * 86_400_000);
    expect((await loadOrCreateShareCert(dir, names, late)).created).toBe(true);
  });
  it('makes a new one when a file is damaged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    await loadOrCreateShareCert(dir, names, NOW);
    writeFileSync(join(dir, 'cert.pem'), 'not a certificate');
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
    expect(() => new X509Certificate(readFileSync(join(dir, 'cert.pem')))).not.toThrow();
  });
  it('makes a new one when the key is damaged', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    await loadOrCreateShareCert(dir, names, NOW);
    writeFileSync(join(dir, 'key.pem'), 'not a key');
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
  });
  it('makes a new one when the key belongs to another certificate', async () => {
    // A stop between the two file writes can leave this pair behind.
    const dir = mkdtempSync(join(tmpdir(), 'share-'));
    await loadOrCreateShareCert(dir, names, NOW);
    const other = await makeCert(names, NOW, SHARE_CERT_DAYS);
    writeFileSync(join(dir, 'key.pem'), other.keyPem);
    expect((await loadOrCreateShareCert(dir, names, NOW)).created).toBe(true);
  });
});

describe('certCovers', () => {
  it('is false for text that is not a certificate', () => {
    expect(certCovers('nope', { dns: [], ips: [] }, NOW)).toBe(false);
  });
  it('is true for a fresh certificate and its own names', async () => {
    const n = { dns: ['localhost'], ips: ['127.0.0.1'] };
    const { certPem } = await makeCert(n, NOW, SHARE_CERT_DAYS);
    expect(certCovers(certPem, n, NOW)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `pnpm --filter @openldr/standalone exec vitest run src/share-cert.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 4: Write `share-cert.ts` to the interface above**

Write the new files to temp names in the same folder and rename them into place, as `apps/desktop/src/settings.ts:49` does. Check names against the certificate with `X509Certificate.checkHost` and `checkIP`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `pnpm --filter @openldr/standalone exec vitest run src/share-cert.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/standalone/src/share-cert.ts apps/standalone/src/share-cert.test.ts apps/standalone/package.json pnpm-lock.yaml
git commit -m "feat(standalone): make and keep a certificate for sharing on the lab network"
```

---

### Task 3: The HTTPS front

**Files:**
- Create: `apps/standalone/src/share-proxy.ts`
- Test: `apps/standalone/src/share-proxy.test.ts`

**Interfaces:**
- Consumes: `certPem` and `keyPem` from Task 2.
- Produces:

```ts
export interface ShareProxy { port: number; close(): Promise<void> }

/** An HTTPS server on host:port that passes every request to http://127.0.0.1:upstreamPort.
 *  Resolves once it is listening. Rejects with the listen error (EADDRINUSE and others). */
export function startShareProxy(opts: {
  host: string; port: number; certPem: string; keyPem: string; upstreamPort: number;
}): Promise<ShareProxy>;
```

Rules the front follows:
- It removes these request headers from the client: `x-forwarded-for`, `x-forwarded-proto`, `x-forwarded-host`, `x-forwarded-port`, `forwarded`.
- It then sets `x-forwarded-proto: https`, `x-forwarded-for: <the client's socket address>` and `x-forwarded-host: <the client's Host header>`.
- It passes the `Host` header, the method, the path and the status unchanged.
- It drops the headers that belong to one connection, in both directions: `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`, and any header that `Connection` names. Node frames each message itself. The server sends `connection: keep-alive` on its event streams (`apps/server/src/workflows-routes.ts:454`).
- Every other header passes unchanged. Several `Set-Cookie` headers stay separate.
- It pipes bodies both ways and never buffers a whole body. An event stream must arrive piece by piece.
- If the server does not answer, it replies `502` with the text `OpenLDR is not answering.`
- If the client goes away, it destroys the request to the server. The server stops unfinished work when it sees that (`apps/server/src/cli-routes.ts:512`).
- If the server breaks off after the headers were sent, the front ends the client's connection.
- An `upgrade` request has its socket destroyed. The server has no websockets.
- `close()` stops listening and closes every open connection at once (`closeAllConnections`).

- [ ] **Step 1: Write the failing tests**

Each test starts a small `node:http` server on port 0 as the stand-in for OpenLDR, makes a certificate with `makeCert({ dns: ['localhost'], ips: ['127.0.0.1'] }, new Date(), 2)`, starts the front on `127.0.0.1` port 0, and calls it with `node:https` and `{ ca: certPem }`.

```ts
it('passes a GET through with its status, headers and body', ...);
// upstream answers 201 with header x-test: 1 and body 'hello'. Expect all three at the client.

it('passes a POST body through', ...);
// client posts 'a=1'. Upstream echoes the body. Expect 'a=1'.

it('writes its own forwarded headers and drops the ones the client sent', ...);
// client sends x-forwarded-for: 6.6.6.6, x-forwarded-proto: http, forwarded: for=6.6.6.6, host: lab:9.
// Upstream records req.headers. Expect x-forwarded-proto 'https', x-forwarded-for '127.0.0.1'
// (or '::ffff:127.0.0.1'), x-forwarded-host 'lab:9', host 'lab:9', and forwarded undefined.

it('delivers an event stream piece by piece', ...);
// upstream writes 'one\n', waits for the test to release it, then writes 'two\n' and ends.
// Expect the client to have received 'one\n' before the release.

it('answers 502 when OpenLDR is not answering', ...);
// upstreamPort is a closed port. Expect status 502 and body 'OpenLDR is not answering.'

it('closes at once while an event stream is open, and the server side sees the close', ...);
// open the stream as above, then await proxy.close() inside a 2 s limit. Expect it to resolve,
// and the upstream request's 'close' event to have fired.

it('closes the request to the server when the client goes away', ...);
// open the stream, destroy the client request. Expect the upstream request's 'close' event.

it('ends the client connection when the server breaks off mid-stream', ...);
// upstream writes 'one\n' then destroys its socket. Expect the client response to end or error, not hang.

it('drops per-connection headers in both directions and keeps two cookies apart', ...);
// client sends connection: keep-alive, x-drop-me and keep-alive: timeout=5, with Connection naming x-drop-me.
// Upstream must see none of the three. Upstream answers connection: keep-alive and two set-cookie headers.
// Expect the client to get an array of two set-cookie values.

it('rejects when the port is taken', ...);
// start two fronts on the same port. Expect the second to reject with code 'EADDRINUSE'.

it('refuses a client that does not trust the certificate', ...);
// call without `ca`. Expect the request to fail with a certificate error.
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm --filter @openldr/standalone exec vitest run src/share-proxy.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `share-proxy.ts` to the interface and rules above**

Use `https.createServer({ cert, key }, handler)` and `http.request` to `127.0.0.1`. No new dependency.

- [ ] **Step 4: Run the tests and see them pass**

Run: `pnpm --filter @openldr/standalone exec vitest run src/share-proxy.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/standalone/src/share-proxy.ts apps/standalone/src/share-proxy.test.ts
git commit -m "feat(standalone): an HTTPS front that passes requests to the local server"
```

---

### Task 4: The `--share` flag on the launcher

**Files:**
- Modify: `apps/standalone/src/commands.ts` (usage text near line 1042, argument parsing near 1060 to 1130, `runStart` at 350, `runStatus` at 728, `LauncherDeps` near 50)
- Modify: `apps/standalone/src/environment.ts:40-72`
- Modify: `apps/standalone/src/state.ts`: `:117-130` (one new path), `:40` (`LockInfo`), `:336-348` (the reader, which keeps only the fields it names), and one new function
- Modify: `apps/standalone/src/events.ts:9` (the `ready` event)
- Modify: `apps/standalone/src/index.ts:50`
- Test: `apps/standalone/src/commands.test.ts`, `apps/standalone/src/environment.test.ts`
- Test: `apps/server/src/local-auth-routes.test.ts`

**Interfaces:**
- Consumes: `shareNames`, `loadOrCreateShareCert` (Task 2), `startShareProxy` (Task 3).
- Produces:

```ts
// state.ts: StandalonePaths gains
shareDir: string; // join(root, 'share')

// What a running share looks like. Used by the lock, `status --json`, and the ready event.
export interface ShareInfo {
  /** https addresses ending in /studio/. The PC's name first when it has a valid one, then one per address. */
  addresses: string[];
  fingerprint: string;
  certFile: string;
}

// commands.ts
export const DEFAULT_SHARE_PORT = 3443;
// runStart's options gain:  share?: { port: number }
// The parsed start command gains the same field.
// LauncherDeps gains three optional seams, each defaulting to the real thing:
network?: () => { hostname: string; interfaces: NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]> };
startShareProxy?: typeof import('./share-proxy').startShareProxy;
makeCert?: import('./share-cert').MakeCert;
// Launcher gains:  share?: ShareInfo

// events.ts
| { event: 'ready'; address: string; share?: ShareInfo }

// environment.ts: EnvironmentInput gains
share?: { certFile: string };
// When set, the environment also holds  TRUST_PROXY: '127.0.0.1'  and  TLS_CERT_PATH: <certFile>.
```

`LockInfo` and `status --json` both gain `share?: ShareInfo`. The lock reader at `state.ts:336` must keep `share` when it is well formed.

```ts
// state.ts
/** Writes `share` into the lock this process holds. Every other field stays as it is: the pid,
 *  the token, the control port and the start time. Temp file, then rename. */
export function writeLockShare(paths: StandalonePaths, share: ShareInfo): Promise<void>;
```

New flags and their refusals, checked before anything starts:

| Input | Result |
|---|---|
| `--share` | Sharing on, port `3443` |
| `--share --share-port 8443` | Sharing on, port `8443` |
| `--share-port 8443` without `--share` | UsageError: `--share-port needs --share.` |
| `--share --host 192.168.1.20` | UsageError: `--share already opens OpenLDR to the network over HTTPS. Leave --host out.` |
| `--share --host 127.0.0.1` | Allowed. The desktop app sends this. |
| `--share --host localhost` or `--host ::1` | The same UsageError. Either can bind `::1`, where the front does not look. |
| `--share-port` equal to `--port` | UsageError: `--share-port must differ from --port.` |
| `--share-port` not a whole number from 1 to 65535 | UsageError: `--share-port must be a whole number from 1 to 65535.` |

Usage line to add under `start`: `           --share (open to the lab network over HTTPS)  --share-port <port> (default 3443)`

Order inside `runStart` when sharing is on:
1. With the HTTP port check (step 5 in the code), also check the share port on `0.0.0.0`. A taken port throws `Port <n> is already in use. Choose another with --share-port.`
2. Before `buildEnvironment`, call `loadOrCreateShareCert(paths.shareDir, shareNames(...), deps.now(), deps.makeCert)` and pass `share: { certFile }` to `buildEnvironment`.
3. After the server is up, start the front on `0.0.0.0` with `upstreamPort: opts.port`. If it fails, tear down exactly as a failed server start does. `EADDRINUSE` gives the share port message.
4. `stop` closes the front before it closes the server.
5. The lock is taken at `commands.ts:520`, before the certificate and the front exist. So it is written without `share` first. Once the front is listening, call `writeLockShare`. The token and the control port must not change, or `stop` can no longer reach this launcher.
6. The `ready` event and the returned `Launcher` carry the `ShareInfo`.
7. If closing the front fails during a stop, the stop still closes the server and Postgres.

The addresses in `ShareInfo` leave out `localhost` and `127.0.0.1`. They are in the certificate only so a check on the PC itself works.

Lines printed after `OpenLDR is running at ...` when sharing is on, in this order:

```
Shared on the lab network at https://labpc:3443/studio/
Also at https://192.168.1.20:3443/studio/
Certificate fingerprint (SHA-256): AB:CD:...
Certificate file: /home/you/.local/share/openldr/share/cert.pem
Another PC warns about the certificate the first time. Compare the fingerprint before you accept it.
```

`Also at` repeats once for each further address. When the PC has no outside address, print this in place of the two address lines: `No network address was found. Join a network, then start OpenLDR again.`
The plain HTTP warning at `commands.ts:681` is not printed when sharing is on.
`status` without `--json` prints a second line when shared: `Shared at <first address>`.

- [ ] **Step 1: Write the failing launcher tests**

Add to `apps/standalone/src/commands.test.ts`, next to the `runStart` tests at line 314. Use the file's existing fake deps. Give the fakes a `network` that returns the name `labpc` and one outside address `192.168.1.20`, a `startShareProxy` that records its options and returns `{ port, close }`, and a `makeCert` that returns fixed PEM text made once with the real `makeCert`.

```ts
it('with --share, starts the front after the server and prints the addresses and the fingerprint', ...);
// Expect startShareProxy called once with host '0.0.0.0', port 3443, upstreamPort = the start port.
// Expect printed lines to include 'Shared on the lab network at https://labpc:3443/studio/',
// 'Also at https://192.168.1.20:3443/studio/', a line starting 'Certificate fingerprint (SHA-256): ',
// and a line starting 'Certificate file: '. Expect launcher.share.addresses to equal the two addresses.

it('with --share, gives the server TRUST_PROXY 127.0.0.1 and the certificate path', ...);
// Expect the config handed to startServer to have TRUST_PROXY '127.0.0.1' and TLS_CERT_PATH ending 'cert.pem'.

it('without --share, starts no front and sets neither value', ...);

it('reports a taken share port before starting Postgres', ...);
// Hold port 3443 with a net server. Expect the rejection message
// 'Port 3443 is already in use. Choose another with --share-port.' and startPostgres not called.

it('stops Postgres and releases the lock when the front fails to start', ...);
// startShareProxy rejects. Expect the same teardown as the test at line 384.

it('closes the front before the server on stop', ...);
// Record the order of close calls. Expect ['front', 'server'].

it('says so when the PC has no network address', ...);
// network returns no outside address. Expect the 'No network address was found.' line and no 'Shared on' line.

it('puts the share in the ready event and in status --json', ...);
// Read the status through runStatus, which reads the lock file as a separate process would.

it('keeps the lock token and control port when it writes the share', ...);
// Read the lock file before and after the front starts. Expect the same token, controlPort, pid and startedAt.

it('still stops the server and Postgres when closing the front fails', ...);
// The fake front's close rejects. Expect server close and Postgres stop to have run, and the lock released.
```

Add to the argument parsing tests in the same file one case per row of the flag table above.

- [ ] **Step 2: Write the failing environment test**

In `apps/standalone/src/environment.test.ts`:

```ts
it('adds TRUST_PROXY and TLS_CERT_PATH only when sharing', () => {
  expect(buildEnvironment({ ...input, share: { certFile: '/d/share/cert.pem' } })).toMatchObject({ TRUST_PROXY: '127.0.0.1', TLS_CERT_PATH: '/d/share/cert.pem' });
  const plain = buildEnvironment(input);
  expect(plain.TRUST_PROXY).toBeUndefined();
  expect(plain.TLS_CERT_PATH).toBeUndefined();
});
```

- [ ] **Step 3: Write the failing server test**

In `apps/server/src/local-auth-routes.test.ts`, next to the test at line 110. This pins the layer the front depends on: a request from `127.0.0.1` that says `https` gets a secure cookie.

```ts
it('marks the cookie Secure when a front on 127.0.0.1 says the request came over https', ...);
// Build the app with TRUST_PROXY '127.0.0.1', the exact value the launcher sets.
// Sign in with headers 'x-forwarded-proto': 'https' and 'x-forwarded-for': '192.168.1.50'.
// Expect set-cookie to contain '; Secure', and the audit row for the sign-in to carry 192.168.1.50 as the address (`metadata.ip`, `local-auth-routes.ts:154`).
```

The opposite case is already tested at line 117. Do not add it again.

- [ ] **Step 4: Run all three and see them fail**

Run: `pnpm --filter @openldr/standalone exec vitest run src/commands.test.ts src/environment.test.ts` and `pnpm --filter @openldr/server exec vitest run src/local-auth-routes.test.ts`
Expected: the new launcher and environment tests FAIL. If the server test passes at once, keep it. It pins behaviour this plan relies on.

- [ ] **Step 5: Write the code**

Make the changes listed under Files, to the interfaces, table, order and printed lines above.

- [ ] **Step 6: Run the tests and see them pass**

Run the two commands from Step 4, then `pnpm --filter @openldr/standalone test` and `pnpm --filter @openldr/standalone typecheck > /tmp/tc-standalone.txt 2>&1; echo "exit=$?"`.
Expected: PASS, `exit=0`.

- [ ] **Step 7: Commit**

```bash
git add apps/standalone/src apps/server/src/local-auth-routes.test.ts
git commit -m "feat(standalone): --share opens OpenLDR to the lab network over HTTPS"
```

---

### Task 5: The switch in the desktop app

**Files:**
- Modify: `apps/desktop/src/settings.ts:7-37`
- Modify: `apps/desktop/src/launcher.ts:12` (the `ready` event), `:86-89` (`startArgs`), `:123-150` (`Status`, `readStatus`)
- Modify: `apps/desktop/src/controller.ts` (`ControllerDeps.startLauncher`, the `ready` case near 341, `attach` near 241, a new `restart()` and `share()`)
- Create: `apps/desktop/src/tray-menu.ts`
- Modify: `apps/desktop/src/main.ts:289-317` (the tray)
- Modify: `apps/desktop/src/strings.ts`
- Modify: `apps/desktop/README.md` (the lines that say the launcher always starts with `--host 127.0.0.1`)
- Test: `apps/desktop/src/settings.test.ts`, `launcher.test.ts`, `controller.test.ts`, `strings.test.ts`
- Test: `apps/desktop/src/tray-menu.test.ts`

**Interfaces:**
- Consumes: `--share`, `--share-port`, and `share` in `status --json` and the `ready` event (Task 4).
- Produces:

```ts
// settings.ts: Settings gains
shareOnNetwork: boolean;        // default false
sharePort?: number;             // kept only when a whole number from 1 to 65535

// launcher.ts
export interface ShareInfo { addresses: string[]; fingerprint: string; certFile: string }
export function startArgs(t: LauncherTarget, port: number, share?: { port: number }): string[];
// With share: the same list plus '--share', '--share-port', String(share.port). '--host 127.0.0.1' stays.
// Status (running) and the 'ready' LauncherEvent gain:  share?: ShareInfo
// readStatus keeps `share` only when addresses is an array of strings and the other two are strings.

// controller.ts
// ControllerDeps.startLauncher gains a third argument:  share: { port: number } | undefined
share(): ShareInfo | undefined;   // what the running launcher reported, or undefined
/** Stops the app's own launcher and starts it again with the current settings.
 *  Returns false and does nothing unless the app started the launcher and it is ready,
 *  or while another restart is running. */
restart(): Promise<boolean>;

// tray-menu.ts
export interface TrayState { startAtSignIn: boolean; shareOnNetwork: boolean; share: ShareInfo | undefined }
export interface TrayActions {
  open(): void; setStartAtSignIn(on: boolean): void; setShare(on: boolean): void;
  copy(text: string): void; saveCertificate(certFile: string): void; openLogs(): void; quit(): void;
}
export function trayTemplate(state: TrayState, s: AppStrings, act: TrayActions): Electron.MenuItemConstructorOptions[];
```

The share port the app passes is `settings.sharePort ?? 3443`.

The tray menu, top to bottom:

| Item | Kind | Shown |
|---|---|---|
| Open OpenLDR | click | always |
| Start at sign-in | checkbox | always |
| Share on the lab network | checkbox, checked from `state.shareOnNetwork` | always |
| the first address, as a disabled label | label | only when `state.share` has at least one address |
| Copy network address | click, copies `share.addresses[0]` | only when `state.share` has at least one address |
| "No network address was found" as a disabled label | label | only when `state.share` is set with no address |
| Copy certificate fingerprint | click | only when `state.share` is set |
| Save certificate... | click | only when `state.share` is set |
| Open logs | click | always |
| separator, Quit | | always |

Behaviour of the checkbox, in `main.ts`:
- Turning it on shows a confirm box first (Electron `dialog.showMessageBox`, buttons Share and Cancel). Cancel leaves the setting off and unticks the box. A native box is right here: it is a yes or no prompt outside Studio.
- After a yes, or on turning it off: save the setting, then call `controller.restart()`.
- If `restart()` returns false, show an info box with `shareNextStart`. The setting stays saved.
- While a restart runs, the tick box is disabled.
- The tray menu is rebuilt whenever the setting changes and whenever the controller shows the Studio screen.
- "Save certificate..." opens a save box with the default name `openldr-certificate.pem` and copies `certFile` there.

New strings. French and Portuguese go in the same change, in the same short register.

| Key | English |
|---|---|
| `trayShare` | Share on the lab network |
| `trayCopyAddress` | Copy network address |
| `trayCopyFingerprint` | Copy certificate fingerprint |
| `traySaveCertificate` | Save certificate... |
| `shareConfirmTitle` | Share OpenLDR on this network? |
| `shareConfirmBody` | Other PCs on this network will be able to open OpenLDR and sign in. OpenLDR restarts now. Anyone using it waits a moment. |
| `shareConfirmYes` | Share |
| `shareConfirmNo` | Cancel |
| `shareNextStart` | OpenLDR was started outside this app. The change applies the next time this app starts it. |
| `trayNoAddress` | No network address was found |
| `shareRestartFailed` | OpenLDR did not stop, so sharing was not changed. Quit OpenLDR and open it again. |

- [ ] **Step 1: Write the failing tests**

```ts
// settings.test.ts
it('keeps shareOnNetwork and a valid sharePort, and drops a bad port', ...);
// A file with { shareOnNetwork: true, sharePort: 8443 } keeps both. sharePort 0 and 'x' are dropped.
// A file without shareOnNetwork gives false.

// launcher.test.ts
it('adds --share and --share-port after the usual arguments', ...);
// startArgs(t, 3000, { port: 3443 }) ends with ['--share', '--share-port', '3443'] and still holds '--host', '127.0.0.1'.
it('reads share from status --json and drops a malformed one', ...);

// controller.test.ts
it('starts the launcher with the share port when the setting is on', ...);
// settings { shareOnNetwork: true } gives startLauncher's third argument { port: 3443 }.
// With sharePort 8443, { port: 8443 }. With the setting off, undefined.
it('reports the share from the ready event', ...);
it('restart stops its own launcher and starts again', ...);
// Expect screens: studio, stopping, starting, studio. Expect requestStop called once and startLauncher twice.
it('restart returns false when attached to a launcher it did not start', ...);
it('restart returns false while starting', ...);
it('restart shows no error screen when its own child stops', ...);
// The fake child sends 'stopped' and exits during the restart. Expect no 'error' screen among the screens shown.
it('restart starts no second launcher when the first did not stop', ...);
// requestStop returns 1 and the child never exits. Expect startLauncher called once and an error screen.
it('a second restart during a restart returns false', ...);

// tray-menu.test.ts
it('shows the address and the three share items only when sharing is running', ...);
it('with no network address, shows the no-address line and no copy address item', ...);
it('ticks the share box from the setting', ...);
it('copies the first address and the fingerprint', ...);

// strings.test.ts already checks every language has every key. Run it.
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`
Expected: the new tests FAIL.

- [ ] **Step 3: Write the code**

`restart()` reuses the private `stopOwn(child)` and then `start()`. It must not call `deps.exit`. Three rules:
- It raises `run` before it asks the launcher to stop. The old child's exit then counts as stale, and `onExit` (`controller.ts:352`) does not show the "launcher gone" error for a stop the app asked for.
- If the child has not exited when `stopOwn` returns, it starts no second launcher. It shows the error screen with `shareRestartFailed` and returns true.
- A second `restart()` while one is running returns false.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @openldr/desktop test` and `pnpm --filter @openldr/desktop typecheck > /tmp/tc-desktop.txt 2>&1; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): a tray switch shares OpenLDR on the lab network"
```

---

### Task 6: Docs

**Files:**
- Modify: `apps/web/src/docs/0.1.8/en/standalone.md` (the flags table near line 89, the section "Open it to a phone or another computer" at 266, the limits list near 309), and the same page in `fr` and `pt`
- Modify: `apps/web/src/docs/0.1.8/en/desktop-app.md`, and the same page in `fr` and `pt`

- Create: `apps/studio/src/docs/0.1.8/en/share-on-network.md`, and the same page in `fr` and `pt`
- Modify: `apps/studio/src/docs/registry.ts` (one entry, slug `share-on-network`, related to `sign-in` and `first-run`)

The operator decided on 2026-11-27 that this feature gets an in-app guide too. `HOW-TO-TEMPLATE.md` says setup belongs on the website. This page is the exception, so keep it short and link to the web page for the rest.

No Studio screen changes, so there is no mobile view to check. CLI parity is the `--share` flag itself.

- [ ] **Step 1: Rewrite the standalone section**

Lead with `--share`. Keep `--host` as the plain HTTP way, with its warning. Cover, in this order: the command, the printed lines, what another PC sees the first time (a certificate warning, compare the fingerprint), the firewall, that a new address means a new certificate and a new fingerprint, and how a Node program trusts the certificate (`NODE_EXTRA_CA_CERTS=<path to the saved certificate>`). Add `--share` and `--share-port` to the flags table.

- [ ] **Step 2: Add "Share on the lab network" to the desktop page**

The tray switch, the confirm box, the tray items, and the same first-time steps for the other PC.

- [ ] **Step 3: Write the in-app guide**

Follow `apps/studio/src/docs/HOW-TO-TEMPLATE.md`. Title: "Open OpenLDR from another PC". Three tasks: "Share this PC's OpenLDR" (the tray switch, or `--share`), "Open it on another PC" (type the address, the first-time certificate warning), "Check the certificate" (compare the fingerprint with the one the tray copies). No clip: the steps happen outside Studio. Say that in one line where the template asks for a clip. Add the registry entry.

- [ ] **Step 3b: Apply Task 1's result**

If Task 1 refuted G3, remove the lines that say plugin pages and dashboard editing fail over plain HTTP. If it confirmed G3, name the screens that fail.

- [ ] **Step 4: Translate to fr and pt, and run `unslop` over all nine files**

- [ ] **Step 5: Run the web tests**

Run: `pnpm --filter @openldr/web test` and `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS. These tests check doc links, versions, and that every in-app guide is registered in three languages.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/docs apps/studio/src/docs
git commit -m "docs: share a standalone or desktop install on the lab network"
```

---

### Task 7: The gate and a live check

A CE branch needs its own install for a live check. The dev stack runs the main checkout and must not be touched. Tell the operator before starting this install.

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0` twice. On a failure, grep for `Test timed out`, `out of memory` and `VirtualAlloc` before reading it as a regression.

- [ ] **Step 2: Start a shared install from the worktree**

```bash
pnpm --filter @openldr/studio build && pnpm --filter @openldr/standalone build
OPENLDR_SKIP_ENV_FILE=true node apps/standalone/dist/index.js start --data-dir /tmp/openldr-share-check --port 3231 --share
```

Run it in the background. Expected: the five share lines are printed.

- [ ] **Step 3: Check it from the outside**

```bash
CERT=/tmp/openldr-share-check/share/cert.pem
curl -s --cacert $CERT https://$(hostname):3443/health
curl -s -o /dev/null -w '%{http_code}\n' https://127.0.0.1:3443/health
NODE_EXTRA_CA_CERTS=$CERT node -e "fetch('https://'+require('os').hostname()+':3443/health').then(r=>console.log(r.status))"
curl -s http://127.0.0.1:3231/health
```

Expected, in order: an answer, which proves the PC's name is in the certificate. A failure, because the certificate is not trusted without `--cacert`. `200`, which is the companion's way in. An answer, because the local window's address still works.

Then sign in through `https://<hostname>:3443` with a test account made in this install, and check the `set-cookie` header holds `; Secure`. Keep the test account inside `/tmp/openldr-share-check` only.

This check proves the TLS and HTTP layers. It does not prove plugin permissions or a referral transfer through the front.

- [ ] **Step 4: Check the analyser companion's way in (G4)**

The companion needs four settings before it reaches HTTPS (`receiver.mjs:93`), and it retries for ever, so give it a time limit:

```bash
OPENLDR_URL=https://$(hostname):3443 NODE_EXTRA_CA_CERTS=$CERT \
ANALYZER_FACILITY=share-check ANALYZER_LEDGER=/tmp/openldr-share-check/receipts.sqlite \
timeout 20 node /home/fredrick/Projects/Repositories/openldr-ce-plugin-analyzer-interface/companion/receiver.mjs
```

Expected: its output shows an answer from OpenLDR, such as a refusal for the missing token or plugin. It must not show `Use HTTPS for a remote broker.` or a certificate error. Run it a second time with the PC's IP address in `OPENLDR_URL`. A PC whose name is not a valid host name has only the IP in its certificate.

Write in the docs (Task 6) that a new certificate means saving it again on the analyser PC and starting the companion again.

- [ ] **Step 5: Stop the install and write down what was not shown**

Stop with `node apps/standalone/dist/index.js stop --data-dir /tmp/openldr-share-check`. In the hand-over, write **HONEST NON-PROOF** for each of these:
- A second physical PC opening the address. Only a real lab network shows whether the PC's name resolves.
- The Windows firewall prompt. Linux cannot show it.
- The tray switch on Windows and macOS. Only the Linux app was run here.

- [ ] **Step 6: After the merge to `main`, update the changelog**

Merging is the operator's call. Once merged, run `pnpm make:changelog` on `main` and commit `apps/web/src/landing/changelog.json`.
