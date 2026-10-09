# Third-party images and Garage storage

Date: 2026-10-09. Status: design approved in chat, awaiting spec review.

## What happened

MinIO removed `minio/minio` and `minio/mc` from Docker Hub on 2026-09-11. Every install pulls
both, so every fresh install of every OpenLDR version now fails at `docker compose pull`.

Measured on 2026-10-09:

- The Docker Hub API returns 404 for `minio/minio` and `minio/mc`. The same probe returns 200 for
  `library/postgres` and `certbot/certbot`.
- `quay.io/minio/minio` and `quay.io/minio/mc` refuse anonymous pulls (401). The same probe on
  `quay.io/keycloak/keycloak` returns 200. Blog posts from late September still name quay as the
  fallback. It is gone too.
- The v0.1.9 release pushed all five OpenLDR images, then failed at its verification install on
  `pull access denied for minio/mc`. No git tag, no GitHub release, no `latest.json`. The images are
  public on `:0.1.9` and `:latest`, so 0.1.9 is burned and the next release is 0.1.10.

Keycloak shows why this matters. Installs pull `openldr-keycloak` from our GHCR, built
`FROM quay.io/keycloak/keycloak:26.0` (`deploy/keycloak/Dockerfile:4`). If Keycloak vanished
upstream, installs would keep working and only our next rebuild would fail. MinIO broke installs
because installs pulled MinIO's image directly.

## What we are building

1. An image policy. Installs and our Dockerfiles pull third-party images only from our GHCR
   copies, pinned by digest. A vendor that disappears can no longer break an install.
2. A `storage` service running Garage, replacing MinIO in new installs.
3. An `openldr storage copy` command that moves objects from MinIO to Garage on installs that
   already hold data. I run it on the droplet. New installs never need it.

Not building: a studio UI for the copy (operator decision, 2026-10-09), automatic watching for
upstream security updates, and any change to how the app talks to S3 beyond the checksum fix below.

## The app is already decoupled from MinIO

`packages/adapter-s3-bucket/src/index.ts:41-90` uses only generic S3 calls through the AWS SDK:
HeadBucket, PutObject, multipart Upload, GetObject, HeadObject, DeleteObject, and a presigned
GET. Nothing in production code calls `presign`. MinIO is tied to deployment files only:

- `deploy/install/docker-compose.yml:80-96`, `docker-compose.prod.yml:87-104`,
  `docker-compose.yml:21-37`
- the `.env` the installer writes: `install/install.sh:433,498-503`,
  `install/install.ps1:417-422`
- `install/development.sh:85-86`
- docs: `apps/studio/src/docs/0.1.8/{en,fr,pt}/{environment,upgrading}.md`,
  `apps/web/src/docs/0.1.8/{environment,upgrading,development}.md`
- the `miniodata` volume on each running install

`BLOB_ADAPTER` accepts only `minio` (`packages/config/src/schema.ts:37`). It is a label and the
installer never writes it, so it stays as it is.

## Spike results (Garage v2.4.1, 2026-10-09)

I ran `dxflrs/garage:v2.4.1` locally and pointed the real `createS3Bucket` adapter at it.

| Check | Result |
|---|---|
| `--single-node --default-bucket` creates key and bucket from env | Works |
| Key ID `GK` + 24 hex, secret 64 hex | Works. A bad key exits 1: `Invalid default access key` |
| Shell in the image | None. `/garage status` exits 0 and works as an exec health check |
| `s3_region = "us-east-1"` in `garage.toml` | Works. `S3_REGION` stays as it is |
| health, put, get, getStream, exists, delete, presign + fetch | All work |
| 12 MB multipart upload read back with default SDK settings | Fails: `Checksum mismatch` |
| Same read with checksums set to `WHEN_REQUIRED` | Works, all 12,582,912 bytes correct |
| ListObjectsV2 over 1,008 objects | 2 pages, 1,008 keys |
| Restart with the same env | Key, bucket and data survive |
| Wrong secret | Health check reports `down` |
| Platforms published upstream | amd64, arm64, 386, arm |

The checksum failure is real and would hit production. Garage returns a CRC32 for a multipart
object (ETag ending `-3`) that is a checksum of the part checksums, without the `-3` suffix or a
`ChecksumType: COMPOSITE` header. `@aws-sdk/client-s3` 3.1066.0 validates it as a whole-object
checksum and throws. Any upload above the 5 MB multipart threshold would save, then fail on
every read.

