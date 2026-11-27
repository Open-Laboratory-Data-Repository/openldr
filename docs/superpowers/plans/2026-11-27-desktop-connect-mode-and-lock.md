# Desktop connect mode and lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app can run as a window onto another OpenLDR, with no server and no database of its own, and can be locked to OpenLDR.

**Architecture:** The app gets a second controller beside `DesktopController`. It starts no launcher. It checks that the server answers, settles trust in the server's certificate, and shows Studio from the server's address. The window's safety rules trust that one address the way they trust `127.0.0.1` today. The lock is a separate setting that works in both modes.

**Tech Stack:** Electron (BrowserWindow, session, tray), TypeScript, vitest, `node:tls`, `node:crypto`. No new package.

**Spec:** `docs/superpowers/specs/2026-11-27-lab-deployment-setups-design.md`, sections "The two ways the desktop app runs", "Connect mode" and "Lock this PC to OpenLDR". This plan closes gaps G5, G6 and G13.

**This is plan 2 of 4.** Build plan 1 first (`docs/superpowers/plans/2026-11-27-share-on-lab-network.md`). This plan's live check connects to an install shared by plan 1.

## One change from the spec

The spec says turning the lock off needs an OpenLDR administrator's sign-in. This plan uses a PIN that is set when the lock is turned on. Two reasons. A locked PC must still unlock when the server is off. And a hub that signs in through Keycloak gives the app no way to ask who is signed in. The operator should confirm this change.

## Global Constraints

- Connect mode needs an `https` address. A plain `http` address is refused unless its host is `127.0.0.1`.
- Connect mode starts no launcher, no server and no database.
- The app's two bridge calls (`setupCode`, `info`) stay off in connect mode. `mayAnswerStudio` does not change.
- A certificate the PC's system does not trust is accepted only after the person sees its SHA-256 fingerprint and says yes. The app then remembers that fingerprint for that address only.
- A changed certificate is never accepted silently.
- An install that already holds data never sees the mode choice. It stays in local mode.
- The lock is off by default.
- The app's own page holds no words of its own. Every word comes from `strings.ts` in en, fr and pt.
- The app's own page stays plain HTML, as it is today. The Studio UI rules in AGENTS.md §5 do not cover it.
- No product code in core (AGENTS.md §8).
- Short plain sentences in every doc, string and commit message. No em dashes. Run the `unslop` skill over them.
- No `Co-Authored-By` trailer on any commit (AGENTS.md §9).
- Docs land in en, fr and pt.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

## Review Focus

1. **The server goes off while someone works.** Expected: a plain "cannot reach the server" screen with a retry, and Studio comes back by itself when the server answers. Never a blank window. Test in Task 4.
2. **The address is typed in many shapes** (`labpc`, `labpc:3443`, `HTTPS://LabPC:3443/studio/`, with spaces, `http://labpc`). Expected: each good one becomes the same address, and plain `http` is refused with a clear line. Test in Task 1.
3. **The server's certificate changes after it was trusted.** Expected: the app stops, shows the new fingerprint, and asks again. Test in Task 3 and Task 4.
4. **A page on the server links to another site.** Expected: it opens in the browser, or does nothing when the PC is locked. It never loads inside the window. Test in Task 2 and Task 6.
5. **The PIN is forgotten.** Expected: the guide says how to clear the lock from the settings file, which needs the PC account. A wrong PIN shows one line and changes nothing. Test in Task 6.

---

### Task 1: Settings and the server address

**Files:**
- Modify: `apps/desktop/src/settings.ts`
- Create: `apps/desktop/src/server-address.ts`
- Test: `apps/desktop/src/settings.test.ts`, `apps/desktop/src/server-address.test.ts`

**Interfaces:**
- Produces:

```ts
// settings.ts: Settings gains
mode?: 'local' | 'connect';                       // missing means not chosen yet
server?: { address: string; fingerprint?: string }; // address as parseServerAddress gives it
lock?: { salt: string; hash: string };            // present means locked. Task 6 fills it.
// `known()` keeps each only when well formed: mode is one of the two words, server.address parses,
// fingerprint matches /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, salt and hash are non-empty hex.

// server-address.ts
export type ParsedAddress =
  | { ok: true; address: string; origin: string; host: string; port: number }
  | { ok: false; reason: 'empty' | 'not-https' | 'unreadable' };

/** What a person typed, as the address the window loads. `address` always ends in '/studio/'. */
export function parseServerAddress(input: string): ParsedAddress;
```

