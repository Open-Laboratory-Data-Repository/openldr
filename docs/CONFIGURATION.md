# OpenLDR CE Configuration Reference

Source of truth: `packages/config/src/schema.ts`.

## Gateway And Public Addressing

These variables control the nginx gateway's public identity and TLS behaviour. `pnpm run init`
writes all of them into `.env.prod`; you can also set them manually.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `SERVER_NAME` | hostname or IP | `localhost` | nginx `server_name` and the hostname used in the TLS certificate subject. |
| `PUBLIC_ORIGIN` | URL | `https://localhost` | The fully-qualified public origin (scheme + host + optional port). Used to construct absolute URLs in emails and OIDC redirects. |
| `GATEWAY_HTTP_PORT` | positive integer | `80` | Host port mapped to nginx's HTTP listener (redirects to HTTPS). |
| `GATEWAY_HTTPS_PORT` | positive integer | `443` | Host port mapped to nginx's HTTPS listener. |
| `TLS_MODE` | `self-signed\|letsencrypt\|bring-your-own` | `self-signed` | TLS provisioning mode. `self-signed` generates a cert via `gen-selfsigned.sh`; `letsencrypt` uses Certbot (requires a public DNS record); `bring-your-own` reads pre-placed certs from `deploy/nginx/certs/`. |
| `LETSENCRYPT_EMAIL` | email | unset | Required when `TLS_MODE=letsencrypt`. Passed to `certbot certonly` for expiry notifications. |

### App-side settings the gateway makes necessary

These are read by the app, not by nginx, but only matter once a gateway fronts it. Unlike the
table above, `pnpm run init` does not write them. They come from `.env.prod.example`, or from
`install/install.sh` and `install.ps1`, which write all three.

The two certificate settings point in opposite directions. `TLS_CERT_PATH` hands **this**
server's certificate out, so a remote lab can trust this central. `NODE_EXTRA_CA_CERTS` takes a
central's certificate **in**, so this lab can reach that central.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `TRUST_PROXY` | hop count, `true`, or an IP/subnet list | unset | How much of `X-Forwarded-For` to trust, passed to Fastify's `trustProxy`. Unset means trust none, so `req.ip` is the direct socket peer. Behind the single gateway that peer is the gateway's own container IP, which makes the `auth.failed` audit useless for tracing a real client. Set `1` for one hop. SECURITY: only set it when a trusted proxy really does front the app, or a client can spoof its own IP through the header. |
| `TLS_CERT_PATH` | path | unset | Path, inside the API container, to this server's public TLS certificate. When set and readable, `GET /api/settings/sync/central-certificate` serves it so a remote lab can trust a self-signed central. It needs a matching volume mount: `deploy/install/docker-compose.yml` has one, `docker-compose.prod.yml` does not. Unset and unreadable both return 404. |
| `NODE_EXTRA_CA_CERTS` | path | unset | Read by Node itself, not by our code. Extra trusted CAs, so sync to a self-signed central works instead of failing with a bare `fetch failed`. Same mount situation as `TLS_CERT_PATH`. Create the host file before `docker compose up` even if empty: bind-mounting a path that does not exist makes Docker create a **directory** there, and the api then fails to start. An empty file is valid and means no extra CAs are trusted yet. |

### OIDC and Keycloak gateway vars

Keycloak is proxied by nginx at `/auth`. The application accesses it two ways:

- **Browser (front-channel):** via the public `OIDC_ISSUER_URL`, for example `https://HOST/auth/realms/openldr`. This is the issuer embedded in tokens and used for OIDC discovery.
- **Server (back-channel token/admin/JWKS):** via `OIDC_INTERNAL_ISSUER_URL`, the docker-internal realm base, which avoids the gateway and the need to trust a self-signed cert. `OIDC_INTERNAL_JWKS_URL` is a sibling that overrides just the JWKS endpoint when it differs from `OIDC_INTERNAL_ISSUER_URL` + `/protocol/openid-connect/certs`. Either way, the issuer **claim** is still validated against the public `OIDC_ISSUER_URL`.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `OIDC_ISSUER_URL` | URL | required | Public Keycloak realm issuer, e.g. `https://HOST/auth/realms/openldr`. Must match the token `iss` claim. |
| `OIDC_INTERNAL_ISSUER_URL` | URL | unset | Back-channel Keycloak realm base, e.g. `http://keycloak:8080/auth/realms/openldr`. When set, server-side token/admin REST/JWKS calls use it instead of the public issuer (which, inside a container, resolves to the app itself). |
| `OIDC_INTERNAL_JWKS_URL` | URL | unset | Back-channel JWKS endpoint, e.g. `http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs`. When set the server fetches signing keys over the docker network, bypassing the gateway TLS cert. Overrides the JWKS URL derived from `OIDC_INTERNAL_ISSUER_URL`. |
| `KC_HOSTNAME` | URL | `https://localhost/auth` | Keycloak's advertised external hostname (Keycloak v2 `hostname` setting). Must be `PUBLIC_ORIGIN + /auth`. |

