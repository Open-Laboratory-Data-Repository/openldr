export type MappingRowState = 'neutral' | 'valid' | 'invalid' | 'stale';

export interface MappingRowInputs {
  /** This header collides with another over the same contract field. */
  collides: boolean;
  /** The ranker's confidence in the CURRENT target, or null when the operator chose it. */
  confidence: 'exact' | 'likely' | 'weak' | null;
  /** The per-field check's last answer for this row, or null if it has never run. */
  checked: { unrecognised: number } | null;
  /** The mapping or the file changed since `checked` was recorded. */
  stale: boolean;
}

/** One mapping row's status, as arithmetic. Holds no React state and no copy, so it can be tested
 *  as a table the way `stepModel.ts` is.
 *
 *  ORDER MATTERS AND IT IS NOT ARBITRARY. A collision outranks everything: the map cannot be sent
 *  at all while one stands, so a green tick beside it would be a lie the operator acts on. Stale
 *  outranks a stored result, because that result describes a mapping that no longer exists. Only
 *  then does a recorded check, or an exact suggestion, get to speak. */
export function mappingRowState({ collides, confidence, checked, stale }: MappingRowInputs): MappingRowState {
  if (collides) return 'invalid';
  if (stale) return 'stale';
  if (checked) return checked.unrecognised > 0 ? 'invalid' : 'valid';
  if (confidence === 'exact') return 'valid';
  return 'neutral';
}
