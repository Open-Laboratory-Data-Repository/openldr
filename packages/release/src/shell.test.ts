import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = resolve(__dirname, '../../..');
const RESOLVE_VERSION_LIB = join(REPO, 'install/lib/resolve-version.sh').replace(/\\/g, '/');
/** The version the guard checks — the same one build-and-push.sh reads from package.json. */
const VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version as string;

/**
 * Resolve a real `bash` binary to shell out to.
 *
 * On Windows, `bash` on PATH can resolve to `C:\WINDOWS\system32\bash.exe` — the WSL
 * launcher, not a POSIX shell you can pass `-c` scripts or shebang'd fixtures to. It fails
 * with `execvpe(/bin/bash) failed: No such file or directory` unless a WSL distro happens to
 * be installed. Git for Windows ships its own real bash; find that one explicitly instead of
 * trusting PATH order.
 */
function resolveGitBash(): string {
  if (platform() !== 'win32') return 'bash';

  const isWslLauncher = (p: string) => /\\windows\\system32\\bash\.exe$/i.test(p);
  const candidates: string[] = [];

  try {
    // Typically prints e.g. `C:/Program Files/Git/mingw64/libexec/git-core`.
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim().replace(/\\/g, '/');
    const installRoot = execPath.replace(/\/(mingw64|mingw32|usr)\/libexec\/git-core\/?$/, '');
    if (installRoot && installRoot !== execPath) {
      candidates.push(join(installRoot, 'bin', 'bash.exe'));
    }
  } catch {
    // `git` not on PATH, or --exec-path failed: fall through to the fixed locations below.
  }

  candidates.push('C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe');

  for (const candidate of candidates) {
    if (isWslLauncher(candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Could not find Git Bash. These tests shell out to a real bash and refuse to fall back ' +
      'to C:\\WINDOWS\\system32\\bash.exe (the WSL launcher). Install Git for Windows, which ' +
      'ships its own bash.exe alongside git.exe.',
  );
}

const BASH = resolveGitBash();

interface FakeGh {
  /**
   * Tags this fake package has published. The fake `gh` serves them the way the real one
   * does: 30 per page unless the caller pages, and shaped by whichever `--jq` it was given.
   */
  tags?: string[];
  /** Canned stdout, for the failure-mode tests that do not care about tags. */
  stdout?: string;
  /** Text printed to stderr, e.g. what `gh api` prints when it fails. */
  stderr?: string;
  /** Exit code for the fake `gh`. Defaults to 0 (success). */
  exitCode?: number;
  /**
   * Exit code for the "can this token see the org's container packages at all" probe.
   * 0 (default) means yes, so a per-package 404 really does mean absent.
   */
  probeExitCode?: number;
}

/** Single-quote a string for embedding in the generated bash fake. */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run build-and-push.sh with a fake `gh` AND a fake `docker` first on PATH, so no network,
 * token, or real image build is ever involved — even in push-mode tests that get past the
 * overwrite guard. The fake `docker` just echoes its argv and exits 0.
 *
 * The fake `gh` reproduces the two behaviours of the real one the guard depends on:
 *   1. a page holds 30 items — the rest are only reachable with `--paginate`
 *   2. `--jq` decides the output shape: a tag-per-line stream, or an `index()` scalar
 * Without (1) a fake would answer a single-page request as if it had seen every version,
 * which is exactly the bug the guard had.
 */
function buildAndPush(args: string[], gh: string | FakeGh): { code: number; out: string } {
  const opts: FakeGh = typeof gh === 'string' ? { stdout: gh } : gh;
  const bin = mkdtempSync(join(tmpdir(), 'openldr-fakebin-'));

  const ghPath = join(bin, 'gh');
  const ghLines = [
    '#!/usr/bin/env bash',
    'args="$*"',
    '# The read:packages visibility probe is a different endpoint — answer it separately.',
    'case "$args" in',
    `  *package_type=container*) exit ${opts.probeExitCode ?? 0} ;;`,
    'esac',
  ];
  if (opts.stdout !== undefined) ghLines.push(`printf '%s\\n' ${sq(opts.stdout)}`);
  if (opts.stderr !== undefined) ghLines.push(`printf '%s\\n' ${sq(opts.stderr)} >&2`);
  if (opts.stdout !== undefined || opts.stderr !== undefined || opts.exitCode !== undefined) {
    ghLines.push(`exit ${opts.exitCode ?? 0}`);
  } else {
    ghLines.push(
      `TAGS=(${(opts.tags ?? []).map(sq).join(' ')})`,
      '# GitHub returns 30 items per response; only --paginate walks past the first page.',
      'case "$args" in',
      '  *--paginate*) ;;',
      '  *) TAGS=("${TAGS[@]:0:30}") ;;',
      'esac',
      'case "$args" in',
      "  *'index('*)",
      `    for t in "\${TAGS[@]}"; do if [ "$t" = ${sq(VERSION)} ]; then echo 0; exit 0; fi; done`,
      '    echo absent; exit 0 ;;',
      'esac',
      'for t in "${TAGS[@]}"; do echo "$t"; done',
      'exit 0',
    );
  }
  writeFileSync(ghPath, ghLines.join('\n') + '\n');
  chmodSync(ghPath, 0o755);

  const dockerPath = join(bin, 'docker');
  writeFileSync(dockerPath, `#!/usr/bin/env bash\necho "FAKE-DOCKER-CALLED-WITH: $*"\nexit 0\n`);
  chmodSync(dockerPath, 0o755);

  try {
    const out = execFileSync(BASH, [join(REPO, 'scripts/build-and-push.sh').replace(/\\/g, '/'), ...args], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('build-and-push.sh overwrite guard', () => {
  // The guard is the reason this change exists: a published version tag is immutable.
  it('refuses when the version tag is already published', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], { tags: [VERSION] });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already published/i);
    expect(r.out).not.toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  it('names --allow-overwrite in the refusal, so the escape hatch is discoverable', () => {
    expect(buildAndPush(['--platform', 'linux/amd64'], { tags: [VERSION] }).out).toMatch(/--allow-overwrite/);
  });

  it('does not fire on a dry run', () => {
    const r = buildAndPush(['--dry-run'], { tags: [VERSION] });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/docker buildx build/);
  });

  // A published package that simply does not carry this version. This runs in real push mode:
  // --dry-run skips the whole guard block, so a dry run proves nothing about it. Reaching the
  // fake `docker` is the assertion that separates "the guard let it through" from "the script
  // died somewhere else and happened to exit 0".
  it('proceeds when the tag is absent', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], { tags: ['0.0.9', '0.0.8'] });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/already published/i);
    expect(r.out).toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  // --no-push builds locally, so there is nothing to overwrite. The fake `gh` here WOULD report
  // the tag as published, so a guard that ran anyway would refuse.
  it('does not fire with --no-push, since nothing can be overwritten', () => {
    const r = buildAndPush(['--no-push'], { tags: [VERSION] });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/already published/i);
    expect(r.out).toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  // The lookup must page. openldr-api gains a version per pushed manifest, plus buildx's
  // untagged per-arch and attestation manifests, so a published tag leaves page 1 within a few
  // releases. A single-page lookup then reports "absent" and the guard permits the overwrite.
  it('still refuses when the published tag is past the first page of versions', () => {
    const older = Array.from({ length: 35 }, (_, i) => `0.0.${i + 1}`);
    const r = buildAndPush(['--platform', 'linux/amd64'], { tags: [...older, VERSION, '0.0.99'] });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already published/i);
    expect(r.out).not.toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  // ⛔ The tag list must not be piped into grep. `set -o pipefail` is on, and `grep -q` exits on
  // the first match, killing the writer with SIGPIPE; pipefail then reports the whole pipeline
  // as failed, a found tag reads as absent, and the guard permits the overwrite. It only bites
  // once the list exceeds the 64 KB pipe buffer, so 35 tags cannot catch it — this needs enough
  // output to fill the buffer, with the match early so grep exits while the writer still has
  // plenty left to write.
  it('still refuses with a tag list larger than the pipe buffer, matched early', () => {
    const many = Array.from({ length: 20000 }, (_, i) => `0.0.${i + 1}`);
    const r = buildAndPush(['--platform', 'linux/amd64'], { tags: [VERSION, ...many] });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already published/i);
    expect(r.out).not.toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  // Whole-line match: 0.1.0 is a substring of 0.1.10, and a substring match would refuse to
  // publish 0.1.0 because some later 0.1.10 exists.
  it('does not treat a longer tag that contains this version as a match', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], { tags: [`${VERSION}1`, `x${VERSION}`] });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });
});

