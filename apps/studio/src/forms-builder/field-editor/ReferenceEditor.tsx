import { useEffect, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { REFERENCE_ENTITY_TARGETS, type FormField } from '@openldr/forms/pure';
import { listCodingSystems, listValueSets, type CodingSystem, type ValueSetSummary } from '../../api';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ValueSetPicker } from '../../terminology/ValueSetPicker';
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
 *
 * A reference field can search a ValueSet instead of a Target. It searches the set live
 * (`reference-source.ts`), so binding copies no codes. When both are set, the ValueSet wins and the
 * linter warns (`lint.ts:117`).
 */
export function ReferenceEditor({ field, allFields, onUpdate }: ReferenceEditorProps): JSX.Element {
  const { t } = useTranslation();
  const [systems, setSystems] = useState<CodingSystem[]>([]);
  const [sets, setSets] = useState<ValueSetSummary[]>([]);

  useEffect(() => {
    let alive = true;
    void listCodingSystems()
      .then((rows) => { if (alive) setSystems(rows); })
      .catch(() => { /* the code-system half is a convenience; entity targets still work */ });
    void listValueSets()
      .then((rows) => { if (alive) setSets(rows); })
      .catch(() => { /* the title is a nicety */ });
    return () => { alive = false; };
  }, []);

  const boundSet = sets.find((s) => s.url === field.valueSetUrl) ?? null;

  const codeSystems = systems
    .filter((s) => s.active && s.url)
    .map((s) => ({ value: s.url as string, label: `${s.systemCode} · ${s.url}` }));
  const current = field.referenceTarget ?? '';
  const known = new Set<string>([...REFERENCE_ENTITY_TARGETS, ...codeSystems.map((o) => o.value)]);
  const others = allFields.filter((f) => f.id !== field.id);

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4">
      <Label htmlFor="ref-target" className="whitespace-nowrap">{t('formBuilder.reference.target')}</Label>
      <Select value={current} onValueChange={(v) => onUpdate({ referenceTarget: v })}>
        <SelectTrigger id="ref-target" aria-label={t('formBuilder.reference.target')}>
          <SelectValue placeholder={t('formBuilder.reference.targetPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {REFERENCE_ENTITY_TARGETS.map((target) => (
              <SelectItem key={target} value={target}>{target}</SelectItem>
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

      <Label className="whitespace-nowrap">{t('formBuilder.reference.valueSet')}</Label>
      {field.valueSetUrl ? (
        <div className="flex min-w-0 items-center gap-1">
          <TruncatedText text={boundSet?.title ?? boundSet?.name ?? field.valueSetUrl} className="min-w-0 flex-1 text-sm" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('formBuilder.reference.valueSetActions')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onUpdate({ valueSetUrl: undefined })}>{t('formBuilder.reference.unbind')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <ValueSetPicker onPick={(vs) => onUpdate({ valueSetUrl: vs.url })} placeholder={t('formBuilder.reference.searchValueSet')} />
      )}

      <Label htmlFor="ref-display-field" className="whitespace-nowrap">{t('formBuilder.reference.displayField')}</Label>
      <Input
        id="ref-display-field"
        aria-label={t('formBuilder.reference.displayField')}
        value={field.referenceDisplayField ?? ''}
        onChange={(e) => onUpdate({ referenceDisplayField: e.target.value || undefined })}
        placeholder="displayName"
      />

      <Label htmlFor="ref-value-field" className="whitespace-nowrap">{t('formBuilder.reference.valueField')}</Label>
      <Input
        id="ref-value-field"
        aria-label={t('formBuilder.reference.valueField')}
        value={field.referenceValueField ?? ''}
        onChange={(e) => onUpdate({ referenceValueField: e.target.value || undefined })}
        placeholder="id"
      />

      <Label htmlFor="ref-depends-on" className="whitespace-nowrap">{t('formBuilder.reference.dependsOn')}</Label>
      <Select
        value={field.referenceDependsOn ?? '__none'}
        onValueChange={(v) => onUpdate({ referenceDependsOn: v === '__none' ? undefined : v })}
      >
        <SelectTrigger id="ref-depends-on" aria-label={t('formBuilder.reference.dependsOn')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{t('formBuilder.reference.none')}</SelectItem>
          {others.map((f) => (
            <SelectItem key={f.id} value={f.id}>{`${f.displayLabel} (${f.id})`}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="col-span-2 flex items-center gap-6 pt-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="ref-multiple"
            aria-label={t('formBuilder.reference.multiple')}
            checked={field.referenceMultiple ?? false}
            onCheckedChange={(checked) => onUpdate({ referenceMultiple: !!checked })}
          />
          <Label htmlFor="ref-multiple" className="text-xs">{t('formBuilder.reference.multiple')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="ref-searchable"
            aria-label={t('formBuilder.reference.searchable')}
            checked={field.referenceSearchable ?? true}
            onCheckedChange={(checked) => onUpdate({ referenceSearchable: !!checked })}
          />
          <Label htmlFor="ref-searchable" className="text-xs">{t('formBuilder.reference.searchable')}</Label>
        </div>
      </div>
    </div>
  );
}