## Part 1: image policy

### The list

`deploy/third-party-images.json` holds one entry per image:

```json
{
  "name": "garage",
  "upstream": "dxflrs/garage:v2.4.1",
  "copy": "ghcr.io/open-laboratory-data-repository/garage:v2.4.1",
  "digest": "sha256:..."
}
```

### What it covers

| Image | Used by | In the policy |
|---|---|---|
| garage | all three compose files | yes |
| postgres:16-alpine | install and prod compose | yes |
| certbot/certbot | install and prod compose (profile `letsencrypt`) | yes, pinned to a version instead of `latest` |
| mysql:8.4 | `deploy/install/docker-compose.mysql.yml` | yes |
| nginx:1.27-alpine | studio, web, gateway Dockerfiles, prod compose | yes |
| node:22-bookworm-slim | server, studio, web Dockerfiles | yes |
| quay.io/keycloak/keycloak:26.0 | `deploy/keycloak/Dockerfile` | yes |
| mcr.microsoft.com/mssql/server | `deploy/install/docker-compose.mssql.yml` | no, listed exception |
| postgis, dhis2, version-variable mssql and mysql | `docker-compose.yml` (dev only) | no |

SQL Server ships under Microsoft's licence, which may not allow us to host a copy. It stays on
`mcr.microsoft.com` as a listed exception (operator decision, 2026-10-09). The dev compose file is a
developer convenience. Developers have the images cached, and its mssql and mysql tags come from
variables, which a digest pin cannot cover. It gets the `storage` swap and nothing else.

### The copy script

`pnpm images:mirror <name>` runs `docker buildx imagetools create` from upstream to our GHCR
copy. That copies on the registry side and keeps every platform. It then writes the new digest
into the list. Someone runs it on purpose to take an upstream update. Nothing runs it on a timer.

A new GHCR package starts private. The script prints the settings URL for each new package,
because GitHub has no API to change package visibility (measured 2026-08-17).

### Enforcement

- A test in `packages/release` reads the install and prod compose files and every
  Dockerfile. Each third-party reference must be a GHCR copy from the list, pinned by that
  digest. Listed exceptions pass.
  The test fails on anything else, so a new vendor image cannot slip in.
- `pnpm release` refuses when a listed copy is missing or private. It reuses
  `findPrivatePackages` (`scripts/release.ts:331`) with the list's names added.

### Runbook

A new section of the upgrading page covers what to do when a vendor image disappears. A new
page would need nav entries and titles in three languages for no gain.

1. Existing installs keep working. Our copy is still there.
2. Pick a replacement that speaks the same protocol.
3. Copy it into GHCR with `pnpm images:mirror`.
4. Swap it in behind the same compose service name.
5. If the data format differs, move the data with a copy command. MinIO to Garage is the worked
   example.

## Part 2: the `storage` service

### Compose

`minio` and `minio-init` become one service, `storage`, in all three compose files.

```yaml
storage:
  image: ghcr.io/open-laboratory-data-repository/garage:v2.4.1@sha256:...
  command: ["/garage", "server", "--single-node", "--default-bucket"]
  environment:
    GARAGE_RPC_SECRET: ${GARAGE_RPC_SECRET:?...}
    GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:?...}
    GARAGE_DEFAULT_ACCESS_KEY: ${S3_ACCESS_KEY_ID:?...}
    GARAGE_DEFAULT_SECRET_KEY: ${S3_SECRET_ACCESS_KEY:?...}
    GARAGE_DEFAULT_BUCKET: ${S3_BUCKET:-openldr}
  volumes:
    - ./config/garage.toml:/etc/garage.toml:ro
    - storagedata:/var/lib/garage
  healthcheck:
    test: ["CMD", "/garage", "status"]
  restart: unless-stopped
```

The S3 port is 3900, reachable only on the compose network. The api's `depends_on` changes from
`minio: service_started` to `storage: service_healthy`, so the bucket exists before the api's own
bucket check. The dev compose maps 3900 to host port 9010, the port MinIO used, and uses fixed
dev keys in Garage's format.

### Config

