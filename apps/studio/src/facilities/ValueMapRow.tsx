import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ValueSetOption, ValueSuggestion } from '@/api';
import { sortValueSetOptions } from './sortValueSetOptions';

/** Not a real value-set code — a real one could never collide with it. Shared by every caller of
 *  `ValueMapRow` so "Not mapped" always means the same thing on the wire. */
export const VALUE_MAP_UNMAPPED = '__not_mapped__';

export interface ValueMapRowProps {
  /** The raw source value this row lets the operator map. */
  value: string;
  /** The ranker's own candidates for THIS value, best first — legitimately empty. */
  candidates: ValueSuggestion['candidates'];
  /** The field's WHOLE value set, for the tail beneath the ranked candidates. */
  options: ValueSetOption[];
  /** The chosen code, or `VALUE_MAP_UNMAPPED`. */
  selected: string;
  onSelect: (code: string) => void;
}

/** Task 6: the per-value pick-list row, lifted out of `ValueMapPanel` so `ColumnMapStep` can render
 *  the exact same row under the mapping it belongs to, without a second copy of the ordering rules.
 *
 *  ⛔ DO NOT REWRITE THE ORDER. The ranked candidates keep their scored order — that is the point of
 *  ranking them — and only the remaining tail is sorted, alphabetically, by `sortValueSetOptions`:
 *  63 facility types in seed order cannot be searched by eye. `Not mapped` is always first. Measured
 *  on the real Zambia MFL export; see `sortValueSetOptions`'s own docblock for the report that made
 *  it necessary. */
export function ValueMapRow({ value, candidates, options, selected, onSelect }: ValueMapRowProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const top = candidates[0] ?? null;
  // Naturally absent when the row is a collision-free exact match, or unmatched.
  const showBadge = top?.confidence === 'likely' && selected === top.target;

  return (
    <Fragment>
      <Label className="whitespace-nowrap text-foreground" title={value}>{value}</Label>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={onSelect}>
          <SelectTrigger aria-label={value} className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={VALUE_MAP_UNMAPPED}>{t('facilities.import.valueMap.notMapped')}</SelectItem>
            {candidates.map((c) => (
              <SelectItem key={c.target} value={c.target}>{c.display ?? c.target}</SelectItem>
            ))}
            {sortValueSetOptions(
              options.filter((o) => !candidates.some((c) => c.target === o.code)),
              i18n.language,
            ).map((o) => (
              <SelectItem key={o.code} value={o.code}>{o.display ?? o.code}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showBadge && (
          <Badge variant="outline" className="shrink-0">
            {t('facilities.import.columnMap.checkThisBadge')}
          </Badge>
        )}
      </div>
    </Fragment>
  );
}

export default ValueMapRow;
