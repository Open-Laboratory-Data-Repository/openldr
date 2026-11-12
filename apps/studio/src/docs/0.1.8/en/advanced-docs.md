# Deployment & developer docs

Use the in-app manual for tasks inside Studio. Use deployment and developer documentation for installation, server configuration, source development and CLI operation.

This page helps you find and save that material. It does not add a deployment editor to Studio or run maintenance commands. No sample data is required.

## Find deployment and developer guidance

Search the app manual when you need installation, CLI or server references.

### 1. Open Docs

Select **Docs** in the main menu.

![Open Docs from the main menu.](advanced-docs-guide-docs.png)

### 2. Search for the topic

Enter `Deployment` in Search documentation. You can also search a more specific topic.

![Search documentation by title or topic.](advanced-docs-guide-search.png)

### 3. Open the matching guide

Choose **Deployment & developer docs**.

![Choose Deployment & Developer Docs from the results.](advanced-docs-guide-guide-link.png)

### 4. Choose the kind of instructions you need

Read the guide. Installation, environment variables, Windows Server, development and the CLI are separate topics.

![Read the deployment and developer documentation entry.](advanced-docs-guide-guide.png)

### 5. Follow the project reference

Use the [OpenLDR website](https://openldr.online/docs) or the [source repository](https://github.com/Open-Laboratory-Data-Repository/openldr). The source repository includes the deployment files and CLI. Check instructions against the release you run.

![Use the project website or source-repository link for deployment and development material.](advanced-docs-guide-repository.png)

**Expected result:** You can choose the correct documentation without treating the in-app manual as a server administration console.

## Save instructions before downtime

Save any upgrade or recovery instructions outside Studio before stopping the services that provide this manual.

### 1. Open Download documentation

Select the download button at the top of the guide.

![Download a guide before taking Studio offline.](advanced-docs-guide-download.png)

### 2. Choose This page

Select **This page**. Choose All docs instead when you need the complete manual.

![Choose This page for this guide only.](advanced-docs-guide-this-page.png)

### 3. Choose a file format

Select Markdown, PDF or Word. The tested example downloads **Markdown (.md)**. Keep the file where you can read it while Studio is offline.

![Choose Markdown, PDF or Word.](advanced-docs-guide-format.png)

**Expected result:** The browser downloads a standalone copy of the selected scope. A documentation export is not a database or file backup.

## Read the guide on a phone

The app manual adapts to phone width.

### 1. Read the selected topic

Open the guide and scroll the reading pane. Use the header controls for navigation and download.

![Read the guide at phone width.](advanced-docs-guide-phone.png)

## Which guide to use

| Task | Guide |
| --- | --- |
| Install OpenLDR or choose server requirements | Website Requirements and Install. |
| Set domains, certificates or external stores | [Environment variables](/docs/environment) and the deployment documentation. |
| Run OpenLDR from source | Website Development, then the source checkout instructions for that release. |
| Use operator commands | [Start here](/docs/start-here) and CLI documentation. |
| Change identity provider or issuer address | [Authentication providers](/docs/auth-providers). |
| Upgrade an existing deployment | [Planned upgrades](/docs/upgrading). |
| Configure Studio behavior | [Settings](/docs/settings). |

## Read model and source facts

The canonical FHIR store preserves clinical resources. The warehouse projects them into tables for queries and reports. Source facts remain empty when the source does not supply them.

Common request facts have typed columns in lab_requests. Additional request attributes use lab_request_attributes with the request-attribute coding system. They are rows, not country-specific columns. Read these attributes through Custom Queries.

The terminology file `packages/terminology/codesystems/openldr-request-attribute.json` supplies display names. Import it from a source checkout with `pnpm openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json` when your deployment needs those labels. Attribute data can exist without the display-name dictionary.

A result reported as below or above a limit stores that numeric limit in numeric_value and its comparison in numeric_comparator. Result status and data-absent fields describe cancelled or unavailable results. Qualify status with the correct table alias when a query joins tables that also have status columns.

Free-text clinical_info is hidden from the dashboard builder by default. Review Data exposure before making it available. Connector SQL has its own database-account permissions.

## Arrival time and warehouse rebuilds

Use ingest_events when a report asks when a clinical resource reached OpenLDR. Projected table created_at values describe projection writes. They do not represent every arrival of corrected resource versions.

`pnpm openldr db reproject --force` rebuilds the warehouse from canonical resources, including the arrival ledger. It rewrites projected rows and refuses without --force. Plan its cost and timing before using it on a large deployment. The older terminology reproject command is deprecated and performs the same full rebuild.

After a transient projection failure, durable retries reread the current canonical resource. A cycle retries up to 100 queued resources and continues new changes. Repeated failures wait longer, up to five minutes. A recovered dependency can clear the retry without operator action. A deliberate full rebuild remains a separate maintenance operation.

## Tested limits

The screenshots come from the real app manual. Markdown export was downloaded and inspected. External installation, Windows Server setup, source build instructions and destructive maintenance commands were not run by the documentation navigation checks.

For deployment changes, follow the actual release documentation and verify the affected services. A link in Studio does not prove an external procedure has been tested on your server.

## Troubleshooting

**A guide does not appear in search.** Check the current documentation language and version, then search for its title or topic.

**The download contains the wrong guide.** Open the intended guide and choose This page in Download documentation.

## Related guides

[Start here](/docs/start-here), [Environment variables](/docs/environment), [Authentication providers](/docs/auth-providers) and [Planned upgrades](/docs/upgrading).
