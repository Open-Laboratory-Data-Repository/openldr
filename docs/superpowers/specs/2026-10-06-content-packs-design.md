# Content packs: install a lab system's queries, value sets and register from the marketplace

Date: 2026-10-06. Status: design agreed in chat, awaiting spec review.
Spans CE (artifact type, installer, UI, CLI, docs), cdr-toolchain (pack source and build) and the
marketplace repo (the published bundle).

## 1. The user action that is broken today

A country cannot install the Mozambique viral load pack on its own. The pack exists only on one
developer's disk, in `openldr_ce/packs/disa/`, which git and Docker ignore. Installing it takes five
manual steps in a fixed order, and step 1 (creating the register source) has no CLI command, only a
raw `POST /api/facilities/import/sources` (`packs/disa/README.md`, "Import order").

Two goals, chosen by the operator on 2026-10-06:

1. A country installs a pack alone, without our repo and without the five steps.
2. The pack source has a safe home that is not the CE repo and not one disk.

The rule from 2026-09-30 still binds: content for one lab system never enters the CE repo
(AGENTS.md section 8). Core gets only the generic mechanism.

## 2. Evidence

| Fact | Proof |
|---|---|
| A marketplace bundle carries one payload file, covered by one hash in the signed manifest | `packages/marketplace/src/artifact-manifest.ts:51-52` (form and report payloads), `packages/cli/src/artifact.ts:35-39` (`PAYLOAD_FILE`) |
| The install route handles `form-template` and `plugin` only | `apps/server/src/marketplace-routes.ts:200-212` |
| The CLI install sends every bundle to the plugin installer | `packages/cli/src/market.ts:50-82` |
| The form-template installer is the pattern: verify, check approval, upsert, record, audit | `packages/bootstrap/src/form-artifact-install.ts:29-85` |
| `marketplace_installs.target_form_id` is NOT NULL and form-specific | `packages/db/src/schema/internal.ts:682-693`, migration `030_marketplace_installs` |
| Each pack step has shared import code | queries `packages/bootstrap/src/custom-query-transfer.ts:70`; terminology `ctx.loaders.resource` (`packages/cli/src/terminology.ts:28`); register source `packages/db/src/facility-register-sources.ts:155`; register rows `packages/bootstrap/src/facility-import.ts:681`; link-matching `packages/bootstrap/src/facility-link-matching.ts:37` |
| Creating a register source twice fails with "already exists" | `apps/server/src/facilities-routes.ts:1934-1955` |
| The facility import can report rows absent from the file instead of retiring them | `packages/bootstrap/src/facility-import.ts:116-121` (`onDeleted`, `onAbsent`) |
| SQL is checked SELECT-only before a custom query is stored | `packages/dashboards/src/sql-runner.ts:17` (`validateSelectSql`) |
| Publisher trust is pinned on first use; a different key later is refused | `packages/marketplace/src/trust.ts:14-18` |
| The marketplace repo is public and already holds signed bundles | `Open-Laboratory-Data-Repository/marketplace`, 5 plugin bundles, `index.json` |
| The index knows kinds `plugin`, `form-template`, `report-template`, `form`, `report`, `test-definition` | `packages/marketplace/src/index-json.ts:5` |
| No local branch claims internal migration 108 | checked all 9 local branches on 2026-10-06; main ends at `107_lab_order_drop_specimen` |

## 3. Decisions

| # | Decision |
|---|---|
| D1 | One new artifact type, `content-pack`. Its one payload file is `pack.json`, an ordered list of steps (operator, option 1 of 3). |
| D2 | The pack source lives in cdr-toolchain. The built, signed bundle lives in the marketplace repo (operator, option 1 of 3). |
| D3 | The marketplace repo stays public. A pack holds facility names, codes and areas plus SQL, and no patient data (operator). |
| D4 | Packs are signed by a separate publisher, "OpenLDR Content Publisher", with its own key. A lab can trust our plugins without trusting content, and a leaked content key cannot sign plugins (operator). |
| D5 | Names do not use "DISA", which is a product of LST. A pack's description may say which lab system its data comes from (operator). |
| D6 | No capabilities on a pack. Capabilities describe what plugin code may do at run time, and a pack runs no code. The install prompt lists the pack's steps instead. |
| D7 | Install checks every step before writing any. Then it applies steps in order. A failure halfway leaves earlier steps written and is fixed by installing again. |
| D8 | Every step is an upsert, so installing twice is safe. Rows dropped from a newer pack's register are reported, never retired. |
| D9 | No uninstall in version 1. "Detach" forgets the install record and leaves the content, as for form templates. |
| D10 | One pack per country. The first is `vl-reports-mz`, version `0.1.0`. |

## 4. Design: the pack

### 4.1 Manifest

- `type: 'content-pack'`.
- `payload: { kind: 'content-pack', packSha256, steps }`. `packSha256` is the SHA-256 of `pack.json`.
  `steps` is a summary, one entry per step: `{ kind, label, count }`, for example
  `{ kind: 'facility-register', label: 'Mozambique laboratories and POC sites', count: 311 }`. The
  build writes it from `pack.json`, and the installer refuses a pack whose summary does not match.
