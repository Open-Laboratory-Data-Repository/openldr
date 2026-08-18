# CLI distribution and operator identity — design

Date: 2026-08-18
Status: design, awaiting approval

---

## The problem

The `openldr` CLI cannot be run on a production install.

`apps/server/Dockerfile:14` runs `pnpm --filter @openldr/server deploy`. That resolves the
server's dependencies only, and `@openldr/cli` is not one of them. Five images are released
(api, studio, web, keycloak, nginx). None carries the CLI. `install/install.sh` never invokes
`openldr` — it scaffolds compose and pulls images.

Nobody noticed because the server self-migrates at boot (`apps/server/src/index.ts:45-51`),
which covered the one command a fresh install actually needed.

Meanwhile `docs/OPERATOR-GUIDE.md:19` tells operators to run `pnpm openldr db migrate`. That
instruction cannot be followed on any Docker install. `AGENTS.md` §6 item 2 states that labs run
headless and the CLI is the operator surface. That surface is currently unreachable on every
headless lab.

### The second problem, which follows from fixing the first

The CLI has no authentication and no authorization.

- No `login`, `logout`, `whoami`, session, or token command exists.
- It makes zero HTTP calls. Every command builds `createAppContext(loadConfig())`
  (`packages/cli/src/program.ts:2-3`) and talks straight to Postgres and the adapters.
- `@openldr/rbac` is imported once, at `packages/cli/src/roles.ts:3`, only for `CAPABILITY_KEYS`
  as an input-validation catalog. Nothing gates the operator running the command.
- The audit actor is self-asserted. `packages/cli/src/cli-actor.ts:14-24` takes `--actor <name>`
  as free text, or falls back to the OS username.

So the API and the CLI are two doors into the same database and only one has a lock. The API
requires an OIDC token and a capability. The CLI requires the ability to run the binary with
`INTERNAL_DATABASE_URL` in the environment.

This is not automatically wrong. `psql`, `rails console`, and `manage.py` work the same way —
filesystem access is the credential. It becomes worth addressing only once the CLI is reachable,
which is what this design does.

### What this design is for

**Accountability, not prevention.** The audit log should name a real person, and an operator
should not be able to run a command their role does not cover. It is an honor system and the
documentation will say so in those words.

Prevention was considered and rejected for now. A real `openldr login` would need a break-glass
path for fresh installs and for recovery, and that path is available to anyone who can reach the
container. Anyone who can `docker compose exec api openldr` can equally
`docker compose exec postgres psql` and skip the CLI. Prevention only pays off alongside taking
shell access away, which is not planned.

---

## 1. Distribution

### The image

Add `@openldr/cli` to the deploy filter in `apps/server/Dockerfile:14`. The CLI's built
`dist/index.js` lands in the api image alongside the server's.

The added weight is small. Every workspace package the CLI depends on is already present:
`@openldr/fhir` and `@openldr/plugins` — the only two in the CLI's dependency list but not the
server's — are both direct dependencies of `@openldr/bootstrap`, which the server already has.
The genuine addition is `commander` plus the CLI's own compiled output.

### The built CLI has never been exercised

Found while planning, after this spec's first draft. It is a prerequisite for shipping the image,
not an optional improvement.

`packages/cli/tsup.config.ts` sets `noExternal: [/^@openldr\//]`, so the CLI bundle inlines every
workspace package — the same as the server's. But the server's config also carries
`external: ['ssh2', 'cpu-features', 'pdfkit', 'quickjs-emscripten']`
(`apps/server/tsup.config.ts:22`), with a comment explaining that each of those four resolves a
file from disk at runtime: native `.node` addons, pdfkit's `.afm` font metrics, and quickjs's
`emscripten-module.wasm`. Bundling any of them breaks that lookup **in the built image only**,
never from a source checkout.

**The CLI config has no `external` list.** It reaches all four through `@openldr/bootstrap`.

Nothing caught this because nothing runs the built CLI. `pnpm openldr` executes the TypeScript
source through tsx (`packages/cli/dev.mjs`), never `dist/`. The CLI's `build:check` runs
`node dist/index.js --help`, which loads none of those code paths.

So shipping the image without fixing this produces a CLI that prints `--help` correctly and then
fails the first time an operator runs a report or a workflow.

The fix mirrors the server exactly: the same `external` list in `packages/cli/tsup.config.ts`,
and the same four packages declared as direct dependencies in `packages/cli/package.json` so
`pnpm deploy` installs them. A test guards the two lists against drift and asserts the built
bundle does not inline pdfkit.

### Fixture paths follow the bundle, not the package

