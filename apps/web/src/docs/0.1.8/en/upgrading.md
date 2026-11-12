# Planned upgrades

<!-- operator-platform -->

Run maintenance on the OpenLDR host, from your installed Compose folder. The examples use `~/Downloads/openldr_ce` on Linux/macOS and `C:\openldr_ce` in PowerShell. Replace these paths with your installation. The blue prompt is already shown by the terminal. Type the command only. Configuration snippets name the file to edit; they are not terminal commands. Pictures are examples, not proof that maintenance succeeded. Sample data is optional.

## Prepare the release

Schedule downtime. Keep the same project name, environment file and overlays throughout. Preserve the database engine versions. Read release notes before choosing the application release.

### 1. Record the current images and services

Keep the old image IDs and exact tags outside the deployment. All commands below run in this same folder.

```sh
{{operator:upgrade-folder}}
```

![Record the current images and services.](guide:operator-upgrade-folder)

### 2. Save configuration and keys privately

Replace BEFORE_UPGRADE with your backup name. Restrict access. Include every overlay, encryption/signing key, certificate and local data file. This does not back up database or object volumes. Save this guide outside Studio.

```sh
{{operator:upgrade-private-copy}}
```

![Save configuration and keys privately.](guide:operator-upgrade-private-copy)

## Stop writes and wait

Pause senders, sync peers and scheduled writers. Block new traffic. Stop separate CLI jobs and every API replica, including other hosts. Keep writers stopped until all checks finish.

### 1. Allow active work to finish

Merge under services.api on older deployments. Choose a duration covering the longest work. The explicit stop timeout below overrides this value.

```text
{{operator:upgrade-grace}}
```

![Allow active work to finish.](guide:operator-upgrade-grace)

### 2. Stop the old API and inspect shutdown

300 seconds is an example. Timeout, forced kill or exit 137 is not proof of drained work. Investigate interrupted jobs and external effects before continuing.

```sh
{{operator:upgrade-stop}}
```

![Stop the old API and inspect shutdown.](guide:operator-upgrade-stop)

### 3. Stop identity and file-store writers

Use your real service names. On an older MinIO deployment the storage service may be named minio. Keep PostgreSQL running for logical backups. Stop other processes writing these stores too.

```sh
{{operator:upgrade-stores-stop}}
```

![Stop identity and file-store writers.](guide:operator-upgrade-stores-stop)

## Back up and prove restoration

Capture databases, roles and every object bucket or stopped volume from the same period without writes. Never use docker compose down -v. Do not copy a live PostgreSQL data volume as a logical backup.

### 1. Create each PostgreSQL dump

Replace DB_NAME and DB_USER with actual values. Repeat for the internal, analytics and Keycloak databases. For SQL Server/MySQL targets, use their tested native backup procedure separately.

```sh
{{operator:upgrade-dump}}
```

![Create each PostgreSQL dump.](guide:operator-upgrade-dump)

### 2. Copy each dump outside the volumes

The private destination must already exist. Check every exit code. File copying avoids binary redirection through PowerShell.

```sh
{{operator:upgrade-dump-copy}}
```

![Copy each dump outside the volumes.](guide:operator-upgrade-dump-copy)

### 3. Save database roles too

Replace DB_USER. Protect globals.sql because role definitions can contain credentials. Back up every blob bucket or stopped object-store volume with your tested procedure.

```sh
{{operator:upgrade-roles}}
```

![Save database roles too.](guide:operator-upgrade-roles)

### 4. Restore on an isolated destination

Use only an isolated empty target, never production. Restore roles first and resolve bootstrap role conflicts. Copy the dump there before running this example. Archive listing alone proves nothing. Restore blobs, compare checksums and records, decrypt representative secrets with preserved keys, and check record-to-file links. Do not migrate production until these checks pass.

```sh
{{operator:upgrade-restore}}
```

![Restore on an isolated destination.](guide:operator-upgrade-restore)

## Prepare older MinIO installations

Skip this task if already using Garage. Before migration, obtain the target release Compose/config files and merge the old service from your backup. Keep its exact cached image and volume. Preserve old credentials separately.

