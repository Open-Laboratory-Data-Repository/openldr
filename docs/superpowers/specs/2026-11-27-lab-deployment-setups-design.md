# Lab deployment setups

Date: 2026-11-27. Design only. Nothing here is built.

## Why

A lab with several PCs should not need a full OpenLDR on each PC, with the same users typed
into each. This doc says what each kind of lab installs, and lists what is missing today.

The rule: **one full install per site. Every other PC is a screen onto it.**

## What exists today

Each line was read in the code on 2026-11-27 (CE main `2e3701b5e`).

1. **The desktop app cannot be a screen only.** It always starts its own server on
   `127.0.0.1` (`apps/desktop/src/launcher.ts:88`, `apps/desktop/src/controller.ts:94`). Its
   settings hold a port, start at sign-in and the window size, nothing else
   (`apps/desktop/src/settings.ts:7`). Its window hands any address that is not this PC to the
   browser (`apps/desktop/src/main.ts:149`). It refuses every device permission
   (`apps/desktop/src/locality.ts:82`).
2. **The standalone launcher can be opened from other PCs.** `openldr-standalone start --host
   <address>` does it (`apps/standalone/src/commands.ts:1042`). The default is `127.0.0.1`
   (`commands.ts:97`). It is plain HTTP and prints a warning (`commands.ts:681`). The web docs
   say plugin pages and dashboard editing can fail at such an address
   (`apps/web/src/docs/0.1.8/en/standalone.md:282`).
3. **The server edition has HTTPS.** nginx listens on 443
   (`deploy/nginx/openldr.conf.template:13`). The installer makes a self-signed certificate by
   default (`install/install.sh:1004`).
4. **The standalone signs in with its own users.** `AUTH_ADAPTER` is fixed to `local`
   (`apps/standalone/src/environment.ts:52`).
5. **In `oidc` mode, roles stay in each install.** The token only proves who the user is.
   Roles are read from the install's own database (`apps/server/src/auth-plugin.ts:225`,
   `:232`). Sign-in needs the identity server to be reachable.
6. **Core has no analyser code.** The `analyzer-interface` plugin has a 12 KB Node program,
   the companion. It speaks HL7 over plain TCP (MLLP). It can listen for the analyser or dial
   out to it (`receiver.mjs:221`, `:236`). It posts each result to OpenLDR with a bearer
   token. It refuses plain HTTP unless OpenLDR is on the same PC
   (`openldr-ce-plugin-analyzer-interface/companion/receiver.mjs:72`). If the post fails it
   answers the analyser with an error code (`receiver.mjs:186`). It keeps one small SQLite
   receipt file per instrument (`receiver.mjs:93`). It accepts a result only when its own
   account started that worksheet (`receiver.mjs:119`).
7. **Sync is a star.** Each install sends its own records straight to national
   (`docs/superpowers/specs/2026-07-02-distributed-sync-architecture-design.md:23`). National
   rejects a record from any other site (`apps/server/src/sync-routes.ts:158`). Only a
   Keycloak install can enroll sites (`packages/config/src/auth.ts:25`). A file export for
   sites with no link exists (`packages/cli/src/sync.ts:394`).
8. **lab-bench has referrals.** A lab can refer a specimen to another lab, by a file
   (`openldr-ce-plugin-lab-bench/docs/en.md:48`, `src/referrals.rs:18`) or by a script that
   talks to both installs (`README.md:40`). The script needs HTTPS, a link between the two
   labs, and a hand-written mapping for each specimen.
9. **A plugin's own code can use a connector an administrator approved for it.** CE checks
   the approval, passes the settings and the one allowed host, and withholds any answer that
   carries a secret (`packages/bootstrap/src/plugin-broker.ts:622`, commit `70506c96d`).
10. **An access key cannot be limited.** It carries every permission and the data limit of
    the account that owns it (`apps/server/src/access-key-auth.ts:48`, `:59`).

## Goals

