# Trusted certificates and workflow hosts

Date: 2026-11-27. Design only. Nothing here is built. The operator approved it on 2026-11-27,
after Codex's review.

This closes gaps G16 and G19 of `2026-11-27-lab-deployment-setups-design.md`.

## Why

A spoke is a desktop app. Two things a spoke needs are server settings today, and a desktop
app user cannot set a server setting.

- **G16.** The spoke must trust a hub that has a self-signed certificate. The operator
  decided this on 2026-11-27.
- **G19.** The spoke's workflow must be allowed to call the spoke's own OpenLDR, to fetch
  finished results.

Both are generic. Neither knows about referrals, lab-bench or any product.

## What exists today

1. **Extra trusted certificates are read once, when Node starts.** The server edition names a
   file in `NODE_EXTRA_CA_CERTS` (`install/install.sh:1023`). An administrator overwrites
   that file by hand and restarts (`install/install.sh:853`). It is mounted read-only
   (`deploy/install/docker-compose.yml:18`).
2. **The standalone launcher sets no such file** (`apps/standalone/src/environment.ts:40-72`).
   A headless launcher can take it from the shell. A desktop app user cannot.
3. **Three callers use Node's trusted list:** a plugin's network calls
   (`packages/plugins/src/extism-runner.ts:22`), a workflow's HTTP step
   (`packages/workflows/src/engine/services.ts:205`), and sync to central. Database
   connectors do not. They have their own TLS settings
   (`packages/bootstrap/src/connector-config.ts:16`), and this design leaves them alone.
4. **Not every Node in use can add a trusted certificate while running.** The server image
   runs Node 22.23.3, which can (`tls.setDefaultCACertificates`). Node 24.1 on this machine
   cannot. So one rule for every edition: a change needs a restart. Both can report what
   they loaded (`tls.getCACertificates('extra')`).
5. **A workflow's HTTP step may call only hosts on a list.** The list is the setting
   `WORKFLOW_HTTP_ALLOWLIST` (`packages/config/src/schema.ts:148`). It is empty by default,
   and an empty list refuses every host (`services.ts:171`). It is read on each call
   (`packages/bootstrap/src/index.ts:1517`).
6. **The same trust problem already exists for sync.** A lab that syncs to a central with a
   self-signed certificate must set the file by hand
   (`apps/studio/src/docs/0.1.8/en/sync.md:185`). A desktop lab cannot.

## Goals

- An administrator adds a trusted certificate in Studio or the CLI. No file editing.
- An administrator names the hosts a workflow may call, in Studio or the CLI.
- Both work on the desktop app, the standalone launcher and the server edition.
- Nothing is trusted or allowed until an administrator says so.

## Not goals

- Trust for one connector only. See "Approaches".
- Adding a certificate without a restart.
- Any default entry. The lists start empty.

## Must not happen

- A certificate trusted without a person seeing its fingerprint.
- A private key stored in the trusted list.
- A workflow reaching a host nobody allowed.

## Approaches considered

| Approach | Trade-off | Chosen |
|---|---|---|
| A settings page and CLI for both lists | One place. Works on every edition. A new certificate needs a restart. | Yes |
| A certificate field on each connector | Tighter: only that connector trusts it. But a plugin's network call runs in a worker that only knows the process-wide list, so it cannot be done today. It also would not help sync. | No |
| A file the administrator edits by hand | Nothing to build. This is today's way on the server edition. A desktop user will not do it. | No |
| The launcher allows `127.0.0.1` for workflows by default | No setup at a spoke. But every install would let a workflow call the PC it runs on, whether it needs to or not. | No |

## Part 1: trusted certificates

**The file.** A new setting, `TRUSTED_CA_FILE`, names one PEM file. The server reads and
writes it. Node is started with `NODE_EXTRA_CA_CERTS` naming the same file.

| Edition | The file | Who sets the two settings |
|---|---|---|
| Desktop app | `<data folder>/trust/ca.pem` | The app, when it starts its launcher |
| Standalone launcher | the same | The launcher. It starts itself again once with the variable set, when the shell did not set one |
| Server edition | a file in a trust folder the installer owns | The installer. It mounts the folder, not a single file |

