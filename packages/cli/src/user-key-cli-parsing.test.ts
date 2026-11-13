import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * user.test.ts calls the command functions with hand-built options, so it never runs commander's
 * own wiring: the argument order, `--name` being required, `--force` and `--json` defaults, and
 * `--no-password` turning into `password: false`. These drive the real parse (`buildProgram()`),
 * with the command functions mocked so nothing touches a database.
 */
const mocks = vi.hoisted(() => ({
  runUserKeyList: vi.fn(async () => 0),
  runUserKeyCreate: vi.fn(async () => 0),
  runUserKeyRevoke: vi.fn(async () => 0),
  runUserCreate: vi.fn(async () => 0),
}));
vi.mock('./user', async (orig) => ({ ...(await orig<typeof import('./user')>()), ...mocks }));

import { buildProgram } from './program';

/** A fresh program each time: commander keeps parsed option values on the instance. */
async function parse(argv: string[]): Promise<void> {
  const program = buildProgram();
  // A parse error throws instead of ending the test process, at every level of the tree.
  const override = (c: ReturnType<typeof buildProgram>): void => { c.exitOverride(); c.commands.forEach(override); };
  override(program);
  await program.parseAsync(argv, { from: 'user' });
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockClear();
  process.exitCode = undefined;
});

describe('the user key commands, through commander', () => {
  it('user key list <username> [--json]', async () => {
    await parse(['user', 'key', 'list', 'bob']);
    expect(mocks.runUserKeyList).toHaveBeenCalledWith('bob', { json: false });
    await parse(['user', 'key', 'list', 'bob', '--json']);
    expect(mocks.runUserKeyList).toHaveBeenLastCalledWith('bob', { json: true });
  });

  it('user key create <username> --name <name> [--expires <date>] [--json]', async () => {
    await parse(['user', 'key', 'create', 'bob', '--name', 'backup job']);
    expect(mocks.runUserKeyCreate).toHaveBeenCalledWith('bob', { name: 'backup job', json: false });
    await parse(['user', 'key', 'create', 'bob', '--name', 'ci', '--expires', '2030-01-31', '--json']);
    expect(mocks.runUserKeyCreate).toHaveBeenLastCalledWith('bob', { name: 'ci', expires: '2030-01-31', json: true });
  });

  it('user key create refuses a missing --name before the command runs', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(parse(['user', 'key', 'create', 'bob'])).rejects.toThrow(/--name/);
    } finally {
      write.mockRestore();
    }
    expect(mocks.runUserKeyCreate).not.toHaveBeenCalled();
  });

  it('user key revoke <username> <keyId> [--force]', async () => {
    const id = '0b4c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
    await parse(['user', 'key', 'revoke', 'bob', id]);
    expect(mocks.runUserKeyRevoke).toHaveBeenCalledWith('bob', id, { force: false });
    await parse(['user', 'key', 'revoke', 'bob', id, '--force']);
    expect(mocks.runUserKeyRevoke).toHaveBeenLastCalledWith('bob', id, { force: true });
  });

  it('user create --no-password gives password: false, and a password by default', async () => {
    await parse(['user', 'create', '--username', 'bot', '--no-password']);
    expect(mocks.runUserCreate).toHaveBeenCalledWith({ username: 'bot', password: false, json: false });
    await parse(['user', 'create', '--username', 'ann', '--role', 'lab_admin']);
    expect(mocks.runUserCreate).toHaveBeenLastCalledWith({ username: 'ann', role: ['lab_admin'], password: true, json: false });
  });
});
