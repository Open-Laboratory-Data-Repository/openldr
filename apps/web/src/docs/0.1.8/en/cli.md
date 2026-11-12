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

### Choose your actual installation folder

Run the installed CLI on the computer hosting OpenLDR. For a remote host, use the SSH or remote terminal access you configured. Opening Studio over Tailscale does not open a terminal on that host.

For example, if you downloaded and installed OpenLDR in `~/Downloads/openldr_ce` on Linux or macOS:

```sh
cd ~/Downloads/openldr_ce
ls
./openldr --help
./openldr ingest --help
```

If you installed it in `C:\openldr_ce` on Windows, open PowerShell and run:

```powershell
cd C:\openldr_ce
Get-ChildItem -Name
.\openldr.ps1 --help
.\openldr.ps1 ingest --help
```

Replace the example folder with your actual installation folder. It contains `docker-compose.yml`, `data`, and the launcher. Enter one command at a time. The help commands do not change records. The in-app **Start here** guide illustrates each step.

### Run from a development checkout

Use the repository root, where `package.json`, `pnpm-workspace.yaml`, `apps` and `packages` are present. The same example paths apply to a source checkout. On Linux or macOS:

```sh
cd ~/Downloads/openldr_ce
pnpm openldr --help
pnpm openldr ingest --help
```

On Windows, use `cd C:\openldr_ce`, then the same `pnpm openldr` commands. Set up dependencies and `.env` first, as described in [Development](/docs/development).

The source CLI runs on the host and uses the databases and storage in `.env`. Those services must be running for an import. It does not require the Studio or API development server. It can read local files outside the installed launcher's shared `data` folder. For your own valid FHIR JSON file at `files/my-file.json`:

```sh
pnpm openldr fhir validate files/my-file.json
```

Validation does not import the file. When you intend to write it to your development database, check `.env`, then run:

```sh
pnpm openldr ingest files/my-file.json
pnpm openldr pipeline status
```

The Linux source check imported one Organization resource and reported a completed batch. Your batch ID and count depend on your file.

## Recover from an installed CLI error

These cases were reproduced on Linux with the installed launcher and real CLI in an isolated stack. Windows and macOS were not tested natively. Start in your installation folder and match the error first.

| Error | What recovered in the test |
| --- | --- |
| `./openldr: not found` or `no configuration file provided: not found` | Return to the actual installation folder, then run `./openldr --help`. Check that the launcher and Compose file are there. |
| `failed to connect to the docker API` with an incorrect `DOCKER_HOST` address | Run `docker info`. If the override is wrong, clear it with `unset DOCKER_HOST`, then retry `docker info` and CLI help. In PowerShell, clear it with `$env:DOCKER_HOST = $null`. This does not start a stopped Docker engine. |
| `service "api" is not running` | Inspect `docker compose ps -a api`, run `docker compose up -d api`, then retry CLI help. The check proved launcher recovery, not full HTTP application startup. |
| `ingest failed: ENOENT` when the file is beside the launcher | Move the file into the installation's `data` folder. Run `./openldr fhir validate data/my-file.json`, then import that same path when intended. The development CLI reads ordinary local paths instead. |

## Command groups

| Group | What it does |
| --- | --- |
| `health` | Report service health (auth, storage, eventing, target store). |
| `db` | `migrate`, `reset`, `seed` the database; `reproject` the warehouse read model. |
| `patients` | `list` and `show` patients (masked unless `--identifiers`, which is audited); `identifier-systems list` and `set` labels. |
| `settings` | Feature `flags list` / `flags set`, `danger <action>`, and `sync show` / `sync set` (lab⇄central sync config). |
| `terminology` | Import and query CodeSystems, ValueSets, ConceptMaps, ontologies. |
| `fhir` | Validate FHIR R4 resources. |
| `forms` | List form definitions; extract answers from a QuestionnaireResponse. |
| `ingest` | Ingest a file through the pipeline (optionally via a plugin). |
| `facilities` | Import a national facility register: `suggest-map`, `suggest-values`, `import` (column and value mapping — see **Facilities** in the studio's Docs). |
| `test-catalog` | The national test catalog: `list` the tests, `import` a list from CSV or Excel, `export` it as CSV, `enable` or `disable` one at this lab, and `retire` or `restore` one where this install owns the catalog. |
| `query` | Custom queries: `export` them to a JSON file, `import` them from one (`--force` replaces existing names). |
| `pipeline` | Inspect ingest batches: `status`, `retry`, `logs`. |
| `queue` | Inspect the event queue. |
| `provenance` | Provenance audit tooling. |
| `plugin` | Manage WASM ingest plugins: `install`, `list`, `test`, `run`, `remove`. |
| `report` | `list` and `run` analytics reports; `glass-export`. |
| `audit` | Read the append-only audit log. |
| `user` | Manage users: `list`, `show`, `create`, `set-role`, `activate`, `deactivate`. Status changes also update linked provider accounts. `export` is a top-level dataset command. |
| `market` | Marketplace artifacts: `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Author artifacts: `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Distributed (lab⇄central) sync: `status`, `now`, and central-side `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | List the error-code catalog. |
| `update` | `check` whether a newer OpenLDR version has been published (exit 0 = up to date, 1 = an update is available, 2 = the check failed). |
| `storage` | `copy` the objects of another S3 bucket into this install's storage. |
| `target-store` | Test the target warehouse connection. |

Mutating CLI commands (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`,
`settings … set`, `settings danger …`, `db reset`, `db reproject`, `terminology import/create`, `query import`) record an audit
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

