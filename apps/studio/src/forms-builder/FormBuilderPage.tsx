import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AppShell } from '@/shell/AppShell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { createForm, deleteForm, formQuestionnaireUrl, getForm, listFormVersions, publishForm, setFormStatus, updateForm, type FormDefinition } from '../api';
import { createDefaultFormSchema, makeUniqueFieldId, newField } from './builderModel';
import { CompareDialog } from './CompareDialog';
import { FieldEditorSheet } from './FieldEditorSheet';
import { VersionHistorySheet } from './VersionHistorySheet';
import { useTemplateHistory } from './useTemplateHistory';
import { useBuilderKeyboard } from './useBuilderKeyboard';
import { BuilderHeader } from './BuilderHeader';
import { FieldListPane } from './FieldListPane';
import { LanguageControl } from './LanguageControl';
import { PreviewPane } from './PreviewPane';
import {
  lintFormSchema,
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

        {/* Two-pane body (sheet overlays on field select). On phones the field list takes the
            full width and the preview pane is hidden — editing still happens through the
            field-editor sheet — so the 26rem list can't overflow a narrow screen. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: FieldListPane (sections managed via the Sections popover inside it) */}
          <div className="flex w-full shrink-0 flex-col overflow-hidden border-r border-border md:w-[26rem]">
            <FieldListPane
              fields={schema.fields}
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

          {/* Right: PreviewPane (manages its own edge-to-edge scroll). Hidden on phones. */}
          <div className="hidden min-w-0 flex-1 overflow-hidden md:block">
            <PreviewPane schema={schema} />
          </div>
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
      />

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
