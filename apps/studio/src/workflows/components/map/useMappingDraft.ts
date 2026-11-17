import { useEffect, useMemo, useState } from 'react';
import type { MapTarget } from '@openldr/forms/pure';
import { fetchMapTargets } from '@/api';
import { draftsFor, groupRows, savedMappingFor, savedMappingsOf, type RowDraft, type SampleRow, type ShapeGroup } from './rows';

/**
 * The sheet's working state: the targets, the chosen target and shape, and the row drafts for
 * that pair. Drafts carry the key they were made for, so a draft list from the previous target
 * or shape is never read as the current one.
 */
export function useMappingDraft({
  open,
  locale,
  config,
  rows,
}: {
  open: boolean;
  locale: string;
  config: Record<string, unknown>;
  rows: SampleRow[];
}) {
  const savedTargetId = typeof config.targetId === 'string' ? config.targetId : '';
  const [targets, setTargets] = useState<MapTarget[] | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);
  const [targetId, setTargetId] = useState(savedTargetId);
  const [shapeHash, setShapeHash] = useState('');
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

  const groups = useMemo(() => groupRows(rows), [rows]);
  const saved = useMemo(() => savedMappingsOf(config), [config]);
  const target = targets?.find((x) => x.id === targetId) ?? null;

  // Keep the current shape, else one with a saved mapping, else the first.
  useEffect(() => {
    if (groups.some((g) => g.hash === shapeHash)) return;
    const forTarget = saved.filter((m) => m.targetId === targetId);
    const withSaved = groups.find((g) => savedMappingFor(g, forTarget) !== null);
    setShapeHash((withSaved ?? groups[0])?.hash ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, targetId]);

  const group: ShapeGroup | null = groups.find((g) => g.hash === shapeHash) ?? null;
  const key = target && group ? `${target.id}|${group.hash}` : '';
  /** The saved mapping this group edits: same field names, else one holding all of them. */
  const loaded = target && group ? savedMappingFor(group, saved.filter((m) => m.targetId === target.id)) : null;

  // New drafts when the target or the shape changes, from the saved mapping for that shape.
  useEffect(() => {
    if (!target || !group) {
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
    groups,
    group,
    shapeHash,
    setShapeHash,
    saved,
    loaded,
    savedTargetId,
    drafts,
    draftsKey: key && state.key === key ? key : '',
    setDrafts,
  };
}
