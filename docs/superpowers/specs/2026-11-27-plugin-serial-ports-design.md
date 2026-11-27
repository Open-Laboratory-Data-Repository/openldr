# Serial ports for plugin pages

Date: 2026-11-27. Design only. Nothing here is built. The operator approved it on 2026-11-27,
after Codex's review.

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
   exist today, such as `host:connectors` and `host:db`
   (`packages/marketplace/src/capabilities.ts:19-31`). None is for a device.
6. **Studio does not know what a plugin was granted.** The plugin frame is given the
   signed-in user's permissions (`apps/studio/src/plugins/PluginFrame.tsx:24-34`). The grant
   is checked on the server only (`packages/bootstrap/src/plugin-broker.ts:523`).
7. **A serial port has no reliable identity.** The browser gives a port's maker and product
   numbers, and nothing that tells two identical adapters apart after a restart.
8. **The analyser plugin reads analysers over the network only.** Its companion program
   speaks HL7 over TCP (`openldr-ce-plugin-analyzer-interface/companion/receiver.mjs:221`).

## Goals

- A plugin page can list, open, read, write and close a serial port on the PC it runs on.
- Only a plugin that was granted this at install can do it.
- The person at the PC chooses the port. A plugin never picks one by itself.
- It works in the desktop app in both modes, and in Chrome and Edge.

## Not goals

- Any analyser protocol in core. No ASTM, no HL7, no framing, no checksums.
- A link that stays up when the plugin's page is closed. See "The one real limit".
- Reconnecting without a person after a restart. See "Later".
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

**Six new calls for a plugin page**, beside files and print:

| Call | What it does |
|---|---|
| `serial.ports()` | The ports chosen for this plugin page since it was opened |
| `serial.choose()` | Asks the person to pick a port |
| `serial.open(port, settings)` | Opens it. Settings: speed, data bits, stop bits, parity, flow control |
| `serial.read(port, wait)` | The bytes that arrived since the last read. Waits up to `wait` for the first one |
| `serial.write(port, bytes)` | Sends bytes |
| `serial.close(port)` | Closes it |

Studio's own page answers these. They never reach the server, like saving a file and printing.

A port is known to the plugin by a handle Studio makes up for that one plugin page. A handle
from another page is refused. A handle dies when its page closes.

**The gates, in order.**

1. **The plugin declares `host:serial`** in its manifest. The administrator sees it and grants
   it at install, as with every host capability today. Without the grant, every call is
   refused.
2. **Studio knows the grant for real.** It fetches what the administrator granted the
   plugin's active version from the server. Until it has the answer, every call is refused.
   Open ports are closed when the grant is removed, the plugin is turned off or upgraded,
   the person signs out, or the page closes.
3. **Studio asks first, in its own words.** `serial.choose()` makes Studio show its own
   prompt: "<plugin name> wants to use a serial port." The person presses "Choose port"
   there. The browser cannot tell which plugin was clicked, so the plugin's name must come
   from Studio, not from the plugin's page. That press is also the click the browser needs.
4. **The person chooses the port.** In the desktop app, a small window lists the PC's ports.
   In Chrome and Edge, the browser shows its own list. The app never picks one by itself,
   not even when there is only one.
5. **The choice lasts while that plugin page is open.** A port chosen for one plugin page is
   not visible to another. After a restart or a reload, the person chooses again. A port has
   no reliable identity to remember it by.
6. **The desktop app grants the serial permission narrowly:** to its one main window, on the
   exact address it trusts, and only while Studio has a choice waiting. If the page changes or
   the window closes, the choice is cancelled.

No new kind of approval is needed. The lab setups design expected one. The install grant
already is the administrator's approval of the plugin, and the port is a choice for the
person at the PC, not for an administrator somewhere else.

**The limits Studio enforces.**
- At most two open ports for one plugin page. A port is open for one page at a time.
- One read at a time for each port. A second read while one waits is refused. Every wait
  has an end.
- A read returns at most 64 KiB. Bytes wait in a buffer of at most 1 MiB. If the plugin
  reads too slowly and the buffer fills, the next read says bytes were lost, before it
  returns any more. It never hides a loss.
- A write takes at most 64 KiB. Writes go out in order. At most 1 MiB may wait to be sent.
- An unplugged cable or a port error is always reported to the plugin. Waiting reads end,
  waiting writes fail, and the handle dies.
- When the plugin's page closes, its ports close.

**Not included: control lines.** The DTR and RTS lines, and the break signal, are left out.
They are added only when a named analyser's manual needs them. Raw bytes alone do not make
any analyser protocol work. That is for the plugin to prove, model by model.

## The screen

The desktop app's port window. It is the app's own small window, like the PIN window in the
connect mode plan.

```
 Choose a serial port for "Analyzer interface"

   (•) COM3    USB Serial Port          used last time
   ( ) COM1    Communications Port

                                   [ Cancel ]   [ Use this port ]
```

