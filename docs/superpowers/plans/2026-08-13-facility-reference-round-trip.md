# Reference Round-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a picked value survive being read back, so a facility can be edited at all.

**Architecture:** One idea at two layers — a stored string is matched against the value set and a
match is accepted. On the client, a seeded reference answer is resolved back to a coding object
before validation ever sees it, using the same search endpoint the picker already calls. On the
server, the canonical set gains the expansion's displays alongside its codes. Nothing stored changes;
there is no migration.

**Tech Stack:** TypeScript, React 18, Vitest, Fastify, Kysely.

## Global Constraints

- **Verify with the mouse.** The previous slice reported the Edit sheet as fine having only ever used
  `curl`. No claim about the sheet counts unless a real click produced it.
- **D1 is not facilities-specific.** The fix lands in `FormRuntime`; a result proven only through the
  facilities sheet is not proven.
- `resolveControlledFields` serves a **refusing** caller (the routes) and a **warning** caller (the
  import). Any change there moves both.
- Import tests pinning unmapped counts must be moved **deliberately, with the new number explained** —
  never adjusted until they pass.
- `apps/server` is the only package with real lint; it enforces `return`/`await` on `reply.send`.
- Full gate is `pnpm turbo run test`. **Never pipe turbo through `tail`.** A failure is usually a
  timeout: grep for `Test timed out` and re-run that package alone.
- Never add a `Co-Authored-By` trailer. Commit after each task; do not push.

---

## File Structure

**Created:**
- `apps/studio/src/forms-runtime/seeded-references.ts` — pure matching, no network.
- `apps/studio/src/forms-runtime/seeded-references.test.ts`

**Modified:**
- `apps/studio/src/forms-runtime/FormRuntime.tsx` — resolve on load.
- `apps/studio/src/forms-runtime/FormRuntime.test.tsx`
- `packages/bootstrap/src/facility-controlled-fields.ts` — canonical set gains displays.
- `packages/bootstrap/src/facility-controlled-fields.test.ts`
- Import tests whose unmapped counts move (identified in Task 3, not guessed here).

---

### Task 1: The matching rule, as a pure function

No network, no React. Everything decidable about "does this string name a concept" lives here so it
can be tested exhaustively.

**Files:**
- Create: `apps/studio/src/forms-runtime/seeded-references.ts`
- Test: `apps/studio/src/forms-runtime/seeded-references.test.ts`

