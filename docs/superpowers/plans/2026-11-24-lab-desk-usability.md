# Lab desk usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Orders tab's order sheet offers the order's actions, Reception finds orders by patient or facility as well as by number, and Reception keeps its last search.

**Architecture:** All work is in the lab plugin worktree `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab-desk` (branch `feat/desk-usability`). Rust (wasm) entrypoints in `src/`, React UI in `ui/src/`. No CE change.

**Tech Stack:** Rust with `tests/fake_host.rs`; React, shadcn, vitest with `ui/src/testing/fake.ts`.

**Spec:** `docs/superpowers/specs/2026-11-24-lab-desk-usability-design.md` (CE repo). Read it first.

## Global Constraints

- Never touch the plugin's main checkout `/home/fredrick/Projects/Repositories/openldr-ce-plugin-lab`. Another session works there.
- No `Co-Authored-By` trailer in commits. No em dashes anywhere. Commit messages `feat:`/`fix:`/`test:`/`docs:` in plain words.
- Every new UI string in en, fr and pt (`ui/src/i18n.ts`). `ui/src/i18n.test.ts` checks the three match.
- UI rules: actions in a `DotsMenu`; sheets, not dialogs; `StripedEmpty` for empty, `LoadingState` for loading; works at 375 px with no sideways scroll.
- Each new entrypoint is listed in `manifest.template.json` (entrypoints list and `actionPermissions`), in `src/lib.rs`, and in the README's entrypoint table. `pnpm check-manifest` must pass.
- Checks per task: `cargo test`, `cargo clippy --all-targets -- -D warnings`, and in `ui/`: `pnpm test` and `pnpm typecheck`.

## Review Focus

- A search text with spaces or mixed case ("  banda ") must match as the number box does today (trimmed; requisition via `ids::requisition_key`). Test in Task 1.
- A desk user with `patients.find` only: CE refuses `{ search }` with FORBIDDEN. Find must fall back to `{ identifier: { value } }` and not show an error. Test in Task 1.
- An order found both by patient and by facility shows once. Test in Task 1.
- Saved state is per user: user B never gets user A's saved search. Test in Task 2.
- An action from the order sheet updates the sheet and the list behind it, and the next action uses the fresh order. Test in Task 3.

---

### Task 1: `lab_orders_find` searches by patient and facility

**Files:**
- Modify: `src/orders.rs:222-237` (`find`)
- Modify: `tests/fake_host.rs` (`patients.search` handler at ~880: also answer `{ search }` with a case-insensitive name or identifier contains match; keep the identifier and name+birthDate paths)
- Test: `tests/orders.rs`
- Modify: `README.md` (entrypoint table row for `lab_orders_find`)

**Interfaces:**
- Produces: `lab_orders_find` input `{ q: string }` (also accept the old `{ requisition }` as `q`, the live-check kit sends it). Answer `{ orders: Order[], match: "requisition" | "other" | "none", total: number }`. `orders` are full order views (`view_named`), as today. Constant `pub const FIND_SHOWN: usize = 20;` in `src/orders.rs`.

- [ ] **Step 1: Write failing tests** in `tests/orders.rs`:
  - `find_by_number_wins_and_asks_ce_nothing`: register an order REQ1; `find {q:" req1 "}` gives one order, `match == "requisition"`; the fake records no `patients.search` call.
  - `find_by_patient_name`: `find {q:"banda"}` gives the orders of the fake patient, `match == "other"`.
  - `find_falls_back_to_exact_id`: the fake's `patients.search` answers `{search}` with a FORBIDDEN `HostError`; `find {q:"N1"}` still gives the patient's orders, no error.
  - `find_by_facility_name`: `find {q:"mbeya"}` gives the orders at that facility.
  - `find_shows_each_order_once`: an order matching by patient and by facility appears once.
  - `find_caps_at_20_newest`: 25 orders for one patient; 20 come back, newest first, `total == 25`.
  - `find_keeps_site_user_to_their_facilities`: a `site(&["F2"])` caller searching by the patient sees no order at another facility.
  - `find_nothing`: `q:"zzz"` gives `orders: []`, `match:"none"`, `total: 0`. Empty `q` is `invalid`.
