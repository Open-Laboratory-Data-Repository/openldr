// Packs the desktop app into one archive per system.
//
//   pnpm pack:desktop <linux-x64|darwin-arm64|win32-x64|all> [--out <folder>]
//
// Archives go to <out>/v<version>/ (default out: dist/desktop), beside a SHA256SUMS file.
// Build Studio, the launcher and the desktop app first. Packing runs on Linux only.
//
// This file gathers files, downloads and runs commands. Every decision it appears to make lives
// in packages/release/src/desktop-pack.ts, where it is unit-tested. This file has no tests: it is
// proven only by a pack and by starting the Linux archive. The macOS and Windows archives are
// not proven, waits for the operator.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  archiveName,
  checkArchiveEntries,
  commandScript,
  DESKTOP_SYSTEMS,
  desktopLayout,
  ELECTRON_VERSION,
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
  POSTGRES_VERSION,
  postgresPackage,
  renamePlist,
  sha256SumsText,
  staysInside,
  type ClosurePackage,
  type DesktopSystem,
  type PackageId,
} from '../packages/release/src/desktop-pack';

const REPO = fileURLToPath(new URL('../', import.meta.url));

/** The launcher's run-time packages, as apps/standalone/tsup.config.ts leaves them external. */
const LAUNCHER_PACKAGES = ['ssh2', 'pdfkit', 'quickjs-emscripten', 'embedded-postgres', 'pg'];

/** Build outputs the archive is made from. */
const BUILT = [
  'apps/studio/dist/index.html',
  'apps/standalone/dist/index.js',
  'apps/standalone/dist/cli.js',
  'apps/standalone/fixtures/fhir',
  'apps/desktop/dist/main.js',
  'apps/desktop/dist/preload.cjs',
];

/** What is copied from this checkout into the app folder, at the same relative path. */
const APP_FILES = [
  'apps/desktop/package.json',
  'apps/desktop/dist',
  'apps/desktop/pages',
  'apps/desktop/assets',
  'apps/standalone/package.json',
  'apps/standalone/dist',
  'apps/standalone/fixtures',
  'apps/studio/dist',
];

function fail(message: string): never {
  throw new Error(message);
}

function run(cmd: string, args: string[], cwd?: string): void {
  execFileSync(cmd, args, { stdio: 'inherit', ...(cwd ? { cwd } : {}) });
}

function output(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

function sha256File(file: string): Promise<string> {
  return new Promise((done, failed) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', failed)
      .on('end', () => done(hash.digest('hex')));
  });
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * The folder of `name` as Node finds it from `fromDir`: the first `<dir>/node_modules/<name>`
 * with a package.json, walking up. Not require.resolve: several packages here have an exports
 * map without ./package.json. Stops after `stopAt` when given.
 */
function findPackageDir(fromDir: string, name: string, stopAt?: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return candidate;
    }
    if (stopAt !== undefined && dir === stopAt) return undefined;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

function skipped(name: string): boolean {
  return LEFT_OUT.includes(name) || name.startsWith('@embedded-postgres/');
}

interface Closure {
  packages: ClosurePackage[];
  roots: PackageId[];
  /** name@version -> its real folder */
  dirs: Map<string, string>;
}

/** The launcher's run-time packages and everything they depend on, as installed. */
function gatherClosure(): Closure {
  const byId = new Map<string, ClosurePackage>();
  const dirs = new Map<string, string>();

  const visit = (realDir: string): PackageId => {
    const pkg = readJson(join(realDir, 'package.json'));
    const id = { name: String(pkg.name), version: String(pkg.version) };
    const key = `${id.name}@${id.version}`;
    if (byId.has(key)) return id;
    const entry: ClosurePackage = { ...id, dependencies: {} };
    byId.set(key, entry);
    dirs.set(key, realDir);
    const required = Object.keys((pkg.dependencies as Record<string, string> | undefined) ?? {});
    const optional = Object.keys((pkg.optionalDependencies as Record<string, string> | undefined) ?? {});
    for (const name of [...new Set([...required, ...optional])].sort()) {
      if (skipped(name)) continue;
      const found = findPackageDir(realDir, name);
      if (found === undefined) {
        if (optional.includes(name)) continue;
        fail(`${key} depends on ${name}, which is not installed.`);
      }
      entry.dependencies[name] = visit(realpathOf(found)).version;
    }
    return id;
  };

  const standalone = realpathOf(join(REPO, 'apps/standalone'));
  const roots = LAUNCHER_PACKAGES.map((name) => {
    const found = findPackageDir(standalone, name) ?? fail(`apps/standalone cannot find ${name}. Run pnpm install.`);
    return visit(realpathOf(found));
  });
  return { packages: [...byId.values()], roots, dirs };
}

function realpathOf(p: string): string {
  return realpathSync(p);
}

/** Copies a package's real folder, keeping links as they are and leaving out any node_modules inside it. */
function copyPackage(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => !relative(from, src).split(sep).includes('node_modules'),
  });
}

