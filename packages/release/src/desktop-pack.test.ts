import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  archiveName,
  checkArchiveEntries,
  commandScript,
  DESKTOP_SYSTEMS,
  desktopLayout,
  electronTarget,
  icnsFromPng256,
  icoFromPng,
  LEFT_OUT,
  lockfileIntegrity,
  matchesIntegrity,
  npmTarballUrl,
  packedPackageJson,
  parseDesktopSystem,
  placePackages,
  plistString,
  postgresPackage,
  renamePlist,
  sha256SumsText,
  type ClosurePackage,
  type DesktopSystem,
} from './desktop-pack';

describe('parseDesktopSystem', () => {
  // The pack and the release take the system from the command line. A typo or an unsupported
  // system must stop with the three names, not pack something nobody asked for.
  it('refuses another system and names the three', () => {
    expect(() => parseDesktopSystem('linux-arm64')).toThrow(/linux-x64.*darwin-arm64.*win32-x64/);
  });

  it('takes each of the three', () => {
    for (const s of DESKTOP_SYSTEMS) expect(parseDesktopSystem(s)).toBe(s);
  });
});

describe('archiveName', () => {
  // The install scripts download exactly these names. Changing one breaks every install.
  it('gives the three names the release uploads', () => {
    expect(archiveName('0.1.11', 'linux-x64')).toBe('openldr-desktop-0.1.11-linux-x64.tar.gz');
    expect(archiveName('0.1.11', 'darwin-arm64')).toBe('openldr-desktop-0.1.11-darwin-arm64.tar.gz');
    expect(archiveName('0.1.11', 'win32-x64')).toBe('openldr-desktop-0.1.11-win32-x64.zip');
  });
});

describe('postgresPackage', () => {
  // The launcher's PLATFORM_PACKAGES (apps/standalone/src/postgres.ts) names these. Windows is
  // `windows-x64` there, not `win32-x64`.
  it('names the Postgres package for each system', () => {
    expect(postgresPackage('linux-x64')).toBe('@embedded-postgres/linux-x64');
    expect(postgresPackage('darwin-arm64')).toBe('@embedded-postgres/darwin-arm64');
    expect(postgresPackage('win32-x64')).toBe('@embedded-postgres/windows-x64');
  });
});

describe('electronTarget', () => {
  // @electron/get takes Node's platform and arch names.
  it('gives the platform and arch for each system', () => {
    expect(electronTarget('linux-x64')).toEqual({ platform: 'linux', arch: 'x64' });
    expect(electronTarget('darwin-arm64')).toEqual({ platform: 'darwin', arch: 'arm64' });
    expect(electronTarget('win32-x64')).toEqual({ platform: 'win32', arch: 'x64' });
  });
});

describe('desktopLayout', () => {
  // The install scripts unpack an archive and expect these paths. On macOS the binary keeps
  // Electron's name: the helper apps are found by it, and nobody here can try a rename.
  it('gives the layout of each archive', () => {
    expect(desktopLayout('linux-x64')).toEqual({
      root: 'openldr-desktop',
      appDir: 'openldr-desktop/resources/app',
      binary: 'openldr-desktop/openldr-desktop',
      command: 'openldr-desktop/openldr-standalone',
    });
    expect(desktopLayout('win32-x64')).toEqual({
      root: 'OpenLDR',
      appDir: 'OpenLDR/resources/app',
      binary: 'OpenLDR/OpenLDR.exe',
      command: 'OpenLDR/openldr-standalone.cmd',
    });
    expect(desktopLayout('darwin-arm64')).toEqual({
      root: 'OpenLDR.app',
      appDir: 'OpenLDR.app/Contents/Resources/app',
      binary: 'OpenLDR.app/Contents/MacOS/Electron',
      command: 'OpenLDR.app/Contents/Resources/openldr-standalone',
    });
  });
});

