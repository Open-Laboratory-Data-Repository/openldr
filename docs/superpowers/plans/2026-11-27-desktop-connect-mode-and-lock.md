# Desktop connect mode and lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app can run as a window onto another OpenLDR, with no server and no database of its own, and can be locked to OpenLDR.

**Architecture:** The app gets a second controller beside `DesktopController`. It starts no launcher. It checks that the server answers, settles trust in the server's certificate, and shows Studio from the server's address. The window's safety rules trust that one address the way they trust `127.0.0.1` today. The lock is a separate setting that works in both modes.

**Tech Stack:** Electron (BrowserWindow, session, tray), TypeScript, vitest, `node:tls`, `node:crypto`. No new package.

**Spec:** `docs/superpowers/specs/2026-11-27-lab-deployment-setups-design.md`, sections "The two ways the desktop app runs", "Connect mode" and "Lock this PC to OpenLDR". This plan closes gaps G5, G6 and G13.

**This is plan 2 of 4.** Build plan 1 first (`docs/superpowers/plans/2026-11-27-share-on-lab-network.md`). This plan's live check connects to an install shared by plan 1.

## One change from the spec

The spec first said turning the lock off needs an OpenLDR administrator's sign-in. This plan uses a PIN that is set when the lock is turned on. Two reasons. A locked PC must still unlock when the server is off. And a hub that signs in through Keycloak gives the app no way to ask who is signed in. The operator approved this on 2026-11-27, and the spec now says the same.

## Global Constraints

- Connect mode needs an `https` address. A plain `http` address is refused unless its host is `127.0.0.1`.
- Connect mode starts no launcher, no server and no database.
- The app's two bridge calls (`setupCode`, `info`) stay off in connect mode. `mayAnswerStudio` does not change.
- A certificate the PC's system does not trust is accepted only after the person sees its SHA-256 fingerprint and says yes. The app then remembers that fingerprint for that address only.
- A changed certificate is never accepted silently.
- An install that already holds data never sees the mode choice. It stays in local mode.
- The lock is off by default.
- Once Studio is on screen, the app never replaces it by itself. No background check navigates away from it, and a PIN is asked in a small window on top. Someone may be half way through a result.
- Electron's own check decides whether a certificate is trusted. Node's TLS is used only to read a fingerprint to show.
- The app's own page holds no words of its own. Every word comes from `strings.ts` in en, fr and pt.
- The app's own page stays plain HTML, as it is today. The Studio UI rules in AGENTS.md §5 do not cover it.
- No product code in core (AGENTS.md §8).
- Short plain sentences in every doc, string and commit message. No em dashes. Run the `unslop` skill over them.
- No `Co-Authored-By` trailer on any commit (AGENTS.md §9).
- Docs land in en, fr and pt.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

## Review Focus

1. **The server goes off while someone works.** Expected: Studio stays on screen with what was typed. The "cannot reach the server" screen comes only at start or when Studio's own page fails to load, and Studio comes back by itself when the server answers. Never a blank window, never a loop. Test in Task 4.
2. **The address is typed in many shapes** (`labpc`, `labpc:3443`, `HTTPS://LabPC:3443/studio/`, with spaces, `http://labpc`). Expected: each good one becomes the same address, and plain `http` is refused with a clear line. Test in Task 1.
3. **The server's certificate changes after it was trusted.** Expected: the app stops, shows the new fingerprint, and asks again. Test in Task 3 and Task 4.
4. **A page on the server links to another site.** Expected: it opens in the browser, or does nothing when the PC is locked. It never loads inside the window. Test in Task 2 and Task 6.
5. **The PIN is forgotten, or asked half way through a result.** Expected: the guide says how to clear the lock from the settings file, which needs the PC account. A wrong PIN shows one line and changes nothing. Cancel returns to Studio with the typed text still there. Test in Task 6 and the live check.

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