/** Downloads Electron for the system through @electron/get and checks it. Returns the zip's path. */
async function fetchElectron(system: DesktopSystem): Promise<string> {
  const electronDir = realpathOf(join(REPO, 'apps/desktop/node_modules/electron'));
  // @electron/get is an ES module that only Electron's own folder can see.
  const getPath = createRequire(join(electronDir, 'package.json')).resolve('@electron/get');
  const { downloadArtifact } = (await import(pathToFileURL(getPath).href)) as {
    downloadArtifact(details: Record<string, unknown>): Promise<string>;
  };
  const checksums = readJson(join(electronDir, 'checksums.json')) as Record<string, string>;
  const { platform, arch } = electronTarget(system);
  const zip = await downloadArtifact({ version: ELECTRON_VERSION, artifactName: 'electron', platform, arch, checksums });
  // @electron/get checks the same value. Checked again here so the pack never depends on that.
  const zipName = `electron-v${ELECTRON_VERSION}-${platform}-${arch}.zip`;
  const expected = checksums[zipName] ?? fail(`Electron's checksums.json has no ${zipName}.`);
  const actual = await sha256File(zip);
  if (actual !== expected) fail(`${zipName} does not match checksums.json. Nothing was unpacked.`);
  console.log(`  Electron ${zipName}: SHA-256 matches checksums.json`);
  return zip;
}

/** Lays Electron into the staging folder, renamed for OpenLDR. */
async function layElectron(system: DesktopSystem, staging: string): Promise<void> {
  const layout = desktopLayout(system);
  const zip = await fetchElectron(system);
  if (system === 'darwin-arm64') {
    // Unpacked where it stays, so the links the macOS zip is full of are never copied.
    run('unzip', ['-q', zip, '-d', staging]);
    renameSync(join(staging, 'Electron.app'), join(staging, layout.root));
    // Electron's licence files sit beside Electron.app in the zip. Only the app goes into the
    // archive, so they move inside it.
    for (const file of ['LICENSE', 'LICENSES.chromium.html']) {
      if (!existsSync(join(staging, file))) fail(`The macOS Electron zip has no ${file}.`);
      renameSync(join(staging, file), join(staging, layout.root, 'Contents', 'Resources', file));
    }
    const plistPath = join(staging, layout.root, 'Contents', 'Info.plist');
    const raw = readFileSync(plistPath);
    if (raw.subarray(0, 8).toString('latin1') === 'bplist00') {
      fail('Electron.app/Contents/Info.plist is a binary plist. The pack cannot edit it. Stop and report.');
    }
    const text = raw.toString('utf8');
    writeFileSync(plistPath, renamePlist(text, 'OpenLDR'));
    const iconName = plistString(text, 'CFBundleIconFile') ?? fail('Info.plist names no CFBundleIconFile.');
    const iconFile = join(staging, layout.root, 'Contents', 'Resources', iconName.endsWith('.icns') ? iconName : `${iconName}.icns`);
    if (!existsSync(iconFile)) fail(`The icon file Info.plist names is not there: ${iconFile}`);
    writeFileSync(iconFile, icnsFromPng256(readFileSync(join(REPO, 'apps/desktop/assets/icon.png'))));
  } else {
    run('unzip', ['-q', zip, '-d', join(staging, layout.root)]);
    const from = system === 'linux-x64' ? 'electron' : 'electron.exe';
    renameSync(join(staging, layout.root, from), join(staging, layout.binary));
  }
  rmSync(join(staging, dirname(layout.appDir), 'default_app.asar'), { force: true });
}

