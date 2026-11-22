import { describe, expect, it } from 'vitest';
import { withDocsVersion } from './version-link';

describe('withDocsVersion', () => {
  it('replaces the placeholder with the version', () => {
    expect(withDocsVersion('https://github.com/o/r/tree/v{{version}}/examples', '0.1.12')).toBe('https://github.com/o/r/tree/v0.1.12/examples');
    // The markdown renderer percent-encodes the braces before a link renderer sees the href.
    expect(withDocsVersion('https://github.com/o/r/tree/v%7B%7Bversion%7D%7D/examples', '0.1.12')).toBe('https://github.com/o/r/tree/v0.1.12/examples');
  });

  it('leaves a link with no placeholder unchanged', () => {
    expect(withDocsVersion('https://github.com/o/r/tree/main/examples', '0.1.12')).toBe('https://github.com/o/r/tree/main/examples');
    expect(withDocsVersion('https://example.org/{{operator:start}}', '0.1.12')).toBe('https://example.org/{{operator:start}}');
  });
});
