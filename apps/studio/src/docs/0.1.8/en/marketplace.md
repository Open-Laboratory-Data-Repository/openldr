# Marketplace

**Marketplace** is where administrators find and install extras for OpenLDR: **plugins** that read or send data (a CSV importer, an HL7 v2 reader, a DHIS2 sender), **form templates**, and **content packs** of reference data such as code systems, a facility register and report queries. Everything comes from a **registry**, a published list of artefacts. A fresh install has one, **Default registry**, on GitHub.

This guide takes about 10 minutes and needs network access to GitHub. Select any picture or clip to enlarge it.

![Marketplace, Browse: the artefacts in the default registry, each with its type, publisher, version and signature state.](marketplace-tour.png)

## Who can do what

| Permission | What it allows |
| --- | --- |
| **View marketplace** | Open Settings, Marketplace, and browse available and installed artefacts |
| **Manage marketplace** | Install, enable, disable, remove, and manage registries |

## The three tabs

- **Browse** lists what the registries offer. **All types** filters by plugin, form or content pack.
- **Installed (N)** lists what this install has, with each artefact's state.
- **Registries** lists where artefacts come from.

Each card shows **Unverified** until its signature has been checked. Opening it checks the signature and the card turns **Verified**.

## Example 1: read a plugin before installing it

![Opening tabular. The details, permissions and requirements load and it turns Verified.](marketplace-read.mp4)

1. Open **Settings**, then **Marketplace**. **Browse** is open.
2. Select **tabular**.

**Expected result:** after a few seconds the page reads **Verified**, with the description **CSV/Excel -> FHIR R4 ingestion plugin (configurable mapping)**. It shows:

| Field | Value |
| --- | --- |
| Entry point | `convert` |
| Checksum (sha256) | the file's hash, checked before it runs |
| Sandbox | WASI enabled |
| Memory limit | 256 MB |
| Time limit | 30000 ms |
| Permissions | `read-input`, `emit-fhir` (Patient, Specimen, Observation) |
| Requirements | Compatible with CE 0.1.11 |

![tabular's details: what it runs, what it may do, and what it needs.](marketplace-read-full.png)

A plugin runs in a sandbox with fixed memory and time. Its permissions say what it may do: `tabular` may read the file it is given and write FHIR patients, specimens and observations, nothing else.

While registry package details load, Permissions shows **Loading permissions** and Install stays disabled. If retrieval fails, it shows **Permissions unavailable**. Neither state means the package requests no permissions. **No special permissions requested** appears only when the loaded details confirm an empty list. Selecting another version starts this check again. The installation approval uses the permissions for that selected version. Installed packages without a registry reference can use their stored permission list.

The selected artifact is installed or updated, and registries control which available artifacts appear for administrators.

## Example 2: install it

![Opening the menu, selecting Install, reading the capabilities and approving.](marketplace-install.mp4)

1. On the **tabular** page, open **⋯** and select **Install**.
2. **Review & approve: tabular** lists the version and the **Requested capabilities**. Read them.
3. Select **Approve & install**.

**Expected result:** the tab reads **Installed (1)**, and **tabular** is listed there as **Active**.

![tabular installed and Active.](marketplace-installed.png)

The approval is for the capabilities of the version you selected. Choosing another version starts the check again.

## Example 3: remove it

![Opening the installed plugin, choosing Remove and confirming.](marketplace-remove.mp4)

1. On **Installed**, select **tabular**. Open **⋯**. It offers **Disable**, **Remove** and **Back**.
2. Select **Remove**, then **Remove** again in **Remove tabular?**. This uninstalls it from this install.

**Expected result:** **Installed (0)**.

**Disable** keeps a plugin installed but stops it loading. **Rollback**, when an older version is installed, makes that version active again.

## Registries

![The Registries tab: Default registry, Remote (HTTP), on GitHub.](marketplace-registry-list.png)

1. Open the **Registries** tab. **Default registry** is a **Remote (HTTP)** registry at `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main`.
2. To add one, open the page's **⋯** menu and select **Add registry**. Fill in **Name**, **Type** and **Location (URL or directory)**, then choose **Save** from the sheet's **⋯** menu. Close the sheet without saving to discard it.

![The Add registry sheet.](marketplace-add-registry.png)

A registry can be a web address or a folder on the server. A lab without internet can point a folder registry at a copy of the marketplace.

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

A register step can list extra columns. Their values go into each facility's `extras`, keyed by the column name in lowercase. Custom queries read them from the warehouse table `facility_registry`. Any other column the register does not know still refuses the pack. An older CE refuses a pack that lists extra columns, and writes nothing.

A pack can map lab test codes to catalog tests (**Test mappings**). It names each code's LOINC code, and CE maps it to the catalog test linked to that LOINC. A code the pack cannot resolve is skipped and listed: no catalog test has that LOINC, or two do. A code already mapped here is kept. The CLI dry run (`openldr market install <dir> --dry-run`) lists what it would map, keep and skip.

Choose **Detach** to forget the install record. It keeps everything the pack wrote. There is no uninstall.

From the command line, `openldr market install <bundle-dir> --dry-run` runs the checks and prints the steps, with how many codes each link-matching step would link. It writes nothing.

## From the command line

The CLI installs from a bundle folder on the server, not from a registry.

```bash
./openldr market list
./openldr market verify <bundle-dir>
./openldr market install <bundle-dir> --dry-run
./openldr market disable tabular
./openldr market remove tabular
```

`verify` checks a bundle's manifest, file and publisher key. `install --dry-run` runs every check and writes nothing. `update` installs a content pack only when the bundle is newer than the one installed. `rollback <id> <version>` activates an older version of a plugin.

## Reading what an artefact can do

Compatibility tells you whether the artifact can run in this app version. Capabilities tell you what it can do. Registry source determines trust and update availability. When diagnosing install failures, compare registry state, artifact type, version, and capability requirements before retrying.

## On a phone

Marketplace works on a phone. The cards stack in one column. On an artefact's page, the details, permissions and requirements come first, above its description.

## Troubleshooting

- **Browse is empty.** The registry is unreachable or disabled. Check **Registries**, and that the server can reach the registry's address.
- **The card stays Unverified.** Open it. The signature is checked when its details load.
- **Permissions shows Permissions unavailable.** The details could not be fetched. This does not mean the artefact needs no permissions. Install stays disabled.
- **Install fails:** inspect compatibility, capabilities, and registry availability.
- **A package is missing:** check that the registry is enabled and reachable.
- **The wrong version is installed:** open details and select the intended version if available.
- **An installed artifact does not appear elsewhere:** confirm it is enabled and supported by that feature area.

## Related guides

- [Settings](/docs/settings)
- [Connectors](/docs/connectors)
- [Forms](/docs/forms)
- [Facilities](/docs/facilities)
