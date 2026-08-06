# Reports — Facility Filter + Letterhead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Facility filter actually filters, facilities display as names everywhere, and every
seeded report carries a letterhead and a scope panel instead of printing as a bare table.

**Architecture:** the report param-options contract widens from `string[]` to `{value,label}[]` so a
facility can be filtered by **code** while displaying its **name**. `q-facilities` and the four
filtering queries repoint from the never-populated `patients.managing_organization` onto
`diagnostic_reports.performer`, resolved through `facility_map`. Two renderer gaps are closed
(`{{param.*}}` resolving against design defaults; `drawKeyValue` never interpolating) so a
token-driven metadata panel can exist at all. `simpleTableDesign` then grows a letterhead, that
panel, and a footer, which lands on all eight aggregate reports at once.

**Tech Stack:** TypeScript, Kysely, Vitest, React (Studio), pdfkit via `@openldr/report-designer`,
Postgres + MSSQL + MySQL dialect variants maintained in parallel.

**Spec:** `docs/superpowers/specs/2026-08-06-report-facility-and-letterhead-design.md`

## Global Constraints

- **All three dialect variants must stay in step.** `packages/reporting/src/seed/report-seeds.ts`
  carries one SQL string per dialect (`postgres`, `mssql`, `mysql`). `report-seeds.test.ts` iterates
  `Object.entries(q().sql)` and fails on divergence.
- ⛔ **The facility filter VALUE is the CODE, never the label.** Five DISA codes share the display
  `"Aga Khan"`; only `BAMAA` is in this warehouse, so label uniqueness is an accident of the dataset.
  Grouping and filtering key on `performer`; only display resolves.
- ⛔ **Layout arithmetic is in POINTS.** `drawElement` calls `toPt(el.rect)` (×0.75) but
  `KV_PAD_Y`/`KV_INLINE_H`/`ROW_H` are already points. Mixing them shipped a silently clipped row in
  the previous slice with every test green. A4 = **595.28 × 841.89 pt** = 794 × 1122.5 px@96.
- ⛔ **`drawPageFooter` draws the page number at `hPt - 24` = 817.89pt (≈1090px).** Nothing may
  occupy that band.
- **Bound keyvalue values are NEVER interpolated** — only unbound ones. Interpolating query data
  would let a result cell containing `{{lab.name}}` forge letterhead into a report body.
- **Identity seeding is create-if-absent**, matching the `FEATURE_FLAGS` loop. An operator's own
  `lab.name`/`lab.logo` must survive a re-seed.
- ⛔ Never pipe turbo through `tail` — you get tail's exit code. Redirect to a log, echo `$?`.
- Gate: `pnpm turbo run typecheck test --force --concurrency=4` must be 67/67.
- ⛔ Never `git add -A` — this directory is shared with concurrent sessions. Exact paths only.
- ⛔ Never add a `Co-Authored-By` trailer.
- **Branch:** `slice/report-facility-and-letterhead`, already checked out, already holds the spec
  commit `5127ede7`. Do not push.

---

### Task 1: Param options carry a value and a label

**Files:**
- Modify: `packages/bootstrap/src/index.ts:145` (the `ReportingApi.options` signature) and `:239-248`
  (`optionsDataDriven`)
- Modify: `apps/studio/src/api.ts:129-134` (`fetchReportOptions`)
- Modify: `apps/studio/src/reports/ReportParametersBar.tsx:12,48,57`
- Modify: `apps/studio/src/reports/ReportSchedulesDrawer.tsx:18` (passes `options` straight through
  to the bar at `:132`)
- Test: `packages/bootstrap/src/index.test.ts` (or the existing bootstrap reporting test file — find
  the one covering `optionsDataDriven`), `apps/studio/src/reports/ReportParametersBar.test.tsx:20`,
  `apps/studio/src/reports/ReportSchedulesDrawer.test.tsx:26`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: an exported type used by Tasks 2 and 5's expectations:

  ```ts
  /** One choice in a report parameter's select. `value` is what the query filters on; `label` is
   *  what the operator reads. They differ deliberately — see the "Aga Khan" constraint. */
  export interface ReportParamOption { value: string; label: string; }
  ```

  `ReportingApi.options` becomes `Promise<Record<string, ReportParamOption[]>>`.

**Why the contract widens.** `optionsDataDriven` reads **column 0 only** and the Studio renders
`<SelectItem key={o} value={o}>{o}</SelectItem>`, so the label *is* the filter value. Task 2 needs
them to differ.

**Backwards compatibility is required, not optional:** a query returning ONE column must still work,
yielding `label === value`. This is what keeps the change additive.

- [ ] **Step 1: Write the failing tests**

In the bootstrap test file that covers `optionsDataDriven`, add:

```ts
it('maps column 0 to the value and column 1 to the label', async () => {
  // The facility filter must carry the CODE while showing the NAME: five DISA codes share the
  // display "Aga Khan", so a name-valued select would silently merge five laboratories.
  const opts = await api.options('r-with-facility');
  expect(opts.facility).toEqual([
    { value: 'BAGAE', label: 'National Public Health Laboratory' },
    { value: 'BAMAA', label: 'Aga Khan' },
  ]);
});

it('falls back to label = value when the options query returns ONE column', async () => {
  // Keeps the widening additive — a single-column options query is still valid.
  const opts = await api.options('r-with-single-column-options');
  expect(opts.facility).toEqual([{ value: 'Only', label: 'Only' }]);
});
```

In `apps/studio/src/reports/ReportParametersBar.test.tsx`, change the existing
`options={{ facility: ['F1'] }}` fixture to the pair shape and assert the split:

```ts
it('shows the label and submits the value', async () => {
  const onChange = vi.fn();
  render(
    <ReportParametersBar
      report={report} params={{}}
      options={{ facility: [{ value: 'BAMAA', label: 'Aga Khan' }] }}
      onChange={onChange} onRun={() => {}} running={false} canRun
    />,
  );
  await userEvent.click(screen.getByRole('combobox'));
  // The operator reads the name...
  await userEvent.click(await screen.findByText('Aga Khan'));
  // ...and the CODE is what gets filtered on.
  expect(onChange).toHaveBeenCalledWith({ facility: 'BAMAA' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/bootstrap test 2>&1 | grep -E "FAIL|✓|×" | head -20
pnpm --filter @openldr/studio test -- ReportParametersBar 2>&1 | grep -E "FAIL|✓|×" | head -20
```

Expected: FAIL. The bootstrap tests fail on shape (`['BAGAE']` vs objects); the Studio test fails
because `opts.map((o) => ...)` over objects renders `[object Object]`.

- [ ] **Step 3: Widen the contract**

In `packages/bootstrap/src/index.ts`, export the type and rewrite `optionsDataDriven`:

```ts
async function optionsDataDriven(id: string): Promise<Record<string, ReportParamOption[]>> {
  const def = (await deps.reportDefs.get(id))!;
  const out: Record<string, ReportParamOption[]> = {};
  for (const [paramKey, queryId] of Object.entries(def.paramOptions ?? {})) {
    const { columns, rows } = await deps.runStoredQuery(queryId, {});
    const valueCol = columns[0]?.key;
    // Column 1 is the human label when the query supplies one. A ONE-COLUMN options query still
    // works, with label = value — that is what keeps this widening additive.
    const labelCol = columns[1]?.key ?? valueCol;
    if (!valueCol) { out[paramKey] = []; continue; }
    out[paramKey] = rows
      .map((r) => ({ value: String(r[valueCol]), label: String(r[labelCol!] ?? r[valueCol]) }))
      .filter((o) => o.value !== 'null' && o.value !== '');
  }
  return out;
}
```

In `apps/studio/src/api.ts`, change both the return type and the cast to
`Record<string, ReportParamOption[]>`.

In `ReportParametersBar.tsx` change the prop type to `Record<string, ReportParamOption[]>` and the
render to:

```tsx
{opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
```

In `ReportSchedulesDrawer.tsx` change the prop type identically — it only forwards the value.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap test 2>&1 | tail -5
pnpm --filter @openldr/studio test -- ReportParametersBar ReportSchedulesDrawer 2>&1 | tail -5
pnpm --filter @openldr/studio typecheck 2>&1 | tail -3
```

Expected: PASS on all three. The typecheck matters most — it is what proves no other consumer of
`Record<string, string[]>` was missed.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts apps/studio/src/api.ts apps/studio/src/reports/ReportParametersBar.tsx apps/studio/src/reports/ReportSchedulesDrawer.tsx
git commit -m "feat(reports): param options carry a value and a label"
```

(Add the exact test files you touched to that `git add` line.)

---

### Task 2: The picker and the facility column show names

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` — `q-facilities` (~line 205-225) and
  `q-amr-facility-summary` (~line 712-830), all three dialects each
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: Task 1's two-column options contract.
- Produces: `q-facilities` returns columns `value`, `label` in that order — Task 1's
  `optionsDataDriven` depends on the ORDER, not the names.

- [ ] **Step 1: Write the failing tests**

```ts
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
        .toContain('coalesce(fm.name, dr.performer_display, dr.performer) as label');
    }
  });

  it('resolves through facility_map with the same NULL source_system guard as the clinical header', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.source_system\s*=\s*coalesce\(dr\.source_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/fm\.source_code\s*=\s*dr\.performer\b/);
    }
  });
});

