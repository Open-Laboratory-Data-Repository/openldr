# Forms version history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator see every published version of a form, compare any two, and put an old one back.

**Architecture:** Publishing already writes an immutable snapshot to `form_versions`, and the API already serves it. This adds the missing write direction and the missing screen. Restore is deliberately routed through the existing `update()` so the published-to-draft demotion and the distributed-sync capture behave exactly as they do for a hand edit. No migration, no new capability key, no new diff code.

**Tech Stack:** TypeScript, Kysely, Fastify, Zod, React, shadcn/Radix, Tailwind, vitest, pg-mem, Commander.

**Spec:** `docs/superpowers/specs/2026-09-07-forms-version-history-design.md`

## Global Constraints

- Restore is gated on the existing `forms.edit` capability. Do not add a capability key.
- Do not add a migration. Kysely enforces strict numeric prefix order and a gap blocks boot; other branches are in flight.
- Actions go in a `⋯` `DropdownMenu`. Never a standalone button, never a `SheetFooter` with Cancel/Save.
- Every `<Table>` gets `TablePagination`, including short lists. This is a deliberate operator override of YAGNI.
- shadcn only. No native `<select>`, `<button>`, `<input>`, `<dialog>`.
- `apps/studio/src/forms-builder/` has no i18n. Its strings are hardcoded English. Match the file; do not introduce i18n there. `apps/studio/src/pages/Forms.tsx` does use i18n; if you touch a string there, key it in en, fr and pt.
- No em dashes and no emoji in headings or bullets, in code comments, commit messages or docs.
- Never add `Co-Authored-By` trailers.
- Full gate is `pnpm turbo run test --concurrency=4`. Never pipe turbo through `tail`.
- A gate failure is usually a timeout, not a regression. Grep for `Test timed out` and re-run that package alone before blaming a change.

---

### Task 1: `restore` on the forms store

**Files:**
- Modify: `packages/forms/src/store.ts:423` (the returned object) and add `restore` above it
- Test: `packages/forms/src/store.test.ts`

