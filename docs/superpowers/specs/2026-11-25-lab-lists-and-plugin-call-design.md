# The lab's own lists, and a CLI command that calls a plugin action

Date: 2026-11-25. Small project in two repos: the lab plugin (lists) and CE (one CLI command).
Approved by the operator on 2026-11-25 (batch 3, item A2).

## Why

- The lab plugin seeds 4 return reasons and 10 sample conditions (`seeds/lists.json`), and nothing on
  screen edits them. A lab cannot add a reason it uses, or retire one it does not.
- The Receive sheet offers every active condition for any sample type, so a urine sample is offered
  "Clotted" and "Hemolyzed". The operator asked for conditions per sample type.
- AGENTS.md section 6 wants admin settings on the CLI. CE has no command that calls a plugin action,
  so no plugin setting (not even the existing self-authorise switch) has a CLI today.

Corlix has nothing to port: its condition is a fixed list of 7 in the page
(`apps/desktop/src/renderer/pages/OrderDetailPage.tsx:989-995`), not editable, not per type.

## Goals

- The Lab page's Settings tab lists the return reasons and sample conditions, and a holder of
  `lab.settings` with no facility limit adds, edits and turns off their items.
- A sample condition can name the sample types it applies to. The Receive sheet then shows only the
  active conditions linked to the picked type, or linked to no type.
- `openldr plugin call <plugin> <action>` runs one plugin action through CE's broker, as the page
  calls it, so every plugin setting has a CLI.

## Non-goals

- Reject reasons stay CE's (`urn:openldr:valueset:order-reject-reason`), edited on CE's Terminology
  page.
- No delete. A stored sample or return keeps its code; turning an item off hides it from the desk
  and keeps old records readable.
- No new seeds and no seeded type links: a link would hardcode SNOMED codes in the plugin
  (AGENTS.md section 8). The lab sets its own links.

## Approaches

One sensible way, chosen: a nullable `sample_types` column on the plugin's `lists` table (additive,
which plugin upgrades allow), and two plugin entrypoints. A separate link table was considered and
dropped: it adds a table and joins for a list of a few items.

For the CLI, one generic command in CE, not a command per plugin: CE cannot know each plugin's
actions, and the broker already checks each action's permission.

## Plugin

- `lists` gains `sample_types` (jsonb, nullable): a list of `{ system, code }`. Empty or null means
  every type. Only `sample-condition` items use it; a return reason with types is `invalid`.
- `lab_list_items` (`lab.settings`): every item of both plugin lists, inactive ones too, with
  `sampleTypes`, for the Settings tab.
- `lab_list_item_save` (`lab.settings`): `{ list, code, display: { en, fr, pt }, sort, active,
  sampleTypes? }` adds or changes one item and writes an audit row. A caller with a facility limit
  is `refused`, as for the other lab settings. `code` cannot change once saved (it is the key).
  `list` must be `return-reason` or `sample-condition`. Each sample type must be in CE's
  `urn:openldr:valueset:specimen-type` expansion.
- `lab_lists` (the desk's read) adds `sampleTypes` to each sample condition.
- The Receive sheet filters the condition picker by the picked sample type.

### The Settings tab

A "Lists" area under the existing switch, copied from studio conventions (AGENTS.md section 5):

```
Return reasons                                   [⋯ Add]
  Code              Name               Order  Status   [⋯]
  clerical-mistake  Clerical mistake   1      Active   Edit / Turn off
  ...                                            < 1 2 >
Sample conditions                                [⋯ Add]
  Code   Name        Sample types     Order  Status    [⋯]
  HEM    Hemolyzed   Whole blood      6      Active
```

Edit and Add open a Sheet (label left, input right): Code (read-only after save), Name in English,
French and Portuguese, Order, Active, and for conditions the Sample types (a multi-pick from CE's
specimen types; none picked means every type). Save and Cancel are in the sheet's ⋯ menu. Every
table has pagination. Results show in toasts. Text in en, fr and pt. Works at phone width.

## CE: `openldr plugin call`

`openldr plugin call <plugin> <action> [--input <json>] [--json]` invokes one entrypoint through
the plugin broker (`invoke` op), prints the answer, and exits 1 when the answer is an error.

- A local run is the machine's operator: every capability in the catalog (CE and installed plugins'
  keys), no data limit, audited through `cliActor()`.
- A served run is the signed-in caller, with their own capabilities and data limit
  (`served-caller.ts`), so the broker's action gate decides as it does for the page.
- Docs: the CLI reference (en, fr, pt), and the lab guide shows the lists commands.

## Proof

- Plugin: `cargo test` for both entrypoints (refusals, code fixed, types checked, audit row), the
  desk read's types, UI tests for the Lists area and the Receive filter, the live check on the dev
  stack calling both entrypoints.
- CE: CLI tests for a local and a served call, an error answer's exit code, and the audit row.

## Left to the builder

- The served-mode capability key in `command-meta.ts` for `plugin call` (the broker still checks
  each action's own permission).
- Exact wording in fr and pt, and the column widths at phone size.
