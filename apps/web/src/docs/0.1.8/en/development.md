# Development

<!-- operator-platform -->

Run the API, Studio and public site from source. This guide uses `~/Downloads/openldr_ce` on Linux/macOS and `C:\openldr_ce` in PowerShell. Replace them with your checkout path. The blue prompt is already supplied by the terminal; type only the command. Muted lines are output. Configuration snippets name the file to edit and appear once. The pictures illustrate commands; they do not prove a successful installation. Sample data is optional.

## Prepare a separate development checkout

Use a development computer and separate databases. The apps run on your host; Docker runs Postgres, Garage storage and Keycloak. Install Git, Node.js 22.13+ and Docker with Compose. The repository pins pnpm 11.22.0, which requires Node 22.13+. Install pnpm using its [official instructions](https://pnpm.io/installation). If your Node installation includes Corepack, `corepack enable` enables the pnpm launcher. Open a terminal after installing the tools.

### 1. Check the tools

Run each command separately. Version commands print installed versions. `docker info` must also show a responding Server section. Stop if a command is missing or Docker cannot connect.

```sh
{{operator:dev-tools}}
```

![Check the tools.](guide:operator-dev-tools)

### 2. Clone into an unused folder

This example downloads the source into `openldr_ce`. The Linux/macOS Downloads folder must already exist. Choose another existing parent folder if needed. Do not clone over your installed Compose folder.

```sh
{{operator:dev-clone}}
```

![Clone into an unused folder.](guide:operator-dev-clone)

### 3. Enter the checkout

Use your chosen path throughout this page. Every later `pnpm` command runs from this repository root, where `package.json` and `pnpm-workspace.yaml` are present.

```sh
{{operator:dev-folder}}
```

![Enter the checkout.](guide:operator-dev-folder)

### 4. Install workspace dependencies

The lockfile selects the dependency versions. If pnpm reports an unsupported Node version, update Node before retrying. Do not remove the lockfile to bypass an error.

```sh
{{operator:dev-dependencies}}
```

![Install workspace dependencies.](guide:operator-dev-dependencies)

## Configure and initialize the development services

These steps use the manual setup. You do not need the bootstrap script as well. Keep sample data optional.

### 1. Create the local environment file

Copy `.env.example` only if `.env` does not exist. This command preserves an existing file. Check its database URLs before continuing. They must identify your development databases.

```sh
{{operator:dev-copy-env}}
```

![Create the local environment file.](guide:operator-dev-copy-env)

### 2. Generate an encryption key

Node prints a new random key. Copy the output for the next step. Keep an existing key if your database already contains encrypted connector secrets. Replacing it makes those secrets unreadable.

```sh
{{operator:dev-key}}
```

![Generate an encryption key.](guide:operator-dev-key)

### 3. Set development authentication

Edit `.env` in a text editor. Paste your generated key after `SECRETS_ENCRYPTION_KEY=`. The placeholder below is not a key. `AUTH_DEV_BYPASS=true` disables API authentication and opens Studio as a development administrator. Use it only in an isolated development environment. Keep the remaining values from your current `.env.example`, including the Garage development credentials.

```text
{{operator:dev-env}}
```

![Set development authentication.](guide:operator-dev-env)

### 4. Start the backing services

Start Docker first. Run the commands in order. Wait until Postgres accepts connections and storage is healthy. A running container alone does not prove that its service is ready. Inspect `docker compose logs SERVICE_NAME` if readiness fails.

```sh
{{operator:dev-services}}
```

![Start the backing services.](guide:operator-dev-services)

### 5. Migrate and seed the schema

Migration applies pending schema changes without dropping your data. Seeding adds the default definitions, such as forms, workflows and terminology. It does not require loading laboratory sample records. Stop if either command fails.

```sh
{{operator:dev-migrate}}
```

![Migrate and seed the schema.](guide:operator-dev-migrate)

## Run the apps and the CLI

Use a separate terminal for each development server. Enter the same repository root in every terminal. Keep the servers running while using their pages.

### 1. Start the API

The default API address is `http://localhost:3000`. The server prints a warning when authentication bypass is enabled. Read startup errors before opening Studio.

```sh
{{operator:dev-api}}
```

![Start the API.](guide:operator-dev-api)

### 2. Start Studio

Open `http://localhost:5173/studio/`. Studio forwards `/api` requests to port 3000. With development bypass enabled, it opens without sign-in and shows a warning banner. For normal sign-in, see the illustrated [Install guide](/docs/install).

```sh
{{operator:dev-studio}}
```

![Start Studio.](guide:operator-dev-studio)

### 3. Start the public site

Open `http://localhost:5174/`. Studio owns port 5173 and this site owns 5174. Both stop on a port conflict instead of choosing another port. Stop the old process using that port before retrying.

```sh
{{operator:dev-web}}
```

![Start the public site.](guide:operator-dev-web)

### 4. Run the source CLI

The source launcher is `pnpm openldr`, from the repository root. For a recovery command such as `health`, it reads the local `.env` and connects to the backing services. Every other command goes to the API at `OPENLDR_URL`, by default `http://127.0.0.1:3000`, so keep the API from step 1 running. With `AUTH_DEV_BYPASS=true` the API signs these commands in. See [CLI sign-in and access keys](/docs/cli-access). See the [CLI guide](/docs/cli) for commands and file paths.

```sh
{{operator:dev-cli}}
```

![Run the source CLI.](guide:operator-dev-cli)

## Open the dev site from another device

Keep this optional. An unauthenticated development API must remain on a private network. The API already listens on all host interfaces; check your firewall before enabling remote access.

### 1. Set the Vite bind address

Edit `.env`. `0.0.0.0` makes both Vite servers listen on all IPv4 interfaces. You may use your computer's private or Tailscale address instead. `127.0.0.1` only accepts connections from this computer.

```text
{{operator:dev-remote}}
```

![Set the Vite bind address.](guide:operator-dev-remote)

### 2. Restart the dev server

Press Ctrl+C in the Studio terminal, then restart it. Restart the web server too if you need that site remotely. On the other device, open `http://YOUR_PRIVATE_HOST:5173/studio/`, replacing the hostname. Do not enter `0.0.0.0` or `localhost` as the remote address.

```sh
{{operator:dev-restart}}
```

![Restart the dev server.](guide:operator-dev-restart)

## Update or reset a development checkout

Migrate after pulling schema changes. A reset is a separate destructive choice.

### 1. Update without dropping data

Review `git status` first. Commit or set aside your own changes before pulling. Stop if Git or dependency installation fails. Run migration before starting the updated API. `db seed` refuses a schema behind the code; seed cannot replace migration.

```sh
{{operator:dev-update}}
```

![Update without dropping data.](guide:operator-dev-update)

### 2. Check the app you changed

This example checks the public site. Choose the affected package for other changes. The root `pnpm test`, `pnpm typecheck` and `pnpm build` run the workspace tasks. Rust plugin tests run separately.

```sh
{{operator:dev-check}}
```

![Check the app you changed.](guide:operator-dev-check)

### 3. Reset only a disposable database

Optional and destructive. Check both database URLs first. This drops and recreates the development schema, then seeds definitions. Do not use it to repair a missing migration. `pnpm e2e:seed` and `pnpm docs:seed` also reset data and build plugins; they are optional test fixtures, not normal setup. Each has a reset half that needs no API and a load half that goes through the running API. The load half needs `AUTH_DEV_BYPASS=true`, because the reset leaves no account or key to sign in with. Run them in the order `e2e/README.md` gives. That order was not run.

```sh
{{operator:dev-reset}}
```

![Reset only a disposable database.](guide:operator-dev-reset)

## Use the bootstrap instead of manual setup

Use this alternative on an isolated development installation. The script writes `.env` only when absent. A new `.env` triggers a database reset, even if its default database already exists. An existing `.env` skips reset unless requested. Check this behavior before running it near existing databases.

### 1. Download the bootstrap

Download into a scratch folder. Select the correct platform above. Downloading the file does not run it.

```sh
{{operator:dev-bootstrap-download}}
```

![Download the bootstrap.](guide:operator-dev-bootstrap-download)

### 2. Read before running

Read the downloaded file. In `less`, press q to exit. Check the clone directory, `.env` creation and database-reset conditions. If you already followed manual setup, skip this alternative.

```sh
{{operator:dev-bootstrap-read}}
```

![Read before running.](guide:operator-dev-bootstrap-read)

### 3. Run with an explicit destination

Use a new development folder. The script installs dependencies, starts backing services and initializes the fresh database. It does not start the API or Studio dev servers. Continue with Run the apps above. Do not add the sample-data flag unless you want its destructive test setup.

```sh
{{operator:dev-bootstrap-run}}
```

![Run with an explicit destination.](guide:operator-dev-bootstrap-run)

## Build and test a reference plugin

Optional. Install Rust using [rustup](https://rustup.rs). Reopen the terminal if `cargo` is missing. Use a development installation for the test plugin.

### 1. Add the WebAssembly target

Run from the repository root. The current plugins use `wasm32-wasip1`. No laboratory sample data is required.

```sh
{{operator:dev-rust}}
```

![Add the WebAssembly target.](guide:operator-dev-rust)

### 2. Build the test plugin

This pure Rust example needs no WHONET C toolchain. The script writes `plugin.wasm` and `manifest.json` into `reference-plugins/test-sink/`.

```sh
{{operator:dev-plugin-build}}
```

![Build the test plugin.](guide:operator-dev-plugin-build)

### 3. Run its Rust tests

The workspace JavaScript test command does not run these Rust tests. Test the Rust package whenever you change it.

```sh
{{operator:dev-plugin-test}}
```

![Run its Rust tests.](guide:operator-dev-plugin-test)

### 4. Install only into your test system

These commands write to the development plugin registry and storage. They go through the running API, so keep it running, signed in by `AUTH_DEV_BYPASS=true` or by `pnpm openldr login`. Check `.env` first. Before running them, set `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` in the isolated test `.env` and restart the API. Keep the adjacent manifest with the WASM file. The development build is unsigned; use the documented unsigned-development setting only in an isolated test system. Normal installations should use approved signed bundles.

```sh
{{operator:dev-plugin-install}}
```

![Install only into your test system.](guide:operator-dev-plugin-install)

## Bootstrap options and build commands

| Linux/macOS | PowerShell | Effect |
| --- | --- | --- |
| `--dir PATH` | `-Dir PATH` | Choose the checkout folder. |
| `--branch NAME` | `-Branch NAME` | Choose the branch for a new clone. |
| `--no-services` | `-NoServices` | Skip Docker and database initialization. |
| `--reset-db` | `-ResetDb` | Reset an existing development database. Destructive. |
| `--seed` | `-Seed` | During initialization, run the destructive WHONET sample setup. Requires its build tools. If anything listens on port 3000, the script stops before it installs or changes anything. On a fresh setup or with `--reset-db`, it then builds the sample and the plugins. It resets and seeds the database, then resets it again. Then it starts its own API on port 3000 and loads the sample through it. It checks port 3000 again before each reset and before the API starts, and stops if anything listens there. After the first reset, a stop at a check or at the API start says the database was reset and how to run it again. A failed load ends with only `seed load failed`. The load needs `AUTH_DEV_BYPASS=true` in `.env`, and no `OPENLDR_KEY` or `OPENLDR_KEY_FILE` in your shell. The API stays running. Not tested. |

`pnpm build:ui-reference` builds the reference plugin with a page, card and side panel. `pnpm build:v1-import` builds the v1 importer. `pnpm build:plugins` builds WHONET and the other reference plugins. WHONET also needs clang and a WASI sysroot.

To install an unsigned local build in an isolated test system, set `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` in its `.env` and restart the API. Keep this off on normal installations. See [Environment variables](/docs/environment).

## A plugin's card and side panel

A plugin with its own page (`ui.entry` in its manifest) can also draw that page as a card on the dashboard and as a side panel. Declare them under `ui.sites`:

**`manifest.json`, excerpt**

```json
"ui": {
  "entry": "ui.html",
  "sha256": "<sha256 of ui.html>",
  "nav": { "label": "Bench notes" },
  "sites": {
    "widget": { "title": "Today", "height": "small" },
    "panel": { "title": "Bench notes" }
  }
}
```

- Both are optional. `height` is `small`, `medium` or `large`: 160, 240 or 360 px tall. The default is `medium`.
- Titles are 1 to 60 characters.
- `ui.sites` is part of the signed manifest, so the signature covers it. Bundles signed before it existed still verify.
- The plugin ships one `ui.html`. After `await openldr.ready`, read `openldr.site`. It is `page`, `widget` or `panel`. Draw the view for that place.
- Every place uses the same broker calls, the same storage and the same role gate, `ui.requiredRoles`.

The studio's Docs explain what users see, in **Plugin cards and side panels**.

## Contributing

Fork the repository and create a feature branch. Run the relevant tests, type checks and builds. Open a pull request against `main` with the change and its validation.

Async server routes must `return reply.send(...)`. Use `await reply.send(...)` when a helper needs another return value. A bare or `void` call does not wait for asynchronous compression and can send an empty body. The explanation is at the top of `apps/server/src/sync-routes.ts`.

`pnpm --filter @openldr/server lint` checks this with `openldr/require-return-reply-send`. Test large responses through real HTTP when changing response handling. Small unit-test payloads do not exercise asynchronous compression.
