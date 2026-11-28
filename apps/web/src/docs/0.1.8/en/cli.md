# Command-line interface (CLI)

<!-- operator-platform -->

Run maintenance on the OpenLDR host, from your installed Compose folder. The examples use `~/Downloads/openldr_ce` on Linux/macOS and `C:\openldr_ce` in PowerShell. Replace these paths with your installation. The blue prompt is already shown by the terminal. Type the command only. File illustrations show text to edit in the named file. Pictures are examples, not proof that maintenance succeeded. Sample data is optional.

## Use the installed launcher

Run on the computer hosting OpenLDR. A browser over Tailscale is not a terminal on that computer. For a remote host, use your configured remote terminal or SSH.

### 1. Find the real installation folder

Replace the example path. Look for docker-compose.yml, data, and openldr or openldr.ps1. Do not assume a global openldr executable exists.

```sh
{{operator:cli-find}}
```

![Find the real installation folder.](guide:operator-cli-find)

### 2. Read launcher help

Help lists commands without changing records. The launcher executes inside the api container, so that service and Docker must be available.

```sh
{{operator:cli-help}}
```

![Read launcher help.](guide:operator-cli-help)

### 3. Read the selected command’s options

Use --help at each command level. Most read commands support --json. Mutating examples below are alternatives, not a script to run in sequence. Most commands go through the running server, so sign in first with ./openldr login or an access key. On Windows, .\openldr.ps1 signs in with an access key only, so set OPENLDR_KEY. That was not run on Windows. See [CLI sign-in and access keys](/docs/cli-access).

```sh
{{operator:cli-group-help}}
```

![Read the selected command’s options.](guide:operator-cli-group-help)

## Pass a file to the installed CLI

File arguments inside the api container must use the shared data directory. Keep both inputs and outputs under data/. A host path outside it is not the same path inside the container.

### 1. Copy your approved file into data

Replace the source path and filename with your actual file. The account invoking the launcher must be able to write this folder. An installation created with sudo may leave it owned by root; use the intended owner or correct ownership deliberately, not blanket permissions.

```sh
{{operator:cli-file}}
```

![Copy your approved file into data.](guide:operator-cli-file)

### 2. Validate without importing

Validation reads this file; it does not import it. Resolve errors before proceeding. Do not include real patient identifiers in shared screenshots.

```sh
{{operator:cli-validate}}
```

![Validate without importing.](guide:operator-cli-validate)

### 3. Import only when ready to write

This writes to the installation’s configured database. Read the batch outcome and use pipeline status/logs as described in Load & push data. Always use data/ for --out paths too, even when running as root; root can otherwise write files that disappear with the container.

```sh
{{operator:cli-import}}
```

![Import only when ready to write.](guide:operator-cli-import)

## Use the development launcher

Use a source checkout with dependencies and .env already configured. It is not the installed Compose folder. See Development first.

### 1. Run workspace help from the repository root

The root contains package.json, pnpm-workspace.yaml, apps and packages. Recovery commands such as db migrate and health use the services configured in .env. Every other command goes to the API at OPENLDR_URL, by default http://127.0.0.1:3000, so start the API first. With AUTH_DEV_BYPASS=true the API signs these commands in for you.

```sh
{{operator:cli-dev-help}}
```

![Run workspace help from the repository root.](guide:operator-cli-dev-help)

### 2. Use an ordinary host file path

Replace files/your-file.json with your actual host path. Development is not restricted to the installed data share. Keep sample loading optional.

```sh
{{operator:cli-dev-validate}}
```

![Use an ordinary host file path.](guide:operator-cli-dev-validate)

## Recover from an installed CLI error

These cases were reproduced on Linux with the installed launcher and real CLI in an isolated stack. Windows and macOS were not tested natively. Start in your installation folder and match the error first.

