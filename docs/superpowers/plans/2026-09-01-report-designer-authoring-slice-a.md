# Report Designer Authoring Catch-up, Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every schema field the PDF engine honors becomes authorable in the studio UI: cellgrid insert and config, the flow fields, keyvalue stat layout, transpose, sortBy and headerRow.

**Architecture:** UI-only slice. All work lands in `apps/studio/src/report-designer/` (PropertiesTab, DataTab, model) plus i18n. The renderer, schema and server do not change. Every new control writes an existing schema field.

**Tech Stack:** React, shadcn components, vitest plus testing-library, i18next (en, fr, pt parity enforced by `src/i18n/parity.test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-01-report-designer-authoring-catchup-design.md` (Slice A section).

## Global Constraints

- shadcn components only, never native elements (AGENTS.md §5).
- Every user-visible string is an i18n key present in en, fr AND pt, or it renders as literal braces (AGENTS.md §6.3). `EnShape` parity makes tsc fail on a missing key.
- Radix Select refuses `value=""`; use a `__none__` sentinel (DataTab.tsx:28 convention).
- Clearing an optional schema field deletes the key (the `setStatusKey` idiom, DataTab.tsx:243), never stores `undefined` explicitly in arrays; top-level `updateElement` merges drop `undefined` at JSON time, which is acceptable for element-level fields.
- Patch opts: one-shot choices (Select, Checkbox) pass `{ discrete: true }`; typed text coalesces (no opts). Number inputs clamp on blur, never per keystroke.
- jsdom PointerEvent polyfill makes Radix menus open on pointerDown; menu tests guard the follow-up keyDown (see repo pattern in CanvasHeader.test.tsx).
- Test gate: `pnpm turbo run test --concurrency=4`, never piped through `tail`. A failure is usually a timeout; re-run the package alone before blaming the change.
- Commit per task to the feature branch. No `Co-Authored-By` trailers.

## File Structure

- Modify `apps/studio/src/report-designer/model.ts`: ELEMENT_KINDS, cellgrid default, new pure helper `flowTargets`.
- Modify `apps/studio/src/report-designer/PropertiesTab.tsx`: FlowSection component, stat layout item, transpose controls, cellgrid KindControls branch.
- Modify `apps/studio/src/report-designer/DataTab.tsx`: bindable cellgrid, sortBy input, headerRow checkbox, transpose-aware column list.
- Modify `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`: new `reportDesigner.*` keys.
- Tests beside each file, mirroring the existing `*.test.tsx` siblings.

Work on branch `feat/report-designer-authoring-slice-a`, merged to local `main` with `--no-ff` when done.

---

### Task 0: Branch and baseline

- [ ] **Step 1: Create the branch**

```bash
cd D:/Projects/Repositories/openldr_ce
git checkout -b feat/report-designer-authoring-slice-a
```

- [ ] **Step 2: Baseline the studio suite**

Run: `pnpm --filter @openldr/studio test 2>&1 | tail -5` is FORBIDDEN (tail hides failures). Run: `pnpm --filter @openldr/studio test`
Expected: green, except the known vitest dedupe flake (`studio-test-vitest-dedupe-flake` memory). Note the passing count for later comparison.

### Task 1: Cellgrid in the Insert menu

**Files:**
- Modify: `apps/studio/src/report-designer/model.ts:20` (ELEMENT_KINDS) and `model.ts:30` (newElement)
- Test: `apps/studio/src/report-designer/model.test.ts` (exists; if it does not, create it beside model.ts with the vitest imports its siblings use)
- Test: `apps/studio/src/report-designer/CanvasHeader.test.tsx` (extend the Insert submenu test)

**Interfaces:**
- Produces: `newElement('cellgrid')` returns `{ id, kind: 'cellgrid', name: 'Cell grid', rect: { x: 48, y: 48, w: 480, h: 160 }, cellColumns: ['c1','c2','c3','c4','c5'], palette: { ramp: 'blue', steps: 1 } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// model.test.ts
it('includes cellgrid in the insert palette', () => {
  expect(ELEMENT_KINDS).toContain('cellgrid');
});
it('creates a cellgrid with declared cells and a binary palette', () => {
  const el = newElement('cellgrid');
  expect(el.kind).toBe('cellgrid');
  expect(el.cellColumns).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  expect(el.palette).toEqual({ ramp: 'blue', steps: 1 });
});
```

- [ ] **Step 2: Run to verify they fail** (`pnpm --filter @openldr/studio test -- model.test`)

- [ ] **Step 3: Implement**

In `ELEMENT_KINDS` append `'cellgrid'` after `'datetime'` and REPLACE the stale exclusion comment at model.ts:14-19 with one sentence: config is now authorable in Properties, so inserting one is no longer useless. In `newElement`, before the final return:

```ts
if (kind === 'cellgrid') return {
  id, kind, name, rect: { x: 48, y: 48, w: 480, h: 160 },
  cellColumns: ['c1', 'c2', 'c3', 'c4', 'c5'],
  palette: { ramp: 'blue', steps: 1 },
};
```

- [ ] **Step 4: Extend the CanvasHeader Insert test** to assert a `Cell grid` menu item renders (copy the existing per-kind item assertion; check `reportDesigner.element.cellgrid` already exists in en.ts, it does if LayersTab shows seeded cellgrids; if missing, add it in all three languages here, not in Task 6).

- [ ] **Step 5: Run both test files, expect PASS, then commit**

```bash
git add apps/studio/src/report-designer/model.ts apps/studio/src/report-designer/model.test.ts apps/studio/src/report-designer/CanvasHeader.test.tsx
git commit -m "feat(studio): cell grid is insertable in the report designer"
```

### Task 2: Flow target helper in the model

**Files:**
- Modify: `apps/studio/src/report-designer/model.ts`
- Test: `apps/studio/src/report-designer/model.test.ts`

**Interfaces:**
- Produces: `flowTargets(elements: DesignElement[], forId: string): DesignElement[]`. Returns the elements a Place-below Select may offer: same array minus the element itself, minus any element whose own `flowAfter` chain reaches `forId` (offering it would let the author close a cycle, which the renderer answers by throwing, schema.ts:212).

- [ ] **Step 1: Write the failing tests**

```ts
const el = (id: string, flowAfter?: string): DesignElement =>
  ({ id, kind: 'text', name: id, rect: { x: 0, y: 0, w: 10, h: 10 }, ...(flowAfter ? { flowAfter } : {}) });

it('offers every other element when no chains exist', () => {
  const els = [el('a'), el('b'), el('c')];
  expect(flowTargets(els, 'a').map((e) => e.id)).toEqual(['b', 'c']);
});
it('never offers the element itself', () => {
  expect(flowTargets([el('a')], 'a')).toEqual([]);
});
it('excludes an element whose chain already reaches me', () => {
  // b follows a; offering b to a would make a -> b -> a
  const els = [el('a'), el('b', 'a'), el('c', 'b')];
  expect(flowTargets(els, 'a').map((e) => e.id)).toEqual([]);
  expect(flowTargets(els, 'c').map((e) => e.id)).toEqual(['a', 'b']);
});
it('tolerates a dangling flowAfter without looping', () => {
  const els = [el('a'), el('b', 'ghost')];
  expect(flowTargets(els, 'a').map((e) => e.id)).toEqual(['b']);
});
```

- [ ] **Step 2: Run, verify FAIL** (`flowTargets is not a function`)

- [ ] **Step 3: Implement in model.ts**

```ts
/** Elements a Place-below Select may offer `forId`. Excludes the element itself and any element
 *  whose own `flowAfter` chain reaches `forId`: the renderer THROWS on a cycle (schema.ts), so the
 *  UI must not offer one. A dangling reference ends the walk; a visited set guards data that
 *  already contains a cycle. */
export function flowTargets(elements: DesignElement[], forId: string): DesignElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const reachesMe = (start: DesignElement): boolean => {
    const seen = new Set<string>();
    let cur: DesignElement | undefined = start;
    while (cur?.flowAfter) {
      if (cur.flowAfter === forId) return true;
      if (seen.has(cur.flowAfter)) return false;
      seen.add(cur.flowAfter);
      cur = byId.get(cur.flowAfter);
    }
    return false;
  };
  return elements.filter((e) => e.id !== forId && !reachesMe(e));
}
```

- [ ] **Step 4: Run, expect PASS. Commit** (`feat(studio): pure flow-target picker that cannot offer a cycle`)

### Task 3: Flow section in the Properties tab

**Files:**
- Modify: `apps/studio/src/report-designer/PropertiesTab.tsx` (new `FlowSection`, rendered for the single-selection case between KindControls and Position, PropertiesTab.tsx:491)
- Test: `apps/studio/src/report-designer/PropertiesTab.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

**Interfaces:**
- Consumes: `flowTargets` from Task 2. `PropertiesTab` already receives `template` and `onPatchElement`.
- Produces: controls writing `flowAfter`, `flowGap`, `showOn`, `showWithTable`, `fillTo`.

- [ ] **Step 1: Write the failing tests** (mirror the existing PropertiesTab test harness: render with a template fixture, select one element, assert controls and the patch calls)

```tsx
it('writes flowAfter from the Place below select and clears it to undefined', async () => {
  // template with elements a (text, selected), b (table)
  // open the select, choose b's name; expect onPatchElement('a', { flowAfter: 'b' }, { discrete: true })
  // choose None; expect onPatchElement('a', { flowAfter: undefined, flowGap: undefined }, { discrete: true })
});
it('disables Gap after until Place below is set', () => {});
it('writes showOn first-chunk from the First page only checkbox', () => {});
it('offers only table and cellgrid elements in Show with', () => {});
it('shows Fill to bottom only for a cellgrid and writes fillTo', () => {});
it('does not offer an element that would close a flow cycle', () => {});
```

Write them as real tests with the fixture idioms already in the file (build a `ReportTemplate` literal, `fireEvent.pointerDown` for Radix selects per the jsdom note). Each asserts the exact patch payload.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `FlowSection`**

```tsx
const NONE_FLOW = '__none__';

function FlowSection({ template, el, onPatch }: {
  template: ReportTemplate; el: DesignElement;
  onPatch(patch: Partial<DesignElement>, opts?: PatchOpts): void;
}): JSX.Element {
  const { t } = useTranslation();
  const page = template.pages.find((p) => p.elements.some((e) => e.id === el.id));
  const siblings = page?.elements ?? [];
  const targets = flowTargets(siblings, el.id);
  const anchors = siblings.filter((e) => e.id !== el.id && (e.kind === 'table' || e.kind === 'cellgrid'));
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.flow')}</div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.placeBelow')}</div>
        <Select value={el.flowAfter ?? NONE_FLOW}
          onValueChange={(v) => onPatch(v === NONE_FLOW ? { flowAfter: undefined, flowGap: undefined } : { flowAfter: v }, { discrete: true })}>
          <SelectTrigger aria-label={t('reportDesigner.placeBelow')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_FLOW}>{t('reportDesigner.none')}</SelectItem>
            {targets.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {el.flowAfter && (
        <NumberField label={t('reportDesigner.flowGap')} value={el.flowGap ?? 0}
          onChange={(n) => onPatch({ flowGap: Math.max(0, n) })} min={0} />
      )}
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Checkbox aria-label={t('reportDesigner.firstPageOnly')} checked={el.showOn === 'first-chunk'}
          onCheckedChange={(v) => onPatch({ showOn: v === true ? 'first-chunk' : undefined }, { discrete: true })} />
        {t('reportDesigner.firstPageOnly')}
      </label>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.showWith')}</div>
        <Select value={el.showWithTable ?? NONE_FLOW}
          onValueChange={(v) => onPatch({ showWithTable: v === NONE_FLOW ? undefined : v }, { discrete: true })}>
          <SelectTrigger aria-label={t('reportDesigner.showWith')} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_FLOW}>{t('reportDesigner.none')}</SelectItem>
            {anchors.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {el.kind === 'cellgrid' && (
        <label className="flex items-center gap-2 text-xs text-foreground">
          <Checkbox aria-label={t('reportDesigner.fillToBottom')} checked={el.fillTo === 'rect-bottom'}
            onCheckedChange={(v) => onPatch({ fillTo: v === true ? 'rect-bottom' : undefined }, { discrete: true })} />
          {t('reportDesigner.fillToBottom')}
        </label>
      )}
    </div>
  );
}
```

Render it in the single-selection branch after `<KindControls .../>`. Note `reportDesigner.none` already exists (DataTab uses it).

- [ ] **Step 4: Add i18n keys in en, fr, pt** (`flow`, `placeBelow`, `flowGap`, `firstPageOnly`, `showWith`, `fillToBottom`). French and Portuguese are real translations, not English copies. Run `pnpm --filter @openldr/studio test -- parity` to prove shape parity.

- [ ] **Step 5: Run the PropertiesTab tests, expect PASS. Commit** (`feat(studio): flow controls in the report-designer properties tab`)

### Task 4: Stat layout and transpose controls

**Files:**
- Modify: `apps/studio/src/report-designer/PropertiesTab.tsx` (keyvalue branch :315, table branch :335)
- Test: `apps/studio/src/report-designer/PropertiesTab.test.tsx`
- Modify: i18n en, fr, pt

- [ ] **Step 1: Failing tests**

```tsx
it('offers stat in the keyvalue layout select', () => { /* choose stat, expect onPatch({ layout: 'stat' }, { discrete: true }) */ });
it('writes transpose and transposeLabel on a bound table', () => { /* checkbox then input */ });
it('hides the transpose label input while transpose is off', () => {});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

