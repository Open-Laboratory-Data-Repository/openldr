# OpenLDR CE CLI Reference

Source of truth: `packages/cli/src/index.ts`. Captured help output for every command and subcommand is committed at `docs/audit/2026-06-23/cli-help-output.md`.

> Commands below are written for an installed stack, where the installer provides an `openldr`
> wrapper in the install directory (`.\openldr.ps1` on Windows). From a source checkout, use
> `pnpm openldr` instead. The arguments are identical. File arguments on an installed stack
> must live under `./data`; see the CLI doc's "Running it" section.

There are three ways to invoke it:

```bash
# Installed stack, from the install directory (`.\openldr.ps1` on Windows)
./openldr --help

# Source checkout, from the repository root
pnpm openldr --help

# Standalone install with no Docker, through its launcher. See "The standalone launcher" below.
openldr-standalone cli -- doctor
```

## How a command runs

Each command has a kind, kept in `packages/cli/src/command-meta.ts`. `openldr commands` lists them, and `openldr commands --json` gives each command's `kind`, `capability`, `alsoRequires`, `destructive`, arguments and options.

| Kind | Where it runs | Sign-in |
|---|---|---|
| `app` | In the running server, through `POST /api/cli/run`. Almost every command. | Needed. The account must hold the command's `capability` and every key in `alsoRequires`. |
| `recovery` | On the machine that runs OpenLDR, straight on the database. Exactly ten: `auth rebind-issuer`, `auth setup-code`, `db migrate`, `db reset`, `db seed`, `doctor`, `health`, `storage copy`, `target-store test`, `user reset-password`. | None. Without database settings it stops with `This command works on the database itself. Run it on the machine that runs OpenLDR.` |
| `local` | On the caller's machine. No database, no server. | None. `login`, `logout` and `whoami` talk only to the server's sign-in routes. |

Sign in with `openldr login` (local sign-in only), or set `OPENLDR_KEY` or `OPENLDR_KEY_FILE` to an access key. The client looks for a credential in that order: `OPENLDR_KEY`, `OPENLDR_KEY_FILE`, the session from `login`, then none. A key variable that is set but empty is an error. There is no `--key` option.

The server address is `--server-url <address>` (a root option, accepted anywhere on the line), then `OPENLDR_URL`, then `http://127.0.0.1:3000`. Plain HTTP to a host other than `localhost`, `127.0.0.1` or `[::1]` is refused unless `OPENLDR_ALLOW_PLAIN_HTTP` is `true` or `1`.

Through the app, `--actor` and `--approved-by` are refused before anything is sent, and the signed-in account is recorded. `audit list --actor <id>` cannot be used, because the root `--actor` takes the value (known fault). `sync export` and `report run --format pdf` need `--out`. The client and server must be the same release.

A key that was sent and refused prints `OpenLDR refused the access key from OPENLDR_KEY. It is revoked, expired or wrong.` (or `from OPENLDR_KEY_FILE`). An ended session prints `Your session has ended. Sign in again: openldr login.` Only a caller with no credential gets `Sign in first: openldr login, or set OPENLDR_KEY.` `login`, `whoami` and `logout` give up after 30 seconds with no answer, with `Cannot reach OpenLDR at <address>: ETIMEDOUT.` If the server stops during a command, the client prints `OpenLDR stopped while this command was running.` `sync status`, `sync now` and `sync quarantine retry` also print JSON log lines from the server on standard error, such as `sync disabled (not configured)`, because they start sync to give their answer. Other commands do not. Standard output stays clean.

The web docs page "CLI sign-in and access keys" (`apps/web/src/docs/0.1.8/en/cli-access.md`) has the full account, with real output.

## Exit Codes

Most commands return `0` on success and `1` on validation/runtime failure. Commander help invocations return `0`. Commands that talk to external services or databases also return `1` when required config is missing or the service is unavailable.

## Command Families