| Error | What recovered in the test |
| --- | --- |
| `./openldr: not found` or `no configuration file provided: not found` | Return to the actual installation folder, then run `./openldr --help`. Check that the launcher and Compose file are there. |
| `failed to connect to the docker API` with an incorrect `DOCKER_HOST` address | Run `docker info`. If the override is wrong, clear it with `unset DOCKER_HOST`, then retry `docker info` and CLI help. In PowerShell, clear it with `$env:DOCKER_HOST = $null`. This does not start a stopped Docker engine. |
| `service "api" is not running` | Inspect `docker compose ps -a api`, run `docker compose up -d api`, then retry CLI help. The check proved launcher recovery, not full HTTP application startup. |
| `ingest failed: ENOENT`, or `Cannot find <file>.` since commands go through the app, when the file is beside the launcher | Move the file into the installation's `data` folder. Run `./openldr fhir validate data/my-file.json`, then import that same path when intended. The development CLI reads ordinary local paths instead. |
| `workflows` | Inspect durable webhook receipts |
| `connectors` | List, inspect, test and diagnose host connectors |
| `import` | Allow sources and manage database-plugin imports |
| `doctor` | Read the same readiness checks as Setup checks |
| `auth` | Inspect and deliberately rebind a moved issuer |
| `roles` | Manage capability roles |
| `data-exposure` | Read or change analytics column exposure |
| `layouts` | Manage sidebar and start-page layouts |
| `report-design` | Manage report page designs |
| `report-def` | Manage saved report definitions |
| `export` | Export canonical data, tables and a manifest |


## Command groups

| Group | What it does |
| --- | --- |
| `health` | Report service health (auth, storage, eventing, target store). |
| `db` | `migrate`, `reset`, `seed` the database; `reproject` the warehouse read model. |
| `patients` | `list` and `show` patients (masked unless `--identifiers`, which is audited); `identifier-systems list` and `set` labels. |
| `settings` | Feature `flags list` / `flags set`, `danger <action>`, `sync show` / `sync set` (lab⇄central sync config), and `lab show` / `lab set` for the laboratory's identity, with its country (`--country`). |
| `terminology` | Import and query CodeSystems, ValueSets, ConceptMaps, ontologies. |
| `fhir` | Validate FHIR R4 resources. |
| `dashboards` | Show or set which roles may see a dashboard and its data. |
| `forms` | List form definitions; extract answers from a QuestionnaireResponse; set which roles may open and submit a form. |
| `ingest` | Ingest a file through the pipeline (optionally via a plugin). |
| `facilities` | Import a national facility register: `suggest-map`, `suggest-values`, `import` (column and value mapping — see **Facilities** in the studio's Docs). |
| `test-catalog` | The national test catalog: `list` the tests, `import` a list from CSV or Excel, `export` it as CSV, `enable` or `disable` one at this lab, and `retire` or `restore` one where this install owns the catalog, `set` a test's Test code (`--test-code`), turnaround times, review and additional codings (`--codings`), `params` to read or replace its result parameters, `loinc-hints` for a LOINC code, and `result-fields` to link, add or make result fields from LOINC. |
| `lab` | `requisitions rebuild --force` rebuilds the index that finds an order by its requisition number. Needs **Danger zone**. |
| `query` | Custom queries: `export` them to a JSON file, `import` them from one (`--force` replaces existing names and needs **Manage saved queries**; without it, an import adds new queries with no group). |
| `pipeline` | Inspect ingest batches: `status`, `retry`, `logs`. |
| `queue` | Inspect the event queue. |
| `provenance` | Provenance audit tooling. |
| `plugin` | Manage WASM ingest plugins: `install`, `list`, `test`, `run`, `remove`, `call`. |
| `report` | `list` and `run` analytics reports; `glass-export`. |
| `audit` | Read the append-only audit log. |
| `user` | Manage users: `list`, `show`, `create`, `set-role`, `activate`, `deactivate`. Status changes also update linked provider accounts. `export` is a top-level dataset command. |
| `users` | List users; show or set a user's data limit (`scope`). |
| `market` | Marketplace artifacts: `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Author artifacts: `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Distributed (lab⇄central) sync: `status`, `now`, and central-side `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | List the error-code catalog. |
| `update` | `check` whether a newer OpenLDR version has been published (exit 0 = up to date, 1 = an update is available, 2 = the check failed). |
| `storage` | `copy` the objects of another S3 bucket into this install's storage. |
| `target-store` | Test the target warehouse connection. |

Mutating CLI commands (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`,
`settings … set`, `settings danger …`, `db reset`, `db reproject`, `terminology import/create`, `query import`) record an audit
event. A command that goes through the app records the account that signed in, and `--actor` is
refused there. A recovery command, such as `db reset`, records actor type **`cli`** with the
operator's name on that machine, or the global `--actor <name>`. On a Docker install that name is
looked up inside the container, so it is often `node` or `cli`. They appear on the Audit page
alongside UI actions. [CLI sign-in and access keys](/docs/cli-access) lists the kind of each command.

