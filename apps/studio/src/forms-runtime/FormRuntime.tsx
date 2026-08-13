import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SuggestCombobox } from '@/components/ui/suggest-combobox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { isMultiValued, resolveReferenceSource } from '@openldr/forms/pure';
import { referenceSearch, referenceSearchPreview } from '@/api';
import type { FieldSuggestions, FormField, FormSchema, FormSection, RuntimeAnswers } from './types';
import { cleanAnswers, fieldLabel, groupChildren, validate, visibleIds } from './runtime';
import { fieldsNeedingResolution, pickSeededMatch, type ResolvableRow } from './seeded-references';
import { ReferencePicker, type ReferenceValue } from './ReferencePicker';

/**
 * Translated copy for `SuggestCombobox`'s listbox chrome — shared by `FormRuntime`, `FieldRow` and
 * `FieldControl` below so the shape is declared exactly once instead of three times as the prop
 * threads down through this file's component split. See `FormRuntime`'s own `suggestCopy` doc
 * comment for why this is a plain optional prop rather than `useTranslation` called in this file.
 */
type SuggestCopy = {
  placeholder?: string;
  loadingLabel?: string;
  noSuggestionsLabel?: string;
  errorFallback?: string;
};

// ── Public component ──────────────────────────────────────────────────────────

