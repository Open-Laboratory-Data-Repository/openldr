import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  createFacility, updateFacility, listPublishedForms, getForm, listFacilityImportSources, getFacilityHistory,
  type Facility, type FacilityRegisterSource,
} from '@/api';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import { visibleIds } from '@/forms-runtime/runtime';
import type { FieldSuggestions, FormSchema, RuntimeAnswers } from '@/forms-runtime/types';
import { FormSchema as FormSchemaZ } from '@openldr/forms/pure';
// A dedicated subpath (NOT the package root, which pulls in `pg`/kysely and the rest of the
// server DB engine) so this stays a zero-dependency browser-safe import — `facility-answers.ts`
// only has an `import type` on `FacilityRecord`, which TypeScript erases entirely at compile time.
import { CORE_FACILITY_KEYS } from '@openldr/db/facility-answers';
import { useFacilityAdminSuggestions } from './useFacilityAdminSuggestions';

/** Task 10: "last import" formatting for the provenance panel — same locale-formatted-with-raw-
 *  fallback convention as Facilities.tsx's own `formatBuildTime` and FacilityHistory.tsx's own
 *  `formatOccurredAt` (not imported: each of these three is a tiny, independently-testable local
 *  helper over the same one-line `Date` idiom, not worth a shared module for). */
function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface FacilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facility: Facility | null;
  onSaved: (facility: Facility) => void;
}

/**
 * Build initialAnswers from a Facility, keyed by fieldId, using the schema's apiProperty mapping.
 *
 * Mirrors splitFacilityAnswers' own key choice exactly (packages/db/src/facility-answers.ts, the
 * server-side counterpart of this split) rather than re-deriving it:
 *   - apiProperty in CORE_FACILITY_KEYS  → the value lives on the facility itself (record column).
 *   - apiProperty set but NOT core       → extras[apiProperty].
 *   - no apiProperty at all              → extras[field.id].
 *
 * The last case matters as much as the first two: a field with no apiProperty is never a record
 * column, so skipping it here — as an earlier version of this function did — means
 * Edit-then-Save-without-touching submits no answer for that field at all, and PUT replaces
 * `extras` wholesale, silently deleting it. The 8-field Facility form seeded by migration 071 gives
 * every field a core apiProperty, so this path is inert on it today; it matters for an
 * operator-authored field added later in the builder that maps to no core column (the historical
 * pre-071 seed shipped several such fields, which is where this guard was first proven necessary).
 * Using CORE_FACILITY_KEYS (rather than `Object.hasOwn(asRecord, ap)`) also keeps this in lockstep
 * with the server's own key set — the facility object's own `id`/`extras`/`managedOrigin`/`source`
 * fields are NOT core columns a form can target, but `Object.hasOwn` on the object would have
 * matched them anyway.
 */