/** Every entry the check requires, for one system. */
function requiredEntries(system: DesktopSystem): string[] {
  const l = desktopLayout(system);
  const a = l.appDir;
  const exe = system === 'win32-x64' ? '.exe' : '';
  const pg = `${a}/apps/standalone/node_modules/${postgresPackage(system)}/native/bin`;
  const list = [
    l.binary,
    l.command,
    `${a}/package.json`,
    `${a}/apps/desktop/dist/main.js`,
    `${a}/apps/desktop/dist/preload.cjs`,
    `${a}/apps/desktop/pages/page.html`,
    `${a}/apps/standalone/package.json`,
    `${a}/apps/standalone/dist/index.js`,
    `${a}/apps/standalone/dist/cli.js`,
    `${a}/apps/standalone/fixtures/fhir/R4.valuesets.json.gz`,
    `${a}/apps/studio/dist/index.html`,
    `${a}/apps/standalone/node_modules/embedded-postgres/package.json`,
    `${pg}/postgres${exe}`,
    `${pg}/pg_ctl${exe}`,
    `${pg}/initdb${exe}`,
  ];
  if (system === 'linux-x64') list.push('openldr-desktop/chrome-sandbox');
  return list;
}

/** A full, correct listing: the required entries, their folders as tar lists them, and a few more. */
function fullList(system: DesktopSystem): string[] {
  const l = desktopLayout(system);
  return [
    `${l.root}/`,
    `${l.appDir}/`,
    `${l.appDir}/apps/standalone/fixtures/fhir/`,
    `${l.appDir}/apps/standalone/node_modules/pg/package.json`,
    `${l.appDir}/apps/standalone/node_modules/@embedded-postgres/`,
    ...requiredEntries(system),
  ];
}

