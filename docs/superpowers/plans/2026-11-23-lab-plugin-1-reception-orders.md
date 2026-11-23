# Lab plugin, plan 1: the repo, Reception and Orders

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed lab plugin, `openldr-ce-plugin-lab` (plugin id `lab`), that installs on CE and gives a "Lab" page with a Reception tab and an Orders tab. The desk and the sites take orders, receive samples, return and reject in the plugin's own tables. Nothing goes to CE's FHIR store yet, apart from a new patient.

**Architecture:** Rust compiled to WebAssembly holds the rules. It reads and writes its own tables through CE's host functions (`db_select`, `db_write`). It reads patients, the test catalog, facilities and value sets through `ce_read`. A React page, built like cdr-source's from copied studio components, calls the plugin's actions through the broker. CE gains one read op, `caller.get`, so plugin code knows who is acting.

**Tech stack:** Rust (wasm32-wasip1, extism-pdk, serde_json, sha2), React 18 with copied shadcn components, esbuild, vitest; CE side TypeScript, vitest, pg-mem.

**Spec:** `docs/superpowers/specs/2026-11-23-lab-plugin-design.md`, sections 7 and 9 (step 3, first slice "reception and orders"). Host functions: `apps/web/src/docs/0.1.8/en/plugin-host-functions.md` and `plugin-permissions.md`.

## What exists, checked 2026-11-23

- The CE Reception code this plan ports is in git at `28762d534`:
  - `packages/bootstrap/src/lab-reception.ts:46-175` holds the order, patient search, register and receive shapes and rules.
  - `packages/bootstrap/src/lab-rejection.ts:35-56` holds return, mark corrected, reject sample, reject test and link redraw.
  - `apps/studio/src/lab/*Sheet.tsx` and `apps/studio/src/pages/Reception.tsx` are the screens.
- Fix `17b4726`: a received sample links only the live tests whose catalog sample types include its type. A test with no catalog sample type is not linked. A rejected sample type cannot be received again on that order; a new sample comes in on a redraw order.
- CE host ops today (`packages/bootstrap/src/plugin-host.ts:89-92`):
  - `patients.search`, `patients.get` and `patients.register`;
  - `valueset.expand` and `valueset.lookup`;
  - `testCatalog.list`, `testCatalog.get` and `facilities.search`.
- **Gap, confirmed:** plugin code never learns who the caller is. CE uses the caller only for its own audit (`plugin-host.ts:148`), and the page is not trusted for "received by". So Task 1 adds `caller.get`.
- The catalog's `CatalogTest` (`packages/bootstrap/src/test-catalog.ts:61-75`) carries `specimenTypes` and `lab.specimenTypes`. When `lab.specimenTypes` is not null it wins.
- CE keeps the rejection reason value set `urn:openldr:valueset:order-reject-reason`. The CE Lab order form uses it (`110_lab_order_rejection.ts:212`).
- cdr-source (`/home/fredrick/Projects/Repositories/openldr-ce-plugin-cdr-source`) is the repo pattern:
  - `Cargo.toml` with `crate-type = ["cdylib", "rlib"]` and extism-pdk on wasm only;
  - `scripts/build.mjs` builds and stages `dist/`;
  - `ui/` with its own `package.json`, `src/sdk.ts` and copied components.
- The Rust host wrappers are `wasm/openldr-plugin-sdk/src/host.rs` in CE. The test plugin `wasm/test-sink` shows the entrypoint shape.

## How Corlix does it

- **Create an order.** `apps/desktop/src/main/orders.ts:185-240` saves an order and its tests in one transaction, with status `ORDERED` on both. The number is generated: `facility-time-random` (`:146-150`).
- **Receive.** At `:294-314`, receiving sets the order and every test to `SPECIMEN_RECEIVED`.
- **List orders.** At `:152-175`, the list filters by status, patient and a free-text query, newest first, with a limit.
- **Sample suggestion.** `apps/desktop/src/renderer/lib/specimenMatch.ts` picks a sample only on one clean match, and otherwise suggests.
- **Not ported.** Corlix keeps one sample type per order and a generated number. CE kept the lab's paper requisition number and many samples per order (slices 2 and 3), and this plan keeps the CE way.

## Rulings

