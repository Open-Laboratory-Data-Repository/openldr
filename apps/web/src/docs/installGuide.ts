export type InstallPlatform = 'unix' | 'windows';

const BASE = 'https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install';
const TLS_COMMAND = 'sh "$HOME/Downloads/openldr-install.sh" --dir "$HOME/Downloads/openldr_ce" --server-name openldr.example.org --letsencrypt you@example.org --seedless';

export const INSTALL_COMMANDS = {
  unix: {
    "logs": "cd \"$HOME/Downloads/openldr_ce\"\ndocker compose logs --tail 100",
    "remote": "sh \"$HOME/Downloads/openldr-install.sh\" --dir \"$HOME/Downloads/openldr_ce\" --server-name openldr.example.org --seedless",
    "remote-check": "curl -kfsS https://openldr.example.org/health",
    "certificate-check": "curl --head https://openldr.example.org",
    "mssql-demo": "sh \"$HOME/Downloads/openldr-install.sh\" --dir \"$HOME/Downloads/openldr_ce\" --mssql-demo --seedless",
    "mssql-status": "cd \"$HOME/Downloads/openldr_ce\"\ndocker compose -f docker-compose.yml -f docker-compose.mssql.yml ps\ndocker compose -f docker-compose.yml -f docker-compose.mssql.yml exec api printenv TARGET_STORE_ADAPTER",
    "mssql-existing": "sh \"$HOME/Downloads/openldr-install.sh\" --dir \"$HOME/Downloads/openldr_ce\" --target-db mssql \\\n  --mssql-host sql.internal --mssql-database openldr_target \\\n  --mssql-user openldr --mssql-password 'REPLACE_WITH_DATABASE_PASSWORD' --seedless",
    "mysql-demo": "sh \"$HOME/Downloads/openldr-install.sh\" --dir \"$HOME/Downloads/openldr_ce\" --mysql-demo --seedless",
    "mysql-status": "cd \"$HOME/Downloads/openldr_ce\"\ndocker compose -f docker-compose.yml -f docker-compose.mysql.yml ps\ndocker compose -f docker-compose.yml -f docker-compose.mysql.yml exec api printenv TARGET_STORE_ADAPTER",
    "mysql-existing": "sh \"$HOME/Downloads/openldr-install.sh\" --dir \"$HOME/Downloads/openldr_ce\" --target-db mysql \\\n  --mysql-host mysql.internal --mysql-database openldr_target \\\n  --mysql-user openldr --mysql-password 'REPLACE_WITH_DATABASE_PASSWORD' --seedless",
    "target-status": "cd \"$HOME/Downloads/openldr_ce\"\ndocker compose ps\ndocker compose exec api printenv TARGET_STORE_ADAPTER",
    "restart-gateway": "cd \"$HOME/Downloads/openldr_ce\"\ndocker compose restart gateway",
    check: 'docker --version\ndocker compose version\ndocker info',
    download: `mkdir -p "$HOME/Downloads"\ncurl -fsSL ${BASE}/install.sh -o "$HOME/Downloads/openldr-install.sh"`,
    run: 'sh "$HOME/Downloads/openldr-install.sh" --dir "$HOME/Downloads/openldr_ce" --seedless',
    folder: 'cd "$HOME/Downloads/openldr_ce"\nls',
    status: 'cd "$HOME/Downloads/openldr_ce"\ndocker compose ps',
    tls: TLS_COMMAND,
    scaffold: 'sh "$HOME/Downloads/openldr-install.sh" --dir "$HOME/Downloads/openldr_ce" --server-name openldr.example.org --no-start --seedless',
    certificates: 'cp /path/to/fullchain.pem "$HOME/Downloads/openldr_ce/config/nginx/certs/fullchain.pem"\ncp /path/to/privkey.pem "$HOME/Downloads/openldr_ce/config/nginx/certs/privkey.pem"',
    start: 'cd "$HOME/Downloads/openldr_ce"\ndocker compose up -d\ndocker compose ps',
  },
  windows: {
    "logs": "Set-Location C:\\openldr_ce\ndocker compose logs --tail 100",
    "remote": "& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -ServerName openldr.example.org -Seedless",
    "remote-check": "Test-NetConnection openldr.example.org -Port 443",
    "certificate-check": "curl.exe --head https://openldr.example.org",
    "mssql-demo": "& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -MssqlDemo -Seedless",
    "mssql-status": "Set-Location C:\\openldr_ce\ndocker compose -f docker-compose.yml -f docker-compose.mssql.yml ps\ndocker compose -f docker-compose.yml -f docker-compose.mssql.yml exec api printenv TARGET_STORE_ADAPTER",
    "mssql-existing": "& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -TargetDb mssql `\n  -MssqlHost sql.internal -MssqlDatabase openldr_target `\n  -MssqlUser openldr -MssqlPassword 'REPLACE_WITH_DATABASE_PASSWORD' -Seedless",
    "mysql-demo": "& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -MysqlDemo -Seedless",
    "mysql-status": "Set-Location C:\\openldr_ce\ndocker compose -f docker-compose.yml -f docker-compose.mysql.yml ps\ndocker compose -f docker-compose.yml -f docker-compose.mysql.yml exec api printenv TARGET_STORE_ADAPTER",
    "mysql-existing": "& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -TargetDb mysql `\n  -MysqlHost mysql.internal -MysqlDatabase openldr_target `\n  -MysqlUser openldr -MysqlPassword 'REPLACE_WITH_DATABASE_PASSWORD' -Seedless",
    "target-status": "Set-Location C:\\openldr_ce\ndocker compose ps\ndocker compose exec api printenv TARGET_STORE_ADAPTER",
    "restart-gateway": "Set-Location C:\\openldr_ce\ndocker compose restart gateway",
    check: 'docker --version\ndocker compose version\ndocker info',
    download: `$installer = Invoke-RestMethod ${BASE}/install.ps1`,
    run: '& ([scriptblock]::Create($installer)) -Dir C:\\openldr_ce -Seedless',
    folder: 'Set-Location C:\\openldr_ce\nGet-ChildItem -Force -Name',
    status: 'Set-Location C:\\openldr_ce\ndocker compose ps',
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
    .replace(/\{\{install:([a-z-]+)\}\}/g, (_, key: string) => {
      if (!(key in INSTALL_COMMANDS[platform])) throw new Error(`Unknown installation command: ${key}`);
      return INSTALL_COMMANDS[platform][key as InstallCommand];
    })
    .replaceAll('~/Downloads/openldr_ce', platform === 'windows' ? 'C:\\openldr_ce' : '~/Downloads/openldr_ce');
}

export const INSTALL_SCENES = ['terminal', 'check', 'download', 'run', 'ready', 'folder', 'status', 'tls', 'tls-ready', 'renewal', 'scaffold', 'certificates', 'start', 'runtime', 'compose', 'storage', 'logs', 'remote', 'remote-check', 'certificate-check', 'mssql-demo', 'mssql-status', 'mssql-existing', 'mysql-demo', 'mysql-status', 'mysql-existing', 'target-status', 'restart-gateway', 'mssql-ready', 'mysql-ready'] as const;
export type InstallScene = (typeof INSTALL_SCENES)[number];

export function installScene(src: string): InstallScene | null {
  const name = src.replace(/^guide:install-/, '');
  return src.startsWith('guide:install-') && (INSTALL_SCENES as readonly string[]).includes(name) ? name as InstallScene : null;
}
