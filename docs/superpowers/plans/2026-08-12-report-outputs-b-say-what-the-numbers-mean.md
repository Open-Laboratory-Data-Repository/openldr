# Root B — the AMR reports say what their numbers mean: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the metric and the notation on the antibiogram and GLASS documents themselves, so `100%` cannot be read as excellent susceptibility when it means 100% resistant.

**Architecture:** Two optional fields on `SimpleDesignSpec` (`metric`, `legend`). `metric` becomes a scope-panel pair, which costs no layout arithmetic because the panel already sizes itself from its pair count. `legend` becomes a text element under the table, costing one term. GLASS additionally projects display names its query already computes, and the submission CSV gets a pinned column list so those names cannot leak into a national submission file.

**Tech Stack:** TypeScript, vitest, pg-mem, Kysely, pdfkit (not exercised here), Fastify, commander.

## Global Constraints

- **Every new length in `simple-design.ts` is px@96.** The `KV_*_PT` constants in that file are POINTS. `simple-design.ts:59-63` records that a previous slice shipped a silently clipped row by mixing the two while every unit-blind test stayed green. Do not introduce a point constant into the new arithmetic.
- **The GLASS code columns `Specimen`, `PathogenCode`, `AntibioticCode` keep their exact current values.** They are read by a national submission file. Add columns; never repurpose one.
- **Keep `%R`.** Do not switch the metric to `%S`, do not add a `%S` column.
- **No hardcoded clinical vocabulary** (AGENTS.md §8). The metric and legend strings are authored *design data* in `SEED_DESIGNS`, editable in the Report Designer. They must not move into renderer code.
- **No `Co-Authored-By` trailers.** Stage named paths only; never `git add -A`.
- Work in the worktree `.worktrees/report-outputs-b` on branch `slice/report-outputs-b`.
- No migration. No new i18n keys.

---

### Task 1: `SimpleDesignSpec` carries a metric line

**Files:**
- Modify: `packages/reporting/src/seed/simple-design.ts:8-24` (the interface), `:38-45` (`scopePairs`)
- Test: `packages/reporting/src/seed/simple-design.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SimpleDesignSpec.metric?: string`. Task 4 and Task 5 set it. When set, the design's `keyvalue` element with id `` `${spec.id}-meta` `` gains a `['Metric', <value>]` pair immediately before `['Generated', '{{date}}']`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('simpleTableDesign', ...)` block in `packages/reporting/src/seed/simple-design.test.ts`:

```ts
  it('adds a Metric scope pair when the spec declares one, immediately before Generated', () => {
    const d = simpleTableDesign({
      id: 'rt-m', name: 'M', queryId: 'q-m',
      columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
      metric: 'Percent resistant (%R).',
    });
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-m-meta')!;
    expect(panel.rows).toEqual([
      ['Reporting period', '{{param.from}} – {{param.to}}'],
      ['Metric', 'Percent resistant (%R).'],
      ['Generated', '{{date}}'],
    ]);
  });

  it('omits the Metric pair entirely when the spec declares none', () => {
    const d = simpleTableDesign({
      id: 'rt-n', name: 'N', queryId: 'q-n',
      columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
    });
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-n-meta')!;
    expect(panel.rows).toEqual([
      ['Reporting period', '{{param.from}} – {{param.to}}'],
      ['Generated', '{{date}}'],
    ]);
  });

  it('grows the panel and pushes the table down by exactly one row when a metric is added', () => {
    const base = { id: 'rt-g', name: 'G', queryId: 'q-g', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' as const }] };
    const without = simpleTableDesign(base);
    const with_ = simpleTableDesign({ ...base, metric: 'X' });
    const t = (d: typeof without) => d.pages[0].elements.find((e) => e.kind === 'table')!.rect.y;
    // 2 pairs -> 1 panel row -> ceil((4*2 + 1*14)/0.75) = ceil(29.33) = 30
    // 3 pairs -> 2 panel rows -> ceil((4*2 + 2*14)/0.75) = 48
    // Difference is 18, NOT ceil(14/0.75) = 19. The two ceilings do not distribute over the
    // subtraction — that is exactly the px@96-vs-points arithmetic this file gets wrong.
    expect(t(with_) - t(without)).toBe(18);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/reporting && npx vitest run src/seed/simple-design.test.ts
```