**Interfaces:**
- Produces: `interface ResolvableRow { value: unknown; display: string; code: string | null }`
- Produces: `pickSeededMatch(raw: string, rows: ResolvableRow[]): unknown | undefined`
- Produces: `fieldsNeedingResolution(schema: FormSchema, answers: RuntimeAnswers): { fieldId: string; raw: string }[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { pickSeededMatch, fieldsNeedingResolution, type ResolvableRow } from './seeded-references';

const row = (display: string, code: string | null): ResolvableRow => ({
  value: code === null ? { reference: display } : { system: 'urn:s', code, display },
  display, code,
});

describe('pickSeededMatch', () => {
  it('matches a stored display exactly — the common case, since the column holds displays', () => {
    const rows = [row('Health Center', 'health-center'), row('Dispensary', 'dispensary')];
    expect(pickSeededMatch('Health Center', rows)).toEqual({ system: 'urn:s', code: 'health-center', display: 'Health Center' });
  });

  it('falls back to an exact CODE match — a column that stores the code still resolves', () => {
    const rows = [row('Health Center', 'health-center')];
    expect(pickSeededMatch('health-center', rows)).toEqual({ system: 'urn:s', code: 'health-center', display: 'Health Center' });
  });

  it('falls back to a case-insensitive display match', () => {
    // Casing bites in this repo: value-set status is compared case-sensitively elsewhere and
    // silently yields empty expansions. A stored 'ACTIVE' must still find 'Active'.
    const rows = [row('Active', 'active')];
    expect(pickSeededMatch('ACTIVE', rows)).toEqual({ system: 'urn:s', code: 'active', display: 'Active' });
  });

  it('prefers an exact display over a case-insensitive one', () => {
    const rows = [row('active', 'lower'), row('Active', 'proper')];
    expect((pickSeededMatch('Active', rows) as { code: string }).code).toBe('proper');
  });

  it('leaves an AMBIGUOUS case-insensitive match unresolved rather than guessing', () => {
    const rows = [row('Active', 'a1'), row('ACTIVE', 'a2')];
    expect(pickSeededMatch('active', rows)).toBeUndefined();
  });

  it('returns undefined when nothing matches — the vocabulary genuinely lacks the value', () => {
    // 'Health Centre' (British) is what the Zambia register writes; the value set has
    // 'Health Center'. This MUST stay unresolved so the field honestly asks for a pick.
    expect(pickSeededMatch('Health Centre', [row('Health Center', 'health-center')])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    expect(pickSeededMatch('Active', [])).toBeUndefined();
  });

  it('matches an entity row on display, whose value carries a reference rather than a code', () => {
    expect(pickSeededMatch('Jane Doe', [row('Jane Doe', null)])).toEqual({ reference: 'Jane Doe' });
  });
});

const schema = (fields: unknown[]): never => ({ id: 's', name: 'S', sections: [], fields }) as never;
const field = (over: Record<string, unknown>) => ({
  id: 'f', fhirPath: null, description: null, displayLabel: 'F', required: false,
  enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
});

describe('fieldsNeedingResolution', () => {
  it('names a reference field holding a bare string', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs' })]);
    expect(fieldsNeedingResolution(s, { level: 'Health Center' })).toEqual([{ fieldId: 'level', raw: 'Health Center' }]);
  });

  it('skips a field already holding a coding — resolution must be idempotent', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs' })]);
    expect(fieldsNeedingResolution(s, { level: { system: 'urn:s', code: 'health-center' } })).toEqual([]);
  });

  it('skips a reference field with NO source — FormRuntime renders a text input there', () => {
    // Same gate `validate` uses (runtime.ts:47): a sourceless reference field is a plain text box,
    // so a string in it is correct and must not be "resolved" against a list that does not exist.
    const s = schema([field({ id: 'level', fieldType: 'reference' })]);
    expect(fieldsNeedingResolution(s, { level: 'anything' })).toEqual([]);
  });

  it('skips a non-reference field', () => {
    const s = schema([field({ id: 'name', fieldType: 'text' })]);
    expect(fieldsNeedingResolution(s, { name: 'Chunga Clinic' })).toEqual([]);
  });

  it('skips an empty or absent answer', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs' })]);
    expect(fieldsNeedingResolution(s, { level: '' })).toEqual([]);
    expect(fieldsNeedingResolution(s, {})).toEqual([]);
  });

  it('skips a disabled field', () => {
    const s = schema([field({ id: 'level', fieldType: 'reference', valueSetUrl: 'urn:vs', enabled: false })]);
    expect(fieldsNeedingResolution(s, { level: 'Health Center' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @openldr/studio test -- seeded-references
```

Expected: FAIL — `Failed to load url ./seeded-references`.

- [ ] **Step 3: Write the module**

```ts
import { isReferenceFieldType, resolveReferenceSource } from '@openldr/forms/pure';
import type { FormSchema, RuntimeAnswers } from './types';

/**
 * One candidate from a reference search, flattened to what matching needs.
 *
 * `code` is `null` for an entity-kind row — those have no code to match on, only a display and a
 * reference. Mirrors `ReferencePicker`'s own `toRows`, deliberately re-derived here rather than
 * imported: that function also carries picker-only concerns (`key`, `secondary`).
 */
export interface ResolvableRow {
  /** The answer value to store when this row wins. */
  value: unknown;
  /** What the operator sees. Matched first, because the column stores displays. */
  display: string;
  /** The coded form. Matched second. `null` for an entity row. */
  code: string | null;
}

/**
 * The concept a stored string names, or `undefined` when it names none.
 *
 * ⛔ Ambiguity NEVER resolves. Two rows that differ only in case are not a reason to pick one — a
 * wrong coding is worse than an unresolved field, because the operator can see and fix the second.
 *
 * Order: exact display, then exact code, then case-insensitive display. Display leads because
 * `splitFacilityAnswers` flattens a picked answer to its display (packages/db/src/facility-answers.ts
 * :134-141) — that is what is actually in the column. Code is second so a column that holds a code
 * (an operator who typed one, or an older row) still resolves. The case-insensitive pass is last
 * because casing genuinely bites here: value-set status is compared case-sensitively elsewhere in
 * this repo and silently produces empty expansions.
 */
export function pickSeededMatch(raw: string, rows: ResolvableRow[]): unknown | undefined {
  const only = (matches: ResolvableRow[]): unknown | undefined =>
    (matches.length === 1 ? matches[0].value : undefined);

  const exactDisplay = only(rows.filter((r) => r.display === raw));
  if (exactDisplay !== undefined) return exactDisplay;

  const exactCode = only(rows.filter((r) => r.code !== null && r.code === raw));
  if (exactCode !== undefined) return exactCode;

  const lowered = raw.toLowerCase();
  return only(rows.filter((r) => r.display.toLowerCase() === lowered));
}

/**
 * Fields whose seeded answer is a bare string where a coding is required.
 *
 * The gate is deliberately IDENTICAL to `validate`'s (apps/studio/src/forms-runtime/runtime.ts:47):
 * reference-family field type AND a resolvable source. A reference field with no source renders as
 * a plain text input, so a string in it is the correct answer and must not be looked up against a
 * list that does not exist.
 */
export function fieldsNeedingResolution(
  schema: FormSchema, answers: RuntimeAnswers,
): { fieldId: string; raw: string }[] {
  const out: { fieldId: string; raw: string }[] = [];
  for (const field of schema.fields) {
    if (field.enabled === false) continue;
    if (!isReferenceFieldType(field.fieldType) || !resolveReferenceSource(field).ok) continue;
    // A BARE STRING is the whole condition. An answer that is already a coding or an entity is an
    // object, so this one check covers "needs resolving" and "is already resolved" together — which
    // is also what makes re-running this idempotent.
    const raw = answers[field.id];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    out.push({ fieldId: field.id, raw });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @openldr/studio test -- seeded-references
```