describe('build-and-push.sh overwrite guard — gh failure handling', () => {
  // A 404 means the package does not exist yet: the tag is genuinely free (first release of a
  // new image). This must be a real push-mode run (not --dry-run, which skips the guard
  // entirely) so we can prove the script gets PAST the guard and reaches `docker buildx build`.
  // The fake `docker` on PATH makes that safe: no real image is ever built.
  it('treats a 404 from gh as "package does not exist yet" and proceeds', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], {
      exitCode: 1,
      stderr: 'gh: Not Found (HTTP 404)',
      probeExitCode: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/already published/i);
    expect(r.out).toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  // GitHub also answers 404 for a package that EXISTS but is invisible to an under-scoped
  // token. "Absent" and "invisible" are then the same reply, so believing the 404 fails open.
  // Only a token that can list the org's container packages at all can be believed.
  it('fails closed when a 404 arrives and the token cannot list the org\'s packages', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], {
      exitCode: 1,
      stderr: 'gh: Not Found (HTTP 404)',
      probeExitCode: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/read:packages/);
    expect(r.out).not.toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });

  // A 403 means we do not know whether the tag is published — the token just lacks
  // read:packages. An unknown must never be treated as "free": that is a silent guard disarm.
  it('fails closed on a 403 from gh, and names read:packages in the error', () => {
    const r = buildAndPush(['--platform', 'linux/amd64'], {
      exitCode: 1,
      stderr: 'gh: You need at least read:packages scope (HTTP 403)',
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/read:packages/);
    expect(r.out).not.toMatch(/FAKE-DOCKER-CALLED-WITH/);
  });
});

