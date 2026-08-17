import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(__dirname, '../../..');

/** Run build-and-push.sh with a fake `gh` first on PATH, so no network or token is involved. */
function buildAndPush(args: string[], ghStdout: string): { code: number; out: string } {
  const bin = mkdtempSync(join(tmpdir(), 'openldr-fakebin-'));
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/usr/bin/env bash\nprintf '%s\\n' '${ghStdout}'\n`);
  chmodSync(gh, 0o755);
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
