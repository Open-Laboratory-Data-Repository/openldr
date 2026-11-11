# Studio customization and helper plugins: design draft

Status: DRAFT for operator review. No code written. Open questions are at the end.

## 1. The request

The operator asked for two things:

1. Make studio customizable, in the spirit of DeepSeek Harness and Claude Code mods.
2. Add plugins that help users with migration, setup, and checks. Connecting to a source
   database "has been tricky".

This draft checks each claimed gap first (AGENTS.md RULE 0), then proposes slices.

## 2. What is already there (checked)

| Claim in the brief | Verdict | Proof |
|---|---|---|
| Only DHIS2 has been tested as a plugin | REFUTED | Integration tests exist for hl7v2, tabular, whonet, and the workflow nodes: `packages/plugins/src/*-wf-convert.integration.test.ts`. The marketplace repo publishes four signed plugins: dhis2-sink, hl7v2, tabular, whonet-sqlite. DHIS2 is the only **sink with a UI** that has been tested. |
| CE cannot talk to a source database | REFUTED | Host connectors for Postgres, SQL Server and MySQL exist: `packages/bootstrap/src/connector-db.ts:55`. The workflow Database node uses them: `packages/workflows/src/engine/node-handlers/connector-sql.ts:9`. |
| A plugin cannot talk to a source database | CONFIRMED | WASM plugins get only HTTP egress. The only host functions are `http_request`, `log`, `progress`: `packages/plugins/src/extism-runner.ts:63`. A plugin cannot open a TCP socket, so it cannot reach SQL Server. The broker has no op to run SQL on a host connector: `packages/plugin-ui-sdk/src/types.ts:11`. |
| Studio has no per-user customization | CONFIRMED | Theme and sidebar state live in browser `localStorage` only: `apps/studio/src/shell/ThemeProvider.tsx:7`, `apps/studio/src/shell/useSidebar.ts:3`. They do not follow the user to another device. No preferences table exists in `packages/db/src/migrations/internal/`. |
| Plugins can only add a page | CONFIRMED | A plugin UI declares one `nav` entry and renders at `/x/:pluginId`: `packages/marketplace/src/artifact-manifest.ts:18`, `apps/studio/src/App.tsx:90`. |
| There is no setup or health check page in studio | CONFIRMED | `openldr health` exists on the CLI only: `packages/cli/src/program.ts:98`. Studio has no page that lists what is missing in a new install. |

## 3. Why the database connection is hard

I found six causes in the code. I do not know which one the operator hit. That is
question 1 at the end.

1. **Named instances are not supported.** DISA and v1 often run as `SERVER\SQLEXPRESS` or
   a similar named instance. The SQL Server connector has no `instanceName` field:
   `packages/bootstrap/src/connector-config.ts:14`,
   `packages/adapter-mssql-store/src/index.ts:42`. Tedious supports it; we never pass it.
2. **Windows login is not supported.** Auth is hardcoded to SQL login (`type: 'default'`):
   `packages/adapter-mssql-store/src/index.ts:43`. Many lab SQL Servers only allow Windows
   (domain) accounts. Tedious supports NTLM with a domain.
3. **Encryption is on by default.** `encrypt: config.encrypt !== 'false'`
   (`connector-db.ts:88`). An old SQL Server (2008, 2012) offers only old TLS, and Node's
   OpenSSL 3 refuses it. The cdr-toolchain docs tell users to add `Encrypt=false` for this
   reason (`cdr-toolchain/CDR_TOOLCHAIN.md:721`).
4. **The Test button gives a raw driver error.** `connector-test.ts:22` runs `select 1` and
   throws whatever tedious says. "Failed to connect in 15000ms" does not say whether DNS,
   the port, the firewall, TLS, or the login failed.
5. **The host connector is built for reports, not bulk reads.** Every query has a 30 second
   cap and a 10,000 row cap (`connector-db.ts:60`, `connector-sql-service.ts:8`). A
   migration of millions of rows cannot run through it as it is.
6. **CE runs in Docker.** `localhost` inside the container is the container, not the lab
   server. Nothing in the connector form says so.

The old DISA extension (`openldr-v2-extensions/openldr-ext-disa-migration`) tried a third
route: `tds_fdw` inside Postgres. That needs a superuser and a compiled Postgres extension
on the target. The cdr-toolchain CLI works because it runs on a laptop with direct network
reach and a free-form connection string.