describe('SEED_QUERIES — q-amr-facility-summary labels by name but groups by code', () => {
  const q = () => SEED_QUERIES.find((x) => x.id === 'q-amr-facility-summary')!;

  it('projects a resolved name', () => {
    // Since the feed split the facility into code + display, this rendered the raw code "NICD".
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} does not resolve the facility label`)
        .toContain('coalesce(fm.name, f.performer_display, f.performer) as facility');
    }
  });

  it('⛔ still GROUPS on the code, never on the resolved label', () => {
    // Grouping by label merges the five "Aga Khan" laboratories into one row the day the other
    // four codes arrive. The code is the identity; the label is presentation.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect} groups by the resolved label and will merge facilities`)
        .not.toMatch(/group by coalesce\(fm\.name/);
      expect(sql, `${dialect} lost the code grouping`).toMatch(/group by[\s\S]*f\.performer/);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "facility picker" 2>&1 | tail -15
```

Expected: FAIL — `postgres still reads the patient organization`.

- [ ] **Step 3: Rewrite both queries**

`q-facilities`, all three dialects (identical text — no dialect-specific operator here):

```sql
select distinct dr.performer as value,
  coalesce(fm.name, dr.performer_display, dr.performer) as label
from diagnostic_reports dr
left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
where dr.performer is not null and dr.performer <> ''
order by 2
```

`q-amr-facility-summary`: keep the whole query as-is and change only the projected label. The
`facility_of` CTE gains `performer_display`, and a `facility_map` join is added:

```sql
with facility_of as (
  select specimen_id, min(performer) as performer, min(performer_display) as performer_display,
    min(source_system) as source_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
)
select
  coalesce(fm.name, f.performer_display, f.performer) as facility,
  ...unchanged aggregate columns...
from lab_results o
left join patients p on o.patient_id = p.id
left join specimens s on o.specimen_id = s.id
left join facility_of f on f.specimen_id = o.specimen_id
left join facility_map fm on fm.source_system = coalesce(f.source_system, '') and fm.source_code = f.performer
where ...unchanged...
group by f.performer, fm.name, f.performer_display, p.managing_organization
order by 1
```

⛔ `group by` lists the CODE plus the label sources — grouping stays keyed on `f.performer`, and the
label columns ride along because SQL requires every projected non-aggregate in the GROUP BY. Do NOT
collapse this to `group by 1`: that groups by the resolved label and merges facilities.

⚠ The existing `coalesce(f.performer, p.managing_organization)` fallback to the patient organization
is preserved inside the label expression's final fallback and in the WHERE guard — the seed sender
does populate `managing_organization`, and dropping it would empty the report for that sender.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts 2>&1 | tail -5
```

Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): resolve facility names in the picker and the AMR facility report"
```

---

### Task 3: The facility filter actually filters

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` — `q-amr-resistance` (~line 252-350),
  `q-test-volume` (~line 356-430), `q-turnaround-time` (~line 493-560),
  `q-patient-demographics` (~line 627-710); all three dialects each
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: Task 2's picker, which now supplies facility **codes** as values.
- Produces: nothing consumed by later tasks.

**The four routes.** Each query has a different row grain, so each needs its own predicate. The
columns these use are measured present and 100% populated: `diagnostic_reports.patient_id` 7520/7520,
`lab_requests.patient_id` 7520/7520, `lab_results.request_id` and `.specimen_id` 22915/22915.

| Query | Replace | With |
|---|---|---|
| `q-amr-resistance` | `o.patient_id in (select p.id from patients p where p.managing_organization = {{param.facility}})` | `o.specimen_id in (select specimen_id from diagnostic_reports where performer = {{param.facility}})` |
| `q-turnaround-time` | same patient-org subquery | `dr.performer = {{param.facility}}` — it already reads `diagnostic_reports dr` |
| `q-patient-demographics` | same patient-org subquery | `p.id in (select patient_id from diagnostic_reports where performer = {{param.facility}})` |
| `q-test-volume` | *(no predicate today)* | `sr.id in (select l.request_id from lab_results l join diagnostic_reports d on d.specimen_id = l.specimen_id where d.performer = {{param.facility}})` |

⛔ `q-test-volume` routes through the request's own specimens, NOT through `sr.patient_id`. A patient
can be served by more than one laboratory, so a patient-keyed predicate would attribute every one of
that patient's requests to whichever lab tested any of them.

Every predicate keeps its existing `{{param.facility}} = '' or ...` escape so "All" still means all.

- [ ] **Step 1: Write the failing tests**

```ts
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "filters on the report performer" 2>&1 | tail -15
```

Expected: FAIL — the first test reports `q-amr-resistance/postgres still filters on
managing_organization`.

- [ ] **Step 3: Apply the four predicates**

Apply the table above to all three dialect strings of each query. The predicates contain no
dialect-specific syntax, so the same text goes into all three.

For `q-test-volume`, add the predicate to the WHERE clause alongside the existing date filter, and
delete the comment that explains why it deliberately does not reference `{{param.facility}}` —
replace it with:

```ts
    //  - facility: filters through the request's own SPECIMENS
    //    (lab_results -> diagnostic_reports.performer), NOT through sr.patient_id. A patient may be
    //    served by more than one laboratory, and a patient-keyed predicate would attribute all of
    //    that patient's requests to whichever lab tested any one of them. Previously this query
    //    declared the control and ignored it, so choosing a facility silently changed nothing.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts 2>&1 | tail -5
```

Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "fix(reporting): the facility filter filters on the report performer"
```

---

### Task 4: The renderer can show run parameters in a panel

**Files:**
- Modify: `packages/report-designer/src/render/index.ts:12-23` (`RenderOptions`) and the
  `paramMap` call inside `renderReportDesignPdf`
- Modify: `packages/report-designer/src/render/draw.ts:168-180` (`paramMap`), `:343`
  (`drawKeyValue` signature) and `:587-588` (its call site in `drawElement`)
- Modify: `packages/bootstrap/src/index.ts:229-237` (`renderDataDriven`)
- Test: `packages/report-designer/src/render/draw.test.ts`,
  `packages/report-designer/src/render/index.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two things Task 5 depends on absolutely:
  - `RenderOptions` gains `values?: Record<string, unknown>` — the RUN's parameter values.
  - `paramMap(design, now, identity, values?)` prefers `values` over `design.parameters[].value`, and
    emits `'—'` for a declared-but-unset parameter.
  - `drawKeyValue` interpolates **unbound** pair values and the panel title.

**Two defects, both of which would let Task 5 ship a header that looks right and is wrong.**

1. `renderDataDriven` computes `values` from the run, hands them to `resolveDesignTables`, then calls
   `renderReportDesignPdf(design, resolved, { identity })` — passing the **unmodified design**.
   `paramMap` builds tokens from `design.parameters[].value`, i.e. the authored defaults. So
   `{{param.from}}` renders the default no matter what the operator picked.
2. `drawElement` holds the token map but only `text`, `datetime` and image `src` use it
   (`draw.ts:433`, `:562`, `:573`). `drawKeyValue` is called without tokens, so an unbound pair
   prints `{{lab.name}}` as those nine literal characters.

- [ ] **Step 1: Write the failing tests**

In `draw.test.ts`:

```ts
describe('paramMap prefers the RUN values over the design defaults', () => {
  const design = {
    id: 'd', name: 'D', paper: 'A4', orientation: 'portrait',
    parameters: [
      { key: 'dateRange', label: 'Range', type: 'daterange', required: true, value: { from: '2000-01-01', to: '2000-12-31' } },
      { key: 'facility', label: 'Facility', type: 'select', required: false, value: '' },
    ],
    pages: [{ id: 'p', elements: [] }],
  } as unknown as ReportDesign;

  it('reads a daterange from the FLAT from/to the runtime actually supplies', () => {
    // ⛔ The run values are flat — the Studio's picker writes top-level from/to and the seeded
    // queries declare from/to as their own params, so values['dateRange'] is always undefined.
    // Keying on the parameter's own name renders every date range as two em dashes.
    const m = paramMap(design, NOW, undefined, { from: '2026-01-01', to: '2026-03-31', facility: 'BAMAA' });
    expect(m.get('from')).toBe('2026-01-01');
    expect(m.get('to')).toBe('2026-03-31');
    expect(m.get('facility')).toBe('BAMAA');
  });

  it('renders a declared-but-unset parameter as an em dash, not blank', () => {
    // A blank beside a label reads as a failure; "—" reads as "not filtered".
    const m = paramMap(design, NOW, undefined, { from: '2026-01-01', to: '2026-03-31' });
    expect(m.get('facility')).toBe('—');
  });

  it('still falls back to the design defaults when no run values are supplied', () => {
    const m = paramMap(design, NOW);
    expect(m.get('from')).toBe('2000-01-01');
  });
});

describe('drawKeyValue interpolates authored pairs but never query data', () => {
  it('resolves tokens in an UNBOUND pair value', () => {
    const el = { id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 400, h: 60 },
      rows: [['Reporting period', '{{param.from}} – {{param.to}}']] } as unknown as DesignElement;
    const pairs = keyValuePairs(el, undefined);
    expect(interpolatedPairValues(el, undefined, new Map([['from', '2026-01-01'], ['to', '2026-03-31']])))
      .toEqual(['2026-01-01 – 2026-03-31']);
    expect(pairs[0].value).toBe('{{param.from}} – {{param.to}}'); // raw at the pair layer
  });

  it('⛔ does NOT interpolate a BOUND value — that would let query data forge letterhead', () => {
    const el = { id: 'k', kind: 'keyvalue', name: 'K', rect: { x: 0, y: 0, w: 400, h: 60 },
      dataSource: { kind: 'custom-query', queryId: 'q' },
      boundColumns: [{ key: 'note', label: 'Note' }] } as unknown as DesignElement;
    const resolved = { columns: [{ key: 'note', label: 'Note' }], rows: [{ note: '{{lab.name}}' }] };
    expect(interpolatedPairValues(el, resolved, new Map([['lab:name', 'Ministry of Health']])))
      .toEqual(['{{lab.name}}']);
  });
});
```

⚠ `interpolatedPairValues` does not exist yet. Extract it in Step 3 as the pure seam the drawer uses,
so this behaviour is testable without a PDF document — the same pattern `pairRects` and
`columnWidths` already follow in this file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/report-designer test -- draw.test.ts 2>&1 | tail -15
```

Expected: FAIL — `paramMap` takes three arguments, and `interpolatedPairValues` is not exported.

- [ ] **Step 3: Implement**

In `draw.ts`, widen `paramMap`:

```ts
export function paramMap(
  design: ReportDesign, now: Date, identity?: Record<string, string>, values?: Record<string, unknown>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of design.parameters) {
    // ⛔ A daterange's RUN values are FLAT `from`/`to`, NOT nested under the parameter's own key.
    // The Studio's picker writes top-level `from`/`to` (ReportParametersBar.tsx:38) and the seeded
    // queries declare `from`/`to` as their own text params, so `values['dateRange']` is ALWAYS
    // undefined. Keying on p.key here renders every date range as two em dashes.
    if (p.type === 'daterange') {
      const dflt = (p.value ?? {}) as { from?: string; to?: string };
      m.set('from', (values?.from as string) || dflt.from || UNSET);
      m.set('to', (values?.to as string) || dflt.to || UNSET);
      continue;
    }
    // Every other parameter is keyed by its own name in both places. The RUN's value wins over the
    // authored default — without that a header describes the design rather than the run it is
    // printed from, which is correct-looking and wrong.
    const run = values?.[p.key];
    const v = run !== undefined && run !== '' ? run : p.value;
    // Declared but unset renders an em dash, not ''. A blank beside a label reads as a failed
    // render, where "—" reads as "not filtered".
    m.set(p.key, typeof v === 'string' && v !== '' ? v : UNSET);
  }
  m.set('date', now.toLocaleDateString());
  for (const [k, v] of Object.entries(identity ?? {})) m.set(LAB_TOKEN_PREFIX + k, v);
  return m;
}
```

with `const UNSET = '—';` beside the other module constants.

Add the pure seam and use it from the drawer:

```ts
/** Pair values as DRAWN: authored (unbound) values resolve `{{...}}` tokens exactly as a text
 *  element does; BOUND values never do.
 *  ⛔ The asymmetry is a security property, not an oversight — interpolating query data would let a
 *  result cell containing `{{lab.name}}` forge letterhead into the body of a report. */
export function interpolatedPairValues(
  el: DesignElement, resolved: ResolvedTable | undefined, tokens: Map<string, string>,
): string[] {
  const bound = Boolean(el.kind === 'keyvalue' && el.dataSource);
  return keyValuePairs(el, resolved).map((p) => (bound ? p.value : interpolate(p.value, tokens)));
}
```

Change `drawKeyValue(doc, el, r, resolved)` to `drawKeyValue(doc, el, r, resolved, tokens)`, take the
values from `interpolatedPairValues(el, resolved, tokens)` instead of `p.value`, and interpolate the
title: `const title = interpolate(el.text ?? '', tokens).trim();`. Update the call site at
`draw.ts:588` to pass `tokens`.

In `render/index.ts`, add to `RenderOptions`:

```ts
  /** The RUN's parameter values. Supplied by the caller because the renderer is handed the stored
   *  design, whose `parameters[].value` are the AUTHORED DEFAULTS — a header built from those
   *  describes the design rather than the run it is printed from. */
  values?: Record<string, unknown>;
```

and pass `opts.values` as `paramMap`'s fourth argument.

In `packages/bootstrap/src/index.ts`, `renderDataDriven`:

```ts
    return deps.renderReportDesignPdf(design, resolved, { identity, values });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/report-designer test 2>&1 | tail -5
pnpm --filter @openldr/bootstrap test 2>&1 | tail -5
pnpm --filter @openldr/report-designer typecheck 2>&1 | tail -3
```

Expected: PASS on all three.

- [ ] **Step 5: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/index.ts packages/bootstrap/src/index.ts packages/report-designer/src/render/draw.test.ts
git commit -m "fix(report-designer): render run parameters, and interpolate authored keyvalue pairs"
```

---

### Task 5: A letterhead and a scope panel on every report

**Files:**
- Modify: `packages/reporting/src/seed/simple-design.ts` (the whole `simpleTableDesign` body)
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: Task 4's `values` threading and unbound-pair interpolation. **Without both, this panel
  renders blanks or literal `{{param.from}}` text.**
- Produces: nothing consumed by later tasks.

**Geometry, all in the units each constant actually uses.** A4 = 595.28 × 841.89 **pt** = 794 ×
1122.5 px@96. `drawPageFooter` writes the page number at `hPt - 24` = **817.89pt ≈ 1090px**, so no
element may extend past ~1085px.

The metadata panel's height is **computed from its pair count**, not fixed — this makes the
clipped-row trap from the previous slice structurally impossible:

```ts
// Pairs flow across then down at KV_INLINE_H, from the box top + KV_PAD_Y. Those constants are
// POINTS and `drawElement` converts the rect with toPt (×0.75), so the height is computed in points
// and converted back. Sizing the box to its content is what makes an over-full panel impossible —
// the previous slice shipped a silently clipped row by fixing the height and counting in px@96.
const KV_INLINE_H_PT = 14, KV_PAD_Y_PT = 4;
const rows = Math.ceil(pairs.length / 2);
const panelHpx = Math.ceil((KV_PAD_Y_PT * 2 + rows * KV_INLINE_H_PT) / 0.75);
```

Element layout (px@96), mirroring `rt-clinical-micro`:

| id suffix | kind | rect |
|---|---|---|
| `-logo` | image | `{ x: 48, y: 28, w: 54, h: 54 }`, `src: '{{lab.logo}}'` |
| `-labname` | text | `{ x: 112, y: 30, w: 430, h: 18 }`, `{{lab.name}}`, 13pt bold |
| `-labaddr` | text | `{ x: 112, y: 48, w: 430, h: 22 }`, `{{lab.address}}`, 7.5pt |
| `-labcontact` | text | `{ x: 112, y: 71, w: 430, h: 13 }`, `{{lab.contact}}`, 7.5pt |
| `-rule1` | line | `{ x: 48, y: 92, w: 700, h: 0 }` |
| `-title` | text | `{ x: 48, y: 102, w: 600, h: 28 }`, `spec.name`, 18pt bold |
| `-meta` | keyvalue | `{ x: 48, y: 138, w: 700, h: panelHpx }`, `layout: 'inline'`, `panelColumns: 2` |
| `-table` | table | `{ x: 48, y: 138 + panelHpx + 12, w: 700, h: 1000 - (138 + panelHpx + 12) - 8 }` |
| `-rule2` | line | `{ x: 48, y: 1000, w: 700, h: 0 }` |
| `-foot` | text | `{ x: 48, y: 1012, w: 500, h: 16 }`, 7pt, `#94a3b8` |

The `-date` element is REMOVED — `Generated` moves into the panel.

**Panel pairs, generated from the spec's own declared parameters** so each report describes its own
scope with no per-report authoring:

| declared parameter | pair |
|---|---|
| `type: 'daterange'` | `['Reporting period', '{{param.from}} – {{param.to}}']` |
| `key: 'facility'` | `['Facility', '{{param.facility}}']` |
| any other `type: 'text'`/`'select'` | `[p.label, '{{param.<key>}}']` |
| *(always, last)* | `['Generated', '{{date}}']` |

- [ ] **Step 1: Write the failing tests**

```ts
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
    // drawPageFooter writes at hPt - 24 = 817.89pt ≈ 1090px on A4.
    for (const d of simple()) {
      for (const e of d.pages[0].elements) {
        expect(e.rect.y + e.rect.h, `${d.id}/${e.id} collides with the page number`)
          .toBeLessThanOrEqual(1085);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts -t "letterhead and a scope panel" 2>&1 | tail -15
```

Expected: FAIL — `rt-amr-resistance has no logo` (`el(d,'-logo')` is undefined).

- [ ] **Step 3: Rewrite `simpleTableDesign`**

Build the pair list from `spec.parameters` per the table above, compute `panelHpx` with the formula
above, and emit the elements in the layout table above. Keep `pageNumbers: true` and the
deterministic `${spec.id}-*` element ids (re-seeding must not drift).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/reporting test -- report-seeds.test.ts 2>&1 | tail -5
```

Expected: PASS, whole file — including the pre-existing `rt-clinical-micro` tests, which must be
untouched by this change.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/simple-design.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): letterhead and scope panel on every seeded report"
```

---

### Task 6: Seed the OpenLDR mark and a default laboratory name

**Files:**
- Create: `packages/bootstrap/src/lab-identity-defaults.ts`
- Modify: `packages/bootstrap/src/seed.ts:363-372` (beside the `FEATURE_FLAGS` loop)
- Test: `packages/bootstrap/src/seed.test.ts:505-515` (beside the existing `settingsSeeded` tests)

**Interfaces:**
- Consumes: nothing from earlier tasks (Task 5 references `{{lab.logo}}`/`{{lab.name}}` by token, so
  the two tasks are independent).
- Produces: nothing consumed by later tasks.

**The data URI is already generated** — a 256×256 PNG of `apps/studio/public/favicon.svg`, 5,882
bytes, 7,866 characters, visually confirmed to render the mark intact. Read it from
`.superpowers/sdd/reportid/logo-data-uri.txt` and paste it as the constant's value. Do NOT invent a
different image.

If that scratch file is missing (it is git-ignored and `git clean -fdx` destroys it), regenerate it
from `e2e/`, which is the only package with Playwright — note the import is `@playwright/test`, not
bare `playwright`:

```js
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('../apps/studio/public/favicon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0;background:transparent"><div style="width:256px;height:256px">${svg.replace('<svg ', '<svg width="256" height="256" ')}</div></body>`);
const png = await page.screenshot({ omitBackground: true, type: 'png' }); // transparent, not a white box
await browser.close();
writeFileSync('../.superpowers/sdd/reportid/logo-data-uri.txt', `data:image/png;base64,${png.toString('base64')}`);
```

⚠ pdfkit renders neither SVG nor remote URLs — an `https://` logo silently placeholders, which is
why `lab.logo` is validated as a data URI at write time (`packages/bootstrap/src/lab-identity.ts`).