**Three rules about the file.**
- Certificates already trusted stay trusted. On an upgrade, the installer copies the old
  central certificate file into the new one.
- A file the person named themselves, with `NODE_EXTRA_CA_CERTS` in the shell, is never
  edited. The page then shows its certificates as read-only, "set outside OpenLDR".
- An install made before this change has no `TRUSTED_CA_FILE`. Its page is read-only and
  says how to turn it on.

**The launcher's order.** The launcher may start itself again with the variable only at the
very beginning of `start`: before the control socket (`apps/standalone/src/commands.ts:514`),
the lock (`:520`) and Postgres. It does so once. It keeps its arguments, its event channel,
its exit code and its signals.

**What happens on a change.** The server writes the file. The new certificate is used after
the next restart. The page shows three states: in use, added and waiting for a restart,
removed and waiting for a restart. "In use" comes from Node itself: the server asks Node
which extra certificates it loaded. It is not a guess from the file.

**What is saved is what was shown.** "Read certificate" opens one TLS connection to the
address, reads the certificate, and closes. It has a time limit. It sends no web request and
no credentials. The save then carries that exact certificate. It is not fetched a second
time.

**What is refused.** Text where any block is not a certificate. Any text that holds a
private key, with a line saying never to paste one. A certificate already in the list. An
expired certificate is accepted with a warning, because the person may be fixing a clock
problem.

**Who may change it.** A new permission of its own, `network.manage`. The operator chose
this on 2026-11-27: someone who only manages connectors must not change what the whole
install trusts. Administrators hold it by default. Each add and each remove is audited with
the fingerprint.

## Part 2: hosts a workflow may call

Two stored settings.

**A switch: "Let workflows call this OpenLDR".** Off by default. When on, a workflow may call
this install's own address, and only that: the exact scheme, host and port the server
listens on. The operator chose this on 2026-11-27. A plain `127.0.0.1` entry would reach
every web service on the PC, on any port, because the check compares the host name only
(`packages/workflows/src/engine/services.ts:170`).

**A list of other hosts.** A host is a name or an IP address. No scheme, port or path. The
page says plainly that an entry covers every web service on that host.

The list in force is the server setting plus these two. It is read from the database on each
call, so a change applies at once. No restart. Hosts from the server setting show as
read-only, so the page is always the whole truth.

**One fix that goes with it.** Today a redirect keeps the sign-in headers unless the host
name changes (`services.ts:250`). A redirect to another port or scheme on the same host
keeps them. They must be dropped on any change of scheme, host or port.

The same new permission, `network.manage`. Each change is audited.

## The screen

One new page under Settings, **Network**, with two tabs. It follows the Connectors page:
actions in the dots menu, a sheet to add, a table with pagination, the striped empty state.

```
Settings > Network                                             [⋯]  Add certificate

 [ Trusted certificates ]  [ Workflow hosts ]
 ───────────────────────────────────────────────────────────────────────────
 Name             Fingerprint (SHA-256)     Valid until    State
 hub.district     3F:A1:9C ... 7E   [copy]  2029-03-02     In use            [⋯]
 national.test    B2:04:55 ... 1D   [copy]  2028-11-30     After restart     [⋯]
 ───────────────────────────────────────────────────────────────────────────
                                                    Rows 1 to 2 of 2   < >
```

"Add certificate" opens a sheet with two ways in:

```
 Add a trusted certificate                                      [⋯]  Save

 Address        [ hub.district:443            ]  ( Read certificate )
 Fingerprint    3F:A1:9C:...:7E
 Issued to      hub.district
 Valid until    2029-03-02

 or paste it    [ -----BEGIN CERTIFICATE-----                       ]
                [                                                   ]
```

"Read certificate" fetches the certificate from the address and shows its fingerprint. The
person compares it with the one shown on the other install, then saves. After a save, a toast
says: "Saved. Restart OpenLDR to use it."

