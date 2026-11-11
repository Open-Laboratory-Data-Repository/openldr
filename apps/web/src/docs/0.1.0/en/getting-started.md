# Getting started

## 1. Install

If you have not installed yet, run the one-line installer on a host with Docker. It
generates every secret, brings the stack up on `https://localhost` with a self-signed
certificate, and prints the URL and admin credentials. Full options are on the
[Install](/docs/install) page.

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

## 2. Sign in

After installing, open the printed URL in your browser and sign in with the
generated admin credentials. From there you can install plugins, build
workflows, configure connectors, and [load your first data](/docs/load-data).

To stop or start the stack later, run `docker compose down` / `docker compose up -d`
from inside the `openldr/` directory the installer created.

## Going further

- [Report publishing](#report-publishing) distinguishes template revisions from library reports in English, French, and Portuguese.

- [User role assignment](#user-role-assignment) explains Studio's single-role selector in English, French, and Portuguese.

- [Connector setup](#connector-setup) explains category selection and the initial enabled state in English, French, and Portuguese.

- Marketplace permission checks are explained in the studio's Docs, under **Marketplace**.
- [Development](/docs/development) — run OpenLDR from source with hot reload.
- [Command-line interface (CLI)](/docs/cli) — the `openldr` operator command line.
- [Environment variables](/docs/environment) — configure a deployment.

## Connector setup

In Studio, open **Settings → Connectors**. From the page's **⋯** menu, choose **Add connector** and enter a name.

**Category** defaults to **Plugin**, which requires an installed output plugin. Choose **Host** for built-in database, email, or file services, then select the service under **Database type**. This selector includes more than databases. Complete the connection fields and choose **Save** from the sheet's **⋯** menu.

The saved-name notification confirms storage. New connectors start enabled; creation has no Enabled control. To disable one, use its **Enabled** switch in the list or edit the saved connector. Use the row menu's **Test** action to check connectivity from the OpenLDR server. Then select the enabled connector in a compatible workflow node. Studio's **Docs → Connectors** guide has the full setup procedure.

## User role assignment

In Studio, open **Users**, find the account, then choose **Edit** from its row's **⋯** menu. Wait for **Role** to load and select one role. Choosing another role replaces the selection; it does not add a second role. Save, check the success notification, and reopen the account to verify the saved selection.

Editing the account requires Manage users; assigning its role also requires Manage roles. If assignment fails, the editor stays open with an error. Resolve it before treating the update as complete. Configure a role with the required capabilities in **Settings → Roles** if none fits. Changing a shared role affects all its members. Studio's Users and Roles guides explain this procedure.

## Report publishing

In Studio's Report Designer, save the template and wait for Saved. **⋯ → Publish revision** publishes a template version and confirms the template name. It does not create a Reports library entry.

Choose **⋯ → Create report from this design** to add a library report. Set Name, Category, Template, and Primary query; Description is optional. Check any preselected query. From the sheet's **⋯** menu, choose **Create report** and check the confirmation naming the new report. This action does not publish a template revision.

Open Reports, select the new report in its category, fill required parameters, and run it. The primary query supplies Spreadsheet rows; the template supplies the Document layout. Publishing later revisions of that template does not require creating another library entry. Studio's Report Designer guide includes the full sequence.

## First steps in Studio

The numbered screenshots show the English interface with synthetic examples. They contain no patient data.
On a phone, open the navigation menu first. In Studio, select an image to enlarge it.

1. Open **Dashboard** to see dashboards shared with your account.
2. Open **Reports** to browse the report library.
3. Open **Docs** and use **Search documentation** to find a task.
4. Return to **Reports**, select a report, open its **⋯** menu, and choose **Parameters**.
5. Complete its required fields. Reports define their own parameters; the image shows an example text field.
6. Select **Run** when the required values are complete.

**Facilities** appears when your account has permission to view facilities. Other pages also depend on permissions.
The capture stops before Run. The report's output depends on its definition and available data.
Find the full **Start here** guide inside Studio's **Docs**.

## Connector configuration readback

## Edit stored host settings

Choose **Edit** from the connector row's **⋯** menu. Host connectors show stored ordinary fields, including host, port, database, and user where applicable. A secret marked as set stays blank. Leave it blank to keep its stored value, including when changing the host. Enter a replacement secret only when needed. Choose **Save** from the sheet's **⋯** menu, then use the row's **Test** action.

URLs, unknown configuration fields, and plugin configuration are not shown. Plugin editing keeps its existing requirement to enter base URL, username, and password together.

For headless inspection, run `openldr connectors inspect <id>`. The JSON contains ordinary `config` and boolean `secretsSet` fields. To update a host connector, run `openldr connectors update <id> --file patch.json`. Example file: `{"config":{"host":"db.internal","port":"5432"}}`. Omitted fields remain stored. Blank secret fields keep existing secrets. A rename-only patch is `{"name":"Lab database"}`. Output and audit records exclude credential values. Protect files containing replacement secrets.