**Interfaces:**
- Consumes: existing `get`, `getVersion`, `update` in the same closure.
- Produces: `restore(id: string, version: number): Promise<FormDefinition>`. Throws `Error('form not found')` and `Error('version not found')`. Widens `FormStore`, which is `ReturnType<typeof createFormStore>` at `store.ts:426`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('createFormStore', ...)` in `packages/forms/src/store.test.ts`:

```ts
  it('restores a published version back over the current draft', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const v1Schema = schema();
    const created = await store.create({
      name: 'Specimen intake',
      versionLabel: 'v1',
      fhirResourceType: 'Questionnaire',
      targetPages: ['forms'],
      schema: v1Schema,
    });
    await store.publish(created.id, { actorId: 'u1', versionLabel: 'v1' });

    await store.update(created.id, {
      ...created,
      name: 'Specimen intake revised',
      versionLabel: 'v2',
      schema: { ...v1Schema, name: 'Specimen intake revised' },
      targetPages: ['forms', 'specimens'],
    });

    const restored = await store.restore(created.id, 1);

    expect(restored.name).toBe('Specimen intake');
    // The label travels with the schema. v1's fields under v2's label would be the lie this
    // feature exists to remove.
    expect(restored.versionLabel).toBe('v1');
    expect(restored.targetPages).toEqual(['forms']);
    expect((restored.schema as FormSchema).name).toBe('Specimen intake');
  });

  it('drops a published form back to draft when a restore changes its content', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const v1Schema = schema();
    const created = await store.create({
      name: 'Specimen intake',
      fhirResourceType: 'Questionnaire',
      targetPages: ['forms'],
      schema: v1Schema,
    });
    await store.publish(created.id, { actorId: 'u1', versionLabel: 'v1' });
    await store.update(created.id, {
      ...created,
      name: 'Specimen intake revised',
      schema: { ...v1Schema, name: 'Specimen intake revised' },
    });
    const republished = await store.publish(created.id, { actorId: 'u1', versionLabel: 'v2' });
    expect(republished.status).toBe('published');

    const restored = await store.restore(created.id, 1);

    expect(restored.status).toBe('draft');
  });

  it('creates no version row, because restoring is an edit and not a release', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const v1Schema = schema();
    const created = await store.create({
      name: 'Specimen intake',
      fhirResourceType: 'Questionnaire',
      targetPages: ['forms'],
      schema: v1Schema,
    });
    await store.publish(created.id, { actorId: 'u1', versionLabel: 'v1' });
    await store.update(created.id, {
      ...created,
      schema: { ...v1Schema, name: 'Changed' },
    });

    await store.restore(created.id, 1);

    expect(await store.listVersions(created.id)).toHaveLength(1);
  });

  it('refuses a version the form does not have', async () => {
    const db = await makeMigratedDb();
    const store = createFormStore(db);
    const created = await store.create({
      name: 'Specimen intake',
      fhirResourceType: 'Questionnaire',
      targetPages: ['forms'],
      schema: schema(),
    });

    await expect(store.restore(created.id, 7)).rejects.toThrow('version not found');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/forms test`
Expected: FAIL, four tests, with `store.restore is not a function`.

Note: `pnpm --filter <pkg> test -- <path>` does NOT filter to that path in this repo. The whole package runs either way. Read the failure list, do not trust a path argument.

- [ ] **Step 3: Write the implementation**

In `packages/forms/src/store.ts`, add directly above `async function duplicate`:

```ts
  /**
   * Write a published snapshot back over the current draft.
   *
   * Goes through update() rather than writing form_definitions directly, so the
   * published-to-draft demotion (store.ts:301) and the distributed-sync capture both behave
   * exactly as they do for a hand edit. A restore that left a form published while changing its
   * content would leave labs mirroring a body no version row describes.
   *
   * Creates no version row. Snapshots record releases, not edits. The operator publishes
   * afterwards if they want the restored content released, and that publish takes the next number.
   */
  async function restore(id: string, version: number): Promise<FormDefinition> {
    const existing = await get(id);
    if (!existing) throw new Error('form not found');
    const snapshot = await getVersion(id, version);
    if (!snapshot) throw new Error('version not found');
    return update(id, {
      name: snapshot.name,
      versionLabel: snapshot.versionLabel,
      fhirResourceType: snapshot.fhirResourceType,
      fhirVersion: snapshot.fhirVersion,
      fhirProfileUrl: snapshot.fhirProfileUrl,
      facilityId: snapshot.facilityId,
      schema: snapshot.schema,
      targetPages: snapshot.targetPages,
    });
  }
```

Then change the returned object at `store.ts:423` from:

```ts
  return { get, list, listPublished, create, update, setStatus, delete: deleteForm, publish, duplicate, listVersions, getVersion };
```

to:

```ts
  return { get, list, listPublished, create, update, setStatus, delete: deleteForm, publish, duplicate, restore, listVersions, getVersion };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/forms test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/forms/src/store.ts packages/forms/src/store.test.ts
git commit -m "feat(forms): a published version can be written back over the draft"
```

---

### Task 2: The restore route

**Files:**
- Modify: `apps/server/src/forms-routes.ts:209-218` (extract the version guard) and add the route after the versions routes
- Modify: `apps/server/src/forms-routes.test.ts:225` (the hand-written `forms` fake)
- Test: `apps/server/src/forms-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.forms.restore` from Task 1.
- Produces: `POST /api/forms/:id/restore/:version`, gated `forms.edit`, returning the updated `FormDefinition`. 400 on a non-integer version, 404 on unknown form or unknown version. Audits `form.restore` with `metadata.sourceVersion`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/forms-routes.test.ts`:

```ts
  it('restores a version and audits it as form.restore', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/api/forms/${id}/publish`, payload: {} });

    const res = await app.inject({ method: 'POST', url: `/api/forms/${id}/restore/1`, payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it('rejects a version path segment that is not a positive integer', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    const res = await app.inject({ method: 'POST', url: `/api/forms/${id}/restore/abc`, payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/positive integer/);
  });

  it('404s a version the form does not have', async () => {
    const app = authedApp(fakeCtx());
    const created = await app.inject({
      method: 'POST', url: '/api/forms',
      payload: { name: 'Specimen intake', schema: { fields: [] }, targetPages: ['forms'] },
    });
    const id = created.json().id as string;

    const res = await app.inject({ method: 'POST', url: `/api/forms/${id}/restore/9`, payload: {} });

    expect(res.statusCode).toBe(404);
  });

  it('404s an unknown form', async () => {
    const app = authedApp(fakeCtx());

    const res = await app.inject({ method: 'POST', url: '/api/forms/nope/restore/1', payload: {} });

    expect(res.statusCode).toBe(404);
  });
```

`authedApp(ctx, capabilities?)` is at `forms-routes.test.ts:27` and defaults to `ALL_FORMS_CAPS`; `fakeCtx()` is at `:204`. Both already exist. Do not invent a helper.

- [ ] **Step 2: Extend the test fake**

`FormStore` is `ReturnType<typeof createFormStore>`, so Task 1 widened it and this fake no longer satisfies it. Neither the `packages/forms` typecheck nor its tests catch this. In the `forms:` object at `apps/server/src/forms-routes.test.ts:225`, add alongside the existing methods:

```ts
      restore: async (id: string, version: number) => {
        const form = forms.find((item) => item.id === id);
        if (!form) throw new Error('not found');
        // `versions` at line 212 is a Map<string, FormVersion[]> keyed by form id, NOT an array.
        const snapshot = (versions.get(id) ?? []).find((item) => item.version === version);
        if (!snapshot) throw new Error('version not found');
        form.name = snapshot.name;
        form.versionLabel = snapshot.versionLabel;
        form.schema = snapshot.schema;
        form.targetPages = snapshot.targetPages;
        form.status = 'draft';
        return form;
      },
```

Place it beside the existing `listVersions` and `getVersion` fakes, which read the same Map.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @openldr/server test`
Expected: FAIL, four tests, 404 from Fastify because the route does not exist.

- [ ] **Step 4: Extract the version guard**

`apps/server/src/forms-routes.ts:211-218` holds the guard the read route uses. Two routes needing it is the point at which it becomes a helper. Add near the top of the file, beside the other module-level constants:

```ts
/** A `:version` path segment is a positive 32-bit integer or it is a 400, never a cast. */
function parseVersionParam(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) return null;
  return parsed;
}
```

Then rewrite the guard inside `app.get('/api/forms/:id/versions/:version', ...)` to use it:

```ts
    const parsedVersion = parseVersionParam(version);
    if (parsedVersion === null) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
```

Delete the two old `if` blocks it replaces. Keep the error string byte-identical; existing tests assert on it.

- [ ] **Step 5: Add the route**

Immediately after `app.get('/api/forms/:id/versions/:version', ...)`:

```ts
  // EDIT, not PUBLISH. Restore writes a draft; it releases nothing. The operator publishes
  // afterwards through the normal gate if they want the restored content live.
  app.post('/api/forms/:id/restore/:version', EDIT, async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    const parsedVersion = parseVersionParam(version);
    if (parsedVersion === null) {
      reply.code(400);
      return { error: 'version must be a positive integer' };
    }
    const before = await ctx.forms.get(id);
    if (!before) {
      reply.code(404);
      return { error: 'not found' };
    }
    if (!(await ctx.forms.getVersion(id, parsedVersion))) {
      reply.code(404);
      return { error: 'version not found' };
    }
    const after = await ctx.forms.restore(id, parsedVersion);
    await recordAudit(ctx, req, {
      action: 'form.restore', entityType: 'form', entityId: id,
      before, after, metadata: { sourceVersion: parsedVersion },
    });
    return after;
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/server test`
Expected: PASS, 0 failures.

- [ ] **Step 7: Lint**

`apps/server` is the only package with real lint, and it enforces the return/await `reply.send` rule that stops gzip clobbering the response.

Run: `pnpm --filter @openldr/server lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/forms-routes.ts apps/server/src/forms-routes.test.ts
git commit -m "feat(forms): a route to put a published version back"
```

---

### Task 3: The version history sheet

**Files:**
- Modify: `apps/studio/src/api.ts` (add `restoreFormVersion` beside `getFormVersion` at line 1872)
- Create: `apps/studio/src/forms-builder/VersionHistorySheet.tsx`
- Create: `apps/studio/src/forms-builder/VersionHistorySheet.test.tsx`
- Modify: `apps/studio/src/forms-builder/BuilderHeader.tsx` (a `Versions` item in the ⋯ menu)
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx` (mount the sheet, apply a restore)
- Test: `apps/studio/src/forms-builder/FormBuilderPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/forms/:id/restore/:version` from Task 2; `listFormVersions`, `FormVersionSummary` already in `api.ts`.
- Produces: `restoreFormVersion(id: string, version: number): Promise<FormDefinition>`; `<VersionHistorySheet formId open onOpenChange onRestored />` where `onRestored: (form: FormDefinition) => void`; an `onVersions: () => void` prop on `BuilderHeader`.

- [ ] **Step 1: Add the API client function**

In `apps/studio/src/api.ts`, directly after `getFormVersion`:

```ts
export const restoreFormVersion = (id: string, version: number): Promise<FormDefinition> =>
  authFetch(`/api/forms/${id}/restore/${version}`, jbody({}, 'POST')).then((r) => okJson<FormDefinition>(r, 'restore form version'));
```

- [ ] **Step 2: Write the failing sheet test**

Create `apps/studio/src/forms-builder/VersionHistorySheet.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { VersionHistorySheet } from './VersionHistorySheet';
import * as api from '../api';

const NOW = '2026-01-01T00:00:00.000Z';

function version(v: number, label: string | null) {
  return {
    id: `fv-${v}`, formId: 'form-1', version: v, versionLabel: label,
    name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'],
    publishedAt: NOW, publishedBy: 'u1',
  };
}

describe('VersionHistorySheet', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('lists versions newest first', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([version(2, 'v2'), version(1, 'v1')]);

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);

    expect(await screen.findByText('v2')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('v2');
    expect(rows[1]).toHaveTextContent('v1');
  });

  it('confirms before restoring, then reports it', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([version(1, 'v1')]);
    const restore = vi.spyOn(api, 'restoreFormVersion').mockResolvedValue({
      id: 'form-1', name: 'Specimen intake', versionLabel: 'v1', fhirResourceType: null,
      status: 'draft', active: true, schema: { fields: [] }, targetPages: ['forms'],
      createdAt: NOW, updatedAt: NOW,
    });

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);
    expect(await screen.findByText('v1')).toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: /actions for version 1/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Restore')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Restore'));

    // Nothing is written until the confirm is answered.
    expect(restore).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith('form-1', 1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restored version 1'));
  });

  it('a rejected restore surfaces the server message', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([version(1, 'v1')]);
    vi.spyOn(api, 'restoreFormVersion').mockRejectedValue(new Error('restore form version: forms.edit required'));

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);
    expect(await screen.findByText('v1')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /actions for version 1/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Restore')) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Restore'));
    fireEvent.click(await screen.findByRole('button', { name: /^restore$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('restore form version: forms.edit required'),
    );
  });

  it('shows an empty state and no table header when the form has never been published', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);

    render(<VersionHistorySheet formId="form-1" open onOpenChange={() => {}} onRestored={() => {}} />);

    expect(await screen.findByText(/never been published/i)).toBeInTheDocument();
    // StripedEmpty renders its children, so assert on the copy, not on a title prop.
    // An empty table's header forces intrinsic width and scrolls sideways on a phone.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @openldr/studio test`
