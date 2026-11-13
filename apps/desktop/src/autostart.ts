// "Start when I sign in". On Linux a desktop entry in ~/.config/autostart; on Windows and macOS
// Electron's login-item setting. Started this way the app opens no window.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The argument that starts the app with no window. */
export const HIDDEN_ARG = '--hidden';

export function autostartFilePath(home: string): string {
  return join(home, '.config', 'autostart', 'openldr-desktop.desktop');
}

/**
 * One Exec argument, quoted. Inside quotes the format reserves " ` $ and \, which take a
 * backslash. The file's string rule then doubles every backslash, and % is written %%.
 */
function execArg(arg: string): string {
  if (/[\r\n]/.test(arg)) throw new Error('A path for the sign-in entry cannot hold a line break.');
  const quoted = `"${arg.replace(/["`$\\]/g, (c) => `\\${c}`)}"`;
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

/** The desktop entry that starts this app, with `appArgs` and then --hidden. */
export function autostartFileText(execPath: string, appArgs: readonly string[]): string {
  const exec = [execPath, ...appArgs].map(execArg).concat(HIDDEN_ARG).join(' ');
  return ['[Desktop Entry]', 'Type=Application', 'Name=OpenLDR', `Exec=${exec}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}

/** True when the app was started at sign-in: with --hidden, or as macOS says. */
export function startedHidden(argv: readonly string[], wasOpenedAtLogin: boolean): boolean {
  return wasOpenedAtLogin || argv.includes(HIDDEN_ARG);
}

/** What setting and reading the sign-in start needs from Electron and the system. */
export interface AutostartDeps {
  platform: NodeJS.Platform;
  home: string;
  execPath: string;
  appArgs: readonly string[];
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(s: { openAtLogin: boolean; args: string[] }): void;
}

/** Whether the app starts at sign-in now, as the system holds it. */
export function autostartEnabled(d: AutostartDeps): boolean {
  if (d.platform === 'linux') return existsSync(autostartFilePath(d.home));
  return d.getLoginItemSettings().openAtLogin;
}

/** Turns the sign-in start on or off. */
export function setAutostart(d: AutostartDeps, on: boolean): void {
  if (d.platform !== 'linux') {
    d.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_ARG] });
    return;
  }
  const file = autostartFilePath(d.home);
  if (on) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, autostartFileText(d.execPath, d.appArgs));
  } else {
    rmSync(file, { force: true });
  }
}
