# Trusted certificates and workflow hosts

Date: 2026-11-27. Design only. Nothing here is built.

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
3. **Everything this install calls uses the same trusted list:** a plugin's network calls
   (`packages/plugins/src/extism-runner.ts:22`), a workflow's HTTP step
   (`packages/workflows/src/engine/services.ts:205`), and sync to central.
4. **Node cannot add a trusted certificate while running, on the versions in use.** The
   server image is Node 22 (`apps/server/Dockerfile:5`). Node 24.1 on this machine has no
   `tls.setDefaultCACertificates`. So a change needs a restart.
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
| Server edition | the central certificate file the installer already makes | The installer. The mount becomes writable |

An install made before this change has no `TRUSTED_CA_FILE`. Its page is read-only and says
how to turn it on.

**What happens on a change.** The server writes the file. The new certificate is used after
the next restart. The page shows which certificates are in use now and which wait for a
restart. The server knows, because it remembers what the file held when it started.

**What is refused.** Text that is not a certificate. A private key, with a line saying never
to paste one. A certificate already in the list. An expired certificate is accepted with a
warning, because the person may be fixing a clock problem.

**Who may change it.** The same permission as connectors, `connectors.manage`. Each change
is audited with the fingerprint.

## Part 2: hosts a workflow may call

A new stored setting holds a list of host names. The list in force is the server setting
plus this list. It is read on each call, so a change applies at once. No restart.

A host is a name or an IP address. No scheme, port or path. `127.0.0.1` means this PC, and
the page says so: it lets a workflow call this OpenLDR.

Hosts from the server setting show as read-only, so the page is always the whole truth.

Same permission, `connectors.manage`. Each change is audited.

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
 Host              Source
 127.0.0.1         Set here            This PC                          [⋯]
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
```

`--from` reads the certificate and saves it only when its fingerprint equals the one given.
A remove refuses without `--force`.

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

## Left to the builder

- How the headless launcher starts itself again with the variable, and how the desktop app's
  event channel survives that.
- How the server edition's file stays writable through a Docker file mount. Writing must
  happen in place. Renaming a new file over it breaks a single-file mount.
- The exact names of the audit actions and the stored setting.

## Not proven

**HONEST NON-PROOF.** Three things were read, not run. Each is a first check before building.

1. That a plugin's network call honours `NODE_EXTRA_CA_CERTS`. The call runs in a worker
   thread. Check it against a self-signed HTTPS server.
2. That the desktop app's launcher honours it. The launcher runs on Electron's Node, not
   plain Node.
3. That the file can be written through the server edition's mount.

If check 1 fails, this design does not close G16, and the certificate has to reach the
worker another way. Stop and report.

## Calls made by the designer, for the operator to check

- One page, Network, with two tabs.
- A new certificate needs a restart. The page says which ones are waiting.
- The lists start empty. Nothing is allowed by default, not even this PC.
- The permission is the one connectors use.
- An expired certificate is accepted with a warning.
