# Connect to SQL Server and diagnose a connection

## Outcome

You can connect CE to a SQL Server named instance or with a Windows account. When a connection fails, you can see which step failed and what to change.

## Before you begin

- You need the `connectors.manage` capability (lab administrators have it).
- Know the server name, and the instance name if there is one. SQL Server Management Studio shows them as `SERVER\INSTANCE`.
- Know whether the account is a SQL login or a Windows account.

## Fill in the SQL Server form

Open **Settings > Connectors**, open the **⋯** menu, and choose **Add connector**. Pick the host category and **Microsoft SQL**.

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

## Diagnose a connection

Open the connector row's **⋯** menu and choose **Diagnose**. CE runs these checks in order and stops at the first failure. Steps after a failure show as skipped.

| Step | What it checks |
| --- | --- |
| Settings | A host is set and the port is a valid number. |
| Server name | The name resolves to an address from the CE server. |
| SQL Server Browser | Only for a named instance. SQL Server Browser on UDP port 1434 lists the instance and its TCP port. |
| Port | The TCP port answers. |
| Login | CE can log in and open the database. |
| Server version | CE can run a query, and shows the server version. |

Each failed step shows what to change. Fix it, then choose **Run again** from the sheet's **⋯** menu.

## Common fixes

- **Port: no answer.** A firewall blocks the port. Open it on the database server, or on the network between the two machines.
- **Port: nothing listens.** TCP/IP is turned off, or the port is wrong. Enable TCP/IP in SQL Server Configuration Manager.
- **SQL Server Browser: no answer.** Start the SQL Server Browser service and open UDP 1434. Or clear the instance name and enter the instance's fixed TCP port.
- **Login refused.** Check the user and password. SQL Server may allow Windows accounts only. Then fill in the Windows domain.
- **Certificate not trusted.** Turn on **Trust server certificate**.
- **Old TLS refused.** Turn **Encrypt** off, or update the SQL Server.

## From the command line

Run the same checks on a headless server:

```bash
openldr connectors diagnose <connector-id>
```

Add `--json` for machine-readable output. The command exits with code 1 when a step fails.
