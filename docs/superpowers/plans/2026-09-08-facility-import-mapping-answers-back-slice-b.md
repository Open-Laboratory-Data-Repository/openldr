# Facility import: the mapping step answers back (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every column mapping row carries a status icon that says whether that mapping is sound, checkable on its own without validating the whole register, and a controlled field's unrecognised values appear under the row they belong to instead of in a separate box.

**Architecture:** A new route returns one column's distinct values out of the stored file, so checking `Type` reads one column rather than the whole register. The existing value ranker scores those values. `ColumnMapStep` grows a per-row status derived from three sources: collisions it already computes client-side, the ranker's confidence, and the per-field check's result. The value worklist moves from its own panel into the row whose target it belongs to.

**Tech Stack:** Fastify, `csv-parse` streaming, React 18, vitest, react-i18next, Tabler-style lucide icons already used across the studio.

**Spec:** `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`

## Global Constraints

- **Never read the whole file into memory**, server side or client side. The distinct-values route streams the blob exactly as `readFileRows` does, and returns one column's values, not the file.
- **The check must be per field.** Clicking one row's icon must not validate the whole register. This is the operator's decision and the reason the route exists.
- **Always clickable, in every state.** A re-check is never gated on the app agreeing that something changed. This is the operator's decision, recorded in the spec.
- **A 100% match goes green on its own**, with no click. An exact, collision-free suggestion is a decision the ranker is certain about.
- **Neutral and stale are both a gray tick**, told apart by their tooltips only. The operator chose this. Do not invent a second glyph.
- **shadcn only.** No native `<button>`, `<select>` or `<table>`. Icon buttons carry an `aria-label`.
- **The mapping rows stack below the `sm` breakpoint.** They were changed to `grid-cols-1 ... sm:grid-cols-[minmax(0,auto)_1fr]` because the `auto` label track, sized by "Catchment population head count", squeezed the control to a chevron on a phone. Any row you restructure keeps that.
- **i18n in en, fr and pt.** A missing key renders as literal braces. `apps/studio/src/i18n/{en,fr,pt}.ts`, with a parity test, and `fr.ts`/`pt.ts` are typed against `en`'s shape so `tsc` pins it too.
- **No em dashes anywhere.** No emoji in headings or bullets. This was a review finding on four tasks of the previous slice.
- **Server handlers match the file's convention**, `reply.code(x); return {...}`. The string `reply.send(` appears nowhere in `facilities-routes.ts`.
- **`pnpm --filter @openldr/studio test -- <pattern>` does NOT filter on this machine.** From `apps/studio` run `pnpm exec vitest run <pattern>`.

---

## File Structure

**Server**
- Create `packages/bootstrap/src/facility-column-values.ts`: reads one column's distinct values out of a stream. One responsibility, no Fastify, no database.
- Create `packages/bootstrap/src/facility-column-values.test.ts`.
- Modify `apps/server/src/facilities-routes.ts`: a new `GET /api/facilities/import/runs/:id/columns/:header/values` route.
- Modify `apps/server/src/facilities-routes.test.ts`.

**Studio**
- Create `apps/studio/src/facilities/MappingRowStatus.tsx`: the icon and its four states. Presentational, holds no state, decides nothing.
- Create `apps/studio/src/facilities/MappingRowStatus.test.tsx`.
- Create `apps/studio/src/facilities/mappingRowState.ts`: pure function from inputs to one of four states. Testable as arithmetic, the way `stepModel.ts` is.
- Create `apps/studio/src/facilities/mappingRowState.test.ts`.
- Modify `apps/studio/src/api.ts`: `readFacilityImportColumnValues`.
- Modify `apps/studio/src/facilities/ColumnMapStep.tsx`: render the icon per row, run the check, and host the inline value worklist.
- Modify `apps/studio/src/facilities/ColumnMapStep.test.tsx`.
- Modify `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`: stop rendering `ValueMapPanel` as a separate block; pass what `ColumnMapStep` needs.
- Modify `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`.
- Modify `apps/studio/src/i18n/{en,fr,pt}.ts`.

**Docs**
- Modify `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`.

`ValueMapPanel.tsx` is NOT deleted in this slice. Task 6 decides its fate once the inline worklist is proven, so its tests keep running until then.

---

### Task 1: Read one column's distinct values out of a stream