## Common tasks

Bring a database up to date after pulling new migrations (non-destructive, keeps data):

### 1. Apply pending database migrations

```
{{operator:cli-en-1}}
```

![Apply pending database migrations.](guide:operator-cli-en-1)

Reset and seed a development database (`db reset` **drops and recreates** the schema):

### 2. Reset only an intended disposable database

```
{{operator:cli-en-2}}
```

![Reset only an intended disposable database.](guide:operator-cli-en-2)

`db seed` refuses to run when migrations are pending, naming what is outstanding — run
`db migrate` first.

Rebuild the warehouse read model from the canonical FHIR store (`db reproject` **rewrites every
projected row**, so it refuses without `--force`):

### 3. Rebuild the warehouse only when required

```
{{operator:cli-en-3}}
```

![Rebuild the warehouse only when required.](guide:operator-cli-en-3)

It prints two separate counts: the canonical resources it rewrote, and the arrivals it recorded in
the ingest ledger (one per version of a clinical resource — they are different units, not the same
number). Like `db seed`, it refuses when migrations are pending rather than running to completion
against a schema that is behind. Use it to backfill after an upgrade adds a warehouse table.

The old `terminology reproject` command has been removed. It ran the same full rebuild. Use
`db reproject --force` instead.

Install and run an ingest plugin, then ingest a file with it:

### 4. Install an approved converter and ingest your file

```
{{operator:cli-en-4}}
```

![Install an approved converter and ingest your file.](guide:operator-cli-en-4)

Create a local user and assign roles:

### 5. Choose the intended user operation

```
{{operator:cli-en-5}}
```

![Choose the intended user operation.](guide:operator-cli-en-5)

Toggle a feature flag:

### 6. Read or change a selected feature flag

```
{{operator:cli-en-6}}
```

![Read or change a selected feature flag.](guide:operator-cli-en-6)

Run a report:

### 7. Run a report or export into the shared folder

```
{{operator:cli-en-7}}
```

![Run a report or export into the shared folder.](guide:operator-cli-en-7)

For a report with a Date range filter, pass both dates with `--param from=2026-01-01 --param to=2026-11-12`. The reporting service binds these values to the saved query's declared date range. Choose dates for your own report.

`--lang` prints the translations stored on the design, including the dates. The built-in reports
ship with French and Portuguese, so this works on them with no setup. Text with no translation for
that language prints as authored, and data is never translated.

Enroll a lab on the central server, then connect a lab to it:

### 8. Configure the intended sync peer

```
{{operator:cli-en-8}}
```

![Configure the intended sync peer.](guide:operator-cli-en-8)

> Distributed sync links labs to a central server: operational data pushes up to a
> read-only mirror, reference config and terminology pull down. Enrollment mints a
> per-lab Keycloak client and needs the central realm's admin service account to hold
> `manage-clients`/`view-clients`.

> Anything under `settings danger` is destructive (reset dashboards, clear audit,
> factory reset). Those commands require `--force` and mirror the Studio danger zone.

## Turn a workflow on or off

`openldr workflows enable <workflow-id>` and `openldr workflows disable <workflow-id>` do what **Enable** and **Disable** do in the Studio's workflow list. Only that changes: the workflow's steps, name and description stay as they are. Enabling is refused when another enabled workflow uses the same webhook path, and the message names that workflow. A webhook and a schedule follow the change at once. Restart the server for listeners, ingest and event triggers to follow. Run locally, the CLI records the actor as `cli`. Signed in, it records your account.

```
openldr workflows disable wf_example
openldr workflows enable wf_example
```

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

