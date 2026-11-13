import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `openldr commands` must work with no server and no database settings. The config loader and
// the context builders throw here, so a call to any of them fails the command.
const throwers = vi.hoisted(() => ({
  loadConfig: vi.fn(() => { throw new Error('loadConfig called'); }),
  createAppContext: vi.fn(() => { throw new Error('createAppContext called'); }),
  createDbContext: vi.fn(() => { throw new Error('createDbContext called'); }),
}));
vi.mock('@openldr/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openldr/config')>()),
  loadConfig: throwers.loadConfig,
}));
vi.mock('@openldr/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openldr/bootstrap')>()),
  createAppContext: throwers.createAppContext,
  createDbContext: throwers.createDbContext,
}));

import { buildProgram } from './program';
import { commandPath, leafCommands, listCommands, type CommandEntry } from './command-list';

async function runCommands(args: string[]): Promise<{ code: number; stdout: string }> {
  let stdout = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => { stdout += String(chunk); return true; });
  try {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'commands', ...args]);
  } finally {
    out.mockRestore();
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return { code, stdout };
}

describe('commandPath', () => {
  it('joins the words below the root with one space', () => {
    const leaf = leafCommands(buildProgram()).find((c) => c.name() === 'create' && c.parent?.name() === 'key');
    expect(leaf && commandPath(leaf)).toBe('user key create');
  });
});

describe('listCommands', () => {
  it('has one row per command, sorted by path', () => {
    const program = buildProgram();
    const rows = listCommands(program);
    const paths = rows.map((r) => r.path);
    expect(paths).toEqual(leafCommands(program).map(commandPath).sort());
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives each row its arguments, options, kind and flags', () => {
    const row = listCommands(buildProgram()).find((r) => r.path === 'user key revoke');
    expect(row).toEqual<CommandEntry>({
      path: 'user key revoke',
      description: 'Revoke an access key (refuses without --force)',
      arguments: [
        { name: 'username', required: true, variadic: false },
        { name: 'keyId', required: true, variadic: false },
      ],
      options: [{ flags: '--force', description: 'confirm any program using the key loses access' }],
      kind: 'app',
      capability: null,
      destructive: true,
    });
    const hide = listCommands(buildProgram()).find((r) => r.path === 'data-exposure hide');
    expect(hide?.arguments[1]).toEqual({ name: 'columns', required: true, variadic: true });
    expect(listCommands(buildProgram()).find((r) => r.path === 'errors list')?.kind).toBe('local');
    expect(listCommands(buildProgram()).find((r) => r.path === 'db migrate')?.kind).toBe('recovery');
  });

  it('leaves capability null on every row in this task', () => {
    expect(listCommands(buildProgram()).filter((r) => r.capability !== null)).toEqual([]);
  });
});

describe('openldr commands', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.exitCode = undefined;
    // Values that must never reach the output, even if something read the environment.
    process.env.INTERNAL_DATABASE_URL = 'postgres://u:s3cr3t-db-pass@db:5432/x';
    process.env.OPENLDR_SECRETS_KEY = 'secret-key-value-123';
    process.env.OPENLDR_KEY = 'oldr_not-a-real-key-body';
  });
  afterEach(() => { process.env = { ...saved }; });

  it('prints the list as JSON with one row per command and no secrets', async () => {
    const { code, stdout } = await runCommands(['--json']);
    expect(code).toBe(0);
    const rows = JSON.parse(stdout) as CommandEntry[];
    expect(rows).toEqual(listCommands(buildProgram()));
    expect(rows.map((r) => r.path)).toContain('commands');
    for (const secret of ['s3cr3t-db-pass', 'secret-key-value-123', 'oldr_not-a-real-key-body']) expect(stdout).not.toContain(secret);
    expect(Object.keys(rows[0]!).sort()).toEqual(['arguments', 'capability', 'description', 'destructive', 'kind', 'options', 'path']);
  });

  it('prints one line per command for a person', async () => {
    const { code, stdout } = await runCommands([]);
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(listCommands(buildProgram()).length);
    expect(lines.find((l) => l.startsWith('db migrate '))).toMatch(/recovery/);
    expect(lines.find((l) => l.startsWith('user key revoke '))).toMatch(/app\s+destructive/);
  });

  it('builds no context and loads no config', async () => {
    await runCommands(['--json']);
    await runCommands([]);
    for (const [name, fn] of Object.entries(throwers)) expect(fn, name).not.toHaveBeenCalled();
  });
});
