import { describe, it, expect } from 'vitest';
import {
  seedDataDrivenReports,
  SEED_QUERIES,
  SEED_DESIGNS,
  SEED_REPORT_DEFS,
  DEFAULT_CONNECTOR_NAME,
  ANTIBIOGRAM_PANEL,
  ANTIBIOTIC_CODES,
  UNMAPPED_ANTIBIOTIC,
  antibioticNormalizeSql,
  DESIGNS_REQUIRING_DATA,
  type SeedDataDrivenReportsDeps,
} from './report-seeds';
import { pairRects, toPt, paperSizePt, cellGridWidth, CELL_LABEL_W, cellGridMaxRows, CELL_HEAD_H, CELL_ROW_H, type ReportDesign } from '@openldr/report-designer';
import { findInvalidImageSources, findUnsortedHeaderRows } from '@openldr/report-designer/pure';

// In-memory fakes — no real Kysely instance needed (unlike `packages/bootstrap/src/seed.ts`,
// which builds `customQueries` from a real DB handle; here we inject fakes directly to unit-test
// `seedDataDrivenReports`'s own logic, in particular the Task-4.2 connector-resolution refinement
// and (Task 2, mssql-slice2b) the dialect-variant-selection refinement).
function fakeDeps(connectorList: { id: string; name: string; type?: string | null }[]) {
  const queries = new Map<string, { id: string; connectorId: string; sql: string; params?: unknown }>();
  const designs = new Map<string, { id: string }>();
  const reportDefs = new Map<string, { id: string }>();
  const deps: SeedDataDrivenReportsDeps = {
    customQueries: {
      get: async (id) => (queries.has(id) ? (queries.get(id) as never) : null),
      create: async (q) => {
        queries.set(q.id, { id: q.id, connectorId: q.connectorId, sql: q.sql, params: q.params });
      },
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
    designs: {
      // Stores the WHOLE design, not just its id: the seeder now compares stored content against
      // the shipped definition, so a stub fake would report drift on every run and make the
      // idempotence test vacuous.
      get: async (id) => designs.get(id) as never,
      // The fake must model the REAL contract: `upsertPublished` always lands the row as
      // `status: 'published'`, regardless of what `d.status` says — a stub that just spread `d`
      // through would silently pass a seed that persisted a draft, which is exactly the bug this
      // slice fixes.
      upsertPublished: async (d) => {
        const stored = { ...d, status: 'published' as const };
        designs.set(d.id, stored as never);
        return stored;
      },
    },
    reportDefs: {
      get: async (id) => reportDefs.get(id) as never,
      create: async (r) => {
        reportDefs.set(r.id, { ...r } as never);
        return r;
      },
      update: async (id, r) => {
        reportDefs.set(id, { ...r, id } as never);
        return { ...r, id } as never;
      },
    },
    connectors: { list: async () => connectorList as never },
  };
  return { deps, queries, designs, reportDefs };
}

describe('seedDataDrivenReports', () => {
  it('skips entirely (all zero) when the default connector has not been seeded', async () => {
    const { deps, queries, designs, reportDefs } = fakeDeps([]);
    const res = await seedDataDrivenReports(deps);
    expect(res).toEqual({ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, designsUpdated: 0, reportDefsSeeded: 0, reportDefsUpdated: 0 });
    expect(queries.size).toBe(0);
    expect(designs.size).toBe(0);
    expect(reportDefs.size).toBe(0);
  });

  it('only matches the connector by exact name — a differently-named connector is not enough', async () => {
    const { deps } = fakeDeps([{ id: 'c-other', name: 'Some Other Connector' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res).toEqual({ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, designsUpdated: 0, reportDefsSeeded: 0, reportDefsUpdated: 0 });
  });

  it('resolves the default connector by name and stamps its id onto every seed query', async () => {
    const { deps, queries, designs, reportDefs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    const res = await seedDataDrivenReports(deps);
    expect(res).toEqual({
      queriesSeeded: SEED_QUERIES.length,
      queriesUpdated: 0,
      designsSeeded: SEED_DESIGNS.length,
      designsUpdated: 0,
      reportDefsSeeded: SEED_REPORT_DEFS.length,
      reportDefsUpdated: 0,
    });
    expect(queries.size).toBe(SEED_QUERIES.length);
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-123');
    expect(designs.has('rt-amr-resistance')).toBe(true);
    expect(reportDefs.has('r-amr-resistance')).toBe(true);
  });

  it('is idempotent — re-running with the same connector seeds nothing new', async () => {
    const { deps } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const second = await seedDataDrivenReports(deps);
    expect(second).toEqual({ queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, designsUpdated: 0, reportDefsSeeded: 0, reportDefsUpdated: 0 });
  });

  it('refreshes a built-in DESIGN whose stored content drifted from the shipped definition', async () => {
    const { deps, designs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const target = SEED_DESIGNS[0];
    // Simulate an install carrying an older shipped version of a built-in.
    designs.set(target.id, { ...(designs.get(target.id) as object), name: 'Stale name from an older release' } as never);

    const second = await seedDataDrivenReports(deps);
    expect(second.designsUpdated).toBe(1);
    expect(second.designsSeeded).toBe(0);
    expect((designs.get(target.id) as unknown as { name: string }).name).toBe(target.name);

    // And it settles: a third run finds no drift.
    expect((await seedDataDrivenReports(deps)).designsUpdated).toBe(0);
  });

  it('refreshes a built-in REPORT DEF whose stored content drifted', async () => {
    const { deps, reportDefs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const target = SEED_REPORT_DEFS[0];
    reportDefs.set(target.id, { ...(reportDefs.get(target.id) as object), description: 'stale' } as never);

    const second = await seedDataDrivenReports(deps);
    expect(second.reportDefsUpdated).toBe(1);
    expect((reportDefs.get(target.id) as unknown as { description: string }).description).toBe(target.description);
  });

  it('never touches a user-authored design — only built-in ids are iterated', async () => {
    const { deps, designs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    const mine = { id: 'rd-mine', name: 'My own report', pages: [], parameters: [] };
    designs.set('rd-mine', mine as never);

    await seedDataDrivenReports(deps);
    await seedDataDrivenReports(deps);

    // Byte-identical after two seed passes: the loop iterates SEED_DESIGNS ids, and this is not one.
    expect(designs.get('rd-mine')).toEqual(mine);
  });

  it('refreshes a built-in query whose stored SQL is stale (managed-overwrite), preserving connectorId', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    queries.set('q-test-volume', { id: 'q-test-volume', connectorId: 'operator-conn', sql: 'select 1 from v2_lab_requests', params: [] });
    const res = await seedDataDrivenReports(deps);
    const refreshed = queries.get('q-test-volume')!;
    expect(refreshed.sql).toBe(SEED_QUERIES.find((q) => q.id === 'q-test-volume')!.sql.postgres);
    expect(refreshed.sql).not.toContain('v2_lab_requests');
    expect(refreshed.connectorId).toBe('operator-conn');
    expect(res.queriesUpdated).toBeGreaterThanOrEqual(1);
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length - 1);
  });

  it('does not rewrite a built-in query whose stored SQL already equals the shipped canonical (idempotent)', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    await seedDataDrivenReports(deps);
    const before = new Map([...queries].map(([k, v]) => [k, v.sql]));
    const res2 = await seedDataDrivenReports(deps);
    expect(res2.queriesUpdated).toBe(0);
    expect(res2.queriesSeeded).toBe(0);
    for (const [id, v] of queries) expect(v.sql).toBe(before.get(id));
  });

  it('does not refresh when only the stored params key order differs (jsonb normalizes key order)', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-resistance')!;
    // stored row: canonical sql, but params with keys in a DIFFERENT order (as jsonb read-back would produce)
    const reordered = q.params.map((p) => ({ required: p.required, type: p.type, label: p.label, id: p.id }));
    queries.set('q-amr-resistance', { id: 'q-amr-resistance', connectorId: 'conn-123', sql: q.sql.postgres, params: reordered as never });
    const res = await seedDataDrivenReports(deps);
    expect(res.queriesUpdated).toBe(0); // reorder alone must NOT trigger a refresh
  });

  // Task 2 (mssql-slice2b): seedDataDrivenReports must pick the SQL variant matching the
  // resolved warehouse connector's dialect (reversing Slice 1's "reports skip on MSSQL").
  it('resolves a postgres-typed warehouse connector and seeds the postgres SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-pg', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    await seedDataDrivenReports(deps);
    const testVolume = queries.get('q-test-volume');
    expect(testVolume?.sql).toContain('to_char(');
    expect(testVolume?.sql).not.toContain('format(');
  });

  it('resolves a microsoft-sql-typed warehouse connector by its own name and seeds the mssql SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-mssql', name: 'Target Warehouse (SQL Server)', type: 'microsoft-sql' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length);
    const testVolume = queries.get('q-test-volume');
    expect(testVolume?.sql).toContain('format(');
    expect(testVolume?.sql).not.toContain('to_char(');
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-mssql');
  });

  it('resolves a mysql-typed warehouse connector by its own name and seeds the mysql SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-mysql', name: 'Target Warehouse (MySQL/MariaDB)', type: 'mysql' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length);
    const testVolume = queries.get('q-test-volume');
    // MySQL variant uses substr(...) month bucketing, not to_char/format.
    expect(testVolume?.sql).toContain('substr(');
    expect(testVolume?.sql).not.toContain('to_char(');
    expect(testVolume?.sql).not.toContain('format(');
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-mysql');
  });

  it('seeds every built-in design as PUBLISHED', async () => {
    // ⛔ Capture is gated on published status. A built-in seeded as a draft emits no reference
    // change, so labs receive ZERO designs — the exact failure migration 065 was written to fix
    // (central published 8 reports, each lab got 8 rows with dangling design_ids).
    const { deps, designs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    for (const d of SEED_DESIGNS) {
      expect((designs.get(d.id) as { status?: string } | undefined)?.status).toBe('published');
    }
  });

  it('is still idempotent once designs carry a status', async () => {
    const { deps } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const second = await seedDataDrivenReports(deps);
    expect(second.designsUpdated).toBe(0);
    const third = await seedDataDrivenReports(deps);
    expect(third.designsUpdated).toBe(0);
  });

  // The case that was broken: `update(id, { ...d, status: 'published' })` handed the store a
  // caller-supplied status, but the real store recomputes status from a content comparison and
  // ignores what the caller asked for — so a content-changing refresh on an already-published
  // built-in landed as a DRAFT, and the shipped fix never reached labs (capture is gated on
  // published). `upsertPublished` closes that gap by writing content and publishing atomically.
  it('an upgrade that refreshes a built-in design leaves it published, not stranded as a draft', async () => {
    const { deps, designs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const target = SEED_DESIGNS[0];
    expect((designs.get(target.id) as { status?: string }).status).toBe('published');

    // Simulate an older shipped version already on disk (an upgraded install).
    designs.set(target.id, { ...(designs.get(target.id) as object), name: 'Stale name from an older release' } as never);

    const second = await seedDataDrivenReports(deps);
    expect(second.designsUpdated).toBe(1);
    const refreshed = designs.get(target.id) as unknown as { name: string; status?: string };
    expect(refreshed.name).toBe(target.name);
    expect(refreshed.status).toBe('published');
  });
});

describe('DESIGNS_REQUIRING_DATA', () => {
  it('names the clinical report and its patient & specimen panel', () => {
    expect(DESIGNS_REQUIRING_DATA['rt-clinical-micro']).toBe('hdr');
  });

  // A typo in either half would disable the refusal SILENTLY - `resolved.get(undefined)` never
  // matches, the gate never fires, and an empty report renders exactly as it does today. This is
  // the only thing standing between a one-character slip and the defect coming back.
  it('every entry names a real, BOUND element of the design it claims', () => {
    for (const [designId, elementId] of Object.entries(DESIGNS_REQUIRING_DATA)) {
      const d = SEED_DESIGNS.find((x) => x.id === designId);
      expect(d, `DESIGNS_REQUIRING_DATA names design '${designId}', which is not a seeded design`).toBeDefined();
      const el = d!.pages.flatMap((pg) => pg.elements).find((e) => e.id === elementId);
      expect(el, `${designId}: '${elementId}' is not one of its elements`).toBeDefined();
      expect(el!.dataSource, `${designId}: '${elementId}' is not bound to a query`).toBeDefined();
    }
  });
});

describe('SEED_DESIGNS — every built-in image source would survive the API gate', () => {
  it('every built-in design has an image source the API would accept', () => {
    // ⛔ The seed writes designs straight through the store, bypassing the route-level image gate
    // (`ReportDesignSchema.safeParse` + `findInvalidImageSources`, `apps/server/src/
    // report-designs-routes.ts`). A built-in shipping a refused source would install fine and then
    // be unsavable by any operator who opened it — the API would 400 the very design the boot seed
    // just wrote.
    expect(SEED_DESIGNS.flatMap((d) => findInvalidImageSources(d))).toEqual([]);
  });
});

