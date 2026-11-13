# @openldr/e2e — end-to-end + visual-verification harness

Browser E2E over the dashboard SPA served by the real `apps/server` + Docker stack,
plus an agent-driven visual-verification gallery. Satisfies P1-NFR-5.

## One-time setup (this machine)

Chromium downloads need a mirror — the direct Playwright CDN (`storage.googleapis.com`)
times out here. The install script sets `PLAYWRIGHT_DOWNLOAD_HOST` to npmmirror and the
package pins `@playwright/test@1.57.0` (Chromium rev 1200, Chromium 143 — the newest
Playwright release with both chromium and chromium-headless-shell mirrored on npmmirror;
1.58.0+ (rev 1208+) 404s on the mirror).

The reports **PDF Document tab** uses `pdfjs-dist@6`, which calls
`Map.prototype.getOrInsertComputed` — native only in Chromium >= 144. Chromium 143 has it
behind V8's `--harmony` flag, so `playwright.config.ts` launches Chromium with
`--js-flags=--harmony`; otherwise the Document tab throws `getOrInsertComputed is not a
function` and never renders. (Production hardens real browsers via the app's own
Uint8Array hex/base64 polyfill — a separate concern that stays.)

    pnpm install
    pnpm e2e:install-browsers

> The ECC Playwright **MCP** is NOT used here — it runs in extension-bridge mode and
> needs a Chrome extension that isn't installed. This harness uses the repo's Playwright
> and writes screenshots to disk for an agent to read.

## Bring up + seed the stack

The seed has two halves. The reset half (`pnpm e2e:seed:reset`) makes the sample, builds the
plugin and runs `db reset`, which works on the database itself and needs no server. The load
half (`pnpm e2e:seed:load`) runs `plugin install` and `ingest`. Those are sent through the
running app at `OPENLDR_URL`, by default `http://127.0.0.1:3000`, signed in by the server's
`AUTH_DEV_BYPASS=true`. That must be the server running on the database that was just reset.
Nothing checks this: a server from another checkout on port 3000 would take the load instead.

The safe order:

    docker compose up -d        # 1. Postgres / storage (Garage) / Keycloak (git-ignored override ports)
                                # 2. stop the API if one runs on this database
    pnpm e2e:seed:reset         # 3. make sample -> build plugin -> db reset
    pnpm -C apps/server dev     # 4. in another terminal: the API boots on the fresh schema
    pnpm e2e:seed:load          # 5. install plugin -> ingest WHONET, through that API

Without a server in step 5, the load stops with
`Cannot reach OpenLDR at http://127.0.0.1:3000. Is it running?`. For an API on another port,
set `OPENLDR_URL` to its address for step 5.

`pnpm e2e:seed` runs both halves in one line. It resets the schema under a server that is
already running, and whether a running server copes with that was not checked. Use it only when
you accept that. `pnpm docs:seed` works the same way, with `pnpm docs:seed:reset` and
`pnpm docs:seed:load`.

The seed needs Docker up and the Rust/wasi toolchain (for `build:plugins`).

## Run

    pnpm e2e          # 5 deterministic smoke specs (pass/fail)
    pnpm verify:ui    # capture screenshots -> e2e/artifacts/screenshots/

Both build the SPA + server first. Playwright's `webServer` then starts the built server, but
only when nothing answers on its port yet (`reuseExistingServer`). If the dev server from the
seed steps is still running, Playwright uses that one and the built server is not started. If
the DB isn't seeded, `globalSetup` fails fast with the commands to run.

## Agent visual verification

After `pnpm verify:ui`, an agent reads each PNG in `e2e/artifacts/screenshots/` and
judges it against `rubric.md`, reporting PASS/notes per screen.

## Layout

- `playwright.config.ts` — chromium-only, headless; `webServer` (built server, cwd repo root); two projects (`smoke`, `capture`).
- `global-setup.ts` — precondition guard (DB seeded + reachable).
- `support/config.ts` — PORT/baseURL (single source).
- `tests/smoke.spec.ts` — health, dashboard, AMR 100%R on AMP, CSV export, 404.
- `capture/capture.spec.ts` — the screenshot matrix.
- `rubric.md` — what each screen should look like.
- `artifacts/` — gitignored (screenshots, html report, traces).

## License

Part of OpenLDR CE, released under the **Apache License 2.0**. See the [`LICENSE`](../LICENSE) at the repository root.
