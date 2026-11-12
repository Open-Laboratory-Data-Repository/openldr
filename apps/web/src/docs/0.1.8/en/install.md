# Install

Install OpenLDR on your chosen host. The sign-in walkthrough is deferred until we capture a fresh installation. This walkthrough uses the bundled PostgreSQL analytics database and a local address. You do not need to load sample data.

<!-- install-platform -->

Choose the platform of the **computer hosting OpenLDR** above. It may differ from the device you are using to read this guide. The commands, paths and terminal illustrations change together.

Read [Requirements](/docs/requirements) first. For Windows Server, prepare the Linux environment in [Windows Server](/docs/windows-server), then follow the Linux commands here. For an existing installation, use [Planned upgrades](/docs/upgrading).

The example installation folder is `~/Downloads/openldr_ce`. Choose a folder you can write to. If you choose another location, change the install command and later paths together. Terminal and file-browser pictures are illustrations. Select a picture to enlarge it.

The blue text ending in `$` or `>` is the **prompt**. The terminal displays it; do not type it. Type the command after it and press **Enter**. The lighter lines below are **output** from the program; read them, do not type them. For example, `docker --version` is a command and `Docker version 29.5.2, build 79eb04c` is its response. Copyable code blocks contain commands only. Names, paths and versions in your terminal may differ. Some illustrations show commands without their output; wait for each command to finish before running the next.

## Prepare the host

You will open a terminal, check Docker and download the installer. Run these commands on the computer that will host OpenLDR.

### 1. Open a terminal

<!-- install:unix -->
On Linux, open **Terminal** from your application menu. On macOS, open Spotlight, type **Terminal** and open it.
<!-- /install -->
<!-- install:windows -->
Open Start, type **PowerShell** and open **Windows PowerShell**. Keep this window open for the following steps.
<!-- /install -->

![Illustrated terminal, ready to receive a command.](guide:install-terminal)

### 2. Check Docker

Enter each command below and press **Enter** after each one.

```
{{install:check}}
```

The first two print version numbers. `docker info` must include a **Server** section without a connection error. Version numbers and other details will differ from the illustration. If Docker is missing or cannot connect, resolve that before continuing.

![Illustrated Docker checks. Your version numbers and server details will differ.](guide:install-check)

### 3. Download the installer

Copy these commands into the same terminal and press **Enter**.

```
{{install:download}}
```

<!-- install:unix -->
This creates your Downloads folder if needed, then saves the installer as `~/Downloads/openldr-install.sh`. A successful download with these options normally prints nothing.
<!-- /install -->
<!-- install:windows -->
This stores the downloaded script in the `$installer` variable. Include `$installer` exactly as written. It is part of the PowerShell command, not a terminal prompt. Keep this window open; the next step uses the same variable.
<!-- /install -->

![Illustrated installer download command. Use the matching copyable command above.](guide:install-download)

**Expected result:** The download returns without an error. Nothing has been installed yet.

## Install and find your files

The next command creates your installation folder, generates passwords, downloads the container images and starts the services. The first download can take time.

### 1. Run the installer

Enter this command and press **Enter**.

```
{{install:run}}
```

The sample-free option is intentional. To include the starter dashboard and demo data on a fresh installation, omit `--seedless` on Linux/macOS or `-Seedless` on Windows. Your own data works with either choice.

![Illustrated install command with the example installation folder and sample-free option.](guide:install-run)

### 2. Wait for readiness and keep the setup code

Wait for **OpenLDR is ready**. Keep the printed address and **Setup code**. In Studio, the **Create the administrator** page asks for this code to make the first administrator. The code works for 30 minutes. On Linux and macOS, `./openldr auth setup-code` prints a new one. On Windows, use `.\openldr.ps1 auth setup-code`. An install made with `--auth keycloak` prints a Keycloak admin password and an **App sign-in** username and password instead.

If the message says **OpenLDR is starting**, follow **Check an installation that is still starting** below. A successful script exit alone does not prove every service is ready.

![Illustrated final installer output. The setup code is a placeholder; use the code printed on your host.](guide:install-ready)

### 3. Find the installation folder

Open `~/Downloads/openldr_ce` in your file browser. It contains `config`, `data`, `docker-compose.yml` and the OpenLDR launcher.

<!-- install:unix -->
The launcher is `openldr`.
<!-- /install -->
<!-- install:windows -->
The launcher is `openldr.ps1`.
<!-- /install -->

The hidden `.env` file contains generated settings and passwords. Keep it with the installation and keep it private.

![Illustrated file browser showing the example installation folder and generated files.](guide:install-folder)

**Expected result:** Services are ready, you have the setup code, and you can find the installation files.

## Check an installation that is still starting

Use this task when the installer reports that a service is still starting. Run commands on the OpenLDR host. Do not change or delete the database to diagnose a startup error.

