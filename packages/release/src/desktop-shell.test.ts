// Tests for install/desktop.sh, the one-line installer for the desktop app on Linux and macOS.
//
// Every run uses a clean environment: PATH with the fakes first, a temp HOME, a temp TMPDIR, the
// five OPENLDR_DESKTOP_* overrides, and no XDG_* variable unless a test sets one to a temp folder.
// Passing the real environment through would point --uninstall at the operator's real folders.
// The fakes on PATH (sudo, apparmor_parser, uname, df, ps, codesign, update-desktop-database) mean
// no test calls the real sudo or touches /etc/apparmor.d. The fake sudo also refuses any absolute
// path outside the test's own temp folder. The script looks for apparmor_parser in /usr/sbin and
// /sbin before PATH, so every run names the fake through OPENLDR_DESKTOP_APPARMOR_PARSER. The fake
// curl records each call, then runs the real one on the test's file: URLs.
//
// Only Linux is proven here. The macOS test runs the script's macOS branch against a fake uname
// and a fake codesign on Linux: not proven, waits for the operator.
//
// The last describe reads install/desktop.ps1, the Windows installer, as text. Nothing here runs
// PowerShell.

import { describe, it, expect, afterAll } from 'vitest';
import { resolveGitBash } from './git-bash';
import { archiveName as packArchiveName } from './desktop-pack';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, existsSync, readdirSync,
  realpathSync, readlinkSync, renameSync, copyFileSync, statSync, symlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = resolve(__dirname, '../../..');
const SCRIPT = join(REPO, 'install/desktop.sh');
const BASH = resolveGitBash();

/** Every temp folder made here, removed in afterAll, as shell.test.ts does. */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const onPath = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
const HAS_VALIDATE = platform() !== 'win32' && onPath('desktop-file-validate').status === 0;
const UID = platform() === 'win32' ? 0 : process.getuid!();

type Sys = 'linux-x64' | 'darwin-arm64';
const archiveName = (version: string, sys: Sys) => `openldr-desktop-${version}-${sys}.tar.gz`;

// ---- Fake archives, built once and copied into each test's release folder -----------------------

const archives = new Map<string, string>();

