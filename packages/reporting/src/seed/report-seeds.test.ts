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
import { pairRects, toPt, paperSizePt, type ReportDesign } from '@openldr/report-designer';
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
        // ⚠ `\\b` — inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a regex
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

  it('reads ServiceRequest arrivals, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect}`).toMatch(/resource_type\s*=\s*'ServiceRequest'/);
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

  it('buckets days in the supplied timezone, not UTC', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} ignores the tz parameter`).toContain('{{param.tz}}');
      }
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
    // Two rows carry `ord` per dialect string: the dates row (`0 as ord`) and the lab rows
    // (`1 as ord`). A match-anywhere assertion passes even if one of the two regresses, so this
    // pins the count.
    const ORD = /\bas ord\b/g;
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql.match(ORD) ?? [], `${id}/${dialect} dropped 'as ord' — sortBy silently degrades to no sort`)
          .toHaveLength(2);
      }
    }
  });

  // ⛔ The date row carries the day and the month as TWO LINES. `headerRow` draws a header cell's
  // newlines stacked and `columnWidths` measures the widest LINE, so a day column costs "Feb"
  // (14.22pt) instead of "2 Feb" (20.90pt) — measured with real pdfkit metrics. Collapsing these
  // back to one line puts every laboratory name back under the ellipsis.
  it('emits the date row as two lines, in every dialect', () => {
    // Each dialect string carries this expression once per day column — 23 sites. A match-anywhere
    // assertion (`toMatch`) is satisfied by 1 of 23, so 22 columns could regress to a bare
    // `char(10)`/single-line expression and this test would stay green. Mutation-tested: flipping
    // one of the 23 sites back to the un-stacked form fails the count, confirming this discriminates
    // where `toMatch` could not — see git history for the reviewer's own proof on the mysql case.
    const NEWLINE: Record<string, RegExp> = {
      postgres: /to_char\(cal_day, 'FMDD'\) \|\| chr\(10\) \|\| to_char\(cal_day, 'Mon'\)/g,
      mssql: /concat\(format\(cal_day, '%d', 'en-US'\), char\(10\), format\(cal_day, 'MMM', 'en-US'\)\)/g,
      // ⛔ `using utf8mb4` is asserted, not just `char(10)`. Bare CHAR(10) is a BINARY string in
      // MySQL and CONCAT turns the whole cell binary, so mysql2 (built with no `typeCast`) hands the
      // date row back as Buffers and the JSON/CSV export of that row stops being text.
      mysql: /concat\(date_format\(cal_day, '%e'\), char\(10 using utf8mb4\), date_format\(cal_day, '%b'\)\)/g,
    };
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql.match(NEWLINE[dialect]) ?? [], `${id}/${dialect} no longer stacks the day over the month on all 23 columns`)
          .toHaveLength(23);
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

  // C2: `arrivals` must carry its own month bound. Without one, `labs` is "every laboratory that
  // ever submitted" and a lab absent from the window still gets a blank row — and the only index
  // on ingest_events leads with recorded_at, so an unbounded scan reads the whole table.
  it('bounds recorded_at inside the arrivals CTE, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} never bounds recorded_at`)
          .toMatch(/e\.recorded_at\s*>=/);
        expect(sql, `${id}/${dialect} never caps recorded_at`)
          .toMatch(/e\.recorded_at\s*</);
      }
    }
  });

  // ⛔ The assertion above matches only the WIDENED sargable bound, which is two days looser than
  // the month on each side. Deleting the exact civil-zone bound — the mutation that proved the
  // live test bites — leaves it green, and a hermetic CI run skips the live file entirely. These
  // regexes pin the exact bound, per dialect, because the expression differs in all three.
  const CIVIL_LOWER: Record<string, RegExp> = {
    postgres: /and \(e\.recorded_at at time zone \{\{param\.tz\}\}\)::date >= m\.d/,
    mssql: /and cast\(e\.recorded_at at time zone 'UTC' at time zone \{\{param\.tz\}\} as date\) >= m\.d/,
    mysql: /and cast\(convert_tz\(e\.recorded_at, '\+00:00', \{\{param\.tz\}\}\) as date\) >= m\.d/,
  };
  const CIVIL_UPPER: Record<string, RegExp> = {
    postgres: /and \(e\.recorded_at at time zone \{\{param\.tz\}\}\)::date < m\.d \+ interval '1 month'/,
    mssql: /and cast\(e\.recorded_at at time zone 'UTC' at time zone \{\{param\.tz\}\} as date\) < dateadd\(month, 1, m\.d\)/,
    mysql: /and cast\(convert_tz\(e\.recorded_at, '\+00:00', \{\{param\.tz\}\}\) as date\) < date_add\(m\.d, interval 1 month\)/,
  };

  it('pins the EXACT civil-zone month bound, in every dialect', () => {
    for (const id of ['q-transmission-hvleid', 'q-transmission-other']) {
      for (const [dialect, sql] of Object.entries(q(id).sql)) {
        expect(sql, `${id}/${dialect} lost the exact civil-zone lower bound`)
          .toMatch(CIVIL_LOWER[dialect]);
        expect(sql, `${id}/${dialect} lost the exact civil-zone upper bound`)
          .toMatch(CIVIL_UPPER[dialect]);
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
});

describe('SEED_DESIGNS — rt-transmission-grid', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('is landscape — MEASURED: 24 columns cannot fit portrait', () => {
    // The reference document is portrait, and this design is not. The reason is arithmetic, not
    // taste, and it is worth pinning because "make it portrait like the reference" is an obvious
    // and wrong instruction to give this file.
    //
    // Measured with real pdfkit metrics at the renderer's fixed 8pt, WITH the stacked header:
    //   day column natural   = max("23" 8.90, "Feb" 14.22) + CELL_PAD*2 + 2 = 24.22pt
    //   portrait body, 36pt margins                                          = 523.28pt
    //   floor applied by columnWidths = min(MIN_COL_W 22, 523.28/24 = 21.80) = 21.80pt
    // 23 day columns cannot go below that floor, so they take 501.4pt of 523.28 and the
    // laboratory column is left 21.8pt — about three characters. Landscape gives it 171.85pt.
    // Tighter margins do not rescue it: at 16pt margins the name column is 57.3pt.
    expect(design().orientation).toBe('landscape');
  });

  it('lifts the query date row into the header so it repeats on every page', () => {
    // Without `headerRow` the dates are an ordinary body row: they print on chunk 0 only, and page
    // 2 shows marks under blank columns with nothing to say which day is which.
    for (const id of ['hvleid', 'other']) {
      expect(el(id).headerRow, `${id} leaves the dates as a body row`).toBe(true);
    }
  });

  it('⛔ leaves the 23 day labels BLANK, because a declared label wins over the header row', () => {
    // `headerTexts` keeps a non-blank declared label and fills only a blank one from the header
    // row. Labelling the day columns `1`..`23` would therefore print slot numbers OVER the dates —
    // which is exactly the mitigation an earlier review proposed before the lift existed.
    for (const id of ['hvleid', 'other']) {
      const labels = (el(id).boundColumns ?? []).map((c) => c.label);
      expect(labels[0]).toBe('Laboratory');
      expect(labels.slice(1), `${id} labels its day columns`).toEqual(Array(23).fill(''));
    }
  });

  it('ties each heading to its own grid, so neither survives onto a page the grid does not reach', () => {
    expect(el('rt-transmission-grid-hvleid-title').showWithTable).toBe('hvleid');
    expect(el('rt-transmission-grid-other-title').showWithTable).toBe('other');
  });

  it('fits 8 laboratories per grid per page — computed in POINTS, not px@96', () => {
    // ⛔ UNITS. The rect is px@96 and the renderer multiplies by 0.75; ROW_H and the header band are
    // already points. Doing this in px@96 gives floor((214-24)/16) = 11 and overstates the capacity
    // by a third, in the direction that says "it fits".
    const ROW_H_PT = 16;
    const STACKED_HEAD_PT = 24; // ROW_H + HEAD_LINE_H, and HEAD_LINE_H is the reference's 8pt
    for (const id of ['hvleid', 'other']) {
      const hPt = toPt(el(id).rect).h;
      expect(hPt).toBeCloseTo(160.5, 6);
      expect(Math.floor((hPt - STACKED_HEAD_PT) / ROW_H_PT)).toBe(8);
    }
  });

  it('draws BOTH grids on one page, as the reference does', () => {
    expect(el('hvleid').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-hvleid' });
    expect(el('other').dataSource).toEqual({ kind: 'custom-query', queryId: 'q-transmission-other' });
  });

  it('binds the lab column and all 23 day columns explicitly', () => {
    for (const id of ['hvleid', 'other']) {
      const keys = (el(id).boundColumns ?? []).map((c) => c.key);
      expect(keys[0]).toBe('lab');
      expect(keys).toHaveLength(24);
      expect(keys).toContain('d23');
    }
  });

  it('projects only keys the queries actually select', () => {
    const sql = SEED_QUERIES.find((q) => q.id === 'q-transmission-hvleid')!.sql.postgres;
    for (const c of el('hvleid').boundColumns ?? []) {
      // ⚠ `\\b` — inside a TEMPLATE LITERAL a lone `\b` is the backspace character, not a word
      // boundary, so the pattern silently never matches.
      expect(new RegExp(`as ${c.key}\\b`).test(sql), `${c.key} is not selected`).toBe(true);
    }
  });
});

describe('SEED_DESIGNS — rt-transmission-grid keeps ord off the page', () => {
  const design = () => SEED_DESIGNS.find((d) => d.id === 'rt-transmission-grid')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id)!;

  it('never binds ord — it sorts the rows, it is not a column of the report', () => {
    for (const id of ['hvleid', 'other']) {
      expect((el(id).boundColumns ?? []).map((c) => c.key), `${id} prints ord`).not.toContain('ord');
    }
  });

  it('sorts its own rows on ord instead of trusting the SQL row order', () => {
    // planPagination wraps the query as `select * from (<inner>) as _q limit N`
    // (packages/dashboards/src/sql-runner.ts:56). MySQL may discard an ORDER BY inside a derived
    // table; if it does, the '(dates)' row lands in the middle of the grid. Sorting where the
    // renderer consumes the rows removes the dependency on the engine keeping that order.
    for (const id of ['hvleid', 'other']) {
      expect(el(id).sortBy, `${id} trusts the SQL row order`).toBe('ord');
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

  it('says in the tz help that the prefill is a studio default, not a binding', () => {
    // A CLI or scheduled run passes tz explicitly and never reads the setting. An operator who
    // reads "defaults to Settings" and nothing else will assume a schedule inherits it.
    const tz = design().parameters.find((p) => p.key === 'tz')!;
    expect(tz.required).toBe(true);
    expect(tz.help ?? '').toMatch(/schedul|CLI/i);
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

  it('gives both grids the FULL landscape body width', () => {
    // ⚠ MEASURED off a real render at the renderer's fixed 8pt, with the stacked header: the day
    // columns draw at 26.02pt and the laboratory column at 171.85pt (163.85pt of text). That is
    // enough for "Kilimanjaro Christian Medical Centre" (129.5pt) but NOT for
    // "Mtwara (Ligula) Regional Referral Hospital - EVLIMS" (186.6pt), which still ellipsizes.
    // Narrowing these rects makes a legibility problem that is already at its limit worse, and
    // nothing in a rendering test would say so.
    const [wPt] = paperSizePt(design().paper, design().orientation);
    const body = Math.round(wPt / 0.75) - 96; // simpleTableDesign's own arithmetic
    for (const id of ['hvleid', 'other']) {
      expect(el(id).rect.w, `${id} is narrower than the page allows`).toBe(body);
    }
  });

  it('gives both grids the same width and the same height', () => {
    // Two readings of the same month, one above the other. Different column widths between them
    // would make a lab's row in the top grid not line up with its row in the bottom one.
    expect(el('hvleid').rect.w).toBe(el('other').rect.w);
    expect(el('hvleid').rect.h).toBe(el('other').rect.h);
    expect(el('hvleid').rect.x).toBe(el('other').rect.x);
  });
});