Expected: FAIL. The first test fails on the missing `Metric` pair; the third fails with `0` because the panel height does not change. TypeScript will also complain that `metric` is not in `SimpleDesignSpec` — that is part of the expected red.

- [ ] **Step 3: Add the field and emit the pair**

In `packages/reporting/src/seed/simple-design.ts`, add to the `SimpleDesignSpec` interface, after `transposeLabel?: string;`:

```ts
  /** One line stating what the table's numbers measure, e.g. "Percent resistant (%R)." Rendered as
   *  the last scope pair before `Generated`, because the metric IS part of the scope a run was
   *  computed under — and because the panel already sizes itself from its pair count, so this costs
   *  no layout arithmetic. Authored design DATA: a lab can edit it in the Report Designer. */
  metric?: string;
```

Then in `scopePairs`, replace the single `pairs.push(...)` line:

```ts
  if (spec.metric) pairs.push(['Metric', spec.metric]);
  pairs.push(['Generated', '{{date}}']);
  return pairs;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/reporting && npx vitest run src/seed/simple-design.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/simple-design.ts packages/reporting/src/seed/simple-design.test.ts
git commit -m "feat(reporting): let a seeded design declare the metric its numbers measure"
```

---

### Task 2: `SimpleDesignSpec` carries a legend under the table

**Files:**
- Modify: `packages/reporting/src/seed/simple-design.ts` (interface, the `tableY`/height arithmetic at `:64-67` and `:80-83`, the element list at `:114-126`)
- Test: `packages/reporting/src/seed/simple-design.test.ts`

**Interfaces:**
- Consumes: `SimpleDesignSpec` from Task 1.
- Produces: `SimpleDesignSpec.legend?: string`. When set, the design gains a `text` element with id `` `${spec.id}-legend` ``, and the table element's `rect.h` shrinks by `LEGEND_H_PX`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/reporting/src/seed/simple-design.test.ts`:

```ts
  it('renders the legend as a text element under the table when declared', () => {
    const d = simpleTableDesign({
      id: 'rt-l', name: 'L', queryId: 'q-l', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
      legend: 'A blank cell means not tested.',
    });
    const legend = d.pages[0].elements.find((e) => e.id === 'rt-l-legend')!;
    expect(legend.kind).toBe('text');
    expect(legend.text).toBe('A blank cell means not tested.');
  });

  it('omits the legend element entirely when none is declared', () => {
    const d = simpleTableDesign({
      id: 'rt-nl', name: 'NL', queryId: 'q-nl', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
    });
    expect(d.pages[0].elements.some((e) => e.id === 'rt-nl-legend')).toBe(false);
  });

  // ⛔ THE UNIT TEST THAT MATTERS. simple-design.ts:59-63 records a slice that shipped a silently
  // clipped row by mixing px@96 with points while every unit-blind test stayed green. A wrong-unit
  // legend height shows up here as a negative gap, on both papers.
  it.each([
    ['A4', 'portrait'] as const,
    ['Letter', 'landscape'] as const,
  ])('keeps table -> legend -> footer rule in order and non-overlapping on %s %s', (paper, orientation) => {
    const d = simpleTableDesign({
      id: 'rt-geo', name: 'Geo', queryId: 'q-geo', columns: [{ key: 'a', label: 'A' }],
      parameters: [{ key: 'dateRange', label: 'Date range', type: 'daterange' }],
      paper, orientation,
      metric: 'Percent resistant (%R).',
      legend: 'A blank cell means not tested.',
    });
    const el = (id: string) => d.pages[0].elements.find((e) => e.id === `rt-geo-${id}`)!;
    const table = el('table'), legend = el('legend'), rule2 = el('rule2');
    expect(table.rect.h).toBeGreaterThan(0);
    expect(legend.rect.y).toBeGreaterThanOrEqual(table.rect.y + table.rect.h);
    expect(rule2.rect.y).toBeGreaterThanOrEqual(legend.rect.y + legend.rect.h);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/reporting && npx vitest run src/seed/simple-design.test.ts
```