`@openldr/db` resolves its bundled terminology fixtures relative to its own module URL —
`packages/db/src/bundled-terminology.ts:14` computes `dirname(import.meta.url)/../fixtures/fhir`.
Because `noExternal` inlines `@openldr/db` into whichever bundle imports it, that path resolves
against the **bundle's** directory.

`apps/server/Dockerfile` already stages a copy at `/app/fixtures` for the server bundle at
`/app/dist`. The CLI bundle sits elsewhere, so it needs its own copy. Without it,
`openldr db seed` and the terminology commands come up with no terminology inside the container.

### The wrapper

`install/install.sh` writes an `openldr` script into the install directory:

```sh
#!/bin/sh
exec docker compose exec -T -u "$(id -u):$(id -g)" -w / api node <cli-path> "$@"
```

`<cli-path>` is the CLI's location inside the image. The exact path falls out of what
`pnpm deploy` produces once `@openldr/cli` is added to the filter, so it is fixed during
implementation and then hardcoded in the wrapper. It is not a runtime lookup.

`-w /` sets the container working directory to root, which section "File arguments" below depends
on. A `data/`-prefixed argument then resolves to `/data`, the bind mount — so the path the
operator types matches the path they see on the host.

`-w /data` was tried first and is wrong: it makes `data/x.json` resolve to `/data/data/x.json`.
A live acceptance run caught it. Reads failed with `ENOENT`, which is survivable, but writes were
worse — `artifact keygen --out data/keys` reported success at `data/keys` while actually writing
one level deeper, where the operator would not look. A read fails loudly; a write lied.

The wrapper also shipped once without `-u`. The runtime image runs as uid 10001
(`apps/server/Dockerfile:40`). A Linux bind mount passes the host directory's ownership straight
through, so `./data`, owned by the invoking host user, was unwritable by uid 10001. Reads still
worked — the container can read files it does not own — but every `--out` command failed. The
live acceptance run above missed it because it ran on Docker Desktop for Windows, which does not
enforce Unix file ownership on the bind mount. Fixed by adding `-u "$(id -u):$(id -g)"`, so the
container process runs as the invoking host user instead of the fixed image user.

That fix also changes the audit actor this document's identity section describes. `cliActor()`
(`packages/cli/src/cli-actor.ts:16`) reads the OS username **inside the container**. Before this
fix that was always the image's own `openldr` user. After it, the name follows whichever host uid
ran the wrapper — `node` for the common uid 1000, and the `cli` fallback for a uid with no
container passwd entry. Either way it is not the operator's real username; `--actor <name>` is
still how a real name gets recorded.

`install/install.ps1` writes `openldr.ps1` beside it, mirroring how the two installers already
pair.

The operator then runs `./openldr db migrate`.

### File arguments

`openldr ingest <file>`, `openldr sync export --out`, and `openldr artifact keygen --out` all
take host paths. Inside the container those paths do not exist. An `--out` path writes into a
container layer and is lost on restart.

The api service gets a bind mount, `./data:/data`. The wrapper sets the container working
directory to `/data`. An operator drops a file into `./data/` beside the wrapper and refers to
it as `data/bundle.json`.

Automatic host-path translation in the wrapper was considered and rejected. It would work for
paths under the install directory and fail silently for anything outside it. A documented rule
is better than a rule that holds most of the time.

---

## 2. Identity

`--actor` stops being free text.

Resolution order, in `packages/cli/src/cli-actor.ts`:

1. Read `--actor <name>`, or `OPENLDR_ACTOR` from the environment.
2. Look the name up with `ctx.users.getByUsername(name)` (`packages/users/src/store.ts:36`).
3. No match, or `status === 'disabled'` — refuse. Exit non-zero. Run nothing.
4. Match — the subject is `user.subject ?? user.id`, the same expression the API's auth plugin
   uses at `apps/server/src/auth-plugin.ts:132`.

`actorType` stays `'cli'`, so audit readers can still separate a CLI action from a browser one.
`actorId`, currently always `null` (`packages/cli/src/cli-actor.ts:23`), becomes the resolved
subject — which makes the existing `audit_events_actor_idx` index useful for CLI rows for the
first time.

Anyone can still pass any username. This fixes attribution, not access.

---

## 3. Capability gating

Each command declares the capability it requires. The CLI calls
`ctx.roles.resolveCapabilities(subject)` (`packages/db/src/role-store.ts:256`) and refuses when
the capability is absent. That is the identical function on the identical data that the API's
auth plugin uses at `apps/server/src/auth-plugin.ts:132`. There is no second source of truth.

### The map

`packages/cli/src/program.ts` has **160 `.command()` registrations**. The server has no central
route-to-capability table to copy — every route declares its own inline
`requireCapability('x.y')` (for example `apps/server/src/dashboards-routes.ts:14-18`). So the
map is new code, written by hand, one entry per command.

