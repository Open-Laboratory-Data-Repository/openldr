# A column map is the decision (slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a column map is present, carry an unmapped column into the record's `extras` instead of refusing the file, so an operator who maps five of twenty columns is not asked about the other fifteen.

**Architecture:** One condition changes in `parseFacilityCsv`, and everything downstream follows from it, because `unknownColumns` and `blockedReason` are already reported by the parser and read rather than re-derived. The CLI has its own copy of the predicate and gets the same change. The studio only changes wording.

**Tech Stack:** TypeScript, vitest, pg-mem for store-level tests, React + i18next in the studio.

**Spec:** `docs/superpowers/specs/2026-09-06-facility-import-workflow-redesign-design.md`

## Global Constraints

- The NO-MAP path does not change. A file with no `columnMap` is still refused, still sets `blockedReason: 'unknown-columns'`, and still honours `allowUnknownColumns`. Every guard added on 2026-09-06 stays live for it.
- JSONL is untouched. `parseFacilityRelease` never blocked on unrecognised keys and `allowUnknownColumns` is a documented no-op there.
- Nothing may be silently discarded. That is the whole reason the refusal exists. Unmapped columns must land in `extras`, and a test must prove the values are actually there.
- i18n keys land in all three of `apps/studio/src/i18n/{en,fr,pt}.ts` in the same commit.
- No em dashes in new prose or copy. No emoji in headings or bullets.
- Do not touch the step shell, the pinned footer, or the Select primitive. Those shipped already.
- `pg-mem` is not Postgres and `apps/server` is the only package with real lint.

---

