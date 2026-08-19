import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

/**
 * The coverage trap this file exists to close (fc-task-4-brief.md, Controller notes): slice B's
 * equivalent task (`audit list`) shipped `--sort -occurredAt` verified only by an uncommitted
 * manual smoke test, because `runAuditList()` being unit-tested directly with a hand-built
 * options object can never prove commander's own `--sort <column...>` option actually delivers a
 * leading-dash string as a VALUE instead of swallowing it as an unrecognised flag or splitting
 * the variadic collection early. `audit-cli-parsing.test.ts` is the fix that landed for that gap;
 * this file is the same fix for `facilities list`.
 *
 * `runFacilitiesList()` is already unit-tested directly in facilities.test.ts (including the
 * filters/sorts objects `parseWhereFlags` produces). This file only asserts on what commander
 * itself resolves for `--where`/`--sort`/`--limit` before handing off to it — `runFacilitiesList`
 * is mocked so no real DB/app-context work happens.
 *
 * A fresh `Command` per test, per the same note in `facilities-import-cli-parsing.test.ts` and
 * `audit-cli-parsing.test.ts`: commander retains parsed option values across `parseAsync` calls
 * on one instance, so sharing one `Command` across tests would order-couple them.
 */
const mocks = vi.hoisted(() => ({
  runFacilitiesList: vi.fn().mockResolvedValue(0),
}));

vi.mock('./facilities', () => ({
  runFacilitiesList: mocks.runFacilitiesList,
}));

describe('facilities list — commander parsing path (program.ts, not the function directly)', () => {
  beforeEach(() => {
    mocks.runFacilitiesList.mockClear();
  });

  it('parses --sort -name as a value, not a swallowed flag', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'facilities',
      'list',
      '--where',
      'level:eq:hospital',
      '--sort',
      '-name',
    ]);

    expect(mocks.runFacilitiesList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runFacilitiesList.mock.calls[0] as [{ where?: string[]; sort?: string[] }];
    // The property under test: commander must deliver the leading-dash string intact. If
    // commander mistook it for an option, `sort` would be undefined or missing the value.
    expect(opts.sort).toEqual(['-name']);
    expect(opts.where).toEqual(['level:eq:hospital']);
  });

  it('parses a plain (ascending) --sort column the same way, for contrast', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'list', '--sort', 'name']);

    expect(mocks.runFacilitiesList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runFacilitiesList.mock.calls[0] as [{ sort?: string[] }];
    expect(opts.sort).toEqual(['name']);
  });

  it('parses --limit as a string value', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'list', '--limit', '25']);

    expect(mocks.runFacilitiesList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runFacilitiesList.mock.calls[0] as [{ limit?: string }];
    expect(opts.limit).toBe('25');
  });

  it('no --where/--sort on the command line resolves both undefined', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'list']);

    expect(mocks.runFacilitiesList).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runFacilitiesList.mock.calls[0] as [{ where?: string[]; sort?: string[] }];
    expect(opts.where).toBeUndefined();
    expect(opts.sort).toBeUndefined();
  });
});
