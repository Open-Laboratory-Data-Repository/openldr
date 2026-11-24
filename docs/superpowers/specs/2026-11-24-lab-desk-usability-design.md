# Lab desk usability

Date: 2026-11-24. Repo: the lab plugin (`openldr-ce-plugin-lab`), branch `feat/desk-usability`.
No CE change.

## What the operator said

1. "I can see the order but can't do anything else, only option on the menu is close."
   The Orders tab's order sheet.
2. "Orders show list but reception are screwed if they search by anything else."
3. 2026-11-23: after registering, the order showed. Going to another page and back left
   Reception empty.

## Proof each gap is real

1. `ui/src/orders/OrderSheet.tsx:94-98` builds a menu of Correct (returned orders only) and
   Close, and passes `canReject={false}` with no actions to `OrderPanel` (line 115).
2. `src/orders.rs:224-237`: `lab_orders_find` takes `{ requisition }` and matches it exactly.
   Nothing else is searched.
3. `ui/src/reception/ReceptionTab.tsx:35-50`: the found orders live in `useState` only. The plugin
   page is an iframe with `sandbox="allow-scripts"` (CE `apps/studio/src/plugins/PluginFrame.tsx:104`),
   so it has no browser storage, and leaving the page unloads it. Radix tabs also unmount the
   inactive tab, so switching to Orders and back loses it too.

## How Corlix does it

- One search box matches the order number or the patient name
  (`apps/desktop/src/main/orders.ts:168`). Enter jumps to an exact number match
  (`renderer/pages/OrderListPage.tsx:283`).
- The order detail page keeps every action in one ⋯ menu (`OrderDetailPage.tsx:451-480`).
- Corlix stores the patient name on the order. CE does not: an order keeps only CE's link
  (`pluginRef`), and names follow CE masking. So the patient part goes through CE.

## Design

### 1. Actions in the order sheet

The order sheet shows the same ⋯ menu as Reception's panel (`orderMenu`, `OrderPanel.tsx:25`),
to a caller who holds `lab.receive`. Return and the reject items show only with `lab.reject`, as
in Reception. A caller with neither keeps today's menu. Close stays last in the menu.

The action sheets move out of `ReceptionTab` into one shared component. Reception and the order
sheet both use it, so no sheet is copied. After an action the order sheet reads the order again,
and the Orders list reloads.

### 2. Search by more than the number

One box, as now. `lab_orders_find` takes `{ q }`.

1. An order whose requisition number equals `q` wins. The answer is those orders, as today.
   A barcode scan makes no extra CE call.
2. Otherwise the plugin asks CE twice:
   - `patients.search` with `{ search: q }`. A caller with `patients.find` but not
     `patients.view` is refused that (CE `plugin-host.ts:329-333`). The plugin then asks with
     `{ identifier: { value: q } }`, an exact id match.
   - `facilities.search` with `{ q, limit: 20 }`.
   Then it reads orders whose `patient_ref` is one of the patients found, or whose `facility` is
   one of the facilities found. Newest first, at most 20 shown, with the total.
3. The answer says what matched: `match` is `requisition`, `other` or `none`, with `total`.

CE adds the caller's facility filter to every order read, so a site user still sees only their
facilities. Not in scope: a name plus birth date search from the one box, and a requisition
prefix. The Orders tab keeps its prefix search.

When more than 20 matched, Reception says so under the panels: the 20 newest show, and the
Orders tab lists all of them.

### 3. Reception keeps its last search

A new plugin table `desk_state`: `user_id` (key), `q`, `at`. Two entrypoints, both for
`lab.receive`:

- `lab_desk_state_get` gives the caller's saved `{ q }`, or `{ q: null }`.
- `lab_desk_state_set` with `{ q }` saves it, and `{ q: null }` clears it. The user id is the one
  CE passes, never the input's.

Reception saves `q` after each search, and the requisition number after a register. When the tab
opens, it reads the saved `q`, puts it in the box and searches again. So the orders are read fresh,
with the caller's rights at that time. The box's ⋯ menu gets Clear, which empties the box and the
saved search.

## Strings

New strings in en, fr and pt: the "20 newest of N" line, Clear, and the not-found line that now
names any search text, not only a number.

## Proof

- `cargo test` and `cargo clippy` for find, the fallback to an exact id, the facility match, the
  cap of 20, a site user's scope, and the saved state per user.
- UI tests for the order sheet menu with and without `lab.receive` and `lab.reject`, a search by
  name, the 20-of-N line, and the restore after remount.
- The live-check kit on a throwaway install on port 3243, with new checks for search and state.
- Screenshots at 1280 and 375 px.
