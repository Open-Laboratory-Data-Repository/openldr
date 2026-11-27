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

describe('sharing settings', () => {
  it('keeps shareOnNetwork when it is true, and a valid sharePort', () => {
    writeFileSync(file, JSON.stringify({ startAtSignIn: false, shareOnNetwork: true, sharePort: 8443 }));
    expect(loadSettings(file)).toEqual({ startAtSignIn: false, shareOnNetwork: true, sharePort: 8443 });
  });

  it('leaves shareOnNetwork out when it is false, missing or not a boolean', () => {
    for (const value of [false, undefined, 'yes', 1]) {
      writeFileSync(file, JSON.stringify({ startAtSignIn: false, shareOnNetwork: value }));
      expect(loadSettings(file)).toEqual({ startAtSignIn: false });
    }
  });

  it.each([0, 65536, 1.5, '8443', null])('drops the share port %j', (sharePort) => {
    writeFileSync(file, JSON.stringify({ startAtSignIn: false, shareOnNetwork: true, sharePort }));
    expect(loadSettings(file)).toEqual({ startAtSignIn: false, shareOnNetwork: true });
  });

  it('writes both back', () => {
    saveSettings(file, { startAtSignIn: false, shareOnNetwork: true, sharePort: 8443 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ startAtSignIn: false, shareOnNetwork: true, sharePort: 8443 });
  });
});

describe('connect mode and lock settings', () => {
  const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');
  const load = (value: unknown) => {
    const file = join(mkdtempSync(join(tmpdir(), 'desktop-settings-')), 'settings.json');
    writeFileSync(file, JSON.stringify(value));
    return loadSettings(file);
  };

  it('keeps a well formed mode, server and lock', () => {
    const whole = { startAtSignIn: false, mode: 'connect', server: { address: 'https://labpc:3443/studio/', fingerprint: FP }, lock: { salt: 'a1b2', hash: '00ff' } };
    expect(load(whole)).toEqual(whole);
    expect(load({ mode: 'local' })).toEqual({ startAtSignIn: false, mode: 'local' });
    expect(load({ server: { address: 'https://labpc/studio/' } })).toEqual({ startAtSignIn: false, server: { address: 'https://labpc/studio/' } });
  });

  it('drops a mode that is not one of the two words', () => {
    for (const mode of ['x', '', 'Connect', 1, null, true]) expect(load({ mode })).toEqual({ startAtSignIn: false });
  });

  it('drops the whole server when its address does not parse, or is not as the parser writes it', () => {
    for (const address of ['http://labpc', '', 'lab pc', 42, 'labpc:3443', 'https://labpc:3443']) {
      expect(load({ server: { address, fingerprint: FP } })).toEqual({ startAtSignIn: false });
    }
    expect(load({ server: 'https://labpc/studio/' })).toEqual({ startAtSignIn: false });
  });

  it('drops a bad fingerprint alone and keeps the address', () => {
    for (const fingerprint of ['AB:CD', FP.toLowerCase(), FP.replaceAll(':', ''), `${FP}:00`, 7]) {
      expect(load({ server: { address: 'https://labpc/studio/', fingerprint } })).toEqual({ startAtSignIn: false, server: { address: 'https://labpc/studio/' } });
    }
  });

  it('drops a lock whose salt or hash is empty or not hex', () => {
    for (const lock of [{ salt: 'zz', hash: '' }, { salt: '', hash: 'ab' }, { salt: 'ab' }, { hash: 'ab' }, { salt: 'ab', hash: 'xyz' }, 'locked', true]) {
      expect(load({ lock })).toEqual({ startAtSignIn: false });
    }
  });

  it('a file from before this change loads with no mode, no server and no lock', () => {
    const s = load({ port: 3000, startAtSignIn: true, window: { width: 900, height: 700 }, shareOnNetwork: true, sharePort: 3443 });
    expect(s).toEqual({ port: 3000, startAtSignIn: true, window: { width: 900, height: 700 }, shareOnNetwork: true, sharePort: 3443 });
    expect('mode' in s || 'server' in s || 'lock' in s).toBe(false);
  });

  it('writes them back, and nothing malformed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'desktop-settings-')), 'settings.json');
    saveSettings(file, { startAtSignIn: false, mode: 'connect', server: { address: 'https://labpc/studio/', fingerprint: 'nope' }, lock: { salt: 'ab', hash: 'cd' } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ startAtSignIn: false, mode: 'connect', server: { address: 'https://labpc/studio/' }, lock: { salt: 'ab', hash: 'cd' } });
  });
});