Electron's own check decides whether a certificate is trusted. The app never asks Node's TLS for that, because the two use different lists of trusted issuers and can disagree. Node's TLS is used for one thing only: reading the fingerprint to show the person.

**Interfaces:**
- Produces:

```ts
/** SHA-256 of the certificate, as 32 upper case hex pairs joined by colons. The same text plan 1
 *  prints on the server. Undefined when the PEM cannot be read. */
export function fingerprintOf(certPem: string): string | undefined;

export interface PinnedServer { host: string; fingerprint: string }

/** The answer for Electron's setCertificateVerifyProc callback. Checked in this order:
 *   1. Chromium trusts the certificate ('net::OK'): 0, whatever is pinned.
 *   2. The host is the pinned host (any letter case) and fingerprintOf(certificate.data) equals the
 *      pinned fingerprint: 0. This overrides every error for that one certificate.
 *   3. Anything else: -2.
 *  Never -3. The app decides every case itself. */
export function verifyDecision(
  request: { hostname: string; verificationResult: string; certificate: { data: string } },
  pinned: PinnedServer | undefined,
): 0 | -2;

export type ServerCertificate = { ok: true; fingerprint: string } | { ok: false };

/** Opens a TLS connection without checking the certificate, reads its fingerprint, and closes.
 *  10 s limit. `{ ok: false }` when nothing answers. Says nothing about trust. */
export function readServerCertificate(host: string, port: number): Promise<ServerCertificate>;
```

Electron gives the check a host name and no port. So a pin covers the host, not one port. That is safe: only the holder of the pinned key can present that certificate, on any port.

`certificate.data` is the certificate as PEM text. Hash that. Do not rely on the format of Electron's own `fingerprint` field.

- [ ] **Step 1: Write the failing tests**

Keep two fixed self-signed test certificates (PEM, with keys) in the test file, `A` and `B`.

```ts
it('gives the same fingerprint as Node for a PEM, and undefined for other text', () => {
  expect(fingerprintOf(A.cert)).toBe(new X509Certificate(A.cert).fingerprint256);
  expect(fingerprintOf('nope')).toBeUndefined();
});
describe('verifyDecision', () => {
  const pin = { host: 'labpc', fingerprint: fingerprintOf(A.cert)! };
  const bad = 'net::ERR_CERT_AUTHORITY_INVALID';
  it('accepts what Chromium trusts, with no pin', ...);                        // net::OK, undefined -> 0
  it('accepts what Chromium trusts even when another certificate is pinned', ...); // net::OK, cert B, pin A -> 0
  it('accepts the pinned host with the pinned certificate', ...);              // bad, cert A -> 0
  it('accepts it whatever the error is', ...);                                 // 'net::ERR_CERT_DATE_INVALID', cert A -> 0
  it('refuses the pinned host with another certificate', ...);                 // bad, cert B -> -2
  it('refuses the pinned certificate on another host', ...);                   // hostname 'other', cert A -> -2
  it('refuses an untrusted certificate when nothing is pinned', ...);          // -> -2
  it('compares the host without regard to case', ...);                         // hostname 'LabPC' -> 0
  it('refuses a certificate it cannot read', ...);                             // data 'nope' -> -2
});
describe('readServerCertificate', () => {
  it('reads the fingerprint of a self-signed server', ...);
  // Start node:https on 127.0.0.1 port 0 with A. Expect { ok: true, fingerprint: fingerprintOf(A.cert) }.
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
- Consumes: `parseServerAddress` (Task 1), `ServerCertificate`, `PinnedServer` (Task 3).
- Produces:

```ts
// controller.ts: Screen gains four members
| { screen: 'choose' }
| { screen: 'connect'; value?: string; problem?: 'empty' | 'not-https' | 'unreadable' | 'no-answer' | 'certificate' }
| { screen: 'certificate'; address: string; fingerprint: string; changed: boolean }
| { screen: 'unreachable'; address: string }