Keyvalue: add `<SelectItem value="stat">{t('reportDesigner.layoutStat')}</SelectItem>` and widen the cast at :315 to `'inline' | 'stacked' | 'stat'`.

Table branch: the current early `return null` for bound tables (:337) is replaced; bound AND unbound tables now render a transpose block, and only the unbound case keeps the columns editor below it:

```tsx
if (el.kind === 'table') {
  const transposeBlock = (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Checkbox aria-label={t('reportDesigner.transpose')} checked={el.transpose ?? false}
          onCheckedChange={(v) => onPatch(v === true
            ? { transpose: true, boundColumns: undefined }
            : { transpose: undefined, transposeLabel: undefined }, { discrete: true })} />
        {t('reportDesigner.transpose')}
      </label>
      {el.transpose && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.transposeLabel')}</div>
          <Input aria-label={t('reportDesigner.transposeLabel')} value={el.transposeLabel ?? ''}
            onChange={(e) => onPatch({ transposeLabel: e.target.value })} className="h-8 text-xs" />
        </div>
      )}
    </div>
  );
  if (el.dataSource) return transposeBlock;
  /* existing unbound columns editor follows, prefixed by transposeBlock in one fragment */
}
```

Turning transpose ON clears `boundColumns` in the same patch: a transposed table must leave them empty (schema.ts:133), and doing it here is what keeps the design valid without a server round trip.

