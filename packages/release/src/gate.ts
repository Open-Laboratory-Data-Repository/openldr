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
 *  `pnpm turbo run test` runs each package's typecheck too.
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

/** `package#task`, the way turbo prints it. */
export function formatFailedTask(t: FailedTask): string {
  return `${t.pkg}#${t.task}`;
}