1. **One plugin, id `lab`.** The folder and repo are `openldr-ce-plugin-lab`, and the version is `0.1.0`. The plugin claims the permission group `lab`. Stored `lab.*` grants from step 1 come back to roles that still hold them.
2. **Permissions in this plan:**

   | Key | Label | What it opens |
   |---|---|---|
   | `lab.receive` | Receive samples | Reception tab |
   | `lab.reject` | Reject and return | the return and reject actions |
   | `lab.orders.enter` | Enter orders | new order, and correcting a returned order, in the Orders tab |
   | `lab.worklist.view` | View lab orders | Orders tab |

   `lab.orders.enter` is new beside the spec's table. Without it, the spec's "a site user corrects a returned order" would be a write under a view permission. Results, review and settings keys come in later plans. The group grows by adding keys.
3. **Actions and their permissions.** Any one listed key is enough. No other entrypoint exists, so everything else is closed.

   | Entrypoint | Needs any of |
   |---|---|
   | `health_check` | `lab.worklist.view`, `lab.receive`, `lab.orders.enter` |
   | `lab_me` | `lab.worklist.view`, `lab.receive`, `lab.orders.enter`, `lab.reject` |
   | `lab_lists` | `lab.worklist.view`, `lab.receive`, `lab.orders.enter`, `lab.reject` |
   | `lab_facilities_search` | `lab.receive`, `lab.orders.enter` |
   | `lab_tests_search` | `lab.receive`, `lab.orders.enter` |
   | `lab_patients_search` | `lab.receive`, `lab.orders.enter` |
   | `lab_patient_register` | `lab.receive`, `lab.orders.enter` |
   | `lab_orders_find` | `lab.receive`, `lab.worklist.view` |
   | `lab_orders_list` | `lab.worklist.view` |
   | `lab_order_get` | `lab.worklist.view`, `lab.receive` |
   | `lab_order_register` | `lab.receive`, `lab.orders.enter` |
   | `lab_order_correct` | `lab.receive`, `lab.orders.enter` |
   | `lab_order_cancel` | `lab.receive` |
   | `lab_sample_choices` | `lab.receive` |
   | `lab_sample_receive` | `lab.receive` |
   | `lab_order_return` | `lab.reject` |
   | `lab_order_mark_corrected` | `lab.orders.enter`, `lab.receive` |
   | `lab_sample_reject` | `lab.reject` |
   | `lab_test_reject` | `lab.reject` |
   | `lab_redraw_link` | `lab.receive` |

4. **Manifest capabilities:** `host:db`, `host:ce-read`, and `emit-fhir` for `Patient` only. `patients.register` needs `Patient`. The other FHIR types join in plan 2, when authorisation sends records. Nothing else reaches CE in this plan.
5. **The page.** `ui.nav` is `{ "label": "Lab", "icon": "flask-conical", "section": "apps" }`, and `ui.requiredCapabilities` lists the four keys. Each tab shows only when the user holds one of its keys, read from the init context. The broker remains the real check.
6. **Ids are fixed**, so a retry updates. Each id is the lowercase hex sha256 of the parts joined by `|`:
   - order: `lab|order|<facilityId>|<requisition>`;
   - test: `lab|test|<facilityId>|<requisition>|<system>|<code>`;
   - sample: `lab|sample|<facilityId>|<requisition>|<system>|<code>`.

   The requisition is trimmed and upper-cased first. One requisition number may exist once per facility.
7. **States.**
   - Order: `ordered`, `received` (any sample received), `returned`, `cancelled`.
   - Test: `ordered`, `received`, `rejected`, `cancelled`.
   - Sample: `received`, `rejected`.

   A returned order refuses receive until it is marked corrected. A cancelled order refuses everything, and its number may be registered again: the register overwrites it.
8. **Lists.**
   - Return reasons and sample conditions are the plugin's own lists. They are seeded from `seeds/lists.json` the first time any action reads them, using fixed keys and insert-if-missing.
   - Seed values come from CE's old migration 137 at `28762d534`, lines 42-59. Return reasons are clerical-mistake, form-incomplete, form-unreadable and wrong-patient-details. Sample conditions are the 10 codes of HL7 v2 table 0493 listed there. Each seed has display text in en, fr and pt.
   - Reject reasons are read live from CE, with `valueset.expand` on `urn:openldr:valueset:order-reject-reason`. They are not copied, so that in plan 2 the codes CE receives match CE's own rejection counts.
   - Editing the lists comes with the Settings tab in a later plan.
