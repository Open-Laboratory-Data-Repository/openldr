# Facility import Data stage (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source stores the file without validating it, a new Data stage shows the stored rows as a paged table, and the first validate moves to Mapping where the column map is known.

**Architecture:** The upload route gains a `validate=false` mode that mints the run in a new `stored` status and enqueues nothing. A new route pages rows out of the stored blob by streaming it, so a 64MB register is never buffered. The studio grows a fourth step between Source and Mapping that renders those rows through the existing `Table` and `TablePagination`. Mapping's primary action becomes the validate, carrying the column map through the re-validate route that already exists.

**Tech Stack:** Fastify, Kysely, `BlobStoragePort` (`packages/ports/src/blob.ts`), React 18, vitest, react-i18next.

**Spec:** `docs/superpowers/specs/2026-09-08-facility-import-data-stage-design.md`

## Global Constraints

- **No migration.** `facility_import_runs.status` is plain `text not null` with no CHECK constraint (`packages/db/src/migrations/internal/080_facility_import_runs.ts:32`). Adding `stored` is a code change only. Do not add a migration; a numbering gap blocks boot.
- **A `stored` run keeps `active_key` set** to its `national_system`, so the unique index `facility_import_runs_one_active` still admits one live run per register.
- **Never read the whole file into memory**, server side or client side. The blob is read with `getStream`, and the tab holds only the page on screen.
- **Pagination on every table, no exceptions** (`AGENTS.md` §5). The grid uses `TablePagination` from `components/ui/table-pagination.tsx`.
- **shadcn only.** No native `<select>`, `<button>`, `<input>` or `<table>` outside `components/ui/`.
- **i18n in en, fr and pt.** A missing key renders as literal braces. `apps/studio/src/i18n/{en,fr,pt}.ts`, and `src/i18n/parity.test.ts` enforces it.
- **No em dashes anywhere, and no emoji in headings or bullets** (`AGENTS.md` §1).
- **Server routes must `return reply.send(...)`**, never a bare `reply.send(...)`. `apps/server` is the only package with real lint and it enforces this.
- **The grid is desktop only**, a recorded §6 exception. Stages 1, 3 and 4 stay usable at 375px.

---

## File Structure

**Server**
- Modify `apps/server/src/facilities-routes.ts` — the upload route gains a `validate` query flag; a new `GET /api/facilities/import/runs/:id/rows` route.
- Modify `apps/server/src/facilities-routes.test.ts` — route tests.
- Create `packages/bootstrap/src/facility-file-rows.ts` — reads a window of rows out of a stream, CSV and JSONL. One responsibility: bytes in, rows out. No Fastify, no database.
- Create `packages/bootstrap/src/facility-file-rows.test.ts`.

**Studio**
- Modify `apps/studio/src/facilities/stepModel.ts` — four steps instead of three.
- Modify `apps/studio/src/facilities/stepModel.test.ts`.
- Modify `apps/studio/src/facilities/ImportSteps.tsx` — a fourth entry.
- Create `apps/studio/src/facilities/DataGridStep.tsx` — the grid. Owns fetching its own page, nothing else.
- Create `apps/studio/src/facilities/DataGridStep.test.tsx`.
- Modify `apps/studio/src/api.ts` — `readFacilityImportRows`, and `validate` on the upload client.
- Modify `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` — upload on leaving Source, render the Data step, Mapping's action becomes the validate.
- Modify `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`.
- Modify `apps/studio/src/i18n/{en,fr,pt}.ts`.

**Docs**
- Modify `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`.

---

### Task 1: Read a window of rows out of a file stream

**Files:**
- Create: `packages/bootstrap/src/facility-file-rows.ts`
- Test: `packages/bootstrap/src/facility-file-rows.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readFileRows(stream: Readable, opts: { format: 'csv' | 'jsonl'; offset: number; limit: number }): Promise<FileRowWindow>` where
  `interface FileRowWindow { headers: string[]; rows: string[][]; scanned: number; complete: boolean }`.
  `scanned` is how many data rows the stream yielded before the window closed. `complete` is true when the stream ended, which is the only way the caller can know the total.

