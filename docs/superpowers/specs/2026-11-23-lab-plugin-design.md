# Lab module as a plugin: design

Status: draft for operator review, 2026-11-23. Replaces where the lab module lives in
`2026-11-22-lab-module-design.md`. That design's lab behaviour (reception, return, reject, redraw,
review, release) still stands. Its section 2 ruling that the module lives in CE core does not.

## 1. What this is and why

OpenLDR CE is a lab data repository. It stores what source systems send it. The lab module is the
lab's own working process: take orders, receive samples, reject or return, enter results, review,
authorise. It sits before the repository, the way Corlix does.

The operator decided on 2026-11-23:

- "the lab module is not part of openldr ce, its meant to be a plugin just like cdr-source ... We
  are building plugins that will work with profiles."
- "ce should be able to work without the lab module plugin. The plugin can work as minimum or with
  full features of ce, no profile."
- The lab module keeps its own working records. It reads patients, terminology, the test catalog
  and other CE resources. "data only is sent to ce once its authorized, so the plugin should be
  able to do a lot of things on its own as if it was a system."
- "lab module is independent, it doesn't even know ce has forms". Orders enter in the lab module.
- Its records live in its own tables in CE's database (approach A below).
- Port what works in Corlix, then adapt it, rather than solving the same problems again.

Slices 1a, 1b, 2 and 3 of the old design were built into CE core and pushed (origin `28762d534`).
They edit CE's own FHIR records, whatever their source. They also took result entry and rejection
out of CE's Lab order form. Both conflict with the decisions above. This design keeps the general
parts, moves the lab-only parts into the plugin, and gives CE its form back.

## 2. Goals, non-goals, anti-goals

Goals:

- A lab plugin, `openldr-ce-plugin-lab`, built like cdr-source: Rust compiled to WebAssembly for
  its server code, a React page built from copied studio components, signed and installed from
  the marketplace.
- The plugin works as its own system: its own orders, samples, results, reviews and rejections, in
  its own tables.
- CE gains host features any profile plugin can reuse: a private schema per plugin, host functions
  for that schema and for reading CE resources, plugin-declared capabilities, a capability gate per
  plugin entrypoint, and the caller's capabilities and data limit passed to the plugin.
- Authorised results reach CE as FHIR records through the save path cdr-source already uses.
- CE works fully without the plugin. Its Lab order form enters results and rejections again.
- A lab profile pack installs the plugin's seeds, roles and layout.

Non-goals:

- The lab plugin using CE forms. It does not know they exist.
- Analysers, QC, billing, microbiology trees (as in the old design).
- Separate site and lab installs. Sites are users on the same install, limited to their facility.
- CLI commands supplied by a plugin. Plugin admin is done in its page (section 7.2).

Anti-goals:

- Lab work in progress in CE's FHIR store or warehouse. Only authorised results go in.
- The plugin changing a CE record that another system sent.
- A host feature that gives a plugin raw database or FHIR handles. Every host function is scoped
  and gated.
- Lab-only code left in CE core.

## 3. Approaches

**A. The plugin gets its own tables in CE's database (picked).** CE gives each plugin a private
Postgres schema. The plugin ships its own SQL migrations, and CE runs them at install and upgrade.
The plugin's server code reads and writes only its own schema, through host functions. It reads CE
resources through other host functions and sends authorised FHIR through the host's save path.
Worklists filter and page like any CE table. The new host features serve every profile plugin.

**B. Plugin documents (`plugin_data`), which exist today.** The least CE work, but a list filters
on one field only and stops at 1000 rows (`packages/bootstrap/src/plugin-broker.ts:195`,
`packages/db/src/plugin-data-store.ts:87-99`). A worklist by section, status and age would need
workarounds and slows as orders grow.

**C. A separate app beside CE**, like Corlix, sending over CE's API. No CE changes, but it is not a
plugin, a profile cannot include it, and users sign in twice.

The operator picked A on 2026-11-23.

## 4. What exists today (measured 2026-11-23 at `28762d534`)

- Two plugin kinds, `source` and `sink` (`packages/plugins/src/manifest.ts:4-27`). The signed
  manifest has `capabilities[]` from a fixed list (`packages/marketplace/src/capabilities.ts:12-27`):
  `emit-fhir{resourceTypes}`, `host:fhir` (facility reads only), `host:import` and others.
- Plugin server code runs in Extism. Its only host functions are HTTP, `log` and `progress`
  (`packages/plugins/src/extism-runner.ts:86-107`). `invoke` passes JSON in and out, with no caller
  identity (`plugin-broker.ts:487-492`). Memory and timeout limits are not enforced on the
  foreground path (`extism-runner.ts:33-35`).
