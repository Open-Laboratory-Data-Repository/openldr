# Serial ports for plugin pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plugin page that was granted `host:serial` can open, read and write a serial port on the PC it runs on, as raw bytes.

**Architecture:** Studio's own page holds the port, through the browser's Web Serial feature. A plugin page asks for it over the bridge it already uses for files and printing. Those requests are answered in Studio and never reach the server. The desktop app learns to grant the serial permission to its one trusted window and to show a list of ports.

**Tech Stack:** TypeScript, React with shadcn, vitest, Web Serial (`navigator.serial`), Electron 45 (`select-serial-port`, permission handlers). No new package and no native code.

**Spec:** `docs/superpowers/specs/2026-11-27-plugin-serial-ports-design.md`. It closes gap G7 of `2026-11-27-lab-deployment-setups-design.md`.

**Order.** Tasks 1 to 6 need no other plan. They make serial work in Chrome and Edge. Task 7, the desktop app, needs plan 2 built first (`2026-11-27-desktop-connect-mode-and-lock.md`): it reuses that plan's small window and its page actions. If plan 2 is not built, stop after Task 6 and say so.

## Global Constraints

- The capability is `host:serial`. No parameters.
- Six calls: `serial.ports()`, `serial.choose()`, `serial.open()`, `serial.read()`, `serial.write()`, `serial.close()`.
- Serial requests are answered in Studio's own page. They never reach the server. Serial bytes may hold patient results.
- Until Studio knows the plugin's grant, every call is refused.
- `serial.choose()` always shows Studio's own prompt first, naming the plugin from Studio's own data. Never from the plugin's page.
- A port is chosen by a person every time. Nothing picks a port by itself, in Studio or in the app.
- A port is not remembered across a reload or a restart. The app may mark the port used last time. The person still chooses.
- A port is known to a plugin page by a handle Studio makes up for that one page. A handle from another page is refused.
- The limits:

  | Limit | Value |
  |---|---|
  | Open ports for one plugin page | 2 |
  | Bytes one read returns | 65,536 |
  | Bytes waiting to be read, per port | 1,048,576 |
  | Bytes one write takes | 65,536 |
  | Bytes waiting to be sent, per port | 1,048,576 |
  | Longest wait for one read | 30,000 ms |
  | Speed | a whole number from 300 to 921,600 |

- No control lines: no DTR, no RTS, no break.
- No analyser protocol in core (AGENTS.md §8). Nothing here names ASTM, HL7 or any analyser.
- Studio follows AGENTS.md §5. The prompt is a confirm `Dialog`, which is one of the cases a dialog is for.
- Short plain sentences in every doc, string and commit message. No em dashes. Run the `unslop` skill over them.
- No `Co-Authored-By` trailer on any commit (AGENTS.md §9).
- Docs land in en, fr and pt.
- Test gate: `pnpm turbo run test --force --concurrency=2 --continue` and `pnpm turbo run typecheck --force --concurrency=2`. Never pipe turbo through `tail`. Never read `$?` through a pipe.

## Review Focus

1. **The cable is pulled out while a read waits.** Expected: the read ends with a plain refusal, the handle is dead, nothing hangs. Test in Task 4.
2. **The plugin reads too slowly.** Expected: the next read says bytes were lost, once, before any more bytes. Test in Task 4.
3. **The grant goes away while a port is open** (the plugin is turned off or upgraded, or the person signs out). Expected: the port closes and later calls are refused. Test in Task 5.
4. **Two plugin pages are open** (a page and a dashboard card, or two plugins). Expected: a handle from one is refused in the other, and one physical port cannot be open twice. Test in Task 4.
5. **The browser has no serial feature**, or the page is on plain HTTP at an address that is not this PC. Expected: a plain refusal, no crash, no prompt. Test in Task 4.

---

### Task 1: Prove the port list opens in Electron

The design leaves two things unproven. Check them before building, because a failure changes the design.

- [ ] **Step 1: Write a throwaway Electron script in the scratchpad**