- [ ] **Step 1: Write the failing test**

```ts
import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { readFileRows } from './facility-file-rows';

const streamOf = (s: string) => Readable.from([Buffer.from(s, 'utf8')]);

describe('readFileRows', () => {
  it('returns the header row and the requested window of a csv', async () => {
    const csv = 'code,name\r\n1,Alpha\r\n2,Beta\r\n3,Gamma\r\n';
    const w = await readFileRows(streamOf(csv), { format: 'csv', offset: 1, limit: 2 });
    expect(w.headers).toEqual(['code', 'name']);
    expect(w.rows).toEqual([['2', 'Beta'], ['3', 'Gamma']]);
    expect(w.complete).toBe(true);
    expect(w.scanned).toBe(3);
  });

  it('strips a utf-8 BOM so the first header is not \\ufeffcode', async () => {
    const w = await readFileRows(streamOf('﻿code,name\n1,Alpha\n'), { format: 'csv', offset: 0, limit: 10 });
    expect(w.headers).toEqual(['code', 'name']);
  });

  it('renders jsonl as the same table, keys in first-seen order', async () => {
    const jsonl = '{"code":"1","name":"Alpha"}\n{"name":"Beta","code":"2"}\n';
    const w = await readFileRows(streamOf(jsonl), { format: 'jsonl', offset: 0, limit: 10 });
    expect(w.headers).toEqual(['code', 'name']);
    expect(w.rows).toEqual([['1', 'Alpha'], ['2', 'Beta']]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/bootstrap test -- facility-file-rows`
Expected: FAIL, "Failed to resolve import ./facility-file-rows".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

export interface FileRowWindow {
  headers: string[];
  rows: string[][];
  /** Data rows the stream yielded before it ended or the window closed. */
  scanned: number;
  /** The stream ended, so `scanned` is the file's true row count. */
  complete: boolean;
}

export interface ReadFileRowsOptions {
  format: 'csv' | 'jsonl';
  offset: number;
  limit: number;
}

/** ⛔ NAIVE SPLIT ON `,`, deliberately, and the same call `suggest-map` already makes: a quoted
 *  header containing a comma splits wrongly. This is a VIEW of the file, never the authoritative
 *  parse, which stays `parseFacilityCsv`'s. Do not grow a second CSV parser here. */
