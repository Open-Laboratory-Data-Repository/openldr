# P15 upgrade rehearsal

Run on 2026-09-11 with Docker Compose v5.5.0 on Windows.
All databases, containers, networks, volumes, and credentials were disposable.
No live service or installed environment file was used.

| Check | Observed result | Limit |
| --- | --- | --- |
| Installer Compose default | `stop_grace_period=5m0s` | Parsed configuration only |
| Installer Compose override | `OPENLDR_STOP_GRACE_PERIOD=9m` produced `9m0s` | Parsed configuration only |
| Compose stop | Cleanup took 12.55 seconds, exit 0, timeout 300 seconds | Synthetic Node process |
| Bundled migration command | Exit 0, 92 internal and 17 external migrations | Existing 0.1.8 image |
| Repeated migration | Exit 0, `migrated internal: [] external: []` | Same disposable databases |
| Database restore | Three fixture rows recovered; migration counts 92 and 17 | PostgreSQL 16 only |
| Blob restore | Source and destination SHA256 matched | Plain fixture volume, no MinIO service |
| Cleanup | No remaining `codex-p15` containers, volumes, or networks | Temporary files retained |

The API image was `ghcr.io/open-laboratory-data-repository/openldr-api:0.1.8`.
Its image ID was `sha256:4987c451ea99dc1603dc8e51a4d6e4b62a13d207f0dd5cf203cf980070db95ba`.
`apps/server/Dockerfile` copies the CLI to `/app/cli`.

## Disposable setup and migration

These PowerShell commands name only rehearsal resources. The fixed password is a fixture.
Check each native command's `$LASTEXITCODE` before continuing.
The actual run checked fixture creation, dumps, and restore failures explicitly.

```powershell
$p15 = Join-Path $env:TEMP 'codex-p15-rehearsal-20260911'
New-Item -ItemType Directory -Path $p15 -ErrorAction Stop

docker network create --internal codex-p15-net
docker run -d --name codex-p15-source --network codex-p15-net -e POSTGRES_PASSWORD=p15-fixture-only --tmpfs /var/lib/postgresql/data postgres:16-alpine
docker run -d --name codex-p15-restore --network codex-p15-net -e POSTGRES_PASSWORD=p15-fixture-only --tmpfs /var/lib/postgresql/data postgres:16-alpine
docker exec codex-p15-source pg_isready -U postgres
docker exec codex-p15-restore pg_isready -U postgres

foreach ($db in @('openldr','openldr_target','keycloak')) {
  docker exec codex-p15-source createdb -U postgres $db
  docker exec codex-p15-source psql -U postgres -d $db -v ON_ERROR_STOP=1 -c "CREATE TABLE p15_fixture (id integer PRIMARY KEY, value text); INSERT INTO p15_fixture VALUES (1, '$db-before-upgrade');"
}
```

Both readiness commands returned `accepting connections` before fixture creation.
The temporary `compose.yml` contained this configuration.

```yaml
services:
  api:
    image: ghcr.io/open-laboratory-data-repository/openldr-api:0.1.8
    environment:
      INTERNAL_DATABASE_URL: postgres://postgres:p15-fixture-only@codex-p15-source:5432/openldr
      TARGET_DATABASE_URL: postgres://postgres:p15-fixture-only@codex-p15-source:5432/openldr_target
      S3_ENDPOINT: http://unused-minio:9000
      S3_ACCESS_KEY_ID: fixture
      S3_SECRET_ACCESS_KEY: fixture-only
      S3_BUCKET: fixture
      OIDC_ISSUER_URL: http://unused-keycloak:8080/realms/fixture
    networks: [fixture]
networks:
  fixture:
    external: true
    name: codex-p15-net
```

