import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { createReportDesignStore } from '@openldr/report-designer';
import {
  seedDataDrivenReports,
  SEED_DESIGNS,
  DEFAULT_CONNECTOR_NAME,
  type SeedDataDrivenReportsDeps,
} from '@openldr/reporting';

// The seeded designs are the only dep that must be REAL here. `packages/reporting`'s own idempotence
// test uses a lossless Map for designs, so it stayed green while every boot overwrote all 8
// `simpleTableDesign` built-ins — the store dropped `pageNumbers: true`, `designContent` normalised
// the missing value to `false`, and the comparison against the shipped `true` was never equal.
let db: Kysely<any>;
beforeEach(async () => {
  const mem = newDb();
  db = mem.adapters.createKysely();
  await db.schema.createTable('report_designs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text')
    .addColumn('paper', 'text')
    .addColumn('orientation', 'text')
    .addColumn('pages', 'jsonb').addColumn('parameters', 'jsonb')
    .addColumn('margins', 'jsonb')
    .addColumn('page_numbers', 'boolean')
    .addColumn('created_at', 'text').addColumn('updated_at', 'text').execute();
});

function depsWithRealDesignStore(): SeedDataDrivenReportsDeps {
  const queries = new Map<string, { id: string; connectorId: string; sql: string; params?: unknown }>();
  const reportDefs = new Map<string, { id: string }>();
  return {
    customQueries: {
      get: async (id) => (queries.has(id) ? (queries.get(id) as never) : null),
      create: async (q) => { queries.set(q.id, { id: q.id, connectorId: q.connectorId, sql: q.sql, params: q.params }); },
      update: async (id, patch) => {
        const cur = queries.get(id);
        if (cur) {
          queries.set(id, {
            ...cur,
            ...('sql' in patch ? { sql: patch.sql as string } : {}),
            ...('params' in patch ? { params: patch.params } : {}),
          });
        }
      },
    },
    designs: createReportDesignStore(db),
    reportDefs: {
      get: async (id) => reportDefs.get(id) as never,
      create: async (r) => { reportDefs.set(r.id, { ...r } as never); return r; },
      update: async (id, r) => { reportDefs.set(id, { ...r, id } as never); return { ...r, id } as never; },
    },
    connectors: { list: async () => [{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }] as never },
  };
}

describe('boot seed drift against the real report-design store', () => {
  it('seeds every design once and reports no drift on the second run', async () => {
    const deps = depsWithRealDesignStore();

    const first = await seedDataDrivenReports(deps);
    expect(first.designsSeeded).toBe(SEED_DESIGNS.length);
    expect(first.designsUpdated).toBe(0);

    // The real defect: this was `8` on every boot, silently reverting any operator edit to a
    // built-in design (see the managed-overwrite comment at report-seeds.ts:2534).
    const second = await seedDataDrivenReports(deps);
    expect(second.designsSeeded).toBe(0);
    expect(second.designsUpdated).toBe(0);

    // A third run must be just as quiet — drift that only settles after one rewrite is still drift.
    const third = await seedDataDrivenReports(deps);
    expect(third.designsUpdated).toBe(0);
  });

  it('keeps pageNumbers on a seeded built-in after a round trip', async () => {
    const deps = depsWithRealDesignStore();
    await seedDataDrivenReports(deps);
    const stored = await deps.designs.get('rt-amr-resistance');
    expect(stored?.pageNumbers).toBe(true);
  });
});