### 1. Preserve the old source service

Replace every placeholder using the preserved configuration. Use the original volume name instead of miniodata if different. Literal old credentials keep working after the S3 variables change. Do not pull a guessed latest image.

```text
{{operator:upgrade-minio-config}}
```

![Preserve the old source service.](guide:operator-upgrade-minio-config)

### 2. Generate new Garage values

Prefix the 24-character hex result with GK for the access key. Generate separate 64-character hex results for the S3 secret, RPC secret and admin token. Keep them private.

```sh
{{operator:upgrade-garage-key}}
```

![Generate new Garage values.](guide:operator-upgrade-garage-key)

### 3. Write the new storage settings

Replace all placeholders before saving. Include config/garage.toml and the target release Compose files. The new Compose file refuses missing Garage secrets. Do not start the API yet.

```text
{{operator:upgrade-garage-config}}
```

![Write the new storage settings.](guide:operator-upgrade-garage-config)

## Migrate with the pinned API image

Keep databases available and every old writer stopped. Preserve database engine and object-store image versions.

### 1. Pin the chosen application release

Use the concrete release selected from release notes, not the literal placeholder. Do not change the issuer or encryption key.

```text
{{operator:upgrade-version}}
```

![Pin the chosen application release.](guide:operator-upgrade-version)

### 2. Download only the application images

Use all your existing Compose overlays. Keep previous images available for recovery. This does not upgrade PostgreSQL or Garage.

```sh
{{operator:upgrade-pull}}
```

![Download only the application images.](guide:operator-upgrade-pull)

### 3. Run migrations once

Require exit 0 and successful internal and target migrations. This starts no dependency or API listener. On failure, stop. Some changes may already be committed. Never start old binaries against a partially changed schema. Restore matching databases, files, keys and images together if recovery is required.

```sh
{{operator:upgrade-migrate}}
```

![Run migrations once.](guide:operator-upgrade-migrate)

## Copy old objects before reopening writes

Only for the MinIO-to-Garage move. Keep the API stopped. Databases must be available for the maintenance CLI.

### 1. Start the source and target object stores

Use actual service names from the merged Compose configuration. Do not include api in this command.

```sh
{{operator:upgrade-stores}}
```

![Start the source and target object stores.](guide:operator-upgrade-stores)

### 2. Copy and verify the objects

Replace OLD_KEY, OLD_SECRET and SOURCE_BUCKET. Credentials appear in process arguments and shell history. The copy does not change MinIO. Repeat after failure to resume. It skips same-size objects; equal size does not prove equal content. Require successful verification, then compare representative file checksums and opened files. Keep the old volume. Deleting it is an optional later disposal task.

```sh
{{operator:upgrade-storage-copy}}
```

![Copy and verify the objects.](guide:operator-upgrade-storage-copy)

## Check before resuming traffic

Start the new API only after migration and any storage copy pass. Reconcile deliveries and external effects before restoring an older snapshot if traffic was already reopened.

### 1. Start the pinned services and inspect status

Keep the engine versions and overlays unchanged. Read actual logs and representative saved data before reopening incoming traffic.

```sh
{{operator:upgrade-start}}
```

![Start the pinned services and inspect status.](guide:operator-upgrade-start)

### 2. Check health and outstanding work

HTTP 202 means accepted, not completed. Inspect webhook receipts and linked runs. Retry an interrupted logical request only with its original Idempotency-Key and input. Health alone proves neither restored data nor downstream effects.

```sh
{{operator:upgrade-health}}
```

![Check health and outstanding work.](guide:operator-upgrade-health)

### 3. Rebuild older warehouse projections only when required

For releases predating result status, the Patient Index or duplicate detection, this fills the added warehouse/index fields. It rewrites the read model and requires --force. Skip when not required. Keep the verified backup and previous images under your retention policy.

```sh
{{operator:upgrade-reproject}}
```

![Rebuild older warehouse projections only when required.](guide:operator-upgrade-reproject)