/** The Postgres package for the system: the installed one for Linux, a checked download otherwise. */
async function layPostgres(system: DesktopSystem, nodeModules: string, closure: Closure): Promise<void> {
  const name = postgresPackage(system);
  const dest = join(nodeModules, name);
  if (system === 'linux-x64') {
    const embedded = closure.dirs.get(`embedded-postgres@${POSTGRES_VERSION}`) ?? fail(`embedded-postgres@${POSTGRES_VERSION} is not installed.`);
    const found = findPackageDir(embedded, name) ?? fail(`${name} is not installed beside embedded-postgres.`);
    copyPackage(realpathOf(found), dest);
  } else {
    const url = npmTarballUrl(name, POSTGRES_VERSION);
    const integrity = lockfileIntegrity(readFileSync(join(REPO, 'pnpm-lock.yaml'), 'utf8'), name, POSTGRES_VERSION);
    const res = await fetch(url);
    if (!res.ok) fail(`${url} answered ${res.status}.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!matchesIntegrity(bytes, integrity)) fail(`${url} does not match the integrity in pnpm-lock.yaml. Nothing was unpacked.`);
    console.log(`  ${name}: ${bytes.length} bytes, matches the integrity in pnpm-lock.yaml`);
    const work = mkdtempSync(join(tmpdir(), 'openldr-pack-pg-'));
    try {
      const tgz = join(work, 'package.tgz');
      writeFileSync(tgz, bytes);
      const unpacked = join(work, 'unpacked');
      mkdirSync(unpacked);
      run('tar', ['-xzf', tgz, '-C', unpacked]);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(join(unpacked, 'package'), dest);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const version = String(readJson(join(dest, 'package.json')).version);
  if (version !== POSTGRES_VERSION) fail(`${name} is ${version}, not ${POSTGRES_VERSION}.`);

  // Turn the link targets back into links, as the package's own install does. Installed by pnpm,
  // the Linux package holds them as plain copies, which would put libicudata in the archive three times.
  const listFile = join(dest, 'native', 'pg-symlinks.json');
  const links = existsSync(listFile) ? (JSON.parse(readFileSync(listFile, 'utf8')) as { source: string; target: string }[]) : [];
  // Every target is checked before any is removed: one that leaves the package is refused.
  for (const { target } of links) {
    if (!staysInside(target)) fail(`${name}: pg-symlinks.json names ${target}, which is not inside the package.`);
  }
  for (const { target } of links) {
    const p = join(dest, target);
    if (existsSync(p) && lstatSync(p).isFile()) rmSync(p);
  }
  if (existsSync(join(dest, 'scripts', 'hydrate-symlinks.js'))) {
    run(process.execPath, ['scripts/hydrate-symlinks.js'], dest);
  }
  for (const { target } of links) {
    const p = join(dest, target);
    if (!lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`${name}: ${target} is not a link after hydrate-symlinks.js.`);
    if (isAbsolute(readlinkSync(p)) || !existsSync(p)) fail(`${name}: ${target} does not point inside the package.`);
  }
  console.log(`  ${name}: ${links.length} links from pg-symlinks.json`);
}

/** Every placed package's recorded dependencies resolve, from its copy, to the version recorded. */
function checkPlacement(appDir: string, nodeModules: string, closure: Closure, placed: { name: string; version: string; path: string }[], system: DesktopSystem): void {
  const byId = new Map(closure.packages.map((p) => [`${p.name}@${p.version}`, p]));
  const versionAt = (dir: string) => String(readJson(join(dir, 'package.json')).version);
  const problems: string[] = [];
  for (const p of placed) {
    const copy = join(nodeModules, p.path);
    for (const [d, v] of Object.entries(byId.get(`${p.name}@${p.version}`)?.dependencies ?? {})) {
      const found = findPackageDir(copy, d, appDir);
      const got = found === undefined ? 'nothing' : versionAt(found);
      if (got !== v) problems.push(`${p.path} needs ${d}@${v} and finds ${got}`);
    }
  }
  const standalone = join(appDir, 'apps', 'standalone');
  for (const r of closure.roots) {
    const found = findPackageDir(standalone, r.name, appDir);
    const got = found === undefined ? 'nothing' : versionAt(found);
    if (got !== r.version) problems.push(`apps/standalone needs ${r.name}@${r.version} and finds ${got}`);
  }
  const embedded = findPackageDir(standalone, 'embedded-postgres', appDir);
  if (embedded === undefined || findPackageDir(embedded, postgresPackage(system), appDir) === undefined) {
    problems.push(`embedded-postgres cannot find ${postgresPackage(system)}`);
  }
  if (problems.length > 0) fail(`The packages are not placed as Node needs them:\n  ${problems.join('\n  ')}`);
  console.log(`  ${placed.length} packages placed; every recorded dependency resolves to its version`);
}

async function packOne(system: DesktopSystem, version: string, outDir: string, closure: Closure): Promise<void> {
  console.log(`\n${system}`);
  const layout = desktopLayout(system);
  const staging = mkdtempSync(join(tmpdir(), 'openldr-pack-'));
  try {
    await layElectron(system, staging);

    const appDir = join(staging, layout.appDir);
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'package.json'), `${JSON.stringify(packedPackageJson(version), null, 2)}\n`);
    for (const rel of APP_FILES) {
      mkdirSync(dirname(join(appDir, rel)), { recursive: true });
      cpSync(join(REPO, rel), join(appDir, rel), { recursive: true, verbatimSymlinks: true });
    }
    writeFileSync(join(appDir, 'apps/desktop/assets/icon.ico'), icoFromPng(readFileSync(join(REPO, 'apps/desktop/assets/icon.png')), 256));

    const nodeModules = join(appDir, 'apps', 'standalone', 'node_modules');
    const placed = placePackages(closure.packages, closure.roots);
    for (const p of placed) {
      const from = closure.dirs.get(`${p.name}@${p.version}`) ?? fail(`No folder for ${p.name}@${p.version}.`);
      copyPackage(from, join(nodeModules, p.path));
    }
    await layPostgres(system, nodeModules, closure);
    checkPlacement(appDir, nodeModules, closure, placed, system);

    const command = join(staging, layout.command);
    writeFileSync(command, commandScript(system), { mode: 0o755 });
    chmodSync(command, 0o755);

    const final = join(outDir, archiveName(version, system));
    const partial = join(outDir, `.${archiveName(version, system)}.partial`);
    rmSync(partial, { force: true });
    if (system === 'win32-x64') {
      // zip stores a link as the file it points to.
      run('zip', ['-r', '-q', partial, layout.root], staging);
    } else {
      run('tar', ['--owner=0', '--group=0', '--numeric-owner', '--sort=name', '-czf', partial, '-C', staging, layout.root]);
    }

    const entries = (system === 'win32-x64' ? output('unzip', ['-Z1', partial]) : output('tar', ['-tzf', partial])).split('\n').filter((l) => l !== '');
    const problems = checkArchiveEntries(system, entries);
    if (system !== 'win32-x64') {
      for (const line of output('tar', ['-tvzf', partial]).split('\n')) {
        if (line.startsWith('l') && /\s->\s\//.test(line)) problems.push(`A link to an absolute path: ${line}`);
      }
    }
    if (problems.length > 0) {
      rmSync(partial, { force: true });
      fail(`The ${system} archive failed its check:\n  ${problems.join('\n  ')}`);
    }
    rmSync(final, { force: true });
    renameSync(partial, final);
    const size = statSync(final).size;
    console.log(`  ${final}`);
    console.log(`  ${entries.length} entries, ${size} bytes (${(size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  SHA-256 ${await sha256File(final)}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function writeSums(version: string, outDir: string): Promise<void> {
  const files: { name: string; sha256: string }[] = [];
  for (const s of DESKTOP_SYSTEMS) {
    const name = archiveName(version, s);
    if (existsSync(join(outDir, name))) files.push({ name, sha256: await sha256File(join(outDir, name)) });
  }
  writeFileSync(join(outDir, 'SHA256SUMS'), sha256SumsText(files));
  console.log(`\n${join(outDir, 'SHA256SUMS')}: ${files.length} archives`);
}

function usage(message: string): never {
  console.error(`${message}\nUsage: pnpm pack:desktop <${DESKTOP_SYSTEMS.join('|')}|all> [--out <folder>]`);
  process.exit(2);
}

async function main(): Promise<void> {
  if (process.platform !== 'linux') {
    console.error(
      'The desktop packages are built on Linux only. The pack needs symbolic links, file modes and GNU tar options that this system does not give it.',
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let out = join(REPO, 'dist', 'desktop');
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--out') {
      const v = args[++i];
      if (v === undefined) usage('--out needs a folder.');
      out = resolve(v);
    } else if (a.startsWith('--')) {
      usage(`Unknown option ${a}.`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) usage('Name one system, or all.');
  let systems: DesktopSystem[];
  try {
    systems = positional[0] === 'all' ? [...DESKTOP_SYSTEMS] : [parseDesktopSystem(positional[0]!)];
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }

  const missing = BUILT.filter((rel) => !existsSync(join(REPO, rel)));
  if (missing.length > 0) {
    console.error(`Build these first (pnpm --filter @openldr/studio build, @openldr/standalone, @openldr/desktop):\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  const version = String(readJson(join(REPO, 'package.json')).version);
  const outDir = join(out, `v${version}`);
  mkdirSync(outDir, { recursive: true });

  const closure = gatherClosure();
  console.log(`The launcher's run-time packages: ${closure.packages.length}, from ${closure.roots.map((r) => `${r.name}@${r.version}`).join(', ')}`);

  for (const system of systems) await packOne(system, version, outDir, closure);
  await writeSums(version, outDir);
}

main().catch((err: unknown) => {
  console.error(`\npack:desktop failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
