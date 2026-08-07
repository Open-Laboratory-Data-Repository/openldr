import type { NewCustomQuery, ReportRecord, CustomQueryStore, ReportStore, ConnectorStore } from '@openldr/db';
import type { ReportDesign, ReportDesignStore } from '@openldr/report-designer';
import { simpleTableDesign } from './simple-design';

// NOTE on why this isn't `import type { SqlDialect } from '@openldr/dashboards'` (as the plan
// sketch suggested): `@openldr/dashboards` already depends on `@openldr/reporting` (for the
// shared `ReportResultData`/`ReportColumn`/`ChartHint` types used by `compile.ts`/`sql-runner.ts`),
// so importing from dashboards here would introduce a package cycle. Re-declared locally instead,
// mirroring the same already-established convention `@openldr/db`'s `custom-query-store.ts` uses
// for `CustomQueryParam`/`CustomQuery` (structurally identical to `@openldr/dashboards`'s source
// of truth, kept in sync by hand). `packages/bootstrap` (the actual caller, which depends on both
// `db` and `dashboards` with no cycle) can and does import the real `SqlDialect` from
// `@openldr/dashboards` directly.
export type SqlDialect = 'postgres' | 'mssql' | 'mysql';

// S4 seed data: the query + design + report-record triples that replace the hardcoded catalog
// reports (`packages/reporting/src/reports/*.ts`) with data-driven ones. Task 4.2 (worked example)
// appends `amr-resistance`'s triple below; Tasks 4.3-4.8 append one each for the remaining six.
//
// R3e: reports read the canonical read-model tables (v2_* renamed to
// patients/lab_requests/lab_results/specimens/diagnostic_reports/facilities).

/** Name used to dedup the default target-warehouse connector — matches
 *  `packages/bootstrap/src/seed.ts`'s `DEFAULT_CONNECTOR_NAME`. Every `SEED_QUERIES` entry is
 *  authored with `connectorId: ''` (it isn't known until seed time — the connector is a
 *  server-generated `randomUUID()`, deduped by this name) and `seedDataDrivenReports` stamps the
 *  resolved id on before `create`. */
export const DEFAULT_CONNECTOR_NAME = 'Target Warehouse (Postgres)';

/** Task 6.1: `amr-antibiogram`'s catalog columns are the SORTED UNION of whatever antibiotics
 *  happen to appear in the AST result set for the current run (`amr-antibiogram.ts`:
 *  `[...new Set(matrix.flatMap((m) => Object.keys(m.byAntibiotic)))].sort()`) — genuinely
 *  data-dependent, so it cannot be reproduced as a SQL `SELECT` column list (columns are static in
 *  SQL). The data-driven replacement instead uses a FIXED, curated antibiotic panel: one CASE
 *  column per antibiotic in this list, in this order.
 *
 *  Fidelity trade-off: every antibiotic actually present in the dev analytics DB is included here
 *  (`select distinct code_text from observations where interpretation_code in ('S','I','R') order
 *  by 1` → Ampicillin, Ceftriaxone, Ciprofloxacin, Gentamicin — confirmed empty result set
 *  otherwise, see amr-antibiogram-parity.test.ts), so parity holds on every column the catalog
 *  could ever have populated from today's fixture data. A handful of standard WHONET-panel
 *  antibiotics are appended as empty-until-tested columns so the report is useful as new AST data
 *  arrives without requiring another migration. Genuine gap vs the old dynamic catalog: an
 *  antibiotic tested in the future that isn't on this list won't get its own column (it's silently
 *  dropped from the matrix) until this constant is edited — the catalog would have grown a column
 *  automatically. Accepted per the plan (Task 6.1) as the "fixed panel" trade-off; SQL cannot
 *  express a data-dependent column list. */
/** Canonical antibiotic -> the source codes that mean it, keyed on `lab_results.observation_code`
 *  (system `urn:openldr:default_abx`).
 *
 *  ⛔ MATCH ON THE CODE, NOT THE DESCRIPTION. The panel used to compare against
 *  `observation_desc`, which is prose written by whoever configured the analyser, so real results
 *  missed their own column. Measured across all 22 v1 sites (2026-08-02, restricted to S/I/R
 *  results on requests that also carry an organism):
 *    · `COTRI` "Cotrimoxazole" (200 uses) never matched the panel's
 *      "Trimethoprim/Sulfamethoxazole" column — THE SAME DRUG, spelled the other way. 200 results
 *      silently dropped; the 3 that landed came from `SXT`, which happens to spell it the panel's way.
 *    · "Amoxicillin/Clavulanate" is written three ways in the data — `AMC` "AMOXYLIN/CLAVULANIC
 *      ACID" (50), `AUG` "Co-amoxiclav" (17), `AUGUM` "Augumentin" (8) — and matched none of them.
 *    · `AMPIC` "Ampicillin*" (30) missed on a trailing asterisk; `GENT`/`GENTA` differ by a letter.
 *  A code is stable; a description is not. Codes also collapse these variants without a
 *  string-similarity guess.
 *
 *  Entries are the measured corpus, so the panel now covers what labs actually test rather than a
 *  guessed subset. `Meropenem` is retained with no observed code: it is a standard WHONET
 *  reserve-carbapenem column worth showing as empty-until-tested. */
export const ANTIBIOTIC_CODES: Record<string, readonly string[]> = {
  'Amikacin': ['AMIK'],
  'Amoxicillin/Clavulanate': ['AMC', 'AUG', 'AUGUM'],
  'Ampicillin': ['AMP', 'AMPIC'],
  'Azithromycin': ['AZYT'],
  'Cefazolin': ['CEFAZ'],
  'Cefotaxime': ['CTX'],
  'Cefoxitin': ['CEFOX'],
  'Ceftazidime': ['CEFTA'],
  'Ceftriaxone': ['CEF'],
  'Cephradine': ['CEPHR'],
  'Chloramphenicol': ['CHLOR'],
  'Ciprofloxacin': ['CIPRO'],
  'Clindamycin': ['CLIND'],
  'Erythromycin': ['ERYTH'],
  'Gentamicin': ['GENTA', 'GENT'],
  'Imipenem': ['IMIP'],
  'Meropenem': ['MERO'],
  'Nalidixic Acid': ['NALID'],
  'Nitrofurantoin': ['NITRO'],
  'Norfloxacin': ['NORF'],
  'Oxacillin': ['OXACI'],
  'Penicillin G': ['PENG'],
  'Piperacillin': ['PIPER'],
  'Rifampicin': ['RIF'],
  'Tetracycline': ['TETRA'],
  'Tobramycin': ['TOBRA'],
  'Trimethoprim/Sulfamethoxazole': ['COTRI', 'SXT'],
  'Vancomycin': ['VANCO'],
};

/** Catch-all column for any S/I/R result the panel does not recognise.
 *
 *  The old panel dropped such rows SILENTLY, which is the failure mode the AMR work keeps hitting:
 *  a report that under-counts looks exactly like a report with less data. Surfacing them is the
 *  agreed rule — loud and slightly wrong beats quiet and wrong.
 *
 *  It is a REVIEW BUCKET, not a drug, and it is expected to be non-empty: measured on real data it
 *  collects `AST` "Antimicrobial Sensitivity Test" (97 uses — a panel-level summary row, not an
 *  agent), microscopy findings that are coded S/I/R on culture specimens (`EPI`/`WEPI` epithelial
 *  cells, `PSHY` pseudohyphae, `YEAST`), and `CEFOT` "Cefotaxime/Ceftriazone" — one result
 *  reporting TWO drugs, deliberately left unmapped rather than silently attributed to either. A
 *  number here means "these results exist and this report cannot place them", which is a
 *  data-quality signal worth acting on. */
export const UNMAPPED_ANTIBIOTIC = '(unmapped)';

/** The antibiogram's columns: every canonical antibiotic, then the review bucket last. */
export const ANTIBIOGRAM_PANEL: string[] = [...Object.keys(ANTIBIOTIC_CODES), UNMAPPED_ANTIBIOTIC];

/** SQL `case` mapping a row to its canonical antibiotic. Dialect-independent — plain `in (...)`
 *  over string literals, identical on postgres/mssql/mysql.
 *
 *  Ordering is load-bearing: code first (authoritative), then an exact-description fallback so a
 *  warehouse fed by a non-DISA source that already writes canonical names still lands in the right
 *  column, then the unmapped case. There is deliberately NO fuzzy match — a wrong column is worse
 *  than an honestly unmapped one.
 *
 *  `unmapped` differs by report SHAPE, and the difference is deliberate:
 *   - `'bucket'` (the antibiogram): a matrix needs a CLOSED column set, so anything unrecognised
 *     collapses into the single `UNMAPPED_ANTIBIOTIC` column. Without this the row would have
 *     nowhere to go and would vanish — the exact silent drop being fixed.
 *   - `'passthrough'` (the long-format reports): one row per antibiotic, so the column set is not
 *     constrained. Keep the raw description — collapsing every unknown into one `(unmapped)` row
 *     there would MERGE distinct findings and lose which one it was, i.e. it would destroy
 *     information the old behaviour preserved. Synonyms still normalise; only the unknowns pass
 *     through. */
export function antibioticNormalizeSql(unmapped: 'bucket' | 'passthrough'): string {
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const arms = Object.entries(ANTIBIOTIC_CODES).map(
    ([display, codes]) => `      when o.observation_code in (${codes.map(lit).join(', ')}) then ${lit(display)}`,
  );
  // Passthrough coalesces to the CODE so an unmapped row can never surface as a NULL antibiotic
  // (possible now that matching is code-first: a coded row is reportable with no description).
  const fallback = unmapped === 'bucket'
    ? lit(UNMAPPED_ANTIBIOTIC)
    : `coalesce(o.observation_desc, o.observation_code, ${lit(UNMAPPED_ANTIBIOTIC)})`;
  const names = Object.keys(ANTIBIOTIC_CODES).map(lit).join(', ');
  return `case
${arms.join('\n')}
      when o.observation_desc in (${names}) then o.observation_desc
      else ${fallback}
    end`;
}

/** Builds one CASE-column SQL fragment for `antibiotic`, matching `amr-antibiogram.ts`'s cell
 *  format EXACTLY: `${cell.percentR}% (${cell.tested})` when the pathogen was tested against this
 *  antibiotic (`aggregate.ts`'s `pct()` = `Math.round((r/tested)*1000)/10`, i.e. rounded to 1
 *  decimal place, reproduced here via `round(..., 1)`), or `''` when it was never tested (mirrors
 *  `cell ? ... : ''`). The postgres `::float8::text` cast (same technique already used for
 *  `percentR` columns elsewhere in this file) renders like JS `Number#toString` — no trailing
 *  `.0` for whole percentages — so e.g. `100` (not `100.0`) matches the catalog's cell text
 *  byte-for-byte. The mssql variant (Task 2 port) uses `cast(... as float)` +
 *  `cast(... as nvarchar(max))` per the porting rules; SQL Server's float->nvarchar text
 *  formatting is NOT guaranteed byte-identical to Postgres's `::text` cast (may render trailing
 *  zeros/scientific notation differently for edge-case values) — flagged for the cross-dialect
 *  parity harness to verify against a live MSSQL warehouse. */