const splitCsv = (line: string): string[] => line.split(',').map((c) => c.trim());

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export async function readFileRows(
  stream: Readable,
  { format, offset, limit }: ReadFileRowsOptions,
): Promise<FileRowWindow> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] = [];
  const rows: string[][] = [];
  let scanned = 0;
  let first = true;

  for await (const raw of rl) {
    const line = first ? stripBom(raw) : raw;
    if (line.trim() === '') { first = false; continue; }
    if (format === 'csv' && first) { headers = splitCsv(line); first = false; continue; }
    first = false;
    if (format === 'jsonl') {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
      if (scanned >= offset && rows.length < limit) {
        rows.push(headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))));
      }
    } else if (scanned >= offset && rows.length < limit) {
      rows.push(splitCsv(line));
    }
    scanned += 1;
  }
  rl.close();
  return { headers, rows, scanned, complete: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/bootstrap test -- facility-file-rows`
Expected: PASS, 3 tests.

- [ ] **Step 5: Export it from the package index**

Add to `packages/bootstrap/src/index.ts`, beside the other facility exports:

```ts
export { readFileRows, type FileRowWindow, type ReadFileRowsOptions } from './facility-file-rows';
```

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-file-rows.ts packages/bootstrap/src/facility-file-rows.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(facilities): read a window of rows out of a file stream"
```

---

### Task 2: The upload can store without validating

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (the `POST /api/facilities/import/upload` handler, around line 2530)
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `POST /api/facilities/import/upload?validate=false` mints a run with `status: 'stored'` and enqueues no job. Without the flag, behaviour is exactly as today.

- [ ] **Step 1: Write the failing test**

Add beside the other upload tests in `facilities-routes.test.ts`:

```ts
it('validate=false stores the file and enqueues nothing, so the run waits for a map', async () => {
  const { app, enqueued } = await appWithFacilityImport();
  const res = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/upload?nationalSystem=urn:zm:mfl&format=csv&validate=false',
    payload: 'code,name\n1,Alpha\n',
    headers: { 'content-type': 'text/csv' },
  });

  expect(res.statusCode).toBe(202);
  const body = res.json() as { runId: string };
  const run = await app.facilityImportRuns.get(body.runId);
  expect(run?.status).toBe('stored');
  // ⛔ NOTHING QUEUED. A stored run has no column map yet, so a validate now would refuse every
  // column as unrecognised, which is the screen this whole slice exists to retire.
  expect(enqueued).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- facilities-routes -t "validate=false"`
Expected: FAIL, run status is `queued` and one job was enqueued.

- [ ] **Step 3: Write minimal implementation**

In the upload handler, read the flag beside the other query parameters:

```ts
// ⛔ OPT-IN, so every existing caller (the CLI, any script) keeps upload-and-validate. Only the
// studio's Source step asks for a store, because only it has a Mapping step to supply the map
// later. See the spec's "Splitting the store from the validate".
const storeOnly = (req.query as { validate?: string }).validate === 'false';
```

Pass the status through to `startUpload`:

```ts
run = await importRuns.startUpload({
  nationalSystem,
  sourceFormat: format,
  blobKey: key,
  fileHash,
  byteSize,
  releaseVersion,
  status: storeOnly ? 'stored' : undefined,
  ...
});
```

Then guard the enqueue that follows it:

```ts
if (!storeOnly) {
  await ctx.jobs.enqueue({ kind: 'facility-import-validate', runId: run.id });
}
```

In `packages/db/src/facility-import-runs.ts`, `startUpload` takes an optional `status` defaulting to
what it uses today:

```ts
status: input.status ?? 'queued',
```

and its input type gains `status?: FacilityImportRunStatus`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- facilities-routes -t "validate=false"`
Expected: PASS.

- [ ] **Step 5: Run the whole route file, to prove the default path is untouched**

Run: `pnpm --filter @openldr/server test -- facilities-routes`
Expected: PASS, no regressions. An upload without the flag still reaches `queued` and enqueues one job.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts packages/db/src/facility-import-runs.ts
git commit -m "feat(facilities): an upload can store a file without validating it"
```

---

### Task 3: The rows route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `readFileRows` from Task 1; the `stored` status from Task 2.
- Produces: `GET /api/facilities/import/runs/:id/rows?offset=0&limit=100` returning
  `{ headers: string[]; rows: string[][]; offset: number; limit: number; total: number | null }`.
  `total` is `null` when the file was longer than the window scanned, and a number once the stream ended.

- [ ] **Step 1: Write the failing test**

```ts
it('pages rows out of the stored file, and reports the total once the stream ends', async () => {
  const { app } = await appWithFacilityImport();
  const upload = await app.inject({
    method: 'POST',
    url: '/api/facilities/import/upload?nationalSystem=urn:zm:mfl&format=csv&validate=false',
    payload: 'code,name\n1,Alpha\n2,Beta\n3,Gamma\n',
    headers: { 'content-type': 'text/csv' },
  });
  const { runId } = upload.json() as { runId: string };

  const res = await app.inject({ method: 'GET', url: `/api/facilities/import/runs/${runId}/rows?offset=1&limit=1` });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    headers: ['code', 'name'],
    rows: [['2', 'Beta']],
    offset: 1,
    limit: 1,
    total: 3,
  });
});

it('404s for a run that has no stored file', async () => {
  const { app } = await appWithFacilityImport();
  const res = await app.inject({ method: 'GET', url: '/api/facilities/import/runs/fir_missing/rows' });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/server test -- facilities-routes -t "pages rows"`
Expected: FAIL with 404, the route does not exist.

- [ ] **Step 3: Write minimal implementation**

Register beside the other `runs/:id` routes:

```ts
/** The stored file as a table, one window at a time.
 *
 *  ⛔ STREAMED, NEVER BUFFERED. `blobs.get` returns the whole object; a 64MB national register
 *  through it would put the file in the API's memory once per page request. `getStream` is what
 *  keeps this constant-memory, and `readFileRows` stops reading once its window is full only in the
 *  sense of collecting: it still drains the stream to learn the total. */
app.get('/api/facilities/import/runs/:id/rows', VIEW, async (req, reply) => {
  const { id } = req.params as { id: string };
  const q = req.query as { offset?: string; limit?: string };
  const offset = Math.max(0, Number.parseInt(q.offset ?? '0', 10) || 0);
  const limit = Math.min(500, Math.max(1, Number.parseInt(q.limit ?? '100', 10) || 100));

  const run = await importRuns.get(id);
  if (!run) { reply.code(404); return reply.send({ error: `import run not found: ${id}` }); }
  if (!run.blobKey) {
    reply.code(404);
    return reply.send({ error: `import run ${id} has no stored file` });
  }

  const stream = await ctx.blobs.getStream(run.blobKey);
  const window = await readFileRows(stream, {
    format: run.sourceFormat === 'jsonl' ? 'jsonl' : 'csv',
    offset,
    limit,
  });
  return reply.send({
    headers: window.headers,
    rows: window.rows,
    offset,
    limit,
    total: window.complete ? window.scanned : null,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/server test -- facilities-routes -t "rows"`
Expected: PASS, both tests.

- [ ] **Step 5: Run lint, which is real in this package**

Run: `pnpm --filter @openldr/server lint`
Expected: PASS. Every handler return above is `return reply.send(...)`, which is what the rule enforces.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): page the stored import file as rows"
```

---

### Task 4: Four steps instead of three

**Files:**
- Modify: `apps/studio/src/facilities/stepModel.ts`
- Modify: `apps/studio/src/facilities/stepModel.test.ts`
- Modify: `apps/studio/src/facilities/ImportSteps.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ImportStep = 1 | 2 | 3 | 4`, and `StepGate` gains `hasStoredFile: boolean`. Step 2 is Data, 3 is Mapping, 4 is Review.

- [ ] **Step 1: Write the failing test**

Add to `stepModel.test.ts`:

```ts
it('Data is earned by a stored file, and Mapping only after it', () => {
  const base = { hasFile: true, hasRegister: true, hasStoredFile: false, hasReview: false, runActive: false };
  expect(furthestStep(base)).toBe(1);
  expect(furthestStep({ ...base, hasStoredFile: true })).toBe(3);
  expect(furthestStep({ ...base, hasStoredFile: true, hasReview: true })).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- stepModel`
Expected: FAIL, `furthestStep` returns 2 for a stored file and the type rejects 4.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ImportStep = 1 | 2 | 3 | 4;

export interface StepGate {
  hasFile: boolean;
  hasRegister: boolean;
  /** The file is uploaded and sitting in blob storage, so the Data stage has rows to show and
   *  Mapping has something to map. Distinct from `hasFile`, which is only "the operator picked
   *  one in the browser". */
  hasStoredFile: boolean;
  hasReview: boolean;
  runActive: boolean;
}

export function furthestStep(gate: StepGate): ImportStep {
  if (!gate.hasFile || !gate.hasRegister) return 1;
  if (!gate.hasStoredFile) return 1;
  return gate.hasReview ? 4 : 3;
}
```

`clampStep` and `canGoBack` are unchanged: both are written against `ImportStep` generically.

In `ImportSteps.tsx`, add the entry:

```ts
const STEPS: { step: ImportStep; key: string }[] = [
  { step: 1, key: 'facilities.import.steps.source' },
  { step: 2, key: 'facilities.import.steps.data' },
  { step: 3, key: 'facilities.import.steps.mapping' },
  { step: 4, key: 'facilities.import.steps.review' },
];
```

i18n, beside the existing `steps` entries:

```ts
// en.ts
data: 'Data',
// fr.ts
data: 'Données',
// pt.ts
data: 'Dados',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- stepModel src/i18n`
Expected: PASS, including `parity.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/facilities/stepModel.ts apps/studio/src/facilities/stepModel.test.ts apps/studio/src/facilities/ImportSteps.tsx apps/studio/src/i18n
git commit -m "feat(facilities): a Data step between Source and Mapping"
```

---

### Task 5: The grid

**Files:**
- Create: `apps/studio/src/facilities/DataGridStep.tsx`
- Create: `apps/studio/src/facilities/DataGridStep.test.tsx`
- Modify: `apps/studio/src/api.ts`

**Interfaces:**
- Consumes: the rows route from Task 3.
- Produces: `readFacilityImportRows(runId: string, p: { offset: number; limit: number }): Promise<FacilityImportRows>` in `api.ts`, where
  `interface FacilityImportRows { headers: string[]; rows: string[][]; offset: number; limit: number; total: number | null }`.
  And `<DataGridStep runId={string} />`.

- [ ] **Step 1: Add the api client**

In `api.ts`, beside the other facility import calls:

```ts
export interface FacilityImportRows {
  headers: string[];
  rows: string[][];
  offset: number;
  limit: number;
  /** `null` while the file is longer than what has been scanned, so the pager shows a count it
   *  cannot yet total. */
  total: number | null;
}

export const readFacilityImportRows = (
  runId: string,
  p: { offset: number; limit: number },
): Promise<FacilityImportRows> =>
  authFetch(`/api/facilities/import/runs/${encodeURIComponent(runId)}/rows?offset=${p.offset}&limit=${p.limit}`)
    .then((r) => okJson<FacilityImportRows>(r, 'read import rows'));
```

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, readFacilityImportRows: vi.fn() };
});

