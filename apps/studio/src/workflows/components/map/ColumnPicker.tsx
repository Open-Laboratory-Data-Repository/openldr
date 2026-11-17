import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

/**
 * Add columns to a row: a filter box, "Select all shown", and one checkbox per column. It opens
 * inline under the row, not in a popover, because a portalled list inside a Sheet cannot scroll
 * (AGENTS.md section 6). A file with one column per test can have many columns.
 */
export function ColumnPicker({
  options,
  value,
  onChange,
  label,
}: {
  /** The columns that can be added, not the row's first column. */
  options: { value: string; label: string }[];
  /** The columns added so far, in the order they were added. */
  value: string[];
  onChange: (next: string[]) => void;
  /** The target field's label, for the accessible names. */
  label: string;
}) {
  const { t } = useTranslation();
  const p = 'workflows.mapToFhir.sheet';
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = options.filter((o) => o.value.toLowerCase().includes(needle));
  const toggle = (v: string, on: boolean) => onChange(on ? [...value, v] : value.filter((x) => x !== v));

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 self-start px-2 text-xs"
        aria-expanded={false}
        aria-label={`${t(`${p}.alsoFrom`)}: ${label}`}
        onClick={() => setOpen(true)}
      >
        {t(`${p}.alsoFrom`)}
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2" data-testid={`map-column-picker-${label}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          aria-label={`${t(`${p}.filterColumns`)}: ${label}`}
          placeholder={t(`${p}.filterColumns`)}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={shown.every((o) => value.includes(o.value))}
          onClick={() => onChange([...value, ...shown.map((o) => o.value).filter((v) => !value.includes(v))])}
        >
          {t(`${p}.selectAllShown`)}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-expanded onClick={() => setOpen(false)}>
          {t('workflows.mapToFhir.addPath.close')}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(`${p}.noColumnShown`)}</p>
      ) : (
        <div className="flex max-h-64 min-w-0 flex-col gap-1 overflow-y-auto">
          {shown.map((o) => (
            <label key={o.value} className="flex min-w-0 items-center gap-2 text-sm">
              <Checkbox checked={value.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} aria-label={o.label} />
              <span className="min-w-0 break-all">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
