import { useEffect, useRef, useState } from 'react';
import { fetchMapCodeLists, findValueSetByUrl, storedValueSetCodes, suggestMapping } from '@/api';
import { hasSource, type RowDraft } from './rows';
import type { CodeListsState } from './RuleEditor';

/**
 * Suggestions for rows with no source: the suggest route is called once per target and shape,
 * with the shape's field names (never a value). A suggestion is only shown. It becomes part of
 * the mapping only when the person accepts it, which sets the row's source.
 */
export function useSuggestions({
  open,
  draftsKey,
  targetId,
  shape,
  drafts,
  locale,
}: {
  open: boolean;
  /** Set once the drafts for this target and shape exist; empty before. */
  draftsKey: string;
  targetId: string;
  shape: { hash: string; fieldNames: string[] } | null;
  drafts: RowDraft[];
  locale: string;
}): Record<string, string> {
  const [byPath, setByPath] = useState<Record<string, string>>({});
  const key = open && draftsKey ? draftsKey : null;

  useEffect(() => {
    setByPath({});
    if (!key) return;
    if (!shape || drafts.every(hasSource)) return;
    let live = true;
    suggestMapping({ targetId, fieldNames: shape.fieldNames, locale })
      .then((list) => {
        if (!live) return;
        const next: Record<string, string> = {};
        for (const s of [...list].sort((a, b) => b.score - a.score)) if (!next[s.targetPath]) next[s.targetPath] = s.field;
        setByPath(next);
      })
      .catch(() => live && setByPath({}));
    return () => {
      live = false;
    };
    // The drafts are read when the key changes only: one call per target and shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return byPath;
}

/** The install's code lists, loaded the first time a row picks the code list rule. */
export function useCodeLists(needed: boolean): CodeListsState {
  const [state, setState] = useState<CodeListsState>('loading');
  const started = useRef(false);
  useEffect(() => {
    if (!needed || started.current) return;
    started.current = true;
    fetchMapCodeLists()
      .then(setState)
      .catch(() => setState('failed'));
  }, [needed]);
  return state;
}

/**
 * The codes of each value set URL, for rule suggestions: a Set once loaded, null while loading or
 * when the install does not hold that value set. Each URL is loaded once per sheet.
 */
export function useCodeSets(urls: string[]): Record<string, Set<string> | null> {
  const [sets, setSets] = useState<Record<string, Set<string> | null>>({});
  const started = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = [...new Set(urls)].sort().join('\n');
  useEffect(() => {
    for (const url of key ? key.split('\n') : []) {
      if (started.current.has(url)) continue;
      started.current.add(url);
      (async () => {
        const held = await findValueSetByUrl(url);
        const codes = held ? await storedValueSetCodes(held.id) : null;
        if (mounted.current) setSets((s) => ({ ...s, [url]: codes ? new Set(codes.map((c) => c.code)) : null }));
      })().catch(() => {
        if (mounted.current) setSets((s) => ({ ...s, [url]: null }));
      });
    }
  }, [key]);
  return sets;
}
