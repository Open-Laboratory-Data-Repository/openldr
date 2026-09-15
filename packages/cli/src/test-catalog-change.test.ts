import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  get: vi.fn(),
  setEnabled: vi.fn(),
  setActive: vi.fn(),
  close: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }) }));

// Partial: catalogChangeAction stays real, so the CLI is checked against the route's own audit names.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    parseCatalogListQuery: actual.parseCatalogListQuery,
    catalogChangeAction: actual.catalogChangeAction,
    TestCatalogError: actual.TestCatalogError,
  };
});

import { TestCatalogError } from '@openldr/bootstrap';
import { runTestCatalogChange } from './test-catalog';

const TEST = {
  code: 'HIVVL', display: 'HIV viral load', shortName: null, category: 'MOL', specimenTypes: [], loinc: null,
  active: true, lab: { enabled: false, specimenTypes: null, localDisplay: null },
};

describe('openldr test-catalog enable | disable | retire | restore', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.get.mockResolvedValue(TEST);
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({
      testCatalog: { get: mocks.get, setEnabled: mocks.setEnabled, setActive: mocks.setActive },
      close: mocks.close,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it('enable switches the test on and audits it as the CLI', async () => {
    mocks.setEnabled.mockResolvedValue({ ...TEST, lab: { ...TEST.lab, enabled: true } });
    expect(await runTestCatalogChange('enable', 'HIVVL', { json: false })).toBe(0);
    expect(mocks.setEnabled).toHaveBeenCalledWith('HIVVL', true);
    expect(out.join('')).toBe('HIVVL is now on at this lab.\n');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      { actorType: 'cli', actorId: null, actorName: 'tester' },
      { action: 'test_catalog.enable', entityType: 'test_catalog', entityId: 'HIVVL', before: { enabled: false }, after: { enabled: true } },
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('disable, retire and restore call the matching method and record the matching action', async () => {
    mocks.setEnabled.mockResolvedValue(TEST);
    mocks.setActive.mockImplementation(async (_code: string, active: boolean) => ({ ...TEST, active }));
    const cases: Array<['disable' | 'retire' | 'restore', string, string]> = [
      ['disable', 'test_catalog.disable', 'HIVVL is now off at this lab.\n'],
      ['retire', 'test_catalog.retire', 'HIVVL is retired.\n'],
      ['restore', 'test_catalog.restore', 'HIVVL is active again.\n'],
    ];
    for (const [change, action, line] of cases) {
      out.length = 0;
      mocks.recordAuditEvent.mockClear();
      expect(await runTestCatalogChange(change, 'HIVVL', { json: false })).toBe(0);
      expect(out.join('')).toBe(line);
      expect(mocks.recordAuditEvent.mock.calls[0][2]).toMatchObject({ action });
    }
    expect(mocks.setEnabled).toHaveBeenCalledWith('HIVVL', false);
    expect(mocks.setActive.mock.calls).toEqual([['HIVVL', false], ['HIVVL', true]]);
  });

  it('prints the changed test as JSON with --json', async () => {
    mocks.setActive.mockResolvedValue({ ...TEST, active: false });
    await runTestCatalogChange('retire', 'HIVVL', { json: true });
    expect(JSON.parse(out.join(''))).toEqual({ ...TEST, active: false });
  });

  it('reports a refusal in the service words, audits nothing and still closes the context', async () => {
    mocks.setActive.mockRejectedValue(new TestCatalogError('This catalog comes from central.', 'central-managed'));
    expect(await runTestCatalogChange('retire', 'HIVVL', { json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog retire failed: This catalog comes from central.\n');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
