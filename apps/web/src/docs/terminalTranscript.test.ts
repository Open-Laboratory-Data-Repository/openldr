import { describe, expect, it } from 'vitest';
import { commandRows, terminalTranscript } from './terminalTranscript';
import { INSTALL_COMMANDS } from './installGuide';
import { SERVER_COMMANDS, serverPlatform } from './serverGuide';

describe('Terminal illustrations', () => {
  it('distinguishes typed Docker commands from program output and the next prompt', () => {
    const rows = terminalTranscript('check', 'unix');
    expect(rows.filter(row => row.kind === 'input' && row.text).map(row => row.text)).toEqual(['docker --version', 'docker compose version', 'docker info']);
    expect(rows.find(row => row.text.startsWith('Docker version'))?.kind).toBe('output');
    expect(rows.filter(row => row.kind === 'output').every(row => !row.prompt)).toBe(true);
    expect(rows.at(-1)).toMatchObject({ text: '', cursor: true, prompt: 'operator@workstation:~$ ' });
  });

  it('uses a PowerShell prompt without adding it to the copyable commands', () => {
    const rows = terminalTranscript('check', 'windows');
    expect(rows[0].prompt).toBe('PS C:\\Users\\operator> ');
    expect(INSTALL_COMMANDS.windows.check).toBe('docker --version\ndocker compose version\ndocker info');
  });

  it('changes the illustrated folder after changing directories', () => {
    const unix = commandRows(INSTALL_COMMANDS.unix.status, 'unix');
    expect(unix.find(row => row.text === 'docker compose ps')?.prompt).toBe('operator@workstation:~/Downloads/openldr_ce$ ');
    const windows = commandRows(INSTALL_COMMANDS.windows.status, 'windows');
    expect(windows.find(row => row.text === 'docker compose ps')?.prompt).toBe('PS C:\\openldr_ce> ');
  });

  it('shows shell continuation prompts through a here-document and resets afterward', () => {
    const rows = commandRows(SERVER_COMMANDS['docker-repo'], 'unix');
    expect(rows.find(row => row.text === 'Types: deb')?.prompt).toBe('> ');
    expect(rows.find(row => row.text === 'EOF')?.prompt).toBe('> ');
    expect(rows.at(-1)?.prompt).toBe('operator@workstation:~$ ');
  });

  it('preserves all command characters when a terminal wraps a long line', () => {
    const command = 'curl -fsSL ' + 'https://example.org/'.repeat(8);
    const rows = commandRows(command, 'unix');
    expect(rows.map(row => row.text).join('')).toBe(command);
    expect(rows.slice(1).every(row => row.prompt === '')).toBe(true);
  });

  it('uses Windows prompts for server management and Linux prompts inside Ubuntu', () => {
    expect(serverPlatform('wsl-install')).toBe('windows');
    expect(serverPlatform('vm-create')).toBe('windows');
    expect(serverPlatform('docker-install')).toBe('unix');
    expect(serverPlatform('systemd-edit')).toBe('unix');
  });
});
