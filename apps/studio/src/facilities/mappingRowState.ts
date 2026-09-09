export type MappingRowState = 'neutral' | 'valid' | 'invalid' | 'stale' | 'skipped';

export interface MappingRowInputs {
  /** This header collides with another over the same contract field. */
  collides: boolean;
  /** The ranker's confidence in the CURRENT target, or null when the operator chose it.
   *
   *  Kept in the inputs, and deliberately unused by the arithmetic below. See the reversal note
   *  on the function. */
  confidence: 'exact' | 'likely' | 'weak' | null;
  /** The per-field check's last answer for this row, or null if it has never run. */
  checked: { unrecognised: number } | null;
  /** The mapping or the file changed since `checked` was recorded. */
  stale: boolean;
  /** This header claims a contract field. False for one kept as extra data, which is carried
   *  through verbatim and checked against nothing. */
  mapped: boolean;
}

/** One mapping row's status, as arithmetic. Holds no React state and no copy, so it can be tested
 *  as a table the way `stepModel.ts` is.
 *
 *  ORDER MATTERS AND IT IS NOT ARBITRARY. A collision outranks everything: the map cannot be sent
 *  at all while one stands, so a green tick beside it would be a lie the operator acts on. Stale
 *  outranks a stored result, because that result describes a mapping that no longer exists. Only
 *  then does a recorded check get to speak.
 *
 *  ⛔ AN EXACT SUGGESTION NO LONGER GOES GREEN, and that is a reversal of the spec's own rule, not
 *  an oversight. The ranker scores the COLUMN NAME. It says nothing about the values inside the
 *  column, and `facility-mapping-suggest.ts`'s synonym table hands a hardcoded 1.0 to `type ->
 *  level` and `operational status -> status` — the only two headers in the real Zambia export
 *  whose values need checking at all. So the auto-green fired hardest exactly where it was least
 *  true, and told the operator not to click the one control that would have found the 16
 *  unrecognised values behind it. Only a check that actually read the column can turn a row green
 *  now. `confidence` stays in the inputs because the caller has it and a later rule may want it;
 *  nothing reads it today.
 *
 *  ⛔ A COLUMN KEPT AS EXTRA DATA IS SKIPPED, not neutral. It claims no contract field, so there is
 *  no vocabulary to check it against and nothing a check could find. Amber on those rows was noise
 *  that hid the signal: on the real Zambia export eleven of twenty-one headers are extras, so a
 *  single red row sat in a column of amber circles and did not stand out. Skipped outranks a stored
 *  check for the same reason stale does, since that check describes a field the column no longer
 *  claims. A collision still beats it: the map is refused while one stands.
 *
 *  ⛔ STALE REQUIRES A PRIOR CHECK. `stale` means "the answer on screen describes a mapping that no
 *  longer exists", and an unchecked row has no answer on screen to invalidate. Before the reversal
 *  an exact suggestion could reach 'stale' with `checked === null`, which asked the operator to
 *  re-run a check that had never run. */
export function mappingRowState({ collides, checked, stale, mapped }: MappingRowInputs): MappingRowState {
  if (collides) return 'invalid';
  if (!mapped) return 'skipped';
  if (!checked) return 'neutral';
  if (stale) return 'stale';
  return checked.unrecognised > 0 ? 'invalid' : 'valid';
}
