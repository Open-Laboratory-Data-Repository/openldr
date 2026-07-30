import * as React from 'react';

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

/**
 * Reactive form of {@link isNarrowViewport}, for layout that cannot be expressed with a Tailwind
 * breakpoint because it changes a COMPONENT PROP rather than a class — e.g. the date range picker
 * renders one calendar month instead of two on a phone. Re-renders on rotation and window resize.
 */
export function useIsNarrowViewport(maxPx = 767): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const query = window.matchMedia(`(max-width: ${maxPx}px)`);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    [maxPx],
  );
  // Server/jsdom snapshot is `false` — the wide layout — matching `isNarrowViewport`'s guard.
  return React.useSyncExternalStore(subscribe, () => isNarrowViewport(maxPx), () => false);
}
