# Marketplace

Use Marketplace to review and install plugins, form templates, reports and content packs. Packages come from registries, which are lists of files supplied by a publisher.

**View marketplace** lets you browse packages and installed items. **Manage marketplace** lets you install, disable, remove and manage registries.

Begin with the registry your organisation trusts. A fresh installation includes Default registry on GitHub. Its server must reach that registry to read packages.

The pictures use a signed training sink from a local practice registry. You can follow the same tasks with your approved package. No documentation samples are required. Optional practice setup is at the end.

## Find your package

Check its source and purpose before choosing a package. Installing a plugin grants its declared capabilities.

### 1. Open Marketplace

Open **Settings**, then **Marketplace**.

![Open Settings, then Marketplace.](marketplace-guide-open.png)

### 2. Choose Browse

Use **Browse** to see available packages from enabled registries.

![Browse lists packages offered by enabled registries.](marketplace-guide-browse.png)

### 3. Search for the package

Enter the package id in Search. The fictional practice example uses `test-sink`.

![Search by the package id.](marketplace-guide-search.png)

### 4. Choose a type if useful

Use **All types** to narrow the list to a plugin, form template, report or content pack.

![Filter by type when you need a plugin, form, report or content pack.](marketplace-guide-filter.png)

### 5. Check the card

Read the id, version, publisher and registry. Open the correct package card.

![Read the package id, version, publisher and registry.](marketplace-guide-card.png)

**Expected result:** The package detail opens. Opening it retrieves the package information needed for signature, permission and compatibility checks.

## Read the package before installing

A signature check establishes whether the file matches the publisher key. Decide whether you trust that publisher and what the package may do.

### 1. Check the signature

Read **Verified** or the verification failure. An unopened remote card can be Unverified until details load.

![Opening details checks the publisher signature.](marketplace-guide-signature.png)

### 2. Read the description

Read what the package does and any required setup. This training package has no real destination.

![Read the package description before installing it.](marketplace-guide-readme.png)

### 3. Read permissions and requirements

Check publisher, selected version, permissions and compatibility. Loading permissions or Permissions unavailable does not mean no permissions are requested. Wait for confirmed details.

![Read the selected version, permissions and compatibility.](marketplace-guide-permissions.png)

**Expected result:** Install becomes available only when the selected version passes the required checks. Selecting another version starts its checks again.

## Approve and install a package

Use this only after reviewing the selected package and capabilities.

### 1. Choose Install

Open the package detail dots and select **Install**.

![Choose Install after reviewing the details.](marketplace-guide-install.png)

### 2. Review the approval

Check the version and **Requested capabilities**. A content pack shows its included steps instead.

![Review the version and requested capabilities before approval.](marketplace-guide-consent.png)

### 3. Approve this installation

Select **Approve & install** to proceed. Cancel closes the approval without installing.

![Approve and install authorizes only this reviewed installation.](marketplace-guide-approve.png)

### 4. Check Installed

Use the detail dots and Back, then choose **Installed**. Check the installed id and Active state.

![Installed lists the saved plugin with its active state.](marketplace-guide-installed.png)

**Expected result:** The package is installed in this OpenLDR instance. Installation does not configure every external dependency or prove the plugin can import your data.

## Disable or enable an installed plugin

Disabling keeps the installed files and record. It stops the plugin loading.

### 1. Choose Disable

On Installed, open the plugin. Open its dots and select **Disable**.

![Disable keeps the plugin installed but stops it loading.](marketplace-guide-disable.png)

### 2. Enable it again when appropriate

After disabling, reload the page and reopen the plugin from Installed. Open its dots and select **Enable**. This refreshes the current menu state.

![Enable permits the installed plugin to load again.](marketplace-guide-enable.png)

**Expected result:** The installed plugin can load again when enabled. This does not change its external connection settings.

## Remove an installed plugin

Check dependent workflows and imports before removing a plugin.

### 1. Choose Remove

Open the installed plugin detail dots and select **Remove**.

![Remove uninstalls this plugin.](marketplace-guide-remove.png)

### 2. Confirm the plugin id

In the confirmation, choose **Remove** to uninstall this plugin or Cancel to keep it. The practice capture removes test-sink.

![Confirm the plugin id before removing it.](marketplace-guide-remove-confirm.png)

**Expected result:** The removed plugin is no longer installed. Its available registry card can still appear in Browse.

## Add a registry

Use the registry URL or server folder supplied by your organisation. A local registry folder contains package directories. It must be accessible to the OpenLDR server.

### 1. Open Registries

Choose the **Registries** tab. Check existing sources before adding a duplicate.

![Registries lists package sources.](marketplace-guide-registries.png)

