import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TruncatedText } from '@/components/ui/truncated-text';
import { ColumnPicker } from './ColumnPicker';
import { columnTest, exampleFor, exampleText, type RowDraft, type SampleRow, type SourceDraft } from './rows';
import type { ReactNode } from 'react';

const NONE = '__none';
const FIXED = '__fixed';

/**
 * A source field and example, followed by its destination label, FHIR path and rule.
 * Under 640px the cells stack with their own labels.
 */
export function MappingRow({
  draft,
  fieldNames,
  absent = [],
  rows,
  onChange,
  suggestion,
  rule,
  ruleInputs,
  actions,
  columnTests,
  setPerColumnOn,
  sharesTestsOf,
}: {
  draft: RowDraft;
  fieldNames: string[];
  /** Saved columns that this sample does not have. They are offered, marked, with no example. */
  absent?: string[];
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
  /** On the result field that carries a test per column: the test field's label, and the edit. */
  columnTests?: { testLabel: string; onChange: (column: string, test: string) => void };
  /** On the test field while its value is set per column: the label of the field that sets it. */
  setPerColumnOn?: string;
  /** On another result field with several columns: the label of the field whose tests it shares. */
  sharesTestsOf?: string;
}) {
  const { t } = useTranslation();
  const p = 'workflows.mapToFhir.sheet';
  const src = draft.source;
  const first = src.kind === 'field' ? src.fields[0] : undefined;
  const selectValue = src.kind === 'fixed' ? FIXED : src.kind === 'field' && first ? first : NONE;
  // A Radix SelectItem cannot have an empty value, so a column named '' is not offered.
  const names = fieldNames.filter((f) => f !== '');
  // A row with several columns shows the first column's example.
  const example = first && !setPerColumnOn ? exampleText(exampleFor(first, rows)) : '';
  const nameOf = (f: string) => (absent.includes(f) ? t(`${p}.notInSample`, { field: f }) : f);
  const more = src.kind === 'field' ? src.fields.slice(1) : [];
  const setMore = (next: string[]) => first && onChange({ kind: 'field', fields: [first, ...next] });

  const pick = (v: string) => {
    if (v === NONE) onChange({ kind: 'none' });
    else if (v === FIXED) onChange({ kind: 'fixed', value: src.kind === 'fixed' ? src.value : '' });
    else onChange({ kind: 'field', fields: src.kind === 'field' ? [v, ...src.fields.slice(1).filter((f) => f !== v)] : [v] });
  };

  return (
    <div
      className="grid grid-cols-1 gap-x-3 gap-y-1.5 border-b border-border px-6 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,7rem)_minmax(0,10rem)_minmax(0,9rem)] sm:items-start"
      data-testid={`map-row-${draft.targetPath}`}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs text-muted-foreground sm:hidden">{t(`${p}.colSource`)}</span>
        {setPerColumnOn ? (
          <p className="pt-2 text-xs text-muted-foreground" data-testid={`map-per-column-${draft.targetPath}`}>
            {t(`${p}.setPerColumn`, { label: setPerColumnOn })}
          </p>
        ) : (
          <Select value={selectValue} onValueChange={pick}>
            <SelectTrigger aria-label={t(`${p}.colSource`) + ': ' + draft.label} className="w-full min-w-0">
              <SelectValue placeholder={t(`${p}.sourcePlaceholder`)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t(`${p}.notMapped`)}</SelectItem>
              <SelectItem value={FIXED}>{t(`${p}.fixedValue`)}</SelectItem>
              {names.map((f) => (
                <SelectItem key={f} value={f}>
                  {nameOf(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {src.kind === 'fixed' && !setPerColumnOn && (
          <Input
            aria-label={t(`${p}.fixedValue`) + ': ' + draft.label}
            placeholder={t(`${p}.fixedPlaceholder`)}
            value={src.value}
            onChange={(e) => onChange({ kind: 'fixed', value: e.target.value })}
          />
        )}
        {columnTests && src.kind === 'field' && (
          // One line per column, with the test that column gives. The first column is changed above.
          <div className="flex min-w-0 flex-col gap-1.5" data-testid={`map-column-tests-${draft.targetPath}`}>
            {src.fields.map((f, i) => (
              <div key={f} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-x-2">
                <span className="min-w-0 break-all text-xs text-foreground">{nameOf(f)}</span>
                <span className="text-xs text-muted-foreground">{columnTests.testLabel}</span>
                <Input
                  aria-label={`${columnTests.testLabel}: ${f}`}
                  value={columnTest(draft, f)}
                  onChange={(e) => columnTests.onChange(f, e.target.value)}
                  className="h-8 min-w-0"
                />
                {i === 0 ? (
                  <span className="w-6" />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    aria-label={t('workflows.mapToFhir.remove', { label: f })}
                    onClick={() => setMore(more.filter((x) => x !== f))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {!columnTests && more.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {more.map((f) => (
              <Badge key={f} variant="secondary" className="max-w-full gap-1 pr-0.5">
                <span className="truncate">{nameOf(f)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 shrink-0"
                  aria-label={t('workflows.mapToFhir.remove', { label: nameOf(f) })}
                  onClick={() => setMore(more.filter((x) => x !== f))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        )}
        {sharesTestsOf && <p className="text-xs text-muted-foreground">{t(`${p}.sharesTests`, { label: sharesTestsOf })}</p>}
        {draft.repeats && src.kind === 'field' && first && !setPerColumnOn && (
          <ColumnPicker
            options={names.filter((f) => f !== first).map((f) => ({ value: f, label: nameOf(f) }))}
            value={more}
            onChange={setMore}
            label={draft.label}
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

      <div className="flex min-w-0 items-start gap-1 text-sm sm:pt-2">
        <div className="min-w-0">
          <span className="block text-xs text-muted-foreground sm:hidden">{t(`${p}.colField`)}</span>
          <span className="break-words font-medium text-foreground">
            {draft.label}
            {draft.required && <span className="text-destructive" aria-label={t(`${p}.requiredMark`)}>{' *'}</span>}
          </span>
          {draft.label !== draft.targetPath && <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">{draft.targetPath}</span>}
        </div>
        {actions && <span className="ml-auto shrink-0">{actions}</span>}
      </div>

      <div className="min-w-0">{rule}</div>
      {ruleInputs && <div className="min-w-0 sm:col-span-4">{ruleInputs}</div>}
    </div>
  );
}