describe('SEED_QUERIES — every entry carries all three dialect variants', () => {
  it('has non-empty sql.postgres, sql.mssql, and sql.mysql for every seed query', () => {
    for (const q of SEED_QUERIES) {
      expect(q.sql.postgres.trim().length).toBeGreaterThan(0);
      expect(q.sql.mssql.trim().length).toBeGreaterThan(0);
      expect(q.sql.mysql.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('SEED_QUERIES — q-amr-resistance', () => {
  it('declares from/to/facility as plain params matching the flat {from,to,facility} rawParams shape', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-resistance');
    expect(q).toBeTruthy();
    expect(q?.params).toEqual([
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ]);
    // {{param.*}} tokens present in the SQL must all be declared params, or substituteParams
    // throws "unbound parameter" at run time. Checked for ALL THREE dialect variants.
    for (const variant of [q?.sql.postgres, q?.sql.mssql, q?.sql.mysql]) {
      const tokens = [...(variant?.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
      expect(new Set(tokens)).toEqual(new Set(['from', 'to', 'facility']));
    }
  });
});

// `abnormal_flag in ('S','I','R')` alone does NOT mean "an antibiotic susceptibility result".
// Measured on real DISA data (TDS, 2026-08-02) that filter selects 18,732 rows of which only ~118
// are bacterial AST — 87% are EQA proficiency panels (100% R by design) and ~2,150 are HIV
// antiretroviral resistance. Every AMR query must therefore anchor the AST to a specimen that also
// produced an organism (LOINC 634-6). Three of the five already did; q-amr-resistance and
// q-amr-facility-summary did not, and this pins all five so the gap cannot reopen.
describe('SEED_QUERIES — every AMR query anchors S/I/R to an isolate', () => {
  const AMR_QUERY_IDS = [
    'q-amr-resistance',
    'q-amr-facility-summary',
    'q-amr-antibiogram',
    'q-amr-first-isolate-summary',
    'q-amr-glass-ris',
  ] as const;

  for (const id of AMR_QUERY_IDS) {
    it(`${id} requires an organism observation in every dialect`, () => {
      const q = SEED_QUERIES.find((x) => x.id === id);
      expect(q, `${id} missing from SEED_QUERIES`).toBeTruthy();
      for (const [dialect, sql] of Object.entries(q!.sql)) {
        // Vacuity guard: the assertion below is only meaningful for a query that actually
        // filters on S/I/R. If that filter ever moves, fail loudly rather than pass silently.
        expect(sql, `${id}/${dialect} no longer filters on S/I/R`).toMatch(/abnormal_flag in \('S', ?'I', ?'R'\)/);
        expect(sql, `${id}/${dialect} does not anchor to an isolate`).toContain('634-6');
      }
    });
  }

  // The two that had to be repaired — assert the specific predicate, not just the literal, so a
  // stray '634-6' in a comment or an unrelated clause cannot satisfy the check above.
  for (const id of ['q-amr-resistance', 'q-amr-facility-summary'] as const) {
    it(`${id} correlates the isolate to the AST's own specimen in every dialect`, () => {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} lost the correlated exists(...)`).toContain(
          "exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)",
        );
        // An AST with no specimen can never be tied to an isolate; excluding it keeps the
        // exists(...) from being satisfied by a NULL-to-NULL comparison quirk on any engine.
        expect(sql, `${id}/${dialect} does not require a specimen`).toContain("o.specimen_id is not null and o.specimen_id <> ''");
      }
    });
  }
});

describe('SEED_REPORT_DEFS — r-amr-resistance', () => {
  it('links rt-amr-resistance + q-amr-resistance with the catalog report’s metrics/chart/options', () => {
    const def = SEED_REPORT_DEFS.find((r) => r.id === 'r-amr-resistance');
    expect(def).toMatchObject({
      category: 'amr',
      designId: 'rt-amr-resistance',
      primaryQueryId: 'q-amr-resistance',
      paramOptions: { facility: 'q-facilities' },
      status: 'published',
    });
  });
});

describe('ANTIBIOGRAM_PANEL', () => {
  it('includes every antibiotic actually present in the dev analytics DB (Task 6.1)', () => {
    // select distinct code_text from observations where interpretation_code in ('S','I','R')
    // order by 1 -- confirmed live against the dev DB (docker compose postgres, openldr_target).
    for (const a of ['Ampicillin', 'Ceftriaxone', 'Ciprofloxacin', 'Gentamicin']) {
      expect(ANTIBIOGRAM_PANEL).toContain(a);
    }
  });
});

// Regression: the panel used to compare against `observation_desc` (prose), so real results missed
// their own column. Measured across all 22 v1 sites on 2026-08-02.
describe('antibiotic normalisation', () => {
  const canonicalFor = (code: string) =>
    Object.entries(ANTIBIOTIC_CODES).find(([, codes]) => codes.includes(code))?.[0];

  it('collapses the synonym groups that silently dropped results', () => {
    // 200 "Cotrimoxazole" results never reached the "Trimethoprim/Sulfamethoxazole" column —
    // the same drug spelled the other way. Only the 3 SXT ones landed.
    expect(canonicalFor('COTRI')).toBe('Trimethoprim/Sulfamethoxazole');
    expect(canonicalFor('SXT')).toBe('Trimethoprim/Sulfamethoxazole');
    // Written three ways in the data, matching none of them.
    for (const c of ['AMC', 'AUG', 'AUGUM']) expect(canonicalFor(c)).toBe('Amoxicillin/Clavulanate');
    // Missed on a trailing asterisk / a single letter.
    for (const c of ['AMP', 'AMPIC']) expect(canonicalFor(c)).toBe('Ampicillin');
    for (const c of ['GENTA', 'GENT']) expect(canonicalFor(c)).toBe('Gentamicin');
  });

  it('covers every antibiotic measured on real culture requests', () => {
    // Codes carrying S/I/R on requests that also had an organism, all sites. If a deployment adds
    // one, it lands in the review bucket rather than vanishing — but these are already known.
    const measured = ['CIPRO', 'COTRI', 'GENTA', 'AMIK', 'AMP', 'CEFTA', 'CEF', 'CLIND', 'CHLOR',
      'NITRO', 'ERYTH', 'VANCO', 'NORF', 'TETRA', 'AMC', 'PIPER', 'AMPIC', 'AZYT', 'CTX', 'CEFAZ',
      'AUG', 'OXACI', 'PENG', 'CEFOX', 'IMIP', 'AUGUM', 'RIF', 'CEPHR', 'SXT', 'NALID', 'TOBRA', 'GENT'];
    for (const code of measured) expect(canonicalFor(code), `${code} is unmapped`).toBeTruthy();
  });

  it('never maps one code to two different antibiotics', () => {
    const seen = new Map<string, string>();
    for (const [display, codes] of Object.entries(ANTIBIOTIC_CODES)) {
      for (const code of codes) {
        expect(seen.has(code), `${code} mapped to both ${seen.get(code)} and ${display}`).toBe(false);
        seen.set(code, display);
      }
    }
  });

  it('deliberately leaves non-drugs and ambiguous combined results unmapped', () => {
    // These carry S/I/R on culture specimens but are not a single agent. Surfacing them in the
    // review bucket is the point — attributing them to a drug column would be worse.
    for (const code of ['AST', 'CEFOT', 'EPI', 'WEPI', 'PSHY', 'YEAST']) {
      expect(canonicalFor(code), `${code} should not be mapped to a drug`).toBeUndefined();
    }
  });

  it('puts the review bucket last so the matrix always has somewhere to put an unknown', () => {
    expect(ANTIBIOGRAM_PANEL[ANTIBIOGRAM_PANEL.length - 1]).toBe(UNMAPPED_ANTIBIOTIC);
    expect(ANTIBIOGRAM_PANEL.filter((a) => a === UNMAPPED_ANTIBIOTIC)).toHaveLength(1);
  });

  it('buckets unknowns only in the matrix, and preserves them in the long-format reports', () => {
    // A matrix needs a closed column set; a long-format report does not, and collapsing every
    // unknown into one row there would merge distinct findings.
    expect(antibioticNormalizeSql('bucket')).toContain(`else '${UNMAPPED_ANTIBIOTIC}'`);
    expect(antibioticNormalizeSql('passthrough')).toContain('coalesce(o.observation_desc, o.observation_code');

    const antibiogram = SEED_QUERIES.find((x) => x.id === 'q-amr-antibiogram')!;
    for (const [dialect, sql] of Object.entries(antibiogram.sql)) {
      expect(sql, `antibiogram/${dialect}`).toContain(`else '${UNMAPPED_ANTIBIOTIC}'`);
    }
    for (const id of ['q-amr-glass-ris', 'q-amr-first-isolate-summary'] as const) {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} must not bucket unknowns`).toContain('coalesce(o.observation_desc, o.observation_code');
      }
    }
  });

  it('normalises by code in every AMR query that reports an antibiotic, in every dialect', () => {
    for (const id of ['q-amr-antibiogram', 'q-amr-glass-ris', 'q-amr-first-isolate-summary'] as const) {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} still matches on prose`).not.toContain('o.observation_desc as antibiotic');
        expect(sql, `${id}/${dialect} lost the COTRI synonym`).toContain("'COTRI', 'SXT'");
      }
    }
  });
});

// Regression: this report grouped by `patients.managing_organization`, which the CDR/DISA source
// never sets (1 of 589 patients measured, and that one is the seed), so it returned ZERO rows on
// real data while the other four AMR reports worked.
describe('SEED_QUERIES — q-amr-facility-summary takes its facility from the report', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-amr-facility-summary')!;

  it('groups by the report performer, falling back to the patient organization', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not group by the report performer`)
        .toContain('group by coalesce(f.performer, p.managing_organization)');
      expect(sql, `${dialect} still groups by the patient organization alone`)
        .not.toMatch(/group by p\.managing_organization/);
    }
  });

  it('collapses reports to one row per specimen before joining — the fan-out guard', () => {
    // Reports are per-ORDER, not per-specimen: 521 specimens carry 2 and some carry up to 14, so a
    // direct join to diagnostic_reports would multiply every AST count by the report count.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the facility_of CTE`).toContain('facility_of as (');
      expect(sql, `${dialect} does not deduplicate reports per specimen`)
        .toMatch(/select specimen_id, min\(performer\) as performer[\s\S]*group by specimen_id/);
      expect(sql, `${dialect} must join the collapsed CTE, not the raw table`)
        .toContain('left join facility_of f on f.specimen_id = o.specimen_id');
      expect(sql, `${dialect} joins diagnostic_reports directly and will fan out`)
        .not.toMatch(/join diagnostic_reports [a-z]+ on/);
    }
  });

  it('joins patients LEFT so a missing patient does not drop a facility total', () => {
    // The facility no longer comes from the patient, so an inner join would silently discard
    // results whose patient row is absent.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still inner-joins patients`).not.toMatch(/\njoin patients p on/);
      expect(sql, `${dialect}`).toContain('left join patients p on o.patient_id = p.id');
    }
  });

  it('matches the observed coding namespace too, not the feed alone (FAC-P0-07)', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.performer_system\s*=\s*coalesce\(f\.performer_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/min\(performer_system\) as performer_system/);
    }
  });
});

describe('SEED_QUERIES — the facility picker offers real facilities', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-facilities')!;

  it('reads the report performer, not the patient organization', () => {
    // patients.managing_organization is set on 1 of 3714 rows — and that one is the seed — so the
    // dropdown offered exactly one fake option, "Organization/seed-org".
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still reads the patient organization`)
        .not.toMatch(/managing_organization/);
      expect(sql, `${dialect} does not read diagnostic_reports`).toContain('from diagnostic_reports');
    }
  });

  it('returns the CODE first and the resolved NAME second', () => {
    // Column ORDER is the contract optionsDataDriven reads: 0 = value, 1 = label.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the value column`).toMatch(/dr\.performer as value/);
      expect(sql, `${dialect} lost the label column`)
        .toContain('min(coalesce(fm.name, dr.performer_display, dr.performer)) as label');
    }
  });

  it('resolves through facility_map with the same NULL source_system guard as the clinical header', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.source_system\s*=\s*coalesce\(dr\.source_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/fm\.source_code\s*=\s*dr\.performer\b/);
    }
  });

  it('matches the observed coding namespace too, not the feed alone (FAC-P0-07)', () => {
    // The dimension is keyed on (feed, namespace, code). Joining on feed+code alone lets one
    // namespace's curated name answer for a different namespace's identical code.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.performer_system\s*=\s*coalesce\(dr\.performer_system, ''\)/);
    }
  });

  it('GROUPS by the code instead of SELECT DISTINCT on the (code, label) pair', () => {
    // `dr.performer_display` is free text off the wire (fm.name is null for 87 of 88 live
    // codes), so the label almost always falls through to it. `select distinct value, label`
    // dedupes the PAIR, not the code — two reports at one facility whose display text differs
    // by casing/whitespace produced two options sharing one `value`: a duplicate React key and
    // a duplicated, ambiguous dropdown entry. Same defect as q-amr-facility-summary, fixed the
    // same way: group by the code, aggregate (min()) the label.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still SELECT DISTINCTs the pair instead of grouping the code`)
        .not.toMatch(/select distinct/i);
      expect(sql, `${dialect} lost the code grouping`).toMatch(/group by dr\.performer\b/);
      expect(sql, `${dialect} label is not aggregated and can fork per code`)
        .toMatch(/min\(coalesce\(fm\.name, dr\.performer_display, dr\.performer\)\) as label/);
    }
  });
});

describe('SEED_QUERIES — q-amr-facility-summary labels by name but groups by code', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-amr-facility-summary')!;

  it('projects a resolved name', () => {
    // Since the feed split the facility into code + display, this rendered the raw code "NICD".
    // The label sources are aggregated (min()) so that display-text variance across specimens at
    // the SAME facility (casing, whitespace) cannot fork the group below.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      // Every branch is its own aggregate (not nested inside the outer coalesce) so MySQL 8's
      // default ONLY_FULL_GROUP_BY accepts it — see the ⛔ MYSQL ONLY_FULL_GROUP_BY comment on
      // q-amr-facility-summary in report-seeds.ts.
      expect(sql, `${dialect} does not resolve the facility label`)
        .toContain('coalesce(min(fm.name), min(f.performer_display), min(f.performer), min(p.managing_organization)) as facility');
    }
  });

  it('⛔ still GROUPS on the code, never on the resolved label', () => {
    // Grouping by label merges the five "Aga Khan" laboratories into one row the day the other
    // four codes arrive. The code is the identity; the label is presentation.
    //
    // This asserts the OUTER GROUP BY clause EXACTLY, not an unanchored substring search — an
    // earlier version of this test used `toMatch(/group by[\s\S]*f\.performer/)`, which is
    // satisfied by the `facility_of` CTE's OWN `group by specimen_id` followed by the `f.performer`
    // that legitimately reappears inside the projected label expression, so it kept passing even
    // after the outer clause was mutated to the forbidden `group by 1`.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} groups by the resolved label and will merge facilities`)
        .not.toMatch(/group by coalesce\(fm\.name/);
      expect(sql, `${dialect} lost the code grouping`)
        .toContain('group by coalesce(f.performer, p.managing_organization)');
      expect(sql, `${dialect} groups by row position instead of the identity — splits one facility across rows`)
        .not.toMatch(/group by 1\b/);
    }
  });
});