It opens one window on a page with a button. The button's click calls `navigator.serial.requestPort()`. The main process handles `select-serial-port` on the window's session: it logs the list and calls back with an empty string, which cancels. It also sets a permission check handler that returns true for `serial`.

Run it twice: once with the page served from `http://127.0.0.1:<port>`, once from an `https` address with a self-signed certificate the script accepts.

- [ ] **Step 2: Record the result**

Expected: in both runs `navigator.serial` exists, `select-serial-port` fires with the PC's ports (the list may be empty), and `requestPort()` then rejects because the choice was cancelled.

Write the result into the spec's "Shown and not shown" part: the Electron version, both addresses, and what happened.

If `navigator.serial` is missing or `select-serial-port` never fires, stop and report. The spec says the port must then be held by the app's main process, which is a different design.

- [ ] **Step 3: Delete the script and commit the spec note**

```bash
git add docs/superpowers/specs/2026-11-27-plugin-serial-ports-design.md
git commit -m "docs: record the Electron serial check"
```

---

### Task 2: The capability and what the server tells Studio

**Files:**
- Modify: `packages/marketplace/src/capabilities.ts:19-31` (one more entry)
- Modify: every place that lists the host capabilities by name. Find them with `grep -rn "host:ce-read" packages apps --include=*.ts --include=*.tsx`
- Modify: `apps/server/src/plugin-ui-routes.ts:34-78` (the `/api/plugins/ui` listing)
- Modify: `apps/studio/src/api.ts` (the type of one listing entry)
- Test: `packages/marketplace/src/capabilities.test.ts`, `apps/server/src/plugin-ui-routes.test.ts`

**Interfaces:**
- Produces:

```ts
// capabilities.ts
// host:serial: a plugin page may ask the studio for a serial port on the PC it runs on.
// Enforced in the studio, not the broker: serial requests never reach the server.
z.object({ kind: z.literal('host:serial') }),

// One entry of GET /api/plugins/ui gains:
devices: { serial: boolean };
// true only when the plugin's ACTIVE version was granted host:serial.
```

The grant is the one the broker computes for the active version (`packages/bootstrap/src/plugin-broker.ts`, near line 523, where `grant.capabilities` is read). Use the same function. If that logic is inline in the broker, move it into one exported function and call it from both places. Do not write a second reading of the manifest.

- [ ] **Step 1: Write the failing tests**

```ts
// capabilities.test.ts
it('accepts host:serial with no parameters', ...);

// plugin-ui-routes.test.ts
it('says serial is true for a plugin granted host:serial', ...);
it('says serial is false for a plugin without it', ...);
it('reads the active version, not an older one that had the grant', ...);
// Two versions installed. The older one declares host:serial, the active one does not. Expect false.
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/marketplace test` and `pnpm --filter @openldr/server exec vitest run src/plugin-ui-routes.test.ts`

- [ ] **Step 3: Write the code**

Where the install screen shows a line for each capability a plugin asks for, add the line for this one, in en, fr and pt: "Use a serial port on the PC, when a person chooses one."

- [ ] **Step 4: Run them and see them pass**

- [ ] **Step 5: Commit**

```bash
git add packages/marketplace packages/bootstrap apps/server apps/studio
git commit -m "feat(plugins): a capability for serial ports, and the studio is told who holds it"
```

---

### Task 3: The calls in the plugin page SDK

**Files:**
- Modify: `packages/plugin-ui-sdk/src/types.ts:71-77` (`PluginHostOp`) and the `OpenLdrPluginApi` interface at line 217
- Create: `packages/plugin-ui-sdk/src/serial.ts`
- Modify: `packages/plugin-ui-sdk/src/bootstrap.ts:145-153` (beside `files` and `print`)
- Modify: `packages/plugin-ui-sdk/src/mock.ts`, `packages/plugin-ui-sdk/src/index.ts`
- Test: `packages/plugin-ui-sdk/src/serial.test.ts`, `bootstrap.test.ts`, `mock.test.ts`

**Interfaces:**
- Produces:

```ts
// serial.ts
export const SERIAL_MAX_OPEN = 2;
export const SERIAL_READ_MAX = 65_536;
export const SERIAL_BUFFER_MAX = 1_048_576;
export const SERIAL_WRITE_MAX = 65_536;
export const SERIAL_WRITE_QUEUE_MAX = 1_048_576;
export const SERIAL_WAIT_MAX_MS = 30_000;

export interface PluginSerialSettings {
  baudRate: number;                         // a whole number from 300 to 921600
  dataBits?: 7 | 8;                         // default 8
  stopBits?: 1 | 2;                         // default 1
  parity?: 'none' | 'even' | 'odd';         // default 'none'
  flowControl?: 'none' | 'hardware';        // default 'none'
}
export interface PluginSerialPort { port: string; label: string }
export interface PluginSerialRead { bytes: Uint8Array; lost: boolean }

/** Why the studio refused. The text of `error` in the bridge's answer. */
export type PluginSerialRefusal =
  | 'serial-not-granted' | 'serial-unavailable' | 'serial-cancelled' | 'serial-unknown-port'
  | 'serial-busy' | 'serial-too-many' | 'serial-too-large' | 'serial-bad-settings' | 'serial-closed';

/** Null when the settings are sound, else 'serial-bad-settings'. */
export function checkSerialSettings(s: unknown): null | 'serial-bad-settings';
/** Null when `bytes` is a Uint8Array of 1 to SERIAL_WRITE_MAX bytes, else 'serial-too-large'. */
export function checkSerialWrite(bytes: unknown): null | 'serial-too-large';
/** A wait as the studio will use it: a whole number from 0 to SERIAL_WAIT_MAX_MS. Other values are clamped. */
export function clampSerialWait(ms: unknown): number;

// types.ts: PluginHostOp gains
| { kind: 'host.serial.ports' }
| { kind: 'host.serial.choose' }
| { kind: 'host.serial.open'; port: string; settings: PluginSerialSettings }
| { kind: 'host.serial.read'; port: string; waitMs: number }
| { kind: 'host.serial.write'; port: string; bytes: Uint8Array }
| { kind: 'host.serial.close'; port: string }

// OpenLdrPluginApi gains
serial: {
  ports(): Promise<PluginSerialPort[]>;
  /** Resolves with the chosen port, or null when the person cancelled. */
  choose(): Promise<PluginSerialPort | null>;
  open(port: string, settings: PluginSerialSettings): Promise<void>;
  read(port: string, waitMs?: number): Promise<PluginSerialRead>;
  write(port: string, bytes: Uint8Array): Promise<void>;
  close(port: string): Promise<void>;
};
```

Rules:
- Bytes cross the bridge as `Uint8Array`. The bridge already uses a `MessagePort`, which carries them as they are.
- `choose()` turns the refusal `serial-cancelled` into `null`. Every other refusal rejects with an `Error` whose message is the refusal code.
- `read()` with no wait uses 0: it returns what is there now.
- The mock in `mock.ts` gets a `serial` that refuses every call with `serial-unavailable`, so a plugin's own tests can run.

- [ ] **Step 1: Write the failing tests**

