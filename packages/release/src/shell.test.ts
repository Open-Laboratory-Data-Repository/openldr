import { describe, it, expect, afterAll } from 'vitest';
import { resolveGitBash } from './git-bash';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, existsSync, readdirSync, statSync, lstatSync, realpathSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = resolve(__dirname, '../../..');

/** Every temp dir the helpers below create, so afterAll can remove them.
 *
 *  ⛔ Nothing used to. Measured 2026-08-20: 1318 stale openldr-fakebin / openldr-fixture /
 *  openldr-install directories had piled up in the OS temp dir, one to two per test per run, going
 *  back weeks. The helpers hand back a command result or a file:// URL and never the path, so a
 *  caller cannot clean up after itself even if it wanted to. Tracking them here is the only place
 *  that can. */
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    // A leaked temp dir must never turn a green suite red. On Windows a fake bin can still be held
    // briefly by a just-exited child, and force already swallows a missing path.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** `C:\tmp\bin` -> `/c/tmp/bin`.
 *
 *  bash splits PATH on ':'. A Windows path carries its own colon after the drive letter, so
 *  prepending one raw yields the two useless entries `C` and `\tmp\bin` — every stub silently
 *  misses and the real binary runs. On non-Windows this is a no-op. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
}
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
  const bin = tempDir('openldr-fakebin-');

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

/**
 * Run install/install.sh with fake `docker`, `curl` and `openssl` on PATH, so nothing is
 * downloaded, no container starts, and the readiness probe can never succeed.
 *
 * The fake `curl` is the whole point: it SERVES the scaffold downloads (creating whatever `-o`
 * names) and FAILS every https://127.0.0.1 readiness probe. That is a stack that came up and
 * never became ready — the crash-looping-api case — without any container involved.
 *
 * Ports are deliberately high: install.sh refuses a fresh install when 80/443 are already
 * bound, and this test must not depend on what the machine is running.
 */
function installSh(
  args: string[],
  existingEnv?: string,
  extraEnv: Record<string, string> = {},
): { code: number; out: string; dir: string } {
  const bin = tempDir('openldr-fakebin-');
  const dir = join(tempDir('openldr-install-'), 'openldr');
  // A re-run: the installer adopts an .env it finds and never rewrites it whole.
  if (existingEnv !== undefined) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.env'), existingEnv);
  }

  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/usr/bin/env bash',
      // The preflight reads the Compose version. FAKE_COMPOSE_VERSION picks the answer.
      'if [ "$*" = "compose version --short" ]; then echo "${FAKE_COMPOSE_VERSION:-2.29.1}"; exit 0; fi',
      'echo "FAKE-DOCKER: $*"',
      // The local-install summary asks the api container for a setup code. FAKE_SETUP_CODE_ERROR
      // makes that call fail: a log line on stdout, then the given reason on stderr, exit 1.
      'case "$*" in *"auth setup-code --json"*)',
      '  if [ -n "${FAKE_SETUP_CODE_ERROR:-}" ]; then echo "an earlier log line"; echo "$FAKE_SETUP_CODE_ERROR" >&2; echo "" >&2; exit 1; fi',
      '  echo \'{ "setupCode": "TEST-CODE-0001", "validForMinutes": 30 }\' ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  // ⛔ Second line of defence. If the fake `docker` ever stops being found on PATH — measured
  // once, an MSYS PATH entry starting `C:/` splits at the drive-letter colon and the real
  // docker wins — this test would quietly `compose up` a real stack on the host. An
  // unreachable DOCKER_HOST turns that into install.sh's "Docker daemon is not running"
  // refusal instead: loud, immediate, and nothing started. The fake ignores it.
  const env = { ...process.env, DOCKER_HOST: 'tcp://127.0.0.1:1' };
  writeFileSync(
    join(bin, 'curl'),
    [
      '#!/usr/bin/env bash',
      '# Readiness probes hit the loopback gateway. Fail them: services never come up.',
      'for a in "$@"; do case "$a" in *127.0.0.1*) exit 7 ;; esac; done',
      '# Everything else is a scaffold download. Create whatever -o names and succeed.',
      'out=""',
      'prev=""',
      'for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done',
      'if [ -n "$out" ]; then mkdir -p "$(dirname "$out")"; : > "$out"; fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  // Cert generation is best-effort in install.sh (`|| true`); a failing openssl just warns.
  writeFileSync(join(bin, 'openssl'), '#!/usr/bin/env bash\nexit 1\n');
  for (const f of ['docker', 'curl', 'openssl']) chmodSync(join(bin, f), 0o755);

  try {
    const out = execFileSync(
      BASH,
      [
        join(REPO, 'install/install.sh').replace(/\\/g, '/'),
        '--dir', dir.replace(/\\/g, '/'),
        '--http-port', '18080',
        '--https-port', '18443',
        ...args,
      ],
      {
        cwd: REPO,
        encoding: 'utf8',
        env: {
          ...env,
          ...extraEnv,
          // ⛔ POSIX form, not `C:\...`. bash splits PATH on ':', and a Windows path splits at
          // its own drive-letter colon — `C:\tmp\bin` becomes the two entries `C` and `\tmp\bin`,
          // so the fake docker/curl are never found and the REAL ones run. Measured twice on this
          // branch: once it started real containers, once it hit raw.githubusercontent.com and
          // failed the gate on a 503 then a 429.
          PATH: `${toPosix(bin)}:${process.env.PATH ?? ''}`,
          // Belt and braces. Even if the PATH shim is defeated again, real curl then reads the
          // scaffold from this checkout instead of the network, so the gate never depends on
          // GitHub being up. install.sh defaults this to the public raw URL when unset.
          OPENLDR_REPO_RAW: `file:///${REPO.replace(/\\/g, '/')}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { code: 0, out, dir };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}`, dir };
  }
}

describe('install.sh readiness gate', () => {
  // ⛔ The default MUST stay non-fatal. Real labs rely on a slow first boot leaving the stack
  // up. This is also the exact behaviour that made `pnpm release` step 9 a no-op, which is why
  // the flag below exists rather than a change of default.
  it('warns and exits 0 when readiness times out, with no flag', () => {
    const r = installSh(['--ready-timeout', '1']);
    // Proves the fake docker was the one called, so nothing real was started.
    expect(r.out).toMatch(/FAKE-DOCKER: compose .* up -d/);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/api still starting/);
    expect(r.out).toMatch(/OpenLDR is starting/);
  }, 60_000);

  it('exits non-zero on the same timeout with --require-ready', () => {
    const r = installSh(['--ready-timeout', '1', '--require-ready']);
    expect(r.out).toMatch(/FAKE-DOCKER: compose .* up -d/);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/--require-ready/);
    expect(r.out).toMatch(/did not become ready/i);
    // The containers stay up on purpose — their logs are the evidence.
    expect(r.out).toMatch(/still running/i);
  }, 60_000);

  // Both of these skip the readiness gate entirely, so --require-ready would exit 0 having
  // proven nothing — a vacuous pass is the failure mode this flag exists to remove.
  it('refuses --require-ready with a disabled readiness wait', () => {
    const r = installSh(['--ready-timeout', '0', '--require-ready']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/nothing to wait for/i);
  }, 60_000);

  it('refuses --require-ready with --no-start', () => {
    const r = installSh(['--require-ready', '--no-start']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/--no-start/);
  }, 60_000);
});

// `depends_on` with `required: false` needs Compose 2.20 or later. An older Compose refuses the
// file the installer writes, for Keycloak installs too.
describe('install.sh Docker Compose version', () => {
  it('refuses 2.19.0 before writing anything', () => {
    const r = installSh(['--no-start'], undefined, { FAKE_COMPOSE_VERSION: '2.19.0' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Docker Compose 2.20 or later is needed. This machine has 2.19.0.');
    expect(existsSync(r.dir)).toBe(false);
  }, 60_000);

  it.each(['2.20.0', '5.4.0'])('accepts %s', (version) => {
    const r = installSh(['--no-start'], undefined, { FAKE_COMPOSE_VERSION: version });
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/is needed/);
    expect(r.out).not.toMatch(/Could not read the Docker Compose version/);
    expect(existsSync(join(r.dir, '.env'))).toBe(true);
  }, 60_000);

  it('lets a version it cannot read through with a one-line warning', () => {
    const r = installSh(['--no-start'], undefined, { FAKE_COMPOSE_VERSION: 'not-a-version' });
    expect(r.code).toBe(0);
    const warnings = r.out.split('\n').filter((l) => l.includes('Could not read the Docker Compose version'));
    expect(warnings).toEqual(["⚠ Could not read the Docker Compose version ('not-a-version'). It needs 2.20 or later. Continuing."]);
    expect(existsSync(join(r.dir, '.env'))).toBe(true);
  }, 60_000);
});

describe('install.sh storage keys', () => {
  it('writes Garage-format storage keys and points S3 at the storage service', () => {
    const r = installSh(['--no-start']);
    expect(r.code).toBe(0);
    const env = readFileSync(join(r.dir, '.env'), 'utf8');
    expect(env).toMatch(/^S3_ENDPOINT=http:\/\/storage:3900$/m);
    expect(env).toMatch(/^S3_ACCESS_KEY_ID=GK[0-9a-f]{24}$/m);
    expect(env).toMatch(/^S3_SECRET_ACCESS_KEY=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^GARAGE_RPC_SECRET=[0-9a-f]{64}$/m);
    expect(env).toMatch(/^GARAGE_ADMIN_TOKEN=[0-9a-f]{64}$/m);
  }, 60_000);
});

/** Keys of an .env, in file order. */
function envKeys(text: string): string[] {
  return text.split(/\r?\n/).map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(l)?.[1]).filter((k): k is string => !!k);
}

function envValue(text: string, key: string): string | undefined {
  return new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1];
}