For the CLI, use `openldr user deactivate <local-id>` or `openldr user activate <local-id>`. Find the local ID with `openldr users list`. Linked accounts update both systems using their provider subject. Accounts created only in the local store change locally. The audit records name the signed-in account.

If another status change is in progress for this account, the API returns `409`. Wait for that action to finish, then retry. This also applies when Studio and the CLI change the same account.

## Local sign-in accounts

These commands are for an install with `AUTH_ADAPTER=local`. See [Authentication providers](/docs/auth-providers). The usage lines below are copied from each command's `--help`:

```text
Usage: openldr auth setup-code [options]
Usage: openldr user create [options]
Usage: openldr user assign-role [options] <subject> <slug>
Usage: openldr user reset-password [options] <username>
Usage: openldr user end-sessions [options] <username>
```

- `openldr auth setup-code` prints a one-time code for creating the first administrator in Studio. It is valid for 30 minutes, and a new code replaces the earlier one. Once an administrator exists, it refuses with `an administrator already exists`. The code is never written to the audit log.
- `openldr user create --username <u>` makes an account that can sign in. It prints the new user's ID and a temporary password, once. The person must change that password at first sign-in. `--role` takes a role slug such as `lab_technician`. A role that does not exist makes the command refuse with `no role named <slug>`, and nothing is created. It goes through the app, so sign in first as an account with `users.manage`. Create the first administrator in Studio with a setup code. `--no-password` makes an account that cannot sign in, for an access key.
- `openldr user assign-role <subject> <slug>` adds a role. Under local sign-in the subject is the user ID that `user create` prints. Given a username, the command reports success and grants nothing.
- `openldr user reset-password <username> --force` sets a new temporary password, prints it once, and ends the user's sessions. The user must choose a new password at the next sign-in. Without `--force` it refuses and changes nothing. This is how a forgotten administrator password is recovered.
- `openldr user end-sessions <username>` signs the user out everywhere. The password does not change.

`reset-password` and `end-sessions` match the username exactly, including capital letters. Under Keycloak or OIDC they refuse with `local sign-in is not enabled`. `reset-password` writes an audit event with actor type `cli`. `user create` and `end-sessions` go through the app, and their audit events name the signed-in account. A temporary password never appears in the audit log.

```
./openldr user create --username amina --name "Amina Hassan" --role lab_technician
./openldr user reset-password amina --force
./openldr user end-sessions amina
```

`user create` prints three lines: `created amina (<id>)`, `temporary password: <password>`, and `amina must change it at first sign-in.` Give the password to the person directly.

## User directory paging

Users starts with active accounts. Search matches provider usernames, names, and email addresses across the directory. Select All statuses to include disabled accounts. Changing search, status, or page size returns to the first page.

Use Next to reach accounts beyond the first 100. Each request returns at most 100 accounts. The footer shows the visible range without claiming a total. Columns remain configurable. Arbitrary column filters and sorting are unavailable because the provider does not support them. The provider controls order. Accounts added or removed between requests can shift pages.

For headless access, run:

### 9. Choose the intended user operation

```sh
{{operator:cli-en-9}}
```

![Choose the intended user operation.](guide:operator-cli-en-9)

The JSON contains `rows`, `offset`, `limit`, `total: null`, and `hasMore`. Add `limit` to `offset` while `hasMore` is true. Omit `--enabled` to include both statuses. `openldr user list` still lists local accounts.

When provider administration is unconfigured, directory listing uses local accounts. Local search matches username, display name, and email as substrings. Local results use username and ID order. Provider search follows the identity provider's search rules.

## Test catalog

The test catalog is the national list of tests. It is a code system on the Terminology page, **Test catalog**. Its categories are a second code system, **Test categories**, with five to start: Chemistry, Haematology, Microbiology, Serology and Molecular. Edit categories on the Terminology page.

Central keeps the catalog. A lab receives it through terminology sync and cannot change its tests. Each lab records its own settings for a test: whether it runs it, a shorter specimen list, and a local name. Sync never sends those settings.

List the catalog from the command line:

### 10. Use the catalog command for your own codes

