# Planned upgrades

Schedule downtime for an application upgrade. New schema changes can make old and new writers unsafe together. This procedure preserves the database and storage engine versions. An engine upgrade needs a separate tested procedure.

Use the actual installed Compose project directory. Keep its project name, environment file and overlays consistent for every command. You need an operator who can restore the entire deployment.

The terminal images are labelled illustrations. Replace placeholders with your deployment values. They do not claim that a production upgrade was run. Backup and restore were rehearsed separately on disposable Postgres and S3 destinations.

Save these instructions outside Studio before downtime. Agree how senders queue and retry while services are stopped.

## Record the current release and prepare the target

Read the target release notes and migration requirements. Do this before stopping the running application.

### 1. Open General

Open **Settings**, then **General**.

![Open Settings, then General to read the running version.](upgrading-guide-general.png)

### 2. Record the running version

Read About. Record the current application release and deployment environment.

![Record the running version before choosing a target release.](upgrading-guide-version.png)

### 3. Save the current deployment inventory

In the deployment directory, record `docker compose images`. Preserve previous image tags and ids, Compose files, overlays and private .env. Keep the old images available.

![Illustration. Record exact current images and configuration.](upgrading-guide-inventory.png)

### 4. Pin the chosen application release

Set OPENLDR_VERSION to the approved release tag in .env. Download only its required application images before downtime. Preserve PostgreSQL, identity and object-storage engine versions.

![Illustration. Pin the approved application release before downtime.](upgrading-guide-pin.png)

**Expected result:** The target application image and a complete previous-release inventory are available. Do not blindly pull every infrastructure image.

## Stop writes and confirm they drained

Pause webhook senders, synchronization peers, scheduled writers and operator changes. Block incoming traffic. Account for API replicas and CLI jobs outside this Compose project.

### 1. Stop every application writer

Stop all API replicas with enough grace for their longest work. The illustration allows 300 seconds. Check shutdown logs and container state. A forced kill, timeout or exit 137 does not prove work finished.

![Illustration. Pause external writers, stop every API replica and confirm shutdown.](upgrading-guide-drain.png)

### 2. Stop identity and storage writers

After the API stops, stop Keycloak and object storage. Stop every other writer to those stores. Keep PostgreSQL available for logical dumps. Keep writers stopped through backup checks and migration.

![Illustration. Stop identity and object-storage writers after the API.](upgrading-guide-stores.png)

**Expected result:** The backup can capture one stopped-write state. Record outstanding webhook receipts and investigate interrupted work before later replay.

## Back up and prove the backup restores

Store backups privately outside the deployment volumes. A dump file or healthy API alone does not establish recoverability.

### 1. Back up each database

Identify actual database names and accounts. Use pg_dump -Fc with an output file inside the Postgres container, then Compose cp to a private directory that already exists. Repeat for internal, target and identity databases. Use native backup tools for external SQL Server or MySQL stores.

![Illustration. Back up each database from the same stopped-write period.](upgrading-guide-database-backup.png)

### 2. Save roles, blobs and configuration

Save PostgreSQL roles separately. Back up every blob bucket or stopped storage volume. Preserve .env, Compose files, mounted config, encryption and signing keys, certificates, local data files and image inventory from the same stopped-write period.

![Illustration. Save roles and all configuration privately.](upgrading-guide-roles.png)

### 3. Restore into isolated destinations

Restore roles and databases with errors treated as failures. Restore blobs and compare checksums. Compare saved records and representative row counts. Use preserved encryption keys to decrypt a saved secret without printing it. Ensure restored records can read restored blobs.

![Illustration. Restore into separate, isolated destinations.](upgrading-guide-restore.png)

**Expected result:** Proceed only when the matching database, blob, configuration, keys and image snapshot can be restored. Isolated restores must not contact real senders or destinations.

## Migrate before starting the new API

Keep old writers stopped. Confirm the one-off command uses the pinned new application image.

### 1. Run the new image migration command

Use `docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate`. Require exit 0 and successful internal and target migrations. This overrides the API command and does not serve requests.

![Illustration. Run the pinned new image CLI before starting its API.](upgrading-guide-migrate.png)