### 1. Read the container status

```
{{install:status}}
```

The STATUS column shows whether each service is running, healthy or restarting. This list is a check, not a sample success result.

![Illustrated terminal: Read the container status.](guide:install-status)

### 2. Read the recent logs and resolve the reported error

```
{{install:logs}}
```

Read the error before retrying. Fix the named cause, then repeat the status check. Do not treat a successful installer exit as proof that services are ready.

| Error | Next action |
| --- | --- |
| Docker is not installed | Install Docker using [Requirements](/docs/requirements), then repeat the Docker checks. |
| Docker daemon is not running | Start Docker Desktop on Windows/macOS, or Docker's service on Linux, then repeat `docker info`. |
| Compose plugin not found | Install the plugin or update Docker Desktop, then repeat `docker compose version`. |
| Port 80 or 443 is in use | Identify the existing service. For a new installation, choose free gateway ports with `--http-port 8080 --https-port 8443` or `-HttpPort 8080 -HttpsPort 8443`. Include `:8443` in the URL. |
| Download failed | Check network access and repeat the download step. Do not run an empty or partial script. |

![Illustrated terminal: Read the recent logs and resolve the reported error.](guide:install-logs)

## Choose an address for other computers

Choose the address before the first installation. It must resolve to and reach your OpenLDR host from the intended computers or phones. This can be a private-network or Tailscale address. Replace `openldr.example.org` in both steps. DNS, routing and firewall access must be set up for your network.

### 1. Run the installer with the chosen hostname

```
{{install:remote}}
```

The installer uses this hostname for the gateway and sign-in redirects. The example uses a self-signed certificate and leaves sample data out. Use this command instead of the earlier local installation command.

![Illustrated terminal: Run the installer with the chosen hostname.](guide:install-remote)

### 2. Check from another computer

```
{{install:remote-check}}
```

Run this from a different computer on the intended network. On Linux/macOS, the command checks the remote API and uses `-k` for the self-signed certificate only. On Windows, `TcpTestSucceeded: True` proves TCP access to port 443. Neither check proves Studio sign-in. Open the configured HTTPS address in a browser as well. With a non-default port, change the check and URL to that port.

![Illustrated terminal: Check from another computer.](guide:install-remote-check)

**Expected result:** The chosen address reaches the gateway from another computer. If you already installed with another hostname, read the installer's host-change warning. Existing Keycloak clients retain their old redirect addresses and may need an update. Changing the browser URL alone does not change authentication settings.

## Use a public domain with a trusted certificate

This optional task is for a **Linux host**. First point your domain at the host and allow incoming TCP 80 and 443. Replace `openldr.example.org` and `you@example.org` with your own domain and email. Use the installer downloaded above.

### 1. Run with your domain and email

```
{{install:tls}}
```


![Illustrated Linux installer command for a public domain. Replace the example domain and email.](guide:install-tls)

### 2. Check certificate issuance

Look for **Trusted cert installed**. If issuance fails, the installer leaves the self-signed certificate in place. Correct the DNS or port error and rerun with the same installation folder, domain and email.

![Illustrated successful certificate message for the example public domain.](guide:install-tls-ready)

### 3. Check renewal setup

When run as root, the installer creates `/etc/cron.d/openldr-cert`. When run without root, it prints a complete cron entry for you to add with `crontab -e`. Copy the entry printed on your host; it contains your actual installation path. Save and exit the editor using its displayed controls.

