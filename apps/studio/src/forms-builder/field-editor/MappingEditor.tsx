import * as React from 'react';
import type { FormField, FormFieldConstraints } from '@openldr/forms/pure';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SuggestCombobox } from '@/components/ui/suggest-combobox';
import { fhirPathOptionsFor, lookupFhirPath } from '@openldr/fhir/paths';

export interface MappingEditorProps {
  field: FormField;
  /**
   * The form's `fhirResourceType`, which scopes the path picker. Null, or any of the 136 resource
   * types the generated table does not cover, degrades the picker to a plain free-text box rather
   * than showing an empty list that looks broken.
   */
  fhirResourceType: string | null;
  onUpdate: (patch: Partial<FormField>) => void;
}

const BINDING_STRENGTHS: { value: string; label: string }[] = [
  { value: 'required',   label: 'required' },
  { value: 'extensible', label: 'extensible' },
  { value: 'preferred',  label: 'preferred' },
  { value: 'example',    label: 'example' },
];

function parseNum(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function MappingEditor({ field, fhirResourceType, onUpdate }: MappingEditorProps): JSX.Element {
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

  return (
    <>
      {/* ── Mapping ─────────────────────────────────────────────── */}
      <section className="mt-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">

          {/* FHIR Path */}
          <Label htmlFor="mapping-fhir-path" className="whitespace-nowrap">
            FHIR Path
          </Label>
          <div className="min-w-0">
            <SuggestCombobox
              id="mapping-fhir-path"
              label="FHIR Path"
              value={field.fhirPath ?? ''}
              onChange={(next) => onUpdate({ fhirPath: next || null })}
              options={pathOptions.map((option) => option.path)}
              optionDescriptions={pathDescriptions}
              placeholder={fhirResourceType ? `e.g. ${fhirResourceType}.name` : 'e.g. Patient.name'}
              noSuggestionsLabel="No matching element in FHIR R4"
            />
            {currentDefinition && (
              <p data-testid="fhir-path-definition" className="mt-1 text-xs text-muted-foreground">
                {currentDefinition}
              </p>
            )}
          </div>

          {/* API Property */}
          <Label htmlFor="mapping-api-property" className="whitespace-nowrap">
            API Property
          </Label>
          <Input
            id="mapping-api-property"
            aria-label="API Property"
            value={field.apiProperty ?? ''}
            onChange={(e) =>
              onUpdate({ apiProperty: e.target.value || undefined })
            }
            placeholder="e.g. patientName"
            className="font-mono text-xs"
          />

          {/* Observation Extract */}
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <Checkbox
              id="mapping-observation-extract"
              aria-label="Observation Extract"
              checked={field.observationExtract ?? false}
              onCheckedChange={(checked) =>
                onUpdate({ observationExtract: !!checked })
              }
            />
            <Label htmlFor="mapping-observation-extract" className="text-xs">
              Observation Extract
            </Label>
          </div>

          {/* Value Set URL */}
          <Label htmlFor="mapping-value-set-url" className="whitespace-nowrap">
            Value Set URL
          </Label>
          <Input
            id="mapping-value-set-url"
            aria-label="Value Set URL"
            value={field.valueSetUrl ?? ''}
            onChange={(e) =>
              onUpdate({ valueSetUrl: e.target.value || undefined })
            }
            placeholder="http://..."
            className="font-mono text-xs"
          />

          {/* Binding Strength */}
          <Label htmlFor="mapping-binding-strength-trigger" className="whitespace-nowrap">
            Binding Strength
          </Label>
          <Select
            value={field.bindingStrength ?? ''}
            onValueChange={(v) =>
              onUpdate({ bindingStrength: v as FormField['bindingStrength'] })
            }
          >
            <SelectTrigger
              id="mapping-binding-strength-trigger"
              aria-label="Binding Strength"
            >
              <SelectValue placeholder="— none —" />
            </SelectTrigger>
            <SelectContent>
              {BINDING_STRENGTHS.map((bs) => (
                <SelectItem key={bs.value} value={bs.value}>
                  {bs.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* ── Advanced ─────────────────────────────────────────────── */}
      <section className="mt-4">
        <button
          type="button"
          aria-label="Advanced"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
          className="w-full flex items-center justify-between text-sm font-medium text-foreground pb-2 border-b border-border"
        >
          <span>Advanced</span>
          <span className="text-xs text-muted-foreground">{advancedOpen ? '▲' : '▼'}</span>
        </button>

        {advancedOpen && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">

            {/* ── Constraints ──────────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              Constraints
            </span>

            <Label htmlFor="adv-constraint-min" className="whitespace-nowrap">Min</Label>
            <Input
              id="adv-constraint-min"
              aria-label="Min"
              type="number"
              value={field.constraints?.min ?? ''}
              onChange={(e) => patchConstraints({ min: parseNum(e.target.value) })}
              placeholder="—"
            />

            <Label htmlFor="adv-constraint-max" className="whitespace-nowrap">Max</Label>
            <Input
              id="adv-constraint-max"
              aria-label="Max"
              type="number"
              value={field.constraints?.max ?? ''}
              onChange={(e) => patchConstraints({ max: parseNum(e.target.value) })}
              placeholder="—"
            />

            <Label htmlFor="adv-constraint-max-length" className="whitespace-nowrap">Max Length</Label>
            <Input
              id="adv-constraint-max-length"
              aria-label="Max Length"
              type="number"
              value={field.constraints?.maxLength ?? ''}
              onChange={(e) => patchConstraints({ maxLength: parseNum(e.target.value) })}
              placeholder="—"
            />

            <Label htmlFor="adv-constraint-decimal-places" className="whitespace-nowrap">
              Decimal Places
            </Label>
            <Input
              id="adv-constraint-decimal-places"
              aria-label="Decimal Places"
              type="number"
              value={field.constraints?.decimalPlaces ?? ''}
              onChange={(e) => patchConstraints({ decimalPlaces: parseNum(e.target.value) })}
              placeholder="—"
            />

            {/* ── Reference config ─────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              Reference
            </span>

            <Label htmlFor="adv-ref-target" className="whitespace-nowrap">Reference Target</Label>
            <Input
              id="adv-ref-target"
              aria-label="Reference Target"
              value={field.referenceTarget ?? ''}
              onChange={(e) =>
                onUpdate({ referenceTarget: e.target.value || undefined })
              }
              placeholder="e.g. Patient"
            />

            <Label htmlFor="adv-ref-display-field" className="whitespace-nowrap">
              Display Field
            </Label>
            <Input
              id="adv-ref-display-field"
              aria-label="Reference Display Field"
              value={field.referenceDisplayField ?? ''}
              onChange={(e) =>
                onUpdate({ referenceDisplayField: e.target.value || undefined })
              }
              placeholder="e.g. name"
            />

            <Label htmlFor="adv-ref-value-field" className="whitespace-nowrap">
              Value Field
            </Label>
            <Input
              id="adv-ref-value-field"
              aria-label="Reference Value Field"
              value={field.referenceValueField ?? ''}
              onChange={(e) =>
                onUpdate({ referenceValueField: e.target.value || undefined })
              }
              placeholder="e.g. id"
            />

            <div className="col-span-2 flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="adv-ref-multiple"
                  aria-label="Reference Multiple"
                  checked={field.referenceMultiple ?? false}
                  onCheckedChange={(checked) =>
                    onUpdate({ referenceMultiple: !!checked })
                  }
                />
                <Label htmlFor="adv-ref-multiple" className="text-xs">Multiple</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="adv-ref-searchable"
                  aria-label="Reference Searchable"
                  checked={field.referenceSearchable ?? false}
                  onCheckedChange={(checked) =>
                    onUpdate({ referenceSearchable: !!checked })
                  }
                />
                <Label htmlFor="adv-ref-searchable" className="text-xs">Searchable</Label>
              </div>
            </div>

            {/* ── Repetition ───────────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              Repetition
            </span>

            <div className="col-span-2 flex items-center gap-2">
              <Checkbox
                id="adv-repeatable"
                aria-label="Repeatable"
                checked={field.repeatable ?? false}
                onCheckedChange={(checked) =>
                  onUpdate({ repeatable: !!checked })
                }
              />
              <Label htmlFor="adv-repeatable" className="text-xs">Repeatable</Label>
            </div>

            <Label htmlFor="adv-min-items" className="whitespace-nowrap">Min Items</Label>
            <Input
              id="adv-min-items"
              aria-label="Min Items"
              type="number"
              value={field.minItems ?? ''}
              onChange={(e) =>
                onUpdate({ minItems: parseNum(e.target.value) })
              }
              placeholder="—"
            />

            <Label htmlFor="adv-max-items" className="whitespace-nowrap">Max Items</Label>
            <Input
              id="adv-max-items"
              aria-label="Max Items"
              type="number"
              value={field.maxItems ?? ''}
              onChange={(e) =>
                onUpdate({ maxItems: parseNum(e.target.value) })
              }
              placeholder="—"
            />

            {/* ── Admin Note ───────────────────────────────────── */}
            <span className="col-span-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
              Notes
            </span>

            <Label htmlFor="adv-admin-note" className="whitespace-nowrap">Admin Note</Label>
            <Textarea
              id="adv-admin-note"
              aria-label="Admin Note"
              value={field.adminNote ?? ''}
              onChange={(e) =>
                onUpdate({ adminNote: e.target.value || undefined })
              }
              placeholder="Internal notes…"
              className="text-xs"
            />
          </div>
        )}
      </section>
    </>
  );
}