**Files:**
- Create: `packages/bootstrap/src/facility-column-values.ts`
- Test: `packages/bootstrap/src/facility-column-values.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readColumnValues(stream: Readable, opts: { format: 'csv' | 'jsonl'; header: string; limit: number }): Promise<ColumnValues>` where
  `interface ColumnValues { values: string[]; distinct: number; truncated: boolean }`.
  `values` is the distinct non-empty values in first-seen order, capped at `limit`. `distinct` is how many distinct values the whole file holds, counted even past the cap. `truncated` is `distinct > values.length`.

- [ ] **Step 1: Write the failing test**

```ts
import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { readColumnValues } from './facility-column-values';

const streamOf = (s: string) => Readable.from([Buffer.from(s, 'utf8')]);

describe('readColumnValues', () => {
  it('returns one column\'s distinct values, in first-seen order', async () => {
    const csv = 'code,type\r\n1,Health Post\r\n2,Health Centre\r\n3,Health Post\r\n';
    const r = await readColumnValues(streamOf(csv), { format: 'csv', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post', 'Health Centre']);
    expect(r.distinct).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it('skips empty cells rather than offering an empty value to map', async () => {
    const csv = 'code,type\n1,\n2,Health Post\n3,   \n';
    const r = await readColumnValues(streamOf(csv), { format: 'csv', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post']);
  });

  it('caps the list but still counts what it did not return', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `${i},v${i}`).join('\n');
    const r = await readColumnValues(streamOf(`code,type\n${rows}\n`), { format: 'csv', header: 'type', limit: 10 });
    expect(r.values).toHaveLength(10);
    expect(r.distinct).toBe(30);
    expect(r.truncated).toBe(true);
  });

  it('reads the same column out of a jsonl release', async () => {
    const jsonl = '{"code":"1","type":"Health Post"}\n{"code":"2","type":"Health Post"}\n';
    const r = await readColumnValues(streamOf(jsonl), { format: 'jsonl', header: 'type', limit: 50 });
    expect(r.values).toEqual(['Health Post']);
    expect(r.distinct).toBe(1);
  });

  it('returns nothing for a header the file does not have, rather than throwing', async () => {
    const r = await readColumnValues(streamOf('code,type\n1,Health Post\n'), { format: 'csv', header: 'nope', limit: 50 });
    expect(r.values).toEqual([]);
    expect(r.distinct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- facility-column-values`
Expected: FAIL, "Failed to resolve import ./facility-column-values".

- [ ] **Step 3: Write minimal implementation**

Read `packages/bootstrap/src/facility-file-rows.ts` first and follow it. It already solves the streaming, the BOM, the CSV parse and the malformed-JSONL guard, and this module must behave the same way on all four. Reuse its parser setup rather than writing a second one.

```ts
import type { Readable } from 'node:stream';

export interface ColumnValues {
  /** Distinct, non-empty, in first-seen order, capped at `limit`. */
  values: string[];
  /** How many distinct values the whole file holds, counted past the cap. */
  distinct: number;
  truncated: boolean;
}

export interface ReadColumnValuesOptions {
  format: 'csv' | 'jsonl';
  /** The source column's own header text, as it appears in the file. */
  header: string;
  limit: number;
}

/** One column's vocabulary, for checking a single mapping without validating the register.
 *
 *  ⛔ THE WHOLE POINT IS THAT IT READS ONE COLUMN. Checking `Type` against its value set must not
 *  cost a parse of 3788 rows times 21 columns, which is what running the full validate would do and
 *  what the operator rejected. This still streams the file, so it is constant memory, but it returns
 *  a vocabulary rather than a table.
 *
 *  ⛔ THE SET IS CAPPED AND THE COUNT IS NOT. A column with 3000 distinct values is a column that was
 *  mapped wrongly, and the operator needs to be told that, not handed 3000 pick-lists. `distinct`
 *  reports the truth while `values` stays a list a person can work through. */
export async function readColumnValues(
  stream: Readable,
  { format, header, limit }: ReadColumnValuesOptions,
): Promise<ColumnValues> {
  const seen = new Set<string>();
  const values: string[] = [];
  // Iterate rows exactly as `readFileRows` does, then pick the one column. Follow that module's
  // structure so a fix to the parse in one is not missed in the other.
  // ... implement over the same stream iteration, pushing to `values` while `values.length < limit`
  // and always adding to `seen`.
  return { values, distinct: seen.size, truncated: seen.size > values.length };
}
```

