# Environment variables

OpenLDR is configured through environment variables read at startup. In a Docker
deployment they live in the `.env` file next to `docker-compose.yml` (the file the
installer generates). Change a value, then recreate the stack to apply it:

```
docker compose up -d
```

Most operators never edit these by hand. The installer writes sensible defaults and
generates every secret for you. This page is a reference for the values that matter
when you move beyond a single-host install: a public domain, an external database, or
SQL Server as the analytics store.

> Secrets (`*_PASSWORD`, `*_SECRET_*`, `SECRETS_ENCRYPTION_KEY`) are generated on first
> install and must never be shared or committed. Rotating `SECRETS_ENCRYPTION_KEY`
> after connectors exist makes their stored credentials unreadable. Treat it as
> permanent once the stack is live.

## Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Runtime mode. Keep `production` for deployments. |
| `PORT` | `3000` | Internal API port behind the gateway. |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`). |
| `OPENLDR_VERSION` | `latest` | Image tag the stack pulls and runs. |
| `TRUST_PROXY` | unset | How many proxies in front of the API to trust for the client IP. Set `1` behind the bundled gateway, so audit entries show the real client address. Only set it when a trusted proxy really fronts the API. Otherwise a client can fake its own IP. |

## Public address and TLS

These decide the URL users reach and how the gateway terminates HTTPS. `SERVER_NAME`
is the public hostname. `PUBLIC_ORIGIN` is the full origin used for links and OIDC
redirects.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_NAME` | `localhost` | Public hostname or domain of this deployment. |
| `PUBLIC_ORIGIN` | `https://localhost` | Full external origin (`https://your.domain`). |
| `GATEWAY_HTTP_PORT` | `80` | Host port the gateway serves HTTP on. |
| `GATEWAY_HTTPS_PORT` | `443` | Host port the gateway serves HTTPS on. |
| `TLS_MODE` | `self-signed` | `self-signed` or a trusted (Let's Encrypt) certificate. |
| `LETSENCRYPT_EMAIL` | unset | Contact email used when issuing a trusted certificate. |

## Database

OpenLDR always uses an internal Postgres application database. The target (analytics)
warehouse can be Postgres, SQL Server, or MySQL/MariaDB, chosen with
`TARGET_STORE_ADAPTER`. `TARGET_DATABASE_URL` applies to a Postgres target. SQL Server and
MySQL use their own variables, listed further down.

| Variable | Purpose |
| --- | --- |
| `INTERNAL_DATABASE_URL` | Application database (users, forms, workflows, audit). Always Postgres. |
| `TARGET_DATABASE_URL` | Analytics warehouse the pipelines write to, when `TARGET_STORE_ADAPTER=pg`. |
| `POSTGRES_PASSWORD` | Password for the bundled Postgres container. |

## Adapters

Adapters select the backing implementation for each subsystem. The defaults match the
bundled containers. Change them only when pointing at external infrastructure.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_ADAPTER` | `keycloak` | Sign-in mode: `keycloak` or `oidc`. See [Authentication providers](/docs/auth-providers). |
| `BLOB_ADAPTER` | `minio` | Object-storage backend for uploads and artifacts. |
| `EVENTING_ADAPTER` | `pg` | Event store used by workflow triggers. |
| `TARGET_STORE_ADAPTER` | `pg` | Analytics warehouse engine: `pg`, `mssql`, or `mysql`. |

An external reporting target is no longer an adapter chosen here. Create a connector under
**Settings > Connectors** instead, and the sink plugin is resolved from that connector.

## Object storage (S3 / MinIO)

The bundled MinIO container is S3-compatible. Point these at any S3 endpoint to use
external storage instead.

| Variable | Default | Purpose |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://minio:9000` | S3 endpoint URL. |
| `S3_REGION` | `us-east-1` | S3 region. |
| `S3_ACCESS_KEY_ID` | generated | Access key. |
| `S3_SECRET_ACCESS_KEY` | generated | Secret key. |
| `S3_BUCKET` | `openldr` | Bucket that holds uploads and artifacts. |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style addressing (required by MinIO). |

## Authentication (Keycloak / OIDC)

Keycloak is the default. Generic OIDC uses discovery and JWT access tokens. See [Authentication providers](/docs/auth-providers) for setup, administration limits and issuer protection.

| Variable | Purpose |
| --- | --- |
| `IDENTITY_ADMIN_ADAPTER` | `keycloak` or `none`. Defaults to `keycloak` for Keycloak auth, `none` for generic OIDC. |
| `OIDC_ISSUER_URL` | Public issuer URL. Keep the existing value on upgrade. Later changes block startup. |
| `OIDC_INTERNAL_ISSUER_URL` | Keycloak-only internal realm base URL. Generic OIDC ignores this value. |
| `OIDC_INTERNAL_JWKS_URL` | Explicit internal signing-key endpoint override. Does not change the expected issuer. |
| `OIDC_AUDIENCE` | Expected token audience. |
| `OIDC_WEB_CLIENT_ID` | Public client ID the studio app authenticates with. |
| `OIDC_SCOPES` | Scopes the studio app requests. Defaults to `openid profile email`. Must include `openid`. |
| `OIDC_RESOURCE` | Resource URL to request, for providers that need one to issue the API access token. |
| `TLS_CERT_PATH` | Path to this server's public TLS certificate (PEM). When set, the Sites page offers it for download, so a remote lab can trust a self-signed central. The installer sets this for you. |
| `KC_HOSTNAME` | Public base URL Keycloak advertises. |
| `KEYCLOAK_ADMIN` | Keycloak admin username. |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak admin password (generated). |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Client ID used for admin API calls. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Client secret for admin API calls. |

## Development-only settings

These exist for local development and automated tests. Never set them in a deployment.

`AUTH_DEV_BYPASS` turns **authentication off**. Any API request without a bearer token is
served as a dev admin. It is off unless you set it, and the server refuses to start with it
on under `NODE_ENV=production`. When it is on, Studio shows an "Authentication bypass
active" banner and the server logs a warning at startup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_DEV_BYPASS` | `false` | Serve unauthenticated API requests as a dev admin. |
| `AUTH_DEV_USERNAME` | `dev-admin` | Username of the injected dev actor. |
| `AUTH_DEV_ROLES` | `lab_admin` | Roles granted to the injected dev actor. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | `false` | Install marketplace bundles that carry no signature. |

## Secrets

| Variable | Purpose |
| --- | --- |
| `SECRETS_ENCRYPTION_KEY` | Base64 32-byte key that encrypts connector credentials at rest. Generate with `openssl rand -base64 32`. |

## First-run behavior

| Variable | Default | Purpose |
| --- | --- | --- |
| `MIGRATE_ON_START` | `true` | Run database migrations when the API starts. |
| `SEED_ON_START` | `true` | Seed default forms, workflows, and terminology on first boot. |

## Terminology imports

| Variable | Default | Purpose |
| --- | --- | --- |
| `TERMINOLOGY_WORK_DIR` | system temp folder | Folder where an uploaded terminology release is unzipped during import. A full SNOMED CT release needs room for the zip and the unzipped files at once. Point this at a larger disk when the container's temp folder is small. |

## SQL Server target store

Set only when `TARGET_STORE_ADAPTER=mssql`. Start the SQL Server profile with
`docker compose --profile mssql up -d`.

| Variable | Purpose |
| --- | --- |
| `MSSQL_HOST` | SQL Server host. |
| `MSSQL_PORT` | SQL Server port (default `1433`). |
| `MSSQL_DATABASE` | Target database name. |
| `MSSQL_USER` | Login. |
| `MSSQL_PASSWORD` | Password. |
| `MSSQL_ENCRYPT` | `true`/`false`: encrypt the connection. |
| `MSSQL_TRUST_SERVER_CERT` | `true`/`false`: trust a self-signed server certificate. |

## MySQL / MariaDB target store

Set only when `TARGET_STORE_ADAPTER=mysql`. Works with MySQL 8.4+ and MariaDB 11.4+.

| Variable | Purpose |
| --- | --- |
| `MYSQL_HOST` | MySQL/MariaDB host. |
| `MYSQL_PORT` | Server port (default `3306`). |
| `MYSQL_DATABASE` | Target database name. |
| `MYSQL_USER` | Login. |
| `MYSQL_PASSWORD` | Password. |
| `MYSQL_SSL` | `true`/`false`: connect over TLS. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `true`/`false`: reject a server certificate that is not trusted. |

## Workflows

See [Workflows](/docs/workflows) for the nodes these settings control.

> `WORKFLOW_CODE_ENABLED` lets workflow authors run JavaScript with the same access as the
> server itself: its files, network, environment, and secrets. The code runner is not a
> sandbox. Turn it on only when you trust everyone who can edit workflows.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | `false` | Allow Code nodes to run. When off, Code nodes refuse to run. |
| `WORKFLOW_CODE_TIMEOUT_MS` | `5000` | Time limit for one Code node run, in milliseconds. |
| `WORKFLOW_CODE_MEMORY_MB` | `128` | Memory limit for one Code node run, in MB. |
| `WORKFLOW_HTTP_ALLOWLIST` | empty | Comma-separated hostnames the HTTP Request node may call. Empty means every host is refused. |
| `WORKFLOW_FILE_MAX_BYTES` | `52428800` (50 MB) | Largest file accepted by a workflow run upload or webhook body. |
| `WORKFLOW_LOOP_MAX_ITEMS` | `100000` | Most items a single loop node may collect. |
| `WORKFLOW_FILE_ACCESS_ENABLED` | `false` | Allow the Read/Write File node to touch files on the server. |
| `WORKFLOW_FILE_ACCESS_ROOT` | empty | The one folder the Read/Write File node is confined to. The node fails while this is empty. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | `30` | Shortest poll interval an email trigger may use, in seconds. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | `50` | Most unread messages an email trigger handles per poll. |

## Facility register import

| Variable | Default | Purpose |
| --- | --- | --- |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | `67108864` (64 MB) | Largest facility register file you can upload. A larger upload is stopped mid-transfer. 64 MB is about 20 times a 13,000-row national register. Values above about 512 MB cannot work. |

## Plugins

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLUGIN_UI_ENABLED` | `true` | Show plugin screens. When `false`, no plugin menu items or screens appear. |
| `PLUGIN_EGRESS_ENABLED` | `true` | Allow plugins to reach the network. When `false`, every plugin network call is refused, whatever the plugin was granted. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | `8388608` (8 MB) | Largest document a plugin may store or send in one call. |
| `PLUGIN_CRASH_LOG_DIR` | `.openldr/crash` | Folder for plugin crash records. The next start copies them into the audit log. |

## Crash-loop protection

If the server crashes `CRASH_LOOP_THRESHOLD` times within `CRASH_LOOP_WINDOW_SEC`, the next
start writes one `system.crash_loop` audit entry and waits before exiting. The wait grows
on each restart, which slows a restart loop instead of letting it spin.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CRASH_LOOP_THRESHOLD` | `5` | Crashes within the window before the protection starts. |
| `CRASH_LOOP_WINDOW_SEC` | `60` | Length of the window, in seconds. |
| `CRASH_LOOP_BACKOFF_MS` | `2000` | First wait before exiting, in milliseconds. |
| `CRASH_LOOP_BACKOFF_CAP_MS` | `60000` | Longest wait, in milliseconds. |

## Marketplace

The two registry variables only seed the first registry, on a first boot that has none.
After that, manage them in the **Registries** view of **Settings > Marketplace**. See
[Marketplace](/docs/marketplace).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL` | bundled registry | Remote registry seeded on first boot when no registries exist. |
| `MARKETPLACE_REGISTRY_DIR` | unset | Local registry folder seeded on first boot when `MARKETPLACE_REGISTRY_URL` is unset. Publishing also stages bundles here. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | empty | When set, a local registry added in Settings must be a folder inside this one. |
| `MARKETPLACE_PUBLISH_TOKEN` | unset | GitHub token with write access to the publish repository. Keep it secret. |
| `MARKETPLACE_PUBLISH_REPO` | unset | Repository that receives publish pull requests, as `owner/repo`. |
| `MARKETPLACE_PUBLISH_BRANCH` | `main` | Branch the publish pull requests target. |

Publishing is on only when `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO`, and
`MARKETPLACE_REGISTRY_DIR` are all set.

## Distributed sync

See [Distributed sync](/docs/sync) for enrolling a lab.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENLDR_SITE_ID` | unset | Site ID stamped on records this server writes, used when the Site ID on the sync **Settings** tab is empty. The saved setting wins. |
| `SYNC_ALLOW_INSECURE_TRANSPORT` | `false` | Allow sync to a central over plain `http://`. Sync sends a client secret and patient-related data, so only use this on a trusted local network while setting up. `localhost` works without it. |

## Related guides

- [Settings](/docs/settings)
- [Connectors](/docs/connectors)