// PageState gains three optional parts. The page draws whatever is present.
detail?: string;                                            // shown in a fixed-width font: the fingerprint
input?: { label: string; value: string; placeholder: string; secret?: boolean };
actions?: Array<{ id: PageAction; label: string; primary?: boolean }>;

export type PageAction =
  | 'choose-local' | 'choose-connect' | 'connect' | 'back' | 'trust' | 'no-trust' | 'retry' | 'change-server'
  | 'pin-submit' | 'pin-cancel';   // the last two are used by Task 6

// remote-controller.ts
export const STUDIO_LOAD_TRIES = 3;

export interface RemoteDeps {
  /** GET <origin>/health through the window's own session, so Electron's certificate check
   *  decides. 'untrusted' when that check refused the certificate. */
  probe(address: string): Promise<'ok' | 'no-answer' | 'untrusted'>;
  readCertificate(host: string, port: number): Promise<ServerCertificate>;
  /** Tells the window's certificate check which host and certificate to accept. */
  pin(server: PinnedServer | undefined): void;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  show(screen: Screen): void;
  sleep(ms: number): Promise<void>;
  exit(code: number): void;
  log(line: string): void;
  strings: AppStrings;
  pollMs?: number;   // default 10_000
}

export class RemoteController {
  constructor(deps: RemoteDeps);
  /** With a saved server: pin, probe, then Studio. Without one: the 'connect' screen. */
  start(): Promise<void>;
  /** The person pressed Connect with this text. */
  connect(input: string): Promise<void>;
  /** The person answered the certificate screen. */
  trust(yes: boolean): Promise<void>;
  /** Forget the server and show the 'connect' screen with the old address filled in. */
  changeServer(): void;
  /** main.ts calls this when Studio's own page failed to load from the server. */
  studioFailed(): Promise<void>;
  retry(): Promise<void>;
  quit(): Promise<void>;                 // exit(0). There is no launcher to stop.
  address(): string | undefined;         // the server's address once Studio is shown
  bridgeAddress(): undefined;            // always
  dataDir(): undefined;                  // always
}
```

**The rule that matters most: once Studio is on screen, the controller never replaces it by itself.** It runs no background check while Studio is shown. Someone may be half way through a result. If the server goes off, Studio's own requests fail and Studio says so, with the typed text still there. The `unreachable` screen comes only at start, or when Studio's own page fails to load.

How `connect(input)` goes:
1. Parse. A refusal shows `connect` again with `problem` and the typed text.
2. An `http` address (only `127.0.0.1` gets this far) has no certificate. Save `{ address }`, pin nothing, probe. `ok` shows Studio. Anything else shows `connect` with `no-answer`. Skip steps 3 to 5.
3. Probe. `ok` means Electron already trusts the certificate: save `{ address }` with no fingerprint and show Studio. `no-answer` shows `connect` with `no-answer`.
4. `untrusted`: read the certificate. `{ ok: false }` shows `connect` with `no-answer`. Otherwise show `certificate` with `changed: false`. On no, show `connect` again and save nothing.
5. On yes: save `{ address, fingerprint }`, pin it, and probe once more. `ok` shows Studio. Anything else shows `connect` with `problem: 'certificate'`. One try. No loop.

How `start()` goes with a saved server:
1. Pin the saved fingerprint when there is one.
2. Probe. `ok` shows Studio. `no-answer` shows `unreachable` and probes again every `pollMs` until it answers, then shows Studio.
3. `untrusted`: read the certificate. A fingerprint that differs from the saved one shows `certificate` with `changed: true`. The saved one is not replaced until the person says yes. The same fingerprint, or none saved, shows `connect` with `problem: 'certificate'` and the address filled in.

How `studioFailed()` goes: show `unreachable`, probe every `pollMs`, and show Studio again on the first `ok`. If Studio then fails again, count it. After `STUDIO_LOAD_TRIES` failures in a row with the server answering, show the existing `error` screen with `studioWillNotLoad` and stop. A Studio page that loads resets the count.

Stale answers: `connect`, `changeServer`, `trust` and `quit` each raise a run counter, as `DesktopController` does. A probe or a wait that started before the latest one changes nothing when it comes back.

`pageState` for the new screens. The English words are below. French and Portuguese go in the same change.

| Screen | Title | Message, detail, input | Actions |
|---|---|---|---|
| `choose` | How will this PC use OpenLDR? | This PC holds the lab's data: OpenLDR and its database run here. Connect to the lab's server: this PC only shows OpenLDR from another PC. | `choose-local` "This PC holds the lab's data", `choose-connect` "Connect to the lab's server" |
| `connect` | Connect to the lab's server | input label "Server address", placeholder `labpc:3443`. Problem lines below. | `connect` "Connect" (primary), `back` "Back" |
| `certificate`, first time | Check the server's certificate | "This is the first time this PC connects to {address}. Compare this fingerprint with the one shown on the server." detail: the fingerprint | `trust` "It matches" (primary), `no-trust` "Cancel" |
| `certificate`, changed | The server's certificate has changed | "The certificate of {address} is not the one this PC accepted before. Compare this fingerprint with the one shown on the server. If you did not expect a change, stop here." detail: the fingerprint | `trust` "It matches", `no-trust` "Cancel" (primary) |
| `unreachable` | Cannot reach the server | "{address} is not answering. OpenLDR will come back by itself when it does." | `retry` "Try again" (primary), `change-server` "Change server" |

Problem lines on `connect`: `empty` "Type the server's address." `not-https` "The address must start with https." `unreadable` "That is not an address OpenLDR can use." `no-answer` "Nothing answered at that address. Check it and that the server is on." `certificate` "The server's certificate could not be accepted. Check the address, or ask whoever looks after the server."

One more string: `studioWillNotLoad` "The server answers, but OpenLDR did not load from it."

`back` is shown on `connect` only when no mode is saved yet. It returns to `choose`.

- [ ] **Step 1: Write the failing tests**

Use fake deps in the style of `apps/desktop/src/controller.test.ts`.

```ts
// remote-controller.test.ts
it('with no saved server, shows the connect screen', ...);
it('shows the problem and keeps the text when the address is refused', ...);      // 'http://labpc' -> problem 'not-https', value 'http://labpc'
it('connects without a question when Electron already trusts the certificate', ...);
// probe 'ok'. Screens: connect -> studio. readCertificate never called. Saved server has no fingerprint.
it('never reads a certificate for the http address on this PC', ...);             // 'http://127.0.0.1:3000' -> readCertificate not called
it('says nothing answered when the probe gets no answer', ...);
it('asks about an untrusted certificate, then saves and pins it on yes', ...);
// probe 'untrusted' then 'ok'. Screens: connect -> certificate(changed false) -> studio. pin called with { host, fingerprint }.
it('goes back to the connect screen on no, and saves nothing', ...);
it('gives up after one refused try and says the certificate could not be accepted', ...);
// probe 'untrusted' twice. Expect the connect screen with problem 'certificate', and probe called exactly twice.
it('with a saved server, pins it and shows Studio', ...);
it('at start, shows the unreachable screen, then Studio once the server answers', ...);   // probe: no-answer, no-answer, ok
it('asks again when the saved certificate no longer matches, and keeps the old one until yes', ...);
// probe 'untrusted', readCertificate gives another fingerprint -> certificate(changed true). Settings unchanged. After trust(true): saved and pinned.
it('does not loop when the saved certificate is refused but has not changed', ...);  // -> connect with problem 'certificate'
it('runs no probe while Studio is shown', ...);
// After Studio is shown, advance the fake clock by 10 poll intervals. Expect no further probe and no screen change.
it('studioFailed shows the unreachable screen and brings Studio back when the server answers', ...);
it('stops after three failed Studio loads in a row while the server answers', ...);
// probe always 'ok', studioFailed called three times. Expect an 'error' screen with studioWillNotLoad.
it('ignores a probe answer that comes back after the server was changed', ...);
it('changeServer forgets the server and fills the old address in', ...);
it('quit exits with 0 and stops any waiting', ...);
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
- Consumes: `RemoteController`, `PageAction` (Task 4), `verifyDecision` (Task 3), `mayGrantPermission` (Task 2).
- Produces:

```ts
// channels.ts
/** The app's own page to main: a button was pressed. Carries { id: PageAction; value?: string }. */
export const ACTION_CHANNEL = 'openldr-desktop:action';

// preload.ts: window.openldrDesktopPage gains
act(id: string, value?: string): void;

// mode.ts
/** What the app does at start. Checked in this order:
 *   1. A saved mode wins.
 *   2. OPENLDR_DESKTOP_SERVER set: 'connect'.
 *   3. Only now is the launcher asked for its data folder. If that folder already holds an install
 *      (its standalone.json exists): 'local'. Otherwise 'ask'.
 *  `dataDir` is called only in step 3, so connect mode never runs the launcher. */
export function startMode(input: {
  saved: 'local' | 'connect' | undefined;
  envServer: string | undefined;
  dataDir(): Promise<string | undefined>;
  exists(path: string): boolean;
}): Promise<'local' | 'connect' | 'ask'>;

/** The running controller, with its mode. Narrow on `mode` before using launcher-only methods. */
export type Running =
  | { mode: 'local'; controller: DesktopController }
  | { mode: 'connect'; controller: RemoteController };
```

What changes in `main.ts`:
- After `whenReady`, call `startMode`. Its `dataDir` reads the launcher's status. In connect mode that never runs.
- `ask` shows the `choose` screen. `choose-local` saves `mode: 'local'` and starts `DesktopController`. `choose-connect` saves `mode: 'connect'` and starts `RemoteController`.
- A silent `local` (an existing install) also saves `mode: 'local'`.
- `OPENLDR_DESKTOP_SERVER` is for development and tests. It skips the choice and is used as the saved server's address. It is never written to the settings file.
- The `controller` variable becomes a `Running | undefined`. `share()`, `restart()` and the setup code are reached only after `mode === 'local'`.
- The check that the launcher is built (`existsSync(target.entry)` at `main.ts:190` and `:362`) runs in local mode only.
- `session.defaultSession.setCertificateVerifyProc` calls `verifyDecision(request, pinned)`. `RemoteDeps.pin` stores the new pin and then sets the check again. Electron keeps old answers of this check, and setting it again is what drops them. Step 1 below proves that before anything else is built.
- Both permission handlers pass `connectMode`.
- `ACTION_CHANNEL` is handled only from the app's own page, by the same check `RETRY_CHANNEL` uses at `main.ts:186`. Each action calls the matching controller method. `retry` keeps working through `RETRY_CHANNEL` too.
- `did-fail-load` for the main frame, in connect mode, on the server's origin: call `controller.studioFailed()`. Ignore code `-3`, as the existing handler does: that is a load another load replaced. Never leave Chromium's error page up.
- `did-finish-load` on the server's origin tells the controller Studio loaded, which resets its failure count.