The implementer writes the iteration body against `facility-file-rows.ts`'s own, which is why it is
not repeated here: two divergent copies of that parse is the defect this comment exists to prevent.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- facility-column-values`
Expected: PASS, 5 tests.

- [ ] **Step 5: Export it**

Add to `packages/bootstrap/src/index.ts`, beside `readFileRows`:

```ts
export { readColumnValues, type ColumnValues, type ReadColumnValuesOptions } from './facility-column-values';
```

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-column-values.ts packages/bootstrap/src/facility-column-values.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(facilities): read one column's distinct values from a stored file"
```

---

### Task 2: The column-values route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `readColumnValues` from Task 1.
- Produces: `GET /api/facilities/import/runs/:id/columns/:header/values?limit=200` returning
  `{ header: string; values: string[]; distinct: number; truncated: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
it('returns one column\'s distinct values from the stored file', async () => {
  const { app } = await appWithStoredRun('code,type\n1,Health Post\n2,Health Centre\n3,Health Post\n');
  const res = await app.inject({
    method: 'GET',
    url: `/api/facilities/import/runs/${runId}/columns/${encodeURIComponent('type')}/values`,
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    header: 'type', values: ['Health Post', 'Health Centre'], distinct: 2, truncated: false,
  });
});

it('refuses a view-only actor, the same capability the rows route needs', async () => {
  // The uploaded file's own contents. Reading them back is manage work, not view work.
});
```

Build the app the way the neighbouring tests in this file do. `appWithStoredRun` above is
illustrative: find the real helpers (the rows-route tests added in the previous slice are the closest
model) and follow those exactly rather than inventing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- facilities-routes -t "column"`
Expected: FAIL with 404, the route does not exist.

- [ ] **Step 3: Write minimal implementation**

Register it immediately after the rows route, and copy that route's shape: it already solves the run
lookup, the missing-blob 409, the stale-blob guard, the unreadable-file 422 and the `MANAGE` gate.
This route differs only in what it reads and returns.

```ts
app.get('/api/facilities/import/runs/:id/columns/:header/values', MANAGE, async (req, reply) => {
  const { id, header } = req.params as { id: string; header: string };
  const q = req.query as { limit?: string };
  const parsed = Number.parseInt(q.limit ?? '200', 10);
  // ⛔ `Number.isNaN`, NOT `|| 200`. A `limit=0` is falsy, so `||` silently yields the DEFAULT
  // rather than the FLOOR. That exact bug was found by review on the rows route.
  const limit = Math.min(1000, Math.max(1, Number.isNaN(parsed) ? 200 : parsed));
  // ... run lookup, blob guards and error mapping exactly as the rows route does
  const stream = await ctx.blob.getStream(run.blobKey);
  const out = await readColumnValues(stream, {
    format: run.sourceFormat === 'jsonl' ? 'jsonl' : 'csv',
    header,
    limit,
  });
  return reply.code(200), { header, ...out };
});
```

The implementer writes the guards out in full, matching the rows route line for line, and uses that
route's own `return` convention rather than the sketch above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/server test -- facilities-routes`
Expected: PASS, no regressions.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @openldr/server lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): a route for one column's values"
```

---

### Task 3: The row state, as arithmetic

**Files:**
- Create: `apps/studio/src/facilities/mappingRowState.ts`
- Test: `apps/studio/src/facilities/mappingRowState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type MappingRowState = 'neutral' | 'valid' | 'invalid' | 'stale';
  export interface MappingRowInputs {
    /** This header collides with another over the same contract field. */
    collides: boolean;
    /** The ranker's confidence in the CURRENT target, or null when the operator chose it. */
    confidence: 'exact' | 'likely' | 'weak' | null;
    /** The per-field check's last answer for this row, or null if it has never run. */
    checked: { unrecognised: number } | null;
    /** The mapping or the file changed since `checked` was recorded. */
    stale: boolean;
  }
  export function mappingRowState(i: MappingRowInputs): MappingRowState;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mappingRowState } from './mappingRowState';

const base = { collides: false, confidence: null, checked: null, stale: false } as const;

