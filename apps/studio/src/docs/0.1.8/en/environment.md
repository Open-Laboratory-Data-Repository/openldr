# Environment variables

OpenLDR reads environment variables when its server starts. In an installed Docker deployment, edit the private `.env` beside its Compose file, then recreate the affected services.

Use Settings for values that have app controls. Connectors store destination credentials. Marketplace manages registries after their first boot. Distributed sync stores its link configuration in Settings. Those saved settings do not require an environment-file edit.

You need server access and the deployment's exact Compose project, environment file and overlays. Keep those options consistent. The terminal pictures below are illustrations with placeholder commands. They do not show your server or claim that a deployment change was executed.

Preserve `SECRETS_ENCRYPTION_KEY`. Replacing it after saved credentials exist makes them unreadable. Keep passwords, signing keys, private certificates and backups out of screenshots and version control.

## Identify the running installation

Check the application before choosing a configuration file. A source checkout and an installed Compose deployment use different startup commands.

### 1. Open General

Open **Settings**, then **General**.

![Open Settings, then General.](environment-guide-general.png)

### 2. Read About

Record the running Version and Environment. This page identifies the app, but it does not expose the private environment file.

![About identifies the running application version and environment.](environment-guide-about.png)

### 3. Find its Compose directory

On the server, open the directory containing this installation's Compose file and .env. The illustrated `~/openldr_ce` path is an example. Use your actual deployment directory.

![Illustration. Work in the installed Compose project directory.](environment-guide-folder.png)

**Expected result:** You know which running deployment and configuration files the change concerns.

## Change a startup value

Agree any downtime required by the selected value. Use a private editor and preserve existing credentials.

### 1. Back up the configuration

Save the current .env privately before editing. Keep it with the deployment backup and restrict access.

![Illustration. Back up configuration privately before editing.](environment-guide-backup.png)

### 2. Edit only the intended value

Change the selected value. The illustration uses LOG_LEVEL. Do not paste the placeholder example over your complete file.

![Illustration. Change only the environment value you intend to change.](environment-guide-edit.png)

### 3. Validate the Compose configuration

Run `docker compose config --quiet` with the deployment's normal project, env-file and overlay options. Require exit code 0. Avoid printing the expanded configuration into shared logs.

![Illustration. Validate the Compose configuration without printing secrets.](environment-guide-validate.png)

### 4. Recreate affected services

Use `docker compose up -d` for the affected services. A restart alone keeps an existing container's environment. Public origin or identity changes can affect several services.

![Illustration. Recreate affected services to apply startup settings.](environment-guide-apply.png)

### 5. Check the result

Check container state, app health, logs and the changed behavior. A healthy API does not prove external databases, login callbacks or file destinations work.

![Illustration. Check service state and application health.](environment-guide-health.png)

**Expected result:** The new process reads the intended value. Preserve the previous configuration until the behavior has been checked.

## Runtime and deployment address

The application parser and installer have different defaults. The parser defaults NODE_ENV to development. A deployed stack should explicitly run production. Compose-only values configure the gateway and image tags.

| Variable | Default or source | Meaning |
| --- | --- | --- |
| `NODE_ENV` | Parser: development | Set production for deployed services. |
| `PORT` | 3000 | Internal API listening port. |
| `LOG_LEVEL` | info | Server log level. |
| `TRUST_PROXY` | Unset | Trust proxy hops for client IP attribution. Use only the actual trusted proxy chain. |
| `OPENLDR_VERSION` | Deployment image tag | Pin the approved application release for upgrades. |
| `SERVER_NAME`, `PUBLIC_ORIGIN` | Deployment values | Public hostname and complete external origin. |
| `GATEWAY_HTTP_PORT`, `GATEWAY_HTTPS_PORT` | 80, 443 | Published gateway ports. |
| `TLS_MODE`, `LETSENCRYPT_EMAIL` | Installer values | Gateway certificate mode and certificate contact. |
| `MIGRATE_ON_START`, `SEED_ON_START` | Parser: false, false | Startup migrations and optional sample-data seeding. Upgrade procedure uses a separate migration step. |

## Databases and object storage

The internal database always uses Postgres. Select the warehouse engine through TARGET_STORE_ADAPTER. These variables configure the warehouse itself. Additional report and source connections belong in Connectors.

| Variable | Default or source | Meaning |
| --- | --- | --- |
| `INTERNAL_DATABASE_URL` | Required | Application database, including accounts, audit and canonical resources. |
| `TARGET_STORE_ADAPTER` | pg | Warehouse engine: pg, mssql or mysql. |
| `TARGET_DATABASE_URL` | Required for pg | Postgres warehouse connection. |
| `MSSQL_HOST`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` | Required for mssql | SQL Server warehouse connection. |
| `MSSQL_PORT` | 1433 | SQL Server warehouse port. |
| `MSSQL_ENCRYPT`, `MSSQL_TRUST_SERVER_CERT` | false, true | Warehouse transport options. Check the actual server certificate requirements. |
| `MYSQL_HOST`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Required for mysql | MySQL or MariaDB warehouse connection. |
| `MYSQL_PORT` | 3306 | MySQL warehouse port. |
| `MYSQL_SSL`, `MYSQL_SSL_REJECT_UNAUTHORIZED` | false, false | Warehouse TLS and certificate verification options. |
| `BLOB_ADAPTER` | minio | File storage: minio or fs. minio uses an S3 service, including the bundled Garage service. fs keeps files in the folder named by `BLOB_DIR`. |
| `BLOB_DIR` | Required for fs | Folder that holds the stored files. |
| `S3_ENDPOINT`, `S3_BUCKET` | Required for minio | Object service endpoint and bucket. |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | us-east-1, true | S3 region and path addressing. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private credentials, required for minio | Object-storage access. Garage requires its supported key format. |
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` | Installer-generated | Garage service secrets. Preserve them with its configuration. |
| `EVENTING_ADAPTER` | pg | Application event-store implementation. |

