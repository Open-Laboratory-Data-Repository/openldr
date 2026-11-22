# Examples folder

Date: 2026-11-20, updated 2026-11-22. Status: draft, waiting on the operator's approval.

## Why

A lab that installs with `--seedless` has no sample dashboard, workflow or form to start from. Seven
studio pages can import a file, but nothing tells the user what a valid file looks like. The
operator also wants to share working files with other countries, such as a workflow with its
mapping and the payload it takes.

Each how-to guide should say "examples can be found here" and link to a folder on GitHub.

## Goals

- One `examples/` folder at the repo root, one subfolder for each page that imports a file.
- Each subfolder holds one or two small files that import without change, and a README.
- Each guide for those pages links to its subfolder on GitHub, in en, fr and pt.
- A test pushes every example file through the same validation the import uses, so a format
  change fails the build instead of the user.

## Non-goals

- No download control inside studio. The operator chose a GitHub link only (2026-11-20).
- No new import feature. A single widget cannot be imported; its example is a dashboard with one
  widget.
- No import of a mapping on its own. A workflow export already carries its node's mappings.
- `samples/` stays where it is. Tests and scripts use it (`package.json`, `scripts/make-lab-sample.mjs`,
  `packages/forms/src/map/targets.test.ts` and others). Its README may point at it.

## Anti-goals

- An example that does not import. That is worse than no example.
- Real patient data, or a country's own codes, in an example (AGENTS.md section 8). Examples use
  made-up values and the standard code systems CE already ships.

## Approaches considered

- **A. Hand-written files, tested (chosen).** Covers every import page. Can drift from the built-in
  samples, which the test limits to format, not content.
- B. Files generated from the built-in samples by a script. Always matches the seeds, but only the
  dashboard and the workflows are seeded, so forms, queries and the rest would have none.
- C. Examples inside each guide's docs folder. Three language copies and a versioned path, so a
  harder link to give someone.

The operator chose A on 2026-11-20.

## What goes in each subfolder

| Folder | Files | Imported by | Validation the test calls |
|---|---|---|---|
| `dashboards/` | `lab-overview.dashboard.json` (from `packages/dashboards/src/samples/openldr-general.json`), `one-widget.dashboard.json` | Dashboard page, Import | `DashboardSchema` (`packages/dashboards/src/types.ts:187`) |
| `workflows/` | `ingest-lab-rows.workflow.json` with a Map to FHIR mapping, `payload.json`, `send.sh` (a `curl` to `/api/workflows/hooks/ingest` with `X-Webhook-Token`) | Workflows page, Import | `WorkflowSchema` (`packages/workflows/src/types.ts:58`), and the node's saved mapping schema (`map-to-fhir-service.ts:266`) |
| `forms/` | `lab-order.form.json` | Forms page, Import | `formInput` (`apps/server/src/forms-routes.ts:28`); move or export it if the test cannot reach it |
| `queries/` | `queries.json` in format `openldr.custom-queries`, version 1 | Query page, Import; `openldr query import` | `importCustomQueries` file schema (`packages/bootstrap/src/custom-query-transfer.ts:30`) |
| `facilities/` | `facilities.csv` with `national_code,name` | Facilities, Import; `openldr facilities import` | `parseFacilityCsv` (`packages/terminology/src/facility-csv.ts:309`) |
| `terminology/` | `value-set.json` (FHIR ValueSet), `terms.csv` with `code,display` | Terminology, Import; `openldr terminology import` | `importFhir` path and `parseTerminologyTerms` (`packages/terminology/src/terms-csv.ts:340`) |
| `test-catalog/` | `test-catalog.csv` | Test catalog, Import; `openldr test-catalog import` | `readCatalogImportFile` (`packages/bootstrap/src/test-catalog.ts:192`) |

Each README says: what each file shows, which page and menu item imports it, the CLI command where
one exists, and what the user should see afterwards.

## Workflow example and other installs

A workflow's Map to FHIR node names its target and, where used, its accepted forms by id
(`targetId`, `formIds`). The example workflow must import into an empty install. Settled from the
code on 2026-11-22, so no round-trip test on a real install is needed to decide it:

- **No form.** `formIds` is `[]`. A form id the install lacks stops every run with
  "form … not found" (`packages/bootstrap/src/map-to-fhir-service.ts:442`).
- **Target `lab-result`.** It is built into the code (`packages/forms/src/map/targets.ts:126`), so
  every install has it, seeded or `--seedless`.