- Every kind of lab knows what to install on each PC.
- Users are created once per site, not once per PC.
- A spoke keeps working with no internet.
- A spoke can refer a sample to the hub and get the result back.
- A client PC does not depend on how ICT set up its browser.
- A client PC can be locked to OpenLDR.
- An analyser PC needs no OpenLDR server and no Postgres.

## Not goals

- Sync through a hub. Each site still syncs straight to national.
- Shared users across sites. Users and roles stay at each site.
- A referral route through national. See "Later".

## Must not happen

- A spoke that cannot sign in or enter results because the internet is down.
- Passwords or patient data crossing a lab network in plain HTTP. One link is outside this
  rule: analyser to companion is plain TCP, because that is what the analyser speaks. Keep
  that link on one PC or one cable.
- Product code in core. Referral logic stays in lab-bench. Analyser logic stays in
  `analyzer-interface` (AGENTS.md §8).

## The two ways the desktop app runs

The desktop app gets a choice on first start. It can be changed later in its settings.

| Mode | What runs on the PC | Where the data is |
|---|---|---|
| **This PC holds the lab's data** | Server, database and window. Today's behaviour. | On this PC |
| **Connect to the lab's server** (new) | The window only. | On the server it connects to |

The second mode is the thin client. A browser still works for any PC that wants it.

## The setups

### Spoke

Weak internet. Tests some samples itself and refers the rest to the hub.

- One PC with the desktop app, holding the data. It is its own site.
- Its own local users.
- It syncs to national when the link is up. Records queue while it is down. The file export
  covers a site with no link at all.
- Referral to the hub: see "Referral between spoke and hub".

The spoke has its own install because it tests its own samples. A screen onto the hub would
stop each time the link drops.

### Two-PC lab

- PC 1 runs the desktop app, holding the data, with **Share on the lab network** turned on.
  This switch is new.
- PC 2 runs the desktop app in connect mode, pointed at PC 1.
- Users are created once, on PC 1.
- PC 1 must be on whenever PC 2 is used.

### Hub

More PCs and a bigger reception. Spokes send it referrals.

- One PC runs the server edition (Docker). It already has HTTPS and is built to face a
  network.
- Every other PC runs the desktop app in connect mode.
- It is one site, syncing to national.
- Spokes reach it over the internet or a VPN, for referrals only.

### Analyser PC

- No OpenLDR server and no Postgres. The companion keeps one small receipt file per
  instrument. Keep that file across restarts.
- The companion signs in as one lab account. Results are accepted only for worksheets that
  account started (finding 6). The guide must say which account that is.
- Today's path: the companion program, pointed at the site's install with `OPENLDR_URL` and
  an access key. It works against a hub. Against a shared desktop app it is refused today
  (finding 6). The sharing switch fixes that.
- Later path: the desktop app in connect mode, once it can give a plugin page a serial port.
  See "Devices".

## Sign-in

Each site keeps its own users, in every setup. The users live on the one install. Every
other PC signs in to it.

Signing in through national's Keycloak was looked at and not chosen. Roles would still be set
at each site (finding 5), and a spoke would be locked out whenever the link drops.

## Connect mode (new, in core)

The operator chose this on 2026-11-27, for three reasons. A lab's ICT team may have locked
down the browsers. The app can reach files and serial ports where a browser may not. In a
teaching institution people use the PCs for other things, and the app can be locked.

In connect mode the app:

- Asks once for the server's address and remembers it.
- Starts no server and no database.
- Loads Studio from that address. Studio's version is always the server's.
- Trusts that one address the way it trusts `127.0.0.1` today: links stay in the window, and
  the copy button works. Every other address still goes to the browser.
- Shows a plain "cannot reach the server" screen with a retry, when the server is off.
- Refuses a plain HTTP address that is not this PC.
- For a self-signed certificate, shows the certificate's fingerprint once and asks. It then
  remembers that certificate for that address only.

### Lock this PC to OpenLDR

One setting, off by default. When on:

- The app starts when the PC user signs in.
- The window is full screen with no way to another program from inside the app.
- Links to outside sites do not open.
- Turning it off, or quitting the app, needs a PIN. The PIN is set when the lock is turned on.
  The operator chose a PIN over an administrator's sign-in on 2026-11-27: a locked PC must
  still unlock when the server is off, and a hub on Keycloak cannot tell the app who is
  signed in.

The app cannot stop someone leaving it with the keyboard. That is the operating system's job
(kiosk mode on Windows). The setup guide will show how to set the app as the kiosk program.

### Devices

The app gives pages nothing today (finding 1). Device access comes in two steps.

1. **Files.** Saving and opening files should work through the normal file windows. Check
   it in connect mode before building anything.
2. **Serial ports.** A generic rule in core: a plugin page may ask for a serial port, and the
   app grants it only if an administrator approved that plugin for it. The analyser logic
   stays in the `analyzer-interface` plugin. This step gets its own short design before it is
   built, because it adds a new kind of plugin approval.

### One package

Connect mode ships in the same package as today's app. The package is 500 to 600 MB
(`apps/web/src/docs/0.1.8/en/desktop-app.md:9`). A client uses little of it. A smaller
client-only package is later work.

## Share on the lab network (new, in core)

The desktop app in data-holding mode gets one switch. When it is on:

- The launcher also listens on the PC's network address, with HTTPS.
- The app's own window keeps using `127.0.0.1`.
- The launcher makes a self-signed certificate for the PC's name and address on first use.
- The settings screen shows the address to type on the other PCs, and the certificate's
  fingerprint to compare.
- The certificate can be downloaded, so the analyser companion can trust it. The server
  has a route that serves its certificate, but only when `TLS_CERT_PATH` is set
  (`apps/server/src/settings-routes.ts:346`). The launcher must set it to the certificate it
  made.
- The companion runs on Node, which does not use the PC's certificate store by default. The
  guide must show how to make Node trust the downloaded certificate, and the address in the
  certificate must be the one the companion uses.

The same choice must work headless: `openldr-standalone start` gets a matching flag
(AGENTS.md §6, CLI parity).

Left to the builder: the certificate's lifetime and renewal, the port, and the firewall
prompt on Windows.

## Referral between spoke and hub

The operator decided the order on 2026-11-27:

1. **Direct link first.** The spoke sends the referral straight to the hub. The hub's result
   comes back the same way.
2. **File as fallback.** If the link is down, the spoke exports the referral file that exists
   today. It travels with the sample.
3. **Through national only if the hub is out of service.** Not designed here.

The direct link is lab-bench work. Core gives only the generic parts:

- The spoke holds a connector to the hub. The secret stays on the server.
- The connector is approved for lab-bench and pinned to the hub's host. Core already does
  this (finding 9). No new core work is needed.
- The hub makes one account per spoke, with a role that holds only the lab-bench permissions
  a referral needs. The spoke's access key belongs to that account. A key cannot be limited
  on its own (finding 10).
- Before go-live, check that one spoke cannot read another spoke's referrals at the hub.

lab-bench then does what its script does today, without the hand-written mapping: send the
referral, record receipt, wait for the released report, and bring it back for review at the
spoke. If a send fails, it offers the file export. The direct link and the file must match
receipts the same way, so a referral sent both ways lands once
(`openldr-ce-plugin-lab-bench/src/referrals.rs:99`, `:110`).

Left to the builder (lab-bench): how the hub matches the spoke's patient and test to its
own.

### How a finished result comes back

The operator decided on 2026-11-27: use a workflow. The workflows engine already has a
schedule trigger (`packages/workflows/src/types.ts:72`, `:88`), and a plugin can already
offer its own workflow step that gets a connector's settings and its one allowed host
(`packages/bootstrap/src/plugin-node-service.ts:97`). So the spoke runs a workflow: every
few minutes, ask the hub for finished results. A "Check now" button stays for the impatient.

No second timer is built, in core or in the plugin.