Expected: FAIL — `rt-l-legend` is undefined, and the geometry test throws on a missing element.

- [ ] **Step 3: Implement**

In `packages/reporting/src/seed/simple-design.ts`, add to the interface after `metric?: string;`:

```ts
  /** One line explaining the table's notation — blanks, codes, abbreviations. Rendered directly
   *  under the table, next to the cells it explains. Authored design DATA, same as `metric`. */
  legend?: string;
```

Add the constant beside `KV_PAD_Y_PT` (note the unit — px@96, matching every rect in this file, NOT points):

```ts
/** The legend band's height, px@96 like every rect here — deliberately NOT a point constant.
 *  See the KV_*_PT comment below: mixing the two scales is what clipped a row once already. */
const LEGEND_H_PX = 18;
```

In the body of `simpleTableDesign`, after `const footTextY = footRuleY + 12;`, add:

```ts
  // The legend sits in the band immediately above the footer rule, and the table gives up exactly
  // that band. Both terms are px@96.
  const legendH = spec.legend ? LEGEND_H_PX : 0;
  const legendY = footRuleY - legendH;
```

Change the table element's `rect` (currently `h: footRuleY - tableY - 8`) to:

```ts
            rect: { x: 48, y: tableY, w: contentW, h: footRuleY - tableY - 8 - legendH },
```

And insert, immediately before the `${spec.id}-rule2` line element:

```ts
          ...(spec.legend
            ? [{
                id: `${spec.id}-legend`, kind: 'text' as const, name: 'Legend',
                rect: { x: 48, y: legendY, w: contentW, h: LEGEND_H_PX },
                text: spec.legend, style: { fontSize: 8, color: '#475569' },
              }]
            : []),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/reporting && npx vitest run src/seed/simple-design.test.ts
```

Expected: PASS, 8 tests (4 from Task 1, 4 here — the `it.each` counts as 2).

- [ ] **Step 5: Prove nothing else moved**

```bash
cd packages/reporting && npx vitest run src/seed/
```