describe('mappingRowState', () => {
  it('a collision is invalid, whatever else is true', () => {
    expect(mappingRowState({ ...base, collides: true })).toBe('invalid');
    expect(mappingRowState({ ...base, collides: true, confidence: 'exact' })).toBe('invalid');
    expect(mappingRowState({ ...base, collides: true, checked: { unrecognised: 0 } })).toBe('invalid');
  });

  // The operator's decision: an exact, collision-free suggestion is already certain, and making
  // them confirm 21 of those by hand is the busywork this step exists to remove.
  it('an exact suggestion with no collision is valid without being checked', () => {
    expect(mappingRowState({ ...base, confidence: 'exact' })).toBe('valid');
  });

  it('a likely or weak suggestion still needs a look', () => {
    expect(mappingRowState({ ...base, confidence: 'likely' })).toBe('neutral');
    expect(mappingRowState({ ...base, confidence: 'weak' })).toBe('neutral');
  });

  it('a check that found nothing unrecognised is valid; one that did is invalid', () => {
    expect(mappingRowState({ ...base, checked: { unrecognised: 0 } })).toBe('valid');
    expect(mappingRowState({ ...base, checked: { unrecognised: 3 } })).toBe('invalid');
  });

  // Stale beats a stored result, because that result describes a mapping that no longer exists.
  it('stale outranks a previous check, but never a collision', () => {
    expect(mappingRowState({ ...base, checked: { unrecognised: 0 }, stale: true })).toBe('stale');
    expect(mappingRowState({ ...base, confidence: 'exact', stale: true })).toBe('stale');
    expect(mappingRowState({ ...base, collides: true, stale: true })).toBe('invalid');
  });

  it('nothing known at all is neutral', () => {
    expect(mappingRowState(base)).toBe('neutral');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run, from `apps/studio`: `pnpm exec vitest run mappingRowState`
Expected: FAIL, cannot resolve `./mappingRowState`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type MappingRowState = 'neutral' | 'valid' | 'invalid' | 'stale';

export interface MappingRowInputs {
  collides: boolean;
  confidence: 'exact' | 'likely' | 'weak' | null;
  checked: { unrecognised: number } | null;
  stale: boolean;
}

/** One mapping row's status, as arithmetic. Holds no React state and no copy, so it can be tested
 *  as a table the way `stepModel.ts` is.
 *
 *  ⛔ ORDER MATTERS AND IT IS NOT ARBITRARY. A collision outranks everything: the map cannot be sent
 *  at all while one stands, so a green tick beside it would be a lie the operator acts on. Stale
 *  outranks a stored result, because that result describes a mapping that no longer exists. Only
 *  then does a recorded check, or an exact suggestion, get to speak. */
export function mappingRowState({ collides, confidence, checked, stale }: MappingRowInputs): MappingRowState {
  if (collides) return 'invalid';
  if (stale) return 'stale';
  if (checked) return checked.unrecognised > 0 ? 'invalid' : 'valid';
  if (confidence === 'exact') return 'valid';
  return 'neutral';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run, from `apps/studio`: `pnpm exec vitest run mappingRowState`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/mappingRowState.ts apps/studio/src/facilities/mappingRowState.test.ts
git commit -m "feat(facilities): a mapping row's status, as arithmetic"
```

---

### Task 4: The icon

**Files:**
- Create: `apps/studio/src/facilities/MappingRowStatus.tsx`
- Create: `apps/studio/src/facilities/MappingRowStatus.test.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: `MappingRowState` from Task 3.
- Produces: `<MappingRowStatus state={MappingRowState} label={string} busy={boolean} onCheck={() => void} detail={string | null} />`.
  `label` is the header this row is for, used to build the accessible name. `detail` is what the tooltip adds for an invalid row, for example "3 values are not recognised".

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { MappingRowStatus } from './MappingRowStatus';

describe('MappingRowStatus', () => {
  // The operator's decision: always clickable, so a re-check is never gated on the app agreeing
  // that something changed.
  it.each(['neutral', 'valid', 'invalid', 'stale'] as const)('is clickable in the %s state', (state) => {
    const onCheck = vi.fn();
    render(<MappingRowStatus state={state} label="Type" busy={false} detail={null} onCheck={onCheck} />);
    const button = screen.getByRole('button', { name: /Type/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('names its state in the accessible name, so the icon is not the only carrier', () => {
    render(<MappingRowStatus state="invalid" label="Type" busy={false} detail="3 values are not recognised" onCheck={vi.fn()} />);
    expect(screen.getByRole('button', { name: /not recognised/i })).toBeInTheDocument();
  });

  // Neutral and stale share a gray tick by the operator's own decision. The tooltip is what tells
  // them apart, so it has to differ even though the glyph does not.
  it('gives neutral and stale different words for the same glyph', () => {
    const { rerender } = render(<MappingRowStatus state="neutral" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    const neutral = screen.getByRole('button', { name: /Type/ }).getAttribute('aria-label');
    rerender(<MappingRowStatus state="stale" label="Type" busy={false} detail={null} onCheck={vi.fn()} />);
    const stale = screen.getByRole('button', { name: /Type/ }).getAttribute('aria-label');
    expect(neutral).not.toEqual(stale);
  });

  it('does not fire a second check while one is running', () => {
    const onCheck = vi.fn();
    render(<MappingRowStatus state="neutral" label="Type" busy detail={null} onCheck={onCheck} />);
    fireEvent.click(screen.getByRole('button', { name: /Type/ }));
    expect(onCheck).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run, from `apps/studio`: `pnpm exec vitest run MappingRowStatus`
Expected: FAIL, cannot resolve `./MappingRowStatus`.

- [ ] **Step 3: Write minimal implementation**

Use `Check` from lucide for the tick and `X` or `AlertCircle` for invalid, matching whatever the
studio already imports elsewhere. Colour with the existing tokens: `text-muted-foreground` for gray,
`text-emerald-600` for valid, `text-destructive` for invalid. Wrap in the shadcn `Button` with
`variant="ghost" size="icon"`, never a native button.

`busy` renders the spinner the studio already uses and makes the button a no-op, which is why the
test asserts the handler is not called rather than asserting the button is disabled: the operator's
decision is that it stays clickable, and a disabled control would contradict it visually.

i18n, under `facilities.import.columnMap`, in all three locales:

```ts
// en.ts
rowStatusNeutral: '{{header}}: not checked yet. Check this mapping',
rowStatusValid: '{{header}}: checked, nothing wrong. Check again',
rowStatusInvalid: '{{header}}: {{detail}}. Check again',
rowStatusStale: '{{header}}: changed since the last check. Check again',
rowStatusUnrecognised: '{{count}} value(s) are not recognised',
rowStatusCollides: 'another column already claims this field',
```

Translate all six into `fr.ts` and `pt.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run, from `apps/studio`: `pnpm exec vitest run MappingRowStatus src/i18n`
Expected: PASS, 7 icon tests plus parity.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/MappingRowStatus.tsx apps/studio/src/facilities/MappingRowStatus.test.tsx apps/studio/src/i18n
git commit -m "feat(facilities): a status icon for a mapping row"
```

---

### Task 5: The per-field check

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx`
- Modify: `apps/studio/src/facilities/ColumnMapStep.test.tsx`

**Interfaces:**
- Consumes: the route from Task 2, `mappingRowState` from Task 3, `MappingRowStatus` from Task 4.
- Produces: `readFacilityImportColumnValues(runId: string, header: string, limit?: number): Promise<FacilityImportColumnValues>` where
  `interface FacilityImportColumnValues { header: string; values: string[]; distinct: number; truncated: boolean }`.
  And `ColumnMapStepProps` gains `runId: string | null`, which is what makes a check possible at all.

- [ ] **Step 1: Add the api client**

```ts
export interface FacilityImportColumnValues {
  header: string;
  values: string[];
  distinct: number;
  /** `distinct` exceeded the cap, so `values` is a sample. A column with hundreds of distinct
   *  values is usually one that was mapped wrongly, and the row says so rather than listing them. */
  truncated: boolean;
}

export const readFacilityImportColumnValues = (
  runId: string,
  header: string,
  limit = 200,
): Promise<FacilityImportColumnValues> =>
  authFetch(
    `/api/facilities/import/runs/${encodeURIComponent(runId)}/columns/${encodeURIComponent(header)}/values?limit=${limit}`,
  ).then((r) => okJson<FacilityImportColumnValues>(r, 'read column values'));
```

- [ ] **Step 2: Write the failing test**

```tsx
it('checks one field on its own, and does not validate the whole register to do it', async () => {
  mocked(api.readFacilityImportColumnValues).mockResolvedValue({
    header: 'Type', values: ['Health Post', '1st Level Hospital'], distinct: 2, truncated: false,
  });
  mocked(api.suggestValueMappings).mockResolvedValue({
    values: [
      { value: 'Health Post', candidates: [{ target: 'health-post', display: null, score: 1, confidence: 'exact' }] },
      { value: '1st Level Hospital', candidates: [] },
    ],
    notValidated: false,
  });
  renderColumnMapStep({ runId: 'run-1', headers: ['Type'], value: { columns: { Type: 'level' }, constants: {}, extras: [] } });

  fireEvent.click(screen.getByRole('button', { name: /Type/ }));

  // The row reports what the check found, in the row.
  expect(await screen.findByText(/1 value\(s\) are not recognised/i)).toBeInTheDocument();
  // ⛔ AND THE REGISTER WAS NOT RE-VALIDATED. That is the whole point of the route this uses.
  expect(api.uploadFacilityImport).not.toHaveBeenCalled();
  expect(api.revalidateFacilityImportRun).not.toHaveBeenCalled();
});

it('says so when a column has more distinct values than a person should be asked to map', async () => {
  mocked(api.readFacilityImportColumnValues).mockResolvedValue({
    header: 'Name', values: ['a', 'b'], distinct: 3788, truncated: true,
  });
  renderColumnMapStep({ runId: 'run-1', headers: ['Name'], value: { columns: { Name: 'level' }, constants: {}, extras: [] } });

  fireEvent.click(screen.getByRole('button', { name: /Name/ }));

  expect(await screen.findByText(/3,?788 distinct/i)).toBeInTheDocument();
});
```

`renderColumnMapStep` above is illustrative. `ColumnMapStep.test.tsx` already has its own render
helper; find it and extend that rather than adding a second.

- [ ] **Step 3: Run test to verify it fails**

Run, from `apps/studio`: `pnpm exec vitest run ColumnMapStep`
Expected: FAIL, no button named for the header.

- [ ] **Step 4: Write minimal implementation**

Each row gets a `MappingRowStatus`. Its `state` comes from `mappingRowState`, fed by:
- `collides`: whether this header appears in the `collisions` array `ColumnMapStep` already computes.
- `confidence`: the ranker's confidence for the CURRENT target, from `suggestionByHeader`, or `null`
  when the operator picked something the ranker did not suggest.
- `checked`: this row's last check result, held in a `Map<string, { unrecognised: number }>` keyed by
  header.
- `stale`: whether this row's target changed since its check was recorded. Keep the target the check
  ran against beside the result and compare.

Clicking runs `readFacilityImportColumnValues(runId, header)`, then, only when the target is a
controlled field, `suggestValueMappings(target, values)`. Count the values whose top candidate is
absent or `weak` as unrecognised. A non-controlled target has no vocabulary to check, so its check
records `{ unrecognised: 0 }` and the row goes green.

A `truncated` result does not go green and does not list values. It reports the distinct count,
because a column with thousands of distinct values is almost always mapped to the wrong field, and
that is the finding.

Guard `runId === null`: before an upload there is nothing stored to read, so the icon renders in its
neutral state and the click reports that a check needs the file uploaded first. Add one i18n key for
that in all three locales.

- [ ] **Step 5: Run tests to verify they pass**

Run, from `apps/studio`: `pnpm exec vitest run ColumnMapStep src/i18n`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/facilities apps/studio/src/i18n
git commit -m "feat(facilities): check one mapping without validating the register"
```

---

### Task 6: The worklist moves into the row

**Files:**
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx`
- Modify: `apps/studio/src/facilities/ColumnMapStep.test.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing test**

```tsx
it('puts a controlled field\'s unrecognised values under the row that maps it', async () => {
  // A check on Type finds two values the vocabulary does not recognise. They belong under Type,
  // not in a separate box at the bottom that names a field the operator has to go and find.
  mocked(api.readFacilityImportColumnValues).mockResolvedValue({
    header: 'Type', values: ['1st Level Hospital', 'Others'], distinct: 2, truncated: false,
  });
  mocked(api.suggestValueMappings).mockResolvedValue({
    values: [
      { value: '1st Level Hospital', candidates: [] },
      { value: 'Others', candidates: [] },
    ],
    options: [{ code: 'health-post', display: 'Health Post' }],
    notValidated: false,
  });
  renderColumnMapStep({ runId: 'run-1', headers: ['Type'], value: { columns: { Type: 'level' }, constants: {}, extras: [] } });

  fireEvent.click(screen.getByRole('button', { name: /Type/ }));

  const row = (await screen.findByText('1st Level Hospital')).closest('[data-mapping-row="Type"]');
  expect(row).not.toBeNull();
  expect(within(row as HTMLElement).getByLabelText('1st Level Hospital')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run, from `apps/studio`: `pnpm exec vitest run ColumnMapStep`
Expected: FAIL, no element carries `data-mapping-row`.

- [ ] **Step 3: Write minimal implementation**

Give each row a wrapper carrying `data-mapping-row={header}`, and render the value pick-lists inside
it when that row's check found unrecognised values. Reuse `ValueMapPanel`'s existing per-value row:
the ranked candidates first in score order, then the rest of the value set sorted by
`sortValueSetOptions`, and `Not mapped` at the top. Do not rewrite that logic; lift it into a small
shared component both can use, or import it.

Saving a mapping stays the panel's existing `writeFacilityValueMappings` call and its toast.

In `ImportFacilitiesSheet.tsx`, stop rendering `ValueMapPanel` as its own block on step 3. Pass
`runId` into `ColumnMapStep`.

**Do not delete `ValueMapPanel.tsx` in this task.** Review sees the same values reported from
`ReconciliationSummary`, and its own tests still run. Deleting it is a separate decision once this is
proven on a real import.

- [ ] **Step 4: Run the studio suite**

Run, from `apps/studio`: `pnpm exec vitest run`, then `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: PASS. Tests that asserted the old separate panel now assert the inline rows; each one you
change gets a comment saying why it moved.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities apps/studio/src/i18n
git commit -m "feat(facilities): a field's unrecognised values sit under the field"
```

---

### Task 7: Docs, and the live run

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`

- [ ] **Step 1: Update the docs in all three languages**

Describe the status icon and its four states, that a 100% match goes green on its own, that clicking
checks that one field without re-checking the whole file, and that a field's unrecognised values now
appear under it. Use the word "step", not "stage": the UI's own label is "Import steps".

- [ ] **Step 2: Run the full gate**

Run from the repo root:
```bash
pnpm turbo run test --concurrency=2 --force > gate.txt 2>&1; echo $?
```
**Never pipe turbo through `tail`**: it truncates the failure list. Redirect, then read the file.
Use `--concurrency=2`: at 4 this repo's gate has hit tinypool "Worker exited unexpectedly" in
`bootstrap` and `dhis2` from resource exhaustion, with zero assertion failures. If that happens,
re-run the named package alone before blaming a change. Delete `gate.txt` afterwards.

- [ ] **Step 3: Live run**

Against the real Zambia MFL export, 3788 rows: check `Type`, confirm the row reports its
unrecognised levels without a full validate, map one, and confirm the row goes green on a re-check.
Confirm at 375x812 that the rows still stack and the icon is reachable.

**Say what was measured, or say it was not measured.** Nothing in this repository times a check.

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs
git commit -m "docs(facilities): the mapping step answers back"
```

---

## Self-Review

**Spec coverage.** Status icon and four states: Tasks 3 and 4. Always clickable: Task 4, tested per
state. 100% auto-green: Task 3. Neutral and stale share a glyph, told apart by tooltip: Task 4.
Worklist inline under its row: Task 6. Reuses the existing collision computation rather than
recomputing it: Task 5. The per-field check that does not validate the whole register: Tasks 1, 2, 5.

**Not covered, deliberately.** Slice C's cell editing. The flagged-rows jump in the rows route, which
Slice A deferred and which belongs with editing rather than here.

**Type consistency.** `ColumnValues` (Task 1) is the server's shape; `FacilityImportColumnValues`
(Task 5) is the wire shape and adds `header`. Task 2 is where one becomes the other.
`MappingRowState` and `MappingRowInputs` are named identically in Tasks 3, 4 and 5.

**Known limits to state in the report.** `pg-mem` is not Postgres. Headless Chromium cannot see the
`vh` versus `dvh` class of bug. And nothing here measures how long a check takes on a real register,
so Task 7 reports a measurement or reports its absence.
