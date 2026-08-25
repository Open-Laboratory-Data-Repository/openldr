import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { truncateToFittingTail } from '@/components/ui/truncate-segments';

// Lazily created, module-level canvas 2D context reused for every measurement. Created on
// first use rather than at import time, so importing this module has no side effect.
// jsdom has no canvas: `getContext('2d')` returns null there (and some environments throw
// instead of returning null), which the caller must treat as "measurement unavailable" and
// fall back to the full text, never crash and never render nothing.
let measurementContext: CanvasRenderingContext2D | null | undefined;
function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext === undefined) {
    try {
      // jsdom's getContext('2d') can return undefined (not null) rather than throw;
      // normalize so the cache is populated once instead of retried on every call.
      measurementContext = document.createElement('canvas').getContext('2d') ?? null;
    } catch {
      measurementContext = null;
    }
  }
  return measurementContext;
}

export interface TruncatedTextProps {
  /** The full text to render (and truncate). */
  text: string;
  className?: string;
  /** Element type for the truncating node. Defaults to 'span'. */
  as?: 'span' | 'div';
  /** Tooltip side, when shown. Defaults to 'top'. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Which end to clip when the text does not fit. Defaults to 'end', the normal
   * behaviour: the tail is hidden and the ellipsis sits on the right.
   *
   * 'start' clips the head instead, so the tail stays readable. Use it for values whose
   * meaning lives at the end, such as a FHIR path, a file path, or a URL, where
   * `Location.address.per...` is useless but `...address.period.start` is not.
   *
   * Computed in JS with a canvas measurement, not CSS: the display string is cut on a
   * `.` separator, never mid-segment, so `Location.address.period.start` shortens to
   * `…address.period.start` rather than a pixel-cut fragment like `…tion.identifier`.
   * See `truncate-segments.ts` for the cutting logic. When canvas measurement is
   * unavailable (jsdom has no canvas), this renders the full text instead of guessing.
   */
  truncateFrom?: 'end' | 'start';
}

/**
 * Renders single-line truncated text and shows a tooltip with the full text
 * ONLY when the text is actually clipped (scrollWidth > clientWidth). Never
 * shows a tooltip when the text fits — avoids the "tooltip on everything"
 * anti-pattern.
 *
 * Self-contained: wraps itself in its own TooltipProvider so it works
 * anywhere without requiring an ancestor provider (Radix allows nested
 * providers, so this is safe to nest inside a page that already has one).
 */
export function TruncatedText({
  text, className, as = 'span', side = 'top', truncateFrom = 'end',
}: TruncatedTextProps): JSX.Element {
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [displayText, setDisplayText] = useState(text);

  // Read via refs inside `measure`, not via closure, so `measure`'s identity stays stable
  // (empty deps) exactly like before this mode existed. `attach` depends on `measure`, and
  // `attach` is a ref callback: if its identity changed on every `text` change, React would
  // detach and reattach the ResizeObserver on every keystroke for the 'end' path too, which
  // is not what happens today. Keeping `measure` stable preserves that for both paths.
  const textRef = useRef(text);
  textRef.current = text;
  const truncateFromRef = useRef(truncateFrom);
  truncateFromRef.current = truncateFrom;

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    if (truncateFromRef.current === 'start') {
      const ctx = getMeasurementContext();
      if (!ctx) {
        // No canvas support: render the full text rather than guess at a cut point.
        setDisplayText(textRef.current);
        return;
      }
      ctx.font = getComputedStyle(el).font;
      const width = el.clientWidth;
      setDisplayText(truncateToFittingTail(
        textRef.current,
        (candidate) => ctx.measureText(candidate).width <= width,
      ));
      return;
    }
    setTruncated(el.scrollWidth > el.clientWidth);
  }, []);

  // Callback ref (not a plain useRef): when `truncated` flips false→true the
  // returned root changes (bare node → TooltipTrigger tree), so React unmounts
  // the original element and mounts a NEW one inside the trigger. A callback ref
  // re-runs on that swap — attach(null) disconnects the observer on the old
  // (now-detached) node, then attach(newEl) observes the currently-mounted one —
  // so resize tracking keeps working after the first truncation. measure() sets
  // state to the actual overflow for the current width, so it's stable for a
  // given width (React bails on same-state, no oscillation).
  const attach = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    elRef.current = el;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, [measure]);

  // The callback ref only re-runs on mount/unmount, not when `text` changes on
  // the same mounted node — re-measure here so a new value is checked for clip.
  useEffect(() => { measure(); }, [text, measure]);

  // 'end' (the default) renders `text` verbatim and clips with pure CSS `truncate`,
  // unchanged from before this mode existed. 'start' renders the JS-computed
  // `displayText`, already cut on a separator boundary (or the full text, when
  // measurement is unavailable).
  const displayedText = truncateFrom === 'start' ? displayText : text;
  const isTruncated = truncateFrom === 'start' ? displayText !== text : truncated;

  const node = as === 'div'
    ? <div ref={attach} className={cn('block truncate', className)}>{displayedText}</div>
    : <span ref={attach} className={cn('block truncate', className)}>{displayedText}</span>;

  if (!isTruncated) return node;

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side={side}>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
