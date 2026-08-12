# Root C1 — the clinical report says what is known: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse to render a clinical report for a request that does not exist, and print a control block carrying the few document facts this system actually holds.

**Architecture:** One optional `requiresData` field on `ReportDesign` names the bound element whose row is the report's subject. The report render path throws a coded error when that element resolves to zero rows. The clinical design sets it, and gains a control-block panel.

**Tech Stack:** TypeScript, vitest, pg-mem, Fastify, pdfkit (rendered and inspected in the last task).

## Global Constraints

- **The gate is on the REPORT path only.** `POST /api/report-designs/preview` (`apps/server/src/report-designs-routes.ts:100`) must keep rendering a design whose tables are empty — that is how an author lays one out. Do not touch that route.
- **A query ERROR is not a refusal.** `ResolvedTable` is `{ columns, rows } | { error }` (`packages/report-designer/src/render/index.ts:6-8`). The renderer already draws a visible red placeholder for an error, which is loud rather than misleading. Only **zero rows** refuses.
- **Absent control-block fields print an em dash**, not "Not recorded" — an operator ruling. The clarifying line in §Task 3 is the agreed mitigation; do not drop it and do not substitute other wording.
- **The `Authorised by ______` signature line stays untouched.** It is a wet-ink signing affordance, an operator ruling. Do not remove, gate, or reword it.
- **`rt-clinical-micro` element ids are BARE** (`hdr`, `org`, `tbl`) — this design is a hand-authored literal, not built by `simpleTableDesign`, so ids are not prefixed with the design id.
- **Run `npx tsc --noEmit` in every package you touch before committing.** An earlier slice in this arc shipped a typecheck break because `tsc` is not a test and nobody ran it.
- `apps/server` is the only package with real lint; it enforces a return/await `reply.send` rule.
- No `Co-Authored-By` trailers. Stage named paths only, never `git add -A`.
- Work in the worktree `.worktrees/report-outputs-c1` on branch `slice/report-outputs-c1`. Dependencies are installed.
- No migration. No new i18n keys.

---

### Task 1: The mechanism — `requiresData` and the refusal

**Files:**
- Modify: `packages/report-designer/src/schema.ts` (the top-level design fields, beside `pageNumbers` at `:127`)
- Modify: `packages/core/src/error-catalog.ts:38-41` (the `RP` block)
- Modify: `packages/bootstrap/src/index.ts:238-252` (`renderDataDriven`)
- Test: `packages/report-designer/src/store.test.ts`, `packages/core/src/error-catalog.test.ts`, `packages/bootstrap/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, both used by Task 2:
  - `ReportDesign.requiresData?: string` — names a bound element id.
  - Error code `RP0005`, domain `reports`, HTTP 404, message `no data for this report request`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/error-catalog.test.ts`:

```ts
  it('carries RP0005 for a report whose subject does not exist', () => {
    // 404, not 400 or 500: the parameters were well-formed and the system worked — the request
    // simply does not exist. A 500 would read as a bug; a 400 would blame the caller's input.
    expect(CATALOG.RP0005.domain).toBe('reports');
    expect(CATALOG.RP0005.httpStatus).toBe(404);
  });
```

Add to `packages/bootstrap/src/index.test.ts`, following that file's existing pattern for building a `renderDataDriven` dependency set — read it first and match how it stubs `reportDefs`, `reportDesigns`, `resolveDesignTables` and `renderReportDesignPdf`:

```ts
  it('⛔ refuses to render a report whose required element resolved to ZERO rows', async () => {
    // The audit photographed a clinical report showing labels with no values and a signature line.
    // `keyValuePairs` renders zero rows exactly that way (draw.ts:340), so the page reads as a real,
    // signable result for a request that was never made.
    let rendered = false;
    const dd = makeDataDriven({
      design: { id: 'd1', requiresData: 'hdr', pages: [], parameters: [] },
      resolved: new Map([['hdr', { columns: [], rows: [] }]]),
      onRender: () => { rendered = true; },
    });
    await expect(dd.renderDataDriven('r1', {})).rejects.toMatchObject({ code: 'RP0005' });
    expect(rendered, 'no PDF may be produced for a refused report').toBe(false);
  });

  it('renders normally when the required element has rows', async () => {
    const dd = makeDataDriven({
      design: { id: 'd1', requiresData: 'hdr', pages: [], parameters: [] },
      resolved: new Map([['hdr', { columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] }]]),
    });
    await expect(dd.renderDataDriven('r1', {})).resolves.toBeInstanceOf(Buffer);
  });

  it('does NOT refuse on a query error — the renderer draws a visible placeholder for that', async () => {
    // An error is loud. Refusing here would turn a visible red box into a failed download, and the
    // spec deliberately scopes the refusal to the silent case.
    const dd = makeDataDriven({
      design: { id: 'd1', requiresData: 'hdr', pages: [], parameters: [] },
      resolved: new Map([['hdr', { error: 'boom' }]]),
    });
    await expect(dd.renderDataDriven('r1', {})).resolves.toBeInstanceOf(Buffer);
  });

  it('renders a design that declares no requiresData, whatever its tables resolved to', async () => {
    const dd = makeDataDriven({
      design: { id: 'd1', pages: [], parameters: [] },
      resolved: new Map([['hdr', { columns: [], rows: [] }]]),
    });
    await expect(dd.renderDataDriven('r1', {})).resolves.toBeInstanceOf(Buffer);
  });
```

If `index.test.ts` has no such helper, build the smallest one that supplies exactly the four deps `renderDataDriven` reads (`reportDefs.get`, `reportDesigns.get`, `resolveDesignTables`, `renderReportDesignPdf`) plus `labIdentity`. Do not reach for a real database.

Add to `packages/report-designer/src/store.test.ts`, inside the `ReportDesign round-trip completeness` describe block:

```ts
  it('round-trips requiresData', async () => {
    const store = createReportDesignStore(db);
    await store.create({ ...makeDesign('rq', 'R'), requiresData: 'hdr' });
    expect((await store.get('rq'))?.requiresData).toBe('hdr');
  });
```

⚠ That file carries a tripwire asserting the schema's key set (`KNOWN_TOP_LEVEL_FIELDS`) and a second one asserting `EVERY_FIELD` covers them. Adding a schema field **will** fire both. Extend both, and add `requiresData` to `EVERY_FIELD` at a non-default value. Do **not** add it to the hash-mutation table — see Step 3.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/core && npx vitest run src/error-catalog.test.ts
```

Expected: FAIL — `Cannot read properties of undefined (reading 'domain')`, because `RP0005` is not in the catalog.

```bash
cd packages/bootstrap && npx vitest run src/index.test.ts
```

Expected: FAIL — the refusal test resolves to a Buffer instead of rejecting.

- [ ] **Step 3: Add the schema field**

In `packages/report-designer/src/schema.ts`, beside `pageNumbers` (`:127`):

```ts
  /** The id of a bound element that MUST resolve to at least one row for this design to render as a
   *  REPORT. Zero rows means the subject does not exist — for the clinical report, no such request —
   *  and `keyValuePairs` renders zero rows as labels with EMPTY values (draw.ts:340), which reads as
   *  a real, signable result. Not enforced on the design PREVIEW path: an author must be able to lay
   *  out a design before any data exists. */
  requiresData: z.string().optional(),
```

⛔ **Do NOT add `requiresData` to `hashOf`** in `packages/report-designer/src/store.ts`. It is authoring/publication metadata, not report content, and adding it would move the content hash of every design and re-ship the whole design set over reference sync. The `status` field set the same precedent in slice T3.

- [ ] **Step 4: Add the catalog entry**

In `packages/core/src/error-catalog.ts`, after `RP0004` (`:41`):

```ts
  { code: 'RP0005', domain: 'reports', httpStatus: 404, message: 'no data for this report request' },
```

- [ ] **Step 5: Add the gate**

In `packages/bootstrap/src/index.ts`, extend the `@openldr/core` import at `:11` with `appError`, then insert immediately after `const resolved = await deps.resolveDesignTables(...)` (`:249`):

```ts
    // ⛔ Refuse rather than render. `requiresData` names the bound element whose row IS this
    // report's subject, so zero rows means the subject does not exist — for the clinical report,
    // no such request. `keyValuePairs` renders zero rows as labels with EMPTY values
    // (packages/report-designer/src/render/draw.ts:340), which is the page the 2026-08-07 audit
    // photographed and read as ready for sign-off.
    // A query ERROR deliberately does NOT refuse: the renderer already draws a visible red
    // placeholder for it, which is loud rather than misleading.
    if (design.requiresData) {
      const subject = resolved.get(design.requiresData);
      if (!subject || (!('error' in subject) && subject.rows.length === 0)) {
        throw appError('RP0005', { details: { reportId: id, element: design.requiresData } });
      }
    }
