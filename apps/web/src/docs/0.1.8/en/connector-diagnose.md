# SQL Server connections and diagnosis

A Microsoft SQL connector accepts a named instance and a Windows account. Type the host as `SERVER\INSTANCE`, or put the instance in **Instance name**. CE then asks SQL Server Browser on UDP port 1434 for the instance's port and ignores the **Port** field. Fill in **Windows domain** to log in with a Windows account. Leave it empty for a SQL login.

**Encrypt** is on unless you turn it off. An old SQL Server (2008 or 2012) may only offer a TLS version that CE refuses. Turn Encrypt off for that server.

When CE runs in Docker, `localhost` is the CE container. Use the database server's name or IP address.

To find out why a connection fails, open the connector row's **⋯** menu and choose **Diagnose**. CE checks, in order: the settings, the server name, SQL Server Browser (named instances only), the TCP port, the login, and the server version. It stops at the first failure and says what to change. Headless servers run the same checks with `openldr connectors diagnose <connector-id>`. Add `--json` for machine-readable output. The command exits with code 1 when a step fails.
