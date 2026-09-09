import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { ValueSetOption, ValueSuggestion } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { sortValueSetOptions } from './sortValueSetOptions';

/** Not a real value-set code, and a real one could never collide with it. Shared by every caller of
 *  `ValueMapRow` so "Not mapped" always means the same thing on the wire. */
export const VALUE_MAP_UNMAPPED = '__not_mapped__';

/** Not a real value-set code either. Selected, it means "write an UNMAPPED-FROM row for this value",
 *  which is a DECISION, unlike `VALUE_MAP_UNMAPPED` which means the operator has not answered yet. */
export const VALUE_MAP_IGNORE = '__ignore__';

/** ⛔ A DOOR, NOT AN OUTCOME. Selecting this never reaches `pendingValueMappings` and is never
 *  stored as a row's lasting choice. `VALUE_MAP_IGNORE` above does become one; this does not. The
 *  caller (`ColumnMapStep`) must intercept it and open `AddFacilityTypeDialog` instead of recording
 *  it. If this sentinel ever reached the wire as a `toCode`, it would be written into
 *  `term_mappings` and then read straight into the `level` field of every matching facility. */
export const VALUE_MAP_ADD = '__add_type__';

export interface ValueMapRowProps {
  /** The raw source value this row lets the operator map. */
  value: string;
  /** The ranker's own candidates for THIS value, best first. Legitimately empty. */
  candidates: ValueSuggestion['candidates'];
  /** The field's WHOLE value set, for the tail beneath the ranked candidates. */
  options: ValueSetOption[];
  /** The chosen code, or `VALUE_MAP_UNMAPPED`. */
  selected: string;
  onSelect: (code: string) => void;
  /** The contract field this row's header maps to. Decides whether `Ignore this value` is offered:
   *  `level` only, spec decision 6. ⛔ WITHHELD ON PURPOSE, not an accident of wiring. `status`
   *  and `country` have small closed vocabularies and no value that needs ignoring. Removing this
   *  check to "clean it up" widens the feature. */
  field: string;
}

/** Task 6: the per-value pick-list row, lifted out of `ValueMapPanel` so `ColumnMapStep` can render
 *  the exact same row under the mapping it belongs to, without a second copy of the ordering rules.
 *
 *  ⛔ DO NOT REWRITE THE ORDER. The ranked candidates keep their scored order, which is the point of
 *  ranking them, and only the remaining tail is sorted, alphabetically, by `sortValueSetOptions`:
 *  63 facility types in seed order cannot be searched by eye. `Not mapped` is always first. Measured
 *  on the real Zambia MFL export; see `sortValueSetOptions`'s own docblock for the report that made
 *  it necessary. */
export function ValueMapRow({
  value, candidates, options, selected, onSelect, field,
}: ValueMapRowProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const { hasCapability } = useAuth();
  // Same field gate as `Ignore this value` above (spec decision 6): `level` only. Withheld without
  // the capability rather than hidden outright, so the operator learns why instead of wondering
  // where it went. Map and Ignore still work either way, so the import is never blocked outright.
  const canAddType = hasCapability('terminology.manage');
  const top = candidates[0] ?? null;
  // Naturally absent when the row is a collision-free exact match, or unmatched.
  const showBadge = top?.confidence === 'likely' && selected === top.target;

  return (
    <Fragment>
      {/* ⛔ NOT `whitespace-nowrap`, for the same measured reason as the sibling Label in
          `ColumnMapStep.tsx`: these rows share one `auto` grid track, so the longest raw value
          sizes the whole column. "Catchment population head count" alone pushed that grid to 409px
          inside a 289px container at 375 wide, and the panel scrolled sideways at desktop width
          too. A raw register value can be longer still. `title` carries the full value on hover. */}
      <Label className="break-words text-foreground" title={value}>{value}</Label>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={onSelect}>
          <SelectTrigger aria-label={value} className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* ⛔ ONE SECTION for every outcome that is not "map to a code", then the separator,
                then the codes. Anything of that kind added later joins this section rather than
                getting its own. The operator asked for exactly this shape. */}
            <SelectItem value={VALUE_MAP_UNMAPPED}>{t('facilities.import.valueMap.notMapped')}</SelectItem>
            {field === 'level' && (
              <SelectItem value={VALUE_MAP_IGNORE}>{t('facilities.import.valueMap.ignoreValue')}</SelectItem>
            )}
            {field === 'level' && (
              <SelectItem
                value={VALUE_MAP_ADD}
                disabled={!canAddType}
                title={canAddType ? undefined : t('facilities.import.valueMap.addTypeNeedsCapability')}
              >
                {t('facilities.import.valueMap.addTypeOption', { value })}
              </SelectItem>
            )}
            {/* Radix's own `SelectSeparator` is `aria-hidden` and roleless, purely decorative.
                This one marks a real boundary between two kinds of outcome, so it gets a role a
                test (and a screen reader) can find. */}
            <SelectSeparator role="separator" aria-hidden={false} />
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
