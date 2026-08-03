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
  type SeedDataDrivenReportsDeps,
} from './report-seeds';

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
      create: async (d) => {
        designs.set(d.id, { ...d } as never);
        return d;
      },
      update: async (id, d) => {
        designs.set(id, { ...d, id } as never);
        return { ...d, id } as never;
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
      expect(sql, `${dialect} does not read the report performer`)
        .toContain('coalesce(f.performer, p.managing_organization)');
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
  it('binds pathogen + every panel antibiotic as a Letter/landscape table', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram');
    expect(d).toBeTruthy();
    expect(d?.paper).toBe('Letter');
    expect(d?.orientation).toBe('landscape');
    const table = d?.pages[0].elements.find((e) => e.kind === 'table');
    expect(table?.boundColumns?.map((c) => c.key)).toEqual(['pathogen', ...ANTIBIOGRAM_PANEL]);
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