### 2. Choose Add registry

Open the tab-strip dots and select **Add registry**.

![Choose Add registry from the tab strip dots.](marketplace-guide-add-registry.png)

### 3. Name the source

Enter a useful **Name**. The example uses Example local registry.

![Use a name identifying the registry owner.](marketplace-guide-registry-name.png)

### 4. Choose its type

Choose **Local directory** for a folder on the API server or **Remote (HTTP)** for a web registry.

![A local registry is a folder on the OpenLDR server.](marketplace-guide-registry-type.png)

### 5. Enter its location

Fill **Location** with the server folder or registry base URL. The picture uses an isolated practice folder.

![Enter the folder visible to the API server, not your laptop.](marketplace-guide-registry-location.png)

### 6. Save the source

Open the sheet dots and select **Save**.

![Save adds the registry.](marketplace-guide-registry-save.png)

**Expected result:** The enabled registry appears in the list. Its available packages appear in Browse. A folder on your laptop is not automatically visible to a server or container.

![The local registry is listed and enabled.](marketplace-guide-registry-saved.png)

## Change a registry

A disabled registry stops supplying available packages. It does not uninstall packages already installed.

### 1. Choose Edit

Open the registry row dots and select **Edit**.

![Edit revises a registry name, kind, location or enabled state.](marketplace-guide-registry-edit.png)

### 2. Check settings and Enabled

Update the name, type, location or Enabled state. Save from the sheet dots. Close without Save to discard changes.

![Check stored location and Enabled before changing a registry.](marketplace-guide-registry-settings.png)

## Review packages on a phone

The same tabs and package actions are available at phone width.

### 1. Read a package card

Search in Browse and open the correct card. Cards stack vertically.

![Browse cards stack at phone width.](marketplace-guide-phone.png)

### 2. Review version and permissions

Read details above the package description, then scroll for the remaining sections.

![Version and permissions appear before the description on a phone.](marketplace-guide-phone-details.png)

## Content packs and other package types

A content pack applies its declared reference-data steps in order. Review its list and counts before installing. Pack installation can update code systems, value sets, facilities, mappings and named queries. A retry can overwrite a query changed locally.

If a pack fails during application, earlier steps can remain written. Read Failed at step N and its error, correct the cause, then choose Install again. A pack refuses invalid signatures and failed preflight checks before writing.

**Detach** forgets an installed pack or form-template record while retaining its created data. It is not an uninstall. Plugins offer Remove. An older installed plugin version can offer Rollback. These alternatives depend on the selected package type and installed versions.

A package whose details cannot load keeps installation disabled. Check registry availability before retrying. The documented test exercised the plugin path. It did not apply a content pack or roll back an older plugin.

## Use a local bundle from the CLI

Follow [Start here](/docs/start-here) for CLI setup. From `openldr_ce`, CLI install reads a bundle directory on the server. It does not browse the Studio registry list. Verify and dry-run before applying an approved bundle.

```shell
pnpm openldr market list
pnpm openldr market verify <bundle-directory>
pnpm openldr market install <bundle-directory> --dry-run
pnpm openldr market install <bundle-directory>
pnpm openldr market disable <plugin-id>
pnpm openldr market remove <plugin-id>
```

## Optional practice with a local training sink

Use your approved registry and packages for normal work. The optional [practice manifest](https://openldr.online/docs-samples/user-guide/marketplace/manifest.json) belongs to a signed training bundle. It has no clinical sample data and sends nothing to a real destination.

In a source checkout on a disposable installation, `pnpm build:test-sink` and `pnpm make:docs-marketplace-bundle` create the repository training bundle. Use the generated bundle folder on that server as a local registry. Local registry roots contain immediate package directories. The HTTP index format is different.

The pictures use a separate generated practice folder. Do not treat its test publisher key as a production trust decision.

## Troubleshooting

**Browse is empty.** Clear Search and the type filter. Check enabled registries and whether the API server can read the folder or URL. Use the tab-strip dots and Refresh after source changes.

**A local package is missing.** Point the registry at the directory whose immediate children are readable bundle directories, each with its manifest and payload.

**Permissions unavailable.** The package details could not be retrieved. This does not establish an empty permission list.

**Approval stays open after an error.** Read the error notification. Correct storage, compatibility, signature or other reported requirements before retrying.

**A plugin is installed but missing elsewhere.** Confirm it is enabled and declares the expected importer, page or other capability. For cards and panels, see [Plugin cards and side panels](/docs/plugin-sites).

## Related guides

[Connectors](/docs/connectors) covers plugin destinations. [Forms](/docs/forms) covers form editing. [Plugin cards and side panels](/docs/plugin-sites) covers optional plugin places.
