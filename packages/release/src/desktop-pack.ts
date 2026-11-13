// The decisions behind `pnpm pack:desktop`: the names, the layout of each archive, what must and
// must not be inside one, and the small files the pack writes. scripts/pack-desktop.ts only
// downloads, copies and runs commands. Everything here is pure and tested.
//
// Only Linux is proven by a run. Everything about the macOS and Windows archives is
// not proven, waits for the operator.

import { createHash } from 'node:crypto';

export type DesktopSystem = 'linux-x64' | 'darwin-arm64' | 'win32-x64';

export const DESKTOP_SYSTEMS: readonly DesktopSystem[] = ['linux-x64', 'darwin-arm64', 'win32-x64'];

export const ELECTRON_VERSION = '45.3.0';
export const POSTGRES_VERSION = '16.15.0-beta.19';

/** cpu-features is a native addon that cannot be built for another system; nan and buildcheck only serve it. */
export const LEFT_OUT: readonly string[] = ['cpu-features', 'nan', 'buildcheck'];

export function parseDesktopSystem(text: string): DesktopSystem {
  const found = DESKTOP_SYSTEMS.find((s) => s === text);
  if (found === undefined) {
    throw new Error(`There is no desktop package for "${text}". Use one of: ${DESKTOP_SYSTEMS.join(', ')}.`);
  }
  return found;
}

export function archiveName(version: string, system: DesktopSystem): string {
  return `openldr-desktop-${version}-${system}.${system === 'win32-x64' ? 'zip' : 'tar.gz'}`;
}

export function postgresPackage(system: DesktopSystem): string {
  return system === 'win32-x64' ? '@embedded-postgres/windows-x64' : `@embedded-postgres/${system}`;
}

/** The platform and arch @electron/get takes for a system. */
export function electronTarget(system: DesktopSystem): { platform: 'linux' | 'darwin' | 'win32'; arch: 'x64' | 'arm64' } {
  if (system === 'linux-x64') return { platform: 'linux', arch: 'x64' };
  if (system === 'darwin-arm64') return { platform: 'darwin', arch: 'arm64' };
  return { platform: 'win32', arch: 'x64' };
}

export interface DesktopLayout {
  /** The one top-level folder inside the archive. */
  root: string;
  /** The app folder Electron loads, inside root. */
  appDir: string;
  /** The app's binary, inside root. */
  binary: string;
  /** The openldr-standalone command, inside root. */
  command: string;
}

export function desktopLayout(system: DesktopSystem): DesktopLayout {
  if (system === 'linux-x64') {
    return {
      root: 'openldr-desktop',
      appDir: 'openldr-desktop/resources/app',
      binary: 'openldr-desktop/openldr-desktop',
      command: 'openldr-desktop/openldr-standalone',
    };
  }
  if (system === 'win32-x64') {
    return {
      root: 'OpenLDR',
      appDir: 'OpenLDR/resources/app',
      binary: 'OpenLDR/OpenLDR.exe',
      command: 'OpenLDR/openldr-standalone.cmd',
    };
  }
  // macOS keeps Electron's binary name: the helper apps are found by it, and nobody here can try
  // a rename. Not proven, waits for the operator.
  return {
    root: 'OpenLDR.app',
    appDir: 'OpenLDR.app/Contents/Resources/app',
    binary: 'OpenLDR.app/Contents/MacOS/Electron',
    command: 'OpenLDR.app/Contents/Resources/openldr-standalone',
  };
}