## Required Core Settings

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `NODE_ENV` | `development\|test\|production` | `development` | Controls production safeguards, especially auth bypass. |
| `PORT` | positive integer | `3000` | HTTP server port. |
| `LOG_LEVEL` | string | `info` | Logger verbosity. |
| `INTERNAL_DATABASE_URL` | URL | required | Operational PostgreSQL database for users, audit, eventing, plugins, workflows, forms, marketplace, and schedules. |
| `TARGET_STORE_ADAPTER` | `pg\|mssql\|mysql` | `pg` | Analytics warehouse adapter. |
| `TARGET_DATABASE_URL` | URL | required when `TARGET_STORE_ADAPTER=pg` | PostgreSQL analytics warehouse. |
| `WEB_DIST_DIR` | path | `apps/studio/dist` relative to built server | Overrides where the server serves the built SPA from. This is read directly by `apps/server/src/app.ts`. |
| `OPENLDR_VERSION` | image tag | `latest` | GHCR tag the stack pulls. Read by compose, not by the app. In `deploy/install/docker-compose.yml` it pins all five images, so it sets the whole stack's version. In `docker-compose.prod.yml` it pins only Keycloak, because api, studio and web are built from source there. |

## Startup Flags

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MIGRATE_ON_START` | boolean string: `true`, `false`, `1`, `0` | `false` | Runs internal and external migrations before binding the server. |
| `SEED_ON_START` | boolean string | `false` | Seeds sample operational data (and the bundled license-safe terminology, see below) after migration. Idempotent. |

## Bundled Terminology

On a fresh install the seed (`openldr db seed`, or `SEED_ON_START=true`) auto-imports two
**license-safe, freely-redistributable** terminology sets so Forms coded-field authoring works
out of the box. The import is **idempotent** (skipped once already present) and **best-effort**
(a terminology-import failure logs a warning and never aborts the rest of the seed):

- **HL7 FHIR R4 base ValueSet catalog.** The FHIR R4 value sets, imported via the FHIR catalog
  path (`packages/db/fixtures/fhir/R4.valuesets.json.gz`).
- **Full UCUM code system.** Every UCUM atomic unit and prefix as a FHIR `CodeSystem`
  (`http://unitsofmeasure.org`), generated from `ucum-essence.xml` by
  `scripts/make-ucum-codesystem.mjs` (`packages/db/fixtures/fhir/ucum.codesystem.json.gz`). UCUM is
  © Regenstrief Institute and the UCUM Organization, redistributable with attribution.

**LOINC, SNOMED CT and RxNorm are NOT bundled.** They carry usage licenses and remain
user-provided. Import them yourself once you have accepted the relevant license, e.g.:

```sh
openldr terminology import loinc <dir> --accept-license
openldr terminology import resource <codesystem.json>
```

## Auth And OIDC

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `AUTH_ADAPTER` | `keycloak` | `keycloak` | Auth adapter. |
| `OIDC_ISSUER_URL` | URL | required | Keycloak realm issuer URL. |
| `OIDC_WEB_CLIENT_ID` | string | `openldr-web` | Browser OIDC client id. |
| `OIDC_AUDIENCE` | string | unset | Optional API audience. |
| `KEYCLOAK_ADMIN_CLIENT_ID` | string | unset | Enables admin user actions against Keycloak when paired with the secret. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | string | unset | Secret for Keycloak admin client. |
| `AUTH_DEV_BYPASS` | boolean string | `true` outside production, `false` in production | Injects a dev admin when no bearer token is present. Production rejects `true`. |
| `AUTH_DEV_USERNAME` | string | `dev-admin` | Dev-bypass username. |
| `AUTH_DEV_ROLES` | comma string | `lab_admin` | Dev-bypass roles. |

## Storage And Eventing

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `BLOB_ADAPTER` | `minio` | `minio` | Blob/S3 adapter. |
| `EVENTING_ADAPTER` | `pg` | `pg` | Event bus adapter. |
| `S3_ENDPOINT` | URL | required | S3-compatible endpoint. |
| `S3_REGION` | string | `us-east-1` | S3 region. |
| `S3_ACCESS_KEY_ID` | string | required | S3 access key. |
| `S3_SECRET_ACCESS_KEY` | string | required | S3 secret key. |
| `S3_BUCKET` | string | required | Bucket for raw inputs and artifacts. |
| `S3_FORCE_PATH_STYLE` | boolean string | `true` | Enables MinIO-compatible path-style URLs. |

