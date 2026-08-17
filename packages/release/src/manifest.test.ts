import { describe, it, expect } from 'vitest';
import { buildReleaseManifest, parseReleaseManifest } from './manifest';

describe('buildReleaseManifest', () => {
  it('builds exactly the three fields, with the notes URL pointing at the v-prefixed tag', () => {
    const m = buildReleaseManifest({
      version: '0.2.0',
      releasedAt: '2026-08-20',
      owner: 'Open-Laboratory-Data-Repository',
      repo: 'openldr',
    });
    expect(m).toEqual({
      version: '0.2.0',
      releasedAt: '2026-08-20',
      notesUrl: 'https://github.com/Open-Laboratory-Data-Repository/openldr/releases/tag/v0.2.0',
    });
  });

  // The spec fixes the shape at three fields; a fourth would be read by nothing and mislead.
  it('emits no other keys', () => {
    const m = buildReleaseManifest({ version: '1.0.0', releasedAt: '2026-01-01', owner: 'o', repo: 'r' });
    expect(Object.keys(m).sort()).toEqual(['notesUrl', 'releasedAt', 'version']);
  });

  it('refuses a version it cannot parse', () => {
    expect(() => buildReleaseManifest({ version: 'latest', releasedAt: '2026-01-01', owner: 'o', repo: 'r' }))
      .toThrow(/latest/);
  });

  it('refuses a releasedAt that is not YYYY-MM-DD', () => {
    expect(() => buildReleaseManifest({ version: '1.0.0', releasedAt: '20 Aug 2026', owner: 'o', repo: 'r' }))
      .toThrow(/releasedAt/);
  });
});

describe('parseReleaseManifest', () => {
  const valid = {
    version: '0.2.0',
    releasedAt: '2026-08-20',
    notesUrl: 'https://github.com/o/r/releases/tag/v0.2.0',
  };

  it('accepts a valid manifest', () => {
    expect(parseReleaseManifest(valid)).toEqual(valid);
  });

  it('ignores unknown keys rather than failing, so adding a field later cannot break old installs', () => {
    expect(parseReleaseManifest({ ...valid, futureField: 1 })).toEqual(valid);
  });

  it('rejects a missing field', () => {
    expect(parseReleaseManifest({ version: '0.2.0', releasedAt: '2026-08-20' })).toBeNull();
  });

  it('rejects a wrong type', () => {
    expect(parseReleaseManifest({ ...valid, version: 2 })).toBeNull();
  });

  it('rejects an unparseable version', () => {
    expect(parseReleaseManifest({ ...valid, version: 'latest' })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseReleaseManifest(null)).toBeNull();
    expect(parseReleaseManifest('0.2.0')).toBeNull();
  });
});