### Task 1: The parser rule

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts`
- Test: `packages/terminology/src/facility-csv.test.ts`

**Interfaces:**
- Produces: no signature change. `parseFacilityCsv` keeps reporting `unknownColumns`; what changes is whether a populated `unknownColumns` refuses the file.

- [ ] **Step 1: Write the failing tests**

Add to `facility-csv.test.ts`:

```ts
  // ── A column map is itself the decision about every column in the file. The operator's question
  // that retired the old behaviour: "what does the parser want with data that I will never use? If
  // csv had 20 columns and I only needed 5, why complain about the other 15?" ────────────────────

  describe('unrecognised columns, when a column map is present', () => {
    const FILE = 'MFL Code,Name,Beds,Ward Count\n1835,Namatindi RHC,250,4\n';
    const MAP = { columns: { 'MFL Code': 'national_code', Name: 'name' } };

    it('imports the file instead of refusing it', () => {
      const r = parseFacilityCsv(FILE, { nationalSystem: HFR, columnMap: MAP });
      expect(r.records).toHaveLength(1);
      expect(r.records[0].name).toBe('Namatindi RHC');
    });

    it('⛔ keeps the unmapped values rather than dropping them', () => {
      // The refusal exists because `parseTermsCsv` silently discarded columns and still reported
      // success. Relaxing the refusal must not reintroduce that: the data has to be somewhere.
      const r = parseFacilityCsv(FILE, { nationalSystem: HFR, columnMap: MAP });
      expect(r.records[0].extras).toEqual({ beds: '250', 'ward count': '4' });
    });

    it('still REPORTS them, so a caller can say what it kept', () => {
      const r = parseFacilityCsv(FILE, { nationalSystem: HFR, columnMap: MAP });
      expect(r.unknownColumns.sort()).toEqual(['beds', 'ward count']);
    });
  });

  describe('unrecognised columns, when there is NO column map', () => {
    // Unchanged, and deliberately so: with nothing to go on, the parser cannot tell "I do not want
    // this column" from "I forgot it", and refusing is the safe reading of that ambiguity.
    const FILE = 'national_code,name,beds\n100,Alpha,250\n';

    it('still refuses the file', () => {
      const r = parseFacilityCsv(FILE, { nationalSystem: HFR });
      expect(r.records).toEqual([]);
      expect(r.unknownColumns).toEqual(['beds']);
    });

    it('still honours the override', () => {
      const r = parseFacilityCsv(FILE, { nationalSystem: HFR, allowUnknownColumns: true });
      expect(r.records).toHaveLength(1);
      expect(r.records[0].extras).toEqual({ beds: '250' });
    });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd packages/terminology && npx vitest run src/facility-csv.test.ts`
Expected: the three "when a column map is present" tests FAIL. `records` is `[]` because the file is refused. The two no-map tests PASS already, and are there to pin that they keep passing.

- [ ] **Step 3: Change the refusal condition**

In `parseFacilityCsv`, find:

```ts
  if (unknownColumns.length > 0 && !opts.allowUnknownColumns) {
```

Replace with:

```ts
  // ⛔ A COLUMN MAP IS THE DECISION ABOUT EVERY COLUMN, so an unmapped one is not an open question.
  //
  // This refusal predates column maps. It exists because the sibling `parseTermsCsv` promises to
  // keep extra columns, keeps three, silently discards the rest, and still reports success, so an
  // import can lose half a file and say nothing. Refusing is the right reading of an unmapped header
  // when this parser has nothing else to go on, because it cannot otherwise tell "I looked at this
  // and do not want it" from "I forgot it".
  //
  // A map settles that. An operator who walked the headers and assigned five of them has said, by
  // doing so, that the other fifteen are not wanted. Refusing then argues with evidence already in
  // hand, and it cost the Zambia team a nine-column warning about columns they had deliberately
  // skipped. With a map, those columns go to `extras` below: nothing is lost, so the original
  // concern still holds, and nothing is asked, because it was already answered.
  //
  // `unknownColumns` stays POPULATED either way. It is a true statement about the file, and callers
  // render it as a refusal or as a note depending on this same condition.
  const refusedForUnknownColumns = unknownColumns.length > 0
    && !opts.allowUnknownColumns
    && opts.columnMap === undefined;
  if (refusedForUnknownColumns) {
```

- [ ] **Step 4: Confirm the extras loop already carries them, and change nothing**

Verified before this plan was written, so do not edit it. The loop reads:

```ts
      if (KNOWN.has(target) && !extrasOptIn.has(headers[i])) continue;
```

For an unmapped column, `effective` leaves `target` as the header's own lowercased name, which is not
a contract field, so `KNOWN.has(target)` is false and the row does not `continue`. The value already
lands in `extras` keyed by that header. The refusal in Step 3 was the only thing standing between the
file and this loop.

Your job here is to confirm that by running the test from Step 1 that asserts
`extras` equals `{ beds: '250', 'ward count': '4' }`. If it passes, this step is done and the loop is
untouched. If it does not, stop and report rather than editing the loop: something else changed.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd packages/terminology && npx vitest run src/facility-csv.test.ts`
Expected: all pass, including the two no-map tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/terminology/src/facility-csv.test.ts
git commit -m "feat(facilities): a column map is the decision about every column"
```

---

### Task 2: The blocked verdict follows the parser

`blockedReason: 'unknown-columns'` was added on 2026-09-06 so a confirm could not be a silent no-op. It must keep firing for the no-map case and stop firing for the map case.

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts`
- Test: `packages/bootstrap/src/facility-import.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('⛔ does NOT block when a column map decided the file', async () => {
    // The 2026-09-06 guard stays load-bearing for the no-map case (tested above). Here the map is
    // the decision, the rows parse, and a confirm is meaningful rather than a no-op.
    const deps = await buildDeps();
    const r = await importFacilities(deps, 'MFL Code,Name,Beds\n1835,Alpha,250\n', {
      nationalSystem: SYSTEM,
      columnMap: { columns: { 'MFL Code': 'national_code', Name: 'name' } },
      apply: true,
    });
    expect(r.blocked).toBe(false);
    expect(r.blockedReason).toBeNull();
    expect(r.parsed).toBe(1);
    expect(r.written.created).toBe(1);
    expect(r.unknownColumns).toEqual(['beds']);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/bootstrap && npx vitest run src/facility-import.test.ts -t "column map decided"`
Expected: FAIL, `blockedReason` is `'unknown-columns'` and `parsed` is 0.

- [ ] **Step 3: Make the verdict match the parse**

In `importFacilities`, `refusedForUnknownColumns` currently reads:

```ts
  const refusedForUnknownColumns =
    !isRelease && unknownColumns.length > 0 && !opts.allowUnknownColumns;
```

Add the same map term the parser now uses, and say why in one line:

```ts
  // Mirrors `parseFacilityCsv`'s own condition exactly. A map present means the file was not
  // refused, so reporting it as blocked would describe a refusal that did not happen.
  const refusedForUnknownColumns = !isRelease
    && unknownColumns.length > 0
    && !opts.allowUnknownColumns
    && opts.columnMap === undefined;
```

- [ ] **Step 4: Run the whole bootstrap file**

Run: `cd packages/bootstrap && npx vitest run src/facility-import.test.ts`
Expected: all pass. The existing no-map `'unknown-columns'` tests must be untouched and still green. If one of them now fails, it was relying on a map being present; read it before changing it and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "fix(facilities): the blocked verdict follows the parse it describes"
```

---

### Task 3: The CLI's own guard

The CLI does not read `blockedReason` for this case. It re-derives the predicate itself at `packages/cli/src/facilities.ts:355` and returns 1 before the `blocked` branch is ever reached. That copy needs the same rule or `openldr facilities import --column-map` will keep refusing files the HTTP door now accepts.

**Files:**
- Modify: `packages/cli/src/facilities.ts`
- Test: `packages/cli/src/facilities.test.ts`

- [ ] **Step 1: Write the failing test**

`--column-map` takes a PATH, and this suite mocks `node:fs`, so `mocks.readFileSync` has to answer
for both the CSV and the map. That shape is already used by the existing map tests around line 874;
this follows it.

```ts
  it('⛔ imports a mapped file whose extra columns are unmapped, instead of refusing it', async () => {
    // The CLI re-derives this predicate rather than reading `blockedReason`, so it needs the rule in
    // its own right. Without it the two doors disagree about the same file, which is the exact
    // failure the one-door work exists to remove.
    const map = { columns: { 'MFL Code': 'national_code', Name: 'name' } };
    mocks.readFileSync.mockImplementation((path: string) => (
      String(path).endsWith('.json')
        ? JSON.stringify(map)
        : 'MFL Code,Name,Beds\n1835,Alpha,250\n'
    ));
    mocks.importFacilities.mockResolvedValue({
      ...CLEAN_RESULT, parsed: 1, unknownColumns: ['beds'],
      written: { created: 1, updated: 0 }, blocked: false, blockedReason: null,
    });

    const code = await runFacilitiesImport('/some/file.csv', {
      nationalSystem: 'urn:tz:hfr', apply: true, json: false,
      columnMap: '/some/map.json',
    });

    expect(code).toBe(0);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).not.toMatch(/unrecognised column/i);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/cli && npx vitest run src/facilities.test.ts -t "instead of refusing it"`
Expected: FAIL with exit code 1 and the unrecognised-columns message on stderr.

- [ ] **Step 3: Add the map term to the CLI's copy**

At `packages/cli/src/facilities.ts:355`:

⚠ Use the PARSED local, not the raw option. `opts.columnMap` is a file PATH (`columnMap?: string`),
and the command reads it into a local `columnMap: FacilityColumnMap | undefined` around line 203. The
local is what was actually handed to the parser, so it is what this condition must agree with.

```ts
    // ⛔ THE SAME CONDITION `parseFacilityCsv` now uses, re-derived here because this branch returns
    // before `preview.blocked` is ever consulted. A map present means the parser did not refuse the
    // file, so refusing it here would make the CLI disagree with the HTTP door about the same file.
    const refusedForUnknownColumns =
      opts.format !== 'jsonl'
      && preview.unknownColumns.length > 0
      && !opts.allowUnknownColumns
      && columnMap === undefined;
```

- [ ] **Step 4: Run the CLI suite**

Run: `cd packages/cli && npx vitest run src/facilities.test.ts`
Expected: all pass, including the existing no-map refusal test.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/facilities.test.ts
git commit -m "fix(cli): a column map decides for the CLI door too"
```

---

### Task 4: The studio says what it kept

Two wording changes. No logic.

**Files:**
- Modify: `apps/studio/src/facilities/ColumnMapStep.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/facilities/ColumnMapStep.test.tsx`, `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`

- [ ] **Step 1: Add the i18n keys, all three languages**

`en.ts`, in `facilities.import.columnMap`, replace the `notMapped` value and add one key:

```ts
        notMapped: 'Keep as extra data',
```

`fr.ts`:

```ts
        notMapped: 'Conserver en donnée supplémentaire',
```

`pt.ts`:

```ts
        notMapped: 'Manter como dado extra',
```

Then in `facilities.import`, add the note that replaces the warning:

`en.ts`:

```ts
        keptAsExtraTitle: 'Kept as extra data',
        keptAsExtraBody: 'These columns are not contract fields, so each row keeps them as extra data: {{columns}}.',
```

`fr.ts`:

```ts
        keptAsExtraTitle: 'Conservées en données supplémentaires',
        keptAsExtraBody: 'Ces colonnes ne sont pas des champs du contrat, donc chaque ligne les conserve en données supplémentaires : {{columns}}.',
```

`pt.ts`:

```ts
        keptAsExtraTitle: 'Mantidas como dados extra',
        keptAsExtraBody: 'Estas colunas não são campos do contrato, por isso cada linha mantém-nas como dados extra: {{columns}}.',
```

- [ ] **Step 2: Write the failing tests**

In `ImportFacilitiesSheet.test.tsx`:

```ts
  it('⛔ reports kept columns as a note, not as a warning, when a map decided them', async () => {
    // The Zambia file listed nine columns the operator had deliberately skipped, in an amber box
    // saying "Nothing is imported unless you opt in below". With a map that is no longer true.
    mocked(api.suggestColumnMap).mockResolvedValueOnce({
      headers: ['MFL Code', 'Beds'],
      columns: [{ header: 'MFL Code', candidates: [] }, { header: 'Beds', candidates: [] }],
    });
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 1, create: 1, unknownColumns: ['beds'], blocked: false, blockedReason: null,
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/Kept as extra data/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is imported unless you opt in/i)).not.toBeInTheDocument();
  });

  it('still warns, and still offers the override, when NO map decided them', async () => {
    // The other half. With no map the file really is refused, and the amber box and its re-upload
    // are the only way through. Both must survive.
    mocked(api.suggestColumnMap).mockResolvedValueOnce({ headers: [], columns: [] });
    mocked(api.uploadFacilityImport).mockResolvedValue({ runId: 'run-b1' });
    mocked(api.getFacilityImportRun).mockResolvedValue(runView({
      status: 'awaiting_confirmation',
      summary: baseResult({
        parsed: 0, unknownColumns: ['beds'], blocked: true, blockedReason: 'unknown-columns',
      }),
    }));
    render(<ImportFacilitiesSheet open onOpenChange={vi.fn()} onImported={vi.fn()} />);

    await pickFileAndSystem();
    await uploadNow();

    expect(await screen.findByText(/Nothing is imported unless you opt in/i)).toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Re-upload keeping unrecognised columns' })).toBeInTheDocument();
  });
```

In `ColumnMapStep.test.tsx`, update every assertion that expects the literal string `Not mapped` to expect `Keep as extra data`, and add a one-line comment on each saying the label changed because that is now what the option does. Do not weaken any assertion.

- [ ] **Step 3: Run them and watch them fail**

Run: `cd apps/studio && npx vitest run src/facilities/`
Expected: the two new sheet tests fail, plus every `Not mapped` assertion you have not yet updated.

- [ ] **Step 4: Split the unrecognised-columns block by whether it blocked**

In `ImportFacilitiesSheet.tsx`, the block currently renders whenever `result.unknownColumns.length > 0`. Gate the existing amber warning on the summary actually being blocked for it, and render the new neutral note otherwise. Use the sheet's existing `blockedReason` reading rather than re-deriving anything. Keep the JSONL branch exactly as it is.

- [ ] **Step 5: Run the studio suite**

Run: `cd apps/studio && npx tsc --noEmit -p tsconfig.json && npx vitest run --no-file-parallelism`
Expected: tsc exit 0 and all tests pass. A failure in an unrelated file reading `Test timed out in 5000ms` is load, not a regression: re-run that file alone before blaming this change.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src
git commit -m "feat(facilities): say what was kept instead of warning about it"
```

---

### Task 5: Docs, the gate, and the merge

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`
- Modify: `apps/web/src/docs/0.1.0/facilities.md`

- [ ] **Step 1: Rewrite the unrecognised-columns guidance, all three languages**

Each `facilities.md` currently tells the operator that an unrecognised column stops the whole file and that they must re-upload with an override. With a column map that is no longer true, and leaving it would be worse than saying nothing.

State both cases plainly: with a column map, a column you did not map is kept as extra data and the import proceeds; with no column map at all, an unrecognised column still stops the file, because nothing has told the importer whether you wanted it.

Say that unmapped columns are kept, not discarded, so the reader knows where the data went.

Keep the passthrough note, the bulk-delete section and the three-step description exactly as they are.

- [ ] **Step 2: Update the web docs**

`apps/web/src/docs/0.1.0/facilities.md`: state the same rule in API terms, including that `blockedReason: "unknown-columns"` is now only reachable without a `columnMap`.

- [ ] **Step 3: Run the gate across every package this touched**

```bash
cd packages/terminology && npx vitest run
cd ../bootstrap && npx vitest run --no-file-parallelism
cd ../cli && npx vitest run --no-file-parallelism
cd ../../apps/server && npm run lint && npx vitest run --no-file-parallelism
cd ../studio && npx tsc --noEmit -p tsconfig.json && npx vitest run --no-file-parallelism
```

Report real counts. Load timeouts are not regressions; re-run the file alone to tell them apart.

- [ ] **Step 4: Verify against the real file**

The Zambia export at `D:/Projects/Repositories/corlix/fixtures/mfl_facilities_export20260810155748.csv` has 21 columns, nine of which the operator deliberately skipped. Upload it with a column map covering the ones they wanted and confirm three things: no unrecognised-columns warning, the rows parse, and the nine skipped columns are present in a written row's `extras`.

That last one is the point of the whole slice. Do not skip it.

- [ ] **Step 5: Commit, merge, changelog**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs(facilities): a column map decides what happens to every column"
git checkout main
git merge --no-ff <branch> -m "merge: a column map is the decision"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```

---

## Out of scope

- The step shell, the pinned footer and the Select fix. All shipped.
- The value-mapping Save affordance, the re-validate route and sonner feedback. That is slice 4.
- Removing the inline Preview door. That is slice 2, and it is still pending.
- Any "drop this column" option. The parser has none, and inventing one in the UI would be a new lie.