9. **Who did it.** Every write records `by_id` and `by_name` from `caller.get`, never from the page. An `audit` row is written in the same `db_write` request as the change.
10. **A site user** is limited to their facility, and every plugin table except `lists` names its facility column. CE adds the facility filter and forced row-level security, so a site user sees and enters only their own facility's orders. The desk, with no data limit, sees all of them.
11. **The Rust host layer is copied.** `src/host.rs` is copied from CE's `wasm/openldr-plugin-sdk/src/host.rs`, with a header line naming the source commit, as cdr-source copies studio components. It is not a path dependency. Rules sit behind a `Host` trait, so `cargo test` runs them against an in-memory fake.

## Global constraints

- Repo at `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab`, a new local git repo on `main`, with work on branch `feat/reception-orders`. No GitHub remote until the operator says.
- CE work (Task 1) goes in an openldr_ce worktree on branch `feat/plugin-caller`. It merges and pushes only on the operator's yes. The plugin's live proof needs it on the install it runs on.
- No em dashes and no emoji in headings or bullets. Strings and docs in en, fr and pt. No `Co-Authored-By` trailer.
- Page rules: AGENTS.md section 5 rules hold inside the plugin page:
  - actions in a `⋯` menu;
  - sheets, not dialogs;
  - label-left forms;
  - `StripedEmpty` and `LoadingState`;
  - `TablePagination` on every table;
  - results in sonner toasts.

  It also must not need `h-screen`, and must work at 375 px width.
- A live run uses its own data folder with `OPENLDR_SKIP_ENV_FILE=true`, or a throwaway Postgres. Never touch the dev databases.
- Never use ports 3000, 5433, 3210, 3212, 3213, 3220, 54320, 54331, 54332 or 54340. 3220 is updated only in Task 8, from the merged CE build.
- The CE gate for Task 1:
  - `pnpm turbo run test --force --concurrency=2 --continue`;
  - `pnpm turbo run typecheck --force --concurrency=2`;
  - `pnpm --filter @openldr/server lint`.

  Never pipe turbo through `tail`.
- The plugin gate: `cargo test`, `cargo build --release --target wasm32-wasip1`, and `pnpm --dir ui test` and `typecheck`.

## Review focus

1. A site user limited to facility A types facility B's requisition into Orders, or sends a crafted `lab_order_get` for B. They get not found, never B's order (Task 3, Task 7).
2. The same requisition number at two facilities gives two orders, and Reception shows both with their facility (Task 3).
3. A double submit of register, receive or reject leaves one row per fixed id, not two, and the second answer is the same order (Task 3).
4. A sample of a type no ordered test takes links no test, and the desk is told so. It is not silently attached to everything (Task 4).
5. "Received by" shows the signed-in user even when the page sends another name in its input (Task 1, Task 4).

---

### Task 1: CE `caller.get` (openldr_ce)

**Files:**
- `packages/bootstrap/src/plugin-host.ts`: add `'caller.get'` to `CE_READ_OPS`, and an op that returns `{ userId, displayName, facilities }` from the caller passed by the broker. `facilities` is `'*'` or the id list. No input is accepted (`{}` or none).
- `packages/bootstrap/src/plugin-host.test.ts`;
- `wasm/openldr-plugin-sdk/src/host.rs`: a `pub fn caller() -> Result<Value, HostError>` that wraps `ce_read("caller.get", {})`;
- web docs `apps/web/src/docs/0.1.8/{en,fr,pt}/plugin-host-functions.md`: one row in the ce_read table.

The op needs `host:ce-read` only, since it tells the plugin nothing its caller could not see.

- [ ] **Tests:** a limited caller gets its facility list; an unlimited caller gets `'*'`; the name comes from the session even when the op input carries a `displayName` field (the input is refused as invalid); a plugin without `host:ce-read` is refused.
- [ ] **Gate,** then commit `feat(plugins): plugin code can ask who is calling`. Ask the operator before merging.

### Task 2: The repo, the manifest, tables and seeds

**Files (new repo):**
- `Cargo.toml` (crate `lab`, version `0.1.0`, deps `serde_json`, `sha2`; extism-pdk on wasm only), `rust-toolchain.toml` copied from cdr-source.
- `src/lib.rs`, `src/host.rs` (ruling 11), `src/store.rs`.
- `manifest.template.json`.
- `seeds/lists.json`.
- `scripts/build.mjs`, adapted from cdr-source: id `lab`, ui entry `ui.html`.
- `README.md`, `.gitignore`.

