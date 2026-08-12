# Root D — presentation-ready dates: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print `12 Aug 2026` instead of `07/08/2026`, so a Ministry document cannot be read as 7 August or 8 July depending on which server rendered it.

**Architecture:** One pure helper in `packages/report-designer/src/render/format-date.ts`, built on a literal month table with no `Intl` and no `Date` arithmetic. Applied at exactly two token sites in `paramMap` — the `{{date}}` token and the daterange's flat `from`/`to`. Nothing else changes.

**Tech Stack:** TypeScript, vitest, pdfkit (rendered and inspected in the last task).

## Global Constraints

- **No `Intl.DateTimeFormat`, and no `toLocaleDateString`.** The defect is that the server's environment decides what the document says. An explicit `'en-GB'` narrows that but does not remove it: on a small-icu Node build `en-GB` can fall back to another English locale and reorder the parts.
- **`formatDisplayDate` must not construct a `Date`.** JavaScript maps two-digit years onto 1900+, so `Date.UTC(Number('0026'), …)` is year 1926 and a validity check built on it is wrong. Use a days-in-month table.
- **Only reformat a value that is actually a date.** `from`/`to` are declared `text` and may hold anything. The `UNSET` em dash `—` must survive untouched, and `2026-02-30` must be returned unchanged rather than silently printed as `2 Mar 2026`.
- **English only.** No language reaches the renderer (`RenderOptions`, `render/index.ts:30`), and the seeded designs' own text is already English. Do not add a `locale` option no caller could supply.
- Out of scope: time, timezone, date values inside table cells, and all 18 of `apps/studio`'s ad-hoc date formatting sites.
- No `Co-Authored-By` trailers. Stage named paths only, never `git add -A`.
- Work in the worktree `.worktrees/report-outputs-d` on branch `slice/report-outputs-d`.
- No migration. No new i18n keys.

---

### Task 1: The `formatDisplayDate` helper

**Files:**
- Create: `packages/report-designer/src/render/format-date.ts`
- Test: `packages/report-designer/src/render/format-date.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, both used by Task 2:
  - `formatDisplayDate(value: string): string` — `'2026-08-12'` → `'12 Aug 2026'`; anything else returned unchanged.
  - `formatDisplayDateOf(d: Date): string` — a `Date` → the same format, read from **host-local** components.

- [ ] **Step 1: Write the failing tests**

Create `packages/report-designer/src/render/format-date.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDisplayDate, formatDisplayDateOf } from './format-date';