The second tab:

```
 [ Trusted certificates ]  [ Workflow hosts ]                   [⋯]  Add host
 ───────────────────────────────────────────────────────────────────────────
 Let workflows call this OpenLDR      [ on ]     http://127.0.0.1:3000 only

 Host              Source
 hub.district      Set here            Every web service on this host   [⋯]
 api.example.org   Server setting      Read-only
 ───────────────────────────────────────────────────────────────────────────
```

## CLI

Labs run headless, so every action has a command. The route and the command call the same
code in `@openldr/bootstrap`.

```
openldr trust list
openldr trust add <file.pem>
openldr trust add --from <host:port> --fingerprint <SHA-256>
openldr trust remove <fingerprint> --force

openldr workflows hosts list
openldr workflows hosts add <host>
openldr workflows hosts remove <host> --force
openldr workflows hosts self on|off
```

`trust add <file.pem>` prints the fingerprint and asks before it saves. `--fingerprint` with
the same value skips the question, for scripts. `--from` reads the certificate and saves it
only when its fingerprint equals the one given. A remove refuses without `--force`.

## Docs

- In-app guide for the new page, in en, fr and pt. It is a Studio screen.
- Web docs: the environment page, the standalone page, and the sync page's "Trust central
  TLS" section, which gets shorter.
- Mobile view of the new page.
- The landing changelog, after the merge.

## What this unlocks

- A desktop spoke trusts a self-signed hub, for the direct referral (lab-bench plan 3).
- A desktop spoke lets its workflow fetch results from its own OpenLDR.
- A desktop lab syncs to a central with a self-signed certificate.

## Tests the builder must not skip

- A host removed from the list is refused on the very next call.
- The same host in the server setting and in the list appears once.
- A redirect to another port on an allowed host drops the sign-in headers.
- With the switch on, a call to this PC on another port is refused.
- Text with a certificate and a private key together is refused, and nothing is saved.
- Two administrators adding at the same moment both end up in the file.
- A restart after replacing the file loads the new list and drops the old.

## Left to the builder

- How the event channel of the desktop app survives the launcher starting itself again.
- How the trust file is replaced safely: a new file renamed into place inside the mounted
  folder, or an in-place write with recovery after a crash.
- The exact names of the audit actions and the stored settings.

## Shown and not shown

**Shown by Codex on 2026-11-27. Claude did not repeat these runs.**
- A plugin's network call honours `NODE_EXTRA_CA_CERTS`. Codex ran the real plugin runner
  against a self-signed HTTPS server. With the file it connected. Without it, it was refused.
- The same holds on Electron 45.3 running as Node, which is what the desktop launcher uses.
- The server image can write a mounted file as its own user, on Docker Desktop.

**Shown by Claude.** The server image's Node (22.23.3) has both trust functions. Node 24.1 on
this machine has only the one that reports.

**HONEST NON-PROOF.**
- The packaged desktop app. The runs above used development builds.
- A native Linux Docker host. File ownership there differs from Docker Desktop.
- Two sites end to end: a scheduled workflow at a spoke, calling its own OpenLDR, which then
  calls a hub with a self-signed certificate, after a restart.
- An upgrade of an existing server install that already trusts a central.

## Decisions

Made by the operator on 2026-11-27:
- "This PC" means this OpenLDR only, by a switch. Not the whole PC.
- The page has its own permission, `network.manage`.
- A user limited to certain facilities may hold that permission. It is not dropped for them,
  unlike the connectors and sync permissions.

Made by the designer:
- One page, Network, with two tabs.
- A new certificate needs a restart on every edition, though the server image could do
  without. One rule is easier to explain and to test.
- The lists start empty and the switch starts off.
- An expired certificate is accepted with a warning.

## Review

Codex reviewed this doc on 2026-11-27 over the agent relay. Twelve points: eleven confirmed
and applied here, one deferred. Two of the confirmed points were errors in the first draft:
the claim that no Node in use can add a certificate while running, and the claim that every
outgoing call uses one trusted list.
