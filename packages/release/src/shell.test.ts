import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = resolve(__dirname, '../../..');
const RESOLVE_VERSION_LIB = join(REPO, 'install/lib/resolve-version.sh').replace(/\\/g, '/');

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
  /** Text printed to stdout, e.g. the jq result on a successful call. */
  stdout?: string;
  /** Text printed to stderr, e.g. what `gh api` prints when it fails. */
  stderr?: string;
  /** Exit code for the fake `gh`. Defaults to 0 (success). */
  exitCode?: number;
}

/**
 * Run build-and-push.sh with a fake `gh` AND a fake `docker` first on PATH, so no network,
 * token, or real image build is ever involved — even in push-mode tests that get past the
 * overwrite guard. The fake `docker` just echoes its argv and exits 0.
 */
function buildAndPush(args: string[], gh: string | FakeGh): { code: number; out: string } {
  const opts: FakeGh = typeof gh === 'string' ? { stdout: gh } : gh;
  const bin = mkdtempSync(join(tmpdir(), 'openldr-fakebin-'));

  const ghPath = join(bin, 'gh');
  const ghLines = ['#!/usr/bin/env bash'];
  if (opts.stdout !== undefined) ghLines.push(`printf '%s\\n' '${opts.stdout}'`);
  if (opts.stderr !== undefined) ghLines.push(`printf '%s\\n' '${opts.stderr}' >&2`);
  ghLines.push(`exit ${opts.exitCode ?? 0}`);
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
    const r = buildAndPush(['--platform', 'linux/amd64'], '0');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/already published/i);
  });

  it('names --allow-overwrite in the refusal, so the escape hatch is discoverable', () => {
    expect(buildAndPush(['--platform', 'linux/amd64'], '0').out).toMatch(/--allow-overwrite/);
  });

  it('does not fire on a dry run', () => {
    const r = buildAndPush(['--dry-run'], '0');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/docker buildx build/);
  });

  // "absent" is what the jq `// "absent"` fallback yields when the tag is not in the list.
  it('proceeds when the tag is absent', () => {
    expect(buildAndPush(['--dry-run'], 'absent').code).toBe(0);
  });

  it('does not fire with --no-push, since nothing can be overwritten', () => {
    expect(buildAndPush(['--no-push', '--dry-run'], '0').code).toBe(0);
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
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/already published/i);
    expect(r.out).toMatch(/FAKE-DOCKER-CALLED-WITH/);
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