// The human-facing AMR reports printed raw source codes (VIBCO, SHIFL, ACIBA) as the pathogen.
// The display name sits beside the code in `lab_results.text_value` ("Vibrio cholera 01 Ogawa").
describe('SEED_QUERIES — pathogens are labelled by name but grouped by code', () => {
  for (const id of ['q-amr-antibiogram', 'q-amr-first-isolate-summary'] as const) {
    it(`${id} labels rows with the name in every dialect`, () => {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} still labels rows with the raw code`)
          .not.toMatch(/pathogen_code as ["`]?pathogen["`]?,/);
        expect(sql, `${id}/${dialect} does not label rows with the name`)
          .toMatch(/pathogen_name as ["`\\]*pathogen["`\\]*,/);
        // The code remains the identity: dedup and grouping must not move to the free-text name,
        // or two codes sharing a description would silently merge into one organism.
        expect(sql, `${id}/${dialect} lost the code from the grouping`).toMatch(/group by[^\n]*pathogen_code/);
      }
    });
  }

  it('q-amr-glass-ris keeps a CODE in its PathogenCode column', () => {
    // GLASS RIS is a submission shape, not a reading surface — a column named PathogenCode must
    // carry a code even though the neighbouring reports now show names.
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-glass-ris')!;
    for (const [dialect, sql] of Object.entries(q.sql)) {
      expect(sql, `glass/${dialect}`).toMatch(/pathogen_code as ["`\\]*PathogenCode["`\\]*,/);
    }
  });
});

// `Year: 0` was shipped into every row of a GLASS submission file. The isolate's own date is
// populated on 47 of 47 measured isolates, so the year is derived from it instead.
describe('SEED_QUERIES — q-amr-glass-ris derives the reporting year', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-amr-glass-ris')!;

  it('reads the year off the isolate date, with the operator parameter still winning', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still hardcodes year 0`).not.toContain(`coalesce(nullif({{param.year}}, ''), '0')`);
      expect(sql, `${dialect} does not derive the year`).toMatch(/coalesce\(nullif\(\{\{param\.year\}\}, ''\), subs\w+\(fi\.iso_date, 1, 4\), '0'\) as iso_year/);
    }
  });

  it('uses substring() on T-SQL, which has no substr()', () => {
    expect(q().sql.mssql).toContain('substring(fi.iso_date, 1, 4)');
    expect(q().sql.postgres).toContain('substr(fi.iso_date, 1, 4)');
    expect(q().sql.mysql).toContain('substr(fi.iso_date, 1, 4)');
  });

  it('reads the year off the TEXT column — never a timestamp cast', () => {
    // Casting would throw on the partial-precision FHIR dates the warehouse legitimately stores.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} casts iso_date to a timestamp`).not.toMatch(/iso_date\s*(::|as\s+)timestamp/i);
    }
  });

  it('groups by the year so two years are never summed into one row', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} omits iso_year from the grouping`).toMatch(/group by[^\n]*iso_year/);
    }
  });
});

describe('SEED_QUERIES — q-amr-antibiogram', () => {
  it('declares from/to as required plain params and generates one CASE column per panel antibiotic', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-antibiogram');
    expect(q).toBeTruthy();
    expect(q?.params).toEqual([
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ]);
    for (const variant of [q?.sql.postgres, q?.sql.mssql]) {
      const tokens = [...(variant?.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
      expect(new Set(tokens)).toEqual(new Set(['from', 'to']));
      for (const a of ANTIBIOGRAM_PANEL) expect(variant).toContain(`"${a}"`);
      expect(variant).toContain('group by pathogen_code');
    }
    // The mysql variant uses BACKTICK aliases (double quotes are string literals in MySQL),
    // so assert the backtick-quoted identifier instead of the double-quoted one.
    {
      const tokens = [...(q?.sql.mysql?.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
      expect(new Set(tokens)).toEqual(new Set(['from', 'to']));
      for (const a of ANTIBIOGRAM_PANEL) expect(q?.sql.mysql).toContain(`\`${a}\``);
      expect(q?.sql.mysql).toContain('group by pathogen_code');
    }
  });
});

describe('SEED_DESIGNS — rt-amr-antibiogram', () => {
  it('covers pathogen + every panel antibiotic, on a Letter/landscape page', () => {
    // ⚠ This used to assert the DESIGN's boundColumns listed the whole panel. The design is now
    // transposed and deliberately emits none — after the flip its headers are the organisms, which
    // a static design cannot enumerate. The coverage guarantee therefore moved to the QUERY, which
    // is where it actually lives: if the query stops projecting an agent, that column disappears
    // from the report no matter what the design says.
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram');
    expect(d).toBeTruthy();
    expect(d?.paper).toBe('Letter');
    expect(d?.orientation).toBe('landscape');
    const sql = SEED_QUERIES.find((q) => q.id === 'q-amr-antibiogram')!.sql.postgres;
    expect(sql).toContain('as pathogen');
    for (const agent of ANTIBIOGRAM_PANEL) {
      expect(sql, `q-amr-antibiogram stopped projecting ${agent}`).toContain(agent);
    }
  });

  // ⛔ P0-05. The cells read `0% (1)` and `100% (1)`. Nothing on the page said the percentage was
  // RESISTANT — the meaning lived only in the Reports-page `description`, which is not on the PDF.
  // A reader saw 100% and read excellent susceptibility. It means the opposite.
  //
  // ⚠ Rendered-PDF regression: the metric used to ALSO carry "the figure in parentheses is the
  // number of isolates tested", and rendering the real PDF showed it ellipsized off the page — the
  // scope panel is a narrow two-column keyvalue box, not the full page width. That sentence now
  // lives on the LEGEND (full content width, does not truncate), so this test only checks the
  // metric for "resistant"; the "what is the parenthesised number" assertion moved to the legend
  // test below, next to "explains a blank cell", so both live where the reader actually sees them.
  it('states on the document that the percentage is resistant', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram')!;
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-amr-antibiogram-meta')!;
    const metric = (panel.rows as [string, string][]).find(([k]) => k === 'Metric');
    expect(metric).toBeDefined();
    expect(metric![1]).toMatch(/resistant/i);
  });

  // ⛔ P0-07 + the parenthesised-count explanation (moved here from the metric — see above).
  // antibiogramCellSql emits '' when sum(...) = 0 for that antibiotic — which is true both when the
  // antibiotic was never tested AND when it was tested but the result carried no S/I/R
  // interpretation (ast_obs filters `abnormal_flag in ('S','I','R')`, report-seeds.ts:1609). "Not
  // tested" over-claims the second case, so the legend states the one thing a blank always means:
  // no S/I/R result was recorded. When P0-06 adds suppression, it extends this line with its own
  // token.
  it('explains what the parenthesised number is, and a blank cell, on the document', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram')!;
    const legend = d.pages[0].elements.find((e) => e.id === 'rt-amr-antibiogram-legend')!;
    expect(legend.kind).toBe('text');
    expect(legend.text).toMatch(/tested/i);
    expect(legend.text).toMatch(/blank/i);
    expect(legend.text).toMatch(/no susceptibility result was recorded/i);
  });
});

// Guard against the exact defect above reopening silently: every unit test asserted the design
// OBJECT's string, never the box pdfkit renders it into, so an over-budget metric passed every
// test while the real PDF ellipsized it (the GLASS metric fit its own budget by 0.9pt). This
// used to live only inside the antibiogram describe block above and check ONE named design, so it
// never ran against GLASS or any design added later. Hoisted to top level and iterates every
// design in SEED_DESIGNS, checking whichever ones carry a static 'Metric' scope pair (built by
// `simpleTableDesign`'s `spec.metric`, see `./simple-design.ts`) — so a future design, or a
// lengthened existing one, cannot reopen this silently.
describe('SEED_DESIGNS — every design keeps its Metric value un-ellipsized', () => {
  it('keeps each design\'s metric VALUE short enough to render un-ellipsized in its scope panel', () => {
    let checked = 0;
    for (const d of SEED_DESIGNS) {
      for (const page of d.pages) {
        for (const el of page.elements) {
          if (el.kind !== 'keyvalue' || !el.rows) continue;
          const rows = el.rows as [string, string][];
          const metricIndex = rows.findIndex(([k]) => k === 'Metric');
          if (metricIndex < 0) continue;
          checked += 1;

          // Same conversion `drawElement` applies before calling `pairRects`: the design rect is
          // px@96, pairRects' own constants (KV_PAD_X, KV_GUTTER, KV_LABEL_FRAC, ...) are raw
          // points.
          const box = toPt(el.rect);
          const pairs = pairRects(box, rows.length, el.layout ?? 'inline', el.panelColumns ?? 1, false);
          const valueBoxW = pairs[metricIndex].value.w;

          // pdfkit itself is not reachable from this test: it is a dependency of
          // `@openldr/report-designer`, not a direct dependency of `@openldr/reporting`, so
          // `doc.widthOfString` cannot be called here to get an exact glyph measurement. In its
          // place: a CONSERVATIVE average Helvetica character width of 0.6em (60% of
          // KV_VALUE_SIZE, the panel's 8pt value font in draw.ts) — wider than Helvetica's
          // typical ~0.5em average for running English text, so a string that fits this budget
          // is guaranteed to fit the real render. This is a FLOOR, not pdfkit's true limit: it
          // may refuse a string pdfkit would actually still fit, but it cannot pass a string
          // pdfkit would ellipsize.
          const CONSERVATIVE_AVG_CHAR_W_PT = 0.6 * 8;
          const budget = Math.floor(valueBoxW / CONSERVATIVE_AVG_CHAR_W_PT);

          expect(
            rows[metricIndex][1].length,
            `${d.id}: metric "${rows[metricIndex][1]}" must fit roughly ${budget} chars `
              + `at an ${valueBoxW.toFixed(1)}pt-wide value column`,
          ).toBeLessThanOrEqual(budget);
        }
      }
    }
    // A design that carries no Metric pair at all would make this test pass vacuously. Pin the
    // count so a refactor that stops the loop from finding GLASS/antibiogram fails loudly instead
    // of silently checking nothing.
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe('SEED_REPORT_DEFS — r-amr-antibiogram', () => {
  it('links rt-amr-antibiogram + q-amr-antibiogram, no facility filter, matching the catalog’s pathogens count metric', () => {
    const def = SEED_REPORT_DEFS.find((r) => r.id === 'r-amr-antibiogram');
    expect(def).toMatchObject({
      category: 'amr',
      designId: 'rt-amr-antibiogram',
      primaryQueryId: 'q-amr-antibiogram',
      summaryMetrics: [{ id: 'pathogens', label: 'Pathogens', type: 'count' }],
      paramOptions: null,
      status: 'published',
    });
  });
});

// ---------------------------------------------------------------------------
// The AMR date predicate — ONE shared chain, in EVERY dialect.
//
// The bug: `q-amr-resistance` and `q-amr-facility-summary` compared
// `o.result_timestamp` BARE against the range. `result_timestamp` was NULL on
// 135/135 ingested rows (the mapper stubbed it), and `NULL >= x` is never true,
// so both returned ZERO rows for ANY date range — silently. The other three
// survived via `coalesce(result_timestamp, received_time)` plus an `is null`
// escape: someone solved this once and patched 3 of 5.
//
// ⚠ These are STRUCTURAL assertions on the SQL text, per dialect. The design
// assumed only "a live run on a real MSSQL/MySQL warehouse" could catch a
// dropped escape — but the seeds are strings, so the drop is catchable here,
// on every dialect, with no warehouse. The five amr-*-parity tests assert
// NOTHING (it.skip + expect(true).toBe(true)), so this is the only cover.
// ---------------------------------------------------------------------------

const AMR_DATE_QUERIES = [
  'q-amr-resistance',
  'q-amr-facility-summary',
  'q-amr-glass-ris',
  'q-amr-first-isolate-summary',
  'q-amr-antibiogram',
] as const;

describe('SEED_QUERIES — AMR date filtering is NULL-safe in every dialect', () => {
  it('never compares a bare result_timestamp against the range', () => {
    // The mutation this kills: reverting any dialect to `and o.result_timestamp >= {{param.from}}`.
    // A bare comparison on a nullable column silently drops every row with no time.
    for (const id of AMR_DATE_QUERIES) {
      const q = SEED_QUERIES.find((x) => x.id === id);
      expect(q, `${id} must exist`).toBeTruthy();
      for (const [dialect, sql] of Object.entries(q!.sql)) {
        expect(/and\s+o+\.result_timestamp\s*[<>]=/.test(sql), `${id}/${dialect} compares result_timestamp BARE`).toBe(false);
      }
    }
  });

  it('wraps every range comparison in the coalesce chain, in all three dialects', () => {
    for (const id of AMR_DATE_QUERIES) {
      const q = SEED_QUERIES.find((x) => x.id === id);
      for (const [dialect, sql] of Object.entries(q!.sql)) {
        expect(/coalesce\(o+\.result_timestamp,\s*s\.received_time\)/.test(sql), `${id}/${dialect} lacks the coalesce chain`).toBe(true);
      }
    }
  });

  it('keeps the fail-open `is null` escape in all three dialects', () => {
    // FAIL-OPEN: a record with NO time stays VISIBLE rather than silently
    // vanishing. Loud and slightly wrong beats quiet and wrong.
    // The mutation this kills: dropping the escape from ONE dialect — which
    // would make that dialect alone return fewer rows, invisibly.
    for (const id of AMR_DATE_QUERIES) {
      const q = SEED_QUERIES.find((x) => x.id === id);
      for (const [dialect, sql] of Object.entries(q!.sql)) {
        expect(/coalesce\(o+\.result_timestamp,\s*s\.received_time\)\s+is null/.test(sql), `${id}/${dialect} lost the is-null escape`).toBe(true);
      }
    }
  });

  it('joins specimens wherever the chain reads s.received_time', () => {
    // The chain is meaningless without the join — and the two broken queries had
    // NO specimen join at all, so this is what makes the fix real rather than
    // referencing a phantom alias.
    for (const id of AMR_DATE_QUERIES) {
      const q = SEED_QUERIES.find((x) => x.id === id);
      for (const [dialect, sql] of Object.entries(q!.sql)) {
        expect(/join\s+specimens\s+s\s+on/.test(sql), `${id}/${dialect} reads s.received_time with no specimens join`).toBe(true);
      }
    }
  });

  it('preserves each dialect’s OWN end-of-day concat operator', () => {
    // ⚠ VACUITY GUARD. Every assertion above would pass if all three dialects
    // held the same postgres string. They must NOT: `||` (pg), `+` (mssql),
    // `concat()` (mysql). A find-and-replace across dialects is the exact
    // mistake the design warned about, and it ships SQL that cannot parse.
    for (const id of AMR_DATE_QUERIES) {
      const q = SEED_QUERIES.find((x) => x.id === id);
      expect(q!.sql.postgres, `${id}/postgres`).toMatch(/\{\{param\.to\}\}\s*\|\|\s*'T23:59:59\.999Z'/);
      expect(q!.sql.mssql, `${id}/mssql`).toMatch(/\{\{param\.to\}\}\s*\+\s*'T23:59:59\.999Z'/);
      expect(q!.sql.mysql, `${id}/mysql`).toMatch(/concat\(\{\{param\.to\}\},\s*'T23:59:59\.999Z'\)/);
    }
  });
});

describe('SEED_QUERIES — q-turnaround-time excludes partial-precision timestamps', () => {
  // Regression: `Specimen.receivedTime` is a FHIR `dateTime`, and CE's DATETIME_RE accepts
  // year ('2026') and year-month ('2026-07') precision. Those land verbatim in the TEXT
  // column `specimens.received_time`, and `'2026-07'::timestamptz` throws in Postgres —
  // failing the ENTIRE report with a 500 rather than skipping the offending row. Real data
  // from the CDR/DISA bridge hit exactly this.
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-turnaround-time')!;

  it('guards received_time before it is ever cast, in all three dialects', () => {
    // The mutation this kills: reverting any dialect to a bare
    // `received_time is not null`, which lets a partial value reach the cast.
    expect(q().sql.postgres).toMatch(
      /received_time\s+~\s+'\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T/,
    );
    expect(q().sql.mysql).toMatch(
      /received_time\s+regexp\s+'\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T/,
    );
    // T-SQL has no regex; the LIKE pins the same full YYYY-MM-DDThh:mm:ss prefix.
    expect(q().sql.mssql).toMatch(
      /received_time\s+like\s+'(\[0-9\]){4}-(\[0-9\]){2}-(\[0-9\]){2}T/,
    );
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(
        /received_time\s+is\s+not\s+null/.test(sql),
        `${dialect} still relies on a bare received_time null-check`,
      ).toBe(false);
    }
  });

  it('guards issued symmetrically, in all three dialects', () => {
    // `issued` is typed FHIR `instant` so it should always be full precision, but the
    // cast is equally fatal and nothing in the SQL layer re-checks the column.
    expect(q().sql.postgres).toMatch(/dr\.issued\s+~\s+'\^\[0-9\]\{4\}/);
    expect(q().sql.mysql).toMatch(/dr\.issued\s+regexp\s+'\^\[0-9\]\{4\}/);
    expect(q().sql.mssql).toMatch(/dr\.issued\s+like\s+'(\[0-9\]){4}/);
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(
        /dr\.issued\s+is\s+not\s+null/.test(sql),
        `${dialect} still relies on a bare issued null-check`,
      ).toBe(false);
    }
  });

  it('keeps the guard INSIDE the received CTE, before min()', () => {
    // min() here is a LEXICAL text min, so '2026-07' sorts BEFORE that patient's real
    // full-precision receipts (shorter prefix wins) and would poison every report paired
    // to that patient. Filtering after the CTE would not prevent that.
    // The mutation this kills: hoisting the guard out into the `paired` WHERE clause.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      const cte = sql.slice(sql.indexOf('received as ('), sql.indexOf('paired as ('));
      expect(/received_time/.test(cte), `${dialect} CTE lost received_time`).toBe(true);
      expect(
        /(~|regexp|like)/.test(cte),
        `${dialect} moved the precision guard out of the received CTE`,
      ).toBe(true);
    }
  });
});

describe('SEED_DESIGNS — rt-clinical-micro uses real keyvalue panels', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-clinical-micro')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('renders the patient/specimen band as a keyvalue panel, not a one-row table', () => {
    // Until S4 this was a `table` bound to the header query, so its column LABELS printed as a
    // header band above a single row of values — a spreadsheet fragment where the reference shows
    // a metadata block. A regression back to `kind: 'table'` here is invisible in a diff of ids.
    expect(el('hdr').kind).toBe('keyvalue');
    expect(el('org').kind).toBe('keyvalue');
    expect(design().pages[0].elements.filter((e) => e.kind === 'table').map((e) => e.id)).toEqual(['tbl']);
  });

  it('keeps both panels bound to the SAME header query, one row serving both', () => {
    for (const id of ['hdr', 'org']) {
      expect(el(id).dataSource).toEqual({ kind: 'custom-query', queryId: 'q-clinical-micro-header' });
      expect(el(id).boundColumns?.length).toBeGreaterThan(0);
    }
  });

  it('projects only keys the header query actually selects', () => {
    const sql = SEED_QUERIES.find((q) => q.id === 'q-clinical-micro-header')!.sql.postgres;
    for (const id of ['hdr', 'org']) {
      for (const c of el(id).boundColumns ?? []) {
        // ⚠ `\\b`, inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a regex
        // word boundary, so the pattern becomes `as panel\x08` and never matches anything.
        expect(new RegExp(`as ${c.key}\\b`).test(sql), `${id}.${c.key} is not selected by the header query`).toBe(true);
      }
    }
  });

  it('lays the header out in two pair columns and the isolate stacked', () => {
    expect(el('hdr').layout).toBe('inline');
    expect(el('hdr').panelColumns).toBe(2);
    expect(el('org').layout).toBe('stacked');
    expect(el('org').text).toBe('ORGANISM ISOLATED');
  });

  it('names the performing laboratory and where it is', () => {
    // The report never said which lab produced the result. On a national instance the letterhead is
    // the MINISTRY, so nothing else on the page supplies it — and five DISA codes share the display
    // "Aga Khan", so the name alone does not identify a laboratory either.
    const keys = (el('hdr').boundColumns ?? []).map((c) => c.key);
    expect(keys).toContain('performing_lab');
    expect(keys).toContain('lab_location');
  });

  it('fits every header pair inside the panel box', () => {
    // ⛔ `toPt` FIRST. `drawElement` converts the design rect px@96 -> pt and only then calls
    // `pairRects`, whose KV_PAD_Y/KV_INLINE_H are raw POINTS. Measuring with the unconverted rect
    // mixes two scales and reports a row that overflows as fitting — this test passed while the
    // rendered page had its fifth row sliced in half by the band below it.
    // ⛔ Pairs past the box bottom are CLIPPED by the drawer (`doc.clip()`), not overflowed, so an
    // eleventh field would VANISH with no error. This assertion is the only thing that makes that
    // a failing test instead of a silent regression.
    const hdr = el('hdr');
    const n = (hdr.boundColumns ?? []).length;
    const box = toPt(hdr.rect);
    const pairs = pairRects(box, n, 'inline', hdr.panelColumns ?? 1, !!(hdr.text ?? '').trim());
    const last = pairs[n - 1];
    expect(
      last.y + last.h,
      `pair ${n} falls outside the panel and will be silently clipped`,
    ).toBeLessThanOrEqual(box.y + box.h);
  });

  it('has room for the ten pairs it binds and no more', () => {
    // Measured against the real path (toPt then pairRects): at h=104px the box bottom is 192pt,
    // ten pairs end at 188pt, twelve end at 202pt. Field eleven must therefore grow `h` AND push
    // `org`/`band`/`bandt`/`tbl` down, exactly as this slice did when it went from eight to ten.
    const hdr = el('hdr');
    const box = toPt(hdr.rect);
    const twoMore = pairRects(box, 12, 'inline', hdr.panelColumns ?? 1, false)[11];
    expect(
      twoMore.y + twoMore.h,
      'the panel has silently gained room for another row — re-check the capacity comment',
    ).toBeGreaterThan(box.y + box.h);
  });

  it('leaves no element overprinting another', () => {
    // The panels are taller than the tables they replaced; a stale `y` silently overprints.
    // ⚠ Must be a 2D intersection. A vertical-band-only check calls every side-by-side pair an
    // overlap — the header barcode shares rows with the report title and is 56px to its right —
    // so it would have to whitelist real elements and would then miss a genuine collision
    // between them.
    const els = design().pages[0].elements;
    // `bandt` sits INSIDE `band` by design (a label on its own section bar).
    const allowed = new Set(['band|bandt']);
    for (let i = 0; i < els.length; i += 1) {
      for (let j = i + 1; j < els.length; j += 1) {
        const a = els[i].rect; const b = els[j].rect;
        const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        if (hit && !allowed.has(`${els[i].id}|${els[j].id}`) && !allowed.has(`${els[j].id}|${els[i].id}`)) {
          expect.fail(`${els[i].id} overprints ${els[j].id}`);
        }
      }
    }
  });
});

describe('SEED_DESIGNS — rt-clinical-micro carries the scannable identifiers', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-clinical-micro')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('binds both symbols to lab_number, NOT to the request parameter', () => {
    // The design's `request` param is the ServiceRequest UUID. A barcode of it would scan
    // perfectly — to an identifier no one on the bench can act on. `lab_number` is what the
    // specimen tube actually carries.
    for (const id of ['bc', 'qr']) {
      expect(el(id).dataSource?.queryId).toBe('q-clinical-micro-header');
      expect(el(id).boundColumns?.[0].key).toBe('lab_number');
      expect(el(id).text ?? '').toBe('');
    }
    expect(el('bc').kind).toBe('barcode');
    expect(el('qr').kind).toBe('qrcode');
  });

  it('keeps the footer block at the FOOT of the page', () => {
    // Authored at y=700 on an 1123px A4 page (62% down), leaving the signature line floating
    // mid-page under a table ending at 572. Pinned as a fraction, not a literal, so the intent
    // survives a re-layout.
    const pageH = 1123;
    for (const id of ['rule2', 'ft', 'sig', 'qr']) {
      expect(el(id).rect.y / pageH, `${id} drifted off the page foot`).toBeGreaterThan(0.85);
    }
    // ...and still inside the bottom margin (32).
    for (const id of ['rule2', 'ft', 'sig', 'qr']) {
      expect(el(id).rect.y + el(id).rect.h).toBeLessThanOrEqual(pageH - 32);
    }
  });
});

