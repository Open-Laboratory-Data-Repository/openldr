# Diagnose connections

Use Diagnose when a saved host connector cannot connect. It checks the settings, server name, port, login and server version in order.

You need **Manage connectors**. Diagnosis runs from the OpenLDR server using stored credentials. It opens a test connection but does not import data.

Use your own saved connection. The pictures show a real isolated Postgres connection and a deliberately absent SQL Server instance. A failed example does not prove a SQL Server login works.

## Diagnose a saved connection

Begin with a connection you already use, or the warehouse connector on a new installation.

### 1. Open Connectors

Open **Settings**, then **Connectors**.

![Open Settings, then Connectors.](connector-diagnose-guide-open.png)

### 2. Choose Diagnose

Open the host connector row dots and select **Diagnose**. Checks start as the sheet opens.

![Choose Diagnose from a host connector row.](connector-diagnose-guide-diagnose.png)

### 3. Read the settings result

Read the status and message for each step. A warning gives advice without stopping the later checks.

![Read the actual status of each diagnosis step.](connector-diagnose-guide-passed.png)

### 4. Read the connection results

Check **Port**, **Login** and **Server version**. The local Postgres example passes all checks.

![Port, Login and Server version confirm the tested connection.](connector-diagnose-guide-login.png)

### 5. Repeat when needed

Open the diagnosis sheet dots and select **Run again**. This uses the currently saved settings.

![Run again repeats the checks with saved settings.](connector-diagnose-guide-again.png)

**Expected result:** A successful run ends with All checks passed. It proves the tested connection. It does not prove a particular report query, source schema or account permission.

## Enter SQL Server settings

Ask the database operator whether you have a named instance, a fixed TCP port, a SQL login or a Windows domain account. Do not create the fictional connection unless you want an isolated failure example.

### 1. Add a host connector

Close the diagnosis sheet. Open the Connectors page dots and choose **Add connector**. Enter a useful name and set Category to **Host**.

![Choose Add connector for a SQL Server connection.](connector-diagnose-guide-add.png)

### 2. Choose Microsoft SQL

Set **Database type** to **Microsoft SQL**.

![Choose Microsoft SQL.](connector-diagnose-guide-sql-type.png)

### 3. Enter server and instance

Enter **Host**. A pasted `SERVER\INSTANCE` splits into Host and Instance name when you leave the field. Use a fixed Port only when Instance name is empty.

![A pasted server and instance are split into separate fields.](connector-diagnose-guide-split.png)

### 4. Enter database and account

Fill **Database**, **User** and **Password**. For a Windows account, fill Windows domain and use the username without the domain. Leave the domain blank for a SQL login.

![Enter the database and login. Windows domain is only for a Windows account.](connector-diagnose-guide-login-fields.png)

### 5. Check encryption

**Encrypt** starts on. Use the server operator's encryption and certificate requirements. Trust server certificate accepts a server certificate without normal certificate validation.

![Encrypt starts on. Match encryption and certificate settings to your server.](connector-diagnose-guide-encryption.png)

### 6. Save the connector

Open the sheet dots and choose **Save**.

![Save stores settings before diagnosis.](connector-diagnose-guide-save.png)

**Expected result:** The saved connector can now be diagnosed. The screenshot example intentionally names an instance that does not exist.

## Read and correct a failed diagnosis

Diagnosis stops at the first failed check. Later steps show as skipped, so they have no result yet.

### 1. Diagnose the saved row

Open its row dots and choose **Diagnose**.

![Choose Diagnose on the saved named instance.](connector-diagnose-guide-bad-diagnose.png)

### 2. Read the first failure

Read the failed step and correction message. This example gets no SQL Server Browser reply for its absent named instance.

![This deliberately absent instance fails at SQL Server Browser.](connector-diagnose-guide-browser-failure.png)

### 3. Check which steps were skipped

Here Port, Login and Server version were not attempted. Do not treat a skipped login as an accepted password.

![Later steps are skipped after the first failure.](connector-diagnose-guide-skipped.png)

### 4. Correct the saved settings

Close diagnosis, open row dots and choose **Edit**. Check Host and Instance name. If your operator supplies a fixed TCP port, clear Instance name and enter that port. Save any change, then diagnose again.

![Check the server and instance. Alternatively clear Instance name and enter the real fixed TCP port.](connector-diagnose-guide-correction.png)

**Expected result:** Follow the actual failed step. The correction can require a database service, firewall or name-resolution change outside OpenLDR. The absent instance was not repaired.

## Read diagnosis on a phone

The same row menu opens diagnosis at phone width.

### 1. Read the check messages

Open Diagnose, then scroll inside the sheet to read each result. Messages wrap beneath the step name.

![The phone diagnosis sheet wraps each step message.](connector-diagnose-guide-phone.png)

## What the checks mean

**Settings.** A host is present and the port is valid. A localhost warning reminds you that Docker containers have their own loopback address.

**Server name.** The OpenLDR server resolves the name to an address. A successful lookup does not prove the database port answers.

**SQL Server Browser.** For a named SQL Server instance, UDP 1434 reports its TCP port. Ask the operator to start Browser and allow UDP, or use the actual fixed TCP port with no instance name.

**Port.** A TCP connection opens. A wrong service can still answer the port.

**Login.** The saved account opens the database. Check username, password, domain and database access when this fails.

**Server version.** The server answers a small query. This still does not prove the tables or columns required by an importer exist.

## Run the same check from the CLI

Follow [Start here](/docs/start-here) for CLI setup. From `openldr_ce`, list connectors to get the id. Diagnose exits 1 when a step fails. Add `--json` for structured results.

```shell
pnpm openldr connectors list
pnpm openldr connectors diagnose <id>
pnpm openldr connectors diagnose <id> --json
```

## Optional practice and limits

No sample data is needed. Test your existing warehouse connector first. A disposable Microsoft SQL connector with a nonexistent instance can demonstrate the Browser failure. Remove that example afterward through its row dots and confirmation.

The documented checks exercised actual Postgres success and a real UDP timeout for an absent named instance. It did not exercise Windows authentication, a working named SQL Server instance, certificate replacement or an old TLS server.

## Troubleshooting

**The first check fails.** Read that check before the skipped results. Correct the saved settings in Edit and run Diagnose again.

**Browser times out for a named SQL Server instance.** Check the server and instance names and whether SQL Server Browser is reachable. Later checks are skipped until discovery succeeds.

**All checks pass but the importer fails.** Diagnosis verifies the connection and server response. It does not prove that the account can read each required source table.

## Related guides

[Connectors](/docs/connectors) covers creation, testing and secret changes. [Import from OpenLDR v1](/docs/v1-import) uses a database connector.