The page (`page.html`, `page.js`): add a `detail` element, one text input with a label, and a row of buttons. `render(state)` shows each only when its part is present. Enter in the input presses the primary button. The existing `retry` button stays for the error screen.

The tray in connect mode, top to bottom: Open OpenLDR, Start at sign-in, the server's address as a disabled label, Change server..., Use this PC for the lab's data..., Open logs (opens the app's own log folder), separator, Quit. The share items from plan 1 are local mode only. Local mode gains one item: Connect to a lab server...

Switching mode from the tray asks first (Electron `dialog.showMessageBox`), saves the new mode, then restarts the app with `app.relaunch()` and the normal quit path. Local to connect says: "This PC will show OpenLDR from another PC. The data on this PC stays where it is and is not used." Connect to local says: "OpenLDR and its database will run on this PC."

New strings (English): `trayChangeServer` "Change server...", `trayUseLocal` "Use this PC for the lab's data...", `trayUseConnect` "Connect to a lab server...", `switchConfirmYes` "Switch and restart", `switchConfirmNo` "Cancel", and the two messages above as `switchToConnectBody` and `switchToLocalBody`.

The self-check file (`selfcheck.ts`) gains `mode: 'local' | 'connect'` and `childProcesses: number`, the count of processes the app itself started. A test run can then tell which mode the app chose and that connect mode started nothing.

- [ ] **Step 1: Prove the certificate check in a real Electron session**

Before writing the wiring, write a throwaway script in the scratchpad that starts Electron, serves a self-signed HTTPS page on `127.0.0.1`, and does this in one session: fetch with no pin (expect a refusal), set the pin and set the check again, fetch (expect success), swap the server's certificate, fetch (expect a refusal). If the second fetch still fails, Electron kept the old answer. Then find what does drop it (`session.clearAuthCache`, `session.closeAllConnections`, or a fresh partition), and write that into this task before going on. Delete the script. Record the result in the commit message of Step 6.

- [ ] **Step 2: Write the failing tests**

```ts
// mode.test.ts
it('uses the saved mode and never asks the launcher', ...);
// saved 'connect'. Expect 'connect' and the dataDir spy not called. The same for saved 'local'.
it('connects when the test variable names a server, and never asks the launcher', ...);
it('lets a saved mode win over the test variable', ...);
it('stays local without asking the person when the data folder holds an install', ...);
// saved undefined, dataDir gives '/d', exists('/d/standalone.json') true -> 'local'
it('asks on a PC with no install and no saved mode', ...);          // -> 'ask'
it('asks when the data folder is unknown', ...);                    // dataDir gives undefined -> 'ask'

// tray-menu.test.ts
it('in connect mode shows the server and no share items', ...);
it('in local mode offers to connect to a lab server', ...);
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`

- [ ] **Step 4: Write the code**

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @openldr/desktop test` and `pnpm --filter @openldr/desktop typecheck > /tmp/tc-desktop.txt 2>&1; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): choose between holding the data and connecting to a server"
```

---

### Task 6: Lock this PC to OpenLDR

**Files:**
- Create: `apps/desktop/src/lock.ts`
- Modify: `apps/desktop/src/controller.ts` (one screen), `apps/desktop/src/locality.ts` (`linkTarget`), `apps/desktop/src/main.ts`, `apps/desktop/src/tray-menu.ts`, `apps/desktop/src/strings.ts`
- Test: `apps/desktop/src/lock.test.ts`, `apps/desktop/src/locality.test.ts`, `apps/desktop/src/controller.test.ts`, `apps/desktop/src/tray-menu.test.ts`

**Interfaces:**
- Consumes: `Settings.lock`, `PageAction` `pin-submit` and `pin-cancel`, `ACTION_CHANNEL`.
- Produces:

```ts
// lock.ts
export const MIN_PIN_LENGTH = 4;
export const WRONG_PIN_WAIT_MS = 2_000;
/** scrypt, 32 bytes, a fresh 16 byte salt. Both as lower case hex. */
export function makeLock(pin: string): { salt: string; hash: string };
/** Compares with timingSafeEqual. False for a malformed lock. */
export function checkPin(lock: { salt: string; hash: string }, pin: string): boolean;
/** One PIN try at a time. A wrong PIN waits WRONG_PIN_WAIT_MS before it answers.
 *  A try that arrives during that wait gets 'busy' and is not checked. */