- [ ] **Step 4: i18n keys** (`layoutStat`, `transpose`, `transposeLabel`) in en, fr, pt.

- [ ] **Step 5: Run, expect PASS. Commit** (`feat(studio): stat layout and table transpose are authorable`)

### Task 5: Cellgrid config in the Properties tab

**Files:**
- Modify: `apps/studio/src/report-designer/PropertiesTab.tsx` (new KindControls branch for cellgrid)
- Test: `apps/studio/src/report-designer/PropertiesTab.test.tsx`
- Modify: i18n en, fr, pt

**Interfaces:**
- Consumes: schema fields `labelColumn`, `cellColumns`, `palette`, `groupBoundary`, `trailingColumns` (types already exported via `./types`).

- [ ] **Step 1: Failing tests**

```tsx
it('edits labelColumn, palette steps and the group boundary on a cellgrid', () => {});
it('adds, renames and removes cell columns', () => {});
it('adds a trailing column with key, label and width and removes one', () => {});
```

Each asserts the exact patch: e.g. add-cell-column on `['c1']` expects `onPatch({ cellColumns: ['c1', 'c2'] }, { discrete: true })` (next free `cN`, the ParamEditor smallest-free idiom, DataTab.tsx:117).

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement the branch** (before the final `return null` in KindControls)