// The report never said which laboratory performed the test. `performer` is the facility CODE
// (BAMAA) and `performer_display` the human name (Aga Khan) — five DISA codes share that one
// display, so the join keys on the code and the DISPLAY is only ever a fallback for printing.
describe('SEED_QUERIES — q-clinical-micro-header names the performing laboratory', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-header')!;

  it('selects performing_lab and lab_location in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not select performing_lab`).toMatch(/as performing_lab\b/);
      expect(sql, `${dialect} does not select lab_location`).toMatch(/as lab_location\b/);
    }
  });

  it('falls back name -> display -> code, so an unmapped facility never prints a bare code', () => {
    // The three-level ladder is the whole point: performer_display is itself 30-char truncated
    // upstream, but "Ocean Road Cancer Institute (O" is still readable and "BALAB" is not.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the three-level name fallback`)
        .toContain('coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab');
    }
  });

  it('joins facility_map on the CODE, never on the human display', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not join facility_map on the code`)
        .toMatch(/fm\.source_code\s*=\s*fo\.performer\b/);
      expect(sql, `${dialect} matches on the display — five facilities share the string "Aga Khan"`)
        .not.toMatch(/fm\.source_code\s*=\s*fo\.performer_display/);
    }
  });

  it('guards the facility_map join against a NULL source_system', () => {
    // resolveObservedFacilities normalises NULL source_system to '' when building facility_map,
    // and relational-writer.ts documents having written NULL into every row for months. A plain
    // equality join drops those rows silently, because NULL = NULL is false.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the NULL source_system guard`)
        .toMatch(/fm\.source_system\s*=\s*coalesce\(fo\.source_system, ''\)/);
    }
  });

  it('matches the observed coding namespace too, not the feed alone (FAC-P0-07)', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.performer_system\s*=\s*coalesce\(fo\.performer_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/min\(performer_system\) as performer_system/);
    }
  });

  it('joins facilities on BOTH source_system and code — the fan-out guard', () => {
    // `facilities` has no uniqueness constraint on (source_system, facility_code). This query
    // returns ONE row that the design binds; a duplicate would fan it out to two and the keyvalue
    // panel would silently render the first.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not scope the facilities join by feed`)
        .toMatch(/fa\.source_system\s*=\s*fo\.source_system\s+and\s+fa\.facility_code\s*=\s*fo\.performer/);
    }
  });

  it('prefers the curated facility_map location over the ingested one', () => {
    // One measured facilities row (BAGAE) carries a street address and a PO box where a region and
    // district belong. It is the one facility that IS mapped, so this order is what keeps a PO box
    // off a clinical report.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the district preference`)
        .toContain('coalesce(fm.district, fa.district) as district');
      expect(sql, `${dialect} lost the region preference`)
        .toContain('coalesce(fm.region, fa.region) as region');
    }
  });

  it('collapses reports to one row per specimen before joining — the fan-out guard', () => {
    // Reports are per-ORDER, not per-specimen. Measured: 0 of 3713 specimens disagree on performer
    // and 0 of 88 codes carry two displays, so the three min()s cannot splice one facility's code
    // onto another's name.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the facility_of CTE`).toContain('facility_of as (');
      expect(sql, `${dialect} does not fold reports per specimen`)
        .toMatch(/min\(performer\) as performer[\s\S]*group by specimen_id/);
      expect(sql, `${dialect} joins diagnostic_reports directly and will fan out`)
        .not.toMatch(/join diagnostic_reports [a-z]+ on/);
    }
  });

  it('reaches the facility through the folded specimen id, not through s.id', () => {
    // `s` is LEFT joined, so a specimen_id present in lab_results but absent from `specimens`
    // leaves s.id NULL and would silently drop the facility. The specimen id now comes from the
    // `spec` CTE (one aggregate row over every order under the lab number) rather than from a
    // correlated `max(l.specimen_id) ... where l.request_id = q.id` subselect, but the guard is the
    // same one: both joins read `spec.specimen_id`, and neither reads `s.id`.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} hangs the facility off the specimens join`)
        .toContain('left join facility f on f.specimen_id = spec.specimen_id');
      expect(sql, `${dialect} reaches the facility through the LEFT-joined specimens row`)
        .not.toMatch(/f\.specimen_id\s*=\s*s\.id/);
    }
  });

  it('composes the location with each dialect’s own concatenation', () => {
    // CONCAT_WS would say this once for all three, but it arrived in SQL Server 2017 — exactly the
    // floor docker-compose.yml documents — and it keeps '' while skipping NULL.
    expect(q().sql.postgres).toContain("f.district || ', ' || f.region");
    expect(q().sql.mssql).toContain("f.district + ', ' + f.region");
    expect(q().sql.mysql).toContain("concat(f.district, ', ', f.region)");
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} smuggled in CONCAT_WS`).not.toMatch(/concat_ws/i);
    }
  });

  it('folds facilities to one row per facility before joining — the header must stay single-row', () => {
    // facilities.id is the raw FHIR resource id and BOTH Organization and Location project into
    // that table, so one facility can be two rows. The design binds rows[0] into the panel, the
    // barcode and the QR, so a fan-out would silently render whichever row came first.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the facilities fold`).toContain('facility_loc as (');
      expect(sql, `${dialect} does not group the fold by facility`)
        .toMatch(/from facilities[\s\S]*group by source_system, facility_code/);
      expect(sql, `${dialect} still joins the raw facilities table and can fan out`)
        .not.toMatch(/join facilities [a-z]+ on/);
    }
  });
});

