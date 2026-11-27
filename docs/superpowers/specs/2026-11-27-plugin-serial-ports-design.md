# Serial ports for plugin pages

Date: 2026-11-27. Design only. Nothing here is built. Not yet approved.

This closes gap G7 of `2026-11-27-lab-deployment-setups-design.md`.

## Why

Many analysers talk over a serial cable. The operator wants the analyser PC to run the
desktop app as a thin client and read the analyser through it, with no separate program to
install.

Core must not know about analysers. So core gives a plugin page one generic thing: a serial
port it can open, read and write as raw bytes. What the bytes mean stays in the plugin.

## What exists today

1. **A plugin page runs in a locked frame.** `sandbox="allow-scripts"` and nothing else
   (`apps/studio/src/plugins/PluginFrame.tsx:124`). Such a frame cannot use the browser's
   serial feature itself.
2. **A plugin page already asks Studio for two things on this PC.** Saving a file and
   printing (`packages/plugin-ui-sdk/src/bootstrap.ts:145`, `:150`). Studio's own page does
   them. They never reach the server (`apps/studio/src/plugins/host-bridge.ts:99-103`).
3. **Studio's own page can use the browser's serial feature**, Web Serial, in Chrome, Edge
   and Electron. Firefox and Safari do not have it. It needs HTTPS or an address on this PC.
4. **The desktop app refuses every device permission** except one clipboard write
   (`apps/desktop/src/locality.ts:82`).
5. **A plugin's host capabilities are granted when an administrator installs it.** Seven
   exist today, such as `host:connectors` and `host:db`. None is for a device.
6. **The analyser plugin reads analysers over the network only.** Its companion program
   speaks HL7 over TCP (`openldr-ce-plugin-analyzer-interface/companion/receiver.mjs:221`).

## Goals

- A plugin page can list, open, read, write and close a serial port on the PC it runs on.
- Only a plugin that was granted this at install can do it.
- The person at the PC chooses the port. A plugin never picks one by itself.
- It works in the desktop app in both modes, and in Chrome and Edge.

## Not goals

- Any analyser protocol in core. No ASTM, no HL7, no framing, no checksums.
- A link that stays up when the plugin's page is closed. See "The one real limit".
- Network analysers. The companion program covers those.
- USB devices that are not serial ports. Bluetooth.

## Must not happen

- A plugin reading a port the person did not choose for it.
- One plugin using a port that was chosen for another plugin.
- Serial bytes sent to the server by core. They may hold patient results. The plugin decides
  what to send, through its own actions.

## Approaches considered

| Approach | Trade-off | Chosen |
|---|---|---|
| Studio's own page opens the port and passes bytes to the plugin page | Uses what the browser and Electron already have. No native code. Works in Chrome and Edge too. The link lives only while the plugin's page is open. | Yes |
| The desktop app's main process opens the port with a native serial library | The link could stay up in the background. But it adds a native module to build and pack for three systems, and does nothing for Chrome or Edge. | No, maybe later |
| The companion program learns serial | No change to the app. But the analyser PC then needs Node and a native module, and it is the separate program the operator wanted to avoid. | No |
| Let the plugin frame use the serial feature directly | Not possible in a locked frame. It would also hand the device to plugin code with no limits. | No |

## How it works

```
 analyser ──cable── PC ── Studio's own page ──(bytes)── plugin page
                          opens the port,               knows the protocol,
                          enforces the limits           answers the analyser
```

**Five new calls for a plugin page**, beside files and print:

| Call | What it does |
|---|---|
| `serial.ports()` | The ports already chosen for this plugin on this PC |
| `serial.choose()` | Asks the person to pick a port. Needs a click in the plugin page |
| `serial.open(port, settings)` | Opens it. Settings: speed, data bits, stop bits, parity, flow control |
| `serial.read(port, wait)` | The bytes that arrived since the last read. Waits up to `wait` for the first one |
| `serial.write(port, bytes)` and `serial.close(port)` | Send bytes. Close |

Studio's own page answers these. They never reach the server, like saving a file and printing.

**The gates, in order.**

