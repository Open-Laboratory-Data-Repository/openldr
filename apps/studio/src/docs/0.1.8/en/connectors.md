# Connectors

Save a connection once, then select it in workflows, Custom Queries and reports. A connector stores the connection settings and encrypted credentials.

You need **Manage connectors**. Use your own database or service account. The pictures use a fictional read-only reporting account on an isolated Postgres database.

A fresh installation creates a target-warehouse connector for its configured database engine. These pictures use **Target Warehouse (Postgres)**. Built-in queries and reports use the warehouse connector. Check their dependencies before changing it.

The host and port must be reachable from the OpenLDR server. In Docker, `localhost` means that container. Use your database service name and internal port when both services share a Docker network.

Creating a connector does not import records or run a workflow. [Optional practice setup](#optional-practice-setup) is at the end.

## Choose the connection type

Use the settings and account prepared for the service you want OpenLDR to reach. Choose the connection type before entering its fields.

### 1. Open your user menu

Select your account menu at the bottom of the main sidebar.

![Open your user menu at the bottom left.](connectors-guide-open-user-menu.png)

### 2. Open Settings

Choose **Settings** from the account menu.

![Choose Settings in your user menu.](connectors-guide-settings-menu.png)

### 3. Open Connectors

Select **Connectors** in Settings.

![Open Settings, then Connectors.](connectors-guide-open.png)

### 4. Open the page actions

Select the page dots above the table.

![The page dots menu contains Add connector.](connectors-guide-actions.png)

### 5. Choose Add connector

Select **Add connector**.

![Choose Add connector.](connectors-guide-add.png)

### 6. Name the connection

Enter a name people can recognise when choosing a connector. The example uses `Example reporting database`. Keep passwords out of the name.

![Use a name that identifies the database and its purpose.](connectors-guide-name.png)

### 7. Choose Host

Set **Category** to **Host** for a built-in database, email or file connection.

![Choose Host for built-in database, email or file connections.](connectors-guide-host-option.png)

### 8. Choose the service type

Set **Database type** to the actual service. The example uses **Postgres**. This list also contains email and file services.

![Choose the real service type. This example uses Postgres.](connectors-guide-type.png)

## Enter the connection details and save

Continue in the open connector sheet. The fields follow the service type you selected. This example uses Postgres.

### 1. Enter the database address

Fill **Host**, **Port** and **Database**. The example address is specific to this test installation. Use your server address.

![Enter the host, port and database reachable from the OpenLDR server.](connectors-guide-address.png)

### 2. Enter the account

Fill **User** and **Password** with the database account. A connection test does not establish which tables that account may read.

![Use the database account permitted to read the required data.](connectors-guide-account.png)

### 3. Check transport encryption

Match **Use SSL** to the database requirements. The local example leaves it off. Other service types have their own transport settings.

![Match Use SSL to your database. The isolated example has no SSL.](connectors-guide-ssl.png)

### 4. Open the sheet actions

Select the dots in the connector sheet header.

![Open the connector sheet dots menu.](connectors-guide-sheet-actions.png)

### 5. Save the connector

Select **Save**.

![Save stores the connector and encrypted credentials.](connectors-guide-save.png)

**Expected result:** The connector appears in the list and starts enabled. The Allowed plugin host column is a plugin network restriction. It is not the saved database address.

![The saved row shows the name, type, allowed plugin host and enabled state.](connectors-guide-created.png)

## Test the saved connection

Run a test after creating a connector or changing its credentials.

### 1. Choose Test

Open the connector row dots and select **Test**.

![Test connection checks the saved credentials.](connectors-guide-test.png)

### 2. Read the result

Wait for **Connection OK** or a failure below the row menu. A successful connection does not prove a report query or email delivery succeeds.

![Connection OK confirms this server can connect using the saved account.](connectors-guide-test-result.png)

**Expected result:** The test uses the saved credentials from the OpenLDR server. Test outcomes appear in Audit.

## Change settings or credentials

Edit ordinary settings directly. Passwords stay blank after saving. Leave a password blank to keep it.

### 1. Open Edit

On the correct connector row, open the dots and select **Edit**.

![Edit opens the saved ordinary settings.](connectors-guide-edit.png)

### 2. Check the stored fields

Verify the host, port, database and user. A set password shows a placeholder. Type a new password only when replacing it.

![Ordinary fields are visible. A stored password remains blank.](connectors-guide-stored.png)

### 3. Save the changes

Open the sheet dots and select **Save**. The example leaves the password blank and keeps it. Test the connector again afterward.

![Save with the password blank keeps the stored password.](connectors-guide-save-kept.png)

**Expected result:** The same connector remains available to its existing consumers. They use updated settings on their next run.

## Find and temporarily disable a connection

Disable a connector when you need to stop its use without deleting its stored settings.

### 1. Search the list

Use the search field to find a name, type or allowed plugin host.

![Search matches connector name, type and host.](connectors-guide-search.png)

### 2. Turn Enabled off

Switch off **Enabled** on the correct row. Queries and workflows that need it can fail while it is disabled.

![Enabled can temporarily prevent use of this connector.](connectors-guide-toggle.png)

### 3. Check the switch

An off switch marks it disabled. Switch it on again when it may be used.

![An off switch marks the connector disabled.](connectors-guide-disabled.png)

**Expected result:** Disabling keeps the saved connector and credentials. It does not remove dependencies.

## Remove a connection you no longer need

Check dependent workflows, queries and reports before removal. Do not remove the warehouse connector just to clear the list.

### 1. Choose Remove

Open the row dots and select **Remove**.

![Remove deletes the connector and its stored credentials.](connectors-guide-remove.png)

### 2. Check the confirmation

Check the connector name. Choose **Remove** to delete it, or **Cancel** to keep it. The picture keeps this example for later tasks.

![Check the connector name before confirming removal.](connectors-guide-remove-confirm.png)

**Expected result:** Confirming Remove deletes the connector and stored credentials. Anything that still refers to it fails until reconfigured.

## Use Connectors on a phone

The Host column is hidden at phone width. Open Edit to read a host connection address.

### 1. Find the connector row

Use search, then the row dots or Enabled switch.

![At phone width the name, type, switch and row dots fit.](connectors-guide-phone-list.png)

### 2. Read or change its settings

Choose **Edit** from the row dots. The sheet fills the phone screen. Scroll inside it for longer service forms.

![The edit sheet fills the phone viewport.](connectors-guide-phone-edit.png)

## Choose the right type

**SQL databases.** Postgres, MySQL / MariaDB and Microsoft SQL have distinct connection settings. The selected connector controls the query dialect. For SQL Server instances and Windows domain accounts, use [Diagnose connections](/docs/connector-diagnose).

**Other host services.** MongoDB, Redis, SMTP Email, IMAP Email, Gmail, Microsoft Outlook and SFTP show the fields relevant to their type. Use service credentials supplied by your operator. Gmail and Outlook types require an existing application registration and refresh token. SMTP uses the sending account and relay settings.

**Plugin destinations.** Choose Category **Plugin**, select an installed sink plugin, then enter Base URL, Username and Password together. When editing, leave all three blank to keep them, or replace all three. Install a sink through [Marketplace](/docs/marketplace) if the selector is empty.

A node offers enabled connectors matching its required type. A missing connector can be disabled or have another type. Passwords do not belong in workflow labels or query text.

## Use the command line

Follow [Start here](/docs/start-here) for CLI setup. From `openldr_ce`, use the commands below. Get the id from the list. CLI add, inspect, update, test and remove support host connectors. Plugin destinations use Studio.

An add file contains `name`, `type` and `config`. A patch file contains only fields to change. Omitted fields stay stored. Blank secrets keep existing values. Protect credential files and remove them after use.

```shell
pnpm openldr connectors list
pnpm openldr connectors inspect <id>
pnpm openldr connectors add --file new-connector.json
pnpm openldr connectors update <id> --file connector-patch.json
pnpm openldr connectors test <id>
pnpm openldr connectors remove <id> --force
```

## Optional practice setup

The tasks work with your own service account. For a disposable installation, ask the database operator to create a small test table and a read-only role. The screenshots use two fictional rows in `guide_orders` and `guide_reader`.

Do not copy the screenshot address or demonstration password into a real connector. Give a report account SELECT only on approved tables. Confirm both allowed and refused queries in your own database. The illustrated test checked local Postgres connectivity. It did not test email delivery, cloud account authorization or file transfer.

## Troubleshooting

**Connection refused or timeout.** Check the address from the OpenLDR server and the database firewall. Open row dots, then Diagnose for host connections.

**Authentication failed.** Check the account and database. Replace the password through Edit and test again.

**SSL or certificate error.** Ask the service operator which transport settings are required. SQL Server shows Encrypt and Trust server certificate.

**A test passes but a query fails.** Read the query error or workflow run. The account may lack access, the SQL may use another dialect, or the query may exceed its deadline. SQL connector queries have a 30-second limit.

**Old query results remain visible.** Check the error beside the connector selector. An earlier result table does not prove the latest run succeeded.

## Related guides

[Diagnose connections](/docs/connector-diagnose) explains connection checks. [Start here](/docs/start-here) explains the CLI. Workflows and Custom Queries use saved connectors.
