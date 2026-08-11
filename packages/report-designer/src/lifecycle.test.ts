import { describe, it, expect } from 'vitest';
import { computeNextDesignVersion, designContentFingerprint, designContentChanged } from './lifecycle';
import type { ReportDesign } from './schema';

const base: ReportDesign = {
  id: 'd', name: 'Design', paper: 'A4', orientation: 'portrait',
  pages: [{ id: 'p1', elements: [] }], parameters: [],
};

describe('computeNextDesignVersion', () => {
  it('starts at 1 and otherwise takes max + 1', () => {
    expect(computeNextDesignVersion([])).toBe(1);
    expect(computeNextDesignVersion([1, 2, 3])).toBe(4);
    expect(computeNextDesignVersion([3, 1, 2])).toBe(4);
  });
});

describe('designContentChanged', () => {
  it('ignores id and the stamped timestamps', () => {
    // These are envelope, not content: a re-read that stamps updated_at must not un-publish.
    expect(designContentChanged(base, { ...base, id: 'other', createdAt: 'x', updatedAt: 'y' })).toBe(false);
  });

  it('detects a rename', () => {
    // ⚠ Deliberate: a rename IS content, matching formContentChanged and report-seeds' designContent.
    // Renaming a published design therefore drops it to draft until republished.
    expect(designContentChanged(base, { ...base, name: 'Renamed' })).toBe(true);
  });

  it('detects paper, orientation, margins, pageNumbers, parameters and pages', () => {
    expect(designContentChanged(base, { ...base, paper: 'Letter' })).toBe(true);
    expect(designContentChanged(base, { ...base, orientation: 'landscape' })).toBe(true);
    expect(designContentChanged(base, { ...base, margins: { top: 1, right: 2, bottom: 3, left: 4 } })).toBe(true);
    expect(designContentChanged(base, { ...base, pageNumbers: true })).toBe(true);
    expect(designContentChanged(base, { ...base, parameters: [{ key: 'f', label: 'F' }] })).toBe(true);
    expect(designContentChanged(base, { ...base, pages: [{ id: 'p1', elements: [{ id: 'e', kind: 'text', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 } }] }] })).toBe(true);
  });

  it('treats an unset pageNumbers and an explicit false as the same content', () => {
    // Matches report-seeds' `pageNumbers ?? false` normalisation, so the seed's drift check and the
    // store's un-publish check cannot disagree.
    expect(designContentChanged(base, { ...base, pageNumbers: false })).toBe(false);
  });

  it('is stable against key order', () => {
    const reordered = { parameters: [], pages: [{ id: 'p1', elements: [] }], orientation: 'portrait', paper: 'A4', name: 'Design', id: 'd' } as ReportDesign;
    expect(designContentFingerprint(base)).toBe(designContentFingerprint(reordered));
  });
});