```ts
// serial.test.ts
it.each([299, 921601, 9600.5, '9600', NaN])('refuses the speed %j', ...);
it('accepts 9600 with no other field, and a full set of fields', ...);
it.each([{ dataBits: 6 }, { stopBits: 3 }, { parity: 'mark' }, { flowControl: 'xon' }])('refuses %j', ...);
it('refuses a write that is not bytes, is empty, or is over the limit', ...);
it('accepts a write of exactly 65536 bytes', ...);
it('clamps a wait to 0..30000 and turns a bad value into 0', ...);

// bootstrap.test.ts
it('sends each serial call as its host op', ...);              // one assertion per call, on the posted op
it('gives null when the person cancelled the choice', ...);
it('rejects with the refusal code for any other refusal', ...);
it('passes read bytes through as a Uint8Array', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/plugin-ui-sdk test`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run them and see them pass**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-ui-sdk/src
git commit -m "feat(plugin-ui-sdk): six serial calls for a plugin page"
```

---

### Task 4: The serial gate in Studio

**Files:**
- Create: `apps/studio/src/plugins/serial-gate.ts`
- Test: `apps/studio/src/plugins/serial-gate.test.ts`

This is the part that holds the port and enforces every limit. It follows `createPrintGate` in `apps/studio/src/plugins/print-frame.ts`: one gate per mounted plugin frame, and it never throws.

**Interfaces:**
- Consumes: the op types and the checks from Task 3.
- Produces:

```ts
/** The part of navigator.serial the gate uses. A test passes a fake. */
export interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  addEventListener(type: 'disconnect', listener: (ev: { target: unknown }) => void): void;
  removeEventListener(type: 'disconnect', listener: (ev: { target: unknown }) => void): void;
}
export interface SerialPortLike {
  open(options: { baudRate: number; dataBits: number; stopBits: number; parity: string; flowControl: string; bufferSize: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

export interface SerialGateDeps {
  /** navigator.serial, or undefined when the browser has none or the page is not a secure context. */
  serial: SerialLike | undefined;
  /** true or false once the studio knows the plugin's grant. undefined while it does not. */
  granted(): boolean | undefined;
  /** The studio's own prompt. Resolves true when the person pressed "Choose port". */
  confirm(): Promise<boolean>;
  /** Ports open in any other gate on this page, so one physical port is not opened twice. */
  openElsewhere(port: SerialPortLike): boolean;
}

export interface SerialGate {
  /** Answers one serial op. Never throws. */
  handle(op: PluginHostOp): Promise<PluginRpcResult>;
  /** Closes every port and kills every handle. Called when the frame goes away or the grant does. */
  closeAll(): Promise<void>;
  /** The ports this gate holds open. */
  open(): readonly SerialPortLike[];
}

export function createSerialGate(deps: SerialGateDeps): SerialGate;
```

Rules, checked in this order for every op:
1. `granted()` is not `true`: refuse `serial-not-granted`. This covers "not yet known".
2. `serial` is undefined: refuse `serial-unavailable`.
3. Then by op:

| Op | What happens |
|---|---|
| `ports` | The handles this gate made, each with its label |
| `choose` | `confirm()`. False gives `serial-cancelled`. True calls `requestPort()` at once, with no other wait in between. A rejection there gives `serial-cancelled`. A new port gets a new handle. A port this gate already holds gets its old handle back |
| `open` | Unknown handle: `serial-unknown-port`. Bad settings: `serial-bad-settings`. Already open here or elsewhere: `serial-busy`. Two already open: `serial-too-many`. Then open it and start reading into the buffer |
| `read` | Unknown handle or not open: `serial-unknown-port`. A read already waiting on this port: `serial-busy`. Otherwise return up to 65,536 bytes. With none waiting, wait up to the clamped time for the first one |
| `write` | Unknown handle or not open: `serial-unknown-port`. Bad bytes, or the send queue would pass 1,048,576: `serial-too-large`. Otherwise queue it. Writes go out in order. The answer comes when the bytes were handed to the port |
| `close` | Unknown handle: `serial-unknown-port`. Otherwise stop reading, release the locks, close the port. The handle stays known and can be opened again |

- A handle is 16 random hex characters. A label is `Serial port` plus the maker and product numbers in hex when the port gives them, such as `Serial port 0403:6001`.
- **Losing bytes.** When the bytes waiting to be read reach 1,048,576, new bytes are dropped and a flag is set. The next read answers `{ bytes: <empty>, lost: true }` and clears the flag. The read after that returns bytes again. A loss is reported exactly once, and before any more bytes.
- **A pulled cable or a port error.** The gate hears `disconnect` on `serial`, and errors from the reading loop. A waiting read ends with `serial-closed`. Queued writes fail with `serial-closed`. The handle is forgotten: later calls give `serial-unknown-port`.
- `closeAll()` does the same for every port and removes the `disconnect` listener.

- [ ] **Step 1: Write the failing tests**

Build a fake `SerialLike` whose port has a controllable `readable` and a recording `writable`.

```ts
it('refuses every op until the grant is known, and when it is false', ...);          // one case per op
it('refuses every op when the browser has no serial feature, and shows no prompt', ...);
it('asks with the studio prompt before the port list', ...);                          // confirm called before requestPort
it('gives serial-cancelled when the prompt is refused, and never asks the browser', ...);
it('gives serial-cancelled when the person closes the port list', ...);
it('returns the same handle when the same port is chosen twice', ...);
it('lists only its own handles', ...);
it('refuses a handle it did not make', ...);
it('opens with the defaults filled in', ...);                                          // { baudRate: 9600 } -> 8, 1, none, none
it('refuses bad settings without touching the port', ...);
it('refuses a third open port', ...);
it('refuses a port that is open in another gate', ...);                                // openElsewhere true -> serial-busy
it('returns bytes that arrived, in order, at most 65536 at a time', ...);
it('waits for the first byte, then returns', ...);
it('returns empty when the wait ends with nothing', ...);
it('refuses a second read while one waits', ...);
it('reports lost bytes once, before any more bytes', ...);
// Push 1,048,576 bytes plus 10. Expect: reads drain the buffer, then one { bytes: empty, lost: true }, then new bytes read normally.
it('sends writes in order', ...);
it('refuses a write that would pass the send queue limit', ...);
it('ends a waiting read with serial-closed when the cable is pulled', ...);
it('forgets the handle after a disconnect', ...);
it('fails queued writes with serial-closed on a disconnect', ...);
it('can open a port again after closing it', ...);
it('closeAll closes every port and removes its listener', ...);
it('never throws, whatever the fake port does', ...);                                  // open rejects, close rejects, reader throws
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/plugins/serial-gate.test.ts`

- [ ] **Step 3: Write the gate**

- [ ] **Step 4: Run them and see them pass**

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/plugins/serial-gate.ts apps/studio/src/plugins/serial-gate.test.ts
git commit -m "feat(studio): a gate that holds a serial port for one plugin page"
```

---

### Task 5: The bridge, the frame and the prompt

**Files:**
- Modify: `apps/studio/src/plugins/host-bridge.ts:104-135` (`wireHostPort`) and `HostBridgeDeps` at line 11
- Modify: `apps/studio/src/plugins/PluginFrame.tsx:46-100`
- Modify: `apps/studio/src/plugins/PluginContainer.tsx:51`, `PluginPanelHost.tsx:40`, `PluginWidgets.tsx:34` (each passes the entry's `devices.serial` and its `nav.label` to the frame)
- Create: `apps/studio/src/plugins/SerialPrompt.tsx`
- Create: `apps/studio/src/plugins/serial-registry.ts`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/plugins/host-bridge.test.ts`, `PluginFrame.test.tsx`, `SerialPrompt.test.tsx`, `serial-registry.test.ts`

**Interfaces:**
- Consumes: `createSerialGate` (Task 4), `devices.serial` (Task 2).
- Produces:

```ts
// host-bridge.ts: HostBridgeDeps gains
serial?: SerialGate;
// In wireHostPort, an op whose kind starts with 'host.serial.' goes to deps.serial.handle(op).
// With no deps.serial, it is refused with 'serial-unavailable'.

// PluginFrame props gain
serialGranted: boolean | undefined;   // from the listing entry. undefined while the listing loads.
pluginLabel: string;                  // the entry's nav.label, from the server's listing

// serial-registry.ts: the ports open anywhere on this studio page
export function registerOpenPorts(source: () => readonly SerialPortLike[]): () => void;   // returns the remove function
export function isOpenElsewhere(port: SerialPortLike, self: () => readonly SerialPortLike[]): boolean;
```

Rules:
- `PluginFrame` makes one serial gate per mounted frame and keeps it across the frame's reloads, as it does the download and print gates (lines 54 to 58 and 98 to 100).
- `granted()` reads the current `serialGranted` prop, so a change takes effect on the next call.
- When `serialGranted` changes from true to anything else, the frame calls `closeAll()`.
- When the frame unmounts, it calls `closeAll()`. Signing out unmounts every frame.
- An upgrade or turning the plugin off changes the listing. The frame then gets a new `serialGranted` or unmounts. Either way the ports close.
- The prompt is one `Dialog`, drawn by the frame. Title: "{plugin} wants to use a serial port". Body: "Choose the port the cable is plugged into. {plugin} can then read and write it until this page closes." Buttons: "Choose port" and "Cancel". `{plugin}` is `pluginLabel`. Nothing the plugin's page sent is shown.
- `confirm()` opens that dialog and resolves when a button is pressed or the dialog is closed.
- The plugin label is plain text. It is never read as markup.

- [ ] **Step 1: Write the failing tests**

```ts
// host-bridge.test.ts
it('sends a host.serial op to the serial gate and posts its answer', ...);
it('refuses a host.serial op with serial-unavailable when there is no gate', ...);
it('never sends a host.serial op to the server', ...);                 // deps.call not called

// PluginFrame.test.tsx
it('refuses serial calls while the grant is not known', ...);          // serialGranted undefined
it('closes the ports when the grant is taken away', ...);              // rerender with serialGranted false
it('closes the ports when the frame unmounts', ...);
it('keeps the gate across a reload of the frame', ...);

// SerialPrompt.test.tsx
it('names the plugin from the label it was given', ...);
it('resolves true on Choose port and false on Cancel and on close', ...);
it('shows a label with markup in it as plain text', ...);              // label '<b>x</b>' appears literally

// serial-registry.test.ts
it('says a port is open elsewhere only when another source holds it', ...);
it('forgets a source when it is removed', ...);
```

`apps/studio/src/i18n/parity.test.ts` already fails when a key is missing in fr or pt. Run it.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/studio exec vitest run src/plugins src/i18n`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run the tests and the typecheck**

Run the command from Step 2, then `pnpm --filter @openldr/studio typecheck > /tmp/tc-studio.txt 2>&1; echo "exit=$?"`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): plugin pages can ask for a serial port"
```

---

### Task 6: Try it in Chrome with a test plugin

There is no real analyser plugin page yet. Make a throwaway one.

- [ ] **Step 1: Build a test plugin with a page of six buttons**

One button per call: ports, choose, open at 9600, read, write the bytes `01 02 03`, close. A text box shows each answer. Its manifest declares `host:serial`. Build and sign it with the dev tooling in `/home/fredrick/Projects/Repositories/openldr-ce-dev-plugin-checks`, and install it through the dev registry folder and `POST /api/marketplace/install`. Do not start, stop or restart the dev stack. This is CE branch code, so it needs its own install: tell the operator before starting one.

- [ ] **Step 2: Walk through it in Chrome**

See what serial devices the PC has: `ls /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null`. A virtual pair made with `socat` does not show in the browser's list. Only real serial devices do.

Check, with a screenshot of each:
- Before choosing, `ports` answers an empty list.
- `choose` shows Studio's prompt with the test plugin's name, then the browser's port list.
- Cancel in the prompt, and cancel in the list, each give `null`.
- A second plugin without `host:serial` gets `serial-not-granted` from every call.
- Turning the test plugin off while a port is open closes the port.

With a USB serial adapter whose send and receive pins are joined, also check: open, write three bytes, read the same three bytes back. Then pull the adapter out during a waiting read and see `serial-closed`.

- [ ] **Step 3: Write down what the PC could show**

No adapter means the open, read, write and unplug checks were not run. Say so as **HONEST NON-PROOF**. Remove the test plugin and its registry entry.

No commit. Nothing in the repo changes in this task.

---

### Task 7: The desktop app

Needs plan 2 built. It uses plan 2's page parts (`PageState.actions`, `ACTION_CHANNEL`), its small child window from the lock task, and `isTrustedAddress` from its Task 2.

**Files:**
- Create: `apps/desktop/src/serial.ts`
- Modify: `apps/desktop/src/locality.ts` (`mayGrantPermission`)
- Modify: `apps/desktop/src/main.ts` (the permission handlers near line 202, and three new session handlers)
- Modify: `apps/desktop/src/controller.ts` (one screen), `apps/desktop/pages/page.html`, `page.js`, `page.css` (a list of choices)
- Modify: `apps/desktop/src/settings.ts`, `apps/desktop/src/strings.ts`
- Test: `apps/desktop/src/serial.test.ts`, `locality.test.ts`, `controller.test.ts`, `settings.test.ts`

**Interfaces:**
- Produces:

```ts
// settings.ts: Settings gains
lastSerialPort?: { portName: string };          // only used to mark a row. Never to pick one.

// locality.ts: mayGrantPermission also grants 'serial'
// to the shown address's own origin, when isTrustedAddress(shownAddress, connectMode) is true.
// Every other permission and every other origin is refused as before.

// serial.ts
export interface PortChoice { id: string; label: string; last: boolean }

/** The rows of the port window. `label` is the port name and its display name, such as
 *  'COM3    USB Serial Port'. `last` marks the port used last time, when it is in the list. */
export function portChoices(
  ports: ReadonlyArray<{ portId: string; portName: string; displayName?: string }>,
  lastPortName: string | undefined,
): PortChoice[];

/** Whether a request for the port list may be shown at all. True only when it comes from the
 *  main window's main frame, on the trusted address's own origin. */
export function maySelectPort(input: {
  isMainWindow: boolean; isMainFrame: boolean; frameUrl: string; shownAddress: string | undefined; connectMode: boolean;
}): boolean;

/** One port choice in flight. Only one at a time. */
export interface PortSelection {
  /** Starts a choice. A second one while the first is open is cancelled at once. */
  begin(ports: PortChoice[], answer: (portId: string) => void): void;
  /** The list changed while the window is open. */
  update(ports: PortChoice[]): void;
  /** The person chose a row. Answers with its id and closes. An unknown id cancels. */
  choose(id: string): void;
  /** Cancel, the window closing, a navigation, or the main window going away. Answers ''. */
  cancel(): void;
  active(): boolean;
}
export function createPortSelection(show: (ports: PortChoice[] | undefined) => void): PortSelection;

// controller.ts: Screen gains
| { screen: 'serial'; ports: PortChoice[] }
// PageState gains
choices?: Array<{ id: string; label: string; note?: string; selected: boolean }>;
// PageAction gains 'serial-use' and 'serial-cancel'
```

What `main.ts` does:
- `session.on('select-serial-port', (event, portList, webContents, callback) => ...)`: call `event.preventDefault()`. If `maySelectPort` is false, call `callback('')`. Otherwise `selection.begin(portChoices(portList, settings.lastSerialPort?.portName), callback)`.
- `serial-port-added` and `serial-port-removed`: while a choice is open, `selection.update(...)` with the new list.
- The port window is the small child window plan 2 made for the PIN. It loads the app's own page and shows the `serial` screen. Studio stays as it is behind it.
- `serial-use` with a row's id calls `selection.choose(id)` and saves that row's port name as `lastSerialPort`. `serial-cancel`, closing the window, a navigation of the main window, and the main window closing all call `selection.cancel()`.
- Never call `callback` with a port the person did not press. Not even when the list has one row.
- `setDevicePermissionHandler`: return true only for `deviceType === 'serial'` from the trusted address's own origin. It is what lets the page keep using a port it was just given.
- Both existing permission handlers already go through `mayGrantPermission`.

The `serial` screen:

| Part | Words |
|---|---|
| Title | Choose a serial port |
| With ports | One row per port. The row used last time is selected and has the note "used last time". With no last port, no row is selected and "Use this port" is off until one is |
| With none | "No serial port was found. Plug the cable in and try again." The list fills in by itself when a cable is plugged in |
| Actions | `serial-use` "Use this port" (primary), `serial-cancel` "Cancel" |

The spec's sketch names the plugin in this window's title. The app cannot know the plugin's name: the request reaches it from the browser with no plugin attached. Studio's own prompt named the plugin one press earlier. So this window's title has no plugin name.

- [ ] **Step 1: Write the failing tests**

```ts
// serial.test.ts
it('labels each port with its name and display name', ...);
it('marks the port used last time, and none when it is not in the list', ...);
it('allows a request only from the main window, the main frame and the trusted origin', ...);
// One false case each: another window, a sub frame, another origin, a plain http server in connect mode.
it('answers with the chosen id and stops being active', ...);
it('answers empty on cancel', ...);
it('answers empty for an id that is not in the list', ...);
it('cancels a second choice that begins while one is open', ...);
it('updates the rows while open and ignores an update when not', ...);
it('never answers twice', ...);                                    // choose then cancel -> one answer

// locality.test.ts
it('grants serial to the trusted address and to nothing else', ...);
it('still refuses every other device permission', ...);            // 'usb', 'hid', 'bluetooth', 'media'

// controller.test.ts
it('gives the serial screen its rows, its note and its actions', ...);
it('turns Use this port off when no row is selected', ...);

// settings.test.ts
it('keeps a well formed lastSerialPort and drops a malformed one', ...);
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @openldr/desktop test`

- [ ] **Step 3: Write the code**

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm --filter @openldr/desktop test` and `pnpm --filter @openldr/desktop typecheck > /tmp/tc-desktop.txt 2>&1; echo "exit=$?"`

- [ ] **Step 5: Walk through it in the app**

Start the app from the worktree with the test plugin of Task 6 installed. Check, with a screenshot of each: the prompt, then the port window, a cancel in each, the "used last time" mark on the second visit, and a port plugged in while the window is open appearing in the list. Then the same in connect mode against a shared install.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): the app shows a list of serial ports for a plugin page"
```

---

### Task 8: Docs

**Files:**
- Modify: `apps/web/src/docs/0.1.8/en/plugin-host-functions.md`, `plugin-permissions.md`, `desktop-app.md`, and the same three pages in `fr` and `pt`

No Studio screen is added, so there is no in-app guide. CLI parity does not apply: a serial port is on the PC where a person sits.

- [ ] **Step 1: The plugin author pages**

`plugin-permissions.md`: the `host:serial` capability and what the administrator sees at install. `plugin-host-functions.md`: the six calls, the settings, the limits table, every refusal code, and one short example that opens a port and reads it in a loop. Say plainly what a plugin must handle: a cancelled choice, a dropped link, lost bytes, and choosing the port again after a reload.

- [ ] **Step 2: The desktop app page**

The prompt, the port window, that the port is chosen again after a restart, and what closes the link. On Linux, the PC user must be allowed to use serial devices, usually by being in the `dialout` group.

- [ ] **Step 3: Translate to fr and pt, and run `unslop` over all nine files**

- [ ] **Step 4: Run the web tests**

Run: `pnpm --filter @openldr/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/docs
git commit -m "docs: serial ports for plugin pages"
```

---

### Task 9: The gate and the hand-over

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run test --force --concurrency=2 --continue > /tmp/gate-test.txt 2>&1; echo "exit=$?"
pnpm turbo run typecheck --force --concurrency=2 > /tmp/gate-tc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0` twice. On a failure, grep for `Test timed out`, `out of memory` and `VirtualAlloc` before reading it as a regression.

- [ ] **Step 2: Write down what was not shown**

In the hand-over, write **HONEST NON-PROOF** for each of these that applies:
- A real cable at real speeds, 9600 to 115200, with no byte lost. Needs a USB serial adapter with its pins joined.
- A real analyser: its timing, and what it does when nobody answers.
- Sleep and wake, and a reload, while a message is half read.
- Edge. Only Chrome was run.
- The packaged desktop app, Windows and macOS. Port names and permissions differ there.
- The desktop app, if plan 2 was not built and Task 7 was skipped.

- [ ] **Step 3: After the merge to `main`, update the changelog**

Merging is the operator's call. Once merged, run `pnpm make:changelog` on `main` and commit `apps/web/src/landing/changelog.json`.