Expected: FAIL, cannot resolve `./VersionHistorySheet`.

- [ ] **Step 4: Write the sheet**

Open `apps/studio/src/forms-builder/FieldEditorSheet.tsx` first and copy its `Sheet` shape, then create `apps/studio/src/forms-builder/VersionHistorySheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingState } from '@/components/ui/spinner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { listFormVersions, restoreFormVersion, type FormDefinition, type FormVersionSummary } from '../api';

export interface VersionHistorySheetProps {
  formId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The builder replaces its schema state with the restored form. */
  onRestored: (form: FormDefinition) => void;
}

// Deliberately no onCompare. Task 4 lets the Compare dialog pick any version on either side,
// so a second route into it from here would be a duplicate path to the same screen.

export function VersionHistorySheet({
  formId, open, onOpenChange, onRestored,
}: VersionHistorySheetProps): JSX.Element {
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [pendingRestore, setPendingRestore] = useState<FormVersionSummary | null>(null);

  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    setLoading(true);
    void listFormVersions(formId)
      .then((loaded) => { if (!cancelled) setVersions(loaded); })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, formId]);

  const total = versions.length;
  const shown = versions.slice(page * pageSize, page * pageSize + pageSize);

  const confirmRestore = async () => {
    if (!formId || !pendingRestore) return;
    const version = pendingRestore.version;
    try {
      const restored = await restoreFormVersion(formId, version);
      onRestored(restored);
      toast.success(`Restored version ${version}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingRestore(null);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Version history</SheetTitle>
          </SheetHeader>

          {loading ? (
            <LoadingState />
          ) : total === 0 ? (
            // Stripes imply emptiness, so they never show while loading. An empty table's header
            // forces intrinsic width and scrolls sideways on a phone, so render no table at all.
            <StripedEmpty className="min-h-[16rem]">
              This form has never been published. Publishing takes a snapshot you can come back to.
            </StripedEmpty>
          ) : (
            <>
              <div className="min-h-0 flex-1">
                <Table wrapperClassName="min-h-0 flex-1">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Published</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{v.version}</TableCell>
                        <TableCell className="text-muted-foreground">{v.versionLabel || '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(v.publishedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Actions for version ${v.version}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setPendingRestore(v)}>
                                Restore
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={pendingRestore !== null}
        onOpenChange={(o) => { if (!o) setPendingRestore(null); }}
        title={pendingRestore ? `Restore version ${pendingRestore.version}?` : 'Restore version?'}
        description="This replaces the form you are editing. A published form goes back to draft. You can undo it in the builder."
        confirmLabel="Restore"
        destructive
        onConfirm={() => { void confirmRestore(); }}
      />
    </>
  );
}
```

`StripedEmpty` takes only `children` and `className`; there is no `title` or `description` prop. Its
`min-h-[16rem]` matches the data state so the sheet does not jump between the two.

- [ ] **Step 5: Run the sheet test to verify it passes**

Run: `pnpm --filter @openldr/studio test`
Expected: the four `VersionHistorySheet` tests PASS.

- [ ] **Step 6: Write the failing wiring test**

Add to `apps/studio/src/forms-builder/FormBuilderPage.test.tsx`:

```tsx
  it('Versions: ⋯ → Versions opens the history sheet', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Versions'));

    expect(await screen.findByText('Version history')).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @openldr/studio test`
Expected: FAIL, no menu item named `Versions`.

- [ ] **Step 8: Wire it into the builder**

In `apps/studio/src/forms-builder/BuilderHeader.tsx`, add `onVersions: () => void;` to `BuilderHeaderProps`, accept it in the destructured parameters, and add a menu item directly after the existing `Compare` item:

```tsx
              <DropdownMenuItem disabled={!formId} onSelect={() => onVersions()}>
                Versions
              </DropdownMenuItem>
```

In `apps/studio/src/forms-builder/FormBuilderPage.tsx`:

Add the import:

```tsx
import { VersionHistorySheet } from './VersionHistorySheet';
```

Add the state beside `compareOpen`:

```tsx
  const [versionsOpen, setVersionsOpen] = useState(false);
```

Pass the prop on `<BuilderHeader>`, next to `onCompare`:

```tsx
          onVersions={() => setVersionsOpen(true)}
```

Mount the sheet next to `<CompareDialog>`:

```tsx
      <VersionHistorySheet
        formId={formId}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        onRestored={(form) => {
          // pushHistory, not recordEdit: restore must be undoable with the keyboard like every
          // other builder action. Without it, restore is the one change you cannot take back,
          // which is the opposite of what a version history is for.
          history.pushHistory();
          setSchema(normalizeFormSchema(form.schema));
          setStatus(form.status);
        }}
      />
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS, 0 failures.

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @openldr/studio typecheck`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/forms-builder/VersionHistorySheet.tsx apps/studio/src/forms-builder/VersionHistorySheet.test.tsx apps/studio/src/forms-builder/BuilderHeader.tsx apps/studio/src/forms-builder/FormBuilderPage.tsx apps/studio/src/forms-builder/FormBuilderPage.test.tsx
git commit -m "feat(forms): a version history you can open and go back from"
```

---

### Task 4: Compare between any two

**Files:**
- Modify: `apps/studio/src/forms-builder/CompareDialog.tsx:28-100`
- Create: `apps/studio/src/forms-builder/CompareDialog.test.tsx`

**Interfaces:**
- Consumes: `listFormVersions`, `getFormVersion`, `diffFormSchemas` (all already imported there).
- Produces: no new exported signature. `CompareDialogProps` is unchanged, so `FormBuilderPage` needs no edit.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/forms-builder/CompareDialog.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompareDialog } from './CompareDialog';
import * as api from '../api';
import { normalizeFormSchema } from '@openldr/forms/pure';

const NOW = '2026-01-01T00:00:00.000Z';

function summary(v: number, label: string) {
  return {
    id: `fv-${v}`, formId: 'form-1', version: v, versionLabel: label,
    name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'],
    publishedAt: NOW, publishedBy: 'u1',
  };
}

function snapshot(v: number, fieldId: string) {
  return {
    ...summary(v, `v${v}`),
    questionnaire: {},
    schema: { id: 'specimen-intake', name: 'Specimen intake', fields: [{ id: fieldId, displayLabel: fieldId, fieldType: 'text' }], sections: [] },
  };
}

const draft = normalizeFormSchema({
  id: 'specimen-intake', name: 'Specimen intake',
  fields: [{ id: 'draftOnly', displayLabel: 'draftOnly', fieldType: 'text' }], sections: [],
});

describe('CompareDialog', () => {
  it('defaults to newest published against the current draft', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([summary(2, 'v2'), summary(1, 'v1')]);
    vi.spyOn(api, 'getFormVersion').mockImplementation(async (_id, v) => snapshot(v, `v${v}Field`) as never);

    render(<CompareDialog formId="form-1" current={draft} open onOpenChange={() => {}} />);

    await waitFor(() => expect(api.getFormVersion).toHaveBeenCalledWith('form-1', 2));
    expect(await screen.findByText(/draftOnly/)).toBeInTheDocument();
  });

  it('compares two published versions when both sides are chosen', async () => {
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([summary(2, 'v2'), summary(1, 'v1')]);
    const get = vi.spyOn(api, 'getFormVersion').mockImplementation(async (_id, v) => snapshot(v, `v${v}Field`) as never);

    render(<CompareDialog formId="form-1" current={draft} open onOpenChange={() => {}} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 2));

    // Right side moves off the draft and onto v1.
    fireEvent.click(screen.getByLabelText('Compare to'));
    fireEvent.click(await screen.findByRole('option', { name: /v1/ }));

    await waitFor(() => expect(get).toHaveBeenCalledWith('form-1', 1));
    expect(await screen.findByText(/v1Field/)).toBeInTheDocument();
    expect(screen.queryByText(/draftOnly/)).not.toBeInTheDocument();
  });
});
```

Radix `Select` dismisses on the capture phase in jsdom. If `fireEvent.click` does not open the listbox, use `fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })` followed by `fireEvent.keyDown(trigger, { key: 'Enter' })`, which is the idiom the rest of this repo's tests already use for Radix menus.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/studio test`
Expected: FAIL. The dialog has no `Compare to` control, and it never calls `getFormVersion` with 1.