| Command | Purpose |
|---|---|
| `openldr commands [--json]` | List every command with its kind, the capability it needs, and whether it is destructive. |
| `openldr login [--username <name>] [--password-stdin]` | Sign in to the server and keep the session (local sign-in only). The password is asked for with no echo. `--password-stdin` needs `--username`. |
| `openldr logout` | End the session on the server and remove it from this machine. |
| `openldr whoami [--json]` | Show the account, its roles, and whether a session or a key signs in. |
| `openldr user key list/create/revoke` | List, make and revoke a user's access keys. `create <username> --name <name> [--expires <date>]` prints the key once, alone on standard output. A bare `YYYY-MM-DD` means the end of that day in UTC. `revoke <username> <keyId>` refuses without `--force`, and refuses a value that is not a key ID. All three refuse a username that holds `oldr_`. A key name with a tab, a line break or another control character is refused. |
| `openldr health` | Probe configured adapters and service health. |
| `openldr errors list` | List the error-code catalog. |
| `openldr fhir validate <file>` | Validate a FHIR JSON resource or bundle. |
| `openldr db migrate/reset/seed` | Manage internal and target database schema and seed data. |
| `openldr db warehouse-status` | Show how far the warehouse is behind the records saved, how fast it is catching up, and the time left. `--seconds <n>` sets the gap between the two readings that measure the rate (default 5, 0 reads once). Read-only. |
| `openldr db datasets list/rebuild/delete` | The datasets a content pack defines, kept as warehouse tables. `list` shows each one's pack, rows, last build and any build error. `rebuild [name]` rebuilds one or all from the warehouse as it is now, and exits 1 if a build failed. `delete <name>` removes a dataset and its table, and refuses without `--force`. |
| `openldr query groups list/create/rename/delete/move --kind <connector\|dataset>` | The groups of the Query page's Connectors and Datasets lists. `create <name>` makes an empty group. `move <item> [--group <group>]` puts a connector (by id), a pack dataset (by name) or a workflow dataset (`wf:<name>`) in a group, or in none. `delete <name>` removes a group and keeps what it held, and refuses without `--force`. |
| `openldr target-store test` | Probe the analytics warehouse adapter. |
| `openldr terminology ...` | Import, query, translate, and administer terminology assets. |
| `openldr forms list/extract` | List forms or extract QuestionnaireResponse data. |
| `openldr patients ...` | List and show patients, and label identifier systems. Masked unless `--identifiers`. |
| `openldr ingest <file>` | **Ingest a data file through the pipeline** (accept + drain), optionally via a converter plugin. The primary "push data into CE" CLI. |
| `openldr pipeline ...` | Inspect/retry ingest pipeline batches. |
| `openldr queue status` | Inspect the event queue. |
| `openldr provenance audit` | Inspect provenance/audit information. |
| `openldr plugin ...` | Install, list, test, run, and remove WASM plugins. |
| `openldr report ...` | List/run reports and export GLASS RIS. |
| `openldr report-def list/delete` | Manage data-driven report definitions. |
| `openldr report-design list/delete` | Manage Report Designer page designs. |
| `openldr audit list` | Query append-only audit events. |
| `openldr auth rebind-issuer --force` | Bind the database to a new `OIDC_ISSUER_URL` after the same provider moved address. Refuses without `--force`. Not for switching providers. |
| `openldr users list` / `openldr user ...` | Manage local users and roles. |
| `openldr user create --username <u> [--name <n>] [--email <e>] [--role <r>...] [--no-password]` | Make an account. `--no-password` makes it with no password, so it cannot sign in to Studio. Use it for an account that signs in with access keys. Local sign-in only. |
| `openldr user assign-role <subject> <slug>` / `unassign-role <subject> <slug>` | Add or remove a capability role. These roles decide what a key or a signed-in person may do. The change counts from the account's next request. On local sign-in the subject is the account's ID. `user set-role` does not change what they may do. |
| `openldr roles ...` | Manage capability roles. `roles doctor` reports capability drift against the built-in role definitions. |
| `openldr settings flags/numbers/sync/danger ...` | Read/write feature flags, numeric limits, sync config, and danger-zone actions. |
| `openldr sync ...` | Distributed (lab⇄central) sync status/control, enrollment, amendment, divergence, and offline bundle export/import. |
| `openldr export` | Export the complete dataset: canonical FHIR (NDJSON + Bundle) + flat-table CSV + manifest. |
| `openldr market ...` | Verify, install, update, enable/disable, roll back, and remove marketplace bundles. |
| `openldr artifact ...` | Author, build, sign, pack, test, and publish marketplace artifacts. |

