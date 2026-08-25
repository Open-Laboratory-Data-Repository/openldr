import { describe, it, expect } from 'vitest';
import { truncateToFittingTail } from './truncate-segments';

// `fits` is injected so this can be tested without a layout engine: accept any
// candidate up to a fixed character budget. The ellipsis is part of what gets measured,
// same as real pixel measurement would include it.
function fitsWithin(maxChars: number): (candidate: string) => boolean {
  return (candidate) => candidate.length <= maxChars;
}

describe('truncateToFittingTail', () => {
  it('returns the whole text unchanged when it fits, no ellipsis', () => {
    expect(truncateToFittingTail('Location.address.period', fitsWithin(100))).toBe(
      'Location.address.period',
    );
  });

  it('drops one leading segment when the whole text does not fit', () => {
    // 'Location.address.period.start' is 30 chars. Budget for 22 leaves room for
    // '…address.period.start' (22 chars) but not the full text.
    const result = truncateToFittingTail('Location.address.period.start', fitsWithin(22));
    expect(result).toBe('…address.period.start');
  });

  it('drops several leading segments when only a shorter suffix fits', () => {
    // '…period.start' is 13 chars.
    const result = truncateToFittingTail('Location.address.period.start', fitsWithin(13));
    expect(result).toBe('…period.start');
  });

  it('drops down to the last segment alone when nothing longer fits', () => {
    // '…start' is 6 chars.
    const result = truncateToFittingTail('Location.address.period.start', fitsWithin(6));
    expect(result).toBe('…start');
  });

  it('measures the ellipsis as part of the budget, not free', () => {
    // '…start' is 6 chars: 1 ellipsis + 5 letters. A budget of 5 cannot fit it, so this
    // must fall through to the character-level fallback instead of returning '…start'.
    const result = truncateToFittingTail('Location.address.period.start', fitsWithin(5));
    expect(result).not.toBe('…start');
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.startsWith('…')).toBe(true);
  });

  it('falls back to a character-level suffix when not even the last segment fits', () => {
    // Last segment 'start' needs '…start' (6 chars), budget is only 4.
    const result = truncateToFittingTail('Location.address.period.start', fitsWithin(4));
    // Longest suffix of the full text, ellipsis-prefixed, that fits in 4 chars: '…' + 3 chars.
    expect(result).toBe('…art');
  });

  it('falls back to character-level truncation for text with no separator', () => {
    const result = truncateToFittingTail('averylongsinglewordwithnodots', fitsWithin(6));
    expect(result).toBe('…odots');
    expect(result.startsWith('…')).toBe(true);
  });

  it('returns the empty string unchanged, no crash', () => {
    expect(truncateToFittingTail('', fitsWithin(0))).toBe('');
  });

  it('shows at least the last character when nothing else fits', () => {
    const result = truncateToFittingTail('Location.address.period.start', fitsWithin(0));
    expect(result).toBe('…t');
    expect(result.length).toBeGreaterThan(0);
  });

  it('supports a custom separator', () => {
    const result = truncateToFittingTail('a/b/c/d', fitsWithin(4), '/');
    expect(result).toBe('…c/d');
  });
});
