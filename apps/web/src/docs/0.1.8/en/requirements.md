# Requirements

Check the computer that will host OpenLDR before running the installer. Other computers and phones connect to Studio in a browser. They do not need Docker or the OpenLDR CLI.

This page covers the packaged installation. A [source checkout for development](/docs/development) has separate requirements. Sample data is optional.

## Choose a compatible host

OpenLDR runs **Linux containers**. Docker installed in Windows-container mode is not enough.

The default image build targets **Linux AMD64**, for 64-bit Intel and AMD processors. The published `openldr-api:latest` image currently contains `linux/amd64`, with no native ARM64 image. Docker support for an ARM computer does not establish OpenLDR image compatibility. Apple Silicon and other ARM hosts need a separate compatibility check before you choose them for this installation.

| Host | What to prepare |
| --- | --- |
| Linux on Intel/AMD 64-bit | [Docker Engine](https://docs.docker.com/engine/install/) and the Compose plugin on a supported Linux distribution. |
| Windows client on Intel/AMD 64-bit | [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) on a Windows version Docker currently supports. Use its Linux-container backend. Hardware virtualisation must be enabled. |
| Intel Mac | [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) on a supported macOS version. |
| Windows Server | Docker Engine inside a Linux environment. The [Windows Server guide](/docs/windows-server) covers WSL2 on updated Server 2022/2025 and a Hyper-V Linux VM. Docker Desktop is not supported on Windows Server. |

Microsoft documents the [WSL setup for Server 2022 and 2025](https://learn.microsoft.com/en-us/windows/wsl/install-on-server). For earlier server versions, use the Linux VM path in our Windows Server guide rather than assuming that WSL means WSL2.

## Have the software and access ready

| Item | Requirement |
| --- | --- |
| Docker | A maintained Docker Engine or Docker Desktop installation. The Docker service must be running and accessible from the account running the installer. |
| Compose | The `docker compose` command must work. An old `docker-compose` command alone does not satisfy the installer. |
| Linux/macOS terminal | A shell and `curl` to download and run the installer. |
| Windows terminal | Windows PowerShell 5.1 or later to download and run the PowerShell installer. |
| Installation folder | The installing account must be able to create and write the chosen folder. Docker Desktop must be able to share that folder with its Linux VM. |
| Certificate generation | A local OpenSSL command is optional. Without it, the installer attempts certificate generation through a Docker helper container. You can also supply your own certificate. |

The normal installation includes PostgreSQL, object storage and the sign-in service. You do **not** need to install Node.js, pnpm, Git, PostgreSQL or SQL Server separately on the host. An external analytics database is needed only if you choose that installation option.

## Plan CPU, memory and storage

The figures here are **planning guidance, not a measured minimum or a capacity guarantee**. The [Windows Server VM guide](/docs/windows-server) starts with **4 virtual CPUs, 8 GB RAM and 100 GB disk** for a new Linux VM.

Imports, terminology, simultaneous users, reports and retained uploads can require more resources.

- Give the Linux Docker host enough resources for the whole stack, not just the API. Leave resources for the host operating system too.
- With Docker Desktop, check the limits of the Linux VM, not only the computer's installed RAM. Docker documents its [VM resource settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/#vm-resources); WSL2 has separate resource limits.
- Reserve space for container images, PostgreSQL data, stored files, logs, backups and future growth. Optional database containers add their own storage needs.
- Docker volumes hold the database and stored files. Free space beside the installer does not prove that Docker's data drive or VM disk has enough space.

Docker Desktop has its own host requirements. For example, its current Windows requirements include 8 GB system RAM. That vendor requirement is not a measurement of OpenLDR's workload capacity.

## Prepare network access

For the normal installer, allow outbound HTTPS downloads from GitHub and GitHub Container Registry. Allow the registry's redirected image downloads too. The optional SQL Server evaluation container also downloads from Microsoft's container registry. Configure any required proxy for both the terminal and Docker.

| How people will connect | What is needed |
| --- | --- |
| Only on the host | The local `https://localhost` address and the generated self-signed certificate. No public domain is required. |
| Over a private network or Tailscale | A hostname or IP address other devices can reach. Configure it during installation so sign-in redirects use that same address. The devices need access to the configured HTTPS port. |
| Public domain with Let's Encrypt | A domain pointing to the host, inbound TCP 80 and 443, and the Linux certificate setup described in [Install](/docs/install). |

The gateway uses host ports **80 and 443 by default**. They must be available, or you must choose other ports before installing. PostgreSQL, object storage and Keycloak communicate inside the Docker network; the default stack does not require opening their internal ports to users.

## Check the host before installing

These checks are read-only. Open Terminal on Linux/macOS or PowerShell on Windows. Run them on the computer hosting Docker.

The blue text ending in `$` or `>` is the **prompt**. The terminal displays it; do not type it. Type the command after it and press **Enter**. The lighter lines below are **output** from the program; read them, do not type them. For example, `docker --version` is a command and `Docker version 29.5.2, build 79eb04c` is its response. Copyable code blocks contain commands only. Names, paths and versions in your terminal may differ. Some illustrations show commands without their output; wait for each command to finish before running the next.

### 1. Check the container operating system and processor

```
docker info --format '{{.OSType}}/{{.Architecture}}'
```

For the packaged AMD64 path, expect `linux/x86_64` or `linux/amd64`. If it reports Windows containers, switch Docker Desktop to Linux containers. If Docker cannot connect, start its service and check the current account's Docker access. If it reports ARM, resolve image compatibility before continuing.

![Illustrated runtime check. This example shows a Linux engine on an Intel/AMD 64-bit host.](guide:install-runtime)

### 2. Check Compose

```
docker compose version
```

A version should be printed without an error. Your version may differ from the illustration. If the command is missing, install the Compose plugin or update Docker Desktop.

![Illustrated Compose version check. Your version number may differ.](guide:install-compose)

### 3. Review Docker storage and free disk space

```
docker system df
```

This reports **storage already used by Docker**, not free space. Check free space on the drive that holds Docker data as well. With Docker Desktop, check the VM disk's allocation and the free space on its host drive.

![Illustrated command for reviewing Docker storage use. It does not measure free disk space.](guide:install-storage)

**Expected result:** Docker answers in Linux mode, its processor matches the image, Compose works, and you have reviewed resource limits, free disk space and network access. Continue to [Install](/docs/install).