describe('checkArchiveEntries', () => {
  it('passes a full, correct list for each system', () => {
    for (const s of DESKTOP_SYSTEMS) expect(checkArchiveEntries(s, fullList(s))).toEqual([]);
  });

  // Each required entry is something the app or the launcher reads at start. Without it the
  // packed app shows an error screen, or does not start at all.
  it('reports each missing required entry, naming it', () => {
    for (const s of DESKTOP_SYSTEMS) {
      for (const entry of requiredEntries(s)) {
        const problems = checkArchiveEntries(
          s,
          fullList(s).filter((e) => e !== entry),
        );
        // The fixtures are required as a folder with something in it, so the problem names the folder.
        const named = entry.includes('/fixtures/fhir/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : entry;
        expect(problems, `${s}: ${entry}`).toHaveLength(1);
        expect(problems[0], `${s}: ${entry}`).toContain(named);
      }
    }
  });

  // cpu-features is a native addon nothing here can build for another system (spec 6.7).
  it('reports a left-out package', () => {
    const entry = 'openldr-desktop/resources/app/apps/standalone/node_modules/cpu-features/package.json';
    const problems = checkArchiveEntries('linux-x64', [...fullList('linux-x64'), entry]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(entry);
  });

  // A .node file is compiled for one system. One in an archive for another system cannot load.
  it('reports a compiled addon', () => {
    const entry = 'OpenLDR/resources/app/apps/standalone/node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node';
    const problems = checkArchiveEntries('win32-x64', [...fullList('win32-x64'), entry]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(entry);
  });

  // The Linux Postgres binaries in a Windows archive would be 58 MB of dead weight, and a sign
  // that the pack copied the wrong folder.
  it('reports a Postgres package for another system', () => {
    const entry = 'OpenLDR/resources/app/apps/standalone/node_modules/@embedded-postgres/linux-x64/package.json';
    const problems = checkArchiveEntries('win32-x64', [...fullList('win32-x64'), entry]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(entry);
  });

  // The install scripts unpack into a staging folder and move the one top folder into place.
  // Anything outside it would land beside the install.
  it('reports an entry outside the top folder', () => {
    const problems = checkArchiveEntries('darwin-arm64', [...fullList('darwin-arm64'), 'other/file']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('other/file');
  });

  it('reports an entry that climbs out of the top folder', () => {
    const entry = 'OpenLDR.app/../evil';
    const problems = checkArchiveEntries('darwin-arm64', [...fullList('darwin-arm64'), entry]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(entry);
  });

  // Electron on Linux needs chrome-sandbox beside the binary when user namespaces are refused.
  it('reports a Linux list without chrome-sandbox', () => {
    const problems = checkArchiveEntries(
      'linux-x64',
      fullList('linux-x64').filter((e) => e !== 'openldr-desktop/chrome-sandbox'),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('openldr-desktop/chrome-sandbox');
  });
});

describe('sha256SumsText', () => {
  // `sha256sum -c` reads this file. Sorted by name so two packs of the same files give the same text.
  it('sorts by name and ends every line with a newline', () => {
    const text = sha256SumsText([
      { name: 'openldr-desktop-0.1.11-win32-x64.zip', sha256: 'b'.repeat(64) },
      { name: 'openldr-desktop-0.1.11-darwin-arm64.tar.gz', sha256: 'a'.repeat(64) },
    ]);
    expect(text).toBe(
      `${'a'.repeat(64)}  openldr-desktop-0.1.11-darwin-arm64.tar.gz\n${'b'.repeat(64)}  openldr-desktop-0.1.11-win32-x64.zip\n`,
    );
  });

  // The install scripts read a line by splitting on spaces. A name with a space would not match.
  it('refuses a name with a space', () => {
    expect(() => sha256SumsText([{ name: 'a b.zip', sha256: 'a'.repeat(64) }])).toThrow(/a b\.zip/);
  });

  it('refuses a value that is not a SHA-256', () => {
    expect(() => sha256SumsText([{ name: 'a.zip', sha256: 'xyz' }])).toThrow(/a\.zip/);
  });
});

describe('placePackages', () => {
  const pkg = (name: string, version: string, dependencies: Record<string, string> = {}): ClosurePackage => ({
    name,
    version,
    dependencies,
  });

  it('puts a name with one version at the top level', () => {
    const placed = placePackages([pkg('ssh2', '1.17.0', { asn1: '0.2.6' }), pkg('asn1', '0.2.6')], [{ name: 'ssh2', version: '1.17.0' }]);
    expect(placed).toEqual([
      { name: 'asn1', version: '0.2.6', path: 'asn1' },
      { name: 'ssh2', version: '1.17.0', path: 'ssh2' },
    ]);
  });

  // The launcher is built against pg 8.21.0. embedded-postgres asks for ^8.23.1. Node must give
  // each the version it asks for.
  it('puts the version a root asks for at the top level and nests the other', () => {
    const placed = placePackages(
      [pkg('pg', '8.21.0'), pkg('embedded-postgres', '16.15.0-beta.19', { pg: '8.23.1' }), pkg('pg', '8.23.1')],
      [
        { name: 'pg', version: '8.21.0' },
        { name: 'embedded-postgres', version: '16.15.0-beta.19' },
      ],
    );
    expect(placed).toEqual([
      { name: 'embedded-postgres', version: '16.15.0-beta.19', path: 'embedded-postgres' },
      { name: 'pg', version: '8.23.1', path: 'embedded-postgres/node_modules/pg' },
      { name: 'pg', version: '8.21.0', path: 'pg' },
    ]);
  });

  // Node walks up from the nested copy and finds the top-level one. A second copy is waste.
  it('does not copy again a dependency of a nested package that the top level satisfies', () => {
    const placed = placePackages(
      [
        pkg('pg', '8.21.0', { 'pg-pool': '3.14.0' }),
        pkg('embedded-postgres', '16.15.0-beta.19', { pg: '8.23.1' }),
        pkg('pg', '8.23.1', { 'pg-pool': '3.14.0' }),
        pkg('pg-pool', '3.14.0'),
      ],
      [
        { name: 'pg', version: '8.21.0' },
        { name: 'embedded-postgres', version: '16.15.0-beta.19' },
      ],
    );
    expect(placed.map((p) => p.path)).toEqual(['embedded-postgres', 'embedded-postgres/node_modules/pg', 'pg', 'pg-pool']);
  });

  it('nests a dependency of a nested package that the top level does not satisfy under that package', () => {
    const placed = placePackages(
      [
        pkg('pg', '8.21.0', { 'pg-protocol': '1.10.0' }),
        pkg('embedded-postgres', '16.15.0-beta.19', { pg: '8.23.1' }),
        pkg('pg', '8.23.1', { 'pg-protocol': '1.13.0' }),
        pkg('pg-protocol', '1.10.0'),
        pkg('pg-protocol', '1.13.0'),
        pkg('pdfkit', '0.15.2', { 'pg-protocol': '1.10.0' }),
      ],
      [
        { name: 'pg', version: '8.21.0' },
        { name: 'embedded-postgres', version: '16.15.0-beta.19' },
        { name: 'pdfkit', version: '0.15.2' },
      ],
    );
    expect(placed).toContainEqual({ name: 'pg-protocol', version: '1.10.0', path: 'pg-protocol' });
    expect(placed).toContainEqual({
      name: 'pg-protocol',
      version: '1.13.0',
      path: 'embedded-postgres/node_modules/pg/node_modules/pg-protocol',
    });
    expect(placed).toHaveLength(6);
  });

  // pdfkit pulls two versions each of base64-js and pako, and no root asks for either.
  it('with no root among the versions, puts the one with more dependents at the top level', () => {
    const placed = placePackages(
      [
        pkg('a', '1.0.0', { pako: '0.2.9' }),
        pkg('b', '1.0.0', { pako: '0.2.9' }),
        pkg('c', '1.0.0', { pako: '1.0.11' }),
        pkg('pako', '0.2.9'),
        pkg('pako', '1.0.11'),
      ],
      [
        { name: 'a', version: '1.0.0' },
        { name: 'b', version: '1.0.0' },
        { name: 'c', version: '1.0.0' },
      ],
    );
    expect(placed).toContainEqual({ name: 'pako', version: '0.2.9', path: 'pako' });
    expect(placed).toContainEqual({ name: 'pako', version: '1.0.11', path: 'c/node_modules/pako' });
  });

  it('with equal dependents, puts the higher version at the top level', () => {
    const placed = placePackages(
      [pkg('a', '1.0.0', { pako: '0.2.9' }), pkg('c', '1.0.0', { pako: '1.0.11' }), pkg('pako', '0.2.9'), pkg('pako', '1.0.11')],
      [
        { name: 'a', version: '1.0.0' },
        { name: 'c', version: '1.0.0' },
      ],
    );
    expect(placed).toContainEqual({ name: 'pako', version: '1.0.11', path: 'pako' });
    expect(placed).toContainEqual({ name: 'pako', version: '0.2.9', path: 'a/node_modules/pako' });
  });

  // A closure that names a dependency it does not hold was gathered wrongly. Copying it anyway
  // would ship an app that fails on first use.
  it('refuses a dependency that is not in the closure', () => {
    expect(() => placePackages([pkg('a', '1.0.0', { b: '2.0.0' })], [{ name: 'a', version: '1.0.0' }])).toThrow(/b@2\.0\.0/);
  });
});

describe('npmTarballUrl', () => {
  it('builds a scoped package URL', () => {
    expect(npmTarballUrl('@embedded-postgres/darwin-arm64', '16.15.0-beta.19')).toBe(
      'https://registry.npmjs.org/@embedded-postgres/darwin-arm64/-/darwin-arm64-16.15.0-beta.19.tgz',
    );
  });

  it('builds an unscoped package URL', () => {
    expect(npmTarballUrl('pg', '8.21.0')).toBe('https://registry.npmjs.org/pg/-/pg-8.21.0.tgz');
  });
});

describe('lockfileIntegrity', () => {
  // pnpm-lock.yaml lists each package twice: once under `packages:` with its resolution, once
  // under `snapshots:` without. Only the first has the integrity.
  const lock = [
    'packages:',
    '',
    "  '@embedded-postgres/darwin-arm64@16.15.0-beta.19':",
    '    resolution: {integrity: sha512-pXgn5H+fHX+jjjE4NcvG2+J3uob8rzuoV0VWXOPkGJqUcaKfctcNFm7Z7DwR2kG5SaXwyfww/q0/OwtQHG7Ivg==}',
    "    engines: {node: '>=16'}",
    '',
    '  pg@8.21.0:',
    '    resolution: {integrity: sha512-AUP1EYJuHraQGsVoCQVIcM7TEJVGtDzxWtGFZd8rds9d+CCXlU5Js1rYgfLNvxy9iJrpHjGrRjoi/3BT9fRyiA==}',
    '',
    'snapshots:',
    '',
    "  '@embedded-postgres/darwin-arm64@16.15.0-beta.19':",
    '    optional: true',
    '',
  ].join('\n');

  it('gives the integrity after the first key', () => {
    expect(lockfileIntegrity(lock, '@embedded-postgres/darwin-arm64', '16.15.0-beta.19')).toBe(
      'sha512-pXgn5H+fHX+jjjE4NcvG2+J3uob8rzuoV0VWXOPkGJqUcaKfctcNFm7Z7DwR2kG5SaXwyfww/q0/OwtQHG7Ivg==',
    );
  });

  it('reads an unquoted key too', () => {
    expect(lockfileIntegrity(lock, 'pg', '8.21.0')).toMatch(/^sha512-AUP1/);
  });

  it('throws for a package that is not there', () => {
    expect(() => lockfileIntegrity(lock, '@embedded-postgres/windows-x64', '16.15.0-beta.19')).toThrow(/windows-x64/);
  });
});

describe('matchesIntegrity', () => {
  const bytes = new TextEncoder().encode('the bytes of a tarball');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

  it('is true for bytes against their own value', () => {
    expect(matchesIntegrity(bytes, integrity)).toBe(true);
  });

  // A download cut short or changed on the way must never be unpacked.
  it('is false after one byte changes', () => {
    const changed = bytes.slice();
    changed[0] = (changed[0] ?? 0) ^ 1;
    expect(matchesIntegrity(changed, integrity)).toBe(false);
  });

  // A weaker hash is not accepted in place of the one the lockfile records.
  it('is false for an integrity that is not sha512', () => {
    const sha1 = `sha1-${createHash('sha1').update(bytes).digest('base64')}`;
    expect(matchesIntegrity(bytes, sha1)).toBe(false);
  });
});

describe('renamePlist and plistString', () => {
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>CFBundleDisplayName</key>',
    '\t<string>Electron</string>',
    '\t<key>CFBundleExecutable</key>',
    '\t<string>Electron</string>',
    '\t<key>CFBundleIconFile</key>',
    '\t<string>electron.icns</string>',
    '\t<key>CFBundleIdentifier</key>',
    '\t<string>com.github.Electron</string>',
    '\t<key>CFBundleName</key>',
    '\t<string>Electron</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

  // The pack changes the shown name only. The identifier and the executable stay Electron's,
  // because the helper apps inside carry them (plan, "macOS, the app's identity").
  it('sets the two shown names and changes no other line', () => {
    const out = renamePlist(plist, 'OpenLDR');
    const before = plist.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      const key = before[i - 1]?.trim();
      if (key === '<key>CFBundleName</key>' || key === '<key>CFBundleDisplayName</key>') {
        expect(after[i]).toBe('\t<string>OpenLDR</string>');
      } else {
        expect(after[i]).toBe(before[i]);
      }
    }
    expect(plistString(out, 'CFBundleIdentifier')).toBe('com.github.Electron');
  });

  it('adds the shown name after the bundle name when the plist has none', () => {
    const without = plist.replace('\t<key>CFBundleDisplayName</key>\n\t<string>Electron</string>\n', '');
    const out = renamePlist(without, 'OpenLDR');
    expect(plistString(out, 'CFBundleDisplayName')).toBe('OpenLDR');
    expect(plistString(out, 'CFBundleName')).toBe('OpenLDR');
  });

  // A binary plist cannot be edited as text. The pack stops and reports instead of guessing.
  it('throws for a text that is not an XML plist', () => {
    expect(() => renamePlist('bplist00...', 'OpenLDR')).toThrow();
  });

  it('reads a string value, or undefined when the key is not there', () => {
    expect(plistString(plist, 'CFBundleIconFile')).toBe('electron.icns');
    expect(plistString(plist, 'NoSuchKey')).toBeUndefined();
  });
});

describe('commandScript', () => {
  // The command runs the launcher with the app's own Electron acting as Node, so a person needs
  // no Node of their own.
  it('runs the launcher with the Linux binary', () => {
    expect(commandScript('linux-x64')).toContain(
      'ELECTRON_RUN_AS_NODE=1 exec "$dir/openldr-desktop" "$dir/resources/app/apps/standalone/dist/index.js" "$@"',
    );
  });

  // The install links the command into ~/.local/bin. It must find its own folder through that link.
  it('follows a link to itself on Linux and macOS', () => {
    for (const s of ['linux-x64', 'darwin-arm64'] as const) {
      const text = commandScript(s);
      expect(text.startsWith('#!/usr/bin/env sh\n')).toBe(true);
      expect(text).toContain('readlink');
      expect(text).toContain('cd -P');
    }
  });

  it('runs the launcher with the macOS binary', () => {
    const text = commandScript('darwin-arm64');
    expect(text).toContain('"$dir/../MacOS/Electron"');
    expect(text).toContain('"$dir/app/apps/standalone/dist/index.js"');
  });

  it('runs the launcher with the Windows binary', () => {
    const text = commandScript('win32-x64');
    expect(text).toContain('"%~dp0OpenLDR.exe" "%~dp0resources\\app\\apps\\standalone\\dist\\index.js" %*');
    expect(text).toContain('set ELECTRON_RUN_AS_NODE=1');
    expect(text.startsWith('@echo off\r\n')).toBe(true);
  });

  // The installed app never runs with its sandbox off (Global Constraints).
  it('never turns the sandbox off', () => {
    for (const s of DESKTOP_SYSTEMS) expect(commandScript(s)).not.toContain('--no-sandbox');
  });
});

describe('icoFromPng and icnsFromPng256', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

  it('wraps a PNG in an .ico with one entry', () => {
    const ico = icoFromPng(png, 256);
    const v = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(ico.length).toBe(22 + png.length);
    expect([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)]).toEqual([0, 1, 1]);
    // 0 means 256 for width and height.
    expect([ico[6], ico[7], ico[8], ico[9]]).toEqual([0, 0, 0, 0]);
    expect(v.getUint16(10, true)).toBe(1);
    expect(v.getUint16(12, true)).toBe(32);
    expect(v.getUint32(14, true)).toBe(png.length);
    expect(v.getUint32(18, true)).toBe(22);
    expect([...ico.slice(22)]).toEqual([...png]);
  });

  it('writes a smaller size as itself', () => {
    const ico = icoFromPng(png, 48);
    expect([ico[6], ico[7]]).toEqual([48, 48]);
  });

  it('wraps a PNG in an .icns with one ic08 entry', () => {
    const icns = icnsFromPng256(png);
    const v = new DataView(icns.buffer, icns.byteOffset, icns.byteLength);
    expect(new TextDecoder().decode(icns.slice(0, 4))).toBe('icns');
    expect(v.getUint32(4, false)).toBe(icns.length);
    expect(icns.length).toBe(16 + png.length);
    expect(new TextDecoder().decode(icns.slice(8, 12))).toBe('ic08');
    expect(v.getUint32(12, false)).toBe(8 + png.length);
    expect([...icns.slice(16)]).toEqual([...png]);
  });
});

describe('packedPackageJson', () => {
  // Electron loads `main`. The launcher reads the version from this file. desktopName is the
  // menu entry's file name, so the window groups with the entry and gets its icon.
  it('is the root package.json of the packed app', () => {
    expect(packedPackageJson('0.1.11')).toEqual({
      name: 'openldr-desktop',
      version: '0.1.11',
      main: 'apps/desktop/dist/main.js',
      desktopName: 'openldr.desktop',
    });
  });
});

describe('LEFT_OUT', () => {
  it('names cpu-features and the two packages only it needs', () => {
    expect([...LEFT_OUT]).toEqual(['cpu-features', 'nan', 'buildcheck']);
  });
});