```tsx
if (el.kind === 'cellgrid') {
  const cells = el.cellColumns ?? [];
  const trailing = el.trailingColumns ?? [];
  const setCells = (next: string[], discrete?: boolean) => onPatch({ cellColumns: next }, discrete ? { discrete: true } : undefined);
  const setTrailing = (next: typeof trailing, discrete?: boolean) => onPatch({ trailingColumns: next.length ? next : undefined }, discrete ? { discrete: true } : undefined);
  const nextCellKey = () => { let n = 1; const has = new Set(cells); while (has.has(`c${n}`)) n += 1; return `c${n}`; };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.labelColumn')}</div>
        <Input aria-label={t('reportDesigner.labelColumn')} value={el.labelColumn ?? ''} placeholder="—"
          onChange={(e) => onPatch({ labelColumn: e.target.value || undefined })} className="h-8 text-xs" />
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.cellColumns')}</div>
        <div className="flex flex-col gap-1">
          {cells.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input aria-label={`${t('reportDesigner.cellColumns')} ${i + 1}`} value={c}
                onChange={(e) => setCells(cells.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 text-xs" />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                aria-label={`${t('reportDesigner.removeColumn')} ${i + 1}`} onClick={() => setCells(cells.filter((_, j) => j !== i), true)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="justify-start"
            onClick={() => setCells([...cells, nextCellKey()], true)}>{t('reportDesigner.addCellColumn')}</Button>
        </div>
      </div>
      <NumberField label={t('reportDesigner.paletteSteps')} value={el.palette?.steps ?? 1}
        onChange={(n) => onPatch({ palette: { ramp: el.palette?.ramp ?? 'blue', steps: Math.max(1, Math.min(5, Math.round(n))) } })} min={1} />
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Checkbox aria-label={t('reportDesigner.groupBoundary')} checked={el.groupBoundary === 'token-change'}
          onCheckedChange={(v) => onPatch({ groupBoundary: v === true ? 'token-change' : undefined }, { discrete: true })} />
        {t('reportDesigner.groupBoundary')}
      </label>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.trailingColumns')}</div>
        <div className="flex flex-col gap-1">
          {trailing.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input aria-label={`${t('reportDesigner.trailingKey')} ${i + 1}`} value={c.key} placeholder={t('reportDesigner.trailingKey')}
                onChange={(e) => setTrailing(trailing.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="h-7 w-20 text-xs" />
              <Input aria-label={`${t('reportDesigner.trailingLabel')} ${i + 1}`} value={c.label} placeholder={t('reportDesigner.trailingLabel')}
                onChange={(e) => setTrailing(trailing.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-7 flex-1 text-xs" />
              <Input type="number" aria-label={`${t('reportDesigner.trailingWidth')} ${i + 1}`} value={c.width}
                onChange={(e) => { const n = Number(e.target.value); if (n > 0) setTrailing(trailing.map((x, j) => (j === i ? { ...x, width: n } : x))); }}
                className="h-7 w-16 text-xs" />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                aria-label={`${t('reportDesigner.removeColumn')} trailing ${i + 1}`} onClick={() => setTrailing(trailing.filter((_, j) => j !== i), true)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="justify-start"
            onClick={() => setTrailing([...trailing, { key: '', label: '', width: 20 }], true)}>{t('reportDesigner.addTrailingColumn')}</Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.trailingWidthHint')}</p>
      </div>
    </div>
  );
}
```