Expected: PASS, all 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/forms-runtime/seeded-references.ts apps/studio/src/forms-runtime/seeded-references.test.ts
git commit -m "feat(forms): the rule for matching a stored string back to a concept"
```

---

### Task 2: FormRuntime resolves seeded reference answers on load

**Files:**
- Modify: `apps/studio/src/forms-runtime/FormRuntime.tsx:1-17` (imports), `:92-95` (state)
- Test: `apps/studio/src/forms-runtime/FormRuntime.test.tsx`

**Interfaces:**
- Consumes: `pickSeededMatch`, `fieldsNeedingResolution`, `ResolvableRow` from Task 1.
- Consumes: `referenceSearch(formId, fieldId, {q, limit})` and `referenceSearchPreview(field, {q, limit})`
  from `@/api`, both returning
  `{ kind: 'coding'; rows: { system: string; code: string; display: string | null }[]; total: number }`
  or `{ kind: 'entity'; rows: { reference: string; display: string; secondary: string | null }[]; total: number }`.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/forms-runtime/FormRuntime.test.tsx`. That file does **not** currently mock
`@/api`, so add the mock at the top, in the exact shape `ReferencePicker.test.tsx:20-23` already
uses — one idiom in this folder, not two:

```tsx
vi.mock('@/api', () => ({
  referenceSearch: vi.fn(),
  referenceSearchPreview: vi.fn(),
}));
import { referenceSearch, referenceSearchPreview } from '@/api';
import { waitFor } from '@testing-library/react';

beforeEach(() => {
  vi.mocked(referenceSearch).mockReset();
  vi.mocked(referenceSearchPreview).mockReset();
});
```

`beforeEach` and `waitFor` are new to this file — add them to its existing `vitest` and
`@testing-library/react` imports. Then:

```tsx
describe('seeded reference answers are resolved before validation sees them', () => {
  const schema = {
    id: 's', name: 'S', sections: [], version: 1,
    fields: [{
      id: 'level', fhirPath: null, description: null, displayLabel: 'Level',
      fieldType: 'reference', required: true, enabled: true, order: 0,
      cardinality: { min: 1, max: '1' }, valueSetUrl: 'urn:openldr:valueset:facility-type',
    }],
  } as never;

  it('submits a facility seeded with a stored DISPLAY, instead of blocking on it', async () => {
    // The defect: the sheet seeds 'Health Center' (a string), `validate` demands {system, code},
    // and Save silently does nothing. Measured on a live install before this fix.
    const onSubmit = vi.fn();
    vi.mocked(referenceSearch).mockResolvedValue({
      kind: 'coding', total: 1,
      rows: [{ system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center' }],
    });

    render(<FormRuntime schema={schema} formDefinitionId="form-1" initialAnswers={{ level: 'Health Center' }} onSubmit={onSubmit} submitLabel="Save" />);
    await waitFor(() => expect(vi.mocked(referenceSearch)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].level).toEqual({
      system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center',
    });
  });

  it('still blocks when the stored value names no concept, and says so', async () => {
    // 'Health Centre' is what the Zambia register writes. It is genuinely not in the value set, so
    // the honest outcome is the field asking for a pick — NOT a silent dead Save button.
    const onSubmit = vi.fn();
    vi.mocked(referenceSearch).mockResolvedValue({
      kind: 'coding', total: 1,
      rows: [{ system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center' }],
    });

    render(<FormRuntime schema={schema} formDefinitionId="form-1" initialAnswers={{ level: 'Health Centre' }} onSubmit={onSubmit} submitLabel="Save" />);
    await waitFor(() => expect(vi.mocked(referenceSearch)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('select a value from the list')).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a failed lookup degrades to today\'s behaviour rather than blanking the field', async () => {
    const onSubmit = vi.fn();
    vi.mocked(referenceSearch).mockRejectedValue(new Error('network'));
    render(<FormRuntime schema={schema} formDefinitionId="form-1" initialAnswers={{ level: 'Health Center' }} onSubmit={onSubmit} submitLabel="Save" />);
    await waitFor(() => expect(vi.mocked(referenceSearch)).toHaveBeenCalled());
    // The value is still displayed — a lookup failure must never eat the operator's data.
    expect(screen.getByDisplayValue('Health Center')).toBeInTheDocument();
  });

  it('does not search when there is no form id to scope the search to', async () => {
    render(<FormRuntime schema={schema} initialAnswers={{ level: 'Health Center' }} onSubmit={vi.fn()} submitLabel="Save" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(referenceSearch)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @openldr/studio test -- FormRuntime
```

Expected: the first test FAILS (`onSubmit` never called — the form blocks). The second and fourth may
already pass; they are the regression pins.

- [ ] **Step 3: Add the imports**

```ts
import { referenceSearch, referenceSearchPreview } from '@/api';
import { fieldsNeedingResolution, pickSeededMatch, type ResolvableRow } from './seeded-references';
```

- [ ] **Step 4: Add the resolution effect**

Immediately after `const [errors, setErrors] = useState<Record<string, string>>({});`:

```tsx
  /**
   * Resolve seeded reference answers back to codings, once per mount.
   *
   * ⛔ WHY THIS EXISTS. A ValueSet-bound reference answer is a coding, but the column it is stored
   * in is `text`, so `splitFacilityAnswers` flattens it to its display
   * (packages/db/src/facility-answers.ts:134-141). Read back, the answer is a bare string —
   * and `validate` (runtime.ts:47-51) requires `{system, code}`. The result was that Save issued no
   * request at all on EVERY facility, imported or hand-made, while the boxes looked correctly filled
   * because `ReferencePicker` falls back to a value's string form for display. Measured 2026-08-13.
   *
   * Fixed HERE and not by relaxing `validate`: that check is what stops a capture form storing free
   * text where a coded answer is required.
   *
   * Runs once per mount, which is the whole lifetime of a seeded form — callers remount on a
   * record switch (see FacilityDialog's `key`). A failure is swallowed on purpose: the raw string
   * stays, the field reports honestly that a value must be picked, and nothing the operator can see
   * is lost.
   */
  useEffect(() => {
    const pending = fieldsNeedingResolution(schema, initialAnswers ?? {});
    if (pending.length === 0) return;
    if (!preview && !formDefinitionId) return; // nothing to scope a search to — same gate ReferencePicker uses

    let cancelled = false;
    void (async () => {
      const resolved: Record<string, unknown> = {};
      await Promise.all(pending.map(async ({ fieldId, raw }) => {
        const field = schema.fields.find((f) => f.id === fieldId);
        if (!field) return;
        try {
          const res = preview
            ? await referenceSearchPreview(field, { q: raw })
            : await referenceSearch(formDefinitionId!, fieldId, { q: raw });
          const rows: ResolvableRow[] = res.kind === 'entity'
            ? res.rows.map((r) => ({ value: { reference: r.reference, display: r.display }, display: r.display, code: null }))
            : res.rows.map((r) => ({ value: { system: r.system, code: r.code, display: r.display }, display: r.display ?? r.code, code: r.code }));
          const match = pickSeededMatch(raw, rows);
          if (match !== undefined) resolved[fieldId] = match;
        } catch {
          // Deliberately silent — see the docblock. The unresolved string survives untouched.
        }
      }));
      if (cancelled || Object.keys(resolved).length === 0) return;
      // Merge over CURRENT answers, never over the seed: an operator who edited a field while the
      // lookup was in flight must not have their edit replaced by a resolution of the old value.
      setAnswers((prev) => {
        const next = { ...prev };
        for (const [id, value] of Object.entries(resolved)) {
          if (next[id] === (initialAnswers ?? {})[id]) next[id] = value;
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm --filter @openldr/studio test -- FormRuntime && pnpm --filter @openldr/studio typecheck
```

