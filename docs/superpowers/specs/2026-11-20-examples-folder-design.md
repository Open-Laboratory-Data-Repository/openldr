# Examples folder

Date: 2026-11-20. Status: draft, waiting on the operator.

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
(`targetId`, `formIds`). A form that exists on one install may be missing on another. The example
workflow must import into an empty install. Before it is written, the round trip is tested on the
rc.1 install: export a workflow with a mapping, import it into a clean install, send the payload.
What that shows decides whether the example uses no form, or ships the form beside it.

## The test

One test file, for example `examples/examples.test.ts` run by a package that already depends on
the schemas (bootstrap is the likely home). For each folder it reads every file and runs the
validation in the table. It fails if a folder has a file the table does not cover, so a new example
cannot skip the check.

What it proves: each file passes the same validation the import route runs. What it does not prove:
that the import screen in studio accepts it, or that a dashboard's queries return rows. Those need
a real install, and are checked once by hand when the examples are written.

## Docs

Each of the seven how-to guides in `apps/studio/src/docs` (en, fr, pt) gets one line after its
import step: "Examples you can import are in
[examples/<folder>](https://github.com/Open-Laboratory-Data-Repository/openldr/tree/main/examples/<folder>)."
The web docs get the same line where they describe importing. The link points at `main`.

## Left to the builder

- Where the test lives, and moving `formInput` so the test can reach it.
- The test catalog's minimum columns: not confirmed. Settle by running the import on a real file.
- The wording of each README, kept to the unslop rules.

## Definition of done

UI: none. CLI: none new; READMEs name the existing commands. Docs: en, fr, pt as above. Mobile: no
UI change. Changelog: run `pnpm make:changelog` after merging, though a `docs` and `test` slice
publishes nothing.