**Expected result:** On migration failure, stop here. Some changes may already be committed. Diagnose or restore the matching snapshot. Do not start old binaries against a partially upgraded schema.

## Installs that use Keycloak

Do this before you start the new compose file. If the `keycloak` service in the `docker-compose.yml` you are moving to has a `profiles` line, add this line to the install's `.env`:

```sh
COMPOSE_PROFILES=keycloak
```

Without it Keycloak does not start, and nobody can sign in. If `.env` already has a `COMPOSE_PROFILES` line, add `keycloak` to it after a comma. Re-running the one-line installer adds the line for you. An install that uses local sign-in has nothing to do here.

## Check the new release before resuming traffic

Start services in dependency order. Keep incoming traffic and senders paused until verification succeeds.

### 1. Start the pinned application services

Start existing storage and identity first, then the pinned new application services. Preserve the infrastructure engine versions.

![Illustration. Start storage and identity, then pinned application services.](upgrading-guide-start.png)

### 2. Check health and saved work

Check container state, app health and logs. Read representative data and uploaded files. Check workflow receipts and linked runs before reopening traffic. Resume senders only after these checks pass.

![Illustration. Check the new application before resuming traffic.](upgrading-guide-verify.png)

**Expected result:** The release is checked before new work arrives. Keep verified backups and previous images according to the site retention policy.

## Troubleshooting interrupted requests

An HTTP 202 means a webhook was accepted. It does not prove completion. Poll outstanding receipts and inspect their linked runs. Investigate partial external effects before replacing work.

When retrying the same logical request, keep its original Idempotency-Key and input. Do not replay all interrupted requests with new keys. If traffic already reopened before a restore, reconcile deliveries and external effects against the restore point.

## Shutdown grace and existing installations

New installer Compose files set `stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}` under services.api. Add that property to an older local Compose file when missing. Allow enough time for the longest work. An explicit stop timeout takes precedence.

OpenLDR waits for active requests and workers while shutting down. A handler that never returns can outlast the grace period. Logs and process state must establish whether the shutdown actually drained. Never run `docker compose down -v` during an upgrade.

If an older warehouse lacks result statuses, the release notes can require `openldr db reproject --force` after upgrading. This rebuilds projected data from canonical resources. Do it only when the target release requires it.

## Older MinIO deployments moving to Garage

An installation from before 0.1.11 needs the matching storage migration before starting the new Compose configuration. A fresh installation does not. Preserve the old MinIO image, data volume, endpoint and credentials privately before changing anything.

Keep the old MinIO service available alongside Garage during the copy. Its environment must retain its old literal credentials because the new S3 variables belong to Garage. Generate the required Garage access key, secret, RPC secret and admin token using the release instructions. Do not expose those values in screenshots.

Use the CLI storage copy command with the old endpoint, key, secret and bucket. It copies to the currently configured target. Read its object and byte counts and require its completion check. It skips an existing object of the same size, so it does not prove equal-sized content matches. Compare representative checksums and open uploaded files as well.

Keep the old storage volume until the copied files and the application are checked. Removing an old volume is a separate destructive cleanup decision. The copy flags can expose source credentials in shell history and process arguments. Use a private administration session.

Follow the storage migration instructions for the exact source and target releases. The rehearsal did not migrate a historical MinIO installation. Its separate S3 rehearsal compared complete object checksums between two disposable buckets.

## What the isolated rehearsal established

The rehearsal stopped only the isolated test installation's API. It dumped and restored both disposable Postgres databases into separate destinations. The restored canonical count matched 27 records and the target request count matched 1. Eight objects restored to a separate bucket with matching SHA-256 checksums.

A saved connector secret decrypted to the same value under the preserved encryption key. No secret was printed. A current-schema migration command exited 0 on the restored databases.

These checks establish a small same-version backup rehearsal. They do not establish a historical release upgrade, identity-database recovery, external database recovery, storage-engine migration, long-running job drain or production capacity. The illustrated Compose commands were not executed against a production stack.

## Related guides

[Environment variables](/docs/environment), [Settings](/docs/settings), [Workflows](/docs/workflows) and [Deployment and developer docs](/docs/advanced-docs).
