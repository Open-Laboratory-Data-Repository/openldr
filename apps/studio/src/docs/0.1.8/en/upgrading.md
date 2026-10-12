# Planned upgrades

Schedule downtime for a Compose upgrade. Schema changes can prevent old and new versions from writing safely together. This procedure keeps the database engine version unchanged. A database engine upgrade needs its own tested procedure.

## Prepare the release

Work in the installed Compose project directory. Use the same project name, environment file and Compose overlays throughout. Record the current image tags and IDs with `docker compose images`. Keep the previous images and Compose files available. Read the target release notes and migration requirements.

Save the current `.env` and configuration privately before editing them. Pin `OPENLDR_VERSION` to the chosen release in `.env`. Download only the application images needed by that release before downtime. Do not blindly pull every service: the storage services have separate versions. Preserve the current PostgreSQL, storage service and external database versions.

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

Stop Keycloak and the storage service after the API stops, and stop any other writers to their stores. Keep PostgreSQL running for logical backups. Keep all writers stopped through backup verification and migrations. Queued webhook receipts may remain for the new worker. Record their IDs and investigate running or interrupted work before resuming deliveries.

## Back up one stopped-write state

Store the backup privately, outside the deployment's volumes. Capture all of these from the same period without writes:

- The internal database, configured target database and Keycloak database, plus required database roles.
- Every blob bucket or volume, including files referenced by workflow receipts.
- `.env`, Compose files and overlays, mounted configuration, encryption and signing keys, certificates and local `data` files.
- The image inventory and exact previous application release.

For PostgreSQL, identify the real database names and account first. Run `pg_dump -Fc -f /tmp/DB.dump -U USER DB` inside the PostgreSQL container with `docker compose exec -T postgres`. Replace `DB` and `USER` with deployment values. Copy each completed dump out with `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. The destination directory must already exist. Repeat for each database. Check every exit code.

Save roles separately with `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, then copy that file out. Use the same container execution pattern. Protect these files because they can contain credentials. Using `-f` and `compose cp` avoids binary shell redirection in Windows PowerShell.

For MySQL, SQL Server or externally managed stores, use the database administrator's native backup and restore procedure. PostgreSQL dumps do not cover those databases. For the storage service, use a tested bucket backup or copy its volume while the service is stopped. Do not copy a live PostgreSQL data volume as a logical backup. Never run `docker compose down -v` during an upgrade.

## Prove the backup restores

Restore into separate database and blob destinations that cannot contact production services or senders. Restore roles and each database with errors treated as failures. Resolve bootstrap role conflicts explicitly. Compare representative row counts and saved records. Restore blob files and compare their checksums against the backup.

Use the preserved encryption keys to decrypt representative saved secrets in the isolated environment. Confirm that restored records can find their restored blobs. A successful dump, archive listing or health response alone does not prove recoverability. Do not migrate production until this restore check succeeds.

## Migrate before starting the new API

An install from before 0.1.11 must do steps 1 to 4 of the section "Moving from MinIO to Garage" below first. The new compose file refuses to run without `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN`.

Keep the databases available and every old writer stopped. Confirm the API image is the pinned new release. Run its bundled CLI once:

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

This command overrides the API start command. It does not start dependencies or serve requests. Require exit code 0 and successful internal and target database migrations before starting the new services.

If migration fails, stop here. Some schema changes may already have committed. Do not start old binaries against that schema. Diagnose the failure, or restore the matching database, blob, configuration, keys and image snapshot together. If traffic was reopened, reconcile deliveries and external effects before restoring an older snapshot.

## Check before resuming traffic

Start the existing storage and identity services first, then the pinned new application services. Preserve their database engine versions. Check `docker compose ps`, API health and logs. Read representative saved data through Studio or the CLI. Check workflow receipts and their linked runs before reopening incoming traffic.

An HTTP 202 means the webhook was accepted, not completed. Poll outstanding receipts. Investigate interrupted receipts and external effects before deciding whether to submit replacement work. Retry the same logical request with its original `Idempotency-Key` and input. Do not bulk replay interrupted requests with fresh keys.

If you upgrade from a release before lab_results had a status column, run `openldr db reproject --force` once. It fills in the status of results already in the warehouse, so rejected tests stop counting as results.

Resume senders only after these checks pass. Keep the verified backup and previous images according to the site's retention policy.