export function pinGate(lock: { salt: string; hash: string }, sleep: (ms: number) => Promise<void>): {
  submit(pin: string): Promise<'ok' | 'wrong' | 'busy'>;
};

// controller.ts: Screen gains
| { screen: 'pin'; purpose: 'set' | 'unlock' | 'quit'; wrong?: boolean; tooShort?: boolean }

// locality.ts: linkTarget gains a fourth argument
export function linkTarget(url: string, launcherAddress: string | undefined, ownPages: readonly string[], locked?: boolean): 'inside' | 'browser' | 'refuse';
// With locked true, every result that would be 'browser' is 'refuse'.
```

**The PIN is asked in a small window on top. Studio stays as it is behind it.** The main window is never sent to another page for a PIN, so a half-entered result survives `Ctrl+Shift+L` and Cancel. The small window is a modal child `BrowserWindow` of the main one. It loads the app's own page and shows the `pin` screen. `pin-cancel`, or a PIN that is accepted, closes it.

What the lock does when on:
- The main window is in kiosk mode (`win.setKiosk(true)`), set at start and whenever the lock changes.
- Closing the window does nothing. It is not hidden.
- Links to other sites are dropped (`linkTarget` with `locked`).
- Start at sign-in is turned on.
- The tray shows three items only: Open OpenLDR, Unlock this PC..., Quit. Every other item is hidden: the share switch, change server, switch mode, open logs, and start at sign-in. Each of them leaves the app, changes its server or restarts it.
- Every way to quit asks for the PIN first: the tray, the app menu, and the keyboard. They all pass through `requestQuit` at `main.ts:89`.
- A shutdown or sign-out of the PC still quits without a PIN.
- `Ctrl+Shift+L` in the window (`before-input-event`) asks for the PIN to unlock. The tray may be hidden in kiosk mode, so this is the way in.

Turning the lock on: tray item "Lock this PC to OpenLDR..." asks for a PIN with `purpose: 'set'`. A PIN of 4 or more characters saves `lock` and applies it. A shorter one shows the screen again with `tooShort`.

| Purpose | Title | Message | Actions |
|---|---|---|---|
| `set` | Lock this PC to OpenLDR | "Choose a PIN. Unlocking this PC, or quitting OpenLDR, will ask for it. Press Ctrl+Shift+L to unlock." input label "PIN", secret | `pin-submit` "Lock" (primary), `pin-cancel` "Cancel" |
| `unlock` | Unlock this PC | input label "PIN", secret | `pin-submit` "Unlock" (primary), `pin-cancel` "Cancel" |
| `quit` | Quit OpenLDR | "This PC is locked to OpenLDR. Type the PIN to quit." input label "PIN", secret | `pin-submit` "Quit" (primary), `pin-cancel` "Cancel" |

Extra lines: `wrong` "That PIN is not right." `tooShort` "Use at least 4 characters." New tray strings: `trayLock` "Lock this PC to OpenLDR...", `trayUnlock` "Unlock this PC...".

The PIN is never logged and never sent to the page. Only its salt and hash are stored. This stops a casual user. It does not stop someone who can edit the settings file with the PC account. The guide says so, and says that clearing `lock` from the file is how a forgotten PIN is recovered.

- [ ] **Step 1: Write the failing tests**

```ts
// lock.test.ts
it('accepts the PIN it was made with and refuses another', ...);
it('gives a different salt and hash each time', ...);
it('refuses a malformed lock', ...);           // checkPin({ salt: 'zz', hash: '' }, '1234') is false
it('waits two seconds before it answers a wrong PIN', ...);
// With a fake sleep: submit('0000') does not resolve until sleep(2000) is released, then gives 'wrong'.
it('does not check a second PIN during that wait', ...);
// submit('0000'), then submit('1234') with the right PIN before the release. Expect 'busy' for the second.
it('answers the right PIN at once', ...);