- [ ] **Step 3: Rewrite the dialog's selection**

Replace the state and effect in `apps/studio/src/forms-builder/CompareDialog.tsx` (currently lines 29-51) with two sides. `'draft'` is the sentinel for the live draft; a number is a version.

```tsx
type Side = 'draft' | number;

/** Resolve one side of the comparison to a schema. */
async function sideSchema(formId: string, side: Side, current: FormSchema): Promise<FormSchema> {
  if (side === 'draft') return current;
  const snapshot = await getFormVersion(formId, side);
  return normalizeFormSchema(snapshot.schema);
}
```

Inside the component:

```tsx
  const [versions, setVersions] = useState<FormVersionSummary[]>([]);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [left, setLeft] = useState<Side | null>(null);
  const [right, setRight] = useState<Side>('draft');

  // Load the version list once per open, and seed the left side with the newest published
  // version so the dialog opens on exactly what it used to show.
  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    void listFormVersions(formId).then((loaded) => {
      if (cancelled) return;
      setVersions(loaded);
      setLeft(loaded[0] ? loaded[0].version : null);
      setRight('draft');
    });
    return () => { cancelled = true; };
  }, [open, formId]);

  // Recompute whenever either side moves.
  useEffect(() => {
    if (!open || !formId || left === null) return;
    let cancelled = false;
    void Promise.all([sideSchema(formId, left, current), sideSchema(formId, right, current)])
      .then(([before, after]) => {
        if (!cancelled) setRows(flattenDiff(diffFormSchemas(before, after)));
      });
    return () => { cancelled = true; };
  }, [open, formId, left, right, current]);
```