- `capabilities: []`.
- `readme` carries what the build left out and why (today's `build-summary.json`).
- The signature covers the manifest, so it covers `packSha256`, so it covers every step.

### 4.2 `pack.json`

```json
{
  "formatVersion": 1,
  "steps": [
    { "kind": "code-system", "resource": { "resourceType": "CodeSystem" } },
    { "kind": "value-set", "resource": { "resourceType": "ValueSet" } },
    { "kind": "facility-register", "url": "urn:openldr:mz:laboratories",
      "name": "Mozambique laboratories and POC sites", "code": "MZLABS", "csv": "..." },
    { "kind": "link-matching", "registerUrl": "urn:openldr:mz:laboratories" },
    { "kind": "custom-queries", "file": { } }
  ]
}
```

- Steps run in file order. The author orders them; the installer has no dependency rules.
- Each step body is the format its import already reads: a FHIR resource, the register CSV with the
  three source fields the sources route takes, and the custom-query export file unchanged.
- Five step kinds in format version 1. A pack whose `formatVersion` or any step `kind` this CE does
  not know is refused before anything is written, with "this pack needs a newer CE".
- A zod schema for `pack.json` lives in `@openldr/marketplace`, next to the manifest schema.

## 5. Design: installing

### 5.1 The installer

`createContentPackInstaller` in `@openldr/bootstrap`, modelled on `createFormArtifactInstaller`. The
marketplace route and the CLI both call it. It has `install(bundle, opts)`, `check(bundle)` (pass 1
only, for the CLI dry run), `detach(id, opts)` and `list()`.

### 5.2 Pass 1: check everything, write nothing

1. If the manifest names a publisher, verify the signature and that the parsed id and version match
   the signed payload, as the form installer does.
2. Check `sha256(pack.json) === payload.packSha256`, and that `payload.steps` matches `pack.json`.
3. Parse `pack.json` with its schema. Refuse unknown versions and kinds.
4. Parse each FHIR resource step as the terminology loader would.
5. Run `validateSelectSql` on every query in each `custom-queries` step.
6. Run each `facility-register` step through `importFacilities` as a preview (no `apply`).

Any failure stops the install with the step number and its error. Nothing has been written.

### 5.3 Pass 2: apply in order

| Step | Calls | Keyed on | On reinstall |
|---|---|---|---|
| `code-system`, `value-set` | `ctx.loaders.resource` | resource URL | replaced |
| `facility-register` | register source get-or-create, then `importFacilities` with `apply` and `onAbsent: 'report'`, driven as `runFacilitiesImport` drives it | register URL; rows on their code | rows updated or added |
| `link-matching` | `linkMatchingFacilityCodes` with `apply: true`, then the `facility-map-rebuild` job | register URL | runs again; existing matches stay |
| `custom-queries` | `importCustomQueries` with `replace: true` | query name | replaced |

- Register source get-or-create: look the URL up first. Create it only when absent. An existing source
  with the same URL is used as is.
- Each import writes the audit events it already writes, so every query, term and register change is
  traceable under its own entity.

### 5.4 Failure halfway

The steps cannot share one transaction: the register import runs as import runs and jobs. When step N
fails, steps 1 to N-1 stay written. The install record gets status `failed`, the failed step number and
the error. Installing again runs every step; the upserts make the second run safe.

### 5.5 The install record

Internal migration `108_marketplace_install_status`:

- `target_form_id` becomes nullable (a pack has no form).
- Adds `status text not null default 'installed'` (`installed` or `failed`).
- Adds `failed_step integer null` and `error text null`.

Existing rows keep `installed`. Postgres only (internal DB). Check again for a branch claiming 108
before adding it.

One row per pack: `kind: 'content-pack'`, `payload_sha256` = `packSha256`, publisher, source ref,
installed by.

### 5.6 Audit

- `marketplace.install` with `metadata: { type: 'content-pack', steps: <count>, status, failedStep? }`.
- `marketplace.detach` on detach.
- From the CLI, `actorName: 'cli'`.

### 5.7 Who can install

The existing marketplace manage permission (`MANAGE` on `/api/marketplace/install`), as for plugins.

## 6. Design: UI (`apps/studio`, Settings, Marketplace)

No new page. Changes to existing screens:

- `MarketplaceTabs.tsx`: the type filter gains "Content pack".
- `PackageDetail.tsx`: `content-pack` is installable. Where a plugin lists capabilities, a pack lists
  its steps as counts, for example "2 code systems, 2 value sets, 1 register (311 rows), link-matching,
  2 queries", from the manifest's signed `payload.steps`. The existing detail endpoint already returns
  the payload (`apps/server/src/marketplace-routes.ts:178`), so no new route is needed.
- `PayloadPreview.tsx`: a `content-pack` branch showing the same step list.
- `Marketplace.tsx`: the install confirm prompt shows the step list in place of capabilities. It stays
  a Dialog: it is a confirm prompt, which AGENTS.md section 5 allows.
- Installed tab: a pack row shows `installed`, or `failed at step N` with the error. Its `⋯` menu has
  "Install again" and "Detach".
- Install runs inside the request, behind the existing spinner. The 311-row register and link-matching
  take seconds.


## 7. Design: CLI

- `openldr market install <bundle-dir>` picks the installer by manifest type, as the route does.
  Today it sends every bundle to the plugin installer.
- `--dry-run` runs pass 1 and prints the steps. Nothing is written.
- Installing a pack that is already installed needs `--force`, matching `openldr query import`.
- `openldr market list` shows packs with their status.
- `openldr artifact pack` maps `content-pack` to `pack.json` (`packages/cli/src/artifact.ts:35`).
- The marketplace index schema gains the kind `content-pack` (`packages/marketplace/src/index-json.ts:5`).

## 8. Design: the pack source (cdr-toolchain) and publishing

- `packs/vl-reports-mz/` in cdr-toolchain, committed: `build.mjs`, `vl-queries.mjs`, `README.md`.
- `build.mjs` reads the v1 dictionary with SELECT only, as today, and writes `pack.json` and
  `manifest.json` to a git-ignored build folder.
- Renames, per D5:

| Today | New |
|---|---|
| `urn:openldr:disa:mz-laboratories` | `urn:openldr:mz:laboratories` |
| `urn:openldr:disa:poc-sites` | `urn:openldr:mz:poc-sites` |
| `urn:openldr:disa:link-sites` | `urn:openldr:mz:link-sites` |
| "DISA VL info", "DISA VL results" | "VL info", "VL results" |
| register code `MZDISALABS` | `MZLABS` |

  The v1 output column names inside the queries (`IsDisaPoc`, `IsDisaLink`) stay, because they copy
  v1's view columns on purpose.
- Description: "Viral load reports in the v1 layout, for data exported from DISA*Lab."
- Signing: `openldr artifact keygen` makes the "OpenLDR Content Publisher" key once. The private key
  stays with the operator, never in any repo. `openldr artifact pack` signs; `openldr artifact publish`
  copies the bundle into `marketplace/bundles/vl-reports-mz-0.1.0/`; `index.json` gets the entry.
- `openldr_ce/packs/README.md` points at cdr-toolchain. `openldr_ce/packs/disa/` is deleted once the
  pack is published and installed from the marketplace on the dev CE.
- The dev CE drops the old `urn:openldr:disa:*` value sets, register and the two "DISA VL" queries
  after the new pack installs. They exist only on the dev CE.

## 9. Docs

- Studio `apps/studio/src/docs/0.1.8/{en,fr,pt}/marketplace.md` and the web docs page: what a content
  pack is, what installing writes, why installing twice is safe, what a failed install means, what
  detach does and does not do, and `market install --dry-run`.
- The cdr-toolchain pack README: building, signing and publishing. Author work, not admin work.

## 10. Mobile

Check the package detail, the install confirm and the Installed tab at 375x812. Nothing is pinned to
the bottom edge, so the `vh` and `dvh` trap does not apply.

## 11. Testing

- `@openldr/marketplace`: `pack.json` schema (valid, unknown version, unknown kind); manifest accepts
  `content-pack`; index accepts the kind.
- `@openldr/bootstrap` installer on pg-mem: a full install writes every step; a second install changes
  nothing that was not changed; a bad SQL query fails pass 1 and writes nothing; a hash mismatch fails;
  a failure at step N records `failed` and N, and a second install completes; an existing register
  source is reused; a row dropped from the register is reported, not retired.
- Migration 108: test in the style of the other internal migrations, and update the pinned list in
  `migrations.test.ts`.
- Server route tests: install of a `content-pack` bundle; the detail response carries `payload.steps`.
- CLI: `market install` picks the installer by type; `--dry-run` writes nothing; `--force` gate.
- Studio: named test files for `PackageDetail`, `PayloadPreview`, `MarketplaceTabs` and the Installed
  tab only, never the whole studio suite.
- Live: build `vl-reports-mz` from the v1 dictionary, sign it, publish it to a local copy of the
  marketplace, install it from Settings, Marketplace on the dev CE, run both queries, install it again,
  and confirm nothing duplicated.

## 12. Out of scope

- Uninstall (D9).
- Telling a lab when a newer pack version is published.
- Dependencies between packs.
- Installing a large register in the background.
- A Tanzania pack. It would be its own id built from Tanzania's dictionary.

## 13. HONEST NON-PROOF at design time

- The register step driving `importFacilities` from an installer: the CLI does it today, but with run
  rows, previews and job enqueues that the installer must reproduce. This is the riskiest part.
- How long link-matching takes on a register of a few hundred rows inside one request.
- Mozambique codes on real data: the dev CE still has no Mozambique requests.