Trailing width is POINTS by schema (TrailingColumnSchema comment); `trailingWidthHint` says so, because every other number on this pane is px@96 and silence here would repeat the units trap. `statusKey`/`emphasis` on trailing columns stay JSON-only this slice; note that in the commit body.

- [ ] **Step 4: i18n keys** (`labelColumn`, `cellColumns`, `addCellColumn`, `paletteSteps`, `groupBoundary`, `trailingColumns`, `addTrailingColumn`, `trailingKey`, `trailingLabel`, `trailingWidth`, `trailingWidthHint`) in en, fr, pt.

- [ ] **Step 5: Run, expect PASS. Commit** (`feat(studio): cellgrid configuration in the properties tab`)

### Task 6: Data tab binds cellgrids, sortBy and headerRow

**Files:**
- Modify: `apps/studio/src/report-designer/DataTab.tsx`
- Test: `apps/studio/src/report-designer/DataTab.test.tsx`
- Modify: i18n en, fr, pt

- [ ] **Step 1: Failing tests**

```tsx
it('lets a cellgrid pick a query but shows no include-columns list', () => {});
it('writes sortBy for a bound table', () => {});
it('disables the header-row checkbox until sortBy is set, with the explanation', () => {});
it('writes headerRow true with sortBy present, and deletes it when unchecked', () => {});
it('replaces the columns list with the transposed note for a transposed table', () => {});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

- Add `'cellgrid'` to `BINDABLE_KINDS` (DataTab.tsx:31) and update its comment: a cellgrid binds a query and sorts here; its column config lives in Properties.
- After the Load columns row, for every bound-capable element with a `dataSource`, render:

```tsx
<div>
  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('reportDesigner.sortBy')}</div>
  <Input aria-label={t('reportDesigner.sortBy')} value={el.sortBy ?? ''} placeholder="—"
    onChange={(e) => onPatchElement(el.id, { sortBy: e.target.value || undefined })} className="h-7 text-xs" />
  <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.sortByHelp')}</p>
