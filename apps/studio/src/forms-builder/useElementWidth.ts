import { useEffect, useState } from 'react';

/**
 * Below this workspace width the Form and Library panes become tabs. Corlix measures the two-pane
 * area, not the viewport: the sidebar is already subtracted, so collapsing it can bring the panes back.
 */
export const NARROW_WORKSPACE_PX = 980;

/**
 * The measured width of an element, in pixels, updating as it resizes. Ported from corlix
 * `hooks/useElementWidth.ts`.
 *
 * Returns 0 until the first measurement, so a caller can tell "not measured yet" from "measured
 * and narrow".
 *
 * It hands back a callback ref, not a `RefObject`. An effect keyed on a `RefObject` runs once, so
 * an element that mounts later is never observed. Corlix shipped that version first, and it never
 * fired because its builder mounts the body after the form loads.
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!node) return;
    if (typeof ResizeObserver !== 'function') {
      setWidth(node.clientWidth);
      return;
    }
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, width];
}