describe('formatDisplayDate', () => {
  it.each([
    ['2026-08-12', '12 Aug 2026'],
    ['2026-01-01', '1 Jan 2026'],      // no leading zero on the day
    ['2026-12-31', '31 Dec 2026'],
    ['2024-02-29', '29 Feb 2024'],     // leap year
    ['2000-02-29', '29 Feb 2000'],     // divisible by 400, IS a leap year
  ])('formats %s as %s', (input, expected) => {
    expect(formatDisplayDate(input)).toBe(expected);
  });

  // ⛔ Everything that is not a plain ISO date is returned UNCHANGED. `from`/`to` are declared
  // `text` and may hold anything, so this function is a filter, not a parser.
  it.each([
    ['—', 'the em dash a declared-but-unset parameter renders'],
    ['', 'an empty string'],
    ['not a date', 'free text'],
    ['2026-02-30', 'a date-shaped string that is not a real date'],
    ['2023-02-29', 'Feb 29 in a non-leap year'],
    ['1900-02-29', 'Feb 29 in a century year that is NOT a leap year'],
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-08-00', 'day 0'],
    ['2026-08-32', 'day 32'],
    ['2026-8-12', 'an unpadded month'],
    ['2026-08-12T00:00:00Z', 'a full timestamp, not a plain date'],
  ])('returns %s unchanged — %s', (input) => {
    expect(formatDisplayDate(input)).toBe(input);
  });

  // The whole point of the slice. `toLocaleDateString()` with no locale let the SERVER decide what
  // a Ministry document said. This asserts there is nothing environment-dependent left in the
  // FORMAT. ⚠ Do NOT add a TZ sweep here — `formatDisplayDate` takes a string and never touches a
  // clock, and `formatDisplayDateOf`'s calendar day follows the host zone BY DESIGN.
  it('formats identically under a different process locale', () => {
    const before = process.env.LANG;
    const beforeAll = process.env.LC_ALL;
    try {
      process.env.LANG = 'de_DE.UTF-8';
      process.env.LC_ALL = 'de_DE.UTF-8';
      expect(formatDisplayDate('2026-08-12')).toBe('12 Aug 2026');
    } finally {
      if (before === undefined) delete process.env.LANG; else process.env.LANG = before;
      if (beforeAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = beforeAll;
    }
  });
});

describe('formatDisplayDateOf', () => {
  // Built from LOCAL components on purpose. `new Date('2026-07-08T00:00:00Z')` would be 7 July in
  // any negative-offset timezone, so a literal expectation on it passes in Nairobi and fails in
  // New York. This constructor pins the local calendar day in every zone.
  it('formats a Date from its local calendar day', () => {
    expect(formatDisplayDateOf(new Date(2026, 6, 8))).toBe('8 Jul 2026');
    expect(formatDisplayDateOf(new Date(2026, 11, 31, 23, 59))).toBe('31 Dec 2026');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/report-designer && npx vitest run src/render/format-date.test.ts
```

Expected: FAIL — `Failed to resolve import "./format-date"`. That is the correct red for a module that does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `packages/report-designer/src/render/format-date.ts`:

```ts
/**
 * Display formatting for dates on a rendered report.
 *
 * ⛔ The month names are spelled out here rather than taken from `Intl.DateTimeFormat`, and that is
 * the point of this file. The defect it replaces was `now.toLocaleDateString()` with no locale
 * argument, which let the SERVER'S environment decide what a Ministry document said — the audit
 * read `07/08/2026` and could not tell 7 August from 8 July. Passing an explicit `'en-GB'` narrows
 * that but does not remove it: on a small-icu Node build `en-GB` can fall back to another English
 * locale and reorder the parts. A literal table has nothing left to fall back to.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in `month` (1-12) of `year`, by the full Gregorian leap rule. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * `2026-08-12` → `12 Aug 2026`. **Anything else is returned UNCHANGED.**
 *
 * This is a filter, not a parser. A daterange's `from`/`to` are declared `text` and may hold the
 * `—` an unset parameter renders, or free text, or a date-shaped string that is not a real date.
 *
 * ⛔ No `Date` is constructed. Round-tripping `2026-02-30` through `Date` silently yields
 * `2 Mar 2026`, and a wrong date on a clinical report is worse than an ugly one. `Date` also maps
 * two-digit years onto 1900+, so a validity probe built on `Date.UTC(Number('0026'), …)` would be
 * checking the year 1926.
 */
export function formatDisplayDate(value: string): string {
  const m = ISO_DATE.exec(value);
  if (!m) return value;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return value;
  if (day < 1 || day > daysInMonth(year, month)) return value;
  return `${day} ${MONTHS[month - 1]} ${m[1]}`;
}

/**
 * A `Date` → the same display format, read from its **host-local** components.
 *
 * Local, not UTC, on purpose: the report is generated by the lab's own server, so "generated on"
 * means the lab's calendar day. Reading UTC components would make a report generated at 01:00 local
 * claim yesterday's date. The FORMAT is environment-independent; the DAY follows the host zone, and
 * that is correct.
 */
export function formatDisplayDateOf(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/report-designer && npx vitest run src/render/format-date.test.ts
```

Expected: PASS, 19 tests — 5 formatted, 12 returned unchanged, 1 locale-independence, 1 for `formatDisplayDateOf`.

- [ ] **Step 5: Typecheck**

```bash
cd packages/report-designer && npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0, no output. An earlier slice in this arc shipped a typecheck break because `tsc` is not a test and nobody ran it.

- [ ] **Step 6: Commit**

```bash
git add packages/report-designer/src/render/format-date.ts packages/report-designer/src/render/format-date.test.ts
git commit -m "feat(report-designer): add an environment-independent display date formatter"
```

---

### Task 2: Use it for `{{date}}` and the reporting period

**Files:**
- Modify: `packages/report-designer/src/render/draw.ts` — the import block, the daterange branch at `:181-186`, and `:196`
- Test: `packages/report-designer/src/render/draw.test.ts` — `:6` (the `NOW` fixture), `:20-23`, `:32`, `:474`

**Interfaces:**
- Consumes: `formatDisplayDate` and `formatDisplayDateOf` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Fix the test fixture that would make literal expectations timezone-dependent**

`draw.test.ts:6` is:

```ts
const NOW = new Date('2026-07-08T00:00:00Z');
```

`formatDisplayDateOf` reads **local** components, so in any negative-offset timezone that instant is 7 July and a literal expectation of `'8 Jul 2026'` fails. The current assertions hide this because they compare against `NOW.toLocaleDateString()`, which moves with the host too.

Add a second fixture directly beneath it — do **not** change `NOW`, which many other tests in this file use:

```ts
// Local midnight, so `getDate()` is 8 in EVERY timezone. `NOW` above is a UTC instant and is 7 July
// in any negative-offset zone, which would make a literal date expectation pass in Nairobi and fail
// in New York.
const NOW_LOCAL = new Date(2026, 6, 8);
```

- [ ] **Step 2: Rewrite the three tautological assertions, and the two ISO ones, as failing tests**

`draw.test.ts:23`, `:32` and `:474` currently read `expect(...).toBe(NOW.toLocaleDateString())` — the expectation calls the same function as the code, so they pass whatever the format is, including a wrong one. Replace each with a literal.

At `:16-23`, change the `paramMap(...)` call's second argument from `NOW` to `NOW_LOCAL` and replace the last three assertions so the block ends:

```ts
    expect(m.get('lab')).toBe('Ndola');
    // The reporting period is reformatted too — the audit called the raw ISO range mechanical.
    expect(m.get('from')).toBe('1 Jan 2026');
    expect(m.get('to')).toBe('30 Jun 2026');
    // A LITERAL, not `NOW.toLocaleDateString()`. The old expectation called the same function as the
    // code, so it passed whatever the format was — including the ambiguous `07/08/2026` this slice
    // exists to remove.
    expect(m.get('date')).toBe('8 Jul 2026');
```

At `:30-32`, change that `paramMap(...)` call's second argument from `NOW` to `NOW_LOCAL` and replace the date assertion:

```ts
    expect(m.get('empty')).toBe('—');
    expect(m.get('date')).toBe('8 Jul 2026');
```

At `:474`, replace:

```ts
    expect(interpolate('{{date}}', t)).toBe(NOW.toLocaleDateString());
```

That test's `tokens` is the helper at `:454-455`:

```ts
  const tokens = (identity?: Record<string, string>) =>
    paramMap(design({ parameters: [{ key: 'site', label: 'Site', type: 'text', value: 'Ndola' }] }), NOW, identity);
```

Change its `NOW` to `NOW_LOCAL`, then make the assertion a literal:

```ts
    expect(interpolate('{{date}}', t)).toBe('8 Jul 2026');
```

**Leave the unrelated map at `:92` alone.** That one hardcodes `['date', '2026-07-08']` and belongs to the `interpolate` describe block — it tests token substitution, not the formatter, and its assertions at `:100-101` must keep passing unchanged.

Add one new test to the `paramMap` describe block:

```ts
  it('leaves an unset date range as em dashes rather than formatting them', () => {
    // `from`/`to` are declared `text` and hold `—` when the range is not supplied. Formatting that
    // would print `Invalid Date` on the scope panel of a clinical report.
    const m = paramMap(design({ parameters: [
      { key: 'range', label: 'Range', type: 'daterange' },
    ] }), NOW_LOCAL);
    expect(m.get('from')).toBe('—');
    expect(m.get('to')).toBe('—');
  });

  it('leaves a non-date parameter value alone', () => {
    const m = paramMap(design({ parameters: [
      { key: 'site', label: 'Site', type: 'text', value: 'Ndola' },
    ] }), NOW_LOCAL);
    expect(m.get('site')).toBe('Ndola');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd packages/report-designer && npx vitest run src/render/draw.test.ts
```

Expected: FAIL. The date assertions fail with something like `expected '08/07/2026' to be '8 Jul 2026'` (the exact received value depends on the host locale — that is the defect). The `from`/`to` assertions fail with `expected '2026-01-01' to be '1 Jan 2026'`.

- [ ] **Step 4: Wire the formatter into `paramMap`**

In `packages/report-designer/src/render/draw.ts`, add to the imports at the top of the file:

```ts
import { formatDisplayDate, formatDisplayDateOf } from './format-date';
```

In the daterange branch (`:181-186`), wrap both values. The branch becomes:

```ts
    if (p.type === 'daterange') {
      const dflt = (p.value ?? {}) as { from?: string; to?: string };
      // Formatted for the page, not left as raw ISO — the audit called the ISO range mechanical.
      // `formatDisplayDate` passes anything that is not a plain ISO date through untouched, so the
      // UNSET em dash below survives as an em dash.
      m.set('from', formatDisplayDate((values?.from as string) || dflt.from || UNSET));
      m.set('to', formatDisplayDate((values?.to as string) || dflt.to || UNSET));
      continue;
    }
```

Replace `:196`:

```ts
  m.set('date', formatDisplayDateOf(now));
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/report-designer && npx vitest run src/render/
```

Expected: PASS, whole directory. If any other test in this file asserted a raw ISO `from`/`to`, it now fails legitimately — update it to the display format rather than reverting the change.

- [ ] **Step 6: Typecheck, and check the whole package**

```bash
cd packages/report-designer && npx tsc --noEmit -p tsconfig.json && npx vitest run
```

Expected: tsc exit 0; all tests pass.

- [ ] **Step 7: Check nothing outside this package asserted the old format**

```bash
grep -rn "toLocaleDateString" --include=*.ts --include=*.tsx packages apps
```

Expected: no hits in `packages/`. Hits in `apps/studio` are the 18 ad-hoc UI sites, which are explicitly out of scope — leave them.

- [ ] **Step 8: Commit**

```bash
git add packages/report-designer/src/render/draw.ts packages/report-designer/src/render/draw.test.ts
git commit -m "fix(report-designer): print an unambiguous date and reporting period"
```

---

### Task 3: Render the PDFs, read them, run the gate

Tasks 1 and 2 prove the token layer. Neither renders a page. Root B in this same arc shipped a string every test passed and the page silently ellipsized — this task is the guard against repeating that.

**Files:**
- Create: nothing permanent. Two PDFs and a dump script under `.superpowers/sdd/` (gitignored).
- Modify: only what the PDFs reveal.

**Interfaces:**
- Consumes: everything.
- Produces: the merge-readiness evidence.

- [ ] **Step 1: Render both AMR reports from the in-code designs**

⛔ **Do not render through `ctx.reporting.renderPdf`.** That reads the design from the DATABASE, and the dev database holds whatever the last boot seeded — Root B's first render showed neither of its new elements for exactly this reason. Do not seed a shared dev database from an unmerged branch either.

Render the in-code design through the same path the `/api/report-designs/preview` route uses. Write `/tmp/rd/preview.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { SEED_DESIGNS } from '@openldr/reporting';
import { renderReportDesignPdf, resolveDesignTables } from '@openldr/report-designer';

async function main() {
  for (const id of ['rt-amr-antibiogram', 'rt-amr-glass-ris']) {
    const design = SEED_DESIGNS.find((d) => d.id === id)!;
    const values: Record<string, unknown> = { from: '2026-01-01', to: '2026-06-30', country: 'ZMB', year: '2026' };
    // No warehouse: every table resolves to an error placeholder. This proves the HEADER, which is
    // where the dates are.
    const resolved = await resolveDesignTables(design, values, async () => { throw new Error('no warehouse'); });
    const pdf = await renderReportDesignPdf(design, resolved, { identity: {} as never, values, now: new Date(2026, 7, 12) });
    const out = `D:/Projects/Repositories/openldr_ce/.worktrees/report-outputs-d/.superpowers/sdd/preview-${id}.pdf`;
    writeFileSync(out, pdf);
    process.stdout.write(`wrote ${out} (${pdf.length} bytes)\n`);
  }
}
main().catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
```

`renderReportDesignPdf` takes an injectable `opts.now` (`render/index.ts:52`), so the output is deterministic with no clock mocking.

Run it from the worktree root — the script must live outside the worktree for module resolution to work:

```bash
cd D:/Projects/Repositories/openldr_ce/.worktrees/report-outputs-d && npx tsx /tmp/rd/preview.ts
```

- [ ] **Step 2: Read the pages**

`pdftoppm` is not installed here, so inspect by extracting the text **with coordinates**. Write `.superpowers/sdd/dump.mjs`:

```js
import { readFileSync } from 'node:fs';
const pdfjs = await import('../../node_modules/.pnpm/pdfjs-dist@6.0.227/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
for (const id of ['preview-rt-amr-antibiogram', 'preview-rt-amr-glass-ris']) {
  const data = new Uint8Array(readFileSync(`.superpowers/sdd/${id}.pdf`));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  console.log(`\n##### ${id} #####`);
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter((i) => i.str.trim()).map((i) => ({
    y: +(vp.height - i.transform[5]).toFixed(1), x: +i.transform[4].toFixed(1), s: i.str.trim(),
  })).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const i of items) console.log(`  y=${String(i.y).padStart(6)} x=${String(i.x).padStart(6)}  ${i.s}`);
}
```

If the pinned pdfjs path does not exist, find it with `ls -d node_modules/.pnpm/pdfjs-dist*` and use that version.

```bash
cd D:/Projects/Repositories/openldr_ce/.worktrees/report-outputs-d && node .superpowers/sdd/dump.mjs
```

Check, and state each in your report:
- `Generated` reads `12 Aug 2026`, not a slash-separated date and not truncated with `…`
- `Reporting period` reads `1 Jan 2026 – 30 Jun 2026`
- GLASS's `Country code` reads `ZMB` and `Year` reads `2026` — those are not dates and must be untouched
- no scope-panel value ends in `…`. The panel ellipsizes silently past its value box; a longer date string is exactly the risk

If a value is truncated, the fix is the string, not the box — report it and stop.

- [ ] **Step 3: Run the full gate**

```bash
pnpm turbo run typecheck test --force --continue
```

**Never pipe turbo through `tail`** — it truncates the failure list. A failure is usually a timeout, not a regression: grep the output for `Test timed out` and re-run that package alone before blaming this slice. `bootstrap`'s `terminology-dist-extract.test.ts` has timed out on two prior runs in this arc and passes in isolation.

- [ ] **Step 4: Commit anything the PDFs revealed**

```bash
git add <only the files you actually changed>
git commit -m "fix(report-designer): <what the rendered PDFs revealed>"
```

If the pages were clean and the gate was green, there is nothing to commit here — say so rather than inventing a commit.

---

## What this plan does NOT do

State these plainly in the final report; do not let them look finished.

- **No time and no timezone.** `{{date}}` is a date only. Two runs on the same day are still indistinguishable, so P1-04's release-traceability half stays open. It belongs with Root C, which needs a `lab.timezone` setting that does not exist yet.
- **Date values inside table cells are untouched.** They arrive from SQL as strings and the renderer cannot tell a date column from a text one.
- **`apps/studio`'s 18 ad-hoc date sites are untouched** — some bare `toLocaleString()`, some hardcoded `'en-GB'`. Adjacent, not this slice.
- **HONEST NON-PROOF:** no test proves behaviour on a small-icu Node build. The month table means there is nothing locale-dependent left in the format, which is why it was chosen over `Intl` — but that is an argument, not a test.
- A lab-authored design encoding `{{param.from}}` in a barcode or QR payload now gets `12 Aug 2026` rather than `2026-08-12` (`elementValue`, `draw.ts:502`). No seeded design does this. Accepted in the spec.