```sh
{{operator:cli-en-10}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-10)

Retired tests are hidden unless you pass `--status retired` or `--status all`. `--loinc none` lists tests with no LOINC code. `--limit` is 25 by default and 200 at most. Page with `--offset`. The JSON holds `rows`, `total` and `ownedHere`. `ownedHere` is false when this install received its catalog from central.

Switch a test on or off at this lab, or retire and restore it, by code:

### 11. Use the catalog command for your own codes

```sh
{{operator:cli-en-11}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-11)

`enable` and `disable` work on any install. `retire` and `restore` work only where this install owns the catalog. Retiring is reversible, so none of them takes `--force`. Each is recorded in the audit log as the signed-in account.

Import a test list from a CSV or Excel (.xlsx) file:

### 12. Use the catalog command for your own codes

```sh
{{operator:cli-en-12}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-12)

Without `--apply` nothing is written. The command prints the counts of new, changed, unchanged and refused rows, each refusal with its row number, and any category or specimen text that matched nothing. Columns are matched by their header. To name them yourself, pass `--column-map` with a JSON file such as `{"code": "Test code", "name": "Test name"}`. Answer unmatched text with `--value-map`:

### 13. Save the mapping in the named JSON file

```json
{{operator:cli-en-13}}
```

![Save the mapping in the named JSON file.](guide:operator-cli-en-13)

A category answer is `"kind": "existing"` with a `code`, or `"kind": "new"` with a `code` and a `display`. Only an install that owns the catalog can import. An apply is recorded in the audit log as the signed-in account. Export the active tests as CSV, to standard output or to a file:

### 14. Use the catalog command for your own codes

```sh
{{operator:cli-en-14}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-14)

The `id` column holds each test's internal id, which never changes. The `code` column holds its Test code, which can. An import matches a row on `id` when the file has one, else on the Test code. An earlier Test code stays reserved for its test.

Map lab test codes to catalog tests. See **Mapping lab test codes** in the in-app Test catalog guide. The system is a URN, as shown in the System column of the Observed tab. For DISA data it is `urn:openldr:disa`:

### 15. Use the catalog command for your own codes

```sh
{{operator:cli-en-15}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-15)

- `map list` lists the lab test codes in the warehouse with their catalog mapping. A catalog test shows by its Test code. `--status` takes `unmapped`, `mapped`, `ambiguous` or `all`. `--search`, `--limit` (1 to 200, 25 by default) and `--offset` narrow and page the list.
- `map set <system> <code> <catalog-code>` maps one code to a catalog test.
- `map clear <system> <code>` removes a mapping. It refuses without `--force`.
- `map export` writes every observed code and its mapping as CSV, in the layout `map import` reads. `--out` names a file. Without it the CSV goes to standard output.
- `map import <file>` shows what would change and writes nothing. `--apply --force` writes it. It refuses without both.
- `map rebuild` shows what the warehouse copy `test_map` would hold. `--apply` writes it.

Result codes use the same commands with `--level result`. The target is a result field code:

### 16. Use the catalog command for your own codes

```sh
{{operator:cli-en-16}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-16)

- `--level result` on `map list`, `set`, `clear`, `export` and `import` works on result codes. The result CSV has the columns `system, code, description, results, parameter_code, loinc`.
- `map match <system>` lists every unmapped result code of that lab system that equals a result field code. `--apply --force` maps them. It refuses `--apply` without `--force`.

Link result fields to LOINC:

### 17. Use the catalog command for your own codes

```sh
{{operator:cli-en-17}}
```

![Use the catalog command for your own codes.](guide:operator-cli-en-17)

- `result-fields list` lists the fields with their role, units and LOINC link. `--loinc` takes `linked`, `none` or `all`, and `--role` takes `result`, `specimen`, `metadata` or `admin`.
- `result-fields unlink` refuses without `--force`. `result-fields import` previews unless `--apply --force` is given. A lab that receives its dictionary from central cannot change links.
- `openldr terminology import resource <file>` loads a FHIR CodeSystem. When its `url` is `urn:openldr:default_result`, it is the result dictionary: each concept carries a `result_role` property, and may carry `parm_units`. The command then rebuilds `test_map`.

Each change is recorded in the audit log as the signed-in account.