`--lang` prints the translations stored on the design, including the dates. The built-in reports
ship with French and Portuguese, so this works on them with no setup. Text with no translation for
that language prints as authored, and data is never translated.

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

## Copy files between S3 stores

`openldr storage copy` copies every object from another S3 bucket into this install's storage. Use it to move off MinIO, as the [upgrading guide](/docs/upgrading) describes. It reads the source and never changes it. It skips a key that is already on the target with the same size, so you can run it again to resume. A same-size object with different content is not copied again. It prints object counts and bytes for both sides, then checks that every source object is on the target at the same size. It exits non-zero if any is missing. Extra objects on the target are expected while the api runs, because it keeps writing new files there. They do not fail the check. The CLI records the actor as `cli`.

| Flag | What it does |
| --- | --- |
| `--from-endpoint <url>` | Endpoint of the source store, for example `http://minio:9000`. |
| `--from-key <key>` | Access key of the source store. |
| `--from-secret <secret>` | Secret key of the source store. It shows in your shell history and the process list, so clear that history line afterwards. |
| `--from-bucket <bucket>` | Bucket to copy from. |
| `--from-region <region>` | Region of the source store. Default `us-east-1`. |
| `--json` | Print the report as JSON. |

## Projection retries

The projection worker saves failed resource writes and arrival-ledger writes for automatic retry.
Retries survive a restart and reread the current canonical resource, including deletions.
A cycle retries at most 100 queued resources, then handles new changes.
Repeated failures wait 1, 2, 4 seconds and so on, up to five minutes.
Retries continue until successful; a failing resource does not hold later valid changes.
A new change to that resource can trigger an attempt before the delay expires.
If saving a retry fails, the worker leaves its cursor unchanged.
Successful projection clears the retry. Ancillary capture-hook errors are logged without scheduling retries.
No operator action is required after a temporary outage clears.
For a deliberate full rebuild, use `openldr db reproject --force`.

## Disable or enable access

Open the account row's **Actions** menu to disable or enable it. Disabling writes the local access block before updating the identity provider. The next authenticated API request returns `403 account disabled`, including requests with an already-issued token. A screen already loaded in the browser may remain visible.

Accounts that have never signed in also receive a local block. Enabling updates the provider first, then lifts that block. If either write fails, the action reports an error. A failed disable can leave the provider enabled while OpenLDR blocks access. A failed enable can leave the provider enabled while the local block remains. Restore the failing connection and retry the same action. Audit records use `user.status.failed` for failures and `user.status` for success.

For the CLI, use `openldr user deactivate <local-id>` or `openldr user activate <local-id>`. Find the local ID with `openldr users list`. Linked accounts update both systems using their provider subject. Accounts created only in the local store change locally. CLI status audit records identify the actor as `cli`.

If another status change is in progress for this account, the API returns `409`. Wait for that action to finish, then retry. This also applies when Studio and the CLI change the same account.

## User directory paging

Users starts with active accounts. Search matches provider usernames, names, and email addresses across the directory. Select All statuses to include disabled accounts. Changing search, status, or page size returns to the first page.

Use Next to reach accounts beyond the first 100. Each request returns at most 100 accounts. The footer shows the visible range without claiming a total. Columns remain configurable. Arbitrary column filters and sorting are unavailable because the provider does not support them. The provider controls order. Accounts added or removed between requests can shift pages.

For headless access, run:

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

The JSON contains `rows`, `offset`, `limit`, `total: null`, and `hasMore`. Add `limit` to `offset` while `hasMore` is true. Omit `--enabled` to include both statuses. `openldr user list` still lists local accounts.

When provider administration is unconfigured, directory listing uses local accounts. Local search matches username, display name, and email as substrings. Local results use username and ID order. Provider search follows the identity provider's search rules.

## Test catalog

The test catalog is the national list of tests. It is a code system on the Terminology page, **Test catalog**. Its categories are a second code system, **Test categories**, with five to start: Chemistry, Haematology, Microbiology, Serology and Molecular. Edit categories on the Terminology page.

Central keeps the catalog. A lab receives it through terminology sync and cannot change its tests. Each lab records its own settings for a test: whether it runs it, a shorter specimen list, and a local name. Sync never sends those settings.

List the catalog from the command line:

```sh
openldr test-catalog list --search viral --category MOL --loinc linked --enabled on --json
```

Retired tests are hidden unless you pass `--status retired` or `--status all`. `--loinc none` lists tests with no LOINC code. `--limit` is 25 by default and 200 at most. Page with `--offset`. The JSON holds `rows`, `total` and `ownedHere`. `ownedHere` is false when this install received its catalog from central.

