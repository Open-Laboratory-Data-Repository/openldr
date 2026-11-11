# Windows Server

O OpenLDR é distribuído em imagens de contentor **Linux**. O Windows não as consegue
executar de forma nativa: o motor Docker nativo só executa contentores Windows, e o
**Docker Desktop não é suportado no Windows Server**. Por isso, o OpenLDR corre num
anfitrião Linux fornecido pelo Windows.

Há duas formas de obter esse anfitrião Linux:

- **WSL2**: uma distribuição Ubuntu dentro do Windows. Mais leve e mais rápida de preparar,
  mas só existe nas versões mais recentes do Windows Server, e a rede exige trabalho.
- **Hyper-V**: uma máquina virtual Ubuntu Server real. Funciona em todas as edições do
  Windows com Hyper-V, incluindo o Server 2019, e a VM tem o seu próprio endereço na LAN.

## Que caminho escolher

| | WSL2 | VM Hyper-V |
| --- | --- | --- |
| **Server 2025** | ✅ Um único `wsl --install` | ✅ |
| **Server 2022** | ⚠️ Só depois de atualizar a partir da RTM | ✅ |
| **Server 2019** | ❌ Não é viável | ✅ |
| **Windows 10 / 11 Pro, Enterprise** | ✅ | ✅ |
| **Windows 10 / 11 Home** | ✅ | ❌ Sem Hyper-V na edição Home |
| **Acesso a partir da LAN** | Proxy de portas ou modo espelhado | IP próprio num comutador externo |
| **Depois de reiniciar** | O proxy de portas tem de ser executado de novo | Definição de arranque automático da VM |
| **Consumo de recursos** | Partilha a RAM do anfitrião conforme a necessidade | Reserva o que lhe atribuir |

Escolha o **WSL2** se a máquina tiver o Server 2022 (atualizado) ou o 2025 e quiser a
configuração mais leve. Escolha o **Hyper-V** se a máquina tiver o Server 2019, se a equipa
de rede quiser o OpenLDR com o seu próprio endereço na LAN, ou se quiser a pilha isolada do
anfitrião.

Os dois usam o mesmo hipervisor, por isso podem coexistir na mesma máquina.

---

## Caminho A: WSL2

**Sinais de sucesso** dentro da distribuição: `uname -r` termina em
`-microsoft-standard-WSL2` (não `4.4.0`), e `ps -p 1 -o comm=` mostra `systemd`.

### 1. Instalar o WSL2

Numa **PowerShell de administrador** no servidor (2022 atualizado, ou 2025):

```powershell
wsl.exe --install     # enables components, installs the WSL2 kernel + Ubuntu
```

Reinicie quando for pedido. No primeiro arranque do Ubuntu, crie um nome de utilizador e
uma palavra-passe UNIX.

**No Server 2022**, se isto der o erro `WSL_E_OS_NOT_SUPPORTED` ou se `wsl --update` só
mostrar uma ligação, a versão é demasiado antiga. Atualize o Windows para uma atualização
cumulativa recente, reinicie e execute de novo. Verifique a versão com:

```powershell
[System.Environment]::OSVersion.Version    # RTM 10.0.20348.0 is too old; want 20348.2xxx+
```

### 2. Ativar o systemd (obrigatório antes do Docker)

Na shell do Ubuntu (WSL2):

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Depois, na PowerShell, execute `wsl --shutdown`, espere cerca de 10 segundos e volte a abrir
o Ubuntu. Verifique:

```bash
uname -r            # ...-microsoft-standard-WSL2
ps -p 1 -o comm=    # systemd
```

### 3. Instalar o Docker CE

Dentro do Ubuntu:

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

> Trabalhe na sua pasta pessoal Linux (`~`), **nunca** em `/mnt/c/...`. A ponte para o
> Windows é lenta e prejudica muito o Docker.