This is the bulk of the work and the most likely place to be wrong. Two mitigations:

- The map lives in **one file, as data**, not scattered through handlers. A reviewer reads it
  top to bottom against the studio's routes.
- A test asserts every registered command has an entry. A new command with no entry fails the
  build.

Unmapped commands **refuse**. Fail closed.

---

## 4. Bootstrap and break-glass

**No migration and no seed inserts into `users`.** The table is populated only by
`syncFromClaims` when someone first logs into the studio (`apps/server/src/auth-plugin.ts:121`).

So on a fresh install `users` is empty, every lookup in section 2 fails, and section 3 fails
closed. Without a rule for this, the CLI would refuse all 160 commands on exactly the install
where an operator most needs it — and `openldr user create`, the command that would fix it,
would be gated too.

Three rules:

**Offline commands are never gated.** `errors list`, `update check`, `fhir validate`, and the
`artifact` build commands never open a database. There are 89 `createAppContext` call sites
across the CLI source; the offline commands are the ones with none. A command with no context
has nothing to authorize against and nothing to protect. This falls out of the code rather than
being a carve-out.

The exact offline set is enumerated during implementation by checking which handlers build a
context, not assumed from the four named above.

**An empty `users` table means bootstrap mode.** With no rows, the CLI runs ungated and stamps
`actorName: 'bootstrap'`. Once the first user exists, gating switches on permanently. This is
the same shape as Keycloak's initial admin.

**Break-glass is an environment variable, and it is loud.** `OPENLDR_CLI_BREAK_GLASS=1` skips
the gate. Every command it allows writes an audit row marked unverified, and the CLI prints a
warning to stderr on every invocation.

It exists because a mistaken `roles revoke` can lock the last admin out of their own appliance,
and the recovery path should be a documented flag rather than hand-editing `user_roles` in psql.

It is not secure and the documentation will not claim it is. Anyone who can run the wrapper can
set it. It exists so that recovery leaves a trail, not so that it stops anyone.

---

## 5. The seam for a future login

One function, in one file:

```ts
resolveCliIdentity(ctx, opts): Promise<{ subject: string; capabilities: string[]; verified: boolean }>
```

Every gated command calls it and nothing else. Today it performs the username lookup and returns
`verified: false`. When a real `openldr login` is built, a token path returns the same shape with
`verified: true`, and none of the 160 command handlers change.

The `verified` flag is written into the audit row's existing `metadata` jsonb column
(`packages/audit/src/store.ts:15`). No migration is required.

This matters more than its size. Recording `verified: false` now means that when login ships,
historical rows are honestly labelled as honor-system. Added later, every pre-existing CLI row is
permanently ambiguous. It costs one field today and cannot be bought back.

---

## 6. Sequencing

**Slice 1 — distribution.** Image, wrapper, bind mount, docs. Useful on its own. It is what is
broken today.

**Slice 2 — identity and gating.** Sections 2 through 5. Shipped separately so the 160-entry map
is reviewed on its own merits rather than buried in a Dockerfile change.

---

## 7. The five surfaces

Against `AGENTS.md` §6:

1. **UI** — none. This work adds no studio surface.
2. **CLI parity** — this work is the CLI.
3. **Docs** — `docs/OPERATOR-GUIDE.md` currently instructs `pnpm openldr db migrate`, which is
   impossible on a Docker install. Every `pnpm openldr` becomes `./openldr`. In-app and web docs
   in en, fr, and pt.
4. **Mobile** — not applicable. No UI.
5. **Changelog** — `pnpm make:changelog` after merge to `main`.

---

## 8. Verification

What the tests will prove:

- Every registered command has a capability entry. This proves the map is **complete**. It does
  **not** prove any entry is **correct** — a command mapped to the wrong capability still passes.
  Correctness needs the by-eye review of the map file.
- Gate behaviour: unknown actor refuses, disabled user refuses, missing capability refuses, empty
  `users` table bootstraps, break-glass writes an unverified audit row.

What the tests will not prove:

- **HONEST NON-PROOF.** The wrapper script and the `./data` bind mount cannot be exercised in
  CI. `docker compose exec` needs a running stack. Both will be verified by hand on a real
  install. They will not be reported as green from a test run.

---

## 9. Out of scope

- A real `openldr login` and OIDC device-code flow. Section 5 leaves the seam; the flow is not
  built.
- Any change to how the API authenticates. This work reuses `resolveCapabilities` unchanged.
- A separate `openldr-cli` image. Rejected: it makes six images, and a new GHCR image defaults to
  private, where one private image aborts the whole pull. That is a release-day failure mode
  bought for a separation nobody asked for.
- A standalone binary. Rejected: real per-platform build work, and it still needs the database
  connection string that already lives inside the container.
