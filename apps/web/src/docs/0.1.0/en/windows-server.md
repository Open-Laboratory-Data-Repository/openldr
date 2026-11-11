# Windows Server

OpenLDR ships **Linux** container images. Windows cannot run them natively — the native
Docker engine only runs Windows containers, and **Docker Desktop is not supported on
Windows Server**. So OpenLDR runs on a Linux host that Windows provides for it.

There are two ways to get that Linux host:

- **WSL2** — a Ubuntu distro inside Windows. Lighter, faster to stand up, but only on
  newer Windows Server builds, and the network needs work.
- **Hyper-V** — a real Ubuntu Server virtual machine. Works on every Windows edition that
  has Hyper-V, including Server 2019, and the VM gets its own address on the LAN.

## Which path

| | WSL2 | Hyper-V VM |
| --- | --- | --- |
| **Server 2025** | ✅ A single `wsl --install` | ✅ |
| **Server 2022** | ⚠️ Only after patching off RTM | ✅ |
| **Server 2019** | ❌ Not viable | ✅ |
| **Windows 10 / 11 Pro, Enterprise** | ✅ | ✅ |
| **Windows 10 / 11 Home** | ✅ | ❌ No Hyper-V in Home |
| **Reaching it from the LAN** | Port proxy or mirrored mode | Own IP on an external switch |
| **Survives a reboot** | Port proxy needs re-running | VM auto-start setting |
| **Resource cost** | Shares the host's RAM on demand | Reserves what you assign it |

Pick **WSL2** if the box is Server 2022 (patched) or 2025 and you want the lighter setup.
Pick **Hyper-V** if the box is Server 2019, if the network team wants OpenLDR on its own
LAN address, or if you want the stack isolated from the host.

Both use the same hypervisor, so they can coexist on one machine.

---

## Path A — WSL2

**Success signals** inside the distro: `uname -r` ends in `-microsoft-standard-WSL2`
(not `4.4.0`), and `ps -p 1 -o comm=` prints `systemd`.

### 1. Install WSL2

In an **admin PowerShell** on the server (2022 patched, or 2025):

```powershell
wsl.exe --install     # enables components, installs the WSL2 kernel + Ubuntu
```

Reboot when prompted. On the first Ubuntu launch, create a UNIX username and password.

**On Server 2022**, if this errors with `WSL_E_OS_NOT_SUPPORTED` or `wsl --update` just
prints a link, the build is too old. Patch Windows to a current cumulative, reboot, and
re-run. Check the build with:

```powershell
[System.Environment]::OSVersion.Version    # RTM 10.0.20348.0 is too old; want 20348.2xxx+
```

### 2. Enable systemd (required before Docker)

Inside the Ubuntu (WSL2) shell:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Then from PowerShell run `wsl --shutdown`, wait ~10 seconds, and reopen Ubuntu. Verify:

```bash
uname -r            # ...-microsoft-standard-WSL2
ps -p 1 -o comm=    # systemd
```

### 3. Install Docker CE

Inside Ubuntu:

```bash
curl -fsSL https://get.docker.com | sh
# The script prints "WSL DETECTED: use Docker Desktop" and pauses — ignore it.
# Docker Desktop is NOT supported on Windows Server; Docker CE in the distro is correct.
sudo usermod -aG docker $USER
exec su -l $USER                     # reload group membership

sudo systemctl enable --now docker   # persistent because systemd is on
docker info --format '{{.OSType}}'   # must print: linux
docker compose version               # v2 plugin ships with the script
```

> Work under your Linux home (`~`), **never** under `/mnt/c/...` — the Windows bridge is
> slow and hurts Docker badly.

