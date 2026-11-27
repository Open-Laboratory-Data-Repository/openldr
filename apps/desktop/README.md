# @openldr/desktop

The OpenLDR desktop app. It is an Electron app that wraps the standalone launcher
(`apps/standalone`). It starts the launcher as a child process, shows Studio in a window, and
stops OpenLDR through the launcher's `stop` command when you quit.

The app starts its launcher with `--host 127.0.0.1`, and the window loads Studio at
`http://127.0.0.1:<port>/studio/`. The tray's **Share on the lab network** box makes the app start
its launcher with `--share` as well. The launcher then opens an HTTPS front on port 3443 for other
PCs, and the server itself still listens on `127.0.0.1` only. The app asks before it turns sharing
on, saves the choice in its settings file, and restarts its launcher to apply it. The app's own log is `desktop.log` in its own folder. `OPENLDR_DESKTOP_USER_DIR`
below names that folder. The web docs page `apps/web/src/docs/0.1.8/en/desktop-app.md`
is the guide for people who install the app.

## The two ways the app runs

The app runs in one of two ways, saved as `mode` in its settings file.

- `local`: this PC holds the lab's data. The app starts its launcher, as described above.
- `connect`: the app shows an OpenLDR that runs on another PC. It starts no launcher, no server and
  no database. The settings file holds the server's address and, for a certificate the system does
  not trust, the fingerprint the person accepted.

A first start on a PC with no install asks which one. A PC that already has an install stays
`local` without a question. The tray switches between them, and asks first.

In connect mode the app accepts one certificate beyond what the system trusts: the saved one, for
the saved host only. Electron asks its certificate check once per certificate in a session and
keeps the answer until the app ends. Nothing clears it (proved on Electron 45 on 2026-11-27). So
the app checks a server in a session of its own, made for that fingerprint, and tells the window's
session the fingerprint only when Studio is about to be shown. If the window still refuses a
certificate that such a check accepts, the app starts itself again once.

Studio's two calls to the app (`setupCode` and `info`) are refused in connect mode, and the page is
not given the object that holds them.

Electron keeps a yes about a certificate as well as a no. So when an accepted certificate is left
(Change server) or replaced (the server's certificate changed), the app starts itself again before
it shows Studio. The new server is already saved, so the new process goes straight to it.

Switching mode from the tray asks once, saves the new mode, and quits the normal way. The app is
started again only when that quit ended with code 0. If OpenLDR on this PC did not stop, the old
mode is put back.

## The lock

**Lock this PC to OpenLDR...** in the tray asks for a PIN and saves a salted scrypt hash of it as
`lock` in the settings file. While locked, the window is in kiosk mode, closing it does nothing,
links to other sites are dropped, and the tray holds Open, Unlock and Quit only. `Ctrl+Shift+L`
asks for the PIN to unlock. The PIN is asked in a small window on top, so Studio keeps what was
typed.

Quit from the tray, the app menu or `Ctrl+Q` asks for the PIN. A shutdown, a sign-out and a
signal quit without it. Electron reports a signal as a plain `before-quit`, the same as a session
that ends, so the app cannot tell them apart (seen on Linux on 2026-11-27).

The lock stops a casual user. Someone who can edit the settings file with the PC's account can
remove `lock`, and that is also how a forgotten PIN is recovered.

This package is private. It is never published.

## Serial ports

A plugin page that holds `host:serial` can ask Studio for a serial port, and Studio asks the
browser. In the app, the browser asks the app: `select-serial-port` fires on the window's session.
The app shows its own small window with the PC's ports, and answers with the row a person pressed.
It never answers with a port nobody pressed, not even when the list has one row.

A request is shown only when it comes from the main window, on the address the app trusts:
OpenLDR on this PC, or the https server it is connected to. The `serial` permission is granted to
that address and to no other. The name of the port chosen last time is saved as `lastSerialPort`,
only to mark that row the next time.

No device permission handler is set. One that says yes to serial devices hands a page every port
with no choice made (seen in Electron 45 on 2026-11-27). Electron names the window that asked, not
the frame, so the app cannot tell the main frame from a frame inside it on the same address.

## Build and start from a checkout

The app runs the built launcher at `apps/standalone/dist/index.js`, and the launcher serves the
built Studio. Build all three:

```bash
pnpm install
pnpm --filter @openldr/desktop exec install-electron   # fetches the Electron binary once
pnpm --filter @openldr/studio build
pnpm --filter @openldr/standalone build
pnpm --filter @openldr/desktop build
```

Then start it:

```bash
pnpm --filter @openldr/desktop start
```

On Ubuntu 24.04 and later, Electron's sandbox needs an AppArmor profile that a checkout does not
install. For development there, `pnpm --filter @openldr/desktop dev` starts it with
`--no-sandbox`. A packaged app never turns the sandbox off.

## Pack the app

Build the three packages as above, then:

```bash
pnpm pack:desktop all        # or linux-x64, darwin-arm64, win32-x64
```

This writes one archive per system and a `SHA256SUMS` file to `dist/desktop/v<version>/` at the
repo root. `--out <folder>` puts them under another folder. The version is the root
`package.json` version.

Packing runs on Linux only. It needs symbolic links, file modes and GNU tar. The macOS and
Windows archives need the network once: Electron's zips and the two Postgres packages are
downloaded and checked against `checksums.json` and `pnpm-lock.yaml`. Only the Linux archive has
been started here. The macOS and Windows archives are not proven and wait for a run on those
systems.

## Environment overrides

These are for development and tests only.

| Variable | What it does |
|---|---|
| `OPENLDR_DESKTOP_DATA_DIR` | The data folder, passed to the launcher as `--data-dir`. Without it the launcher uses its own default. |
| `OPENLDR_DESKTOP_PORT` | Use exactly this port. The app remembers nothing. |
| `OPENLDR_DESKTOP_USER_DIR` | The app's own folder (settings, log, browser profile). Without it, `OpenLDR Desktop` under the system's app data folder. |
| `OPENLDR_DESKTOP_SERVER` | A server address. The app runs in connect mode with it, unless a mode is already saved. It is never written to the settings file. |
| `OPENLDR_DESKTOP_SELFCHECK` | A file path. The app writes one JSON object there about what it shows, with its `mode` and `childProcesses`, the count of processes it started itself. It then does what `OPENLDR_DESKTOP_SELFCHECK_THEN` says, and quits when that is not set. |
| `OPENLDR_DESKTOP_SELFCHECK_THEN` | What the app does after it writes the self-check file: `close` closes the window and keeps running, `stay` does nothing. Without it, the app quits. |

From a worktree, also set `OPENLDR_SKIP_ENV_FILE=true`. Otherwise the server finds the main
checkout's `.env` and its databases.

## Tests

```bash
pnpm --filter @openldr/desktop test
pnpm --filter @openldr/desktop typecheck
```
