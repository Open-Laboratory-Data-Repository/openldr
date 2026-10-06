# Marketplace

Registry creation and editing open in a side sheet. Labels sit beside the inputs. Choose Save from the sheet's ⋯ menu. Close the sheet without saving to discard edits.

Marketplace is where administrators browse available artifacts, inspect details, install approved packages, and manage registries.

## Outcome

You can use the Browse, Installed, and Registries views; inspect artifact details; compare versions and capabilities; approve an install; enable, disable, or remove installed artifacts; and create or edit a registry.

![Marketplace browse view with available artifacts](marketplace-browse.png)

## Before you begin

- You need administrator access.
- Know whether you are installing a form, workflow, connector plugin, or another supported artifact type.
- Confirm the artifact source is trusted before installing it.

## Steps

1. Open **Settings** and then **Marketplace**.
2. Use **Installed** to review what is already available.
3. Use **Browse** to see artifacts from configured registries.
4. Select an artifact card to open details.
5. Review version, compatibility, capabilities, documentation, and install action.
6. Choose the version that matches your app and operational need.
7. Approve installation when you are ready.
8. Return to **Installed** to enable, disable, or remove artifacts when supported.

![Marketplace artifact detail with version, permissions, documentation, and requirements](marketplace-detail.png)

9. Open **Registries**.
10. Select **Add registry**.
11. Enter registry name, kind, location, and enabled state.
12. Save the registry and refresh available packages if needed.

![Marketplace registries tab with add-registry form](marketplace-registries.png)

## Expected result

While registry package details load, Permissions shows **Loading permissions** and Install stays disabled. If retrieval fails, it shows **Permissions unavailable**. Neither state means the package requests no permissions. **No special permissions requested** appears only when the loaded details confirm an empty list. Selecting another version starts this check again. The installation approval uses the permissions for that selected version. Installed packages without a registry reference can use their stored permission list.

The selected artifact is installed or updated, and registries control which available artifacts appear for administrators.

## Content packs

A content pack is a signed bundle of reference data. It installs, in this order, code systems, value sets, a facility register, link-matching, and custom queries. A pack declares no capabilities.

In **Browse**, filter by **Content pack**. A pack's detail lists its steps with counts. The install confirmation shows the same list. You need the marketplace manage permission, as for plugins.

Install checks every step first. A pack with no publisher signature is refused. It checks the signature and the publisher key, the file hash, and the step list. It checks that every query is SELECT-only, that the register file previews cleanly, and that the register is not deactivated. If a check fails, nothing is written.

The first install from a publisher pins its key. A later pack signed with a different key is refused.

Then install applies the steps in order. If a step fails, the earlier steps stay written. The pack shows **Failed at step N** with the error on its card and in its detail. Choose **Install again** in the `⋯` menu to finish it.

Installing twice is safe:

- Code systems and value sets are replaced by URL.
- The register source is reused, and its rows are updated on their code.
- Link-matching runs again.
- Queries are replaced by name. A query an admin edited is overwritten when the pack is installed again.

Rows dropped from a newer pack's register are reported. They are never retired.

Choose **Detach** to forget the install record. It keeps everything the pack wrote. There is no uninstall.

From the command line, `openldr market install <bundle-dir> --dry-run` runs the checks and prints the steps, with how many codes each link-matching step would link. It writes nothing.

## Troubleshooting

- **Install fails:** inspect compatibility, capabilities, and registry availability.
- **A package is missing:** check that the registry is enabled and reachable.
- **The wrong version is installed:** open details and select the intended version if available.
- **An installed artifact does not appear elsewhere:** confirm it is enabled and supported by that feature area.

## Advanced web usage

Compatibility tells you whether the artifact can run in this app version. Capabilities tell you what it can do. Registry source determines trust and update availability. When diagnosing install failures, compare registry state, artifact type, version, and capability requirements before retrying.

## Related guides

- [Settings](/docs/settings)
- [Connectors](/docs/connectors)
- [Forms](/docs/forms)