Set a test's turnaround times and review:

### 18. Set turnaround and review for one test

```sh
{{operator:cli-en-19}}
```

![Set turnaround and review for one test.](guide:operator-cli-en-19)

- `--expected-tat` is the hours from receipt to release that the lab aims for. `--critical-tat` is the hours after which the test is overdue. Each takes a number above 0, or `none` to clear it.
- `--requires-verification` takes `true` or `false`. A test without it set reads `true`.
- `set` changes only the flags you give. It works only where this install owns the catalog. CE stores these values. The lab plugin does not use them yet.
- `export` and `import` carry the same values in the columns `expected_tat_hours`, `critical_tat_hours` and `requires_verification`. Verification is written `yes` or `no`. An import reads yes, no, true or false.
- `--codings <file.json>` replaces the test's additional codings with the JSON list in the file. Each entry has a `system`, a `code`, a `purpose` and an optional `note`. The purpose is `ADDITIONAL`, `INDICATION`, `PROCEDURE` or `CATEGORY`, and `ADDITIONAL` when left out. The system must be loaded on this install and hold the code. `[]` clears them. `export` and `import` carry them in the `codings` column, as the same JSON list.

LOINC hints and result fields from LOINC need LOINC loaded, with its ontology built. Load it from a folder that holds the unzipped LOINC release:

### 19. Load LOINC and build its ontology

```sh
{{operator:cli-en-20}}
```

![Load LOINC and build its ontology.](guide:operator-cli-en-20)

An install that loaded LOINC before LOINC hints were added must import it again. Until then, the hints suggest no unit.

Read the hints for a LOINC code, and make result fields from LOINC:

### 20. Read LOINC hints and make result fields

```sh
{{operator:cli-en-21}}
```

![Read LOINC hints and make result fields.](guide:operator-cli-en-21)

- `loinc-hints <code>` prints LOINC's name, its short name and component, the class and the category it matches, the result type and unit, the specimens, the answers and, for a panel, its member tests. `--json` prints the same as JSON. Without LOINC and its ontology, it says there are no hints. An install that loaded LOINC before short names were added prints no short name until it runs `terminology import loinc` again.
- `result-fields from-loinc <code...>` makes a result field for each code. With `--panel`, it makes one for each member test of each panel. A field or answer set that is already there is reused, so running it again makes nothing new.
- `result-fields add --display <text>` adds one field to the result dictionary. `--code` sets its code. Without it, the code is made from the name, such as `HAEMOGLOBIN_A1C`. `--unit` sets its UCUM unit. A code that is already there is refused.
- Neither command ticks the field on a test. Tick it in the test sheet, or with `test-catalog params --set`. A lab that receives its dictionary from central cannot add fields.

`test-catalog params <code>` prints a test's result parameters with their type, whether each is required, and their settings. `--set <file>` replaces them from a JSON list. Each entry may carry:

- `resultType`: `numeric`, `coded`, `text`, `boolean` (yes/no), `date` or `multicoded` (several answers). `coded` and `multicoded` need a `valueSetUrl`.
- `required`: `false` for a field that may stay empty. Left out, the field is required.
- Entry limits for the type: `min`, `max` and `decimals` for `numeric`, `minLength` and `maxLength` for `text`, and `dateLimit` (`any`, `past` or `future`) for `date`. Limits of another type are refused.
- On each band in `bands`: `pregnancy` (`pregnant` or `not-pregnant`), `country` (an alpha-3 code from the country list, such as `TZA`), `validFrom` and `validTo` (`YYYY-MM-DD`), `source` (`WHO`, `CLSI`, `EUCAST`, `national` or `facility`) and `scope` (`global`, `national` or `facility`).

A band with a country fits only when the lab's country matches. Set it with `openldr settings lab set --country TZA`, using your own code. An empty string clears it.

## Install a content pack

### 21. Preview an approved content pack before installing

```sh
{{operator:cli-en-18}}
```

![Preview an approved content pack before installing.](guide:operator-cli-en-18)