function writeExe(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/** The stub launcher: `status` exits with the code in ctl/status (3, not running, by default). */
const standaloneStub = (version: string) => [
  '#!/bin/sh',
  'if [ "${1:-}" = status ]; then exit "$(cat "$FAKE_ROOT/ctl/status" 2>/dev/null || echo 3)"; fi',
  `echo "openldr-standalone ${version}"`,
  '',
].join('\n');

/** A small archive with the layout Task 1 packs, built once per version and system. */
function archive(version: string, sys: Sys): string {
  const key = `${version}/${sys}`;
  const known = archives.get(key);
  if (known) return known;
  const work = tempDir('openldr-desktop-archive-');
  const stage = join(work, 'stage');
  if (sys === 'linux-x64') {
    const top = join(stage, 'openldr-desktop');
    writeExe(join(top, 'openldr-desktop'), `#!/bin/sh\necho "openldr-desktop ${version}"\n`);
    writeExe(join(top, 'openldr-standalone'), standaloneStub(version));
    writeExe(join(top, 'chrome-sandbox'), '#!/bin/sh\nexit 0\n');
    mkdirSync(join(top, 'resources/app/apps/desktop/assets'), { recursive: true });
    writeFileSync(join(top, 'resources/app/apps/desktop/assets/icon.png'), 'png');
  } else {
    const top = join(stage, 'OpenLDR.app/Contents');
    writeExe(join(top, 'MacOS/Electron'), `#!/bin/sh\necho "openldr-desktop ${version}"\n`);
    writeExe(join(top, 'Resources/openldr-standalone'), standaloneStub(version));
    writeFileSync(join(top, 'Info.plist'), '<plist/>\n');
    const pg = join(top, 'Resources/app/apps/standalone/node_modules/@embedded-postgres/darwin-arm64/native');
    writeExe(join(pg, 'bin/postgres'), '#!/bin/sh\nexit 0\n');
    mkdirSync(join(pg, 'lib/postgresql/extension'), { recursive: true });
    writeFileSync(join(pg, 'lib/libpq.5.dylib'), 'lib');
    // The real archive holds about 90 entries under native/lib/postgresql/, some a level deeper.
    writeFileSync(join(pg, 'lib/postgresql/plpgsql.dylib'), 'lib');
    writeFileSync(join(pg, 'lib/postgresql/extension/plpgsql.control'), 'control');
  }
  const out = join(work, archiveName(version, sys));
  execFileSync('tar', ['-czf', out, '-C', stage, sys === 'linux-x64' ? 'openldr-desktop' : 'OpenLDR.app']);
  archives.set(key, out);
  return out;
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ---- The fake host --------------------------------------------------------------------------------

/** Records one call: a numbered folder under rec/ with one file per argument. */
const RECORD = (tool: string) => [
  'n=$(ls "$FAKE_ROOT/rec" | wc -l | tr -d " ")',
  `d="$FAKE_ROOT/rec/$n-${tool}"`,
  'mkdir "$d"',
  'i=0',
  'for a in "$@"; do printf %s "$a" > "$d/arg.$i"; i=$((i + 1)); done',
];

/** The real tar and curl, found before the fakes go first on PATH. */
const REAL_TAR = platform() === 'win32' ? '' : onPath('tar').stdout.trim();
const REAL_CURL = platform() === 'win32' ? '' : onPath('curl').stdout.trim();

const FAKES: Record<string, string[]> = {
  // Records each call, then runs the real tar, so a test can tell whether anything was unpacked.
  tar: ['#!/bin/sh', ...RECORD('tar'), `exec "${REAL_TAR}" "$@"`],
  // Records each call, so a test can tell whether the archive was fetched. With ctl/curl-offline it
  // fails as a dead network would, so an https URL in a test never reaches the network.
  curl: [
    '#!/bin/sh',
    ...RECORD('curl'),
    'if [ -e "$FAKE_ROOT/ctl/curl-offline" ]; then echo "fake curl: offline" >&2; exit 6; fi',
    `exec "${REAL_CURL}" "$@"`,
  ],
  // Records, then refuses anything outside the test's folder, then runs the command as this user.
  sudo: [
    '#!/bin/sh',
    ...RECORD('sudo'),
    'if [ -e "$FAKE_ROOT/ctl/sudo-fails" ]; then echo "fake sudo: refused" >&2; exit 1; fi',
    'for a in "$@"; do',
    '  case $a in /*) case $a in "$FAKE_ROOT"/*) ;; *) echo "fake sudo: refusing $a" >&2; exit 97 ;; esac ;; esac',
    'done',
    'case $1 in "$FAKE_ROOT"/*|install|rm) ;; *) echo "fake sudo: refusing $1" >&2; exit 97 ;; esac',
    'exec "$@"',
  ],
  apparmor_parser: [
    '#!/bin/sh',
    'if [ -e "$FAKE_ROOT/ctl/parser-fails" ]; then echo "fake apparmor_parser: failed" >&2; exit 1; fi',
    'exit 0',
  ],
  uname: [
    '#!/bin/sh',
    'case ${1:-} in',
    '  -s) cat "$FAKE_ROOT/ctl/uname-s" 2>/dev/null || echo Linux ;;',
    '  -m) cat "$FAKE_ROOT/ctl/uname-m" 2>/dev/null || echo x86_64 ;;',
    '  *) echo Linux ;;',
    'esac',
  ],
  df: [
    '#!/bin/sh',
    'avail=$(cat "$FAKE_ROOT/ctl/df-avail" 2>/dev/null || echo 52428800)',
    'echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
    'echo "/dev/fake 104857600 1 $avail 1% /"',
  ],
  ps: ['#!/bin/sh', 'echo "/sbin/init splash"', 'cat "$FAKE_ROOT/ctl/ps" 2>/dev/null', 'exit 0'],
  codesign: ['#!/bin/sh', ...RECORD('codesign'), 'exit 0'],
  'update-desktop-database': ['#!/bin/sh', ...RECORD('update-desktop-database'), 'exit 0'],
};

interface Call { tool: string; args: string[] }
interface RunOpts {
  shell?: string[];
  /** Put ~/.local/bin on PATH. */
  localBinOnPath?: boolean;
  env?: Record<string, string>;
  /** Run the script's text from standard input, as `curl ... | bash -s -- <args>` does. */
  fromStdin?: boolean;
}
interface Result { code: number; out: string; stdout: string; stderr: string; calls: Call[] }

interface Host {
  root: string;
  home: string;
  realHome: string;
  aaDir: string;
  base: string;
  target: string;
  bin: string;
  cmd: string;
  menu: string;
  data: string;
  ctl(name: string, value: string | null): void;
  publish(version: string, sys?: Sys, sums?: 'good' | 'wrong' | 'missing'): void;
  releases(list: { tag: string; assets: string[] }[], pretty?: boolean): void;
  calls(): Call[];
  run(args: string[], opts?: RunOpts): Result;
}

function host(homeName = 'home'): Host {
  const root = tempDir('openldr-desktop-host-');
  const dirs = {
    bin: join(root, 'bin'), rec: join(root, 'rec'), ctl: join(root, 'ctl'), tmp: join(root, 'tmp'),
    aa: join(root, 'aa'), base: join(root, 'base'), home: join(root, homeName),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  for (const [name, lines] of Object.entries(FAKES)) writeExe(join(dirs.bin, name), `${lines.join('\n')}\n`);
  writeFileSync(join(root, 'userns'), '0\n');
  const target = join(dirs.home, '.local/share/openldr-desktop');
  const calls = (): Call[] =>
    readdirSync(dirs.rec)
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((c) => {
        const d = join(dirs.rec, c);
        const args: string[] = [];
        for (const f of readdirSync(d)) args[Number(f.slice(4))] = readFileSync(join(d, f), 'utf8');
        return { tool: c.replace(/^\d+-/, ''), args };
      });
  return {
    root,
    home: dirs.home,
    realHome: realpathSync(dirs.home),
    aaDir: dirs.aa,
    base: dirs.base,
    target,
    bin: join(target, 'openldr-desktop'),
    cmd: join(target, 'openldr-standalone'),
    menu: join(dirs.home, '.local/share/applications/openldr.desktop'),
    data: join(dirs.home, '.local/share/openldr'),
    ctl(name, value) {
      const f = join(dirs.ctl, name);
      if (value === null) rmSync(f, { force: true });
      else writeFileSync(f, value);
    },
    publish(version, sys = 'linux-x64', sums = 'good') {
      const folder = join(dirs.base, `v${version}`);
      mkdirSync(folder, { recursive: true });
      const name = archiveName(version, sys);
      copyFileSync(archive(version, sys), join(folder, name));
      const other = `${'0'.repeat(64)}  openldr-desktop-${version}-win32-x64.zip\n`;
      const line = sums === 'good' ? `${sha256(join(folder, name))}  ${name}\n`
        : sums === 'wrong' ? `${'a'.repeat(64)}  ${name}\n` : '';
      writeFileSync(join(folder, 'SHA256SUMS'), other + line);
    },
    releases(list, pretty = false) {
      // The shape of GET /repos/{owner}/{repo}/releases, newest first, cut to the fields that matter
      // and a few that must not confuse the script: the release's own "name", an uploader object,
      // and a body whose text quotes an archive name.
      const json = list.map((r, i) => ({
        url: `https://api.github.com/repos/o/r/releases/${100 - i}`,
        tag_name: r.tag,
        name: r.tag,
        draft: false,
        prerelease: r.tag.includes('-'),
        body: 'Fixes, "name": "openldr-desktop-9.9.9-linux-x64.tar.gz", {"name":"openldr-desktop-9.9.9-darwin-arm64.tar.gz"}',
        assets: r.assets.map((a, j) => ({
          url: `https://api.github.com/repos/o/r/releases/assets/${j}`,
          id: j,
          name: a,
          label: '',
          uploader: { login: 'someone', id: 1 },
          size: 10,
          browser_download_url: `https://github.com/o/r/releases/download/${r.tag}/${a}`,
        })),
      }));
      writeFileSync(join(root, 'releases.json'), pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json));
    },
    calls,
    run(args, opts = {}) {
      rmSync(dirs.rec, { recursive: true, force: true });
      mkdirSync(dirs.rec);
      const localBin = join(dirs.home, '.local/bin');
      const env: Record<string, string> = {
        PATH: `${dirs.bin}:${opts.localBinOnPath ? `${localBin}:` : ''}${process.env.PATH ?? ''}`,
        HOME: dirs.home,
        TMPDIR: dirs.tmp,
        FAKE_ROOT: root,
        OPENLDR_DESKTOP_RELEASES_URL: pathToFileURL(join(root, 'releases.json')).href,
        OPENLDR_DESKTOP_DOWNLOAD_BASE: pathToFileURL(dirs.base).href,
        OPENLDR_DESKTOP_USERNS_FILE: join(root, 'userns'),
        OPENLDR_DESKTOP_APPARMOR_DIR: dirs.aa,
        OPENLDR_DESKTOP_APPARMOR_PARSER: join(dirs.bin, 'apparmor_parser'),
        ...opts.env,
      };
      const shell = opts.shell ?? [BASH];
      const r = opts.fromStdin
        ? spawnSync(shell[0]!, [...shell.slice(1), '-s', '--', ...args], {
          encoding: 'utf8', input: readFileSync(SCRIPT, 'utf8'), env, timeout: 20_000, cwd: root,
        })
        : spawnSync(shell[0]!, [...shell.slice(1), SCRIPT, ...args], {
          encoding: 'utf8', input: '', env, timeout: 20_000, cwd: root,
        });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr, calls: calls() };
    },
  };
}

/** What the installed binary prints, which names its version. */
const runBin = (path: string) => execFileSync(path, [], { encoding: 'utf8' }).trim();

const profileText = (h: Host) => [
  'abi <abi/4.0>,',
  'include <tunables/global>',
  '',
  `profile openldr-desktop-${UID} "${h.realHome}/.local/share/openldr-desktop/openldr-desktop" flags=(unconfined) {`,
  '  userns,',
  '',
  `  include if exists <local/openldr-desktop-${UID}>`,
  '}',
  '',
].join('\n');

/** A host with 0.1.10 and 0.1.11 published, 0.1.11 the newest. */
function twoReleases(homeName?: string): Host {
  const h = host(homeName);
  h.publish('0.1.10');
  h.publish('0.1.11');
  h.releases([
    { tag: 'v0.1.11', assets: ['latest.json', archiveName('0.1.11', 'linux-x64'), 'SHA256SUMS'] },
    { tag: 'v0.1.10', assets: ['latest.json', archiveName('0.1.10', 'linux-x64'), 'SHA256SUMS'] },
  ]);
  return h;
}

/** The refusal while OpenLDR runs. It names the installed command, for a person with no tray icon. */
const running = (h: Host) => `OpenLDR is running. Quit it from its tray icon, or run: "${h.cmd}" stop. Then run this again.`;
/** Each call that fetched the archive or its SHA256SUMS. */
const archiveFetches = (r: Result) =>
  r.calls.filter((c) => c.tool === 'curl' && c.args.some((a) => a.endsWith('.tar.gz') || a.endsWith('/SHA256SUMS')));
const CHECKSUM = 'The download does not match its checksum. Nothing was installed.';
const SANDBOX = 'The sandbox profile was not installed, so OpenLDR was not installed.';

// sh (dash on Debian and Ubuntu) and bash. Not busybox sh: it runs its own df, ps and uname ahead of
// the fakes on PATH, so a run under it would not be the test it claims to be.
const SHELLS: [string, string[]][] = [
  ['sh', ['sh']],
  ['bash', [BASH]],
];

describe.skipIf(platform() === 'win32')('install/desktop.sh on Linux', () => {
  for (const [name, shell] of SHELLS) {
    it(`installs the newest release under ${name}`, () => {
      const h = twoReleases();
      const r = h.run([], { shell });
      expect(r.code, r.out).toBe(0);
      expect(statSync(h.bin).mode & 0o111).not.toBe(0);
      expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
      expect(readFileSync(h.menu, 'utf8')).toContain(`Exec="${h.home}/.local/share/openldr-desktop/openldr-desktop"\n`);
      expect(r.out).toContain(h.target);
      expect(r.out).toContain(h.cmd);
      expect(r.out).toContain(h.data);
      for (const leftover of ['.new', '.old', '.download']) expect(existsSync(h.target + leftover)).toBe(false);
      expect(r.calls.some((c) => c.tool === 'update-desktop-database')).toBe(true);
      expect(r.calls.some((c) => c.tool === 'sudo')).toBe(false);
      // The fake tar is the one the script uses, so the checksum tests can count on it.
      expect(r.calls.filter((c) => c.tool === 'tar')).toHaveLength(1);
    });
  }

  it('installs when run from standard input, as curl ... | bash -s -- does', () => {
    const h = twoReleases();
    const r = h.run(['--version', '0.1.10'], { fromStdin: true });
    expect(r.code, r.out).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
  });

  it('writes the exact menu entry', () => {
    const h = twoReleases();
    expect(h.run([]).code).toBe(0);
    expect(readFileSync(h.menu, 'utf8')).toBe([
      '[Desktop Entry]',
      'Type=Application',
      'Name=OpenLDR',
      'Comment=Laboratory data repository',
      `Exec="${h.home}/.local/share/openldr-desktop/openldr-desktop"`,
      `Icon=${h.home}/.local/share/openldr-desktop/resources/app/apps/desktop/assets/icon.png`,
      'Terminal=false',
      'Categories=Science;MedicalSoftware;',
      '',
    ].join('\n'));
  });

  it('installs into a home with a space in its name; the profile and the menu entry quote the path', () => {
    const h = twoReleases('my home');
    writeFileSync(join(h.root, 'userns'), '1\n');
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
    expect(readFileSync(h.menu, 'utf8')).toContain(`Exec="${h.home}/.local/share/openldr-desktop/openldr-desktop"\n`);
    expect(h.home).toContain(' ');
    expect(readFileSync(join(h.aaDir, `openldr-desktop-${UID}`), 'utf8')).toBe(profileText(h));
  });

  it('refuses a system with no package and downloads nothing', () => {
    const h = twoReleases();
    h.ctl('uname-m', 'aarch64\n');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('✗ There is no OpenLDR desktop package for Linux aarch64. Packages exist for Linux x64, macOS on Apple silicon and Windows x64.');
    expect(existsSync(`${h.target}.download`)).toBe(false);
    expect(existsSync(h.target)).toBe(false);
  });

  for (const sums of ['wrong', 'missing'] as const) {
    it(`stops before unpacking when SHA256SUMS is ${sums === 'wrong' ? 'wrong' : 'missing the archive'}`, () => {
      const h = host();
      h.publish('0.1.11', 'linux-x64', sums);
      const r = h.run(['--version', '0.1.11']);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(`✗ ${CHECKSUM}`);
      for (const p of ['', '.new', '.download']) expect(existsSync(h.target + p)).toBe(false);
      // Nothing was unpacked, not even to be cleaned up after.
      expect(r.calls.filter((c) => c.tool === 'tar')).toEqual([]);
    });
  }

  it('a wrong checksum on an update leaves the older copy as it was', () => {
    const h = host();
    h.publish('0.1.10');
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    h.publish('0.1.11', 'linux-x64', 'wrong');
    const r = h.run(['--version', '0.1.11']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(CHECKSUM);
    expect(r.calls.filter((c) => c.tool === 'tar')).toEqual([]);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
  });

  it('takes the newest release that has an archive for this system', () => {
    const h = host();
    h.publish('0.1.10');
    h.releases([
      { tag: 'v0.1.11', assets: ['latest.json', archiveName('0.1.11', 'darwin-arm64'), 'openldr-desktop-0.1.11-win32-x64.zip'] },
      { tag: 'v0.1.10', assets: [archiveName('0.1.10', 'darwin-arm64'), archiveName('0.1.10', 'linux-x64')] },
    ]);
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
  });

  it('--version downloads that version and never reads the releases list', () => {
    const h = twoReleases();
    rmSync(join(h.root, 'releases.json'));
    const r = h.run(['--version', '0.1.10']);
    expect(r.code, r.out).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
  });

  it('reads the list on one line and pretty-printed alike, and passes over a release with a suffix', () => {
    const h = twoReleases();
    const list = [
      { tag: 'v0.2.0-beta.1', assets: ['openldr-desktop-0.2.0-beta.1-linux-x64.tar.gz', 'SHA256SUMS'] },
      { tag: 'v0.1.11', assets: [archiveName('0.1.11', 'linux-x64'), 'SHA256SUMS'] },
      { tag: 'v0.1.10', assets: [archiveName('0.1.10', 'linux-x64'), 'SHA256SUMS'] },
    ];
    for (const pretty of [false, true]) {
      h.releases(list, pretty);
      expect(readFileSync(join(h.root, 'releases.json'), 'utf8').split('\n').length > 1).toBe(pretty);
      const r = h.run(['--uninstall']);
      expect(r.code, r.out).toBe(0);
      const i = h.run([]);
      expect(i.code, i.out).toBe(0);
      expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
    }
  });

  it('stops when no release has a desktop package', () => {
    const h = host();
    h.releases([
      { tag: 'v0.1.11', assets: ['latest.json', 'openldr-desktop-0.1.11-win32-x64.zip'] },
      { tag: 'v0.1.10', assets: ['latest.json'] },
    ]);
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('✗ No OpenLDR release has a desktop package for linux-x64 yet.');
  });

  it('stops when the releases list cannot be read, and names --version', () => {
    const h = host();
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--version');
    expect(existsSync(h.target)).toBe(false);
  });

  it('updates an older copy and leaves the data folder alone', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    mkdirSync(h.data, { recursive: true });
    writeFileSync(join(h.data, 'marker'), 'lab data');
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
    expect(readFileSync(join(h.data, 'marker'), 'utf8')).toBe('lab data');
    expect(readdirSync(h.data)).toEqual(['marker']);
    for (const leftover of ['.new', '.old', '.download']) expect(existsSync(h.target + leftover)).toBe(false);
  });

  it('refuses an update while the older copy says it is running', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    h.ctl('status', '0');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`✗ ${running(h)}`);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
    for (const leftover of ['.new', '.download']) expect(existsSync(h.target + leftover)).toBe(false);
    // Refused before the download: the archive was never fetched.
    expect(archiveFetches(r)).toEqual([]);
    expect(r.calls.filter((c) => c.tool === 'tar')).toEqual([]);
  });

  it('refuses an update when a process runs from the app folder, even when status says not running', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    h.ctl('status', '3');
    h.ctl('ps', `${h.target}/resources/app/apps/standalone/node_modules/@embedded-postgres/linux-x64/native/bin/postgres -D /x\n`);
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(running(h));
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
    expect(archiveFetches(r)).toEqual([]);
  });

  it('does not take a sibling folder such as openldr-desktop-spike for the app', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    h.ctl('ps', `${h.target}-spike/openldr-desktop --type=zygote\n`);
    expect(h.run([]).code).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
  });

  // The real ps, not the fake: the running check must not match its own grep. The app folder is a
  // temp path, so no real process holds it.
  for (const [name, shell] of SHELLS) {
    it(`with the real ps, an update and an --uninstall go through (${name})`, () => {
      const h = twoReleases();
      expect(h.run(['--version', '0.1.10'], { shell }).code).toBe(0);
      rmSync(join(h.root, 'bin/ps'));
      const u = h.run([], { shell });
      expect(u.code, u.out).toBe(0);
      expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
      const x = h.run(['--uninstall'], { shell });
      expect(x.code, x.out).toBe(0);
      expect(existsSync(h.target)).toBe(false);
    });
  }

  for (const shell of [['sh'], [BASH]]) {
    it(`the menu entry passes desktop-file-validate (${shell[0] === 'sh' ? 'sh' : 'bash'})`, { skip: !HAS_VALIDATE }, () => {
      for (const homeName of ['home', 'my home', 'a$b%c`d']) {
        const h = twoReleases(homeName);
        const r = h.run([], { shell });
        expect(r.code, r.out).toBe(0);
        const v = spawnSync('desktop-file-validate', [h.menu], { encoding: 'utf8' });
        expect(v.status, v.stdout + v.stderr).toBe(0);
        expect(v.stdout + v.stderr).not.toMatch(/error/i);
      }
    });
  }

  // dash's echo reads backslashes, so this runs under both shells.
  for (const [name, shell] of SHELLS) {
    it(`escapes the Exec path as the desktop entry rules ask, and writes the profile path whole (${name})`, () => {
      for (const homeName of ['a$b%c`d', 'a\\b"c']) {
        const h = twoReleases(homeName);
        const i = h.run([], { shell });
        expect(i.code, `${homeName}: ${i.out}`).toBe(0);
        const want = `${h.home}/.local/share/openldr-desktop/openldr-desktop`
          .replace(/["`$\\]/g, (c) => `\\${c}`);
        const exec = `"${want}"`.replace(/\\/g, '\\\\').replace(/%/g, '%%');
        expect(readFileSync(h.menu, 'utf8')).toContain(`Exec=${exec}\n`);
      }
      // A home with $ and a backtick may carry a profile; the path in it is written as it is.
      const h = twoReleases('a$b%c`d');
      writeFileSync(join(h.root, 'userns'), '1\n');
      const r = h.run([], { shell });
      expect(r.code, r.out).toBe(0);
      expect(readFileSync(join(h.aaDir, `openldr-desktop-${UID}`), 'utf8')).toBe(profileText(h));
    });
  }

  it('refuses a home whose path holds a character the profile cannot carry, before any sudo', () => {
    for (const homeName of ['a*b', 'a"b', 'a{b}', 'a[b]', 'a?b', 'a^b', 'a\\b']) {
      const h = twoReleases(homeName);
      writeFileSync(join(h.root, 'userns'), '1\n');
      const r = h.run([]);
      expect(r.code, homeName).toBe(1);
      expect(r.stderr).toContain("✗ The home folder's path holds a character the sandbox profile cannot carry. Nothing was installed.");
      expect(r.calls.filter((c) => c.tool === 'sudo')).toEqual([]);
      // Refused before the download.
      expect(archiveFetches(r), homeName).toEqual([]);
      for (const p of ['', '.new', '.download']) expect(existsSync(h.target + p), homeName + p).toBe(false);
      expect(existsSync(h.menu)).toBe(false);
      expect(readdirSync(h.aaDir)).toEqual([]);
    }
  });

  it('names the real path in the profile when ~/.local/share is a link', () => {
    const h = twoReleases();
    const elsewhere = join(h.root, 'elsewhere', 'share');
    mkdirSync(elsewhere, { recursive: true });
    mkdirSync(join(h.home, '.local'), { recursive: true });
    symlinkSync(elsewhere, join(h.home, '.local/share'));
    writeFileSync(join(h.root, 'userns'), '1\n');
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    const profile = readFileSync(join(h.aaDir, `openldr-desktop-${UID}`), 'utf8');
    expect(profile).toContain(`profile openldr-desktop-${UID} "${realpathSync(elsewhere)}/openldr-desktop/openldr-desktop" flags=(unconfined) {`);
    expect(runBin(join(realpathSync(elsewhere), 'openldr-desktop/openldr-desktop'))).toBe('openldr-desktop 0.1.11');
  });

  it('names the real path in the profile when ~/.local is a link', () => {
    const h = twoReleases();
    const elsewhere = join(h.root, 'elsewhere-local');
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(h.home, '.local'));
    writeFileSync(join(h.root, 'userns'), '1\n');
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    const profile = readFileSync(join(h.aaDir, `openldr-desktop-${UID}`), 'utf8');
    expect(profile).toContain(`"${realpathSync(elsewhere)}/share/openldr-desktop/openldr-desktop"`);
  });

  const SYSTEM_PARSER = ['/usr/sbin/apparmor_parser', '/sbin/apparmor_parser'].find((p) => existsSync(p));
  it('takes apparmor_parser from /usr/sbin or /sbin before PATH when no override is set', { skip: SYSTEM_PARSER === undefined }, () => {
    const h = twoReleases();
    writeFileSync(join(h.root, 'userns'), '1\n');
    // The fake sudo refuses a path outside the test's folder, so the system parser is named, never run.
    const r = h.run([], { env: { OPENLDR_DESKTOP_APPARMOR_PARSER: '' } });
    expect(r.code).toBe(1);
    const sudo = r.calls.filter((c) => c.tool === 'sudo');
    expect(sudo).toHaveLength(1);
    expect(sudo[0]!.args[0]).toBe(SYSTEM_PARSER);
    expect(r.stderr).toContain(`✗ ${SANDBOX}`);
    expect(r.stderr).toContain('fake sudo: refusing');
  });

  it('asks curl for https only when the URL is https, and leaves a file: URL alone', () => {
    const h = twoReleases();
    h.ctl('curl-offline', '1');
    const r = h.run([], {
      env: { OPENLDR_DESKTOP_RELEASES_URL: 'https://example.invalid/releases', OPENLDR_DESKTOP_DOWNLOAD_BASE: 'https://example.invalid/dl' },
    });
    expect(r.code).toBe(1);
    const list = r.calls.filter((c) => c.tool === 'curl');
    expect(list).toHaveLength(1);
    expect(list[0]!.args.join(' ')).toContain("--proto =https --proto-redir =https");
    const d = h.run(['--version', '0.1.11'], { env: { OPENLDR_DESKTOP_DOWNLOAD_BASE: 'https://example.invalid/dl' } });
    expect(d.code).toBe(1);
    expect(d.stderr).toContain('Could not download https://example.invalid/dl/v0.1.11/');
    const fetch = d.calls.filter((c) => c.tool === 'curl');
    expect(fetch).toHaveLength(1);
    expect(fetch[0]!.args.slice(0, 4)).toEqual(['--proto', '=https', '--proto-redir', '=https']);
    h.ctl('curl-offline', null);
    const f = h.run([]);
    expect(f.code, f.out).toBe(0);
    const curls = f.calls.filter((c) => c.tool === 'curl');
    expect(curls.length).toBe(3);
    for (const c of curls) expect(c.args).not.toContain('--proto');
  });

  for (const [sysName, unameS, unameM, sys] of [
    ['Linux', 'Linux', 'x86_64', 'linux-x64'], ['macOS', 'Darwin', 'arm64', 'darwin-arm64'],
  ] as const) {
    it(`refuses a home with a line break on ${sysName}, before anything is written`, () => {
      const h = host('a\nb');
      h.ctl('uname-s', `${unameS}\n`);
      h.ctl('uname-m', `${unameM}\n`);
      h.publish('0.1.11', sys);
      const r = h.run(['--version', '0.1.11']);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("✗ The home folder's path holds a line break. Nothing was installed.");
      expect(r.calls).toEqual([]);
      expect(readdirSync(h.home)).toEqual([]);
    });
  }

  it('moves a leftover .old copy back before anything else', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    renameSync(h.target, `${h.target}.old`);
    h.ctl('df-avail', '1000');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(existsSync(`${h.target}.old`)).toBe(false);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
  });

  it('stops with a plain message when less than 2 GB is free, and downloads nothing', () => {
    const h = twoReleases();
    h.ctl('df-avail', String(2 * 1024 * 1024 - 1));
    // A leftover download folder from an earlier run is removed, not counted against the space.
    mkdirSync(`${h.target}.download`, { recursive: true });
    writeFileSync(`${h.target}.download/part`, 'partial');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/✗ .*2 GB/);
    expect(existsSync(`${h.target}.download`)).toBe(false);
    expect(existsSync(h.target)).toBe(false);
  });

  it('installs the AppArmor profile with exactly two sudo calls when the system restricts user namespaces', () => {
    const h = twoReleases();
    writeFileSync(join(h.root, 'userns'), '1\n');
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    const sudo = r.calls.filter((c) => c.tool === 'sudo');
    expect(sudo).toHaveLength(2);
    const profileFile = join(h.aaDir, `openldr-desktop-${UID}`);
    const [load, install] = sudo.map((c) => c.args);
    expect(load![0]!.endsWith('/apparmor_parser')).toBe(true);
    expect(load![1]).toBe('-r');
    expect(load![2]!.startsWith(join(h.root, 'tmp'))).toBe(true);
    expect(load).toHaveLength(3);
    expect(install).toEqual(['install', '-m', '0644', load![2], profileFile]);
    expect(readFileSync(profileFile, 'utf8')).toBe(profileText(h));
    expect((statSync(profileFile).mode & 0o777).toString(8)).toBe('644');
    expect(existsSync(load![2]!)).toBe(false);
    expect(r.out).toMatch(/sudo/);
    expect(r.out).toMatch(/administrator password/);
  });

  it('stops and writes no profile when apparmor_parser fails to load it', () => {
    const h = twoReleases();
    writeFileSync(join(h.root, 'userns'), '1\n');
    h.ctl('parser-fails', '1');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`✗ ${SANDBOX}`);
    expect(existsSync(join(h.aaDir, `openldr-desktop-${UID}`))).toBe(false);
    expect(r.calls.filter((c) => c.tool === 'sudo')).toHaveLength(1);
    for (const p of ['', '.new', '.download']) expect(existsSync(h.target + p)).toBe(false);
  });

  it('asks for nothing when the userns file holds 0 or is missing', () => {
    for (const userns of ['0\n', null]) {
      const h = twoReleases();
      if (userns === null) rmSync(join(h.root, 'userns'));
      else writeFileSync(join(h.root, 'userns'), userns);
      const r = h.run([]);
      expect(r.code, r.out).toBe(0);
      expect(r.calls.filter((c) => c.tool === 'sudo')).toHaveLength(0);
      expect(readdirSync(h.aaDir)).toEqual([]);
    }
  });

  it('a declined sudo on a first install leaves no app and no .new folder', () => {
    const h = twoReleases();
    writeFileSync(join(h.root, 'userns'), '1\n');
    h.ctl('sudo-fails', '1');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`✗ ${SANDBOX}`);
    for (const p of ['', '.new', '.download']) expect(existsSync(h.target + p)).toBe(false);
    expect(existsSync(h.menu)).toBe(false);
  });

  it('a declined sudo on an update leaves the older copy, and it still runs', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    writeFileSync(join(h.root, 'userns'), '1\n');
    h.ctl('sudo-fails', '1');
    const r = h.run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(SANDBOX);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
    expect(runBin(h.cmd)).toBe('openldr-standalone 0.1.10');
    for (const p of ['.new', '.old', '.download']) expect(existsSync(h.target + p)).toBe(false);
  });

  it('an update asks for nothing when the installed profile already holds the same text', () => {
    const h = twoReleases();
    writeFileSync(join(h.root, 'userns'), '1\n');
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
    expect(r.calls.filter((c) => c.tool === 'sudo')).toHaveLength(0);
  });

  it('links the command into ~/.local/bin when that folder is on PATH', () => {
    const h = twoReleases();
    mkdirSync(join(h.home, '.local/bin'), { recursive: true });
    const r = h.run([], { localBinOnPath: true });
    expect(r.code, r.out).toBe(0);
    const link = join(h.home, '.local/bin/openldr-standalone');
    expect(readlinkSync(link)).toBe(h.cmd);
    expect(realpathSync(link)).toBe(realpathSync(h.cmd));
    expect(runBin(link)).toBe('openldr-standalone 0.1.11');
  });

  it('replaces an older link but never a real file', () => {
    const h = twoReleases();
    mkdirSync(join(h.home, '.local/bin'), { recursive: true });
    const link = join(h.home, '.local/bin/openldr-standalone');
    writeFileSync(link, 'mine');
    const r = h.run([], { localBinOnPath: true });
    expect(r.code, r.out).toBe(0);
    expect(readFileSync(link, 'utf8')).toBe('mine');
    expect(r.out).toContain(h.cmd);
  });

  it('makes no link when ~/.local/bin is not on PATH, and prints the full path', () => {
    const h = twoReleases();
    mkdirSync(join(h.home, '.local/bin'), { recursive: true });
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    expect(readdirSync(join(h.home, '.local/bin'))).toEqual([]);
    expect(r.out).toContain(h.cmd);
  });

  it('--uninstall removes the app, the entry, the link, the sign-in file, the app folder and the profile', () => {
    const h = twoReleases();
    writeFileSync(join(h.root, 'userns'), '1\n');
    mkdirSync(join(h.home, '.local/bin'), { recursive: true });
    expect(h.run([], { localBinOnPath: true }).code).toBe(0);
    const link = join(h.home, '.local/bin/openldr-standalone');
    const autostart = join(h.home, '.config/autostart/openldr-desktop.desktop');
    const appDir = join(h.home, '.config/OpenLDR Desktop');
    mkdirSync(dirname(autostart), { recursive: true });
    writeFileSync(autostart, '[Desktop Entry]\n');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'settings.json'), '{}');
    mkdirSync(h.data, { recursive: true });
    writeFileSync(join(h.data, 'marker'), 'lab data');
    const profileFile = join(h.aaDir, `openldr-desktop-${UID}`);
    expect(existsSync(profileFile)).toBe(true);

    const r = h.run(['--uninstall'], { localBinOnPath: true });
    expect(r.code, r.out).toBe(0);
    for (const p of [h.target, h.menu, link, autostart, appDir, profileFile]) expect(existsSync(p), p).toBe(false);
    expect(readFileSync(join(h.data, 'marker'), 'utf8')).toBe('lab data');
    const sudo = r.calls.filter((c) => c.tool === 'sudo').map((c) => c.args);
    expect(sudo).toHaveLength(2);
    expect(sudo[0]![0]!.endsWith('/apparmor_parser')).toBe(true);
    expect(sudo[0]!.slice(1)).toEqual(['-R', profileFile]);
    expect(sudo[1]).toEqual(['rm', '-f', profileFile]);
    expect(r.out).toContain(h.data);
    expect(r.out).toMatch(/administrator password/);
    // The home holds only what the test made outside the app.
    expect(existsSync(join(h.home, '.local/share/applications'))).toBe(true);
  });

  it('--uninstall uses XDG_CONFIG_HOME for the app folder when it is set', () => {
    const h = twoReleases();
    expect(h.run([]).code).toBe(0);
    const xdg = join(h.root, 'xdg');
    const appDir = join(xdg, 'OpenLDR Desktop');
    mkdirSync(appDir, { recursive: true });
    const r = h.run(['--uninstall'], { env: { XDG_CONFIG_HOME: xdg } });
    expect(r.code, r.out).toBe(0);
    expect(existsSync(appDir)).toBe(false);
    expect(existsSync(xdg)).toBe(true);
  });

  it('--uninstall leaves a link that points somewhere else', () => {
    const h = twoReleases();
    expect(h.run([]).code).toBe(0);
    mkdirSync(join(h.home, '.local/bin'), { recursive: true });
    const link = join(h.home, '.local/bin/openldr-standalone');
    execFileSync('ln', ['-s', '/usr/bin/true', link]);
    expect(h.run(['--uninstall']).code).toBe(0);
    expect(readlinkSync(link)).toBe('/usr/bin/true');
  });

  it('never removes or moves a folder that holds the data folder', () => {
    const h = twoReleases();
    expect(h.run(['--version', '0.1.10']).code).toBe(0);
    const data = join(h.target, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'marker'), 'lab data');
    for (const args of [['--uninstall'], []]) {
      const r = h.run(args, { env: { OPENLDR_HOME: data } });
      expect(r.code, r.out).toBe(1);
      expect(r.stderr).toContain(`✗ OpenLDR's data folder ${data} is inside ${h.target}. Nothing was changed.`);
      expect(readFileSync(join(data, 'marker'), 'utf8')).toBe('lab data');
      expect(runBin(h.bin)).toBe('openldr-desktop 0.1.10');
      expect(r.calls.filter((c) => c.tool === 'tar')).toEqual([]);
    }
  });

  it('--uninstall refuses while OpenLDR is running', () => {
    const h = twoReleases();
    expect(h.run([]).code).toBe(0);
    h.ctl('status', '0');
    const r = h.run(['--uninstall']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`✗ ${running(h)}`);
    expect(runBin(h.bin)).toBe('openldr-desktop 0.1.11');
  });

  it('--uninstall with nothing installed says so and exits 0', () => {
    const h = host();
    const r = h.run(['--uninstall']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/not installed/);
    expect(r.calls.filter((c) => c.tool === 'sudo')).toHaveLength(0);
  });

  it('an unknown option exits 2', () => {
    const h = host();
    const r = h.run(['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown flag: --bogus');
  });

  it('stops before touching anything when HOME is empty or /', () => {
    const h = host();
    for (const home of ['', '/']) {
      for (const args of [[], ['--uninstall']]) {
        const r = h.run(args, { env: { HOME: home } });
        expect(r.code, r.out).toBe(1);
        expect(r.stderr).toContain('✗ HOME is not set to a folder.');
        expect(r.calls).toEqual([]);
      }
    }
  });

  it('a --version that is not a version exits 2', () => {
    const h = host();
    const r = h.run(['--version', '../../x']);
    expect(r.code).toBe(2);
    expect(existsSync(h.target)).toBe(false);
  });

  it('the script holds no --no-sandbox, and uses sudo only for the profile', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    expect(text).not.toContain('--no-sandbox');
    const sudoLines = text.split('\n').filter((l) => /\bsudo\b/.test(l) && !/^\s*#/.test(l));
    expect(sudoLines.length).toBeGreaterThan(0);
    for (const l of sudoLines) expect(l, l).toMatch(/apparmor_parser|profile/);
    // The whole body runs from one function called on the last line, so a cut download runs nothing.
    const lines = text.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe('main "$@"');
  });
});