- A plugin page is one sandboxed iframe at `/x/:pluginId` with one sidebar entry
  (`apps/studio/src/shell/AppShell.tsx:200`). The route has no capability gate
  (`apps/studio/src/App.tsx:100`). The page gets `capabilities: []`
  (`apps/studio/src/plugins/PluginContainer.tsx:38`). Layouts cannot list plugin pages.
- The broker gates a plugin by `ui.requiredRoles` or `ui.requiredCapabilities`. A caller let in by
  capability may only use a hard-coded op list for imports (`plugin-broker.ts:32-38,433-435`).
- cdr-source returns FHIR records. The host checks the types against the plugin's `emit-fhir` list
  and saves them with validation (`packages/bootstrap/src/import-run.ts:25,488`,
  `index.ts:908-929`). The plugin never writes FHIR itself.
- RBAC capabilities are a fixed list (`packages/rbac/src/catalog.ts:118-131`). Migrations are a
  static list. Plugins cannot add routes or CLI commands.
- A profile pack is a content pack with `needs`, `role`, `layout` and `form` steps, and it can seed
  code systems and value sets (`packages/marketplace/src/content-pack.ts:6,19-20,65-93`). A `needs`
  step stops the install if a named plugin is missing (`content-pack-profile.ts:85-89`).

## 5. CE host features

Each is general: nothing in it names the lab.

### 5.1 A private schema per plugin

- Name `plugin_<id>`, with the id made safe for SQL. CE creates it at first install with its own
  login. There is no separate Postgres role per plugin: the standalone's login cannot create roles
  (`apps/standalone/src/postgres.ts:666`), and the operator chose on 2026-11-23 not to add one.
- **A plugin never sends SQL.** The operator asked for "every precaution for a bug not to reach
  other tables (for malicious intent)", with other tables read-only. So the plugin declares its
  tables as data, not SQL: name, columns (name, type from a fixed list, nullable, default), primary
  key, indexes, and whether the table holds facility data. CE turns that into DDL inside the
  plugin's schema only, with every name quoted and checked against a safe pattern.
- **Table shapes are versioned.** Each plugin version ships its full table list. At install and
  upgrade CE compares it with what exists and makes only additive changes: new tables, new nullable
  columns, new indexes. Anything else (drop, rename, type change) refuses the install with a plain
  message. A refused or failed change leaves the old version active.
- Removing the plugin drops the schema only after a typed confirmation, as removing plugin data
  does today. Disabling keeps it.
- The signed manifest gains a capability `host:db`, so the install consent screen shows it.

### 5.2 Host functions for plugin server code

Added to the Extism runner. Each is available only if the manifest declares its capability.

- `db_select(request)` and `db_write(request)`: structured requests on the plugin's own tables
  only. A select names one table, the columns, equality and range filters, order, and a limit and
  offset (capped). A write is a list of insert, update-by-key and delete-by-key steps on its own
  tables, run as one transaction. CE builds every statement with Kysely inside `plugin_<id>`,
  checks every table and column name against the declared shape, binds every value, and sets a
  statement timeout. Nothing else in the database is reachable. Capability `host:db`.
