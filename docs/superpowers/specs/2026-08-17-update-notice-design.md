# Telling the operator a new version exists — Design

**Status:** approved, not implemented
**Project B of two.** Project A (`docs/superpowers/specs/2026-08-17-release-process-design.md`)
is COMPLETE and merged (`0b609347`). B reads the `latest.json` A publishes.

**Ships in the first release.** Operator decision, 2026-08-17: build B, then cut `0.1.1`
carrying it. If B shipped in `0.1.2` instead, every install on `0.1.1` would stay blind and need
a manual upgrade before it could ever report one — which is the problem B exists to solve.

## The problem

An install has no way to learn that a newer version exists. `Settings→General` shows the
running version (`readAppVersion()` → `/api/config` → `General.tsx:137`) and compares it to
nothing. Nothing polls, nothing announces. An operator finds out a release happened by being
told.

## What this builds

A check, not an upgrade. The app reports that a newer version exists and shows the two commands
to run. **It never pulls an image and never restarts anything.**

That boundary is deliberate. A container cannot restart the container it runs inside, and the
mechanism that would let it — mounting the Docker socket — is effectively root on the host,
inherited by any studio XSS or compromised marketplace plugin. Auto-apply is out of scope here
and would be its own project with its own threat model.

## Where the answer comes from

```
https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json
```

A permanent URL that always redirects to the newest release's asset. A static file download, not
the Releases API — no rate limit, no API contract, and A owns the shape:

```json
{ "version": "0.2.0", "releasedAt": "2026-08-20", "notesUrl": "…/releases/tag/v0.2.0" }
```

`parseReleaseManifest` (`packages/release/src/manifest.ts`) already parses this and already
returns `null` rather than throwing on anything malformed — it was written for exactly this
consumer. **B must reuse it, and must reuse `isNewerVersion` from `@openldr/core/pure`.** A third
opinion about what "newer" means would publish releases B never announces.

## Architecture

The API polls; the cache is the single source every surface reads.

```
timer ──► fetch latest.json ──► parseReleaseManifest ──► app settings cache
                                                              │
                        ┌─────────────────────┬───────────────┼──────────────┐
                        ▼                     ▼               ▼              ▼
                 About card            notification bell   the two      openldr
              (Settings→General)      (update_available)   commands   update check
```

Server-side, not browser-side: one request per install however many operators are looking, it
survives a phone on Tailscale with no internet, and it is the only shape that can back a CLI
command (AGENTS.md §6 requires CLI parity for settings features).

**Placement.** `createUpdateCheck(store: AppSettingStore)` in `@openldr/bootstrap`, following
`validation-settings.ts`, `lab-identity.ts` and `sync-settings.ts`. Putting it there is what
makes the Fastify route and the CLI call identical code rather than two copies.

**Cache shape**, in app settings — discrete keys, not a blob
(see [[distributed-sync-central-workstream]] for why a blob the reader never reads is a real
failure mode here):

| key | meaning |
|---|---|
| `update.enabled` | the switch. Default **true**. |
| `update.latestVersion` | last good `version`, or empty |
| `update.releasedAt` | last good `releasedAt` |
| `update.notesUrl` | last good `notesUrl` |
| `update.firstSeenAt` | when THIS version was first observed — see the trap below |
| `update.lastCheckedAt` | last attempt, success or not |
| `update.lastError` | last failure message, or empty |

## Poll policy

- On boot, then every 24 hours. Releases are rare; anything faster is noise.
- **A failed fetch is silent.** Record `lastCheckedAt` and `lastError`, keep the last good
  answer, do not toast. An air-gapped lab must not be nagged for being air-gapped.
- Never announce when the running version is greater than or equal to the published one.
  `isNewerVersion` returns `false` when either side is unparseable, so a malformed manifest
  degrades to "no update known" rather than a false alarm.

## The switch, and what it discloses

**On by default**, with a switch in `Settings→General`. Default-on is what gives the feature
reach — the operators most likely to miss a release are the least likely to go and enable a
check for one.

**It is a telemetry channel and the docs must say so.** A timed GET means the server's logs see
each install's IP and timestamp on a schedule. Nothing else is sent: no site id, no version, no
identifier — a plain unauthenticated GET of a static file. The docs state that plainly, in
en/fr/pt, next to the switch that turns it off.

## The four surfaces

1. **`Settings→General` About card.** The version line becomes `0.1.1 — 0.2.0 available`, with
   the release date and a link to the notes. Also shows `lastCheckedAt`, so "no update" is
   distinguishable from "never checked".
2. **Notification bell.** A new `update_available` type, priority `info`, `linkTo`
   `/settings/general`. It reuses the existing per-type preferences, so an operator who does not
   want it switches it off like any other.
3. **The two commands, inline.** `docker compose pull` and `docker compose up -d`, with the
   install directory filled in. Without this the operator learns a version exists and still does
   not know what to do — the half of the problem that is not detection.
4. **`openldr update check`.** Prints the running version, the published version, and the
   commands. Exit 0 when current, 1 when an update exists, so it can be scripted. Required by
   AGENTS.md §6, and it is the surface that actually fits a headless lab.

## ⛔ The trap in the bell

Notifications here are **derived, not stored** — `syncRowToNotification` and
`auditRowToNotification` map existing rows, and there is no notifications table. Read-state lives
in `notification_reads`, keyed by `notification_id`, plus a cursor row: `listNotifications`
(`packages/bootstrap/src/notifications.ts:191`) marks anything with
`createdAt <= reads.cursor` as read.

So `update_available` is **synthetic** — derived from the cache, with no source row and no new
table. Two things it must get right:

- **A stable id: `update:<version>`.** This gives per-version de-duplication for free. One
  notification per version, no matter how many times the poll runs.
- **`createdAt` must be `update.firstSeenAt`, not `now`.** That is the whole reason
  `firstSeenAt` is stored. If `createdAt` were the current time, it would always be newer than
  the mark-all-read cursor, and the notification would silently reappear as unread on every
  request — a bell that cannot be dismissed.

Deriving it from the cache rather than writing an `audit_events` row also keeps the audit log to
actor-driven events; "a website said a version exists" is not one.

## Testing

- `isNewerVersion` and `parseReleaseManifest` are already tested in A. B adds no third copy.
- The **decision** — given a running version, a cached manifest and the switch, is there an
  update and what does the notification look like — is a pure function, tested with fixtures. All
  of it: current, newer, older, equal, unparseable, empty cache, switch off.
- **The de-duplication and dismissal trap gets its own test**: the synthetic notification's
  `createdAt` must equal `firstSeenAt` across repeated polls, and must stay dismissed after
  mark-all-read.
- The poll's I/O is thin and injected, like A's `FetchJson`.

### HONEST NON-PROOF

`latest.json` does not exist yet — no release has been published. **Every test is against a
fixture.** The live path is proven the moment `0.1.1` publishes the file, and not before. That
same release is also the first proof of A's steps 7-10, so one release verifies both.

## Out of scope

- **Any auto-apply.** No pulling, no restarting, no Docker socket.
- **Third-party images.** `deploy/install/docker-compose.yml` also pins `minio/minio:latest`,
  `minio/mc:latest` and `certbot/certbot:latest`. B says nothing about those; they are a separate
  slice (noted in A's spec).
- **Downgrade or rollback guidance.**
- **The two existing `compareVersions` copies** in `apps/web/src/docs/content.ts` and
  `apps/studio/src/docs/version.ts`.
