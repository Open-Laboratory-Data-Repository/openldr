import { useEffect, useState } from 'react';
import { REFERENCE_ENTITY_TARGETS, type FormField } from '@openldr/forms/pure';
import { listCodingSystems, type CodingSystem } from '../../api';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ReferenceEditorProps {
  field: FormField;
  allFields: FormField[];
  onUpdate: (patch: Partial<FormField>) => void;
}

/**
 * The Reference Configuration block, shown only on a `reference` field. Corlix's shape
 * (`FieldEditor.tsx:312-398`) with CE's targets.
 *
 * Corlix's target list names corlix's own entities. CE's reference search resolves `Patient` and
 * code-system URLs (`reference-source.ts`), and the seeded Lab order form targets
 * `http://loinc.org`. So the list is the searchable entities plus the active code systems that have
 * a URL. A stored value the list does not know is added as an option, so opening a field never
 * blanks its target.
 *
 * Depends On and Searchable are stored and exported. CE's data entry does not read them yet.
 */
export function ReferenceEditor({ field, allFields, onUpdate }: ReferenceEditorProps): JSX.Element {
  const [systems, setSystems] = useState<CodingSystem[]>([]);

  useEffect(() => {
    let alive = true;
    void listCodingSystems()
      .then((rows) => { if (alive) setSystems(rows); })
      .catch(() => { /* the code-system half is a convenience; entity targets still work */ });
    return () => { alive = false; };
  }, []);

  const codeSystems = systems
    .filter((s) => s.active && s.url)
    .map((s) => ({ value: s.url as string, label: `${s.systemCode} · ${s.url}` }));
  const current = field.referenceTarget ?? '';
  const known = new Set<string>([...REFERENCE_ENTITY_TARGETS, ...codeSystems.map((o) => o.value)]);
  const others = allFields.filter((f) => f.id !== field.id);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">
      <Label htmlFor="ref-target" className="whitespace-nowrap">Target</Label>
      <Select value={current} onValueChange={(v) => onUpdate({ referenceTarget: v })}>
        <SelectTrigger id="ref-target" aria-label="Target">
          <SelectValue placeholder="Select target..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {REFERENCE_ENTITY_TARGETS.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectGroup>
          {codeSystems.length > 0 && <SelectSeparator />}
          <SelectGroup>
            {codeSystems.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectGroup>
          {current && !known.has(current) && (
            <>
              <SelectSeparator />
              <SelectItem value={current}>{current}</SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      <Label htmlFor="ref-display-field" className="whitespace-nowrap">Display Field</Label>
      <Input
        id="ref-display-field"
        aria-label="Display Field"
        value={field.referenceDisplayField ?? ''}
        onChange={(e) => onUpdate({ referenceDisplayField: e.target.value || undefined })}
        placeholder="displayName"
      />

      <Label htmlFor="ref-value-field" className="whitespace-nowrap">Value Field</Label>
      <Input
        id="ref-value-field"
        aria-label="Value Field"
        value={field.referenceValueField ?? ''}
        onChange={(e) => onUpdate({ referenceValueField: e.target.value || undefined })}
        placeholder="id"
      />

      <Label htmlFor="ref-depends-on" className="whitespace-nowrap">Depends On</Label>
      <Select
        value={field.referenceDependsOn ?? '__none'}
        onValueChange={(v) => onUpdate({ referenceDependsOn: v === '__none' ? undefined : v })}
      >
        <SelectTrigger id="ref-depends-on" aria-label="Depends On">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">None</SelectItem>
          {others.map((f) => (
            <SelectItem key={f.id} value={f.id}>{`${f.displayLabel} (${f.id})`}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="col-span-2 flex items-center gap-6 pt-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="ref-multiple"
            aria-label="Multiple"
            checked={field.referenceMultiple ?? false}
            onCheckedChange={(checked) => onUpdate({ referenceMultiple: !!checked })}
          />
          <Label htmlFor="ref-multiple" className="text-xs">Multiple</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="ref-searchable"
            aria-label="Searchable"
            checked={field.referenceSearchable ?? true}
            onCheckedChange={(checked) => onUpdate({ referenceSearchable: !!checked })}
          />
          <Label htmlFor="ref-searchable" className="text-xs">Searchable</Label>
        </div>
      </div>
    </div>
  );
}