- `ce_read(op, input)`: read CE resources. First ops: patient search and get (respecting the
  caller's data limit), patient register, value set expand and lookup, test catalog list and get
  (with the per-lab settings), facility search. Capability `host:ce-read`.
- `fhir_emit(resources)`: send FHIR records to CE through the save path cdr-source uses, checked
  against the plugin's `emit-fhir` list and validated. Records carry fixed ids, so a retry updates.

A foreground Extism host function cannot return a Promise (`extism-runner.ts:22-25`), and database
calls are async. So a plugin that declares `host:db` or `host:ce-read` runs its calls on the worker
path, with a bridge like the HTTP one, at about 20 ms extra per call.

Patient register writes a Patient to CE before any result is authorised. Patients are a shared CE
resource, not lab work in progress, so this is allowed (my call).

### 5.3 The caller passed to the plugin

`invoke` passes the caller to the plugin's code: user id, display name, capabilities, and data
limit (facility ids). The plugin uses them for audit and to filter its own records by facility.

For a table declared as holding facility data, CE adds the caller's facility filter to every
select, update and delete itself, and refuses an insert for a facility outside the caller's limit.
As a second guard, CE turns on forced row-level security on such tables, with a rule that reads a
transaction-local setting CE sets before each request (`set_config('openldr.facilities', ..., true)`).
`FORCE` matters because CE's login owns the tables. A user with no limit gets a setting the rule
reads as "all". The operator asked about row-level security on 2026-11-23.

### 5.4 Plugin-declared capabilities and a gate per entrypoint

- The manifest declares capabilities in the plugin's own namespace, for example `lab.receive`, with
  a label and description. CE merges them into the RBAC catalog while the plugin is installed, so
  the Roles page and profile `role` steps can grant them.
- The manifest maps each entrypoint to the capability it needs. The broker refuses an `invoke`
  whose caller lacks it. This replaces the hard-coded import op list for plugins that declare it.
- Removing the plugin hides its capabilities. Role grants stay stored, so a reinstall restores them.

### 5.5 The page knows the caller

- The page receives the caller's real capabilities in its init context
  (`PluginContainer.tsx:38` passes `[]` today), so it can show or hide its own tabs.
- The sidebar entry and the `/x/:pluginId` route are gated by `ui.requiredCapabilities`, any of.
- A profile layout may list a plugin page.

One sidebar entry per plugin, with tabs inside the plugin's page, as cdr-source does. The operator
asked for one "Lab module" entry with tabs (2026-11-23).

### 5.6 Limits

The foreground runner cannot stop a runaway call and does not enforce memory
(`extism-runner.ts:33-35`). Lab entrypoints are short, but a plugin that serves interactive pages
needs both. The builder enforces both, or runs `invoke` on the worker path where they hold.

## 6. CE clean-up

### 6.1 Keep in core (general, used by any source or plugin)

FHIR Task and Provenance; Specimen `condition`; ServiceRequest `requisition` and `replaces`;
`FhirStore.correct`; the value set expand fix; critical limits on catalog ranges; one ServiceRequest
per test with fixed ids from the Lab order form; the warehouse filter for preliminary and
registered results (external 028); the requisition lookup (internal 139).

### 6.2 Move out of core into the plugin

- The Reception page and every sheet in `apps/studio/src/lab/`.
- `apps/server/src/lab-routes.ts`.
- `packages/bootstrap/src/lab-reception.ts`, `lab-rejection.ts`, `lab-shared.ts`, `lab-sections.ts`.
- `packages/cli/src/lab.ts`.
- The lab sections table and the self-authorise switch on the Laboratory settings page.
- The seven `lab.*` capabilities and the Reception role in `packages/rbac`.
- The Reception docs.

Their logic is ported into the plugin (section 7.4), not thrown away.

Migrations cannot be deleted. A new internal migration:

- puts Results (`fld-ord-results`) and Order rejection (`fld-ord-rejection`) back on the Lab order
  form, only when the form is as 140 left it, with a warning otherwise, and moves the starter pack
  to version 8;
- keeps the role grants of `lab.*` keys stored, so the plugin's declared capabilities pick them up
  under the same keys;
- leaves the seeded value sets (return reasons, sample conditions, task codes, lab sections) in
  place. The lab profile pack seeds them on a fresh install. On an existing one they are already
  there.

The form builder offers the test details field again. CE docs go back to describing result entry
in the Lab order form.

### 6.3 Lab records already in CE

Slices 1b to 3 wrote Tasks, Specimens with a condition, Provenance and revoked ServiceRequests into
CE's FHIR store. No release contains that code (`git tag --contains 501cf0c` is empty), so only dev
and proof databases hold them. They are left as they are (my call).

### 6.4 When

The operator chose on 2026-11-23 to remove Reception from CE first, before the plugin exists. Nothing
relies on it now.

## 7. The lab plugin

### 7.1 Shape

Repo folder `openldr-ce-plugin-lab` (plugin folders are `openldr-ce-plugin-<name>`). Rust for the
server code, React and copied studio components for the page, and the same build, signing and
marketplace path as cdr-source. Manifest capabilities: `host:db`, `host:ce-read`, and `emit-fhir`
for ServiceRequest, Specimen, Observation, DiagnosticReport and Provenance. Not Task: returns and
redraws stay inside the plugin (7.3).

The plugin's guide lives in its own page, in en, fr and pt. CE's docs get one short page saying what
the lab plugin is and how to install it (operator, 2026-11-23).

### 7.2 Pages

One sidebar entry, "Lab", with tabs shown by capability:

| Tab | Holds | Capability |
|---|---|---|
| Reception | find or register an order, receive, reject sample, return, redraw link | `lab.receive`, `lab.reject` |
| Orders | every order and its state, filter by facility, section, status, age; a site user corrects a returned order here | `lab.worklist.view` |
| Results | enter results per test, with the named range picker | `lab.results.enter` |
| Review | send back or authorise | `lab.results.authorise` |
| Settings | sections, which tests need review, self-authorise | `lab.settings` |

Release and amendments come after these (old design 5.7, 5.8).

### 7.3 Its own records

Tables in its schema for: orders; tests on an order; samples, and which tests each serves; results
and their history; returns and redraws; its own lists (return reasons, sample conditions, reject
reasons, sections); and an audit trail.

- The plugin works with no profile pack. Its migrations seed its lists, and its Settings tab edits
  them (my call; operator: the plugin works "with full features of ce, no profile").
- Reception finds only the plugin's own orders. It never reads CE ServiceRequests (operator: "it
  doesn't even know ce has forms").
- Ids are fixed from facility, requisition number and test, so a retry updates. The FHIR ids it
  sends to CE use their own namespace (a plugin prefix in the hash), so they never collide with ids
  the CE Lab order form makes (my call).
- A return to the site and a redraw are plugin records. A site user, limited to their facility,
  sees the returned order in the Orders tab and corrects it there. Nothing goes to CE.

### 7.4 What it ports

- From Corlix (`~/Projects/Repositories/corlix`): the order, receive, result entry with a tab per
  test, proceed to review, send back with history, authorise, and per-test reject with history
  flows and screens.
- From CE slices 2 and 3: the reception rules. A patient shows only on a strong match. Register
  takes an estimated birth date. Receive takes a condition. Return and mark corrected. Reject a
  sample or a test. Link a redraw. Fixed ids. A sample links only the tests that take its type.
- From CE: the named reference range picker (`apps/studio/src/forms-runtime/TestDetailSheet.tsx`,
  spec `2026-09-16-named-reference-ranges-design.md`). The bench picks the range, and the result
  keeps it.

Not ported from Corlix: one sample type per order; its report's range columns; its critical check
that ignores sex and age; its unused altitude field.

### 7.5 What it sends to CE, and when

On authorise, per test: the Patient reference, the ServiceRequest, the Specimen, the Observation
`final` with the picked `referenceRange` and `interpretation`, and a Provenance naming who
authorised. The DiagnosticReport per order follows with release. Nothing is sent before
authorisation.

A rejected test is sent once it is final (rejected, with no redraw pending), as a `revoked`
ServiceRequest with the rejection extension, so CE's rejection counts stay right.

### 7.6 Data limit

A site user is limited to their facility. Every plugin table that holds facility data turns on
forced row-level security (`FORCE`, since a table's owner skips the rules otherwise), with a rule
that reads the facility setting the host sets (5.3). The plugin also filters in its queries. So a
site sees and enters only its own orders, and a bug in one query cannot show another site's.
pg-mem has no row-level security, so these rules are proved on real Postgres only.

## 8. The lab profile pack

A content pack that:

- needs the lab plugin bundle;
- creates the Reception, Lab Technician and Lab Manager roles with the plugin's capabilities;
- sets a layout that puts the Lab page first for those roles.

## 9. Order of work

1. CE clean-up (section 6): restore the Lab order form, move the lab-only code out. CE then works
   alone again.
2. CE host features (section 5), each proved with a small test plugin.
3. The lab plugin, in slices: reception and orders; results and review; release.
4. The lab profile pack.

Each step follows AGENTS.md section 6: UI, CLI where it applies, docs in en, fr and pt, mobile, and
the changelog.

## 10. Calls I made, for the operator to check

- No per-plugin Postgres role (operator 2026-11-23). Instead no SQL from plugins: declared table
  shapes, structured requests built by CE, additive-only upgrades (5.1, 5.2).
- Database and CE reads from plugin code run on the worker path (5.2).
- Patient register writes to CE before authorisation (5.2).
- The plugin seeds and edits its own lists, so it needs no profile pack (7.3).
- Its FHIR ids use their own namespace (7.3).
- Returns and redraws never reach CE; Task is not in its emit list (7.1, 7.3).
- Lab records slices 1b to 3 wrote into CE are left (6.3).
- One sidebar entry with tabs inside, as cdr-source does (5.5).

## 11. Left to the builder

- The plugin's table shapes.
- The statement timeout and the row cap for `db_select`.
- The worker or foreground choice for `invoke` (5.6).
- How the page's tabs are laid out, copied from cdr-source's tabs.
- Which CE tests and docs move with the code in 6.2.
- The exact list of column types and filter operators the structured requests allow.