- [ ] **Step 1: Write the failing test**

In `packages/bootstrap/src/seed.test.ts`:

```ts
it('seeds the OpenLDR mark and a default laboratory name', async () => {
  // The letterhead rendered blank on every report: app_settings held no lab.* key at all.
  const first = await seed(app);
  expect(first.settingsSeeded).toBe(FEATURE_FLAGS.length + LAB_IDENTITY_DEFAULTS.length);
  expect(await app.appSettings.get('lab.logo')).toMatch(/^data:image\/png;base64,/);
  expect(await app.appSettings.get('lab.name')).toBe('OpenLDR');
});

it('never reverts an identity the operator has set', async () => {
  // Create-if-absent, exactly like the feature-flag defaults. An operator who has configured their
  // own letterhead must not have it silently restored to ours on the next boot.
  await seed(app);
  await app.appSettings.set('lab.name', 'Muhimbili National Hospital', 'operator');
  const second = await seed(app);
  expect(second.settingsSeeded).toBe(0);
  expect(await app.appSettings.get('lab.name')).toBe('Muhimbili National Hospital');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/bootstrap test -- seed.test.ts 2>&1 | tail -15
```

Expected: FAIL — `LAB_IDENTITY_DEFAULTS` is not defined.

- [ ] **Step 3: Add the constant and the seeding loop**