function antibiogramCellSql(antibiotic: string, dialect: SqlDialect): string {
  const lit = antibiotic.replace(/'/g, "''");
  if (dialect === 'mssql') {
    const ident = antibiotic.replace(/"/g, '""');
    return `case when sum(case when antibiotic = '${lit}' then 1 else 0 end) = 0 then ''
    else cast(cast(round(100.0 * sum(case when antibiotic = '${lit}' and ris = 'R' then 1 else 0 end) / nullif(sum(case when antibiotic = '${lit}' then 1 else 0 end), 0), 1) as float) as nvarchar(max))
      + '% (' + cast(sum(case when antibiotic = '${lit}' then 1 else 0 end) as nvarchar(max)) + ')' end as "${ident}"`;
  }
  if (dialect === 'mysql') {
    // MySQL: `||` is logical OR, not concat — use concat(); `"..."` is a string literal, not an
    // identifier — use backtick aliases; float->char cast mirrors the pg ::float8::text render
    // (flagged for the parity harness, like the mssql float->nvarchar note above).
    const ident = antibiotic.replace(/`/g, '``');
    return `case when sum(case when antibiotic = '${lit}' then 1 else 0 end) = 0 then ''
    else concat(cast(cast(round(100.0 * sum(case when antibiotic = '${lit}' and ris = 'R' then 1 else 0 end) / nullif(sum(case when antibiotic = '${lit}' then 1 else 0 end), 0), 1) as double) as char),
      '% (', cast(sum(case when antibiotic = '${lit}' then 1 else 0 end) as char), ')') end as \`${ident}\``;
  }
  const ident = antibiotic.replace(/"/g, '""');
  return `case when count(*) filter (where antibiotic = '${lit}') = 0 then ''
    else (round(100.0 * count(*) filter (where antibiotic = '${lit}' and ris = 'R') / nullif(count(*) filter (where antibiotic = '${lit}'), 0), 1)::float8)::text
      || '% (' || count(*) filter (where antibiotic = '${lit}')::text || ')' end as "${ident}"`;
}

/** One query's SQL in both supported warehouse dialects — Task 2 (mssql-slice2b): every built-in
 *  report query now carries a Postgres variant (unchanged from before this task — still the one
 *  and only source of truth the `amr-*-parity.test.ts` fixtures were built against) and a T-SQL
 *  variant (first pass; ported per the documented rules table, validated by a later live
 *  cross-dialect parity harness, not guaranteed byte-perfect yet). `seedDataDrivenReports` picks
 *  the variant matching the resolved warehouse connector's dialect. */
type DialectSql = { postgres: string; mssql: string; mysql: string };
type SeedQuery = Omit<NewCustomQuery, 'sql'> & { sql: DialectSql };

/** Custom queries (bound to a connector) that back the seeded report designs. `connectorId: ''`
 *  is a placeholder — `seedDataDrivenReports` resolves the real default-connector id and stamps
 *  it on before insert (see `DEFAULT_CONNECTOR_NAME`). */
export const SEED_QUERIES: SeedQuery[] = [
  {
    id: 'q-facilities',
    name: 'Facilities (options)',
    connectorId: '',
    params: [],
    // patients.managing_organization is set on 1 of 3714 rows (the seed) — the dropdown offered
    // exactly one fake option. The real facility dimension is diagnostic_reports.performer,
    // resolved through facility_map the same way q-clinical-micro-header resolves its
    // performing_lab: fm.source_system = coalesce(dr.source_system, '') (the resolver normalises a
    // NULL source_system to '' when building the dimension, and NULL = NULL is false) and
    // fm.source_code = dr.performer. Column ORDER is the contract optionsDataDriven reads
    // (column 0 = value, column 1 = label) — the value stays the CODE, never the resolved name:
    // five DISA facility codes (BAMAA, BBFAF, CDABE, EAFAE, NDFAM) all display "Aga Khan", so
    // filtering/grouping by the label would silently merge five laboratories. No postgres-isms at
    // all — all three dialects are byte-identical.
    // ⛔ GROUP BY dr.performer, not SELECT DISTINCT: `dr.performer_display` is free text off the
    // wire (fm.name is null for 87 of 88 live codes, so the label almost always falls through to
    // it), and `select distinct value, label` dedupes the PAIR, not the code — two reports at one
    // facility whose display text differs by casing/whitespace produced two options sharing one
    // `value`, a duplicate React key and an ambiguous select. Same defect as q-amr-facility-summary
    // (fixed in db932117), fixed the same way here: group by the code, `min()` the label. Legal
    // under MySQL's default ONLY_FULL_GROUP_BY because the only non-aggregate in the SELECT list
    // (`dr.performer`) IS the GROUP BY item itself — verified against a live MySQL 8.4 container.
    sql: {
      postgres: `select dr.performer as value,
  min(coalesce(fm.name, dr.performer_display, dr.performer)) as label
from diagnostic_reports dr
left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
where dr.performer is not null and dr.performer <> ''
group by dr.performer
order by 2`,
      mssql: `select dr.performer as value,
  min(coalesce(fm.name, dr.performer_display, dr.performer)) as label
from diagnostic_reports dr
left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
where dr.performer is not null and dr.performer <> ''
group by dr.performer
order by 2`,
      mysql: `select dr.performer as value,
  min(coalesce(fm.name, dr.performer_display, dr.performer)) as label
from diagnostic_reports dr
left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
where dr.performer is not null and dr.performer <> ''
group by dr.performer
order by 2`,
    },
  },
  {
    id: 'q-amr-resistance',
    name: 'AMR resistance rate',
    connectorId: '',
    // NOTE on param shape: `ctx.reporting.run(id, rawParams)` forwards `rawParams` (the flat
    // `{from,to,facility}` filter bag the Reports page/route builds) straight through to
    // `runStoredQuery` → `substituteParams(sql, query.params, values)` with NO reshaping. So
    // these `CustomQueryParam`s must read `values.from`/`values.to`/`values.facility` directly
    // (two plain `text` params, NOT one `daterange` param — a `daterange` param reads
    // `values[p.id]` as a nested `{from,to}` object, which only the Query-workbench's
    // `RunParamsSheet` builds; the Reports page never does). Verified empirically against
    // `packages/dashboards/src/custom-query-run.ts`'s `substituteParams`.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ],
    // Mirrors packages/reporting/src/reports/amr-resistance.ts + helpers.ts (pivotResistance +
    // endOfDay) exactly:
    //  - group observations with interpretation_code in (S,I,R) by antibiotic (code_text,
    //    coalesced to '(unknown)' as the JS pivot does via `?? '(unknown)'`)
    //  - tested/r/i/s via CASE conditional aggregates (replaces the JS pivot)
    //  - percentR = round(100 * r / tested, 1), matching `Math.round((r/tested)*1000)/10`
    //  - row order: `percentR` DESCENDING, matching pivotResistance's `b.percentR - a.percentR`
    //    (the catalog has no secondary tiebreaker, so tie order is nondeterministic there)
    //  - date range: `effective_date_time >= from` and `<= to || 'T23:59:59.999Z'` (== endOfDay)
    //  - facility: filters through the result's own specimen
    //    (o.specimen_id in diagnostic_reports.performer), the same value space the picker now
    //    offers (Task 3 — patients.managing_organization is set on 1 of 3714 rows, so the old
    //    predicate selected nothing on real data). The `{{param.facility}}` token is a plain
    //    string substitution — an UNSET token throws "unbound parameter" even when the param is
    //    declared `required:false` (see custom-query-run.ts). So this filter is only truly
    //    optional if every caller always supplies `facility` (empty string for "no filter"); the
    //    seeded design's `facility` param should default to `''` for this reason.
    //  - R3d cutover: reads lab_results (observation_desc/abnormal_flag/result_timestamp);
    //    facility subquery via bare patient_id against patients. No specimen, no gender.
    //  - ⛔ ISOLATE ANCHOR — `abnormal_flag in ('S','I','R')` ALONE IS NOT "an antibiotic
    //    susceptibility result". S/I/R is just a coded interpretation, and real DISA data puts it on
    //    far more than antibiotics. Measured on the TDS site (2026-08-02), that bare filter selects
    //    18,732 rows of which only ~118 are bacterial AST:
    //      · 16,288 (87%) EQA proficiency panels (EQSS1-6, "A-1".."A-6") — 100% R by design, because
    //        they are quality-control specimens, not patients. Unfiltered they alone would report a
    //        ~99% resistance rate.
    //      · ~2,150 HIV ANTIRETROVIRAL resistance results (Atazanavir, Lopinavir, Tenofovir,
    //        Efavirenz, …) — real S/I/R, but ARVs are not antibacterials and must never appear in an
    //        antibiogram.
    //      · plus Epithelial cells, Pus cells, Comments and OD values that happen to be coded S/I/R.
    //    So require the AST's specimen to have ALSO produced an organism (LOINC 634-6). A
    //    susceptibility test exists BECAUSE a culture grew something; EQA panels and ARV panels have
    //    no isolate, so the structure of the data excludes them without hardcoding an antibiotic or
    //    organism list (which would be per-country and immediately stale — see the CE convention
    //    against inlining clinical vocabularies).
    //    q-amr-antibiogram / q-amr-first-isolate-summary / q-amr-glass-ris already anchored this way;
    //    these two were the 2-of-5 an earlier pass missed. Proven a no-op on culture+AST data.
    sql: {
      postgres: `select
  coalesce(o.observation_desc, '(unknown)') as antibiotic,
  count(*)::int as tested,
  sum(case when o.abnormal_flag = 'R' then 1 else 0 end)::int as r,
  sum(case when o.abnormal_flag = 'I' then 1 else 0 end)::int as i,
  sum(case when o.abnormal_flag = 'S' then 1 else 0 end)::int as s,
  round(100.0 * sum(case when o.abnormal_flag = 'R' then 1 else 0 end) / nullif(count(*), 0), 1)::float8 as "percentR"
from lab_results o
left join specimens s on o.specimen_id = s.id
where o.abnormal_flag in ('S', 'I', 'R')
  and o.specimen_id is not null and o.specimen_id <> ''
  and exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)
  and (coalesce(o.result_timestamp, s.received_time) is null
       or (coalesce(o.result_timestamp, s.received_time) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z')))
  and ({{param.facility}} = '' or o.specimen_id in (
    select specimen_id from diagnostic_reports where performer = {{param.facility}}
  ))
group by coalesce(o.observation_desc, '(unknown)')
order by "percentR" desc`,
      // Task 2 port: count(*) filter(...) -> sum(case...), ::int -> cast(...as int),
      // ::float8 -> cast(...as float), string || -> +. `{{param.to}}`/`{{param.facility}}` are
      // always quoted string literals at substitution time (see custom-query-run.ts's
      // `sqlString`), so `+` concatenation here is always string+string — no cast needed.
      mssql: `select
  coalesce(o.observation_desc, '(unknown)') as antibiotic,
  cast(count(*) as int) as tested,
  cast(sum(case when o.abnormal_flag = 'R' then 1 else 0 end) as int) as r,
  cast(sum(case when o.abnormal_flag = 'I' then 1 else 0 end) as int) as i,
  cast(sum(case when o.abnormal_flag = 'S' then 1 else 0 end) as int) as s,
  cast(round(100.0 * sum(case when o.abnormal_flag = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as float) as "percentR"
from lab_results o
left join specimens s on o.specimen_id = s.id
where o.abnormal_flag in ('S', 'I', 'R')
  and o.specimen_id is not null and o.specimen_id <> ''
  and exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)
  and (coalesce(o.result_timestamp, s.received_time) is null
       or (coalesce(o.result_timestamp, s.received_time) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z')))
  and ({{param.facility}} = '' or o.specimen_id in (
    select specimen_id from diagnostic_reports where performer = {{param.facility}}
  ))
group by coalesce(o.observation_desc, '(unknown)')
order by "percentR" desc`,
      // Task 5 mysql port: ::int -> cast(...as signed); ::float8 -> cast(...as double); string
      // || -> concat(); double-quoted alias "percentR" -> backtick `percentR` (MySQL treats
      // "..." as a string literal, so it must be a backtick to be a usable result key/order key).
      mysql: `select
  coalesce(o.observation_desc, '(unknown)') as antibiotic,
  cast(count(*) as signed) as tested,
  cast(sum(case when o.abnormal_flag = 'R' then 1 else 0 end) as signed) as r,
  cast(sum(case when o.abnormal_flag = 'I' then 1 else 0 end) as signed) as i,
  cast(sum(case when o.abnormal_flag = 'S' then 1 else 0 end) as signed) as s,
  cast(round(100.0 * sum(case when o.abnormal_flag = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as double) as \`percentR\`
from lab_results o
left join specimens s on o.specimen_id = s.id
where o.abnormal_flag in ('S', 'I', 'R')
  and o.specimen_id is not null and o.specimen_id <> ''
  and exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)
  and (coalesce(o.result_timestamp, s.received_time) is null
       or (coalesce(o.result_timestamp, s.received_time) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z')))
  and ({{param.facility}} = '' or o.specimen_id in (
    select specimen_id from diagnostic_reports where performer = {{param.facility}}
  ))
group by coalesce(o.observation_desc, '(unknown)')
order by \`percentR\` desc`,
    },
  },
  {
    id: 'q-test-volume',
    name: 'Test volume by month',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/test-volume.ts exactly: group service_requests by
    // month(authored_on) x test (code_text, coalesced to '(unknown)'), COUNT(*). The catalog also
    // declares a `facility` select parameter but never actually applies it in `run()` (only
    // p.from/p.to are read); this seeded DESIGN now DOES apply it (Task 3), closing that gap.
    //  - facility: filters through the request's own SPECIMENS
    //    (lab_results -> diagnostic_reports.performer), NOT through sr.patient_id. A patient may be
    //    served by more than one laboratory, and a patient-keyed predicate would attribute all of
    //    that patient's requests to whichever lab tested any one of them. Previously this query
    //    declared the control and ignored it, so choosing a facility silently changed nothing.
    //  - month bucket: to_char(date_trunc('month', authored_on), 'YYYY-MM'), matching monthKey()'s
    //    `${getFullYear()}-${pad(getMonth()+1)}` (dev DB session TimeZone is UTC and authored_on is
    //    a date-only string, so there's no local-vs-UTC boundary ambiguity here).
    //  - date range: `from`/`to` are REQUIRED here (the catalog treats them as optional, but
    //    substituteParams throws "unbound parameter" for any {{param.x}} token missing from the
    //    values bag regardless of a param's own `required` flag — same reasoning as
    //    q-amr-resistance; simpler to just require the range than guard every date comparison).
    //    endOfDay: `<= (to || 'T23:59:59.999Z')`.
    //  - row order: month ASC, then test ASC — matches the catalog's explicit
    //    `.sort((a,b) => month asc, then test.localeCompare(test))`.
    //  - R3c cutover: reads `lab_requests` (not the thin `service_requests` table) —
    //    `authored_at`/`panel_desc` in place of thin `authored_on`/`code_text`; no other behavior
    //    change.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ],
    sql: {
      postgres: `select
  to_char(date_trunc('month', sr.authored_at::timestamptz), 'YYYY-MM') as month,
  coalesce(sr.panel_desc, '(unknown)') as test,
  count(*)::int as count
from lab_requests sr
where sr.authored_at >= {{param.from}}
  and sr.authored_at <= ({{param.to}} || 'T23:59:59.999Z')
  and ({{param.facility}} = '' or sr.id in (
    select l.request_id from lab_results l join diagnostic_reports d on d.specimen_id = l.specimen_id where d.performer = {{param.facility}}
  ))
group by 1, 2
order by 1, 2`,
      // Task 2 port: to_char(date_trunc('month', ...), 'YYYY-MM') -> format(cast(...as
      // datetime2), 'yyyy-MM'); ::int -> cast(...as int); string || -> +. GROUP BY ordinals
      // (`group by 1, 2`) are NOT supported by T-SQL (unlike ORDER BY, which does support them
      // there too) — the grouped expressions are spelled out instead.
      mssql: `select
  format(cast(sr.authored_at as datetime2), 'yyyy-MM') as month,
  coalesce(sr.panel_desc, '(unknown)') as test,
  cast(count(*) as int) as count
from lab_requests sr
where sr.authored_at >= {{param.from}}
  and sr.authored_at <= ({{param.to}} + 'T23:59:59.999Z')
  and ({{param.facility}} = '' or sr.id in (
    select l.request_id from lab_results l join diagnostic_reports d on d.specimen_id = l.specimen_id where d.performer = {{param.facility}}
  ))
group by format(cast(sr.authored_at as datetime2), 'yyyy-MM'), coalesce(sr.panel_desc, '(unknown)')
order by 1, 2`,
      // Task 5 mysql port: authored_on is an ISO 'YYYY-MM-DD...' string, so substr(...,1,7) IS
      // 'YYYY-MM' (avoids MySQL's fussy T/Z timestamp parsing); ::int -> cast(...as signed);
      // string || -> concat(). ONLY_FULL_GROUP_BY is ON by default in MySQL 8, so the grouped
      // expressions are spelled out (ordinal `group by 1,2` is accepted by MySQL, but spelling
      // out matches the mssql variant and is unambiguous). ORDER BY ordinals are fine.
      mysql: `select
  substr(sr.authored_at, 1, 7) as month,
  coalesce(sr.panel_desc, '(unknown)') as test,
  cast(count(*) as signed) as count
from lab_requests sr
where sr.authored_at >= {{param.from}}
  and sr.authored_at <= concat({{param.to}}, 'T23:59:59.999Z')
  and ({{param.facility}} = '' or sr.id in (
    select l.request_id from lab_results l join diagnostic_reports d on d.specimen_id = l.specimen_id where d.performer = {{param.facility}}
  ))
group by substr(sr.authored_at, 1, 7), coalesce(sr.panel_desc, '(unknown)')
order by 1, 2`,
    },
  },
  {
    id: 'q-turnaround-time',
    name: 'Specimen turnaround time',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/turnaround-time.ts: pair each diagnostic_report with
    // its patient's EARLIEST specimen receipt (no direct report->specimen FK in the flat schema) —
    // the `received` CTE is intentionally NOT date/facility filtered, matching the catalog, which
    // builds its `earliest` map from ALL specimens up front and only filters the REPORTS side by
    // date/facility while iterating. `hours` = round((issued - received) / 1h), matching
    // hoursBetween's `Math.round((b-a)/3_600_000)`; rows with no specimen match or issued <
    // received are excluded (mirrors `b < a -> null`). Grouped by test (code_text, coalesced
    // '(unknown)'): count, avgHours = round(avg(already-rounded whole-hour values), 1) (mirrors
    // `Math.round((sum/n)*10)/10` — the catalog rounds EACH report's hours to a whole number
    // first, THEN averages those rounded values, THEN rounds the average to 1 decimal — the CTE's
    // `hours` column is that first whole-number rounding), minHours/maxHours = min/max of the same
    // whole-hour values.
    //  - facility filter (optional): same '' = no-filter guard as q-amr-resistance, direct
    //    equality on dr.performer — the same diagnostic_reports.performer value space the picker
    //    now offers (Task 3 — patients.managing_organization is set on 1 of 3714 rows, so the old
    //    subquery via managing_organization selected nothing on real data).
    //  - R3c cutover: reads the v2 `specimens`/`diagnostic_reports`/`patients` tables (originally
    //    `v2_specimens`/`v2_diagnostic_reports`/`v2_patients`, renamed to canonical in R3e —
    //    replacing the old thin `specimens`/`diagnostic_reports`/`patients` tables they superseded).
    //    v2 stores the bare FHIR id directly
    //    (`patient_id`) rather than a `Patient/`-prefixed reference string (`subject_ref`), so the
    //    `received` CTE keys on `patient_id` and the report<->specimen join compares `patient_id`
    //    to `patient_id`.
    //  - PRECISION GUARD (both sides): `specimens.received_time` and `diagnostic_reports.issued`
    //    are TEXT columns holding whatever FHIR supplied, verbatim. `Specimen.receivedTime` is a
    //    FHIR `dateTime`, and CE's DATETIME_RE (packages/fhir/src/datatypes/primitives.ts) accepts
    //    year ('2026') and year-month ('2026-07') precision — both of which are valid FHIR and
    //    both of which make `::timestamptz` throw ("invalid input syntax"), failing the WHOLE
    //    report with a 500 rather than skipping the row. A month-precision receipt also cannot
    //    yield an hours-level turnaround, so these rows are EXCLUDED, not coerced to midnight —
    //    coercing would silently invent up to a month of turnaround. The guard sits INSIDE the
    //    `received` CTE, before `min()`, because `min()` here is a lexical TEXT min: a single
    //    '2026-07' row would otherwise win over that patient's real full-precision receipts
    //    (shorter prefix sorts first) and poison every report paired to that patient.
    //    `issued` is typed FHIR `instant` (INSTANT_RE, always full precision) so it should never
    //    be partial — it is guarded symmetrically as defence in depth, since the cast is equally
    //    fatal there and nothing in the SQL layer re-checks what a writer put in the column.
    //    Ported per engine: postgres `~`, mysql `regexp`, mssql `like` with [0-9] ranges (T-SQL
    //    has no regex; the LIKE pins the full YYYY-MM-DDThh:mm:ss prefix, which is exactly the
    //    partial-precision exclusion the regex performs).
    //  - date range: from/to REQUIRED (see q-test-volume's note on why); endOfDay applied to `to`.
    //  - row order: avgHours DESCENDING, matching `rows.sort((a,b) => b.avgHours - a.avgHours)`.
    //    The catalog has no secondary tiebreaker (nondeterministic tie order there); `test asc` is
    //    added here only as an explicit, documented tiebreaker for determinism — the parity check
    //    normalizes ties the same way before comparing, not to mask a primary-order divergence.
    //  - KNOWN GAP (fidelity, not fixable in SQL): the catalog's chart is
    //    `{type:'stat', value:String(overallAvg), label:'Overall avg hours'}`, a value computed
    //    FRESH from that run's rows (a count-weighted average across all test groups). A
    //    data-driven report's `chart` is a static field on the `reports` record
    //    (packages/bootstrap/src/index.ts `runDataDriven` uses `def.chart` as-is, never
    //    recomputed), so this can't be reproduced as a live number — seeded with a placeholder.
    //    Not a blocker in practice: the Reports page (apps/studio/src/reports/*) doesn't render
    //    `chart` at all today (only `summaryMetrics`, which DOES recompute per-run generically).
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ],
    sql: {
      postgres: `with received as (
  select patient_id, min(received_time) as received_time
  from specimens
  where patient_id is not null
    and received_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  group by patient_id
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    round(extract(epoch from (dr.issued::timestamptz - r.received_time::timestamptz)) / 3600.0)::int as hours
  from diagnostic_reports dr
  join received r on r.patient_id = dr.patient_id
  where dr.issued ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= ({{param.to}} || 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.performer = {{param.facility}})
)
select
  test,
  count(*)::int as count,
  round(avg(hours)::numeric, 1)::float8 as "avgHours",
  min(hours)::int as "minHours",
  max(hours)::int as "maxHours"
from paired
group by test
order by "avgHours" desc, test asc`,
      // Task 2 port: extract(epoch from (a::timestamptz - b::timestamptz))/3600.0 ->
      // datediff(second, cast(b as datetime2), cast(a as datetime2))/3600.0 (datediff's arg
      // order is (start, end) = (received, issued), matching issued-minus-received). T-SQL's
      // ROUND requires an explicit `length` argument (unlike Postgres, where it defaults to 0)
      // — `, 0` added for the single-arg `round(hours)` call. AVG() of an integer expression
      // truncates to integer in T-SQL (unlike Postgres, where avg(int) already returns numeric)
      // — `hours` is cast to decimal(18,4) BEFORE avg() to avoid silently truncating the
      // average; flagged for the parity harness as the most likely subtle divergence in this
      // query. string || -> +.
      mssql: `with received as (
  select patient_id, min(received_time) as received_time
  from specimens
  where patient_id is not null
    and received_time like '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]%'
  group by patient_id
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    cast(round(datediff(second, cast(r.received_time as datetime2), cast(dr.issued as datetime2)) / 3600.0, 0) as int) as hours
  from diagnostic_reports dr
  join received r on r.patient_id = dr.patient_id
  where dr.issued like '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]%'
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= ({{param.to}} + 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.performer = {{param.facility}})
)
select
  test,
  cast(count(*) as int) as count,
  cast(round(avg(cast(hours as decimal(18,4))), 1) as float) as "avgHours",
  cast(min(hours) as int) as "minHours",
  cast(max(hours) as int) as "maxHours"
from paired
group by test
order by "avgHours" desc, test asc`,
      // Task 5 mysql port: seconds-diff via timestampdiff(second, received, issued) where each
      // ISO string is parsed by str_to_date(substr(x,1,19), '%Y-%m-%dT%H:%i:%s') — a plain cast
      // to datetime does NOT accept the embedded literal 'T', so str_to_date is required; substr
      // (…,1,19) = 'YYYY-MM-DDTHH:MM:SS'. Arg order (start,end)=(received,issued)=issued-minus-
      // received. round(x)::int -> cast(round(x,0) as signed); avg rounded like the mssql variant
      // (cast to decimal before avg to avoid integer truncation, then to double); min/max::int ->
      // cast(...as signed); string || -> concat(); backtick aliases so ORDER BY key resolves.
      // Flagged for the parity harness (same subtle avg/rounding divergence risk as mssql).
      mysql: `with received as (
  select patient_id, min(received_time) as received_time
  from specimens
  where patient_id is not null
    and received_time regexp '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  group by patient_id
),
paired as (
  select
    coalesce(dr.code_text, '(unknown)') as test,
    cast(round(timestampdiff(second, str_to_date(substr(r.received_time, 1, 19), '%Y-%m-%dT%H:%i:%s'), str_to_date(substr(dr.issued, 1, 19), '%Y-%m-%dT%H:%i:%s')) / 3600.0, 0) as signed) as hours
  from diagnostic_reports dr
  join received r on r.patient_id = dr.patient_id
  where dr.issued regexp '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and dr.issued >= r.received_time
    and dr.issued >= {{param.from}}
    and dr.issued <= concat({{param.to}}, 'T23:59:59.999Z')
    and ({{param.facility}} = '' or dr.performer = {{param.facility}})
)
select
  test,
  cast(count(*) as signed) as count,
  cast(round(avg(cast(hours as decimal(18,4))), 1) as double) as \`avgHours\`,
  cast(min(hours) as signed) as \`minHours\`,
  cast(max(hours) as signed) as \`maxHours\`
from paired
group by test
order by \`avgHours\` desc, test asc`,
    },
  },
  {
    id: 'q-patient-demographics',
    name: 'Patient demographics by age band',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/patient-demographics.ts + helpers.ts's ageBand():
    // calendar-exact age (Postgres `age()` performs the same year/month/day-borrow subtraction as
    // the JS algorithm) banded into the same fixed buckets, grouped by band x gender (male/female/
    // other, where 'other' folds NULL and any non-male/female value — matches the JS else-branch).
    //  - R3b cutover: reads the v2 `patients` table (originally `v2_patients`, renamed to
    //    canonical in R3e — replacing the old thin `patients` table it superseded) —
    //    `date_of_birth` in place of thin `birth_date`, and `sex` ('M'/'F'/'O'/'U'/null) in place
    //    of thin `gender`
    //    ('male'/'female'/other); the outer aggregates map sex='M'/'F' to male/female and
    //    everything else (including null) to 'other', preserving the same male/female/other shape.
    //  - `asOf` (optional, a single reference date — NOT a range): catalog defaults to
    //    '2026-01-01T00:00:00Z' when unset/empty. Same '' = "use default" guard as facility below.
    //  - facility filter (optional): same '' = no-filter guard as q-amr-resistance; matches the
    //    patient against diagnostic_reports.performer, the same value space the picker now offers
    //    (Task 3 — patients.managing_organization is set on 1 of 3714 rows, so the old direct
    //    equality selected nothing on real data).
    //  - row order: the FIXED band order ['0-4','5-14','15-24','25-49','50+','unknown'], NOT a
    //    count-based sort — matches the catalog's `ORDER.filter(b => counts.has(b)).map(...)`.
    params: [
      { id: 'facility', label: 'Facility', type: 'text', required: false },
      { id: 'asOf', label: 'As of', type: 'text', required: false },
    ],
    sql: {
      postgres: `with params as (
  select coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z')::date as ref_date
),
banded as (
  select
    case
      when p.date_of_birth is null then 'unknown'
      when p.date_of_birth::date > pr.ref_date then 'unknown'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 4 then '0-4'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 14 then '5-14'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 24 then '15-24'
      when extract(year from age(pr.ref_date, p.date_of_birth::date)) <= 49 then '25-49'
      else '50+'
    end as band,
    p.sex
  from patients p, params pr
  where ({{param.facility}} = '' or p.id in (select patient_id from diagnostic_reports where performer = {{param.facility}}))
)
select
  band,
  count(*)::int as total,
  sum(case when sex = 'M' then 1 else 0 end)::int as male,
  sum(case when sex = 'F' then 1 else 0 end)::int as female,
  sum(case when sex is null or sex not in ('M', 'F') then 1 else 0 end)::int as other
from banded
group by band
order by array_position(array['0-4','5-14','15-24','25-49','50+','unknown']::text[], band)`,
      // Task 2 port — the trickiest of the nine (flagged for extra parity-harness attention):
      //  - X::date -> cast(X as date); SQL Server's CAST(...AS date) does parse ISO-8601
      //    'YYYY-MM-DDTHH:MM:SSZ' strings (ODBC canonical style), matching the `asOf` default.
      //  - extract(year from age(ref, birth)) -> the documented datediff(year,...) - borrow-day
      //    formula, per the porting rules table. The formula is repeated inline for every band
      //    boundary (T-SQL has no cheap equivalent of reusing a CTE-computed `age_years` here
      //    without another CTE layer) — verbose but mechanical; each occurrence is identical.
      //  - array_position(...) ORDER BY -> the fixed CASE-mapping per the rules table.
      //  - `from patients p, params pr` (implicit cross join) -> explicit `cross join` (same
      //    semantics, only a style change).
      mssql: `with params as (
  select cast(coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z') as date) as ref_date
),
banded as (
  select
    case
      when p.date_of_birth is null then 'unknown'
      when cast(p.date_of_birth as date) > pr.ref_date then 'unknown'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 4 then '0-4'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 14 then '5-14'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 24 then '15-24'
      when (datediff(year, cast(p.date_of_birth as date), pr.ref_date) - case when (month(cast(p.date_of_birth as date)) > month(pr.ref_date)) or (month(cast(p.date_of_birth as date)) = month(pr.ref_date) and day(cast(p.date_of_birth as date)) > day(pr.ref_date)) then 1 else 0 end) <= 49 then '25-49'
      else '50+'
    end as band,
    p.sex
  from patients p cross join params pr
  where ({{param.facility}} = '' or p.id in (select patient_id from diagnostic_reports where performer = {{param.facility}}))
)
select
  band,
  cast(count(*) as int) as total,
  cast(sum(case when sex = 'M' then 1 else 0 end) as int) as male,
  cast(sum(case when sex = 'F' then 1 else 0 end) as int) as female,
  cast(sum(case when sex is null or sex not in ('M', 'F') then 1 else 0 end) as int) as other
from banded
group by band
order by case band when '0-4' then 1 when '5-14' then 2 when '15-24' then 3 when '25-49' then 4 when '50+' then 5 when 'unknown' then 6 end`,
      // Task 5 mysql port — MySQL SIMPLIFIES the age ladder vs mssql: timestampdiff(YEAR, birth,
      // ref) is calendar-exact (handles month/day borrow) so NO borrow-day CASE is needed. Age
      // computed once as a single expression per band boundary. substr(x,1,10) strips any T..Z
      // before casting to date (raw ISO-with-T casts unreliably in MySQL). ref_date derives from
      // asOf the same way (cast(substr(coalesce(nullif(...),'<default>'),1,10) as date)).
      // X::date -> cast(substr(X,1,10) as date); ::int -> cast(...as signed); implicit cross join
      // -> explicit cross join; array_position ORDER BY -> the fixed CASE-mapping.
      mysql: `with params as (
  select cast(substr(coalesce(nullif({{param.asOf}}, ''), '2026-01-01T00:00:00Z'), 1, 10) as date) as ref_date
),
banded as (
  select
    case
      when p.date_of_birth is null then 'unknown'
      when cast(substr(p.date_of_birth, 1, 10) as date) > pr.ref_date then 'unknown'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 4 then '0-4'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 14 then '5-14'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 24 then '15-24'
      when timestampdiff(year, cast(substr(p.date_of_birth, 1, 10) as date), pr.ref_date) <= 49 then '25-49'
      else '50+'
    end as band,
    p.sex
  from patients p cross join params pr
  where ({{param.facility}} = '' or p.id in (select patient_id from diagnostic_reports where performer = {{param.facility}}))
)
select
  band,
  cast(count(*) as signed) as total,
  cast(sum(case when sex = 'M' then 1 else 0 end) as signed) as male,
  cast(sum(case when sex = 'F' then 1 else 0 end) as signed) as female,
  cast(sum(case when sex is null or sex not in ('M', 'F') then 1 else 0 end) as signed) as other
from banded
group by band
order by case band when '0-4' then 1 when '5-14' then 2 when '15-24' then 3 when '25-49' then 4 when '50+' then 5 when 'unknown' then 6 end`,
    },
  },
  {
    id: 'q-amr-facility-summary',
    name: 'AMR resistance by facility',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-facility-summary.ts exactly: WIDE format, one row
    // per facility (patients.managing_organization), tested = all AST results (interpretation_code
    // in S/I/R) whose patient resolves to a facility, resistant = the R subset. Observations whose
    // patient has no facility (or no matching patient row at all) are dropped by the join, mirroring
    // the catalog's `if (!facility) continue`.
    //  - date range: `from`/`to` REQUIRED here (catalog treats them as optional — same reasoning as
    //    q-test-volume/q-turnaround-time: substituteParams throws "unbound parameter" for any
    //    {{param.x}} token missing from values regardless of the param's own `required` flag, so
    //    it's simpler to just require the range). endOfDay applied to `to`.
    //  - patient join: `o.patient_id = p.id` directly — v2 stores the bare FHIR id, so the old
    //    thin `'Patient/' || p.id` prefix reconstruction (mirroring the catalog's
    //    `.replace(/^Patient\//, '')`) is gone.
    //  - row order: facility ASC — matches the catalog's explicit `.sort((a,b) =>
    //    a.facility.localeCompare(b.facility))`.
    //  - R3d cutover: reads lab_results join patients on bare o.patient_id = p.id
    //    (abnormal_flag/result_timestamp). No specimen, no gender.
    //  - ⛔ ISOLATE ANCHOR: same requirement, same reason as q-amr-resistance — the AST's specimen
    //    must also carry an organism (LOINC 634-6), or EQA proficiency panels (100% R) and HIV
    //    antiretroviral resistance results are counted as facility antibacterial resistance. These
    //    two queries were the 2-of-5 that an earlier pass left unanchored.
    //  - ⛔ FACILITY SOURCE: this report returned ZERO rows on real data because it grouped by
    //    `patients.managing_organization`, which the CDR/DISA source NEVER sets — measured 1 of 589
    //    patients, and that one is the seed. The facility does exist, on the report:
    //    `DiagnosticReport.performer[0].display`, populated on 1303 of 1303 ingested reports with
    //    15+ real facilities (Dodoma, Mwananyamala, Mnazi Mmoja, Muhimbili, Aga Khan, ...).
    //    `coalesce(f.performer, p.managing_organization)` prefers the report's own facility and
    //    still honours `managing_organization` for a sender that does populate it (the seed does).
    //  - ⛔ THE `facility_of` CTE IS NOT COSMETIC — it prevents a fan-out that would inflate every
    //    count. Reports are per-ORDER, not per-specimen: measured, 521 specimens carry 2 reports and
    //    some carry up to 14, so joining `diagnostic_reports` directly would multiply a specimen's
    //    AST rows by its report count. Collapsing to one row per specimen first makes the join
    //    1:1. `min(performer)` is safe AND lossless here because every specimen's reports agree on
    //    the facility (`count(distinct performer) = 1` for all 585 specimens); if a future sender
    //    ever disagrees, `min` still picks deterministically and still cannot fan out.
    //  - the patient join is LEFT, not inner: the facility no longer comes from the patient, so a
    //    result whose patient row is missing must not be dropped from its facility's totals.
    //  - ⛔ MYSQL ONLY_FULL_GROUP_BY: the projected label used to nest the raw fallback expression
    //    `coalesce(f.performer, p.managing_organization)` inside the outer `coalesce(...)` (i.e.
    //    `coalesce(min(fm.name), min(f.performer_display), coalesce(f.performer,
    //    p.managing_organization))`). Postgres and mssql accept that nested form because they
    //    recognise it as syntactically identical to the `group by` item even inside another
    //    function call; MySQL 8's default `sql_mode=ONLY_FULL_GROUP_BY` does NOT extend that
    //    recognition to a nested position and rejects it with ERROR 1055. Fixed by wrapping every
    //    branch in its own aggregate: `min(f.performer)`, `min(p.managing_organization)`. This is
    //    semantically identical, not just syntactically legal: every row in a group agrees on
    //    `coalesce(f.performer, p.managing_organization)` by definition of the group key, so if any
    //    row has a non-null `f.performer`, that value IS the group's code and `min(f.performer)`
    //    recovers it; if every row's `f.performer` is null, they all necessarily share the same
    //    `p.managing_organization` and `min(p.managing_organization)` recovers that instead. The
    //    fallback order is unchanged: resolved registry name, then wire display, then the code,
    //    then the patient organization. All three dialects were re-ported in lockstep even though
    //    only mysql's strict mode rejects the nested form, per this file's own "spelled out" rule
    //    at the ONLY_FULL_GROUP_BY comment on q-test-volume above.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: {
      postgres: `with facility_of as (
  select specimen_id, min(performer) as performer, min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
)
select
  coalesce(min(fm.name), min(f.performer_display), min(f.performer), min(p.managing_organization)) as facility,
  count(*)::int as tested,
  sum(case when o.abnormal_flag = 'R' then 1 else 0 end)::int as resistant
from lab_results o
left join patients p on o.patient_id = p.id
left join specimens s on o.specimen_id = s.id
left join facility_of f on f.specimen_id = o.specimen_id
left join facility_map fm on fm.source_system = coalesce(f.source_system, '') and fm.source_code = f.performer
where o.abnormal_flag in ('S', 'I', 'R')
  and o.specimen_id is not null and o.specimen_id <> ''
  and exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)
  and coalesce(f.performer, p.managing_organization) is not null
  and (coalesce(o.result_timestamp, s.received_time) is null
       or (coalesce(o.result_timestamp, s.received_time) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z')))
group by coalesce(f.performer, p.managing_organization)
order by 1`,
      // Task 2 port: ::int -> cast(...as int); end-of-day string || -> + (the `{{param.to}}`
      // concat).
      mssql: `with facility_of as (
  select specimen_id, min(performer) as performer, min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
)
select
  coalesce(min(fm.name), min(f.performer_display), min(f.performer), min(p.managing_organization)) as facility,
  cast(count(*) as int) as tested,
  cast(sum(case when o.abnormal_flag = 'R' then 1 else 0 end) as int) as resistant
from lab_results o
left join patients p on o.patient_id = p.id
left join specimens s on o.specimen_id = s.id
left join facility_of f on f.specimen_id = o.specimen_id
left join facility_map fm on fm.source_system = coalesce(f.source_system, '') and fm.source_code = f.performer
where o.abnormal_flag in ('S', 'I', 'R')
  and o.specimen_id is not null and o.specimen_id <> ''
  and exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)
  and coalesce(f.performer, p.managing_organization) is not null
  and (coalesce(o.result_timestamp, s.received_time) is null
       or (coalesce(o.result_timestamp, s.received_time) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z')))
group by coalesce(f.performer, p.managing_organization)
order by 1`,
      // Task 5 mysql port: ::int -> cast(...as signed); end-of-day string || -> concat().
      // Otherwise identical structure.
      mysql: `with facility_of as (
  select specimen_id, min(performer) as performer, min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
)
select
  coalesce(min(fm.name), min(f.performer_display), min(f.performer), min(p.managing_organization)) as facility,
  cast(count(*) as signed) as tested,
  cast(sum(case when o.abnormal_flag = 'R' then 1 else 0 end) as signed) as resistant
from lab_results o
left join patients p on o.patient_id = p.id
left join specimens s on o.specimen_id = s.id
left join facility_of f on f.specimen_id = o.specimen_id
left join facility_map fm on fm.source_system = coalesce(f.source_system, '') and fm.source_code = f.performer
where o.abnormal_flag in ('S', 'I', 'R')
  and o.specimen_id is not null and o.specimen_id <> ''
  and exists (select 1 from lab_results g where g.observation_code = '634-6' and g.specimen_id = o.specimen_id)
  and coalesce(f.performer, p.managing_organization) is not null
  and (coalesce(o.result_timestamp, s.received_time) is null
       or (coalesce(o.result_timestamp, s.received_time) >= {{param.from}}
           and coalesce(o.result_timestamp, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z')))
group by coalesce(f.performer, p.managing_organization)
order by 1`,
    },
  },
  {
    id: 'q-amr-glass-ris',
    name: 'AMR GLASS RIS (stratified)',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-glass-ris.ts + the shared AMR helpers
    // (packages/reporting/src/amr/{query,isolates,glass}.ts) exactly. An "isolate" is ONE row per
    // organism-identification observation (`code_code = '634-6'`); its antibiotic results are ALL
    // susceptibility observations (`interpretation_code in S/I/R`) sharing its `specimen_ref`
    // (joined by specimen only — NOT date/patient-scoped, matching `buildIsolates`'s `astBySpec`
    // map, which is built from the FULL unfiltered ast set — see fetchAmrData: only `org` rows are
    // window-filtered, `ast` never is).
    //  - DEDUP KEY (first-isolate): `(subject_ref, pathogen_code /* value_code, else '(unknown)' */,
    //    specimen_type /* specimens.type_code, else '(unknown)' */)` — one row per key, keeping the
    //    EARLIEST `iso_date` (= coalesce(effective_date_time, specimen.received_time); a NULL date
    //    is a valid key value and is always kept ("dateless retained") per `firstIsolate`'s
    //    null-sorts-last comparator — reproduced here as `distinct on (...) order by ...,
    //    (iso_date is null), iso_date asc, obs_id asc`. TIEBREAK: the catalog's underlying sort is
    //    stable but `fetchAmrData`'s org query has no ORDER BY, so a same-date tie's winner depends
    //    on Postgres's unspecified default row-return order — genuinely nondeterministic there. This
    //    SQL adds `obs_id asc` as an explicit, DETERMINISTIC tiebreaker (documented, not hidden) so
    //    the data-driven path is reproducible; the live parity fixture below was built with NO
    //    same-date ties so this tiebreaker never actually decides a winner in the checked cases.
    //  - window filter applies ONLY to the isolate-identifying (org) observation's date, exactly as
    //    fetchAmrData does; the antibiotic-result (ast) join is never date-filtered.
    //  - age band: GLASS bands (ageBandGlass) computed from the patient's birth_date relative to the
    //    isolate's OWN date (or '1970-01-01' if dateless) via Postgres `age()`, which performs the
    //    same calendar year/month/day-borrow subtraction as the JS algorithm (same technique already
    //    used/validated by q-patient-demographics's age banding).
    //  - country/year: both `{{param.country}}`/`{{param.year}}` tokens are ALWAYS bound
    //    (substituteParams throws on any unbound token) — same '' = "use default" guard as
    //    q-patient-demographics's `asOf`: `coalesce(nullif({{param.X}}, ''), '<default>')`. The
    //    seeded design defaults both params' `value` to `''` so an untouched filter still resolves.
    //  - ⛔ YEAR IS DERIVED, not defaulted to 0. The catalog's `year: 0` fallback shipped a literal
    //    zero into every row of a GLASS submission file — a value that is not a year and that no
    //    recipient can interpret. The isolate's own date is right there and is populated on 47 of
    //    47 measured isolates, so the year comes from it: `substr(iso_date, 1, 4)` (`substring` on
    //    T-SQL, which has no `substr`). Read off the TEXT column deliberately — casting to a
    //    timestamp would throw on the partial-precision FHIR dates this warehouse legitimately
    //    stores (see q-turnaround-time's precision guard). `{{param.year}}` still wins when the
    //    operator sets it, and a dateless isolate still falls back to '0' rather than a NULL row.
    //    `iso_year` therefore joins the GROUP BY: GLASS RIS is reported per year, so two years of
    //    the same pathogen/antibiotic must NOT be summed into one row — which is exactly what the
    //    constant 0 did.
    //  - ⚠ `Iso3Country` stays operator-supplied with an 'XXX' placeholder: CE holds no country
    //    setting to derive it from, and inventing one would be worse than a visibly unset value.
    //  - ⚠ `AgeGroup`/`Origin` reading 'unknown' is SOURCE DATA, not a defect here: measured,
    //    date_of_birth is present on 201 of 589 patients and `specimens.origin` is null on 588 of
    //    588. Do not "fix" those in SQL — there is nothing to read.
    //  - final grouping: specimenType x pathogen x antibiotic x gender x ageBand x origin x year,
    //    matching `toGlassRis`'s grouping key plus the derived year described above.
    //  - row order: Specimen, PathogenCode, AntibioticCode, Gender, AgeGroup, Origin all ASC —
    //    matches `toGlassRis`'s explicit chained `.localeCompare` sort.
    //  - R3d cutover: reads lab_results/specimens/patients; bare-id joins
    //    (oo.specimen_id = s.id, oo.patient_id = p.id); org uses observation_code/coded_value/
    //    text_value/result_timestamp; ast uses observation_desc/abnormal_flag; gender via sex
    //    inverse-map; birth_date from patients.date_of_birth; ref columns renamed
    //    specimen_ref->specimen_id, subject_ref->patient_id throughout.
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'country', label: 'Country code', type: 'text', required: false },
      { id: 'year', label: 'Year', type: 'text', required: false },
    ],
    sql: {
      postgres: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date,
    case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end as gender,
    p.date_of_birth as birth_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  left join patients p on oo.patient_id = p.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    extract(year from age(coalesce(im.iso_date, '1970-01-01')::date, im.birth_date::date))::int as age_years
  from isolate_meta im
),
first_isolates as (
  select distinct on (patient_id, pathogen_code, specimen_type)
    obs_id, specimen_id, patient_id, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from age_banded
  order by patient_id, pathogen_code, specimen_type, (iso_date is null), iso_date asc, obs_id asc
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('passthrough')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris,
    coalesce(nullif({{param.year}}, ''), substr(fi.iso_date, 1, 4), '0') as iso_year
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  coalesce(nullif({{param.country}}, ''), 'XXX') as "Iso3Country",
  iso_year::int as "Year",
  specimen_type as "Specimen",
  pathogen_code as "PathogenCode",
  antibiotic as "AntibioticCode",
  gender as "Gender",
  age_band as "AgeGroup",
  origin as "Origin",
  sum(case when ris = 'R' then 1 else 0 end)::int as "Resistant",
  sum(case when ris = 'I' then 1 else 0 end)::int as "Intermediate",
  sum(case when ris = 'S' then 1 else 0 end)::int as "Susceptible",
  count(*)::int as "Total"
from results
group by specimen_type, pathogen_code, pathogen_name, antibiotic, gender, age_band, origin, iso_year
order by "Specimen", "PathogenCode", "AntibioticCode", "Gender", "AgeGroup", "Origin"`,
      // Task 2 port — FLAGGED for extra parity-harness attention (the most structurally complex
      // query in the seed set):
      //  - `distinct on (...) order by k1,k2,k3,(iso_date is null),iso_date asc,obs_id asc` has
      //    no T-SQL equivalent; ported to `row_number() over (partition by k1,k2,k3 order by
      //    case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc) = 1`,
      //    which is the standard dedup-first-row idiom and preserves the same tiebreak order
      //    (non-null dates sort first, exactly like Postgres's boolean-ascending `(iso_date is
      //    null)`; `iso_date`/`obs_id` are plain nvarchar/varchar columns on both engines, so the
      //    ORDER BY is a lexicographic string sort on both sides — consistent, not a divergence).
      //  - `age(ref, birth)` extract-year -> the documented datediff(year,...) - borrow-day
      //    formula (ref = coalesce(iso_date, '1970-01-01')::date here, not a fixed reference —
      //    same rule, different operands than q-patient-demographics). When birth_date is NULL,
      //    `datediff(year, cast(NULL as date), ...)` returns NULL and the borrow CASE's
      //    `month(NULL)`/`day(NULL)` comparisons are also NULL (falls to the CASE's ELSE 0),
      //    so age_years ends up NULL — consistent with Postgres's `age(x, null) -> null` and
      //    harmless since the outer CASE checks `birth_date is null` first regardless.
      //  - string || -> +; ::int -> cast(...as int).
      mssql: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date,
    case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end as gender,
    p.date_of_birth as birth_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  left join patients p on oo.patient_id = p.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    cast(
      datediff(year, cast(im.birth_date as date), cast(coalesce(im.iso_date, '1970-01-01') as date))
      - case when (month(cast(im.birth_date as date)) > month(cast(coalesce(im.iso_date, '1970-01-01') as date)))
              or (month(cast(im.birth_date as date)) = month(cast(coalesce(im.iso_date, '1970-01-01') as date))
                  and day(cast(im.birth_date as date)) > day(cast(coalesce(im.iso_date, '1970-01-01') as date)))
             then 1 else 0 end
    as int) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by patient_id, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
    obs_id, specimen_id, patient_id, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from ranked
  where rn = 1
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('passthrough')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris,
    coalesce(nullif({{param.year}}, ''), substring(fi.iso_date, 1, 4), '0') as iso_year
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  coalesce(nullif({{param.country}}, ''), 'XXX') as "Iso3Country",
  cast(iso_year as int) as "Year",
  specimen_type as "Specimen",
  pathogen_code as "PathogenCode",
  antibiotic as "AntibioticCode",
  gender as "Gender",
  age_band as "AgeGroup",
  origin as "Origin",
  cast(sum(case when ris = 'R' then 1 else 0 end) as int) as "Resistant",
  cast(sum(case when ris = 'I' then 1 else 0 end) as int) as "Intermediate",
  cast(sum(case when ris = 'S' then 1 else 0 end) as int) as "Susceptible",
  cast(count(*) as int) as "Total"
from results
group by specimen_type, pathogen_code, pathogen_name, antibiotic, gender, age_band, origin, iso_year
order by "Specimen", "PathogenCode", "AntibioticCode", "Gender", "AgeGroup", "Origin"`,
      // Task 5 mysql port — same CTE-chain shape as the mssql variant (distinct on ->
      // row_number()/rn=1 dedup) but with MySQL's simpler calendar-exact age:
      //  - age = timestampdiff(year, birth, iso_date-or-'1970-01-01'); calendar-exact, NO
      //    borrow-day CASE. substr(x,1,10) strips T..Z before casting to date; NULL birth_date ->
      //    NULL age_years (outer CASE checks `birth_date is null` first, so harmless).
      //  - end-of-day || -> concat().
      //  - ::int -> cast(...as signed); coalesce(nullif({{param.year}},''),'0')::int ->
      //    cast(coalesce(nullif(...),'0') as signed).
      //  - all double-quoted result aliases -> BACKTICK aliases (MySQL "..." is a string literal);
      //    ORDER BY references those backtick aliases so it sorts by column, not by a literal.
      mysql: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date,
    case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end as gender,
    p.date_of_birth as birth_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  left join patients p on oo.patient_id = p.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    timestampdiff(year, cast(substr(im.birth_date, 1, 10) as date), cast(substr(coalesce(im.iso_date, '1970-01-01'), 1, 10) as date)) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by patient_id, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
    obs_id, specimen_id, patient_id, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from ranked
  where rn = 1
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('passthrough')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris,
    coalesce(nullif({{param.year}}, ''), substr(fi.iso_date, 1, 4), '0') as iso_year
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  coalesce(nullif({{param.country}}, ''), 'XXX') as \`Iso3Country\`,
  cast(iso_year as signed) as \`Year\`,
  specimen_type as \`Specimen\`,
  pathogen_code as \`PathogenCode\`,
  antibiotic as \`AntibioticCode\`,
  gender as \`Gender\`,
  age_band as \`AgeGroup\`,
  origin as \`Origin\`,
  cast(sum(case when ris = 'R' then 1 else 0 end) as signed) as \`Resistant\`,
  cast(sum(case when ris = 'I' then 1 else 0 end) as signed) as \`Intermediate\`,
  cast(sum(case when ris = 'S' then 1 else 0 end) as signed) as \`Susceptible\`,
  cast(count(*) as signed) as \`Total\`
from results
group by specimen_type, pathogen_code, pathogen_name, antibiotic, gender, age_band, origin, iso_year
order by \`Specimen\`, \`PathogenCode\`, \`AntibioticCode\`, \`Gender\`, \`AgeGroup\`, \`Origin\``,
    },
  },
  {
    id: 'q-amr-first-isolate-summary',
    name: 'AMR first-isolate resistance summary',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-first-isolate-summary.ts + the shared AMR helpers
    // (packages/reporting/src/amr/{query,isolates,aggregate}.ts) exactly. Same first-isolate CTE
    // shape as q-amr-glass-ris (see its comment for the full dedup-key/tiebreak/window-scoping
    // rationale — identical here), but the final aggregation groups only by specimenType x pathogen
    // x antibiotic (no gender/age/origin stratification), matching `aggregateRIS`'s grouping key.
    //  - aggregateRIS grouping: specimenType x pathogen x antibiotic -> tested/r/i/s/percentR (CASE
    //    conditional aggregates, `percentR` rounding matches q-amr-resistance's pattern exactly).
    //  - row order: specimenType ASC, pathogen ASC, antibiotic ASC — matches aggregateRIS's explicit
    //    `.sort((a,b) => specimenType.localeCompare || pathogen.localeCompare || antibiotic.localeCompare)`.
    //  - R3d cutover: same v2 read-model transform as q-amr-glass-ris (see its comment) —
    //    lab_results/specimens/patients, bare-id joins, gender via sex inverse-map,
    //    ref columns renamed specimen_ref->specimen_id/subject_ref->patient_id. gender is computed
    //    in isolate_meta but not emitted here (final grouping is specimenType x pathogen x antibiotic).
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: {
      postgres: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date,
    case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end as gender,
    p.date_of_birth as birth_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  left join patients p on oo.patient_id = p.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    extract(year from age(coalesce(im.iso_date, '1970-01-01')::date, im.birth_date::date))::int as age_years
  from isolate_meta im
),
first_isolates as (
  select distinct on (patient_id, pathogen_code, specimen_type)
    obs_id, specimen_id, patient_id, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from age_banded
  order by patient_id, pathogen_code, specimen_type, (iso_date is null), iso_date asc, obs_id asc
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('passthrough')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  specimen_type as "specimenType",
  pathogen_name as "pathogen",
  antibiotic,
  count(*)::int as tested,
  sum(case when ris = 'R' then 1 else 0 end)::int as r,
  sum(case when ris = 'I' then 1 else 0 end)::int as i,
  sum(case when ris = 'S' then 1 else 0 end)::int as s,
  round(100.0 * sum(case when ris = 'R' then 1 else 0 end) / nullif(count(*), 0), 1)::float8 as "percentR"
from results
group by specimen_type, pathogen_code, pathogen_name, antibiotic
order by specimen_type, pathogen_name, antibiotic`,
      // Task 2 port: identical CTE chain/rationale as q-amr-glass-ris's mssql variant (distinct
      // on -> row_number()/rn=1, age() -> datediff(year,...) borrow-day formula, ::int ->
      // cast(...as int), string || -> +) — see its comment for the full explanation. Flagged for
      // the same extra parity-harness attention.
      mssql: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date,
    case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end as gender,
    p.date_of_birth as birth_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  left join patients p on oo.patient_id = p.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    cast(
      datediff(year, cast(im.birth_date as date), cast(coalesce(im.iso_date, '1970-01-01') as date))
      - case when (month(cast(im.birth_date as date)) > month(cast(coalesce(im.iso_date, '1970-01-01') as date)))
              or (month(cast(im.birth_date as date)) = month(cast(coalesce(im.iso_date, '1970-01-01') as date))
                  and day(cast(im.birth_date as date)) > day(cast(coalesce(im.iso_date, '1970-01-01') as date)))
             then 1 else 0 end
    as int) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by patient_id, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
    obs_id, specimen_id, patient_id, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from ranked
  where rn = 1
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('passthrough')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  specimen_type as "specimenType",
  pathogen_name as "pathogen",
  antibiotic,
  cast(count(*) as int) as tested,
  cast(sum(case when ris = 'R' then 1 else 0 end) as int) as r,
  cast(sum(case when ris = 'I' then 1 else 0 end) as int) as i,
  cast(sum(case when ris = 'S' then 1 else 0 end) as int) as s,
  cast(round(100.0 * sum(case when ris = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as float) as "percentR"
from results
group by specimen_type, pathogen_code, pathogen_name, antibiotic
order by specimen_type, pathogen_name, antibiotic`,
      // Task 5 mysql port: same CTE-chain port as q-amr-glass-ris's mysql variant (row_number
      // dedup + timestampdiff calendar-exact age + concat + substr date-strip) — see its comment.
      // Final grouping is specimenType x pathogen x antibiotic only. Backtick the quoted result
      // aliases (`specimenType`, `pathogen`, `percentR`); round(...,1)::float8 -> cast(round(...,1)
      // as double); ::int -> cast(...as signed). ORDER BY uses the raw grouped columns (bare, fine).
      mysql: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    case when s.origin in ('inpatient', 'outpatient') then s.origin else 'unknown' end as origin,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date,
    case p.sex when 'M' then 'male' when 'F' then 'female' when 'O' then 'other' else 'unknown' end as gender,
    p.date_of_birth as birth_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  left join patients p on oo.patient_id = p.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z'))
),
age_banded as (
  select im.*,
    timestampdiff(year, cast(substr(im.birth_date, 1, 10) as date), cast(substr(coalesce(im.iso_date, '1970-01-01'), 1, 10) as date)) as age_years
  from isolate_meta im
),
ranked as (
  select ab.*,
    row_number() over (
      partition by patient_id, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from age_banded ab
),
first_isolates as (
  select
    obs_id, specimen_id, patient_id, specimen_type, origin, pathogen_code, pathogen_name, iso_date, gender,
    case
      when birth_date is null then 'unknown'
      when age_years < 0 then 'unknown'
      when age_years >= 65 then '65+'
      when age_years = 0 then '0'
      when age_years between 1 and 4 then '1-4'
      when age_years between 5 and 14 then '5-14'
      when age_years between 15 and 24 then '15-24'
      when age_years between 25 and 34 then '25-34'
      when age_years between 35 and 44 then '35-44'
      when age_years between 45 and 54 then '45-54'
      when age_years between 55 and 64 then '55-64'
      else 'unknown'
    end as age_band
  from ranked
  where rn = 1
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('passthrough')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.*, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  specimen_type as \`specimenType\`,
  pathogen_name as \`pathogen\`,
  antibiotic,
  cast(count(*) as signed) as tested,
  cast(sum(case when ris = 'R' then 1 else 0 end) as signed) as r,
  cast(sum(case when ris = 'I' then 1 else 0 end) as signed) as i,
  cast(sum(case when ris = 'S' then 1 else 0 end) as signed) as s,
  cast(round(100.0 * sum(case when ris = 'R' then 1 else 0 end) / nullif(count(*), 0), 1) as double) as \`percentR\`
from results
group by specimen_type, pathogen_code, pathogen_name, antibiotic
order by specimen_type, pathogen_name, antibiotic`,
    },
  },
  {
    id: 'q-amr-antibiogram',
    name: 'AMR cumulative antibiogram (fixed panel)',
    connectorId: '',
    // Mirrors packages/reporting/src/reports/amr-antibiogram.ts + the shared AMR helpers
    // (fetchAmrData/buildIsolates/firstIsolate/antibiogram) exactly, EXCEPT the antibiotic columns:
    // see ANTIBIOGRAM_PANEL's comment for why a fixed panel replaces the catalog's dynamic union.
    //  - first-isolate CTE (org_obs/isolate_meta/first_isolates): IDENTICAL dedup key
    //    (subject_ref, pathogen_code, specimen_type), tiebreak (earliest iso_date, dateless
    //    retained, obs_id asc as an explicit deterministic tiebreaker), and window-scoping (only
    //    the isolate-identifying observation's date is filtered; the antibiotic-result join is
    //    never date-filtered) as q-amr-glass-ris/q-amr-first-isolate-summary — see their comments
    //    for the full rationale. specimen_type is carried only to participate in the dedup key
    //    (matches firstIsolate's key); the final aggregation collapses across specimen types,
    //    matching `antibiogram()`'s grouping by pathogen alone (not `aggregateRIS`'s
    //    specimen-type-stratified grouping).
    //  - unlike q-amr-glass-ris, no gender/age/origin/country/year columns are needed (antibiogram
    //    doesn't stratify by them), so isolate_meta only carries what antibiogram() actually uses.
    //  - date range: from/to REQUIRED here even though the catalog's own zod schema declares both
    //    optional (`z.object({from: z.string().optional(), to: z.string().optional()})`, and an
    //    empty {} window disables date filtering entirely in `fetchAmrData`'s `inWindow`) — same
    //    reasoning as every other AMR seed query: substituteParams throws "unbound parameter" for
    //    any {{param.x}} token missing from values regardless of the param's own required flag, so
    //    it's simpler to require the range than special-case an unfiltered run. The seeded design
    //    marks `dateRange` required, matching rt-amr-glass-ris/rt-amr-first-isolate-summary.
    //  - cell format: see antibiogramCellSql's comment — one CASE column per ANTIBIOGRAM_PANEL
    //    antibiotic, `${percentR}% (${tested})` or `''`, byte-identical to the catalog's cells for
    //    every antibiotic the panel and the catalog's dynamic union both contain.
    //  - ⛔ ROWS ARE LABELLED BY NAME, DEDUPED BY CODE. The matrix used to print the raw source
    //    code (`VIBCO`, `SHIFL`, `ACIBA`) as the pathogen, which is unreadable to the person the
    //    report is for. The display name is already in the warehouse — `lab_results.text_value`
    //    carries "Vibrio cholera 01 Ogawa" etc. beside the code — so it is used for the label while
    //    the FIRST-ISOLATE DEDUP KEY AND GROUPING STAY ON `pathogen_code`. That split matters: the
    //    code is the stable identity, and grouping by a free-text name would merge two codes that
    //    happen to share a description. `pathogen_name` rides in the GROUP BY only because it is
    //    functionally dependent on the code (verified 1:1 on real data); if a source ever breaks
    //    that, the group splits — visibly — rather than silently collapsing distinct organisms.
    //  - row order: pathogen NAME ASC (was code) — the label the reader actually sees.
    //  - R3d cutover: reads lab_results/specimens; bare-id join (oo.specimen_id = s.id);
    //    org uses observation_code/coded_value/result_timestamp, ast uses observation_desc/
    //    abnormal_flag; ref columns renamed specimen_ref->specimen_id, subject_ref->patient_id.
    //    No gender/age/origin (antibiogram doesn't stratify by them).
    params: [
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ],
    sql: {
      postgres: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= ({{param.to}} || 'T23:59:59.999Z'))
),
first_isolates as (
  select distinct on (patient_id, pathogen_code, specimen_type)
    obs_id, specimen_id, pathogen_code, pathogen_name
  from isolate_meta
  order by patient_id, pathogen_code, specimen_type, (iso_date is null), iso_date asc, obs_id asc
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('bucket')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.pathogen_code, fi.pathogen_name, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  pathogen_name as pathogen,
  ${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'postgres')).join(',\n  ')}
from results
group by pathogen_code, pathogen_name
order by pathogen_name`,
      // Task 2 port: distinct on -> row_number()/rn=1 (no age/gender columns needed here, so
      // the CTE chain is simpler than glass-ris/first-isolate-summary — same dedup rationale,
      // see q-amr-glass-ris's comment); string || -> +; antibiogramCellSql('mssql') ports each
      // CASE column per the rules table (see its own doc comment for the float->text caveat).
      mssql: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= ({{param.to}} + 'T23:59:59.999Z'))
),
ranked as (
  select im.*,
    row_number() over (
      partition by patient_id, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from isolate_meta im
),
first_isolates as (
  select obs_id, specimen_id, pathogen_code, pathogen_name
  from ranked
  where rn = 1
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('bucket')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.pathogen_code, fi.pathogen_name, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  pathogen_name as pathogen,
  ${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'mssql')).join(',\n  ')}
from results
group by pathogen_code, pathogen_name
order by pathogen_name`,
      // Task 5 mysql port: simpler CTE chain (no age/gender) — distinct on -> row_number()/rn=1;
      // end-of-day || -> concat(); the SELECT emits one backtick-aliased CASE
      // column per panel antibiotic via antibiogramCellSql(a, 'mysql'). pathogen_code as pathogen
      // (bare alias, fine); group by / order by pathogen_code unchanged.
      mysql: `with org_obs as (
  select o.id, o.specimen_id, o.patient_id, o.coded_value, o.text_value, o.result_timestamp
  from lab_results o
  where o.observation_code = '634-6'
    and o.specimen_id is not null and o.specimen_id <> ''
    and o.patient_id is not null and o.patient_id <> ''
),
isolate_meta as (
  select
    oo.id as obs_id,
    oo.specimen_id,
    oo.patient_id,
    coalesce(s.type_code, '(unknown)') as specimen_type,
    coalesce(oo.coded_value, '(unknown)') as pathogen_code,
    coalesce(oo.text_value, oo.coded_value, '(unknown)') as pathogen_name,
    coalesce(oo.result_timestamp, s.received_time) as iso_date
  from org_obs oo
  left join specimens s on oo.specimen_id = s.id
  where coalesce(oo.result_timestamp, s.received_time) is null
     or (coalesce(oo.result_timestamp, s.received_time) >= {{param.from}}
         and coalesce(oo.result_timestamp, s.received_time) <= concat({{param.to}}, 'T23:59:59.999Z'))
),
ranked as (
  select im.*,
    row_number() over (
      partition by patient_id, pathogen_code, specimen_type
      order by case when iso_date is null then 1 else 0 end asc, iso_date asc, obs_id asc
    ) as rn
  from isolate_meta im
),
first_isolates as (
  select obs_id, specimen_id, pathogen_code, pathogen_name
  from ranked
  where rn = 1
),
ast_obs as (
  select o.specimen_id, ${antibioticNormalizeSql('bucket')} as antibiotic, o.abnormal_flag as ris
  from lab_results o
  where o.abnormal_flag in ('S', 'I', 'R')
    and (o.observation_code is not null or o.observation_desc is not null)
    and o.specimen_id is not null and o.specimen_id <> ''
),
results as (
  select fi.pathogen_code, fi.pathogen_name, a.antibiotic, a.ris
  from first_isolates fi
  join ast_obs a on a.specimen_id = fi.specimen_id
)
select
  pathogen_name as pathogen,
  ${ANTIBIOGRAM_PANEL.map((a) => antibiogramCellSql(a, 'mysql')).join(',\n  ')}
from results
group by pathogen_code, pathogen_name
order by pathogen_name`,
    },
  },

  // ── Clinical microbiology report ────────────────────────────────────────────────────────────
  // The one built-in aimed at a CLINICIAN rather than a programme analyst: a single request's
  // culture & sensitivity result, for handing to the requesting ward.
  //
  // ⚠ Two terminology joins do real work here, and neither hardcodes a vocabulary:
  //   1. `vs-non-reportable` EXCLUDES collection metadata. Without it the report prints the
  //      courier's phone number ("Collect By Contact Number") as a lab result — measured, 425 rows.
  //   2. `vs-ast-interpretation` supplies the DISPLAY for S/I/R. DISA's dictionary describes code
  //      `I` as "Invalid" (an upstream Tanzania typo for "Intermediate"); CE stores what the lab
  //      published, verbatim, and renders the terminology display instead. `coalesce` keeps it
  //      FAIL-OPEN: a code with no terminology entry still prints its raw text.
  // The status token (`normal`/`abnormal`/`indeterminate`) stays in SQL deliberately — mapping a
  // clinical value to a presentational one is CE's choice, and the PDF renderer must never learn
  // what an antibiotic is.
  {
    id: 'q-clinical-micro-ast',
    name: 'Clinical — antimicrobial susceptibility for a request',
    connectorId: '',
    params: [{ id: 'request', label: 'Request ID', type: 'text', required: true }],
    sql: {
      postgres: `select
  r.observation_desc as test,
  coalesce(tc.display, r.text_value, r.coded_value) as result,
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end as status
from lab_results r
left join terminology_codes tc
  on tc.value_set_id = 'vs-ast-interpretation'
 and tc.code = coalesce(r.coded_value, r.abnormal_flag)
where r.request_id = {{param.request}}
  and r.observation_code not in (select code from terminology_codes where value_set_id = 'vs-non-reportable')
  and coalesce(r.coded_value, r.abnormal_flag) is not null
  and r.observation_code not in ('634-6', 'ORGS')
group by 1, 2, 3
order by 1`,
      // ⚠ MSSQL has no ordinal GROUP BY — the select expressions are repeated in full.
      mssql: `select
  r.observation_desc as test,
  coalesce(tc.display, r.text_value, r.coded_value) as result,
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end as status
from lab_results r
left join terminology_codes tc
  on tc.value_set_id = 'vs-ast-interpretation'
 and tc.code = coalesce(r.coded_value, r.abnormal_flag)
where r.request_id = {{param.request}}
  and r.observation_code not in (select code from terminology_codes where value_set_id = 'vs-non-reportable')
  and coalesce(r.coded_value, r.abnormal_flag) is not null
  and r.observation_code not in ('634-6', 'ORGS')
group by
  r.observation_desc,
  coalesce(tc.display, r.text_value, r.coded_value),
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end
order by 1`,
      mysql: `select
  r.observation_desc as test,
  coalesce(tc.display, r.text_value, r.coded_value) as result,
  case coalesce(r.coded_value, r.abnormal_flag)
    when 'S' then 'normal'
    when 'R' then 'abnormal'
    when 'I' then 'indeterminate'
    else '' end as status
from lab_results r
left join terminology_codes tc
  on tc.value_set_id = 'vs-ast-interpretation'
 and tc.code = coalesce(r.coded_value, r.abnormal_flag)
where r.request_id = {{param.request}}
  and r.observation_code not in (select code from terminology_codes where value_set_id = 'vs-non-reportable')
  and coalesce(r.coded_value, r.abnormal_flag) is not null
  and r.observation_code not in ('634-6', 'ORGS')
group by 1, 2, 3
order by 1`,
    },
  },
  // Patient/specimen header for the same request. Returns ONE row; the design binds it several
  // times with different column projections (the panel strip, the isolate, the barcode, the QR).
  // ⚠ `lab_results.request_id` references the ServiceRequest **id**, so `lab_requests` joins on
  // `id` — NOT on its own `request_id` column, which is the site's lab number. Getting that
  // backwards returns an empty header and looks exactly like a binding failure.
  // `max(...)` rather than `limit 1`/`top 1`: portable across all three dialects unchanged.
  //
  // ⛔ THE PERFORMING LABORATORY. `diagnostic_reports.performer` is the facility CODE (`BAMAA`);
  // `performer_display` is the human name (`Aga Khan`). Resolution goes through `facility_map`, the
  // external warehouse dimension — `facility_registry` is in the INTERNAL db and CANNOT be joined
  // from here (the constraint `011_terminology_codes` documents and `012_facility_map` exists to
  // work around).
  //  - ⛔ NEVER key on `performer_display`: five DISA codes (BAMAA/BBFAF/CDABE/EAFAE/NDFAM) all
  //    display "Aga Khan", in five different districts. FHIR says `Reference.display` must never be
  //    used for matching, and keying on it once already collapsed five laboratories into one.
  //  - name falls back CODE-resolved -> wire display -> bare code. `performer_display` is itself
  //    30-char truncated upstream by DISA ("Ocean Road Cancer Institute (O"), so the fallback is
  //    readable but clipped; only a registry mapping produces the full name.
  //  - location falls back `facility_map` -> `facilities`. `facility_map` is rebuilt only by a
  //    MANUAL publish while ingest runs continuously, so a site first seen since the last publish
  //    has no `facility_map` row at all; `facilities` is written at ingest and is always current.
  //    Preferring `facility_map` also keeps one measured bad row off the page — BAGAE's
  //    `facilities` row carries a street address and a PO box where region/district belong.
  //  - ⛔ `coalesce(fo.source_system, '')` on the facility_map side only: the resolver normalises a
  //    NULL source_system to '' when building the dimension, and `NULL = NULL` is false, so a plain
  //    equality join drops exactly the rows `relational-writer.ts` says exist.
  //  - the `facility_of` CTE is the same per-specimen fold, for the same reason, as
  //    `q-amr-facility-summary`: reports are per-ORDER, so joining `diagnostic_reports` directly
  //    would fan this one-row header out. Measured: 0 of 3713 specimens disagree on `performer` and
  //    0 of 88 codes carry two displays, so the three `min()`s cannot mix two facilities.
  //  - ⛔ `facility_loc` folds `facilities` for the SAME reason `facility_of` folds the reports, and
  //    it is NOT redundant with the composite join predicate. `facilities.id` is the raw FHIR
  //    resource id and BOTH Organization and Location project into that table, so two resources
  //    describing one facility are two rows sharing a (source_system, facility_code) pair — and this
  //    query must return exactly ONE row, because the design binds rows[0] into the panel, the
  //    barcode and the QR. Measured: 0 duplicate pairs today, 89 Organization + 1 Location. The fold
  //    makes the single row structural instead of a property of the current feed.
  //    ⚠ `min(region)` and `min(district)` are taken independently, so two rows for one facility
  //    could contribute one field each. Deterministic and bounded (both describe the same facility),
  //    and the same tradeoff `facility_of` already documents — but it is a tradeoff, not a proof.
  {
    id: 'q-clinical-micro-header',
    name: 'Clinical — patient & specimen header',
    connectorId: '',
    params: [{ id: 'request', label: 'Request ID', type: 'text', required: true }],
    sql: { postgres: `with facility_of as (
  select specimen_id,
    min(performer) as performer,
    min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
),
facility_loc as (
  select source_system, facility_code,
    min(region) as region,
    min(district) as district
  from facilities
  where facility_code is not null and facility_code <> ''
  group by source_system, facility_code
),
facility as (
  select fo.specimen_id,
    coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab,
    coalesce(fm.district, fa.district) as district,
    coalesce(fm.region, fa.region) as region
  from facility_of fo
  left join facility_map fm on fm.source_system = coalesce(fo.source_system, '') and fm.source_code = fo.performer
  left join facility_loc fa on fa.source_system = fo.source_system and fa.facility_code = fo.performer
)
select
  p.surname as patient_surname,
  p.firstname as patient_firstname,
  p.sex as sex,
  p.date_of_birth as dob,
  s.type_text as specimen,
  left(s.received_time, 10) as received,
  q.request_id as lab_number,
  q.panel_desc as panel,
  (select max(coalesce(o.text_value, o.coded_value)) from lab_results o
     where o.request_id = q.id and o.observation_code in ('634-6', 'ORGS')) as organism,
  f.performing_lab as performing_lab,
  case when f.district is not null and f.region is not null
       then f.district || ', ' || f.region
       else coalesce(f.district, f.region) end as lab_location
from lab_requests q
left join patients p on p.id = q.patient_id
left join specimens s on s.id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
left join facility f on f.specimen_id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
where q.id = {{param.request}}`, mssql: `with facility_of as (
  select specimen_id,
    min(performer) as performer,
    min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
),
facility_loc as (
  select source_system, facility_code,
    min(region) as region,
    min(district) as district
  from facilities
  where facility_code is not null and facility_code <> ''
  group by source_system, facility_code
),
facility as (
  select fo.specimen_id,
    coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab,
    coalesce(fm.district, fa.district) as district,
    coalesce(fm.region, fa.region) as region
  from facility_of fo
  left join facility_map fm on fm.source_system = coalesce(fo.source_system, '') and fm.source_code = fo.performer
  left join facility_loc fa on fa.source_system = fo.source_system and fa.facility_code = fo.performer
)
select
  p.surname as patient_surname,
  p.firstname as patient_firstname,
  p.sex as sex,
  p.date_of_birth as dob,
  s.type_text as specimen,
  left(s.received_time, 10) as received,
  q.request_id as lab_number,
  q.panel_desc as panel,
  (select max(coalesce(o.text_value, o.coded_value)) from lab_results o
     where o.request_id = q.id and o.observation_code in ('634-6', 'ORGS')) as organism,
  f.performing_lab as performing_lab,
  case when f.district is not null and f.region is not null
       then f.district + ', ' + f.region
       else coalesce(f.district, f.region) end as lab_location
from lab_requests q
left join patients p on p.id = q.patient_id
left join specimens s on s.id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
left join facility f on f.specimen_id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
where q.id = {{param.request}}`, mysql: `with facility_of as (
  select specimen_id,
    min(performer) as performer,
    min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
),
facility_loc as (
  select source_system, facility_code,
    min(region) as region,
    min(district) as district
  from facilities
  where facility_code is not null and facility_code <> ''
  group by source_system, facility_code
),
facility as (
  select fo.specimen_id,
    coalesce(fm.name, fo.performer_display, fo.performer) as performing_lab,
    coalesce(fm.district, fa.district) as district,
    coalesce(fm.region, fa.region) as region
  from facility_of fo
  left join facility_map fm on fm.source_system = coalesce(fo.source_system, '') and fm.source_code = fo.performer
  left join facility_loc fa on fa.source_system = fo.source_system and fa.facility_code = fo.performer
)
select
  p.surname as patient_surname,
  p.firstname as patient_firstname,
  p.sex as sex,
  p.date_of_birth as dob,
  s.type_text as specimen,
  left(s.received_time, 10) as received,
  q.request_id as lab_number,
  q.panel_desc as panel,
  (select max(coalesce(o.text_value, o.coded_value)) from lab_results o
     where o.request_id = q.id and o.observation_code in ('634-6', 'ORGS')) as organism,
  f.performing_lab as performing_lab,
  case when f.district is not null and f.region is not null
       then concat(f.district, ', ', f.region)
       else coalesce(f.district, f.region) end as lab_location
from lab_requests q
left join patients p on p.id = q.patient_id
left join specimens s on s.id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
left join facility f on f.specimen_id = (select max(l.specimen_id) from lab_results l where l.request_id = q.id)
where q.id = {{param.request}}` },
  },
];

