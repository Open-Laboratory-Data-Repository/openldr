# Connect to SQL Server and diagnose a connection

CE can connect to a SQL Server **named instance** and with a **Windows account**, as many lab systems need. When any database connection fails, **Diagnose** checks it one step at a time and says which step broke and what to change.

This guide takes about 10 minutes. Select any picture or clip to enlarge it.

## Who can do what

You need **Manage connectors**. Lab administrators have it.

## Before you start

- Know the server name, and the instance name if there is one. SQL Server Management Studio shows them as `SERVER\INSTANCE`.
- Know whether the account is a SQL login or a Windows account.

## Example 1: diagnose a connection that works

![Choosing Diagnose on Target Warehouse (Postgres). Every step passes.](connector-diagnose-ok.mp4)

1. Open **Settings**, then **Connectors**.
2. On the **Target Warehouse (Postgres)** row, open **⋯** and select **Diagnose**.

**Expected result:** **All checks passed.** Each step shows what it found: the address, the name resolved to `127.0.0.1`, the port open, the login, and the server version.

![The diagnosis of the warehouse connector.](connector-diagnose-passed.png)

On this test install the **Settings** step shows a warning: the host is `localhost`. When CE runs in Docker, `localhost` means the CE container itself, not the machine that runs the database. Use the server's name or IP address.

## Example 2: a named instance that does not answer

Add a connector for a v1 database on a named instance, and see the diagnosis find the broken step.

![Adding a Microsoft SQL connector with localhost\SQLEXPRESS as the host.](connector-diagnose-add.mp4)

1. On **Connectors**, open the page's **⋯** menu and select **Add connector**.
2. Set **Category** to **Host** and **Database type** to **Microsoft SQL**.
3. Fill in the form:

   | Field | Example value |
   | --- | --- |
   | Name | `v1 database (example)` |
   | Host | `localhost\SQLEXPRESS` |
   | Database | `OpenLDRData` |
   | User | `v1_reader` |
   | Password | the account's password |

   ![The Microsoft SQL form.](connector-diagnose-form.png)

4. Open the sheet's **⋯** menu and select **Save**.
5. On the new row, open **⋯** and select **Diagnose**.

![Diagnosing the new connector. It stops at SQL Server Browser.](connector-diagnose-browser.mp4)

**Expected result:** **The connection check failed at: SQL Server Browser.** Server name passed. SQL Server Browser shows **no reply from SQL Server Browser within 3000 ms**, with the fix: start the SQL Server Browser service, open UDP 1434 in the firewall, or clear the instance name and enter the fixed TCP port. Port, Login and Server version were not tried.

![The diagnosis, stopped at SQL Server Browser.](connector-diagnose-failed.png)

The Host box keeps `localhost\SQLEXPRESS` as typed. CE splits it into server and instance when it connects, which is why the SQL Server Browser step ran. Fix the instance or the firewall, then choose **Run again** from the diagnosis sheet's **⋯** menu.

To remove the example, open its row's **⋯** menu and select **Remove**.

## The SQL Server form

| Field | What to enter |
| --- | --- |
| Host | The server name or IP address. You can also type `SERVER\INSTANCE`. CE splits it for you. |
| Instance name | The part after the backslash, for example `SQLEXPRESS`. Leave it empty for the default instance. |
| Port | Usually `1433`. CE ignores the port when an instance name is set, because SQL Server Browser reports the instance's port. |
| Database | The database name. |
| Windows domain | Leave empty for a SQL login. Fill it in for a Windows account, for example `LAB`. |
| User | The SQL login, or the Windows user name without the domain. |
| Password | The password. It is stored encrypted. |
| Encrypt | On by default. Turn it off for an old SQL Server (2008 or 2012) that only offers old TLS. |
| Trust server certificate | Turn on for a server inside the lab network that uses its own certificate. |

When CE runs in Docker, `localhost` means the CE container, not your server. Use the server's name or IP address.

## The steps of a diagnosis

CE runs these in order and stops at the first failure. Steps after a failure show as skipped.

| Step | What it checks |
| --- | --- |
| Settings | A host is set and the port is a valid number. |
| Server name | The name resolves to an address from the CE server. |
| SQL Server Browser | Only for a named instance. SQL Server Browser on UDP port 1434 lists the instance and its TCP port. |
| Port | The TCP port answers. |
| Login | CE can log in and open the database. |
| Server version | CE can run a query, and shows the server version. |

Each failed step says what to change.

## Troubleshooting

- **Server name does not resolve.** Use the IP address, or add the name to DNS or the hosts file of the CE server.
- **Port: no answer.** A firewall blocks the port. Open it on the database server, or on the network between the two machines.
- **Port: nothing listens.** TCP/IP is turned off, or the port is wrong. Enable TCP/IP in SQL Server Configuration Manager.
- **SQL Server Browser: no answer.** Start the SQL Server Browser service and open UDP 1434. Or clear the instance name and enter the instance's fixed TCP port.
- **SQL Server Browser answered, but the instance is not listed.** Check the instance name, and enable TCP/IP for it.
- **Login refused.** Check the user and password. SQL Server may allow Windows accounts only. Then fill in the Windows domain.
- **The database does not open.** The login worked, but the database is missing or the user cannot open it. Check the name and the user's access.
- **Certificate not trusted.** Turn on **Trust server certificate**.
- **Old TLS refused.** Turn **Encrypt** off, or update the SQL Server.

## From the command line

Run the same checks on a headless server:

```bash
openldr connectors diagnose <connector-id>
```

For the warehouse connector of Example 1 it prints:

```text
WARN  config   localhost:5433
      When CE runs in Docker, localhost is the CE container itself. Use the server name or IP address of the machine that runs the database.
PASS  dns      localhost resolved to 127.0.0.1
PASS  tcp      port 5433 is open
PASS  login
PASS  version  PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit

All checks passed.
```

Add `--json` for machine-readable output. The command exits with code 1 when a step fails. Get the id with `GET /api/connectors`.

## On a phone

The diagnosis sheet covers most of the screen on a phone, and each step's message wraps under it. The connectors table is wider than the screen, so scroll it sideways to reach each row's **⋯** menu.

## Related guides

- [Connectors](/docs/connectors)
- [Setup checks](/docs/setup-checks)
- [Import from OpenLDR v1](/docs/v1-import)