One limit to settle in plan 3. A plugin's workflow step runs without the plugin's own
database access and without a signed-in caller (`plugin-node-service.ts:126` passes only the
connector settings and the allowed host). lab-bench needs both to read its waiting referrals.
Two ways round it: core gives a plugin's workflow step those two things (gap G17), or the
workflow uses the existing HTTP step to call lab-bench on its own install with a restricted
key. The second works today.

### The hub's certificate

The operator decided on 2026-11-27: a spoke must be able to trust a hub that has a
self-signed certificate. A real certificate would be simpler, but it is hard to get in these
settings.

A plugin's network calls use Node's list of trusted issuers
(`packages/plugins/src/extism-runner.ts:22`). The server edition already has a way to add to
that list: a file named in `NODE_EXTRA_CA_CERTS` (`install/install.sh:1023`), read when the
server starts. The desktop app and the standalone launcher have no such file. A spoke is a
desktop app, so this is gap G16. It is generic core work and gets its own short design: where
an administrator saves the hub's certificate, and how a running install picks it up.

## Approaches considered

| Approach | Trade-off | Chosen |
|---|---|---|
| A full install on every PC | Works today. Users typed on each PC. Each PC is its own site. | No |
| One install per site, browsers for the rest | Nothing to build for clients. Depends on each PC's browser setup. No lock, no serial ports. | Allowed, not the main way |
| One install per site, desktop app in connect mode for the rest | Same app everywhere. Can be locked. Can reach devices later. Needs connect mode built. | Yes |
| Spokes as screens onto the hub | Nothing to install at a spoke. Stops when the link drops, and a spoke tests its own samples. | No |

For the server PC, the operator chose the server edition at a hub and the desktop app in a
two-PC lab. A desktop app as the hub was not chosen: it should never face the open internet.
The server edition for a two-PC lab was not chosen: nobody there looks after Docker.

## Gaps

| # | Gap | Proof | Where the fix goes |
|---|---|---|---|
| G1 | The desktop app cannot be shared. It is fixed to `127.0.0.1`. | `apps/desktop/src/controller.ts:94`, `launcher.ts:88` | core |
| G2 | The standalone has no HTTPS. | `apps/standalone/src/commands.ts:681` | core |
| G3 | Plugin pages can fail from another PC over plain HTTP. | `apps/web/src/docs/0.1.8/en/standalone.md:282` | closed by G2 |
| G4 | The companion refuses a desktop app on another PC. | `companion/receiver.mjs:72` | closed by G2 |
| G5 | The desktop app has no connect mode. No setting holds a server address. | `apps/desktop/src/settings.ts:7`, `main.ts:149` | core |
| G6 | The desktop app cannot be locked. | no kiosk or full-screen code in `apps/desktop/src/main.ts` | core |
| G7 | The desktop app gives pages no serial port. | `apps/desktop/src/locality.ts:82` | core, own design |
| G8 | The companion keeps no queue. If OpenLDR is unreachable it answers the analyser with an error. | `companion/receiver.mjs:186` | `analyzer-interface` |
| G9 | The companion speaks HL7 over TCP only. No ASTM, no serial port. | `openldr-ce-plugin-analyzer-interface/README.md` | `analyzer-interface` |
| G10 | Referral over a link needs a script and a mapping per specimen. | `openldr-ce-plugin-lab-bench/README.md:40` | lab-bench |
| G11 | Withdrawn. Core already lets a plugin use an approved connector. | `packages/bootstrap/src/plugin-broker.ts:622` | none |
| G12 | National passes nothing from one site to another. | `apps/server/src/sync-routes.ts:158` | later |
| G13 | No guide says which setup a lab should pick. `lab-setup.md` covers lab features only. | `apps/web/src/docs/0.1.8/en/lab-setup.md:1` | docs, en, fr, pt |
| G14 | The certificate route answers 404 on a standalone. `TLS_CERT_PATH` is never set there. | `apps/server/src/settings-routes.ts:346` | core, with G2 |
| G15 | A referral key at the hub cannot be limited to referrals. | `apps/server/src/access-key-auth.ts:48` | a restricted account per spoke, no code |
| G16 | A desktop or standalone install cannot be told to trust another install's self-signed certificate. | `apps/standalone/src/environment.ts:40-72` sets no `NODE_EXTRA_CA_CERTS` | core. Designed in `2026-11-27-trusted-certificates-and-workflow-hosts-design.md` |
| G17 | A plugin's workflow step gets no database access and no caller. | `packages/bootstrap/src/plugin-node-service.ts:126` | core, only if plan 3 needs it |
| G19 | A workflow's HTTP step may call only hosts named in `WORKFLOW_HTTP_ALLOWLIST`. It is empty by default, and the desktop app has no way to set it. So a desktop spoke cannot run the workflow that fetches results. | `packages/workflows/src/engine/services.ts:171`, `packages/config/src/schema.ts:148`, `apps/standalone/src/environment.ts:40-72` | core. Designed in `2026-11-27-trusted-certificates-and-workflow-hosts-design.md` |
| G18 | Withdrawn. lab-bench declares `pluginKind: "sink"`, so Studio's connector form already offers it. | `openldr-ce-plugin-lab-bench/manifest.template.json:31`, `apps/server/src/connectors-routes.ts:78` | none |

