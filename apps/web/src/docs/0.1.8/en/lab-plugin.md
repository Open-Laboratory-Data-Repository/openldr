# The lab plugin

The lab plugin adds a **Lab** page to the studio. The desk at the lab finds an order by its requisition number, registers it if needed, receives samples, and returns or rejects what it cannot use. Staff at a site enter their own orders and see only their own facility's orders. The plugin keeps its records in its own tables, in the schema `plugin_lab`. CE works the same without it.

Orders and samples stay in the plugin's tables and do not reach CE's reports yet. Only a newly registered patient reaches CE.

The plugin is not in the marketplace yet. This page says how to try a signed bundle on a test install.

## What it needs

- This release of CE. The plugin reads facilities, tests and patients through CE's host functions.
- Facilities in the facility register, and the tests your lab runs switched on in the test catalog. Each test needs a sample type, or the desk cannot receive a sample for it.

## Install a signed bundle

```sh
openldr artifact publish <bundle-directory> --to <registry-folder> --install --approve
```

Then restart the server. An install from the command line reaches a running server only after a restart. The **Lab** entry then shows in the sidebar for anyone who holds one of its permissions.

## Give people access

The plugin adds four permissions. The Administrator role gets all four at install. Give them to other roles on the **Roles** page, or with `openldr roles grant <role> <key>`.

- `lab.receive`, **Receive samples**: the **Reception** tab.
- `lab.reject`, **Reject and return**: return an order to its site, and reject samples and tests.
- `lab.orders.enter`, **Enter orders**: the **Orders** tab, and new orders in it.
- `lab.worklist.view`, **View lab orders**: the **Orders** tab.

`lab.reject` opens no tab by itself. Give it with `lab.receive` or `lab.worklist.view`.

Both the desk and the sites also need `patients.find` (**Find a patient**) to find and register patients.

An order keeps only a link to its patient, never the name. The name is read from CE each time an order is shown, with the rights of the person looking. A role that holds `patients.find` or `patients.view` and also `patients.view_identifiers` (**View patient identifiers**) sees the full name. Without `patients.view_identifiers` the name is masked, as on CE's own pages. A role with no patient permission at all, such as one with only `lab.worklist.view`, sees **not available** in place of the name. A site user limited to a facility always sees masked names, since the limit removes `patients.view_identifiers`.

Limit each site user to their facility with `openldr users scope <user> --facility <facility-id> --force`. Such a user then sees only that facility's orders. A request for another facility's order is answered as not found.

The **Guide** tab on the **Lab** page shows each task step by step.
