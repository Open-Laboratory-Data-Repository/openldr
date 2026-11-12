# Windows Server

Prepare a Linux environment on Windows Server, then install OpenLDR inside it. OpenLDR's packaged images target Linux AMD64. Docker Desktop is not supported on Windows Server.

Choose **one** path below. If you already have an Ubuntu Linux VM with working Docker, skip to [Install OpenLDR inside Linux](#install-openldr-inside-linux). Sample data is optional. Studio sign-in will be covered after the fresh-install walkthrough is captured.

| Your host | Path to use |
| --- | --- |
| Updated Windows Server 2022 or 2025 with WSL2 available | WSL2, or a Hyper-V Linux VM. |
| Windows Server 2019 | Hyper-V Linux VM. Do not assume WSL1 can run Linux containers. |
| An unattended server that must recover after a host restart | Prefer a Hyper-V VM with automatic start. WSL needs a separate startup plan. |

Read [Requirements](/docs/requirements) first. You need Windows administrative access, enabled hardware virtualisation and room for Linux plus the whole OpenLDR stack. If Windows itself is a VM, its hypervisor must expose nested virtualisation.

The examples use `Ubuntu-24.04`, VM name `OpenLDR`, and Linux installation folder `~/Downloads/openldr_ce`. The example hostname `openldr.example.org` must be replaced with an address your users can reach. The terminal pictures are scalable command illustrations, not captures of a completed Windows Server installation. Select any picture to enlarge it.

The blue text ending in `$` or `>` is the **prompt**. The terminal displays it; do not type it. Type the command after it and press **Enter**. The lighter lines below are **output** from the program; read them, do not type them. For example, `docker --version` is a command and `Docker version 29.5.2, build 79eb04c` is its response. Copyable code blocks contain commands only. Names, paths and versions in your terminal may differ. Some illustrations show commands without their output; wait for each command to finish before running the next.

## Check Windows before choosing a path

Identify the host before enabling features. Open PowerShell as Administrator on that Windows Server. Use a local console or a management connection that can survive a restart.

### 1. Read the Windows version and virtualisation information

```powershell
{{server:host-check}}
```

Review the product name, build and Hyper-V information. Apply current Windows updates before the WSL2 path. Keep [Microsoft's Server WSL instructions](https://learn.microsoft.com/en-us/windows/wsl/install-on-server) open for build-specific installation errors. This guide does not set an unverified cumulative-update threshold.

![Command illustration for identifying the Windows Server host. Your system information will differ.](guide:server-host-check)

## Path A: prepare WSL2

This path creates an Ubuntu distribution inside Windows. Run Windows commands in Administrator PowerShell and Linux commands inside Ubuntu. The distribution belongs to the Windows account that installs it; use that same account later.

### 1. Install Ubuntu under WSL2

```powershell
{{server:wsl-install}}
```

Restart Windows if requested. Reopen Administrator PowerShell under the same account. If the named distribution is unavailable, use `wsl --list --online` and follow Microsoft's installation instructions. Do not substitute a WSL1 distribution.

![PowerShell command illustration for installing the example Ubuntu distribution.](guide:server-wsl-install)

### 2. Update WSL and check the distribution version

```powershell
{{server:wsl-version}}
```

The Ubuntu row must show **VERSION 2**. If it shows 1, use `wsl --set-version Ubuntu-24.04 2`, then check again. Resolve update or virtualisation errors before proceeding.

![Command illustration for updating WSL and checking that Ubuntu uses version 2.](guide:server-wsl-version)

### 3. Open Ubuntu and create its Linux account

```powershell
{{server:wsl-open}}
```

On first launch, complete Ubuntu's username and password prompts. The Linux password is separate from your Windows password. Password entry normally shows no characters. Use the Linux home folder rather than `/mnt/c` for Docker data and the OpenLDR installation.

![Command illustration for opening the named Ubuntu distribution in its Linux home folder.](guide:server-wsl-open)

### 4. Check the Linux service manager

Inside Ubuntu, run:

```bash
{{server:systemd-check}}
```

Expect `systemd`, which manages the Docker service. Current Ubuntu WSL installations may already enable it. If it is present, skip the next two steps and continue to **Install Docker inside Linux**.

![Linux command illustration for checking whether systemd is already running.](guide:server-systemd-check)

### 5. Enable systemd only if it is missing

Inside Ubuntu, open the existing configuration:

```bash
{{server:systemd-edit}}
```

Keep other settings. Under the existing `[boot]` section, set `systemd=true`. If that section is missing, add these two lines:

```ini
[boot]
systemd=true
```

Save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**. Do not replace the entire file. Microsoft documents the [systemd prerequisites and configuration](https://learn.microsoft.com/en-us/windows/wsl/systemd), including WSL 0.67.6 or newer.

![Command illustration for opening the existing WSL configuration without overwriting it.](guide:server-systemd-edit)

### 6. Restart WSL and repeat the check

Finish any running work and close Ubuntu. In PowerShell, run:

```powershell
{{server:wsl-restart}}
```

`--shutdown` stops all distributions for this Windows account. In the reopened Ubuntu shell, repeat `ps -p 1 -o comm=`. Continue only when it prints `systemd`.

![Command illustration for restarting WSL after the configuration change.](guide:server-wsl-restart)

**Expected result:** Ubuntu runs under WSL2 with systemd. Continue to **Install Docker inside Linux**. Enabling Docker here does not configure Windows to launch this distribution after a reboot.

## Path B: prepare a Hyper-V Linux VM

This path gives Ubuntu its own virtual machine and network address. The example allocation is **4 virtual CPUs, 8 GB RAM and 100 GB disk**. These are planning figures, not benchmarked minimums. Leave resources for Windows and other workloads.

Skip VM creation if you already have a suitable Ubuntu VM. Hyper-V installation restarts the host, and creating an external switch can interrupt the host's network. Arrange console access before changing either.

### 1. Enable Hyper-V

In Administrator PowerShell on Windows Server:

```powershell
{{server:hyperv-enable}}
```

The server restarts. Reopen Administrator PowerShell afterward. Use [Microsoft's Hyper-V installation guide](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v) if hardware or role installation fails.

![Command illustration for installing the Windows Server Hyper-V role. This command restarts the host.](guide:server-hyperv-enable)

### 2. Find an existing switch or the correct physical adapter

```powershell
{{server:switch-list}}
```

Reuse an appropriate existing external switch. Otherwise, identify the adapter carrying the intended LAN. `Ethernet` in the next step is an example, not a name to copy without checking.

![Command illustration for listing Hyper-V switches and active network adapters.](guide:server-switch-list)

### 3. Create an external switch only if needed

Replace `Ethernet` with the adapter name you found. Run from a console that can tolerate a network interruption:

```powershell
{{server:switch-create}}
```

Use your existing switch's name instead of `OpenLDR-External` in later commands if you reused one. Microsoft explains [external switches and management-OS sharing](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-switch-for-hyper-v-virtual-machines).

![Command illustration for creating the example external switch. Check the adapter name first.](guide:server-switch-create)

### 4. Download and locate the Ubuntu Server ISO

Download an AMD64 Ubuntu Server LTS image from [Ubuntu](https://ubuntu.com/download/server). This example uses Ubuntu 24.04 LTS. Save it as `C:\iso\ubuntu-server-amd64.iso`, or replace the path below with its actual location.

```powershell
{{server:iso-check}}
```

Expect `True` before continuing. Keep the same PowerShell window open because later commands use `$iso`.

![Command illustration for checking the example Ubuntu ISO path.](guide:server-iso-check)

### 5. Create a new VM and its disk

Use a new VM name and disk path. Do not reuse an existing VM's disk. In the same PowerShell window:

```powershell
{{server:vm-create}}
```

Change the resource allocation to match your workload and available host resources. A virtual disk limit is not proof that the physical drive has that much free space.

![Command illustration for creating the example Linux VM with its own new virtual disk.](guide:server-vm-create)

### 6. Attach the ISO and configure boot

```powershell
{{server:vm-boot}}
```

The Linux-compatible Secure Boot template lets Ubuntu boot. The automatic-start setting starts this VM after the Windows host boots. Docker and the OpenLDR containers still need their own startup checks.

![Command illustration for attaching the ISO, selecting the Linux boot template and starting the VM.](guide:server-vm-boot)

### 7. Open the console and install Ubuntu

On a Windows Server desktop with the management tools:

```powershell
{{server:vm-console}}
```

For Server Core, connect using Hyper-V Manager from a separate Windows management computer. Follow [Ubuntu's illustrated installation tutorial](https://ubuntu.com/tutorials/install-ubuntu-server) in the console. Select only the new VM disk, create a Linux account, and enable OpenSSH if you plan to manage the VM through SSH. Finish the Ubuntu installation and reboot it.

The image below shows the console-opening command. It does not stand in for screenshots of the Ubuntu installer.

![Command illustration for opening the VM console on a Windows desktop.](guide:server-vm-console)

### 8. Remove the ISO and arrange a stable address

Back in Windows PowerShell:

```powershell
{{server:vm-eject}}
```

Reserve an address in DHCP using the VM's MAC address, or configure a static Linux address suitable for your network. Check the address inside Ubuntu with `hostname -I`. Use a hostname that resolves to that VM address for the OpenLDR install.

![Command illustration for ejecting the ISO and reading the VM network adapter details.](guide:server-vm-eject)

**Expected result:** Ubuntu boots from its virtual disk and has a reachable, stable network address. Continue inside Ubuntu, using its console or SSH.

## Install Docker inside Linux

Both paths meet here. These commands run **inside Ubuntu**, not PowerShell. They follow Docker's [Ubuntu repository installation](https://docs.docker.com/engine/install/ubuntu/) rather than the convenience script intended for testing and development.

These instructions are for a new Ubuntu environment. If Docker or containerd is already installed, review Docker's conflicting-package instructions before changing it. Do not remove packages from a host serving other workloads just to follow this page.

### 1. Check Ubuntu, processor and service manager

```bash
{{server:linux-check}}
```

For this example, confirm Ubuntu 24.04, `amd64`, and `systemd`. See [Requirements](/docs/requirements) for the image architecture limitation.

![Linux command illustration for checking the distribution, processor and service manager.](guide:server-linux-check)

### 2. Add Docker's signing key

```bash
{{server:docker-key}}
```

Run the whole block in Ubuntu. Stop if a download or package command fails.

![Command illustration for installing prerequisites and downloading Docker's repository signing key.](guide:server-docker-key)

### 3. Add Docker's package repository

```bash
{{server:docker-repo}}
```

Include the final `EOF` line. This creates a Docker-specific repository file; it does not replace Ubuntu's main package sources.

![Command illustration for adding the Docker repository and updating the package index.](guide:server-docker-repo)

### 4. Install Docker Engine and Compose

```bash
{{server:docker-install}}
```

This installs Docker Engine, its command-line tools and the Compose plugin, then enables and starts the service.

![Command illustration for installing Docker packages and starting the service.](guide:server-docker-install)

### 5. Give the installing account Docker access

```bash
{{server:docker-access}}
```

`newgrp` opens a shell with the new group membership. The Docker group gives this account root-level control of the Linux environment. Use the account that will maintain OpenLDR. Docker documents this in its [Linux post-installation steps](https://docs.docker.com/engine/install/linux-postinstall/).

![Command illustration for granting Docker access to the current Linux account.](guide:server-docker-access)

### 6. Check the engine, Compose and a test container

```bash
{{server:docker-check}}
```

Expect a Linux AMD64 engine, a Compose version and the `hello-world` success message. The last command downloads a small test image and removes its finished container. Resolve any access or download error before installing OpenLDR.

![Command illustration for checking Docker and running its small test container.](guide:server-docker-check)

## Install OpenLDR inside Linux

Choose the hostname **before the first installation**. On Hyper-V, it must reach the Ubuntu VM. On WSL2 with the forwarding task below, it must reach the Windows host. Replace `openldr.example.org` in the command with that hostname or a reachable IP address. A hostname on a private network or Tailscale can use the generated self-signed certificate.

### 1. Download the Linux installer

```bash
{{server:install-download}}
```

This stores the script in `~/Downloads/openldr-install.sh` inside Ubuntu. Do not use the Windows PowerShell installer here.

![Linux command illustration for downloading the OpenLDR installer inside Ubuntu.](guide:server-install-download)

### 2. Install with the address users will reach

Replace the example hostname, then run:

```bash
{{server:install-run}}
```

`--seedless` leaves out starter dashboards and demo data. Omit that option if you want them on this new installation. Your own data does not depend on sample data.

Keep the generated credentials private. A public domain with a trusted certificate needs the separate certificate task in [Install](/docs/install), including inbound port 80. Sign-in steps remain deferred until the fresh-install capture.

![Command illustration for installing OpenLDR in the example Linux folder with a chosen hostname.](guide:server-install-run)

### 3. Check the actual service status

```bash
{{server:install-status}}
```

Check container status and the API health response. The local health check uses `-k` only for the generated self-signed certificate. It does not prove remote access or Studio sign-in. If a service restarts or is unhealthy, inspect `docker compose logs --tail 100` in this same folder. The installer's exit code alone is not a readiness check.

![Command illustration for checking containers and the local API health endpoint.](guide:server-install-status)

## Let other computers reach WSL2

Skip this task for Hyper-V. Its external switch gives the VM a LAN connection, but network routing and firewall rules must still allow access to the VM's gateway ports.

For WSL2's default NAT networking, forward the Windows gateway ports to Ubuntu. Microsoft's [WSL networking guide](https://learn.microsoft.com/en-us/windows/wsl/networking) documents this approach. Its mirrored-networking instructions target Windows 11; this Server walkthrough uses explicit forwarding.

### 1. Read the Ubuntu address and check Windows ports

In Administrator PowerShell under the account that installed the distribution:

```powershell
{{server:wsl-address}}
```

Identify Ubuntu's IPv4 address. Check that Windows ports 80 and 443 are not occupied by IIS or another service. If the listing is empty, no matching TCP listener was found. Do not stop an existing service without checking its purpose.

![Command illustration for reading the WSL address and checking gateway-port conflicts.](guide:server-wsl-address)

### 2. Forward gateway ports to Ubuntu

```powershell
{{server:wsl-proxy}}
```

Confirm `$wslIp` matches the Ubuntu IPv4 address above. These rules listen on every Windows IPv4 interface. They forward only the gateway ports, not PostgreSQL, object storage or Keycloak's internal ports. If you chose different gateway ports, change both ends of each rule to match.

![Command illustration for forwarding Windows gateway ports to the example WSL distribution.](guide:server-wsl-proxy)

### 3. Allow the intended clients and inspect the rules

For clients on the local subnet and a Domain or Private Windows network:

```powershell
{{server:wsl-firewall}}
```

For Tailscale or another routed network, replace `LocalSubnet` with the intended client address range and choose the correct active Windows firewall profile. This rule opens HTTPS. Add a matching rule for TCP 80 only if you need HTTP redirects or public certificate validation. Do not assume this local-subnet rule permits every remote client.

After WSL restarts, read its address again and rerun the port-forwarding commands if it changed. The forwarding rules do not launch Ubuntu for you.

![Command illustration for a restricted HTTPS firewall rule and reviewing port-forwarding entries.](guide:server-wsl-firewall)

## Check remote access and restart behaviour

Run the network check from a different computer. A connection from the server to itself does not prove that other users can reach it.

### 1. Test the chosen address from another Windows computer

Replace the hostname with the one used for installation:

```powershell
{{server:remote-check}}
```

Expect `TcpTestSucceeded: True`. This proves TCP reachability only. Open `https://YOUR_HOST` to check the gateway; certificate trust and sign-in are separate checks. Do not disable browser certificate checks as a permanent setup.

![Command illustration for testing HTTPS port reachability from a different computer.](guide:server-remote-check)

### 2. Check the planned startup behaviour

For Hyper-V, inspect the VM from Windows PowerShell:

```powershell
{{server:vm-reboot-check}}
```

Its automatic-start action should be `Start`. At a planned maintenance restart, check the VM, Docker, container health and remote access again.

For WSL2, arrange and test a startup mechanism under the Windows account owning the distribution. A systemd service inside Ubuntu does not by itself start WSL after Windows boots. Until that path is tested, do not describe this setup as unattended. Use the Hyper-V path when automatic VM start is needed and no WSL startup mechanism is in place.

![Command illustration for inspecting the Hyper-V VM startup setting. WSL needs its own startup plan.](guide:server-vm-reboot-check)

**Expected result:** Linux Docker runs OpenLDR, the configured hostname reaches the gateway from the intended client network, and you have checked how it will return after a restart. Studio sign-in remains a separate fresh-install task.