/** Report-designer page designs, one table bound to a `SEED_QUERIES` entry (via `simpleTableDesign`). */
export const SEED_DESIGNS: ReportDesign[] = [
  simpleTableDesign({
    id: 'rt-amr-resistance',
    name: 'AMR Resistance Rate',
    queryId: 'q-amr-resistance',
    columns: [
      { key: 'antibiotic', label: 'Antibiotic' },
      { key: 'tested', label: 'Tested' },
      { key: 'r', label: 'R' },
      { key: 'i', label: 'I' },
      { key: 's', label: 'S' },
      { key: 'percentR', label: '%R' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-test-volume',
    name: 'Test Volume Over Time',
    queryId: 'q-test-volume',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'test', label: 'Test' },
      { key: 'count', label: 'Count' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      // Applied by the query (see q-test-volume's comment): filters through the request's own
      // specimens (lab_results -> diagnostic_reports.performer). The catalog's own `run()` never
      // applied this control — this seeded query closes that gap, so unlike the catalog, choosing
      // a facility here actually changes the result.
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-turnaround-time',
    name: 'Specimen Turnaround Time',
    queryId: 'q-turnaround-time',
    columns: [
      { key: 'test', label: 'Test' },
      { key: 'count', label: 'Reports' },
      { key: 'avgHours', label: 'Avg hours' },
      { key: 'minHours', label: 'Min' },
      { key: 'maxHours', label: 'Max' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-patient-demographics',
    name: 'Patient Demographics',
    queryId: 'q-patient-demographics',
    columns: [
      { key: 'band', label: 'Age band' },
      { key: 'total', label: 'Total' },
      { key: 'male', label: 'Male' },
      { key: 'female', label: 'Female' },
      { key: 'other', label: 'Other/unknown' },
    ],
    parameters: [
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
      { key: 'asOf', label: 'As of (YYYY-MM-DD)', type: 'text', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-amr-facility-summary',
    name: 'AMR Resistance by Facility',
    queryId: 'q-amr-facility-summary',
    columns: [
      { key: 'facility', label: 'Facility' },
      { key: 'tested', label: 'Tested' },
      { key: 'resistant', label: 'Resistant' },
    ],
    parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
  }),
  simpleTableDesign({
    id: 'rt-amr-glass-ris',
    name: 'AMR GLASS RIS (stratified)',
    queryId: 'q-amr-glass-ris',
    paper: 'Letter',
    orientation: 'landscape',
    // boundColumns mirror amr-glass-ris.ts's `columns` array 1:1 (keys + labels + order). The query
    // additionally SELECTs Iso3Country/Year, but the catalog table never projected them, so they are
    // intentionally NOT bound into the displayed table.
    columns: [
      { key: 'Specimen', label: 'Specimen' },
      { key: 'PathogenCode', label: 'Pathogen' },
      { key: 'AntibioticCode', label: 'Antibiotic' },
      { key: 'Gender', label: 'Gender' },
      { key: 'AgeGroup', label: 'Age' },
      { key: 'Origin', label: 'Origin' },
      { key: 'Resistant', label: 'R' },
      { key: 'Intermediate', label: 'I' },
      { key: 'Susceptible', label: 'S' },
      { key: 'Total', label: 'Total' },
    ],
    parameters: [
      { key: 'dateRange', label: 'Date range', type: 'daterange', required: true },
      { key: 'country', label: 'Country code', type: 'text', required: false, value: '' },
      { key: 'year', label: 'Year', type: 'text', required: false, value: '' },
    ],
  }),
  simpleTableDesign({
    id: 'rt-amr-first-isolate-summary',
    name: 'AMR First-Isolate Resistance Summary',
    queryId: 'q-amr-first-isolate-summary',
    columns: [
      { key: 'specimenType', label: 'Specimen' },
      { key: 'pathogen', label: 'Pathogen' },
      { key: 'antibiotic', label: 'Antibiotic' },
      { key: 'tested', label: 'Tested' },
      { key: 'r', label: 'R' },
      { key: 'i', label: 'I' },
      { key: 's', label: 'S' },
      { key: 'percentR', label: '%R' },
    ],
    parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
  }),
  simpleTableDesign({
    id: 'rt-amr-antibiogram',
    name: 'AMR Cumulative Antibiogram',
    queryId: 'q-amr-antibiogram',
    paper: 'Letter',
    orientation: 'landscape',
    columns: [
      { key: 'pathogen', label: 'Pathogen' },
      ...ANTIBIOGRAM_PANEL.map((a) => ({ key: a, label: a })),
    ],
    parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange', required: true }],
  }),

  // The clinical microbiology report. Authored as a literal rather than via `simpleTableDesign`
  // because it is not one table on a page: it is an identity header, a bound patient/specimen
  // panel, the isolate, a section band, and the susceptibility table.
  //
  // ⚠ Coordinates are px @96 (the renderer multiplies by 0.75 to reach pt) — the same units the
  // Report Designer canvas edits in.
  // ⚠ The two header tables bind the SAME query with different `boundColumns`. That is how the
  // reference mockup's information-panel strip is expressed with today's element kinds; a purpose
  // built key/value panel would drop the header row and set values under labels.
  {
    id: 'rt-clinical-micro',
    name: 'Clinical Microbiology Report',
    paper: 'A4',
    orientation: 'portrait',
    margins: { top: 32, right: 32, bottom: 32, left: 32 },
    parameters: [{ key: 'request', label: 'Request ID', type: 'text', required: true, value: '' }],
    pages: [{ id: 'p1', elements: [
      // Band 1 — the letterhead. Every value comes from Settings ▸ Laboratory via `{{lab.*}}`;
      // an install that has not configured its identity renders these BLANK rather than printing
      // the token, so the design stays valid out of the box.
      { id: 'logo', kind: 'image', name: 'Lab logo', rect: { x: 40, y: 28, w: 54, h: 54 }, src: '{{lab.logo}}' },
      { id: 'labname', kind: 'text', name: 'Lab name', rect: { x: 104, y: 30, w: 430, h: 18 }, text: '{{lab.name}}', style: { fontSize: 13, bold: true, color: '#0f172a' } },
      { id: 'labaddr', kind: 'text', name: 'Lab address', rect: { x: 104, y: 48, w: 430, h: 22 }, text: '{{lab.address}}', style: { fontSize: 7.5, color: '#64748b' } },
      { id: 'labcontact', kind: 'text', name: 'Lab contact', rect: { x: 104, y: 71, w: 430, h: 13 }, text: '{{lab.contact}}', style: { fontSize: 7.5, color: '#64748b' } },
      // Band 3 of the reference: a rule closing the identity header. Was missing entirely.
      { id: 'rule1', kind: 'line', name: 'rule1', rect: { x: 40, y: 92, w: 700, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
      { id: 'lab', kind: 'text', name: 'lab', rect: { x: 40, y: 102, w: 460, h: 16 }, text: 'LABORATORY REPORT', style: { fontSize: 15, bold: true, color: '#0f172a' } },
      { id: 'title', kind: 'text', name: 'title', rect: { x: 40, y: 124, w: 400, h: 16 }, text: 'MICROBIOLOGY — CULTURE & SENSITIVITY', style: { fontSize: 10, bold: true, color: '#334155' } },
      // The accession barcode a technologist scans. BOUND, not `{{param.request}}`: the design's
      // parameter is the ServiceRequest UUID, so a barcode of it would scan cleanly to the wrong
      // identifier. `lab_number` is the site's own lab number, which is what the specimen carries.
      { id: 'bc', kind: 'barcode', name: 'Lab number barcode', rect: { x: 556, y: 28, w: 184, h: 46 },
        caption: true,
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-header' },
        boundColumns: [{ key: 'lab_number', label: 'Lab number' }] },
      // Band 2 of the reference: a label→value metadata strip, NOT a one-row table. It was a table
      // with a header row until S4 gave the vocabulary a `keyvalue` panel; the column labels sat
      // above the values in a tinted band, which reads as a spreadsheet fragment rather than a
      // patient header. Two pair columns, so the ten facts fill five lines instead of ten.
      // ⛔ UNIT WARNING — this `rect` is px@96, but `pairRects`'s KV_PAD_Y/KV_INLINE_H constants are
      // raw POINTS. `drawElement` converts the rect with `toPt` (×0.75) before calling `pairRects`,
      // so the panel's real capacity must be computed in POINTS, not px@96 — mixing the two scales
      // is exactly the bug that shipped a fifth row sliced in half by the `org` band below it while
      // every test (and this comment) said it fit. Measured against the real path (`toPt` then
      // `pairRects`): box = {x:30, y:114, w:525, h:78} pt, box bottom **192pt**. Pairs start at
      // y=114+4=118pt and flow across then down at 14pt/row (KV_INLINE_H, raw pt); row 5 (pairs 9
      // and 10) occupies **174 → 188pt**, inside the box bottom with 4pt to spare.
      // ⛔ THIS PANEL IS NOW FULL. `pairRects` returns boxes past the bottom of the box and the
      // drawer clips them — a sixth row disappears silently, with no error. Field eleven (row 6,
      // 188 → 202pt) overflows a 192pt box. Whoever adds it must grow `h` again and push `org`,
      // `band`, `bandt`, and `tbl` further down, exactly as this slice did when it went from eight
      // pairs to ten (h: 84 → 104px; org/band/bandt/tbl each +20px). `report-seeds.test.ts` pins
      // both the fit and the remaining capacity.
      { id: 'hdr', kind: 'keyvalue', name: 'Patient & specimen', rect: { x: 40, y: 152, w: 700, h: 104 },
        layout: 'inline', panelColumns: 2,
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-header' },
        boundColumns: [
          { key: 'patient_surname', label: 'Surname', kind: 'label' },
          { key: 'specimen', label: 'Specimen', kind: 'label' },
          { key: 'patient_firstname', label: 'First name', kind: 'label' },
          { key: 'received', label: 'Received', kind: 'label' },
          { key: 'sex', label: 'Sex', kind: 'label' },
          { key: 'lab_number', label: 'Lab number', kind: 'label' },
          { key: 'dob', label: 'DOB', kind: 'label' },
          { key: 'panel', label: 'Panel', kind: 'label' },
          { key: 'performing_lab', label: 'Performing lab', kind: 'label' },
          { key: 'lab_location', label: 'Lab location', kind: 'label' },
        ] },
      // Band 4: a titled panel. Stacked, because an organism name ("Klebsiella pneumoniae") is
      // longer than the 40% an inline label would leave it, and it is the one fact on this page a
      // clinician looks for first.
      { id: 'org', kind: 'keyvalue', name: 'Organism', rect: { x: 40, y: 264, w: 700, h: 58 },
        layout: 'stacked', text: 'ORGANISM ISOLATED', style: { fill: '#334155', strokeColor: '#cbd5e1' },
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-header' },
        boundColumns: [{ key: 'organism', label: 'Isolate', kind: 'label' }] },
      { id: 'band', kind: 'rect', name: 'band', rect: { x: 40, y: 334, w: 700, h: 20 }, style: { fill: '#334155', strokeColor: '#334155' } },
      { id: 'bandt', kind: 'text', name: 'bandt', rect: { x: 40, y: 339, w: 420, h: 16 }, text: '   ANTIMICROBIAL SUSCEPTIBILITY', style: { fontSize: 8, bold: true, color: '#ffffff' } },
      // Two columns, not three: the interpretation IS the result for a susceptibility test, and
      // carrying the same fact in two renderings is what let them visibly disagree.
      { id: 'tbl', kind: 'table', name: 'Susceptibility', rect: { x: 40, y: 360, w: 700, h: 300 },
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-ast' },
        boundColumns: [
          { key: 'test', label: 'Antimicrobial', kind: 'label' },
          { key: 'result', label: 'Result', statusKey: 'status', emphasis: 'fill', kind: 'flag' },
        ] },
      // ⚠ The footer sits at the BOTTOM of the page: A4 portrait is 1123px tall at 96dpi and the
      // bottom margin is 32, so the last usable row is ~1091. These elements were authored at
      // y=700 — 62% down — which left the signature line floating mid-page under a table that
      // ends at 572. A signature block that is not at the foot of the page reads as an
      // unfinished document, and on a short result list the empty half below it reads as
      // "something failed to print".
      { id: 'rule2', kind: 'line', name: 'rule2', rect: { x: 40, y: 1000, w: 700, h: 0 }, style: { strokeColor: '#cbd5e1', strokeWidth: 0.75 } },
      // Same payload as the barcode, deliberately: a URL would need a deployment base URL this
      // design cannot know, and inventing one ships a QR that resolves nowhere.
      { id: 'qr', kind: 'qrcode', name: 'Lab number QR', rect: { x: 40, y: 1012, w: 62, h: 62 },
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-header' },
        boundColumns: [{ key: 'lab_number', label: 'Lab number' }] },
      { id: 'ft', kind: 'text', name: 'ft', rect: { x: 112, y: 1030, w: 380, h: 16 }, text: 'Interpretations reflect the laboratory’s reading at time of testing.', style: { fontSize: 7, color: '#94a3b8' } },
      { id: 'sig', kind: 'text', name: 'sig', rect: { x: 500, y: 1030, w: 240, h: 16 }, text: 'Authorised by ______________________', style: { fontSize: 8, color: '#475569' } },
    ] }],
  },
];

/** `reports` records linking a `SEED_DESIGNS` design to its `SEED_QUERIES` primary query. */
export const SEED_REPORT_DEFS: ReportRecord[] = [
  {
    id: 'r-amr-resistance',
    name: 'AMR Resistance Rate',
    description: 'Resistant/Intermediate/Susceptible counts and %R by antibiotic.',
    category: 'amr',
    designId: 'rt-amr-resistance',
    primaryQueryId: 'q-amr-resistance',
    summaryMetrics: [
      { id: 'antibiotics', label: 'Antibiotics', type: 'count' },
      { id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' },
    ],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-test-volume',
    name: 'Test Volume Over Time',
    description: 'Count of service requests by test and month.',
    category: 'operational',
    designId: 'rt-test-volume',
    primaryQueryId: 'q-test-volume',
    summaryMetrics: [{ id: 'total', label: 'Total tests', type: 'sum', column: 'count' }],
    chart: { type: 'line', x: 'month', y: 'count', series: 'test' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-turnaround-time',
    name: 'Specimen Turnaround Time',
    description: 'Average hours from specimen received to report issued, by test.',
    category: 'operational',
    designId: 'rt-turnaround-time',
    primaryQueryId: 'q-turnaround-time',
    summaryMetrics: [
      { id: 'avgHours', label: 'Avg hours', type: 'avg', column: 'avgHours' },
      { id: 'reports', label: 'Reports', type: 'sum', column: 'count' },
    ],
    // Placeholder — see the "KNOWN GAP" note on q-turnaround-time: the catalog's stat value is a
    // count-weighted average recomputed per-run, but a report record's `chart` is static.
    // Currently inert (the Reports page doesn't render `chart`).
    chart: { type: 'stat', value: '0', label: 'Overall avg hours' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-patient-demographics',
    name: 'Patient Demographics',
    description: 'Patient counts by age band and gender.',
    category: 'quality',
    designId: 'rt-patient-demographics',
    primaryQueryId: 'q-patient-demographics',
    summaryMetrics: [{ id: 'patients', label: 'Patients', type: 'sum', column: 'total' }],
    chart: { type: 'pie', label: 'band', value: 'total' },
    paramOptions: { facility: 'q-facilities' },
    status: 'published',
  },
  {
    id: 'r-amr-facility-summary',
    name: 'AMR Resistance by Facility',
    description: 'Tested vs resistant AST-result counts per facility (wide format for DHIS2 aggregate push).',
    category: 'amr',
    designId: 'rt-amr-facility-summary',
    primaryQueryId: 'q-amr-facility-summary',
    summaryMetrics: [
      { id: 'facilities', label: 'Facilities', type: 'count' },
      { id: 'tested', label: 'Tested', type: 'sum', column: 'tested' },
    ],
    chart: { type: 'bar', x: 'facility', y: 'resistant' },
    paramOptions: null,
    status: 'published',
  },
  {
    id: 'r-amr-glass-ris',
    name: 'AMR GLASS RIS (stratified)',
    description: 'First-isolate R/I/S counts stratified by specimen, pathogen, antibiotic, gender, age group, origin (GLASS submission shape).',
    category: 'regulatory',
    designId: 'rt-amr-glass-ris',
    primaryQueryId: 'q-amr-glass-ris',
    summaryMetrics: [{ id: 'isolates', label: 'Total isolates', type: 'sum', column: 'Total' }],
    // Placeholder — same "KNOWN GAP" as r-turnaround-time: the catalog's stat value
    // (`String(rows.length)`) is recomputed fresh per-run, but a report record's `chart` is static.
    // Currently inert (the Reports page doesn't render `chart`).
    chart: { type: 'stat', value: '0', label: 'strata' },
    paramOptions: null,
    status: 'published',
  },
  {
    id: 'r-amr-first-isolate-summary',
    name: 'AMR First-Isolate Resistance Summary',
    description: 'R/I/S counts and %R by specimen type, pathogen, and antibiotic (first isolate per patient).',
    category: 'amr',
    designId: 'rt-amr-first-isolate-summary',
    primaryQueryId: 'q-amr-first-isolate-summary',
    summaryMetrics: [{ id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' }],
    chart: { type: 'bar', x: 'antibiotic', y: 'percentR' },
    paramOptions: null,
    status: 'published',
  },
  {
    id: 'r-amr-antibiogram',
    name: 'AMR Cumulative Antibiogram',
    description: 'First-isolate %R matrix of pathogen x antibiotic (fixed WHONET panel; cell = %R with N tested).',
    category: 'amr',
    designId: 'rt-amr-antibiogram',
    primaryQueryId: 'q-amr-antibiogram',
    // Matches the catalog's summaryMetrics exactly (see amr-antibiogram.ts).
    summaryMetrics: [{ id: 'pathogens', label: 'Pathogens', type: 'count' }],
    // Placeholder — same "KNOWN GAP" as r-turnaround-time/r-amr-glass-ris: the catalog's stat chart
    // (`{type:'stat', value:String(matrix.length), label:'pathogens'}`) is recomputed fresh
    // per-run, but a report record's `chart` is static (summaryMetrics IS recomputed generically
    // and is what the Reports page actually renders — this field is currently inert).
    chart: { type: 'stat', value: '0', label: 'pathogens' },
    // No facility filter — the catalog declares only `dateRange` (see amr-antibiogram.ts).
    paramOptions: null,
    status: 'published',
  },

  {
    id: 'r-clinical-micro',
    name: 'Clinical Microbiology Report',
    description: 'Culture & sensitivity result for a single request, for the requesting clinician. Collection metadata is excluded by terminology, not by a hardcoded code list.',
    category: 'operational',
    designId: 'rt-clinical-micro',
    primaryQueryId: 'q-clinical-micro-ast',
    summaryMetrics: [{ id: 'agents', label: 'Agents tested', type: 'count' }],
    // No chart: a per-patient clinical result is not a series, and no param options: `request` is
    // typed by the clinician, not picked from a lookup query.
    chart: null,
    paramOptions: null,
    status: 'published',
  },
];

/** Task 2 (mssql-slice2b) reversal of Slice 1's "reports skip on MSSQL": the seed now resolves
 *  EITHER default warehouse connector by name (Postgres or SQL Server — `seedDefaultConnector`
 *  creates exactly one of the two, mutually exclusive on `TARGET_STORE_ADAPTER`) and derives the
 *  SQL dialect from its `type`, so `seedDataDrivenReports` seeds working queries on both engines
 *  instead of only ever finding `DEFAULT_CONNECTOR_NAME` (Postgres) and silently no-op'ing on an
 *  MSSQL install.
 *
 *  Task 6 (mysql-target-s2) extends this the same way for MySQL/MariaDB: now that every
 *  `SEED_QUERIES` entry carries a `sql.mysql` variant (Task 5), the mysql warehouse connector name
 *  (`packages/bootstrap/src/seed.ts`'s `MYSQL_CONNECTOR_NAME`, kept byte-identical here) is
 *  registered too, so a mysql install seeds working queries on all three engines instead of
 *  silently no-op'ing (S1's deliberate "reports skip on mysql" until the mysql SQL variant
 *  existed). */
const WAREHOUSE_NAMES = ['Target Warehouse (Postgres)', 'Target Warehouse (SQL Server)', 'Target Warehouse (MySQL/MariaDB)'];

export interface SeedDataDrivenReportsDeps {
  customQueries: Pick<CustomQueryStore, 'get' | 'create' | 'update'>;
  designs: Pick<ReportDesignStore, 'get' | 'create' | 'update'>;
  reportDefs: Pick<ReportStore, 'get' | 'create' | 'update'>;
  /** Used to resolve the default warehouse connector (by `WAREHOUSE_NAMES`) → its server-generated
   *  id (stamped onto every `SEED_QUERIES` entry before insert) and its `type` (used to pick the
   *  matching `sql.postgres`/`sql.mssql` variant). If no such connector exists yet (e.g.
   *  `TARGET_DATABASE_URL`/`MSSQL_*`/`SECRETS_ENCRYPTION_KEY` unset — see `seedDefaultConnector`),
   *  data-driven seeding is skipped entirely: a query bound to a nonexistent connector could never
   *  run. */
  connectors: Pick<ConnectorStore, 'list'>;
}

export interface SeedDataDrivenReportsResult {
  queriesSeeded: number;
  queriesUpdated: number;
  designsSeeded: number;
  /** Built-in designs refreshed because the shipped definition drifted from the stored one. */
  designsUpdated: number;
  reportDefsSeeded: number;
  reportDefsUpdated: number;
}

const EMPTY_RESULT: SeedDataDrivenReportsResult = { queriesSeeded: 0, queriesUpdated: 0, designsSeeded: 0, designsUpdated: 0, reportDefsSeeded: 0, reportDefsUpdated: 0 };

// Canonical JSON: recursively sorts object keys so equality is insensitive to key order. Needed
// because `params` is a jsonb column — Postgres normalizes (re-sorts) jsonb keys on read, so a
// freshly-seeded row's params compare byte-unequal to the authored order under a plain
// JSON.stringify, which would fire a spurious refresh on every boot.
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = (val as Record<string, unknown>)[k]; return o; }, {})
      : val);
}
// Structural, key-order-insensitive equality for seed-query params vs. stored params.
function paramsEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? []) === canonicalJson(b ?? []);
}

/** The parts of a seeded design the product owns. Deliberately EXCLUDES `createdAt`/`updatedAt`,
 *  which the store stamps — comparing them would report drift on every boot and rewrite the row
 *  forever. */
function designContent(d: ReportDesign): string {
  return canonicalJson({
    name: d.name, paper: d.paper, orientation: d.orientation,
    margins: d.margins ?? null, pageNumbers: d.pageNumbers ?? false,
    parameters: d.parameters ?? [], pages: d.pages ?? [],
  });
}

/** Same idea for a report record. `status` is included: a built-in that ships `published` should be
 *  restored to published if a previous version shipped it as a draft. */
function reportContent(r: ReportRecord): string {
  return canonicalJson({
    name: r.name, description: r.description ?? null, category: r.category ?? null,
    designId: r.designId ?? null, primaryQueryId: r.primaryQueryId ?? null,
    summaryMetrics: r.summaryMetrics ?? [], chart: r.chart ?? null,
    paramOptions: r.paramOptions ?? null, status: r.status ?? null,
  });
}

/** Idempotently inserts `SEED_DESIGNS` and `SEED_REPORT_DEFS` (skipping any id already present),
 *  mirroring `seedReportDesigns`'s `get`-then-`create` pattern. `SEED_QUERIES` gets one step more:
 *  create-if-absent, else REFRESH (managed-overwrite) if the stored SQL/params differ from the
 *  current shipped definition — this heals an upgraded install whose row was seeded before a table
 *  rename (e.g. R3e's `v2_*`→canonical rename left previously-seeded built-in queries reading
 *  now-gone tables). Only `SEED_QUERIES` ids are ever touched (`create`/`update` keyed by the
 *  stable built-in id) — user-authored custom queries have different ids and are never iterated
 *  here, so they're never overwritten. `connectorId` is intentionally left untouched on refresh,
 *  preserving whatever connector the operator has bound. Safe to call repeatedly — a no-op while
 *  the arrays are empty and nothing has drifted. `CustomQueryStore.get` resolves `null` (not
 *  `undefined`) for a miss; both are falsy so the same guard covers all three stores.
 *
 *  Resolves the default warehouse connector by `DEFAULT_CONNECTOR_NAME` first and stamps its id
 *  onto every seed query — `SEED_QUERIES` entries are authored with `connectorId: ''` since the
 *  connector's id is a `randomUUID()` minted at seed time (`seedDefaultConnector`), never a
 *  fixed value a seed file could hardcode. If that connector doesn't exist yet, the whole
 *  data-driven seed is skipped (queries would be bound to a nonexistent connector and could
 *  never run) — mirrors how `seedDefaultConnector` itself skips gracefully when unconfigured. */
export async function seedDataDrivenReports(deps: SeedDataDrivenReportsDeps): Promise<SeedDataDrivenReportsResult> {
  const connectors = await deps.connectors.list();
  const connector = connectors.find((c) => WAREHOUSE_NAMES.includes(c.name));
  if (!connector) {
    console.log(`[seed] no default warehouse connector found (looked for ${WAREHOUSE_NAMES.join(' / ')}) — skipping data-driven report seed`);
    return EMPTY_RESULT;
  }
  const dialect: SqlDialect =
    connector.type === 'microsoft-sql' ? 'mssql'
    : connector.type === 'mysql' ? 'mysql'
    : 'postgres';

  let queriesSeeded = 0;
  let queriesUpdated = 0;
  for (const q of SEED_QUERIES) {
    const wantSql = q.sql[dialect];
    const existing = await deps.customQueries.get(q.id);
    if (!existing) {
      await deps.customQueries.create({ ...q, sql: wantSql, connectorId: connector.id });
      queriesSeeded += 1;
    } else if (existing.sql !== wantSql || !paramsEqual(existing.params, q.params)) {
      // Managed-overwrite: refresh the built-in's SQL/params to the current shipped definition on
      // upgrade (R3e renamed the read-model tables, so a previously-seeded row's SQL is stale).
      // connectorId is intentionally NOT patched — preserve the operator's connector binding.
      await deps.customQueries.update(q.id, { sql: wantSql, params: q.params });
      queriesUpdated += 1;
    }
  }

  let designsSeeded = 0;
  let designsUpdated = 0;
  for (const d of SEED_DESIGNS) {
    const existing = await deps.designs.get(d.id);
    if (!existing) {
      await deps.designs.create(d);
      designsSeeded += 1;
    } else if (designContent(existing) !== designContent(d)) {
      // Managed-overwrite, same contract as SEED_QUERIES above: built-in ids are PRODUCT-OWNED, so
      // a shipped fix reaches an existing install instead of only fresh ones. Before this, these
      // were create-if-absent, which meant a corrected built-in design could never reach anybody
      // who already had the old one.
      // ⚠ An operator who edits a built-in IN PLACE loses those edits here. That is the accepted
      // trade: customise via Duplicate (⋯ menu), which mints a new id this loop never iterates.
      await deps.designs.update(d.id, d);
      designsUpdated += 1;
    }
  }

  let reportDefsSeeded = 0;
  let reportDefsUpdated = 0;
  for (const r of SEED_REPORT_DEFS) {
    const existing = await deps.reportDefs.get(r.id);
    if (!existing) {
      await deps.reportDefs.create(r);
      reportDefsSeeded += 1;
    } else if (reportContent(existing) !== reportContent(r)) {
      await deps.reportDefs.update(r.id, r);
      reportDefsUpdated += 1;
    }
  }

  return { queriesSeeded, queriesUpdated, designsSeeded, designsUpdated, reportDefsSeeded, reportDefsUpdated };
}