`Host` trait: `db_select(&Value) -> Result<Value, HostError>`, `db_write(&Value) -> Result<Value, HostError>`, `ce_read(&str, Value) -> Result<Value, HostError>`, `caller() -> Result<Caller, HostError>`. `WasmHost` implements it with the host calls. `tests/fake_host.rs` implements it in memory, with the facility filter of rule 10.

Tables, in the manifest's `payload.tables` (schema `plugin_lab`). Type names come from CE's `COLUMN_TYPES`.

| Table | Columns | Key | Facility column |
|---|---|---|---|
| `orders` | id text, facility uuid, facility_name text, requisition text, origin text (`desk`, `site`), patient_id text, patient_display text, priority text null, clinician text null, note text null, status text, returned jsonb null, created_at timestamptz, updated_at timestamptz, by_id text, by_name text | id | facility |
| `order_tests` | id text, order_id text, facility uuid, system text, code text, display text null, specimen_types jsonb, status text, rejection jsonb null | id | facility |
| `samples` | id text, order_id text, facility uuid, type_system text, type_code text, type_display text null, condition jsonb null, received_at timestamptz, by_id text, by_name text, status text, rejection jsonb null | id | facility |
| `sample_tests` | sample_id text, test_id text, facility uuid | sample_id, test_id | facility |
| `redraws` | id text, facility uuid, focus text, replaced_by text null, status text | id | facility |
| `lists` | list text, code text, display jsonb, active boolean default true, sort integer | list, code | none |
| `audit` | id text, facility uuid, entity text, entity_id text, action text, detail jsonb, at timestamptz, by_id text, by_name text | id | facility |

`order_tests.specimen_types` stores the test's sample types, taken from the catalog when the order is registered. Later catalog edits do not move tests that were already ordered.

- [ ] **Tests (cargo):** fixed ids match ruling 6 for a known input (write the expected hex in the test); seeding twice gives each list row once; a seed run that loses a duplicate-key race still answers the list.
- [ ] **Build:** `node scripts/build.mjs` stages `dist/manifest.json`, `plugin.wasm` and `ui.html`, with the sha256 filled in. CE's manifest parser accepts the staged manifest. Run a small node script in `scripts/` that imports `@openldr/marketplace` from the CE checkout, and say which checkout.
- [ ] **Commit** `feat: the lab plugin repo, its tables and seeded lists`.

### Task 3: Orders and patients (Rust)

**Files:** `src/orders.rs`, `src/patients.rs`, `src/lists.rs`, and `src/actions.rs` with one function per entrypoint. `src/lib.rs` holds the `#[plugin_fn]` wrappers, each taking JSON in and giving JSON out. Errors use `{ "error": { "code", "message" } }` with codes `not_found`, `conflict`, `invalid` or `refused`.

Behaviour follows `28762d534:packages/bootstrap/src/lab-reception.ts`, with these shapes:
- `Order` mirrors `ReceptionOrder` (`:46-72`). It has requisition, facility `{ id, name }`, origin, patient, priority, clinician, note, status, `tests[]`, `samples[]`, `returned` and `redraws[]`. Ids are the plugin's own, not FHIR ids.
- **`lab_patients_search`** takes `{ identifier }` or `{ given, family, birthDate }` and calls `patients.search`. CE applies the strong match for a find-only user. The plugin also refuses anything else with `invalid`, so the desk never browses.
- **`lab_patient_register`** maps `RegisterPatientInput` (`:117-125`) to a Patient and calls `patients.register`.
  - An age without a birth date sets the 1 January estimate with the extension `urn:openldr:ext:birthdate-estimated`, as CE did.
  - `managingOrganization` is the chosen facility.
- **`lab_order_register`** takes `{ requisition, facilityId, patientId, tests[{system, code}], priority?, clinician?, note? }`.
  - Each test is checked with `testCatalog.get`. It must exist and be `lab.enabled`.
  - `origin` is `site` when the caller is facility-limited, otherwise `desk`.
  - An existing live order with the same id is a `conflict`. An existing cancelled one is overwritten.
