# Plugin connector approval, and a results read for plugins

Date: 2026-11-26. Asked for by Codex for the DHIS2 plugin. The operator chose to have Claude decide
the open details, with Codex correcting the design. Build after 0.1.13 ships.

## Why

Codex's DHIS2 plugin needs two things CE does not give a plugin today:

1. To send to DHIS2 through a connector an admin approved for that plugin, without the plugin ever
   holding the DHIS2 password.
2. To read released lab results, limited to the facilities the signed-in user may see.

## What CE does today (checked 2026-11-26)

- **Approval exists, for imports only.** Connectors > Plugin access (`ConnectorPluginAccessSheet.tsx`)
  lists import plugins and lets an admin switch each on for a database connector. The CLI has
  `openldr import allow|revoke|allowed` (`packages/cli/src/program.ts:185-193`). The broker checks it
  for every `import.*` call (`plugin-broker.ts:641-651`, `import-run.ts:663`).
- **The `connectors.*` page calls have no per-plugin approval.** Any plugin holding `host:connectors`
  may list, test, read metadata from, validate against and push to any connector, when a lab admin is
  signed in (`plugin-broker.ts:286`, `:327`). That gate is looser than the import one.
- **`connectors.push` already sends both aggregate data and tracker events** through the connector's
  own DHIS2 sink, with the credentials decrypted on the server and the connection pinned to the
  connector's host (`dhis2-orchestration.ts:123`, `:158`; `connector-target.ts`).
- **A plugin's own code gets no connector.** `invoke` passes only the caller and the host functions
  (`plugin-broker.ts:581-583`). Workflow nodes already get a connector's config and a pinned host
  (`plugin-node-service.ts:105`), so the pattern exists.
- **No results read.** `ce_read` answers patients, value sets, the test catalog, facilities and the
  caller (`plugin-host.ts:109-112`). The facility limit for results exists in the dashboard builder:
  `scopeCondition('result', …)` in `packages/dashboards/src/scope.ts`.

## Decisions (Claude's calls; Codex corrects)

1. **One approval for every connector use.** Widen Connectors > Plugin access from import plugins to
   any plugin that declares `host:connectors` or `host:import`. The broker then refuses every
   `connectors.*` call naming a connector not switched on for that plugin, and `connectors.list`
   answers only the approved ones. This closes the looser gate as well as serving the DHIS2 plugin.
   It changes behaviour for plugins that use connectors today: an admin must switch them on once.
   No lab has a plugin installed yet, so nothing in the field breaks. The CLI's `import allow`,
   `revoke` and `allowed` keep their names and cover the same list, through shared code in
   `@openldr/bootstrap`.
2. **Core stays product-neutral.** Core holds no DHIS2 (or any other product's) logic: no endpoints,
   payloads, mapping or periods. Those live in the plugin. The operator set this rule on 2026-11-26:
   otherwise core would need code for every product a lab connects to.
3. **A plugin's own code may use an approved connector.** `invoke` takes an optional `connectorId`.
   The broker checks the approval from decision 1, then passes the connector's decrypted settings and
   its one host as `allowedHosts`, as workflow nodes already get them (`plugin-node-service.ts:105`).
   The plugin must also declare `net-egress`, and the egress switch (`PLUGIN_EGRESS_ENABLED`) still
   applies. A database connector is refused, and is offered to import plugins only in the approval
   list: CE runs their read-only SELECTs itself, so a database password never reaches plugin code. If
   the code puts a secret setting (a password, token or key) in its answer, the broker withholds the
   answer. The operator asked on 2026-11-26 whether a plugin could delete CE's database through a
   connector; it cannot, and this closes the one leak the check found. The page never sees the settings. Every such call is audited with the connector id. This
   is generic: core does not know what the connector talks to.
4. **"Released" means a result whose status is `final`, `amended` or `corrected`.** Preliminary,
   registered, cancelled and entered-in-error results are not returned.
5. **The results read.** Two `ce_read` ops, under the existing `host:ce-read` capability like the
   patient, value set and facility reads, for a caller who holds `reports.view_issued`:
   - `results.list`: filters `since` and `until` (result time), `pluginRef` (the patient, as this
     plugin's own reference), `observation` (code), and a page of up to 200 with a key to read the next
     page. Pages are ordered by when CE stored the result, then id, so they never shift or repeat. Result
     time cannot order them: the dev warehouse holds released results with no result time.
   - `results.get`: one result by id, or not found.
   - Both apply the signed-in user's data limit with the dashboard rule (requesting facility or
     testing lab), so a plugin can never read past what its user could.
   - Fields per result: id, request id, patient id, observation code, system and name, value (number
     with units and comparator, or code, or text), abnormal flag, status, result time, specimen id,
     and the requesting facility code. The patient is this plugin's own lasting reference (ruling 11),
     never CE's id; the plugin reads names through `patients.get`, which has its own masking and audit.
     The testing lab is not given: a request can have several reports, so it has no one lab.
   - A list is audited as one row with the count, like `patients.search`.

## Not in this design

- No change to how admins create connectors.
- **Existing DHIS2 code in core is a separate, later task.** Core already holds DHIS2-specific code:
  `packages/dhis2`, `packages/bootstrap/src/dhis2-orchestration.ts` (behind `connectors.push`), DHIS2
  tables (internal migrations `008`, `009`, `022`) and the sink in `wasm/dhis2-sink`. Moving it out into
  the DHIS2 plugin is its own design. This work adds nothing to it, and new DHIS2 work goes in the
  plugin, not in `wasm/dhis2-sink`.

## Open for Codex

- Does the DHIS2 plugin's wasm have what it needs from `invoke` with a connector: the settings it
  reads (base URL, user, password or token) and one pinned host?
- Are the result fields above enough?