Now skip to [Install OpenLDR](#install-openldr).

---

## Path B — Hyper-V virtual machine

This builds an ordinary Ubuntu Server VM. Nothing about it is OpenLDR-specific, so an
existing Linux VM works too — if you already have one, install Docker on it and skip to
[Install OpenLDR](#install-openldr).

Give the VM **4 vCPU, 8 GB RAM and 100 GB disk** to start. The stack runs Postgres,
Keycloak, object storage, the API and the gateway together.

### 1. Enable Hyper-V

On **Windows Server**, in an admin PowerShell:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

On **Windows 10 / 11 Pro or Enterprise**:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

Both reboot. Windows Home has no Hyper-V — use WSL2 there.

### 2. Create an external switch

This is what gives the VM its own address on the LAN, instead of hiding behind the host.
Use the name of a real adapter from `Get-NetAdapter`:

```powershell
Get-NetAdapter | Where-Object Status -eq 'Up'
New-VMSwitch -Name "OpenLDR-External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

> Creating an external switch briefly drops the host's network. Don't run this over the
> remote-desktop session you need to keep.

### 3. Create the VM

Download the **Ubuntu Server LTS** ISO first, then:

```powershell
$vm = "OpenLDR"
New-VM -Name $vm -Generation 2 -MemoryStartupBytes 8GB `
  -NewVHDPath "C:\Hyper-V\$vm.vhdx" -NewVHDSizeBytes 100GB -SwitchName "OpenLDR-External"

Set-VMProcessor  -VMName $vm -Count 4
Set-VMMemory     -VMName $vm -DynamicMemoryEnabled $false
Add-VMDvdDrive   -VMName $vm -Path "C:\iso\ubuntu-24.04-live-server-amd64.iso"

# Ubuntu will not boot under the default Secure Boot template.
Set-VMFirmware -VMName $vm -SecureBootTemplate MicrosoftUEFICertificateAuthority
Set-VMFirmware -VMName $vm -FirstBootDevice (Get-VMDvdDrive -VMName $vm)

# Bring the stack back up with the host.
Set-VM -Name $vm -AutomaticStartAction Start -AutomaticStartDelay 30

Start-VM -Name $vm
vmconnect.exe localhost $vm
```

Fixed memory rather than dynamic: Postgres and the JVM in Keycloak both behave badly when
the balloon driver takes memory back under load.

### 4. Install Ubuntu

Walk the installer. Two choices that matter:

- **Install OpenSSH server** — otherwise you are stuck in the console window.
- **Give it a stable address** — a static IP, or a DHCP reservation against the VM's MAC
  (`Get-VMNetworkAdapter -VMName OpenLDR`). Certificates and sync partners will point at
  this address.

Then remove the ISO so it does not boot back into the installer:

```powershell
Set-VMDvdDrive -VMName OpenLDR -Path $null
```

### 5. Install Docker CE

SSH into the VM and run:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exec su -l $USER                     # reload group membership

sudo systemctl enable --now docker
docker info --format '{{.OSType}}'   # must print: linux
docker compose version
```

---

## Install OpenLDR

Both paths end here, on a real Linux Docker host. Run the standard one-line installer.

**Local / self-signed:**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Public domain + trusted TLS:**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

See [Install](/docs/install) for all installer flags. Verify the stack is up:

```bash
docker compose ps            # all Up / healthy
curl -I http://localhost/    # app responds on the host itself
```

## Reaching OpenLDR from other machines

### On Hyper-V

Nothing to do. The external switch already puts the VM on the LAN, so browse to the VM's
own address. Open the ports in the VM's firewall if it has one enabled:

```bash
sudo ufw allow 80,443/tcp    # only if ufw is active
```

### On WSL2

WSL2 forwards only the guest's **loopback** into the distro, so `localhost` works on the
server itself but the server's LAN address does not reach the stack by default. Two
options:

- **Mirrored networking** (simplest, needs a recent WSL): add `networkingMode=mirrored`
  under `[wsl2]` in `%USERPROFILE%\.wslconfig`, then `wsl --shutdown`. Some 2022 builds
  fall back to NAT and report "mirrored mode not supported" — use the port proxy below
  instead.
- **Port proxy** — in admin PowerShell, forward the gateway ports (80/443) from the
  server to the WSL2 IP:
  ```powershell
  $wslip = (wsl hostname -I).Trim().Split(' ')[0]
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 `
    connectport=443 connectaddress=$wslip
  New-NetFirewallRule -DisplayName "OpenLDR 443" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort 443 -Profile Any
  ```

> **The WSL2 IP changes on restart.** Re-run the port-proxy command after any
> `wsl --shutdown` or reboot — ideally from a logon scheduled task — or the proxy points
> at a dead address.
