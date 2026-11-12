/** Copyable commands and vector terminal illustrations share this source. */
export const SERVER_COMMANDS = {
  'host-check': 'Get-ComputerInfo -Property WindowsProductName,OsBuildNumber\nsysteminfo.exe',
  'wsl-install': 'wsl.exe --install -d Ubuntu-24.04',
  'wsl-version': 'wsl.exe --update\nwsl.exe --list --verbose',
  'wsl-open': 'wsl.exe --distribution Ubuntu-24.04 --cd ~',
  'systemd-check': 'ps -p 1 -o comm=',
  'systemd-edit': 'sudo nano /etc/wsl.conf',
  'wsl-restart': 'wsl.exe --shutdown\nwsl.exe --distribution Ubuntu-24.04 --cd ~',
  'hyperv-enable': 'Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart',
  'switch-list': 'Get-VMSwitch\nGet-NetAdapter | Where-Object Status -eq "Up"',
  'switch-create': 'New-VMSwitch -Name "OpenLDR-External" `\n  -NetAdapterName "Ethernet" -AllowManagementOS $true',
  'iso-check': '$iso = "C:\\iso\\ubuntu-server-amd64.iso"\nTest-Path $iso',
  'vm-create': 'New-Item -ItemType Directory -Path C:\\Hyper-V -Force\nNew-VM -Name OpenLDR -Generation 2 -MemoryStartupBytes 8GB `\n  -NewVHDPath C:\\Hyper-V\\OpenLDR.vhdx `\n  -NewVHDSizeBytes 100GB -SwitchName "OpenLDR-External"\nSet-VMProcessor -VMName OpenLDR -Count 4',
  'vm-boot': 'Add-VMDvdDrive -VMName OpenLDR -Path $iso\nSet-VMFirmware -VMName OpenLDR `\n  -SecureBootTemplate MicrosoftUEFICertificateAuthority\nSet-VMFirmware -VMName OpenLDR `\n  -FirstBootDevice (Get-VMDvdDrive -VMName OpenLDR)\nSet-VM -Name OpenLDR -AutomaticStartAction Start `\n  -AutomaticStartDelay 30\nStart-VM -Name OpenLDR',
  'vm-console': 'vmconnect.exe localhost OpenLDR',
  'vm-eject': 'Set-VMDvdDrive -VMName OpenLDR -Path $null\nGet-VMNetworkAdapter -VMName OpenLDR | Select-Object MacAddress,IPAddresses',
  'linux-check': 'cat /etc/os-release\ndpkg --print-architecture\nps -p 1 -o comm=',
  'docker-key': 'sudo apt-get update\nsudo apt-get install -y ca-certificates curl\nsudo install -m 0755 -d /etc/apt/keyrings\nsudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \\\n  -o /etc/apt/keyrings/docker.asc\nsudo chmod a+r /etc/apt/keyrings/docker.asc',
  'docker-repo': 'sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF\nTypes: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")\nComponents: stable\nArchitectures: $(dpkg --print-architecture)\nSigned-By: /etc/apt/keyrings/docker.asc\nEOF\nsudo apt-get update',
  'docker-install': 'sudo apt-get install -y docker-ce docker-ce-cli containerd.io \\\n  docker-buildx-plugin docker-compose-plugin\nsudo systemctl enable --now docker',
  'docker-access': 'sudo usermod -aG docker "$USER"\nnewgrp docker',
  'docker-check': 'docker info --format \'{{.OSType}}/{{.Architecture}}\'\ndocker compose version\ndocker run --rm hello-world',
  'install-download': 'mkdir -p "$HOME/Downloads"\ncurl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \\\n  -o "$HOME/Downloads/openldr-install.sh"',
  'install-run': 'sh "$HOME/Downloads/openldr-install.sh" \\\n  --dir "$HOME/Downloads/openldr_ce" \\\n  --server-name openldr.example.org --seedless',
  'install-status': 'cd "$HOME/Downloads/openldr_ce"\ndocker compose ps\ncurl -kfsS https://127.0.0.1/health',
  'wsl-address': 'wsl.exe --distribution Ubuntu-24.04 hostname -I\nGet-NetTCPConnection -State Listen -LocalPort 80,443 -ErrorAction SilentlyContinue',
  'wsl-proxy': '$wslIp = ((wsl.exe -d Ubuntu-24.04 hostname -I).Trim() -split "\\s+")[0]\nnetsh interface portproxy add v4tov4 listenaddress=0.0.0.0 `\n  listenport=443 connectaddress=$wslIp connectport=443\nnetsh interface portproxy add v4tov4 listenaddress=0.0.0.0 `\n  listenport=80 connectaddress=$wslIp connectport=80',
  'wsl-firewall': 'New-NetFirewallRule -DisplayName "OpenLDR HTTPS" `\n  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 `\n  -RemoteAddress LocalSubnet -Profile Domain,Private\nnetsh interface portproxy show v4tov4',
  'remote-check': 'Test-NetConnection openldr.example.org -Port 443',
  'vm-reboot-check': 'Get-VM -Name OpenLDR | Select-Object Name,State,AutomaticStartAction',
} as const;

export type ServerScene = keyof typeof SERVER_COMMANDS;
export function serverScene(src: string): ServerScene | null {
  const name = src.replace(/^guide:server-/, '');
  return src.startsWith('guide:server-') && Object.hasOwn(SERVER_COMMANDS, name) ? name as ServerScene : null;
}

export function serverMarkdown(markdown: string): string {
  return markdown.replace(/\{\{server:([a-z-]+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(SERVER_COMMANDS, key)) throw new Error(`Unknown Windows Server command: ${key}`);
    return SERVER_COMMANDS[key as ServerScene];
  });
}

/** Windows management commands run in PowerShell; Ubuntu commands use a Linux prompt. */
export function serverPlatform(scene: ServerScene): 'windows' | 'unix' {
  return /^(host-|wsl-|hyperv-|switch-|iso-|vm-|remote-)/.test(scene) ? 'windows' : 'unix';
}
