import { useEffect, useMemo, useState } from 'react';
import type { MapTarget } from '@openldr/forms/pure';
import { fetchMapTargets } from '@/api';
import { columnSet, draftsFor, savedMappingFor, savedMappingsOf, type ColumnSet, type RowDraft, type Sample } from './rows';

/**
 * The sheet's working state: the targets, the chosen target, the sample's one set of columns, and
 * the row drafts for that pair. Drafts carry the key they were made for, so a draft list from the
 * previous target or column set is never read as the current one.
 */
export function useMappingDraft({
  open,
  locale,
  config,
  sample,
}: {
  open: boolean;
  locale: string;
  config: Record<string, unknown>;
  sample: Sample;
}) {
  const savedTargetId = typeof config.targetId === 'string' ? config.targetId : '';
  const [targets, setTargets] = useState<MapTarget[] | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [targetId, setTargetId] = useState(savedTargetId);
  const [state, setState] = useState<{ key: string; drafts: RowDraft[] }>({ key: '', drafts: [] });

  // Targets for the current language, loaded when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setTargets(null);
    setTargetsFailed(false);
    fetchMapTargets(locale)
      .then((list) => {
        if (!live) return;
        setTargets(list);
        // Each opening starts from the node's own target, which the node form may have changed.
        setTargetId(savedTargetId && list.some((x) => x.id === savedTargetId) ? savedTargetId : list[0]?.id || '');
      })
      .catch(() => {
        if (!live) return;
        setTargets([]);
        setTargetsFailed(true);
      });
    return () => {
      live = false;
    };
    // The node's target is read once per opening on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locale]);

  const saved = useMemo(() => savedMappingsOf(config), [config]);
  const target = targets?.find((x) => x.id === targetId) ?? null;
  const columns: ColumnSet | null = useMemo(() => columnSet(sample), [sample]);

  const key = target && columns ? `${target.id}|${columns.hash}` : '';
  /** The saved mapping the column set edits: same names, else one holding them all, else the widest inside. */
  const loaded = target && columns ? savedMappingFor(columns, saved.filter((m) => m.targetId === target.id)) : null;

  // New drafts when the target or the column set changes, from the saved mapping it edits.
  useEffect(() => {
    if (!target || !columns) {
      setState({ key: '', drafts: [] });
      return;
    }
    setState({ key, drafts: draftsFor(target, loaded) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const drafts = state.key === key ? state.drafts : [];
  const setDrafts = (fn: (ds: RowDraft[]) => RowDraft[]) =>
    setState((s) => (s.key === key ? { key, drafts: fn(s.drafts) } : s));

  return {
    targets,
    targetsFailed,
    target,
    targetId,
    setTargetId,
    columns,
    saved,
    loaded,
    savedTargetId,
    drafts,
    draftsKey: key && state.key === key ? key : '',
    setDrafts,
  };
}
