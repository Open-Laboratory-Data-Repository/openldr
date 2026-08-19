import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

/**
 * Closes Finding 1 of the Task 6 review: `--sort -occurredAt` is how the CLI expresses
 * descending order, and a leading dash is exactly the character argument parsers commonly
 * mistake for another flag. `table-query-flags.test.ts` only proves `parseWhereFlags` treats
 * the string `-occurredAt` as descending once it already has that string in hand — it never
 * proves commander's own `--sort <column...>` option (registered at `program.ts`'s `audit
 * list` command) actually delivers `-occurredAt` as a value instead of swallowing it as an
 * unknown flag or splitting the variadic collection early.
 *
 * Same reasoning and same seam as `facilities-import-cli-parsing.test.ts`: `runAuditList()` is
 * already unit-tested directly (`read-commands.test.ts`, `table-query-flags.test.ts`); this
 * file only asserts on what commander itself resolves for `--where`/`--sort` before handing
 * off to it. `runAuditList` is mocked so no real DB/app-context work happens.
 *
 * A fresh `Command` per test, per the same note in `facilities-import-cli-parsing.test.ts`:
 * commander retains parsed option values across `parseAsync` calls on one instance.
 */
const mocks = vi.hoisted(() => ({
  runAuditList: vi.fn().mockResolvedValue(0),
}));

vi.mock('./audit', () => ({
  runAuditList: mocks.runAuditList,
}));

describe('audit list — commander parsing path (program.ts, not the function directly)', () => {
  beforeEach(() => {
    mocks.runAuditList.mockClear();
  });

  it('parses --sort -occurredAt as a value, not a swallowed flag', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'audit',
      'list',
      '--where',
      'action:eq:form.create',
      '--sort',
      '-occurredAt',
    ]);

    expect(mocks.runAuditList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runAuditList.mock.calls[0] as [{ where?: string[]; sort?: string[] }];
    // The property under test: commander must deliver the leading-dash string intact.
    // If commander mistook it for an option, `sort` would be `undefined` or missing the value.
    expect(opts.sort).toEqual(['-occurredAt']);
    expect(opts.where).toEqual(['action:eq:form.create']);
  });

  it('parses a plain (ascending) --sort column the same way, for contrast', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'audit', 'list', '--sort', 'action']);

    expect(mocks.runAuditList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runAuditList.mock.calls[0] as [{ sort?: string[] }];
    expect(opts.sort).toEqual(['action']);
  });

  it('no --where/--sort on the command line resolves both undefined', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'audit', 'list']);

    expect(mocks.runAuditList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runAuditList.mock.calls[0] as [{ where?: string[]; sort?: string[] }];
    expect(opts.where).toBeUndefined();
    expect(opts.sort).toBeUndefined();
  });
});
