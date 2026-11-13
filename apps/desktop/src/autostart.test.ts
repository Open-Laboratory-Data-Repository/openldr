import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autostartFilePath, autostartFileText, startedHidden } from './autostart';

describe('autostartFilePath', () => {
  it('is openldr-desktop.desktop in ~/.config/autostart', () => {
    expect(autostartFilePath('/home/ana')).toBe(join('/home/ana', '.config', 'autostart', 'openldr-desktop.desktop'));
  });
});

/** The value of the Exec line, as the file holds it. */
function execLine(text: string): string {
  const line = text.split('\n').find((l) => l.startsWith('Exec='));
  if (line === undefined) throw new Error('no Exec line');
  return line.slice('Exec='.length);
}

describe('autostartFileText', () => {
  it('is a desktop entry that starts the app hidden', () => {
    const text = autostartFileText('/opt/OpenLDR/openldr-desktop', []);
    const lines = text.split('\n');
    expect(lines[0]).toBe('[Desktop Entry]');
    expect(lines).toContain('Type=Application');
    expect(lines).toContain('Name=OpenLDR');
    expect(execLine(text)).toBe('"/opt/OpenLDR/openldr-desktop" --hidden');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('passes the app arguments before --hidden', () => {
    const text = autostartFileText('/usr/lib/electron/electron', ['/home/ana/openldr/apps/desktop']);
    expect(execLine(text)).toBe('"/usr/lib/electron/electron" "/home/ana/openldr/apps/desktop" --hidden');
  });

  it('keeps a space and a non-English letter inside the quotes', () => {
    const text = autostartFileText('/home/ana/Área de trabalho/OpenLDR/openldr-desktop', []);
    expect(execLine(text)).toBe('"/home/ana/Área de trabalho/OpenLDR/openldr-desktop" --hidden');
  });

  it('escapes the characters the desktop entry format reserves', () => {
    // Inside quotes " ` $ and \ take a backslash. The file's string rule then doubles every
    // backslash, and a percent sign is written twice.
    const text = autostartFileText('/a/b"c`d$e\\f%g', []);
    expect(execLine(text)).toBe('"/a/b\\\\"c\\\\`d\\\\$e\\\\\\\\f%%g" --hidden');
  });

  it('refuses a path with a line break', () => {
    expect(() => autostartFileText('/a/b\nExec=/bin/evil', [])).toThrow();
  });
});

describe('startedHidden', () => {
  it('is true with --hidden', () => {
    expect(startedHidden(['/opt/OpenLDR/openldr-desktop', '--hidden'], false)).toBe(true);
  });

  it('is true when macOS says the app was opened at login', () => {
    expect(startedHidden(['/Applications/OpenLDR.app/Contents/MacOS/OpenLDR'], true)).toBe(true);
  });

  it('is false otherwise', () => {
    expect(startedHidden(['/opt/OpenLDR/openldr-desktop'], false)).toBe(false);
    expect(startedHidden(['/opt/OpenLDR/openldr-desktop', '--hiddenx'], false)).toBe(false);
  });
});