export function FormRuntime({
  schema,
  submitLabel = '',
  onSubmit,
  footer,
  initialAnswers,
  fieldWarnings,
  formId,
  formDefinitionId,
  preview,
  fieldSuggestions,
  onAnswersChange,
  suggestCopy,
}: {
  schema: FormSchema;
  submitLabel?: string;
  onSubmit: (answers: RuntimeAnswers) => void | Promise<void>;
  footer?: React.ReactNode;
  initialAnswers?: RuntimeAnswers;
  /** @deprecated No longer used to render markers in preview; kept for API compatibility. */
  fieldWarnings?: Record<string, 'error' | 'warning'>;
  /**
   * DOM id set on the rendered `<form>` element, so a ⋯ menu item outside the form can call
   * `requestSubmit()` on it. This is NOT a form-definition id — see `formDefinitionId`.
   */
  formId?: string;
  /** Id of the stored form definition, used to scope reference searches to this form's fields. */
  formDefinitionId?: string;
  /** Builder live preview: reference fields search the unsaved schema via the preview endpoint. */
  preview?: boolean;
  /**
   * Suggestion state for `suggest` fields, keyed by field id. FormRuntime never fetches these
   * itself — a caller (Task 3/5: a hook backed by the facility-registry distinct-values
   * endpoint) owns the fetch and passes the resulting `{ status, options, error }` down here.
   * Omitting an entry — or the whole prop — degrades to "ready with no suggestions" rather than
   * an infinite loading spinner, so the field stays usable before that wiring exists.
   */
  fieldSuggestions?: FieldSuggestions;
  /**
   * Read-only reporting hook: fires with the current `answers` on mount and after every change.
   * `answers` is otherwise private state a caller has no way to observe — a cascading `suggest`
   * field (Task 5: District scoped by the Region the operator just picked) needs its SIBLING
   * fields' live values to build a fetch scope, not just its own. This does not make FormRuntime
   * a fetcher itself: it only reports state a caller already owns the display of via
   * `fieldSuggestions`, same division of responsibility as that prop's doc comment above.
   */
  onAnswersChange?: (answers: RuntimeAnswers) => void;
  /**
   * Translated copy for `suggest` fields' listbox chrome (loading / empty / error-fallback /
   * placeholder). FormRuntime is schema-driven and has no `useTranslation` of its own — every
   * other piece of on-screen copy it renders comes from the schema (`displayLabel`, `placeholder`,
   * ValueSet `display` text, etc.), never a literal. These four strings are the one exception
   * (`SuggestCombobox`'s own listbox chrome, not schema data), so the caller that DOES have an
   * i18n context — FacilityDialog, today's only `suggest`-field consumer — supplies them here
   * rather than FormRuntime importing `react-i18next` for a single field type. Omitting this prop
   * (or any key in it) falls through to `SuggestCombobox`'s own English defaults.
   */
  suggestCopy?: SuggestCopy;
}): JSX.Element {
  const [answers, setAnswers] = useState<RuntimeAnswers>(initialAnswers ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const visible = useMemo(() => visibleIds(schema, answers), [schema, answers]);

  /**
   * Resolve seeded reference answers back to codings, once per mount.
   *
   * ⛔ WHY THIS EXISTS. A ValueSet-bound reference answer is a coding, but the column it is stored in
   * is `text`, so `splitFacilityAnswers` flattens it to its display
   * (packages/db/src/facility-answers.ts:134-141). Read back, the answer is a bare string — and
   * `validate` (runtime.ts:47-51) requires `{system, code}`. The result was that Save issued NO
   * request at all on EVERY facility, imported or hand-made, while the boxes looked correctly filled
   * because `ReferencePicker` falls back to a value's string form for display. Measured 2026-08-13.
   *
   * Fixed HERE and not by relaxing `validate`: that check is what stops a capture form storing free
   * text where a coded answer is required.
   *
   * Runs once per mount, which is the whole lifetime of a seeded form — callers remount on a record
   * switch (see FacilityDialog's `key`). A failure is swallowed on purpose: the raw string stays, the
   * field reports honestly that a value must be picked, and nothing the operator can see is lost.
   */
  useEffect(() => {
    const pending = fieldsNeedingResolution(schema, initialAnswers ?? {});
    if (pending.length === 0) return;
    // Nothing to scope a search to — the same gate ReferencePicker applies before searching.
    if (!preview && !formDefinitionId) return;

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
            : res.rows.map((r) => ({
              value: { system: r.system, code: r.code, display: r.display },
              display: r.display ?? r.code,
              code: r.code,
            }));
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

  useEffect(() => {
    onAnswersChange?.(answers);
    // Deliberately keyed on `answers` alone: a parent's `onAnswersChange` is typically a fresh
    // closure every render (e.g. FacilityDialog's hook-returned callback), and including it here
    // would fire this on every parent re-render rather than only on an actual answer change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const setField = (fieldId: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
        delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  // Top-level visible fields (excluding group children, which are rendered inside their group).
  const topLevelFields = useMemo(
    () =>
      schema.fields
        .filter((f) => visible.has(f.id) && !f.groupId)
        .sort((a, b) => a.order - b.order),
    [schema.fields, visible],
  );

  // Determine whether to use section grouping.
  // We group when the schema has sections defined OR any field has a section assigned.
  const hasSections = useMemo(
    () =>
      (schema.sections && schema.sections.length > 0) ||
      schema.fields.some((f) => f.section),
    [schema.sections, schema.fields],
  );

  // Build section groups: ordered by section.order, then unsectioned fields at the end.
  const sectionGroups = useMemo(() => {
    if (!hasSections) return null;

    const orderedSections: FormSection[] = (schema.sections ?? [])
      .slice()
      .sort((a, b) => a.order - b.order);

    // Collect any section ids from fields that aren't in schema.sections
    const knownSectionIds = new Set(orderedSections.map((s) => s.id));
    const extraSectionIds: string[] = [];
    for (const f of topLevelFields) {
      if (f.section && !knownSectionIds.has(f.section) && !extraSectionIds.includes(f.section)) {
        extraSectionIds.push(f.section);
      }
    }
    const extraSections: FormSection[] = extraSectionIds.map((id, i) => ({
      id,
      label: id,
      order: orderedSections.length + i,
    }));
    const allSections = [...orderedSections, ...extraSections];

    const groups: Array<{ key: string; label: string | null; fields: FormField[] }> = [];

    for (const section of allSections) {
      const sectionFields = topLevelFields.filter((f) => f.section === section.id);
      if (sectionFields.length === 0) continue;
      groups.push({ key: section.id, label: section.label ?? section.id, fields: sectionFields });
    }

    // Unsectioned fields (no section or unknown section)
    const sectionedFieldIds = new Set(groups.flatMap((g) => g.fields.map((f) => f.id)));
    const unsectioned = topLevelFields.filter((f) => !sectionedFieldIds.has(f.id));
    if (unsectioned.length > 0) {
      groups.push({ key: '__no_section__', label: null, fields: unsectioned });
    }

    return groups;
  }, [hasSections, schema.sections, topLevelFields]);

  function renderFieldRows(fields: FormField[]) {
    return fields.map((field) => (
      <FieldRow
        key={field.id}
        field={field}
        schema={schema}
        answers={answers}
        visible={visible}
        error={errors[field.id]}
        onChange={setField}
        errors={errors}
        formDefinitionId={formDefinitionId}
        preview={preview}
        fieldSuggestions={fieldSuggestions}
        suggestCopy={suggestCopy}
      />
    ));
  }

  return (
    <TooltipProvider>
    <form
      id={formId}
      // Field-level `required` (below) is declared for assistive tech, but native validation UI is
      // disabled so the schema `validate()` wired into onSubmit drives the experience with the
      // app's own inline error messages rather than native browser bubbles.
      noValidate
      className="grid gap-0"
      onSubmit={(event) => {
        event.preventDefault();
        // Wire schema validation to submission: compute field errors, surface them, and only
        // hand off to the caller's onSubmit when the form is valid.
        const nextErrors = validate(schema, answers);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        void onSubmit(cleanAnswers(schema, answers));
      }}
    >
      {sectionGroups ? (
        <>
          {sectionGroups.map(({ key, label, fields }) => (
            <div key={key} className="border-t border-border first:border-t-0">
              {label !== null && (
                <div className="px-6 pt-4 pb-1 mb-1 border-b border-border">
                  <span className="text-sm font-semibold text-foreground">{label}</span>
                </div>
              )}
              <div className="grid gap-4 px-6 py-4">
                {renderFieldRows(fields)}
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className="grid gap-4 px-6 py-4">
          {renderFieldRows(topLevelFields)}
        </div>
      )}
      {footer === undefined ? (
        <div className="px-6 pb-4">
          <Button type="submit">{submitLabel}</Button>
        </div>
      ) : footer}
    </form>
    </TooltipProvider>
  );
}

// ── Field row (label + control) ───────────────────────────────────────────────

function FieldRow({
  field,
  schema,
  answers,
  visible,
  error,
  onChange,
  errors,
  formDefinitionId,
  preview,
  fieldSuggestions,
  suggestCopy,
}: {
  field: FormField;
  schema: FormSchema;
  answers: RuntimeAnswers;
  visible: Set<string>;
  error?: string;
  onChange: (fieldId: string, value: unknown) => void;
  errors: Record<string, string>;
  formDefinitionId?: string;
  preview?: boolean;
  fieldSuggestions?: FieldSuggestions;
  suggestCopy?: SuggestCopy;
}) {
  const label = fieldLabel(field);

  if (field.fieldType === 'group') {
    const children = groupChildren(schema, field.id).filter((c) => visible.has(c.id));
    return (
      <fieldset className="rounded-md border border-border p-3 space-y-3">
        <legend className="px-1 text-sm font-semibold">{label}</legend>
        {children.map((child) => (
          <FieldRow
            key={child.id}
            field={child}
            schema={schema}
            answers={answers}
            visible={visible}
            error={errors[child.id]}
            onChange={onChange}
            errors={errors}
            formDefinitionId={formDefinitionId}
            preview={preview}
            fieldSuggestions={fieldSuggestions}
            suggestCopy={suggestCopy}
          />
        ))}
      </fieldset>
    );
  }

  return (
    <div className="grid gap-1.5 md:grid-cols-[12rem_minmax(0,1fr)] md:items-start">
      <Label htmlFor={field.id} className="pt-2 text-sm flex items-center gap-1 flex-wrap">
        {label}
        {field.required && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground cursor-default"
                aria-label="Required"
              >
                !
              </span>
            </TooltipTrigger>
            <TooltipContent>Required</TooltipContent>
          </Tooltip>
        )}
        {field.description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground cursor-default"
                aria-label={field.description}
              >
                ?
              </span>
            </TooltipTrigger>
            <TooltipContent>{field.description}</TooltipContent>
          </Tooltip>
        ) : null}
      </Label>
      <div>
        <FieldControl
          field={field}
          value={answers[field.id]}
          onChange={(v) => onChange(field.id, v)}
          formDefinitionId={formDefinitionId}
          preview={preview}
          fieldSuggestions={fieldSuggestions}
          suggestCopy={suggestCopy}
        />
        {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

// ── Field control (input rendering by fieldType) ──────────────────────────────

function FieldControl({
  field,
  value,
  onChange,
  formDefinitionId,
  preview,
  fieldSuggestions,
  suggestCopy,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  formDefinitionId?: string;
  preview?: boolean;
  fieldSuggestions?: FieldSuggestions;
  suggestCopy?: SuggestCopy;
}) {
  const label = fieldLabel(field);

  switch (field.fieldType) {
    case 'boolean':
      return (
        <Checkbox
          id={field.id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          aria-label={label}
        />
      );

    case 'select': {
      const current = value != null ? String(value) : '';
      return (
        <Select value={current} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={field.id} className="w-full" aria-label={label} aria-required={field.required || undefined}>
            <SelectValue placeholder={field.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {(field.valueSetOptions ?? []).map((opt) => (
              <SelectItem key={opt.code} value={opt.code}>{opt.display}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : value != null ? [String(value)] : [];
      return (
        <div className="space-y-1">
          {(field.valueSetOptions ?? []).map((opt) => {
            const checked = selected.includes(opt.code);
            return (
              <label key={opt.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    const next = c ? [...selected, opt.code] : selected.filter((s) => s !== opt.code);
                    onChange(next.length > 0 ? next : undefined);
                  }}
                />
                {opt.display}
              </label>
            );
          })}
        </div>
      );
    }

    // Proposes but does not constrain: the answer is always the raw typed string, whether or
    // not it matches a suggestion, so it lands directly in a text column with no flattening.
    case 'suggest': {
      const suggestion = fieldSuggestions?.[field.id];
      return (
        <SuggestCombobox
          id={field.id}
          value={value != null ? String(value) : ''}
          onChange={(v) => onChange(v || undefined)}
          options={suggestion?.options ?? []}
          status={suggestion?.status ?? 'ready'}
          error={suggestion?.error}
          placeholder={field.placeholder ?? suggestCopy?.placeholder}
          loadingLabel={suggestCopy?.loadingLabel}
          noSuggestionsLabel={suggestCopy?.noSuggestionsLabel}
          errorFallback={suggestCopy?.errorFallback}
          label={label}
          required={field.required}
        />
      );
    }

    case 'number': {
      return (
        <div className="flex items-center gap-2">
          <Input
            id={field.id}
            type="number"
            value={value != null ? String(value) : ''}
            placeholder={field.placeholder}
            onChange={(e) => {
              const n = e.target.value === '' ? undefined : Number(e.target.value);
              onChange(n);
            }}
            aria-label={label}
            required={field.required}
          />
          {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
        </div>
      );
    }

    case 'date':
      return (
        <Input
          id={field.id}
          type="date"
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
          required={field.required}
        />
      );

    case 'datetime':
      return (
        <Input
          id={field.id}
          type="datetime-local"
          value={value != null ? String(value) : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value || undefined)}
          aria-label={label}
          required={field.required}
        />
      );

    case 'attachment':
      return (
        <Input
          id={field.id}
          type="file"
          onChange={(e) => onChange(e.target.files?.[0])}
          aria-label={label}
          required={field.required}
        />
      );

    // reference always uses the picker. facility/organism/antibiogram use it only when the
    // field actually declares a source; otherwise they keep the historical text input.
    case 'reference':
    case 'facility':
    case 'organism':
    case 'antibiogram': {
      const resolved = resolveReferenceSource(field);
      if (field.fieldType === 'reference' || resolved.ok) {
        const multiple = isMultiValued(field);
        return (
          <ReferencePicker
            field={field}
            formDefinitionId={formDefinitionId}
            preview={preview}
            multiple={multiple}
            value={(value ?? null) as ReferenceValue | ReferenceValue[] | null}
            onChange={(v) => onChange(v)}
          />
        );
      }
      return (
        <TextFallback
          field={field}
          value={value}
          onChange={onChange}
          label={label}
          placeholder={field.placeholder ?? `Search ${field.fieldType}...`}
        />
      );
    }

    // text, phone, email, address, identifier — all plain text inputs
    default:
      return <TextFallback field={field} value={value} onChange={onChange} label={label} />;
  }
}

// ── Text fallback (shared by the default text-like types and the un-sourced reference stubs) ──

function TextFallback({
  field,
  value,
  onChange,
  label,
  placeholder,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  /** Overrides `field.placeholder` — used by the reference-family fallback's "Search ..." hint. */
  placeholder?: string;
}): JSX.Element {
  return (
    <Input
      id={field.id}
      type={field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : 'text'}
      value={value != null ? String(value) : ''}
      placeholder={placeholder ?? field.placeholder}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-label={label}
      required={field.required}
    />
  );
}