// Every key install.sh wrote for a Postgres-target install before local sign-in existed.
const KEYS_BEFORE_LOCAL_SIGN_IN = [
  'OPENLDR_VERSION', 'SERVER_NAME', 'PUBLIC_ORIGIN', 'GATEWAY_HTTP_PORT', 'GATEWAY_HTTPS_PORT',
  'COMPOSE_PROJECT_NAME', 'TLS_MODE', 'PORT', 'NODE_ENV', 'TRUST_PROXY', 'INTERNAL_DATABASE_URL',
  'TARGET_STORE_ADAPTER', 'TARGET_DATABASE_URL', 'POSTGRES_PASSWORD', 'S3_ENDPOINT', 'S3_REGION',
  'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_FORCE_PATH_STYLE', 'GARAGE_RPC_SECRET',
  'GARAGE_ADMIN_TOKEN', 'OIDC_ISSUER_URL', 'OIDC_INTERNAL_JWKS_URL', 'OIDC_INTERNAL_ISSUER_URL',
  'OIDC_WEB_CLIENT_ID', 'KC_HOSTNAME', 'KEYCLOAK_ADMIN', 'KEYCLOAK_ADMIN_PASSWORD',
  'KEYCLOAK_ADMIN_CLIENT_ID', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'INITIAL_LAB_ADMIN_PASSWORD',
  'TLS_CERT_PATH', 'NODE_EXTRA_CA_CERTS', 'SECRETS_ENCRYPTION_KEY', 'MIGRATE_ON_START',
  'SEED_ON_START', 'LETSENCRYPT_EMAIL', 'MARKETPLACE_REGISTRY_URL',
];
const KEYCLOAK_ONLY_KEY = /^(OIDC_|KC_|KEYCLOAK_|INITIAL_LAB_ADMIN_PASSWORD$)/;

// The shape of an .env written by an installer from before this change: no AUTH_ADAPTER line
// (so the server defaults to Keycloak) and no COMPOSE_PROFILES line.
const ENV_BEFORE_LOCAL_SIGN_IN = [
  'SERVER_NAME=localhost',
  'PUBLIC_ORIGIN=https://localhost:18443',
  'GATEWAY_HTTP_PORT=18080',
  'GATEWAY_HTTPS_PORT=18443',
  'OIDC_ISSUER_URL=https://localhost:18443/auth/realms/openldr',
  'KC_HOSTNAME=https://localhost:18443/auth',
  'KEYCLOAK_ADMIN_PASSWORD=kept-admin-password',
  'KEYCLOAK_ADMIN_CLIENT_SECRET=kept-client-secret',
  'INITIAL_LAB_ADMIN_PASSWORD=kept-lab-password',
  'SECRETS_ENCRYPTION_KEY=a2VwdC1rZXkta2VwdC1rZXkta2VwdC1rZXkta2VwdC0=',
  '',
].join('\n');