describe.skipIf(platform() === 'win32')('install/desktop.sh on macOS (fakes only: not proven, waits for the operator)', () => {
  it('installs into ~/Applications, signs it ad hoc, asks for no sudo, writes no menu entry', () => {
    const h = host();
    h.ctl('uname-s', 'Darwin\n');
    h.ctl('uname-m', 'arm64\n');
    writeFileSync(join(h.root, 'userns'), '1\n');
    h.publish('0.1.11', 'darwin-arm64');
    h.releases([{ tag: 'v0.1.11', assets: [archiveName('0.1.11', 'linux-x64'), archiveName('0.1.11', 'darwin-arm64')] }]);
    const r = h.run([]);
    expect(r.code, r.out).toBe(0);
    const app = join(h.home, 'Applications/OpenLDR.app');
    expect(runBin(join(app, 'Contents/MacOS/Electron'))).toBe('openldr-desktop 0.1.11');
    const sign = r.calls.filter((c) => c.tool === 'codesign').map((c) => c.args);
    const pg = 'Contents/Resources/app/apps/standalone/node_modules/@embedded-postgres/darwin-arm64/native';
    // Inside out: every Postgres file at every depth, then the whole app last. All of it on the
    // .new copy, before the swap.
    const newApp = `${app}.new`;
    expect(sign.map((a) => a.slice(0, -1))).toEqual([
      ['--force', '--sign', '-'],
      ['--force', '--sign', '-'],
      ['--force', '--sign', '-'],
      ['--force', '--sign', '-'],
      ['--force', '--deep', '--sign', '-'],
    ]);
    const paths = sign.map((a) => a[a.length - 1]!);
    expect(paths[paths.length - 1]).toBe(newApp);
    expect(paths.slice(0, -1).sort()).toEqual([
      `${newApp}/${pg}/bin/postgres`,
      `${newApp}/${pg}/lib/libpq.5.dylib`,
      `${newApp}/${pg}/lib/postgresql/extension/plpgsql.control`,
      `${newApp}/${pg}/lib/postgresql/plpgsql.dylib`,
    ]);
    expect(r.calls.filter((c) => c.tool === 'sudo')).toHaveLength(0);
    expect(existsSync(h.menu)).toBe(false);
    expect(existsSync(h.target)).toBe(false);
    expect(r.out).toContain(join(app, 'Contents/Resources/openldr-standalone'));
    expect(r.out).toContain(join(h.home, 'Library/Application Support/OpenLDR'));
    expect(existsSync(join(h.home, 'Applications/.OpenLDR.download'))).toBe(false);
    expect(existsSync(`${app}.new`)).toBe(false);
  });

  it('--uninstall removes the app and the app folder, and names System Settings', () => {
    const h = host();
    h.ctl('uname-s', 'Darwin\n');
    h.ctl('uname-m', 'arm64\n');
    h.publish('0.1.11', 'darwin-arm64');
    expect(h.run(['--version', '0.1.11']).code).toBe(0);
    const appDir = join(h.home, 'Library/Application Support/OpenLDR Desktop');
    const data = join(h.home, 'Library/Application Support/OpenLDR');
    mkdirSync(appDir, { recursive: true });
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'marker'), 'lab data');
    const r = h.run(['--uninstall']);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(h.home, 'Applications/OpenLDR.app'))).toBe(false);
    expect(existsSync(appDir)).toBe(false);
    expect(readFileSync(join(data, 'marker'), 'utf8')).toBe('lab data');
    expect(r.out).toContain('System Settings');
    expect(r.out).toContain(data);
    expect(r.calls.filter((c) => c.tool === 'sudo')).toHaveLength(0);
  });
});