> **DHIS2 has no core CLI.** DHIS2 shipped as a removable plugin; there is no `openldr dhis2 …` command. Its mappings, org units, and pushes are driven from the plugin's own screens or from workflow nodes.

## Copy-Paste Examples

The command forms are `.\openldr.ps1` on PowerShell and `./openldr` on bash. Use PowerShell line continuations with backticks and bash continuations with backslashes.

```powershell
.\openldr.ps1 health --json
.\openldr.ps1 db migrate --json
.\openldr.ps1 target-store test --engine pg --json
.\openldr.ps1 report list --json
```

```bash
./openldr health --json
./openldr db migrate --json
./openldr target-store test --engine pg --json
./openldr report list --json
```

The WHONET sample is a repository file, so ingesting it is a source-checkout command:

```bash
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json
```

## Ingesting data with `openldr ingest`

`openldr ingest <file>` runs a file through the ingest pipeline (accept → convert → drain into the FHIR store). It is the file/CLI half of the "push data into CE" story (the HTTP half is the workflow webhook, see [Operator Guide, Ingesting & pushing data](OPERATOR-GUIDE.md)).

| Option | Default | Purpose |
|---|---|---|
| `--converter <id>` | `fhir-bundle` | Converter that parses the file. `fhir-bundle` expects a FHIR transaction/collection Bundle. |
| `--plugin <id>` | none | Alias of `--converter`; use an installed WASM converter plugin (e.g. `whonet-sqlite`, `hl7v2`, `tabular`). |
| `--config <file>` | none | Plugin config JSON (e.g. tabular column mapping). |
| `--source <s>` | `cli` | Source-system identifier recorded on the batch/provenance. |
| `--json` | off | Emit the batch result as JSON. |

The plugin and the sample file below are repository files, so this example is a source checkout. `ingest`, `plugin install` and `pipeline` go through the running API, so start it and sign in first. On a dev machine, `AUTH_DEV_BYPASS=true` in `.env` signs them in.

```bash
# FHIR Bundle (default converter)
pnpm openldr ingest bundle.json --json
# WHONET SQLite via a converter plugin (must be installed first)
pnpm fetch:whonet
pnpm openldr market install reference-plugins/whonet-sqlite --approve
pnpm openldr ingest samples/whonet-sample.sqlite --plugin whonet-sqlite --json
# Inspect / retry the resulting batch
pnpm openldr pipeline status --json
pnpm openldr pipeline retry <batchId>
```

On an installed stack the same commands are `./openldr …`, and each file must be copied into
`./data` and named with the `data/` prefix.

## Sync

Distributed sync links labs to a central OpenLDR server. Two command groups cover it: `openldr settings sync …` edits the stored configuration on a lab, and `openldr sync …` reports live status, triggers a pass, and (on central) enrolls labs. All accept `--json`.

**Configuration (lab), `openldr settings sync`**

| Command | Purpose |
|---|---|
| `openldr settings sync show` | Print the current sync configuration (the secret is never shown, only whether one is set). |
| `openldr settings sync set <field> <value>` | Set one field: `enabled`, `mode`, `centralUrl`, `siteId`, `oidcIssuer`, `clientId`, `clientSecret`, or `intervalMinutes`. |