## Moving from MinIO to Garage (installs from before 0.1.11)

MinIO removed its images from Docker Hub on 2026-09-11. From 0.1.11 the `storage` service runs Garage instead. An install that already holds files must copy them across once. A fresh install does not need this.

1. Note the current MinIO key and secret from `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). Step 4 overwrites them.
2. Back up `.env` and `docker-compose.yml`.
3. Download the 0.1.11 files:
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/docker-compose.yml`, saved as `docker-compose.yml`
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/garage.toml`, saved as `config/garage.toml`

   Then add the old `minio` service back into `docker-compose.yml` from your backup. This keeps MinIO running beside Garage. Give it the old key and secret as literal values, not `${S3_...}`. Step 4 changes those variables, and MinIO would then reject the old login.

   ```yaml
     minio:
       image: minio/minio:latest
       command: server /data --console-address ':9001'
       environment:
         MINIO_ROOT_USER: <old key>
         MINIO_ROOT_PASSWORD: <old secret>
       volumes:
         - miniodata:/data
   ```

   Add `miniodata:` under the top-level `volumes:` too. The MinIO image is still on the machine from the old install, so this works without Docker Hub.
4. Generate new values and write them to `.env`:
   - `S3_ACCESS_KEY_ID`: `GK` followed by 24 hex characters (`echo GK$(openssl rand -hex 12)`)
   - `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`: 64 hex characters each (`openssl rand -hex 32`)
   - `S3_ENDPOINT=http://storage:3900`
5. Start MinIO and the new services: `docker compose up -d minio storage api`.
6. Copy the files:
   `./openldr storage copy --from-endpoint http://minio:9000 --from-key <old key> --from-secret <old secret> --from-bucket openldr`
   It prints object counts and bytes for both sides, then checks that every source object is on Garage at the same size. It exits non-zero if any is missing. Extra objects on Garage are expected while the api runs, because it keeps writing new files there. They do not fail the check. Run it again to resume after a failure. It skips objects already on Garage with the same size. It does not replace an object whose size is unchanged but whose content differs. It never changes MinIO.
7. When it reports `every source object is on the target`, open a few uploaded files in the studio.
8. Remove the `minio` service from `docker-compose.yml` and run `docker compose up -d --remove-orphans`. Keep the `miniodata` volume until you are sure. Then delete it with `docker volume rm <project>_miniodata`.

Without the `./openldr` wrapper, run `docker compose run --rm --no-deps api node /app/cli/dist/index.js storage copy` with the same flags.

The `--from-secret` value shows in your shell history and in the process list while the command runs. Clear that history line afterwards, or run the command in a throwaway shell.

If you run from source, the compose file (`docker-compose.prod.yml`) and `deploy/install/garage.toml` arrive with the new checkout. Skip the downloads in step 3, but still add the old `minio` service back with its old login. Your `.env.prod` came from an earlier `pnpm run init`. Its `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are not in Garage's format. Replace both as in step 4 (`GK` plus `openssl rand -hex 12`, and `openssl rand -hex 32`). Then add `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN`. Compose refuses to run until both exist. In step 5, start the services with `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build minio storage api`. In step 6, run the copy inside the api container with `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr exec api node /app/cli/dist/index.js storage copy` and the same flags. In step 8, use the same `--env-file`, `-f` and `-p` options.

## When a third-party image disappears

Every third-party image an install pulls comes from the OpenLDR copy on GHCR, pinned by digest. The list is `deploy/third-party-images.json`. If a vendor removes an image, existing installs and new installs keep working, because the copy stays. The one exception is SQL Server, whose image stays on Microsoft's registry.

To replace a vendor:

1. Pick a replacement that speaks the same protocol.
2. Add it to `deploy/third-party-images.json` and run `pnpm images:mirror <name>`. It copies linux/amd64 and linux/arm64 only.
3. Make the new GHCR package public in its settings page.
4. Swap it in behind the same compose service name.
5. If the data format differs, move the data. The MinIO to Garage section above is the worked example.

## References

- [Docker Compose service shutdown grace](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Docker Compose one-off commands](https://docs.docker.com/reference/cli/docker/compose/run/)
- [PostgreSQL 16 backup and restore](https://www.postgresql.org/docs/16/backup-dump.html)
