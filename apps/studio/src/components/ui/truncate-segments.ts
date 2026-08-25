const ELLIPSIS = '…';

/**
 * Longest separator-aligned suffix of `text` that satisfies `fits`, prefixed with an ellipsis.
 *
 * Pure so it can be tested without a layout engine: `fits` is injected, and jsdom reports every
 * width as zero. The caller supplies real measurement.
 *
 * Returns `text` unchanged when the whole value fits. Falls back to the longest fitting suffix
 * of any length when not even one whole segment fits, so an extremely narrow column still shows
 * something rather than an ellipsis alone.
 */
export function truncateToFittingTail(
  text: string,
  fits: (candidate: string) => boolean,
  separator = '.',
): string {
  if (text === '') return text;
  if (fits(text)) return text;

  const segments = text.split(separator);

  // Longest separator-aligned suffix first: drop one leading segment at a time until
  // only the last segment remains. `a.b.c.d` tries `…b.c.d`, then `…c.d`, then `…d`.
  for (let dropCount = 1; dropCount < segments.length; dropCount += 1) {
    const candidate = ELLIPSIS + segments.slice(dropCount).join(separator);
    if (fits(candidate)) return candidate;
  }

  // No separator-aligned suffix fits (or there was no separator to begin with).
  // Fall back to the longest character-level suffix that fits, longest first.
  for (let len = text.length - 1; len >= 1; len -= 1) {
    const candidate = ELLIPSIS + text.slice(text.length - len);
    if (fits(candidate)) return candidate;
  }

  // Nothing fits, not even a single character. Still never return the ellipsis alone
  // or an empty string: show the last character so there is always something to read.
  return ELLIPSIS + text.slice(-1);
}
