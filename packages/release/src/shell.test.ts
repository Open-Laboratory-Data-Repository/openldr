import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(__dirname, '../../..');

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
    const out = execFileSync('bash', [join(REPO, 'scripts/build-and-push.sh').replace(/\\/g, '/'), ...args], {
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