Rules for `parseServerAddress`:
- Trim it. Empty gives `empty`.
- No scheme means `https://` is put in front.
- The host is lower-cased. The path, query and hash are dropped. The result is `<origin>/studio/`.
- `http:` is `not-https`, unless the host is `127.0.0.1`.
- Any scheme other than `http:` and `https:`, a user name, a password, or text the URL parser refuses gives `unreadable`.
- `port` is the number in the address, or 443 for `https` and 80 for `http`.

- [ ] **Step 1: Write the failing tests**

```ts
// server-address.test.ts
it.each([
  ['labpc', 'https://labpc/studio/'],
  ['labpc:3443', 'https://labpc:3443/studio/'],
  ['  HTTPS://LabPC:3443/studio/#x  ', 'https://labpc:3443/studio/'],
  ['https://192.168.1.20:3443', 'https://192.168.1.20:3443/studio/'],
  ['https://hub.example.org/studio/orders?x=1', 'https://hub.example.org/studio/'],
  ['http://127.0.0.1:3000', 'http://127.0.0.1:3000/studio/'],
])('reads %j as %s', (input, address) => {
  expect(parseServerAddress(input)).toMatchObject({ ok: true, address });
});
it('gives the port', () => {
  expect(parseServerAddress('labpc')).toMatchObject({ port: 443, host: 'labpc', origin: 'https://labpc' });
  expect(parseServerAddress('labpc:3443')).toMatchObject({ port: 3443 });
});
it.each([
  ['', 'empty'], ['   ', 'empty'],
  ['http://labpc', 'not-https'], ['http://localhost:3000', 'not-https'],
  ['ftp://labpc', 'unreadable'], ['https://user:pw@labpc', 'unreadable'], ['https://', 'unreadable'], ['lab pc', 'unreadable'],
])('refuses %j as %s', (input, reason) => {
  expect(parseServerAddress(input)).toEqual({ ok: false, reason });
});

// settings.test.ts
it('keeps a well formed mode, server and lock, and drops malformed ones', ...);
// { mode: 'connect', server: { address: 'https://labpc:3443/studio/', fingerprint: <32 pairs> } } is kept whole.
// mode 'x' is dropped. server.address 'http://labpc' drops the whole server. A bad fingerprint is dropped alone.
// lock { salt: 'zz', hash: '' } is dropped.
it('a file from before this change loads with no mode, no server and no lock', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop exec vitest run src/server-address.test.ts src/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the code to the interface and rules above**

- [ ] **Step 4: Run them and see them pass**

Run: the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings.ts apps/desktop/src/settings.test.ts apps/desktop/src/server-address.ts apps/desktop/src/server-address.test.ts
git commit -m "feat(desktop): settings and address parsing for connect mode"
```

---

### Task 2: The window trusts one named server

**Files:**
- Modify: `apps/desktop/src/locality.ts:76-85` (`mayGrantPermission`)
- Test: `apps/desktop/src/locality.test.ts`

`linkTarget` and `frameTarget` already work from "the address the window shows" and need no change: in connect mode that address is the server's. Only the permission rule is tied to this PC.

**Interfaces:**
- Produces:

```ts
/** True for an address on this PC, or an https address when the app is in connect mode. */
export function isTrustedAddress(shownAddress: string, connectMode: boolean): boolean;

export function mayGrantPermission(
  permission: string, requestingUrl: string, shownAddress: string | undefined, connectMode?: boolean,
): boolean;
// Still only 'clipboard-sanitized-write', still only from the shown address's own origin.
// Granted when isTrustedAddress(shownAddress, connectMode === true).
```

- [ ] **Step 1: Write the failing tests**