import * as api from '@/api';
import { DataGridStep } from './DataGridStep';

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['MFL Code', 'Name'],
    rows: [['100001', 'Chunga Clinic'], ['100002', 'Ngwerere Health Post']],
    offset: 0, limit: 100, total: 3788,
  });
});

describe('DataGridStep', () => {
  it('renders the file as a table with its own header row', async () => {
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText('Chunga Clinic')).toBeInTheDocument();
    expect(screen.getByText('MFL Code')).toBeInTheDocument();
  });

  // ⛔ AGENTS.md §5: every table gets TablePagination, no exceptions.
  it('pages, and asks the server for the next window rather than filtering locally', async () => {
    render(<DataGridStep runId="fir_1" />);
    await screen.findByText('Chunga Clinic');
    await waitFor(() => expect(api.readFacilityImportRows).toHaveBeenCalledWith('fir_1', { offset: 0, limit: 100 }));
    expect(screen.getByText(/1.*100.*3,?788/)).toBeInTheDocument();
  });

  it('says so when the file could not be read, instead of an empty table', async () => {
    mocked(api.readFacilityImportRows).mockRejectedValue(new Error('no stored file'));
    render(<DataGridStep runId="fir_1" />);
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- DataGridStep`
Expected: FAIL, cannot resolve `./DataGridStep`.

- [ ] **Step 4: Write minimal implementation**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { LoadingState } from '@/components/ui/spinner';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { readFacilityImportRows, type FacilityImportRows } from '@/api';

export interface DataGridStepProps {
  /** The stored run whose file this shows. */
  runId: string;
}

/** The uploaded file as a table, read only, one page at a time.
 *
 *  ⛔ IT FETCHES ITS OWN PAGE. The sheet holds no rows, which is the point: a 64MB register must
 *  never enter this tab. Only the window on screen is ever in memory here.
 *
 *  ⛔ READ ONLY, and that is not a placeholder for Slice C. Nothing has been mapped yet at this
 *  stage, so there is no contract field to validate a cell against and no way to tell a bad value
 *  from an unfamiliar one. Editing arrives with Mapping, where a target field exists. */
export function DataGridStep({ runId }: DataGridStepProps): JSX.Element {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [data, setData] = useState<FacilityImportRows | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    readFacilityImportRows(runId, { offset: page * pageSize, limit: pageSize })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [runId, page, pageSize]);

  if (failed) {
    return <p className="mx-6 mt-4 text-sm text-destructive">{t('facilities.import.rowsFailed')}</p>;
  }
  if (!data) return <LoadingState />;
  if (data.headers.length === 0) {
    return <StripedEmpty className="min-h-[16rem]">{t('facilities.import.rowsEmpty')}</StripedEmpty>;
  }

  return (
    <div className="mx-6 mt-4 flex min-h-0 flex-1 flex-col">
      <Table wrapperClassName="min-h-0 flex-1">
        <TableHeader>
          <TableRow>
            {data.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row, i) => (
            <TableRow key={data.offset + i}>
              {data.headers.map((h, c) => <TableCell key={h}>{row[c] ?? ''}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={data.total ?? data.offset + data.rows.length}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
      />
    </div>
  );
}

export default DataGridStep;
```

i18n, in all three files under `facilities.import`:

```ts
// en.ts
rowsFailed: 'The file could not be read. Check the connection and open this step again.',
rowsEmpty: 'This file has no rows.',
// fr.ts
rowsFailed: 'Le fichier n’a pas pu être lu. Vérifiez la connexion et rouvrez cette étape.',
rowsEmpty: 'Ce fichier ne contient aucune ligne.',
// pt.ts
rowsFailed: 'Não foi possível ler o ficheiro. Verifique a ligação e abra este passo de novo.',
rowsEmpty: 'Este ficheiro não tem linhas.',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @openldr/studio test -- DataGridStep src/i18n`
Expected: PASS, 3 grid tests plus parity.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities/DataGridStep.tsx apps/studio/src/facilities/DataGridStep.test.tsx apps/studio/src/api.ts apps/studio/src/i18n
git commit -m "feat(facilities): the uploaded file as a paged table"
```

---

### Task 6: Wire the sheet

**Files:**
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

**Interfaces:**
- Consumes: `DataGridStep` (Task 5), the four-step model (Task 4), `validate=false` (Task 2).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

```tsx
it('Source uploads and stores, then lands on Data with the file on screen', async () => {
  mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-a' });
  mocked(api.readFacilityImportRows).mockResolvedValue({
    headers: ['MFL Code', 'Name'], rows: [['100001', 'Chunga Clinic']], offset: 0, limit: 100, total: 1,
  });
  render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

  await pickFileAndSystem('MFL Code,Name\n100001,Chunga Clinic\n');
  fireEvent.click(screen.getByRole('button', { name: 'Upload and continue' }));

  // ⛔ STORED, NOT VALIDATED. A validate now would have no column map and would refuse every column.
  await waitFor(() => expect(api.uploadFacilityImport).toHaveBeenCalledWith(
    expect.objectContaining({ validate: false }), expect.any(Function),
  ));
  expect(await screen.findByText('Chunga Clinic')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/studio test -- ImportFacilitiesSheet -t "Source uploads and stores"`
Expected: FAIL, there is no button named `Upload and continue`.

- [ ] **Step 3: Write minimal implementation**

Source's primary action becomes the upload. Replace step 1's Continue handler so it uploads and then
advances, and pass the new flag:

```tsx
{step === 1 && !needsRegister && (
  <Button
    size="sm"
    disabled={!stepGate.hasFile || !stepGate.hasRegister || noHeaderRow || uploading}
    onClick={() => { void handleStoreAndContinue(); }}
  >
    {uploading ? uploadLabel : t('facilities.import.uploadAndContinueAction')}
  </Button>
)}
```

```tsx
/** Source's action. Stores the file and moves to Data. The column map is NOT sent: it does not
 *  exist yet, and the validate that needs it happens from Mapping. */
const handleStoreAndContinue = async (): Promise<void> => {
  const runId = await handleUpload({ validate: false });
  if (runId) setRequestedStep(2);
};
```

`handleUpload` takes the flag and forwards it to `uploadFacilityImport`, returning the run id.

Render the grid on the new step 2, and move every `step === 2` block that is about mapping to
`step === 3`, and every `step === 3` block to `step === 4`:

```tsx
{step === 2 && runId && <DataGridStep runId={runId} />}
```

Mapping's action becomes the validate, through the re-validate route that already exists:

```tsx
{step === 3 && (
  <Button size="sm" disabled={validating} onClick={() => { void handleValidate(); }}>
    {t('facilities.import.validateAllAction')}
  </Button>
)}
```

`stepGate` gains `hasStoredFile: runId !== null`.

i18n in all three files:

```ts
// en.ts
uploadAndContinueAction: 'Upload and continue',
validateAllAction: 'Validate all',
// fr.ts
uploadAndContinueAction: 'Envoyer et continuer',
validateAllAction: 'Tout valider',
// pt.ts
uploadAndContinueAction: 'Enviar e continuar',
validateAllAction: 'Validar tudo',
```

- [ ] **Step 4: Run the whole sheet suite**

Run: `pnpm --filter @openldr/studio test -- ImportFacilitiesSheet`
Expected: PASS. Existing tests that click `Upload and validate` on Mapping now click `Validate all`;
update their queries, and say in each comment why the label moved.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @openldr/studio exec tsc --noEmit -p tsconfig.json`
Expected: clean. The `ImportStep` widening surfaces every place that assumed three steps.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/facilities apps/studio/src/i18n
git commit -m "feat(facilities): Source stores the file and Data shows it"
```

---

### Task 7: Docs, and the live run

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`

- [ ] **Step 1: Update the step description in all three languages**

The docs currently describe three steps and say each step shows one button. Replace that passage with
the four stages, and say plainly that the file is uploaded when leaving Source and validated from
Mapping. Do not describe the grid as editable: it is not, in this slice.

- [ ] **Step 2: Run the full gate**

Run: `pnpm turbo run test --concurrency=4 --force > /tmp/gate.txt 2>&1; echo $?`
Expected: 0, 35 of 35 tasks. **Never pipe turbo through `tail`**: it truncates the failure list.
A failure is usually a timeout, so grep for `Test timed out` and re-run that package alone before
blaming a change.

- [ ] **Step 3: Live run against the real export**

Bring up the dev stack, upload `mfl_facilities_export20260810155748.csv` (3788 rows, 641KB), and
confirm: Source stores it and lands on Data; the grid shows the first 100 rows with the file's own 21
headers; paging to the last page works; the API's memory does not grow with page count.

**This is a performance claim and no test in this repository measures one.** Report what was measured
in a real browser, or report that it was not measured. Do not write "fast".

- [ ] **Step 4: Commit**

```bash
git add apps/studio/src/docs
git commit -m "docs(facilities): four stages, and where the upload happens"
```

---

## Self-Review

**Spec coverage.** Source stores rather than validates: Tasks 2 and 6. The `stored` status without a
migration: Task 2, against the Global Constraints. Paged read over the stored blob: Tasks 1 and 3.
JSONL renders as the same table: Task 1. Grid read only: Task 5. Four stages: Task 4. Validate moves
to Mapping: Task 6. Docs: Task 7.

**Not covered here, and deliberately.** The flagged-rows jump, which the spec puts in the paged read,
belongs with Slice B: nothing has been validated yet at this stage, so there are no flagged rows to
jump to. The spec should be read as putting that capability in the route by the time Slice B needs
it, not in Slice A. Raise it with the operator rather than building it now.

**Type consistency.** `FileRowWindow` (Task 1) is the server's shape; `FacilityImportRows` (Task 5)
is the wire shape and adds `offset`, `limit` and `total` while dropping `scanned` and `complete`.
That is deliberate, and Task 3 is where one becomes the other. `readFacilityImportRows` is named
identically in Tasks 5 and 6.

**Known limits to state in the report.** `pg-mem` is not Postgres, so any ordering added here is
unproven offline. Headless Chromium cannot see the `vh` versus `dvh` class of bug, so any
bottom-anchored change needs a real phone. And the grid is desktop only by a recorded §6 exception.