- **Its own webhook path**, not `ingest`. The shipped Ingest workflow holds `ingest`, and webhook
  paths are claimed by one workflow (`WebhookPathClaimedError`, `packages/workflows/src/index.ts:48`).
  `send.sh` posts to that path. The exact path is the builder's call.
- **No secret, and switched off.** The operator chose this on 2026-11-22. Anything in the repo is
  public, so a shipped secret would give every importing lab an endpoint anyone can post to. The
  file has no secret and `"enabled": false`. Import would otherwise turn it on
  (`apps/studio/src/workflows/WorkflowList.tsx:81`), and a webhook with no secret answers 401
  (`apps/server/src/workflows-routes.ts:663`). The README says: set a secret on the webhook step,
  turn the workflow on, then run `send.sh` with that secret in an environment variable, never
  written into the file.
- **It stores what it maps**, as the shipped Ingest does. The operator chose this on 2026-11-22:
  the point is a working pipeline to share. Its steps match Ingest: webhook, Map to FHIR, Persist
  store, a Log on persisted and a Log on held. `payload.json` uses an obviously made-up patient,
  such as surname `Example` and an identifier starting `EXAMPLE-`. The README says to try it on a
  test installation, as the in-app Ingest walkthrough does.

## The test

**Correction, found by the builder check on 2026-11-22.** The table's checks for dashboards,
workflows and forms are not what studio runs. Studio reshapes those files in the browser before
the server checks them:
- Dashboard: studio adds the `id` that `DashboardSchema` requires (`apps/studio/src/dashboard/io.ts:61`).
- Workflow: studio adds the `id` that `WorkflowSchema` requires (`WorkflowList.tsx:76`).
- Form: studio wraps the file as `{ name, schema, ... }` before `formInput` sees it
  (`apps/studio/src/pages/Forms.tsx:179-185`).

So the test runs in two places (my call, 2026-11-22):
- **In studio**, for dashboards, workflows and forms. It calls studio's own reshaping code, then
  the schema. A copy of the reshaping inside a test could drift, which is the failure this test
  exists to catch. If that code is not exported as a function today, the builder lifts it out
  without changing what it does.
- **In bootstrap**, for queries, facilities, terminology and the test catalog, calling the
  functions in the table.

For the **test catalog**, reading the file proves little: `readCatalogImportFile` only reads the
table and suggests columns (`packages/bootstrap/src/test-catalog.ts:192-200`). The test also runs
the column-mapping step with the suggested columns accepted (my call).

For **terminology**, terms import into a code system the user picks first
(`apps/server/src/terminology-admin-routes.ts:198-205`). The README starts with "create or pick a
code system", which is the page's own first step (my call).

Together the two test files fail if any `examples/` folder holds a file neither covers, so a new
example cannot skip the check.

What it proves: each file passes the same validation the import route runs. What it does not prove:
that the import screen in studio accepts it, or that a dashboard's queries return rows. Those need
a real install, and are checked once by hand when the examples are written.

## Docs

Each of the seven how-to guides in `apps/studio/src/docs` (en, fr, pt) gets one line after its
import step: "Examples you can import are in
[examples/<folder>](https://github.com/Open-Laboratory-Data-Repository/openldr/tree/v<version>/examples/<folder>)."
The web docs get the same line where they describe importing.

**The link points at the running version's tag, not `main`.** The operator chose this on
2026-11-22. A lab runs a release, and a format change on `main` would hand it an example that
does not import, which is the first anti-goal. The cost: examples added after a release appear
only from the next one.

Neither docs renderer fills in a version today. Both know their own: studio's
`apps/studio/src/docs/version.ts:8` and web's `apps/web/src/docs/content.ts:42`, each from
`__APP_VERSION__`. The builder adds one placeholder that the markdown link uses, replaced at render
with that version. In studio that is the lab's installed version. On the public web docs it is
the site's build, which is the latest release.

Consequences, accepted:
- A release before the one that ships `examples/` has no such folder at its tag. That is fine,
  because its guides do not have the link either.
- A development build whose version has no tag yet links to a page that does not exist. Labs run
  releases only, so this is not fixed.

## Left to the builder

- Where the test lives, and moving `formInput` so the test can reach it.
- The placeholder's spelling, and the one place in each renderer that replaces it.
- The example workflow's webhook path.
- The test catalog's minimum columns: not confirmed. Settle by running the import on a real file.
- The wording of each README, kept to the unslop rules.

## Definition of done

UI: none. CLI: none new; READMEs name the existing commands. Docs: en, fr, pt as above. Mobile: no
UI change. Changelog: run `pnpm make:changelog` after merging, though a `docs` and `test` slice
publishes nothing.
