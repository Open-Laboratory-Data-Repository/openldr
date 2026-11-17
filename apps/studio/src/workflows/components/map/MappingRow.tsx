import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TruncatedText } from '@/components/ui/truncated-text';
import { exampleFor, exampleText, type RowDraft, type SampleRow, type SourceDraft } from './rows';
import type { ReactNode } from 'react';

const NONE = '__none';
const FIXED = '__fixed';

/**
 * One target field: its label (the FHIR path key in a tooltip), the source, the first sample's
 * value, and the rule. Under 640px the four stack, full width.
 */
export function MappingRow({
  draft,
  fieldNames,
  rows,
  onChange,
  suggestion,
  rule,
  ruleInputs,
  actions,
}: {
  draft: RowDraft;
  fieldNames: string[];
  /** The group's sample rows, for the Example column. Shown only here, never saved. */
  rows: SampleRow[];
  onChange: (source: SourceDraft) => void;
  /** Grey suggestion text and its Accept action, when there is one. */
  suggestion?: ReactNode;
  /** The rule kind select. */
  rule?: ReactNode;
  /** The chosen rule's own inputs, inline under the row. */
  ruleInputs?: ReactNode;
  /** A small dots menu for a row the person added. */
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const p = 'workflows.mapToFhir.sheet';
  const src = draft.source;
  const first = src.kind === 'field' ? src.fields[0] : undefined;
  const selectValue = src.kind === 'fixed' ? FIXED : src.kind === 'field' && first ? first : NONE;
  // A Radix SelectItem cannot have an empty value, so a column named '' is not offered.
  const names = fieldNames.filter((f) => f !== '');
  const example = src.kind === 'field' ? src.fields.map((f) => exampleText(exampleFor(f, rows))).filter(Boolean).join(', ') : '';

  const pick = (v: string) => {
    if (v === NONE) onChange({ kind: 'none' });
    else if (v === FIXED) onChange({ kind: 'fixed', value: src.kind === 'fixed' ? src.value : '' });
    else onChange({ kind: 'field', fields: src.kind === 'field' ? [v, ...src.fields.slice(1).filter((f) => f !== v)] : [v] });
  };

  return (
    <div
      className="grid grid-cols-1 gap-x-3 gap-y-1.5 border-b border-border px-6 py-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,7rem)_minmax(0,9rem)] sm:items-start"
      data-testid={`map-row-${draft.targetPath}`}
    >
      <div className="flex min-w-0 items-center gap-1 pt-2 text-sm">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 break-words font-medium text-foreground">
                {draft.label}
                {draft.required && (
                  <span className="text-destructive" aria-label={t(`${p}.requiredMark`)}>
                    {' *'}
                  </span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs break-all font-mono text-xs">{draft.targetPath}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {actions && <span className="ml-auto shrink-0">{actions}</span>}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Select value={selectValue} onValueChange={pick}>
          <SelectTrigger aria-label={t(`${p}.colSource`) + ': ' + draft.label} className="w-full min-w-0">
            <SelectValue placeholder={t(`${p}.sourcePlaceholder`)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t(`${p}.notMapped`)}</SelectItem>
            <SelectItem value={FIXED}>{t(`${p}.fixedValue`)}</SelectItem>
            {names.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {src.kind === 'fixed' && (
          <Input
            aria-label={t(`${p}.fixedValue`) + ': ' + draft.label}
            placeholder={t(`${p}.fixedPlaceholder`)}
            value={src.value}
            onChange={(e) => onChange({ kind: 'fixed', value: e.target.value })}
          />
        )}
        {draft.repeats && src.kind === 'field' && first && (
          <MultiSelect
            aria-label={t(`${p}.alsoFrom`) + ': ' + draft.label}
            options={names.filter((f) => f !== first).map((f) => ({ value: f, label: f }))}
            value={src.fields.slice(1)}
            onChange={(more) => onChange({ kind: 'field', fields: [first, ...more] })}
            placeholder={t(`${p}.alsoFrom`)}
            removeLabel={(label) => t('workflows.mapToFhir.remove', { label })}
          />
        )}
        {suggestion}
      </div>

      <div className="flex min-w-0 gap-1 text-xs text-muted-foreground sm:block sm:pt-2">
        {example && (
          <>
            <span className="shrink-0 sm:hidden">{t(`${p}.colExample`)}:</span>
            <TruncatedText text={example} className="block min-w-0" />
          </>
        )}
      </div>

      <div className="min-w-0">{rule}</div>
      {ruleInputs && <div className="min-w-0 sm:col-span-4">{ruleInputs}</div>}
    </div>
  );
}
