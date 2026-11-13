import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openldr-desktop-settings-'));
  file = join(dir, 'settings.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadSettings', () => {
  it('gives the defaults for a missing file', () => {
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ startAtSignIn: false });
  });

  it('gives the defaults for a file it cannot read', () => {
    mkdirSync(file); // a folder where the file should be
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });

  it('gives the defaults for a malformed file', () => {
    writeFileSync(file, '{ not json');
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
    writeFileSync(file, '[1, 2]');
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
    writeFileSync(file, 'null');
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads the three known fields', () => {
    writeFileSync(file, JSON.stringify({ port: 3991, startAtSignIn: true, window: { width: 1200, height: 800 } }));
    expect(loadSettings(file)).toEqual({ port: 3991, startAtSignIn: true, window: { width: 1200, height: 800 } });
  });

  it('gives the default for a field of the wrong type, and keeps the others', () => {
    writeFileSync(file, JSON.stringify({ port: '3991', startAtSignIn: 'yes', window: { width: 1200, height: 800 } }));
    expect(loadSettings(file)).toEqual({ startAtSignIn: false, window: { width: 1200, height: 800 } });
    writeFileSync(file, JSON.stringify({ port: 3991, startAtSignIn: true, window: { width: '1200', height: 800 } }));
    expect(loadSettings(file)).toEqual({ port: 3991, startAtSignIn: true });
    writeFileSync(file, JSON.stringify({ port: 3991, startAtSignIn: true, window: 'big' }));
    expect(loadSettings(file)).toEqual({ port: 3991, startAtSignIn: true });
  });

  it('takes a port only as a whole number from 1 to 65535', () => {
    for (const port of [0, -1, 65536, 3000.5, Number.MAX_SAFE_INTEGER]) {
      writeFileSync(file, JSON.stringify({ port, startAtSignIn: false }));
      expect(loadSettings(file).port).toBeUndefined();
    }
    for (const port of [1, 3000, 65535]) {
      writeFileSync(file, JSON.stringify({ port, startAtSignIn: false }));
      expect(loadSettings(file).port).toBe(port);
    }
  });

  it('drops unknown fields', () => {
    writeFileSync(file, JSON.stringify({ startAtSignIn: true, setupCode: 'planted', window: { width: 900, height: 700, x: 5 } }));
    const s = loadSettings(file);
    expect(s).toEqual({ startAtSignIn: true, window: { width: 900, height: 700 } });
    expect(JSON.stringify(s)).not.toContain('planted');
  });

  it('returns a fresh object each time, so a caller cannot change the defaults', () => {
    const s = loadSettings(file);
    s.startAtSignIn = true;
    expect(DEFAULT_SETTINGS.startAtSignIn).toBe(false);
    expect(loadSettings(file).startAtSignIn).toBe(false);
  });
});

describe('saveSettings', () => {
  it('writes only the three known fields', () => {
    const passed = { port: 3992, startAtSignIn: true, window: { width: 1000, height: 600 }, setupCode: 'planted' };
    saveSettings(file, passed);
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('setupCode');
    expect(text).not.toContain('planted');
    expect(JSON.parse(text)).toEqual({ port: 3992, startAtSignIn: true, window: { width: 1000, height: 600 } });
  });

  it('creates the folder', () => {
    const deep = join(dir, 'a', 'b', 'settings.json');
    saveSettings(deep, { startAtSignIn: false });
    expect(loadSettings(deep)).toEqual({ startAtSignIn: false });
  });

  it('replaces the file by rename and leaves no temp file', () => {
    saveSettings(file, { startAtSignIn: false });
    const before = statSync(file).ino;
    saveSettings(file, { port: 3993, startAtSignIn: false });
    // A rename puts a new file in place. Writing into the old file would keep its inode.
    expect(statSync(file).ino).not.toBe(before);
    expect(readdirSync(dir)).toEqual(['settings.json']);
    expect(loadSettings(file)).toEqual({ port: 3993, startAtSignIn: false });
  });

  it('round-trips through loadSettings', () => {
    const s = { port: 3994, startAtSignIn: true, window: { width: 1360, height: 900 } };
    saveSettings(file, s);
    expect(loadSettings(file)).toEqual(s);
  });
});
