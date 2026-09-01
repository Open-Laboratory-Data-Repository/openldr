# Command-line interface (CLI)

OpenLDR ships an operator command-line interface (CLI), `openldr`, for database,
terminology, ingest, plugin,
reporting, user, and marketplace tasks — everything you can do from the app, plus
lower-level operations.

## Running it

**On an installed stack**, the installer puts an `openldr` wrapper in your install directory.
Run it from there:

```
./openldr <command>
./openldr --help           # list every command group
./openldr db --help        # drill into a group
```

On Windows, use `.\openldr.ps1` instead.

The wrapper runs the CLI inside the `api` container. That has one consequence worth knowing:
**commands that read or write files only see the `data` directory.** Put a file in `./data`
next to the wrapper and name it with the `data/` prefix:

```
./openldr ingest data/bundle.json
./openldr sync export --out data/export.ndjson
```

A path outside `data/` will not be found. An `--out` path outside it now usually fails with a
permission error, rather than writing into the container and disappearing on restart.

The wrapper runs as the user who invokes it, so that user must be able to write to `./data`.
If the install ran under `sudo`, `./data` ends up owned by root, and a later non-root
`./openldr sync export --out data/x.ndjson` fails with `EACCES`. Fix it by changing the
directory's owner to the invoking user, or by running the wrapper as the user that owns it.

An operator without `docker` group access must run `sudo ./openldr`, which makes the container
process root. Root can write anywhere in the container, so an unprefixed `--out` then writes
silently and is lost on restart — the exact failure the `data/` rule exists to prevent. Always
prefix output paths with `data/`.

**From a source checkout**, run it through the workspace instead:

```
pnpm openldr <command>
```

Most read commands accept `--json` for machine-readable output. In a deployed stack the
common lifecycle steps (schema migration and seeding) run automatically on startup, and
admin/danger actions are also available in the Studio UI under Settings.

## Command groups

| Group | What it does |
| --- | --- |
| `health` | Report service health (auth, storage, eventing, target store). |
| `db` | `migrate`, `reset`, `seed` the database; `reproject` the warehouse read model. |
| `settings` | Feature `flags list` / `flags set`, `danger <action>`, and `sync show` / `sync set` (lab⇄central sync config). |
| `terminology` | Import and query CodeSystems, ValueSets, ConceptMaps, ontologies. |
| `fhir` | Validate FHIR R4 resources. |
| `forms` | List form definitions; extract answers from a QuestionnaireResponse. |
| `ingest` | Ingest a file through the pipeline (optionally via a plugin). |
| `facilities` | Import a national facility register: `suggest-map`, `suggest-values`, `import` (column and value mapping — see [Facilities](/docs/facilities)). |
| `pipeline` | Inspect ingest batches: `status`, `retry`, `logs`. |
| `queue` | Inspect the event queue. |
| `provenance` | Provenance audit tooling. |
| `plugin` | Manage WASM ingest plugins: `install`, `list`, `test`, `run`, `remove`. |
| `report` | `list` and `run` analytics reports; `glass-export`. |
| `audit` | Read the append-only audit log. |
| `user` | Manage local users: `list`, `show`, `create`, `set-role`, `activate`, `deactivate`. (`export` is a top-level command — a full dataset export — not a `user` subcommand.) |
| `market` | Marketplace artifacts: `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Author artifacts: `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Distributed (lab⇄central) sync: `status`, `now`, and central-side `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | List the error-code catalog. |
| `update` | `check` whether a newer OpenLDR version has been published (exit 0 = up to date, 1 = an update is available, 2 = the check failed). |
| `target-store` | Test the target warehouse connection. |

Mutating CLI commands (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`,
`settings … set`, `settings danger …`, `db reset`, `db reproject`, `terminology import/create`) record an audit
event with actor type **`cli`** and actor name looked up **inside the container**, not the
operator's own username. On a Docker install that name follows the host uid running the
wrapper: uid 1000 resolves to `node`, and most other uids have no container username at all,
so the fallback `cli` is recorded instead. Use the global `--actor <name>` to record the
operator's real name. They appear on the Audit page alongside UI actions.

## Common tasks

Bring a database up to date after pulling new migrations (non-destructive, keeps data):

```
./openldr db migrate
```

Reset and seed a development database (`db reset` **drops and recreates** the schema):

```
./openldr db reset
./openldr db seed
```

`db seed` refuses to run when migrations are pending, naming what is outstanding — run
`db migrate` first.

Rebuild the warehouse read model from the canonical FHIR store (`db reproject` **rewrites every
projected row**, so it refuses without `--force`):

```
./openldr db reproject --force
```

It prints two separate counts: the canonical resources it rewrote, and the arrivals it recorded in
the ingest ledger (one per version of a clinical resource — they are different units, not the same
number). Like `db seed`, it refuses when migrations are pending rather than running to completion
against a schema that is behind. Use it to backfill after an upgrade adds a warehouse table.

`terminology reproject` is **deprecated** — it has always called the same whole-read-model rebuild,
never a terminology-only one. It still works as an alias, it now prints a deprecation warning, and
it inherits the `--force` guard. Use `db reproject` instead.

Install and run an ingest plugin, then ingest a file with it:

```
./openldr plugin install data/plugin.wasm
./openldr ingest data/results.sqlite --plugin whonet-sqlite
```

Create a local user and assign roles:

```
./openldr user create --username alice --name "Alice" --email alice@example.org --role lab_technician
./openldr user set-role <id> lab_admin
```

Toggle a feature flag:

```
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

Run a report:

```
./openldr report list
./openldr report run <id>

# PDF in the design's own text, then in French
./openldr report run <id> --format pdf --out report.pdf
./openldr report run <id> --format pdf --lang fr --out rapport.pdf
```

`--lang` prints the translations stored on the design. Text with no translation for that language
prints as authored, and data is never translated.

Enroll a lab on the central server, then connect a lab to it:

```
# On central: mint the lab's client + secret (printed once)
./openldr sync enroll lab-site-01 --central-url https://central.example.org

# On the lab: apply the credentials, then check status
./openldr settings sync set clientId sync-lab-site-01
./openldr settings sync set mode bidirectional
./openldr settings sync set enabled true
./openldr sync status
```

> Distributed sync links labs to a central server: operational data pushes up to a
> read-only mirror, reference config and terminology pull down. Enrollment mints a
> per-lab Keycloak client and needs the central realm's admin service account to hold
> `manage-clients`/`view-clients`.

> Anything under `settings danger` is destructive (reset dashboards, clear audit,
> factory reset). Those commands require `--force` and mirror the Studio danger zone.