- [ ] **Step 2:** `cargo test --test orders find_` fails.
- [ ] **Step 3: Implement.** Exact requisition read first (as today). If none: `patients.search {search:q, limit:50}`; on a `HostError` with code `FORBIDDEN`, retry with `{identifier:{value:q}, limit:50}`. Collect `pluginRef`s. `facilities.search {q, limit:20}`, collect `id`s as `ids::facility_key`. Two `db_select`s with `in` filters (skip one when its list is empty), `orderBy created_at desc, id`, limit 20. Merge by id, sort by `created_at` desc then id, take 20. `total` = the size of the union: read ids only (`columns: ["id"]`, limit `MAX_ROWS`) for the count, so a match in both lists is counted once. Keep patient names from one `patients::names` call.
- [ ] **Step 4:** `cargo test` and clippy pass.
- [ ] **Step 5: Commit** `feat: Reception finds orders by patient or facility as well as by number`.

### Task 2: Saved desk search per user

**Files:**
- Create: `src/desk_state.rs`
- Modify: `src/lib.rs` (module and two entrypoints), `manifest.template.json` (table `desk_state`, entrypoints, `actionPermissions` both `["lab.receive"]`), `tests/plan-1-tables.json` only if the contract test needs every table listed there, `README.md` (tables and entrypoints)
- Test: `tests/desk_state.rs`

**Interfaces:**
- Produces: table `desk_state` columns `user_id text not null`, `q text nullable`, `at text not null`, primary key `["user_id"]`, no facility column. Entrypoints `lab_desk_state_get {}` gives `{ q: string | null }` and `lab_desk_state_set { q: string | null }` gives `{ q: string | null }`. The user id comes from `caller.get`, never from input. `q` is trimmed; empty or null deletes the row; more than 200 chars is `invalid`.

- [ ] **Step 1: Failing tests:** get with no row gives `{q:null}`; set then get gives it back; set null clears; user B (`set_caller`) gets `{q:null}` after user A saved; a 201-char `q` is invalid; an input `userId` is ignored.
- [ ] **Step 2:** `cargo test --test desk_state` fails.
- [ ] **Step 3: Implement** with `host.db_select` and `host.db_write` (insert or update by key, delete for null), as `src/settings.rs:84-95` does.
- [ ] **Step 4:** `cargo test`, clippy and `pnpm check-manifest` pass.
- [ ] **Step 5: Commit** `feat: Reception's last search is saved for each user`.

### Task 3: Order actions shared by Reception and the order sheet

**Files:**
- Create: `ui/src/reception/OrderActionSheets.tsx`
- Modify: `ui/src/reception/ReceptionTab.tsx` (use it; behaviour unchanged), `ui/src/orders/OrderSheet.tsx`, `ui/src/orders/OrdersTab.tsx`
- Test: `ui/src/orders/OrdersTab.test.tsx`; `ui/src/reception/ReceptionTab.test.tsx` must still pass unchanged

**Interfaces:**
- Produces: `useOrderActions(onChanged: (order: Order) => void, onCloseAutoFocus?: (e: Event) => void): { actionsFor: (order: Order) => OrderActions; sheets: ReactNode }`. It holds the state for every sheet now in `ReceptionTab.tsx:42-50`, loads `api.me().lists` once, renders the sheets (the reject ones only with `can('lab.reject')`) and the patient link (`link` in `ReceptionTab.tsx:94-102`). Each finished action calls `onChanged` with the order the plugin sent back.
- `OrderSheet` props: drop `canEnter` and `onCorrect`; add `onChanged: () => void`. With `can('lab.receive')` it renders `OrderPanel` with `actions` and `canReject={can('lab.reject')}`, and its `orderMenu` items followed by Close (pass `menu` = `[...orderMenu(...), close]`). Without `lab.receive` it keeps Correct-for-returned (via `MarkCorrectedSheet`, `lab.orders.enter`) and Close. After an action it shows the returned order at once and calls `onChanged` (OrdersTab refreshes).