`--dry-run` runs the checks and prints the steps. For each link-matching step it prints how many codes it would link. For each test-mappings or result-mappings step it lists the mappings it would map, keep and skip. It writes nothing. A content pack must be signed by a publisher. Installing a pack that is already installed needs `--force`. A pack whose last install failed installs again without it. `openldr market update` takes the same flags. It installs a newer version of an installed pack without `--force`. It refuses the same or an older version, and a pack that is not installed, unless you pass `--force`. `--json` prints machine-readable output. `openldr market list` shows packs with their status. The audit log names the signed-in account.

## Personal preferences

Studio's **Your preferences** guide is under **Personal settings**. It shows language, theme, start page and sidebar choices, with a screenshot for each step. Preferences save to each user's account. A personal start page takes priority over a layout's start page; Dashboard is the fallback.

For operators, `user preferences show <user-id>` reads the saved values and `user preferences set <user-id> startPage none` clears the personal start-page choice. Use the installed or development command form described above. Clearing the choice lets the layout's start page apply again when one is configured.

## How far a copy has got

`openldr import copy status <plugin> [copy]` prints one line per copy. While a copy is not finished, the line gives how many of the source's keys it has read, as a percentage, such as `45.2% of 2342719 keys`. While it runs, it adds the time left, such as `about 31 min left`. Each set shows `total=` beside its own counts. `--json` gives the same numbers in `estimate`: `done`, `total`, `percent` and `secondsLeft`.

CE counts each set's keys on the source when a copy starts or carries on. The time left is the keys still to read at the average speed since then. It is a guess. It is shown only after a minute of reading. It changes when the source gets busier, when older and newer requests carry different numbers of rows, and after a restart, which starts the average again. When the source could not count a set in 30 seconds, the line gives no percentage and the copy carries on.

## Interrupted jobs

A long job cut off by a restart records it. Most carry on by themselves; these commands show the record and continue a job that waits.

- `openldr terminology job <system>` shows the latest distribution import and its interruptions. `openldr terminology job-continue <id>` continues one that waits after three cuts.
- `openldr workflows receipts list <workflowId>` shows each run's interruptions. `openldr workflows run-continue <workflowId> <requestId>` starts a new run from an interrupted one; a workflow run never restarts by itself.
- `openldr facilities jobs --retry <id>` continues an interrupted facility map rebuild.
- `openldr facilities import-run-continue <runId>` continues a waiting register import from its saved file. Add `--json` for JSON output. A previously confirmed apply runs again without another confirmation. A file check stops at the usual confirmation.
- `openldr import status`, `import copy status`, `import check status`, `facilities import-run <id>` and `pipeline status` list the interruptions of each run.

## Correcting held requests

A source check holds a request back when its rules find an error. Someone with the **Correct held requests** permission can correct the request's fields and check it again. The source rows stay as they are; the correction is kept beside them with who, when and why.

- `openldr import check correct <plugin> <copy> <key> --set field=value --reason "why"` corrects one or more fields. Repeat `--set` for each field. An empty value clears the field. The plugin decides which fields can be corrected.
- `openldr import check choices <plugin> <copy> [--field specimen]` lists the values a field may be corrected to, such as the source's specimen codes. Use a code from it in `--set`.
- `openldr import check recheck <plugin> <copy> <key>` checks the request again in the run that held it. If it now passes it is saved and leaves the held list. Run `import check held` to see the result.
- `openldr import check codes <plugin> <copy>` lists the finding codes of the held requests, each with how many requests carry it. `openldr import check held <plugin> <copy> --finding <code>` lists only the requests with one of them.

## Who may open and submit a form

`openldr forms access <form-id>` shows which roles may open and submit a form. It is the CLI side of the form builder's **Access** sheet. A list left empty means every role with the permission. To submit, a person must also be able to open the form. A role manager always opens every form. You need the `forms.edit` permission.

| Flag | What it does |
| --- | --- |
| `--open <roles>` | Roles that may open the form, as slugs or ids, comma separated. Replaces the open list. |
| `--submit <roles>` | Roles that may submit the form, as slugs or ids, comma separated. Replaces the submit list. |
| `--clear` | Empty both lists, so every role with the permission may open and submit again. |
| `--json` | Print the lists as JSON, as role ids. |