## 4. Proposed design

### 4.1 Rule for where code lives

Database access stays on the host, in `@openldr/bootstrap`. A plugin never opens a
connection. A plugin asks the host, through the broker, to read from a connector the admin
already set up and granted to it. This keeps credentials out of WASM and reuses one
connector code path for the UI, the CLI, workflows, and plugins (AGENTS.md §6.2).

### 4.2 Part A: helper plugins

**A1. Connection fixes and a step-by-step diagnosis (host, not a plugin).**
- Add `instanceName` and `domain` to the SQL Server connector. A domain means NTLM login.
- Add a diagnosis that runs in order and stops at the first failure: resolve name, open
  TCP port (or ask SQL Browser on UDP 1434 for a named instance), TLS handshake, login,
  open database, run `select 1`, read server version. Each step returns pass or fail and
  one plain hint. Example: "Port 1433 did not answer. Check the Windows firewall on the
  SQL Server, or that TCP/IP is enabled in SQL Server Configuration Manager."
- Studio: "Diagnose" item in the connector row's ⋯ menu. Results in a Sheet.
- CLI: `openldr connectors diagnose <id>`.
- Broker op `connectors.diagnose` so plugins can show the same result.
- This is the part that fixes "connecting has been tricky". It is a host change, because
  a plugin cannot do it (section 2).

**A2. Paged source reads for plugins (host).**
- New broker op `sources.read` under a new capability `host:source-read`. It runs a
  SELECT on a granted host connector with keyset paging (`where key > :last order by key`)
  and returns one page plus the last key. No 10,000 row ceiling across pages; each page
  is still capped and still SELECT-only through `validateSelectSql`.
- The admin grants a connector to a plugin at install time, like egress hosts today.

**A3. OpenLDR v1 import plugin.**
- First migration source: OpenLDR v1 (plain SQL tables). The mapping already exists and is
  tested in `cdr-toolchain/apps/v1-push` (`read.ts`, `to-payload.ts`, `ast-payload.ts`).
- Webview plugin with a wizard: pick connector, run diagnosis, pick date range and
  facilities, dry run (counts only), then import. Shows progress, can stop and resume.
- The host reads pages through A2. The plugin's WASM maps rows to CE records. The host
  sends the records into the existing ingest path. Resume state lives in `plugin_data`,
  so no new table.
- DISA comes after v1. DISA needs the `disalab` blob decoder compiled into the plugin. That
  is a separate slice once v1 works end to end.

**A4. Setup checks.**
- A "Setup" page that lists what a new install still needs, each with a link to fix it:
  lab identity set, time zone set, at least one facility, test catalog mapped,
  terminology loaded, adapters healthy (reuses `ctx.health.runAll`), connectors pass
  diagnosis, sync configured if this is a site.
- CLI: `openldr doctor` prints the same list.
- Plugins can add their own checks through an optional `checks` entrypoint. Example:
  dhis2-sink adds "DHIS2 reachable and metadata pulled".
- My call: the page is built in, not a plugin, because almost every check reads host
  state that the broker does not expose. Plugins extend it.

### 4.3 Part B: customization

What the two references do, in short:
- **DeepSeek Harness** treats every part, the UI included, as a plugin you can switch on
  or off. It ships preset modes (Standard, Code, Minimal, Creator).
- **Claude Code mods** let user-made pieces appear at fixed places: a side pane, a toast,
  a band above the prompt, a status line. An admin can restrict which mods load.

What maps onto studio:

**B1. Per-user preferences, stored on the server.**
- Theme, density, accent color, home page, sidebar order, hidden sidebar items, pinned
  items. Saved per user, so they follow the user to a phone.
- Needs migration `113_user_preferences` (one row per user, one JSON column).
- Settings > Appearance page, label left and input right (§5).
- CLI: `openldr prefs show|set <user>` for admin resets.

**B2. More places a plugin can appear.**
- Today a plugin gets one page. Add two places to start: a **dashboard widget** (a plugin
  card on the home dashboard) and a **right side panel** that stays open across pages.
- Declared in the manifest under `ui.sites`. Optional and additive, so existing signed
  bundles stay valid.
- Admin can switch any plugin's sites off, like the mod restriction.

**B3. Presets.**
- Named layouts that set the sidebar and home page in one step. Example: "Bench" (forms,
  patients), "Data" (query, reports, dashboards), "Admin". An admin can set the default
  preset per role.