- [ ] **Step 1: Failing tests** in `OrdersTab.test.tsx`:
  - with `['lab.worklist.view','lab.receive','lab.reject']`, open a row's sheet: the panel menu offers Receive, Correct, Cancel, Reject sample and Close.
  - with `['lab.worklist.view']` only: the menu offers Close only (Correct for a returned order with `lab.orders.enter`, as today).
  - receive from the sheet: the receive sheet opens over the order sheet, `lab_sample_receive` is sent, the sheet shows the new status, and `lab_orders_list` is called again.
- [ ] **Step 2:** `pnpm test` fails on them.
- [ ] **Step 3: Implement.** Move code, do not copy it. Radix sheets stack: the action sheet opens while the order sheet stays open.
- [ ] **Step 4:** `pnpm test` and `pnpm typecheck` pass, with `ReceptionTab.test.tsx` untouched.
- [ ] **Step 5: Commit** `feat: the order sheet in Orders offers the order's actions`.

### Task 4: Reception search box, the 20-of-N line, restore and Clear

**Files:**
- Modify: `ui/src/api.ts` (`ordersFind(q)` sends `{ q }`, answer type gains `match` and `total`; `deskStateGet()`, `deskStateSet(q: string | null)`), `ui/src/reception/ReceptionTab.tsx`, `ui/src/i18n.ts`, `ui/src/testing/fake.ts` if defaults are needed, `docs/GUIDE.md`, `docs/GUIDE.fr.md`, `docs/GUIDE.pt.md` (and the in-app guide if `ui/src/guide` reads them)
- Test: `ui/src/reception/ReceptionTab.test.tsx` (update the `{ requisition }` expectations to `{ q }`)

**Interfaces:**
- Consumes: Task 1 answer, Task 2 entrypoints, Task 3 `useOrderActions`.

- [ ] **Step 1: Failing tests:**
  - a scan sends `{ q: 'REQ1' }` and then `lab_desk_state_set { q: 'REQ1' }`.
  - an answer with 20 orders and `total: 25` shows `reception-more` with text naming 20 and 25.
  - on open, `lab_desk_state_get` answering `{ q: 'Banda' }` puts Banda in the box and shows the found orders with no typing. Unmount and render again: same.
  - after a register, `lab_desk_state_set` gets the new order's requisition.
  - menu item `reception-clear` empties the box and the panels, and sends `lab_desk_state_set { q: null }`. It shows only when the box or the panels hold something.
  - the not-found line names the search text.
  - placeholder and scan label say number, patient or facility.
- [ ] **Step 2:** `pnpm test` fails.
- [ ] **Step 3: Implement.** A failed `deskStateGet` or `deskStateSet` is silent (no toast): the desk still works without it. Strings in en, fr, pt: `reception.more` ("The 20 newest of {total} show. The Orders tab lists them all."), `reception.clear`, updated `reception.scanPlaceholder`, `reception.scanLabel`, `reception.notFound`. Guide: one short paragraph on what the box searches and that Reception keeps the last search, in three languages.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck`, `cargo test` pass.
- [ ] **Step 5: Commit** `feat: Reception keeps its last search and says when more orders matched`.

### Task 5: Live checks

**Files:**
- Modify: `tools/live-check/run.mjs` (or a new `run-desk.mjs` called from `all.sh`), `tools/live-check/last-run.md`

- [ ] **Step 1:** Add checks against the real install: find by patient name as the desk admin; find by facility name; find with a requisition still answers `match: "requisition"`; desk state set, get, and a second user gets null.
- [ ] **Step 2:** Run `CE=<CE main checkout path> LIVE_DIR=<scratch>/live-desk WEB=3243 FORBIDDEN="3000 5433 3210 3211 3212 3213 3220 3241 3242 5173 5174 54320 54331 54332 54340 54350" tools/live-check/all.sh`. All pass.
- [ ] **Step 3: Commit** `test: live checks for Reception search and saved state`.