/** Source install/lib/resolve-version.sh and call resolve_version with `url`. */
function resolveVersion(url: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      BASH,
      ['-c', `source "${RESOLVE_VERSION_LIB}"; resolve_version "${url}"`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim() };
  }
}

/** Write a latest.json fixture and return a file:// URL curl can fetch with no network. */
function fixture(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'openldr-fixture-'));
  const file = join(dir, 'latest.json');
  writeFileSync(file, body);
  return pathToFileURL(file).href;
}

describe('resolve_version', () => {
  it('extracts the version from a well-formed manifest', () => {
    const url = fixture(
      '{\n  "version": "0.2.0",\n  "releasedAt": "2026-08-20",\n  "notesUrl": "https://example.org/x"\n}\n',
    );
    const r = resolveVersion(url);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('0.2.0');
  });

  it('handles a single-line manifest with no spaces', () => {
    const url = fixture('{"version":"1.10.3","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}');
    expect(resolveVersion(url).stdout).toBe('1.10.3');
  });

  // The version field is not always first; a naive grep of the first quoted value would take
  // releasedAt.
  it('takes the version field, not whichever field comes first', () => {
    const url = fixture('{"releasedAt":"2026-08-20","version":"0.3.1","notesUrl":"https://example.org/x"}');
    expect(resolveVersion(url).stdout).toBe('0.3.1');
  });

  it('fails when the URL cannot be fetched', () => {
    const r = resolveVersion('file:///definitely/not/here/latest.json');
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('fails on a manifest with no version field', () => {
    const url = fixture('{"releasedAt":"2026-08-20"}');
    const r = resolveVersion(url);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  // The moving tag must never satisfy the resolve — that is the whole point of the change.
  it('rejects a version that is not X.Y.Z', () => {
    const url = fixture('{"version":"latest","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}');
    const r = resolveVersion(url);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('rejects an empty version', () => {
    const url = fixture('{"version":"","releasedAt":"2026-08-20","notesUrl":"https://example.org/x"}');
    expect(resolveVersion(url).code).not.toBe(0);
  });
});