Expected: PASS. `report-seeds.test.ts` still passes because no seed sets `metric`/`legend` yet, so every existing design is byte-identical.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/simple-design.ts packages/reporting/src/seed/simple-design.test.ts
git commit -m "feat(reporting): let a seeded design carry a legend under its table"
```

---

### Task 3: Pin the GLASS submission CSV's column list

Do this BEFORE adding columns to the query. The pin is what makes Task 6 safe; landing it after would leave a window where a submission file could change.

**Files:**
- Modify: `packages/reporting/src/amr/glass.ts` (add the constant), `apps/server/src/reports-routes.ts:65-70`, `packages/cli/src/report.ts:60-73`
- Test: `packages/reporting/src/amr/glass.test.ts`, `apps/server/src/reports-routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const GLASS_SUBMISSION_COLUMNS: readonly { key: string; label: string }[]` from `@openldr/reporting` (re-exported by `packages/reporting/src/index.ts:10`, which already does `export * from './amr/glass'`). Task 6 relies on this existing.

- [ ] **Step 1: Write the failing test**

In `packages/reporting/src/amr/glass.test.ts`, first extend the existing import on line 2 to
`import { toGlassRis, GLASS_SUBMISSION_COLUMNS, type GlassRisRow } from './glass';`, then append:

```ts
describe('GLASS_SUBMISSION_COLUMNS', () => {
  // ⛔ This list is a WIRE CONTRACT: it is the header and column order of a file submitted to a
  // national programme. The query projects MORE than this (display names for the PDF, added in a
  // later task), and toCsv(result.columns, ...) would otherwise put them in the submission.
  // Changing this array changes what a ministry receives.
  it('is exactly the twelve GLASS RIS columns, in order, key === label', () => {
    expect(GLASS_SUBMISSION_COLUMNS.map((c) => c.key)).toEqual([
      'Iso3Country', 'Year', 'Specimen', 'PathogenCode', 'AntibioticCode',
      'Gender', 'AgeGroup', 'Origin', 'Resistant', 'Intermediate', 'Susceptible', 'Total',
    ]);
    for (const c of GLASS_SUBMISSION_COLUMNS) expect(c.label).toBe(c.key);
  });

  it('matches the GlassRisRow keys, so the type and the wire cannot drift', () => {
    const row: GlassRisRow = {
      Iso3Country: 'ZMB', Year: 2026, Specimen: 'blood', PathogenCode: 'ECOLI',
      AntibioticCode: 'Ciprofloxacin', Gender: 'male', AgeGroup: '25-34', Origin: 'inpatient',
      Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1,
    };
    expect(GLASS_SUBMISSION_COLUMNS.map((c) => c.key)).toEqual(Object.keys(row));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/reporting && npx vitest run src/amr/glass.test.ts
```

Expected: FAIL — `GLASS_SUBMISSION_COLUMNS` is not exported.

- [ ] **Step 3: Add the constant**

Append to `packages/reporting/src/amr/glass.ts`:

```ts
/**
 * The exact ordered columns a GLASS submission file carries — the header and field order a national
 * programme receives.
 *
 * ⛔ Pinned deliberately. Both submission paths used to call `toCsv(result.columns, rows)`, so the
 * file's shape was a side effect of whatever the query happened to project. The query now also
 * projects display-name columns for the human-facing PDF; without this pin they would silently
 * appear in the submission. `key === label` because a machine file's header is its field name.
 */
export const GLASS_SUBMISSION_COLUMNS: readonly { key: string; label: string }[] = [
  'Iso3Country', 'Year', 'Specimen', 'PathogenCode', 'AntibioticCode',
  'Gender', 'AgeGroup', 'Origin', 'Resistant', 'Intermediate', 'Susceptible', 'Total',
].map((k) => ({ key: k, label: k }));
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/reporting && npx vitest run src/amr/glass.test.ts
```

Expected: PASS.

- [ ] **Step 5: Point both submission paths at the pin**

In `apps/server/src/reports-routes.ts`, add `GLASS_SUBMISSION_COLUMNS` to the existing `@openldr/reporting` import, then change the handler body at `:65-70`:

```ts
  app.get('/api/reports/glass/ris.csv', EXPORT, async (req, reply) => {
    try {
      const result = await ctx.reporting.run('r-amr-glass-ris', req.query as Record<string, unknown>);
      reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="glass-ris.csv"');
      // The PINNED submission shape, not result.columns — see GLASS_SUBMISSION_COLUMNS.
      return toCsv(GLASS_SUBMISSION_COLUMNS as { key: string; label: string }[], result.rows);
    } catch (err) { rethrowAsAppError(err); }
  });
```

In `packages/cli/src/report.ts`, add the same import and change the one line inside `runReportGlassExport`:

```ts
    const csv = toCsv(GLASS_SUBMISSION_COLUMNS as { key: string; label: string }[], result.rows);
```

- [ ] **Step 6: Write the route test**

Append to `apps/server/src/reports-routes.test.ts`. The file's helper is `appWith(reporting)` at `:19`, which takes the reporting stub directly — not an options object. The stub must return MORE columns than the submission carries:

```ts
  it('⛔ the GLASS submission CSV emits the pinned columns, never the extra ones', async () => {
    const app = appWith({
      run: async () => ({
          columns: [
            { key: 'Iso3Country', label: 'Iso3Country' }, { key: 'Year', label: 'Year' },
            { key: 'Specimen', label: 'Specimen' }, { key: 'SpecimenName', label: 'Specimen name' },
            { key: 'PathogenCode', label: 'PathogenCode' }, { key: 'Pathogen', label: 'Pathogen' },
            { key: 'AntibioticCode', label: 'AntibioticCode' }, { key: 'Gender', label: 'Gender' },
            { key: 'AgeGroup', label: 'AgeGroup' }, { key: 'Origin', label: 'Origin' },
            { key: 'Resistant', label: 'Resistant' }, { key: 'Intermediate', label: 'Intermediate' },
            { key: 'Susceptible', label: 'Susceptible' }, { key: 'Total', label: 'Total' },
          ],
          rows: [{
            Iso3Country: 'ZMB', Year: 2026, Specimen: 'BLD', SpecimenName: 'Blood',
            PathogenCode: 'ECOLI', Pathogen: 'Escherichia coli', AntibioticCode: 'Ciprofloxacin',
            Gender: 'male', AgeGroup: '25-34', Origin: 'inpatient',
            Resistant: 1, Intermediate: 0, Susceptible: 0, Total: 1,
          }],
      }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/reports/glass/ris.csv' });
    expect(res.statusCode).toBe(200);
    const [header, first] = res.body.trim().split('\n');
    expect(header).toBe('Iso3Country,Year,Specimen,PathogenCode,AntibioticCode,Gender,AgeGroup,Origin,Resistant,Intermediate,Susceptible,Total');
    expect(header).not.toContain('SpecimenName');
    expect(header).not.toContain('Pathogen,');
    expect(first).toBe('ZMB,2026,BLD,ECOLI,Ciprofloxacin,male,25-34,inpatient,1,0,0,1');
  });
```

- [ ] **Step 7: Run the tests**

```bash
cd packages/reporting && npx vitest run src/amr/glass.test.ts
cd ../../apps/server && npx vitest run src/reports-routes.test.ts && npx eslint src/reports-routes.ts
cd ../../packages/cli && npx vitest run src/report.test.ts
```

Expected: all PASS. `apps/server` is the only package with real lint; it enforces the return/await `reply.send` rule, so run it.

- [ ] **Step 8: Commit**

```bash
git add packages/reporting/src/amr/glass.ts packages/reporting/src/amr/glass.test.ts apps/server/src/reports-routes.ts apps/server/src/reports-routes.test.ts packages/cli/src/report.ts
git commit -m "fix(reporting): pin the GLASS submission CSV's columns instead of echoing the query"
```

---

### Task 4: The antibiogram says what its percentages mean

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts:2134` (the `rt-amr-antibiogram` spec)
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: `metric` and `legend` from Tasks 1 and 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to the existing `describe('SEED_DESIGNS — rt-amr-antibiogram', ...)` block in `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
  // ⛔ P0-05. The cells read `0% (1)` and `100% (1)`. Nothing on the page said the percentage was
  // RESISTANT — the meaning lived only in the Reports-page `description`, which is not on the PDF.
  // A reader saw 100% and read excellent susceptibility. It means the opposite.
  it('states on the document that the percentage is resistant, and what the parenthesised number is', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram')!;
    const panel = d.pages[0].elements.find((e) => e.id === 'rt-amr-antibiogram-meta')!;
    const metric = (panel.rows as [string, string][]).find(([k]) => k === 'Metric');
    expect(metric).toBeDefined();
    expect(metric![1]).toMatch(/resistant/i);
    expect(metric![1]).toMatch(/tested/i);
  });

  // ⛔ P0-07. antibiogramCellSql emits '' only when count(*) = 0 for that antibiotic, so a blank
  // has exactly ONE meaning. State that one meaning; do not invent tokens for states the data
  // cannot produce. When P0-06 adds suppression, it extends this line with its own token.
  it('explains a blank cell on the document', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram')!;
    const legend = d.pages[0].elements.find((e) => e.id === 'rt-amr-antibiogram-legend')!;
    expect(legend.kind).toBe('text');
    expect(legend.text).toMatch(/blank/i);
    expect(legend.text).toMatch(/not tested/i);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts -t "rt-amr-antibiogram"
```

Expected: FAIL — `metric` is undefined and the legend element does not exist.

- [ ] **Step 3: Set the two fields**

In `packages/reporting/src/seed/report-seeds.ts`, inside the `simpleTableDesign({ ... })` call whose `id` is `'rt-amr-antibiogram'` (starts at `:2134`), add after `transposeLabel`:

```ts
    // ⛔ P0-05/P0-07. These two strings are the whole point of the report being safe to read. They
    // are design DATA, not renderer code, so a lab can reword them for its own standard.
    metric: 'Percent resistant (%R). The figure in parentheses is the number of isolates tested.',
    legend: 'A blank cell means that antibiotic was not tested against that organism in this period.',
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts
```

Expected: PASS, whole file.

⛔ **This run is the real proof, not the two tests above.** `report-seeds.test.ts:1169-1235` already
runs three geometry guards over every non-clinical seeded design: pair-clipping, clearance of the
page-number band, and — the important one — **"leaves no element overprinting another"**, a pairwise
rect-overlap check across all elements. Adding a legend to a real design puts `LEGEND_H_PX` under
that guard for the first time. If the constant is wrong, it fails here with
`rt-amr-antibiogram: rt-amr-antibiogram-legend overprints rt-amr-antibiogram-rule2`.
Do not "fix" that by shrinking the guard — fix the constant.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "fix(reporting): the antibiogram states that its percentages are resistance"
```

---

### Task 5: GLASS spells out its abbreviations

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (the `rt-amr-glass-ris` spec, around `:2091`)
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: `metric` and `legend` from Tasks 1 and 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts -t "rt-amr-glass-ris document legibility"
```

Expected: FAIL — the legend element does not exist.

- [ ] **Step 3: Set the two fields**

In the `simpleTableDesign({ ... })` call whose `id` is `'rt-amr-glass-ris'`, add after `parameters`:

```ts
    metric: 'Counts of isolates by antimicrobial susceptibility test result.',
    legend: 'R resistant, I intermediate, S susceptible. AMR: antimicrobial resistance. '
      + 'GLASS: Global Antimicrobial Resistance and Use Surveillance System. '
      + '(unknown) means the value was not recorded in the source record.',
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "fix(reporting): GLASS spells out R/I/S, AMR and GLASS on the document"
```

---

### Task 6: GLASS shows pathogen and specimen names beside the codes

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` — the `q-amr-glass-ris` query's three dialect strings (postgres final select at `:1015-1030`, mssql at `:1126-1141`, mysql at `:1224-1239`; the three `specimen_type` derivations at `:963`, `:1060`, `:1164`), and the `rt-amr-glass-ris` design's `columns` at `:2099-2110`
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: `GLASS_SUBMISSION_COLUMNS` from Task 3 — **that pin is what makes this task safe.** Do not start this task if Task 3 is not committed.
- Produces: two new projected columns, `"Pathogen"` and `"SpecimenName"`, in all three dialects.

- [ ] **Step 1: Write the failing test**

Append to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
describe('q-amr-glass-ris display names', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-amr-glass-ris')!;

  // The three dialects are STRING-COMPARED here, never executed. Only postgres runs under pg-mem
  // and only the live warehouse proves mssql/mysql. This asserts the projection exists in each.
  it.each(['postgres', 'mssql', 'mysql'] as const)('projects Pathogen and SpecimenName in %s', (d) => {
    const sql = q().sql[d]!;
    expect(sql).toMatch(/pathogen_name as [`"]Pathogen[`"]/);
    expect(sql).toMatch(/specimen_name as [`"]SpecimenName[`"]/);
    expect(sql).toMatch(/coalesce\(s\.type_text, s\.type_code, '\(unknown\)'\) as specimen_name/);
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
```

`SEED_QUERIES` is exported from `packages/reporting/src/seed/report-seeds.ts:199`, alongside `SEED_DESIGNS` (`:2011`).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts -t "q-amr-glass-ris display names"
```

Expected: FAIL — no `specimen_name` derivation and no `Pathogen` projection in any dialect.

- [ ] **Step 3: Derive the specimen name in all three dialects**

At `:963`, `:1060` and `:1164` — the three `isolate_meta` selects inside `q-amr-glass-ris` — the line reads identically in each:

```sql
    coalesce(s.type_code, '(unknown)') as specimen_type,
```

Add one line directly beneath it, in each of the three:

```sql
    coalesce(s.type_text, s.type_code, '(unknown)') as specimen_name,
```

`specimens.type_text` exists (`packages/db/src/schema/external.ts:194`). The fallback chain means a source with no display text degrades to the code, never to NULL.

Then carry `specimen_name` through the dedup CTE in each dialect, exactly where `pathogen_name` is already carried — the `select distinct on (...)` column list in postgres, and the equivalent `row_number()` CTE column lists in mssql and mysql. Add `specimen_name` immediately after `specimen_type` in each of those lists.

- [ ] **Step 4: Project the names, and group by them**

Postgres — in the final select at `:1015`, add two lines after `specimen_type as "Specimen",`:

```sql
  specimen_name as "SpecimenName",
```

and after `pathogen_code as "PathogenCode",`:

```sql
  pathogen_name as "Pathogen",
```

Then extend the `GROUP BY` at `:1029`. `pathogen_name` is ALREADY there; add `specimen_name`:

```sql
group by specimen_type, specimen_name, pathogen_code, pathogen_name, antibiotic, gender, age_band, origin, iso_year
```

mssql — identical edits in the final select at `:1126` and its `GROUP BY` at `:1140`. Same `"double-quoted"` identifiers.

mysql — identical edits in the final select at `:1224` and its `GROUP BY` at `:1238`, but with **escaped backtick** identifiers, matching that block's existing style:

```sql
  specimen_name as \`SpecimenName\`,
  pathogen_name as \`Pathogen\`,
```

Leave every `order by` clause alone: it already sorts on the code columns, which is the submission's sort order and must not change.

- [ ] **Step 5: Bind the name columns on the design**

In the `rt-amr-glass-ris` `simpleTableDesign` call, replace the first three entries of `columns`:

```ts
    columns: [
      // The NAME columns, not the codes — the codes stay in the query for the submission CSV
      // (GLASS_SUBMISSION_COLUMNS), which no longer reads from this list.
      { key: 'SpecimenName', label: 'Specimen' },
      { key: 'Pathogen', label: 'Pathogen' },
      // antibioticNormalizeSql already emits a display name; only the column KEY says "code".
      { key: 'AntibioticCode', label: 'Antibiotic' },
      { key: 'Gender', label: 'Gender' },
      { key: 'AgeGroup', label: 'Age' },
      { key: 'Origin', label: 'Origin' },
      { key: 'Resistant', label: 'R' },
      { key: 'Intermediate', label: 'I' },
      { key: 'Susceptible', label: 'S' },
      { key: 'Total', label: 'Total' },
    ],
```

- [ ] **Step 6: Correct the comment this task deliberately invalidates**

`report-seeds.ts:2096-2098` currently says the design's `boundColumns` "mirror amr-glass-ris.ts's
`columns` array 1:1 (keys + labels + order)". This task ends that on purpose: the PDF binds display
names while `packages/reporting/src/amr/glass.ts` keeps the submission shape. **No test asserts the
mirror, so nothing goes red — the comment simply becomes false.** Replace it with:

```ts
    // boundColumns NO LONGER mirror amr-glass-ris.ts's `columns` 1:1, deliberately. The PDF binds
    // the DISPLAY-name columns (`SpecimenName`, `Pathogen`); the submission file keeps the codes and
    // takes its shape from GLASS_SUBMISSION_COLUMNS, not from this list. The human document and the
    // machine artifact are separate on purpose.
```

- [ ] **Step 7: Run the tests**

```bash
cd packages/reporting && npx vitest run src/seed/
```

Expected: PASS. If the postgres query is executed anywhere under pg-mem, a missing `specimen_name` in a dedup CTE surfaces here as a column-not-found error — fix the CTE, not the final select.

- [ ] **Step 8: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): GLASS shows pathogen and specimen names, codes stay in the submission"
```

---

### Task 7: Look at the actual PDFs, then run the gate

Every prior task proves design *data*. None of them renders a page. This task is the only one that can catch a legend overlapping a table on a real sheet.

**Files:**
- Create: nothing permanent. Two PDFs under the scratchpad.
- Modify: only what the PDFs reveal.

**Interfaces:**
- Consumes: everything.
- Produces: the merge-readiness evidence.

- [ ] **Step 1: Render both reports to PDF**

No script needed — the CLI already renders (`packages/cli/src/report.ts:36-44`, registered at `program.ts:656-661`). Build the CLI first, then:

```bash
node packages/cli/dist/index.js report run r-amr-antibiogram --format pdf --out /tmp/antibiogram.pdf --param from=2020-01-01 --param to=2030-01-01
```

Then:

```bash
node packages/cli/dist/index.js report run r-amr-glass-ris --format pdf --out /tmp/glass.pdf --param from=2020-01-01 --param to=2030-01-01 --param country=ZMB --param year=2026
```

Each prints `wrote <file> (<n> bytes)`. **Do NOT migrate a persistent DB from this worktree** — point the CLI at an already-migrated dev warehouse.

- [ ] **Step 2: Open both PDFs and check, by eye**

- The Metric line is present in the scope panel and is fully readable, not clipped.
- The legend sits below the table, above the footer rule, on its own line, not overlapping either.
- The GLASS table shows organism and specimen NAMES, not `HAEIN` and `CSF`.
- Neither page's table has lost a row to the legend band.

Record what you saw. If anything is clipped, the cause is almost certainly `LEGEND_H_PX` — it is px@96 and the renderer multiplies rects by 0.75.

- [ ] **Step 3: Confirm the submission file did not change**

Run the CLI export against the same warehouse and read its header:

```bash
node packages/cli/dist/index.js report glass-export --country ZMB --year 2026 --out /tmp/glass-after.csv
```

Then:

```bash
head -1 /tmp/glass-after.csv
```

Expected header, exactly:

```
Iso3Country,Year,Specimen,PathogenCode,AntibioticCode,Gender,AgeGroup,Origin,Resistant,Intermediate,Susceptible,Total
```

If `SpecimenName` or `Pathogen` appears here, Task 3's pin is not wired into the CLI path. Stop and fix that before anything else.

- [ ] **Step 4: Run the full gate**

```bash
pnpm turbo run typecheck test --force --continue
```

**Never pipe turbo through `tail`** — it truncates the failure list. Expect 67/67. A failure is usually a timeout, not a regression: grep the output for `Test timed out` and re-run that package alone before blaming this slice.

- [ ] **Step 5: Commit any fixes and record the evidence**

```bash
git add <only the files you actually changed>
git commit -m "fix(reporting): <what the rendered PDFs revealed>"
```

If the PDFs were clean and the gate was green, there is nothing to commit here — say so rather than inventing a commit.

---

## What this plan does NOT do

State these plainly in the final report; do not let them look finished.

- **P0-06** — the minimum-isolate suppression rule. `0% (1)` and `100% (1)` still print at full visual authority. That needs a programme-approved threshold from config (AGENTS.md §8), and its display token extends Task 4's legend line.
- **SQL ↔ TypeScript parity for GLASS is still unenforced.** `packages/reporting/src/seed/amr-glass-ris-parity.test.ts` is `expect(true).toBe(true)`. `packages/reporting/src/amr/glass.ts`'s `toGlassRis` is deliberately NOT given name columns — the catalog path feeds no PDF — so the two producers now differ by two columns and nothing checks it.
- **mssql and mysql are string-compared, never executed.** Only a live warehouse proves those two dialects run.
- Roots A, C, D and E from the audit decomposition, and the T4 publication gate.

## Note on seeding

Changing `SEED_DESIGNS` means the boot seed calls `upsertPublished` and **re-publishes these two designs to every enrolled lab**, overwriting any in-place operator edit to those built-ins. That is the existing managed-overwrite behaviour and Duplicate is the documented escape hatch. Expected here, not a regression — but say it in the merge report.
