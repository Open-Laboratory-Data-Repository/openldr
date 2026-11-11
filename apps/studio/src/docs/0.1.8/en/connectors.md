# Connectors

A **connector** is a saved connection to another system: a database, an email server, a file server, or a destination an installed plugin provides. Workflow nodes, Custom Queries and reports use a connector **by name**. None of them stores a password. The server supplies it when the work runs.

This guide takes about 15 minutes. Select any picture or clip to enlarge it.

![Settings, Connectors on a fresh install: one connector, Target Warehouse (Postgres).](connectors-tour.png)

## Who can do what

One permission covers this page: **Manage connectors**. Without it, Connectors is not listed in Settings. The built-in **Administrator** role has it.

## What a fresh install has

One connector, **Target Warehouse (Postgres)**. It points at the lab warehouse, the database OpenLDR writes lab data into. The built-in reports and Custom Queries read through it. Do not remove it.

The list shows each connector's **Name**, **Type**, **Allowed plugin host** and an **Enabled** switch. **Allowed plugin host** is the one network host a plugin connector may reach. It is not the saved connection address, and host connectors leave it empty. Open **Edit** to see a host connector's address.

## Example 1: test the warehouse connector

![Opening the row menu of Target Warehouse and selecting Test. Connection OK appears.](connectors-test.mp4)

1. Open **Settings**, then **Connectors**.
2. On the **Target Warehouse (Postgres)** row, open the **⋯** menu and select **Test**.

**Expected result:** **Connection OK** under the row's menu. The test runs from the OpenLDR server, not from your browser, so it proves the server can reach the database.

Each test is written to [Audit](/docs/audit) as `connector.test`, with the outcome.

## Example 2: add a read-only connector for reports

A report or a Custom Query needs to read lab data, not change it, and seldom needs patient names. Give it a database account that can only read the tables it needs. Then even a wrong query cannot change data or read a patient's name.

This example makes an account that can read orders, results, specimens, reports and facilities, but not patients.

### Make the database account

On the server, as the user that runs OpenLDR, run this from the install folder. Replace the password with your own.

```bash
docker compose -f docker-compose.prod.yml exec -T postgres psql -U openldr -d openldr_target <<'SQL'
CREATE ROLE report_reader LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE openldr_target TO report_reader;
GRANT USAGE ON SCHEMA public TO report_reader;
GRANT SELECT ON lab_requests, lab_results, specimens, diagnostic_reports, facilities TO report_reader;
SQL
```

### Add the connector

![Adding Warehouse (read only): Host, Postgres, the address, database, user and password, then Save and Test.](connectors-add.mp4)

1. On **Connectors**, open the page's **⋯** menu and select **Add connector**.
2. In **Name**, type `Warehouse (read only)`. This is the name people pick in workflow nodes and queries.
3. Set **Category** to **Host**. Leave **Plugin** for destinations an installed plugin provides.
4. Set **Database type** to **Postgres**.
5. Fill in the connection:

   | Field | Value |
   | --- | --- |
   | Host | `postgres` |
   | Port | `5432` |
   | Database | `openldr_target` |
   | User | `report_reader` |
   | Password | the password you chose |

6. Open the sheet's **⋯** menu and select **Save**. **Saved Warehouse (read only)** appears, and so does the new row. It starts enabled.
7. On its row, open **⋯** and select **Test**.

**Expected result:** **Connection OK**.

The clip was made on a development install, where the database is at `localhost` port `5433`. On a standard install the server reaches it at `postgres` port `5432`, as in the table.

### See what it can and cannot read

![A new query on Warehouse (read only): orders count 60, then the patients table is refused.](connectors-readonly-query.mp4)

