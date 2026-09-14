import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppShell } from '@/shell/AppShell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { createForm, deleteForm, formQuestionnaireUrl, getForm, listFormVersions, publishForm, setFormStatus, updateForm, type FormDefinition } from '../api';
import { createDefaultFormSchema, makeUniqueFieldId, newField, slugify } from './builderModel';
import { buildFieldFromElement, buildGroupPart, buildNamedSlot, groupIdForPath, insertFieldAfter, lastPartIdOf } from './newFormFields';
import type { RepeatNode } from './fieldTree';
import { CompareDialog } from './CompareDialog';
import { FieldEditorSheet } from './FieldEditorSheet';
import { VersionHistorySheet } from './VersionHistorySheet';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { BuilderHeader } from './BuilderHeader';
import { FieldListPane } from './FieldListPane';
import { LanguageControl } from './LanguageControl';
import { SubmissionReadiness } from '@/forms-runtime/SubmissionReadiness';
import { PreviewSheet } from './PreviewSheet';
import { LibraryPane } from './LibraryPane';
import { libraryElements } from './libraryEntries';
import { elementDisplayName } from './fhirTypeMap';
import { NARROW_WORKSPACE_PX, useElementWidth } from './useElementWidth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FhirPathInfo } from '@openldr/fhir/paths';
import {
  isSurveyForm,
  lintFormSchema,
  mapsToResource,
  normalizeFormSchema,
  type FormField,
  type FormSchema,
} from '@openldr/forms/pure';

