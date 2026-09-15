import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

// Checks only what commander hands runTestCatalogList. The function itself is tested in
// test-catalog.test.ts. A fresh Command per test: commander keeps parsed values across parseAsync calls.
const mocks = vi.hoisted(() => ({ runTestCatalogList: vi.fn().mockResolvedValue(0) }));

vi.mock('./test-catalog', () => ({ runTestCatalogList: mocks.runTestCatalogList }));

describe('test-catalog list: commander parsing', () => {
  beforeEach(() => {
    mocks.runTestCatalogList.mockClear();
  });

  it('hands every flag to runTestCatalogList as given', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'test-catalog', 'list',
      '--search', 'viral', '--category', 'MOL', '--loinc', 'none', '--enabled', 'off',
      '--status', 'all', '--limit', '10', '--offset', '20', '--json',
    ]);
    expect(mocks.runTestCatalogList).toHaveBeenCalledWith({
      search: 'viral', category: 'MOL', loinc: 'none', enabled: 'off', status: 'all', limit: '10', offset: '20', json: true,
    });
  });

  it('defaults --json to false', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'list']);
    expect(mocks.runTestCatalogList).toHaveBeenCalledWith({ json: false });
  });
});