Create `packages/bootstrap/src/lab-identity-defaults.ts`:

```ts
/** Letterhead defaults, so a fresh install prints a branded report instead of a blank band and a
 *  dashed placeholder box.
 *
 *  ⚠ `lab.logo` MUST be a data URI: pdfkit renders neither SVG nor remote URLs, so an `https://`
 *  logo silently placeholders in the PDF while looking fine on the Studio canvas. That is why
 *  `lab-identity.ts` validates it at WRITE time. This is `apps/studio/public/favicon.svg` — the
 *  OpenLDR mark — rasterised to a 256×256 PNG.
 *
 *  ⛔ `lab.name` is the product name, NOT an invented ministry. The letterhead is the ISSUING
 *  organisation on a clinical document; shipping a plausible real-world issuer as a placeholder is
 *  a forgery risk, not a convenience. The operator sets theirs in Settings ▸ Laboratory. */
export const LAB_IDENTITY_DEFAULTS: { id: string; value: string }[] = [
  { id: 'lab.name', value: 'OpenLDR' },
  { id: 'lab.logo', value: 'data:image/png;base64,...' }, // paste from the file named above
];
```

In `seed.ts`, extend the existing loop (same create-if-absent idiom, same counter):

```ts
  for (const d of LAB_IDENTITY_DEFAULTS) {
    const existing = await app.appSettings.get(d.id);
    if (!existing) {
      await app.appSettings.set(d.id, d.value, 'system');
      settingsSeeded++;
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @openldr/bootstrap test -- seed.test.ts 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/lab-identity-defaults.ts packages/bootstrap/src/seed.ts packages/bootstrap/src/seed.test.ts
git commit -m "feat(bootstrap): seed the OpenLDR mark and a default laboratory name"
```

---

### Task 7: Gate, render every report, look at them, merge

**Files:** none modified — verification and integration. **The CONTROLLER executes this task.**

⛔ **A passing test proves the code is merged, not that the running instance does this.** The
previous slice's clipped row was green in every test and obvious in the PDF.

- [ ] **Step 1: Re-seed and publish**

```bash
npx tsx packages/cli/src/index.ts facilities publish --apply
npx tsx packages/cli/src/index.ts db seed
```

⚠ The CLI does not build on this box (`ssh2`/`cpu-features` native bindings — pre-existing, unrelated
to this work), hence `npx tsx` rather than `node dist/index.js`.

Confirm the new SQL actually reached the store, or every PDF below is rendered from the OLD query:

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr -t -c "select position('as label' in sql) from custom_queries where id = 'q-facilities';"
```

Expected: non-zero.

- [ ] **Step 2: Render one PDF per report and look at every one**

```bash
npx tsx packages/cli/src/index.ts report run r-amr-resistance --format pdf --param from=2010-01-01 --param to=2014-12-31 --out amr.pdf
```

Repeat for `r-test-volume`, `r-turnaround-time`, `r-patient-demographics`, `r-amr-facility-summary`,
`r-amr-antibiogram`, `r-amr-first-isolate-summary`, `r-amr-glass-ris`.

⛔ **The date range is passed FLAT as `from`/`to`, not as `dateRange`.** The design declares a
`daterange` parameter for the UI, but the Studio's picker writes top-level `from`/`to` and the
queries declare `from`/`to` as their own params. `--param dateRange.from=…` produces a key nothing
reads and fails with `required parameter: from`.

Then use the `Read` tool on each PDF (`pages: "1"`) and confirm by eye:

- the OpenLDR mark renders — not a dashed placeholder box, not a black rectangle
- `OpenLDR` appears beside it, on one line with the rule below it
- the scope panel shows a real date range and either a facility name or `—`, **never** a literal
  `{{param.from}}` and never a blank value
- the table starts below the panel with no overprinting, and the page number is not overlapped
- `r-amr-facility-summary` shows a facility **name**, not `NICD`

- [ ] **Step 3: Prove the filter actually filters**

The strongest check, and the one no unit test makes: run one report twice.

```bash
npx tsx packages/cli/src/index.ts report run r-test-volume --param from=2010-01-01 --param to=2014-12-31 --csv > all.csv
npx tsx packages/cli/src/index.ts report run r-test-volume --param from=2010-01-01 --param to=2014-12-31 --param facility=BAMAD --csv > one.csv
wc -l all.csv one.csv
```

Expected: `one.csv` has strictly fewer rows than `all.csv`. Equal row counts mean the predicate is
inert — the exact defect §1.2 describes, which every SQL-shape test would still pass.

- [ ] **Step 4: Run the full gate**

```bash
pnpm turbo run typecheck test --force --concurrency=4 > gate.log 2>&1; echo "EXIT=$?"; grep -E "Tasks:|Failed:" gate.log
```

Expected: `EXIT=0`, `Tasks: 67 successful, 67 total`. On a failure, read WHICH error before
concluding: `grep "Test timed out" gate.log` and re-run that package alone.

- [ ] **Step 5: Merge to LOCAL main**

`main` moves under you — a concurrent session shares this directory.

```bash
git rev-parse slice/report-facility-and-letterhead
git checkout main && git merge --no-ff slice/report-facility-and-letterhead -F <message file>
git diff --stat <the sha printed above> HEAD
```

Expected: the final `git diff --stat` prints **nothing**. Any output means `main` moved and the
merged tree was never gated — re-gate the merge commit before going further. Do not push.

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §3.1 param options carry value + label | Task 1 |
| §3.2 `q-facilities` onto the real dimension | Task 2 |
| §3.3 the four predicates (incl. `q-test-volume` newly wired) | Task 3 |
| §3.4 label by name, group by code | Task 2 |
| §4.1 `{{param.*}}` renders run values | Task 4 |
| §4.2 `drawKeyValue` interpolates unbound pairs only | Task 4 |
| §4.3 letterhead on every report | Task 5 |
| §4.4 metadata panel from declared parameters | Task 5 |
| §5 logo + `lab.name`, create-if-absent | Task 6 |
| §6 every testing bullet | Tasks 1-6 (unit) + Task 7 (PDF, filter-actually-filters, gate) |

**Type consistency.** `ReportParamOption {value,label}` is introduced in Task 1 and used unchanged in
Tasks 1 and 2. `paramMap(design, now, identity?, values?)` is defined in Task 4 and consumed by
Task 5's panel. `interpolatedPairValues(el, resolved, tokens)` is defined and used only within
Task 4. `LAB_IDENTITY_DEFAULTS` is defined and used only within Task 6.

**Ordering constraint.** Task 5 CANNOT precede Task 4 — its panel is entirely token-driven and would
render literal `{{param.from}}` text. Tasks 1→2 and 2→3 are ordered by the options contract and the
picker's values respectively. Task 6 is independent of 1-5 and could run at any point.

**Deliberately not done** (spec §7): backfilling `facility_registry`, multi-select facility
filtering, re-authoring `rt-clinical-micro`, and the header query's 4× re-execution.