1. **The plugin declares `host:serial`** in its manifest. The administrator sees it and grants
   it at install, as with every host capability today. Without the grant, every call is
   refused.
2. **The person chooses the port.** In the desktop app, a small window lists the PC's ports.
   In Chrome and Edge, the browser shows its own list.
3. **The choice is kept per plugin, per PC.** Studio remembers which ports were chosen for
   which plugin. A plugin sees only its own.
4. **The desktop app grants the serial permission only to the address it trusts:** this PC
   in local mode, the connected server in connect mode. Every other page still gets nothing.

No new kind of approval is needed. The lab setups design expected one. The install grant
already is the administrator's approval of the plugin, and the port is a choice for the
person at the PC, not for an administrator somewhere else.

**The limits Studio enforces.**
- At most two open ports for one plugin page.
- A read returns at most 64 KiB. Bytes wait in a buffer of at most 1 MiB. If the plugin
  reads too slowly and the buffer fills, the next read says bytes were lost. It never hides
  a loss.
- A write takes at most 64 KiB.
- When the plugin's page closes, its ports close.

## The screen

The desktop app's port window. It is the app's own small window, like the PIN window in the
connect mode plan.

```
 Choose a serial port for "Analyzer interface"

   ( ) COM3    USB Serial Port
   ( ) COM1    Communications Port

   [x] Remember this port for this plugin on this PC

                                   [ Cancel ]   [ Use this port ]
```

With no port on the PC, it says: "No serial port was found. Plug the cable in and try again."

In Firefox or Safari, the plugin's call is refused with a plain reason, and the plugin can
say: "Use the OpenLDR app, Chrome or Edge to connect an analyser."

## The one real limit

**The link is up only while the plugin's page is open on that PC.**

Close the page, or go to another Studio screen, and the port closes. An analyser that sends a
result then gets no answer. Most analysers keep the result and try again, but that depends on
the analyser.

For a PC that sits beside one analyser and shows the analyser page all day, this is fine. The
lock from the connect mode plan makes such a PC.

A link that stays up in the background needs the app's main process to hold the port. That is
the second approach above. It is later work, and only if a lab needs it.

## What the plugin does

Outside this design, in `analyzer-interface`. The plugin gets a page that opens the port,
frames the bytes by the analyser's protocol, answers the analyser, and saves each result
through the plugin's own existing actions. Its companion program stays for network
analysers.

## Docs

- The plugin author docs: the new capability and the five calls
  (`apps/web/src/docs/0.1.8/en/plugin-host-functions.md`, `plugin-permissions.md`).
- The desktop app page: the port window, and on Linux that the PC user must be allowed to
  use serial devices.
- No Studio screen is added, so no in-app guide. The analyser page's guide belongs to the
  plugin.
- CLI parity does not apply. A serial port is on the PC where a person sits.

## Left to the builder

- How Studio learns that a plugin holds `host:serial`.
- How a port is told apart from another the same kind, when it has no serial number.
- The exact names of the calls and their refusal codes.
- How bytes cross between Studio's page and the plugin page.

## Not proven

**HONEST NON-PROOF.** None of this was run. Each is a first check before building.

1. That a click inside the locked plugin frame still counts when Studio's own page asks for
   the port a moment later. The browser needs a recent click to show its list.
2. That Electron 45 offers the serial feature to a page loaded from another server, as
   connect mode does, and to `http://127.0.0.1`.
3. That no byte is lost at real speeds, 9600 to 115200, when reads go through the plugin
   bridge. Check with a loopback cable.
4. A real analyser. Timing, retries and what it does when nobody answers.
5. Linux device permissions, and Windows and macOS port names.

If check 1 fails, `serial.choose()` cannot work from a plugin page. Then Studio must show its
own button for the click. Stop and report.

## Calls made by the designer, for the operator to check

- The link lives only while the plugin's page is open. A background link is later work.
- No new kind of approval. The install grant and the person's choice of port are the gates.
- It also works in Chrome and Edge, with no app. The design does not block that.
- Network analysers stay with the companion program.
- Two open ports per plugin page, and the size limits above.
