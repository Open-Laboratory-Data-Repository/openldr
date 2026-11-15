import { describe, it, expect, vi } from 'vitest';

// Layer: the options this store hands to mysql2's createPool. mysql2 is mocked at the module
// boundary, so no connection is opened and no server is needed.
const { createPool } = vi.hoisted(() => ({
  createPool: vi.fn((_options: Record<string, unknown>) => ({ end: (cb: (e?: unknown) => void) => cb() })),
}));
vi.mock('mysql2', () => ({ createPool }));

import { createMysqlStore } from './index';

describe('the mysql pool options', () => {
  // The SQL check lets one statement through, and nothing else stops a second one on MySQL: the
  // plan gives MySQL no transaction. mysql2 runs a second statement only with multipleStatements.
  it('mysql: neither pool turns multipleStatements on', async () => {
    for (const ssl of [false, true]) {
      createPool.mockClear();
      const store = createMysqlStore({ host: 'h', port: 3306, database: 'd', user: 'u', password: 'p', ssl });
      expect(createPool).toHaveBeenCalledTimes(1);
      const options = createPool.mock.calls[0][0];
      expect(options.multipleStatements).toBeUndefined();
      expect(options.host).toBe('h');
      await store.close();
    }
  });
});