Switch a test on or off at this lab, or retire and restore it, by code:

```sh
openldr test-catalog enable HIVVL
openldr test-catalog retire HIVVL --json
```

`enable` and `disable` work on any install. `retire` and `restore` work only where this install owns the catalog. Retiring is reversible, so none of them takes `--force`. Each is recorded in the audit log as the CLI user.

Import a test list from a CSV or Excel (.xlsx) file:

```sh
openldr test-catalog import national-tests.xlsx
openldr test-catalog import national-tests.xlsx --value-map answers.json --apply
```

Without `--apply` nothing is written. The command prints the counts of new, changed, unchanged and refused rows, each refusal with its row number, and any category or specimen text that matched nothing. Columns are matched by their header. To name them yourself, pass `--column-map` with a JSON file such as `{"code": "Test code", "name": "Test name"}`. Answer unmatched text with `--value-map`:

```json
{
  "categories": [{ "text": "Virology", "kind": "new", "code": "VIRO", "display": "Virology" }],
  "specimens": [{ "text": "Plasma", "system": "urn:openldr:cs:local", "code": "BLD" }]
}
```

A category answer is `"kind": "existing"` with a `code`, or `"kind": "new"` with a `code` and a `display`. Only an install that owns the catalog can import. An apply is recorded in the audit log as the CLI user. Export the active tests as CSV, to standard output or to a file:

```sh
openldr test-catalog export --out catalog.csv
```

Map lab test codes to catalog tests. See **Mapping lab test codes** in the in-app Test catalog guide. The system is a URN, as shown in the System column of the Observed tab. For DISA data it is `urn:openldr:disa`:

```sh
openldr test-catalog map list --status unmapped --json
openldr test-catalog map set urn:openldr:disa POCVR HIVVL
openldr test-catalog map clear urn:openldr:disa POCVR --force
openldr test-catalog map export --out mappings.csv
openldr test-catalog map import mappings.csv
openldr test-catalog map import mappings.csv --apply --force
openldr test-catalog map rebuild --apply
```

- `map list` lists the lab test codes in the warehouse with their catalog mapping. `--status` takes `unmapped`, `mapped`, `ambiguous` or `all`. `--search`, `--limit` (1 to 200, 25 by default) and `--offset` narrow and page the list.
- `map set <system> <code> <catalog-code>` maps one code to a catalog test.
- `map clear <system> <code>` removes a mapping. It refuses without `--force`.
- `map export` writes every observed code and its mapping as CSV, in the layout `map import` reads. `--out` names a file. Without it the CSV goes to standard output.
- `map import <file>` shows what would change and writes nothing. `--apply --force` writes it. It refuses without both.
- `map rebuild` shows what the warehouse copy `test_map` would hold. `--apply` writes it.

Result codes use the same commands with `--level result`. The target is a result field code:

```sh
openldr test-catalog map list --level result --status unmapped
openldr test-catalog map set urn:openldr:disa HIVVC HIVVL --level result
openldr test-catalog map match urn:openldr:disa
openldr test-catalog map match urn:openldr:disa --apply --force
```

- `--level result` on `map list`, `set`, `clear`, `export` and `import` works on result codes. The result CSV has the columns `system, code, description, results, parameter_code, loinc`.
- `map match <system>` lists every unmapped result code of that lab system that equals a result field code. `--apply --force` maps them. It refuses `--apply` without `--force`.

Link result fields to LOINC:

```sh
openldr test-catalog result-fields list --loinc none
openldr test-catalog result-fields link HIVVL 20447-9
openldr test-catalog result-fields unlink HIVVL --force
openldr test-catalog result-fields export --out result-fields.csv
openldr test-catalog result-fields import result-fields.csv --apply --force
```

- `result-fields list` lists the fields with their role, units and LOINC link. `--loinc` takes `linked`, `none` or `all`, and `--role` takes `result`, `specimen`, `metadata` or `admin`.
- `result-fields unlink` refuses without `--force`. `result-fields import` previews unless `--apply --force` is given. A lab that receives its dictionary from central cannot change links.
- `openldr terminology import parameters <file>` rebuilds `test_map` after it loads the dictionary.

Each change is recorded in the audit log as the CLI user.

## Install a content pack

```sh
openldr market install <bundle-dir> --dry-run
openldr market install <bundle-dir>
```

`--dry-run` runs the checks and prints the steps. For each link-matching step it prints how many codes it would link. For each test-mappings or result-mappings step it lists the mappings it would map, keep and skip. It writes nothing. A content pack must be signed by a publisher. Installing a pack that is already installed needs `--force`. A pack whose last install failed installs again without it. `openldr market update` takes the same flags. It installs a newer version of an installed pack without `--force`. It refuses the same or an older version, and a pack that is not installed, unless you pass `--force`. `--json` prints machine-readable output. `openldr market list` shows packs with their status. The CLI records the actor as `cli`.