Expected: all four new tests PASS, no existing FormRuntime test regresses, typecheck clean.

- [ ] **Step 6: Run the whole studio suite**

```bash
pnpm --filter @openldr/studio test
```

Expected: PASS. This effect touches every form — a regression in Users, Forms capture, or the builder
preview shows up here and nowhere else.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/forms-runtime/FormRuntime.tsx apps/studio/src/forms-runtime/FormRuntime.test.tsx
git commit -m "fix(forms): a seeded reference answer is resolved before validation sees it"
```

---

### Task 3: The guard accepts a canonical display as well as a canonical code

**Files:**
- Modify: `packages/bootstrap/src/facility-controlled-fields.ts:130-131`
- Test: `packages/bootstrap/src/facility-controlled-fields.test.ts`
- Modify (counts only, after measuring): import tests identified in Step 4.

- [ ] **Step 1: Write the failing test**

```ts
it('accepts a canonical DISPLAY, not only a canonical code', async () => {
  // `splitFacilityAnswers` flattens a picked answer to its display, so the column holds
  // 'Health Center' — never 'health-center'. Comparing against codes alone refused the value set's
  // own vocabulary: measured `level 'Health Center' is not a recognised canonical level value` on a
  // live create.
  const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }] } });
  const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: 'Health Center' })]);
  expect(res.unmapped.level).toEqual([]);
  expect(res.mapped.level.size).toBe(0);
});

it('still accepts a canonical code', async () => {
  const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }] } });
  const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: 'health-center' })]);
  expect(res.unmapped.level).toEqual([]);
});

it('still reports a value that is NEITHER a code nor a display', async () => {
  // 'Health Centre' (British) is what the Zambia register writes. It must stay unmapped so the
  // import keeps reporting it and the operator can map it.
  const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: 'Health Center' }] } });
  const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: 'Health Centre' })]);
  expect(res.unmapped.level).toEqual(['Health Centre']);
});

it('ignores a null display rather than treating it as a matchable value', async () => {
  const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': [{ code: 'health-center', display: null }] } });
  const res = await resolveControlledFields(admin, 'urn:zm:mfl', [rec({ level: '' }), rec({ level: 'x' })]);
  expect(res.unmapped.level).toEqual(['x']);
});
```

The file's existing `fakeAdmin` takes `valueSets?: Record<string, string[]>` — **codes only**, mapped
to `{ code }` with no display. These tests need displays, so widen it in place rather than adding a
second double beside it. Accept either shape so the ~20 existing call sites keep working unchanged:

```ts
type ConceptFixture = string | { code: string; display: string | null };

function fakeAdmin(opts: {
  valueSets?: Record<string, ConceptFixture[]>;
  mappings?: Record<string, { toCode: string; isActive: boolean }[]>;
}) {
  return {
    valueSets: {
      async getByUrl(url: string) { return opts.valueSets?.[url] ? { id: url } : null; },
      async expand(id: string) {
        // A bare string stays code-only, exactly as before — that is what every existing call site
        // passes, and a display invented for them would make those tests assert something untrue.
        const codes = (opts.valueSets?.[id] ?? []).map((c) => (
          typeof c === 'string' ? { code: c, display: null } : c
        ));
        return { codes, total: 0 };
      },
    },
    termMappings: {
      async listOutgoing(system: string, code: string) {
        return (opts.mappings?.[`${system}|${code}`] ?? []).map((m) => ({ ...m, toSystem: '', fromSystem: system, fromCode: code }));
      },
    },
  } as never;
}
```

Then write the four tests against `fakeAdmin`, not a new `adminWith`:

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @openldr/bootstrap test -- facility-controlled-fields
```

Expected: the display test FAILS — `unmapped.level` is `['Health Center']`.

- [ ] **Step 3: Widen the canonical set**

Replace lines 130-131:

```ts
    const { codes } = await admin.valueSets.expand(vs.id);
    // ⛔ Codes AND displays. A picked answer reaches this column as its DISPLAY — `splitFacilityAnswers`
    // flattens `{system, code, display}` to `display` so the column stays human-readable for reports
    // (packages/db/src/facility-answers.ts:134-141). Comparing against codes alone therefore refused
    // the value set's own vocabulary: a facility created by picking "Health Center" from the picker
    // was rejected as non-canonical, and the one hand-made facility on a live install carried
    // `Level IA2 (Dispensary Laboratory)`, refused the same way. A `null` display contributes
    // nothing — it is absence, not a matchable empty string.
    const canonical = new Set<string>();
    for (const c of codes) {
      canonical.add(c.code);
      if (c.display !== null && c.display !== '') canonical.add(c.display);
    }
```

- [ ] **Step 4: Measure what moved on the import side**

```bash
pnpm --filter @openldr/bootstrap test 2>&1 | grep -E "Tests |FAIL|→"
pnpm --filter @openldr/terminology test 2>&1 | grep -E "Tests |FAIL|→"
pnpm --filter @openldr/server test -- facilities-routes 2>&1 | grep -E "Tests |FAIL|→"
```

Any failure here is an unmapped **count** that changed because a fixture value happened to equal a
canonical display. For each one: read the fixture, confirm the value really is a canonical display,
and update the number **with a comment naming why it moved**. If a count changed for any other
reason, stop — that is a real regression, not a re-pin.

- [ ] **Step 5: Run to verify**

```bash
pnpm --filter @openldr/bootstrap test && pnpm --filter @openldr/terminology test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-controlled-fields.ts packages/bootstrap/src/facility-controlled-fields.test.ts
git commit -m "fix(facilities): a canonical display is canonical"
```

Add any re-pinned import tests to this commit, so the count change and its cause land together.

---

### Task 4: Live verification, with the mouse

**Files:** none — this produces evidence.

The previous slice's whole failure was reporting a screen as working having only used `curl`. Steps 2
through 5 below must be done by clicking.

- [ ] **Step 1: Full gate**

```bash
pnpm turbo run test
```

Do not pipe through `tail`. On failure, grep for `Test timed out` and re-run that package alone.

- [ ] **Step 2: Bring up a dev stack**

The API needs `AUTH_DEV_BYPASS=true` in `.env` and a restart to read it — `node --watch` does not
reload env files. **Announce this to the operator before doing it, and restore it afterwards.**

The install should still carry the 3788 imported Zambia rows and the one hand-made facility. If not,
re-import: convert `D:\Projects\Repositories\corlix\fixtures\mfl_facilities_export20260810155748.xlsx`
to CSV, then

```bash
node dev.mjs facilities import <csv> --national-system urn:zm:mfl --column-map src/__fixtures__/zm-mfl-map.json --allow-invalid-coordinates --apply
```

from `packages/cli`.

- [ ] **Step 3: Save an imported facility, untouched**

Open `1 Commando Urban Health Centre` (`fac-ffba14a83e48c1e5`), click ⋯ → Save, change nothing.

Expected: it saves. Before this slice it did nothing at all — Country, Status and Level blocked with
`select a value from the list`, and no request was made.

Note that its Level is `Health Centre`, which is **not** in the value set. So the expected outcome is
that Country and Status resolve, Level does not, and the sheet asks for a Level. Record which of the
three resolved — if Level silently resolved to something, that is a bug, not a success.

- [ ] **Step 4: Save the hand-made facility, untouched**

Open `National Public Health Laboratory`, ⋯ → Save, change nothing. Expected: it saves. Its Level is
`Level IA2 (Dispensary Laboratory)`, a canonical display, so it must resolve.

This one matters because it proves the defect was never import-specific.

- [ ] **Step 5: Create a facility by picking every reference field**

⋯ → Add facility, pick Country, Status and Level from their pickers, save.

Expected: 201. Before Task 3 this returned
`level 'Health Center' is not a recognised canonical level value`. Then re-open it and confirm the
stored columns still read as displays, not codes — Task 3 must not have changed what is stored.

- [ ] **Step 6: Report**

Per step: the action taken and what happened. Name anything skipped. Anything not produced by a click
or a command is written down as **HONEST NON-PROOF**. Restore `AUTH_DEV_BYPASS=false` and say so.

---

## Not in this plan

- **Storing codes instead of displays.** Removes the seam at its source; costs a data migration plus
  every report grouping on rendered text (`packages/db/src/facility-answers.ts:138`).
- **Merging `local_code` and `national_code`** — slice 2, sketched in the spec.
- **Adoption** — a facility acquiring a national code. Dissolves in slice 2.
- **`page-targets.ts` still requires `localCode`.** Slice 2 rewrites that list.