## Authentication and secrets

Use [Authentication providers](/docs/auth-providers) before changing an issuer. The application database binds to its identity namespace. Generic OIDC does not provide Keycloak user or sync-client administration.

| Variable | Default or source | Meaning |
| --- | --- | --- |
| `AUTH_ADAPTER` | keycloak | local, keycloak or generic oidc sign-in. New installs set local. |
| `IDENTITY_ADMIN_ADAPTER` | Depends on AUTH_ADAPTER | keycloak, local or none. Local sign-in uses local. Generic oidc requires none. |
| `OIDC_ISSUER_URL` | Required for keycloak and oidc | Expected token issuer. Local sign-in does not use it. Preserve it for an existing identity namespace. |
| `OIDC_WEB_CLIENT_ID` | openldr-web | Public browser client id. |
| `OIDC_AUDIENCE` | Optional | Required API access-token audience when configured. |
| `OIDC_SCOPES` | openid profile email | Requested browser scopes. Must include openid. |
| `OIDC_RESOURCE` | Optional | Provider resource indicator when required. |
| `OIDC_INTERNAL_JWKS_URL` | Optional | Explicit server-side signing-key endpoint. Expected issuer stays unchanged. |
| `OIDC_INTERNAL_ISSUER_URL` | Optional | Keycloak server-side realm address. Generic OIDC does not derive endpoints from it. |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | Private deployment values | Provider administration service account. |
| `TLS_CERT_PATH` | Optional | Public server certificate offered for central certificate download. |
| `SECRETS_ENCRYPTION_KEY` | Base64, 32 decoded bytes | Saved-credential encryption key. Preserve existing value. |
| `AUTH_DEV_BYPASS` | false | Explicit development authentication bypass. Production rejects true. |
| `AUTH_DEV_USERNAME`, `AUTH_DEV_ROLES` | dev-admin, lab_admin | Actor for an explicitly enabled development bypass. |

## Workflow, plugin and import limits

Enable host-level capabilities only for the users and installations that need them. WORKFLOW_CODE_ENABLED permits authored JavaScript with host access. It is not a security sandbox. Dashboard SQL limits, workflow listener enablement and dataset publishing have Settings controls.

| Variable | Parser default | Meaning |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | false | Permit Code node execution with host access. |
| `WORKFLOW_CODE_TIMEOUT_MS`, `WORKFLOW_CODE_MEMORY_MB` | 5000, 128 | Code node time and memory limits. |
| `WORKFLOW_HTTP_ALLOWLIST` | Empty | Hostnames allowed for workflow HTTP requests. |
| `WORKFLOW_FILE_MAX_BYTES` | 52428800 | Workflow upload or webhook file limit. |
| `WORKFLOW_LOOP_MAX_ITEMS` | 100000 | Maximum accumulated loop output items. |
| `WORKFLOW_FILE_ACCESS_ENABLED`, `WORKFLOW_FILE_ACCESS_ROOT` | false, empty | Host file access and its required folder root. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS`, `WORKFLOW_EMAIL_MAX_PER_POLL` | 30, 50 | Email trigger polling floor and per-poll message limit. |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | 67108864 | Facility register upload ceiling. Raising it also needs enough worker memory. |
| `TERMINOLOGY_WORK_DIR` | Optional | Terminology download and extraction directory. |
| `PLUGIN_UI_ENABLED`, `PLUGIN_EGRESS_ENABLED` | true, true | Plugin page/broker and network-access master switches. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | 8388608 | Maximum broker document size. |
| `PLUGIN_CRASH_LOG_DIR` | .openldr/crash | Durable plugin crash-marker directory. |
| `CRASH_LOOP_THRESHOLD`, `CRASH_LOOP_WINDOW_SEC` | 5, 60 | Crash count and measurement window. |
| `CRASH_LOOP_BACKOFF_MS`, `CRASH_LOOP_BACKOFF_CAP_MS` | 2000, 60000 | Initial and maximum crash-loop backoff. |

## Marketplace and sync configuration

MARKETPLACE_REGISTRY_URL or MARKETPLACE_REGISTRY_DIR seeds the initial registry only when none exist. Afterward, use Marketplace, Registries. Publishing requires its token, repository and local staging directory together.

`OPENLDR_SITE_ID` supplies a fallback site stamp when no saved Site ID exists. Saved sync settings take precedence. `SYNC_ALLOW_INSECURE_TRANSPORT` defaults false. Use HTTPS for a live central.

| Variable | Default or source | Meaning |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL`, `MARKETPLACE_REGISTRY_DIR` | Initial source | Remote registry or local bundle directory used on first setup. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | Empty | Optional allowed root for local registry folders. |
| `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO` | Private configuration | GitHub publishing credentials and destination. |
| `MARKETPLACE_PUBLISH_BRANCH` | main | Target branch for publishing proposals. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | false | Development-only unsigned package allowance. |

## Troubleshooting

**A startup value did not change.** Restart the affected processes after changing their environment. In Docker, recreate affected services because a restart keeps the container environment.

**A CLI command fails.** Follow [Start here](/docs/start-here) for the installed or development CLI setup.

## Related guides

[Settings](/docs/settings), [Connectors](/docs/connectors), [Distributed sync](/docs/sync), [Authentication providers](/docs/auth-providers) and [Planned upgrades](/docs/upgrading).