```

A missing map entry refuses too: it means `requiresData` names an element that is not bound, which would otherwise disable the gate silently. Task 2 adds a seed-level test so that misconfiguration cannot reach production.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd packages/core && npx vitest run && npx tsc --noEmit -p tsconfig.json
```

```bash
cd packages/report-designer && npx vitest run && npx tsc --noEmit -p tsconfig.json
```

```bash
cd packages/bootstrap && npx vitest run src/index.test.ts && npx tsc --noEmit -p tsconfig.json
```

Expected: all pass, tsc exit 0 in each.

- [ ] **Step 7: Commit**

```bash
git add packages/report-designer/src/schema.ts packages/report-designer/src/store.test.ts packages/core/src/error-catalog.ts packages/core/src/error-catalog.test.ts packages/bootstrap/src/index.ts packages/bootstrap/src/index.test.ts
git commit -m "feat(reporting): let a design require data, and refuse to render a report without it"
```

---

### Task 2: Turn it on for the clinical report, and stop the gate being silently misconfigured

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (the `rt-clinical-micro` literal)
- Test: `packages/reporting/src/seed/report-seeds.test.ts`, `apps/server/src/reports-routes.test.ts`

**Interfaces:**
- Consumes: `ReportDesign.requiresData` and `RP0005` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
describe('SEED_DESIGNS — requiresData', () => {
  it('the clinical report requires its patient & specimen panel', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-clinical-micro')!;
    expect(d.requiresData).toBe('hdr');
  });

  // ⛔ A typo here would disable the gate SILENTLY — the refusal would simply never fire and an
  // empty report would render exactly as it does today. `hdr` binds q-clinical-micro-header, whose
  // row IS the request. Do NOT point this at `tbl`: a real request with no isolate legitimately has
  // zero AST rows, so gating on it would refuse valid reports.
  it('every requiresData names an element of its own design that is actually BOUND', () => {
    for (const d of SEED_DESIGNS) {
      if (!d.requiresData) continue;
      const el = d.pages.flatMap((p) => p.elements).find((e) => e.id === d.requiresData);
      expect(el, `${d.id}: requiresData names '${d.requiresData}', which is not an element`).toBeDefined();
      expect(el!.dataSource, `${d.id}: '${d.requiresData}' is not bound to a query`).toBeDefined();
    }
  });
});
```

Add to `apps/server/src/reports-routes.test.ts`, using that file's `appWith(reporting)` helper (`:19` — it takes the reporting stub **directly**, not an options object):

```ts
  it('⛔ a report with no data is a 404 with a code, not a 500 and not a PDF', async () => {
    const { appError } = await import('@openldr/core');
    const app = appWith({ renderPdf: async () => { throw appError('RP0005'); } });
    const res = await app.inject({ method: 'GET', url: '/api/reports/r-clinical-micro.pdf?request=nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).not.toContain('application/pdf');
    expect(JSON.parse(res.body).code).toBe('RP0005');
  });
```

If that file's error-shape assertions read a different envelope, match the shape its existing coded-error tests assert rather than inventing one.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts -t "requiresData"
```

Expected: FAIL — `expected undefined to be 'hdr'`.

```bash
cd apps/server && npx vitest run src/reports-routes.test.ts -t "no data"
```

Expected: FAIL — the route returns 500, because nothing maps `RP0005` yet, or the stub is not wired.

- [ ] **Step 3: Set it on the clinical design**

In `packages/reporting/src/seed/report-seeds.ts`, on the `rt-clinical-micro` design literal, beside its other top-level fields (`paper`, `orientation`, `margins`, `status`):

```ts
    // ⛔ Zero rows from `hdr` means there is no such request. Rendering anyway produces the page the
    // 2026-08-07 audit photographed: labels with no values, an empty organism panel, a susceptibility
    // table with only its header — and a signature line, which made it read as ready for sign-off.
    // NOT `tbl`: a real request with no isolate legitimately has zero AST rows.
    requiresData: 'hdr',
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/reporting && npx vitest run src/seed/ && npx tsc --noEmit -p tsconfig.json
```

```bash
cd apps/server && npx vitest run src/reports-routes.test.ts && npx tsc --noEmit -p tsconfig.json && npx eslint src/reports-routes.ts
```

Expected: all pass, tsc exit 0, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts apps/server/src/reports-routes.test.ts
git commit -m "fix(reporting): refuse a clinical report for a request that does not exist"
```

---

### Task 3: The control block

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` — `q-clinical-micro-header`'s three dialect final selects (lines `1911`, `1957`, `2003`), and the `rt-clinical-micro` element list
- Test: `packages/reporting/src/seed/report-seeds.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Add to `packages/reporting/src/seed/report-seeds.test.ts`:

```ts
describe('rt-clinical-micro — document control block', () => {
  const design = () => SEED_DESIGNS.find((x) => x.id === 'rt-clinical-micro')!;
  const el = (id: string) => design().pages[0].elements.find((e) => e.id === id);

  it('carries the four facts this system actually holds', () => {
    const doc = el('doc')!;
    expect(doc.kind).toBe('keyvalue');
    expect(doc.dataSource?.queryId).toBe('q-clinical-micro-header');
    const keys = doc.boundColumns!.map((c) => c.key);
    expect(keys).toContain('lab_number');
    expect(keys).toContain('request_status');
    expect(keys).toContain('received');
  });

  it('shows the two absent fields as em dashes, in their own UNBOUND panel', () => {
    // Separate from `doc` because a bound keyvalue cannot carry extra rows — draw.ts:346 returns
    // early on el.dataSource. 0 of 7,520 reports carry `issued`, so these cannot come from a query.
    const abs = el('docabs')!;
    expect(abs.dataSource).toBeUndefined();
    expect(abs.rows).toEqual([['Issued', '—'], ['Amendment', '—']]);
  });

  // ⛔ The em dash here means "not recorded in this system", which is NOT what the em dash means
  // beside a parameter (draw.ts:170 — "not filtered"). Without this line the two read the same.
  it('says what its em dash means', () => {
    expect(el('docnote')!.text).toMatch(/not recorded/i);
  });

  // ⛔ The clinical design is EXCLUDED from the pairwise no-overprint guard that covers every other
  // seeded design — `simple()` in this file filters it out because it is a hand-authored literal.
  // So these three new elements have no geometry guard unless one is written here. The design is
  // fixed-coordinate: a wrong `y` silently overprints and only a rendered page would show it.
  it('keeps the control block clear of the table above and the footer rule below', () => {
    const els = design().pages[0].elements;
    const r = (id: string) => els.find((e) => e.id === id)!.rect;
    const tbl = r('tbl'), rule2 = r('rule2');
    for (const id of ['doc', 'docabs', 'docnote']) {
      expect(r(id).y, `${id} starts above the table's bottom`).toBeGreaterThanOrEqual(tbl.y + tbl.h);
      expect(r(id).y + r(id).h, `${id} runs past the footer rule`).toBeLessThanOrEqual(rule2.y);
    }
    // And they do not overlap each other.
    for (const [a, b] of [['doc', 'docabs'], ['docabs', 'docnote']] as const) {
      expect(r(b).y, `${b} overlaps ${a}`).toBeGreaterThanOrEqual(r(a).y + r(a).h);
    }
  });

  it.each(['postgres', 'mssql', 'mysql'] as const)('projects request_status in %s', (d) => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-clinical-micro-header')!;
    expect(q.sql[d]!).toMatch(/q\.status as request_status/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/reporting && npx vitest run src/seed/report-seeds.test.ts -t "control block"
```

Expected: FAIL — `Cannot read properties of undefined (reading 'kind')`; the `doc` element does not exist.

- [ ] **Step 3: Project the status, in all three dialects**

At lines `1911`, `1957` and `2003` the three dialects each read identically:

```sql
  q.request_id as lab_number,
```

Add one line directly beneath it, in **each of the three**:

```sql
  q.status as request_status,
```

⛔ **Edit the three sites individually. Do NOT use a global replace.** These three lines are byte-identical to each other, and a replace-all in this file reached into an unrelated query during slice Root B. After editing, confirm exactly three occurrences and that all three fall inside `q-clinical-micro-header`:

```bash
grep -n "q.status as request_status" packages/reporting/src/seed/report-seeds.ts
```

Expected: exactly three line numbers, all between the `id: 'q-clinical-micro-header'` line and the start of the next query.

- [ ] **Step 4: Add the control block and its note**

**Three** elements, not two. `keyValuePairs` (`packages/report-designer/src/render/draw.ts:344-347`) returns early on `el.dataSource`, so a bound panel **cannot** also carry unbound rows — it is either/or. The `Issued` and `Amendment` em-dash rows therefore need their own unbound panel. Do not fabricate always-null query columns to force them into the bound one.

The free band is measured, not guessed. The existing elements are `tbl` at `y: 360, h: 300` (bottom 660) and `rule2` at `y: 1000` — 340px of empty page between them, which is also what the audit's P1-06 complains about. These rects sit in that band:

```ts
      // Document control. Only the facts this system actually holds.
      { id: 'doc', kind: 'keyvalue', name: 'Document control', rect: { x: 40, y: 680, w: 700, h: 48 },
        layout: 'inline', panelColumns: 2,
        dataSource: { kind: 'custom-query', queryId: 'q-clinical-micro-header' },
        boundColumns: [
          { key: 'lab_number', label: 'Request ID', kind: 'label' },
          { key: 'request_status', label: 'Status', kind: 'label' },
          { key: 'received', label: 'Received', kind: 'label' },
        ] },
      // UNBOUND, and separate from `doc` on purpose: a bound keyvalue cannot carry extra rows
      // (draw.ts:346 returns early on el.dataSource). These two are em dashes because
      // authorised_at and result_status are stubbed upstream — 0 of 7,520 reports carry `issued`.
      { id: 'docabs', kind: 'keyvalue', name: 'Document control (not recorded)', rect: { x: 40, y: 732, w: 700, h: 30 },
        layout: 'inline', panelColumns: 2,
        rows: [['Issued', '—'], ['Amendment', '—']] },
      { id: 'docnote', kind: 'text', name: 'Control note', rect: { x: 40, y: 766, w: 700, h: 16 },
        text: '— means the value is not recorded in this system.',
        style: { fontSize: 7, color: '#64748b' } },
```

Heights are derived, not eyeballed. `pairRects` lays pairs out at `KV_INLINE_H_PT = 14` with `KV_PAD_Y_PT = 4` top and bottom, in **points**, while these rects are **px@96** — the trap `simple-design.ts:59-63` records. `doc` has 3 pairs at `panelColumns: 2` → 2 rows → `(4*2 + 2*14) = 36pt` → `36 / 0.75 = 48px`. `docabs` has 2 pairs → 1 row → `(8 + 14) = 22pt` → `29.33px`, rounded up to 30.

Bottom edges: `doc` 728, `docabs` 762, `docnote` 782 — all clear of `rule2` at 1000, and all below `tbl`'s bottom at 660.

⛔ Do not add an authoriser row. The signature line owns authorisation, and two authorisation surfaces on one page is exactly the ambiguity slice T3 removed at the menu level.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/reporting && npx vitest run src/seed/ && npx tsc --noEmit -p tsconfig.json
```

Expected: all pass, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reporting): give the clinical report a document control block"
```

---

### Task 4: Render it, read it, run the gate

Tasks 1-3 prove the design object and the render path. None renders a page. Slice Root B shipped a string every test passed and the page silently ellipsized — this task is the guard against repeating that.

**Files:**
- Create: nothing permanent. A PDF and a dump script under `.superpowers/sdd/` (gitignored).
- Modify: only what the PDF reveals.

- [ ] **Step 1: Render the clinical design**

⛔ **Do not render through `ctx.reporting.renderPdf`.** It reads the design from the DATABASE, which holds whatever was last seeded, and this branch must not seed a shared dev database. Render the in-code design through the preview path instead. Write `/tmp/rc/preview.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { SEED_DESIGNS } from '@openldr/reporting';
import { renderReportDesignPdf, resolveDesignTables } from '@openldr/report-designer';

async function main() {
  const design = SEED_DESIGNS.find((d) => d.id === 'rt-clinical-micro')!;
  // One row, so the control block is populated. The refusal path is covered by Task 1's tests.
  const row = {
    patient_surname: 'Banda', patient_firstname: 'Grace', sex: 'F', dob: '1988-03-04',
    specimen: 'Blood', received: '2026-05-01', lab_number: 'TZDISA0001234',
    request_status: 'completed', panel: 'Culture & sensitivity', organism: 'Escherichia coli',
    performing_lab: 'Ndola Central', lab_location: 'Ndola, Copperbelt',
  };
  const resolved = await resolveDesignTables(design, { request: 'TZDISA0001234' }, async () => ({
    columns: Object.keys(row).map((k) => ({ key: k, label: k })), rows: [row],
  }));
  const pdf = await renderReportDesignPdf(design, resolved, { identity: {} as never, now: new Date(2026, 7, 12) });
  const out = 'D:/Projects/Repositories/openldr_ce/.worktrees/report-outputs-c1/.superpowers/sdd/preview-clinical.pdf';
  writeFileSync(out, pdf);
  process.stdout.write(`wrote ${out} (${pdf.length} bytes)\n`);
}
main().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
```

That stub returns the same rows for every bound query in the design, which is fine — this task checks the control block, not the susceptibility table.

```bash
cd D:/Projects/Repositories/openldr_ce/.worktrees/report-outputs-c1 && npx tsx /tmp/rc/preview.ts
```

- [ ] **Step 2: Read the page**

`pdftoppm` is not installed here, so extract the text **with coordinates**. Write `.superpowers/sdd/dump.mjs`:

```js
import { readFileSync } from 'node:fs';
const pdfjs = await import('../../node_modules/.pnpm/pdfjs-dist@6.0.227/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const data = new Uint8Array(readFileSync('.superpowers/sdd/preview-clinical.pdf'));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  console.log(`\n##### page ${n} #####`);
  const tc = await page.getTextContent();
  const items = tc.items.filter((i) => i.str.trim()).map((i) => ({
    y: +(vp.height - i.transform[5]).toFixed(1), x: +i.transform[4].toFixed(1), s: i.str.trim(),
  })).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const i of items) console.log(`  y=${String(i.y).padStart(6)} x=${String(i.x).padStart(6)}  ${i.s}`);
}
```

If that pdfjs path does not exist, find it with `ls -d node_modules/.pnpm/pdfjs-dist*` and use that version.

```bash
cd D:/Projects/Repositories/openldr_ce/.worktrees/report-outputs-c1 && node .superpowers/sdd/dump.mjs
```

Check, and state each in your report:
- `Request ID`, `Status` and `Received` appear with their values
- the em-dash note appears and is not truncated with `…`
- the control block does not overlap any neighbouring element — compare its `y` against the elements above and below it
- the `Authorised by ______` line is still present and unchanged
- nothing else moved

If anything overlaps or is truncated, fix the geometry and re-render. Report the before and after.

- [ ] **Step 3: Run the full gate**

```bash
pnpm turbo run typecheck test --force --continue
```

**Never pipe turbo through `tail`** — it truncates the failure list. A failure is usually a timeout, not a regression: grep for `Test timed out` and re-run that package alone before blaming this slice. `bootstrap`'s `terminology-dist-extract.test.ts` and `forms`'s `store.test.ts` have both flaked earlier in this arc and pass in isolation.

- [ ] **Step 4: Commit anything the PDF revealed**

```bash
git add <only the files you actually changed>
git commit -m "fix(reporting): <what the rendered PDF revealed>"
```

If the page was clean and the gate was green, there is nothing to commit — say so rather than inventing a commit.

---

## What this plan does NOT do

State these plainly in the final report.

- **C2 — the real document-control block.** `Issued`, the authoriser, the amendment relationship, the requester, a stable patient identifier and the accession all have **no data**: 0 of 7,520 reports carry `issued`, `national_id` is empty on all 3,714 patients, `accession` on all 3,713 specimens. Unstubbing `authorised_at` and `result_status` is upstream CDR work needing a DISA copy with the Datamine base tables or blob decoding, plus a re-ingest.
- **`received` still renders as raw ISO** (`2026-05-01`), because it is bound query data — the class slice Root D scoped out. It will sit in the control block beside a formatted `Printed` date.
- **The signature line is untouched**, by operator ruling: it is a wet-ink affordance.
- **The blank-panel convention is untouched.** `draw.ts:340` deliberately renders zero rows as labels with empty values. This slice refuses the report entirely instead, so that path is no longer reachable for the clinical design — but the convention stands for every other design.
- **HONEST NON-PROOF:** the refusal is proven at the render path and the route, not against a live warehouse. Nothing here shows that an operator rendering a real unknown request sees the coded message rather than a stack trace.