describe('install.sh sign-in mode', () => {
  it('defaults to local sign-in and writes no Keycloak settings', () => {
    const r = installSh(['--no-start']);
    expect(r.code).toBe(0);
    const env = readFileSync(join(r.dir, '.env'), 'utf8');
    const expected = [...KEYS_BEFORE_LOCAL_SIGN_IN.filter((k) => !KEYCLOAK_ONLY_KEY.test(k)), 'AUTH_ADAPTER'];
    expect(envKeys(env).sort()).toEqual(expected.sort());
    expect(envValue(env, 'AUTH_ADAPTER')).toBe('local');
    expect(envValue(env, 'SECRETS_ENCRYPTION_KEY')).toMatch(/^.{40,}$/);
  }, 60_000);

  it('with --auth keycloak writes the same keys as before, plus the mode and the keycloak profile', () => {
    const r = installSh(['--no-start', '--auth', 'keycloak']);
    expect(r.code).toBe(0);
    const env = readFileSync(join(r.dir, '.env'), 'utf8');
    expect(envKeys(env).sort()).toEqual([...KEYS_BEFORE_LOCAL_SIGN_IN, 'AUTH_ADAPTER', 'COMPOSE_PROFILES'].sort());
    expect(envValue(env, 'AUTH_ADAPTER')).toBe('keycloak');
    expect(envValue(env, 'COMPOSE_PROFILES')).toBe('keycloak');
    expect(envValue(env, 'OIDC_ISSUER_URL')).toBe('https://localhost:18443/auth/realms/openldr');
    expect(envValue(env, 'OIDC_INTERNAL_JWKS_URL')).toBe('http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs');
    expect(envValue(env, 'OIDC_INTERNAL_ISSUER_URL')).toBe('http://keycloak:8080/auth/realms/openldr');
    expect(envValue(env, 'OIDC_WEB_CLIENT_ID')).toBe('openldr-web');
    expect(envValue(env, 'KC_HOSTNAME')).toBe('https://localhost:18443/auth');
    expect(envValue(env, 'KEYCLOAK_ADMIN')).toBe('admin');
    expect(envValue(env, 'KEYCLOAK_ADMIN_CLIENT_ID')).toBe('openldr-admin');
    for (const k of ['KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'INITIAL_LAB_ADMIN_PASSWORD']) {
      expect(envValue(env, k)).toMatch(/^[A-Za-z0-9]{24}$/);
    }
  }, 60_000);

  it('local: starts without Keycloak, does not wait for it, and prints a setup code', () => {
    const r = installSh(['--ready-timeout', '1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/FAKE-DOCKER: compose -f docker-compose\.yml up -d/);
    expect(r.out).not.toMatch(/--profile keycloak/);
    expect(r.out).not.toMatch(/keycloak realm/);
    // Only the fake docker answers `auth setup-code --json` with this code, so seeing it proves
    // the installer asked the api container through the ./openldr wrapper.
    expect(r.out).toMatch(/Setup code: TEST-CODE-0001/);
    expect(r.out).toMatch(/valid for 30 minutes/);
    expect(r.out).not.toMatch(/Keycloak admin password/);
    expect(r.out).not.toMatch(/labadmin/);
    // Success prints no reason line.
    expect(r.out).not.toMatch(/Reason:/);
  }, 60_000);

  it('local: when no setup code comes back, prints the last line of the reason and no more', () => {
    const r = installSh(['--ready-timeout', '1'], undefined, {
      FAKE_SETUP_CODE_ERROR: 'auth setup-code failed: database is not migrated',
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Could not get a setup code yet/);
    expect(r.out).toMatch(/^ {2}Reason: auth setup-code failed: database is not migrated$/m);
    expect(r.out).not.toMatch(/an earlier log line/);
    expect(r.out).not.toMatch(/Setup code:/);
  }, 60_000);

  it('keycloak: starts with the keycloak profile and still waits for the realm', () => {
    const r = installSh(['--auth', 'keycloak', '--ready-timeout', '1']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/FAKE-DOCKER: compose -f docker-compose\.yml --profile keycloak up -d/);
    expect(r.out).toMatch(/keycloak realm still starting/);
    expect(r.out).toMatch(/Keycloak admin password/);
    expect(r.out).not.toMatch(/setup-code/);
  }, 60_000);

  // An install made before this change has no AUTH_ADAPTER line, so it runs Keycloak. The new
  // compose file starts Keycloak only under its profile, so a re-run must turn the profile on and
  // touch nothing else.
  it('a re-run on an install from before this change keeps Keycloak running', () => {
    const r = installSh(['--no-start'], ENV_BEFORE_LOCAL_SIGN_IN);
    expect(r.code).toBe(0);
    const env = readFileSync(join(r.dir, '.env'), 'utf8');
    expect(env).toBe(`${ENV_BEFORE_LOCAL_SIGN_IN}COMPOSE_PROFILES=keycloak\n`);
  }, 60_000);

  it('refuses to move an existing install to another sign-in mode', () => {
    const toKeycloak = installSh(['--no-start', '--auth', 'keycloak'], 'AUTH_ADAPTER=local\n');
    expect(toKeycloak.code).toBe(2);
    expect(toKeycloak.out).toMatch(/not supported/);
    const toLocal = installSh(['--no-start', '--auth', 'local'], ENV_BEFORE_LOCAL_SIGN_IN);
    expect(toLocal.code).toBe(2);
    expect(toLocal.out).toMatch(/not supported/);
  }, 60_000);

  it('rejects a sign-in mode it does not install', () => {
    const r = installSh(['--no-start', '--auth', 'oidc']);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/--auth must be 'local' or 'keycloak'/);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// The ./openldr wrapper install.sh writes, run for real with `sh` against a fake `docker`.
//
// The wrapper text is taken out of install.sh, so these tests run what an install gets. The fake
// `docker` records each call in its own folder: the arguments one per line, the OPENLDR_* settings
// it was given, and what came in on standard input. Nothing here starts a container: the fake is
// first on PATH, and DOCKER_HOST points nowhere in case it ever is not.
//
// Skipped on Windows: the wrapper's file modes and `id` call are Linux and macOS behaviour, and
// Git Bash cannot show a 0600 file (unproven on Windows and macOS).
// ---------------------------------------------------------------------------------------------

const INSTALL_SH = readFileSync(join(REPO, 'install/install.sh'), 'utf8');

/** The text between `<<'TAG'` and the closing TAG line in install.sh. */
function heredoc(tag: string): string {
  const m = new RegExp(`<<'${tag}'\\n([\\s\\S]*?)\\n${tag}\\n`).exec(INSTALL_SH);
  if (!m) throw new Error(`no <<'${tag}' heredoc in install/install.sh`);
  return `${m[1]}\n`;
}

// Made-up values.
const W_KEY = 'oldr_TESTKEYwrapperTESTKEYwrapperTESTKEYwrapp';
const W_PASSWORD = ' pw-Wrapper 1 ';
const W_SESSION = '{"version":1,"sessions":{"http://127.0.0.1:3000":{"cookie":{"name":"openldr_session","value":"sidW.cookieSecretWRAPPER1"},"username":"alice","savedAt":"2026-11-13T00:00:00.000Z"}}}';
const W_COOKIE = 'sidW.cookieSecretWRAPPER1';
const SETTINGS = ['OPENLDR_KEY', 'OPENLDR_KEY_FILE', 'OPENLDR_SESSION', 'OPENLDR_URL', 'OPENLDR_ALLOW_PLAIN_HTTP', 'MSYS_NO_PATHCONV'];

/** What the fake docker saw on one call. */
interface DockerCall { args: string[]; env: Record<string, string>; stdin: string; cwd: string }

interface RunOpts {
  env?: Record<string, string>; input?: string; stdout?: string; exit?: number;
  /** Options for `sh` itself, such as -x. */
  shArgs?: string[];
  /** The folder the wrapper is run from; the temporary work folder by default. */
  cwd?: string;
  /** Run this instead of `sh <wrapper>`, for example ['./openldr'] or ['sh', 'openldr']. */
  command?: string[];
  /** A folder put first on PATH, before the fake docker's. */
  pathFirst?: string;
  /** Another install folder's wrapper, from install(); the first one by default. */
  wrapper?: string;
}
interface RunResult { code: number; stdout: string; stderr: string; calls: DockerCall[] }

interface WrapperHost {
  root: string; home: string; work: string; tmp: string;
  /** The first install's wrapper and the session file it keeps. */
  wrapper: string;
  sessionFile: string;
  /** The session folder every install shares: ~/.config/openldr/docker. */
  sessionDir: string;
  /** Another install folder under the same home. */
  install(name: string): { wrapper: string; sessionFile: string };
  run(args: string[], opts?: RunOpts): RunResult;
  /** The wrapper's environment for one run, for a test that starts it itself. */
  envFor(opts?: RunOpts): Record<string, string>;
  calls(): DockerCall[];
  resetCalls(): void;
}

/** The session file a wrapper in `folder` keeps: a cksum of the folder's real path, as the wrapper
 *  works it out, so this checks the wrapper's naming rather than copying it. */
function sessionFileOf(home: string, folder: string): string {
  const sum = spawnSync('cksum', [], { input: realpathSync(folder), encoding: 'utf8' }).stdout.trim().split(/\s+/);
  return join(home, '.config', 'openldr', 'docker', `${sum[0]}-${sum[1]}.json`);
}

function wrapperHost(): WrapperHost {
  const root = tempDir('openldr-wrapper-');
  const dirs = { bin: join(root, 'bin'), rec: join(root, 'rec'), home: join(root, 'home'), work: join(root, 'work'), tmp: join(root, 'tmp') };
  for (const d of Object.values(dirs)) mkdirSync(d);
  const install = (name: string) => {
    const folder = join(root, name);
    mkdirSync(folder);
    const wrapper = join(folder, 'openldr');
    writeFileSync(wrapper, heredoc('WRAPPER'));
    chmodSync(wrapper, 0o755);
    // What makes a folder an install, to the wrapper, as to --wrapper-only.
    writeFileSync(join(folder, 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(join(folder, '.env'), 'OPENLDR_VERSION=0.1.8\n');
    return { wrapper, sessionFile: sessionFileOf(dirs.home, folder) };
  };
  const first = install('w');
  // One file per argument, so an argument that holds a newline is recorded whole.
  writeFileSync(
    join(dirs.bin, 'docker'),
    [
      '#!/bin/sh',
      'n=$(ls "$FAKE_REC" | wc -l | tr -d " ")',
      'd="$FAKE_REC/call$n"',
      'mkdir "$d"',
      'pwd -P > "$d/cwd"',
      'i=0',
      'for a in "$@"; do printf %s "$a" > "$d/arg.$i"; i=$((i + 1)); done',
      `for v in ${SETTINGS.join(' ')}; do`,
      '  eval "if [ -n \\"\\${$v+x}\\" ]; then printf %s \\"\\$$v\\" > \\"\\$d/env.$v\\"; fi"',
      'done',
      'cat > "$d/stdin"',
      'if [ -n "${FAKE_STDOUT:-}" ]; then printf "%s\\n" "$FAKE_STDOUT"; fi',
      'exit "${FAKE_EXIT:-0}"',
      '',
    ].join('\n'),
  );
  chmodSync(join(dirs.bin, 'docker'), 0o755);
  const calls = (): DockerCall[] =>
    readdirSync(dirs.rec).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))).map((c) => {
      const d = join(dirs.rec, c);
      const env: Record<string, string> = {};
      const args: string[] = [];
      for (const f of readdirSync(d)) {
        if (f.startsWith('env.')) env[f.slice(4)] = readFileSync(join(d, f), 'utf8');
        if (f.startsWith('arg.')) args[Number(f.slice(4))] = readFileSync(join(d, f), 'utf8');
      }
      return { args, env, stdin: readFileSync(join(d, 'stdin'), 'utf8'), cwd: readFileSync(join(d, 'cwd'), 'utf8').trim() };
    });
  const resetCalls = () => {
    rmSync(dirs.rec, { recursive: true, force: true });
    mkdirSync(dirs.rec);
  };
  // A clean environment: no real OPENLDR_* or XDG_CONFIG_HOME from the machine running the tests.
  const envFor = (opts: RunOpts = {}): Record<string, string> => ({
    PATH: `${opts.pathFirst ? `${opts.pathFirst}:` : ''}${dirs.bin}:${process.env.PATH ?? ''}`,
    HOME: dirs.home,
    TMPDIR: dirs.tmp,
    DOCKER_HOST: 'tcp://127.0.0.1:1',
    FAKE_REC: dirs.rec,
    ...(opts.stdout !== undefined ? { FAKE_STDOUT: opts.stdout } : {}),
    ...(opts.exit !== undefined ? { FAKE_EXIT: String(opts.exit) } : {}),
    ...opts.env,
  });
  return {
    root, home: dirs.home, work: dirs.work, tmp: dirs.tmp,
    wrapper: first.wrapper,
    sessionFile: first.sessionFile,
    sessionDir: join(dirs.home, '.config', 'openldr', 'docker'),
    install,
    envFor,
    calls,
    resetCalls,
    run(args, opts = {}) {
      resetCalls();
      const argv = opts.command ?? ['sh', ...(opts.shArgs ?? []), opts.wrapper ?? first.wrapper];
      const r = spawnSync(argv[0]!, [...argv.slice(1), ...args], {
        cwd: opts.cwd ?? dirs.work, encoding: 'utf8', input: opts.input ?? '', env: envFor(opts), timeout: 20_000,
      });
      return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, calls: calls() };
    },
  };
}

/** Writes a stored session for this host's first install, as login would. */
function storeSession(h: WrapperHost, text = `${W_SESSION}\n`): void {
  mkdirSync(h.sessionDir, { recursive: true, mode: 0o700 });
  chmodSync(join(h.home, '.config', 'openldr'), 0o700);
  chmodSync(h.sessionDir, 0o700);
  writeFileSync(h.sessionFile, text, { mode: 0o600 });
}

const UID_GID = platform() === 'win32' ? '' : `${process.getuid?.()}:${process.getgid?.()}`;
/** Everything the wrapper puts before the CLI's own arguments, with these `-e` names. */
const prefix = (...names: string[]) => [
  'compose', 'exec', '-T', ...names.flatMap((n) => ['-e', n]), '-u', UID_GID, '-w', '/', 'api', 'node', '/app/cli/dist/index.js',
];

/** The wrapper's refusal when its folder is not an install. */
const notInstall = (folder: string) =>
  `This script must stay in its install folder, or be a link to it. ${realpathSync(folder)} has no .env or no docker-compose.yml.\n`;

const onPath = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
/** sh's own path, for a run whose PATH does not hold it. */
const SH_PATH = platform() === 'win32' ? '' : onPath('sh').stdout.trim();
/** The shells a test runs the wrapper under: sh (dash on Debian and Ubuntu), bash, and busybox sh
 *  where it is installed. */
const SHELLS: [string, string[]][] = [
  ['sh', ['sh']],
  ['bash', [BASH]],
  ...(platform() !== 'win32' && onPath('busybox').status === 0 ? [['busybox sh', ['busybox', 'sh']] as [string, string[]]] : []),
];

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push(`${r}/`); walk(join(d, e.name), r); } else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

describe.skipIf(platform() === 'win32')('the ./openldr wrapper', () => {
  it('passes every other command through unchanged, spaces and all, with its exit code and input', () => {
    const h = wrapperHost();
    const args = ['ingest', 'data/my file.json', '--note', 'a "quoted" $HOME * word', ''];
    const r = h.run(args, { input: 'piped input\n', exit: 3 });
    expect(r.code).toBe(3);
    expect(r.calls).toHaveLength(1);
    // Nothing set: exactly the call the wrapper made before sign-in existed.
    expect(r.calls[0]!.args).toEqual([...prefix(), ...args]);
    expect(r.calls[0]!.stdin).toBe('piped input\n');
    expect(r.calls[0]!.env.MSYS_NO_PATHCONV).toBe('1');
  });

  it('hands OPENLDR_KEY in by name, never as an argument', () => {
    const h = wrapperHost();
    const r = h.run(['report', 'list', '--json'], { env: { OPENLDR_KEY: W_KEY } });
    expect(r.code).toBe(0);
    expect(r.calls[0]!.args).toEqual([...prefix('OPENLDR_KEY'), 'report', 'list', '--json']);
    expect(r.calls[0]!.env.OPENLDR_KEY).toBe(W_KEY);
    expect(r.calls[0]!.args.join(' ')).not.toContain(W_KEY);
    expect(r.stdout + r.stderr).not.toContain(W_KEY);
  });

  it('hands OPENLDR_URL and OPENLDR_ALLOW_PLAIN_HTTP in by name when they are set', () => {
    const h = wrapperHost();
    const r = h.run(['health'], { env: { OPENLDR_URL: 'http://lab.example:3000', OPENLDR_ALLOW_PLAIN_HTTP: 'true' } });
    expect(r.calls[0]!.args).toEqual([...prefix('OPENLDR_URL', 'OPENLDR_ALLOW_PLAIN_HTTP'), 'health']);
    expect(r.calls[0]!.env.OPENLDR_URL).toBe('http://lab.example:3000');
  });

  it('reads OPENLDR_KEY_FILE on the host and hands the key in as OPENLDR_KEY', () => {
    const h = wrapperHost();
    const keyFile = join(h.root, 'key.txt');
    writeFileSync(keyFile, `${W_KEY}\n`);
    const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: keyFile } });
    expect(r.code).toBe(0);
    expect(r.calls[0]!.args).toEqual([...prefix('OPENLDR_KEY'), 'report', 'list']);
    expect(r.calls[0]!.env.OPENLDR_KEY).toBe(W_KEY);
    expect(r.calls[0]!.args.join(' ')).not.toContain(W_KEY);
    expect(r.stdout + r.stderr).not.toContain(W_KEY);
  });

  it('stops on a key file that is missing, empty or not named, and never falls through to a session', () => {
    const h = wrapperHost();
    storeSession(h);
    const missing = join(h.root, 'no-such-key');
    const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: missing } });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(`The key file named by OPENLDR_KEY_FILE cannot be read: ${missing}\n`);
    expect(r.calls).toEqual([]);

    const empty = join(h.root, 'empty-key');
    writeFileSync(empty, ' \n');
    const e = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: empty } });
    expect(e.code).toBe(1);
    expect(e.stderr).toBe(`The key file named by OPENLDR_KEY_FILE is empty: ${empty}\n`);
    expect(e.calls).toEqual([]);

    const unnamed = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: '' } });
    expect(unnamed.code).toBe(1);
    expect(unnamed.stderr).toBe('OPENLDR_KEY_FILE is set but empty. Set it, or unset it.\n');
    expect(unnamed.calls).toEqual([]);
  });

  it('login without a terminal pipes the password in and keeps the session line owner-only', () => {
    const h = wrapperHost();
    const r = h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION, env: { OPENLDR_KEY: W_KEY } });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    // A key is not handed to login, and the client is told to print the session, not keep it.
    expect(r.calls[0]!.args).toEqual([...prefix(), 'login', '--username', 'alice', '--password-stdin', '--session-out']);
    expect(r.calls[0]!.stdin).toBe(`${W_PASSWORD}\n`);
    expect(r.calls[0]!.args.join(' ')).not.toContain(W_PASSWORD.trim());

    expect(readFileSync(h.sessionFile, 'utf8')).toBe(`${W_SESSION}\n`);
    expect(statSync(h.sessionFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(h.home, '.config', 'openldr')).mode & 0o777).toBe(0o700);
    expect(statSync(h.sessionDir).mode & 0o777).toBe(0o700);
    // The session line is kept, not shown.
    expect(r.stdout + r.stderr).not.toContain(W_COOKIE);
    // No temporary file is left beside it, and no session.json is made.
    expect(filesUnder(h.home)).toEqual([
      '.config/', '.config/openldr/', '.config/openldr/docker/', `.config/openldr/docker/${h.sessionFile.split('/').at(-1)}`,
    ]);
  });

  it('login keeps the session under XDG_CONFIG_HOME when it is set', () => {
    const h = wrapperHost();
    const cfg = join(h.home, 'cfg');
    const r = h.run(['login', '--username=alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION, env: { XDG_CONFIG_HOME: cfg } });
    expect(r.code).toBe(0);
    expect(r.calls[0]!.args).toEqual([...prefix(), 'login', '--username=alice', '--password-stdin', '--session-out']);
    expect(readFileSync(join(cfg, 'openldr', 'docker', h.sessionFile.split('/').at(-1)!), 'utf8')).toBe(`${W_SESSION}\n`);
  });

  it('login handles --server-url before the command and hands the address on', () => {
    const h = wrapperHost();
    const r = h.run(['--server-url', 'http://127.0.0.1:3999', 'login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION });
    expect(r.code).toBe(0);
    expect(r.calls[0]!.args).toEqual([
      ...prefix(), '--server-url', 'http://127.0.0.1:3999', 'login', '--username', 'alice', '--password-stdin', '--session-out',
    ]);
    expect(existsSync(h.sessionFile)).toBe(true);
  });

  it('a failed login stores nothing and keeps the session already stored', () => {
    const h = wrapperHost();
    const failed = h.run(['login', '--username', 'alice'], { input: 'wrong\n', stdout: W_SESSION, exit: 1 });
    expect(failed.code).toBe(1);
    expect(existsSync(join(h.home, '.config'))).toBe(false);

    const silent = h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n` });
    expect(silent.code).toBe(1);
    expect(silent.stderr).toContain('nothing was stored');
    expect(existsSync(join(h.home, '.config'))).toBe(false);

    expect(h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION }).code).toBe(0);
    expect(h.run(['login', '--username', 'alice'], { input: 'wrong\n', stdout: 'other', exit: 1 }).code).toBe(1);
    expect(readFileSync(h.sessionFile, 'utf8')).toBe(`${W_SESSION}\n`);
  });

  it('login without a terminal needs --username, and asks the container nothing', () => {
    const h = wrapperHost();
    const r = h.run(['login'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--username');
    expect(r.calls).toEqual([]);
    expect(existsSync(join(h.home, '.config'))).toBe(false);
  });

  it('login --help is passed through and stores nothing', () => {
    const h = wrapperHost();
    const r = h.run(['login', '--help'], { stdout: 'Usage: openldr login' });
    expect(r.code).toBe(0);
    expect(r.calls[0]!.args).toEqual([...prefix(), 'login', '--help']);
    expect(existsSync(join(h.home, '.config'))).toBe(false);
  });

  it('a later command hands the stored session in by name', () => {
    const h = wrapperHost();
    expect(h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION }).code).toBe(0);
    const r = h.run(['report', 'list']);
    expect(r.calls[0]!.args).toEqual([...prefix('OPENLDR_SESSION'), 'report', 'list']);
    expect(r.calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    expect(r.calls[0]!.args.join(' ')).not.toContain(W_COOKIE);

    // A key comes first, and then the session is not handed in at all.
    const k = h.run(['report', 'list'], { env: { OPENLDR_KEY: W_KEY } });
    expect(k.calls[0]!.args).toEqual([...prefix('OPENLDR_KEY'), 'report', 'list']);
    expect(k.calls[0]!.env.OPENLDR_SESSION).toBeUndefined();
  });

  it('logout hands the session in and removes the file even when the client fails', () => {
    const h = wrapperHost();
    expect(h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION }).code).toBe(0);
    const r = h.run(['logout'], { exit: 1 });
    expect(r.code).toBe(1);
    expect(r.calls[0]!.args).toEqual([...prefix('OPENLDR_SESSION'), 'logout']);
    expect(r.calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    expect(existsSync(h.sessionFile)).toBe(false);

    // With nothing stored, the client still answers.
    const again = h.run(['logout']);
    expect(again.code).toBe(0);
    expect(again.calls[0]!.args).toEqual([...prefix(), 'logout']);
  });

  it('writes nothing outside the temporary home', () => {
    const h = wrapperHost();
    const keyFile = join(h.root, 'key.txt');
    writeFileSync(keyFile, W_KEY);
    h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION });
    h.run(['report', 'list']);
    h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: keyFile } });
    h.run(['logout']);
    expect(filesUnder(h.work)).toEqual([]);
    expect(filesUnder(h.tmp)).toEqual([]);
    expect(filesUnder(h.home)).toEqual(['.config/', '.config/openldr/', '.config/openldr/docker/']);
  });

  it('passes an argument that holds a newline through whole', () => {
    const h = wrapperHost();
    const r = h.run(['report', 'run', '--param', 'note=line one\nline two']);
    expect(r.calls[0]!.args).toEqual([...prefix(), 'report', 'run', '--param', 'note=line one\nline two']);
  });

  it('keeps a separate session for each install folder under one home', () => {
    const h = wrapperHost();
    const b = h.install('second-install');
    expect(b.sessionFile).not.toBe(h.sessionFile);
    const sessionB = W_SESSION.replace('WRAPPER1', 'WRAPPERB');
    expect(h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION }).code).toBe(0);
    expect(h.run(['login', '--username', 'bob'], { input: `${W_PASSWORD}\n`, stdout: sessionB, wrapper: b.wrapper }).code).toBe(0);
    // Signing in to B did not replace A's session.
    expect(h.run(['report', 'list']).calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    expect(h.run(['report', 'list'], { wrapper: b.wrapper }).calls[0]!.env.OPENLDR_SESSION).toBe(sessionB);
    // Signing out of B leaves A signed in.
    expect(h.run(['logout'], { wrapper: b.wrapper }).code).toBe(0);
    expect(existsSync(b.sessionFile)).toBe(false);
    expect(h.run(['report', 'list']).calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
  });

  it("never reads or writes a native client's session.json", () => {
    const h = wrapperHost();
    const native = join(h.home, '.config', 'openldr', 'session.json');
    mkdirSync(join(h.home, '.config', 'openldr'), { recursive: true, mode: 0o700 });
    const marker = '{"version":1,"sessions":{"https://lab.example":{"cookie":{"name":"n","value":"nativeMARKER"},"username":"x","savedAt":"x"}}}\n';
    writeFileSync(native, marker, { mode: 0o600 });
    expect(h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION }).code).toBe(0);
    const later = h.run(['report', 'list']);
    expect(later.calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    expect(h.run(['logout']).code).toBe(0);
    // With no session of its own left, nothing of the native file is handed in.
    expect(h.run(['report', 'list']).calls[0]!.env.OPENLDR_SESSION).toBeUndefined();
    expect(readFileSync(native, 'utf8')).toBe(marker);
    expect(statSync(native).mode & 0o777).toBe(0o600);
  });

  describe('refuses a stored session the CLI would refuse, and calls docker zero times', () => {
    const refused = (h: WrapperHost, message: string) => {
      for (const args of [['report', 'list'], ['whoami']]) {
        const r = h.run(args);
        expect(r.code).toBe(1);
        expect(r.stderr).toBe(`${message}\n`);
        expect(r.calls).toEqual([]);
      }
    };

    it('a file group or others can read', () => {
      const h = wrapperHost();
      storeSession(h);
      chmodSync(h.sessionFile, 0o644);
      refused(h, `Other users can read or change the session file ${h.sessionFile}, so it is not used. Remove it and sign in again.`);
    });

    it('a link, even to a readable file', () => {
      const h = wrapperHost();
      storeSession(h);
      const elsewhere = join(h.root, 'other.json');
      writeFileSync(elsewhere, 'some other file\n', { mode: 0o600 });
      rmSync(h.sessionFile);
      symlinkSync(elsewhere, h.sessionFile);
      refused(h, `The session file ${h.sessionFile} is a link, so it is not used. Remove it and sign in again.`);
    });

    it('something that is not a plain file', () => {
      const h = wrapperHost();
      storeSession(h);
      rmSync(h.sessionFile);
      mkdirSync(h.sessionFile, { mode: 0o700 });
      refused(h, `The session file ${h.sessionFile} is not a plain file, so it is not used. Remove it and sign in again.`);
    });

    it('a folder group or others can read', () => {
      const h = wrapperHost();
      storeSession(h);
      chmodSync(h.sessionDir, 0o755);
      refused(h, `Other users can read or change the session folder ${h.sessionDir}, so it is not used. Remove it and sign in again.`);
    });

    it('a folder that is a link', () => {
      const h = wrapperHost();
      const real = join(h.root, 'real-folder');
      mkdirSync(real, { mode: 0o700 });
      writeFileSync(join(real, h.sessionFile.split('/').at(-1)!), `${W_SESSION}\n`, { mode: 0o600 });
      mkdirSync(join(h.home, '.config', 'openldr'), { recursive: true, mode: 0o700 });
      symlinkSync(real, h.sessionDir);
      refused(h, `The session folder ${h.sessionDir} is a link, so it is not used. Remove it and sign in again.`);
    });

    it.skipIf(process.getuid?.() === 0)('a file that cannot be read', () => {
      const h = wrapperHost();
      storeSession(h);
      chmodSync(h.sessionFile, 0o200);
      refused(h, `The session file ${h.sessionFile} cannot be read, so it is not used. Remove it and sign in again.`);
    });

    it('a file over 64 KiB, which would fail at exec', () => {
      const h = wrapperHost();
      storeSession(h, `${'x'.repeat(65537)}\n`);
      refused(h, `The session file ${h.sessionFile} is too large, so it is not used. Remove it and sign in again.`);
    });
  });

  describe('logout with a stored session it refuses', () => {
    it('removes the file unused, calls docker zero times, and says the session was not ended', () => {
      const h = wrapperHost();
      storeSession(h);
      chmodSync(h.sessionFile, 0o644);
      const r = h.run(['logout']);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(
        `Other users can read or change the session file ${h.sessionFile}, so it was removed without being used. ` +
        "The session on the server was not ended. It ends by itself after 12 idle hours. Changing the account's password ends its other sessions.\n",
      );
      expect(r.calls).toEqual([]);
      expect(existsSync(h.sessionFile)).toBe(false);
    });

    it('says so when the file could not be removed, through a linked folder', () => {
      const h = wrapperHost();
      const real = join(h.root, 'real-folder');
      mkdirSync(real, { mode: 0o700 });
      const inside = join(real, h.sessionFile.split('/').at(-1)!);
      writeFileSync(inside, `${W_SESSION}\n`, { mode: 0o600 });
      mkdirSync(join(h.home, '.config', 'openldr'), { recursive: true, mode: 0o700 });
      symlinkSync(real, h.sessionDir);
      const r = h.run(['logout']);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(`The session folder ${h.sessionDir} is a link, so it was not used, and it could not be removed. Remove it yourself.\n`);
      expect(r.calls).toEqual([]);
      // The file the link leads to is left alone.
      expect(readFileSync(inside, 'utf8')).toBe(`${W_SESSION}\n`);
    });
  });

  it('runs docker from its own install folder, wherever it is called from', () => {
    const h = wrapperHost();
    const b = h.install('install-b');
    const aFolder = realpathSync(join(h.root, 'w'));
    // B has a session of its own, which A's wrapper must never hand in.
    const B_MARKER = W_SESSION.replace('WRAPPER1', 'BMARKER1');
    mkdirSync(h.sessionDir, { recursive: true, mode: 0o700 });
    writeFileSync(b.sessionFile, `${B_MARKER}\n`, { mode: 0o600 });
    // A's wrapper, called from inside B's folder, uses A's stack. A has no session, so none goes in.
    const r = h.run(['report', 'list'], { cwd: join(h.root, 'install-b') });
    expect(r.calls[0]!.cwd).toBe(aFolder);
    expect(r.calls[0]!.env.OPENLDR_SESSION).toBeUndefined();
    // A key file named relative to where the caller stood is still found.
    writeFileSync(join(h.work, 'key.txt'), `${W_KEY}\n`);
    const k = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: 'key.txt' } });
    expect(k.code).toBe(0);
    expect(k.calls[0]!.env.OPENLDR_KEY).toBe(W_KEY);
    expect(k.calls[0]!.cwd).toBe(aFolder);
    // login and logout too: A's session is stored, handed in and removed, and B's is never touched.
    const inB = { cwd: join(h.root, 'install-b') };
    expect(h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION, ...inB }).calls[0]!.cwd).toBe(aFolder);
    expect(readFileSync(h.sessionFile, 'utf8')).toBe(`${W_SESSION}\n`);
    const out = h.run(['logout'], inB);
    expect(out.calls[0]!.cwd).toBe(aFolder);
    expect(out.calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    expect(existsSync(h.sessionFile)).toBe(false);
    expect(readFileSync(b.sessionFile, 'utf8')).toBe(`${B_MARKER}\n`);
  });

  // Ruling 77. This replaces a test that pinned the session to the link's own folder, which broke
  // every link to the wrapper from a folder on PATH.
  describe('finds its install folder however it is run', () => {
    /** A host whose first install (folder `w`) has a stored session, and a folder of links. */
    const setup = () => {
      const h = wrapperHost();
      storeSession(h);
      const links = join(h.root, 'links');
      mkdirSync(links);
      return { h, links, install: realpathSync(join(h.root, 'w')) };
    };
    const usedInstall = (r: RunResult, install: string) => {
      expect(r.code).toBe(0);
      expect(r.calls).toHaveLength(1);
      expect(r.calls[0]!.cwd).toBe(install);
      expect(r.calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    };

    it('./openldr, from the install folder', () => {
      const { h, install } = setup();
      usedInstall(h.run(['report', 'list'], { command: ['./openldr'], cwd: install }), install);
    });

    it('an absolute path, from elsewhere', () => {
      const { h, install } = setup();
      usedInstall(h.run(['report', 'list'], { command: [join(install, 'openldr')] }), install);
    });

    it('sh openldr, from the install folder', () => {
      const { h, install } = setup();
      usedInstall(h.run(['report', 'list'], { command: ['sh', 'openldr'], cwd: install }), install);
    });

    it('a link in another folder, run from the install folder and from elsewhere', () => {
      const { h, links, install } = setup();
      symlinkSync(h.wrapper, join(links, 'openldr'));
      usedInstall(h.run(['report', 'list'], { command: [join(links, 'openldr')], cwd: install }), install);
      usedInstall(h.run(['report', 'list'], { command: [join(links, 'openldr')] }), install);
    });

    it('a link found on PATH', () => {
      const { h, links, install } = setup();
      symlinkSync(h.wrapper, join(links, 'openldr'));
      usedInstall(h.run(['report', 'list'], { command: ['openldr'], pathFirst: links }), install);
    });

    it('a relative link', () => {
      const { h, links, install } = setup();
      symlinkSync('../w/openldr', join(links, 'openldr'));
      usedInstall(h.run(['report', 'list'], { command: [join(links, 'openldr')] }), install);
    });

    it('a link to a link', () => {
      const { h, links, install } = setup();
      symlinkSync(h.wrapper, join(links, 'first'));
      const outer = join(h.root, 'outer');
      mkdirSync(outer);
      symlinkSync('../links/first', join(outer, 'openldr'));
      usedInstall(h.run(['report', 'list'], { command: [join(outer, 'openldr')] }), install);
    });

    it('two links in one folder to two installs use two sessions', () => {
      const { h, links, install } = setup();
      const b = h.install('install-b');
      const B_MARKER = W_SESSION.replace('WRAPPER1', 'BMARKER1');
      writeFileSync(b.sessionFile, `${B_MARKER}\n`, { mode: 0o600 });
      symlinkSync(h.wrapper, join(links, 'openldr-a'));
      symlinkSync(b.wrapper, join(links, 'openldr-b'));
      usedInstall(h.run(['report', 'list'], { command: [join(links, 'openldr-a')] }), install);
      const rb = h.run(['report', 'list'], { command: [join(links, 'openldr-b')] });
      expect(rb.calls[0]!.cwd).toBe(realpathSync(join(h.root, 'install-b')));
      expect(rb.calls[0]!.env.OPENLDR_SESSION).toBe(B_MARKER);
    });

    it('a loop of links ends, and stops with the install-folder message', () => {
      const { h, links } = setup();
      symlinkSync(join(links, 'loop-b'), join(links, 'loop-a'));
      symlinkSync(join(links, 'loop-a'), join(links, 'loop-b'));
      // `sh -c <text> <name>` sets $0 to <name>, so $0 can be a loop that no shell could open.
      const started = Date.now();
      const r = h.run(['report', 'list'], { command: ['sh', '-c', heredoc('WRAPPER'), join(links, 'loop-a')] });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(notInstall(links));
      expect(r.calls).toEqual([]);
    });

    it('a copy in a folder with no compose file stops, naming the folder, and hands nothing in', () => {
      const { h, links } = setup();
      const copy = join(links, 'openldr');
      writeFileSync(copy, heredoc('WRAPPER'), { mode: 0o755 });
      const r = h.run(['report', 'list'], { command: [copy] });
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(notInstall(links));
      expect(r.calls).toEqual([]);
    });

    // A copy in another project's folder that has a compose file of its own would otherwise run
    // `docker compose exec api` there and hand an exported key to it.
    it('a copy in a folder with a compose file and no .env stops, and hands nothing in', () => {
      const { h, links } = setup();
      writeFileSync(join(links, 'docker-compose.yml'), 'services: {}\n');
      const copy = join(links, 'openldr');
      writeFileSync(copy, heredoc('WRAPPER'), { mode: 0o755 });
      const r = h.run(['report', 'list'], { command: [copy], env: { OPENLDR_KEY: W_KEY } });
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(notInstall(links));
      expect(r.calls).toEqual([]);
    });

    it('a copy in a folder with a .env and no compose file stops, and hands nothing in', () => {
      const { h, links } = setup();
      writeFileSync(join(links, '.env'), 'SOMETHING=else\n');
      const copy = join(links, 'openldr');
      writeFileSync(copy, heredoc('WRAPPER'), { mode: 0o755 });
      const r = h.run(['report', 'list'], { command: [copy], env: { OPENLDR_KEY: W_KEY } });
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(notInstall(links));
      expect(r.calls).toEqual([]);
    });

    // `ln -sr` makes a relative link like this one. Its `..` must be taken on disk, from the folder the
    // link really is in, not by text from the linked folder it was reached through.
    describe.each(SHELLS)('a relative link reached through a linked folder, under %s', (_name, shell) => {
      /** <root>/a/b/u/bin is a link to <root>/opt/deep/bin, which holds openldr -> ../../../instA/openldr.
       *  By text, a/b/u/bin/../../.. is <root>/a. On disk, opt/deep/bin/../../.. is <root>. */
      const layout = () => {
        const { h } = setup();
        mkdirSync(join(h.root, 'opt', 'deep', 'bin'), { recursive: true });
        mkdirSync(join(h.root, 'a', 'b', 'u'), { recursive: true });
        symlinkSync(join(h.root, 'opt', 'deep', 'bin'), join(h.root, 'a', 'b', 'u', 'bin'));
        const a = h.install('instA');
        symlinkSync('../../../instA/openldr', join(h.root, 'opt', 'deep', 'bin', 'openldr'));
        const A_MARKER = W_SESSION.replace('WRAPPER1', 'AMARKER1');
        writeFileSync(a.sessionFile, `${A_MARKER}\n`, { mode: 0o600 });
        return { h, A_MARKER, link: join(h.root, 'a', 'b', 'u', 'bin', 'openldr'), instA: realpathSync(join(h.root, 'instA')) };
      };

      it('runs the install the link leads to', () => {
        const { h, A_MARKER, link, instA } = layout();
        const r = h.run(['report', 'list'], { command: [...shell, link] });
        expect(r.stderr).toBe('');
        expect(r.code).toBe(0);
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0]!.cwd).toBe(instA);
        expect(r.calls[0]!.env.OPENLDR_SESSION).toBe(A_MARKER);
      });

      it('and not the install the text of the path leads to', () => {
        const { h, A_MARKER, link, instA } = layout();
        const decoy = h.install('a/instA');
        const DECOY_MARKER = W_SESSION.replace('WRAPPER1', 'DECOYMK1');
        writeFileSync(decoy.sessionFile, `${DECOY_MARKER}\n`, { mode: 0o600 });
        const r = h.run(['report', 'list'], { command: [...shell, link] });
        expect(r.code).toBe(0);
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0]!.cwd).toBe(instA);
        expect(r.calls[0]!.env.OPENLDR_SESSION).toBe(A_MARKER);
      });
    });

    it('with no readlink on PATH, says only its own message', () => {
      const { h, links } = setup();
      symlinkSync(h.wrapper, join(links, 'openldr'));
      // A PATH of the tools the wrapper uses, without readlink.
      const tools = join(h.root, 'tools');
      mkdirSync(tools);
      for (const t of ['dirname', 'cksum', 'ls', 'cat', 'wc', 'tr', 'id', 'head']) {
        const at = spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
        symlinkSync(at, join(tools, t));
      }
      const r = h.run(['report', 'list'], { command: [SH_PATH, join(links, 'openldr')], env: { PATH: `${join(h.root, 'bin')}:${tools}` } });
      expect(r.code).toBe(1);
      // readlink is missing, so the loop stops at the link, whose folder is not an install.
      expect(r.stderr).toBe(notInstall(links));
      expect(r.calls).toEqual([]);
    });
  });

  it('after a failed login, says what a --session-out refusal means', () => {
    const h = wrapperHost();
    const r = h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, exit: 1 });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('If the message names --session-out, the images are older than this wrapper. Upgrade them first.\n');
  });

  it('a login it cannot store ends that session on the server', () => {
    const h = wrapperHost();
    // The folder the session goes in cannot be made.
    mkdirSync(join(h.home, '.config'));
    mkdirSync(join(h.home, '.config', 'openldr'), { mode: 0o500 });
    try {
      const r = h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: W_SESSION });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(`Cannot write the session file ${h.sessionFile}, so the session was ended.`);
      expect(r.calls).toHaveLength(2);
      expect(r.calls[1]!.args).toEqual([...prefix('OPENLDR_SESSION'), 'logout']);
      expect(r.calls[1]!.env.OPENLDR_SESSION).toBe(W_SESSION);
      expect(r.calls[1]!.args.join(' ')).not.toContain(W_COOKIE);
    } finally {
      chmodSync(join(h.home, '.config', 'openldr'), 0o700);
    }
  });

  it('a login whose answer is not a session stores nothing', () => {
    const h = wrapperHost();
    const r = h.run(['login', '--username', 'alice'], { input: `${W_PASSWORD}\n`, stdout: 'Signed in, but this is not a session' });
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('The sign-in gave an answer this script did not expect, so nothing was stored.\n');
    expect(existsSync(join(h.home, '.config'))).toBe(false);
  });

  it('a temporary file left by an earlier run with the same process id does not end a good login', async () => {
    const h = wrapperHost();
    h.resetCalls();
    storeSession(h, 'old\n');
    // The fake docker waits for standard input to end, so the stale file is in place before the
    // wrapper reaches the store. $$ in the wrapper is this child's process id.
    const child = spawn('sh', [h.wrapper, 'login', '--username', 'alice'], { cwd: h.work, env: h.envFor({ stdout: W_SESSION }) });
    const stale = join(h.sessionDir, `.${h.sessionFile.split('/').at(-1)}.${child.pid}.tmp`);
    writeFileSync(stale, 'left over\n', { mode: 0o600 });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    const code = await new Promise<number | null>((done) => { child.on('close', done); child.stdin.end(`${W_PASSWORD}\n`); });
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(h.calls()).toHaveLength(1);
    expect(readFileSync(h.sessionFile, 'utf8')).toBe(`${W_SESSION}\n`);
    expect(existsSync(stale)).toBe(false);
  });

  it('logout --help is passed through and keeps the session', () => {
    const h = wrapperHost();
    storeSession(h);
    const r = h.run(['logout', '--help'], { stdout: 'Usage: openldr logout' });
    expect(r.code).toBe(0);
    // Help runs like any other command: the session is handed in, and nothing is removed.
    expect(r.calls[0]!.args).toEqual([...prefix('OPENLDR_SESSION'), 'logout', '--help']);
    expect(readFileSync(h.sessionFile, 'utf8')).toBe(`${W_SESSION}\n`);
  });

  it('turns tracing off, so sh -x prints no password, session or key', () => {
    const h = wrapperHost();
    const keyFile = join(h.root, 'key.txt');
    writeFileSync(keyFile, `${W_KEY}\n`);
    const runs = [
      h.run(['login', '--username', 'alice'], { shArgs: ['-x'], input: `${W_PASSWORD}\n`, stdout: W_SESSION }),
      h.run(['report', 'list'], { shArgs: ['-x'] }),
      h.run(['report', 'list'], { shArgs: ['-x'], env: { OPENLDR_KEY_FILE: keyFile } }),
      h.run(['logout'], { shArgs: ['-x'] }),
    ];
    // The session was stored and handed in, and the key reached docker: tracing off changed nothing else.
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0, 0]);
    expect(runs[1]!.calls[0]!.env.OPENLDR_SESSION).toBe(W_SESSION);
    expect(runs[2]!.calls[0]!.env.OPENLDR_KEY).toBe(W_KEY);
    for (const r of runs) {
      expect(r.stderr).toContain('Tracing is off: this script handles a password and keys.');
      for (const secret of [W_PASSWORD.trim(), W_COOKIE, W_KEY]) expect(r.stdout + r.stderr, secret).not.toContain(secret);
    }
  });

  describe('key file checks, as the CLI makes them', () => {
    it('drops a trailing carriage return and newline, and blanks around the key', () => {
      const h = wrapperHost();
      for (const text of [`${W_KEY}\r\n`, `\n  ${W_KEY} \n\n`]) {
        const keyFile = join(h.root, 'key.txt');
        writeFileSync(keyFile, text);
        const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: keyFile } });
        expect(r.code).toBe(0);
        expect(r.calls[0]!.env.OPENLDR_KEY).toBe(W_KEY);
      }
    });

    it('refuses a file over 4096 bytes, naming it', () => {
      const h = wrapperHost();
      const keyFile = join(h.root, 'big-key.txt');
      writeFileSync(keyFile, 'k'.repeat(4097));
      const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: keyFile } });
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(`The key file named by OPENLDR_KEY_FILE is too large to hold a key: ${keyFile}\n`);
      expect(r.calls).toEqual([]);
    });

    it('checks the size of a key read from a named pipe too, which has no size before it is read', () => {
      const h = wrapperHost();
      const fifo = join(h.root, 'key.fifo');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      // A background printf writes the pipe while the wrapper reads it.
      const viaPipe = (text: string) => {
        h.resetCalls();
        const r = spawnSync('sh', ['-c', 'printf %s "$FAKE_KEY_TEXT" > "$1" & exec sh "$2" report list', 'sh', fifo, h.wrapper], {
          cwd: h.work, encoding: 'utf8', input: '',
          env: h.envFor({ env: { OPENLDR_KEY_FILE: fifo, FAKE_KEY_TEXT: text } }),
        });
        return { code: r.status, stderr: r.stderr, calls: h.calls() };
      };
      const big = viaPipe('k'.repeat(4097));
      expect(big.stderr).toBe(`The key file named by OPENLDR_KEY_FILE is too large to hold a key: ${fifo}\n`);
      expect(big.code).toBe(1);
      expect(big.calls).toEqual([]);
      const ok = viaPipe(`${W_KEY}\n`);
      expect(ok.code).toBe(0);
      expect(ok.calls[0]!.env.OPENLDR_KEY).toBe(W_KEY);
    });

    it('reads at most 4097 bytes, so /dev/zero is refused rather than read forever', () => {
      const h = wrapperHost();
      const started = Date.now();
      const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: '/dev/zero' } });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe('The key file named by OPENLDR_KEY_FILE is too large to hold a key: /dev/zero\n');
      expect(r.calls).toEqual([]);
    });

    it('refuses a lone carriage return inside the key as more than one line', () => {
      const h = wrapperHost();
      const keyFile = join(h.root, 'cr-key.txt');
      writeFileSync(keyFile, `${W_KEY}\r${W_KEY}\n`);
      const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: keyFile } });
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(`The key file named by OPENLDR_KEY_FILE holds more than one line: ${keyFile}\n`);
      expect(r.calls).toEqual([]);
    });

    it('refuses a file with more than one line, naming it', () => {
      const h = wrapperHost();
      const keyFile = join(h.root, 'two-keys.txt');
      writeFileSync(keyFile, `${W_KEY}\r\n${W_KEY}\n`);
      const r = h.run(['report', 'list'], { env: { OPENLDR_KEY_FILE: keyFile } });
      expect(r.code).toBe(1);
      expect(r.stderr).toBe(`The key file named by OPENLDR_KEY_FILE holds more than one line: ${keyFile}\n`);
      expect(r.calls).toEqual([]);
    });
  });
});

/**
 * install.sh --wrapper-only, run for real with bash against a temporary install folder. A fake
 * `curl` and `wget` record any call, so the test can show nothing was downloaded; a fake `docker`
 * records any call too.
 */
function wrapperOnly(
  args: string[], folder: (dir: string) => void,
  how: {
    piped?: 'sh' | 'bash'; uname?: string; staleTempFolder?: boolean;
    /** The shell that runs the installer file; bash by default. */
    shell?: 'sh' | 'bash';
    /** More fake tools: name to script text, with {dir} and {rec} filled in. */
    tools?: Record<string, string>;
  } = {},
): { code: number; out: string; dir: string; cwd: string; called: string[] } {
  const root = tempDir('openldr-wrapper-only-');
  const bin = join(root, 'bin');
  const dir = join(root, 'install');
  const cwd = join(root, 'cwd');
  const rec = join(root, 'rec');
  for (const d of [bin, dir, cwd, rec]) mkdirSync(d);
  folder(dir);
  for (const tool of ['curl', 'wget', 'docker']) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${rec}/called"\nexit 1\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  // A fake uname, to make the installer write openldr.ps1 as it does under Git Bash.
  if (how.uname) {
    writeFileSync(join(bin, 'uname'), `#!/bin/sh\necho ${how.uname}\n`);
    chmodSync(join(bin, 'uname'), 0o755);
  }
  for (const [tool, text] of Object.entries(how.tools ?? {})) {
    writeFileSync(join(bin, tool), text.replaceAll('{dir}', dir).replaceAll('{rec}', rec), { mode: 0o755 });
  }
  const installer = join(REPO, 'install/install.sh').replace(/\\/g, '/');
  const words = args.map((a) => a.replace('{dir}', dir));
  // Piped, as the docs show it: `curl ... | bash -s -- --wrapper-only --dir .`, from a local copy.
  const [cmd, argv, input] = how.piped
    ? [how.piped === 'sh' ? 'sh' : BASH, ['-s', '--', ...words], readFileSync(installer, 'utf8')]
    : how.staleTempFolder
      ? ['sh', ['-c', 'd=$1; shift; mkdir -- "$d/.openldr.$$.tmp" && exec "$@"', 'sh', dir, BASH, installer, ...words], '']
      : [how.shell === 'sh' ? 'sh' : BASH, [installer, ...words], ''];
  const r = spawnSync(cmd, argv, {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, PATH: `${toPosix(bin)}:${process.env.PATH ?? ''}`, DOCKER_HOST: 'tcp://127.0.0.1:1', OPENLDR_REPO_RAW: 'file:///nowhere' },
  });
  const called = existsSync(join(rec, 'called')) ? readFileSync(join(rec, 'called'), 'utf8').trim().split('\n') : [];
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}`, dir, cwd, called };
}

describe.skipIf(platform() === 'win32')('install.sh --wrapper-only', () => {
  const ENV_MARKER = 'OPENLDR_VERSION=0.1.8\nAUTH_ADAPTER=local\n# kept as is\n';
  const COMPOSE_MARKER = 'services:\n  api:\n    image: kept-as-is\n';
  const GARAGE_MARKER = '# a local edit that must survive\n';
  const install = (dir: string) => {
    writeFileSync(join(dir, '.env'), ENV_MARKER);
    writeFileSync(join(dir, 'docker-compose.yml'), COMPOSE_MARKER);
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config', 'garage.toml'), GARAGE_MARKER);
    writeFileSync(join(dir, 'openldr'), '#!/bin/sh\nexec docker compose exec -T api node /app/cli/dist/index.js "$@"\n', { mode: 0o644 });
  };

  it('replaces the wrapper, makes it executable, and changes nothing else', () => {
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], install);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Rewrote the openldr wrapper in ${r.dir}. Nothing else was changed.`);
    expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(heredoc('WRAPPER'));
    expect(statSync(join(r.dir, 'openldr')).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(r.dir, '.env'), 'utf8')).toBe(ENV_MARKER);
    expect(readFileSync(join(r.dir, 'docker-compose.yml'), 'utf8')).toBe(COMPOSE_MARKER);
    expect(readFileSync(join(r.dir, 'config', 'garage.toml'), 'utf8')).toBe(GARAGE_MARKER);
    expect(filesUnder(r.dir)).toEqual(['.env', 'config/', 'config/garage.toml', 'docker-compose.yml', 'openldr']);
    // Nothing downloaded, and Docker never asked.
    expect(r.called).toEqual([]);
  });

  it('refuses without --dir, and makes no install folder', () => {
    const r = wrapperOnly(['--wrapper-only'], install);
    expect(r.code).toBe(2);
    expect(r.out).toContain('--wrapper-only needs --dir <the install folder>');
    expect(filesUnder(r.cwd)).toEqual([]);
    expect(r.called).toEqual([]);
  });

  it('refuses a folder that is not an OpenLDR install', () => {
    const noCompose = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => writeFileSync(join(dir, '.env'), ENV_MARKER));
    expect(noCompose.code).toBe(2);
    expect(noCompose.out).toContain(`${noCompose.dir} is not an OpenLDR install folder: it has no .env or no docker-compose.yml.`);
    expect(filesUnder(noCompose.dir)).toEqual(['.env']);
    const empty = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], () => {});
    expect(empty.code).toBe(2);
    expect(filesUnder(empty.dir)).toEqual([]);
    expect([...noCompose.called, ...empty.called]).toEqual([]);
  });

  it.each(['sh', 'bash'] as const)('works piped into %s -s, as the docs show it', (piped) => {
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], install, { piped });
    expect(r.code).toBe(0);
    expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(heredoc('WRAPPER'));
    expect(readFileSync(join(r.dir, '.env'), 'utf8')).toBe(ENV_MARKER);
    expect(filesUnder(r.dir)).toEqual(['.env', 'config/', 'config/garage.toml', 'docker-compose.yml', 'openldr']);
    expect(r.called).toEqual([]);
  });

  it('refuses any other option, naming it', () => {
    for (const extra of [['--auth', 'bogus'], ['--no-start'], ['--version', '9.9.9']]) {
      const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}', ...extra], install);
      expect(r.code).toBe(2);
      expect(r.out).toContain(`--wrapper-only takes no other option than --dir (got ${extra[0]}).`);
      expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).not.toBe(heredoc('WRAPPER'));
      expect(r.called).toEqual([]);
    }
  });

  it('replaces a read-only wrapper', () => {
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      chmodSync(join(dir, 'openldr'), 0o444);
    });
    expect(r.code).toBe(0);
    expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(heredoc('WRAPPER'));
    expect(statSync(join(r.dir, 'openldr')).mode & 0o111).not.toBe(0);
  });

  it('replaces a linked wrapper with a real file and leaves the target alone', () => {
    let target = '';
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      target = join(dir, '..', 'elsewhere.txt');
      writeFileSync(target, 'marker: not a wrapper\n', { mode: 0o640 });
      rmSync(join(dir, 'openldr'));
      symlinkSync(target, join(dir, 'openldr'));
    });
    expect(r.code).toBe(0);
    expect(lstatSync(join(r.dir, 'openldr')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(heredoc('WRAPPER'));
    expect(readFileSync(target, 'utf8')).toBe('marker: not a wrapper\n');
    expect(statSync(target).mode & 0o777).toBe(0o640);
  });

  it.skipIf(process.getuid?.() === 0)('a failed write leaves the old wrapper as it was and no temporary file', () => {
    const OLD = '#!/bin/sh\nexec docker compose exec -T api node /app/cli/dist/index.js "$@"\n';
    let dirOf = '';
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      dirOf = dir;
      chmodSync(dir, 0o555);
    });
    try {
      expect(r.code).toBe(1);
      expect(r.out).toContain(`Could not write ${r.dir}/openldr. The wrapper that was there is unchanged.`);
      expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(OLD);
      expect(filesUnder(r.dir)).toEqual(['.env', 'config/', 'config/garage.toml', 'docker-compose.yml', 'openldr']);
    } finally {
      chmodSync(dirOf, 0o755);
    }
  });

  it('replaces a link to a folder with a real file, and writes nothing into that folder', () => {
    let target = '';
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      target = join(dir, '..', 'a-folder');
      mkdirSync(target);
      rmSync(join(dir, 'openldr'));
      symlinkSync(target, join(dir, 'openldr'));
    });
    expect(r.code).toBe(0);
    expect(lstatSync(join(r.dir, 'openldr')).isFile()).toBe(true);
    expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(heredoc('WRAPPER'));
    expect(readdirSync(target)).toEqual([]);
  });

  // The fake rm and mv below are found on PATH under sh (dash here) and bash. busybox sh runs its own
  // rm and mv as built-ins and never looks on PATH, so these tests prove nothing about busybox.
  const REAL_RM = platform() === 'win32' ? '' : onPath('rm').stdout.trim();
  /** An rm that refuses, and records, any call that names the wrapper. Any other call goes to rm. */
  const RM_GUARD = [
    '#!/bin/sh',
    'for a in "$@"; do',
    '  if [ "$a" = "{dir}/openldr" ]; then echo "rm $*" >> "{rec}/called"; exit 1; fi',
    'done',
    `exec '${REAL_RM}' "$@"`,
    '',
  ].join('\n');
  const MV_FAILS = '#!/bin/sh\necho "mv $*" >> "{rec}/called"\nexit 1\n';
  const INSTALL_FILES = ['.env', 'config/', 'config/garage.toml', 'docker-compose.yml', 'openldr'];

  describe.each(['sh', 'bash'] as const)('when the old wrapper is a link, under %s', (shell) => {
    it.each(['a file', 'nothing'] as const)('a link to %s is replaced by the rename alone, never removed first', (to) => {
      let target = '';
      const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
        install(dir);
        target = join(dir, '..', 'elsewhere.txt');
        if (to === 'a file') writeFileSync(target, 'marker: not a wrapper\n');
        rmSync(join(dir, 'openldr'));
        symlinkSync(target, join(dir, 'openldr'));
      }, { shell, tools: { rm: RM_GUARD } });
      expect(r.called).toEqual([]);
      expect(r.code).toBe(0);
      expect(lstatSync(join(r.dir, 'openldr')).isFile()).toBe(true);
      expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).toBe(heredoc('WRAPPER'));
      if (to === 'a file') expect(readFileSync(target, 'utf8')).toBe('marker: not a wrapper\n');
      else expect(existsSync(target)).toBe(false);
      expect(filesUnder(r.dir)).toEqual(INSTALL_FILES);
    });

    it('a failed rename after removing a link to a folder keeps the new wrapper and says where it is', () => {
      let target = '';
      const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
        install(dir);
        target = join(dir, '..', 'a-folder');
        mkdirSync(target);
        rmSync(join(dir, 'openldr'));
        symlinkSync(target, join(dir, 'openldr'));
      }, { shell, tools: { mv: MV_FAILS } });
      expect(r.code).toBe(1);
      const temps = readdirSync(r.dir).filter((f) => /^\.openldr\.\d+\.tmp$/.test(f));
      expect(temps).toHaveLength(1);
      const temp = join(r.dir, temps[0]!);
      expect(readFileSync(temp, 'utf8')).toBe(heredoc('WRAPPER'));
      expect(r.out).toContain(
        `Could not write ${r.dir}/openldr. The link that was there was removed. The new wrapper is in ${temp}. Rename it to ${r.dir}/openldr.`,
      );
      expect(r.out).not.toContain('unchanged');
      expect(() => lstatSync(join(r.dir, 'openldr'))).toThrow();
      expect(readdirSync(target)).toEqual([]);
      expect(r.called).toEqual([`mv -f ${temp} ${r.dir}/openldr`]);
    });

    it('a link to a folder that cannot be removed stops with the could-not-write message and keeps the link', () => {
      let target = '';
      const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
        install(dir);
        target = join(dir, '..', 'a-folder');
        mkdirSync(target);
        rmSync(join(dir, 'openldr'));
        symlinkSync(target, join(dir, 'openldr'));
      }, { shell, tools: { rm: RM_GUARD } });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`Could not write ${r.dir}/openldr. The wrapper that was there is unchanged.`);
      expect(r.out).not.toContain('Rewrote the openldr wrapper');
      expect(lstatSync(join(r.dir, 'openldr')).isSymbolicLink()).toBe(true);
      expect(readdirSync(target)).toEqual([]);
      // The temporary file is gone.
      expect(filesUnder(r.dir)).toEqual(INSTALL_FILES);
      expect(r.called).toEqual([`rm -f ${r.dir}/openldr`]);
    });
  });

  it('refuses a real folder named openldr, writes nothing into it, and leaves no temporary file', () => {
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      rmSync(join(dir, 'openldr'));
      mkdirSync(join(dir, 'openldr'));
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${r.dir}/openldr is a folder, not the wrapper. Remove or rename it, then run the installer again.`);
    expect(r.out).not.toContain('Rewrote the openldr wrapper');
    expect(readdirSync(join(r.dir, 'openldr'))).toEqual([]);
    expect(filesUnder(r.dir)).toEqual(['.env', 'config/', 'config/garage.toml', 'docker-compose.yml', 'openldr/']);
  });

  it('a stale folder with the temporary file\'s name stops with the could-not-write message', () => {
    // The temporary name holds the installer's process id. A shell makes the folder under its own $$
    // and then execs the installer, which keeps that process id.
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], install, { staleTempFolder: true });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`Could not write ${r.dir}/openldr. The wrapper that was there is unchanged.`);
    expect(r.out).not.toContain('Is a directory');
    expect(readFileSync(join(r.dir, 'openldr'), 'utf8')).not.toBe(heredoc('WRAPPER'));
  });

  it('replaces a link to a folder named openldr.ps1 the same way where it writes one', () => {
    let target = '';
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      target = join(dir, '..', 'a-ps1-folder');
      mkdirSync(target);
      symlinkSync(target, join(dir, 'openldr.ps1'));
    }, { uname: 'MINGW64_NT-10.0-19045' });
    expect(r.code).toBe(0);
    expect(lstatSync(join(r.dir, 'openldr.ps1')).isFile()).toBe(true);
    expect(readFileSync(join(r.dir, 'openldr.ps1'), 'utf8')).toBe(heredoc('PSWRAPPER'));
    expect(readdirSync(target)).toEqual([]);
  });

  it('replaces a linked openldr.ps1 the same way where it writes one', () => {
    let target = '';
    const r = wrapperOnly(['--wrapper-only', '--dir', '{dir}'], (dir) => {
      install(dir);
      target = join(dir, '..', 'elsewhere.ps1');
      writeFileSync(target, 'marker\n', { mode: 0o640 });
      symlinkSync(target, join(dir, 'openldr.ps1'));
    }, { uname: 'MINGW64_NT-10.0-19045' });
    expect(r.code).toBe(0);
    expect(lstatSync(join(r.dir, 'openldr.ps1')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(r.dir, 'openldr.ps1'), 'utf8')).toBe(heredoc('PSWRAPPER'));
    expect(readFileSync(target, 'utf8')).toBe('marker\n');
    expect(statSync(target).mode & 0o777).toBe(0o640);
    expect(filesUnder(r.dir)).toEqual(['.env', 'config/', 'config/garage.toml', 'docker-compose.yml', 'openldr', 'openldr.ps1']);
  });
});

describe('the openldr.ps1 wrapper (unproven: nothing here runs PowerShell)', () => {
  const fromSh = heredoc('PSWRAPPER');
  const ps1 = readFileSync(join(REPO, 'install/install.ps1'), 'utf8');
  const fromPs1 = (() => {
    const m = /\$wrapper = @'\r?\n([\s\S]*?)\r?\n'@/.exec(ps1);
    if (!m) throw new Error("no $wrapper = @' here-string in install/install.ps1");
    return `${m[1]!.replace(/\r\n/g, '\n')}\n`;
  })();

  it('is the same text in install.sh and install.ps1', () => {
    expect(fromSh).toBe(fromPs1);
  });

  it('hands the key, the address and the plain-HTTP setting in by name, and keeps the fixed path', () => {
    for (const name of ['OPENLDR_KEY', 'OPENLDR_URL', 'OPENLDR_ALLOW_PLAIN_HTTP']) expect(fromSh).toContain(`'${name}'`);
    expect(fromSh).toContain('docker compose exec -T @pass -w / api node /app/cli/dist/index.js $args');
    expect(fromSh).not.toMatch(/\$env:OPENLDR_KEY\b/);
  });

  it('answers login with one line about access keys and exit 1', () => {
    expect(fromSh).toContain('On Windows the CLI signs in with an access key. Set it in OPENLDR_KEY.');
    expect(fromSh).toMatch(/'login'[\s\S]*?exit 1/);
  });

  it('stops when OPENLDR_KEY_FILE is set and OPENLDR_KEY is not, before docker runs', () => {
    const check = fromSh.indexOf('(Test-Path Env:OPENLDR_KEY_FILE) -and -not (Test-Path Env:OPENLDR_KEY)');
    expect(check).toBeGreaterThan(-1);
    const rest = fromSh.slice(check);
    expect(rest).toMatch(/^[^\n]*\n {2}\[Console\]::Error\.WriteLine\('OPENLDR_KEY_FILE is not read on Windows\. Set OPENLDR_KEY\.'\)\n {2}exit 1\n/m);
    expect(check).toBeLessThan(fromSh.indexOf('docker compose exec'));
  });

  // A copy in another project's folder would otherwise run `docker compose exec api` there and hand
  // an exported OPENLDR_KEY to that project's api. Read, not run: nothing here runs PowerShell.
  it('stops with the sh wrapper\'s message when it is not beside a .env and a docker-compose.yml, before docker runs', () => {
    const shMessage = /say "(This script must stay in its install folder, or be a link to it\. \$here has no \.env or no docker-compose\.yml\.)"/.exec(heredoc('WRAPPER'));
    expect(shMessage).not.toBeNull();
    const check = fromSh.indexOf("(Test-Path -LiteralPath (Join-Path $here '.env') -PathType Leaf)");
    expect(check).toBeGreaterThan(-1);
    expect(fromSh.slice(check)).toContain("-not (Test-Path -LiteralPath (Join-Path $here 'docker-compose.yml') -PathType Leaf)");
    expect(fromSh.slice(check)).toMatch(new RegExp(`^[^\\n]*\\n {2}\\[Console\\]::Error\\.WriteLine\\("${shMessage![1]!.replace(/[.$()]/g, '\\$&')}"\\)\\n {2}exit 1\\n`, 'm'));
    expect(fromSh.indexOf('$here = $PSScriptRoot')).toBeLessThan(check);
    expect(check).toBeLessThan(fromSh.indexOf('docker compose exec'));
  });

  it('runs docker from its own folder and puts the caller\'s folder back after', () => {
    const go = fromSh.indexOf('Set-Location -LiteralPath $here');
    const docker = fromSh.indexOf('docker compose exec');
    expect(fromSh.indexOf('$caller = Get-Location')).toBeLessThan(go);
    expect(go).toBeGreaterThan(-1);
    expect(go).toBeLessThan(docker);
    // The way back is in a finally, so it runs however docker ends.
    expect(fromSh.slice(go)).toMatch(/try \{\n[\s\S]*docker compose exec[\s\S]*\n\} finally \{\n {2}Set-Location -LiteralPath \$caller\.Path\n\}\nexit \$code\n$/);
  });

  it('install.ps1 has -WrapperOnly, which needs -Dir and an install folder, and writes before any download', () => {
    expect(ps1).toContain('[switch]$WrapperOnly');
    const block = ps1.slice(ps1.indexOf('if ($WrapperOnly) {'));
    expect(block).toContain("$PSBoundParameters.ContainsKey('Dir')");
    expect(block).toContain('is not an OpenLDR install folder: it has no .env or no docker-compose.yml.');
    expect(ps1.indexOf('if ($WrapperOnly) {')).toBeLessThan(ps1.indexOf('Fetch "deploy/install/docker-compose.yml"'));
    expect(ps1.indexOf('if ($WrapperOnly) {')).toBeLessThan(ps1.indexOf('if ($Version -eq "auto")'));
  });

  it('install.ps1 writes through a temporary file, stops on a failed write, and -WrapperOnly refuses other options', () => {
    const fn = ps1.slice(ps1.indexOf('function Write-Wrapper {'), ps1.indexOf('if ($WrapperOnly) {'));
    expect(fn).toContain('Set-Content -LiteralPath $temp -Value $wrapper -Encoding utf8 -ErrorAction Stop');
    expect(fn).toContain('Move-Item -LiteralPath $temp -Destination $target -Force -ErrorAction Stop');
    expect(fn).toMatch(/catch \{[\s\S]*Remove-Item -LiteralPath \$temp[\s\S]*exit 1/);
    const block = ps1.slice(ps1.indexOf('if ($WrapperOnly) {'));
    expect(block).toContain("Where-Object { $_ -ne 'Dir' -and $_ -ne 'WrapperOnly' }");
    expect(block).toContain('-WrapperOnly takes no other option than -Dir');
    // Both places write through the function; no direct Set-Content of openldr.ps1 is left.
    expect(ps1).not.toMatch(/Set-Content -Path "\$Dir\/openldr\.ps1"/);
    expect(ps1.match(/^\s*Write-Wrapper$/gm)).toHaveLength(2);
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
  const dir = tempDir('openldr-fixture-');
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