`deploy/install/garage.toml` holds data paths, `db_engine = "sqlite"`,
`replication_factor = 1`, the bind addresses, and `s3_region = "us-east-1"`. No secrets. The
installer downloads it to `config/garage.toml`, next to the realm file. `docker-compose.prod.yml`
and `docker-compose.yml` mount the same file from the repo.

### Installer

`install.sh` and `install.ps1` generate:

- `S3_ACCESS_KEY_ID` as `GK` + 24 hex characters
- `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN` as 64 hex characters each

`S3_ENDPOINT` becomes `http://storage:3900`. The other `S3_*` values stay as they are.

`pnpm run init` (the source install) writes keys too, in `scripts/init/secrets.mjs`. It gets the
same formats, and the dev values in `.env.example` and `.env.prod.example` change to Garage-format
keys that it treats as weak defaults to replace.

### Adapter fix

`createS3Bucket` builds its `S3Client` with `requestChecksumCalculation: 'WHEN_REQUIRED'` and
`responseChecksumValidation: 'WHEN_REQUIRED'`. That was the SDK's behaviour before 3.729, so AWS
and MinIO keep working. A unit test pins both settings.

## Part 3: moving existing installs

### `openldr storage copy`

The shared code lives in `@openldr/bootstrap`. The CLI command is registered in
`packages/cli/src/program.ts`.

- The source comes from flags: `--from-endpoint`, `--from-key`, `--from-secret`,
  `--from-bucket`, `--from-region` (default `us-east-1`). The target is the install's own storage
  config.
- It lists every source object with ListObjectsV2, page by page, and streams each to the target.
- It skips an object already on the target with the same size, so a re-run resumes.
- It prints object count and total bytes for source and target, and exits non-zero when they
  differ.
- It never writes to or deletes from the source.
- It audits one entry with `actorName: 'cli'`.

It needs no `--force`, because it changes nothing that existed before it ran.

### The droplet

I run this after 0.1.10 is released:

1. Record MinIO's object count and total bytes.
2. Back up `docker-compose.yml` and `.env`. Add the `storage` service and `config/garage.toml`
   beside the running `minio` service. MinIO's image is cached on the droplet.
3. Generate Garage keys. Keep the old MinIO key and secret aside for the copy.
4. Run `./openldr storage copy` with MinIO as the source. Counts and bytes must match.
5. Switch `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` to Garage. Recreate the
   api.
6. Read one existing object through the app.
7. Remove the `minio` service. Keep the `miniodata` volume until the operator says to delete it.

### Testers

The upgrading page in en, fr and pt gets the same steps. A tester with nothing worth keeping can
do a fresh install instead.

## Testing

| Layer | What proves it | What it does not prove |
|---|---|---|
| Adapter unit test | Client built with both checksum settings | That Garage accepts the requests |
| Copy unit tests, fake S3 | Pagination, skip on same size, non-zero exit on mismatch, no source writes, CLI registration | Real network, real Garage |
| Image policy test | Every reference in scope is a pinned GHCR copy | That the copy exists or is public |
| Release precondition | Copies exist and are public | That the images run |
| Local MinIO to Garage copy | The command against both real servers | Droplet-sized data |
| Release verification install (0.1.10) | A fresh install with Garage comes up healthy | Migration of existing data |
| Droplet migration | The whole path on real data | Testers' own installs |
| Gate | Forced test and typecheck at `--concurrency=2` | Anything above |

## Order of work

One branch, `feat/garage-storage`, in `.claude/worktrees/garage-storage`.

1. The list, `pnpm images:mirror`, the GHCR copies, and the enforcement test. Compose files and
   Dockerfiles switch to the copies.
2. The `storage` service, `garage.toml`, installer changes, and the adapter fix.
3. `openldr storage copy`.
4. Docs in en, fr and pt: environment, upgrading, and the new runbook page.
5. Gate, merge to local `main`, push, `pnpm make:changelog`.
6. Bump to 0.1.10, `pnpm release`.
7. Move the droplet to Garage.

## Open items

- The private GHCR `minio` and `mc` stopgap packages are to be deleted (operator decision,
  2026-10-09). The first attempt failed because the `gh` token lacks `delete:packages`.
- Garage updates arrive only when someone runs `pnpm images:mirror`.
- Our copies keep installs working after a vendor leaves. They do not solve a licence change.
