import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { createFacility, updateFacility, listPublishedForms, getForm, type Facility } from '@/api';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import type { FormSchema, RuntimeAnswers } from '@/forms-runtime/types';
import { FormSchema as FormSchemaZ } from '@openldr/forms/pure';

interface FacilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facility: Facility | null;
  onSaved: (facility: Facility) => void;
}

/**
 * Build initialAnswers from a Facility, keyed by fieldId, using the schema's apiProperty mapping.
 * Core registry columns (localCode, name, region, …) live on the facility itself; everything else
 * a form field can target was routed by the server into `extras` — see splitFacilityAnswers in
 * packages/db/src/facility-answers.ts, which is the server-side counterpart of this split.
 */
function seedAnswers(schema: FormSchema, facility: Facility): RuntimeAnswers {
  const answers: RuntimeAnswers = {};
  const asRecord = facility as unknown as Record<string, unknown>;
  for (const field of schema.fields) {
    const ap = field.apiProperty;
    if (!ap) continue;
    const value = Object.hasOwn(asRecord, ap) ? asRecord[ap] : facility.extras?.[ap];
    if (value !== undefined && value !== null && value !== '') answers[field.id] = value;
  }
  return answers;
}

export function FacilityDialog({ open, onOpenChange, facility, onSaved }: FacilityDialogProps) {
  const { t } = useTranslation();
  const isEdit = facility !== null;

  const [schema, setSchema] = useState<FormSchema | null>(null);
  // The form-definition id (the id passed to getForm() below, NOT schema.id — that's the schema's
  // own slug). The submit payload's formSchemaId below MUST be this id: the facilities route
  // resolves it via ctx.forms.get(formSchemaId) to read the field list back out, and a
  // schema-slug id simply will not resolve there (see apps/server/src/facilities-routes.ts's
  // fieldsOf()), producing "the submitted form could not be resolved" on every save.
  const [formDefId, setFormDefId] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [noForm, setNoForm] = useState(false);

  const [initialAnswers, setInitialAnswers] = useState<RuntimeAnswers>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ⋯ "Save" menu item lives outside the FormRuntime-rendered <form> (it's in a toolbar row
  // under the SheetHeader, not a footer). Save proxies a click to this hidden submit button so the
  // click still goes through FormRuntime's own <form onSubmit> (and its field validation).
  const hiddenSubmitRef = useRef<HTMLButtonElement>(null);

  // Load the published 'facilities' form schema whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setSchema(null);
    setFormDefId(null);
    setNoForm(false);

    setSchemaLoading(true);
    listPublishedForms('facilities')
      .then(async (summaries) => {
        if (summaries.length === 0) { setNoForm(true); return; }
        const summary = summaries[0];
        const def = await getForm(summary.id);
        const parsed = FormSchemaZ.safeParse(def.schema);
        if (!parsed.success) {
          setNoForm(true);
          setError(`Facility form schema is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
          return;
        }
        const loaded = parsed.data as FormSchema;
        setSchema(loaded);
        setFormDefId(def.id);
        if (facility) setInitialAnswers(seedAnswers(loaded, facility));
        else setInitialAnswers({});
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setSchemaLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facility?.id]);

  const handleSubmit = async (answers: RuntimeAnswers) => {
    if (!schema) return;
    setSaving(true);
    setError(null);
    try {
      const body = { answers, formSchemaId: formDefId, formVersion: schema.version };
      const saved = isEdit ? await updateFacility(facility.id, body) : await createFacility(body);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      // createFacility/updateFacility reject with the server's own message (via okJson/formatApiError)
      // — a duplicate local code, a blank name, or a form that maps no facility field all surface
      // here verbatim rather than a generic "save failed".
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const formReady = !schemaLoading && !noForm && schema !== null;

  const handleMenuSave = () => { hiddenSubmitRef.current?.click(); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{isEdit ? t('facilities.editTitle') : t('facilities.newTitle')}</SheetTitle>
          <SheetDescription>{isEdit ? t('facilities.editDesc') : t('facilities.newDesc')}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-end px-6 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('facilities.actions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!formReady || saving} onClick={handleMenuSave}>
                {saving ? t('common.saving') : isEdit ? t('common.save') : t('common.create')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={saving} onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="border-t border-border" />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {schemaLoading ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : null}

          {formReady && schema ? (
            <FormRuntime
              key={`${schema.id}-${facility?.id ?? 'new'}`}
              schema={schema}
              formDefinitionId={formDefId ?? undefined}
              initialAnswers={initialAnswers}
              onSubmit={handleSubmit}
              footer={<button ref={hiddenSubmitRef} type="submit" className="hidden" aria-hidden="true" />}
            />
          ) : (
            <>
              {noForm && !schemaLoading ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                  {t('facilities.noFormHelp')}
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default FacilityDialog;
