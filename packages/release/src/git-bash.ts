import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';

/**
 * The path to Git Bash, or plain `bash` off Windows.
 *
 * ⛔ Never pass the literal `'bash'` to execFileSync on Windows. On a machine with WSL
 * installed, `bash` on PATH is `C:\Windows\System32\bash.exe` — the WSL launcher — which fails
 * with `execvpe(/bin/bash) failed: No such file or directory`. Measured on this project twice:
 * once it broke the whole test suite under turbo while passing in a Git Bash shell, and once it
 * stopped `pnpm release` dead at step 7, after every precondition had already passed.
 *
 * This lives in its own module, imported by both `scripts/release.ts` and the shell tests,
 * because the first fix went into the test file only — and the release script kept the bug.
 */
export function resolveGitBash(): string {
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
    'Git Bash not found. These scripts need it: the `bash` on PATH is the WSL launcher, ' +
      'which cannot run them. Install Git for Windows, or put its bin/bash.exe on PATH first.',
  );
}