function seedAnswers(schema: FormSchema, facility: Facility): RuntimeAnswers {
  const answers: RuntimeAnswers = {};
  const asRecord = facility as unknown as Record<string, unknown>;
  for (const field of schema.fields) {
    const ap = field.apiProperty;
    const isCore = !!ap && CORE_FACILITY_KEYS.has(ap);
    const value = isCore ? asRecord[ap as string] : facility.extras?.[ap || field.id];
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
  // resolveForm()), producing "the submitted form could not be resolved" on every save.
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

  // Also used as FormRuntime's own `key` below (forcing a fresh mount, and fresh internal
  // `answers` state, on a schema/facility swap) — shared with useFacilityAdminSuggestions so the
  // suggestion state resets in lockstep with the form it's feeding, rather than carrying one
  // facility's admin-area suggestions into the next facility's dialog.
  const remountKey = schema ? `${schema.id}-${facility?.id ?? 'new'}` : 'loading';
  // Task 5: drives the zone/region/district/council `suggest` fields' options from the facility
  // registry's own previously-seen values, cascading each level's fetch off the OTHERS the
  // operator has already chosen. See the hook's own doc comment for the scoping/debounce/staleness
  // design — FacilityDialog only owns wiring it to FormRuntime's `fieldSuggestions` prop and
  // reading the live answers back out via `onAnswersChange` below.
  const { suggestions: fieldSuggestions, reportAnswers } = useFacilityAdminSuggestions(schema, remountKey);

  // Task 10: the read-only provenance panel's own data — independent of the form schema fetch
  // above (it never touches `answers`/`extras`), so a fetch failure here degrades the panel alone,
  // never the form. `registerSources` is the ACTIVE-only list (`GET /api/facilities/import/sources`
  // — the same one ImportFacilitiesSheet's national-system Select already uses), matched against
  // `facility.nationalSystem` by url; a register deactivated or unknown to this install simply has
  // no match, and the panel still shows the raw canonical URI (see the render below) rather than
  // hiding it. `lastImportAt` is the `occurredAt` timestamp of the newest `facility.import.row`
  // history entry for this facility, `undefined` while unresolved and `null` once resolved-to-none
  // (so the panel can tell "still loading" from "genuinely never imported" without a separate
  // loading flag).
  const [registerSources, setRegisterSources] = useState<FacilityRegisterSource[]>([]);
  const [lastImportAt, setLastImportAt] = useState<string | null | undefined>(undefined);

  // Deliberately NOT inside the edit-only effect below: the register list also feeds the
  // `fld-fac-national-system` field's suggestions (see `suggestionsWithRegisters`), and CREATE is
  // exactly when an operator needs it — that is the whole point of registering a facility against a
  // national register by hand. Scoped on `open` alone so both paths get it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listFacilityImportSources()
      .then((sources) => { if (!cancelled) setRegisterSources(sources); })
      .catch(() => { if (!cancelled) setRegisterSources([]); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !isEdit || !facility) { setLastImportAt(undefined); return; }
    let cancelled = false;
    setLastImportAt(undefined);
    getFacilityHistory(facility.id)
      .then((page) => {
        if (cancelled) return;
        // Rows arrive newest-first (the route's own order); the FIRST import-row entry found is
        // therefore the MOST RECENT one — no re-sort needed.
        const lastImport = page.rows.find((r) => r.action === 'facility.import.row');
        setLastImportAt(lastImport?.occurredAt ?? null);
      })
      .catch(() => { if (!cancelled) setLastImportAt(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, facility?.id]);

  // The `fld-fac-national-system` field (migration 085) names a REGISTERED facility register by its
  // canonical URI. Fed from the same `registerSources` fetch the provenance panel already makes,
  // not a second request. Declared here, below that state, rather than beside the hook it spreads.
  //
  // ⚠ `SuggestionState.options` is `string[]` — values, no labels — so this offers each register's
  // canonical URI rather than its friendly name. Honest (the URI is what is stored, and what the
  // server matches EXACTLY) but not pretty; showing a name means widening `SuggestionState` and
  // `SuggestCombobox`, which is deliberately out of this slice.
  //
  // The list is convenience, never the gate: POST resolves whatever is submitted through
  // `resolveFacilityRegisterForImport` and refuses an unregistered or deactivated register. That is
  // also why `suggest` (free entry allowed) is the right field type — a hard picklist would only
  // move the refusal earlier without making it any softer.
  const suggestionsWithRegisters: FieldSuggestions = {
    ...fieldSuggestions,
    'fld-fac-national-system': { status: 'ready', options: registerSources.map((s) => s.url) },
  };

  const matchedRegisterSource = facility?.nationalSystem
    ? registerSources.find((s) => s.url === facility.nationalSystem)
    : undefined;

  // Load the published 'facilities' form schema whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setSchema(null);
    setFormDefId(null);
    setNoForm(false);

    setSchemaLoading(true);
    // Same cancel guard as the lastImportAt effect above — one idiom in this file, not two. It
    // matters more here: this chain sets the schema AND the seeded answers. A load abandoned by a
    // facility switch used to land anyway, and did one of two things depending on when it landed:
    // rendered the PREVIOUS facility's values in a dialog now showing another one, or — once the
    // live load had already rendered — replaced initialAnswers invisibly, which handleSubmit's
    // clear-restore loop below then reads on Save.
    let cancelled = false;
    listPublishedForms('facilities')
      .then(async (summaries) => {
        // Deliberately no cancel check yet: everything up to the getForm await below is
        // facility-independent — the same published-forms list answers either facility — so an
        // abandoned load can only reach the conclusion the live one is about to reach anyway.
        // The guard goes on the first line that uses per-facility state.
        if (summaries.length === 0) { setNoForm(true); return; }
        // More than one published form targets the Facilities page. listPublished orders by name
        // with no unique tiebreaker (packages/forms/src/store.ts), so summaries[0] is not a choice
        // — it is whichever row the database returned first. Refuse and name every candidate
        // rather than capture a facility through an arbitrary one. Sorted so the message reads the
        // same on every install regardless of that server-side order.
        if (summaries.length > 1) {
          setError(t('facilities.ambiguousForm', { names: summaries.map((s) => s.name).sort().join(', ') }));
          return;
        }
        const summary = summaries[0];
        const def = await getForm(summary.id);
        if (cancelled) return;
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
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      // Guarded too: an abandoned load clearing this flag would report the CURRENT, still-pending
      // load as finished, leaving the dialog blank instead of loading.
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facility?.id]);

  const handleSubmit = async (answers: RuntimeAnswers) => {
    if (!schema) return;
    setSaving(true);
    setError(null);
    try {
      // FormRuntime deletes a field's key from its own answer state the instant its value becomes
      // empty (see setField in FormRuntime.tsx), and cleanAnswers drops empties again on submit —
      // so a field the operator just blanked never appears in `answers` at all. The route's clear
      // detection (clearedCoreKeys in facilities-routes.ts) keys off Object.hasOwn(answers, field.id)
      // — a submitted-but-blank answer — so without this, a cleared field is indistinguishable from
      // one the form never asked about, and the route's whole clear path is unreachable from here:
      // Save silently keeps the stale value. Restore an explicit '' for every field this dialog
      // seeded a value for (initialAnswers) that has no value in the cleaned submission.
      //
      // BUT cleanAnswers also drops a field for being HIDDEN (a visibility rule), not only for being
      // blanked — and a seeded field can be hidden on load without the operator ever touching it (an
      // operator-customised form with a visibility rule, or a section rule; the shipped 8-field
      // Facility form has none, so this never fires there). Restoring '' unconditionally for every
      // seeded field turned a merely-hidden field into an explicit clear on the very first Save,
      // which the route then nulls, 400s on (a hidden `name` or the local/national code CHECK), or
      // both. Intersect with the CURRENTLY visible fields — computed off this same cleaned `answers`,
      // the same values FormRuntime itself just used to decide what's visible — so only a field the
      // operator could actually see and blank is treated as cleared; a hidden field's stored value is
      // left alone, same as before the I2 fix.
      const submitAnswers: Record<string, unknown> = { ...answers };
      if (isEdit) {
        const visible = visibleIds(schema, answers);
        for (const fieldId of Object.keys(initialAnswers)) {
          if (visible.has(fieldId) && !Object.hasOwn(submitAnswers, fieldId)) submitAnswers[fieldId] = '';
        }
      }
      const body = { answers: submitAnswers, formSchemaId: formDefId, formVersion: schema.version };
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
          {/* Task 10: "where a facility came from" — read-only, edit-only (a facility not yet
              saved has no provenance to report). Inputs/filters are exempt from the ⋯-menu rule;
              this panel has no controls at all, so that rule doesn't apply to it either way. */}
          {isEdit && facility && (
            <div className="mx-6 mt-4 space-y-1.5 rounded-md border border-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-medium">{t('facilities.detail.provenanceTitle')}</p>
                <Badge variant={facility.source === 'import' ? 'default' : 'secondary'}>
                  {facility.source === 'import' ? t('facilities.filters.sourceImport') : t('facilities.filters.sourceManual')}
                </Badge>
              </div>
              {facility.nationalSystem ? (
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                  <span>{t('facilities.detail.authorityLabel')}</span>
                  <span className="text-foreground">{matchedRegisterSource?.name ?? '—'}</span>
                  <span>{t('facilities.detail.canonicalUriLabel')}</span>
                  <span className="text-foreground">{facility.nationalSystem}</span>
                  <span>{t('facilities.detail.versionLabel')}</span>
                  <span className="text-foreground">{matchedRegisterSource?.version ?? '—'}</span>
                </div>
              ) : (
                <p className="text-muted-foreground">{t('facilities.detail.notRegistered')}</p>
              )}
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                <span>{t('facilities.detail.lastImportLabel')}</span>
                <span className="text-foreground">
                  {lastImportAt === undefined
                    ? t('common.loading')
                    : lastImportAt === null
                      ? t('facilities.detail.lastImportNever')
                      : formatOccurredAt(lastImportAt)}
                </span>
              </div>
            </div>
          )}

          {error ? (
            <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}

          {schemaLoading ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : null}

          {formReady && schema ? (
            <FormRuntime
              key={remountKey}
              schema={schema}
              formDefinitionId={formDefId ?? undefined}
              initialAnswers={initialAnswers}
              onSubmit={handleSubmit}
              fieldSuggestions={suggestionsWithRegisters}
              onAnswersChange={reportAnswers}
              suggestCopy={{
                placeholder: t('facilities.suggest.placeholder'),
                loadingLabel: t('facilities.suggest.loading'),
                noSuggestionsLabel: t('facilities.suggest.empty'),
                errorFallback: t('facilities.suggest.error'),
              }}
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
