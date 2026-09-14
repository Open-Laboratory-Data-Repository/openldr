import { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { lookupBinding } from '@openldr/fhir/paths';
import type { BindingStrength, FormField } from '@openldr/forms/pure';
import { listValueSets, storedValueSetCodes, type ValueSetSummary } from '../../api';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ValueSetPicker } from '../../terminology/ValueSetPicker';
import { OptionsEditor } from './OptionsEditor';
import { SaveOptionsAsValueSetSheet } from './SaveOptionsAsValueSetSheet';
import { BINDING_STRENGTHS, bindingUpdates, codesToOptions, strengthLocksCustomValue } from '../valueSetBinding';

/**
 * The Options block of a select or multiselect field: its ValueSet binding and its option list.
 * Ported from corlix `components/ValueSetBinding.tsx`, with its actions in the block's ⋯ menu
 * (AGENTS.md §5). Binding copies the set's stored codes into the options, read through the export
 * route and never recomputed (spec S6), which is also why corlix's Re-expand is left out.
 */
export function OptionsBlock({
  field,
  surveyMode,
  onUpdate,
}: {
  field: FormField;
  surveyMode: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
}): JSX.Element {
  const { hasCapability } = useAuth();
  const [sets, setSets] = useState<ValueSetSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  // Bumped after "Save as a new ValueSet", so the new set is found and the block names it instead
  // of calling it not held.
  const [setsVersion, setSetsVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void listValueSets()
      .then((rows) => { if (alive) setSets(rows); })
      .catch(() => { /* the title and the standard set are niceties; binding still works through the picker */ });
    return () => { alive = false; };
  }, [setsVersion]);

  const bound = useMemo(() => sets.find((s) => s.url === field.valueSetUrl) ?? null, [sets, field.valueSetUrl]);
  // A survey question points at no resource, so it has no standard binding (spec S6, as corlix P15.1).
  const standard = surveyMode ? null : lookupBinding(field.fhirPath);
  const standardHeld = useMemo(
    () => (standard ? sets.find((s) => s.url === standard.valueSet) ?? null : null),
    [sets, standard],
  );
  const strength: BindingStrength = field.bindingStrength ?? 'extensible';
  const hasOptions = (field.valueSetOptions?.length ?? 0) > 0;
  const canSave = hasOptions && !field.valueSetUrl && hasCapability('terminology.manage');

  const readCodes = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      return codesToOptions(await storedValueSetCodes(id));
    } catch {
      setError('Could not read the ValueSet codes.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const bind = async (vs: ValueSetSummary) => {
    const options = await readCodes(vs.id);
    if (options) onUpdate(bindingUpdates(vs.url, strength, options));
  };

  /** The spec's "Load from terminology": the standard set's codes as options, without binding. */
  const loadStandard = async () => {
    if (!standardHeld) return;
    const options = await readCodes(standardHeld.id);
    if (options) onUpdate({ valueSetOptions: options });
  };

  const changeStrength = (s: BindingStrength) => {
    onUpdate(strengthLocksCustomValue(s) ? { bindingStrength: s, allowCustomValue: false } : { bindingStrength: s });
  };

  // Unbind keeps the copied options and drops only the link and the strength, as corlix does.
  const unbind = () => {
    onUpdate({ valueSetUrl: undefined, bindingStrength: undefined });
    setError(null);
  };

  const hasActions = Boolean(standardHeld) || Boolean(field.valueSetUrl) || canSave;

  return (
    <>
      <div className="border-t border-border" />
      <div className="flex items-center justify-between px-6 py-3">
        <h3 className="text-sm font-medium text-foreground">Options</h3>
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Options actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {standardHeld && (
                <DropdownMenuItem disabled={busy} onSelect={() => void loadStandard()}>Load from terminology</DropdownMenuItem>
              )}
              {field.valueSetUrl && <DropdownMenuItem onSelect={unbind}>Unbind</DropdownMenuItem>}
              {canSave && <DropdownMenuItem onSelect={() => setSaveOpen(true)}>Save as a new ValueSet</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="border-t border-border" />
      <div className="px-6 py-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-3">
          <Label className="whitespace-nowrap">ValueSet</Label>
          {field.valueSetUrl ? (
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {`${field.valueSetOptions?.length ?? 0} codes from ${bound?.title ?? bound?.name ?? field.valueSetUrl}`}
              </p>
              {!bound && <p className="truncate text-xs text-muted-foreground">Not held on this install, so its codes cannot be read.</p>}
            </div>
          ) : (
            <ValueSetPicker onPick={(vs) => void bind(vs)} placeholder="Bind to a ValueSet…" />
          )}
          {field.valueSetUrl && (
            <>
              <Label htmlFor="options-strength" className="whitespace-nowrap">Strength</Label>
              <Select value={strength} onValueChange={(v) => changeStrength(v as BindingStrength)}>
                <SelectTrigger id="options-strength" aria-label="Strength">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BINDING_STRENGTHS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        {error && <p role="alert" className="pb-2 text-xs text-destructive">{error}</p>}
        <OptionsEditor field={field} onUpdate={onUpdate} />
      </div>
      <SaveOptionsAsValueSetSheet
        open={saveOpen}
        onOpenChange={setSaveOpen}
        options={field.valueSetOptions ?? []}
        fieldLabel={field.displayLabel}
        onSaved={(url) => {
          const s = field.bindingStrength ?? 'extensible';
          onUpdate(strengthLocksCustomValue(s) ? { valueSetUrl: url, bindingStrength: s, allowCustomValue: false } : { valueSetUrl: url, bindingStrength: s });
          setSetsVersion((v) => v + 1);
        }}
      />
    </>
  );
}
