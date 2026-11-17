# Check run summary names its source kind: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished check run shows the source kind, and on a v1 run the Breakdown says why nothing was compared.

**Architecture:** Two page components in the `cdr-source` plugin UI. `CheckPanel` already works out `kind` and `v1` for the chosen source. It adds one item to the run's settings line and passes `v1` to `LaboratoryBrowser`, which shows an existing sentence under the Breakdown heading.

**Tech Stack:** React, TypeScript, Vitest with Testing Library, in `cdr-source/ui`.

**Spec:** `docs/superpowers/specs/2026-11-17-check-run-source-kind-design.md`

Work in `cdr-source/.claude/worktrees/run-source-kind`, branch `run-source-kind`, cut from `main` at 2dd8a7b.

## Global Constraints

- No new strings. Reuse `options.kind`, `options.kind.openldrV1`, `options.kind.labSystem`, `check.v1NotCompared`.
- The source system's name never appears in the page.
- No Co-Authored-By lines in commits.
- Do not merge into `main` or push. The operator decides.

## Review Focus

- A lab-system run must not show the v1 sentence. Covered in Task 1.
- A run with no labels (no Breakdown shown) must not show the sentence on its own. Covered in Task 1 by the `LaboratoryBrowser` test.
- The Kind item must keep showing the recorded run, not an edit in the open settings sheet. Kind comes from the source copy, which settings cannot change, so no new test.

---

### Task 1: Kind item and v1 sentence

**Files:**
- Modify: `ui/src/CheckPanel.tsx` (the `check-run-context` list near line 451; the `<LaboratoryBrowser>` call near line 467)
- Modify: `ui/src/LaboratoryBrowser.tsx` (props; the Breakdown section near line 95)
- Test: `ui/src/CheckPanel.test.tsx`, `ui/src/LaboratoryBrowser.test.tsx`

**Interfaces:**
- Produces: `LaboratoryBrowser({ run, shown = true, v1 = false }: { run: CheckRun; shown?: boolean; v1?: boolean })`

- [ ] **Step 1: Write the failing tests**

In `CheckPanel.test.tsx`:
- Extend `'shows the counts and only the labels the check gave, not compared and held by rules'` (v1 run): `expect(byId('check-run-context').textContent).toContain('KindOpenLDR v1')` and `expect(byId('check-labels-v1').textContent).toBe('An OpenLDR v1 source is not compared.')`.
- Extend `'shows the run’s lab code beside its time zone, on a phone too'` (lab-system run): `expect(line.textContent).toContain('KindLab system')` and `expect(screen.queryByTestId('check-labels-v1')).toBeNull()`.

In `LaboratoryBrowser.test.tsx`, a new test `'says a v1 run is not compared only when the breakdown shows'`: render with `v1` and labels, expect `check-labels-v1`; render with `v1` and `labels: {}`, expect no `check-labels-v1`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd ui && pnpm vitest run src/CheckPanel.test.tsx src/LaboratoryBrowser.test.tsx`
Expected: the new assertions fail; nothing else does.

- [ ] **Step 3: Implement**

`CheckPanel.tsx`: render a first `<div>` in `check-run-context` with `<dt>{t('options.kind')}</dt>` and `<dd>` of `t(v1 ? 'options.kind.openldrV1' : 'options.kind.labSystem')`, styled like the existing items. Pass `v1={v1}` to `LaboratoryBrowser`.
`LaboratoryBrowser.tsx`: under the `check-labels-heading` `<h3>`, when `v1`, render `<p className="m-0 text-sm text-muted-foreground" data-testid="check-labels-v1">{t('check.v1NotCompared')}</p>`.

- [ ] **Step 4: Run the whole UI suite, typecheck and build**

Run: `cd ui && pnpm test > /tmp/ui-test.txt 2>&1; echo "exit=$?"`, then `pnpm typecheck > /tmp/ui-tc.txt 2>&1; echo "exit=$?"`, then from the repo root `node scripts/build.mjs`.
Expected: `exit=0` for both, and the build writes `dist/ui.html`.

- [ ] **Step 5: Commit**

```bash
git add ui/src/CheckPanel.tsx ui/src/LaboratoryBrowser.tsx ui/src/CheckPanel.test.tsx ui/src/LaboratoryBrowser.test.tsx
git commit -m "fix(ui): a check run names its source kind, and a v1 run says why nothing was compared"
```

---

### Task 2: v1 runs hide the Not compared row, and Reference reads Not applicable

Implements spec Revision 1. Base: `run-source-kind` after Task 1 (7488cd4).

Global constraint change for this task: exactly one new string key, `check.referenceNotApplicable`, in en, fr and pt, plus the guide text below. No other new keys.

**Files:**
- Modify: `ui/src/i18n.ts` (new key beside `check.noReference` in each language)
- Modify: `ui/src/CheckPanel.tsx` (the v1 branch near line 401; it passes `v1` already)
- Modify: `ui/src/LaboratoryBrowser.tsx` (label list and Breakdown condition near lines 41 and 95)
- Modify: `ui/src/guide/en.ts`, `fr.ts`, `pt.ts` (line 63 and line 100 in each)
- Test: `ui/src/CheckPanel.test.tsx`, `ui/src/LaboratoryBrowser.test.tsx`, `ui/src/i18n.test.ts`, `ui/src/guide/guide.test.ts`

**Interfaces:**
- Consumes: `LaboratoryBrowser`'s `v1?: boolean` prop from Task 1.
- Produces: test id `check-reference-na` on the disabled select trigger. Test id `check-v1-not-compared` is removed.

- [ ] **Step 1: Write the failing tests**

- `i18n.test.ts`: `bundles.en['check.referenceNotApplicable']` is `'Not applicable'`, fr `'Sans objet'`, pt `'Não aplicável'`.
- `CheckPanel.test.tsx`: every assertion on `check-v1-not-compared` (lines ~673-800) moves to `check-reference-na`: present for a v1 source, absent for a lab-system source. For a v1 source, `check-reference-na` has text `'Not applicable'` and is disabled (`toBeDisabled()`), and its label reads `Reference`.
- `CheckPanel.test.tsx`, the v1 run test with labels `{ unchecked: 92, held_rules: 8 }`: the label list is `['Held by rules: 8']`, and `check-labels-v1` still reads `'An OpenLDR v1 source is not compared.'`.
- `LaboratoryBrowser.test.tsx`: with `v1` and labels `{ unchecked: 5 }` only, `check-labels-heading` and `check-labels-v1` show and no `check-label-unchecked` exists. Without `v1`, the same labels show `check-label-unchecked`.
- `guide.test.ts`: the guide's ui keys include `check.referenceNotApplicable`, and still include `check.v1NotCompared`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd ui && npx vitest run src/CheckPanel.test.tsx src/LaboratoryBrowser.test.tsx src/i18n.test.ts src/guide/guide.test.ts`
Expected: the new assertions fail. The 7 known export failures in `CheckPanel.test.tsx` fail as before.

