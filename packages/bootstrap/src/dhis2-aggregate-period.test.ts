import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '@openldr/core';
import { createDhis2Orchestration } from './dhis2-orchestration';

// REGRESSION: the aggregate push ran its source report with ONLY the mapping's stored params.
// The mapping form has no parameters UI, so those are always empty — and every built-in report
// declares a REQUIRED date range. Every aggregate push therefore died with
// "required parameter: from", surfaced to the plugin iframe as the redacted
// "operation connectors.push failed (ref: ...)". The tracker branch of the same function already
// derived its window from the push period via periodRange(); the aggregate branch never did.

const aggMapping = {
  kind: 'aggregate',
  id: 'm1',
  name: 'AMR resistance to DHIS2',
  source: { kind: 'report', reportId: 'r-amr-facility-summary' },
  orgUnitColumn: 'facility',
  columns: [{ column: 'tested', dataElement: 'de1' }],
};

function deps(runImpl?: (id: string, params: Record<string, unknown>) => Promise<{ rows: unknown[] }>) {
  const docs = new Map<string, unknown>();
  const target = {
    pullMetadata: vi.fn(async () => ({ dataElements: [], orgUnits: [], categoryOptionCombos: [], programs: [], programStages: [] })),
    pushAggregate: vi.fn(async () => ({ payload: { dataValues: [] }, skipped: [], result: { status: 'OK', imported: 0, updated: 0, ignored: 0, conflicts: [] } })),
    pushEvents: vi.fn(async () => ({ payload: { events: [] }, skipped: [], result: { status: 'OK', imported: 0, updated: 0, ignored: 0, conflicts: [] } })),
    healthCheck: vi.fn(async () => ({ status: 'up' as const })),
  };
  const d = {
    connectors: {
      get: vi.fn(async () => ({ id: 'c1', name: 'DHIS2', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis.example', enabled: true, createdAt: new Date(0), updatedAt: new Date(0) })),
      getDecryptedConfig: vi.fn(async () => ({ baseUrl: 'https://dhis.example', token: 's3cr3t' })),
    },
    loadSink: vi.fn(async () => ({ invoke: vi.fn() })),
    reporting: {
      run: vi.fn(runImpl ?? (async () => ({ rows: [] }))),
      runEventSource: vi.fn(async () => ({ rows: [] })),
    },
    createTarget: vi.fn(() => target),
    secretsKey: 'k',
    pluginData: {
      async get() { return null; },
      async put(_p: string, _c: string, k: string, doc: unknown) { docs.set(k, doc); },
      async delete() {}, async list() { return []; }, async purge() {},
    },
    logger: createLogger({ level: 'silent' }),
  };
  return { d, target };
}

describe('aggregate push report window', () => {
  it('derives from/to from the DHIS2 push period', async () => {
    const { d } = deps();
    const orch = createDhis2Orchestration(d as never);
    await orch.push({ connectorId: 'c1', mapping: aggMapping, period: '202601', dryRun: true });
    expect(d.reporting.run).toHaveBeenCalledWith('r-amr-facility-summary', expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' }));
  });

  it('succeeds against a report that REQUIRES a date range (the original failure)', async () => {
    const { d } = deps(async (_id, params) => {
      if (!params.from) throw new Error('required parameter: from');
      return { rows: [] };
    });
    const orch = createDhis2Orchestration(d as never);
    await expect(orch.push({ connectorId: 'c1', mapping: aggMapping, period: '202601', dryRun: true })).resolves.toBeTruthy();
  });

  it('covers the whole quarter for a quarterly period', async () => {
    const { d } = deps();
    const orch = createDhis2Orchestration(d as never);
    await orch.push({ connectorId: 'c1', mapping: aggMapping, period: '2026Q1', dryRun: true });
    expect(d.reporting.run).toHaveBeenCalledWith('r-amr-facility-summary', expect.objectContaining({ from: '2026-01-01', to: '2026-03-31' }));
  });

  it("lets the mapping's own explicit params override the period-derived window", async () => {
    const { d } = deps();
    const orch = createDhis2Orchestration(d as never);
    const pinned = { ...aggMapping, source: { kind: 'report', reportId: 'r1', params: { from: '2013-01-01' } } };
    await orch.push({ connectorId: 'c1', mapping: pinned, period: '202601', dryRun: true });
    expect(d.reporting.run).toHaveBeenCalledWith('r1', expect.objectContaining({ from: '2013-01-01', to: '2026-01-31' }));
  });
});
