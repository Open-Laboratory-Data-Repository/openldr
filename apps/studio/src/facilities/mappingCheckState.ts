import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ControlledField, ValueMappingEntry, ValueSetOption, ValueSuggestion } from '@/api';
import { VALUE_MAP_IGNORE, VALUE_MAP_UNMAPPED } from './ValueMapRow';

/** A pick is keyed by (header, value): one panel row per HEADER, and the same raw value can appear
 *  under two headers claiming different fields. `JSON.stringify` of a tuple, so a header containing
 *  the separator cannot collide with a different pair. */
export const valueChoiceKey = (header: string, value: string): string => JSON.stringify([header, value]);

/** A WRITTEN mapping is keyed by (field, value), which is what the register stores. Two headers
 *  mapped to the same field share one written mapping, correctly. */
export const resolvedValueKey = (field: string, value: string): string => JSON.stringify([field, value]);

/** One row of a header's value worklist: a raw value plus the ranker's own candidates for it. */
export type WorklistEntry = { value: string; candidates: ValueSuggestion['candidates'] };

/** One shape, holding one header's last check. It deliberately carries NO `unrecognised` count:
 *  membership in `values` is sticky so a choice the operator already made is never dropped, and
 *  the row's red/green is derived from what is still unresolved. See `unresolvedCount` in
 *  `ColumnMapStep.tsx`. */
export interface RowCheck {
  target: string;
  truncated: boolean;
  distinct: number;
  values?: WorklistEntry[];
  options?: ValueSetOption[];
  /** The `cellEditsAt` this check ran at. A later value means the file has changed underneath the
   *  answer, which is exactly what `stale` is for. */
  editsAt: number;
}

/** Everything the mapping step learns that must outlive the mapping step being on screen.
 *
 *  ⛔ THIS LIVES IN THE SHEET, NOT IN THE PANEL, and that is the whole point of the type existing.
 *  `ColumnMapStep` renders only while the sheet is on step 3, so every trip to Data unmounted it
 *  and took all three of these with it. The operator saw a row they had just checked red come back
 *  as unchecked, and, worse, lost every pick-list choice they had made but not yet saved. None of
 *  this describes the panel; it describes the RUN, and the sheet is what owns the run. */
export interface MappingCheckState {
  /** One entry per header that has ever been checked, holding what the check found and the target
   *  it ran against. */
  checkedByHeader: Record<string, RowCheck>;
  setCheckedByHeader: Dispatch<SetStateAction<Record<string, RowCheck>>>;
  /** Every (field, raw value) this sheet has actually written a mapping for. What lets a red row
   *  go back to green. Only a save the server accepted adds to it. */
  resolvedValues: ReadonlySet<string>;
  setResolvedValues: Dispatch<SetStateAction<ReadonlySet<string>>>;
  /** The operator's own value-mapping picks, keyed by (header, value), saved or not. */
  valueChoices: Record<string, string>;
  setValueChoices: Dispatch<SetStateAction<Record<string, string>>>;
  /** Throw all three away. The sheet calls this when the file or the register changes, which is
   *  the one thing that makes every stored answer describe a file nobody is importing any more.
   *  Unmounting used to do this by accident, which is exactly why it also did it when it should
   *  not have. */
  reset: () => void;
}

/** Owns the three pieces of mapping-check state. Called by `ImportFacilitiesSheet` and handed to
 *  `ColumnMapStep` whole. `ColumnMapStep` calls it too, for its own tests and for any caller that
 *  does not supply one, so the panel still works standalone. */
export function useMappingCheckState(): MappingCheckState {
  const [checkedByHeader, setCheckedByHeader] = useState<Record<string, RowCheck>>({});
  const [resolvedValues, setResolvedValues] = useState<ReadonlySet<string>>(new Set());
  const [valueChoices, setValueChoices] = useState<Record<string, string>>({});

  const reset = useCallback(() => {
    setCheckedByHeader({});
    setResolvedValues(new Set());
    setValueChoices({});
  }, []);

  return {
    checkedByHeader, setCheckedByHeader,
    resolvedValues, setResolvedValues,
    valueChoices, setValueChoices,
    reset,
  };
}

/** The choice standing for one value: the operator's own pick, else the ranker's top candidate when
 *  it is confident enough to act on, else nothing. */
export function valueChoice(
  choices: Record<string, string>,
  header: string,
  entryValue: string,
  candidates: ValueSuggestion['candidates'],
): string {
  const chosen = choices[valueChoiceKey(header, entryValue)];
  if (chosen) return chosen;
  const top = candidates[0];
  return top && top.confidence !== 'weak' ? top.target : VALUE_MAP_UNMAPPED;
}

/** Every value mapping this sheet has a choice for but has not written yet.
 *
 *  ⛔ TWO CALLERS, ONE ANSWER, and that is the point of it living here. A row's status icon writes
 *  its own header's entries before re-reading the column; "Validate all" writes every row's before
 *  re-validating the run. When only the icon wrote, an operator who picked values and then pressed
 *  Validate all got the original bug back through the other door: nothing written, so the check
 *  reported the same values unrecognised and Review named them again.
 *
 *  `targetFor` is the header's CURRENT contract field. A check recorded against a target the header
 *  no longer maps to describes a different field's values and is skipped, exactly as the render
 *  loop skips showing it.
 *
 *  @param header Restrict to one header. Omitted, every header is considered.
 */
export function pendingValueMappings(
  state: Pick<MappingCheckState, 'checkedByHeader' | 'valueChoices' | 'resolvedValues'>,
  targetFor: (header: string) => string,
  header?: string,
): ValueMappingEntry[] {
  const entries: ValueMappingEntry[] = [];
  for (const [h, check] of Object.entries(state.checkedByHeader)) {
    if (header !== undefined && h !== header) continue;
    if (check.target !== targetFor(h) || !check.values) continue;
    for (const { value: entryValue, candidates } of check.values) {
      const toCode = valueChoice(state.valueChoices, h, entryValue, candidates);
      if (!toCode || toCode === VALUE_MAP_UNMAPPED) continue;
      if (state.resolvedValues.has(resolvedValueKey(check.target, entryValue))) continue;
      // ⛔ `ignore: true` and NO `toCode`. The server refuses an entry carrying both, and the
      // sentinel must never reach the wire as a code: `__ignore__` in `toCode` would be written
      // into `term_mappings` and then read straight into `level`.
      entries.push(toCode === VALUE_MAP_IGNORE
        ? { field: check.target as ControlledField, rawValue: entryValue, ignore: true }
        : { field: check.target as ControlledField, rawValue: entryValue, toCode });
    }
  }
  return entries;
}
