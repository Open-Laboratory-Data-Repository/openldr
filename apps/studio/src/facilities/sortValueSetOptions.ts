import type { ValueSetOption } from '@/api';

/**
 * Order a value set the way a person reads it: alphabetically, by the string actually on screen.
 *
 * ⛔ WHY THIS EXISTS. A value set arrives in EXPANSION order, which is the order migration 072
 * seeded it in, and 63 facility types or 249 countries in seed order cannot be searched by eye. An
 * operator asked to map `1st Level Hospital` was shown a list running "Hospital at Zonal Level,
 * Hospital at District Level, Dispensary, Health Center, Mobile Medical Clinic, PolyClinic" and
 * reported it as "incredible hard (as a human)".
 *
 * ⛔ SORT BY THE DISPLAY, NOT THE CODE. `Level IA2 (Dispensary Laboratory)` and its code
 * `level-ia2-dispensary-laboratory` sort into different places, and only one of them is on screen.
 * A concept with no display falls back to its code because that is then what is rendered.
 *
 * ⛔ LOCALE-AWARE, and not a plain comparison. This studio ships in en, fr and pt: a codepoint
 * comparison files every accented name after `Z`, so a French reader looking for `Île-de-France`
 * finds it past the end of the alphabet. `Intl.Collator` with `sensitivity: 'base'` also makes the
 * order case-insensitive, so a lowercase entry does not sort after every capitalised one.
 *
 * ⛔ NOT FOR A RANKED LIST. Where a ranker has already scored candidates, those keep their scored
 * order and this sorts only what is left underneath them (see `ValueMapRow`). Alphabetising a
 * ranking would throw away the thing that makes the top of it useful.
 *
 * Returns a new array; the input is not mutated.
 */
export function sortValueSetOptions(options: ValueSetOption[], language: string): ValueSetOption[] {
  const label = (o: ValueSetOption): string => (o.display && o.display !== '' ? o.display : o.code);
  // An unsupported or malformed tag must not take the panel down with it: a list in the wrong order
  // is a nuisance, a thrown RangeError is a blank pane.
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
  } catch {
    collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  }
  return [...options].sort((a, b) => collator.compare(label(a), label(b)));
}