describe('SEED_QUERIES — q-clinical-micro-header resolves a lab number', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-header')!;

  it('matches either the lab number or the order id, in every dialect', () => {
    // ⚠ The resolver alias is `q1`, not `q` — `orders` reads EVERY order under the resolved lab
    // number, so the equality lives in an inner subquery over `lab_requests q1`. Asserting on a
    // bare `q.request_id = {{param.request}}` would pass only for the NARROW per-order form this
    // slice exists to remove, so the negative assertion below is the one that keeps it out. Same
    // shape as `q-clinical-micro-ast` (Task 1).
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not scope by request_id IN a resolved set of lab numbers`)
        .toMatch(/where q\.request_id in \(\s*select q1\.request_id from lab_requests q1/);
      expect(sql, `${dialect} must resolve from EITHER the lab number or the order id`)
        .toMatch(/where q1\.request_id\s*=\s*\{\{param\.request\}\}\s+or\s+q1\.id\s*=\s*\{\{param\.request\}\}/);
      expect(sql, `${dialect} regressed to the narrow per-order predicate`)
        .not.toMatch(/where\s*\(\s*q\.request_id\s*=\s*\{\{param\.request\}\}\s+or\s+q\.id\s*=\s*\{\{param\.request\}\}\s*\)/);
    }
  });

  it('requires an isolate, so a chemistry lab number renders no PDF', () => {
    // Without this the widened predicate would find the chemistry request, return a row, and the
    // DESIGNS_REQUIRING_DATA gate would pass — producing a MICROBIOLOGY-titled PDF of nothing.
    // The guard reads the `isolates` CTE rather than spelling the organism codes out a second
    // time, so both halves are pinned: the CTE must exist AND the outer select must gate on it.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the isolates CTE`)
        .toMatch(/isolates as \(\s*select o\.id from orders o\s*join lab_results r on r\.request_id = o\.id\s*where r\.observation_code in \('634-6', 'ORGS'\)/);
      expect(sql, `${dialect} lost the isolate guard`)
        .toMatch(/where exists \(select 1 from isolates\)/);
    }
  });

  it('refuses a lab number carrying two distinct organisms, in every dialect', () => {
    // `organism` is folded with max() across every order, so two genuinely different isolates would
    // print as one, with both antibiograms merged beneath it. Refuse instead — the same
    // refuse-rather-than-render path a chemistry request already takes.
    // ⛔ `<= 1`, not `= 1`: count(distinct) ignores nulls and an isolate observation with no value
    // is legitimate (the `req-bare` live fixture), so `= 1` would refuse a valid header.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the polymicrobial guard`)
        .toMatch(/count\(distinct coalesce\(r\.text_value, r\.coded_value\)\)[\s\S]*?where r\.observation_code in \('634-6', 'ORGS'\)\) <= 1/);
      expect(sql, `${dialect} used = 1, which refuses a valueless isolate observation`)
        .not.toMatch(/count\(distinct[\s\S]*?\) = 1/);
    }
  });

  it('looks for the organism across every order under the lab number, not one order', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still scopes the organism to a single order`)
        .not.toMatch(/where o\.request_id\s*=\s*q\.id\b/);
    }
  });

  it('still selects every column the design binds', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      for (const col of ['patient_surname', 'patient_firstname', 'sex', 'dob', 'specimen',
        'received', 'lab_number', 'panel', 'organism', 'performing_lab', 'lab_location']) {
        expect(sql, `${dialect} stopped selecting ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
    }
  });
});

describe('SEED_QUERIES — q-clinical-micro-ast resolves a lab number and gates on terminology', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-ast')!;

  it('resolves either identifier up to the lab number, then reads every order under it, in every dialect', () => {
    // A per-order id must widen to every order sharing its lab number — a culture order and its
    // sensitivity order are siblings under one q.request_id, not one order in isolation. The narrow
    // `(q.request_id = {{param.request}} or q.id = {{param.request}})` form scoped to a single order
    // and silently dropped the sibling's susceptibility rows (2026-08-17 live-data finding).
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} must join lab_requests to reach request_id`)
        .toMatch(/join lab_requests q on q\.id\s*=\s*r\.request_id/);
      expect(sql, `${dialect} must scope by request_id IN a resolved set of lab numbers, not a direct equality`)
        .toMatch(/where\s+q\.request_id\s+in\s*\(\s*select q1\.request_id from lab_requests q1/);
      expect(sql, `${dialect} must resolve the lab number from EITHER the lab number or the order id`)
        .toMatch(/select q1\.request_id from lab_requests q1\s*where q1\.request_id\s*=\s*\{\{param\.request\}\}\s+or\s+q1\.id\s*=\s*\{\{param\.request\}\}/);
      // The old narrow predicate scoped straight off `q`, the outer joined row, with no resolver
      // subquery. Reverting to it must fail this assertion.
      expect(sql, `${dialect} regressed to the narrow per-order predicate`)
        .not.toMatch(/where\s*\(\s*q\.request_id\s*=\s*\{\{param\.request\}\}\s+or\s+q\.id\s*=\s*\{\{param\.request\}\}\s*\)/);
    }
  });

  it('takes the interpretation from the AST interpretation value set, not a literal S/I/R list', () => {
    // AGENTS.md §8. A hardcoded in ('S','I','R') also lets HIV Rapid EQA panels through — measured
    // 2026-08-17: unanchored S/I/R selects EQA proficiency rows that are 100% R by design.
    // Keyed on value_set_url, not value_set_id: the id is minted as `vs-${randomUUID()}` at seed
    // time and differs per install, so a literal id can never match (RULE 0 finding, 2026-08-17).
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not gate on the value set`)
        .toMatch(/value_set_url\s*=\s*'urn:openldr:valueset:ast-interpretation'[\s\S]*?upper\(coalesce\(r\.coded_value, r\.abnormal_flag\)\) in \(\s*select upper\(code\) from terminology_codes/);
    }
  });

  it('compares the interpretation case-insensitively at all three sites', () => {
    // Measured live 2026-08-17: lab_results holds `R` x116, `S` x16 AND `s` x2. Each site fails
    // differently, so all three are pinned. Without (1) the lowercase rows are dropped and a tested
    // antibiotic vanishes from the printed table. Without (2) a lowercase row that now passes prints
    // a raw `s` instead of `Susceptible`. Without (3) it renders with a blank status and the PDF
    // loses its colour emphasis.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} filters the interpretation case-SENSITIVELY`)
        .toMatch(/upper\(coalesce\(r\.coded_value, r\.abnormal_flag\)\) in \(\s*select upper\(code\) from terminology_codes/);
      expect(sql, `${dialect} resolves the DISPLAY case-SENSITIVELY`)
        .toMatch(/and upper\(tc\.code\) = upper\(coalesce\(r\.coded_value, r\.abnormal_flag\)\)/);
      expect(sql, `${dialect} derives the status token case-SENSITIVELY`)
        .toMatch(/case upper\(coalesce\(r\.coded_value, r\.abnormal_flag\)\)/);
    }
  });

  it('carries no dead vs-non-reportable filter', () => {
    // `vs-non-reportable` exists under no key — measured live, terminology_codes holds exactly five
    // value sets and none is non-reportable — and it keyed on `value_set_id`, which is minted as
    // `vs-${randomUUID()}` per install. `not in` against an empty set is always true, so the filter
    // never excluded anything. The AST interpretation gate excludes the collection-metadata rows it
    // was meant to.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} still carries the dead filter`).not.toContain('vs-non-reportable');
    }
  });

  it('anchors to an isolate, so the CSV export cannot return chemistry rows', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} lost the isolate anchor`)
        .toMatch(/exists\s*\(\s*select 1 from lab_results/);
      expect(sql, `${dialect} isolate anchor must look for the organism codes`)
        .toMatch(/observation_code in \('634-6', 'ORGS'\)/);
    }
  });

  it('still returns exactly test, result and status', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      for (const col of ['test', 'result', 'status']) {
        expect(sql, `${dialect} stopped selecting ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
    }
  });
});

describe('SEED_QUERIES — the facility filter filters on the report performer', () => {
  const ids = ['q-amr-resistance', 'q-test-volume', 'q-turnaround-time', 'q-patient-demographics'] as const;

  it('no query filters on the patient organization any more', () => {
    // Measured: patients.managing_organization is set on 1 of 3714 rows, so every one of these
    // predicates selected nothing on real data.
    for (const id of ids) {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} still filters on managing_organization`)
          .not.toMatch(/managing_organization = \{\{param\.facility\}\}/);
      }
    }
  });

  it('every query that DECLARES a facility control actually references it', () => {
    // q-test-volume rendered the control and ignored it: choosing a facility changed nothing,
    // which reads as "the data is wrong" rather than "the filter is broken".
    for (const id of ids) {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} declares the facility param but never uses it`)
          .toContain('{{param.facility}}');
      }
    }
  });

  it('keeps the "All" escape so an unset filter still returns everything', () => {
    for (const id of ids) {
      const q = SEED_QUERIES.find((x) => x.id === id)!;
      for (const [dialect, sql] of Object.entries(q.sql)) {
        expect(sql, `${id}/${dialect} lost the All escape`)
          .toMatch(/\{\{param\.facility\}\} = ''\s+or/);
      }
    }
  });

  it('routes test volume through its SPECIMENS, not through its patient', () => {
    // A patient served by two laboratories would otherwise have all their requests attributed to
    // whichever lab tested any one of them.
    const q = SEED_QUERIES.find((x) => x.id === 'q-test-volume')!;
    for (const [dialect, sql] of Object.entries(q.sql)) {
      expect(sql, `${dialect} attributes by patient`).not.toMatch(/sr\.patient_id in \(select patient_id from diagnostic_reports/);
      expect(sql, `${dialect}`).toContain('select l.request_id from lab_results l join diagnostic_reports d on d.specimen_id = l.specimen_id');
    }
  });

  // The tests above only assert the ABSENCE of managing_organization and the presence of the ''
  // escape — they'd pass just as happily if a predicate were quietly swapped to
  // performer_display or facility_map.source_code, silently re-breaking the filter this whole
  // slice exists to protect. Pin each predicate to the actual column, via the actual route.
  it('q-amr-resistance filters through its specimen against diagnostic_reports.performer', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-resistance')!;
    for (const [dialect, sql] of Object.entries(q.sql)) {
      expect(sql, `${dialect} does not filter its specimen subquery on performer`)
        .toContain('select specimen_id from diagnostic_reports where performer = {{param.facility}}');
    }
  });

  it('q-turnaround-time filters directly on diagnostic_reports.performer', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-turnaround-time')!;
    for (const [dialect, sql] of Object.entries(q.sql)) {
      expect(sql, `${dialect} does not filter dr.performer directly`)
        .toContain("({{param.facility}} = '' or dr.performer = {{param.facility}})");
    }
  });

  it('q-patient-demographics filters through the patient’s reports against diagnostic_reports.performer', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-patient-demographics')!;
    for (const [dialect, sql] of Object.entries(q.sql)) {
      expect(sql, `${dialect} does not filter its patient subquery on performer`)
        .toContain('select patient_id from diagnostic_reports where performer = {{param.facility}}');
    }
  });
});

describe('SEED_DESIGNS — every report carries a letterhead and a scope panel', () => {
  const simple = () => SEED_DESIGNS.filter((d) => d.id !== 'rt-clinical-micro');
  const el = (d: ReportDesign, suffix: string) =>
    d.pages[0].elements.find((e) => e.id === `${d.id}${suffix}`)!;

  it('gives every aggregate report the identity band', () => {
    // They were three elements — title, date, table — and read as unbranded printouts beside the
    // clinical report.
    for (const d of simple()) {
      expect(el(d, '-logo').src, `${d.id} has no logo`).toBe('{{lab.logo}}');
      expect(el(d, '-labname').text, `${d.id} has no lab name`).toBe('{{lab.name}}');
      expect(el(d, '-rule1'), `${d.id} has no closing rule`).toBeDefined();
    }
  });

  it('describes its own scope from its own declared parameters', () => {
    for (const d of simple()) {
      const rows = el(d, '-meta').rows ?? [];
      expect(rows[rows.length - 1], `${d.id} does not stamp Generated`).toEqual(['Generated', '{{date}}']);
      for (const p of d.parameters) {
        const expected = p.type === 'daterange' ? 'Reporting period' : p.label;
        expect(rows.map((r) => r[0]), `${d.id} omits ${p.key}`).toContain(expected);
      }
    }
  });

  it('sizes the panel to its pairs, in POINTS', () => {
    // ⛔ pairRects returns boxes past the box bottom and the drawer CLIPS them — an over-full panel
    // loses a row silently. The rect is converted with toPt (×0.75) while KV_* are already points;
    // the previous slice shipped a clipped row by mixing those.
    for (const d of simple()) {
      const meta = el(d, '-meta');
      const n = (meta.rows ?? []).length;
      const pairs = pairRects(
        { x: meta.rect.x * 0.75, y: meta.rect.y * 0.75, w: meta.rect.w * 0.75, h: meta.rect.h * 0.75 },
        n, 'inline', meta.panelColumns ?? 1, false,
      );
      const last = pairs[n - 1];
      expect(last.y + last.h, `${d.id} pair ${n} is clipped`)
        .toBeLessThanOrEqual(meta.rect.y * 0.75 + meta.rect.h * 0.75);
    }
  });

  it('keeps every element clear of the page-number band', () => {
    // Computed from the design's OWN paper/orientation, not a hardcoded A4-portrait number — that
    // hardcoding is exactly what let a footer render off the bottom of the two Letter/landscape
    // seeded designs (rt-amr-glass-ris, rt-amr-antibiogram) while this test stayed green.
    // drawPageFooter writes the page number at `hPt - 24` points; px@96 = pt / 0.75.
    for (const d of simple()) {
      const [, hPt] = paperSizePt(d.paper, d.orientation);
      const pageNumYpx = (hPt - 24) / 0.75;
      for (const e of d.pages[0].elements) {
        expect(e.rect.y + e.rect.h, `${d.id}/${e.id} collides with the page number`)
          .toBeLessThanOrEqual(pageNumYpx);
      }
    }
  });

  it('leaves no element overprinting another', () => {
    for (const d of simple()) {
      const els = d.pages[0].elements;
      for (let i = 0; i < els.length; i += 1) {
        for (let j = i + 1; j < els.length; j += 1) {
          const a = els[i].rect, b = els[j].rect;
          const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          if (hit) expect.fail(`${d.id}: ${els[i].id} overprints ${els[j].id}`);
        }
      }
    }
  });
});

describe('SEED_DESIGNS — the antibiogram is transposed because it cannot fit otherwise', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-amr-antibiogram')!;
  const table = () => design().pages[0].elements.find((e) => e.id === 'rt-amr-antibiogram-table')!;

  it('flips the matrix and heads the first column', () => {
    // 29 drug columns of "100% (12)" need ~840pt; a landscape Letter body offers 696pt. The cells
    // set that floor, so no font or header abbreviation rescues the unflipped orientation — every
    // header and cell ellipsized to "…".
    expect(table().transpose).toBe(true);
    expect(table().transposeLabel).toBe('Antibiotic');
  });

  it('emits NO boundColumns — after the flip the headers are the organisms', () => {
    // A static design cannot enumerate which organisms cleared the isolate threshold; the renderer
    // must fall back to the resolved columns.
    expect(table().boundColumns ?? []).toHaveLength(0);
  });

  it('uses the landscape page width instead of the portrait body width', () => {
    // Letter landscape is 1056px; the body was 700, leaving ~260px empty on the one report that
    // needs the room most.
    expect(table().rect.w).toBeGreaterThan(700);
    expect(table().rect.x + table().rect.w).toBeLessThanOrEqual(1056 - 40);
  });

  it('leaves the A4 portrait reports at their original body width', () => {
    // The floor at 700 exists so widening does not churn every other design by two pixels.
    const a4 = SEED_DESIGNS.find((d) => d.id === 'rt-amr-resistance')!;
    const t = a4.pages[0].elements.find((e) => e.id === 'rt-amr-resistance-table')!;
    expect(t.rect.w).toBe(700);
  });

  it('keeps every OTHER seeded table bound to its declared columns', () => {
    // Only the antibiogram is transposed; a stray flag elsewhere would silently blank that report's
    // headers, since a transposed table takes its headers from the data.
    for (const d of SEED_DESIGNS.filter((x) => x.id !== 'rt-amr-antibiogram')) {
      for (const e of d.pages[0].elements.filter((x) => x.kind === 'table')) {
        expect(e.transpose ?? false, `${d.id}/${e.id} is unexpectedly transposed`).toBe(false);
      }
    }
  });
});