- My call: lowest priority. It builds on B1 and only matters if many users share a role.

Not proposed: hiding whole studio areas lab-wide. Capabilities and feature flags already
hide pages by role.

## 5. Slices

Each slice ships UI, CLI, docs in en/fr/pt, and a mobile check (§6). Order is my
recommendation.

| # | Slice | Area touched | New migration |
|---|---|---|---|
| 1 | SQL Server named instance, Windows login, encryption hint in the form | bootstrap connector files, `adapter-mssql-store`, Connectors page | no |
| 2 | Connector diagnosis: host steps, ⋯ menu Sheet, CLI, broker op | bootstrap, Connectors page, cli, plugin-broker | no |
| 3 | Setup page and `openldr doctor` | studio, bootstrap, cli, server route | no |
| 4 | Paged source reads for plugins (`host:source-read`) | plugin-broker, marketplace capabilities, plugin-ui-sdk | no |
| 5 | OpenLDR v1 import plugin (new package, signed bundle) | new plugin package, marketplace | no |
| 6 | Per-user preferences and Appearance page | studio shell, server route, db | yes, 113 |
| 7 | Plugin dashboard widget and side panel | marketplace manifest, studio shell, plugin-ui-sdk | no |
| 8 | DISA import plugin | new plugin package | no |
| 9 | Presets | studio, server | maybe |

Files outside my assigned area: slice 1 edits `packages/adapter-mssql-store`. Slices 6 and
7 edit `apps/studio/src/shell/AppShell.tsx`. Slice 6 needs `packages/db` for migration 113.
I will not touch these until the coordinator says yes.

Docs: another session owns `apps/studio/src/docs`, `apps/web/src/docs`, and
`apps/web/public/docs-images`. Each slice adds new doc files only and edits no existing
page. Guides are listed by hand in `apps/studio/src/docs/registry.ts`, so a new file does
not show up until it has an entry there. I will not edit `registry.ts`. Each slice report
names the new files and gives the registry entry for the coordinator to add.

## 6. Non-goals

- No direct database access from WASM. No `tds_fdw`.
- No write access to a source database. Reads only.
- No cloud SQL support (already a stated rule in `supported-versions.ts`).
- No rewrite of the cdr-toolchain CLI. It keeps working for labs that prefer it.

## 7. Left to the builder

- The PDK language for the v1 plugin. The v1 mapping is TypeScript, so the Extism JS PDK
  is the first thing to try. The builder must check that the existing plugins' source
  (not found in this repo; only `reference-plugins/ui-reference` is tracked) does not
  already fix a language.
- Exact hint wording for each diagnosis step.
- Page size for `sources.read`.

## 8. Open questions for the operator

1. When the connection failed, what did you see? The server name (with `\SOMETHING`?), the
   login type (Windows or SQL), and the error text would tell us which of the six causes
   it was.
2. Should the import run inside CE (the CE server must reach the source DB over the
   network), or should the plugin only guide a run of the cdr CLI on a laptop?
3. Preferences: per user, or one lab-wide look set by an admin, or both?
4. Which slices do you want, and in what order?

### Operator answers, 2026-11-11

1. The connection works. The "OpenLDR v1 (Moz)" SQL Server connector tests OK. So for v1 the hard
   part is not the connection; it is getting the data across. Slices 1 and 2 still help labs with
   named instances or Windows logins, but they did not fix a failure the operator was seeing.
2. The import runs inside CE, so there is one tool to manage. Slices 4 and 5 go ahead as designed.
3. Theme is per user. That is already how it works: the header toggle saves light or dark per
   browser (`ThemeProvider.tsx:5`), and language does the same (`openldr.lang`).
   Checked in the running app on 2026-11-11, not only in code:
   - Sidebar order is fixed in code (`AppShell.tsx:25`). No drag or reorder exists. Roles hide items.
   - The first page is always the Dashboard (`App.tsx:41`). No setting exists.
   - Sidebar collapse is saved per browser (`useSidebar.ts:3`).
   So slice 6 would add three things: settings that follow the user to another device, a sidebar
   the user can reorder or trim, and a choice of first page. No user action is broken without
   them. Slices 6 and 9 are on hold until the operator names one of these as wanted.
4. Slices 1 and 2 were picked first and are built.

