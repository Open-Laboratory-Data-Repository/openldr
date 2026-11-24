# The lab plugin

The lab plugin adds a **Lab** page to the studio. The desk at the lab finds an order by its requisition number, registers it if needed, receives samples, and returns or rejects what it cannot use. Staff at a site enter their own orders and see only their own facility's orders. The bench enters results, and a reviewer authorises them. The plugin keeps its records in its own tables, in the schema `plugin_lab`. CE works the same without it.

Authorised results reach CE's reports. Until a result is authorised, its order, sample and values stay in the plugin's tables. A newly registered patient reaches CE at once.

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

The plugin adds seven permissions. The Administrator role gets all of them at install. Give them to other roles on the **Roles** page, or with `openldr roles grant <role> <key>`.

- `lab.receive`, **Receive samples**: the **Reception** tab.
- `lab.reject`, **Reject and return**: return an order to its site, and reject samples and tests.
- `lab.orders.enter`, **Enter orders**: the **Orders** tab, and new orders in it.
- `lab.worklist.view`, **View lab orders**: the **Orders** tab, and the values of an order's results, read-only.
- `lab.results.enter`, **Enter results**: the **Results** tab.
- `lab.results.authorise`, **Authorise results**: the **Review** tab, to send results back or authorise them.
- `lab.settings`, **Lab settings**: the **Settings** tab, which turns self-authorise on or off.

`lab.reject` opens no tab by itself. Give it with `lab.receive` or `lab.worklist.view`.

Both the desk and the sites also need `patients.find` (**Find a patient**) to find and register patients.

An order keeps only a link to its patient, never the name. The name is read from CE each time an order is shown, with the rights of the person looking. A role that holds `patients.find` or `patients.view` and also `patients.view_identifiers` (**View patient identifiers**) sees the full name. Without `patients.view_identifiers` the name is masked, as on CE's own pages. A role with no patient permission at all, such as one with only `lab.worklist.view`, sees **not available** in place of the name. A site user limited to a facility always sees masked names, since the limit removes `patients.view_identifiers`.

Limit each site user to their facility with `openldr users scope <user> --facility <facility-id> --force`. Such a user then sees only that facility's orders. A request for another facility's order is answered as not found.

## What reaches CE

When a reviewer authorises a result, the plugin sends CE one ServiceRequest for the test, a Specimen for each sample, one Observation per result parameter, and a Provenance that says who authorised it. Each Observation is `final`. It carries the value and unit, the flag in `interpretation`, and the range in `referenceRange`, with the range's name as its `text`. Each record's `subject` is the patient's CE record. CE stores them like records from any other source, and its warehouse fills `lab_requests` and `lab_results`, so the results show in reports and dashboards.

The plugin shows the Test code to people. It sends the test as a coding with the system `urn:openldr:codesystem:test-catalog:test-code` and the Test code, beside the LOINC coding when one is linked. It also sends the fixed id as a coding in `urn:openldr:codesystem:test-catalog`.

A rejected test reaches CE once its rejection is final, at once when it is rejected without a redraw or when its redraw order is linked. It reaches CE as a `revoked` ServiceRequest with the rejection reason, which fills `lab_requests.rejection_code` and `rejection_reason`.

CE takes these records only from a user with no facility limit, who also holds `patients.find` or `patients.view`. So a reviewer must see every facility. A rejection made by a site user limited to a facility waits in the plugin until a user with no limit acts, or a reviewer selects **Retry** in the **Review** tab.

By default the person who entered a result cannot authorise it. A holder of `lab.settings` can turn on **Allow self-authorise**. The Provenance then records `self-authorise`.

An authorised result is locked. The plugin cannot amend it yet.

The **Guide** tab on the **Lab** page shows each task step by step.