describe('SEED_DESIGNS — rt-amr-glass-ris document legibility', () => {
  // ⛔ P0-09. CSF, HAEIN, R/I/S, AMR, GLASS and RIS were all presented with no legend.
  it('spells out R/I/S, AMR and GLASS on the document', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-glass-ris')!;
    const legend = d.pages[0].elements.find((e) => e.id === 'rt-amr-glass-ris-legend')!;
    expect(legend.kind).toBe('text');
    expect(legend.text).toMatch(/resistant/i);
    expect(legend.text).toMatch(/intermediate/i);
    expect(legend.text).toMatch(/susceptible/i);
    expect(legend.text).toMatch(/antimicrobial resistance/i);
    expect(legend.text).toMatch(/Global Antimicrobial Resistance and Use Surveillance System/i);
  });

  it('states what the table counts', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-glass-ris')!;
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-amr-glass-ris-meta')!;
    const metric = (panel.rows as [string, string][]).find(([k]) => k === 'Metric');
    expect(metric).toBeDefined();
    expect(metric![1]).toMatch(/isolate/i);
  });
});

describe('q-amr-glass-ris display names', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-amr-glass-ris')!;

  // The three dialects are STRING-COMPARED here, never executed. Only postgres runs under pg-mem
  // and only the live warehouse proves mssql/mysql. This asserts the projection exists in each.
  it.each(['postgres', 'mssql', 'mysql'] as const)('projects Pathogen and SpecimenName in %s', (d) => {
    const sql = q().sql[d]!;
    expect(sql).toMatch(/min\(pathogen_name\) as [`"]Pathogen[`"]/);
    expect(sql).toMatch(/min\(specimen_name\) as [`"]SpecimenName[`"]/);
    expect(sql).toMatch(/coalesce\(s\.type_text, s\.type_code, '\(unknown\)'\) as specimen_name/);
  });

  // ⛔ The reviewer proved that deleting `specimen_name` from the `first_isolates` column list in
  // all three dialects left 122 tests passing while every dialect would fail at runtime with an
  // unknown column. This pins the carry: `specimen_name` (and `pathogen_name`) must survive
  // `isolate_meta` -> `first_isolates` un-dropped, since the final SELECT's min() aggregates read
  // from `results`, which is built on top of `first_isolates`.
  it.each(['postgres', 'mssql', 'mysql'] as const)('carries specimen_name and pathogen_name through first_isolates in %s', (d) => {
    const sql = q().sql[d]!;
    expect(sql).toMatch(
      /obs_id, specimen_id, patient_id, specimen_type, specimen_name, origin, pathogen_code, pathogen_name, iso_date, gender,/,
    );
  });

  // ⛔ The final GROUP BY must key on the CODE columns only. `specimen_name`/`pathogen_name` are
  // unnormalised free text (two rows coded the same specimen/pathogen can carry different display
  // text) — grouping on them would split one submission stratum into two output rows with the
  // count split between them. The display name is a scalar aggregate (min()) instead.
  it.each(['postgres', 'mssql', 'mysql'] as const)('groups by the code columns only, not the display names, in %s', (d) => {
    const sql = q().sql[d]!;
    const groupByLine = sql.match(/group by [^\n]+/)![0];
    expect(groupByLine).not.toMatch(/\bspecimen_name\b/);
    expect(groupByLine).not.toMatch(/\bpathogen_name\b/);
    expect(groupByLine).toMatch(/\bspecimen_type\b/);
    expect(groupByLine).toMatch(/\bpathogen_code\b/);
  });

  // ⛔ The submission columns are read by a national programme. Adding display names must not
  // rename, reorder or remove any of them.
  it.each(['postgres', 'mssql', 'mysql'] as const)('leaves every submission column intact in %s', (d) => {
    const sql = q().sql[d]!;
    for (const c of ['Iso3Country', 'Year', 'Specimen', 'PathogenCode', 'AntibioticCode',
      'Gender', 'AgeGroup', 'Origin', 'Resistant', 'Intermediate', 'Susceptible', 'Total']) {
      expect(sql).toMatch(new RegExp(`as [\`"]${c}[\`"]`));
    }
    expect(sql).toMatch(/pathogen_code as [`"]PathogenCode[`"]/);
    expect(sql).toMatch(/specimen_type as [`"]Specimen[`"]/);
  });

  it('binds the NAME columns on the design, and no longer calls the antibiotic a code', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-glass-ris')!;
    const table = d.pages[0].elements.find((e) => e.kind === 'table')!;
    const keys = table.boundColumns!.map((c) => c.key);
    expect(keys).toContain('Pathogen');
    expect(keys).toContain('SpecimenName');
    expect(keys).not.toContain('PathogenCode');
    expect(keys).not.toContain('Specimen');
    // antibioticNormalizeSql already emits the DISPLAY name; only the key said "code".
    const abx = table.boundColumns!.find((c) => c.key === 'AntibioticCode')!;
    expect(abx.label).toBe('Antibiotic');
  });
});

describe('SEED_DESIGNS — no built-in id can collide with a designer-minted id', () => {
  it('no built-in design id can collide with a designer-minted id', () => {
    // ⛔ The designer mints `rt-${Date.now()}` for New template and Duplicate. Duplicate is the
    // sanctioned way to customise a built-in without the boot seed overwriting the edits, which
    // only holds while the minted id lands OUTSIDE the ids this loop iterates. A built-in named
    // `rt-<digits>` would silently break that guarantee.
    expect(SEED_DESIGNS.filter((d) => /^rt-\d+$/.test(d.id))).toEqual([]);
  });
});

describe('SEED_QUERIES — the transmission grids', () => {
  const q = (id: string) => SEED_QUERIES.find((x) => x.id === id)!;

  // ⛔ The ladder, in order: registered, then tested, then authorised. `coalesce` stops at its
  // first non-null, so the ORDER is the rule, not just the presence of three rungs. Swap the last
  // two and a request with both a result and a report starts marking the authorisation day
  // instead of the testing day, on every row, with nothing else in this file noticing.
  it('climbs the clinical-date ladder in order, in every dialect', () => {
    // One regex spanning all three rungs, so a reordering fails rather than passing on presence.
    const LADDER = new RegExp(
      String.raw`coalesce\(\s*`
      + String.raw`case when left\(q\.authored_at, 7\)[\s\S]*?then q\.authored_at end,\s*`
      + String.raw`\(select min\(r\.result_timestamp\) from lab_results r[\s\S]*?\),\s*`
      + String.raw`\(select min\(dr\.issued\) from diagnostic_reports dr\s*`
      + String.raw`where dr\.based_on_id = q\.id`,
    );
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} no longer climbs authored_at, then result_timestamp, then issued`)
          .toMatch(LADDER);
      }
    }
  });

  it('⛔ attributes through batch_id, never through the specimen', () => {
    // The specimen route drops 868 requests, 548 of them EID — 99.6% of all EID here.
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the batch join`)
          .toMatch(/d\.batch_id\s*=\s*q\.batch_id/);
        expect(sql, `${id}/${dialect} attributes through the specimen`)
          .not.toMatch(/specimen_id\s*=\s*.*diagnostic_reports/);
      }
    }
  });

  // ⛔ The day is the source's OWN clinical date, read straight out of the ISO 8601 text. Those
  // columns already carry the source's offset, so there is nothing to convert and no zone to
  // convert into. A bulk backfill lands months of clinical work on one arrival day, so bucketing
  // on arrival reports laboratories as transmitting in a month they were not.
  it('reads no arrival timestamp and converts no timezone, in every dialect', () => {
    // Checked over the SQL INCLUDING its comments. The comments here explain why arrival bucketing
    // was removed, so they name the concept but must never name the identifiers: `ingest_events`,
    // `recorded_at`, `{{param.tz}}`, `at time zone` and `convert_tz` are all absent from the file's
    // transmission blocks today, and a comment that reintroduced one would be the same warning
    // sign as code that did.
    const BANNED: [string, RegExp][] = [
      ['ingest_events', /ingest_events/],
      ['recorded_at', /recorded_at/],
      ['{{param.tz}}', /\{\{\s*param\.tz\s*\}\}/],
      ['at time zone', /at time zone/i],
      ['convert_tz', /convert_tz/i],
    ];
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        for (const [name, re] of BANNED) {
          expect(sql, `${id}/${dialect} is back on arrival bucketing: it mentions ${name}`).not.toMatch(re);
        }
      }
      // The declared parameters must agree. A required `tz` the SQL never reads is a box the
      // operator has to fill for no effect, and `substituteParams` refuses the run when it is
      // blank (packages/dashboards/src/custom-query-run.ts:33).
      expect((q(id).params ?? []).map((p) => p.id), `${id} still demands a run parameter`)
        .toEqual(['month', 'panels']);
    }
  });

  it('returns exactly the lab column and 23 day columns', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      const sql = q(id).sql.postgres;
      expect(sql).toMatch(/as lab\b/);
      for (let i = 1; i <= 23; i++) {
        const col = `d${String(i).padStart(2, '0')}`;
        expect(sql, `${id} is missing ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
      expect(sql, `${id} has a d24`).not.toMatch(/as d24\b/);
    }
  });

  // ⛔ `sortBy: 'ord'` is set on both grids, and it FAILS SILENTLY. Drop `ord` from the select and
  // the comparator reads `undefined` on every row, the sort becomes a stable no-op, the renderer
  // falls back to the untrusted SQL row order — and every existing test stays green while the date
  // row lands in the middle of the grid. Nothing else in this file would notice.
  it('selects the ord discriminator sortBy depends on, in every dialect', () => {
    // Four occurrences of `as ord` per dialect string: the dates row (`0 as ord`), the week-token
    // row (`1 as ord`), the laboratory rows (`max(lo.ord) as ord`), and `lab_ord`'s own
    // `row_number() over (order by lab) + 1 as ord`.
    const ORD = /\bas ord\b/g;
    // ⛔ FOUR in the HVL/EID grid and THREE in the Other one, and the difference is the point. The
    // HVL/EID query numbers its laboratories (`lab_ord`'s own `row_number() ... + 1 as ord`); the
    // Other query collapsed to a single 'Others' row on 2026-08-20 and numbers nothing, so it
    // carries the dates row, the week row and its own row and no more.
    const EXPECTED: Record<string, number> = { 'q-transmission-hvleid': 4, 'q-transmission-other': 3 };
    for (const [id, count] of Object.entries(EXPECTED)) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql.match(ORD) ?? [], `${id}/${dialect} dropped 'as ord' — sortBy silently degrades to no sort`)
          .toHaveLength(count);
      }
    }
  });

  // ⛔ ONE LINE, the day number alone. The month was stacked under it until 2026-08-20, when the
  // operator cut it: the report runs one month at a time and the scope panel already names the
  // month. That also removed two defects the second line caused. A cellgrid's header band is 13pt
  // and a two-line label overflowed it, printing over whatever followed; and on MySQL the concat
  // that built it was the measured cause of error 1267.
  it('emits the date row as the day number alone, in every dialect', () => {
    // COUNTED, not matched anywhere. A match-anywhere assertion is satisfied by 1 of 23 columns, so
    // 22 could regress and this would stay green. Same reasoning as the version it replaces, which
    // counted the two-line form.
    const DAY_ONLY = {
      postgres: /to_char\(cal_day, 'FMDD'\) else ''/g,
      mssql: /format\(cal_day, '%d', 'en-US'\) else ''/g,
      mysql: /date_format\(cal_day, '%e'\) else ''/g,
    } as Record<string, RegExp>;
    // ⚠ The negative names the CONSTRUCTION, not the bytes. Both mysql variants still discuss
    // `char(10 using utf8mb4)` in a comment explaining why it is gone, and both cast their trailing
    // counts to `char(10)`, so a bare search for those characters fails on prose and on a cast.
    const STACKED = {
      postgres: /\|\| chr\(10\) \|\|/,
      mssql: /concat\(format\(cal_day/,
      mysql: /concat\(date_format\(cal_day/,
    } as Record<string, RegExp>;
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql.match(DAY_ONLY[dialect]) ?? [], `${id}/${dialect} lost the bare day number`)
          .toHaveLength(23);
        expect(sql, `${id}/${dialect} stacks a second header line again`).not.toMatch(STACKED[dialect]);
      }
    }
  });

  it('carries no panel code in SQL — the list is a run-time parameter', () => {
    // AGENTS.md §8. HIVVL/HIVPC are Tanzania's codes; another country's differ.
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect}`).not.toMatch(/HIVVL|HIVPC|HIVEL|HIVDR/);
        expect(sql, `${id}/${dialect} ignores the panel parameter`).toContain('{{param.panels}}');
      }
    }
  });

  // ⛔ Every month test compares against `ym`, the NORMALISED month, never against the raw
  // parameter. `month` is free text with no shape check: `substituteParams` inlines a text param
  // with no validation (packages/dashboards/src/custom-query-run.ts:34). Typed '2017-8' the date
  // cast still yields 2017-08-01, so `days` builds a correct August header, but a raw
  // `left(ts, 7) = '2017-8'` matches nothing and the grid prints that header above ZERO
  // laboratories. A reader concludes no laboratory transmitted all month. This is the load-bearing
  // difference between a loose month answering like a strict one and answering with a lie.
  it('compares the month through the normalised ym, not the raw parameter, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        // `month_start` is the ONLY place the raw parameter may appear: twice, once for the date
        // and once for the 'YYYY-MM' string derived from it. Counted rather than matched anywhere,
        // because a match-anywhere test passes while a seventh site regresses to the raw value.
        expect(sql.match(/\{\{\s*param\.month\s*\}\}/g) ?? [],
          `${id}/${dialect} reads the raw month outside month_start`).toHaveLength(2);
        // ⚠ The end boundary is '\ndays as (', newline-anchored. A bare 'days as (' would find the
        // 'all_days as (' CTE that mssql and mysql declare first, and the slice would silently
        // cover a different span on those two dialects than on postgres.
        const monthStart = sql.slice(sql.indexOf('month_start as ('), sql.indexOf('\ndays as ('));
        expect(monthStart.match(/\{\{\s*param\.month\s*\}\}/g) ?? [],
          `${id}/${dialect} moved the raw month out of month_start`).toHaveLength(2);
        expect(monthStart, `${id}/${dialect} no longer derives ym`).toMatch(/as ym\b/);

        // Six month tests downstream: three rungs of the coalesce ladder, three arms of the
        // `where` gate that precedes it. All six read `ym`. Pinning the count stops one of them
        // silently reverting while the other five keep this green.
        expect(sql.match(/\(select ym from month_start\)/g) ?? [],
          `${id}/${dialect} lost a month test that reads the normalised ym`).toHaveLength(6);
        // And no month test may compare a timestamp prefix against the raw parameter.
        expect(sql, `${id}/${dialect} compares a timestamp prefix against the raw month`)
          .not.toMatch(/left\([^)]*,\s*7\)\s*=\s*\{\{\s*param\.month\s*\}\}/);
      }
    }
  });

  // ⛔ `d` and `dr` are two DIFFERENT rows of diagnostic_reports and must stay separate aliases.
  // `d` is the SUBMISSION BATCH the laboratory is attributed through (`d.batch_id = q.batch_id`).
  // `dr` is the report authorising THIS request (`dr.based_on_id = q.id`). One batch carries up to
  // 18 reports, so merging them would take the issued date off some other request in the batch and
  // print it as this request's authorisation day. Nothing downstream would show the swap.
  it('keeps the batch alias d and the authorising alias dr apart, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the batch-attribution alias d`)
          .toMatch(/join diagnostic_reports d on d\.batch_id = q\.batch_id/);
        // TWO `dr` sites, counted: the coalesce rung that reads the issued date, and the arm of
        // the `where` gate that admits the request in the first place. A match-anywhere assertion
        // is satisfied by the gate alone, so the rung could lose its own alias and stay green.
        expect(sql.match(/from diagnostic_reports dr\b/g) ?? [],
          `${id}/${dialect} lost an authorising-alias site`).toHaveLength(2);
        expect(sql.match(/where dr\.based_on_id = q\.id\b/g) ?? [],
          `${id}/${dialect} stopped keying dr on based_on_id`).toHaveLength(2);
        // The issued date must come off `dr`, never off the batch alias.
        expect(sql, `${id}/${dialect} reads issued off the batch alias`)
          .not.toMatch(/min\(d\.issued\)/);
      }
    }
  });

  // ⛔ MySQL's find_in_set strips spaces from the WHOLE parameter to fake a per-element trim, so
  // an element like 'AB C' becomes 'ABC' and that request lands in the wrong grid. It is also
  // documented not to work when its first argument contains a comma. Panel codes are
  // operator-configured run-time vocabulary (AGENTS.md §8) — this file cannot assume their shape.
  it('splits the panel list per element on MySQL, never with find_in_set', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      const sql = q(id).sql.mysql;
      // Only the explanatory comment may name it; no predicate may call it.
      const code = sql.replace(/--[^\n]*/g, '');
      expect(code, `${id}/mysql matches panels with find_in_set`).not.toMatch(/find_in_set/);
      expect(code, `${id}/mysql has no per-element split`).toMatch(/panel_list/);
      expect(code, `${id}/mysql never trims an element`).toMatch(/trim\(substring_index\(/);
    }
  });

  // ⛔ cellgrid's palette does Number(cellValue) and treats anything that is not a finite
  // positive number as empty (packages/report-designer/src/render/cellgrid.ts, stepFor). 'Y' is
  // NaN. Left as 'Y', every cell in the grid would paint empty on every run, silently.
  it('marks a submission with a numeric string cellgrid can parse, not the letter Y, in every dialect', () => {
    // ⛔ `cellgrid` reads a cell with Number(value). 'Y' is NaN, `stepFor` treats a non-finite
    // value as empty, and the grid would paint every cell blank on every run with no error.
    // The two queries build the mark differently now: HVL/EID asks whether THIS laboratory arrived
    // that day, the collapsed Other grid asks whether ANY did.
    const MARK: Record<string, RegExp> = {
      'q-transmission-hvleid': /case when a\.lab is null then '' else '1' end as mark/,
      'q-transmission-other': /then '1' else '' end as mark/,
    };
    for (const [id, re] of Object.entries(MARK)) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} still marks with the letter Y`).toMatch(re);
        expect(sql, `${id}/${dialect} marks with the letter Y`).not.toMatch(/else 'Y' end as mark/);
      }
    }
  });

  it('carries a second synthetic row of week tokens at ord = 1, in every dialect', () => {
    const WEEK_ROW = /union all\s*\nselect 1 as ord, '\(week\)' as lab,/;
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the week-token row`).toMatch(WEEK_ROW);
      }
    }
  });

  it('gives each laboratory a unique ord from 2, alphabetically, in every dialect', () => {
    // ⛔ HVL/EID ONLY. The Other grid stopped listing laboratories on 2026-08-20, so it has nothing
    // to number: its single 'Others' row is a literal `2 as ord`. Looping over both here would
    // demand a per-laboratory ord from a query that deliberately has none.
    for (const [dialect, sql] of Object.entries(q('q-transmission-hvleid').sql)) {
      expect(sql, `hvleid/${dialect} lost the per-laboratory ord`)
        .toMatch(/row_number\(\) over \(order by lab\)\s*\+\s*1 as ord/);
    }
    for (const [dialect, sql] of Object.entries(q('q-transmission-other').sql)) {
      expect(sql, `other/${dialect} is numbering laboratories again`).toMatch(/select 2 as ord, 'Others' as lab/);
    }
  });

  // ⛔ LEFT, never INNER: a laboratory whose only submission this month landed on a weekend has
  // zero rows in 'days' (Mon-Fri only). An inner join here silently drops that laboratory from the
  // grid instead of showing it silent all month — no error, just a shorter grid. Measured on the
  // live warehouse (see the plan this test came from): 'Mbagala Kizuiani' and 'Mwananyamala',
  // 2017-08.
  it('computes days and silent per laboratory, outer-joined to the working-day calendar, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q('q-transmission-hvleid').sql)) {
      expect(sql, `hvleid/${dialect} lost lab_stats`).toMatch(/lab_stats as \(/);
      expect(sql, `hvleid/${dialect} no longer selects days`).toMatch(/\bas days\b/);
      expect(sql, `hvleid/${dialect} no longer selects silent`).toMatch(/\bas silent\b/);
      expect(sql, `hvleid/${dialect} inner-joins days inside lab_stats and can drop a weekend-only lab`)
        .toMatch(/left join days dy on dy\.cal_day = a\.cal_day/);
    }
  });

  // The collapsed Other grid measures the same two things over the whole set of off-list
  // laboratories instead of one at a time. `days` is working days that carried any other test
  // data; `silent` is working days since the last one. The outer-join argument above does not
  // apply, because there is no per-laboratory row left to drop: the row exists whatever arrived.
  it('computes days and silent over ALL off-list laboratories at once, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q('q-transmission-other').sql)) {
      expect(sql, `other/${dialect} lost all_stats`).toMatch(/all_stats as \(/);
      expect(sql, `other/${dialect} still computes per laboratory`).not.toMatch(/lab_stats as \(/);
      expect(sql, `other/${dialect} no longer selects days`).toMatch(/\bas days\b/);
      expect(sql, `other/${dialect} no longer selects silent`).toMatch(/\bas silent\b/);
      // Selecting FROM the working-day series, not from arrivals, is what keeps a silent day blank
      // IN PLACE instead of shifting later days left.
      expect(sql, `other/${dialect} builds its marks from arrivals instead of from the day series`)
        .toMatch(/from days dy/);
    }
  });

  // The renderer half of this (drawCellGrid honouring statusKey/emphasis) is covered in
  // @openldr/report-designer. This is the query half: the token has to exist before the design's
  // statusKey can name it.
  it('derives a silent_status token at the 10-working-day threshold, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} no longer selects silent_status`).toMatch(/\bas silent_status\b/);
        expect(sql, `${id}/${dialect} threshold moved off >= 10`)
          .toMatch(/>=\s*10\s+then\s+'critical'/);
      }
    }
  });

  // ⚠ AGENTS.md section 8 does not forbid 10 — it names no clinical vocabulary, only a count of
  // working days. It IS an invented, operational number, and the SQL comment says so, so nobody
  // reads it as a clinical decision later.
  it('documents 10 as an invented operational threshold, not a clinical one, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the invented-threshold disclosure`)
          .toMatch(/INVENTED threshold/);
      }
    }
  });
});

