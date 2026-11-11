import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({ list: vi.fn(async () => 0), set: vi.fn(async () => 0), del: vi.fn(async () => 0) }));
vi.mock('./layouts', () => ({ runLayoutsList: spies.list, runLayoutsSet: spies.set, runLayoutsDelete: spies.del }));

import { buildProgram } from './program';

describe('openldr layouts commands', () => {
  beforeEach(() => { spies.list.mockClear(); spies.set.mockClear(); spies.del.mockClear(); process.exitCode = undefined; });

  it('list passes --json', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'layouts', 'list', '--json']);
    expect(spies.list).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
  });

  it('set passes the name and the flags', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'layouts', 'set', 'Bench', '--pages', '/forms,/patients', '--start-page', '/forms', '--roles', 'bench']);
    expect(spies.set).toHaveBeenCalledWith('Bench', expect.objectContaining({ pages: '/forms,/patients', startPage: '/forms', roles: 'bench' }));
  });

  it('delete passes --force', async () => {
    await buildProgram().parseAsync(['node', 'openldr', 'layouts', 'delete', 'Bench', '--force']);
    expect(spies.del).toHaveBeenCalledWith('Bench', expect.objectContaining({ force: true }));
  });
});