```ts
it('grants the copy permission to the connected server in connect mode', () => {
  expect(mayGrantPermission('clipboard-sanitized-write', 'https://labpc:3443/studio/x', 'https://labpc:3443/studio/', true)).toBe(true);
});
it('refuses it to the same address outside connect mode', () => {
  expect(mayGrantPermission('clipboard-sanitized-write', 'https://labpc:3443/studio/x', 'https://labpc:3443/studio/')).toBe(false);
});
it('refuses another origin, and a plain http server, in connect mode', () => {
  expect(mayGrantPermission('clipboard-sanitized-write', 'https://other/x', 'https://labpc:3443/studio/', true)).toBe(false);
  expect(mayGrantPermission('clipboard-sanitized-write', 'http://labpc/x', 'http://labpc/studio/', true)).toBe(false);
});
it.each(['clipboard-read', 'media', 'geolocation', 'notifications', 'serial', 'fullscreen'])('still refuses %s in connect mode', (p) => {
  expect(mayGrantPermission(p, 'https://labpc:3443/x', 'https://labpc:3443/studio/', true)).toBe(false);
});
it('keeps links to the connected server inside and sends others to the browser', () => {
  expect(linkTarget('https://labpc:3443/auth/realms/openldr', 'https://labpc:3443/studio/', [])).toBe('inside');
  expect(linkTarget('https://example.org/', 'https://labpc:3443/studio/', [])).toBe('browser');
  expect(frameTarget('https://example.org/', 'https://labpc:3443/studio/')).toBe('refuse');
});
it('never answers the bridge for a connected server', () => {
  expect(mayAnswerStudio('https://labpc:3443/studio/', 'https://labpc:3443/studio/')).toBe(false);
});
```

- [ ] **Step 2: Run them and see the first one fail**

Run: `pnpm --filter @openldr/desktop exec vitest run src/locality.test.ts`
Expected: the first test FAILS. The last two may pass already. Keep them: they pin rules this plan relies on.

- [ ] **Step 3: Write `isTrustedAddress` and widen `mayGrantPermission`**

- [ ] **Step 4: Run them and see them pass**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/locality.ts apps/desktop/src/locality.test.ts
git commit -m "feat(desktop): the window can trust one named server"
```

---

### Task 3: Trust in the server's certificate

**Files:**
- Create: `apps/desktop/src/cert-trust.ts`
- Test: `apps/desktop/src/cert-trust.test.ts`

**Interfaces:**
- Produces:

```ts
/** 'AB:CD:...' (32 upper case hex pairs) from Electron's 'sha256/<base64>'. Undefined when unreadable. */
export function colonHex(electronFingerprint: string): string | undefined;

export interface PinnedServer { host: string; fingerprint: string }

/** The answer for Electron's setCertificateVerifyProc callback.
 *   0  accept: Chromium already trusts it, or the host and fingerprint match the pin.
 *  -2  refuse: this is the pinned host and the fingerprint differs, or it is another host that Chromium refuses.
 *  Never -3. The app decides every case itself. */
export function verifyDecision(
  request: { hostname: string; verificationResult: string; certificate: { fingerprint: string } },
  pinned: PinnedServer | undefined,
): 0 | -2;

export type ServerCertificate =
  | { ok: true; fingerprint: string; trustedBySystem: boolean }
  | { ok: false };

/** Opens a TLS connection without checking the certificate, reads it, and closes. 10 s limit.
 *  `trustedBySystem` is the socket's `authorized` flag. `{ ok: false }` when nothing answers. */
