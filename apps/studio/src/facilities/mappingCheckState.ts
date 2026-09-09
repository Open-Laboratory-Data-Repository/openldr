import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ValueSetOption, ValueSuggestion } from '@/api';

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
