import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { FormField, FormFieldConstraints } from '@openldr/forms/pure';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { SuggestCombobox } from '@/components/ui/suggest-combobox';
import { fhirPathOptionsFor, lookupBinding, lookupFhirPath } from '@openldr/fhir/paths';
import { DiscriminatorEditor } from './DiscriminatorEditor';

export interface MappingEditorProps {
  field: FormField;
  /**
   * The form's `fhirResourceType`, which scopes the path picker. Null, or any of the 136 resource
   * types the generated table does not cover, degrades the picker to a plain free-text box rather
   * than showing an empty list that looks broken.
   */
  fhirResourceType: string | null;
  /**
   * True on a Questionnaire form. A survey question points at no resource, so FHIR Path, the
   * discriminator and API Property are hidden. Observation Extract and the rest stay: CE needs
   * Observation Extract to submit a form at all.
   */
  surveyMode?: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
}

function parseNum(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function MappingEditor({ field, fhirResourceType, surveyMode = false, onUpdate }: MappingEditorProps): JSX.Element {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  function patchConstraints(patch: Partial<FormFieldConstraints>): void {
    onUpdate({ constraints: { ...field.constraints, ...patch } });
  }

  // The definition is its own line, not joined onto the path: a narrow mobile column (163px
  // measured) cannot fit both on one truncated line, and the definition is what an operator
  // actually needs to read. SuggestCombobox searches the definition the same as it searches the
  // label, so an operator thinking "county" still finds `district` without typing it.
  const pathOptions = React.useMemo(
    () => fhirPathOptionsFor(fhirResourceType ?? ''),
    [fhirResourceType],
  );
  const pathDescriptions = React.useMemo(() => {
    const descriptions: Record<string, string> = {};
    for (const option of pathOptions) {
      if (option.label) descriptions[option.path] = option.label;
    }
    return descriptions;
  }, [pathOptions]);

  const currentDefinition = field.fhirPath ? lookupFhirPath(field.fhirPath)?.label ?? null : null;
  const binding = lookupBinding(field.fhirPath);

  return (
    <>
      {/* ── Mapping ─────────────────────────────────────────────── */}
      <section className="mt-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">

          {!surveyMode && (
          <>
          {/* FHIR Path */}
          <Label htmlFor="mapping-fhir-path" className="whitespace-nowrap">
            {t('formBuilder.mapping.fhirPath')}
          </Label>
          <div className="min-w-0">
            <SuggestCombobox
              id="mapping-fhir-path"
              label={t('formBuilder.mapping.fhirPath')}
              value={field.fhirPath ?? ''}
              onChange={(next) => onUpdate({ fhirPath: next || null })}
              options={pathOptions.map((option) => option.path)}
              optionDescriptions={pathDescriptions}
              placeholder={t('formBuilder.mapping.fhirPathHint', { example: `${fhirResourceType ?? 'Patient'}.name` })}
              noSuggestionsLabel={t('formBuilder.mapping.noElement')}
              // A FHIR path carries its meaning in the tail (`.period.start` vs
              // `.period.end`), so clip the head instead of the tail here.
              optionLabelTruncateFrom="start"
            />
            {currentDefinition && (
              <p data-testid="fhir-path-definition" className="mt-1 text-xs text-muted-foreground">
                {currentDefinition}
              </p>
            )}
            {/* FHIR's own binding for this element, named by its URL's last segment, as corlix does. */}
            {binding && (
              <p data-testid="fhir-path-binding" className="mt-1 text-xs text-muted-foreground">
                {t('formBuilder.mapping.bound', { valueSet: binding.valueSet.split('/').pop(), strength: binding.strength })}
              </p>
            )}
          </div>

          {/* Which entry of a repeating list: after the path it qualifies, as in corlix. */}
          <DiscriminatorEditor field={field} onUpdate={onUpdate} />

          {/* API Property */}
          <Label htmlFor="mapping-api-property" className="whitespace-nowrap">
            {t('formBuilder.mapping.apiProperty')}
          </Label>
          <Input
            id="mapping-api-property"
            aria-label={t('formBuilder.mapping.apiProperty')}
            value={field.apiProperty ?? ''}
            onChange={(e) =>
              onUpdate({ apiProperty: e.target.value || undefined })
            }
            placeholder={t('formBuilder.mapping.apiPropertyHint')}
            className="font-mono text-xs"
          />
          </>
          )}

          {/* Observation Extract */}
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <Checkbox
              id="mapping-observation-extract"
              aria-label={t('formBuilder.mapping.observationExtract')}
              checked={field.observationExtract ?? false}
              onCheckedChange={(checked) =>
                onUpdate({ observationExtract: !!checked })
              }
            />
            <Label htmlFor="mapping-observation-extract" className="text-xs">
              {t('formBuilder.mapping.observationExtract')}
            </Label>
          </div>

        </div>
      </section>

      {/* ── Advanced ─────────────────────────────────────────────── */}
      <section className="mt-4">
        <button
          type="button"
          aria-label={t('formBuilder.mapping.advanced')}
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
          className="w-full flex items-center justify-between text-sm font-medium text-foreground pb-2 border-b border-border"
        >
          <span>{t('formBuilder.mapping.advanced')}</span>
          <span className="text-xs text-muted-foreground">{advancedOpen ? '▲' : '▼'}</span>
        </button>

        {advancedOpen && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">

            {/* ── Constraints ──────────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              {t('formBuilder.mapping.constraints')}
            </span>

            <Label htmlFor="adv-constraint-min" className="whitespace-nowrap">{t('formBuilder.mapping.min')}</Label>
            <Input
              id="adv-constraint-min"
              aria-label={t('formBuilder.mapping.min')}
              type="number"
              value={field.constraints?.min ?? ''}
              onChange={(e) => patchConstraints({ min: parseNum(e.target.value) })}
              placeholder="—"
            />

            <Label htmlFor="adv-constraint-max" className="whitespace-nowrap">{t('formBuilder.mapping.max')}</Label>
            <Input
              id="adv-constraint-max"
              aria-label={t('formBuilder.mapping.max')}
              type="number"
              value={field.constraints?.max ?? ''}
              onChange={(e) => patchConstraints({ max: parseNum(e.target.value) })}
              placeholder="—"
            />

            <Label htmlFor="adv-constraint-max-length" className="whitespace-nowrap">{t('formBuilder.mapping.maxLength')}</Label>
            <Input
              id="adv-constraint-max-length"
              aria-label={t('formBuilder.mapping.maxLength')}
              type="number"
              value={field.constraints?.maxLength ?? ''}
              onChange={(e) => patchConstraints({ maxLength: parseNum(e.target.value) })}
              placeholder="—"
            />

            <Label htmlFor="adv-constraint-decimal-places" className="whitespace-nowrap">
              {t('formBuilder.mapping.decimalPlaces')}
            </Label>
            <Input
              id="adv-constraint-decimal-places"
              aria-label={t('formBuilder.mapping.decimalPlaces')}
              type="number"
              value={field.constraints?.decimalPlaces ?? ''}
              onChange={(e) => patchConstraints({ decimalPlaces: parseNum(e.target.value) })}
              placeholder="—"
            />

            {/* ── Repetition ───────────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              {t('formBuilder.mapping.repetition')}
            </span>

            <div className="col-span-2 flex items-center gap-2">
              <Checkbox
                id="adv-repeatable"
                aria-label={t('formBuilder.mapping.repeatable')}
                checked={field.repeatable ?? false}
                onCheckedChange={(checked) =>
                  onUpdate({ repeatable: !!checked })
                }
              />
              <Label htmlFor="adv-repeatable" className="text-xs">{t('formBuilder.mapping.repeatable')}</Label>
            </div>

            <Label htmlFor="adv-min-items" className="whitespace-nowrap">{t('formBuilder.mapping.minItems')}</Label>
            <Input
              id="adv-min-items"
              aria-label={t('formBuilder.mapping.minItems')}
              type="number"
              value={field.minItems ?? ''}
              onChange={(e) =>
                onUpdate({ minItems: parseNum(e.target.value) })
              }
              placeholder="—"
            />

            <Label htmlFor="adv-max-items" className="whitespace-nowrap">{t('formBuilder.mapping.maxItems')}</Label>
            <Input
              id="adv-max-items"
              aria-label={t('formBuilder.mapping.maxItems')}
              type="number"
              value={field.maxItems ?? ''}
              onChange={(e) =>
                onUpdate({ maxItems: parseNum(e.target.value) })
              }
              placeholder="—"
            />

            {/* ── Admin Note ───────────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              {t('formBuilder.mapping.notes')}
            </span>

            <Label htmlFor="adv-admin-note" className="whitespace-nowrap">{t('formBuilder.mapping.adminNote')}</Label>
            <Textarea
              id="adv-admin-note"
              aria-label={t('formBuilder.mapping.adminNote')}
              value={field.adminNote ?? ''}
              onChange={(e) =>
                onUpdate({ adminNote: e.target.value || undefined })
              }
              placeholder={t('formBuilder.mapping.adminNoteHint')}
              className="text-xs"
            />
          </div>
        )}
      </section>
    </>
  );
}
