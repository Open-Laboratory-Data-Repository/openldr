// Ranked mapping suggestions for a national facility list whose columns and vocabulary are not ours.
//
// ⛔ PURE AND OFFLINE. No database, no network, no model call — these labs run without connectivity,
// so a suggestion an operator cannot get in the room is no suggestion at all. Everything here is a
// string function over data the caller already has, which is also why it is exhaustively testable.
//
// ⛔ IT MUST BE WILLING TO SAY NOTHING. A weak guess that an operator confirms without reading is
// worse than a blank they have to fill in: it ships a wrong vocabulary looking confirmed. `WEAK_MIN`
// is the floor below which this module returns no candidate at all.

import { FACILITY_CONTRACT_FIELDS } from '@openldr/terminology';

/** Header words that name a contract field without spelling it.
 *
 *  ⛔ Country-specific vocabulary, and deliberately AMBIGUOUS across countries: Tanzania's `region`
 *  is a contract field in its own right, while Zambia's `province` means our `zone`. This table can
 *  never know which country a file came from, so it only ever SUGGESTS — nothing here is applied
 *  without an operator confirming it. */
const SYNONYMS: Record<string, string> = {
  'mfl code': 'national_code', 'hfr code': 'national_code', 'facility code': 'national_code',
  'national code': 'national_code', code: 'national_code',
  'facility name': 'name',
  province: 'zone', state: 'zone', zonal: 'zone',
  county: 'region', 'sub region': 'region',
  woreda: 'district', lga: 'district',
  'local authority': 'council', municipality: 'council',
  type: 'level', 'facility type': 'level', tier: 'level',
  'operational status': 'status', 'facility status': 'status',
  owner: 'ownership', 'ownership type': 'ownership',
  lat: 'latitude', lon: 'longitude', lng: 'longitude',
  telephone: 'phone', 'phone number': 'phone', msisdn: 'phone',
  'physical address': 'address', 'street address': 'address',
};

export type SuggestionConfidence = 'exact' | 'likely' | 'weak';

export interface Suggestion {
  /** The contract field, or the value-set code, being suggested. */
  target: string;
  /** Human label for the target, when it has one distinct from the code. */
  display: string | null;
  /** 0..1. Exact matches are 1. */
  score: number;
  confidence: SuggestionConfidence;
}

export interface ColumnSuggestion {
  /** The header exactly as it appears in the file. */
  header: string;
  /** Best first. EMPTY when nothing scored above `WEAK_MIN` — see this file's header. */
  candidates: Suggestion[];
}

export interface ValueCandidate { code: string; display: string | null }

export interface ValueSuggestion {
  /** The raw source value exactly as it appears in the file. */
  value: string;
  candidates: Suggestion[];
}

/** Below this, no candidate is offered at all. */
const WEAK_MIN = 0.62;
/** At or above this, a similarity match is pre-selected in the UI (badged for checking). */
const LIKELY_MIN = 0.78;
/** How many candidates to return per subject. */
const MAX_CANDIDATES = 5;

export function normaliseLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Sørensen–Dice over character bigrams. Chosen over edit distance because it is length-insensitive
 *  and rewards shared word fragments — `health centre` vs `health center` scores high, while
 *  `1st level hospital` vs `district hospital` does not clear `WEAK_MIN`, which is the outcome that
 *  matters most here. */
export function similarity(a: string, b: string): number {
  const na = normaliseLabel(a);
  const nb = normaliseLabel(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let shared = 0;
  let total = 0;
  for (const n of ba.values()) total += n;
  for (const [g, n] of bb) {
    total += n;
    shared += Math.min(n, ba.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * shared) / total;
}

function rank(subject: string, candidates: readonly ValueCandidate[]): Suggestion[] {
  const scored: Suggestion[] = [];
  for (const c of candidates) {
    const byCode = similarity(subject, c.code);
    const byDisplay = c.display ? similarity(subject, c.display) : 0;
    const score = Math.max(byCode, byDisplay);
    if (score < WEAK_MIN) continue;
    scored.push({
      target: c.code,
      display: c.display,
      score,
      confidence: score === 1 ? 'exact' : score >= LIKELY_MIN ? 'likely' : 'weak',
    });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, MAX_CANDIDATES);
}

export function suggestColumns(headers: readonly string[]): ColumnSuggestion[] {
  return headers.map((header) => {
    const n = normaliseLabel(header);

    const synonym = SYNONYMS[n];
    if (synonym) {
      return { header, candidates: [{ target: synonym, display: null, score: 1, confidence: 'exact' as const }] };
    }
    const direct = FACILITY_CONTRACT_FIELDS.find((f) => normaliseLabel(f) === n);
    if (direct) {
      return { header, candidates: [{ target: direct, display: null, score: 1, confidence: 'exact' as const }] };
    }
    return {
      header,
      candidates: rank(header, FACILITY_CONTRACT_FIELDS.map((f) => ({ code: f, display: null }))),
    };
  });
}

export function suggestValues(
  raw: readonly string[], candidates: readonly ValueCandidate[],
): ValueSuggestion[] {
  return raw.map((value) => ({ value, candidates: rank(value, candidates) }));
}