/** Problems found in an archive's list of entries. Empty means it passed. */
export function checkArchiveEntries(system: DesktopSystem, entries: readonly string[]): string[] {
  const l = desktopLayout(system);
  const a = l.appDir;
  const exe = system === 'win32-x64' ? '.exe' : '';
  const ours = postgresPackage(system);
  const pgBin = `${a}/apps/standalone/node_modules/${ours}/native/bin`;
  // tar and unzip list a folder with a trailing slash.
  const names = entries.map((e) => e.replace(/\/+$/, ''));
  const present = new Set(names);
  const problems: string[] = [];

  const required = [
    l.binary,
    l.command,
    `${a}/package.json`,
    `${a}/apps/desktop/dist/main.js`,
    `${a}/apps/desktop/dist/preload.cjs`,
    `${a}/apps/desktop/pages/page.html`,
    `${a}/apps/standalone/package.json`,
    `${a}/apps/standalone/dist/index.js`,
    `${a}/apps/standalone/dist/cli.js`,
    `${a}/apps/studio/dist/index.html`,
    `${a}/apps/standalone/node_modules/embedded-postgres/package.json`,
    `${pgBin}/postgres${exe}`,
    `${pgBin}/pg_ctl${exe}`,
    `${pgBin}/initdb${exe}`,
  ];
  if (system === 'linux-x64') required.push(`${l.root}/chrome-sandbox`);
  for (const r of required) {
    if (!present.has(r)) problems.push(`Missing: ${r}`);
  }
  const fixtures = `${a}/apps/standalone/fixtures/fhir/`;
  if (!names.some((n) => n.startsWith(fixtures))) problems.push(`Missing: nothing under ${fixtures}`);

  for (const n of names) {
    const parts = n.split('/');
    if (parts[0] !== l.root || parts.includes('..') || parts.includes('.') || n.startsWith('/')) {
      problems.push(`Outside ${l.root}: ${n}`);
    }
    for (let i = 1; i < parts.length; i++) {
      if (parts[i - 1] === 'node_modules' && LEFT_OUT.includes(parts[i] ?? '')) {
        problems.push(`A left-out package: ${n}`);
        break;
      }
    }
    if (n.endsWith('.node')) problems.push(`A compiled addon: ${n}`);
    for (let i = 2; i < parts.length; i++) {
      if (parts[i - 2] === 'node_modules' && parts[i - 1] === '@embedded-postgres' && `@embedded-postgres/${parts[i]}` !== ours) {
        problems.push(`Postgres for another system: ${n}`);
        break;
      }
    }
  }
  return problems;
}

/** One "<sha256>  <name>" line per file, sorted by name, each ending in a newline. */
export function sha256SumsText(files: readonly { name: string; sha256: string }[]): string {
  for (const f of files) {
    if (f.name === '' || /[\s/\\]/.test(f.name)) throw new Error(`A file in SHA256SUMS cannot have this name: "${f.name}".`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`Not a SHA-256 value for ${f.name}: "${f.sha256}".`);
  }
  return [...files]
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
    .map((f) => `${f.sha256}  ${f.name}\n`)
    .join('');
}

export interface PackageId {
  name: string;
  version: string;
}
/** dependencies: dependency name -> resolved version. */
export interface ClosurePackage extends PackageId {
  dependencies: Record<string, string>;
}
/** path is relative to the node_modules folder. */
export interface PlacedPackage extends PackageId {
  path: string;
}