```powershell
docker compose -p codex-p15 -f (Join-Path $p15 'compose.yml') run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

Exit 0. The output listed internal migrations `001_fhir_resources` through
`092_drop_facility_import_edits` and 17 external migrations.
Running the same command again returned exit 0 with empty migration lists.
Node also printed its WASI experimental warning.
The nonexistent S3 and identity hosts were never needed by this migration command.

## Database backup and restore

No writer ran during these sequential dumps. Files stayed binary throughout.
`pg_dump` wrote inside the source container, and `docker cp` copied each file.
PowerShell did not redirect dump bytes.

```powershell
foreach ($db in @('openldr','openldr_target','keycloak')) {
  docker exec codex-p15-source pg_dump -U postgres -d $db -Fc -f "/tmp/$db.dump"
  docker cp "codex-p15-source:/tmp/$db.dump" (Join-Path $p15 "$db.dump")
  docker cp (Join-Path $p15 "$db.dump") "codex-p15-restore:/tmp/$db.dump"
  docker exec codex-p15-restore createdb -U postgres $db
  docker exec codex-p15-restore pg_restore -U postgres -d $db --exit-on-error "/tmp/$db.dump"
  docker exec codex-p15-restore psql -U postgres -d $db -At -c 'SELECT id, value FROM p15_fixture'
}
docker exec codex-p15-restore psql -U postgres -d openldr -At -c 'SELECT count(*) FROM kysely_migration'
docker exec codex-p15-restore psql -U postgres -d openldr_target -At -c 'SELECT count(*) FROM kysely_migration'
```

The restored rows were `1|openldr-before-upgrade`,
`1|openldr_target-before-upgrade`, and `1|keycloak-before-upgrade`.
The restored migration counts were `92` and `17`.
The Keycloak database held a fixture table, not actual Keycloak data.

## Blob backup and restore

The source volume had no active writer when archived.
The restore used a different volume.

```powershell
docker volume create codex-p15-blob-source
docker volume create codex-p15-blob-restore
docker run --rm --name codex-p15-blob-write --network none -v codex-p15-blob-source:/data alpine:latest sh -c 'mkdir -p /data/fixture; printf "P15 immutable blob fixture\n" > /data/fixture/payload.bin; sha256sum /data/fixture/payload.bin'
docker run --name codex-p15-blob-backup --network none -v codex-p15-blob-source:/data:ro alpine:latest tar -czf /tmp/blob.tgz -C /data .
docker cp codex-p15-blob-backup:/tmp/blob.tgz (Join-Path $p15 'blob.tgz')
docker create --name codex-p15-blob-extract --network none -v codex-p15-blob-restore:/data alpine:latest tar -xzf /tmp/blob.tgz -C /data
docker cp (Join-Path $p15 'blob.tgz') codex-p15-blob-extract:/tmp/blob.tgz
docker start -a codex-p15-blob-extract
docker run --rm --name codex-p15-blob-check --network none -v codex-p15-blob-restore:/data:ro alpine:latest sha256sum /data/fixture/payload.bin
```

Both checks returned `92dedadb0ccc7b99e916fab118701cd561258913035b7dacbd89627b4a58d9c1`.
This checks archive transport and extraction, not MinIO metadata or object access.

## Grace period

Copy the installer Compose file into the temporary directory before parsing it.
Use an empty temporary `.env`, never the installed credentials.

```powershell
Copy-Item -LiteralPath deploy/install/docker-compose.yml -Destination (Join-Path $p15 'installer.yml')
'' | Set-Content -LiteralPath (Join-Path $p15 '.env')
$p15default = docker compose --env-file (Join-Path $p15 '.env') -p codex-p15-config -f (Join-Path $p15 'installer.yml') config --format json | ConvertFrom-Json
$p15default.services.api.stop_grace_period
'OPENLDR_STOP_GRACE_PERIOD=9m' | Set-Content -LiteralPath (Join-Path $p15 'override.env')
$p15override = docker compose --env-file (Join-Path $p15 'override.env') -p codex-p15-config -f (Join-Path $p15 'installer.yml') config --format json | ConvertFrom-Json
$p15override.services.api.stop_grace_period
```

Output was `5m0s`, then `9m0s`.
A separate temporary `drain.yml` exercised Docker's stop behavior.

```yaml
services:
  drain:
    image: node:20-alpine
    network_mode: none
    stop_grace_period: 300s
    command: ["node", "-e", "process.on('SIGTERM',()=>{console.log('SIGTERM');setTimeout(()=>{console.log('drained');process.exit(0)},12000)});setInterval(()=>{},1000);console.log('ready')"]
```

```powershell
docker compose -p codex-p15-drain -f (Join-Path $p15 'drain.yml') up -d
$p15timer = [Diagnostics.Stopwatch]::StartNew()
docker compose -p codex-p15-drain -f (Join-Path $p15 'drain.yml') stop drain
$p15timer.Stop()
$p15timer.Elapsed.TotalSeconds
docker inspect codex-p15-drain-drain-1 --format 'exit={{.State.ExitCode}} timeout={{.Config.StopTimeout}}'
docker compose -p codex-p15-drain -f (Join-Path $p15 'drain.yml') logs
```

The stop took 12.55 seconds. Inspection returned `exit=0 timeout=300`.
Logs contained `ready`, `SIGTERM`, and `drained`.
This proves Docker allowed cleanup beyond its usual ten seconds.
It does not measure an OpenLDR job's shutdown time.

## Cleanup and retained files

```powershell
docker compose -p codex-p15-drain -f (Join-Path $p15 'drain.yml') down
docker rm -f -v codex-p15-source codex-p15-restore
docker rm codex-p15-blob-backup codex-p15-blob-extract
docker volume rm codex-p15-blob-source codex-p15-blob-restore
docker network rm codex-p15-net
docker ps -a --filter name=codex-p15 --format '{{.Names}}'
docker volume ls --filter name=codex-p15 --format '{{.Name}}'
docker network ls --filter name=codex-p15 --format '{{.Name}}'
```

Cleanup returned exit 0. The final three listings returned no names.
Temporary dumps, archives, and Compose files remain under
`C:/Users/Fredrick/AppData/Local/Temp/codex-p15-rehearsal-20260911`.
They contain fixture data and fixture credentials only.

## HONEST NON-PROOF

This was not a full release upgrade or rollback rehearsal.
It did not build the current checkout, start OpenLDR, or exercise real jobs.
It did not test Keycloak login, MinIO reads, external targets, or a restored deployment.
It did not run migrations against the restored databases after checking their contents.
A release rehearsal must prove those behaviors against the exact candidate image.

A real recovery set must preserve every database and blob store at one quiesced point.
It must include the matching environment, encryption keys, certificates, and image versions.
External target databases need their own matching backups.
This disposable test had no installed keys or certificates to recover.