describe('SEED_QUERIES: the summary band', () => {
  const q = (id: string) => SEED_QUERIES.find((x) => x.id === id)!;
  const BAND = ['q-transmission-calendar', 'q-transmission-summary'];
  const CAL_COLS = ['ord', 'c1', 'c2', 'c3', 'c4', 'c5'];
  const FIGURES = ['labs', 'pct_lab_days', 'busiest', 'silent10'];

  it('ships all three dialects for both queries', () => {
    for (const id of BAND) {
      for (const dialect of ['postgres', 'mssql', 'mysql'] as const) {
        expect(q(id).sql[dialect], `${id}/${dialect} is missing`).toBeTruthy();
      }
    }
  });

  it('takes the month and nothing else', () => {
    // ⛔ NOT `panels`. The band sits above BOTH grids, so the HVL/EID split does not apply to it.
    // A required parameter the SQL never reads is also a box the operator must fill for no effect,
    // and substituteParams refuses the run when it is blank.
    for (const id of BAND) {
      expect((q(id).params ?? []).map((p) => p.id), `${id} parameters`).toEqual(['month']);
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} filters by panel`).not.toMatch(/\{\{\s*param\.panels\s*\}\}/);
      }
    }
  });

  it('reads no arrival timestamp and converts no timezone, in every dialect', () => {
    // The same ban the two grid queries carry. Bucketing on ingest arrival lands a bulk backfill's
    // whole history on one calendar day, and this band would then report a month that never
    // happened. Checked over the SQL including its comments, for the same reason as the grids.
    const BANNED: [string, RegExp][] = [
      ['ingest_events', /ingest_events/],
      ['recorded_at', /recorded_at/],
      ['at time zone', /at time zone/i],
      ['convert_tz', /convert_tz/i],
    ];
    for (const id of BAND) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        for (const [name, re] of BANNED) {
          expect(sql, `${id}/${dialect} mentions ${name}`).not.toMatch(re);
        }
      }
    }
  });

  it('gives the calendar working days only, five columns, in every dialect', () => {
    // ⛔ REVERSED on 2026-08-20. This calendar carried all seven days, and the reason was measured:
    // 7 weekend arrivals in 2013-07 and 10 in 2013-09 on the dev warehouse. The operator cut the
    // weekend anyway, because the report asks whether laboratories transmit on the days they are
    // asked to, and two columns a week that are nearly always empty took a fifth of the block.
    // The cost is real and stays stated: a laboratory that only ever submits at a weekend now
    // appears nowhere in this report.
    expect(q('q-transmission-calendar').sql.postgres).toMatch(/between 1 and 5/);
    expect(q('q-transmission-calendar').sql.mssql).toMatch(/% 7 between 0 and 4/);
    expect(q('q-transmission-calendar').sql.mysql).toMatch(/weekday\(cal_day\) between 0 and 4/);
    for (const [dialect, sql] of Object.entries(q('q-transmission-calendar').sql)) {
      expect(sql, `calendar/${dialect} still has a weekend column`).not.toMatch(/as c6\b/);
      expect(sql, `calendar/${dialect} still has a weekend column`).not.toMatch(/as c7\b/);
      expect(sql, `calendar/${dialect} lost the day initials`).toMatch(/'M' as c1, 'T' as c2, 'W' as c3, 'T' as c4, 'F' as c5/);
    }
  });

  it('counts the busiest day over working days too, so it can equal a cell on the calendar', () => {
    // The two figures are read side by side. `busiest` counted CALENDAR days while the calendar had
    // seven columns; naming a Saturday that is no longer drawn would give a reader a number they
    // cannot find on the chart beside it.
    for (const [dialect, sql] of Object.entries(q('q-transmission-summary').sql)) {
      expect(sql, `summary/${dialect} counts the busiest day over all seven days`)
        .toMatch(/join days dy on dy\.cal_day = a\.cal_day group by a\.cal_day/);
    }
  });

  it('returns ord and five cell columns from the calendar, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q('q-transmission-calendar').sql)) {
      for (const col of CAL_COLS) {
        // ⚠ `\b`, inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a regex
        // word boundary, and the assertion then matches far more than it means to.
        expect(sql, `calendar/${dialect} lost ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
      expect(sql, `calendar/${dialect} lost the header row`).toMatch(/'M' as c1/);
      expect(sql, `calendar/${dialect} lost its sort discriminator`).toMatch(/order by ord/);
    }
  });

  it('returns exactly the four figures, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q('q-transmission-summary').sql)) {
      for (const col of FIGURES) {
        expect(sql, `summary/${dialect} lost ${col}`).toMatch(new RegExp(`as ${col}\\b`));
      }
    }
  });

  it('guards the percentage division in every dialect', () => {
    // A month with no arrivals has no laboratories. Without the guard the run fails instead of
    // printing a page that says nothing arrived.
    for (const [dialect, sql] of Object.entries(q('q-transmission-summary').sql)) {
      expect(sql, `summary/${dialect} divides unguarded`).toMatch(/nullif\(/);
    }
  });

  it('keeps the percent sign out of the value, in every dialect', () => {
    // Formatting a number into a string is where three dialects stop agreeing. The design's caption
    // carries the unit.
    for (const [dialect, sql] of Object.entries(q('q-transmission-summary').sql)) {
      expect(sql, `summary/${dialect} formats a percent sign into the value`).not.toMatch(/'%'/);
    }
  });

  it('documents 10 as an invented operational threshold, not a clinical one, in every dialect', () => {
    for (const [dialect, sql] of Object.entries(q('q-transmission-summary').sql)) {
      expect(sql, `summary/${dialect} lost the invented-threshold disclosure`).toMatch(/INVENTED threshold/);
    }
  });
});