Render two `Select` controls in the dialog header, above the row list. Options are every version plus `Current draft`:

```tsx
          <div className="mt-3 flex items-center gap-2">
            <Select
              value={String(left ?? '')}
              onValueChange={(v) => setLeft(v === 'draft' ? 'draft' : Number(v))}
            >
              <SelectTrigger className="w-44 text-xs" aria-label="Compare from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Current draft</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)}>
                    {v.versionLabel ? `v${v.version} (${v.versionLabel})` : `v${v.version}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">to</span>
            <Select
              value={right === 'draft' ? 'draft' : String(right)}
              onValueChange={(v) => setRight(v === 'draft' ? 'draft' : Number(v))}
            >
              <SelectTrigger className="w-44 text-xs" aria-label="Compare to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Current draft</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={String(v.version)}>
                    {v.versionLabel ? `v${v.version} (${v.versionLabel})` : `v${v.version}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

Keep the existing empty states. `No published versions yet` now keys off `versions.length === 0` rather than `!latest`.

Add `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` to the imports from `@/components/ui/select`, and `FormVersionSummary` is already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS, 0 failures. The existing `Compare: opens ⋯ → Compare → CompareDialog opens` test in `FormBuilderPage.test.tsx` must still pass; it mocks `listFormVersions` to `[]`.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/forms-builder/CompareDialog.tsx apps/studio/src/forms-builder/CompareDialog.test.tsx
git commit -m "feat(forms): compare any two versions, not just the newest"
```

---

### Task 5: The header stops lying

**Files:**
- Modify: `apps/studio/src/forms-builder/BuilderHeader.tsx:206-216` (the label) and `:180-204` (the status area)
- Modify: `apps/studio/src/forms-builder/FormBuilderPage.tsx` (pass the published version down)
- Test: `apps/studio/src/forms-builder/BuilderHeader.test.tsx`

**Interfaces:**
- Consumes: `listFormVersions` from `api.ts`.
- Produces: a `publishedVersion?: number | null` prop on `BuilderHeader`.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/forms-builder/BuilderHeader.test.tsx`, matching however that file already builds its props object:

```tsx
  it('labels the free-text field as a label, not the version number', () => {
    renderHeader();
    expect(screen.getByLabelText('Version label')).toBeInTheDocument();
  });

  it('shows the published version number next to the status', () => {
    renderHeader({ status: 'published', publishedVersion: 3 });
    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('shows no version number before the form has ever been published', () => {
    renderHeader({ status: 'draft', publishedVersion: null });
    expect(screen.queryByText(/^v\d+$/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @openldr/studio test`
Expected: FAIL. The field is labelled `Version label` nowhere, and no `v3` renders.

- [ ] **Step 3: Change the header**

In `apps/studio/src/forms-builder/BuilderHeader.tsx`, add to `BuilderHeaderProps`:

```tsx
  /** Newest published version number, or null when the form has never been published.
   *  The box beside it is a free-text LABEL; this is the number the snapshot actually has. */
  publishedVersion?: number | null;
```

Accept it in the destructured parameters. Widen the version column and relabel it:

```tsx
        {/* Version label. Free text, and deliberately not the version number: the number is
            assigned by publish and shown next to the status dot. */}
        <div className="w-32 space-y-1">
          <Label className="text-xs" htmlFor="builder-version">Version label</Label>
          <Input
            id="builder-version"
            aria-label="Version label"
            value={schema.versionLabel ?? ''}
            placeholder="e.g. v1"
            onChange={(e) => onChange({ versionLabel: e.target.value })}
          />
        </div>
```

Directly after the status dot's `TooltipProvider` block, add:

```tsx
          {publishedVersion != null ? (
            <span className="mb-3 shrink-0 text-xs font-medium text-muted-foreground">
              v{publishedVersion}
            </span>
          ) : null}
```

- [ ] **Step 4: Feed it from the page**

In `apps/studio/src/forms-builder/FormBuilderPage.tsx`, add state and a load, and pass it down. Refresh it after a publish so the number moves when the operator publishes.

```tsx
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
```

Add to the existing load effect, after `setSchema(...)`:

```tsx
        void listFormVersions(loaded.id)
          .then((vs) => { if (!cancelled) setPublishedVersion(vs[0]?.version ?? null); })
          .catch(() => { /* the number is a nicety; a failure here must not break the builder */ });
```

In `publish()`, after `setStatus(published.status)`:

```tsx
      setPublishedVersion(await latestVersionOf(saved.id));
```

with, beside `messageOf`:

```tsx
  /** Newest version number, or null. Never throws: this only drives a caption. */
  const latestVersionOf = async (id: string): Promise<number | null> => {
    try {
      const vs = await listFormVersions(id);
      return vs[0]?.version ?? null;
    } catch {
      return null;
    }
  };
```

Add `listFormVersions` to the import from `../api`, and pass `publishedVersion={publishedVersion}` on `<BuilderHeader>`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS, 0 failures. Existing `BuilderHeader` tests that query `Version` by exact label will need updating to `Version label`; that is the point of the change, not a regression.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/forms-builder/BuilderHeader.tsx apps/studio/src/forms-builder/BuilderHeader.test.tsx apps/studio/src/forms-builder/FormBuilderPage.tsx
git commit -m "feat(forms): the header shows the real version, and the label says it is a label"
```

---

### Task 6: CLI parity

**Files:**
- Modify: `packages/cli/src/forms.ts`
- Modify: `packages/cli/src/program.ts:626-640`
- Test: `packages/cli/src/forms.test.ts` (create if absent), `packages/cli/src/forms-lint-cli-parsing.test.ts`

**Interfaces:**
- Consumes: `ctx.forms.listVersions`, `ctx.forms.restore` from Task 1.
- Produces: `runFormsVersions(id: string, opts: { json: boolean }): Promise<number>` and `runFormsRestore(id: string, version: string, opts: { json: boolean; force: boolean }): Promise<number>`. Both return a process exit code.

- [ ] **Step 1: Write the failing tests**

Labs run headless, so these are the only way an operator sees this feature without a browser.

```ts
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
  restore: vi.fn(),
  recordAuditEvent: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: async () => ({
    forms: { listVersions: mocks.listVersions, restore: mocks.restore },
    audit: {}, logger: {}, close: mocks.close,
  }),
  recordAuditEvent: mocks.recordAuditEvent,
}));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runFormsRestore, runFormsVersions } from './forms';

describe('runFormsVersions', () => {
  it('lists versions newest first', async () => {
    mocks.listVersions.mockResolvedValue([
      { version: 2, versionLabel: 'v2', publishedAt: '2026-01-02T00:00:00.000Z' },
      { version: 1, versionLabel: 'v1', publishedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(await runFormsVersions('form-1', { json: true })).toBe(0);
  });
});

describe('runFormsRestore', () => {
  it('refuses without --force and writes nothing', async () => {
    expect(await runFormsRestore('form-1', '1', { json: false, force: false })).toBe(1);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('rejects a version that is not a positive integer', async () => {
    expect(await runFormsRestore('form-1', 'abc', { json: false, force: true })).toBe(1);
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it('restores with --force and audits as the cli actor', async () => {
    mocks.restore.mockResolvedValue({ id: 'form-1', name: 'Specimen intake', status: 'draft' });

    expect(await runFormsRestore('form-1', '1', { json: false, force: true })).toBe(0);

    expect(mocks.restore).toHaveBeenCalledWith('form-1', 1);
    // actorType, NOT actorName. cliActor() returns the OS username and only falls back to 'cli'
    // when it cannot read one, so asserting the name passes on CI and fails on a dev machine.
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'form.restore' }),
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @openldr/cli test`
Expected: FAIL, `runFormsVersions` and `runFormsRestore` are not exported.

- [ ] **Step 3: Write the commands**

In `packages/cli/src/forms.ts`, add the imports `recordAuditEvent` to the existing `@openldr/bootstrap` import and `import { cliActor } from './cli-actor';`, then:

```ts
export async function runFormsVersions(id: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const versions = await ctx.forms.listVersions(id);
    if (opts.json) {
      process.stdout.write(JSON.stringify(versions, null, 2) + '\n');
    } else {
      const lines = versions.map((v) => `${v.version}\t${v.versionLabel ?? ''}\t${v.publishedAt}`);
      process.stdout.write((lines.length ? lines.join('\n') : '(no published versions)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}

/**
 * Put a published version back over the current draft.
 *
 * Destructive: it overwrites the stored draft and drops a published form back to draft, so it
 * refuses without --force, the same discipline every other destructive command here follows.
 */
export async function runFormsRestore(
  id: string,
  version: string,
  opts: { json: boolean; force: boolean },
): Promise<number> {
  if (!/^[1-9]\d*$/.test(version)) {
    process.stderr.write('version must be a positive integer\n');
    return 1;
  }
  if (!opts.force) {
    process.stderr.write(
      `refusing to overwrite the draft of ${id} with version ${version}; re-run with --force\n`,
    );
    return 1;
  }
  const parsed = Number(version);
  const ctx = await createAppContext(loadConfig());
  try {
    const restored = await ctx.forms.restore(id, parsed);
    await recordAuditEvent(ctx, cliActor(), {
      action: 'form.restore', entityType: 'form', entityId: id,
      before: null, after: restored, metadata: { sourceVersion: parsed },
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(restored, null, 2) + '\n');
    } else {
      process.stdout.write(`restored ${id} to version ${parsed} (now ${restored.status})\n`);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
```

- [ ] **Step 4: Register them**

In `packages/cli/src/program.ts`, add both to the `runFormsExtract, runFormsList, runFormsLint` import at line 8, then after the `forms lint` registration:

```ts
  forms
    .command('versions <id>')
    .description('List the published versions of one form, newest first')
    .option('--json', 'emit JSON', false)
    .action(async (id: string, opts: { json: boolean }) => {
      try { process.exitCode = await runFormsVersions(id, opts); }
      catch (err) { process.stderr.write(`forms versions failed: ${redactError(err)}\n`); process.exitCode = 1; }
    });
  forms
    .command('restore <id> <version>')
    .description('Put a published version back over the current draft')
    .option('--json', 'emit JSON', false)
    .option('--force', 'confirm overwriting the current draft', false)
    .action(async (id: string, version: string, opts: { json: boolean; force: boolean }) => {
      try { process.exitCode = await runFormsRestore(id, version, opts); }
      catch (err) { process.stderr.write(`forms restore failed: ${redactError(err)}\n`); process.exitCode = 1; }
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @openldr/cli test`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/forms.ts packages/cli/src/program.ts packages/cli/src/forms.test.ts
git commit -m "feat(cli): list a form's versions and put one back"
```

---

### Task 7: Docs, the gate, mobile, changelog

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/forms.md`

- [ ] **Step 1: Document it**

`fr` and `pt` have no `forms.md`, and the docs registry falls back to English at `registry.ts:351`, so the English file is the whole job. Add after the existing Compare step, renumbering what follows:

```markdown
17. Use **Versions** to see every published version, newest first, with the date each was released.
18. From a version's actions, choose **Restore** to put it back. This replaces the form you are
    editing, and a published form goes back to draft. Undo in the builder reverses it, and nothing
    reaches users until you publish again.
```

Add to Troubleshooting:

```markdown
- **The Version label box does not change the version number:** it never did. The number is
  assigned when you publish, and is shown next to the status. The box is a free-text caption.
- **Versions is greyed out:** the form has not been saved yet, so it has no versions.
```

- [ ] **Step 2: Run the full gate**

Never pipe turbo through `tail`; it truncates the failure list and hides which package failed.

Run: `pnpm turbo run test --concurrency=4`
Expected: all tasks successful.

If a package fails, grep the output for `Test timed out` before blaming a change, and re-run that package alone.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm turbo run typecheck --concurrency=4`
Run: `pnpm --filter @openldr/server lint`
Expected: both clean.

- [ ] **Step 4: Mobile pass**

Start this session's own dev server rather than reusing another one, then set the viewport to 375x812 and open the builder.

Check: the ⋯ menu reaches Versions without clipping; the sheet's table scrolls inside its own container and the page body does not scroll sideways; `TablePagination` stays reachable; the Compare selects are tappable; the confirm dialog fits.

Four traps that all cost time on the last mobile pass:
- `Table`'s scroll wrapper needs `wrapperClassName="min-h-0 flex-1"` and a flex-column parent, and the fill must be gated on having rows, or the loader splits the pane 50/50.
- An empty table's header forces intrinsic width and scrolls sideways. The sheet already renders no `<Table>` when there are no versions; keep it that way.
- A portalled `PopoverContent` inside a `Sheet` cannot scroll, because `react-remove-scroll` only allows the Sheet's own subtree.
- Radix hides an inactive `TabsContent` with `hidden`, but a `flex` class outranks the zero-specificity `:where()` rule. Not used here, but check if you add tabs.

Headless Chromium cannot see the `100vh` versus `100dvh` class of bug, because it has no retractable URL bar, so every bottom-edge check passes either way. If anything you touch is bottom-anchored, say only a real phone can confirm it. Do not report it verified.

- [ ] **Step 5: Commit the docs**

```bash
git add apps/studio/src/docs/0.1.0/en/forms.md
git commit -m "docs(forms): version history, restore, and what the version label is not"
```

- [ ] **Step 6: Merge and changelog**

Merge to local `main` first, then sync to origin and confirm the origin SHA. Run the changelog generator only after the merge; it reads git history and cannot see commits that are not there yet.

```bash
pnpm make:changelog
```

Commit `apps/web/src/landing/changelog.json`. It is not build output and nothing regenerates it.

Note: `main` may be checked out by another session's worktree. If `git push . HEAD:main` is refused, that is the protection working. Do not force it. Either ask for that checkout to be freed, or use `git push --receive-pack="git -c receive.denyCurrentBranch=updateInstead receive-pack" . HEAD:main`, which refuses safely if the receiving tree is dirty.

---

## Notes for the executor

**Read the spec.** `docs/superpowers/specs/2026-09-07-forms-version-history-design.md` carries the RULE 0 pass. If a premise there turns out to be wrong, stop and say so rather than working around it.

**The publisher's name is deliberately absent.** `published_by` holds an actor id, and rendering a raw id helps nobody. Resolving it needs `listUsers`, gated on a capability a forms editor need not hold. Do not add a column for it without asking.

**Do not add a migration.** Everything this needs already exists in `form_versions`.

**`pnpm --filter <pkg> test -- <path>` does not filter.** The whole package runs. Read the failure list.
