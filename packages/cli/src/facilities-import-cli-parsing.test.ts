import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

/**
 * Closes a review finding: `facilities.test.ts` calls `runFacilitiesImport()` directly with
 * hand-built option objects, so it never exercises commander's own `--apply` default at
 * `program.ts`'s `facilities import` registration — the actual seam an operator's real invocation
 * touches. A reviewer flipped that default from `false` to `true` and the full CLI suite still
 * passed 205/205. These tests drive the real parsing path (`program.parseAsync(argv)`) so a
 * regression there goes red.
 *
 * `program.ts`'s `buildProgram()` registers ~15 other command groups, which pulls in every
 * workspace package those commands depend on (`@openldr/bootstrap`, `@openldr/db`,
 * `@openldr/sync`, ...) as real, unmocked modules. That's fine here: none of it runs — a
 * command's real work only happens when its own action handler fires (module-level imports in
 * this codebase are plain function/class definitions, not connections), and this test only
 * invokes `facilities import`, whose own handler is intercepted below. Nothing here asserts on
 * those other packages' behaviour, only on the options commander resolves for the one command
 * under test.
 *
 * Each test calls `buildProgram()` itself to get a fresh `Command` — commander retains parsed
 * option values (`_optionValues`) across `parseAsync` calls on the same instance, so sharing one
 * `Command` across tests would order-couple them (a later test could pass only because an earlier
 * one already set `apply` on the shared instance). `.exitOverride()` makes a commander parse
 * error throw instead of calling `process.exit(1)`, which would otherwise hard-kill the vitest
 * worker on a bad argv.
 */
const mocks = vi.hoisted(() => ({
  runFacilitiesImport: vi.fn().mockResolvedValue(0),
  // Task 12: `import-runs`/`import-run <id>` get the same commander-parsing coverage as `import`
  // above, for the same reason — see the describe block at the bottom of this file.
  runFacilitiesImportRuns: vi.fn().mockResolvedValue(0),
  runFacilitiesImportRun: vi.fn().mockResolvedValue(0),
  // A2b Task 9. `import-run-cancel` is registered as a SIBLING of `import-run <id>`, not as a
  // `import-run cancel <id>` subcommand, and that is a measured constraint rather than a taste:
  // commander parses a parent's declared options BEFORE dispatching to a subcommand, so with the
  // nested spelling `facilities import-run cancel <id> --json` has its `--json` consumed by
  // `import-run` (which declares one) and the cancel handler receives `json: false`. The nested
  // form only works with `.enablePositionalOptions()` on the whole program, which would change how
  // every other `openldr` command group parses its options. The test below is what holds the
  // working spelling in place.
  runFacilitiesImportRunCancel: vi.fn().mockResolvedValue(0),
}));

// The function itself is already unit-tested in facilities.test.ts (including the pass-through
// of opts.apply). Mocking it here isolates what THIS test is about: what commander hands it.
vi.mock('./facilities', () => ({
  runFacilitiesImport: mocks.runFacilitiesImport,
  runFacilitiesImportRuns: mocks.runFacilitiesImportRuns,
  runFacilitiesImportRun: mocks.runFacilitiesImportRun,
  runFacilitiesImportRunCancel: mocks.runFacilitiesImportRunCancel,
}));

