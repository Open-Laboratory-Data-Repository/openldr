# Windows Server

OpenLDR est livré sous forme d'images de conteneurs **Linux**. Windows ne peut pas les exécuter nativement. Le moteur Docker natif n'exécute que des conteneurs Windows, et **Docker Desktop n'est pas pris en charge sur Windows Server**. OpenLDR tourne donc sur un hôte Linux que Windows lui fournit.

Il existe deux façons d'obtenir cet hôte Linux :

- **WSL2** : une distribution Ubuntu dans Windows. Plus légère et plus rapide à mettre en place, mais seulement sur les versions récentes de Windows Server, et le réseau demande du travail.
- **Hyper-V** : une vraie machine virtuelle Ubuntu Server. Fonctionne sur toutes les éditions de Windows qui ont Hyper-V, y compris Server 2019, et la VM obtient sa propre adresse sur le réseau local.

## Quelle voie choisir

| | WSL2 | VM Hyper-V |
| --- | --- | --- |
| **Server 2025** | ✅ Un seul `wsl --install` | ✅ |
| **Server 2022** | ⚠️ Seulement après mise à jour au-delà de la version RTM | ✅ |
| **Server 2019** | ❌ Pas viable | ✅ |
| **Windows 10 / 11 Pro, Entreprise** | ✅ | ✅ |
| **Windows 10 / 11 Famille** | ✅ | ❌ Pas d'Hyper-V dans l'édition Famille |
| **Accès depuis le réseau local** | Proxy de ports ou mode miroir | Sa propre IP sur un commutateur externe |
| **Après un redémarrage** | Le proxy de ports doit être relancé | Réglage de démarrage automatique de la VM |
| **Coût en ressources** | Partage la RAM de l'hôte à la demande | Réserve ce que vous lui attribuez |

Choisissez **WSL2** si la machine est sous Server 2022 (à jour) ou 2025 et que vous voulez l'installation la plus légère.
Choisissez **Hyper-V** si la machine est sous Server 2019, si l'équipe réseau veut OpenLDR sur sa propre adresse du réseau local, ou si vous voulez isoler la pile de l'hôte.

Les deux utilisent le même hyperviseur. Ils peuvent donc coexister sur une même machine.

---

## Voie A : WSL2

**Signes de réussite** dans la distribution : `uname -r` se termine par `-microsoft-standard-WSL2` (et non `4.4.0`), et `ps -p 1 -o comm=` affiche `systemd`.

### 1. Installer WSL2

Dans un **PowerShell administrateur** sur le serveur (2022 à jour, ou 2025) :

```powershell
wsl.exe --install     # enables components, installs the WSL2 kernel + Ubuntu
```

Redémarrez quand on vous le demande. Au premier lancement d'Ubuntu, créez un nom d'utilisateur et un mot de passe UNIX.

**Sur Server 2022**, si cette commande échoue avec `WSL_E_OS_NOT_SUPPORTED` ou si `wsl --update` affiche seulement un lien, la version est trop ancienne. Installez une mise à jour cumulative récente de Windows, redémarrez et relancez. Vérifiez la version avec :

```powershell
[System.Environment]::OSVersion.Version    # RTM 10.0.20348.0 is too old; want 20348.2xxx+
```

### 2. Activer systemd (obligatoire avant Docker)

Dans le shell Ubuntu (WSL2) :

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Lancez ensuite `wsl --shutdown` depuis PowerShell, attendez environ 10 secondes et rouvrez Ubuntu. Vérifiez :

```bash
uname -r            # ...-microsoft-standard-WSL2
ps -p 1 -o comm=    # systemd
```

### 3. Installer Docker CE

Dans Ubuntu :

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

> Travaillez dans votre dossier personnel Linux (`~`), **jamais** sous `/mnt/c/...`. Le pont vers Windows est lent et pénalise fortement Docker.