- **`lab_order_correct`** may change only priority, clinician, note or patient (`:86-92`), with a reason that goes into audit.
- **`lab_order_cancel`** sets the order and its live tests to `cancelled`, with a reason.
- **`lab_orders_find`** takes `{ requisition }` and returns the orders at every facility the caller may see.
- **`lab_orders_list`** takes `{ facilityId?, status?, q?, limit (1-100, default 25), offset }`, newest first by `created_at` and then `id`. `q` matches a requisition prefix. The answer is `{ rows, total }`.
- **`lab_order_get`** takes `{ orderId }`. It returns `not_found` for an order outside the caller's facilities. The store filter gives that, and the action must not tell it apart from a missing order.
- **`lab_me`** returns `caller()` plus the lists. **`lab_lists`** returns the lists, with reject reasons from `valueset.expand`.
- **`lab_facilities_search`** and **`lab_tests_search`** pass through to `facilities.search` and `testCatalog.list` (with `enabled: true`, `status: 'active'`).

- [ ] **Tests (cargo, fake host):**
  - Review focus 1, 2 and 3.
  - Register refuses a disabled test and an unknown test.
  - A cancelled number registers again.
  - Correct refuses changing tests or facility.
  - The list pages with a stable order when two orders share a `created_at`.
  - The search refuses a name without a full birth date.
  - The audit row carries the caller's name.
- [ ] **Commit** `feat: orders and patients`.

### Task 4: Samples, return and reject (Rust)

**Files:** `src/samples.rs`, `src/returns.rs`, `src/rejects.rs`, and the matching functions in `actions.rs`. Behaviour follows `lab-reception.ts` receive (`:127-136`) and `lab-rejection.ts` (`:35-55`), plus fix `17b4726`.

- **`lab_sample_choices`** takes `{ orderId }` and returns the union of the live tests' stored `specimen_types`.
- **`lab_sample_receive`** takes `{ orderId, type{system,code,display?}, conditionCode?, testIds?, receivedAt? }`.
  - Left out, `testIds` means every live test whose stored types include this type.
  - When no test matches, it is refused with `invalid`, and the message names the order's sample types.
  - A rejected sample of this type gives `conflict` ("register a redraw order").
  - A first receipt takes now, and a later one keeps the stored time unless `receivedAt` is sent.
  - The order becomes `received`, and so do the linked tests.
- **`lab_order_return`** takes `{ orderId, reasonCode, note? }`. It is refused on a desk-origin order (CE ruling 2), and sets `returned` and status `returned`.
- **`lab_order_mark_corrected`** takes `{ orderId, changes, reason }`. It applies the changes as correct does, clears `returned`, and sets status back to `ordered`, or to `received` when a sample exists.
- **`lab_sample_reject`** takes `{ sampleId, reasonCode, redraw }`. The sample becomes `rejected`, and each test it serves becomes `rejected` with the rejection. `redraw` adds a `redraws` row per test with status `requested`.
- **`lab_test_reject`** takes `{ testId, reasonCode, redraw }`. It rejects one test the same way.
- **`lab_redraw_link`** takes `{ orderId, replacesOrderId }`. It sets `replaced_by` on each requested redraw of the old order whose test code is on the new order, and marks those redraws `completed`. A redraw with no matching test stays `requested`.
- The reason code must be in its list: return reasons from `lists`, reject reasons from the expanded CE value set. Otherwise the call is `invalid`.

- [ ] **Tests (cargo):**
  - Review focus 4 and 5.
  - Sample linking per fix `17b4726`, including a test with no sample type staying unlinked.
  - A returned order refuses receive.
  - Return refuses a desk order.
  - Rejecting a sample rejects only the tests it serves.
  - A redraw link completes only matching redraws.
  - Every write adds one audit row.
- [ ] **Commit** `feat: receive, return and reject`.

### Task 5: The page shell and Reception tab (React)

