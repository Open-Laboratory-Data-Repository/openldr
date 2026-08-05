import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}));

// The function itself is already unit-tested in facilities.test.ts (including the pass-through
// of opts.apply). Mocking it here isolates what THIS test is about: what commander hands it.
vi.mock('./facilities', () => ({
  runFacilitiesImport: mocks.runFacilitiesImport,
}));

describe('facilities import — commander parsing path (program.ts, not the function directly)', () => {
  beforeEach(() => {
    mocks.runFacilitiesImport.mockClear();
  });

  it('parses a real argv with no --apply and resolves apply falsy', async () => {
    // buildProgram() returns a fresh, unstarted Command — constructing it here has no side
    // effect on the test runner's own argv (index.ts's module-level parseAsync(process.argv)
    // is never reached because we never import index.ts).
    const { buildProgram } = await import('./program');
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
    const { buildProgram } = await import('./program');
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
});
