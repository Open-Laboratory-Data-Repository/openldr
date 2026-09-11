# Planned upgrades

Schedule downtime for a Compose upgrade. Schema changes can prevent old and new versions from writing safely together. This procedure keeps the database engine version unchanged. A database engine upgrade needs its own tested procedure.

## Prepare the release

Work in the installed Compose project directory. Use the same project name, environment file and Compose overlays throughout. Record the current image tags and IDs with `docker compose images`. Keep the previous images and Compose files available. Read the target release notes and migration requirements.

Save the current `.env` and configuration privately before editing them. Pin `OPENLDR_VERSION` to the chosen release in `.env`. Download only the application images needed by that release before downtime. Do not blindly pull every service: the storage services have separate versions, and MinIO may use `latest`. Preserve the current PostgreSQL, MinIO and external database versions.

Save this guide outside Studio before stopping services. Confirm who can restore backups and how senders queue or retry during downtime.

## Stop writes and wait

Pause webhook senders, scheduled external writers, synchronization peers and operator writes. Block new incoming traffic. Stop every old API replica, including replicas outside this Compose project. Stop separate CLI jobs and other processes that write to the same databases or storage.

New installer Compose files set this API service property:

```yaml
stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}
```

Existing installations must add this property under `services.api` in their local Compose file. Set `OPENLDR_STOP_GRACE_PERIOD` to allow the longest expected work to finish. An explicit stop timeout takes precedence:

```sh
docker compose stop -t 300 api
```

The example allows 300 seconds. Increase it when necessary. OpenLDR waits for active requests and workers during shutdown. Check container state and shutdown logs. A forced kill, timeout or exit code 137 does not prove work drained. Investigate before proceeding, including possible partial external effects.

Stop Keycloak and MinIO after the API stops, and stop any other writers to their stores. Keep PostgreSQL running for logical backups. Keep all writers stopped through backup verification and migrations. Queued webhook receipts may remain for the new worker. Record their IDs and investigate running or interrupted work before resuming deliveries.

## Back up one stopped-write state

Store the backup privately, outside the deployment's volumes. Capture all of these from the same period without writes:

- The internal database, configured target database and Keycloak database, plus required database roles.
- Every blob bucket or volume, including files referenced by workflow receipts.
- `.env`, Compose files and overlays, mounted configuration, encryption and signing keys, certificates and local `data` files.
- The image inventory and exact previous application release.

For PostgreSQL, identify the real database names and account first. Run `pg_dump -Fc -f /tmp/DB.dump -U USER DB` inside the PostgreSQL container with `docker compose exec -T postgres`. Replace `DB` and `USER` with deployment values. Copy each completed dump out with `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. The destination directory must already exist. Repeat for each database. Check every exit code.

Save roles separately with `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, then copy that file out. Use the same container execution pattern. Protect these files because they can contain credentials. Using `-f` and `compose cp` avoids binary shell redirection in Windows PowerShell.

For MySQL, SQL Server or externally managed stores, use the database administrator's native backup and restore procedure. PostgreSQL dumps do not cover those databases. For MinIO, use a tested bucket backup or copy its volume while MinIO is stopped. Do not copy a live PostgreSQL data volume as a logical backup. Never run `docker compose down -v` during an upgrade.

## Prove the backup restores

Restore into separate database and blob destinations that cannot contact production services or senders. Restore roles and each database with errors treated as failures. Resolve bootstrap role conflicts explicitly. Compare representative row counts and saved records. Restore blob files and compare their checksums against the backup.

Use the preserved encryption keys to decrypt representative saved secrets in the isolated environment. Confirm that restored records can find their restored blobs. A successful dump, archive listing or health response alone does not prove recoverability. Do not migrate production until this restore check succeeds.

## Migrate before starting the new API

Keep the databases available and every old writer stopped. Confirm the API image is the pinned new release. Run its bundled CLI once:

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

This command overrides the API start command. It does not start dependencies or serve requests. Require exit code 0 and successful internal and target database migrations before starting the new services.

If migration fails, stop here. Some schema changes may already have committed. Do not start old binaries against that schema. Diagnose the failure, or restore the matching database, blob, configuration, keys and image snapshot together. If traffic was reopened, reconcile deliveries and external effects before restoring an older snapshot.

## Check before resuming traffic

Start the existing storage and identity services first, then the pinned new application services. Preserve their database engine versions. Check `docker compose ps`, API health and logs. Read representative saved data through Studio or the CLI. Check workflow receipts and their linked runs before reopening incoming traffic.

An HTTP 202 means the webhook was accepted, not completed. Poll outstanding receipts. Investigate interrupted receipts and external effects before deciding whether to submit replacement work. Retry the same logical request with its original `Idempotency-Key` and input. Do not bulk replay interrupted requests with fresh keys.

Resume senders only after these checks pass. Keep the verified backup and previous images according to the site's retention policy.

## References

- [Docker Compose service shutdown grace](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Docker Compose one-off commands](https://docs.docker.com/reference/cli/docker/compose/run/)
- [PostgreSQL 16 backup and restore](https://www.postgresql.org/docs/16/backup-dump.html)