## SQL Server Target Store

Required only when `TARGET_STORE_ADAPTER=mssql`.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MSSQL_HOST` | string | required for MSSQL | SQL Server host. |
| `MSSQL_PORT` | positive integer | `1433` | SQL Server port. |
| `MSSQL_DATABASE` | string | required for MSSQL | Database name. |
| `MSSQL_USER` | string | required for MSSQL | Login user. |
| `MSSQL_PASSWORD` | string | required for MSSQL | Login password. |
| `MSSQL_ENCRYPT` | boolean string | `false` | Enables encrypted SQL Server connection. |
| `MSSQL_TRUST_SERVER_CERT` | boolean string | `true` | Trusts self-signed SQL Server certificates. |

## MySQL / MariaDB Target Store

Required only when `TARGET_STORE_ADAPTER=mysql`. Serves both MySQL 8.4+ and MariaDB 11.4+.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MYSQL_HOST` | string | required for MySQL | MySQL/MariaDB host. |
| `MYSQL_PORT` | positive integer | `3306` | Server port. |
| `MYSQL_DATABASE` | string | required for MySQL | Database name. |
| `MYSQL_USER` | string | required for MySQL | Login user. |
| `MYSQL_PASSWORD` | string | required for MySQL | Login password. |
| `MYSQL_SSL` | boolean string | `false` | Enables a TLS connection to the server. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | boolean string | `false` | When true, rejects a server certificate that does not validate against the trust store. |

## Connectors (DHIS2 & external targets)

DHIS2 ships as a removable `dhis2-sink` plugin (Settings ▸ Marketplace). Its connection,
mappings, org-unit links, and schedules are managed from the plugin's own screens.
There are no DHIS2 env vars. Connector credentials are stored encrypted in the database.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `SECRETS_ENCRYPTION_KEY` | base64 (32 bytes) | required to use secret-bearing connectors | AES-256-GCM key for connector secrets at rest. Generate with `openssl rand -base64 32`. |

## Dashboards

Dashboard raw SQL is toggled at runtime in **Settings → General → Feature Flags** (`dashboard.raw_sql`, admin-only, default off). Its **statement timeout** and **row cap** are no longer environment variables. They are **number settings** under **Settings → General → Limits & tuning** (`dashboard.sql_timeout_ms`, `dashboard.sql_row_cap`), also settable with `openldr settings numbers set`.

## Workflows

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `WORKFLOW_CODE_ENABLED` | boolean string | `false` | Master switch for Workflow Code nodes. **Default off (fail-safe).** Code nodes run author-supplied JavaScript via Node's `vm`, which is **not** a security sandbox. Enabled code executes with **host-level privileges** (filesystem, network, environment, secrets). Enable only in trusted, single-tenant deployments. When false, Code nodes refuse to run. |
| `WORKFLOW_CODE_TIMEOUT_MS` | positive integer | `5000` | Code node timeout. |
| `WORKFLOW_CODE_MEMORY_MB` | positive integer | `128` | Code node worker memory cap. |
| `WORKFLOW_HTTP_ALLOWLIST` | comma-separated hostnames | empty | Allowed hosts for Workflow HTTP Request nodes. Empty means no hosts are reachable. |
| `WORKFLOW_FILE_MAX_BYTES` | positive integer | `52428800` | Max byte size of a file uploaded to a workflow run (upload route + webhook body). |
| `WORKFLOW_LOOP_MAX_ITEMS` | positive integer | `100000` | Max accumulated output items a single loop node may emit. |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | positive integer | `67108864` | Max byte size of a register file streamed to `POST /api/facilities/import/upload`. Enforced by a running byte count as the file streams (Fastify's `bodyLimit` does not bind a passthrough parser), so an over-cap upload is cut off mid-transfer with a 413. The same value bounds what the background import worker will buffer, so an accepted upload is always one it can read. 64 MiB is ~20x a 13 000-row national register; values above ~512 MiB cannot work (Node's maximum string length). |
| `WORKFLOW_FILE_ACCESS_ENABLED` | boolean string | `false` | Master switch for the read/write-file node's host filesystem access (privilege risk → off by default). |
| `WORKFLOW_FILE_ACCESS_ROOT` | path | empty | The single sandbox root all host file operations are confined to (empty = unset). |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | positive integer | `30` | Floor for an email-trigger's poll interval, in seconds. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | positive integer | `50` | Max unseen messages processed per email-trigger poll. |

> `workflow.dataset_publish_enabled` (publish materialized datasets as real target tables) and `workflow.listeners_enabled` (external listener triggers, Postgres `LISTEN` or IMAP poll) are now **Settings → General feature flags**, not environment variables.