/** Orders two versions as semver does for x.y.z with an optional pre-release. */
function compareVersions(x: string, y: string): number {
  const split = (v: string) => {
    const [core = '', pre] = v.split('+')[0]!.split(/-(.*)/s);
    return { nums: core.split('.').map((p) => Number(p)), pre };
  };
  const a = split(x);
  const b = split(y);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (a.pre === undefined || b.pre === undefined) return a.pre === b.pre ? 0 : a.pre === undefined ? 1 : -1;
  const ap = a.pre.split('.');
  const bp = b.pre.split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const p = ap[i];
    const q = bp[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Places each package of a closure at the top level or nested under a dependent, so Node resolves every dependency to the version it needs. */
export function placePackages(closure: readonly ClosurePackage[], roots: readonly PackageId[]): PlacedPackage[] {
  const key = (name: string, version: string) => `${name}@${version}`;
  const byId = new Map<string, ClosurePackage>();
  for (const p of closure) byId.set(key(p.name, p.version), p);
  const need = (name: string, version: string): ClosurePackage => {
    const p = byId.get(key(name, version));
    if (p === undefined) throw new Error(`The closure has no ${key(name, version)}, though a package depends on it.`);
    return p;
  };

  // How many packages in the closure depend on each name@version.
  const dependents = new Map<string, number>();
  for (const p of closure) {
    for (const [d, v] of Object.entries(p.dependencies)) {
      need(d, v);
      dependents.set(key(d, v), (dependents.get(key(d, v)) ?? 0) + 1);
    }
  }

  // The top-level version of each name.
  const versions = new Map<string, string[]>();
  for (const p of byId.values()) versions.set(p.name, [...(versions.get(p.name) ?? []), p.version]);
  const top = new Map<string, string>();
  for (const [name, vs] of versions) {
    const root = roots.find((r) => r.name === name && vs.includes(r.version));
    if (root !== undefined) {
      top.set(name, root.version);
      continue;
    }
    const best = [...vs].sort((x, y) => {
      const d = (dependents.get(key(name, y)) ?? 0) - (dependents.get(key(name, x)) ?? 0);
      return d !== 0 ? d : compareVersions(y, x);
    })[0]!;
    top.set(name, best);
  }

  // path -> version. Every name has its top-level copy; nested copies are added as Node needs them.
  const placed = new Map<string, PlacedPackage>();
  const queue: PlacedPackage[] = [];
  for (const [name, version] of [...top].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    const p = { name, version, path: name };
    placed.set(p.path, p);
    queue.push(p);
  }
  while (queue.length > 0) {
    const p = queue.shift()!;
    const segments = p.path.split('/node_modules/');
    const deps = Object.entries(need(p.name, p.version).dependencies).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    for (const [d, v] of deps) {
      // Walk up from the package as Node does: its own node_modules, then each ancestor's, then the top.
      let found: PlacedPackage | undefined;
      for (let i = segments.length; i >= 0 && found === undefined; i--) {
        found = placed.get([...segments.slice(0, i), d].join('/node_modules/'));
      }
      if (found !== undefined && found.version === v) continue;
      const nested = { name: d, version: v, path: `${p.path}/node_modules/${d}` };
      placed.set(nested.path, nested);
      queue.push(nested);
    }
  }
  return [...placed.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/** The registry URL of a package's tarball, scoped names included. */
export function npmTarballUrl(name: string, version: string): string {
  const base = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
  return `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`;
}

/** The `integrity` value recorded for `<name>@<version>` in the text of pnpm-lock.yaml. Throws when there is none. */
export function lockfileIntegrity(lockfileText: string, name: string, version: string): string {
  const id = `${name}@${version}`;
  const keys = new Set([`  '${id}':`, `  ${id}:`, `  "${id}":`]);
  const lines = lockfileText.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!keys.has(lines[i]!)) continue;
    const m = /^\s+resolution: \{.*\bintegrity: (sha512-[A-Za-z0-9+/]+={0,2})/.exec(lines[i + 1]!);
    if (m) return m[1]!;
  }
  throw new Error(`pnpm-lock.yaml records no integrity for ${id}.`);
}

/** True when the bytes match an `sha512-<base64>` integrity value. */
export function matchesIntegrity(bytes: Uint8Array, integrity: string): boolean {
  if (!integrity.startsWith('sha512-')) return false;
  return createHash('sha512').update(bytes).digest('base64') === integrity.slice('sha512-'.length);
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The string value of a key in an XML plist, or undefined when the key is not there. */
export function plistString(plistXml: string, key: string): string | undefined {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plistXml);
  return m?.[1];
}

/** Info.plist with the two shown names set. Throws when the text is not an XML plist. */
export function renamePlist(plistXml: string, shownName: string): string {
  if (!plistXml.startsWith('<?xml') || !plistXml.includes('<plist')) {
    throw new Error('Info.plist is not an XML plist. A binary plist cannot be edited here.');
  }
  const value = escapeXml(shownName);
  const set = (text: string, key: string) =>
    text.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`);
  let out = set(plistXml, 'CFBundleName');
  if (plistString(out, 'CFBundleName') === undefined) throw new Error('Info.plist has no CFBundleName.');
  if (plistString(out, 'CFBundleDisplayName') === undefined) {
    // Added right after CFBundleName, with the same indent.
    out = out.replace(
      /([ \t]*)(<key>CFBundleName<\/key>)(\s*<string>[^<]*<\/string>)/,
      `$1$2$3\n$1<key>CFBundleDisplayName</key>\n$1<string>${value}</string>`,
    );
  } else {
    out = set(out, 'CFBundleDisplayName');
  }
  return out;
}

/**
 * Finds the command's own real folder: $0 is followed while it is a link, one step at a time,
 * because the install links it into ~/.local/bin and macOS has no `readlink -f`. Copied from
 * install/install.sh.
 */
const FIND_OWN_FOLDER = [
  'self=$0',
  'i=0',
  'while [ -h "$self" ] && [ "$i" -lt 40 ]; do',
  '  target=$(readlink -- "$self" 2>/dev/null) || break',
  '  case $target in',
  '    /*) self=$target ;;',
  '    *) self=$(dirname -- "$self")/$target ;;',
  '  esac',
  '  i=$((i + 1))',
  'done',
  // -P: a `..` in a relative link is taken on disk, not by text.
  "dir=$(CDPATH='' cd -P -- \"$(dirname -- \"$self\")\" && pwd -P)",
];

/** The text of the openldr-standalone command for a system. */
export function commandScript(system: DesktopSystem): string {
  if (system === 'win32-x64') {
    // Not proven, waits for the operator.
    return [
      '@echo off',
      'setlocal',
      'set ELECTRON_RUN_AS_NODE=1',
      '"%~dp0OpenLDR.exe" "%~dp0resources\\app\\apps\\standalone\\dist\\index.js" %*',
      '',
    ].join('\r\n');
  }
  const run =
    system === 'linux-x64'
      ? 'ELECTRON_RUN_AS_NODE=1 exec "$dir/openldr-desktop" "$dir/resources/app/apps/standalone/dist/index.js" "$@"'
      : // Not proven, waits for the operator.
        'ELECTRON_RUN_AS_NODE=1 exec "$dir/../MacOS/Electron" "$dir/app/apps/standalone/dist/index.js" "$@"';
  return [
    '#!/usr/bin/env sh',
    "# The OpenLDR launcher, run by this app's own Electron acting as Node.",
    'set -eu',
    ...FIND_OWN_FOLDER,
    run,
    '',
  ].join('\n');
}

/** A .ico file that holds one PNG. */
export function icoFromPng(png: Uint8Array, size: number): Uint8Array {
  if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`An .ico entry is 1 to 256 px, not ${size}.`);
  const out = new Uint8Array(22 + png.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, 1, true); // one image
  out[6] = size === 256 ? 0 : size; // width, 0 means 256
  out[7] = size === 256 ? 0 : size; // height
  out[8] = 0; // colours
  out[9] = 0; // reserved
  v.setUint16(10, 1, true); // planes
  v.setUint16(12, 32, true); // bits per pixel
  v.setUint32(14, png.length, true);
  v.setUint32(18, 22, true); // offset of the PNG
  out.set(png, 22);
  return out;
}

/** A .icns file that holds one 256 px PNG. */
export function icnsFromPng256(png: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + png.length);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode('icns'), 0);
  v.setUint32(4, out.length, false);
  out.set(new TextEncoder().encode('ic08'), 8);
  v.setUint32(12, 8 + png.length, false);
  out.set(png, 16);
  return out;
}

/** The root package.json of the packed app. */
export function packedPackageJson(version: string): { name: string; version: string; main: string; desktopName: string } {
  return { name: 'openldr-desktop', version, main: 'apps/desktop/dist/main.js', desktopName: 'openldr.desktop' };
}