</div>
{el.kind === 'table' && (
  <div>
    <label className="flex items-center gap-2 text-xs text-foreground">
      <Checkbox aria-label={t('reportDesigner.headerRow')} checked={el.headerRow ?? false} disabled={!el.sortBy}
        onCheckedChange={(v) => onPatchElement(el.id, { headerRow: v === true ? true : undefined }, { discrete: true })} />
      {t('reportDesigner.headerRow')}
    </label>
    {!el.sortBy && <p className="mt-1 text-xs text-muted-foreground">{t('reportDesigner.headerRowNeedsSort')}</p>}
  </div>
)}
```

- Clearing sortBy while headerRow is set must also delete headerRow in the same patch (`{ sortBy: undefined, headerRow: undefined }`); the server refuses the broken pair (header-row.ts) and the UI must not be able to save it.
- Guard the include-columns section: render it only when `el.kind !== 'cellgrid' && !el.transpose`; for a transposed table render `<p className="text-xs text-muted-foreground">{t('reportDesigner.transposedNote')}</p>` instead.

- [ ] **Step 4: i18n keys** (`sortBy`, `sortByHelp`, `headerRow`, `headerRowNeedsSort`, `transposedNote`) in en, fr, pt. `sortByHelp` says why the query's own ORDER BY is not trusted, one sentence.

- [ ] **Step 5: Run, expect PASS. Commit** (`feat(studio): data tab binds cellgrids and authors sortBy and headerRow`)

### Task 7: Gate, live smoke, merge

- [ ] **Step 1: Full gate**

Run: `pnpm turbo run test --concurrency=4`
Expected: green modulo the two known flake classes (dedupe flake, parallel-turbo timeouts; re-run the failing package ALONE before treating anything as a regression).

- [ ] **Step 2: Live smoke** (announcing dev shortcuts up front per the flag-dev-shortcuts memory: this uses the dev servers and `AUTH_DEV_BYPASS` if configured)

Start the dev stack the repo's usual way, open `/report-designer`, and rebuild the transmission grid's shape by hand: insert a cellgrid, bind `q-transmission-hvleid`, set sortBy `ord`, label column `lab`, 23 cell columns, group boundary on, trailing Days/Silent, a heading with Place below and Show with, a stat keyvalue with First page only. Export the PDF and compare against the seeded `r-transmission-grid` output. Cosmetic drift is fine; every field authored through the UI landing in the export is the pass bar. Record what could not be authored, if anything.

- [ ] **Step 3: Mobile check** at 375x812 (`resize_window`): Properties and Data tabs scroll, no sideways overflow. State plainly that bottom-pinned behavior needs a real phone (dvh caveat).

- [ ] **Step 4: Merge to local main**

```bash
git checkout main
git merge --no-ff feat/report-designer-authoring-slice-a -m "feat(studio): report designer authors cellgrids, flow, transpose and header rows (spec 1 slice A)"
pnpm make:changelog
git add apps/web/src/landing/changelog.json
git commit -m "chore(landing): regenerate the changelog"
```

Do not push; confirm with the operator first (repo convention: merge local, sync origin after confirmation).

## Self-review notes

- Spec coverage: Insert (T1), Flow section (T3), stat layout and transpose (T4), cellgrid config (T5), sortBy and headerRow with the write-gate mirrored in the UI (T6). The spec's cycle rule is T2 plus T3's filtered options.
- Deferred inside slice A, said out loud: trailing-column statusKey/emphasis editors (JSON-only until asked), and the canvas preview of flow effects (slice B's page strip is where flow becomes visible).
- Type consistency: `flowTargets` is the only new exported symbol; every other change writes existing schema fields through existing patch channels.