describe('SEED_DESIGNS — rt-transmission-grid', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('is portrait, cellgrid does not need MIN_COL_W headroom the way table did', () => {
    // The reason the design was landscape (a 22pt column floor colliding with a 23-column grid)
    // no longer applies: cellgrid declares its cell pitch instead of measuring it. See the
    // geometry describe block below for the arithmetic that replaces this comment.
    expect(design().orientation).toBe('portrait');
  });

  it('binds both grids as cellgrid, not table', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).kind, `${id} is still a table`).toBe('cellgrid');
    }
  });

  it('sorts its own rows on ord instead of trusting the SQL row order', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).sortBy, `${id} trusts the SQL row order`).toBe('ord');
    }
  });

  it('groups day columns by the week-token row', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).groupBoundary, `${id} does not group by week`).toBe('token-change');
    }
  });

  it('marks a filled cell with the binary blue ramp', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).palette, `${id} palette`).toEqual({ ramp: 'blue', steps: 1 });
    }
  });

  it('ties each heading to its own grid, so neither survives onto a page the grid does not reach', () => {
    expect(el('rt-transmission-grid-hvleid-title').showWithTable).toBe('hvleid');
    expect(el('rt-transmission-grid-other-title').showWithTable).toBe('other');
  });

  it('chains the whole page through one flow, so the block moves up as one unit', () => {
    // Chained THROUGH each heading, never two elements pointing at the same target: two elements
    // resolving to the same y would overprint each other. See flowAfter's doc comment in schema.ts.
    // ⛔ `hvleid` used to be the anchor everything measured from. The summary band is the anchor
    // now, and it is the FIGURES panel rather than the calendar because the panel's height is fixed
    // and a calendar's is not. On a continuation page the band draws nothing and adds nothing, so
    // this whole chain moves up by the band's height.
    expect(el('rt-transmission-grid-figures').flowAfter).toBeUndefined();
    expect(el('rt-transmission-grid-hvleid-title').flowAfter).toBe('rt-transmission-grid-figures');
    expect(el('hvleid').flowAfter).toBe('rt-transmission-grid-hvleid-title');
    expect(el('rt-transmission-grid-other-title').flowAfter).toBe('hvleid');
    expect(el('other').flowAfter).toBe('rt-transmission-grid-other-title');
  });

  it('carries a month calendar and four figures, on the first chunk and nowhere else', () => {
    // A month-wide band above a CONTINUATION page restates figures the reader already has, and
    // costs its own height on every later page. Both elements are bound; `showOn` has to be
    // honoured before `drawsOnChunk`'s bound-element short-circuit for that to hold.
    for (const id of ['rt-transmission-grid-calendar', 'rt-transmission-grid-figures']) {
      expect(el(id).showOn, `${id} repeats on every page`).toBe('first-chunk');
    }
    expect(el('rt-transmission-grid-calendar').kind).toBe('cellgrid');
    expect(el('rt-transmission-grid-calendar').cellColumns).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(el('rt-transmission-grid-calendar').labelColumn, "a calendar cell's position is its label").toBeUndefined();
    expect(el('rt-transmission-grid-calendar').palette, 'a calendar carries magnitude, not presence')
      .toEqual({ ramp: 'blue', steps: 5 });
    expect(el('rt-transmission-grid-figures').layout).toBe('stat');
    expect(el('rt-transmission-grid-figures').panelColumns).toBe(2);
    expect((el('rt-transmission-grid-figures').boundColumns ?? []).map((c) => c.key))
      .toEqual(['labs', 'pct_lab_days', 'busiest', 'silent10']);
  });

  it('gives the calendar room for six weeks, so no month drags the page to a second chunk', () => {
    // ⛔ Computed from the renderer's own constants, never from the literal 120. A 31-day month
    // beginning on a Sunday spans SIX ISO weeks; a rect one row short would paginate the calendar
    // and force a second physical page that nothing else on it needs.
    expect(cellGridMaxRows(toPt(el('rt-transmission-grid-calendar').rect).h)).toBeGreaterThanOrEqual(6);
  });

  it('makes the figures panel the flow anchor, tall enough to cover the tallest calendar', () => {
    // The calendar's DRAWN height moves with the month. The panel's does not, which is why the
    // grids below flow after the PANEL. It still has to be the taller of the two, or a six-week
    // calendar would overrun it and collide with the heading underneath.
    const panelH = toPt(el('rt-transmission-grid-figures').rect).h;
    expect(panelH).toBeGreaterThanOrEqual(CELL_HEAD_H + 6 * CELL_ROW_H);
    expect(el('rt-transmission-grid-hvleid-title').flowAfter).toBe('rt-transmission-grid-figures');
    expect(el('hvleid').flowAfter).toBe('rt-transmission-grid-hvleid-title');
  });

  it('keeps the band and the figures side by side inside the content width', () => {
    const cal = el('rt-transmission-grid-calendar').rect;
    const fig = el('rt-transmission-grid-figures').rect;
    expect(cal.x + cal.w, 'the calendar overlaps the figures').toBeLessThanOrEqual(fig.x);
    expect(fig.x + fig.w, 'the figures run past the content edge').toBeLessThanOrEqual(48 + 698);
    expect(cal.y).toBe(fig.y);
  });

  it('leaves the other grid ending clear of the closing rule, whatever flowAfter does to its top', () => {
    // `fillTo` measures down to the DECLARED bottom edge, so that number is the one that has to
    // stay above rule2. Its top is a fallback and moves on every chunk.
    const other = el('other').rect;
    const rule = el('rt-transmission-grid-rule2').rect;
    expect(other.y + other.h).toBeLessThan(rule.y);
  });

  it('lets the laboratory grid take every row the page can hold, wherever it starts', () => {
    // `flowAfter` alone moved the blank band from the top of a continuation page to its bottom: a
    // grid started higher and still held the records its authored box allowed. `fillTo` is what
    // makes the capacity move with the position.
    // ⛔ It sits on HVL/EID, the grid that grows with the network. The Other grid is one collapsed
    // 'Others' row, so filling it to the bottom of the page would reserve height for records the
    // query no longer emits.
    expect(el('hvleid').fillTo).toBe('rect-bottom');
    expect(el('other').fillTo).toBeUndefined();
  });

  it('keeps the two sections apart, and says so on the heading rather than in a rect', () => {
    // The Other heading sat flush against the last row of the grid above, and on a page where that
    // grid was empty it landed on its header band. The gap belongs to the block below the break.
    expect(el('rt-transmission-grid-other-title').flowGap).toBeGreaterThan(0);
    expect(el('rt-transmission-grid-hvleid-title').flowGap, 'the first heading follows the band and needs no break')
      .toBeUndefined();
  });

  it('collapses the Other grid to one row and stops promising a list of sites', () => {
    // A heading reading "by Testing Laboratory" over a single aggregate row is worse than none.
    expect(el('rt-transmission-grid-other-title').text).not.toMatch(/by Testing Laboratory/);
    expect(el('rt-transmission-grid-hvleid-title').text, 'the HVL/EID grid IS per laboratory')
      .toMatch(/by Testing Laboratory/);
    // Room for the header band and exactly one record, and no room for a second.
    expect(cellGridMaxRows(toPt(el('other').rect).h)).toBe(1);
  });

  it('draws BOTH grids on one page, as the reference does', () => {
    expect(el('hvleid').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-hvleid' });
    expect(el('other').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-other' });
  });

  it('binds the laboratory as labelColumn and all 23 day columns as cellColumns', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).labelColumn, `${id} labelColumn`).toBe('lab');
      const cells = el(id).cellColumns ?? [];
      expect(cells, `${id} cellColumns`).toHaveLength(23);
      expect(cells[0]).toBe('d01');
      expect(cells[22]).toBe('d23');
    }
  });

  it('trails each row with Days and Silent, matching the spec widths', () => {
    for (const id of ['hvleid', 'other']) {
      expect(el(id).trailingColumns, `${id} trailingColumns`).toEqual([
        { key: 'days', label: 'Days', width: 20 },
        { key: 'silent', label: 'Silent', width: 22, statusKey: 'silent_status', emphasis: 'fill' },
      ]);
    }
  });

  it('binds Silent to the query-carried silent_status token, filled, for both grids', () => {
    // The approved preview showed a dark filled pill for a laboratory silent ten or more working
    // days. Without statusKey/emphasis here, drawCellGrid has a status token to read (see the
    // SQL test below) but nothing in the design ever names it, and the render stays plain numerals.
    for (const id of ['hvleid', 'other']) {
      const silent = el(id).trailingColumns?.find((c) => c.key === 'silent');
      expect(silent?.statusKey, `${id} silent has no statusKey`).toBe('silent_status');
      expect(silent?.emphasis, `${id} silent is not filled`).toBe('fill');
    }
  });

  it('projects only keys the queries actually select', () => {
    const sql = SEED_QUERIES.find((q) => q.id === 'q-transmission-hvleid')!.sql.postgres;
    const keys = [
      el('hvleid').labelColumn!, ...(el('hvleid').cellColumns ?? []),
      ...(el('hvleid').trailingColumns ?? []).map((c) => c.key),
    ];
    for (const key of keys) {
      // ⚠ `\\b`, inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a word
      // boundary, so the pattern silently never matches.
      expect(new RegExp(`as ${key}\\b`).test(sql), `${key} is not selected`).toBe(true);
    }
  });

  it('keeps the footer clear of the signature line, and right-aligns the signature to the content edge', () => {
    // Both boxes carried their landscape widths (500 and 375) into the first portrait draft and
    // collided: 500 + 375 = 875pt cannot fit inside a 698pt body at any x. The fix measured the
    // real strings with pdfkit rather than guessing a smaller pair of numbers; this pins the
    // result rather than trusting the next reader to re-measure it by eye.
    //
    // Content edge read off the hvleid grid's own rect, not hardcoded, since both it and the
    // signature's x are derived from the same TG_CONTENT_W.
    const contentEdge = el('hvleid').rect.x + el('hvleid').rect.w;
    const foot = el('rt-transmission-grid-foot').rect;
    const sig = el('rt-transmission-grid-sig').rect;
    expect(foot.x + foot.w, 'the footer runs into the signature line').toBeLessThan(sig.x);
    expect(sig.x + sig.w, 'the signature does not right-align to the content edge').toBe(contentEdge);
  });
});

describe('SEED_DESIGNS — rt-transmission-grid run parameters are checked and shown', () => {
  const params = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!.parameters;
  const param = (key: string) => params().find((p) => p.key === key)!;

  // ⛔ TWO boxes, not three. The Time zone box and the tests that pinned its signed-offset rule
  // are gone with the arrival bucketing they served. The grid now reads the source's own
  // clinical date text, so no zone could change a cell, and a required box that changes nothing
  // is a question the operator cannot answer wrongly OR rightly. The rule itself still exists
  // and is still tested, in packages/core/src/param-format.test.ts; nothing seeded declares it.
  it('asks for the month and the panel codes, and for nothing else', () => {
    expect(params().map((p) => p.key)).toEqual(['month', 'panels']);
  });

  it('declares the month as YYYY-MM', () => {
    expect(param('month').format).toBe('year-month');
  });

  it('shows the month format in the box, not only in the ⓘ popover', () => {
    // The operator typed `1`. The format was stated only in the help popover, which has to be
    // opened to be read.
    expect(param('month').placeholder).toMatch(/^\d{4}-\d{2}$/);
  });

  it('⚠ AGENTS.md §8 — leaves the panel-codes box without a placeholder', () => {
    // A placeholder is example text on the page. One country's HVL/EID panel codes are not
    // another's, and this design ships worldwide, so an example here would hardcode clinical
    // vocabulary into a seeded design. The ⓘ help already explains the field without naming a code.
    expect(param('panels').placeholder).toBeUndefined();
    expect(param('panels').format).toBeUndefined();
  });
});

describe('SEED_DESIGNS — rt-transmission-grid keeps ord off the page', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('never binds ord, it sorts the rows, it is not a column of the report', () => {
    for (const id of ['hvleid', 'other']) {
      const keys = [el(id).labelColumn, ...(el(id).cellColumns ?? []),
        ...(el(id).trailingColumns ?? []).map((c) => c.key)];
      expect(keys, `${id} prints ord`).not.toContain('ord');
    }
  });

  it('⛔ pairs headerRow with sortBy — and the boot seed does NOT go through the API gate', () => {
    // `findUnsortedHeaderRows` is enforced at POST/PUT /api/report-designs. The seeded designs are
    // installed by the boot seed, which writes them without that route, so the gate cannot see
    // them. This is where the same rule is checked for the designs that ship.
    for (const d of SEED_DESIGNS) {
      expect(findUnsortedHeaderRows(d), `${d.id} lifts a header row with no sortBy`).toEqual([]);
    }
  });

  it('names no panel code anywhere in the design — the list is a run-time parameter', () => {
    // AGENTS.md §8. HIVVL/HIVPC are Tanzania's codes; this design ships worldwide.
    expect(JSON.stringify(design())).not.toMatch(/HIVVL|HIVPC|HIVEL|HIVDR/);
  });
});

describe('SEED_REPORT_DEFS — r-transmission-grid', () => {
  const def = () => SEED_REPORT_DEFS.find((r) => r.id === 'r-transmission-grid')!;

  it('links the grid design to the HVL/EID query, published and operational', () => {
    expect(def()).toMatchObject({
      category: 'operational',
      designId: 'rt-transmission-grid',
      primaryQueryId: 'q-transmission-hvleid',
      status: 'published',
    });
    expect(def().description).toMatch(/laborator/i);
  });

  it('⛔ is NOT gated on having data — a month in which nothing arrived is the answer', () => {
    // DESIGNS_REQUIRING_DATA refuses to render when the named element has no rows. Right for a
    // per-patient clinical report; here it would hide exactly the outage the report exists to show.
    expect(DESIGNS_REQUIRING_DATA['rt-transmission-grid']).toBeUndefined();
  });
});

describe('SEED_DESIGNS — rt-transmission-grid geometry', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('gives both grids the same width and the same left edge', () => {
    // Two readings of the same month, one above the other. A different width or a different left
    // edge would stop a laboratory's row in the top grid lining up with its row in the bottom one.
    expect(el('hvleid').rect.w).toBe(el('other').rect.w);
    expect(el('hvleid').rect.x).toBe(el('other').rect.x);
  });

  it('no longer asks the two grids to be the same HEIGHT, because they no longer mean the same thing', () => {
    // ⛔ This assertion used to read `hvleid.rect.h === other.rect.h`, and it was right while both
    // grids were one row per laboratory. They are not: HVL/EID is the long one and measures itself
    // DOWN TO ITS BOTTOM EDGE with `fillTo`, while Other is a single collapsed row in a box built
    // to hold exactly that. Pinning the two together again would either starve the long grid or
    // reserve most of a page for one row.
    expect(el('hvleid').fillTo).toBe('rect-bottom');
    expect(el('other').rect.h).toBeLessThan(el('hvleid').rect.h);
  });

  it('fits the worst-case 23-day, 5-week month inside the A4 portrait body: DERIVED, not hardcoded', () => {
    // Worst case per spec section 5: a 31-day month starting Monday, 23 working days across 5
    // week groups, breaks at cell index 5, 10, 15, 20, the exact pattern q-transmission-hvleid's
    // own week-token union branch cites for August 2017 on the live warehouse.
    const worstCaseBreaks = [5, 10, 15, 20];
    const [pageWpt] = paperSizePt(design().paper, design().orientation);
    const bodyWpt = pageWpt - 72; // 36pt margins each side, per spec section 5
    for (const id of ['hvleid', 'other']) {
      const trailing = (el(id).trailingColumns ?? []).map((c) => c.width);
      const needed = cellGridWidth({
        labelWidth: CELL_LABEL_W,
        cellCount: (el(id).cellColumns ?? []).length,
        breaks: worstCaseBreaks,
        trailingWidths: trailing,
      });
      expect(needed, `${id} needs more than the ${bodyWpt}pt portrait body has`).toBeLessThanOrEqual(bodyWpt);
      expect(bodyWpt - needed, `${id} headroom`).toBeGreaterThan(0);
    }
  });

  it('declares a rect wide enough to hold the full body, not just the worst-case minimum', () => {
    // The grid's OWN rect need not equal the tight minimum computed above. cellgrid does not
    // stretch cells to fill unused width, so a wider clip region is harmless. This just confirms
    // the declared rect is not narrower than what the previous test proved is needed.
    const [pageWpt] = paperSizePt(design().paper, design().orientation);
    const bodyWpt = pageWpt - 72;
    for (const id of ['hvleid', 'other']) {
      expect(toPt(el(id).rect).w).toBeGreaterThan(bodyWpt - 10);
    }
  });
});

it('exports cellGridWidth and CELL_LABEL_W for a seed test to use', () => {
  expect(typeof cellGridWidth).toBe('function');
  expect(CELL_LABEL_W).toBe(149.5);
});