The port used last time is marked, so reconnecting is one press. The person still presses.
With no port on the PC, it says: "No serial port was found. Plug the cable in and try again."

In Firefox or Safari, the plugin's call is refused with a plain reason, and the plugin can
say: "Use the OpenLDR app, Chrome or Edge to connect an analyser."

## The one real limit

**The link is up only while the plugin's page is open on that PC, and a person started it.**

The port closes when the page closes, when someone goes to another Studio screen, when the
window reloads, when the PC sleeps, and when the app or the PC restarts. An analyser that
sends a result then gets no answer. What it does next depends on the model. Nothing here
assumes it keeps the result and tries again. Each supported model is checked against its
manual and a watched test.

After any of those, someone must open the page and press once to reconnect.

For a PC that sits beside one analyser and shows the analyser page all day, this works, with
care. The lock from the connect mode plan helps. It does not guarantee delivery.

A dropped link and a message cut off half way are normal states. The plugin must show them
and recover from them.

## Later

**Reconnecting by itself.** The operator wants this, and chose to leave it for later on
2026-11-27. The reason: analysers run for hours, and someone who restarts an analyser may
forget to start the interface again. The cost: the app must remember a port for each plugin
and reopen it with nobody there, and a port has no reliable identity. If two cables were
swapped, it would listen to the wrong analyser until the plugin noticed. It needs its own
design.

**A link that stays up in the background.** The app's main process holds the port, whatever
page is shown. That is the second approach above. It needs native code packed for three
systems.

These two belong together. A background link is what makes reconnecting by itself worth
having.

## What the plugin does

Outside this design, in `analyzer-interface`. The plugin gets a page that opens the port,
frames the bytes by the analyser's protocol, answers the analyser, and saves each result
through the plugin's own existing actions. Its companion program stays for network
analysers, and for any feed that must run with nobody there.

The plugin also keeps what its companion does today: spotting a repeated message, checking
who owns the worksheet, and coping with a result that was saved just before the link dropped
(`openldr-ce-plugin-analyzer-interface/companion/receiver.mjs:95`, `:119`).

## Docs

- The plugin author docs: the new capability and the five calls
  (`apps/web/src/docs/0.1.8/en/plugin-host-functions.md`, `plugin-permissions.md`).
- The desktop app page: the port window, and on Linux that the PC user must be allowed to
  use serial devices.
- No Studio screen is added, so no in-app guide. The analyser page's guide belongs to the
  plugin.
- CLI parity does not apply. A serial port is on the PC where a person sits.

## Left to the builder

- The route that tells Studio what a plugin's active version was granted.
- How the app marks the port used last time, given that a port has no reliable identity. A
  wrong mark costs one look, because the person still chooses.
- The exact names of the calls and their refusal codes.
- How bytes cross between Studio's page and the plugin page.

## Not proven

**Shown by Codex on 2026-11-27. Claude did not repeat this run.** A click inside the locked
plugin frame does count for Studio's own page: in Chrome 158, on this PC, the serial feature
was present and the page had the click it needs. No port was chosen in that run. This design
no longer leans on it, because Studio now asks with its own button.

**HONEST NON-PROOF.** The rest was not run. Each is a first check before building.

1. That the browser's port list opens from Studio's own button, in Chrome, in Edge and in the
   desktop app.
2. That Electron 45 offers the serial feature to a page loaded from another server, as
   connect mode does, and to `http://127.0.0.1`. Check it in the packaged app.
3. That no byte is lost at real speeds, 9600 to 115200, when reads go through the plugin
   bridge. Check with a loopback cable.
4. A real analyser. Timing, retries and what it does when nobody answers.
5. Linux device permissions, and Windows and macOS port names.

6. Sleep and wake, a reload, and pulling the cable out, each while a message is half read.

If check 2 fails, the desktop app cannot use this design, and the port has to be held by the
app's main process. Stop and report.

## Decisions

Made by the operator on 2026-11-27:
- After a restart, someone presses once to reconnect. Reconnecting by itself is wanted, and
  left for later.
- When an administrator takes the grant away, an open port on another PC closes within a
  minute. Studio asks the server once a minute while a port is open. If the server cannot be
  reached, the port stays open and the check is tried again.

Made by the designer:
- The link lives only while the plugin's page is open. A background link is later work.
- No new kind of approval. The install grant and the person's choice of port are the gates.
- Studio asks with its own prompt before the port list.
- It also works in Chrome and Edge, with no app. The design does not block that.
- Network analysers stay with the companion program.
- No control lines until a named analyser needs them.
- Two open ports per plugin page, and the size limits above.

## Review

Codex reviewed this doc on 2026-11-27 over the agent relay. Twelve points: ten confirmed and
applied here, two deferred. Two of the confirmed points were errors in the first draft: it
said "five calls" and listed six, and it claimed without proof that most analysers keep a
result and try again.
