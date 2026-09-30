import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

// A fresh Command per test: commander keeps parsed option values across parseAsync calls
// on one instance. Same idiom as facilities-list-cli-parsing.test.ts.
const mocks = vi.hoisted(() => ({
  runQueryExport: vi.fn().mockResolvedValue(0),
  runQueryImport: vi.fn().mockResolvedValue(0),
}));

vi.mock('./query', () => ({
  runQueryExport: mocks.runQueryExport,
  runQueryImport: mocks.runQueryImport,
}));

describe('query export and import: commander parsing', () => {
  beforeEach(() => {
    mocks.runQueryExport.mockClear();
    mocks.runQueryImport.mockClear();
  });

  it('parses query export --out', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'query', 'export', '--out', 'f.json']);
    expect(mocks.runQueryExport).toHaveBeenCalledTimes(1);
    const [opts] = mocks.runQueryExport.mock.calls[0] as [{ name?: string[]; out: string; json: boolean }];
    expect(opts.out).toBe('f.json');
    expect(opts.name).toBeUndefined();
    expect(opts.json).toBe(false);
  });

  it('collects repeated --name flags', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'query', 'export', '--name', 'A', '--name', 'B', '--out', 'f.json',
    ]);
    const [opts] = mocks.runQueryExport.mock.calls[0] as [{ name?: string[] }];
    expect(opts.name).toEqual(['A', 'B']);
  });

  it('parses query import with --connector and --force', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'query', 'import', 'f.json', '--connector', 'X Y', '--force',
    ]);
    const [file, opts] = mocks.runQueryImport.mock.calls[0] as [string, { connector?: string; force: boolean; json: boolean }];
    expect(file).toBe('f.json');
    expect(opts.connector).toBe('X Y');
    expect(opts.force).toBe(true);
  });

  it('defaults force to false', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'query', 'import', 'f.json']);
    const [, opts] = mocks.runQueryImport.mock.calls[0] as [string, { force: boolean; connector?: string }];
    expect(opts.force).toBe(false);
    expect(opts.connector).toBeUndefined();
  });
});
