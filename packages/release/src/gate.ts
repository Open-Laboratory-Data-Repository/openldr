/** One task turbo reported as failed, e.g. `@openldr/db#test`. */
export interface FailedTask {
  pkg: string;
  task: string;
}

/** A package name, nothing else. These values reach a shell on Windows. */
const PKG = /^@?[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;
/** A turbo task name — the script key turbo ran. */
const TASK = /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/;

/** Which packages and tasks turbo said failed, read off its own summary.
 *
 *  Measured from real gate logs in this repo:
 *
 *    Failed:    @openldr/db#typecheck
 *    Failed:    @openldr/audit#test, @openldr/bootstrap#test, @openldr/db#test, …
 *
 *  Two things that summary teaches, both of which a `(\S+?)#` match gets wrong:
 *  every failure is on ONE comma-separated line, and the failing task is not always `test` —
 *  the gate runs each package's typecheck too (see GATE_TURBO_ARGS).
 *
 *  An empty result means nothing could be read. The caller must refuse on that, never re-run
 *  nothing and call the gate green. */
export function parseFailedTasks(turboOutput: string): FailedTask[] {
  const seen = new Set<string>();
  const out: FailedTask[] = [];

  for (const line of turboOutput.split(/\r?\n/)) {
    const m = /^\s*Failed:\s+(.*\S)\s*$/.exec(line);
    if (!m) continue;
    for (const entry of m[1]!.split(',')) {
      const hash = entry.indexOf('#');
      if (hash < 0) continue;
      const pkg = entry.slice(0, hash).trim();
      const task = entry.slice(hash + 1).trim();
      if (!PKG.test(pkg) || !TASK.test(task)) continue;
      const key = `${pkg}#${task}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pkg, task });
    }
  }
  return out;
}

/** The turbo run the release gate makes: tests and typecheck in one run.
 *
 *  ⛔ typecheck is named. turbo.json's test task does not depend on it, so `turbo run test`
 *  alone typechecks nothing. Measured on the 0.1.12 dry run, 2026-11-22: 38 test tasks, no
 *  typecheck task. The retry below re-runs a failed typecheck as `run typecheck`, as it does a test.
 *
 *  ⛔ --force. A test task has no `dependsOn`, so its cache key misses changes in the packages it
 *  imports, and a cached pass can be stale. The 0.1.12 dry run replayed 32 of 38 tasks from cache.
 *
 *  ⛔ --continue. Without it turbo stops at the first failure and kills the tasks still running.
 *  They are neither passed nor in the Failed line, so the retry never covers them. Measured on the
 *  0.1.10 dry run: bootstrap failed, turbo cut off cli, server and studio mid-run, the retry
 *  re-ran bootstrap alone, and the gate said green with three packages never finished.
 *
 *  ⛔ --concurrency=2, the repo gate's setting (CLAUDE.md "Test gate"). The default oversubscribes
 *  and tests fail on `Test timed out` rather than on anything real: measured 2026-08-19, the
 *  default failed 4 of 4 cold runs, each on a different package. 4 passed then on this box, but
 *  higher settings later ran a machine out of memory, and the forced 0.1.12 gate passed at 2. */
export const GATE_TURBO_ARGS = ['turbo', 'run', 'test', 'typecheck', '--force', '--concurrency=2', '--continue'];

/** How many tasks turbo neither passed nor failed, read off its summary:
 *
 *     Tasks:    31 successful, 35 total
 *
 *  `failedCount` is what parseFailedTasks read. Above zero means some task never finished, so
 *  the retry cannot vouch for it. Null means there is no summary to count from. The caller must
 *  refuse on both. */
export function tasksNeverFinished(turboOutput: string, failedCount: number): number | null {
  let counts: { successful: number; total: number } | null = null;
  for (const line of turboOutput.split(/\r?\n/)) {
    const m = /^\s*Tasks:\s+(\d+) successful, (\d+) total\s*$/.exec(line);
    if (m) counts = { successful: Number(m[1]), total: Number(m[2]) };
  }
  if (!counts) return null;
  return counts.total - counts.successful - failedCount;
}

/** `package#task`, the way turbo prints it. */
export function formatFailedTask(t: FailedTask): string {
  return `${t.pkg}#${t.task}`;
}