// locality.test.ts
it('drops links to other sites when locked', () => {
  expect(linkTarget('https://example.org/', 'https://labpc:3443/studio/', [], true)).toBe('refuse');
  expect(linkTarget('https://labpc:3443/studio/x', 'https://labpc:3443/studio/', [], true)).toBe('inside');
});

// controller.test.ts
it('gives the pin screen its words for each purpose, and the wrong and too short lines', ...);

// tray-menu.test.ts
it('when locked, shows only Open, Unlock and Quit', ...);
// In both modes, with sharing running. Expect exactly three items plus the separator.
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
- Modify: `apps/studio/src/docs/0.1.8/en/share-on-network.md` (made by plan 1), and the same page in `fr` and `pt`

The operator decided on 2026-11-27 that these features get in-app guidance too. Plan 1 made the in-app page "Open OpenLDR from another PC". This plan adds to it.

- [ ] **Step 1: Write `lab-setups.md`**

This is the "which setup" guide (gap G13). Take the four setups from the spec's "The setups" section: spoke, two-PC lab, hub, analyser PC. For each: what to install on each PC, where the users are made, and what happens when the network is down. Lead with the rule: one full install per site, every other PC is a screen onto it. Link to the desktop app page and the standalone page for the steps.

- [ ] **Step 2: Add two sections to `desktop-app.md`**