A list you do not name stays as it is. An unknown role or form is refused and nothing changes. Each change is audited as `form.access.set`. Run locally, the CLI records the actor as `cli`.

```
openldr forms access form-sample-order
openldr forms access form-sample-order --open lab_technician,lab_manager --submit lab_manager
openldr forms access form-sample-order --clear
```

## Who may see a dashboard

`openldr dashboards share <dashboard-id>` shows which roles may see a dashboard and its data. It is the CLI side of the dashboard's **Share** sheet. A list left empty means every role with the permission. The owner and admins always see it.

| Flag | What it does |
| --- | --- |
| `--roles <roles>` | Roles that may see it, as slugs or ids, comma separated. Replaces the list. |
| `--clear` | Empty the list, so every role with the permission may see it again. |
| `--json` | Print the list as JSON, as role ids. |

Signed in, you see only dashboards you may see, and only the owner or an admin may change the list. Run locally on the server, the CLI acts as an admin and records the actor as `cli`. An unknown role or dashboard is refused and nothing changes. Each change is audited as `dashboard.share.set`.

A person who can only view dashboards sees data only through the dashboards shared with them. Their widgets run as saved. Writing a query of their own needs `dashboards.edit`.

```
openldr dashboards share default
openldr dashboards share default --roles lab_manager,data_analyst
openldr dashboards share default --clear
```

## A user's data limit

`openldr users scope <subject>` shows a user's data limit. It is the CLI side of the **Data** row in the Users sheet. The subject is the user's sign-in subject, or the user id for an account that has none. With a limit, dashboards count only requests sent from the listed places, or tested at them.

| Flag | What it does |
| --- | --- |
| `--facility <ids>` | Register facility ids, comma separated. |
| `--district <pairs>` | Districts as `Region/District`, comma separated, because district names repeat across regions. |
| `--region <regions>` | Regions, comma separated. |
| `--none` | Limited with nothing listed, so the user sees no dashboard numbers. Needs `--force`. |
| `--force` | Needed to set a limit, because it takes permissions away. |
| `--all` | Remove the limit, so the user sees everything. |
| `--json` | Print the limit as JSON. |

It needs `roles.manage`. One limit lists at most 300 places. Every place must be in the facility register, or the command is refused and nothing changes. Run locally on the server, the actor is recorded as `cli`. Each change is audited as `user.data_scope.set`.

A limited user loses reports, patients, queries, exports, workflows, connectors, audit, activity, held corrections, the facility register and sync, and cannot create or edit dashboards. They never run SQL widgets. They keep forms, including patient search inside a form, which the limit does not cover. A new facility code counts only after the facility map is rebuilt.

```
openldr users scope 3f2a9c1e
openldr users scope 3f2a9c1e --region Dodoma --district Arusha/Arumeru --force
openldr users scope 3f2a9c1e --all
```

## Rebuild the requisition index

OpenLDR keeps an index that finds an order by its requisition number. It keeps the index current as orders arrive, from forms and from other systems. Rebuild it only if an error kept an order out of the index, or after orders were deleted from the store. A lab plugin is planned that will use this index for reception.

```
openldr lab requisitions rebuild --force
```

It empties the index and indexes every current order again. It prints `Indexed <n> orders by requisition number.`, and `--json` prints `{"indexed":<n>}`. It refuses without `--force`, with `Refusing to rebuild the requisition index without --force.`, because it rewrites the whole index. Signed in, the account needs **Danger zone**. Each rebuild is audited as `lab.requisitions.rebuild`.

## Call a plugin action

`openldr plugin call <plugin> <action> --input '<json>'` runs one action of an installed plugin, as the plugin's page does. Use it for a plugin's settings on a lab that runs without a browser. For example, `openldr plugin call lab lab_settings_get` prints the lab plugin's settings.

- The action's own permission applies. On this machine, the CLI holds every permission. Through the server, it holds only the signed-in account's permissions and data limit, and the account also needs **View marketplace**.
- `--input` is the action's input as JSON. Without it the action gets `{}`.
- The command prints the plugin's answer. It exits 1 when the plugin or CE refuses, and says why. `--json` prints the answer as JSON.