describe('facilities import — commander parsing path (program.ts, not the function directly)', () => {
  beforeEach(() => {
    mocks.runFacilitiesImport.mockClear();
  });

  it('parses a real argv with no --apply and resolves apply falsy', async () => {
    // buildProgram() returns a fresh, unstarted Command — constructing it here has no side
    // effect on the test runner's own argv (index.ts's module-level parseAsync(process.argv)
    // is never reached because we never import index.ts).
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'facilities',
      'import',
      '/some/national-register.csv',
      '--national-system',
      'urn:tz:hfr',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [path, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, { apply?: boolean; nationalSystem: string }];
    expect(path).toBe('/some/national-register.csv');
    expect(opts.nationalSystem).toBe('urn:tz:hfr');
    // The safety property under test: no --apply on the command line must resolve to a falsy
    // apply, i.e. a dry run. This is commander's own `.option('--apply', ..., false)` default —
    // exactly the line a reviewer mutated to `true` without any test going red.
    expect(opts.apply).toBeFalsy();
  });

  it('parses --apply on the command line and resolves apply true (proves the above is not vacuous)', async () => {
    // A fresh Command per test — commander retains parsed option values across parseAsync calls
    // on the same Command instance, so reusing one across tests would order-couple them.
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'facilities',
      'import',
      '/some/national-register.csv',
      '--national-system',
      'urn:tz:hfr',
      '--apply',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, { apply?: boolean }];
    expect(opts.apply).toBe(true);
  });

  // Task 5: same seam, same reasoning, for `--allow-malformed-rows` — the CLI-parity flag for
  // Task 4's `allowMalformedRows` override (see facility-import.ts's `FacilityImportOptions`).
  it('parses --allow-malformed-rows on the command line and resolves allowMalformedRows true', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'facilities',
      'import',
      '/some/national-register.csv',
      '--national-system',
      'urn:tz:hfr',
      '--allow-malformed-rows',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, { allowMalformedRows?: boolean }];
    expect(opts.allowMalformedRows).toBe(true);
  });

  // 🟠 Important 2: same seam again, for the coordinate override the design spec mandates. Without
  // this flag registered on the command there is no way to reach `allowInvalidCoordinates` from a
  // shell at all, and a row carrying `latitude: "N/A"` is simply lost.
  it('parses --allow-invalid-coordinates and resolves allowInvalidCoordinates true', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'facilities',
      'import',
      '/some/national-register.csv',
      '--national-system',
      'urn:tz:hfr',
      '--allow-invalid-coordinates',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, { allowInvalidCoordinates?: boolean }];
    expect(opts.allowInvalidCoordinates).toBe(true);
  });

  it('no --allow-malformed-rows resolves allowMalformedRows falsy', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node',
      'openldr',
      'facilities',
      'import',
      '/some/national-register.csv',
      '--national-system',
      'urn:tz:hfr',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, { allowMalformedRows?: boolean }];
    expect(opts.allowMalformedRows).toBeFalsy();
  });

  // Task 12: same seam, same reasoning, for the six flags added to mirror `FacilityImportOptions`
  // exactly (`--format`, `--release-version`, `--complete-release`, `--on-deleted`, `--on-absent`,
  // `--on-conflict`) — `facilities.test.ts` calls `runFacilitiesImport()` directly and so never
  // exercises commander's own parsing of these; this is the seam an operator's real invocation
  // touches, and a typo'd `.option()` flag name here would pass that direct-call suite unnoticed.
  it('parses every Task 12 flag on the command line and resolves them onto opts', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node', 'openldr', 'facilities', 'import', '/some/release.jsonl',
      '--national-system', 'urn:tz:hfr', '--apply',
      '--format', 'jsonl',
      '--release-version', 'r7',
      '--complete-release',
      '--on-deleted', 'report',
      '--on-absent', 'retire',
      '--on-conflict', 'overwrite',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts).toMatchObject({
      format: 'jsonl', releaseVersion: 'r7', completeRelease: true,
      onDeleted: 'report', onAbsent: 'retire', onConflict: 'overwrite',
    });
  });

  it('omitting the Task 12 flags resolves format/releaseVersion/onDeleted/onAbsent/onConflict undefined and completeRelease falsy', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node', 'openldr', 'facilities', 'import', '/some/register.csv',
      '--national-system', 'urn:tz:hfr',
    ]);

    expect(mocks.runFacilitiesImport).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.runFacilitiesImport.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.format).toBeUndefined();
    expect(opts.releaseVersion).toBeUndefined();
    expect(opts.onDeleted).toBeUndefined();
    expect(opts.onAbsent).toBeUndefined();
    expect(opts.onConflict).toBeUndefined();
    expect(opts.completeRelease).toBeFalsy();
  });
});

// ── Task 12: `facilities import-runs` / `import-run <id>` — real commander parsing ────────────
describe('facilities import-runs / import-run — commander parsing path', () => {
  beforeEach(() => {
    mocks.runFacilitiesImportRuns.mockClear();
    mocks.runFacilitiesImportRun.mockClear();
    mocks.runFacilitiesImportRunCancel.mockClear();
  });

  it('import-runs parses --national-system and --limit as a string and a number', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync([
      'node', 'openldr', 'facilities', 'import-runs',
      '--national-system', 'urn:tz:hfr', '--limit', '5',
    ]);

    expect(mocks.runFacilitiesImportRuns).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runFacilitiesImportRuns.mock.calls[0] as [{ nationalSystem?: string; limit?: number }];
    expect(opts.nationalSystem).toBe('urn:tz:hfr');
    expect(opts.limit).toBe(5); // a NUMBER, not the string "5" — proves the parse function ran.
  });

  it('import-run <id> resolves the positional id', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'import-run', 'fir_abc123']);

    expect(mocks.runFacilitiesImportRun).toHaveBeenCalledTimes(1);
    const [id] = mocks.runFacilitiesImportRun.mock.calls[0] as [string];
    expect(id).toBe('fir_abc123');
  });

  // A2b Task 9, and the reason the command is spelled `import-run-cancel` rather than
  // `import-run cancel` — see the note on the mock at the top of this file. `--json` reaching the
  // handler is the whole point of the assertion: under the nested spelling it MEASURABLY does not.
  it('import-run-cancel <id> resolves the positional id and its own --json', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'import-run-cancel', 'fir_abc123', '--json']);

    expect(mocks.runFacilitiesImportRunCancel).toHaveBeenCalledTimes(1);
    const [id, opts] = mocks.runFacilitiesImportRunCancel.mock.calls[0] as [string, { json: boolean }];
    expect(id).toBe('fir_abc123');
    expect(opts.json).toBe(true);
  });

  it('import-run-cancel without --json resolves json false (proves the above is not vacuous)', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'import-run-cancel', 'fir_abc123']);

    const [, opts] = mocks.runFacilitiesImportRunCancel.mock.calls[0] as [string, { json: boolean }];
    expect(opts.json).toBe(false);
  });

  // The sibling spelling must not have broken the command it sits next to: `import-run <id>` still
  // resolves an id that merely LOOKS like a subcommand word.
  it('import-run <id> is unaffected: an id is still an id', async () => {
    const program = buildProgram().exitOverride();

    await program.parseAsync(['node', 'openldr', 'facilities', 'import-run', 'cancel']);

    expect(mocks.runFacilitiesImportRunCancel).not.toHaveBeenCalled();
    const [id] = mocks.runFacilitiesImportRun.mock.calls[0] as [string];
    expect(id).toBe('cancel');
  });
});
