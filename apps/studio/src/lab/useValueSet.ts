import { useEffect, useState } from 'react';
import { expandValueSetByUrl, type ReceptionCoding } from '@/api';

/** The value sets the lab desk reads. Their codes come from the terminology service, never from
 *  this source (AGENTS.md section 8). `$expand` has no capability gate, so Reception can read them. */
export const SEX_VALUE_SET = 'http://hl7.org/fhir/ValueSet/administrative-gender';
export const PRIORITY_VALUE_SET = 'http://hl7.org/fhir/ValueSet/request-priority';
export const SAMPLE_CONDITION_VALUE_SET = 'urn:openldr:valueset:sample-condition';

export interface ValueSetState {
  codes: ReceptionCoding[];
  loading: boolean;
  error: string | null;
  /** Read, and nothing to pick: the read failed or the set holds no codes. Show a message, not an empty picker. */
  unusable: boolean;
}

/** A value set's codes, read once while `enabled`. A failed read leaves the list empty and says why. */
export function useValueSet(url: string, enabled = true): ValueSetState {
  const [codes, setCodes] = useState<ReceptionCoding[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setLoading(true);
    setError(null);
    expandValueSetByUrl(url)
      .then((rows) => { if (live) setCodes(rows); })
      .catch((e: unknown) => { if (live) { setCodes([]); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url, enabled]);
  return { codes, loading, error, unusable: !loading && codes.length === 0 };
}

/** The display of a code in a value set, or the code itself when the set does not hold it. */
export function displayOf(codes: ReceptionCoding[], code: string | null): string | null {
  if (!code) return null;
  return codes.find((c) => c.code === code)?.display ?? code;
}