export function FormBuilderPage(): JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const [formId, setFormId] = useState<string | null>(id ?? null);
  const [schema, setSchema] = useState<FormSchema>(() => createDefaultFormSchema(''));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingNewFieldId, setPendingNewFieldId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pane, setPane] = useState<'form' | 'library'>('form');
  const [workspaceRef, workspaceWidth] = useElementWidth<HTMLDivElement>();
  // 0 means not measured yet, which counts as wide. The same test as corlix `FormBuilderPage.tsx:242`.
  const narrow = workspaceWidth > 0 && workspaceWidth < NARROW_WORKSPACE_PX;
  const [status, setStatus] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  const history = useTemplateHistory<FormSchema>(() => schema);

  // ── Load existing form ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void getForm(id)
      .then((loaded) => {
        if (cancelled) return;
        setFormId(loaded.id);
        setStatus(loaded.status);
        setSchema(normalizeFormSchema(loaded.schema));
        void listFormVersions(loaded.id)
          .then((vs) => { if (!cancelled) setPublishedVersion(vs[0]?.version ?? null); })
          .catch(() => { /* the number is a nicety; a failure here must not break the builder */ });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const issues = useMemo(() => lintFormSchema(schema), [schema]);
  const hasErrors = issues.some((i) => i.severity === 'error');

  const selectedField = useMemo<FormField | null>(
    () => schema.fields.find((f) => f.id === selectedId) ?? null,
    [schema.fields, selectedId],
  );

  // ── Schema helpers ───────────────────────────────────────────────────────────
  const patchSchema = (patch: Partial<FormSchema>) => {
    setSchema((prev) => ({ ...prev, ...patch }));
  };

  /** Record an edit in history, then apply a patch to the schema. */
  const updateSchema = (patch: Partial<FormSchema>) => {
    history.recordEdit();
    setSchema((prev) => ({ ...prev, ...patch }));
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  };

  const addField = () => {
    history.pushHistory();
    const nextOrder = schema.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
    const field = newField('New text field', 'text');
    field.order = nextOrder;
    field.id = makeUniqueFieldId(field.id, new Set(schema.fields.map((f) => f.id)));
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, field] }));
    setSelectedId(field.id);
    setPendingNewFieldId(field.id);
  };

  /** Save handler: commit the edited draft to the schema, then close. */
  const handleSheetSave = (updated: FormField) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === updated.id ? updated : f)),
    }));
    setPendingNewFieldId(null);
    setSelectedId(null);
  };

  /** Cancel handler: if the open field was brand-new (never saved), remove it. */
  const handleSheetCancel = () => {
    if (pendingNewFieldId && pendingNewFieldId === selectedId) {
      setSchema((prev) => ({
        ...prev,
        fields: prev.fields.filter((f) => f.id !== pendingNewFieldId),
      }));
    }
    setPendingNewFieldId(null);
    setSelectedId(null);
  };

  const deleteField = (fieldId: string) => {
    // Locked marks a field the form cannot work without, so the `d` shortcut skips it too.
    // Corlix `FormBuilderPage.tsx:606`.
    if (schema.fields.find((f) => f.id === fieldId)?.locked) return;
    history.pushHistory();
    setSchema((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== fieldId) }));
    if (selectedId === fieldId) setSelectedId(null);
  };

  const duplicateField = (fieldId: string) => {
    const src = schema.fields.find((f) => f.id === fieldId);
    if (!src) return;
    history.pushHistory();
    const copy = { ...src, id: `${src.id}-copy-${Date.now()}`, displayLabel: `${src.displayLabel} (copy)`, order: src.order + 0.5 };
    setSchema((prev) => ({ ...prev, fields: [...prev.fields, copy] }));
    setSelectedId(copy.id);
  };

  const toggleEnabled = (fieldId: string) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, enabled: !f.enabled } : f)),
    }));
  };

  const toggleRequired = (fieldId: string) => {
    history.recordEdit();
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, required: !f.required } : f)),
    }));
  };

  const reorderFields = (activeId: string, overId: string) => {
    history.pushHistory();
    setSchema((prev) => {
      const fields = [...prev.fields].sort((a, b) => a.order - b.order);
      const activeIndex = fields.findIndex((f) => f.id === activeId);
      const overIndex = fields.findIndex((f) => f.id === overId);
      if (activeIndex === -1 || overIndex === -1) return prev;
      const [moved] = fields.splice(activeIndex, 1);
      fields.splice(overIndex, 0, moved);
      const reordered = fields.map((f, i) => ({ ...f, order: i }));
      return { ...prev, fields: reordered };
    });
  };

  /** A fresh id for a field made from the structure, unique on the form. */
  const freshId = (label: string) => makeUniqueFieldId(slugify(label), new Set(schema.fields.map((f) => f.id)));

  /** Another slot of a repeating list. One undo step; the new slot opens. It stays on Cancel, as in corlix. */
  const addNamedSlot = (node: RepeatNode) => {
    history.pushHistory();
    const slot = buildNamedSlot(node, freshId('New slot'), 'New slot');
    const anchor = node.slots[node.slots.length - 1].id;
    setSchema((prev) => ({ ...prev, fields: insertFieldAfter(prev.fields, anchor, slot) }));
    setPendingNewFieldId(null);
    setSelectedId(slot.id);
  };

  /** Save the open field's edits, then open another. Corlix `FormBuilderPage.tsx:577-585`. */
  const openField = (id: string, draft: FormField) => {
    history.recordEdit();
    setSchema((prev) => ({ ...prev, fields: prev.fields.map((f) => (f.id === draft.id ? draft : f)) }));
    setPendingNewFieldId(null);
    setSelectedId(id);
  };

  /** Save the group's edits, add a part after its last part, and open the part. One undo step. */
  const addGroupPart = (draft: FormField) => {
    history.pushHistory();
    const part = buildGroupPart(draft, freshId('New part'), 'New part');
    setSchema((prev) => {
      const committed = prev.fields.map((f) => (f.id === draft.id ? draft : f));
      return { ...prev, fields: insertFieldAfter(committed, lastPartIdOf(committed, draft.id), part) };
    });
    setPendingNewFieldId(null);
    setSelectedId(part.id);
  };

  const survey = isSurveyForm(schema.fhirResourceType);
  const elements = useMemo(
    () => (mapsToResource(schema.fhirResourceType) ? libraryElements(schema.fhirResourceType, schema.fields) : []),
    [schema.fhirResourceType, schema.fields],
  );

  /** A Library element becomes a field, inside its parent group when that group is on the form. One undo step. */
  const addFromLibrary = (info: FhirPathInfo) => {
    history.pushHistory();
    const field = buildFieldFromElement(info, freshId(elementDisplayName(info.path)));
    const groupId = groupIdForPath(schema.fields, info.path);
    setSchema((prev) => {
      if (groupId) {
        return { ...prev, fields: insertFieldAfter(prev.fields, lastPartIdOf(prev.fields, groupId), { ...field, groupId }) };
      }
      const nextOrder = prev.fields.reduce((max, f) => Math.max(max, f.order), -1) + 1;
      return { ...prev, fields: [...prev.fields, { ...field, order: nextOrder }] };
    });
    setPendingNewFieldId(null);
    setSelectedId(field.id);
    // On a narrow workspace the new field would otherwise sit behind the Library tab.
    setPane('form');
  };

  const applyHistory = (next: FormSchema | null) => { if (next) setSchema(next); };

  useBuilderKeyboard({
    focusSearch: () => document.getElementById('builder-field-search')?.focus(),
    next: () => undefined,
    previous: () => undefined,
    open: () => undefined,
    toggle: () => undefined,
    duplicate: () => undefined,
    remove: () => { if (selectedId) deleteField(selectedId); },
    selectAll: () => undefined,
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    clear: () => setSelectedId(null),
  });

  // ── API actions ──────────────────────────────────────────────────────────────

  /** The server's own message (via okJson/formatApiError) rather than a generic "failed". */
  const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  /** Newest version number, or null. Never throws: this only drives a caption. */
  const latestVersionOf = async (id: string): Promise<number | null> => {
    try {
      const vs = await listFormVersions(id);
      return vs[0]?.version ?? null;
    } catch {
      return null;
    }
  };

  /**
   * Write the on-screen draft and return what the server stored.
   *
   * Returns the saved form so a caller can act on the id in the same tick. `setFormId` will not
   * have landed yet, so publish-after-create has to read the id from here, not from state.
   */
  const saveDraft = async (): Promise<FormDefinition> => {
    const effectiveName = schema.name.trim() || 'Untitled form';
    const nextSchema: FormSchema = { ...schema, name: effectiveName };
    const payload = {
      name: effectiveName,
      versionLabel: schema.versionLabel ?? null,
      fhirResourceType: schema.fhirResourceType ?? null,
      targetPages: schema.targetPages,
      schema: nextSchema,
    };
    const saved = formId ? await updateForm(formId, payload) : await createForm(payload);
    setStatus(saved.status);
    if (!formId) {
      setFormId(saved.id);
      navigate(`/forms/${saved.id}/builder`, { replace: true });
    }
    return saved;
  };

  const save = async () => {
    try {
      const saved = await saveDraft();
      toast.success(`Saved ${saved.name}`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  };

  /**
   * Publish snapshots the STORED form (`publish()` in packages/forms/src/store.ts reads the row
   * back inside its transaction), so the draft has to reach the server first. Publishing without
   * this saved whatever was last stored and silently dropped every edit made since.
   */
  const publish = async () => {
    try {
      const saved = await saveDraft();
      const published = await publishForm(saved.id, { versionLabel: schema.versionLabel ?? null });
      setStatus(published.status);
      setPublishedVersion(await latestVersionOf(saved.id));
      toast.success(`Published ${published.name}`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  };

  const archive = async () => {
    if (!formId) return;
    try {
      const f = await setFormStatus(formId, 'archived');
      setStatus(f.status);
      toast.success(`Archived ${f.name}`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  };

  // NOTE: a dedicated active-toggle endpoint is future work; for now disable maps to archived.
  const disable = async () => {
    if (!formId) return;
    try {
      const f = await setFormStatus(formId, 'archived');
      setStatus(f.status);
      // Reports the archive, not the menu item. Disable has no endpoint of its own yet, so telling
      // the operator "Disabled" while the status badge turns amber Archived would be a lie.
      toast.success(`Archived ${f.name}`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  };

  const handleDelete = async () => {
    if (!formId) return;
    try {
      await deleteForm(formId);
      // Toasted before the navigate: the Toaster lives at the app root, so the message survives the
      // route change and is waiting on the list the operator lands on.
      toast.success(`Deleted ${schema.name || 'form'}`);
      navigate('/forms');
    } catch (err) {
      toast.error(messageOf(err));
    }
  };

  const exportForm = () => {
    if (!formId) return;
    const a = document.createElement('a');
    a.href = formQuestionnaireUrl(formId);
    a.download = `${schema.name || 'form'}.questionnaire.json`;
    a.click();
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  /** The field list, sections managed through the Sections popover inside it. Placed in both layouts. */
  const listPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <FieldListPane
        fields={schema.fields}
        fhirResourceType={schema.fhirResourceType ?? null}
        onAddSlot={addNamedSlot}
        sections={schema.sections}
        selectedFieldId={selectedId}
        issues={issues}
        onSelect={(f) => setSelectedId(f.id)}
        onToggleEnabled={toggleEnabled}
        onToggleRequired={toggleRequired}
        onDuplicate={duplicateField}
        onDelete={deleteField}
        onReorder={reorderFields}
        onSectionsChange={(sections) => updateSchema({ sections })}
        onFieldsClearSection={(sid) =>
          updateSchema({
            fields: schema.fields.map((f) =>
              f.section === sid ? { ...f, section: undefined } : f,
            ),
          })
        }
      />
    </div>
  );

  return (
    <AppShell title="Form Builder" fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Top: BuilderHeader */}
        <BuilderHeader
          schema={schema}
          issues={issues}
          canPublish={!hasErrors}
          formId={formId}
          status={status}
          publishedVersion={publishedVersion}
          onChange={patchSchema}
          onSave={() => { void save(); }}
          onPublish={() => { void publish(); }}
          onCompare={() => setCompareOpen(true)}
          onVersions={() => setVersionsOpen(true)}
          onAddField={addField}
          onPreview={() => setPreviewOpen(true)}
          onArchive={() => { void archive(); }}
          onDisable={() => { void disable(); }}
          onDelete={() => setConfirmDeleteOpen(true)}
          onExport={exportForm}
          onCancel={() => navigate('/forms')}
          languageSlot={
            <LanguageControl
              languages={schema.languages ?? []}
              onChange={(langs) => patchSchema({ languages: langs })}
            />
          }
        />

        {/* Announce form lifecycle changes (draft → published/archived) and transient errors to
            assistive tech. The status region is visually hidden because the state is already shown
            as a colored dot in the header; the live region gives non-visual users the same update. */}
        <p role="status" aria-live="polite" className="sr-only">
          {status ? `Form status: ${status}` : ''}
        </p>

        {error ? (
          <div role="alert" className="m-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {!loading ? <SubmissionReadiness schema={schema} /> : null}

        {/* Body. The field editor and the preview are sheets over it, so a phone gets both. This
            div is the one measured, so it stays mounted when the layout switches to tabs. */}
        <div ref={workspaceRef} className="flex min-h-0 flex-1 overflow-hidden">
          {narrow && !survey ? (
            <Tabs
              value={pane}
              onValueChange={(v) => setPane(v as 'form' | 'library')}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <TabsList className="shrink-0 px-4">
                <TabsTrigger value="form" className="gap-1.5">
                  Form
                  <span className="rounded-full border border-border px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">{schema.fields.length}</span>
                </TabsTrigger>
                <TabsTrigger value="library" className="gap-1.5">
                  Library
                  <span className="rounded-full border border-border px-1.5 font-mono text-[10px] leading-4 text-muted-foreground">{elements.length}</span>
                </TabsTrigger>
              </TabsList>
              {/* forceMount keeps the list's scroll, drag state and search text across a tab
                  switch. Corlix hides the list rather than unmounting it. */}
              <TabsContent value="form" forceMount className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                {listPane}
              </TabsContent>
              <TabsContent value="library" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                <LibraryPane
                  resourceType={schema.fhirResourceType ?? null}
                  elements={elements}
                  showHeader={false}
                  fullWidth
                  onAddElement={addFromLibrary}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <>
              {listPane}
              {!survey && (
                <LibraryPane
                  resourceType={schema.fhirResourceType ?? null}
                  elements={elements}
                  onAddElement={addFromLibrary}
                />
              )}
            </>
          )}
        </div>
      </div>

      <FieldEditorSheet
        field={selectedField}
        allFields={schema.fields}
        sections={schema.sections}
        languages={schema.languages ?? []}
        fhirResourceType={schema.fhirResourceType ?? null}
        open={selectedId !== null}
        onOpenChange={(o) => { if (!o) handleSheetCancel(); }}
        onSave={handleSheetSave}
        onCancel={handleSheetCancel}
        onOpenField={openField}
        onAddPart={addGroupPart}
      />

      <PreviewSheet schema={schema} open={previewOpen} onOpenChange={setPreviewOpen} />

      <CompareDialog
        formId={formId}
        current={schema}
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />

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

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete form?"
        description="This will permanently delete the form and all its versions. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { void handleDelete(); }}
      />
    </AppShell>
  );
}