Passez maintenant à [Installer OpenLDR](#installer-openldr).

---

## Voie B : machine virtuelle Hyper-V

Cette voie crée une VM Ubuntu Server ordinaire. Rien n'y est propre à OpenLDR, donc une VM Linux existante convient aussi. Si vous en avez déjà une, installez-y Docker et passez à [Installer OpenLDR](#installer-openldr).

Donnez à la VM **4 vCPU, 8 Go de RAM et 100 Go de disque** pour commencer. La pile fait tourner ensemble Postgres, Keycloak, le stockage d'objets, l'API et la passerelle.

### 1. Activer Hyper-V

Sur **Windows Server**, dans un PowerShell administrateur :

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

Sur **Windows 10 / 11 Pro ou Entreprise** :

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

Les deux commandes redémarrent la machine. Windows Famille n'a pas Hyper-V : utilisez WSL2 dans ce cas.

### 2. Créer un commutateur externe

C'est ce qui donne à la VM sa propre adresse sur le réseau local, au lieu de la cacher derrière l'hôte. Utilisez le nom d'une vraie carte réseau, tiré de `Get-NetAdapter` :

```powershell
Get-NetAdapter | Where-Object Status -eq 'Up'
New-VMSwitch -Name "OpenLDR-External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

> La création d'un commutateur externe coupe brièvement le réseau de l'hôte. Ne la lancez pas depuis une session Bureau à distance que vous devez garder.

### 3. Créer la VM

Téléchargez d'abord l'ISO **Ubuntu Server LTS**, puis :

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

Mémoire fixe plutôt que dynamique : Postgres et la JVM de Keycloak se comportent mal quand le pilote de ballon reprend de la mémoire sous charge.

### 4. Installer Ubuntu

Suivez l'installateur. Deux choix comptent :

- **Install OpenSSH server** : sinon, vous restez bloqué dans la fenêtre de console.
- **Donnez-lui une adresse stable** : une IP statique, ou une réservation DHCP sur l'adresse MAC de la VM (`Get-VMNetworkAdapter -VMName OpenLDR`). Les certificats et les partenaires de synchronisation pointeront vers cette adresse.

Retirez ensuite l'ISO pour que la VM ne redémarre pas dans l'installateur :

```powershell
Set-VMDvdDrive -VMName OpenLDR -Path $null
```

### 5. Installer Docker CE

Connectez-vous à la VM en SSH et lancez :

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exec su -l $USER                     # reload group membership

sudo systemctl enable --now docker
docker info --format '{{.OSType}}'   # must print: linux
docker compose version
```

---

## Installer OpenLDR

Les deux voies aboutissent ici, sur un vrai hôte Docker Linux. Lancez l'installateur standard en une ligne.

**Local / auto-signé :**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Domaine public et TLS de confiance :**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Voir [Installation](/docs/install) pour toutes les options de l'installateur. Vérifiez que la pile tourne :

```bash
docker compose ps            # all Up / healthy
curl -I http://localhost/    # app responds on the host itself
```

## Accéder à OpenLDR depuis d'autres machines

### Sur Hyper-V

Rien à faire. Le commutateur externe place déjà la VM sur le réseau local : ouvrez simplement l'adresse de la VM dans un navigateur. Ouvrez les ports dans le pare-feu de la VM s'il est activé :

```bash
sudo ufw allow 80,443/tcp    # only if ufw is active
```

### Sur WSL2

WSL2 ne transfère que le **loopback** de l'invité vers la distribution. `localhost` fonctionne donc sur le serveur lui-même, mais l'adresse du serveur sur le réseau local n'atteint pas la pile par défaut. Deux options :

- **Réseau en miroir** (le plus simple, demande un WSL récent) : ajoutez `networkingMode=mirrored` sous `[wsl2]` dans `%USERPROFILE%\.wslconfig`, puis lancez `wsl --shutdown`. Certaines versions 2022 reviennent au NAT et affichent « mirrored mode not supported ». Utilisez alors le proxy de ports ci-dessous.
- **Proxy de ports** : dans un PowerShell administrateur, transférez les ports de la passerelle (80/443) du serveur vers l'IP WSL2 :
  ```powershell
  $wslip = (wsl hostname -I).Trim().Split(' ')[0]
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 `
    connectport=443 connectaddress=$wslip
  New-NetFirewallRule -DisplayName "OpenLDR 443" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort 443 -Profile Any
  ```

> **L'IP WSL2 change au redémarrage.** Relancez la commande du proxy de ports après chaque `wsl --shutdown` ou redémarrage, idéalement depuis une tâche planifiée à l'ouverture de session. Sinon, le proxy pointe vers une adresse morte.