![Illustrated command for opening the current user's cron schedule. Use the renewal entry printed by your installer.](guide:install-renewal)

**Expected result:** The public address serves the trusted certificate and a renewal job is configured. Do not assume renewal was installed automatically when the installer printed instructions to add it yourself.

Windows and macOS hosts can use their own certificate or an existing reverse proxy instead. See the next task.

## Use your own certificate

Use this if you already have a certificate and private key. Replace the example domain with your host's address. The files must be named `fullchain.pem` and `privkey.pem` in the generated certificate folder.

### 1. Create the configuration without starting services

```
{{install:scaffold}}
```

![Illustrated command that creates the installation files without starting the services.](guide:install-scaffold)

### 2. Copy your certificate and key

Replace the source paths below with the locations of your own files.

```
{{install:certificates}}
```

![Illustrated certificate-copy commands. Replace the source paths with your actual files.](guide:install-certificates)

### 3. Start the services and inspect their status

```
{{install:start}}
```

![Illustrated commands for starting the configured services and checking their status.](guide:install-start)

### 4. Restart the gateway if replacing files on an existing installation

```
{{install:restart-gateway}}
```

Skip this step for a new installation started above. For an existing installation, replace its certificate and key first, then restart its gateway from that same installation folder.

![Illustrated terminal: Restart the gateway if replacing files on an existing installation.](guide:install-restart-gateway)

### 5. Check the certificate from the client computer

```
{{install:certificate-check}}
```

Replace the example hostname with the one on your certificate. Use this from a client that trusts its issuer. A certificate trust or hostname error needs to be resolved, not hidden with `-k`. The check verifies the HTTPS response, not Studio sign-in.

![Illustrated terminal: Check the certificate from the client computer.](guide:install-certificate-check)

**Expected result:** The configured address responds over HTTPS with your certificate. Studio sign-in remains deferred until the fresh-install walkthrough.

## Choose an analytics database

Choose one analytics database before the first installation. The normal walkthrough uses bundled PostgreSQL. The alternatives below replace that choice; do not run each one in sequence. An existing `.env` keeps its database configuration, so rerunning the installer with different flags is not a database migration. All examples keep sample data optional with `--seedless` or `-Seedless`.

## Try SQL Server for evaluation

OpenLDR keeps operational data in internal PostgreSQL and writes analytics to the chosen target database. This optional task adds a SQL Server 2022 Developer container. It is for evaluation only. Developer edition is not licensed for production. See [Microsoft edition guidance](https://www.microsoft.com/en-us/sql-server/sql-server-downloads).

### 1. Run the SQL Server evaluation installation

```
{{install:mssql-demo}}
```

Use the installer downloaded earlier. This generates the database password and creates the demonstration target database.

![Illustrated terminal: Run the SQL Server evaluation installation.](guide:install-mssql-demo)

### 2. Check the containers and selected adapter

```
{{install:mssql-status}}
```

Expect the additional `mssql` service and adapter value `mssql`. Read actual container status rather than assuming success. For logs, use the same two `-f` files and replace `ps` with `logs --tail 100`.

![Illustrated terminal: Check the containers and selected adapter.](guide:install-mssql-status)

### 3. Keep the generated database credential

Read the MSSQL demo password line from your installer output. The picture uses a placeholder. This is the database SA password, separate from Studio sign-in. Keep it private.

![Illustrated terminal: Keep the generated database credential.](guide:install-mssql-ready)

## Connect your SQL Server analytics database

Use a self-hosted SQL Server 2017, 2019 or 2022. Earlier versions and managed cloud databases such as Azure SQL or AWS RDS are unsupported. The target database and login must already exist and be reachable from the Docker network. This task does not create your external database.

### 1. Install using your connection details

```
{{install:mssql-existing}}
```

Replace `sql.internal`, `openldr_target`, `openldr` and `REPLACE_WITH_DATABASE_PASSWORD` with your host, database, login and password. The installer writes connection settings to `.env`; avoid `#`, spaces and quotes in the password. Optional flags are listed below. Do not use a real password in a shared screenshot.

![Illustrated terminal: Install using your connection details.](guide:install-mssql-existing)

### 2. Check the selected adapter and service status

```
{{install:target-status}}
```

Expect adapter value `mssql`. Check the actual logs if the API is not ready. An adapter value confirms configuration, not a successful data import. These settings map to `TARGET_STORE_ADAPTER=mssql` and `MSSQL_*` in [Environment variables](/docs/environment).

![Illustrated terminal: Check the selected adapter and service status.](guide:install-target-status)

## Try MySQL for evaluation

This optional task adds a MySQL 8.4 container. Internal PostgreSQL remains part of OpenLDR. Use the bundled MySQL container for evaluation only, not production.

### 1. Run the MySQL evaluation installation

```
{{install:mysql-demo}}
```

Use the installer downloaded earlier. It generates the database password and creates the demonstration target database.

![Illustrated terminal: Run the MySQL evaluation installation.](guide:install-mysql-demo)

### 2. Check the containers and selected adapter

```
{{install:mysql-status}}
```

Expect the additional `mysql` service and adapter value `mysql`. Check actual status. For logs, use the same two `-f` files and replace `ps` with `logs --tail 100`.

![Illustrated terminal: Check the containers and selected adapter.](guide:install-mysql-status)

### 3. Keep the generated database credential

Read the MySQL demo root password line from your installer output. The illustration uses a placeholder. This database credential is separate from Studio sign-in. Keep it private.

![Illustrated terminal: Keep the generated database credential.](guide:install-mysql-ready)

## Connect your MySQL or MariaDB analytics database

Use a self-hosted MySQL 8.4 LTS or MariaDB 11.4 LTS. Managed cloud databases such as Azure Database for MySQL or AWS RDS are unsupported. The target database and login must already exist and be reachable from the Docker network. Internal PostgreSQL is still required.

### 1. Install using your connection details

```
{{install:mysql-existing}}
```

Replace `mysql.internal`, `openldr_target`, `openldr` and `REPLACE_WITH_DATABASE_PASSWORD` with your connection details. Avoid `#`, spaces and quotes in the password written to `.env`. See the optional flags below. Do not put real passwords in shared screenshots.

![Illustrated terminal: Install using your connection details.](guide:install-mysql-existing)

### 2. Check the selected adapter and service status

```
{{install:target-status}}
```

Expect adapter value `mysql`, including for MariaDB. Check actual service status and logs. This confirms configuration, not a successful import. These settings map to `TARGET_STORE_ADAPTER=mysql` and `MYSQL_*` in [Environment variables](/docs/environment).

![Illustrated terminal: Check the selected adapter and service status.](guide:install-target-status)

## Installer flags

| Linux / macOS | Windows | Default | Purpose |
| --- | --- | --- | --- |
| `--http-port <n>` / `--https-port <n>` | `-HttpPort / -HttpsPort` | `80` / `443` | Gateway ports. Windows: `-HttpPort` / `-HttpsPort`. |
| `--ready-timeout <seconds>` | `-ReadyTimeout` | `180` | Readiness wait. Windows: `-ReadyTimeout`. Zero skips the wait. |
| `--require-ready` | Not available | off | Linux/macOS only. Exit with failure if readiness times out. Cannot combine with `--no-start` or a zero timeout. |
| `--dir <path>` | `-Dir` | `./openldr` | Directory to scaffold the stack into. |
| `--version <tag>` | `-Version` | `latest` | Image tag to pull and run. |
| `--server-name <host>` | `-ServerName` | `localhost` | Public hostname/domain for this deployment. |
| `--letsencrypt <email>` | Not automated | not set | Issue a trusted Let's Encrypt certificate for `--server-name`. |
| `--staging` | Not available | off | Use the Let's Encrypt staging CA (testing; avoids rate limits). |
| `--no-start` | `-NoStart` | off | Scaffold and configure only; don't start the stack. |
| `--no-pull` | `-NoPull` | off | Skip pulling images (use what's already local). |
| `--seedless` | `-Seedless` | off (seeded) | Empty first run. Skip the seeded sample dashboard + demo data (the default seeds them). Windows: `-Seedless`. Fresh install only. |
| `--auth <mode>` | `-Auth` | asks, else `local` | Sign-in for a new install: `local` or `keycloak`. `local` keeps OpenLDR's own accounts and runs no Keycloak. Without the flag the installer asks when it has a terminal, and otherwise uses `local`. A re-run keeps the mode the install was made with. Windows: `-Auth`. |
| `--target-db <db>` | `-TargetDb` | `postgres` | External analytics database: `postgres`, `mssql`, or `mysql`. |
| `--mssql-demo` | `-MssqlDemo` | off | Bundle a SQL Server 2022 container (evaluation only); implies `--target-db mssql`. |
| `--mssql-host <host>` | `-MssqlHost` | not set | BYO SQL Server host (required for `--target-db mssql` without `--mssql-demo`). |
| `--mssql-port <n>` | `-MssqlPort` | `1433` | BYO SQL Server port. |
| `--mssql-database <name>` | `-MssqlDatabase` | `openldr_target` | Target database name (must already exist for BYO). |
| `--mssql-user <user>` | `-MssqlUser` | not set | BYO SQL Server login. |
| `--mssql-password <pw>` | `-MssqlPassword` | not set | BYO SQL Server password (avoid `#`, spaces, quotes). |
| `--mssql-encrypt <bool>` | `-MssqlEncrypt` | `false` | Encrypt the SQL Server connection. |
| `--mssql-trust-cert <bool>` | `-MssqlTrustCert` | `true` | Trust the server's TLS certificate (self-signed on-prem). |
| `--mysql-demo` | `-MysqlDemo` | off | Bundle a MySQL 8.4 container (evaluation only); implies `--target-db mysql`. |
| `--mysql-host <host>` | `-MysqlHost` | not set | BYO MySQL/MariaDB host (required for `--target-db mysql` without `--mysql-demo`). |
| `--mysql-port <n>` | `-MysqlPort` | `3306` | BYO MySQL/MariaDB port. |
| `--mysql-database <name>` | `-MysqlDatabase` | `openldr_target` | Target database name (must already exist for BYO). |
| `--mysql-user <user>` | `-MysqlUser` | not set | BYO MySQL/MariaDB login. |
| `--mysql-password <pw>` | `-MysqlPassword` | not set | BYO MySQL/MariaDB password (avoid `#`, spaces, quotes). |
| `--mysql-ssl <bool>` | `-MysqlSsl` | `false` | Enable SSL/TLS for the MySQL/MariaDB connection. |

## Related guides

- [Requirements](/docs/requirements)
- [CLI reference](/docs/cli)
- [Environment variables](/docs/environment)
- [Development from source](/docs/development)
- [Planned upgrades](/docs/upgrading)
