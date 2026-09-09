import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SuggestCombobox, type SuggestStatus } from '@/components/ui/suggest-combobox';
import { suggestValueMappings, type ControlledField, type ValueSetOption } from '@/api';
import { sortValueSetOptions } from './sortValueSetOptions';

export interface ConstantValueFieldProps {
  /** Matches the sibling `<Label htmlFor>` in `ColumnMapStep`'s constants grid. */
  id: string;
  field: ControlledField;
  /** The constant exactly as stored, untrimmed. `ColumnMapStep`'s `setConstant` does not trim, and
   *  the parser copies it into every row verbatim, so the canonical check below must not trim
   *  either. A leading space really is a different value. */
  value: string;
  onChange: (next: string) => void;
  /** The register this picker's list belongs to. Not optional: `suggestValueMappings` takes it as a
   *  required third argument, so a caller that has none passes `''` and gets the shared list, the
   *  same as an older client would. Mirrors `ColumnMapStep`'s own `nationalSystem` prop. */
  nationalSystem: string;
}

/** A fixed value for ONE controlled field, picked from that field's own value set.
 *
 *  ⛔ IT PROPOSES, IT DOES NOT CONSTRAIN. `SuggestCombobox` commits whatever is typed. That is
 *  deliberate: a field whose value set is not seeded on this install has nothing to offer, and
 *  refusing the operator's own value there would be worse than the plain text box this replaced.
 *  The warning line is what closes the gap, by saying at Mapping what Review would otherwise say
 *  a step later.
 *
 *  ⛔ THE VALUE STORED IS THE CODE. `applyControlledFields` rewrites a mapped raw value to its
 *  canonical code (`packages/bootstrap/src/facility-controlled-fields.ts:183`), so a code chosen
 *  here is the same string the mapping round trip would have produced, and it skips that round trip
 *  entirely. The display renders as the option's label, so the list stays readable and searchable.
 *
 *  ⛔ THREE OUTCOMES, NOT TWO. "Loading", "the set is not seeded" and "the request failed" are
 *  distinct and are shown distinctly. `ValueMapPanel` shipped with the last two collapsed and an
 *  operator could not tell an empty picker from a broken one. Never warn in any of the three: the
 *  warning claims the value was checked, and in all three it was not. */
export function ConstantValueField({
  id, field, value, onChange, nationalSystem,
}: ConstantValueFieldProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const [options, setOptions] = useState<ValueSetOption[]>([]);
  const [status, setStatus] = useState<SuggestStatus>('loading');
  const [notSeeded, setNotSeeded] = useState(false);

  // ⛔ NO REF GUARD. `[field]` is already the correct and sufficient guard, and a ref set before the
  // await is exactly what made the old value-map panel render empty pickers under React 18
  // StrictMode in dev: pass one started the request and set the ref, cleanup set `cancelled`, pass
  // two saw the ref match and returned, and the first request resolved into a cancelled closure. An
  // operator hit that on a real import and asked what to do with twenty-three unmappable values;
  // the panel had never loaded anything at all. The dependency array had already ruled out the
  // re-run the ref was guarding against, so the ref bought nothing and cost that failure.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setNotSeeded(false);
    setOptions([]);
    void suggestValueMappings(field, [], nationalSystem)
      .then((res) => {
        if (cancelled) return;
        // `?? []` because the route omits `options` when the value set is missing, and several
        // existing test doubles resolve without the key at all.
        setOptions(res.options ?? []);
        setNotSeeded(res.notValidated === true);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => { cancelled = true; };
  }, [field, nationalSystem]);

  /** ⛔ SORTED. Nothing ranks this list, so it would otherwise render in expansion order, which is
   *  seed order: 249 countries and 63 facility types that way are unsearchable by eye. */
  const sorted = useMemo(() => sortValueSetOptions(options, i18n.language), [options, i18n.language]);
  const codes = useMemo(() => sorted.map((o) => o.code), [sorted]);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[o.code] = o.display && o.display !== '' ? o.display : o.code;
    return m;
  }, [options]);

  /** The code renders as the option's second line, so the operator sees the exact string the
   *  picker is about to store before they pick it. Omitted when it would repeat the label. */
  const descriptions = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) if (labels[o.code] !== o.code) m[o.code] = o.code;
    return m;
  }, [options, labels]);

  /** Codes AND non-empty displays, mirroring `resolveControlledFields`'s own rule
   *  (`packages/bootstrap/src/facility-controlled-fields.ts:139-143`). A check that differed from
   *  that one would warn about values the import accepts, or stay silent on values it does not. */
  const canonical = useMemo(() => {
    const s = new Set<string>();
    for (const o of options) {
      s.add(o.code);
      if (o.display !== null && o.display !== '') s.add(o.display);
    }
    return s;
  }, [options]);

  const checked = status === 'ready' && !notSeeded;
  const warn = checked && value !== '' && !canonical.has(value);

  return (
    <div className="space-y-1">
      <SuggestCombobox
        id={id}
        value={value}
        onChange={onChange}
        options={codes}
        optionLabels={labels}
        optionDescriptions={descriptions}
        status={status}
        placeholder={t('facilities.import.columnMap.constantPickerPlaceholder')}
        loadingLabel={t('facilities.import.columnMap.constantPickerLoading')}
        noSuggestionsLabel={t('facilities.import.columnMap.constantPickerEmpty')}
        errorFallback={t('facilities.import.columnMap.constantPickerError')}
      />
      {status === 'ready' && notSeeded && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('facilities.import.columnMap.constantNotSeeded', { field })}
        </p>
      )}
      {warn && (
        <p role="status" className="text-xs text-amber-700">
          {t('facilities.import.columnMap.constantNotInList', { field })}
        </p>
      )}
    </div>
  );
}