**HONEST NON-PROOF.** G3 comes from the docs. Nobody reproduced it in this session. The
first build step is to open a lab-bench page from a second PC over plain HTTP and see what
breaks. G2 is needed either way, because of G4 and the plain-text passwords. The plugin
frame already copes with one plain HTTP limit (`apps/studio/src/plugins/PluginFrame.tsx:34`),
so G3 may be out of date. Assign no plugin work for it until a named screen fails.

G8 was read from one line. Whether the analyser sends the result again after an error
depends on the analyser. Check it on a real one before building a queue.

Nobody checked that Studio and plugin pages work unchanged inside the app when loaded from
another address. Connect mode's first step is to try it against a server edition. Try a
sign-in and a plugin file export in that test. A standard hub keeps Keycloak on its own
address (`install/install.sh:986`), so sign-in should stay in the window. A hub with an
outside identity server would be sent to the browser (`apps/desktop/src/main.ts:145`).

## Build order

1. Reproduce G3 on two PCs.
2. Sharing switch with HTTPS (G1, G2, G14).
3. Connect mode and the lock setting (G5, G6). Steps 2 and 3 give the two-PC lab and the hub.
4. The setup guide (G13).
5. The direct referral in lab-bench (G10), with a restricted account per spoke (G15).
6. Serial ports for plugin pages (G7), after its own design.
7. Companion queue and other analyser protocols (G8, G9), when a real analyser asks for them.

## Later

- A small client-only package.
- Referral through national, for when a hub is out of service (G12).
- Managing users for several sites from one place. The sync design defers it too
  (`2026-07-02-distributed-sync-architecture-design.md:33`).

## Calls made by the designer, for the operator to check

- Each site keeps its own users. No sign-in through national.
- One package for both modes. A small client package is later.
- Lock is one setting. The operating system's kiosk mode does the hard lock.
- Sharing and connect mode get a short in-app guide as well as the web docs. The operator
  asked for this on 2026-11-27.
- Serial ports come after connect mode, with their own design.
- The analyser PC keeps the companion until serial ports land.

## Follow-up seen, not part of this design

Core's plugin scheduler is DHIS2 code. `packages/bootstrap/src/plugin-schedule.ts:2` imports
`@openldr/dhis2`, and line 85 names the `dhis2-sink` plugin. AGENTS.md §8 lists the DHIS2
debt in core but does not name this file. It belongs on that list. The workflows schedule
trigger is the generic timer, so nothing new should use this scheduler.

## Review

Codex reviewed this doc on 2026-11-27 over the agent relay. Thirteen points: nine confirmed
and applied here, one refuted, three deferred. The `analyzer-interface` folder became a git
repository the same day (`668b1c0`).
