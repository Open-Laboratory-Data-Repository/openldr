import { useEffect, useRef, useState } from 'react';
import { expandValueSetByUrl, fetchMapCodeLists, findValueSetByUrl, storedValueSetCodes, suggestMapping, type ExpandedCode } from '@/api';
import { hasSource, type RowDraft } from './rows';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
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
 * The codes of a value set by URL: its stored codes, else its live expansion, as the forms read a
 * FHIR list such as Sex that takes a whole code system and so keeps no stored codes. Null when
 * the install holds no such set and the expansion gives none.
 */
export async function loadValueSetCodes(url: string): Promise<ExpandedCode[] | null> {
  const held = await findValueSetByUrl(url);
  const stored = held ? await storedValueSetCodes(held.id) : [];
  if (stored.length > 0) return stored;
  const live = await expandValueSetByUrl(url).catch(() => [] as ExpandedCode[]);
  if (live.length > 0) return live;
  return held ? [] : null;
}

/**
 * The codes of each value set URL, for rule suggestions and their lines: the list once loaded,
 * null while loading or when the install has no codes for it. Each URL is loaded once per sheet.
 */
export function useCodeSets(urls: string[]): Record<string, ExpandedCode[] | null> {
  const [sets, setSets] = useState<Record<string, ExpandedCode[] | null>>({});
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
      loadValueSetCodes(url).then((codes) => {
        if (mounted.current) setSets((s) => ({ ...s, [url]: codes }));
      }).catch(() => {
        if (mounted.current) setSets((s) => ({ ...s, [url]: null }));
      });
    }
  }, [key]);
  return sets;
}

/** Whether a node on this node's incoming edge is a webhook trigger, whose rows sit under `body`. */
export function useFeedsFromWebhook(nodeId: string): boolean {
  return useWorkflowStore((s) => {
    const feeders = new Set(s.edges.filter((e) => e.target === nodeId).map((e) => e.source));
    return s.nodes.some((n) => {
      if (!feeders.has(n.id)) return false;
      const d = n.data as { templateId?: unknown; triggerType?: unknown };
      return n.type === 'webhook' || d.templateId === 'webhook-trigger' || d.triggerType === 'webhook';
    });
  });
}

/**
 * Whether an Extract from File node on this node's incoming edge reads CSV with "Read every cell
 * as text" off. Then xlsx guesses types, so leading zeros, decimal commas and dates change.
 */
export function useFeedsFromExtractGuessing(nodeId: string): boolean {
  return useWorkflowStore((s) => {
    const feeders = new Set(s.edges.filter((e) => e.target === nodeId).map((e) => e.source));
    return s.nodes.some((n) => {
      if (!feeders.has(n.id)) return false;
      const d = n.data as { templateId?: unknown; action?: unknown; config?: Record<string, unknown> };
      if (d.action !== 'extract-from-file' && d.templateId !== 'extract-from-file') return false;
      const config = d.config ?? {};
      return config.format === 'csv' && config.cellsAsText !== true;
    });
  });
}