"Connect to the lab's server": the first-start choice, the address, the certificate check with the fingerprint, the unreachable screen, and how to change server. "Lock this PC to OpenLDR": the PIN, `Ctrl+Shift+L`, what the lock does not stop, how to set the app as the kiosk program on Windows (assigned access), and how to recover a forgotten PIN.

- [ ] **Step 2b: Add two tasks to the in-app page**

"Use the OpenLDR app on another PC": choose "Connect to the lab's server", type the address, compare the fingerprint. "Lock a PC to OpenLDR": the tray item, the PIN, `Ctrl+Shift+L`. Keep both short and link to the web page.

- [ ] **Step 3: Translate to fr and pt, and run `unslop` over all nine files**

- [ ] **Step 4: Run the web tests**

Run: `pnpm --filter @openldr/web test` and `pnpm --filter @openldr/studio exec vitest run src/docs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/docs apps/studio/src/docs
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
- A lab-bench packet export saves a file, and the file opens again. Install lab-bench from the marketplace for this.
- A lab-bench report print opens the print preview. Cancel it.
- The self-check file says `"mode": "connect"` and `"childProcesses": 0`. Also list the app's child processes with `ps --ppid <app pid>` and check none is a launcher or Postgres.

- [ ] **Step 4: Stop the server and watch the app**

Type into a form field in Studio and do not save. Stop the install from Step 2. Expected: Studio stays on screen with the typed text. Reload the window. Expected: "Cannot reach the server". Start the install again. Expected: Studio comes back by itself within 10 seconds.

- [ ] **Step 5: Change the certificate and watch the app**

Stop the install, delete `/tmp/openldr-connect-check/share/`, and start it again. Expected: the app shows "The server's certificate has changed" with the new fingerprint, and does not load Studio until "It matches".

- [ ] **Step 6: Check the lock**

Turn the lock on from the tray with PIN `1234`. Expected: the window fills the screen, closing it does nothing, a link to another site does nothing, and the tray shows only Open, Unlock and Quit.

Type into a form field and do not save. Press `Ctrl+Shift+L`, then Cancel. Expected: the typed text is still there. Press it again: a wrong PIN is refused, the right one unlocks.

While locked, repeat the lab-bench export and the print preview from Step 3. Then try each way to quit: the tray, the app menu and the keyboard. Expected: each asks for the PIN.

- [ ] **Step 7: Stop everything and write down what was not shown**

In the hand-over, write **HONEST NON-PROOF** for each of these:
- A hub that signs in through Keycloak. This check used a local-sign-in install. A server edition with Keycloak needs its own run.
- Windows and macOS. Only the Linux app was run.
- Kiosk mode against a determined user. The app cannot block the operating system's own keys.
- A real second PC. Both ends ran on one machine here.
- Printing and saving in the packaged app. This run used the development build.

- [ ] **Step 8: After the merge to `main`, update the changelog**

Merging is the operator's call. Once merged, run `pnpm make:changelog` on `main` and commit `apps/web/src/landing/changelog.json`.