- [ ] **Step 3: Implement**

- `i18n.ts`: add `check.referenceNotApplicable` with the three values above.
- `CheckPanel.tsx`: in the v1 branch, replace the `<p data-testid="check-v1-not-compared">` with `<FieldLabel htmlFor="check-reference-na">{t('check.reference')}</FieldLabel>` and a `<FieldCell>` holding a disabled shadcn `Select` (value `na`, one `SelectItem` `na` with `check.referenceNotApplicable`), its `SelectTrigger` with `id="check-reference-na"`, `data-testid="check-reference-na"`, `disabled`, and the same classes as the Source select's trigger.
- `LaboratoryBrowser.tsx`: when `v1`, drop `unchecked` from the shown labels. Show the Breakdown section when the shown labels are non-empty, or when `v1` and the run's own label counts are non-empty.
- Guide line 100, en: `'For an OpenLDR v1 source, the ', {ui:'check.reference'}, ' field reads ', {ui:'check.referenceNotApplicable'}, ' and cannot be changed, and the settings ask for the ', {ui:'check.opt.tz'}, ' only.'` Write fr and pt to say the same, following each file's existing wording.
- Guide line 63, en: `'A check on this source does not compare it, so the Breakdown says ', {ui:'check.v1NotCompared'}, ' and lists only the requests held back. A request with its dates out of order is held back. It is listed on the ', {ui:'tab.held'}, ' tab, with a finding that names the dates.'` Same in fr and pt.
- Check `docs/GUIDE.md` for the same two statements and update it if they are there.

- [ ] **Step 4: Run the whole UI suite, typecheck and build**

As Task 1, Step 4. Expected: only the 9 known export failures; typecheck `exit=0`; build writes `dist/ui.html`.

- [ ] **Step 5: Commit**

```bash
git add ui/src docs/GUIDE.md
git commit -m "fix(ui): a v1 run hides Not compared, and its Reference reads Not applicable"
```

---

### Task 3: the guide glossary and the summary CSV match the v1 page

The operator chose to close two wording gaps the final review listed, before merge. Base: `run-source-kind` at 770b1ec.

No new string keys. Reuse `check.referenceNotApplicable` from Task 2.

**Files:**
- Modify: `ui/src/exports.ts` (`summaryRows`, near lines 25-33)
- Modify: `ui/src/guide/en.ts`, `fr.ts`, `pt.ts` (the `label.unchecked` term, line 122 in each); `docs/GUIDE.md` if it has the same sentence
- Test: `ui/src/exports.test.ts`, `ui/src/guide/guide.test.ts` if it pins that text

- [ ] **Step 1: Write the failing tests**

In `exports.test.ts`, a new test `'a v1 run’s summary has no Not compared row, and its reference reads Not applicable'`: build a run with `options: { kind: 'openldr-v1', tz: '+03:00' }`, `referenceCopyId: null`, labels `{ unchecked: 92, held_rules: 8 }`. Expect no row whose first cell is `'Not compared'`, a row `['Held by rules', '8']`, and the reference row's value `'Not applicable'`.
A second test: the same run without `kind` keeps the `['Not compared', '92']` row and the reference value `'This site has no reference'`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd ui && npx vitest run src/exports.test.ts`

- [ ] **Step 3: Implement**

- `summaryRows`: `const v1 = run.options?.kind === 'openldr-v1'`. Skip the `unchecked` label row when `v1`. The reference row value is `t('check.referenceNotApplicable')` when `v1`, else as today.
- Guide line 122, drop the v1 cause. en: `'The rules found no error, and the request is saved. It was not compared: the site has no reference, or the reference has no matching request.'` fr: `'… Elle n’a pas été comparée : le site n’a pas de référence, ou la référence n’a pas de demande correspondante.'` pt: `'… Não foi comparado: o local não tem referência, ou a referência não tem um pedido correspondente.'` Keep each sentence's opening as it is.
- `docs/GUIDE.md`: same change if the sentence is there.

- [ ] **Step 4: Run the whole UI suite, typecheck and build**

As Task 1, Step 4. Expected: only the 9 known export failures; typecheck `exit=0`; build `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add ui/src docs/GUIDE.md
git commit -m "fix(ui): the summary file and the guide word a v1 run as the page does"
```