`mode` is one of `push`, `pull`, or `bidirectional`. `clientSecret` is write-only.

**Status and control, `openldr sync`**

| Command | Purpose |
|---|---|
| `openldr sync status` | Show live sync status: workers, cursors, and the pending push backlog. |
| `openldr sync now` | Trigger a sync pass immediately. Fails (exit `1`) if sync is disabled. |
| `openldr sync quarantine list` | List bulk records the pull stream is holding or has quarantined, with attempt counts and the last error. |
| `openldr sync quarantine retry <entityType> <entityId>` | Clear a quarantined bulk entity and re-sync it by id (url). Fails (exit `1`) if the retry does not apply. |
| `openldr sync divergence list` | List same-version divergences detected between the lab and central. |
| `openldr sync divergence show <resourceType> <resourceId> <version>` | Inspect one divergence. |
| `openldr sync divergence clear <resourceType> <resourceId> <version>` | Acknowledge/clear a divergence. |

A pull record that fails repeatedly is quarantined rather than left to block the stream. See [Operator Guide, Distributed sync](OPERATOR-GUIDE.md#distributed-sync).

**Offline bundle (sneakernet), `openldr sync`**

For a lab with no live link, sync can move through a signed file instead of HTTP.

| Command | Purpose |
|---|---|
| `openldr sync export` | Write a signed offline sync bundle to a file (on a lab this is the push delta; on central use `--site <id>` for that site's pull delta). |
| `openldr sync import <file>` | Apply a signed offline sync bundle received from the other side. |

**Result amendment, `openldr sync`** (run on the central server)

| Command | Purpose |
|---|---|
| `openldr sync amend --resource-type <t> --id <id> --status <s> [--reason <text>] [--patch <json>] [--agent <who>] [--activity <verb>]` | Amend a lab-owned result on central: writes a new FHIR version and queues it for the owning lab to pull back. `--patch` is a JSON fragment merged into the resource. `--activity` (default `amend`) labels the co-edit; supported resource types are `Observation`, `DiagnosticReport`, and `ServiceRequest`. |

For an order (co-edit lab request status/metadata), amend the `ServiceRequest`, e.g. `openldr sync amend --resource-type ServiceRequest --id <id> --status completed --activity update`.

| Command | Purpose |
|---|---|
| `openldr sync merge-patient --survivor <id> --duplicate <id> [--reason <text>]` | Intra-lab patient merge on central: re-points the duplicate patient's lab history (requests/results/specimens) to the survivor and marks the duplicate replaced. Both patients must belong to the same site. |

The owning lab drains these central-authored amendments on its pull pass via the `'sync-amend-pull'` cursor (a distinct `change_cursors` consumer alongside `'sync-push'`, `'sync-pull'`, and the terminology cursor).

**Central-side enrollment, `openldr sync`** (run on the central server)

| Command | Purpose |
|---|---|
| `openldr sync enroll <siteId> [--name <name>] --central-url <url>` | Mint a lab's Keycloak client + registry row and print the client id and secret **once**. `--central-url` is required. |
| `openldr sync list` | List enrolled sites and their status (never shows secrets). |
| `openldr sync rotate <siteId>` | Issue a new client secret for a site and print it once. |
| `openldr sync revoke <siteId>` | Delete a site's client and mark its registry row revoked (idempotent). |

Enrollment requires the central Keycloak realm to grant the admin service account `manage-clients`/`view-clients` (present in the shipped realm export).

Enroll a lab on central, then hand the printed credentials to the lab operator:

```bash
./openldr sync enroll lab-site-01 --name "Regional Reference Lab" --central-url https://central.example.org --json
./openldr sync list --json
```

## Facilities

### openldr facilities link-matching

Links each observed facility code to the row in one register that has exactly the same code. Use
it after importing a facility list keyed on the codes your LIMS sends, such as a v1 facility
dictionary keyed on DISA codes.

    openldr facilities link-matching --register <url> [--apply] [--json]

A dry run by default. It reports four counts: codes it would link, codes already linked, codes
kept because they already have a mapping, and codes with no match. It never changes a code that
already has a mapping. With `--apply` it writes every link in one transaction and queues a
facility map rebuild. An unknown or deactivated register exits 1.

## Patients

Reads the patient index. The source system owns each patient, so every command here reads
except `identifier-systems set`, which changes only a label.

    openldr patients list [--search <text>] [--status active|merged|all] [--limit <n>] [--offset <n>] [--identifiers] [--json]
    openldr patients show <id> [--identifiers] [--json]
    openldr patients identifier-systems list [--json]
    openldr patients identifier-systems set <system> [--label <text>] [--list-column on|off] [--searchable on|off] [--json]
    openldr patients duplicates list [--status open|dismissed|all] [--limit <n>] [--offset <n>] [--identifiers] [--json]
    openldr patients duplicates dismiss <idA> <idB> [--reason <text>] [--json]
    openldr patients duplicates restore <idA> <idB> [--json]
    openldr patients duplicates export [--out <file>]

Output is masked unless you pass `--identifiers`, which is audited. A masked name keeps its
first letter and a masked identifier keeps its last four characters. `list` and `show` with
`--identifiers` write an audit event. It records the signed-in account. All patient commands
go through the app. `list`, `show` and `duplicates list` need `patients.view_identifiers` even
without `--identifiers`. `identifier-systems list` shows each
identifier system CE has seen, its label, whether it shows in the list and whether search
matches it. `identifier-systems set` changes one system and is audited too.

`duplicates list` shows groups of patients that look like the same person: the same value in a
searchable identifier system, or the same surname, first name and date of birth. `--status`
picks open groups (the default), groups marked as not duplicates, or both. `--limit` (1 to 200,
default 25) and `--offset` (default 0) page through the groups. Output is masked
unless you pass `--identifiers`. With `--identifiers`, `list` writes an audit event that records
the group count only. `dismiss` and `restore` take two patient
ids, mark them as different people or undo that, and are audited. `export` writes the open
groups as CSV with names and identifiers, to stdout or to `--out`. It always writes an audit
event that records the group count only. CE does not merge patients. The source system fixes
duplicates.

## Copying a source database

Copies the rows of a source database to OpenLDR's own disk, with a plugin that names the rows to
copy. There is one copy per plugin and connector. The plugin must be allowed to read the
connector first (`openldr import allow <plugin> <connector>`).

    openldr import copy start --plugin <id> --connector <id> [--option name=value]... [--page-size <n>] [--reread] [--json]
    openldr import copy status <plugin> [copy] [--json]
    openldr import copy stop <plugin> <copy>
    openldr import copy delete <plugin> <copy> --force

`start` records the request and returns. The server does the copying, so the command never
waits for it. Run `status` to follow it. `start` on a stopped or failed copy carries it on from
where each set stopped. `start` on a finished copy reads no set again. It only tries the skipped
keys again, so it reads no new source rows. `start` on a queued, running or waiting copy whose
SQL has not changed returns it unchanged. `--page-size` is the number of source keys per page,
1 to 2000, default 500.

When the plugin's SQL for a set changed since the copy began, `start` prints
`these sets would be read again from the start: <names>. Run again with --reread to do that.`
and exits 1 with nothing changed. With `--reread` it empties those sets and reads them again
from the start. A running or waiting copy must be stopped first.

`status` prints one line per copy: the copy's id, its status, then for each set
`<name> keys=N rows=N bytes=N skipped=N`. A waiting or failed copy ends its line with the error.
The status is one of `queued`, `running`, `waiting`, `stopping`, `stopped`, `completed`, `failed`
or `deleting`. `waiting` means the source cannot be reached, and the copy tries again by itself.
A completed copy that still has skipped keys shows `completed with skipped keys` in place of
`completed`. `--json` keeps the status `completed` and gives each set's `skipped` count.
No source key is ever printed, and `--json` leaves out each set's position.

`stop` stops the copy at its next page. The rows copied so far stay. `delete` removes a stopped,
failed or finished copy and every row it holds, with the held requests and the record of its check.
It refuses without `--force` and changes nothing.
With `--force` it returns while the copy is still being deleted, and prints its status as
`deleting`. The server deletes the rows in batches, and carries on after a restart. Run `status`
to see when the copy is gone: it prints `(no copies)` once the last one is deleted.

All four go through the app and need `connectors.manage`. `start` and `delete` are marked
destructive. Exit code 0 when the request was recorded or the answer was printed, and 1 on a
refusal.

## Removing a plugin

Removes a plugin without leaving its work running. `plugin remove` and `market remove` do the same.

    openldr plugin remove <id> [--keep all|settings|nothing] [--force] [--json]
    openldr plugin remove <id> --version <v>
    openldr market remove <id> [version] [--keep all|settings|nothing] [--force] [--json]

Without a version, the whole plugin goes. Its running checks are stopped first, then its running
reads, and the command waits up to two minutes until each has stopped. If one has not, it prints
`still stopping: <ids>. Nothing was removed; try again in a minute` and exits 1.

`--keep` says what stays. `all`, the default, keeps the plugin's settings and copied data, so it
can be installed again and carry on. `settings` keeps connector access and the plugin's settings
and deletes every copy of read data and the held lists. `nothing` deletes all of the plugin's data.
Requests a check saved into OpenLDR are never deleted.

It refuses without `--force` when anything is running or anything would be deleted, and names
what it would stop. With a version, only that installed version is removed and nothing is stopped.

## Checking a copied source

Checks a finished copy with a plugin that decodes each request. The check reads the copy, not the
source database. The plugin decodes each request. OpenLDR saves the requests that pass. It keeps the
held and failed ones, with the reason, so a person can read them. When no reference copy is given,
nothing is compared with reference records, and the saved requests are marked as not compared.

    openldr import check start --plugin <id> --copy <copy> [--reference <copy>] [--option name=value]... [--page-size <n>] [--from-start] [--json]
    openldr import check status <plugin> [run] [--laboratories] [--json]
    openldr import check stop <plugin> <run> [--json]
    openldr import check held <plugin> <copy> [--label <label>] [--reason held|error] [--laboratory <code>] [--offset <n>] [--limit <n>] [--export <file> [--force]] [--json]

`start` records the request and returns. The server does the checking, so the command never waits
for it. Run `status` to follow it. There is one check for each copy. `--page-size` is the number of
requests per page, 1 to 2000, default 500. `--reference` names a copy of reference records to
compare with.

`start` on a stopped or failed check carries it on from the page after the last one it finished. It
keeps its counts, its held requests and its page size, unless `--page-size` is given. The check
starts again from the first request, with its counts at zero, when:

- the check completed;
- `--from-start` is given;
- the options or the reference copy differ from the check's own;
- the copy or the reference copy was read again since the check began.

After the run's line, `start` prints `Carries on from N requests read.` or
`Starts from the first request.` When a check starts again, a request it saved before is saved again, not twice.

A check reads only copies of a connector the plugin may still read. After `import revoke`, `start`
refuses that copy, and a running check fails at its next page with the reason in `lastError`. It
saves nothing more.

`status` with a run id prints one line: the run's id, its status, `copy=<id>` (the copy it checks,
which `held` needs), then `read=N saved=N held=N failed=N`. Without a run id it prints that line for every check of the
plugin, or `(no checks)`. The status is one of `queued`, `running`, `waiting`, `stopping`,
`stopped`, `completed` or `failed`. `--laboratories` adds one indented line for each laboratory code
met, with the same four counts. Requests that name no laboratory show as `(none)`. A run with an
`error:` line has a `lastError`. It holds the reason the last page could not be decoded, or the reason
the run failed. The next page that decodes clears it. `status` exits 1 when the run does not exist.
No source key and no position is printed, and `--json` leaves out the run's `cursor` and `driver`.

`stop` stops the check at its next page. The requests saved so far stay.

`held` lists the held and failed requests of a copy, one line each: the source key, the laboratory,
the label (or the reason when there is none), the error code or `-`, and the time it was held. The
last line is `total N`, the number of rows the filters match. `--reason held` shows only the
requests the plugin held. `--reason error` shows only the failed ones. `--label` is 1 to 64
characters. `--laboratory` is 1 to 32 letters, digits, dots, dashes or underscores. `--limit` is 1 to
100, default 50, and `--offset` skips rows. The list never shows what the plugin found. Each read of
the list writes an audit event that names the plugin and the copy.

`--export <file>` writes every matching request to the file instead, one JSON object per line, with
what the plugin found. The file holds patient values. It is private to the person who wrote it
(mode 0600). The command prints only how many requests it wrote. It refuses `--offset` and
`--limit` with `--export`. An existing file is kept, and the command exits 1, unless `--force` is
given. A folder or a link is always refused. The file is written whole or not at all: the command
writes a temporary file beside it and renames it when every request is in. It reads the requests in
key order, each page after the last key of the one before, so no request is read twice. The export
is refused while a check of that copy is queued, running, waiting or stopping, because the rows are
still changing. When the count it wrote differs from the total, it writes no file and exits 1. It
writes one audit event, as the list does.

All four go through the app and need `connectors.manage`. `start` also needs `ingest.run`. `held` is
marked destructive because of `--export`. Exit code 0 when the request was recorded or the answer was
printed, and 1 on a refusal.

## The standalone launcher

`openldr-standalone` runs OpenLDR on one computer with no Docker: a bundled Postgres 16 and the server, with all data in one folder. Source: `apps/standalone/src/commands.ts`. In a built checkout it is `pnpm openldr-standalone`. The desktop app installs it as a command of its own: `~/.local/share/openldr-desktop/openldr-standalone` on Linux, `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone` on macOS, `%LOCALAPPDATA%\Programs\OpenLDR\openldr-standalone.cmd` on Windows. The full account is in two web docs pages, `apps/web/src/docs/0.1.8/en/standalone.md` and `apps/web/src/docs/0.1.8/en/desktop-app.md`. Only Linux has been tested.

Its help text, from `USAGE`:

```text
Usage: openldr-standalone <command> [options]

Commands:
  start    Start Postgres and the server. Ctrl+C stops both.
           --data-dir <folder>  --port <port> (default 3000)  --host <address> (default 127.0.0.1)
           --events-fd <n>  Write one JSON line per event to descriptor n (3 or higher).
                            No setup code is made or printed.
  stop     Stop the launcher running on the data folder.  --data-dir <folder>
  status   Say whether it is running, and where.  --data-dir <folder>
           --json  Print one JSON line instead.
  cli      Run the openldr CLI against this install, for example: cli -- doctor
           --data-dir <folder> goes before the --.
```

`--data-dir` wins over `OPENLDR_HOME`, which wins over the default folder. The default is `~/.local/share/openldr` on Linux, `~/Library/Application Support/OpenLDR` on macOS and `%LOCALAPPDATA%\OpenLDR` on Windows. On Linux, `$XDG_DATA_HOME/openldr` replaces it when `XDG_DATA_HOME` holds a full path. One launcher runs per data folder.

### `start --events-fd <n>`

A program that runs the launcher, such as the desktop app, passes a descriptor it opened. The launcher writes one JSON object and a newline to it per event. There are six events. `starting` comes twice, once per step:

```text
{"event":"starting","step":"postgres"}
{"event":"recovering"}
{"event":"starting","step":"server"}
{"event":"ready","address":"http://localhost:3000/studio/"}
{"event":"stopping"}
{"event":"stopped","result":"clean"}
{"event":"error","message":"..."}
```

`starting` has `step` `postgres` or `server`. `recovering` comes only when Postgres repairs itself after an unclean stop. `stopped` has `result` `clean`, or `forced` when the stop cut the server off, for example after 60 seconds. `error` comes when a start fails, and when a stop leaves something behind. The launcher then exits with code 1. No event holds a password, a key, a token or a setup code. A failed write is ignored, so a reader that has gone does not stop the launcher.

With `--events-fd`, `start` makes no setup code and prints none. The program asks for one itself with `cli -- auth setup-code --json`. The launcher's printed lines stay as they are. The value must be a whole number, 3 or higher; otherwise the launcher prints `--events-fd must be a whole number, 3 or higher.` and exits with code 2.

### `status --json`

`status --json` prints one JSON line and nothing else. It has three shapes:

```text
{"dataDir":"/home/you/.local/share/openldr","running":true,"address":"http://localhost:3000/studio/","host":"127.0.0.1"}
{"dataDir":"/home/you/.local/share/openldr","running":false}
{"dataDir":"/home/you/.local/share/openldr","running":false,"busy":"OpenLDR is not running. A recovery command is using the database (process 12345). Try again when it has finished."}
```

`host` is the `--host` the running launcher was started with. A lock written by an older launcher may have none, and the line then has no `host`. The third shape means a recovery command, such as `cli -- doctor`, holds the data folder.

### Exit codes

| Command | Code | When |
|---|---|---|
| `status` | `0` | A launcher runs on the data folder. |
| `status` | `3` | None runs, or a recovery command holds the folder. The same with `--json`. |
| `stop` | `0` | Stopped, or nothing was running. |
| `stop` | `1` | `Could not confirm that OpenLDR stopped: ...` |
| `start` | `1` | The start failed, or a stop left something behind. |
| any | `2` | The options are wrong. The launcher prints the reason, then the help text. |

`cli` exits with the CLI command's own code, or `1` when it cannot run the command, such as `Start OpenLDR first: openldr-standalone start` for an `app` command while nothing runs.

### A data folder from a newer version

`last-version.json` in the data folder records the version that last started it, as `{"version":"0.1.11"}`. A start writes it just before the server starts, because the server may change the database even when it then fails. A launcher older than the recorded version refuses the folder before it starts anything, and `start` exits with code 1:

```text
This data folder was last used by OpenLDR <newer>. This is OpenLDR <older>, which is older and cannot open it. Install OpenLDR <newer> or newer.
```

Removing `last-version.json` lets the older launcher start. That is safe only when the newer version never changed the database. Otherwise the older launcher fails with a database error, or runs on data it does not expect. Install the newer version instead. Source: `apps/standalone/src/data-version.ts`.

## Captured Terminal Output

`docs/audit/2026-06-23/cli-help-output.md` is a captured terminal-output appendix dated 2026-06-23. It predates the `errors`, `ingest`, `report-def`, `report-design`, and `sync divergence/export/import` additions, and still shows the removed `dhis2` group. Treat it as a snapshot, not the current command list. Run `./openldr <group> --help` for the live help. It contains fenced `console` blocks with the prompt, command, real output, and `EXIT_CODE` for each command, including:

- top-level `openldr --help`;
- every command family help page;
- every leaf subcommand help page.

Live examples that require services, databases, Keycloak, or DHIS2 should be run only after `.env` is configured and `docker compose up -d` plus the seed have completed, in the order `e2e/README.md` gives (`pnpm e2e:seed:reset` with the API stopped, start the API, then `pnpm e2e:seed:load`). The load and every `app` command need the API running and a signed-in caller. Right after the reset no account or key exists, so the API must run with `AUTH_DEV_BYPASS=true`.