## Plugin Runtime

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `PLUGIN_UI_ENABLED` | boolean string | `true` | Master switch for the plugin webview and UI. When false the host serves no plugin nav/UI and the broker refuses all UI calls. |
| `PLUGIN_EGRESS_ENABLED` | boolean string | `true` | Global network-egress kill-switch for plugin host services. When false the broker refuses any egress-bearing operation regardless of a plugin's grant. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | positive integer | `8388608` | Max serialized byte size of a plugin document persisted/forwarded through the broker. |
| `PLUGIN_CRASH_LOG_DIR` | path | `.openldr/crash` | Directory for durable plugin crash markers, drained into the audit trail on the next boot. |

## Crash-loop Breaker

Restart circuit-breaker: if `CRASH_LOOP_THRESHOLD` process crashes occur within `CRASH_LOOP_WINDOW_SEC`, the next boot writes one `system.crash_loop` marker and backs off (escalating sleep-then-exit) so the orchestrator's restart policy slows a hot loop.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `CRASH_LOOP_THRESHOLD` | positive integer | `5` | Crashes within the window before the breaker trips. |
| `CRASH_LOOP_WINDOW_SEC` | positive integer | `60` | Rolling window, in seconds. |
| `CRASH_LOOP_BACKOFF_MS` | positive integer | `2000` | Initial backoff sleep before exit. |
| `CRASH_LOOP_BACKOFF_CAP_MS` | positive integer | `60000` | Maximum backoff sleep. |

## Marketplace

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | boolean string | `false` | Allows unsigned bundles during local development only. |
| `MARKETPLACE_REGISTRY_DIR` | path | unset | Local registry directory for marketplace browsing/install. |
| `MARKETPLACE_REGISTRY_URL` | URL | unset | Remote raw registry base URL; takes precedence over `MARKETPLACE_REGISTRY_DIR` for available artifacts. |
| `MARKETPLACE_PUBLISH_TOKEN` | string | unset | GitHub token for marketplace publish PRs. |
| `MARKETPLACE_PUBLISH_REPO` | `owner/repo` | unset | GitHub repository for marketplace publishing. |
| `MARKETPLACE_PUBLISH_BRANCH` | string | `main` | Target branch for publish PRs. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | path | empty | When non-empty, an admin-added **local** registry's directory must resolve inside this root (path-containment). Empty preserves current behaviour. |

## PowerShell And Bash Setup

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm openldr db migrate
pnpm -C apps/server dev
```

Bash:

```bash
cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm openldr db migrate
pnpm -C apps/server dev
```

Run the web app separately:

```bash
pnpm -C apps/studio dev
```

### Dev-server variables

These are read by `apps/studio/vite.config.ts` from the repo-root `.env`, not by the config
schema. They affect the Vite dev server only and have no effect on a built or deployed app.

| Variable | Type | Default | Effect |
|---|---:|---:|---|
| `DEV_HOST` | address | unset | Bind address for the Studio dev server. Unset means Vite's localhost-only default, so another device on the network cannot reach it. Set it to `127.0.0.1` or `0.0.0.0` to expose it over a tailnet. Only `DEV_*` names are read, which keeps the rest of `.env` out of the Vite config. |

Studio's dev port is pinned to 5173 and the landing site's to 5174, both with `strictPort`,
so a clash fails loudly instead of moving an app to a port you did not expect.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Config validation fails on `TARGET_DATABASE_URL` | `TARGET_STORE_ADAPTER` defaults to `pg`, which requires `TARGET_DATABASE_URL`. | Set `TARGET_DATABASE_URL` or switch to `TARGET_STORE_ADAPTER=mssql` and provide all `MSSQL_*` keys. |
| A connector/sink push fails with a connector error (e.g. the DHIS2 plugin) | No connector configured, the connector is disabled, or `SECRETS_ENCRYPTION_KEY` is unset. | Create/enable a connector under Settings ▸ Connectors and set `SECRETS_ENCRYPTION_KEY`. |
| HTTP Request workflow node cannot reach a host | `WORKFLOW_HTTP_ALLOWLIST` does not include the hostname. | Set a comma-separated allowlist, for example `WORKFLOW_HTTP_ALLOWLIST=api.example.org,dhis2.local`. |
| Built server serves API but not SPA | `WEB_DIST_DIR` points to a missing directory. | Build web with `pnpm -C apps/studio build` and set `WEB_DIST_DIR` to that `dist` path if using a custom layout. |
| Raw SQL dashboard tab is hidden | Feature flag `dashboard.raw_sql` is off or target store is not PostgreSQL. | Enable the flag in **Settings → General → Feature Flags** (admin-only) and ensure `TARGET_STORE_ADAPTER=pg`. |