**Files:**
- `ui/` copied in shape from cdr-source: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/main.tsx`, `src/sdk.ts`, `src/notify.ts`, `src/i18n.ts`.
- Components copied from CE studio `apps/studio/src/components/ui/`: only those used.
- `src/App.tsx`: tabs by capability from the init context, using the `data-[state=inactive]:hidden` guard.
- `src/api.ts`: typed wrappers, one per entrypoint, over `openldr.invoke`.
- `src/reception/`: `ReceptionTab.tsx`, `OrderPanel.tsx`, and the sheets ported from `28762d534:apps/studio/src/lab/`:
  - `RegisterOrderSheet`, `PatientSheet`, `CorrectOrderSheet`, `CancelOrderSheet`;
  - `ReceiveSampleSheet`, `ReturnOrderSheet`, `MarkCorrectedSheet`;
  - `RejectSampleSheet`, `RejectTestSheet`, `LinkRedrawSheet`.

  Calls to `/api/lab/*` become `api.ts` calls, and ids become plugin ids.

The Reception tab works this way:
- A requisition search box shows the matching orders, one per facility.
- When nothing is found, the desk can register at once, on the operator's 2026-11-23 point that the desk may know the order is new.
- Each order's actions are in a `⋯` menu, and each result is a toast.

- [ ] **Tests (vitest, mocked `openldr`):**
  - The tabs follow capabilities.
  - Search, register and receive each call the right entrypoint with the right input.
  - Refusals show as a toast, never a banner.
  - Every string key exists in en, fr and pt.
- [ ] **Commit** `feat(ui): the Lab page and its Reception tab`.

### Task 6: The Orders tab (React)

**Files:** `ui/src/orders/OrdersTab.tsx`, `OrderSheet.tsx`, `NewOrderSheet.tsx`, and tests.

- The table has requisition, facility, patient, tests, status and created columns, with `TablePagination` and filters for facility, status and requisition prefix.
- A row's `⋯` menu opens the order sheet. It shows tests, samples, the return reason and the history from `audit`.
- A user with `lab.orders.enter` gets "New order" in the header `⋯` menu, and "Correct" on a returned order.
- A site user sees only their facility, with the facility filter fixed to it.

- [ ] **Tests:**
  - The paging and filters pass through.
  - A returned order shows Correct only with `lab.orders.enter`.
  - The empty state is `StripedEmpty` and loading is `LoadingState`.
  - The layout holds at 375 px. In jsdom, check that no table header renders while the list is empty.
- [ ] **Commit** `feat(ui): the Orders tab`.

### Task 7: Docs and live proof

- **Plugin guide.** `docs/GUIDE.md` in en, fr and pt (`GUIDE.fr.md`, `GUIDE.pt.md`) follows CE's `apps/studio/src/docs/HOW-TO-TEMPLATE.md`. It covers what the plugin is, the four permissions and the roles to give them, Reception, Orders, a site user's view, and troubleshooting. The page links it from a Guide tab, as cdr-source does.
- **CE docs.** One short page in en, fr and pt, `apps/web/src/docs/0.1.8/{en,fr,pt}/lab-plugin.md`, says what the lab plugin is and how to install it. It goes on the Task 1 branch.
- **Live proof.** `tools/live-check/run.mjs` runs against a throwaway CE install built from the Task 1 branch, on a free port, with its own data folder:
  - install the signed bundle, signed with a throwaway key;
  - make a desk user and a site user limited to facility A;
  - register, receive, return, mark corrected, reject a sample with redraw, and link a redraw;
  - check Review focus 1 to 5 through the HTTP broker;
  - check the plugin tables' rows on the Postgres.

  HONEST NON-PROOF: row-level security is skipped by a superuser login, so the facility guard proven here is CE's query filter. Say so in the report.
- [ ] **Commit** `docs: the lab guide in three languages` and `test: live check on a CE install`.

### Task 8: Proof on 3220

Only after the operator approves merging Task 1 into CE main, and it is pushed:
1. Rebuild 3220 from main.
2. Remove the Proof desk test plugin.
3. Install the lab bundle.
4. Give the old Reception role `lab.receive`, `lab.reject` and `lab.worklist.view`.
5. Add a site user for Test site A with `lab.orders.enter` and `lab.worklist.view`.

Take screenshots on 3220: Reception search, register, receive, the Orders tab as desk and as site user, and the phone width. Put them on the screenshot Artifact page, and update `login.txt`.

Order: 1, 2, 3, 4, 5, 6, 7, 8. Task 1 can run beside Task 2.

## Left for plan 2 and later

- Results and Review tabs.
- The named range picker, which needs a `ce_read` op for `resultParamsFor` (`test-catalog.ts:241-245`).
- Sending authorised results to CE as FHIR records.
- The Settings tab: lists, sections and self-authorise.
- Release.
- The lab profile pack.
