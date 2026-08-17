import { describe, it, expect } from 'vitest';
import { parseFailedTasks, formatFailedTask } from './gate';

describe('parseFailedTasks', () => {
  it('reads one failed task off turbo’s summary line', () => {
    const out = [
      ' Tasks:    31 successful, 32 total',
      'Cached:    0 cached, 32 total',
      '  Time:    7m12.595s ',
      'Failed:    @openldr/db#test',
      '',
      ' ERROR  run failed: command  exited (1)',
    ].join('\n');
    expect(parseFailedTasks(out)).toEqual([{ pkg: '@openldr/db', task: 'test' }]);
  });

  // Measured from a real gate log: turbo puts EVERY failure on ONE comma-separated line.
  // A regex that stops at the first `#` re-runs one package and calls the other ten a timeout.
  it('reads every package off a comma-separated Failed line', () => {
    const out =
      'Failed:    @openldr/audit#test, @openldr/bootstrap#test, @openldr/dashboards#test, @openldr/db#test\n';
    expect(parseFailedTasks(out)).toEqual([
      { pkg: '@openldr/audit', task: 'test' },
      { pkg: '@openldr/bootstrap', task: 'test' },
      { pkg: '@openldr/dashboards', task: 'test' },
      { pkg: '@openldr/db', task: 'test' },
    ]);
  });

  // `pnpm turbo run test` also runs each package's typecheck. Measured: `Failed:
  // @openldr/db#typecheck`. Re-running `test` there would pass and hide a broken build.
  it('keeps the task name, which is not always test', () => {
    expect(parseFailedTasks('Failed:    @openldr/db#typecheck\n')).toEqual([
      { pkg: '@openldr/db', task: 'typecheck' },
    ]);
  });

  it('de-duplicates a package that failed the same task twice', () => {
    const out = 'Failed:    @openldr/db#test\nFailed:    @openldr/db#test\n';
    expect(parseFailedTasks(out)).toEqual([{ pkg: '@openldr/db', task: 'test' }]);
  });

  it('keeps two different tasks of the same package', () => {
    const out = 'Failed:    @openldr/db#typecheck, @openldr/db#test\n';
    expect(parseFailedTasks(out)).toEqual([
      { pkg: '@openldr/db', task: 'typecheck' },
      { pkg: '@openldr/db', task: 'test' },
    ]);
  });

  // No parse means no re-run. An unreadable failure must never read as "nothing failed",
  // because the caller turns an empty list into a refusal, not into a pass.
  it('is empty when the output has no Failed line', () => {
    expect(parseFailedTasks('everything was fine\n')).toEqual([]);
  });

  it('is empty for empty output', () => {
    expect(parseFailedTasks('')).toEqual([]);
  });

  // These names are concatenated into a Windows shell command. Anything that is not a
  // package name is dropped rather than passed along.
  it('drops an entry that is not a package name', () => {
    const out = 'Failed:    @openldr/db#test, ../evil && rm -rf#test, @openldr/ui#te$t\n';
    expect(parseFailedTasks(out)).toEqual([{ pkg: '@openldr/db', task: 'test' }]);
  });

  it('ignores a package mentioned outside a Failed line', () => {
    const out = ' ERROR  @openldr/studio#test: command exited (1)\nFailed:    @openldr/db#test\n';
    expect(parseFailedTasks(out)).toEqual([{ pkg: '@openldr/db', task: 'test' }]);
  });
});

describe('formatFailedTask', () => {
  it('prints package#task the way turbo does', () => {
    expect(formatFailedTask({ pkg: '@openldr/db', task: 'test' })).toBe('@openldr/db#test');
  });
});
