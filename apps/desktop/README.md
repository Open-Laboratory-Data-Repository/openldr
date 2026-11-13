# @openldr/desktop

The OpenLDR desktop app. It is an Electron app that wraps the standalone launcher
(`apps/standalone`). It starts the launcher as a child process, shows Studio in a window, and
stops OpenLDR through the launcher's `stop` command when you quit.

The app starts its launcher with `--host 127.0.0.1`, and the window loads Studio at
`http://127.0.0.1:<port>/studio/`. The app's own log is `desktop.log` in its own folder. `OPENLDR_DESKTOP_USER_DIR`
below names that folder. The web docs page `apps/web/src/docs/0.1.8/en/desktop-app.md`
is the guide for people who install the app.

This package is private. It is never published.

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
| `OPENLDR_DESKTOP_SELFCHECK` | A file path. The app writes one JSON object there about what it shows. It then does what `OPENLDR_DESKTOP_SELFCHECK_THEN` says, and quits when that is not set. |
| `OPENLDR_DESKTOP_SELFCHECK_THEN` | What the app does after it writes the self-check file: `close` closes the window and keeps running, `stay` does nothing. Without it, the app quits. |

From a worktree, also set `OPENLDR_SKIP_ENV_FILE=true`. Otherwise the server finds the main
checkout's `.env` and its databases.

## Tests

```bash
pnpm --filter @openldr/desktop test
pnpm --filter @openldr/desktop typecheck
```
