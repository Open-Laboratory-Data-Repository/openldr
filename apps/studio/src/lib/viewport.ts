/**
 * True when the viewport is narrower than `maxPx` (default 767 — below Tailwind's `md` breakpoint).
 *
 * Used to pick a mobile-first initial state for split-pane screens (Query, Reports, Report
 * Designer, Docs) so their side panels start collapsed and the main content gets the full width.
 * Multi-pane editors (the report designer's explorer + canvas + inspector) need more room, so they
 * pass a larger breakpoint (e.g. 1023, below `lg`). Guards `matchMedia` because it is absent in the
 * jsdom test environment and during SSR.
 */
export function isNarrowViewport(maxPx = 767): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(max-width: ${maxPx}px)`).matches
  );
}
