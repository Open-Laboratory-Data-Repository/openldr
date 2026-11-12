export type InstallPlatform = 'unix' | 'windows';

const BASE = 'https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install';
const TLS_COMMAND = 'sh "$HOME/Downloads/openldr-install.sh" --dir "$HOME/Downloads/openldr_ce" --server-name openldr.example.org --letsencrypt you@example.org --seedless';

export const INSTALL_COMMANDS = {
  unix: {
    check: 'docker --version\ndocker compose version\ndocker info',
    download: `mkdir -p "$HOME/Downloads"\ncurl -fsSL ${BASE}/install.sh -o "$HOME/Downloads/openldr-install.sh"`,
    run: 'sh "$HOME/Downloads/openldr-install.sh" --dir "$HOME/Downloads/openldr_ce" --seedless',
    folder: 'cd "$HOME/Downloads/openldr_ce"\nls',
    status: 'cd "$HOME/Downloads/openldr_ce"\ndocker compose ps\ndocker compose logs --tail 100',
    tls: TLS_COMMAND,
    scaffold: 'sh "$HOME/Downloads/openldr-install.sh" --dir "$HOME/Downloads/openldr_ce" --server-name openldr.example.org --no-start --seedless',
    certificates: 'cp /path/to/fullchain.pem "$HOME/Downloads/openldr_ce/config/nginx/certs/fullchain.pem"\ncp /path/to/privkey.pem "$HOME/Downloads/openldr_ce/config/nginx/certs/privkey.pem"',
    start: 'cd "$HOME/Downloads/openldr_ce"\ndocker compose up -d\ndocker compose ps',
  },
  windows: {
    check: 'docker --version\ndocker compose version\ndocker info',
    download: `$installer = Invoke-RestMethod ${BASE}/install.ps1`,
    run: '& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -Seedless',
    folder: 'Set-Location C:\\openldr_ce\nGet-ChildItem -Force -Name',
    status: 'Set-Location C:\\openldr_ce\ndocker compose ps\ndocker compose logs --tail 100',
    tls: TLS_COMMAND,
    scaffold: '& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -ServerName openldr.example.org -NoStart -Seedless',
    certificates: 'Copy-Item C:\\path\\to\\fullchain.pem C:\\openldr_ce\\config\\nginx\\certs\\fullchain.pem\nCopy-Item C:\\path\\to\\privkey.pem C:\\openldr_ce\\config\\nginx\\certs\\privkey.pem',
    start: 'Set-Location C:\\openldr_ce\ndocker compose up -d\ndocker compose ps',
  },
} as const;

export type InstallCommand = keyof typeof INSTALL_COMMANDS.unix;
export const INSTALL_PLATFORM_MARKER = '<!-- install-platform -->';

/** Commands and their illustrations use the same strings. */
export function installMarkdown(markdown: string, platform: InstallPlatform): string {
  if (!markdown.includes(INSTALL_PLATFORM_MARKER)) return markdown;
  return markdown
    .replaceAll(INSTALL_PLATFORM_MARKER, '')
    .replace(/<!-- install:(unix|windows) -->([\s\S]*?)<!-- \/install -->/g,
      (_, name: string, body: string) => name === platform ? body : '')
    .replace(/\{\{install:([a-z]+)\}\}/g, (_, key: string) => {
      if (!(key in INSTALL_COMMANDS[platform])) throw new Error(`Unknown installation command: ${key}`);
      return INSTALL_COMMANDS[platform][key as InstallCommand];
    })
    .replaceAll('~/Downloads/openldr_ce', platform === 'windows' ? 'C:\\openldr_ce' : '~/Downloads/openldr_ce');
}

export const INSTALL_SCENES = ['terminal', 'check', 'download', 'run', 'ready', 'folder', 'status', 'tls', 'tls-ready', 'renewal', 'scaffold', 'certificates', 'start', 'runtime', 'compose', 'storage'] as const;
export type InstallScene = (typeof INSTALL_SCENES)[number];

export function installScene(src: string): InstallScene | null {
  const name = src.replace(/^guide:install-/, '');
  return src.startsWith('guide:install-') && (INSTALL_SCENES as readonly string[]).includes(name) ? name as InstallScene : null;
}
