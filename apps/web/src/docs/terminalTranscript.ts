import { INSTALL_COMMANDS, type InstallPlatform, type InstallScene } from './installGuide';

export type TerminalRow = { kind: 'input' | 'output' | 'empty'; text: string; prompt?: string; cursor?: boolean };
const MAX_COLUMNS = 70;

function prompt(platform: InstallPlatform, folder: string) {
  return platform === 'windows' ? `PS ${folder}> ` : `operator@workstation:${folder}$ `;
}

function inputRows(text: string, prefix: string): TerminalRow[] {
  const rows: TerminalRow[] = [];
  let remaining = text;
  let first = true;
  do {
    const lead = first ? prefix : '';
    const columns = MAX_COLUMNS - lead.length;
    // A terminal wraps at its edge without changing the command's characters.
    rows.push({ kind: 'input', prompt: lead, text: remaining.slice(0, columns) });
    remaining = remaining.slice(columns);
    first = false;
  } while (remaining.length);
  return rows;
}

/** Shell prompts belong to the illustration only. They never enter copyable commands. */
export function commandRows(command: string, platform: InstallPlatform): TerminalRow[] {
  let folder = platform === 'windows' ? 'C:\\Users\\operator' : '~';
  let continuation = false;
  let hereDoc: string | undefined;
  return command.split('\n').flatMap(line => {
    const lead = continuation || hereDoc ? platform === 'windows' ? '>> ' : '> ' : prompt(platform, folder);
    const rows = inputRows(line, lead);
    if (hereDoc === line) hereDoc = undefined;
    else hereDoc ??= line.match(/<<['"]?([A-Z]+)['"]?\s*$/)?.[1];
    continuation = /[\\`]\s*$/.test(line);
    if (/^(cd|Set-Location) /.test(line) && line.includes('openldr_ce')) {
      folder = platform === 'windows' ? 'C:\\openldr_ce' : '~/Downloads/openldr_ce';
    }
    return rows;
  });
}

function output(lines: string[]): TerminalRow[] {
  return lines.map(text => ({ kind: text ? 'output' : 'empty', text }));
}

export function terminalTranscript(scene: InstallScene, platform: InstallPlatform, command?: string): TerminalRow[] {
  if (command !== undefined) {
    const rows = commandRows(command, platform);
    if (rows.length) rows[rows.length - 1].cursor = true;
    return rows;
  }
  const freshPrompt = (): TerminalRow => ({ kind: 'input', prompt: prompt(platform, platform === 'windows' ? 'C:\\Users\\operator' : '~'), text: '', cursor: true });
  const exchange = (input: string, response: string[]): TerminalRow[] => [...commandRows(input, platform), ...output(response)];
  if (scene === 'folder') return [];
  if (scene === 'terminal') return [freshPrompt()];
  if (scene === 'check') return [
    ...exchange('docker --version', ['Docker version 29.5.2, build 79eb04c', '']),
    ...exchange('docker compose version', ['Docker Compose version v5.4.0', '']),
    // Selected fields from actual read-only Docker output. Other fields are omitted.
    ...exchange('docker info', ['Client: Docker Engine - Community', ' Version:    29.5.2', 'Server:', ' Server Version: 29.7.2', ' OSType: linux', ' Architecture: x86_64', '']),
    freshPrompt(),
  ];
  if (scene === 'runtime') return [...exchange("docker info --format '{{.OSType}}/{{.Architecture}}'", ['linux/x86_64', '']), freshPrompt()];
  if (scene === 'compose') return [...exchange('docker compose version', ['Docker Compose version v5.4.0', '']), freshPrompt()];
  if (scene === 'ready') return [...output([
    `${platform === 'windows' ? 'OK' : '✓'} OpenLDR is ready. Open https://localhost`,
    '', 'Setup code: <setup code>, valid for 30 minutes',
    'Open https://localhost/studio/ and enter it on the Create the administrator page.',
    `For a new code, run: ${platform === 'windows' ? '.\\openldr.ps1' : './openldr'} auth setup-code`, '',
  ]), freshPrompt()];
  if (scene === 'mssql-ready') return output(['  MSSQL (demo) SA password: <generated password>']);
  if (scene === 'mysql-ready') return output(['  MySQL (demo) root password: <generated password>']);
  if (scene === 'tls-ready') return [...output(['✓ Trusted cert installed for https://openldr.example.org', '']), freshPrompt()];
  const input = scene === 'storage' ? 'docker system df' : scene === 'renewal' ? 'crontab -e' : INSTALL_COMMANDS[platform][scene];
  const rows = commandRows(input, platform);
  if (rows.length) rows[rows.length - 1].cursor = true;
  return rows;
}