1. Open **Query** and start a new query tab. See [Custom Queries, Example 2](/docs/query#example-2-write-a-query).
2. Set **Connector** to **Warehouse (read only)**.
3. Type `SELECT COUNT(*) AS orders FROM lab_requests` and select **Run**.
4. Replace it with `SELECT COUNT(*) AS patients FROM patients` and select **Run**.

**Expected result:** the first query returns **60**, the orders in the docs sample. The second fails. A red mark appears left of **Connector**. Point at it to read **permission denied for table patients**. The table below still shows the last result that worked, so check the mark, not the table. The account cannot read patient names, whatever query someone writes.

![The red mark's message: permission denied for table patients.](connectors-readonly-denied.png)

This is the way to keep columns private on connector paths. [Data exposure](/docs/data-exposure) does not cover connectors.

## Example 3: change a password

When a database password changes, update the connector. Here the password of `report_reader` changes first, so the connector stops working until it is updated.

1. Change the password in the database:

   ```bash
   docker compose -f docker-compose.prod.yml exec -T postgres psql -U openldr -d openldr_target \
     -c "ALTER ROLE report_reader PASSWORD 'the-new-password'"
   ```

2. Test **Warehouse (read only)** again. It fails with **Test failed: password authentication failed for user "report_reader"**, because the connector still holds the old password.

![The test failing after the password changed.](connectors-test-failed.png)

![Editing the connector, typing the new password, saving and testing again.](connectors-rotate.mp4)

3. On its row, open **⋯** and select **Edit**. **Password** is empty and reads **••• set (leave blank to keep)**. The old password is never shown.
4. Type the new password in **Password**. Leave every other field as it is.
5. Open the sheet's **⋯** menu and select **Save**.
6. Test again.

**Expected result:** **Connection OK**. Workflows, queries and reports that use the connector pick up the new password on their next run. Nothing else needs changing.

## How workflows use connectors

A workflow **Postgres**, **MySQL** or **Microsoft SQL** node, or a **Send Email** node, shows a connector list, not password fields. The list is filtered by type:

- A **Postgres** node lists only Postgres connectors.
- A **Send Email (SMTP)** node lists only SMTP connectors.

So create the connector first, then open the node and pick it. If a connector is missing from a node's list, it is the wrong type or it is disabled.

**The connector's type sets the SQL dialect.** The node's label is only a label. The dialect comes from the connector you attach, so pick one whose type matches your real database.

See [Workflows](/docs/workflows) for a worked example with the warehouse connector.

## Security

- Passwords and tokens are encrypted at rest with the server's encryption key. After saving, they are never shown again.
- To change a secret, edit the connector, type the new one, save and test, as in Example 3. Leave a secret blank to keep the stored one.
- Switch off **Enabled** to stop a connector being used anywhere, without deleting it.
- **Remove** in the row menu deletes the connector and its stored secrets. Anything that points at it fails until you point it elsewhere.
- Give each connector a database account with only the rights it needs, as in Example 2.
- Never put secrets in names, notes, screenshots or workflow labels.
- Keep one connector per real destination. Then changing or disabling it has one clear effect.

## Addresses are seen from the server

The host and port must be reachable **from the OpenLDR server**, not from your laptop.

- In a standard install, OpenLDR runs in Docker Compose. Use the service name and its internal port, for example `postgres` and `5432`.
- If OpenLDR runs directly on a machine, use the address and published port you would use on that machine, for example `localhost` and `5433`.

## Connector types

Set **Category** to **Host** for these. The list under **Database type** holds the email and file services too, despite its label.

| Type | Used by | Fields |
| --- | --- | --- |
| Postgres | Postgres node, Custom Queries, reports | Host, Port (5432), Database, User, Password, Use SSL |
| MySQL / MariaDB | MySQL node, Custom Queries, reports | Host, Port (3306), Database, User, Password, Use SSL |
| Microsoft SQL | Microsoft SQL node, Custom Queries, reports | Host, Port (1433), Database, User, Password, Encrypt, Trust server certificate |
| MongoDB | MongoDB node | Connection details and database |
| Redis | Redis node | Host, Port, Password, DB index |
| SMTP Email | Send Email node | Host, Port, User, Password, Use TLS |
| IMAP Email | Email Trigger node | Host, Port, User, Password, Use TLS |
| Gmail, Microsoft Outlook | Send Email node | Client ID, Client secret, Refresh token, and Tenant for Outlook |
| SFTP | File transfer nodes | Host, Port, User, Password |

For Microsoft SQL, switch on **Encrypt** to require TLS. Switch on **Trust server certificate** only for a self-signed certificate in a test install.

Set **Category** to **Plugin** for a destination an installed output plugin provides, such as a DHIS2 sink. Pick the plugin under **Sink plugin**, then fill **Base URL**, **Username** and **Password**. If the list says no sink plugins are installed, install one from the [Marketplace](/docs/marketplace) first.

## Email connectors

Use **SMTP Email** for the **Send Email** node. It works with any SMTP provider, including Gmail with an App Password, Outlook and Office 365, and relays such as smtp2go or Mailtrap.

Use **Gmail** or **Microsoft Outlook** only if you already have a Google Cloud or Microsoft Entra app with a client ID, client secret and refresh token. That is more setup than most labs need. For Gmail, SMTP is simpler.

| Field | Value |
| --- | --- |
| Host | The mail server, for example `smtp.gmail.com` |
| Port | `587` with **Use TLS** off (STARTTLS), or `465` with **Use TLS** on |
| User | The sending account. It is also the sender address |
| Password | The account password, or an App Password for Gmail |

The recipient is set later, in the Send Email node's **To** field.

### Send from Gmail with an App Password

Once 2-Step Verification is on, Gmail refuses your normal password over SMTP with `534-5.7.9 Application-specific password required`. Use an **App Password** instead: a 16-character password Gmail makes for one app. It skips the second step for that app only, keeps your real password safe, and can be revoked at any time.

1. Turn on **2-Step Verification** at `myaccount.google.com`, under Security. App Passwords need it.
2. Go to `myaccount.google.com/apppasswords`, name it, for example `OpenLDR`, and select **Create**. Copy the 16-character code, shown like `abcd efgh ijkl mnop`.
3. Add a connector with **Category** **Host** and **Database type** **SMTP Email**:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.gmail.com` |
   | Port | `587` |
   | User | `you@gmail.com` |
   | Password | the 16-character App Password |
   | Use TLS | Off |

4. Save, test, and pick this connector in the Send Email node.

If the App Passwords page says it is unavailable, 2-Step Verification is not fully on, or a Google Workspace administrator has turned App Passwords off. Use a relay such as **Mailtrap** for testing, or **smtp2go**.

| Provider | Host | Port | Use TLS |
| --- | --- | --- | --- |
| Gmail | `smtp.gmail.com` | 587 | Off, with an App Password |
| Outlook / Office 365 | `smtp.office365.com` | 587 | Off |
| smtp2go | `mail.smtp2go.com` | 2525 or 587 | Off |
| Mailtrap (testing) | `sandbox.smtp.mailtrap.io` | 587 | Off |

## From the command line

The command line can list, add, read, change, test and remove a database connector. Plugin connectors, such as DHIS2, are added and tested in the studio.

```bash
./openldr connectors list
./openldr connectors add --file new.json
./openldr connectors inspect <id>
./openldr connectors update <id> --file patch.json
./openldr connectors test <id>
./openldr connectors remove <id> --force
```

- `list` prints each connector's id, type or plugin, name, and whether it is on. Add `--json` for JSON. It prints no settings.
- `add` reads `{"name", "type", "config"}` and prints the new id. Example: `{"name":"Reports DB","type":"postgres","config":{"host":"db.internal","port":"5432","database":"lab","user":"reader","password":"..."}}`. Only the type's own fields are accepted, the same as in the studio.
- `test` opens a test connection with the stored credentials. It prints `Connection OK` or the error, and exits 1 when it fails.
- `remove` refuses without `--force`. Anything that uses the connector stops working.
- `inspect` prints JSON with the ordinary `config` and a `secretsSet` true or false for each secret. It never prints a secret.
- `update` takes a JSON patch. Omitted fields stay as stored, and blank secrets keep the stored one. Example: `{"config":{"host":"db.internal","port":"5432"}}`. A rename only: `{"name":"Lab database"}`.
- Output and audit records never hold credential values. Protect any file that holds a new secret, and delete it after.

The connector id is in `openldr connectors list`.

## Editing stored settings

**Edit** shows a host connector's stored ordinary fields: host, port, database and user where the type has them. A secret marked as set stays blank. Leave it blank to keep it, even when you change the host. URLs, unknown fields and plugin settings are not shown.

For a plugin connector, enter **Base URL**, **Username** and **Password** together, or leave all three blank to keep the stored values.

## Query deadlines

PostgreSQL, MySQL and Microsoft SQL connector queries have a 30-second limit. A slow query fails instead of keeping a workflow or report waiting forever. Connecting has its own 30-second limit. There is no timeout field in the connector form.

- PostgreSQL and Microsoft SQL cancel the running request.
- MySQL opens a second connection with the same account to stop the query. That can take one more second, and the account must be allowed to open another connection and end its own sessions.

If a query hits the limit, narrow its date range or filters and check its plan in the database. If the error says `server cancellation failed`, OpenLDR closed its own connection but could not confirm the database stopped the query. Ask the database operator to check active queries.

## Server shutdown

On SIGTERM or SIGINT, the API stops taking requests and stops polling the queue. It waits for active requests, the claimed queue batch and the running projection cycle, then closes its databases. A second signal does not start a second shutdown.

A handler that never returns can keep shutdown waiting forever. Give active imports enough time before the service manager forces the stop. After the worker stops, manual drains still work until the context closes.

## On a phone

On a phone, the connectors table is wider than the screen. Scroll it sideways to reach each row's **⋯** menu, at the end of the row. The **Add connector** sheet fills the screen, with labels to the left of each box.

## Troubleshooting

- **`534-5.7.9 Application-specific password required` (Gmail).** Use an App Password, not your login password.
- **Invalid login, or authentication failed.** The user or password is wrong. Edit the connector and type the secret again.
- **Connection refused, or a timeout.** The host or port is wrong, or the server cannot reach it. Check the Docker service name against `localhost`.
- **TLS or SSL error.** Match **Use SSL**, **Use TLS** or **Encrypt** to what the server needs. For SMTP, 587 means **Use TLS** off and 465 means on.
- **permission denied for table.** The database account lacks rights to that table. That may be on purpose, as in Example 2.
- **A query fails but the old result is still on screen.** Query keeps the last result that worked. The red mark left of **Connector** holds the error. Point at it to read it.
- **A connector is missing from a node's list.** Its type does not match the node, or it is disabled.
- **The test passes but a workflow fails.** Open the workflow's **Runs** tab and read the node's error. See [Workflows, Example 3](/docs/workflows#example-3-read-the-run). The query or its rights are the usual cause.

## Related guides

- [Workflows](/docs/workflows)
- [Custom Queries](/docs/query)
- [Data exposure](/docs/data-exposure)
- [Scheduled reports with workflows](/docs/report-pipeline)
- [Marketplace](/docs/marketplace)
- [Settings](/docs/settings)