Agora avance para [Instalar o OpenLDR](#instalar-o-openldr).

---

## Caminho B: máquina virtual Hyper-V

Este caminho cria uma VM Ubuntu Server comum. Nada nela é específico do OpenLDR, por isso
uma VM Linux existente também serve. Se já tiver uma, instale nela o Docker e avance para
[Instalar o OpenLDR](#instalar-o-openldr).

Para começar, atribua à VM **4 vCPU, 8 GB de RAM e 100 GB de disco**. A pilha executa ao
mesmo tempo o Postgres, o Keycloak, o armazenamento de objetos, a API e o gateway.

### 1. Ativar o Hyper-V

No **Windows Server**, numa PowerShell de administrador:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

No **Windows 10 / 11 Pro ou Enterprise**:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

Os dois comandos reiniciam a máquina. O Windows Home não tem Hyper-V. Use aí o WSL2.

### 2. Criar um comutador externo

É isto que dá à VM o seu próprio endereço na LAN, em vez de ficar escondida atrás do
anfitrião. Use o nome de um adaptador real, obtido com `Get-NetAdapter`:

```powershell
Get-NetAdapter | Where-Object Status -eq 'Up'
New-VMSwitch -Name "OpenLDR-External" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

> Criar um comutador externo corta a rede do anfitrião durante alguns instantes. Não
> execute isto através da sessão de ambiente de trabalho remoto que precisa de manter.

### 3. Criar a VM

Primeiro, transfira o ISO do **Ubuntu Server LTS**. Depois:

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

Memória fixa em vez de dinâmica: o Postgres e a JVM do Keycloak comportam-se mal quando o
controlador balloon retira memória sob carga.

### 4. Instalar o Ubuntu

Siga o instalador. Há duas escolhas que importam:

- **Instalar o servidor OpenSSH**: caso contrário, fica preso à janela da consola.
- **Dar-lhe um endereço estável**: um IP estático, ou uma reserva DHCP associada ao MAC da
  VM (`Get-VMNetworkAdapter -VMName OpenLDR`). Os certificados e os parceiros de
  sincronização vão apontar para este endereço.

Depois retire o ISO, para a VM não voltar a arrancar no instalador:

```powershell
Set-VMDvdDrive -VMName OpenLDR -Path $null
```

### 5. Instalar o Docker CE

Entre na VM por SSH e execute:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exec su -l $USER                     # reload group membership

sudo systemctl enable --now docker
docker info --format '{{.OSType}}'   # must print: linux
docker compose version
```

---

## Instalar o OpenLDR

Os dois caminhos terminam aqui, num anfitrião Docker Linux real. Execute o instalador de
uma linha habitual.

**Local / autoassinado:**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Domínio público + TLS reconhecido:**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Consulte [Instalar](/docs/install) para todas as opções do instalador. Verifique se a pilha
está ativa:

```bash
docker compose ps            # all Up / healthy
curl -I http://localhost/    # app responds on the host itself
```

## Aceder ao OpenLDR a partir de outras máquinas

### No Hyper-V

Não há nada a fazer. O comutador externo já coloca a VM na LAN, por isso abra no navegador
o endereço da própria VM. Abra as portas na firewall da VM, se tiver uma ativa:

```bash
sudo ufw allow 80,443/tcp    # only if ufw is active
```

### No WSL2

O WSL2 só encaminha o **loopback** do sistema convidado para a distribuição. Assim,
`localhost` funciona no próprio servidor, mas o endereço LAN do servidor não chega à pilha
por omissão. Há duas opções:

- **Rede espelhada** (a mais simples, exige um WSL recente): acrescente
  `networkingMode=mirrored` em `[wsl2]` no ficheiro `%USERPROFILE%\.wslconfig` e depois
  execute `wsl --shutdown`. Algumas versões do 2022 voltam ao NAT e indicam "mirrored mode
  not supported". Nesse caso, use o proxy de portas abaixo.
- **Proxy de portas**: numa PowerShell de administrador, encaminhe as portas do gateway
  (80/443) do servidor para o IP do WSL2:
  ```powershell
  $wslip = (wsl hostname -I).Trim().Split(' ')[0]
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 `
    connectport=443 connectaddress=$wslip
  New-NetFirewallRule -DisplayName "OpenLDR 443" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort 443 -Profile Any
  ```

> **O IP do WSL2 muda a cada reinício.** Execute de novo o comando do proxy de portas
> depois de qualquer `wsl --shutdown` ou reinício, de preferência a partir de uma tarefa
> agendada no início de sessão. Caso contrário, o proxy aponta para um endereço inativo.