// install/desktop.ps1 is read as text. Nothing on this machine runs PowerShell, so every line of
// it is not proven, waits for the operator. These tests pin the shape a reader relies on.
describe('desktop.ps1 (unproven: nothing here runs PowerShell)', () => {
  const PS1 = join(REPO, 'install/desktop.ps1');
  const bytes = existsSync(PS1) ? readFileSync(PS1) : Buffer.alloc(0);
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  // The code alone. The script keeps every comment on a line of its own.
  const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const MAIN = 'Install-OpenLdrDesktop';

  /** The body of each function defined at the start of a line, found by counting braces. */
  function functions(src: string): Map<string, string> {
    const out = new Map<string, string>();
    const re = /^function ([\w-]+)[^{\n]*\{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
      }
      out.set(m[1]!, src.slice(m.index + m[0].length, i - 1));
      re.lastIndex = i;
    }
    return out;
  }
  const fns = functions(code);
  const main = fns.get(MAIN) ?? '';
  const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

  it('exists and is ASCII only', () => {
    expect(bytes.length).toBeGreaterThan(0);
    const bad = [...bytes].findIndex((b) => b > 0x7f);
    expect(bad).toBe(-1);
  });

  it('checks the checksum before the first unpack, inside the install function', () => {
    const check = main.indexOf('Assert-OpenLdrChecksum ');
    const unpack = main.indexOf('Expand-OpenLdrArchive ');
    expect(check).toBeGreaterThan(-1);
    expect(unpack).toBeGreaterThan(check);
    // The install function unpacks only through that one call.
    expect(main).not.toContain('tar.exe');
    expect(main).not.toContain('Expand-Archive');
    expect(fns.get('Assert-OpenLdrChecksum') ?? '').toContain('Get-FileHash -LiteralPath $Zip -Algorithm SHA256');
  });

  it('holds the checksum message and the "is running" message, and prints a stop with X', () => {
    expect(code).toContain("'The download does not match its checksum. Nothing was installed.'");
    // The running refusal names the installed command. The & runs a quoted path in PowerShell.
    expect(fns.get('Get-OpenLdrRunningMessage') ?? '').toContain(
      '"OpenLDR is running. Quit it from its tray icon, or run: & `"$Target\\openldr-standalone.cmd`" stop. Then run this again."',
    );
    expect(code).not.toContain('Quit it from its tray icon, then run this again.');
    expect(count(code, /throw \(Get-OpenLdrRunningMessage \$\w+\)/g)).toBe(3);
    expect(fns.get('Write-OpenLdrFail') ?? '').toContain('Write-Host "X $Message"');
  });

  it('checks whether OpenLDR runs before the download, inside the install function', () => {
    const running = main.indexOf('Test-OpenLdrRunning $target');
    expect(running).toBeGreaterThan(-1);
    expect(running).toBeLessThan(main.indexOf('Find-OpenLdrVersion '));
    expect(running).toBeLessThan(main.indexOf('Save-OpenLdrFile '));
    expect(running).toBeLessThan(main.indexOf('CreateDirectory($dl)'));
  });

  it('appends the system\'s own reason to the five messages that replace an error', () => {
    expect(fns.get('Find-OpenLdrVersion') ?? '').toMatch(/throw "Could not read the list of OpenLDR releases\.[^"\n]*\$\(\$_\.Exception\.Message\)"/);
    expect(fns.get('Save-OpenLdrFile') ?? '').toMatch(/throw "Could not download \$Url\.[^"\n]*\$\(\$_\.Exception\.Message\)"/);
    for (const sentence of [
      'Could not move the older copy aside. Nothing was changed.',
      'Could not move the new copy into place. The older copy was put back.',
      'Could not move the new copy into place.',
    ]) {
      const line = main.split('\n').find((l) => l.includes(`throw "${sentence} The system said:`));
      expect(line, sentence).toBeDefined();
      expect(line).toMatch(/\$reason"|\$\(\$_\.Exception\.Message\)"/);
    }
    expect(count(main, /\$reason = \$_\.Exception\.Message/g)).toBeGreaterThanOrEqual(3);
  });

  it('a failed clean-up after the swap is a warning that names the folder, and the shortcut still follows', () => {
    const swapped = main.lastIndexOf('Move-OpenLdrPath $new $target');
    const shortcut = main.indexOf('New-OpenLdrShortcut ');
    expect(swapped).toBeGreaterThan(-1);
    expect(shortcut).toBeGreaterThan(swapped);
    const after = main.slice(swapped, shortcut).split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const removals = after.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('Remove-OpenLdrPath '));
    expect(removals.map(([l]) => l)).toEqual(['Remove-OpenLdrPath $old $owned $dataDir', 'Remove-OpenLdrPath $dl $owned $dataDir']);
    for (const [, i] of removals) expect(after[i - 1]).toBe('try {');
    expect(after.join('\n')).toMatch(/Write-OpenLdrWarn "Could not remove \$old\./);
    expect(after.join('\n')).toMatch(/Write-OpenLdrWarn "Could not remove \$dl\./);
    // Once the new copy is in place, a later stop must not clean up after it.
    expect(after.indexOf('$cleanup = $false')).toBeGreaterThan(-1);
    expect(after.indexOf('$cleanup = $false')).toBeLessThan(removals[0]![1]);
  });

  it('never names --no-sandbox, RunAs, SetEnvironmentVariable, setx or HKLM', () => {
    for (const s of ['--no-sandbox', 'RunAs', 'SetEnvironmentVariable', 'HKLM', 'HKEY_LOCAL_MACHINE']) {
      expect(text).not.toContain(s);
    }
    expect(text).not.toMatch(/\bsetx\b/i);
  });

  it('holds no exit statement, and sets $ErrorActionPreference only inside a function', () => {
    expect(code).not.toMatch(/\bexit\b/i);
    const assign = /\$ErrorActionPreference\s*=/g;
    const inside = [...fns.values()].reduce((n, body) => n + count(body, assign), 0);
    expect(count(code, assign)).toBeGreaterThan(0);
    expect(inside).toBe(count(code, assign));
    expect(main).toContain("$ErrorActionPreference = 'Stop'");
  });

  it('names System32\\tar.exe and turns the progress bar off inside the install function', () => {
    expect(code).toContain('System32\\tar.exe');
    expect(main).toContain("$ProgressPreference = 'SilentlyContinue'");
  });

  it('names the app folder, the shortcut, the command, the data folder and the Run key', () => {
    expect(code).toContain('"$env:LOCALAPPDATA\\Programs\\OpenLDR"');
    expect(code).toContain('OpenLDR.lnk');
    expect(code).toContain('openldr-standalone.cmd');
    // The Windows folder resolveDataDir in apps/standalone/src/state.ts picks.
    expect(code).toContain('"$env:LOCALAPPDATA\\OpenLDR"');
    expect(code).toContain('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run');
  });

  it('removes and moves paths only through the two guarded functions', () => {
    const removes = /\bRemove-Item\b(?!Property)/g;
    const moves = /\bMove-Item\b|\bRename-Item\b|\]::Move\(/g;
    expect(count(code, removes)).toBeGreaterThan(0);
    expect(count(fns.get('Remove-OpenLdrPath') ?? '', removes)).toBe(count(code, removes));
    expect(count(code, moves)).toBeGreaterThan(0);
    expect(count(fns.get('Move-OpenLdrPath') ?? '', moves)).toBe(count(code, moves));
  });

  it('has a param block with $Version and [switch]$Uninstall, and calls the install function on its last line', () => {
    expect(code).toMatch(/^param\(\s*\[string\]\$Version = '',\s*\[switch\]\$Uninstall\s*\)/m);
    expect(code.trimEnd().split('\n').pop()).toBe(`${MAIN} -Version $Version -Uninstall:$Uninstall`);
  });

  it('has an asset name pattern that matches archiveName for win32-x64 and nothing else', () => {
    const m = /'(\^openldr-desktop-[^']*win32-x64[^']*)'/.exec(code);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]!);
    const name = packArchiveName('0.1.12', 'win32-x64');
    expect(name).toBe('openldr-desktop-0.1.12-win32-x64.zip');
    expect(re.exec(name)?.[1]).toBe('0.1.12');
    expect(re.test(packArchiveName('0.1.12', 'linux-x64'))).toBe(false);
    expect(re.test('openldr-desktop-0.2.0-beta.1-win32-x64.zip')).toBe(false);
  });
});