export function readServerCertificate(host: string, port: number): Promise<ServerCertificate>;
```

`verificationResult` is `'net::OK'` when Chromium trusts the certificate.

- [ ] **Step 1: Write the failing tests**

```ts
it('turns an Electron fingerprint into colon hex', () => {
  const raw = Buffer.from('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
  expect(colonHex(`sha256/${raw.toString('base64')}`)).toBe('00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF');
  expect(colonHex('md5/xx')).toBeUndefined();
});
describe('verifyDecision', () => {
  const fp = '<the colon hex above>';
  const cert = { fingerprint: `sha256/<the base64 above>` };
  it('accepts what Chromium trusts', ...);                       // net::OK, no pin -> 0
  it('accepts the pinned host with the pinned fingerprint', ...); // net::ERR_CERT_AUTHORITY_INVALID, pin matches -> 0
  it('refuses the pinned host with another fingerprint', ...);    // -> -2
  it('refuses the pinned fingerprint on another host', ...);      // -> -2
  it('refuses an untrusted certificate when nothing is pinned', ...); // -> -2
  it('compares the host without regard to case', ...);
});
describe('readServerCertificate', () => {
  it('reads the fingerprint of a self-signed server and says the system does not trust it', ...);
  // Start node:https on 127.0.0.1 port 0 with a fixed self-signed test PEM kept in the test file.
  // Expect { ok: true, trustedBySystem: false } and fingerprint equal to new X509Certificate(pem).fingerprint256.
  it('gives ok false when nothing listens', ...);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop exec vitest run src/cert-trust.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `cert-trust.ts`**

`readServerCertificate` uses `tls.connect({ host, port, servername: host, rejectUnauthorized: false })` and `getPeerX509Certificate().fingerprint256`. Leave `servername` out when the host is an IP address.

- [ ] **Step 4: Run them and see them pass**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/cert-trust.ts apps/desktop/src/cert-trust.test.ts
git commit -m "feat(desktop): read and pin a server's certificate"
```

---

### Task 4: The connect controller and its screens

**Files:**
- Modify: `apps/desktop/src/controller.ts:11-49` (`Screen`, `PageState`, `pageState`)
- Create: `apps/desktop/src/remote-controller.ts`
- Modify: `apps/desktop/src/strings.ts`
- Test: `apps/desktop/src/remote-controller.test.ts`, `apps/desktop/src/controller.test.ts`, `apps/desktop/src/strings.test.ts`

**Interfaces:**
- Consumes: `parseServerAddress` (Task 1), `readServerCertificate`, `PinnedServer` (Task 3).
- Produces:

```ts
// controller.ts: Screen gains four members
| { screen: 'choose' }
| { screen: 'connect'; value?: string; problem?: 'empty' | 'not-https' | 'unreadable' | 'no-answer' }
| { screen: 'certificate'; address: string; fingerprint: string; changed: boolean }
| { screen: 'unreachable'; address: string }

// PageState gains three optional parts. The page draws whatever is present.
detail?: string;                                            // shown in a fixed-width font: the fingerprint
input?: { label: string; value: string; placeholder: string; secret?: boolean };
actions?: Array<{ id: PageAction; label: string; primary?: boolean }>;

export type PageAction =
  | 'choose-local' | 'choose-connect' | 'connect' | 'back' | 'trust' | 'no-trust' | 'retry' | 'change-server'
  | 'pin-submit' | 'pin-cancel';   // the last two are used by Task 6

// What main.ts needs from either controller. DesktopController already has these.
export interface AppController {
  address(): string | undefined;
  bridgeAddress(): string | undefined;
  dataDir(): string | undefined;
  start(): Promise<void>;
  retry(): Promise<void>;
  quit(): Promise<void>;
}

// remote-controller.ts
export interface RemoteDeps {
  /** GET <origin>/health with the window's session. 'untrusted' when the certificate was refused. */
  probe(address: string): Promise<'ok' | 'no-answer' | 'untrusted'>;
  readCertificate(host: string, port: number): Promise<ServerCertificate>;
  /** Tells the window's certificate check which host and fingerprint to accept. */
  pin(server: PinnedServer | undefined): void;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  show(screen: Screen): void;
  sleep(ms: number): Promise<void>;
  exit(code: number): void;
  log(line: string): void;
  pollMs?: number;   // default 10_000
}

export class RemoteController implements AppController {
  constructor(deps: RemoteDeps);
  /** With a saved server: pin, probe, then Studio. Without one: the 'connect' screen. */
  start(): Promise<void>;
  /** The person pressed Connect with this text. */
  connect(input: string): Promise<void>;
  /** The person answered the certificate screen. */
  trust(yes: boolean): Promise<void>;
  /** Forget the server and show the 'connect' screen with the old address filled in. */
  changeServer(): void;
  retry(): Promise<void>;
  quit(): Promise<void>;                 // exit(0). There is no launcher to stop.
  address(): string | undefined;         // the server's address once Studio is shown
  bridgeAddress(): undefined;            // always
  dataDir(): undefined;                  // always
}
```

How `connect(input)` goes:
1. Parse. A refusal shows `connect` again with `problem` and the typed text.
2. Read the certificate. `{ ok: false }` shows `connect` with `problem: 'no-answer'`.
3. `trustedBySystem` true: save `{ address }` with no fingerprint, pin nothing, go to step 5.
4. Otherwise show `certificate` with `changed: false`. On yes, save `{ address, fingerprint }` and pin it. On no, show `connect` again.
5. Probe. `ok` shows Studio. `no-answer` shows `unreachable`. `untrusted` goes back to step 2.

How `start()` goes with a saved server:
1. Pin the saved fingerprint when there is one.
2. Probe. `ok` shows Studio. `no-answer` shows `unreachable` and probes again every `pollMs` until it answers, then shows Studio.
3. `untrusted` reads the certificate. A fingerprint that differs from the saved one shows `certificate` with `changed: true`. The saved one is not replaced until the person says yes.

While Studio is shown, the controller probes every `pollMs`. A `no-answer` shows `unreachable`. The next `ok` shows Studio again.

`pageState` for the new screens. The English words are below. French and Portuguese go in the same change.

| Screen | Title | Message, detail, input | Actions |
|---|---|---|---|
| `choose` | How will this PC use OpenLDR? | This PC holds the lab's data: OpenLDR and its database run here. Connect to the lab's server: this PC only shows OpenLDR from another PC. | `choose-local` "This PC holds the lab's data", `choose-connect` "Connect to the lab's server" |
| `connect` | Connect to the lab's server | input label "Server address", placeholder `labpc:3443`. Problem lines below. | `connect` "Connect" (primary), `back` "Back" |
| `certificate`, first time | Check the server's certificate | "This is the first time this PC connects to {address}. Compare this fingerprint with the one shown on the server." detail: the fingerprint | `trust` "It matches" (primary), `no-trust` "Cancel" |
| `certificate`, changed | The server's certificate has changed | "The certificate of {address} is not the one this PC accepted before. Compare this fingerprint with the one shown on the server. If you did not expect a change, stop here." detail: the fingerprint | `trust` "It matches", `no-trust` "Cancel" (primary) |
| `unreachable` | Cannot reach the server | "{address} is not answering. OpenLDR will come back by itself when it does." | `retry` "Try again" (primary), `change-server` "Change server" |

Problem lines on `connect`: `empty` "Type the server's address." `not-https` "The address must start with https." `unreadable` "That is not an address OpenLDR can use." `no-answer` "Nothing answered at that address. Check it and that the server is on."

`back` is shown on `connect` only when no mode is saved yet. It returns to `choose`.

- [ ] **Step 1: Write the failing tests**

Use fake deps in the style of `apps/desktop/src/controller.test.ts`.

```ts
// remote-controller.test.ts
it('with no saved server, shows the connect screen', ...);
it('shows the problem and keeps the text when the address is refused', ...);      // 'http://labpc' -> problem 'not-https', value 'http://labpc'
it('says nothing answered when the certificate cannot be read', ...);
it('connects without a question when the system trusts the certificate', ...);
// screens: connect -> studio. Saved server has no fingerprint. pin called with undefined.
it('asks about an untrusted certificate, then saves and pins it on yes', ...);
// screens: connect -> certificate(changed false) -> studio. Saved fingerprint equals the one read. pin called with { host, fingerprint }.
it('goes back to the connect screen on no, and saves nothing', ...);
it('with a saved server, pins it and shows Studio', ...);
it('shows the unreachable screen, then Studio once the server answers', ...);     // probe: no-answer, no-answer, ok
it('asks again when the saved certificate no longer matches, and keeps the old one until yes', ...);
// probe 'untrusted', readCertificate gives another fingerprint -> certificate(changed true). Settings unchanged. After trust(true): saved and pinned.
it('shows the unreachable screen when the server stops answering under Studio, and comes back', ...);
it('changeServer forgets the server and fills the old address in', ...);
it('quit exits with 0 and stops the probing', ...);
it('never gives a bridge address or a data folder', ...);

// controller.test.ts
it('gives each new screen its words, input and actions', ...);
// One assertion per row of the table above, against the English strings.
// strings.test.ts already checks every language has every key.
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`
Expected: the new tests FAIL.

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run them and see them pass**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): a controller that shows OpenLDR from another PC"
```

---

### Task 5: The mode choice, the page and the wiring

**Files:**
- Modify: `apps/desktop/pages/page.html`, `apps/desktop/pages/page.js`, `apps/desktop/pages/page.css`
- Modify: `apps/desktop/src/channels.ts`, `apps/desktop/src/preload.ts`
- Create: `apps/desktop/src/mode.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/tray-menu.ts` (made by plan 1), `apps/desktop/src/strings.ts`
- Modify: `apps/desktop/src/selfcheck.ts`, `apps/desktop/README.md`
- Test: `apps/desktop/src/mode.test.ts`, `apps/desktop/src/tray-menu.test.ts`

**Interfaces:**
- Consumes: `RemoteController`, `AppController`, `PageAction` (Task 4), `verifyDecision` (Task 3), `mayGrantPermission` (Task 2).
- Produces:

```ts
// channels.ts
/** The app's own page to main: a button was pressed. Carries { id: PageAction; value?: string }. */
export const ACTION_CHANNEL = 'openldr-desktop:action';

// preload.ts: window.openldrDesktopPage gains
act(id: string, value?: string): void;

// mode.ts
/** What the app does at start.
 *  'local' or 'connect' when saved. Otherwise 'local' when the data folder already holds an install
 *  (its standalone.json exists), 'connect' when OPENLDR_DESKTOP_SERVER is set, else 'ask'. */
export function startMode(input: {
  saved: 'local' | 'connect' | undefined;
  dataDir: string | undefined;
  exists(path: string): boolean;
  envServer: string | undefined;
}): 'local' | 'connect' | 'ask';
```

What changes in `main.ts`:
- After `whenReady`, read the launcher's status once for its `dataDir`, then call `startMode`.
- `ask` shows the `choose` screen. `choose-local` saves `mode: 'local'` and starts `DesktopController`. `choose-connect` saves `mode: 'connect'` and starts `RemoteController`.
- A silent `local` (an existing install) also saves `mode: 'local'`.
- `OPENLDR_DESKTOP_SERVER` is for development and tests. It skips the choice and is used as the saved server's address. It is never written to the settings file.
- `controller` is typed `AppController`. Every use that needs launcher-only things (`share()`, `restart()`, the setup code) checks the mode first.
- `session.defaultSession.setCertificateVerifyProc` is set once. It calls `verifyDecision(request, pinned)`. `RemoteDeps.pin` sets `pinned`.
- Both permission handlers pass `connectMode`.
- `ACTION_CHANNEL` is handled only from the app's own page, by the same check `RETRY_CHANNEL` uses at `main.ts:191`. Each action calls the matching controller method. `retry` keeps working through `RETRY_CHANNEL` too.
- `did-fail-load` for the main frame, in connect mode, on the server's origin: call `controller.retry()` so the unreachable screen shows. Do not leave Chromium's error page up.

The page (`page.html`, `page.js`): add a `detail` element, one text input with a label, and a row of buttons. `render(state)` shows each only when its part is present. Enter in the input presses the primary button. The existing `retry` button stays for the error screen.

The tray in connect mode, top to bottom: Open OpenLDR, Start at sign-in, the server's address as a disabled label, Change server..., Use this PC for the lab's data..., Open logs (opens the app's own log folder), separator, Quit. The share items from plan 1 are local mode only. Local mode gains one item: Connect to a lab server...

Switching mode from the tray asks first (Electron `dialog.showMessageBox`), saves the new mode, then restarts the app with `app.relaunch()` and the normal quit path. Local to connect says: "This PC will show OpenLDR from another PC. The data on this PC stays where it is and is not used." Connect to local says: "OpenLDR and its database will run on this PC."

New strings (English): `trayServer` (the label is the address itself), `trayChangeServer` "Change server...", `trayUseLocal` "Use this PC for the lab's data...", `trayUseConnect` "Connect to a lab server...", `switchConfirmYes` "Switch and restart", `switchConfirmNo` "Cancel", and the two messages above as `switchToConnectBody` and `switchToLocalBody`.

The self-check file (`selfcheck.ts`) gains `mode: 'local' | 'connect'`, so a test run can tell which one the app chose.

- [ ] **Step 1: Write the failing tests**

```ts
// mode.test.ts
it('uses the saved mode', ...);                                   // 'connect' saved -> 'connect', whatever else
it('stays local without asking when the data folder holds an install', ...);
// saved undefined, dataDir '/d', exists('/d/standalone.json') true -> 'local'
it('asks on a PC with no install and no saved mode', ...);          // -> 'ask'
it('asks when the data folder is unknown', ...);                    // dataDir undefined -> 'ask'
it('connects when the test variable names a server', ...);          // envServer 'https://labpc:3443' -> 'connect'
it('lets a saved mode win over the test variable', ...);

// tray-menu.test.ts
it('in connect mode shows the server and no share items', ...);
it('in local mode offers to connect to a lab server', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @openldr/desktop test` and `pnpm --filter @openldr/desktop typecheck > /tmp/tc-desktop.txt 2>&1; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): choose between holding the data and connecting to a server"
```

---

### Task 6: Lock this PC to OpenLDR

**Files:**
- Create: `apps/desktop/src/lock.ts`
- Modify: `apps/desktop/src/controller.ts` (two screens), `apps/desktop/src/locality.ts` (`linkTarget`), `apps/desktop/src/main.ts`, `apps/desktop/src/tray-menu.ts`, `apps/desktop/src/strings.ts`
- Test: `apps/desktop/src/lock.test.ts`, `apps/desktop/src/locality.test.ts`, `apps/desktop/src/controller.test.ts`, `apps/desktop/src/tray-menu.test.ts`

**Interfaces:**
- Consumes: `Settings.lock`, `PageAction` `pin-submit` and `pin-cancel`, `ACTION_CHANNEL`.
- Produces:

```ts
// lock.ts
export const MIN_PIN_LENGTH = 4;
/** scrypt, 32 bytes, a fresh 16 byte salt. Both as lower case hex. */
export function makeLock(pin: string): { salt: string; hash: string };
/** Compares with timingSafeEqual. False for a malformed lock. */
export function checkPin(lock: { salt: string; hash: string }, pin: string): boolean;

// controller.ts: Screen gains
| { screen: 'pin'; purpose: 'set' | 'unlock' | 'quit'; wrong?: boolean; tooShort?: boolean }

// locality.ts: linkTarget gains a fourth argument
export function linkTarget(url: string, launcherAddress: string | undefined, ownPages: readonly string[], locked?: boolean): 'inside' | 'browser' | 'refuse';
// With locked true, every result that would be 'browser' is 'refuse'.
```

What the lock does when on:
- The window is in kiosk mode (`win.setKiosk(true)`), set at start and whenever the lock changes.
- Closing the window does nothing. It is not hidden.
- Links to other sites are dropped (`linkTarget` with `locked`).
- Start at sign-in is turned on and its tray tick is disabled.
- Quit from the tray, and the unlock, both show the `pin` screen first.
- `Ctrl+Shift+L` in the window (`before-input-event`) shows the `pin` screen with `purpose: 'unlock'`. The tray may be hidden in kiosk mode, so this is the way in.
- A shutdown or sign-out of the PC still quits without a PIN.

Turning the lock on: tray item "Lock this PC to OpenLDR..." shows the `pin` screen with `purpose: 'set'`. A PIN of 4 or more characters saves `lock` and applies it. A shorter one shows the screen again with `tooShort`.

The `pin` screen leaves Studio, shows the app's own page, and returns to the current controller's screen after `pin-submit` succeeds or `pin-cancel`. A wrong PIN waits 2 seconds, then shows the screen again with `wrong`.

| Purpose | Title | Message | Actions |
|---|---|---|---|
| `set` | Lock this PC to OpenLDR | "Choose a PIN. Unlocking this PC, or quitting OpenLDR, will ask for it. Press Ctrl+Shift+L to unlock." input label "PIN", secret | `pin-submit` "Lock" (primary), `pin-cancel` "Cancel" |
| `unlock` | Unlock this PC | input label "PIN", secret | `pin-submit` "Unlock" (primary), `pin-cancel` "Cancel" |
| `quit` | Quit OpenLDR | "This PC is locked to OpenLDR. Type the PIN to quit." input label "PIN", secret | `pin-submit` "Quit" (primary), `pin-cancel` "Cancel" |

Extra lines: `wrong` "That PIN is not right." `tooShort` "Use at least 4 characters."

The PIN is never logged and never sent to the page. Only its salt and hash are stored. This stops a casual user. It does not stop someone who can edit the settings file with the PC account. The guide says so, and says that clearing `lock` from the file is how a forgotten PIN is recovered.

- [ ] **Step 1: Write the failing tests**

```ts
// lock.test.ts
it('accepts the PIN it was made with and refuses another', ...);
it('gives a different salt and hash each time', ...);
it('refuses a malformed lock', ...);           // checkPin({ salt: 'zz', hash: '' }, '1234') is false

// locality.test.ts
it('drops links to other sites when locked', () => {
  expect(linkTarget('https://example.org/', 'https://labpc:3443/studio/', [], true)).toBe('refuse');
  expect(linkTarget('https://labpc:3443/studio/x', 'https://labpc:3443/studio/', [], true)).toBe('inside');
});

// controller.test.ts
it('gives the pin screen its words for each purpose, and the wrong and too short lines', ...);

// tray-menu.test.ts
it('when locked, offers Unlock, and disables Start at sign-in', ...);
it('when not locked, offers Lock this PC to OpenLDR...', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @openldr/desktop test` and `pnpm --filter @openldr/desktop typecheck > /tmp/tc-desktop.txt 2>&1; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): lock a PC to OpenLDR with a PIN"
```

---

### Task 7: Docs

**Files:**
- Create: `apps/web/src/docs/0.1.8/en/lab-setups.md`, and the same page in `fr` and `pt`
- Modify: `apps/web/src/docs/toc.ts` (one entry, placed after the desktop app page)
- Modify: `apps/web/src/docs/0.1.8/en/desktop-app.md`, and the same page in `fr` and `pt`

- [ ] **Step 1: Write `lab-setups.md`**

This is the "which setup" guide (gap G13). Take the four setups from the spec's "The setups" section: spoke, two-PC lab, hub, analyser PC. For each: what to install on each PC, where the users are made, and what happens when the network is down. Lead with the rule: one full install per site, every other PC is a screen onto it. Link to the desktop app page and the standalone page for the steps.

- [ ] **Step 2: Add two sections to `desktop-app.md`**

"Connect to the lab's server": the first-start choice, the address, the certificate check with the fingerprint, the unreachable screen, and how to change server. "Lock this PC to OpenLDR": the PIN, `Ctrl+Shift+L`, what the lock does not stop, how to set the app as the kiosk program on Windows (assigned access), and how to recover a forgotten PIN.

- [ ] **Step 3: Translate to fr and pt, and run `unslop` over all six files**

- [ ] **Step 4: Run the web tests**

Run: `pnpm --filter @openldr/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/docs
git commit -m "docs: lab setups, connect mode and the lock"
```

---

### Task 8: The gate and a live check

Tell the operator before starting the test install. The dev stack must not be touched.

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0` twice.

- [ ] **Step 2: Start a shared install as the server**

```bash
pnpm --filter @openldr/studio build && pnpm --filter @openldr/standalone build && pnpm --filter @openldr/desktop build
OPENLDR_SKIP_ENV_FILE=true node apps/standalone/dist/index.js start --data-dir /tmp/openldr-connect-check --port 3231 --share
```

Run it in the background. Note the printed address and fingerprint. Make its first administrator with the printed setup code.

- [ ] **Step 3: Start the app in connect mode against it**

```bash
OPENLDR_DESKTOP_USER_DIR=/tmp/openldr-desktop-connect OPENLDR_DESKTOP_SERVER=https://<the printed address> \
OPENLDR_DESKTOP_SELFCHECK=/tmp/connect-selfcheck.json OPENLDR_DESKTOP_SELFCHECK_THEN=stay \
pnpm --filter @openldr/desktop dev
```

Check each of these and take a screenshot of each screen:
- The certificate screen shows the same fingerprint the server printed.
- After "It matches", Studio loads and sign-in works.
- A plugin page opens. Install any plugin from the marketplace for this.
- A file download from Studio saves through the normal save window.
- A copy button in Studio works.
- The self-check file says `"mode": "connect"`.
- No `postgres` or launcher process was started by the app: `pgrep -af openldr-desktop-connect` shows none.

- [ ] **Step 4: Stop the server and watch the app**

Stop the install from Step 2. Expected: within 10 seconds the app shows "Cannot reach the server". Start the install again. Expected: Studio comes back by itself.

- [ ] **Step 5: Change the certificate and watch the app**

Stop the install, delete `/tmp/openldr-connect-check/share/`, and start it again. Expected: the app shows "The server's certificate has changed" with the new fingerprint, and does not load Studio until "It matches".

- [ ] **Step 6: Check the lock**

Turn the lock on from the tray with PIN `1234`. Expected: the window fills the screen, closing it does nothing, a link to another site does nothing, `Ctrl+Shift+L` asks for the PIN, a wrong PIN is refused, the right one unlocks.

- [ ] **Step 7: Stop everything and write down what was not shown**

In the hand-over, write **HONEST NON-PROOF** for each of these:
- A hub that signs in through Keycloak. This check used a local-sign-in install. A server edition with Keycloak needs its own run.
- Windows and macOS. Only the Linux app was run.
- Kiosk mode against a determined user. The app cannot block the operating system's own keys.
- A real second PC. Both ends ran on one machine here.

- [ ] **Step 8: After the merge to `main`, update the changelog**

Merging is the operator's call. Once merged, run `pnpm make:changelog` on `main` and commit `apps/web/src/landing/changelog.json`.
